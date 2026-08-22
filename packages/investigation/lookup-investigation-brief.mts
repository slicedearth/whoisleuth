import type { LookupAssetGraph } from './lookup-asset-graph.mts';
import type {
  LookupDecisionSupport,
  LookupEvidenceQualityMatrix,
  LookupTaskView,
} from './lookup-artefact-inputs.mts';
import {
  DECISION_FACT_PRESENTATION_LABELS,
  projectDecisionFacts,
  type DecisionFact,
  type DecisionFactProjection,
  type DecisionFactProjectionSet,
} from '../evidence/decision-fact.mts';
import {
  PUBLIC_LOOKUP_INVESTIGATION_BRIEF_VERSION,
  LOOKUP_INVESTIGATION_BRIEF_SCHEMA,
  LOOKUP_INVESTIGATION_BRIEF_VERSION,
  MAX_LOOKUP_INVESTIGATION_BRIEF_BYTES,
  SUPPORTED_LOOKUP_INVESTIGATION_BRIEF_VERSIONS,
} from '../contracts/investigation-portability.mts';

export {
  PUBLIC_LOOKUP_INVESTIGATION_BRIEF_VERSION,
  LOOKUP_INVESTIGATION_BRIEF_SCHEMA,
  LOOKUP_INVESTIGATION_BRIEF_VERSION,
  MAX_LOOKUP_INVESTIGATION_BRIEF_BYTES,
  SUPPORTED_LOOKUP_INVESTIGATION_BRIEF_VERSIONS,
};

export type LookupInvestigationBrief = Readonly<{
  schema: typeof LOOKUP_INVESTIGATION_BRIEF_SCHEMA;
  schemaVersion: typeof LOOKUP_INVESTIGATION_BRIEF_VERSION;
  generatedAt: string;
  target: string;
  targetType: string;
  task: LookupTaskView;
  taskLabel: string;
  question: string;
  summary: string;
  observation: Readonly<{
    observedAt: string | null;
    evidenceAgeDays: number | null;
    completeSources: number;
    limitedSources: number;
    freshnessPolicy: LookupEvidenceQualityMatrix['freshnessPolicy'];
  }>;
  decisionFacts: DecisionFactProjectionSet;
  relationships: Readonly<{
    nodes: number;
    edges: number;
    truncated: boolean;
    kinds: readonly string[];
  }>;
  limitations: readonly string[];
}>;

type BuildLookupInvestigationBriefInput = Readonly<{
  generatedAt?: string;
  target: unknown;
  targetType: unknown;
  task: LookupTaskView;
  decisionSupport: LookupDecisionSupport;
  decisionFacts: readonly DecisionFact[];
  quality: LookupEvidenceQualityMatrix;
  graph: LookupAssetGraph;
}>;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;
const MAX_LIMITATIONS = 20;

function text(value: unknown, maximum = 320): string {
  return String(value ?? '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum);
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function uniqueText(values: readonly unknown[], maximum = MAX_LIMITATIONS): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = text(value);
    if (!normalized || seen.has(normalized)) continue;
    output.push(normalized);
    seen.add(normalized);
    if (output.length >= maximum) break;
  }
  return output;
}

function taskQuestion(support: LookupDecisionSupport): string {
  return support.guidance.questions[0]
    ?? 'What does the collected evidence establish, and what remains uncertain?';
}

export function buildLookupInvestigationBrief(
  input: BuildLookupInvestigationBriefInput,
): LookupInvestigationBrief {
  const generatedAt = timestamp(input.generatedAt) ?? new Date().toISOString();
  const decisionFacts = projectDecisionFacts(input.decisionFacts);
  const limitedSources = input.quality.entries
    .filter((entry) => entry.state !== 'complete')
    .map((entry) => `${entry.label}: ${entry.statusLabel}`);
  const graphKinds = uniqueText(input.graph.edges.map((edge) => edge.label), 12);

  const brief: LookupInvestigationBrief = Object.freeze({
    schema: LOOKUP_INVESTIGATION_BRIEF_SCHEMA,
    schemaVersion: LOOKUP_INVESTIGATION_BRIEF_VERSION,
    generatedAt,
    target: text(input.target, 253) || 'Unknown target',
    targetType: text(input.targetType, 40) || 'unknown',
    task: input.task,
    taskLabel: input.decisionSupport.guidance.label,
    question: taskQuestion(input.decisionSupport),
    summary: input.decisionSupport.guidance.summary,
    observation: Object.freeze({
      observedAt: input.quality.observedAt,
      evidenceAgeDays: input.quality.ageDays,
      completeSources: input.quality.completeCount,
      limitedSources: input.quality.limitedCount,
      freshnessPolicy: input.quality.freshnessPolicy,
    }),
    decisionFacts,
    relationships: Object.freeze({
      nodes: input.graph.nodes.length,
      edges: input.graph.edges.length,
      truncated: input.graph.truncated,
      kinds: Object.freeze(graphKinds),
    }),
    limitations: Object.freeze(uniqueText([
      ...limitedSources,
      ...input.graph.limitations,
      'This brief is a deterministic organisation of collected and derived evidence, not an attribution, ownership, safety, availability, or maliciousness conclusion.',
      'Analyst assertions, hypotheses, and decisions must remain separate from observed evidence.',
    ])),
  });
  if (new TextEncoder().encode(JSON.stringify(brief)).byteLength > MAX_LOOKUP_INVESTIGATION_BRIEF_BYTES) {
    throw new RangeError('Lookup investigation brief exceeded its byte limit.');
  }
  return brief;
}

function markdown(value: unknown): string {
  return text(value, 2_000)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/([\\`*_{}[\]()#+\-.!|=~])/gu, '\\$1');
}

function countedValues(
  collection: Readonly<{ total: number; displayed: number; omitted: number; items: readonly string[] }>,
): string {
  const values = collection.items.length ? collection.items.map(markdown).join(', ') : 'none';
  return `${collection.displayed} of ${collection.total} displayed; ${collection.omitted} omitted. ${values}`;
}

function decisionFactLines(fact: DecisionFactProjection): string[] {
  const lines = [
    `### ${markdown(fact.question)}`,
    '',
    `- **Fact ID:** ${markdown(fact.id)}`,
    `- **Conclusion:** ${markdown(fact.conclusion)}`,
    `- **Importance:** ${markdown(DECISION_FACT_PRESENTATION_LABELS.importance[fact.importance])}`,
    `- **Evidence state:** ${markdown(DECISION_FACT_PRESENTATION_LABELS.evidenceState[fact.evidenceState])} (${markdown(fact.evidenceState)})`,
    `- **Completeness:** ${markdown(DECISION_FACT_PRESENTATION_LABELS.completeness[fact.completeness])} (${markdown(fact.completeness)})`,
    `- **Freshness:** ${markdown(DECISION_FACT_PRESENTATION_LABELS.freshness[fact.freshness])} (${markdown(fact.freshness)})`,
    `- **Consistency:** ${markdown(DECISION_FACT_PRESENTATION_LABELS.consistency[fact.consistency])} (${markdown(fact.consistency)})`,
    `- **Dependencies:** ${countedValues(fact.dependencies)}`,
    `- **Source references:** ${countedValues(fact.sourceReferences)}`,
    `- **Attributed sources:** ${fact.sources.displayed} of ${fact.sources.total} displayed; ${fact.sources.omitted} omitted.`,
  ];
  if (fact.sources.items.length) {
    for (const source of fact.sources.items) {
      lines.push(
        `  - **${markdown(source.label)}** (${markdown(source.id)}): ${markdown(DECISION_FACT_PRESENTATION_LABELS.provenance[source.provenance])}; ${markdown(DECISION_FACT_PRESENTATION_LABELS.evidenceState[source.evidenceState])}; observed ${markdown(source.observedAt ?? 'not reported')}.`,
        `    - References: ${countedValues(source.references)}`,
        `    - Limitations: ${countedValues(source.limitations)}`,
      );
    }
  } else {
    lines.push('  - No attributed source was retained for this fact.');
  }
  lines.push(
    `- **Contradictions:** ${countedValues(fact.contradictions)}`,
    `- **Limitations:** ${countedValues(fact.limitations)}`,
    `- **Safe next actions:** ${fact.safeNextActions.displayed} of ${fact.safeNextActions.total} displayed; ${fact.safeNextActions.omitted} omitted.`,
  );
  if (fact.safeNextActions.items.length) {
    for (const action of fact.safeNextActions.items) {
      lines.push(`  - **${markdown(action.label)}** (${markdown(action.id)}; ${markdown(action.importance)}): ${markdown(action.reason)} Expected outcome: ${markdown(action.expectedOutcome)} Review destination: ${markdown(action.href)}.`);
    }
  } else {
    lines.push('  - No fact-specific action was retained. Review the attributed evidence and limitations.');
  }
  lines.push('');
  return lines;
}

export function formatLookupInvestigationBriefMarkdown(
  brief: LookupInvestigationBrief,
): string {
  const lines = [
    `# Investigation brief: ${markdown(brief.target)}`,
    '',
    `Generated ${markdown(brief.generatedAt)} from a ${markdown(brief.targetType)} Lookup.`,
    '',
    '## Decision context',
    '',
    `- **Task:** ${markdown(brief.taskLabel)}`,
    `- **Question:** ${markdown(brief.question)}`,
    `- **Summary:** ${markdown(brief.summary)}`,
    `- **Evidence observed:** ${markdown(brief.observation.observedAt ?? 'not reported')}`,
    `- **Source quality:** ${brief.observation.completeSources} complete; ${brief.observation.limitedSources} limited`,
    `- **Freshness policy:** v${brief.observation.freshnessPolicy.version} ${markdown(brief.observation.freshnessPolicy.id)} for ${markdown(brief.observation.freshnessPolicy.task)}; registration ${brief.observation.freshnessPolicy.thresholdsDays.registration}d, network ${brief.observation.freshnessPolicy.thresholdsDays.network}d, web ${brief.observation.freshnessPolicy.thresholdsDays.web}d`,
    '',
    '## Canonical Decision Facts',
    '',
    `Displaying ${brief.decisionFacts.displayed} of ${brief.decisionFacts.total} canonical Decision Facts; ${brief.decisionFacts.omitted} omitted by the bounded projection. ${brief.decisionFacts.contradictory} contradictory and ${brief.decisionFacts.unresolved} unresolved across the complete canonical set.`,
    '',
    ...(brief.decisionFacts.facts.length
      ? brief.decisionFacts.facts.flatMap(decisionFactLines)
      : ['No canonical Decision Fact was available. Review source quality before drawing a conclusion.', '']),
    '',
    '## Observed relationship map',
    '',
    `- ${brief.relationships.nodes} nodes and ${brief.relationships.edges} edges${brief.relationships.truncated ? '; bounded output was truncated' : ''}.`,
    `- Relationship types: ${brief.relationships.kinds.map(markdown).join(', ') || 'none observed'}.`,
    '',
    '## Limitations',
    '',
    ...brief.limitations.map((limitation) => `- ${markdown(limitation)}`),
    '',
  ];
  const output = lines.join('\n');
  if (new TextEncoder().encode(output).byteLength > MAX_LOOKUP_INVESTIGATION_BRIEF_BYTES) {
    throw new RangeError('Lookup investigation brief Markdown exceeded its byte limit.');
  }
  return output;
}

export function lookupInvestigationBriefFilename(
  brief: Pick<LookupInvestigationBrief, 'target' | 'generatedAt'>,
): string {
  const target = brief.target
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80) || 'lookup';
  return `whoisleuth-investigation-brief-${target}-${brief.generatedAt.slice(0, 10)}.md`;
}
