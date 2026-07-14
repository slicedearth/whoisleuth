'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseWhoisChain } = require('../lib/whois');

const rootHop = {
  server: 'whois.iana.org',
  response: 'domain: COM\nrefer: whois.registry.example\n',
};

function parseRegistry(response) {
  return parseWhoisChain([
    rootHop,
    { server: 'whois.registry.example', response },
  ]);
}

describe('bounded WHOIS lifecycle and contact normalization', () => {
  test('preserves compatibility scalars while publishing role-based contacts', () => {
    const parsed = parseRegistry([
      'Domain Name: EXAMPLE.COM',
      'Registry Domain ID: DOMAIN-1',
      'Registrar: Example Registrar',
      'Creation Date: 2020-01-02T03:04:05Z',
      'Registry Expiry Date: 2030-01-02T03:04:05Z',
      'Updated Date: 2026-07-12T01:02:03Z',
      'Registry Registrant ID: REG-1',
      'Registrant Name: Example Person',
      'Registrant Organization: Example Org',
      'Registrant Street: Suite 1',
      'Registrant Street: 2 Example Road',
      'Registrant City: Melbourne',
      'Registrant State/Province: VIC',
      'Registrant Postal Code: 3000',
      'Registrant Country: AU',
      'Registrant Email: person@example.com',
      'Registrant Phone: +61.300000000',
      'Registry Admin ID: ADMIN-1',
      'Admin Name: Admin Person',
      'Admin Address: 3 Admin Road, Melbourne VIC 3000, AU',
      'Admin Email: admin@example.com',
      'Registry Tech ID: TECH-1',
      'Tech Name: Technical Person',
      'Tech Email: tech@example.com',
      'Registry Billing ID: BILL-1',
      'Billing Organization: Billing Org',
      'Billing Phone: +61.399999999',
      'Registrar Abuse Contact Email: abuse@example.com',
      'Registrar Abuse Contact Phone: +61.388888888',
      'Name Server: NS1.EXAMPLE.COM',
    ].join('\n'));

    assert.equal(parsed.registrantName, 'Example Person');
    assert.equal(parsed.registrantEmail, 'person@example.com');
    assert.equal(parsed.registrantStreet, 'Suite 1, 2 Example Road');
    assert.deepEqual(parsed.lifecycle, {
      createdDate: '2020-01-02T03:04:05Z',
      expiryDate: '2030-01-02T03:04:05Z',
      updatedDate: '2026-07-12T01:02:03Z',
      createdDateIso: '2020-01-02T03:04:05.000Z',
      expiryDateIso: '2030-01-02T03:04:05.000Z',
      updatedDateIso: '2026-07-12T01:02:03.000Z',
    });
    assert.equal(parsed.createdDateIso, '2020-01-02T03:04:05.000Z');
    assert.equal(parsed.expiryDateIso, '2030-01-02T03:04:05.000Z');
    assert.equal(parsed.updatedDateIso, '2026-07-12T01:02:03.000Z');

    const registrant = parsed.contactsByRole.registrant[0];
    assert.equal(registrant.handle, 'REG-1');
    assert.deepEqual(registrant.names, ['Example Person']);
    assert.deepEqual(registrant.organizations, ['Example Org']);
    assert.deepEqual(registrant.emails, ['person@example.com']);
    assert.deepEqual(registrant.phones, ['+61.300000000']);
    assert.deepEqual(registrant.addresses, [
      'Suite 1, 2 Example Road, Melbourne, VIC, 3000, AU',
    ]);
    assert.deepEqual(registrant.publicIds, [
      { type: 'Registry contact ID', identifier: 'REG-1' },
    ]);
    assert.equal(parsed.contactsByRole.administrative[0].handle, 'ADMIN-1');
    assert.equal(parsed.contactsByRole.technical[0].handle, 'TECH-1');
    assert.equal(parsed.contactsByRole.billing[0].handle, 'BILL-1');
    assert.deepEqual(parsed.contactsByRole.abuse[0].emails, ['abuse@example.com']);
    assert.deepEqual(parsed.fieldsTruncated, []);
  });

  test('does not treat root-delegation contact fields as domain contacts', () => {
    const parsed = parseWhoisChain([
      {
        server: 'whois.iana.org',
        response: [
          'domain: COM',
          'Registrant Name: Root Operator',
          'Registrant Email: root@example.net',
          'refer: whois.registry.example',
        ].join('\n'),
      },
      {
        server: 'whois.registry.example',
        response: 'Domain Name: EXAMPLE.COM\nName Server: NS1.EXAMPLE.COM\n',
      },
    ]);

    assert.equal(parsed.registrantName, undefined);
    assert.equal(parsed.registrantEmail, undefined);
    assert.equal(parsed.contactsByRole.registrant, undefined);
  });

  test('bounds scalar contact fields and rejects control-character values', () => {
    const parsed = parseRegistry([
      'Domain Name: EXAMPLE.COM',
      `Registrant Name: ${'N'.repeat(350)}`,
      `Registrant Street: ${'S'.repeat(350)}`,
      `Registrant Email: ${'e'.repeat(340)}`,
      'Registrant Phone: unsafe\vphone',
      'Name Server: NS1.EXAMPLE.COM',
    ].join('\n'));

    assert.equal(parsed.registrantName.length, 300);
    assert.equal(parsed.registrantStreet.length, 300);
    assert.equal(parsed.registrantEmail.length, 320);
    assert.equal(parsed.registrantPhone, undefined);
    assert.deepEqual(parsed.fieldsTruncated, [
      'registrantEmail', 'registrantName', 'registrantStreet',
    ]);
  });

  test('retains later valid repeated street lines and discloses the four-line cap', () => {
    const parsed = parseRegistry([
      'Domain Name: EXAMPLE.COM',
      'Registrant Street: unsafe\vstreet',
      'Registrant Street: Line one',
      'Registrant Street: Line two',
      'Registrant Street: Line three',
      'Registrant Street: Line four',
      'Registrant Street: Line five',
      'Name Server: NS1.EXAMPLE.COM',
    ].join('\n'));

    assert.equal(parsed.registrantStreet, 'Line one, Line two, Line three, Line four');
    assert.deepEqual(parsed.contactsByRole.registrant[0].addresses, [
      'Line one, Line two, Line three, Line four',
    ]);
    assert.ok(parsed.fieldsTruncated.includes('registrantStreet'));
  });

  test('caps unique status and nameserver inventories and discloses the caps', () => {
    const statuses = Array.from({ length: 101 }, (_, index) => {
      const first = String.fromCharCode(97 + Math.floor(index / 26));
      const second = String.fromCharCode(97 + (index % 26));
      return `Domain Status: status${first}${second}`;
    });
    const nameservers = Array.from(
      { length: 201 },
      (_, index) => `Name Server: ns${index}.example.net`
    );
    const parsed = parseRegistry([
      'Domain Name: EXAMPLE.COM',
      ...statuses,
      ...nameservers,
    ].join('\n'));

    assert.equal(parsed.statuses.length, 100);
    assert.equal(parsed.nameservers.length, 200);
    assert.ok(parsed.fieldsTruncated.includes('statuses'));
    assert.ok(parsed.fieldsTruncated.includes('nameservers'));
  });

  test('normalizes bounded indented contacts without losing address and phone data', () => {
    const parsed = parseRegistry([
      'Domain Name: EXAMPLE.EDU',
      'Administrative Contact:',
      '  Jane Doe',
      '  Example University',
      '  Room 100, 1 Example Way',
      '  Melbourne VIC 3000',
      '  AU',
      '  +61 3 0000 0000',
      '  jane@example.edu',
      '',
      'Name Server: NS1.EXAMPLE.EDU',
    ].join('\n'));

    const admin = parsed.contactsByRole.administrative[0];
    assert.equal(admin.name, 'Jane Doe');
    assert.deepEqual(admin.emails, ['jane@example.edu']);
    assert.deepEqual(admin.phones, ['+61 3 0000 0000']);
    assert.deepEqual(admin.addresses, [
      'Example University, Room 100, 1 Example Way, Melbourne VIC 3000, AU',
    ]);
  });

  test('discloses a capped oversized indented contact block', () => {
    const parsed = parseRegistry([
      'Domain Name: EXAMPLE.EDU',
      'Technical Contact:',
      '  Technical Person',
      ...Array.from({ length: 20 }, (_, index) => `  Address line ${index + 1}`),
      '',
      'Name Server: NS1.EXAMPLE.EDU',
    ].join('\n'));

    assert.equal(parsed.contactsByRole.technical[0].name, 'Technical Person');
    assert.ok(parsed.fieldsTruncated.includes('techAddress'));
    assert.ok(parsed.techAddress.includes('Address line 19'));
    assert.equal(parsed.techAddress.includes('Address line 20'), false);
  });
});
