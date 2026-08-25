import type {
  DecisionFact,
  DecisionFactEvidenceState,
  DecisionFactFreshness,
  DecisionFactPresentationDescriptor,
  DecisionFactProvenance,
} from '../../../../packages/evidence/decision-fact.mts';
import type { EvidenceCoverageState } from './evidence-coverage-ledger.ts';
import type {
  LookupClaimReadiness,
  LookupClaimReadinessEntry,
  LookupClaimReadinessState,
  LookupClaimRequirement,
} from './lookup-claim-readiness.ts';
import {
  buildLookupEvidenceQualityModel,
  type LookupEvidenceQualityContributorPresentation,
  type LookupEvidenceQualityPresentationEntry,
} from './lookup-evidence-quality-model.ts';
import type { LookupEvidenceQualityMatrix } from './lookup-decision-support.ts';

export const LOOKUP_EVIDENCE_IMPACT_VERSION = 2;
export const MAX_LOOKUP_EVIDENCE_IMPACT_ITEMS = 12;

export type LookupEvidenceImpactMode = 'network_collection' | 'local_review';
export type LookupEvidenceImpactOutcome = 'ready' | 'limited';
export type LookupReviewActionBasis =
  | 'decision_fact'
  | 'task_context'
  | 'case_context'
  | 'unbound_requirement';

export type LookupEvidenceImpactContributor = Readonly<{
  id: string;
  label: string;
  provenance: DecisionFactProvenance;
  provenancePresentation: DecisionFactPresentationDescriptor;
  evidenceState: DecisionFactEvidenceState;
  evidencePresentation: DecisionFactPresentationDescriptor;
  observedAt: string | null;
  limitations: readonly string[];
}>;

export type LookupEvidenceImpactItem = Readonly<{
  id: string;
  claimId: string;
  claimLabel: string;
  currentState: Exclude<LookupClaimReadinessState, 'ready'>;
  requirementId: string;
  requirementLabel: string;
  evidenceId: string | null;
  evidenceLabel: string;
  mode: LookupEvidenceImpactMode;
  basis: LookupReviewActionBasis;
  basisLabel: string;
  priority: 'high' | 'medium';
  outcomeIfSettled: LookupEvidenceImpactOutcome;
  reason: string;
  expectedEffect: string;
  disclosure: string;
  endpointClass: string;
  refreshAvailable: boolean;
  href: `#${string}`;
  factId: string | null;
  evidenceState: DecisionFactEvidenceState | null;
  evidencePresentation: DecisionFactPresentationDescriptor | null;
  freshness: DecisionFactFreshness | null;
  freshnessPresentation: DecisionFactPresentationDescriptor | null;
  contributors: readonly LookupEvidenceImpactContributor[];
  limitations: readonly string[];
  unattributedLimitations: readonly string[];
}>;

export type LookupEvidenceImpactPlan = Readonly<{
  version: typeof LOOKUP_EVIDENCE_IMPACT_VERSION;
  items: readonly LookupEvidenceImpactItem[];
  total: number;
  displayedCount: number;
  omittedCount: number;
  claimCount: number;
  networkCollectionCount: number;
  localReviewCount: number;
  limitation: string;
}>;

const MAX_READINESS_ENTRIES = 12;
const MAX_REQUIREMENTS_PER_CLAIM = 12;
const SAFE_FRAGMENT = /^#[a-z0-9](?:[a-z0-9._:-]{0,159})$/u;
const READINESS_STATES = new Set<LookupClaimReadinessState>(['ready', 'limited', 'not_ready']);
const REQUIREMENT_MODES = new Set<LookupEvidenceImpactMode>(['network_collection', 'local_review']);
const COVERAGE_STATES = new Set<EvidenceCoverageState>([
  'complete',
  'not_found',
  'skipped',
  'partial',
  'unsupported',
  'unavailable',
  'unknown',
]);
const COVERAGE_STATE: Readonly<Record<EvidenceCoverageState, DecisionFactEvidenceState>> = Object.freeze({
  complete: 'observed',
  not_found: 'not_observed_in_bounded_evidence',
  skipped: 'not_collected',
  partial: 'partial',
  unsupported: 'unsupported',
  unavailable: 'unavailable',
  unknown: 'unknown',
});
const CONTEXTUAL_REQUIREMENT_BASIS: Readonly<Record<string, LookupReviewActionBasis>> = Object.freeze({
  'registry-control-selection': 'unbound_requirement',
  'reviewed-brand-profile': 'task_context',
  'reviewed-case-recipient': 'case_context',
});
const BASIS_LABELS: Readonly<Record<LookupReviewActionBasis, string>> = Object.freeze({
  decision_fact: 'Decision Fact',
  task_context: 'Task context',
  case_context: 'Case context',
  unbound_requirement: 'Unbound requirement',
});

function presentation(value: DecisionFactPresentationDescriptor): DecisionFactPresentationDescriptor {
  return Object.freeze({
    label: value.label,
    explanation: value.explanation,
    tone: value.tone,
    icon: value.icon,
    assistiveText: value.assistiveText,
  });
}

function contributor(value: LookupEvidenceQualityContributorPresentation): LookupEvidenceImpactContributor {
  return Object.freeze({
    id: value.id,
    label: value.label,
    provenance: value.provenance,
    provenancePresentation: presentation(value.provenancePresentation),
    evidenceState: value.evidenceState,
    evidencePresentation: presentation(value.evidencePresentation),
    observedAt: value.observedAt,
    limitations: Object.freeze([...value.limitations]),
  });
}

function validateReadiness(readiness: LookupClaimReadiness): void {
  if (readiness.version !== 2 || !Array.isArray(readiness.entries)) {
    throw new TypeError('Lookup evidence impact requires Evidence Readiness version 2.');
  }
  if (readiness.entries.length > MAX_READINESS_ENTRIES) {
    throw new RangeError('Lookup evidence impact received too many Evidence Readiness entries.');
  }
  const claimIds = new Set<string>();
  const counts: Record<LookupClaimReadinessState, number> = { ready: 0, limited: 0, not_ready: 0 };
  for (const claim of readiness.entries as readonly LookupClaimReadinessEntry[]) {
    if (claimIds.has(claim.id)) {
      throw new TypeError(`Lookup evidence impact claim identifier is ambiguous: ${claim.id}.`);
    }
    claimIds.add(claim.id);
    if (!READINESS_STATES.has(claim.state) || !Array.isArray(claim.requirements)) {
      throw new TypeError(`Lookup evidence impact claim ${claim.id} is not a bounded readiness value.`);
    }
    if (claim.requirements.length > MAX_REQUIREMENTS_PER_CLAIM) {
      throw new RangeError(`Lookup evidence impact claim ${claim.id} has too many requirements.`);
    }
    const requirementIds = new Set<string>();
    for (const requirement of claim.requirements) {
      if (requirementIds.has(requirement.id)) {
        throw new TypeError(`Lookup evidence impact requirement identifier is ambiguous: ${requirement.id}.`);
      }
      requirementIds.add(requirement.id);
      if (!REQUIREMENT_MODES.has(requirement.mode) || !SAFE_FRAGMENT.test(requirement.href)) {
        throw new TypeError(`Lookup evidence impact requirement ${requirement.id} is not a safe bounded value.`);
      }
      if (requirement.evidenceId
        ? !requirement.coverageState || !COVERAGE_STATES.has(requirement.coverageState)
        : requirement.coverageState !== null) {
        throw new TypeError(`Lookup evidence impact requirement ${requirement.id} has a mismatched evidence identity and coverage state.`);
      }
    }
    counts[claim.state] += 1;
  }
  for (const state of READINESS_STATES) {
    if (!Number.isSafeInteger(readiness.counts[state]) || readiness.counts[state] !== counts[state]) {
      throw new RangeError('Lookup evidence impact Evidence Readiness counts did not reconcile.');
    }
  }
}

function contextualBasis(requirement: LookupClaimRequirement): LookupReviewActionBasis {
  const basis = CONTEXTUAL_REQUIREMENT_BASIS[requirement.id];
  if (!basis) {
    throw new TypeError(`Lookup evidence impact requirement ${requirement.id} has no evidence identifier or approved contextual basis.`);
  }
  if ((basis === 'task_context' || basis === 'case_context') && requirement.mode !== 'local_review') {
    throw new TypeError(`Lookup evidence impact contextual requirement ${requirement.id} must remain a local review.`);
  }
  if (basis === 'unbound_requirement' && requirement.mode !== 'network_collection') {
    throw new TypeError(`Lookup evidence impact unbound requirement ${requirement.id} must retain its declared network mode.`);
  }
  return basis;
}

function expectedEffect(
  claim: LookupClaimReadinessEntry,
  remainingRequirementCount: number,
  lead = 'An additional complete observation could',
): Readonly<{ outcome: LookupEvidenceImpactOutcome; text: string }> {
  if (remainingRequirementCount <= 1) {
    return Object.freeze({
      outcome: 'ready',
      text: `${lead} reduce the final known evidence limitation for “${claim.label}”, but it may expose a new limitation or disagreement.`,
    });
  }
  return Object.freeze({
    outcome: 'limited',
    text: `${lead} reduce one limitation for “${claim.label}”, but other required evidence would remain.`,
  });
}

function factBackedItem(
  claim: LookupClaimReadinessEntry,
  requirement: LookupClaimRequirement,
  evidence: LookupEvidenceQualityPresentationEntry,
  remainingRequirementCount: number,
): LookupEvidenceImpactItem {
  if (!requirement.coverageState) {
    throw new TypeError(`Lookup evidence impact requirement ${requirement.id} has no canonical coverage state.`);
  }
  const expectedState = COVERAGE_STATE[requirement.coverageState];
  if (evidence.factId !== `lookup-evidence:${requirement.evidenceId}`
    || evidence.evidenceState !== expectedState) {
    throw new TypeError(`Lookup evidence impact requirement ${requirement.id} does not match canonical fact ${evidence.factId}.`);
  }
  const effect = expectedEffect(claim, remainingRequirementCount);
  const freshness = evidence.freshnessPresentation.label.toLowerCase();
  const disclosure = requirement.mode === 'network_collection'
    ? evidence.requestDisclosure
      ?? `Any deliberate collection would disclose the target to the ${evidence.endpointClass}; no request starts from this review disclosure, and a future result may remain limited.`
    : 'This step uses analyst-reviewed browser-local context and does not start a network request.';
  return Object.freeze({
    id: `${claim.id}:${requirement.id}`,
    claimId: claim.id,
    claimLabel: claim.label,
    currentState: claim.state as Exclude<LookupClaimReadinessState, 'ready'>,
    requirementId: requirement.id,
    requirementLabel: requirement.label,
    evidenceId: requirement.evidenceId,
    evidenceLabel: evidence.label,
    mode: requirement.mode,
    basis: 'decision_fact',
    basisLabel: BASIS_LABELS.decision_fact,
    priority: claim.state === 'not_ready' ? 'high' : 'medium',
    outcomeIfSettled: effect.outcome,
    reason: `${evidence.label} is ${evidence.statePresentation.label.toLowerCase()} with ${freshness} freshness and currently limits this statement.`,
    expectedEffect: effect.text,
    disclosure,
    endpointClass: evidence.endpointClass,
    refreshAvailable: evidence.refreshAvailable,
    href: requirement.href,
    factId: evidence.factId,
    evidenceState: evidence.evidenceState,
    evidencePresentation: presentation(evidence.statePresentation),
    freshness: evidence.freshness,
    freshnessPresentation: presentation(evidence.freshnessPresentation),
    contributors: Object.freeze(evidence.contributors.map(contributor)),
    limitations: Object.freeze([...evidence.limitations]),
    unattributedLimitations: Object.freeze([...evidence.unattributedLimitations]),
  });
}

function contextualItem(
  claim: LookupClaimReadinessEntry,
  requirement: LookupClaimRequirement,
  remainingRequirementCount: number,
): LookupEvidenceImpactItem {
  const basis = contextualBasis(requirement);
  const effect = expectedEffect(
    claim,
    remainingRequirementCount,
    basis === 'unbound_requirement'
      ? 'Binding and completing a separately authorised collection could'
      : 'Completing this contextual review could',
  );
  const reason = basis === 'unbound_requirement'
    ? 'This declared requirement has no source evidence identifier and remains unbound to collected evidence.'
    : `This step depends on reviewed ${basis === 'case_context' ? 'case' : 'task'} context and remains contextual; no collected-evidence fact or provenance is attributed.`;
  const disclosure = requirement.mode === 'network_collection'
    ? 'This requirement declares network collection, but no evidence identifier or collection route is bound. Reviewing it starts no request.'
    : 'This step uses analyst-reviewed browser-local context and does not start a network request.';
  return Object.freeze({
    id: `${claim.id}:${requirement.id}`,
    claimId: claim.id,
    claimLabel: claim.label,
    currentState: claim.state as Exclude<LookupClaimReadinessState, 'ready'>,
    requirementId: requirement.id,
    requirementLabel: requirement.label,
    evidenceId: null,
    evidenceLabel: requirement.label,
    mode: requirement.mode,
    basis,
    basisLabel: BASIS_LABELS[basis],
    priority: claim.state === 'not_ready' ? 'high' : 'medium',
    outcomeIfSettled: effect.outcome,
    reason,
    expectedEffect: effect.text,
    disclosure,
    endpointClass: requirement.mode === 'network_collection'
      ? 'Unbound source-specific collection'
      : 'Browser-local analyst review',
    refreshAvailable: false,
    href: requirement.href,
    factId: null,
    evidenceState: null,
    evidencePresentation: null,
    freshness: null,
    freshnessPresentation: null,
    contributors: Object.freeze([]),
    limitations: Object.freeze([...requirement.limitations]),
    unattributedLimitations: Object.freeze([...requirement.limitations]),
  });
}

export function buildLookupEvidenceImpactPlan(input: Readonly<{
  readiness: LookupClaimReadiness;
  quality: LookupEvidenceQualityMatrix;
  facts: readonly DecisionFact[];
}>): LookupEvidenceImpactPlan {
  validateReadiness(input.readiness);
  const quality = buildLookupEvidenceQualityModel({ matrix: input.quality, facts: input.facts });
  const evidenceById = new Map(quality.entries.map((entry) => [entry.id, entry]));
  const candidates: LookupEvidenceImpactItem[] = [];
  for (const claim of input.readiness.entries) {
    if (claim.state === 'ready') continue;
    const missingRequirements = claim.requirements.filter((requirement) => requirement.state !== 'complete');
    for (const requirement of missingRequirements) {
      if (requirement.evidenceId) {
        const evidence = evidenceById.get(requirement.evidenceId);
        if (!evidence) {
          throw new TypeError(`Lookup evidence impact is missing canonical coverage fact lookup-evidence:${requirement.evidenceId}.`);
        }
        candidates.push(factBackedItem(claim, requirement, evidence, missingRequirements.length));
      } else {
        candidates.push(contextualItem(claim, requirement, missingRequirements.length));
      }
    }
  }
  const items = Object.freeze(candidates.slice(0, MAX_LOOKUP_EVIDENCE_IMPACT_ITEMS));
  const total = candidates.length;
  const displayedCount = items.length;
  const omittedCount = total - displayedCount;
  if (total !== displayedCount + omittedCount) {
    throw new RangeError('Lookup evidence impact counts did not reconcile.');
  }
  return Object.freeze({
    version: LOOKUP_EVIDENCE_IMPACT_VERSION,
    items,
    total,
    displayedCount,
    omittedCount,
    claimCount: new Set(candidates.map((item) => item.claimId)).size,
    networkCollectionCount: candidates.filter((item) => item.mode === 'network_collection').length,
    localReviewCount: candidates.filter((item) => item.mode === 'local_review').length,
    limitation: 'An additional observation may reduce a limitation, but never guarantees that a claim becomes true, a target becomes safe or available, a disagreement disappears, a response becomes authorised, or a source returns complete evidence.',
  });
}
