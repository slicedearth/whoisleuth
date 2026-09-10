import type { InvestigationProjectionInput, InvestigationStoreName } from './analysis/investigation-projection.ts';
import type { InvestigationSearchResponse } from './analysis/investigation-search.ts';
import type { InvestigationContextPreview } from './analysis/investigation-context-preview.ts';
import type { InvestigationSearchSummary, SearchWorkerOperation, SearchWorkerRequest, SearchWorkerResponse } from './investigation-search-worker-model.ts';

export type InvestigationSearchSession = Readonly<{
  summary: InvestigationSearchSummary;
  search: (query: string, options?: Readonly<{ page?: number; pageSize?: number }>) => Promise<InvestigationSearchResponse>;
  preview: (query: string, page?: number) => Promise<InvestigationContextPreview>;
  dispose: () => void;
}>;
type Pending = {
  request: SearchWorkerRequest;
  resolve: (reply: SearchWorkerResponse) => void;
  reject: (error: Error) => void;
};

/** One active query and one replaceable queued query bound work during typing. */
export async function createInvestigationSearchSession(
  collections: InvestigationProjectionInput,
  unavailableStores: readonly InvestigationStoreName[],
  options: Readonly<{ signal?: AbortSignal; createWorker?: () => Worker }> = {},
): Promise<InvestigationSearchSession> {
  if (options.signal?.aborted) throw new DOMException('Saved-work search was cancelled.', 'AbortError');
  const worker = options.createWorker ? options.createWorker()
    : new Worker(new URL('./workers/investigation-search.worker.ts', import.meta.url), { type: 'module', name: 'saved-work-search' });
  let sequence = 0;
  let active: Pending | null = null;
  let queued: Pending | null = null;
  let closed = false;
  let closeReason: Error = new DOMException('Saved-work search was cancelled.', 'AbortError');
  let timer: ReturnType<typeof setTimeout> | undefined;

  function close(error: Error) {
    if (closed) return;
    closed = true;
    closeReason = error;
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    active?.reject(error);
    queued?.reject(error);
    active = null;
    queued = null;
  }
  function abort() { close(new DOMException('Saved-work search was cancelled.', 'AbortError')); }
  function start(pending: Pending) {
    active = pending;
    timer = setTimeout(() => close(new Error('Saved-work search did not respond. Reload the page to retry.')), 60_000);
    try { worker.postMessage(pending.request); }
    catch { close(new Error('Saved-work search could not receive the retained data. No saved records were changed.')); }
  }
  function request(operation: SearchWorkerOperation): Promise<SearchWorkerResponse> {
    if (closed) return Promise.reject(closeReason);
    return new Promise((resolve, reject) => {
      const pending: Pending = { request: { ...operation, id: ++sequence }, resolve, reject };
      if (!active) start(pending);
      else {
        queued?.reject(new DOMException('A newer saved-work query replaced this query.', 'AbortError'));
        queued = pending;
      }
    });
  }
  worker.onmessage = (event: MessageEvent<SearchWorkerResponse>) => {
    if (closed || !active || event.data?.id !== active.request.id) return;
    const completed = active;
    clearTimeout(timer);
    active = null;
    const reply = event.data;
    if (reply.kind === 'error') completed.reject(new Error(reply.detail));
    else if (reply.kind !== completed.request.kind) completed.reject(new Error('Saved-work search returned an unexpected operation.'));
    else completed.resolve(reply);
    const next = queued;
    queued = null;
    if (next) start(next);
  };
  worker.onerror = (event) => {
    event.preventDefault();
    close(new Error('The saved-work search worker is unavailable. Reload the page to retry.'));
  };
  worker.onmessageerror = () => close(new Error('Saved-work search returned unreadable data.'));
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  try {
    const initial = await request({ kind: 'build', collections, unavailableStores });
    if (initial.kind !== 'build') throw new Error('Saved-work search could not be prepared.');
    return Object.freeze({
      summary: initial.summary,
      async search(query: string, parameters: Readonly<{ page?: number; pageSize?: number }> = {}) {
        const reply = await request({ kind: 'search', query, ...parameters });
        if (reply.kind !== 'search') throw new Error('Saved-work search could not return results.');
        return reply.result;
      },
      async preview(query: string, page?: number) {
        const reply = await request({ kind: 'preview', query, ...(page === undefined ? {} : { page }) });
        if (reply.kind !== 'preview') throw new Error('Saved context could not return results.');
        return reply.result;
      },
      dispose: abort,
    });
  } catch (error) {
    close(error instanceof Error ? error : new Error('Saved-work search could not be prepared.'));
    throw error;
  }
}
