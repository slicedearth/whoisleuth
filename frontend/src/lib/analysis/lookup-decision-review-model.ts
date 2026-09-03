import {
  DECISION_FACT_PRESENTATION_DESCRIPTORS,
  DECISION_FACT_PRESENTATION_LABELS,
  canonicalDecisionFacts,
  type DecisionFact,
  type DecisionFactConsistency,
  type DecisionFactEvidenceState,
  type DecisionFactFreshness,
  type DecisionFactImportance,
  type DecisionFactPresentationDescriptor,
  type DecisionFactProvenance,
} from '../../../../packages/evidence/decision-fact.mts';
import type {
  LookupDecisionEntry,
  LookupDecisionSupport,
  LookupTaskGuidance,
} from './lookup-decision-support.ts';

export const LOOKUP_DECISION_REVIEW_MODEL_VERSION = 1 as const;
export const MAX_LOOKUP_DECISION_REVIEW_ENTRIES = 16;

export type LookupDecisionReviewGroupId = 'disagreements' | 'unresolved';
export type LookupDecisionReviewDestination = `#${string}`;

export type LookupDecisionReviewContributor = Readonly<{
  id: string;
  label: string;
  evidenceState: DecisionFactEvidenceState;
  evidencePresentation: DecisionFactPresentationDescriptor;
  provenance: DecisionFactProvenance;
  provenancePresentation: DecisionFactPresentationDescriptor;
  observedAt: string | null;
  limitations: readonly string[];
}>;

export type LookupDecisionReviewAction = Readonly<{
  id: string;
  label: string;
  reason: string;
  expectedOutcome: string;
  href: LookupDecisionReviewDestination;
  importance: DecisionFactImportance;
  importanceLabel: string;
}>;

export type LookupDecisionReviewEntry = Readonly<{
  id: string;
  factId: string;
  title: string;
  detail: string;
  importance: DecisionFactImportance;
  importanceLabel: string;
  destination: LookupDecisionReviewDestination;
  evidenceState: DecisionFactEvidenceState;
  evidencePresentation: DecisionFactPresentationDescriptor;
  freshness: DecisionFactFreshness;
  freshnessPresentation: DecisionFactPresentationDescriptor;
  consistency: DecisionFactConsistency;
  consistencyPresentation: DecisionFactPresentationDescriptor;
  contributors: readonly LookupDecisionReviewContributor[];
  contradictions: readonly string[];
  limitations: readonly string[];
  unattributedLimitations: readonly string[];
  nextActions: readonly LookupDecisionReviewAction[];
}>;

export type LookupDecisionReviewGroup = Readonly<{
  id: LookupDecisionReviewGroupId;
  label: string;
  countLabel: string;
  explanation: string;
  consistency: 'contradictory' | 'unknown';
  presentation: DecisionFactPresentationDescriptor;
  contributingFactIds: readonly string[];
  displayedEntries: readonly LookupDecisionReviewEntry[];
  total: number;
  omittedCount: number;
  emptyMessage: string;
}>;

export type LookupDecisionReviewModel = Readonly<{
  version: typeof LOOKUP_DECISION_REVIEW_MODEL_VERSION;
  guidance: LookupTaskGuidance;
  groups: readonly LookupDecisionReviewGroup[];
  total: number;
  canonicalDecisionFactCount: number;
}>;

type GroupSpec = Readonly<{
  id: LookupDecisionReviewGroupId;
  label: string;
  explanation: string;
  consistency: 'contradictory' | 'unknown';
  emptyMessage: string;
}>;

const DECISION_FACT_PREFIX = 'lookup-decision:';
const INSPECTION_DESTINATION_REFERENCE = 'inspection-destination:';
const SAFE_FRAGMENT = /^#[a-z0-9](?:[a-z0-9._:-]{0,159})$/u;
const SAFE_ENTRY_ID = /^[a-z0-9](?:[a-z0-9._:-]{0,179})$/u;
const ENTRY_STATES = new Set(['conflict', 'uncertain']);
const IMPORTANCE_STATES = new Set<DecisionFactImportance>(['high', 'medium', 'low']);
const EXPECTED_CONSISTENCY = Object.freeze({
  conflict: 'contradictory',
  uncertain: 'unknown',
} as const);

const GROUP_SPECS: readonly GroupSpec[] = Object.freeze([
  Object.freeze({
    id: 'disagreements',
    label: 'Disagreements',
    explanation: 'Separately attributed evidence conflicts. Stable source ordering does not assign authority or resolve the disagreement.',
    consistency: 'contradictory',
    emptyMessage: 'No retained decision comparison currently contains contradictory evidence.',
  }),
  Object.freeze({
    id: 'unresolved',
    label: 'Unresolved comparisons',
    explanation: 'Incomplete or indeterminate evidence supports no agreement or disagreement conclusion.',
    consistency: 'unknown',
    emptyMessage: 'No retained decision comparison is currently unresolved.',
  }),
]);

function presentation(
  descriptor: DecisionFactPresentationDescriptor,
): DecisionFactPresentationDescriptor {
  return Object.freeze({
    label: descriptor.label,
    explanation: descriptor.explanation,
    tone: descriptor.tone,
    icon: descriptor.icon,
    assistiveText: descriptor.assistiveText,
  });
}

function guidanceProjection(guidance: LookupTaskGuidance): LookupTaskGuidance {
  if (!guidance || typeof guidance !== 'object'
    || !Array.isArray(guidance.questions)
    || !Array.isArray(guidance.prioritySections)) {
    throw new TypeError('Lookup decision-review guidance must be a bounded task-guidance value.');
  }
  return Object.freeze({
    task: guidance.task,
    label: guidance.label,
    summary: guidance.summary,
    questions: Object.freeze([...guidance.questions]),
    prioritySections: Object.freeze([...guidance.prioritySections]),
  });
}

function validateSupport(support: LookupDecisionSupport): void {
  if (support.version !== 1 || !Array.isArray(support.entries)) {
    throw new TypeError('Lookup decision support has an unsupported version or entry collection.');
  }
  if (support.entries.length > MAX_LOOKUP_DECISION_REVIEW_ENTRIES) {
    throw new RangeError(`Lookup decision support exceeds the ${MAX_LOOKUP_DECISION_REVIEW_ENTRIES}-record bound.`);
  }
  const identifiers = new Set<string>();
  for (const entry of support.entries) {
    if (!SAFE_ENTRY_ID.test(entry.id)) {
      throw new TypeError('Lookup decision support contains an invalid entry identifier.');
    }
    if (identifiers.has(entry.id)) {
      throw new TypeError(`Lookup decision support identifier is ambiguous: ${entry.id}.`);
    }
    identifiers.add(entry.id);
    if (!ENTRY_STATES.has(entry.state)
      || !IMPORTANCE_STATES.has(entry.importance)
      || typeof entry.title !== 'string'
      || !entry.title
      || typeof entry.detail !== 'string'
      || !entry.detail
      || !SAFE_FRAGMENT.test(entry.href)) {
      throw new TypeError(`Lookup decision support entry ${entry.id} is not a canonical bounded value.`);
    }
  }
  const conflicts = support.entries.filter((entry) => entry.state === 'conflict').length;
  const uncertainties = support.entries.filter((entry) => entry.state === 'uncertain').length;
  if (!Number.isSafeInteger(support.counts.conflicts)
    || !Number.isSafeInteger(support.counts.uncertainties)
    || support.counts.conflicts !== conflicts
    || support.counts.uncertainties !== uncertainties) {
    throw new RangeError('Lookup decision support disagreement and uncertainty counts did not reconcile.');
  }
}

function contributorProjection(
  contributor: DecisionFact['contributors'][number],
): LookupDecisionReviewContributor {
  return Object.freeze({
    id: contributor.id,
    label: contributor.label,
    evidenceState: contributor.evidenceState,
    evidencePresentation: presentation(
      DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState[contributor.evidenceState],
    ),
    provenance: contributor.provenance,
    provenancePresentation: presentation(
      DECISION_FACT_PRESENTATION_DESCRIPTORS.provenance[contributor.provenance],
    ),
    observedAt: contributor.observedAt,
    limitations: Object.freeze([...contributor.limitations]),
  });
}

function actionProjection(
  action: DecisionFact['nextActions'][number],
): LookupDecisionReviewAction {
  if (!SAFE_FRAGMENT.test(action.href)) {
    throw new TypeError(`Lookup decision-review action ${action.id} has an unsafe destination.`);
  }
  return Object.freeze({
    id: action.id,
    label: action.label,
    reason: action.reason,
    expectedOutcome: action.expectedOutcome,
    href: action.href,
    importance: action.importance,
    importanceLabel: DECISION_FACT_PRESENTATION_LABELS.importance[action.importance],
  });
}

function inspectionDestination(
  entry: LookupDecisionEntry,
  fact: DecisionFact,
): LookupDecisionReviewDestination {
  const inspectionReferences = fact.references.filter((reference) => (
    reference.startsWith(INSPECTION_DESTINATION_REFERENCE)
  ));
  if (inspectionReferences.length !== 1) {
    throw new TypeError(`Lookup decision fact ${fact.id} must have one inspection destination.`);
  }
  const destination = inspectionReferences[0]!.slice(INSPECTION_DESTINATION_REFERENCE.length);
  if (!SAFE_FRAGMENT.test(destination)
    || destination !== entry.href
    || !fact.references.includes(entry.href)) {
    throw new TypeError(`Lookup decision fact ${fact.id} has a mismatched inspection destination.`);
  }
  return destination as LookupDecisionReviewDestination;
}

function entryProjection(
  entry: LookupDecisionEntry,
  fact: DecisionFact,
): LookupDecisionReviewEntry {
  const expectedConsistency = EXPECTED_CONSISTENCY[entry.state];
  const expectedQuestion = `What does the separately attributed evidence establish for "${entry.title}"?`;
  const expectedConclusion = `${entry.title}. ${entry.detail}`;
  if (fact.consistency !== expectedConsistency) {
    throw new TypeError(`Lookup decision fact ${fact.id} does not match support state ${entry.state}.`);
  }
  if (fact.importance !== entry.importance) {
    throw new TypeError(`Lookup decision fact ${fact.id} does not match support importance ${entry.importance}.`);
  }
  if (fact.question !== expectedQuestion || fact.conclusion !== expectedConclusion) {
    throw new TypeError(`Lookup decision fact ${fact.id} does not match support title and detail semantics.`);
  }
  if (!fact.contributors.length) {
    throw new TypeError(`Lookup decision fact ${fact.id} must retain at least one attributed contributor.`);
  }
  if ((entry.state === 'conflict' && fact.contradictions.length === 0)
    || (entry.state === 'uncertain' && fact.contradictions.length !== 0)) {
    throw new TypeError(`Lookup decision fact ${fact.id} has contradictions inconsistent with its support state.`);
  }

  const contributors = Object.freeze(fact.contributors.map(contributorProjection));
  const attributedLimitations = new Set(
    contributors.flatMap((contributor) => contributor.limitations),
  );
  const limitations = Object.freeze([...fact.limitations]);
  const unattributedLimitations = Object.freeze(
    limitations.filter((limitation) => !attributedLimitations.has(limitation)),
  );

  return Object.freeze({
    id: entry.id,
    factId: fact.id,
    title: entry.title,
    detail: entry.detail,
    importance: fact.importance,
    importanceLabel: DECISION_FACT_PRESENTATION_LABELS.importance[fact.importance],
    destination: inspectionDestination(entry, fact),
    evidenceState: fact.evidenceState,
    evidencePresentation: presentation(
      DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState[fact.evidenceState],
    ),
    freshness: fact.freshness,
    freshnessPresentation: presentation(
      DECISION_FACT_PRESENTATION_DESCRIPTORS.freshness[fact.freshness],
    ),
    consistency: fact.consistency,
    consistencyPresentation: presentation(
      DECISION_FACT_PRESENTATION_DESCRIPTORS.consistency[fact.consistency],
    ),
    contributors,
    contradictions: Object.freeze([...fact.contradictions]),
    limitations,
    unattributedLimitations,
    nextActions: Object.freeze(fact.nextActions.map(actionProjection)),
  });
}

function groupProjection(
  entries: readonly LookupDecisionReviewEntry[],
  spec: GroupSpec,
): LookupDecisionReviewGroup {
  const matches = entries.filter((entry) => entry.consistency === spec.consistency);
  const contributingFactIds = Object.freeze(matches.map((entry) => entry.factId));
  const displayedEntries = Object.freeze(
    matches.slice(0, MAX_LOOKUP_DECISION_REVIEW_ENTRIES),
  );
  const total = contributingFactIds.length;
  const omittedCount = total - displayedEntries.length;
  if (total !== displayedEntries.length + omittedCount) {
    throw new RangeError(`Lookup decision-review group ${spec.id} counts did not reconcile.`);
  }
  return Object.freeze({
    id: spec.id,
    label: spec.label,
    countLabel: spec.id === 'disagreements'
      ? `disagreement${total === 1 ? '' : 's'}`
      : `unresolved comparison${total === 1 ? '' : 's'}`,
    explanation: spec.explanation,
    consistency: spec.consistency,
    presentation: presentation(
      DECISION_FACT_PRESENTATION_DESCRIPTORS.consistency[spec.consistency],
    ),
    contributingFactIds,
    displayedEntries,
    total,
    omittedCount,
    emptyMessage: spec.emptyMessage,
  });
}

export function buildLookupDecisionReviewModel(input: Readonly<{
  support: LookupDecisionSupport;
  facts: readonly DecisionFact[];
}>): LookupDecisionReviewModel {
  validateSupport(input.support);
  const facts = canonicalDecisionFacts(input.facts);
  const decisionFacts = facts.filter((fact) => fact.id.startsWith(DECISION_FACT_PREFIX));
  if (decisionFacts.length !== input.support.entries.length) {
    throw new TypeError('Lookup decision support entries and canonical decision facts do not reconcile.');
  }
  const factsById = new Map(decisionFacts.map((fact) => [fact.id, fact]));
  const supportFactIds = new Set<string>();
  const entries = Object.freeze(input.support.entries.map((entry) => {
    const factId = `${DECISION_FACT_PREFIX}${entry.id}`;
    supportFactIds.add(factId);
    const fact = factsById.get(factId);
    if (!fact) {
      throw new TypeError(`Lookup decision review is missing canonical fact ${factId}.`);
    }
    return entryProjection(entry, fact);
  }));
  for (const fact of decisionFacts) {
    if (!supportFactIds.has(fact.id)) {
      throw new TypeError(`Lookup decision fact ${fact.id} has no matching support entry.`);
    }
  }

  const groups = Object.freeze(GROUP_SPECS.map((spec) => groupProjection(entries, spec)));
  const total = groups.reduce((count, group) => count + group.total, 0);
  if (total !== entries.length
    || groups[0]!.total !== input.support.counts.conflicts
    || groups[1]!.total !== input.support.counts.uncertainties) {
    throw new RangeError('Lookup decision-review groups, support counts, and displayed entries did not reconcile.');
  }

  return Object.freeze({
    version: LOOKUP_DECISION_REVIEW_MODEL_VERSION,
    guidance: guidanceProjection(input.support.guidance),
    groups,
    total,
    canonicalDecisionFactCount: decisionFacts.length,
  });
}
