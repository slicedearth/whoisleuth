import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import {
  dnskeyTag,
  validateDnssecEvidence,
} from '../lib/dnssec-evidence-validation.mts';

function fixture() {
  const publicKeyBase64 = Buffer.from([1, 2, 3, 4]).toString('base64');
  const rdata = Buffer.concat([
    Buffer.from([1, 1, 3, 13]),
    Buffer.from(publicKeyBase64, 'base64'),
  ]);
  const owner = Buffer.concat([
    Buffer.from([7]), Buffer.from('example'),
    Buffer.from([4]), Buffer.from('test'),
    Buffer.from([0]),
  ]);
  return {
    publicKeyBase64,
    keyTag: dnskeyTag(rdata),
    digest: createHash('sha256').update(owner).update(rdata).digest('hex'),
  };
}

describe('offline DNSSEC evidence validation', () => {
  test('verifies a supplied DS and DNSKEY digest relationship', () => {
    const value = fixture();
    const result = validateDnssecEvidence({
      ownerName: 'Example.Test.',
      delegationSigned: true,
      dsRecords: [{ keyTag: value.keyTag, algorithm: 13, digestType: 2, digest: value.digest }],
      dnskeyRecords: [{ flags: 257, protocol: 3, algorithm: 13, publicKeyBase64: value.publicKeyBase64 }],
      observedAt: '2026-08-03T00:00:00.000Z',
      rrSigRecords: [{ inception: '2026-08-01T00:00:00.000Z', expiration: '2026-08-10T00:00:00.000Z' }],
    });

    assert.equal(result.state, 'consistent');
    assert.equal(result.ownerName, 'example.test');
    assert.equal(result.matchedDsCount, 1);
    assert.equal(result.rrsigRecordCount, 1);
    assert.equal(result.signatureTimeState, 'within_window');
  });

  test('keeps unsigned, incomplete, and conflicting evidence distinct', () => {
    assert.equal(validateDnssecEvidence({
      ownerName: 'example.test',
      delegationSigned: false,
      dsRecords: [],
    }).state, 'unsigned');

    assert.equal(validateDnssecEvidence({
      ownerName: 'example.test',
      delegationSigned: true,
      dsRecords: [],
    }).state, 'conflict');

    const value = fixture();
    assert.equal(validateDnssecEvidence({
      ownerName: 'example.test',
      delegationSigned: true,
      dsRecords: [{ keyTag: value.keyTag, algorithm: 13, digestType: 2, digest: '00'.repeat(32) }],
      dnskeyRecords: [{ flags: 257, protocol: 3, algorithm: 13, publicKeyBase64: value.publicKeyBase64 }],
    }).state, 'conflict');

    assert.equal(validateDnssecEvidence({
      ownerName: 'example.test',
      dsRecords: [{ keyTag: value.keyTag, algorithm: 13, digestType: 2, digest: value.digest }],
    }).state, 'partial');
  });

  test('rejects malformed records and reports expired signature windows', () => {
    const result = validateDnssecEvidence({
      ownerName: 'example.test',
      delegationSigned: true,
      dsRecords: [{ keyTag: -1, algorithm: 13, digestType: 2, digest: 'bad' }],
      dnskeyRecords: [{ flags: 257, protocol: 3, algorithm: 13, publicKeyBase64: 'not base64' }],
      observedAt: '2026-08-03T00:00:00.000Z',
      rrSigRecords: [{ inception: '2026-07-01T00:00:00.000Z', expiration: '2026-07-02T00:00:00.000Z' }],
    });
    assert.equal(result.state, 'conflict');
    assert.equal(result.rejectedCount, 2);
    assert.equal(result.signatureTimeState, 'outside_window');
  });

  test('keeps mixed signature windows and malformed signatures from becoming a complete result', () => {
    const value = fixture();
    const result = validateDnssecEvidence({
      ownerName: 'example.test',
      delegationSigned: true,
      dsRecords: [{ keyTag: value.keyTag, algorithm: 13, digestType: 2, digest: value.digest }],
      dnskeyRecords: [{ flags: 257, protocol: 3, algorithm: 13, publicKeyBase64: value.publicKeyBase64 }],
      observedAt: '2026-08-03T00:00:00.000Z',
      rrSigRecords: [
        { inception: '2026-08-01T00:00:00.000Z', expiration: '2026-08-10T00:00:00.000Z' },
        { inception: '2026-07-01T00:00:00.000Z', expiration: '2026-07-02T00:00:00.000Z' },
        { inception: 'invalid', expiration: 'invalid' },
      ],
    });
    assert.equal(result.state, 'partial');
    assert.equal(result.rrsigRecordCount, 2);
    assert.equal(result.rejectedCount, 1);
    assert.equal(result.signatureTimeState, 'mixed');
  });
});
