import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { richBulkSessionStore, richSourceQualifiedBulkSessionStore } from './bulk-session-fixture.mts';
import { boundedJsonLimitsForBytes, parseBoundedJson } from '../lib/bounded-json.mts';
import { localDataStorageRecords, plaintextJsonCodec } from '../frontend/src/lib/browser-local-data.ts';
import { BULK_SESSIONS_COLLECTION } from '../frontend/src/lib/browser-local-data-definitions.ts';
import {
  MAX_BULK_SESSION_STORE_BYTES,
  normalizeBulkSessionStore,
  serializeBulkSessionStore,
  enforceBulkSessionStoreBudget,
  buildBulkSessionExport,
  mergeBulkSessions,
} from '../packages/workspace/bulk-session-model.mts';
import { assertWorkspaceInputGraph } from '../packages/workspace/hostile-input.mts';
import { buildWorkspaceArchive, readWorkspaceArchive, MAX_WORKSPACE_ARCHIVE_BYTES } from '../packages/workspace/workspace-archive.mts';
import { encryptWorkspaceArchive, decryptWorkspaceArchive } from '../packages/workspace/workspace-archive-crypto.mts';
import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';
import { inspectWorkspaceArchive } from '../cli/archive-inspect.mts';
import { canonicalBulkTargets } from '../frontend/src/lib/analysis/bulk-scan-normalizer.ts';

test('rich Bulk records share write, codec and collection-read admission through 2,000 rows', async (t) => {
  for (const count of [847, 848, 1_922, 2_000]) {
    const start = performance.now();
    const store = normalizeBulkSessionStore(richBulkSessionStore(count));
    assert.equal(store.sessions.length, 1);
    assert.equal(store.sessions[0]?.results.length, count);
    assert.deepEqual(canonicalBulkTargets(store.sessions[0]!.domains), store.sessions[0]?.domains);
    const serialized = serializeBulkSessionStore(store);
    assert.ok(Buffer.byteLength(serialized) < MAX_BULK_SESSION_STORE_BYTES);
    assert.deepEqual(enforceBulkSessionStoreBudget(store), { store, pruned: 0 });
    const records = await Promise.all(localDataStorageRecords(BULK_SESSIONS_COLLECTION, store.sessions).map(async ({ id, value }) => {
      const encoded = await plaintextJsonCodec.encode({
        collection: BULK_SESSIONS_COLLECTION.id, id, value, maximumBytes: BULK_SESSIONS_COLLECTION.maximumBytes,
      });
      return plaintextJsonCodec.decode({
        collection: BULK_SESSIONS_COLLECTION.id, ...encoded, maximumBytes: BULK_SESSIONS_COLLECTION.maximumBytes,
      });
    }));
    const restored = BULK_SESSIONS_COLLECTION.normalize(BULK_SESSIONS_COLLECTION.join(records, store.version));
    assert.deepEqual(restored, store.sessions);
    assert.equal(BULK_SESSIONS_COLLECTION.serialize(restored), serialized);
    const portable = buildBulkSessionExport(store, '2026-08-01T00:00:00.000Z');
    const imported = mergeBulkSessions([], portable);
    assert.equal(imported.added, 1);
    assert.equal(imported.skipped, 0);
    assert.equal(imported.sessions[0]?.results.length, count);
    assert.deepEqual(imported.sessions[0]?.results.map((row) => row.domain), store.sessions[0]?.domains);
    assert.equal(imported.sessions[0]?.results.at(-1)?.hasDmarc, true);
    t.diagnostic(JSON.stringify({ rows: count, bytes: Buffer.byteLength(serialized), durationMs: performance.now() - start }));
  }
});

test('source-qualified rich Bulk backups retain all 2,000 rows through quarantine, codecs and both offline archive readers', async (t) => {
  const start = performance.now();
  const store = richSourceQualifiedBulkSessionStore();
  const archive = await buildWorkspaceArchive({ bulkSessions: store.sessions }, { generatedAt: '2026-08-01T00:00:00.000Z' });
  const raw = JSON.stringify(archive);
  assert.ok(Buffer.byteLength(raw) < MAX_WORKSPACE_ARCHIVE_BYTES);
  const parsed = parseBoundedJson(raw, { maximumBytes: MAX_WORKSPACE_ARCHIVE_BYTES, limits: boundedJsonLimitsForBytes(MAX_WORKSPACE_ARCHIVE_BYTES) });
  const read = await readWorkspaceArchive(parsed);
  const bulk = read.sections.find((section) => section.id === 'bulkSessions');
  assert.ok(bulk);
  const imported = mergeBulkSessions([], bulk.data);
  assert.equal(imported.sessions[0]?.results.length, 2_000);
  const importedBytes = Buffer.byteLength(serializeBulkSessionStore(imported.sessions));
  assert.ok(importedBytes < MAX_BULK_SESSION_STORE_BYTES);
  const records = await Promise.all(localDataStorageRecords(BULK_SESSIONS_COLLECTION, imported.sessions).map(async ({ id, value }) => {
    const encoded = await plaintextJsonCodec.encode({ collection: 'bulk_sessions', id, value, maximumBytes: MAX_BULK_SESSION_STORE_BYTES });
    return plaintextJsonCodec.decode({ collection: 'bulk_sessions', ...encoded, maximumBytes: MAX_BULK_SESSION_STORE_BYTES });
  }));
  const restored = BULK_SESSIONS_COLLECTION.normalize(BULK_SESSIONS_COLLECTION.join(records, store.version));
  assert.deepEqual(restored, imported.sessions);
  for (const row of restored[0]!.results) {
    assert.equal(row.profileContext.sourceState, 'unavailable');
    assert.equal(row.risk, null);
    assert.equal(row.observedAt, '2026-08-01T01:00:00.000Z');
    assert.equal(row.relationship.sourceEvidence.certificate?.[0]?.status, 'partial');
    assert.equal(row.relationship.sourceEvidence.certificate?.[0]?.complete, false);
  }
  const passphrase = 'Example local archive passphrase';
  const encrypted = await encryptWorkspaceArchive(archive, passphrase);
  const decrypted = await decryptWorkspaceArchive(encrypted, passphrase);
  assert.deepEqual(decrypted, archive);
  const verified = await verifyOfflineArtifact(raw);
  assert.equal(verified.checks.structure, 'verified');
  assert.equal(verified.checks.contentIntegrity, 'verified');
  const inspected = await inspectWorkspaceArchive(raw);
  assert.equal(inspected.sections.find((section) => section.id === 'bulkSessions')?.recordCount, 1);
  t.diagnostic(JSON.stringify({ rows: 2_000, importedBytes, archiveBytes: Buffer.byteLength(raw), durationMs: performance.now() - start }));
});

test('the unchanged Bulk byte boundary accepts exactly 4 MiB and rejects the next byte without pruning the only session', async () => {
  const store = normalizeBulkSessionStore(richBulkSessionStore());
  const session = store.sessions[0]!;
  let remaining = MAX_BULK_SESSION_STORE_BYTES - Buffer.byteLength(serializeBulkSessionStore(store));
  // All additions fit the existing per-field bounds. No production limit or
  // normaliser is replaced to construct the exact serialized boundary.
  for (const field of ['error', 'registrar', 'activity', 'pageTitle'] as const) {
    for (const row of session.results) {
      const added = Math.min(250 - (row[field]?.length ?? 0), remaining);
      row[field] = `${row[field] ?? ''}${'x'.repeat(added)}`;
      remaining -= added;
    }
  }
  assert.equal(remaining, 0);
  assert.equal(Buffer.byteLength(serializeBulkSessionStore(store)), MAX_BULK_SESSION_STORE_BYTES);
  assert.equal(enforceBulkSessionStoreBudget(store).pruned, 0);
  const wireRecord = localDataStorageRecords(BULK_SESSIONS_COLLECTION, [session])[0]!;
  const encoded = await plaintextJsonCodec.encode({ collection: 'bulk_sessions', ...wireRecord, maximumBytes: MAX_BULK_SESSION_STORE_BYTES });
  const decoded = await plaintextJsonCodec.decode({ collection: 'bulk_sessions', ...encoded, maximumBytes: MAX_BULK_SESSION_STORE_BYTES });
  assert.deepEqual(BULK_SESSIONS_COLLECTION.normalize(BULK_SESSIONS_COLLECTION.join([decoded], store.version)), [session]);
  session.results[0]!.error += 'x';
  const before = JSON.stringify(store);
  assert.equal(Buffer.byteLength(serializeBulkSessionStore(store)), MAX_BULK_SESSION_STORE_BYTES + 1);
  assert.throws(() => enforceBulkSessionStoreBudget(store), /exceeds the 4 MiB/);
  assert.equal(JSON.stringify(store), before);
});

test('byte-budgeted graph admission keeps hostile and aggregate-work limits', () => {
  const options = { maximumBytes: 128 };
  const source = { nested: [{ retained: true }] };
  assert.doesNotThrow(() => assertWorkspaceInputGraph(source, 'Fixture', options));
  assert.throws(() => assertWorkspaceInputGraph({ text: 'x'.repeat(129) }, 'Fixture', options), /string ceiling/);
  assert.throws(() => assertWorkspaceInputGraph(Array(65).fill(0), 'Fixture', options), /value ceiling/);
  assert.throws(() => assertWorkspaceInputGraph(Object.fromEntries(Array.from({ length: 26 }, (_, index) => [String(index), 0])), 'Fixture', options), /key ceiling/);
  const accessor = Object.defineProperty({}, 'value', { enumerable: true, get() { throw new Error('must not execute'); } });
  for (const [value, message] of [[accessor, /accessor/], [Array(2), /sparse/], [new Date(), /prototype/]] as const) {
    assert.throws(() => assertWorkspaceInputGraph(value, 'Fixture', options), message);
  }
});

test('whole-session eviction uses exact compact bytes and preserves the newest complete session', () => {
  const oldest = richBulkSessionStore().sessions[0]!;
  const newest = { ...structuredClone(oldest), id: 'newest', updatedAt: '2026-08-02T00:00:00.000Z' };
  const input = [oldest, newest];
  const before = structuredClone(input);
  assert.ok(Buffer.byteLength(serializeBulkSessionStore(input)) > MAX_BULK_SESSION_STORE_BYTES);
  const result = enforceBulkSessionStoreBudget(input);
  assert.equal(result.pruned, 1);
  assert.deepEqual(result.store.sessions.map(({ id }) => id), ['newest']);
  assert.equal(result.store.sessions[0]?.results.length, 2_000);
  assert.ok(Buffer.byteLength(serializeBulkSessionStore(result.store)) <= MAX_BULK_SESSION_STORE_BYTES);
  assert.deepEqual(input, before);
});
