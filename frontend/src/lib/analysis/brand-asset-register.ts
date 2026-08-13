import { normalizeDomain } from './case-model.ts';
import { normalizeOpaqueReferenceId } from './opaque-reference-id.ts';

export const BRAND_ASSET_REGISTER_VERSION = 1;
export const MAX_BRAND_ASSET_ROWS = 2_000;
export const MAX_BRAND_ASSET_CASE_REFERENCES = 12;
export const MAX_BRAND_ASSET_RELATIONSHIP_REFERENCES = 12;
export const MAX_BRAND_ASSET_EXPLANATIONS = 4;

const MAX_PROFILE_RECORDS = 100;
const MAX_PROFILE_INPUTS = 400;
const MAX_PROFILE_DOMAINS_PER_ROLE = 200;
const MAX_PROFILE_DOMAIN_INPUTS_PER_ROLE = 800;
const MAX_CASE_RECORDS = 500;
const MAX_CASE_INPUTS = 2_000;
const MAX_RELATIONSHIP_RECORDS = 300;
const MAX_RELATIONSHIP_INPUTS = 1_200;
const MAX_RELATIONSHIP_DOMAINS = 50;
const MAX_RELATIONSHIP_DOMAIN_INPUTS = 200;

export const BRAND_ASSET_CLASSIFICATIONS = Object.freeze([
  'authored_official',
  'authored_partner',
  'authored_allowlisted',
  'retained_case_scope',
  'observed_relationship_lead',
] as const);

export type BrandAssetClassification = typeof BRAND_ASSET_CLASSIFICATIONS[number];
export type BrandAssetRegisterSourceState = 'loading' | 'ready' | 'unavailable';
export type BrandAssetRegisterState =
  | 'loading'
  | 'ready'
  | 'partial'
  | 'unavailable'
  | 'no_active_profile'
  | 'unresolved_active_profile';
export type BrandAssetObservationCompleteness = 'complete' | 'partial' | 'unavailable' | 'not_applicable';
export type BrandAssetRowCoverage = 'complete' | 'partial';

export type BrandAssetCaseReference = Readonly<{
  id: string;
  sourceLabel: string;
  retainedAt: string | null;
}>;

export type BrandAssetRelationshipReference = Readonly<{
  id: string;
  type: string;
  label: string;
  method: string;
  sourceLabel: string;
  sourceVersion: number;
  observedAt: string;
  retainedAt: string;
  completeness: 'complete' | 'partial';
}>;

export type BrandAssetRegisterRow = Readonly<{
  key: string;
  domain: string;
  primaryClassification: BrandAssetClassification;
  classifications: readonly BrandAssetClassification[];
  provenanceLabels: readonly string[];
  caseReferences: readonly BrandAssetCaseReference[];
  relationshipReferences: readonly BrandAssetRelationshipReference[];
  timestamps: Readonly<{
    authoredAt: null;
    profileRevisionAt: string | null;
    caseRetainedAt: string | null;
    latestObservedAt: string | null;
    latestRelationshipRetainedAt: string | null;
  }>;
  observationalCompleteness: BrandAssetObservationCompleteness;
  coverage: BrandAssetRowCoverage;
  explanations: readonly string[];
}>;

export type BrandAssetSourceSummary = Readonly<{
  state: BrandAssetRegisterSourceState;
  recordCount: number | null;
  matchedCount: number | null;
  truncated: boolean;
}>;

export type BrandAssetRegisterProjection = Readonly<{
  version: typeof BRAND_ASSET_REGISTER_VERSION;
  state: BrandAssetRegisterState;
  activeProfileId: string | null;
  rows: readonly BrandAssetRegisterRow[];
  counts: Readonly<Record<BrandAssetClassification, number>>;
  sources: Readonly<{
    profiles: BrandAssetSourceSummary;
    activePreference: BrandAssetSourceSummary;
    cases: BrandAssetSourceSummary;
    relationships: BrandAssetSourceSummary;
  }>;
  omissions: Readonly<{
    rows: number;
    caseReferences: number;
    relationshipReferences: number;
  }>;
  limitations: readonly string[];
}>;

export type BrandAssetRegisterInput = Readonly<{
  profiles?: readonly unknown[];
  activeProfileId?: unknown;
  cases?: readonly unknown[];
  relationships?: readonly unknown[];
  sourceStates?: Partial<Readonly<{
    profiles: BrandAssetRegisterSourceState;
    activePreference: BrandAssetRegisterSourceState;
    cases: BrandAssetRegisterSourceState;
    relationships: BrandAssetRegisterSourceState;
  }>>;
  sourceTruncated?: Partial<Readonly<{
    profiles: boolean;
    cases: boolean;
    relationships: boolean;
  }>>;
}>;

type UnknownRecord = Record<string, unknown>;
type MutableRow = {
  key: string;
  domain: string;
  classifications: Set<BrandAssetClassification>;
  caseReferences: Map<string, BrandAssetCaseReference>;
  relationshipReferences: Map<string, NormalizedRelationship>;
  profileRevisionAt: string | null;
};
type NormalizedProfile = {
  id: string;
  officialDomains: string[];
  approvedPartnerDomains: string[];
  allowlistedDomains: string[];
  updatedAt: string | null;
  truncated: boolean;
};
type NormalizedCase = {
  id: string;
  domain: string;
  brandProfileIds: string[];
  sourceLabel: string;
  retainedAt: string | null;
};
type NormalizedRelationship = {
  id: string;
  type: keyof typeof RELATIONSHIP_METADATA;
  domains: string[];
  assetHost: string;
  sourceVersion: number;
  observedAt: string;
  retainedAt: string;
  complete: boolean;
  truncated: boolean;
};

const CLASSIFICATION_ORDER = new Map<BrandAssetClassification, number>(
  BRAND_ASSET_CLASSIFICATIONS.map((classification, index) => [classification, index]),
);
const RELATIONSHIP_METADATA = Object.freeze({
  nameserver_set: Object.freeze({ label: 'Shared nameserver set', method: 'Exact normalised set' }),
  ip_address: Object.freeze({ label: 'Shared IP address', method: 'Exact normalised address' }),
  certificate: Object.freeze({ label: 'Shared TLS certificate', method: 'Exact leaf-certificate SHA-256' }),
  tracking_identifier: Object.freeze({ label: 'Shared tracking identifier', method: 'Exact public identifier' }),
  favicon: Object.freeze({ label: 'Similar favicon', method: 'Exact hash or bounded perceptual distance' }),
  official_asset: Object.freeze({ label: 'Official asset relationship', method: 'Configured-domain host match' }),
});
const CASE_SOURCE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  lookup: 'Lookup Case',
  bulk: 'Bulk Case',
  monitor: 'Monitor Case',
  manual: 'Manual Case',
  unknown: 'Case',
});
const FIXED_LIMITATIONS = Object.freeze([
  'This register is a transient browser-local projection. It makes no request, write, discovery, monitoring, score, export, or automatic Case.',
  'Authored roles are analyst-supplied non-ownership classifications. Relationship observations are review leads and never prove ownership, control, coordination, intent, safety, or maliciousness.',
  'Only direct profile roles and exact profile-associated Case domains anchor one-hop retained observations. Newly observed candidates never become anchors.',
  'Missing, unavailable, incomplete, or truncated local evidence is not treated as absence or a safety conclusion.',
]);

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function positiveInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 1_000
    ? value
    : 1;
}

function state(value: unknown): BrandAssetRegisterSourceState {
  return value === 'loading' || value === 'unavailable' ? value : 'ready';
}

function domainList(raw: unknown): { domains: string[]; truncated: boolean } {
  const input = Array.isArray(raw) ? raw : [];
  const output = new Set<string>();
  let validBeyondOutput = 0;
  for (const candidate of input.slice(0, MAX_PROFILE_DOMAIN_INPUTS_PER_ROLE)) {
    const domain = normalizeDomain(candidate);
    if (!domain || output.has(domain)) continue;
    if (output.size < MAX_PROFILE_DOMAINS_PER_ROLE) output.add(domain);
    else validBeyondOutput += 1;
  }
  return {
    domains: [...output],
    truncated: input.length > MAX_PROFILE_DOMAIN_INPUTS_PER_ROLE || validBeyondOutput > 0,
  };
}

function normalizeProfile(raw: unknown): NormalizedProfile | null {
  const value = record(raw);
  const id = normalizeOpaqueReferenceId(value?.id);
  if (!value || !id) return null;
  const official = domainList(value.officialDomains);
  const partner = domainList(value.approvedPartnerDomains);
  const allowlisted = domainList(value.allowlistedDomains);
  return {
    id,
    officialDomains: official.domains,
    approvedPartnerDomains: partner.domains,
    allowlistedDomains: allowlisted.domains,
    updatedAt: timestamp(value.updatedAt),
    truncated: official.truncated || partner.truncated || allowlisted.truncated,
  };
}

function normalizeProfiles(raw: readonly unknown[]): { profiles: NormalizedProfile[]; truncated: boolean } {
  const byId = new Map<string, NormalizedProfile>();
  let overRecordCap = false;
  for (const candidate of raw.slice(0, MAX_PROFILE_INPUTS)) {
    const profile = normalizeProfile(candidate);
    if (!profile) continue;
    const existing = byId.get(profile.id);
    if (existing) {
      if ((profile.updatedAt ?? '') > (existing.updatedAt ?? '')) byId.set(profile.id, profile);
      continue;
    }
    if (byId.size >= MAX_PROFILE_RECORDS) {
      overRecordCap = true;
      continue;
    }
    byId.set(profile.id, profile);
  }
  const profiles = [...byId.values()];
  return {
    profiles,
    truncated: raw.length > MAX_PROFILE_INPUTS || overRecordCap || profiles.some((profile) => profile.truncated),
  };
}

function normalizedProfileIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output = new Set<string>();
  for (const candidate of value.slice(0, 32)) {
    const id = normalizeOpaqueReferenceId(candidate);
    if (id) output.add(id);
    if (output.size >= 8) break;
  }
  return [...output];
}

function normalizeCase(raw: unknown): NormalizedCase | null {
  const value = record(raw);
  const id = normalizeOpaqueReferenceId(value?.id);
  const domain = normalizeDomain(value?.domain);
  if (!value || !id || !domain) return null;
  const source = typeof value.source === 'string' ? value.source : 'unknown';
  return {
    id,
    domain,
    brandProfileIds: normalizedProfileIds(value.brandProfileIds),
    sourceLabel: CASE_SOURCE_LABELS[source] ?? CASE_SOURCE_LABELS.unknown!,
    retainedAt: timestamp(value.createdAt),
  };
}

function normalizeCases(raw: readonly unknown[]): { cases: NormalizedCase[]; truncated: boolean } {
  const cases: NormalizedCase[] = [];
  let validBeyondOutput = 0;
  for (const candidate of raw.slice(0, MAX_CASE_INPUTS)) {
    const normalized = normalizeCase(candidate);
    if (!normalized) continue;
    if (cases.length < MAX_CASE_RECORDS) cases.push(normalized);
    else validBeyondOutput += 1;
  }
  return {
    cases,
    truncated: raw.length > MAX_CASE_INPUTS || validBeyondOutput > 0,
  };
}

function relationshipDomains(raw: unknown): { domains: string[]; truncated: boolean } {
  const input = Array.isArray(raw) ? raw : [];
  const output = new Set<string>();
  let validBeyondOutput = 0;
  for (const candidate of input.slice(0, MAX_RELATIONSHIP_DOMAIN_INPUTS)) {
    const domain = normalizeDomain(candidate);
    if (!domain || output.has(domain)) continue;
    if (output.size < MAX_RELATIONSHIP_DOMAINS) output.add(domain);
    else validBeyondOutput += 1;
  }
  return {
    domains: [...output].sort(codeUnitCompare),
    truncated: input.length > MAX_RELATIONSHIP_DOMAIN_INPUTS || validBeyondOutput > 0,
  };
}

function normalizeRelationship(raw: unknown): NormalizedRelationship | null {
  const value = record(raw);
  const id = normalizeOpaqueReferenceId(value?.id);
  const type = typeof value?.type === 'string' && Object.hasOwn(RELATIONSHIP_METADATA, value.type)
    ? value.type as keyof typeof RELATIONSHIP_METADATA
    : null;
  const domains = relationshipDomains(value?.domains);
  const observedAt = timestamp(value?.observedAt);
  const retainedAt = timestamp(value?.retainedAt);
  if (!value || !id || !type || !domains.domains.length || !observedAt || !retainedAt) return null;
  return {
    id,
    type,
    domains: domains.domains,
    assetHost: type === 'official_asset' ? normalizeDomain(value.normalizedValue) : '',
    sourceVersion: positiveInteger(value.sourceVersion),
    observedAt,
    retainedAt,
    complete: value.complete === true,
    truncated: value.truncated === true || domains.truncated,
  };
}

function relationshipWinner(left: NormalizedRelationship, right: NormalizedRelationship): NormalizedRelationship {
  const tieKey = (relationship: NormalizedRelationship) => [
    relationship.retainedAt,
    relationship.observedAt,
    relationship.complete ? '0' : '1',
    relationship.truncated ? '1' : '0',
    String(relationship.sourceVersion).padStart(4, '0'),
    relationship.type,
    relationship.assetHost,
    relationship.domains.join('\u0000'),
  ].join('\u0001');
  const leftKey = tieKey(left);
  const rightKey = tieKey(right);
  return rightKey > leftKey ? right : left;
}

function normalizeRelationships(raw: readonly unknown[]): { relationships: NormalizedRelationship[]; truncated: boolean } {
  const byId = new Map<string, NormalizedRelationship>();
  let validBeyondOutput = 0;
  for (const candidate of raw.slice(0, MAX_RELATIONSHIP_INPUTS)) {
    const normalized = normalizeRelationship(candidate);
    if (!normalized) continue;
    const existing = byId.get(normalized.id);
    if (existing) {
      byId.set(normalized.id, relationshipWinner(existing, normalized));
      continue;
    }
    if (byId.size < MAX_RELATIONSHIP_RECORDS) byId.set(normalized.id, normalized);
    else validBeyondOutput += 1;
  }
  const relationships = [...byId.values()];
  return {
    relationships,
    truncated: raw.length > MAX_RELATIONSHIP_INPUTS || validBeyondOutput > 0,
  };
}

function keyFor(domain: string): string {
  return `FQDN/${domain}`;
}

function ensureRow(rows: Map<string, MutableRow>, domain: string, profileRevisionAt: string | null): MutableRow {
  const key = keyFor(domain);
  const existing = rows.get(key);
  if (existing) return existing;
  const created: MutableRow = {
    key,
    domain,
    classifications: new Set(),
    caseReferences: new Map(),
    relationshipReferences: new Map(),
    profileRevisionAt,
  };
  rows.set(key, created);
  return created;
}

function officialAssetMatches(assetHost: string, officialDomains: ReadonlySet<string>): boolean {
  if (!assetHost) return false;
  for (const official of officialDomains) {
    if (assetHost === official || assetHost.endsWith(`.${official}`)) return true;
  }
  return false;
}

function classificationOrder(left: BrandAssetClassification, right: BrandAssetClassification): number {
  return Number(CLASSIFICATION_ORDER.get(left)) - Number(CLASSIFICATION_ORDER.get(right));
}

function relationshipOrder(left: NormalizedRelationship, right: NormalizedRelationship): number {
  return codeUnitCompare(right.observedAt, left.observedAt)
    || codeUnitCompare(right.retainedAt, left.retainedAt)
    || codeUnitCompare(left.id, right.id);
}

function caseReferenceOrder(left: BrandAssetCaseReference, right: BrandAssetCaseReference): number {
  return codeUnitCompare(right.retainedAt ?? '', left.retainedAt ?? '') || codeUnitCompare(left.id, right.id);
}

function latest(values: readonly (string | null)[]): string | null {
  const present = values.filter((value): value is string => value !== null).sort(codeUnitCompare);
  return present.at(-1) ?? null;
}

function explanations(classifications: readonly BrandAssetClassification[]): string[] {
  const output: string[] = [];
  const authored = classifications.filter((classification) => classification.startsWith('authored_'));
  const primary = classifications[0];
  if (primary === 'authored_official') output.push('Listed as an official domain in the active Brand Profile.');
  else if (primary === 'authored_partner') output.push('Listed as an approved partner domain in the active Brand Profile.');
  else if (primary === 'authored_allowlisted') output.push('Listed as an allowlisted domain in the active Brand Profile.');
  else if (primary === 'retained_case_scope') output.push('Retained by a Case explicitly associated with the active Brand Profile.');
  else output.push('Present in a qualifying one-hop retained relationship observation.');
  if (classifications.includes('retained_case_scope') && primary !== 'retained_case_scope') {
    output.push('Also retained by an explicitly associated Case.');
  }
  if (classifications.includes('observed_relationship_lead') && primary !== 'observed_relationship_lead') {
    output.push('Also corroborated by a qualifying retained relationship observation.');
  }
  if (authored.length > 1) {
    output.push('The active Brand Profile lists this domain in more than one authored role; review the profile data.');
  }
  return output.slice(0, MAX_BRAND_ASSET_EXPLANATIONS);
}

function provenanceLabels(classifications: readonly BrandAssetClassification[]): string[] {
  const labels: string[] = [];
  if (classifications.some((classification) => classification.startsWith('authored_'))) labels.push('Active Brand Profile');
  if (classifications.includes('retained_case_scope')) labels.push('Explicitly associated Cases');
  if (classifications.includes('observed_relationship_lead')) labels.push('Retained relationship observations');
  return labels;
}

function counts(rows: readonly BrandAssetRegisterRow[]): Record<BrandAssetClassification, number> {
  return Object.fromEntries(BRAND_ASSET_CLASSIFICATIONS.map((classification) => [
    classification,
    rows.filter((row) => row.primaryClassification === classification).length,
  ])) as Record<BrandAssetClassification, number>;
}

function sourceSummary(
  sourceState: BrandAssetRegisterSourceState,
  recordCount: number,
  matchedCount: number,
  truncated: boolean,
): BrandAssetSourceSummary {
  return {
    state: sourceState,
    recordCount: sourceState === 'ready' ? recordCount : null,
    matchedCount: sourceState === 'ready' ? matchedCount : null,
    truncated: sourceState === 'ready' && truncated,
  };
}

function emptyCounts(): Record<BrandAssetClassification, number> {
  return Object.fromEntries(BRAND_ASSET_CLASSIFICATIONS.map((classification) => [classification, 0])) as Record<BrandAssetClassification, number>;
}

function emptyProjection(
  projectionState: BrandAssetRegisterState,
  activeProfileId: string | null,
  sourceStates: Required<NonNullable<BrandAssetRegisterInput['sourceStates']>>,
  profileCount: number,
  profilesTruncated: boolean,
): BrandAssetRegisterProjection {
  return {
    version: BRAND_ASSET_REGISTER_VERSION,
    state: projectionState,
    activeProfileId,
    rows: [],
    counts: emptyCounts(),
    sources: {
      profiles: sourceSummary(sourceStates.profiles, profileCount, activeProfileId ? 1 : 0, profilesTruncated),
      activePreference: sourceSummary(sourceStates.activePreference, activeProfileId ? 1 : 0, activeProfileId ? 1 : 0, false),
      cases: sourceSummary(sourceStates.cases, 0, 0, false),
      relationships: sourceSummary(sourceStates.relationships, 0, 0, false),
    },
    omissions: { rows: 0, caseReferences: 0, relationshipReferences: 0 },
    limitations: FIXED_LIMITATIONS,
  };
}

export function buildBrandAssetRegister(input: BrandAssetRegisterInput): BrandAssetRegisterProjection {
  const sourceStates = {
    profiles: state(input.sourceStates?.profiles),
    activePreference: state(input.sourceStates?.activePreference),
    cases: state(input.sourceStates?.cases),
    relationships: state(input.sourceStates?.relationships),
  } satisfies Required<NonNullable<BrandAssetRegisterInput['sourceStates']>>;
  const rawProfiles = Array.isArray(input.profiles) ? input.profiles : [];
  const normalizedProfiles = sourceStates.profiles === 'ready'
    ? normalizeProfiles(rawProfiles)
    : { profiles: [], truncated: false };
  const profilesTruncated = normalizedProfiles.truncated || input.sourceTruncated?.profiles === true;
  const rawActiveId = typeof input.activeProfileId === 'string' ? input.activeProfileId : '';
  const activeProfileId = normalizeOpaqueReferenceId(rawActiveId);

  if (sourceStates.profiles === 'unavailable' || sourceStates.activePreference === 'unavailable') {
    return emptyProjection('unavailable', activeProfileId, sourceStates, normalizedProfiles.profiles.length, profilesTruncated);
  }
  if (sourceStates.profiles === 'loading' || sourceStates.activePreference === 'loading') {
    return emptyProjection('loading', activeProfileId, sourceStates, normalizedProfiles.profiles.length, profilesTruncated);
  }
  if (!rawActiveId) {
    return emptyProjection('no_active_profile', null, sourceStates, normalizedProfiles.profiles.length, profilesTruncated);
  }
  const activeProfile = activeProfileId
    ? normalizedProfiles.profiles.find((profile) => profile.id === activeProfileId) ?? null
    : null;
  if (!activeProfile) {
    return emptyProjection('unresolved_active_profile', activeProfileId, sourceStates, normalizedProfiles.profiles.length, profilesTruncated);
  }

  const rawCases = Array.isArray(input.cases) ? input.cases : [];
  const normalizedCases = sourceStates.cases === 'ready'
    ? normalizeCases(rawCases)
    : { cases: [], truncated: false };
  const casesTruncated = normalizedCases.truncated || input.sourceTruncated?.cases === true;
  const rawRelationships = Array.isArray(input.relationships) ? input.relationships : [];
  const normalizedRelationships = sourceStates.relationships === 'ready'
    ? normalizeRelationships(rawRelationships)
    : { relationships: [], truncated: false };
  const relationshipsTruncated = normalizedRelationships.truncated || input.sourceTruncated?.relationships === true;
  const rows = new Map<string, MutableRow>();

  for (const domain of activeProfile.officialDomains) {
    ensureRow(rows, domain, activeProfile.updatedAt).classifications.add('authored_official');
  }
  for (const domain of activeProfile.approvedPartnerDomains) {
    ensureRow(rows, domain, activeProfile.updatedAt).classifications.add('authored_partner');
  }
  for (const domain of activeProfile.allowlistedDomains) {
    ensureRow(rows, domain, activeProfile.updatedAt).classifications.add('authored_allowlisted');
  }

  let matchedCases = 0;
  for (const record of normalizedCases.cases) {
    if (!record.brandProfileIds.includes(activeProfile.id)) continue;
    matchedCases += 1;
    const row = ensureRow(rows, record.domain, activeProfile.updatedAt);
    row.classifications.add('retained_case_scope');
    row.caseReferences.set(record.id, {
      id: record.id,
      sourceLabel: record.sourceLabel,
      retainedAt: record.retainedAt,
    });
  }

  const directAnchors = new Set(rows.keys());
  const officialDomains = new Set(activeProfile.officialDomains);
  const qualifyingRelationships: NormalizedRelationship[] = [];
  for (const relationship of normalizedRelationships.relationships) {
    const qualifies = relationship.domains.some((domain) => directAnchors.has(keyFor(domain)))
      || (relationship.type === 'official_asset' && officialAssetMatches(relationship.assetHost, officialDomains));
    if (qualifies) qualifyingRelationships.push(relationship);
  }

  const candidateRows = new Map<string, MutableRow>();
  for (const relationship of qualifyingRelationships) {
    for (const domain of relationship.domains) {
      const key = keyFor(domain);
      const row = rows.get(key) ?? ensureRow(candidateRows, domain, activeProfile.updatedAt);
      row.classifications.add('observed_relationship_lead');
      const existing = row.relationshipReferences.get(relationship.id);
      row.relationshipReferences.set(
        relationship.id,
        existing ? relationshipWinner(existing, relationship) : relationship,
      );
    }
  }

  const remainingCapacity = Math.max(0, MAX_BRAND_ASSET_ROWS - rows.size);
  const orderedCandidates = [...candidateRows.values()].sort((left, right) => {
    const leftRelationships = [...left.relationshipReferences.values()];
    const rightRelationships = [...right.relationshipReferences.values()];
    return codeUnitCompare(
      latest(rightRelationships.map((relationship) => relationship.observedAt)) ?? '',
      latest(leftRelationships.map((relationship) => relationship.observedAt)) ?? '',
    )
      || codeUnitCompare(
        latest(rightRelationships.map((relationship) => relationship.retainedAt)) ?? '',
        latest(leftRelationships.map((relationship) => relationship.retainedAt)) ?? '',
      )
      || codeUnitCompare(left.key, right.key);
  });
  for (const candidate of orderedCandidates.slice(0, remainingCapacity)) rows.set(candidate.key, candidate);
  const omittedRows = Math.max(0, orderedCandidates.length - remainingCapacity);

  let omittedCaseReferences = 0;
  let omittedRelationshipReferences = 0;
  const anySourceIncomplete = sourceStates.cases !== 'ready'
    || sourceStates.relationships !== 'ready'
    || profilesTruncated
    || casesTruncated
    || relationshipsTruncated;
  const output: BrandAssetRegisterRow[] = [...rows.values()].map((row) => {
    const classifications = [...row.classifications].sort(classificationOrder);
    const allCases = [...row.caseReferences.values()].sort(caseReferenceOrder);
    const caseReferences = allCases.slice(0, MAX_BRAND_ASSET_CASE_REFERENCES);
    const caseReferenceOmissions = allCases.length - caseReferences.length;
    omittedCaseReferences += caseReferenceOmissions;
    const allRelationships = [...row.relationshipReferences.values()].sort(relationshipOrder);
    const relationships = allRelationships.slice(0, MAX_BRAND_ASSET_RELATIONSHIP_REFERENCES);
    const relationshipReferenceOmissions = allRelationships.length - relationships.length;
    omittedRelationshipReferences += relationshipReferenceOmissions;
    const relationshipReferences: BrandAssetRelationshipReference[] = relationships.map((relationship) => ({
      id: relationship.id,
      type: relationship.type,
      label: RELATIONSHIP_METADATA[relationship.type].label,
      method: RELATIONSHIP_METADATA[relationship.type].method,
      sourceLabel: 'Retained Bulk relationship observation',
      sourceVersion: relationship.sourceVersion,
      observedAt: relationship.observedAt,
      retainedAt: relationship.retainedAt,
      completeness: relationship.complete && !relationship.truncated ? 'complete' : 'partial',
    }));
    const observationalCompleteness: BrandAssetObservationCompleteness = allRelationships.length === 0
      ? 'not_applicable'
      : allRelationships.every((relationship) => relationship.complete && !relationship.truncated)
        && relationshipReferenceOmissions === 0
        ? 'complete'
        : 'partial';
    const rowIncomplete = anySourceIncomplete
      || caseReferenceOmissions > 0
      || relationshipReferenceOmissions > 0
      || allRelationships.some((relationship) => !relationship.complete || relationship.truncated);
    return {
      key: row.key,
      domain: row.domain,
      primaryClassification: classifications[0]!,
      classifications,
      provenanceLabels: provenanceLabels(classifications),
      caseReferences,
      relationshipReferences,
      timestamps: {
        authoredAt: null,
        profileRevisionAt: row.profileRevisionAt,
        caseRetainedAt: latest(allCases.map((reference) => reference.retainedAt)),
        latestObservedAt: latest(allRelationships.map((relationship) => relationship.observedAt)),
        latestRelationshipRetainedAt: latest(allRelationships.map((relationship) => relationship.retainedAt)),
      },
      observationalCompleteness,
      coverage: rowIncomplete ? 'partial' as const : 'complete' as const,
      explanations: explanations(classifications),
    };
  }).sort((left, right) => classificationOrder(left.primaryClassification, right.primaryClassification)
    || codeUnitCompare(left.domain, right.domain));

  const hasPartialRelationship = qualifyingRelationships.some((relationship) => !relationship.complete || relationship.truncated);
  const hasLoadingSource = sourceStates.cases === 'loading' || sourceStates.relationships === 'loading';
  const isPartial = sourceStates.cases === 'unavailable'
    || sourceStates.relationships === 'unavailable'
    || profilesTruncated
    || casesTruncated
    || relationshipsTruncated
    || hasPartialRelationship
    || omittedRows > 0
    || omittedCaseReferences > 0
    || omittedRelationshipReferences > 0;
  const projectionState: BrandAssetRegisterState = hasLoadingSource ? 'loading' : isPartial ? 'partial' : 'ready';

  return {
    version: BRAND_ASSET_REGISTER_VERSION,
    state: projectionState,
    activeProfileId: activeProfile.id,
    rows: output,
    counts: counts(output),
    sources: {
      profiles: sourceSummary(sourceStates.profiles, normalizedProfiles.profiles.length, 1, profilesTruncated),
      activePreference: sourceSummary(sourceStates.activePreference, 1, 1, false),
      cases: sourceSummary(sourceStates.cases, normalizedCases.cases.length, matchedCases, casesTruncated),
      relationships: sourceSummary(sourceStates.relationships, normalizedRelationships.relationships.length, qualifyingRelationships.length, relationshipsTruncated),
    },
    omissions: {
      rows: omittedRows,
      caseReferences: omittedCaseReferences,
      relationshipReferences: omittedRelationshipReferences,
    },
    limitations: FIXED_LIMITATIONS,
  };
}
