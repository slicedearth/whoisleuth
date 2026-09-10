import type { MailReportWorkerRequest, MailReportWorkerResponse } from './mail-report-worker-model.ts';
import { runBrowserWorkerOperation } from './browser-worker-operation.ts';

/** One bounded operation; the worker owns no durable or cross-request state. */
export function runMailReportWorker(
  request: MailReportWorkerRequest,
  options: Readonly<{ signal?: AbortSignal; createWorker?: () => Worker }> = {},
): Promise<Exclude<MailReportWorkerResponse, { kind: 'error' }>> {
  return runBrowserWorkerOperation(request, {
    ...options,
    createWorker: options.createWorker ?? (() => new Worker(new URL('./workers/mail-report.worker.ts', import.meta.url), { type: 'module', name: 'mail-report-review' })),
    messages: {
      cancelled: 'Mail report review was cancelled.',
      unavailable: 'The mail report worker is unavailable. Choose the files again to retry.',
      timeout: 'Mail report processing did not finish. No reports were added.',
      unreadable: 'The mail report worker returned unreadable data. No reports were added.',
      send: 'The mail reports could not be sent for local processing. No reports were added.',
    },
    readResponse(value) {
      const reply = value as MailReportWorkerResponse | null;
      if (reply?.kind === 'error') throw new Error(reply.detail);
      if (reply?.kind !== request.kind) throw new Error('The mail report worker returned an unexpected result.');
      return reply;
    },
  });
}
