import { INVESTIGATION_PLAN_RECIPES } from './investigation-recipes.mts';
import type { CliOptionValueKind, CliOptionOccurrence, CliOptionScope, CliPositionalValueKind, CliPositionalInputSource, CliMetaActionId, CliMetaAction, CliOptionIntegerRange, CliOptionSpec, CliPositionalSpec, CliGrammarConstraint, CliCommandGrammar } from '../packages/contracts/cli-grammar.mts';
import { WHOISLEUTH_SOURCE_REPOSITORY_URL } from '../packages/analysis/project-metadata.mts';
import { LOOKUP_EVIDENCE_SCHEMA_VERSION, SUPPORTED_LOOKUP_EVIDENCE_SCHEMA_VERSIONS, V1_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION } from '../packages/contracts/lookup-evidence.mts';
import { SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS, WORKSPACE_ARCHIVE_VERSION } from '../packages/contracts/case-portability.mts';
import { type CliCommand, type CliHelpGroup } from '../packages/contracts/cli-command-semantics.mts';
import { CLI_FAIL_POLICIES_BY_COMMAND, type CliFailPolicyCommand } from './fail-policy.mts';
import { MAX_INVESTIGATION_MANIFEST_ARTIFACTS } from '../packages/investigation/investigation-manifest.mts';
import { IDENTITY_ACTIONS } from '../packages/contracts/message-intake.mts';

const LEGACY_WORKSPACE_ARCHIVE_VERSIONS = SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS
  .filter((version) => version !== WORKSPACE_ARCHIVE_VERSION);
const LEGACY_WORKSPACE_ARCHIVE_DESCRIPTION = LEGACY_WORKSPACE_ARCHIVE_VERSIONS
  .map((version) => `version-${version}`)
  .join(' and ');
const PUBLISHED_V2_LOOKUP_EVIDENCE_VERSIONS = SUPPORTED_LOOKUP_EVIDENCE_SCHEMA_VERSIONS
  .filter((version) => version > V1_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION && version !== LOOKUP_EVIDENCE_SCHEMA_VERSION)
  .join(', ');
const LEGACY_WORKSPACE_ARCHIVE_SCOPE = LEGACY_WORKSPACE_ARCHIVE_VERSIONS
  .map((version) => `v${version}`)
  .join(' and ');

type CompletionShell = 'bash' | 'zsh' | 'fish' | 'powershell';
type CommandDetail = Readonly<{
  description: string;
  example: string;
  boundary: string;
}>;
type CommandCollection = Readonly<{
  mode: 'offline' | 'network';
  scope: string;
}>;
type CliNetworkEffect = 'offline' | 'always_network' | 'conditional_network';
type CliInvocationNetworkEffect = 'offline' | 'network';
type CliDisclosureClass = 'none' | 'bounded_passive' | 'conditional_bounded_passive' | 'bounded_authorised_active';
type CliHandlerOwner =
  | 'bulk'
  | 'discovery'
  | 'discovery_scan'
  | 'evidence'
  | 'inline'
  | 'lookup'
  | 'network';
const INLINE_COMMAND_FAMILIES = ['support', 'review', 'assurance', 'workflow', 'history'] as const;
type InlineCommandFamily = typeof INLINE_COMMAND_FAMILIES[number];
type CliExecutionOwner = Exclude<CliHandlerOwner, 'inline'> | InlineCommandFamily;

type CliCommandDefinition = Readonly<{
  command: CliCommand;
  order: number;
  reference: Readonly<CommandDetail & { usage: string }>;
  collection: CommandCollection;
  completion: Readonly<{
    description: string;
    commonOptions: readonly string[];
    options: readonly string[];
  }>;
  grammar: CliCommandGrammar & Readonly<{ parserKey: CliCommand }>;
  execution: Readonly<{
    handlerOwner: CliHandlerOwner;
    networkEffect: CliNetworkEffect;
  }>;
  help: Readonly<{
    group: CliHelpGroup;
    summary: string;
  }>;
  documentation: Readonly<{
    common: boolean;
    disclosureClass: CliDisclosureClass;
    explicitAuthorisationRequired: boolean;
    planSupport: boolean;
    failurePolicySupport: boolean;
    supportedSchemaIdentifiers: readonly string[];
    inputLimits: readonly string[];
    outputLimits: readonly string[];
    outputFormats: readonly string[];
    presentationOptions: readonly Readonly<{ option: string; format: string }>[];
    fileOutput: boolean;
    primaryEvidenceArtefacts: readonly string[];
  }>;
}>;

const CLI_CASE_OPERATIONS = ['show', 'open', 'note', 'pin', 'link', 'withdraw-link', 'assess', 'recheck'] as const;
const CLI_INDICATOR_OPERATIONS = ['revise', 'inspect', 'stix', 'misp'] as const;

const CLI_META_ACTIONS: readonly CliMetaAction[] = Object.freeze([
  Object.freeze({
    id: 'help',
    aliases: Object.freeze(['--help', '-h']),
    scope: 'root_or_command',
    precedence: 'before_command_grammar',
    bypassesOrdinaryRequirements: true,
    acceptsAdditionalArguments: false,
  }),
  Object.freeze({
    id: 'version',
    aliases: Object.freeze(['--version', '-V']),
    scope: 'root_only',
    precedence: 'before_command_grammar',
    bypassesOrdinaryRequirements: true,
    acceptsAdditionalArguments: false,
  }),
]);
const CLI_META_ACTION_BY_ID = Object.freeze(Object.fromEntries(
  CLI_META_ACTIONS.map((action) => [action.id, action]),
)) as Readonly<Record<CliMetaActionId, CliMetaAction>>;

// Human-facing command reference kept separate from command execution so
// additions do not expand the already broad runtime controller.

const HELP_INTRO = `WHOISleuth CLI
Domain investigation from your terminal.

Quick start:
  whoisleuth
  whoisleuth example.test
  whoisleuth lookup example.test --deep
  cat domains.txt | whoisleuth bulk --jsonl
`;

const HELP_FOOTER = `
Run "whoisleuth <command> --help" for focused usage and an example.
With no arguments, an eligible interactive terminal opens a bounded launcher;
redirected or unsupported terminals continue to print this help. No request
starts until a Lookup plan is shown and the analyst confirms collection.
Use --json or --jsonl where supported for machine-readable stdout.
Use --output <file> for atomic private file output and --force to replace it.
Use -- before positional filenames that begin with a hyphen; ./ also makes a
filename unambiguous, for example: whoisleuth verify-artifact -- ./-evidence.json.
Use --palette auto, light, or dark after the command to select a fixed terminal
colour palette; --no-color, NO_COLOR, and redirected output still suppress ANSI.
Use --config <file> and --profile <name> for explicit versioned safe defaults.
Registry scaffold is the exception: its --profile selects a fixture capability
profile and --config is rejected, so bootstrap defaults cannot alter fixtures.
An ICANN-recognised public domain, reserved documentation domain, IP, or ASN
may replace "lookup"; URL-like or ambiguous input requires the explicit
command. Both forms use the same Lookup options.
Diagnostics are written to stderr. Fast lookup is the default; deep collection
must be requested explicitly and can disclose a target to additional sources.

Copyright 2026 slicedearth. Licensed under AGPL-3.0-only.
Source and licence: ${WHOISLEUTH_SOURCE_REPOSITORY_URL}
`;

const COMMON_OPTIONS = Object.freeze([
  '--help', '--output', '--force', '--config', '--profile', '--palette',
] as const satisfies readonly (keyof typeof CLI_OPTION_DEFINITIONS)[]);
const REGISTRY_SCAFFOLD_COMMON_OPTIONS = Object.freeze(
  COMMON_OPTIONS.filter((option) => option !== '--config' && option !== '--profile'),
);

function commonOptionsSeedForCommand(command: CliCommand): readonly CliOption[] {
  return command === 'registry-scaffold' ? REGISTRY_SCAFFOLD_COMMON_OPTIONS : COMMON_OPTIONS;
}

function positional(
  name: string,
  valueKind: CliPositionalValueKind,
  minimum: number,
  maximum: number,
  values: readonly string[] = [],
  inputSource: CliPositionalInputSource = 'argv',
  requiredWhenOptions: readonly string[] = [],
): CliPositionalSpec {
  return Object.freeze({
    name,
    valueKind,
    minimum,
    maximum,
    values: Object.freeze([...values]),
    inputSource,
    requiredWhenOptions: Object.freeze([...requiredWhenOptions]),
  });
}

const NO_POSITIONALS: readonly CliPositionalSpec[] = Object.freeze([]);
const OPTIONAL_FILE_POSITIONAL = Object.freeze([positional('source', 'file', 0, 1, [], 'argv_or_stdin')]);
const OPTIONAL_TEXT_POSITIONAL = Object.freeze([positional('subject', 'text', 0, 1, [], 'argv_or_stdin')]);


type CliOptionDefinition = Readonly<{
  description: (command: CliCommand) => string;
  defaultValue: (command: CliCommand, deep: boolean) => string | number | null;
  valueKind: (command: CliCommand) => CliOptionValueKind;
  values: (command: CliCommand) => readonly string[];
  occurrence: CliOptionOccurrence;
  acceptsOptionLikeValue: boolean;
  metaAction: CliMetaActionId | null;
  integerRanges: (command: CliCommand) => readonly CliOptionIntegerRange[];
}>;

const NO_INTEGER_RANGES = () => Object.freeze([] as CliOptionIntegerRange[]);
const BASE_INTEGER_RANGE = (minimum: number, maximum: number): CliOptionIntegerRange => (
  Object.freeze({ minimum, maximum, whenOptionPresent: null })
);
const DEEP_INTEGER_RANGE = (minimum: number, maximum: number): CliOptionIntegerRange => (
  Object.freeze({ minimum, maximum, whenOptionPresent: '--deep' })
);
function optionDefinition(
  valueKind: CliOptionValueKind | ((command: CliCommand) => CliOptionValueKind),
  description: string | ((command: CliCommand) => string),
  options: Readonly<{
    defaultValue?: string | number | ((command: CliCommand, deep: boolean) => string | number | null);
    values?: readonly string[] | ((command: CliCommand) => readonly string[]);
    occurrence?: CliOptionOccurrence;
    acceptsOptionLikeValue?: boolean;
    metaAction?: CliMetaActionId;
    integerRanges?: (command: CliCommand) => readonly CliOptionIntegerRange[];
  }> = {},
): CliOptionDefinition {
  const configuredValues = options.values;
  const configuredDefault = options.defaultValue;
  return Object.freeze({
    description: typeof description === 'function' ? description : () => description,
    defaultValue: typeof configuredDefault === 'function' ? configuredDefault : () => configuredDefault ?? null,
    valueKind: typeof valueKind === 'function' ? valueKind : () => valueKind,
    values: typeof configuredValues === 'function'
      ? configuredValues
      : () => Object.freeze([...(configuredValues ?? [])]),
    occurrence: options.occurrence ?? 'once',
    acceptsOptionLikeValue: options.acceptsOptionLikeValue ?? false,
    metaAction: options.metaAction ?? null,
    integerRanges: options.integerRanges ?? NO_INTEGER_RANGES,
  });
}

const flag = (description: string, occurrence: CliOptionOccurrence = 'once') => optionDefinition('flag', description, { occurrence });
const file = (description: string) => optionDefinition('file', description);
const text = (description: string, acceptsOptionLikeValue = false) => optionDefinition('text', description, { acceptsOptionLikeValue });
const enumeration = (description: string, values: readonly string[], defaultValue?: string) => optionDefinition('enum', description, { values, ...(defaultValue === undefined ? {} : { defaultValue }) });
const integer = (description: string, ranges: (command: CliCommand) => readonly CliOptionIntegerRange[], defaultValue: CliOptionDefinition['defaultValue']) => (
  optionDefinition('integer', description, { integerRanges: ranges, defaultValue })
);

const CLI_OPTION_DEFINITIONS = Object.freeze({
  '--help': optionDefinition('flag', 'Show command usage, options and an example without executing it.', { metaAction: 'help' }),
  '--output': file('Write output atomically to this local file.'),
  '--force': flag('Allow replacement of the selected output file.'),
  '--config': file('Load explicit versioned CLI configuration from this file.'),
  '--profile': optionDefinition('text', command => command === 'registry-scaffold' ? 'Select the registry fixture capability profile.' : 'Select a named profile from the supplied configuration.', { acceptsOptionLikeValue: true }),
  '--palette': enumeration('Choose the terminal colour palette; redirected output and no-colour settings still take precedence.', ['auto', 'light', 'dark']),
  '--network': flag('Include the optional public DNS and port 43 runtime checks.'),
  '--json': flag('Write structured JSON to stdout or the selected output file.'),
  '--reported-action': optionDefinition('enum', 'Record an analyst-reported identity action; repeat for separate actions.', { values: IDENTITY_ACTIONS.map(action => action.id), occurrence: 'repeatable' }),
  '--trusted-auth-header': optionDefinition('text', 'Select a recognised receiver header by part:header-index. This records analyst trust, not independent authentication; repeat for separate headers.', { occurrence: 'repeatable' }),
  '--package': optionDefinition('flag', command => command === 'manifest' ? 'Create a portable evidence ZIP containing the selected files.' : 'Verify a portable evidence ZIP or encrypted package rather than a single report.'),
  '--folder': optionDefinition('file', command => command === 'manifest' ? 'Create a new evidence folder containing the selected files.' : 'Verify the evidence package within this selected folder.'),
  '--quiet': flag('Suppress ordinary terminal presentation.', 'idempotent'),
  '--no-color': flag('Suppress ANSI colour in terminal output.', 'idempotent'),
  '--common': flag('Show only commands marked as common.'),
  '--group': enumeration('Filter commands by task group.', ['investigate', 'respond', 'assure', 'utilities']),
  '--mode': enumeration('Filter commands by offline or network collection mode.', ['offline', 'network']),
  '--workflow': text('Label the workflow recorded in the evidence manifest.', true),
  '--configuration-digest': text('Record a supplied configuration digest in the manifest provenance.', true),
  '--junit': flag('Write JUnit XML for automated result reporting.'),
  '--markdown': flag('Write a Markdown report.'),
  '--html': flag('Write an HTML report.'),
  '--no-attribution': flag('Omit the optional product attribution from presentation output.'),
  '--fast': flag('Select registration-first Fast collection.'),
  '--deep': flag('Select broader Deep collection and its additional source requests.'),
  '--exact-url': flag('With Deep Lookup, send the selected URL path and query to the website; omit its fragment.'),
  '--observer': text('Attach the supplied observer label to the retained observation.'),
  '--vantage': text('Attach the supplied collection-vantage label.'),
  '--plan': flag('Describe intended collection and limits without making requests.'),
  '--summary': flag('Show a concise terminal result.'),
  '--verbose': flag('Show the detailed terminal result.'),
  '--browse': flag('Open the interactive terminal evidence browser.'),
  '--interactive': flag('Prompt for missing supported inputs on an interactive terminal.'),
  '--save-lookup': file('After a normal evidence-browser close, save the completed private Lookup JSON to a new file.'),
  '--strict-exit': flag('Use the command’s strict outcome policy when deciding the exit status.'),
  '--fail-on': optionDefinition('policy_list', 'Return a failure-policy exit status for the selected comma-separated outcomes.', {
    values: (command) => CLI_FAIL_POLICIES_BY_COMMAND[command as CliFailPolicyCommand] ?? [],
  }),
  '--events': flag('Emit collection progress events on stderr.'),
  '--jsonl': flag('Write one JSON record per line.'),
  '--csv': flag('Write compact CSV rows.'),
  '--csv-with-metadata': flag('Write CSV with source, observation-time and collection-state metadata.'),
  '--domains': flag('Write the selected domain names only.'),
  '--queries': flag('Write the selected original queries only.'),
  '--registered-only': flag('Keep registered results in the presented output.'),
  '--inconclusive-only': flag('Keep inconclusive results in the presented output.'),
  '--errors-only': flag('Keep error results in the presented output.'),
  '--concurrency': integer('Set the maximum number of concurrent collection tasks.', (command) => command === 'monitor-once'
    ? Object.freeze([BASE_INTEGER_RANGE(1, 3)])
    : Object.freeze([BASE_INTEGER_RANGE(1, 8), DEEP_INTEGER_RANGE(1, 3)]), (command, deep) => command === 'monitor-once' || deep ? 2 : 4),
  '--checkpoint': file('Save resumable collection state to this local file.'),
  '--resume': optionDefinition((command) => command === 'workflow-run' ? 'file' : 'flag', command => command === 'workflow-run' ? 'Resume the selected workflow checkpoint; approvals must be supplied again.' : 'Resume collection from the selected checkpoint.'),
  '--tlds': text('Use this comma-separated set of domain endings.', true),
  '--preset': enumeration('Choose candidate-generation families; explicit families select a custom set instead.', ['common', 'impersonation', 'all'], 'all'),
  '--families': text('Select the candidate-generation families explicitly.'),
  '--keyboard': enumeration('Choose keyboard layouts for adjacent-key candidates.', ['qwerty', 'azerty', 'qwertz', 'all'], 'qwerty'),
  '--dictionary': file('Read candidate words from this local dictionary.'),
  '--snapshot': file('Use this retained observation snapshot.'),
  '--scan-limit': integer('Limit the number of generated candidates to collect.', () => Object.freeze([
    BASE_INTEGER_RANGE(1, 500),
    DEEP_INTEGER_RANGE(1, 50),
  ]), (_command, deep) => deep ? 50 : 100),
  '--chunk-size': integer('Set the number of candidates processed per checkpoint chunk.', () => Object.freeze([BASE_INTEGER_RANGE(1, 100)]), () => 25),
  '--resolver': text('Choose the supported DNS resolver for collection.'),
  '--allowlist': file('Read reviewed domains whose priority should be suppressed, without changing their evidence.'),
  '--observation-snapshot': file('Compare with this retained observation snapshot.'),
  '--acquisition-only': flag('Present only acquisition candidates.'),
  '--suppressed-only': flag('Present only candidates suppressed by the allowlist.'),
  '--selectors': text('Supply explicit DKIM selectors; no selector enumeration is performed.', true),
  '--retired-selectors': text('Supply previously retired DKIM selectors for review.', true),
  '--mail-profile': enumeration('Choose the expected mail posture for the review.', ['standard', 'defensive-no-mail', 'parked'], 'standard'),
  '--sarif': flag('Write the posture review as SARIF.'),
  '--owned-domain': flag('Declare that the reviewed domain is owned by the analyst.'),
  '--include-inherited-dns': flag('Explicitly collect inherited DMARC and parent-delegation evidence.'),
  '--trust-anchor': file('Read the analyst-selected DNSSEC trust anchor.'),
  '--owned-or-authorized': flag('Acknowledge ownership or permission for this active collection.'),
  '--active-probe': flag('Explicitly enable the bounded active protocol exchange.'),
  '--suffix': text('Select the registry suffix.', true),
  '--scenario': enumeration('Choose the expected registry fixture outcome.', ['registered', 'not_found', 'inconclusive']),
  '--summary-json': flag('Write the concise structured summary.'),
  '--passphrase-file': file('Read the archive passphrase from a local file, not a command-line value.'),
  '--manifest': file('Use the selected investigation manifest.'),
  '--bagit': optionDefinition('flag', command => command === 'manifest' ? 'Create a BagIt 1.0 package with SHA-512 checksums.' : 'Verify the selected package as BagIt 1.0.'),
  '--manifest-entry': enumeration('Select an artefact entry from the supplied manifest.', Array.from({ length: MAX_INVESTIGATION_MANIFEST_ARTIFACTS }, (_, index) => `artifact-${index + 1}`)),
  '--search': text('Search the selected local archive.'),
  '--require-match': flag('Require the local archive search to find a match.'),
  '--reveal': flag('Include retained values otherwise redacted by archive inspection.'),
  '--expect-content-digest': text('Compare archive content with the supplied version-qualified or historical digest.', true),
  '--private-key-file': file('Read the private signing key from this local file.'),
  '--public-key-file': file('Read the public verification key from this local file.'),
  '--trust-store-file': file('Read the analyst-selected signer trust store.'),
  '--mmdb': file('Use the selected local IP-location database.'),
  '--audience': enumeration('Choose the export audience and its field-disclosure policy.', ['internal', 'trusted', 'public']),
  '--reviewed': flag('Confirm the required human review of the exported material.'),
  '--previous': file('Compare against this earlier retained report.'),
  '--limit': integer('Limit the number of watchlist targets checked in this run.', () => Object.freeze([BASE_INTEGER_RANGE(1, 20)]), () => 20),
  '--marking': enumeration('Declare the information-sharing marking.', ['clear', 'green', 'amber', 'amber-strict', 'red']),
  '--recipient-scope': enumeration('Declare the intended recipient scope.', ['public', 'community', 'organization', 'named-recipients']),
  '--purpose': text('Record the purpose of the intended sharing.'),
  '--human-reviewed': flag('Confirm that a person reviewed the material.', 'idempotent'),
  '--personal-data-reviewed': flag('Confirm that personal-data disclosure was reviewed.', 'idempotent'),
  '--redactions-confirmed': flag('Confirm that the intended redactions were checked.', 'idempotent'),
  '--list': flag('List available workflow recipes.'),
  '--explain': enumeration('Explain a selected workflow without executing it.', INVESTIGATION_PLAN_RECIPES),
  '--select': optionDefinition('text', 'Bind a literal input to a workflow step; repeat for further inputs.', { occurrence: 'repeatable', acceptsOptionLikeValue: true }),
  '--use-artifact': optionDefinition('text', 'Connect a step input to an earlier compatible output.', { occurrence: 'repeatable' }),
  '--confirm-review': optionDefinition('text', 'Confirm human review for the named step in this invocation.', { occurrence: 'repeatable' }),
  '--approve-network': flag('Approve the workflow’s declared network steps for this invocation.'),
  '--preview': flag('Inspect validated retained outputs, unresolved inputs and remaining approvals without executing or writing a checkpoint.'),
  '--left-session': text('Select the left-hand retained capture session.', true),
  '--right-session': text('Select the right-hand retained capture session.', true),
  '--compact': flag('Write a compact report presentation.'),
  '--case-id': text('Select the retained Case identifier.'),
  '--domain': text('Supply the Case domain.'),
  '--title': text('Supply the Case title.'),
  '--new-incident': flag('Create a separate incident instead of updating a matching Case.'),
  '--text': text('Supply the note text directly.'),
  '--note-file': file('Read note text from a selected local file.'),
  '--input': file('Read the selected local input file.'),
  '--expect-file-digest': text('Require the input file to match this SHA-256 digest.'),
} as const satisfies Readonly<Record<string, CliOptionDefinition>>);

type CliOption = keyof typeof CLI_OPTION_DEFINITIONS;

function constraint(
  value: CliGrammarConstraint,
): CliGrammarConstraint {
  if (value.kind === 'mutually_exclusive') {
    return Object.freeze({ ...value, options: Object.freeze([...value.options]) });
  }
  if (value.kind === 'required') {
    return Object.freeze({ ...value, options: Object.freeze([...value.options]) });
  }
  if (value.kind === 'excludes_all' || value.kind === 'value_excludes') {
    return Object.freeze({ ...value, excludedOptions: Object.freeze([...value.excludedOptions]) });
  }
  return Object.freeze({ ...value, requiredOptions: Object.freeze([...value.requiredOptions]) });
}

const EMPTY_CONSTRAINTS: readonly CliGrammarConstraint[] = Object.freeze([]);
const FILE_OUTPUT_CONSTRAINTS = Object.freeze([
  constraint({ kind: 'requires_all', option: '--force', requiredOptions: ['--output'] }),
] satisfies readonly CliGrammarConstraint[]);
const QUIET_OUTPUT_CONSTRAINT = constraint({
  kind: 'mutually_exclusive',
  options: ['--quiet', '--output'],
});
const PRESENTATION_OPTIONS = Object.freeze([
  ['--json', 'JSON'], ['--jsonl', 'JSON Lines'], ['--junit', 'JUnit XML'],
  ['--csv', 'CSV'],
  ['--csv-with-metadata', 'CSV with evidence metadata'],
  ['--domains', 'domain list'], ['--queries', 'query list'],
  ['--markdown', 'Markdown'], ['--html', 'HTML'], ['--sarif', 'SARIF'],
  ['--summary-json', 'summary JSON'],
] as const);
const MACHINE_OUTPUT_OPTIONS: readonly string[] = Object.freeze(PRESENTATION_OPTIONS.map(([option]) => option));

function optionSpec(command: CliCommand, option: CliOption, scope: CliOptionScope): CliOptionSpec {
  const definition = CLI_OPTION_DEFINITIONS[option];
  const valueKind = definition.valueKind(command);
  const values = definition.values(command);
  return Object.freeze({
    option,
    scope,
    arity: valueKind === 'flag' ? 0 : 1,
    valueKind,
    values: Object.freeze([...values]),
    integerRanges: Object.freeze([...definition.integerRanges(command)]),
    occurrence: definition.occurrence,
    acceptsOptionLikeValue: definition.acceptsOptionLikeValue,
    metaAction: definition.metaAction,
  });
}

function grammarConstraints(
  commandOptions: readonly CliOption[],
  commandConstraints: readonly CliGrammarConstraint[],
): readonly CliGrammarConstraint[] {
  const machineOutputOptions = commandOptions.filter((option) => MACHINE_OUTPUT_OPTIONS.includes(option));
  return Object.freeze([
    ...FILE_OUTPUT_CONSTRAINTS,
    ...(commandOptions.includes('--quiet') ? [QUIET_OUTPUT_CONSTRAINT] : []),
    ...(commandOptions.includes('--quiet') && machineOutputOptions.length > 0
      ? [constraint({ kind: 'excludes_all', option: '--quiet', excludedOptions: machineOutputOptions })]
      : []),
    ...(commandOptions.includes('--events')
      ? [constraint({ kind: 'mutually_exclusive', options: ['--events', '--output'] })]
      : []),
    ...(commandOptions.includes('--browse')
      ? [constraint({ kind: 'mutually_exclusive', options: ['--browse', '--output'] })]
      : []),
    ...commandConstraints,
  ]);
}

type CliCommandSeed = Readonly<{
  reference: CommandDetail;
  collection: CommandCollection;
  summary: string;
  options: readonly CliOption[];
  positionals: readonly CliPositionalSpec[];
  constraints: readonly CliGrammarConstraint[];
  handlerOwner: CliExecutionOwner;
  networkEffect: CliNetworkEffect;
  common: boolean;
  schemaIdentifiers: readonly string[];
  primaryArtefacts: readonly string[];
  planSupport: boolean;
  additionalOutputFormats: readonly string[];
  bootstrapProfile: 'allowed' | 'command_owned';
}>;

function commandSeed<const Owner extends CliExecutionOwner>(
  seed: Omit<CliCommandSeed, 'handlerOwner'> & { handlerOwner: Owner },
): CliCommandSeed & { readonly handlerOwner: Owner } {
  return Object.freeze({
    ...seed,
    reference: Object.freeze({ ...seed.reference }),
    collection: Object.freeze({ ...seed.collection }),
    options: Object.freeze([...seed.options]),
    positionals: Object.freeze([...seed.positionals]),
    constraints: Object.freeze([...seed.constraints]),
    schemaIdentifiers: Object.freeze([...seed.schemaIdentifiers]),
    primaryArtefacts: Object.freeze([...seed.primaryArtefacts]),
    additionalOutputFormats: Object.freeze([...seed.additionalOutputFormats]),
  });
}

export { LEGACY_WORKSPACE_ARCHIVE_VERSIONS, LEGACY_WORKSPACE_ARCHIVE_DESCRIPTION, PUBLISHED_V2_LOOKUP_EVIDENCE_VERSIONS, LEGACY_WORKSPACE_ARCHIVE_SCOPE, INLINE_COMMAND_FAMILIES, CLI_CASE_OPERATIONS, CLI_INDICATOR_OPERATIONS, CLI_META_ACTIONS, CLI_META_ACTION_BY_ID, HELP_INTRO, HELP_FOOTER, COMMON_OPTIONS, REGISTRY_SCAFFOLD_COMMON_OPTIONS, commonOptionsSeedForCommand, positional, NO_POSITIONALS, OPTIONAL_FILE_POSITIONAL, OPTIONAL_TEXT_POSITIONAL, NO_INTEGER_RANGES, BASE_INTEGER_RANGE, DEEP_INTEGER_RANGE, optionDefinition, flag, file, text, enumeration, integer, CLI_OPTION_DEFINITIONS, constraint, EMPTY_CONSTRAINTS, FILE_OUTPUT_CONSTRAINTS, QUIET_OUTPUT_CONSTRAINT, PRESENTATION_OPTIONS, MACHINE_OUTPUT_OPTIONS, optionSpec, grammarConstraints, commandSeed };
export type { CompletionShell, CommandDetail, CommandCollection, CliNetworkEffect, CliInvocationNetworkEffect, CliDisclosureClass, CliHandlerOwner, InlineCommandFamily, CliExecutionOwner, CliCommandDefinition, CliOptionDefinition, CliOption, CliCommandSeed };
