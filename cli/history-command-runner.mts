import { Buffer } from 'node:buffer';

import type { CliArguments } from './arguments.mts';
import { boundedCliErrorMessage, CliUsageError } from './errors.mts';
import EXIT_CODES from './exit-codes.mts';
import { buildCliEvidenceExport, formatCliEvidenceExport } from './export-evidence.mts';
import { formatJsonDocument } from './formatters/json.mts';
import { formatLookupEvidenceHtml } from './formatters/html.mts';
import { formatLookupEvidenceMarkdown } from './formatters/markdown.mts';
import {
  MAX_LOOKUP_RECONCILIATION_INPUT_BYTES,
  buildCliLookupReconciliation,
  formatCliLookupReconciliation,
} from './lookup-reconcile.mts';
import {
  MAX_LOOKUP_TIMELINE_INPUT_BYTES,
  buildCliLookupTimeline,
  formatCliLookupTimeline,
} from './lookup-timeline.mts';
import {
  MAX_RETAINED_ARTIFACT_DIFF_BYTES,
  buildCliRetainedArtifactDiff,
  formatCliRetainedArtifactDiff,
} from './retained-artifact-diff.mts';
import type { CliCommandContext, CliDependencies } from './runner-types.mts';
import { MAX_SAVED_LOOKUP_INPUT_BYTES } from './saved-lookup.mts';
import { HISTORY_INLINE_COMMANDS } from './inline-command-families.mts';

import { runDiscriminatedCommandHandler, type DiscriminatedCommandHandlerMap } from './discriminated-command-handlers.mts';
type HistoryInlineCommand = typeof HISTORY_INLINE_COMMANDS[number];
type HistoryCommandArguments = Extract<CliArguments, { action: HistoryInlineCommand }>;


async function runRetainedDiffCommand(
  args: Extract<HistoryCommandArguments, { action: 'diff' }>,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Retained artifact diff');
  const readDiffInput = dependencies.readDiffInput
    || ((source: string) => context.readInput(source, MAX_RETAINED_ARTIFACT_DIFF_BYTES, 'Retained diff input'));
  let leftInput: string;
  let rightInput: string;
  try {
    [leftInput, rightInput] = await Promise.all([
      readDiffInput(args.leftSource),
      readDiffInput(args.rightSource),
    ]);
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(`Could not read retained diff input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
  }
  const document = buildCliRetainedArtifactDiff(
    leftInput,
    rightInput,
    { leftSessionId: args.leftSessionId, rightSessionId: args.rightSessionId },
    context.now(),
  );
  if (!args.quiet) {
    context.writeStdout(args.output === 'json'
      ? formatJsonDocument(document)
      : context.terminal(formatCliRetainedArtifactDiff(document), args.color));
  }
  return EXIT_CODES.SUCCESS;
}

async function runReconciliationCommand(
  args: Extract<HistoryCommandArguments, { action: 'reconcile' }>,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Lookup observation reconciliation');
  const readReconciliationInput = dependencies.readDiffInput
    || ((source: string) => context.readInput(source, MAX_SAVED_LOOKUP_INPUT_BYTES, 'Lookup reconciliation input'));
  const inputs: string[] = [];
  let totalBytes = 0;
  try {
    for (const source of args.sources) {
      const input = await readReconciliationInput(source);
      totalBytes += Buffer.byteLength(input, 'utf8');
      if (totalBytes > MAX_LOOKUP_RECONCILIATION_INPUT_BYTES) {
        throw new CliUsageError(`Lookup reconciliation input is limited to ${MAX_LOOKUP_RECONCILIATION_INPUT_BYTES} bytes in total.`);
      }
      inputs.push(input);
    }
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(`Could not read Lookup reconciliation input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
  }
  const document = buildCliLookupReconciliation(inputs, context.now());
  if (!args.quiet) {
    context.writeStdout(args.output === 'json'
      ? formatJsonDocument(document)
      : context.terminal(formatCliLookupReconciliation(document), args.color));
  }
  return EXIT_CODES.SUCCESS;
}

async function runTimelineCommand(
  args: Extract<HistoryCommandArguments, { action: 'timeline' }>,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Lookup observation timeline');
  const readTimelineInput = dependencies.readDiffInput
    || ((source: string) => context.readInput(source, MAX_SAVED_LOOKUP_INPUT_BYTES, 'Lookup timeline input'));
  const inputs: string[] = [];
  let totalBytes = 0;
  try {
    for (const source of args.sources) {
      const input = await readTimelineInput(source);
      totalBytes += Buffer.byteLength(input, 'utf8');
      if (totalBytes > MAX_LOOKUP_TIMELINE_INPUT_BYTES) {
        throw new CliUsageError(`Lookup timeline input is limited to ${MAX_LOOKUP_TIMELINE_INPUT_BYTES} bytes in total.`);
      }
      inputs.push(input);
    }
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(`Could not read Lookup timeline input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
  }
  const document = buildCliLookupTimeline(inputs, context.now());
  if (!args.quiet) {
    context.writeStdout(args.output === 'json'
      ? formatJsonDocument(document)
      : context.terminal(formatCliLookupTimeline(document), args.color));
  }
  return EXIT_CODES.SUCCESS;
}

async function runExportCommand(
  args: Extract<HistoryCommandArguments, { action: 'export' }>,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Evidence export');
  let input: string;
  try {
    input = dependencies.readExportInput
      ? await dependencies.readExportInput(args.source)
      : await context.readInput(args.source, MAX_SAVED_LOOKUP_INPUT_BYTES, 'Evidence export input');
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(`Could not read evidence export input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
  }
  if (!input.trim()) throw new CliUsageError('export requires one lookup JSON file or a lookup document on stdin.');
  const loadEvidence = dependencies.loadEvidenceExport || (() => import('../lib/evidence-export.mts'));
  const evidenceModule = await loadEvidence();
  const document = buildCliEvidenceExport(input, evidenceModule, context.now());
  const output = args.format === 'markdown'
    ? formatLookupEvidenceMarkdown(document, { includeAttribution: args.includeAttribution })
    : args.format === 'html'
      ? formatLookupEvidenceHtml(document, { includeAttribution: args.includeAttribution })
      : formatCliEvidenceExport(document, args.compact);
  context.writeStdout(output);
  return EXIT_CODES.SUCCESS;
}

const HISTORY_COMMAND_HANDLERS = Object.freeze({
  'diff': runRetainedDiffCommand,
  'reconcile': runReconciliationCommand,
  'timeline': runTimelineCommand,
  'export': runExportCommand,
} satisfies DiscriminatedCommandHandlerMap<
  HistoryCommandArguments,
  [CliDependencies, CliCommandContext],
  number
>);

function runHistoryCommand(
  args: HistoryCommandArguments,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  return runDiscriminatedCommandHandler(HISTORY_COMMAND_HANDLERS, args, dependencies, context);
}

export { HISTORY_COMMAND_HANDLERS, runHistoryCommand };
