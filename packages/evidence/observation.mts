// Compact provenance envelope for network-derived evidence. Type-specific
// payloads remain beside this object; the envelope only standardises source
// health, timing, completeness, truncation, and bounded limitations.

type ObservationStatus =
  | 'success'
  | 'partial'
  | 'not_found'
  | 'skipped'
  | 'error'
  | 'unsupported'
  | 'not_applicable';

type ScanMode = 'fast' | 'deep';

type DiagnosticValue = string | number | boolean | DiagnosticObject;

interface DiagnosticObject {
  [key: string]: DiagnosticValue;
}

type ObservationInput = {
  status?: unknown;
  observedAt?: unknown;
  scanMode?: unknown;
  source?: unknown;
  durationMs?: unknown;
  complete?: unknown;
  truncated?: unknown;
  limitations?: unknown;
  diagnostics?: unknown;
};

type Observation = {
  version: number;
  status: ObservationStatus;
  observedAt: string;
  scanMode: ScanMode | null;
  source: string;
  durationMs: number | null;
  complete: boolean;
  truncated: boolean;
  limitations: string[];
  diagnostics: Record<string, DiagnosticValue>;
};

type ObservationReadResult =
  | { state: 'absent' | 'invalid' | 'unsupported'; observation: null }
  | { state: 'supported'; observation: Observation };

const OBSERVATION_VERSION = 1;
const STATUSES = new Set<ObservationStatus>([
  'success',
  'partial',
  'not_found',
  'skipped',
  'error',
  'unsupported',
  'not_applicable',
]);
const SCAN_MODES = new Set<ScanMode>(['fast', 'deep']);
const MAX_OBSERVATION_LIMITATIONS = 10;
const MAX_OBSERVATION_LIMITATION_LENGTH = 300;
const MAX_OBSERVATION_DIAGNOSTICS = 20;
const MAX_DIAGNOSTICS = MAX_OBSERVATION_DIAGNOSTICS;
const MAX_DIAGNOSTIC_KEY = 40;
const MAX_DIAGNOSTIC_STRING = 240;
const MAX_DURATION_MS = 120_000;
const MAX_OBSERVATION_INPUT_LIMITATIONS = MAX_OBSERVATION_LIMITATIONS * 4;
const MAX_DIAGNOSTIC_DEPTH = 4;
const MAX_DIAGNOSTIC_VALUES_PER_ENTRY = 32;
const OBSERVATION_INPUT_FIELDS = [
  'version',
  'status',
  'observedAt',
  'scanMode',
  'source',
  'durationMs',
  'complete',
  'truncated',
  'limitations',
  'diagnostics',
] as const;
// Observation v1 diagnostics use a closed, source-owned vocabulary. Reading
// only these descriptors keeps normalisation independent of an untrusted
// object's total key count and preserves the deployed producer fields.
const REGISTERED_DIAGNOSTIC_KEYS = [
  'a',
  'aaaa',
  'addressSource',
  'advisoryMatches',
  'arrayItemsExamined',
  'attemptCount',
  'authorityCount',
  'caa',
  'caa_policy',
  'catalogComponents',
  'certificateGroups',
  'certificateGroupsTruncated',
  'certificateRows',
  'charactersExamined',
  'cidrCount',
  'classifiedInputs',
  'cname',
  'connectionAttempts',
  'delegation',
  'discarded',
  'discardedAuthorityRecordValueCount',
  'discardedFields',
  'discardedProperties',
  'discardedUrls',
  'discarded_attributes',
  'discarded_entities',
  'discarded_metadata',
  'discarded_relationships',
  'dmarc',
  'documentsParsed',
  'entities',
  'error',
  'externalScriptsSkipped',
  'findings',
  'formsObserved',
  'generatorEvaluated',
  'htmlEvaluated',
  'httpStatus',
  'https',
  'ignoredCount',
  'indicatorsObserved',
  'inlineCharactersExamined',
  'inlineScriptsExamined',
  'inlineSignatureCharactersExamined',
  'inlineSignatureTimedOut',
  'inlineSignatureUnavailable',
  'inputsObserved',
  'knownExploitedMatches',
  'lameAuthorityCount',
  'malformedCount',
  'malformedScripts',
  'matches',
  'mx',
  'namesExamined',
  'ns',
  'objectsExamined',
  'observed',
  'observedAbsence',
  'partialAuthorityCount',
  'passiveHeadersEvaluated',
  'potentialExposure',
  'ptr',
  'queriedAddressCount',
  'redirectCount',
  'referencesExamined',
  'rejectedRows',
  'relationshipTagsExamined',
  'relationshipUrlsDiscarded',
  'relationships',
  'requestCount',
  'resolvedAddressCount',
  'resourceOriginsEvaluated',
  'rolesObserved',
  'scriptElementsExamined',
  'scriptsExamined',
  'scriptsObserved',
  'serverEvaluated',
  'soa',
  'spf',
  'successfulAuthorityCount',
  'tagLimitReached',
  'tagsExamined',
  'trackingIdentifiersTruncated',
  'tree',
  'truncatedAuthorityRecordSetCount',
  'truncatedNames',
  'truncatedSameAsLists',
  'truncatedTypeLists',
  'unavailable',
  'unclassifiedActions',
  'unreachableAuthorityCount',
  'workTruncated',
] as const;
const ISO_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,43})?(Z|[+-]\d{2}:\d{2})$/iu;
const LEGACY_ISO_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,43})?(Z|[+-]\d{2}:\d{2})?$/iu;
const CT_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d{1,43})?(Z|[+-]\d{2}:\d{2})?$/iu;

function isObservationStatus(value: unknown): value is ObservationStatus {
  return typeof value === 'string' && STATUSES.has(value as ObservationStatus);
}

function isScanMode(value: unknown): value is ScanMode {
  return typeof value === 'string' && SCAN_MODES.has(value as ScanMode);
}

function safeString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || value.length > maxLength * 4) return null;
  const normalised = value.trim().replace(/[\u0000-\u001f\u007f]/g, ' ');
  return normalised ? normalised.slice(0, maxLength) : null;
}

function ownDataValue(value: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function snapshotObservationInput(value: object): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const field of OBSERVATION_INPUT_FIELDS) {
    const fieldValue = ownDataValue(value, field);
    if (fieldValue === undefined) continue;
    Object.defineProperty(snapshot, field, {
      configurable: true,
      enumerable: true,
      value: fieldValue,
      writable: true,
    });
  }
  return snapshot;
}

function safelyIsArray(value: unknown): boolean {
  try {
    return Array.isArray(value);
  } catch {
    return true;
  }
}

function boundedArrayDataValues(value: unknown, maximum: number): unknown[] {
  if (!safelyIsArray(value)) return [];
  const output: unknown[] = [];
  const rawLength = ownDataValue(value as unknown[], 'length');
  const length = typeof rawLength === 'number' && Number.isSafeInteger(rawLength) && rawLength >= 0
    ? Math.min(rawLength, maximum)
    : 0;
  for (let index = 0; index < length; index += 1) {
    const item = ownDataValue(value as unknown[], String(index));
    if (item !== undefined) output.push(item);
  }
  return output;
}

function validCalendarParts(parts: RegExpMatchArray): boolean {
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const hour = Number(parts[4]);
  const minute = Number(parts[5]);
  const second = Number(parts[6]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute
    && date.getUTCSeconds() === second;
}

function canonicalTimestamp(value: unknown, expression: RegExp, assignUtcWhenMissing: boolean): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64 || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const match = expression.exec(value);
  if (!match || !validCalendarParts(match)) return null;
  const zone = match[8] || (assignUtcWhenMissing ? 'Z' : '');
  if (!zone) return null;
  if (zone !== 'Z' && zone.toUpperCase() !== 'Z') {
    const hours = Number(zone.slice(1, 3));
    const minutes = Number(zone.slice(4, 6));
    if (hours > 23 || minutes > 59) return null;
  }
  const normalised = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${match[7] || ''}${zone.toUpperCase() === 'Z' ? 'Z' : zone}`;
  const timestamp = Date.parse(normalised);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  const utcYear = date.getUTCFullYear();
  return utcYear >= 1 && utcYear <= 9_999 ? date.toISOString() : null;
}

function normalizeExplicitIsoTimestamp(value: unknown): string | null {
  return canonicalTimestamp(value, ISO_DATE_TIME_RE, false);
}

// Frozen legacy schemas accepted zone-less ISO date-times. Preserve that
// migration path deterministically by assigning UTC instead of consulting the
// host timezone. Current schemas must use normalizeExplicitIsoTimestamp.
function normalizeLegacyIsoTimestamp(value: unknown): string | null {
  return canonicalTimestamp(value, LEGACY_ISO_DATE_TIME_RE, true);
}

function normalizeCtTimestamp(value: unknown): string | null {
  return canonicalTimestamp(value, CT_DATE_TIME_RE, true);
}

function isoTimestamp(value: unknown): string | null {
  return normalizeExplicitIsoTimestamp(value);
}

type DiagnosticBudget = {
  remaining: number;
  active: Set<object>;
  exhausted: boolean;
};

function normalizeDiagnosticValue(
  value: unknown,
  budget: DiagnosticBudget,
  depth = 0,
): DiagnosticValue | null {
  budget.remaining -= 1;
  if (budget.remaining < 0) {
    budget.exhausted = true;
    return null;
  }
  if (depth > MAX_DIAGNOSTIC_DEPTH) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return safeString(value, MAX_DIAGNOSTIC_STRING);
  if (!value || typeof value !== 'object' || safelyIsArray(value)) return null;
  const objectValue = value as object;
  if (budget.active.has(objectValue)) return null;

  const record = value as Record<string, unknown>;
  const output: Record<string, DiagnosticValue> = {};
  budget.active.add(objectValue);
  try {
    for (const field of ['status', 'error', 'detail', 'truncated', 'discarded', 'count']) {
      const fieldValue = ownDataValue(record, field);
      if (fieldValue === undefined) continue;
      const normalised = normalizeDiagnosticValue(fieldValue, budget, depth + 1);
      if (normalised !== null) {
        Object.defineProperty(output, field, {
          configurable: true,
          enumerable: true,
          value: normalised,
          writable: true,
        });
      }
    }
  } finally {
    budget.active.delete(objectValue);
  }
  return Object.keys(output).length ? output : null;
}

function normalizeDiagnostics(value: unknown): Record<string, DiagnosticValue> {
  if (!value || typeof value !== 'object' || safelyIsArray(value)) return {};

  const record = value as Record<string, unknown>;
  const output: Record<string, DiagnosticValue> = {};
  let retained = 0;
  for (const key of REGISTERED_DIAGNOSTIC_KEYS) {
    if (retained >= MAX_DIAGNOSTICS) break;
    if (key.length > MAX_DIAGNOSTIC_KEY) continue;
    const entryValue = ownDataValue(record, key);
    if (entryValue === undefined) continue;
    const budget: DiagnosticBudget = {
      remaining: MAX_DIAGNOSTIC_VALUES_PER_ENTRY,
      active: new Set(),
      exhausted: false,
    };
    const normalised = normalizeDiagnosticValue(entryValue, budget);
    if (normalised !== null && !budget.exhausted) {
      Object.defineProperty(output, key, {
        configurable: true,
        enumerable: true,
        value: normalised,
        writable: true,
      });
      retained += 1;
    }
  }
  return output;
}

function createObservationFromSnapshot(record: Record<string, unknown>): Observation {
  const rawStatus = record.status;
  const rawSource = record.source;
  const rawObservedAt = record.observedAt;
  const rawDuration = record.durationMs;
  const rawScanMode = record.scanMode;
  const status = isObservationStatus(rawStatus) ? rawStatus : 'error';
  const source = safeString(rawSource, 40) || 'unknown';
  const observedAt = isoTimestamp(rawObservedAt) || new Date().toISOString();
  const duration = typeof rawDuration === 'number' ? rawDuration : Number.NaN;
  const limitations = [...new Set(boundedArrayDataValues(
    record.limitations,
    MAX_OBSERVATION_INPUT_LIMITATIONS,
  )
    .map((item) => safeString(item, MAX_OBSERVATION_LIMITATION_LENGTH))
    .filter((item): item is string => item !== null))]
    .slice(0, MAX_OBSERVATION_LIMITATIONS);
  return {
    version: OBSERVATION_VERSION,
    status,
    observedAt,
    scanMode: isScanMode(rawScanMode) ? rawScanMode : null,
    source,
    durationMs: Number.isFinite(duration) ? Math.max(0, Math.min(MAX_DURATION_MS, Math.round(duration))) : null,
    complete: record.complete === true,
    truncated: record.truncated === true,
    limitations,
    diagnostics: normalizeDiagnostics(record.diagnostics),
  };
}

function createObservation(input: ObservationInput = {}): Observation {
  const record = input && typeof input === 'object' && !safelyIsArray(input)
    ? snapshotObservationInput(input)
    : {};
  return createObservationFromSnapshot(record);
}

function readObservationEnvelope(value: unknown): ObservationReadResult {
  if (value === undefined || value === null) return { state: 'absent', observation: null };
  if (!value || typeof value !== 'object' || safelyIsArray(value)) return { state: 'invalid', observation: null };

  const record = snapshotObservationInput(value);
  const version = record.version;
  const status = record.status;
  const source = record.source;
  const observedAt = record.observedAt;
  if (typeof version === 'number'
    && Number.isInteger(version)
    && version > OBSERVATION_VERSION) {
    return { state: 'unsupported', observation: null };
  }
  if (version !== OBSERVATION_VERSION
    || !isObservationStatus(status)
    || !safeString(source, 40)
    || !isoTimestamp(observedAt)) {
    return { state: 'invalid', observation: null };
  }
  return { state: 'supported', observation: createObservationFromSnapshot(record) };
}

export {
  MAX_OBSERVATION_DIAGNOSTICS,
  MAX_OBSERVATION_LIMITATIONS,
  MAX_OBSERVATION_LIMITATION_LENGTH,
  OBSERVATION_VERSION,
  createObservation,
  normalizeCtTimestamp,
  normalizeExplicitIsoTimestamp,
  normalizeLegacyIsoTimestamp,
  readObservationEnvelope,
};

export type {
  Observation,
  ObservationInput,
  ObservationReadResult,
  ObservationStatus,
  ScanMode,
};
