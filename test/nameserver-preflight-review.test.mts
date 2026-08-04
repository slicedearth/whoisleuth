import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_PREFLIGHT_NAMESERVERS,
  NAMESERVER_PREFLIGHT_INPUT_SCHEMA,
  reviewNameserverPreflight,
} from '../lib/nameserver-preflight-review.mts';

const NOW = '2026-08-05T08:00:00.000Z';

function input() {
  return {
    schema: NAMESERVER_PREFLIGHT_INPUT_SCHEMA,
    version: 1,
    domain: 'example.test',
    intendedNameservers: ['ns1.example.test', 'ns2.outside.test'],
    observations: [
      {
        nameserver: 'ns1.example.test', state: 'observed', source: 'direct fixture', observedAt: NOW,
        addresses: ['93.184.216.34'], authoritative: true,
        servedNameservers: ['ns1.example.test', 'ns2.outside.test'], soaPrimary: 'ns1.example.test', soaSerial: 1,
      },
      {
        nameserver: 'ns2.outside.test', state: 'observed', source: 'direct fixture', observedAt: NOW,
        addresses: [], authoritative: true,
        servedNameservers: ['ns2.outside.test', 'ns1.example.test'], soaPrimary: 'ns1.example.test', soaSerial: 1,
      },
    ],
  };
}

describe('undelegated nameserver preflight review', () => {
  test('passes complete separately attributed authority, NS, SOA, and glue evidence', () => {
    const result = reviewNameserverPreflight(input(), NOW);
    assert.equal(result.state, 'ready');
    assert.equal(result.gate.pass, true);
    assert.equal(result.rows[0]?.inBailiwick, true);
    assert.equal(result.rows[0]?.addressState, 'ready');
    assert.equal(result.rows[1]?.addressState, 'not_supplied');
  });

  test('keeps missing, partial, non-public, and inconsistent evidence outside the gate', () => {
    const value = input();
    value.observations[0]!.addresses = ['10.0.0.1'];
    value.observations[0]!.servedNameservers = ['ns1.example.test'];
    value.observations[1]!.state = 'partial';
    const result = reviewNameserverPreflight(value, NOW);
    assert.equal(result.gate.pass, false);
    assert.equal(result.rows[0]?.addressState, 'non_public');
    assert.equal(result.rows[0]?.servedSetState, 'different');
    assert.equal(result.rows[1]?.authorityState, 'unknown');
    assert.match(result.gate.reasons.join(' '), /no observed public address/iu);
  });

  test('bounds inputs and rejects unrelated or internally contradictory observations', () => {
    assert.throws(() => reviewNameserverPreflight({ ...input(), unexpected: true }, NOW), /unknown field/iu);
    assert.throws(() => reviewNameserverPreflight({
      ...input(),
      intendedNameservers: Array.from({ length: MAX_PREFLIGHT_NAMESERVERS + 1 }, (_, index) => `ns${index}.outside.test`),
    }, NOW), /must contain/iu);
    const unrelated = input();
    unrelated.observations[0]!.nameserver = 'unrelated.example.net';
    assert.throws(() => reviewNameserverPreflight(unrelated, NOW), /only intended nameservers/iu);
    const unavailable = input();
    unavailable.observations[0]!.state = 'unavailable';
    assert.throws(() => reviewNameserverPreflight(unavailable, NOW), /cannot contain observed values/iu);
  });
});
