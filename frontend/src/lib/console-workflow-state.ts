import type { BulkPacing } from './analysis/bulk-pacing.ts';
import type { BulkReviewPresetView } from '../../../packages/workspace/bulk-review-model.mts';
import type { LookupHttpResponse } from './analysis/lookup-response.ts';
import type { LookupRequestDraft } from './analysis/lookup-presentation.ts';
import type { BulkProfileContextProvenance } from './analysis/bulk-session-model.ts';
import { normalizeOpaqueReferenceId } from '../../../packages/cases/opaque-reference-id.mts';
import { consoleNavigation, referenceNavigation, publicReferenceSectionNavigation, protectedReturnTarget, type NavigationItem } from './workspaces.ts';
import { currentBrowserWorkspaceId } from './browser-workspace-context.ts';
import { CASE_WORKSPACE_SECTIONS, type CaseWorkspaceSection } from './analysis/case-response-stage.ts';

export type LookupMode = 'fast' | 'deep';

export type LookupWorkflowState = LookupRequestDraft & {
  completedTarget: string;
  /** Exact Incident URL retained only in this in-memory navigation state. */
  completedIncidentUrl?: string;
  /** Optional only for compatibility with workflow state created before exact completed depth was retained. */
  completedLookupDepth?: LookupMode | null;
  error: string;
  result: LookupHttpResponse | null;
};

export type BulkWorkflowState<Result> = {
  guideContext: string;
  input: string;
  mode: LookupMode;
  /** Exact admitted result input; absent historical transient state is not inferred from the editable queue. */
  resultInput?: Readonly<{ mode: LookupMode; domains: readonly string[] }> | null;
  pacing?: BulkPacing;
  completed: number;
  total: number;
  results: Result[];
  /** Missing only for transient workflow state created before Bulk session schema v4. */
  profileContext?: BulkProfileContextProvenance;
  view: BulkReviewPresetView;
  page: number;
  status: string;
  /** Transient scan state is independent of its display wording. */
  cancelled?: boolean;
  indicatorFormat: 'domains' | 'hosts' | 'dnsmasq' | 'rpz' | 'stix' | 'misp';
  indicatorWildcards: boolean;
  watchlistName: string;
};

let lookupWorkflowState: LookupWorkflowState | null = null;
let bulkWorkflowState: BulkWorkflowState<unknown> | null = null;
let selectedCaseId: string | null = null;
type CaseNavigationContext = Readonly<{
  caseId: string;
  href: string;
  label: string;
  message: string;
}>;
let caseNavigationContext: CaseNavigationContext | null = null;
const caseSelectionListeners = new Set<(id: string | null) => void>();

export type PinnedCaseCheckpoint = Readonly<{ caseId: string; snapshotId: string }>;
export type VisitedConsoleCase = Readonly<{ caseId: string; section: CaseWorkspaceSection }>;
export type ConsoleFavourite = Readonly<{ kind: 'case'; caseId: string; section: CaseWorkspaceSection } | { kind: 'destination'; href: string }>;
export const MAX_CONSOLE_FAVOURITES = 8;
export function consoleFavouriteDestinations(): readonly NavigationItem[] {
  return [...new Map([...consoleNavigation, ...referenceNavigation, ...publicReferenceSectionNavigation].map(item => [item.href, item])).values()];
}
export type ConsoleReferenceView = Readonly<{
  workspaceId: string | null;
  revision: number;
  checkpoints: readonly PinnedCaseCheckpoint[];
  visits: readonly VisitedConsoleCase[];
  favourites: readonly ConsoleFavourite[];
}>;
let referenceView: ConsoleReferenceView = Object.freeze({ workspaceId: null, revision: 0, checkpoints: Object.freeze([]), visits: Object.freeze([]), favourites: Object.freeze([]) });
const referenceListeners = new Set<() => void>();
function publishReferenceView(checkpoints = referenceView.checkpoints, visits = referenceView.visits, workspaceId = referenceView.workspaceId, favourites = referenceView.favourites) {
  referenceView = Object.freeze({ workspaceId, revision: referenceView.revision + 1, checkpoints, visits, favourites });
  for (const listener of [...referenceListeners]) {
    try { void Promise.resolve(listener()).catch(() => {}); } catch { /* View observers cannot change reference ownership. */ }
  }
}
export function clearConsoleReferenceView(): void {
  if (referenceView.workspaceId !== null || referenceView.checkpoints.length || referenceView.visits.length || referenceView.favourites.length)
    publishReferenceView(Object.freeze([]), Object.freeze([]), null, Object.freeze([]));
}
function referenceWorkspace(): boolean {
  if (!inBrowser()) return false;
  let id: string;
  try { id = currentBrowserWorkspaceId(); }
  catch { clearConsoleReferenceView(); return false; }
  if (referenceView.workspaceId !== null && referenceView.workspaceId !== id) clearConsoleReferenceView();
  if (referenceView.workspaceId === null) referenceView = Object.freeze({ ...referenceView, workspaceId: id });
  return true;
}
export function readConsoleReferenceView(): ConsoleReferenceView {
  return referenceWorkspace() ? referenceView : Object.freeze({ workspaceId: null, revision: 0, checkpoints: Object.freeze([]), visits: Object.freeze([]), favourites: Object.freeze([]) });
}
export function subscribeConsoleReferenceView(listener: () => void): () => void {
  if (!inBrowser()) return () => {};
  referenceListeners.add(listener);
  return () => { referenceListeners.delete(listener); };
}
function checkedCheckpoint(value: PinnedCaseCheckpoint): PinnedCaseCheckpoint {
  if (!value || typeof value.caseId !== 'string' || typeof value.snapshotId !== 'string'
    || normalizeOpaqueReferenceId(value.caseId) !== value.caseId || normalizeOpaqueReferenceId(value.snapshotId) !== value.snapshotId)
    throw new RangeError('An exact Case and checkpoint reference is required.');
  return Object.freeze({ caseId: value.caseId, snapshotId: value.snapshotId });
}
export function pinConsoleCaseCheckpoint(value: PinnedCaseCheckpoint): 'added' | 'already-pinned' | 'full' | 'unavailable' {
  if (!referenceWorkspace()) return 'unavailable';
  const checked = checkedCheckpoint(value);
  if (referenceView.checkpoints.some(item => item.caseId === checked.caseId && item.snapshotId === checked.snapshotId)) return 'already-pinned';
  if (referenceView.checkpoints.length >= 4) return 'full';
  publishReferenceView(Object.freeze([...referenceView.checkpoints, checked]));
  return 'added';
}
export function removeConsoleCaseCheckpoint(value: PinnedCaseCheckpoint): void {
  if (!referenceWorkspace()) return;
  const checked = checkedCheckpoint(value);
  const remaining = referenceView.checkpoints.filter(item => item.caseId !== checked.caseId || item.snapshotId !== checked.snapshotId);
  if (remaining.length !== referenceView.checkpoints.length) publishReferenceView(Object.freeze(remaining));
}
export function clearConsoleCaseCheckpoints(): void {
  if (referenceWorkspace() && referenceView.checkpoints.length) publishReferenceView(Object.freeze([]));
}
function checkedFavourite(value: ConsoleFavourite): ConsoleFavourite {
  if (value?.kind === 'case' && typeof value.caseId === 'string' && normalizeOpaqueReferenceId(value.caseId) === value.caseId && CASE_WORKSPACE_SECTIONS.some(item => item.id === value.section))
    return Object.freeze({ kind: 'case', caseId: value.caseId, section: value.section });
  if (value?.kind === 'destination' && consoleFavouriteDestinations().some(item => item.href === value.href))
    return Object.freeze({ kind: 'destination', href: value.href });
  throw new RangeError('Choose an exact Case section or an existing navigation destination.');
}
export function consoleFavouriteKey(value: ConsoleFavourite): string {
  return value.kind === 'case' ? JSON.stringify([value.kind, value.caseId, value.section]) : JSON.stringify([value.kind, value.href]);
}
export function addConsoleFavourite(value: ConsoleFavourite): 'added' | 'already-added' | 'full' | 'unavailable' {
  if (!referenceWorkspace()) return 'unavailable';
  const checked = checkedFavourite(value), key = consoleFavouriteKey(checked);
  if (referenceView.favourites.some(item => consoleFavouriteKey(item) === key)) return 'already-added';
  if (referenceView.favourites.length >= MAX_CONSOLE_FAVOURITES) return 'full';
  publishReferenceView(undefined, undefined, undefined, Object.freeze([...referenceView.favourites, checked]));
  return 'added';
}
export function removeConsoleFavourite(value: ConsoleFavourite): void {
  if (!referenceWorkspace()) return;
  const key = consoleFavouriteKey(checkedFavourite(value));
  const remaining = referenceView.favourites.filter(item => consoleFavouriteKey(item) !== key);
  if (remaining.length !== referenceView.favourites.length) publishReferenceView(undefined, undefined, undefined, Object.freeze(remaining));
}
export function clearConsoleFavourites(): void {
  if (referenceWorkspace() && referenceView.favourites.length) publishReferenceView(undefined, undefined, undefined, Object.freeze([]));
}
/** Successfully resolved navigation only; this never creates an evidence relationship. */
export function recordVisitedConsoleCase(caseId: string, section: CaseWorkspaceSection): void {
  if (!referenceWorkspace()) return;
  if (normalizeOpaqueReferenceId(caseId) !== caseId || !CASE_WORKSPACE_SECTIONS.some(item => item.id === section))
    throw new RangeError('A retained Case and supported section are required.');
  const latest = referenceView.visits.at(-1);
  if (latest?.caseId === caseId && latest.section === section) return;
  const visited = Object.freeze({ caseId, section });
  publishReferenceView(referenceView.checkpoints, Object.freeze([
    ...(latest?.caseId === caseId ? referenceView.visits.slice(0, -1) : referenceView.visits).slice(-7), visited,
  ]));
}

function inBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function readLookupWorkflowState(): LookupWorkflowState | null {
  return inBrowser() ? lookupWorkflowState : null;
}

export function writeLookupWorkflowState(state: LookupWorkflowState): void {
  if (inBrowser()) lookupWorkflowState = state;
}

export function readBulkWorkflowState<Result>(): BulkWorkflowState<Result> | null {
  return inBrowser() ? (bulkWorkflowState as BulkWorkflowState<Result> | null) : null;
}

export function writeBulkWorkflowState<Result>(state: BulkWorkflowState<Result>): void {
  if (inBrowser()) bulkWorkflowState = state as BulkWorkflowState<unknown>;
}

export function readSelectedConsoleCase(): string | null {
  return inBrowser() ? selectedCaseId : null;
}

export function setCaseNavigationContext(
  caseId: string,
  href: string,
  label: string,
  message = '',
): void {
  if (!inBrowser()) return;
  if (
    normalizeOpaqueReferenceId(caseId) !== caseId ||
    label.length > 80 ||
    message.length > 2_000
  ) {
    throw new RangeError('The Case navigation context is invalid.');
  }
  caseNavigationContext = Object.freeze({
    caseId,
    href: protectedReturnTarget(href, 'https://console.invalid'),
    label,
    message,
  });
}

export function readCaseNavigationContext(caseId: string | null): CaseNavigationContext | null {
  return inBrowser() && caseNavigationContext?.caseId === caseId ? caseNavigationContext : null;
}

export function selectConsoleCase(id: string | null): void {
  if (!inBrowser()) return;
  if (id !== null && normalizeOpaqueReferenceId(id) !== id) {
    throw new RangeError('The selected Case identifier is invalid.');
  }
  if (caseNavigationContext?.caseId !== id) caseNavigationContext = null;
  if (selectedCaseId === id) return;
  selectedCaseId = id;
  for (const listener of [...caseSelectionListeners]) {
    try {
      void Promise.resolve(listener(id)).catch(() => {});
    } catch {
      /* A view observer cannot change the selection. */
    }
  }
}

export function subscribeSelectedConsoleCase(listener: (id: string | null) => void): () => void {
  listener(readSelectedConsoleCase());
  if (!inBrowser()) return () => {};
  caseSelectionListeners.add(listener);
  return () => {
    caseSelectionListeners.delete(listener);
  };
}

export function clearConsoleWorkflowState(): void {
  lookupWorkflowState = null;
  bulkWorkflowState = null;
  selectedCaseId = null;
  caseNavigationContext = null;
  clearConsoleReferenceView();
  for (const listener of [...caseSelectionListeners]) {
    try {
      void Promise.resolve(listener(null)).catch(() => {});
    } catch {
      /* Clearing private state does not depend on a view. */
    }
  }
}
