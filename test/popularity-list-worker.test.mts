import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { MAX_POPULARITY_LIST_BYTES } from '../packages/analysis/popularity-list.mts';
import { runPopularityListWorker } from '../frontend/src/lib/popularity-list-worker.ts';
import {
  MAX_POPULARITY_RANKED_DOMAINS, runPopularityListWorkerOperation,
  type PopularityListWorkerRequest, type PopularityListWorkerResponse,
} from '../frontend/src/lib/popularity-list-worker-model.ts';

const LIST = '\uFEFFrank,domain\n1,unrelated.example\n7,candidate.example\n9,other-candidate.example\nnot,a,row\n';
const request: PopularityListWorkerRequest = {
  kind: 'rank',
  file: new Blob([LIST]),
  domains: ['candidate.example', 'other-candidate.example', 'unlisted.example', 'candidate.example'],
};
class ControlledWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = 0;
  postMessage() {}
  terminate() { this.terminated++; }
  reply(value: unknown) { this.onmessage?.(new MessageEvent('message', { data: value })); }
  factory = () => this as unknown as Worker;
}

test('the worker returns only the requested candidates’ ranks, never the rest of the list', async () => {
  const response = await runPopularityListWorkerOperation(request);
  assert.equal(response.kind, 'rank');
  if (response.kind !== 'rank') return;
  assert.deepEqual(response.result.ranks, [['candidate.example', 7], ['other-candidate.example', 9]]);
  assert.deepEqual([response.result.entries, response.result.rejectedLines, response.result.truncated], [3, 1, false]);
  assert.equal(JSON.stringify(response).includes('unrelated.example'), false);
  // The digest covers the file bytes, as the CLI digest of the same file does.
  assert.equal(response.result.listSha256, createHash('sha256').update(LIST).digest('hex'));
  const invalid = await runPopularityListWorkerOperation({ ...request, file: new Blob([new Uint8Array([0x31, 0x2c, 0xff, 0x0a])]) });
  assert.deepEqual(invalid, { kind: 'error', detail: 'Popularity lists must contain valid UTF-8 text.' });
});

test('worker admission rejects oversized files before reading and unbounded candidate sets', async () => {
  class OversizedBlob extends Blob {
    override get size() { return MAX_POPULARITY_LIST_BYTES + 1; }
    override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('must not read'); }
  }
  const oversized = await runPopularityListWorkerOperation({ ...request, file: new OversizedBlob() });
  assert.deepEqual(oversized, { kind: 'error', detail: 'Popularity lists are limited to 32 MiB.' });
  const unbounded = await runPopularityListWorkerOperation({ ...request, domains: Array.from({ length: MAX_POPULARITY_RANKED_DOMAINS + 1 }, (_, index) => `c${index}.example`) });
  assert.equal(unbounded.kind, 'error');
  assert.equal((await runPopularityListWorkerOperation({ kind: 'unsupported' } as unknown as PopularityListWorkerRequest)).kind, 'error');
});

test('replies are validated against the request and cancellation terminates the worker', async () => {
  const reply = await runPopularityListWorkerOperation(request);
  const accepted = new ControlledWorker();
  const pending = runPopularityListWorker(request, { createWorker: accepted.factory });
  accepted.reply(reply);
  assert.deepEqual((await pending).ranks, [['candidate.example', 7], ['other-candidate.example', 9]]);
  assert.equal(accepted.terminated, 1);

  for (const forged of [
    { kind: 'rank', result: { listSha256: 'a'.repeat(64), entries: 3, rejectedLines: 0, truncated: false, ranks: [['unrequested.example', 1]] } },
    { kind: 'rank', result: { listSha256: 'a'.repeat(64), entries: 3, rejectedLines: 0, truncated: false, ranks: [['candidate.example', 0]] } },
    { kind: 'rank', result: { listSha256: 'a'.repeat(64), entries: -1, rejectedLines: 0, truncated: false, ranks: [] } },
    { kind: 'rank', result: { listSha256: 'not-a-digest', entries: 3, rejectedLines: 0, truncated: false, ranks: [] } },
  ]) {
    const worker = new ControlledWorker();
    const rejection = assert.rejects(runPopularityListWorker(request, { createWorker: worker.factory }), /unexpected popularity result/u);
    worker.reply(forged);
    await rejection;
    assert.equal(worker.terminated, 1);
  }
  const failing = new ControlledWorker();
  const failure = assert.rejects(runPopularityListWorker(request, { createWorker: failing.factory }), /limited to 32 MiB/u);
  failing.reply({ kind: 'error', detail: 'Popularity lists are limited to 32 MiB.' });
  await failure;

  const cancelled = new ControlledWorker(), abort = new AbortController();
  const aborted = assert.rejects(runPopularityListWorker(request, { signal: abort.signal, createWorker: cancelled.factory }), { name: 'AbortError' });
  abort.abort();
  await aborted;
  assert.equal(cancelled.terminated, 1);
});

test('the native worker accepts one operation', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'self');
  const replies: PopularityListWorkerResponse[] = [];
  const scope: { postMessage: (value: PopularityListWorkerResponse) => void; onmessage?: (event: MessageEvent<PopularityListWorkerRequest>) => void } = { postMessage: (value) => replies.push(value) };
  Object.defineProperty(globalThis, 'self', { configurable: true, value: scope });
  try {
    await import('../frontend/src/lib/workers/popularity-list.worker.ts');
    scope.onmessage?.(new MessageEvent('message', { data: { kind: 'unsupported' } as unknown as PopularityListWorkerRequest }));
    scope.onmessage?.(new MessageEvent('message', { data: request }));
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();
    assert.equal(replies.length, 1);
    assert.equal(replies[0]!.kind, 'error');
  } finally { if (original) Object.defineProperty(globalThis, 'self', original); else Reflect.deleteProperty(globalThis, 'self'); }
});
