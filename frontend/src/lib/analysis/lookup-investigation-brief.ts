import type { LookupAssetGraph } from './lookup-asset-graph.ts';
import type {
  LookupDecisionEntry,
  LookupDecisionSupport,
  LookupEvidenceQualityMatrix,
  LookupNextAction,
} from './lookup-decision-support.ts';
import type {
  LookupSummaryFact,
  LookupSummaryModel,
} from './lookup-summary-model.ts';
import type { LookupTaskView } from './lookup-presentation.ts';

export const LOOKUP_INVESTIGATION_BRIEF_SCHEMA = 'whoisleuth.investigation-brief';
export const LOOKUP_INVESTIGATION_BRIEF_VERSION = 1;

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
  }>;
  verifiedFacts: readonly LookupSummaryFact[];
  contradictions: readonly LookupDecisionEntry[];
  unknowns: readonly LookupDecisionEntry[];
  nextActions: readonly LookupNextAction[];
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
  summary: LookupSummaryModel;
  decisionSupport: LookupDecisionSupport;
  quality: LookupEvidenceQualityMatrix;
  graph: LookupAssetGraph;
}>;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;
const MAX_FACTS = 12;
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
  const verifiedFacts = input.summary.facts
    .filter((fact) => fact.value !== '—')
    .slice(0, MAX_FACTS);
  const contradictions = input.decisionSupport.entries
    .filter((entry) => entry.state === 'conflict');
  const unknowns = input.decisionSupport.entries
    .filter((entry) => entry.state === 'uncertain');
  const limitedSources = input.quality.entries
    .filter((entry) => entry.state !== 'complete')
    .map((entry) => `${entry.label}: ${entry.statusLabel}`);
  const graphKinds = uniqueText(input.graph.edges.map((edge) => edge.label), 12);

  return {
    schema: LOOKUP_INVESTIGATION_BRIEF_SCHEMA,
    schemaVersion: LOOKUP_INVESTIGATION_BRIEF_VERSION,
    generatedAt,
    target: text(input.target, 253) || 'Unknown target',
    targetType: text(input.targetType, 40) || 'unknown',
    task: input.task,
    taskLabel: input.decisionSupport.guidance.label,
    question: taskQuestion(input.decisionSupport),
    summary: input.decisionSupport.guidance.summary,
    observation: {
      observedAt: input.quality.observedAt,
      evidenceAgeDays: input.quality.ageDays,
      completeSources: input.quality.completeCount,
      limitedSources: input.quality.limitedCount,
    },
    verifiedFacts,
    contradictions,
    unknowns,
    nextActions: input.decisionSupport.actions,
    relationships: {
      nodes: input.graph.nodes.length,
      edges: input.graph.edges.length,
      truncated: input.graph.truncated,
      kinds: graphKinds,
    },
    limitations: uniqueText([
      ...limitedSources,
      ...input.graph.limitations,
      'This brief is a deterministic organization of collected and derived evidence, not an attribution, ownership, safety, availability, or maliciousness conclusion.',
      'Analyst assertions, hypotheses, and decisions must remain separate from observed evidence.',
    ]),
  };
}

function markdown(value: unknown): string {
  return text(value, 2_000)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/([\\`*_{}[\]()#+\-.!|=~])/gu, '\\$1');
}

function factLine(fact: LookupSummaryFact): string {
  const sources = fact.provenance.sources.length
    ? ` Sources: ${fact.provenance.sources.map(markdown).join(', ')}.`
    : '';
  return `- **${markdown(fact.label)}:** ${markdown(fact.value)}.${sources}`;
}

function decisionLine(entry: LookupDecisionEntry): string {
  return `- **${markdown(entry.title)}:** ${markdown(entry.detail)} Sources: ${entry.sources.map(markdown).join(', ') || 'not reported'}.`;
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
    '',
    '## Verified normalized facts',
    '',
    ...(brief.verifiedFacts.length ? brief.verifiedFacts.map(factLine) : ['- No normalized fact was available for this brief.']),
    '',
    '## Contradictory evidence',
    '',
    ...(brief.contradictions.length ? brief.contradictions.map(decisionLine) : ['- No explicit contradiction was derived from the supported comparisons.']),
    '',
    '## Unknowns and incomplete comparisons',
    '',
    ...(brief.unknowns.length ? brief.unknowns.map(decisionLine) : ['- No explicit uncertainty entry was derived. Review source quality before treating this as complete.']),
    '',
    '## Recommended next manual steps',
    '',
    ...(brief.nextActions.length
      ? brief.nextActions.map((action) => `- **${markdown(action.label)}:** ${markdown(action.reason)}`)
      : ['- Review the underlying source evidence and its limitations.']),
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
  return lines.join('\n');
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
