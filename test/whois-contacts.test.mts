import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, test } from 'node:test';
import { parseWhoisChain } from '../lib/whois.mts';
import { parseIndentedContactBlock } from '../lib/whois-contacts.mts';
import { requiredValue } from './value-assertions.mts';
import { projectLookupEvidenceWhoisPublication } from '../lib/evidence-export.mts';

function roleContact(
  parsed: ReturnType<typeof parseWhoisChain>,
  role: string,
) {
  return requiredValue(requiredValue(parsed.contactsByRole[role])[0]);
}

const rootHop = {
  server: 'whois.iana.org',
  response: 'domain: COM\nrefer: whois.registry.example\n',
};

function parseRegistry(response: string) {
  return parseWhoisChain([
    rootHop,
    { server: 'whois.registry.example', response },
  ]);
}

describe('bounded WHOIS lifecycle and contact normalization', () => {
  for (const family of ['role', 'email'] as const) {
    test(`finishes increasing hostile ${family} contact lines through the complete parser in a killable process`, () => {
      // This external deadline can interrupt a synchronous regression. It is
      // not a latency benchmark; output/attribution assertions remain primary.
      execFileSync(process.execPath, ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import { parseWhoisChain } from ${JSON.stringify(new URL('../lib/whois-parser.mts', import.meta.url).href)};
        for (const size of [2000, 8000, 32000, 128000]) {
          const role = ${JSON.stringify(family)} === 'role';
          const response = 'Domain Name: example.test\\n' + (role
            ? '% This is the ISNIC Whois server.\\nsource: ISNIC\\nregistrant: HANDLE-1\\nrole:' + ' '.repeat(size) + 'X\\nnic-hdl: OTHER\\ne-mail: wrong@example.test\\n'
            : 'Registrant:\\n  a@' + '.'.repeat(size) + '@\\n  1 Example Road\\n  valid@example.test\\n');
          assert.ok(Buffer.byteLength(response) < 200000);
          const chain = [{ server: 'whois.iana.org', response: '' }, { server: 'whois.registry.example', response }];
          const parsed = parseWhoisChain(chain, 'example.test');
          assert.equal(parsed.domainName, 'example.test');
          assert.equal(parsed.registrantEmail, role ? undefined : 'valid@example.test');
          if (role) {
            assert.equal(parsed.registrantId, 'HANDLE-1');
            assert.equal(parsed.registrantOrg, undefined);
          } else {
            assert.equal(parsed.registrantOrg, ('a@' + '.'.repeat(size) + '@').slice(0, 300));
            assert.equal(parsed.registrantAddress, '1 Example Road');
            assert.ok(parsed.fieldsTruncated.includes('registrantOrg'));
          }
          assert.equal(chain[1].response, response);
          assert.equal(parseWhoisChain(chain, 'other.test').registrantEmail, undefined);
        }
      `], { timeout: 5000, stdio: 'pipe' });
    });
  }

  test('links a role only to its immediate exact handle and preserves whitespace, bounds and contact fields', () => {
    for (const whitespace of ['', ' \t ', ' '.repeat(2000)]) {
      const parsed = parseRegistry([
        'Domain Name: example.test', '% This is the ISNIC Whois server.',
        'source: ISNIC', 'registrant: HANDLE.1',
        `role:${whitespace}Wrong organisation`, 'nic-hdl: HANDLEa1',
        'e-mail: wrong@example.test', '',
        `\tRoLe:${whitespace}Correct organisation`, '\tNiC-hDl:\t handle.1 \t',
        'address: 1 Example Road', 'address: Example City',
        'phone: +61 300000000', 'e-mail: correct@example.test',
      ].join('\r\n'));
      assert.equal(parsed.registrantOrg, 'Correct organisation');
      assert.equal(parsed.registrantEmail, 'correct@example.test');
      assert.equal(parsed.registrantAddress, '1 Example Road, Example City');
      assert.equal(parsed.registrantPhone, '+61 300000000');
      assert.deepEqual(parsed.fieldsTruncated, []);
    }
    for (const intervening of ['', 'address: unrelated']) {
      const parsed = parseRegistry([
        'Domain Name: example.test', '% This is the ISNIC Whois server.',
        'source: ISNIC', 'registrant: HANDLE-1',
        'role: Unlinked organisation', intervening, 'nic-hdl: HANDLE-1',
        'e-mail: unlinked@example.test',
      ].join('\n'));
      assert.equal(parsed.registrantOrg, undefined);
      assert.equal(parsed.registrantEmail, undefined);
    }
    const parsed = parseRegistry([
      'Domain Name: example.test', '% This is the ISNIC Whois server.',
      'source: ISNIC', 'registrant: HANDLE-1',
      `role: ${'O'.repeat(301)}`, 'nic-hdl: HANDLE-1', 'e-mail: bounded@example.test',
    ].join('\n'));
    assert.equal(parsed.registrantOrg, 'O'.repeat(300));
    assert.equal(parsed.registrantEmail, 'bounded@example.test');
    assert.ok(parsed.fieldsTruncated.includes('registrantOrg'));
  });

  test('retains legacy email classification without reclassifying ordinary names and addresses', () => {
    const accepted = ['a@example.test', 'a.b+tag@example.test', 'a@sub.example.test', 'a@..b', 'a@b..'];
    const rejected = ['ordinary name', '1 Example Road', '@example.test', 'a@b', 'a@.b', 'a@b.', 'a@@b.test', 'a@..@', 'a@two words.test'];
    for (const line of [...accepted, ...rejected]) {
      const parsed = parseIndentedContactBlock(`Registrant:\n  ${line}\n`, /^Registrant:$/m);
      assert.equal(parsed?.email, accepted.includes(line) ? line : null, line);
      assert.equal(parsed?.name, accepted.includes(line) ? null : line, line);
    }
    // Exhaustive short strings independently compare the old accepted language;
    // pathological lengths are confined to the killable parser tests above.
    const alphabet = ['a', '.', '@', ' ', '\t'];
    const compare = (line: string, depth: number) => {
      const trimmed = line.trim();
      const parsed = parseIndentedContactBlock(`Registrant:\n${line}\n`, /^Registrant:$/m);
      assert.equal(parsed?.email ?? null, /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null);
      if (depth) for (const character of alphabet) compare(line + character, depth - 1);
    };
    compare('', 5);
  });

  test('rejects modified nameserver identities and qualifies shortened duplicate statuses through export', () => {
    const exact = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(56)}.test`;
    assert.equal(exact.length, 253);
    const accepted = parseRegistry(`Domain Name: example.test\nName Server: ${exact}`);
    assert.deepEqual(accepted.nameservers, [exact]);
    assert.deepEqual(accepted.fieldsTruncated, []);
    for (const value of [`${exact}.invalid`, 'ns1.example.test/extra', 'ns1.example.test_unsafe', 'invalid..example.test']) {
      const parsed = parseRegistry(`Domain Name: example.test\nName Server: ${value}\nName Server: ns2.example.test`);
      assert.deepEqual(parsed.nameservers, ['ns2.example.test']);
      assert.ok(parsed.fieldsTruncated.includes('nameservers'));
      const exported = projectLookupEvidenceWhoisPublication(parsed);
      assert.deepEqual(exported?.nameservers, ['ns2.example.test']);
      assert.deepEqual(exported?.fieldsTruncated, ['nameservers']);
    }
    const prefix = `Published ${'a'.repeat(150)}`;
    assert.equal(prefix.length, 160);
    const parsed = parseRegistry(`Domain Name: example.test\n[状態] ${prefix}\n[状態] ${prefix} plus other terms`);
    assert.deepEqual(parsed.statuses, [prefix]);
    assert.ok(parsed.fieldsTruncated.includes('statuses'));
    const exported = projectLookupEvidenceWhoisPublication(parsed);
    assert.deepEqual(exported?.statuses, [prefix]);
    assert.deepEqual(exported?.fieldsTruncated, ['statuses']);
  });

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

    const registrant = roleContact(parsed, 'registrant');
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
    assert.equal(roleContact(parsed, 'administrative').handle, 'ADMIN-1');
    assert.equal(roleContact(parsed, 'technical').handle, 'TECH-1');
    assert.equal(roleContact(parsed, 'billing').handle, 'BILL-1');
    assert.deepEqual(roleContact(parsed, 'abuse').emails, ['abuse@example.com']);
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

    assert.equal(requiredValue(parsed.registrantName).length, 300);
    assert.equal(requiredValue(parsed.registrantStreet).length, 300);
    assert.equal(requiredValue(parsed.registrantEmail).length, 320);
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
    assert.deepEqual(roleContact(parsed, 'registrant').addresses, [
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

    const admin = roleContact(parsed, 'administrative');
    assert.equal(admin.name, 'Jane Doe');
    assert.deepEqual(admin.emails, ['jane@example.edu']);
    assert.deepEqual(admin.phones, ['+61 3 0000 0000']);
    assert.deepEqual(admin.addresses, [
      'Example University, Room 100, 1 Example Way, Melbourne VIC 3000, AU',
    ]);
  });

  test('accepts case variations in a legacy indented registrant header', () => {
    const parsed = parseRegistry([
      'Domain Name: EXAMPLE.EDU',
      'registrant:',
      '  Example University',
      '  1 Example Way',
      '  hostmaster@example.edu',
      '',
      'Name Server: NS1.EXAMPLE.EDU',
    ].join('\n'));

    assert.equal(parsed.registrantOrg, 'Example University');
    assert.equal(parsed.registrantEmail, 'hostmaster@example.edu');
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

    assert.equal(roleContact(parsed, 'technical').name, 'Technical Person');
    assert.ok(parsed.fieldsTruncated.includes('techAddress'));
    assert.ok(requiredValue(parsed.techAddress).includes('Address line 19'));
    assert.equal(requiredValue(parsed.techAddress).includes('Address line 20'), false);
  });
});
