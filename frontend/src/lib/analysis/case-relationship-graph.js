// Pure, bounded visual projection over the normalized cross-case relationship
// summary. This is an overview only: the accessible relationship table remains
// the complete inspection surface and no new evidence or network work occurs.

import {
  buildCaseRelationships,
  filterInvestigationCaseRelationships,
} from './case-relationships.js';

export const CASE_RELATIONSHIP_GRAPH_VERSION = 2;
export const MAX_RELATIONSHIP_GRAPH_RELATIONSHIPS = 12;
export const MAX_RELATIONSHIP_GRAPH_CASES = 24;
export const MAX_RELATIONSHIP_GRAPH_EDGES = 48;
export const CASE_RELATIONSHIP_GRAPH_VIEW_VERSION = 1;
export const MAX_RELATIONSHIP_GRAPH_PINS = 8;
export const MAX_RELATIONSHIP_GRAPH_HIDDEN = 12;
export const MAX_RELATIONSHIP_GRAPH_GROUP_CASES = 8;

const VIEWBOX_WIDTH = 900;
const VIEWBOX_HEIGHT = 640;
const CASE_X = 30;
const RELATIONSHIP_X = 570;
const NODE_WIDTH = 300;
const NODE_HEIGHT = 32;
const RELATIONSHIP_TYPES = new Set([
  'all',
  'nameserver_set',
  'http_final_origin',
  'ip_address',
  'certificate',
  'tracking_identifier',
  'favicon',
  'official_asset',
]);

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

function relationshipNodeId(group) {
  return `relationship:${group.type}:${group.value}`;
}

function boundedNodeIds(values, allowed, limit) {
  const output = [];
  const seen = new Set();
  if (!Array.isArray(values)) return { ids: output, truncated: false };
  for (const value of values) {
    if (typeof value !== 'string' || !allowed.has(value) || seen.has(value)) continue;
    seen.add(value);
    if (output.length < limit) output.push(value);
  }
  return { ids: output, truncated: seen.size > output.length };
}

function positionGraph(caseNodes, relationshipNodes, edges) {
  const positionedCases = caseNodes.map((node, index) => ({
    ...node,
    x: CASE_X,
    y: yPosition(index, caseNodes.length),
  }));
  const positionedRelationships = relationshipNodes.map((node, index) => ({
    ...node,
    x: RELATIONSHIP_X,
    y: yPosition(index, relationshipNodes.length),
  }));
  const nodes = [...positionedCases, ...positionedRelationships];
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
  return {
    nodes,
    caseNodes: positionedCases,
    relationshipNodes: positionedRelationships,
    edges: positionedEdges,
  };
}

function applyGraphView(caseNodes, relationshipNodes, edges, rawOptions) {
  const allNodes = [...caseNodes, ...relationshipNodes];
  const allNodeIds = new Set(allNodes.map((node) => node.id));
  const caseNodeIds = new Set(caseNodes.map((node) => node.id));
  const hidden = boundedNodeIds(rawOptions.hiddenIds, allNodeIds, MAX_RELATIONSHIP_GRAPH_HIDDEN);
  const hiddenIds = new Set(hidden.ids);
  const visibleNodeIds = new Set([...allNodeIds].filter((id) => !hiddenIds.has(id)));
  const pins = boundedNodeIds(rawOptions.pinnedIds, visibleNodeIds, MAX_RELATIONSHIP_GRAPH_PINS);
  const groupCases = boundedNodeIds(rawOptions.groupCaseIds, new Set([...caseNodeIds].filter((id) => !hiddenIds.has(id))), MAX_RELATIONSHIP_GRAPH_GROUP_CASES);
  const focusId = typeof rawOptions.focusId === 'string' && visibleNodeIds.has(rawOptions.focusId)
    ? rawOptions.focusId
    : '';
  const oneHop = rawOptions.oneHop === true && Boolean(focusId);
  let retainedIds = visibleNodeIds;
  if (oneHop) {
    const seeds = new Set([focusId, ...pins.ids]);
    retainedIds = new Set(seeds);
    for (const edge of edges) {
      if (seeds.has(edge.caseId) || seeds.has(edge.relationshipId)) {
        if (!hiddenIds.has(edge.caseId)) retainedIds.add(edge.caseId);
        if (!hiddenIds.has(edge.relationshipId)) retainedIds.add(edge.relationshipId);
      }
    }
  }
  const visibleEdges = edges.filter((edge) => retainedIds.has(edge.caseId) && retainedIds.has(edge.relationshipId));
  const connectedIds = new Set(visibleEdges.flatMap((edge) => [edge.caseId, edge.relationshipId]));
  const anchoredIds = new Set([focusId, ...pins.ids, ...groupCases.ids].filter(Boolean));
  const visibleCases = caseNodes.filter((node) => retainedIds.has(node.id) && (connectedIds.has(node.id) || anchoredIds.has(node.id)));
  const visibleRelationships = relationshipNodes.filter((node) => retainedIds.has(node.id) && (connectedIds.has(node.id) || anchoredIds.has(node.id)));
  const positioned = positionGraph(visibleCases, visibleRelationships, visibleEdges);

  const groupedIds = new Set(groupCases.ids);
  const sharedRelationshipNodes = groupCases.ids.length < 2 ? [] : relationshipNodes.filter((node) => {
    if (hiddenIds.has(node.id)) return false;
    const memberIds = new Set(edges.filter((edge) => edge.relationshipId === node.id).map((edge) => edge.caseId));
    return [...groupedIds].every((id) => memberIds.has(id));
  });

  return {
    ...positioned,
    comparisonCaseNodes: caseNodes.filter((node) => groupedIds.has(node.id)),
    sharedRelationshipNodes,
    view: {
      version: CASE_RELATIONSHIP_GRAPH_VIEW_VERSION,
      focusId,
      oneHop,
      pinnedIds: pins.ids,
      hiddenIds: hidden.ids,
      groupCaseIds: groupCases.ids,
      truncated: hidden.truncated || pins.truncated || groupCases.truncated,
    },
    allNodeCount: allNodes.length,
  };
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
  const options = /** @type {Record<string, any>} */ (
    rawOptions && typeof rawOptions === 'object' && !Array.isArray(rawOptions) ? rawOptions : {}
  );
  const allGroups = Array.isArray(summary?.groups) ? summary.groups : [];
  const projectionBacked = summary?.state === 'ready';
  const filtered = projectionBacked
    ? filterInvestigationCaseRelationships(summary, options)
    : null;
  const type = filtered?.filters.type || (typeof options.type === 'string' && RELATIONSHIP_TYPES.has(options.type)
    ? options.type
    : 'all');
  const sourceGroups = filtered?.groups || (type === 'all' ? allGroups : allGroups.filter((group) => group.type === type));
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
    const relationshipId = relationshipNodeId(groups[groupIndex]);
    for (const member of groups[groupIndex].cases) {
      if (caseIds.has(member.id)) candidateEdges.push({
        id: `edge:${relationshipId}:${member.id}`,
        caseId: `case:${member.id}`,
        relationshipId,
      });
    }
  }
  const edges = candidateEdges.slice(0, MAX_RELATIONSHIP_GRAPH_EDGES);
  const connectedRelationships = new Set(edges.map((edge) => edge.relationshipId));
  const connectedCases = new Set(edges.map((edge) => edge.caseId));
  const retainedGroups = groups.map((group, index) => ({ group, index }))
    .filter(({ group }) => connectedRelationships.has(relationshipNodeId(group)));
  const retainedCases = caseItems.filter((item) => connectedCases.has(`case:${item.id}`));

  const caseNodes = retainedCases.map((item) => ({
    id: `case:${item.id}`,
    kind: 'case',
    caseId: item.id,
    label: item.domain,
    displayLabel: label(item.domain),
    x: 0,
    y: 0,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }));
  const relationshipNodes = retainedGroups.map(({ group, index }) => ({
    id: relationshipNodeId(group),
    kind: 'relationship',
    relationshipIndex: index,
    type: group.type,
    label: group.label,
    displayLabel: label(group.value),
    value: group.value,
    method: group.method,
    description: group.description,
    cases: group.cases,
    campaigns: Array.isArray(group.campaigns) ? group.campaigns : [],
    sources: Array.isArray(group.sources) ? group.sources : [],
    scanDepths: Array.isArray(group.scanDepths) ? group.scanDepths : [],
    classifications: Array.isArray(group.classifications) ? group.classifications : [],
    firstObservedAt: group.firstObservedAt || '',
    lastObservedAt: group.lastObservedAt || '',
    complete: typeof group.complete === 'boolean' ? group.complete : null,
    truncated: group.truncated === true,
    observations: Array.isArray(group.observations) ? group.observations : [],
    omittedObservations: Number.isSafeInteger(group.omittedObservations) ? group.omittedObservations : 0,
    limitations: Array.isArray(group.limitations) ? group.limitations : [],
    x: 0,
    y: 0,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }));

  const viewed = applyGraphView(caseNodes, relationshipNodes, edges, options);

  const truncated = Boolean(summary?.truncated)
    || sourceGroups.length > groups.length
    || caseItems.length < new Set(groups.flatMap((group) => group.cases.map((item) => item.id))).size
    || candidateEdges.length > edges.length;

  return {
    version: CASE_RELATIONSHIP_GRAPH_VERSION,
    width: VIEWBOX_WIDTH,
    height: VIEWBOX_HEIGHT,
    nodes: viewed.nodes,
    caseNodes: viewed.caseNodes,
    relationshipNodes: viewed.relationshipNodes,
    edges: viewed.edges,
    comparisonCaseNodes: viewed.comparisonCaseNodes,
    sharedRelationshipNodes: viewed.sharedRelationshipNodes,
    view: viewed.view,
    allNodeCount: viewed.allNodeCount,
    totalRelationships: filtered?.totalRelationships ?? allGroups.length,
    matchingRelationships: filtered?.matchingRelationships ?? sourceGroups.length,
    filters: filtered?.filters || { type },
    state: summary?.state || 'legacy',
    sources: Array.isArray(summary?.sources) ? summary.sources : [],
    scopeOptions: Array.isArray(summary?.scopeOptions) ? summary.scopeOptions : [],
    filterOptionsTruncated: summary?.filterOptionsTruncated === true,
    truncated,
    limitations: Array.isArray(summary?.limitations) ? summary.limitations : [],
  };
}
