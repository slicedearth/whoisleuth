import type { ContextReview } from '../../../../packages/contracts/context-review.mts';
import { groupPlatformObjects, readPlatformObjects } from '../../../../packages/investigation/platform-continuity-review.mts';
import { readStorefrontObservation, STOREFRONT_FIELDS } from '../../../../packages/investigation/storefront-review.mts';
import { readIncidentStages } from '../../../../packages/investigation/incident-sequence-review.mts';
import type { ConnectorMetadata } from '../../../../packages/investigation/connector-provenance-review.mts';
import { exact } from '../../../../packages/evidence/artifact-structure.mts';

export const platformPresentation = (raw: unknown) => ({ kind: 'platform' as const, groups: groupPlatformObjects(readPlatformObjects(raw)) });
export const incidentPresentation = (raw: unknown) => ({ kind: 'incident' as const, stages: readIncidentStages(raw) });
export function storefrontPresentation(raw: unknown) {
  const input = exact(raw, ['official', 'candidate', 'authorisedComparator', 'resellerStatus', 'resellerSource'], 'Storefront comparison');
  const official = readStorefrontObservation(input.official), candidate = readStorefrontObservation(input.candidate);
  return { kind: 'storefront' as const, official, candidate, fields: STOREFRONT_FIELDS };
}

/** Transient layout data only; portable reports keep their existing schema. */
export type ContextReviewPresentation = ReturnType<typeof platformPresentation | typeof incidentPresentation | typeof storefrontPresentation>
  | Readonly<{ kind: 'connector'; connectors: readonly ConnectorMetadata[] }>;

export function contextReviewTargets(report: ContextReview): readonly string[] {
  return [...new Set(report.observations.flatMap(row => row.hostname ? [row.hostname] : []))];
}

export function contextReviewSources(report: ContextReview) {
  const sources = new Map<string, { source: string; observedAt: string | null; observations: string[] }>();
  for (const row of report.observations) {
    const key = JSON.stringify([row.source, row.observedAt]);
    const entry = sources.get(key) ?? { source: row.source, observedAt: row.observedAt, observations: [] };
    entry.observations.push(row.label);
    sources.set(key, entry);
  }
  return [...sources.values()];
}
