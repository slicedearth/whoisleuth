import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  compareTrustStoreEvidence,
  TRUST_STORE_COMPARISON_INPUT_SCHEMA,
} from '../lib/trust-store-comparison.mts';

const NOW = '2026-08-05T10:00:00.000Z';
const LEAF = 'a'.repeat(64);
const ROOT = 'b'.repeat(64);

function input() {
  return {
    schema: TRUST_STORE_COMPARISON_INPUT_SCHEMA,
    version: 1,
    certificate: {
      source: 'Saved Deep Lookup TLS observation',
      observedAt: NOW,
      state: 'observed',
      chainTruncated: false,
      fingerprintsSha256: [LEAF, ROOT],
      runtimeAuthorisation: 'authorised',
    },
    stores: [
      { name: 'Fixture desktop store', version: '2026-08', source: 'Reviewed fixture', reviewedAt: NOW, state: 'observed', anchorsSha256: [ROOT] },
      { name: 'Fixture mobile store', version: '2026-07', source: 'Reviewed fixture', reviewedAt: NOW, state: 'observed', anchorsSha256: ['c'.repeat(64)] },
    ],
  };
}

describe('offline trust-store fingerprint comparison', () => {
  test('keeps exact anchor intersection separate from complete non-observation', () => {
    const result = compareTrustStoreEvidence(input(), NOW);
    assert.equal(result.state, 'complete');
    assert.deepEqual(result.comparisons.map((comparison) => comparison.state), ['anchor_observed', 'not_observed']);
    assert.deepEqual(result.comparisons[0]?.matchedAnchorSha256, [ROOT]);
    assert.equal(result.certificate.leafSha256, LEAF);
    assert.equal(result.certificate.runtimeAuthorisation, 'authorised');
    assert.match(result.limitations.join(' '), /does not build or validate a certificate path/iu);
  });

  test('preserves the supplied certificate-chain order when identifying the leaf', () => {
    const reversedLexicalOrder = input();
    const first = 'f'.repeat(64);
    const second = '0'.repeat(64);
    reversedLexicalOrder.certificate.fingerprintsSha256 = [first, second];
    const result = compareTrustStoreEvidence(reversedLexicalOrder, NOW);
    assert.equal(result.certificate.leafSha256, first);
  });

  test('keeps non-observation inconclusive when either input is partial', () => {
    const partial = input();
    partial.certificate.state = 'partial';
    partial.certificate.chainTruncated = true;
    const result = compareTrustStoreEvidence(partial, NOW);
    assert.equal(result.state, 'partial');
    assert.equal(result.comparisons[1]?.state, 'inconclusive');
    assert.equal(result.comparisons[0]?.state, 'anchor_observed');
  });

  test('rejects malformed digests, unavailable evidence with values, and extra fields', () => {
    const malformed = input();
    malformed.stores[0]!.anchorsSha256 = ['not-a-digest'];
    assert.throws(() => compareTrustStoreEvidence(malformed, NOW), /SHA-256 hexadecimal digest/iu);
    const unavailable = input();
    unavailable.stores[0]!.state = 'unavailable';
    assert.throws(() => compareTrustStoreEvidence(unavailable, NOW), /cannot contain anchors/iu);
    assert.throws(() => compareTrustStoreEvidence({ ...input(), target: 'hidden.example.test' }, NOW), /unknown field/iu);
  });
});
