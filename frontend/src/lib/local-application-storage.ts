import { BrowserLocalDataError } from './browser-local-data.ts';
import { readResponseBytesCapped } from './bounded-json-response.ts';
import { isLocalApplication, localApplicationWorkspaceId } from './local-application-context.ts';
import { runBrowserWorkerOperation } from './browser-worker-operation.ts';
import { prepareLocalApplicationData, type LocalApplicationPreparation, type LocalApplicationPrepared } from './local-application-preparation.ts';
import {
  readLocalApplicationManifest,
  LOCAL_APPLICATION_MAX_JSON_BYTES, LOCAL_APPLICATION_MAX_TRANSFER_BYTES, LOCAL_APPLICATION_PROTOCOL_VERSION,
  LOCAL_APPLICATION_READ_REQUEST_BYTES, localApplicationOperationId, parseLocalApplicationJson,
} from '../../../packages/workspace/local-application-protocol.mts';
import type { LocalDataStorage } from '../../../packages/workspace/local-data-storage.mts';
import { array, exact } from '../../../packages/evidence/artifact-structure.mts';

export type LocalApplicationInfo = Readonly<{
  version: number; workspaceId: string; directory: string; storage: 'filesystem'; encryptedAtRest: false; offline: boolean;
}>;
const TIMEOUT_MS = 60_000;
type Fetch = typeof globalThis.fetch;
let information: Promise<LocalApplicationInfo> | undefined;
class ConfirmedLocalRejection extends BrowserLocalDataError {}

async function request(origin: string, endpoint: string, maximumBytes: number, options: Readonly<{
  workspaceId?: string; body?: BodyInit; contentType?: string; fetchImpl?: Fetch;
}> = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(`${origin}${endpoint}`, {
      method: options.body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { ...(options.workspaceId ? { 'X-Workspace-Id': options.workspaceId } : {}), ...(options.contentType ? { 'Content-Type': options.contentType } : {}) },
      ...(options.body === undefined ? {} : { body: options.body }), signal: controller.signal,
    });
    const bytes = await readResponseBytesCapped(response, response.ok ? maximumBytes : LOCAL_APPLICATION_READ_REQUEST_BYTES, controller.signal);
    if (!bytes) throw new BrowserLocalDataError('LOCAL_DATA_READ_FAILED', 'The local application returned an empty response.');
    if (!response.ok) {
      const value = parseLocalApplicationJson(bytes, LOCAL_APPLICATION_READ_REQUEST_BYTES) as Record<string, unknown>;
      if (value && value.committed === false && typeof value.code === 'string' && /^[A-Z_]{1,80}$/u.test(value.code)
        && typeof value.error === 'string' && value.error.length <= 500 && !/[\u0000-\u001f\u007f]/u.test(value.error)) {
        throw new ConfirmedLocalRejection(value.code, value.error);
      }
      throw new BrowserLocalDataError('LOCAL_DATA_COMMIT_UNKNOWN', 'The local application did not confirm the request. Reopen its launch link if the session expired, then review saved records.');
    }
    return bytes;
  } finally { clearTimeout(timer); }
}

function localOrigin(value: string): string {
  const origin = new URL(value);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.username || origin.password
    || origin.pathname !== '/' || origin.search || origin.hash) throw new BrowserLocalDataError('LOCAL_DATA_UNSUPPORTED', 'Filesystem workspaces require the local application’s loopback origin.');
  return origin.origin;
}

export async function localApplicationInfo(): Promise<LocalApplicationInfo> {
  if (!isLocalApplication()) throw new BrowserLocalDataError('LOCAL_DATA_UNSUPPORTED', 'This page does not use the local application.');
  information ??= (async () => {
    const value = exact(parseLocalApplicationJson(await request(localOrigin(location.origin), '/api/local-workspace/info', LOCAL_APPLICATION_READ_REQUEST_BYTES)),
      ['version', 'workspaceId', 'directory', 'storage', 'encryptedAtRest', 'offline'], 'Local workspace information');
    if (value.version !== LOCAL_APPLICATION_PROTOCOL_VERSION || value.storage !== 'filesystem' || value.encryptedAtRest !== false
      || typeof value.offline !== 'boolean' || localApplicationOperationId(value.workspaceId) !== localApplicationWorkspaceId()
      || typeof value.directory !== 'string' || !value.directory || value.directory.length > 4_096 || /[\u0000-\u001f\u007f]/u.test(value.directory)) {
      throw new BrowserLocalDataError('LOCAL_DATA_WORKSPACE_CHANGED', 'The local workspace does not match this page. Reload before continuing.');
    }
    return value as LocalApplicationInfo;
  })().catch(cause => { information = undefined; throw cause; });
  return information;
}

async function prepare(input: LocalApplicationPreparation): Promise<LocalApplicationPrepared> {
  if (typeof Worker === 'undefined') return prepareLocalApplicationData(input);
  return runBrowserWorkerOperation(input, {
    createWorker: () => new Worker(new URL('./workers/local-application.worker.ts', import.meta.url), { type: 'module', name: 'local-workspace-transaction' }),
    ...(input.operation !== 'encode' && input.bytes.buffer instanceof ArrayBuffer ? { transfer: [input.bytes.buffer] } : {}),
    messages: {
      cancelled: 'Workspace preparation was cancelled before sending.', unavailable: 'Local workspace preparation is unavailable. Nothing was sent.',
      timeout: 'Workspace preparation timed out. Nothing was sent.', unreadable: 'Workspace preparation returned an invalid transaction. Nothing was sent.',
      send: 'Workspace preparation could not start. Nothing was sent.',
    },
    readResponse(value) {
      const response = value as { kind?: string; result?: LocalApplicationPrepared };
      const result = response?.result;
      if (response?.kind !== 'prepared' || result?.operation !== input.operation
        || result.operation === 'encode' && (!(result.bytes instanceof Uint8Array) || !(result.bytes.buffer instanceof ArrayBuffer)
          || result.bytes.byteLength > LOCAL_APPLICATION_MAX_TRANSFER_BYTES || !/^[a-f0-9]{64}$/u.test(result.digest))
        || result.operation === 'capture' && !Array.isArray(result.captures)
        || result.operation === 'files' && !Array.isArray(result.files)) throw new Error('The local workspace message could not be verified.');
      return result;
    },
  });
}

export function createLocalApplicationStorage(originValue: string, workspaceId: string, fetchImpl: Fetch = fetch): LocalDataStorage {
  const origin = localOrigin(originValue); localApplicationOperationId(workspaceId);
  const call = (endpoint: string, maximumBytes: number, body?: BodyInit, contentType = 'application/json') => request(origin, `/api/local-workspace/${endpoint}`, maximumBytes,
    { workspaceId, fetchImpl, ...(body === undefined ? {} : { body, contentType }) });
  return {
    async manifests(collections) {
      const value = parseLocalApplicationJson(await call('manifests', LOCAL_APPLICATION_READ_REQUEST_BYTES, JSON.stringify({ collections })));
      return array(value, 'Workspace manifests', collections.length, collections.length).map(item => item === null ? undefined : readLocalApplicationManifest(item));
    },
    async capture(collections) {
      const result = await prepare({ operation: 'capture', bytes: await call('capture', LOCAL_APPLICATION_MAX_JSON_BYTES, JSON.stringify({ collections })), count: collections.length });
      if (result.operation !== 'capture') throw new Error('Invalid workspace capture.');
      return result.captures;
    },
    async files(collection, keys) {
      const result = await prepare({ operation: 'files', bytes: await call('files', LOCAL_APPLICATION_MAX_TRANSFER_BYTES, JSON.stringify({ collection, keys })), keys });
      if (result.operation !== 'files') throw new Error('Invalid workspace files.');
      return result.files;
    },
    async commit(change) {
      const operationId = crypto.randomUUID();
      let prepared: Extract<LocalApplicationPrepared, { operation: 'encode' }>;
      try {
        const result = await prepare({ operation: 'encode', change, operationId });
        if (result.operation !== 'encode') throw new Error('Invalid workspace transaction.');
        prepared = result;
      }
      catch (cause) { throw new BrowserLocalDataError('LOCAL_DATA_WRITE_FAILED', cause instanceof Error ? cause.message : 'The workspace transaction could not be prepared. No request was sent.'); }
      const { bytes, digest } = prepared;
      try {
        const value = exact(parseLocalApplicationJson(await call('commit', LOCAL_APPLICATION_READ_REQUEST_BYTES, new Blob([bytes]), 'application/zip')),
          ['operationId', 'digest'], 'Workspace commit acknowledgement');
        if (value.operationId !== operationId || value.digest !== digest) throw new Error('Unmatched workspace acknowledgement.');
      } catch (cause) {
        if (cause instanceof ConfirmedLocalRejection) throw cause;
        // A receipt proves the exact transaction committed. A missing receipt
        // does not prove absence: a disconnected request may still be finishing.
        try {
          const receipt = exact(parseLocalApplicationJson(await call(`receipt/${operationId}`, LOCAL_APPLICATION_READ_REQUEST_BYTES)), ['operationId', 'digest'], 'Workspace commit receipt');
          if (receipt.operationId === operationId && receipt.digest === digest) return;
        } catch { /* Preserve the uncertain write, never repeat its operation. */ }
        throw new BrowserLocalDataError('LOCAL_DATA_COMMIT_UNKNOWN', 'The workspace write may have succeeded, but its acknowledgement could not be verified. Reopen the local application and review saved records before another change.', { cause });
      }
    },
    async close() { /* The explicit local process, not a browser tab, owns the workspace file. */ },
  };
}
