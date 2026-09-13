import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createBrowserWorkspaceCopy, prepareBrowserWorkspaceCopy } from '../frontend/src/lib/browser-workspace-copy.ts';
import { BROWSER_LOCAL_COLLECTIONS, CASES_COLLECTION } from '../frontend/src/lib/browser-local-data-definitions.ts';
import type { AnyLocalDataCollectionDefinition, BrowserLocalDataBatchUpdateOptions, LocalDataCollectionDefinition } from '../frontend/src/lib/browser-local-data.ts';
import { createCase } from '../packages/cases/case-model.mts';
import { sha256ArtifactBytes } from '../packages/evidence/artifact-integrity.mts';
import { verifyRetainedFile, type RetainedFileReference } from '../packages/evidence/retained-file.mts';

const NOW = '2026-09-13T00:00:00.000Z';
const owners = BROWSER_LOCAL_COLLECTIONS as readonly AnyLocalDataCollectionDefinition[];
function memory(initial = new Map<string, unknown>(), originals = new Map<string, Blob>()) {
  const documents = structuredClone(initial), files = new Map(originals);
  let writes = 0;
  const hooks: { beforeRead?: () => void; afterWrite?: () => void; beforeWrite?: () => void; beforeFiles?: () => Promise<void> } = {};
  const batches: number[] = [];
  return {
    documents, files, hooks, batches, get writes() { return writes; },
    async initialize(definitions: readonly AnyLocalDataCollectionDefinition[]) { for (const definition of definitions) if (!documents.has(definition.id)) documents.set(definition.id, definition.empty()); },
    async readMany(definitions: readonly AnyLocalDataCollectionDefinition[]) {
      hooks.beforeRead?.();
      return structuredClone(new Map(definitions.map(definition => {
        if (!documents.has(definition.id)) throw new Error('Missing collection.');
        return [definition.id, documents.get(definition.id)];
      })));
    },
    async readFiles<T>(definition: LocalDataCollectionDefinition<T>, references: readonly RetainedFileReference[]) {
      await hooks.beforeFiles?.();
      assert.ok(references.length <= 128); assert.ok(references.reduce((sum, file) => sum + file.byteLength, 0) <= 64 * 1024 * 1024);
      batches.push(references.length);
      const result = new Map<string, Blob | null>();
      for (const reference of references) {
        const file = files.get(`${definition.id}:${reference.digestSha256}`) ?? null;
        if (file) await verifyRetainedFile(reference, file);
        result.set(reference.digestSha256, file);
      }
      return result;
    },
    async updateMany<Result>(definitions: readonly AnyLocalDataCollectionDefinition[], change: (current: ReadonlyMap<string, unknown>) => Readonly<{ documents: ReadonlyMap<string, unknown>; result: Result }>, options: BrowserLocalDataBatchUpdateOptions = {}) {
      hooks.beforeWrite?.();
      const result = change(structuredClone(new Map(definitions.map(definition => [definition.id, documents.get(definition.id)]))));
      for (const definition of definitions) documents.set(definition.id, structuredClone(definition.normalize(result.documents.get(definition.id))));
      for (const [collection, inputs] of options.files ?? []) for (const input of inputs) { await verifyRetainedFile(input.reference, input.file); files.set(`${collection}:${input.reference.digestSha256}`, input.file); }
      writes++; hooks.afterWrite?.(); return result.result;
    },
  };
}
async function fixture(count = 1) {
  const documents = new Map(owners.map(owner => [owner.id, owner.empty()]));
  const files = new Map<string, Blob>();
  const records = [createCase({ domain: 'copy-one.example' }, NOW), createCase({ domain: 'copy-two.example' }, NOW)];
  for (let index = 0; index < count; index++) {
    const bytes = new Uint8Array([index % 256, Math.floor(index / 256)]), digestSha256 = await sha256ArtifactBytes(bytes);
    const record = records[Math.floor(index / 128)]!;
    (record.attachments ??= []).push({ id: `file-${index}`, fileName: `original-${index}.bin`, mediaType: 'application/octet-stream', source: 'Retained fixture source', observedAt: null, retainedAt: NOW, digestSha256, byteLength: bytes.length });
    files.set(`cases:${digestSha256}`, new Blob([bytes]));
  }
  documents.set('cases', records);
  for (const [collection, file] of [['case_drafts', 'case-drafts-v1.json'], ['review_session', 'review-session-v1.json']]) {
    const owner = owners.find(owner => owner.id === collection)!;
    documents.set(collection!, owner.normalize(JSON.parse(readFileSync(new URL(`./fixtures/extracted-domain-lifecycle/${file}`, import.meta.url), 'utf8'))));
  }
  return memory(documents, files);
}
async function setup(count = 1) {
  const source = await fixture(count), destination = memory();
  let closed = 0, available = true;
  const copy = createBrowserWorkspaceCopy(await prepareBrowserWorkspaceCopy(source, owners), source, destination, {
    assertCurrent: async () => { if (!available) throw new Error('Destination changed.'); }, close: async () => { closed++; },
  });
  return { source, destination, copy, closed: () => closed, invalidate: () => { available = false; } };
}

test('a complete copy discovers every collection including recovery and carries more than one original-file batch', async () => {
  const { source, destination, copy, closed } = await setup(129);
  const before = structuredClone(source.documents);
  const result = await copy.copy();
  assert.equal(result.verified, true); assert.equal(result.files.verified, 129); assert.equal(result.files.missing, 0);
  assert.equal(result.collections.length, owners.length);
  assert.ok(result.collections.some(item => item.id === 'case_drafts' && item.records > 0));
  assert.ok(result.collections.some(item => item.id === 'review_session' && item.records > 0));
  for (const owner of owners) assert.equal(owner.serialize(destination.documents.get(owner.id)), owner.serialize(before.get(owner.id)));
  assert.ok(destination.batches.includes(128)); assert.ok(destination.batches.includes(1));
  assert.deepEqual(source.documents, before); assert.equal(source.writes, 0);
  await copy.close(); await copy.close(); assert.equal(closed(), 1);
});

test('missing originals remain explicit and only their immutable bytes are retried', async () => {
  const { source, destination, copy } = await setup(2);
  const [key, file] = [...source.files][0]!; source.files.delete(key);
  const first = await copy.copy(); assert.equal(first.verified, false); assert.equal(first.files.missing, 1);
  const afterMetadata = structuredClone(destination.documents), firstWrites = destination.writes;
  source.files.set(key, file);
  assert.equal((await copy.retryFiles()).verified, true); assert.equal(destination.writes, firstWrites + 1);
  assert.deepEqual(destination.documents, afterMetadata);
  const completed = destination.writes;
  assert.equal((await copy.retryFiles()).verified, true); assert.equal(destination.writes, completed);
  await assert.rejects(copy.copy(), /already attempted/); assert.equal(destination.writes, completed);
  await copy.close();
});

test('source changes before or after a write cannot become a current verified copy', async () => {
  const early = await setup();
  (early.source.documents.get('cases') as ReturnType<typeof createCase>[])[0]!.title = 'Changed before copying';
  await assert.rejects(early.copy.copy(), /source workspace/); assert.equal(early.destination.writes, 0); await early.copy.close();
  const late = await setup();
  await late.copy.copy();
  (late.source.documents.get('cases') as ReturnType<typeof createCase>[])[0]!.title = 'Changed after copying';
  const result = await late.copy.verify(); assert.equal(result.verified, false); assert.equal(result.sourceMatches, false);
  await assert.rejects(late.copy.retryFiles(), /source workspace/); await late.copy.close();
});

test('write failure and committed-write read failure have distinct outcomes and never repeat metadata', async () => {
  const failed = await setup();
  failed.destination.hooks.beforeWrite = () => { throw new Error('Write refused.'); };
  await assert.rejects(failed.copy.copy(), /Write refused/); assert.equal(failed.copy.writeState, 'unconfirmed'); assert.equal(failed.destination.writes, 0);
  delete failed.destination.hooks.beforeWrite;
  await assert.rejects(failed.copy.copy(), /already attempted/); await failed.copy.close();
  const committed = await setup();
  committed.destination.hooks.afterWrite = () => { committed.destination.hooks.beforeRead = () => { throw new Error('Read unavailable.'); }; };
  await assert.rejects(committed.copy.copy(), /Read unavailable/); assert.equal(committed.copy.writeState, 'committed'); assert.equal(committed.destination.writes, 1);
  delete committed.destination.hooks.afterWrite; delete committed.destination.hooks.beforeRead;
  assert.equal((await committed.copy.verify()).files.missing, 1);
  assert.equal((await committed.copy.retryFiles()).verified, true); assert.equal(committed.source.writes, 0); await committed.copy.close();
});

test('a changed destination or corrupted original stops copying without overwriting it', async () => {
  const changed = await setup(); await changed.copy.copy();
  (changed.destination.documents.get('cases') as ReturnType<typeof createCase>[])[0]!.title = 'Independent destination edit';
  await assert.rejects(changed.copy.retryFiles(), /Destination records/);
  assert.equal((await changed.copy.verify()).verified, false); await changed.copy.close();
  const corrupt = await setup();
  const key = [...corrupt.source.files.keys()][0]!; corrupt.source.files.set(key, new Blob(['wrong body']));
  await assert.rejects(corrupt.copy.copy(), /length|digest/); assert.equal(corrupt.destination.files.size, 0); await corrupt.copy.close();
  const identity = await setup(); identity.invalidate(); await assert.rejects(identity.copy.copy(), /Destination changed/); assert.equal(identity.destination.writes, 0); await identity.copy.close();
});

test('closing waits for the pending read, stops future writes and releases the destination once', async () => {
  const { source, destination, copy, closed } = await setup();
  let entered!: () => void, release!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  source.hooks.beforeFiles = async () => { entered(); await held; };
  const copying = copy.copy(); await reading;
  await assert.rejects(copy.verify(), /Finish the current/);
  const closing = copy.close(); assert.equal(closed(), 0); release();
  await assert.rejects(copying, /abort/iu); await closing;
  assert.equal(destination.writes, 1); assert.equal(destination.files.size, 0); assert.equal(closed(), 1);
  await assert.rejects(copy.retryFiles(), /Finish the current/);
});

test('a nonempty destination is never used as an overwrite target', async () => {
  const { destination, copy } = await setup();
  destination.documents.set('cases', [createCase({ domain: 'existing-destination.example' }, NOW)]);
  const before = CASES_COLLECTION.serialize(destination.documents.get('cases') as ReturnType<typeof createCase>[]);
  await assert.rejects(copy.copy(), /no longer empty/); assert.equal(destination.writes, 0);
  assert.equal(CASES_COLLECTION.serialize(destination.documents.get('cases') as ReturnType<typeof createCase>[]), before); await copy.close();
});
