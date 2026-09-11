import { caseLookupTarget, type CaseRecord } from './case-model.ts';
import { caseWorkspaceHref } from './case-response-stage.ts';
import type { BulkSession } from './bulk-session-model.ts';
import type { RelationshipObservation } from './relationship-observation-model.ts';
import type { WatchlistCollection } from './watchlist-store.ts';
import type { WebsiteProfileSnapshot } from './website-snapshot-model.ts';
import { normalizeExplicitIsoTimestamp, readObservationTime } from '../../../../packages/evidence/observation.mts';
import { MAX_CASES, MAX_CASE_ASSERTIONS, MAX_CASE_EVIDENCE_PINS, MAX_EVIDENCE_SNAPSHOTS_PER_CASE } from '../../../../packages/contracts/case-portability.mts';
import { MAX_BULK_SESSIONS, MAX_BULK_SESSION_ROWS, MAX_RELATIONSHIP_OBSERVATIONS, MAX_RELATIONSHIP_OBSERVATION_DOMAINS, MAX_WATCHLISTS, MAX_WATCHLIST_HISTORY_EVENTS, MAX_WATCHLIST_CHANGES_PER_EVENT, MAX_WEBSITE_SNAPSHOTS } from '../../../../packages/contracts/workspace-portability.mts';
import { MAX_ANALYST_REVIEW_STATE_RECORDS, MAX_ANALYST_REVIEW_HISTORY, MAX_ANALYST_REVIEW_ASSOCIATIONS, MAX_ANALYST_REVIEW_RATIONALE_LENGTH, type AnalystReviewStateStore } from '../../../../packages/contracts/analyst-review-state-contract.mts';
import { analystReviewDecisionIdentity } from '../../../../packages/monitoring/analyst-review-state.mts';

export const MAX_RETAINED_TIMELINE_ITEMS = MAX_CASES * (MAX_EVIDENCE_SNAPSHOTS_PER_CASE + MAX_CASE_EVIDENCE_PINS + MAX_CASE_ASSERTIONS)
  + MAX_BULK_SESSIONS + MAX_RELATIONSHIP_OBSERVATIONS + MAX_WATCHLISTS * MAX_WATCHLIST_HISTORY_EVENTS + MAX_WEBSITE_SNAPSHOTS
  + MAX_ANALYST_REVIEW_STATE_RECORDS * (1 + MAX_ANALYST_REVIEW_HISTORY);
export const MAX_RETAINED_TIMELINE_ENTITIES = Math.max(MAX_BULK_SESSION_ROWS, MAX_RELATIONSHIP_OBSERVATION_DOMAINS, MAX_WATCHLIST_CHANGES_PER_EVENT);
export const MAX_RETAINED_TIMELINE_LIMITATIONS = 8;

export const RETAINED_TIMELINE_KINDS = [
  'case_snapshot',
  'bulk_session',
  'evidence_pin',
  'evidence_checkpoint',
  'external_assertion',
  'website_snapshot',
  'watchlist_check',
  'relationship',
  'review_decision',
] as const;
export type RetainedTimelineKind = typeof RETAINED_TIMELINE_KINDS[number];
export type RetainedTimelineCompleteness = 'complete' | 'partial' | 'inconclusive' | 'unknown';
export type RetainedTimelineEventType = 'evidence' | 'change' | 'activity';
export type RetainedTimelineTimeFilter = 'all' | '7d' | '30d' | '90d' | 'undated';
export const RETAINED_TIMELINE_AREAS = [
  'lookup',
  'bulk',
  'watchlist',
  'case',
  'evidence_pin',
  'relationship',
  'review',
] as const;
export type RetainedTimelineArea = typeof RETAINED_TIMELINE_AREAS[number];
export type RetainedTimelineFreshness = 'current' | 'stale' | 'unknown';

export const RETAINED_TIMELINE_FRESHNESS_DAYS: Readonly<Record<RetainedTimelineArea, number | null>> = {
  lookup: 30,
  bulk: 7,
  watchlist: 7,
  case: 30,
  evidence_pin: 30,
  relationship: 30,
  review: null,
};

export type RetainedTimelineItem = Readonly<{
  id: string;
  kind: RetainedTimelineKind;
  eventType: RetainedTimelineEventType;
  title: string;
  detail: string;
  entities: readonly string[];
  caseId: string | null;
  caseLabel: string | null;
  caseAssociations?: readonly Readonly<{ id: string; label: string; present: boolean }>[];
  owner: string;
  href: string;
  areas: readonly RetainedTimelineArea[];
  source: string;
  sourceState: string;
  observedAt: string | null;
  storedAt: string | null;
  activityAt?: string | null;
  freshness: RetainedTimelineFreshness;
  ageDays: number | null;
  freshnessThresholdDays: number | null;
  completeness: RetainedTimelineCompleteness;
  truncated: boolean;
  derived: boolean;
  limitations: readonly string[];
}>;

export type RetainedEvidenceTimeline = Readonly<{
  items: readonly RetainedTimelineItem[];
  truncated: boolean;
  counts: Readonly<Record<RetainedTimelineKind | 'all' | RetainedTimelineEventType, number>>;
  omissions: readonly Readonly<{ source: string; count: number }>[];
  evaluatedAt: string | null;
  cases: readonly Readonly<{ id: string; label: string }>[];
  freshnessCounts: Readonly<Record<RetainedTimelineFreshness, number>>;
  limitations: readonly string[];
}>;

export type RetainedTimelineFilters = Readonly<{
  entity: string;
  caseId: string;
  source: string;
  area: '' | RetainedTimelineArea;
  freshness: 'all' | RetainedTimelineFreshness;
  eventType: 'all' | RetainedTimelineEventType;
  time: RetainedTimelineTimeFilter;
}>;

const CONTROL_REPLACE_RE = /[\u0000-\u001f\u007f]+/gu;

function text(value: unknown, maximum = 240): string {
  return typeof value === 'string'
    ? value.replace(CONTROL_REPLACE_RE, ' ').trim().slice(0, maximum)
    : '';
}

function timestamp(value: unknown): string | null {
  return normalizeExplicitIsoTimestamp(value);
}

function entities(values: readonly unknown[], maximum: number): string[] {
  const output = new Set<string>();
  for (const value of values.slice(0, maximum)) {
    const candidate = text(value, 253).toLowerCase();
    if (candidate) output.add(candidate);
  }
  return [...output].sort();
}

function limitations(values: readonly unknown[], fallback: string): string[] {
  const output = new Set<string>();
  for (const value of values.slice(0, MAX_RETAINED_TIMELINE_LIMITATIONS * 4)) {
    const candidate = text(value, 400);
    if (candidate) output.add(candidate);
    if (output.size >= MAX_RETAINED_TIMELINE_LIMITATIONS) break;
  }
  if (!output.size && fallback) output.add(fallback);
  return [...output];
}

function freshnessMetadata(
  area: RetainedTimelineArea,
  observedAt: string | null,
  now: string | null,
): Pick<RetainedTimelineItem, 'freshness' | 'ageDays' | 'freshnessThresholdDays'> {
  const threshold = RETAINED_TIMELINE_FRESHNESS_DAYS[area];
  const { ageDays } = readObservationTime(observedAt, now);
  if (ageDays === null || threshold === null) {
    return { freshness: 'unknown', ageDays: null, freshnessThresholdDays: threshold };
  }
  return {
    freshness: ageDays >= threshold ? 'stale' : 'current',
    ageDays,
    freshnessThresholdDays: threshold,
  };
}

function omitTimelineSource(omissions: Map<string, number>, source: string, count: number) {
  if (count > 0) omissions.set(source, Math.min(Number.MAX_SAFE_INTEGER, (omissions.get(source) ?? 0) + count));
}

function timelineSource<T>(values: readonly T[], maximum: number, source: string, omissions: Map<string, number>, newestLast = false): T[] {
  omitTimelineSource(omissions, source, values.length - maximum);
  return newestLast ? values.slice(-maximum) : values.slice(0, maximum);
}

function caseTimelineItems(records: readonly CaseRecord[], now: string | null, omissions: Map<string, number>): RetainedTimelineItem[] {
  const items: RetainedTimelineItem[] = [];
  for (const record of timelineSource(records, MAX_CASES, 'Cases outside the source bound', omissions)) {
    const caseHref = caseWorkspaceHref(record.id, 'evidence');
    for (const snapshot of timelineSource(record.evidenceHistory, MAX_EVIDENCE_SNAPSHOTS_PER_CASE, 'Case snapshots outside the source bound', omissions, true)) {
      const observedAt = timestamp(snapshot.capturedAt);
      const storedAt = timestamp(record.updatedAt);
      const depth = snapshot.scanDepth === 'deep' ? 'Deep' : snapshot.scanDepth === 'fast' ? 'Fast' : 'Unknown-depth';
      const areas: RetainedTimelineArea[] = ['case'];
      if (snapshot.source === 'lookup') areas.push('lookup');
      if (snapshot.source === 'bulk') areas.push('bulk');
      items.push({
        id: `case-snapshot:${record.id}:${snapshot.id}`,
        kind: 'case_snapshot',
        eventType: 'evidence',
        title: `${depth} case evidence retained`,
        detail: snapshot.availability
          ? `Availability was recorded as ${text(snapshot.availability, 40).replaceAll('_', ' ')}.`
          : 'The compact snapshot retained source-attributed case evidence.',
        entities: [record.domain],
        caseId: record.id,
        caseLabel: record.domain,
        owner: `Case · ${record.domain}`,
        href: caseHref,
        areas,
        source: text(snapshot.source, 80) || 'Case evidence',
        sourceState: snapshot.scanDepth === 'unknown' ? 'unknown depth' : snapshot.scanDepth,
        observedAt,
        storedAt,
        ...freshnessMetadata('case', observedAt, now),
        completeness: 'unknown',
        truncated: false,
        derived: false,
        limitations: ['Compact case snapshots do not retain a complete source-coverage or truncation record. Open the owning case for the retained fields.'],
      });
    }
    for (const pin of timelineSource(record.evidencePins, MAX_CASE_EVIDENCE_PINS, 'Case evidence pins outside the source bound', omissions, true)) {
      const observedAt = timestamp(pin.observedAt);
      const storedAt = timestamp(pin.createdAt);
      const checkpoint = Boolean(pin.checkpointId);
      items.push({
        id: `${checkpoint ? 'checkpoint' : 'pin'}:${record.id}:${pin.id}`,
        kind: checkpoint ? 'evidence_checkpoint' : 'evidence_pin',
        eventType: 'evidence',
        title: `${checkpoint ? 'Checkpoint fact' : 'Evidence pin'} · ${text(pin.label, 80) || 'Retained fact'}`,
        detail: `Analyst selected a bounded ${text(pin.category, 60) || 'evidence'} fact. The value remains in the owning case rather than this timeline projection.`,
        entities: [record.domain],
        caseId: record.id,
        caseLabel: record.domain,
        owner: `Case · ${record.domain}`,
        href: caseHref,
        areas: ['case', 'evidence_pin'],
        source: text(pin.source, 80) || 'Evidence pin',
        sourceState: text(pin.sourceState, 60) || 'recorded',
        observedAt,
        storedAt,
        ...freshnessMetadata('evidence_pin', observedAt, now),
        completeness: pin.completeness,
        truncated: pin.truncated === true,
        derived: false,
        limitations: limitations(pin.limitations, 'An analyst-selected pin is a retained fact, not an independent verification or conclusion.'),
      });
    }
    for (const assertion of timelineSource(record.assertions, MAX_CASE_ASSERTIONS, 'Case assertions outside the source bound', omissions, true)) {
      const provenance = assertion.provenance;
      if (!provenance) continue;
      const observedAt = timestamp(provenance.observedAt);
      const storedAt = timestamp(assertion.createdAt);
      items.push({
        id: `external-assertion:${record.id}:${assertion.id}`,
        kind: 'external_assertion',
        eventType: 'evidence',
        title: `External ${provenance.format.toUpperCase()} claim retained`,
        detail: `A bounded external ${provenance.entityType} claim was merged into this case as an assertion. Its value remains in the owning case.`,
        entities: [record.domain],
        caseId: record.id,
        caseLabel: record.domain,
        owner: `Case · ${record.domain}`,
        href: caseWorkspaceHref(record.id, 'assessment'),
        areas: ['case'],
        source: provenance.sourceName,
        sourceState: 'external assertion',
        observedAt,
        storedAt,
        ...freshnessMetadata('case', observedAt, now),
        completeness: 'unknown',
        truncated: false,
        derived: false,
        limitations: ['WHOISleuth did not collect or independently verify this imported claim. Review the source digest, markings, publisher, and external identifier in the owning case.'],
      });
    }
  }
  return items;
}

function websiteTimelineItems(snapshots: readonly WebsiteProfileSnapshot[], now: string | null, omissions: Map<string, number>): RetainedTimelineItem[] {
  return timelineSource(snapshots, MAX_WEBSITE_SNAPSHOTS, 'Website snapshots outside the source bound', omissions).flatMap((snapshot): RetainedTimelineItem[] => {
    const observedAt = timestamp(snapshot.observedAt);
    const storedAt = timestamp(snapshot.savedAt);
    const states = [...new Set(snapshot.sources.map((source) => text(source.state, 40)).filter(Boolean))];
    return [{
      id: `website:${snapshot.id}`,
      kind: 'website_snapshot',
      eventType: 'evidence',
      title: 'Website profile snapshot retained',
      detail: `${snapshot.technologies.length} technology indicator${snapshot.technologies.length === 1 ? '' : 's'} and ${snapshot.posture.length} posture state${snapshot.posture.length === 1 ? '' : 's'} were retained as curated identifiers and digests.`,
      entities: [snapshot.domain],
      caseId: null,
      caseLabel: null,
      owner: `Website snapshot · ${snapshot.domain}`,
      href: `/lookup?q=${encodeURIComponent(snapshot.domain)}#website-profile-snapshots`,
      areas: ['lookup'],
      source: 'Website profile snapshot',
      sourceState: states.join(', ') || 'recorded',
      observedAt,
      storedAt,
      ...freshnessMetadata('lookup', observedAt, now),
      completeness: snapshot.complete && !snapshot.truncated ? 'complete' : 'partial',
      truncated: snapshot.truncated,
      derived: false,
      limitations: ['The timeline excludes page content, raw scripts, remote assets, and identity digest values. Open Lookup to inspect the retained snapshot.'],
    }];
  });
}

function watchlistTimelineItems(watchlists: WatchlistCollection, now: string | null, omissions: Map<string, number>): RetainedTimelineItem[] {
  const items: RetainedTimelineItem[] = [];
  for (const [name, watchlist] of timelineSource(Object.entries(watchlists), MAX_WATCHLISTS, 'Watchlists outside the source bound', omissions)) {
    const storedAt = timestamp(watchlist.updatedAt);
    for (const [index, event] of timelineSource(watchlist.history, MAX_WATCHLIST_HISTORY_EVENTS, 'Watchlist checks outside the source bound', omissions, true).entries()) {
      const observedAt = timestamp(event.checkedAt);
      const changes = timelineSource(event.changes, MAX_WATCHLIST_CHANGES_PER_EVENT, 'Watchlist changes outside the source bound', omissions);
      const changedEntities = entities(changes.map((change) => change.domain), MAX_WATCHLIST_CHANGES_PER_EVENT);
      const complete = event.conclusiveCount === event.resultCount && event.omittedChanges === 0;
      items.push({
        id: `watchlist:${name}:${observedAt ?? 'undated'}:${index}`,
        kind: 'watchlist_check',
        eventType: event.changeCount > 0 ? 'change' : 'evidence',
        title: event.changeCount > 0
          ? `${event.changeCount} watchlist change${event.changeCount === 1 ? '' : 's'} retained`
          : 'Watchlist check retained',
        detail: `${event.conclusiveCount} of ${event.resultCount} results were conclusive${event.omittedChanges ? `; ${event.omittedChanges} changes were omitted by the history bound` : ''}.`,
        entities: changedEntities,
        caseId: null,
        caseLabel: null,
        owner: `Watchlist · ${text(name, 100)}`,
        href: `/monitor?view=watchlists&watchlist=${encodeURIComponent(name)}`,
        areas: ['watchlist'],
        source: 'Watchlist history',
        sourceState: event.mode,
        observedAt,
        storedAt,
        ...freshnessMetadata('watchlist', observedAt, now),
        completeness: complete ? 'complete' : event.conclusiveCount > 0 ? 'partial' : 'inconclusive',
        truncated: event.omittedChanges > 0,
        derived: false,
        limitations: ['A retained check represents this browser-local history only. Missing days do not prove that no monitoring occurred.'],
      });
    }
  }
  return items;
}

function relationshipTimelineItems(records: readonly RelationshipObservation[], now: string | null, omissions: Map<string, number>): RetainedTimelineItem[] {
  return timelineSource(records, MAX_RELATIONSHIP_OBSERVATIONS, 'Relationships outside the source bound', omissions).flatMap((record): RetainedTimelineItem[] => {
    const observedAt = timestamp(record.observedAt);
    const storedAt = timestamp(record.retainedAt);
    return [{
      id: `relationship:${record.id}`,
      kind: 'relationship',
      eventType: 'evidence',
      title: `${text(record.label, 100) || 'Relationship'} retained`,
      detail: `${record.domains.length} domain${record.domains.length === 1 ? '' : 's'} shared the bounded observation by ${text(record.method, 120) || 'the recorded comparison method'}.`,
      entities: entities(timelineSource(record.domains, MAX_RELATIONSHIP_OBSERVATION_DOMAINS, 'Relationship members outside the source bound', omissions), MAX_RELATIONSHIP_OBSERVATION_DOMAINS),
      caseId: null,
      caseLabel: null,
      owner: 'Retained relationship',
      href: `/monitor?view=relationships&observation=${encodeURIComponent(record.id)}`,
      areas: ['relationship'],
      source: text(record.source, 80) || 'Relationship analysis',
      sourceState: record.complete ? 'complete' : 'partial',
      observedAt,
      storedAt,
      ...(observedAt ? freshnessMetadata('relationship', observedAt, now)
        : { freshness: 'unknown' as const, ageDays: null, freshnessThresholdDays: RETAINED_TIMELINE_FRESHNESS_DAYS.relationship }),
      completeness: record.complete && !record.truncated ? 'complete' : 'partial',
      truncated: record.truncated,
      derived: true,
      limitations: limitations([...record.limitations,
        ...(!observedAt ? ['Contributing-source observation time is unavailable; retention does not establish when the relationship was observed.'] : []),
      ], 'Shared infrastructure is an investigative lead, not proof of ownership, control, or intent.'),
    }];
  });
}

function bulkTimelineItems(sessions: readonly BulkSession[], now: string | null, omissions: Map<string, number>): RetainedTimelineItem[] {
  return timelineSource(sessions, MAX_BULK_SESSIONS, 'Bulk sessions outside the source bound', omissions).flatMap((session): RetainedTimelineItem[] => {
    const activityAt = timestamp(session.completedAt) ?? timestamp(session.startedAt);
    const observedAt = null;
    const storedAt = timestamp(session.updatedAt);
    const results = timelineSource(session.results, MAX_BULK_SESSION_ROWS, 'Bulk results outside the source bound', omissions);
    const settled = results.length;
    const complete = session.state === 'complete'
      && settled === session.domains.length
      && results.every((result) => result.status === 'complete');
    return [{
      id: `bulk:${session.id}`,
      kind: 'bulk_session',
      eventType: 'activity',
      title: `${text(session.name, 100) || 'Bulk session'} retained`,
      detail: `${settled} of ${session.domains.length} queued domains have compact settled results in this ${session.mode} session.`,
      entities: entities(timelineSource(session.domains, MAX_BULK_SESSION_ROWS, 'Bulk members outside the source bound', omissions), MAX_BULK_SESSION_ROWS),
      caseId: null,
      caseLabel: null,
      owner: `Bulk session · ${text(session.name, 100) || session.id}`,
      href: '/bulk#bulk-sessions-title',
      areas: ['bulk'],
      source: 'Bulk session',
      sourceState: `${session.mode} · ${session.state}`,
      observedAt,
      storedAt,
      activityAt,
      ...freshnessMetadata('bulk', observedAt, now),
      completeness: complete ? 'complete' : settled > 0 ? 'partial' : 'inconclusive',
      truncated: session.domains.length > MAX_BULK_SESSION_ROWS,
      derived: false,
      limitations: [
        'Saved Bulk sessions retain compact normalised rows and source states, not raw WHOIS, RDAP, DNS, HTTP, TLS, page, or contact payloads.',
        'Session activity records completion or start, not a source observation. Review each retained row for its own evidence time and state.',
      ],
    }];
  });
}

function reviewTimelineItems(
  store: AnalystReviewStateStore | undefined,
  cases: readonly CaseRecord[],
  omissions: Map<string, number>,
): RetainedTimelineItem[] {
  const caseById = new Map(cases.slice(0, MAX_CASES).map((record) => [record.id, record]));
  return timelineSource(store?.records ?? [], MAX_ANALYST_REVIEW_STATE_RECORDS, 'Review records outside the source bound', omissions).flatMap((record) => {
    const caseAssociations = timelineSource(record.caseIds, MAX_ANALYST_REVIEW_ASSOCIATIONS, 'Review Case associations outside the source bound', omissions).map((id) => {
      const associated = caseById.get(id);
      return { id, label: associated ? caseLookupTarget(associated) : `${id} (unavailable)`, present: Boolean(associated) };
    });
    const history = timelineSource(record.history, MAX_ANALYST_REVIEW_HISTORY, 'Review history outside the source bound', omissions);
    omitTimelineSource(omissions, 'Earlier analyst decisions no longer retained', record.historyOmitted);
    const occurrences = new Map<string, number>();
    return [record, ...history].map((decision, index): RetainedTimelineItem => {
      const identity = analystReviewDecisionIdentity(record.subjectKey, decision);
      const occurrence = occurrences.get(identity) ?? 0;
      occurrences.set(identity, occurrence + 1);
      return {
        id: `review-${identity}:${occurrence}`,
        kind: 'review_decision',
        eventType: 'activity',
        title: `${index === 0 ? 'Latest' : 'Earlier'} ${record.evidenceFamily.replaceAll('_', ' ')} review: ${decision.disposition}`,
        detail: text(decision.rationale, MAX_ANALYST_REVIEW_RATIONALE_LENGTH),
        entities: caseAssociations.filter((association) => association.present).map((association) => association.label),
        caseId: caseAssociations.length === 1 ? caseAssociations[0]!.id : null,
        caseLabel: caseAssociations.length === 1 ? caseAssociations[0]!.label : null,
        caseAssociations,
        owner: 'review history',
        href: `/monitor?view=inbox&review=${encodeURIComponent(record.subjectKey)}#review-inbox-title`,
        areas: ['review', ...(caseAssociations.length ? ['case'] as const : [])],
        source: 'Analyst review decision',
        sourceState: index === 0 ? 'latest retained decision' : 'historical decision',
        observedAt: null,
        storedAt: null,
        activityAt: timestamp(decision.reviewedAt),
        freshness: 'unknown',
        ageDays: null,
        freshnessThresholdDays: null,
        completeness: 'unknown',
        truncated: record.historyOmitted > 0 || record.history.length > MAX_ANALYST_REVIEW_HISTORY,
        derived: false,
        limitations: [
          'This timestamp records the analyst decision, not when its source evidence was observed. Open the review for current applicability and earlier rationale.',
          ...(index > 0 && caseAssociations.length ? ['Case links use the latest retained associations; historical associations were not stored.'] : []),
          ...(caseAssociations.some((association) => !association.present) ? ['One or more associated Cases are unavailable in the loaded workspace. Their identifiers remain retained.'] : []),
          ...(record.historyOmitted > 0 ? [`At least ${record.historyOmitted} earlier decisions are no longer retained.`] : []),
        ],
      };
    });
  });
}

function eventTime(item: RetainedTimelineItem): string | null {
  return item.eventType === 'activity' ? item.activityAt ?? null : item.observedAt;
}

function itemSort(left: RetainedTimelineItem, right: RetainedTimelineItem): number {
  const leftTime = eventTime(left);
  const rightTime = eventTime(right);
  return Number(leftTime === null) - Number(rightTime === null)
    || (rightTime ?? '').localeCompare(leftTime ?? '')
    || (right.storedAt ?? '').localeCompare(left.storedAt ?? '')
    || left.id.localeCompare(right.id);
}

export function buildRetainedEvidenceTimeline(input: Readonly<{
  cases?: readonly CaseRecord[];
  bulkSessions?: readonly BulkSession[];
  watchlists?: WatchlistCollection;
  relationships?: readonly RelationshipObservation[];
  websiteSnapshots?: readonly WebsiteProfileSnapshot[];
  reviewState?: AnalystReviewStateStore;
  now?: unknown;
}>): RetainedEvidenceTimeline {
  const cases = Array.isArray(input.cases) ? input.cases : [];
  const bulkSessions = Array.isArray(input.bulkSessions) ? input.bulkSessions : [];
  const watchlists = input.watchlists && typeof input.watchlists === 'object' ? input.watchlists : {};
  const relationships = Array.isArray(input.relationships) ? input.relationships : [];
  const websiteSnapshots = Array.isArray(input.websiteSnapshots) ? input.websiteSnapshots : [];
  const now = input.now === undefined ? new Date().toISOString() : timestamp(input.now);
  const omissions = new Map<string, number>();
  const all = [
    ...caseTimelineItems(cases, now, omissions),
    ...bulkTimelineItems(bulkSessions, now, omissions),
    ...websiteTimelineItems(websiteSnapshots, now, omissions),
    ...watchlistTimelineItems(watchlists, now, omissions),
    ...relationshipTimelineItems(relationships, now, omissions),
    ...reviewTimelineItems(input.reviewState, cases, omissions),
  ].sort(itemSort);
  const items = timelineSource(all, MAX_RETAINED_TIMELINE_ITEMS, 'Timeline entries outside the display bound', omissions);
  const counts = Object.fromEntries([
    ['all', items.length],
    ['evidence', items.filter((item) => item.eventType === 'evidence').length],
    ['change', items.filter((item) => item.eventType === 'change').length],
    ['activity', items.filter((item) => item.eventType === 'activity').length],
    ...RETAINED_TIMELINE_KINDS.map((kind) => [kind, items.filter((item) => item.kind === kind).length]),
  ]) as Record<RetainedTimelineKind | 'all' | RetainedTimelineEventType, number>;
  const caseOptions = new Map<string, string>();
  for (const item of items) {
    if (item.caseId && item.caseLabel) caseOptions.set(item.caseId, item.caseLabel);
    for (const association of item.caseAssociations ?? []) caseOptions.set(association.id, association.label);
  }
  const freshnessCounts = {
    current: items.filter((item) => item.freshness === 'current').length,
    stale: items.filter((item) => item.freshness === 'stale').length,
    unknown: items.filter((item) => item.freshness === 'unknown').length,
  };
  return {
    items,
    truncated: omissions.size > 0,
    omissions: [...omissions].map(([source, count]) => ({ source, count })),
    counts,
    evaluatedAt: now,
    cases: [...caseOptions].map(([id, label]) => ({ id, label })).sort((left, right) => left.label.localeCompare(right.label)),
    freshnessCounts,
    limitations: [
      'This is a bounded projection of deliberately retained browser-local records. It does not run collection, duplicate raw payloads, or infer maliciousness.',
      'Observation time records when evidence was collected or asserted. Storage time records when this browser retained the owning record; the two are never silently merged.',
      'Undated evidence remains available. Time filters use source observation dates for evidence and separately labelled event dates for session activity and analyst decisions.',
      ...(now === null ? ['The review clock is unavailable; freshness and relative-date filters cannot be evaluated.'] : []),
      'Open the owning record for complete retained detail, exact values, source limitations, and analyst notes.',
      'Freshness is a bounded age check over retained observation time. It does not run a lookup or imply that current live evidence has changed.',
    ],
  };
}

export function filterRetainedEvidenceTimeline(
  timeline: RetainedEvidenceTimeline,
  filters: RetainedTimelineFilters,
  now: unknown = timeline.evaluatedAt,
): RetainedTimelineItem[] {
  const normalizedEntity = text(filters.entity, 253).toLowerCase();
  const normalizedCase = text(filters.caseId, 128);
  const normalizedSource = text(filters.source, 120);
  const parsedNow = timestamp(now);
  const days = filters.time === '7d' ? 7 : filters.time === '30d' ? 30 : filters.time === '90d' ? 90 : null;
  const current = parsedNow ? Date.parse(parsedNow) : Number.NaN;
  const cutoff = days === null ? Number.NEGATIVE_INFINITY : current - days * 86_400_000;
  return timeline.items.filter((item) => {
    const observedAt = eventTime(item);
    const inTimeRange = filters.time === 'all' || (filters.time === 'undated' ? observedAt === null
      : observedAt !== null && Date.parse(observedAt) >= cutoff && Date.parse(observedAt) <= current);
    return (!normalizedEntity || item.entities.some((entity) => entity.includes(normalizedEntity)))
    && (!normalizedCase || item.caseId === normalizedCase || item.caseAssociations?.some((association) => association.id === normalizedCase))
    && (!normalizedSource || item.source.toLowerCase().includes(normalizedSource.toLowerCase()))
    && (!filters.area || item.areas.includes(filters.area))
    && (filters.freshness === 'all' || item.freshness === filters.freshness)
    && (filters.eventType === 'all' || item.eventType === filters.eventType)
    && inTimeRange;
  });
}
