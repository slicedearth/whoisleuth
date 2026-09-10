import { buildEvidenceDebtReview, type EvidenceDebtReview } from './analysis/evidence-debt-review.ts';
import { buildRetainedEvidenceTimeline, type RetainedEvidenceTimeline } from './analysis/retained-evidence-timeline.ts';

export type RetainedReviewInputs = {
  debt: Parameters<typeof buildEvidenceDebtReview>[0];
  timeline: Omit<Parameters<typeof buildRetainedEvidenceTimeline>[0], 'now'>;
};
export type RetainedReviewResults = { debt: EvidenceDebtReview; timeline: RetainedEvidenceTimeline };
export type RetainedReviewKind = keyof RetainedReviewInputs;
export type RetainedReviewRequest = {
  [Kind in RetainedReviewKind]: { kind: Kind; input: RetainedReviewInputs[Kind]; evaluatedAt: string };
}[RetainedReviewKind];
export type RetainedReviewResponse = {
  [Kind in RetainedReviewKind]: { kind: Kind; result: RetainedReviewResults[Kind] };
}[RetainedReviewKind] | { kind: 'error'; detail: string };

export function runRetainedReviewOperation(request: RetainedReviewRequest): RetainedReviewResponse {
  try {
    if (!request?.input || typeof request.input !== 'object' || Array.isArray(request.input)) throw new TypeError('Invalid retained review input.');
    const evaluatedAt = typeof request.evaluatedAt === 'string' ? request.evaluatedAt : '';
    if (request.kind === 'debt') return { kind: 'debt', result: buildEvidenceDebtReview(request.input, evaluatedAt) };
    if (request.kind === 'timeline') return { kind: 'timeline', result: buildRetainedEvidenceTimeline({ ...request.input, now: evaluatedAt }) };
    throw new TypeError('Unsupported retained review.');
  } catch {
    return { kind: 'error', detail: 'Retained review could not be prepared. Saved records were not changed.' };
  }
}
