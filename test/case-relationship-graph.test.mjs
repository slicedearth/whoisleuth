import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildCaseRelationshipGraph,
  CASE_RELATIONSHIP_GRAPH_VIEW_VERSION,
  CASE_RELATIONSHIP_GRAPH_VERSION,
  MAX_RELATIONSHIP_GRAPH_CASES,
  MAX_RELATIONSHIP_GRAPH_EDGES,
  MAX_RELATIONSHIP_GRAPH_GROUP_CASES,
  MAX_RELATIONSHIP_GRAPH_HIDDEN,
  MAX_RELATIONSHIP_GRAPH_PINS,
  MAX_RELATIONSHIP_GRAPH_RELATIONSHIPS,
  projectCaseRelationshipGraph,
} from '../frontend/src/lib/analysis/case-relationship-graph.js';
import { buildCaseRelationships } from '../frontend/src/lib/analysis/case-relationships.js';

const CAPTURED = '2026-07-14T00:00:00.000Z';
const snapshot = (overrides = {}) => ({ capturedAt: CAPTURED, scanDepth: 'deep', availability: 'registered', nameservers: [], ...overrides });
const caseRecord = (id, domain, evidence) => ({ id, domain, evidenceHistory: [evidence] });

function fixture() {
  const http = { httpSummaryVersion: 1, httpEvidenceStatus: 'success', httpFinalOrigin: 'https://shared.invalid', httpResponseStatus: 200 };
  return [
    caseRecord('alpha', 'alpha.invalid', snapshot({ nameservers: ['ns.shared.invalid'], ...http })),
    caseRecord('bravo', 'bravo.invalid', snapshot({ nameservers: ['ns.shared.invalid'], ...http })),
  ];
}

describe('case relationship graph projection', () => {
  test('returns a stable empty contract for invalid input', () => {
    const graph = buildCaseRelationshipGraph(null);
    assert.equal(graph.version, CASE_RELATIONSHIP_GRAPH_VERSION);
    assert.equal(graph.version, 2);
    assert.deepEqual(graph.nodes, []);
    assert.deepEqual(graph.edges, []);
    assert.equal(graph.totalRelationships, 0);
    assert.equal(graph.matchingRelationships, 0);
    assert.deepEqual(graph.filters, { type: 'all' });
    assert.deepEqual(graph.view, {
      version: CASE_RELATIONSHIP_GRAPH_VIEW_VERSION,
      focusId: '',
      oneHop: false,
      pinnedIds: [],
      hiddenIds: [],
      groupCaseIds: [],
      truncated: false,
    });
    assert.deepEqual(graph.comparisonCaseNodes, []);
    assert.deepEqual(graph.sharedRelationshipNodes, []);
    assert.equal(graph.truncated, false);
  });

  test('filters the graph by an exact relationship family without calling it truncated', () => {
    const graph = projectCaseRelationshipGraph(buildCaseRelationships(fixture()), { type: 'http_final_origin' });
    assert.equal(graph.totalRelationships, 2);
    assert.equal(graph.matchingRelationships, 1);
    assert.equal(graph.relationshipNodes.length, 1);
    assert.equal(graph.relationshipNodes[0].type, 'http_final_origin');
    assert.equal(graph.truncated, false);
    assert.deepEqual(graph.filters, { type: 'http_final_origin' });
  });

  test('projects deterministic case and relationship nodes with evidence-backed edges', () => {
    const graph = buildCaseRelationshipGraph(fixture());
    assert.equal(graph.caseNodes.length, 2);
    assert.equal(graph.relationshipNodes.length, 2);
    assert.equal(graph.edges.length, 4);
    assert.deepEqual(graph.caseNodes.map((node) => node.label), ['alpha.invalid', 'bravo.invalid']);
    assert.deepEqual(graph.relationshipNodes.map((node) => node.type), ['nameserver_set', 'http_final_origin']);
    assert.ok(graph.edges.every((edge) => graph.nodes.some((node) => node.id === edge.caseId)
      && graph.nodes.some((node) => node.id === edge.relationshipId)));
  });

  test('keeps coordinates inside the fixed responsive viewBox', () => {
    const graph = buildCaseRelationshipGraph(fixture());
    for (const node of graph.nodes) {
      assert.ok(node.x >= 0 && node.y >= 0);
      assert.ok(node.x + node.width <= graph.width);
      assert.ok(node.y + node.height <= graph.height);
    }
    for (const edge of graph.edges) {
      assert.ok(edge.x1 >= 0 && edge.x1 <= graph.width);
      assert.ok(edge.x2 >= 0 && edge.x2 <= graph.width);
      assert.ok(edge.y1 >= 0 && edge.y1 <= graph.height);
      assert.ok(edge.y2 >= 0 && edge.y2 <= graph.height);
    }
  });

  test('bounds relationships and cases while retaining two members per selected relationship', () => {
    const cases = [];
    for (let index = 0; index < MAX_RELATIONSHIP_GRAPH_RELATIONSHIPS + 1; index += 1) {
      cases.push(
        caseRecord(`a-${index}`, `a-${index}.invalid`, snapshot({ nameservers: [`ns-${index}.invalid`] })),
        caseRecord(`b-${index}`, `b-${index}.invalid`, snapshot({ nameservers: [`ns-${index}.invalid`] })),
      );
    }
    const graph = buildCaseRelationshipGraph(cases);
    assert.equal(graph.relationshipNodes.length, MAX_RELATIONSHIP_GRAPH_RELATIONSHIPS);
    assert.equal(graph.caseNodes.length, MAX_RELATIONSHIP_GRAPH_CASES);
    assert.ok(graph.relationshipNodes.every((node) => graph.edges.filter((edge) => edge.relationshipId === node.id).length === 2));
    assert.equal(graph.truncated, true);
  });

  test('caps dense edges and discloses the partial overview', () => {
    const members = Array.from({ length: MAX_RELATIONSHIP_GRAPH_CASES }, (_, index) => ({ id: `case-${index}`, domain: `case-${index}.invalid` }));
    const group = (type, value) => ({ type, label: type, method: 'Exact fixture', value, cases: members, description: 'Fixture relationship.' });
    const graph = projectCaseRelationshipGraph({
      groups: [group('one', 'one'), group('two', 'two'), group('three', 'three')],
      truncated: false,
      limitations: [],
    });
    assert.equal(graph.edges.length, MAX_RELATIONSHIP_GRAPH_EDGES);
    assert.equal(graph.truncated, true);
  });

  test('bounds labels without altering full inspector values and does not mutate input', () => {
    const cases = fixture();
    cases[0].domain = `${'a'.repeat(60)}.invalid`;
    cases[1].domain = `${'b'.repeat(60)}.invalid`;
    const before = structuredClone(cases);
    const graph = buildCaseRelationshipGraph(cases);
    assert.ok(graph.caseNodes.every((node) => node.displayLabel.endsWith('…')));
    assert.deepEqual(cases, before);
  });

  test('retains projection provenance while applying the shared source and scope filters', () => {
    const observation = { id: 'obs-1', source: 'monitor', store: 'cases', observedAt: CAPTURED };
    const group = {
      type: 'nameserver_set',
      label: 'Shared nameserver set',
      method: 'Exact retained set',
      value: 'ns.shared.invalid',
      cases: [{ id: 'alpha', domain: 'alpha.invalid' }, { id: 'bravo', domain: 'bravo.invalid' }],
      campaigns: [{ id: 'campaign-one', label: 'Review' }],
      description: 'Retained pivot.',
      sources: ['monitor'],
      scanDepths: ['deep'],
      classifications: ['normalized'],
      firstObservedAt: CAPTURED,
      lastObservedAt: CAPTURED,
      complete: null,
      truncated: false,
      observations: [observation],
      omittedObservations: 0,
      limitations: ['Compact evidence is partial.'],
    };
    const graph = projectCaseRelationshipGraph({
      state: 'ready',
      generatedAt: CAPTURED,
      groups: [group],
      sources: ['monitor'],
      scopeOptions: [{ value: 'campaign:campaign-one', kind: 'campaign', label: 'Review' }],
      truncated: false,
      limitations: [],
    }, { source: 'monitor', scope: 'campaign:campaign-one', completeness: 'unknown' });
    assert.equal(graph.relationshipNodes.length, 1);
    assert.deepEqual(graph.relationshipNodes[0].observations, [observation]);
    assert.deepEqual(graph.relationshipNodes[0].campaigns, [{ id: 'campaign-one', label: 'Review' }]);
    assert.equal(graph.relationshipNodes[0].complete, null);
    assert.equal(graph.filters.source, 'monitor');
    assert.equal(graph.filters.scope, 'campaign:campaign-one');
  });

  test('uses stable relationship ids and limits one-hop focus to direct neighbours', () => {
    const http = { httpSummaryVersion: 1, httpEvidenceStatus: 'success', httpFinalOrigin: 'https://shared.invalid', httpResponseStatus: 200 };
    const cases = [
      caseRecord('alpha', 'alpha.invalid', snapshot({ nameservers: ['ns.shared.invalid'], ...http })),
      caseRecord('bravo', 'bravo.invalid', snapshot({ nameservers: ['ns.shared.invalid'], ...http })),
      caseRecord('charlie', 'charlie.invalid', snapshot({ nameservers: ['ns.shared.invalid'] })),
    ];
    const summary = buildCaseRelationships(cases);
    const full = projectCaseRelationshipGraph(summary);
    const alpha = full.caseNodes.find((node) => node.caseId === 'alpha');
    const nameserver = full.relationshipNodes.find((node) => node.type === 'nameserver_set');
    assert.equal(nameserver.id, 'relationship:nameserver_set:ns.shared.invalid');

    const focused = projectCaseRelationshipGraph(summary, { focusId: alpha.id, oneHop: true });
    assert.deepEqual(focused.caseNodes.map((node) => node.caseId), ['alpha']);
    assert.deepEqual(focused.relationshipNodes.map((node) => node.type), ['nameserver_set', 'http_final_origin']);
    assert.equal(focused.edges.length, 2);

    const withPinnedNeighbourhood = projectCaseRelationshipGraph(summary, {
      focusId: alpha.id,
      oneHop: true,
      pinnedIds: [nameserver.id],
    });
    assert.deepEqual(withPinnedNeighbourhood.caseNodes.map((node) => node.caseId), ['alpha', 'bravo', 'charlie']);
    assert.equal(withPinnedNeighbourhood.relationshipNodes.length, 2);
    assert.deepEqual(withPinnedNeighbourhood.view.pinnedIds, [nameserver.id]);
  });

  test('finds relationships shared by every transient comparison case', () => {
    const http = { httpSummaryVersion: 1, httpEvidenceStatus: 'success', httpFinalOrigin: 'https://shared.invalid', httpResponseStatus: 200 };
    const summary = buildCaseRelationships([
      caseRecord('alpha', 'alpha.invalid', snapshot({ nameservers: ['ns.shared.invalid'], ...http })),
      caseRecord('bravo', 'bravo.invalid', snapshot({ nameservers: ['ns.shared.invalid'], ...http })),
      caseRecord('charlie', 'charlie.invalid', snapshot({ nameservers: ['ns.shared.invalid'] })),
    ]);
    const alphaBravo = projectCaseRelationshipGraph(summary, { groupCaseIds: ['case:alpha', 'case:bravo'] });
    assert.deepEqual(alphaBravo.comparisonCaseNodes.map((node) => node.caseId), ['alpha', 'bravo']);
    assert.deepEqual(alphaBravo.sharedRelationshipNodes.map((node) => node.type), ['nameserver_set', 'http_final_origin']);

    const alphaCharlie = projectCaseRelationshipGraph(summary, { groupCaseIds: ['case:alpha', 'case:charlie'] });
    assert.deepEqual(alphaCharlie.sharedRelationshipNodes.map((node) => node.type), ['nameserver_set']);
  });

  test('bounds and revalidates transient pin, hide, and comparison state', () => {
    const cases = Array.from({ length: MAX_RELATIONSHIP_GRAPH_CASES }, (_, index) => (
      caseRecord(`case-${index}`, `case-${index}.invalid`, snapshot({ nameservers: ['ns.shared.invalid'] }))
    ));
    const summary = buildCaseRelationships(cases);
    const full = projectCaseRelationshipGraph(summary);
    const caseIds = full.caseNodes.map((node) => node.id);
    const viewed = projectCaseRelationshipGraph(summary, {
      focusId: 'missing',
      oneHop: true,
      pinnedIds: [...caseIds, 'missing', caseIds[0]],
      hiddenIds: caseIds.slice(0, MAX_RELATIONSHIP_GRAPH_HIDDEN + 2),
      groupCaseIds: [...caseIds, 'relationship:nameserver_set:ns.shared.invalid'],
    });
    assert.equal(viewed.view.focusId, '');
    assert.equal(viewed.view.oneHop, false);
    assert.equal(viewed.view.hiddenIds.length, MAX_RELATIONSHIP_GRAPH_HIDDEN);
    assert.equal(viewed.view.pinnedIds.length, MAX_RELATIONSHIP_GRAPH_PINS);
    assert.equal(viewed.view.groupCaseIds.length, MAX_RELATIONSHIP_GRAPH_GROUP_CASES);
    assert.ok(viewed.view.pinnedIds.every((id) => !viewed.view.hiddenIds.includes(id)));
    assert.ok(viewed.view.groupCaseIds.every((id) => !viewed.view.hiddenIds.includes(id)));
    assert.equal(viewed.view.truncated, true);
  });

  test('hides nodes only from the visual view and does not mutate the relationship summary', () => {
    const summary = buildCaseRelationships(fixture());
    const before = structuredClone(summary);
    const full = projectCaseRelationshipGraph(summary);
    const hiddenId = full.relationshipNodes.find((node) => node.type === 'nameserver_set').id;
    const viewed = projectCaseRelationshipGraph(summary, { hiddenIds: [hiddenId] });
    assert.equal(viewed.relationshipNodes.some((node) => node.id === hiddenId), false);
    assert.equal(viewed.totalRelationships, full.totalRelationships);
    assert.deepEqual(summary, before);
  });

  test('keeps the bounded reset contract when every overview node is hidden', () => {
    const summary = buildCaseRelationships(fixture());
    const full = projectCaseRelationshipGraph(summary);
    const viewed = projectCaseRelationshipGraph(summary, { hiddenIds: full.nodes.map((node) => node.id) });
    assert.equal(viewed.allNodeCount, full.nodes.length);
    assert.deepEqual(viewed.nodes, []);
    assert.deepEqual(viewed.edges, []);
    assert.deepEqual(viewed.view.hiddenIds, full.nodes.map((node) => node.id));
  });
});
