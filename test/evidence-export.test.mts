import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as evidence from '../frontend/src/lib/analysis/evidence-export.ts';
import { analyzeStructuredDataIdentity } from '../lib/structured-data-identity.mts';
import { arrayValue, recordValue, requiredValue } from './value-assertions.mts';
import {
  httpDeliveryMetadataFixture,
  pagePublicationMetadataFixture,
} from './homepage-metadata-fixtures.mts';

function fixtureResponse(): Record<string, unknown> {
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
        endpoint: 'https://rdap.example/domain/example.com?token=must-not-export#private', transportSecurity: 'https',
        status: 200, outcome: 'success', detail: 'The endpoint returned the requested RDAP object.', selected: true,
        authorization: 'Bearer must-not-export', cookie: 'session=must-not-export',
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
        dnssec: 'Signed',
        statuses: ['clientTransferProhibited'],
        linksTruncated: true,
        noticesTruncated: false,
        events: [{ action: 'registration', date: '2020-01-01T00:00:00Z' }],
        registrant: {
          name: 'Private Registrant Marker',
          email: 'private-registrant@example.test',
          phone: '+61 2 5550 0100',
          address: '1 Private Street',
        },
        entitiesByRole: {
          registrant: [{ vcardArray: ['vcard', [['fn', {}, 'text', 'Private VCard Marker']]] }],
        },
      },
      data: {
        objectClassName: 'domain',
        ldhName: 'EXAMPLE.COM',
        entities: [{ vcardArray: ['vcard', [['email', {}, 'text', 'private-raw@example.test']]] }],
      },
      registrarRdap: {
        status: 'success', endpoint: 'https://registrar.example/domain/example.com',
        data: { ldhName: 'EXAMPLE.COM', privateTestValue: 'not part of the structured export' },
        parsed: {
          domain: 'EXAMPLE.COM', handle: 'REGISTRAR-OBJECT',
          registrar: { name: 'EXAMPLE REGISTRAR' }, registrarIanaId: '999',
          lifecycle: { createdDate: '2020-01-01', expiryDate: '2031-01-01' },
          dnssec: 'Signed', statuses: ['client transfer prohibited'], nameservers: ['ns1.example.'],
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
        registrantName: 'Private WHOIS Marker',
        registrantEmail: 'private-whois@example.test',
      },
      chain: [
        { server: 'whois.iana.org', queriedAt: '2026-07-11T01:02:03.000Z', response: 'refer: whois.registry.example', cookie: 'must-not-export' },
        { server: 'whois.registry.example', queriedAt: '2026-07-11T01:02:04.000Z', response: 'Domain Name: EXAMPLE.COM', authorization: 'must-not-export' },
      ],
    },
    networkContext: {
      contextVersion: 1, version: 1, status: 'success', observedAt: '2026-07-11T01:02:06.000Z',
      scanMode: 'deep', source: 'ip_rdap', durationMs: 18, complete: true, truncated: false,
      limitations: ['The selected address can represent shared edge infrastructure.'],
      diagnostics: { requestCount: 1, addressSource: 'tls_connection', httpStatus: 200, cidrCount: 1 },
      detail: 'The selected endpoint address was mapped to its network registration.',
      endpoint: { address: '93.184.216.34', family: 4, selectedFrom: 'tls_connection' },
      rdap: {
        endpoint: 'https://network.example/ip/93.184.216.34?token=must-not-export#private', transportSecurity: 'https',
        httpStatus: 200, fetchedAt: '2026-07-11T01:02:06.000Z',
        attempts: [{ endpoint: 'https://network.example/ip/93.184.216.34?token=must-not-export', transportSecurity: 'https', status: 200, outcome: 'success', detail: null, selected: true }],
      },
      network: {
        handle: 'NET-EXAMPLE', name: 'Example edge network', holder: 'Example network holder',
        cidrs: ['93.184.216.0/24'], startAddress: '93.184.216.0', endAddress: '93.184.216.255',
        country: 'AU', networkType: 'ALLOCATED', databaseUpdatedAt: '2026-07-10T00:00:00.000Z',
        rawContacts: [{ email: 'must-not-export@example.test' }],
      },
      unknownImportedField: 'must not export',
    },
    reverseDns: {
      version: 1, status: 'success', source: 'reverse_dns',
      observedAt: '2026-07-11T01:02:06.000Z', scanMode: 'deep',
      durationMs: 8, complete: true, truncated: false,
      limitations: ['PTR names are operator-published routing context and do not prove hosting control.'],
      diagnostics: { ptr: { status: 'success', count: 1 } },
      records: { ptr: ['edge.example.test'], privateField: 'must-not-export' },
      unknownImportedField: 'must-not-export',
    },
    securityTxt: {
      securityTxtVersion: 1, version: 1, state: 'present', status: 'success',
      observedAt: '2026-07-11T01:02:07.000Z', scanMode: 'deep', source: 'security_txt',
      durationMs: 12, complete: true, truncated: false, limitations: [],
      detail: 'A current security disclosure file was published for this hostname.',
      requestedUrl: 'https://login.example.com/.well-known/security.txt',
      finalUrl: 'https://login.example.com/.well-known/security.txt#discarded',
      httpStatus: 200, redirectCount: 0, expiresAt: '2027-01-01T00:00:00Z',
      signed: false, canonicalMatches: true,
      contacts: ['mailto:security@example.test', 'javascript:must-not-export'],
      policies: ['https://login.example.com/security-policy'], encryption: ['openpgp4fpr:0123456789ABCDEF'],
      canonical: ['https://login.example.com/.well-known/security.txt'], preferredLanguages: ['en'],
      rawBody: 'must-not-export-security-txt-body', unknownImportedField: 'must not export',
    },
    sslbl: {
      sslblVersion: 1,
      source: 'sslbl',
      status: 'success',
      verdict: 'listed',
      complete: true,
      observedAt: '2026-07-11T01:02:08.000Z',
      fingerprintSha1: '3'.repeat(40),
      referenceUrl: `https://sslbl.abuse.ch/ssl-certificates/sha1/${'3'.repeat(40)}/?discard=yes`,
      snapshot: {
        sourceUpdatedAt: '2026-07-11T00:00:00.000Z',
        generatedAt: '2026-07-11T00:05:00.000Z',
        ageSeconds: 3600,
        entryCount: 10_000,
        digestSha256: '4'.repeat(64),
        rawReasons: ['must-not-export'],
      },
      detail: 'The observed leaf certificate appears in the local snapshot.',
      limitations: ['A match does not prove current activity.'],
      unknownImportedField: 'must-not-export',
    },
    availability: {
      applicable: true,
      domain: 'example.com',
      state: 'registered',
      registrar: { name: 'Availability Registrar Marker' },
      registrant: {
        name: 'Availability Registrant Marker',
        email: 'availability-private@example.test',
        phone: '+61 2 5550 0199',
        address: '99 Availability Street',
      },
      abuse: { email: 'availability-abuse@example.test' },
      hasMx: true,
      dns: {
        version: 1,
        status: 'success',
        source: 'dns',
        complete: true,
        truncated: false,
        records: {
          https: [{
            type: 'HTTPS',
            owner: 'example.com',
            ttl: 300,
            priority: 1,
            mode: 'service',
            target: 'example.com',
            targetIsOwner: true,
            serviceUnavailable: false,
            compatible: true,
            parametersIgnored: false,
            parameters: {
              mandatory: [1],
              alpn: ['h2'],
              noDefaultAlpn: false,
              port: null,
              ipv4hint: [],
              ipv6hint: [],
              opaque: [{ key: 5, name: 'ech', length: 24 }],
              unknownKeys: [],
              unsupportedMandatoryKeys: [],
            },
          }],
        },
        diagnostics: { https: { status: 'success', error: null, truncated: false, discarded: 0 } },
      },
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
      credentialSurfaceProfile: {
        credentialSurfaceVersion: 1, version: 1, status: 'success', observedAt: '2026-07-11T01:02:05.000Z',
        scanMode: 'deep', source: 'html', complete: true, truncated: false,
        limitations: ['Fixed semantic categories and counts only.'],
        diagnostics: { formsObserved: 1, inputsObserved: 2, classifiedInputs: 2, unclassifiedActions: 0 },
        forms: {
          count: 1,
          methods: { missing: 0, get: 0, post: 1, dialog: 0, other: 0 },
          actions: { sameOrigin: 0, external: 1, missing: 0, cleartext: 0, unclassified: 0 },
        },
        inputs: {
          count: 2,
          classifiedCount: 2,
          categories: { password: 1, email: 1, username: 0, one_time_code: 0, payment: 0 },
        },
      },
      structuredDataIdentity: {
        structuredDataVersion: 1, version: 1, status: 'success', observedAt: '2026-07-11T01:02:05.000Z',
        scanMode: 'deep', source: 'html', complete: true, truncated: false,
        limitations: ['Publisher-declared metadata does not prove identity.'],
        diagnostics: { scriptsObserved: 1, entities: 1 },
        entities: [{
          types: ['Organization'],
          name: 'Example publisher',
          declaredOrigin: 'https://example.com',
          sameAsHosts: ['social.example'],
        }],
      },
      technologyProfile: {
        profileVersion: 3, version: 1, status: 'success', observedAt: '2026-07-11T01:02:05.000Z',
        scanMode: 'deep', source: 'derived', complete: true, truncated: false,
        limitations: ['Curated signature matching is selective.'], diagnostics: { findings: 1 },
        findings: [{
          id: 'fixture-framework', name: 'Fixture Framework', category: 'web framework', confidence: 'high',
          evidence: [{ source: 'static HTML', description: 'Static markup contains a fixture framework marker.' }],
        }],
        browserLibraryProfile: {
          profileVersion: 1, version: 1, status: 'success', observedAt: '2026-07-11T01:02:05.000Z',
          scanMode: 'deep', source: 'derived', complete: true, truncated: false,
          catalog: {
            name: 'Retire.js',
            version: 'retire.js-5.4.3',
            sourceRevision: '56ea22d889656f4fbfe47b7df58d410a06ea59b7',
          },
          limitations: ['An advisory match does not prove exploitability.'],
          diagnostics: { findings: 1, advisoryMatches: 1 },
          findings: [{
            id: 'fixture-library',
            name: 'fixture-library',
            apparentVersion: '1.2.3',
            detectionMethods: ['script filename'],
            advisoryCount: 1,
            highestSeverity: 'high',
            advisoryIdentifiers: ['CVE-0000-0000'],
            weaknessClasses: ['CWE-000'],
          }],
        },
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
  test('requires explicit zones for current source provenance timestamps', () => {
    const zoneLess = evidence.projectLookupEvidenceRdapSourcePublication({
      status: 'success',
      endpoint: 'https://rdap.example.test/domain/example.test',
      httpStatus: 200,
      fetchedAt: '2026-01-15T12:00:00',
      attempts: [],
      parsed: { domain: 'EXAMPLE.TEST' },
    });
    assert.equal(zoneLess?.fetchedAt, null);

    const explicitOffset = evidence.projectLookupEvidenceRdapSourcePublication({
      status: 'success',
      endpoint: 'https://rdap.example.test/domain/example.test',
      httpStatus: 200,
      fetchedAt: '2026-01-15T12:00:00+11:00',
      attempts: [],
      parsed: { domain: 'EXAMPLE.TEST' },
    });
    assert.equal(explicitOffset?.fetchedAt, '2026-01-15T01:00:00.000Z');
  });

  test('packages query context, privacy-minimized sources, analysis, and provenance', () => {
    const response = fixtureResponse();
    const injectedDiagnostics = recordValue(response.diagnostics);
    const injectedRdapDiagnostics = recordValue(injectedDiagnostics.rdap);
    injectedRdapDiagnostics.endpoint = 'https://rdap.example/domain/example.com?token=must-not-export#private';
    injectedRdapDiagnostics.attempts = [{
      endpoint: 'https://rdap.example/domain/example.com?token=must-not-export',
      outcome: 'success', status: 200, selected: true,
      authorization: 'Bearer must-not-export', cookie: 'session=must-not-export',
    }];
    const injectedAvailability = recordValue(response.availability);
    injectedAvailability.sessionToken = 'must-not-export';
    const injectedHttpResponse = recordValue(recordValue(injectedAvailability.http).response);
    injectedHttpResponse.authorization = 'must-not-export';
    injectedHttpResponse.authorizationHeader = 'Bearer composite-private';
    injectedHttpResponse.authHeader = 'Bearer private-extension';
    injectedHttpResponse.sessionCookie = 'session=composite-private';
    injectedHttpResponse.sessionKey = 'private-session-key';
    injectedHttpResponse.password = 'fixture-private-marker';
    injectedHttpResponse.passwordValue = 'private-password-value';
    injectedHttpResponse.xApiKey = 'composite-private';
    injectedHttpResponse.unknownExtension = 'unreviewed-extension';
    injectedHttpResponse.deliveryMetadata = httpDeliveryMetadataFixture();
    recordValue(injectedAvailability.pageIdentity).publicationMetadata = pagePublicationMetadataFixture();
    recordValue(injectedAvailability.credentialSurfaceProfile).credentialSurfaceSecret = 'private-credential';
    recordValue(injectedAvailability.technologyProfile).credentials = { secret: 'fixture-secret-marker' };
    response.threatIntelligence = {
      version: 1,
      providers: [{ provider: { id: 'fixture_provider' }, findings: [{ detail: 'provider-only-secret' }] }],
    };
    response.registryInsights = {
      version: 99,
      abuseRouting: [{ contact: 'untrusted-registry-insight@example.test' }],
    };
    const result = evidence.buildLookupEvidence(response, { generatedAt: '2026-07-11T02:00:00.000Z' });
    const diagnostics = recordValue(result.diagnostics);
    const rdapDiagnostics = recordValue(diagnostics.rdap);
    const registrarDiagnostics = recordValue(rdapDiagnostics.registrar);
    const rdapParsed = recordValue(result.sources.rdap.parsed);
    const whoisParsed = recordValue(result.sources.whois.parsed);
    const rdapAttempts = arrayValue(result.sources.rdap.attempts).map(recordValue);
    const whoisChain = arrayValue(result.sources.whois.chain).map(recordValue);
    const network = requiredValue(result.sources.network);
    const networkEndpoint = requiredValue(network.endpoint);
    const networkRegistration = requiredValue(network.network);
    const networkRdap = requiredValue(network.rdap);
    const networkAttempts = networkRdap.attempts.map(recordValue);
    const reverseDns = requiredValue(result.sources.reverseDns);
    const reverseDnsDiagnostics = requiredValue(reverseDns.diagnostics);
    const securityTxt = requiredValue(result.sources.securityTxt);
    const sslbl = requiredValue(result.sources.sslbl);
    const availability = recordValue(result.analysis.availability);
    const http = recordValue(availability.http);
    const httpResponse = recordValue(http.response);
    const bodyHash = recordValue(httpResponse.bodyHash);
    const tls = recordValue(availability.tls);
    const certificate = recordValue(tls.certificate);
    const pageIdentity = recordValue(availability.pageIdentity);
    const canonical = recordValue(pageIdentity.canonical);
    const forms = recordValue(pageIdentity.forms);
    const resources = recordValue(pageIdentity.resources);
    const pageFingerprints = recordValue(pageIdentity.fingerprints);
    const exactFingerprint = recordValue(pageFingerprints.exact);
    const visibleTextFingerprint = recordValue(pageFingerprints.visibleText);
    const resourceHostFingerprint = recordValue(pageFingerprints.resourceHosts);
    const trackingIdentifiers = arrayValue(pageIdentity.trackingIdentifiers).map(recordValue);
    const credentialSurface = recordValue(availability.credentialSurfaceProfile);
    const credentialInputs = recordValue(credentialSurface.inputs);
    const credentialCategories = recordValue(credentialInputs.categories);
    const credentialForms = recordValue(credentialSurface.forms);
    const credentialActions = recordValue(credentialForms.actions);
    const structuredData = recordValue(availability.structuredDataIdentity);
    const structuredEntities = arrayValue(structuredData.entities).map(recordValue);
    const dns = recordValue(availability.dns);
    const dnsRecords = recordValue(dns.records);
    const httpsRecords = arrayValue(dnsRecords.https).map(recordValue);
    const httpsParameters = recordValue(requiredValue(httpsRecords[0]).parameters);
    const opaqueParameters = arrayValue(httpsParameters.opaque).map(recordValue);
    const technology = recordValue(availability.technologyProfile);
    const technologyFindings = arrayValue(technology.findings).map(recordValue);
    const libraryProfile = recordValue(technology.browserLibraryProfile);
    const libraryFindings = arrayValue(libraryProfile.findings).map(recordValue);
    const securityPosture = recordValue(availability.securityPosture);
    const securityFindings = arrayValue(securityPosture.findings).map(recordValue);
    const registrarComparison = requiredValue(result.analysis.registrarPublicationComparison);
    const registryInsights = requiredValue(result.analysis.registryInsights);

    assert.equal(result.schema, 'whoisleuth.lookup-evidence');
    assert.equal(result.schemaVersion, evidence.LOOKUP_EVIDENCE_SCHEMA_VERSION);
    assert.equal(result.query.submitted, 'login.example.com');
    assert.equal(result.query.registrableDomain, 'example.com');
    assert.equal(rdapDiagnostics.status, 'success');
    assert.equal(registrarDiagnostics.status, 'success');
    assert.equal(result.sources.rdap.endpoint, 'https://rdap.example/domain/example.com');
    assert.equal(result.sources.rdap.transportSecurity, 'https');
    assert.equal(Object.hasOwn(result.sources.rdap, 'raw'), false);
    assert.equal(rdapParsed.contactsExcluded, true);
    assert.equal(whoisParsed.contactsExcluded, true);
    assert.equal(Object.hasOwn(rdapParsed, 'registrant'), false);
    assert.equal(Object.hasOwn(rdapParsed, 'entitiesByRole'), false);
    assert.equal(rdapParsed.linksTruncated, true);
    assert.equal(rdapParsed.noticesTruncated, false);
    assert.equal(requiredValue(rdapAttempts[0]).outcome, 'success');
    assert.equal(requiredValue(rdapAttempts[0]).endpoint, 'https://rdap.example/domain/example.com');
    assert.deepEqual(Object.keys(requiredValue(rdapAttempts[0])), [
      'endpoint', 'transportSecurity', 'status', 'outcome', 'detail', 'selected',
    ]);
    assert.equal(Object.hasOwn(result.sources.rdap, 'registrarRdap'), false);
    assert.equal(JSON.stringify(result.sources).includes('privateTestValue'), false);
    assert.equal(JSON.stringify(result).includes('provider-only-secret'), false);
    assert.deepEqual(Object.keys(requiredValue(whoisChain[1])), [
      'server', 'address', 'queriedAt', 'queryProfile', 'responseEncoding', 'status', 'detail',
    ]);
    assert.equal(requiredValue(whoisChain[1]).status, 'success');
    assert.equal(Object.hasOwn(requiredValue(whoisChain[1]), 'response'), false);
    assert.doesNotMatch(JSON.stringify(result.sources), /must-not-export|authorization|cookie/iu);
    assert.doesNotMatch(JSON.stringify(result.diagnostics), /must-not-export|authorization|cookie|token/iu);
    assert.doesNotMatch(
      JSON.stringify(result.analysis),
      /must-not-export|composite-private|fixture-private-marker|fixture-secret-marker|private-extension|private-session|private-password|private-credential|unreviewed-extension|authorization|sessionCookie|sessionToken|xApiKey|"credentials"|"password":"/iu,
    );
    assert.equal(result.sources.whois.authoritativeHop, 'whois.registry.example');
    assert.equal(networkEndpoint.address, '93.184.216.34');
    assert.equal(networkRegistration.holder, 'Example network holder');
    assert.deepEqual(networkRegistration.cidrs, ['93.184.216.0/24']);
    assert.equal(requiredValue(networkAttempts[0]).outcome, 'success');
    assert.equal(networkRdap.endpoint, 'https://network.example/ip/93.184.216.34');
    assert.equal(requiredValue(networkAttempts[0]).endpoint, 'https://network.example/ip/93.184.216.34');
    assert.equal(JSON.stringify(network).includes('must-not-export'), false);
    assert.equal(JSON.stringify(network).includes('unknownImportedField'), false);
    assert.equal(reverseDns.status, 'success');
    assert.deepEqual(reverseDns.records.ptr, ['edge.example.test']);
    assert.equal(requiredValue(reverseDnsDiagnostics.ptr).status, 'success');
    assert.equal(JSON.stringify(reverseDns).includes('must-not-export'), false);
    assert.equal(securityTxt.state, 'present');
    assert.deepEqual(securityTxt.contacts, ['mailto:security@example.test']);
    assert.equal(securityTxt.finalUrl, 'https://login.example.com/.well-known/security.txt');
    assert.equal(JSON.stringify(securityTxt).includes('must-not-export-security-txt-body'), false);
    assert.equal(JSON.stringify(securityTxt).includes('javascript:'), false);
    assert.equal(sslbl.verdict, 'listed');
    assert.equal(sslbl.fingerprintSha1, '3'.repeat(40));
    assert.equal(sslbl.referenceUrl, `https://sslbl.abuse.ch/ssl-certificates/sha1/${'3'.repeat(40)}/`);
    assert.equal(requiredValue(sslbl.snapshot).digestSha256, '4'.repeat(64));
    assert.equal(JSON.stringify(sslbl).includes('must-not-export'), false);
    const unsafeResponse = fixtureResponse();
    unsafeResponse.sslbl = {
      ...recordValue(unsafeResponse.sslbl),
      referenceUrl: `https://provider.invalid/ssl-certificates/sha1/${'3'.repeat(40)}/`,
    };
    const unsafeSslbl = evidence.buildLookupEvidence(unsafeResponse);
    assert.equal(requiredValue(requiredValue(unsafeSslbl.sources).sslbl).referenceUrl, null);
    assert.equal(availability.hasMx, true);
    assert.equal(availability.registryContactsExcluded, true);
    assert.equal(Object.hasOwn(availability, 'registrar'), false);
    assert.equal(Object.hasOwn(availability, 'registrant'), false);
    assert.equal(Object.hasOwn(availability, 'abuse'), false);
    assert.equal(httpResponse.status, 200);
    assert.equal(bodyHash.value, 'a'.repeat(64));
    assert.equal(bodyHash.scope, 'complete-body');
    assert.equal(tls.connectedAddress, '93.184.216.34');
    assert.equal(certificate.fingerprintSha256, '2'.repeat(64));
    assert.equal(pageIdentity.identityVersion, 3);
    assert.equal(canonical.url, 'https://example.com/');
    assert.equal(forms.postCount, 1);
    assert.deepEqual(resources.externalOrigins, ['https://cdn.example']);
    assert.deepEqual(pageIdentity.contactDomains, ['example.com']);
    assert.equal(requiredValue(trackingIdentifiers[0]).value, 'GTM-AB12');
    assert.equal(pageFingerprints.fingerprintVersion, 1);
    assert.equal(exactFingerprint.value, 'a'.repeat(64));
    assert.equal(visibleTextFingerprint.value, 'c'.repeat(16));
    assert.deepEqual(resourceHostFingerprint.values, ['cdn.example']);
    assert.equal(credentialSurface.credentialSurfaceVersion, 1);
    assert.equal(credentialCategories.password, 1);
    assert.equal(credentialActions.external, 1);
    assert.equal(structuredData.structuredDataVersion, 1);
    assert.equal(requiredValue(structuredEntities[0]).name, 'Example publisher');
    assert.equal(requiredValue(opaqueParameters[0]).name, 'ech');
    assert.equal(technology.profileVersion, 3);
    assert.equal(requiredValue(technologyFindings[0]).name, 'Fixture Framework');
    assert.equal(libraryProfile.profileVersion, 1);
    assert.equal(requiredValue(libraryFindings[0]).advisoryCount, 1);
    assert.equal(securityPosture.postureVersion, 1);
    assert.equal(requiredValue(securityFindings[0]).state, 'observed_absence');
    assert.equal(result.analysis.idn, null);
    assert.equal(result.analysis.registryComparison.counts.conflict, 0);
    assert.equal(registryInsights.version, 1);
    assert.equal(Object.hasOwn(registryInsights, 'abuseRouting'), false);
    assert.equal(JSON.stringify(registryInsights).includes('untrusted-registry-insight'), false);
    assert.equal(registrarComparison.counts.conflict, 1);
    assert.equal(registrarComparison.counts.equivalent, 7);
    assert.equal(registrarComparison.sourceHealth.registry.status, 'success');
    assert.equal(registrarComparison.sourceHealth.registrar.status, 'success');
    const expiry = requiredValue(registrarComparison.fields.find((field) => field.label === 'Expires'));
    assert.equal(expiry.registryDisplay, '2030-01-01T00:00:00Z');
    assert.equal(expiry.registrarDisplay, '2031-01-01');
    assert.equal(registrarComparison.fields.some((field) => field.label === 'Registry object ID'), false);
    assert.equal(JSON.stringify(result).includes('REGISTRAR-OBJECT'), false);
    assert.equal(JSON.stringify(result).includes('private-nested@example.test'), false);
    assert.doesNotMatch(
      evidence.serializeLookupEvidence(result),
      /Private Registrant Marker|private-registrant|Private VCard Marker|private-raw|Private WHOIS Marker|private-whois|1 Private Street|5550 0100|Availability Registrar Marker|Availability Registrant Marker|availability-private|availability-abuse|99 Availability Street|5550 0199/iu,
    );
    assert.deepEqual(recordValue(pageIdentity.publicationMetadata), pagePublicationMetadataFixture());
    assert.deepEqual(recordValue(httpResponse.deliveryMetadata), httpDeliveryMetadataFixture());
    assert.equal(result.generatedAt, '2026-07-11T02:00:00.000Z');
  });

  test('requires explicit generation times and canonicalizes explicit offsets', () => {
    assert.throws(
      () => evidence.buildLookupEvidence(fixtureResponse(), { generatedAt: '2026-07-11T12:00:00' }),
      /explicit timezone/u,
    );
    assert.equal(
      evidence.buildLookupEvidence(fixtureResponse(), { generatedAt: '2026-07-11T12:00:00+01:00' }).generatedAt,
      '2026-07-11T11:00:00.000Z',
    );
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
        session: 'must-not-export',
        unknownImportedField: 'must-not-export',
      },
    });

    assert.equal(result.schemaVersion, evidence.LOOKUP_EVIDENCE_SCHEMA_VERSION);
    const idn = recordValue(result.analysis.idn);
    assert.equal(idn.version, 1);
    assert.equal(idn.unicodeDomain, 'éxample.test');
    assert.equal(Object.hasOwn(idn, 'session'), false);
    assert.equal(Object.hasOwn(idn, 'unknownImportedField'), false);
  });

  test('retains bounded generator metadata without accepting an arbitrary version or URL', () => {
    const result = evidence.buildLookupEvidence(fixtureResponse(), { applicationVersion: '1.35.0' });
    assert.deepEqual(result.application, {
      name: 'WHOISleuth',
      version: '1.35.0',
      projectUrl: 'https://github.com/slicedearth/whoisleuth',
    });
    assert.equal(evidence.buildLookupEvidence(fixtureResponse(), {
      applicationVersion: 'not a version\nhttps://untrusted.example',
    }).application.version, null);
  });

  test('retains bounded DNS provenance already present in the availability assessment', () => {
    const response = fixtureResponse();
    recordValue(response.availability).dns = {
      version: 1, status: 'partial', source: 'dns', complete: false, truncated: false,
      records: { a: ['192.0.2.1'], caa: [{ critical: 0, tag: 'issue', value: 'ca.example' }] },
      diagnostics: { a: { status: 'success' }, caa: { status: 'error', error: 'resolver timed out' } },
    };
    const result = evidence.buildLookupEvidence(response);
    const availability = recordValue(result.analysis.availability);
    const dns = recordValue(availability.dns);
    const records = recordValue(dns.records);
    const diagnostics = recordValue(dns.diagnostics);
    assert.deepEqual(records.a, ['192.0.2.1']);
    assert.equal(dns.version, 1);
    assert.equal(recordValue(diagnostics.caa).status, 'error');
  });

  test('admits ambiguous availability fields only at their reviewed model paths', () => {
    const response = fixtureResponse();
    const availability = recordValue(response.availability);
    const structured = recordValue(availability.structuredDataIdentity);
    structured.entities = [{
      types: ['Organization'],
      name: 'Example publisher',
      declaredOrigin: 'https://example.com/path?source=private#fragment',
      sameAsHosts: ['social.example'],
      email: 'nested-private@example.test',
      owner: 'Private owner',
      value: 'https://example.test/path?session=private#fragment',
      url: 'https://example.test/path?session=private#fragment',
      password: 'placeholder',
    }];
    const projected = recordValue(evidence.buildLookupEvidence(response).analysis.availability);
    const entity = requiredValue(arrayValue(recordValue(projected.structuredDataIdentity).entities)[0]);
    const categories = recordValue(recordValue(recordValue(projected.credentialSurfaceProfile).inputs).categories);

    assert.deepEqual(entity, {
      types: ['Organization'],
      name: 'Example publisher',
      declaredOrigin: 'https://example.com/path',
      sameAsHosts: ['social.example'],
      url: 'https://example.test/path',
    });
    assert.deepEqual(categories, {
      password: 1, email: 1, username: 0, one_time_code: 0, payment: 0,
    });
    assert.equal(projected.registryContactsExcluded, true);
  });

  test('sanitizes URL-shaped schema-28 strings after whitespace and default-ignorable prefixes', () => {
    const hiddenCredentialUrl = '\u034fhttps://analyst:secret@evidence.example.test/path?trace=private#fragment';
    const response = fixtureResponse();
    recordValue(response.availability).structuredDataIdentity = analyzeStructuredDataIdentity({
      html: `<script type="application/ld+json">${JSON.stringify({
        '@type': 'Organization',
        name: hiddenCredentialUrl,
      })}</script>`,
      baseUrl: 'https://example.test/',
      observedAt: '2026-08-15T00:00:00.000Z',
    });
    const produced = recordValue(evidence.buildLookupEvidence(response).analysis.availability);
    assert.deepEqual(recordValue(produced.structuredDataIdentity).entities, []);
    assert.doesNotMatch(JSON.stringify(produced), /analyst|secret|trace=private|\u034f/iu);

    for (const name of [
      ...[' ', '\u0001', '\u0085', '\u00ad', '\u034f', '\u034f ']
        .map((prefix) => `${prefix}https://evidence.example.test/path?trace=private#fragment`),
      'ftp://analyst:secret@evidence.example.test/path?trace=private#fragment',
      '\u034fftp://analyst:secret@evidence.example.test/path?trace=private#fragment',
      'mailto:private@example.test?subject=secret',
      'urn:example:private-identifier',
      `${'a'.repeat(33)}://analyst:secret@evidence.example.test/path?trace=private#fragment`,
      `${'A'.repeat(64)}://analyst:secret@evidence.example.test/path?trace=private#fragment`,
    ]) {
      const projected = recordValue(evidence.projectLookupEvidenceAvailability({
        structuredDataIdentity: {
          entities: [{
            name,
          }],
        },
      }));
      const entity = recordValue(arrayValue(recordValue(projected.structuredDataIdentity).entities)[0]);
      assert.equal(entity.name, null);
      assert.doesNotMatch(JSON.stringify(projected), /analyst|secret|private-identifier|trace=private|fragment|[\u0001\u0085\u00ad\u034f]/iu);
    }

    for (const name of ['Example: Trading \ufffd', 'K:Trading', 'ſ:Trading']) {
      const ordinary = recordValue(evidence.projectLookupEvidenceAvailability({
        structuredDataIdentity: { entities: [{ name }] },
      }));
      assert.equal(recordValue(arrayValue(recordValue(ordinary.structuredDataIdentity).entities)[0]).name, name);
    }
  });

  test('retains partial source failures without failing the export', () => {
    const response = fixtureResponse();
    response.rdap = { error: 'RDAP timed out', attempts: [{ outcome: 'timeout' }] };
    const whois = recordValue(response.whois);
    const whoisParsed = recordValue(whois.parsed);
    whoisParsed.chainStatus = 'partial';
    whoisParsed.failedHop = 'whois.registrar.example';
    const diagnostics = recordValue(response.diagnostics);
    recordValue(diagnostics.rdap).status = 'error';
    recordValue(diagnostics.whois).status = 'partial';
    const result = evidence.buildLookupEvidence(response);

    assert.deepEqual(result.sources.rdap, {
      status: 'error',
      error: 'RDAP timed out',
      attempts: [{
        endpoint: null, transportSecurity: null, status: null,
        outcome: 'timeout', detail: null, selected: false,
      }],
    });
    assert.equal(result.sources.whois.status, 'partial');
    assert.equal(result.sources.whois.failedHop, 'whois.registrar.example');
    assert.equal(result.analysis.registryComparison.counts.rdap_unavailable, 4);
    assert.equal(result.analysis.registryComparison.counts.whois_only, 0);
    assert.equal(result.analysis.registryComparison.sourceHealth.rdap.condition, 'unavailable');
    assert.equal(result.analysis.registryComparison.sourceHealth.whois.condition, 'incomplete');
  });

  test('keeps partial registration sources explicit when no publication payload was retained', () => {
    const response = fixtureResponse();
    response.rdap = {};
    response.whois = { chain: [] };
    const diagnostics = recordValue(response.diagnostics);
    recordValue(diagnostics.rdap).status = 'partial';
    recordValue(diagnostics.whois).status = 'partial';

    const result = evidence.buildLookupEvidence(response);
    assert.equal(result.sources.rdap.status, 'partial');
    assert.equal(result.sources.rdap.parsed, null);
    assert.equal(Object.hasOwn(result.sources.rdap, 'raw'), false);
    assert.equal(result.sources.whois.status, 'partial');
    assert.equal(result.sources.whois.parsed, null);
    assert.deepEqual(result.sources.whois.chain, []);
  });

  test('refuses complete registration sources without normalized publication data', () => {
    const missingRdap = fixtureResponse();
    missingRdap.rdap = {};
    assert.throws(
      () => evidence.buildLookupEvidence(missingRdap),
      /successful RDAP without normalized publication data/iu,
    );

    const missingWhois = fixtureResponse();
    missingWhois.whois = { chain: [] };
    assert.throws(
      () => evidence.buildLookupEvidence(missingWhois),
      /complete WHOIS without normalized publication data/iu,
    );
  });

  test('discloses redaction declarations omitted by the portable projection', () => {
    const overCap = fixtureResponse();
    const overCapParsed = recordValue(recordValue(overCap.rdap).parsed);
    overCapParsed.redactions = Array.from({ length: 101 }, (_, index) => ({
      name: `Field ${index}`,
      reason: null,
      method: 'removal',
      pathLanguage: 'jsonpath',
      prePath: `$.entities[${index}]`,
      postPath: null,
      replacementPath: null,
    }));
    overCapParsed.redactionsTruncated = false;
    const bounded = recordValue(evidence.buildLookupEvidence(overCap).sources.rdap.parsed);
    assert.equal(arrayValue(bounded.redactions).length, 100);
    assert.equal(bounded.redactionsTruncated, true);

    const malformed = fixtureResponse();
    const malformedParsed = recordValue(recordValue(malformed.rdap).parsed);
    malformedParsed.redactions = [{ name: 7 }];
    malformedParsed.redactionsTruncated = false;
    const filtered = recordValue(evidence.buildLookupEvidence(malformed).sources.rdap.parsed);
    assert.deepEqual(filtered.redactions, []);
    assert.equal(filtered.redactionsTruncated, true);
  });

  test('does not derive registry claims from publications whose diagnostics are unavailable', () => {
    const result = evidence.buildLookupEvidence({
      query: 'example.test',
      type: 'domain',
      inputHostname: 'example.test',
      registrableDomain: 'example.test',
      diagnostics: {
        rdap: { status: 'unsupported' },
        whois: { status: 'skipped' },
      },
      rdap: {
        parsed: { domain: 'INJECTED.EXAMPLE', registrar: { name: 'Injected Registrar' } },
        data: { authorization: 'must-not-export' },
      },
      whois: {
        parsed: { domainName: 'INJECTED.EXAMPLE', registrar: 'Injected Registrar' },
        chain: [{ server: 'whois.example.test', response: 'private publication' }],
      },
      availability: { applicable: true, state: 'unknown', confidence: 'low' },
    });
    assert.equal(result.sources.rdap.parsed, null);
    assert.equal(Object.hasOwn(result.sources.rdap, 'raw'), false);
    assert.equal(result.sources.whois.parsed, null);
    assert.deepEqual(result.sources.whois.chain, []);
    assert.deepEqual(result.analysis.registryComparison.fields, []);
    const registryInsights = recordValue(requiredValue(result.analysis.registryInsights));
    const contactDisclosure = recordValue(registryInsights.contactDisclosure);
    assert.equal(recordValue(contactDisclosure.registryRdap).state, 'unavailable');
    assert.equal(recordValue(contactDisclosure.whois).state, 'unavailable');
    assert.doesNotMatch(JSON.stringify(result.analysis), /Injected Registrar|INJECTED\.EXAMPLE/iu);
  });

  test('keeps an unavailable registrar publication neutral instead of inventing a discrepancy', () => {
    const response = fixtureResponse();
    const rdap = recordValue(response.rdap);
    rdap.registrarRdap = {
      status: 'unsupported',
      detail: 'The registry did not publish an eligible registrar RDAP link.',
    };
    const diagnostics = recordValue(response.diagnostics);
    recordValue(diagnostics.rdap).registrar = { status: 'unsupported' };
    const result = evidence.buildLookupEvidence(response);
    const comparison = requiredValue(result.analysis.registrarPublicationComparison);

    assert.equal(comparison.counts.conflict, 0);
    assert.equal(comparison.counts.registry_only, 0);
    assert.ok(comparison.counts.registrar_unavailable > 0);
    assert.equal(comparison.sourceHealth.registrar.condition, 'unavailable');
  });

  test('uses null when no registrar publication follow-up was represented', () => {
    const response = fixtureResponse();
    delete recordValue(response.rdap).registrarRdap;
    delete recordValue(recordValue(response.diagnostics).rdap).registrar;
    const result = evidence.buildLookupEvidence(response);
    assert.equal(result.analysis.registrarPublicationComparison, null);
  });

  test('uses null when no bounded observed network context was represented', () => {
    const response = fixtureResponse();
    delete response.networkContext;
    const result = evidence.buildLookupEvidence(response);
    assert.equal(result.sources.network, null);
  });

  test('uses null when no bounded reverse DNS source was represented', () => {
    const response = fixtureResponse();
    delete response.reverseDns;
    const result = evidence.buildLookupEvidence(response);
    assert.equal(result.sources.reverseDns, null);
  });

  test('suppresses unavailable network and reverse-DNS publications without erasing complete no-data observations', () => {
    for (const status of ['not_found', 'unsupported', 'error']) {
      const response = fixtureResponse();
      response.networkContext = {
        ...recordValue(response.networkContext),
        status,
        complete: true,
      };
      const source = requiredValue(evidence.buildLookupEvidence(response).sources.network);
      assert.equal(source.status, status);
      assert.equal(source.complete, status === 'not_found');
      assert.equal(source.endpoint, null);
      assert.equal(source.rdap, null);
      assert.equal(source.network, null);
    }
    for (const status of ['not_found', 'unsupported', 'skipped', 'error']) {
      const response = fixtureResponse();
      response.reverseDns = {
        ...recordValue(response.reverseDns),
        status,
        complete: true,
      };
      const source = requiredValue(evidence.buildLookupEvidence(response).sources.reverseDns);
      assert.equal(source.status, status);
      assert.equal(source.complete, status === 'not_found');
      assert.deepEqual(source.records.ptr, []);
    }
  });

  test('canonicalizes the submitted target instead of retaining URL paths, queries, or fragments', () => {
    const response = fixtureResponse();
    response.query = 'https://login.example.com/private/path?token=session-private#fragment';
    const result = evidence.buildLookupEvidence(response);

    assert.deepEqual(result.query, {
      submitted: 'login.example.com',
      type: 'domain',
      inputHostname: 'login.example.com',
      registrableDomain: 'example.com',
      isSubdomain: true,
    });
    assert.doesNotMatch(JSON.stringify(result.query), /private|token|fragment/iu);
  });

  test('uses null when no bounded security.txt source was represented', () => {
    const response = fixtureResponse();
    delete response.securityTxt;
    const result = evidence.buildLookupEvidence(response);
    assert.equal(result.sources.securityTxt, null);
  });

  test('rejects current homepage metadata that contradicts its parent source state', () => {
    for (const family of ['page', 'http'] as const) {
      const withoutChild = fixtureResponse();
      const withoutAvailability = recordValue(withoutChild.availability);
      if (family === 'page') {
        recordValue(withoutAvailability.pageIdentity).status = 'error';
      } else {
        recordValue(withoutAvailability.http).status = 'error';
      }
      assert.doesNotThrow(() => evidence.buildLookupEvidence(withoutChild));

      const response = fixtureResponse();
      const availability = recordValue(response.availability);
      if (family === 'page') {
        const page = recordValue(availability.pageIdentity);
        page.status = 'error';
        page.publicationMetadata = pagePublicationMetadataFixture();
      } else {
        const http = recordValue(availability.http);
        http.status = 'error';
        recordValue(http.response).deliveryMetadata = httpDeliveryMetadataFixture();
      }
      assert.throws(
        () => evidence.buildLookupEvidence(response),
        /invalid (?:page publication|HTTP delivery) metadata/iu,
      );
    }
  });

  test('bounds malformed imported lookup structures at the export boundary', () => {
    const result = evidence.buildLookupEvidence({
      rdap: { parsed: 'invalid' },
      whois: { parsed: 'invalid', chain: [null, 'invalid'] },
      diagnostics: 'invalid',
    });

    assert.deepEqual(result.analysis.registryComparison.fields, []);
    assert.equal(result.analysis.registrarPublicationComparison, null);
    assert.equal(result.sources.whois.status, 'error');
    assert.equal(result.sources.whois.queriedAt, undefined);
  });

  test('sanitizes over-bound strings before truncation and keeps the projection idempotent', () => {
    const raw = `prefix\u0000${'x'.repeat(evidence.LOOKUP_EVIDENCE_PORTABLE_MAX_STRING_LENGTH)}`;
    const projected = evidence.projectLookupEvidencePrivacySafeTree({ value: raw });
    const projectedAgain = evidence.projectLookupEvidencePrivacySafeTree(projected);

    assert.equal(projected.value.length, evidence.LOOKUP_EVIDENCE_PORTABLE_MAX_STRING_LENGTH);
    assert.doesNotMatch(projected.value, /[\u0000-\u001f\u007f]/u);
    assert.deepEqual(projectedAgain, projected);
    assert.doesNotThrow(() => evidence.assertLookupEvidencePrivacySafeTree(projected));
    assert.doesNotThrow(() => evidence.serializeLookupEvidence(projected));
  });

  test('fails portable projection at controlled depth before JavaScript recursion can overflow', () => {
    let nested: unknown = 'leaf';
    for (let index = 0; index <= evidence.LOOKUP_EVIDENCE_PORTABLE_MAX_DEPTH; index += 1) {
      nested = { detail: nested };
    }
    for (const project of [
      () => evidence.projectLookupEvidencePrivacySafeTree(nested),
      () => evidence.projectLookupEvidenceAvailability({ dns: { records: nested } }),
    ]) {
      assert.throws(project, (cause) => cause instanceof TypeError
        && !(cause instanceof RangeError)
        && /portable nesting limit/u.test(cause.message));
    }
  });

  test('applies the portable entry budget while projecting privacy and availability trees', () => {
    const records = Array.from(
      { length: evidence.LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS },
      (_, index) => ({ name: `record-${index}`, value: index }),
    );
    for (const project of [
      () => evidence.projectLookupEvidencePrivacySafeTree(records),
      () => evidence.projectLookupEvidenceAvailability({ dns: { records } }),
    ]) {
      assert.throws(project, (cause) => cause instanceof TypeError
        && !(cause instanceof RangeError)
        && /entry portable limit/u.test(cause.message));
    }
  });

  test('rejects prototype-sensitive source keys before they can become inherited derived evidence', () => {
    for (const key of ['__proto__']) {
      const response = fixtureResponse();
      recordValue(response.rdap).parsed = JSON.parse(
        `{"${key}":{"domain":"forged.example.test","statuses":["pendingDelete"]},"handle":"REAL-1"}`,
      );
      assert.throws(
        () => evidence.buildLookupEvidence(response),
        /Lookup response contains an unsafe object key/u,
        key,
      );
      assert.throws(
        () => evidence.projectLookupEvidencePrivacySafeTree(recordValue(response.rdap).parsed),
        /Lookup evidence projection contains an unsafe object key/u,
        key,
      );
    }
    const projected = evidence.projectLookupEvidencePrivacySafeTree(JSON.parse(
      '{"constructor":"ordinary additive value","prototype":"ordinary additive value"}',
    ));
    assert.deepEqual({ ...projected }, {
      constructor: 'ordinary additive value',
      prototype: 'ordinary additive value',
    });
    assert.equal(Object.getPrototypeOf(projected), Object.prototype);
  });

  test('requires every built evidence document to satisfy the portable tree contract', () => {
    const response = fixtureResponse();
    let nested: unknown = 'leaf';
    for (let index = 0; index <= evidence.LOOKUP_EVIDENCE_PORTABLE_MAX_DEPTH; index += 1) {
      nested = { detail: nested };
    }
    recordValue(response.availability).http = nested;
    assert.throws(
      () => evidence.buildLookupEvidence(response),
      (cause) => cause instanceof TypeError
        && !(cause instanceof RangeError)
        && /portable nesting limit/u.test(cause.message),
    );
  });

  test('rejects values that cannot round-trip through portable JSON', () => {
    for (const value of [
      Number.POSITIVE_INFINITY,
      Number.NaN,
      undefined,
      () => 'fixture',
      Symbol('fixture'),
      BigInt(1),
      new Date('2026-08-12T00:00:00.000Z'),
    ]) {
      assert.throws(
        () => evidence.serializeLookupEvidence({ value }),
        /non-(?:finite number|JSON value|JSON object)/u,
        String(value),
      );
    }
    const accepted = {
      minimum: -Number.MAX_VALUE,
      maximum: Number.MAX_VALUE,
      zero: 0,
      enabled: true,
      absent: null,
    };
    const serialized = evidence.serializeLookupEvidence(accepted);
    assert.equal(typeof serialized, 'string');
    assert.deepEqual(JSON.parse(serialized), accepted);
  });

  test('creates a bounded, filesystem-safe filename', () => {
    const filename = evidence.evidenceFilename(
      { registrableDomain: 'Bücher.Example/path' },
      Date.parse('2026-07-11T02:03:04.000Z')
    );
    assert.equal(filename, 'whoisleuth-evidence-b-cher.example-path-2026-07-11T02-03-04-000Z.json');
  });
});
