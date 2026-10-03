import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readContextEvidence, readContextFile } from '../frontend/src/lib/context-review-input.ts';
import { runConnectorProvenanceWorker } from '../frontend/src/lib/connector-provenance-worker.ts';
import { runMessageIntakeWorker } from '../frontend/src/lib/message-intake-worker.ts';
import { runMessageIntakeOperation } from '../frontend/src/lib/message-intake-worker-model.ts';
import { connectorConfigurationPresentation } from '../packages/investigation/connector-provenance-review.mts';
import { MAX_CONTEXT_INPUT_BYTES } from '../packages/contracts/context-review.mts';

const NOW = '2026-09-22T00:00:00.000Z';

test('selected context files are size, encoding, schema and version checked without changing input', async () => {
  const input = { schema: 'whoisleuth.platform-continuity.input', version: 1, evidence: [] };
  const file = new File([JSON.stringify(input)], 'selected.json');
  assert.deepEqual(readContextEvidence(await readContextFile(file), input.schema), []);
  await assert.rejects(readContextFile(new File([], 'empty.json')));
  const oversized = new File(['x'], 'large.json'); Object.defineProperty(oversized, 'size', { value: MAX_CONTEXT_INPUT_BYTES + 1 });
  await assert.rejects(readContextFile(oversized), /16 MiB/u);
  await assert.rejects(readContextFile(new File([new Uint8Array([0xff])], 'invalid.json')));
  for (const value of [{ ...input, version: 99 }, { ...input, unexpected: true }, { ...input, schema: 'different' }]) assert.throws(() => readContextEvidence(JSON.stringify(value), input.schema));
});

test('local review adapters validate replies and share cancellation and worker teardown', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  let response: unknown, terminated = 0, posts = 0;
  class FixtureWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror = null; onmessageerror = null;
    postMessage() { posts++; queueMicrotask(() => this.onmessage?.(new MessageEvent('message', { data: response }))); }
    terminate() { terminated++; }
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FixtureWorker });
  try {
    const input = { current: '{"servers":{"selected":{"url":"https://example.test"}}}', previous: '', reviewedAt: NOW };
    response = connectorConfigurationPresentation(input.current, input.previous, NOW);
    assert.deepEqual(await runConnectorProvenanceWorker(input, new AbortController().signal), response);
    response = { schema: 'private transport detail', observations: [] };
    await assert.rejects(runConnectorProvenanceWorker(input, new AbortController().signal), error => error instanceof Error && !error.message.includes('private transport detail') && error.message.includes('nothing was saved'));
    const message = { kind: 'text' as const, file: new Blob(['https://example.test']), reviewedAt: NOW };
    response = await runMessageIntakeOperation(message);
    assert.deepEqual(await runMessageIntakeWorker(message), (response as Awaited<ReturnType<typeof runMessageIntakeOperation>> & { kind: 'review' }).result);
    response = { kind: 'error', detail: 'private transport detail' };
    await assert.rejects(runMessageIntakeWorker(message), error => error instanceof Error && !error.message.includes('private transport detail') && error.message.includes('Nothing was saved'));
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(runConnectorProvenanceWorker(input, cancelled.signal), { name: 'AbortError' });
    assert.equal(posts, 4); assert.equal(terminated, 4);
  } finally { if (previous) Object.defineProperty(globalThis, 'Worker', previous); else Reflect.deleteProperty(globalThis, 'Worker'); }
});

test('message worker entrypoint accepts one operation and returns no raw failure detail', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'self'), replies: unknown[] = [];
  let finish!: () => void;
  const completed = new Promise<void>(resolve => finish = resolve);
  const scope: { postMessage(value: unknown): void; onmessage?: (event: MessageEvent) => void } = { postMessage(value) { replies.push(value); finish(); } };
  Object.defineProperty(globalThis, 'self', { configurable: true, value: scope });
  try {
    await import('../frontend/src/lib/workers/message-intake.worker.ts');
    assert.equal(typeof scope.onmessage, 'function');
    scope.onmessage!(new MessageEvent('message', { data: { kind: 'qr', file: new Blob(['private invalid image']), reviewedAt: NOW } }));
    scope.onmessage!(new MessageEvent('message', { data: { kind: 'text', file: new Blob(['https://example.test']), reviewedAt: NOW } }));
    await completed;
    assert.deepEqual(replies, [{ kind: 'error' }]);
  } finally { if (previous) Object.defineProperty(globalThis, 'self', previous); else Reflect.deleteProperty(globalThis, 'self'); }
});
