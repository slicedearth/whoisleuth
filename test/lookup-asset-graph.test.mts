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
    tlsEvidence: { status: 'success', complete: true, observedAt: '2026-07-31T00:00:04.000Z' },
    tlsCertificate: { fingerprintSha256: 'a'.repeat(64) },
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
  });
}

test('asset graph keeps separately attributed typed relationships', () => {
  const graph = fixture();
  assert.equal(graph.version, 1);
  assert.equal(graph.truncated, false);
  assert.ok(graph.nodes.some((node) => node.kind === 'target' && node.label === 'example.test'));
  assert.ok(graph.edges.some((edge) => edge.kind === 'resolves-to' && edge.sourceLabel === 'DNS'));
  assert.ok(graph.edges.some((edge) => edge.kind === 'registered-with' && edge.sourceLabel === 'IP RDAP'));
  assert.ok(graph.edges.some((edge) => edge.kind === 'form-destination'));
  assert.ok(graph.edges.some((edge) => edge.kind === 'uses-key'));
  assert.ok(graph.edges.every((edge) => edge.observedAt !== null));
});

test('graph lenses reuse one model without cross-contaminating evidence classes', () => {
  const graph = fixture();
  const identity = projectLookupAssetGraph(graph, 'identity');
  const delegation = projectLookupAssetGraph(graph, 'delegation');
  const certificate = projectLookupAssetGraph(graph, 'certificate');

  assert.ok(identity.edges.some((edge) => edge.kind === 'form-destination'));
  assert.ok(identity.edges.every((edge) => edge.lenses.includes('identity')));
  assert.ok(delegation.edges.some((edge) => edge.kind === 'registry-publishes'));
  assert.ok(delegation.edges.some((edge) => edge.completeness === 'partial'));
  assert.ok(certificate.edges.some((edge) => edge.kind === 'authorizes-name'));
  assert.ok(certificate.edges.some((edge) => edge.kind === 'issued-by'));
  assert.ok(certificate.edges.some((edge) => edge.kind === 'reviewed-against-policy'));
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
