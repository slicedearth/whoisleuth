import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

import {
  canonicalArtifactJson,
  canonicalArtifactJsonFor,
  canonicalArtifactJsonV2,
  resolveArtifactCanonicalization,
  SORTED_JSON_V1,
  SORTED_JSON_V2,
} from '../packages/evidence/artifact-integrity.mts';
import { buildCaseReport } from '../packages/cases/case-report.mts';
import { WHOISLEUTH_APPLICATION_VERSION } from '../lib/application-version.mts';
import { scanBoundedJson } from '../lib/bounded-json.mts';
import {
  CONCLUSIVE_AVAILABILITY,
  assertCaseBrandProfileIds,
  caseEvidenceIncomparableReasons,
  compareCaseEvidence,
  hashString,
  normalizeDomain,
  normalizeCaseStore,
  normalizeSnapshot,
  safeId,
  type CaseEvidenceSnapshot,
  type CaseRecord,
} from '../packages/cases/case-model.mts';
import {
  caseReportVersionMatchesCase,
  CASE_IMPORT_VERSIONS,
  CASE_REPORT_SCHEMA,
  CASE_SCHEMA_VERSION,
  CLI_CASE_PACK_SCHEMA,
  CLI_CASE_PACK_VERSION,
  CLI_CASE_PACK_CURRENT_REDACTION_KEYS,
  CLI_CASE_PACK_INTEGRITY_KEYS as INTEGRITY_KEYS,
  CLI_CASE_PACK_LEGACY_REDACTION_KEYS,
  CLI_CASE_PACK_LIMITATIONS as PACKET_LIMITATIONS,
  CLI_CASE_PACK_PACKET_KEYS as PACKET_KEYS,
  CLI_CASE_PACK_REPORT_KEYS as REPORT_KEYS,
  CLI_CASE_PACK_ROOT_KEYS as ROOT_KEYS,
  LEGACY_CLI_CASE_PACK_VERSION,
  MAX_CASE_IMPORT_BYTES,
  MAX_CASE_PACK_CASES,
  MAX_CASE_PACK_INPUT_BYTES,
  MAX_EVIDENCE_SNAPSHOTS_PER_CASE,
} from '../packages/contracts/case-portability.mts';
import { buildPortableGeneratorMetadata } from '../lib/portable-generator.mts';
import { analystInteroperabilityTags } from '../lib/analyst-taxonomy.mts';
import { CliUsageError } from './errors.mts';

export {
  CLI_CASE_PACK_SCHEMA,
  CLI_CASE_PACK_VERSION,
  LEGACY_CLI_CASE_PACK_VERSION,
  MAX_CASE_PACK_CASES,
  MAX_CASE_PACK_INPUT_BYTES,
};
export type CasePackAudience = 'internal' | 'public' | 'trusted';

const MAX_CASE_PACK_REFERENCE_SCAN_DEPTH = 64;
const INTERNAL_EXCLUSIONS = Object.freeze(['Raw upstream payloads and credentials are outside the case schema.']);
const TRUSTED_EXCLUSIONS = Object.freeze(['Case notes', 'Recipient values', 'Manual trail targets', 'Raw upstream payloads and credentials']);
const PUBLIC_EXCLUSIONS_V10 = Object.freeze(['Case notes', 'Actions and recipient values', 'Analyst assertions', 'Manual trail targets', 'Raw upstream payloads and credentials']);
const PUBLIC_EXCLUSIONS_V11 = Object.freeze([...PUBLIC_EXCLUSIONS_V10.slice(0, 3), 'Investigation branches', ...PUBLIC_EXCLUSIONS_V10.slice(3)]);
const PUBLIC_EXCLUSIONS_V12 = Object.freeze(['Case notes', 'Brand Profile references', ...PUBLIC_EXCLUSIONS_V11.slice(1)]);
const PUBLIC_EXCLUSIONS = Object.freeze([...PUBLIC_EXCLUSIONS_V12, 'Independent observed-effect reviews and closure history']);
const SENSITIVE_CASE_PACK_FIELDS = Object.freeze(['brandProfileIds', 'notes', 'actions', 'assertions', 'manualTrail', 'observedEffects', 'closures', 'branches', 'recipient', 'target']);
const PUBLIC_OBSERVED_EFFECT_LIMITATION = 'Independent observed-effect review records were excluded from this public Case pack.';
const PUBLIC_CLOSURE_LIMITATION = 'Deliberate closure records were excluded from this public Case pack.';
const LEGACY_RISK_MODEL_LIMITATION = 'This report contains normalized browser-local observations from WHOISleuth analyst cases. It is not a live lookup and does not contain raw WHOIS, RDAP, DNS, HTML, or responses collected during website checks. Absence of a signal (e.g. no MX record observed) does not prove nonexistence. It may not have been evaluated. Snapshot fingerprints are deduplication identifiers, not cryptographic evidence hashes. Scan-depth and risk-model gates prevent misleading comparisons; "incomparable" means observations differ materially but one or more fields cannot be compared reliably. Generated locally in the browser. Review the package before sharing it.';
const LEGACY_SCORING_MODEL_LIMITATION = 'This report contains normalized browser-local observations from WHOISleuth analyst cases. It is not a live lookup and does not contain raw WHOIS, RDAP, DNS, HTML, or responses collected during website checks. Absence of a signal (e.g. no MX record observed) does not prove nonexistence. It may not have been evaluated. Snapshot fingerprints are deduplication identifiers, not cryptographic evidence hashes. Scan-depth and scoring-model gates prevent misleading comparisons; "incomparable" means observations differ materially but one or more fields cannot be compared reliably. Generated locally in the browser. Review the package before sharing it.';
const LEGACY_PORTABLE_LIMITATION = 'This report contains normalised browser-local observations from WHOISleuth analyst cases. It is not a live lookup and does not contain raw WHOIS, RDAP, DNS, HTML, or responses collected during website checks. Absence of a signal (e.g. no MX record observed) does not prove nonexistence. It may not have been evaluated. Snapshot fingerprints are deduplication identifiers, not cryptographic evidence hashes. Scan-depth and scoring-model gates prevent misleading comparisons; "incomparable" means observations differ materially but one or more fields cannot be compared reliably. Generated locally in the browser. Review the package before sharing it.';
const LEGACY_PROFILE_LIMITATION = 'This report contains normalised browser-local observations from WHOISleuth analyst cases. It is not a live lookup and does not contain raw WHOIS, RDAP, DNS, HTML, or responses collected during website checks. Absence of a signal (e.g. no MX record observed) does not prove nonexistence. It may not have been evaluated. Snapshot fingerprints are deduplication identifiers, not cryptographic evidence hashes. Scan-depth and scoring-model gates prevent misleading comparisons; "incomparable" means observations differ materially but one or more fields cannot be compared reliably. Brand Profile references record an explicit analyst-selected association only; they do not establish ownership, attribution, intent, safety, or maliciousness. Generated locally in the browser. Review the package before sharing it.';
const LEGACY_REPORT_LIMITATION_BY_VERSION = new Map<number, string>([
  [1, LEGACY_RISK_MODEL_LIMITATION],
  [2, LEGACY_RISK_MODEL_LIMITATION],
  [3, LEGACY_RISK_MODEL_LIMITATION],
  [4, LEGACY_RISK_MODEL_LIMITATION],
  [5, LEGACY_SCORING_MODEL_LIMITATION],
  [6, LEGACY_PORTABLE_LIMITATION],
  [7, LEGACY_PORTABLE_LIMITATION],
  [8, LEGACY_PROFILE_LIMITATION],
]);

const HISTORICAL_BASE_MATERIAL_FIELDS = Object.freeze([
  'scanDepth',
  'availability', 'confidence', 'riskModelVersion', 'riskScore', 'opportunityScore',
  'riskFactors', 'opportunityFactors',
  'registrar', 'createdDate', 'expiryDate', 'nameservers',
  'hasMx', 'hasSpf', 'hasDmarc',
  'activityStatus', 'websiteProbeDetail', 'pageTitle',
  'httpSummaryVersion', 'httpEvidenceStatus', 'httpFinalOrigin', 'httpResponseStatus', 'httpTransportSecurity', 'httpRedirectCount',
  'httpCrossOriginRedirect', 'httpHttpsDowngrade', 'httpContentType', 'httpSecurityHeaders',
  'faviconMatch', 'faviconNearMatch', 'reusesOfficialAssets', 'hasPasswordField', 'phishingLanguageMatch',
  'mutationTypes',
] as const);
const HISTORICAL_EXTERNAL_FORM_MATERIAL_FIELDS = Object.freeze([
  ...HISTORICAL_BASE_MATERIAL_FIELDS.slice(0, -2),
  'hasExternalFormAction',
  ...HISTORICAL_BASE_MATERIAL_FIELDS.slice(-2),
] as const);
const HISTORICAL_CONTEXT_MATERIAL_FIELDS = Object.freeze([
  'scanDepth',
  'availability', 'confidence', 'riskModelVersion', 'riskScore', 'opportunityModelVersion', 'opportunityScore',
  'riskFactors', 'opportunityFactors',
  'registrar', 'createdDate', 'expiryDate', 'nameservers',
  'hasMx', 'hasSpf', 'hasDmarc',
  'activityStatus', 'websiteProbeDetail', 'pageTitle',
  'httpSummaryVersion', 'httpEvidenceStatus', 'httpFinalOrigin', 'httpResponseStatus', 'httpTransportSecurity', 'httpRedirectCount',
  'httpCrossOriginRedirect', 'httpHttpsDowngrade', 'httpContentType', 'httpSecurityHeaders',
  'faviconMatch', 'faviconNearMatch', 'reusesOfficialAssets', 'hasPasswordField', 'hasExternalFormAction', 'phishingLanguageMatch',
  'privacyProtected', 'idnReferenceMatch', 'pageBaselineMatch', 'hasActiveBrandProfile',
  'mutationTypes',
] as const);
const HISTORICAL_PROFILE_CONTEXT_MATERIAL_FIELDS = Object.freeze([
  ...HISTORICAL_CONTEXT_MATERIAL_FIELDS.slice(0, -1),
  'profileContextState', 'profileContextLimitation',
  ...HISTORICAL_CONTEXT_MATERIAL_FIELDS.slice(-1),
] as const);
const HISTORICAL_CHANGE_ORDER = Object.freeze([
  'availability', 'confidence', 'riskScore', 'riskFactors', 'opportunityScore', 'opportunityFactors',
  'registrar', 'createdDate', 'expiryDate', 'nameservers', 'hasMx', 'hasSpf', 'hasDmarc',
  'activityStatus', 'websiteProbeDetail', 'pageTitle', 'httpEvidenceStatus', 'httpFinalOrigin',
  'httpResponseStatus', 'httpTransportSecurity', 'httpRedirectCount', 'httpCrossOriginRedirect',
  'httpHttpsDowngrade', 'httpContentType', 'httpSecurityHeaders', 'faviconMatch', 'faviconNearMatch',
  'reusesOfficialAssets', 'hasPasswordField', 'hasExternalFormAction', 'phishingLanguageMatch', 'mutationTypes',
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function expectedExclusions(audience: CasePackAudience, caseVersion: number): readonly string[] {
  if (audience === 'internal') return INTERNAL_EXCLUSIONS;
  if (audience === 'trusted') return TRUSTED_EXCLUSIONS;
  if (caseVersion >= 13) return PUBLIC_EXCLUSIONS;
  if (caseVersion === 12) return PUBLIC_EXCLUSIONS_V12;
  return caseVersion === 11 ? PUBLIC_EXCLUSIONS_V11 : PUBLIC_EXCLUSIONS_V10;
}

function stringListsMatch(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index]);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new TypeError(`The CLI case pack contains an unexpected ${label} field.`);
  }
}

type JsonNodeKind = 'array' | 'null' | 'object' | 'scalar';

function jsonNodeKind(value: unknown): JsonNodeKind {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value === 'object' ? 'object' : 'scalar';
}

/** Historical records may omit later object fields, but every retained value must match the bounded projection. */
function assertProjectionKeys(actual: unknown, projection: unknown, path: string, depth = 0): void {
  if (depth > MAX_CASE_PACK_REFERENCE_SCAN_DEPTH) {
    throw new TypeError('The CLI case pack exceeds its bounded projection depth.');
  }
  const actualKind = jsonNodeKind(actual);
  const projectionKind = jsonNodeKind(projection);
  if (actualKind !== projectionKind) {
    throw new TypeError(`The CLI case pack contains an invalid ${path} projection node.`);
  }
  if (actualKind === 'array') {
    const actualArray = actual as unknown[];
    const projectionArray = projection as unknown[];
    if (actualArray.length > projectionArray.length) {
      throw new TypeError(`The CLI case pack contains data outside its normalised ${path} projection.`);
    }
    for (let index = 0; index < actualArray.length; index++) {
      const expected = projectionArray[index];
      if (expected === undefined) {
        throw new TypeError(`The CLI case pack contains data outside its normalised ${path} projection.`);
      }
      assertProjectionKeys(actualArray[index], expected, `${path}[${index}]`, depth + 1);
    }
    return;
  }
  if (actualKind === 'object') {
    const actualRecord = actual as Record<string, unknown>;
    const projectionRecord = record(projection);
    if (!projectionRecord) throw new TypeError(`The CLI case pack contains an invalid ${path} projection.`);
    for (const key of Object.keys(actualRecord)) {
      if (!Object.hasOwn(projectionRecord, key)) {
        throw new TypeError(`The CLI case pack contains an unexpected ${path}.${key} field.`);
      }
      assertProjectionKeys(actualRecord[key], projectionRecord[key], `${path}.${key}`, depth + 1);
    }
    return;
  }
  if (!canonicalValuesMatch(actual, projection)) {
    throw new TypeError(`The CLI case pack contains a changed or unbounded ${path} projection value.`);
  }
}

function assertClosedEnvelopes(
  root: Record<string, unknown>,
  packet: Record<string, unknown>,
  integrity: Record<string, unknown>,
  redactionManifest: Record<string, unknown>,
  reports: readonly unknown[],
  supportsBrandProfileReferences: boolean,
): void {
  assertOnlyKeys(root, ROOT_KEYS, 'root envelope');
  assertOnlyKeys(packet, PACKET_KEYS, 'packet envelope');
  assertOnlyKeys(integrity, INTEGRITY_KEYS, 'integrity envelope');
  assertOnlyKeys(
    redactionManifest,
    supportsBrandProfileReferences ? CLI_CASE_PACK_CURRENT_REDACTION_KEYS : CLI_CASE_PACK_LEGACY_REDACTION_KEYS,
    'redaction manifest',
  );
  if (!stringListsMatch(packet.limitations, PACKET_LIMITATIONS)) {
    throw new TypeError('The CLI case pack contains an invalid packet limitation manifest.');
  }
  for (const value of reports) {
    const report = record(value);
    if (!report) throw new TypeError('The CLI case pack contains an invalid Case report envelope.');
    assertOnlyKeys(report, REPORT_KEYS, 'Case report envelope');
  }
}

function topCasePath(path: readonly (number | string)[]): boolean {
  return path.length === 2 && path[0] === 'cases' && typeof path[1] === 'number';
}

function reportCasePath(path: readonly (number | string)[]): boolean {
  return path.length === 4 && path[0] === 'packet' && path[1] === 'reports'
    && typeof path[2] === 'number' && path[3] === 'case';
}

function analystResponsePath(path: readonly (number | string)[]): boolean {
  return path.length === 4 && path[0] === 'packet' && path[1] === 'reports'
    && typeof path[2] === 'number' && path[3] === 'analystResponse';
}

function listItemPath(path: readonly (number | string)[], list: 'actions' | 'manualTrail'): boolean {
  return (path.length === 4 && path[0] === 'cases' && typeof path[1] === 'number' && path[2] === list && typeof path[3] === 'number')
    || (path.length === 6 && path[0] === 'packet' && path[1] === 'reports' && typeof path[2] === 'number'
      && path[3] === 'analystResponse' && path[4] === list && typeof path[5] === 'number');
}

function allowedSensitiveFieldPath(key: string, path: readonly (number | string)[], supportsBrandProfileReferences: boolean): boolean {
  if (key === 'brandProfileIds') return supportsBrandProfileReferences && (topCasePath(path) || reportCasePath(path));
  if (key === 'notes') return topCasePath(path) || reportCasePath(path);
  if (key === 'actions' || key === 'assertions' || key === 'manualTrail' || key === 'observedEffects' || key === 'closures' || key === 'branches') {
    return topCasePath(path) || analystResponsePath(path);
  }
  if (key === 'recipient') return listItemPath(path, 'actions');
  if (key === 'target') return listItemPath(path, 'manualTrail');
  return true;
}

/** Rejects hidden audience-sensitive copies with a budget proven by the serialized byte bound. */
function assertSensitiveFieldPlacement(root: Record<string, unknown>, supportsBrandProfileReferences: boolean, serializedLength: number): void {
  const stack: Array<{ value: unknown; path: readonly (number | string)[]; depth: number }> = [{ value: root, path: [], depth: 0 }];
  const visited = new Set<object>();
  let inspected = 0;
  while (stack.length) {
    const entry = stack.pop();
    if (!entry || !entry.value || typeof entry.value !== 'object') continue;
    for (const key of SENSITIVE_CASE_PACK_FIELDS) {
      if (Object.hasOwn(entry.value, key) && !allowedSensitiveFieldPath(key, entry.path, supportsBrandProfileReferences)) {
        throw new TypeError('The CLI case pack contains audience-sensitive data outside its versioned case or report fields.');
      }
    }
    if (visited.has(entry.value)) continue;
    visited.add(entry.value);
    inspected += 1;
    if (inspected > serializedLength + 1 || entry.depth > MAX_CASE_PACK_REFERENCE_SCAN_DEPTH) {
      throw new TypeError('The CLI case pack exceeds its bounded audience-field scan.');
    }
    if (Array.isArray(entry.value)) {
      for (let index = entry.value.length - 1; index >= 0; index--) {
        inspected += 1;
        if (inspected > serializedLength + 1) throw new TypeError('The CLI case pack exceeds its bounded audience-field scan.');
        stack.push({ value: entry.value[index], path: [...entry.path, index], depth: entry.depth + 1 });
      }
      continue;
    }
    try {
      for (const key in entry.value) {
        if (!Object.hasOwn(entry.value, key)) continue;
        inspected += 1;
        if (inspected > serializedLength + 1) throw new TypeError('The CLI case pack exceeds its bounded audience-field scan.');
        stack.push({ value: (entry.value as Record<string, unknown>)[key], path: [...entry.path, key], depth: entry.depth + 1 });
      }
    } catch (cause) {
      if (cause instanceof TypeError && /bounded audience-field scan/u.test(cause.message)) throw cause;
      throw new TypeError('The CLI case pack could not be inspected safely for audience-sensitive data.');
    }
  }
}

function canonicalValuesMatch(left: unknown, right: unknown): boolean {
  try { return canonicalArtifactJson(left) === canonicalArtifactJson(right); }
  catch { return false; }
}

function assertCanonicalCaseIdentities(cases: readonly unknown[], label: string): void {
  const ids = new Set<string>();
  const domains = new Set<string>();
  for (const value of cases) {
    const item = record(value);
    if (!item
      || typeof item.id !== 'string'
      || safeId(item.id) !== item.id
      || typeof item.domain !== 'string'
      || normalizeDomain(item.domain) !== item.domain
      || ids.has(item.id)
      || domains.has(item.domain)) {
      throw new TypeError(`${label} contains a missing, unsafe, non-canonical, or duplicate Case identity.`);
    }
    ids.add(item.id);
    domains.add(item.domain);
  }
}

function assertCurrentCaseProjection(rawCases: readonly unknown[], normalised: readonly CaseRecord[], label: string): void {
  if (rawCases.length !== normalised.length
    || rawCases.some((item, index) => !canonicalValuesMatch(item, normalised[index]))) {
    throw new TypeError(`${label} contains a schema ${CASE_SCHEMA_VERSION} Case that would be repaired, truncated, or otherwise changed during normalisation.`);
  }
}

function assertCase13Projection(rawCases: readonly unknown[], normalised: readonly CaseRecord[], label: string): void {
  const projected = normalised.map((item) => ({
    ...structuredClone(item),
    evidenceHistory: item.evidenceHistory.map(({ inputHostname: _inputHostname, ...snapshot }) => snapshot),
  }));
  if (rawCases.length !== projected.length
    || rawCases.some((item, index) => !canonicalValuesMatch(item, projected[index]))) {
    throw new TypeError(`${label} contains a schema 13 Case that would be changed beyond the declared schema-14 inputHostname migration.`);
  }
}

function requiredHistoricalCaseKeys(caseVersion: number): readonly string[] {
  return [
    'id', 'domain', 'status', 'disposition', 'tags', 'notes', 'source', 'evidenceHistory', 'createdAt', 'updatedAt',
    ...(caseVersion >= 3 ? ['evidencePins', 'decisions', 'actions'] : []),
    ...(caseVersion >= 4 ? ['assertions', 'manualTrail'] : []),
    ...(caseVersion >= 9 ? ['sightings'] : []),
    ...(caseVersion >= 12 ? ['brandProfileIds'] : []),
  ];
}

function assertHistoricalCaseOwnKeys(cases: readonly unknown[], caseVersion: number): void {
  const required = requiredHistoricalCaseKeys(caseVersion);
  for (let index = 0; index < cases.length; index++) {
    const item = record(cases[index]);
    if (!item) throw new TypeError(`The CLI case pack contains an invalid historical Case at cases[${index}].`);
    const missing = required.find((key) => !Object.hasOwn(item, key));
    if (missing) {
      throw new TypeError(`The CLI case pack is missing required historical Case field cases[${index}].${missing}.`);
    }
  }
}

function reportVersionMatchesCase(caseVersion: number, reportVersion: unknown): boolean {
  return caseReportVersionMatchesCase(caseVersion, reportVersion);
}

function publicObservedEffectHistory(preV13HistoryUnavailable: boolean): CaseRecord['observedEffects'] {
  return {
    reviews: [],
    omitted: 0,
    preV13HistoryUnavailable,
    limitations: [
      ...(preV13HistoryUnavailable
        ? ['Migrated from a pre-v13 Case; earlier independent observed-effect review history is unavailable.']
        : []),
      'Observed-effect reviews are independent point-in-time records; provider workflow events do not create or replace them.',
      PUBLIC_OBSERVED_EFFECT_LIMITATION,
    ].sort(),
  };
}

function publicClosureHistory(preV13HistoryUnavailable: boolean): CaseRecord['closures'] {
  return {
    records: [],
    omitted: 0,
    preV13HistoryUnavailable,
    limitations: [
      ...(preV13HistoryUnavailable
        ? ['Migrated from a pre-v13 Case; earlier deliberate closure history is unavailable.']
        : []),
      'Closure records are deliberate analyst actions and do not establish absence, safety, provider performance, or legal sufficiency.',
      PUBLIC_CLOSURE_LIMITATION,
    ].sort(),
  };
}

function assertAudienceFields(value: Record<string, unknown>, audience: CasePackAudience, supportsBranches: boolean): void {
  if (!supportsBranches && Object.hasOwn(value, 'branches')) {
    throw new TypeError('The CLI case pack contains an Investigation branch outside its versioned fields.');
  }
  if (audience === 'internal') return;
  if (Object.hasOwn(value, 'notes') && (!Array.isArray(value.notes) || value.notes.length !== 0)) {
    throw new TypeError('The CLI case pack contains Case notes excluded by its audience.');
  }
  if (audience === 'public') {
    for (const field of ['actions', 'assertions', ...(supportsBranches ? ['branches'] : [])]) {
      if (Object.hasOwn(value, field) && (!Array.isArray(value[field]) || (value[field] as unknown[]).length !== 0)) {
        throw new TypeError(`The public CLI case pack contains ${field} excluded by its audience.`);
      }
    }
    for (const [field, list] of [['observedEffects', 'reviews'], ['closures', 'records']] as const) {
      if (Object.hasOwn(value, field)) {
        const history = record(value[field]);
        const expected = field === 'observedEffects'
          ? publicObservedEffectHistory(history?.preV13HistoryUnavailable === true)
          : publicClosureHistory(history?.preV13HistoryUnavailable === true);
        if (!history || !Array.isArray(history[list]) || (history[list] as unknown[]).length !== 0
          || !canonicalValuesMatch(history, expected)) {
          throw new TypeError(`The public CLI case pack contains ${field} excluded by its audience.`);
        }
      }
    }
  } else if (Object.hasOwn(value, 'actions')) {
    if (!Array.isArray(value.actions) || value.actions.some((entry) => {
      const action = record(entry);
      return !action || (Object.hasOwn(action, 'recipient') && action.recipient !== '[redacted]');
    })) {
      throw new TypeError('The trusted CLI case pack contains an unredacted action recipient.');
    }
  }
  if (Object.hasOwn(value, 'manualTrail')) {
    if (!Array.isArray(value.manualTrail) || value.manualTrail.some((entry) => {
      const event = record(entry);
      return !event || (Object.hasOwn(event, 'target') && event.target !== null);
    })) {
      throw new TypeError('The CLI case pack contains a manual-trail target excluded by its audience.');
    }
  }
}

function reportApplicationVersion(report: Record<string, unknown>): unknown {
  return record(report.application)?.version;
}

function assertCurrentReportProjection(report: Record<string, unknown>, rawCase: CaseRecord): void {
  if (typeof report.generatedAt !== 'string') {
    throw new TypeError('The CLI case pack contains an invalid or mismatched Case report.');
  }
  const expected = buildCaseReport(rawCase, {
    applicationVersion: reportApplicationVersion(report),
    includeNotes: false,
    generatedAt: report.generatedAt,
  }).json;
  if (!canonicalValuesMatch(report, expected)) {
    throw new TypeError('The CLI case pack contains an invalid or mismatched Case report projection.');
  }
}

type HistoricalMaterialField = (typeof HISTORICAL_PROFILE_CONTEXT_MATERIAL_FIELDS)[number];
type HistoricalSnapshot = Record<string, unknown>;

function historicalMaterialFields(caseVersion: number): readonly HistoricalMaterialField[] {
  if (caseVersion <= 7) return HISTORICAL_BASE_MATERIAL_FIELDS;
  if (caseVersion <= 9) return HISTORICAL_EXTERNAL_FORM_MATERIAL_FIELDS;
  if (caseVersion <= 11) return HISTORICAL_CONTEXT_MATERIAL_FIELDS;
  return HISTORICAL_PROFILE_CONTEXT_MATERIAL_FIELDS;
}

function historicalMaterialValue(field: HistoricalMaterialField, snapshot: CaseEvidenceSnapshot): unknown {
  switch (field) {
    case 'availability':
      return typeof snapshot.availability === 'string' && CONCLUSIVE_AVAILABILITY.has(snapshot.availability)
        ? snapshot.availability
        : null;
    case 'registrar':
      return String(snapshot.registrar ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || null;
    case 'createdDate':
    case 'expiryDate': {
      const value = snapshot[field];
      return typeof value === 'string' ? value.slice(0, 10) : null;
    }
    case 'riskFactors':
    case 'opportunityFactors':
      return snapshot[field].map((factor) => [factor.label, factor.points]);
    default:
      return snapshot[field] ?? null;
  }
}

function historicalMaterialIsEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === 'string' ? value.trim() === '' : false;
}

/**
 * Recreates the exact material identity used by each historical Case epoch.
 * Current migration happens separately so adding schema-12 fields can never
 * invalidate an authentic old fingerprint or make a forged one look valid.
 */
function normalizeHistoricalEvidenceHistory(rawHistory: unknown, caseVersion: number): HistoricalSnapshot[] {
  if (!Array.isArray(rawHistory) || rawHistory.length > MAX_EVIDENCE_SNAPSHOTS_PER_CASE) {
    throw new TypeError('The CLI case pack contains an invalid historical evidence collection.');
  }
  const fields = historicalMaterialFields(caseVersion);
  const materialSeen = new Set<string>();
  const built = rawHistory.map((raw, index) => {
    const rawSnapshot = record(raw);
    const normalized = normalizeSnapshot(raw, { fallback: null, sourceVersion: caseVersion });
    if (!rawSnapshot || !normalized) {
      throw new TypeError(`The CLI case pack contains an invalid historical evidence snapshot ${index}.`);
    }
    const materialRecord: Record<string, unknown> = {};
    let hasEvidence = false;
    for (const field of fields) {
      const value = historicalMaterialValue(field, normalized);
      materialRecord[field] = value;
      if (field !== 'scanDepth' && field !== 'confidence' && !historicalMaterialIsEmpty(value)) hasEvidence = true;
    }
    if (!hasEvidence) {
      throw new TypeError(`The CLI case pack contains an empty historical evidence snapshot ${index}.`);
    }
    const material = JSON.stringify(materialRecord);
    if (materialSeen.has(material)) {
      throw new TypeError('The CLI case pack contains duplicate historical evidence material.');
    }
    materialSeen.add(material);
    const fingerprint = hashString(material);
    return {
      material,
      snapshot: {
        id: `ev-${fingerprint}`,
        fingerprint,
        firstCapturedAt: normalized.firstCapturedAt,
        capturedAt: normalized.capturedAt,
        source: normalized.source,
        ...Object.fromEntries(fields.map((field) => [field, normalized[field] ?? null])),
      } satisfies HistoricalSnapshot,
      rawSnapshot,
    };
  });
  built.sort((left, right) => (
    Date.parse(String(left.snapshot.capturedAt)) - Date.parse(String(right.snapshot.capturedAt))
    || Date.parse(String(left.snapshot.firstCapturedAt)) - Date.parse(String(right.snapshot.firstCapturedAt))
    || String(left.snapshot.fingerprint).localeCompare(String(right.snapshot.fingerprint))
  ));
  const usedIds = new Set<string>();
  for (const item of built) {
    const base = String(item.snapshot.id);
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) id = `${base}-${suffix++}`;
    usedIds.add(id);
    item.snapshot.id = id;
  }
  const projected = built.map((item) => item.snapshot);
  assertProjectionKeys(rawHistory, projected, 'historical evidenceHistory');
  for (let index = 0; index < built.length; index++) {
    const item = built[index];
    if (!item
      || item.rawSnapshot.id !== item.snapshot.id
      || item.rawSnapshot.fingerprint !== item.snapshot.fingerprint) {
      throw new TypeError(`The CLI case pack contains an invalid historical evidence identity at snapshot ${index}.`);
    }
  }
  return projected;
}

function historicalEvidenceChanges(
  previous: HistoricalSnapshot,
  current: HistoricalSnapshot,
  caseVersion: number,
): ReturnType<typeof compareCaseEvidence> {
  const previousSnapshot = previous as unknown as CaseEvidenceSnapshot;
  const currentSnapshot = current as unknown as CaseEvidenceSnapshot;
  const changes = compareCaseEvidence(previousSnapshot, currentSnapshot)
    .filter((change) => caseVersion >= 10 || !['opportunityScore', 'opportunityFactors'].includes(change.field));
  if (caseVersion <= 9 && previous.opportunityScore !== current.opportunityScore) {
    changes.push({
      field: 'opportunityScore',
      label: 'Opportunity score',
      before: previous.opportunityScore ?? null,
      after: current.opportunityScore ?? null,
      tone: 'neutral',
    });
  }
  if (caseVersion <= 9 && !canonicalValuesMatch(previous.opportunityFactors, current.opportunityFactors)) {
    changes.push({
      field: 'opportunityFactors',
      label: 'Opportunity factors',
      before: previous.opportunityFactors,
      after: current.opportunityFactors,
      tone: 'neutral',
    });
  }
  const order = new Map(HISTORICAL_CHANGE_ORDER.map((field, index) => [field, index]));
  return changes
    .sort((left, right) => (order.get(left.field) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.field) ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 40);
}

function historicalEvidenceTimeline(history: readonly HistoricalSnapshot[], caseVersion: number) {
  return history.map((snapshot, index) => {
    if (index === 0) {
      return {
        snapshot,
        isBaseline: true,
        hasRepeatedObservation: snapshot.firstCapturedAt !== snapshot.capturedAt,
        changes: null,
        hasIncomparableChange: false,
        incomparableReasons: [],
      };
    }
    const previous = history[index - 1];
    if (!previous) throw new TypeError('The CLI case pack contains an invalid historical evidence timeline.');
    const changes = historicalEvidenceChanges(previous, snapshot, caseVersion);
    let incomparableReasons = caseEvidenceIncomparableReasons(
      previous as unknown as CaseEvidenceSnapshot,
      snapshot as unknown as CaseEvidenceSnapshot,
    ).filter((reason) => caseVersion >= 10 || reason !== 'opportunity-model') as string[];
    if (changes.length === 0 && snapshot.fingerprint !== previous.fingerprint && incomparableReasons.length === 0) {
      incomparableReasons = ['other'];
    }
    return {
      snapshot,
      isBaseline: false,
      hasRepeatedObservation: snapshot.firstCapturedAt !== snapshot.capturedAt,
      changes: changes.length ? changes : null,
      hasIncomparableChange: incomparableReasons.length > 0,
      incomparableReasons,
    };
  });
}

function pickHistoricalFields(value: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field, structuredClone(value[field])])) as Record<string, unknown>;
}

function historicalAnalystResponse(caseRecord: CaseRecord, caseVersion: number, reportVersion: number) {
  if (reportVersion === 1) return null;
  const oldPinFields = ['id', 'label', 'value', 'source', 'observedAt', 'completeness', 'limitations', 'createdAt'];
  const expandedPinFields = [
    'id', 'checkpointId', 'field', 'category', 'label', 'value', 'source', 'sourceState', 'sourceSchema',
    'observedAt', 'collectionDepth', 'completeness', 'truncated',
    ...(caseVersion >= 7 ? ['transitionExpectation'] : []),
    'limitations', 'createdAt',
  ];
  const evidencePins = caseRecord.evidencePins.map((item) => pickHistoricalFields(
    item as unknown as Record<string, unknown>,
    caseVersion >= 5 ? expandedPinFields : oldPinFields,
  ));
  const decisions = caseRecord.decisions.map((item) => pickHistoricalFields(
    item as unknown as Record<string, unknown>,
    ['id', 'summary', 'rationale', 'evidencePinIds', 'createdAt'],
  ));
  const actions = caseRecord.actions.map((item) => {
    const projected = pickHistoricalFields(
      item as unknown as Record<string, unknown>,
      ['id', 'type', 'recipient', 'contactSource', 'contactLimitations', 'dueAt', 'state', 'reference', 'followUpAt', 'outcome', 'createdAt', 'updatedAt'],
    );
    const migrationState = item.history.find((event) => event.sourceClass === 'migration')?.limitations
      .map((limitation) => /current state "([^"]+)"/u.exec(limitation)?.[1] ?? null)
      .find((value) => value !== null);
    if (migrationState && ['planned', 'ready_for_review', 'submitted', 'acknowledged', 'resolved', 'closed'].includes(migrationState)) {
      projected.state = migrationState;
    }
    return projected;
  });
  const assertions = caseRecord.assertions.map((item) => {
    const projected = pickHistoricalFields(
      item as unknown as Record<string, unknown>,
      [
        'id', 'kind', 'statement', 'rationale', 'evidencePinIds',
        ...(reportVersion >= 6 ? ['evidenceRelations'] : []),
        'state', 'createdAt', 'updatedAt',
      ],
    );
    if (caseVersion >= 7 && item.provenance) projected.provenance = structuredClone(item.provenance);
    return projected;
  });
  const manualTrail = caseRecord.manualTrail.map((item) => pickHistoricalFields(
    item as unknown as Record<string, unknown>,
    ['id', 'kind', 'summary', 'target', 'createdAt'],
  ));
  const sightings = caseRecord.sightings.map((item) => pickHistoricalFields(
    item as unknown as Record<string, unknown>,
    ['id', 'state', 'sourceClass', 'category', 'source', 'observedAt', 'completeness', 'evidencePinId', 'limitations', 'createdAt'],
  ));
  const branches = (caseRecord.branches ?? []).map((item) => pickHistoricalFields(
    item as unknown as Record<string, unknown>,
    ['id', 'name', 'state', 'evidencePinIds', 'checkpointIds', 'assertionIds', 'actionIds', 'createdAt', 'updatedAt'],
  ));
  return {
    evidencePins,
    decisions,
    actions,
    ...(reportVersion >= 3 ? { assertions, manualTrail } : {}),
    ...(reportVersion >= 4 ? { sightings } : {}),
    ...(reportVersion >= 7 ? { branches } : {}),
  };
}

function assertHistoricalCaseResponseEpoch(
  rawCase: Record<string, unknown>,
  caseRecord: CaseRecord,
  caseVersion: number,
  reportVersion: number,
  path: string,
): void {
  const expected = historicalAnalystResponse(caseRecord, caseVersion, reportVersion);
  const introductions = new Map<string, number>([
    ['evidencePins', 3], ['decisions', 3], ['actions', 3],
    ['assertions', 4], ['manualTrail', 4], ['sightings', 9], ['branches', 11],
  ]);
  for (const [field, introduced] of introductions) {
    if (caseVersion < introduced) {
      if (Object.hasOwn(rawCase, field)) {
        throw new TypeError(`The CLI case pack contains ${path}.${field} outside its historical Case epoch.`);
      }
      continue;
    }
    if (Object.hasOwn(rawCase, field)) {
      const projection = record(expected)?.[field];
      assertProjectionKeys(rawCase[field], projection, `${path}.${field}`);
    }
  }
  if (caseVersion < 10 && Object.hasOwn(rawCase, 'reviewReasonCode')) {
    throw new TypeError(`The CLI case pack contains ${path}.reviewReasonCode outside its historical Case epoch.`);
  }
}

function historicalReportProjection(
  caseRecord: CaseRecord,
  evidenceHistory: readonly HistoricalSnapshot[],
  report: Record<string, unknown>,
  caseVersion: number,
  reportVersion: number,
  generatedAt: string,
) {
  const limitation = LEGACY_REPORT_LIMITATION_BY_VERSION.get(reportVersion);
  if (!limitation) throw new TypeError('The CLI case pack contains an unsupported historical Case report.');
  const reportCase: Record<string, unknown> = {
    id: caseRecord.id,
    domain: caseRecord.domain,
    status: caseRecord.status,
    disposition: caseRecord.disposition,
    ...(reportVersion >= 5 ? { reviewReasonCode: caseRecord.reviewReasonCode ?? null } : {}),
    ...(reportVersion >= 6 ? { interoperabilityTags: analystInteroperabilityTags(caseRecord.disposition, caseRecord.reviewReasonCode) } : {}),
    ...(reportVersion >= 8 ? { brandProfileIds: [...caseRecord.brandProfileIds] } : {}),
    tags: [...caseRecord.tags],
    source: caseRecord.source,
    openedAt: caseRecord.createdAt,
    updatedAt: caseRecord.updatedAt,
    notesIncluded: false,
  };
  const response = historicalAnalystResponse(caseRecord, caseVersion, reportVersion);
  return {
    schema: CASE_REPORT_SCHEMA,
    schemaVersion: reportVersion,
    generatedAt,
    application: reportVersion >= 6
      ? buildPortableGeneratorMetadata(reportApplicationVersion(report))
      : { name: 'WHOISleuth' },
    case: reportCase,
    currentAssessment: evidenceHistory.at(-1) ?? null,
    evidenceTimeline: historicalEvidenceTimeline(evidenceHistory, caseVersion),
    ...(response ? { analystResponse: response } : {}),
    limitations: limitation,
  };
}

function assertLegacyProfileContextEpoch(rawCase: Record<string, unknown>, report: Record<string, unknown>): void {
  const assertSnapshot = (value: unknown, path: string) => {
    const snapshot = record(value);
    if (snapshot && (Object.hasOwn(snapshot, 'profileContextState') || Object.hasOwn(snapshot, 'profileContextLimitation'))) {
      throw new TypeError(`The CLI case pack contains schema-12 profile context fields outside the historical ${path} epoch.`);
    }
  };
  if (Array.isArray(rawCase.evidenceHistory)) {
    rawCase.evidenceHistory.forEach((snapshot, index) => assertSnapshot(snapshot, `cases evidence snapshot ${index}`));
  }
  assertSnapshot(report.currentAssessment, 'current assessment');
  if (Array.isArray(report.evidenceTimeline)) {
    report.evidenceTimeline.forEach((entry, index) => {
      const timelineEntry = record(entry);
      assertSnapshot(timelineEntry?.snapshot, `report timeline snapshot ${index}`);
      if (!Array.isArray(timelineEntry?.changes)) return;
      timelineEntry.changes.forEach((value, changeIndex) => {
        const change = record(value);
        if (!change) return;
        const field = change.field;
        const label = change.label;
        const carriesProfileContextField = ['profileContextState', 'profileContextLimitation'].some((key) => (
          Object.hasOwn(change, key)
          || field === key
          || [change.before, change.after].some((candidate) => Boolean(record(candidate) && Object.hasOwn(record(candidate)!, key)))
        ));
        if (carriesProfileContextField
          || (typeof label === 'string' && /profile[ -]?context/iu.test(label))) {
          throw new TypeError(`The CLI case pack contains schema-12 profile context fields outside the historical report timeline change ${index}.${changeIndex} epoch.`);
        }
      });
    });
  }
}

function redactedCase(record: CaseRecord, audience: CasePackAudience): CaseRecord {
  if (audience === 'internal') return structuredClone(record);
  return {
    ...structuredClone(record),
    status: audience === 'public' && record.status === 'resolved' && record.closures.records.length
      ? 'reviewing'
      : record.status,
    brandProfileIds: audience === 'public' ? [] : [...record.brandProfileIds],
    notes: [],
    actions: audience === 'public' ? [] : record.actions.map((item) => ({ ...item, recipient: '[redacted]' })),
    manualTrail: record.manualTrail.map((item) => ({ ...item, target: null })),
    assertions: audience === 'public' ? [] : structuredClone(record.assertions),
    observedEffects: audience === 'public'
      ? publicObservedEffectHistory(record.observedEffects.preV13HistoryUnavailable)
      : structuredClone(record.observedEffects),
    closures: audience === 'public'
      ? publicClosureHistory(record.closures.preV13HistoryUnavailable)
      : structuredClone(record.closures),
    branches: audience === 'public' ? [] : structuredClone(record.branches ?? []),
  };
}

export function buildCliCasePack(
  input: string,
  options: Readonly<{ audience: CasePackAudience; reviewed: boolean }>,
  generatedAt = new Date().toISOString(),
) {
  if (!options.reviewed) throw new CliUsageError('case-pack requires --reviewed after the audience-specific output has been checked.');
  if (Buffer.byteLength(input, 'utf8') > MAX_CASE_PACK_INPUT_BYTES) throw new CliUsageError('Case-pack input is limited to 4 MiB.');
  const normalized = input.replace(/^\uFEFF/u, '');
  let parsed: unknown;
  try {
    scanBoundedJson(normalized);
    parsed = JSON.parse(normalized);
  } catch { throw new CliUsageError('Case-pack input must be valid bounded JSON without duplicate keys.'); }
  const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  if (typeof root.version !== 'number' || !CASE_IMPORT_VERSIONS.includes(root.version as typeof CASE_IMPORT_VERSIONS[number]) || !Array.isArray(root.cases)) {
    throw new CliUsageError(`Case-pack input must be a supported WHOISleuth case export through schema ${CASE_SCHEMA_VERSION}.`);
  }
  if (root.version === CASE_SCHEMA_VERSION) {
    try {
      assertCanonicalCaseIdentities(root.cases, 'Case-pack input');
      for (const item of root.cases) {
        const rawCase = record(item);
        if (!rawCase || !Object.hasOwn(rawCase, 'brandProfileIds')) throw new Error('missing');
        assertCaseBrandProfileIds(rawCase.brandProfileIds);
      }
    } catch (cause) {
      if (cause instanceof TypeError && /Case identity/u.test(cause.message)) {
        throw new CliUsageError(cause.message);
      }
      throw new CliUsageError(`Case-pack schema ${CASE_SCHEMA_VERSION} input requires exact canonical Case identities and an exact, unique, bounded brandProfileIds array on every case.`);
    }
  }
  const normalised = normalizeCaseStore(root).cases;
  if (!normalised.length) throw new CliUsageError('Case-pack input did not contain a valid case.');
  if (normalised.length !== root.cases.length) {
    throw new CliUsageError('Case-pack input contains an invalid or duplicate case. Correct the browser export before packaging it.');
  }
  if (normalised.length > MAX_CASE_PACK_CASES) {
    throw new CliUsageError(`Case packs are limited to ${MAX_CASE_PACK_CASES} reviewed cases. Export a smaller selected set so no case is silently omitted.`);
  }
  if (root.version === CASE_SCHEMA_VERSION) {
    try { assertCurrentCaseProjection(root.cases, normalised, 'Case-pack input'); }
    catch (cause) { throw new CliUsageError(cause instanceof Error ? cause.message : `Case-pack schema ${CASE_SCHEMA_VERSION} input is not exact.`); }
  }
  const cases = normalised.map((item) => redactedCase(item, options.audience));
  const brandProfileReferencesOmitted = options.audience === 'public'
    ? normalised.reduce((count, item) => count + item.brandProfileIds.length, 0)
    : 0;
  const reports = cases.map((item) => buildCaseReport(item, {
    applicationVersion: WHOISLEUTH_APPLICATION_VERSION,
    includeNotes: false,
    generatedAt,
  }).json);
  const exclusions = expectedExclusions(options.audience, CASE_SCHEMA_VERSION);
  const packet = Object.freeze({
    schema: CLI_CASE_PACK_SCHEMA,
    version: CLI_CASE_PACK_VERSION,
    audience: options.audience,
    reviewed: true,
    reports: Object.freeze(reports),
    redactionManifest: Object.freeze({
      excluded: Object.freeze(exclusions),
      sourceCaseCount: normalised.length,
      brandProfileReferencesOmitted,
    }),
    limitations: Object.freeze(PACKET_LIMITATIONS),
  });
  const unsigned = { version: CASE_SCHEMA_VERSION, exportedAt: generatedAt, cases, packet };
  const document = Object.freeze({
    ...unsigned,
    integrity: Object.freeze({
      algorithm: 'SHA-256',
      canonicalization: SORTED_JSON_V2,
      digestSha256: `sha256:${createHash('sha256').update(canonicalArtifactJsonV2(unsigned)).digest('hex')}`,
    }),
  });
  if (Buffer.byteLength(JSON.stringify(document), 'utf8') > MAX_CASE_IMPORT_BYTES) {
    throw new CliUsageError('The generated case pack exceeds the browser 2 MiB import limit. Select fewer cases or a more restrictive audience so no evidence is silently omitted.');
  }
  return document;
}

export function verifyCliCasePack(input: unknown): Readonly<{ caseCount: number }> {
  const root = record(input);
  let serialized: string;
  try { serialized = JSON.stringify(root); }
  catch { throw new TypeError('The CLI case pack structure is not serializable.'); }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_CASE_IMPORT_BYTES) {
    throw new TypeError('The CLI case pack exceeds the browser import limit.');
  }
  const packet = record(root?.packet);
  const integrity = record(root?.integrity);
  const redactionManifest = record(packet?.redactionManifest);
  if (!root
    || !packet
    || packet.schema !== CLI_CASE_PACK_SCHEMA
    || (packet.version !== LEGACY_CLI_CASE_PACK_VERSION && packet.version !== CLI_CASE_PACK_VERSION)
    || (packet.version === CLI_CASE_PACK_VERSION
      ? (root.version !== 13 && root.version !== CASE_SCHEMA_VERSION)
      : (root.version === 13 || root.version === CASE_SCHEMA_VERSION))
    || packet.reviewed !== true
    || (packet.audience !== 'internal'
      && packet.audience !== 'public'
      && packet.audience !== 'trusted')
    || !Array.isArray(packet.reports)
    || !redactionManifest
    || !Array.isArray(root.cases)
    || root.cases.length < 1
    || root.cases.length > MAX_CASE_PACK_CASES
    || packet.reports.length !== root.cases.length
    || typeof root.exportedAt !== 'string'
    || typeof root.version !== 'number'
    || !CASE_IMPORT_VERSIONS.includes(root.version as typeof CASE_IMPORT_VERSIONS[number])
    || !integrity
    || integrity.algorithm !== 'SHA-256'
    || typeof integrity.digestSha256 !== 'string'
    || !/^sha256:[a-f0-9]{64}$/u.test(integrity.digestSha256)) {
    throw new TypeError('The CLI case pack structure or integrity envelope is invalid.');
  }
  let canonicalization;
  try {
    canonicalization = resolveArtifactCanonicalization(
      packet.version,
      integrity.canonicalization,
      [
        { version: LEGACY_CLI_CASE_PACK_VERSION, canonicalization: SORTED_JSON_V1, explicit: true },
        { version: CLI_CASE_PACK_VERSION, canonicalization: SORTED_JSON_V2, explicit: true },
      ],
      'CLI case pack',
    );
  } catch {
    throw new TypeError('The CLI case pack structure or integrity envelope is invalid.');
  }
  const { integrity: _integrity, ...unsigned } = root;
  const audience = packet.audience as CasePackAudience;
  const current = root.version === CASE_SCHEMA_VERSION;
  const case13 = root.version === 13;
  const supportsBrandProfileReferences = root.version >= 12;
  assertClosedEnvelopes(root, packet, integrity, redactionManifest, packet.reports, supportsBrandProfileReferences);
  assertSensitiveFieldPlacement(root, supportsBrandProfileReferences, serialized.length);
  if (!Number.isSafeInteger(redactionManifest.sourceCaseCount)
    || redactionManifest.sourceCaseCount !== root.cases.length
    || !stringListsMatch(redactionManifest.excluded, expectedExclusions(audience, root.version))) {
    throw new TypeError('The CLI case pack has an invalid audience redaction manifest.');
  }
  const caseReferenceLists: string[][] = [];
  const reportReferenceLists: string[][] = [];
  if (!current && !case13) assertHistoricalCaseOwnKeys(root.cases, root.version);
  assertCanonicalCaseIdentities(root.cases, 'The CLI case pack');
  const normalised = normalizeCaseStore(root).cases;
  if (normalised.length !== root.cases.length) {
    throw new TypeError('The CLI case pack contains an invalid case collection.');
  }
  const normalisedByDomain = new Map(normalised.map((item) => [item.domain, item]));
  if (current) assertCurrentCaseProjection(root.cases, normalised, 'The CLI case pack');
  if (case13) assertCase13Projection(root.cases, normalised, 'The CLI case pack');
  for (let index = 0; index < root.cases.length; index++) {
    const rawCase = record(root.cases[index]);
    const report = record(packet.reports[index]);
    const reportCase = record(report?.case);
    const reportVersion = report?.schemaVersion;
    if (!rawCase
      || !report
      || !reportCase
      || typeof rawCase.domain !== 'string'
      || report.schema !== CASE_REPORT_SCHEMA
      || !reportVersionMatchesCase(root.version, reportVersion)
      || reportCase.id !== rawCase.id
      || reportCase.domain !== rawCase.domain) {
      throw new TypeError('The CLI case pack contains an invalid or mismatched Case report.');
    }
    const normalisedCase = normalisedByDomain.get(rawCase.domain);
    if (!normalisedCase) throw new TypeError('The CLI case pack contains an invalid case collection.');
    assertAudienceFields(rawCase, audience, root.version >= 11);
    if (root.version < 12) assertLegacyProfileContextEpoch(rawCase, report);
    if (supportsBrandProfileReferences) {
      try {
        if (!Object.hasOwn(rawCase, 'brandProfileIds') || !Object.hasOwn(reportCase, 'brandProfileIds')) throw new Error('missing');
        caseReferenceLists.push(assertCaseBrandProfileIds(rawCase.brandProfileIds));
        reportReferenceLists.push(assertCaseBrandProfileIds(reportCase.brandProfileIds));
      } catch {
        throw new TypeError('The CLI case pack contains invalid Brand Profile references.');
      }
    }
    if (current) {
      assertCurrentReportProjection(report, rawCase as unknown as CaseRecord);
    } else if (case13) {
      if (report.generatedAt !== root.exportedAt) {
        throw new TypeError('The CLI case pack contains an invalid or mismatched Case-13 report generation time.');
      }
      const expectedReport = {
        ...buildCaseReport(normalisedCase, {
          applicationVersion: reportApplicationVersion(report),
          includeNotes: false,
          generatedAt: root.exportedAt,
        }).json,
      };
      if (!canonicalValuesMatch(report, expectedReport)) {
        throw new TypeError('The CLI case pack contains an invalid or mismatched Case-13 report projection.');
      }
    } else {
      const historicalHistory = normalizeHistoricalEvidenceHistory(rawCase.evidenceHistory, root.version);
      const historicalResponse = historicalAnalystResponse(normalisedCase, root.version, reportVersion as number);
      assertProjectionKeys(rawCase, {
        ...normalisedCase,
        evidenceHistory: historicalHistory,
        ...(historicalResponse ?? {}),
      }, `cases[${index}]`);
      assertHistoricalCaseResponseEpoch(rawCase, normalisedCase, root.version, reportVersion as number, `cases[${index}]`);
      if (report.generatedAt !== root.exportedAt) {
        throw new TypeError('The CLI case pack contains an invalid or mismatched historical report generation time.');
      }
      const expectedReport = historicalReportProjection(
        normalisedCase,
        historicalHistory,
        report,
        root.version,
        reportVersion as number,
        root.exportedAt,
      );
      if (!canonicalValuesMatch(report, expectedReport)) {
        throw new TypeError('The CLI case pack contains an invalid or mismatched historical Case report projection.');
      }
    }
  }
  if (supportsBrandProfileReferences) {
    const omitted = redactionManifest.brandProfileReferencesOmitted;
    if (!Object.hasOwn(redactionManifest, 'brandProfileReferencesOmitted')
      || !Number.isSafeInteger(omitted)
      || (omitted as number) < 0
      || (omitted as number) > MAX_CASE_PACK_CASES * 8) {
      throw new TypeError('The CLI case pack has an invalid Brand Profile redaction manifest.');
    }
    const referencesMatch = caseReferenceLists.every((references, index) => {
      const reportReferences = reportReferenceLists[index];
      return reportReferences?.length === references.length
        && references.every((reference, referenceIndex) => reportReferences[referenceIndex] === reference);
    });
    if (audience === 'public') {
      if (caseReferenceLists.some((references) => references.length !== 0)
        || reportReferenceLists.some((references) => references.length !== 0)) {
        throw new TypeError('The public CLI case pack has an invalid Brand Profile redaction manifest.');
      }
    } else if (omitted !== 0 || !referencesMatch) {
      throw new TypeError('The trusted or internal CLI case pack has inconsistent Brand Profile references.');
    }
  } else if (Object.hasOwn(redactionManifest, 'brandProfileReferencesOmitted')) {
    throw new TypeError('The legacy CLI case pack has an invalid Brand Profile redaction manifest.');
  }
  let calculated: string;
  try {
    calculated = `sha256:${createHash('sha256').update(canonicalArtifactJsonFor(unsigned, canonicalization)).digest('hex')}`;
  } catch {
    throw new TypeError('The CLI case pack structure is not serializable.');
  }
  if (calculated !== integrity.digestSha256) {
    throw new TypeError('The CLI case pack failed its SHA-256 integrity check.');
  }
  return Object.freeze({ caseCount: normalised.length });
}

export function formatCliCasePack(document: ReturnType<typeof buildCliCasePack>): string {
  return [
    'Reviewed case pack',
    `Audience   ${document.packet.audience}`,
    `Cases      ${document.cases.length}`,
    `Reports    ${document.packet.reports.length}`,
    `Digest     ${document.integrity.digestSha256}`,
    '',
    ...document.packet.redactionManifest.excluded.map((item) => `Excluded: ${item}`),
    '',
  ].join('\n');
}
