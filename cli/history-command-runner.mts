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
import type { CliCommandContext } from './runner-types.mts';
import { MAX_SAVED_LOOKUP_INPUT_BYTES, parseCliLookupDocument } from './saved-lookup.mts';
import { formatTerminalLookup } from './formatters/terminal.mts';
import { CLI_LOOKUP_DIFF_SCHEMA } from './lookup-diff.mts';
import { browseLookupDocument, browseLookupComparison, canBrowseLookup, type LookupBrowserOptions } from './lookup-browser.mts';
import type { BoundedTextStream } from './bulk.mts';
import type { TerminalEnvironment } from './terminal-presentation.mts';
import { HISTORY_INLINE_COMMANDS } from './inline-command-families.mts';
import { MAX_MCP_TOTAL_BYTES } from '../packages/contracts/local-tool-adapter.mts';
import { LOOKUP_EVIDENCE_SCHEMA } from '../packages/contracts/lookup-evidence.mts';

import { runDiscriminatedCommandHandler, type DiscriminatedCommandHandlerMap } from './discriminated-command-handlers.mts';

export type HistoryCommandDependencies = {
  stdin?: BoundedTextStream;
  environment?: TerminalEnvironment;
  signal?: AbortSignal;
  readDiffInput?: (source: string) => string | Promise<string>;
  readExportInput?: (source?: string | null) => string | Promise<string>;
  loadEvidenceExport?: () => Promise<typeof import('../lib/evidence-export.mts')>;
};

type HistoryInlineCommand = typeof HISTORY_INLINE_COMMANDS[number];
type HistoryCommandArguments = Extract<CliArguments, { action: HistoryInlineCommand }>;

async function runMcpCommand(
  args: Extract<HistoryCommandArguments, { action: 'mcp' }>, dependencies: HistoryCommandDependencies, context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Local evidence MCP');
  const { serveReadOnlyMcp } = await import('./mcp-server.mts');
  const inputs: string[] = [];
  let total = 0;
  for (const source of args.sources) {
    if (total >= MAX_MCP_TOTAL_BYTES) throw new CliUsageError('Selected evidence exceeds the combined MCP byte limit.');
    const input = dependencies.readDiffInput ? await dependencies.readDiffInput(source)
      : await context.readInput(source, Math.min(MAX_SAVED_LOOKUP_INPUT_BYTES, MAX_MCP_TOTAL_BYTES - total), 'Selected MCP evidence');
    total += Buffer.byteLength(input, 'utf8');
    if (total > MAX_MCP_TOTAL_BYTES) throw new CliUsageError('Selected evidence exceeds the combined MCP byte limit.');
    inputs.push(input);
  }
  context.writeStderr('Read-only local evidence session. Selected results may be sent to the connected client’s model provider. No live collection or writes are available.\n');
  await serveReadOnlyMcp({ inputs, input: dependencies.stdin || process.stdin, output: context.stdout,
    version: context.packageVersion, now: context.now, diagnostic: context.writeStderr,
    ...(dependencies.signal ? { signal: dependencies.signal } : {}) });
  return EXIT_CODES.SUCCESS;
}

function offlineBrowserOptions(
  sources: readonly (string | null)[], dependencies: HistoryCommandDependencies, context: CliCommandContext, color: boolean,
): LookupBrowserOptions {
  if (sources.some((source) => !source || source === '-')) {
    throw new CliUsageError('--browse requires named files because interactive stdin is reserved for navigation.');
  }
  const input = dependencies.stdin || process.stdin;
  const environment = dependencies.environment || process.env;
  if (!canBrowseLookup(input, context.stdout, environment)) {
    throw new CliUsageError('--browse requires interactive terminal input and output. Omit it when redirecting.');
  }
  return { input, output: context.stdout, environment, color, palette: context.presentation(color).palette,
    ...(dependencies.signal ? { signal: dependencies.signal } : {}) };
}

async function runViewCommand(
  args: Extract<HistoryCommandArguments, { action: 'view' }>, dependencies: HistoryCommandDependencies, context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Saved Lookup');
  const browser = args.browse ? offlineBrowserOptions([args.source], dependencies, context, args.color) : null;
  const input = dependencies.readDiffInput
    ? await dependencies.readDiffInput(args.source || '-')
    : await context.readInput(args.source, MAX_SAVED_LOOKUP_INPUT_BYTES, 'Saved Lookup');
  if (isLookupEvidenceText(input)) {
    context.setFailureLabel('Lookup evidence export');
    if (browser) throw new CliUsageError('--browse opens saved Lookups. Omit it to read an evidence export.');
    const { buildCliLookupEvidenceView, formatCliLookupEvidenceView } = await import('./lookup-evidence-replay.mts');
    const evidence = await buildCliLookupEvidenceView(input, context.now());
    if (!args.quiet) context.writeStdout(args.output === 'json'
      ? formatJsonDocument(evidence) : context.terminal(formatCliLookupEvidenceView(evidence), args.color));
    return EXIT_CODES.SUCCESS;
  }
  const document = parseCliLookupDocument(input);
  if (browser) await browseLookupDocument(document, browser);
  else if (!args.quiet) context.writeStdout(args.output === 'json'
    ? formatJsonDocument(document) : context.terminal(formatTerminalLookup(document, { detail: 'verbose' }), args.color));
  return EXIT_CODES.SUCCESS;
}

// Routes view and diff inputs before full validation; malformed JSON falls
// through to the saved-Lookup or retained-artefact parser, which reports it precisely.
function isLookupEvidenceText(raw: string): boolean {
  try {
    const value: unknown = JSON.parse(raw);
    return Boolean(value && typeof value === 'object' && !Array.isArray(value)
      && (value as Record<string, unknown>).schema === LOOKUP_EVIDENCE_SCHEMA);
  } catch {
    return false;
  }
}

async function runRetainedDiffCommand(
  args: Extract<HistoryCommandArguments, { action: 'diff' }>,
  dependencies: HistoryCommandDependencies,
  context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Retained artefact diff');
  const browser = args.browse ? offlineBrowserOptions([args.leftSource, args.rightSource], dependencies, context, args.color) : null;
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
  const leftEvidence = isLookupEvidenceText(leftInput), rightEvidence = isLookupEvidenceText(rightInput);
  if (leftEvidence || rightEvidence) {
    if (!leftEvidence || !rightEvidence) {
      throw new CliUsageError('diff compares two evidence exports or two saved Lookups. Run whoisleuth export on the saved Lookup first.');
    }
    if (args.leftSessionId || args.rightSessionId) throw new CliUsageError('Saved-session selectors apply only to Bulk session exports.');
    if (browser) throw new CliUsageError('--browse currently supports two saved Lookup files. Omit it for other retained artefacts.');
    const { buildCliLookupEvidenceDiff, formatCliLookupEvidenceDiff } = await import('./lookup-evidence-diff.mts');
    const evidenceDiff = await buildCliLookupEvidenceDiff(leftInput, rightInput, context.now());
    if (!args.quiet) {
      context.writeStdout(args.output === 'json'
        ? formatJsonDocument(evidenceDiff)
        : context.terminal(formatCliLookupEvidenceDiff(evidenceDiff), args.color));
    }
    return EXIT_CODES.SUCCESS;
  }
  const document = buildCliRetainedArtifactDiff(
    leftInput,
    rightInput,
    { leftSessionId: args.leftSessionId, rightSessionId: args.rightSessionId },
    context.now(),
  );
  if (browser) {
    if (document.schema !== CLI_LOOKUP_DIFF_SCHEMA) throw new CliUsageError('--browse currently supports two saved Lookup files. Omit it for other retained artefacts.');
    await browseLookupComparison(document, browser);
  } else if (!args.quiet) {
    context.writeStdout(args.output === 'json'
      ? formatJsonDocument(document)
      : context.terminal(formatCliRetainedArtifactDiff(document), args.color));
  }
  return EXIT_CODES.SUCCESS;
}

async function runReconciliationCommand(
  args: Extract<HistoryCommandArguments, { action: 'reconcile' }>,
  dependencies: HistoryCommandDependencies,
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
  dependencies: HistoryCommandDependencies,
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
  dependencies: HistoryCommandDependencies,
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

async function runPriorRegistrationCommand(
  args: Extract<HistoryCommandArguments, { action: 'prior-registration' }>,
  _dependencies: HistoryCommandDependencies,
  context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Prior registration review');
  const { buildCliPriorRegistration, formatCliPriorRegistration, MAX_PRIOR_REGISTRATION_SUPPORTING_BYTES } = await import('./prior-registration.mts');
  if (!args.certificateResults && !args.archiveHistory) throw new CliUsageError('prior-registration needs --ct-results, --archive-history or both.');
  const supporting = (path: string | null, label: string) => path
    ? context.readInput(path, MAX_PRIOR_REGISTRATION_SUPPORTING_BYTES, label) : Promise.resolve(null);
  const [registration, certificateResults, archiveHistory] = await Promise.all([
    context.readInput(args.source, MAX_SAVED_LOOKUP_INPUT_BYTES, 'Saved Lookup'),
    supporting(args.certificateResults, 'Certificate search result'),
    supporting(args.archiveHistory, 'Web archive history'),
  ]);
  const document = await buildCliPriorRegistration({ registration, certificateResults, archiveHistory }, context.now());
  if (!args.quiet) context.writeStdout(args.output === 'json'
    ? formatJsonDocument(document) : context.terminal(formatCliPriorRegistration(document), args.color));
  return EXIT_CODES.SUCCESS;
}

const HISTORY_COMMAND_HANDLERS = Object.freeze({
  'mcp': runMcpCommand,
  'view': runViewCommand,
  'diff': runRetainedDiffCommand,
  'reconcile': runReconciliationCommand,
  'timeline': runTimelineCommand,
  'prior-registration': runPriorRegistrationCommand,
  'export': runExportCommand,
} satisfies DiscriminatedCommandHandlerMap<
  HistoryCommandArguments,
  [HistoryCommandDependencies, CliCommandContext],
  number
>);

function runHistoryCommand(
  args: HistoryCommandArguments,
  dependencies: HistoryCommandDependencies,
  context: CliCommandContext,
): Promise<number> {
  return runDiscriminatedCommandHandler(HISTORY_COMMAND_HANDLERS, args, dependencies, context);
}

export { HISTORY_COMMAND_HANDLERS, runHistoryCommand };
