import type {
  WebsiteIdentityDigests,
  WebsiteProfileSnapshot,
} from './website-snapshot-model.ts';

export const WEBSITE_PROFILE_CLUSTER_VERSION = 2;
export const MAX_WEBSITE_PROFILE_CLUSTERS = 80;
export const MAX_WEBSITE_PROFILE_CLUSTER_DOMAINS = 20;
export const MAX_WEBSITE_PROFILE_SNAPSHOTS_REVIEWED = 120;
export const MIN_WEBSITE_PROFILE_SIMILARITY = 30;

export type WebsiteProfileContribution = Readonly<{
  field: string;
  label: string;
  method: 'exact' | 'set_overlap' | 'simhash_distance';
  weight: number;
  detail: string;
  sharedValues: readonly string[];
}>;

export type WebsiteProfileCluster = Readonly<{
  id: string;
  kind: 'technology' | 'identity' | 'tracker' | 'form_action' | 'resource_host' | 'similarity';
  label: string;
  evidence: string;
  score: number | null;
  contributingFields: readonly WebsiteProfileContribution[];
  domains: readonly string[];
  firstObservedAt: string;
  lastObservedAt: string;
  observations: readonly {
    domain: string;
    snapshotId: string;
    observedAt: string;
    firstObservedAt: string;
    lastObservedAt: string;
    complete: boolean;
    truncated: boolean;
  }[];
  complete: boolean;
  truncated: boolean;
  limitations: readonly string[];
}>;

export type WebsiteProfileClusterSummary = Readonly<{
  version: 2;
  snapshotsReviewed: number;
  domainsReviewed: number;
  clusters: readonly WebsiteProfileCluster[];
  truncated: boolean;
  limitations: readonly string[];
}>;

const IDENTITY_LABELS: Record<keyof WebsiteIdentityDigests, string> = {
  normalizedHtml: 'Normalized page structure',
  visibleText: 'Visible-text fingerprint',
  domStructure: 'DOM structure',
  formStructure: 'Form structure',
  resourceHosts: 'Resource-host set',
  trackingIdentifiers: 'Tracking-identifier set',
  faviconHash: 'Favicon hash',
};

type ClusterInput = {
  kind: Exclude<WebsiteProfileCluster['kind'], 'similarity'>;
  key: string;
  label: string;
  evidence: string;
  snapshots: WebsiteProfileSnapshot[];
};

function latestPerDomain(snapshots: readonly WebsiteProfileSnapshot[]): WebsiteProfileSnapshot[] {
  const latest = new Map<string, WebsiteProfileSnapshot>();
  for (const snapshot of snapshots.slice(0, MAX_WEBSITE_PROFILE_SNAPSHOTS_REVIEWED)) {
    const current = latest.get(snapshot.domain);
    if (!current || snapshot.observedAt > current.observedAt
      || (snapshot.observedAt === current.observedAt && snapshot.savedAt > current.savedAt)) {
      latest.set(snapshot.domain, snapshot);
    }
  }
  return [...latest.values()].sort((left, right) => left.domain.localeCompare(right.domain));
}

function stableId(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

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

function observationRange(snapshots: readonly WebsiteProfileSnapshot[]) {
  const sorted = [...snapshots].sort((left, right) => (
    left.observedAt.localeCompare(right.observedAt)
    || left.savedAt.localeCompare(right.savedAt)
  ));
  return {
    firstObservedAt: sorted[0]?.observedAt ?? new Date(0).toISOString(),
    lastObservedAt: sorted.at(-1)?.observedAt ?? new Date(0).toISOString(),
  };
}

function exactCluster(input: ClusterInput): WebsiteProfileCluster | null {
  const byDomain = new Map<string, WebsiteProfileSnapshot[]>();
  for (const snapshot of input.snapshots) {
    const current = byDomain.get(snapshot.domain) ?? [];
    current.push(snapshot);
    byDomain.set(snapshot.domain, current);
  }
  if (byDomain.size < 2) return null;
  const domains = [...byDomain.keys()].sort();
  const retainedDomains = domains.slice(0, MAX_WEBSITE_PROFILE_CLUSTER_DOMAINS);
  const truncated = domains.length > retainedDomains.length;
  const observations = retainedDomains.map((domain) => {
    const history = byDomain.get(domain) ?? [];
    const range = observationRange(history);
    const latest = latestPerDomain(history)[0] ?? history[0];
    return {
      domain,
      snapshotId: latest?.id ?? '',
      observedAt: latest?.observedAt ?? range.lastObservedAt,
      firstObservedAt: range.firstObservedAt,
      lastObservedAt: range.lastObservedAt,
      complete: history.every((snapshot) => snapshot.complete),
      truncated: history.some((snapshot) => snapshot.truncated),
    };
  });
  const range = observationRange(input.snapshots);
  return {
    id: `${input.kind}:${stableId(input.key)}`,
    kind: input.kind,
    label: input.label,
    evidence: input.evidence,
    score: null,
    contributingFields: [],
    domains: retainedDomains,
    firstObservedAt: range.firstObservedAt,
    lastObservedAt: range.lastObservedAt,
    observations,
    complete: observations.every((snapshot) => snapshot.complete && !snapshot.truncated),
    truncated,
    limitations: [
      'This relationship is an exact match between explicitly saved compact website-profile observations.',
      input.kind === 'technology'
        ? 'A shared technology is common across unrelated sites and does not prove common ownership, authorship, hosting, intent, or coordination.'
        : 'A shared value or digest can reflect a common service, template, library, placeholder, analytics configuration, or copied content and does not prove common control, intent, or coordination.',
      'First and last observed times describe this browser-local saved history, not internet-wide first or last use.',
      ...(truncated ? [`The cluster exceeds ${MAX_WEBSITE_PROFILE_CLUSTER_DOMAINS} domains and is capped.`] : []),
    ],
  };
}

function intersection(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left.filter((value) => rightSet.has(value)))].sort().slice(0, 8);
}

function hammingDistance64(left: string | null, right: string | null): number | null {
  if (!left || !right || !/^[a-f0-9]{16}$/u.test(left) || !/^[a-f0-9]{16}$/u.test(right)) return null;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    let value = Number.parseInt(left[index] ?? '0', 16) ^ Number.parseInt(right[index] ?? '0', 16);
    while (value) {
      distance += value & 1;
      value >>>= 1;
    }
  }
  return distance;
}

function exactContribution(
  field: keyof WebsiteIdentityDigests,
  left: WebsiteProfileSnapshot,
  right: WebsiteProfileSnapshot,
  weight: number,
): WebsiteProfileContribution | null {
  const leftValue = left.identity[field];
  const rightValue = right.identity[field];
  if (!leftValue || leftValue !== rightValue) return null;
  return {
    field: `identity.${field}`,
    label: IDENTITY_LABELS[field],
    method: 'exact',
    weight,
    detail: 'The latest compatible saved digests are equivalent.',
    sharedValues: [`${leftValue.slice(0, 12)}…`],
  };
}

function setContribution(
  field: string,
  label: string,
  left: readonly string[],
  right: readonly string[],
  weight: number,
): WebsiteProfileContribution | null {
  const shared = intersection(left, right);
  if (!shared.length) return null;
  const ratio = shared.length / Math.max(left.length, right.length, 1);
  const appliedWeight = Math.max(1, Math.round(weight * ratio));
  return {
    field,
    label,
    method: 'set_overlap',
    weight: appliedWeight,
    detail: `${shared.length} shared value${shared.length === 1 ? '' : 's'} across the two bounded saved sets.`,
    sharedValues: shared,
  };
}

function similarityCluster(
  left: WebsiteProfileSnapshot,
  right: WebsiteProfileSnapshot,
): WebsiteProfileCluster | null {
  const contributions = [
    exactContribution('faviconHash', left, right, 24),
    exactContribution('normalizedHtml', left, right, 20),
    exactContribution('trackingIdentifiers', left, right, 14),
    exactContribution('formStructure', left, right, 12),
    exactContribution('resourceHosts', left, right, 10),
    exactContribution('domStructure', left, right, 8),
    setContribution(
      'identityValues.trackingIdentifiers',
      'Tracking identifiers',
      left.identityValues.trackingIdentifiers.map((item) => `${item.type}:${item.value}`),
      right.identityValues.trackingIdentifiers.map((item) => `${item.type}:${item.value}`),
      14,
    ),
    setContribution(
      'identityValues.formActionOrigins',
      'External form-action origins',
      left.identityValues.formActionOrigins,
      right.identityValues.formActionOrigins,
      12,
    ),
    setContribution(
      'identityValues.resourceHosts',
      'Resource hosts',
      left.identityValues.resourceHosts,
      right.identityValues.resourceHosts,
      10,
    ),
    setContribution(
      'technologies',
      'Technology identifiers',
      left.technologies.map((item) => item.id),
      right.technologies.map((item) => item.id),
      6,
    ),
  ].filter((item): item is WebsiteProfileContribution => item !== null);
  const textDistance = hammingDistance64(left.identity.visibleText, right.identity.visibleText);
  if (textDistance !== null && textDistance <= 12) {
    contributions.push({
      field: 'identity.visibleText',
      label: 'Visible-text fingerprint',
      method: 'simhash_distance',
      weight: Math.max(2, Math.round(10 * (1 - textDistance / 64))),
      detail: `The saved 64-bit SimHash values differ by ${textDistance} bit${textDistance === 1 ? '' : 's'}.`,
      sharedValues: [],
    });
  }
  const score = Math.min(100, contributions.reduce((total, item) => total + item.weight, 0));
  const strongField = contributions.some((item) => [
    'identity.faviconHash',
    'identity.normalizedHtml',
    'identity.trackingIdentifiers',
    'identity.formStructure',
    'identityValues.trackingIdentifiers',
    'identityValues.formActionOrigins',
  ].includes(item.field));
  if (score < MIN_WEBSITE_PROFILE_SIMILARITY || (!strongField && contributions.length < 3)) return null;
  const domains = [left.domain, right.domain].sort();
  const observations = domains.map((domain) => {
    const snapshot = domain === left.domain ? left : right;
    return {
      domain,
      snapshotId: snapshot.id,
      observedAt: snapshot.observedAt,
      firstObservedAt: snapshot.observedAt,
      lastObservedAt: snapshot.observedAt,
      complete: snapshot.complete,
      truncated: snapshot.truncated,
    };
  });
  const firstObservedAt = observations.map((item) => item.observedAt).sort()[0] ?? new Date(0).toISOString();
  const lastObservedAt = observations.map((item) => item.observedAt).sort().at(-1) ?? new Date(0).toISOString();
  return {
    id: `similarity:${stableId(domains.join('|'))}`,
    kind: 'similarity',
    label: 'Weighted website-profile relationship',
    evidence: `${score}/100 across ${contributions.length} contributing field${contributions.length === 1 ? '' : 's'}`,
    score,
    contributingFields: contributions,
    domains,
    firstObservedAt,
    lastObservedAt,
    observations,
    complete: observations.every((item) => item.complete && !item.truncated),
    truncated: false,
    limitations: [
      'The weighted result combines only explainable compatible components from the latest browser-saved snapshot for each domain.',
      'Unavailable or incompatible components add no weight and are never interpreted as differences or absence.',
      'Shared page, tracker, form, resource, favicon, text, or technology evidence is an investigative lead and does not prove ownership, authorship, control, coordination, intent, safety, or maliciousness.',
    ],
  };
}

export function buildWebsiteProfileClusters(
  snapshots: readonly WebsiteProfileSnapshot[],
): WebsiteProfileClusterSummary {
  const retainedSnapshots = snapshots.slice(0, MAX_WEBSITE_PROFILE_SNAPSHOTS_REVIEWED);
  const latest = latestPerDomain(retainedSnapshots);
  const values = new Map<string, ClusterInput>();
  for (const snapshot of retainedSnapshots) {
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
    for (const identifier of snapshot.identityValues.trackingIdentifiers) {
      add(values, {
        kind: 'tracker',
        key: `tracker:${identifier.type}:${identifier.value}`,
        label: `${identifier.type} identifier`,
        evidence: identifier.value,
      }, snapshot);
    }
    for (const actionOrigin of snapshot.identityValues.formActionOrigins) {
      add(values, {
        kind: 'form_action',
        key: `form:${actionOrigin}`,
        label: 'External form-action origin',
        evidence: actionOrigin,
      }, snapshot);
    }
    for (const resourceHost of snapshot.identityValues.resourceHosts) {
      add(values, {
        kind: 'resource_host',
        key: `resource:${resourceHost}`,
        label: 'Resource host',
        evidence: resourceHost,
      }, snapshot);
    }
  }
  const exactClusters = [...values.values()]
    .map(exactCluster)
    .filter((item): item is WebsiteProfileCluster => item !== null);
  const similarityClusters: WebsiteProfileCluster[] = [];
  for (let leftIndex = 0; leftIndex < latest.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < latest.length; rightIndex += 1) {
      const left = latest[leftIndex];
      const right = latest[rightIndex];
      if (!left || !right) continue;
      const candidate = similarityCluster(left, right);
      if (candidate) similarityClusters.push(candidate);
    }
  }
  const allClusters = [...exactClusters, ...similarityClusters]
    .sort((left, right) => (
      (right.score ?? -1) - (left.score ?? -1)
      || right.domains.length - left.domains.length
      || left.kind.localeCompare(right.kind)
      || left.label.localeCompare(right.label)
    ));
  const clusters = allClusters.slice(0, MAX_WEBSITE_PROFILE_CLUSTERS);
  return {
    version: WEBSITE_PROFILE_CLUSTER_VERSION,
    snapshotsReviewed: retainedSnapshots.length,
    domainsReviewed: latest.length,
    clusters,
    truncated: allClusters.length > clusters.length || snapshots.length > retainedSnapshots.length,
    limitations: [
      'This view is derived locally from browser-saved compact snapshots and makes no request.',
      'Exact clusters can include compatible historical saved observations; weighted relationships compare only the latest retained snapshot per domain.',
      'Unavailable, truncated, and schema-incompatible components add no similarity weight and are not converted into absence or difference.',
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
    || item.contributingFields.some((field) => (
      field.label.toLowerCase().includes(normalized)
      || field.sharedValues.some((value) => value.toLowerCase().includes(normalized))
    ))
  ));
}

export function buildWebsiteClusterAssertion(
  cluster: WebsiteProfileCluster,
  domain: unknown,
) {
  const normalizedDomain = typeof domain === 'string' && cluster.domains.includes(domain)
    ? domain
    : '';
  if (!normalizedDomain) throw new Error('Choose a domain represented by this saved website-profile relationship.');
  return {
    kind: 'hypothesis',
    state: 'open',
    statement: `Review the saved ${cluster.label.toLowerCase()} relationship for ${normalizedDomain}.`,
    rationale: [
      cluster.evidence,
      `Related saved domains: ${cluster.domains.filter((item) => item !== normalizedDomain).join(', ')}.`,
      'This analyst assertion records a review lead only. The underlying compact observations remain separately retained.',
    ].join(' '),
    evidencePinIds: [],
  };
}
