import { parseCommandArguments, type ParsedCommandArguments } from './command-argument-grammar.mts';
import { CliUsageError, hasUnsafeCliText } from './errors.mts';
import { isDirectLookupTarget } from '../lib/classify.mts';
import { MAX_CLI_ARGUMENTS, MAX_CLI_ARGUMENT_LENGTH } from '../packages/contracts/cli-grammar.mts';
import { CLI_COMMANDS, cliMetaActionForInvocation, isCliCommand, type CliCommand, type CompletionShell } from './command-reference.mts';
import type { FileOutputOptions, CliPalette, LookupDetail } from './argument-values.mts';
import { commandHasOwner, type CliCommandFor } from './command-reference.mts';
import type { CliExecutionOwner } from './command-definition.mts';
import { SUPPORT_ARGUMENT_PARSERS } from './support-arguments.mts';
import { ASSURANCE_ARGUMENT_PARSERS } from './assurance-arguments.mts';
import { COLLECTION_ARGUMENT_PARSERS } from './collection-arguments.mts';
import { NETWORK_ARGUMENT_PARSERS } from './network-arguments.mts';
import { REVIEW_ARGUMENT_PARSERS } from './review-arguments.mts';
import { EVIDENCE_ARGUMENT_PARSERS } from './evidence-arguments.mts';
import { WORKFLOW_ARGUMENT_PARSERS } from './workflow-arguments.mts';
import { HISTORY_ARGUMENT_PARSERS } from './history-arguments.mts';

const CLI_PARSERS = Object.freeze({
  ...SUPPORT_ARGUMENT_PARSERS,
  ...ASSURANCE_ARGUMENT_PARSERS,
  ...COLLECTION_ARGUMENT_PARSERS,
  ...NETWORK_ARGUMENT_PARSERS,
  ...REVIEW_ARGUMENT_PARSERS,
  ...EVIDENCE_ARGUMENT_PARSERS,
  ...WORKFLOW_ARGUMENT_PARSERS,
  ...HISTORY_ARGUMENT_PARSERS,
} satisfies { [Command in CliCommand]: (parsed: ParsedCommandArguments) => { action: Command } });

type CliAction = ReturnType<typeof CLI_PARSERS[CliCommand]> | { action: 'help'; command?: CliCommand } | { action: 'version' };
type CliArguments = CliAction & FileOutputOptions;
type InspectArchiveArguments = Extract<CliAction, { action: 'inspect-archive' }>;
type SignArtifactArguments = Extract<CliAction, { action: 'sign-artifact' }>;
type VerifySignatureArguments = Extract<CliAction, { action: 'verify-signature' }>;

export function isCliCommandForOwner<Owner extends CliExecutionOwner>(
  args: CliArguments, owner: Owner,
): args is Extract<CliArguments, { action: CliCommandFor<Owner> }> {
  return commandHasOwner(args.action, owner);
}

function boundedArgument(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_CLI_ARGUMENT_LENGTH || hasUnsafeCliText(value)) {
    throw new CliUsageError('Arguments must be bounded text without control characters.');
  }
  return value;
}

function parseCliArguments(rawArgv: unknown): CliArguments {
  if (!Array.isArray(rawArgv) || rawArgv.length > MAX_CLI_ARGUMENTS) {
    throw new CliUsageError(`At most ${MAX_CLI_ARGUMENTS} command arguments are supported.`);
  }
  return parseCliArgumentsCore(rawArgv.map(boundedArgument));
}

function parseCliArgumentsCore(argv: string[]): CliArguments {
  if (!argv.length) return { action: 'help' };
  const firstArgument = argv[0] ?? '';
  const metaAction = cliMetaActionForInvocation(argv);
  if (metaAction?.id === 'help') {
    if (argv.length === 1) return { action: 'help' };
    if (argv.length === 2 && (isCliCommand(firstArgument) || isDirectLookupTarget(firstArgument))) {
      return { action: 'help', command: isCliCommand(firstArgument) ? firstArgument : 'lookup' };
    }
    throw new CliUsageError('Help accepts only an optional command name.');
  }
  if (metaAction?.id === 'version') {
    if (argv.length !== 1) throw new CliUsageError('--version does not accept other arguments.');
    return { action: 'version' };
  }

  let command: CliCommand;
  let directLookup = false;
  if (isCliCommand(firstArgument)) command = firstArgument;
  else if (isDirectLookupTarget(firstArgument)) {
    command = 'lookup';
    directLookup = true;
  } else {
    const displayedCommand = firstArgument.length > 80 ? `${firstArgument.slice(0, 79)}…` : firstArgument;
    throw new CliUsageError(`Unknown command "${displayedCommand}". Run "whoisleuth commands" to list supported commands.`);
  }
  const parsedGrammar = parseCommandArguments(command, directLookup ? argv : argv.slice(1));
  const parsed = CLI_PARSERS[command](parsedGrammar);
  if (parsed.action !== command) throw new Error(`CLI parser contract mismatch for ${command}.`);
  const destination = parsedGrammar.optionValue('--output');
  const palette = parsedGrammar.optionValue('--palette') as CliPalette | null;
  return {
    ...parsed,
    ...(destination !== null ? { destination } : {}),
    ...(parsedGrammar.hasOption('--force') ? { force: true as const } : {}),
    ...(palette !== null ? { palette } : {}),
  };
}

export { CLI_COMMANDS, CLI_PARSERS, CliUsageError, MAX_CLI_ARGUMENTS, MAX_CLI_ARGUMENT_LENGTH, parseCliArguments };
export type {
  CliArguments,
  CliCommand,
  CliPalette,
  CompletionShell,
  InspectArchiveArguments,
  LookupDetail,
  SignArtifactArguments,
  VerifySignatureArguments,
};
