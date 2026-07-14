'use strict';

// Anonymized synthetic objects model representative domain-registry and RIR
// response shapes without retaining third-party registration data. Expected
// values intentionally cover the shared normalized contract rather than every
// upstream property, so fixtures remain readable as additive fields evolve.

const entity = (handle, roles, name, email) => ({
  handle,
  roles,
  vcardArray: ['vcard', [
    ['fn', {}, 'text', name],
    ...(email ? [['email', {}, 'text', email]] : []),
  ]],
});

module.exports = [
  {
    name: 'thick domain registry object',
    type: 'domain',
    input: {
      objectClassName: 'domain',
      handle: 'DOMAIN-1',
      ldhName: 'EXAMPLE.TEST',
      status: ['active', 'client transfer prohibited'],
      events: [
        { eventAction: 'last changed', eventDate: '2026-06-01T01:02:03Z' },
        { eventAction: 'last update of RDAP database', eventDate: '2026-06-02T02:03:04Z' },
        { eventAction: 'registration', eventDate: '2020-01-02T03:04:05Z' },
        { eventAction: 'expiration', eventDate: '2030-01-02T03:04:05Z' },
      ],
      entities: [
        {
          ...entity('REGISTRAR-1', ['registrar'], 'Example Registrar', 'abuse@registrar.invalid'),
          publicIds: [{ type: 'IANA Registrar ID', identifier: '9999' }],
        },
        entity('REGISTRANT-1', ['registrant'], 'Example Registrant', 'holder@example.invalid'),
      ],
      nameservers: [{ ldhName: 'NS1.EXAMPLE.INVALID' }],
      secureDNS: { zoneSigned: true, delegationSigned: true },
    },
    expected: {
      objectClassName: 'domain',
      domain: 'EXAMPLE.TEST',
      handle: 'DOMAIN-1',
      statuses: ['active', 'client transfer prohibited'],
      lifecycle: {
        createdDate: '2020-01-02T03:04:05Z', reregistrationDate: null,
        expiryDate: '2030-01-02T03:04:05Z', updatedDate: '2026-06-01T01:02:03Z',
        transferDate: null, deletionDate: null, reinstantiationDate: null,
        databaseUpdatedDate: '2026-06-02T02:03:04Z',
        createdDateIso: '2020-01-02T03:04:05.000Z', reregistrationDateIso: null,
        expiryDateIso: '2030-01-02T03:04:05.000Z', updatedDateIso: '2026-06-01T01:02:03.000Z',
        transferDateIso: null, deletionDateIso: null, reinstantiationDateIso: null,
        databaseUpdatedDateIso: '2026-06-02T02:03:04.000Z',
      },
      nameservers: ['NS1.EXAMPLE.INVALID'],
      dnssec: 'Signed',
      registrarIanaId: '9999',
      registrarHandle: 'REGISTRAR-1',
      registrantHandle: 'REGISTRANT-1',
    },
  },
  {
    name: 'thin domain registry object without registrant publication',
    type: 'domain',
    input: {
      objectClassName: 'domain',
      handle: 'DOMAIN-2',
      ldhName: 'THIN.TEST',
      status: ['active'],
      entities: [entity('REGISTRAR-2', ['registrar'], 'Thin Registry Registrar', null)],
      links: [{ rel: 'related', href: 'https://registrar.invalid/rdap/domain/thin.test' }],
    },
    expected: {
      domain: 'THIN.TEST',
      statuses: ['active'],
      registrarHandle: 'REGISTRAR-2',
      registrantHandle: null,
      relatedLink: 'https://registrar.invalid/rdap/domain/thin.test',
    },
  },
  {
    name: 'IPv4 RIR allocation with CIDR extension and lifecycle',
    type: 'ipv4',
    input: {
      objectClassName: 'ip network',
      handle: 'NET-192-0-2-0-1',
      name: 'EXAMPLE-NET-V4',
      startAddress: '192.0.2.0',
      endAddress: '192.0.2.255',
      ipVersion: 'v4',
      type: 'DIRECT ALLOCATION',
      country: 'au',
      status: ['active'],
      cidr0_cidrs: [
        { v4prefix: '192.0.2.0', length: 24 },
        { v4prefix: 'not-an-address', length: 24 },
        { v6prefix: '2001:db8::', length: 32 },
      ],
      events: [
        { eventAction: 'registration', eventDate: '2001-02-03T04:05:06Z' },
        { eventAction: 'last changed', eventDate: '2025-06-07T08:09:10Z' },
      ],
      entities: [
        entity('ORG-V4', ['registrant'], 'Example Network Organisation', null),
        entity('ABUSE-V4', ['abuse'], 'Network Abuse', 'abuse@example.invalid'),
      ],
    },
    expected: {
      handle: 'NET-192-0-2-0-1',
      name: 'EXAMPLE-NET-V4',
      startAddress: '192.0.2.0',
      endAddress: '192.0.2.255',
      cidrs: ['192.0.2.0/24'],
      country: 'au',
      statuses: ['active'],
      createdDate: '2001-02-03T04:05:06Z',
      updatedDate: '2025-06-07T08:09:10Z',
      orgHandle: 'ORG-V4',
      abuseHandle: 'ABUSE-V4',
    },
  },
  {
    name: 'IPv6 RIR allocation with mixed malformed CIDR neighbours',
    type: 'ipv6',
    input: {
      objectClassName: 'ip network',
      handle: 'NET6-2001-DB8-1',
      name: 'EXAMPLE-NET-V6',
      startAddress: '2001:db8::',
      endAddress: '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff',
      type: 'ALLOCATED-BY-RIR',
      country: 'nz',
      status: ['allocated'],
      cidr0_cidrs: [
        { v6prefix: '2001:db8::', length: 32 },
        { v6prefix: '2001:db8::', length: 129 },
        { v4prefix: '192.0.2.0', length: 33 },
        null,
      ],
      events: [{ eventAction: 'registration', eventDate: '2002-03-04T05:06:07Z' }],
      entities: [entity('ABUSE-V6', ['abuse'], 'IPv6 Abuse', 'v6-abuse@example.invalid')],
    },
    expected: {
      handle: 'NET6-2001-DB8-1',
      cidrs: ['2001:db8::/32'],
      country: 'nz',
      statuses: ['allocated'],
      createdDate: '2002-03-04T05:06:07Z',
      abuseHandle: 'ABUSE-V6',
    },
  },
  {
    name: 'autonomous-system RIR allocation',
    type: 'asn',
    input: {
      objectClassName: 'autnum',
      handle: 'AS64496',
      name: 'EXAMPLE-AS',
      startAutnum: 64496,
      endAutnum: 64500,
      type: 'DIRECT ALLOCATION',
      country: 'us',
      status: ['active'],
      events: [
        { eventAction: 'registration', eventDate: '2003-04-05T06:07:08Z' },
        { eventAction: 'last changed', eventDate: '2024-05-06T07:08:09Z' },
      ],
      entities: [
        entity('ORG-AS', ['registrant'], 'Example Autonomous System', null),
        entity('ABUSE-AS', ['abuse'], 'ASN Abuse', 'asn-abuse@example.invalid'),
      ],
    },
    expected: {
      handle: 'AS64496',
      name: 'EXAMPLE-AS',
      startAutnum: 64496,
      endAutnum: 64500,
      country: 'us',
      statuses: ['active'],
      createdDate: '2003-04-05T06:07:08Z',
      updatedDate: '2024-05-06T07:08:09Z',
      orgHandle: 'ORG-AS',
      abuseHandle: 'ABUSE-AS',
    },
  },
];
