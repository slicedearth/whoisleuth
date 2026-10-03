import { type ParsedCommandArguments } from './command-argument-grammar.mts';
import { CliUsageError } from './errors.mts';
import {
  parseCliFailPolicies,
  type CliFailPolicy,
  type CliFailPolicyCommand,
} from './fail-policy.mts';
import { PRESENTATION_OPTIONS, type CliCommandSeed, type CliOption } from './command-definition.mts';

type TerminalOptions = { quiet: boolean; color: boolean };
type LookupDetail = 'summary' | 'standard' | 'verbose';
type CliPalette = 'auto' | 'light' | 'dark';
type FileOutputOptions = { destination?: string; force?: true; palette?: CliPalette };

function terminalOptions(parsed: ParsedCommandArguments): TerminalOptions {
  return { quiet: parsed.hasOption('--quiet'), color: !parsed.hasOption('--no-color') };
}

function jsonOutput(parsed: ParsedCommandArguments): 'terminal' | 'json' {
  return parsed.hasOption('--json') ? 'json' : 'terminal';
}

function normalizedLabel(
  parsed: ParsedCommandArguments,
  option: CliOption,
  maximum: number,
): string | null {
  const value = parsed.optionValue(option);
  if (value === null) return null;
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (!normalized || normalized.length > maximum) {
    throw new CliUsageError(`${option} requires a label of at most ${maximum} characters.`);
  }
  return normalized;
}

function failPolicies(
  parsed: ParsedCommandArguments,
  command: CliFailPolicyCommand,
): readonly CliFailPolicy[] | null {
  const value = parsed.optionValue('--fail-on');
  return value === null ? null : parseCliFailPolicies(value, command);
}

type CommandOutput<Definition extends Pick<CliCommandSeed, 'options'>> =
  | 'terminal'
  | Extract<
      (typeof PRESENTATION_OPTIONS)[number],
      readonly [Definition['options'][number], string, string]
    >[2];

function parseOutput<Definition extends Pick<CliCommandSeed, 'options'>>(
  parsed: ParsedCommandArguments,
  definition: Definition,
): CommandOutput<Definition> {
  // Membership proves the returned literal belongs to this command's declared
  // options. Grammar validation independently rejects conflicting selections.
  return (PRESENTATION_OPTIONS.find(
    ([option]) => definition.options.includes(option) && parsed.hasOption(option),
  )?.[2] ?? 'terminal') as CommandOutput<Definition>;
}

function parseTwoFileComparisonArguments(
  parsed: ParsedCommandArguments,
  command: 'page-compare' | 'diff',
) {
  const sources = parsed.positionalValues('sources');
  if (sources[0] === sources[1])
    throw new CliUsageError(`${command} requires two different input files.`);
  return {
    leftSource: sources[0]!,
    rightSource: sources[1]!,
    output: jsonOutput(parsed),
    ...terminalOptions(parsed),
  };
}

function uniqueSources(
  parsed: ParsedCommandArguments,
  command: 'reconcile' | 'timeline',
): readonly string[] {
  const sources = parsed.positionalValues('sources');
  if (new Set(sources).size !== sources.length)
    throw new CliUsageError(`${command} input files must be different.`);
  return sources;
}

function singleInputAction<Action extends string, Key extends string = 'source'>(
  action: Action,
  parsed: ParsedCommandArguments,
  positionalName: Key = 'source' as Key,
): { action: Action; output: 'terminal' | 'json' } & TerminalOptions &
  Record<NoInfer<Key>, string | null> {
  return {
    action,
    [positionalName]: parsed.positionalValue(positionalName),
    output: jsonOutput(parsed),
    ...terminalOptions(parsed),
  } as { action: Action; output: 'terminal' | 'json' } & TerminalOptions &
    Record<Key, string | null>;
}

export {
  terminalOptions,
  jsonOutput,
  normalizedLabel,
  failPolicies,
  parseOutput,
  parseTwoFileComparisonArguments,
  uniqueSources,
  singleInputAction,
};
export type { TerminalOptions, LookupDetail, CliPalette, FileOutputOptions };
