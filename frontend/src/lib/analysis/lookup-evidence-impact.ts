import type {
  LookupClaimReadiness,
  LookupClaimReadinessEntry,
  LookupClaimReadinessState,
} from './lookup-claim-readiness.ts';
import type { LookupEvidenceQualityMatrix } from './lookup-decision-support.ts';

export const LOOKUP_EVIDENCE_IMPACT_VERSION = 1;
export const MAX_LOOKUP_EVIDENCE_IMPACT_ITEMS = 12;

export type LookupEvidenceImpactMode = 'network_collection' | 'local_review';
export type LookupEvidenceImpactOutcome = 'ready' | 'limited';

export type LookupEvidenceImpactItem = Readonly<{
  id: string;
  claimId: string;
  claimLabel: string;
  currentState: Exclude<LookupClaimReadinessState, 'ready'>;
  evidenceId: string | null;
  evidenceLabel: string;
  mode: LookupEvidenceImpactMode;
  priority: 'high' | 'medium';
  outcomeIfSettled: LookupEvidenceImpactOutcome;
  reason: string;
  expectedEffect: string;
  disclosure: string;
  endpointClass: string;
  href: `#${string}`;
}>;

export type LookupEvidenceImpactPlan = Readonly<{
  version: typeof LOOKUP_EVIDENCE_IMPACT_VERSION;
  items: readonly LookupEvidenceImpactItem[];
  claimCount: number;
  networkCollectionCount: number;
  localReviewCount: number;
  limitation: string;
}>;

export function buildLookupEvidenceImpactPlan(input: Readonly<{
  readiness: LookupClaimReadiness;
  quality: LookupEvidenceQualityMatrix;
}>): LookupEvidenceImpactPlan {
  const qualityById = new Map(input.quality.entries.map((entry) => [entry.id, entry]));
  const items: LookupEvidenceImpactItem[] = [];
  for (const claim of input.readiness.entries) {
    if (claim.state === 'ready') continue;
    for (const dependency of claim.requirements.filter((requirement) => requirement.state !== 'complete')) {
      const quality = dependency.evidenceId ? qualityById.get(dependency.evidenceId) : undefined;
      const outcomeIfSettled: LookupEvidenceImpactOutcome = claim.missingEvidence.length <= 1 ? 'ready' : 'limited';
      items.push(Object.freeze({
        id: `${claim.id}:${dependency.id}`,
        claimId: claim.id,
        claimLabel: claim.label,
        currentState: claim.state,
        evidenceId: dependency.evidenceId,
        evidenceLabel: dependency.label,
        mode: dependency.mode,
        priority: claim.state === 'not_ready' ? 'high' : 'medium',
        outcomeIfSettled,
        reason: quality
          ? `${quality.label} is ${quality.statusLabel.toLowerCase()} and currently limits this statement.`
          : `${dependency.label} has not been supplied as reviewed local context.`,
        expectedEffect: outcomeIfSettled === 'ready'
          ? `A complete observation could make “${claim.label}” evidence-ready, provided no new limitation or disagreement appears.`
          : `A complete observation could reduce one limitation for “${claim.label}”, but other required evidence would remain.`,
        disclosure: dependency.mode === 'network_collection'
          ? `A deliberate refresh would disclose the target to the ${quality?.endpointClass ?? 'source-specific endpoint'} and may still return a limited result.`
          : 'This step uses analyst-reviewed browser-local context and does not start a network request.',
        endpointClass: quality?.endpointClass ?? 'Browser-local analyst review',
        href: dependency.href,
      }));
      if (items.length >= MAX_LOOKUP_EVIDENCE_IMPACT_ITEMS) break;
    }
    if (items.length >= MAX_LOOKUP_EVIDENCE_IMPACT_ITEMS) break;
  }
  return Object.freeze({
    version: LOOKUP_EVIDENCE_IMPACT_VERSION,
    items: Object.freeze(items),
    claimCount: new Set(items.map((item) => item.claimId)).size,
    networkCollectionCount: items.filter((item) => item.mode === 'network_collection').length,
    localReviewCount: items.filter((item) => item.mode === 'local_review').length,
    limitation: 'These are counterfactual planning aids. A complete observation may expose new disagreements and never guarantees that a claim becomes true, safe, or actionable.',
  });
}
