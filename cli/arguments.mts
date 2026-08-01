import {
  parseInspectArchiveArguments,
  parseSignArtifactArguments,
  parseVerifySignatureArguments,
  type InspectArchiveArguments,
  type SignArtifactArguments,
  type VerifySignatureArguments,
} from './evidence-command-arguments.mts';
import { CliUsageError } from './errors.mts';

const MAX_CLI_ARGUMENTS = 32;
const MAX_CLI_ARGUMENT_LENGTH = 1024;
const CLI_COMMANDS = [
  'completion',
  'doctor',
  'manual',
  'lookup',
  'bulk',
  'ct-search',
  'discover',
  'discover-scan',
  'posture',
  'http',
  'tls',
  'registry-support',
  'risk-calibrate',
  'verify-artifact',
  'inspect-archive',
  'sign-artifact',
  'verify-signature',
  'source-report',
  'compare',
  'page-compare',
  'mail-review',
  'diff',
  'export',
] as const;
type CliCommand = typeof CLI_COMMANDS[number];

type TerminalOptions = {
  quiet: boolean;
  color: boolean;
};

type LookupDetail = 'summary' | 'standard' | 'verbose';
type CompletionShell = 'bash' | 'zsh' | 'fish';
type FileOutputOptions = { destination?: string; force?: true };

type CliAction =
  | { action: 'help'; command?: CliCommand }
  | { action: 'version' }
  | ({ action: 'completion'; shell: CompletionShell })
  | ({ action: 'manual' })
  | ({ action: 'doctor'; network: boolean; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'lookup'; query: string | null; output: 'terminal' | 'json' | 'markdown' | 'html'; deep: boolean; detail: LookupDetail; strictExit: boolean; events: boolean } & TerminalOptions)
  | ({ action: 'bulk'; source: string | null; output: 'terminal' | 'json' | 'jsonl' | 'csv' | 'domains'; deep: boolean; concurrency: number; checkpoint: string | null; resume: boolean; events: boolean; filter: 'all' | 'registered' | 'inconclusive' } & TerminalOptions)
  | ({ action: 'ct-search'; keyword: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'discover'; seed: string | null; output: 'terminal' | 'json' | 'jsonl' | 'domains'; preset: 'common' | 'impersonation' | 'all' | 'custom'; keyboardLayout: 'qwerty' | 'azerty' | 'qwertz' | 'all'; tldText: string | null; dictionarySource: string | null; familyText: string | null; snapshotSource: string | null } & TerminalOptions)
  | ({ action: 'discover-scan'; seed: string | null; output: 'terminal' | 'json' | 'jsonl' | 'csv' | 'domains'; preset: 'common' | 'impersonation' | 'all' | 'custom'; keyboardLayout: 'qwerty' | 'azerty' | 'qwertz' | 'all'; tldText: string | null; dictionarySource: string | null; familyText: string | null; deep: boolean; scanLimit: number; chunkSize: number; concurrency: number; checkpoint: string | null; resume: boolean; resolverText: string | null; observationSnapshot: string | null; allowlistSource: string | null; filter: 'all' | 'registered' | 'inconclusive' | 'acquisition' | 'suppressed'; events: boolean } & TerminalOptions)
  | ({ action: 'posture'; domain: string | null; output: 'terminal' | 'json'; selectorText: string | null; retiredSelectorText: string | null; mailProfile: 'defensive_no_mail' | 'parked' | 'standard' } & TerminalOptions)
  | ({ action: 'http'; domain: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'tls'; hostname: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'registry-support'; target: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'risk-calibrate'; source: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'verify-artifact'; source: string | null; passphraseSource: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | InspectArchiveArguments
  | SignArtifactArguments
  | VerifySignatureArguments
  | ({ action: 'source-report'; source: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'compare'; source: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'page-compare'; leftSource: string; rightSource: string; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'mail-review'; source: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'diff'; leftSource: string; rightSource: string; output: 'terminal' | 'json' } & TerminalOptions)
  | { action: 'export'; source: string | null; format: 'json' | 'markdown' | 'html'; compact: boolean };
type CliArguments = CliAction & FileOutputOptions;

type ExtractedFileOutput = {
  argv: string[];
  destination: string | null;
  force: boolean;
};

function boundedArgument(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_CLI_ARGUMENT_LENGTH || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) {
    throw new CliUsageError('Arguments must be bounded text without control characters.');
  }
  return value;
}

function isCliCommand(value: string): value is CliCommand {
  return (CLI_COMMANDS as readonly string[]).includes(value);
}

function extractFileOutputArguments(argv: string[]): ExtractedFileOutput {
  const retained: string[] = [];
  let destination: string | null = null;
  let force = false;
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
    } else {
      retained.push(argument);
    }
  }
  if (force && destination === null) throw new CliUsageError('--force requires --output.');
  return { argv: retained, destination, force };
}

function parseCliArguments(rawArgv: unknown): CliArguments {
  if (!Array.isArray(rawArgv) || rawArgv.length > MAX_CLI_ARGUMENTS) {
    throw new CliUsageError(`At most ${MAX_CLI_ARGUMENTS} command arguments are supported.`);
  }
  const extracted = extractFileOutputArguments(rawArgv.map(boundedArgument));
  const parsed = parseCliArgumentsCore(extracted.argv);
  if ('quiet' in parsed && parsed.quiet && extracted.destination !== null) {
    throw new CliUsageError('--quiet cannot be combined with --output.');
  }
  if ('events' in parsed && parsed.events && extracted.destination !== null) {
    throw new CliUsageError('--events cannot be combined with --output because completion must describe the final output delivery.');
  }
  return extracted.destination === null
    ? parsed
    : { ...parsed, destination: extracted.destination, ...(extracted.force ? { force: true as const } : {}) };
}

function parseCliArgumentsCore(argv: string[]): CliAction {
  if (!argv.length) return { action: 'help' };
  const firstArgument = argv[0] ?? '';
  const helpRequested = argv.includes('--help') || argv.includes('-h');
  if (helpRequested) {
    if (argv.length === 1) return { action: 'help' };
    if (argv.length === 2 && isCliCommand(firstArgument)) return { action: 'help', command: firstArgument };
    throw new CliUsageError('Help accepts only an optional command name.');
  }
  if (firstArgument === '--version' || firstArgument === '-V') {
    if (argv.length !== 1) throw new CliUsageError('--version does not accept other arguments.');
    return { action: 'version' };
  }

  const command = firstArgument;
  if (!isCliCommand(command)) {
    throw new CliUsageError(`Unknown command "${command}". This release supports: ${CLI_COMMANDS.join(', ')}.`);
  }
  if (command === 'bulk') return parseBulkArguments(argv.slice(1));
  if (command === 'completion') return parseCompletionArguments(argv.slice(1));
  if (command === 'doctor') return parseDoctorArguments(argv.slice(1));
  if (command === 'manual') return parseManualArguments(argv.slice(1));
  if (command === 'ct-search') return parseCtSearchArguments(argv.slice(1));
  if (command === 'discover') return parseDiscoverArguments(argv.slice(1));
  if (command === 'discover-scan') return parseDiscoverScanArguments(argv.slice(1));
  if (command === 'posture') return parsePostureArguments(argv.slice(1));
  if (command === 'http') return parseHttpArguments(argv.slice(1));
  if (command === 'tls') return parseTlsArguments(argv.slice(1));
  if (command === 'registry-support') return parseRegistrySupportArguments(argv.slice(1));
  if (command === 'risk-calibrate') return parseRiskCalibrateArguments(argv.slice(1));
  if (command === 'verify-artifact') return parseVerifyArtifactArguments(argv.slice(1));
  if (command === 'inspect-archive') return parseInspectArchiveArguments(argv.slice(1));
  if (command === 'sign-artifact') return parseSignArtifactArguments(argv.slice(1));
  if (command === 'verify-signature') return parseVerifySignatureArguments(argv.slice(1));
  if (command === 'source-report') return parseSourceReportArguments(argv.slice(1));
  if (command === 'compare') return parseCompareArguments(argv.slice(1));
  if (command === 'page-compare') return parsePageCompareArguments(argv.slice(1));
  if (command === 'mail-review') return parseMailReviewArguments(argv.slice(1));
  if (command === 'diff') return parseDiffArguments(argv.slice(1));
  if (command === 'export') return parseExportArguments(argv.slice(1));
  let query: string | null = null;
  let output: 'terminal' | 'json' | 'markdown' | 'html' = 'terminal';
  let deep = false;
  let scanMode: 'fast' | 'deep' | null = null;
  let quiet = false;
  let color = true;
  let detail: LookupDetail = 'standard';
  let detailSet = false;
  let strictExit = false;
  let events = false;
  for (const argument of argv.slice(1)) {
    if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('Choose only one output format.');
      output = 'json';
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
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (query === null) query = argument;
    else throw new CliUsageError('lookup accepts one query. Use the bulk command for multiple inputs.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  if (detailSet && output !== 'terminal') throw new CliUsageError('--summary and --verbose apply only to terminal output.');
  return { action: 'lookup', query, output, deep, detail, strictExit, events, quiet, color };
}

function parseCompletionArguments(argv: string[]): Extract<CliArguments, { action: 'completion' }> {
  if (argv.length !== 1 || !['bash', 'zsh', 'fish'].includes(argv[0] || '')) {
    throw new CliUsageError('completion requires exactly one shell: bash, zsh, or fish.');
  }
  return { action: 'completion', shell: argv[0] as CompletionShell };
}

function parseManualArguments(argv: string[]): Extract<CliArguments, { action: 'manual' }> {
  if (argv.length !== 0) throw new CliUsageError('manual does not accept command arguments.');
  return { action: 'manual' };
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
  let output: 'terminal' | 'json' | 'jsonl' | 'csv' | 'domains' = 'terminal';
  let deep = false;
  let scanMode: 'fast' | 'deep' | null = null;
  let quiet = false;
  let color = true;
  let concurrency: number | null = null;
  let checkpoint: string | null = null;
  let resume = false;
  let events = false;
  let filter: 'all' | 'registered' | 'inconclusive' = 'all';
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === undefined) break;
    if (argument === '--json' || argument === '--jsonl' || argument === '--csv' || argument === '--domains') {
      if (output !== 'terminal') throw new CliUsageError('Choose only one output format.');
      output = argument === '--json' ? 'json' : argument === '--jsonl' ? 'jsonl' : argument === '--csv' ? 'csv' : 'domains';
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
    } else if (argument === '--registered-only' || argument === '--inconclusive-only') {
      if (filter !== 'all') throw new CliUsageError('--registered-only and --inconclusive-only are mutually exclusive and may be supplied only once.');
      filter = argument === '--registered-only' ? 'registered' : 'inconclusive';
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (source === null) source = argument;
    else throw new CliUsageError('bulk accepts one optional input file. Otherwise pipe newline-delimited queries on stdin.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  if (resume && checkpoint === null) throw new CliUsageError('--resume requires --checkpoint.');
  const maximum = deep ? 3 : 8;
  if (concurrency !== null && concurrency > maximum) {
    throw new CliUsageError(`--concurrency is capped at ${maximum} in ${deep ? 'deep' : 'fast'} bulk mode.`);
  }
  return { action: 'bulk', source, output, deep, quiet, color, concurrency: concurrency ?? (deep ? 2 : 4), checkpoint, resume, events, filter };
}

function parseCtSearchArguments(argv: string[]): Extract<CliArguments, { action: 'ct-search' }> {
  let keyword: string | null = null;
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
    else if (keyword === null) keyword = argument;
    else throw new CliUsageError('ct-search accepts one keyword. Quote multi-word keywords as one argument.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'ct-search', keyword, output, quiet, color };
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
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  if (dictionarySource && preset === 'common') throw new CliUsageError('--dictionary requires the impersonation or all preset.');
  return {
    action: 'discover-scan', seed, output, quiet, color, preset, keyboardLayout, tldText,
    dictionarySource, familyText, deep, scanLimit: scanLimit ?? Math.min(100, maximum),
    chunkSize: chunkSize ?? 25, concurrency: concurrency ?? (deep ? 2 : 4), checkpoint,
    resume, resolverText, observationSnapshot, allowlistSource, filter, events,
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
  let output: 'terminal' | 'json' = 'terminal';
  let quiet = false;
  let color = true;
  let selectorText: string | null = null;
  let retiredSelectorText: string | null = null;
  let mailProfile: 'defensive_no_mail' | 'parked' | 'standard' = 'standard';
  let mailProfileSeen = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === undefined) break;
    if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('--json may be supplied only once.');
      output = 'json';
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
  return { action: 'posture', domain, output, quiet, color, selectorText, retiredSelectorText, mailProfile };
}

function parseHttpArguments(argv: string[]): Extract<CliArguments, { action: 'http' }> {
  let domain: string | null = null;
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
    else if (domain === null) domain = argument;
    else throw new CliUsageError('http accepts one domain.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'http', domain, output, quiet, color };
}

function parseTlsArguments(argv: string[]): Extract<CliArguments, { action: 'tls' }> {
  let hostname: string | null = null;
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
    else if (hostname === null) hostname = argument;
    else throw new CliUsageError('tls accepts one hostname.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'tls', hostname, output, quiet, color };
}

function parseCompareArguments(argv: string[]): Extract<CliArguments, { action: 'compare' }> {
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
    else throw new CliUsageError('compare accepts one optional lookup JSON file. Otherwise pipe one lookup document on stdin.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'compare', source, output, quiet, color };
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
    else throw new CliUsageError('mail-review accepts one optional Bulk JSON or JSONL input file.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'mail-review', source, output, quiet, color };
}

function parseDiffArguments(argv: string[]): Extract<CliArguments, { action: 'diff' }> {
  let leftSource: string | null = null;
  let rightSource: string | null = null;
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
    else if (leftSource === null) leftSource = argument;
    else if (rightSource === null) rightSource = argument;
    else throw new CliUsageError('diff accepts exactly two saved lookup JSON files.');
  }
  if (!leftSource || !rightSource) throw new CliUsageError('diff requires exactly two saved lookup JSON files.');
  if (leftSource === rightSource) throw new CliUsageError('diff requires two different input files.');
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'diff', leftSource, rightSource, output, quiet, color };
}

function parseRegistrySupportArguments(argv: string[]): Extract<CliArguments, { action: 'registry-support' }> {
  let target: string | null = null;
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
    else if (target === null) target = argument;
    else throw new CliUsageError('registry-support accepts one domain or suffix.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'registry-support', target, output, quiet, color };
}

function parseRiskCalibrateArguments(argv: string[]): Extract<CliArguments, { action: 'risk-calibrate' }> {
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
    else throw new CliUsageError('risk-calibrate accepts one optional dataset file. Otherwise pipe one dataset on stdin.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'risk-calibrate', source, output, quiet, color };
}

function parseVerifyArtifactArguments(argv: string[]): Extract<CliArguments, { action: 'verify-artifact' }> {
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
      if (!value || value.startsWith('-')) {
        throw new CliUsageError('--passphrase-file requires one bounded UTF-8 file.');
      }
      passphraseSource = value;
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (source === null) source = argument;
    else throw new CliUsageError('verify-artifact accepts one optional JSON file. Otherwise pipe one artifact on stdin.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'verify-artifact', source, passphraseSource, output, quiet, color };
}

function parseSourceReportArguments(argv: string[]): Extract<CliArguments, { action: 'source-report' }> {
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
    else throw new CliUsageError('source-report accepts one optional JSON file. Otherwise pipe lookup documents on stdin.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'source-report', source, output, quiet, color };
}

function parseExportArguments(argv: string[]): Extract<CliArguments, { action: 'export' }> {
  let source: string | null = null;
  let compact = false;
  let format: 'json' | 'markdown' | 'html' = 'json';
  for (const argument of argv) {
    if (argument === '--compact') {
      if (compact) throw new CliUsageError('--compact may be supplied only once.');
      compact = true;
    } else if (argument === '--markdown' || argument === '--html') {
      if (format !== 'json') throw new CliUsageError('Choose only one evidence export format.');
      format = argument === '--markdown' ? 'markdown' : 'html';
    } else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (source === null) source = argument;
    else throw new CliUsageError('export accepts one optional lookup JSON file. Otherwise pipe one lookup document on stdin.');
  }
  if (compact && format !== 'json') throw new CliUsageError('--compact applies to JSON export and cannot be combined with --markdown or --html.');
  return { action: 'export', source, format, compact };
}

export { CLI_COMMANDS, CliUsageError, MAX_CLI_ARGUMENTS, MAX_CLI_ARGUMENT_LENGTH, parseCliArguments };
export type { CliArguments, CliCommand, CompletionShell, LookupDetail };
