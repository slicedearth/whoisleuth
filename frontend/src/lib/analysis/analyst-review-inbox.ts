import type { CaseRecord } from './case-model.ts';
import type { BulkSession } from './bulk-session-model.ts';
import type { WatchlistCollection } from './watchlist-store.ts';

export const MAX_ANALYST_REVIEW_ITEMS = 500;
export const ANALYST_REVIEW_KINDS = ['case', 'case_action', 'watchlist_change', 'bulk_session'] as const;
export type AnalystReviewKind = typeof ANALYST_REVIEW_KINDS[number];
export type AnalystReviewPriority = 'urgent' | 'high' | 'normal';
export type AnalystReviewCompleteness = 'complete' | 'partial' | 'inconclusive';

export type AnalystReviewItem = Readonly<{
  id: string;
  kind: AnalystReviewKind;
  priority: AnalystReviewPriority;
  title: string;
  detail: string;
  source: string;
  observedAt: string;
  dueAt: string | null;
  completeness: AnalystReviewCompleteness;
  href: string;
}>;

export type AnalystReviewInbox = Readonly<{
  items: AnalystReviewItem[];
  counts: Readonly<Record<AnalystReviewKind | 'all' | 'overdue', number>>;
  truncated: boolean;
  limitations: readonly string[];
}>;

const OPEN_ACTION_STATES = new Set(['planned', 'ready_for_review', 'submitted', 'acknowledged']);
const PRIORITY_RANK: Record<AnalystReviewPriority, number> = { urgent: 0, high: 1, normal: 2 };

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function itemSort(left: AnalystReviewItem, right: AnalystReviewItem, nowMs: number): number {
  const leftDue = left.dueAt ? Date.parse(left.dueAt) : Number.POSITIVE_INFINITY;
  const rightDue = right.dueAt ? Date.parse(right.dueAt) : Number.POSITIVE_INFINITY;
  const leftOverdue = leftDue <= nowMs;
  const rightOverdue = rightDue <= nowMs;
  if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;
  if (leftDue !== rightDue) return leftDue - rightDue;
  const priority = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
  if (priority) return priority;
  return Date.parse(right.observedAt) - Date.parse(left.observedAt) || left.id.localeCompare(right.id);
}

function caseItems(records: readonly CaseRecord[], nowIso: string): AnalystReviewItem[] {
  const items: AnalystReviewItem[] = [];
  for (const record of records.slice(0, 500)) {
    const updatedAt = timestamp(record.updatedAt) || nowIso;
    if (record.status !== 'resolved' && record.disposition === 'unreviewed') {
      items.push({
        id: `case:${record.id}`,
        kind: 'case',
        priority: record.status === 'escalated' ? 'urgent' : record.status === 'reviewing' ? 'high' : 'normal',
        title: `Review ${record.domain}`,
        detail: 'This open case has no analyst disposition.',
        source: 'Browser-local case',
        observedAt: updatedAt,
        dueAt: null,
        completeness: record.evidenceHistory.length || record.evidencePins.length ? 'partial' : 'inconclusive',
        href: `/monitor?view=cases&case=${encodeURIComponent(record.id)}`,
      });
    }
    for (const action of record.actions.slice(-50)) {
      if (!OPEN_ACTION_STATES.has(action.state)) continue;
      const dueAt = timestamp(action.followUpAt) || timestamp(action.dueAt);
      const overdue = dueAt !== null && Date.parse(dueAt) <= Date.parse(nowIso);
      items.push({
        id: `action:${record.id}:${action.id}`,
        kind: 'case_action',
        priority: overdue ? 'urgent' : action.state === 'ready_for_review' || action.state === 'submitted' ? 'high' : 'normal',
        title: `${action.type.replaceAll('_', ' ')} for ${record.domain}`,
        detail: `${action.state.replaceAll('_', ' ')} · ${action.recipient}`,
        source: 'Reviewed case action',
        observedAt: timestamp(action.updatedAt) || updatedAt,
        dueAt,
        completeness: action.state === 'submitted' || action.state === 'acknowledged' ? 'complete' : 'partial',
        href: `/monitor?view=cases&case=${encodeURIComponent(record.id)}`,
      });
    }
  }
  return items;
}

function watchlistItems(watchlists: WatchlistCollection, nowIso: string): AnalystReviewItem[] {
  const items: AnalystReviewItem[] = [];
  for (const [name, watchlist] of Object.entries(watchlists).slice(0, 100)) {
    const latestChange = [...watchlist.history].reverse().find((event) => event.changeCount > 0);
    if (!latestChange) continue;
    const observedAt = timestamp(latestChange.checkedAt) || timestamp(watchlist.updatedAt) || nowIso;
    items.push({
      id: `watchlist:${name}:${observedAt}`,
      kind: 'watchlist_change',
      priority: latestChange.changes.some((change) => change.tone === 'danger') ? 'high' : 'normal',
      title: `${name} has ${latestChange.changeCount} material change${latestChange.changeCount === 1 ? '' : 's'}`,
      detail: `${latestChange.conclusiveCount} of ${latestChange.resultCount} results were conclusive. ${latestChange.omittedChanges} changes were omitted by the history bound.`,
      source: 'Browser-local watchlist history',
      observedAt,
      dueAt: null,
      completeness: latestChange.conclusiveCount === latestChange.resultCount && latestChange.omittedChanges === 0 ? 'complete' : 'partial',
      href: '/monitor?view=watchlists',
    });
  }
  return items;
}

function bulkItems(sessions: readonly BulkSession[], nowIso: string): AnalystReviewItem[] {
  const items: AnalystReviewItem[] = [];
  for (const session of sessions.slice(0, 10)) {
    const errorCount = session.results.filter((result) => result.status === 'error').length;
    if (session.state === 'complete' && errorCount === 0) continue;
    const pending = Math.max(0, session.domains.length - session.results.length);
    items.push({
      id: `bulk:${session.id}`,
      kind: 'bulk_session',
      priority: errorCount > 0 ? 'high' : 'normal',
      title: `Continue ${session.name}`,
      detail: `${pending} pending and ${errorCount} failed result${errorCount === 1 ? '' : 's'} in a ${session.state} ${session.mode} session.`,
      source: 'Saved Bulk session',
      observedAt: timestamp(session.updatedAt) || nowIso,
      dueAt: null,
      completeness: 'partial',
      href: '/bulk#saved-sessions',
    });
  }
  return items;
}

export function buildAnalystReviewInbox(
  input: Readonly<{
    cases?: readonly CaseRecord[];
    watchlists?: WatchlistCollection;
    bulkSessions?: readonly BulkSession[];
  }>,
  now: unknown = new Date().toISOString(),
): AnalystReviewInbox {
  const nowIso = timestamp(now) || new Date(0).toISOString();
  const nowMs = Date.parse(nowIso);
  const inputTruncated = (input.cases?.length ?? 0) > 500
    || Object.keys(input.watchlists ?? {}).length > 100
    || (input.bulkSessions?.length ?? 0) > 10;
  const all = [
    ...caseItems(Array.isArray(input.cases) ? input.cases : [], nowIso),
    ...watchlistItems(input.watchlists && typeof input.watchlists === 'object' ? input.watchlists : {}, nowIso),
    ...bulkItems(Array.isArray(input.bulkSessions) ? input.bulkSessions : [], nowIso),
  ].sort((left, right) => itemSort(left, right, nowMs));
  const items = all.slice(0, MAX_ANALYST_REVIEW_ITEMS);
  const counts = {
    all: items.length,
    overdue: items.filter((item) => item.dueAt !== null && Date.parse(item.dueAt) <= nowMs).length,
    case: items.filter((item) => item.kind === 'case').length,
    case_action: items.filter((item) => item.kind === 'case_action').length,
    watchlist_change: items.filter((item) => item.kind === 'watchlist_change').length,
    bulk_session: items.filter((item) => item.kind === 'bulk_session').length,
  };
  return {
    items,
    counts,
    truncated: inputTruncated || all.length > items.length,
    limitations: [
      'The inbox is a browser-local projection of retained records. It does not run checks, change cases, or infer maliciousness.',
      'Partial and inconclusive source states remain review prompts, not evidence of absence or safety.',
    ],
  };
}
