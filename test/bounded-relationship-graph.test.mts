import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  analyzeBoundedRelationshipGraph,
  boundedRelationshipPath,
} from '../lib/bounded-relationship-graph.mts';

describe('bounded relationship graph analysis', () => {
  const nodes = ['case-a', 'case-b', 'case-c', 'case-d'];
  const edges = [
    { source: 'case-a', target: 'case-b' },
    { source: 'case-b', target: 'case-c' },
  ];

  test('returns deterministic connected components without attribution claims', () => {
    const result = analyzeBoundedRelationshipGraph(nodes, edges);
    assert.deepEqual(result.components, [['case-a', 'case-b', 'case-c'], ['case-d']]);
    assert.equal(result.nodeCount, 4);
    assert.equal(result.edgeCount, 2);
    assert.equal(result.truncated, false);
  });

  test('supports review-only shortest paths over the same bounded graph', () => {
    assert.deepEqual(boundedRelationshipPath(nodes, edges, 'case-a', 'case-c'), ['case-a', 'case-b', 'case-c']);
    assert.equal(boundedRelationshipPath(nodes, edges, 'case-a', 'case-d'), null);
  });
});
