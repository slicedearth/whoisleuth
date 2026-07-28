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
} from '../frontend/src/lib/analysis/bulk-result-model.ts';
import type { BulkSessionResult } from '../frontend/src/lib/analysis/bulk-session-model.ts';

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
    phishingLanguageMatch: null,
    riskModelVersion: 6,
    riskFactors: [{ label: 'Example factor', points: 20 }],
    dns: null,
    dnssec: null,
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
