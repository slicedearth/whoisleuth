import assert from 'node:assert/strict';
import test from 'node:test';
import { buildActivationContext } from '../frontend/src/lib/analysis/activation-context.ts';

test('activation context keeps dated events separate from current service observations', () => {
  const context = buildActivationContext({
    registryCreated: '2025-01-01T00:00:00Z',
    tlsValidFrom: '2025-02-01T00:00:00Z',
    observedAt: '2025-03-01T00:00:00Z',
    dnsStatus: 'success',
    dnsComplete: true,
    hasMx: true,
    hasSpf: true,
    hasDmarc: true,
    httpStatus: 200,
    pageObserved: true,
  });

  assert.deepEqual(context.events.map((event) => event.id), [
    'domain-created',
    'tls-valid-from',
    'lookup-observed',
  ]);
  assert.equal(context.mail.state, 'authenticated_mail');
  assert.equal(context.web.state, 'response_observed');
  assert.equal(context.relationship.state, 'both_observed');
  assert.match(context.relationship.detail, /activation dates remain unknown/u);
});

test('activation context reports a conclusive current mail-authentication gap', () => {
  const context = buildActivationContext({
    dnsStatus: 'complete',
    dnsComplete: true,
    hasMx: true,
    hasSpf: false,
    hasDmarc: true,
    httpStatus: 404,
  });

  assert.equal(context.mail.state, 'mail_auth_gap');
  assert.match(context.mail.detail, /SPF was not observed/u);
  assert.equal(context.relationship.state, 'both_observed');
});

test('activation context does not turn failed collection into an absence conclusion', () => {
  const context = buildActivationContext({
    registryCreated: 'not a date',
    dnsStatus: 'error',
    dnsComplete: false,
    hasMx: false,
    hasSpf: false,
    hasDmarc: false,
    pageObserved: false,
    tlsObserved: false,
  });

  assert.equal(context.events.length, 0);
  assert.equal(context.mail.state, 'inconclusive');
  assert.equal(context.web.state, 'inconclusive');
  assert.equal(context.relationship.state, 'inconclusive');
});

test('activation context distinguishes observed web evidence without MX', () => {
  const context = buildActivationContext({
    dnsStatus: 'success',
    dnsComplete: true,
    hasMx: false,
    httpStatus: 301,
  });

  assert.equal(context.mail.state, 'no_mail_observed');
  assert.equal(context.relationship.state, 'web_without_mail');
  assert.match(context.mail.detail, /does not prove/u);
});
