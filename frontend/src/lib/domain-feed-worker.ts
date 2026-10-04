import { normalizeDomainFeedReview, normalizeDomainFeedSelection } from '../../../packages/monitoring/domain-feed.mts';
import { runBrowserWorkerOperation } from './browser-worker-operation.ts';
import type { DomainFeedWorkerRequest, DomainFeedWorkerResponse } from './domain-feed-worker-model.ts';

export function runDomainFeedWorker(request: DomainFeedWorkerRequest, options: Readonly<{ signal?: AbortSignal; createWorker?: () => Worker }> = {}) {
  return runBrowserWorkerOperation(request, {
    ...options,
    timeoutMs: 600_000,
    createWorker: options.createWorker ?? (() => new Worker(new URL('./workers/domain-feed.worker.ts', import.meta.url), { type: 'module', name: 'domain-feed-review' })),
    messages: {
      cancelled: 'Feed review was cancelled. No candidates were retained.',
      unavailable: 'The local feed worker is unavailable. Choose the file again to retry.',
      timeout: 'Feed review exceeded its time limit. No candidates were retained.',
      unreadable: 'The local worker returned unreadable feed data.',
      send: 'The file could not be sent for local review.',
    },
    readResponse(value) {
      const reply = value as DomainFeedWorkerResponse | null;
      if (reply?.kind === 'error') throw new Error(typeof reply.detail === 'string' ? reply.detail.slice(0, 300) : 'Feed review failed.');
      const review = reply?.kind === 'scan' ? normalizeDomainFeedReview(reply.review) : null;
      if (!review || review.feedId !== request.feedId || review.importedAt !== request.importedAt || JSON.stringify(review.selection) !== JSON.stringify(normalizeDomainFeedSelection(request.selection))) throw new Error('The local worker returned an unexpected feed result.');
      return review;
    },
  });
}
