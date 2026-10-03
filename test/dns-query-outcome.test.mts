import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dnsAddressFamilyEvidence, dnsQueryFailureOutcome, readDnsQueryOutcome } from '../packages/evidence/dns-query-outcome.mts';
import { createObservation, readObservationEnvelope } from '../packages/evidence/observation.mts';

test('DNS outcome identity survives the existing bounded observation envelope', () => {
  for (const [code, detail, status] of [
    ['ENODATA', 'no_data', 'not_found'], ['ENOTFOUND', 'name_not_found', 'not_found'],
    ['ETIMEOUT', 'timeout', 'error'], ['ESERVFAIL', 'server_failure', 'error'],
    ['EREFUSED', 'refused', 'error'], ['EBADRESP', 'invalid_response', 'error'],
    ['ENONAME', 'error', 'error'], ['private unexpected detail', 'error', 'error'],
  ]) {
    assert.equal(dnsQueryFailureOutcome(code), detail);
    const observation = createObservation({ status: 'success', source: 'dns', observedAt: '2026-10-01T00:00:00.000Z',
      diagnostics: { a: { status, detail, error: null, truncated: false, discarded: 0 } } });
    const read = readObservationEnvelope(observation);
    assert.equal(read.state, 'supported');
    assert.equal(readDnsQueryOutcome(read.observation?.diagnostics.a), detail);
  }
  assert.equal(readDnsQueryOutcome({ status: 'not_found' }), null);
  assert.equal(readDnsQueryOutcome({ status: 'not_found', detail: 'timeout' }), null);
  assert.equal(readDnsQueryOutcome({ status: 'not_found', detail: '__proto__' }), null);
});

test('DNS families retain independent complete outcomes without turning failures into absence', () => {
  const dns = { status: 'partial', complete: false, records: { a: [], aaaa: ['2001:db8::1'] },
    diagnostics: { a: { status: 'not_found', detail: 'no_data' }, aaaa: { status: 'success', detail: 'records' }, mx: { status: 'error' } } };
  assert.deepEqual(dnsAddressFamilyEvidence(dns, 'a'), {
    outcome: 'no_data', value: 'No data for this record type (NODATA)', state: 'not_found', complete: true, truncated: false,
  });
  assert.equal(dnsAddressFamilyEvidence(dns, 'aaaa').value, '2001:db8::1');
  assert.equal(dnsAddressFamilyEvidence(dns, 'aaaa').complete, true);
  for (const [detail, status, value, complete] of [
    ['empty_answer', 'not_found', 'No records returned', true],
    ['name_not_found', 'not_found', 'Name not found by resolver', true],
    ['timeout', 'error', 'DNS query timed out', false],
    ['server_failure', 'error', 'DNS server failed to answer (SERVFAIL)', false],
    ['refused', 'error', 'DNS query refused', false],
    [undefined, 'not_found', 'Negative DNS outcome not recorded', false],
  ] as const) {
    const family = dnsAddressFamilyEvidence({ records: { a: [] }, diagnostics: { a: { status, detail } } }, 'a');
    assert.equal(family.value, value);
    assert.equal(family.complete, complete);
  }
});

test('DNS family projections reject contradictory, malformed and incomplete observations', () => {
  for (const [records, diagnostic] of [
    [[], { status: 'success', detail: 'records' }],
    [['192.0.2.1'], { status: 'not_found', detail: 'name_not_found' }],
    [['malformed'], { status: 'not_found', detail: 'no_data' }],
    [['2001:db8::1'], { status: 'success', detail: 'records' }],
    [null, { status: 'not_found', detail: 'no_data' }],
    [[], { status: 'not_found', detail: 'no_data', discarded: 1 }],
    [[], { status: 'not_found', detail: 'no_data', truncated: true }],
  ]) {
    assert.equal(dnsAddressFamilyEvidence({ records: { a: records }, diagnostics: { a: diagnostic } }, 'a').complete, false);
  }
  assert.equal(dnsAddressFamilyEvidence({}, 'a').value, null);
  assert.equal(dnsAddressFamilyEvidence({ status: 'skipped' }, 'a').value, 'Not queried');
});
