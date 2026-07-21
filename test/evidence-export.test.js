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
        handle: 'REGISTRY-OBJECT',
        registrar: { name: 'Example Registrar' },
        registrarIanaId: '999',
        nameservers: ['NS1.EXAMPLE'],
        lifecycle: {
          createdDate: '2020-01-01T00:00:00Z',
          expiryDate: '2030-01-01T00:00:00Z',
        },
        dnssec: 'signed',
        statuses: ['clientTransferProhibited'],
        linksTruncated: true,
        noticesTruncated: false,
        events: [{ action: 'registration', date: '2020-01-01T00:00:00Z' }],
      },
      data: { objectClassName: 'domain', ldhName: 'EXAMPLE.COM' },
      registrarRdap: {
        status: 'success', endpoint: 'https://registrar.example/domain/example.com',
        data: { ldhName: 'EXAMPLE.COM', privateTestValue: 'not part of the structured export' },
        parsed: {
          domain: 'EXAMPLE.COM', handle: 'REGISTRAR-OBJECT',
          registrar: { name: 'EXAMPLE REGISTRAR' }, registrarIanaId: '999',
          lifecycle: { createdDate: '2020-01-01', expiryDate: '2031-01-01' },
          dnssec: 'secure', statuses: ['client transfer prohibited'], nameservers: ['ns1.example.'],
          entitiesByRole: { abuse: [{ email: 'private-nested@example.test' }] },
        },
      },
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
    availability: {
      applicable: true,
      domain: 'example.com',
      state: 'registered',
      hasMx: true,
      http: {
        version: 1,
        status: 'success',
        source: 'http',
        observedAt: '2026-07-11T01:02:05.000Z',
        finalUrl: 'https://example.com/',
        redirectCount: 0,
        response: {
          status: 200,
          contentType: 'text/html',
          bodyHash: {
            algorithm: 'sha256',
            value: 'a'.repeat(64),
            scope: 'complete-body',
            bytes: 22,
          },
        },
      },
      tls: {
        version: 1,
        profileVersion: 1,
        status: 'success',
        observedAt: '2026-07-11T01:02:05.000Z',
        scanMode: 'deep',
        source: 'tls',
        complete: true,
        truncated: false,
        connectedAddress: '93.184.216.34',
        sniHost: 'example.com',
        protocol: 'TLSv1.3',
        cipher: { standardName: 'TLS_AES_256_GCM_SHA384' },
        authorization: { authorized: true, error: null },
        hostname: { matches: true, error: null },
        validity: { status: 'valid' },
        certificate: { fingerprintSha256: '2'.repeat(64) },
        chain: [],
        findings: [],
      },
      pageIdentity: {
        identityVersion: 3,
        version: 1,
        status: 'success',
        observedAt: '2026-07-11T01:02:05.000Z',
        scanMode: 'deep',
        source: 'html',
        complete: true,
        truncated: false,
        limitations: ['Static HTML metadata only; JavaScript-rendered changes are not evaluated.'],
        diagnostics: { tagsExamined: 4, discardedUrls: 0, formsObserved: 1 },
        documentLanguage: 'en',
        canonical: { url: 'https://example.com/', queryOmitted: true, pathTruncated: false },
        metaRefresh: null,
        openGraph: { title: 'Example', siteName: 'Example site', url: null },
        generator: null,
        forms: { count: 1, postCount: 1, insecureActionCount: 0, externalActionOrigins: [], truncated: false },
        resources: { count: 2, byType: { image: 1, script: 1, stylesheet: 0, link: 0, frame: 0, media: 0, object: 0 }, externalOrigins: ['https://cdn.example'], truncated: false },
        embeddedOrigins: [],
        contactDomains: ['example.com'],
        downloads: { count: 0, explicitCount: 0, riskyCount: 0, externalOrigins: [], riskyFileTypes: [], truncated: false },
        trackingIdentifiers: [{ type: 'tag-container', value: 'GTM-AB12' }],
        fingerprints: {
          fingerprintVersion: 1,
          exact: { algorithm: 'sha256', value: 'a'.repeat(64), scope: 'complete-body', bytes: 22, source: 'captured-response-bytes' },
          normalizedHtml: { algorithm: 'sha256', value: 'b'.repeat(64), tokenCount: 12, truncated: false },
          visibleText: { algorithm: 'simhash64-v1', value: 'c'.repeat(16), tokenCount: 4, featureCount: 2, truncated: false },
          domStructure: { algorithm: 'sha256', value: 'd'.repeat(64), nodeCount: 8, parser: 'static-tag-sequence-v1', truncated: false },
          formStructure: { algorithm: 'sha256', value: 'e'.repeat(64), formCount: 1, controlCount: 2, truncated: false },
          resourceHosts: { algorithm: 'set-sha256', value: 'f'.repeat(64), values: ['cdn.example'], truncated: false },
          identifiers: { algorithm: 'set-sha256', value: '1'.repeat(64), values: [{ type: 'tag-container', value: 'GTM-AB12' }], truncated: false },
          complete: true, truncated: false, limitations: [],
        },
      },
      technologyProfile: {
        profileVersion: 1, version: 1, status: 'success', observedAt: '2026-07-11T01:02:05.000Z',
        scanMode: 'deep', source: 'derived', complete: true, truncated: false,
        limitations: ['Curated signature matching is selective.'], diagnostics: { findings: 1 },
        findings: [{
          id: 'fixture-framework', name: 'Fixture Framework', category: 'web framework', confidence: 'high',
          evidence: [{ source: 'static HTML', description: 'Static markup contains a fixture framework marker.' }],
        }],
      },
      securityPosture: {
        postureVersion: 1, version: 1, status: 'partial', observedAt: '2026-07-11T01:02:05.000Z',
        scanMode: 'deep', source: 'derived', complete: false, truncated: false,
        limitations: ['Passive point-in-time interpretation.'],
        summary: { observed: 1, potentialExposure: 1, observedAbsence: 0, unavailable: 0 },
        findings: [{
          id: 'fixture-header', category: 'response headers', state: 'observed_absence', tone: 'review',
          label: 'Fixture header not observed', detail: 'The selected response did not include the fixture header.',
          evidence: ['Selected HTTP response headers'],
        }],
      },
    },
    diagnostics: {
      version: 4,
      rdap: {
        status: 'success', errorCode: null, attempts: [],
        registrar: { status: 'success', endpoint: 'https://registrar.example/domain/example.com' },
      },
      whois: { status: 'complete', errorCode: null },
      availability: { status: 'complete', errorCode: null, resultState: 'registered' },
    },
  };
}

describe('lookup evidence export', () => {
  test('packages query context, raw sources, analysis, and provenance', () => {
    const response = fixtureResponse();
    response.threatIntelligence = {
      version: 1,
      providers: [{ provider: { id: 'fixture_provider' }, findings: [{ detail: 'provider-only-secret' }] }],
    };
    const result = evidence.buildLookupEvidence(response, { generatedAt: '2026-07-11T02:00:00.000Z' });

    assert.equal(result.schema, 'whoisleuth.lookup-evidence');
    assert.equal(result.schemaVersion, 14);
    assert.equal(result.query.submitted, 'login.example.com');
    assert.equal(result.query.registrableDomain, 'example.com');
    assert.equal(result.diagnostics.rdap.status, 'success');
    assert.equal(result.diagnostics.rdap.registrar.status, 'success');
    assert.equal(result.sources.rdap.endpoint, 'https://rdap.example/domain/example.com');
    assert.equal(result.sources.rdap.transportSecurity, 'https');
    assert.equal(result.sources.rdap.raw.ldhName, 'EXAMPLE.COM');
    assert.equal(result.sources.rdap.parsed.linksTruncated, true);
    assert.equal(result.sources.rdap.parsed.noticesTruncated, false);
    assert.equal(result.sources.rdap.attempts[0].outcome, 'success');
    assert.equal(Object.hasOwn(result.sources.rdap, 'registrarRdap'), false);
    assert.equal(JSON.stringify(result.sources).includes('privateTestValue'), false);
    assert.equal(JSON.stringify(result).includes('provider-only-secret'), false);
    assert.equal(result.sources.whois.chain[1].response, 'Domain Name: EXAMPLE.COM');
    assert.equal(result.sources.whois.authoritativeHop, 'whois.registry.example');
    assert.equal(result.analysis.availability.hasMx, true);
    assert.equal(result.analysis.availability.http.response.status, 200);
    assert.equal(result.analysis.availability.http.response.bodyHash.value, 'a'.repeat(64));
    assert.equal(result.analysis.availability.http.response.bodyHash.scope, 'complete-body');
    assert.equal(result.analysis.availability.tls.connectedAddress, '93.184.216.34');
    assert.equal(result.analysis.availability.tls.certificate.fingerprintSha256, '2'.repeat(64));
    assert.equal(result.analysis.availability.pageIdentity.identityVersion, 3);
    assert.equal(result.analysis.availability.pageIdentity.canonical.url, 'https://example.com/');
    assert.equal(result.analysis.availability.pageIdentity.forms.postCount, 1);
    assert.deepEqual(result.analysis.availability.pageIdentity.resources.externalOrigins, ['https://cdn.example']);
    assert.deepEqual(result.analysis.availability.pageIdentity.contactDomains, ['example.com']);
    assert.equal(result.analysis.availability.pageIdentity.trackingIdentifiers[0].value, 'GTM-AB12');
    assert.equal(result.analysis.availability.pageIdentity.fingerprints.fingerprintVersion, 1);
    assert.equal(result.analysis.availability.pageIdentity.fingerprints.exact.value, 'a'.repeat(64));
    assert.equal(result.analysis.availability.pageIdentity.fingerprints.visibleText.value, 'c'.repeat(16));
    assert.deepEqual(result.analysis.availability.pageIdentity.fingerprints.resourceHosts.values, ['cdn.example']);
    assert.equal(result.analysis.availability.technologyProfile.profileVersion, 1);
    assert.equal(result.analysis.availability.technologyProfile.findings[0].name, 'Fixture Framework');
    assert.equal(result.analysis.availability.securityPosture.postureVersion, 1);
    assert.equal(result.analysis.availability.securityPosture.findings[0].state, 'observed_absence');
    assert.equal(result.analysis.idn, null);
    assert.equal(result.analysis.registryComparison.counts.conflict, 0);
    assert.equal(result.analysis.registrarPublicationComparison.counts.conflict, 1);
    assert.equal(result.analysis.registrarPublicationComparison.counts.equivalent, 7);
    assert.equal(result.analysis.registrarPublicationComparison.sourceHealth.registry.status, 'success');
    assert.equal(result.analysis.registrarPublicationComparison.sourceHealth.registrar.status, 'success');
    const expiry = result.analysis.registrarPublicationComparison.fields.find((field) => field.label === 'Expires');
    assert.equal(expiry.registryDisplay, '2030-01-01T00:00:00Z');
    assert.equal(expiry.registrarDisplay, '2031-01-01');
    assert.equal(result.analysis.registrarPublicationComparison.fields.some((field) => field.label === 'Registry object ID'), false);
    assert.equal(JSON.stringify(result).includes('REGISTRAR-OBJECT'), false);
    assert.equal(JSON.stringify(result).includes('private-nested@example.test'), false);
    assert.equal(result.generatedAt, '2026-07-11T02:00:00.000Z');
  });

  test('retains an explicitly supplied bounded IDN analysis without reading browser state', () => {
    const result = evidence.buildLookupEvidence(fixtureResponse(), {
      idnAnalysis: {
        version: 1,
        mappingVersion: 'tr39-curated-ascii-v1',
        asciiDomain: 'xn--example.test',
        unicodeDomain: 'éxample.test',
        mixedScript: false,
        referenceMatches: [],
      },
    });

    assert.equal(result.schemaVersion, 14);
    assert.equal(result.analysis.idn.version, 1);
    assert.equal(result.analysis.idn.unicodeDomain, 'éxample.test');
  });

  test('retains bounded DNS provenance already present in the availability assessment', () => {
    const response = fixtureResponse();
    response.availability.dns = {
      version: 1, status: 'partial', source: 'dns', complete: false, truncated: false,
      records: { a: ['192.0.2.1'], caa: [{ critical: 0, tag: 'issue', value: 'ca.example' }] },
      diagnostics: { a: { status: 'success' }, caa: { status: 'error', error: 'resolver timed out' } },
    };
    const result = evidence.buildLookupEvidence(response);
    assert.deepEqual(result.analysis.availability.dns.records.a, ['192.0.2.1']);
    assert.equal(result.analysis.availability.dns.version, 1);
    assert.equal(result.analysis.availability.dns.diagnostics.caa.status, 'error');
  });

  test('retains partial source failures without failing the export', () => {
    const response = fixtureResponse();
    response.rdap = { error: 'RDAP timed out', attempts: [{ outcome: 'timeout' }] };
    response.whois.parsed.chainStatus = 'partial';
    response.whois.parsed.failedHop = 'whois.registrar.example';
    response.diagnostics.rdap.status = 'error';
    response.diagnostics.whois.status = 'partial';
    const result = evidence.buildLookupEvidence(response);

    assert.deepEqual(result.sources.rdap, {
      status: 'error', error: 'RDAP timed out', attempts: [{ outcome: 'timeout' }],
    });
    assert.equal(result.sources.whois.status, 'partial');
    assert.equal(result.sources.whois.failedHop, 'whois.registrar.example');
    assert.equal(result.analysis.registryComparison.counts.rdap_unavailable, 4);
    assert.equal(result.analysis.registryComparison.counts.whois_only, 0);
    assert.equal(result.analysis.registryComparison.sourceHealth.rdap.condition, 'unavailable');
    assert.equal(result.analysis.registryComparison.sourceHealth.whois.condition, 'incomplete');
  });

  test('keeps an unavailable registrar publication neutral instead of inventing a discrepancy', () => {
    const response = fixtureResponse();
    response.rdap.registrarRdap = {
      status: 'unsupported',
      detail: 'The registry did not publish an eligible registrar RDAP link.',
    };
    response.diagnostics.rdap.registrar = { status: 'unsupported' };
    const result = evidence.buildLookupEvidence(response);

    assert.equal(result.analysis.registrarPublicationComparison.counts.conflict, 0);
    assert.equal(result.analysis.registrarPublicationComparison.counts.registry_only, 0);
    assert.ok(result.analysis.registrarPublicationComparison.counts.registrar_unavailable > 0);
    assert.equal(result.analysis.registrarPublicationComparison.sourceHealth.registrar.condition, 'unavailable');
  });

  test('uses null when no registrar publication follow-up was represented', () => {
    const response = fixtureResponse();
    delete response.rdap.registrarRdap;
    delete response.diagnostics.rdap.registrar;
    const result = evidence.buildLookupEvidence(response);
    assert.equal(result.analysis.registrarPublicationComparison, null);
  });

  test('creates a bounded, filesystem-safe filename', () => {
    const filename = evidence.evidenceFilename(
      { registrableDomain: 'Bücher.Example/path' },
      Date.parse('2026-07-11T02:03:04.000Z')
    );
    assert.equal(filename, 'whoisleuth-evidence-b-cher.example-path-2026-07-11T02-03-04-000Z.json');
  });
});
