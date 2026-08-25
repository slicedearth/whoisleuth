// Bounded, review-only clustering over retained cross-case relationship groups.
// Clusters never replace or modify source observations and never imply common
// ownership, control, intent, or maliciousness.

import type {
  CaseRelationshipGroup,
  CaseRelationshipMember,
  CaseRelationshipSummary,
} from './case-relationships.mts';
import {
  classifyCommonInfrastructureAddress,
  type CommonInfrastructureMatch,
} from './common-infrastructure.mts';
import { analyzeBoundedRelationshipGraph } from './bounded-relationship-graph.mts';
import {
  CASE_RELATIONSHIP_CLUSTER_VERSION,
  REVIEWED_RELATIONSHIP_CLUSTERS_SCHEMA,
} from '../contracts/relationship-portability.mts';

export {
  CASE_RELATIONSHIP_CLUSTER_VERSION,
  REVIEWED_RELATIONSHIP_CLUSTERS_SCHEMA,
} from '../contracts/relationship-portability.mts';

export const MAX_RELATIONSHIP_CLUSTERS = 50;
export const MAX_CLUSTER_CASES = 100;
export const MAX_CLUSTER_RELATIONSHIPS = 40;
export const MAX_CLUSTER_ADJUSTMENTS = 100;
export const COMMON_INFRASTRUCTURE_CASE_THRESHOLD = 6;

export type RelationshipClusterConfidence =
  | 'bounded_similarity'
  | 'exact_observation'
  | 'shared_infrastructure';

export type RelationshipCluster = Readonly<{
  id: string;
  cases: readonly CaseRelationshipMember[];
  groups: readonly CaseRelationshipGroup[];
  confidence: RelationshipClusterConfidence;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  complete: boolean | null;
  truncated: boolean;
  sources: readonly string[];
  infrastructureMatches: readonly CommonInfrastructureMatch[];
  limitations: readonly string[];
}>;

export type RelationshipClusterSummary = Readonly<{
  version: typeof CASE_RELATIONSHIP_CLUSTER_VERSION;
  clusters: readonly RelationshipCluster[];
  sourceRelationshipCount: number;
  truncated: boolean;
  limitations: readonly string[];
}>;

export type RelationshipClusterAdjustments = Readonly<{
  labels: Readonly<Record<string, string>>;
  dismissed: readonly string[];
  merged: readonly (readonly string[])[];
  splitCases: Readonly<Record<string, readonly string[]>>;
}>;

export type ReviewedRelationshipCluster = RelationshipCluster & Readonly<{
  sourceClusterIds: readonly string[];
  label: string | null;
  dismissed: boolean;
}>;

export type ReviewedRelationshipClusterSummary = Readonly<{
  version: typeof CASE_RELATIONSHIP_CLUSTER_VERSION;
  clusters: readonly ReviewedRelationshipCluster[];
  sourceRelationshipCount: number;
  adjustmentsTruncated: boolean;
  limitations: readonly string[];
}>;

const COMMON_INFRASTRUCTURE_TYPES = new Set([
  'http_final_origin',
  'ip_address',
  'nameserver_set',
]);
const SIMILARITY_TYPES = new Set(['favicon']);
const CONTROL_REPLACE_RE = /[\u0000-\u001f\u007f]+/gu;

function boundedText(value: unknown, maximum = 80): string {
  return typeof value === 'string'
    ? value.replace(CONTROL_REPLACE_RE, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum)
    : '';
}

function stableHash(value: string): string {
  let result = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function clusterId(caseIds: readonly string[], groupKeys: readonly string[]): string {
  return `cluster-${stableHash(`${[...caseIds].sort().join('|')}::${[...groupKeys].sort().join('|')}`)}`;
}

function groupKey(group: CaseRelationshipGroup): string {
  return `${group.type}:${group.value}`;
}

function validTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function infrastructureMatchesFor(
  groups: readonly CaseRelationshipGroup[],
): CommonInfrastructureMatch[] {
  const matches = new Map<string, CommonInfrastructureMatch>();
  for (const group of groups) {
    if (group.type !== 'ip_address') continue;
    for (const match of classifyCommonInfrastructureAddress(group.value)) {
      matches.set(`${match.sourceId}:${match.cidr}`, match);
      if (matches.size >= 8) break;
    }
    if (matches.size >= 8) break;
  }
  return [...matches.values()]
    .sort((left, right) => left.sourceLabel.localeCompare(right.sourceLabel)
      || left.cidr.localeCompare(right.cidr));
}

function confidenceFor(
  groups: readonly CaseRelationshipGroup[],
  infrastructureMatches = infrastructureMatchesFor(groups),
): RelationshipClusterConfidence {
  if (infrastructureMatches.length) return 'shared_infrastructure';
  if (groups.some((group) => COMMON_INFRASTRUCTURE_TYPES.has(group.type)
    && group.cases.length >= COMMON_INFRASTRUCTURE_CASE_THRESHOLD)) {
    return 'shared_infrastructure';
  }
  if (groups.every((group) => SIMILARITY_TYPES.has(group.type))) return 'bounded_similarity';
  return 'exact_observation';
}

function completenessFor(groups: readonly CaseRelationshipGroup[]): boolean | null {
  if (groups.some((group) => group.complete === false)) return false;
  if (groups.length && groups.every((group) => group.complete === true)) return true;
  return null;
}

function limitationsFor(
  groups: readonly CaseRelationshipGroup[],
  confidence: RelationshipClusterConfidence,
  infrastructureMatches = infrastructureMatchesFor(groups),
): string[] {
  const values = new Set<string>();
  if (infrastructureMatches.length) {
    const labels = [...new Set(infrastructureMatches.map((match) => match.sourceLabel))].slice(0, 4);
    values.add(`Exact catalogue match: ${labels.join(', ')}. The matched range is published as shared infrastructure and does not identify an origin host, tenant, account, operator, ownership, intent, safety, or maliciousness.`);
  }
  if (confidence === 'shared_infrastructure') {
    values.add('This cluster includes infrastructure shared by many cases. Common hosting, DNS, redirect, CDN, and managed-platform services can connect unrelated domains.');
  }
  if (confidence === 'bounded_similarity') {
    values.add('This cluster is based only on bounded similarity evidence and requires review against the underlying observation.');
  }
  for (const group of groups) {
    for (const limitation of group.limitations ?? []) {
      const normalized = boundedText(limitation, 240);
      if (normalized) values.add(normalized);
      if (values.size >= 8) break;
    }
    if (values.size >= 8) break;
  }
  return [...values];
}

export function buildCaseRelationshipClusters(
  summary: CaseRelationshipSummary,
): RelationshipClusterSummary {
  const groups = summary.groups.slice(0, MAX_RELATIONSHIP_CLUSTERS * 2);
  const members = new Map<string, CaseRelationshipMember>();
  const graphEdges: Array<{ source: string; target: string }> = [];

  let truncated = summary.truncated || summary.groups.length > groups.length;
  for (const group of groups) {
    const boundedCases = group.cases.slice(0, MAX_CLUSTER_CASES);
    if (group.cases.length > boundedCases.length) truncated = true;
    for (const member of boundedCases) {
      members.set(member.id, member);
    }
    const first = boundedCases[0];
    if (!first) continue;
    for (const member of boundedCases.slice(1)) graphEdges.push({ source: first.id, target: member.id });
  }

  const graphAnalysis = analyzeBoundedRelationshipGraph([...members.keys()], graphEdges);
  if (graphAnalysis.truncated) truncated = true;

  const output: RelationshipCluster[] = [];
  for (const component of graphAnalysis.components) {
    const cases = component.map((id) => members.get(id)).filter((value): value is CaseRelationshipMember => Boolean(value));
    if (cases.length < 2) continue;
    const caseIds = new Set(cases.map((item) => item.id));
    const relatedGroups = groups
      .filter((group) => group.cases.some((item) => caseIds.has(item.id)))
      .slice(0, MAX_CLUSTER_RELATIONSHIPS);
    if (relatedGroups.length >= MAX_CLUSTER_RELATIONSHIPS
      && groups.some((group) => !relatedGroups.includes(group)
        && group.cases.some((item) => caseIds.has(item.id)))) truncated = true;
    const sortedCases = [...cases]
      .slice(0, MAX_CLUSTER_CASES)
      .sort((left, right) => left.domain.localeCompare(right.domain));
    if (cases.length > sortedCases.length) truncated = true;
    const firstObserved = relatedGroups
      .map((group) => validTimestamp(group.firstObservedAt))
      .filter((value): value is string => value !== null)
      .sort()[0] ?? null;
    const lastObserved = relatedGroups
      .map((group) => validTimestamp(group.lastObservedAt))
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null;
    const infrastructureMatches = infrastructureMatchesFor(relatedGroups);
    const confidence = confidenceFor(relatedGroups, infrastructureMatches);
    const groupKeys = relatedGroups.map(groupKey);
    output.push({
      id: clusterId(sortedCases.map((item) => item.id), groupKeys),
      cases: sortedCases,
      groups: relatedGroups,
      confidence,
      firstObservedAt: firstObserved,
      lastObservedAt: lastObserved,
      complete: completenessFor(relatedGroups),
      truncated: relatedGroups.some((group) => group.truncated === true)
        || relatedGroups.length >= MAX_CLUSTER_RELATIONSHIPS,
      sources: [...new Set(relatedGroups.flatMap((group) => group.sources ?? []))].sort(),
      infrastructureMatches,
      limitations: limitationsFor(relatedGroups, confidence, infrastructureMatches),
    });
  }

  output.sort((left, right) => right.cases.length - left.cases.length
    || right.groups.length - left.groups.length
    || left.cases[0]!.domain.localeCompare(right.cases[0]!.domain));
  if (output.length > MAX_RELATIONSHIP_CLUSTERS) truncated = true;

  return {
    version: CASE_RELATIONSHIP_CLUSTER_VERSION,
    clusters: output.slice(0, MAX_RELATIONSHIP_CLUSTERS),
    sourceRelationshipCount: summary.groups.length,
    truncated,
    limitations: [
      'Clusters are connected components over retained relationship observations. They are review aids, not ownership, coordination, intent, attribution, or maliciousness conclusions.',
      'Common infrastructure is qualified separately because shared DNS, hosting, CDN, redirect, and platform services can connect unrelated domains.',
      'Cluster review controls adjust only the current local view. They do not alter source cases, relationships, or observations.',
      ...summary.limitations,
    ].slice(0, 8),
  };
}

function normalizedIds(value: unknown, allowed: ReadonlySet<string>): string[] {
  return [...new Set((Array.isArray(value) ? value : [])
    .slice(0, MAX_CLUSTER_ADJUSTMENTS * 2)
    .filter((item): item is string => typeof item === 'string' && allowed.has(item)))]
    .slice(0, MAX_CLUSTER_ADJUSTMENTS);
}

export function applyCaseRelationshipClusterAdjustments(
  summary: RelationshipClusterSummary,
  raw: RelationshipClusterAdjustments,
): ReviewedRelationshipClusterSummary {
  const sourceById = new Map(summary.clusters.map((cluster) => [cluster.id, cluster]));
  const sourceIds = new Set(sourceById.keys());
  const dismissed = new Set(normalizedIds(raw.dismissed, sourceIds));
  const consumed = new Set<string>();
  const reviewed: ReviewedRelationshipCluster[] = [];
  let adjustmentsTruncated = raw.dismissed.length > MAX_CLUSTER_ADJUSTMENTS
    || raw.merged.length > MAX_CLUSTER_ADJUSTMENTS;

  function adjustedCluster(cluster: RelationshipCluster): ReviewedRelationshipCluster {
    const split = new Set(normalizedIds(raw.splitCases[cluster.id], new Set(cluster.cases.map((item) => item.id))));
    const cases = cluster.cases.filter((item) => !split.has(item.id));
    return {
      ...cluster,
      cases,
      sourceClusterIds: [cluster.id],
      label: boundedText(raw.labels[cluster.id], 80) || null,
      dismissed: dismissed.has(cluster.id),
    };
  }

  for (const rawMerge of raw.merged.slice(0, MAX_CLUSTER_ADJUSTMENTS)) {
    const mergeIds = normalizedIds(rawMerge, sourceIds).filter((id) => !consumed.has(id));
    if (mergeIds.length < 2) continue;
    const clusters = mergeIds.map((id) => sourceById.get(id)).filter((value): value is RelationshipCluster => Boolean(value));
    clusters.forEach((cluster) => consumed.add(cluster.id));
    const cases = [...new Map(clusters.flatMap((cluster) => adjustedCluster(cluster).cases)
      .map((member) => [member.id, member])).values()]
      .sort((left, right) => left.domain.localeCompare(right.domain))
      .slice(0, MAX_CLUSTER_CASES);
    const groups = [...new Map(clusters.flatMap((cluster) => cluster.groups)
      .map((group) => [groupKey(group), group])).values()]
      .slice(0, MAX_CLUSTER_RELATIONSHIPS);
    const infrastructureMatches = infrastructureMatchesFor(groups);
    const confidence = confidenceFor(groups, infrastructureMatches);
    reviewed.push({
      id: clusterId(cases.map((item) => item.id), groups.map(groupKey)),
      cases,
      groups,
      confidence,
      firstObservedAt: clusters.map((cluster) => cluster.firstObservedAt).filter((value): value is string => value !== null).sort()[0] ?? null,
      lastObservedAt: clusters.map((cluster) => cluster.lastObservedAt).filter((value): value is string => value !== null).sort().at(-1) ?? null,
      complete: completenessFor(groups),
      truncated: clusters.some((cluster) => cluster.truncated)
        || cases.length >= MAX_CLUSTER_CASES
        || groups.length >= MAX_CLUSTER_RELATIONSHIPS,
      sources: [...new Set(clusters.flatMap((cluster) => cluster.sources))].sort(),
      infrastructureMatches,
      limitations: limitationsFor(groups, confidence, infrastructureMatches),
      sourceClusterIds: mergeIds,
      label: mergeIds.map((id) => boundedText(raw.labels[id], 80)).find(Boolean) ?? null,
      dismissed: mergeIds.every((id) => dismissed.has(id)),
    });
  }

  for (const cluster of summary.clusters) {
    if (consumed.has(cluster.id)) continue;
    reviewed.push(adjustedCluster(cluster));
  }

  reviewed.sort((left, right) => Number(left.dismissed) - Number(right.dismissed)
    || right.cases.length - left.cases.length
    || (left.label ?? left.id).localeCompare(right.label ?? right.id));

  return {
    version: CASE_RELATIONSHIP_CLUSTER_VERSION,
    clusters: reviewed,
    sourceRelationshipCount: summary.sourceRelationshipCount,
    adjustmentsTruncated,
    limitations: summary.limitations,
  };
}

export function buildCaseRelationshipClusterExport(
  source: RelationshipClusterSummary,
  adjustments: RelationshipClusterAdjustments,
  generatedAt = new Date().toISOString(),
): Readonly<Record<string, unknown>> {
  return {
    schema: REVIEWED_RELATIONSHIP_CLUSTERS_SCHEMA,
    version: CASE_RELATIONSHIP_CLUSTER_VERSION,
    generatedAt: validTimestamp(generatedAt) ?? new Date(0).toISOString(),
    sourceRelationshipCount: source.sourceRelationshipCount,
    review: applyCaseRelationshipClusterAdjustments(source, adjustments),
    limitations: source.limitations,
  };
}
