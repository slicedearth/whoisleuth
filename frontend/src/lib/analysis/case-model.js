// Pure, framework-neutral analyst-case logic: schema constants, strict domain
// normalization, field-by-field validation, create/update helpers, store
// bounding + corruption recovery, import merge, and export shaping. All
// localStorage/DOM access lives in the ../cases.ts wrapper so this module stays
// node --test-able and free of any browser globals.

export const CASE_SCHEMA_VERSION = 1;

export const MAX_CASES = 500;
export const MAX_NOTES_PER_CASE = 50;
export const MAX_NOTE_LENGTH = 2000;
export const MAX_TAGS_PER_CASE = 20;
export const MAX_TAG_LENGTH = 40;
export const MAX_DOMAIN_LENGTH = 253;
export const MAX_CASE_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_EVIDENCE_STRING_LENGTH = 200;

// Stable machine values are stored; labels are only ever used for display.
export const CASE_STATUSES = [
  { value: 'new', label: 'New' },
  { value: 'reviewing', label: 'Reviewing' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'resolved', label: 'Resolved' },
];

export const CASE_DISPOSITIONS = [
  { value: 'unreviewed', label: 'Unreviewed' },
  { value: 'suspicious', label: 'Suspicious' },
  { value: 'confirmed_abuse', label: 'Confirmed abuse' },
  { value: 'false_positive', label: 'False positive' },
  { value: 'expected', label: 'Expected' },
  { value: 'closed_no_action', label: 'Closed without action' },
];

export const CASE_SOURCES = [
  { value: 'lookup', label: 'Lookup' },
  { value: 'bulk', label: 'Bulk' },
  { value: 'monitor', label: 'Monitor' },
  { value: 'manual', label: 'Manual' },
  { value: 'unknown', label: 'Unknown' },
];

export const DEFAULT_STATUS = 'new';
export const DEFAULT_DISPOSITION = 'unreviewed';
export const DEFAULT_SOURCE = 'unknown';

const STATUS_VALUES = new Set(CASE_STATUSES.map((item) => item.value));
const DISPOSITION_VALUES = new Set(CASE_DISPOSITIONS.map((item) => item.value));
const SOURCE_VALUES = new Set(CASE_SOURCES.map((item) => item.value));

const STATUS_LABELS = Object.fromEntries(CASE_STATUSES.map((item) => [item.value, item.label]));
const DISPOSITION_LABELS = Object.fromEntries(CASE_DISPOSITIONS.map((item) => [item.value, item.label]));
const SOURCE_LABELS = Object.fromEntries(CASE_SOURCES.map((item) => [item.value, item.label]));

// URL/DOM/query-string-safe id shape. UUIDs satisfy this; anything else is
// treated as untrusted and deterministically repaired.
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * @typedef {{ id: string, body: string, createdAt: string }} CaseNote
 * @typedef {{ availability: string | null, riskScore: number | null, registrar: string | null, activityStatus: string | null, capturedAt: string }} CaseEvidence
 * @typedef {{ id: string, domain: string, status: string, disposition: string, tags: string[], notes: CaseNote[], source: string, evidence: CaseEvidence | null, createdAt: string, updatedAt: string }} CaseRecord
 * @typedef {{ version: number, cases: CaseRecord[] }} CaseStore
 */

export function statusLabel(value) {
  return STATUS_LABELS[value] || String(value || '');
}
export function dispositionLabel(value) {
  return DISPOSITION_LABELS[value] || String(value || '');
}
export function sourceLabel(value) {
  return SOURCE_LABELS[value] || String(value || '');
}

export function isValidStatus(value) {
  return STATUS_VALUES.has(value);
}
export function isValidDisposition(value) {
  return DISPOSITION_VALUES.has(value);
}

/** Fresh, safe, effectively-unique id for a brand-new local record. */
export function makeId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `case-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeId(value) {
  return typeof value === 'string' && SAFE_ID_RE.test(value) ? value : null;
}

// Deterministic 32-bit FNV-1a hash -> base36, so a repaired id is a pure
// function of its input (stable across repeated normalization).
function hashString(value) {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}

function deterministicId(domain) {
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
export function normalizeDomain(value) {
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
  if (/^[0-9]+$/.test(labels[labels.length - 1])) return '';
  return hostname;
}

function normalizeStatus(value) {
  return STATUS_VALUES.has(value) ? value : DEFAULT_STATUS;
}
function normalizeDisposition(value) {
  return DISPOSITION_VALUES.has(value) ? value : DEFAULT_DISPOSITION;
}
function normalizeSource(value) {
  return SOURCE_VALUES.has(value) ? value : DEFAULT_SOURCE;
}

/** Parsed ISO string, or null when missing/invalid (used for import ordering). */
function isoOrNull(value) {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}
function isoOrNow(value, fallback) {
  return isoOrNull(value) || fallback;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const tags = [];
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
export function normalizeNoteBody(body) {
  return String(body == null ? '' : body).trim().slice(0, MAX_NOTE_LENGTH);
}

/**
 * @param {unknown} raw
 * @param {string} now
 * @returns {CaseNote | null}
 */
function normalizeNote(raw, now) {
  const record = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const body = normalizeNoteBody(record.body);
  if (!body) return null;
  return {
    id: safeId(record.id) || `n-${hashString(`${body}|${String(record.createdAt || now)}`)}`,
    body,
    createdAt: isoOrNow(record.createdAt, now),
  };
}

/**
 * @param {unknown} value
 * @param {string} now
 * @returns {CaseNote[]}
 */
function normalizeNotes(value, now) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const notes = [];
  for (const raw of value) {
    const note = normalizeNote(raw, now);
    if (!note || seen.has(note.id)) continue;
    seen.add(note.id);
    notes.push(note);
  }
  notes.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  // Keep the most recent notes when over the bound.
  return notes.slice(Math.max(0, notes.length - MAX_NOTES_PER_CASE));
}

function evidenceString(value) {
  if (value == null) return null;
  const text = String(value).trim().slice(0, MAX_EVIDENCE_STRING_LENGTH);
  return text || null;
}

/**
 * Bounded snapshot of the latest locally-available result. Deliberately a
 * small fixed set of scalars - never the raw registry/RDAP/WHOIS response.
 * @param {unknown} raw
 * @param {string} now
 * @returns {CaseEvidence | null}
 */
export function normalizeEvidence(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const record = /** @type {Record<string, unknown>} */ (raw);
  const availability = evidenceString(record.availability);
  const registrar = evidenceString(record.registrar);
  const activityStatus = evidenceString(record.activityStatus);
  const riskScore =
    typeof record.riskScore === 'number' && Number.isFinite(record.riskScore)
      ? Math.max(0, Math.min(100, Math.round(record.riskScore)))
      : null;
  if (availability === null && registrar === null && activityStatus === null && riskScore === null) {
    return null;
  }
  return { availability, riskScore, registrar, activityStatus, capturedAt: isoOrNow(record.capturedAt, now) };
}

/**
 * Validates a single case field-by-field for LOCAL recovery: missing scalars
 * and timestamps are defaulted so our own stored data always loads. Returns
 * null when the record has no usable domain. An `existing` record preserves
 * stable identity/timestamps across an update. Import validation is separate
 * (see mergeCases) so a defaulted value can never win over local data.
 * @param {unknown} raw
 * @param {CaseRecord} [existing]
 * @param {string} [nowIso]
 * @returns {CaseRecord | null}
 */
export function normalizeCase(raw, existing, nowIso) {
  const now = nowIso || new Date().toISOString();
  const record = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const domain = normalizeDomain(existing ? existing.domain : record.domain);
  if (!domain) return null;
  const createdAt = existing ? existing.createdAt : isoOrNow(record.createdAt, now);
  return {
    id: existing ? existing.id : safeId(record.id) || deterministicId(domain),
    domain,
    status: normalizeStatus(record.status),
    disposition: normalizeDisposition(record.disposition),
    tags: normalizeTags(record.tags),
    notes: normalizeNotes(record.notes, now),
    source: normalizeSource(record.source),
    evidence: normalizeEvidence(record.evidence, now),
    createdAt,
    updatedAt: isoOrNow(record.updatedAt, now),
  };
}

/**
 * Assigns a unique, safe id to every record, in place, processing in canonical
 * domain order so the repair is deterministic across repeated normalization.
 * @param {CaseRecord[]} cases
 */
function assignUniqueIds(cases) {
  const used = new Set();
  for (const record of [...cases].sort((a, b) => a.domain.localeCompare(b.domain))) {
    let id = safeId(record.id) || deterministicId(record.domain);
    if (used.has(id)) {
      const base = deterministicId(record.domain);
      id = base;
      let suffix = 2;
      while (used.has(id)) id = `${base}-${suffix++}`;
    }
    used.add(id);
    record.id = id;
  }
}

/**
 * Recovers a clean, bounded store from an arbitrary parsed value. Accepts the
 * versioned envelope or a bare array, drops malformed records, keeps a single
 * case per domain (most recently updated wins), caps to MAX_CASES by recency,
 * and guarantees globally unique safe ids. Never throws.
 * @param {unknown} raw
 * @returns {CaseStore}
 */
export function normalizeCaseStore(raw) {
  const now = new Date().toISOString();
  /** @type {Map<string, CaseRecord>} */
  const byDomain = new Map();
  for (const item of asCaseList(raw)) {
    const normalized = normalizeCase(item, undefined, now);
    if (!normalized) continue;
    const existing = byDomain.get(normalized.domain);
    if (!existing || Date.parse(normalized.updatedAt) >= Date.parse(existing.updatedAt)) {
      byDomain.set(normalized.domain, normalized);
    }
  }
  const cases = [...byDomain.values()]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, MAX_CASES);
  assignUniqueIds(cases);
  return { version: CASE_SCHEMA_VERSION, cases };
}

/** @param {unknown} raw @returns {unknown[]} */
function asCaseList(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(/** @type {Record<string, unknown>} */ (raw).cases)) {
    return /** @type {unknown[]} */ (/** @type {Record<string, unknown>} */ (raw).cases);
  }
  return [];
}

/**
 * @param {{ domain: unknown, status?: unknown, disposition?: unknown, source?: unknown, tags?: unknown, evidence?: unknown, note?: unknown }} input
 * @param {string} [nowIso]
 * @returns {CaseRecord}
 */
export function createCase(input, nowIso) {
  const now = nowIso || new Date().toISOString();
  const domain = normalizeDomain(input.domain);
  if (!domain) throw new Error('A valid domain is required to open a case.');
  const noteBody = normalizeNoteBody(input.note);
  return {
    id: makeId(),
    domain,
    status: normalizeStatus(input.status),
    disposition: normalizeDisposition(input.disposition),
    tags: normalizeTags(input.tags),
    notes: noteBody ? [{ id: makeId(), body: noteBody, createdAt: now }] : [],
    source: normalizeSource(input.source),
    evidence: normalizeEvidence(input.evidence, now),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Opens the existing case for a domain, or creates one. Returns a new array
 * (callers persist it) plus the resolved record and whether it was created.
 * @param {CaseRecord[]} cases
 * @param {{ domain: unknown, status?: unknown, disposition?: unknown, source?: unknown, tags?: unknown, evidence?: unknown, note?: unknown }} input
 * @param {string} [nowIso]
 * @returns {{ cases: CaseRecord[], record: CaseRecord, created: boolean }}
 */
export function openOrCreateCase(cases, input, nowIso) {
  const domain = normalizeDomain(input.domain);
  if (!domain) throw new Error('A valid domain is required to open a case.');
  const existing = cases.find((item) => item.domain === domain);
  if (existing) return { cases, record: existing, created: false };
  if (cases.length >= MAX_CASES) throw new Error(`Cases are limited to ${MAX_CASES}. Delete or export some first.`);
  const record = createCase({ ...input, domain }, nowIso);
  return { cases: [record, ...cases], record, created: true };
}

/**
 * Applies a partial update to one case by id, bumping updatedAt. A `note` in
 * the patch is appended (respecting the per-case note bound); a `tags` array
 * replaces the tag set. Returns a new array and the updated record.
 * @param {CaseRecord[]} cases
 * @param {string} id
 * @param {{ status?: unknown, disposition?: unknown, tags?: unknown, source?: unknown, evidence?: unknown, note?: unknown }} patch
 * @param {string} [nowIso]
 * @returns {{ cases: CaseRecord[], record: CaseRecord }}
 */
export function updateCase(cases, id, patch, nowIso) {
  const now = nowIso || new Date().toISOString();
  const index = cases.findIndex((item) => item.id === id);
  if (index < 0) throw new Error('That case no longer exists.');
  const current = cases[index];
  let notes = current.notes;
  if (patch.note !== undefined) {
    const body = normalizeNoteBody(patch.note);
    if (!body) throw new Error('A note cannot be empty.');
    if (notes.length >= MAX_NOTES_PER_CASE) {
      throw new Error(`Each case is limited to ${MAX_NOTES_PER_CASE} notes.`);
    }
    notes = [...notes, { id: makeId(), body, createdAt: now }];
  }
  /** @type {CaseRecord} */
  const record = {
    ...current,
    status: patch.status !== undefined ? normalizeStatus(patch.status) : current.status,
    disposition: patch.disposition !== undefined ? normalizeDisposition(patch.disposition) : current.disposition,
    tags: patch.tags !== undefined ? normalizeTags(patch.tags) : current.tags,
    source: patch.source !== undefined ? normalizeSource(patch.source) : current.source,
    evidence: patch.evidence !== undefined ? normalizeEvidence(patch.evidence, now) : current.evidence,
    notes,
    updatedAt: now,
  };
  const next = [...cases];
  next[index] = record;
  return { cases: next, record };
}

/**
 * @typedef {{ domain: string, rawId: string | null, status: string | undefined, disposition: string | undefined, source: string | undefined, evidence: CaseEvidence | null, tags: string[], notes: CaseNote[], createdAt: string | null, updatedAt: string | null }} ImportPatch
 */

/**
 * A valid, present machine value or undefined - never a default. Keeps import
 * validation distinct from local recovery.
 * @param {unknown} value
 * @param {Set<string>} valid
 * @returns {string | undefined}
 */
function importScalar(value, valid) {
  return typeof value === 'string' && valid.has(value) ? value : undefined;
}

/**
 * Validates one imported record into a patch. Unlike normalizeCase, absent or
 * invalid scalar fields stay `undefined` (never defaulted) and a missing/invalid
 * updatedAt stays `null` (treated as older than any real local timestamp), so an
 * incomplete import can never win a merge over valid local data.
 * @param {unknown} raw
 * @param {string} now
 * @returns {ImportPatch | null}
 */
function extractImportPatch(raw, now) {
  const record = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const domain = normalizeDomain(record.domain);
  if (!domain) return null;
  return {
    domain,
    rawId: typeof record.id === 'string' ? record.id : null,
    status: importScalar(record.status, STATUS_VALUES),
    disposition: importScalar(record.disposition, DISPOSITION_VALUES),
    source: importScalar(record.source, SOURCE_VALUES),
    evidence: normalizeEvidence(record.evidence, now),
    tags: normalizeTags(record.tags),
    notes: normalizeNotes(record.notes, now),
    createdAt: isoOrNull(record.createdAt),
    updatedAt: isoOrNull(record.updatedAt),
  };
}

/** @param {CaseNote[]} a @param {CaseNote[]} b @returns {CaseNote[]} */
function unionNotes(a, b) {
  const byId = new Map();
  for (const note of [...a, ...b]) {
    if (!byId.has(note.id)) byId.set(note.id, note);
  }
  const notes = [...byId.values()].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  return notes.slice(Math.max(0, notes.length - MAX_NOTES_PER_CASE));
}

/** @param {ImportPatch} patch @param {string} now @returns {CaseRecord} */
function caseFromPatch(patch, now) {
  return {
    id: '', // assigned by mergeCases so it can guarantee uniqueness against locals
    domain: patch.domain,
    status: patch.status ?? DEFAULT_STATUS,
    disposition: patch.disposition ?? DEFAULT_DISPOSITION,
    tags: patch.tags,
    notes: patch.notes,
    source: patch.source ?? DEFAULT_SOURCE,
    evidence: patch.evidence,
    createdAt: patch.createdAt || patch.updatedAt || now,
    updatedAt: patch.updatedAt || patch.createdAt || now,
  };
}

/**
 * Merges an imported patch into an existing local case. Notes and tags are
 * unioned unconditionally (additive, never destructive); a scalar field is only
 * overwritten when the import provided a valid value AND is strictly newer than
 * the local record. A patch with no/invalid updatedAt is never newer.
 * @param {CaseRecord} local
 * @param {ImportPatch} patch
 * @returns {CaseRecord}
 */
function applyImportPatch(local, patch) {
  const importNewer = patch.updatedAt !== null && Date.parse(patch.updatedAt) > Date.parse(local.updatedAt);
  return {
    ...local,
    status: patch.status !== undefined && importNewer ? patch.status : local.status,
    disposition: patch.disposition !== undefined && importNewer ? patch.disposition : local.disposition,
    source: patch.source !== undefined && importNewer ? patch.source : local.source,
    evidence: patch.evidence !== null && importNewer ? patch.evidence : local.evidence,
    tags: normalizeTags([...local.tags, ...patch.tags]),
    notes: unionNotes(local.notes, patch.notes),
    createdAt: patch.createdAt && Date.parse(patch.createdAt) < Date.parse(local.createdAt) ? patch.createdAt : local.createdAt,
    updatedAt: importNewer ? /** @type {string} */ (patch.updatedAt) : local.updatedAt,
  };
}

function pickFreeId(preferred, domain, used) {
  const wanted = safeId(preferred);
  let id = wanted && !used.has(wanted) ? wanted : deterministicId(domain);
  const base = deterministicId(domain);
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  return id;
}

/**
 * Merges an imported (already parsed) value into the local cases. Predictable
 * and idempotent: unknown records are skipped, existing domains merge without
 * losing newer local decisions, and new ones are added until the store bound is
 * reached.
 * @param {CaseRecord[]} localCases
 * @param {unknown} importedRaw
 * @returns {{ cases: CaseRecord[], added: number, updated: number, skipped: number }}
 */
export function mergeCases(localCases, importedRaw) {
  const now = new Date().toISOString();
  const local = normalizeCaseStore(localCases).cases;
  const byDomain = new Map(local.map((item) => [item.domain, item]));
  const usedIds = new Set(local.map((item) => item.id));
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const item of asCaseList(importedRaw)) {
    const patch = extractImportPatch(item, now);
    if (!patch) {
      skipped += 1;
      continue;
    }
    const existing = byDomain.get(patch.domain);
    if (existing) {
      byDomain.set(patch.domain, applyImportPatch(existing, patch));
      updated += 1;
    } else if (byDomain.size < MAX_CASES) {
      const record = caseFromPatch(patch, now);
      record.id = pickFreeId(patch.rawId, patch.domain, usedIds);
      usedIds.add(record.id);
      byDomain.set(patch.domain, record);
      added += 1;
    } else {
      skipped += 1;
    }
  }
  return { cases: normalizeCaseStore([...byDomain.values()]).cases, added, updated, skipped };
}

/**
 * Portable export payload: schema version, export timestamp, and clean cases.
 * @param {CaseRecord[]} cases
 * @param {string} [nowIso]
 * @returns {{ version: number, exportedAt: string, cases: CaseRecord[] }}
 */
export function buildCaseExport(cases, nowIso) {
  return {
    version: CASE_SCHEMA_VERSION,
    exportedAt: nowIso || new Date().toISOString(),
    cases: normalizeCaseStore(cases).cases,
  };
}
