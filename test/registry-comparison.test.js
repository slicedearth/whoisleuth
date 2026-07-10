// The comparison module is a browser ES module, loaded dynamically for the
// same reason as public/js/scoring.js in scoring.test.js.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let comparison;
before(async () => {
  comparison = await import('../public/js/registry-comparison.js');
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

  test('compares lifecycle dates without false conflicts from timestamp precision', () => {
    const result = comparison.compareRegistrySources(
      { events: [{ action: 'registration', date: '2025-04-03T00:00:00.000Z' }] },
      { createdDate: '2025-04-03' }
    );
    assert.equal(field(result, 'Created').status, 'equivalent');
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

  test('distinguishes a source-only value from an absent value', () => {
    const result = comparison.compareRegistrySources({ dnssec: 'Signed' }, { dnssec: null });
    const dnssec = field(result, 'DNSSEC');
    assert.equal(dnssec.status, 'source_only');
    assert.equal(dnssec.rdapState, 'value');
    assert.equal(dnssec.whoisState, 'absent');
    assert.equal(dnssec.whoisDisplay, 'Not published');
  });

  test('identifies redaction rather than displaying it as ordinary data', () => {
    const result = comparison.compareRegistrySources(
      { registrar: { name: 'Example Registrar' } },
      { registrar: 'REDACTED FOR PRIVACY' }
    );
    const registrar = field(result, 'Registrar');
    assert.equal(registrar.status, 'source_only');
    assert.equal(registrar.whoisState, 'redacted');
    assert.equal(registrar.whoisDisplay, 'Redacted by source');
  });

  test('omits fields that neither source publishes', () => {
    const result = comparison.compareRegistrySources({}, {});
    assert.deepEqual(result.fields, []);
    assert.deepEqual(result.counts, { equivalent: 0, source_only: 0, conflict: 0 });
  });
});
