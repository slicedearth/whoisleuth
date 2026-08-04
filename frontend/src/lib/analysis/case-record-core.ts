// Pure, framework-neutral analyst-case records, evidence histories, bounded
// record normalization, and analyst updates.

import {
  CASE_DISPOSITIONS,
  CASE_REVIEW_REASONS,
  CASE_IMPORT_VERSIONS,
  CASE_SCHEMA_VERSION,
  CASE_SOURCES,
  CASE_STATUSES,
  DEFAULT_DISPOSITION,
  DEFAULT_SOURCE,
  DEFAULT_STATUS,
  EVIDENCE_SOURCES,
  MAX_CASES,
  MAX_CASE_IMPORT_BYTES,
  MAX_CASE_STORE_BYTES,
  MAX_DOMAIN_LENGTH,
  MAX_EVIDENCE_CHANGES,
  MAX_EVIDENCE_DETAIL_LENGTH,
  MAX_EVIDENCE_FACTORS,
  MAX_EVIDENCE_MUTATIONS,
  MAX_EVIDENCE_NAMESERVERS,
  MAX_EVIDENCE_SNAPSHOTS_PER_CASE,
  MAX_EVIDENCE_STRING_LENGTH,
  MAX_EVIDENCE_TITLE_LENGTH,
  MAX_NOTES_PER_CASE,
  MAX_NOTE_LENGTH,
  MAX_TAGS_PER_CASE,
  MAX_TAG_LENGTH,
  type CaseEvidenceMaterial,
  type CaseEvidenceSnapshot,
  type CaseInput,
  type CaseNote,
  type CasePatch,
  type CaseRecord,
  type CaseStore,
  type CompareFieldSpec,
  type EvidenceChange,
  type EvidenceFactor,
  type SnapshotOptions,
} from './case-record-contracts.ts';

// Forward-version policy (two distinct guarantees):
//   - A locally-stored envelope that declares a version greater than this is
//     still read best-effort on load (known fields kept, unknown dropped), but
//     is never OVERWRITTEN or exported as a downgraded backup (the storage
//     wrapper blocks the write/export). "Not overwritten", not "not read".
//   - An IMPORT file that declares a greater version is never INTERPRETED at
//     all: mergeCases rejects it up front so we don't merge data from a schema
//     we don't understand.
// The provenance recorded on an individual evidence snapshot. Distinct from a
// case's `source`: a snapshot can be imported, and a case opened by hand
// ('manual') has no snapshot provenance of its own.
export const EVIDENCE_SOURCE_SET = new Set(EVIDENCE_SOURCES);
export const DEFAULT_EVIDENCE_SOURCE = 'unknown';
// Deterministic "more informative source wins" order used when a materially
// identical capture is seen again from a different source. A direct scan beats
// a monitor bookmark beats a second-hand import beats unknown.
export const EVIDENCE_SOURCE_RANK = {
  lookup: 4,
  bulk: 4,
  monitor: 2,
  import: 1,
  unknown: 0,
};

const STATUS_VALUES: Set<string> = new Set(CASE_STATUSES.map((item) => item.value));
const DISPOSITION_VALUES: Set<string> = new Set(CASE_DISPOSITIONS.map((item) => item.value));
const REVIEW_REASON_VALUES: Set<string> = new Set(CASE_REVIEW_REASONS.map((item) => item.value).filter(Boolean));
const SOURCE_VALUES: Set<string> = new Set(CASE_SOURCES.map((item) => item.value));

const STATUS_LABELS = Object.fromEntries(CASE_STATUSES.map((item) => [item.value, item.label]));
const DISPOSITION_LABELS = Object.fromEntries(CASE_DISPOSITIONS.map((item) => [item.value, item.label]));
const SOURCE_LABELS = Object.fromEntries(CASE_SOURCES.map((item) => [item.value, item.label]));

// Availability tokens that actually assert something about the domain. Anything
// else ('unknown', 'error', empty) is not, on its own, material evidence.
export const CONCLUSIVE_AVAILABILITY = new Set([
  'available',
  'registered',
  'for_sale',
  'expiring',
]);
export const REGISTERED_LIKE = new Set([
  'registered',
  'for_sale',
  'expiring',
]);

// URL/DOM/query-string-safe id shape. UUIDs satisfy this; anything else is
// treated as untrusted and deterministically repaired.
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function statusLabel(value: unknown): string {
  return (typeof value === 'string' ? STATUS_LABELS[value] : '') || String(value || '');
}
export function dispositionLabel(value: unknown): string {
  return (typeof value === 'string' ? DISPOSITION_LABELS[value] : '') || String(value || '');
}
export function sourceLabel(value: unknown): string {
  return (typeof value === 'string' ? SOURCE_LABELS[value] : '') || String(value || '');
}

export function isValidStatus(value: unknown): value is string {
  return typeof value === 'string' && STATUS_VALUES.has(value);
}
export function isValidDisposition(value: unknown): value is string {
  return typeof value === 'string' && DISPOSITION_VALUES.has(value);
}

/** Fresh, safe, effectively-unique id for a brand-new local record. */
export function makeId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `case-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function safeId(value: unknown): string | null {
  return typeof value === 'string' && SAFE_ID_RE.test(value) ? value : null;
}

// Deterministic 32-bit FNV-1a hash -> base36, so a repaired id or evidence
// fingerprint is a pure function of its input (stable across normalization).
export function hashString(value: string): string {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}

export function deterministicId(domain: string): string {
  return `c-${hashString(domain)}`;
}

/**
 * Strict, canonical domain normalization. Parses through the WHATWG URL host
 * (which strips scheme/path/port/userinfo and applies IDNA/punycode so Unicode
 * and its punycode form collapse to one value), lowercases, drops a single
 * terminal root dot, and validates LDH hostname labels. Rejects IPs, ASNs,
 * whitespace/control characters, underscores, empty/overlong/hyphen-edged
 * labels, and undotted names. Returns '' for anything unusable.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeDomain(value: unknown): string {
  const raw = String(value == null ? '' : value).trim();
  if (!raw || /[\s\x00-\x1f\x7f]/.test(raw)) return '';
  let hostname;
  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
    hostname = new URL(hasScheme ? raw : `http://${raw}`).hostname;
  } catch {
    return '';
  }
  hostname = hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname.length > MAX_DOMAIN_LENGTH) return '';
  // A leftover ':' or '[' means a port/IPv6 the host parser preserved.
  if (hostname.includes(':') || hostname.startsWith('[')) return '';
  const labels = hostname.split('.');
  if (labels.length < 2) return '';
  const labelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  for (const label of labels) {
    if (!label || label.length > 63 || !labelPattern.test(label)) return '';
  }
  // An all-numeric final label is an IPv4 address, never a hostname TLD.
  if (/^[0-9]+$/.test(labels.at(-1) ?? '')) return '';
  return hostname;
}

export function normalizeStatus(value: unknown): string {
  return typeof value === 'string' && STATUS_VALUES.has(value) ? value : DEFAULT_STATUS;
}
export function normalizeDisposition(value: unknown): string {
  return typeof value === 'string' && DISPOSITION_VALUES.has(value) ? value : DEFAULT_DISPOSITION;
}
export function normalizeReviewReasonCode(value: unknown): string | null {
  return typeof value === 'string' && REVIEW_REASON_VALUES.has(value) ? value : null;
}
export function normalizeSource(value: unknown): string {
  return typeof value === 'string' && SOURCE_VALUES.has(value) ? value : DEFAULT_SOURCE;
}

/** Parsed ISO string, or null when missing/invalid (used for import ordering). */
export function isoOrNull(value: unknown): string | null {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}
export function isoOrNow(value: unknown, fallback: string): string {
  return isoOrNull(value) || fallback;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of value) {
    const tag = String(raw == null ? '' : raw).trim().slice(0, MAX_TAG_LENGTH);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= MAX_TAGS_PER_CASE) break;
  }
  return tags;
}

/**
 * @param {unknown} body
 * @returns {string}
 */
export function normalizeNoteBody(body: unknown): string {
  return String(body == null ? '' : body).trim().slice(0, MAX_NOTE_LENGTH);
}

/**
 * Normalizes one note deterministically. `createdAt` is the note's own valid
 * timestamp, else the supplied `fallback`; a note with neither is skipped rather
 * than stamped with an arbitrary time. Repaired ids are a pure function of the
 * body plus the resolved timestamp, so re-importing the same note produces the
 * same id (and therefore dedupes) instead of a fresh one.
 * @param {unknown} raw
 * @param {string | null} fallback
 * @returns {CaseNote | null}
 */
function normalizeNote(raw: unknown, fallback: string | null): CaseNote | null {
  const record = objectRecord(raw);
  const body = normalizeNoteBody(record.body);
  if (!body) return null;
  const createdAt = isoOrNull(record.createdAt) || fallback;
  if (!createdAt) return null;
  return {
    id: safeId(record.id) || `n-${hashString(`${body}|${createdAt}`)}`,
    body,
    createdAt,
  };
}

/**
 * @param {unknown} value
 * @param {string | null} fallback timestamp for notes lacking their own (the
 *   genuine "now" for local recovery; only the imported record's own createdAt/
 *   updatedAt for imports, never the current time)
 * @returns {CaseNote[]}
 */
export function normalizeNotes(value: unknown, fallback: string | null): CaseNote[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const notes: CaseNote[] = [];
  for (const raw of value) {
    const note = normalizeNote(raw, fallback);
    if (!note || seen.has(note.id)) continue;
    seen.add(note.id);
    notes.push(note);
  }
  notes.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  // Keep the most recent notes when over the bound.
  return notes.slice(Math.max(0, notes.length - MAX_NOTES_PER_CASE));
}

// ---------------------------------------------------------------------------
// Evidence snapshot normalization
// ---------------------------------------------------------------------------
