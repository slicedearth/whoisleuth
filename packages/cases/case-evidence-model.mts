// Pure, framework-neutral analyst-case records, evidence histories, bounded
// record normalization, and analyst updates.

import { normalizeHttpSummary } from './http-summary.mts';
import { normalizeOpportunityModelVersion } from '../../lib/opportunity-scoring.mts';
import { normalizeRiskModelVersion } from '../../lib/risk-scoring.mts';
import {
  MAX_EVIDENCE_CHANGES,
  MAX_EVIDENCE_DETAIL_LENGTH,
  MAX_EVIDENCE_FACTORS,
  MAX_EVIDENCE_MUTATIONS,
  MAX_EVIDENCE_NAMESERVERS,
  MAX_EVIDENCE_SNAPSHOTS_PER_CASE,
  MAX_EVIDENCE_STRING_LENGTH,
  MAX_EVIDENCE_TITLE_LENGTH,
  type CaseEvidenceMaterial,
  type CaseEvidenceSnapshot,
  type CompareFieldSpec,
  type EvidenceChange,
  type EvidenceFactor,
  type SnapshotOptions,
} from './case-record-contracts.mts';
import {
  CONCLUSIVE_AVAILABILITY,
  DEFAULT_EVIDENCE_SOURCE,
  EVIDENCE_SOURCE_RANK,
  EVIDENCE_SOURCE_SET,
  REGISTERED_LIKE,
  caseTimestampOrNull,
  hashString,
  isoOrNull,
  normalizeEvidenceHostnameForCase,
  objectRecord,
  safeId,
} from './case-record-core.mts';

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

function lifecycleTimestamp(value: unknown, sourceVersion?: number | null): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return caseTimestampOrNull(`${value}T00:00:00Z`);
  }
  return caseTimestampOrNull(value, sourceVersion);
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
  'faviconMatch', 'faviconNearMatch', 'reusesOfficialAssets', 'hasPasswordField', 'hasExternalFormAction', 'phishingLanguageMatch',
  'pageBaselineMatch',
];

// Ordered list of the fields that make up a snapshot's *material* identity -
// everything except capture timestamps, snapshot id and source. `scanDepth` is
// included so captures of differing completeness can never be confused for one
// another. Deterministic ordering here is what makes the fingerprint stable.
const MATERIAL_FIELD_ORDER: Array<keyof CaseEvidenceMaterial> = [
  'inputHostname',
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
  'profileContextState', 'profileContextLimitation',
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
const NON_EVIDENCE_MATERIAL = new Set(['inputHostname', 'scanDepth', 'confidence']);

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
  for (const field of MATERIAL_FIELD_ORDER) {
    const value = materialValue(field, snapshot);
    // Preserve historical fingerprints when the new v14 observation-context
    // field is absent. A retained hostname is still material and therefore
    // separates otherwise-identical captures.
    if (field === 'inputHostname' && value === null) continue;
    canonical[field] = value;
  }
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
 * @param {{ source?: string, fallback?: string | null, sourceVersion?: number | null, caseDomain?: string | null }} [options]
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
  const acceptsProfileContext = options.sourceVersion === undefined || Number(options.sourceVersion) >= 12;
  const acceptsInputHostname = options.sourceVersion === undefined || Number(options.sourceVersion) >= 14;
  const fields: CaseEvidenceMaterial = {
    inputHostname: acceptsInputHostname
      ? normalizeEvidenceHostnameForCase(record.inputHostname, options.caseDomain)
      : null,
    scanDepth,
    availability: evidenceString(record.availability),
    confidence: evidenceString(record.confidence),
    riskModelVersion: normalizeRiskModelVersion(record.riskModelVersion),
    riskScore: clampScore(record.riskScore),
    opportunityModelVersion: normalizeOpportunityModelVersion(record.opportunityModelVersion),
    opportunityScore: clampScore(record.opportunityScore),
    riskFactors: normalizeFactors(record.riskFactors),
    opportunityFactors: normalizeFactors(record.opportunityFactors),
    registrar: evidenceString(record.registrar),
    createdDate: lifecycleTimestamp(record.createdDate, options.sourceVersion),
    expiryDate: lifecycleTimestamp(record.expiryDate, options.sourceVersion),
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
    hasExternalFormAction: boolOrNull(record.hasExternalFormAction),
    phishingLanguageMatch: evidenceString(record.phishingLanguageMatch),
    privacyProtected: boolOrNull(record.privacyProtected),
    idnReferenceMatch: boolOrNull(record.idnReferenceMatch),
    pageBaselineMatch: boolOrNull(record.pageBaselineMatch),
    hasActiveBrandProfile: boolOrNull(record.hasActiveBrandProfile),
    profileContextState: acceptsProfileContext && ['loading', 'ready', 'unavailable'].includes(String(record.profileContextState))
      ? record.profileContextState as 'loading' | 'ready' | 'unavailable'
      : null,
    profileContextLimitation: acceptsProfileContext
      ? evidenceString(record.profileContextLimitation, MAX_EVIDENCE_DETAIL_LENGTH)
      : null,
    mutationTypes: normalizeMutationList(record.mutationTypes),
  };
  // A version without an actual risk assessment is orphaned metadata. Drop it
  // so it cannot make otherwise-identical evidence look materially different.
  if (fields.riskScore === null && fields.riskFactors.length === 0) fields.riskModelVersion = null;
  if (fields.opportunityScore === null && fields.opportunityFactors.length === 0) fields.opportunityModelVersion = null;
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
      hasExternalFormAction: null,
      phishingLanguageMatch: null,
      pageBaselineMatch: null,
    });
  }
  if (!hasMaterialEvidence(fields)) return null;

  const capturedAt = caseTimestampOrNull(record.capturedAt, options.sourceVersion) || options.fallback || null;
  if (!capturedAt) return null; // an evidence entry with no placeable time is skipped
  let firstCapturedAt = caseTimestampOrNull(record.firstCapturedAt, options.sourceVersion) || capturedAt;
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
 * @param {{ source?: string, fallback?: string | null, sourceVersion?: number | null, caseDomain?: string | null }} [options]
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
  { field: 'opportunityScore', label: 'Opportunity score', type: 'score', modelGate: 'opportunity' },
  { field: 'opportunityFactors', label: 'Opportunity factors', type: 'factors', modelGate: 'opportunity' },
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
  { field: 'hasExternalFormAction', label: 'External form action', type: 'signal', depthGate: 'both-deep' },
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

function opportunityModelComparable(
  previous: CaseEvidenceSnapshot | null | undefined,
  current: CaseEvidenceSnapshot | null | undefined,
): boolean {
  const before = normalizeOpportunityModelVersion(previous?.opportunityModelVersion);
  const after = normalizeOpportunityModelVersion(current?.opportunityModelVersion);
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
 * @returns {Array<'observation-context' | 'opportunity-model' | 'scan-depth' | 'risk-model'>}
 */
export function caseEvidenceIncomparableReasons(
  previous: CaseEvidenceSnapshot | null | undefined,
  current: CaseEvidenceSnapshot | null | undefined,
): Array<'observation-context' | 'opportunity-model' | 'scan-depth' | 'risk-model'> {
  if (!previous || !current || previous.fingerprint === current.fingerprint) return [];
  const reasons: Array<'observation-context' | 'opportunity-model' | 'scan-depth' | 'risk-model'> = [];
  if (previous.inputHostname !== current.inputHostname) reasons.push('observation-context');
  const hasRiskEvidence = previous.riskScore !== null || current.riskScore !== null
    || previous.riskFactors.length > 0 || current.riskFactors.length > 0;
  if (hasRiskEvidence && !riskModelComparable(previous, current)) reasons.push('risk-model');
  const hasOpportunityEvidence = previous.opportunityScore !== null || current.opportunityScore !== null
    || previous.opportunityFactors.length > 0 || current.opportunityFactors.length > 0;
  if (hasOpportunityEvidence && !opportunityModelComparable(previous, current)) reasons.push('opportunity-model');

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
  const comparableOpportunityModel = opportunityModelComparable(previous, current);
  const changes: EvidenceChange[] = [];
  for (const spec of COMPARE_FIELDS) {
    if (spec.depthGate === 'both-deep' && !bothDeep) continue;
    if (spec.depthGate === 'comparable' && !comparableDepth) continue;
    if (spec.modelGate === 'risk' && !comparableRiskModel) continue;
    if (spec.modelGate === 'opportunity' && !comparableOpportunityModel) continue;
    const result = compareField(spec, previous[spec.field], current[spec.field]);
    if (result) {
      changes.push({ field: spec.field, label: spec.label, before: result.before, after: result.after, tone: result.tone });
      if (changes.length >= MAX_EVIDENCE_CHANGES) break;
    }
  }
  return changes;
}
