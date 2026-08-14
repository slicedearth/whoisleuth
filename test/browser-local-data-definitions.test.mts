import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  BROWSER_LOCAL_COLLECTIONS,
  BULK_SESSIONS_COLLECTION,
  decodeBrowserLocalCollectionRecord,
  PROFILES_COLLECTION,
  RELATIONSHIP_OBSERVATIONS_COLLECTION,
  SHORTLIST_COLLECTION,
  WATCHLISTS_COLLECTION,
} from '../frontend/src/lib/browser-local-data-definitions.ts';
import {
  BrowserLocalDataError,
  isExpectedBrowserLocalDataFailure,
  plaintextJsonCodec,
} from '../frontend/src/lib/browser-local-data.ts';
import type {
  AnyLocalDataCollectionDefinition,
  BrowserLocalCollectionManifest,
  BrowserLocalStoredRecord,
  LocalDataCollectionDefinition,
} from '../frontend/src/lib/browser-local-data.ts';

const NOW = '2026-07-22T01:00:00.000Z';

function shortlistManifest(): BrowserLocalCollectionManifest {
  return {
    collection: 'shortlist',
    schemaVersion: SHORTLIST_COLLECTION.schemaVersion,
    codec: plaintextJsonCodec.id,
    revision: 1,
    recordCount: 1,
    serializedBytes: 1,
    digest: 'fixture-digest',
    source: 'application',
    updatedAt: NOW,
    legacyKey: SHORTLIST_COLLECTION.legacyKey,
    legacyDigest: null,
  };
}

async function shortlistStoredRecord(value: unknown): Promise<BrowserLocalStoredRecord> {
  const encoded = await plaintextJsonCodec.encode({
    collection: 'shortlist',
    id: 'priority.invalid',
    value,
  });
  return {
    key: ['shortlist', encoded.lookupKey],
    collection: 'shortlist',
    lookupKey: encoded.lookupKey,
    ordinal: 0,
    codec: plaintextJsonCodec.id,
    payload: encoded.payload,
    payloadBytes: new TextEncoder().encode(encoded.payload).byteLength,
  };
}

function roundTrip<T>(
  definition: LocalDataCollectionDefinition<T>,
  document: unknown,
): { before: string; after: string; joined: T };
function roundTrip(
  definition: AnyLocalDataCollectionDefinition,
  document: unknown,
): { before: string; after: string; joined: unknown };
function roundTrip(definition: AnyLocalDataCollectionDefinition, document: unknown) {
  const normalized = definition.normalize(document);
  const before = definition.serialize(normalized);
  const joined = definition.normalize(definition.join(definition.split(normalized), definition.schemaVersion));
  return { before, after: definition.serialize(joined), joined };
}

describe('browser-local collection definitions', () => {
  test('degraded local-data views suppress only expected storage failures', () => {
    assert.equal(
      isExpectedBrowserLocalDataFailure(new BrowserLocalDataError('LOCAL_DATA_UNSUPPORTED', 'Unavailable.')),
      true,
    );
    assert.equal(isExpectedBrowserLocalDataFailure(new DOMException('Unavailable.', 'InvalidStateError')), true);
    assert.equal(isExpectedBrowserLocalDataFailure(new TypeError('Programming error.')), false);
    assert.equal(isExpectedBrowserLocalDataFailure({ name: 'BrowserLocalDataError' }), false);
  });

  test('every empty collection survives record splitting without changing its canonical document', () => {
    for (const definition of BROWSER_LOCAL_COLLECTIONS) {
      assert.equal(definition.acceptLegacyRoot(definition.empty()), true, `${definition.id} empty legacy root`);
      const result = roundTrip(definition, definition.empty());
      assert.equal(result.after, result.before, definition.id);
    }
  });

  test('every collection rejects a structurally unrelated legacy root', () => {
    for (const definition of BROWSER_LOCAL_COLLECTIONS) {
      const unrelated = definition.id === 'watchlists'
        ? { schema: 'unrelated.store', version: 1, watchlists: {} }
        : {};
      assert.equal(definition.acceptLegacyRoot(unrelated), false, definition.id);
    }
  });

  test('Brand Profile migration accepts its supported export envelope only', () => {
    const exported = {
      schema: 'whoisleuth.brand-profiles',
      version: 6,
      exportedAt: NOW,
      profiles: [],
    };

    assert.equal(PROFILES_COLLECTION.acceptLegacyRoot(exported), true);
    assert.equal(PROFILES_COLLECTION.acceptLegacyRoot({ ...exported, schema: 'unrelated.store' }), false);
  });

  test('shortlist records retain their semantic fields and canonical envelope', () => {
    const input = {
      schema: 'whoisleuth.shortlist',
      version: 2,
      entries: [{
        domain: 'priority.invalid',
        scanDepth: 'fast',
        availability: 'registered',
        riskModelVersion: 5,
        riskScore: 40,
        opportunityScore: 20,
        mutationTypes: ['omission'],
        savedAt: NOW,
      }],
    };
    const result = roundTrip(SHORTLIST_COLLECTION, input);
    const first = result.joined[0];
    assert.ok(first);
    assert.equal(result.after, result.before);
    assert.equal(result.joined.length, 1);
    assert.equal(first.domain, 'priority.invalid');
    assert.deepEqual(SHORTLIST_COLLECTION.split(result.joined).map((record) => record.id), ['priority.invalid']);
  });

  test('watchlist names remain independent record identifiers', () => {
    const watchlist = (domain: string) => ({
      updatedAt: NOW,
      results: [{ domain, availability: 'registered', scanDepth: 'fast' }],
      baseline: [],
      history: [],
    });
    const input = {
      schema: 'whoisleuth.watchlists',
      version: 2,
      watchlists: {
        Priority: watchlist('priority.invalid'),
        Secondary: watchlist('secondary.invalid'),
      },
    };
    const result = roundTrip(WATCHLISTS_COLLECTION, input);
    assert.equal(result.after, result.before);
    assert.deepEqual(Object.keys(result.joined), ['Priority', 'Secondary']);
    assert.deepEqual(WATCHLISTS_COLLECTION.split(result.joined).map((record) => record.id), ['Priority', 'Secondary']);
  });

  test('legacy watchlist names that resemble envelope fields remain valid collection entries', () => {
    const watchlist = { results: [] };
    const input = { schema: watchlist, version: watchlist, watchlists: watchlist };

    assert.equal(WATCHLISTS_COLLECTION.acceptLegacyRoot(input), true);
    assert.deepEqual(Object.keys(WATCHLISTS_COLLECTION.normalize(input)), ['schema', 'version', 'watchlists']);
    assert.equal(WATCHLISTS_COLLECTION.acceptLegacyRoot({
      schema: 'unrelated.store',
      version: 1,
      watchlists: {},
    }), false);
  });

  test('retained relationship observations keep deterministic record identities', () => {
    const input = {
      schema: 'whoisleuth.relationship-observations',
      version: 1,
      observations: [{
        id: 'relationship-untrusted-alias',
        type: 'ip_address',
        label: 'Shared IP address',
        method: 'Exact normalized address',
        normalizedValue: '192.0.2.20',
        displayValue: '192.0.2.20',
        domains: ['second.invalid', 'first.invalid'],
        description: 'Bounded relationship fixture.',
        classification: 'derived',
        source: 'bulk_relationship_analysis',
        sourceVersion: 2,
        observedAt: NOW,
        retainedAt: NOW,
        complete: true,
        truncated: false,
        limitations: [],
      }],
    };
    const result = roundTrip(RELATIONSHIP_OBSERVATIONS_COLLECTION, input);
    const first = result.joined[0];
    assert.ok(first);
    assert.equal(result.after, result.before);
    assert.equal(result.joined.length, 1);
    assert.match(first.id, /^relationship-/);
    assert.notEqual(first.id, 'relationship-untrusted-alias');
    assert.deepEqual(RELATIONSHIP_OBSERVATIONS_COLLECTION.split(result.joined).map((record) => record.id), [first.id]);
  });

  test('saved Bulk sessions retain compact resumable rows as independent records', () => {
    const input = {
      schema: 'whoisleuth.bulk-sessions',
      version: 1,
      sessions: [{
        id: 'bulk-session',
        name: 'Priority review',
        mode: 'fast',
        state: 'partial',
        inputDigest: `sha256:${'a'.repeat(64)}`,
        domains: ['first.invalid', 'second.invalid'],
        results: [{
          domain: 'first.invalid',
          status: 'error',
          availability: 'error',
          confidence: 'unknown',
          registrar: '—',
          activity: '—',
          risk: null,
          opportunity: null,
          mutationTypes: [],
          trusted: null,
          error: 'Lookup failed',
          scanDepth: 'fast',
          nameservers: [],
          faviconMatch: false,
          faviconNearMatch: false,
          reusesOfficialAssets: false,
          hasPasswordField: false,
          riskFactors: [],
          relationship: {
            version: 2,
            nameservers: [],
            ipAddresses: [],
            trackingIdentifiers: [],
            officialAssetHosts: [],
            faviconHash: null,
            faviconPHash: null,
            certificateFingerprint: null,
            truncated: false,
          },
          sourceCoverage: [{ source: 'lookup', state: 'error' }],
        }],
        startedAt: NOW,
        updatedAt: NOW,
        completedAt: null,
      }],
    };
    const result = roundTrip(BULK_SESSIONS_COLLECTION, input);
    assert.equal(result.after, result.before);
    assert.equal(result.joined.length, 1);
    assert.deepEqual(BULK_SESSIONS_COLLECTION.split(result.joined).map((record) => record.id), ['bulk-session']);
  });

  test('directly normalizes legacy, current, mixed, and partially forged bare Bulk arrays per candidate', () => {
    const profileContext = {
      sourceState: 'ready',
      activeProfileId: 'profile-one',
      profileUpdatedAt: NOW,
      limitation: '',
    };
    const row = (domain: string) => ({
      domain,
      status: 'complete',
      availability: 'registered',
      confidence: 'high',
      registrar: 'Example Registrar',
      activity: 'Active',
      risk: 80,
      opportunity: 20,
      mutationTypes: [],
      trusted: null,
      error: '',
      scanDepth: 'deep',
      nameservers: [],
      faviconMatch: false,
      faviconNearMatch: false,
      reusesOfficialAssets: false,
      hasPasswordField: false,
      idnReferenceMatch: false,
      pageBaselineMatch: false,
      hasActiveBrandProfile: true,
      riskModelVersion: 6,
      riskFactors: [],
      relationship: {
        version: 2,
        nameservers: [],
        ipAddresses: [],
        trackingIdentifiers: [],
        officialAssetHosts: [],
        faviconHash: null,
        faviconPHash: null,
        certificateFingerprint: null,
        truncated: false,
      },
      sourceCoverage: [{ source: 'rdap', state: 'complete' }],
      profileContext,
    });
    const current = (id: string, domain: string) => ({
      id,
      name: id,
      mode: 'deep',
      state: 'complete',
      inputDigest: `sha256:${'b'.repeat(64)}`,
      domains: [domain],
      results: [row(domain)],
      startedAt: NOW,
      updatedAt: NOW,
      completedAt: NOW,
      profileContext,
    });
    const legacy = structuredClone(current('legacy', 'legacy.invalid'));
    Reflect.deleteProperty(legacy, 'profileContext');
    Reflect.deleteProperty(legacy.results[0]!, 'profileContext');
    Reflect.set(legacy.results[0]!, 'trusted', 'official');
    Reflect.set(legacy.results[0]!, 'faviconMatch', true);
    const currentRecord = current('current', 'current.invalid');
    const partial = structuredClone(current('partial', 'partial.invalid'));
    Reflect.deleteProperty(partial.results[0]!, 'profileContext');

    const legacyOnly = BULK_SESSIONS_COLLECTION.normalize([legacy]);
    assert.equal(legacyOnly[0]?.profileContext.sourceState, 'unavailable');
    assert.equal(legacyOnly[0]?.results[0]?.trusted, null);
    assert.equal(legacyOnly[0]?.results[0]?.risk, null);

    const currentOnly = BULK_SESSIONS_COLLECTION.normalize([currentRecord]);
    assert.equal(currentOnly[0]?.profileContext.sourceState, 'ready');
    assert.equal(currentOnly[0]?.profileContext.activeProfileId, 'profile-one');
    assert.equal(currentOnly[0]?.results[0]?.risk, 80);

    const mixed = BULK_SESSIONS_COLLECTION.normalize([legacy, currentRecord, partial]);
    assert.deepEqual(mixed.map((item) => item.id), ['current', 'legacy']);
    assert.equal(mixed.find((item) => item.id === 'legacy')?.profileContext.sourceState, 'unavailable');
    assert.equal(mixed.find((item) => item.id === 'current')?.profileContext.sourceState, 'ready');
    assert.equal(mixed.some((item) => item.id === 'partial'), false);
  });

  test('stored record decoding uses the codec and owning collection normalizer before typing values', async () => {
    const record = await shortlistStoredRecord({
      domain: 'priority.invalid',
      scanDepth: 'fast',
      availability: 'registered',
      riskModelVersion: 5,
      riskScore: 40,
      opportunityScore: 20,
      mutationTypes: ['omission'],
      savedAt: NOW,
    });
    const decoded = await decodeBrowserLocalCollectionRecord('shortlist', record, shortlistManifest());
    assert.equal(decoded.id, 'priority.invalid');
    assert.equal(decoded.value.domain, 'priority.invalid');

    await assert.rejects(
      decodeBrowserLocalCollectionRecord(
        'shortlist',
        await shortlistStoredRecord({ domain: '', savedAt: NOW }),
        shortlistManifest(),
      ),
      (cause: unknown) => cause instanceof BrowserLocalDataError && cause.code === 'LOCAL_DATA_INTEGRITY',
    );
    await assert.rejects(
      decodeBrowserLocalCollectionRecord(
        'shortlist',
        { ...record, payloadBytes: record.payloadBytes + 1 },
        shortlistManifest(),
      ),
      (cause: unknown) => cause instanceof BrowserLocalDataError && cause.code === 'LOCAL_DATA_INTEGRITY',
    );
  });
});
