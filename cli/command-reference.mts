import { INVESTIGATION_PLAN_RECIPES, RUNNABLE_INVESTIGATION_PLAN_RECIPES } from './investigation-recipes.mts';
import type { CliOptionValueKind, CliOptionOccurrence, CliOptionScope, CliPositionalValueKind, CliPositionalInputSource, CliMetaActionId, CliMetaAction, CliOptionIntegerRange, CliOptionSpec, CliPositionalSpec, CliGrammarConstraint } from '../packages/contracts/cli-grammar.mts';
import { CLI_COMMAND_SEMANTICS, CLI_HELP_GROUP_ORDER, type CliCommand, type CliHelpGroup } from '../packages/contracts/cli-command-semantics.mts';
import { type CompletionShell, type CommandDetail, type CommandCollection, type CliNetworkEffect, type CliInvocationNetworkEffect, type CliDisclosureClass, type CliHandlerOwner, INLINE_COMMAND_FAMILIES, type InlineCommandFamily, type CliCommandDefinition, CLI_CASE_OPERATIONS, CLI_INDICATOR_OPERATIONS, CLI_META_ACTIONS, CLI_META_ACTION_BY_ID, HELP_INTRO, HELP_FOOTER, commonOptionsForSeed, CLI_OPTION_DEFINITIONS, type CliOption, type CliOptionDefinition, PRESENTATION_OPTIONS, optionSpec, grammarConstraints, type CliCommandSeed } from './command-definition.mts';
import { COMMAND_SEEDS } from './command-seeds.mts';

const COMMAND_ORDER = Object.freeze(Object.keys(CLI_COMMAND_SEMANTICS)) as readonly CliCommand[];

function commandOptionDefinition(command: CliCommand, option: CliOption): CliOptionDefinition {
  return COMMAND_SEEDS[command].optionOverrides?.[option] ?? CLI_OPTION_DEFINITIONS[option];
}

export type CliCommandFor<Owner extends import('./command-definition.mts').CliExecutionOwner> = {
  [Command in CliCommand]: typeof COMMAND_SEEDS[Command]['handlerOwner'] extends Owner ? Command : never
}[CliCommand];

type InlineCommandFor<Family extends InlineCommandFamily> = CliCommandFor<Family>;

export function commandHasOwner<Owner extends import('./command-definition.mts').CliExecutionOwner>(command: unknown, owner: Owner): command is CliCommandFor<Owner> {
  return isCliCommand(command) && COMMAND_SEEDS[command].handlerOwner === owner;
}

function inlineCommandFamily(command: CliCommand): InlineCommandFamily | null {
  const owner = COMMAND_SEEDS[command].handlerOwner;
  return INLINE_COMMAND_FAMILIES.find(family => family === owner) ?? null;
}

function inlineCommandsFor<Family extends InlineCommandFamily>(family: Family): readonly InlineCommandFor<Family>[] {
  return Object.freeze(COMMAND_ORDER.filter((command): command is InlineCommandFor<Family> =>
    COMMAND_SEEDS[command].handlerOwner === family));
}
const HELP_COMMANDS_BY_GROUP = Object.freeze(Object.fromEntries(
  CLI_HELP_GROUP_ORDER.map((group) => [
    group,
    Object.freeze(COMMAND_ORDER.filter((command) => CLI_COMMAND_SEMANTICS[command].group === group)),
  ]),
)) as Readonly<Record<CliHelpGroup, readonly CliCommand[]>>;


function documentationMetadata(
  seed: CliCommandSeed,
  commonOptions: readonly string[],
  commandOptions: readonly string[],
  positionals: readonly CliPositionalSpec[],
): CliCommandDefinition['documentation'] {
  const explicitAuthorisationRequired = commandOptions.some((option) => (
    option === '--owned-or-authorized' || option === '--active-probe' || option === '--approve-network'
  ));
  const presentationOptions = Object.freeze(PRESENTATION_OPTIONS
    .filter(([option]) => commandOptions.includes(option))
    .map(([option, format]) => Object.freeze({ option, format })));
  const outputFormats = new Set<string>(['terminal']);
  for (const { format } of presentationOptions) outputFormats.add(format);
  for (const format of seed.additionalOutputFormats) outputFormats.add(format);
  const positionalLimits = positionals.map((item) => (
    `${item.name}: ${item.minimum}-${item.maximum} ${item.valueKind} value${item.maximum === 1 ? '' : 's'}`
  ));
  return Object.freeze({
    common: seed.common,
    disclosureClass: seed.networkEffect === 'offline'
      ? 'none'
      : explicitAuthorisationRequired
        ? 'bounded_authorised_active'
        : seed.networkEffect === 'conditional_network'
          ? 'conditional_bounded_passive'
          : 'bounded_passive',
    explicitAuthorisationRequired,
    planSupport: seed.planSupport,
    failurePolicySupport: commandOptions.includes('--fail-on') || commandOptions.includes('--strict-exit'),
    supportedSchemaIdentifiers: seed.schemaIdentifiers,
    inputLimits: Object.freeze([seed.collection.scope, ...positionalLimits]),
    outputLimits: Object.freeze([
      'Output is bounded by the command-owned formatter and document contract.',
      ...(commonOptions.includes('--output')
        ? ['Selected file output is atomic and replacement requires --force.']
        : []),
    ]),
    outputFormats: Object.freeze([...outputFormats]),
    presentationOptions,
    fileOutput: commonOptions.includes('--output'),
    primaryEvidenceArtefacts: seed.primaryArtefacts,
  });
}

function expandedOptionValues(specification: CliOptionSpec): boolean {
  return specification.valueKind === 'enum' && specification.values.join('|').length > 60;
}

function optionUsage(specification: CliOptionSpec): string {
  if (specification.arity === 0) return specification.option;
  if (specification.valueKind === 'enum') {
    return `${specification.option} <${expandedOptionValues(specification) ? specification.option.slice(2) : specification.values.join('|')}>`;
  }
  if (specification.valueKind === 'policy_list') return `${specification.option} <policy[,policy...]>`;
  if (specification.valueKind === 'integer') return `${specification.option} <integer>`;
  if (specification.valueKind === 'file') return `${specification.option} <file>`;
  return `${specification.option} <value>`;
}

function positionalUsage(specification: CliPositionalSpec): string {
  const value = specification.valueKind === 'enum'
    ? `<${specification.values.join('|')}>`
    : `<${specification.name}${specification.maximum > 1 ? '...' : ''}>`;
  return specification.minimum === 0 ? `[${value}]` : value;
}

function generatedCommandUsage(
  command: CliCommand,
  options: readonly CliOptionSpec[],
  positionals: readonly CliPositionalSpec[],
  constraints: readonly CliGrammarConstraint[],
): string {
  const commandOptions = options.filter((option) => option.scope === 'command');
  const required = new Set(constraints
    .filter((item): item is Extract<CliGrammarConstraint, { kind: 'required' }> => item.kind === 'required')
    .flatMap((item) => item.options));
  const mutuallyExclusive = constraints
    .filter((item): item is Extract<CliGrammarConstraint, { kind: 'mutually_exclusive' }> => item.kind === 'mutually_exclusive')
    .map((item) => item.options.filter((option) => commandOptions.some((candidate) => candidate.option === option)))
    .filter((group) => group.length > 1);
  const grouped = new Set(mutuallyExclusive.flat());
  const renderedGroups = mutuallyExclusive.map((group) => `[${group.map((option) => (
    optionUsage(commandOptions.find((candidate) => candidate.option === option)!)
  )).join('|')}]`);
  const renderedOptions = commandOptions
    .filter((option) => !grouped.has(option.option))
    .map((option) => {
      const rendered = optionUsage(option);
      return required.has(option.option) ? rendered : `[${rendered}]`;
    });
  return ['whoisleuth', command, ...positionals.map(positionalUsage), ...renderedGroups, ...renderedOptions].join(' ');
}

const CLI_COMMAND_REGISTRY: readonly CliCommandDefinition[] = Object.freeze(
  COMMAND_ORDER.map((command, order) => {
    const seed = COMMAND_SEEDS[command];
    const commonOptions = Object.freeze([...commonOptionsForSeed(seed)]);
    const commandOptions = seed.options;
    const grammarOptions = Object.freeze([
      ...commonOptions.map((option) => optionSpec(command, option, 'common', commandOptionDefinition(command, option))),
      ...commandOptions.map((option) => optionSpec(command, option, 'command', commandOptionDefinition(command, option))),
    ]);
    const constraints = grammarConstraints(commandOptions, seed.constraints);
    return Object.freeze({
      command,
      order,
      reference: Object.freeze({
        ...seed.reference,
        usage: generatedCommandUsage(command, grammarOptions, seed.positionals, constraints),
      }),
      collection: seed.collection,
      completion: Object.freeze({
        description: seed.summary,
        commonOptions,
        options: commandOptions,
      }),
      grammar: Object.freeze({
        parserKey: command,
        bootstrapProfile: seed.bootstrapProfile,
        options: grammarOptions,
        positionals: seed.positionals,
        constraints,
        metaActions: Object.freeze(['help'] as const),
      }),
      execution: Object.freeze({
        handlerOwner: inlineCommandFamily(command) ? 'inline' : seed.handlerOwner as CliHandlerOwner,
        networkEffect: seed.networkEffect,
      }),
      help: Object.freeze({
        group: CLI_COMMAND_SEMANTICS[command].group,
        summary: seed.summary,
      }),
      documentation: documentationMetadata(seed, commonOptions, commandOptions, seed.positionals),
    });
  }),
);

const CLI_COMMANDS: readonly CliCommand[] = Object.freeze(
  CLI_COMMAND_REGISTRY.map((definition) => definition.command),
);
const FILE_POSITIONAL_COMMANDS: readonly CliCommand[] = Object.freeze(
  CLI_COMMAND_REGISTRY
    .filter((definition) => definition.grammar.positionals.some((item) => item.valueKind === 'file'))
    .map((definition) => definition.command),
);
const CLI_COMMAND_BY_NAME = Object.freeze(Object.fromEntries(
  CLI_COMMAND_REGISTRY.map((definition) => [definition.command, definition]),
)) as Readonly<Record<CliCommand, CliCommandDefinition>>;
function isCliCommand(value: unknown): value is CliCommand {
  return typeof value === 'string' && Object.hasOwn(CLI_COMMAND_BY_NAME, value);
}

function commandDefinition(command: CliCommand): CliCommandDefinition {
  return CLI_COMMAND_BY_NAME[command];
}

function metaActionDefinition(id: CliMetaActionId): CliMetaAction {
  return CLI_META_ACTION_BY_ID[id];
}

function cliInvocationOptionIndices(argv: readonly string[]): ReadonlySet<number> {
  const namedCommand = isCliCommand(argv[0]) ? argv[0] : null;
  const options = new Map(commandDefinition(namedCommand ?? 'lookup').grammar.options
    .map((option) => [option.option, option]));
  const indices = new Set<number>();
  for (let index = namedCommand ? 1 : 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--') break;
    if (!argument.startsWith('-')) continue;
    indices.add(index);
    const option = options.get(argument);
    const value = argv[index + 1];
    if (option?.arity === 1 && value !== undefined) {
      if (value === '--' && !option.acceptsOptionLikeValue) break;
      index += 1;
    }
  }
  return indices;
}

function cliMetaActionForInvocation(argv: readonly string[]): CliMetaAction | null {
  const optionIndices = cliInvocationOptionIndices(argv);
  for (const action of CLI_META_ACTIONS) {
    const matches = action.scope === 'root_only'
      ? action.aliases.includes(argv[0] ?? '')
      : argv.some((argument, index) => optionIndices.has(index) && action.aliases.includes(argument));
    if (matches) return action;
  }
  return null;
}

const COMMAND_USAGE = Object.freeze(Object.fromEntries(
  CLI_COMMAND_REGISTRY.map((definition) => [definition.command, definition.reference.usage]),
)) as Readonly<Record<CliCommand, string>>;
const COMMAND_DETAILS = Object.freeze(Object.fromEntries(
  CLI_COMMAND_REGISTRY.map((definition) => [definition.command, Object.freeze({
    description: definition.reference.description,
    example: definition.reference.example,
    boundary: definition.reference.boundary,
  })]),
)) as Readonly<Record<CliCommand, CommandDetail>>;
const COMMAND_COLLECTION = Object.freeze(Object.fromEntries(
  CLI_COMMAND_REGISTRY.map((definition) => [definition.command, definition.collection]),
)) as Readonly<Record<CliCommand, CommandCollection>>;
const COMMAND_DESCRIPTIONS = Object.freeze(Object.fromEntries(
  CLI_COMMAND_REGISTRY.map((definition) => [definition.command, definition.completion.description]),
)) as Readonly<Record<CliCommand, string>>;
const OPTIONS_BY_COMMAND = Object.freeze(Object.fromEntries(
  CLI_COMMAND_REGISTRY.map((definition) => [definition.command, Object.freeze(
    definition.grammar.options
      .filter((option) => option.scope === 'command')
      .map((option) => option.option),
  )]),
)) as Readonly<Record<CliCommand, readonly string[]>>;

function commonOptionsForCommand(command: CliCommand): readonly string[] {
  return Object.freeze(commandDefinition(command).grammar.options
    .filter((option) => option.scope === 'common')
    .map((option) => option.option));
}

function commandOptionSpec(command: CliCommand, option: string): CliOptionSpec | null {
  return commandDefinition(command).grammar.options.find((candidate) => candidate.option === option) ?? null;
}

function commandPositionalSpecs(command: CliCommand): readonly CliPositionalSpec[] {
  return commandDefinition(command).grammar.positionals;
}

const HELP_GROUP_LABELS: Readonly<Record<CliHelpGroup, string>> = Object.freeze({
  investigate: 'Investigate',
  respond: 'Respond',
  assure: 'Assure',
  utilities: 'Utilities',
});

function renderRootHelpCommands(): string {
  return (Object.keys(HELP_COMMANDS_BY_GROUP) as CliHelpGroup[]).map((group) => {
    const lines = HELP_COMMANDS_BY_GROUP[group].map((command) => {
      const definition = commandDefinition(command);
      return `  ${command.padEnd(20, ' ')} ${definition.help.summary}.`;
    });
    return `${HELP_GROUP_LABELS[group]}:\n${lines.join('\n')}`;
  }).join('\n\n');
}

const HELP = `${HELP_INTRO}\n${renderRootHelpCommands()}\n${HELP_FOOTER}`;

function commandOwnsOption(command: CliCommand, option: string): boolean {
  return commandDefinition(command).grammar.options.some((candidate) => candidate.option === option);
}

function invocationHasFlag(command: CliCommand, args: readonly string[], flag: string): boolean {
  const argv = [command, ...args];
  return [...cliInvocationOptionIndices(argv)].some((index) => argv[index] === flag);
}

function cliInvocationNetworkEffect(
  command: CliCommand,
  args: readonly string[],
): CliInvocationNetworkEffect {
  const effect = commandDefinition(command).execution.networkEffect;
  if (effect === 'offline') return 'offline';
  if (effect === 'always_network') return 'network';
  if (command === 'doctor') return invocationHasFlag(command, args, '--network') ? 'network' : 'offline';
  if (command === 'lookup' || command === 'bulk' || command === 'discover-scan') {
    return invocationHasFlag(command, args, '--plan') ? 'offline' : 'network';
  }
  if (command === 'workflow-run') {
    return invocationHasFlag(command, args, '--approve-network') ? 'network' : 'offline';
  }
  throw new Error(`Conditional network effect is not implemented for ${command}.`);
}

function commandHelp(command: CliCommand): string {
  const detail = COMMAND_DETAILS[command];
  const collection = COMMAND_COLLECTION[command];
  const values = commandDefinition(command).grammar.options.filter(expandedOptionValues)
    .map(option => `\n${option.option} values:\n${option.values.map(value => `  ${value}`).join('\n')}\n`).join('');
  const options = commandOptionHelp(command).map(option => {
    const range = option.ranges.map(item => `${item.whenOptionPresent ? `With ${item.whenOptionPresent}: ` : 'Range: '}${item.minimum}–${item.maximum}.`).join(' ');
    const policies = option.option === '--fail-on' ? ` Values: ${option.values.join(', ')}.` : '';
    return `  ${option.usage}\n    ${option.description}${option.defaultDescription ? ` Default: ${option.defaultDescription}.` : ''}${option.repeatable ? ' May be repeated.' : ''}${range ? ` ${range}` : ''}${policies}`;
  }).join('\n');
  return `WHOISleuth ${command}\n${detail.description}\n\nExample:\n  ${detail.example}\n\nUsage:\n  ${COMMAND_USAGE[command]}\n\nOptions:\n${options}\n\nCollection:\n  ${collection.mode === 'offline' ? 'Offline' : 'Network'}: ${collection.scope}\n\nBoundary:\n  ${detail.boundary}\n${values}\nRun "whoisleuth --help" to see the grouped command list.\n`;
}

export function commandDefaultNumber(command: CliCommand, option: CliOption, deep = false): number {
  const value = commandOptionDefinition(command, option).defaultValue(command, deep);
  if (!commandOwnsOption(command, option) || typeof value !== 'number') throw new TypeError(`No numeric default for ${command} ${option}.`);
  return value;
}

export function commandDefaultText(command: CliCommand, option: CliOption): string {
  const value = commandOptionDefinition(command, option).defaultValue(command, false);
  if (!commandOwnsOption(command, option) || typeof value !== 'string') throw new TypeError(`No text default for ${command} ${option}.`);
  return value;
}

// Help is a mechanical projection, not another parser or public grammar format.
export function commandOptionHelp(command: CliCommand) {
  return commandDefinition(command).grammar.options.map(specification => {
    const owner = commandOptionDefinition(command, specification.option as CliOption);
    const ordinary = owner.defaultValue(command, false);
    const deep = owner.defaultValue(command, true);
    return Object.freeze({
      option: specification.option,
      scope: specification.scope,
      usage: optionUsage(specification),
      description: owner.description(command),
      values: specification.values,
      repeatable: specification.occurrence === 'repeatable',
      ranges: specification.integerRanges,
      defaultDescription: ordinary === null ? null : ordinary === deep ? String(ordinary) : `${ordinary} in Fast mode; ${deep} in Deep mode`,
    });
  });
}

export {
  INLINE_COMMAND_FAMILIES,
  inlineCommandFamily,
  inlineCommandsFor,
  CLI_COMMAND_REGISTRY,
  CLI_CASE_OPERATIONS,
  CLI_INDICATOR_OPERATIONS,
  CLI_COMMANDS,
  CLI_META_ACTIONS,
  COMMAND_COLLECTION,
  COMMAND_DESCRIPTIONS,
  COMMAND_DETAILS,
  COMMAND_USAGE,
  FILE_POSITIONAL_COMMANDS,
  HELP,
  HELP_COMMANDS_BY_GROUP,
  INVESTIGATION_PLAN_RECIPES,
  RUNNABLE_INVESTIGATION_PLAN_RECIPES,
  OPTIONS_BY_COMMAND,
  cliMetaActionForInvocation,
  cliInvocationOptionIndices,
  cliInvocationNetworkEffect,
  commandOptionSpec,
  commandOwnsOption,
  commandPositionalSpecs,
  commonOptionsForCommand,
  commandDefinition,
  commandHelp,
  isCliCommand,
  metaActionDefinition,
};
export type {
  InlineCommandFamily,
  InlineCommandFor,
  CliCommand,
  CliCommandDefinition,
  CliDisclosureClass,
  CliHandlerOwner,
  CliHelpGroup,
  CliInvocationNetworkEffect,
  CliMetaAction,
  CliMetaActionId,
  CliNetworkEffect,
  CliGrammarConstraint,
  CliOptionIntegerRange,
  CliOptionOccurrence,
  CliOptionScope,
  CliOptionSpec,
  CliOptionValueKind,
  CliPositionalSpec,
  CliPositionalInputSource,
  CliPositionalValueKind,
  CommandCollection,
  CommandDetail,
  CompletionShell,
};
