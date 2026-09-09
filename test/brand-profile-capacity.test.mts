import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { boundedJsonLimitsForBytes, parseBoundedJson } from '../lib/bounded-json.mts';
import {
  assertBrandProfileStoreBudget,
  buildBrandProfileExport,
  mergeBrandProfiles,
  type BrandProfile,
} from '../packages/workspace/brand-profile-model.mts';
import {
  MAX_PROFILE_IMPORT_BYTES,
  MAX_PROFILE_STORE_BYTES,
  serialiseWorkspacePortableJson,
} from '../packages/contracts/workspace-portability.mts';
import { buildWorkspaceArchive, previewWorkspaceArchive } from '../packages/workspace/workspace-archive.mts';
import { decryptWorkspaceArchive, encryptWorkspaceArchive } from '../packages/workspace/workspace-archive-crypto.mts';
import { PROFILES_COLLECTION } from '../frontend/src/lib/browser-local-data-definitions.ts';
import { localDataStorageRecords, plaintextJsonCodec } from '../frontend/src/lib/browser-local-data.ts';
import { brandProfileStoreAtBytes, denseBrandHistoryStore, richBrandHistoryProfiles } from './brand-profile-capacity-fixture.mts';

const NOW = '2026-09-09T00:00:00.000Z';

function assertRichHistory(profiles: BrandProfile[]) {
  assert.equal(profiles.length, 2);
  for (const profile of profiles) {
    assert.equal(profile.desiredPostureBaselines.length, 20);
    for (const baseline of profile.desiredPostureBaselines) {
      assert.ok(baseline.observationHistory);
      assert.equal(baseline.observationHistory.length, 12);
      assert.ok(baseline.observationHistory.every((observation) => observation.checks.length === 4));
      assert.ok(baseline.observationHistory.every((observation) => observation.checks[0]?.records.length === 64));
    }
  }
}

test('complete rich profile histories survive storage and formatted import without omissions', () => {
  const store = assertBrandProfileStoreBudget(richBrandHistoryProfiles(2));
  assertRichHistory(store.profiles);
  assert.ok(Buffer.byteLength(JSON.stringify(store)) > 3 * 1024 * 1024);
  const exported = serialiseWorkspacePortableJson(buildBrandProfileExport(store.profiles, NOW));
  assert.ok(Buffer.byteLength(exported) > 4 * 1024 * 1024);
  assert.ok(Buffer.byteLength(exported) <= MAX_PROFILE_IMPORT_BYTES);
  const parsed = parseBoundedJson(exported, { maximumBytes: MAX_PROFILE_IMPORT_BYTES, limits: boundedJsonLimitsForBytes(MAX_PROFILE_STORE_BYTES) });
  const restored = mergeBrandProfiles([], parsed, { nowIso: NOW });
  assert.equal(restored.added, 2);
  assert.equal(restored.skipped, 0);
  assertRichHistory(assertBrandProfileStoreBudget(restored.profiles).profiles);
  assert.ok(isDeepStrictEqual(restored.profiles, store.profiles), 'Every rich profile field survives formatted import.');
});

test('dense formatted history imports retain the stored-data graph bounds', () => {
  const store = assertBrandProfileStoreBudget(denseBrandHistoryStore());
  const exported = serialiseWorkspacePortableJson(buildBrandProfileExport(store.profiles, NOW));
  assert.ok(Buffer.byteLength(exported) > 16 * 1024 * 1024);
  assert.ok(Buffer.byteLength(exported) <= MAX_PROFILE_IMPORT_BYTES);
  const options = { maximumBytes: MAX_PROFILE_IMPORT_BYTES, limits: boundedJsonLimitsForBytes(MAX_PROFILE_STORE_BYTES) };
  const restored = mergeBrandProfiles([], parseBoundedJson(exported, options), { nowIso: NOW });
  assert.equal(restored.added, store.profiles.length);
  assert.equal(restored.updated, 0);
  assert.equal(restored.skipped, 0);
  assert.ok(isDeepStrictEqual(restored.profiles, store.profiles), 'Every dense profile field survives formatted import.');
  const excessiveText = JSON.stringify({ profiles: [], unexpected: 'x'.repeat(MAX_PROFILE_STORE_BYTES + 1) });
  assert.ok(Buffer.byteLength(excessiveText) < MAX_PROFILE_IMPORT_BYTES);
  assert.throws(() => parseBoundedJson(excessiveText, options), /string|text/u);
});

test('the exact profile collection byte boundary remains readable through the record codec', async () => {
  const store = brandProfileStoreAtBytes(MAX_PROFILE_STORE_BYTES);
  assert.equal(store.profiles.length, 100);
  assert.equal(Buffer.byteLength(PROFILES_COLLECTION.serialize(store.profiles)), MAX_PROFILE_STORE_BYTES);
  const records = localDataStorageRecords(PROFILES_COLLECTION, store.profiles);
  const decoded = [];
  for (const record of records) {
    const encoded = await plaintextJsonCodec.encode({ collection: 'brand_profiles', id: record.id, value: record.value, maximumBytes: PROFILES_COLLECTION.maximumBytes });
    decoded.push(await plaintextJsonCodec.decode({ collection: 'brand_profiles', ...encoded, maximumBytes: PROFILES_COLLECTION.maximumBytes }));
  }
  const restored = PROFILES_COLLECTION.normalize(PROFILES_COLLECTION.join(decoded, PROFILES_COLLECTION.schemaVersion));
  assert.ok(isDeepStrictEqual(restored, store.profiles), 'The record codec retains the full profile collection.');
  assert.equal(PROFILES_COLLECTION.maximumBytes, MAX_PROFILE_STORE_BYTES);
  assert.ok(Buffer.byteLength(serialiseWorkspacePortableJson(buildBrandProfileExport(restored, NOW))) <= MAX_PROFILE_IMPORT_BYTES);
  assert.throws(() => assertBrandProfileStoreBudget(brandProfileStoreAtBytes(MAX_PROFILE_STORE_BYTES + 1)), /storage is full/u);
});

test('a full profile collection survives plain and authenticated workspace admission', async () => {
  const store = brandProfileStoreAtBytes(MAX_PROFILE_STORE_BYTES);
  const archive = await buildWorkspaceArchive({ brandProfiles: store.profiles }, { generatedAt: NOW });
  const passphrase = 'synthetic full profile workspace phrase';
  const unlocked = await decryptWorkspaceArchive(await encryptWorkspaceArchive(archive, passphrase), passphrase);
  for (const value of [archive, unlocked]) {
    const preview = await previewWorkspaceArchive(value, {});
    const section = preview.sections.find((item) => item.id === 'brandProfiles');
    assert.ok(section);
    assert.equal(section.status, 'ready');
    assert.equal(section.added, 100);
    assert.equal(section.skipped, 0);
    const restored = mergeBrandProfiles([], section.data, { nowIso: NOW });
    assert.ok(isDeepStrictEqual(restored.profiles, store.profiles), 'Workspace restoration retains the full profile collection.');
  }
});
