import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { DOMAIN_FEED_LIMITS, normalizeDomainFeedSelection } from '../packages/monitoring/domain-feed.mts';
import { runDomainFeedWorker } from '../frontend/src/lib/domain-feed-worker.ts';
import { runDomainFeedWorkerOperation, type DomainFeedWorkerRequest, type DomainFeedWorkerResponse } from '../frontend/src/lib/domain-feed-worker-model.ts';

const raw = 'login.target.example\nother.example\n';
const request: DomainFeedWorkerRequest = { kind: 'scan', file: new Blob([raw]), feedId: 'tif-mini', importedAt: '2000-01-01T00:00:00.000Z', selection: normalizeDomainFeedSelection({ hosts: ['login.target.example'], brandProfileId: 'example-profile' })! };
class ControlledWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = 0;
  messages: unknown[] = [];
  postMessage(value: unknown) { this.messages.push(value); }
  terminate() { this.terminated++; }
  reply(value: unknown) { this.onmessage?.(new MessageEvent('message', { data: value })); }
  factory = () => this as unknown as Worker;
}

test('local worker streams a supplied blob without network and retains only bounded exact nominations', async (context) => {
  let requests = 0;
  context.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('No network expected'); });
  const response = await runDomainFeedWorkerOperation(request);
  assert.equal(response.kind, 'scan');
  if (response.kind !== 'scan') return;
  assert.equal(requests, 0);
  assert.equal(response.review.revision, `sha256:${createHash('sha256').update(raw).digest('hex')}`);
  assert.equal(response.review.rows, 2);
  assert.equal(response.review.bytes, Buffer.byteLength(raw));
  assert.deepEqual(response.review.matches.map((match) => match.domain), ['login.target.example']);
  assert.equal(response.review.matches[0]!.exactHost, true);
  assert.equal(response.review.matches[0]!.candidate.sources[0]!.observedHostname, 'login.target.example');
  assert.equal(response.review.matches[0]!.candidate.matches[0]!.brandProfileId, 'example-profile');
  assert.equal(response.review.matches[0]!.candidate.sources[0]!.sourceLastObservedAt, null);
  assert.equal(response.review.declaredPublishedAt, null);
  assert.equal(response.review.acquiredAt, null);
  assert.equal(JSON.stringify(response).includes('other.example'), false);
});

test('worker admission rejects oversized files before streaming and unsupported operations', async () => {
  class OversizedBlob extends Blob {
    get size() { return DOMAIN_FEED_LIMITS.bytes + 1; }
    stream(): ReturnType<Blob['stream']> { throw new Error('must not stream'); }
  }
  const oversized = await runDomainFeedWorkerOperation({ ...request, file: new OversizedBlob() });
  assert.equal(oversized.kind, 'error');
  if (oversized.kind === 'error') assert.match(oversized.detail, /bounded file size/u);
  assert.equal((await runDomainFeedWorkerOperation({ kind: 'unsupported' } as unknown as DomainFeedWorkerRequest)).kind, 'error');
});

test('shared worker lifecycle validates replies and terminates on cancellation', async () => {
  const worker = new ControlledWorker(), abort = new AbortController();
  const pending = assert.rejects(runDomainFeedWorker(request, { signal: abort.signal, createWorker: worker.factory }), { name: 'AbortError' });
  const lateReply = worker.onmessage;
  abort.abort();
  lateReply?.(new MessageEvent('message', { data: await runDomainFeedWorkerOperation(request) }));
  await pending;
  assert.equal(worker.terminated, 1);
  assert.equal(worker.onmessage, null);
  const invalid = new ControlledWorker();
  const rejection = assert.rejects(runDomainFeedWorker(request, { createWorker: invalid.factory }), /unexpected feed result/u);
  invalid.reply({ kind: 'scan', review: {} });
  await rejection;
  assert.equal(invalid.terminated, 1);
});

test('feed worker opts into a bounded longer deadline without changing existing default operations', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const worker = new ControlledWorker();
  const pending = assert.rejects(runDomainFeedWorker(request, { createWorker: worker.factory }), /time limit/u);
  context.mock.timers.tick(60_000);
  assert.equal(worker.terminated, 0);
  context.mock.timers.tick(540_000);
  await pending;
  assert.equal(worker.terminated, 1);
});

test('worker replies cannot change the explicitly selected host or Brand context', async () => {
  const worker = new ControlledWorker();
  const pending = assert.rejects(runDomainFeedWorker(request, { createWorker: worker.factory }), /unexpected feed result/u);
  worker.reply(await runDomainFeedWorkerOperation({ ...request, selection: normalizeDomainFeedSelection({ hosts: ['login.target.example'], brandProfileId: 'different-profile' }) }));
  await pending;
  assert.equal(worker.terminated, 1);
});

test('worker replies cannot omit an explicit negative selector even when the returned host still matches', async () => {
  const worker = new ControlledWorker();
  const selected = { ...request, selection: normalizeDomainFeedSelection({ ...request.selection, negativeTerms: ['excluded'] }) };
  const pending = assert.rejects(runDomainFeedWorker(selected, { createWorker: worker.factory }), /unexpected feed result/u);
  worker.reply(await runDomainFeedWorkerOperation(request));
  await pending;
  assert.equal(worker.terminated, 1);
});

test('native feed worker accepts one operation and no durable state', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'self');
  const replies: DomainFeedWorkerResponse[] = [];
  const scope: { postMessage: (value: DomainFeedWorkerResponse) => void; onmessage?: (event: MessageEvent<DomainFeedWorkerRequest>) => void } = { postMessage: (value) => replies.push(value) };
  Object.defineProperty(globalThis, 'self', { configurable: true, value: scope });
  try {
    await import('../frontend/src/lib/workers/domain-feed.worker.ts');
    scope.onmessage?.(new MessageEvent('message', { data: { kind: 'unsupported' } as unknown as DomainFeedWorkerRequest }));
    scope.onmessage?.(new MessageEvent('message', { data: request }));
    await Promise.resolve(); await Promise.resolve();
    assert.equal(replies.length, 1);
    assert.equal(replies[0]!.kind, 'error');
  } finally { if (original) Object.defineProperty(globalThis, 'self', original); else Reflect.deleteProperty(globalThis, 'self'); }
});
