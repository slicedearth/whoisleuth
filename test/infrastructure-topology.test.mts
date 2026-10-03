import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectInfrastructureTopology } from '../frontend/src/lib/analysis/infrastructure-topology.ts';
import { MAX_FORCE_GRAPH_NODES, projectBoundedForceGraph } from '../frontend/src/lib/analysis/visualization-models.ts';
import { MAX_INVESTIGATION_SEARCH_RESULTS } from '../packages/investigation/investigation-search.mts';
import type { InvestigationInfrastructureRelationship, InvestigationInfrastructureRelationships } from '../packages/investigation/investigation-infrastructure.mts';

const AT = '2026-09-22T00:00:00.000Z';
function entity(id: string, canonical = `${id}.example`, type: InvestigationInfrastructureRelationship['from']['type'] = 'domain') {
  return { id, canonical, label: canonical, type };
}
function row(id: string, from = entity('host'), to = entity('address', '192.0.2.4', 'ip_address')): InvestigationInfrastructureRelationship {
  return {
    id, relationshipId: 'retained-relationship', type: 'domain_resolved_to_ip', classification: 'direct', method: 'Fixture exact address observation',
    from, to, sourceCount: 2, partial: false, limitations: [],
    source: { id: `source-${id}`, sourceStore: 'cases', recordId: `case-${id}`, source: 'Fixture source', observedAt: AT,
      kind: 'case_evidence', complete: true, truncated: false, limitations: [], href: `/cases?case=case-${id}&section=evidence`, action: 'Open retained Case' },
  };
}
function response(rows: InvestigationInfrastructureRelationship[], entityId = 'host'): InvestigationInfrastructureRelationships {
  return { state: 'ready', entityId, rows, relationshipCount: rows.length, total: rows.length, page: 1, pageCount: 1, partial: false, limitations: [] };
}

test('coinciding and opposite directed links retain independent source rows and types', () => {
  const first = row('first', entity('host'), entity('peer')), second = row('second', first.from, first.to), reverse = row('reverse', first.to, first.from);
  first.type = second.type = 'domain_aliases_to_domain';
  first.method = second.method = reverse.method = 'Fixture exact alias observation';
  second.partial = true; second.source!.complete = false;
  reverse.type = 'domain_aliases_to_domain'; reverse.classification = 'derived';
  const input = response([first, second, reverse]), before = structuredClone(input);
  const topology = projectInfrastructureTopology(input);
  const graph = projectBoundedForceGraph(topology.nodes, topology.links, { focusNodeId: topology.focusNodeId, layout: 'grouped' });
  assert.equal(graph.links.length, 3);
  assert.deepEqual(topology.rows.map(item => [item.id, item.source?.id, item.type, item.classification]), [
    ['first', 'source-first', 'domain_aliases_to_domain', 'direct'], ['second', 'source-second', 'domain_aliases_to_domain', 'direct'], ['reverse', 'source-reverse', 'domain_aliases_to_domain', 'derived'],
  ]);
  assert.equal(graph.links[0]!.sourceId, graph.links[1]!.sourceId);
  assert.equal(graph.links[0]!.targetId, graph.links[1]!.targetId);
  assert.equal(graph.links[2]!.sourceId, graph.links[0]!.targetId);
  assert.equal(graph.links[2]!.targetId, graph.links[0]!.sourceId);
  assert.deepEqual(graph.links.map(link => link.kind), ['observed', 'partial', 'derived']);
  assert.deepEqual(input, before);
});

test('long same-prefix exact IDs and names have distinct visual aliases and visible references', () => {
  const prefix = 'x'.repeat(90), name = `${'a'.repeat(63)}.branch.`;
  const left = entity(`${prefix}left`, `${name}one.example`), right = entity(`${prefix}right`, `${name}two.example`);
  const input = response([row(`${prefix}first`, left), row(`${prefix}second`, right)], left.id);
  const topology = projectInfrastructureTopology(input);
  const graph = projectBoundedForceGraph(topology.nodes, topology.links, { layout: 'grouped', focusNodeId: topology.focusNodeId });
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.links.length, 2);
  assert.equal(new Set(graph.nodes.map(node => node.id)).size, 3);
  assert.equal(new Set(graph.nodes.map(node => node.label)).size, 3);
  assert.deepEqual(topology.entities.map(item => item.id).sort(), [left.id, right.id, 'address'].sort());
  for (const identity of [left, right]) {
    const item = topology.entities.find(candidate => candidate.id === identity.id)!;
    assert.equal(item.canonical, identity.canonical);
    assert.ok(graph.nodes.find(node => node.id === topology.aliases.get(item.id))!.label.includes(`[${item.diagramReference}]`));
  }
});

test('diagram search and focus never filter, merge or mutate the exact current-page list', () => {
  const first = row('first'), second = row('second', entity('other'));
  second.source!.source = 'Independent imported source'; second.source!.observedAt = '2026-09-23T00:00:00.000Z';
  const input = response([first, second], 'address'), before = structuredClone(input);
  const topology = projectInfrastructureTopology(input, 'imported', 'other');
  assert.deepEqual(topology.rows.map(item => item.id), ['second']);
  assert.equal(topology.focusEntity?.id, 'other');
  assert.equal(topology.focusNodeId, topology.aliases.get('other'));
  assert.equal(topology.rows[0]!.source?.observedAt, '2026-09-23T00:00:00.000Z');
  assert.deepEqual(projectInfrastructureTopology(input, 'no diagram match').rows, []);
  assert.equal(projectInfrastructureTopology(input, '', 'missing').focusEntity?.id, 'address');
  assert.deepEqual(input, before);
});

test('missing sources, namespace grouping and recorded origins do not invent connections or routing claims', () => {
  const origin = row('origin', entity('host'), entity('http', 'https://edge.example', 'http_origin'));
  origin.type = 'domain_reached_http_origin'; origin.source = null; origin.partial = true;
  const documented = row('documented', entity('case', 'case-one', 'case'), entity('host'));
  documented.type = 'case_documents_domain'; documented.classification = 'normalized';
  const topology = projectInfrastructureTopology(response([origin, documented]));
  assert.deepEqual(topology.links.map(link => link.kind), ['unknown', 'observed']);
  assert.equal(topology.links.length, 2);
  assert.equal(topology.rows[0]!.source, null);
  assert.equal(topology.rows[0]!.to.canonical, 'https://edge.example');
  assert.ok(topology.nodes.some(node => node.group === 'http_origin'));
  assert.doesNotMatch(JSON.stringify(topology), /routingAsn|routingOrigin|providerRole|dnsChain/u);
});

test('current source-page and inherited visual caps are explicit without dropping exact source rows', () => {
  const input = response(Array.from({ length: MAX_INVESTIGATION_SEARCH_RESULTS + 1 }, (_, index) => row(`row-${index}`, entity(`host-${index}`))), 'address');
  input.page = 2; input.pageCount = 3; input.total = 123; input.partial = true;
  const topology = projectInfrastructureTopology(input);
  const graph = projectBoundedForceGraph(topology.nodes, topology.links, { layout: 'grouped', focusNodeId: topology.focusNodeId });
  assert.equal(topology.rows.length, MAX_INVESTIGATION_SEARCH_RESULTS);
  assert.equal(topology.diagramEntities.length, MAX_FORCE_GRAPH_NODES);
  assert.equal(graph.nodes.length, MAX_FORCE_GRAPH_NODES);
  assert.equal(graph.omittedNodeInputs, 3);
  assert.equal(graph.omittedLinkInputs, 3);
  assert.equal(graph.truncated, true);
  assert.equal(input.rows.length, MAX_INVESTIGATION_SEARCH_RESULTS + 1);
  assert.equal(input.total, 123);
  assert.equal(input.page, 2);
});

test('grouped layout is deterministic, finite and does not alter the existing force layout default', () => {
  const topology = projectInfrastructureTopology(response(Array.from({ length: 12 }, (_, index) => row(`row-${index}`, entity(`host-${index}`))), 'address'));
  const options = { layout: 'grouped' as const, focusNodeId: topology.focusNodeId };
  const first = projectBoundedForceGraph(topology.nodes, topology.links, options);
  const reordered = projectBoundedForceGraph([...topology.nodes].reverse(), [...topology.links].reverse(), options);
  assert.deepEqual(first, reordered);
  assert.ok(first.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y) && node.x > 0 && node.x < first.width && node.y > 0 && node.y < first.height));
  assert.equal(new Set(first.nodes.filter(node => node.id !== topology.focusNodeId).map(node => `${node.x}:${node.y}`)).size, 12);
  assert.deepEqual(projectBoundedForceGraph(topology.nodes, topology.links), projectBoundedForceGraph(topology.nodes, topology.links, { layout: 'force' }));
});

test('unavailable response does not become an empty successful topology', () => {
  const input = response([row('first')]); input.state = 'unavailable';
  const topology = projectInfrastructureTopology(input);
  assert.deepEqual(topology.rows, []);
  assert.deepEqual(topology.nodes, []);
  assert.equal(topology.focusEntity, null);
});

test('dense single-group and mixed-group layouts retain readable non-overlapping label geometry', () => {
  for (const mixed of [false, true]) {
    const nodes = Array.from({ length: MAX_FORCE_GRAPH_NODES }, (_, index) => ({
      id: `node-${String(index).padStart(2, '0')}`, label: `${'a'.repeat(55)} [${index + 1}]`,
      kind: index ? 'relationship' : 'target', group: mixed ? `group-${index % 4}` : 'domain',
    }));
    const links = nodes.slice(1).map(node => ({ id: `link-${node.id}`, source: nodes[0]!.id, target: node.id }));
    const graph = projectBoundedForceGraph(nodes, links, { layout: 'grouped', focusNodeId: nodes[0]!.id });
    const boxes = graph.nodes.map(node => ({
      id: node.id, left: node.x - node.labelWidth / 2, right: node.x + node.labelWidth / 2,
      top: node.y - (node.kind === 'target' ? (node.labelLines.length * 17 + 17) / 2 : 22),
      bottom: node.y + (node.kind === 'target' ? (node.labelLines.length * 17 + 17) / 2 : 33 + node.labelLines.length * 17),
    }));
    assert.equal(graph.nodes.length, MAX_FORCE_GRAPH_NODES);
    assert.equal(graph.links.length, MAX_FORCE_GRAPH_NODES - 1);
    assert.equal(graph.width, 900);
    for (const box of boxes) {
      assert.ok(box.left >= 0 && box.right <= graph.width && box.top >= 0 && box.bottom <= graph.height);
      for (const other of boxes) if (box.id !== other.id) assert.ok(
        box.right <= other.left || other.right <= box.left || box.bottom <= other.top || other.bottom <= box.top,
        `label geometry overlaps: ${box.id} and ${other.id}`,
      );
    }
    // A full single namespace uses five columns at the existing label bound,
    // rather than stretching three columns into a needlessly tall diagram.
    if (!mixed) assert.equal(new Set(graph.nodes.slice(1).map(node => node.x)).size, 5);
  }
});
