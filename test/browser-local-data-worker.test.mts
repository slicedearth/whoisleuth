import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createCase } from '../packages/cases/case-model.mts';
import { richBulkSessionStore } from './bulk-session-fixture.mts';
import { BROWSER_LOCAL_COLLECTIONS, BULK_SESSIONS_COLLECTION, CASES_COLLECTION } from '../frontend/src/lib/browser-local-data-definitions.ts';
import {
  BrowserLocalDataError, decodeLocalDataSnapshots, localDataStorageRecords, plaintextJsonCodec,
  type AnyLocalDataCollectionDefinition, type BrowserLocalStoredRecord, type CapturedLocalDataCollection,
} from '../frontend/src/lib/browser-local-data.ts';
import { decodeBrowserLocalDataSnapshots } from '../frontend/src/lib/browser-local-data-worker.ts';
import { decodeLocalDataWorkerRequest, type LocalDataDecodeRequest, type LocalDataDecodeResponse } from '../frontend/src/lib/browser-local-data-worker-model.ts';
import { BROWSER_WORKER_OPERATION_TIMEOUT_MS } from '../frontend/src/lib/browser-worker-operation.ts';

const NOW = '2026-09-01T00:00:00.000Z';
const cases = [createCase({ domain: 'retained.example', evidencePin: {
  label: 'Source fact', value: 'Independent retained value', source: 'whois', observedAt: null,
} }, NOW)];

function recordDigest(records: readonly BrowserLocalStoredRecord[]): string {
  return createHash('sha256').update(JSON.stringify(records.map((record) => [record.lookupKey, record.ordinal, record.codec, record.payload, record.payloadBytes]))).digest('base64url');
}

function capture(definition: AnyLocalDataCollectionDefinition, input = definition.empty()): CapturedLocalDataCollection {
  const document = definition.normalize(input);
  const records = localDataStorageRecords(definition, document).map((record, ordinal) => {
    const payload = JSON.stringify({ id: record.id, value: record.value });
    return {
      key: [definition.id, record.id] as [string, string], collection: definition.id, lookupKey: record.id,
      ordinal, codec: 'json-v1', payload, payloadBytes: Buffer.byteLength(payload),
    };
  });
  return {
    records,
    manifest: {
      collection: definition.id, schemaVersion: definition.schemaVersion, codec: 'json-v1', revision: 3,
      recordCount: records.length, serializedBytes: Buffer.byteLength(definition.serialize(document)),
      digest: recordDigest(records),
      source: 'application', updatedAt: NOW, legacyKey: definition.legacyKey, legacyDigest: null,
    },
  };
}

class ControlledWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  messages: LocalDataDecodeRequest[] = [];
  terminated = 0;
  private markPosted!: () => void;
  readonly posted = new Promise<void>((resolve) => { this.markPosted = resolve; });
  postMessage(value: LocalDataDecodeRequest) { this.messages.push(structuredClone(value)); this.markPosted(); }
  terminate() { this.terminated += 1; }
  reply(value: unknown) { this.onmessage?.(new MessageEvent('message', { data: value })); }
  factory = () => this as unknown as Worker;
}

const largeCapturedCollection = capture(BULK_SESSIONS_COLLECTION, richBulkSessionStore(1_100));
const largeDocument = BULK_SESSIONS_COLLECTION.normalize(richBulkSessionStore(1_100));

test('worker reconstruction preserves complete current collections, unknown source clocks and independent digest identity', async () => {
  const inputs = BROWSER_LOCAL_COLLECTIONS.map((definition) => capture(definition,
    definition.id === 'cases' ? cases : definition.id === 'bulk_sessions' ? richBulkSessionStore(20) : definition.empty()));
  const before = structuredClone(inputs);
  const response = await decodeLocalDataWorkerRequest({ captured: inputs });
  assert.equal(response.kind, 'decoded');
  if (response.kind !== 'decoded') throw new Error('Expected verified documents.');
  const reconstructedCases = response.documents.find((item) => item.collection === 'cases')!.document;
  assert.deepEqual(reconstructedCases, CASES_COLLECTION.normalize(cases));
  assert.equal((reconstructedCases as typeof cases)[0]!.evidencePins[0]!.observedAt, null);
  assert.equal((reconstructedCases as typeof cases)[0]!.evidencePins[0]!.value, 'Independent retained value');
  const bulk = BULK_SESSIONS_COLLECTION.normalize(response.documents.find((item) => item.collection === 'bulk_sessions')!.document);
  assert.equal(bulk[0]!.results.length, 20);
  assert.deepEqual(inputs, before);
  assert.deepEqual(response.documents.map((item) => item.collection), BROWSER_LOCAL_COLLECTIONS.map((definition) => definition.id));
});

test('worker integrity failures remain distinct from empty results and never disclose record contents', async () => {
  const original = capture(CASES_COLLECTION, cases);
  const variants: Array<[string, CapturedLocalDataCollection, string]> = [
    ['digest', { ...original, manifest: { ...original.manifest, digest: createHash('sha256').update('different').digest('base64url') } }, 'LOCAL_DATA_INTEGRITY'],
    ['bytes', { ...original, manifest: { ...original.manifest, serializedBytes: original.manifest.serializedBytes + 1 } }, 'LOCAL_DATA_INTEGRITY'],
    ['future', { ...original, manifest: { ...original.manifest, schemaVersion: CASES_COLLECTION.schemaVersion + 1 } }, 'LOCAL_DATA_FUTURE_SCHEMA'],
    ['count', { ...original, manifest: { ...original.manifest, recordCount: 0 } }, 'LOCAL_DATA_INTEGRITY'],
    ['codec', { ...original, manifest: { ...original.manifest, codec: 'other-v1' } }, 'LOCAL_DATA_INTEGRITY'],
    ['unknown', { ...original, manifest: { ...original.manifest, collection: 'unregistered' } }, 'LOCAL_DATA_INTEGRITY'],
    ['record', { ...original, records: [{ ...original.records[0]!, payload: '{private-record-content' }] }, 'LOCAL_DATA_INTEGRITY'],
    ['bound', { ...original, records: [{ ...original.records[0]!, payloadBytes: CASES_COLLECTION.maximumBytes * 2 + 1 }] }, 'LOCAL_DATA_INTEGRITY'],
  ];
  for (const [name, captured, code] of variants) {
    const result = await decodeLocalDataWorkerRequest({ captured: [captured] });
    assert.equal(result.kind, 'error', name);
    if (result.kind !== 'error') throw new Error(name);
    assert.equal(result.code, code, name);
    assert.doesNotMatch(JSON.stringify(result), /retained\.example|Independent retained value|private-record-content/u);
  }
  for (const captured of [[], [original, original], Array(17).fill(original)]) {
    assert.equal((await decodeLocalDataWorkerRequest({ captured })).kind, 'error');
  }
  assert.equal((await decodeLocalDataWorkerRequest(null as unknown as LocalDataDecodeRequest)).kind, 'error');
});

test('a matching digest cannot legitimise repeated record ordinals or mismatched collection metadata', async () => {
  const original = capture(CASES_COLLECTION, [...cases, createCase({ domain: 'second.example' }, NOW)]);
  assert.equal(original.records.length, 2);
  for (const changed of [
    { ...original.records[1]!, ordinal: original.records[0]!.ordinal },
    { ...original.records[1]!, collection: 'other' },
    { ...original.records[1]!, payloadBytes: original.records[1]!.payloadBytes - 1 },
  ]) {
    const records = [original.records[0]!, changed];
    const result = await decodeLocalDataWorkerRequest({ captured: [{ ...original, records, manifest: { ...original.manifest, digest: recordDigest(records) } }] });
    assert.equal(result.kind, 'error');
    if (result.kind !== 'error') throw new Error('Invalid record metadata must remain unavailable.');
    assert.equal(result.code, 'LOCAL_DATA_INTEGRITY');
    assert.doesNotMatch(result.detail, /digest|manifest/u);
  }
});

test('browser decoder sends function-free captured bytes and accepts only the exact ordered collection set', async () => {
  const captured = [structuredClone(largeCapturedCollection)];
  const worker = new ControlledWorker();
  const pending = decodeBrowserLocalDataSnapshots([BULK_SESSIONS_COLLECTION], captured, plaintextJsonCodec, { createWorker: worker.factory });
  await worker.posted;
  assert.deepEqual(worker.messages, [{ captured }]);
  worker.reply(await decodeLocalDataWorkerRequest(worker.messages[0]!));
  assert.deepEqual(await pending, [largeDocument]);
  assert.equal(worker.terminated, 1);
  assert.equal(worker.onmessage, null);
  assert.equal(worker.onerror, null);
  assert.equal(worker.onmessageerror, null);
  for (const response of [null, { kind: 'decoded', documents: [] }, { kind: 'decoded', documents: [{ collection: 'other', document: [] }] }, { kind: 'decoded', documents: [{ collection: 'bulk_sessions' }] }, { kind: 'decoded', documents: [{ collection: 'bulk_sessions', document: null }] }, { kind: 'decoded', documents: [{ collection: 'bulk_sessions', document: 'invalid' }] }]) {
    const invalid = new ControlledWorker();
    const rejected = assert.rejects(decodeBrowserLocalDataSnapshots([BULK_SESSIONS_COLLECTION], captured, plaintextJsonCodec, { createWorker: invalid.factory }),
      (cause: unknown) => cause instanceof BrowserLocalDataError && cause.code === 'LOCAL_DATA_INTEGRITY');
    await invalid.posted; invalid.reply(response); await rejected;
    assert.equal(invalid.terminated, 1);
  }
});

test('small collections, custom definitions and custom codecs retain the local owning decoder', async () => {
  let created = 0;
  const options = { createWorker: () => { created += 1; throw new Error('Unexpected worker.'); } };
  assert.deepEqual(await decodeBrowserLocalDataSnapshots([CASES_COLLECTION], [capture(CASES_COLLECTION)], plaintextJsonCodec, options), [[]]);
  assert.deepEqual(await decodeBrowserLocalDataSnapshots([CASES_COLLECTION], [capture(CASES_COLLECTION, cases)], plaintextJsonCodec, options), [CASES_COLLECTION.normalize(cases)]);
  const custom = { ...BULK_SESSIONS_COLLECTION };
  assert.deepEqual(await decodeBrowserLocalDataSnapshots([custom], [structuredClone(largeCapturedCollection)], plaintextJsonCodec, options), [largeDocument]);
  let decoded = 0;
  const codec = { ...plaintextJsonCodec, decode: async (input: Parameters<typeof plaintextJsonCodec.decode>[0]) => { decoded += 1; return plaintextJsonCodec.decode(input); } };
  assert.deepEqual(await decodeBrowserLocalDataSnapshots([BULK_SESSIONS_COLLECTION], [structuredClone(largeCapturedCollection)], codec, options), [largeDocument]);
  assert.equal(decoded, 1);
  assert.equal(created, 0);
  // Node has no browser Worker; absence preserves the established local path.
  assert.equal(typeof Worker, 'undefined');
  assert.deepEqual(await decodeBrowserLocalDataSnapshots([BULK_SESSIONS_COLLECTION], [structuredClone(largeCapturedCollection)], plaintextJsonCodec), [largeDocument]);
});

test('worker load, deadline, cancellation and integrity failures remain explicit and release the worker', async (context) => {
  const captured = [structuredClone(largeCapturedCollection)];
  await assert.rejects(decodeBrowserLocalDataSnapshots([BULK_SESSIONS_COLLECTION], captured, plaintextJsonCodec, {
    createWorker: () => { throw new Error('private-environment-path'); },
  }), (cause: unknown) => cause instanceof BrowserLocalDataError && cause.code === 'LOCAL_DATA_READ_FAILED' && !cause.message.includes('private'));
  context.mock.timers.enable({ apis: ['setTimeout'] });
  for (const mode of ['timeout', 'abort', 'error', 'message', 'integrity'] as const) {
    const worker = new ControlledWorker();
    const signal = new AbortController();
    const rejected = assert.rejects(decodeBrowserLocalDataSnapshots([BULK_SESSIONS_COLLECTION], captured, plaintextJsonCodec, { createWorker: worker.factory, signal: signal.signal }),
      (cause: unknown) => mode === 'abort'
        ? cause instanceof DOMException && cause.name === 'AbortError'
        : cause instanceof BrowserLocalDataError && cause.code === (mode === 'integrity' ? 'LOCAL_DATA_INTEGRITY' : 'LOCAL_DATA_READ_FAILED'));
    await worker.posted;
    if (mode === 'timeout') context.mock.timers.tick(BROWSER_WORKER_OPERATION_TIMEOUT_MS);
    if (mode === 'abort') signal.abort();
    if (mode === 'error') worker.onerror?.({ preventDefault() {} } as ErrorEvent);
    if (mode === 'message') worker.onmessageerror?.();
    if (mode === 'integrity') worker.reply({ kind: 'error', code: 'LOCAL_DATA_INTEGRITY', detail: 'Stored records failed integrity verification.' });
    await rejected;
    assert.equal(worker.terminated, 1, mode);
  }
});

test('native storage worker runs only one request and shares the pure decoder', async () => {
  const captured = [capture(CASES_COLLECTION, cases)];
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'self');
  const replies: LocalDataDecodeResponse[] = [];
  let responded!: () => void;
  const response = new Promise<void>((resolve) => { responded = resolve; });
  const scope: { postMessage: (value: LocalDataDecodeResponse) => void; onmessage?: (event: MessageEvent<LocalDataDecodeRequest>) => void } = {
    postMessage: (value) => { replies.push(value); responded(); },
  };
  Object.defineProperty(globalThis, 'self', { configurable: true, value: scope });
  try {
    await import('../frontend/src/lib/workers/browser-local-data.worker.ts');
    assert.equal(typeof scope.onmessage, 'function');
    scope.onmessage?.(new MessageEvent('message', { data: { captured } }));
    scope.onmessage?.(new MessageEvent('message', { data: { captured: [] } }));
    await response;
    const documents = await decodeLocalDataSnapshots([CASES_COLLECTION], captured, plaintextJsonCodec);
    assert.deepEqual(replies, [{ kind: 'decoded', documents: [{ collection: 'cases', document: documents[0] }] }]);
  } finally { if (descriptor) Object.defineProperty(globalThis, 'self', descriptor); else Reflect.deleteProperty(globalThis, 'self'); }
});
