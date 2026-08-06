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

type Dependency = Readonly<{
  label: string;
  evidenceId: string | null;
  mode: LookupEvidenceImpactMode;
  href?: `#${string}`;
}>;

function dependencyList(...items: Dependency[]): readonly Dependency[] {
  return Object.freeze(items);
}

const CLAIM_DEPENDENCIES: Readonly<Record<string, readonly Dependency[]>> = Object.freeze({
  'registration-state': dependencyList(
    { label: 'Authoritative registry evidence', evidenceId: 'rdap', mode: 'network_collection', href: '#registry' },
    { label: 'Settled authority-aware availability state', evidenceId: 'availability', mode: 'local_review', href: '#registry' },
  ),
  'current-web-observation': dependencyList(
    { label: 'HTTP observation', evidenceId: 'http', mode: 'network_collection', href: '#evidence-http' },
    { label: 'TLS observation', evidenceId: 'tls', mode: 'network_collection', href: '#evidence-tls' },
  ),
  'brand-resemblance': dependencyList(
    { label: 'Page identity observation', evidenceId: 'page-identity', mode: 'network_collection', href: '#evidence-page' },
    { label: 'Reviewed Brand Profile', evidenceId: null, mode: 'local_review', href: '#case-response' },
  ),
  'controlled-change': dependencyList(
    { label: 'Authoritative registry evidence', evidenceId: 'rdap', mode: 'network_collection', href: '#registry' },
    { label: 'DNS observation', evidenceId: 'dns', mode: 'network_collection', href: '#evidence-dns' },
  ),
  'incident-response': dependencyList(
    { label: 'HTTP observation', evidenceId: 'http', mode: 'network_collection', href: '#evidence-http' },
    { label: 'Page identity observation', evidenceId: 'page-identity', mode: 'network_collection', href: '#evidence-page' },
    { label: 'Reviewed case and recipient route', evidenceId: null, mode: 'local_review', href: '#case-response' },
  ),
  'network-context': dependencyList(
    { label: 'Authoritative RDAP evidence', evidenceId: 'rdap', mode: 'network_collection', href: '#registry' },
  ),
});

function dependencies(entry: LookupClaimReadinessEntry): Dependency[] {
  const known = CLAIM_DEPENDENCIES[entry.id] ?? [];
  const byLabel = new Map(known.map((item) => [item.label.toLowerCase(), item]));
  return entry.missingEvidence.map((label) => byLabel.get(label.toLowerCase()) ?? {
    label,
    evidenceId: null,
    mode: 'local_review',
    href: entry.href,
  });
}

export function buildLookupEvidenceImpactPlan(input: Readonly<{
  readiness: LookupClaimReadiness;
  quality: LookupEvidenceQualityMatrix;
}>): LookupEvidenceImpactPlan {
  const qualityById = new Map(input.quality.entries.map((entry) => [entry.id, entry]));
  const items: LookupEvidenceImpactItem[] = [];
  for (const claim of input.readiness.entries) {
    if (claim.state === 'ready') continue;
    for (const dependency of dependencies(claim)) {
      const quality = dependency.evidenceId ? qualityById.get(dependency.evidenceId) : undefined;
      const outcomeIfSettled: LookupEvidenceImpactOutcome = claim.missingEvidence.length <= 1 ? 'ready' : 'limited';
      items.push(Object.freeze({
        id: `${claim.id}:${dependency.evidenceId ?? dependency.label.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}`,
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
        href: dependency.href ?? claim.href,
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
