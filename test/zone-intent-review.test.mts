import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_ZONE_RECORDS,
  ZONE_INTENT_INPUT_SCHEMA,
  normaliseRdata,
  reviewZoneIntent,
} from '../lib/zone-intent-review.mts';

const NOW = '2026-08-05T01:02:03.000Z';

describe('zone intent review', () => {
  test('does not call an empty observed comparison complete', () => {
    const result = reviewZoneIntent({
      schema: ZONE_INTENT_INPUT_SCHEMA,
      version: 1,
      origin: 'example.test',
      desired: { format: 'records', records: [] },
      observed: { state: 'observed', source: 'Fixture', observedAt: NOW, records: [] },
    }, NOW);
    assert.equal(result.comparisons.length, 0);
    assert.equal(result.complete, false);
  });

  test('parses a bounded master-file subset and compares records without retaining TXT values', () => {
    const result = reviewZoneIntent({
      schema: ZONE_INTENT_INPUT_SCHEMA,
      version: 1,
      origin: 'example.test',
      desired: {
        format: 'bind',
        zoneText: `
$ORIGIN example.test.
@ 300 IN A 192.0.2.10
@ 300 IN MX 10 mail
@ 300 IN CAA 0 issue ca.example
@ 300 IN TXT "v=spf1 -all"
@ 300 IN CDS 12345 13 2 AABB
@ 300 IN CSYNC 42 3 A AAAA NS
_443._tcp 300 IN TLSA 3 1 1 AABB
`,
      },
      observed: {
        state: 'observed', source: 'Saved authoritative matrix', observedAt: NOW,
        records: [
          { owner: 'example.test', ttl: 300, type: 'A', value: '192.0.2.10' },
          { owner: 'example.test', ttl: 600, type: 'MX', value: '10 mail.example.test' },
          { owner: 'example.test', ttl: 300, type: 'CAA', value: '0 issue ca.example' },
          { owner: 'example.test', ttl: 300, type: 'TXT', value: 'v=spf1 -all' },
          { owner: 'example.test', ttl: 300, type: 'CDS', value: '12345 13 2 aabb' },
          { owner: 'example.test', ttl: 300, type: 'CSYNC', value: '42 3 NS AAAA A' },
          { owner: '_443._tcp.example.test', ttl: 300, type: 'TLSA', value: '3 1 1 aabb' },
        ],
      },
    }, NOW);
    assert.equal(result.complete, true);
    assert.equal(result.counts.aligned, 7);
    assert.equal(result.desired.records.find((item) => item.type === 'TXT')?.valueTreatment, 'sha256');
    assert.doesNotMatch(JSON.stringify(result), /v=spf1/u);
    assert.deepEqual(result.comparisons.find((item) => item.type === 'MX')?.desiredTtls, [300]);
    assert.deepEqual(result.comparisons.find((item) => item.type === 'MX')?.observedTtls, [600]);
  });

  test('concatenates quoted TXT character strings without corrupting spaces or escapes', () => {
    const split = normaliseRdata('TXT', '"v=spf1 a" " -all"', null);
    const joined = normaliseRdata('TXT', 'v=spf1 a -all', null);
    assert.equal(split.value, joined.value);
    assert.equal(normaliseRdata('TXT', '"abc" "def" "ghi"', null).value, normaliseRdata('TXT', 'abcdefghi', null).value);
    assert.notEqual(normaliseRdata('TXT', '"a" "b"', null).value, normaliseRdata('TXT', 'a"b', null).value);
    assert.equal(normaliseRdata('TXT', '"a\\\"b\\032c"', null).value, normaliseRdata('TXT', 'a"b c', null).value);

    const dkim = 'p='.concat('A'.repeat(298));
    const quoted = `"${dkim.slice(0, 150)}" "${dkim.slice(150)}"`;
    assert.equal(normaliseRdata('TXT', quoted, null).value, normaliseRdata('TXT', dkim, null).value);
  });

  test('accepts ASCII CDNSKEY material and rejects Unicode case-folding aliases', () => {
    assert.equal(normaliseRdata('CDNSKEY', '257 3 13 AbCdEf+/=', null).value, '257 3 13 AbCdEf+/=');
    for (const material of ['A\u212a==', 'A\u017f==']) {
      assert.throws(() => normaliseRdata('CDNSKEY', `257 3 13 ${material}`, null), /CDNSKEY data is invalid/u);
    }
  });

  test('applies master-file relative names only to BIND input', () => {
    const result = reviewZoneIntent({
      schema: ZONE_INTENT_INPUT_SCHEMA,
      version: 1,
      origin: 'example.test',
      desired: {
        format: 'bind',
        zoneText: 'www.example.test IN CNAME edge.example.test\nabsolute IN CNAME edge.example.net.',
      },
      observed: {
        state: 'observed', source: 'Fixture', observedAt: NOW,
        records: [
          { owner: 'www.example.test.example.test', type: 'CNAME', value: 'edge.example.test.example.test' },
          { owner: 'absolute.example.test', type: 'CNAME', value: 'edge.example.net' },
        ],
      },
    }, NOW);
    assert.equal(result.complete, true);
    assert.equal(result.counts.aligned, 2);
  });

  test('keeps incomplete observations from becoming missing-record conclusions', () => {
    const result = reviewZoneIntent({
      schema: ZONE_INTENT_INPUT_SCHEMA, version: 1, origin: 'example.test',
      desired: { format: 'records', records: [{ owner: '@', ttl: 300, type: 'A', value: '192.0.2.1' }] },
      observed: { state: 'partial', source: 'Partial fixture', observedAt: NOW, records: [] },
    }, NOW);
    assert.equal(result.comparisons[0]?.state, 'partial');
    assert.equal(result.counts.missing, 0);
    assert.equal(result.complete, false);
  });

  test('rejects unbounded input and records unsupported syntax without applying it', () => {
    assert.throws(() => reviewZoneIntent({
      schema: ZONE_INTENT_INPUT_SCHEMA, version: 1, origin: 'example.test',
      desired: { format: 'records', records: Array.from({ length: MAX_ZONE_RECORDS + 1 }, () => ({ owner: '@', type: 'A', value: '192.0.2.1' })) },
      observed: { state: 'observed', source: 'Fixture', observedAt: NOW, records: [] },
    }, NOW), /limited/u);
    const result = reviewZoneIntent({
      schema: ZONE_INTENT_INPUT_SCHEMA, version: 1, origin: 'example.test',
      desired: { format: 'bind', zoneText: '$INCLUDE secret.zone\n@ IN A 192.0.2.1' },
      observed: { state: 'observed', source: 'Fixture', observedAt: NOW, records: [] },
    }, NOW);
    assert.equal(result.desired.rejected.length, 1);
    assert.match(result.desired.rejected[0]?.reason ?? '', /unsupported/u);
    assert.equal(result.complete, false);
    assert.throws(() => reviewZoneIntent({
      schema: ZONE_INTENT_INPUT_SCHEMA, version: 1, origin: 'example.test',
      desired: { format: 'records', records: [] },
      observed: { state: 'observed', source: 'Fixture\nsecret', observedAt: NOW, records: [] },
    }, NOW), /control characters/iu);
  });
});
