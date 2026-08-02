import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { normalizeBulkScanResult } from '../frontend/src/lib/analysis/bulk-scan-normalizer.ts';
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
      },
      diagnostics: {
        version: 7,
        rdap: { status: 'complete' },
        whois: { status: 'skipped' },
        availability: { status: 'complete' },
      },
    } as const satisfies CompactLookupHttpResponse;

    const result = normalizeBulkScanResult(body, {
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
    assert.doesNotMatch(JSON.stringify(result), /must not persist/u);
  });
});
