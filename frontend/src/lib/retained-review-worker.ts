import { runBrowserWorkerOperation } from './browser-worker-operation.ts';
import type { RetainedReviewInputs, RetainedReviewKind, RetainedReviewRequest, RetainedReviewResponse, RetainedReviewResults } from './retained-review-worker-model.ts';

export function runRetainedReviewWorker<Kind extends RetainedReviewKind>(
  kind: Kind,
  input: RetainedReviewInputs[Kind],
  evaluatedAt: string,
  options: Readonly<{ signal?: AbortSignal; createWorker?: () => Worker }> = {},
): Promise<RetainedReviewResults[Kind]> {
  return runBrowserWorkerOperation({ kind, input, evaluatedAt } as RetainedReviewRequest, {
    ...options,
    createWorker: options.createWorker ?? (() => new Worker(new URL('./workers/retained-review.worker.ts', import.meta.url), { type: 'module', name: 'retained-evidence-review' })),
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
