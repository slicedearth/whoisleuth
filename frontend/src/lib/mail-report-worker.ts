import type { MailReportWorkerRequest, MailReportWorkerResponse } from './mail-report-worker-model.ts';

/** One bounded operation; the worker owns no durable or cross-request state. */
export function runMailReportWorker(
  request: MailReportWorkerRequest,
  options: Readonly<{ signal?: AbortSignal; createWorker?: () => Worker }> = {},
): Promise<Exclude<MailReportWorkerResponse, { kind: 'error' }>> {
  if (options.signal?.aborted) return Promise.reject(new DOMException('Mail report review was cancelled.', 'AbortError'));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = options.createWorker ? options.createWorker()
        : new Worker(new URL('./workers/mail-report.worker.ts', import.meta.url), { type: 'module', name: 'mail-report-review' });
    } catch { reject(new Error('The mail report worker is unavailable. Choose the files again to retry.')); return; }
    let settled = false;
    const timer = setTimeout(() => fail(new Error('Mail report processing did not finish. No reports were added.')), 60_000);
    function cleanup() {
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      worker.terminate();
    }
    function fail(error: Error) { if (!settled) { cleanup(); reject(error); } }
    function abort() { fail(new DOMException('Mail report review was cancelled.', 'AbortError')); }
    worker.onmessage = (event: MessageEvent<MailReportWorkerResponse>) => {
      if (settled) return;
      const reply = event.data;
      if (reply?.kind === 'error') { fail(new Error(reply.detail)); return; }
      if (reply?.kind !== request.kind) { fail(new Error('The mail report worker returned an unexpected result.')); return; }
      cleanup(); resolve(reply);
    };
    worker.onerror = (event) => { event.preventDefault(); fail(new Error('The mail report worker is unavailable. Choose the files again to retry.')); };
    worker.onmessageerror = () => fail(new Error('The mail report worker returned unreadable data. No reports were added.'));
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) { abort(); return; }
    try { worker.postMessage(request); }
    catch { fail(new Error('The mail reports could not be sent for local processing. No reports were added.')); }
  });
}
