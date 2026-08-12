import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLookupLifecycleDates,
  buildLookupNetworkDisplay,
  buildLookupPageDisplay,
  buildLookupRegistryDisplay,
} from '../frontend/src/lib/analysis/lookup-display-model.ts';
import {
  MAX_LOOKUP_DISPLAY_ARRAY_ITEMS,
  MAX_LOOKUP_DISPLAY_RECORDS,
  MAX_LOOKUP_DISPLAY_STRING_ITEMS,
  MAX_LOOKUP_DISPLAY_TEXT_LENGTH,
  records,
  show,
  stringList,
} from '../frontend/src/lib/analysis/lookup-display-shared.ts';

test('keeps generic Lookup display fallbacks bounded and makes joined-value omission visible', () => {
  const recordValues = Array.from({ length: MAX_LOOKUP_DISPLAY_RECORDS + 25 }, (_, index) => ({ index }));
  assert.equal(records(recordValues).length, MAX_LOOKUP_DISPLAY_RECORDS);

  const strings = Array.from({ length: MAX_LOOKUP_DISPLAY_STRING_ITEMS + 25 }, (_, index) => `value-${index}\u0000`);
  const projected = stringList(strings);
  assert.equal(projected.length, MAX_LOOKUP_DISPLAY_STRING_ITEMS);
  assert.ok(projected.every((value) => value.length <= 1_024 && !/[\u0000-\u001f\u007f]/u.test(value)));

  const displayed = show(Array.from({ length: MAX_LOOKUP_DISPLAY_ARRAY_ITEMS + 6 }, (_, index) => `value-${index}`));
  assert.match(displayed, /… \(\+6 more\)$/u);
  assert.ok(displayed.length <= MAX_LOOKUP_DISPLAY_TEXT_LENGTH);
  assert.equal(show('x'.repeat(MAX_LOOKUP_DISPLAY_TEXT_LENGTH + 20)).length, MAX_LOOKUP_DISPLAY_TEXT_LENGTH);
  assert.deepEqual(stringList([Array.from({ length: 500 }, () => 'nested')]), []);
  assert.match(show(Array.from({ length: 500 }, () => 'nested')), /… \(\+436 more\)$/u);

  const cyclic: Record<string, unknown> = {};
  cyclic.name = cyclic;
  assert.equal(show(cyclic), '…');
});

test('selects separately sourced lifecycle dates without treating missing values as dates', () => {
  const dates = buildLookupLifecycleDates({
    availability: { createdDate: '2025-01-02T03:04:05.000Z' },
    rdapParsed: {
      events: [
        { action: 'expiration', date: '2027-01-02T03:04:05.000Z' },
        { action: 'last changed', date: '2026-01-02T03:04:05.000Z' },
      ],
      lifecycle: {},
    },
    whoisParsed: { lifecycle: {} },
  });

  assert.deepEqual(dates, {
    created: '2025-01-02T03:04:05.000Z',
    expires: '2027-01-02T03:04:05.000Z',
    updated: '2026-01-02T03:04:05.000Z',
  });
});

test('bounds page, technology, and posture presentation models', () => {
  const page = buildLookupPageDisplay({
    pageIdentity: {
      documentLanguage: 'en',
      trackingIdentifiers: [{ type: 'tag-container', value: 'container-1' }],
      limitations: ['partial body'],
    },
    pageCanonical: {},
    pageMetaRefresh: {},
    pageOpenGraph: {},
    pageOpenGraphUrl: {},
    pageForms: {
      count: 2,
      postCount: 1,
      insecureActionCount: 1,
    },
    pageResources: { count: 3, externalOrigins: ['https://assets.example.test'] },
    pageResourceTypes: { script: 2 },
    pageDownloads: { count: 0, riskyCount: 0 },
    pageFingerprints: {
      normalizedHtml: { value: 'hash-1', tokenCount: 8 },
    },
    credentialSurfaceProfile: {
      forms: { count: 999, methods: {}, actions: {} },
      inputs: { count: 999, classifiedCount: 999, categories: {} },
      limitations: ['bounded'],
    },
    structuredDataIdentity: {
      entities: [{ types: ['Organization'], name: 'Example entity' }],
    },
    technologyProfile: {
      findings: Array.from({ length: 30 }, (_, index) => ({
        id: `indicator-${index}`,
        name: `Indicator ${index}`,
        category: 'platform',
        confidence: 'medium',
        evidence: [{ source: 'html', description: 'Observed signature.' }],
      })),
      limitations: ['static response only'],
    },
    pageRoleProfile: {
      findings: [{
        role: 'authentication',
        label: 'Authentication',
        confidence: 'high',
        evidence: ['Password-purpose input observed'],
      }],
      limitations: ['Static role limitation.'],
    },
    clientBehaviorProfile: {
      scriptSummary: {
        elementsObserved: 3,
        referencedScripts: 2,
        inlineScripts: 1,
        moduleScripts: 1,
      },
      indicators: [{
        id: 'browser_storage',
        label: 'Browser storage access',
        evidenceClass: 'inline_script',
        occurrences: 2,
        explanation: 'Inline script references a browser-local storage API.',
      }],
      limitations: ['Static behaviour limitation.'],
    },
    browserLibraryProfile: { findings: [] },
    observedNetworkContext: {},
    observedNetworkEndpoint: { selectedFrom: 'dns_a' },
    observedNetwork: { name: 'Example network' },
    securityPosture: {
      findings: Array.from({ length: 32 }, (_, index) => ({
        id: `header-${index}`,
        state: index === 0 ? 'unexpected' : 'observed',
        tone: index === 0 ? 'unexpected' : 'configured',
      })),
    },
    securityPostureSummary: { observed: 999, unavailable: 2 },
    pageComparison: null,
  });

  assert.equal(page.technologyFindings.length, 24);
  assert.equal(page.pageRoles[0]?.role, 'authentication');
  assert.equal(page.clientBehaviorIndicators[0]?.id, 'browser_storage');
  assert.equal(page.clientScriptSummary.moduleScripts, 1);
  assert.equal(page.credentialSurface.formCount, 50);
  assert.equal(page.credentialSurface.inputCount, 500);
  assert.equal(page.securityPostureSummary.observed, 32);
  assert.equal(page.securityPostureFindings.length, 32);
  assert.equal(page.securityPostureFindings[0]?.state, 'unavailable');
  assert.equal(page.securityPostureFindings[0]?.tone, 'neutral');
  assert.equal(page.observedNetworkSourceLabel, 'DNS A fallback');
  assert.equal(page.fingerprints[0]?.value, 'hash-1');
});

test('keeps DNS, HTTP, and TLS display states explicit and bounded', () => {
  const network = buildLookupNetworkDisplay({
    availability: { dnssec: 'signed' },
    reverseDns: { diagnostics: { ptr: { status: 'error', error: 'lookup failed' } } },
    reverseDnsRecords: {},
    dnsEvidence: {
      status: 'partial',
      diagnostics: { https: { status: 'success' }, mx: { status: 'error', error: 'timeout' } },
      delegation: {
        delegationHealthVersion: 1,
        status: 'partial',
        complete: false,
        parent: { nameservers: [] },
        registry: { nameservers: [] },
        recordMatrix: [{
          type: 'TXT',
          state: 'partial',
          observations: [{
            nameserver: 'ns1.example.test',
            state: 'partial',
            values: ['x'.repeat(600), '\u0000bounded'],
            error: null,
            truncated: true,
            discarded: 3,
          }],
        }],
      },
    },
    dnsRecords: {
      https: [
        {
          mode: 'service',
          priority: 1,
          target: 'edge.example.test',
          parameters: { alpn: ['h2'], port: 443 },
          ttl: 300,
        },
      ],
    },
    httpEvidence: {
      transportSecurity: 'https',
      finalUrl: 'https://example.test/',
      attempts: [{ url: 'https://example.test/', error: 'timeout' }],
    },
    httpResponse: { status: 200, capturedBodyBytes: 2048 },
    httpSecurityHeaders: { strictTransportSecurity: 'observed' },
    tlsEvidence: {
      source: 'tls',
      findings: [{ label: 'Chain', detail: 'Review required', tone: 'warn' }],
      chain: [],
    },
    tlsCertificate: {},
    tlsSubject: {},
    tlsIssuer: {},
    tlsAltNames: {},
    tlsPublicKey: {},
    tlsCipher: {},
    tlsAuthorization: { authorized: false },
    tlsHostname: { matches: false },
    tlsValidity: { status: 'expired' },
    tlsDiagnostics: {},
  });

  assert.match(
    network.dnsRows.find((row) => row.label === 'HTTPS service binding')?.value || '',
    /Service priority 1/u,
  );
  assert.match(network.dnsQueryFailures, /MX: timeout/u);
  assert.equal(network.reverseDnsFailure, 'lookup failed');
  assert.equal(network.httpRows.find((row) => row.label === 'Body captured')?.value, '2.0 KiB');
  assert.equal(network.httpMetadata[0]?.value, 'Observed');
  assert.equal(network.tlsRows.find((row) => row.label === 'Chain trust')?.danger, true);
  assert.equal(network.tlsRows.find((row) => row.label === 'Validity')?.value, 'Expired');
  assert.equal(network.dnsDelegation?.recordMatrix[0]?.observations[0]?.values[0]?.length, 500);
  assert.equal(network.dnsDelegation?.recordMatrix[0]?.observations[0]?.values[1], 'bounded');
  assert.equal(network.dnsDelegation?.recordMatrix[0]?.observations[0]?.truncated, true);
  assert.equal(network.dnsDelegation?.recordMatrix[0]?.observations[0]?.discarded, 3);
});

test('keeps registry comparison and source diagnostics separately attributed', () => {
  const registry = buildLookupRegistryDisplay({
    result: {
      query: 'example.test',
      type: 'domain',
      fetchedAt: '2026-01-01T00:00:00.000Z',
      rdap: {},
      whois: {},
      availability: {},
      diagnostics: {},
    },
    rdapParsed: { objectClassName: 'domain', serverTruncated: true },
    whoisParsed: { registrar: 'Example Registrar', lifecycle: {} },
    whoisContactsByRole: {
      abuse: [{ name: 'Abuse desk', emails: ['abuse@example.test'] }],
    },
    populatedWhoisRoles: ['abuse'],
    comparison: {
      fields: [
        {
          label: 'Registrar',
          status: 'conflict',
          rdapState: 'value',
          whoisState: 'value',
          rdapDisplay: 'Registry value',
          whoisDisplay: 'WHOIS value',
        },
        {
          label: 'Registry object ID',
          status: 'whois_unavailable',
          rdapState: 'value',
          whoisState: 'unavailable',
          rdapDisplay: 'REGISTRY-OBJECT',
          whoisDisplay: 'Unsupported by source',
        },
      ],
    },
    registrarRdap: {
      status: 'partial',
      endpoint: 'https://rdap.example.test',
      attempts: [{ outcome: 'timeout' }, { outcome: 'success' }],
    },
    registrarRdapParsed: {},
    registrarPublicationComparison: {
      fields: [],
      counts: {
        equivalent: 0,
        conflict: 0,
        registry_only: 0,
        registrar_only: 0,
        registry_redacted: 0,
        registrar_redacted: 0,
        registry_unavailable: 0,
        registrar_unavailable: 0,
        registry_incomplete: 0,
        registrar_incomplete: 0,
      },
    },
  });

  assert.equal(registry.comparisonRows[0]?.tone, 'danger');
  assert.equal(registry.comparisonRows[0]?.rdapState, 'value');
  assert.equal(registry.comparisonRows[0]?.whoisState, 'value');
  assert.equal(registry.comparisonRows[0]?.rdapMatrixTone, 'conflict');
  assert.equal(registry.comparisonRows[0]?.whoisMatrixTone, 'conflict');
  assert.equal(registry.comparisonRows[1]?.rdapMatrixTone, 'observed');
  assert.equal(registry.comparisonRows[1]?.whoisMatrixTone, 'unavailable');
  assert.equal(registry.whoisContactRoles[0]?.contacts[0]?.identity, 'Abuse desk');
  assert.equal(registry.registrarRdap.label, 'partial');
  assert.match(registry.diagnosticDetail({
    status: 'partial',
    attempts: [{ outcome: 'timeout' }, { outcome: 'success' }],
  }), /attempts: timeout → success/u);
  assert.match(registry.rdapPartialDetail, /some RDAP data was omitted/u);
});
