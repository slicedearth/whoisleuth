import { canonicalRegistrableDomain } from '../../lib/registrable-domain.mts';
import {
  CASE_SCHEMA_VERSION,
  MAX_EVIDENCE_SNAPSHOTS_PER_CASE,
  normalizeEvidenceDomain,
  type CaseEvidenceSnapshot,
  type CaseRecord,
} from '../cases/case-model.mts';
import {
  MAX_CAMPAIGN_DOMAINS,
  type CampaignRecord,
} from '../workspace/campaign-model.mts';
import {
  assertWorkspaceInputGraph,
  ordinaryWorkspaceRecord,
} from '../workspace/hostile-input.mts';
import {
  MAX_PARENT_DOMAIN_CAMPAIGN_REVIEW_BYTES,
  PARENT_DOMAIN_CAMPAIGN_REVIEW_SCHEMA,
  PARENT_DOMAIN_CAMPAIGN_REVIEW_VERSION,
} from '../contracts/investigation-projections.mts';

export {
  MAX_PARENT_DOMAIN_CAMPAIGN_REVIEW_BYTES,
  PARENT_DOMAIN_CAMPAIGN_REVIEW_SCHEMA,
  PARENT_DOMAIN_CAMPAIGN_REVIEW_VERSION,
} from '../contracts/investigation-projections.mts';

export const MAX_PARENT_DOMAIN_SOURCE_RECORDS = 500;
export const MAX_PARENT_DOMAIN_LINKED_CASES = MAX_CAMPAIGN_DOMAINS;
export const MAX_PARENT_DOMAIN_OBSERVATIONS = 300;
export const MAX_PARENT_DOMAIN_HOSTNAMES = 200;
export const MAX_PARENT_DOMAIN_PARENTS = 25;
export const MAX_PARENT_DOMAIN_PROVENANCE_PER_HOSTNAME = 25;
export const MAX_PARENT_DOMAIN_LIMITATIONS = 8;

export type ParentDomainCampaignSourceState =
  | 'future_schema'
  | 'loading'
  | 'partial'
  | 'ready'
  | 'unavailable'
  | 'unsupported';
export type ParentDomainCampaignReviewState =
  | ParentDomainCampaignSourceState
  | 'insufficient_evidence';
export type ParentDomainObservationCompleteness = 'complete' | 'partial' | 'unknown';

export type ParentDomainHostnameObservation = Readonly<{
  id: string;
  hostname: string;
  registrableParent: string;
  caseId: string;
  caseDomain: string;
  campaignId: string;
  campaignMemberDomain: string;
  source: string;
  store: 'browser_case_evidence_snapshot' | 'browser_case_record';
  snapshotId: string | null;
  observationTime: string | null;
  localRetentionTime: string | null;
  scanDepth: string;
  completeness: ParentDomainObservationCompleteness;
  truncated: boolean;
  schemaVersion: number;
  limitations: readonly string[];
}>;

export type ParentDomainHostnameReview = Readonly<{
  hostname: string;
  registrableParent: string;
  kind: 'apex' | 'child';
  affectedCaseIds: readonly string[];
  observations: readonly ParentDomainHostnameObservation[];
  observationCount: number;
  completeness: ParentDomainObservationCompleteness;
  truncated: boolean;
  limitations: readonly string[];
}>;

export type ParentDomainGroupReview = Readonly<{
  registrableParent: string;
  hostnames: readonly ParentDomainHostnameReview[];
  hostnameCount: number;
  childHostnameCount: number;
  affectedCaseIds: readonly string[];
  affectedCaseDomains: readonly string[];
  campaignMemberDomains: readonly string[];
  observationCount: number;
  completeness: ParentDomainObservationCompleteness;
  truncated: boolean;
  limitations: readonly string[];
}>;

export type ParentDomainReviewCounts = Readonly<{
  campaignMembers: number;
  linkedCases: number;
  sourceSnapshotRecords: number;
  acceptedObservations: number;
  distinctHostnames: number;
  qualifyingParents: number;
}>;

export type ParentDomainReviewOmissions = Readonly<{
  sourceRecords: number;
  campaignMembers: number;
  caseRecords: number;
  snapshotRecords: number;
  observations: number;
  hostnames: number;
  parents: number;
  provenance: number;
  limitations: number;
}>;

export type ParentDomainCampaignReview = Readonly<{
  version: 1;
  caseSchemaVersion: number;
  state: ParentDomainCampaignReviewState;
  sourceState: ParentDomainCampaignSourceState;
  campaign: Readonly<{ id: string; name: string }>;
  counts: ParentDomainReviewCounts;
  omissions: ParentDomainReviewOmissions;
  parents: readonly ParentDomainGroupReview[];
  limitations: readonly string[];
}>;

type MutableOmissions = {
  sourceRecords: number;
  campaignMembers: number;
  caseRecords: number;
  snapshotRecords: number;
  observations: number;
  hostnames: number;
  parents: number;
  provenance: number;
  limitations: number;
};

const BASE_LIMITATIONS = Object.freeze([
  'This review uses only exact hostnames deliberately retained in browser-local Cases and makes no request.',
  'A snapshot capture time is a point-in-time local observation, not global first-seen, service activation, ownership, or continuous monitoring.',
  'Namespace hierarchy does not establish common ownership, operator, authorship, coordination, intent, compromise, safety, or maliciousness.',
  'Certificate coverage, shared addresses, nameservers, HTTP behaviour, page similarity, official-asset relationships, tracking identifiers, and analyst assertions do not create or strengthen this relationship.',
] as const);

const NON_READY_LIMITATIONS: Readonly<Record<Exclude<ParentDomainCampaignSourceState, 'partial' | 'ready'>, string>> = Object.freeze({
  loading: 'Browser-local Case evidence is still loading; no hostname absence or count is inferred.',
  unavailable: 'Browser-local Case evidence is unavailable; no hostname absence or count is inferred.',
  unsupported: 'The available Case source does not support this review; no hostname absence or count is inferred.',
  future_schema: 'The Case source uses a future schema and remains untouched; no hostname evidence was interpreted.',
});

const COMPLETENESS_RANK: Readonly<Record<ParentDomainObservationCompleteness, number>> = Object.freeze({
  complete: 0,
  partial: 1,
  unknown: 2,
});

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function text(value: unknown, maximum: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum)
    : '';
}

function exactTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function emptyOmissions(): MutableOmissions {
  return {
    sourceRecords: 0,
    campaignMembers: 0,
    caseRecords: 0,
    snapshotRecords: 0,
    observations: 0,
    hostnames: 0,
    parents: 0,
    provenance: 0,
    limitations: 0,
  };
}

function addLimitation(target: string[], omissions: MutableOmissions, value: unknown): void {
  const limitation = text(value, 240);
  if (!limitation || target.includes(limitation)) return;
  if (target.length >= MAX_PARENT_DOMAIN_LIMITATIONS) {
    omissions.limitations += 1;
    return;
  }
  target.push(limitation);
}

function completenessForSnapshot(snapshot: CaseEvidenceSnapshot): ParentDomainObservationCompleteness {
  if (snapshot.scanDepth === 'deep' || snapshot.scanDepth === 'fast') return 'complete';
  return 'unknown';
}

function leastComplete(values: readonly ParentDomainObservationCompleteness[]): ParentDomainObservationCompleteness {
  return values.reduce<ParentDomainObservationCompleteness>((least, value) => (
    COMPLETENESS_RANK[value] > COMPLETENESS_RANK[least] ? value : least
  ), 'complete');
}

function sourceName(value: unknown): string {
  const normalized = text(value, 80).toLowerCase();
  return ['bulk', 'import', 'lookup', 'manual', 'monitor', 'unknown'].includes(normalized)
    ? normalized
    : 'unknown';
}

function observationId(parts: readonly (string | null)[]): string {
  let hash = 2166136261 >>> 0;
  for (const character of parts.join('\u0000')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `hostname-observation-${hash.toString(36)}`;
}

function freezeObservation(value: ParentDomainHostnameObservation): ParentDomainHostnameObservation {
  return Object.freeze({ ...value, limitations: Object.freeze([...value.limitations]) });
}

function campaignIdentity(value: unknown): { id: string; name: string; domains: unknown[] } {
  const record = ordinaryWorkspaceRecord(value, 'Parent-domain campaign') ?? {};
  return {
    id: text(record.id, 64),
    name: text(record.name, 100),
    domains: Array.isArray(record.domains) ? record.domains : [],
  };
}

function nonReadyReview(
  campaign: { id: string; name: string },
  sourceState: Exclude<ParentDomainCampaignSourceState, 'partial' | 'ready'>,
): ParentDomainCampaignReview {
  return Object.freeze({
    version: 1,
    caseSchemaVersion: CASE_SCHEMA_VERSION,
    state: sourceState,
    sourceState,
    campaign: Object.freeze(campaign),
    counts: Object.freeze({ campaignMembers: 0, linkedCases: 0, sourceSnapshotRecords: 0, acceptedObservations: 0, distinctHostnames: 0, qualifyingParents: 0 }),
    omissions: Object.freeze(emptyOmissions()),
    parents: Object.freeze([]),
    limitations: Object.freeze([...BASE_LIMITATIONS, NON_READY_LIMITATIONS[sourceState]]),
  });
}

function snapshotObservation(
  snapshot: CaseEvidenceSnapshot,
  caseRecord: CaseRecord,
  memberDomain: string,
  campaign: { id: string; name: string },
): ParentDomainHostnameObservation | null {
  const hostname = normalizeEvidenceDomain(snapshot.inputHostname);
  const caseDomain = normalizeEvidenceDomain(caseRecord.domain);
  const parent = hostname ? canonicalRegistrableDomain(hostname) : null;
  const caseParent = caseDomain ? canonicalRegistrableDomain(caseDomain) : null;
  if (!hostname || !caseDomain || !parent || parent !== caseParent) return null;
  const observationTime = exactTimestamp(snapshot.capturedAt);
  if (!observationTime) return null;
  const localRetentionTime = exactTimestamp(snapshot.firstCapturedAt);
  const limitations = [
    'The submitted hostname was retained on this exact Case evidence snapshot.',
    'The capture time is local point-in-time observation context, not global first-seen or continuous monitoring.',
    ...(localRetentionTime && localRetentionTime !== observationTime
      ? ['Repeated identical material retained the earliest and latest local capture times on one bounded snapshot.']
      : []),
  ];
  const source = sourceName(snapshot.source);
  return freezeObservation({
    id: observationId([hostname, caseRecord.id, snapshot.id, observationTime, localRetentionTime]),
    hostname,
    registrableParent: parent,
    caseId: text(caseRecord.id, 64),
    caseDomain,
    campaignId: campaign.id,
    campaignMemberDomain: memberDomain,
    source,
    store: 'browser_case_evidence_snapshot',
    snapshotId: text(snapshot.id, 64) || null,
    observationTime,
    localRetentionTime,
    scanDepth: ['deep', 'fast', 'unknown'].includes(snapshot.scanDepth) ? snapshot.scanDepth : 'unknown',
    completeness: completenessForSnapshot(snapshot),
    truncated: false,
    schemaVersion: CASE_SCHEMA_VERSION,
    limitations: Object.freeze(limitations),
  });
}

function directCaseObservation(
  caseRecord: CaseRecord,
  memberDomain: string,
  campaign: { id: string; name: string },
): ParentDomainHostnameObservation | null {
  const hostname = normalizeEvidenceDomain(caseRecord.domain);
  const parent = hostname ? canonicalRegistrableDomain(hostname) : null;
  if (!hostname || !parent || hostname === parent) return null;
  const localRetentionTime = exactTimestamp(caseRecord.createdAt);
  if (!localRetentionTime) return null;
  return freezeObservation({
    id: observationId([hostname, caseRecord.id, 'case-record', localRetentionTime]),
    hostname,
    registrableParent: parent,
    caseId: text(caseRecord.id, 64),
    caseDomain: hostname,
    campaignId: campaign.id,
    campaignMemberDomain: memberDomain,
    source: sourceName(caseRecord.source),
    store: 'browser_case_record',
    snapshotId: null,
    observationTime: null,
    localRetentionTime,
    scanDepth: 'unknown',
    completeness: 'complete',
    truncated: false,
    schemaVersion: CASE_SCHEMA_VERSION,
    limitations: Object.freeze([
      'This exact child hostname is the directly retained Case target.',
      'The Case creation time is local retention time, not a global observation or service-activation time.',
    ]),
  });
}

function observationSort(left: ParentDomainHostnameObservation, right: ParentDomainHostnameObservation): number {
  return compareCodeUnits(left.registrableParent, right.registrableParent)
    || compareCodeUnits(left.hostname, right.hostname)
    || compareCodeUnits(left.caseDomain, right.caseDomain)
    || compareCodeUnits(left.caseId, right.caseId)
    || compareCodeUnits(left.observationTime ?? '', right.observationTime ?? '')
    || compareCodeUnits(left.localRetentionTime ?? '', right.localRetentionTime ?? '')
    || compareCodeUnits(left.store, right.store)
    || compareCodeUnits(left.snapshotId ?? '', right.snapshotId ?? '')
    || compareCodeUnits(left.id, right.id);
}

function deduplicateObservations(values: readonly ParentDomainHostnameObservation[]): ParentDomainHostnameObservation[] {
  const byIdentity = new Map<string, ParentDomainHostnameObservation>();
  for (const value of [...values].sort(observationSort)) {
    const key = [
      value.hostname, value.registrableParent, value.caseId, value.caseDomain,
      value.campaignMemberDomain, value.source, value.store, value.snapshotId,
      value.observationTime, value.localRetentionTime, value.scanDepth,
      value.completeness, String(value.truncated), String(value.schemaVersion),
    ].join('\u0000');
    if (!byIdentity.has(key)) byIdentity.set(key, value);
  }
  return [...byIdentity.values()];
}

function groupHostnames(
  observations: readonly ParentDomainHostnameObservation[],
  omissions: MutableOmissions,
): ParentDomainHostnameReview[] {
  const byHostname = new Map<string, ParentDomainHostnameObservation[]>();
  for (const item of observations) {
    const key = `${item.registrableParent}\u0000${item.hostname}`;
    byHostname.set(key, [...(byHostname.get(key) ?? []), item]);
  }
  const keys = [...byHostname.keys()].sort((left, right) => {
    const [leftParent = '', leftHostname = ''] = left.split('\u0000');
    const [rightParent = '', rightHostname = ''] = right.split('\u0000');
    return compareCodeUnits(leftParent, rightParent)
      || Number(leftHostname !== leftParent) - Number(rightHostname !== rightParent)
      || compareCodeUnits(leftHostname, rightHostname);
  });
  return keys.map((key) => {
    const [parent = '', hostname = ''] = key.split('\u0000');
    const all = [...(byHostname.get(key) ?? [])].sort(observationSort);
    const visible = all.slice(0, MAX_PARENT_DOMAIN_PROVENANCE_PER_HOSTNAME);
    const provenanceOmitted = Math.max(0, all.length - visible.length);
    omissions.provenance += provenanceOmitted;
    const allLimitations = [...new Set(visible.flatMap((item) => item.limitations))].sort();
    const provenanceLimitation = provenanceOmitted
      ? `${provenanceOmitted} contributing provenance record${provenanceOmitted === 1 ? ' was' : 's were'} omitted by the per-hostname bound.`
      : null;
    const limitationCapacity = MAX_PARENT_DOMAIN_LIMITATIONS - (provenanceLimitation ? 1 : 0);
    omissions.limitations += Math.max(0, allLimitations.length - limitationCapacity);
    const limitations = [
      ...allLimitations.slice(0, limitationCapacity),
      ...(provenanceLimitation ? [provenanceLimitation] : []),
    ];
    return Object.freeze({
      hostname,
      registrableParent: parent,
      kind: hostname === parent ? 'apex' as const : 'child' as const,
      affectedCaseIds: Object.freeze([...new Set(visible.map((item) => item.caseId))].sort()),
      observations: Object.freeze(visible),
      observationCount: all.length,
      completeness: leastComplete(visible.map((item) => item.completeness)),
      truncated: provenanceOmitted > 0 || visible.some((item) => item.truncated),
      limitations: Object.freeze(limitations),
    });
  });
}

function groupParents(
  hostnames: readonly ParentDomainHostnameReview[],
  omissions: MutableOmissions,
): ParentDomainGroupReview[] {
  const byParent = new Map<string, ParentDomainHostnameReview[]>();
  for (const item of hostnames) byParent.set(item.registrableParent, [...(byParent.get(item.registrableParent) ?? []), item]);
  const qualifying = [...byParent.entries()].filter(([, items]) => (
    new Set(items.map((item) => item.hostname)).size >= 2
    && items.some((item) => item.kind === 'child')
  )).sort(([left], [right]) => compareCodeUnits(left, right));
  omissions.parents += Math.max(0, qualifying.length - MAX_PARENT_DOMAIN_PARENTS);
  const selected = qualifying.slice(0, MAX_PARENT_DOMAIN_PARENTS);
  const visibleByParent = new Map<string, ParentDomainHostnameReview[]>();
  let hostnameBudget = MAX_PARENT_DOMAIN_HOSTNAMES;
  for (const [parent, items] of selected) {
    const required = items.slice(0, 2);
    visibleByParent.set(parent, [...required]);
    hostnameBudget -= required.length;
  }
  for (const [parent, items] of selected) {
    const visible = visibleByParent.get(parent) ?? [];
    const additional = items.slice(2, 2 + Math.max(0, hostnameBudget));
    visible.push(...additional);
    hostnameBudget -= additional.length;
  }
  const visibleHostnameCount = [...visibleByParent.values()].reduce((total, items) => total + items.length, 0);
  const qualifyingHostnameCount = qualifying.reduce((total, [, items]) => total + items.length, 0);
  omissions.hostnames += Math.max(0, qualifyingHostnameCount - visibleHostnameCount);
  return selected.map(([parent, allItems]) => {
    const items = visibleByParent.get(parent) ?? [];
    const hostnameGroupsOmitted = allItems.length - items.length;
    const observations = items.flatMap((item) => item.observations);
    const allLimitations = [...new Set(items.flatMap((item) => item.limitations))].sort();
    const hostnameLimitation = hostnameGroupsOmitted
      ? `${hostnameGroupsOmitted} exact hostname group${hostnameGroupsOmitted === 1 ? ' was' : 's were'} omitted from this parent by the campaign hostname bound.`
      : null;
    const limitationCapacity = MAX_PARENT_DOMAIN_LIMITATIONS - (hostnameLimitation ? 1 : 0);
    omissions.limitations += Math.max(0, allLimitations.length - limitationCapacity);
    const limitations = [
      ...allLimitations.slice(0, limitationCapacity),
      ...(hostnameLimitation ? [hostnameLimitation] : []),
    ];
    return Object.freeze({
      registrableParent: parent,
      hostnames: Object.freeze([...items].sort((left, right) => (
        Number(left.kind === 'child') - Number(right.kind === 'child') || compareCodeUnits(left.hostname, right.hostname)
      ))),
      hostnameCount: items.length,
      childHostnameCount: items.filter((item) => item.kind === 'child').length,
      affectedCaseIds: Object.freeze([...new Set(observations.map((item) => item.caseId))].sort()),
      affectedCaseDomains: Object.freeze([...new Set(observations.map((item) => item.caseDomain))].sort()),
      campaignMemberDomains: Object.freeze([...new Set(observations.map((item) => item.campaignMemberDomain))].sort()),
      observationCount: items.reduce((total, item) => total + item.observationCount, 0),
      completeness: leastComplete(items.map((item) => item.completeness)),
      truncated: hostnameGroupsOmitted > 0 || items.some((item) => item.truncated),
      limitations: Object.freeze(limitations),
    });
  });
}

export function buildParentDomainCampaignReview(
  campaignValue: unknown,
  recordsValue: unknown,
  sourceState: ParentDomainCampaignSourceState = 'ready',
): ParentDomainCampaignReview {
  if (!['future_schema', 'loading', 'partial', 'ready', 'unavailable', 'unsupported'].includes(sourceState)) {
    throw new TypeError('The parent-domain campaign review source state is invalid.');
  }
  if (sourceState !== 'ready' && sourceState !== 'partial') {
    const identity = campaignValue && typeof campaignValue === 'object'
      ? campaignIdentity(campaignValue)
      : { id: '', name: '', domains: [] };
    return nonReadyReview({ id: identity.id, name: identity.name }, sourceState);
  }

  assertWorkspaceInputGraph({ campaign: campaignValue, records: recordsValue }, 'Parent-domain campaign review input');
  const campaign = campaignIdentity(campaignValue);
  const omissions = emptyOmissions();
  const limitations = [...BASE_LIMITATIONS];
  const rawMembers = campaign.domains;
  omissions.campaignMembers += Math.max(0, rawMembers.length - MAX_CAMPAIGN_DOMAINS);
  const memberDomains: string[] = [];
  const memberSeen = new Set<string>();
  for (const value of rawMembers.slice(0, MAX_CAMPAIGN_DOMAINS)) {
    const domain = normalizeEvidenceDomain(value);
    if (!domain || memberSeen.has(domain)) {
      omissions.campaignMembers += 1;
      continue;
    }
    memberSeen.add(domain);
    memberDomains.push(domain);
  }
  memberDomains.sort();

  const rawRecords = Array.isArray(recordsValue) ? recordsValue : [];
  omissions.sourceRecords += Math.max(0, rawRecords.length - MAX_PARENT_DOMAIN_SOURCE_RECORDS);
  const eligibleRecords: CaseRecord[] = [];
  for (const value of rawRecords.slice(0, MAX_PARENT_DOMAIN_SOURCE_RECORDS)) {
    const record = ordinaryWorkspaceRecord(value, 'Parent-domain Case record');
    const domain = normalizeEvidenceDomain(record?.domain);
    const id = text(record?.id, 64);
    if (!record || !domain || !id || !memberSeen.has(domain) || !Array.isArray(record.evidenceHistory)) continue;
    eligibleRecords.push(value as CaseRecord);
  }
  eligibleRecords.sort((left, right) => compareCodeUnits(left.domain, right.domain) || compareCodeUnits(left.id, right.id));
  const linked: Array<{ record: CaseRecord; memberDomain: string }> = [];
  const linkedDomains = new Set<string>();
  for (const record of eligibleRecords) {
    if (linkedDomains.has(record.domain) || linked.length >= MAX_PARENT_DOMAIN_LINKED_CASES) {
      omissions.caseRecords += 1;
      continue;
    }
    linkedDomains.add(record.domain);
    linked.push({ record, memberDomain: record.domain });
  }
  const unavailableMemberCount = memberDomains.filter((domain) => !linkedDomains.has(domain)).length;
  if (unavailableMemberCount) addLimitation(limitations, omissions, `${unavailableMemberCount} campaign member${unavailableMemberCount === 1 ? ' has' : 's have'} no exact linked Case in the available source.`);

  let sourceSnapshotRecords = 0;
  let snapshotsWithoutHostname = 0;
  let invalidSnapshotHostnames = 0;
  const collected: ParentDomainHostnameObservation[] = [];
  const acceptObservation = (value: ParentDomainHostnameObservation | null) => {
    if (!value) return;
    if (collected.length >= MAX_PARENT_DOMAIN_OBSERVATIONS) {
      omissions.observations += 1;
      return;
    }
    collected.push(value);
  };
  for (const item of linked) {
    const history = item.record.evidenceHistory;
    omissions.snapshotRecords += Math.max(0, history.length - MAX_EVIDENCE_SNAPSHOTS_PER_CASE);
    for (const snapshot of history.slice(0, MAX_EVIDENCE_SNAPSHOTS_PER_CASE)) {
      sourceSnapshotRecords += 1;
      if (snapshot.inputHostname === null || snapshot.inputHostname === undefined) {
        snapshotsWithoutHostname += 1;
        continue;
      }
      const observation = snapshotObservation(snapshot, item.record, item.memberDomain, campaign);
      if (!observation) invalidSnapshotHostnames += 1;
      acceptObservation(observation);
    }
    acceptObservation(directCaseObservation(item.record, item.memberDomain, campaign));
  }
  if (snapshotsWithoutHostname) addLimitation(limitations, omissions, `${snapshotsWithoutHostname} retained snapshot${snapshotsWithoutHostname === 1 ? ' has' : 's have'} no exact submitted hostname; none was reconstructed.`);
  if (invalidSnapshotHostnames) addLimitation(limitations, omissions, `${invalidSnapshotHostnames} retained hostname value${invalidSnapshotHostnames === 1 ? ' was' : 's were'} rejected because strict syntax, time, or registrable-parent binding did not validate.`);
  if (omissions.snapshotRecords) addLimitation(limitations, omissions, `${omissions.snapshotRecords} snapshot source record${omissions.snapshotRecords === 1 ? ' was' : 's were'} outside the per-Case review bound.`);
  if (omissions.observations) addLimitation(limitations, omissions, `${omissions.observations} validated hostname observation${omissions.observations === 1 ? ' was' : 's were'} omitted by the campaign observation bound.`);

  const observations = deduplicateObservations(collected);
  const hostnames = groupHostnames(observations, omissions);
  const parents = groupParents(hostnames, omissions);
  if (omissions.hostnames) addLimitation(limitations, omissions, `${omissions.hostnames} hostname group${omissions.hostnames === 1 ? ' was' : 's were'} omitted by the hostname bound.`);
  if (omissions.parents) addLimitation(limitations, omissions, `${omissions.parents} qualifying parent group${omissions.parents === 1 ? ' was' : 's were'} omitted by the parent bound.`);
  if (omissions.provenance) addLimitation(limitations, omissions, `${omissions.provenance} contributing provenance record${omissions.provenance === 1 ? ' was' : 's were'} omitted by per-hostname bounds.`);

  const hasPartialEvidence = sourceState === 'partial'
    || unavailableMemberCount > 0
    || snapshotsWithoutHostname > 0
    || invalidSnapshotHostnames > 0
    || Object.entries(omissions).some(([key, value]) => key !== 'limitations' && value > 0)
    || parents.some((parent) => parent.truncated || parent.completeness !== 'complete');
  const state: ParentDomainCampaignReviewState = parents.length
    ? hasPartialEvidence ? 'partial' : 'ready'
    : 'insufficient_evidence';
  if (!parents.length) addLimitation(limitations, omissions, 'Fewer than two distinct retained hostnames with at least one child hostname were available for one registrable parent; this is insufficient evidence, not proof that no child hostname exists.');

  return Object.freeze({
    version: 1,
    caseSchemaVersion: CASE_SCHEMA_VERSION,
    state,
    sourceState,
    campaign: Object.freeze({ id: campaign.id, name: campaign.name }),
    counts: Object.freeze({
      campaignMembers: memberDomains.length,
      linkedCases: linked.length,
      sourceSnapshotRecords,
      acceptedObservations: observations.length,
      distinctHostnames: parents.reduce((total, parent) => total + parent.hostnames.length, 0),
      qualifyingParents: parents.length,
    }),
    omissions: Object.freeze({ ...omissions }),
    parents: Object.freeze(parents),
    limitations: Object.freeze(limitations.slice(0, MAX_PARENT_DOMAIN_LIMITATIONS)),
  });
}

function exactRootKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key)) || allowed.some((key) => !Object.hasOwn(value, key))) {
    throw new TypeError(`${label} has missing or undeclared fields.`);
  }
}

function exactExportText(value: unknown, maximum: number, label: string, allowEmpty = false): string {
  const normalized = text(value, maximum);
  if (normalized !== value || (!allowEmpty && !normalized)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return normalized;
}

function exactExportCount(value: unknown, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value as number;
}

function exactExportStringList(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
  label: string,
): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) throw new TypeError(`${label} is invalid.`);
  const strings = value.map((item) => exactExportText(item, maximumLength, label));
  if (new Set(strings).size !== strings.length
    || strings.some((item, index) => index > 0 && compareCodeUnits(strings[index - 1]!, item) >= 0)) {
    throw new TypeError(`${label} must be unique and deterministically sorted.`);
  }
  return strings;
}

function validateExportLimitations(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_PARENT_DOMAIN_LIMITATIONS) {
    throw new TypeError(`${label} is invalid.`);
  }
  const limitations = value.map((item) => exactExportText(item, 240, label));
  if (new Set(limitations).size !== limitations.length) throw new TypeError(`${label} contains duplicates.`);
  return limitations;
}

const OBSERVATION_EXPORT_KEYS = Object.freeze([
  'id', 'hostname', 'registrableParent', 'caseId', 'caseDomain', 'campaignId', 'campaignMemberDomain',
  'source', 'store', 'snapshotId', 'observationTime', 'localRetentionTime', 'scanDepth', 'completeness',
  'truncated', 'schemaVersion', 'limitations',
] as const);
const HOSTNAME_EXPORT_KEYS = Object.freeze([
  'hostname', 'registrableParent', 'kind', 'affectedCaseIds', 'observations', 'observationCount',
  'completeness', 'truncated', 'limitations',
] as const);
const PARENT_EXPORT_KEYS = Object.freeze([
  'registrableParent', 'hostnames', 'hostnameCount', 'childHostnameCount', 'affectedCaseIds',
  'affectedCaseDomains', 'campaignMemberDomains', 'observationCount', 'completeness', 'truncated', 'limitations',
] as const);

function validateExportObservation(
  value: unknown,
  expectedParent: string,
  expectedHostname: string,
  campaignId: string,
  memberDomains: ReadonlySet<string>,
): Record<string, unknown> {
  const observation = ordinaryWorkspaceRecord(value, 'Parent-domain hostname observation');
  if (!observation) throw new TypeError('A parent-domain hostname observation is invalid.');
  exactRootKeys(observation, OBSERVATION_EXPORT_KEYS, 'A parent-domain hostname observation');
  exactExportText(observation.id, 80, 'The hostname observation identifier');
  const hostname = exactExportText(observation.hostname, 253, 'The observed hostname');
  const parent = exactExportText(observation.registrableParent, 253, 'The observed registrable parent');
  const caseId = exactExportText(observation.caseId, 64, 'The hostname observation Case identifier');
  const caseDomain = exactExportText(observation.caseDomain, 253, 'The hostname observation Case domain');
  const memberDomain = exactExportText(observation.campaignMemberDomain, 253, 'The hostname observation campaign member');
  if (hostname !== expectedHostname
    || parent !== expectedParent
    || normalizeEvidenceDomain(hostname) !== hostname
    || canonicalRegistrableDomain(hostname) !== parent
    || normalizeEvidenceDomain(caseDomain) !== caseDomain
    || canonicalRegistrableDomain(caseDomain) !== parent
    || normalizeEvidenceDomain(memberDomain) !== memberDomain
    || !memberDomains.has(memberDomain)
    || exactExportText(observation.campaignId, 64, 'The hostname observation campaign identifier') !== campaignId
    || !caseId) {
    throw new TypeError('A parent-domain hostname observation is outside its exact Case or campaign scope.');
  }
  if (!['bulk', 'import', 'lookup', 'manual', 'monitor', 'unknown'].includes(String(observation.source))
    || !['browser_case_evidence_snapshot', 'browser_case_record'].includes(String(observation.store))
    || !['deep', 'fast', 'unknown'].includes(String(observation.scanDepth))
    || !['complete', 'partial', 'unknown'].includes(String(observation.completeness))
    || typeof observation.truncated !== 'boolean'
    || observation.schemaVersion !== CASE_SCHEMA_VERSION) {
    throw new TypeError('A parent-domain hostname observation has invalid provenance state.');
  }
  validateExportLimitations(observation.limitations, 'The hostname observation limitations');
  const snapshotStore = observation.store === 'browser_case_evidence_snapshot';
  const snapshotId = observation.snapshotId;
  const observationTime = observation.observationTime;
  const localRetentionTime = observation.localRetentionTime;
  if (snapshotStore) {
    exactExportText(snapshotId, 64, 'The hostname observation snapshot identifier');
    if (exactTimestamp(observationTime) !== observationTime
      || (localRetentionTime !== null && exactTimestamp(localRetentionTime) !== localRetentionTime)) {
      throw new TypeError('A snapshot hostname observation has invalid retained times.');
    }
  } else if (snapshotId !== null
    || observationTime !== null
    || exactTimestamp(localRetentionTime) !== localRetentionTime
    || caseDomain !== hostname
    || hostname === parent) {
    throw new TypeError('A directly retained Case hostname observation has invalid provenance.');
  }
  return observation;
}

function validateExportHostname(
  value: unknown,
  expectedParent: string,
  campaignId: string,
  memberDomains: ReadonlySet<string>,
): Record<string, unknown> {
  const hostnameReview = ordinaryWorkspaceRecord(value, 'Parent-domain hostname review');
  if (!hostnameReview) throw new TypeError('A parent-domain hostname review is invalid.');
  exactRootKeys(hostnameReview, HOSTNAME_EXPORT_KEYS, 'A parent-domain hostname review');
  const hostname = exactExportText(hostnameReview.hostname, 253, 'The reviewed hostname');
  const parent = exactExportText(hostnameReview.registrableParent, 253, 'The reviewed hostname parent');
  if (parent !== expectedParent
    || normalizeEvidenceDomain(hostname) !== hostname
    || canonicalRegistrableDomain(hostname) !== parent
    || hostnameReview.kind !== (hostname === parent ? 'apex' : 'child')
    || !['complete', 'partial', 'unknown'].includes(String(hostnameReview.completeness))
    || typeof hostnameReview.truncated !== 'boolean') {
    throw new TypeError('A parent-domain hostname review has invalid grouping state.');
  }
  if (!Array.isArray(hostnameReview.observations)
    || hostnameReview.observations.length > MAX_PARENT_DOMAIN_PROVENANCE_PER_HOSTNAME) {
    throw new TypeError('A parent-domain hostname review has an invalid provenance collection.');
  }
  const observations = hostnameReview.observations.map((observation) => (
    validateExportObservation(observation, parent, hostname, campaignId, memberDomains)
  ));
  const affectedCaseIds = exactExportStringList(
    hostnameReview.affectedCaseIds,
    MAX_PARENT_DOMAIN_PROVENANCE_PER_HOSTNAME,
    64,
    'The reviewed hostname Case identifiers',
  );
  const expectedCaseIds = [...new Set(observations.map((observation) => String(observation.caseId)))].sort();
  if (JSON.stringify(affectedCaseIds) !== JSON.stringify(expectedCaseIds)
    || exactExportCount(hostnameReview.observationCount, MAX_PARENT_DOMAIN_OBSERVATIONS, 'The reviewed hostname observation count') < observations.length) {
    throw new TypeError('A parent-domain hostname review has inconsistent provenance counts.');
  }
  validateExportLimitations(hostnameReview.limitations, 'The reviewed hostname limitations');
  return hostnameReview;
}

function validateExportParent(
  value: unknown,
  campaignId: string,
  memberDomains: ReadonlySet<string>,
): Record<string, unknown> {
  const parentReview = ordinaryWorkspaceRecord(value, 'Parent-domain parent review');
  if (!parentReview) throw new TypeError('A parent-domain parent review is invalid.');
  exactRootKeys(parentReview, PARENT_EXPORT_KEYS, 'A parent-domain parent review');
  const parent = exactExportText(parentReview.registrableParent, 253, 'The reviewed registrable parent');
  if (normalizeEvidenceDomain(parent) !== parent || canonicalRegistrableDomain(parent) !== parent) {
    throw new TypeError('A reviewed registrable parent is not canonical.');
  }
  if (!Array.isArray(parentReview.hostnames)
    || parentReview.hostnames.length < 2
    || parentReview.hostnames.length > MAX_PARENT_DOMAIN_HOSTNAMES) {
    throw new TypeError('A parent-domain parent review has an invalid hostname collection.');
  }
  const hostnames = parentReview.hostnames.map((hostname) => (
    validateExportHostname(hostname, parent, campaignId, memberDomains)
  ));
  const hostnameNames = hostnames.map((hostname) => String(hostname.hostname));
  if (new Set(hostnameNames).size !== hostnameNames.length
    || !hostnames.some((hostname) => hostname.kind === 'child')
    || parentReview.hostnameCount !== hostnames.length
    || parentReview.childHostnameCount !== hostnames.filter((hostname) => hostname.kind === 'child').length
    || !['complete', 'partial', 'unknown'].includes(String(parentReview.completeness))
    || typeof parentReview.truncated !== 'boolean') {
    throw new TypeError('A parent-domain parent review has inconsistent hostname grouping.');
  }
  const observations = hostnames.flatMap((hostname) => hostname.observations as Record<string, unknown>[]);
  const expectedCaseIds = [...new Set(observations.map((observation) => String(observation.caseId)))].sort();
  const expectedCaseDomains = [...new Set(observations.map((observation) => String(observation.caseDomain)))].sort();
  const expectedMemberDomains = [...new Set(observations.map((observation) => String(observation.campaignMemberDomain)))].sort();
  if (JSON.stringify(exactExportStringList(parentReview.affectedCaseIds, MAX_PARENT_DOMAIN_LINKED_CASES, 64, 'The parent review Case identifiers')) !== JSON.stringify(expectedCaseIds)
    || JSON.stringify(exactExportStringList(parentReview.affectedCaseDomains, MAX_PARENT_DOMAIN_LINKED_CASES, 253, 'The parent review Case domains')) !== JSON.stringify(expectedCaseDomains)
    || JSON.stringify(exactExportStringList(parentReview.campaignMemberDomains, MAX_CAMPAIGN_DOMAINS, 253, 'The parent review campaign members')) !== JSON.stringify(expectedMemberDomains)
    || exactExportCount(parentReview.observationCount, MAX_PARENT_DOMAIN_OBSERVATIONS, 'The parent review observation count')
      !== hostnames.reduce((total, hostname) => total + Number(hostname.observationCount), 0)) {
    throw new TypeError('A parent-domain parent review has inconsistent Case or observation coverage.');
  }
  validateExportLimitations(parentReview.limitations, 'The parent review limitations');
  return parentReview;
}

export function buildParentDomainCampaignReviewExport(
  campaignValue: Pick<CampaignRecord, 'id' | 'name' | 'domains'>,
  review: ParentDomainCampaignReview,
  generatedAt = new Date().toISOString(),
) {
  assertWorkspaceInputGraph({ campaign: campaignValue, review }, 'Parent-domain campaign review export input');
  const generated = exactTimestamp(generatedAt);
  if (!generated) throw new TypeError('A valid explicit generation time is required.');
  const campaign = campaignIdentity(campaignValue);
  const members = [...new Set(campaign.domains.map((value) => normalizeEvidenceDomain(value)).filter(Boolean))].sort().slice(0, MAX_CAMPAIGN_DOMAINS);
  const document = Object.freeze({
    schema: PARENT_DOMAIN_CAMPAIGN_REVIEW_SCHEMA,
    version: PARENT_DOMAIN_CAMPAIGN_REVIEW_VERSION,
    generatedAt: generated,
    campaign: Object.freeze({ id: campaign.id, name: campaign.name, memberDomains: Object.freeze(members) }),
    review,
  });
  serializeParentDomainCampaignReviewExport(document);
  return document;
}

export function validateParentDomainCampaignReviewExport(value: unknown): void {
  assertWorkspaceInputGraph(value, 'Parent-domain campaign review export');
  const root = ordinaryWorkspaceRecord(value, 'Parent-domain campaign review export');
  if (!root) throw new TypeError('The parent-domain campaign review export must be an object.');
  exactRootKeys(root, ['schema', 'version', 'generatedAt', 'campaign', 'review'], 'The parent-domain campaign review export');
  if (root.schema !== PARENT_DOMAIN_CAMPAIGN_REVIEW_SCHEMA) throw new TypeError('The parent-domain campaign review export schema is invalid.');
  if (root.version !== PARENT_DOMAIN_CAMPAIGN_REVIEW_VERSION) throw new TypeError('The parent-domain campaign review export version is unsupported.');
  if (!exactTimestamp(root.generatedAt)) throw new TypeError('The parent-domain campaign review export generation time is invalid.');
  const campaign = ordinaryWorkspaceRecord(root.campaign, 'Parent-domain campaign review export campaign');
  const review = ordinaryWorkspaceRecord(root.review, 'Parent-domain campaign review export review');
  if (!campaign || !review) throw new TypeError('The parent-domain campaign review export content is invalid.');
  exactRootKeys(campaign, ['id', 'name', 'memberDomains'], 'The parent-domain campaign review export campaign');
  exactRootKeys(review, ['version', 'caseSchemaVersion', 'state', 'sourceState', 'campaign', 'counts', 'omissions', 'parents', 'limitations'], 'The parent-domain campaign review export review');
  const campaignId = exactExportText(campaign.id, 64, 'The exported campaign identifier');
  const campaignName = exactExportText(campaign.name, 100, 'The exported campaign name');
  const memberDomains = exactExportStringList(campaign.memberDomains, MAX_CAMPAIGN_DOMAINS, 253, 'The exported campaign members');
  if (memberDomains.some((domain) => normalizeEvidenceDomain(domain) !== domain)) {
    throw new TypeError('The exported campaign members are not canonical hostnames.');
  }
  const reviewCampaign = ordinaryWorkspaceRecord(review.campaign, 'Parent-domain review campaign identity');
  const counts = ordinaryWorkspaceRecord(review.counts, 'Parent-domain review counts');
  const omissions = ordinaryWorkspaceRecord(review.omissions, 'Parent-domain review omissions');
  if (!reviewCampaign || !counts || !omissions) throw new TypeError('The parent-domain campaign review summary is invalid.');
  exactRootKeys(reviewCampaign, ['id', 'name'], 'The parent-domain review campaign identity');
  exactRootKeys(counts, ['campaignMembers', 'linkedCases', 'sourceSnapshotRecords', 'acceptedObservations', 'distinctHostnames', 'qualifyingParents'], 'The parent-domain review counts');
  exactRootKeys(omissions, ['sourceRecords', 'campaignMembers', 'caseRecords', 'snapshotRecords', 'observations', 'hostnames', 'parents', 'provenance', 'limitations'], 'The parent-domain review omissions');
  const sourceStates = ['future_schema', 'loading', 'partial', 'ready', 'unavailable', 'unsupported'];
  const reviewStates = [...sourceStates, 'insufficient_evidence'];
  if (review.version !== 1
    || review.caseSchemaVersion !== CASE_SCHEMA_VERSION
    || !sourceStates.includes(String(review.sourceState))
    || !reviewStates.includes(String(review.state))
    || reviewCampaign.id !== campaignId
    || reviewCampaign.name !== campaignName
    || !Array.isArray(review.parents)
    || review.parents.length > MAX_PARENT_DOMAIN_PARENTS) {
    throw new TypeError('The parent-domain campaign review export review is invalid.');
  }
  const campaignMemberCount = exactExportCount(counts.campaignMembers, MAX_CAMPAIGN_DOMAINS, 'The parent-domain review campaign member count');
  const linkedCaseCount = exactExportCount(counts.linkedCases, MAX_PARENT_DOMAIN_LINKED_CASES, 'The parent-domain review linked Case count');
  exactExportCount(
    counts.sourceSnapshotRecords,
    MAX_PARENT_DOMAIN_LINKED_CASES * MAX_EVIDENCE_SNAPSHOTS_PER_CASE,
    'The parent-domain review source snapshot count',
  );
  const acceptedObservationCount = exactExportCount(
    counts.acceptedObservations,
    MAX_PARENT_DOMAIN_OBSERVATIONS,
    'The parent-domain review accepted observation count',
  );
  const distinctHostnameCount = exactExportCount(
    counts.distinctHostnames,
    MAX_PARENT_DOMAIN_HOSTNAMES,
    'The parent-domain review distinct hostname count',
  );
  exactExportCount(counts.qualifyingParents, MAX_PARENT_DOMAIN_PARENTS, 'The parent-domain review qualifying parent count');
  for (const [key, count] of Object.entries(omissions)) exactExportCount(count, Number.MAX_SAFE_INTEGER, `The parent-domain review omitted ${key} count`);
  const parentReviews = review.parents.map((parent) => validateExportParent(parent, campaignId, new Set(memberDomains)));
  const parentNames = parentReviews.map((parent) => String(parent.registrableParent));
  const visibleHostnames = parentReviews.flatMap((parent) => parent.hostnames as Record<string, unknown>[]);
  const visibleObservationCount = visibleHostnames.reduce(
    (total, hostname) => total + Number(hostname.observationCount),
    0,
  );
  const sourceIsReviewable = ['ready', 'partial'].includes(String(review.sourceState));
  if (new Set(parentNames).size !== parentNames.length
    || parentNames.some((parent, index) => index > 0 && compareCodeUnits(parentNames[index - 1]!, parent) >= 0)
    || counts.qualifyingParents !== parentReviews.length
    || distinctHostnameCount !== visibleHostnames.length
    || visibleObservationCount > acceptedObservationCount
    || linkedCaseCount > campaignMemberCount
    || (sourceIsReviewable && campaignMemberCount !== memberDomains.length)
    || (review.state === 'insufficient_evidence' && parentReviews.length !== 0)
    || (['ready', 'partial'].includes(String(review.state)) && parentReviews.length === 0)
    || (review.state === 'ready' && review.sourceState !== 'ready')
    || (['partial', 'insufficient_evidence'].includes(String(review.state)) && !sourceIsReviewable)
    || (sourceStates.includes(String(review.state))
      && !['ready', 'partial'].includes(String(review.state))
      && review.state !== review.sourceState)) {
    throw new TypeError('The parent-domain campaign review state is inconsistent with its retained parent groups.');
  }
  validateExportLimitations(review.limitations, 'The parent-domain review limitations');
}

export function serializeParentDomainCampaignReviewExport(value: unknown): string {
  assertWorkspaceInputGraph(value, 'Parent-domain campaign review export serialization input');
  let serialized: string;
  try {
    serialized = `${JSON.stringify(value, null, 2)}\n`;
  } catch {
    throw new TypeError('The parent-domain campaign review export is not serializable.');
  }
  if (new TextEncoder().encode(serialized).length > MAX_PARENT_DOMAIN_CAMPAIGN_REVIEW_BYTES) {
    throw new RangeError(`The parent-domain campaign review export exceeds the ${MAX_PARENT_DOMAIN_CAMPAIGN_REVIEW_BYTES}-byte limit.`);
  }
  validateParentDomainCampaignReviewExport(value);
  return serialized;
}
