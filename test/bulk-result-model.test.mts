import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  boundedStrings,
  bulkSessionInputDigest,
  compactContact,
  compactDnsEvidence,
  compactSourceCoverage,
  createBulkSessionId,
  fromBulkSessionResult,
  reconcileBulkResultProfileContext,
} from '../frontend/src/lib/analysis/bulk-result-model.ts';
import {
  BULK_PROFILE_CONTEXT_MISMATCH_LIMITATION,
  type BulkProfileContextProvenance,
  type BulkSessionResult,
} from '../frontend/src/lib/analysis/bulk-session-model.ts';

const READY_PROFILE_CONTEXT: BulkProfileContextProvenance = {
  sourceState: 'ready',
  activeProfileId: 'profile-one',
  profileUpdatedAt: '2026-08-01T00:00:00.000Z',
  limitation: '',
};

function sessionResult(overrides: Partial<BulkSessionResult> = {}): BulkSessionResult {
  return {
    domain: 'example.test',
    status: 'complete',
    availability: 'registered',
    confidence: 'high',
    registrar: 'Example Registrar',
    activity: 'Active',
    risk: 20,
    opportunity: null,
    mutationTypes: ['omission'],
    trusted: null,
    error: '',
    scanDepth: 'deep',
    createdDate: null,
    expiryDate: null,
    nameservers: ['ns1.example.test'],
    hasMx: true,
    hasNullMx: false,
    hasSpf: null,
    hasDmarc: false,
    activityStatus: 'active',
    pageTitle: 'Example',
    faviconHash: null,
    faviconPHash: null,
    faviconMatch: false,
    faviconNearMatch: false,
    reusesOfficialAssets: false,
    hasPasswordField: false,
    hasExternalFormAction: null,
    phishingLanguageMatch: null,
    riskModelVersion: 6,
    riskFactors: [{ label: 'Example factor', points: 20 }],
    dns: null,
    dnssec: null,
    comparisonEvidence: {
      version: 1,
      technology: { state: 'success', ids: ['shop-platform'], truncated: false },
      tls: {
        state: 'success',
        issuerLabel: 'Example Issuing CA',
        spkiSha256: 'a'.repeat(64),
      },
    },
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
    profileContext: READY_PROFILE_CONTEXT,
    ...overrides,
  };
}

describe('Bulk result model', () => {
  it('bounds compact strings, contact fields, and DNS records', () => {
    assert.deepEqual(
      boundedStrings(['kept', 'bad\nvalue', 'x'.repeat(501)]),
      ['kept'],
    );
    assert.deepEqual(compactContact({
      name: 'Registrant',
      org: 'Example Org',
      email: 'contact@example.test',
      ignored: 'raw',
    }), {
      name: 'Registrant',
      org: 'Example Org',
      email: 'contact@example.test',
    });
    assert.deepEqual(compactDnsEvidence({
      status: 'success',
      records: {
        a: ['192.0.2.10'],
        aaaa: [],
        cname: ['www.example.test'],
        caa: [{ critical: 0, tag: 'issue', value: 'ca.example.test' }],
      },
    }), {
      status: 'success',
      records: {
        a: ['192.0.2.10'],
        aaaa: [],
        cname: ['www.example.test'],
        caa: [{ critical: 0, tag: 'issue', value: 'ca.example.test' }],
      },
    });
  });

  it('normalizes legacy CAA critical strings and drops malformed flags', () => {
    assert.deepEqual(compactDnsEvidence({
      status: 'success',
      records: {
        caa: [
          { critical: '128', tag: 'issue', value: 'ca.example.test' },
          { critical: '0\rFORMULA', tag: 'issue', value: 'discard.example.test' },
          { critical: 256, tag: 'issue', value: 'discard-too.example.test' },
        ],
      },
    })?.records.caa, [{ critical: 128, tag: 'issue', value: 'ca.example.test' }]);
  });

  it('keeps source health separate and maps only supported states', () => {
    const body = {
      availability: {
        applicable: true as const,
        domain: 'example.test',
        state: 'registered' as const,
        confidence: 'high' as const,
      },
      diagnostics: {
        version: 7 as const,
        rdap: { status: 'success' },
        whois: { status: 'disabled' },
        availability: { status: 'partial' },
      },
    };
    assert.deepEqual(compactSourceCoverage(body, {
      dns: { status: 'unsupported' },
      http: { status: 'future' },
      tls: { status: 'error' },
    }), [
      { source: 'rdap', state: 'complete' },
      { source: 'whois', state: 'skipped' },
      { source: 'availability', state: 'partial' },
      { source: 'dns', state: 'unsupported' },
      { source: 'tls', state: 'error' },
    ]);
  });

  it('restores compact session rows without inventing excluded evidence', () => {
    const restored = fromBulkSessionResult(sessionResult(), ['official.example']);
    assert.equal(restored.domain, 'example.test');
    assert.equal(restored.saved.riskScore, 20);
    assert.equal(restored.registrant, null);
    assert.equal(restored.abuseEvidence, null);
    assert.equal(restored.ct, null);
    assert.deepEqual(restored.comparisonEvidence?.technology.ids, ['shop-platform']);
  });

  it('retains only profile-derived evidence proven against the current profile revision', () => {
    const restored = fromBulkSessionResult(sessionResult({
      trusted: 'official',
      faviconMatch: true,
      faviconNearMatch: true,
      reusesOfficialAssets: true,
      idnReferenceMatch: true,
      pageBaselineMatch: true,
      hasActiveBrandProfile: true,
      relationship: {
        ...sessionResult().relationship,
        officialAssetHosts: ['assets.example.test'],
      },
    }), ['example.test']);

    const matched = reconcileBulkResultProfileContext(restored, READY_PROFILE_CONTEXT);
    assert.equal(matched.risk, 20);
    assert.equal(matched.trusted, 'official');
    assert.equal(matched.saved.idnReferenceMatch, true);
    assert.deepEqual(matched.relationship.officialAssetHosts, ['assets.example.test']);

    const mismatched = reconcileBulkResultProfileContext(restored, {
      ...READY_PROFILE_CONTEXT,
      activeProfileId: 'profile-two',
    });
    assert.equal(mismatched.risk, null);
    assert.equal(mismatched.trusted, null);
    assert.equal(mismatched.faviconMatch, null);
    assert.equal(mismatched.faviconNearMatch, null);
    assert.equal(mismatched.reusesOfficialAssets, null);
    assert.equal(mismatched.saved.idnReferenceMatch, null);
    assert.equal(mismatched.saved.pageBaselineMatch, null);
    assert.equal(mismatched.saved.hasActiveBrandProfile, null);
    assert.equal(mismatched.saved.riskModelVersion, null);
    assert.deepEqual(mismatched.saved.riskFactors, []);
    assert.deepEqual(mismatched.relationship.officialAssetHosts, []);
    assert.equal(mismatched.saved.profileContext.sourceState, 'unavailable');
    assert.equal(mismatched.saved.profileContext.limitation, BULK_PROFILE_CONTEXT_MISMATCH_LIMITATION);
  });

  it('produces stable mode-sensitive digests and injectable identifiers', async () => {
    const first = await bulkSessionInputDigest(['a.example.test', 'b.example.test'], 'fast');
    assert.equal(first, await bulkSessionInputDigest(['a.example.test', 'b.example.test'], 'fast'));
    assert.notEqual(first, await bulkSessionInputDigest(['a.example.test', 'b.example.test'], 'deep'));
    assert.match(first, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(createBulkSessionId({ randomUUID: () => 'session-id' }), 'session-id');
    assert.equal(createBulkSessionId({
      randomUUID: false,
      now: () => 42,
      random: () => 0.5,
    }), 'bulk-42-i');
  });
});
