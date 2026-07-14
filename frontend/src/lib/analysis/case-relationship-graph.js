// Pure, bounded visual projection over the normalized cross-case relationship
// summary. This is an overview only: the accessible relationship table remains
// the complete inspection surface and no new evidence or network work occurs.

import { buildCaseRelationships } from './case-relationships.js';

export const CASE_RELATIONSHIP_GRAPH_VERSION = 1;
export const MAX_RELATIONSHIP_GRAPH_RELATIONSHIPS = 12;
export const MAX_RELATIONSHIP_GRAPH_CASES = 24;
export const MAX_RELATIONSHIP_GRAPH_EDGES = 48;

const VIEWBOX_WIDTH = 900;
const VIEWBOX_HEIGHT = 640;
const CASE_X = 30;
const RELATIONSHIP_X = 570;
const NODE_WIDTH = 300;
const NODE_HEIGHT = 32;
const RELATIONSHIP_TYPES = new Set(['all', 'nameserver_set', 'http_final_origin']);

function label(value, maxLength = 40) {
  const normalized = String(value || '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function yPosition(index, count) {
  if (count <= 1) return (VIEWBOX_HEIGHT - NODE_HEIGHT) / 2;
  const top = 24;
  const available = VIEWBOX_HEIGHT - (top * 2) - NODE_HEIGHT;
  return top + (available * index / (count - 1));
}

/** @param {unknown} rawCases */
export function buildCaseRelationshipGraph(rawCases) {
  return projectCaseRelationshipGraph(buildCaseRelationships(rawCases));
}

/**
 * Selects a representative deterministic subset of an already-normalized
 * relationship summary. The first pass retains two members per relationship
 * where possible so one large group cannot consume the complete case budget.
 * @param {ReturnType<typeof buildCaseRelationships>} summary
 */
export function projectCaseRelationshipGraph(summary, rawOptions = {}) {
  const allGroups = Array.isArray(summary?.groups) ? summary.groups : [];
  const type = typeof rawOptions?.type === 'string' && RELATIONSHIP_TYPES.has(rawOptions.type)
    ? rawOptions.type
    : 'all';
  const sourceGroups = type === 'all' ? allGroups : allGroups.filter((group) => group.type === type);
  const groups = sourceGroups.slice(0, MAX_RELATIONSHIP_GRAPH_RELATIONSHIPS);
  const cases = new Map();

  for (const group of groups) {
    for (const member of group.cases.slice(0, 2)) {
      if (cases.size >= MAX_RELATIONSHIP_GRAPH_CASES) break;
      cases.set(member.id, member);
    }
  }
  for (const group of groups) {
    for (const member of group.cases) {
      if (cases.size >= MAX_RELATIONSHIP_GRAPH_CASES) break;
      cases.set(member.id, member);
    }
  }

  const caseItems = [...cases.values()].sort((left, right) => left.domain.localeCompare(right.domain));
  const caseIds = new Set(caseItems.map((item) => item.id));
  const candidateEdges = [];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    for (const member of groups[groupIndex].cases) {
      if (caseIds.has(member.id)) candidateEdges.push({
        id: `edge:${groupIndex}:${member.id}`,
        caseId: `case:${member.id}`,
        relationshipId: `relationship:${groupIndex}`,
      });
    }
  }
  const edges = candidateEdges.slice(0, MAX_RELATIONSHIP_GRAPH_EDGES);
  const connectedRelationships = new Set(edges.map((edge) => edge.relationshipId));
  const connectedCases = new Set(edges.map((edge) => edge.caseId));
  const retainedGroups = groups.map((group, index) => ({ group, index }))
    .filter(({ index }) => connectedRelationships.has(`relationship:${index}`));
  const retainedCases = caseItems.filter((item) => connectedCases.has(`case:${item.id}`));

  const caseNodes = retainedCases.map((item, index) => ({
    id: `case:${item.id}`,
    kind: 'case',
    caseId: item.id,
    label: item.domain,
    displayLabel: label(item.domain),
    x: CASE_X,
    y: yPosition(index, retainedCases.length),
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }));
  const relationshipNodes = retainedGroups.map(({ group, index }, position) => ({
    id: `relationship:${index}`,
    kind: 'relationship',
    relationshipIndex: index,
    type: group.type,
    label: group.label,
    displayLabel: label(group.value),
    value: group.value,
    method: group.method,
    description: group.description,
    cases: group.cases,
    x: RELATIONSHIP_X,
    y: yPosition(position, retainedGroups.length),
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }));

  const nodes = [...caseNodes, ...relationshipNodes];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const positionedEdges = edges.flatMap((edge) => {
    const source = nodesById.get(edge.caseId);
    const target = nodesById.get(edge.relationshipId);
    if (!source || !target) return [];
    return [{
      ...edge,
      x1: source.x + source.width,
      y1: source.y + source.height / 2,
      x2: target.x,
      y2: target.y + target.height / 2,
    }];
  });

  const truncated = Boolean(summary?.truncated)
    || sourceGroups.length > groups.length
    || caseItems.length < new Set(groups.flatMap((group) => group.cases.map((item) => item.id))).size
    || candidateEdges.length > positionedEdges.length;

  return {
    version: CASE_RELATIONSHIP_GRAPH_VERSION,
    width: VIEWBOX_WIDTH,
    height: VIEWBOX_HEIGHT,
    nodes,
    caseNodes,
    relationshipNodes,
    edges: positionedEdges,
    totalRelationships: allGroups.length,
    matchingRelationships: sourceGroups.length,
    filters: { type },
    truncated,
    limitations: Array.isArray(summary?.limitations) ? summary.limitations : [],
  };
}
