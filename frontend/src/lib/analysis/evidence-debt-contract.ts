import { MAX_CASES, MAX_CASE_EVIDENCE_PINS } from '../../../../packages/contracts/case-portability.mts';
import { MAX_BULK_SESSIONS, MAX_BULK_SESSION_ROWS, MAX_BULK_SESSION_SOURCES } from '../../../../packages/contracts/workspace-portability.mts';

export const EVIDENCE_DEBT_VERSION = 1;
export const MAX_EVIDENCE_DEBT_BULK_ROWS = MAX_BULK_SESSIONS * MAX_BULK_SESSION_ROWS;
export const MAX_EVIDENCE_DEBT_CASE_PINS = MAX_CASES * MAX_CASE_EVIDENCE_PINS;
export const MAX_EVIDENCE_DEBT_ITEMS = MAX_EVIDENCE_DEBT_BULK_ROWS * MAX_BULK_SESSION_SOURCES + MAX_EVIDENCE_DEBT_CASE_PINS;
export const MAX_EVIDENCE_DEBT_MATRIX_ROWS = MAX_EVIDENCE_DEBT_ITEMS;

export const EVIDENCE_DEBT_STATES = [
  'conflicting',
  'rate_limited',
  'unavailable',
  'partial',
  'stale',
  'unsupported',
] as const;

export type EvidenceDebtState = typeof EVIDENCE_DEBT_STATES[number];
export type EvidenceDebtSourceState = 'loading' | 'ready' | 'unavailable';
export type EvidenceDebtOwner = 'bulk' | 'case';
export type EvidenceDebtPriority = 'high' | 'medium';
export type EvidenceDebtNextAction = 'retry' | 'deep_lookup' | 'case_review';

export type EvidenceDebtItem = Readonly<{
  id: string;
  owner: EvidenceDebtOwner;
  ownerId: string;
  ownerLabel: string;
  domain: string;
  sourceId: string;
  sourceLabel: string;
  states: readonly EvidenceDebtState[];
  primaryState: EvidenceDebtState;
  priority: EvidenceDebtPriority;
  observedAt: string | null;
  detail: string;
  limitations: readonly string[];
  reviewHref: string;
  nextAction: EvidenceDebtNextAction;
  nextHref: string;
  expectedEffect: string;
  disclosure: string;
}>;

export type EvidenceDebtMatrixRow = Readonly<{
  id: string;
  owner: EvidenceDebtOwner;
  sourceId: string;
  sourceLabel: string;
  counts: Readonly<Record<EvidenceDebtState, number>>;
  total: number;
}>;

export type EvidenceDebtReview = Readonly<{
  version: typeof EVIDENCE_DEBT_VERSION;
  items: readonly EvidenceDebtItem[];
  matrix: readonly EvidenceDebtMatrixRow[];
  counts: Readonly<Record<EvidenceDebtState | 'all', number>>;
  sourceStates: Readonly<{ bulk: EvidenceDebtSourceState; cases: EvidenceDebtSourceState }>;
  evaluatedAt: string | null;
  countsComplete: boolean;
  truncated: boolean;
  omissions: Readonly<{
    items: number;
    matrixRows: number;
    bulkRows: number;
    casePins: number;
    olderBulkObservations: number;
    bulkSessions: number;
    cases: number;
    bulkSources: number;
  }>;
  retention: Readonly<{
    bulkRowsWithoutCoverage: number;
    casesWithoutPins: number;
    explicitlySkipped: number;
    explicitlyNotFound: number;
    resolvedCasesExcluded: number;
    reviewedCasePinsExcluded: number;
  }>;
  limitations: readonly string[];
}>;
