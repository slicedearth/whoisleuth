type ForceGraphNodeInput = {
  id: string;
  label: string;
  kind: string;
  detail?: string;
  group?: string;
  groupLabel?: string;
};

type ForceGraphLinkInput = {
  id: string;
  source: string;
  target: string;
  kind?: string;
  detail?: string;
};
import {
  LOOKUP_ASSET_GRAPH_SCHEMA,
  LOOKUP_ASSET_GRAPH_VERSION,
} from '../contracts/investigation-portability.mts';

export { LOOKUP_ASSET_GRAPH_SCHEMA, LOOKUP_ASSET_GRAPH_VERSION };

export type LookupAssetGraphLens = 'all' | 'identity' | 'delegation' | 'certificate';
export type LookupAssetGraphLensCounts = Readonly<Record<LookupAssetGraphLens, number>>;
export type LookupTrustBoundary =
  | 'external'
  | 'reviewed_profile'
  | 'same_origin'
  | 'same_registrable_domain'
  | 'unresolved';
export type LookupAssetNodeKind =
  | 'address'
  | 'certificate'
  | 'hostname'
  | 'identity'
  | 'issuer'
  | 'key'
  | 'network'
  | 'observation'
  | 'origin'
  | 'prefix'
  | 'registrar'
  | 'target'
  | 'tracker';

export type LookupAssetNode = Readonly<{
  id: string;
  label: string;
  kind: LookupAssetNodeKind;
  detail: string;
}>;

export type LookupAssetEdge = Readonly<{
  id: string;
  sourceId: string;
  source: string;
  target: string;
  kind: string;
  label: string;
  sourceLabel: string;
  observedAt: string | null;
  completeness: 'complete' | 'partial' | 'unknown';
  limitations: readonly string[];
  lenses: readonly LookupAssetGraphLens[];
  href: `#${string}`;
  boundary?: LookupTrustBoundary;
}>;

export type LookupAssetSource = Readonly<{
  id: string;
  label: string;
  href: `#${string}`;
  observedAt: string | null;
  completeness: 'complete' | 'partial' | 'unknown';
  limitations: readonly string[];
}>;

export type LookupAssetGraph = Readonly<{
  version: typeof LOOKUP_ASSET_GRAPH_VERSION;
  targetId: string;
  nodes: readonly LookupAssetNode[];
  edges: readonly LookupAssetEdge[];
  sources: readonly LookupAssetSource[];
  truncated: boolean;
  limitations: readonly string[];
}>;

export type LookupAssetGraphProjection = Readonly<{
  nodes: ForceGraphNodeInput[];
  links: ForceGraphLinkInput[];
  edges: readonly LookupAssetEdge[];
  collapsedGroups: readonly Readonly<{
    hubId: string;
    hubLabel: string;
    omittedEdges: number;
  }>[];
}>;

type JsonRecord = Record<string, unknown>;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;
const MAX_NODES = 72;
const MAX_EDGES = 120;
const MAX_VALUES = 16;
const MAX_LIMITATIONS = 5;
const MAX_VISUAL_EDGES_PER_HUB = 10;

function projectedNodeGroup(
  node: LookupAssetNode,
  edges: readonly LookupAssetEdge[],
): Readonly<{ id: string; label: string }> {
  if (node.kind === 'target') return { id: 'focus', label: 'Lookup target' };
  if (node.kind === 'address' || node.kind === 'network' || node.kind === 'prefix') {
    return { id: 'network', label: 'Network' };
  }
  if (node.kind === 'registrar') return { id: 'registration', label: 'Registration' };
  if (node.kind === 'certificate' || node.kind === 'issuer' || node.kind === 'key') {
    return { id: 'certificate', label: 'Certificates' };
  }
  if (node.kind === 'observation') return { id: 'delegation', label: 'Delegation' };
  if (node.kind === 'identity' || node.kind === 'origin' || node.kind === 'tracker') {
    return { id: 'identity', label: 'Web identity' };
  }
  if (node.kind === 'hostname') {
    const incident = edges.filter((edge) => edge.source === node.id || edge.target === node.id);
    if (incident.some((edge) => edge.kind === 'authorizes-name')) {
      return { id: 'certificate', label: 'Certificates' };
    }
    if (incident.some((edge) => edge.lenses.includes('identity') && !edge.lenses.includes('delegation'))) {
      return { id: 'identity', label: 'Web identity' };
    }
    return { id: 'dns', label: 'DNS and routing' };
  }
  if (node.kind === 'summary') return { id: 'summary', label: 'Grouped evidence' };
  return { id: 'evidence', label: 'Other evidence' };
}

function interleaveVisualEdgesByFamily(
  edges: readonly LookupAssetEdge[],
  nodesById: ReadonlyMap<string, LookupAssetNode>,
): LookupAssetEdge[] {
  const buckets = new Map<string, LookupAssetEdge[]>();
  for (const edge of edges) {
    const endpointGroups = [nodesById.get(edge.source), nodesById.get(edge.target)]
      .filter((node): node is LookupAssetNode => Boolean(node))
      .map((node) => projectedNodeGroup(node, edges).id)
      .filter((group) => group !== 'focus')
      .sort();
    const family = [...new Set(endpointGroups)].join('+') || 'evidence';
    const bucket = buckets.get(family) ?? [];
    bucket.push(edge);
    buckets.set(family, bucket);
  }
  const families = [...buckets.keys()].sort();
  const ordered: LookupAssetEdge[] = [];
  for (let offset = 0; ordered.length < edges.length; offset += 1) {
    let appended = false;
    for (const family of families) {
      const edge = buckets.get(family)?.[offset];
      if (!edge) continue;
      ordered.push(edge);
      appended = true;
    }
    if (!appended) break;
  }
  return ordered;
}

function edgeMatchesLens(edge: LookupAssetEdge, lens: LookupAssetGraphLens): boolean {
  return lens === 'all'
    ? edge.lenses.includes('all') || edge.lenses.length > 0
    : edge.lenses.includes(lens);
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function records(value: unknown, maximum = MAX_VALUES): JsonRecord[] {
  return Array.isArray(value)
    ? value.slice(0, maximum).map(record).filter((item) => Object.keys(item).length > 0)
    : [];
}

function text(value: unknown, maximum = 240): string {
  return String(value ?? '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum);
}

function textList(value: unknown, maximum = MAX_VALUES): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, maximum * 2)) {
    const normalized = text(item, 320);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= maximum) break;
  }
  return output;
}

function limitations(value: unknown): string[] {
  return textList(value, MAX_LIMITATIONS).map((item) => text(item, 280));
}

function hash(value: string): string {
  let state = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    state ^= value.charCodeAt(index);
    state = Math.imul(state, 16_777_619);
  }
  return (state >>> 0).toString(36);
}

function nodeId(kind: LookupAssetNodeKind, value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 28);
  return `${kind}-${slug || 'value'}-${hash(value)}`;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function hostname(value: unknown): string | null {
  const candidate = text(value, 320).toLowerCase().replace(/\.$/u, '');
  if (!candidate || candidate.includes(' ') || !candidate.includes('.')) return null;
  return candidate;
}

function urlHost(value: unknown): string | null {
  const candidate = text(value, 2_048);
  if (!candidate) return null;
  try {
    return new URL(/^[a-z][a-z\d+.-]*:\/\//iu.test(candidate) ? candidate : `https://${candidate}`)
      .hostname.toLowerCase().replace(/\.$/u, '');
  } catch {
    return null;
  }
}

function mxHostname(value: unknown): string | null {
  if (typeof value === 'string') return hostname(value);
  const item = record(value);
  return hostname(item.exchange || item.host || item.hostname);
}

function sourceCompleteness(value: unknown): 'complete' | 'partial' | 'unknown' {
  const source = record(value);
  if (source.complete === true && source.truncated !== true) return 'complete';
  if (source.complete === false || source.truncated === true || text(source.status, 32) === 'partial') return 'partial';
  return 'unknown';
}

export function buildLookupAssetGraph(input: Readonly<{
  target?: unknown;
  observedAt?: unknown;
  rdapEvidence?: unknown;
  rdapParsed?: unknown;
  dnsEvidence?: unknown;
  dnsRecords?: unknown;
  observedNetworkContext?: unknown;
  observedNetworkEndpoint?: unknown;
  observedNetwork?: unknown;
  httpEvidence?: unknown;
  tlsEvidence?: unknown;
  tlsCertificate?: unknown;
  tlsAuthorization?: unknown;
  tlsHostname?: unknown;
  tlsAltNames?: unknown;
  tlsPublicKey?: unknown;
  tlsIssuer?: unknown;
  pageCanonical?: unknown;
  pageOpenGraphUrl?: unknown;
  pageForms?: unknown;
  pageResources?: unknown;
  pageIdentity?: unknown;
  structuredDataIdentity?: unknown;
  certificatePolicyReview?: unknown;
  profileDomains?: Readonly<{
    official?: readonly string[];
    partner?: readonly string[];
    allowlisted?: readonly string[];
  }>;
}>): LookupAssetGraph {
  const target = hostname(input.target);
  if (!target) {
    return {
      version: LOOKUP_ASSET_GRAPH_VERSION,
      targetId: '',
      nodes: [],
      edges: [],
      sources: [],
      truncated: false,
      limitations: ['A normalised domain target is required before an asset graph can be projected.'],
    };
  }
  const observedAt = isoDate(input.observedAt);
  const nodes = new Map<string, LookupAssetNode>();
  const edges = new Map<string, LookupAssetEdge>();
  const sources = new Map<string, LookupAssetSource>();
  let truncated = false;
  const targetId = nodeId('target', target);
  nodes.set(targetId, { id: targetId, label: target, kind: 'target', detail: 'Lookup target' });

  const addNode = (kind: LookupAssetNodeKind, rawLabel: unknown, detail: unknown = ''): string | null => {
    const label = text(rawLabel, 320);
    if (!label) return null;
    const id = nodeId(kind, label);
    if (!nodes.has(id)) {
      if (nodes.size >= MAX_NODES) {
        truncated = true;
        return null;
      }
      nodes.set(id, { id, label, kind, detail: text(detail, 180) });
    }
    return id;
  };
  const addEdge = (edge: Omit<LookupAssetEdge, 'id' | 'sourceId'>): void => {
    if (!nodes.has(edge.source) || !nodes.has(edge.target) || edge.source === edge.target) return;
    const id = `${edge.kind}-${hash(`${edge.source}|${edge.target}|${edge.sourceLabel}`)}`;
    if (edges.has(id)) return;
    if (edges.size >= MAX_EDGES) {
      truncated = true;
      return;
    }
    const sourceId = `source-${hash(`${edge.sourceLabel}|${edge.href}`)}`;
    const existingSource = sources.get(sourceId);
    const sourceLimitations = [...new Set([
      ...(existingSource?.limitations ?? []),
      ...edge.limitations,
    ])].slice(0, MAX_LIMITATIONS);
    const sourceCompleteness = existingSource?.completeness === 'partial' || edge.completeness === 'partial'
      ? 'partial'
      : existingSource?.completeness === 'unknown' || edge.completeness === 'unknown'
        ? 'unknown'
        : 'complete';
    sources.set(sourceId, {
      id: sourceId,
      label: edge.sourceLabel,
      href: edge.href,
      observedAt: existingSource?.observedAt ?? edge.observedAt,
      completeness: sourceCompleteness,
      limitations: sourceLimitations,
    });
    edges.set(id, { id, sourceId, ...edge });
  };
  const connect = (
    kind: LookupAssetNodeKind,
    label: unknown,
    edge: Omit<LookupAssetEdge, 'id' | 'sourceId' | 'source' | 'target'>,
    detail: unknown = '',
    source = targetId,
  ): string | null => {
    const targetNode = addNode(kind, label, detail);
    if (!targetNode) return null;
    addEdge({ ...edge, source, target: targetNode });
    return targetNode;
  };
  const reviewedProfileDomains = new Set([
    ...textList(input.profileDomains?.official, 32),
    ...textList(input.profileDomains?.partner, 32),
    ...textList(input.profileDomains?.allowlisted, 32),
  ].map((value) => value.toLowerCase().replace(/\.$/u, '')));
  const trustBoundary = (
    candidate: string | null,
    sourceHost = target,
  ): LookupTrustBoundary => {
    if (!candidate) return 'unresolved';
    if (candidate === sourceHost) return 'same_origin';
    if (candidate === target || candidate.endsWith(`.${target}`)) return 'same_registrable_domain';
    if (reviewedProfileDomains.has(candidate)) return 'reviewed_profile';
    return 'external';
  };

  const dnsEvidence = record(input.dnsEvidence);
  const dnsRecords = record(input.dnsRecords);
  const dnsCompleteness = sourceCompleteness(dnsEvidence);
  const dnsLimits = limitations(dnsEvidence.limitations);
  const dnsEdge = (
    kind: string,
    label: string,
    lenses: readonly LookupAssetGraphLens[],
    href: `#${string}` = '#evidence-dns',
  ) => ({
    kind,
    label,
    sourceLabel: 'DNS',
    observedAt: isoDate(dnsEvidence.observedAt) || observedAt,
    completeness: dnsCompleteness,
    limitations: dnsLimits,
    lenses,
    href,
  });

  for (const address of [...textList(dnsRecords.a), ...textList(dnsRecords.aaaa)]) {
    connect('address', address, dnsEdge('resolves-to', 'resolves to', ['all']));
  }
  for (const alias of textList(dnsRecords.cname)) {
    connect('hostname', alias, dnsEdge('aliases-to', 'aliases to', ['all']));
  }
  for (const nameserver of textList(dnsRecords.ns)) {
    connect('hostname', nameserver, dnsEdge('uses-nameserver', 'uses nameserver', ['all', 'delegation']));
  }
  for (const mx of Array.isArray(dnsRecords.mx) ? dnsRecords.mx.slice(0, MAX_VALUES) : []) {
    const host = mxHostname(mx);
    if (host) connect('hostname', host, dnsEdge('routes-mail-to', 'routes mail to', ['all']));
  }
  for (const binding of records(dnsRecords.https)) {
    const serviceTarget = hostname(binding.target);
    if (serviceTarget && serviceTarget !== '.') {
      connect(
        'hostname',
        serviceTarget,
        dnsEdge('service-binding', 'publishes HTTPS service target', ['all']),
        `Priority ${text(binding.priority, 12) || 'unknown'}`,
      );
    }
  }

  const rdapEvidence = record(input.rdapEvidence);
  const rdapParsed = record(input.rdapParsed);
  const registrarEntity = record(rdapParsed.registrar);
  const registrar = text(
    registrarEntity.name
      ?? registrarEntity.fn
      ?? registrarEntity.handle
      ?? (typeof rdapParsed.registrar === 'string' ? rdapParsed.registrar : ''),
    180,
  );
  if (registrar) {
    connect(
      'registrar',
      registrar,
      {
        kind: 'registered-via',
        label: 'registered via',
        sourceLabel: 'Registry RDAP',
        observedAt,
        completeness: sourceCompleteness(rdapEvidence),
        limitations: limitations(rdapEvidence.limitations),
        lenses: ['all'],
        href: '#evidence-registry',
      },
      'Published registrar of record',
    );
  }

  const delegation = record(dnsEvidence.delegation);
  const delegationLimits = limitations(delegation.limitations);
  const registryObservationId = addNode('observation', 'Registry publication', 'Registry nameserver and glue evidence');
  const parentObservationId = addNode('observation', 'Recursive parent view', 'Point-in-time parent delegation observation');
  for (const nameserver of textList(record(delegation.registry).nameservers)) {
    const nameserverId = addNode('hostname', nameserver, 'Authoritative nameserver');
    if (registryObservationId && nameserverId) {
      addEdge({
        source: registryObservationId,
        target: nameserverId,
        ...dnsEdge('registry-publishes', 'registry publishes', ['delegation']),
        sourceLabel: 'Registry delegation',
        completeness: sourceCompleteness(delegation),
        limitations: delegationLimits,
      });
    }
  }
  for (const nameserver of textList(record(delegation.parent).nameservers)) {
    const nameserverId = addNode('hostname', nameserver, 'Authoritative nameserver');
    if (parentObservationId && nameserverId) {
      addEdge({
        source: parentObservationId,
        target: nameserverId,
        ...dnsEdge('parent-observes', 'parent view observes', ['delegation']),
        sourceLabel: 'Recursive parent view',
        completeness: sourceCompleteness(delegation),
        limitations: delegationLimits,
      });
    }
  }
  for (const authority of records(delegation.authorities)) {
    const nameserver = hostname(authority.nameserver);
    if (!nameserver) continue;
    const nameserverId = addNode('hostname', nameserver, `Direct authority state: ${text(authority.state, 40) || 'unknown'}`);
    if (nameserverId) {
      addEdge({
        source: targetId,
        target: nameserverId,
        ...dnsEdge('direct-authority', 'queried directly', ['delegation']),
        sourceLabel: 'Direct authoritative DNS',
        completeness: authority.state === 'success' ? 'complete' : authority.state ? 'partial' : 'unknown',
        limitations: delegationLimits,
      });
    }
    for (const address of textList(authority.addresses, 4)) {
      const addressId = addNode('address', address, text(authority.addressSource, 80));
      if (nameserverId && addressId) {
        addEdge({
          source: nameserverId,
          target: addressId,
          ...dnsEdge('nameserver-address', 'answered at', ['delegation']),
          sourceLabel: text(authority.addressSource, 80) || 'Nameserver address',
          completeness: authority.state === 'success' ? 'complete' : 'partial',
          limitations: delegationLimits,
        });
      }
    }
  }

  const networkContext = record(input.observedNetworkContext);
  const networkEndpoint = record(input.observedNetworkEndpoint);
  const network = record(input.observedNetwork);
  const endpointAddress = text(networkEndpoint.address, 80);
  const endpointId = endpointAddress
    ? addNode('address', endpointAddress, `Selected from ${text(networkEndpoint.selectedFrom, 80) || 'observed endpoint'}`)
    : null;
  if (endpointId) {
    addEdge({
      source: targetId,
      target: endpointId,
      kind: 'observed-endpoint',
      label: 'was observed at',
      sourceLabel: 'Observed network context',
      observedAt: isoDate(networkContext.observedAt) || observedAt,
      completeness: sourceCompleteness(networkContext),
      limitations: limitations(networkContext.limitations),
      lenses: ['all'],
      href: '#evidence-network',
    });
  }
  const networkLabel = text(network.name || network.holder || network.handle, 180);
  const networkId = networkLabel
    ? addNode('network', networkLabel, textList(network.cidrs, 4).join(', '))
    : null;
  if (endpointId && networkId) {
    addEdge({
      source: endpointId,
      target: networkId,
      kind: 'registered-with',
      label: 'registered within',
      sourceLabel: 'IP RDAP',
      observedAt: isoDate(networkContext.observedAt) || observedAt,
      completeness: sourceCompleteness(networkContext),
      limitations: limitations(networkContext.limitations),
      lenses: ['all'],
      href: '#evidence-network',
    });
  }
  for (const cidr of textList(network.cidrs, 8)) {
    const prefixId = addNode('prefix', cidr, 'Published IP RDAP network prefix');
    const prefixSource = networkId || endpointId;
    if (prefixId && prefixSource) {
      addEdge({
        source: prefixSource,
        target: prefixId,
        kind: 'publishes-prefix',
        label: 'publishes prefix',
        sourceLabel: 'IP RDAP',
        observedAt: isoDate(networkContext.observedAt) || observedAt,
        completeness: sourceCompleteness(networkContext),
        limitations: limitations(networkContext.limitations),
        lenses: ['all'],
        href: '#evidence-network',
      });
    }
  }

  const httpEvidence = record(input.httpEvidence);
  const finalHost = urlHost(httpEvidence.finalUrl);
  const finalHostId = finalHost
    ? connect(
        'hostname',
        finalHost,
        {
          kind: 'redirects-to',
          label: finalHost === target ? 'served from' : 'redirects to',
          sourceLabel: 'HTTP',
          observedAt: isoDate(httpEvidence.observedAt) || observedAt,
          completeness: sourceCompleteness(httpEvidence),
          limitations: limitations(httpEvidence.limitations),
          lenses: ['all', 'identity'],
          href: '#evidence-http',
          boundary: trustBoundary(finalHost),
        },
        'Observed final website origin',
      )
    : null;
  const identitySource = finalHostId || targetId;
  const canonicalHost = urlHost(record(input.pageCanonical).url);
  if (canonicalHost) {
    connect(
      'origin',
      canonicalHost,
      {
        kind: 'declares-canonical',
        label: 'declares canonical origin',
        sourceLabel: 'HTML canonical metadata',
        observedAt,
        completeness: sourceCompleteness(input.pageIdentity),
        limitations: limitations(record(input.pageIdentity).limitations),
        lenses: ['identity'],
        href: '#evidence-page',
        boundary: trustBoundary(canonicalHost, finalHost || target),
      },
      'Publisher-declared canonical origin',
      identitySource,
    );
  }
  const openGraphHost = urlHost(record(input.pageOpenGraphUrl).url);
  if (openGraphHost) {
    connect(
      'origin',
      openGraphHost,
      {
        kind: 'declares-open-graph',
        label: 'declares Open Graph origin',
        sourceLabel: 'Open Graph metadata',
        observedAt,
        completeness: sourceCompleteness(input.pageIdentity),
        limitations: limitations(record(input.pageIdentity).limitations),
        lenses: ['identity'],
        href: '#evidence-page',
        boundary: trustBoundary(openGraphHost, finalHost || target),
      },
      'Publisher-declared Open Graph origin',
      identitySource,
    );
  }
  for (const origin of textList(record(input.pageForms).externalActionOrigins)) {
    const host = urlHost(origin);
    if (host) {
      connect(
        'origin',
        host,
        {
          kind: 'form-destination',
          label: 'form may submit to',
          sourceLabel: 'Static HTML form',
          observedAt,
          completeness: sourceCompleteness(input.pageIdentity),
          limitations: ['A declared form action does not prove that a user submitted data or that the endpoint received it.'],
          lenses: ['identity'],
          href: '#evidence-page',
          boundary: trustBoundary(host, finalHost || target),
        },
        'External form-action origin',
        identitySource,
      );
    }
  }
  for (const origin of textList(record(input.pageResources).externalOrigins)) {
    const host = urlHost(origin);
    if (host) {
      connect(
        'hostname',
        host,
        {
          kind: 'loads-from',
          label: 'references resources from',
          sourceLabel: 'Static HTML resources',
          observedAt,
          completeness: sourceCompleteness(input.pageIdentity),
          limitations: ['A static resource reference does not prove that a browser loaded the resource or disclosed data to it.'],
          lenses: ['identity'],
          href: '#evidence-page',
          boundary: trustBoundary(host, finalHost || target),
        },
        'External resource origin',
        identitySource,
      );
    }
  }
  for (const identifier of records(record(input.pageIdentity).trackingIdentifiers, 12)) {
    const value = text(identifier.value, 160);
    if (value) {
      connect(
        'tracker',
        value,
        {
          kind: 'declares-tracker',
          label: 'declares tracker identifier',
          sourceLabel: 'Static HTML identity',
          observedAt,
          completeness: sourceCompleteness(input.pageIdentity),
          limitations: ['A shared identifier is a relationship lead and does not establish common ownership or control.'],
          lenses: ['identity'],
          href: '#evidence-page',
        },
        text(identifier.type, 80),
        identitySource,
      );
    }
  }

  const structuredIdentity = record(input.structuredDataIdentity);
  for (const entity of records(structuredIdentity.entities, 12)) {
    const entityLabel = text(entity.name, 180);
    const declaredOrigin = urlHost(entity.declaredOrigin);
    const entityId = entityLabel
      ? connect(
          'identity',
          entityLabel,
          {
            kind: 'declares-publisher',
            label: 'declares publisher',
            sourceLabel: 'Structured identity metadata',
            observedAt,
            completeness: sourceCompleteness(structuredIdentity),
            limitations: [
              ...limitations(structuredIdentity.limitations),
              'Publisher-declared structured metadata is not independent identity verification.',
            ].slice(0, MAX_LIMITATIONS),
            lenses: ['identity'],
            href: '#evidence-structured-identity',
          },
          textList(entity.types, 5).join(', ') || 'Publisher-declared entity',
          identitySource,
        )
      : identitySource;
    if (declaredOrigin) {
      connect(
        'origin',
        declaredOrigin,
        {
          kind: 'declares-origin',
          label: 'declares origin',
          sourceLabel: 'Structured identity metadata',
          observedAt,
          completeness: sourceCompleteness(structuredIdentity),
          limitations: limitations(structuredIdentity.limitations),
          lenses: ['identity'],
          href: '#evidence-structured-identity',
          boundary: trustBoundary(declaredOrigin, finalHost || target),
        },
        'Publisher-declared structured-data origin',
        entityId || identitySource,
      );
    }
    for (const sameAsHost of textList(entity.sameAsHosts, 12)) {
      connect(
        'origin',
        sameAsHost,
        {
          kind: 'declares-same-as',
          label: 'declares sameAs',
          sourceLabel: 'Structured identity metadata',
          observedAt,
          completeness: sourceCompleteness(structuredIdentity),
          limitations: [
            ...limitations(structuredIdentity.limitations),
            'A sameAs declaration is a site-authored claim and does not establish ownership or control.',
          ].slice(0, MAX_LIMITATIONS),
          lenses: ['identity'],
          href: '#evidence-structured-identity',
          boundary: trustBoundary(hostname(sameAsHost), finalHost || target),
        },
        'Publisher-declared sameAs host',
        entityId || identitySource,
      );
    }
  }

  const tlsEvidence = record(input.tlsEvidence);
  const certificate = record(input.tlsCertificate);
  const fingerprint = text(certificate.fingerprintSha256, 80);
  const validFrom = isoDate(certificate.validFrom);
  const validTo = isoDate(certificate.validTo);
  const certificateDetail = [
    fingerprint,
    validFrom ? `Valid from ${validFrom}` : '',
    validTo ? `Valid to ${validTo}` : '',
  ].filter(Boolean).join(' · ');
  const certificateId = fingerprint
    ? connect(
        'certificate',
        `Certificate ${fingerprint.slice(0, 12)}`,
        {
          kind: 'presents-certificate',
          label: 'presented certificate',
          sourceLabel: 'TLS',
          observedAt: isoDate(tlsEvidence.observedAt) || observedAt,
          completeness: sourceCompleteness(tlsEvidence),
          limitations: limitations(tlsEvidence.limitations),
          lenses: ['all', 'certificate'],
          href: '#evidence-tls',
        },
        certificateDetail,
      )
    : null;
  if (certificateId) {
    const hostnameReview = record(input.tlsHostname);
    if (typeof hostnameReview.matches === 'boolean') {
      const matchId = addNode(
        'identity',
        hostnameReview.matches ? 'Hostname match confirmed' : 'Hostname match not confirmed',
        hostnameReview.matches
          ? `The certificate matched ${target} during this TLS observation.`
          : text(hostnameReview.error, 160) || `The certificate did not match ${target} during this TLS observation.`,
      );
      if (matchId) {
        addEdge({
          source: targetId,
          target: matchId,
          kind: 'reviewed-hostname-match',
          label: 'reviewed hostname match',
          sourceLabel: 'TLS hostname verification',
          observedAt: isoDate(tlsEvidence.observedAt) || observedAt,
          completeness: sourceCompleteness(tlsEvidence),
          limitations: limitations(tlsEvidence.limitations),
          lenses: ['certificate', 'identity'],
          href: '#evidence-tls',
        });
        addEdge({
          source: matchId,
          target: certificateId,
          kind: 'evaluated-certificate',
          label: 'evaluated certificate',
          sourceLabel: 'TLS hostname verification',
          observedAt: isoDate(tlsEvidence.observedAt) || observedAt,
          completeness: sourceCompleteness(tlsEvidence),
          limitations: limitations(tlsEvidence.limitations),
          lenses: ['certificate'],
          href: '#evidence-tls',
        });
      }
    }
    const authorizationReview = record(input.tlsAuthorization);
    if (typeof authorizationReview.authorized === 'boolean') {
      const authorizationId = addNode(
        'identity',
        authorizationReview.authorized ? 'Runtime trust confirmed' : 'Runtime trust not confirmed',
        authorizationReview.authorized
          ? 'The runtime trust store authorised the observed certificate chain.'
          : text(authorizationReview.error, 160) || 'The runtime trust store did not authorise the observed certificate chain.',
      );
      if (authorizationId) {
        addEdge({
          source: certificateId,
          target: authorizationId,
          kind: 'reviewed-runtime-trust',
          label: 'reviewed runtime trust',
          sourceLabel: 'TLS chain verification',
          observedAt: isoDate(tlsEvidence.observedAt) || observedAt,
          completeness: sourceCompleteness(tlsEvidence),
          limitations: limitations(tlsEvidence.limitations),
          lenses: ['certificate'],
          href: '#evidence-tls',
        });
      }
    }
    for (const name of textList(record(input.tlsAltNames).dnsNames, 16)) {
      const sanId = addNode('hostname', name, 'Certificate DNS subject alternative name');
      if (sanId) {
        addEdge({
          source: certificateId,
          target: sanId,
          kind: 'authorizes-name',
          label: 'contains SAN',
          sourceLabel: 'TLS certificate',
          observedAt: isoDate(tlsEvidence.observedAt) || observedAt,
          completeness: sourceCompleteness(tlsEvidence),
          limitations: limitations(tlsEvidence.limitations),
          lenses: ['certificate', 'identity'],
          href: '#evidence-tls',
          boundary: trustBoundary(hostname(name)),
        });
      }
    }
    const publicKey = record(input.tlsPublicKey);
    const keyFingerprint = text(publicKey.fingerprintSha256, 80);
    if (keyFingerprint) {
      const keyId = addNode('key', `SPKI ${keyFingerprint.slice(0, 12)}`, `${text(publicKey.type, 40)} ${text(publicKey.bits, 20)} bits`);
      if (keyId) {
        addEdge({
          source: certificateId,
          target: keyId,
          kind: 'uses-key',
          label: 'uses public key',
          sourceLabel: 'TLS certificate',
          observedAt: isoDate(tlsEvidence.observedAt) || observedAt,
          completeness: sourceCompleteness(tlsEvidence),
          limitations: limitations(tlsEvidence.limitations),
          lenses: ['certificate'],
          href: '#evidence-tls',
        });
      }
    }
    const issuer = record(input.tlsIssuer);
    const issuerLabel = text(issuer.organization || issuer.commonName || issuer.CN, 180);
    if (issuerLabel) {
      const issuerId = addNode('issuer', issuerLabel, 'Certificate issuer');
      if (issuerId) {
        addEdge({
          source: certificateId,
          target: issuerId,
          kind: 'issued-by',
          label: 'issued by',
          sourceLabel: 'TLS certificate',
          observedAt: isoDate(tlsEvidence.observedAt) || observedAt,
          completeness: sourceCompleteness(tlsEvidence),
          limitations: limitations(tlsEvidence.limitations),
          lenses: ['certificate'],
          href: '#evidence-tls',
        });
      }
    }
    for (const finding of records(record(input.certificatePolicyReview).findings, 8)) {
      const findingId = text(finding.id, 80);
      const state = text(finding.state, 80);
      if (!findingId || state === 'not_configured') continue;
      const policyId = addNode(
        'identity',
        text(finding.label, 160) || 'Certificate policy',
        state.replaceAll('_', ' '),
      );
      if (policyId) {
        addEdge({
          source: certificateId,
          target: policyId,
          kind: 'reviewed-against-policy',
          label: 'reviewed against',
          sourceLabel: 'DNS / TLS / Brand Profile',
          observedAt: isoDate(record(input.certificatePolicyReview).observedAt) || observedAt,
          completeness: state === 'indeterminate' || state === 'no_target_policy_observed' ? 'partial' : 'complete',
          limitations: limitations(finding.limitations),
          lenses: ['certificate'],
          href: '#evidence-certificate-policy',
        });
      }
    }
  }

  return {
    version: LOOKUP_ASSET_GRAPH_VERSION,
    targetId,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    sources: [...sources.values()].sort((left, right) => left.label.localeCompare(right.label)),
    truncated,
    limitations: [
      'The graph contains only settled evidence from this Lookup and does not start additional requests.',
      'Shared infrastructure, certificates, resources, or identifiers do not establish ownership, control, intent, or maliciousness.',
      'An observed address can represent a CDN, proxy, load balancer, or shared service rather than an origin host.',
      'Missing and incomplete sources remain explicit and are not represented as absent relationships.',
    ],
  };
}

export function countLookupAssetGraphEdgesByLens(graph: LookupAssetGraph): LookupAssetGraphLensCounts {
  return Object.freeze({
    all: graph.edges.filter((edge) => edgeMatchesLens(edge, 'all')).length,
    identity: graph.edges.filter((edge) => edgeMatchesLens(edge, 'identity')).length,
    delegation: graph.edges.filter((edge) => edgeMatchesLens(edge, 'delegation')).length,
    certificate: graph.edges.filter((edge) => edgeMatchesLens(edge, 'certificate')).length,
  });
}

export function projectLookupAssetGraph(
  graph: LookupAssetGraph,
  lens: LookupAssetGraphLens,
): LookupAssetGraphProjection {
  const acceptedEdges = graph.edges.filter((edge) => edgeMatchesLens(edge, lens));
  const graphNodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const visualEdges: LookupAssetEdge[] = [];
  const visualDegree = new Map<string, number>();
  const omittedByHub = new Map<string, number>();
  for (const edge of interleaveVisualEdgesByFamily(acceptedEdges, graphNodeById)) {
    const sourceDegree = visualDegree.get(edge.source) ?? 0;
    const targetDegree = visualDegree.get(edge.target) ?? 0;
    const saturatedHub = sourceDegree >= MAX_VISUAL_EDGES_PER_HUB
      ? edge.source
      : targetDegree >= MAX_VISUAL_EDGES_PER_HUB
        ? edge.target
        : null;
    if (saturatedHub) {
      omittedByHub.set(saturatedHub, (omittedByHub.get(saturatedHub) ?? 0) + 1);
      continue;
    }
    visualEdges.push(edge);
    visualDegree.set(edge.source, sourceDegree + 1);
    visualDegree.set(edge.target, targetDegree + 1);
  }
  const nodeIds = new Set([graph.targetId]);
  for (const edge of visualEdges) {
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }
  const collapsedGroups = [...omittedByHub.entries()].map(([hubId, omittedEdges]) => ({
    hubId,
    hubLabel: graphNodeById.get(hubId)?.label ?? hubId,
    omittedEdges,
  }));
  const nodes: ForceGraphNodeInput[] = graph.nodes
    .filter((node) => nodeIds.has(node.id))
    .map((node) => {
      const group = projectedNodeGroup(node, visualEdges);
      return {
        id: node.id,
        label: node.label,
        kind: node.kind,
        detail: node.detail,
        group: group.id,
        groupLabel: group.label,
      };
    });
  for (const group of collapsedGroups) {
    nodes.push({
      id: `collapsed-${group.hubId}`,
      label: `+${group.omittedEdges} more`,
      kind: 'summary',
      detail: `The visual graph groups ${group.omittedEdges} additional relationship${group.omittedEdges === 1 ? '' : 's'} connected to ${group.hubLabel}. The accessible relationship list retains every edge.`,
      group: 'summary',
      groupLabel: 'Grouped evidence',
    });
  }
  const links: ForceGraphLinkInput[] = visualEdges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    kind: edge.completeness === 'complete'
      ? 'observed'
      : edge.completeness === 'partial'
        ? 'partial'
        : 'unknown',
    detail: `${edge.label} · ${edge.sourceLabel}${edge.boundary ? ` · ${edge.boundary.replaceAll('_', ' ')}` : ''}`,
  }));
  for (const group of collapsedGroups) {
    links.push({
      id: `collapsed-link-${group.hubId}`,
      source: group.hubId,
      target: `collapsed-${group.hubId}`,
      kind: 'summary',
      detail: `${group.omittedEdges} additional bounded relationships are listed below`,
    });
  }
  return { nodes, links, edges: acceptedEdges, collapsedGroups };
}
