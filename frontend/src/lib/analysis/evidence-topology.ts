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

export type LookupEvidenceTopologyInput = Readonly<{
  availability?: unknown;
  diagnostics?: unknown;
  dnsEvidence?: unknown;
  httpEvidence?: unknown;
  httpResponse?: unknown;
  observedNetworkContext?: unknown;
  observedNetworkEndpoint?: unknown;
  pageIdentity?: unknown;
  registrarRdap?: unknown;
  reverseDns?: unknown;
  reverseDnsRecords?: unknown;
  securityPosture?: unknown;
  securityPostureSummary?: unknown;
  securityTxt?: unknown;
  structuredDataIdentity?: unknown;
  targetType?: unknown;
  technologyProfile?: unknown;
  tlsAuthorization?: unknown;
  tlsEvidence?: unknown;
}>;

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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function records(value: unknown, maximum: number): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.slice(0, maximum).map(record).filter((item) => Object.keys(item).length > 0)
    : [];
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.map((item) => boundedText(item, 80)).filter(Boolean).join(', ') || '—';
  if (typeof value === 'object') {
    const item = record(value);
    return display(item.name || item.org || item.handle || item.domain);
  }
  return boundedText(value, 160) || '—';
}

function diagnosticDetail(value: unknown): string {
  const source = record(value);
  const detail = [
    boundedText(source.endpoint, 160),
    source.transportSecurity === 'https' ? 'HTTPS' : source.transportSecurity === 'http' ? 'Cleartext HTTP' : '',
    typeof source.httpStatus === 'number' ? `HTTP ${source.httpStatus}` : '',
  ].filter(Boolean).join(' · ');
  return detail || boundedText(source.status, 40).replaceAll('_', ' ') || 'unknown';
}

export function buildLookupEvidenceTopologyNodes(input: LookupEvidenceTopologyInput): EvidenceTopologyInput[] {
  const targetType = boundedText(input.targetType, 20);
  if (!targetType) return [];
  const availability = record(input.availability);
  const diagnostics = record(input.diagnostics);
  const rdapDiagnostic = record(diagnostics.rdap);
  const whoisDiagnostic = record(diagnostics.whois);
  const registrarRdap = record(input.registrarRdap);
  const observedNetworkContext = record(input.observedNetworkContext);
  const observedNetworkEndpoint = record(input.observedNetworkEndpoint);
  const dnsEvidence = record(input.dnsEvidence);
  const reverseDns = record(input.reverseDns);
  const reverseDnsRecords = record(input.reverseDnsRecords);
  const httpEvidence = record(input.httpEvidence);
  const httpResponse = record(input.httpResponse);
  const tlsEvidence = record(input.tlsEvidence);
  const tlsAuthorization = record(input.tlsAuthorization);
  const pageIdentity = record(input.pageIdentity);
  const structuredDataIdentity = record(input.structuredDataIdentity);
  const securityTxt = record(input.securityTxt);
  const technologyProfile = record(input.technologyProfile);
  const securityPosture = record(input.securityPosture);
  const securityPostureSummary = record(input.securityPostureSummary);
  const nodes: EvidenceTopologyInput[] = [{
    id: 'registry-rdap',
    label: targetType === 'domain' ? 'Registry RDAP' : 'RDAP',
    detail: diagnosticDetail(rdapDiagnostic),
    status: normalizeEvidenceTopologyStatus(rdapDiagnostic.status),
    href: '#evidence-registry',
    side: 'left',
    glyph: 'R',
    family: 'registry',
  }];
  if (targetType === 'domain' || whoisDiagnostic.status) {
    nodes.push({
      id: 'whois',
      label: 'WHOIS',
      detail: diagnosticDetail(whoisDiagnostic),
      status: normalizeEvidenceTopologyStatus(whoisDiagnostic.status),
      href: '#evidence-registry',
      side: 'left',
      glyph: 'W',
      family: 'registry',
    });
  }
  if (registrarRdap.status) {
    nodes.push({
      id: 'registrar-rdap',
      label: 'Registrar RDAP',
      detail: display(registrarRdap.detail || registrarRdap.endpoint || registrarRdap.status),
      status: normalizeEvidenceTopologyStatus(registrarRdap.status),
      href: '#evidence-registry',
      side: 'left',
      glyph: 'RR',
      family: 'registry',
    });
  }
  if (observedNetworkContext.contextVersion === 1) {
    nodes.push({
      id: 'network',
      label: 'Network context',
      detail: display(observedNetworkEndpoint.address || observedNetworkContext.detail),
      status: normalizeEvidenceTopologyStatus(observedNetworkContext.status),
      href: '#evidence-network',
      side: 'left',
      glyph: 'N',
      family: 'network',
    });
  }
  if (dnsEvidence.source === 'dns') {
    nodes.push({
      id: 'dns',
      label: 'DNS',
      detail: dnsEvidence.complete === false ? 'Collection is explicitly partial' : 'Record families collected',
      status: normalizeEvidenceTopologyStatus(dnsEvidence.status, {
        complete: dnsEvidence.complete !== false,
        truncated: dnsEvidence.truncated === true,
      }),
      href: '#evidence-dns',
      side: 'right',
      glyph: 'D',
      family: 'network',
    });
  }
  if (reverseDns.source === 'reverse_dns') {
    const ptrCount = Array.isArray(reverseDnsRecords.ptr) ? reverseDnsRecords.ptr.length : 0;
    nodes.push({
      id: 'reverse-dns',
      label: 'Reverse DNS',
      detail: ptrCount ? `${ptrCount} PTR name${ptrCount === 1 ? '' : 's'}` : display(reverseDns.status),
      status: normalizeEvidenceTopologyStatus(reverseDns.status, {
        complete: reverseDns.complete !== false,
        truncated: reverseDns.truncated === true,
      }),
      href: '#evidence-reverse-dns',
      side: 'right',
      glyph: 'D',
      family: 'network',
    });
  }
  if (httpEvidence.source === 'http') {
    nodes.push({
      id: 'http',
      label: 'HTTP',
      detail: httpResponse.status
        ? `HTTP ${display(httpResponse.status)} · ${display(httpEvidence.transportSecurity)}`
        : display(httpEvidence.status),
      status: normalizeEvidenceTopologyStatus(httpEvidence.status, {
        complete: httpEvidence.complete !== false,
        truncated: httpEvidence.truncated === true,
      }),
      href: '#evidence-http',
      side: 'right',
      glyph: 'H',
      family: 'web',
    });
  }
  if (tlsEvidence.source === 'tls') {
    nodes.push({
      id: 'tls',
      label: 'TLS',
      detail: display(tlsEvidence.protocol || (tlsAuthorization.authorized === true ? 'Validated certificate' : tlsEvidence.status)),
      status: normalizeEvidenceTopologyStatus(tlsEvidence.status, {
        complete: tlsEvidence.complete !== false,
        truncated: tlsEvidence.chainTruncated === true,
      }),
      href: '#evidence-tls',
      side: 'right',
      glyph: 'T',
      family: 'web',
    });
  }
  if (pageIdentity.source === 'html') {
    nodes.push({
      id: 'page',
      label: 'Page identity',
      detail: display(pageIdentity.title || availability.pageTitle || pageIdentity.status),
      status: normalizeEvidenceTopologyStatus(pageIdentity.status, {
        complete: pageIdentity.complete === true,
        truncated: pageIdentity.truncated === true,
      }),
      href: '#evidence-page',
      side: 'right',
      glyph: 'P',
      family: 'web',
    });
  }
  if (structuredDataIdentity.source === 'html') {
    const entityCount = records(structuredDataIdentity.entities, 16).length;
    nodes.push({
      id: 'structured-identity',
      label: 'Structured identity',
      detail: `${entityCount} publisher-declared entit${entityCount === 1 ? 'y' : 'ies'}`,
      status: normalizeEvidenceTopologyStatus(structuredDataIdentity.status, {
        complete: structuredDataIdentity.complete === true,
        truncated: structuredDataIdentity.truncated === true,
      }),
      href: '#evidence-structured-identity',
      side: 'right',
      glyph: 'SI',
      family: 'web',
    });
  }
  if (securityTxt.securityTxtVersion === 1) {
    nodes.push({
      id: 'security-txt',
      label: 'security.txt',
      detail: display(securityTxt.detail || securityTxt.state),
      status: normalizeEvidenceTopologyStatus(securityTxt.state),
      href: '#evidence-security-txt',
      side: 'right',
      glyph: 'S',
      family: 'web',
    });
  }
  if (technologyProfile.source === 'derived') {
    const findingCount = records(technologyProfile.findings, 24).length;
    nodes.push({
      id: 'technology',
      label: 'Technology',
      detail: `${findingCount} bounded indicator${findingCount === 1 ? '' : 's'}`,
      status: normalizeEvidenceTopologyStatus(technologyProfile.status, {
        complete: technologyProfile.complete === true,
        truncated: technologyProfile.truncated === true,
      }),
      href: '#evidence-technology',
      side: 'right',
      provenance: 'derived',
      glyph: 'TC',
    });
  }
  if (securityPosture.source === 'derived') {
    nodes.push({
      id: 'posture',
      label: 'Security posture',
      detail: display(securityPostureSummary.label || securityPosture.status),
      status: normalizeEvidenceTopologyStatus(securityPosture.status, {
        complete: securityPosture.complete === true,
        truncated: securityPosture.truncated === true,
      }),
      href: '#evidence-posture',
      side: 'right',
      provenance: 'derived',
      glyph: 'SP',
    });
  }
  return nodes;
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
  const normalized: Array<Required<Omit<EvidenceTopologyInput, 'status'>> & { status: EvidenceTopologyStatus }> = [];
  const candidates = Array.isArray(rawNodes) ? rawNodes : [];
  const candidateLimit = MAX_EVIDENCE_TOPOLOGY_NODES * 4;

  for (const candidate of candidates.slice(0, candidateLimit)) {
    const id = boundedId(candidate?.id);
    const label = boundedText(candidate?.label, 40);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    const provenance = candidate.provenance === 'derived' ? 'derived' : 'direct';
    normalized.push({
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

  const accepted: typeof normalized = [];
  const selectedIds = new Set<string>();
  const representedFamilies = new Set<EvidenceTopologyFamily>();
  for (const node of normalized) {
    if (representedFamilies.has(node.family)) continue;
    representedFamilies.add(node.family);
    accepted.push(node);
    selectedIds.add(node.id);
    if (accepted.length >= MAX_EVIDENCE_TOPOLOGY_NODES) break;
  }
  for (const node of normalized) {
    if (accepted.length >= MAX_EVIDENCE_TOPOLOGY_NODES) break;
    if (selectedIds.has(node.id)) continue;
    accepted.push(node);
    selectedIds.add(node.id);
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
  const provenanceCounts = nodes.reduce((summary, node) => {
    summary[node.provenance] += 1;
    return summary;
  }, { direct: 0, derived: 0 });

  return {
    version: EVIDENCE_TOPOLOGY_VERSION,
    width: WIDTH,
    height,
    target,
    nodes,
    edges,
    counts,
    provenanceCounts,
    truncated: candidates.length > candidateLimit || normalized.length > accepted.length,
  };
}
