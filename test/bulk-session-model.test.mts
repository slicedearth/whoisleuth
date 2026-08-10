import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  BULK_SESSION_SCHEMA,
  BULK_SESSION_SCHEMA_VERSION,
  BULK_PROFILE_CONTEXT_IMPORTED_LIMITATION,
  BULK_PROFILE_CONTEXT_LEGACY_LIMITATION,
  BULK_PROFILE_CONTEXT_MISMATCH_LIMITATION,
  MAX_BULK_SESSIONS,
  buildBulkSessionExport,
  compareBulkSessions,
  enforceBulkSessionStoreBudget,
  mergeBulkSessions,
  normalizeBulkSession,
  normalizeBulkSessionResult,
  normalizeBulkSessionStore,
  summarizeBulkProfileContexts,
  type BulkProfileContextProvenance,
  unavailableBulkProfileContext,
  upsertBulkSession,
} from '../frontend/src/lib/analysis/bulk-session-model.ts';
import { normalizeCaaCritical } from '../frontend/src/lib/analysis/dns-record-normalization.ts';

const FIRST = '2026-07-28T01:00:00.000Z';
const LATER = '2026-07-29T01:00:00.000Z';
const DIGEST = `sha256:${'a'.repeat(64)}`;
const READY_PROFILE_CONTEXT = Object.freeze({
  sourceState: 'ready' as const,
  activeProfileId: null,
  profileUpdatedAt: null,
  limitation: '',
});
const ACTIVE_PROFILE_CONTEXT = Object.freeze({
  sourceState: 'ready' as const,
  activeProfileId: 'profile-one',
  profileUpdatedAt: FIRST,
  limitation: '',
});

function result(domain = 'priority.invalid', overrides: Record<string, unknown> = {}) {
  return {
    domain,
    status: 'complete',
    availability: 'registered',
    confidence: 'high',
    registrar: 'Example Registrar',
    activity: 'Active',
    risk: 70,
    opportunity: 20,
    mutationTypes: ['omission'],
    trusted: null,
    error: '',
    scanDepth: 'deep',
    createdDate: FIRST,
    expiryDate: LATER,
    nameservers: ['ns1.priority.invalid'],
    hasMx: true,
    hasNullMx: false,
    hasSpf: true,
    hasDmarc: false,
    activityStatus: 'active',
    pageTitle: 'Priority',
    faviconHash: null,
    faviconPHash: null,
    faviconMatch: false,
    faviconNearMatch: false,
    reusesOfficialAssets: false,
    hasPasswordField: true,
    hasExternalFormAction: true,
    phishingLanguageMatch: null,
    riskModelVersion: 5,
    opportunityModelVersion: 2,
    riskFactors: [{ label: 'Credential input observed', points: 15 }],
    dns: {
      status: 'success',
      records: { a: ['192.0.2.20'], aaaa: [], cname: [], caa: [] },
    },
    dnssec: 'signed',
    comparisonEvidence: {
      version: 1,
      technology: {
        state: 'success',
        ids: ['shop-platform', 'web-framework'],
        truncated: false,
      },
      tls: {
        state: 'success',
        issuerLabel: 'Example Issuing CA',
        spkiSha256: 'b'.repeat(64),
      },
    },
    relationship: {
      version: 2,
      nameservers: ['ns1.priority.invalid'],
      ipAddresses: ['192.0.2.20'],
      trackingIdentifiers: [],
      officialAssetHosts: [],
      faviconHash: null,
      faviconPHash: null,
      certificateFingerprint: null,
      truncated: false,
    },
    sourceCoverage: [
      { source: 'rdap', state: 'complete' },
      { source: 'whois', state: 'partial' },
    ],
    profileContext: READY_PROFILE_CONTEXT,
    ...overrides,
  };
}

function session(id = 'session-one', overrides: Record<string, unknown> = {}) {
  const value = {
    id,
    name: 'Priority review',
    mode: 'deep',
    state: 'complete',
    inputDigest: DIGEST,
    domains: ['priority.invalid'],
    results: [result()],
    startedAt: FIRST,
    updatedAt: LATER,
    completedAt: LATER,
    ...overrides,
  };
  return {
    ...value,
    profileContext: Object.prototype.hasOwnProperty.call(overrides, 'profileContext')
      ? overrides.profileContext
      : summarizeBulkProfileContexts((value.results as Array<{ profileContext: typeof READY_PROFILE_CONTEXT }>)),
  };
}

describe('saved Bulk sessions', () => {
  test('sanitizes impossible ready-without-profile claims without turning legitimate false values into absence', () => {
    const impossible = normalizeBulkSessionResult(result('forged.invalid', {
      trusted: 'official',
      risk: 91,
      riskModelVersion: 7,
      riskFactors: [{ label: 'Profile-derived', points: 91 }],
      faviconMatch: true,
      faviconNearMatch: true,
      reusesOfficialAssets: true,
      idnReferenceMatch: true,
      pageBaselineMatch: true,
      hasActiveBrandProfile: true,
      relationship: {
        ...result().relationship,
        officialAssetHosts: ['assets.forged.invalid'],
      },
    }));
    assert.ok(impossible);
    assert.equal(impossible.trusted, null);
    assert.equal(impossible.risk, null);
    assert.equal(impossible.riskModelVersion, null);
    assert.deepEqual(impossible.riskFactors, []);
    assert.equal(impossible.faviconMatch, null);
    assert.equal(impossible.faviconNearMatch, null);
    assert.equal(impossible.reusesOfficialAssets, null);
    assert.equal(impossible.idnReferenceMatch, null);
    assert.equal(impossible.pageBaselineMatch, null);
    assert.equal(impossible.hasActiveBrandProfile, null);
    assert.deepEqual(impossible.relationship.officialAssetHosts, []);

    const legitimate = normalizeBulkSessionResult(result('settled.invalid', {
      faviconMatch: false,
      faviconNearMatch: false,
      reusesOfficialAssets: false,
      idnReferenceMatch: false,
      pageBaselineMatch: false,
      hasActiveBrandProfile: false,
      relationship: { ...result().relationship, officialAssetHosts: [] },
    }));
    assert.ok(legitimate);
    assert.equal(legitimate.faviconMatch, false);
    assert.equal(legitimate.faviconNearMatch, false);
    assert.equal(legitimate.reusesOfficialAssets, false);
    assert.equal(legitimate.idnReferenceMatch, false);
    assert.equal(legitimate.pageBaselineMatch, false);
    assert.equal(legitimate.hasActiveBrandProfile, false);
    assert.equal(legitimate.risk, 70);
    assert.equal(legitimate.riskModelVersion, 5);
    assert.deepEqual(legitimate.riskFactors, [{ label: 'Credential input observed', points: 15 }]);

    const saved = normalizeBulkSession(session('settled-no-profile-risk', {
      results: [result('priority.invalid', {
        faviconMatch: false,
        faviconNearMatch: false,
        reusesOfficialAssets: false,
        idnReferenceMatch: false,
        pageBaselineMatch: false,
        hasActiveBrandProfile: false,
      })],
    }));
    assert.equal(saved?.results[0]?.risk, 70);
    assert.equal(saved?.results[0]?.riskModelVersion, 5);
    assert.deepEqual(saved?.results[0]?.riskFactors, [{ label: 'Credential input observed', points: 15 }]);
  });

  test('rejects malformed v4 result sets atomically across direct, bare, envelope, and portable readers', () => {
    const invalidSessions = [
      session('missing-row-context', {
        results: [result('priority.invalid', { profileContext: undefined })],
        profileContext: READY_PROFILE_CONTEXT,
      }),
      session('malformed-row-context', {
        results: [result('priority.invalid', {
          profileContext: {
            sourceState: 'ready',
            activeProfileId: null,
            profileUpdatedAt: FIRST,
            limitation: '',
          },
        })],
        profileContext: READY_PROFILE_CONTEXT,
      }),
      session('missing-session-context', { profileContext: undefined }),
      session('duplicate-row', { results: [result(), result()] }),
      session('out-of-domain-row', {
        results: [result('outside.invalid')],
        profileContext: READY_PROFILE_CONTEXT,
      }),
      session('incomplete-complete-session', {
        domains: ['priority.invalid', 'missing.invalid'],
        results: [result()],
      }),
      session('fully-settled-partial-session', {
        state: 'partial',
        completedAt: null,
      }),
      session('fully-settled-cancelled-session', {
        state: 'cancelled',
        completedAt: null,
      }),
    ];

    for (const candidate of invalidSessions) {
      assert.equal(normalizeBulkSession(candidate), null, String(candidate.id));
      assert.deepEqual(normalizeBulkSessionStore([candidate]).sessions, [], `bare ${candidate.id}`);
      assert.deepEqual(normalizeBulkSessionStore({
        schema: BULK_SESSION_SCHEMA,
        version: BULK_SESSION_SCHEMA_VERSION,
        sessions: [candidate],
      }).sessions, [], `envelope ${candidate.id}`);
      const imported = mergeBulkSessions([], {
        schema: BULK_SESSION_SCHEMA,
        version: BULK_SESSION_SCHEMA_VERSION,
        sessions: [candidate],
      });
      assert.deepEqual(
        { sessions: imported.sessions, added: imported.added, skipped: imported.skipped },
        { sessions: [], added: 0, skipped: 1 },
        `portable ${candidate.id}`,
      );
    }
  });

  test('requires complete v4 coverage while retaining valid partial and cancelled subsets', () => {
    for (const state of ['partial', 'cancelled'] as const) {
      const subset = normalizeBulkSession(session(`${state}-subset`, {
        state,
        domains: ['priority.invalid', 'pending.invalid'],
        results: [result()],
        completedAt: null,
      }));
      assert.ok(subset, state);
      assert.deepEqual(subset.results.map((item) => item.domain), ['priority.invalid']);
      assert.equal(normalizeBulkSessionStore([session(`${state}-bare-subset`, {
        state,
        domains: ['priority.invalid', 'pending.invalid'],
        results: [result()],
        completedAt: null,
      })]).sessions.length, 1, `bare ${state}`);
      assert.equal(normalizeBulkSessionStore({
        schema: BULK_SESSION_SCHEMA,
        version: BULK_SESSION_SCHEMA_VERSION,
        sessions: [session(`${state}-envelope-subset`, {
          state,
          domains: ['priority.invalid', 'pending.invalid'],
          results: [result()],
          completedAt: null,
        })],
      }).sessions.length, 1, `envelope ${state}`);
      const imported = mergeBulkSessions([], {
        schema: BULK_SESSION_SCHEMA,
        version: BULK_SESSION_SCHEMA_VERSION,
        sessions: [session(`${state}-portable-subset`, {
          state,
          domains: ['priority.invalid', 'pending.invalid'],
          results: [result()],
          completedAt: null,
        })],
      });
      assert.equal(imported.added, 1, `portable ${state}`);
      assert.equal(imported.skipped, 0, `portable ${state}`);
    }

    const complete = normalizeBulkSession(session('complete-coverage', {
      domains: ['priority.invalid', 'second.invalid'],
      results: [result(), result('second.invalid')],
    }));
    assert.ok(complete);
    assert.deepEqual(complete.results.map((item) => item.domain), ['priority.invalid', 'second.invalid']);

    const legacySalvage = normalizeBulkSessionStore({
      schema: BULK_SESSION_SCHEMA,
      version: 3,
      sessions: [session('legacy-salvage', {
        domains: ['priority.invalid', 'missing.invalid'],
        results: [result(), result('outside.invalid', { profileContext: undefined })],
        profileContext: READY_PROFILE_CONTEXT,
      })],
    });
    assert.equal(legacySalvage.sessions[0]?.id, 'legacy-salvage');
    assert.deepEqual(legacySalvage.sessions[0]?.results.map((item) => item.domain), ['priority.invalid']);
  });

  test('retains unavailable profile-dependent values as null', () => {
    const profileContext = unavailableBulkProfileContext();
    const unavailableSession = session('profile-unavailable', {
      domains: ['candidate.invalid'],
      results: [result('candidate.invalid', {
        faviconMatch: null,
        faviconNearMatch: null,
        reusesOfficialAssets: null,
        hasActiveBrandProfile: null,
        idnReferenceMatch: false,
        pageBaselineMatch: false,
        risk: 77,
        riskModelVersion: 7,
        riskFactors: [{ label: 'Must be withheld', points: 77 }],
        profileContext,
      })],
    });
    const normalized = normalizeBulkSession(unavailableSession);
    assert.equal(normalized?.results[0]?.faviconMatch, null);
    assert.equal(normalized?.results[0]?.faviconNearMatch, null);
    assert.equal(normalized?.results[0]?.reusesOfficialAssets, null);
    assert.equal(normalized?.results[0]?.hasActiveBrandProfile, null);
    assert.equal(normalized?.results[0]?.idnReferenceMatch, null);
    assert.equal(normalized?.results[0]?.pageBaselineMatch, null);
    assert.equal(normalized?.results[0]?.risk, null);
    assert.equal(normalized?.results[0]?.riskModelVersion, null);
    assert.deepEqual(normalized?.results[0]?.riskFactors, []);
    assert.equal(normalized?.profileContext.limitation, profileContext.limitation);

    const exported = buildBulkSessionExport([unavailableSession]);
    assert.equal(exported.version, BULK_SESSION_SCHEMA_VERSION);
    assert.equal(exported.sessions[0]?.results[0]?.risk, null);
    assert.equal(exported.sessions[0]?.results[0]?.idnReferenceMatch, null);
    assert.equal(exported.sessions[0]?.results[0]?.pageBaselineMatch, null);
    assert.equal(exported.sessions[0]?.profileContext.sourceState, 'unavailable');
    assert.equal(exported.sessions[0]?.profileContext.limitation, profileContext.limitation);
  });

  test('normalizes bounded CAA critical flags and rejects malformed values', () => {
    assert.equal(normalizeCaaCritical(0), 0);
    assert.equal(normalizeCaaCritical('128'), 128);
    assert.equal(normalizeCaaCritical(255), 255);
    for (const value of [-1, 256, 1.5, Number.NaN, '256', '0\rFORMULA', ' 0', '', null]) {
      assert.equal(normalizeCaaCritical(value), null);
    }
    const normalized = normalizeBulkSession(session('caa-session', {
      results: [result('priority.invalid', {
        dns: {
          status: 'success',
          records: {
            a: [], aaaa: [], cname: [],
            caa: [
              { critical: '0', tag: 'issue', value: 'ca.example.test' },
              { critical: '0\rFORMULA', tag: 'issue', value: 'discard.example.test' },
            ],
          },
        },
      })],
    }));
    assert.deepEqual(normalized?.results[0]?.dns?.records.caa, [
      { critical: 0, tag: 'issue', value: 'ca.example.test' },
    ]);
  });

  test('normalizes compact evidence while excluding unknown and contact fields', () => {
    const normalized = normalizeBulkSession(session('session-one', {
      results: [result('priority.invalid', {
        rawWhois: 'must not persist',
        registrant: { email: 'private@priority.invalid' },
        relationship: {
          version: 2,
          nameservers: ['NS1.PRIORITY.INVALID.'],
          ipAddresses: ['192.0.2.20'],
          trackingIdentifiers: ['google-analytics:UA-ABC-1'],
          officialAssetHosts: [],
          faviconHash: null,
          faviconPHash: null,
          certificateFingerprint: null,
          truncated: false,
        },
      })],
    }));
    assert.ok(normalized);
    assert.equal(normalized.results.length, 1);
    assert.deepEqual(normalized.results[0]?.relationship.nameservers, ['ns1.priority.invalid']);
    assert.deepEqual(normalized.results[0]?.relationship.trackingIdentifiers, ['google-analytics:UA-ABC-1']);
    assert.deepEqual(normalized.results[0]?.comparisonEvidence?.technology.ids, [
      'shop-platform',
      'web-framework',
    ]);
    assert.equal(normalized.results[0]?.comparisonEvidence?.tls.issuerLabel, 'Example Issuing CA');
    assert.equal(normalized.results[0]?.opportunity, 20);
    assert.equal(normalized.results[0]?.opportunityModelVersion, 2);
    assert.equal(Object.prototype.hasOwnProperty.call(normalized.results[0] || {}, 'registrant'), false);
    assert.equal(JSON.stringify(normalized).includes('private@priority.invalid'), false);
  });

  test('preserves incomplete domain sets for explicit resume', () => {
    const normalized = normalizeBulkSession(session('partial-session', {
      state: 'partial',
      domains: ['first.invalid', 'second.invalid', 'third.invalid'],
      results: [result('first.invalid')],
      completedAt: null,
    }));
    assert.ok(normalized);
    assert.deepEqual(
      normalized.domains.filter((domain) => !new Set(normalized.results.map((item) => item.domain)).has(domain)),
      ['second.invalid', 'third.invalid'],
    );
  });

  test('migrates schemas one to three without presenting profile-derived evidence as current', () => {
    for (const version of [1, 2, 3]) {
      const normalized = normalizeBulkSessionStore({
        schema: BULK_SESSION_SCHEMA,
        version,
        sessions: [session(`legacy-session-${version}`, {
          results: [result('priority.invalid', {
            comparisonEvidence: undefined,
            trusted: 'official',
            faviconMatch: true,
            faviconNearMatch: true,
            reusesOfficialAssets: true,
            idnReferenceMatch: true,
            pageBaselineMatch: true,
            hasActiveBrandProfile: true,
            relationship: {
              ...result().relationship,
              officialAssetHosts: ['assets.priority.invalid'],
            },
          })],
        })],
      });

      const migrated = normalized.sessions[0];
      const migratedResult = migrated?.results[0];
      assert.equal(normalized.version, BULK_SESSION_SCHEMA_VERSION);
      assert.equal(migrated?.id, `legacy-session-${version}`);
      assert.equal(migratedResult?.comparisonEvidence, null);
      assert.equal(migratedResult?.risk, null);
      assert.equal(migratedResult?.riskModelVersion, null);
      assert.deepEqual(migratedResult?.riskFactors, []);
      assert.equal(migratedResult?.trusted, null);
      assert.equal(migratedResult?.faviconMatch, null);
      assert.equal(migratedResult?.faviconNearMatch, null);
      assert.equal(migratedResult?.reusesOfficialAssets, null);
      assert.equal(migratedResult?.idnReferenceMatch, null);
      assert.equal(migratedResult?.pageBaselineMatch, null);
      assert.equal(migratedResult?.hasActiveBrandProfile, null);
      assert.deepEqual(migratedResult?.relationship.officialAssetHosts, []);
      assert.equal(migrated?.profileContext.sourceState, 'unavailable');
      assert.equal(migrated?.profileContext.limitation, BULK_PROFILE_CONTEXT_LEGACY_LIMITATION);
    }
  });

  test('deduplicates, orders, caps, and enforces the serialized store budget', () => {
    let sessions: unknown = [];
    for (let index = 0; index < MAX_BULK_SESSIONS + 3; index += 1) {
      sessions = upsertBulkSession(sessions, session(`session-${index}`, {
        updatedAt: new Date(Date.parse(LATER) + index * 1_000).toISOString(),
      })).sessions;
    }
    const normalized = normalizeBulkSessionStore({
      schema: BULK_SESSION_SCHEMA,
      version: BULK_SESSION_SCHEMA_VERSION,
      sessions,
    });
    assert.equal(normalized.sessions.length, MAX_BULK_SESSIONS);
    assert.equal(normalized.sessions[0]?.id, `session-${MAX_BULK_SESSIONS + 2}`);
    assert.doesNotThrow(() => enforceBulkSessionStoreBudget(normalized));
  });

  test('compares compact observations without treating missing rows as domain removal', () => {
    const comparison = compareBulkSessions(
      session('baseline', { updatedAt: FIRST }),
      session('current', {
        results: [
          result('priority.invalid', {
            availability: 'available',
            risk: 10,
            sourceCoverage: [
              { source: 'rdap', state: 'not_found' },
              { source: 'whois', state: 'unavailable' },
            ],
          }),
          result('added.invalid'),
        ],
        domains: ['priority.invalid', 'added.invalid'],
      }),
    );
    assert.ok(comparison);
    assert.equal(comparison.added, 1);
    assert.equal(comparison.changed, 1);
    assert.equal(comparison.rows.some((row) => row.changes.some((change) => change.includes('source'))), true);
    assert.match(comparison.limitations.join(' '), /does not establish domain removal/i);
  });

  test('compares Risk only under exact ready profile provenance and the same valid model', () => {
    const withContext = (
      id: string,
      context: BulkProfileContextProvenance,
      risk: number,
      riskModelVersion = 5,
    ) => session(id, {
      updatedAt: id === 'baseline' ? FIRST : LATER,
      results: [result('priority.invalid', {
        profileContext: context,
        risk,
        riskModelVersion,
        hasActiveBrandProfile: true,
      })],
    });

    const comparable = compareBulkSessions(
      withContext('baseline', ACTIVE_PROFILE_CONTEXT, 80),
      withContext('current', ACTIVE_PROFILE_CONTEXT, 35),
    );
    assert.ok(comparable?.rows[0]?.changes.some((change) => change.startsWith('Risk:')));
    assert.equal(comparable?.limitations.some((limitation) => limitation.startsWith('Risk deltas are omitted')), false);

    const otherProfileContext = {
      ...ACTIVE_PROFILE_CONTEXT,
      activeProfileId: 'profile-two',
    };
    const mismatchedProfile = compareBulkSessions(
      withContext('baseline', ACTIVE_PROFILE_CONTEXT, 80),
      withContext('current', otherProfileContext, 35),
    );
    assert.equal(mismatchedProfile?.rows.some((row) => row.changes.some((change) => change.startsWith('Risk:'))), false);
    assert.match(mismatchedProfile?.limitations.join(' ') ?? '', /Risk deltas are omitted/u);

    const mismatchedModel = compareBulkSessions(
      withContext('baseline', ACTIVE_PROFILE_CONTEXT, 80, 5),
      withContext('current', ACTIVE_PROFILE_CONTEXT, 35, 6),
    );
    assert.equal(mismatchedModel?.rows.some((row) => row.changes.some((change) => change.startsWith('Risk:'))), false);
    assert.match(mismatchedModel?.limitations.join(' ') ?? '', /same versioned Risk model/u);

    const missingRisk = compareBulkSessions(
      withContext('baseline', ACTIVE_PROFILE_CONTEXT, 80),
      withContext('current', ACTIVE_PROFILE_CONTEXT, Number.NaN),
    );
    assert.equal(missingRisk?.rows.some((row) => row.changes.some((change) => change.startsWith('Risk:'))), false);
    assert.match(missingRisk?.limitations.join(' ') ?? '', /Risk deltas are omitted/u);
  });

  test('exports the current contract and accepts supported legacy sessions non-destructively', () => {
    const exported = buildBulkSessionExport([session()]);
    assert.equal(exported.schema, BULK_SESSION_SCHEMA);
    assert.equal(exported.version, BULK_SESSION_SCHEMA_VERSION);
    assert.equal(exported.sessions[0]?.results[0]?.opportunity, 20);
    assert.equal(exported.sessions[0]?.results[0]?.opportunityModelVersion, 2);
    const merged = mergeBulkSessions([], exported);
    assert.equal(merged.added, 1);
    assert.equal(merged.sessions.length, 1);
    assert.equal(merged.sessions[0]?.results[0]?.opportunity, 20);
    assert.equal(merged.sessions[0]?.results[0]?.opportunityModelVersion, 2);
    assert.equal(mergeBulkSessions([], { ...exported, version: 1 }).added, 1);
    assert.equal(mergeBulkSessions([], { ...exported, version: 2 }).added, 1);
    assert.equal(mergeBulkSessions([], { ...exported, version: 3 }).added, 1);
    assert.throws(
      () => mergeBulkSessions([], { ...exported, version: 5 }),
      /newer schema 5/i,
    );
  });

  test('quarantines every portable profile-derived claim while retaining separately attributed evidence', () => {
    const importedSession = session('portable-session', {
      results: [result('portable.invalid', {
        pageTitle: 'Observed page title',
        faviconHash: 'b'.repeat(64),
        phishingLanguageMatch: 'Observed generic phrase',
        trusted: 'official',
        risk: 96,
        riskModelVersion: 7,
        riskFactors: [{ label: 'Profile match', points: 96 }],
        faviconMatch: true,
        faviconNearMatch: true,
        reusesOfficialAssets: true,
        idnReferenceMatch: true,
        pageBaselineMatch: true,
        hasActiveBrandProfile: true,
        profileContext: ACTIVE_PROFILE_CONTEXT,
        relationship: {
          ...result().relationship,
          officialAssetHosts: ['assets.portable.invalid'],
        },
      })],
      domains: ['portable.invalid'],
    });
    const merged = mergeBulkSessions([], buildBulkSessionExport([importedSession]));
    assert.equal(merged.added, 1);
    const imported = merged.sessions[0];
    const importedRow = imported?.results[0];
    assert.equal(imported?.profileContext.sourceState, 'unavailable');
    assert.equal(imported?.profileContext.activeProfileId, null);
    assert.equal(imported?.profileContext.profileUpdatedAt, null);
    assert.equal(imported?.profileContext.limitation, BULK_PROFILE_CONTEXT_IMPORTED_LIMITATION);
    assert.equal(importedRow?.profileContext.limitation, BULK_PROFILE_CONTEXT_IMPORTED_LIMITATION);
    assert.equal(importedRow?.trusted, null);
    assert.equal(importedRow?.risk, null);
    assert.equal(importedRow?.riskModelVersion, null);
    assert.deepEqual(importedRow?.riskFactors, []);
    assert.equal(importedRow?.faviconMatch, null);
    assert.equal(importedRow?.faviconNearMatch, null);
    assert.equal(importedRow?.reusesOfficialAssets, null);
    assert.equal(importedRow?.idnReferenceMatch, null);
    assert.equal(importedRow?.pageBaselineMatch, null);
    assert.equal(importedRow?.hasActiveBrandProfile, null);
    assert.deepEqual(importedRow?.relationship.officialAssetHosts, []);
    assert.equal(importedRow?.pageTitle, 'Observed page title');
    assert.equal(importedRow?.faviconHash, 'b'.repeat(64));
    assert.equal(importedRow?.phishingLanguageMatch, 'Observed generic phrase');
    assert.deepEqual(importedRow?.dns, normalizeBulkSessionResult(result())?.dns);
    assert.deepEqual(importedRow?.sourceCoverage, normalizeBulkSessionResult(result())?.sourceCoverage);
  });

  test('never replaces a same-id local session using an imported timestamp', () => {
    const local = normalizeBulkSession(session('collision', {
      name: 'Local evidence',
      updatedAt: FIRST,
    }));
    assert.ok(local);
    const imported = buildBulkSessionExport([session('collision', {
      name: 'Attacker replacement',
      updatedAt: LATER,
    })]);
    const merged = mergeBulkSessions([local], imported);
    assert.equal(merged.added, 0);
    assert.equal(merged.updated, 0);
    assert.equal(merged.skipped, 1);
    assert.deepEqual(merged.sessions, [local]);
  });

  test('requires v4 row and session provenance and rejects mismatched declarations', () => {
    assert.equal(normalizeBulkSessionResult(result('priority.invalid', { profileContext: undefined })), null);
    const missingSession = session('missing-session-context');
    Reflect.deleteProperty(missingSession, 'profileContext');
    assert.equal(normalizeBulkSession(missingSession), null);
    assert.equal(normalizeBulkSession(session('mismatch', {
      profileContext: unavailableBulkProfileContext(BULK_PROFILE_CONTEXT_MISMATCH_LIMITATION),
    })), null);
  });
});
