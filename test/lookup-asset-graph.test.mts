import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLookupAssetGraph,
  countLookupAssetGraphEdgesByLens,
  projectLookupAssetGraph,
} from '../frontend/src/lib/analysis/lookup-asset-graph.ts';
import { buildTlsObservation } from '../lib/tls-intelligence.mts';

function fixture() {
  return buildLookupAssetGraph({
    target: 'example.test',
    observedAt: '2026-07-31T00:00:00.000Z',
    dnsEvidence: {
      status: 'success',
      complete: true,
      observedAt: '2026-07-31T00:00:01.000Z',
      records: {},
      delegation: {
        status: 'partial',
        complete: false,
        registry: { nameservers: ['ns1.example.test'] },
        parent: { nameservers: ['ns1.example.test', 'ns2.example.test'] },
        authorities: [{
          nameserver: 'ns1.example.test',
          state: 'success',
          addressSource: 'registry_glue',
          addresses: ['192.0.2.53'],
        }],
        limitations: ['One delegated nameserver did not return complete direct evidence.'],
      },
    },
    dnsRecords: {
      a: ['192.0.2.10'],
      cname: [],
      ns: ['ns1.example.test'],
      mx: [{ exchange: 'mail.example.test', priority: 10 }],
      https: [{ target: 'edge.example.test', priority: 1 }],
    },
    observedNetworkContext: {
      status: 'success',
      complete: true,
      observedAt: '2026-07-31T00:00:02.000Z',
      limitations: ['The endpoint can represent shared delivery infrastructure.'],
    },
    observedNetworkEndpoint: { address: '192.0.2.10', selectedFrom: 'tls_connection' },
    observedNetwork: { name: 'Example network', cidrs: ['192.0.2.0/24'] },
    rdapEvidence: { status: 'success', complete: true },
    rdapParsed: { registrar: { name: 'Example Registrar' } },
    httpEvidence: {
      status: 'success',
      complete: true,
      finalUrl: 'https://www.example.test/',
      observedAt: '2026-07-31T00:00:03.000Z',
    },
    pageCanonical: { url: 'https://example.test/' },
    pageOpenGraphUrl: { url: 'https://identity.example/' },
    pageForms: { externalActionOrigins: ['https://forms.example/'] },
    pageResources: { externalOrigins: ['https://assets.example/'] },
    pageIdentity: {
      status: 'success',
      complete: true,
      trackingIdentifiers: [{ type: 'tag-container', value: 'TAG-1234' }],
    },
    structuredDataIdentity: {
      status: 'success',
      complete: true,
      entities: [{
        types: ['Organization'],
        name: 'Example Publisher',
        declaredOrigin: 'https://publisher.example/',
        sameAsHosts: ['profile.example'],
      }],
    },
    tlsEvidence: { status: 'success', complete: true, observedAt: '2026-07-31T00:00:04.000Z' },
    tlsCertificate: {
      fingerprintSha256: 'a'.repeat(64),
      validFrom: '2026-07-01T00:00:00.000Z',
      validTo: '2026-10-01T00:00:00.000Z',
    },
    tlsAuthorization: { authorized: true, error: null },
    tlsHostname: { matches: true, error: null },
    tlsAltNames: { dnsNames: ['example.test', '*.example.test'] },
    tlsPublicKey: { type: 'rsa', bits: 2048, fingerprintSha256: 'b'.repeat(64) },
    tlsIssuer: { organizations: ['Example Certificate Authority'], commonNames: ['Example issuing CA'] },
    certificatePolicyReview: {
      observedAt: '2026-07-31T00:00:04.000Z',
      findings: [{
        id: 'caa',
        label: 'Current CAA and observed issuer',
        state: 'indeterminate',
        limitations: ['Parent policy was not collected.'],
      }],
    },
    profileDomains: {
      official: ['example.test'],
      partner: ['identity.example'],
      allowlisted: ['profile.example'],
    },
  });
}

test('asset graph keeps separately attributed typed relationships', () => {
  const graph = fixture();
  assert.equal(graph.version, 2);
  assert.equal(graph.truncated, false);
  assert.ok(graph.nodes.some((node) => node.kind === 'target' && node.label === 'example.test'));
  assert.ok(graph.edges.some((edge) => edge.kind === 'resolves-to' && edge.sourceLabel === 'DNS'));
  assert.ok(graph.edges.some((edge) => edge.kind === 'registered-with' && edge.sourceLabel === 'IP RDAP'));
  assert.ok(graph.nodes.some((node) => node.kind === 'prefix' && node.label === '192.0.2.0/24'));
  assert.ok(graph.nodes.some((node) => node.kind === 'registrar' && node.label === 'Example Registrar'));
  assert.ok(graph.edges.some((edge) => edge.kind === 'form-destination'));
  assert.ok(graph.edges.some((edge) => edge.kind === 'declares-publisher'));
  assert.ok(graph.edges.some((edge) => edge.kind === 'declares-same-as'));
  assert.ok(graph.edges.some((edge) => edge.kind === 'declares-open-graph' && edge.boundary === 'reviewed_profile'));
  assert.ok(graph.edges.some((edge) => edge.kind === 'form-destination' && edge.boundary === 'external'));
  assert.ok(graph.edges.some((edge) => edge.kind === 'uses-key'));
  assert.ok(graph.edges.some((edge) => edge.kind === 'reviewed-hostname-match'));
  assert.ok(graph.edges.some((edge) => edge.kind === 'reviewed-runtime-trust'));
  assert.match(
    graph.nodes.find((node) => node.kind === 'certificate')?.detail ?? '',
    /Valid from 2026-07-01T00:00:00\.000Z · Valid to 2026-10-01T00:00:00\.000Z/u,
  );
  assert.ok(graph.edges.every((edge) => edge.observedAt !== null));
  assert.ok(graph.edges.every((edge) => graph.sources.some((source) => source.id === edge.sourceId)));
  assert.ok(graph.sources.some((source) => source.label === 'DNS' && source.href === '#evidence-dns'));
});

test('graph lenses reuse one model without cross-contaminating evidence classes', () => {
  const graph = fixture();
  const counts = countLookupAssetGraphEdgesByLens(graph);
  const identity = projectLookupAssetGraph(graph, 'identity');
  const delegation = projectLookupAssetGraph(graph, 'delegation');
  const certificate = projectLookupAssetGraph(graph, 'certificate');

  assert.deepEqual(counts, {
    all: graph.edges.length,
    identity: identity.edges.length,
    delegation: delegation.edges.length,
    certificate: certificate.edges.length,
  });
  assert.ok(identity.edges.some((edge) => edge.kind === 'form-destination'));
  assert.ok(identity.edges.some((edge) => edge.kind === 'authorizes-name' && edge.boundary === 'same_registrable_domain'));
  assert.ok(identity.edges.every((edge) => edge.lenses.includes('identity')));
  assert.ok(delegation.edges.some((edge) => edge.kind === 'registry-publishes'));
  assert.ok(delegation.edges.some((edge) => edge.completeness === 'partial'));
  assert.ok(certificate.edges.some((edge) => edge.kind === 'authorizes-name'));
  assert.ok(certificate.edges.some((edge) => edge.kind === 'issued-by'));
  assert.ok(certificate.edges.some((edge) => edge.kind === 'reviewed-hostname-match'));
  assert.ok(certificate.edges.some((edge) => edge.kind === 'reviewed-runtime-trust'));
  assert.ok(certificate.edges.some((edge) => edge.kind === 'reviewed-against-policy'));
  assert.equal(identity.nodes.find((node) => node.label === 'https://identity.example')?.group, 'identity');
  assert.equal(delegation.nodes.find((node) => node.label === 'ns1.example.test')?.group, 'dns');
  assert.equal(certificate.nodes.find((node) => node.label === '*.example.test')?.group, 'certificate');
});

test('origin relationships preserve scheme and effective port before classifying trust', () => {
  const graph = buildLookupAssetGraph({
    target: 'example.test',
    observedAt: '2026-07-31T00:00:00.000Z',
    httpEvidence: {
      status: 'success',
      complete: true,
      finalUrl: 'https://example.test/path',
      observedAt: '2026-07-31T00:00:01.000Z',
    },
    pageIdentity: { status: 'success', complete: true },
    pageCanonical: { url: 'https://example.test:443/canonical' },
    pageForms: { externalActionOrigins: ['http://example.test', 'https://example.test:8443'] },
    pageResources: { externalOrigins: ['http://example.test', 'https://example.test:8443'] },
  });
  const identity = projectLookupAssetGraph(graph, 'identity');
  const formEdges = graph.edges.filter((edge) => edge.kind === 'form-destination');
  const resourceEdges = graph.edges.filter((edge) => edge.kind === 'loads-from');

  assert.equal(graph.edges.find((edge) => edge.kind === 'redirects-to')?.boundary, 'same_registrable_domain');
  assert.equal(graph.edges.find((edge) => edge.kind === 'declares-canonical')?.boundary, 'same_origin');
  assert.equal(formEdges.length, 2);
  assert.equal(resourceEdges.length, 2);
  assert.ok([...formEdges, ...resourceEdges].every((edge) => edge.boundary === 'same_registrable_domain'));
  assert.deepEqual(
    graph.nodes.filter((node) => node.kind === 'origin').map((node) => node.label).sort(),
    ['http://example.test', 'https://example.test', 'https://example.test:8443'],
  );
  assert.equal(identity.edges.filter((edge) => edge.kind === 'form-destination').length, 2);
  assert.equal(identity.edges.filter((edge) => edge.kind === 'loads-from').length, 2);
});

test('asset graph reads the ordered issuer names emitted by the TLS normaliser', () => {
  const tls = buildTlsObservation({
    connectedAddress: '93.184.216.34',
    sniHost: 'example.test',
    protocol: 'TLSv1.3',
    cipher: { name: 'TLS_AES_256_GCM_SHA384', standardName: 'TLS_AES_256_GCM_SHA384', version: 'TLSv1.3' },
    authorized: true,
    hostnameMatches: true,
    peerCertificate: {
      subject: { CN: 'example.test' },
      issuer: { O: ['Primary Example CA', 'Secondary Example CA'], CN: 'Example issuing CA' },
      serialNumber: '01',
      valid_from: 'Jul  1 00:00:00 2026 GMT',
      valid_to: 'Aug  1 00:00:00 2026 GMT',
      fingerprint256: Array.from({ length: 32 }, () => 'AA').join(':'),
      bits: 2048,
      ca: false,
    },
  }, {
    observedAt: '2026-07-31T00:00:00.000Z',
    now: new Date('2026-07-31T00:00:00.000Z'),
  });
  assert.deepEqual(tls.certificate?.issuer.organizations, ['Primary Example CA', 'Secondary Example CA']);
  const graph = buildLookupAssetGraph({
    target: 'example.test',
    observedAt: tls.observedAt,
    tlsEvidence: tls,
    tlsCertificate: tls.certificate,
    tlsIssuer: tls.certificate?.issuer,
  });
  const issuedBy = graph.edges.find((edge) => edge.kind === 'issued-by');
  assert.ok(issuedBy);
  assert.equal(graph.nodes.find((node) => node.id === issuedBy.target)?.label, 'Primary Example CA');
  assert.equal(issuedBy.sourceLabel, 'TLS certificate');
  assert.ok(projectLookupAssetGraph(graph, 'certificate').edges.some((edge) => edge.id === issuedBy.id));
});

test('asset graph bounds hostile or excessive collections', () => {
  const graph = buildLookupAssetGraph({
    target: 'example.test',
    dnsEvidence: { status: 'success', complete: true },
    dnsRecords: {
      a: Array.from({ length: 200 }, (_, index) => `192.0.2.${index}`),
      ns: Array.from({ length: 200 }, (_, index) => `ns${index}.example.test`),
    },
    pageResources: {
      externalOrigins: Array.from({ length: 200 }, (_, index) => `https://asset-${index}.example/`),
    },
  });
  assert.ok(graph.nodes.length <= 72);
  assert.ok(graph.edges.length <= 120);
  assert.equal(graph.nodes.some((node) => node.label.includes('\u0000')), false);
});

test('asset graph collapses high-degree visual branches without dropping accessible edges', () => {
  const graph = buildLookupAssetGraph({
    target: 'example.test',
    dnsEvidence: { status: 'success', complete: true },
    dnsRecords: {
      a: Array.from({ length: 16 }, (_, index) => `192.0.2.${index + 1}`),
    },
  });
  const projection = projectLookupAssetGraph(graph, 'all');
  assert.equal(projection.edges.length, 16);
  assert.equal(projection.collapsedGroups.length, 1);
  assert.equal(projection.collapsedGroups[0]?.hubId, graph.targetId);
  assert.equal(projection.collapsedGroups[0]?.omittedEdges, 6);
  assert.ok(projection.nodes.some((node) => node.id === `collapsed-${graph.targetId}`));
  assert.equal(
    projection.links.find((link) => String(link.id).startsWith('collapsed-link-'))?.kind,
    'summary',
  );
  assert.equal(
    projection.links.filter((link) => !String(link.id).startsWith('collapsed-link-')).length,
    10,
  );
});

test('high-degree visual branches retain representative evidence families', () => {
  const graph = buildLookupAssetGraph({
    target: 'example.test',
    observedAt: '2026-08-01T00:00:00.000Z',
    dnsEvidence: { status: 'success', complete: true },
    dnsRecords: {
      a: Array.from({ length: 16 }, (_, index) => `192.0.2.${index + 1}`),
      ns: ['ns1.example.test'],
    },
    rdapEvidence: { status: 'success', complete: true },
    rdapParsed: { registrar: { name: 'Example Registrar' } },
    httpEvidence: {
      status: 'success',
      complete: true,
      finalUrl: 'https://www.example.test/',
    },
    pageOpenGraphUrl: { url: 'https://identity.example/' },
    tlsEvidence: { status: 'success', complete: true },
    tlsCertificate: { fingerprintSha256: 'a'.repeat(64) },
  });
  const projection = projectLookupAssetGraph(graph, 'all');
  const representedGroups = new Set(projection.nodes.map((node) => node.group));

  assert.deepEqual(
    [...representedGroups].filter((group) => group !== 'focus' && group !== 'summary').sort(),
    ['certificate', 'dns', 'identity', 'network', 'registration'],
  );
  assert.equal(projection.edges.length, graph.edges.length);
  assert.ok(projection.collapsedGroups.some((group) => group.hubId === graph.targetId));
});

test('visual links keep partial and unknown evidence distinct from derived analysis', () => {
  const graph = fixture();
  const projection = projectLookupAssetGraph(graph, 'all');
  const partialIds = new Set(graph.edges
    .filter((edge) => edge.completeness === 'partial')
    .map((edge) => edge.id));
  const unknownIds = new Set(graph.edges
    .filter((edge) => edge.completeness === 'unknown')
    .map((edge) => edge.id));

  assert.ok(partialIds.size > 0);
  assert.ok(projection.links.some((link) => partialIds.has(link.id) && link.kind === 'partial'));
  assert.ok(projection.links.every((link) => !unknownIds.has(link.id) || link.kind === 'unknown'));
  assert.equal(projection.links.some((link) => link.kind === 'derived'), false);
});
