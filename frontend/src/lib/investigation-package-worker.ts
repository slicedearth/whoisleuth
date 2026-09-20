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
      if (reply?.kind !== kind) throw new Error('Evidence package processing returned an unexpected result.');
      if (reply.kind === 'imageCompare') {
        if (reply.result?.method !== 'rgba-white-pixel-grid-v1' || !Array.isArray(reply.result.tiles) || reply.result.tiles.length > 1024) throw new Error('Image comparison returned an unexpected result.');
      } else if (reply.kind === 'capture') {
        if (!reply.result?.document || !Array.isArray(reply.result.captures) || !Array.isArray(reply.result.artifacts) || !Array.isArray(reply.result.matches)
          || !Array.isArray(reply.result.unusedIds) || !(reply.result.contents instanceof Map)) throw new Error('Capture processing returned an unexpected result.');
      } else if (reply.kind === 'bagitInspect' || reply.kind === 'bagitInspectFolder') {
        if (!reply.result?.review || !['valid', 'invalid', 'incomplete', 'unsupported'].includes(reply.result.review.state)
          || !Array.isArray(reply.result.review.entries) || !(reply.result.contents instanceof Map)) throw new Error('BagIt processing returned an unexpected result.');
      } else if (!reply.result?.manifest || !Array.isArray(reply.result.manifest.artifacts)
        || (reply.kind === 'inspect' || reply.kind === 'inspectFolder' ? !(reply.result.contents instanceof Map) || !['verified', 'not_applicable'].includes(reply.result.encryption)
          : reply.kind === 'folder' || reply.kind === 'bagitFolder' ? !Array.isArray(reply.result.files) : !(reply.result.file instanceof Blob))) throw new Error('Evidence package processing returned an unexpected result.');
      return reply.result as InvestigationPackageResults[Kind];
    },
  });
}
