import type { CaseRecord } from './case-model.ts';
import type { BulkSession } from './bulk-session-model.ts';
import type { RelationshipObservation } from './relationship-observation-model.ts';
import type { WatchlistCollection } from './watchlist-store.ts';
import type { WebsiteProfileSnapshot } from './website-snapshot-model.ts';

export const MAX_RETAINED_TIMELINE_ITEMS = 2_000;
export const MAX_RETAINED_TIMELINE_ENTITIES = 20;
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
] as const;
export type RetainedTimelineKind = typeof RETAINED_TIMELINE_KINDS[number];
export type RetainedTimelineCompleteness = 'complete' | 'partial' | 'inconclusive' | 'unknown';
export type RetainedTimelineEventType = 'evidence' | 'change';
export type RetainedTimelineTimeFilter = 'all' | '7d' | '30d' | '90d';
export const RETAINED_TIMELINE_AREAS = [
  'lookup',
  'bulk',
  'watchlist',
  'case',
  'evidence_pin',
  'relationship',
] as const;
export type RetainedTimelineArea = typeof RETAINED_TIMELINE_AREAS[number];
export type RetainedTimelineFreshness = 'current' | 'stale' | 'unknown';

export const RETAINED_TIMELINE_FRESHNESS_DAYS: Readonly<Record<RetainedTimelineArea, number>> = {
  lookup: 30,
  bulk: 7,
  watchlist: 7,
  case: 30,
  evidence_pin: 30,
  relationship: 30,
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
  owner: string;
  href: string;
  areas: readonly RetainedTimelineArea[];
  source: string;
  sourceState: string;
  observedAt: string;
  storedAt: string;
  freshness: RetainedTimelineFreshness;
  ageDays: number | null;
  freshnessThresholdDays: number;
  completeness: RetainedTimelineCompleteness;
  truncated: boolean;
  derived: boolean;
  limitations: readonly string[];
}>;

export type RetainedEvidenceTimeline = Readonly<{
  items: readonly RetainedTimelineItem[];
  truncated: boolean;
  counts: Readonly<Record<RetainedTimelineKind | 'all' | RetainedTimelineEventType, number>>;
  entities: readonly string[];
  cases: readonly Readonly<{ id: string; label: string }>[];
  sources: readonly string[];
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
  if (typeof value !== 'string' || value.length > 64) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function entities(values: readonly unknown[]): string[] {
  const output = new Set<string>();
  for (const value of values.slice(0, MAX_RETAINED_TIMELINE_ENTITIES * 4)) {
    const candidate = text(value, 253).toLowerCase();
    if (candidate) output.add(candidate);
    if (output.size >= MAX_RETAINED_TIMELINE_ENTITIES) break;
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
  observedAt: string,
  now: string,
): Pick<RetainedTimelineItem, 'freshness' | 'ageDays' | 'freshnessThresholdDays'> {
  const threshold = RETAINED_TIMELINE_FRESHNESS_DAYS[area];
  const observed = Date.parse(observedAt);
  const current = Date.parse(now);
  if (!Number.isFinite(observed) || !Number.isFinite(current)) {
    return { freshness: 'unknown', ageDays: null, freshnessThresholdDays: threshold };
  }
  const ageDays = Math.max(0, Math.floor((current - observed) / 86_400_000));
  return {
    freshness: ageDays >= threshold ? 'stale' : 'current',
    ageDays,
    freshnessThresholdDays: threshold,
  };
}

function caseTimelineItems(records: readonly CaseRecord[], now: string): RetainedTimelineItem[] {
  const items: RetainedTimelineItem[] = [];
  for (const record of records.slice(0, 500)) {
    const caseHref = `/monitor?view=cases&case=${encodeURIComponent(record.id)}`;
    for (const snapshot of record.evidenceHistory.slice(-20)) {
      const observedAt = timestamp(snapshot.capturedAt);
      const storedAt = timestamp(record.updatedAt);
      if (!observedAt || !storedAt) continue;
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
    for (const pin of record.evidencePins.slice(-40)) {
      const observedAt = timestamp(pin.observedAt);
      const storedAt = timestamp(pin.createdAt);
      if (!observedAt || !storedAt) continue;
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
        href: `${caseHref}#case-response-${encodeURIComponent(record.id)}`,
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
    for (const assertion of record.assertions.slice(-40)) {
      const provenance = assertion.provenance;
      if (!provenance) continue;
      const observedAt = timestamp(provenance.observedAt ?? provenance.createdAt ?? assertion.createdAt);
      const storedAt = timestamp(assertion.createdAt);
      if (!observedAt || !storedAt) continue;
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
        href: `${caseHref}#case-response-${encodeURIComponent(record.id)}`,
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

function websiteTimelineItems(snapshots: readonly WebsiteProfileSnapshot[], now: string): RetainedTimelineItem[] {
  return snapshots.slice(0, 60).flatMap((snapshot): RetainedTimelineItem[] => {
    const observedAt = timestamp(snapshot.observedAt);
    const storedAt = timestamp(snapshot.savedAt);
    if (!observedAt || !storedAt) return [];
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

function watchlistTimelineItems(watchlists: WatchlistCollection, now: string): RetainedTimelineItem[] {
  const items: RetainedTimelineItem[] = [];
  for (const [name, watchlist] of Object.entries(watchlists).slice(0, 100)) {
    const storedAt = timestamp(watchlist.updatedAt);
    if (!storedAt) continue;
    for (const event of watchlist.history.slice(-12)) {
      const observedAt = timestamp(event.checkedAt);
      if (!observedAt) continue;
      const changedEntities = entities(event.changes.map((change) => change.domain));
      const complete = event.conclusiveCount === event.resultCount && event.omittedChanges === 0;
      items.push({
        id: `watchlist:${name}:${observedAt}`,
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

function relationshipTimelineItems(records: readonly RelationshipObservation[], now: string): RetainedTimelineItem[] {
  return records.slice(0, 300).flatMap((record): RetainedTimelineItem[] => {
    const observedAt = timestamp(record.observedAt);
    const storedAt = timestamp(record.retainedAt);
    if (!observedAt || !storedAt) return [];
    return [{
      id: `relationship:${record.id}`,
      kind: 'relationship',
      eventType: 'evidence',
      title: `${text(record.label, 100) || 'Relationship'} retained`,
      detail: `${record.domains.length} domain${record.domains.length === 1 ? '' : 's'} shared the bounded observation by ${text(record.method, 120) || 'the recorded comparison method'}.`,
      entities: entities(record.domains),
      caseId: null,
      caseLabel: null,
      owner: 'Retained relationship',
      href: `/monitor?view=relationships&observation=${encodeURIComponent(record.id)}`,
      areas: ['relationship'],
      source: text(record.source, 80) || 'Relationship analysis',
      sourceState: record.complete ? 'complete' : 'partial',
      observedAt,
      storedAt,
      ...freshnessMetadata('relationship', observedAt, now),
      completeness: record.complete && !record.truncated ? 'complete' : 'partial',
      truncated: record.truncated,
      derived: true,
      limitations: limitations(record.limitations, 'Shared infrastructure is an investigative lead, not proof of ownership, control, or intent.'),
    }];
  });
}

function bulkTimelineItems(sessions: readonly BulkSession[], now: string): RetainedTimelineItem[] {
  return sessions.slice(0, 10).flatMap((session): RetainedTimelineItem[] => {
    const observedAt = timestamp(session.completedAt ?? session.updatedAt ?? session.startedAt);
    const storedAt = timestamp(session.updatedAt);
    if (!observedAt || !storedAt) return [];
    const settled = session.results.length;
    const complete = session.state === 'complete'
      && settled === session.domains.length
      && session.results.every((result) => result.status === 'complete');
    return [{
      id: `bulk:${session.id}`,
      kind: 'bulk_session',
      eventType: 'evidence',
      title: `${text(session.name, 100) || 'Bulk session'} retained`,
      detail: `${settled} of ${session.domains.length} queued domains have compact settled results in this ${session.mode} session.`,
      entities: entities(session.domains),
      caseId: null,
      caseLabel: null,
      owner: `Bulk session · ${text(session.name, 100) || session.id}`,
      href: '/bulk#bulk-sessions-title',
      areas: ['bulk'],
      source: 'Bulk session',
      sourceState: `${session.mode} · ${session.state}`,
      observedAt,
      storedAt,
      ...freshnessMetadata('bulk', observedAt, now),
      completeness: complete ? 'complete' : settled > 0 ? 'partial' : 'inconclusive',
      truncated: session.domains.length > MAX_RETAINED_TIMELINE_ENTITIES,
      derived: false,
      limitations: [
        'Saved Bulk sessions retain compact normalised rows and source states, not raw WHOIS, RDAP, DNS, HTTP, TLS, page, or contact payloads.',
        'Freshness measures the age of this retained session observation. It does not establish the current state of any queued domain.',
      ],
    }];
  });
}

function itemSort(left: RetainedTimelineItem, right: RetainedTimelineItem): number {
  return right.observedAt.localeCompare(left.observedAt)
    || right.storedAt.localeCompare(left.storedAt)
    || left.id.localeCompare(right.id);
}

export function buildRetainedEvidenceTimeline(input: Readonly<{
  cases?: readonly CaseRecord[];
  bulkSessions?: readonly BulkSession[];
  watchlists?: WatchlistCollection;
  relationships?: readonly RelationshipObservation[];
  websiteSnapshots?: readonly WebsiteProfileSnapshot[];
  now?: unknown;
}>): RetainedEvidenceTimeline {
  const cases = Array.isArray(input.cases) ? input.cases : [];
  const bulkSessions = Array.isArray(input.bulkSessions) ? input.bulkSessions : [];
  const watchlists = input.watchlists && typeof input.watchlists === 'object' ? input.watchlists : {};
  const relationships = Array.isArray(input.relationships) ? input.relationships : [];
  const websiteSnapshots = Array.isArray(input.websiteSnapshots) ? input.websiteSnapshots : [];
  const now = timestamp(input.now) ?? new Date().toISOString();
  const all = [
    ...caseTimelineItems(cases, now),
    ...bulkTimelineItems(bulkSessions, now),
    ...websiteTimelineItems(websiteSnapshots, now),
    ...watchlistTimelineItems(watchlists, now),
    ...relationshipTimelineItems(relationships, now),
  ].sort(itemSort);
  const items = all.slice(0, MAX_RETAINED_TIMELINE_ITEMS);
  const inputTruncated = cases.length > 500
    || Object.keys(watchlists).length > 100
    || bulkSessions.length > 10
    || relationships.length > 300
    || websiteSnapshots.length > 60;
  const counts = Object.fromEntries([
    ['all', items.length],
    ['evidence', items.filter((item) => item.eventType === 'evidence').length],
    ['change', items.filter((item) => item.eventType === 'change').length],
    ...RETAINED_TIMELINE_KINDS.map((kind) => [kind, items.filter((item) => item.kind === kind).length]),
  ]) as Record<RetainedTimelineKind | 'all' | RetainedTimelineEventType, number>;
  const caseOptions = new Map<string, string>();
  const entityOptions = new Set<string>();
  const sourceOptions = new Set<string>();
  for (const item of items) {
    if (item.caseId && item.caseLabel) caseOptions.set(item.caseId, item.caseLabel);
    item.entities.forEach((entity) => entityOptions.add(entity));
    sourceOptions.add(item.source);
  }
  const freshnessCounts = {
    current: items.filter((item) => item.freshness === 'current').length,
    stale: items.filter((item) => item.freshness === 'stale').length,
    unknown: items.filter((item) => item.freshness === 'unknown').length,
  };
  return {
    items,
    truncated: inputTruncated || all.length > items.length,
    counts,
    entities: [...entityOptions].sort(),
    cases: [...caseOptions].map(([id, label]) => ({ id, label })).sort((left, right) => left.label.localeCompare(right.label)),
    sources: [...sourceOptions].sort(),
    freshnessCounts,
    limitations: [
      'This is a bounded projection of deliberately retained browser-local records. It does not run collection, duplicate raw payloads, or infer maliciousness.',
      'Observation time records when evidence was collected or asserted. Storage time records when this browser retained the owning record; the two are never silently merged.',
      'Open the owning record for complete retained detail, exact values, source limitations, and analyst notes.',
      'Freshness is a bounded age check over retained observation time. It does not run a lookup or imply that current live evidence has changed.',
    ],
  };
}

export function filterRetainedEvidenceTimeline(
  timeline: RetainedEvidenceTimeline,
  filters: RetainedTimelineFilters,
  now: unknown = new Date().toISOString(),
): RetainedTimelineItem[] {
  const normalizedEntity = text(filters.entity, 253).toLowerCase();
  const normalizedCase = text(filters.caseId, 128);
  const normalizedSource = text(filters.source, 120);
  const parsedNow = timestamp(now) || new Date(0).toISOString();
  const days = filters.time === '7d' ? 7 : filters.time === '30d' ? 30 : filters.time === '90d' ? 90 : null;
  const cutoff = days === null ? Number.NEGATIVE_INFINITY : Date.parse(parsedNow) - days * 86_400_000;
  return timeline.items.filter((item) =>
    (!normalizedEntity || item.entities.includes(normalizedEntity))
    && (!normalizedCase || item.caseId === normalizedCase)
    && (!normalizedSource || item.source === normalizedSource)
    && (!filters.area || item.areas.includes(filters.area))
    && (filters.freshness === 'all' || item.freshness === filters.freshness)
    && (filters.eventType === 'all' || item.eventType === filters.eventType)
    && Date.parse(item.observedAt) >= cutoff);
}
