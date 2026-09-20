import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLookupAssetGraph, projectLookupAssetGraph } from '../packages/investigation/lookup-asset-graph.mts';
import { createGraphInputReader } from '../packages/investigation/lookup-asset-graph-inputs.mts';
import { MAX_PROFILE_VALUES } from '../packages/contracts/workspace-portability.mts';
import { MAX_LOOKUP_ASSET_EDGES, MAX_LOOKUP_ASSET_INPUT_ROWS, MAX_LOOKUP_ASSET_NODES } from '../packages/contracts/investigation-portability.mts';
import { parseLookupHttpResponse, createLookupViewModel } from '../lib/lookup-response-contract.mts';
import { lookupGraphCapacityFixture } from './lookup-graph-capacity-fixture.mts';

test('the graph retains every relationship from full admitted source cohorts', () => {
  const response = lookupGraphCapacityFixture();
  const parsed = parseLookupHttpResponse(response);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) assert.fail('The complete source fixture must pass the response boundary.');
  const view = createLookupViewModel(parsed.value);
  for (const [value, count] of [[view.tlsAltNames.dnsNames, 50], [view.pageResources.externalOrigins, 30], [view.structuredDataIdentity.entities, 16]] as const) {
    assert.ok(Array.isArray(value));
    assert.equal(value.length, count);
  }
  const graph = buildLookupAssetGraph({ ...view, rdapEvidence: view.rdap, target: 'example.test' });
  for (const [kind, count] of [['authorizes-name', 50], ['loads-from', 30], ['declares-tracker', 30], ['declares-publisher', 16], ['declares-same-as', 192], ['routes-mail-to', 16], ['issuer-common-name', 1]] as const) {
    assert.equal(graph.edges.filter(edge => edge.kind === kind).length, count, kind);
  }
  assert.equal(graph.truncated, false);
  assert.ok(graph.edges.length > 400);
  assert.equal(projectLookupAssetGraph(graph, 'all').edges.length, graph.edges.length);
  assert.ok(graph.edges.every(edge => graph.nodes.some(node => node.id === edge.target)));
});

test('source inputs count invalid, duplicate, admitted and uninspected values independently', () => {
  const reader = createGraphInputReader();
  const result = reader.values('fixture', ['a', 'a', 3, 'b', 'c', 'd', 'e', 'f', 'g'], 2,
    value => typeof value === 'string' ? value : null, value => value);
  assert.deepEqual(result, ['a', 'b']);
  assert.deepEqual(reader.coverage.get('fixture'), { id: 'fixture', supplied: 9, inspected: 8, admitted: 2, invalid: 1, duplicates: 1, omitted: 4 });
});

test('profile membership reaches the canonical final value and incomplete scope stays unresolved', () => {
  const input = { target: 'example.test', pageResources: { externalOrigins: ['https://last.example'] }, profileDomains: { official: Array.from({ length: MAX_PROFILE_VALUES - 1 }, (_, i) => `scope${i}.example`).concat('last.example') } };
  assert.equal(buildLookupAssetGraph(input).edges[0]?.boundary, 'reviewed_profile');
  const incomplete = buildLookupAssetGraph({ ...input, profileDomains: { official: ['not a hostname'] } });
  assert.equal(incomplete.edges[0]?.boundary, 'unresolved');
  assert.equal(incomplete.truncated, true);
});

test('graph timestamps never borrow a global lookup or export time', () => {
  const graph = buildLookupAssetGraph({ target: 'example.test', observedAt: '2026-09-05T00:00:00Z',
    dnsEvidence: { observedAt: '2026-09-01T10:30:00' }, dnsRecords: { a: ['192.0.2.1'] },
    rdapEvidence: { fetchedAt: '2026-09-02T11:00:00+10:00' }, rdapParsed: { registrar: 'Example Registrar' },
    pageIdentity: { observedAt: '2026-02-30T00:00:00Z' }, pageResources: { externalOrigins: ['https://resource.example/path?private=value'] },
    tlsEvidence: {}, tlsCertificate: { fingerprintSha256: 'a'.repeat(64) },
  });
  assert.equal(graph.edges.find(edge => edge.kind === 'registered-via')?.observedAt, '2026-09-02T01:00:00.000Z');
  for (const kind of ['resolves-to', 'loads-from', 'presents-certificate']) assert.equal(graph.edges.find(edge => edge.kind === kind)?.observedAt, null);
  assert.equal(JSON.stringify(graph).includes('private=value'), false);
});

test('mandatory qualifications survive full source limitation lists and report excess entries', () => {
  const upstream = Array.from({ length: 10 }, (_, i) => `Source limitation ${i}`);
  const graph = buildLookupAssetGraph({ target: 'example.test', structuredDataIdentity: { complete: true, limitations: upstream, entities: [{ name: 'Example', sameAsHosts: ['identity.example'] }] } });
  for (const edge of graph.edges) {
    assert.ok(upstream.every(item => edge.limitations.includes(item)));
    assert.ok(edge.limitations.some(item => item.includes('not independent identity verification')));
    assert.ok(edge.limitations.some(item => item.includes('does not establish ownership')));
  }
  assert.equal(graph.truncated, false);
  const excessive = buildLookupAssetGraph({ target: 'example.test', structuredDataIdentity: { limitations: Array.from({ length: 100 }, (_, i) => `Source limitation ${i}`), entities: [{ name: 'Example' }] } });
  assert.equal(excessive.truncated, true);
  assert.ok(excessive.edges[0]?.limitations.some(item => item.includes('additional source limitation entries')));
});

test('direct maximum nested projection inputs retain more than the former final cutoffs', () => {
  const graph = buildLookupAssetGraph({ target: 'example.test', dnsEvidence: { delegation: {
    authorities: Array.from({ length: 32 }, (_, i) => ({ nameserver: `ns${i}.example`, state: 'success', addressSource: `source${i}`, addresses: Array.from({ length: 64 }, (_, j) => `2001:db8:${i}::${j}`) })),
  } }, structuredDataIdentity: { entities: Array.from({ length: 32 }, (_, i) => ({ name: `Publisher ${i}`, sameAsHosts: Array.from({ length: 32 }, (_, j) => `identity${i}-${j}.example`) })) } });
  assert.equal(graph.truncated, false);
  assert.equal(graph.edges.filter(edge => edge.kind === 'nameserver-address').length, 2048);
  assert.equal(graph.edges.filter(edge => edge.kind === 'declares-same-as').length, 1024);
  assert.ok(graph.nodes.length > 1024 && graph.nodes.length < MAX_LOOKUP_ASSET_NODES);
  assert.ok(graph.edges.length > 1536 && graph.edges.length < MAX_LOOKUP_ASSET_EDGES);
  assert.ok(graph.coverage.inputs.length < MAX_LOOKUP_ASSET_INPUT_ROWS);
});
