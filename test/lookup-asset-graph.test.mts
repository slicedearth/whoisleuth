import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLookupAssetGraph,
  projectLookupAssetGraph,
} from '../frontend/src/lib/analysis/lookup-asset-graph.ts';

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
    tlsIssuer: { organization: 'Example Certificate Authority' },
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
  assert.equal(graph.version, 1);
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
});

test('graph lenses reuse one model without cross-contaminating evidence classes', () => {
  const graph = fixture();
  const identity = projectLookupAssetGraph(graph, 'identity');
  const delegation = projectLookupAssetGraph(graph, 'delegation');
  const certificate = projectLookupAssetGraph(graph, 'certificate');

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
  assert.equal(identity.nodes.find((node) => node.label === 'identity.example')?.group, 'identity');
  assert.equal(delegation.nodes.find((node) => node.label === 'ns1.example.test')?.group, 'dns');
  assert.equal(certificate.nodes.find((node) => node.label === '*.example.test')?.group, 'certificate');
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
