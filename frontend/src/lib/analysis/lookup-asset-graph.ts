import type {
  ForceGraphLinkInput,
  ForceGraphNodeInput,
} from './visualization-models.ts';

export type LookupAssetGraphLens = 'all' | 'identity' | 'delegation' | 'certificate';
export type LookupAssetNodeKind =
  | 'address'
  | 'certificate'
  | 'hostname'
  | 'identity'
  | 'key'
  | 'network'
  | 'observation'
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
}>;

export type LookupAssetGraph = Readonly<{
  version: 1;
  targetId: string;
  nodes: readonly LookupAssetNode[];
  edges: readonly LookupAssetEdge[];
  truncated: boolean;
  limitations: readonly string[];
}>;

export type LookupAssetGraphProjection = Readonly<{
  nodes: ForceGraphNodeInput[];
  links: ForceGraphLinkInput[];
  edges: readonly LookupAssetEdge[];
}>;

type JsonRecord = Record<string, unknown>;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;
const MAX_NODES = 72;
const MAX_EDGES = 120;
const MAX_VALUES = 16;
const MAX_LIMITATIONS = 5;

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
  rdapParsed?: unknown;
  dnsEvidence?: unknown;
  dnsRecords?: unknown;
  observedNetworkContext?: unknown;
  observedNetworkEndpoint?: unknown;
  observedNetwork?: unknown;
  httpEvidence?: unknown;
  tlsEvidence?: unknown;
  tlsCertificate?: unknown;
  tlsAltNames?: unknown;
  tlsPublicKey?: unknown;
  tlsIssuer?: unknown;
  pageCanonical?: unknown;
  pageOpenGraphUrl?: unknown;
  pageForms?: unknown;
  pageResources?: unknown;
  pageIdentity?: unknown;
}>): LookupAssetGraph {
  const target = hostname(input.target);
  if (!target) {
    return {
      version: 1,
      targetId: '',
      nodes: [],
      edges: [],
      truncated: false,
      limitations: ['A normalized domain target is required before an asset graph can be projected.'],
    };
  }
  const observedAt = isoDate(input.observedAt);
  const nodes = new Map<string, LookupAssetNode>();
  const edges = new Map<string, LookupAssetEdge>();
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
  const addEdge = (edge: Omit<LookupAssetEdge, 'id'>): void => {
    if (!nodes.has(edge.source) || !nodes.has(edge.target) || edge.source === edge.target) return;
    const id = `${edge.kind}-${hash(`${edge.source}|${edge.target}|${edge.sourceLabel}`)}`;
    if (edges.has(id)) return;
    if (edges.size >= MAX_EDGES) {
      truncated = true;
      return;
    }
    edges.set(id, { id, ...edge });
  };
  const connect = (
    kind: LookupAssetNodeKind,
    label: unknown,
    edge: Omit<LookupAssetEdge, 'id' | 'source' | 'target'>,
    detail: unknown = '',
    source = targetId,
  ): string | null => {
    const targetNode = addNode(kind, label, detail);
    if (!targetNode) return null;
    addEdge({ ...edge, source, target: targetNode });
    return targetNode;
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
      href: '#evidence-network-context',
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
      href: '#evidence-network-context',
    });
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
        },
        'Observed final website origin',
      )
    : null;
  const identitySource = finalHostId || targetId;
  const canonicalHost = urlHost(record(input.pageCanonical).url);
  if (canonicalHost) {
    connect(
      'identity',
      canonicalHost,
      {
        kind: 'declares-canonical',
        label: 'declares canonical origin',
        sourceLabel: 'HTML canonical metadata',
        observedAt,
        completeness: sourceCompleteness(input.pageIdentity),
        limitations: limitations(record(input.pageIdentity).limitations),
        lenses: ['identity'],
        href: '#evidence-page-identity',
      },
      'Publisher-declared canonical origin',
      identitySource,
    );
  }
  const openGraphHost = urlHost(record(input.pageOpenGraphUrl).url);
  if (openGraphHost) {
    connect(
      'identity',
      openGraphHost,
      {
        kind: 'declares-open-graph',
        label: 'declares Open Graph origin',
        sourceLabel: 'Open Graph metadata',
        observedAt,
        completeness: sourceCompleteness(input.pageIdentity),
        limitations: limitations(record(input.pageIdentity).limitations),
        lenses: ['identity'],
        href: '#evidence-page-identity',
      },
      'Publisher-declared Open Graph origin',
      identitySource,
    );
  }
  for (const origin of textList(record(input.pageForms).externalActionOrigins)) {
    const host = urlHost(origin);
    if (host) {
      connect(
        'identity',
        host,
        {
          kind: 'form-destination',
          label: 'form may submit to',
          sourceLabel: 'Static HTML form',
          observedAt,
          completeness: sourceCompleteness(input.pageIdentity),
          limitations: ['A declared form action does not prove that a user submitted data or that the endpoint received it.'],
          lenses: ['identity'],
          href: '#evidence-page-identity',
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
          href: '#evidence-page-identity',
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
          href: '#evidence-page-identity',
        },
        text(identifier.type, 80),
        identitySource,
      );
    }
  }

  const tlsEvidence = record(input.tlsEvidence);
  const certificate = record(input.tlsCertificate);
  const fingerprint = text(certificate.fingerprintSha256, 80);
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
        fingerprint,
      )
    : null;
  if (certificateId) {
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
          lenses: ['certificate'],
          href: '#evidence-tls',
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
      const issuerId = addNode('identity', issuerLabel, 'Certificate issuer');
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
  }

  return {
    version: 1,
    targetId,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    truncated,
    limitations: [
      'The graph contains only settled evidence from this Lookup and does not start additional requests.',
      'Shared infrastructure, certificates, resources, or identifiers do not establish ownership, control, intent, or maliciousness.',
      'An observed address can represent a CDN, proxy, load balancer, or shared service rather than an origin host.',
      'Missing and incomplete sources remain explicit and are not represented as absent relationships.',
    ],
  };
}

export function projectLookupAssetGraph(
  graph: LookupAssetGraph,
  lens: LookupAssetGraphLens,
): LookupAssetGraphProjection {
  const acceptedEdges = graph.edges.filter((edge) => lens === 'all'
    ? edge.lenses.includes('all') || edge.lenses.length > 0
    : edge.lenses.includes(lens));
  const nodeIds = new Set([graph.targetId]);
  for (const edge of acceptedEdges) {
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }
  const nodes = graph.nodes
    .filter((node) => nodeIds.has(node.id))
    .map((node) => ({
      id: node.id,
      label: node.label,
      kind: node.kind,
      detail: node.detail,
    }));
  const links = acceptedEdges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    kind: edge.completeness === 'complete' ? 'observed' : 'derived',
    detail: `${edge.label} · ${edge.sourceLabel}`,
  }));
  return { nodes, links, edges: acceptedEdges };
}
