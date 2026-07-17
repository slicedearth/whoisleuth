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

  test('uses ISO companions for comparison while preserving raw source display values', () => {
    const result = comparison.compareRegistrySources(
      {
        lifecycle: {
          createdDate: '2025-04-03T00:00:00Z',
          createdDateIso: '2025-04-03T00:00:00.000Z',
        },
      },
      {
        createdDate: '03.04.2025',
        createdDateIso: '2025-04-03T00:00:00.000Z',
      }
    );
    const created = field(result, 'Created');
    assert.equal(created.status, 'equivalent');
    assert.equal(created.rdapDisplay, '2025-04-03T00:00:00Z');
    assert.equal(created.whoisDisplay, '03.04.2025');
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

  test('does not report RDAP-only publication when WHOIS failed', () => {
    const result = comparison.compareRegistrySources(
      { domain: 'example.com', registrar: { name: 'Example Registrar' } },
      {},
      { rdapStatus: 'success', whoisStatus: 'error' }
    );
    const registrar = field(result, 'Registrar');
    assert.equal(registrar.status, 'whois_unavailable');
    assert.equal(registrar.whoisState, 'unavailable');
    assert.equal(registrar.whoisDisplay, 'Source unavailable');
    assert.equal(result.counts.rdap_only, 0);
    assert.equal(result.counts.whois_unavailable, 2);
  });

  test('distinguishes unsupported and not-found RDAP from unpublished fields', () => {
    const unsupported = comparison.compareRegistrySources(
      {}, { domainName: 'example.com' },
      { rdapStatus: 'unsupported', whoisStatus: 'complete' }
    );
    assert.equal(field(unsupported, 'Domain').status, 'rdap_unavailable');
    assert.equal(field(unsupported, 'Domain').rdapDisplay, 'Unsupported by source');

    const notFound = comparison.compareRegistrySources(
      {}, { domainName: 'example.com' },
      { rdapStatus: 'not_found', whoisStatus: 'complete' }
    );
    assert.equal(field(notFound, 'Domain').status, 'rdap_unavailable');
    assert.equal(field(notFound, 'Domain').rdapDisplay, 'No matching registry object');
  });

  test('marks fields absent from a partial WHOIS chain as incomplete', () => {
    const result = comparison.compareRegistrySources(
      { domain: 'example.com', registrar: { name: 'Example Registrar' } },
      { domainName: 'EXAMPLE.COM' },
      { rdapStatus: 'success', whoisStatus: 'partial' }
    );
    assert.equal(field(result, 'Domain').status, 'equivalent');
    assert.equal(field(result, 'Registrar').status, 'whois_incomplete');
    assert.equal(field(result, 'Registrar').whoisDisplay, 'Not observed (partial source)');
    assert.equal(result.counts.whois_incomplete, 1);
  });

  test('compares values that are present even when the containing WHOIS chain is partial', () => {
    const result = comparison.compareRegistrySources(
      { registrar: { name: 'Example Registrar' } },
      { registrar: 'Example Registrar' },
      { rdapStatus: 'success', whoisStatus: 'partial' }
    );
    assert.equal(field(result, 'Registrar').status, 'equivalent');
  });

  test('treats a disabled source as unavailable rather than unpublished', () => {
    const result = comparison.compareRegistrySources(
      {},
      { registrar: 'Example Registrar' },
      { rdapStatus: 'disabled', whoisStatus: 'complete' }
    );
    const registrar = field(result, 'Registrar');
    assert.equal(registrar.status, 'rdap_unavailable');
    assert.equal(registrar.rdapDisplay, 'Disabled by deployment policy');
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
      rdap_unavailable: 0, whois_unavailable: 0, rdap_incomplete: 0, whois_incomplete: 0,
    });
    assert.deepEqual(result.sourceHealth, {
      rdap: { status: null, condition: 'complete' },
      whois: { status: null, condition: 'complete' },
    });
  });
});

describe('compareRdapPublications', () => {
  test('reuses normalized domain, lifecycle, status, and nameserver comparisons', () => {
    const result = comparison.compareRdapPublications(
      {
        domain: 'EXAMPLE.TEST',
        handle: 'registry-specific-handle',
        lifecycle: { createdDate: '2025-04-03T00:00:00Z' },
        statuses: ['client transfer prohibited'],
        nameservers: ['NS2.EXAMPLE.TEST.', 'ns1.example.test'],
      },
      {
        domain: 'example.test',
        handle: 'registrar-specific-handle',
        lifecycle: { createdDate: '2025-04-03' },
        statuses: ['clientTransferProhibited'],
        nameservers: ['NS1.EXAMPLE.TEST.', 'ns2.example.test'],
      },
      { registryStatus: 'success', registrarStatus: 'success' },
    );

    assert.equal(result.fields.every((item) => item.status === 'equivalent'), true);
    assert.equal(result.fields.some((item) => item.label === 'Registry object ID'), false);
    assert.equal(result.counts.equivalent, 4);
    assert.deepEqual(result.sourceHealth, {
      registry: { status: 'success', condition: 'complete' },
      registrar: { status: 'success', condition: 'complete' },
    });
  });

  test('treats portable registrar lock statuses as equivalent to client-set registry statuses', () => {
    const result = comparison.compareRdapPublications(
      { statuses: ['client delete prohibited', 'clientTransferProhibited'] },
      { statuses: ['delete prohibited', 'transfer prohibited'] },
    );

    assert.equal(field(result, 'Statuses').status, 'equivalent');
    assert.equal(result.counts.conflict, 0);
  });

  test('keeps registry-set locks distinct from generic registrar lock statuses', () => {
    const result = comparison.compareRdapPublications(
      { statuses: ['serverDeleteProhibited'] },
      { statuses: ['delete prohibited'] },
    );

    assert.equal(field(result, 'Statuses').status, 'conflict');
  });

  test('preserves both publications when a portable field conflicts', () => {
    const result = comparison.compareRdapPublications(
      { domain: 'example.test', lifecycle: { expiryDate: '2030-01-01' } },
      { domain: 'example.test', lifecycle: { expiryDate: '2031-01-01' } },
    );
    const expiry = field(result, 'Expires');
    assert.equal(expiry.status, 'conflict');
    assert.equal(expiry.registryDisplay, '2030-01-01');
    assert.equal(expiry.registrarDisplay, '2031-01-01');
    assert.equal(result.counts.conflict, 1);
  });

  test('distinguishes source-only and redacted publication states', () => {
    const result = comparison.compareRdapPublications(
      { domain: 'example.test', dnssec: 'signed', registrar: { name: 'Data Protected' } },
      { domain: 'example.test', dnssec: null, registrar: { name: 'Example Registrar' } },
    );
    assert.equal(field(result, 'DNSSEC').status, 'registry_only');
    assert.equal(field(result, 'Registrar').status, 'registry_redacted');
    assert.equal(result.counts.registrar_only, 0);
  });

  test('keeps unavailable registrar publication distinct from an absent value', () => {
    const result = comparison.compareRdapPublications(
      { domain: 'example.test', dnssec: 'signed' },
      {},
      { registryStatus: 'success', registrarStatus: 'error' },
    );
    assert.equal(field(result, 'Domain').status, 'registrar_unavailable');
    assert.equal(field(result, 'DNSSEC').status, 'registrar_unavailable');
    assert.equal(result.counts.registry_only, 0);
    assert.equal(result.counts.registrar_unavailable, 2);
  });

  test('does not mutate either RDAP publication', () => {
    const registry = { domain: 'example.test', handle: 'registry-handle', statuses: ['active'] };
    const registrar = { domain: 'example.test', handle: 'registrar-handle', statuses: ['active'] };
    const beforeRegistry = structuredClone(registry);
    const beforeRegistrar = structuredClone(registrar);
    comparison.compareRdapPublications(registry, registrar);
    assert.deepEqual(registry, beforeRegistry);
    assert.deepEqual(registrar, beforeRegistrar);
  });
});
