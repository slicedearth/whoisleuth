import { caseLookupTarget, type CaseRecord } from './case-model.ts';
import type { BulkSession } from './bulk-session-model.ts';
import type { WatchlistCollection } from './watchlist-store.ts';
import {
  ANALYST_REVIEW_EVIDENCE_FAMILIES,
  ANALYST_REVIEW_KINDS,
  MAX_ANALYST_REVIEW_ITEMS,
  analystReviewLifecycle,
  analystReviewMaterialFingerprint,
  analystReviewSubjectKey,
  emptyAnalystReviewStateStore,
} from './analyst-review-state.ts';
import type {
  AnalystReviewAge,
  AnalystReviewCompleteness,
  AnalystReviewEvidenceFamily,
  AnalystReviewItem,
  AnalystReviewKind,
  AnalystReviewLifecycle,
  AnalystReviewLifecycleState,
  AnalystReviewNextAction,
  AnalystReviewPriority,
  AnalystReviewStateStore,
} from './analyst-review-state.ts';

export {
  ANALYST_REVIEW_EVIDENCE_FAMILIES,
  ANALYST_REVIEW_KINDS,
  MAX_ANALYST_REVIEW_ITEMS,
} from './analyst-review-state.ts';
export type {
  AnalystReviewAge,
  AnalystReviewCompleteness,
  AnalystReviewEvidenceFamily,
  AnalystReviewItem,
  AnalystReviewKind,
  AnalystReviewLifecycle,
  AnalystReviewLifecycleState,
  AnalystReviewNextAction,
  AnalystReviewPriority,
  AnalystReviewStateStore,
} from './analyst-review-state.ts';
export const ANALYST_REVIEW_DISMISSAL_REASONS = [
  { value: 'accepted_limitation', label: 'Accepted source limitation' },
  { value: 'reviewed_not_actionable', label: 'Reviewed, not actionable' },
  { value: 'superseded', label: 'Superseded by newer evidence' },
] as const;
export type AnalystReviewDismissalReason = typeof ANALYST_REVIEW_DISMISSAL_REASONS[number]['value'];

export type AnalystReviewInboxItem = AnalystReviewItem & Readonly<{ lifecycle: AnalystReviewLifecycle }>;

export const ANALYST_REVIEW_QUEUE_OPTIONS = [
  { value: 'needs_action', label: 'Needs action' },
  { value: 'waiting', label: 'Waiting / follow-up' },
  { value: 'changed', label: 'Changed since review' },
  { value: 'all', label: 'Everything' },
] as const;
export type AnalystReviewQueue = typeof ANALYST_REVIEW_QUEUE_OPTIONS[number]['value'];

export type AnalystReviewProjectionAdmission = Readonly<{
  omittedAtLeast: Readonly<Partial<Record<AnalystReviewEvidenceFamily, number>>>;
  lowerBoundFamilies: readonly AnalystReviewEvidenceFamily[];
  currentSubjectKeys?: readonly string[];
}>;

export type AnalystReviewAdmissionCount = Readonly<{
  displayed: number;
  totalAtLeast: number;
  omittedAtLeast: number;
  totalIsExact: boolean;
}>;

export type AnalystReviewAdmission = AnalystReviewAdmissionCount & Readonly<{
  byEvidenceFamily: Readonly<Record<AnalystReviewEvidenceFamily, AnalystReviewAdmissionCount>>;
}>;

export type AnalystReviewFilter = Readonly<{
  source?: string;
  age?: AnalystReviewAge;
  caseQuery?: string;
  priority?: AnalystReviewPriority;
  nextAction?: AnalystReviewNextAction;
  evidenceFamily?: AnalystReviewEvidenceFamily;
  lifecycle?: AnalystReviewLifecycleState;
}>;

export type AnalystReviewInbox = Readonly<{
  items: AnalystReviewInboxItem[];
  counts: Readonly<Record<AnalystReviewKind | 'all' | 'overdue', number>>;
  admission: AnalystReviewAdmission;
  truncated: boolean;
  limitations: readonly string[];
}>;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const OPEN_ACTION_STATES = new Set(['drafting', 'ready_for_review', 'reviewed', 'authorised', 'submitted', 'acknowledged']);
const LIMITED_SOURCE_STATES = new Set([
  'blocked',
  'error',
  'failed',
  'inconclusive',
  'partial',
  'rate_limited',
  'stale',
  'timeout',
  'truncated',
  'unavailable',
]);
const PRIORITY_RANK: Record<AnalystReviewPriority, number> = { urgent: 0, high: 1, normal: 2 };
const COMPLETENESS_RANK: Record<AnalystReviewCompleteness, number> = { inconclusive: 0, partial: 1, complete: 2 };
const DISMISSAL_PREFIX = 'evidence-gap-review:';
const CHANGED_REVIEW_KINDS = new Set<AnalystReviewKind>(['watchlist_change', 'comparison', 'certificate']);
export const ANALYST_REVIEW_AGING_AFTER_DAYS = 7;
export const ANALYST_REVIEW_STALE_AFTER_DAYS = 30;
const AGING_AFTER_MS = ANALYST_REVIEW_AGING_AFTER_DAYS * 24 * 60 * 60 * 1_000;
const STALE_AFTER_MS = ANALYST_REVIEW_STALE_AFTER_DAYS * 24 * 60 * 60 * 1_000;

export function analystReviewQueue(
  item: AnalystReviewInboxItem,
  now: unknown,
): Exclude<AnalystReviewQueue, 'all'> | 'reviewed' {
  const nowIso = timestamp(now) || new Date(0).toISOString();
  if (item.lifecycle.invalidated || item.lifecycle.recurred) return 'changed';
  if (item.lifecycle.state === 'resolved') return 'reviewed';
  const dueAt = item.dueAt ? Date.parse(item.dueAt) : Number.NaN;
  const futureFollowUp = Number.isFinite(dueAt) && dueAt > Date.parse(nowIso);
  if (item.lifecycle.state === 'expected' || item.lifecycle.state === 'suppressed' || futureFollowUp) return 'waiting';
  if (CHANGED_REVIEW_KINDS.has(item.kind)) return 'changed';
  return 'needs_action';
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

type AdmissionComparableItem = AnalystReviewItem & Readonly<{ lifecycle?: AnalystReviewLifecycle }>;

function lifecycleAdmissionRank(item: AdmissionComparableItem): number {
  if (item.lifecycle?.invalidated || item.lifecycle?.recurred) return 0;
  if (item.lifecycle?.expired || item.lifecycle?.reviewDue) return 1;
  if (item.lifecycle?.state === 'orphaned') return 2;
  return 3;
}

export function compareAnalystReviewAdmission(
  left: AdmissionComparableItem,
  right: AdmissionComparableItem,
  now: unknown,
): number {
  const nowIso = timestamp(now) || new Date(0).toISOString();
  return compareAnalystReviewAdmissionAt(left, right, Date.parse(nowIso));
}

function compareAnalystReviewAdmissionAt(
  left: AdmissionComparableItem,
  right: AdmissionComparableItem,
  nowMs: number,
): number {
  const leftDue = left.dueAt ? Date.parse(left.dueAt) : Number.POSITIVE_INFINITY;
  const rightDue = right.dueAt ? Date.parse(right.dueAt) : Number.POSITIVE_INFINITY;
  const leftOverdue = leftDue <= nowMs;
  const rightOverdue = rightDue <= nowMs;
  const priority = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
  if (priority) return priority;
  if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;
  const lifecycle = lifecycleAdmissionRank(left) - lifecycleAdmissionRank(right);
  if (lifecycle) return lifecycle;
  if (leftDue !== rightDue) return leftDue - rightDue;
  const completeness = COMPLETENESS_RANK[left.completeness] - COMPLETENESS_RANK[right.completeness];
  if (completeness) return completeness;
  const observed = Date.parse(left.observedAt) - Date.parse(right.observedAt);
  if (observed) return observed;
  return compareCodeUnits(left.subjectKey, right.subjectKey) || compareCodeUnits(left.id, right.id);
}

type RetainedReviewItems<T extends AnalystReviewItem> = Readonly<{
  items: readonly T[];
  candidateCounts: Readonly<Record<AnalystReviewEvidenceFamily, number>>;
  retainedCounts: Readonly<Record<AnalystReviewEvidenceFamily, number>>;
}>;

function emptyFamilyCounts(): Record<AnalystReviewEvidenceFamily, number> {
  return Object.fromEntries(ANALYST_REVIEW_EVIDENCE_FAMILIES.map((family) => [family, 0])) as Record<AnalystReviewEvidenceFamily, number>;
}

function heapSiftUp<T extends AnalystReviewItem>(
  heap: Array<Readonly<{ item: T; comparable: AdmissionComparableItem }>>,
  start: number,
  nowMs: number,
): void {
  let index = start;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (compareAnalystReviewAdmissionAt(heap[parent]!.comparable, heap[index]!.comparable, nowMs) >= 0) break;
    [heap[parent], heap[index]] = [heap[index]!, heap[parent]!];
    index = parent;
  }
}

function heapSiftDown<T extends AnalystReviewItem>(
  heap: Array<Readonly<{ item: T; comparable: AdmissionComparableItem }>>,
  nowMs: number,
): void {
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    if (left >= heap.length) return;
    const right = left + 1;
    const worse = right < heap.length
      && compareAnalystReviewAdmissionAt(heap[right]!.comparable, heap[left]!.comparable, nowMs) > 0
      ? right
      : left;
    if (compareAnalystReviewAdmissionAt(heap[index]!.comparable, heap[worse]!.comparable, nowMs) >= 0) return;
    [heap[index], heap[worse]] = [heap[worse]!, heap[index]!];
    index = worse;
  }
}

export function retainTopAnalystReviewItems<T extends AnalystReviewItem>(
  candidates: Iterable<T>,
  options: Readonly<{
    now: unknown;
    reviewState?: AnalystReviewStateStore;
    limit?: number;
  }>,
): RetainedReviewItems<T> {
  const nowIso = timestamp(options.now) || new Date(0).toISOString();
  const nowMs = Date.parse(nowIso);
  const limit = Math.max(0, Math.min(MAX_ANALYST_REVIEW_ITEMS, Math.trunc(options.limit ?? MAX_ANALYST_REVIEW_ITEMS)));
  const candidateCounts = emptyFamilyCounts();
  const heap: Array<Readonly<{ item: T; comparable: AdmissionComparableItem }>> = [];
  for (const item of candidates) {
    candidateCounts[item.evidenceFamily] += 1;
    const comparable: AdmissionComparableItem = options.reviewState
      ? { ...item, lifecycle: analystReviewLifecycle(item, options.reviewState, nowIso) }
      : item;
    const entry = { item, comparable };
    if (heap.length < limit) {
      heap.push(entry);
      heapSiftUp(heap, heap.length - 1, nowMs);
    } else if (limit > 0 && compareAnalystReviewAdmissionAt(comparable, heap[0]!.comparable, nowMs) < 0) {
      heap[0] = entry;
      heapSiftDown(heap, nowMs);
    }
  }
  const items = heap
    .sort((left, right) => compareAnalystReviewAdmissionAt(left.comparable, right.comparable, nowMs))
    .map((entry) => entry.item);
  const retainedCounts = emptyFamilyCounts();
  for (const item of items) retainedCounts[item.evidenceFamily] += 1;
  return { items, candidateCounts, retainedCounts };
}

function gapDismissalTarget(record: CaseRecord, gapIds: readonly string[]): string {
  const canonicalGapIds = [...new Set(gapIds)].sort(compareCodeUnits);
  const digest = analystReviewMaterialFingerprint([
    'case-evidence-gap-dismissal-v1',
    record.id,
    canonicalGapIds,
  ]).slice('material:'.length);
  return `${DISMISSAL_PREFIX}${record.id}:${digest}`;
}

function sourceId(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '');
  return normalized.slice(0, 40) || 'unknown';
}

function ageAt(observedAt: string, nowIso: string): AnalystReviewAge {
  const ageMs = Math.max(0, Date.parse(nowIso) - Date.parse(observedAt));
  if (ageMs > STALE_AFTER_MS) return 'stale';
  if (ageMs > AGING_AFTER_MS) return 'aging';
  return 'current';
}

function rankingReason(priority: AnalystReviewPriority, dueAt: string | null, nowIso: string): string {
  if (dueAt && Date.parse(dueAt) <= Date.parse(nowIso)) return 'Overdue work is listed first.';
  if (dueAt) return 'Dated work is ordered by its next due time.';
  if (priority === 'urgent') return 'Escalated or overdue review receives urgent priority.';
  if (priority === 'high') return 'Contradictory, failed, or submission-stage evidence receives high priority.';
  return 'Undated work is ordered by priority, newest observation, then stable identity.';
}

type AnalystReviewItemSeed = Omit<
  AnalystReviewItem,
  'age' | 'rankingReason' | 'subjectKey' | 'materialFingerprint' | 'evidenceFamily' | 'requiresExpiry' | 'campaignIds'
> & Partial<Pick<AnalystReviewItem, 'evidenceFamily' | 'requiresExpiry' | 'campaignIds'>>;

function reviewEvidenceFamily(kind: AnalystReviewKind): AnalystReviewEvidenceFamily {
  if (kind === 'watchlist_change' || kind === 'comparison') return 'comparison';
  if (kind === 'bulk_session') return 'bulk';
  if (kind === 'certificate') return 'certificate_identity';
  if (kind === 'desired_posture') return 'desired_posture';
  if (kind === 'suppression') return 'suppression';
  if (kind === 'change_window') return 'change_window';
  if (kind === 'detection_rule') return 'rule';
  if (kind === 'incomplete_packet') return 'packet';
  return 'case';
}

function withReviewMetadata(
  item: AnalystReviewItemSeed,
  nowIso: string,
): AnalystReviewItem {
  const evidenceFamily = item.evidenceFamily ?? reviewEvidenceFamily(item.kind);
  const subjectKey = analystReviewSubjectKey(evidenceFamily, [item.kind, item.id, item.caseId, item.caseDomain]);
  const materialFingerprint = analystReviewMaterialFingerprint([
    item.kind,
    item.priority,
    item.title,
    item.detail,
    item.sourceIds,
    item.observedAt,
    item.dueAt,
    item.completeness,
    item.nextAction,
  ]);
  return {
    ...item,
    evidenceFamily,
    subjectKey,
    materialFingerprint,
    requiresExpiry: item.requiresExpiry ?? true,
    campaignIds: item.campaignIds ?? [],
    age: ageAt(item.observedAt, nowIso),
    rankingReason: rankingReason(item.priority, item.dueAt, nowIso),
  };
}

export function analystReviewDismissalReasonLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return ANALYST_REVIEW_DISMISSAL_REASONS.find((item) => item.value === value)?.label ?? null;
}

function currentCaseEvidenceGap(record: CaseRecord, nowIso: string) {
  const openUnknownRecords = record.assertions.filter((item) => item.state === 'open' && item.kind === 'unknown');
  const openContradictionRecords = record.assertions.filter((item) => item.state === 'open' && item.kind === 'contradiction');
  const stalePinRecords = record.evidencePins.filter((item) => ageAt(item.observedAt, nowIso) === 'stale');
  const stalePinIds = new Set(stalePinRecords.map((item) => item.id));
  const limitedPinRecords = record.evidencePins.filter((item) =>
    item.completeness !== 'complete'
    || item.truncated === true
    || LIMITED_SOURCE_STATES.has(item.sourceState?.toLowerCase() ?? '')
    || stalePinIds.has(item.id)
  );
  const gapIds = [
    ...openUnknownRecords.map((item) => `unknown:${item.id}`),
    ...openContradictionRecords.map((item) => `contradiction:${item.id}`),
    ...limitedPinRecords.map((item) => `pin:${item.id}:${item.completeness}:${String(item.truncated)}`),
  ];
  const dismissalTarget = gapIds.length ? gapDismissalTarget(record, gapIds) : null;
  return {
    openUnknownRecords,
    openContradictionRecords,
    stalePinRecords,
    limitedPinRecords,
    dismissalTarget,
    dismissed: dismissalTarget !== null && record.manualTrail.some((event) =>
      event.kind === 'review' && event.target === dismissalTarget
    ),
  };
}

export function currentCaseEvidenceGapDismissedPinIds(record: CaseRecord, nowRaw: unknown): ReadonlySet<string> {
  if (record.status === 'resolved') return new Set();
  const nowIso = timestamp(nowRaw) || new Date().toISOString();
  const gap = currentCaseEvidenceGap(record, nowIso);
  return gap.dismissed ? new Set(gap.limitedPinRecords.map((item) => item.id)) : new Set();
}

function caseItems(records: readonly CaseRecord[], nowIso: string): AnalystReviewItem[] {
  const items: AnalystReviewItem[] = [];
  for (const record of records.slice(0, 500)) {
    const updatedAt = timestamp(record.updatedAt) || nowIso;
    if (record.status !== 'resolved' && record.disposition === 'unreviewed') {
      items.push(withReviewMetadata({
        id: `case:${record.id}`,
        kind: 'case',
        priority: record.status === 'escalated' ? 'urgent' : record.status === 'reviewing' ? 'high' : 'normal',
        title: `Review ${record.domain}`,
        detail: 'This open case has no analyst disposition.',
        source: 'Browser-local case',
        sourceIds: ['case'],
        caseDomain: record.domain,
        observedAt: updatedAt,
        dueAt: null,
        completeness: record.evidenceHistory.length || record.evidencePins.length ? 'partial' : 'inconclusive',
        nextAction: 'review',
        href: `/monitor?view=cases&case=${encodeURIComponent(record.id)}`,
        retryHref: null,
        caseId: record.id,
        dismissalTarget: null,
      }, nowIso));
    }
    const {
      openUnknownRecords,
      openContradictionRecords,
      stalePinRecords,
      limitedPinRecords,
      dismissalTarget,
      dismissed,
    } = currentCaseEvidenceGap(record, nowIso);
    const openUnknowns = openUnknownRecords.length;
    const openContradictions = openContradictionRecords.length;
    const limitedPins = limitedPinRecords.length;
    const gapCount = openUnknowns + openContradictions + limitedPins;
    if (record.status !== 'resolved' && gapCount > 0) {
      if (!dismissed) {
        const parts = [
          openUnknowns ? `${openUnknowns} open unknown${openUnknowns === 1 ? '' : 's'}` : '',
          openContradictions ? `${openContradictions} open contradiction${openContradictions === 1 ? '' : 's'}` : '',
          limitedPins ? `${limitedPins} limited evidence pin${limitedPins === 1 ? '' : 's'}` : '',
          stalePinRecords.length ? `${stalePinRecords.length} stale observation${stalePinRecords.length === 1 ? '' : 's'}` : '',
        ].filter(Boolean);
        const priority: AnalystReviewPriority = openContradictions > 0
          || limitedPinRecords.some((item) => LIMITED_SOURCE_STATES.has(item.sourceState?.toLowerCase() ?? ''))
          ? 'high'
          : 'normal';
        items.push(withReviewMetadata({
          id: `evidence-gap:${record.id}`,
          kind: 'evidence_gap',
          priority,
          title: `Review evidence gaps for ${record.domain}`,
          detail: parts.join(' · '),
          source: 'Browser-local case evidence and analyst assertions',
          sourceIds: [...new Set([
            ...limitedPinRecords.map((item) => sourceId(item.source)),
            ...(openUnknowns || openContradictions ? ['analyst_assertion'] : []),
          ])].sort(),
          caseDomain: record.domain,
          observedAt: updatedAt,
          dueAt: null,
          completeness: openContradictions || openUnknowns ? 'inconclusive' : 'partial',
          nextAction: limitedPins ? 'refresh' : 'review',
          href: `/monitor?view=cases&case=${encodeURIComponent(record.id)}#case-response-${encodeURIComponent(record.id)}`,
          retryHref: `/lookup?q=${encodeURIComponent(record.domain)}&depth=deep`,
          caseId: record.id,
          dismissalTarget: dismissalTarget!,
        }, nowIso));
      }
    }
    for (const action of record.actions.slice(-50)) {
      if (!OPEN_ACTION_STATES.has(action.state)) continue;
      const dueAt = timestamp(action.followUpAt) || timestamp(action.dueAt);
      const overdue = dueAt !== null && Date.parse(dueAt) <= Date.parse(nowIso);
      const priority: AnalystReviewPriority = overdue ? 'urgent' : ['ready_for_review', 'reviewed', 'authorised', 'submitted'].includes(action.state) ? 'high' : 'normal';
      items.push(withReviewMetadata({
        id: `action:${record.id}:${action.id}`,
        kind: 'case_action',
        priority,
        title: `${action.type.replaceAll('_', ' ')} for ${record.domain}`,
        detail: `${action.state.replaceAll('_', ' ')} · ${action.recipient}`,
        source: 'Reviewed case action',
        sourceIds: ['case_action'],
        caseDomain: record.domain,
        observedAt: timestamp(action.updatedAt) || updatedAt,
        dueAt,
        completeness: action.state === 'submitted' || action.state === 'acknowledged' ? 'complete' : 'partial',
        nextAction: 'follow_up',
        href: `/monitor?view=cases&case=${encodeURIComponent(record.id)}`,
        retryHref: null,
        caseId: record.id,
        dismissalTarget: null,
      }, nowIso));
    }
    for (const review of (record.observedEffects?.reviews ?? []).slice(-40)) {
      const dueAt = timestamp(review.followUpAt);
      if (!dueAt) continue;
      const overdue = Date.parse(dueAt) <= Date.parse(nowIso);
      items.push(withReviewMetadata({
        id: `observed-effect:${record.id}:${review.id}`,
        kind: 'observed_effect_review',
        priority: overdue ? 'urgent' : review.state === 'still_observed' || review.state === 'unavailable' ? 'high' : 'normal',
        title: `Independent effect follow-up for ${record.domain}`,
        detail: `${review.state.replaceAll('_', ' ')} · ${review.source} · ${review.completeness}`,
        source: 'Independent browser-local observed-effect review',
        sourceIds: ['observed_effect_review'],
        caseDomain: record.domain,
        observedAt: timestamp(review.observedAt) || updatedAt,
        dueAt,
        completeness: review.completeness === 'complete' ? 'complete' : review.completeness === 'partial' ? 'partial' : 'inconclusive',
        nextAction: 'follow_up',
        href: `/monitor?view=cases&case=${encodeURIComponent(record.id)}#case-response-${encodeURIComponent(record.id)}`,
        retryHref: null,
        caseId: record.id,
        dismissalTarget: null,
      }, nowIso));
    }
  }
  return items;
}

function watchlistItems(
  watchlists: WatchlistCollection,
  cases: readonly CaseRecord[],
  nowIso: string,
): AnalystReviewItem[] {
  const items: AnalystReviewItem[] = [];
  for (const [name, watchlist] of Object.entries(watchlists).slice(0, 100)) {
    const latestChange = [...watchlist.history].reverse().find((event) => event.changeCount > 0);
    if (!latestChange) continue;
    const observedAt = timestamp(latestChange.checkedAt) || timestamp(watchlist.updatedAt) || nowIso;
    const priority: AnalystReviewPriority = latestChange.changes.some((change) => change.tone === 'danger') ? 'high' : 'normal';
    const changedDomains = new Set(latestChange.changes.map((change) => change.domain));
    const relatedCases = cases.filter((record) => (
      changedDomains.has(record.domain) || changedDomains.has(caseLookupTarget(record))
    ));
    const relatedCase = changedDomains.size === 1 && relatedCases.length === 1 ? relatedCases[0] ?? null : null;
    items.push(withReviewMetadata({
      id: `watchlist:${name}`,
      kind: 'watchlist_change',
      priority,
      title: `${name} has ${latestChange.changeCount} material change${latestChange.changeCount === 1 ? '' : 's'}`,
      detail: `${latestChange.conclusiveCount} of ${latestChange.resultCount} results were conclusive. ${latestChange.omittedChanges} changes were omitted by the history bound.${relatedCase ? ` Related Case: ${relatedCase.domain}.` : relatedCases.length ? ` ${relatedCases.length} Case${relatedCases.length === 1 ? '' : 's'} match${relatedCases.length === 1 ? 'es' : ''} ${changedDomains.size > 1 ? 'only part of the changed scope' : 'the changed hostname'}; review the watchlist before choosing one.` : ''}`,
      source: 'Browser-local watchlist history',
      sourceIds: ['watchlist'],
      caseDomain: relatedCase?.domain ?? null,
      observedAt,
      dueAt: null,
      completeness: latestChange.conclusiveCount === latestChange.resultCount && latestChange.omittedChanges === 0 ? 'complete' : 'partial',
      nextAction: 'review',
      href: relatedCase
        ? `/monitor?view=cases&case=${encodeURIComponent(relatedCase.id)}#case-response-${encodeURIComponent(relatedCase.id)}`
        : `/monitor?view=watchlists&watchlist=${encodeURIComponent(name)}`,
      retryHref: null,
      caseId: relatedCase?.id ?? null,
      dismissalTarget: null,
    }, nowIso));
  }
  return items;
}

function bulkItems(sessions: readonly BulkSession[], nowIso: string): AnalystReviewItem[] {
  const items: AnalystReviewItem[] = [];
  for (const session of sessions.slice(0, 10)) {
    const errorCount = session.results.filter((result) => result.status === 'error').length;
    if (session.state === 'complete' && errorCount === 0) continue;
    const pending = Math.max(0, session.domains.length - session.results.length);
    const priority: AnalystReviewPriority = errorCount > 0 ? 'high' : 'normal';
    items.push(withReviewMetadata({
      id: `bulk:${session.id}`,
      kind: 'bulk_session',
      priority,
      title: `Continue ${session.name}`,
      detail: `${pending} pending and ${errorCount} failed result${errorCount === 1 ? '' : 's'} in a ${session.state} ${session.mode} session.`,
      source: 'Saved Bulk session',
      sourceIds: ['bulk'],
      caseDomain: null,
      observedAt: timestamp(session.updatedAt) || nowIso,
      dueAt: null,
      completeness: 'partial',
      nextAction: 'resume',
      href: '/bulk#bulk-sessions-title',
      retryHref: null,
      caseId: null,
      dismissalTarget: null,
    }, nowIso));
  }
  return items;
}

export function filterAnalystReviewItems(
  items: readonly AnalystReviewInboxItem[],
  filter: AnalystReviewFilter,
): AnalystReviewInboxItem[] {
  const source = sourceId(filter.source ?? '');
  const query = typeof filter.caseQuery === 'string'
    ? filter.caseQuery.trim().toLowerCase().slice(0, 253)
    : '';
  return items.filter((item) =>
    (!filter.source || item.sourceIds.includes(source))
    && (!filter.age || item.age === filter.age)
    && (!query || item.caseDomain?.toLowerCase().includes(query))
    && (!filter.priority || item.priority === filter.priority)
    && (!filter.nextAction || item.nextAction === filter.nextAction)
    && (!filter.evidenceFamily || item.evidenceFamily === filter.evidenceFamily)
    && (!filter.lifecycle || (filter.lifecycle === 'recurred'
      ? item.lifecycle.recurred
      : item.lifecycle.state === filter.lifecycle))
  );
}

function orphanedReviewItem(
  decision: AnalystReviewStateStore['records'][number],
  nowIso: string,
): AnalystReviewInboxItem {
  const dueAt = decision.reviewDueAt ?? decision.expiresAt;
  const nowMs = Date.parse(nowIso);
  const expired = decision.expiresAt !== null && Date.parse(decision.expiresAt) <= nowMs;
  const reviewDue = decision.reviewDueAt !== null && Date.parse(decision.reviewDueAt) <= nowMs;
  const familyLabel = decision.evidenceFamily.replaceAll('_', ' ');
  return {
    id: `orphaned:${decision.subjectKey.slice(-64)}`,
    kind: 'orphaned_state',
    evidenceFamily: decision.evidenceFamily,
    subjectKey: decision.subjectKey,
    materialFingerprint: decision.reviewedFingerprint,
    requiresExpiry: true,
    priority: expired || reviewDue ? 'high' : 'normal',
    title: `Source evidence unavailable for retained ${familyLabel} review`,
    detail: `The imported or retained analyst decision has no current matching Review Item. Its ${familyLabel} source evidence is unavailable in this workspace, so the earlier disposition cannot resolve or hide current evidence.`,
    source: 'Browser-local analyst Review Item lifecycle',
    sourceIds: ['analyst_review_state'],
    caseDomain: null,
    observedAt: decision.reviewedAt,
    dueAt,
    age: ageAt(decision.reviewedAt, nowIso),
    completeness: 'inconclusive',
    nextAction: 'review',
    rankingReason: expired || reviewDue
      ? 'The retained lifecycle time has arrived, but its source evidence is unavailable.'
      : 'The source evidence for this retained analyst decision is unavailable.',
    href: '/monitor?view=inbox',
    retryHref: null,
    caseId: decision.caseIds[0] ?? null,
    campaignIds: decision.campaignIds,
    dismissalTarget: null,
    lifecycle: {
      state: 'orphaned',
      effectiveDisposition: 'open',
      decision,
      reason: 'The retained analyst decision has no matching current evidence. It remains preserved but unavailable and cannot be treated as resolved.',
      expired,
      invalidated: false,
      recurred: false,
      reviewDue,
    },
  };
}

function boundedAdmissionCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, Number.MAX_SAFE_INTEGER)
    : 0;
}

function projectionAdmission(
  admissions: readonly AnalystReviewProjectionAdmission[],
): Readonly<{
  omittedAtLeast: Readonly<Record<AnalystReviewEvidenceFamily, number>>;
  lowerBoundFamilies: Set<AnalystReviewEvidenceFamily>;
  currentSubjectKeys: Set<string>;
}> {
  const omittedAtLeast = emptyFamilyCounts();
  const lowerBoundFamilies = new Set<AnalystReviewEvidenceFamily>();
  const currentSubjectKeys = new Set<string>();
  for (const admission of admissions) {
    for (const family of ANALYST_REVIEW_EVIDENCE_FAMILIES) {
      const next = boundedAdmissionCount(admission.omittedAtLeast[family]);
      omittedAtLeast[family] = Math.min(Number.MAX_SAFE_INTEGER, omittedAtLeast[family] + next);
    }
    for (const family of admission.lowerBoundFamilies) {
      if (ANALYST_REVIEW_EVIDENCE_FAMILIES.includes(family)) lowerBoundFamilies.add(family);
    }
    for (const subjectKey of admission.currentSubjectKeys ?? []) {
      if (/^review:[a-z_]+:[a-f0-9]{64}$/u.test(subjectKey)) currentSubjectKeys.add(subjectKey);
    }
  }
  return { omittedAtLeast, lowerBoundFamilies, currentSubjectKeys };
}

function buildAdmission(
  candidates: readonly AnalystReviewInboxItem[],
  displayed: readonly AnalystReviewInboxItem[],
  projected: ReturnType<typeof projectionAdmission>,
): AnalystReviewAdmission {
  const candidateCounts = emptyFamilyCounts();
  const displayedCounts = emptyFamilyCounts();
  for (const item of candidates) candidateCounts[item.evidenceFamily] += 1;
  for (const item of displayed) displayedCounts[item.evidenceFamily] += 1;
  const byEvidenceFamily = Object.fromEntries(ANALYST_REVIEW_EVIDENCE_FAMILIES.map((family) => {
    const totalAtLeast = Math.min(
      Number.MAX_SAFE_INTEGER,
      candidateCounts[family] + projected.omittedAtLeast[family],
    );
    return [family, Object.freeze({
      displayed: displayedCounts[family],
      totalAtLeast,
      omittedAtLeast: Math.max(0, totalAtLeast - displayedCounts[family]),
      totalIsExact: !projected.lowerBoundFamilies.has(family),
    })];
  })) as Record<AnalystReviewEvidenceFamily, AnalystReviewAdmissionCount>;
  const totalAtLeast = Object.values(byEvidenceFamily)
    .reduce((sum, count) => Math.min(Number.MAX_SAFE_INTEGER, sum + count.totalAtLeast), 0);
  return {
    displayed: displayed.length,
    totalAtLeast,
    omittedAtLeast: Math.max(0, totalAtLeast - displayed.length),
    totalIsExact: Object.values(byEvidenceFamily).every((count) => count.totalIsExact),
    byEvidenceFamily,
  };
}

export function buildAnalystReviewInbox(
  input: Readonly<{
    cases?: readonly CaseRecord[];
    watchlists?: WatchlistCollection;
    bulkSessions?: readonly BulkSession[];
    reviewState?: AnalystReviewStateStore;
    projectedItems?: readonly AnalystReviewItem[];
    projectedAdmissions?: readonly AnalystReviewProjectionAdmission[];
  }>,
  now: unknown = new Date().toISOString(),
): AnalystReviewInbox {
  const nowIso = timestamp(now) || new Date(0).toISOString();
  const nowMs = Date.parse(nowIso);
  const projected = projectionAdmission(input.projectedAdmissions ?? []);
  if ((input.cases?.length ?? 0) > 500) projected.lowerBoundFamilies.add('case');
  if (Object.keys(input.watchlists ?? {}).length > 100) projected.lowerBoundFamilies.add('comparison');
  if ((input.bulkSessions?.length ?? 0) > 10) projected.lowerBoundFamilies.add('bulk');
  const all = [
    ...caseItems(Array.isArray(input.cases) ? input.cases : [], nowIso),
    ...watchlistItems(
      input.watchlists && typeof input.watchlists === 'object' ? input.watchlists : {},
      Array.isArray(input.cases) ? input.cases : [],
      nowIso,
    ),
    ...bulkItems(Array.isArray(input.bulkSessions) ? input.bulkSessions : [], nowIso),
    ...(Array.isArray(input.projectedItems) ? input.projectedItems : []),
  ];
  const reviewState = input.reviewState ?? emptyAnalystReviewStateStore();
  const currentItems = all.map((item) => ({
    ...item,
    lifecycle: analystReviewLifecycle(item, reviewState, nowIso),
  }));
  const currentSubjects = new Set([
    ...currentItems.map((item) => item.subjectKey),
    ...projected.currentSubjectKeys,
  ]);
  const orphanedItems = reviewState.records
    .filter((decision) => !currentSubjects.has(decision.subjectKey))
    .map((decision) => orphanedReviewItem(decision, nowIso));
  const combinedItems = [...currentItems, ...orphanedItems];
  const items = retainTopAnalystReviewItems(combinedItems, { now: nowIso }).items as AnalystReviewInboxItem[];
  const admission = buildAdmission(combinedItems, items, projected);
  const counts: Record<AnalystReviewKind | 'all' | 'overdue', number> = {
    all: items.length,
    overdue: items.filter((item) => item.dueAt !== null && Date.parse(item.dueAt) <= nowMs).length,
    case: items.filter((item) => item.kind === 'case').length,
    case_action: items.filter((item) => item.kind === 'case_action').length,
    observed_effect_review: items.filter((item) => item.kind === 'observed_effect_review').length,
    evidence_gap: items.filter((item) => item.kind === 'evidence_gap').length,
    watchlist_change: items.filter((item) => item.kind === 'watchlist_change').length,
    bulk_session: items.filter((item) => item.kind === 'bulk_session').length,
    comparison: items.filter((item) => item.kind === 'comparison').length,
    suppression: items.filter((item) => item.kind === 'suppression').length,
    change_window: items.filter((item) => item.kind === 'change_window').length,
    desired_posture: items.filter((item) => item.kind === 'desired_posture').length,
    certificate: items.filter((item) => item.kind === 'certificate').length,
    incomplete_packet: items.filter((item) => item.kind === 'incomplete_packet').length,
    detection_rule: items.filter((item) => item.kind === 'detection_rule').length,
    orphaned_state: items.filter((item) => item.kind === 'orphaned_state').length,
  };
  return {
    items,
    counts,
    admission,
    truncated: !admission.totalIsExact || admission.omittedAtLeast > 0,
    limitations: [
      'This browser-local queue makes no request and does not change its source records.',
      'Partial, unavailable and inconclusive evidence remains open for review; it is not treated as absence or safety.',
      'A lifecycle decision applies only to the exact retained evidence. Material change, expiry or unavailable source evidence returns it to review.',
    ],
  };
}
