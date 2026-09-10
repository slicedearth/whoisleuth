import assert from 'node:assert/strict';
import test from 'node:test';
import { createCase, normalizeCaseStore, serializeCaseStore } from '../frontend/src/lib/analysis/case-model.ts';
import { buildEvidenceDebtReview } from '../frontend/src/lib/analysis/evidence-debt-review.ts';
import { buildRetainedEvidenceTimeline } from '../frontend/src/lib/analysis/retained-evidence-timeline.ts';
import { runRetainedReviewOperation, type RetainedReviewRequest, type RetainedReviewResponse } from '../frontend/src/lib/retained-review-worker-model.ts';
import { runRetainedReviewWorker } from '../frontend/src/lib/retained-review-worker.ts';
import { BROWSER_WORKER_OPERATION_TIMEOUT_MS } from '../frontend/src/lib/browser-worker-operation.ts';

const NOW = '2026-08-14T00:00:00.000Z';
const input = { cases: [createCase({ domain: 'review.example', evidencePin: {
  label: 'Undated source fact', value: 'Retained value', source: 'whois', observedAt: null,
} }, '2026-08-01T00:00:00.000Z')], bulkSessions: [] };
const request: RetainedReviewRequest = { kind: 'timeline', input, evaluatedAt: NOW };

class ControlledWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  messages: RetainedReviewRequest[] = [];
  terminated = 0;
  failPost = false;
  postMessage(value: RetainedReviewRequest) { if (this.failPost) throw new Error('private transport detail'); this.messages.push(structuredClone(value)); }
  terminate() { this.terminated += 1; }
  reply(value: unknown) { this.onmessage?.(new MessageEvent('message', { data: value })); }
  factory = () => this as unknown as Worker;
}

test('retained worker returns the complete admitted result without altering evidence or source clocks', () => {
  const records = Array.from({ length: 75 }, (_, index) => {
    const record = createCase({ domain: `retained-${index}.example`, evidencePin: {
      label: 'Undated fact', value: 'Retained value', source: 'whois', observedAt: null,
    } }, '2026-08-01T00:00:00.000Z');
    record.evidencePins = Array.from({ length: 40 }, (_, pin) => ({ ...record.evidencePins[0]!, id: `pin-${index}-${pin}` }));
    return record;
  });
  const cases = normalizeCaseStore(JSON.parse(serializeCaseStore(records))).cases;
  assert.equal(cases.flatMap((record) => record.evidencePins).length, 3_000);
  const admitted = { cases, bulkSessions: [] };
  const original = structuredClone(admitted);
  const timeline = runRetainedReviewOperation({ kind: 'timeline', input: admitted, evaluatedAt: NOW });
  assert.equal(timeline.kind, 'timeline');
  if (timeline.kind !== 'timeline') throw new Error('Expected the timeline result.');
  assert.deepEqual(timeline.result, buildRetainedEvidenceTimeline({ ...admitted, now: NOW }));
  assert.equal(timeline.result.items.length, 3_000);
  assert.equal(timeline.result.freshnessCounts.unknown, 3_000);
  assert.equal(timeline.result.truncated, false);
  assert.ok(timeline.result.items.every((item) => item.observedAt === null));
  const debt = runRetainedReviewOperation({ kind: 'debt', input: admitted, evaluatedAt: NOW });
  assert.equal(debt.kind, 'debt');
  if (debt.kind !== 'debt') throw new Error('Expected the evidence-gap result.');
  assert.deepEqual(debt.result, buildEvidenceDebtReview(admitted, NOW));
  assert.equal(debt.result.items.length, 3_000);
  assert.equal(debt.result.counts.stale, 0);
  assert.deepEqual(admitted, original);
});

test('worker computation uses the supplied clock and never replaces an invalid clock with worker time', () => {
  for (const kind of ['timeline', 'debt'] as const) {
    const known = runRetainedReviewOperation({ kind, input, evaluatedAt: NOW });
    assert.equal(known.kind, kind);
    assert.equal(known.result.evaluatedAt, NOW);
    for (const evaluatedAt of ['', 'not-a-clock', undefined]) {
      const result = runRetainedReviewOperation({ kind, input, evaluatedAt } as RetainedReviewRequest);
      assert.equal(result.kind, kind);
      assert.equal(result.result.evaluatedAt, null);
    }
  }
});

test('worker computation keeps failed inputs unavailable without exposing input details', () => {
  for (const value of [null, { kind: 'unknown' }, ...(['debt', 'timeline'] as const).flatMap((kind) => [null, [], undefined].map((input) => ({ kind, input, evaluatedAt: NOW })))]) {
    assert.deepEqual(runRetainedReviewOperation(value as RetainedReviewRequest), {
      kind: 'error', detail: 'Retained review could not be prepared. Saved records were not changed.',
    });
  }
});

test('retained worker waits for its matching reply and releases every handler after one operation', async () => {
  const worker = new ControlledWorker();
  let complete = false;
  const pending = runRetainedReviewWorker('timeline', input, NOW, { createWorker: worker.factory }).then((result) => { complete = true; return result; });
  await Promise.resolve();
  assert.equal(complete, false);
  assert.deepEqual(worker.messages, [request]);
  const response = runRetainedReviewOperation(request);
  worker.reply(response);
  assert.equal(response.kind, 'timeline');
  if (response.kind !== 'timeline') throw new Error('Expected timeline.');
  assert.deepEqual(await pending, response.result);
  worker.reply({ kind: 'error', detail: 'Late response' });
  assert.equal(worker.terminated, 1);
  assert.equal(worker.onmessage, null);
  assert.equal(worker.onerror, null);
  assert.equal(worker.onmessageerror, null);
});

test('retained worker cancels before creation, during creation and after posting', async () => {
  for (const phase of ['before', 'create', 'posted'] as const) {
    const abort = new AbortController();
    const worker = new ControlledWorker();
    let created = 0;
    if (phase === 'before') abort.abort();
    const pending = assert.rejects(runRetainedReviewWorker('timeline', input, NOW, {
      signal: abort.signal, createWorker: () => { created += 1; if (phase === 'create') abort.abort(); return worker.factory(); },
    }), { name: 'AbortError' });
    if (phase === 'posted') abort.abort();
    await pending;
    assert.equal(created, phase === 'before' ? 0 : 1);
    assert.equal(worker.terminated, phase === 'before' ? 0 : 1);
    assert.equal(worker.messages.length, phase === 'posted' ? 1 : 0);
  }
});

test('retained worker fails explicitly on its deadline and transport or response failures', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const timedWorker = new ControlledWorker();
  const timed = assert.rejects(runRetainedReviewWorker('timeline', input, NOW, { createWorker: timedWorker.factory }), /did not finish/u);
  context.mock.timers.tick(BROWSER_WORKER_OPERATION_TIMEOUT_MS);
  await timed;
  assert.equal(timedWorker.terminated, 1);
  await assert.rejects(runRetainedReviewWorker('timeline', input, NOW, { createWorker: () => { throw new Error('private path'); } }), /worker is unavailable/u);
  for (const failure of ['post', 'load', 'message', 'kind', 'empty', 'incomplete', 'error'] as const) {
    const worker = new ControlledWorker();
    worker.failPost = failure === 'post';
    const pending = assert.rejects(runRetainedReviewWorker('timeline', input, NOW, { createWorker: worker.factory }), /local processing|unavailable|unreadable|unexpected|could not be prepared/u);
    if (failure === 'load') worker.onerror?.({ preventDefault() {} } as ErrorEvent);
    if (failure === 'message') worker.onmessageerror?.();
    if (failure === 'kind') worker.reply({ kind: 'debt', result: {} });
    if (failure === 'empty') worker.reply({ kind: 'timeline', result: null });
    if (failure === 'incomplete') worker.reply({ kind: 'timeline', result: {} });
    if (failure === 'error') worker.reply(runRetainedReviewOperation(null as unknown as RetainedReviewRequest));
    await pending;
    assert.equal(worker.terminated, 1);
  }
});

test('native retained worker accepts exactly one request', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'self');
  const replies: RetainedReviewResponse[] = [];
  const scope: { postMessage: (value: RetainedReviewResponse) => void; onmessage?: (event: MessageEvent<RetainedReviewRequest>) => void } = { postMessage: (value) => replies.push(value) };
  Object.defineProperty(globalThis, 'self', { configurable: true, value: scope });
  try {
    await import('../frontend/src/lib/workers/retained-review.worker.ts');
    assert.equal(typeof scope.onmessage, 'function');
    scope.onmessage?.(new MessageEvent('message', { data: request }));
    scope.onmessage?.(new MessageEvent('message', { data: { ...request, kind: 'debt' } }));
    assert.deepEqual(replies, [runRetainedReviewOperation(request)]);
  } finally { if (original) Object.defineProperty(globalThis, 'self', original); else Reflect.deleteProperty(globalThis, 'self'); }
});
