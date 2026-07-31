import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_BULK_TECHNOLOGY_IDS,
  buildBulkComparisonEvidence,
} from '../lib/bulk-comparison-evidence.mts';

test('builds a bounded stable comparison projection from Deep evidence', () => {
  const evidence = buildBulkComparisonEvidence({
    technologyProfile: {
      status: 'success',
      findings: [
        { id: 'shop-platform' },
        { id: 'WEB-FRAMEWORK' },
        { id: 'shop-platform' },
        ...Array.from({ length: 20 }, (_, index) => ({ id: `technology-${index}` })),
        { id: 'bad id' },
      ],
    },
    tls: {
      source: 'tls',
      status: 'partial',
      certificate: {
        issuer: {
          commonNames: ['Example Issuing CA'],
          organizations: ['Example Trust Services'],
        },
        publicKey: { fingerprintSha256: 'A'.repeat(64) },
      },
    },
  });

  assert.equal(evidence.version, 1);
  assert.equal(evidence.technology.state, 'success');
  assert.equal(evidence.technology.ids.length, MAX_BULK_TECHNOLOGY_IDS);
  assert.equal(evidence.technology.truncated, true);
  assert.deepEqual(evidence.technology.ids.slice(0, 2), ['shop-platform', 'technology-0']);
  assert.equal(evidence.tls.state, 'partial');
  assert.equal(evidence.tls.issuerLabel, 'Example Issuing CA · Example Trust Services');
  assert.equal(evidence.tls.spkiSha256, 'a'.repeat(64));
});

test('keeps unavailable evidence explicit without manufacturing negative observations', () => {
  assert.deepEqual(buildBulkComparisonEvidence({
    technologyProfile: { status: 'skipped', findings: [{ id: 'must-not-be-used' }] },
    tls: { status: 'error', certificate: { publicKey: { fingerprintSha256: 'invalid' } } },
  }), {
    version: 1,
    technology: {
      state: 'unavailable',
      ids: [],
      truncated: false,
    },
    tls: {
      state: 'error',
      issuerLabel: null,
      spkiSha256: null,
    },
  });
});
