// Disposable, bounded cohort review over evidence already retained in local
// Cases and relationship projections. Cohorts are review leads only: they do
// not alter campaign membership or imply ownership, coordination, attribution,
// intent, safety, or maliciousness.

import { analyzeBoundedRelationshipGraph } from '../../../../lib/bounded-relationship-graph.mts';
import { MAX_PROFILES, normalizeBrandProfileStore, type BrandProfile } from './brand-profile-model.ts';
import { normalizeCaseBrandProfileIds } from './case-brand-profile-references.ts';
import { latestCaseEvidence, MAX_CASES, normalizeCaseStore, normalizeDomain, type CaseRecord } from './case-model.ts';
import type { CasePinCompleteness } from './case-response-model.ts';
import { MAX_CASE_RELATIONSHIP_GROUPS, type CaseRelationshipGroup, type CaseRelationshipSummary } from './case-relationships.ts';
import { classifyCommonInfrastructureAddress } from './common-infrastructure.ts';
import { observationEnvelopeId } from './observation-envelope.ts';
import { normalizeOpaqueReferenceId } from './opaque-reference-id.ts';

export const CAMPAIGN_COHORT_REVIEW_VERSION = 1;
export const CAMPAIGN_REGISTRATION_WINDOW_DAYS = 7;
export const MAX_CAMPAIGN_COHORT_MEMBERS = 50;
export const MAX_CAMPAIGN_COHORTS = 25;
export const MAX_CAMPAIGN_COHORT_RATIONALES = 100;
export const MAX_CAMPAIGN_COHORT_ASSERTIONS = 100;

export type CampaignCohortSourceState = 'loading' | 'ready' | 'unavailable';
export type CampaignCohortRationaleKind =
  | 'bounded_similarity'
  | 'common_infrastructure'
  | 'exact_link'
  | 'temporal_cooccurrence';

export type CampaignCohortMember = Readonly<{ caseId: string; domain: string }>;
export type CampaignCohortScopeOption = Readonly<{
  id: string;
  name: string | null;
  memberCount: number;
  state: 'details_unavailable' | 'ready' | 'unresolved';
}>;
export type CampaignCohortRationale = Readonly<{
  id: string;
  kind: CampaignCohortRationaleKind;
  label: string;
  method: string;
  value: string;
  members: readonly CampaignCohortMember[];
  sources: readonly string[];
  completeness: CasePinCompleteness;
  firstPublishedAt: string | null;
  lastPublishedAt: string | null;
  spanDays: number | null;
  limitations: readonly string[];
}>;
export type CampaignCohort = Readonly<{
  id: string;
  members: readonly CampaignCohortMember[];
  rationales: readonly CampaignCohortRationale[];
  rationaleCounts: Readonly<Record<CampaignCohortRationaleKind, number>>;
}>;
export type CampaignCohortAssertionContext = Readonly<{
  id: string;
  caseId: string;
  domain: string;
  kind: string;
  state: string;
  statement: string;
  updatedAt: string;
  supports: number;
  contradicts: number;
  unresolved: number;
}>;
export type CampaignCohortReview = Readonly<{
  version: typeof CAMPAIGN_COHORT_REVIEW_VERSION;
  state: 'loading' | 'partial' | 'ready' | 'unavailable' | 'unselected';
  sources: Readonly<{
    cases: CampaignCohortSourceState;
    profiles: CampaignCohortSourceState;
    relationships: CampaignCohortSourceState;
  }>;
  scopeOptions: readonly CampaignCohortScopeOption[];
  selectedScope: CampaignCohortScopeOption | null;
  memberCount: number;
  linkedCaseCount: number;
  scopedCaseCount: number;
  cohorts: readonly CampaignCohort[];
  ungroupedMembers: readonly CampaignCohortMember[];
  assertions: readonly CampaignCohortAssertionContext[];
  rationaleCounts: Readonly<Record<CampaignCohortRationaleKind, number>>;
  upstreamRelationshipTruncated: boolean;
  omissions: Readonly<{
    campaignMembers: number;
    caseInputs: number;
    profileInputs: number;
    relationshipGroups: number;
    relationshipMembers: number;
    rationales: number;
    cohorts: number;
    assertions: number;
  }>;
  truncated: boolean;
  limitations: readonly string[];
}>;

export type CampaignCohortReviewInput = Readonly<{
  domains?: unknown;
  cases?: unknown;
  profiles?: unknown;
  relationshipSummary?: CaseRelationshipSummary | null;
  selectedBrandProfileId?: unknown;
  sourceStates?: Readonly<{
    cases?: CampaignCohortSourceState;
    profiles?: CampaignCohortSourceState;
    relationships?: CampaignCohortSourceState;
  }>;
}>;

const MAX_CASE_INPUTS = MAX_CASES;
const MAX_PROFILE_INPUTS = MAX_PROFILES;
const MAX_RELATIONSHIP_INPUTS = MAX_CASE_RELATIONSHIP_GROUPS;
const MAX_RATIONALES_PER_KIND = MAX_CAMPAIGN_COHORT_RATIONALES / 4;
const MAX_ASSERTION_INPUTS = 500;
const MILLISECONDS_PER_DAY = 86_400_000;
const COMPLETENESS_RANK: Readonly<Record<CasePinCompleteness, number>> = Object.freeze({
  complete: 0,
  partial: 1,
  inconclusive: 2,
  unknown: 3,
});
const KINDS: readonly CampaignCohortRationaleKind[] = Object.freeze([
  'exact_link', 'bounded_similarity', 'temporal_cooccurrence', 'common_infrastructure',
]);
const COMMON_INFRASTRUCTURE_TYPES = new Set(['http_final_origin', 'ip_address', 'nameserver_set']);
const USABLE_PIN_SOURCE_STATES = new Set(['complete', 'partial', 'provided', 'registered', 'success', 'value']);
const CONTROL_REPLACE_RE = /[\u0000-\u001f\u007f]+/gu;

function text(value: unknown, maximum = 240): string {
  return typeof value === 'string'
    ? value.replace(CONTROL_REPLACE_RE, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum)
    : '';
}

function sourceState(value: unknown): CampaignCohortSourceState {
  if (value === undefined || value === 'ready') return 'ready';
  return value === 'loading' ? 'loading' : 'unavailable';
}

function registrarKey(value: unknown): string {
  return text(value, 200).toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim();
}

function publicationTime(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function worstCompleteness(values: readonly CasePinCompleteness[]): CasePinCompleteness {
  return values.reduce<CasePinCompleteness>((worst, value) => (
    COMPLETENESS_RANK[value] > COMPLETENESS_RANK[worst] ? value : worst
  ), 'complete');
}

function stableId(kind: string, parts: readonly string[]): string {
  return observationEnvelopeId(kind, parts.join('\u0000'));
}

function member(record: CaseRecord): CampaignCohortMember {
  return Object.freeze({ caseId: record.id, domain: record.domain });
}

function emptyCounts(): Record<CampaignCohortRationaleKind, number> {
  return { exact_link: 0, bounded_similarity: 0, temporal_cooccurrence: 0, common_infrastructure: 0 };
}

function matchingPin(record: CaseRecord, field: string, normalizedValue: string) {
  return [...record.evidencePins]
    .reverse()
    .find((pin) => {
      if (pin.field !== field || !['complete', 'partial'].includes(pin.completeness)) return false;
      if (!USABLE_PIN_SOURCE_STATES.has(text(pin.sourceState, 40).toLowerCase().replace(/\s+/gu, '_'))) return false;
      const normalized = field === 'registration.created' ? publicationTime(pin.value) ?? '' : registrarKey(pin.value);
      return normalized === normalizedValue;
    }) ?? null;
}

type RegistrationValue = Readonly<{
  record: CaseRecord;
  member: CampaignCohortMember;
  registrar: string;
  createdAt: string;
  completeness: CasePinCompleteness;
  sources: readonly string[];
  limitations: readonly string[];
}>;

function registrationValue(record: CaseRecord): RegistrationValue | null {
  const evidence = latestCaseEvidence(record);
  const registrar = registrarKey(evidence?.registrar);
  const createdAt = publicationTime(evidence?.createdDate);
  if (!registrar || !createdAt) return null;
  const registrarPin = matchingPin(record, 'registration.registrar', registrar);
  const createdPin = matchingPin(record, 'registration.created', createdAt);
  const matched = [registrarPin, createdPin].filter((value) => value !== null);
  const fallback = matched.length < 2;
  const pinTruncated = matched.some((pin) => pin!.truncated === true);
  return Object.freeze({
    record,
    member: member(record),
    registrar,
    createdAt,
    completeness: fallback ? 'unknown' : pinTruncated ? 'partial' : worstCompleteness(matched.map((pin) => pin!.completeness)),
    sources: Object.freeze(fallback
      ? [`${text(evidence?.source, 80) || 'Case'} compact evidence snapshot`]
      : [...new Set(matched.map((pin) => text(pin!.source, 120)).filter(Boolean))].sort()),
    limitations: Object.freeze(fallback
      ? ['Registrar or creation-date pin provenance was not retained for both values; the compact Case snapshot is used with unknown completeness.']
      : [...new Set([
        ...(pinTruncated ? ['At least one supporting registration pin was truncated; the temporal rationale is partial.'] : []),
        ...matched.flatMap((pin) => pin!.limitations.map((item) => text(item)).filter(Boolean)),
      ])].slice(0, 6)),
  });
}

function relationshipKind(type: string, value: string, commonality: unknown): CampaignCohortRationaleKind {
  if (type === 'favicon') return 'bounded_similarity';
  const catalogueMatch = type === 'ip_address' && classifyCommonInfrastructureAddress(value).length > 0;
  if (catalogueMatch || (COMMON_INFRASTRUCTURE_TYPES.has(type) && commonality === 'widespread')) {
    return 'common_infrastructure';
  }
  return 'exact_link';
}

function relationshipRationales(
  summary: CaseRelationshipSummary | null | undefined,
  allowed: ReadonlyMap<string, CampaignCohortMember>,
  omitted: { relationshipGroups: number; relationshipMembers: number; rationales: number },
): CampaignCohortRationale[] {
  const rawGroups = Array.isArray(summary?.groups) ? summary.groups : [];
  const groups = rawGroups.slice(0, MAX_RELATIONSHIP_INPUTS);
  omitted.relationshipGroups += Math.max(0, rawGroups.length - groups.length);
  const candidates: CampaignCohortRationale[] = [];
  for (const rawGroup of groups) {
    if (!rawGroup || typeof rawGroup !== 'object' || Array.isArray(rawGroup)) {
      omitted.relationshipGroups += 1;
      continue;
    }
    const group = rawGroup as CaseRelationshipGroup;
    const type = text(group.type, 80);
    const value = text(group.value, 500);
    if (!type || !value) { omitted.rationales += 1; continue; }
    const rawMembers = Array.isArray(group.cases) ? group.cases : [];
    const memberInputs = rawMembers.slice(0, MAX_CAMPAIGN_COHORT_MEMBERS * 2);
    omitted.relationshipMembers += Math.max(0, rawMembers.length - memberInputs.length);
    const members = [...new Map(memberInputs
      .slice(0, MAX_CAMPAIGN_COHORT_MEMBERS * 2)
      .map((item) => allowed.get(text(item.id, 64)))
      .filter((item): item is CampaignCohortMember => Boolean(item))
      .map((item) => [item.caseId, item])).values()]
      .sort((left, right) => left.domain.localeCompare(right.domain));
    if (members.length < 2) continue;
    const kind = relationshipKind(type, value, group.commonality);
    const sources = [...new Set((Array.isArray(group.sources) ? group.sources : []).slice(0, 20).map((item) => text(item, 120)).filter(Boolean))].sort();
    const limitations = [...new Set((Array.isArray(group.limitations) ? group.limitations : []).slice(0, 16).map((item) => text(item)).filter(Boolean))];
    if (kind === 'common_infrastructure' && type === 'ip_address') {
      for (const match of classifyCommonInfrastructureAddress(value).slice(0, 4).reverse()) {
        limitations.unshift(text(`Exact catalogue qualification: ${match.sourceLabel}; ${match.cidr}; source date ${match.sourceDate}; SHA-256 ${match.sourceDigestSha256}. ${match.limitation}`, 240));
      }
    } else if (kind === 'common_infrastructure') {
      limitations.unshift(text(group.commonalityExplanation, 240)
        || 'The bounded relationship summary qualified this value as widespread shared infrastructure; shared services can connect unrelated cases.');
    }
    candidates.push(Object.freeze({
      id: stableId('campaign-rationale', [kind, type, value, ...members.map((item) => item.caseId)]),
      kind,
      label: text(group.label, 120) || 'Retained relationship',
      method: text(group.method, 200) || 'Retained relationship observation',
      value,
      members: Object.freeze(members),
      sources: Object.freeze(sources),
      completeness: group.complete === true && group.truncated !== true ? 'complete' : group.complete === false || group.truncated === true ? 'partial' : 'unknown',
      firstPublishedAt: null,
      lastPublishedAt: null,
      spanDays: null,
      limitations: Object.freeze(limitations.slice(0, 8)),
    }));
  }
  const identityCounts = new Map<string, number>();
  for (const candidate of candidates) identityCounts.set(candidate.id, (identityCounts.get(candidate.id) ?? 0) + 1);
  const safeCandidates = candidates.filter((candidate) => identityCounts.get(candidate.id) === 1);
  omitted.rationales += candidates.length - safeCandidates.length;
  return KINDS.flatMap((kind) => {
    const sorted = safeCandidates.filter((candidate) => candidate.kind === kind)
      .sort((left, right) => left.label.localeCompare(right.label) || left.value.localeCompare(right.value) || left.id.localeCompare(right.id));
    omitted.rationales += Math.max(0, sorted.length - MAX_RATIONALES_PER_KIND);
    return sorted.slice(0, MAX_RATIONALES_PER_KIND);
  });
}

function temporalRationales(
  records: readonly CaseRecord[],
  omitted: { rationales: number },
): CampaignCohortRationale[] {
  const byRegistrar = new Map<string, RegistrationValue[]>();
  for (const record of records) {
    const value = registrationValue(record);
    if (value) byRegistrar.set(value.registrar, [...(byRegistrar.get(value.registrar) ?? []), value]);
  }
  const output: CampaignCohortRationale[] = [];
  for (const [registrar, values] of [...byRegistrar.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const ordered = values.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.member.domain.localeCompare(right.member.domain));
    const edges: Array<{ source: string; target: string }> = [];
    for (let left = 0; left < ordered.length; left += 1) {
      for (let right = left + 1; right < ordered.length; right += 1) {
        const delta = Date.parse(ordered[right]!.createdAt) - Date.parse(ordered[left]!.createdAt);
        if (delta > CAMPAIGN_REGISTRATION_WINDOW_DAYS * MILLISECONDS_PER_DAY) break;
        edges.push({ source: ordered[left]!.member.caseId, target: ordered[right]!.member.caseId });
      }
    }
    const byId = new Map(ordered.map((item) => [item.member.caseId, item]));
    for (const component of analyzeBoundedRelationshipGraph([...byId.keys()], edges).components) {
      if (component.length < 2) continue;
      if (output.length >= MAX_RATIONALES_PER_KIND) { omitted.rationales += 1; continue; }
      const items = component.map((id) => byId.get(id)!).sort((left, right) => left.member.domain.localeCompare(right.member.domain));
      const dates = items.map((item) => item.createdAt).sort();
      const spanDays = Math.round(((Date.parse(dates.at(-1)!) - Date.parse(dates[0]!)) / MILLISECONDS_PER_DAY) * 100) / 100;
      output.push(Object.freeze({
        id: stableId('campaign-rationale', ['temporal_cooccurrence', registrar, ...items.map((item) => `${item.member.caseId}:${item.createdAt}`)]),
        kind: 'temporal_cooccurrence',
        label: `Same registrar with creation publications linked within ${CAMPAIGN_REGISTRATION_WINDOW_DAYS} days`,
        method: `Exact normalised registrar plus pairwise retained creation-publication dates no more than ${CAMPAIGN_REGISTRATION_WINDOW_DAYS} days apart`,
        value: registrar,
        members: Object.freeze(items.map((item) => item.member)),
        sources: Object.freeze([...new Set(items.flatMap((item) => item.sources))].sort()),
        completeness: worstCompleteness(items.map((item) => item.completeness)),
        firstPublishedAt: dates[0]!,
        lastPublishedAt: dates.at(-1)!,
        spanDays,
        limitations: Object.freeze([...new Set([
          ...items.flatMap((item) => item.limitations),
          `The ${CAMPAIGN_REGISTRATION_WINDOW_DAYS}-day rule is pairwise; endpoints in a connected cohort can be farther apart. Creation dates are retained registry or WHOIS publications, not proof of registration by the same actor.`,
        ])].slice(0, 8)),
      }));
    }
  }
  return output.sort((left, right) => left.value.localeCompare(right.value) || (left.firstPublishedAt ?? '').localeCompare(right.firstPublishedAt ?? '') || left.id.localeCompare(right.id));
}

function cohortAssertions(records: readonly CaseRecord[], omissions: { assertions: number }): CampaignCohortAssertionContext[] {
  const candidates: CampaignCohortAssertionContext[] = [];
  let inspected = 0;
  for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
    const record = records[recordIndex]!;
    for (let assertionIndex = 0; assertionIndex < record.assertions.length; assertionIndex += 1) {
      if (inspected >= MAX_ASSERTION_INPUTS) {
        omissions.assertions += record.assertions.length - assertionIndex;
        for (const remaining of records.slice(recordIndex + 1)) omissions.assertions += remaining.assertions.length;
        candidates.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.domain.localeCompare(right.domain) || left.id.localeCompare(right.id));
        omissions.assertions += Math.max(0, candidates.length - MAX_CAMPAIGN_COHORT_ASSERTIONS);
        return candidates.slice(0, MAX_CAMPAIGN_COHORT_ASSERTIONS);
      }
      const assertion = record.assertions[assertionIndex]!;
      inspected += 1;
      const relations = assertion.evidenceRelations ?? [];
      candidates.push(Object.freeze({
        id: `${record.id}:${assertion.id}`,
        caseId: record.id,
        domain: record.domain,
        kind: text(assertion.kind, 40),
        state: text(assertion.state, 40),
        statement: text(assertion.statement, 1_000),
        updatedAt: text(assertion.updatedAt, 64),
        supports: relations.filter((item) => item.stance === 'supports').length,
        contradicts: relations.filter((item) => item.stance === 'contradicts').length,
        unresolved: relations.filter((item) => item.stance === 'unresolved').length,
      }));
    }
  }
  candidates.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.domain.localeCompare(right.domain) || left.id.localeCompare(right.id));
  omissions.assertions += Math.max(0, candidates.length - MAX_CAMPAIGN_COHORT_ASSERTIONS);
  return candidates.slice(0, MAX_CAMPAIGN_COHORT_ASSERTIONS);
}

export function buildCampaignCohortReview(input: CampaignCohortReviewInput): CampaignCohortReview {
  const sources = Object.freeze({
    cases: sourceState(input.sourceStates?.cases),
    profiles: sourceState(input.sourceStates?.profiles),
    relationships: sourceState(input.sourceStates?.relationships),
  });
  const omissions = { campaignMembers: 0, caseInputs: 0, profileInputs: 0, relationshipGroups: 0, relationshipMembers: 0, rationales: 0, cohorts: 0, assertions: 0 };
  const rawDomains = Array.isArray(input.domains) ? input.domains : [];
  const domains = [...new Set(rawDomains.slice(0, MAX_CAMPAIGN_COHORT_MEMBERS * 2).map(normalizeDomain).filter(Boolean))].slice(0, MAX_CAMPAIGN_COHORT_MEMBERS);
  omissions.campaignMembers = Math.max(0, rawDomains.length - domains.length);
  const rawCases = Array.isArray(input.cases) ? input.cases : [];
  const cases = normalizeCaseStore(rawCases.slice(0, MAX_CASE_INPUTS)).cases;
  omissions.caseInputs = Math.max(0, rawCases.length - cases.length);
  const byDomain = new Map(cases.map((record) => [normalizeDomain(record?.domain), record]).filter(([domain]) => Boolean(domain)) as Array<[string, CaseRecord]>);
  const linked = sources.cases === 'ready' ? domains.map((domain) => byDomain.get(domain)).filter((item): item is CaseRecord => Boolean(item)) : [];
  const rawProfiles = Array.isArray(input.profiles) ? input.profiles : [];
  const profiles = normalizeBrandProfileStore(rawProfiles.slice(0, MAX_PROFILE_INPUTS)).profiles;
  omissions.profileInputs = Math.max(0, rawProfiles.length - profiles.length);
  const profilesById = sources.profiles === 'ready'
    ? new Map(profiles.map((profile) => [normalizeOpaqueReferenceId(profile?.id), profile]).filter(([id]) => Boolean(id)) as Array<[string, BrandProfile]>)
    : new Map<string, BrandProfile>();
  const optionCounts = new Map<string, number>();
  for (const record of linked) for (const id of normalizeCaseBrandProfileIds(record.brandProfileIds)) optionCounts.set(id, (optionCounts.get(id) ?? 0) + 1);
  const scopeOptions = [...optionCounts.entries()].map(([id, memberCount]) => {
    const profile = profilesById.get(id);
    return Object.freeze({
      id,
      name: profile ? text(profile.name, 100) : null,
      memberCount,
      state: sources.profiles !== 'ready' || (!profile && omissions.profileInputs > 0) ? 'details_unavailable' as const : profile ? 'ready' as const : 'unresolved' as const,
    });
  }).sort((left, right) => (left.name ?? left.id).localeCompare(right.name ?? right.id));
  const selectedId = normalizeOpaqueReferenceId(input.selectedBrandProfileId);
  const selectedScope = selectedId ? scopeOptions.find((item) => item.id === selectedId) ?? null : null;
  const scopedRecords = selectedScope ? linked.filter((record) => normalizeCaseBrandProfileIds(record.brandProfileIds).includes(selectedScope.id)).slice(0, MAX_CAMPAIGN_COHORT_MEMBERS) : [];
  const allowed = new Map(scopedRecords.map((record) => [record.id, member(record)]));
  const rationaleCandidates = selectedScope ? [
    ...relationshipRationales(input.relationshipSummary, allowed, omissions),
    ...temporalRationales(scopedRecords, omissions),
  ] : [];
  const rationaleIdentityCounts = new Map<string, number>();
  for (const candidate of rationaleCandidates) rationaleIdentityCounts.set(candidate.id, (rationaleIdentityCounts.get(candidate.id) ?? 0) + 1);
  const uniqueRationales = rationaleCandidates.filter((candidate) => rationaleIdentityCounts.get(candidate.id) === 1);
  omissions.rationales += rationaleCandidates.length - uniqueRationales.length;
  const rationales = uniqueRationales.slice(0, MAX_CAMPAIGN_COHORT_RATIONALES);
  omissions.rationales += Math.max(0, uniqueRationales.length - rationales.length);
  const edges = rationales.flatMap((rationale) => {
    const first = rationale.members[0];
    return first ? rationale.members.slice(1).map((item) => ({ source: first.caseId, target: item.caseId })) : [];
  });
  const graph = analyzeBoundedRelationshipGraph([...allowed.keys()], edges);
  const allCohorts = graph.components.flatMap((component) => {
    if (component.length < 2) return [];
    const componentIds = new Set(component);
    const members = component.map((id) => allowed.get(id)!).sort((left, right) => left.domain.localeCompare(right.domain));
    const related = rationales.filter((item) => item.members.some((candidate) => componentIds.has(candidate.caseId)));
    const counts = emptyCounts();
    for (const rationale of related) counts[rationale.kind] += 1;
    return [Object.freeze({
      id: stableId('campaign-cohort', [...members.map((item) => item.caseId), ...related.map((item) => item.id)]),
      members: Object.freeze(members),
      rationales: Object.freeze(related),
      rationaleCounts: Object.freeze(counts),
    })];
  }).sort((left, right) => right.members.length - left.members.length || right.rationales.length - left.rationales.length || left.members[0]!.domain.localeCompare(right.members[0]!.domain));
  omissions.cohorts = Math.max(0, allCohorts.length - MAX_CAMPAIGN_COHORTS);
  const cohorts = allCohorts.slice(0, MAX_CAMPAIGN_COHORTS);
  const groupedIds = new Set(cohorts.flatMap((cohort) => cohort.members.map((item) => item.caseId)));
  const ungroupedMembers = [...allowed.values()].filter((item) => !groupedIds.has(item.caseId)).sort((left, right) => left.domain.localeCompare(right.domain));
  const assertions = selectedScope ? cohortAssertions(scopedRecords, omissions) : [];
  const rationaleCounts = emptyCounts();
  for (const rationale of rationales) rationaleCounts[rationale.kind] += 1;
  const truncated = graph.truncated || Object.values(omissions).some((value) => value > 0) || input.relationshipSummary?.truncated === true;
  const state = sources.cases === 'unavailable'
    ? 'unavailable'
    : sources.cases === 'loading' || sources.profiles === 'loading'
      ? 'loading'
      : !selectedScope
        ? 'unselected'
        : selectedScope.state !== 'ready' || sources.profiles === 'unavailable' || sources.relationships !== 'ready' || truncated
          ? 'partial'
          : 'ready';
  return Object.freeze({
    version: CAMPAIGN_COHORT_REVIEW_VERSION,
    state,
    sources,
    scopeOptions: Object.freeze(scopeOptions),
    selectedScope,
    memberCount: domains.length,
    linkedCaseCount: linked.length,
    scopedCaseCount: scopedRecords.length,
    cohorts: Object.freeze(cohorts),
    ungroupedMembers: Object.freeze(ungroupedMembers),
    assertions: Object.freeze(assertions),
    rationaleCounts: Object.freeze(rationaleCounts),
    upstreamRelationshipTruncated: input.relationshipSummary?.truncated === true,
    omissions: Object.freeze(omissions),
    truncated,
    limitations: Object.freeze([
      'Cohorts use only exact analyst-selected Case to Brand Profile identifiers and already retained local evidence. Profile names, domains, tags, and evidence values never infer scope.',
      'Exact links, bounded similarity, temporal co-occurrence, and common-infrastructure context are separate review rationales. No numeric score or confidence is produced.',
      'Shared infrastructure, similar presentation, registrar publication, and time proximity do not prove common ownership, coordination, attribution, intent, safety, or maliciousness.',
      'Analyst assertions are shown separately for context and never influence rationale generation, connectivity, cohort identity, ordering, or counts.',
      'Missing, malformed, unavailable, over-limit, or unretained evidence remains unavailable or omitted rather than becoming a negative finding.',
      ...(sources.relationships === 'unavailable' ? ['Retained relationship observations could not be read; Case-derived relationships may remain visible, but the cohort review is partial.'] : []),
      ...(sources.relationships === 'loading' ? ['Retained relationship observations are still loading; any visible Case-derived rationale is provisional and the cohort review is partial.'] : []),
      ...(sources.profiles === 'unavailable' ? ['Brand Profile details could not be read; exact Case-held identifiers remain selectable without implying that a profile was deleted.'] : []),
    ]),
  });
}
