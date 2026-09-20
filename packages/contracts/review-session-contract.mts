import type { AnalystReviewAge, AnalystReviewDisposition, AnalystReviewEvidenceFamily, AnalystReviewKind, AnalystReviewLifecycleState, AnalystReviewNextAction, AnalystReviewPriority, AnalystReviewQueue } from './analyst-review-state-contract.mts';

export const REVIEW_SESSION_SCHEMA = 'whoisleuth.review-session';
export const REVIEW_SESSION_VERSION = 1;
// One admitted queue of bounded rationale forms, plus its filters and selection.
export const MAX_REVIEW_SESSION_BYTES = 4 * 1024 * 1024;

export type ReviewFormDraft = Readonly<{
  id: string; subjectKey: string; materialFingerprint: string;
  disposition: AnalystReviewDisposition | ''; rationale: string; expiresAt: string; reviewDueAt: string;
  uncertain: boolean;
}>;

export type ReviewSessionFilters = Readonly<{
  queue: AnalystReviewQueue; attentionOnly: boolean; focusedCaseId: string;
  kind: AnalystReviewKind | ''; source: string; age: AnalystReviewAge | ''; caseQuery: string;
  priority: AnalystReviewPriority | ''; nextAction: AnalystReviewNextAction | '';
  evidenceFamily: AnalystReviewEvidenceFamily | ''; lifecycle: AnalystReviewLifecycleState | '';
}>;
export type ReviewSessionPosition = Readonly<{
  filters: ReviewSessionFilters;
  selected: Readonly<{ id: string; subjectKey: string; materialFingerprint: string; caseId: string | null }> | null;
  drafts: readonly ReviewFormDraft[];
}>;
export type ReviewSessionRecord = ReviewSessionPosition & Readonly<{
  id: 'inbox'; revision: string; updatedAt: string;
}>;
export type ReviewSessionStore = Readonly<{
  schema: typeof REVIEW_SESSION_SCHEMA; version: typeof REVIEW_SESSION_VERSION;
  records: readonly ReviewSessionRecord[];
}>;
