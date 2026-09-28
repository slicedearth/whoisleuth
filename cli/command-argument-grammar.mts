import { CliUsageError } from './errors.mts';
import { commandDefinition, type CliCommand } from './command-reference.mts';
import type { COMMON_OPTIONS } from './command-definition.mts';
import type { COMMAND_SEEDS } from './command-seeds.mts';
import { CliGrammarError, parseCliGrammar, type ParsedCommandArguments as ParsedGrammarArguments } from '../packages/analysis/cli-argument-grammar.mts';

/** Command parsers read their declared options plus common output controls.
 * Shared helpers use the default union; runtime grammar still admits input. */
export type ParsedCommandArguments<Command extends CliCommand = CliCommand> = ParsedGrammarArguments<
  CliCommand,
  (typeof COMMAND_SEEDS)[Command]['options'][number] | (typeof COMMON_OPTIONS)[number]
>;

export function parseCommandArguments<Command extends CliCommand>(command: Command, argv: readonly string[]): ParsedCommandArguments<Command> {
  try { return parseCliGrammar(command, commandDefinition(command).grammar, argv); }
  catch (cause) {
    if (cause instanceof CliGrammarError) throw new CliUsageError(cause.message);
    throw cause;
  }
}
