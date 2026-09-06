import { WHOISLEUTH_SOURCE_REPOSITORY_URL } from '../lib/project-metadata.mts';
import {
  LOOKUP_EVIDENCE_SCHEMA_VERSION,
  PUBLISHED_V2_LOOKUP_EVIDENCE_SCHEMA_VERSION,
  V1_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION,
} from '../lib/evidence-export.mts';
import {
  RISK_CALIBRATION_DATASET_SCHEMA,
  RISK_CALIBRATION_REPORT_SCHEMA,
} from '../packages/contracts/risk-calibration.mts';
import {
  CASE_SCHEMA_VERSION,
  SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS,
  WORKSPACE_ARCHIVE_VERSION,
} from '../packages/contracts/case-portability.mts';
import {
  CLI_COMMAND_SEMANTICS,
  CLI_HELP_GROUP_ORDER,
  type CliCommand,
  type CliHelpGroup,
} from '../packages/contracts/cli-command-semantics.mts';
import { CLI_FAIL_POLICIES_BY_COMMAND, type CliFailPolicyCommand } from './fail-policy.mts';

const LEGACY_WORKSPACE_ARCHIVE_VERSIONS = SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS
  .filter((version) => version !== WORKSPACE_ARCHIVE_VERSION);
const LEGACY_WORKSPACE_ARCHIVE_DESCRIPTION = LEGACY_WORKSPACE_ARCHIVE_VERSIONS
  .map((version) => `version-${version}`)
  .join(' and ');
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
type CliOptionValueKind = 'enum' | 'file' | 'flag' | 'integer' | 'policy_list' | 'text';
type CliOptionOccurrence = 'idempotent' | 'once' | 'repeatable';
type CliOptionScope = 'command' | 'common';
type CliPositionalValueKind = 'enum' | 'file' | 'text';
type CliPositionalInputSource = 'argv' | 'argv_or_stdin';
type CliMetaActionId = 'help' | 'version';
type CliMetaAction = Readonly<{
  id: CliMetaActionId;
  aliases: readonly string[];
  scope: 'root_only' | 'root_or_command';
  precedence: 'before_command_grammar';
  bypassesOrdinaryRequirements: true;
  acceptsAdditionalArguments: false;
}>;
type CliOptionIntegerRange = Readonly<{
  minimum: number;
  maximum: number;
  whenOptionPresent: string | null;
}>;
type CliOptionSpec = Readonly<{
  option: string;
  scope: CliOptionScope;
  arity: 0 | 1;
  valueKind: CliOptionValueKind;
  values: readonly string[];
  integerRanges: readonly CliOptionIntegerRange[];
  occurrence: CliOptionOccurrence;
  acceptsOptionLikeValue: boolean;
  metaAction: CliMetaActionId | null;
}>;
type CliPositionalSpec = Readonly<{
  name: string;
  valueKind: CliPositionalValueKind;
  minimum: number;
  maximum: number;
  values: readonly string[];
  inputSource: CliPositionalInputSource;
  requiredWhenOptions: readonly string[];
}>;
type CliGrammarConstraint =
  | Readonly<{ kind: 'mutually_exclusive'; options: readonly string[] }>
  | Readonly<{ kind: 'excludes_all'; option: string; excludedOptions: readonly string[] }>
  | Readonly<{ kind: 'requires_all'; option: string; requiredOptions: readonly string[] }>
  | Readonly<{ kind: 'requires_any'; option: string; requiredOptions: readonly string[] }>
  | Readonly<{ kind: 'value_excludes'; option: string; value: string; excludedOptions: readonly string[] }>
  | Readonly<{ kind: 'required'; options: readonly string[] }>;
type CliHandlerOwner =
  | 'bulk'
  | 'discovery'
  | 'discovery_scan'
  | 'evidence'
  | 'inline'
  | 'lookup'
  | 'network';
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
  grammar: Readonly<{
    parserKey: CliCommand;
    bootstrapProfile: 'allowed' | 'command_owned';
    options: readonly CliOptionSpec[];
    positionals: readonly CliPositionalSpec[];
    constraints: readonly CliGrammarConstraint[];
    metaActions: readonly CliMetaActionId[];
  }>;
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
    primaryEvidenceArtefacts: readonly string[];
  }>;
}>;

const INVESTIGATION_PLAN_RECIPES = Object.freeze([
  'domain-triage',
  'lookalike-review',
  'owned-domain-review',
  'historical-comparison',
  'campaign-review',
  'certificate-anomaly',
  'registry-disagreement',
  'evidence-handoff',
  'planned-domain-change',
  'post-change-verification',
] as const);

const RUNNABLE_INVESTIGATION_PLAN_RECIPES = Object.freeze([
  'domain-triage',
  'lookalike-review',
  'owned-domain-review',
  'historical-comparison',
] as const);

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
  options: Readonly<{
    values?: readonly string[] | ((command: CliCommand) => readonly string[]);
    occurrence?: CliOptionOccurrence;
    acceptsOptionLikeValue?: boolean;
    metaAction?: CliMetaActionId;
    integerRanges?: (command: CliCommand) => readonly CliOptionIntegerRange[];
  }> = {},
): CliOptionDefinition {
  const configuredValues = options.values;
  return Object.freeze({
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

const flag = (occurrence: CliOptionOccurrence = 'once') => optionDefinition('flag', { occurrence });
const file = () => optionDefinition('file');
const text = (acceptsOptionLikeValue = false) => optionDefinition('text', { acceptsOptionLikeValue });
const enumeration = (values: readonly string[]) => optionDefinition('enum', { values });
const integer = (ranges: (command: CliCommand) => readonly CliOptionIntegerRange[]) => (
  optionDefinition('integer', { integerRanges: ranges })
);

const CLI_OPTION_DEFINITIONS = Object.freeze({
  '--help': optionDefinition('flag', { metaAction: 'help' }),
  '--output': file(),
  '--force': flag(),
  '--config': file(),
  '--profile': text(true),
  '--palette': enumeration(['auto', 'light', 'dark']),
  '--network': flag(),
  '--json': flag(),
  '--quiet': flag('idempotent'),
  '--no-color': flag('idempotent'),
  '--common': flag(),
  '--group': enumeration(['investigate', 'respond', 'assure', 'utilities']),
  '--mode': enumeration(['offline', 'network']),
  '--workflow': text(true),
  '--configuration-digest': text(true),
  '--junit': flag(),
  '--markdown': flag(),
  '--html': flag(),
  '--no-attribution': flag(),
  '--fast': flag(),
  '--deep': flag(),
  '--observer': text(),
  '--vantage': text(),
  '--plan': flag(),
  '--summary': flag(),
  '--verbose': flag(),
  '--browse': flag(),
  '--save-lookup': file(),
  '--strict-exit': flag(),
  '--fail-on': optionDefinition('policy_list', {
    values: (command) => CLI_FAIL_POLICIES_BY_COMMAND[command as CliFailPolicyCommand] ?? [],
  }),
  '--events': flag(),
  '--jsonl': flag(),
  '--csv': flag(),
  '--domains': flag(),
  '--queries': flag(),
  '--registered-only': flag(),
  '--inconclusive-only': flag(),
  '--errors-only': flag(),
  '--concurrency': integer((command) => command === 'monitor-once'
    ? Object.freeze([BASE_INTEGER_RANGE(1, 3)])
    : Object.freeze([BASE_INTEGER_RANGE(1, 8), DEEP_INTEGER_RANGE(1, 3)])),
  '--checkpoint': file(),
  '--resume': optionDefinition((command) => command === 'workflow-run' ? 'file' : 'flag'),
  '--tlds': text(true),
  '--preset': enumeration(['common', 'impersonation', 'all']),
  '--families': text(),
  '--keyboard': enumeration(['qwerty', 'azerty', 'qwertz', 'all']),
  '--dictionary': file(),
  '--snapshot': file(),
  '--scan-limit': integer(() => Object.freeze([
    BASE_INTEGER_RANGE(1, 500),
    DEEP_INTEGER_RANGE(1, 50),
  ])),
  '--chunk-size': integer(() => Object.freeze([BASE_INTEGER_RANGE(1, 100)])),
  '--resolver': text(),
  '--allowlist': file(),
  '--observation-snapshot': file(),
  '--acquisition-only': flag(),
  '--suppressed-only': flag(),
  '--selectors': text(true),
  '--retired-selectors': text(true),
  '--mail-profile': enumeration(['standard', 'defensive-no-mail', 'parked']),
  '--sarif': flag(),
  '--owned-domain': flag(),
  '--trust-anchor': file(),
  '--owned-or-authorized': flag(),
  '--active-probe': flag(),
  '--suffix': text(true),
  '--scenario': enumeration(['registered', 'not_found', 'inconclusive']),
  '--summary-json': flag(),
  '--passphrase-file': file(),
  '--manifest': file(),
  '--manifest-entry': enumeration(Array.from({ length: 16 }, (_, index) => `artifact-${index + 1}`)),
  '--search': text(),
  '--require-match': flag(),
  '--reveal': flag(),
  '--expect-content-digest': text(true),
  '--private-key-file': file(),
  '--public-key-file': file(),
  '--mmdb': file(),
  '--audience': enumeration(['internal', 'trusted', 'public']),
  '--reviewed': flag(),
  '--previous': file(),
  '--limit': integer(() => Object.freeze([BASE_INTEGER_RANGE(1, 20)])),
  '--marking': enumeration(['clear', 'green', 'amber', 'amber-strict', 'red']),
  '--recipient-scope': enumeration(['public', 'community', 'organization', 'named-recipients']),
  '--purpose': text(),
  '--human-reviewed': flag('idempotent'),
  '--personal-data-reviewed': flag('idempotent'),
  '--redactions-confirmed': flag('idempotent'),
  '--list': flag(),
  '--explain': enumeration(INVESTIGATION_PLAN_RECIPES),
  '--select': optionDefinition('text', { occurrence: 'repeatable', acceptsOptionLikeValue: true }),
  '--approve-network': flag(),
  '--left-session': text(true),
  '--right-session': text(true),
  '--compact': flag(),
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
const MACHINE_OUTPUT_OPTIONS = Object.freeze([
  '--json', '--jsonl', '--junit', '--csv', '--domains', '--queries', '--markdown',
  '--html', '--sarif', '--summary-json',
]);

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
  handlerOwner: CliHandlerOwner;
  networkEffect: CliNetworkEffect;
  common: boolean;
  schemaIdentifiers: readonly string[];
  primaryArtefacts: readonly string[];
  planSupport: boolean;
  additionalOutputFormats: readonly string[];
  bootstrapProfile: 'allowed' | 'command_owned';
}>;

function commandSeed(seed: CliCommandSeed): CliCommandSeed {
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

const COMMAND_SEEDS = Object.freeze({
  completion: commandSeed({
    reference: {
      description: 'Print a static shell-completion script for the installed CLI.',
      example: 'whoisleuth completion zsh > ~/.zfunc/_whoisleuth',
      boundary: 'Generation is offline and writes only the script to stdout. The command never modifies shell configuration.',
    },
    collection: { mode: 'offline', scope: 'Prints one static script and changes no shell configuration.' },
    summary: 'Print shell completion',
    options: [],
    positionals: Object.freeze([positional('shell', 'enum', 1, 1, ['bash', 'zsh', 'fish', 'powershell'])]),
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze([]),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  doctor: commandSeed({
    reference: {
      description: 'Check the supported runtime and local terminal capabilities.',
      example: 'whoisleuth doctor --json',
      boundary: 'The default check is offline. Public DNS and port 43 checks run only when --network is explicitly supplied.',
    },
    collection: { mode: 'network', scope: 'Network access is opt-in with --network and is limited to fixed public DNS, HTTPS, and WHOIS diagnostics.' },
    summary: 'Check the local CLI runtime',
    options: ['--network', '--json', '--quiet', '--no-color'],
    positionals: NO_POSITIONALS,
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'conditional_network',
    common: true,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.doctor']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  commands: commandSeed({
    reference: {
      description: 'List the installed command contracts in terminal or versioned JSON form.',
      example: 'whoisleuth commands --json',
      boundary: 'Catalogue generation is offline. It reports declared command modes and limits without executing collection or inspecting local evidence.',
    },
    collection: { mode: 'offline', scope: 'Reads the embedded command catalogue and performs no collection.' },
    summary: 'List installed command contracts',
    options: ['--common', '--group', '--mode', '--json', '--quiet', '--no-color'],
    positionals: NO_POSITIONALS,
    constraints: Object.freeze([]),
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: true,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.command-catalogue']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  manual: commandSeed({
    reference: {
      description: 'Print a generated roff manual page for local installation.',
      example: 'whoisleuth manual | man -l -',
      boundary: 'Generation is offline and derives from the same command catalogue as focused help.',
    },
    collection: { mode: 'offline', scope: 'Builds documentation from the embedded command catalogue.' },
    summary: 'Print the generated manual page',
    options: [],
    positionals: NO_POSITIONALS,
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze([]),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  manifest: commandSeed({
    reference: {
      description: 'Record an ordered, path-free manifest for up to 16 local JSON artefacts.',
      example: 'whoisleuth manifest lookup.json comparison.json --workflow "domain review" --json',
      boundary: 'The command records hashes and bounded schema metadata only. It omits source paths and artefact contents and performs no network collection.',
    },
    collection: { mode: 'offline', scope: 'Reads 1 to 16 local JSON artefacts capped at 32 MiB in total and retains no source paths.' },
    summary: 'Build an evidence manifest offline',
    options: ['--workflow', '--configuration-digest', '--json', '--quiet', '--no-color'],
    positionals: Object.freeze([positional('artefacts', 'file', 1, 16)]),
    constraints: Object.freeze([
    constraint({ kind: 'required', options: ['--workflow'] }),
  ]),
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.investigation-manifest']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "map-observations": commandSeed({
    reference: {
      description: 'Apply one bounded declarative field-mapping profile to local source observations.',
      example: 'whoisleuth map-observations mapping.json --json',
      boundary: 'Profiles select allowlisted dotted fields only. They execute no scripts, make no requests, and emit the browser-compatible external-findings contract.',
    },
    collection: { mode: 'offline', scope: 'Reads one mapping document capped at 4 MiB and executes no scripts or requests.' },
    summary: 'Apply a declarative observation map offline',
    options: ['--json', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.external-observation-mapping']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "oam-export": commandSeed({
    reference: {
      description: 'Project browser-compatible external findings into a bounded Open Asset Model bridge document.',
      example: 'whoisleuth oam-export external-findings.json --json',
      boundary: 'The projection is offline, preserves source completeness without inventing confidence, and covers only bounded FQDN, IP address, certificate, and related edge vocabulary.',
    },
    collection: { mode: 'offline', scope: 'Reads one browser-compatible external-findings document and projects bounded graph records locally.' },
    summary: 'Project external findings to Open Asset Model',
    options: ['--json', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.open-asset-model-bridge']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  lookup: commandSeed({
    reference: {
      description: 'Collect registration evidence for one domain, IP, or ASN.',
      example: 'whoisleuth lookup example.test --deep --browse',
      boundary: 'Fast is the default. An ICANN-recognised public domain, reserved documentation domain, IP, or ASN may occupy command position as shorthand; it delegates to this same parser and URL-like input requires the explicit lookup command. Deep mode adds bounded WHOIS, DNS, HTTP, TLS, technology, posture, and network context where applicable. A full Deep homepage observation can derive fixed publication and delivery/cache summaries from the same response without retaining raw metadata values or making another request. --browse opens before collection, shows aggregate Fast progress or independently settled planned Deep sources, and then navigates allowlisted retained fields in the completed document. Press ? for help and / to search rendered panel text only. Closing during collection cancels without a partial document. --save-lookup writes the exact completed private JSON only after a normal browser close; it can contain normalised evidence omitted from panels and refuses an existing path.',
    },
    collection: { mode: 'network', scope: 'Accepts one target. Fast is the default; deep collection must be selected explicitly.' },
    summary: 'Collect one domain, IP, or ASN',
    options: ['--json', '--junit', '--markdown', '--html', '--no-attribution', '--fast', '--deep', '--observer', '--vantage', '--plan', '--summary', '--verbose', '--browse', '--save-lookup', '--strict-exit', '--fail-on', '--events', '--quiet', '--no-color'],
    positionals: Object.freeze([positional('target', 'text', 0, 1, [], 'argv_or_stdin', ['--browse'])]),
    constraints: Object.freeze([
    constraint({ kind: 'mutually_exclusive', options: ['--json', '--junit', '--markdown', '--html'] }),
    constraint({ kind: 'mutually_exclusive', options: ['--fast', '--deep'] }),
    constraint({ kind: 'mutually_exclusive', options: ['--summary', '--verbose'] }),
    constraint({ kind: 'requires_all', option: '--save-lookup', requiredOptions: ['--browse'] }),
    constraint({ kind: 'excludes_all', option: '--summary', excludedOptions: ['--json', '--junit', '--markdown', '--html'] }),
    constraint({ kind: 'excludes_all', option: '--verbose', excludedOptions: ['--json', '--junit', '--markdown', '--html'] }),
    constraint({ kind: 'excludes_all', option: '--browse', excludedOptions: ['--json', '--junit', '--markdown', '--html', '--summary', '--verbose', '--events', '--plan', '--quiet'] }),
    constraint({ kind: 'requires_any', option: '--no-attribution', requiredOptions: ['--markdown', '--html'] }),
    constraint({ kind: 'excludes_all', option: '--plan', excludedOptions: ['--junit', '--markdown', '--html', '--summary', '--verbose', '--strict-exit', '--events', '--quiet', '--fail-on'] }),
  ]),
    handlerOwner: 'lookup',
    networkEffect: 'conditional_network',
    common: true,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.lookup', 'whoisleuth.cli.lookup-plan']),
    primaryArtefacts: Object.freeze(['Source-qualified Lookup', 'Lookup request plan']),
    planSupport: true,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  bulk: commandSeed({
    reference: {
      description: 'Triage newline-delimited domains, IPs, or ASNs with bounded concurrency.',
      example: 'cat domains.txt | whoisleuth bulk --jsonl',
      boundary: 'Fast and deep jobs use separate concurrency ceilings. Filters affect output only; collection failures and inconclusive authority states remain explicit in JSON, JSONL, and CSV.',
    },
    collection: { mode: 'network', scope: 'Accepts at most 500 fast or 50 deep targets, with concurrency capped at 8 fast or 3 deep.' },
    summary: 'Run bounded multi-target collection',
    options: ['--json', '--jsonl', '--junit', '--csv', '--domains', '--queries', '--registered-only', '--inconclusive-only', '--errors-only', '--fast', '--deep', '--concurrency', '--checkpoint', '--resume', '--events', '--plan', '--fail-on', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: Object.freeze([
    constraint({ kind: 'mutually_exclusive', options: ['--json', '--jsonl', '--junit', '--csv', '--domains', '--queries'] }),
    constraint({ kind: 'mutually_exclusive', options: ['--registered-only', '--inconclusive-only', '--errors-only'] }),
    constraint({ kind: 'mutually_exclusive', options: ['--fast', '--deep'] }),
    constraint({ kind: 'requires_all', option: '--resume', requiredOptions: ['--checkpoint'] }),
    constraint({ kind: 'excludes_all', option: '--plan', excludedOptions: ['--jsonl', '--junit', '--csv', '--domains', '--queries', '--events', '--checkpoint', '--resume', '--quiet', '--fail-on'] }),
  ]),
    handlerOwner: 'bulk',
    networkEffect: 'conditional_network',
    common: true,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.bulk', 'whoisleuth.cli.bulk.item', 'whoisleuth.cli.bulk-checkpoint']),
    primaryArtefacts: Object.freeze(['Bulk result', 'Bulk checkpoint']),
    planSupport: true,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "ct-search": commandSeed({
    reference: {
      description: 'Search certificate-transparency observations for one bounded keyword.',
      example: 'whoisleuth ct-search "example brand" --json',
      boundary: 'Certificate observations do not prove website activity, registration ownership, or malicious intent.',
    },
    collection: { mode: 'network', scope: 'Accepts one bounded search keyword and queries the fixed certificate-transparency source.' },
    summary: 'Search certificate observations',
    options: ['--json', '--quiet', '--no-color'],
    positionals: Object.freeze([positional('keyword', 'text', 0, 1, [], 'argv_or_stdin')]),
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'network',
    networkEffect: 'always_network',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.ct-search']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "ct-intake": commandSeed({
    reference: {
      description: 'Normalise source-qualified local certificate events into browser-compatible findings.',
      example: 'whoisleuth ct-intake certificate-events.json --json',
      boundary: 'The command is offline, caps output at 100 findings, and treats every event as a review lead rather than proof of serving or control.',
    },
    collection: { mode: 'offline', scope: 'Reads one source-qualified event batch capped at 4 MiB and makes no request.' },
    summary: 'Normalise certificate observations offline',
    options: ['--json', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.ct-event-batch', 'whoisleuth.external-findings']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  discover: commandSeed({
    reference: {
      description: 'Generate bounded lookalike-domain candidates from local mutation rules.',
      example: 'whoisleuth discover example.test --preset common --jsonl',
      boundary: 'Generation and optional local snapshot comparison are offline. Candidates are leads only and are not resolved, registered, or classified as malicious.',
    },
    collection: { mode: 'offline', scope: 'Generates a bounded candidate set from local rules, dictionaries, and optional saved snapshots.' },
    summary: 'Generate lookalike candidates offline',
    options: ['--tlds', '--preset', '--families', '--keyboard', '--dictionary', '--snapshot', '--json', '--jsonl', '--domains', '--quiet', '--no-color'],
    positionals: OPTIONAL_TEXT_POSITIONAL,
    constraints: Object.freeze([
    constraint({ kind: 'mutually_exclusive', options: ['--json', '--jsonl', '--domains'] }),
    constraint({ kind: 'mutually_exclusive', options: ['--preset', '--families'] }),
    constraint({ kind: 'value_excludes', option: '--preset', value: 'common', excludedOptions: ['--dictionary'] }),
  ]),
    handlerOwner: 'discovery',
    networkEffect: 'offline',
    common: true,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.discover', 'whoisleuth.cli.discover.item', 'whoisleuth.cli.discovery-snapshot']),
    primaryArtefacts: Object.freeze(['Candidate set', 'Discovery snapshot']),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "discover-scan": commandSeed({
    reference: {
      description: 'Generate a bounded candidate set, collect a selected subset, and produce a supervised review queue.',
      example: 'whoisleuth discover-scan example.test --scan-limit 50 --checkpoint scan.json --json',
      boundary: 'This command performs network collection. Fast compact lookup is the default; deep mode is capped at 50 candidates. Allowlisting changes review priority only and shared infrastructure remains a lead, not attribution.',
    },
    collection: { mode: 'network', scope: 'Scans at most 500 fast or 50 deep candidates, with concurrency capped at 8 fast or 3 deep.' },
    summary: 'Collect a supervised candidate review queue',
    options: ['--tlds', '--preset', '--families', '--keyboard', '--dictionary', '--fast', '--deep', '--scan-limit', '--chunk-size', '--concurrency', '--resolver', '--allowlist', '--checkpoint', '--resume', '--observation-snapshot', '--registered-only', '--inconclusive-only', '--acquisition-only', '--suppressed-only', '--events', '--plan', '--fail-on', '--json', '--jsonl', '--csv', '--domains', '--quiet', '--no-color'],
    positionals: OPTIONAL_TEXT_POSITIONAL,
    constraints: Object.freeze([
    constraint({ kind: 'mutually_exclusive', options: ['--json', '--jsonl', '--csv', '--domains'] }),
    constraint({ kind: 'mutually_exclusive', options: ['--preset', '--families'] }),
    constraint({ kind: 'mutually_exclusive', options: ['--fast', '--deep'] }),
    constraint({ kind: 'mutually_exclusive', options: ['--registered-only', '--inconclusive-only', '--acquisition-only', '--suppressed-only'] }),
    constraint({ kind: 'requires_all', option: '--resume', requiredOptions: ['--checkpoint'] }),
    constraint({ kind: 'value_excludes', option: '--preset', value: 'common', excludedOptions: ['--dictionary'] }),
    constraint({ kind: 'excludes_all', option: '--plan', excludedOptions: ['--jsonl', '--csv', '--domains', '--events', '--checkpoint', '--resume', '--observation-snapshot', '--quiet', '--fail-on'] }),
  ]),
    handlerOwner: 'discovery_scan',
    networkEffect: 'conditional_network',
    common: true,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.discovery-scan', 'whoisleuth.cli.discovery-scan.item', 'whoisleuth.cli.discovery-observation-snapshot']),
    primaryArtefacts: Object.freeze(['Reviewed candidate queue', 'Observation snapshot']),
    planSupport: true,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  posture: commandSeed({
    reference: {
      description: 'Review bounded DNS mail, delegation, and domain-control posture.',
      example: 'whoisleuth posture example.test --mail-profile standard --json',
      boundary: 'Missing or failed DNS observations remain inconclusive and are not reported as absent controls.',
    },
    collection: { mode: 'network', scope: 'Accepts one domain and performs bounded RDAP, DNS, and conditional MTA-STS HTTPS requests.' },
    summary: 'Review DNS and mail posture',
    options: ['--selectors', '--retired-selectors', '--mail-profile', '--json', '--sarif', '--owned-domain', '--quiet', '--no-color'],
    positionals: Object.freeze([positional('domain', 'text', 0, 1, [], 'argv_or_stdin')]),
    constraints: Object.freeze([
    constraint({ kind: 'mutually_exclusive', options: ['--json', '--sarif'] }),
    constraint({ kind: 'requires_all', option: '--sarif', requiredOptions: ['--owned-domain'] }),
  ]),
    handlerOwner: 'network',
    networkEffect: 'always_network',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.posture']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  http: commandSeed({
    reference: {
      description: 'Inspect one homepage request, redirects, and bounded response metadata.',
      example: 'whoisleuth http example.test --json',
      boundary: 'Requests use the shared public-address and redirect guards. Fixed content-coding and cache-policy metadata describes only the selected response, excludes raw header values, and does not prove caching, transfer savings, performance, privacy, or safety. This is not a rendered browser or vulnerability scan.',
    },
    collection: { mode: 'network', scope: 'Accepts one domain and follows only the bounded SSRF-guarded homepage redirect workflow.' },
    summary: 'Inspect one homepage request',
    options: ['--json', '--quiet', '--no-color'],
    positionals: Object.freeze([positional('domain', 'text', 0, 1, [], 'argv_or_stdin')]),
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'network',
    networkEffect: 'always_network',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.http']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  tls: commandSeed({
    reference: {
      description: 'Inspect one hostname certificate through a bounded TLS connection.',
      example: 'whoisleuth tls example.test --json',
      boundary: 'One observed connection is point-in-time evidence and does not establish every address, edge, or historical certificate.',
    },
    collection: { mode: 'network', scope: 'Accepts one public hostname and opens one bounded certificate connection.' },
    summary: 'Inspect one TLS connection',
    options: ['--json', '--quiet', '--no-color'],
    positionals: Object.freeze([positional('hostname', 'text', 0, 1, [], 'argv_or_stdin')]),
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'network',
    networkEffect: 'always_network',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.tls']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "dnssec-validate": commandSeed({
    reference: {
      description: 'Cryptographically validate one authorised DNSSEC chain from a supplied trust anchor through one selected public resolver.',
      example: 'whoisleuth dnssec-validate example.test --resolver "$PUBLIC_RESOLVER_IP" --trust-anchor anchor.json --owned-or-authorized --json',
      boundary: 'This isolated action is never invoked by Lookup, Bulk, monitoring, or recipes. It caps DNS queries, aliases, delegations, bytes, and duration; transport and validation failures remain separate, and secure is not a general safety verdict.',
    },
    collection: { mode: 'network', scope: 'Accepts one authorised domain, one public resolver IP, and one local trust-anchor file; DNS-over-TCP validation is capped at 32 queries and 15 seconds.' },
    summary: 'Validate an authorised DNSSEC chain',
    options: ['--resolver', '--trust-anchor', '--owned-or-authorized', '--json', '--quiet', '--no-color'],
    positionals: Object.freeze([positional('domain', 'text', 1, 1)]),
    constraints: Object.freeze([
    constraint({ kind: 'required', options: ['--resolver', '--trust-anchor', '--owned-or-authorized'] }),
  ]),
    handlerOwner: 'network',
    networkEffect: 'always_network',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.dnssec-chain-validation', 'whoisleuth.dnssec-trust-anchor']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "mail-transport": commandSeed({
    reference: {
      description: 'Review selected authorised MX endpoints, DNSSEC-qualified TLSA evidence, SMTP capabilities, and optional STARTTLS certificates.',
      example: 'whoisleuth mail-transport selected-mx.json --resolver "$PUBLIC_RESOLVER_IP" --trust-anchor anchor.json --owned-or-authorized --active-probe --json',
      boundary: 'This isolated action probes at most three selected MX hosts sequentially, reports selection, public revalidation, connection, and address authentication separately, sends only EHLO and optional STARTTLS, never retries, and performs no authentication, relay, recipient, mailbox, catch-all, or message test. If a DANE-TA TLSA usage 2 association is published, active collection retains only the leaf certificate and leaves that comparison partial without certificate-path construction and trust-anchor path validation. SMTP relay PKIX-TA usage 0 and PKIX-EE usage 1 records remain unsupported and cannot complete SMTP DANE assurance; a separate usage 3 match remains eligible.',
    },
    collection: { mode: 'network', scope: 'Accepts at most three selected authorised MX hosts, uses one public resolver, and performs sequential bounded SMTP connections with no retries.' },
    summary: 'Review selected authorised SMTP transports',
    options: ['--resolver', '--trust-anchor', '--owned-or-authorized', '--active-probe', '--json', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: Object.freeze([
    constraint({ kind: 'required', options: ['--resolver', '--trust-anchor', '--owned-or-authorized', '--active-probe'] }),
  ]),
    handlerOwner: 'network',
    networkEffect: 'always_network',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.mail-transport.input', 'whoisleuth.cli.mail-transport-review']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "registry-support": commandSeed({
    reference: {
      description: 'Explain the local registry capability profile for one domain or suffix.',
      example: 'whoisleuth registry-support example.test --json',
      boundary: 'This command is offline. Catalogue coverage does not test live reachability or decide registration or availability.',
    },
    collection: { mode: 'offline', scope: 'Reads the embedded registry capability catalogue for one domain or suffix.' },
    summary: 'Explain local registry coverage',
    options: ['--json', '--quiet', '--no-color'],
    positionals: Object.freeze([positional('domain-or-suffix', 'text', 0, 1, [], 'argv_or_stdin')]),
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.registry-support', 'whoisleuth.registry-standards-coverage']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "registry-doctor": commandSeed({
    reference: {
      description: 'Compare a saved Lookup registry result with the reviewed local capability profile.',
      example: 'whoisleuth registry-doctor lookup.json --json',
      boundary: 'The command is offline. It distinguishes expected access constraints from collection results and does not contact a live registry.',
    },
    collection: { mode: 'offline', scope: 'Reads one saved Lookup and the embedded registry capability catalogue.' },
    summary: 'Diagnose saved registry collection',
    options: ['--json', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.registry-doctor']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "registry-cohort": commandSeed({
    reference: {
      description: 'Build privacy-safe suffix and capability-profile timelines from saved observations or retained cohort reports.',
      example: 'whoisleuth registry-cohort saved-lookups.jsonl --json',
      boundary: 'This command is offline and omits domains, queries, and raw evidence. Input families cannot be mixed, and retained samples are never assumed independent.',
    },
    collection: { mode: 'offline', scope: 'Reads at most 500 saved Lookups or retained cohort reports from one unmixed family and emits bounded target-free timelines.' },
    summary: 'Build target-free registry quality timelines',
    options: ['--json', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.registry-cohort']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "registry-scaffold": commandSeed({
    reference: {
      description: 'Create a bounded synthetic WHOIS fixture scaffold for one existing capability profile.',
      example: 'whoisleuth registry-scaffold --profile example-profile --suffix test --scenario registered',
      boundary: 'The output is a sanitised template only. Its command-owned --profile selects fixture capability, --config is rejected, and contributors must not paste live responses or personal registration data into fixtures.',
    },
    collection: { mode: 'offline', scope: 'Reads the embedded registry capability catalogue and prints one synthetic fixture template.' },
    summary: 'Create a sanitised registry fixture scaffold',
    options: ['--profile', '--suffix', '--scenario'],
    positionals: NO_POSITIONALS,
    constraints: Object.freeze([
    constraint({ kind: 'required', options: ['--profile', '--suffix', '--scenario'] }),
  ]),
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze([]),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'command_owned',
  }),
  "risk-calibrate": commandSeed({
    reference: {
      description: 'Replay reviewed labels against the current explainable Risk model.',
      example: 'whoisleuth risk-calibrate calibration.json --summary-json',
      boundary: 'Calibration is offline and diagnostic. The summary form omits record identifiers, domains, and evidence; neither form trains, tunes, or changes the scoring model automatically.',
    },
    collection: { mode: 'offline', scope: 'Reads one bounded reviewed-label dataset and changes no model or evidence.' },
    summary: 'Replay reviewed Risk labels offline',
    options: ['--json', '--summary-json', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: Object.freeze([
    constraint({ kind: 'mutually_exclusive', options: ['--json', '--summary-json'] }),
  ]),
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze([RISK_CALIBRATION_DATASET_SCHEMA, RISK_CALIBRATION_REPORT_SCHEMA]),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "lookalike-calibrate": commandSeed({
    reference: {
      description: 'Summarise reviewed candidate dispositions by mutation family without retaining domains.',
      example: 'whoisleuth lookalike-calibrate reviewed-candidates.json --json',
      boundary: 'Calibration is offline and diagnostic. It omits candidate identifiers, domains, notes, and evidence and never tunes generation or filtering automatically.',
    },
    collection: { mode: 'offline', scope: 'Reads at most 5,000 reviewed candidate labels from one dataset capped at 2 MiB.' },
    summary: 'Summarise reviewed lookalike yield offline',
    options: ['--json', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.lookalike-calibration-input', 'whoisleuth.lookalike-calibration']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "verify-artifact": commandSeed({
    reference: {
      description: 'Validate a supported archive, claim passport, packet, manifest, saved Lookup, or supported Lookup-evidence export without printing evidence contents.',
      example: 'whoisleuth verify-artifact report.json --manifest manifest.json --manifest-entry artifact-2 --json --strict-exit',
      boundary: 'Verification is offline and redacted. Encrypted archives require an explicitly supplied passphrase file; --strict-exit returns 4 when only an envelope or legacy projection integrity was verified.',
    },
    collection: { mode: 'offline', scope: 'Reads one selected bounded artefact and, when explicitly supplied, one manifest whose selected entry is compared by exact bytes and canonical identity.' },
    summary: 'Validate saved evidence offline',
    options: ['--passphrase-file', '--manifest', '--manifest-entry', '--json', '--strict-exit', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: Object.freeze([
    constraint({ kind: 'requires_all', option: '--manifest', requiredOptions: ['--manifest-entry'] }),
    constraint({ kind: 'requires_all', option: '--manifest-entry', requiredOptions: ['--manifest'] }),
  ]),
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: true,
    schemaIdentifiers: Object.freeze(['whoisleuth.offline-artifact-verification']),
    primaryArtefacts: Object.freeze(['Offline verification report']),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "interchange-report": commandSeed({
    reference: {
      description: 'Report what one recognised portable artefact preserves, excludes, and supports across browser and CLI workflows.',
      example: 'whoisleuth interchange-report workspace.json --json',
      boundary: 'The report is offline and metadata-only. It does not echo targets, contacts, notes, passphrases, evidence values, or an unrecognised schema string.',
    },
    collection: { mode: 'offline', scope: 'Reads one selected bounded portable artefact and emits fixed compatibility metadata only.' },
    summary: 'Report portable artefact fidelity offline',
    options: ['--passphrase-file', '--json', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.interchange-fidelity-report']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "inspect-archive": commandSeed({
    reference: {
      description: `Summarise or search one current version-${WORKSPACE_ARCHIVE_VERSION} workspace archive, with exact ${LEGACY_WORKSPACE_ARCHIVE_DESCRIPTION} support and redacted output by default.`,
      example: 'whoisleuth inspect-archive workspace.json --search example.test --json',
      boundary: 'Exact matches require --reveal. Retired and future archive versions are rejected without changing data. The archive is read locally and is never uploaded.',
    },
    collection: { mode: 'offline', scope: `Reads one selected bounded workspace archive v${WORKSPACE_ARCHIVE_VERSION}, retains exact ${LEGACY_WORKSPACE_ARCHIVE_SCOPE} compatibility, and redacts output by default.` },
    summary: 'Inspect an archive locally',
    options: ['--passphrase-file', '--search', '--require-match', '--reveal', '--expect-content-digest', '--json', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: Object.freeze([
    constraint({ kind: 'requires_all', option: '--reveal', requiredOptions: ['--search'] }),
    constraint({ kind: 'requires_all', option: '--require-match', requiredOptions: ['--search'] }),
  ]),
    handlerOwner: 'evidence',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.workspace-archive-inspection']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "sign-artifact": commandSeed({
    reference: {
      description: 'Sign one reviewed response packet or supported manifest with a local private key.',
      example: 'whoisleuth sign-artifact packet.json --private-key-file analyst-private.pem',
      boundary: 'The command never creates, stores, or transmits keys. Key custody and signer identity remain the operator\'s responsibility.',
    },
    collection: { mode: 'offline', scope: 'Reads one selected artefact and one local private key without transmitting either.' },
    summary: 'Sign a reviewed artefact locally',
    options: ['--private-key-file'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: Object.freeze([
    constraint({ kind: 'required', options: ['--private-key-file'] }),
  ]),
    handlerOwner: 'evidence',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.signed-evidence-package']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "verify-signature": commandSeed({
    reference: {
      description: 'Verify the cryptographic signature of one signed evidence package and report embedded-artefact assurance separately.',
      example: 'whoisleuth verify-signature packet.signed.json --json',
      boundary: 'A valid signature proves package consistency for the embedded key. It does not upgrade failed or unsupported embedded-artefact assurance or establish the holder\'s real-world identity or authority.',
    },
    collection: { mode: 'offline', scope: 'Reads one selected signed package and optional local public key.' },
    summary: 'Verify a signed evidence package',
    options: ['--public-key-file', '--json', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'evidence',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.evidence-signature-verification']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "source-report": commandSeed({
    reference: {
      description: 'Create a target-free reliability summary from a saved lookup.',
      example: 'whoisleuth source-report lookup.json --json',
      boundary: 'The report retains source states and timings but excludes targets, queries, endpoints, and raw evidence.',
    },
    collection: { mode: 'offline', scope: 'Reads bounded saved evidence and emits target-free source reliability data.' },
    summary: 'Build a target-free source report',
    options: ['--json', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.source-reliability-report']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  compare: commandSeed({
    reference: {
      description: 'Compare separately attributed registry publications in a saved lookup.',
      example: 'whoisleuth compare lookup.json --json',
      boundary: 'Comparison is offline. Differences are review context and do not by themselves prove which publication is current.',
    },
    collection: { mode: 'offline', scope: 'Reads one saved Lookup and compares its separately attributed registry publications.' },
    summary: 'Compare registry publications in one lookup',
    options: ['--json', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.compare']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "page-compare": commandSeed({
    reference: {
      description: 'Compare static page identity, favicon, technology, and TLS evidence in two saved deep lookups.',
      example: 'whoisleuth page-compare official.json candidate.json --json',
      boundary: 'Comparison is offline and component-based. It executes no page code and produces no aggregate similarity or maliciousness score.',
    },
    collection: { mode: 'offline', scope: 'Reads two saved Lookup documents and executes no page code.' },
    summary: 'Compare saved static page evidence',
    options: ['--json', '--quiet', '--no-color'],
    positionals: Object.freeze([positional('sources', 'file', 2, 2)]),
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.page-compare']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "mail-review": commandSeed({
    reference: {
      description: 'Review passive MX, null MX, SPF, DMARC, and shared mail-provider evidence from saved Bulk results.',
      example: 'whoisleuth mail-review candidates.json --json',
      boundary: 'Review is offline and sends no SMTP traffic. Missing or partial DNS evidence remains inconclusive.',
    },
    collection: { mode: 'offline', scope: 'Reads one saved Bulk result and sends no DNS or SMTP traffic.' },
    summary: 'Review saved passive mail evidence',
    options: ['--json', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.mail-review']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "mail-headers": commandSeed({
    reference: {
      description: 'Review identity, reported authentication, domain alignment, and Received routing from selected message headers.',
      example: 'whoisleuth mail-headers message.eml --json',
      boundary: 'Review is offline. It makes no DNS, SMTP, HTTP, registry, or provider request, and does not retain address local parts, display names, subjects, message bodies, attachments, or raw header values. Reported authentication is not independently validated.',
    },
    collection: { mode: 'offline', scope: 'Parses only the bounded header block from one selected message or standard input.' },
    summary: 'Review message headers offline',
    options: ['--json', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.mail-header-review']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "review-evidence": commandSeed({
    reference: {
      description: 'Review one versioned DNS, domain-change, routing, GeoIP, RDAP, or trust-store document offline.',
      example: 'whoisleuth review-evidence domain-change.json --json --strict-exit',
      boundary: 'The command reads only the supplied document. It performs no DNS, RDAP, BGP, GeoIP-provider, TLS, HTTP, certificate-authority, or SMTP request.',
    },
    collection: { mode: 'offline', scope: 'Reads one bounded versioned evidence or request-planning document and performs no collection.' },
    summary: 'Review supplied evidence offline',
    options: ['--mmdb', '--json', '--strict-exit', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: true,
    schemaIdentifiers: Object.freeze([
    'whoisleuth.cli.offline-evidence-review',
    'whoisleuth.rdap-search-input',
    'whoisleuth.dnssec-evidence-input',
    'whoisleuth.tlsa-evidence-input',
    'whoisleuth.rpki-route-input',
    'whoisleuth.local-geoip-query',
    'whoisleuth.encrypted-dns-plan-input',
  ]),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  brief: commandSeed({
    reference: {
      description: 'Turn one saved Lookup into a compact decision brief with facts, unknowns, contradictions, and next actions.',
      example: 'whoisleuth brief lookup.json --json',
      boundary: 'The command is offline, excludes raw upstream payloads, and does not create an analyst assertion or claim that the saved observation is current.',
    },
    collection: { mode: 'offline', scope: 'Reads one bounded saved Lookup and emits a compact source-attributed decision brief.' },
    summary: 'Build a decision brief from a saved lookup',
    options: ['--json', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.lookup-brief']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "case-pack": commandSeed({
    reference: {
      description: `Package browser-created Case-schema-${CASE_SCHEMA_VERSION} records as a reviewed, audience-specific Case-pack v2.`,
      example: 'whoisleuth case-pack cases.json --audience trusted --reviewed --json',
      boundary: 'The command is an offline handoff from the browser Case workflow: it creates a new package, never creates or mutates a durable Case, never mutates the source archive, and requires an explicit review acknowledgement.',
    },
    collection: { mode: 'offline', scope: `Reads one bounded Case-schema-${CASE_SCHEMA_VERSION} browser export and writes a separate audience-specific Case-pack v2.` },
    summary: 'Build a reviewed case package',
    options: ['--audience', '--reviewed', '--json', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: Object.freeze([
    constraint({ kind: 'required', options: ['--audience', '--reviewed'] }),
  ]),
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: true,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.case-pack', 'whoisleuth.case-report']),
    primaryArtefacts: Object.freeze(['Reviewed Case-pack v2']),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "domain-control": commandSeed({
    reference: {
      description: 'Build an integrity-protected desired-state manifest or compare one with supplied observations.',
      example: 'whoisleuth domain-control domain-control-input.json --json',
      boundary: 'The command is offline and changes no registrar, DNS, mail, or certificate configuration. Only complete supplied observations can produce drift.',
    },
    collection: { mode: 'offline', scope: 'Reads one bounded desired-state or review document and performs no collection or configuration change.' },
    summary: 'Build or review a domain control manifest',
    options: ['--json', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.domain-control-review-input', 'whoisleuth.cli.domain-control-review']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "monitor-once": commandSeed({
    reference: {
      description: 'Collect one bounded owned-domain review and compare it with an optional prior checkpoint.',
      example: 'whoisleuth monitor-once manifest.json --previous previous.json --json --output next.json',
      boundary: 'This is an operator-scheduled one-shot collection, not a daemon. It caps targets and concurrency, retains normalised observations, and never changes domain configuration.',
    },
    collection: { mode: 'network', scope: 'Runs deep collection for at most 20 manifest domains with concurrency capped at 3.' },
    summary: 'Run one bounded domain control review',
    options: ['--previous', '--limit', '--concurrency', '--fail-on', '--json', '--junit', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: Object.freeze([
    constraint({ kind: 'mutually_exclusive', options: ['--json', '--junit'] }),
  ]),
    handlerOwner: 'inline',
    networkEffect: 'always_network',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.domain-control-monitor', 'whoisleuth.domain-control-flight-recorder.input']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  assurance: commandSeed({
    reference: {
      description: 'Review a versioned domain change, recovery-dependency, or retirement plan.',
      example: 'whoisleuth assurance domain-assurance.json --json',
      boundary: 'The command is offline and treats every provider label, readiness state, and evidence reference as analyst-authored input. It changes no configuration.',
    },
    collection: { mode: 'offline', scope: 'Reads one versioned plan capped at 2 MiB and makes no request or configuration change.' },
    summary: 'Review domain change, recovery, or retirement plans',
    options: ['--json', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.domain-assurance.input', 'whoisleuth.domain-assurance']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "change-packet": commandSeed({
    reference: {
      description: 'Assemble pre-change, post-change, and planning evidence into one integrity-protected packet.',
      example: 'whoisleuth change-packet change-review.json --json',
      boundary: 'Assembly is offline. Readiness reflects only the supplied bounded evidence and does not authorise or perform a domain change.',
    },
    collection: { mode: 'offline', scope: 'Reads one versioned packet input capped at 6 MiB and makes no request or configuration change.' },
    summary: 'Build a reviewed change packet offline',
    options: ['--json', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.domain-change-packet.input', 'whoisleuth.domain-change-packet']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "sharing-review": commandSeed({
    reference: {
      description: 'Lint one reviewed artefact against local integrity, marking, recipient, personal-data, and redaction controls.',
      example: 'whoisleuth sharing-review packet.json --marking amber --recipient-scope organization --purpose "Reviewed incident handoff" --human-reviewed --personal-data-reviewed --redactions-confirmed --json',
      boundary: 'The command is offline and emits only bounded schema/version metadata, no content values, and no raw evidence. Its result is a review aid, not legal advice or recipient authorisation.',
    },
    collection: { mode: 'offline', scope: 'Reads one artefact capped at 15 MiB, emits only bounded schema/version metadata and no content values, and performs no transmission.' },
    summary: 'Lint an artefact before deliberate sharing',
    options: ['--marking', '--recipient-scope', '--purpose', '--human-reviewed', '--personal-data-reviewed', '--redactions-confirmed', '--json', '--quiet', '--no-color'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: Object.freeze([
    constraint({ kind: 'required', options: ['--marking', '--recipient-scope', '--purpose'] }),
  ]),
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.sharing-review']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "workflow-plan": commandSeed({
    reference: {
      description: 'Build a fixed domain-investigation plan from existing bounded CLI commands.',
      example: 'whoisleuth workflow-plan domain-triage example.test --json',
      boundary: 'Planning is offline and plan-only. It does not execute commands, expand placeholders, read files, make requests, or submit evidence.',
    },
    collection: { mode: 'offline', scope: 'Builds a fixed typed recipe and executes none of its network or file steps.' },
    summary: 'Plan a fixed investigation recipe',
    options: ['--list', '--explain', '--json', '--quiet', '--no-color'],
    positionals: Object.freeze([
    positional('recipe', 'enum', 0, 1, INVESTIGATION_PLAN_RECIPES),
    positional('subject', 'text', 0, 1),
  ]),
    constraints: Object.freeze([
    constraint({ kind: 'mutually_exclusive', options: ['--list', '--explain'] }),
  ]),
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: true,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.investigation-plan', 'whoisleuth.cli.workflow-recipe-catalogue']),
    primaryArtefacts: Object.freeze(['Plan-only workflow document']),
    planSupport: true,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  "workflow-run": commandSeed({
    reference: {
      description: 'Execute approved steps from a fixed investigation recipe and emit a resumable checkpoint.',
      example: 'whoisleuth workflow-run domain-triage example.test --resume run.json --select export=saved-lookup.json --json --output run-next.json',
      boundary: 'Only installed recipe commands can run. Network steps require explicit approval for each invocation. Repeat --select in placeholder order for one step; each bounded value replaces one exact placeholder and cannot start with a hyphen, become an option, or invoke a shell.',
    },
    collection: { mode: 'network', scope: 'Runs only fixed-recipe steps; network collection requires --approve-network and unresolved analyst selections pause.' },
    summary: 'Execute approved fixed-recipe steps',
    options: ['--select', '--approve-network', '--resume', '--json', '--quiet', '--no-color'],
    positionals: Object.freeze([
    positional('recipe', 'enum', 1, 1, RUNNABLE_INVESTIGATION_PLAN_RECIPES),
    positional('subject', 'text', 1, 1),
  ]),
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'conditional_network',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.investigation-run']),
    primaryArtefacts: Object.freeze(['Resumable workflow state']),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  diff: commandSeed({
    reference: {
      description: 'Compare an earlier and later artefact from the same retained Lookup, Bulk-session, or domain-portfolio family.',
      example: 'whoisleuth diff earlier.json later.json --json',
      boundary: 'Comparison is offline: the left input is earlier and the right input is later. Inputs must belong to the same supported family. For a multi-session Bulk export, --left-session selects a session from the left file and --right-session selects one from the right; missing, unavailable, equal, and different evidence remain separate states.',
    },
    collection: { mode: 'offline', scope: 'Reads two compatible retained artefacts capped at 8 MiB each and retains no source paths.' },
    summary: 'Compare two compatible retained artefacts',
    options: ['--left-session', '--right-session', '--json', '--quiet', '--no-color'],
    positionals: Object.freeze([positional('sources', 'file', 2, 2)]),
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: true,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.lookup-diff']),
    primaryArtefacts: Object.freeze(['Retained-evidence comparison']),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  reconcile: commandSeed({
    reference: {
      description: 'Reconcile bounded values across independently labelled observations of one domain.',
      example: 'whoisleuth reconcile office.json mobile.json external.json --json',
      boundary: 'The command is offline, accepts 2 to 5 saved observations for one domain, and never treats labels as proof of network independence or majority agreement as truth.',
    },
    collection: { mode: 'offline', scope: 'Reads 2 to 5 saved observations for one domain, capped at 32 MiB in total.' },
    summary: 'Reconcile independently labelled observations',
    options: ['--json', '--quiet', '--no-color'],
    positionals: Object.freeze([positional('sources', 'file', 2, 5)]),
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.lookup-reconciliation']),
    primaryArtefacts: Object.freeze([]),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  timeline: commandSeed({
    reference: {
      description: 'Build an ordered same-domain history from saved Lookup observations.',
      example: 'whoisleuth timeline first.json second.json latest.json --json',
      boundary: 'The command is offline, accepts 2 to 20 bounded inputs for one domain, retains no filenames or raw registry payloads, and does not treat changed collection conditions as a domain change.',
    },
    collection: { mode: 'offline', scope: 'Reads 2 to 20 saved observations for one domain, capped at 32 MiB in total.' },
    summary: 'Build same-domain history from saved lookups',
    options: ['--json', '--quiet', '--no-color'],
    positionals: Object.freeze([positional('sources', 'file', 2, 20)]),
    constraints: EMPTY_CONSTRAINTS,
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: false,
    schemaIdentifiers: Object.freeze(['whoisleuth.cli.lookup-timeline']),
    primaryArtefacts: Object.freeze(['Bounded retained-observation timeline']),
    planSupport: false,
    additionalOutputFormats: Object.freeze([]),
    bootstrapProfile: 'allowed',
  }),
  export: commandSeed({
    reference: {
      description: 'Convert one saved lookup into a versioned evidence report.',
      example: 'whoisleuth export lookup.json --markdown',
      boundary: `Saved Lookup versions 1 and 2 are capped at 8 MiB and scanned for duplicate keys, the prototype-sensitive __proto__ key, and bounded nesting, key, value, and per-container counts before parsing. Current schema-${LOOKUP_EVIDENCE_SCHEMA_VERSION} exports preserve evidence-source attribution and limitations; published v2 schema ${PUBLISHED_V2_LOOKUP_EVIDENCE_SCHEMA_VERSION} and exact v1 schema ${V1_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION} remain readable, while other historical and unreleased shapes are unsupported. Markdown and HTML include a presentation-only generator footer unless --no-attribution is selected; JSON retains bounded generator provenance. Compact output intentionally omits raw registry payloads.`,
    },
    collection: { mode: 'offline', scope: 'Reads one saved Lookup and writes one bounded report.' },
    summary: 'Convert a lookup to an evidence report',
    options: ['--markdown', '--html', '--compact', '--no-attribution'],
    positionals: OPTIONAL_FILE_POSITIONAL,
    constraints: Object.freeze([
    constraint({ kind: 'mutually_exclusive', options: ['--markdown', '--html'] }),
    constraint({ kind: 'excludes_all', option: '--compact', excludedOptions: ['--markdown', '--html'] }),
    constraint({ kind: 'requires_any', option: '--no-attribution', requiredOptions: ['--markdown', '--html'] }),
  ]),
    handlerOwner: 'inline',
    networkEffect: 'offline',
    common: true,
    schemaIdentifiers: Object.freeze(['whoisleuth.lookup-evidence']),
    primaryArtefacts: Object.freeze(['Portable evidence report']),
    planSupport: false,
    additionalOutputFormats: Object.freeze(['JSON']),
    bootstrapProfile: 'allowed',
  }),
} satisfies Readonly<Record<CliCommand, CliCommandSeed>>);

const COMMAND_ORDER = Object.freeze(Object.keys(COMMAND_SEEDS)) as readonly CliCommand[];
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
  const outputOptionFormats = [
    ['--json', 'JSON'], ['--jsonl', 'JSON Lines'], ['--junit', 'JUnit XML'],
    ['--csv', 'CSV'], ['--domains', 'domain list'], ['--queries', 'query list'],
    ['--markdown', 'Markdown'], ['--html', 'HTML'], ['--sarif', 'SARIF'],
    ['--summary-json', 'summary JSON'],
  ] as const;
  const outputFormats = new Set<string>(['terminal']);
  for (const [option, label] of outputOptionFormats) {
    if (commandOptions.includes(option)) outputFormats.add(label);
  }
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
    primaryEvidenceArtefacts: seed.primaryArtefacts,
  });
}

function optionUsage(specification: CliOptionSpec): string {
  if (specification.arity === 0) return specification.option;
  if (specification.valueKind === 'enum') {
    return `${specification.option} <${specification.values.join('|')}>`;
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
    const commonOptions = Object.freeze([...commonOptionsSeedForCommand(command)]);
    const commandOptions = seed.options;
    const grammarOptions = Object.freeze([
      ...commonOptions.map((option) => optionSpec(command, option, 'common')),
      ...commandOptions.map((option) => optionSpec(command, option, 'command')),
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
        handlerOwner: seed.handlerOwner,
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

function cliMetaActionForInvocation(argv: readonly string[]): CliMetaAction | null {
  for (const action of CLI_META_ACTIONS) {
    const matches = action.scope === 'root_only'
      ? action.aliases.includes(argv[0] ?? '')
      : argv.some((argument) => action.aliases.includes(argument));
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
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === flag) return true;
    const specification = argument ? commandOptionSpec(command, argument) : null;
    if (specification?.arity === 1) index += 1;
  }
  return false;
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
  return `WHOISleuth ${command}\n${detail.description}\n\nUsage:\n  ${COMMAND_USAGE[command]}\n\nExample:\n  ${detail.example}\n\nCollection:\n  ${collection.mode === 'offline' ? 'Offline' : 'Network'}: ${collection.scope}\n\nBoundary:\n  ${detail.boundary}\n\nRun "whoisleuth --help" to see the grouped command list.\n`;
}

export {
  CLI_COMMAND_REGISTRY,
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
