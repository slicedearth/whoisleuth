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

export type LookupMode = 'fast' | 'deep';

export type LookupWorkflowState = {
  query: string;
  completedTarget: string;
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
