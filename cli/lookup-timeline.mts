import { Buffer } from 'node:buffer';

import { CliUsageError } from './errors.mts';
import { buildCliLookupDiff, type CliLookupDiffDocument } from './lookup-diff.mts';
import { parseSavedLookupDocument } from './saved-lookup.mts';

export const CLI_LOOKUP_TIMELINE_SCHEMA = 'whoisleuth.cli.lookup-timeline';
export const CLI_LOOKUP_TIMELINE_VERSION = 1;
export const MAX_LOOKUP_TIMELINE_OBSERVATIONS = 20;
export const MAX_LOOKUP_TIMELINE_INPUT_BYTES = 32 * 1024 * 1024;

type TimelineObservation = Readonly<{
  index: number;
  generatedAt: string;
  mode: 'fast' | 'deep';
}>;

type TimelineTransition = Readonly<{
  index: number;
  fromObservation: number;
  toObservation: number;
  comparison: CliLookupDiffDocument['comparison'];
}>;

type LookupTimelineDocument = Readonly<{
  schema: typeof CLI_LOOKUP_TIMELINE_SCHEMA;
  version: typeof CLI_LOOKUP_TIMELINE_VERSION;
  generatedAt: string;
  domain: string;
  observations: readonly TimelineObservation[];
  transitions: readonly TimelineTransition[];
  summary: Readonly<{
    observationCount: number;
    transitionCount: number;
    transitionsWithObservedChanges: number;
    fields: Readonly<{
      conflicting: number;
      different: number;
      equal: number;
      missing: number;
      notRecorded: number;
      unavailable: number;
    }>;
  }>;
  privacy: Readonly<{
    filenamesRetained: 0;
    rawRegistryPayloadsCopied: 0;
  }>;
  limitations: readonly string[];
}>;

function buildCliLookupTimeline(
  inputs: readonly string[],
  generatedAt = new Date().toISOString(),
): LookupTimelineDocument {
  if (inputs.length < 2 || inputs.length > MAX_LOOKUP_TIMELINE_OBSERVATIONS) {
    throw new CliUsageError(`Lookup timeline requires from 2 to ${MAX_LOOKUP_TIMELINE_OBSERVATIONS} saved Lookup documents.`);
  }
  const totalBytes = inputs.reduce((total, input) => total + Buffer.byteLength(input, 'utf8'), 0);
  if (totalBytes > MAX_LOOKUP_TIMELINE_INPUT_BYTES) {
    throw new CliUsageError(`Lookup timeline input is limited to ${MAX_LOOKUP_TIMELINE_INPUT_BYTES} bytes in total.`);
  }

  const normalized = inputs.map((input, index) => ({
    input,
    document: parseSavedLookupDocument(input, { label: `Lookup timeline input ${index + 1}` }),
    inputIndex: index,
  }));
  const domain = normalized[0]?.document.registrableDomain;
  if (!domain || normalized.some((item) => item.document.registrableDomain !== domain)) {
    throw new CliUsageError('Lookup timeline requires observations for exactly one domain.');
  }
  normalized.sort((left, right) => (
    Date.parse(left.document.generatedAt) - Date.parse(right.document.generatedAt)
      || left.inputIndex - right.inputIndex
  ));
  for (let index = 1; index < normalized.length; index++) {
    if (normalized[index - 1]?.document.generatedAt === normalized[index]?.document.generatedAt) {
      throw new CliUsageError('Lookup timeline observation times must be unique.');
    }
  }

  const observations = normalized.map((item, index): TimelineObservation => ({
    index,
    generatedAt: item.document.generatedAt,
    mode: item.document.mode,
  }));
  const transitions = normalized.slice(1).map((current, index): TimelineTransition => {
    const previous = normalized[index];
    if (!previous) throw new TypeError('Lookup timeline ordering failed.');
    const diff = buildCliLookupDiff(previous.input, current.input, generatedAt, { domainMode: 'same' });
    return {
      index,
      fromObservation: index,
      toObservation: index + 1,
      comparison: diff.comparison,
    };
  });

  const fields = {
    conflicting: 0,
    different: 0,
    equal: 0,
    missing: 0,
    notRecorded: 0,
    unavailable: 0,
  };
  let transitionsWithObservedChanges = 0;
  for (const transition of transitions) {
    const counts = transition.comparison.counts;
    fields.conflicting += counts.conflicting;
    fields.different += counts.different;
    fields.equal += counts.equal;
    fields.missing += counts.missing;
    fields.notRecorded += counts.not_recorded;
    fields.unavailable += counts.unavailable;
    if (counts.conflicting + counts.different > 0) transitionsWithObservedChanges += 1;
  }

  return {
    schema: CLI_LOOKUP_TIMELINE_SCHEMA,
    version: CLI_LOOKUP_TIMELINE_VERSION,
    generatedAt,
    domain,
    observations,
    transitions,
    summary: {
      observationCount: observations.length,
      transitionCount: transitions.length,
      transitionsWithObservedChanges,
      fields,
    },
    privacy: {
      filenamesRetained: 0,
      rawRegistryPayloadsCopied: 0,
    },
    limitations: [
      'The timeline compares only bounded normalised fields already present in the selected saved Lookup documents and makes no network request.',
      'Input filenames and raw registry payloads are not copied into the timeline output.',
      'Missing, unavailable, and not-recorded evidence remain separate from an observed difference.',
      'A difference can reflect a domain change or changed collection conditions and does not by itself establish current state, ownership, intent, safety, or maliciousness.',
    ],
  };
}

function formatCliLookupTimeline(document: LookupTimelineDocument): string {
  const output = [
    'Same-domain observation timeline',
    `Domain             ${document.domain}`,
    `Observations       ${document.summary.observationCount}`,
    `First observed     ${document.observations[0]?.generatedAt || 'Unavailable'}`,
    `Last observed      ${document.observations.at(-1)?.generatedAt || 'Unavailable'}`,
    `Changed transitions ${document.summary.transitionsWithObservedChanges}`,
  ];
  for (const transition of document.transitions) {
    const from = document.observations[transition.fromObservation];
    const to = document.observations[transition.toObservation];
    const counts = transition.comparison.counts;
    const changedRows = transition.comparison.rows.filter((row) => (
      row.state === 'conflicting' || row.state === 'different' || row.state === 'missing'
    ));
    output.push(
      '',
      `${from?.generatedAt || 'Unavailable'} to ${to?.generatedAt || 'Unavailable'}`,
      `  Observed changes ${counts.conflicting + counts.different}`,
      `  One-sided fields ${counts.missing}`,
      `  Unavailable      ${counts.unavailable + counts.not_recorded}`,
    );
    if (!changedRows.length) output.push('  No observed field changes in comparable evidence.');
    for (const row of changedRows.slice(0, 10)) {
      output.push(`  ${row.label} [${row.state.replaceAll('_', ' ')}]: ${row.left} -> ${row.right}`);
    }
    if (changedRows.length > 10) output.push(`  ${changedRows.length - 10} additional changed fields omitted; use --json for the complete bounded comparison.`);
  }
  output.push('', 'Limitations:');
  for (const limitation of document.limitations) output.push(`  - ${limitation}`);
  return `${output.join('\n')}\n`;
}

export { buildCliLookupTimeline, formatCliLookupTimeline };
export type { LookupTimelineDocument, TimelineObservation, TimelineTransition };
