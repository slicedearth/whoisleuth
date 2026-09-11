import type { BulkSortDirection, BulkSortKey } from './analysis/bulk-sort.ts';
import type { BulkPacing } from './analysis/bulk-pacing.ts';
import type {
  BulkAgeFilter,
  BulkGroupBy,
  BulkMailFilter,
  BulkSourceFilter,
} from './analysis/bulk-triage.ts';
import type { LookupHttpResponse } from './analysis/lookup-response.ts';
import type { BulkProfileContextProvenance } from './analysis/bulk-session-model.ts';
import { normalizeOpaqueReferenceId } from '../../../packages/cases/opaque-reference-id.mts';
import { protectedReturnTarget } from './workspaces.ts';

export type LookupMode = 'fast' | 'deep';

export type LookupWorkflowState = {
  query: string;
  completedTarget: string;
  /** Exact Incident URL retained only in this in-memory navigation state. */
  completedIncidentUrl?: string;
  /** Optional only for compatibility with workflow state created before exact completed depth was retained. */
  completedLookupDepth?: LookupMode | null;
  lookupMode: LookupMode;
  includeExternalIntelligence: boolean;
  includeMalwareHostIntelligence: boolean;
  includeMalwareIocIntelligence: boolean;
  includeSecurityTxt: boolean;
  error: string;
  result: LookupHttpResponse | null;
};

export type BulkWorkflowState<Result> = {
  guideContext: string;
  input: string;
  mode: LookupMode;
  pacing?: BulkPacing;
  completed: number;
  total: number;
  results: Result[];
  /** Missing only for transient workflow state created before Bulk session schema v4. */
  profileContext?: BulkProfileContextProvenance;
  filter: 'all' | 'available' | 'registered' | 'high_risk' | 'trusted' | 'profile_unevaluated' | 'errors';
  mutationFilter: string;
  signalFilters: string[];
  sourceFilter?: BulkSourceFilter;
  lifecycleFilter?: string;
  ageFilter?: BulkAgeFilter;
  mailFilter?: BulkMailFilter;
  registrarFilter?: string;
  caseDispositionFilter?: string;
  groupBy?: BulkGroupBy;
  sortKey: BulkSortKey;
  sortDirection: BulkSortDirection;
  page: number;
  status: string;
  indicatorFormat: 'domains' | 'hosts' | 'dnsmasq' | 'rpz' | 'stix' | 'misp';
  indicatorWildcards: boolean;
  watchlistName: string;
};

let lookupWorkflowState: LookupWorkflowState | null = null;
let bulkWorkflowState: BulkWorkflowState<unknown> | null = null;
let selectedCaseId: string | null = null;
type CaseNavigationContext = Readonly<{ caseId: string; href: string; label: string; message: string }>;
let caseNavigationContext: CaseNavigationContext | null = null;
const caseSelectionListeners = new Set<(id: string | null) => void>();

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
  return inBrowser() ? bulkWorkflowState as BulkWorkflowState<Result> | null : null;
}

export function writeBulkWorkflowState<Result>(state: BulkWorkflowState<Result>): void {
  if (inBrowser()) bulkWorkflowState = state as BulkWorkflowState<unknown>;
}

export function readSelectedConsoleCase(): string | null {
  return inBrowser() ? selectedCaseId : null;
}

export function setCaseNavigationContext(caseId: string, href: string, label: string, message = ''): void {
  if (!inBrowser()) return;
  if (normalizeOpaqueReferenceId(caseId) !== caseId || label.length > 80 || message.length > 2_000) {
    throw new RangeError('The Case navigation context is invalid.');
  }
  caseNavigationContext = Object.freeze({
    caseId, href: protectedReturnTarget(href, 'https://console.invalid'), label, message,
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
    try { void Promise.resolve(listener(id)).catch(() => {}); } catch { /* A view observer cannot change the selection. */ }
  }
}

export function subscribeSelectedConsoleCase(listener: (id: string | null) => void): () => void {
  listener(readSelectedConsoleCase());
  if (!inBrowser()) return () => {};
  caseSelectionListeners.add(listener);
  return () => { caseSelectionListeners.delete(listener); };
}

export function clearConsoleWorkflowState(): void {
  lookupWorkflowState = null;
  bulkWorkflowState = null;
  selectedCaseId = null;
  caseNavigationContext = null;
  for (const listener of [...caseSelectionListeners]) {
    try { void Promise.resolve(listener(null)).catch(() => {}); } catch { /* Clearing private state does not depend on a view. */ }
  }
}
