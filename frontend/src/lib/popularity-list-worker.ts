import { MAX_POPULARITY_LIST_ENTRIES } from '../../../packages/analysis/popularity-list.mts';
import { runBrowserWorkerOperation } from './browser-worker-operation.ts';
import type { PopularityListRanks, PopularityListWorkerRequest, PopularityListWorkerResponse } from './popularity-list-worker-model.ts';

const count = (value: unknown, maximum: number) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;

export function runPopularityListWorker(request: PopularityListWorkerRequest, options: Readonly<{ signal?: AbortSignal; createWorker?: () => Worker }> = {}) {
  return runBrowserWorkerOperation<PopularityListWorkerRequest, PopularityListRanks>(request, {
    ...options,
    createWorker: options.createWorker ?? (() => new Worker(new URL('./workers/popularity-list.worker.ts', import.meta.url), { type: 'module', name: 'popularity-list' })),
    messages: {
      cancelled: 'Reading the popularity list was cancelled.',
      unavailable: 'The local popularity list worker is unavailable. Choose the file again to retry.',
      timeout: 'Reading the popularity list exceeded its time limit.',
      unreadable: 'The local worker returned unreadable popularity data.',
      send: 'The popularity list could not be sent for local reading.',
    },
    readResponse(value) {
      const reply = value as PopularityListWorkerResponse | null;
      if (reply?.kind === 'error') throw new Error(typeof reply.detail === 'string' ? reply.detail.slice(0, 300) : 'The popularity list could not be read.');
      const result = reply?.kind === 'rank' ? reply.result : null;
      const requested = new Set(request.domains);
      // Only ranks for the candidates that were sent are accepted.
      if (!result || !count(result.entries, MAX_POPULARITY_LIST_ENTRIES) || !count(result.rejectedLines, Number.MAX_SAFE_INTEGER)
        || typeof result.truncated !== 'boolean' || !Array.isArray(result.ranks) || result.ranks.length > requested.size
        || result.ranks.some((item) => !Array.isArray(item) || item.length !== 2 || !requested.has(item[0])
          || !Number.isSafeInteger(item[1]) || item[1] < 1)) {
        throw new Error('The local worker returned an unexpected popularity result.');
      }
      return Object.freeze({ entries: result.entries, rejectedLines: result.rejectedLines, truncated: result.truncated,
        ranks: Object.freeze(result.ranks.map(([domain, rank]) => Object.freeze([domain, rank] as const))) });
    },
  });
}
