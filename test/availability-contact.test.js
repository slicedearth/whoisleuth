const test = require('node:test');
const assert = require('node:assert/strict');

const { checkDomainAvailability } = require('../lib/availability');
const { networkFeaturePolicy } = require('../lib/feature-policy');

test('availability keeps the compact contact shape when RDAP exposes richer arrays', async () => {
  const richContact = {
    handle: 'CONTACT-1',
    name: 'Example Contact',
    names: ['Example Contact', 'Alternate Name'],
    org: 'Example Org',
    organizations: ['Example Org', 'Alternate Org'],
    email: 'first@example.com',
    emails: ['first@example.com', 'second@example.com'],
    phone: '+61 1',
    phones: ['+61 1', '+61 2'],
    address: '1 Main St',
    addresses: ['1 Main St', '2 Branch St'],
    links: [{ href: 'https://example.com/contact' }],
    publicIds: [{ type: 'Example', identifier: '123' }],
  };
  const result = await checkDomainAvailability('example.com', {
    fast: true,
    rdapRecord: {
      upstreamStatus: 200,
      rdapServer: 'https://rdap.example/domain/example.com',
      parsed: {
        statuses: ['active'], nameservers: [], events: [],
        lifecycle: {
          createdDate: '2020-01-02T03:04:05Z',
          createdDateIso: '2020-01-02T03:04:05.000Z',
          expiryDate: '2030-01-02T03:04:05Z',
          expiryDateIso: '2030-01-02T03:04:05.000Z',
        },
        registrar: richContact, registrant: richContact, abuse: richContact,
      },
    },
  });

  for (const contact of [result.registrar, result.registrant, result.abuse]) {
    assert.deepEqual(Object.keys(contact).sort(), ['address', 'email', 'handle', 'name', 'org', 'phone']);
    assert.equal(Object.hasOwn(contact, 'emails'), false);
    assert.equal(Object.hasOwn(contact, 'links'), false);
  }
  assert.equal(result.createdDate, '2020-01-02T03:04:05Z');
  assert.equal(result.createdDateIso, '2020-01-02T03:04:05.000Z');
  assert.equal(result.expiryDate, '2030-01-02T03:04:05Z');
  assert.equal(result.expiryDateIso, '2030-01-02T03:04:05.000Z');
});

test('does not promote an administrative organization to registrar', async () => {
  const result = await checkDomainAvailability('example.gt', {
    featurePolicy: networkFeaturePolicy({
      WHOISLEUTH_DISABLE_DNS_INTELLIGENCE: '1',
      WHOISLEUTH_DISABLE_WEBSITE_PROBE: '1',
      WHOISLEUTH_DISABLE_TLS_INTELLIGENCE: '1',
    }),
    rdapRecord: null,
    whoisChain: [{
      server: 'whois.iana.org',
      response: 'domain: GT\norganisation: Registry',
    }, {
      server: 'registry website',
      response: [
        'Domain Name: EXAMPLE.GT',
        'Domain Status: Active',
        'Registrant Organization: Example Holder',
        'Admin Organization: Example Holder',
        'Creation Date: 03.04.2024',
        'Registry Expiry Date: 05.11.2030',
        'Name Server: ns1.example.net',
      ].join('\n'),
    }],
  });

  assert.equal(result.state, 'registered');
  assert.equal(result.registrar, null);
  assert.equal(result.registrant.org, 'Example Holder');
  assert.equal(result.createdDate, '03.04.2024');
  assert.equal(result.createdDateIso, '2024-04-03T00:00:00.000Z');
  assert.equal(result.expiryDate, '05.11.2030');
  assert.equal(result.expiryDateIso, '2030-11-05T00:00:00.000Z');
});
