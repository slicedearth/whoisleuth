import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import { analyzeTlsaEvidence } from '../lib/tlsa-evidence.mts';

describe('offline TLSA evidence review', () => {
  test('requires validated DNSSEC before treating a certificate match as usable', () => {
    const certificate = Buffer.from('fixture certificate');
    const associationData = createHash('sha256').update(certificate).digest('hex');
    const input = {
      records: [{ usage: 3, selector: 0, matchingType: 1, associationData }],
      certificateDerBase64: certificate.toString('base64'),
    };

    assert.equal(analyzeTlsaEvidence({ ...input, dnssecState: 'validated' }).state, 'matched');
    assert.equal(analyzeTlsaEvidence({ ...input, dnssecState: 'unavailable' }).state, 'partial');
  });

  test('compares SPKI material independently from the certificate', () => {
    const spki = Buffer.from('fixture public key');
    const result = analyzeTlsaEvidence({
      dnssecState: 'validated',
      records: [{ usage: 3, selector: 1, matchingType: 2, associationData: createHash('sha512').update(spki).digest('hex') }],
      certificateDerBase64: Buffer.from('different certificate').toString('base64'),
      spkiDerBase64: spki.toString('base64'),
    });
    assert.equal(result.state, 'matched');
    assert.equal(result.records[0]?.state, 'matched');
  });

  test('keeps differences, unavailable material, and malformed records explicit', () => {
    const certificate = Buffer.from('fixture certificate');
    const different = analyzeTlsaEvidence({
      dnssecState: 'validated',
      records: [{ usage: 3, selector: 0, matchingType: 1, associationData: '00'.repeat(32) }],
      certificateDerBase64: certificate.toString('base64'),
    });
    assert.equal(different.state, 'different');

    const partial = analyzeTlsaEvidence({
      dnssecState: 'validated',
      records: [
        { usage: 3, selector: 1, matchingType: 1, associationData: '00'.repeat(32) },
        { usage: 9, selector: 0, matchingType: 1, associationData: '00'.repeat(32) },
      ],
    });
    assert.equal(partial.state, 'partial');
    assert.equal(partial.records[0]?.state, 'unavailable');
    assert.equal(partial.rejectedCount, 1);
  });
});
