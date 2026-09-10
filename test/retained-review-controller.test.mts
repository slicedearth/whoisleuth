import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createRetainedReviewController, type RetainedReviewPreparation } from '../frontend/src/lib/controllers/retained-review-controller.ts';
import { buildRetainedEvidenceTimeline } from '../frontend/src/lib/analysis/retained-evidence-timeline.ts';
import type { RetainedReviewInputs, RetainedReviewResults } from '../frontend/src/lib/retained-review-worker-model.ts';

const NOW = '2026-08-14T00:00:00.000Z';
const input: RetainedReviewInputs['timeline'] = { cases: [] };
const result = buildRetainedEvidenceTimeline({ ...input, now: NOW });
function harness() {
  const states: RetainedReviewPreparation<'timeline'>[] = [];
  const requests: { input: RetainedReviewInputs['timeline']; evaluatedAt: string; signal: AbortSignal;
    resolve: (value: RetainedReviewResults['timeline']) => void; reject: (error: Error) => void }[] = [];
  const controller = createRetainedReviewController('timeline', (next) => states.push(next), {
    now: () => NOW,
    run: (_kind, source, evaluatedAt, { signal }) => new Promise((resolve, reject) => requests.push({ input: source, evaluatedAt, signal, resolve, reject })),
  });
  function current() { const state = states.at(-1); assert.ok(state); return state; }
  return { controller, states, requests, current };
}

test('retained preparation starts only for an active view and caches only its current immutable input', async () => {
  const { controller, requests, current } = harness();
  controller.select(input, false);
  await setImmediate();
  assert.equal(requests.length, 0);
  assert.equal(current().state, 'idle');
  controller.select(input, true);
  assert.equal(current().state, 'loading');
  assert.equal(current().result, null);
  await setImmediate();
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.input, input);
  assert.equal(requests[0]!.evaluatedAt, NOW);
  requests[0]!.resolve(result);
  await setImmediate();
  assert.equal(current().state, 'ready');
  assert.equal(current().result, result);
  controller.select(input, false);
  controller.select(input, true);
  controller.prepare(input);
  await setImmediate();
  assert.equal(requests.length, 1);
  controller.dispose();
});

test('changed collections discard cached evidence even while the view is inactive', async () => {
  const { controller, requests, current } = harness();
  controller.select(input, true); await setImmediate();
  requests[0]!.resolve(result); await setImmediate();
  const next = { cases: [] };
  controller.select(next, false);
  assert.equal(current().input, next);
  assert.equal(current().result, null);
  assert.equal(current().state, 'idle');
  await setImmediate();
  assert.equal(requests.length, 1);
  controller.select(next, true); await setImmediate();
  assert.equal(requests.length, 2);
  controller.select(null, true);
  assert.equal(requests[1]!.signal.aborted, true);
  assert.equal(current().result, null);
  assert.equal(current().input, null);
  controller.dispose();
});

test('cancellation and late results cannot overwrite the newly selected collection', async () => {
  const { controller, requests, current } = harness();
  controller.select(input, true); await setImmediate();
  controller.select(input, false);
  assert.equal(requests[0]!.signal.aborted, true);
  assert.equal(current().state, 'idle');
  const next = { cases: [] };
  controller.select(next, true); await setImmediate();
  const nextResult = { ...result, evaluatedAt: '2026-08-15T00:00:00.000Z' };
  requests[1]!.resolve(nextResult); await setImmediate();
  requests[0]!.resolve(result); await setImmediate();
  assert.equal(current().input, next);
  assert.equal(current().result, nextResult);
  assert.equal(current().state, 'ready');
  controller.dispose();
});

test('failed preparation stays unavailable until a deliberate retry', async () => {
  const { controller, requests, current } = harness();
  controller.select(input, true); await setImmediate();
  requests[0]!.reject(new Error('Worker unavailable.')); await setImmediate();
  assert.equal(current().state, 'unavailable');
  assert.equal(current().result, null);
  assert.equal(current().error, 'Worker unavailable.');
  controller.select(input, false); controller.select(input, true); await setImmediate();
  assert.equal(requests.length, 1);
  controller.prepare(input, true); await setImmediate();
  assert.equal(requests.length, 2);
  requests[1]!.resolve(result); await setImmediate();
  assert.equal(current().state, 'ready');
  assert.equal(current().error, '');
  controller.dispose();
});

test('same-input refresh retains the previous result on pending, failed and cancelled preparation', async () => {
  const { controller, requests, current } = harness();
  controller.select(input, true); await setImmediate();
  requests[0]!.resolve(result); await setImmediate();
  controller.prepare(input, true); await setImmediate();
  assert.equal(current().state, 'loading');
  assert.equal(current().result, result);
  requests[1]!.reject(new Error('Refresh unavailable.')); await setImmediate();
  assert.equal(current().state, 'unavailable');
  assert.equal(current().result, result);
  controller.prepare(input, true); await setImmediate();
  controller.suspend();
  assert.equal(requests[2]!.signal.aborted, true);
  assert.equal(current().state, 'ready');
  assert.equal(current().result, result);
  controller.prepare({ cases: [] }, true);
  assert.equal(current().result, null);
  controller.dispose();
});

test('disposal before preparation or during a request publishes no late state and starts no replacement', async () => {
  for (const started of [false, true]) {
    const { controller, requests, states } = harness();
    controller.select(input, true);
    if (started) await setImmediate();
    const count = states.length;
    controller.dispose();
    if (started) { assert.equal(requests[0]!.signal.aborted, true); requests[0]!.reject(new Error('Late cancellation.')); }
    controller.select(input, true); controller.prepare(input, true);
    await setImmediate();
    assert.equal(requests.length, started ? 1 : 0);
    assert.equal(states.length, count);
  }
});

test('synchronous preparation failure is reported through the same unavailable state', async () => {
  const states: RetainedReviewPreparation<'timeline'>[] = [];
  const controller = createRetainedReviewController('timeline', (next) => states.push(next), {
    run: () => { throw new Error('Worker creation failed.'); },
  });
  controller.select(input, true); await setImmediate();
  assert.equal(states.at(-1)?.state, 'unavailable');
  assert.equal(states.at(-1)?.result, null);
  assert.equal(states.at(-1)?.error, 'Worker creation failed.');
  controller.dispose();
});
