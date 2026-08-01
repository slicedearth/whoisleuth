import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  BULK_SESSION_SCHEMA,
  BULK_SESSION_SCHEMA_VERSION,
  MAX_BULK_SESSIONS,
  buildBulkSessionExport,
  compareBulkSessions,
  enforceBulkSessionStoreBudget,
  mergeBulkSessions,
  normalizeBulkSession,
  normalizeBulkSessionStore,
  upsertBulkSession,
} from '../frontend/src/lib/analysis/bulk-session-model.ts';
import { normalizeCaaCritical } from '../frontend/src/lib/analysis/dns-record-normalization.ts';

const FIRST = '2026-07-28T01:00:00.000Z';
const LATER = '2026-07-29T01:00:00.000Z';
const DIGEST = `sha256:${'a'.repeat(64)}`;

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
    ...overrides,
  };
}

function session(id = 'session-one', overrides: Record<string, unknown> = {}) {
  return {
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
}

describe('saved Bulk sessions', () => {
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

  test('migrates schema-one sessions without inventing comparison evidence', () => {
    const normalized = normalizeBulkSessionStore({
      schema: BULK_SESSION_SCHEMA,
      version: 1,
      sessions: [session('legacy-session', {
        results: [result('priority.invalid', { comparisonEvidence: undefined })],
      })],
    });

    assert.equal(normalized.version, BULK_SESSION_SCHEMA_VERSION);
    assert.equal(normalized.sessions[0]?.id, 'legacy-session');
    assert.equal(normalized.sessions[0]?.results[0]?.comparisonEvidence, null);
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

  test('exports the current contract and accepts supported legacy sessions non-destructively', () => {
    const exported = buildBulkSessionExport([session()]);
    assert.equal(exported.schema, BULK_SESSION_SCHEMA);
    assert.equal(exported.version, BULK_SESSION_SCHEMA_VERSION);
    const merged = mergeBulkSessions([], exported);
    assert.equal(merged.added, 1);
    assert.equal(merged.sessions.length, 1);
    assert.equal(mergeBulkSessions([], { ...exported, version: 1 }).added, 1);
    assert.throws(
      () => mergeBulkSessions([], { ...exported, version: 3 }),
      /newer schema 3/i,
    );
  });
});
