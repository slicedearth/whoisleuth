import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import {
  CRYPTOGRAPHIC_ASSURANCE_INPUT_SCHEMA,
  CRYPTOGRAPHIC_ASSURANCE_INPUT_VERSION,
  CRYPTOGRAPHIC_ASSURANCE_REVIEW_VERSION,
  buildCryptographicAssuranceReview,
} from '../lib/cryptographic-assurance.mts';

const OBSERVED_AT = '2026-08-11T00:00:00.000Z';

function wrapper(evidence: Record<string, unknown>, source: string) {
  return { source, observedAt: OBSERVED_AT, evidence };
}

describe('separate cryptographic assurance review', () => {
  test('keeps DNSSEC, route-origin, and DANE or TLSA states in independent cards', () => {
    const review = buildCryptographicAssuranceReview({
      schema: CRYPTOGRAPHIC_ASSURANCE_INPUT_SCHEMA,
      version: 1,
      dnssec: wrapper({ ownerName: 'example.test', delegationSigned: false, dsRecords: [] }, 'Fixture DNS delegation'),
      routeOrigin: wrapper({
        routePrefix: '192.0.2.0/24',
        originAsn: 'AS64496',
        authorizations: [{ prefix: '192.0.2.0/24', maxLength: 24, asn: 'AS64496' }],
      }, 'Fixture validated route snapshot'),
      tlsa: wrapper({
        serviceName: '_25._tcp.mx.example.test',
        dnssecState: 'unavailable',
        records: [],
      }, 'Fixture TLSA snapshot'),
    }, OBSERVED_AT);

    assert.equal(review.combinedState, null);
    assert.equal(review.version, CRYPTOGRAPHIC_ASSURANCE_REVIEW_VERSION);
    assert.deepEqual(review.cards.map((card) => card.family), [
      'dnssec_validation',
      'route_origin_authorisation',
      'dane_tlsa',
    ]);
    assert.deepEqual(review.cards.map((card) => card.state), ['unsigned', 'matches_supplied_rows', 'unavailable']);
    assert.equal(review.cards[1]?.completeness, 'partial');
    assert.equal(review.cards[1]?.authority, 'Analyst-supplied route-origin rows');
    assert.deepEqual(review.cards.map((card) => card.source), [
      'Fixture DNS delegation',
      'Fixture validated route snapshot',
      'Fixture TLSA snapshot',
    ]);
    assert.doesNotMatch(JSON.stringify(review), /"(?:score|verdict)"/u);
  });

  test('leaves missing families unavailable without inferring them from supplied evidence', () => {
    const review = buildCryptographicAssuranceReview({
      schema: CRYPTOGRAPHIC_ASSURANCE_INPUT_SCHEMA,
      version: 1,
      dnssec: null,
      routeOrigin: wrapper({ routePrefix: '192.0.2.0/24', originAsn: 'AS64496', authorizations: [] }, 'Fixture route snapshot'),
      tlsa: null,
    }, OBSERVED_AT);

    assert.equal(review.cards[0]?.state, 'unavailable');
    assert.equal(review.cards[0]?.observedAt, null);
    assert.equal(review.cards[1]?.state, 'not_found_in_supplied_rows');
    assert.equal(review.cards[1]?.completeness, 'partial');
    assert.equal(review.cards[2]?.state, 'unavailable');
    assert.match(review.cards[2]?.limitations[0] ?? '', /No state was inferred/u);
  });

  test('marks a substantive TLSA result partial when any comparison material was unavailable', () => {
    const certificateBytes = Buffer.from('fixture certificate');
    const certificate = certificateBytes.toString('base64');
    const associationData = createHash('sha256').update(certificateBytes).digest('hex');
    const review = buildCryptographicAssuranceReview({
      schema: CRYPTOGRAPHIC_ASSURANCE_INPUT_SCHEMA,
      version: 1,
      tlsa: wrapper({
        serviceName: '_25._tcp.mx.example.test',
        dnssecState: 'validated',
        pkixValidationState: 'failed',
        certificateDerBase64: certificate,
        records: [
          { usage: 1, selector: 0, matchingType: 1, associationData },
          { usage: 3, selector: 1, matchingType: 1, associationData: '00'.repeat(32) },
        ],
      }, 'Fixture TLSA snapshot'),
    }, OBSERVED_AT);
    const card = review.cards[2];
    assert.equal(card?.state, 'partial');
    assert.equal(card?.completeness, 'partial');
    assert.equal((card?.result as { dnssecState?: string }).dnssecState, 'unavailable');
    assert.match(card?.limitations.join(' ') ?? '', /state labels are not accepted as validator evidence/iu);
  });

  test('does not promote self-asserted prerequisite labels to positive DANE state', () => {
    const certificateBytes = Buffer.from('fixture prerequisite assertion');
    const review = buildCryptographicAssuranceReview({
      schema: CRYPTOGRAPHIC_ASSURANCE_INPUT_SCHEMA,
      version: 1,
      tlsa: wrapper({
        serviceName: '_25._tcp.mx.example.test',
        dnssecState: 'validated',
        pkixValidationState: 'validated',
        certificateDerBase64: certificateBytes.toString('base64'),
        records: [{
          usage: 3,
          selector: 0,
          matchingType: 1,
          associationData: createHash('sha256').update(certificateBytes).digest('hex'),
        }],
      }, 'Fixture TLSA association'),
    }, OBSERVED_AT);
    const card = review.cards[2];
    assert.equal(card?.state, 'partial');
    assert.equal(card?.completeness, 'partial');
    assert.equal((card?.result as { dnssecState?: string }).dnssecState, 'unavailable');
  });

  test('rejects empty or unbounded wrapper shapes', () => {
    assert.throws(() => buildCryptographicAssuranceReview({
      schema: CRYPTOGRAPHIC_ASSURANCE_INPUT_SCHEMA,
      version: CRYPTOGRAPHIC_ASSURANCE_INPUT_VERSION,
      dnssec: null,
      routeOrigin: null,
      tlsa: null,
    }, OBSERVED_AT), /at least one evidence family/u);
    assert.throws(() => buildCryptographicAssuranceReview({
      schema: CRYPTOGRAPHIC_ASSURANCE_INPUT_SCHEMA,
      version: CRYPTOGRAPHIC_ASSURANCE_INPUT_VERSION,
      dnssec: { source: 'Fixture', observedAt: OBSERVED_AT, evidence: [], extra: true },
    }, OBSERVED_AT), /unsupported field/u);
    assert.throws(() => buildCryptographicAssuranceReview({
      schema: CRYPTOGRAPHIC_ASSURANCE_INPUT_SCHEMA,
      version: CRYPTOGRAPHIC_ASSURANCE_INPUT_VERSION,
      dnssec: wrapper({ ownerName: 'example.test', delegationSigned: false, dsRecords: [] }, 'Fixture DNS delegation'),
    }, '2026-08-11T00:00:00'), /timestamp/u);
    assert.throws(() => buildCryptographicAssuranceReview({
      schema: CRYPTOGRAPHIC_ASSURANCE_INPUT_SCHEMA,
      version: CRYPTOGRAPHIC_ASSURANCE_REVIEW_VERSION,
      dnssec: wrapper({ ownerName: 'example.test', delegationSigned: false, dsRecords: [] }, 'Fixture DNS delegation'),
    }, OBSERVED_AT), /input.*version 1/iu);
  });
});
