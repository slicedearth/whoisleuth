import { parseCommandArguments, type ParsedCommandArguments } from './command-argument-grammar.mts';
import { CliUsageError, hasUnsafeCliText } from './errors.mts';
import type { InvestigationPlanRecipe, RunnableInvestigationPlanRecipe } from './investigation-plan.mts';
import { parseCliFailPolicies, type CliFailPolicy, type CliFailPolicyCommand } from './fail-policy.mts';
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

type TerminalOptions = { quiet: boolean; color: boolean };
type LookupDetail = 'summary' | 'standard' | 'verbose';
type CliPalette = 'auto' | 'light' | 'dark';
type FileOutputOptions = { destination?: string; force?: true; palette?: CliPalette };
type InspectArchiveArguments = {
  action: 'inspect-archive';
  source: string | null;
  passphraseSource: string | null;
  search: string | null;
  reveal: boolean;
  requireMatch: boolean;
  expectedContentDigest: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;
type SignArtifactArguments = {
  action: 'sign-artifact';
  source: string | null;
  privateKeySource: string;
};
type VerifySignatureArguments = {
  action: 'verify-signature';
  source: string | null;
  publicKeySource: string | null;
  output: 'terminal' | 'json';
} & TerminalOptions;

type CliAction =
  | { action: 'help'; command?: CliCommand }
  | { action: 'version' }
  | { action: 'completion'; shell: CompletionShell }
  | ({ action: 'commands'; output: 'terminal' | 'json'; common: boolean; group: CliHelpGroup | null; mode: 'offline' | 'network' | null } & TerminalOptions)
  | { action: 'manual' }
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
  | ({ action: 'mail-headers'; source: string | null; output: 'terminal' | 'json' } & TerminalOptions)
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
type CliParser = (parsed: ParsedCommandArguments) => CliAction;

function boundedArgument(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_CLI_ARGUMENT_LENGTH || hasUnsafeCliText(value)) {
    throw new CliUsageError('Arguments must be bounded text without control characters.');
  }
  return value;
}

function terminalOptions(parsed: ParsedCommandArguments): TerminalOptions {
  return { quiet: parsed.hasOption('--quiet'), color: !parsed.hasOption('--no-color') };
}

function parseInspectArchiveArguments(parsed: ParsedCommandArguments): InspectArchiveArguments {
  const expectedContentDigest = parsed.optionValue('--expect-content-digest');
  if (expectedContentDigest !== null && !/^sha256:[a-f0-9]{64}$/u.test(expectedContentDigest)) {
    throw new CliUsageError('--expect-content-digest requires sha256 followed by 64 lowercase hexadecimal characters.');
  }
  return {
    action: 'inspect-archive',
    source: parsed.positionalValue('source'),
    passphraseSource: parsed.optionValue('--passphrase-file'),
    search: parsed.optionValue('--search'),
    reveal: parsed.hasOption('--reveal'),
    requireMatch: parsed.hasOption('--require-match'),
    expectedContentDigest,
    output: parsed.hasOption('--json') ? 'json' : 'terminal',
    ...terminalOptions(parsed),
  };
}

function parseSignArtifactArguments(parsed: ParsedCommandArguments): SignArtifactArguments {
  return {
    action: 'sign-artifact',
    source: parsed.positionalValue('source'),
    privateKeySource: parsed.optionValue('--private-key-file')!,
  };
}

function parseVerifySignatureArguments(parsed: ParsedCommandArguments): VerifySignatureArguments {
  return {
    action: 'verify-signature',
    source: parsed.positionalValue('source'),
    publicKeySource: parsed.optionValue('--public-key-file'),
    output: parsed.hasOption('--json') ? 'json' : 'terminal',
    ...terminalOptions(parsed),
  };
}

function jsonOutput(parsed: ParsedCommandArguments): 'terminal' | 'json' {
  return parsed.hasOption('--json') ? 'json' : 'terminal';
}

function normalizedLabel(parsed: ParsedCommandArguments, option: string, maximum: number): string | null {
  const value = parsed.optionValue(option);
  if (value === null) return null;
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (!normalized || normalized.length > maximum) {
    throw new CliUsageError(`${option} requires a label of at most ${maximum} characters.`);
  }
  return normalized;
}

function failPolicies(parsed: ParsedCommandArguments, command: CliFailPolicyCommand): readonly CliFailPolicy[] | null {
  const value = parsed.optionValue('--fail-on');
  return value === null ? null : parseCliFailPolicies(value, command);
}

function parseOutput(
  parsed: ParsedCommandArguments,
  formats: readonly Readonly<[option: string, format: string]>[],
): string {
  return formats.find(([option]) => parsed.hasOption(option))?.[1] ?? 'terminal';
}

function singleInputAction<T extends CliAction['action']>(
  action: T,
  parsed: ParsedCommandArguments,
  positionalName = 'source',
): Extract<CliAction, { action: T }> {
  return {
    action,
    [positionalName === 'source' ? 'source' : positionalName]: parsed.positionalValue(positionalName),
    output: jsonOutput(parsed),
    ...terminalOptions(parsed),
  } as Extract<CliAction, { action: T }>;
}

function parseLookupArguments(parsed: ParsedCommandArguments): Extract<CliAction, { action: 'lookup' }> {
  const output = parseOutput(parsed, [
    ['--json', 'json'], ['--junit', 'junit'], ['--markdown', 'markdown'], ['--html', 'html'],
  ]) as 'terminal' | 'json' | 'markdown' | 'html' | 'junit';
  const selectedFailPolicies = failPolicies(parsed, 'lookup');
  return {
    action: 'lookup',
    query: parsed.positionalValue('target'),
    output,
    deep: parsed.hasOption('--deep'),
    detail: parsed.hasOption('--summary') ? 'summary' : parsed.hasOption('--verbose') ? 'verbose' : 'standard',
    strictExit: parsed.hasOption('--strict-exit'),
    events: parsed.hasOption('--events'),
    plan: parsed.hasOption('--plan'),
    includeAttribution: !parsed.hasOption('--no-attribution'),
    observerLabel: normalizedLabel(parsed, '--observer', 80),
    vantageLabel: normalizedLabel(parsed, '--vantage', 80),
    ...terminalOptions(parsed),
    ...(parsed.hasOption('--browse') ? { browse: true as const } : {}),
    ...(parsed.optionValue('--save-lookup') ? { saveLookup: parsed.optionValue('--save-lookup')! } : {}),
    ...(selectedFailPolicies ? { failOn: selectedFailPolicies } : {}),
  };
}

function parseManifestArguments(parsed: ParsedCommandArguments): Extract<CliAction, { action: 'manifest' }> {
  const sources = parsed.positionalValues('artefacts');
  if (sources.some((source) => !source)) throw new CliUsageError('manifest requires from 1 to 16 JSON artefact files.');
  if (new Set(sources).size !== sources.length) throw new CliUsageError('manifest artefact files must be different.');
  const configurationDigestSha256 = parsed.optionValue('--configuration-digest');
  if (configurationDigestSha256 !== null && !/^sha256:[a-f0-9]{64}$/u.test(configurationDigestSha256)) {
    throw new CliUsageError('--configuration-digest requires a sha256: hexadecimal digest.');
  }
  return {
    action: 'manifest',
    sources,
    workflow: parsed.optionValue('--workflow')!,
    configurationDigestSha256,
    output: jsonOutput(parsed),
    ...terminalOptions(parsed),
  };
}

function parseBulkArguments(parsed: ParsedCommandArguments): Extract<CliAction, { action: 'bulk' }> {
  const deep = parsed.hasOption('--deep');
  const selectedFailPolicies = failPolicies(parsed, 'bulk');
  const output = parseOutput(parsed, [
    ['--json', 'json'], ['--jsonl', 'jsonl'], ['--csv', 'csv'], ['--domains', 'domains'],
    ['--queries', 'queries'], ['--junit', 'junit'],
  ]) as 'terminal' | 'json' | 'jsonl' | 'csv' | 'domains' | 'queries' | 'junit';
  const filter = parsed.hasOption('--registered-only') ? 'registered'
    : parsed.hasOption('--inconclusive-only') ? 'inconclusive'
      : parsed.hasOption('--errors-only') ? 'errors' : 'all';
  return {
    action: 'bulk',
    source: parsed.positionalValue('source'),
    output,
    deep,
    concurrency: parsed.integerOption('--concurrency') ?? (deep ? 2 : 4),
    checkpoint: parsed.optionValue('--checkpoint'),
    resume: parsed.hasOption('--resume'),
    events: parsed.hasOption('--events'),
    plan: parsed.hasOption('--plan'),
    filter,
    ...terminalOptions(parsed),
    ...(selectedFailPolicies ? { failOn: selectedFailPolicies } : {}),
  };
}

function discoveryValues(parsed: ParsedCommandArguments) {
  const familyText = parsed.optionValue('--families');
  return {
    preset: (familyText ? 'custom' : parsed.optionValue('--preset') ?? 'all') as 'common' | 'impersonation' | 'all' | 'custom',
    keyboardLayout: (parsed.optionValue('--keyboard') ?? 'qwerty') as 'qwerty' | 'azerty' | 'qwertz' | 'all',
    tldText: parsed.optionValue('--tlds'),
    dictionarySource: parsed.optionValue('--dictionary'),
    familyText,
  };
}

function parseDiscoverArguments(parsed: ParsedCommandArguments): Extract<CliAction, { action: 'discover' }> {
  return {
    action: 'discover',
    seed: parsed.positionalValue('subject'),
    output: parseOutput(parsed, [['--json', 'json'], ['--jsonl', 'jsonl'], ['--domains', 'domains']]) as 'terminal' | 'json' | 'jsonl' | 'domains',
    ...discoveryValues(parsed),
    snapshotSource: parsed.optionValue('--snapshot'),
    ...terminalOptions(parsed),
  };
}

function parseDiscoverScanArguments(parsed: ParsedCommandArguments): Extract<CliAction, { action: 'discover-scan' }> {
  const deep = parsed.hasOption('--deep');
  const selectedFailPolicies = failPolicies(parsed, 'discover-scan');
  const filter = parsed.hasOption('--registered-only') ? 'registered'
    : parsed.hasOption('--inconclusive-only') ? 'inconclusive'
      : parsed.hasOption('--acquisition-only') ? 'acquisition'
        : parsed.hasOption('--suppressed-only') ? 'suppressed' : 'all';
  return {
    action: 'discover-scan',
    seed: parsed.positionalValue('subject'),
    output: parseOutput(parsed, [['--json', 'json'], ['--jsonl', 'jsonl'], ['--csv', 'csv'], ['--domains', 'domains']]) as 'terminal' | 'json' | 'jsonl' | 'csv' | 'domains',
    ...discoveryValues(parsed),
    deep,
    scanLimit: parsed.integerOption('--scan-limit') ?? Math.min(100, deep ? 50 : 500),
    chunkSize: parsed.integerOption('--chunk-size') ?? 25,
    concurrency: parsed.integerOption('--concurrency') ?? (deep ? 2 : 4),
    checkpoint: parsed.optionValue('--checkpoint'),
    resume: parsed.hasOption('--resume'),
    resolverText: parsed.optionValue('--resolver'),
    observationSnapshot: parsed.optionValue('--observation-snapshot'),
    allowlistSource: parsed.optionValue('--allowlist'),
    filter,
    events: parsed.hasOption('--events'),
    plan: parsed.hasOption('--plan'),
    ...terminalOptions(parsed),
    ...(selectedFailPolicies ? { failOn: selectedFailPolicies } : {}),
  };
}

function parsePostureArguments(parsed: ParsedCommandArguments): Extract<CliAction, { action: 'posture' }> {
  const mailProfile = parsed.optionValue('--mail-profile') ?? 'standard';
  return {
    action: 'posture',
    domain: parsed.positionalValue('domain'),
    output: parseOutput(parsed, [['--json', 'json'], ['--sarif', 'sarif']]) as 'terminal' | 'json' | 'sarif',
    selectorText: parsed.optionValue('--selectors'),
    retiredSelectorText: parsed.optionValue('--retired-selectors'),
    mailProfile: mailProfile === 'defensive-no-mail' ? 'defensive_no_mail' : mailProfile as 'parked' | 'standard',
    ownedDomain: parsed.hasOption('--owned-domain'),
    ...terminalOptions(parsed),
  };
}

function parseDnssecValidateArguments(parsed: ParsedCommandArguments): Extract<CliAction, { action: 'dnssec-validate' }> {
  return {
    action: 'dnssec-validate',
    target: parsed.positionalValue('domain')!,
    resolver: parsed.optionValue('--resolver')!,
    trustAnchorSource: parsed.optionValue('--trust-anchor')!,
    ownedOrAuthorized: true,
    output: jsonOutput(parsed),
    ...terminalOptions(parsed),
  };
}

function parseMailTransportArguments(parsed: ParsedCommandArguments): Extract<CliAction, { action: 'mail-transport' }> {
  return {
    action: 'mail-transport',
    source: parsed.positionalValue('source'),
    resolver: parsed.optionValue('--resolver')!,
    trustAnchorSource: parsed.optionValue('--trust-anchor')!,
    ownedOrAuthorized: true,
    activeProbeAcknowledged: true,
    output: jsonOutput(parsed),
    ...terminalOptions(parsed),
  };
}

function parseTwoFileComparisonArguments(
  parsed: ParsedCommandArguments,
  command: 'page-compare' | 'diff',
) {
  const sources = parsed.positionalValues('sources');
  if (sources[0] === sources[1]) throw new CliUsageError(`${command} requires two different input files.`);
  return { leftSource: sources[0]!, rightSource: sources[1]!, output: jsonOutput(parsed), ...terminalOptions(parsed) };
}

function parseVerifyArtifactArguments(parsed: ParsedCommandArguments): Extract<CliAction, { action: 'verify-artifact' }> {
  return {
    action: 'verify-artifact',
    source: parsed.positionalValue('source'),
    passphraseSource: parsed.optionValue('--passphrase-file'),
    manifestSource: parsed.optionValue('--manifest'),
    manifestEntryId: parsed.optionValue('--manifest-entry'),
    output: jsonOutput(parsed),
    strictExit: parsed.hasOption('--strict-exit'),
    ...terminalOptions(parsed),
  };
}

function parseMonitorOnceArguments(parsed: ParsedCommandArguments): Extract<CliAction, { action: 'monitor-once' }> {
  const selectedFailPolicies = failPolicies(parsed, 'monitor-once');
  return {
    action: 'monitor-once',
    source: parsed.positionalValue('source'),
    previousSource: parsed.optionValue('--previous'),
    output: parseOutput(parsed, [['--json', 'json'], ['--junit', 'junit']]) as 'terminal' | 'json' | 'junit',
    limit: parsed.integerOption('--limit') ?? 20,
    concurrency: parsed.integerOption('--concurrency') ?? 2,
    ...terminalOptions(parsed),
    ...(selectedFailPolicies ? { failOn: selectedFailPolicies } : {}),
  };
}

function parseSharingReviewArguments(parsed: ParsedCommandArguments): Extract<CliAction, { action: 'sharing-review' }> {
  const purpose = parsed.optionValue('--purpose')!.replace(/\s+/gu, ' ').trim();
  if (!purpose || purpose.length > 200) throw new CliUsageError('--purpose is limited to 200 characters.');
  return {
    action: 'sharing-review',
    source: parsed.positionalValue('source'),
    output: jsonOutput(parsed),
    marking: parsed.optionValue('--marking') as 'clear' | 'green' | 'amber' | 'amber-strict' | 'red',
    recipientScope: parsed.optionValue('--recipient-scope') as 'public' | 'community' | 'organization' | 'named-recipients',
    purpose,
    humanReviewed: parsed.hasOption('--human-reviewed'),
    personalDataReviewed: parsed.hasOption('--personal-data-reviewed'),
    redactionsConfirmed: parsed.hasOption('--redactions-confirmed'),
    ...terminalOptions(parsed),
  };
}

function parseWorkflowPlanArguments(parsed: ParsedCommandArguments): Extract<CliAction, { action: 'workflow-plan' }> {
  const options = { output: jsonOutput(parsed), ...terminalOptions(parsed) };
  if (parsed.hasOption('--list')) {
    if (parsed.allPositionals.length > 0) throw new CliUsageError('workflow-plan discovery options do not accept a subject.');
    return { action: 'workflow-plan', discovery: 'list', ...options };
  }
  if (parsed.hasOption('--explain')) {
    if (parsed.allPositionals.length > 0) throw new CliUsageError('workflow-plan discovery options do not accept a subject.');
    return { action: 'workflow-plan', discovery: 'explain', recipe: parsed.optionValue('--explain') as InvestigationPlanRecipe, ...options };
  }
  if (parsed.allPositionals.length !== 2) {
    throw new CliUsageError('workflow-plan requires one fixed recipe and one subject, --list, or --explain <recipe>.');
  }
  return {
    action: 'workflow-plan',
    recipe: parsed.positionalValue('recipe') as InvestigationPlanRecipe,
    subject: parsed.positionalValue('subject')!,
    ...options,
  };
}

function parseWorkflowRunArguments(parsed: ParsedCommandArguments): Extract<CliAction, { action: 'workflow-run' }> {
  const selections = parsed.optionValues('--select').map((value) => {
    const separator = value.indexOf('=');
    const stepId = separator === -1 ? '' : value.slice(0, separator);
    const selection = separator === -1 ? '' : value.slice(separator + 1);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(stepId) || !selection.trim()) {
      throw new CliUsageError('--select requires <step-id>=<path-or-value>.');
    }
    if (selection.startsWith('-')) {
      throw new CliUsageError('--select values cannot start with a hyphen; prefix a file path with ./ when needed.');
    }
    return Object.freeze({ stepId, value: selection });
  });
  return {
    action: 'workflow-run',
    recipe: parsed.positionalValue('recipe') as RunnableInvestigationPlanRecipe,
    subject: parsed.positionalValue('subject')!,
    resumeSource: parsed.optionValue('--resume'),
    selections: Object.freeze(selections),
    approveNetwork: parsed.hasOption('--approve-network'),
    output: jsonOutput(parsed),
    ...terminalOptions(parsed),
  };
}

function parseDiffArguments(parsed: ParsedCommandArguments): Extract<CliAction, { action: 'diff' }> {
  const compared = parseTwoFileComparisonArguments(parsed, 'diff');
  const leftSessionId = parsed.optionValue('--left-session');
  const rightSessionId = parsed.optionValue('--right-session');
  for (const [option, value] of [['--left-session', leftSessionId], ['--right-session', rightSessionId]] as const) {
    if (value !== null && !/^[A-Za-z0-9_-]{1,128}$/u.test(value)) {
      throw new CliUsageError(`${option} requires one bounded saved-session ID.`);
    }
  }
  return { action: 'diff', ...compared, leftSessionId, rightSessionId };
}

function uniqueSources(parsed: ParsedCommandArguments, command: 'reconcile' | 'timeline'): readonly string[] {
  const sources = parsed.positionalValues('sources');
  if (new Set(sources).size !== sources.length) throw new CliUsageError(`${command} input files must be different.`);
  return sources;
}

const CLI_PARSERS = Object.freeze({
  completion: (parsed) => ({ action: 'completion', shell: parsed.positionalValue('shell') as CompletionShell }),
  doctor: (parsed) => ({ action: 'doctor', network: parsed.hasOption('--network'), output: jsonOutput(parsed), ...terminalOptions(parsed) }),
  commands: (parsed) => ({
    action: 'commands', output: jsonOutput(parsed), common: parsed.hasOption('--common'),
    group: parsed.optionValue('--group') as CliHelpGroup | null,
    mode: parsed.optionValue('--mode') as 'offline' | 'network' | null,
    ...terminalOptions(parsed),
  }),
  manual: () => ({ action: 'manual' }),
  manifest: parseManifestArguments,
  'map-observations': (parsed) => singleInputAction('map-observations', parsed),
  'oam-export': (parsed) => singleInputAction('oam-export', parsed),
  lookup: parseLookupArguments,
  bulk: parseBulkArguments,
  'ct-search': (parsed) => singleInputAction('ct-search', parsed, 'keyword'),
  'ct-intake': (parsed) => singleInputAction('ct-intake', parsed),
  discover: parseDiscoverArguments,
  'discover-scan': parseDiscoverScanArguments,
  posture: parsePostureArguments,
  http: (parsed) => singleInputAction('http', parsed, 'domain'),
  tls: (parsed) => singleInputAction('tls', parsed, 'hostname'),
  'dnssec-validate': parseDnssecValidateArguments,
  'mail-transport': parseMailTransportArguments,
  'registry-support': (parsed) => ({
    action: 'registry-support', target: parsed.positionalValue('domain-or-suffix'),
    output: jsonOutput(parsed), ...terminalOptions(parsed),
  }),
  'registry-doctor': (parsed) => singleInputAction('registry-doctor', parsed),
  'registry-cohort': (parsed) => singleInputAction('registry-cohort', parsed),
  'registry-scaffold': (parsed) => ({
    action: 'registry-scaffold', profile: parsed.optionValue('--profile')!, suffix: parsed.optionValue('--suffix')!,
    scenario: parsed.optionValue('--scenario') as 'registered' | 'not_found' | 'inconclusive',
  }),
  'risk-calibrate': (parsed) => ({
    action: 'risk-calibrate', source: parsed.positionalValue('source'),
    output: parsed.hasOption('--json') ? 'json' : parsed.hasOption('--summary-json') ? 'summary_json' : 'terminal',
    ...terminalOptions(parsed),
  }),
  'lookalike-calibrate': (parsed) => singleInputAction('lookalike-calibrate', parsed),
  'verify-artifact': parseVerifyArtifactArguments,
  'interchange-report': (parsed) => ({
    action: 'interchange-report', source: parsed.positionalValue('source'),
    passphraseSource: parsed.optionValue('--passphrase-file'), output: jsonOutput(parsed), ...terminalOptions(parsed),
  }),
  'inspect-archive': parseInspectArchiveArguments,
  'sign-artifact': parseSignArtifactArguments,
  'verify-signature': parseVerifySignatureArguments,
  'source-report': (parsed) => singleInputAction('source-report', parsed),
  compare: (parsed) => singleInputAction('compare', parsed),
  'page-compare': (parsed) => ({ action: 'page-compare', ...parseTwoFileComparisonArguments(parsed, 'page-compare') }),
  'mail-review': (parsed) => singleInputAction('mail-review', parsed),
  'mail-headers': (parsed) => singleInputAction('mail-headers', parsed),
  'review-evidence': (parsed) => ({
    action: 'review-evidence', source: parsed.positionalValue('source'), mmdbSource: parsed.optionValue('--mmdb'),
    output: jsonOutput(parsed), strictExit: parsed.hasOption('--strict-exit'), ...terminalOptions(parsed),
  }),
  brief: (parsed) => singleInputAction('brief', parsed),
  'case-pack': (parsed) => ({
    action: 'case-pack', source: parsed.positionalValue('source'), output: jsonOutput(parsed),
    audience: parsed.optionValue('--audience') as 'internal' | 'trusted' | 'public', reviewed: true, ...terminalOptions(parsed),
  }),
  'domain-control': (parsed) => singleInputAction('domain-control', parsed),
  'monitor-once': parseMonitorOnceArguments,
  assurance: (parsed) => singleInputAction('assurance', parsed),
  'change-packet': (parsed) => singleInputAction('change-packet', parsed),
  'sharing-review': parseSharingReviewArguments,
  'workflow-plan': parseWorkflowPlanArguments,
  'workflow-run': parseWorkflowRunArguments,
  diff: parseDiffArguments,
  reconcile: (parsed) => ({ action: 'reconcile', sources: uniqueSources(parsed, 'reconcile'), output: jsonOutput(parsed), ...terminalOptions(parsed) }),
  timeline: (parsed) => ({ action: 'timeline', sources: uniqueSources(parsed, 'timeline'), output: jsonOutput(parsed), ...terminalOptions(parsed) }),
  export: (parsed) => ({
    action: 'export', source: parsed.positionalValue('source'),
    format: parsed.hasOption('--markdown') ? 'markdown' : parsed.hasOption('--html') ? 'html' : 'json',
    compact: parsed.hasOption('--compact'), includeAttribution: !parsed.hasOption('--no-attribution'),
  }),
} satisfies Record<CliCommand, CliParser>);

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
