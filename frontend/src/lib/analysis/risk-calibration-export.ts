// Deliberate browser-local projection from selected analyst cases into the
// existing offline CLI calibration contract. The export contains only the
// domain, disposition, and a bounded scoring-input subset from the latest
// normalized evidence snapshot. Notes, tags, assertions, actions, contacts,
// raw source data, scores, and provider payloads are never included.

import { RISK_MUTATION_TYPES } from '../../../../lib/risk-scoring.mts';
import {
  latestCaseEvidence,
  type CaseEvidenceSnapshot,
  type CaseRecord,
} from './case-record-model.ts';

export const RISK_CALIBRATION_DATASET_SCHEMA = 'whoisleuth.risk-calibration-dataset';
export const RISK_CALIBRATION_DATASET_VERSION = 1;
export const MAX_RISK_CALIBRATION_EXPORT_RECORDS = 500;

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

type CalibrationEvidence = Readonly<{
  availability: string;
  activityStatus?: string;
  mutationTypes?: string[];
  domainAgeDays?: number;
  faviconMatch?: boolean;
  faviconNearMatch?: boolean;
  reusesOfficialAssets?: boolean;
  hasPasswordField?: boolean;
  hasMx?: boolean;
  hasSpf?: boolean;
  hasDmarc?: boolean;
}>;

type CalibrationRecord = Readonly<{
  id: string;
  domain: string;
  analystDisposition: string;
  evidence: CalibrationEvidence;
}>;

export type RiskCalibrationDatasetExport = Readonly<{
  schema: typeof RISK_CALIBRATION_DATASET_SCHEMA;
  version: typeof RISK_CALIBRATION_DATASET_VERSION;
  records: readonly CalibrationRecord[];
  export: Readonly<{
    selected: number;
    included: number;
    excluded: number;
    exclusions: readonly CalibrationExportExclusion[];
  }>;
  limitations: readonly string[];
}>;

function optionalBoolean(value: boolean | null): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function domainAgeDays(snapshot: CaseEvidenceSnapshot): number | undefined {
  if (!snapshot.createdDate) return undefined;
  const created = Date.parse(snapshot.createdDate);
  const observed = Date.parse(snapshot.capturedAt);
  if (!Number.isFinite(created) || !Number.isFinite(observed) || observed < created) return undefined;
  const days = Math.floor((observed - created) / (24 * 60 * 60 * 1000));
  return days <= 100_000 ? days : undefined;
}

function projectEvidence(snapshot: CaseEvidenceSnapshot): CalibrationEvidence | null {
  const availability = snapshot.availability || 'unknown';
  if (!AVAILABILITY_STATES.has(availability)) return null;
  const activityStatus = snapshot.activityStatus && ACTIVITY_STATES.has(snapshot.activityStatus)
    ? snapshot.activityStatus
    : undefined;
  const mutationTypes = [...new Set(snapshot.mutationTypes.filter((value) => MUTATION_TYPES.has(value)))].slice(0, 30);
  const ageDays = domainAgeDays(snapshot);
  const faviconMatch = optionalBoolean(snapshot.faviconMatch);
  const faviconNearMatch = optionalBoolean(snapshot.faviconNearMatch);
  const reusesOfficialAssets = optionalBoolean(snapshot.reusesOfficialAssets);
  const hasPasswordField = optionalBoolean(snapshot.hasPasswordField);
  const hasMx = optionalBoolean(snapshot.hasMx);
  const hasSpf = optionalBoolean(snapshot.hasSpf);
  const hasDmarc = optionalBoolean(snapshot.hasDmarc);
  return Object.freeze({
    availability,
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
  });
}
export function buildRiskCalibrationDatasetExport(
  cases: readonly CaseRecord[],
  selectedCaseIds: readonly string[],
): RiskCalibrationDatasetExport {
  const caseById = new Map(cases.map((record) => [record.id, record]));
  const seen = new Set<string>();
  const records: CalibrationRecord[] = [];
  const exclusions: CalibrationExportExclusion[] = [];

  for (const caseId of selectedCaseIds) {
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
      analystDisposition: record.disposition,
      evidence,
    }));
  }

  return Object.freeze({
    schema: RISK_CALIBRATION_DATASET_SCHEMA,
    version: RISK_CALIBRATION_DATASET_VERSION,
    records: Object.freeze(records),
    export: Object.freeze({
      selected: selectedCaseIds.length,
      included: records.length,
      excluded: exclusions.length,
      exclusions: Object.freeze(exclusions),
    }),
    limitations: Object.freeze([
      'This file contains analyst-selected case domains, reviewed dispositions, and a bounded subset of normalized scoring inputs.',
      'It excludes notes, tags, assertions, actions, contacts, raw source data, provider payloads, and stored Risk scores.',
      'The CLI revalidates every record and does not tune the Risk model automatically. Analyst dispositions do not prove maliciousness or safety.',
    ]),
  });
}
