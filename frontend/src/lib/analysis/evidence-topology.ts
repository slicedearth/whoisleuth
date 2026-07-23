import { scalePoint } from 'd3-scale';
import { linkHorizontal } from 'd3-shape';

export const MAX_EVIDENCE_TOPOLOGY_NODES = 10;
export const EVIDENCE_TOPOLOGY_VERSION = 1;

export type EvidenceTopologyStatus =
  | 'success'
  | 'partial'
  | 'warning'
  | 'inconclusive'
  | 'not_found'
  | 'unavailable'
  | 'unsupported'
  | 'skipped'
  | 'disabled'
  | 'rate_limited'
  | 'error'
  | 'unknown';

export type EvidenceTopologySide = 'left' | 'right';
export type EvidenceTopologyProvenance = 'direct' | 'derived';
export type EvidenceTopologyFamily = 'registry' | 'network' | 'web' | 'derived' | 'analyst';

export type EvidenceTopologyInput = {
  id: string;
  label: string;
  detail?: string;
  status?: string;
  href?: string;
  glyph?: string;
  side?: EvidenceTopologySide;
  provenance?: EvidenceTopologyProvenance;
  family?: EvidenceTopologyFamily;
};

export type EvidenceTopologyTarget = {
  label: string;
  detail?: string;
  status?: string;
};

type Point = { x: number; y: number };

const WIDTH = 820;
const NODE_WIDTH = 180;
const NODE_HEIGHT = 58;
const TARGET_WIDTH = 220;
const TARGET_HEIGHT = 76;
const LEFT_X = 30;
const RIGHT_X = WIDTH - NODE_WIDTH - 30;
const horizontalLink = linkHorizontal<{ source: Point; target: Point }, Point>()
  .x((point) => point.x)
  .y((point) => point.y);

function boundedText(value: unknown, maxLength: number) {
  const normalized = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return normalized.slice(0, maxLength);
}

function boundedId(value: unknown) {
  return boundedText(value, 64).toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '');
}

function boundedHref(value: unknown) {
  const href = boundedText(value, 96);
  return /^#[a-z][a-z0-9_-]{0,79}$/iu.test(href) ? href : '';
}

function normalizeEvidenceTopologyFamily(
  value: unknown,
  provenance: EvidenceTopologyProvenance,
): EvidenceTopologyFamily {
  if (provenance === 'derived') return 'derived';
  return value === 'network' || value === 'web' || value === 'analyst'
    ? value
    : 'registry';
}

export function normalizeEvidenceTopologyStatus(
  value: unknown,
  options: { complete?: boolean; truncated?: boolean } = {},
): EvidenceTopologyStatus {
  if (options.complete === false || options.truncated === true) return 'partial';
  const status = boundedText(value, 40).toLowerCase().replaceAll(' ', '_');
  if (['success', 'complete', 'completed', 'supported', 'observed', 'registered', 'available'].includes(status)) return 'success';
  if (['partial', 'incomplete', 'truncated', 'limited'].includes(status)) return 'partial';
  if (['warning', 'conflict', 'mismatch'].includes(status)) return 'warning';
  if (status === 'inconclusive') return 'inconclusive';
  if (status === 'not_found') return 'not_found';
  if (['unavailable', 'not_applicable'].includes(status)) return 'unavailable';
  if (status === 'unsupported') return 'unsupported';
  if (['skipped', 'omitted'].includes(status)) return 'skipped';
  if (status === 'disabled') return 'disabled';
  if (status === 'rate_limited') return 'rate_limited';
  if (['error', 'failed', 'failure', 'timeout', 'invalid_response'].includes(status)) return 'error';
  return 'unknown';
}

function yPositions(ids: string[], height: number) {
  const scale = scalePoint<string>()
    .domain(ids)
    .range([42, height - NODE_HEIGHT - 42])
    .padding(ids.length > 1 ? 0.35 : 0.5);
  return new Map(ids.map((id) => [id, scale(id) ?? (height - NODE_HEIGHT) / 2]));
}

export function horizontalConnectionPath(source: Point, target: Point) {
  return horizontalLink({ source, target }) ?? '';
}

export function projectEvidenceTopology(targetInput: EvidenceTopologyTarget, rawNodes: EvidenceTopologyInput[]) {
  const seen = new Set<string>();
  const accepted: Array<Required<Omit<EvidenceTopologyInput, 'status'>> & { status: EvidenceTopologyStatus }> = [];
  const candidates = Array.isArray(rawNodes) ? rawNodes : [];

  for (const candidate of candidates) {
    const id = boundedId(candidate?.id);
    const label = boundedText(candidate?.label, 40);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    if (accepted.length >= MAX_EVIDENCE_TOPOLOGY_NODES) continue;
    const provenance = candidate.provenance === 'derived' ? 'derived' : 'direct';
    accepted.push({
      id,
      label,
      detail: boundedText(candidate.detail, 120),
      status: normalizeEvidenceTopologyStatus(candidate.status),
      href: boundedHref(candidate.href),
      glyph: boundedText(candidate.glyph, 3).toUpperCase() || label.slice(0, 1).toUpperCase(),
      side: candidate.side === 'left' ? 'left' : 'right',
      provenance,
      family: normalizeEvidenceTopologyFamily(candidate.family, provenance),
    });
  }

  const leftIds = accepted.filter((node) => node.side === 'left').map((node) => node.id);
  const rightIds = accepted.filter((node) => node.side === 'right').map((node) => node.id);
  const maxColumn = Math.max(leftIds.length, rightIds.length, 1);
  const height = Math.min(500, Math.max(300, 92 + maxColumn * 72));
  const leftY = yPositions(leftIds, height);
  const rightY = yPositions(rightIds, height);
  const target = {
    label: boundedText(targetInput?.label, 80) || 'Lookup target',
    detail: boundedText(targetInput?.detail, 120),
    status: boundedText(targetInput?.status, 40) || 'unknown',
    x: (WIDTH - TARGET_WIDTH) / 2,
    y: (height - TARGET_HEIGHT) / 2,
    width: TARGET_WIDTH,
    height: TARGET_HEIGHT,
  };
  const nodes = accepted.map((node) => ({
    ...node,
    x: node.side === 'left' ? LEFT_X : RIGHT_X,
    y: (node.side === 'left' ? leftY : rightY).get(node.id) ?? 0,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }));
  const edges = nodes.map((node) => {
    const source = node.side === 'left'
      ? { x: node.x + node.width, y: node.y + node.height / 2 }
      : { x: target.x + target.width, y: target.y + target.height / 2 };
    const destination = node.side === 'left'
      ? { x: target.x, y: target.y + target.height / 2 }
      : { x: node.x, y: node.y + node.height / 2 };
    return {
      id: `edge-${node.id}`,
      nodeId: node.id,
      provenance: node.provenance,
      status: node.status,
      path: horizontalConnectionPath(source, destination),
    };
  });
  const counts = nodes.reduce<Record<EvidenceTopologyStatus, number>>((summary, node) => {
    summary[node.status] += 1;
    return summary;
  }, {
    success: 0,
    partial: 0,
    warning: 0,
    inconclusive: 0,
    not_found: 0,
    unavailable: 0,
    unsupported: 0,
    skipped: 0,
    disabled: 0,
    rate_limited: 0,
    error: 0,
    unknown: 0,
  });

  return {
    version: EVIDENCE_TOPOLOGY_VERSION,
    width: WIDTH,
    height,
    target,
    nodes,
    edges,
    counts,
    truncated: seen.size > accepted.length,
  };
}
