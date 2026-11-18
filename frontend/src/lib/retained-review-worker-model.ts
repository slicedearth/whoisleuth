import { buildEvidenceDebtReview, type EvidenceDebtReview } from './analysis/evidence-debt-review.ts';
import { buildRetainedEvidenceTimeline, type RetainedEvidenceTimeline } from './analysis/retained-evidence-timeline.ts';
import type { SelectedProofFiles, SelectedProofKind } from '../../../packages/evidence/selected-proof-input.mts';
import type { reviewCtInclusionProof } from '../../../packages/evidence/ct-inclusion-proof.mts';
import type { reviewTimestampToken } from '../../../packages/evidence/timestamp-token.mts';

export type SelectedProofRequest = { kind: 'proof'; proofKind: SelectedProofKind; files: SelectedProofFiles; fields: { policy?: string; nonce?: string }; evaluatedAt: string };
export type SelectedProofResult = Awaited<ReturnType<typeof reviewCtInclusionProof>> | Awaited<ReturnType<typeof reviewTimestampToken>>;
export type SelectedProofResponse = { kind: 'proof'; result: SelectedProofResult } | { kind: 'error'; detail: string };

export async function runSelectedProofOperation(request: SelectedProofRequest): Promise<SelectedProofResponse> {
  try {
    const { assembleSelectedProofInput } = await import('../../../packages/evidence/selected-proof-input.mts');
    const input = await assembleSelectedProofInput(request.proofKind, request.files, request.fields);
    const result = request.proofKind === 'ct'
      ? await (await import('../../../packages/evidence/ct-inclusion-proof.mts')).reviewCtInclusionProof(input, request.evaluatedAt)
      : await (await import('../../../packages/evidence/timestamp-token.mts')).reviewTimestampToken(input, request.evaluatedAt);
    return { kind: 'proof', result };
  } catch {
    return { kind: 'error', detail: 'The selected proof could not be reviewed. Check the file formats, required material and trust selections.' };
  }
}

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
