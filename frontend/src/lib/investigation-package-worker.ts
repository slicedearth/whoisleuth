import { runBrowserWorkerOperation } from './browser-worker-operation.ts';
import type { InvestigationPackageInputs, InvestigationPackageKind, InvestigationPackageRequest, InvestigationPackageResponse, InvestigationPackageResults } from './investigation-package-worker-model.ts';

export function runInvestigationPackageWorker<Kind extends InvestigationPackageKind>(
  kind: Kind, input: InvestigationPackageInputs[Kind],
  options: Readonly<{ signal?: AbortSignal; createWorker?: () => Worker }> = {},
): Promise<InvestigationPackageResults[Kind]> {
  return runBrowserWorkerOperation({ kind, input } as InvestigationPackageRequest, {
    ...options,
    createWorker: options.createWorker ?? (() => new Worker(new URL('./workers/investigation-package.worker.ts', import.meta.url), { type: 'module', name: 'evidence-package' })),
    messages: {
      cancelled: 'Evidence package processing was cancelled.',
      unavailable: 'The evidence package worker is unavailable. No saved records were changed.',
      timeout: 'Evidence package processing did not finish. No saved records were changed.',
      unreadable: 'Evidence package processing returned unreadable data.',
      send: 'The selected files could not be sent for local processing.',
    },
    readResponse(value) {
      const reply = value as InvestigationPackageResponse | null;
      if (reply?.kind === 'error') throw new Error(reply.detail);
      if (reply?.kind !== kind || !reply.result?.manifest || !Array.isArray(reply.result.manifest.artifacts)
        || (reply.kind === 'inspect' ? !(reply.result.contents instanceof Map) : !(reply.result.file instanceof Blob))) throw new Error('Evidence package processing returned an unexpected result.');
      return reply.result as InvestigationPackageResults[Kind];
    },
  });
}
