// Compact provenance envelope for network-derived evidence. Type-specific
// payloads remain beside this object; the envelope only standardizes source
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
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, ' ');
  return normalized ? normalized.slice(0, maxLength) : null;
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
  const normalized = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${match[7] || ''}${zone.toUpperCase() === 'Z' ? 'Z' : zone}`;
  const timestamp = Date.parse(normalized);
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

function normalizeDiagnosticValue(value: unknown): DiagnosticValue | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return safeString(value, MAX_DIAGNOSTIC_STRING);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const output: Record<string, DiagnosticValue> = {};
  for (const field of ['status', 'error', 'detail', 'truncated', 'discarded', 'count']) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) continue;
    const normalized = normalizeDiagnosticValue(record[field]);
    if (normalized !== null) output[field] = normalized;
  }
  return Object.keys(output).length ? output : null;
}

function normalizeDiagnostics(value: unknown): Record<string, DiagnosticValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const record = value as Record<string, unknown>;
  const output: Record<string, DiagnosticValue> = {};
  for (const key of Object.keys(record).sort().slice(0, MAX_DIAGNOSTICS)) {
    if (!key || key.length > MAX_DIAGNOSTIC_KEY || !/^[a-z0-9_-]+$/i.test(key)) continue;
    const normalized = normalizeDiagnosticValue(record[key]);
    if (normalized !== null) output[key] = normalized;
  }
  return output;
}

function createObservation(input: ObservationInput = {}): Observation {
  const status = isObservationStatus(input.status) ? input.status : 'error';
  const source = safeString(input.source, 40) || 'unknown';
  const observedAt = isoTimestamp(input.observedAt) || new Date().toISOString();
  const duration = Number(input.durationMs);
  const limitations = [...new Set((Array.isArray(input.limitations) ? input.limitations : [])
    .map((item) => safeString(item, MAX_OBSERVATION_LIMITATION_LENGTH))
    .filter((item): item is string => item !== null))]
    .slice(0, MAX_OBSERVATION_LIMITATIONS);
  return {
    version: OBSERVATION_VERSION,
    status,
    observedAt,
    scanMode: isScanMode(input.scanMode) ? input.scanMode : null,
    source,
    durationMs: Number.isFinite(duration) ? Math.max(0, Math.min(MAX_DURATION_MS, Math.round(duration))) : null,
    complete: input.complete === true,
    truncated: input.truncated === true,
    limitations,
    diagnostics: normalizeDiagnostics(input.diagnostics),
  };
}

function readObservationEnvelope(value: unknown): ObservationReadResult {
  if (value === undefined || value === null) return { state: 'absent', observation: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { state: 'invalid', observation: null };

  const record = value as Record<string, unknown>;
  if (typeof record.version === 'number'
    && Number.isInteger(record.version)
    && record.version > OBSERVATION_VERSION) {
    return { state: 'unsupported', observation: null };
  }
  if (record.version !== OBSERVATION_VERSION
    || !isObservationStatus(record.status)
    || !safeString(record.source, 40)
    || !isoTimestamp(record.observedAt)) {
    return { state: 'invalid', observation: null };
  }
  return { state: 'supported', observation: createObservation(record) };
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
