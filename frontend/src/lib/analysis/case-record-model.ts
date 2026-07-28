// Pure, framework-neutral analyst-case records, evidence histories, bounded
// record normalization, and analyst updates.

import { normalizeHttpSummary } from './http-summary.ts';
import { normalizeRiskModelVersion } from './scoring.ts';
import {
  appendCaseAction,
  appendCaseAssertion,
  appendCaseDecision,
  appendCaseEvidencePin,
  appendCaseEvidencePins,
  appendCaseManualTrailEvent,
  normalizeCaseActions,
  normalizeCaseAssertions,
  normalizeCaseDecisions,
  normalizeCaseEvidencePins,
  normalizeCaseManualTrail,
  updateCaseAction,
  updateCaseAssertion,
  type CaseActionRecord,
  type CaseAssertionRecord,
  type CaseDecisionRecord,
  type CaseEvidencePin,
  type CaseManualTrailEvent,
} from './case-response-model.ts';

// Forward-version policy (two distinct guarantees):
//   - A locally-stored envelope that declares a version greater than this is
//     still read best-effort on load (known fields kept, unknown dropped), but
//     is never OVERWRITTEN or exported as a downgraded backup (the storage
//     wrapper blocks the write/export). "Not overwritten", not "not read".
//   - An IMPORT file that declares a greater version is never INTERPRETED at
//     all: mergeCases rejects it up front so we don't merge data from a schema
//     we don't understand.
export const CASE_SCHEMA_VERSION = 7;
export const CASE_IMPORT_VERSIONS = [3, 4, 5, 6, CASE_SCHEMA_VERSION] as const;

export const MAX_CASES = 500;
export const MAX_NOTES_PER_CASE = 50;
export const MAX_NOTE_LENGTH = 2000;
export const MAX_TAGS_PER_CASE = 20;
export const MAX_TAG_LENGTH = 40;
export const MAX_DOMAIN_LENGTH = 253;
export const MAX_CASE_IMPORT_BYTES = 2 * 1024 * 1024;

// Evidence-history bounds. Kept conservative so a case's timeline can never
// dominate the store, and so a single imported snapshot cannot smuggle in an
// unbounded string/array.
export const MAX_EVIDENCE_SNAPSHOTS_PER_CASE = 25;
export const MAX_EVIDENCE_FACTORS = 20; // per factor family (risk / opportunity)
export const MAX_EVIDENCE_NAMESERVERS = 12;
export const MAX_EVIDENCE_MUTATIONS = 20;
export const MAX_EVIDENCE_STRING_LENGTH = 200;
export const MAX_EVIDENCE_TITLE_LENGTH = 200;
export const MAX_EVIDENCE_DETAIL_LENGTH = 200;
export const MAX_EVIDENCE_CHANGES = 40;
// Whole-store serialized byte budget. Four megabytes leaves headroom for the
// other collections that share the origin's browser-storage quota.
export const MAX_CASE_STORE_BYTES = 4 * 1024 * 1024;

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

// The provenance recorded on an individual evidence snapshot. Distinct from a
// case's `source`: a snapshot can be imported, and a case opened by hand
// ('manual') has no snapshot provenance of its own.
export const EVIDENCE_SOURCES = ['lookup', 'bulk', 'monitor', 'import', 'unknown'];
const EVIDENCE_SOURCE_SET = new Set(EVIDENCE_SOURCES);
const DEFAULT_EVIDENCE_SOURCE = 'unknown';
// Deterministic "more informative source wins" order used when a materially
// identical capture is seen again from a different source. A direct scan beats
// a monitor bookmark beats a second-hand import beats unknown.
const EVIDENCE_SOURCE_RANK = { lookup: 4, bulk: 4, monitor: 2, import: 1, unknown: 0 };

export const DEFAULT_STATUS = 'new';
export const DEFAULT_DISPOSITION = 'unreviewed';
export const DEFAULT_SOURCE = 'unknown';

const STATUS_VALUES = new Set(CASE_STATUSES.map((item) => item.value));
const DISPOSITION_VALUES = new Set(CASE_DISPOSITIONS.map((item) => item.value));
const SOURCE_VALUES = new Set(CASE_SOURCES.map((item) => item.value));

const STATUS_LABELS = Object.fromEntries(CASE_STATUSES.map((item) => [item.value, item.label]));
const DISPOSITION_LABELS = Object.fromEntries(CASE_DISPOSITIONS.map((item) => [item.value, item.label]));
const SOURCE_LABELS = Object.fromEntries(CASE_SOURCES.map((item) => [item.value, item.label]));

// Availability tokens that actually assert something about the domain. Anything
// else ('unknown', 'error', empty) is not, on its own, material evidence.
const CONCLUSIVE_AVAILABILITY = new Set(['available', 'registered', 'for_sale', 'expiring']);
const REGISTERED_LIKE = new Set(['registered', 'for_sale', 'expiring']);

// URL/DOM/query-string-safe id shape. UUIDs satisfy this; anything else is
// treated as untrusted and deterministically repaired.
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type CaseNote = { id: string; body: string; createdAt: string };
export type EvidenceFactor = { label: string; points: number };
export type CaseEvidenceSnapshot = {
  id: string;
  fingerprint: string;
  firstCapturedAt: string;
  capturedAt: string;
  source: string;
  scanDepth: string;
  availability: string | null;
  confidence: string | null;
  riskModelVersion: number | null;
  riskScore: number | null;
  opportunityScore: number | null;
  riskFactors: EvidenceFactor[];
  opportunityFactors: EvidenceFactor[];
  registrar: string | null;
  createdDate: string | null;
  expiryDate: string | null;
  nameservers: string[];
  hasMx: boolean | null;
  hasSpf: boolean | null;
  hasDmarc: boolean | null;
  activityStatus: string | null;
  websiteProbeDetail: string | null;
  pageTitle: string | null;
  httpSummaryVersion: number | null;
  httpEvidenceStatus: string | null;
  httpFinalOrigin: string | null;
  httpResponseStatus: number | null;
  httpTransportSecurity: string | null;
  httpRedirectCount: number | null;
  httpCrossOriginRedirect: boolean | null;
  httpHttpsDowngrade: boolean | null;
  httpContentType: string | null;
  httpSecurityHeaders: string[] | null;
  faviconMatch: boolean | null;
  faviconNearMatch: boolean | null;
  reusesOfficialAssets: boolean | null;
  hasPasswordField: boolean | null;
  phishingLanguageMatch: string | null;
  mutationTypes: string[];
};
type CaseEvidenceMaterial = Omit<CaseEvidenceSnapshot, 'id' | 'fingerprint' | 'firstCapturedAt' | 'capturedAt' | 'source'>;
export type CaseRecord = {
  id: string;
  domain: string;
  status: string;
  disposition: string;
  tags: string[];
  notes: CaseNote[];
  source: string;
  evidenceHistory: CaseEvidenceSnapshot[];
  evidencePins: CaseEvidencePin[];
  decisions: CaseDecisionRecord[];
  actions: CaseActionRecord[];
  assertions: CaseAssertionRecord[];
  manualTrail: CaseManualTrailEvent[];
  createdAt: string;
  updatedAt: string;
};
export type CaseStore = { version: typeof CASE_SCHEMA_VERSION; cases: CaseRecord[] };
export type CaseInput = {
  domain: unknown;
  status?: unknown;
  disposition?: unknown;
  source?: unknown;
  tags?: unknown;
  evidence?: unknown;
  evidencePin?: unknown;
  evidencePins?: unknown;
  decision?: unknown;
  action?: unknown;
  actionUpdate?: unknown;
  assertion?: unknown;
  assertionUpdate?: unknown;
  trailEvent?: unknown;
  note?: unknown;
};
export type CasePatch = Omit<Partial<CaseInput>, 'domain'>;
type SnapshotOptions = { source?: string; fallback?: string | null };
type EvidenceChange = { field: string; label: string; before: unknown; after: unknown; tone: string };
type CompareFieldSpec = {
  field: keyof CaseEvidenceSnapshot;
  label: string;
  type: string;
  depthGate?: 'both-deep' | 'comparable';
  modelGate?: 'risk';
  direction?: 'risk';
  emptyGuard?: boolean;
};

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
function hashString(value: string): string {
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

function normalizeStatus(value: unknown): string {
  return typeof value === 'string' && STATUS_VALUES.has(value) ? value : DEFAULT_STATUS;
}
function normalizeDisposition(value: unknown): string {
  return typeof value === 'string' && DISPOSITION_VALUES.has(value) ? value : DEFAULT_DISPOSITION;
}
function normalizeSource(value: unknown): string {
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
function isoOrNow(value: unknown, fallback: string): string {
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

function evidenceString(value: unknown, max: number = MAX_EVIDENCE_STRING_LENGTH): string | null {
  if (value == null) return null;
  const text = String(value).trim().slice(0, max);
  return text || null;
}

function clampScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

// Accepts both the display factor shape ({ label, delta }) emitted by the
// scoring module and the stored snapshot shape ({ label, points }). Exact pairs
// are deduplicated and the result is sorted deterministically (largest
// contribution first, then label) so input order alone can never change a
// snapshot's fingerprint and two equal factor sets in different order collapse.
function normalizeFactors(value: unknown): EvidenceFactor[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: EvidenceFactor[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = objectRecord(raw);
    const label = evidenceString(item.label);
    const source = item.points ?? item.delta;
    const rounded = typeof source === 'number' && Number.isFinite(source) ? Math.round(source) : null;
    if (label === null || rounded === null) continue;
    const points = rounded === 0 ? 0 : rounded; // collapse -0 to 0
    const key = `${label}\u0000${points}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, points });
  }
  out.sort((a, b) => b.points - a.points || a.label.localeCompare(b.label));
  return out.slice(0, MAX_EVIDENCE_FACTORS);
}

// Case-insensitive, terminal-dot-stripped, deduplicated and sorted so a
// nameserver set has one canonical form regardless of source casing/order.
function normalizeNameserverList(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[;\s]+/)
      : [];
  const seen = new Set<string>();
  for (const raw of values) {
    const ns = String(raw == null ? '' : raw).trim().toLowerCase().replace(/\.$/, '').slice(0, MAX_EVIDENCE_STRING_LENGTH);
    if (ns) seen.add(ns);
  }
  return [...seen].sort().slice(0, MAX_EVIDENCE_NAMESERVERS);
}

function normalizeMutationList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const raw of value) {
    const token = String(raw == null ? '' : raw).trim().slice(0, MAX_EVIDENCE_STRING_LENGTH);
    if (token) seen.add(token);
  }
  return [...seen].sort().slice(0, MAX_EVIDENCE_MUTATIONS);
}

function registrarKey(value: unknown): string {
  return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function dayOf(value: unknown): string | null {
  const iso = isoOrNull(value);
  return iso ? iso.slice(0, 10) : null;
}

// Capture completeness is recorded explicitly, never inferred from whether a
// boolean happens to be false. 'fast' captures skip the DNS/site/HTML probes;
// 'deep' evaluates them; 'unknown' is for migrated/imported evidence whose depth
// we cannot trust.
const EVIDENCE_SCAN_DEPTHS = new Set(['fast', 'deep']);
function normalizeScanDepth(value: unknown): string {
  return typeof value === 'string' && EVIDENCE_SCAN_DEPTHS.has(value) ? value : 'unknown';
}

// Signals only a deep scan evaluates. On a 'fast' capture these are forced to
// null (an unevaluated field, not an observed `false`) so a later comparison
// cannot mistake "not scanned" for "signal removed".
const DEEP_SIGNAL_FIELDS: Array<keyof CaseEvidenceMaterial> = [
  'hasMx', 'hasSpf', 'hasDmarc', 'activityStatus', 'pageTitle', 'websiteProbeDetail',
  'httpSummaryVersion', 'httpEvidenceStatus', 'httpFinalOrigin', 'httpResponseStatus', 'httpTransportSecurity', 'httpRedirectCount',
  'httpCrossOriginRedirect', 'httpHttpsDowngrade', 'httpContentType', 'httpSecurityHeaders',
  'faviconMatch', 'faviconNearMatch', 'reusesOfficialAssets', 'hasPasswordField', 'phishingLanguageMatch',
];

// Ordered list of the fields that make up a snapshot's *material* identity -
// everything except capture timestamps, snapshot id and source. `scanDepth` is
// included so captures of differing completeness can never be confused for one
// another. Deterministic ordering here is what makes the fingerprint stable.
const MATERIAL_FIELD_ORDER: Array<keyof CaseEvidenceMaterial> = [
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
];

// The canonical, comparison-safe value of a material field. Registrar casing,
// nameserver order, and sub-day timestamps are collapsed so they can never
// count as a "change"; a non-conclusive availability contributes nothing.
function materialValue(field: keyof CaseEvidenceMaterial, snapshot: CaseEvidenceMaterial): unknown {
  switch (field) {
    case 'availability':
      return typeof snapshot.availability === 'string' && CONCLUSIVE_AVAILABILITY.has(snapshot.availability)
        ? snapshot.availability
        : null;
    case 'registrar':
      return registrarKey(snapshot.registrar) || null;
    case 'createdDate':
      return dayOf(snapshot.createdDate);
    case 'expiryDate':
      return dayOf(snapshot.expiryDate);
    case 'nameservers':
      return snapshot.nameservers;
    case 'httpSecurityHeaders':
      return snapshot.httpSecurityHeaders;
    case 'mutationTypes':
      return snapshot.mutationTypes;
    case 'riskFactors':
      return snapshot.riskFactors.map((factor) => [factor.label, factor.points]);
    case 'opportunityFactors':
      return snapshot.opportunityFactors.map((factor) => [factor.label, factor.points]);
    default:
      return snapshot[field] ?? null;
  }
}

function isEmptyMaterial(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim() === '';
  return false; // finite numbers and booleans (incl. `false`) are material
}

// Fields that describe the capture rather than assert evidence, so they never
// on their own keep an otherwise-empty snapshot alive.
const NON_EVIDENCE_MATERIAL = new Set(['scanDepth', 'confidence']);

// A snapshot with no material evidence (only timestamps/source/depth, or only a
// bare confidence/unknown-availability) is dropped rather than added to a
// timeline.
function hasMaterialEvidence(snapshot: CaseEvidenceMaterial): boolean {
  for (const field of MATERIAL_FIELD_ORDER) {
    if (NON_EVIDENCE_MATERIAL.has(field)) continue;
    if (!isEmptyMaterial(materialValue(field, snapshot))) return true;
  }
  return false;
}

// Deterministic string form of the material identity, keys in fixed order.
function canonicalMaterialString(snapshot: CaseEvidenceMaterial): string {
  const canonical: Record<string, unknown> = {};
  for (const field of MATERIAL_FIELD_ORDER) canonical[field] = materialValue(field, snapshot);
  return JSON.stringify(canonical);
}

/**
 * Normalizes one arbitrary value into a bounded evidence snapshot, or null when
 * it carries no material evidence or cannot be placed in time.
 *
 * `capturedAt` comes from the value itself when valid, else `options.fallback`.
 * Callers that represent a genuine "now" capture (Lookup/Bulk/local migration)
 * pass a real fallback; the import path deliberately passes an older case
 * timestamp (never "now") so malformed imported evidence can't appear newest.
 * @param {unknown} raw
 * @param {{ source?: string, fallback?: string | null }} [options]
 * @returns {CaseEvidenceSnapshot | null}
 */
export function normalizeSnapshot(raw: unknown, options: SnapshotOptions = {}): CaseEvidenceSnapshot | null {
  const built = buildSnapshot(raw, options);
  return built ? built.snapshot : null;
}

/** @returns {{ snapshot: CaseEvidenceSnapshot, material: string } | null} */
function buildSnapshot(
  raw: unknown,
  options: SnapshotOptions,
): { snapshot: CaseEvidenceSnapshot; material: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = objectRecord(raw);
  const scanDepth = normalizeScanDepth(record.scanDepth);
  const httpSummary = normalizeHttpSummary(record);
  const fields: CaseEvidenceMaterial = {
    scanDepth,
    availability: evidenceString(record.availability),
    confidence: evidenceString(record.confidence),
    riskModelVersion: normalizeRiskModelVersion(record.riskModelVersion),
    riskScore: clampScore(record.riskScore),
    opportunityScore: clampScore(record.opportunityScore),
    riskFactors: normalizeFactors(record.riskFactors),
    opportunityFactors: normalizeFactors(record.opportunityFactors),
    registrar: evidenceString(record.registrar),
    createdDate: isoOrNull(record.createdDate),
    expiryDate: isoOrNull(record.expiryDate),
    nameservers: normalizeNameserverList(record.nameservers),
    hasMx: boolOrNull(record.hasMx),
    hasSpf: boolOrNull(record.hasSpf),
    hasDmarc: boolOrNull(record.hasDmarc),
    activityStatus: evidenceString(record.activityStatus),
    websiteProbeDetail: evidenceString(record.websiteProbeDetail, MAX_EVIDENCE_DETAIL_LENGTH),
    pageTitle: evidenceString(record.pageTitle, MAX_EVIDENCE_TITLE_LENGTH),
    httpSummaryVersion: httpSummary?.httpSummaryVersion ?? null,
    httpEvidenceStatus: httpSummary?.httpEvidenceStatus ?? null,
    httpFinalOrigin: httpSummary?.httpFinalOrigin ?? null,
    httpResponseStatus: httpSummary?.httpResponseStatus ?? null,
    httpTransportSecurity: httpSummary?.httpTransportSecurity ?? null,
    httpRedirectCount: httpSummary?.httpRedirectCount ?? null,
    httpCrossOriginRedirect: httpSummary?.httpCrossOriginRedirect ?? null,
    httpHttpsDowngrade: httpSummary?.httpHttpsDowngrade ?? null,
    httpContentType: httpSummary?.httpContentType ?? null,
    httpSecurityHeaders: httpSummary?.httpSecurityHeaders ?? null,
    faviconMatch: boolOrNull(record.faviconMatch),
    faviconNearMatch: boolOrNull(record.faviconNearMatch),
    reusesOfficialAssets: boolOrNull(record.reusesOfficialAssets),
    hasPasswordField: boolOrNull(record.hasPasswordField),
    phishingLanguageMatch: evidenceString(record.phishingLanguageMatch),
    mutationTypes: normalizeMutationList(record.mutationTypes),
  };
  // A version without an actual risk assessment is orphaned metadata. Drop it
  // so it cannot make otherwise-identical evidence look materially different.
  if (fields.riskScore === null && fields.riskFactors.length === 0) fields.riskModelVersion = null;
  // A fast capture never evaluates the deep signals, so any value supplied for
  // them (e.g. a profile's default `false`) is discarded as unevaluated.
  if (scanDepth === 'fast') {
    Object.assign(fields, {
      hasMx: null,
      hasSpf: null,
      hasDmarc: null,
      activityStatus: null,
      websiteProbeDetail: null,
      pageTitle: null,
      httpSummaryVersion: null,
      httpEvidenceStatus: null,
      httpFinalOrigin: null,
      httpResponseStatus: null,
      httpTransportSecurity: null,
      httpRedirectCount: null,
      httpCrossOriginRedirect: null,
      httpHttpsDowngrade: null,
      httpContentType: null,
      httpSecurityHeaders: null,
      faviconMatch: null,
      faviconNearMatch: null,
      reusesOfficialAssets: null,
      hasPasswordField: null,
      phishingLanguageMatch: null,
    });
  }
  if (!hasMaterialEvidence(fields)) return null;

  const capturedAt = isoOrNull(record.capturedAt) || options.fallback || null;
  if (!capturedAt) return null; // an evidence entry with no placeable time is skipped
  let firstCapturedAt = isoOrNull(record.firstCapturedAt) || capturedAt;
  if (Date.parse(firstCapturedAt) > Date.parse(capturedAt)) firstCapturedAt = capturedAt;

  const source = typeof record.source === 'string' && EVIDENCE_SOURCE_SET.has(record.source)
    ? record.source
    : typeof options.source === 'string' && EVIDENCE_SOURCE_SET.has(options.source)
      ? options.source
      : DEFAULT_EVIDENCE_SOURCE;

  const material = canonicalMaterialString(fields);
  const fingerprint = hashString(material);
  const snapshot: CaseEvidenceSnapshot = {
    id: `ev-${fingerprint}`,
    fingerprint,
    firstCapturedAt,
    capturedAt,
    source,
    ...fields,
  };
  return { snapshot, material };
}

function sourceRank(source: string): number {
  return EVIDENCE_SOURCE_RANK[source as keyof typeof EVIDENCE_SOURCE_RANK] ?? 0;
}

// Deterministic winner between two sources for the same material evidence.
// Higher rank wins; on a rank tie (e.g. lookup vs bulk) the source tied to the
// later observation wins; if those also tie, the lexically-smaller source is
// chosen so the result never depends on input order.
function chooseSource(kept: CaseEvidenceSnapshot, incoming: CaseEvidenceSnapshot): string {
  const rankKept = sourceRank(kept.source);
  const rankIncoming = sourceRank(incoming.source);
  if (rankIncoming !== rankKept) return rankIncoming > rankKept ? incoming.source : kept.source;
  const timeKept = Date.parse(kept.capturedAt);
  const timeIncoming = Date.parse(incoming.capturedAt);
  if (timeIncoming !== timeKept) return timeIncoming > timeKept ? incoming.source : kept.source;
  return kept.source <= incoming.source ? kept.source : incoming.source;
}

// Two materially identical captures collapse into one timeline entry: earliest
// first-seen, latest observed time, and a deterministically-chosen source.
function mergeDuplicateSnapshots(
  kept: CaseEvidenceSnapshot,
  incoming: CaseEvidenceSnapshot,
): CaseEvidenceSnapshot {
  const firstCapturedAt = Date.parse(incoming.firstCapturedAt) < Date.parse(kept.firstCapturedAt)
    ? incoming.firstCapturedAt
    : kept.firstCapturedAt;
  const capturedAt = Date.parse(incoming.capturedAt) > Date.parse(kept.capturedAt)
    ? incoming.capturedAt
    : kept.capturedAt;
  const source = chooseSource(kept, incoming);
  return { ...kept, firstCapturedAt, capturedAt, source };
}

function compareSnapshotChrono(a: CaseEvidenceSnapshot, b: CaseEvidenceSnapshot): number {
  return (
    Date.parse(a.capturedAt) - Date.parse(b.capturedAt) ||
    Date.parse(a.firstCapturedAt) - Date.parse(b.firstCapturedAt) ||
    a.fingerprint.localeCompare(b.fingerprint)
  );
}

/**
 * Normalizes a list of arbitrary values into a bounded, chronological,
 * material-deduplicated evidence history. Identical material collapses to one
 * entry (regardless of differing ids or timestamps); the newest distinct
 * snapshots are retained up to the per-case bound; ids are made unique within
 * the case.
 * @param {unknown} rawList
 * @param {{ source?: string, fallback?: string | null }} [options]
 * @returns {CaseEvidenceSnapshot[]}
 */
export function normalizeEvidenceHistory(
  rawList: unknown,
  options: SnapshotOptions = {},
): CaseEvidenceSnapshot[] {
  const list = Array.isArray(rawList) ? rawList : [];
  const byMaterial = new Map<string, CaseEvidenceSnapshot>();
  for (const raw of list) {
    const built = buildSnapshot(raw, options);
    if (!built) continue;
    const existing = byMaterial.get(built.material);
    // Verify full material equality, not just the short fingerprint, so a hash
    // collision can never merge two genuinely different snapshots.
    byMaterial.set(built.material, existing ? mergeDuplicateSnapshots(existing, built.snapshot) : built.snapshot);
  }
  const ordered = [...byMaterial.values()].sort(compareSnapshotChrono);
  const kept = ordered.slice(Math.max(0, ordered.length - MAX_EVIDENCE_SNAPSHOTS_PER_CASE));
  return assignUniqueSnapshotIds(kept);
}

function assignUniqueSnapshotIds(snapshots: CaseEvidenceSnapshot[]): CaseEvidenceSnapshot[] {
  const used = new Set<string>();
  return snapshots.map((snapshot) => {
    let id = safeId(snapshot.id) || `ev-${snapshot.fingerprint}`;
    if (used.has(id)) {
      const base = id;
      let suffix = 2;
      while (used.has(id)) id = `${base}-${suffix++}`;
    }
    used.add(id);
    return snapshot.id === id ? snapshot : { ...snapshot, id };
  });
}

/**
 * The most recent snapshot, or null. Lets UI render "the latest evidence"
 * without knowing the history is a bounded, deduplicated timeline.
 * @param {{ evidenceHistory?: CaseEvidenceSnapshot[] } | null | undefined} record
 * @returns {CaseEvidenceSnapshot | null}
 */
export function latestCaseEvidence(
  record: { evidenceHistory?: CaseEvidenceSnapshot[] } | null | undefined,
): CaseEvidenceSnapshot | null {
  const history = record && Array.isArray(record.evidenceHistory) ? record.evidenceHistory : [];
  return history.at(-1) ?? null;
}

// ---------------------------------------------------------------------------
// Material-change comparison (pure; no Svelte, DOM, or persistence access)
// ---------------------------------------------------------------------------

// `depthGate` decides when a field may be compared:
//   'both-deep'  - only when both snapshots are explicitly deep (a shallower
//                  capture can neither add nor remove a deep-only signal).
//   'comparable' - only when the two depths are equal and meaningful
//                  (fast->fast or deep->deep), so a risk delta caused solely by
//                  a mode change is never reported.
//   (absent)     - always comparable (data available in every capture).
const COMPARE_FIELDS: CompareFieldSpec[] = [
  { field: 'availability', label: 'Availability', type: 'availability' },
  { field: 'confidence', label: 'Confidence', type: 'token' },
  { field: 'riskScore', label: 'Risk score', type: 'score', depthGate: 'comparable', modelGate: 'risk', direction: 'risk' },
  { field: 'riskFactors', label: 'Risk factors', type: 'factors', depthGate: 'comparable', modelGate: 'risk' },
  { field: 'opportunityScore', label: 'Opportunity score', type: 'score' },
  { field: 'opportunityFactors', label: 'Opportunity factors', type: 'factors' },
  { field: 'registrar', label: 'Registrar', type: 'registrar' },
  { field: 'createdDate', label: 'Creation date', type: 'date' },
  { field: 'expiryDate', label: 'Expiry date', type: 'date' },
  { field: 'nameservers', label: 'Nameservers', type: 'set', emptyGuard: true },
  { field: 'hasMx', label: 'MX', type: 'bool', depthGate: 'both-deep' },
  { field: 'hasSpf', label: 'SPF', type: 'bool', depthGate: 'both-deep' },
  { field: 'hasDmarc', label: 'DMARC', type: 'bool', depthGate: 'both-deep' },
  { field: 'activityStatus', label: 'Website activity', type: 'token', depthGate: 'both-deep' },
  { field: 'websiteProbeDetail', label: 'Website check detail', type: 'text', depthGate: 'both-deep' },
  { field: 'pageTitle', label: 'Page title', type: 'text', depthGate: 'both-deep' },
  { field: 'httpEvidenceStatus', label: 'HTTP evidence status', type: 'token', depthGate: 'both-deep' },
  { field: 'httpFinalOrigin', label: 'Final website origin', type: 'text', depthGate: 'both-deep' },
  { field: 'httpResponseStatus', label: 'HTTP response status', type: 'number', depthGate: 'both-deep' },
  { field: 'httpTransportSecurity', label: 'Website transport', type: 'http-transport', depthGate: 'both-deep' },
  { field: 'httpRedirectCount', label: 'HTTP redirect count', type: 'number', depthGate: 'both-deep' },
  { field: 'httpCrossOriginRedirect', label: 'Cross-origin redirect', type: 'http-signal', depthGate: 'both-deep' },
  { field: 'httpHttpsDowngrade', label: 'HTTPS downgrade', type: 'signal', depthGate: 'both-deep' },
  { field: 'httpContentType', label: 'Website content type', type: 'token', depthGate: 'both-deep' },
  { field: 'httpSecurityHeaders', label: 'Observed security headers', type: 'set', depthGate: 'both-deep' },
  { field: 'faviconMatch', label: 'Official favicon match', type: 'signal', depthGate: 'both-deep' },
  { field: 'faviconNearMatch', label: 'Official favicon near-match', type: 'signal', depthGate: 'both-deep' },
  { field: 'reusesOfficialAssets', label: 'Official asset reuse', type: 'signal', depthGate: 'both-deep' },
  { field: 'hasPasswordField', label: 'Password form', type: 'signal', depthGate: 'both-deep' },
  { field: 'phishingLanguageMatch', label: 'Phishing language', type: 'phishing', depthGate: 'both-deep' },
  { field: 'mutationTypes', label: 'Mutation types', type: 'set' },
];

function depthComparable(a: unknown, b: unknown): boolean {
  return a === b && (a === 'fast' || a === 'deep');
}

function riskModelComparable(
  previous: CaseEvidenceSnapshot | null | undefined,
  current: CaseEvidenceSnapshot | null | undefined,
): boolean {
  const before = normalizeRiskModelVersion(previous?.riskModelVersion);
  const after = normalizeRiskModelVersion(current?.riskModelVersion);
  return before !== null && before === after;
}

function valuesMateriallyEqual(
  field: keyof CaseEvidenceMaterial,
  previous: CaseEvidenceSnapshot,
  current: CaseEvidenceSnapshot,
): boolean {
  return JSON.stringify(materialValue(field, previous)) === JSON.stringify(materialValue(field, current));
}

/**
 * Explains material fields that comparison gates deliberately suppress. The
 * reasons are stable machine values for UI/report wording; they are not risk
 * findings. A model-version mismatch remains visible even when another field
 * in the same observation produced an ordinary material change.
 * @param {CaseEvidenceSnapshot | null | undefined} previous
 * @param {CaseEvidenceSnapshot | null | undefined} current
 * @returns {Array<'scan-depth' | 'risk-model'>}
 */
export function caseEvidenceIncomparableReasons(
  previous: CaseEvidenceSnapshot | null | undefined,
  current: CaseEvidenceSnapshot | null | undefined,
): Array<'scan-depth' | 'risk-model'> {
  if (!previous || !current || previous.fingerprint === current.fingerprint) return [];
  const reasons: Array<'scan-depth' | 'risk-model'> = [];
  const hasRiskEvidence = previous.riskScore !== null || current.riskScore !== null
    || previous.riskFactors.length > 0 || current.riskFactors.length > 0;
  if (hasRiskEvidence && !riskModelComparable(previous, current)) reasons.push('risk-model');

  if (!depthComparable(previous.scanDepth, current.scanDepth)) {
    const deepOnlyChanged = DEEP_SIGNAL_FIELDS.some((field) => !valuesMateriallyEqual(field, previous, current));
    const comparableRiskChanged = riskModelComparable(previous, current)
      && (!valuesMateriallyEqual('riskScore', previous, current) || !valuesMateriallyEqual('riskFactors', previous, current));
    if (deepOnlyChanged || comparableRiskChanged) reasons.push('scan-depth');
  }
  return reasons;
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function setsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function compareField(
  spec: CompareFieldSpec,
  before: unknown,
  after: unknown,
): { before: unknown; after: unknown; tone: string } | null {
  switch (spec.type) {
    case 'score': {
      const b = clampScore(before);
      const a = clampScore(after);
      if (b === a) return null;
      let tone = 'neutral';
      if (spec.direction === 'risk') {
        if (b !== null && a !== null) tone = a > b ? (a >= 70 ? 'danger' : 'warn') : 'good';
        else if (a !== null && b === null) tone = a >= 70 ? 'danger' : 'warn';
      }
      return { before: b, after: a, tone };
    }
    case 'availability': {
      // Only compare two conclusive states; unknown/error can't prove a change.
      if (typeof before !== 'string' || typeof after !== 'string'
        || !CONCLUSIVE_AVAILABILITY.has(before) || !CONCLUSIVE_AVAILABILITY.has(after)) return null;
      if (before === after) return null;
      let tone = 'warn';
      if (before === 'available' && REGISTERED_LIKE.has(after)) tone = 'danger';
      else if (REGISTERED_LIKE.has(before) && after === 'available') tone = 'good';
      return { before, after, tone };
    }
    case 'registrar': {
      if (registrarKey(before) === registrarKey(after)) return null;
      if (!isPresent(before) && !isPresent(after)) return null;
      return { before: before ?? null, after: after ?? null, tone: 'warn' };
    }
    case 'date': {
      if (dayOf(before) === dayOf(after)) return null;
      if (!isPresent(before) && !isPresent(after)) return null;
      return { before: before ?? null, after: after ?? null, tone: 'warn' };
    }
    case 'set': {
      const normalizeSet = spec.field === 'nameservers'
        ? normalizeNameserverList
        : spec.field === 'httpSecurityHeaders'
          ? (value: unknown) => Array.isArray(value) ? [...value].sort() : []
          : normalizeMutationList;
      const b = normalizeSet(before);
      const a = normalizeSet(after);
      if (setsEqual(b, a)) return null;
      // An emptied set for a field we can't always observe isn't a removal.
      if (spec.emptyGuard && a.length === 0) return null;
      return { before: b, after: a, tone: 'warn' };
    }
    case 'bool': {
      if (before === null || before === undefined || after === null || after === undefined) return null;
      if (before === after) return null;
      const tone = spec.field === 'hasMx' && before === false && after === true ? 'warn' : 'neutral';
      return { before, after, tone };
    }
    case 'number': {
      const b = Number.isInteger(before) ? before : null;
      const a = Number.isInteger(after) ? after : null;
      if (b === a || b === null || a === null) return null;
      return { before: b, after: a, tone: 'neutral' };
    }
    case 'http-transport': {
      if (!isPresent(before) || !isPresent(after) || before === after) return null;
      return { before, after, tone: after === 'http' ? 'danger' : after === 'https' ? 'good' : 'neutral' };
    }
    case 'http-signal': {
      if (typeof before !== 'boolean' || typeof after !== 'boolean' || before === after) return null;
      return { before, after, tone: after ? 'warn' : 'good' };
    }
    case 'signal': {
      if (before === null || before === undefined || after === null || after === undefined) return null;
      if (before === after) return null;
      const tone = before === false && after === true ? 'danger' : before === true && after === false ? 'good' : 'neutral';
      return { before, after, tone };
    }
    case 'phishing': {
      const b = isPresent(before);
      const a = isPresent(after);
      if (!b && !a) return null;
      if ((before ?? null) === (after ?? null)) return null;
      const tone = !b && a ? 'danger' : b && !a ? 'good' : 'warn';
      return { before: before ?? null, after: after ?? null, tone };
    }
    case 'token': {
      const b = before ?? null;
      const a = after ?? null;
      if (b === a) return null;
      if (!isPresent(b) && !isPresent(a)) return null;
      const tone = spec.field === 'activityStatus' && a === 'active' ? 'warn' : 'neutral';
      return { before: b, after: a, tone };
    }
    case 'text': {
      const b = before ?? null;
      const a = after ?? null;
      if ((b || '') === (a || '')) return null;
      if (!isPresent(b) && !isPresent(a)) return null;
      return { before: b, after: a, tone: 'neutral' };
    }
    case 'factors': {
      // Factors are already normalized (deduped + deterministically sorted), so
      // a set comparison ignores input order and reports a genuine change in the
      // score's composition even when the total is unchanged.
      const b = Array.isArray(before) ? before : [];
      const a = Array.isArray(after) ? after : [];
      if (setsEqual(b, a)) return null;
      return { before: b, after: a, tone: 'neutral' };
    }
    default:
      return null;
  }
}

/**
 * Diffs two normalized snapshots into a bounded, stably-ordered list of
 * material changes. Timestamps, source, id and fingerprint are ignored;
 * nameservers/mutations/factors compare as sets; casing/order-only differences
 * never produce a change. Capture depth is honoured explicitly: deep-only
 * signals are only compared when both snapshots are deep. Risk-score and
 * factor changes additionally require matching explicit model versions and
 * equal meaningful depths, so formula upgrades and scan-mode differences are
 * never reported as changes in the observed domain.
 * @param {CaseEvidenceSnapshot | null | undefined} previous
 * @param {CaseEvidenceSnapshot | null | undefined} current
 * @returns {Array<{ field: string, label: string, before: unknown, after: unknown, tone: string }>}
 */
export function compareCaseEvidence(
  previous: CaseEvidenceSnapshot | null | undefined,
  current: CaseEvidenceSnapshot | null | undefined,
): EvidenceChange[] {
  if (!previous || !current) return [];
  const bothDeep = previous.scanDepth === 'deep' && current.scanDepth === 'deep';
  const comparableDepth = depthComparable(previous.scanDepth, current.scanDepth);
  const comparableRiskModel = riskModelComparable(previous, current);
  const changes: EvidenceChange[] = [];
  for (const spec of COMPARE_FIELDS) {
    if (spec.depthGate === 'both-deep' && !bothDeep) continue;
    if (spec.depthGate === 'comparable' && !comparableDepth) continue;
    if (spec.modelGate === 'risk' && !comparableRiskModel) continue;
    const result = compareField(spec, previous[spec.field], current[spec.field]);
    if (result) {
      changes.push({ field: spec.field, label: spec.label, before: result.before, after: result.after, tone: result.tone });
      if (changes.length >= MAX_EVIDENCE_CHANGES) break;
    }
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Case normalization
// ---------------------------------------------------------------------------

// A case's own source maps onto snapshot provenance for newly captured
// evidence. A hand-opened ('manual') case has no scan provenance.
function inferCaptureSource(caseSource: unknown): string {
  return typeof caseSource === 'string' && EVIDENCE_SOURCE_SET.has(caseSource) && caseSource !== 'import'
    ? caseSource
    : DEFAULT_EVIDENCE_SOURCE;
}

// Builds a case's bounded current-schema evidence history. Uses a lenient
// local fallback timestamp so recoverable current data always loads.
function normalizeCaseEvidence(
  record: Record<string, unknown>,
  createdAt: string,
  updatedAt: string,
  now: string,
): CaseEvidenceSnapshot[] {
  const localFallback = updatedAt || createdAt || now;
  if (Array.isArray(record.evidenceHistory)) {
    return normalizeEvidenceHistory(record.evidenceHistory, { source: DEFAULT_EVIDENCE_SOURCE, fallback: localFallback });
  }
  return [];
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
export function normalizeCase(
  raw: unknown,
  existing?: CaseRecord,
  nowIso?: string,
): CaseRecord | null {
  const now = nowIso || new Date().toISOString();
  const record = objectRecord(raw);
  const domain = normalizeDomain(existing ? existing.domain : record.domain);
  if (!domain) return null;
  const createdAt = existing ? existing.createdAt : isoOrNow(record.createdAt, now);
  const updatedAt = isoOrNow(record.updatedAt, now);
  const evidencePins = normalizeCaseEvidencePins(record.evidencePins, updatedAt);
  const pinIds = new Set(evidencePins.map((item) => item.id));
  return {
    id: existing ? existing.id : safeId(record.id) || deterministicId(domain),
    domain,
    status: normalizeStatus(record.status),
    disposition: normalizeDisposition(record.disposition),
    tags: normalizeTags(record.tags),
    notes: normalizeNotes(record.notes, now),
    source: normalizeSource(record.source),
    evidenceHistory: normalizeCaseEvidence(record, createdAt, updatedAt, now),
    evidencePins,
    decisions: normalizeCaseDecisions(record.decisions, updatedAt, pinIds),
    actions: normalizeCaseActions(record.actions, updatedAt),
    assertions: normalizeCaseAssertions(record.assertions, updatedAt, pinIds),
    manualTrail: normalizeCaseManualTrail(record.manualTrail, updatedAt),
    createdAt,
    updatedAt,
  };
}

/**
 * @param {{ domain: unknown, status?: unknown, disposition?: unknown, source?: unknown, tags?: unknown, evidence?: unknown, note?: unknown }} input
 * @param {string} [nowIso]
 * @returns {CaseRecord}
 */
export function createCase(input: CaseInput, nowIso?: string): CaseRecord {
  const now = nowIso || new Date().toISOString();
  const domain = normalizeDomain(input.domain);
  if (!domain) throw new Error('A valid domain is required to open a case.');
  const noteBody = normalizeNoteBody(input.note);
  const source = normalizeSource(input.source);
  return {
    id: makeId(),
    domain,
    status: normalizeStatus(input.status),
    disposition: normalizeDisposition(input.disposition),
    tags: normalizeTags(input.tags),
    notes: noteBody ? [{ id: makeId(), body: noteBody, createdAt: now }] : [],
    source,
    evidenceHistory: normalizeEvidenceHistory(input.evidence ? [input.evidence] : [], {
      source: inferCaptureSource(source),
      fallback: now,
    }),
    evidencePins: input.evidencePins !== undefined
      ? appendCaseEvidencePins([], input.evidencePins, now)
      : input.evidencePin !== undefined
        ? appendCaseEvidencePin([], input.evidencePin, now)
        : [],
    decisions: input.decision !== undefined
      ? appendCaseDecision([], input.decision, now)
      : [],
    actions: input.action !== undefined
      ? appendCaseAction([], input.action, now)
      : [],
    assertions: input.assertion !== undefined
      ? appendCaseAssertion([], input.assertion, now)
      : [],
    manualTrail: input.trailEvent !== undefined
      ? appendCaseManualTrailEvent([], input.trailEvent, now)
      : [],
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
export function openOrCreateCase(
  cases: CaseRecord[],
  input: CaseInput,
  nowIso?: string,
): { cases: CaseRecord[]; record: CaseRecord; created: boolean } {
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
 * replaces the tag set; an `evidence` value appends a new snapshot to the
 * history (deduplicated, so a materially identical re-capture only advances the
 * latest observation time). Returns a new array and the updated record.
 * @param {CaseRecord[]} cases
 * @param {string} id
 * @param {{ status?: unknown, disposition?: unknown, tags?: unknown, source?: unknown, evidence?: unknown, note?: unknown }} patch
 * @param {string} [nowIso]
 * @returns {{ cases: CaseRecord[], record: CaseRecord }}
 */
export function updateCase(
  cases: CaseRecord[],
  id: string,
  patch: CasePatch,
  nowIso?: string,
): { cases: CaseRecord[]; record: CaseRecord } {
  const now = nowIso || new Date().toISOString();
  const index = cases.findIndex((item) => item.id === id);
  if (index < 0) throw new Error('That case no longer exists.');
  const current = cases[index];
  if (!current) throw new Error('That case no longer exists.');
  let notes = current.notes;
  if (patch.note !== undefined) {
    const body = normalizeNoteBody(patch.note);
    if (!body) throw new Error('A note cannot be empty.');
    if (notes.length >= MAX_NOTES_PER_CASE) {
      throw new Error(`Each case is limited to ${MAX_NOTES_PER_CASE} notes.`);
    }
    notes = [...notes, { id: makeId(), body, createdAt: now }];
  }
  const source = patch.source !== undefined ? normalizeSource(patch.source) : current.source;
  let evidenceHistory = current.evidenceHistory;
  if (patch.evidence !== undefined) {
    evidenceHistory = normalizeEvidenceHistory(
      [...current.evidenceHistory, ...(patch.evidence ? [patch.evidence] : [])],
      { source: inferCaptureSource(source), fallback: now },
    );
  }
  let evidencePins = current.evidencePins;
  if (patch.evidencePins !== undefined) {
    evidencePins = appendCaseEvidencePins(evidencePins, patch.evidencePins, now);
  }
  if (patch.evidencePin !== undefined) {
    evidencePins = appendCaseEvidencePin(evidencePins, patch.evidencePin, now);
  }
  const pinIds = new Set(evidencePins.map((item) => item.id));
  let decisions = current.decisions;
  if (patch.decision !== undefined) {
    decisions = appendCaseDecision(current.decisions, patch.decision, now, pinIds);
  }
  let actions = current.actions;
  if (patch.action !== undefined) {
    actions = appendCaseAction(current.actions, patch.action, now);
  }
  if (patch.actionUpdate !== undefined) {
    actions = updateCaseAction(actions, patch.actionUpdate, now);
  }
  let assertions = current.assertions;
  if (patch.assertion !== undefined) {
    assertions = appendCaseAssertion(current.assertions, patch.assertion, now, pinIds);
  }
  if (patch.assertionUpdate !== undefined) {
    assertions = updateCaseAssertion(assertions, patch.assertionUpdate, now, pinIds);
  }
  let manualTrail = current.manualTrail;
  if (patch.trailEvent !== undefined) {
    manualTrail = appendCaseManualTrailEvent(current.manualTrail, patch.trailEvent, now);
  }
  const record: CaseRecord = {
    ...current,
    status: patch.status !== undefined ? normalizeStatus(patch.status) : current.status,
    disposition: patch.disposition !== undefined ? normalizeDisposition(patch.disposition) : current.disposition,
    tags: patch.tags !== undefined ? normalizeTags(patch.tags) : current.tags,
    source,
    evidenceHistory,
    evidencePins,
    decisions,
    actions,
    assertions,
    manualTrail,
    notes,
    updatedAt: now,
  };
  const next = [...cases];
  next[index] = record;
  return { cases: next, record };
}
