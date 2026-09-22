import { runBrowserWorkerOperation } from './browser-worker-operation.ts';
import { CONTEXT_REVIEW_SCHEMA, CONTEXT_REVIEW_VERSION, MAX_CONTEXT_RECORDS, type ContextReview } from '../../../packages/contracts/context-review.mts';
import type { connectorConfigurationPresentation } from '../../../packages/investigation/connector-provenance-review.mts';

export type ConnectorReviewRequest = Readonly<{ current: string; previous: string; reviewedAt: string }>;
export function runConnectorProvenanceWorker(request: ConnectorReviewRequest, signal: AbortSignal): Promise<ReturnType<typeof connectorConfigurationPresentation>> {
  return runBrowserWorkerOperation(request, {
    signal,
    createWorker: () => new Worker(new URL('./workers/connector-provenance.worker.ts', import.meta.url), { type: 'module', name: 'connector-review' }),
    messages: { cancelled: 'Connector review cancelled. Nothing was saved.', unavailable: 'Local connector review is unavailable. Nothing was saved.',
      timeout: 'Connector review did not finish. Nothing was saved.', unreadable: 'Connector review returned unreadable data.', send: 'The configuration could not be sent for local review.' },
    readResponse(value) {
      const result = value as ReturnType<typeof connectorConfigurationPresentation> | null;
      const report: ContextReview | undefined = result?.report;
      if (report?.schema !== CONTEXT_REVIEW_SCHEMA || report.version !== CONTEXT_REVIEW_VERSION || report.kind !== 'connector'
        || !Array.isArray(report.observations) || report.observations.length > MAX_CONTEXT_RECORDS * 2
        || !Array.isArray(result?.connectors) || result.connectors.length > MAX_CONTEXT_RECORDS
        || result.connectors.some(row => !row || typeof row.name !== 'string' || !Array.isArray(row.declaredCapabilities))) throw new TypeError('Select bounded JSON with one servers or mcpServers section. Check conflicting or unsupported values; nothing was saved.');
      return result;
    },
  });
}
