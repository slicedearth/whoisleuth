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

  test('retains multiple nested contacts per recognized role and preserves primary compatibility fields', () => {
    const parsed = parseRdap('domain', {
      ldhName: 'EXAMPLE.COM',
      entities: [{
        handle: 'REGISTRY-PARENT',
        roles: ['registrar'],
        vcardArray: ['vcard', [
          ['fn', {}, 'text', 'Primary Registrar'],
          ['email', {}, 'text', 'FIRST@EXAMPLE.COM'],
          ['email', {}, 'text', 'second@example.com'],
          ['tel', {}, 'text', '+61 1'],
          ['tel', {}, 'text', '+61 2'],
          ['adr', {}, 'text', ['', '', '1 Main St', 'Melbourne', 'VIC', '3000', 'AU']],
          ['adr', {}, 'text', ['', '', '2 Branch St', 'Sydney', 'NSW', '2000', 'AU']],
        ]],
        entities: [
          { handle: 'ABUSE-1', roles: ['abuse'], vcardArray: ['vcard', [['email', {}, 'text', 'abuse@example.com']]] },
          { handle: 'ABUSE-2', roles: ['abuse'], vcardArray: ['vcard', [['email', {}, 'text', 'security@example.com']]] },
        ],
      }],
    });

    assert.equal(parsed.registrar.name, 'Primary Registrar');
    assert.equal(parsed.registrar.email, 'first@example.com');
    assert.deepEqual(parsed.registrar.emails, ['first@example.com', 'second@example.com']);
    assert.deepEqual(parsed.registrar.phones, ['+61 1', '+61 2']);
    assert.equal(parsed.registrar.address, '1 Main St, Melbourne, VIC, 3000, AU');
    assert.equal(parsed.registrar.addresses.length, 2);
    assert.deepEqual(parsed.entitiesByRole.abuse.map((entity) => entity.handle), ['ABUSE-1', 'ABUSE-2']);
    assert.equal(parsed.abuse.handle, 'ABUSE-1');
  });

  test('bounds contacts per role, repeated vCard values, public IDs, and links', () => {
    const entities = Array.from({ length: 8 }, (_, index) => ({
      handle: `CONTACT-${index}`,
      roles: ['technical'],
      publicIds: Array.from({ length: 25 }, (__, id) => ({ type: `Type ${id}`, identifier: `ID-${id}` })),
      links: Array.from({ length: 15 }, (__, link) => ({ href: `https://example.com/${link}`, rel: 'related' })),
      vcardArray: ['vcard', Array.from({ length: 12 }, (__, email) => ['email', {}, 'text', `user${email}@example.com`])],
    }));
    const parsed = parseRdap('domain', { ldhName: 'EXAMPLE.COM', entities });

    assert.equal(parsed.entitiesByRole.technical.length, 5);
    assert.equal(parsed.technical.emails.length, 8);
    assert.equal(parsed.technical.publicIds.length, 20);
    assert.equal(parsed.technical.links.length, 10);
    assert.equal(parsed.technical.truncated, true);
    assert.equal(parsed.entitiesTruncated, true);
    assert.deepEqual(parsed.truncatedEntityRoles, ['technical']);
  });

  test('rejects malformed contact values and unsafe links without discarding valid neighbours', () => {
    const parsed = parseRdap('domain', {
      ldhName: 'EXAMPLE.COM',
      links: [
        { href: 'javascript:alert(1)', rel: 'self' },
        { href: 'https://rdap.example/domain/example.com', rel: 'self', title: 'Record' },
      ],
      entities: [{
        handle: 'CONTACT\nFORGED',
        roles: ['registrant', 'unrecognized-role'],
        vcardArray: ['vcard', [
          ['fn', {}, 'text', 'Valid Name'],
          ['email', {}, 'text', 'bad\n@example.com'],
          ['email', {}, 'text', 'valid@example.com'],
          ['tel', {}, 'text', { unexpected: true }],
        ]],
        links: [{ href: 'data:text/plain,secret' }, { href: 'http://example.com/contact' }],
      }],
    });

    assert.equal(parsed.links.length, 1);
    assert.equal(parsed.links[0].href, 'https://rdap.example/domain/example.com');
    assert.equal(parsed.registrant.handle, null);
    assert.deepEqual(parsed.registrant.emails, ['valid@example.com']);
    assert.equal(parsed.registrant.links.length, 1);
    assert.equal(parsed.entitiesByRole['unrecognized-role'], undefined);
  });

  test('caps recursive entity traversal by depth and tolerates cyclic fixture objects', () => {
    const roles = ['registrar', 'registrant', 'administrative', 'technical', 'billing', 'abuse', 'noc', 'registrant'];
    const root = { handle: 'LEVEL-0', roles: [roles[0]], entities: [] };
    let cursor = root;
    for (let depth = 1; depth < roles.length; depth += 1) {
      const child = { handle: `LEVEL-${depth}`, roles: [roles[depth]], entities: [] };
      cursor.entities.push(child);
      cursor = child;
    }
    cursor.entities.push(root);

    const parsed = parseRdap('domain', { ldhName: 'EXAMPLE.COM', entities: [root] });
    assert.equal(parsed.entitiesByRole.registrar[0].handle, 'LEVEL-0');
    assert.equal(parsed.entitiesByRole.noc[0].handle, 'LEVEL-6');
    assert.deepEqual(parsed.entitiesByRole.registrant.map((entity) => entity.handle), ['LEVEL-1']);
  });

  test('renders type-appropriate bounded network and ASN metadata', () => {
    const network = parseRdap('ipv4', {
      handle: 'NET-1', name: 'Example Network', startAddress: '192.0.2.0', endAddress: '192.0.2.255',
      cidr0_cidrs: [{ v4prefix: '192.0.2.0', length: 24 }, null, { v4prefix: 'bad', length: 99 }],
    });
    const asn = parseRdap('asn', { handle: 'AS64496', startAutnum: 64496, endAutnum: 64497 });
    assert.deepEqual(network.cidrs, ['192.0.2.0/24']);
    assert.equal(asn.startAutnum, 64496);
    assert.equal(asn.endAutnum, 64497);
  });

  test('retains shared status and lifecycle metadata for domain, network, and ASN objects', () => {
    for (const type of ['domain', 'ipv4', 'ipv6', 'asn']) {
      const parsed = parseRdap(type, {
        status: ['active'],
        events: [
          { eventAction: 'registration', eventDate: '2020-01-02T03:04:05Z' },
          { eventAction: 'last changed', eventDate: '2026-06-07T08:09:10Z' },
        ],
      });
      assert.deepEqual(parsed.statuses, ['active'], type);
      assert.equal(parsed.lifecycle.createdDate, '2020-01-02T03:04:05Z', type);
      assert.equal(parsed.lifecycle.updatedDate, '2026-06-07T08:09:10Z', type);
    }
  });

  test('discloses common status/event and network CIDR caps', () => {
    const parsed = parseRdap('ipv4', {
      status: Array.from({ length: 101 }, (_, index) => `status-${index}`),
      events: Array.from({ length: 101 }, (_, index) => ({
        eventAction: 'last changed', eventDate: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
      })),
      cidr0_cidrs: Array.from({ length: 201 }, () => ({ v4prefix: '192.0.2.0', length: 24 })),
    });
    assert.equal(parsed.statuses.length, 100);
    assert.equal(parsed.statusesTruncated, true);
    assert.equal(parsed.events.length, 100);
    assert.equal(parsed.eventsTruncated, true);
    assert.equal(parsed.cidrs.length, 200);
    assert.equal(parsed.cidrsTruncated, true);
  });

  test('rejects malformed and cross-family CIDR extension entries without losing valid neighbours', () => {
    const ipv4 = parseRdap('ipv4', {
      cidr0_cidrs: [
        { v4prefix: '192.0.2.0', length: 24 },
        { v4prefix: 'not-an-address', length: 24 },
        { v6prefix: '2001:db8::', length: 32 },
      ],
    });
    const ipv6 = parseRdap('ipv6', {
      cidr0_cidrs: [
        { v6prefix: '2001:db8::', length: 32 },
        { v6prefix: 'not-an-address', length: 32 },
        { v4prefix: '192.0.2.0', length: 24 },
      ],
    });
    assert.deepEqual(ipv4.cidrs, ['192.0.2.0/24']);
    assert.deepEqual(ipv6.cidrs, ['2001:db8::/32']);
  });

  test('normalizes conformance, language, and explicit redaction provenance', () => {
    const parsed = parseRdap('domain', {
      objectClassName: 'DOMAIN',
      ldhName: 'EXAMPLE.COM',
      lang: 'EN-AU',
      rdapConformance: ['rdap_level_0', 'RDAP_LEVEL_0', 'redacted_0'],
      redacted: [{
        name: { type: 'Registry Domain ID' },
        reason: { type: 'Server Policy' },
        method: 'Removal',
        pathLang: 'jsonpath',
        prePath: '$.handle',
      }, null, { name: 'Registrant Email', method: 'emptyValue', postPath: '$.entities[0]' }],
    });

    assert.equal(parsed.objectClassName, 'domain');
    assert.equal(parsed.language, 'en-au');
    assert.deepEqual(parsed.conformance, ['rdap_level_0', 'redacted_0']);
    assert.deepEqual(parsed.redactions[0], {
      name: 'Registry Domain ID', reason: 'Server Policy', method: 'removal',
      pathLanguage: 'jsonpath', prePath: '$.handle', postPath: null, replacementPath: null,
    });
    assert.equal(parsed.redactions[1].name, 'Registrant Email');
    assert.equal(parsed.redactionsTruncated, false);
  });

  test('bounds redaction entries and reports truncation accurately', () => {
    const exact = parseRdap('asn', {
      redacted: Array.from({ length: 100 }, (_, index) => ({ name: `Field ${index}` })),
    });
    const oversized = parseRdap('asn', {
      redacted: Array.from({ length: 101 }, (_, index) => ({ name: `Field ${index}` })),
    });
    assert.equal(exact.redactions.length, 100);
    assert.equal(exact.redactionsTruncated, false);
    assert.equal(oversized.redactions.length, 100);
    assert.equal(oversized.redactionsTruncated, true);
  });

  test('normalizes and bounds IDN variant groups', () => {
    const parsed = parseRdap('domain', {
      ldhName: 'XN--BCHER-KVA.EXAMPLE',
      variants: [{
        relation: ['REGISTERED', 'conjoined'],
        idnTable: 'German',
        variantNames: [
          { ldhName: 'XN--BCHER-KVA.EXAMPLE', unicodeName: 'bücher.example' },
          { ldhName: 'XN--BUCHER-2ZA.EXAMPLE', unicodeName: 'büchér.example' },
          null,
        ],
      }, ...Array.from({ length: 20 }, (_, index) => ({
        relation: ['unregistered'], variantNames: [{ ldhName: `VARIANT-${index}.EXAMPLE` }],
      }))],
    });

    assert.equal(parsed.variants.length, 20);
    assert.deepEqual(parsed.variants[0].relation, ['registered', 'conjoined']);
    assert.equal(parsed.variants[0].variantNames[0].unicodeName, 'bücher.example');
    assert.equal(parsed.variantsTruncated, true);
  });
});
