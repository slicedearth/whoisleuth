import { CliUsageError } from './errors.mts';
import { commandDefinition, type CliCommand } from './command-reference.mts';
import { CliGrammarError, parseCliGrammar, type ParsedCommandArguments as ParsedGrammarArguments } from '../packages/analysis/cli-argument-grammar.mts';

export type ParsedCommandArguments = ParsedGrammarArguments<CliCommand>;

export function parseCommandArguments(command: CliCommand, argv: readonly string[]): ParsedCommandArguments {
  try { return parseCliGrammar(command, commandDefinition(command).grammar, argv); }
  catch (cause) {
    if (cause instanceof CliGrammarError) throw new CliUsageError(cause.message);
    throw cause;
  }
}
