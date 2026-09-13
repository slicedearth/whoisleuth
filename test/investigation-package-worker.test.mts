import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInvestigationPackageOperation, assertInvestigationFileSelection, type InvestigationPackageRequest } from '../frontend/src/lib/investigation-package-worker-model.ts';
import { runInvestigationPackageWorker } from '../frontend/src/lib/investigation-package-worker.ts';
import { MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES, MAX_INVESTIGATION_MANIFEST_ARTIFACTS } from '../packages/investigation/investigation-manifest.mts';
import { inspectInvestigationPackage } from '../packages/investigation/investigation-package.mts';
import { buildLookupEvidence } from '../lib/evidence-export.mts';
import { lookupGraphCapacityFixture } from './lookup-graph-capacity-fixture.mts';

const NOW = '2026-09-11T00:00:00.000Z';
const request: InvestigationPackageRequest = { kind: 'build', input: { workflow: 'Evidence review', generatedAt: NOW, applicationVersion: '2.3.1', files: [
  { file: new Blob(['{"retained":"exactly"}\n']), mediaType: 'application/json', source: { identity: 'Declared source', observedAt: null } },
  { file: new Blob([new Uint8Array([0, 255, 128])]), mediaType: 'image/png', source: { identity: null, observedAt: null } },
] } };

class ControlledWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  messages: InvestigationPackageRequest[] = [];
  terminated = 0;
  postMessage(value: InvestigationPackageRequest) { this.messages.push(structuredClone(value)); }
  terminate() { this.terminated += 1; }
  reply(value: unknown) { this.onmessage?.(new MessageEvent('message', { data: value })); }
  factory = () => this as unknown as Worker;
}

test('BagIt worker builds a separately selected format and returns only validated download-only bytes', async () => {
  const built = await runInvestigationPackageOperation({ kind: 'bagitBuild', input: request.input });
  if (built.kind !== 'bagitBuild') assert.fail('Expected BagIt');
  const inspected = await runInvestigationPackageOperation({ kind: 'bagitInspect', input: { file: built.result.file } });
  if (inspected.kind !== 'bagitInspect') assert.fail('Expected BagIt review');
  assert.equal(inspected.result.review.state, 'valid');
  assert.equal(await inspected.result.contents.get('artifact-1')!.text(), '{"retained":"exactly"}\n');
  assert.equal(inspected.result.contents.get('artifact-2')!.type, 'application/octet-stream');
  assert.equal((await runInvestigationPackageOperation({ kind: 'inspect', input: { file: built.result.file } })).kind, 'error');
  const illegal = { kind: 'bagitBuild', input: { ...request.input, passphrase: 'fixture package passphrase' } } as InvestigationPackageRequest;
  assert.equal((await runInvestigationPackageOperation(illegal)).kind, 'error');
  const worker = new ControlledWorker(), abort = new AbortController();
  const pending = runInvestigationPackageWorker('bagitInspect', { file: built.result.file }, { createWorker: worker.factory, signal: abort.signal });
  const rejected = assert.rejects(pending, /cancelled/u); abort.abort(); await rejected; assert.equal(worker.terminated, 1);
});

test('package worker uses immutable file inputs and returns download-only verified blobs', async () => {
  const built = await runInvestigationPackageOperation(request);
  assert.equal(built.kind, 'build');
  if (built.kind !== 'build') assert.fail('Expected a built package.');
  const response = await runInvestigationPackageOperation({ kind: 'inspect', input: { file: built.result.file } });
  assert.equal(response.kind, 'inspect');
  if (response.kind !== 'inspect') assert.fail('Expected package review.');
  assert.equal(response.result.identityVerified, true);
  assert.equal(response.result.encryption, 'not_applicable');
  assert.equal(response.result.contents.size, 2);
  assert.equal(await response.result.contents.get('artifact-1')!.text(), '{"retained":"exactly"}\n');
  assert.deepEqual(new Uint8Array(await response.result.contents.get('artifact-2')!.arrayBuffer()), new Uint8Array([0, 255, 128]));
  assert.equal(response.result.contents.get('artifact-2')!.type, 'application/octet-stream');
  assert.equal(response.result.storageEffect, 'none');
  assert.equal(response.result.signatureTrust, 'not_checked');
});

test('encrypted worker builds authenticate before exposing exact files, with redacted failures and no downgrade', async () => {
  const passphrase = 'worker fixture package passphrase';
  const built = await runInvestigationPackageOperation({ ...request, input: { ...request.input, passphrase } });
  if (built.kind !== 'build') assert.fail('Expected an encrypted package.');
  assert.equal(built.result.file.type, 'application/octet-stream');
  for (const secret of [undefined, '', 'different fixture passphrase']) {
    const result = await runInvestigationPackageOperation({ kind: 'inspect', input: { file: built.result.file, ...(secret === undefined ? {} : { passphrase: secret }) } });
    assert.equal(result.kind, 'error');
    assert.doesNotMatch(JSON.stringify(result), /worker fixture|retained|Declared source|different fixture/u);
    assert.equal(Object.hasOwn(result, 'result'), false);
  }
  const result = await runInvestigationPackageOperation({ kind: 'inspect', input: { file: built.result.file, passphrase } });
  if (result.kind !== 'inspect') assert.fail('Expected authenticated review.');
  assert.equal(result.result.encryption, 'verified');
  assert.equal(await result.result.contents.get('artifact-1')!.text(), '{"retained":"exactly"}\n');
  assert.deepEqual([...new Uint8Array(await result.result.contents.get('artifact-2')!.arrayBuffer())], [0, 255, 128]);
  assert.equal(result.result.storageEffect, 'none');
  const plain = await runInvestigationPackageOperation(request);
  if (plain.kind !== 'build') assert.fail('Expected plaintext package.');
  assert.equal((await runInvestigationPackageOperation({ kind: 'inspect', input: { file: plain.result.file, passphrase } })).kind, 'error');
  assert.equal((await runInvestigationPackageOperation({ ...request, input: { ...request.input, passphrase: '' } })).kind, 'error');
  assert.equal((await runInvestigationPackageOperation({ kind: 'folder', input: { ...request.input, passphrase } } as InvestigationPackageRequest)).kind, 'error');
});

test('package worker rejects ambiguous encryption status before showing a review', async () => {
  const built = await runInvestigationPackageOperation(request);
  if (built.kind !== 'build') assert.fail('Expected a package.');
  const reviewed = await runInvestigationPackageOperation({ kind: 'inspect', input: { file: built.result.file } });
  if (reviewed.kind !== 'inspect') assert.fail('Expected review.');
  const worker = new ControlledWorker();
  const pending = runInvestigationPackageWorker('inspect', { file: built.result.file }, { createWorker: worker.factory });
  const failure = assert.rejects(pending, /unexpected result/u);
  worker.reply({ ...reviewed, result: { ...reviewed.result, encryption: 'maybe' } });
  await failure;
  assert.equal(worker.terminated, 1);
});

test('worker capsules include the actual Lookup source and preserve source clocks without inventing an aggregate clock', async () => {
  const retained = JSON.parse(readFileSync(new URL('./fixtures/investigation-portability/investigation-capsule-v4.json', import.meta.url), 'utf8'));
  const lookupEvidence = buildLookupEvidence(lookupGraphCapacityFixture(), { generatedAt: NOW, applicationVersion: '2.3.1' });
  const response = await runInvestigationPackageOperation({ kind: 'capsule', input: { generatedAt: NOW, capsule: {
    applicationVersion: '2.3.1', lookupEvidence, brief: retained.investigationBrief, graph: retained.graphSnapshot,
  } } });
  assert.equal(response.kind, 'capsule');
  if (response.kind !== 'capsule') assert.fail('Expected a capsule package.');
  const inspected = await inspectInvestigationPackage(new Uint8Array(await response.result.file.arrayBuffer()));
  assert.deepEqual(inspected.links, [{ capsuleEntryId: 'artifact-1', sourceEntryId: 'artifact-2', state: 'linked' }]);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(inspected.contents.get('artifact-2'))), lookupEvidence);
  assert.ok(response.result.manifest.artifacts.every(item => item.source.observedAt === null));
});

test('worker admission checks every file before reading, rejects excess and does not echo source content in failures', async () => {
  let reads = 0;
  const file = new Blob(['private source value']);
  Object.defineProperty(file, 'arrayBuffer', { value: () => { reads++; throw new Error('private source value'); } });
  const oversized = new Blob(['x']);
  Object.defineProperty(oversized, 'size', { value: MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES + 1 });
  const invalid = { ...request, input: { ...request.input, files: [{ ...request.input.files[0]!, file }, { ...request.input.files[0]!, file: oversized }] } };
  const result = await runInvestigationPackageOperation(invalid);
  assert.equal(result.kind, 'error');
  assert.equal(reads, 0);
  assert.doesNotMatch(JSON.stringify(result), /private source value/u);
  assert.throws(() => assertInvestigationFileSelection([]), /Select/u);
  assert.throws(() => assertInvestigationFileSelection(Array.from({ length: MAX_INVESTIGATION_MANIFEST_ARTIFACTS + 1 }, () => request.input.files[0]!)), /Select/u);
  assert.equal((await runInvestigationPackageOperation({ kind: 'inspect', input: { file: new Blob(['not a zip']) } })).kind, 'error');
});

test('package worker cancellation, mismatched replies and teardown use the shared operation contract', async () => {
  const built = await runInvestigationPackageOperation(request);
  for (const phase of ['before', 'posted', 'reply', 'mismatch'] as const) {
    const worker = new ControlledWorker();
    const controller = new AbortController();
    if (phase === 'before') controller.abort();
    const pending = runInvestigationPackageWorker('build', request.input, { signal: controller.signal, createWorker: worker.factory });
    if (phase === 'reply') { worker.reply(built); assert.ok((await pending).file instanceof Blob); }
    else {
      const rejected = assert.rejects(pending, phase === 'mismatch' ? /unexpected result/u : { name: 'AbortError' });
      if (phase === 'posted') controller.abort();
      if (phase === 'mismatch') worker.reply({ kind: 'inspect', result: {} });
      await rejected;
    }
    assert.equal(worker.terminated, phase === 'before' ? 0 : 1);
    assert.equal(worker.onmessage, null);
    assert.equal(worker.onerror, null);
    assert.equal(worker.onmessageerror, null);
    if (phase !== 'before') assert.equal(worker.messages.length, 1);
  }
});
