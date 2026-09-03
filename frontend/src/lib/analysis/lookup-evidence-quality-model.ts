import {
  DECISION_FACT_PRESENTATION_DESCRIPTORS,
  canonicalDecisionFacts,
  type DecisionFact,
  type DecisionFactEvidenceState,
  type DecisionFactFreshness,
  type DecisionFactPresentationDescriptor,
  type DecisionFactProvenance,
} from '../../../../packages/evidence/decision-fact.mts';
import type { EvidenceCoverageState } from './evidence-coverage-ledger.ts';
import type { LookupEvidenceQualityMatrix } from './lookup-decision-support.ts';
import type { LookupFreshnessPolicy } from './lookup-source-refresh.ts';

export const LOOKUP_EVIDENCE_QUALITY_MODEL_VERSION = 1 as const;

export type LookupEvidenceQualityContributorPresentation = Readonly<{
  id: string;
  label: string;
  evidenceState: DecisionFactEvidenceState;
  evidencePresentation: DecisionFactPresentationDescriptor;
  provenance: DecisionFactProvenance;
  provenancePresentation: DecisionFactPresentationDescriptor;
  observedAt: string | null;
  limitations: readonly string[];
}>;

export type LookupEvidenceQualityPresentationEntry = Readonly<{
  id: string;
  factId: string;
  label: string;
  category: string;
  endpointClass: string;
  description: string;
  evidenceState: DecisionFactEvidenceState;
  statePresentation: DecisionFactPresentationDescriptor;
  freshness: DecisionFactFreshness;
  freshnessPresentation: DecisionFactPresentationDescriptor;
  contributors: readonly LookupEvidenceQualityContributorPresentation[];
  limitations: readonly string[];
  unattributedLimitations: readonly string[];
  limitationCount: number;
  countsAsComplete: boolean;
  countsAsLimited: boolean;
  truncated: boolean;
  observedAt: string | null;
  ageDays: number | null;
  durationMs: number | null;
  timingOutcome: 'fulfilled' | 'rejected' | null;
  refreshAvailable: boolean;
  requestDisclosure: string | null;
  supports: readonly string[];
}>;

export type LookupEvidenceQualityModel = Readonly<{
  version: typeof LOOKUP_EVIDENCE_QUALITY_MODEL_VERSION;
  observedAt: string | null;
  totalMs: number | null;
  entries: readonly LookupEvidenceQualityPresentationEntry[];
  displayedRowCount: number;
  canonicalCoverageFactCount: number;
  completeCount: number;
  limitedCount: number;
  stale: boolean;
  ageDays: number | null;
  freshnessPolicy: LookupFreshnessPolicy;
}>;

const COVERAGE_FACT_PREFIX = 'lookup-evidence:';
const COVERAGE_STATE: Readonly<Record<EvidenceCoverageState, DecisionFactEvidenceState>> = Object.freeze({
  complete: 'observed',
  not_found: 'not_observed_in_bounded_evidence',
  skipped: 'not_collected',
  partial: 'partial',
  unsupported: 'unsupported',
  unavailable: 'unavailable',
  unknown: 'unknown',
});
const LIMITED_STATES = new Set<DecisionFactEvidenceState>([
  'partial',
  'unavailable',
  'unknown',
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

function freshnessPolicy(policy: LookupFreshnessPolicy): LookupFreshnessPolicy {
  return Object.freeze({
    version: policy.version,
    id: policy.id,
    task: policy.task,
    thresholdsDays: Object.freeze({
      registration: policy.thresholdsDays.registration,
      network: policy.thresholdsDays.network,
      web: policy.thresholdsDays.web,
    }),
  });
}

function contributorPresentation(
  contributor: DecisionFact['contributors'][number],
): LookupEvidenceQualityContributorPresentation {
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

function entryProjection(
  entry: LookupEvidenceQualityMatrix['entries'][number],
  fact: DecisionFact,
): LookupEvidenceQualityPresentationEntry {
  const expectedState = COVERAGE_STATE[entry.state];
  if (fact.evidenceState !== expectedState || fact.consistency !== 'not_applicable') {
    throw new TypeError(`Lookup evidence quality fact ${fact.id} does not match matrix state ${entry.state}.`);
  }
  if (fact.contributors.length !== 1) {
    throw new TypeError(`Lookup evidence quality fact ${fact.id} must retain one canonical contributor.`);
  }
  const source = fact.contributors[0]!;
  if (source.id !== `evidence:${entry.id}`
    || source.label !== entry.label
    || source.evidenceState !== fact.evidenceState) {
    throw new TypeError(`Lookup evidence quality fact ${fact.id} has mismatched contributor identity or state.`);
  }

  const contributors = Object.freeze(fact.contributors.map(contributorPresentation));
  const attributedLimitations = new Set(
    contributors.flatMap((contributor) => contributor.limitations),
  );
  const limitations = Object.freeze([...fact.limitations]);
  const unattributedLimitations = Object.freeze(
    limitations.filter((limitation) => !attributedLimitations.has(limitation)),
  );
  const countsAsComplete = fact.evidenceState === 'observed';
  const countsAsLimited = LIMITED_STATES.has(fact.evidenceState);

  return Object.freeze({
    id: entry.id,
    factId: fact.id,
    label: entry.label,
    category: entry.category,
    endpointClass: entry.endpointClass,
    description: entry.description,
    evidenceState: fact.evidenceState,
    statePresentation: presentation(
      DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState[fact.evidenceState],
    ),
    freshness: fact.freshness,
    freshnessPresentation: presentation(
      DECISION_FACT_PRESENTATION_DESCRIPTORS.freshness[fact.freshness],
    ),
    contributors,
    limitations,
    unattributedLimitations,
    limitationCount: contributors.reduce(
      (count, contributor) => count + contributor.limitations.length,
      unattributedLimitations.length,
    ),
    countsAsComplete,
    countsAsLimited,
    truncated: entry.truncated,
    observedAt: entry.observedAt,
    ageDays: entry.ageDays,
    durationMs: entry.durationMs,
    timingOutcome: entry.timingOutcome,
    refreshAvailable: entry.refreshAvailable,
    requestDisclosure: entry.requestDisclosure,
    supports: Object.freeze([...entry.supports]),
  });
}

export function buildLookupEvidenceQualityModel(input: Readonly<{
  matrix: LookupEvidenceQualityMatrix;
  facts: readonly DecisionFact[];
}>): LookupEvidenceQualityModel {
  if (input.matrix.version !== 1) {
    throw new TypeError('Lookup evidence quality matrix has an unsupported version.');
  }
  const facts = canonicalDecisionFacts(input.facts);
  const coverageFacts = facts.filter((fact) => fact.id.startsWith(COVERAGE_FACT_PREFIX));
  const factsById = new Map(coverageFacts.map((fact) => [fact.id, fact]));
  const matrixIds = new Set<string>();

  for (const entry of input.matrix.entries) {
    if (matrixIds.has(entry.id)) {
      throw new TypeError(`Lookup evidence quality matrix identifier is ambiguous: ${entry.id}.`);
    }
    matrixIds.add(entry.id);
  }
  if (coverageFacts.length !== input.matrix.entries.length) {
    throw new TypeError('Lookup evidence quality rows and canonical coverage facts do not reconcile.');
  }

  const entries = Object.freeze(input.matrix.entries.map((entry) => {
    const factId = `${COVERAGE_FACT_PREFIX}${entry.id}`;
    const fact = factsById.get(factId);
    if (!fact) {
      throw new TypeError(`Lookup evidence quality is missing canonical fact ${factId}.`);
    }
    return entryProjection(entry, fact);
  }));
  for (const fact of coverageFacts) {
    const entryId = fact.id.slice(COVERAGE_FACT_PREFIX.length);
    if (!matrixIds.has(entryId)) {
      throw new TypeError(`Lookup evidence quality fact ${fact.id} has no matching matrix row.`);
    }
  }

  const completeCount = entries.filter((entry) => entry.countsAsComplete).length;
  const limitedCount = entries.filter((entry) => entry.countsAsLimited).length;
  if (entries.length !== input.matrix.entries.length
    || entries.length !== coverageFacts.length
    || completeCount !== input.matrix.completeCount
    || limitedCount !== input.matrix.limitedCount) {
    throw new RangeError('Lookup evidence quality displayed rows, canonical facts, and summary counts did not reconcile.');
  }

  return Object.freeze({
    version: LOOKUP_EVIDENCE_QUALITY_MODEL_VERSION,
    observedAt: input.matrix.observedAt,
    totalMs: input.matrix.totalMs,
    entries,
    displayedRowCount: entries.length,
    canonicalCoverageFactCount: coverageFacts.length,
    completeCount,
    limitedCount,
    stale: input.matrix.stale,
    ageDays: input.matrix.ageDays,
    freshnessPolicy: freshnessPolicy(input.matrix.freshnessPolicy),
  });
}
