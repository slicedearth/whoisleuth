type MatcherWorker = {
  on(event: 'message' | 'error' | 'exit', listener: (value: unknown) => void): unknown;
  off(event: 'message' | 'error' | 'exit', listener: (value: unknown) => void): unknown;
  postMessage(value: unknown): void;
  ref(): void;
  unref(): void;
  terminate(): Promise<number>;
};
type ScanResult = Readonly<{ timedOut: boolean; unavailable: boolean; output: string | null }>;
type PendingScan = {
  id: number; value: string; signal?: AbortSignal;
  resolve(result: ScanResult): void; reject(error: unknown): void;
  cleanup(): void;
};

/** One bounded matcher worker. Queue deadlines include waiting; cancellation never stops a different scan. */
export function createInlineLibraryScanner(createWorker: () => MatcherWorker, limits: Readonly<{
  maximumCharacters: number; outputBytes: number; deadlineMs: number; pending: number;
}>) {
  let worker: MatcherWorker | null = null;
  let active: PendingScan | null = null;
  let closing = false;
  let nextId = 0;
  const queue: PendingScan[] = [];
  const pending = new Set<PendingScan>();

  function retireWorker(): void {
    if (!worker) return;
    const retired = worker; worker = null; closing = true;
    void Promise.resolve().then(() => retired.terminate()).catch(() => {}).finally(() => { closing = false; pump(); });
  }

  function pump(): void {
    if (active || closing) return;
    const job = queue.shift();
    if (!job) { worker?.unref(); return; }
    active = job;
    let current: MatcherWorker;
    const control = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    const output = new Uint8Array(new SharedArrayBuffer(limits.outputBytes));
    const cleanup = job.cleanup;
    const failed = () => settle(job, { timedOut: false, unavailable: true, output: null }, true);
    const message = (value: unknown) => {
      if (!value || typeof value !== 'object' || !('id' in value) || value.id !== job.id) return;
      const length = Atomics.load(control, 0);
      if (length < 1 || length > output.byteLength) { failed(); return; }
      settle(job, { timedOut: false, unavailable: false, output: Buffer.from(output.subarray(0, length)).toString('utf8') });
    };
    job.cleanup = () => {
      cleanup(); current?.off('message', message); current?.off('error', failed); current?.off('exit', failed);
    };
    try {
      if (!worker) {
        const created = createWorker();
        worker = created;
        const idleStopped = () => { if (!active && worker === created) worker = null; };
        created.on('error', idleStopped); created.on('exit', idleStopped);
      }
      current = worker;
      if (active !== job) { retireWorker(); return; }
      current.ref();
      current.on('message', message); current.on('error', failed); current.on('exit', failed);
      current.postMessage({ id: job.id, value: job.value, control: control.buffer, output: output.buffer });
    } catch { failed(); }
  }

  function settle(job: PendingScan, result: ScanResult, retire = false, aborted = false): void {
    if (!pending.delete(job)) return;
    job.cleanup();
    if (active === job) {
      active = null;
      if (retire) retireWorker();
    } else {
      const index = queue.indexOf(job);
      if (index >= 0) queue.splice(index, 1);
    }
    if (aborted) job.reject(job.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    else job.resolve(result);
    queueMicrotask(pump);
  }

  return function scan(value: string, signal?: AbortSignal): Promise<ScanResult> {
    signal?.throwIfAborted();
    if (!value) return Promise.resolve({ timedOut: false, unavailable: false, output: '[]' });
    if (value.length > limits.maximumCharacters || pending.size >= limits.pending) {
      return Promise.resolve({ timedOut: false, unavailable: true, output: null });
    }
    return new Promise((resolve, reject) => {
      const job: PendingScan = { id: ++nextId, value, ...(signal ? { signal } : {}), resolve, reject, cleanup: () => {} };
      const timer = setTimeout(() => settle(job, { timedOut: true, unavailable: false, output: null }, true), limits.deadlineMs);
      const abort = () => settle(job, { timedOut: false, unavailable: true, output: null }, true, true);
      job.cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      pending.add(job); queue.push(job);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort(); else pump();
    });
  };
}
