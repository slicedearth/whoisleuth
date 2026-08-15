import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  canonicalBulkTargets,
  normalizeBulkScanResult,
} from '../frontend/src/lib/analysis/bulk-scan-normalizer.ts';
import { toBulkSessionResult } from '../frontend/src/lib/analysis/bulk-result-model.ts';
import { normalizeBulkSessionResult } from '../frontend/src/lib/analysis/bulk-session-model.ts';
import type { CompactLookupHttpResponse } from '../frontend/src/lib/analysis/lookup-response.ts';

describe('Bulk scan normalizer', () => {
  test('retains only bounded derived evidence with separate source states', () => {
    const body = {
      availability: {
        applicable: true,
        domain: 'candidate.example',
        state: 'registered',
        confidence: 'high',
        registrar: { name: 'Example Registrar' },
        nameservers: ['ns1.candidate.example'],
        registrant: {
          name: 'Example Registrant',
          email: 'review@example.test',
          raw: 'must not persist',
        },
        abuse: { email: 'abuse@example.test', raw: 'must not persist' },
        hasMx: true,
        hasSpf: false,
        hasDmarc: null,
        dns: {
          status: 'success',
          records: { a: ['192.0.2.10'], aaaa: [], cname: [], caa: [] },
        },
        pageIdentity: { publicationMetadata: { version: 1, marker: 'publication metadata must not persist' } },
        http: { response: { deliveryMetadata: { version: 1, marker: 'delivery metadata must not persist' } } },
      },
      diagnostics: {
        version: 7,
        rdap: { status: 'complete' },
        whois: { status: 'skipped' },
        availability: { status: 'complete' },
      },
    } as unknown as CompactLookupHttpResponse;

    const result = normalizeBulkScanResult(body, {
      targetDomain: 'candidate.example',
      mode: 'deep',
      profile: null,
      candidate: {
        domain: 'candidate.example',
        source: 'manual',
        mutationTypes: ['dictionary'],
        certificateTransparency: null,
      },
    });

    assert.equal(result.domain, 'candidate.example');
    assert.equal(result.saved.scanDepth, 'deep');
    assert.equal(result.registrar, 'Example Registrar');
    assert.deepEqual(result.mutationTypes, ['dictionary']);
    assert.deepEqual(result.registrant, {
      name: 'Example Registrant',
      org: null,
      email: 'review@example.test',
    });
    assert.deepEqual(result.abuseEvidence, { abuseEmail: 'abuse@example.test' });
    assert.deepEqual(result.sourceCoverage, [
      { source: 'rdap', state: 'complete' },
      { source: 'whois', state: 'skipped' },
      { source: 'availability', state: 'complete' },
      { source: 'dns', state: 'complete' },
    ]);
    assert.doesNotMatch(JSON.stringify(result), /must not persist|publication metadata|delivery metadata/u);

    assert.equal(result.saved.profileContext.sourceState, 'ready');
    assert.equal(result.saved.profileContext.activeProfileId, null);
    assert.equal(result.saved.hasActiveBrandProfile, false);
    assert.equal(result.faviconMatch, false);
    assert.equal(result.reusesOfficialAssets, false);
    assert.ok(result.risk !== null && result.risk > 0);
    assert.ok(result.saved.riskModelVersion !== null);
    assert.ok(result.saved.riskFactors.length > 0);

    const portableRow = toBulkSessionResult(result);
    const persisted = normalizeBulkSessionResult(portableRow);
    assert.ok(persisted);
    assert.equal(persisted.risk, result.risk);
    assert.equal(persisted.riskModelVersion, result.saved.riskModelVersion);
    assert.deepEqual(persisted.riskFactors, result.saved.riskFactors);
    assert.equal(persisted.trusted, null);
    assert.equal(persisted.faviconMatch, false);
    assert.deepEqual(persisted.relationship.officialAssetHosts, []);
  });

  test('persists null rather than negative profile conclusions when profile context is unavailable', () => {
    const body = {
      availability: {
        applicable: true,
        domain: 'candidate.invalid',
        state: 'registered',
        confidence: 'high',
        faviconHash: 'a'.repeat(64),
      },
      diagnostics: {
        version: 7,
        rdap: { status: 'complete' },
        whois: { status: 'skipped' },
        availability: { status: 'complete' },
      },
    } as const satisfies CompactLookupHttpResponse;
    const result = normalizeBulkScanResult(body, {
      targetDomain: 'candidate.invalid',
      mode: 'deep',
      profile: null,
      profileSourceState: 'unavailable',
      candidate: null,
    });

    assert.equal(result.trusted, null);
    assert.equal(result.faviconMatch, null);
    assert.equal(result.faviconNearMatch, null);
    assert.equal(result.reusesOfficialAssets, null);
    assert.equal(result.risk, null);
    assert.equal(result.saved.hasActiveBrandProfile, null);
    assert.equal(result.saved.faviconMatch, null);
    assert.equal(result.saved.faviconNearMatch, null);
    assert.equal(result.saved.reusesOfficialAssets, null);
    assert.equal(result.saved.idnReferenceMatch, null);
    assert.equal(result.saved.pageBaselineMatch, null);
    assert.equal(result.saved.riskModelVersion, null);
    assert.equal(result.saved.riskScore, null);
    assert.deepEqual(result.saved.riskFactors, []);
    assert.equal(result.saved.profileContext.sourceState, 'unavailable');
    assert.match(result.saved.profileContext.limitation, /remain inconclusive/u);

    const persisted = normalizeBulkSessionResult(toBulkSessionResult(result));
    assert.ok(persisted);
    assert.equal(persisted.risk, null);
    assert.equal(persisted.riskModelVersion, null);
    assert.deepEqual(persisted.riskFactors, []);
    assert.equal(persisted.idnReferenceMatch, null);
    assert.equal(persisted.pageBaselineMatch, null);
    assert.equal(persisted.profileContext.sourceState, 'unavailable');
    assert.match(persisted.profileContext.limitation, /remain inconclusive/u);
  });

  test('canonicalises and de-duplicates registrable collection targets before requests', () => {
    assert.deepEqual(canonicalBulkTargets([
      'BÜCHER.example.',
      'xn--bcher-kva.example',
      'portal.example.test',
      'example.test',
      'BAD_VALUE',
    ]), [
      'xn--bcher-kva.example',
      'example.test',
      'bad_value',
    ]);
  });

  test('uses the validated registrable evidence target as every Bulk row identity', () => {
    const body = {
      availability: {
        applicable: true,
        domain: 'example.test',
        state: 'registered',
        confidence: 'high',
      },
      diagnostics: {
        version: 7,
        rdap: { status: 'complete' },
        whois: { status: 'skipped' },
        availability: { status: 'complete' },
      },
    } as const satisfies CompactLookupHttpResponse;

    const result = normalizeBulkScanResult(body, {
      targetDomain: 'example.test',
      mode: 'fast',
      profile: null,
      candidate: null,
    });

    assert.equal(body.availability.domain, 'example.test');
    assert.equal(result.domain, 'example.test');
    assert.equal(result.saved.domain, 'example.test');
    assert.equal(toBulkSessionResult(result).domain, 'example.test');
  });

  test('rejects a result whose registrable evidence target differs from the queued target', () => {
    const body = {
      availability: {
        applicable: true,
        domain: 'example.test',
        state: 'registered',
        confidence: 'high',
      },
      diagnostics: {
        version: 7,
        rdap: { status: 'complete' },
        whois: { status: 'skipped' },
        availability: { status: 'complete' },
      },
    } as const satisfies CompactLookupHttpResponse;

    assert.throws(() => normalizeBulkScanResult(body, {
      targetDomain: 'other.test',
      mode: 'fast',
      profile: null,
      candidate: null,
    }), /does not match its registrable-domain evidence/u);
  });
});
