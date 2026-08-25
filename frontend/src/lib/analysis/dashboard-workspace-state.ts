import type { CaseRecord } from './case-model.ts';
import type { AnalystReviewInboxItem } from './analyst-review-inbox.ts';
import type {
  AnalystReviewLifecycle,
} from './analyst-review-state.ts';
import type {
  BrowserLocalCollectionDocumentMap,
  BrowserLocalCollectionId,
} from '../browser-local-data-definitions.ts';

export const DASHBOARD_REQUIRED_COLLECTION_IDS = Object.freeze([
  'cases',
  'campaigns',
  'brand_profiles',
  'watchlists',
  'shortlist',
  'ct_history',
  'detection_rules',
  'relationship_observations',
  'bulk_sessions',
  'website_snapshots',
  'investigation_templates',
  'bulk_review',
  'analyst_review_state',
] as const satisfies readonly BrowserLocalCollectionId[]);

export type DashboardWorkspaceState = 'loading' | 'first_use' | 'returning' | 'unavailable';

export type DashboardAttentionItem = Readonly<{
  subjectKey: string;
  title: string;
  detail: string;
  href: string;
  lifecycle: AnalystReviewLifecycle;
  dueAt: string | null;
  source: string;
}>;

export type DashboardAttentionSummary = Readonly<{
  items: readonly DashboardAttentionItem[];
  attentionNeeded: number;
  overdue: number;
  changedSinceReview: number;
  expired: number;
  dueFollowUps: number;
  openCases: number;
  watchlists: number;
  truncated: boolean;
}>;

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export function dashboardCollectionRecordCount(
  collection: BrowserLocalCollectionId,
  document: unknown,
): number {
  if (collection === 'watchlists') return Object.keys(document as BrowserLocalCollectionDocumentMap['watchlists']).length;
  if (collection === 'ct_history') return (document as BrowserLocalCollectionDocumentMap['ct_history']).entries.length;
  if (collection === 'bulk_review') {
    const store = document as BrowserLocalCollectionDocumentMap['bulk_review'];
    return store.presets.length + store.rows.length;
  }
  if (collection === 'analyst_review_state') {
    return (document as BrowserLocalCollectionDocumentMap['analyst_review_state']).records.length;
  }
  return arrayLength(document);
}

export function dashboardWorkspaceState(
  results: readonly Readonly<{ status: 'ready'; count: number } | { status: 'unavailable' }>[],
): DashboardWorkspaceState {
  if (results.some((result) => result.status === 'ready' && result.count > 0)) return 'returning';
  if (results.some((result) => result.status === 'unavailable')) return 'unavailable';
  return results.length === DASHBOARD_REQUIRED_COLLECTION_IDS.length ? 'first_use' : 'loading';
}

function needsAttention(lifecycle: AnalystReviewLifecycle): boolean {
  return !['expected', 'suppressed', 'resolved'].includes(lifecycle.state);
}

function safeTime(value: string | null): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function buildDashboardAttentionSummary(input: Readonly<{
  reviewItems: readonly AnalystReviewInboxItem[];
  cases: readonly CaseRecord[];
  watchlistCount: number;
  now?: string;
}>): DashboardAttentionSummary {
  const now = typeof input.now === 'string' && Number.isFinite(Date.parse(input.now))
    ? new Date(input.now).toISOString()
    : new Date(0).toISOString();
  const bySubject = new Map<string, DashboardAttentionItem>();
  for (const item of input.reviewItems) {
    if (!needsAttention(item.lifecycle)) continue;
    bySubject.set(item.subjectKey, {
      subjectKey: item.subjectKey,
      title: item.title,
      detail: item.detail,
      href: item.href,
      lifecycle: item.lifecycle,
      dueAt: item.dueAt,
      source: item.source,
    });
  }
  const all = [...bySubject.values()].sort((left, right) => (
    safeTime(left.dueAt) - safeTime(right.dueAt)
    || left.title.localeCompare(right.title, 'en')
    || left.subjectKey.localeCompare(right.subjectKey, 'en')
  ));
  const nowMs = Date.parse(now);
  return {
    items: all.slice(0, 20),
    attentionNeeded: all.length,
    overdue: all.filter((item) => item.dueAt !== null && Date.parse(item.dueAt) <= nowMs).length,
    changedSinceReview: all.filter((item) => item.lifecycle.invalidated || item.lifecycle.recurred).length,
    expired: all.filter((item) => item.lifecycle.expired).length,
    dueFollowUps: all.filter((item) => item.lifecycle.reviewDue || (item.dueAt !== null && Date.parse(item.dueAt) <= nowMs)).length,
    openCases: input.cases.filter((record) => record.status !== 'resolved').length,
    watchlists: Math.max(0, Math.trunc(input.watchlistCount)),
    truncated: all.length > 20,
  };
}
