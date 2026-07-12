// The comparison module is a browser ES module, loaded dynamically for the
// Loaded dynamically because the frontend analysis workspace is ESM.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let comparison;
before(async () => {
  comparison = await import('../frontend/src/lib/analysis/registry-comparison.js');
});
function field(result, label) {
  return result.fields.find((item) => item.label === label);
}

describe('compareRegistrySources', () => {
  test('treats harmless registrar punctuation and casing differences as equivalent', () => {
    const result = comparison.compareRegistrySources(
      { registrar: { name: 'GoDaddy.com, LLC' } },
      { registrar: 'GODADDY.COM LLC' }
    );
    assert.equal(field(result, 'Registrar').status, 'equivalent');
  });

  test('compares registry and registrar identifiers independently of display names', () => {
    const result = comparison.compareRegistrySources(
      { handle: '12345_DOMAIN_COM-VRSN', registrarIanaId: '9999' },
      { registryDomainId: '12345 domain com vrsn', registrarIanaId: '9999' }
    );
    assert.equal(field(result, 'Registry object ID').status, 'equivalent');
    assert.equal(field(result, 'Registrar IANA ID').status, 'equivalent');
  });

  test('compares lifecycle dates without false conflicts from timestamp precision', () => {
    const result = comparison.compareRegistrySources(
      { events: [{ action: 'registration', date: '2025-04-03T00:00:00.000Z' }] },
      { createdDate: '2025-04-03' }
    );
    assert.equal(field(result, 'Created').status, 'equivalent');
  });

  test('prefers deterministic RDAP lifecycle summaries over upstream event order', () => {
    const result = comparison.compareRegistrySources(
      {
        lifecycle: { expiryDate: '2028-01-01T00:00:00Z' },
        events: [{ action: 'expiration', date: '2027-01-01T00:00:00Z' }],
      },
      { expiryDate: '2028-01-01' }
    );
    assert.equal(field(result, 'Expires').status, 'equivalent');
  });

  test('compares nameservers as a case-insensitive, order-independent set', () => {
    const result = comparison.compareRegistrySources(
      { nameservers: ['NS2.EXAMPLE.NET.', 'ns1.example.net'] },
      { nameservers: ['ns1.example.net.', 'ns2.example.net'] }
    );
    assert.equal(field(result, 'Name servers').status, 'equivalent');
  });

  test('normalizes status spacing and EPP-style camel casing', () => {
    const result = comparison.compareRegistrySources(
      { statuses: ['client transfer prohibited', 'serverDeleteProhibited'] },
      { statuses: ['server delete prohibited', 'clientTransferProhibited'] }
    );
    assert.equal(field(result, 'Statuses').status, 'equivalent');
  });

  test('reports a material conflict while preserving both source values', () => {
    const result = comparison.compareRegistrySources(
      { registrar: { name: 'Example Registrar One' } },
      { registrar: 'Example Registrar Two' }
    );
    const registrar = field(result, 'Registrar');
    assert.equal(registrar.status, 'conflict');
    assert.equal(registrar.rdapDisplay, 'Example Registrar One');
    assert.equal(registrar.whoisDisplay, 'Example Registrar Two');
    assert.equal(result.counts.conflict, 1);
  });

  test('distinguishes a value published by only one source from an absent value', () => {
    const result = comparison.compareRegistrySources({ dnssec: 'Signed' }, { dnssec: null });
    const dnssec = field(result, 'DNSSEC');
    assert.equal(dnssec.status, 'rdap_only');
    assert.equal(dnssec.rdapState, 'value');
    assert.equal(dnssec.whoisState, 'absent');
    assert.equal(dnssec.whoisDisplay, 'Not published');
  });

  test('distinguishes a value published by only WHOIS from an absent RDAP value', () => {
    const result = comparison.compareRegistrySources({ dnssec: null }, { dnssec: 'unsigned' });
    const dnssec = field(result, 'DNSSEC');
    assert.equal(dnssec.status, 'whois_only');
    assert.equal(dnssec.rdapState, 'absent');
    assert.equal(dnssec.whoisState, 'value');
    assert.equal(dnssec.rdapDisplay, 'Not published');
  });

  test('identifies redaction rather than displaying it as ordinary data', () => {
    const result = comparison.compareRegistrySources(
      { registrar: { name: 'Example Registrar' } },
      { registrar: 'REDACTED FOR PRIVACY' }
    );
    const registrar = field(result, 'Registrar');
    assert.equal(registrar.status, 'whois_redacted');
    assert.equal(registrar.whoisState, 'redacted');
    assert.equal(registrar.whoisDisplay, 'Redacted by source');
  });

  test('identifies redaction on the RDAP side the same way', () => {
    const result = comparison.compareRegistrySources(
      { registrar: { name: 'REDACTED FOR PRIVACY' } },
      { registrar: 'Example Registrar' }
    );
    const registrar = field(result, 'Registrar');
    assert.equal(registrar.status, 'rdap_redacted');
    assert.equal(registrar.rdapState, 'redacted');
  });

  test('treats both sources redacting the same field as equivalent, not a conflict', () => {
    const result = comparison.compareRegistrySources(
      { registrar: { name: 'REDACTED FOR PRIVACY' } },
      { registrar: 'Data Protected' }
    );
    assert.equal(field(result, 'Registrar').status, 'equivalent');
  });

  test('omits fields that neither source publishes', () => {
    const result = comparison.compareRegistrySources({}, {});
    assert.deepEqual(result.fields, []);
    assert.deepEqual(result.counts, {
      equivalent: 0, conflict: 0, rdap_only: 0, whois_only: 0, rdap_redacted: 0, whois_redacted: 0,
    });
  });
});
