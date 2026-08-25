/**
 * Bounded analyst Review Item schema metadata and shared value types.
 *
 * Lifecycle behaviour is owned by packages/monitoring/analyst-review-state.mts.
 * This dependency-free contract module lets storage and lifecycle registries
 * depend only on declared shapes, versions, and limits.
 */

export const ANALYST_REVIEW_STATE_SCHEMA = 'whoisleuth.analyst-review-state';
export const ANALYST_REVIEW_STATE_SCHEMA_VERSION = 1;
export const ANALYST_REVIEW_STATE_SUPPORTED_VERSIONS = Object.freeze([ANALYST_REVIEW_STATE_SCHEMA_VERSION] as const);
/** Internal IndexedDB revision; it is deliberately independent of the public document version. */
export const ANALYST_REVIEW_STATE_BROWSER_STORAGE_REVISION = 2;
export const MAX_ANALYST_REVIEW_STATE_RECORDS = 500;
export const MAX_ANALYST_REVIEW_STATE_BYTES = 512 * 1024;
export const MAX_ANALYST_REVIEW_RATIONALE_LENGTH = 1_000;
export const MAX_ANALYST_REVIEW_ASSOCIATIONS = 20;
export const MAX_ANALYST_REVIEW_HISTORY = 8;
export const MAX_ANALYST_REVIEW_ITEMS = 500;
export const MAX_ANALYST_REVIEW_IDENTITY_BYTES = 1024 * 1024;

export const ANALYST_REVIEW_KINDS = Object.freeze([
  'case',
  'case_action',
  'observed_effect_review',
  'evidence_gap',
  'watchlist_change',
  'bulk_session',
  'comparison',
  'suppression',
  'change_window',
  'desired_posture',
  'certificate',
  'incomplete_packet',
  'detection_rule',
  'orphaned_state',
] as const);
export type AnalystReviewKind = typeof ANALYST_REVIEW_KINDS[number];

export const ANALYST_REVIEW_EVIDENCE_FAMILIES = Object.freeze([
  'case',
  'registration',
  'dns',
  'routing',
  'http',
  'certificate_transparency',
  'live_tls',
  'caa',
  'certificate_identity',
  'comparison',
  'desired_posture',
  'suppression',
  'change_window',
  'relationship',
  'bulk',
  'rule',
  'packet',
] as const);
export type AnalystReviewEvidenceFamily = typeof ANALYST_REVIEW_EVIDENCE_FAMILIES[number];

export const ANALYST_REVIEW_DISPOSITIONS = Object.freeze(['open', 'expected', 'suppressed', 'resolved'] as const);
export type AnalystReviewDisposition = typeof ANALYST_REVIEW_DISPOSITIONS[number];
export type AnalystReviewPriority = 'urgent' | 'high' | 'normal';
export type AnalystReviewCompleteness = 'complete' | 'partial' | 'inconclusive';
export type AnalystReviewAge = 'current' | 'aging' | 'stale';
export type AnalystReviewNextAction = 'review' | 'refresh' | 'follow_up' | 'resume';
export type AnalystReviewLifecycleState =
  | 'open'
  | 'expected'
  | 'suppressed'
  | 'resolved'
  | 'expired'
  | 'invalidated'
  | 'recurred'
  | 'orphaned';

export const ANALYST_REVIEW_DISPOSITION_OPTIONS = Object.freeze([
  { value: 'open', label: 'Open' },
  { value: 'expected', label: 'Expected' },
  { value: 'suppressed', label: 'Suppressed' },
  { value: 'resolved', label: 'Resolved' },
] as const);

export type AnalystReviewItem = Readonly<{
  id: string;
  kind: AnalystReviewKind;
  evidenceFamily: AnalystReviewEvidenceFamily;
  subjectKey: string;
  materialFingerprint: string;
  requiresExpiry: boolean;
  priority: AnalystReviewPriority;
  title: string;
  detail: string;
  source: string;
  sourceIds: readonly string[];
  caseDomain: string | null;
  observedAt: string;
  dueAt: string | null;
  age: AnalystReviewAge;
  completeness: AnalystReviewCompleteness;
  nextAction: AnalystReviewNextAction;
  rankingReason: string;
  href: string;
  retryHref: string | null;
  caseId: string | null;
  campaignIds: readonly string[];
  dismissalTarget: string | null;
}>;

export type AnalystReviewDecisionSnapshot = Readonly<{
  reviewedFingerprint: string;
  disposition: AnalystReviewDisposition;
  rationale: string;
  reviewedAt: string;
  reviewDueAt: string | null;
  expiresAt: string | null;
}>;

export type AnalystReviewStateRecord = AnalystReviewDecisionSnapshot & Readonly<{
  subjectKey: string;
  evidenceFamily: AnalystReviewEvidenceFamily;
  caseIds: readonly string[];
  campaignIds: readonly string[];
  history: readonly AnalystReviewDecisionSnapshot[];
  /** Known earlier snapshots omitted after the bounded history was filled. */
  historyOmitted: number;
}>;

export type AnalystReviewStateStore = Readonly<{
  schema: typeof ANALYST_REVIEW_STATE_SCHEMA;
  version: typeof ANALYST_REVIEW_STATE_SCHEMA_VERSION;
  records: readonly AnalystReviewStateRecord[];
}>;

export type AnalystReviewLifecycle = Readonly<{
  state: AnalystReviewLifecycleState;
  effectiveDisposition: AnalystReviewDisposition;
  decision: AnalystReviewStateRecord | null;
  reason: string;
  expired: boolean;
  invalidated: boolean;
  recurred: boolean;
  reviewDue: boolean;
}>;
