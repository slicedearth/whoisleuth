import { runBrowserWorkerOperation } from './browser-worker-operation.ts';
import type { RetainedReviewInputs, RetainedReviewKind, RetainedReviewRequest, RetainedReviewResponse, RetainedReviewResults } from './retained-review-worker-model.ts';
import type { SelectedProofRequest, SelectedProofResponse, SelectedProofResult } from './retained-review-worker-model.ts';
import { CT_INCLUSION_REVIEW_SCHEMA } from '../../../packages/contracts/ct-inclusion-proof.mts';
import { TIMESTAMP_TOKEN_REVIEW_SCHEMA } from '../../../packages/contracts/timestamp-token.mts';

const createWorker = () => new Worker(new URL('./workers/retained-review.worker.ts', import.meta.url), { type: 'module', name: 'retained-evidence-review' });

export function runSelectedProofWorker(request: SelectedProofRequest, signal?: AbortSignal): Promise<SelectedProofResult> {
  return runBrowserWorkerOperation(request, {
    createWorker, ...(signal ? { signal } : {}),
    messages: { cancelled: 'Proof review was cancelled.', unavailable: 'The local proof review worker is unavailable.', timeout: 'Proof review did not finish.', unreadable: 'Proof review returned unreadable data.', send: 'The selected proof files could not be sent for local review.' },
    readResponse(value) {
      const reply = value as SelectedProofResponse | null;
      if (reply?.kind === 'error') throw new Error(reply.detail);
      const expected = request.proofKind === 'ct' ? CT_INCLUSION_REVIEW_SCHEMA : TIMESTAMP_TOKEN_REVIEW_SCHEMA;
      if (reply?.kind !== 'proof' || reply.result.schema !== expected || !Array.isArray(reply.result.checks) || reply.result.networkRequestsMade !== false) throw new Error('Proof review returned an unexpected result.');
      return reply.result;
    },
  });
}

export function runRetainedReviewWorker<Kind extends RetainedReviewKind>(
  kind: Kind,
  input: RetainedReviewInputs[Kind],
  evaluatedAt: string,
  options: Readonly<{ signal?: AbortSignal; createWorker?: () => Worker }> = {},
): Promise<RetainedReviewResults[Kind]> {
  return runBrowserWorkerOperation({ kind, input, evaluatedAt } as RetainedReviewRequest, {
    ...options,
    createWorker: options.createWorker ?? createWorker,
    messages: {
      cancelled: 'Retained review was cancelled.',
      unavailable: 'The retained review worker is unavailable. Retry to prepare the saved evidence.',
      timeout: 'Retained review did not finish. Saved records were not changed.',
      unreadable: 'Retained review returned unreadable data. Saved records were not changed.',
      send: 'The retained evidence could not be sent for local processing. Saved records were not changed.',
    },
    readResponse(value) {
      const reply = value as RetainedReviewResponse | null;
      if (reply?.kind === 'error') throw new Error(reply.detail);
      if (reply?.kind !== kind || !reply.result || !Array.isArray(reply.result.items) || !reply.result.counts) throw new Error('Retained review returned an unexpected result.');
      return reply.result as RetainedReviewResults[Kind];
    },
  });
}
