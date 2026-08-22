import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';
import {
  LOOKUP_EVIDENCE_REPLAY_MAX_BYTES,
  LOOKUP_EVIDENCE_REPLAY_MAX_ENTRIES,
  parseLookupEvidenceReplay,
} from '../frontend/src/lib/analysis/lookup-evidence-replay.ts';
import {
  buildLookupEvidence,
  LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS,
  LOOKUP_EVIDENCE_PORTABLE_MAX_KEY_LENGTH,
  LOOKUP_EVIDENCE_PORTABLE_MAX_STRING_LENGTH,
  LOOKUP_EVIDENCE_SCHEMA,
  LOOKUP_EVIDENCE_SCHEMA_VERSION,
  projectLookupEvidenceRegistryInsights,
  projectLookupEvidenceRdapSourcePublication,
  projectLookupEvidenceWhoisSourcePublication,
} from '../frontend/src/lib/analysis/evidence-export.ts';
import { compareRegistrySources } from '../lib/registry-comparison.mts';
import { buildRegistryInsights } from '../lib/registry-insights.mts';
import { loadLookupEvidenceV26Fixture } from './lookup-evidence-v26-fixture.mts';
import {
  httpDeliveryMetadataFixture,
  pagePublicationMetadataFixture,
} from './homepage-metadata-fixtures.mts';

function evidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: LOOKUP_EVIDENCE_SCHEMA,
    schemaVersion: LOOKUP_EVIDENCE_SCHEMA_VERSION,
    generatedAt: '2026-07-31T00:00:00.000Z',
    application: {
      name: 'WHOISleuth',
      version: '1.34.1',
      projectUrl: 'https://github.com/slicedearth/whoisleuth',
    },
    query: { submitted: 'example.test', registrableDomain: 'example.test', type: 'domain' },
    diagnostics: {
      rdap: { status: 'success', fetchedAt: '2026-07-31T00:00:00.000Z' },
      whois: { status: 'partial', queriedAt: '2026-07-31T00:00:00.000Z' },
    },
    sources: {
      rdap: {
        status: 'success',
        endpoint: null,
        transportSecurity: null,
        httpStatus: null,
        fetchedAt: '2026-07-31T00:00:00.000Z',
        attempts: [],
        parsed: {
          domain: 'example.test',
          registrar: { name: 'Example Registrar', roles: [], publicIds: [] },
          nameservers: ['ns1.example.test'],
          lifecycle: { createdDateIso: '2025-01-01T00:00:00.000Z' },
          contactsExcluded: true,
        },
      },
      whois: {
        status: 'partial',
        queriedAt: '2026-07-31T00:00:00.000Z',
        authoritativeHop: null,
        failedHop: null,
        conflictingHop: null,
        parsed: { contactsExcluded: true },
        chain: [],
      },
      reverseDns: null,
      network: null,
      securityTxt: null,
      sslbl: null,
    },
    analysis: {
      availability: {
        state: 'registered',
        confidence: 'high',
        registryContactsExcluded: true,
        dns: { status: 'success', records: {} },
        http: { status: 'success', finalUrl: 'https://example.test/' },
        tls: {
          status: 'success',
          complete: true,
          connectedAddress: '192.0.2.10',
          hostname: { matches: true, error: null },
          certificate: {
            fingerprintSha256: 'a'.repeat(64),
            validFrom: '2026-07-01T00:00:00.000Z',
            validTo: '2026-10-01T00:00:00.000Z',
            subjectAltNames: { dnsNames: ['example.test'] },
          },
        },
        pageIdentity: { status: 'success', title: '<script>alert(1)</script>' },
        technologyProfile: { status: 'success', findings: [{ name: 'Example CMS' }] },
      },
      registryComparison: {
        fields: [{ label: 'Statuses', status: 'conflict' }],
      },
      registryInsights: {},
      registrarPublicationComparison: null,
    },
    ...overrides,
  };
}

function rebuildCurrentRegistryDerivations(document: Record<string, unknown>): void {
  const sources = document.sources as Record<string, Record<string, unknown>>;
  const diagnostics = document.diagnostics as Record<string, Record<string, unknown>>;
  const analysis = document.analysis as Record<string, unknown>;
  const rdap = sources.rdap!;
  const whois = sources.whois!;
  const rdapStatus = String(diagnostics.rdap?.status ?? 'error');
  const whoisStatus = String(diagnostics.whois?.status ?? 'error');
  const rdapParsed = ['success', 'partial'].includes(rdapStatus) ? rdap.parsed : null;
  const whoisParsed = ['complete', 'partial'].includes(whoisStatus) ? whois.parsed : null;
  analysis.registryComparison = compareRegistrySources(rdapParsed, whoisParsed, {
    rdapStatus,
    whoisStatus,
  });
  analysis.registryInsights = projectLookupEvidenceRegistryInsights(buildRegistryInsights({
    rdapParsed,
    rdapStatus,
    rdapFetchedAt: rdap.fetchedAt,
    whoisParsed,
    whoisStatus,
    whoisQueriedAt: whois.queriedAt,
  }));
}

test('replay validates and summarizes a current first-party export without raw rendering', async () => {
  const replay = await parseLookupEvidenceReplay(JSON.stringify(evidence()));
  assert.equal(replay.target, 'example.test');
  assert.equal(replay.availability, 'registered');
  assert.equal(replay.digestSha256.length, 64);
  assert.equal(replay.digestVerified, false);
  assert.equal(replay.generatorVersion, '1.34.1');
  assert.ok(replay.sources.some((source) => source.id === 'rdap' && source.state === 'success'));
  assert.ok(replay.facts.some((fact) => fact.id === 'technology.detected'
    && fact.sourceId === 'technology'
    && fact.sourceState === 'success'
    && fact.label === 'Detected technology'
    && fact.value === 'Example CMS'));
  assert.ok(replay.facts.some((fact) => fact.id === 'registration.registrar'
    && fact.sourceId === 'rdap'
    && fact.sourceState === 'success'));
  assert.ok(replay.contradictions.some((value) => value.includes('Statuses')));
  assert.ok(replay.unknowns.some((value) => value.includes('WHOIS')));
  assert.ok(replay.recommendedSteps.some((value) => value.includes('historical evidence')));
  assert.ok(replay.graph.edges.some((edge) => edge.kind === 'presents-certificate'));
  assert.ok(replay.graph.edges.some((edge) => edge.kind === 'reviewed-hostname-match'));
  assert.ok(!replay.graph.edges.some((edge) => edge.kind === 'reviewed-runtime-trust'));
  assert.equal(JSON.stringify(replay).includes('<script>'), true);
});

test('replay preserves the exact submitted hostname as its identity and graph root', async () => {
  const document = evidence();
  document.query = {
    submitted: 'portal.example.test',
    inputHostname: 'portal.example.test',
    registrableDomain: 'example.test',
    type: 'domain',
  };
  const replay = await parseLookupEvidenceReplay(JSON.stringify(document));
  assert.equal(replay.target, 'portal.example.test');
  assert.ok(replay.graph.nodes.some((node) => (
    node.kind === 'target' && node.label === 'portal.example.test'
  )));
  assert.equal(replay.graph.nodes.some((node) => (
    node.kind === 'target' && node.label === 'example.test'
  )), false);
});

test('replay requires explicit timestamps in supported documents', async () => {
  await assert.rejects(
    () => parseLookupEvidenceReplay(JSON.stringify(evidence({ generatedAt: '2026-07-31T12:00:00.000' }))),
    /timestamp is missing or invalid/u,
  );
  const currentSource = evidence();
  (currentSource.sources as Record<string, Record<string, unknown>>).rdap!.fetchedAt = '2026-07-31T12:00:00.000';
  await assert.rejects(() => parseLookupEvidenceReplay(JSON.stringify(currentSource)), /explicit timezone/u);
  const offset = await parseLookupEvidenceReplay(JSON.stringify(evidence({ generatedAt: '2026-07-31T12:00:00.000+01:00' })));
  assert.equal(offset.exportedAt, '2026-07-31T11:00:00.000Z');
});

test('replay rejects reader-only Lookup evidence without mutating it', async () => {
  const unsupported = { schema: LOOKUP_EVIDENCE_SCHEMA, schemaVersion: 25 };
  const before = structuredClone(unsupported);
  await assert.rejects(parseLookupEvidenceReplay(JSON.stringify(unsupported)), /schemas 26 or 27/iu);
  assert.deepEqual(unsupported, before);
});

test('replay keeps the frozen strict schema-26 compatibility fixture readable without inventing current metadata', async () => {
  const replay = await parseLookupEvidenceReplay(await loadLookupEvidenceV26Fixture());
  assert.equal(replay.schemaVersion, 26);
  assert.equal(replay.target, 'example.test');
  assert.equal(replay.pagePublicationMetadata, null);
  assert.equal(replay.httpDeliveryMetadata, null);
});

test('replay sanitises terminal controls from exact public evidence without rewriting the input', async () => {
  const document = JSON.parse(await loadLookupEvidenceV26Fixture()) as Record<string, unknown>;
  const analysis = document.analysis as Record<string, Record<string, unknown>>;
  analysis.availability!.pageTitle = 'Account\u009b\u202e centre\u00ad';
  const input = JSON.stringify(document);
  const replay = await parseLookupEvidenceReplay(input);
  assert.equal(replay.facts.find((fact) => fact.id === 'page.title')?.value, 'Account centre');
  assert.doesNotMatch(JSON.stringify(replay), /[\u0080-\u009f]|\p{Default_Ignorable_Code_Point}/u);
  assert.match(input, /[\u0080-\u009f]|\p{Default_Ignorable_Code_Point}/u);
});

test('replay rejects current documents that carry excluded or arbitrary publication fields', async () => {
  const mutations: Array<(document: Record<string, unknown>) => void> = [
    (document) => { (document.sources as Record<string, Record<string, unknown>>).rdap!.raw = { entities: [] }; },
    (document) => {
      const rdap = (document.sources as Record<string, Record<string, Record<string, unknown>>>).rdap!;
      rdap.parsed!.registrant = { email: 'private@example.test' };
    },
    (document) => {
      const rdap = (document.sources as Record<string, Record<string, Record<string, unknown>>>).rdap!;
      delete rdap.parsed!.contactsExcluded;
    },
    (document) => {
      const rdap = (document.sources as Record<string, Record<string, Record<string, unknown>>>).rdap!;
      rdap.parsed!.contactsExcluded = false;
    },
    (document) => { (document.sources as Record<string, Record<string, unknown>>).rdap!.unexpected = true; },
    (document) => {
      const rdap = (document.sources as Record<string, Record<string, unknown>>).rdap!;
      rdap.endpoint = 'https://user:secret@rdap.example.test/path?query=private#fragment';
    },
    (document) => {
      const rdap = (document.sources as Record<string, Record<string, unknown>>).rdap!;
      rdap.attempts = [{
        endpoint: 'https://rdap.example.test/',
        transportSecurity: 'https',
        status: 200,
        outcome: 'success',
        detail: null,
        selected: true,
        authorization: 'not-retained',
      }];
    },
    (document) => {
      const rdap = (document.sources as Record<string, Record<string, unknown>>).rdap!;
      rdap.attempts = [{
        endpoint: 'https://rdap.example.test/',
        transportSecurity: 'http',
        status: '200',
        outcome: 'success',
        detail: null,
        selected: 'yes',
      }];
    },
    (document) => {
      const whois = (document.sources as Record<string, Record<string, unknown>>).whois!;
      whois.chain = [{
        server: 'whois.example.test',
        address: '192.0.2.10',
        queriedAt: '2026-07-31T00:00:00.000Z',
        queryProfile: 'plain-domain',
        responseEncoding: 'utf-8',
        status: 'success',
        detail: null,
        response: 'Registrant: Private Person',
        unexpected: true,
      }];
    },
    (document) => {
      const whois = (document.sources as Record<string, Record<string, unknown>>).whois!;
      whois.chain = [{
        server: 'whois.example.test',
        address: '192.0.2.10',
        queriedAt: 'not-a-timestamp',
        queryProfile: 'unreviewed-profile',
        responseEncoding: 'latin-1',
        status: 'invented',
        detail: null,
      }];
    },
    (document) => {
      const availability = (document.analysis as Record<string, Record<string, unknown>>).availability!;
      availability.registrant = { name: 'Private registrant' };
    },
    (document) => {
      const availability = (document.analysis as Record<string, Record<string, unknown>>).availability!;
      availability.structuredDataIdentity = {
        status: 'success',
        entities: [{
          types: ['Organization'],
          name: 'Example publisher',
          email: 'nested-private@example.test',
          owner: 'Private owner',
          value: 'https://example.test/path?session=private#fragment',
        }],
      };
    },
    (document) => {
      const availability = (document.analysis as Record<string, Record<string, unknown>>).availability!;
      delete availability.registryContactsExcluded;
    },
    (document) => {
      const insights = (document.analysis as Record<string, Record<string, unknown>>).registryInsights!;
      insights.abuseRouting = { email: 'abuse@example.test' };
    },
  ];
  for (const mutate of mutations) {
    const document = evidence();
    mutate(document);
    const serialized = JSON.stringify(document);
    await assert.rejects(
      () => parseLookupEvidenceReplay(serialized),
      /privacy-minimized publication boundary/iu,
    );
    await assert.rejects(
      () => verifyOfflineArtifact(serialized),
      /unsupported|malformed|portable|credential|URL/iu,
    );
  }
});

test('current replay retains reviewed credential-category counts at their exact model path', async () => {
  const document = evidence();
  const availability = (document.analysis as Record<string, Record<string, unknown>>).availability!;
  availability.credentialSurfaceProfile = {
    status: 'success',
    inputs: {
      categories: { password: 1, email: 1, username: 0, one_time_code: 0, payment: 0 },
    },
  };
  const replay = await parseLookupEvidenceReplay(JSON.stringify(document));
  assert.equal(replay.schemaVersion, LOOKUP_EVIDENCE_SCHEMA_VERSION);
});

test('current readers reject type-invalid and over-bound normalized registration facts', async () => {
  const rdapDocument = () => buildLookupEvidence({
    query: 'example.test', type: 'domain', inputHostname: 'example.test',
    registrableDomain: 'example.test',
    rdap: { parsed: { domain: 'example.test' } },
    diagnostics: {
      rdap: { status: 'success', fetchedAt: '2026-08-15T00:00:00.000Z' },
      whois: { status: 'skipped' },
    },
    availability: { applicable: true, state: 'registered', confidence: 'medium' },
  }, { generatedAt: '2026-08-15T00:00:00.000Z', applicationVersion: '1.47.4' });
  const whoisDocument = () => buildLookupEvidence({
    query: 'example.test', type: 'domain', inputHostname: 'example.test',
    registrableDomain: 'example.test',
    whois: { parsed: { domainName: 'example.test' }, chain: [] },
    diagnostics: {
      rdap: { status: 'unsupported' },
      whois: { status: 'complete', queriedAt: '2026-08-15T00:00:00.000Z' },
    },
    availability: { applicable: true, state: 'registered', confidence: 'medium' },
  }, { generatedAt: '2026-08-15T00:00:00.000Z', applicationVersion: '1.47.4' });
  const cases: Array<Readonly<{
    build: () => ReturnType<typeof buildLookupEvidence>;
    mutate: (parsed: Record<string, unknown>) => void;
  }>> = [
    { build: rdapDocument, mutate: (parsed) => { parsed.domain = 7; } },
    { build: rdapDocument, mutate: (parsed) => { parsed.handle = 'x'.repeat(301); } },
    { build: rdapDocument, mutate: (parsed) => { parsed.zoneSigned = 'yes'; } },
    { build: rdapDocument, mutate: (parsed) => { parsed.dnssec = 'invented'; } },
    { build: rdapDocument, mutate: (parsed) => { parsed.startAutnum = 4_294_967_296; } },
    { build: rdapDocument, mutate: (parsed) => { parsed.lifecycle = { createdDateIso: 'not-a-timestamp' }; } },
    { build: whoisDocument, mutate: (parsed) => { parsed.domainName = 42; } },
    { build: whoisDocument, mutate: (parsed) => { parsed.registrar = 'x'.repeat(301); } },
    { build: whoisDocument, mutate: (parsed) => { parsed.statusesTruncated = 'yes'; } },
    { build: whoisDocument, mutate: (parsed) => { parsed.chainStatus = 'invented'; } },
    { build: whoisDocument, mutate: (parsed) => { parsed.lifecycle = { createdDateIso: 'not-a-timestamp' }; } },
  ];
  for (const { build, mutate } of cases) {
    const document = build();
    const sources = document.sources as Record<string, Record<string, unknown>>;
    const positive = sources.rdap?.status === 'success' ? sources.rdap : sources.whois!;
    mutate(positive.parsed as Record<string, unknown>);
    rebuildCurrentRegistryDerivations(document as Record<string, unknown>);
    const serialized = JSON.stringify(document);
    await assert.rejects(
      () => parseLookupEvidenceReplay(serialized),
      /privacy-minimized publication boundary/iu,
    );
    await assert.rejects(
      () => verifyOfflineArtifact(serialized),
      /unsupported|malformed|portable/iu,
    );
  }
});

test('replay projects only exact current homepage metadata and rejects it from legacy schemas', async () => {
  const current = evidence();
  const availability = (current.analysis as Record<string, Record<string, unknown>>).availability!;
  (availability.pageIdentity as Record<string, unknown>).publicationMetadata = pagePublicationMetadataFixture();
  (availability.http as Record<string, unknown>).response = {
    deliveryMetadata: httpDeliveryMetadataFixture(),
  };
  const replay = await parseLookupEvidenceReplay(JSON.stringify(current));
  assert.equal(replay.pagePublicationMetadata?.rows.find((item) => item.id === 'publication.headings')?.value.includes('H1 1'), true);
  assert.equal(replay.httpDeliveryMetadata?.rows.find((item) => item.id === 'delivery.cache.max_age')?.value, '3600 seconds');
  assert.doesNotMatch(JSON.stringify(replay), /must-not-retain|private-header/iu);

  for (const fixture of [JSON.parse(await loadLookupEvidenceV26Fixture()) as Record<string, unknown>]) {
    const legacyAvailability = (fixture.analysis as Record<string, Record<string, unknown>>).availability!;
    legacyAvailability.pageIdentity = {
      ...((legacyAvailability.pageIdentity as Record<string, unknown> | undefined) ?? {}),
      publicationMetadata: pagePublicationMetadataFixture(),
    };
    await assert.rejects(
      () => parseLookupEvidenceReplay(JSON.stringify(fixture)),
      /Legacy Lookup evidence cannot contain homepage metadata/iu,
    );
  }

  ((availability.pageIdentity as Record<string, unknown>).publicationMetadata as Record<string, unknown>).version = 2;
  await assert.rejects(
    () => parseLookupEvidenceReplay(JSON.stringify(current)),
    /publication metadata is malformed or unsupported/iu,
  );
});

test('replay rejects current homepage metadata beneath unavailable parent sources', async () => {
  for (const family of ['page', 'http'] as const) {
    const withoutChild = evidence();
    const withoutAvailability = (withoutChild.analysis as Record<string, Record<string, unknown>>).availability!;
    (withoutAvailability[family === 'page' ? 'pageIdentity' : 'http'] as Record<string, unknown>).status = 'error';
    await assert.doesNotReject(() => parseLookupEvidenceReplay(JSON.stringify(withoutChild)));

    const withChild = evidence();
    const availability = (withChild.analysis as Record<string, Record<string, unknown>>).availability!;
    if (family === 'page') {
      const page = availability.pageIdentity as Record<string, unknown>;
      page.status = 'error';
      page.publicationMetadata = pagePublicationMetadataFixture();
    } else {
      const http = availability.http as Record<string, unknown>;
      http.status = 'error';
      http.response = { deliveryMetadata: httpDeliveryMetadataFixture() };
    }
    await assert.rejects(
      () => parseLookupEvidenceReplay(JSON.stringify(withChild)),
      /metadata contradicts its parent source state/iu,
    );
  }
});

test('replay verifies an explicitly supplied checksum and rejects a mismatch', async () => {
  const input = JSON.stringify(evidence());
  const calculated = await parseLookupEvidenceReplay(input);
  const verified = await parseLookupEvidenceReplay(input, {
    expectedSha256: calculated.digestSha256.toUpperCase(),
  });
  assert.equal(verified.digestVerified, true);
  await assert.rejects(
    () => parseLookupEvidenceReplay(input, { expectedSha256: '0'.repeat(64) }),
    /does not match/u,
  );
  await assert.rejects(
    () => parseLookupEvidenceReplay(input, { expectedSha256: 'invalid' }),
    /64 hexadecimal/u,
  );
});

test('replay preserves unavailable registry states and rejects diagnostic contradictions', async () => {
  const exported = buildLookupEvidence({
    query: 'example.test',
    type: 'domain',
    inputHostname: 'example.test',
    registrableDomain: 'example.test',
    diagnostics: {
      rdap: { status: 'unsupported' },
      whois: { status: 'skipped' },
    },
    availability: { applicable: true, state: 'unknown', confidence: 'low' },
  }, { generatedAt: '2026-07-31T00:00:00.000Z', applicationVersion: '1.47.1' });
  const replay = await parseLookupEvidenceReplay(JSON.stringify(exported));
  assert.ok(replay.sources.some((source) => source.id === 'rdap' && source.state === 'unsupported'));
  assert.ok(replay.sources.some((source) => source.id === 'whois' && source.state === 'skipped'));
  assert.ok(replay.unknowns.some((item) => item.startsWith('Registry RDAP: unsupported')));
  assert.ok(replay.unknowns.some((item) => item.startsWith('WHOIS: skipped')));

  const contradictory = structuredClone(exported);
  (contradictory.sources as Record<string, Record<string, unknown>>).rdap!.status = 'success';
  await assert.rejects(
    () => parseLookupEvidenceReplay(JSON.stringify(contradictory)),
    /source states contradict/iu,
  );
});

test('builder derives RDAP transport from its bounded endpoint and closes under both current readers', async () => {
  for (const [rdapServer, expectedTransport] of [
    [undefined, null],
    ['http://rdap.example.test/domain/example.test', 'http'],
  ] as const) {
    const exported = buildLookupEvidence({
      query: 'example.test',
      type: 'domain',
      inputHostname: 'example.test',
      registrableDomain: 'example.test',
      rdap: {
        ...(rdapServer ? { rdapServer } : {}),
        transportSecurity: 'https',
        parsed: { domain: 'example.test' },
      },
      diagnostics: {
        rdap: {
          status: 'success',
          transportSecurity: 'https',
          fetchedAt: '2026-08-15T00:00:00.000Z',
        },
        whois: { status: 'skipped' },
      },
      availability: { applicable: true, state: 'registered', confidence: 'medium' },
    }, { generatedAt: '2026-08-15T00:00:00.000Z', applicationVersion: '1.47.4' });
    assert.equal(exported.sources.rdap.transportSecurity, expectedTransport);
    assert.deepEqual(
      exported.sources.rdap,
      projectLookupEvidenceRdapSourcePublication(exported.sources.rdap),
    );
    assert.deepEqual(
      exported.sources.whois,
      projectLookupEvidenceWhoisSourcePublication(exported.sources.whois),
    );
    const serialized = JSON.stringify(exported);
    await assert.doesNotReject(() => parseLookupEvidenceReplay(serialized));
    const verification = await verifyOfflineArtifact(serialized);
    assert.equal(verification.state, 'structure_valid');
  }
});

test('replay attributes complete WHOIS domain and lifecycle facts without marking the source incomplete', async () => {
  const exported = buildLookupEvidence({
    query: 'example.test', type: 'domain', inputHostname: 'example.test',
    registrableDomain: 'example.test', isSubdomain: false,
    diagnostics: {
      rdap: { status: 'unsupported' },
      whois: { status: 'complete', queriedAt: '2026-07-31T00:00:00.000Z' },
      availability: { status: 'complete', resultState: 'registered' },
    },
    whois: {
      parsed: {
        domainName: 'EXAMPLE.TEST', registrar: 'Example Registrar',
        createdDateIso: '2020-01-01T00:00:00.000Z',
        expiryDateIso: '2030-01-01T00:00:00.000Z',
      },
      chain: [{ server: 'whois.example.test', queriedAt: '2026-07-31T00:00:00.000Z', response: 'bounded fixture' }],
    },
    availability: { applicable: true, state: 'registered', confidence: 'medium' },
  }, { generatedAt: '2026-07-31T00:00:00.000Z' });
  const replay = await parseLookupEvidenceReplay(JSON.stringify(exported));
  assert.ok(replay.facts.some((fact) => fact.id === 'registration.domain'
    && fact.value === 'EXAMPLE.TEST' && fact.sourceId === 'whois'));
  assert.ok(replay.facts.some((fact) => fact.id === 'registration.created'
    && fact.value === '2020-01-01T00:00:00.000Z' && fact.sourceId === 'whois'));
  assert.ok(replay.facts.some((fact) => fact.id === 'registration.expires'
    && fact.value === '2030-01-01T00:00:00.000Z' && fact.sourceId === 'whois'));
  assert.ok(!replay.unknowns.some((item) => item.startsWith('WHOIS:')));
});

test('replay never builds positive network relationships from an unavailable network source', async () => {
  const document = evidence();
  (document.sources as Record<string, unknown>).network = {
    contextVersion: 1, version: 1, status: 'unsupported', observedAt: null,
    scanMode: null, source: null, durationMs: null, complete: false, truncated: false,
    limitations: [], diagnostics: null, detail: 'Unavailable fixture',
    endpoint: { address: '192.0.2.10', family: 4, selectedFrom: 'dns_a' },
    rdap: null,
    network: { handle: null, name: 'Injected network', holder: null, cidrs: ['192.0.2.0/24'], startAddress: null, endAddress: null, country: null, networkType: null, databaseUpdatedAt: null },
  };
  const replay = await parseLookupEvidenceReplay(JSON.stringify(document));
  assert.ok(!replay.graph.nodes.some((node) => ['192.0.2.10', 'Injected network', '192.0.2.0/24'].includes(node.label)));
  assert.ok(!replay.graph.edges.some((edge) => ['observed-endpoint', 'registered-with', 'publishes-prefix'].includes(edge.kind)));
});

test('replay fails closed for foreign, future, malformed, and oversized documents', async () => {
  await assert.rejects(() => parseLookupEvidenceReplay('{'), /valid JSON/u);
  await assert.rejects(
    () => parseLookupEvidenceReplay(JSON.stringify(evidence()).replace(
      `"schemaVersion":${LOOKUP_EVIDENCE_SCHEMA_VERSION}`,
      `"nonFinite":1e400,"schemaVersion":${LOOKUP_EVIDENCE_SCHEMA_VERSION}`,
    )),
    /contains a non-finite number/u,
  );
  await assert.rejects(
    () => parseLookupEvidenceReplay(JSON.stringify(evidence({ schema: 'other' }))),
    /not a WHOISleuth/u,
  );
  await assert.rejects(
    () => parseLookupEvidenceReplay(JSON.stringify(evidence({ schemaVersion: LOOKUP_EVIDENCE_SCHEMA_VERSION + 1 }))),
    /Only Lookup evidence schema/u,
  );
  await assert.rejects(
    () => parseLookupEvidenceReplay('x'.repeat(LOOKUP_EVIDENCE_REPLAY_MAX_BYTES + 1)),
    /limited to 5 MB/u,
  );
  await assert.rejects(
    () => parseLookupEvidenceReplay(JSON.stringify(evidence({
      extra: Array.from({ length: LOOKUP_EVIDENCE_REPLAY_MAX_ENTRIES + 1 }, () => null),
    }))),
    /(?:over-bound array|20000-value limit|container with more than 10000 items)/u,
  );
  await assert.rejects(
    () => parseLookupEvidenceReplay(JSON.stringify(evidence({
      extra: Array.from({ length: LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS + 1 }, () => null),
    }))),
    /(?:over-bound array|container with more than 10000 items)/u,
  );
  await assert.rejects(
    () => parseLookupEvidenceReplay(JSON.stringify(evidence({
      extra: 'x'.repeat(LOOKUP_EVIDENCE_PORTABLE_MAX_STRING_LENGTH + 1),
    }))),
    /over-bound string/u,
  );
  await assert.rejects(
    () => parseLookupEvidenceReplay(JSON.stringify(evidence({
      extra: { ['x'.repeat(LOOKUP_EVIDENCE_PORTABLE_MAX_KEY_LENGTH + 1)]: true },
    }))),
    /(?:over-bound object|container with more than 10000 items)/u,
  );
  await assert.rejects(
    () => parseLookupEvidenceReplay(JSON.stringify(evidence({
      extra: Object.fromEntries(Array.from(
        { length: LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS + 1 },
        (_, index) => [`key-${index}`, null],
      )),
    }))),
    /(?:over-bound object|container with more than 10000 items)/u,
  );
  await assert.rejects(
    () => parseLookupEvidenceReplay(JSON.stringify(evidence({ extra: { 'unsafe\u0000key': true } }))),
    /over-bound object/u,
  );
});
