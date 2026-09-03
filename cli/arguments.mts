import {
  parseInspectArchiveArguments,
  parseSignArtifactArguments,
  parseVerifySignatureArguments,
  type InspectArchiveArguments,
  type SignArtifactArguments,
  type VerifySignatureArguments,
} from './evidence-command-arguments.mts';
import { CliUsageError, hasUnsafeCliText } from './errors.mts';
import {
  INVESTIGATION_PLAN_RECIPES,
  RUNNABLE_INVESTIGATION_PLAN_RECIPES,
  type InvestigationPlanRecipe,
  type RunnableInvestigationPlanRecipe,
} from './investigation-plan.mts';
import { parseCliFailPolicies, type CliFailPolicy } from './fail-policy.mts';
import { isDirectLookupTarget } from '../lib/classify.mts';
import {
  CLI_COMMANDS,
  cliMetaActionForInvocation,
  isCliCommand,
  type CliCommand,
  type CliHelpGroup,
  type CompletionShell,
} from './command-reference.mts';

const MAX_CLI_ARGUMENTS = 32;
const MAX_CLI_ARGUMENT_LENGTH = 1024;
type TerminalOptions = {
  quiet: boolean;
  color: boolean;
};

type LookupDetail = 'summary' | 'standard' | 'verbose';
type CliPalette = 'auto' | 'light' | 'dark';
type FileOutputOptions = { destination?: string; force?: true; palette?: CliPalette };

type CliAction =
  | { action: 'help'; command?: CliCommand }
  | { action: 'version' }
  | ({ action: 'completion'; shell: CompletionShell })
  | ({ action: 'commands'; output: 'terminal' | 'json'; common: boolean; group: CliHelpGroup | null; mode: 'offline' | 'network' | null } & TerminalOptions)
  | ({ action: 'manual' })
  | ({ action: 'manifest'; sources: readonly string[]; workflow: string; configurationDigestSha256: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'map-observations'; source: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'oam-export'; source: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'doctor'; network: boolean; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'lookup'; query: string | null; output: 'terminal' | 'json' | 'markdown' | 'html' | 'junit'; deep: boolean; detail: LookupDetail; strictExit: boolean; events: boolean; plan: boolean; includeAttribution: boolean; observerLabel: string | null; vantageLabel: string | null; browse?: true; saveLookup?: string; failOn?: readonly CliFailPolicy[] } & TerminalOptions)
  | ({ action: 'bulk'; source: string | null; output: 'terminal' | 'json' | 'jsonl' | 'csv' | 'domains' | 'queries' | 'junit'; deep: boolean; concurrency: number; checkpoint: string | null; resume: boolean; events: boolean; plan: boolean; filter: 'all' | 'registered' | 'inconclusive' | 'errors'; failOn?: readonly CliFailPolicy[] } & TerminalOptions)
  | ({ action: 'ct-search'; keyword: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'ct-intake'; source: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'discover'; seed: string | null; output: 'terminal' | 'json' | 'jsonl' | 'domains'; preset: 'common' | 'impersonation' | 'all' | 'custom'; keyboardLayout: 'qwerty' | 'azerty' | 'qwertz' | 'all'; tldText: string | null; dictionarySource: string | null; familyText: string | null; snapshotSource: string | null } & TerminalOptions)
  | ({ action: 'discover-scan'; seed: string | null; output: 'terminal' | 'json' | 'jsonl' | 'csv' | 'domains'; preset: 'common' | 'impersonation' | 'all' | 'custom'; keyboardLayout: 'qwerty' | 'azerty' | 'qwertz' | 'all'; tldText: string | null; dictionarySource: string | null; familyText: string | null; deep: boolean; scanLimit: number; chunkSize: number; concurrency: number; checkpoint: string | null; resume: boolean; resolverText: string | null; observationSnapshot: string | null; allowlistSource: string | null; filter: 'all' | 'registered' | 'inconclusive' | 'acquisition' | 'suppressed'; events: boolean; plan: boolean; failOn?: readonly CliFailPolicy[] } & TerminalOptions)
  | ({ action: 'posture'; domain: string | null; output: 'terminal' | 'json' | 'sarif'; selectorText: string | null; retiredSelectorText: string | null; mailProfile: 'defensive_no_mail' | 'parked' | 'standard'; ownedDomain: boolean } & TerminalOptions)
  | ({ action: 'http'; domain: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'tls'; hostname: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'dnssec-validate'; target: string; resolver: string; trustAnchorSource: string; ownedOrAuthorized: true; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'mail-transport'; source: string | null; resolver: string; trustAnchorSource: string; ownedOrAuthorized: true; activeProbeAcknowledged: true; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'registry-support'; target: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'registry-doctor'; source: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'registry-cohort'; source: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | { action: 'registry-scaffold'; profile: string; suffix: string; scenario: 'registered' | 'not_found' | 'inconclusive' }
  | ({ action: 'risk-calibrate'; source: string | null; output: 'terminal' | 'json' | 'summary_json' } & TerminalOptions)
  | ({ action: 'lookalike-calibrate'; source: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'verify-artifact'; source: string | null; passphraseSource: string | null; manifestSource: string | null; manifestEntryId: string | null; output: 'terminal' | 'json'; strictExit: boolean } & TerminalOptions)
  | ({ action: 'interchange-report'; source: string | null; passphraseSource: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | InspectArchiveArguments
  | SignArtifactArguments
  | VerifySignatureArguments
  | ({ action: 'source-report'; source: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'compare'; source: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'page-compare'; leftSource: string; rightSource: string; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'mail-review'; source: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'review-evidence'; source: string | null; mmdbSource: string | null; output: 'terminal' | 'json'; strictExit: boolean } & TerminalOptions)
  | ({ action: 'brief'; source: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'case-pack'; source: string | null; output: 'terminal' | 'json'; audience: 'internal' | 'trusted' | 'public'; reviewed: true } & TerminalOptions)
  | ({ action: 'domain-control'; source: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'monitor-once'; source: string | null; previousSource: string | null; output: 'terminal' | 'json' | 'junit'; limit: number; concurrency: number; failOn?: readonly CliFailPolicy[] } & TerminalOptions)
  | ({ action: 'assurance'; source: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'change-packet'; source: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'sharing-review'; source: string | null; output: 'terminal' | 'json'; marking: 'clear' | 'green' | 'amber' | 'amber-strict' | 'red'; recipientScope: 'public' | 'community' | 'organization' | 'named-recipients'; purpose: string; humanReviewed: boolean; personalDataReviewed: boolean; redactionsConfirmed: boolean } & TerminalOptions)
  | ({ action: 'workflow-plan'; recipe: InvestigationPlanRecipe; subject: string; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'workflow-plan'; discovery: 'list'; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'workflow-plan'; discovery: 'explain'; recipe: InvestigationPlanRecipe; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'workflow-run'; recipe: RunnableInvestigationPlanRecipe; subject: string; resumeSource: string | null; selections: readonly Readonly<{ stepId: string; value: string }>[]; approveNetwork: boolean; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'diff'; leftSource: string; rightSource: string; leftSessionId: string | null; rightSessionId: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'reconcile'; sources: readonly string[]; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'timeline'; sources: readonly string[]; output: 'terminal' | 'json' } & TerminalOptions)
  | { action: 'export'; source: string | null; format: 'json' | 'markdown' | 'html'; compact: boolean; includeAttribution: boolean };
type CliArguments = CliAction & FileOutputOptions;

type ExtractedFileOutput = {
  argv: string[];
  destination: string | null;
  force: boolean;
  palette: CliPalette | null;
};

function boundedArgument(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_CLI_ARGUMENT_LENGTH || hasUnsafeCliText(value)) {
    throw new CliUsageError('Arguments must be bounded text without control characters.');
  }
  return value;
}

function extractFileOutputArguments(argv: string[]): ExtractedFileOutput {
  const retained: string[] = [];
  let destination: string | null = null;
  let force = false;
  let palette: CliPalette | null = null;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === undefined) break;
    if (index > 0 && argument === '--output') {
      if (destination !== null) throw new CliUsageError('--output may be supplied only once.');
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError('--output requires one bounded file path.');
      destination = value;
    } else if (index > 0 && argument === '--force') {
      if (force) throw new CliUsageError('--force may be supplied only once.');
      force = true;
    } else if (index > 0 && argument === '--palette') {
      if (palette !== null) throw new CliUsageError('--palette may be supplied only once.');
      const value = argv[++index];
      if (value !== 'auto' && value !== 'light' && value !== 'dark') {
        throw new CliUsageError('--palette requires auto, light, or dark.');
      }
      palette = value;
    } else {
      retained.push(argument);
    }
  }
  if (force && destination === null) throw new CliUsageError('--force requires --output.');
  return { argv: retained, destination, force, palette };
}

function parseCliArguments(rawArgv: unknown): CliArguments {
  if (!Array.isArray(rawArgv) || rawArgv.length > MAX_CLI_ARGUMENTS) {
    throw new CliUsageError(`At most ${MAX_CLI_ARGUMENTS} command arguments are supported.`);
  }
  const boundedArguments = rawArgv.map(boundedArgument);
  const metaAction = cliMetaActionForInvocation(boundedArguments);
  if (metaAction) return parseCliArgumentsCore(boundedArguments);
  const extracted = extractFileOutputArguments(boundedArguments);
  const parsed = parseCliArgumentsCore(extracted.argv);
  if ('quiet' in parsed && parsed.quiet && extracted.destination !== null) {
    throw new CliUsageError('--quiet cannot be combined with --output.');
  }
  if ('events' in parsed && parsed.events && extracted.destination !== null) {
    throw new CliUsageError('--events cannot be combined with --output because completion must describe the final output delivery.');
  }
  if ('browse' in parsed && parsed.browse === true && extracted.destination !== null) {
    throw new CliUsageError('--browse cannot be combined with --output because it requires an interactive terminal.');
  }
  return {
    ...parsed,
    ...(extracted.destination !== null ? { destination: extracted.destination } : {}),
    ...(extracted.force ? { force: true as const } : {}),
    ...(extracted.palette ? { palette: extracted.palette } : {}),
  };
}

function parseCliArgumentsCore(argv: string[]): CliAction {
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
  const parsed = CLI_PARSERS[command](directLookup ? argv : argv.slice(1));
  if (parsed.action !== command) {
    throw new Error(`CLI parser contract mismatch for ${command}.`);
  }
  return parsed;
}

function parseLookupArguments(
  lookupArguments: string[],
): Extract<CliArguments, { action: 'lookup' }> {
  let query: string | null = null;
  let output: 'terminal' | 'json' | 'markdown' | 'html' | 'junit' = 'terminal';
  let deep = false;
  let scanMode: 'fast' | 'deep' | null = null;
  let quiet = false;
  let color = true;
  let detail: LookupDetail = 'standard';
  let detailSet = false;
  let strictExit = false;
  let events = false;
  let plan = false;
  let browse = false;
  let includeAttribution = true;
  let failOn: CliFailPolicy[] | null = null;
  let observerLabel: string | null = null;
  let vantageLabel: string | null = null;
  let saveLookup: string | null = null;
  for (let index = 0; index < lookupArguments.length; index++) {
    const argument = lookupArguments[index];
    if (argument === undefined) break;
    if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('Choose only one output format.');
      output = 'json';
    } else if (argument === '--junit') {
      if (output !== 'terminal') throw new CliUsageError('Choose only one output format.');
      output = 'junit';
    } else if (argument === '--markdown' || argument === '--html') {
      if (output !== 'terminal') throw new CliUsageError('Choose only one output format.');
      output = argument === '--markdown' ? 'markdown' : 'html';
    } else if (argument === '--deep') {
      if (scanMode) throw new CliUsageError('--fast and --deep are mutually exclusive and may be supplied only once.');
      deep = true;
      scanMode = 'deep';
    } else if (argument === '--fast') {
      if (scanMode) throw new CliUsageError('--fast and --deep are mutually exclusive and may be supplied only once.');
      deep = false;
      scanMode = 'fast';
    } else if (argument === '--summary' || argument === '--verbose') {
      if (detailSet) throw new CliUsageError('--summary and --verbose are mutually exclusive and may be supplied only once.');
      detail = argument === '--summary' ? 'summary' : 'verbose';
      detailSet = true;
    } else if (argument === '--strict-exit') {
      if (strictExit) throw new CliUsageError('--strict-exit may be supplied only once.');
      strictExit = true;
    } else if (argument === '--events') {
      if (events) throw new CliUsageError('--events may be supplied only once.');
      events = true;
    } else if (argument === '--plan') {
      if (plan) throw new CliUsageError('--plan may be supplied only once.');
      plan = true;
    } else if (argument === '--browse') {
      if (browse) throw new CliUsageError('--browse may be supplied only once.');
      browse = true;
    } else if (argument === '--save-lookup') {
      if (saveLookup !== null) throw new CliUsageError('--save-lookup may be supplied only once.');
      const value = lookupArguments[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError('--save-lookup requires one bounded file path.');
      saveLookup = value;
    } else if (argument === '--no-attribution') {
      if (!includeAttribution) throw new CliUsageError('--no-attribution may be supplied only once.');
      includeAttribution = false;
    } else if (argument === '--fail-on') {
      if (failOn !== null) throw new CliUsageError('--fail-on may be supplied only once.');
      failOn = parseCliFailPolicies(lookupArguments[++index], 'lookup');
    } else if (argument === '--observer' || argument === '--vantage') {
      const isObserver = argument === '--observer';
      if (isObserver ? observerLabel !== null : vantageLabel !== null) {
        throw new CliUsageError(`${argument} may be supplied only once.`);
      }
      const value = lookupArguments[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError(`${argument} requires one bounded label.`);
      const normalized = value.replace(/\s+/gu, ' ').trim();
      if (!normalized || normalized.length > 80) throw new CliUsageError(`${argument} requires a label of at most 80 characters.`);
      if (isObserver) observerLabel = normalized;
      else vantageLabel = normalized;
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (query === null) query = argument;
    else throw new CliUsageError('lookup accepts one query. Use the bulk command for multiple inputs.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  if (detailSet && output !== 'terminal') throw new CliUsageError('--summary and --verbose apply only to terminal output.');
  if (browse && output !== 'terminal') throw new CliUsageError('--browse applies only to terminal output.');
  if (browse && (detailSet || events || plan || quiet)) {
    throw new CliUsageError('--browse cannot be combined with detail, event, plan, or quiet options.');
  }
  if (browse && query === null) {
    throw new CliUsageError('--browse requires a positional target because interactive stdin is reserved for navigation.');
  }
  if (saveLookup !== null && !browse) {
    throw new CliUsageError('--save-lookup requires --browse so the exact completed Lookup document is saved after the browser closes.');
  }
  if (!includeAttribution && output !== 'markdown' && output !== 'html') {
    throw new CliUsageError('--no-attribution applies only to Markdown or HTML reports.');
  }
  if (plan && !['terminal', 'json'].includes(output)) throw new CliUsageError('--plan supports terminal or JSON output only.');
  if (plan && (detailSet || strictExit || events || quiet || failOn !== null)) {
    throw new CliUsageError('--plan cannot be combined with detail, strict-exit, event, or quiet options.');
  }
  return { action: 'lookup', query, output, deep, detail, strictExit, events, plan, includeAttribution, observerLabel, vantageLabel, quiet, color, ...(browse ? { browse: true as const } : {}), ...(saveLookup ? { saveLookup } : {}), ...(failOn ? { failOn } : {}) };
}

function parseCompletionArguments(argv: string[]): Extract<CliArguments, { action: 'completion' }> {
  if (argv.length !== 1 || !['bash', 'zsh', 'fish', 'powershell'].includes(argv[0] || '')) {
    throw new CliUsageError('completion requires exactly one shell: bash, zsh, fish, or powershell.');
  }
  return { action: 'completion', shell: argv[0] as CompletionShell };
}

function parseManualArguments(argv: string[]): Extract<CliArguments, { action: 'manual' }> {
  if (argv.length !== 0) throw new CliUsageError('manual does not accept command arguments.');
  return { action: 'manual' };
}

function parseManifestArguments(argv: string[]): Extract<CliArguments, { action: 'manifest' }> {
  const sources: string[] = [];
  let workflow: string | null = null;
  let configurationDigestSha256: string | null = null;
  let output: 'terminal' | 'json' = 'terminal';
  let quiet = false;
  let color = true;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('--json may be supplied only once.');
      output = 'json';
    } else if (argument === '--workflow') {
      if (workflow !== null) throw new CliUsageError('--workflow may be supplied only once.');
      workflow = argv[++index] ?? null;
      if (!workflow) throw new CliUsageError('--workflow requires a bounded label.');
    } else if (argument === '--configuration-digest') {
      if (configurationDigestSha256 !== null) throw new CliUsageError('--configuration-digest may be supplied only once.');
      configurationDigestSha256 = argv[++index] ?? null;
      if (!configurationDigestSha256 || !/^sha256:[a-f0-9]{64}$/u.test(configurationDigestSha256)) {
        throw new CliUsageError('--configuration-digest requires a sha256: hexadecimal digest.');
      }
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument?.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (argument) sources.push(argument);
  }
  if (!workflow) throw new CliUsageError('manifest requires --workflow <label>.');
  if (sources.length < 1 || sources.length > 16) throw new CliUsageError('manifest requires from 1 to 16 JSON artefact files.');
  if (new Set(sources).size !== sources.length) throw new CliUsageError('manifest artefact files must be different.');
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'manifest', sources, workflow, configurationDigestSha256, output, quiet, color };
}

type SingleJsonInput = Readonly<{
  source: string | null;
  output: 'terminal' | 'json';
  quiet: boolean;
  color: boolean;
}>;

function parseSingleJsonInput(argv: string[], overflowMessage: string): SingleJsonInput {
  let source: string | null = null;
  let output: 'terminal' | 'json' = 'terminal';
  let quiet = false;
  let color = true;
  for (const argument of argv) {
    if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('--json may be supplied only once.');
      output = 'json';
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (source === null) source = argument;
    else throw new CliUsageError(overflowMessage);
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { source, output, quiet, color };
}

function parseOfflineImportArguments<T extends 'map-observations' | 'oam-export'>(
  action: T,
  argv: string[],
): Extract<CliArguments, { action: T }> {
  const parsed = parseSingleJsonInput(argv, `${action} accepts one optional versioned JSON input file.`);
  return { action, ...parsed } as Extract<CliArguments, { action: T }>;
}

function parseCommandsArguments(argv: string[]): Extract<CliArguments, { action: 'commands' }> {
  let output: 'terminal' | 'json' = 'terminal';
  let common = false;
  let group: CliHelpGroup | null = null;
  let mode: 'offline' | 'network' | null = null;
  let quiet = false;
  let color = true;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('--json may be supplied only once.');
      output = 'json';
    } else if (argument === '--common') {
      if (common) throw new CliUsageError('--common may be supplied only once.');
      common = true;
    } else if (argument === '--group') {
      if (group !== null) throw new CliUsageError('--group may be supplied only once.');
      const value = argv[++index];
      if (!['investigate', 'respond', 'assure', 'utilities'].includes(value ?? '')) {
        throw new CliUsageError('--group requires investigate, respond, assure, or utilities.');
      }
      group = value as CliHelpGroup;
    } else if (argument === '--mode') {
      if (mode !== null) throw new CliUsageError('--mode may be supplied only once.');
      const value = argv[++index];
      if (value !== 'offline' && value !== 'network') {
        throw new CliUsageError('--mode requires offline or network.');
      }
      mode = value;
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else throw new CliUsageError(`Unknown option "${argument}".`);
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'commands', output, common, group, mode, quiet, color };
}

function parseDoctorArguments(argv: string[]): Extract<CliArguments, { action: 'doctor' }> {
  let network = false;
  let output: 'terminal' | 'json' = 'terminal';
  let quiet = false;
  let color = true;
  for (const argument of argv) {
    if (argument === '--network') {
      if (network) throw new CliUsageError('--network may be supplied only once.');
      network = true;
    } else if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('--json may be supplied only once.');
      output = 'json';
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else throw new CliUsageError(`Unknown option "${argument}".`);
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'doctor', network, output, quiet, color };
}

function parseBulkArguments(argv: string[]): Extract<CliArguments, { action: 'bulk' }> {
  let source: string | null = null;
  let output: 'terminal' | 'json' | 'jsonl' | 'csv' | 'domains' | 'queries' | 'junit' = 'terminal';
  let deep = false;
  let scanMode: 'fast' | 'deep' | null = null;
  let quiet = false;
  let color = true;
  let concurrency: number | null = null;
  let checkpoint: string | null = null;
  let resume = false;
  let events = false;
  let plan = false;
  let failOn: CliFailPolicy[] | null = null;
  let filter: 'all' | 'registered' | 'inconclusive' | 'errors' = 'all';
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === undefined) break;
    if (argument === '--json' || argument === '--jsonl' || argument === '--csv' || argument === '--domains' || argument === '--queries' || argument === '--junit') {
      if (output !== 'terminal') throw new CliUsageError('Choose only one output format.');
      output = argument === '--json'
        ? 'json'
        : argument === '--jsonl'
          ? 'jsonl'
          : argument === '--csv'
            ? 'csv'
            : argument === '--domains'
              ? 'domains'
              : argument === '--queries'
                ? 'queries'
                : 'junit';
    } else if (argument === '--deep' || argument === '--fast') {
      if (scanMode) throw new CliUsageError('--fast and --deep are mutually exclusive and may be supplied only once.');
      scanMode = argument === '--deep' ? 'deep' : 'fast';
      deep = scanMode === 'deep';
    } else if (argument === '--concurrency') {
      if (concurrency !== null) throw new CliUsageError('--concurrency may be supplied only once.');
      const raw = argv[++index];
      if (!raw || !/^\d+$/.test(raw)) throw new CliUsageError('--concurrency requires an integer from 1 to 8.');
      concurrency = Number(raw);
      if (concurrency < 1 || concurrency > 8) throw new CliUsageError('--concurrency must be from 1 to 8.');
    } else if (argument === '--checkpoint') {
      if (checkpoint !== null) throw new CliUsageError('--checkpoint may be supplied only once.');
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError('--checkpoint requires one bounded file path.');
      checkpoint = value;
    } else if (argument === '--resume') {
      if (resume) throw new CliUsageError('--resume may be supplied only once.');
      resume = true;
    } else if (argument === '--events') {
      if (events) throw new CliUsageError('--events may be supplied only once.');
      events = true;
    } else if (argument === '--plan') {
      if (plan) throw new CliUsageError('--plan may be supplied only once.');
      plan = true;
    } else if (argument === '--fail-on') {
      if (failOn !== null) throw new CliUsageError('--fail-on may be supplied only once.');
      failOn = parseCliFailPolicies(argv[++index], 'bulk');
    } else if (argument === '--registered-only' || argument === '--inconclusive-only' || argument === '--errors-only') {
      if (filter !== 'all') throw new CliUsageError('Bulk output filters are mutually exclusive and may be supplied only once.');
      filter = argument === '--registered-only'
        ? 'registered'
        : argument === '--inconclusive-only'
          ? 'inconclusive'
          : 'errors';
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (source === null) source = argument;
    else throw new CliUsageError('bulk accepts one optional input file. Otherwise pipe newline-delimited queries on stdin.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  if (resume && checkpoint === null) throw new CliUsageError('--resume requires --checkpoint.');
  if (plan && (events || resume || checkpoint !== null || quiet || failOn !== null || !['terminal', 'json'].includes(output))) {
    throw new CliUsageError('--plan supports terminal or JSON output and cannot be combined with events, checkpoint, resume, or quiet options.');
  }
  const maximum = deep ? 3 : 8;
  if (concurrency !== null && concurrency > maximum) {
    throw new CliUsageError(`--concurrency is capped at ${maximum} in ${deep ? 'deep' : 'fast'} bulk mode.`);
  }
  return { action: 'bulk', source, output, deep, quiet, color, concurrency: concurrency ?? (deep ? 2 : 4), checkpoint, resume, events, plan, filter, ...(failOn ? { failOn } : {}) };
}

function parseCtSearchArguments(argv: string[]): Extract<CliArguments, { action: 'ct-search' }> {
  const { source: keyword, ...options } = parseSingleJsonInput(
    argv,
    'ct-search accepts one keyword. Quote multi-word keywords as one argument.',
  );
  return { action: 'ct-search', keyword, ...options };
}

function parseCtIntakeArguments(argv: string[]): Extract<CliArguments, { action: 'ct-intake' }> {
  const parsed = parseSingleJsonInput(argv, 'ct-intake accepts one optional versioned JSON event file.');
  return { action: 'ct-intake', ...parsed };
}

function parseDiscoverArguments(argv: string[]): Extract<CliArguments, { action: 'discover' }> {
  let seed: string | null = null;
  let output: 'terminal' | 'json' | 'jsonl' | 'domains' = 'terminal';
  let quiet = false;
  let color = true;
  let preset: 'common' | 'impersonation' | 'all' | 'custom' = 'all';
  let keyboardLayout: 'qwerty' | 'azerty' | 'qwertz' | 'all' = 'qwerty';
  let tldText: string | null = null;
  let dictionarySource: string | null = null;
  let familyText: string | null = null;
  let snapshotSource: string | null = null;
  let presetSet = false;
  let keyboardSet = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === undefined) break;
    if (argument === '--json' || argument === '--jsonl' || argument === '--domains') {
      if (output !== 'terminal') throw new CliUsageError('Choose only one output format.');
      output = argument === '--json' ? 'json' : argument === '--jsonl' ? 'jsonl' : 'domains';
    } else if (argument === '--preset') {
      if (presetSet) throw new CliUsageError('--preset may be supplied only once.');
      if (familyText !== null) throw new CliUsageError('--preset cannot be combined with --families.');
      const value = argv[++index];
      if (value !== 'common' && value !== 'impersonation' && value !== 'all') {
        throw new CliUsageError('--preset requires common, impersonation, or all.');
      }
      preset = value;
      presetSet = true;
    } else if (argument === '--keyboard') {
      if (keyboardSet) throw new CliUsageError('--keyboard may be supplied only once.');
      const value = argv[++index];
      if (value !== 'qwerty' && value !== 'azerty' && value !== 'qwertz' && value !== 'all') {
        throw new CliUsageError('--keyboard requires qwerty, azerty, qwertz, or all.');
      }
      keyboardLayout = value;
      keyboardSet = true;
    } else if (argument === '--tlds') {
      if (tldText !== null) throw new CliUsageError('--tlds may be supplied only once.');
      const value = argv[++index];
      if (!value) throw new CliUsageError('--tlds requires a comma-separated list.');
      tldText = value;
    } else if (argument === '--dictionary') {
      if (dictionarySource !== null) throw new CliUsageError('--dictionary may be supplied only once.');
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError('--dictionary requires one UTF-8 text file.');
      dictionarySource = value;
    } else if (argument === '--families') {
      if (familyText !== null) throw new CliUsageError('--families may be supplied only once.');
      if (presetSet) throw new CliUsageError('--families cannot be combined with --preset.');
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError('--families requires a comma-separated list of mutation family IDs.');
      familyText = value;
      preset = 'custom';
    } else if (argument === '--snapshot') {
      if (snapshotSource !== null) throw new CliUsageError('--snapshot may be supplied only once.');
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError('--snapshot requires one bounded local state file path.');
      snapshotSource = value;
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (seed === null) seed = argument;
    else throw new CliUsageError('discover accepts one brand label or domain. Quote multi-word labels as one argument.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  if (dictionarySource && preset === 'common') {
    throw new CliUsageError('--dictionary requires the impersonation or all preset.');
  }
  return { action: 'discover', seed, output, quiet, color, preset, keyboardLayout, tldText, dictionarySource, familyText, snapshotSource };
}

function parseDiscoverScanArguments(argv: string[]): Extract<CliArguments, { action: 'discover-scan' }> {
  let seed: string | null = null;
  let output: 'terminal' | 'json' | 'jsonl' | 'csv' | 'domains' = 'terminal';
  let quiet = false;
  let color = true;
  let preset: 'common' | 'impersonation' | 'all' | 'custom' = 'all';
  let keyboardLayout: 'qwerty' | 'azerty' | 'qwertz' | 'all' = 'qwerty';
  let tldText: string | null = null;
  let dictionarySource: string | null = null;
  let familyText: string | null = null;
  let presetSet = false;
  let keyboardSet = false;
  let deep = false;
  let scanModeSet = false;
  let scanLimit: number | null = null;
  let chunkSize: number | null = null;
  let concurrency: number | null = null;
  let checkpoint: string | null = null;
  let resume = false;
  let resolverText: string | null = null;
  let observationSnapshot: string | null = null;
  let allowlistSource: string | null = null;
  let filter: 'all' | 'registered' | 'inconclusive' | 'acquisition' | 'suppressed' = 'all';
  let filterSet = false;
  let events = false;
  let plan = false;
  let failOn: CliFailPolicy[] | null = null;

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === undefined) break;
    if (argument === '--json' || argument === '--jsonl' || argument === '--csv' || argument === '--domains') {
      if (output !== 'terminal') throw new CliUsageError('Choose only one output format.');
      output = argument === '--json' ? 'json' : argument === '--jsonl' ? 'jsonl' : argument === '--csv' ? 'csv' : 'domains';
    } else if (argument === '--preset') {
      if (presetSet) throw new CliUsageError('--preset may be supplied only once.');
      if (familyText !== null) throw new CliUsageError('--preset cannot be combined with --families.');
      const value = argv[++index];
      if (value !== 'common' && value !== 'impersonation' && value !== 'all') {
        throw new CliUsageError('--preset requires common, impersonation, or all.');
      }
      preset = value;
      presetSet = true;
    } else if (argument === '--keyboard') {
      if (keyboardSet) throw new CliUsageError('--keyboard may be supplied only once.');
      const value = argv[++index];
      if (value !== 'qwerty' && value !== 'azerty' && value !== 'qwertz' && value !== 'all') {
        throw new CliUsageError('--keyboard requires qwerty, azerty, qwertz, or all.');
      }
      keyboardLayout = value;
      keyboardSet = true;
    } else if (argument === '--tlds') {
      if (tldText !== null) throw new CliUsageError('--tlds may be supplied only once.');
      const value = argv[++index];
      if (!value) throw new CliUsageError('--tlds requires a comma-separated list.');
      tldText = value;
    } else if (argument === '--dictionary') {
      if (dictionarySource !== null) throw new CliUsageError('--dictionary may be supplied only once.');
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError('--dictionary requires one UTF-8 text file.');
      dictionarySource = value;
    } else if (argument === '--families') {
      if (familyText !== null) throw new CliUsageError('--families may be supplied only once.');
      if (presetSet) throw new CliUsageError('--families cannot be combined with --preset.');
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError('--families requires a comma-separated list of mutation family IDs.');
      familyText = value;
      preset = 'custom';
    } else if (argument === '--deep' || argument === '--fast') {
      if (scanModeSet) throw new CliUsageError('--fast and --deep are mutually exclusive and may be supplied only once.');
      deep = argument === '--deep';
      scanModeSet = true;
    } else if (argument === '--scan-limit') {
      if (scanLimit !== null) throw new CliUsageError('--scan-limit may be supplied only once.');
      scanLimit = positiveIntegerOption(argv[++index], '--scan-limit', 500);
    } else if (argument === '--chunk-size') {
      if (chunkSize !== null) throw new CliUsageError('--chunk-size may be supplied only once.');
      chunkSize = positiveIntegerOption(argv[++index], '--chunk-size', 100);
    } else if (argument === '--concurrency') {
      if (concurrency !== null) throw new CliUsageError('--concurrency may be supplied only once.');
      concurrency = positiveIntegerOption(argv[++index], '--concurrency', 8);
    } else if (argument === '--checkpoint') {
      if (checkpoint !== null) throw new CliUsageError('--checkpoint may be supplied only once.');
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError('--checkpoint requires one bounded file path.');
      checkpoint = value;
    } else if (argument === '--resume') {
      if (resume) throw new CliUsageError('--resume may be supplied only once.');
      resume = true;
    } else if (argument === '--resolver') {
      if (resolverText !== null) throw new CliUsageError('--resolver may be supplied only once.');
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError('--resolver requires a comma-separated list of IP addresses.');
      resolverText = value;
    } else if (argument === '--observation-snapshot') {
      if (observationSnapshot !== null) throw new CliUsageError('--observation-snapshot may be supplied only once.');
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError('--observation-snapshot requires one bounded local state file path.');
      observationSnapshot = value;
    } else if (argument === '--allowlist') {
      if (allowlistSource !== null) throw new CliUsageError('--allowlist may be supplied only once.');
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError('--allowlist requires one newline-delimited local file.');
      allowlistSource = value;
    } else if (argument === '--registered-only' || argument === '--inconclusive-only'
      || argument === '--acquisition-only' || argument === '--suppressed-only') {
      if (filterSet) throw new CliUsageError('Discovery scan filters are mutually exclusive and may be supplied only once.');
      filter = argument === '--registered-only' ? 'registered'
        : argument === '--inconclusive-only' ? 'inconclusive'
          : argument === '--acquisition-only' ? 'acquisition' : 'suppressed';
      filterSet = true;
    } else if (argument === '--events') {
      if (events) throw new CliUsageError('--events may be supplied only once.');
      events = true;
    } else if (argument === '--plan') {
      if (plan) throw new CliUsageError('--plan may be supplied only once.');
      plan = true;
    } else if (argument === '--fail-on') {
      if (failOn !== null) throw new CliUsageError('--fail-on may be supplied only once.');
      failOn = parseCliFailPolicies(argv[++index], 'discover-scan');
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (seed === null) seed = argument;
    else throw new CliUsageError('discover-scan accepts one brand label or domain. Quote multi-word labels as one argument.');
  }
  const maximum = deep ? 50 : 500;
  if (scanLimit !== null && scanLimit > maximum) throw new CliUsageError(`--scan-limit is capped at ${maximum} in ${deep ? 'deep' : 'fast'} mode.`);
  const maximumConcurrency = deep ? 3 : 8;
  if ((concurrency ?? (deep ? 2 : 4)) > maximumConcurrency) {
    throw new CliUsageError(`--concurrency is capped at ${maximumConcurrency} in ${deep ? 'deep' : 'fast'} mode.`);
  }
  if (resume && checkpoint === null) throw new CliUsageError('--resume requires --checkpoint.');
  if (plan && (events || resume || checkpoint !== null || observationSnapshot !== null || quiet || failOn !== null || !['terminal', 'json'].includes(output))) {
    throw new CliUsageError('--plan supports terminal or JSON output and cannot be combined with events, checkpoint, resume, observation snapshots, or quiet options.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  if (dictionarySource && preset === 'common') throw new CliUsageError('--dictionary requires the impersonation or all preset.');
  return {
    action: 'discover-scan', seed, output, quiet, color, preset, keyboardLayout, tldText,
    dictionarySource, familyText, deep, scanLimit: scanLimit ?? Math.min(100, maximum),
    chunkSize: chunkSize ?? 25, concurrency: concurrency ?? (deep ? 2 : 4), checkpoint,
    resume, resolverText, observationSnapshot, allowlistSource, filter, events, plan, ...(failOn ? { failOn } : {}),
  };
}

function positiveIntegerOption(value: string | undefined, option: string, maximum: number): number {
  if (!value || !/^\d+$/u.test(value)) throw new CliUsageError(`${option} requires an integer from 1 to ${maximum}.`);
  const parsed = Number(value);
  if (parsed < 1 || parsed > maximum) throw new CliUsageError(`${option} must be from 1 to ${maximum}.`);
  return parsed;
}

function parsePostureArguments(argv: string[]): Extract<CliArguments, { action: 'posture' }> {
  let domain: string | null = null;
  let output: 'terminal' | 'json' | 'sarif' = 'terminal';
  let quiet = false;
  let color = true;
  let selectorText: string | null = null;
  let retiredSelectorText: string | null = null;
  let mailProfile: 'defensive_no_mail' | 'parked' | 'standard' = 'standard';
  let mailProfileSeen = false;
  let ownedDomain = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === undefined) break;
    if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('--json may be supplied only once.');
      output = 'json';
    } else if (argument === '--sarif') {
      if (output !== 'terminal') throw new CliUsageError('Choose only one output format.');
      output = 'sarif';
    } else if (argument === '--owned-domain') {
      if (ownedDomain) throw new CliUsageError('--owned-domain may be supplied only once.');
      ownedDomain = true;
    } else if (argument === '--selectors') {
      if (selectorText !== null) throw new CliUsageError('--selectors may be supplied only once.');
      const value = argv[++index];
      if (!value) throw new CliUsageError('--selectors requires a comma-separated list.');
      selectorText = value;
    } else if (argument === '--retired-selectors') {
      if (retiredSelectorText !== null) throw new CliUsageError('--retired-selectors may be supplied only once.');
      const value = argv[++index];
      if (!value) throw new CliUsageError('--retired-selectors requires a comma-separated list.');
      retiredSelectorText = value;
    } else if (argument === '--mail-profile') {
      if (mailProfileSeen) throw new CliUsageError('--mail-profile may be supplied only once.');
      const value = argv[++index];
      if (!value || !['standard', 'defensive-no-mail', 'parked'].includes(value)) {
        throw new CliUsageError('--mail-profile must be standard, defensive-no-mail, or parked.');
      }
      mailProfile = value === 'defensive-no-mail' ? 'defensive_no_mail' : value as 'parked' | 'standard';
      mailProfileSeen = true;
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (domain === null) domain = argument;
    else throw new CliUsageError('posture accepts one domain.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  if (output === 'sarif' && !ownedDomain) throw new CliUsageError('--sarif requires --owned-domain to confirm the passive posture target is controlled by the operator.');
  return { action: 'posture', domain, output, quiet, color, selectorText, retiredSelectorText, mailProfile, ownedDomain };
}

function parseHttpArguments(argv: string[]): Extract<CliArguments, { action: 'http' }> {
  const { source: domain, ...options } = parseSingleJsonInput(argv, 'http accepts one domain.');
  return { action: 'http', domain, ...options };
}

function parseTlsArguments(argv: string[]): Extract<CliArguments, { action: 'tls' }> {
  const { source: hostname, ...options } = parseSingleJsonInput(argv, 'tls accepts one hostname.');
  return { action: 'tls', hostname, ...options };
}

function parseDnssecValidateArguments(argv: string[]): Extract<CliArguments, { action: 'dnssec-validate' }> {
  let target: string | null = null;
  let resolver: string | null = null;
  let trustAnchorSource: string | null = null;
  let ownedOrAuthorized = false;
  let output: 'terminal' | 'json' = 'terminal';
  let quiet = false;
  let color = true;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--resolver' || argument === '--trust-anchor') {
      const selected = argument === '--resolver' ? resolver : trustAnchorSource;
      if (selected !== null) throw new CliUsageError(`${argument} may be supplied only once.`);
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError(`${argument} requires one bounded value.`);
      if (argument === '--resolver') resolver = value;
      else trustAnchorSource = value;
    } else if (argument === '--owned-or-authorized') {
      if (ownedOrAuthorized) throw new CliUsageError('--owned-or-authorized may be supplied only once.');
      ownedOrAuthorized = true;
    } else if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('--json may be supplied only once.');
      output = 'json';
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument?.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (argument && target === null) target = argument;
    else throw new CliUsageError('dnssec-validate accepts one domain target.');
  }
  if (!target) throw new CliUsageError('dnssec-validate requires one domain target.');
  if (!resolver) throw new CliUsageError('dnssec-validate requires --resolver <public-IP>.');
  if (!trustAnchorSource) throw new CliUsageError('dnssec-validate requires --trust-anchor <anchor.json>.');
  if (!ownedOrAuthorized) throw new CliUsageError('dnssec-validate requires --owned-or-authorized for every run.');
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'dnssec-validate', target, resolver, trustAnchorSource, ownedOrAuthorized: true, output, quiet, color };
}

function parseMailTransportArguments(argv: string[]): Extract<CliArguments, { action: 'mail-transport' }> {
  let source: string | null = null;
  let resolver: string | null = null;
  let trustAnchorSource: string | null = null;
  let ownedOrAuthorized = false;
  let activeProbeAcknowledged = false;
  let output: 'terminal' | 'json' = 'terminal';
  let quiet = false;
  let color = true;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--resolver' || argument === '--trust-anchor') {
      const selected = argument === '--resolver' ? resolver : trustAnchorSource;
      if (selected !== null) throw new CliUsageError(`${argument} may be supplied only once.`);
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError(`${argument} requires one bounded value.`);
      if (argument === '--resolver') resolver = value;
      else trustAnchorSource = value;
    } else if (argument === '--owned-or-authorized') {
      if (ownedOrAuthorized) throw new CliUsageError('--owned-or-authorized may be supplied only once.');
      ownedOrAuthorized = true;
    } else if (argument === '--active-probe') {
      if (activeProbeAcknowledged) throw new CliUsageError('--active-probe may be supplied only once.');
      activeProbeAcknowledged = true;
    } else if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('--json may be supplied only once.');
      output = 'json';
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument?.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (argument && source === null) source = argument;
    else throw new CliUsageError('mail-transport accepts one optional versioned JSON input file.');
  }
  if (!resolver) throw new CliUsageError('mail-transport requires --resolver <public-IP>.');
  if (!trustAnchorSource) throw new CliUsageError('mail-transport requires --trust-anchor <anchor.json>.');
  if (!ownedOrAuthorized) throw new CliUsageError('mail-transport requires --owned-or-authorized for every run.');
  if (!activeProbeAcknowledged) throw new CliUsageError('mail-transport requires --active-probe for every run.');
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'mail-transport', source, resolver, trustAnchorSource, ownedOrAuthorized: true, activeProbeAcknowledged: true, output, quiet, color };
}

function parseCompareArguments(argv: string[]): Extract<CliArguments, { action: 'compare' }> {
  const parsed = parseSingleJsonInput(
    argv,
    'compare accepts one optional lookup JSON file. Otherwise pipe one lookup document on stdin.',
  );
  return { action: 'compare', ...parsed };
}

function parsePageCompareArguments(argv: string[]): Extract<CliArguments, { action: 'page-compare' }> {
  const parsed = parseTwoFileComparisonArguments(argv, 'page-compare');
  return { action: 'page-compare', ...parsed };
}

function parseTwoFileComparisonArguments(argv: string[], command: string) {
  const sources: string[] = [];
  let output: 'terminal' | 'json' = 'terminal';
  let quiet = false;
  let color = true;
  for (const argument of argv) {
    if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('--json may be supplied only once.');
      output = 'json';
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else sources.push(argument);
  }
  if (sources.length !== 2 || !sources[0] || !sources[1]) throw new CliUsageError(`${command} requires two input JSON files.`);
  if (sources[0] === sources[1]) throw new CliUsageError(`${command} requires two different input files.`);
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { leftSource: sources[0], rightSource: sources[1], output, quiet, color };
}

function parseMailReviewArguments(argv: string[]): Extract<CliArguments, { action: 'mail-review' }> {
  const parsed = parseSingleJsonInput(argv, 'mail-review accepts one optional Bulk JSON or JSONL input file.');
  return { action: 'mail-review', ...parsed };
}

function parseReviewEvidenceArguments(argv: string[]): Extract<CliArguments, { action: 'review-evidence' }> {
  let source: string | null = null;
  let mmdbSource: string | null = null;
  let output: 'terminal' | 'json' = 'terminal';
  let strictExit = false;
  let quiet = false;
  let color = true;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) break;
    if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('--json may be supplied only once.');
      output = 'json';
    } else if (argument === '--mmdb') {
      const value = argv[++index];
      if (!value || value.startsWith('-') || mmdbSource !== null) throw new CliUsageError('--mmdb requires one database file and may be supplied only once.');
      mmdbSource = value;
    } else if (argument === '--strict-exit') {
      if (strictExit) throw new CliUsageError('--strict-exit may be supplied only once.');
      strictExit = true;
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (source === null) source = argument;
    else throw new CliUsageError('review-evidence accepts one optional versioned JSON input file.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'review-evidence', source, mmdbSource, output, strictExit, quiet, color };
}

function parseBriefArguments(argv: string[]): Extract<CliArguments, { action: 'brief' }> {
  const parsed = parseSingleJsonInput(argv, 'brief accepts one optional saved Lookup file.');
  return { action: 'brief', ...parsed };
}

function parseCasePackArguments(argv: string[]): Extract<CliArguments, { action: 'case-pack' }> {
  let source: string | null = null;
  let output: 'terminal' | 'json' = 'terminal';
  let audience: 'internal' | 'trusted' | 'public' | null = null;
  let reviewed = false;
  let quiet = false;
  let color = true;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) break;
    if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('--json may be supplied only once.');
      output = 'json';
    } else if (argument === '--audience') {
      if (audience !== null) throw new CliUsageError('--audience may be supplied only once.');
      const value = argv[++index];
      if (!['internal', 'trusted', 'public'].includes(value || '')) throw new CliUsageError('--audience requires internal, trusted, or public.');
      audience = value as NonNullable<typeof audience>;
    } else if (argument === '--reviewed') {
      if (reviewed) throw new CliUsageError('--reviewed may be supplied only once.');
      reviewed = true;
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (source === null) source = argument;
    else throw new CliUsageError('case-pack accepts one optional case-export file.');
  }
  if (audience === null) throw new CliUsageError('case-pack requires --audience internal, trusted, or public.');
  if (!reviewed) throw new CliUsageError('case-pack requires --reviewed to confirm deliberate analyst review.');
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'case-pack', source, output, audience, reviewed: true, quiet, color };
}

function parseMonitorOnceArguments(argv: string[]): Extract<CliArguments, { action: 'monitor-once' }> {
  let source: string | null = null;
  let previousSource: string | null = null;
  let output: 'terminal' | 'json' | 'junit' = 'terminal';
  let limit = 20;
  let concurrency = 2;
  let limitSupplied = false;
  let concurrencySupplied = false;
  let failOn: CliFailPolicy[] | null = null;
  let quiet = false;
  let color = true;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) break;
    if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('--json may be supplied only once.');
      output = 'json';
    } else if (argument === '--junit') {
      if (output !== 'terminal') throw new CliUsageError('Choose only one output format.');
      output = 'junit';
    } else if (argument === '--previous') {
      if (previousSource !== null) throw new CliUsageError('--previous may be supplied only once.');
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError('--previous requires one prior monitor snapshot file.');
      previousSource = value;
    } else if (argument === '--limit' || argument === '--concurrency') {
      if (argument === '--limit' ? limitSupplied : concurrencySupplied) {
        throw new CliUsageError(`${argument} may be supplied only once.`);
      }
      const value = Number(argv[++index]);
      const maximum = argument === '--limit' ? 20 : 3;
      if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new CliUsageError(`${argument} requires an integer from 1 to ${maximum}.`);
      if (argument === '--limit') {
        limit = value;
        limitSupplied = true;
      } else {
        concurrency = value;
        concurrencySupplied = true;
      }
    } else if (argument === '--fail-on') {
      if (failOn !== null) throw new CliUsageError('--fail-on may be supplied only once.');
      failOn = parseCliFailPolicies(argv[++index], 'monitor-once');
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (source === null) source = argument;
    else throw new CliUsageError('monitor-once accepts one optional domain-control manifest file.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'monitor-once', source, previousSource, output, limit, concurrency, quiet, color, ...(failOn ? { failOn } : {}) };
}

function parseDomainControlArguments(argv: string[]): Extract<CliArguments, { action: 'domain-control' }> {
  const parsed = parseSingleJsonInput(argv, 'domain-control accepts one optional versioned JSON input file.');
  return { action: 'domain-control', ...parsed };
}

function parseAssuranceArguments(argv: string[]): Extract<CliArguments, { action: 'assurance' }> {
  const parsed = parseSingleJsonInput(argv, 'assurance accepts one optional versioned JSON input file.');
  return { action: 'assurance', ...parsed };
}

function parseChangePacketArguments(argv: string[]): Extract<CliArguments, { action: 'change-packet' }> {
  const parsed = parseSingleJsonInput(argv, 'change-packet accepts one optional versioned JSON input file.');
  return { action: 'change-packet', ...parsed };
}

function parseSharingReviewArguments(argv: string[]): Extract<CliArguments, { action: 'sharing-review' }> {
  let source: string | null = null;
  let output: 'terminal' | 'json' = 'terminal';
  let marking: 'clear' | 'green' | 'amber' | 'amber-strict' | 'red' | null = null;
  let recipientScope: 'public' | 'community' | 'organization' | 'named-recipients' | null = null;
  let purpose: string | null = null;
  let humanReviewed = false;
  let personalDataReviewed = false;
  let redactionsConfirmed = false;
  let quiet = false;
  let color = true;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === undefined) break;
    if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('--json may be supplied only once.');
      output = 'json';
    } else if (argument === '--marking') {
      if (marking !== null) throw new CliUsageError('--marking may be supplied only once.');
      const value = argv[++index];
      if (!['clear', 'green', 'amber', 'amber-strict', 'red'].includes(value || '')) {
        throw new CliUsageError('--marking requires clear, green, amber, amber-strict, or red.');
      }
      marking = value as 'clear' | 'green' | 'amber' | 'amber-strict' | 'red';
    } else if (argument === '--recipient-scope') {
      if (recipientScope !== null) throw new CliUsageError('--recipient-scope may be supplied only once.');
      const value = argv[++index];
      if (!['public', 'community', 'organization', 'named-recipients'].includes(value || '')) {
        throw new CliUsageError('--recipient-scope requires public, community, organization, or named-recipients.');
      }
      recipientScope = value as 'public' | 'community' | 'organization' | 'named-recipients';
    } else if (argument === '--purpose') {
      if (purpose !== null) throw new CliUsageError('--purpose may be supplied only once.');
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError('--purpose requires one bounded description.');
      const normalized = value.replace(/\s+/gu, ' ').trim();
      if (!normalized || normalized.length > 200) throw new CliUsageError('--purpose is limited to 200 characters.');
      purpose = normalized;
    } else if (argument === '--human-reviewed') humanReviewed = true;
    else if (argument === '--personal-data-reviewed') personalDataReviewed = true;
    else if (argument === '--redactions-confirmed') redactionsConfirmed = true;
    else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (source === null) source = argument;
    else throw new CliUsageError('sharing-review accepts one optional artefact JSON file.');
  }
  if (!marking || !recipientScope || !purpose) {
    throw new CliUsageError('sharing-review requires --marking, --recipient-scope, and --purpose.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return {
    action: 'sharing-review', source, output, marking, recipientScope, purpose,
    humanReviewed, personalDataReviewed, redactionsConfirmed, quiet, color,
  };
}

function parseWorkflowPlanArguments(argv: string[]): Extract<CliArguments, { action: 'workflow-plan' }> {
  const positional: string[] = [];
  let discovery: 'list' | 'explain' | null = null;
  let explainedRecipe: InvestigationPlanRecipe | null = null;
  let output: 'terminal' | 'json' = 'terminal';
  let quiet = false;
  let color = true;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('--json may be supplied only once.');
      output = 'json';
    } else if (argument === '--list') {
      if (discovery !== null) throw new CliUsageError('--list and --explain are mutually exclusive and may be supplied only once.');
      discovery = 'list';
    } else if (argument === '--explain') {
      if (discovery !== null) throw new CliUsageError('--list and --explain are mutually exclusive and may be supplied only once.');
      const value = argv[++index];
      if (!INVESTIGATION_PLAN_RECIPES.includes(value as InvestigationPlanRecipe)) {
        throw new CliUsageError(`--explain recipe must be one of: ${INVESTIGATION_PLAN_RECIPES.join(', ')}.`);
      }
      discovery = 'explain';
      explainedRecipe = value as InvestigationPlanRecipe;
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else positional.push(argument);
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  if (discovery !== null) {
    if (positional.length !== 0) throw new CliUsageError('workflow-plan discovery options do not accept a subject.');
    if (discovery === 'list') return { action: 'workflow-plan', discovery, output, quiet, color };
    return { action: 'workflow-plan', discovery, recipe: explainedRecipe!, output, quiet, color };
  }
  if (positional.length !== 2) throw new CliUsageError('workflow-plan requires one fixed recipe and one subject, --list, or --explain <recipe>.');
  const recipe = positional[0];
  if (!INVESTIGATION_PLAN_RECIPES.includes(recipe as InvestigationPlanRecipe)) {
    throw new CliUsageError(`workflow-plan recipe must be one of: ${INVESTIGATION_PLAN_RECIPES.join(', ')}.`);
  }
  return { action: 'workflow-plan', recipe: recipe as InvestigationPlanRecipe, subject: positional[1]!, output, quiet, color };
}

function parseWorkflowRunArguments(argv: string[]): Extract<CliArguments, { action: 'workflow-run' }> {
  const positional: string[] = [];
  const selections: Array<Readonly<{ stepId: string; value: string }>> = [];
  let resumeSource: string | null = null;
  let approveNetwork = false;
  let output: 'terminal' | 'json' = 'terminal';
  let quiet = false;
  let color = true;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) break;
    if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('--json may be supplied only once.');
      output = 'json';
    } else if (argument === '--select') {
      const value = argv[++index];
      if (!value) throw new CliUsageError('--select requires <step-id>=<path-or-value>.');
      const separator = value.indexOf('=');
      const stepId = separator === -1 ? '' : value.slice(0, separator);
      const selection = separator === -1 ? '' : value.slice(separator + 1);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(stepId) || !selection.trim()) {
        throw new CliUsageError('--select requires <step-id>=<path-or-value>.');
      }
      if (selection.startsWith('-')) {
        throw new CliUsageError('--select values cannot start with a hyphen; prefix a file path with ./ when needed.');
      }
      selections.push(Object.freeze({ stepId, value: selection }));
    } else if (argument === '--resume') {
      if (resumeSource !== null) throw new CliUsageError('--resume may be supplied only once.');
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError('--resume requires one prior workflow-run state file.');
      resumeSource = value;
    } else if (argument === '--approve-network') {
      if (approveNetwork) throw new CliUsageError('--approve-network may be supplied only once.');
      approveNetwork = true;
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else positional.push(argument);
  }
  if (positional.length !== 2) throw new CliUsageError('workflow-run requires one fixed recipe and one subject.');
  const recipe = positional[0];
  if (!RUNNABLE_INVESTIGATION_PLAN_RECIPES.includes(recipe as RunnableInvestigationPlanRecipe)) {
    throw new CliUsageError(`workflow-run recipe must be one of: ${RUNNABLE_INVESTIGATION_PLAN_RECIPES.join(', ')}.`);
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'workflow-run', recipe: recipe as RunnableInvestigationPlanRecipe, subject: positional[1]!, resumeSource, selections: Object.freeze(selections), approveNetwork, output, quiet, color };
}

function parseDiffArguments(argv: string[]): Extract<CliArguments, { action: 'diff' }> {
  let leftSource: string | null = null;
  let rightSource: string | null = null;
  let leftSessionId: string | null = null;
  let rightSessionId: string | null = null;
  let output: 'terminal' | 'json' = 'terminal';
  let quiet = false;
  let color = true;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === undefined) break;
    if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('--json may be supplied only once.');
      output = 'json';
    } else if (argument === '--left-session' || argument === '--right-session') {
      const current = argument === '--left-session' ? leftSessionId : rightSessionId;
      if (current !== null) throw new CliUsageError(`${argument} may be supplied only once.`);
      const value = argv[++index];
      if (!value || !/^[A-Za-z0-9_-]{1,128}$/u.test(value)) throw new CliUsageError(`${argument} requires one bounded saved-session ID.`);
      if (argument === '--left-session') leftSessionId = value;
      else rightSessionId = value;
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (leftSource === null) leftSource = argument;
    else if (rightSource === null) rightSource = argument;
    else throw new CliUsageError('diff accepts exactly two compatible retained JSON files.');
  }
  if (!leftSource || !rightSource) throw new CliUsageError('diff requires exactly two compatible retained JSON files.');
  if (leftSource === rightSource) throw new CliUsageError('diff requires two different input files.');
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'diff', leftSource, rightSource, leftSessionId, rightSessionId, output, quiet, color };
}

function parseReconcileArguments(argv: string[]): Extract<CliArguments, { action: 'reconcile' }> {
  const sources: string[] = [];
  let output: 'terminal' | 'json' = 'terminal';
  let quiet = false;
  let color = true;
  for (const argument of argv) {
    if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('--json may be supplied only once.');
      output = 'json';
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else sources.push(argument);
  }
  if (sources.length < 2 || sources.length > 5) {
    throw new CliUsageError('reconcile requires from 2 to 5 saved lookup JSON files.');
  }
  if (new Set(sources).size !== sources.length) {
    throw new CliUsageError('reconcile input files must be different.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'reconcile', sources, output, quiet, color };
}

function parseTimelineArguments(argv: string[]): Extract<CliArguments, { action: 'timeline' }> {
  const sources: string[] = [];
  let output: 'terminal' | 'json' = 'terminal';
  let quiet = false;
  let color = true;
  for (const argument of argv) {
    if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('--json may be supplied only once.');
      output = 'json';
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else sources.push(argument);
  }
  if (sources.length < 2 || sources.length > 20) {
    throw new CliUsageError('timeline requires from 2 to 20 saved lookup JSON files.');
  }
  if (new Set(sources).size !== sources.length) {
    throw new CliUsageError('timeline input files must be different.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'timeline', sources, output, quiet, color };
}

function parseRegistrySupportArguments(argv: string[]): Extract<CliArguments, { action: 'registry-support' }> {
  const { source: target, ...options } = parseSingleJsonInput(argv, 'registry-support accepts one domain or suffix.');
  return { action: 'registry-support', target, ...options };
}

function parseRegistryDoctorArguments(argv: string[]): Extract<CliArguments, { action: 'registry-doctor' }> {
  const parsed = parseSingleJsonInput(argv, 'registry-doctor accepts one optional saved Lookup JSON file.');
  return { action: 'registry-doctor', ...parsed };
}

function parseRegistryCohortArguments(argv: string[]): Extract<CliArguments, { action: 'registry-cohort' }> {
  const parsed = parseSingleJsonInput(argv, 'registry-cohort accepts one optional JSON or JSONL input file.');
  return { action: 'registry-cohort', ...parsed };
}

function parseRegistryScaffoldArguments(argv: string[]): Extract<CliArguments, { action: 'registry-scaffold' }> {
  let profile = '';
  let suffix = '';
  let scenario = '';
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!value) throw new CliUsageError(`${option || 'Option'} requires a value.`);
    if (option === '--profile' && !profile) profile = value;
    else if (option === '--suffix' && !suffix) suffix = value;
    else if (option === '--scenario' && !scenario) scenario = value;
    else throw new CliUsageError(`Unknown or repeated option "${option || ''}".`);
  }
  if (!profile || !suffix || !['registered', 'not_found', 'inconclusive'].includes(scenario)) {
    throw new CliUsageError('registry-scaffold requires --profile, --suffix, and --scenario <registered|not_found|inconclusive>.');
  }
  return { action: 'registry-scaffold', profile, suffix, scenario: scenario as 'registered' | 'not_found' | 'inconclusive' };
}

function parseRiskCalibrateArguments(argv: string[]): Extract<CliArguments, { action: 'risk-calibrate' }> {
  let source: string | null = null;
  let output: 'terminal' | 'json' | 'summary_json' = 'terminal';
  let quiet = false;
  let color = true;
  for (const argument of argv) {
    if (argument === '--json' || argument === '--summary-json') {
      if (output !== 'terminal') throw new CliUsageError('--json and --summary-json are mutually exclusive and may be supplied only once.');
      output = argument === '--json' ? 'json' : 'summary_json';
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (source === null) source = argument;
    else throw new CliUsageError('risk-calibrate accepts one optional dataset file. Otherwise pipe one dataset on stdin.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'risk-calibrate', source, output, quiet, color };
}

function parseLookalikeCalibrateArguments(argv: string[]): Extract<CliArguments, { action: 'lookalike-calibrate' }> {
  const parsed = parseSingleJsonInput(argv, 'lookalike-calibrate accepts one optional reviewed dataset JSON file.');
  return { action: 'lookalike-calibrate', ...parsed };
}

function parseVerifyArtifactArguments(argv: string[]): Extract<CliArguments, { action: 'verify-artifact' }> {
  let source: string | null = null;
  let passphraseSource: string | null = null;
  let manifestSource: string | null = null;
  let manifestEntryId: string | null = null;
  let output: 'terminal' | 'json' = 'terminal';
  let strictExit = false;
  let quiet = false;
  let color = true;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === undefined) break;
    if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('--json may be supplied only once.');
      output = 'json';
    } else if (argument === '--passphrase-file') {
      if (passphraseSource !== null) throw new CliUsageError('--passphrase-file may be supplied only once.');
      const value = argv[++index];
      if (!value || value.startsWith('-')) {
        throw new CliUsageError('--passphrase-file requires one bounded UTF-8 file.');
      }
      passphraseSource = value;
    } else if (argument === '--manifest') {
      if (manifestSource !== null) throw new CliUsageError('--manifest may be supplied only once.');
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError('--manifest requires one bounded investigation manifest file.');
      manifestSource = value;
    } else if (argument === '--manifest-entry') {
      if (manifestEntryId !== null) throw new CliUsageError('--manifest-entry may be supplied only once.');
      const value = argv[++index];
      if (!value || !/^artifact-(?:[1-9]|1[0-6])$/u.test(value)) {
        throw new CliUsageError('--manifest-entry requires an ID from artifact-1 through artifact-16.');
      }
      manifestEntryId = value;
    } else if (argument === '--strict-exit') {
      if (strictExit) throw new CliUsageError('--strict-exit may be supplied only once.');
      strictExit = true;
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (source === null) source = argument;
    else throw new CliUsageError('verify-artifact accepts one optional JSON file. Otherwise pipe one artefact on stdin.');
  }
  if ((manifestSource === null) !== (manifestEntryId === null)) {
    throw new CliUsageError('--manifest and --manifest-entry must be supplied together.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'verify-artifact', source, passphraseSource, manifestSource, manifestEntryId, output, strictExit, quiet, color };
}

function parseInterchangeReportArguments(argv: string[]): Extract<CliArguments, { action: 'interchange-report' }> {
  let source: string | null = null;
  let passphraseSource: string | null = null;
  let output: 'terminal' | 'json' = 'terminal';
  let quiet = false;
  let color = true;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === undefined) break;
    if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('--json may be supplied only once.');
      output = 'json';
    } else if (argument === '--passphrase-file') {
      if (passphraseSource !== null) throw new CliUsageError('--passphrase-file may be supplied only once.');
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new CliUsageError('--passphrase-file requires one bounded UTF-8 file.');
      passphraseSource = value;
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (source === null) source = argument;
    else throw new CliUsageError('interchange-report accepts one optional JSON file. Otherwise pipe one artefact on stdin.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'interchange-report', source, passphraseSource, output, quiet, color };
}

function parseSourceReportArguments(argv: string[]): Extract<CliArguments, { action: 'source-report' }> {
  const parsed = parseSingleJsonInput(
    argv,
    'source-report accepts one optional JSON file. Otherwise pipe lookup documents on stdin.',
  );
  return { action: 'source-report', ...parsed };
}

function parseExportArguments(argv: string[]): Extract<CliArguments, { action: 'export' }> {
  let source: string | null = null;
  let compact = false;
  let includeAttribution = true;
  let format: 'json' | 'markdown' | 'html' = 'json';
  for (const argument of argv) {
    if (argument === '--compact') {
      if (compact) throw new CliUsageError('--compact may be supplied only once.');
      compact = true;
    } else if (argument === '--no-attribution') {
      if (!includeAttribution) throw new CliUsageError('--no-attribution may be supplied only once.');
      includeAttribution = false;
    } else if (argument === '--markdown' || argument === '--html') {
      if (format !== 'json') throw new CliUsageError('Choose only one evidence export format.');
      format = argument === '--markdown' ? 'markdown' : 'html';
    } else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (source === null) source = argument;
    else throw new CliUsageError('export accepts one optional lookup JSON file. Otherwise pipe one lookup document on stdin.');
  }
  if (compact && format !== 'json') throw new CliUsageError('--compact applies to JSON export and cannot be combined with --markdown or --html.');
  if (!includeAttribution && format === 'json') throw new CliUsageError('--no-attribution applies only to Markdown or HTML reports.');
  return { action: 'export', source, format, compact, includeAttribution };
}

type CliParser = (argv: string[]) => CliAction;

const CLI_PARSERS = Object.freeze({
  completion: parseCompletionArguments,
  doctor: parseDoctorArguments,
  commands: parseCommandsArguments,
  manual: parseManualArguments,
  manifest: parseManifestArguments,
  'map-observations': (argv: string[]) => parseOfflineImportArguments('map-observations', argv),
  'oam-export': (argv: string[]) => parseOfflineImportArguments('oam-export', argv),
  lookup: parseLookupArguments,
  bulk: parseBulkArguments,
  'ct-search': parseCtSearchArguments,
  'ct-intake': parseCtIntakeArguments,
  discover: parseDiscoverArguments,
  'discover-scan': parseDiscoverScanArguments,
  posture: parsePostureArguments,
  http: parseHttpArguments,
  tls: parseTlsArguments,
  'dnssec-validate': parseDnssecValidateArguments,
  'mail-transport': parseMailTransportArguments,
  'registry-support': parseRegistrySupportArguments,
  'registry-doctor': parseRegistryDoctorArguments,
  'registry-cohort': parseRegistryCohortArguments,
  'registry-scaffold': parseRegistryScaffoldArguments,
  'risk-calibrate': parseRiskCalibrateArguments,
  'lookalike-calibrate': parseLookalikeCalibrateArguments,
  'verify-artifact': parseVerifyArtifactArguments,
  'interchange-report': parseInterchangeReportArguments,
  'inspect-archive': parseInspectArchiveArguments,
  'sign-artifact': parseSignArtifactArguments,
  'verify-signature': parseVerifySignatureArguments,
  'source-report': parseSourceReportArguments,
  compare: parseCompareArguments,
  'page-compare': parsePageCompareArguments,
  'mail-review': parseMailReviewArguments,
  'review-evidence': parseReviewEvidenceArguments,
  brief: parseBriefArguments,
  'case-pack': parseCasePackArguments,
  'domain-control': parseDomainControlArguments,
  'monitor-once': parseMonitorOnceArguments,
  assurance: parseAssuranceArguments,
  'change-packet': parseChangePacketArguments,
  'sharing-review': parseSharingReviewArguments,
  'workflow-plan': parseWorkflowPlanArguments,
  'workflow-run': parseWorkflowRunArguments,
  diff: parseDiffArguments,
  reconcile: parseReconcileArguments,
  timeline: parseTimelineArguments,
  export: parseExportArguments,
} satisfies Record<CliCommand, CliParser>);

export { CLI_COMMANDS, CLI_PARSERS, CliUsageError, MAX_CLI_ARGUMENTS, MAX_CLI_ARGUMENT_LENGTH, parseCliArguments };
export type { CliArguments, CliCommand, CliPalette, CompletionShell, LookupDetail };
