import { parseLookupEvidenceReplay, type LookupEvidenceReplay } from '../lib/lookup-evidence-replay.mts';
import type { HomepageMetadataDisplay } from '../lib/lookup-homepage-metadata-display.mts';
import { tokenLabel } from '../packages/analysis/display-label.mts';
import { CliUsageError } from './errors.mts';
import { appendSection, safeTerminalValue } from './formatters/terminal-shared.mts';

// Reads one exported evidence file with the same replay validation as browser
// evidence replay, so a browser download and a CLI export read identically in
// both surfaces.

export const CLI_LOOKUP_EVIDENCE_VIEW_SCHEMA = 'whoisleuth.cli.lookup-evidence-view';
export const CLI_LOOKUP_EVIDENCE_VIEW_VERSION = 1;

export type CliLookupEvidenceViewDocument = Readonly<{
  schema: typeof CLI_LOOKUP_EVIDENCE_VIEW_SCHEMA;
  version: typeof CLI_LOOKUP_EVIDENCE_VIEW_VERSION;
  generatedAt: string;
  replay: LookupEvidenceReplay;
}>;

export async function readCliLookupEvidenceReplay(raw: string, label: string): Promise<LookupEvidenceReplay> {
  try {
    return await parseLookupEvidenceReplay(raw);
  } catch (error) {
    throw new CliUsageError(`${label}: ${error instanceof Error ? error.message : 'the evidence export is invalid.'}`);
  }
}

export async function buildCliLookupEvidenceView(
  raw: string,
  generatedAt = new Date().toISOString(),
): Promise<CliLookupEvidenceViewDocument> {
  return Object.freeze({
    schema: CLI_LOOKUP_EVIDENCE_VIEW_SCHEMA,
    version: CLI_LOOKUP_EVIDENCE_VIEW_VERSION,
    generatedAt,
    replay: await readCliLookupEvidenceReplay(raw, 'Evidence export'),
  });
}

function metadataLines(label: string, metadata: HomepageMetadataDisplay | null): string[] {
  if (!metadata) return [];
  return [
    `  ${label} · ${safeTerminalValue(metadata.status)}${metadata.complete ? '' : ' · incomplete'}${metadata.truncated ? ' · truncated' : ''}`,
    ...metadata.rows.map((row) => `    ${safeTerminalValue(row.label)}: ${safeTerminalValue(row.value)}`),
  ];
}

export function formatCliLookupEvidenceView(document: CliLookupEvidenceViewDocument): string {
  const { replay } = document;
  const exported = [replay.exportedAt, tokenLabel(replay.targetType), `schema ${replay.schemaVersion}`,
    ...(replay.generatorVersion ? [`WHOISleuth ${replay.generatorVersion}`] : [])];
  const lines = [
    'Lookup evidence replay',
    `Target           ${safeTerminalValue(replay.target)}`,
    ...(replay.observationHostname && replay.observationHostname !== replay.target ? [`Observed host    ${safeTerminalValue(replay.observationHostname)}`] : []),
    `Exported         ${exported.map((part) => safeTerminalValue(part)).join(' · ')}`,
    `Availability     ${safeTerminalValue(tokenLabel(replay.availability))} · ${safeTerminalValue(replay.confidence)} confidence`,
    `File SHA-256     ${safeTerminalValue(replay.digestSha256)}`,
    '                 Calculated locally; compare it with a trusted checksum before relying on the file.',
  ];
  if (replay.webObservationMode) lines.push('Web evidence concerns a selected URL, not the homepage.');
  appendSection(lines, 'Sources', replay.sources.map((source) => `  ${safeTerminalValue(source.label)} · ${safeTerminalValue(tokenLabel(source.state))}${source.complete === false ? ' · incomplete' : ''} · ${source.observedAt ? `observed ${safeTerminalValue(source.observedAt)}` : 'observation time not reported'}`));
  appendSection(lines, 'Normalised facts', replay.facts.map((fact) => `  ${safeTerminalValue(fact.label)}: ${safeTerminalValue(fact.value)} (${safeTerminalValue(fact.source)} · ${safeTerminalValue(fact.sourceState)}${fact.sourceComplete === false ? ' · incomplete' : ''})`));
  appendSection(lines, 'Retained homepage metadata', [
    ...metadataLines('Publication metadata', replay.pagePublicationMetadata),
    ...metadataLines('Delivery and cache metadata', replay.httpDeliveryMetadata),
  ]);
  appendSection(lines, 'Contradictory registration evidence', replay.contradictions.map((item) => `  - ${safeTerminalValue(item)}`));
  appendSection(lines, 'Unknown or incomplete', replay.unknowns.length
    ? replay.unknowns.map((item) => `  - ${safeTerminalValue(item)}`)
    : ['  No incomplete replay source was identified.']);
  appendSection(lines, 'Next manual steps', replay.recommendedSteps.map((step, index) => `  ${index + 1}. ${safeTerminalValue(step)}`));
  appendSection(lines, 'Limitations', replay.limitations.map((item) => `  - ${safeTerminalValue(item)}`));
  return `${lines.join('\n')}\n`;
}
