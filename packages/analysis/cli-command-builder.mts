import { MAX_CLI_ARGUMENTS, MAX_CLI_ARGUMENT_LENGTH, hasUnsafeCliText, type CliCommandGrammar } from '../contracts/cli-grammar.mts';
import { parseCliGrammar } from './cli-argument-grammar.mts';

export type CommandShell = 'posix' | 'powershell';

/** Literal arguments only. Never interpolate into a command or evaluate a shell. */
export function quoteCommandArgument(value: string, shell: CommandShell): string {
  if (!value || value.length > MAX_CLI_ARGUMENT_LENGTH || hasUnsafeCliText(value)) throw new Error('Each argument must contain bounded, visible text without line breaks.');
  return `'${shell === 'powershell' ? value.replaceAll("'", "''") : value.replaceAll("'", "'\"'\"'")}'`;
}

export function buildCliCommand(command: string, grammar: CliCommandGrammar, input: Readonly<{
  positionals: readonly string[];
  options: Readonly<Record<string, readonly string[]>>;
  shell: CommandShell;
}>) {
  if (command !== grammar.parserKey || !/^[a-z][a-z0-9-]*$/u.test(command)) throw new Error('Unknown command grammar.');
  const args: string[] = [];
  for (const [option, values] of Object.entries(input.options)) {
    const definition = grammar.options.find(candidate => candidate.option === option);
    if (!definition || definition.metaAction || ['--config', '--profile'].includes(option)) throw new Error('This option is not supported by the command builder.');
    if (!Array.isArray(values) || values.length > MAX_CLI_ARGUMENTS) throw new Error('Too many option values.');
    for (const value of values) {
      if (definition.arity === 0 && value !== '') throw new Error('Flags do not accept a value.');
      args.push(option, ...(definition.arity ? [value] : []));
    }
  }
  if (input.positionals.some(value => value.startsWith('-'))) args.push('--');
  args.push(...input.positionals);
  if (args.length + 1 > MAX_CLI_ARGUMENTS) throw new Error('The command exceeds its argument limit.');
  for (const argument of args) quoteCommandArgument(argument, input.shell);
  const parsed = parseCliGrammar(command, grammar, args);
  const prefix = input.shell === 'powershell' ? '& whoisleuth' : 'whoisleuth';
  return { command: `${prefix} ${[command, ...args].map(value => quoteCommandArgument(value, input.shell)).join(' ')}`, args, parsed };
}
