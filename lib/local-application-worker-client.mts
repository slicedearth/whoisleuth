import { Worker } from 'node:worker_threads';
import { LocalWorkspaceError } from './local-application-errors.mts';
import type { LocalApplicationStorageRequest } from '../packages/workspace/local-application-protocol.mts';

const OPERATION_DEADLINE_MS = 60_000;
const MAX_PENDING_OPERATIONS = 32;
export const LOCAL_APPLICATION_WORKER_URL = new URL(`./local-application-worker.${import.meta.url.endsWith('.mts') ? 'mts' : 'mjs'}`, import.meta.url);

/** One worker owns blocking filesystem work; the HTTP server remains responsive. */
export class LocalApplicationWorker {
  readonly ready: Promise<Readonly<{ workspaceId: string; directory: string }>>;
  #worker: Worker;
  #pending = new Map<number, { resolve(value: unknown): void; reject(cause: Error): void; timer: ReturnType<typeof setTimeout> }>();
  #nextId = 0;
  #failed = false;

  constructor(directory: string, create: boolean) {
    // Worker imports are resolved by the same emitted/source extension as this
    // module; compiler output requires no private build-manifest lookup.
    this.#worker = new Worker(LOCAL_APPLICATION_WORKER_URL, { workerData: { directory, create }, env: {} });
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#fail(); reject(new LocalWorkspaceError('LOCAL_DATA_TIMEOUT', 'Opening the selected workspace timed out.')); }, OPERATION_DEADLINE_MS);
      const failed = () => { clearTimeout(timer); reject(new LocalWorkspaceError('LOCAL_DATA_OPEN_FAILED', 'The selected workspace could not be opened. Check its format, private permissions and available disk space.')); };
      this.#worker.once('error', failed);
      this.#worker.once('exit', failed);
      const ready = (message: { kind?: string; workspaceId?: unknown; directory?: unknown; code?: string; detail?: string }) => {
        if (message.kind !== 'ready' && message.kind !== 'ready_error') return;
        clearTimeout(timer); this.#worker.off('message', ready); this.#worker.off('error', failed); this.#worker.off('exit', failed);
        if (message.kind === 'ready_error') { this.#fail(); reject(new LocalWorkspaceError(message.code ?? 'LOCAL_DATA_OPEN_FAILED', message.detail ?? 'The selected workspace could not be opened.')); return; }
        if (typeof message.workspaceId !== 'string' || typeof message.directory !== 'string') { this.#fail(); reject(new Error('Invalid workspace readiness response.')); return; }
        resolve({ workspaceId: message.workspaceId, directory: message.directory });
      };
      this.#worker.on('message', ready);
    });
    void this.ready.catch(() => undefined);
    this.#worker.on('error', () => this.#fail());
    this.#worker.on('exit', () => this.#fail());
    this.#worker.on('message', (message: { kind: string; id: number; value?: unknown; code?: string; detail?: string }) => {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.#pending.delete(message.id);
      if (message.kind === 'result') pending.resolve(message.value);
      else pending.reject(new LocalWorkspaceError(message.code ?? 'LOCAL_DATA_COMMIT_UNKNOWN', message.detail ?? 'The workspace result could not be confirmed.'));
    });
  }

  #fail(): void {
    if (this.#failed) return;
    this.#failed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new LocalWorkspaceError('LOCAL_DATA_COMMIT_UNKNOWN', 'The workspace process stopped before its result was confirmed. Restart the local application and review saved records before making another change.'));
    }
    this.#pending.clear();
    void this.#worker.terminate();
  }

  async request(request: LocalApplicationStorageRequest): Promise<unknown> {
    await this.ready;
    if (this.#failed) throw new LocalWorkspaceError('LOCAL_DATA_COMMIT_UNKNOWN', 'The workspace process is unavailable. Restart the local application and review saved records.');
    if (this.#pending.size >= MAX_PENDING_OPERATIONS) throw new LocalWorkspaceError('LOCAL_DATA_BUSY', 'The workspace is busy. Retry after the current operation finishes.');
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.#fail(), OPERATION_DEADLINE_MS);
      this.#pending.set(id, { resolve, reject, timer });
      try { this.#worker.postMessage({ id, request }, request.operation === 'commit' ? [request.bytes.buffer as ArrayBuffer] : []); }
      catch { this.#fail(); }
    });
  }

  async close(): Promise<void> {
    try {
      await this.ready;
      if (!this.#failed) await this.request({ operation: 'close' });
    } finally { this.#fail(); await this.#worker.terminate(); }
  }
}
