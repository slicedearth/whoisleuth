import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  BROWSER_LOCAL_COLLECTIONS,
  ANALYST_REVIEW_STATE_COLLECTION,
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
import { ANALYST_REVIEW_STATE_BROWSER_STORAGE_REVISION } from '../packages/contracts/analyst-review-state-contract.mts';

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

  test('every canonical empty collection survives record splitting while retired Case lists reach the explicit rejection path', () => {
    for (const definition of BROWSER_LOCAL_COLLECTIONS) {
      const empty = definition.empty();
      const emptyIsVersioned = !Array.isArray(empty)
        && typeof empty === 'object'
        && empty !== null
        && Object.hasOwn(empty, 'version');
      const recognisedOnlyForRetirement = definition.id === 'cases' && Array.isArray(empty);
      assert.equal(definition.acceptLegacyRoot(empty), emptyIsVersioned || recognisedOnlyForRetirement, `${definition.id} empty root`);
      const result = roundTrip(definition, empty);
      const canonical = JSON.parse(result.before);
      assert.equal(definition.acceptLegacyRoot(canonical), true, `${definition.id} canonical root`);
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

  test('every non-Case wrapper detects a future version before migration without changing its input', () => {
    const futureRoots: Record<string, unknown> = {
      campaigns: { version: 2, campaigns: [] },
      brand_profiles: { version: 8, profiles: [] },
      watchlists: { schema: 'whoisleuth.watchlists', version: 3, watchlists: {} },
      shortlist: { schema: 'whoisleuth.shortlist', version: 4, entries: [] },
      ct_history: { version: 4, entries: [] },
      detection_rules: { version: 2, rules: [] },
      relationship_observations: { schema: 'whoisleuth.relationship-observations', version: 2, observations: [] },
      bulk_sessions: { schema: 'whoisleuth.bulk-sessions', version: 5, sessions: [] },
      website_snapshots: { schema: 'whoisleuth.website-profile-snapshots', version: 6, snapshots: [] },
      investigation_templates: { schema: 'whoisleuth.investigation-templates', version: 3, templates: [] },
      bulk_review: { schema: 'whoisleuth.bulk-review', version: 2, presets: [], rows: [] },
      analyst_review_state: { schema: 'whoisleuth.analyst-review-state', version: ANALYST_REVIEW_STATE_COLLECTION.schemaVersion + 1, records: [] },
    };
    const definitions = BROWSER_LOCAL_COLLECTIONS.filter(({ id }) => id !== 'cases');
    assert.deepEqual(
      definitions.map(({ id }) => id).sort(),
      Object.keys(futureRoots).sort(),
    );
    for (const definition of definitions) {
      const raw = futureRoots[definition.id];
      assert.ok(raw, definition.id);
      const before = structuredClone(raw);
      assert.equal(definition.acceptLegacyRoot(raw), true, definition.id);
      assert.equal(definition.version(raw), definition.schemaVersion + 1, definition.id);
      assert.deepEqual(raw, before, definition.id);
    }
  });

  test('uses an internal storage revision to reopen the retired development Review Item identity', () => {
    const previous = {
      schema: 'whoisleuth.analyst-review-state',
      version: 1,
      records: [{
        subjectKey: 'review:case:0123456789abcdef',
        reviewedFingerprint: 'material:fedcba9876543210',
        evidenceFamily: 'case',
        disposition: 'expected',
        rationale: 'Earlier local review.',
        reviewedAt: NOW,
        reviewDueAt: '2026-07-23T01:00:00.000Z',
        expiresAt: '2026-07-24T01:00:00.000Z',
        caseIds: ['case-one'],
        campaignIds: [],
        history: [],
      }],
    };
    const migrated = ANALYST_REVIEW_STATE_COLLECTION.normalize(
      ANALYST_REVIEW_STATE_COLLECTION.join(
        previous.records.map((value) => ({ id: value.subjectKey, value })),
        1,
      ),
    );
    assert.equal(ANALYST_REVIEW_STATE_COLLECTION.schemaVersion, ANALYST_REVIEW_STATE_BROWSER_STORAGE_REVISION);
    assert.equal(migrated.version, 1);
    assert.equal(migrated.records[0]?.disposition, 'open');
    assert.equal(migrated.records[0]?.history[0]?.rationale, 'Earlier local review.');
  });

  test('Brand Profile migration accepts the exact public browser envelope, not a portable export', () => {
    const browserStore = {
      version: 6,
      profiles: [],
    };

    assert.equal(PROFILES_COLLECTION.acceptLegacyRoot(browserStore), true);
    assert.equal(PROFILES_COLLECTION.acceptLegacyRoot({ ...browserStore, schema: 'whoisleuth.brand-profiles' }), false);
  });

  test('shortlist records retain their semantic fields and canonical envelope', () => {
    const input = {
      schema: 'whoisleuth.shortlist',
      version: 3,
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

  test('does not reinterpret legacy watchlist names as a current envelope', () => {
    const watchlist = { results: [] };
    const input = { schema: watchlist, version: watchlist, watchlists: watchlist };

    assert.equal(WATCHLISTS_COLLECTION.acceptLegacyRoot(input), false);
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
      version: 4,
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
          profileContext: { sourceState: 'ready', activeProfileId: null, profileUpdatedAt: null, limitation: '' },
        }],
        profileContext: { sourceState: 'ready', activeProfileId: null, profileUpdatedAt: null, limitation: '' },
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

  test('directly normalizes current bare Bulk arrays while dropping legacy and partially forged candidates', () => {
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
    assert.deepEqual(legacyOnly, []);

    const currentOnly = BULK_SESSIONS_COLLECTION.normalize([currentRecord]);
    assert.equal(currentOnly[0]?.profileContext.sourceState, 'ready');
    assert.equal(currentOnly[0]?.profileContext.activeProfileId, 'profile-one');
    assert.equal(currentOnly[0]?.results[0]?.risk, 80);

    const mixed = BULK_SESSIONS_COLLECTION.normalize([legacy, currentRecord, partial]);
    assert.deepEqual(mixed.map((item) => item.id), ['current']);
    assert.equal(mixed[0]?.profileContext.sourceState, 'ready');
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
