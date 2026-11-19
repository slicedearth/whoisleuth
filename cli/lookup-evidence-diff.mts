import type { LookupEvidenceReplay } from '../lib/lookup-evidence-replay.mts';
import {
  buildLookupEvidenceReplayDiff,
  LOOKUP_EVIDENCE_REPLAY_DIFF_KIND_LABELS,
  LOOKUP_EVIDENCE_REPLAY_DIFF_NO_CHANGES,
} from '../lib/lookup-evidence-replay-diff.mts';
import { CliUsageError } from './errors.mts';
import { readCliLookupEvidenceReplay } from './lookup-evidence-replay.mts';
import { safeTerminalValue } from './formatters/terminal-shared.mts';

// Compares two exported evidence files with the same replay validation and
// difference classification used by browser evidence replay, so a browser
// download and a CLI export read identically in both surfaces.

export const CLI_LOOKUP_EVIDENCE_DIFF_SCHEMA = 'whoisleuth.cli.lookup-evidence-diff';
export const CLI_LOOKUP_EVIDENCE_DIFF_VERSION = 1;

type ReplaySide = Readonly<{
  exportedAt: string;
  digestSha256: string;
  schemaVersion: number;
  generatorVersion: string | null;
}>;

export type CliLookupEvidenceDiffDocument = Readonly<{
  schema: typeof CLI_LOOKUP_EVIDENCE_DIFF_SCHEMA;
  version: typeof CLI_LOOKUP_EVIDENCE_DIFF_VERSION;
  generatedAt: string;
  target: string;
  left: ReplaySide;
  right: ReplaySide;
  comparison: Omit<ReturnType<typeof buildLookupEvidenceReplayDiff>, 'target' | 'left' | 'right' | 'limitations'>;
  limitations: readonly string[];
}>;

function side(value: LookupEvidenceReplay): ReplaySide {
  return Object.freeze({
    exportedAt: value.exportedAt,
    digestSha256: value.digestSha256,
    schemaVersion: value.schemaVersion,
    generatorVersion: value.generatorVersion,
  });
}

export async function buildCliLookupEvidenceDiff(
  leftRaw: string,
  rightRaw: string,
  generatedAt = new Date().toISOString(),
): Promise<CliLookupEvidenceDiffDocument> {
  const [left, right] = await Promise.all([
    readCliLookupEvidenceReplay(leftRaw, 'Left evidence export'),
    readCliLookupEvidenceReplay(rightRaw, 'Right evidence export'),
  ]);
  if (Date.parse(left.exportedAt) > Date.parse(right.exportedAt)) {
    throw new CliUsageError('diff expects the earlier evidence export on the left and the later one on the right.');
  }
  let comparison: ReturnType<typeof buildLookupEvidenceReplayDiff>;
  try {
    comparison = buildLookupEvidenceReplayDiff(left, right);
  } catch (error) {
    throw new CliUsageError(error instanceof Error ? error.message : 'The evidence exports cannot be compared.');
  }
  const { target, left: _left, right: _right, limitations, ...rest } = comparison;
  return Object.freeze({
    schema: CLI_LOOKUP_EVIDENCE_DIFF_SCHEMA,
    version: CLI_LOOKUP_EVIDENCE_DIFF_VERSION,
    generatedAt,
    target,
    left: side(left),
    right: side(right),
    comparison: rest,
    limitations,
  });
}

export function formatCliLookupEvidenceDiff(document: CliLookupEvidenceDiffDocument): string {
  const { counts } = document.comparison;
  const rows = document.comparison.rows.filter((row) => row.kind !== 'unchanged');
  const output = [
    'Lookup evidence comparison',
    `Target           ${safeTerminalValue(document.target)}`,
    `Earlier export   ${safeTerminalValue(document.left.exportedAt)} · sha256:${safeTerminalValue(document.left.digestSha256.slice(0, 12))}`,
    `Later export     ${safeTerminalValue(document.right.exportedAt)} · sha256:${safeTerminalValue(document.right.digestSha256.slice(0, 12))}`,
    `Observed         ${counts.observedChanges}`,
    `Collection       ${counts.collectionDifferences}`,
    `Interpretation   ${counts.interpretationDifferences}`,
    `Unchanged        ${counts.unchanged}`,
    '',
  ];
  if (!rows.length) output.push(LOOKUP_EVIDENCE_REPLAY_DIFF_NO_CHANGES);
  for (const row of rows) {
    output.push(`${safeTerminalValue(row.label)} [${LOOKUP_EVIDENCE_REPLAY_DIFF_KIND_LABELS[row.kind]}]`);
    output.push(`  Earlier: ${safeTerminalValue(row.left)}`);
    output.push(`  Later:   ${safeTerminalValue(row.right)}`);
    output.push(`  ${safeTerminalValue(row.explanation)}`);
  }
  if (document.comparison.truncated) output.push('', 'The comparison reached its row limit; further rows are not listed.');
  output.push('', 'Limitations:');
  for (const limitation of document.limitations) output.push(`  - ${safeTerminalValue(limitation)}`);
  return `${output.join('\n')}\n`;
}
