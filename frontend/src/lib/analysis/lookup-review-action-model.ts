import {
  DECISION_FACT_PRESENTATION_DESCRIPTORS,
  DECISION_FACT_VERSION,
  buildDecisionFacts,
  type DecisionFact,
  type DecisionFactImportance,
  type DecisionFactNextAction,
  type DecisionFactPresentationDescriptor,
} from '../../../../packages/evidence/decision-fact.mts';
import type {
  LookupEvidenceImpactContributor,
  LookupEvidenceImpactItem,
  LookupEvidenceImpactPlan,
  LookupReviewActionBasis,
} from './lookup-evidence-impact.ts';
import {
  MAX_LOOKUP_PRESENTED_ACTIONS,
  MAX_LOOKUP_SOURCE_ACTIONS,
  rankLookupNextActions,
  type LookupDecisionSupport,
  type LookupNextAction,
} from './lookup-decision-support.ts';
import type { LookupTaskView } from './lookup-presentation.ts';

export const LOOKUP_REVIEW_ACTION_MODEL_VERSION = 1 as const;

export type LookupPresentedReviewAction = Readonly<{
  id: string;
  label: string;
  reason: string;
  expectedOutcome: string;
  href: `#${string}`;
  importance: DecisionFactImportance;
  basis: LookupReviewActionBasis;
  basisLabel: string;
  contributingFactIds: readonly string[];
}>;

export type LookupRecommendedReviewQueue = Readonly<{
  rankedItems: readonly LookupPresentedReviewAction[];
  displayedItems: readonly LookupPresentedReviewAction[];
  contributingFactIds: readonly string[];
  total: number;
  displayedCount: number;
  omittedCount: number;
}>;

export type LookupEvidenceImprovementQueue = Readonly<{
  displayedItems: readonly LookupEvidenceImpactItem[];
  total: number;
  displayedCount: number;
  omittedCount: number;
  claimCount: number;
  networkCollectionCount: number;
  localReviewCount: number;
  limitation: string;
}>;

export type LookupReviewActionModel = Readonly<{
  version: typeof LOOKUP_REVIEW_ACTION_MODEL_VERSION;
  recommendedNextReviews: LookupRecommendedReviewQueue;
  evidenceImprovements: LookupEvidenceImprovementQueue;
}>;

type CanonicalActionOccurrence = Readonly<{
  action: DecisionFactNextAction;
  factIds: string[];
}>;
type ContextActionRule = Readonly<{
  basis: 'task_context' | 'case_context';
  tasks: readonly LookupTaskView[];
  href: `#${string}`;
}>;

const SAFE_ID = /^[a-z0-9](?:[a-z0-9._:-]{0,199})$/u;
const SAFE_FRAGMENT = /^#[a-z0-9](?:[a-z0-9._:-]{0,159})$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const TASKS = new Set<LookupTaskView>(['general', 'acquisition', 'brand', 'incident', 'owned']);
const IMPORTANCE = new Set<DecisionFactImportance>(['high', 'medium', 'low']);
const BASIS = new Set<LookupReviewActionBasis>([
  'decision_fact',
  'task_context',
  'case_context',
  'unbound_requirement',
]);
const BASIS_LABELS: Readonly<Record<LookupReviewActionBasis, string>> = Object.freeze({
  decision_fact: 'Decision Fact',
  task_context: 'Task context',
  case_context: 'Case context',
  unbound_requirement: 'Unbound requirement',
});
const FACT_BACKED_ACTION_IDS = new Set([
  'review-priority-conflict',
  'review-refresh-options',
  'inspect-limited-source',
]);
const ALL_TASKS = Object.freeze(['general', 'acquisition', 'brand', 'incident', 'owned'] as const);
const ACQUISITION_TASK = Object.freeze(['acquisition'] as const);
const BRAND_TASK = Object.freeze(['brand'] as const);
const OWNED_TASK = Object.freeze(['owned'] as const);
const CONTEXT_ACTION_RULES: Readonly<Record<string, ContextActionRule>> = Object.freeze({
  'review-page-identity': Object.freeze({ basis: 'task_context', tasks: BRAND_TASK, href: '#web-evidence' }),
  'review-acquisition-dependencies': Object.freeze({ basis: 'task_context', tasks: ACQUISITION_TASK, href: '#web-evidence' }),
  'review-owned-posture': Object.freeze({ basis: 'task_context', tasks: OWNED_TASK, href: '#web-evidence' }),
  'review-case-handoff': Object.freeze({ basis: 'case_context', tasks: ALL_TASKS, href: '#case-response' }),
});

function canonicalFactShape(fact: DecisionFact): string {
  return JSON.stringify({
    version: fact.version,
    id: fact.id,
    question: fact.question,
    conclusion: fact.conclusion,
    importance: fact.importance,
    evidenceState: fact.evidenceState,
    freshness: fact.freshness,
    consistency: fact.consistency,
    contributors: fact.contributors.map((contributor) => ({
      id: contributor.id,
      label: contributor.label,
      provenance: contributor.provenance,
      evidenceState: contributor.evidenceState,
      references: [...contributor.references],
      observedAt: contributor.observedAt,
      limitations: [...contributor.limitations],
    })),
    contributorCount: fact.contributorCount,
    references: [...fact.references],
    contradictions: [...fact.contradictions],
    limitations: [...fact.limitations],
    nextActions: fact.nextActions.map((action) => ({
      id: action.id,
      label: action.label,
      reason: action.reason,
      expectedOutcome: action.expectedOutcome,
      href: action.href,
      importance: action.importance,
    })),
  });
}

function canonicalFacts(facts: readonly DecisionFact[]): readonly DecisionFact[] {
  const canonical = buildDecisionFacts(facts);
  if (canonical.length !== facts.length) {
    throw new TypeError('Lookup review-action facts must not contain duplicate or over-limit identifiers.');
  }
  const canonicalById = new Map(canonical.map((fact) => [fact.id, fact]));
  for (const fact of facts) {
    const rebuilt = canonicalById.get(fact.id);
    if (!rebuilt
      || fact.version !== DECISION_FACT_VERSION
      || !Number.isSafeInteger(fact.contributorCount)
      || fact.contributorCount !== fact.contributors.length
      || canonicalFactShape(fact) !== canonicalFactShape(rebuilt)) {
      throw new TypeError('Lookup review-action facts must be canonical Decision Fact values.');
    }
  }
  return canonical;
}

function canonicalText(value: unknown, maximum: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && value.trim() === value
    && !CONTROL_CHARACTERS.test(value);
}

function validateSupport(support: LookupDecisionSupport): void {
  if (support.version !== 1
    || !TASKS.has(support.guidance.task)
    || !Array.isArray(support.entries)
    || !Array.isArray(support.actions)) {
    throw new TypeError('Lookup review actions require bounded decision support version 1.');
  }
  if (support.actions.length > MAX_LOOKUP_SOURCE_ACTIONS) {
    throw new RangeError(`Lookup decision support exceeds the ${MAX_LOOKUP_SOURCE_ACTIONS}-action bound.`);
  }
  if (support.entries.length > 16) {
    throw new RangeError('Lookup decision support exceeds the 16-entry bound.');
  }
  const entryIds = new Set<string>();
  for (const entry of support.entries) {
    if (!SAFE_ID.test(entry.id)
      || entryIds.has(entry.id)
      || (entry.state !== 'conflict' && entry.state !== 'uncertain')
      || !IMPORTANCE.has(entry.importance)
      || !canonicalText(entry.title, 160)
      || !canonicalText(entry.detail, 320)
      || !SAFE_FRAGMENT.test(entry.href)) {
      throw new TypeError(`Lookup decision support entry ${entry.id} is ambiguous or non-canonical.`);
    }
    entryIds.add(entry.id);
  }
  const actionIds = new Set<string>();
  for (const action of support.actions) {
    if (!SAFE_ID.test(action.id)
      || actionIds.has(action.id)
      || !canonicalText(action.label, 160)
      || !canonicalText(action.reason, 320)
      || !canonicalText(action.expectedOutcome, 320)
      || !SAFE_FRAGMENT.test(action.href)
      || !IMPORTANCE.has(action.priority)) {
      throw new TypeError(`Lookup decision support action ${action.id} is ambiguous or non-canonical.`);
    }
    actionIds.add(action.id);
  }
  const conflicts = support.entries.filter((entry) => entry.state === 'conflict').length;
  const uncertainties = support.entries.filter((entry) => entry.state === 'uncertain').length;
  if (!Number.isSafeInteger(support.counts.conflicts)
    || !Number.isSafeInteger(support.counts.uncertainties)
    || support.counts.conflicts !== conflicts
    || support.counts.uncertainties !== uncertainties) {
    throw new RangeError('Lookup decision support counts did not reconcile.');
  }
}

function actionShape(action: DecisionFactNextAction): string {
  return JSON.stringify({
    id: action.id,
    label: action.label,
    reason: action.reason,
    expectedOutcome: action.expectedOutcome,
    href: action.href,
    importance: action.importance,
  });
}

function supportActionShape(action: LookupNextAction): string {
  return JSON.stringify({
    id: action.id,
    label: action.label,
    reason: action.reason,
    expectedOutcome: action.expectedOutcome,
    href: action.href,
    importance: action.priority,
  });
}

function actionOccurrences(
  facts: readonly DecisionFact[],
  support: LookupDecisionSupport,
): ReadonlyMap<string, CanonicalActionOccurrence> {
  const occurrences = new Map<string, CanonicalActionOccurrence>();
  for (const fact of facts) {
    for (const action of fact.nextActions) {
      if (CONTEXT_ACTION_RULES[action.id]) {
        throw new TypeError(`Contextual Lookup action ${action.id} must not claim Decision Fact provenance.`);
      }
      const existing = occurrences.get(action.id);
      if (existing && actionShape(existing.action) !== actionShape(action)) {
        throw new TypeError(`Lookup review action identifier is ambiguous across Decision Facts: ${action.id}.`);
      }
      if (existing) existing.factIds.push(fact.id);
      else occurrences.set(action.id, { action, factIds: [fact.id] });
    }
  }
  const supportIds = new Set(support.actions.map((action) => action.id));
  for (const actionId of occurrences.keys()) {
    if (!supportIds.has(actionId)) {
      throw new TypeError(`Decision Fact action ${actionId} has no matching decision-support action.`);
    }
  }
  return occurrences;
}

function actionBasis(
  action: LookupNextAction,
  task: LookupTaskView,
  occurrence: CanonicalActionOccurrence | undefined,
): Readonly<{ basis: LookupReviewActionBasis; factIds: readonly string[] }> {
  const contextRule = CONTEXT_ACTION_RULES[action.id];
  if (occurrence) {
    if (supportActionShape(action) !== actionShape(occurrence.action)) {
      throw new TypeError(`Lookup decision-support action ${action.id} differs from its canonical Decision Fact copy.`);
    }
    return Object.freeze({
      basis: 'decision_fact',
      factIds: Object.freeze([...occurrence.factIds]),
    });
  }
  if (FACT_BACKED_ACTION_IDS.has(action.id)) {
    throw new TypeError(`Evidence-backed Lookup action ${action.id} is missing its required canonical Decision Fact.`);
  }
  if (!contextRule || !contextRule.tasks.includes(task) || action.href !== contextRule.href) {
    throw new TypeError(`Lookup action ${action.id} has no canonical fact or approved contextual rule.`);
  }
  return Object.freeze({ basis: contextRule.basis, factIds: Object.freeze([]) });
}

function presentedAction(
  action: LookupNextAction,
  task: LookupTaskView,
  occurrences: ReadonlyMap<string, CanonicalActionOccurrence>,
): LookupPresentedReviewAction {
  const resolved = actionBasis(action, task, occurrences.get(action.id));
  return Object.freeze({
    id: action.id,
    label: action.label,
    reason: action.reason,
    expectedOutcome: action.expectedOutcome,
    href: action.href,
    importance: action.priority,
    basis: resolved.basis,
    basisLabel: BASIS_LABELS[resolved.basis],
    contributingFactIds: resolved.factIds,
  });
}

function recommendedQueue(
  support: LookupDecisionSupport,
  facts: readonly DecisionFact[],
): LookupRecommendedReviewQueue {
  const occurrences = actionOccurrences(facts, support);
  const rankedItems = Object.freeze(rankLookupNextActions(
    support.actions,
    support.guidance.task,
  ).map((action) => presentedAction(action, support.guidance.task, occurrences)));
  const displayedItems = Object.freeze(rankedItems.slice(0, MAX_LOOKUP_PRESENTED_ACTIONS));
  const total = rankedItems.length;
  const displayedCount = displayedItems.length;
  const omittedCount = total - displayedCount;
  if (total !== displayedCount + omittedCount) {
    throw new RangeError('Lookup recommended-review action counts did not reconcile.');
  }
  const contributingFactIds = Object.freeze([...new Set(
    rankedItems.flatMap((item) => item.contributingFactIds),
  )]);
  return Object.freeze({
    rankedItems,
    displayedItems,
    contributingFactIds,
    total,
    displayedCount,
    omittedCount,
  });
}

function descriptor(value: DecisionFactPresentationDescriptor): DecisionFactPresentationDescriptor {
  return Object.freeze({
    label: value.label,
    explanation: value.explanation,
    tone: value.tone,
    icon: value.icon,
    assistiveText: value.assistiveText,
  });
}

function impactContributor(value: LookupEvidenceImpactContributor): LookupEvidenceImpactContributor {
  return Object.freeze({
    id: value.id,
    label: value.label,
    provenance: value.provenance,
    provenancePresentation: descriptor(value.provenancePresentation),
    evidenceState: value.evidenceState,
    evidencePresentation: descriptor(value.evidencePresentation),
    observedAt: value.observedAt,
    limitations: Object.freeze([...value.limitations]),
  });
}

function validateFactBackedImpact(item: LookupEvidenceImpactItem, fact: DecisionFact | undefined): void {
  if (!item.evidenceId
    || item.factId !== `lookup-evidence:${item.evidenceId}`
    || !fact
    || item.evidenceState !== fact.evidenceState
    || item.freshness !== fact.freshness
    || !item.evidencePresentation
    || !item.freshnessPresentation
    || JSON.stringify(item.evidencePresentation)
      !== JSON.stringify(DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState[fact.evidenceState])
    || JSON.stringify(item.freshnessPresentation)
      !== JSON.stringify(DECISION_FACT_PRESENTATION_DESCRIPTORS.freshness[fact.freshness])
    || JSON.stringify(item.limitations) !== JSON.stringify(fact.limitations)) {
    throw new TypeError(`Lookup evidence-improvement item ${item.id} does not match its canonical coverage fact.`);
  }
  const contributorShape = (value: {
    id: string;
    label: string;
    provenance: string;
    evidenceState: string;
    observedAt: string | null;
    limitations: readonly string[];
  }) => JSON.stringify({
    id: value.id,
    label: value.label,
    provenance: value.provenance,
    evidenceState: value.evidenceState,
    observedAt: value.observedAt,
    limitations: [...value.limitations],
  });
  if (item.contributors.length !== fact.contributors.length
    || item.contributors.some((value, index) => (
      contributorShape(value) !== contributorShape(fact.contributors[index]!)
      || JSON.stringify(value.provenancePresentation)
        !== JSON.stringify(DECISION_FACT_PRESENTATION_DESCRIPTORS.provenance[value.provenance])
      || JSON.stringify(value.evidencePresentation)
        !== JSON.stringify(DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState[value.evidenceState])
    ))) {
    throw new TypeError(`Lookup evidence-improvement item ${item.id} has mismatched contributor provenance.`);
  }
  const attributedLimitations = new Set(
    fact.contributors.flatMap((contributor) => contributor.limitations),
  );
  const expectedUnattributed = fact.limitations.filter((limitation) => (
    !attributedLimitations.has(limitation)
  ));
  if (JSON.stringify(item.unattributedLimitations) !== JSON.stringify(expectedUnattributed)) {
    throw new TypeError(`Lookup evidence-improvement item ${item.id} has mismatched adjacent limitations.`);
  }
}

function detachedImpactItem(
  item: LookupEvidenceImpactItem,
  factsById: ReadonlyMap<string, DecisionFact>,
): LookupEvidenceImpactItem {
  if (!BASIS.has(item.basis)
    || item.basisLabel !== BASIS_LABELS[item.basis]
    || !SAFE_FRAGMENT.test(item.href)) {
    throw new TypeError(`Lookup evidence-improvement item ${item.id} is not a safe bounded value.`);
  }
  if (item.basis === 'decision_fact') {
    validateFactBackedImpact(item, item.factId ? factsById.get(item.factId) : undefined);
  } else if (item.factId !== null
    || item.evidenceId !== null
    || item.evidenceState !== null
    || item.evidencePresentation !== null
    || item.freshness !== null
    || item.freshnessPresentation !== null
    || item.contributors.length !== 0) {
    throw new TypeError(`Contextual Lookup evidence-improvement item ${item.id} must not claim evidence provenance.`);
  }
  if ((item.basis === 'task_context' || item.basis === 'case_context') && item.mode !== 'local_review') {
    throw new TypeError(`Contextual Lookup evidence-improvement item ${item.id} must remain a local review.`);
  }
  if (item.basis === 'unbound_requirement' && item.mode !== 'network_collection') {
    throw new TypeError(`Unbound Lookup evidence-improvement item ${item.id} must retain network mode.`);
  }
  return Object.freeze({
    id: item.id,
    claimId: item.claimId,
    claimLabel: item.claimLabel,
    currentState: item.currentState,
    requirementId: item.requirementId,
    requirementLabel: item.requirementLabel,
    evidenceId: item.evidenceId,
    evidenceLabel: item.evidenceLabel,
    mode: item.mode,
    basis: item.basis,
    basisLabel: item.basisLabel,
    priority: item.priority,
    outcomeIfSettled: item.outcomeIfSettled,
    reason: item.reason,
    expectedEffect: item.expectedEffect,
    disclosure: item.disclosure,
    endpointClass: item.endpointClass,
    refreshAvailable: item.refreshAvailable,
    href: item.href,
    factId: item.factId,
    evidenceState: item.evidenceState,
    evidencePresentation: item.evidencePresentation ? descriptor(item.evidencePresentation) : null,
    freshness: item.freshness,
    freshnessPresentation: item.freshnessPresentation ? descriptor(item.freshnessPresentation) : null,
    contributors: Object.freeze(item.contributors.map(impactContributor)),
    limitations: Object.freeze([...item.limitations]),
    unattributedLimitations: Object.freeze([...item.unattributedLimitations]),
  });
}

function evidenceImprovementQueue(
  plan: LookupEvidenceImpactPlan,
  facts: readonly DecisionFact[],
): LookupEvidenceImprovementQueue {
  if (plan.version !== 2 || !Array.isArray(plan.items) || plan.items.length > 12) {
    throw new TypeError('Lookup review actions require bounded evidence-impact version 2.');
  }
  if (!Number.isSafeInteger(plan.total)
    || !Number.isSafeInteger(plan.displayedCount)
    || !Number.isSafeInteger(plan.omittedCount)
    || plan.displayedCount !== plan.items.length
    || plan.total !== plan.displayedCount + plan.omittedCount
    || !Number.isSafeInteger(plan.networkCollectionCount)
    || !Number.isSafeInteger(plan.localReviewCount)
    || plan.networkCollectionCount + plan.localReviewCount !== plan.total
    || !Number.isSafeInteger(plan.claimCount)
    || plan.claimCount < 0
    || plan.claimCount > plan.total) {
    throw new RangeError('Lookup evidence-improvement counts did not reconcile.');
  }
  const factsById = new Map(facts.map((fact) => [fact.id, fact]));
  const identifiers = new Set<string>();
  const displayedItems = Object.freeze(plan.items.map((item) => {
    if (identifiers.has(item.id)) {
      throw new TypeError(`Lookup evidence-improvement identifier is ambiguous: ${item.id}.`);
    }
    identifiers.add(item.id);
    return detachedImpactItem(item, factsById);
  }));
  const displayedNetworkCount = displayedItems.filter((item) => item.mode === 'network_collection').length;
  const displayedLocalCount = displayedItems.filter((item) => item.mode === 'local_review').length;
  const displayedClaimCount = new Set(displayedItems.map((item) => item.claimId)).size;
  if (plan.networkCollectionCount < displayedNetworkCount
    || plan.localReviewCount < displayedLocalCount
    || (plan.networkCollectionCount - displayedNetworkCount)
      + (plan.localReviewCount - displayedLocalCount) !== plan.omittedCount
    || plan.claimCount < displayedClaimCount
    || plan.claimCount > displayedClaimCount + plan.omittedCount) {
    throw new RangeError('Lookup evidence-improvement displayed and omitted counts did not reconcile.');
  }
  return Object.freeze({
    displayedItems,
    total: plan.total,
    displayedCount: plan.displayedCount,
    omittedCount: plan.omittedCount,
    claimCount: plan.claimCount,
    networkCollectionCount: plan.networkCollectionCount,
    localReviewCount: plan.localReviewCount,
    limitation: plan.limitation,
  });
}

export function buildLookupReviewActionModel(input: Readonly<{
  support: LookupDecisionSupport;
  facts: readonly DecisionFact[];
  evidenceImpact: LookupEvidenceImpactPlan;
}>): LookupReviewActionModel {
  validateSupport(input.support);
  const facts = canonicalFacts(input.facts);
  return Object.freeze({
    version: LOOKUP_REVIEW_ACTION_MODEL_VERSION,
    recommendedNextReviews: recommendedQueue(input.support, facts),
    evidenceImprovements: evidenceImprovementQueue(input.evidenceImpact, facts),
  });
}
