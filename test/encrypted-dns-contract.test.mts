import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  normalizeEncryptedDnsAdapter,
  planEncryptedDnsQuery,
} from '../lib/encrypted-dns-contract.mts';

const MANIFEST = {
  id: 'fixture-resolver',
  label: 'Fixture resolver',
  endpoint: 'https://resolver.example/dns-query',
  method: 'POST',
  representation: 'dns-wire',
  termsUrl: 'https://resolver.example/terms',
  privacyUrl: 'https://resolver.example/privacy',
  reviewedAt: '2026-08-03T00:00:00.000Z',
  queryRetention: 'provider_defined',
  maxResponseBytes: 65_536,
  timeoutMs: 5_000,
};

describe('provider-neutral encrypted DNS contract', () => {
  test('builds an approval-gated disclosure plan without executing a request', () => {
    const adapter = normalizeEncryptedDnsAdapter(MANIFEST);
    const plan = planEncryptedDnsQuery(adapter, { name: 'Mail.Example.Test.', type: 'TLSA' });
    assert.equal(plan.state, 'approval_required');
    assert.deepEqual(plan.query, { name: 'mail.example.test', type: 'TLSA' });
    assert.equal(plan.disclosure.recipient, 'resolver.example');
    assert.equal(plan.disclosure.queryRetention, 'provider_defined');
  });

  test('requires HTTPS policy metadata and bounded known record types', () => {
    assert.throws(() => normalizeEncryptedDnsAdapter({ ...MANIFEST, endpoint: 'http://resolver.example' }), /bounded privacy/u);
    assert.throws(() => normalizeEncryptedDnsAdapter({ ...MANIFEST, reviewedAt: '2026-08-03T00:00:00' }), /bounded privacy/u);
    const adapter = normalizeEncryptedDnsAdapter(MANIFEST);
    assert.throws(() => planEncryptedDnsQuery(adapter, { name: 'example.test', type: 'AXFR' }), /invalid or unsupported/u);
  });
});
