// Bounded, deterministic graph analysis shared by relationship workflows.
// Results describe graph structure only and do not imply common ownership,
// coordination, control, intent, safety, or maliciousness.

import { UndirectedGraph } from 'graphology';
import type { AbstractGraph } from 'graphology-types';
import { connectedComponents } from 'graphology-components';
import { bidirectional } from 'graphology-shortest-path/unweighted.js';

export const MAX_BOUNDED_GRAPH_NODES = 2_000;
export const MAX_BOUNDED_GRAPH_EDGES = 8_000;

export type BoundedGraphEdge = Readonly<{ source: string; target: string }>;
export type BoundedGraphAnalysis = Readonly<{
  components: readonly (readonly string[])[];
  nodeCount: number;
  edgeCount: number;
  truncated: boolean;
}>;

function boundedId(value: unknown): string | null {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 240
    && !/[\u0000-\u001f\u007f]/u.test(value)
    ? value
    : null;
}

function graphFrom(
  rawNodes: readonly string[],
  rawEdges: readonly BoundedGraphEdge[],
): { graph: AbstractGraph; truncated: boolean } {
  const graph = new UndirectedGraph({ allowSelfLoops: false });
  let truncated = rawNodes.length > MAX_BOUNDED_GRAPH_NODES || rawEdges.length > MAX_BOUNDED_GRAPH_EDGES;
  for (const rawNode of rawNodes.slice(0, MAX_BOUNDED_GRAPH_NODES)) {
    const node = boundedId(rawNode);
    if (!node || graph.hasNode(node)) continue;
    graph.addNode(node);
  }
  for (const rawEdge of rawEdges.slice(0, MAX_BOUNDED_GRAPH_EDGES)) {
    const source = boundedId(rawEdge.source);
    const target = boundedId(rawEdge.target);
    if (!source || !target || source === target || !graph.hasNode(source) || !graph.hasNode(target)) continue;
    if (!graph.hasEdge(source, target)) graph.addUndirectedEdge(source, target);
  }
  if (graph.order < Math.min(rawNodes.length, MAX_BOUNDED_GRAPH_NODES)) truncated = true;
  return { graph, truncated };
}

export function analyzeBoundedRelationshipGraph(
  nodes: readonly string[],
  edges: readonly BoundedGraphEdge[],
): BoundedGraphAnalysis {
  const built = graphFrom(nodes, edges);
  const components = connectedComponents(built.graph)
    .map((component) => Object.freeze([...component].sort()))
    .sort((left, right) => right.length - left.length || (left[0] ?? '').localeCompare(right[0] ?? ''));
  return Object.freeze({
    components: Object.freeze(components),
    nodeCount: built.graph.order,
    edgeCount: built.graph.size,
    truncated: built.truncated,
  });
}

export function boundedRelationshipPath(
  nodes: readonly string[],
  edges: readonly BoundedGraphEdge[],
  source: string,
  target: string,
): readonly string[] | null {
  const built = graphFrom(nodes, edges);
  if (!built.graph.hasNode(source) || !built.graph.hasNode(target)) return null;
  const path = bidirectional(built.graph, source, target);
  return path ? Object.freeze(path) : null;
}
