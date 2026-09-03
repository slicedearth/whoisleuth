import {
  MAX_DECISION_FACT_CONTRIBUTORS,
  MAX_DECISION_FACT_LIMITATIONS,
  MAX_DECISION_FACT_NEXT_ACTIONS,
  MAX_DECISION_FACT_REFERENCES,
  buildDecisionFacts,
  type DecisionFact,
  type DecisionFactContributorInput,
  type DecisionFactEvidenceState,
  type DecisionFactFreshness,
  type DecisionFactInput,
  type DecisionFactNextActionInput,
  type DecisionFactProvenance,
} from '../../../../packages/evidence/decision-fact.mts';
import type {
  EvidenceCoverageEntry,
  EvidenceCoverageLedger,
  EvidenceCoverageState,
} from './evidence-coverage-ledger.ts';
import type {
  LookupDecisionEntry,
  LookupDecisionSupport,
  LookupEvidenceQualityMatrix,
  LookupNextAction,
} from './lookup-decision-support.ts';

type LookupEvidenceQualityEntry = LookupEvidenceQualityMatrix['entries'][number];

const MAX_LOOKUP_DECISION_ENTRIES = 16;
const MAX_LOOKUP_COVERAGE_ENTRIES = 24;
const MAX_LOOKUP_SOURCE_LABEL_LENGTH = 160;
const INSPECTION_DESTINATION_REFERENCE = 'inspection-destination:';

const COVERAGE_STATE: Readonly<Record<EvidenceCoverageState, DecisionFactEvidenceState>> = Object.freeze({
  complete: 'observed',
  not_found: 'not_observed_in_bounded_evidence',
  skipped: 'not_collected',
  partial: 'partial',
  unsupported: 'unsupported',
  unavailable: 'unavailable',
  unknown: 'unknown',
});

const DERIVED_EVIDENCE_IDS = new Set([
  'availability',
  'client-behavior',
  'page-role',
  'security-posture',
  'technology',
]);
const REGISTRATION_EVIDENCE_IDS = new Set(['rdap', 'whois', 'registrar-rdap', 'registrar-standing']);
const NETWORK_EVIDENCE_IDS = new Set(['availability', 'dns', 'reverse-dns', 'network-context']);
const WEB_EVIDENCE_IDS = new Set([
  'client-behavior',
  'http',
  'page-identity',
  'page-role',
  'security-posture',
  'technology',
  'tls',
]);

const DECISION_SOURCE_EVIDENCE_IDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'Registry RDAP': Object.freeze(['rdap']),
  WHOIS: Object.freeze(['whois']),
  'Registrar RDAP': Object.freeze(['registrar-rdap']),
  DNS: Object.freeze(['dns']),
  HTTP: Object.freeze(['http']),
  HTML: Object.freeze(['page-identity']),
  TLS: Object.freeze(['tls']),
  'TLS certificate': Object.freeze(['tls']),
});

const COVERAGE_DESTINATIONS: Readonly<Record<string, `#${string}`>> = Object.freeze({
  rdap: '#registry',
  whois: '#registry',
  'registrar-rdap': '#registry',
  'registrar-standing': '#registry',
  availability: '#overview',
  dns: '#evidence-dns',
  'reverse-dns': '#evidence-dns',
  'network-context': '#web-evidence',
  http: '#evidence-http',
  tls: '#evidence-tls',
  'page-identity': '#evidence-page',
  'page-role': '#evidence-page',
  'client-behavior': '#evidence-page',
  technology: '#evidence-page',
  'security-posture': '#web-evidence',
  'security-txt': '#web-evidence',
  'sslbl-certificate': '#external-intelligence',
});

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedDecisionSources(value: unknown): string[] {
  let isArray = false;
  try {
    isArray = Array.isArray(value);
  } catch {
    return [];
  }
  if (!isArray || !value || typeof value !== 'object') return [];
  try {
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    const length = lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : null;
    if (!lengthDescriptor
      || lengthDescriptor.enumerable
      || !Number.isSafeInteger(length)
      || Number(length) < 0) return [];
    const retained: string[] = [];
    const maximum = Math.min(Number(length), MAX_DECISION_FACT_CONTRIBUTORS);
    for (let index = 0; index < maximum; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return [];
      if (typeof descriptor.value !== 'string'
        || descriptor.value.length === 0
        || descriptor.value.length > MAX_LOOKUP_SOURCE_LABEL_LENGTH) continue;
      retained.push(descriptor.value);
    }
    return [...new Set(retained)].sort(compareCodeUnits);
  } catch {
    return [];
  }
}

function syntheticSourceIds(sources: readonly string[]): ReadonlyMap<string, string> {
  const bySlug = new Map<string, string[]>();
  for (const source of sources) {
    const slug = sourceSlug(source);
    const labels = bySlug.get(slug) ?? [];
    labels.push(source);
    bySlug.set(slug, labels);
  }
  const output = new Map<string, string>();
  for (const [slug, labels] of bySlug) {
    for (let index = 0; index < labels.length; index += 1) {
      const source = labels[index]!;
      output.set(source, labels.length === 1 ? `source:${slug}` : `source:${slug}:${index}`);
    }
  }
  return output;
}

function sourceReference(id: string): string {
  return `lookup-evidence:${id}`;
}

function coverageDestination(id: string): `#${string}` {
  if (COVERAGE_DESTINATIONS[id]) return COVERAGE_DESTINATIONS[id];
  if (id.startsWith('external-')) return '#external-intelligence';
  return '#evidence-quality';
}

function contributorProvenance(entry: EvidenceCoverageEntry): DecisionFactProvenance {
  if (DERIVED_EVIDENCE_IDS.has(entry.id) || entry.category === 'analysis') return 'derived';
  if (entry.category === 'registry' || entry.category === 'external' || entry.id === 'sslbl') {
    return 'provider_reported';
  }
  return 'direct_observation';
}

function evidenceFreshness(
  entry: EvidenceCoverageEntry,
  quality: LookupEvidenceQualityEntry | undefined,
  matrix: LookupEvidenceQualityMatrix,
): DecisionFactFreshness {
  const state = COVERAGE_STATE[entry.state];
  if (state === 'not_collected' || state === 'unsupported') return 'not_applicable';
  if (!quality?.observedAt
    || !Number.isFinite(Date.parse(quality.observedAt))
    || quality.ageDays === null) return 'unknown';
  let threshold: number | null = null;
  if (REGISTRATION_EVIDENCE_IDS.has(entry.id)) threshold = matrix.freshnessPolicy.thresholdsDays.registration;
  else if (WEB_EVIDENCE_IDS.has(entry.id)) threshold = matrix.freshnessPolicy.thresholdsDays.web;
  else if (NETWORK_EVIDENCE_IDS.has(entry.id)) threshold = matrix.freshnessPolicy.thresholdsDays.network;
  if (threshold === null) return 'unknown';
  return quality.ageDays >= threshold ? 'stale' : 'current';
}

function coverageContributor(
  entry: EvidenceCoverageEntry,
  quality: LookupEvidenceQualityEntry | undefined,
): DecisionFactContributorInput {
  return {
    id: `evidence:${entry.id}`,
    label: entry.label,
    provenance: contributorProvenance(entry),
    evidenceState: COVERAGE_STATE[entry.state],
    references: [sourceReference(entry.id), coverageDestination(entry.id)],
    observedAt: quality?.observedAt ?? null,
    limitations: entry.limitations,
  };
}

function nextAction(action: LookupNextAction): DecisionFactNextActionInput {
  return {
    id: action.id,
    label: action.label,
    reason: action.reason,
    expectedOutcome: action.expectedOutcome,
    href: action.href,
    importance: action.priority,
  };
}

function coverageActions(
  actions: readonly LookupNextAction[],
  entry: EvidenceCoverageEntry,
  quality: LookupEvidenceQualityEntry | undefined,
  inspectLimitedEvidenceId: string | null,
): DecisionFactNextActionInput[] {
  return actions
    .slice(0, MAX_DECISION_FACT_NEXT_ACTIONS)
    .filter((action) => (
      (action.id === 'review-refresh-options' && quality?.refreshAvailable === true)
      || (action.id === 'inspect-limited-source' && entry.id === inspectLimitedEvidenceId)
    ))
    .map(nextAction);
}

function decisionActions(
  actions: readonly LookupNextAction[],
  entry: LookupDecisionEntry,
  priorityConflictEntryId: string | null,
): DecisionFactNextActionInput[] {
  return actions
    .slice(0, MAX_DECISION_FACT_NEXT_ACTIONS)
    .filter((action) => (
      action.id === 'review-priority-conflict'
      && entry.id === priorityConflictEntryId
      && action.href === entry.href
    ))
    .map(nextAction);
}

function coverageConclusion(entry: EvidenceCoverageEntry): string {
  const conclusions: Readonly<Record<EvidenceCoverageState, string>> = {
    complete: `${entry.label} was observed in the bounded Lookup evidence.`,
    not_found: `${entry.label} was not observed in the bounded evidence; this does not establish generic absence.`,
    skipped: `${entry.label} was not collected for this Lookup.`,
    partial: `${entry.label} contributed partial evidence with retained limitations.`,
    unsupported: `${entry.label} is unsupported by the selected source path.`,
    unavailable: `${entry.label} was unavailable for this Lookup.`,
    unknown: `${entry.label} has an unknown evidence state.`,
  };
  return conclusions[entry.state];
}

function coverageFact(
  entry: EvidenceCoverageEntry,
  quality: LookupEvidenceQualityEntry | undefined,
  matrix: LookupEvidenceQualityMatrix,
  actions: readonly LookupNextAction[],
  inspectLimitedEvidenceId: string | null,
): DecisionFactInput {
  const freshness = evidenceFreshness(entry, quality, matrix);
  const href = coverageDestination(entry.id);
  const evidenceState = COVERAGE_STATE[entry.state];
  return {
    id: `lookup-evidence:${entry.id}`,
    question: `What did ${entry.label} establish in this bounded Lookup?`,
    conclusion: coverageConclusion(entry),
    importance: ['partial', 'unavailable', 'unknown'].includes(entry.state) ? 'medium' : 'low',
    evidenceState,
    freshness,
    consistency: 'not_applicable',
    contributors: [coverageContributor(entry, quality)],
    references: [sourceReference(entry.id), href],
    contradictions: [],
    limitations: entry.limitations,
    nextActions: coverageActions(
      actions,
      entry,
      quality,
      inspectLimitedEvidenceId,
    ),
  };
}

function sourceSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 56) || 'unattributed';
}

function decisionContributors(
  entry: LookupDecisionEntry,
  coverageEntries: readonly EvidenceCoverageEntry[],
  qualityById: ReadonlyMap<string, LookupEvidenceQualityEntry>,
  matrix: LookupEvidenceQualityMatrix,
): Array<Readonly<{ contributor: DecisionFactContributorInput; freshness: DecisionFactFreshness }>> {
  const output: Array<Readonly<{ contributor: DecisionFactContributorInput; freshness: DecisionFactFreshness }>> = [];
  const sources = boundedDecisionSources(entry.sources);
  const sourceIds = syntheticSourceIds(sources);
  for (const source of sources) {
    if (output.length >= MAX_DECISION_FACT_CONTRIBUTORS) break;
    const directIds = DECISION_SOURCE_EVIDENCE_IDS[source] ?? [];
    const matches = coverageEntries.filter((candidate) => (
      directIds.includes(candidate.id) || candidate.label === source
    ));
    if (matches.length) {
      for (const match of matches) {
        if (output.length >= MAX_DECISION_FACT_CONTRIBUTORS) break;
        const quality = qualityById.get(match.id);
        output.push({
          contributor: coverageContributor(match, quality),
          freshness: evidenceFreshness(match, quality, matrix),
        });
      }
      continue;
    }
    const id = sourceIds.get(source) ?? 'source:unattributed';
    output.push({
      contributor: {
        id,
        label: source,
        provenance: source === 'Brand Profile' ? 'analyst_supplied' : 'derived',
        evidenceState: 'unknown',
        references: [`lookup-${id}`],
        observedAt: null,
        limitations: [],
      },
      freshness: 'unknown',
    });
  }
  return output;
}

function decisionEvidenceState(
  entry: LookupDecisionEntry,
  contributors: readonly DecisionFactContributorInput[],
): DecisionFactEvidenceState {
  const states = contributors.map((contributor) => contributor.evidenceState);
  // LookupDecisionSupport uncertainty is not an observed absence or source
  // verdict. Keep it partial only when attributed evidence is partial;
  // otherwise the fact-level decision remains unknown while contributors
  // retain their more specific collection states.
  if (entry.state === 'uncertain') return states.includes('partial') ? 'partial' : 'unknown';
  if (states.includes('partial')) return 'partial';
  if (states.includes('observed')) return 'observed';
  if (states.includes('not_observed_in_bounded_evidence')) return 'not_observed_in_bounded_evidence';
  if (states.includes('unavailable')) return 'unavailable';
  if (states.includes('not_collected')) return 'not_collected';
  if (states.includes('unsupported')) return 'unsupported';
  return 'unknown';
}

function decisionFreshness(values: readonly DecisionFactFreshness[]): DecisionFactFreshness {
  if (values.includes('stale')) return 'stale';
  if (values.length && values.every((value) => value === 'current')) return 'current';
  if (values.length && values.every((value) => value === 'not_applicable')) return 'not_applicable';
  return 'unknown';
}

function decisionFact(
  entry: LookupDecisionEntry,
  coverageEntries: readonly EvidenceCoverageEntry[],
  qualityById: ReadonlyMap<string, LookupEvidenceQualityEntry>,
  matrix: LookupEvidenceQualityMatrix,
  actions: readonly LookupNextAction[],
  priorityConflictEntryId: string | null,
): DecisionFactInput {
  const attributed = decisionContributors(entry, coverageEntries, qualityById, matrix);
  const contributors = attributed.map((item) => item.contributor);
  const references: string[] = [`${INSPECTION_DESTINATION_REFERENCE}${entry.href}`, entry.href];
  const limitations: string[] = [];
  for (const contributor of contributors) {
    for (const reference of contributor.references ?? []) {
      if (references.length >= MAX_DECISION_FACT_REFERENCES) break;
      references.push(reference);
    }
    for (const limitation of contributor.limitations ?? []) {
      if (limitations.length >= MAX_DECISION_FACT_LIMITATIONS) break;
      limitations.push(limitation);
    }
  }
  return {
    id: `lookup-decision:${entry.id}`,
    question: `What does the separately attributed evidence establish for "${entry.title}"?`,
    conclusion: `${entry.title}. ${entry.detail}`,
    importance: entry.importance,
    evidenceState: decisionEvidenceState(entry, contributors),
    freshness: decisionFreshness(attributed.map((item) => item.freshness)),
    consistency: entry.state === 'conflict' ? 'contradictory' : 'unknown',
    contributors,
    references,
    contradictions: entry.state === 'conflict' ? [`${entry.title}: ${entry.detail}`] : [],
    limitations,
    nextActions: decisionActions(actions, entry, priorityConflictEntryId),
  };
}

export function buildLookupDecisionFacts(input: Readonly<{
  decisionSupport: LookupDecisionSupport;
  coverage: EvidenceCoverageLedger;
  quality: LookupEvidenceQualityMatrix;
}>): readonly DecisionFact[] {
  const coverageEntries = input.coverage.entries.slice(0, MAX_LOOKUP_COVERAGE_ENTRIES);
  const qualityById = new Map(input.quality.entries
    .slice(0, MAX_LOOKUP_COVERAGE_ENTRIES)
    .map((entry) => [entry.id, entry]));
  const inspectLimitedEvidenceId = coverageEntries.find((entry) => (
    entry.manualReviewSuggested && qualityById.get(entry.id)?.refreshAvailable !== true
  ))?.id ?? null;
  const priorityConflictEntryId = input.decisionSupport.entries.find((entry) => (
    entry.state === 'conflict'
    && input.decisionSupport.actions.some((action) => (
      action.id === 'review-priority-conflict' && action.href === entry.href
    ))
  ))?.id ?? null;
  const facts: DecisionFactInput[] = [
    ...coverageEntries.map((entry) => coverageFact(
      entry,
      qualityById.get(entry.id),
      input.quality,
      input.decisionSupport.actions,
      inspectLimitedEvidenceId,
    )),
    ...input.decisionSupport.entries
      .slice(0, MAX_LOOKUP_DECISION_ENTRIES)
      .map((entry) => decisionFact(
        entry,
        coverageEntries,
        qualityById,
        input.quality,
        input.decisionSupport.actions,
        priorityConflictEntryId,
      )),
  ];
  return buildDecisionFacts(facts);
}
