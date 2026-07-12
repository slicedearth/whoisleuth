const { describe, test, before } = require('node:test');
const assert = require('node:assert/strict');

let evidence;
before(async () => {
  evidence = await import('../frontend/src/lib/analysis/evidence-export.js');
});

function fixtureResponse() {
  return {
    query: 'login.example.com',
    type: 'domain',
    inputHostname: 'login.example.com',
    registrableDomain: 'example.com',
    isSubdomain: true,
    rdap: {
      rdapServer: 'https://rdap.example/domain/example.com',
      transportSecurity: 'https',
      upstreamStatus: 200,
      fetchedAt: '2026-07-11T01:02:03.000Z',
      attempts: [{
        endpoint: 'https://rdap.example/domain/example.com', transportSecurity: 'https',
        status: 200, outcome: 'success', detail: 'The endpoint returned the requested RDAP object.', selected: true,
      }],
      parsed: {
        domain: 'EXAMPLE.COM',
        registrar: { name: 'Example Registrar' },
        nameservers: ['NS1.EXAMPLE'],
        events: [{ action: 'registration', date: '2020-01-01T00:00:00Z' }],
      },
      data: { objectClassName: 'domain', ldhName: 'EXAMPLE.COM' },
    },
    whois: {
      parsed: {
        domainName: 'EXAMPLE.COM',
        registrar: 'Example Registrar',
        nameservers: ['ns1.example.'],
        createdDate: '2020-01-01',
        chainStatus: 'complete',
        authoritativeHop: 'whois.registry.example',
      },
      chain: [
        { server: 'whois.iana.org', queriedAt: '2026-07-11T01:02:03.000Z', response: 'refer: whois.registry.example' },
        { server: 'whois.registry.example', queriedAt: '2026-07-11T01:02:04.000Z', response: 'Domain Name: EXAMPLE.COM' },
      ],
    },
    availability: { applicable: true, domain: 'example.com', state: 'registered', hasMx: true },
    diagnostics: {
      version: 2,
      rdap: { status: 'success', errorCode: null, attempts: [] },
      whois: { status: 'complete', errorCode: null },
      availability: { status: 'complete', errorCode: null, resultState: 'registered' },
    },
  };
}

describe('lookup evidence export', () => {
  test('packages query context, raw sources, analysis, and provenance', () => {
    const response = fixtureResponse();
    const result = evidence.buildLookupEvidence(response, { generatedAt: '2026-07-11T02:00:00.000Z' });

    assert.equal(result.schema, 'whoisleuth.lookup-evidence');
    assert.equal(result.schemaVersion, 2);
    assert.equal(result.query.submitted, 'login.example.com');
    assert.equal(result.query.registrableDomain, 'example.com');
    assert.equal(result.diagnostics.rdap.status, 'success');
    assert.equal(result.sources.rdap.endpoint, 'https://rdap.example/domain/example.com');
    assert.equal(result.sources.rdap.transportSecurity, 'https');
    assert.equal(result.sources.rdap.raw.ldhName, 'EXAMPLE.COM');
    assert.equal(result.sources.rdap.attempts[0].outcome, 'success');
    assert.equal(result.sources.whois.chain[1].response, 'Domain Name: EXAMPLE.COM');
    assert.equal(result.sources.whois.authoritativeHop, 'whois.registry.example');
    assert.equal(result.analysis.availability.hasMx, true);
    assert.equal(result.analysis.registryComparison.counts.conflict, 0);
    assert.equal(result.generatedAt, '2026-07-11T02:00:00.000Z');
  });

  test('retains partial source failures without failing the export', () => {
    const response = fixtureResponse();
    response.rdap = { error: 'RDAP timed out', attempts: [{ outcome: 'timeout' }] };
    response.whois.parsed.chainStatus = 'partial';
    response.whois.parsed.failedHop = 'whois.registrar.example';
    const result = evidence.buildLookupEvidence(response);

    assert.deepEqual(result.sources.rdap, {
      status: 'error', error: 'RDAP timed out', attempts: [{ outcome: 'timeout' }],
    });
    assert.equal(result.sources.whois.status, 'partial');
    assert.equal(result.sources.whois.failedHop, 'whois.registrar.example');
  });

  test('creates a bounded, filesystem-safe filename', () => {
    const filename = evidence.evidenceFilename(
      { registrableDomain: 'Bücher.Example/path' },
      Date.parse('2026-07-11T02:03:04.000Z')
    );
    assert.equal(filename, 'whoisleuth-evidence-b-cher.example-path-2026-07-11T02-03-04-000Z.json');
  });
});
