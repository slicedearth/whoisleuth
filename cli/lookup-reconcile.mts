import { CliUsageError } from './errors.mts';
import { buildCliLookupDiff } from './lookup-diff.mts';
import { parseSavedLookupDocument, type SavedLookupDocument, type UnknownRecord } from './saved-lookup.mts';

const CLI_LOOKUP_RECONCILIATION_SCHEMA = 'whoisleuth.cli.lookup-reconciliation';
const CLI_LOOKUP_RECONCILIATION_VERSION = 1;
const MAX_LOOKUP_RECONCILIATION_INPUT_BYTES = 32 * 1024 * 1024;

type ObservationContext = Readonly<{
  generatedAt: string;
  mode: 'deep' | 'fast';
  observerLabel: string | null;
  vantageLabel: string | null;
}>;

type ReconciledValue = Readonly<{
  observation: number;
  value: string;
  sourceState: string;
  comparable: boolean;
}>;

type ReconciliationField = Readonly<{
  id: string;
  category: string;
  label: string;
  source: string;
  state: 'agreement' | 'disagreement' | 'non_comparable';
  method: string;
  values: readonly ReconciledValue[];
  limitations: readonly string[];
}>;

type CliLookupReconciliationDocument = Readonly<{
  schema: typeof CLI_LOOKUP_RECONCILIATION_SCHEMA;
  version: typeof CLI_LOOKUP_RECONCILIATION_VERSION;
  generatedAt: string;
  domain: string;
  independence: Readonly<{
    state: 'verified_distinct_labels' | 'unverified';
    reason: string;
  }>;
  observations: readonly ObservationContext[];
  fields: readonly ReconciliationField[];
  summary: Readonly<{
    observationCount: number;
    agreement: number;
    disagreement: number;
    nonComparable: number;
  }>;
  privacy: Readonly<{
    filenamesRetained: 0;
    rawRegistryPayloadsCopied: 0;
  }>;
  limitations: readonly string[];
}>;

function object(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function label(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 80);
  return normalized || null;
}

function observationContext(document: SavedLookupDocument): ObservationContext {
  const context = object(document.collectionContext);
  return {
    generatedAt: document.generatedAt,
    mode: document.mode,
    observerLabel: label(context.observerLabel),
    vantageLabel: label(context.vantageLabel),
  };
}

function comparable(value: string, sourceState: string): boolean {
  if (['error', 'not_recorded', 'partial', 'skipped', 'unavailable', 'unsupported'].includes(sourceState)) return false;
  return value !== 'Not observed' && value !== 'Not recorded in compact Bulk evidence';
}

function normalizedValue(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US');
}

function buildCliLookupReconciliation(
  inputs: readonly string[],
  generatedAt = new Date().toISOString(),
): CliLookupReconciliationDocument {
  if (inputs.length < 2 || inputs.length > 5) throw new CliUsageError('Lookup reconciliation requires from 2 to 5 observations.');
  const documents = inputs.map((input, index) => parseSavedLookupDocument(input, {
    label: `Lookup reconciliation observation ${index + 1}`,
  }));
  const domain = documents[0]?.registrableDomain;
  if (!domain || documents.some((candidate) => candidate.registrableDomain !== domain)) {
    throw new CliUsageError('Lookup reconciliation requires observations for one domain.');
  }

  const comparisons = documents.slice(1).map((document, index) => buildCliLookupDiff(
    inputs[0]!,
    inputs[index + 1]!,
    generatedAt,
    { domainMode: 'same' },
  ));
  const firstRows = comparisons[0]?.comparison.rows || [];
  const fields = firstRows.map((firstRow) => {
    const values: ReconciledValue[] = [{
      observation: 0,
      value: firstRow.left,
      sourceState: firstRow.leftSourceState,
      comparable: comparable(firstRow.left, firstRow.leftSourceState),
    }];
    for (let index = 0; index < comparisons.length; index++) {
      const row = comparisons[index]!.comparison.rows.find((candidate) => candidate.id === firstRow.id);
      if (!row) continue;
      values.push({
        observation: index + 1,
        value: row.right,
        sourceState: row.rightSourceState,
        comparable: comparable(row.right, row.rightSourceState),
      });
    }
    const comparableValues = values.filter((value) => value.comparable);
    const distinctValues = new Set(comparableValues.map((value) => normalizedValue(value.value)));
    const state = comparableValues.length < 2
      ? 'non_comparable'
      : distinctValues.size === 1
        ? 'agreement'
        : 'disagreement';
    return {
      id: firstRow.id,
      category: firstRow.category,
      label: firstRow.label,
      source: firstRow.source,
      state,
      method: firstRow.method,
      values,
      limitations: firstRow.limitations,
    } satisfies ReconciliationField;
  });

  const observations = documents.map(observationContext);
  const identities = observations.map((observation) => (
    observation.observerLabel && observation.vantageLabel
      ? `${observation.observerLabel}\u0000${observation.vantageLabel}`
      : null
  ));
  const labelsComplete = identities.every((identity): identity is string => identity !== null);
  const labelsDistinct = labelsComplete && new Set(identities).size === identities.length;
  const independence = labelsDistinct
    ? {
        state: 'verified_distinct_labels' as const,
        reason: 'Every observation carries a different analyst-supplied observer and vantage label.',
      }
    : {
        state: 'unverified' as const,
        reason: 'Observer and vantage labels are missing or repeated; independent collection cannot be inferred.',
      };
  return {
    schema: CLI_LOOKUP_RECONCILIATION_SCHEMA,
    version: CLI_LOOKUP_RECONCILIATION_VERSION,
    generatedAt,
    domain,
    independence,
    observations,
    fields,
    summary: {
      observationCount: observations.length,
      agreement: fields.filter((field) => field.state === 'agreement').length,
      disagreement: fields.filter((field) => field.state === 'disagreement').length,
      nonComparable: fields.filter((field) => field.state === 'non_comparable').length,
    },
    privacy: { filenamesRetained: 0, rawRegistryPayloadsCopied: 0 },
    limitations: [
      'This report reconciles only bounded normalised values already present in saved Lookup documents and makes no network request.',
      'Observer and vantage labels are analyst-supplied metadata. Distinct labels do not prove independent resolvers, networks, providers, caches, or collection paths.',
      'Agreement can reflect shared upstream data or collection conditions. Disagreement can reflect collection timing, propagation, source health, or a real domain change.',
      'Non-comparable evidence remains separate from agreement and is never interpreted as absence, safety, or a negative finding.',
    ],
  };
}

function formatCliLookupReconciliation(document: CliLookupReconciliationDocument): string {
  const output = [
    'Lookup observation reconciliation',
    `Domain             ${document.domain}`,
    `Observations       ${document.summary.observationCount}`,
    `Independence       ${document.independence.state.replaceAll('_', ' ')}`,
    `Agreement          ${document.summary.agreement}`,
    `Disagreement       ${document.summary.disagreement}`,
    `Non-comparable     ${document.summary.nonComparable}`,
    '',
  ];
  for (const field of document.fields.filter((candidate) => candidate.state !== 'agreement')) {
    output.push(`${field.label} [${field.state.replaceAll('_', ' ')}]`);
    for (const value of field.values) {
      output.push(`  Observation ${value.observation + 1}: ${value.value} (${value.sourceState.replaceAll('_', ' ')})`);
    }
  }
  output.push('', 'Limitations:');
  for (const limitation of document.limitations) output.push(`  - ${limitation}`);
  return `${output.join('\n')}\n`;
}

export {
  CLI_LOOKUP_RECONCILIATION_SCHEMA,
  CLI_LOOKUP_RECONCILIATION_VERSION,
  MAX_LOOKUP_RECONCILIATION_INPUT_BYTES,
  buildCliLookupReconciliation,
  formatCliLookupReconciliation,
};
export type { CliLookupReconciliationDocument, ObservationContext, ReconciliationField };
