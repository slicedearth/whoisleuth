import type {
  WebsiteIdentityDigests,
  WebsiteProfileSnapshot,
} from './website-snapshot-model.ts';

export const WEBSITE_PROFILE_CLUSTER_VERSION = 1;
export const MAX_WEBSITE_PROFILE_CLUSTERS = 80;
export const MAX_WEBSITE_PROFILE_CLUSTER_DOMAINS = 20;

export type WebsiteProfileCluster = Readonly<{
  id: string;
  kind: 'technology' | 'identity';
  label: string;
  evidence: string;
  domains: readonly string[];
  observations: readonly {
    domain: string;
    snapshotId: string;
    observedAt: string;
    complete: boolean;
    truncated: boolean;
  }[];
  complete: boolean;
  truncated: boolean;
  limitations: readonly string[];
}>;
export type WebsiteProfileClusterSummary = Readonly<{
  version: 1;
  snapshotsReviewed: number;
  domainsReviewed: number;
  clusters: readonly WebsiteProfileCluster[];
  truncated: boolean;
  limitations: readonly string[];
}>;

const IDENTITY_LABELS: Record<keyof WebsiteIdentityDigests, string> = {
  normalizedHtml: 'Normalized page structure',
  visibleText: 'Visible-text digest',
  domStructure: 'DOM structure',
  formStructure: 'Form structure',
  resourceHosts: 'Resource-host set',
  trackingIdentifiers: 'Tracking-identifier set',
  faviconHash: 'Favicon hash',
};

function latestPerDomain(
  snapshots: readonly WebsiteProfileSnapshot[],
): WebsiteProfileSnapshot[] {
  const latest = new Map<string, WebsiteProfileSnapshot>();
  for (const snapshot of snapshots.slice(0, 120)) {
    const current = latest.get(snapshot.domain);
    if (!current || snapshot.observedAt > current.observedAt
      || (snapshot.observedAt === current.observedAt && snapshot.savedAt > current.savedAt)) {
      latest.set(snapshot.domain, snapshot);
    }
  }
  return [...latest.values()].sort((left, right) => left.domain.localeCompare(right.domain));
}

type ClusterInput = {
  kind: WebsiteProfileCluster['kind'];
  key: string;
  label: string;
  evidence: string;
  snapshots: WebsiteProfileSnapshot[];
};

function add(
  values: Map<string, ClusterInput>,
  input: Omit<ClusterInput, 'snapshots'>,
  snapshot: WebsiteProfileSnapshot,
): void {
  const existing = values.get(input.key);
  if (existing) {
    existing.snapshots.push(snapshot);
    return;
  }
  values.set(input.key, { ...input, snapshots: [snapshot] });
}

function cluster(input: ClusterInput): WebsiteProfileCluster | null {
  const byDomain = new Map(input.snapshots.map((snapshot) => [snapshot.domain, snapshot]));
  if (byDomain.size < 2) return null;
  const snapshots = [...byDomain.values()]
    .sort((left, right) => left.domain.localeCompare(right.domain));
  const retained = snapshots.slice(0, MAX_WEBSITE_PROFILE_CLUSTER_DOMAINS);
  const truncated = snapshots.length > retained.length;
  return {
    id: `${input.kind}:${input.key}`,
    kind: input.kind,
    label: input.label,
    evidence: input.evidence,
    domains: retained.map((snapshot) => snapshot.domain),
    observations: retained.map((snapshot) => ({
      domain: snapshot.domain,
      snapshotId: snapshot.id,
      observedAt: snapshot.observedAt,
      complete: snapshot.complete,
      truncated: snapshot.truncated,
    })),
    complete: retained.every((snapshot) => snapshot.complete && !snapshot.truncated),
    truncated,
    limitations: [
      'The relationship is an exact match between explicitly saved compact website-profile snapshots.',
      input.kind === 'technology'
        ? 'A shared technology can be common across unrelated sites and does not prove common ownership, authorship, hosting, intent, or coordination.'
        : 'A shared digest can reflect a common template, service, library, placeholder, or copied content and does not prove common ownership, authorship, intent, or coordination.',
      'Only the latest retained snapshot for each domain is included; historical relationships may differ.',
      ...(truncated ? [`The cluster exceeds ${MAX_WEBSITE_PROFILE_CLUSTER_DOMAINS} domains and is capped.`] : []),
    ],
  };
}

export function buildWebsiteProfileClusters(
  snapshots: readonly WebsiteProfileSnapshot[],
): WebsiteProfileClusterSummary {
  const latest = latestPerDomain(snapshots);
  const values = new Map<string, ClusterInput>();
  for (const snapshot of latest) {
    for (const technology of snapshot.technologies.slice(0, 40)) {
      add(values, {
        kind: 'technology',
        key: `technology:${technology.id}`,
        label: technology.name,
        evidence: `${technology.category} · ${technology.confidence} confidence`,
      }, snapshot);
    }
    for (const [field, label] of Object.entries(IDENTITY_LABELS) as Array<[keyof WebsiteIdentityDigests, string]>) {
      const digest = snapshot.identity[field];
      if (!digest) continue;
      add(values, {
        kind: 'identity',
        key: `identity:${field}:${digest}`,
        label,
        evidence: `${digest.slice(0, 12)}…`,
      }, snapshot);
    }
  }
  const allClusters = [...values.values()]
    .map(cluster)
    .filter((item): item is WebsiteProfileCluster => item !== null)
    .sort((left, right) => (
      right.domains.length - left.domains.length
      || left.kind.localeCompare(right.kind)
      || left.label.localeCompare(right.label)
    ));
  const clusters = allClusters.slice(0, MAX_WEBSITE_PROFILE_CLUSTERS);
  return {
    version: WEBSITE_PROFILE_CLUSTER_VERSION,
    snapshotsReviewed: Math.min(snapshots.length, 120),
    domainsReviewed: latest.length,
    clusters,
    truncated: allClusters.length > clusters.length || snapshots.length > 120,
    limitations: [
      'This view is derived locally from browser-saved compact snapshots and makes no request.',
      'Only exact curated identifiers and digests are grouped. A missing cluster does not establish that pages are unrelated.',
      'Source incompleteness and truncation remain visible and are not converted into absence.',
      'Clusters are review pivots, not ownership, attribution, coordination, hosting, intent, safety, or maliciousness findings.',
    ],
  };
}

export function filterWebsiteProfileClusters(
  summary: WebsiteProfileClusterSummary,
  query: string,
): WebsiteProfileCluster[] {
  const normalized = query.trim().toLowerCase().slice(0, 200);
  if (!normalized) return [...summary.clusters];
  return summary.clusters.filter((item) => (
    item.label.toLowerCase().includes(normalized)
    || item.evidence.toLowerCase().includes(normalized)
    || item.kind.includes(normalized)
    || item.domains.some((domain) => domain.includes(normalized))
  ));
}
