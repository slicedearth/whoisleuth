export const EVIDENCE_DEBT_VERSION = 1;
export const MAX_EVIDENCE_DEBT_ITEMS = 500;
export const MAX_EVIDENCE_DEBT_MATRIX_ROWS = 64;
export const MAX_EVIDENCE_DEBT_BULK_ROWS = 2_000;
export const MAX_EVIDENCE_DEBT_CASE_PINS = 2_000;

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
  observedAt: string;
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
  countsComplete: boolean;
  truncated: boolean;
  omissions: Readonly<{
    items: number;
    matrixRows: number;
    bulkRows: number;
    casePins: number;
    olderBulkObservations: number;
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
