import { runBrowserWorkerOperation } from './browser-worker-operation.ts';
import { CONTEXT_REVIEW_SCHEMA, CONTEXT_REVIEW_VERSION, MAX_CONTEXT_RECORDS, type ContextReview } from '../../../packages/contracts/context-review.mts';

export type ConnectorReviewRequest = Readonly<{ current: string; previous: string; reviewedAt: string }>;
export function runConnectorProvenanceWorker(request: ConnectorReviewRequest, signal: AbortSignal): Promise<ContextReview> {
  return runBrowserWorkerOperation(request, {
    signal,
    createWorker: () => new Worker(new URL('./workers/connector-provenance.worker.ts', import.meta.url), { type: 'module', name: 'connector-review' }),
    messages: { cancelled: 'Connector review cancelled. Nothing was saved.', unavailable: 'Local connector review is unavailable. Nothing was saved.',
      timeout: 'Connector review did not finish. Nothing was saved.', unreadable: 'Connector review returned unreadable data.', send: 'The configuration could not be sent for local review.' },
    readResponse(value) {
      const report = value as ContextReview | null;
      if (report?.schema !== CONTEXT_REVIEW_SCHEMA || report.version !== CONTEXT_REVIEW_VERSION || report.kind !== 'connector'
        || !Array.isArray(report.observations) || report.observations.length > MAX_CONTEXT_RECORDS * 2) throw new TypeError('Select bounded JSON with one servers or mcpServers section. Check conflicting or unsupported values; nothing was saved.');
      return report;
    },
  });
}
