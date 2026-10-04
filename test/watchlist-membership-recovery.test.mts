import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  normalizeWatchlistStore,
  buildWatchlistExport,
  mergeWatchlistStores,
  serializeWatchlistStore,
  serializeWatchlistExport,
  parseWatchlistExport,
  planWatchlistUpdate,
  applyReviewedWatchlistUpdate,
  planHostedWatchlistRestore,
  type WatchlistCollection,
} from '../packages/workspace/watchlist-store.mts';
import { watchlistActiveDomains } from '../packages/workspace/watchlist-history.mts';
import { MAX_WATCHLIST_STORE_BYTES, MAX_WATCHLIST_PORTABLE_BYTES, WATCHLIST_RECOVERY_METADATA_BYTES } from '../packages/contracts/workspace-portability.mts';
import { watchlistV5Boundary } from './helpers/watchlist-v5-boundary.mts';
import { createBrowserWorkspaceEncryption, unlockBrowserWorkspaceEncryption } from '../frontend/src/lib/browser-workspace-encryption.ts';
import { planCandidateWatchHandoff } from '../packages/workspace/candidate-watch-handoff.mts';
import { projectHostedWatchlistEntry } from '../packages/monitoring/scheduled-monitor-model.mts';
import { WATCHLISTS_COLLECTION } from '../frontend/src/lib/browser-local-data-definitions.ts';
import {
  decodeLocalDataSnapshots,
  prepareLocalDataContent,
  plaintextJsonCodec,
  type CapturedLocalDataCollection,
  type LocalDataCollectionDefinition,
} from '../frontend/src/lib/browser-local-data-content.ts';

const fixture = await readFile(
  new URL('./fixtures/workspace-lifecycle/watchlist-v5-membership-overflow.json', import.meta.url),
  'utf8',
);
const manifestBytes = await readFile(
  new URL(
    './fixtures/workspace-lifecycle/watchlist-v5-membership-overflow-manifest.json',
    import.meta.url,
  ),
  'utf8',
);
const old = JSON.parse(fixture);
const manifest = JSON.parse(manifestBytes);
const captured: CapturedLocalDataCollection = {
  manifest,
  records: Object.entries(old.watchlists).map(([id, value], ordinal) => {
    const payload = JSON.stringify({ id, value });
    return {
      key: ['watchlists', id],
      collection: 'watchlists',
      lookupKey: id,
      ordinal,
      codec: 'json-v1',
      payload,
      payloadBytes: Buffer.byteLength(payload),
    };
  }),
};

test('independent schema-5 writer bytes reconstruct cold without pruning or activating overflow membership', async () => {
  assert.equal(
    createHash('sha256').update(fixture).digest('hex'),
    '087c0688d4cdb293157ae34330e41d81999c2f2ab9aff98af7c2608988b4e118',
  );
  assert.equal(
    createHash('sha256').update(manifestBytes).digest('hex'),
    '8d5b62ad8e39f58b1283557a348de80f66ea20e85fa263b5b41498ae2c98a000',
  );
  assert.equal(old.version, 5);
  assert.equal(manifest.serializedBytes, 319851);
  const before = structuredClone(captured);
  const [read] = await decodeLocalDataSnapshots<WatchlistCollection>(
    [WATCHLISTS_COLLECTION],
    [captured],
    plaintextJsonCodec,
  );
  assert.ok(read);
  assert.deepEqual(captured, before);
  const recovered = read.Retained!;
  assert.equal(recovered.membershipRecovery, 'legacy_overflow');
  assert.deepEqual(recovered.domainMetadata, old.watchlists.Retained.domainMetadata);
  assert.deepEqual(recovered.results, old.watchlists.Retained.results);
  assert.deepEqual(recovered.history, old.watchlists.Retained.history);
  assert.deepEqual(recovered.baseline, old.watchlists.Retained.baseline);
  assert.deepEqual(watchlistActiveDomains(recovered), []);
  assert.deepEqual(watchlistActiveDomains(read.Unaffected!), ['unaffected.example']);
  assert.equal(projectHostedWatchlistEntry(recovered), null);
  const exported = buildWatchlistExport(read, '2026-10-04T00:00:00.000Z');
  assert.equal(exported.version, 6);
  assert.deepEqual(mergeWatchlistStores({}, JSON.parse(JSON.stringify(exported))).watchlists, read);
  assert.deepEqual(mergeWatchlistStores({}, old).watchlists, read);
  const written = await prepareLocalDataContent(WATCHLISTS_COLLECTION, read, plaintextJsonCodec);
  const rewritten: CapturedLocalDataCollection = {
    records: written.records,
    manifest: {
      ...manifest,
      schemaVersion: 6,
      serializedBytes: written.serializedBytes,
      digest: written.digest,
      recordCount: written.records.length,
    },
  };
  const [again] = await decodeLocalDataSnapshots<WatchlistCollection>(
    [WATCHLISTS_COLLECTION],
    [rewritten],
    plaintextJsonCodec,
  );
  assert.deepEqual(again, read);
});

const boundaryEvidence = JSON.parse(await readFile(new URL('./fixtures/workspace-lifecycle/watchlist-v5-boundary.provenance.json', import.meta.url), 'utf8')) as {
  vectors: Array<{ bytes: number; recoveredLists: number; sha256: string; manifestDigest: string }>;
};

test('old byte-ceiling stores remain readable and exportable through plaintext and encrypted migration without admitting new data', async () => {
  const workspace = '00000000-0000-4000-8000-000000000001', passphrase = 'synthetic boundary recovery phrase';
  const encryption = await createBrowserWorkspaceEncryption(workspace, passphrase);
  const unlocked = await unlockBrowserWorkspaceEncryption(workspace, encryption, passphrase);
  try {
    for (const vector of boundaryEvidence.vectors) {
      const historical = watchlistV5Boundary(fixture, vector.bytes, vector.recoveredLists);
      const historicalBytes = JSON.stringify(historical);
      assert.equal(Buffer.byteLength(historicalBytes), vector.bytes);
      assert.equal(createHash('sha256').update(historicalBytes).digest('hex'), vector.sha256);
      // Encoding the independently verified old bytes is not a current-model
      // migration. The real current reader below owns that migration.
      const oldDefinition: LocalDataCollectionDefinition<WatchlistCollection> = {
        ...WATCHLISTS_COLLECTION, schemaVersion: 5, maximumBytes: 2097152,
        normalize: raw => raw as WatchlistCollection,
        serialize: watchlists => JSON.stringify({ schema: 'whoisleuth.watchlists', version: 5, watchlists }),
      };
      for (const codec of [plaintextJsonCodec, unlocked.codec]) {
        const content = await prepareLocalDataContent(oldDefinition, historical.watchlists, codec);
        assert.equal(content.serializedBytes, vector.bytes);
        if (codec === plaintextJsonCodec) assert.equal(content.digest, vector.manifestDigest);
        const oldCapture = { records: content.records, manifest: { ...manifest, codec: codec.id, recordCount: content.records.length, serializedBytes: content.serializedBytes, digest: content.digest } };
        const [recovered] = await decodeLocalDataSnapshots<WatchlistCollection>([WATCHLISTS_COLLECTION], [oldCapture], codec);
        assert.ok(recovered);
        assert.equal(Buffer.byteLength(serializeWatchlistStore(recovered)), vector.bytes + vector.recoveredLists * 39);
        assert.equal(WATCHLIST_RECOVERY_METADATA_BYTES, 39);
        for (const [name, entry] of Object.entries(recovered)) {
          const { membershipRecovery, ...preserved } = entry;
          assert.deepEqual(preserved, historical.watchlists[name]);
          if (name.startsWith('Retained')) {
            assert.equal(membershipRecovery, 'legacy_overflow');
            assert.deepEqual(watchlistActiveDomains(entry), []);
            assert.equal(projectHostedWatchlistEntry(entry), null);
          }
        }
        assert.deepEqual(mergeWatchlistStores({}, parseWatchlistExport(historicalBytes)).watchlists, recovered);
        const exported = serializeWatchlistExport(recovered, '2026-10-04T00:00:00.000Z');
        assert.ok(Buffer.byteLength(exported) <= MAX_WATCHLIST_PORTABLE_BYTES);
        assert.ok(!exported.includes('\n'));
        assert.deepEqual(mergeWatchlistStores({}, parseWatchlistExport(exported)).watchlists, recovered);
        const rewritten = await prepareLocalDataContent(WATCHLISTS_COLLECTION, recovered, codec);
        const newCapture = { records: rewritten.records, manifest: { ...oldCapture.manifest, schemaVersion: 6, serializedBytes: rewritten.serializedBytes, digest: rewritten.digest } };
        assert.deepEqual(await decodeLocalDataSnapshots([WATCHLISTS_COLLECTION], [newCapture], codec), [recovered]);
        const before = structuredClone(recovered);
        const edit = planWatchlistUpdate(recovered, 'Unaffected', [{ domain: 'extra.example', availability: 'registered', scanDepth: 'fast' }], 'fast', 'merge');
        assert.throws(() => applyReviewedWatchlistUpdate(recovered, edit), /storage is full/);
        assert.deepEqual(recovered, before);
        const { Unaffected: _removed, ...reduced } = recovered;
        assert.ok(Buffer.byteLength(serializeWatchlistStore(reduced)) < Buffer.byteLength(serializeWatchlistStore(recovered)));
      }
    }
    // An unused recovery reserve cannot carry one extra ordinary data byte,
    // whether there are recovery entries or an entirely ordinary collection.
    const tooLarge = normalizeWatchlistStore(watchlistV5Boundary(fixture, 2097153)).watchlists;
    assert.throws(() => serializeWatchlistStore(tooLarge), /storage is full/);
    for (const entry of Object.values(tooLarge)) {
      if (!entry.membershipRecovery) continue;
      delete entry.membershipRecovery;
      entry.results = entry.results.map(row => ({ ...row, domain: 'member-0.example' }));
    }
    const ordinary = normalizeWatchlistStore(tooLarge).watchlists;
    const context = ordinary.Retained!.domainMetadata[0]!.contexts[0]!;
    // Retain a legal ordinary shape precisely one byte over its unchanged cap.
    const shortage = MAX_WATCHLIST_STORE_BYTES + 1 - Buffer.byteLength(JSON.stringify({ schema: 'whoisleuth.watchlists', version: 6, watchlists: ordinary }));
    assert.ok(shortage >= 0 && context.reason.length + shortage <= 300);
    (context as { reason: string }).reason += 'x'.repeat(shortage);
    assert.throws(() => serializeWatchlistStore(ordinary), /storage is full/);
    assert.match(serializeWatchlistExport({}, '2026-10-04T00:00:00.000Z'), /\n/);
    assert.throws(() => parseWatchlistExport(' '.repeat(MAX_WATCHLIST_PORTABLE_BYTES + 1)), /between 1 byte/);
    assert.throws(() => parseWatchlistExport('['.repeat(50) + '0' + ']'.repeat(50)), /nesting/);
    assert.throws(() => parseWatchlistExport('{"__proto__":{}}'), /unsafe/i);
  } finally { unlocked.lock(); }
});

test('recovery is read-only while ordinary watchlists remain editable and new overflow writes fail atomically', () => {
  const current = normalizeWatchlistStore(old).watchlists,
    before = structuredClone(current);
  const input = [{ domain: 'new.example', availability: 'registered', scanDepth: 'fast' as const }];
  assert.throws(
    () => planWatchlistUpdate(current, 'Retained', input, 'fast', 'replace'),
    /paused for membership recovery/,
  );
  assert.throws(
    () => planHostedWatchlistRestore(current, 'Retained', { results: input }),
    /paused for membership recovery/,
  );
  assert.throws(
    () =>
      planCandidateWatchHandoff(current, {
        name: 'Retained',
        candidates: [],
        brandProfileId: null,
        priority: 'p2',
        reason: 'Reviewed selection',
      }),
    /paused for membership recovery/,
  );
  const plan = planWatchlistUpdate(current, 'Unaffected', input, 'fast', 'merge');
  const updated = applyReviewedWatchlistUpdate(
    current,
    plan,
    '2026-10-04T00:00:00.000Z',
  ).watchlists;
  assert.deepEqual(updated.Retained, before.Retained);
  assert.deepEqual(watchlistActiveDomains(updated.Unaffected!).sort(), [
    'new.example',
    'unaffected.example',
  ]);
  const exact = { ...old.watchlists.Retained, results: [], baseline: [] };
  const valid = normalizeWatchlistStore({ Exact: exact }).watchlists;
  assert.equal(watchlistActiveDomains(valid.Exact!).length, 2000);
  assert.throws(
    () => serializeWatchlistStore({ Exact: { ...valid.Exact!, results: input } }),
    /active domains/,
  );
  assert.throws(() => planWatchlistUpdate(valid, 'Exact', input, 'fast', 'merge'), /domain limit/);
  assert.deepEqual(current, before);
  assert.throws(() => normalizeWatchlistStore({ ...old, version: 4 }), /schema 5/);
  assert.throws(() => normalizeWatchlistStore({ ...old, version: 6 }), /active domains/);
  assert.throws(
    () =>
      normalizeWatchlistStore({
        Exact: { ...valid.Exact!, membershipRecovery: 'legacy_overflow' },
      }),
    /recovery state is invalid/,
  );
});
