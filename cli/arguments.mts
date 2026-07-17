const MAX_CLI_ARGUMENTS = 32;
const MAX_CLI_ARGUMENT_LENGTH = 1024;

type TerminalOptions = {
  quiet: boolean;
  color: boolean;
};

type CliArguments =
  | { action: 'help' }
  | { action: 'version' }
  | ({ action: 'lookup'; query: string | null; output: 'terminal' | 'json'; deep: boolean } & TerminalOptions)
  | ({ action: 'bulk'; source: string | null; output: 'terminal' | 'json' | 'jsonl'; deep: boolean; concurrency: number } & TerminalOptions)
  | ({ action: 'ct-search'; keyword: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'discover'; seed: string | null; output: 'terminal' | 'json' | 'jsonl'; preset: 'common' | 'impersonation' | 'all'; keyboardLayout: 'qwerty' | 'azerty' | 'qwertz'; tldText: string | null } & TerminalOptions)
  | ({ action: 'posture'; domain: string | null; output: 'terminal' | 'json'; selectorText: string | null } & TerminalOptions)
  | ({ action: 'http'; domain: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'tls'; hostname: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'registry-support'; target: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'risk-calibrate'; source: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | ({ action: 'compare'; source: string | null; output: 'terminal' | 'json' } & TerminalOptions)
  | { action: 'export'; source: string | null; format: 'json' | 'markdown' | 'html'; compact: boolean };

class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

function boundedArgument(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_CLI_ARGUMENT_LENGTH || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) {
    throw new CliUsageError('Arguments must be bounded text without control characters.');
  }
  return value;
}

function parseCliArguments(rawArgv: unknown): CliArguments {
  if (!Array.isArray(rawArgv) || rawArgv.length > MAX_CLI_ARGUMENTS) {
    throw new CliUsageError(`At most ${MAX_CLI_ARGUMENTS} command arguments are supported.`);
  }
  const argv = rawArgv.map(boundedArgument);
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) return { action: 'help' };
  if (argv[0] === '--version' || argv[0] === '-V') {
    if (argv.length !== 1) throw new CliUsageError('--version does not accept other arguments.');
    return { action: 'version' };
  }

  const command = argv[0];
  if (!['lookup', 'bulk', 'ct-search', 'discover', 'posture', 'http', 'tls', 'registry-support', 'risk-calibrate', 'compare', 'export'].includes(command)) {
    throw new CliUsageError(`Unknown command "${command}". This release supports: lookup, bulk, ct-search, discover, posture, http, tls, registry-support, risk-calibrate, compare, export.`);
  }
  if (command === 'bulk') return parseBulkArguments(argv.slice(1));
  if (command === 'ct-search') return parseCtSearchArguments(argv.slice(1));
  if (command === 'discover') return parseDiscoverArguments(argv.slice(1));
  if (command === 'posture') return parsePostureArguments(argv.slice(1));
  if (command === 'http') return parseHttpArguments(argv.slice(1));
  if (command === 'tls') return parseTlsArguments(argv.slice(1));
  if (command === 'registry-support') return parseRegistrySupportArguments(argv.slice(1));
  if (command === 'risk-calibrate') return parseRiskCalibrateArguments(argv.slice(1));
  if (command === 'compare') return parseCompareArguments(argv.slice(1));
  if (command === 'export') return parseExportArguments(argv.slice(1));
  let query: string | null = null;
  let output: 'terminal' | 'json' = 'terminal';
  let deep = false;
  let scanMode: 'fast' | 'deep' | null = null;
  let quiet = false;
  let color = true;
  for (const argument of argv.slice(1)) {
    if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('Choose only one output format.');
      output = 'json';
    } else if (argument === '--deep') {
      if (scanMode) throw new CliUsageError('--fast and --deep are mutually exclusive and may be supplied only once.');
      deep = true;
      scanMode = 'deep';
    } else if (argument === '--fast') {
      if (scanMode) throw new CliUsageError('--fast and --deep are mutually exclusive and may be supplied only once.');
      deep = false;
      scanMode = 'fast';
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (query === null) query = argument;
    else throw new CliUsageError('lookup accepts one query. Use the bulk command for multiple inputs.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'lookup', query, output, deep, quiet, color };
}

function parseBulkArguments(argv: string[]): Extract<CliArguments, { action: 'bulk' }> {
  let source: string | null = null;
  let output: 'terminal' | 'json' | 'jsonl' = 'terminal';
  let deep = false;
  let scanMode: 'fast' | 'deep' | null = null;
  let quiet = false;
  let color = true;
  let concurrency: number | null = null;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--json' || argument === '--jsonl') {
      if (output !== 'terminal') throw new CliUsageError('Choose only one output format.');
      output = argument === '--json' ? 'json' : 'jsonl';
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
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (source === null) source = argument;
    else throw new CliUsageError('bulk accepts one optional input file. Otherwise pipe newline-delimited queries on stdin.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  const maximum = deep ? 3 : 8;
  if (concurrency !== null && concurrency > maximum) {
    throw new CliUsageError(`--concurrency is capped at ${maximum} in ${deep ? 'deep' : 'fast'} bulk mode.`);
  }
  return { action: 'bulk', source, output, deep, quiet, color, concurrency: concurrency ?? (deep ? 2 : 4) };
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
  let output: 'terminal' | 'json' | 'jsonl' = 'terminal';
  let quiet = false;
  let color = true;
  let preset: 'common' | 'impersonation' | 'all' = 'all';
  let keyboardLayout: 'qwerty' | 'azerty' | 'qwertz' = 'qwerty';
  let tldText: string | null = null;
  let presetSet = false;
  let keyboardSet = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--json' || argument === '--jsonl') {
      if (output !== 'terminal') throw new CliUsageError('Choose only one output format.');
      output = argument === '--json' ? 'json' : 'jsonl';
    } else if (argument === '--preset') {
      if (presetSet) throw new CliUsageError('--preset may be supplied only once.');
      const value = argv[++index];
      if (value !== 'common' && value !== 'impersonation' && value !== 'all') {
        throw new CliUsageError('--preset requires common, impersonation, or all.');
      }
      preset = value;
      presetSet = true;
    } else if (argument === '--keyboard') {
      if (keyboardSet) throw new CliUsageError('--keyboard may be supplied only once.');
      const value = argv[++index];
      if (value !== 'qwerty' && value !== 'azerty' && value !== 'qwertz') {
        throw new CliUsageError('--keyboard requires qwerty, azerty, or qwertz.');
      }
      keyboardLayout = value;
      keyboardSet = true;
    } else if (argument === '--tlds') {
      if (tldText !== null) throw new CliUsageError('--tlds may be supplied only once.');
      const value = argv[++index];
      if (!value) throw new CliUsageError('--tlds requires a comma-separated list.');
      tldText = value;
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (seed === null) seed = argument;
    else throw new CliUsageError('discover accepts one brand label or domain. Quote multi-word labels as one argument.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'discover', seed, output, quiet, color, preset, keyboardLayout, tldText };
}

function parsePostureArguments(argv: string[]): Extract<CliArguments, { action: 'posture' }> {
  let domain: string | null = null;
  let output: 'terminal' | 'json' = 'terminal';
  let quiet = false;
  let color = true;
  let selectorText: string | null = null;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--json') {
      if (output !== 'terminal') throw new CliUsageError('--json may be supplied only once.');
      output = 'json';
    } else if (argument === '--selectors') {
      if (selectorText !== null) throw new CliUsageError('--selectors may be supplied only once.');
      const value = argv[++index];
      if (!value) throw new CliUsageError('--selectors requires a comma-separated list.');
      selectorText = value;
    } else if (argument === '--quiet') quiet = true;
    else if (argument === '--no-color') color = false;
    else if (argument.startsWith('-')) throw new CliUsageError(`Unknown option "${argument}".`);
    else if (domain === null) domain = argument;
    else throw new CliUsageError('posture accepts one domain.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'posture', domain, output, quiet, color, selectorText };
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

export { CliUsageError, MAX_CLI_ARGUMENTS, MAX_CLI_ARGUMENT_LENGTH, parseCliArguments };
export type { CliArguments };
