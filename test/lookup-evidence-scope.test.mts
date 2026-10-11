import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildLookupEvidenceScope } from '../frontend/src/lib/analysis/lookup-evidence-scope.ts';
import { parseLookupHttpResponse, type LookupHttpResponse } from '../frontend/src/lib/analysis/lookup-response.ts';
import { MAX_LOOKUP_TLS_ALT_NAMES } from '../packages/analysis/lookup-network-evidence-bounds.mts';
import { rec } from '../frontend/src/lib/analysis/lookup-display-shared.ts';

function fixture(): LookupHttpResponse {
  return {
    query: 'portal.example.test', type: 'domain', inputHostname: 'portal.example.test', registrableDomain: 'example.test',
    rdap: { parsed: { domain: 'registry.example.test' }, fetchedAt: '2026-01-01T01:00:00Z',
      registrarRdap: { status: 'partial', fetchedAt: '2026-01-01T02:00:00Z', parsed: { domain: 'registrar.example.test' } } },
    whois: { parsed: { domainName: 'whois.example.test' }, chain: [
      { server: 'whois.registry.example.test', queriedAt: '2026-01-01T03:00:00Z' },
      { server: 'whois.registrar.example.test', queriedAt: '2026-01-01T04:00:00Z' },
    ] },
    diagnostics: { rdap: { status: 'success' }, whois: { status: 'partial', queriedAt: '2026-01-01T03:00:00Z' } },
    availability: { domain: 'example.test', observationHostname: 'portal.example.test', webObservationMode: 'selected_url',
      dns: { status: 'partial', observedAt: '2026-01-01T05:00:00Z',
        records: { a: [], aaaa: ['2001:db8::1'], mx: [], spf: [], dmarc: [], https: [{ owner: 'alias.example.test' }] },
        diagnostics: { a: { status: 'not_found', detail: 'no_data' }, aaaa: { status: 'success', detail: 'records' },
          mx: { status: 'error', detail: 'timeout' }, spf: { status: 'skipped', detail: 'skipped' } },
        delegation: { domain: 'example.test' },
        caaPolicy: { policyVersion: 1, status: 'partial', observedAt: '2026-01-01T05:01:00Z', effectiveOwner: null, inherited: null },
      },
      http: { status: 'error', observedAt: '2026-01-01T06:00:00Z', requestUrl: 'https://portal.example.test/selected', finalUrl: null },
      tls: { status: 'partial', observedAt: '2026-01-01T07:00:00Z', sniHost: 'portal.example.test',
        certificate: { subjectAltNames: { dnsNames: ['*.example.test', 'other.example.test'], ipAddresses: ['192.0.2.1'], truncated: true } } },
    },
  };
}

function row(result: ReturnType<typeof buildLookupEvidenceScope>, id: string, label: string) {
  const source = result.sources.find(source => source.id === id);
  assert.ok(source, `Expected ${id} source`);
  const row = source.rows.find(row => row.label === label);
  assert.ok(row, `Expected ${label} row`);
  return row.value;
}

describe('retained Lookup source scope', () => {
  test('keeps request context, separate returned domains and each source clock distinct', () => {
    const original = fixture();
    const before = structuredClone(original);
    const result = buildLookupEvidenceScope(original);
    assert.deepEqual(result.context, [
      { label: 'Submitted hostname', value: 'portal.example.test' },
      { label: 'Registration request', value: 'example.test' },
    ]);
    assert.equal(row(result, 'registry', 'Returned domain'), 'registry.example.test');
    assert.equal(row(result, 'registrar', 'Returned domain'), 'registrar.example.test');
    assert.equal(row(result, 'whois', 'Returned domain'), 'whois.example.test');
    assert.deepEqual(result.sources.map(source => [source.id, source.observedAt]), [
      ['registry', '2026-01-01T01:00:00.000Z'], ['registrar', '2026-01-01T02:00:00.000Z'], ['whois', null],
      ['dns', '2026-01-01T05:00:00.000Z'], ['caa', '2026-01-01T05:01:00.000Z'],
      ['http', '2026-01-01T06:00:00.000Z'], ['tls', '2026-01-01T07:00:00.000Z'],
    ]);
    assert.match(row(result, 'whois', 'Hop 1 · whois.registry.example.test'), /03:00:00 UTC$/u);
    assert.match(row(result, 'whois', 'Hop 2 · whois.registrar.example.test'), /04:00:00 UTC$/u);
    assert.deepEqual(original, before);
  });

  test('distinguishes DNS outcomes and retained answer owners without assigning record targets as owners', () => {
    const result = buildLookupEvidenceScope(fixture());
    assert.equal(row(result, 'dns', 'Collection hostname'), 'portal.example.test');
    assert.equal(row(result, 'dns', 'A outcome'), 'No data for this record type (NODATA)');
    assert.equal(row(result, 'dns', 'AAAA outcome'), 'Records returned');
    assert.equal(row(result, 'dns', 'MX outcome'), 'DNS query timed out');
    assert.equal(row(result, 'dns', 'TXT (SPF) outcome'), 'Not queried');
    assert.equal(row(result, 'dns', 'TXT (DMARC) outcome'), 'Exact outcome not retained');
    assert.equal(row(result, 'dns', 'Retained HTTPS answer owners'), 'alias.example.test');
    assert.equal(row(result, 'dns', 'Delegation review domain'), 'example.test');
    assert.match(result.sources.find(source => source.id === 'dns')!.note, /do not retain individual answer owners/u);
  });

  test('does not call inconsistent or truncated address evidence a completed empty answer', () => {
    const original = fixture();
    const dns = rec(original.availability.dns);
    Object.assign(rec(dns.records), { a: ['192.0.2.1'] });
    assert.equal(row(buildLookupEvidenceScope(original), 'dns', 'A outcome'), 'DNS answer and outcome are inconsistent or unreadable');
    Object.assign(rec(rec(dns.diagnostics).aaaa), { truncated: true });
    assert.equal(row(buildLookupEvidenceScope(original), 'dns', 'AAAA outcome'), 'DNS answer incomplete');
  });

  test('does not collapse empty answers, missing names, legacy negatives and missing diagnostics', () => {
    const original = fixture();
    const diagnostics = rec(rec(original.availability.dns).diagnostics);
    for (const [diagnostic, expected] of [
      [{ status: 'not_found', detail: 'empty_answer' }, 'No records returned'],
      [{ status: 'not_found', detail: 'name_not_found' }, 'Name not found by resolver'],
      [{ status: 'not_found' }, 'Exact outcome not retained'],
      [{}, 'Exact outcome not retained'],
    ] as const) {
      Object.assign(diagnostics, { a: diagnostic });
      assert.equal(row(buildLookupEvidenceScope(original), 'dns', 'A outcome'), expected);
    }
  });

  test('shows missing scope and undated sources without input or current-time fallbacks', () => {
    const original = fixture();
    const { inputHostname: _submitted, ...undated } = original;
    Object.assign(undated, {
      rdap: { parsed: {} },
      whois: { parsed: {}, chain: [{ server: 'whois.example.test', queriedAt: '2026-01-01' }] },
      diagnostics: {},
      availability: { domain: 'example.test', dns: { status: 'skipped', records: { a: [] } } },
    });
    const result = buildLookupEvidenceScope(undated);
    assert.equal(row(result, 'registry', 'Returned domain'), 'Not retained');
    assert.equal(row(result, 'whois', 'Returned domain'), 'Not retained');
    assert.equal(row(result, 'whois', 'Hop 1 · whois.example.test'), 'Query time not retained');
    assert.equal(row(result, 'dns', 'Collection hostname'), 'example.test');
    assert.equal(row(result, 'dns', 'A outcome'), 'Not queried');
    assert.equal(row(result, 'http', 'Final URL'), 'Not retained');
    assert.equal(row(result, 'tls', 'Connection hostname (SNI)'), 'Not retained');
    assert.ok(result.sources.every(source => source.observedAt === null));
    Object.assign(undated.availability, { observationHostname: null });
    assert.equal(row(buildLookupEvidenceScope(undated), 'dns', 'Collection hostname'), 'Not retained');
  });

  test('keeps HTTP attempts distinct from destinations and never derives a URL from the query', () => {
    const original = fixture();
    Object.assign(original, { query: 'https://portal.example.test/private-draft?private=sentinel#private' });
    const result = buildLookupEvidenceScope(original);
    assert.equal(row(result, 'http', 'Requested URL'), 'https://portal.example.test/selected');
    assert.equal(row(result, 'http', 'Final URL'), 'Not retained');
    assert.equal(row(result, 'http', 'Query and fragment'), 'Not retained');
    assert.doesNotMatch(JSON.stringify(result), /private-draft|sentinel/u);
    Object.assign(original.availability, { http: { status: 'success', requestUrl: 'https://portal.example.test/', finalUrl: 'https://landing.example.test/' } });
    assert.equal(row(buildLookupEvidenceScope(original), 'http', 'Final URL'), 'https://landing.example.test/');
    Object.assign(original.availability, { http: { status: 'error', requestUrl: 'https://portal.example.test/' } });
    assert.equal(row(buildLookupEvidenceScope(original), 'http', 'Final URL'), 'Not retained');
  });

  test('leaves private URL rejection with the response admission owner', () => {
    const http = { requestUrl: 'https://portal.example.test/selected', finalUrl: null };
    const original: LookupHttpResponse = {
      query: 'portal.example.test', type: 'domain', rdap: { parsed: {} }, whois: { parsed: {}, chain: [] },
      diagnostics: {}, availability: { domain: 'example.test', http },
    };
    assert.equal(parseLookupHttpResponse(original).ok, true, 'The public URL control must be admitted first');
    http.requestUrl = 'https://portal.example.test/?private=sentinel';
    assert.equal(parseLookupHttpResponse(original).ok, false);
  });

  test('keeps wildcard publication and unknown CAA inheritance explicit', () => {
    const original = fixture();
    const result = buildLookupEvidenceScope(original);
    assert.equal(row(result, 'tls', 'Certificate DNS names'), '*.example.test, other.example.test');
    assert.equal(row(result, 'tls', 'Certificate IP addresses'), '192.0.2.1');
    assert.equal(row(result, 'tls', 'Certificate name coverage'), 'Incomplete; some certificate names were omitted');
    assert.equal(row(result, 'caa', 'Inherited'), 'Unknown');
    assert.equal(row(result, 'caa', 'Effective policy owner'), 'Not retained');
    const caa = rec(rec(original.availability.dns).caaPolicy);
    Object.assign(caa, { inherited: true, effectiveOwner: 'example.test' });
    assert.equal(row(buildLookupEvidenceScope(original), 'caa', 'Inherited'), 'Yes');
    assert.equal(row(buildLookupEvidenceScope(original), 'caa', 'Effective policy owner'), 'example.test');
    Object.assign(caa, { inherited: false });
    assert.equal(row(buildLookupEvidenceScope(original), 'caa', 'Inherited'), 'No');
  });

  test('bounds certificate names with a visible omission, and omits domain-only scope for IP results', () => {
    const original = fixture();
    const tls = rec(original.availability.tls);
    Object.assign(rec(tls.certificate), { subjectAltNames: {
      dnsNames: Array.from({ length: MAX_LOOKUP_TLS_ALT_NAMES + 1 }, (_, index) => `name${index}.example.test`),
      ipAddresses: ['192.0.2.1'], truncated: false,
    } });
    const result = buildLookupEvidenceScope(original);
    assert.doesNotMatch(row(result, 'tls', 'Certificate DNS names'), /name50\./u);
    assert.equal(row(result, 'tls', 'Certificate IP addresses'), 'Not retained');
    assert.match(row(result, 'tls', 'Certificate name coverage'), /Incomplete/u);
    assert.deepEqual(buildLookupEvidenceScope({ ...original, type: 'ipv4' }), { context: [], sources: [] });
  });
});
