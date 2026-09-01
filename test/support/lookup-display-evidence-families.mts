import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLookupNetworkDisplay,
  buildLookupPageDisplay,
} from '../../frontend/src/lib/analysis/lookup-display-model.ts';

function emptyNetworkInput() {
  return {
    availability: {},
    reverseDns: {},
    reverseDnsRecords: {},
    dnsEvidence: {},
    dnsRecords: {},
    httpEvidence: {},
    httpResponse: {},
    httpSecurityHeaders: {},
    tlsEvidence: {},
    tlsCertificate: {},
    tlsSubject: {},
    tlsIssuer: {},
    tlsAltNames: {},
    tlsPublicKey: {},
    tlsCipher: {},
    tlsAuthorization: {},
    tlsHostname: {},
    tlsValidity: {},
    tlsDiagnostics: {},
  };
}

function emptyPageInput() {
  return {
    pageIdentity: {},
    pageCanonical: {},
    pageMetaRefresh: {},
    pageOpenGraph: {},
    pageOpenGraphUrl: {},
    pageForms: {},
    pageResources: {},
    pageResourceTypes: {},
    pageDownloads: {},
    pageFingerprints: {},
    credentialSurfaceProfile: {},
    structuredDataIdentity: {},
    technologyProfile: {},
    browserLibraryProfile: {},
    pageRoleProfile: {},
    clientBehaviorProfile: {},
    observedNetworkContext: {},
    observedNetworkEndpoint: {},
    observedNetwork: {},
    securityPosture: {},
    securityPostureSummary: {},
    pageComparison: null,
  };
}

test('keeps the decomposed display contracts and property order stable', () => {
  assert.deepEqual(Object.keys(buildLookupNetworkDisplay(emptyNetworkInput())), [
    'dnsRows',
    'dnsDelegation',
    'dnsQueryFailures',
    'reverseDnsRows',
    'reverseDnsFailure',
    'httpRows',
    'httpRedirects',
    'httpAttempts',
    'httpMetadata',
    'httpDeliveryMetadata',
    'tlsRows',
    'tlsFindings',
    'leafCertificate',
    'alternativeNames',
    'tlsChain',
    'tlsValidation',
  ]);
  assert.deepEqual(Object.keys(buildLookupPageDisplay(emptyPageInput())), [
    'pagePublicationMetadata',
    'pageIdentityFacts',
    'resourceSummary',
    'downloadSummary',
    'trackingIdentifiers',
    'fingerprints',
    'credentialSurface',
    'credentialSurfaceLimitations',
    'structuredIdentities',
    'structuredIdentityLimitations',
    'technologyFindings',
    'technologyLimitations',
    'pageRoles',
    'primaryPageRole',
    'pageRoleLimitations',
    'clientScriptSummary',
    'clientBehaviorIndicators',
    'clientBehaviorLimitations',
    'browserLibraries',
    'browserLibraryLimitations',
    'observedNetworkSourceLabel',
    'observedNetworkRows',
    'observedNetworkLimitations',
    'securityPostureSummary',
    'securityPostureFindings',
    'securityPostureLimitations',
    'pageComparison',
  ]);
});

test('projects complete bounded DNS families and delegation evidence', () => {
  const display = buildLookupNetworkDisplay({
    ...emptyNetworkInput(),
    availability: { dnssec: 'signed' },
    reverseDns: { status: 'success', diagnostics: { ptr: { status: 'success' } } },
    reverseDnsRecords: { ptr: ['mail.example.test'] },
    dnsEvidence: {
      status: 'success',
      diagnostics: {
        a: { status: 'success' },
        aaaa: { status: 'not_found' },
        cname: { status: 'not_found' },
        ns: { status: 'success' },
        mx: { status: 'success' },
        spf: { status: 'success' },
        dmarc: { status: 'success' },
        caa: { status: 'success' },
        soa: { status: 'success' },
        https: { status: 'success' },
      },
      caaPolicy: {
        policyVersion: 1,
        status: 'success',
        effectiveOwner: 'example.test',
        inherited: false,
        records: [{ critical: 0, tag: 'issue', value: 'ca.example.test' }],
      },
      delegation: {
        delegationHealthVersion: 1,
        status: 'healthy',
        complete: true,
        detail: 'Delegation observations agree.',
        parent: { nameservers: ['ns1.example.test'] },
        registry: { nameservers: ['ns1.example.test'] },
        findings: [{
          id: 'delegation-aligned',
          label: 'Delegation aligned',
          state: 'healthy',
          summary: 'Parent and registry records agree.',
          detail: 'The bounded observations matched.',
          remediation: '',
        }],
        authorities: [{
          nameserver: 'ns1.example.test',
          state: 'success',
          addressSource: 'registry_glue',
          addresses: ['192.0.2.53'],
          nameservers: ['ns1.example.test'],
          soaPrimary: 'ns1.example.test',
          soa: {
            nsname: 'ns1.example.test',
            hostmaster: 'hostmaster.example.test',
            serial: 1,
            refresh: 2,
            retry: 3,
            expire: 4,
            minttl: 5,
          },
        }],
        recordMatrix: [{
          type: 'A',
          state: 'aligned',
          observations: [{
            nameserver: 'ns1.example.test',
            state: 'success',
            values: ['192.0.2.10'],
            discarded: 0,
          }],
        }],
        limitations: ['One bounded observation set.'],
      },
    },
    dnsRecords: {
      a: ['192.0.2.10'],
      aaaa: [],
      cname: [],
      ns: ['ns1.example.test'],
      mx: [{ priority: 10, exchange: 'mail.example.test' }],
      spf: ['v=spf1 -all'],
      dmarc: ['v=DMARC1; p=reject'],
      caa: [{ critical: 0, tag: 'issue', value: 'ca.example.test' }],
      soa: [{
        nsname: 'ns1.example.test',
        hostmaster: 'hostmaster.example.test',
        serial: 1,
        refresh: 2,
        retry: 3,
        expire: 4,
        minttl: 5,
      }],
      https: [{
        mode: 'service',
        priority: 1,
        target: 'edge.example.test',
        ttl: 300,
        compatible: true,
        parameters: {
          alpn: ['h2', 'h3'],
          port: 443,
          ipv4hint: ['192.0.2.10'],
          ipv6hint: ['2001:db8::10'],
          opaque: [{ key: 9, name: 'private-use' }],
        },
      }],
    },
  });

  assert.equal(display.reverseDnsRows[0]?.value, 'mail.example.test');
  assert.equal(display.dnsRows.find((row) => row.label === 'MX')?.value, '10 mail.example.test');
  assert.match(display.dnsRows.find((row) => row.label === 'SOA')?.value ?? '', /serial 1/u);
  assert.match(display.dnsRows.find((row) => row.label === 'HTTPS service binding')?.value ?? '', /ALPN h2, h3 · port 443/u);
  assert.equal(display.dnsRows.find((row) => row.label === 'Effective CAA owner')?.value, 'example.test · exact hostname');
  assert.equal(display.dnsDelegation?.authorities[0]?.addressSource, 'Registry glue');
  assert.equal(display.dnsDelegation?.authorities[0]?.soa?.minttl, 5);
  assert.equal(display.dnsQueryFailures, '');
});

test('projects bounded HTTP and certificate metadata without retaining raw material', () => {
  const display = buildLookupNetworkDisplay({
    ...emptyNetworkInput(),
    httpEvidence: {
      requestUrl: 'https://example.test/',
      finalUrl: 'https://www.example.test/',
      transportSecurity: 'https',
      redirectCount: 1,
      redirects: [{ status: 301, from: 'https://example.test/', to: 'https://www.example.test/' }],
      attempts: [{ url: 'https://example.test/', httpStatus: 301 }],
    },
    httpResponse: {
      status: 200,
      contentType: 'text/html',
      capturedBodyBytes: 512,
      declaredContentLength: 1024,
      server: 'fixture-server',
      contentLanguage: 'en',
      bodyHash: { value: 'a'.repeat(64), scope: 'captured-prefix', bytes: 512 },
    },
    httpSecurityHeaders: {
      strictTransportSecurity: 'observed',
      contentSecurityPolicy: 'not observed',
    },
    tlsEvidence: {
      connectedAddress: '192.0.2.10',
      sniHost: 'example.test',
      protocol: 'TLSv1.3',
      alpnProtocol: 'h2',
      findings: [{ label: 'Certificate reviewed', detail: 'Bounded metadata retained.', tone: 'neutral' }],
      chain: [
        { subject: { commonNames: ['example.test'] }, fingerprintSha256: 'b'.repeat(64) },
        { subject: { organizations: ['Example issuer'] }, fingerprintSha256: 'c'.repeat(64) },
      ],
    },
    tlsCertificate: {
      fingerprintSha256: 'b'.repeat(64),
      serialNumber: '01',
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2027-01-01T00:00:00.000Z',
      signature: { algorithm: 'sha256WithRSAEncryption', oid: '1.2.840.113549.1.1.11' },
      extendedKeyUsage: {
        values: [{ name: 'TLS Web Server Authentication', oid: '1.3.6.1.5.5.7.3.1' }],
        truncated: true,
      },
      authorityInformationAccess: {
        ocsp: { total: 1, https: 1, http: 0, other: 0 },
        caIssuers: { total: 1, https: 0, http: 1, other: 0 },
        unknownMethods: 1,
        truncated: true,
      },
      extensionProfile: {
        certificatePolicies: { oids: ['2.23.140.1.2.1'], truncated: false },
        crlDistributionPoints: { total: 1, https: 1, http: 0, ldap: 0, other: 0 },
      },
    },
    tlsSubject: { commonNames: ['example.test'], organizations: ['Example organisation'] },
    tlsIssuer: { commonNames: ['Example issuer'] },
    tlsAltNames: {
      dnsNames: ['example.test', 'www.example.test'],
      ipAddresses: ['192.0.2.10'],
      classes: { dns: 2, ip: 1, uri: 1 },
      truncated: true,
    },
    tlsPublicKey: { type: 'RSA', bits: 2048, fingerprintSha256: 'd'.repeat(64) },
    tlsCipher: { standardName: 'TLS_AES_128_GCM_SHA256' },
    tlsAuthorization: { authorized: true, error: 'verification detail' },
    tlsHostname: { matches: true, error: 'hostname detail' },
    tlsValidity: { status: 'valid' },
    tlsDiagnostics: { error: 'collection detail' },
  });

  assert.equal(display.httpAttempts.length, 0);
  assert.equal(display.httpRedirects[0]?.status, '301');
  assert.equal(display.httpMetadata.find((row) => row.label === 'Declared length')?.value, '1.0 KiB');
  assert.match(display.httpMetadata.find((row) => row.label === 'Hash scope')?.value ?? '', /Captured prefix/u);
  assert.equal(display.tlsRows.find((row) => row.label === 'Chain trust')?.value, 'Authorised');
  assert.equal(display.tlsRows.find((row) => row.label === 'Validity')?.value, 'Valid now');
  assert.equal(display.alternativeNames.length, 3);
  assert.equal(display.tlsChain.length, 2);
  assert.match(display.leafCertificate.find((row) => row.label === 'SAN classes')?.value ?? '', /DNS 2 · IP 1 · URI 1 · truncated/u);
  assert.match(display.leafCertificate.find((row) => row.label === 'AIA presence')?.value ?? '', /Unknown methods 1/u);
  assert.equal(display.leafCertificate.find((row) => row.label === 'Certificate policies')?.value, '2.23.140.1.2.1');
  assert.equal(display.tlsValidation.length, 3);
});

test('projects page identity, profiles, network context, posture and comparison independently', () => {
  const display = buildLookupPageDisplay({
    ...emptyPageInput(),
    pageIdentity: {
      documentLanguage: 'en',
      embeddedOrigins: ['https://embed.example.test'],
      contactDomains: ['example.test'],
      trackingIdentifiers: [{ type: 'analytics-property', value: 'property-1' }],
    },
    pageCanonical: { url: 'https://example.test/' },
    pageMetaRefresh: { url: 'https://example.test/next' },
    pageOpenGraph: { title: 'Example', siteName: 'Example site' },
    pageOpenGraphUrl: { url: 'https://example.test/' },
    pageForms: { count: 1, postCount: 1, insecureActionCount: 0 },
    pageResources: { count: 5, externalOrigins: ['https://assets.example.test'] },
    pageResourceTypes: { image: 1, script: 2, stylesheet: 1 },
    pageDownloads: {
      count: 1,
      explicitCount: 1,
      riskyCount: 1,
      riskyFileTypes: ['executable'],
      externalOrigins: ['https://downloads.example.test'],
    },
    pageFingerprints: {
      exact: { value: 'exact', scope: 'complete' },
      normalizedHtml: { value: 'html', tokenCount: 10 },
      visibleText: { value: 'text', tokenCount: 8 },
      domStructure: { value: 'dom', nodeCount: 6 },
      formStructure: { value: 'form', formCount: 1, controlCount: 2 },
      resourceHosts: { value: 'hosts', values: ['assets.example.test'] },
      identifiers: { value: 'ids', values: ['property-1'] },
    },
    credentialSurfaceProfile: {
      forms: { count: 1, methods: { post: 1 }, actions: { sameOrigin: 1 } },
      inputs: { count: 2, classifiedCount: 2, categories: { email: 1, password: 1 } },
      limitations: ['Static form analysis.'],
    },
    structuredDataIdentity: {
      entities: [{
        types: ['Organization'],
        name: 'Example organisation',
        declaredOrigin: 'https://example.test',
        sameAsHosts: ['social.example.test'],
      }],
      limitations: ['Structured data is self-declared.'],
    },
    technologyProfile: {
      findings: [{
        id: 'fixture-platform',
        name: 'Fixture platform',
        category: 'hosting platform',
        confidence: 'medium',
        roles: ['origin_host'],
        evidence: [{ source: 'header', role: 'origin_host', description: 'Fixture header observed.' }],
      }],
      limitations: ['Static indicators only.'],
    },
    pageRoleProfile: {
      primaryRole: 'authentication',
      findings: [{ role: 'authentication', label: 'Authentication', confidence: 'high', evidence: ['Password input'] }],
      limitations: ['Static role classification.'],
    },
    clientBehaviorProfile: {
      scriptSummary: { elementsObserved: 2, referencedScripts: 1, inlineScripts: 1, moduleScripts: 0 },
      indicators: [{
        id: 'storage',
        label: 'Storage access',
        evidenceClass: 'inline_script',
        occurrences: 1,
        explanation: 'Static token observed.',
      }],
      limitations: ['Scripts were not executed.'],
    },
    browserLibraryProfile: {
      findings: [{
        id: 'fixture-library',
        name: 'Fixture library',
        apparentVersion: '1.0.0',
        detectionMethods: ['script_path'],
        advisoryCount: 1,
        highestSeverity: 'medium',
        advisoryIdentifiers: ['ADV-1'],
        knownExploitedIdentifiers: [],
        knownExploitedCount: 0,
        weaknessClasses: ['input-handling'],
      }],
      limitations: ['Version is apparent.'],
    },
    observedNetworkContext: { limitations: ['One selected address.'] },
    observedNetworkEndpoint: { selectedFrom: 'tls_connection' },
    observedNetwork: {
      name: 'Example network',
      holder: 'Example holder',
      handle: 'NET-EXAMPLE',
      cidrs: ['192.0.2.0/24'],
      startAddress: '192.0.2.0',
      endAddress: '192.0.2.255',
      country: 'ZZ',
      networkType: 'DIRECT ALLOCATION',
      databaseUpdatedAt: '2026-01-01T00:00:00.000Z',
    },
    securityPosture: {
      findings: [{
        id: 'hsts',
        category: 'transport',
        state: 'observed',
        tone: 'configured',
        label: 'HSTS observed',
        detail: 'A bounded header signal was observed.',
        evidence: ['Strict-Transport-Security'],
      }],
      limitations: ['Header observation only.'],
    },
    securityPostureSummary: { observed: 1, potentialExposure: 0, observedAbsence: 0, unavailable: 0 },
    pageComparison: {
      partial: false,
      reference: { domain: 'reference.example.test', observedAt: '2026-01-01T00:00:00.000Z' },
      components: [{
        label: 'Visible text',
        method: 'simhash',
        outcome: 'overlap',
        detail: 'High overlap.',
        status: 'similar',
        sharedValues: [],
      }],
    },
  });

  assert.equal(display.fingerprints.length, 7);
  assert.equal(display.credentialSurface.categories.password, 1);
  assert.equal(display.structuredIdentities[0]?.name, 'Example organisation');
  assert.deepEqual(display.technologyFindings[0]?.roles, ['application_platform']);
  assert.equal(display.primaryPageRole, 'Authentication');
  assert.equal(display.browserLibraries[0]?.advisoryCount, 1);
  assert.equal(display.observedNetworkSourceLabel, 'TLS connection');
  assert.equal(display.observedNetworkRows.find((row) => row.label === 'CIDR ranges')?.value, '192.0.2.0/24');
  assert.equal(display.securityPostureFindings[0]?.state, 'observed');
  assert.equal(display.pageComparison?.referenceDomain, 'reference.example.test');
  assert.equal(display.pageComparison?.components[0]?.method, 'simhash');
});
