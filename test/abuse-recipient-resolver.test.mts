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
        abuseRouting: [
          {
            kind: 'registrar',
            channel: 'email',
            contact: 'Abuse@Example.test',
            source: 'registrar RDAP entity',
            limitations: ['Mailbox monitoring is not verified.'],
          },
          {
            kind: 'registry',
            channel: 'url',
            contact: 'https://registry.example/report#form',
            source: 'registry publication',
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
    });

    assert.deepEqual(result.recipients.map((item) => item.kind), [
      'registrar',
      'registry',
      'security_txt',
      'security_txt',
    ]);
    assert.equal(result.recipients[0]?.contact, 'abuse@example.test');
    assert.equal(result.recipients[1]?.contact, 'https://registry.example/report');
    assert.equal(result.recipients[2]?.actionType, 'security_contact_report');
    assert.equal(result.coverage.find((item) => item.kind === 'network_hosting')?.state, 'not_collected');
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
});
