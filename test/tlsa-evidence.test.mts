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
      serviceName: '_25._tcp.mx.example.test',
      records: [{ usage: 3, selector: 0, matchingType: 1, associationData }],
      certificateDerBase64: certificate.toString('base64'),
    };

    assert.equal(analyzeTlsaEvidence({ ...input, dnssecState: 'validated' }).state, 'matched');
    assert.equal(analyzeTlsaEvidence({ ...input, dnssecState: 'unavailable' }).state, 'partial');
  });

  test('compares SPKI material independently from the certificate', () => {
    const spki = Buffer.from('fixture public key');
    const result = analyzeTlsaEvidence({
      serviceName: '_25._tcp.mx.example.test',
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
      serviceName: '_25._tcp.mx.example.test',
      dnssecState: 'validated',
      records: [{ usage: 3, selector: 0, matchingType: 1, associationData: '00'.repeat(32) }],
      certificateDerBase64: certificate.toString('base64'),
    });
    assert.equal(different.state, 'different');

    const partial = analyzeTlsaEvidence({
      serviceName: '_25._tcp.mx.example.test',
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

  test('requires the right certificate role and PKIX prerequisite for each usage', () => {
    const authority = Buffer.from('fixture authority certificate');
    const associationData = createHash('sha256').update(authority).digest('hex');
    const input = {
      serviceName: '_25._tcp.mx.example.test',
      dnssecState: 'validated',
      records: [{ usage: 0, selector: 0, matchingType: 1, associationData }],
      authorityMaterials: [{ certificateDerBase64: authority.toString('base64') }],
    };

    assert.equal(analyzeTlsaEvidence(input).state, 'partial');
    assert.equal(analyzeTlsaEvidence({ ...input, pkixValidationState: 'failed' }).state, 'untrusted');
    assert.equal(analyzeTlsaEvidence({ ...input, pkixValidationState: 'validated' }).state, 'matched');
  });

  test('rejects unbound services and avoids definitive differences after truncation', () => {
    assert.equal(analyzeTlsaEvidence({
      serviceName: 'mx.example.test',
      dnssecState: 'validated',
      records: [],
    }).state, 'invalid');

    const result = analyzeTlsaEvidence({
      serviceName: '_25._tcp.mx.example.test',
      dnssecState: 'validated',
      records: [{ usage: 2, selector: 0, matchingType: 1, associationData: '00'.repeat(32) }],
      authorityMaterials: Array.from({ length: 11 }, (_, index) => ({
        certificateDerBase64: Buffer.from(`authority ${index}`).toString('base64'),
      })),
    });
    assert.equal(result.state, 'partial');
    assert.equal(result.authorityMaterialTruncated, true);
  });
});
