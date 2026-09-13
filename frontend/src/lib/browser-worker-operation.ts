export const BROWSER_WORKER_OPERATION_TIMEOUT_MS = 60_000;

/** One local operation with shared cancellation, deadline and teardown. */
export function runBrowserWorkerOperation<Request, Result>(request: Request, options: Readonly<{
  createWorker: () => Worker;
  readResponse: (value: unknown) => Result;
  signal?: AbortSignal;
  transfer?: readonly Transferable[];
  messages: Readonly<{
    cancelled: string;
    unavailable: string;
    timeout: string;
    unreadable: string;
    send: string;
  }>;
}>): Promise<Result> {
  const { messages } = options;
  if (options.signal?.aborted) return Promise.reject(new DOMException(messages.cancelled, 'AbortError'));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = options.createWorker(); }
    catch { reject(new Error(messages.unavailable)); return; }
    let settled = false;
    const timer = setTimeout(() => fail(new Error(messages.timeout)), BROWSER_WORKER_OPERATION_TIMEOUT_MS);
    function cleanup() {
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
    function fail(error: unknown) { if (!settled) { cleanup(); reject(error); } }
    function abort() { fail(new DOMException(messages.cancelled, 'AbortError')); }
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (settled) return;
      try { const result = options.readResponse(event.data); cleanup(); resolve(result); }
      catch (error) { fail(error instanceof Error ? error : new Error(messages.unreadable)); }
    };
    worker.onerror = (event) => { event.preventDefault(); fail(new Error(messages.unavailable)); };
    worker.onmessageerror = () => fail(new Error(messages.unreadable));
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) { abort(); return; }
    try { if (options.transfer) worker.postMessage(request, [...options.transfer]); else worker.postMessage(request); }
    catch { fail(new Error(messages.send)); }
  });
}
