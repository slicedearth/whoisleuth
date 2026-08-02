import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import {
  boundedVisualizationId as boundedId,
  boundedVisualizationText as boundedText,
} from './visualization-bounds.ts';

export const MAX_FORCE_GRAPH_NODES = 48;
export const MAX_FORCE_GRAPH_LINKS = 80;

export type ForceGraphNodeInput = {
  id: string;
  label: string;
  kind: string;
  detail?: string;
  group?: string;
  groupLabel?: string;
};

export type ForceGraphLinkInput = {
  id: string;
  source: string;
  target: string;
  kind?: string;
  detail?: string;
};

type ProjectedForceNode = SimulationNodeDatum & {
  id: string;
  label: string;
  labelLines: string[];
  labelWidth: number;
  kind: string;
  detail: string;
  group: string;
  groupLabel: string;
  clusterIndex: number;
  collisionRadius: number;
  x: number;
  y: number;
};

type ProjectedForceLink = SimulationLinkDatum<ProjectedForceNode> & {
  id: string;
  source: string | ProjectedForceNode;
  target: string | ProjectedForceNode;
  kind: string;
  detail: string;
};

const FORCE_GRAPH_GROUPS: Readonly<Record<string, Readonly<{ id: string; label: string }>>> = {
  address: { id: 'network', label: 'Network' },
  certificate: { id: 'certificate', label: 'Certificates' },
  domain: { id: 'hosts', label: 'Domains and hosts' },
  hostname: { id: 'hosts', label: 'Domains and hosts' },
  identity: { id: 'identity', label: 'Identity' },
  issuer: { id: 'certificate', label: 'Certificates' },
  key: { id: 'certificate', label: 'Certificates' },
  network: { id: 'network', label: 'Network' },
  observation: { id: 'observations', label: 'Source observations' },
  origin: { id: 'identity', label: 'Identity' },
  prefix: { id: 'network', label: 'Network' },
  registrar: { id: 'registration', label: 'Registration' },
  relationship: { id: 'relationships', label: 'Shared evidence' },
  service: { id: 'services', label: 'Services' },
  summary: { id: 'summary', label: 'Grouped evidence' },
  target: { id: 'focus', label: 'Lookup target' },
  technology: { id: 'technology', label: 'Technology' },
  tracker: { id: 'identity', label: 'Identity' },
};

const FORCE_GRAPH_CLUSTER_INDEX: Readonly<Record<string, number>> = {
  certificate: 0,
  hosts: 1,
  identity: 2,
  network: 3,
  observations: 4,
  registration: 5,
  relationships: 6,
  services: 7,
  summary: 6,
  technology: 7,
};

function forceGraphClusterIndex(group: string) {
  const assigned = FORCE_GRAPH_CLUSTER_INDEX[group];
  if (assigned !== undefined) return assigned;
  let hash = 0;
  for (const [index, character] of [...group].entries()) {
    hash = (hash + (character.codePointAt(0) ?? 0) * (index + 1)) % 8;
  }
  return hash;
}

function forceGraphGroup(kind: string, rawGroup: unknown, rawGroupLabel: unknown) {
  const requested = boundedId(rawGroup);
  const requestedLabel = boundedText(rawGroupLabel, 40);
  if (requested) {
    return {
      id: requested,
      label: requestedLabel || requested.replaceAll('-', ' ').replace(/\b\w/gu, (character) => character.toUpperCase()),
    };
  }
  return FORCE_GRAPH_GROUPS[kind] ?? {
    id: kind || 'evidence',
    label: (kind || 'evidence').replaceAll('-', ' ').replace(/\b\w/gu, (character) => character.toUpperCase()),
  };
}

function wrapForceGraphLabel(value: string, maximumLineLength = 20): string[] {
  const lines: string[] = [];
  for (const word of value.split(/\s+/u).filter(Boolean)) {
    const pieces: string[] = [];
    let remaining = word;
    while (remaining.length > maximumLineLength) {
      let splitAt = maximumLineLength;
      for (let index = maximumLineLength; index >= Math.floor(maximumLineLength * 0.55); index -= 1) {
        if (/[./:_-]/u.test(remaining[index - 1] ?? '')) {
          splitAt = index;
          break;
        }
      }
      pieces.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt);
    }
    if (remaining) pieces.push(remaining);
    for (const [pieceIndex, piece] of pieces.entries()) {
      const current = lines.at(-1);
      if (pieceIndex === 0 && current && current.length + piece.length + 1 <= maximumLineLength) {
        lines[lines.length - 1] = `${current} ${piece}`;
      } else {
        lines.push(piece);
      }
    }
  }
  return lines.length ? lines : [value];
}

function forceGraphClusterCenters(
  groups: readonly string[],
  width: number,
  height: number,
  hasFocus: boolean,
) {
  const centerX = width / 2;
  const centerY = height / 2;
  const centers = new Map<string, { x: number; y: number }>();
  if (!groups.length) return centers;
  if (!hasFocus && groups.length === 1) {
    centers.set(groups[0] ?? '', { x: centerX, y: centerY });
    return centers;
  }
  if (!hasFocus && groups.length === 2) {
    centers.set(groups[0] ?? '', { x: width * 0.29, y: centerY });
    centers.set(groups[1] ?? '', { x: width * 0.71, y: centerY });
    return centers;
  }
  if (hasFocus && groups.length === 1) {
    centers.set(groups[0] ?? '', { x: width * 0.72, y: centerY });
    return centers;
  }
  if (hasFocus && groups.length === 2) {
    centers.set(groups[0] ?? '', { x: width * 0.25, y: centerY });
    centers.set(groups[1] ?? '', { x: width * 0.75, y: centerY });
    return centers;
  }
  const radiusX = hasFocus ? width * 0.33 : width * 0.27;
  const radiusY = hasFocus ? Math.max(150, height * 0.36) : Math.max(125, height * 0.3);
  for (const [index, group] of groups.entries()) {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / groups.length;
    centers.set(group, {
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
    });
  }
  return centers;
}

function forceGraphNodeBounds(node: ProjectedForceNode) {
  if (node.kind === 'target') {
    const halfWidth = (node.labelWidth + 20) / 2;
    const halfHeight = (node.labelLines.length * 13 + 17) / 2;
    return { halfWidth, above: halfHeight, below: halfHeight };
  }
  return {
    halfWidth: Math.max(20, node.labelWidth / 2),
    above: 22,
    below: 33 + node.labelLines.length * 13,
  };
}

function resolveForceGraphLabelCollisions(
  nodes: ProjectedForceNode[],
  width: number,
  height: number,
  focusNodeId: string | undefined,
) {
  const margin = 7;
  for (let iteration = 0; iteration < 120; iteration += 1) {
    let moved = false;
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      const left = nodes[leftIndex];
      if (!left) continue;
      const leftBounds = forceGraphNodeBounds(left);
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const right = nodes[rightIndex];
        if (!right) continue;
        const rightBounds = forceGraphNodeBounds(right);
        const overlapX = leftBounds.halfWidth + rightBounds.halfWidth + margin - Math.abs(left.x - right.x);
        const overlapY = Math.min(
          left.y + leftBounds.below,
          right.y + rightBounds.below,
        ) - Math.max(
          left.y - leftBounds.above,
          right.y - rightBounds.above,
        ) + margin;
        if (overlapX <= 0 || overlapY <= 0) continue;
        moved = true;
        const leftFixed = left.id === focusNodeId;
        const rightFixed = right.id === focusNodeId;
        if (overlapX / (leftBounds.halfWidth + rightBounds.halfWidth) < overlapY / Math.max(
          leftBounds.above + leftBounds.below,
          rightBounds.above + rightBounds.below,
        )) {
          const direction = left.x <= right.x ? -1 : 1;
          const shift = overlapX / (leftFixed || rightFixed ? 1 : 2) + 0.5;
          if (!leftFixed) left.x += direction * shift;
          if (!rightFixed) right.x -= direction * shift;
        } else {
          const direction = left.y <= right.y ? -1 : 1;
          const shift = overlapY / (leftFixed || rightFixed ? 1 : 2) + 0.5;
          if (!leftFixed) left.y += direction * shift;
          if (!rightFixed) right.y -= direction * shift;
        }
      }
    }
    for (const node of nodes) {
      const bounds = forceGraphNodeBounds(node);
      node.x = Math.max(bounds.halfWidth + margin, Math.min(width - bounds.halfWidth - margin, node.x));
      node.y = Math.max(bounds.above + margin, Math.min(height - bounds.below - margin, node.y));
    }
    if (!moved) break;
  }
}

export function projectBoundedForceGraph(
  rawNodes: readonly ForceGraphNodeInput[],
  rawLinks: readonly ForceGraphLinkInput[],
  options: Readonly<{ focusNodeId?: string }> = {},
) {
  const rawNodeCount = Array.isArray(rawNodes) ? rawNodes.length : 0;
  const rawLinkCount = Array.isArray(rawLinks) ? rawLinks.length : 0;
  const seen = new Set<string>();
  const candidates = (Array.isArray(rawNodes) ? rawNodes : [])
    .slice(0, MAX_FORCE_GRAPH_NODES * 2)
    .map((node) => {
      const id = boundedText(node?.id, 80);
      const label = boundedText(node?.label, 64);
      if (!id || !label || seen.has(id)) return null;
      seen.add(id);
      const kind = boundedId(node?.kind) || 'evidence';
      const group = forceGraphGroup(kind, node?.group, node?.groupLabel);
      const labelLines = wrapForceGraphLabel(label);
      const labelWidth = Math.max(54, Math.min(142, Math.max(...labelLines.map((line) => line.length)) * 6.2 + 16));
      return {
        id,
        label,
        labelLines,
        labelWidth,
        kind,
        detail: boundedText(node?.detail, 100),
        group: group.id,
        groupLabel: group.label,
        clusterIndex: 0,
        collisionRadius: Math.max(38, labelWidth / 2 + 8, 30 + labelLines.length * 6),
        x: 0,
        y: 0,
      } satisfies ProjectedForceNode;
    })
    .filter((node): node is ProjectedForceNode => Boolean(node))
    .sort((a, b) => a.id.localeCompare(b.id));
  const nodes = candidates.slice(0, MAX_FORCE_GRAPH_NODES);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const seenLinks = new Set<string>();
  const links = (Array.isArray(rawLinks) ? rawLinks : [])
    .slice(0, MAX_FORCE_GRAPH_LINKS * 2)
    .map((link, index) => ({
      id: boundedText(link?.id, 80) || `link-${index}`,
      source: boundedText(link?.source, 80),
      target: boundedText(link?.target, 80),
      kind: boundedId(link?.kind) || 'observed',
      detail: boundedText(link?.detail, 100),
    }))
    .filter((link) => {
      if (
        link.source === link.target
        || !nodeIds.has(link.source)
        || !nodeIds.has(link.target)
        || seenLinks.has(link.id)
      ) {
        return false;
      }
      seenLinks.add(link.id);
      return true;
    })
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, MAX_FORCE_GRAPH_LINKS) satisfies ProjectedForceLink[];

  const requestedFocusId = boundedText(options.focusNodeId, 80);
  const focusNode = nodes.find((node) => node.id === requestedFocusId)
    ?? nodes.find((node) => node.kind === 'target');
  const groupLabels = new Map<string, string>();
  for (const node of nodes) {
    if (node.id !== focusNode?.id && !groupLabels.has(node.group)) groupLabels.set(node.group, node.groupLabel);
  }
  const groupIds = [...groupLabels.keys()].sort((left, right) => {
    const leftLabel = groupLabels.get(left) ?? left;
    const rightLabel = groupLabels.get(right) ?? right;
    return leftLabel.localeCompare(rightLabel) || left.localeCompare(right);
  });
  const height = Math.max(500, Math.min(700, 450 + Math.max(0, nodes.length - 14) * 16));
  const width = 900;
  const centerX = width / 2;
  const centerY = height / 2;
  const clusterCenters = forceGraphClusterCenters(groupIds, width, height, Boolean(focusNode));
  const clusterIndex = new Map(groupIds.map((group) => [group, forceGraphClusterIndex(group)]));
  for (const node of nodes) node.clusterIndex = clusterIndex.get(node.group) ?? 0;

  if (nodes.length) {
    if (focusNode) {
      focusNode.fx = centerX;
      focusNode.fy = centerY;
    }
    const simulation = forceSimulation(nodes)
      .force('link', forceLink<ProjectedForceNode, ProjectedForceLink>(links)
        .id((node) => node.id)
        .distance((link) => link.kind === 'derived' ? 145 : 125)
        .strength(0.22))
      .force('charge', forceManyBody().strength(-330))
      .force('center', forceCenter(centerX, centerY))
      .force('cluster-x', forceX<ProjectedForceNode>((node) =>
        node.id === focusNode?.id ? centerX : clusterCenters.get(node.group)?.x ?? centerX).strength(0.3))
      .force('cluster-y', forceY<ProjectedForceNode>((node) =>
        node.id === focusNode?.id ? centerY : clusterCenters.get(node.group)?.y ?? centerY).strength(0.3))
      .force('collide', forceCollide<ProjectedForceNode>()
        .radius((node) => node.kind === 'target' ? Math.max(66, node.collisionRadius) : node.collisionRadius)
        .strength(1)
        .iterations(5))
      .stop();
    simulation.tick(360);
    for (const node of nodes) {
      const horizontalInset = Math.max(38, Math.min(82, node.collisionRadius));
      const topInset = node.kind === 'target' ? 28 : 34;
      const bottomInset = Math.max(52, 34 + node.labelLines.length * 13);
      node.x = Math.max(horizontalInset, Math.min(width - horizontalInset, Number(node.x) || centerX));
      node.y = Math.max(topInset, Math.min(height - bottomInset, Number(node.y) || centerY));
    }
    resolveForceGraphLabelCollisions(nodes, width, height, focusNode?.id);
  }

  const projectedLinks = links.flatMap((link) => {
    const source = typeof link.source === 'string' ? nodes.find((node) => node.id === link.source) : link.source;
    const target = typeof link.target === 'string' ? nodes.find((node) => node.id === link.target) : link.target;
    return source && target ? [{
      id: link.id,
      sourceId: source.id,
      targetId: target.id,
      sourceX: source.x,
      sourceY: source.y,
      targetX: target.x,
      targetY: target.y,
      kind: link.kind,
      detail: link.detail,
    }] : [];
  });
  const omittedNodeInputs = Math.max(0, rawNodeCount - nodes.length);
  const omittedLinkInputs = Math.max(0, rawLinkCount - projectedLinks.length);
  return {
    width,
    height,
    nodes: nodes.map(({ id, label, labelLines, labelWidth, kind, detail, group, groupLabel, clusterIndex, x, y }) => ({
      id,
      label,
      labelLines,
      labelWidth,
      kind,
      detail,
      group,
      groupLabel,
      clusterIndex,
      x,
      y,
    })),
    links: projectedLinks,
    clusters: groupIds.map((group) => ({
      id: group,
      label: groupLabels.get(group) ?? group,
      count: nodes.filter((node) => node.id !== focusNode?.id && node.group === group).length,
      index: clusterIndex.get(group) ?? 0,
    })),
    omittedNodeInputs,
    omittedLinkInputs,
    truncated: omittedNodeInputs > 0 || omittedLinkInputs > 0,
  };
}
