import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  resolveAbuseRecipients,
} from '../frontend/src/lib/analysis/abuse-recipient-resolver.ts';

describe('abuse recipient resolver', () => {
  test('keeps separately attributed publication routes without inferring a host contact', () => {
    const result = resolveAbuseRecipients({
      registryInsights: {
        version: 1,
        publications: [
          { source: 'registry_rdap', observedAt: '2026-07-30T01:00:00.000Z' },
          { source: 'whois', observedAt: '2026-07-30T01:01:00.000Z' },
          { source: 'registrar_rdap', observedAt: '2026-07-30T01:02:00.000Z' },
        ],
        abuseRouting: [
          {
            kind: 'registrar',
            channel: 'email',
            contact: 'Abuse@Example.test',
            source: 'registrar RDAP abuse entity',
            limitations: ['Mailbox monitoring is not verified.'],
          },
          {
            kind: 'registry',
            channel: 'url',
            contact: 'https://registry.example/report#form',
            source: 'Registry RDAP abuse entity',
          },
        ],
      },
      availabilityAbuse: {
        email: 'abuse@example.test',
      },
      securityTxt: {
        securityTxtVersion: 1,
        state: 'present',
        finalUrl: 'https://target.example/.well-known/security.txt',
        contacts: ['mailto:security@example.test', 'https://target.example/report#details'],
      },
      networkContext: {
        contextVersion: 1,
        status: 'success',
        complete: true,
        truncated: false,
        abuseRouting: [{
          kind: 'network_hosting',
          channel: 'email',
          contact: 'Network-Abuse@example.test',
          source: 'IP RDAP abuse entity',
          rdapEndpoint: 'https://rdap.example.test/ip/192.0.2.1',
          observedAt: '2026-07-30T01:02:03.000Z',
          selectedAddress: '192.0.2.1',
          selectedFrom: 'tls_connection',
          complete: true,
          truncated: false,
          limitations: ['Network registration is not hosting attribution.'],
        }],
      },
    });

    assert.deepEqual(result.recipients.map((item) => item.kind), [
      'registrar',
      'registry',
      'security_txt',
      'network_hosting',
      'security_txt',
    ]);
    assert.equal(result.recipients[0]?.contact, 'abuse@example.test');
    assert.equal(result.recipients[0]?.observedAt, '2026-07-30T01:02:00.000Z');
    assert.equal(result.recipients[1]?.contact, 'https://registry.example/report');
    assert.equal(result.recipients[1]?.observedAt, '2026-07-30T01:00:00.000Z');
    assert.equal(result.recipients[2]?.actionType, 'security_contact_report');
    assert.equal(result.recipients[3]?.contact, 'network-abuse@example.test');
    assert.equal(result.recipients[3]?.actionType, 'network_hosting_report');
    assert.match(result.recipients[3]?.limitations.join(' ') ?? '', /selected endpoint address: 192\.0\.2\.1/i);
    assert.match(result.recipients[3]?.limitations.join(' ') ?? '', /rdap observed at 2026-07-30/i);
    assert.equal(result.coverage.find((item) => item.kind === 'network_hosting')?.state, 'found');
  });

  test('rejects malformed, credential-bearing, and overlong contacts', () => {
    const result = resolveAbuseRecipients({
      registryInsights: {
        version: 1,
        abuseRouting: [
          { kind: 'registrar', contact: 'not a contact', channel: 'email' },
          { kind: 'registry', contact: 'https://user:secret@registry.example/report', channel: 'url' },
          { kind: 'registry', contact: `https://registry.example/${'a'.repeat(400)}`, channel: 'url' },
        ],
      },
      availabilityAbuse: {
        phone: '+61 (0) 1234 5678',
      },
      securityTxt: {
        securityTxtVersion: 1,
        state: 'present',
        contacts: ['javascript:alert(1)', 'mailto:missing-at-sign'],
      },
    });

    assert.equal(result.recipients.length, 1);
    assert.equal(result.recipients[0]?.channel, 'phone');
    assert.equal(result.recipients[0]?.contact, '+61 (0) 1234 5678');
  });

  test('preserves unavailable and not-collected states instead of claiming no route exists', () => {
    const result = resolveAbuseRecipients({});
    assert.equal(result.recipients.length, 0);
    assert.equal(result.coverage.find((item) => item.kind === 'registrar')?.state, 'unavailable');
    assert.equal(result.coverage.find((item) => item.kind === 'registry')?.state, 'unavailable');
    assert.equal(result.coverage.find((item) => item.kind === 'security_txt')?.state, 'not_collected');
    assert.equal(result.coverage.find((item) => item.kind === 'network_hosting')?.state, 'not_collected');
  });

  test('keeps a partial network source unavailable when it has no usable route', () => {
    const result = resolveAbuseRecipients({
      networkContext: {
        contextVersion: 1,
        status: 'partial',
        complete: false,
        truncated: true,
        abuseRouting: [],
      },
    });
    const coverage = result.coverage.find((item) => item.kind === 'network_hosting');
    assert.equal(coverage?.state, 'unavailable');
    assert.match(coverage?.detail ?? '', /incomplete/i);
  });

  test('distinguishes an unrequested security.txt file from a fetched file without a usable contact', () => {
    const present = resolveAbuseRecipients({
      securityTxt: { securityTxtVersion: 1, state: 'present', contacts: ['not-a-route'] },
    });
    const absent = resolveAbuseRecipients({
      securityTxt: { securityTxtVersion: 1, state: 'absent', contacts: [] },
    });
    assert.match(present.coverage.find((item) => item.kind === 'security_txt')?.detail ?? '', /fetched.*no usable/iu);
    assert.match(absent.coverage.find((item) => item.kind === 'security_txt')?.detail ?? '', /collected with state absent/iu);
    assert.doesNotMatch(absent.coverage.find((item) => item.kind === 'security_txt')?.detail ?? '', /not requested/iu);
  });
});
