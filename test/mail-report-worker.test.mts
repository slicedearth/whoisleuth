import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runMailReportWorker } from '../frontend/src/lib/mail-report-worker.ts';
import { runMailReportWorkerOperation, type MailReportWorkerRequest, type MailReportWorkerResponse } from '../frontend/src/lib/mail-report-worker-model.ts';
import { buildMailReportReview } from '../packages/interchange/mail-report-workbench.mts';
import { sha256ArtifactDigest, sha256ArtifactDigestV2 } from '../packages/evidence/artifact-integrity.mts';

const request: MailReportWorkerRequest = { kind: 'review', reports: [], officialDomains: [] };
class ControlledWorker {
  onmessage: ((event: MessageEvent<MailReportWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  messages: MailReportWorkerRequest[] = [];
  terminated = 0;
  failPost = false;
  postMessage(value: MailReportWorkerRequest) { if (this.failPost) throw new Error('private transport detail'); this.messages.push(structuredClone(value)); }
  terminate() { this.terminated += 1; }
  reply(value: MailReportWorkerResponse) { this.onmessage?.(new MessageEvent('message', { data: value })); }
  factory = () => this as unknown as Worker;
}

test('mail worker waits for a matching response and terminates after one operation', async () => {
  const worker = new ControlledWorker();
  let completed = false;
  const pending = runMailReportWorker(request, { createWorker: worker.factory }).then((value) => { completed = true; return value; });
  await Promise.resolve();
  assert.equal(completed, false);
  assert.deepEqual(worker.messages, [request]);
  const result = await runMailReportWorkerOperation(request);
  worker.reply(result);
  assert.deepEqual(await pending, result);
  assert.equal(worker.terminated, 1);
  assert.equal(worker.onmessage, null);
  assert.equal(worker.onerror, null);
});

test('mail worker rejects cancellation before creation and during processing', async () => {
  const before = new AbortController(); before.abort();
  await assert.rejects(() => runMailReportWorker(request, { signal: before.signal, createWorker: () => { throw new Error('must not create'); } }), { name: 'AbortError' });
  const worker = new ControlledWorker();
  const active = new AbortController();
  const rejection = assert.rejects(runMailReportWorker(request, { createWorker: worker.factory, signal: active.signal }), { name: 'AbortError' });
  active.abort(); active.abort();
  await rejection;
  assert.equal(worker.terminated, 1);
  assert.equal(worker.onmessage, null);
});

test('mail worker handles its finite deadline, load, clone and message failures', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const worker = new ControlledWorker();
  const timed = assert.rejects(runMailReportWorker(request, { createWorker: worker.factory }), /did not finish/u);
  context.mock.timers.tick(60_000);
  await timed;
  assert.equal(worker.terminated, 1);
  await assert.rejects(() => runMailReportWorker(request, { createWorker: () => { throw new Error('private detail'); } }), /worker is unavailable/u);
  for (const failure of ['post', 'load', 'message', 'operation', 'parser'] as const) {
    const broken = new ControlledWorker();
    broken.failPost = failure === 'post';
    const pending = assert.rejects(runMailReportWorker(request, { createWorker: broken.factory }), /local processing|unavailable|unreadable|unexpected|report invalid/u);
    if (failure === 'load') broken.onerror?.({ preventDefault() {} } as ErrorEvent);
    if (failure === 'message') broken.onmessageerror?.();
    if (failure === 'operation') broken.reply({ kind: 'import', result: {} } as MailReportWorkerResponse);
    if (failure === 'parser') broken.reply({ kind: 'error', detail: 'report invalid' });
    await pending;
    assert.equal(broken.terminated, 1);
  }
});

test('worker handler preserves parser errors and never interprets unsupported operations as success', async () => {
  assert.deepEqual(await runMailReportWorkerOperation({ kind: 'unknown' } as unknown as MailReportWorkerRequest), { kind: 'error', detail: 'The mail report operation is unsupported.' });
  const malformed = await runMailReportWorkerOperation({ kind: 'import', files: [{ name: 'bad.xml', bytes: new TextEncoder().encode('<feedback/>') }], retained: [], officialDomains: [] });
  assert.equal(malformed.kind, 'error');
  if (malformed.kind === 'error') assert.match(malformed.detail, /feedback root/u);
});

test('the populated current mail fixture has independent coverage, scope and integrity expectations', async () => {
  const current = JSON.parse(readFileSync(new URL('./fixtures/extracted-domain-lifecycle/mail-report-review-v3.json', import.meta.url), 'utf8'));
  assert.equal(current.version, 3);
  assert.deepEqual(Object.keys(current).sort(), ['generatedAt', 'integrity', 'limitations', 'profileScope', 'reports', 'schema', 'summary', 'version']);
  assert.equal(current.reports.length, 1);
  assert.equal(current.reports[0].records[0].count, 3);
  assert.deepEqual(current.reports[0].recordCoverage, { supplied: 1, inspected: 1, retained: 1, rejected: 0 });
  assert.equal(current.profileScope.state, 'complete');
  assert.deepEqual(current.profileScope.outsideScopeDomains, []);
  const { integrity, ...unsigned } = current;
  assert.equal(integrity.canonicalization, 'sorted-json-v2');
  assert.equal(integrity.digestSha256, await sha256ArtifactDigestV2(unsigned));
  assert.deepEqual(await buildMailReportReview(current.reports, ['mail.example'], current.generatedAt), current);
  const historic = readFileSync(new URL('./fixtures/extracted-domain-lifecycle/mail-report-review-v1.json', import.meta.url), 'utf8');
  assert.equal(JSON.parse(historic).version, 1);
  const previous = JSON.parse(readFileSync(new URL('./fixtures/extracted-domain-lifecycle/mail-report-review-v2.json', import.meta.url), 'utf8'));
  const { integrity: oldIntegrity, ...oldUnsigned } = previous;
  assert.equal(oldIntegrity.canonicalization, undefined);
  assert.equal(oldIntegrity.digestSha256, await sha256ArtifactDigest(oldUnsigned));
});

test('native mail worker bootstrap accepts exactly one operation', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'self');
  const replies: MailReportWorkerResponse[] = [];
  const scope: { postMessage: (value: MailReportWorkerResponse) => void; onmessage?: (event: MessageEvent<MailReportWorkerRequest>) => void } = { postMessage: (value) => replies.push(value) };
  Object.defineProperty(globalThis, 'self', { configurable: true, value: scope });
  try {
    await import('../frontend/src/lib/workers/mail-report.worker.ts');
    assert.equal(typeof scope.onmessage, 'function');
    scope.onmessage?.(new MessageEvent('message', { data: { kind: 'unknown' } as unknown as MailReportWorkerRequest }));
    scope.onmessage?.(new MessageEvent('message', { data: request }));
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(replies, [{ kind: 'error', detail: 'The mail report operation is unsupported.' }]);
  } finally { if (original) Object.defineProperty(globalThis, 'self', original); else Reflect.deleteProperty(globalThis, 'self'); }
});
