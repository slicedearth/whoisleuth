// Deliberate browser-local projection from selected analyst cases into the
// existing offline CLI calibration contract. The export contains only the
// domain, disposition, and a bounded scoring-input subset from the latest
// normalized evidence snapshot. Notes, tags, assertions, actions, contacts,
// raw source data, scores, and provider payloads are never included.

import { RISK_MUTATION_TYPES } from '../../lib/risk-scoring.mts';
import {
  MAX_RISK_CALIBRATION_DOMAIN_AGE_DAYS,
  MAX_RISK_CALIBRATION_MUTATIONS,
  MAX_RISK_CALIBRATION_RECORD_ID_LENGTH,
  MAX_RISK_CALIBRATION_RECORDS,
  RISK_CALIBRATION_DATASET_SCHEMA,
  RISK_CALIBRATION_DATASET_VERSION,
  RISK_CALIBRATION_EXPORT_LIMITATIONS,
  serializeRiskCalibrationSnapshot,
  snapshotRiskCalibrationDatasetExportForSerialization,
  type RiskCalibrationEvidence,
  type RiskCalibrationRecord,
} from '../contracts/risk-calibration.mts';
import {
  latestCaseEvidence,
  type CaseEvidenceSnapshot,
  type CaseRecord,
} from '../cases/case-record-model.mts';

export {
  RISK_CALIBRATION_DATASET_SCHEMA,
  RISK_CALIBRATION_DATASET_VERSION,
} from '../contracts/risk-calibration.mts';
export const MAX_RISK_CALIBRATION_EXPORT_RECORDS = MAX_RISK_CALIBRATION_RECORDS;

const REVIEWED_DISPOSITIONS = new Set([
  'suspicious',
  'confirmed_abuse',
  'false_positive',
  'expected',
  'closed_no_action',
]);
const AVAILABILITY_STATES = new Set(['registered', 'for_sale', 'expiring', 'available', 'unknown', 'error']);
const ACTIVITY_STATES = new Set(['active', 'parked', 'unreachable', 'no_site']);
const MUTATION_TYPES = new Set<string>(RISK_MUTATION_TYPES);

class RiskCalibrationSelectionShapeError extends TypeError {}
class RiskCalibrationSelectionLimitError extends RangeError {}
const RISK_CALIBRATION_SELECTION_CONTROL_RE = /[\u0000-\u001f\u007f]/u;

export type CalibrationExportExclusionReason =
  | 'duplicate_selection'
  | 'record_limit'
  | 'unreviewed'
  | 'missing_evidence'
  | 'unsupported_availability';

export type CalibrationExportExclusion = Readonly<{
  caseId: string;
  domain: string;
  reason: CalibrationExportExclusionReason;
}>;

export type RiskCalibrationDatasetExport = Readonly<{
  schema: typeof RISK_CALIBRATION_DATASET_SCHEMA;
  version: typeof RISK_CALIBRATION_DATASET_VERSION;
  records: readonly RiskCalibrationRecord[];
  export: Readonly<{
    selected: number;
    included: number;
    excluded: number;
    exclusions: readonly CalibrationExportExclusion[];
  }>;
  limitations: readonly string[];
}>;

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function snapshotSelectedCaseIds(value: unknown): readonly string[] {
  const shapeMessage = 'Risk calibration selections must be a bounded dense ordinary array of case identifiers.';
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      throw new RiskCalibrationSelectionShapeError(shapeMessage);
    }
    if (Object.getOwnPropertyDescriptor(value, Symbol.iterator)) {
      throw new RiskCalibrationSelectionShapeError(shapeMessage);
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    const length = lengthDescriptor && 'value' in lengthDescriptor
      ? lengthDescriptor.value
      : null;
    if (Number.isSafeInteger(length) && Number(length) > MAX_RISK_CALIBRATION_EXPORT_RECORDS) {
      throw new RiskCalibrationSelectionLimitError(
        `Risk calibration export is limited to ${MAX_RISK_CALIBRATION_EXPORT_RECORDS} selected cases.`,
      );
    }
    if (!lengthDescriptor
      || lengthDescriptor.enumerable
      || !Number.isSafeInteger(length)
      || Number(length) < 0) {
      throw new RiskCalibrationSelectionShapeError(shapeMessage);
    }
    const boundedLength = Number(length);
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== boundedLength + 1
      || ownKeys.at(-1) !== 'length'
      || ownKeys.slice(0, -1).some((key, index) => key !== String(index))) {
      throw new RiskCalibrationSelectionShapeError(shapeMessage);
    }
    const snapshot: string[] = [];
    for (let index = 0; index < boundedLength; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor
        || !descriptor.enumerable
        || !('value' in descriptor)
        || typeof descriptor.value !== 'string'
        || !descriptor.value.trim()
        || descriptor.value.length > MAX_RISK_CALIBRATION_RECORD_ID_LENGTH
        || RISK_CALIBRATION_SELECTION_CONTROL_RE.test(descriptor.value)) {
        throw new RiskCalibrationSelectionShapeError(shapeMessage);
      }
      snapshot.push(descriptor.value);
    }
    return Object.freeze(snapshot);
  } catch (cause) {
    if (cause instanceof RiskCalibrationSelectionShapeError
      || cause instanceof RiskCalibrationSelectionLimitError) throw cause;
    throw new RiskCalibrationSelectionShapeError(shapeMessage);
  }
}

function recursivelyFreezeOwned<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (const item of value) recursivelyFreezeOwned(item);
  } else {
    for (const item of Object.values(value as Record<string, unknown>)) recursivelyFreezeOwned(item);
  }
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

function domainAgeDays(snapshot: CaseEvidenceSnapshot): number | undefined {
  if (!snapshot.createdDate) return undefined;
  const created = Date.parse(snapshot.createdDate);
  const observed = Date.parse(snapshot.capturedAt);
  if (!Number.isFinite(created) || !Number.isFinite(observed) || observed < created) return undefined;
  const days = Math.floor((observed - created) / (24 * 60 * 60 * 1000));
  return days <= MAX_RISK_CALIBRATION_DOMAIN_AGE_DAYS ? days : undefined;
}

function projectEvidence(snapshot: CaseEvidenceSnapshot): RiskCalibrationEvidence | null {
  const availability = snapshot.availability || 'unknown';
  if (!AVAILABILITY_STATES.has(availability)) return null;
  const activityStatus = snapshot.activityStatus && ACTIVITY_STATES.has(snapshot.activityStatus)
    ? snapshot.activityStatus as NonNullable<RiskCalibrationEvidence['activityStatus']>
    : undefined;
  const mutationTypes = [...new Set(snapshot.mutationTypes.filter((value) => MUTATION_TYPES.has(value)))].slice(
    0,
    MAX_RISK_CALIBRATION_MUTATIONS,
  );
  const ageDays = domainAgeDays(snapshot);
  const faviconMatch = optionalBoolean(snapshot.faviconMatch);
  const faviconNearMatch = optionalBoolean(snapshot.faviconNearMatch);
  const reusesOfficialAssets = optionalBoolean(snapshot.reusesOfficialAssets);
  const hasPasswordField = optionalBoolean(snapshot.hasPasswordField);
  const hasMx = optionalBoolean(snapshot.hasMx);
  const hasSpf = optionalBoolean(snapshot.hasSpf);
  const hasDmarc = optionalBoolean(snapshot.hasDmarc);
  const privacyProtected = optionalBoolean(snapshot.privacyProtected);
  const hasExternalFormAction = optionalBoolean(snapshot.hasExternalFormAction);
  const idnReferenceMatch = optionalBoolean(snapshot.idnReferenceMatch);
  const pageBaselineMatch = optionalBoolean(snapshot.pageBaselineMatch);
  const hasActiveBrandProfile = optionalBoolean(snapshot.hasActiveBrandProfile);
  return Object.freeze({
    availability: availability as RiskCalibrationEvidence['availability'],
    ...(activityStatus ? { activityStatus } : {}),
    ...(mutationTypes.length ? { mutationTypes } : {}),
    ...(ageDays !== undefined ? { domainAgeDays: ageDays } : {}),
    ...(faviconMatch !== undefined ? { faviconMatch } : {}),
    ...(faviconNearMatch !== undefined ? { faviconNearMatch } : {}),
    ...(reusesOfficialAssets !== undefined ? { reusesOfficialAssets } : {}),
    ...(hasPasswordField !== undefined ? { hasPasswordField } : {}),
    ...(hasMx !== undefined ? { hasMx } : {}),
    ...(hasSpf !== undefined ? { hasSpf } : {}),
    ...(hasDmarc !== undefined ? { hasDmarc } : {}),
    ...(privacyProtected !== undefined ? { privacyProtected } : {}),
    // Risk only tests whether a bounded phrase match exists. Preserve that
    // signal without exporting page text that may contain sensitive content.
    ...(snapshot.phishingLanguageMatch ? { phishingLanguageMatch: 'matched' } : {}),
    ...(hasExternalFormAction !== undefined ? { hasExternalFormAction } : {}),
    ...(idnReferenceMatch !== undefined ? { idnReferenceMatch } : {}),
    ...(pageBaselineMatch !== undefined ? { pageBaselineMatch } : {}),
    ...(hasActiveBrandProfile !== undefined ? { hasActiveBrandProfile } : {}),
    ...(snapshot.scanDepth === 'fast' || snapshot.scanDepth === 'deep' ? { scanDepth: snapshot.scanDepth } : {}),
    ...(snapshot.capturedAt ? { observedAt: snapshot.capturedAt } : {}),
  });
}
export function buildRiskCalibrationDatasetExport(
  cases: readonly CaseRecord[],
  selectedCaseIds: readonly string[],
): RiskCalibrationDatasetExport {
  const selectedIds = snapshotSelectedCaseIds(selectedCaseIds);
  const caseById = new Map(cases.map((record) => [record.id, record]));
  const seen = new Set<string>();
  const records: RiskCalibrationRecord[] = [];
  const exclusions: CalibrationExportExclusion[] = [];

  for (const caseId of selectedIds) {
    const record = caseById.get(caseId);
    if (!record) continue;
    if (seen.has(caseId)) {
      exclusions.push(Object.freeze({ caseId, domain: record.domain, reason: 'duplicate_selection' }));
      continue;
    }
    seen.add(caseId);
    if (records.length >= MAX_RISK_CALIBRATION_EXPORT_RECORDS) {
      exclusions.push(Object.freeze({ caseId, domain: record.domain, reason: 'record_limit' }));
      continue;
    }
    if (!REVIEWED_DISPOSITIONS.has(record.disposition)) {
      exclusions.push(Object.freeze({ caseId, domain: record.domain, reason: 'unreviewed' }));
      continue;
    }
    const snapshot = latestCaseEvidence(record);
    if (!snapshot) {
      exclusions.push(Object.freeze({ caseId, domain: record.domain, reason: 'missing_evidence' }));
      continue;
    }
    const evidence = projectEvidence(snapshot);
    if (!evidence) {
      exclusions.push(Object.freeze({ caseId, domain: record.domain, reason: 'unsupported_availability' }));
      continue;
    }
    records.push(Object.freeze({
      id: record.id,
      domain: record.domain,
      analystDisposition: record.disposition as RiskCalibrationRecord['analystDisposition'],
      ...(record.reviewReasonCode ? { reviewReasonCode: record.reviewReasonCode } : {}),
      evidence,
    }));
  }

  return recursivelyFreezeOwned({
    schema: RISK_CALIBRATION_DATASET_SCHEMA,
    version: RISK_CALIBRATION_DATASET_VERSION,
    records,
    export: {
      selected: selectedIds.length,
      included: records.length,
      excluded: exclusions.length,
      exclusions,
    },
    limitations: [...RISK_CALIBRATION_EXPORT_LIMITATIONS],
  });
}

export function serializeRiskCalibrationDatasetExport(
  payload: RiskCalibrationDatasetExport,
): string {
  return serializeRiskCalibrationSnapshot(
    snapshotRiskCalibrationDatasetExportForSerialization(payload),
  );
}
