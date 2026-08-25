import {
  DECISION_FACT_PRESENTATION_DESCRIPTORS,
  buildDecisionFacts,
  type DecisionFact,
  type DecisionFactPresentationDescriptor,
} from '../../../../packages/evidence/decision-fact.mts';

export const LOOKUP_AT_A_GLANCE_VERSION = 1 as const;
export const MAX_LOOKUP_AT_A_GLANCE_DISPLAYED_ITEMS = 24;

export type LookupAtAGlanceGroupId = 'complete' | 'limited' | 'disagreements' | 'unresolved';
export type LookupAtAGlanceDestination = `#${string}`;

export type LookupAtAGlanceContributor = Readonly<{
  id: string;
  label: string;
  evidencePresentation: DecisionFactPresentationDescriptor;
  provenancePresentation: DecisionFactPresentationDescriptor;
  limitations: readonly string[];
}>;

export type LookupAtAGlanceItem = Readonly<{
  factId: string;
  label: string;
  detail: string;
  destination: LookupAtAGlanceDestination;
  statePresentation: DecisionFactPresentationDescriptor;
  freshnessPresentation: DecisionFactPresentationDescriptor;
  contributors: readonly LookupAtAGlanceContributor[];
  limitations: readonly string[];
}>;

export type LookupAtAGlanceAggregate = Readonly<{
  id: LookupAtAGlanceGroupId;
  count: number;
  contributingFactIds: readonly string[];
  displayedItems: readonly LookupAtAGlanceItem[];
  omittedCount: number;
  presentation: DecisionFactPresentationDescriptor;
  emptyMessage: string;
  destination: LookupAtAGlanceDestination;
}>;

export type LookupAtAGlanceModel = Readonly<{
  version: typeof LOOKUP_AT_A_GLANCE_VERSION;
  groups: readonly LookupAtAGlanceAggregate[];
}>;

type AggregateSpec = Readonly<{
  id: LookupAtAGlanceGroupId;
  matches: (fact: DecisionFact) => boolean;
  label: (count: number) => string;
  explanation: string;
  assistiveText: (count: number) => string;
  presentation: DecisionFactPresentationDescriptor;
  emptyMessage: string;
  destination: LookupAtAGlanceDestination;
  coverageDestination: boolean;
}>;

const SAFE_FRAGMENT = /^#[a-z0-9](?:[a-z0-9._:-]{0,159})$/u;
const SOURCE_QUALITY_DESTINATION = '#source-quality' as const;
const EVIDENCE_PREFIX = 'lookup-evidence:';
const DECISION_PREFIX = 'lookup-decision:';
const INSPECTION_DESTINATION_REFERENCE = 'inspection-destination:';

const AGGREGATE_SPECS: readonly AggregateSpec[] = Object.freeze([
  Object.freeze({
    id: 'complete',
    matches: (fact: DecisionFact) => fact.id.startsWith(EVIDENCE_PREFIX)
      && fact.evidenceState === 'observed',
    label: (count: number) => `complete check${count === 1 ? '' : 's'}`,
    explanation: 'These bounded collectors or derived checks returned an observed usable result. Complete describes evidence collection, not whether the domain is safe.',
    assistiveText: (count: number) => `${count} complete check${count === 1 ? '' : 's'}. Observed evidence is available; it does not establish safety, legitimacy, ownership, or a favourable result.`,
    presentation: DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState.observed,
    emptyMessage: 'No evidence check returned an observed usable result.',
    destination: SOURCE_QUALITY_DESTINATION,
    coverageDestination: true,
  }),
  Object.freeze({
    id: 'limited',
    matches: (fact: DecisionFact) => fact.id.startsWith(EVIDENCE_PREFIX)
      && (fact.evidenceState === 'partial'
        || fact.evidenceState === 'unavailable'
        || fact.evidenceState === 'unknown'),
    label: (count: number) => `limited check${count === 1 ? '' : 's'}`,
    explanation: 'These checks are partial, unavailable, or unknown. Unsupported, not collected, and not observed in bounded evidence checks remain in Source quality but are not included in this count.',
    assistiveText: (count: number) => `${count} limited check${count === 1 ? '' : 's'}. Partial, unavailable, or unknown evidence requires review and does not establish absence or safety.`,
    presentation: DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState.partial,
    emptyMessage: 'No evidence check is currently partial, unavailable, or unknown.',
    destination: SOURCE_QUALITY_DESTINATION,
    coverageDestination: true,
  }),
  Object.freeze({
    id: 'disagreements',
    matches: (fact: DecisionFact) => fact.id.startsWith(DECISION_PREFIX)
      && fact.consistency === 'contradictory',
    label: (count: number) => `disagreement${count === 1 ? '' : 's'}`,
    explanation: 'These separately attributed sources report different values. Source order does not resolve a disagreement automatically, and complete collection can still contain one.',
    assistiveText: (count: number) => `${count} disagreement${count === 1 ? '' : 's'}. Separately attributed observations conflict, and their stable display order does not assign authority.`,
    presentation: DECISION_FACT_PRESENTATION_DESCRIPTORS.consistency.contradictory,
    emptyMessage: 'No retained source comparison currently reports a disagreement.',
    destination: SOURCE_QUALITY_DESTINATION,
    coverageDestination: false,
  }),
  Object.freeze({
    id: 'unresolved',
    matches: (fact: DecisionFact) => fact.id.startsWith(DECISION_PREFIX)
      && fact.consistency === 'unknown',
    label: (count: number) => `unresolved item${count === 1 ? '' : 's'}`,
    explanation: 'These comparisons remain incomplete or indeterminate. Open an item to review the separately attributed evidence that still needs interpretation.',
    assistiveText: (count: number) => `${count} unresolved item${count === 1 ? '' : 's'}. The attributed evidence remains incomplete or indeterminate and supports no resolved conclusion.`,
    presentation: DECISION_FACT_PRESENTATION_DESCRIPTORS.consistency.unknown,
    emptyMessage: 'No retained comparison is currently marked incomplete or indeterminate.',
    destination: SOURCE_QUALITY_DESTINATION,
    coverageDestination: false,
  }),
]);

function isSafeFragment(value: string): value is LookupAtAGlanceDestination {
  return SAFE_FRAGMENT.test(value);
}

function factDestination(fact: DecisionFact): LookupAtAGlanceDestination {
  const inspectionReference = fact.references.find((reference) => (
    reference.startsWith(INSPECTION_DESTINATION_REFERENCE)
      && isSafeFragment(reference.slice(INSPECTION_DESTINATION_REFERENCE.length))
  ));
  if (inspectionReference) {
    return inspectionReference.slice(INSPECTION_DESTINATION_REFERENCE.length) as LookupAtAGlanceDestination;
  }
  const reference = fact.references.find(isSafeFragment);
  if (reference) return reference;
  const action = fact.nextActions.find((candidate) => isSafeFragment(candidate.href));
  return action?.href ?? SOURCE_QUALITY_DESTINATION;
}

function contributorProjection(
  fact: DecisionFact,
): readonly LookupAtAGlanceContributor[] {
  return Object.freeze(fact.contributors.map((contributor) => Object.freeze({
    id: contributor.id,
    label: contributor.label,
    evidencePresentation: DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState[contributor.evidenceState],
    provenancePresentation: DECISION_FACT_PRESENTATION_DESCRIPTORS.provenance[contributor.provenance],
    limitations: Object.freeze([...contributor.limitations]),
  })));
}

function itemProjection(
  fact: DecisionFact,
  coverageDestination: boolean,
): LookupAtAGlanceItem {
  const contributors = contributorProjection(fact);
  const attributedLimitations = new Set(contributors.flatMap((contributor) => contributor.limitations));
  const limitations = Object.freeze(
    fact.limitations.filter((limitation) => !attributedLimitations.has(limitation)),
  );
  const isEvidenceFact = fact.id.startsWith(EVIDENCE_PREFIX);
  return Object.freeze({
    factId: fact.id,
    label: isEvidenceFact && contributors.length === 1
      ? contributors[0]!.label
      : fact.question,
    detail: fact.conclusion,
    destination: coverageDestination ? SOURCE_QUALITY_DESTINATION : factDestination(fact),
    statePresentation: isEvidenceFact
      ? DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState[fact.evidenceState]
      : DECISION_FACT_PRESENTATION_DESCRIPTORS.consistency[fact.consistency],
    freshnessPresentation: DECISION_FACT_PRESENTATION_DESCRIPTORS.freshness[fact.freshness],
    contributors,
    limitations,
  });
}

function aggregateDestination(
  facts: readonly DecisionFact[],
  spec: AggregateSpec,
): LookupAtAGlanceDestination {
  if (spec.coverageDestination) return spec.destination;
  const destinations = new Set(facts.map(factDestination));
  return destinations.size === 1
    ? destinations.values().next().value ?? spec.destination
    : spec.destination;
}

function aggregatePresentation(
  spec: AggregateSpec,
  count: number,
): DecisionFactPresentationDescriptor {
  return Object.freeze({
    label: spec.label(count),
    explanation: spec.explanation,
    tone: spec.presentation.tone,
    icon: spec.presentation.icon,
    assistiveText: spec.assistiveText(count),
  });
}

function aggregate(
  facts: readonly DecisionFact[],
  spec: AggregateSpec,
): LookupAtAGlanceAggregate {
  const matches = facts.filter(spec.matches);
  const contributingFactIds = Object.freeze(matches.map((fact) => fact.id));
  const displayedItems = Object.freeze(matches
    .slice(0, MAX_LOOKUP_AT_A_GLANCE_DISPLAYED_ITEMS)
    .map((fact) => itemProjection(fact, spec.coverageDestination)));
  const count = contributingFactIds.length;
  const omittedCount = count - displayedItems.length;
  if (count !== displayedItems.length + omittedCount) {
    throw new RangeError('Lookup At-a-glance aggregate count did not reconcile.');
  }
  return Object.freeze({
    id: spec.id,
    count,
    contributingFactIds,
    displayedItems,
    omittedCount,
    presentation: aggregatePresentation(spec, count),
    emptyMessage: spec.emptyMessage,
    destination: aggregateDestination(matches, spec),
  });
}

export function buildLookupAtAGlanceModel(
  facts: readonly DecisionFact[],
): LookupAtAGlanceModel {
  const canonicalFacts = buildDecisionFacts(facts);
  return Object.freeze({
    version: LOOKUP_AT_A_GLANCE_VERSION,
    groups: Object.freeze(AGGREGATE_SPECS.map((spec) => aggregate(canonicalFacts, spec))),
  });
}
