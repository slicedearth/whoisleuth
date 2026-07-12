const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { parseRdap } = require('../lib/rdap');

describe('structured RDAP metadata', () => {
  test('preserves registrar IDs, addresses, glue, DNSSEC, and protocol notes', () => {
    const parsed = parseRdap('domain', {
      ldhName: 'XN--BCHER-KVA.EXAMPLE',
      unicodeName: 'bücher.example',
      port43: 'whois.example',
      entities: [{
        handle: 'REG-1',
        roles: ['registrar'],
        publicIds: [{ type: 'IANA Registrar ID', identifier: '9999' }],
        vcardArray: ['vcard', [
          ['version', {}, 'text', '4.0'],
          ['fn', {}, 'text', 'Example Registrar'],
          ['adr', {}, 'text', ['', '', '1 Registry Way', 'Melbourne', 'VIC', '3000', 'AU']],
        ]],
      }],
      nameservers: [{
        ldhName: 'NS1.EXAMPLE',
        ipAddresses: { v4: ['192.0.2.10'], v6: ['2001:db8::10'] },
      }],
      secureDNS: {
        zoneSigned: true,
        delegationSigned: true,
        dsData: [{ keyTag: 12345, algorithm: 13, digestType: 2, digest: 'ABCDEF' }],
      },
      notices: [{ title: 'Terms', description: ['Use subject to registry terms.'] }],
      remarks: [{ title: 'Status', description: ['Data redacted by policy.'] }],
    });

    assert.equal(parsed.unicodeDomain, 'bücher.example');
    assert.equal(parsed.port43, 'whois.example');
    assert.equal(parsed.registrarIanaId, '9999');
    assert.equal(parsed.registrar.address, '1 Registry Way, Melbourne, VIC, 3000, AU');
    assert.deepEqual(parsed.nameserverDetails[0].addresses, ['192.0.2.10', '2001:db8::10']);
    assert.deepEqual(parsed.dsData[0], { keyTag: 12345, algorithm: 13, digestType: 2, digest: 'ABCDEF' });
    assert.equal(parsed.notices[0].title, 'Terms');
    assert.equal(parsed.remarks[0].descriptions[0], 'Data redacted by policy.');
  });

  test('bounds notice text copied into the structured response', () => {
    const parsed = parseRdap('asn', {
      startAutnum: 64496,
      endAutnum: 64496,
      parentHandle: 'PARENT-AS-BLOCK',
      port43: 'whois.rir.example',
      notices: Array.from({ length: 20 }, (_, i) => ({
        title: `Notice ${i}`,
        description: ['x'.repeat(2000)],
      })),
    });

    assert.equal(parsed.notices.length, 12);
    assert.equal(parsed.notices[0].descriptions[0].length, 800);
    assert.equal(parsed.parentHandle, 'PARENT-AS-BLOCK');
    assert.equal(parsed.port43, 'whois.rir.example');
  });

  test('normalizes and deterministically summarizes shuffled lifecycle events', () => {
    const parsed = parseRdap('domain', {
      ldhName: 'EXAMPLE.COM',
      events: [
        { eventAction: ' Expiration ', eventDate: '2027-01-01T00:00:00Z' },
        { eventAction: 'registration', eventDate: '2020-06-01T00:00:00Z' },
        { eventAction: 'REGISTRATION', eventDate: '2020-01-01T00:00:00Z', eventActor: 'Registry' },
        { eventAction: 'expiration', eventDate: '2028-01-01T00:00:00Z' },
        { eventAction: 'last   changed', eventDate: '2025-01-01T00:00:00Z' },
        { eventAction: 'last changed', eventDate: 'not-a-date' },
        { eventAction: 'transfer', eventDate: '2024-02-03T00:00:00Z' },
      ],
    });

    assert.equal(parsed.events[2].action, 'registration');
    assert.equal(parsed.events[2].actor, 'Registry');
    assert.deepEqual(parsed.lifecycle, {
      createdDate: '2020-01-01T00:00:00Z',
      reregistrationDate: null,
      expiryDate: '2028-01-01T00:00:00Z',
      updatedDate: '2025-01-01T00:00:00Z',
      transferDate: '2024-02-03T00:00:00Z',
      deletionDate: null,
      reinstantiationDate: null,
    });
  });

  test('bounds malformed event data without losing valid neighbours', () => {
    const parsed = parseRdap('domain', {
      ldhName: 'EXAMPLE.COM',
      events: [
        null,
        { eventAction: 'registration\nforged', eventDate: '2020-01-01' },
        { eventAction: 'expiration', eventDate: 'x'.repeat(65) },
        { eventAction: 'last changed', eventDate: '2025-01-01', eventActor: 'x'.repeat(161) },
      ],
    });
    assert.equal(parsed.events.length, 3);
    assert.deepEqual(parsed.events[0], { action: null, date: '2020-01-01', actor: null });
    assert.deepEqual(parsed.events[1], { action: 'expiration', date: null, actor: null });
    assert.deepEqual(parsed.events[2], { action: 'last changed', date: '2025-01-01', actor: null });
    assert.equal(parsed.lifecycle.updatedDate, '2025-01-01');
  });
});
