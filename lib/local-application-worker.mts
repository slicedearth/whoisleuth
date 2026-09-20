import { createHash } from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';
import { LocalApplicationStore, LocalWorkspaceError } from './local-application-store.mts';
import { decodeLocalApplicationCommit, encodeLocalApplicationFiles, localApplicationCaptureValue, LOCAL_APPLICATION_MAX_TRANSFER_BYTES, type LocalApplicationStorageRequest } from '../packages/workspace/local-application-protocol.mts';

if (!parentPort || !workerData || typeof workerData.directory !== 'string' || typeof workerData.create !== 'boolean') throw new Error('Workspace worker requires an explicit directory.');
const port = parentPort;
const store = await LocalApplicationStore.open(workerData.directory, { create: workerData.create }).catch(cause => {
  port.postMessage({ kind: 'ready_error', code: cause instanceof LocalWorkspaceError ? cause.code : 'LOCAL_DATA_OPEN_FAILED',
    detail: cause instanceof LocalWorkspaceError ? cause.message : 'The selected workspace could not be opened. Check its format, private permissions and available disk space.' });
  port.close();
  return null;
});
if (store) {
  port.postMessage({ kind: 'ready', workspaceId: store.workspaceId, directory: store.directory });
  let chain = Promise.resolve();
  port.on('message', (message: Readonly<{ id: number; request: LocalApplicationStorageRequest }>) => {
    chain = chain.then(async () => {
      let committed = false;
      try {
        const { request } = message;
        let value: unknown;
        switch (request.operation) {
          case 'manifests': value = await store.manifests(request.collections); break;
          case 'capture': value = new TextEncoder().encode(JSON.stringify((await store.capture(request.collections)).map(localApplicationCaptureValue))); break;
          case 'files': value = encodeLocalApplicationFiles(await store.files(request.collection, request.keys)); break;
          case 'receipt': value = await store.receipt(request.operationId); break;
          case 'commit': {
            if (!(request.bytes instanceof Uint8Array) || request.bytes.byteLength > LOCAL_APPLICATION_MAX_TRANSFER_BYTES) throw new TypeError('Workspace transaction exceeds its bounds.');
            const change = await decodeLocalApplicationCommit(request.bytes), digest = createHash('sha256').update(request.bytes).digest('hex');
            await store.commit(change, change.operationId, digest);
            committed = true;
            value = { operationId: change.operationId, digest };
            break;
          }
          case 'close': store.close(); value = null; break;
          default: throw new TypeError('Unsupported workspace operation.');
        }
        port.postMessage({ kind: 'result', id: message.id, value }, value instanceof Uint8Array ? [value.buffer as ArrayBuffer] : []);
        if (request.operation === 'close') port.close();
      } catch (cause) {
        // Neither database paths, record contents nor native error stacks cross
        // the local HTTP boundary. Detailed evidence remains in the selected data.
        try {
          port.postMessage({ kind: 'error', id: message.id,
            code: committed ? 'LOCAL_DATA_COMMIT_UNKNOWN' : cause instanceof LocalWorkspaceError ? cause.code : 'INVALID_LOCAL_DATA',
            detail: committed ? 'The write completed but its acknowledgement was unavailable. Check the saved transaction before another write.'
              : cause instanceof LocalWorkspaceError ? cause.message : 'The workspace request failed bounded validation. No transaction was saved.',
          });
        } catch {
          // A closed reply channel cannot establish an absent write. Termination
          // makes the client resolve the receipt or retain an unknown outcome.
          store.close();
          port.close();
        }
      }
    });
  });
}
