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

  test('never reports a definitive difference while comparison material is missing or unauthenticated', () => {
    const certificate = Buffer.from('fixture certificate');
    const records = [
      { usage: 3, selector: 0, matchingType: 1, associationData: '00'.repeat(32) },
      { usage: 3, selector: 1, matchingType: 1, associationData: '11'.repeat(32) },
    ];
    const incomplete = analyzeTlsaEvidence({
      serviceName: '_25._tcp.mx.example.test',
      dnssecState: 'validated',
      records,
      certificateDerBase64: certificate.toString('base64'),
    });
    assert.equal(incomplete.records[0]?.state, 'different');
    assert.equal(incomplete.records[1]?.state, 'unavailable');
    assert.equal(incomplete.state, 'partial');

    const unauthenticated = analyzeTlsaEvidence({
      serviceName: '_25._tcp.mx.example.test',
      dnssecState: 'insecure',
      records: [records[0]],
      certificateDerBase64: certificate.toString('base64'),
    });
    assert.equal(unauthenticated.records[0]?.state, 'different');
    assert.equal(unauthenticated.state, 'partial');
  });

  test('treats SMTP PKIX usages as unsupported without hiding unavailable, rejected, or truncated inputs', () => {
    const certificate = Buffer.from('fixture certificate');
    const associationData = createHash('sha256').update(certificate).digest('hex');
    const base = {
      serviceName: '_25._tcp.mx.example.test',
      dnssecState: 'validated',
      pkixValidationState: 'failed',
      certificateDerBase64: certificate.toString('base64'),
    };
    const matched = { usage: 1, selector: 0, matchingType: 1, associationData };
    const unavailable = analyzeTlsaEvidence({
      ...base,
      records: [matched, { usage: 3, selector: 1, matchingType: 1, associationData }],
    });
    assert.equal(unavailable.state, 'partial');
    assert.equal(unavailable.records[0]?.state, 'unsupported');
    assert.equal(unavailable.records[1]?.state, 'unavailable');

    const rejected = analyzeTlsaEvidence({ ...base, records: [matched, { usage: 9 }] });
    assert.equal(rejected.state, 'partial');
    assert.equal(rejected.rejectedCount, 1);

    const truncated = analyzeTlsaEvidence({ ...base, records: Array.from({ length: 51 }, () => matched) });
    assert.equal(truncated.state, 'partial');
    assert.equal(truncated.truncated, true);
  });

  test('treats PKIX-TA usage as unusable for SMTP relay while preserving mixed DANE-EE evidence', () => {
    const authority = Buffer.from('fixture authority certificate');
    const associationData = createHash('sha256').update(authority).digest('hex');
    const input = {
      serviceName: '_25._tcp.mx.example.test',
      dnssecState: 'validated',
      records: [{ usage: 0, selector: 0, matchingType: 1, associationData }],
      authorityMaterials: [{ certificateDerBase64: authority.toString('base64') }],
    };

    assert.equal(analyzeTlsaEvidence(input).state, 'partial');
    assert.equal(analyzeTlsaEvidence({ ...input, pkixValidationState: 'failed' }).state, 'partial');
    const pathValidated = analyzeTlsaEvidence({ ...input, pkixValidationState: 'validated' });
    assert.equal(pathValidated.records[0]?.state, 'unsupported');
    assert.equal(pathValidated.state, 'partial');
    assert.match(pathValidated.limitations.join(' '), /RFC 7672 .* treats those records as unusable/u);

    const different = analyzeTlsaEvidence({
      ...input,
      pkixValidationState: 'validated',
      records: [{ ...input.records[0], associationData: '00'.repeat(32) }],
    });
    assert.equal(different.records[0]?.state, 'unsupported');
    assert.equal(different.state, 'partial');

    const leaf = Buffer.from('fixture PKIX-TA mixed-usage leaf');
    const mixed = analyzeTlsaEvidence({
      ...input,
      pkixValidationState: 'validated',
      certificateDerBase64: leaf.toString('base64'),
      records: [
        input.records[0],
        {
          usage: 3,
          selector: 0,
          matchingType: 1,
          associationData: createHash('sha256').update(leaf).digest('hex'),
        },
      ],
    });
    assert.equal(mixed.state, 'matched');
    assert.match(mixed.limitations.join(' '), /RFC 7672 .* treats those records as unusable/u);
  });

  test('does not complete SMTP DANE from a PKIX-EE usage even when PKIX validates', () => {
    const leaf = Buffer.from('fixture SMTP PKIX-EE leaf');
    const associationData = createHash('sha256').update(leaf).digest('hex');
    const input = {
      serviceName: '_25._tcp.mx.example.test',
      dnssecState: 'validated',
      pkixValidationState: 'validated',
      certificateDerBase64: leaf.toString('base64'),
      records: [{ usage: 1, selector: 0, matchingType: 1, associationData }],
    };
    const unsupported = analyzeTlsaEvidence(input);
    assert.equal(unsupported.records[0]?.state, 'unsupported');
    assert.equal(unsupported.state, 'partial');

    const mixed = analyzeTlsaEvidence({
      ...input,
      records: [
        input.records[0],
        { usage: 3, selector: 0, matchingType: 1, associationData },
      ],
    });
    assert.equal(mixed.records[0]?.state, 'unsupported');
    assert.equal(mixed.records[1]?.state, 'matched');
    assert.equal(mixed.state, 'matched');
  });

  test('does not treat an observed leaf certificate as DANE-TA authority material', () => {
    const leaf = Buffer.from('fixture leaf certificate');
    const result = analyzeTlsaEvidence({
      serviceName: '_25._tcp.mx.example.test',
      dnssecState: 'validated',
      records: [{
        usage: 2,
        selector: 0,
        matchingType: 1,
        associationData: createHash('sha256').update(leaf).digest('hex'),
      }],
      certificateDerBase64: leaf.toString('base64'),
    });

    assert.equal(result.records[0]?.state, 'unavailable');
    assert.equal(result.state, 'partial');
    assert.notEqual(result.state, 'matched');
  });

  test('keeps DANE-TA association comparisons partial without a validated leaf-to-anchor path', () => {
    const leaf = Buffer.from('unrelated fixture leaf certificate');
    const authority = Buffer.from('fixture trust anchor certificate');
    const associationData = createHash('sha256').update(authority).digest('hex');
    const base = {
      serviceName: '_25._tcp.mx.example.test',
      dnssecState: 'validated',
      certificateDerBase64: leaf.toString('base64'),
      authorityMaterials: [{ certificateDerBase64: authority.toString('base64') }],
    };
    const matched = analyzeTlsaEvidence({
      ...base,
      records: [{ usage: 2, selector: 0, matchingType: 1, associationData }],
    });
    assert.equal(matched.records[0]?.state, 'matched');
    assert.equal(matched.state, 'partial');
    assert.match(matched.limitations.join(' '), /no certificate path from the observed leaf/u);

    const different = analyzeTlsaEvidence({
      ...base,
      records: [{ usage: 2, selector: 0, matchingType: 1, associationData: '00'.repeat(32) }],
    });
    assert.equal(different.records[0]?.state, 'different');
    assert.equal(different.state, 'partial');
  });

  test('keeps mixed-usage result states independent from the DANE-TA path limitation', () => {
    const leaf = Buffer.from('fixture mixed-usage leaf certificate');
    const authority = Buffer.from('fixture mixed-usage trust anchor');
    const records = [
      {
        usage: 2,
        selector: 0,
        matchingType: 1,
        associationData: createHash('sha256').update(authority).digest('hex'),
      },
      {
        usage: 3,
        selector: 0,
        matchingType: 1,
        associationData: createHash('sha256').update(leaf).digest('hex'),
      },
    ];
    const input = {
      serviceName: '_25._tcp.mx.example.test',
      records,
      certificateDerBase64: leaf.toString('base64'),
      authorityMaterials: [{ certificateDerBase64: authority.toString('base64') }],
    };

    const matched = analyzeTlsaEvidence({ ...input, dnssecState: 'validated' });
    assert.equal(matched.state, 'matched');
    assert.match(matched.limitations.join(' '), /usage-2 association cannot complete DANE-TA assurance/u);
    assert.doesNotMatch(matched.limitations.join(' '), /overall result remains partial/u);

    const untrusted = analyzeTlsaEvidence({ ...input, dnssecState: 'bogus' });
    assert.equal(untrusted.state, 'untrusted');
    assert.match(untrusted.limitations.join(' '), /usage-2 association cannot complete DANE-TA assurance/u);
    assert.doesNotMatch(untrusted.limitations.join(' '), /overall result remains partial/u);
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
