import type { CaseRecord } from './case-model.ts';
import type { BulkSession } from './bulk-session-model.ts';
import type { WatchlistCollection } from './watchlist-store.ts';

export const MAX_ANALYST_REVIEW_ITEMS = 500;
export const ANALYST_REVIEW_KINDS = ['case', 'case_action', 'evidence_gap', 'watchlist_change', 'bulk_session'] as const;
export type AnalystReviewKind = typeof ANALYST_REVIEW_KINDS[number];
export type AnalystReviewPriority = 'urgent' | 'high' | 'normal';
export type AnalystReviewCompleteness = 'complete' | 'partial' | 'inconclusive';
export const ANALYST_REVIEW_DISMISSAL_REASONS = [
  { value: 'accepted_limitation', label: 'Accepted source limitation' },
  { value: 'reviewed_not_actionable', label: 'Reviewed, not actionable' },
  { value: 'superseded', label: 'Superseded by newer evidence' },
] as const;
export type AnalystReviewDismissalReason = typeof ANALYST_REVIEW_DISMISSAL_REASONS[number]['value'];

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
  retryHref: string | null;
  caseId: string | null;
  dismissalTarget: string | null;
}>;

export type AnalystReviewInbox = Readonly<{
  items: AnalystReviewItem[];
  counts: Readonly<Record<AnalystReviewKind | 'all' | 'overdue', number>>;
  truncated: boolean;
  limitations: readonly string[];
}>;

const OPEN_ACTION_STATES = new Set(['planned', 'ready_for_review', 'submitted', 'acknowledged']);
const PRIORITY_RANK: Record<AnalystReviewPriority, number> = { urgent: 0, high: 1, normal: 2 };
const DISMISSAL_PREFIX = 'evidence-gap-review:';

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

function hashGapParts(parts: readonly string[]): string {
  let value = 0x811c9dc5;
  for (const character of parts.join('\u001f')) {
    value ^= character.codePointAt(0) ?? 0;
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, '0');
}

function gapDismissalTarget(record: CaseRecord, gapIds: readonly string[]): string {
  return `${DISMISSAL_PREFIX}${record.id}:${hashGapParts([...gapIds].sort())}`;
}

export function analystReviewDismissalReasonLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return ANALYST_REVIEW_DISMISSAL_REASONS.find((item) => item.value === value)?.label ?? null;
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
        retryHref: null,
        caseId: record.id,
        dismissalTarget: null,
      });
    }
    const openUnknownRecords = record.assertions.filter((item) => item.state === 'open' && item.kind === 'unknown');
    const openContradictionRecords = record.assertions.filter((item) => item.state === 'open' && item.kind === 'contradiction');
    const limitedPinRecords = record.evidencePins.filter((item) =>
      item.completeness !== 'complete' || item.truncated === true
    );
    const openUnknowns = openUnknownRecords.length;
    const openContradictions = openContradictionRecords.length;
    const limitedPins = limitedPinRecords.length;
    const gapCount = openUnknowns + openContradictions + limitedPins;
    if (record.status !== 'resolved' && gapCount > 0) {
      const dismissalTarget = gapDismissalTarget(record, [
        ...openUnknownRecords.map((item) => `unknown:${item.id}`),
        ...openContradictionRecords.map((item) => `contradiction:${item.id}`),
        ...limitedPinRecords.map((item) => `pin:${item.id}:${item.completeness}:${String(item.truncated)}`),
      ]);
      const dismissed = record.manualTrail.some((event) =>
        event.kind === 'review' && event.target === dismissalTarget
      );
      if (!dismissed) {
        const parts = [
          openUnknowns ? `${openUnknowns} open unknown${openUnknowns === 1 ? '' : 's'}` : '',
          openContradictions ? `${openContradictions} open contradiction${openContradictions === 1 ? '' : 's'}` : '',
          limitedPins ? `${limitedPins} limited evidence pin${limitedPins === 1 ? '' : 's'}` : '',
        ].filter(Boolean);
        items.push({
          id: `evidence-gap:${record.id}`,
          kind: 'evidence_gap',
          priority: openContradictions > 0 ? 'high' : 'normal',
          title: `Review evidence gaps for ${record.domain}`,
          detail: parts.join(' · '),
          source: 'Browser-local case evidence and analyst assertions',
          observedAt: updatedAt,
          dueAt: null,
          completeness: openContradictions || openUnknowns ? 'inconclusive' : 'partial',
          href: `/monitor?view=cases&case=${encodeURIComponent(record.id)}#case-response-${encodeURIComponent(record.id)}`,
          retryHref: `/lookup?q=${encodeURIComponent(record.domain)}&depth=deep`,
          caseId: record.id,
          dismissalTarget,
        });
      }
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
        retryHref: null,
        caseId: record.id,
        dismissalTarget: null,
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
      retryHref: null,
      caseId: null,
      dismissalTarget: null,
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
      retryHref: null,
      caseId: null,
      dismissalTarget: null,
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
    evidence_gap: items.filter((item) => item.kind === 'evidence_gap').length,
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
      'Evidence gaps are projected from explicit incomplete pins and open unknown or contradiction assertions; the queue does not invent missing facts.',
      'A reviewed dismissal hides only the exact current gap fingerprint and records the fixed reason in the case investigation trail. It does not resolve, delete, or rewrite the underlying evidence or assertion.',
    ],
  };
}
