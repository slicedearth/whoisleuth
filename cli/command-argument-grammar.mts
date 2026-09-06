import { CliUsageError } from './errors.mts';
import {
  commandDefinition,
  type CliCommand,
  type CliGrammarConstraint,
  type CliOptionSpec,
} from './command-reference.mts';

type ParsedCommandArguments = Readonly<{
  command: CliCommand;
  allPositionals: readonly string[];
  hasOption(option: string): boolean;
  optionValue(option: string): string | null;
  optionValues(option: string): readonly string[];
  integerOption(option: string): number | null;
  positionalValue(name: string): string | null;
  positionalValues(name: string): readonly string[];
}>;

type MutableParse = {
  options: Map<string, string[]>;
  positionals: string[];
};

function humanList(values: readonly string[], conjunction = 'or'): string {
  if (values.length < 2) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} ${conjunction} ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, ${conjunction} ${values.at(-1)}`;
}

function valueError(specification: CliOptionSpec): CliUsageError {
  if (specification.valueKind === 'file') {
    return new CliUsageError(`${specification.option} requires one bounded file path.`);
  }
  if (specification.valueKind === 'integer') {
    const baseRange = specification.integerRanges[0];
    return new CliUsageError(baseRange
      ? `${specification.option} requires an integer from ${baseRange.minimum} to ${baseRange.maximum}.`
      : `${specification.option} requires one bounded integer.`);
  }
  if (specification.values.length > 0) {
    return new CliUsageError(`${specification.option} requires ${humanList(specification.values)}.`);
  }
  return new CliUsageError(`${specification.option} requires one bounded value.`);
}

function parseTokens(command: CliCommand, argv: readonly string[]): MutableParse {
  const specificationByOption = new Map(
    commandDefinition(command).grammar.options.map((specification) => [specification.option, specification]),
  );
  const options = new Map<string, string[]>();
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith('-')) {
      positionals.push(argument);
      continue;
    }
    const specification = specificationByOption.get(argument);
    if (!specification || specification.metaAction !== null) {
      throw new CliUsageError(`Unknown option "${argument}".`);
    }
    const existing = options.get(argument);
    if (existing && specification.occurrence === 'once') {
      throw new CliUsageError(`${argument} may be supplied only once.`);
    }
    if (existing && specification.occurrence === 'idempotent') continue;
    let value = '';
    if (specification.arity === 1) {
      const candidate = argv[++index];
      if (candidate === undefined || candidate === ''
        || (!specification.acceptsOptionLikeValue && candidate.startsWith('-'))) {
        throw valueError(specification);
      }
      value = candidate;
    }
    if (existing) existing.push(value);
    else options.set(argument, [value]);
  }
  return { options, positionals };
}

function selectedIntegerRange(
  specification: CliOptionSpec,
  options: ReadonlyMap<string, readonly string[]>,
) {
  return specification.integerRanges
    .filter((range) => range.whenOptionPresent === null || options.has(range.whenOptionPresent))
    .at(-1) ?? null;
}

function validateOptionValues(
  command: CliCommand,
  options: ReadonlyMap<string, readonly string[]>,
): void {
  for (const specification of commandDefinition(command).grammar.options) {
    const values = options.get(specification.option);
    if (!values || specification.arity === 0) continue;
    if (specification.valueKind === 'enum') {
      if (values.some((value) => !specification.values.includes(value))) throw valueError(specification);
      continue;
    }
    if (specification.valueKind === 'integer') {
      const range = selectedIntegerRange(specification, options);
      if (!range) throw new Error(`Integer option ${command} ${specification.option} has no applicable range.`);
      for (const value of values) {
        if (!/^\d+$/u.test(value)) throw valueError(specification);
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed < range.minimum || parsed > range.maximum) {
          throw new CliUsageError(`${specification.option} must be from ${range.minimum} to ${range.maximum}.`);
        }
      }
      continue;
    }
    if (specification.valueKind === 'policy_list') {
      for (const value of values) {
        const policies = [...new Set(value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean))];
        if (!policies.length || policies.some((policy) => !specification.values.includes(policy))) {
          throw new CliUsageError(`${specification.option} for ${command} supports: ${specification.values.join(', ')}.`);
        }
      }
    }
  }
}

function allocatePositionals(
  command: CliCommand,
  rawPositionals: readonly string[],
): Readonly<Record<string, readonly string[]>> {
  const specifications = commandDefinition(command).grammar.positionals;
  const maximum = specifications.reduce((sum, specification) => sum + specification.maximum, 0);
  if (rawPositionals.length > maximum) {
    throw new CliUsageError(`${command} accepts at most ${maximum} positional value${maximum === 1 ? '' : 's'}.`);
  }
  const allocated: Record<string, readonly string[]> = {};
  let offset = 0;
  for (const [specificationIndex, specification] of specifications.entries()) {
    const remainingMinimum = specifications.slice(specificationIndex + 1)
      .reduce((sum, later) => sum + later.minimum, 0);
    const available = Math.max(0, rawPositionals.length - offset - remainingMinimum);
    const count = Math.min(specification.maximum, available);
    const values = Object.freeze(rawPositionals.slice(offset, offset + count));
    offset += count;
    if (values.length < specification.minimum) {
      throw new CliUsageError(`${command} requires ${specification.minimum} ${specification.name} value${specification.minimum === 1 ? '' : 's'}.`);
    }
    if (specification.valueKind === 'enum'
      && values.some((value) => !specification.values.includes(value))) {
      throw new CliUsageError(`${command} ${specification.name} must be ${humanList(specification.values)}.`);
    }
    allocated[specification.name] = values;
  }
  return Object.freeze(allocated);
}

function present(options: ReadonlyMap<string, readonly string[]>, option: string): boolean {
  return options.has(option);
}

function validateConstraint(
  command: CliCommand,
  constraint: CliGrammarConstraint,
  options: ReadonlyMap<string, readonly string[]>,
): void {
  if (constraint.kind === 'required') {
    const missing = constraint.options.filter((option) => !present(options, option));
    if (missing.length > 0) throw new CliUsageError(`${command} requires ${missing.join(', ')}.`);
    return;
  }
  if (constraint.kind === 'mutually_exclusive') {
    const selected = constraint.options.filter((option) => present(options, option));
    if (selected.length > 1) {
      throw new CliUsageError(`${selected.join(' and ')} are mutually exclusive and may be supplied only once.`);
    }
    return;
  }
  if (constraint.kind === 'excludes_all') {
    if (!present(options, constraint.option)) return;
    const selected = constraint.excludedOptions.filter((option) => present(options, option));
    if (selected.length > 0) {
      throw new CliUsageError(`${constraint.option} cannot be combined with ${selected.join(', ')}.`);
    }
    return;
  }
  if (constraint.kind === 'value_excludes') {
    if (!options.get(constraint.option)?.includes(constraint.value)) return;
    const selected = constraint.excludedOptions.filter((option) => present(options, option));
    if (selected.length > 0) {
      throw new CliUsageError(`${constraint.option} ${constraint.value} cannot be combined with ${selected.join(', ')}.`);
    }
    return;
  }
  if (!present(options, constraint.option)) return;
  const selected = constraint.requiredOptions.filter((option) => present(options, option));
  if (constraint.kind === 'requires_all' && selected.length !== constraint.requiredOptions.length) {
    throw new CliUsageError(`${constraint.option} requires ${constraint.requiredOptions.join(' and ')}.`);
  }
  if (constraint.kind === 'requires_any' && selected.length === 0) {
    throw new CliUsageError(`${constraint.option} requires ${constraint.requiredOptions.join(' or ')}.`);
  }
}

function validatePositionalRequirements(
  command: CliCommand,
  allocated: Readonly<Record<string, readonly string[]>>,
  options: ReadonlyMap<string, readonly string[]>,
): void {
  for (const specification of commandDefinition(command).grammar.positionals) {
    if (specification.requiredWhenOptions.some((option) => options.has(option))
      && (allocated[specification.name]?.length ?? 0) === 0) {
      throw new CliUsageError(`${specification.requiredWhenOptions.join(' or ')} requires a positional ${specification.name}.`);
    }
  }
}

function freezeOptions(options: ReadonlyMap<string, readonly string[]>): ReadonlyMap<string, readonly string[]> {
  return new Map([...options].map(([option, values]) => [option, Object.freeze([...values])]));
}

export function parseCommandArguments(command: CliCommand, argv: readonly string[]): ParsedCommandArguments {
  const parsed = parseTokens(command, argv);
  const options = freezeOptions(parsed.options);
  validateOptionValues(command, options);
  const allocated = allocatePositionals(command, parsed.positionals);
  validatePositionalRequirements(command, allocated, options);
  for (const constraint of commandDefinition(command).grammar.constraints) {
    validateConstraint(command, constraint, options);
  }
  for (const option of ['--config', '--profile']) {
    const specification = commandDefinition(command).grammar.options.find((candidate) => candidate.option === option);
    if (specification?.scope === 'common' && options.has(option)) {
      throw new CliUsageError(`${option} must be resolved before command parsing.`);
    }
  }
  const allPositionals = Object.freeze([...parsed.positionals]);
  return Object.freeze({
    command,
    allPositionals,
    hasOption: (option: string) => options.has(option),
    optionValue: (option: string) => options.get(option)?.at(-1) ?? null,
    optionValues: (option: string) => options.get(option) ?? Object.freeze([]),
    integerOption: (option: string) => {
      const value = options.get(option)?.at(-1);
      return value === undefined ? null : Number(value);
    },
    positionalValue: (name: string) => allocated[name]?.[0] ?? null,
    positionalValues: (name: string) => allocated[name] ?? Object.freeze([]),
  });
}

export type { ParsedCommandArguments };
