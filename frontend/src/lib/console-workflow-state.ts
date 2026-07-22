import type { BulkSortDirection, BulkSortKey } from './analysis/bulk-sort.js';
import type { LookupHttpResponse } from './analysis/lookup-response.js';

export type LookupMode = 'fast' | 'deep';

export type LookupWorkflowState = {
  query: string;
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
  completed: number;
  total: number;
  results: Result[];
  filter: 'all' | 'available' | 'registered' | 'high_risk' | 'trusted' | 'errors';
  mutationFilter: string;
  signalFilters: string[];
  sortKey: BulkSortKey;
  sortDirection: BulkSortDirection;
  page: number;
  status: string;
  indicatorFormat: 'domains' | 'hosts' | 'dnsmasq' | 'rpz' | 'stix' | 'misp';
  watchlistName: string;
};

let lookupWorkflowState: LookupWorkflowState | null = null;
let bulkWorkflowState: BulkWorkflowState<unknown> | null = null;

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

export function clearConsoleWorkflowState(): void {
  lookupWorkflowState = null;
  bulkWorkflowState = null;
}
