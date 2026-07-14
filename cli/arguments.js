'use strict';

const MAX_CLI_ARGUMENTS = 32;
const MAX_CLI_ARGUMENT_LENGTH = 1024;

class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CliUsageError';
  }
}

function boundedArgument(value) {
  if (typeof value !== 'string' || value.length > MAX_CLI_ARGUMENT_LENGTH || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) {
    throw new CliUsageError('Arguments must be bounded text without control characters.');
  }
  return value;
}

function parseCliArguments(rawArgv) {
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
  if (!['lookup', 'bulk', 'ct-search', 'discover', 'posture', 'http', 'tls'].includes(command)) {
    throw new CliUsageError(`Unknown command "${command}". This release supports: lookup, bulk, ct-search, discover, posture, http, tls.`);
  }
  if (command === 'bulk') return parseBulkArguments(argv.slice(1));
  if (command === 'ct-search') return parseCtSearchArguments(argv.slice(1));
  if (command === 'discover') return parseDiscoverArguments(argv.slice(1));
  if (command === 'posture') return parsePostureArguments(argv.slice(1));
  if (command === 'http') return parseHttpArguments(argv.slice(1));
  if (command === 'tls') return parseTlsArguments(argv.slice(1));
  let query = null;
  let output = 'terminal';
  let deep = false;
  let scanMode = null;
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

function parseBulkArguments(argv) {
  let source = null;
  let output = 'terminal';
  let deep = false;
  let scanMode = null;
  let quiet = false;
  let color = true;
  let concurrency = null;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--json' || argument === '--jsonl') {
      if (output !== 'terminal') throw new CliUsageError('Choose only one output format.');
      output = argument.slice(2);
    } else if (argument === '--deep' || argument === '--fast') {
      if (scanMode) throw new CliUsageError('--fast and --deep are mutually exclusive and may be supplied only once.');
      scanMode = argument.slice(2);
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

function parseCtSearchArguments(argv) {
  let keyword = null;
  let output = 'terminal';
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

function parseDiscoverArguments(argv) {
  let seed = null;
  let output = 'terminal';
  let quiet = false;
  let color = true;
  let preset = 'all';
  let keyboardLayout = 'qwerty';
  let tldText = null;
  let presetSet = false;
  let keyboardSet = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--json' || argument === '--jsonl') {
      if (output !== 'terminal') throw new CliUsageError('Choose only one output format.');
      output = argument.slice(2);
    } else if (argument === '--preset') {
      if (presetSet) throw new CliUsageError('--preset may be supplied only once.');
      const value = argv[++index];
      if (!['common', 'impersonation', 'all'].includes(value)) {
        throw new CliUsageError('--preset requires common, impersonation, or all.');
      }
      preset = value;
      presetSet = true;
    } else if (argument === '--keyboard') {
      if (keyboardSet) throw new CliUsageError('--keyboard may be supplied only once.');
      const value = argv[++index];
      if (!['qwerty', 'azerty', 'qwertz'].includes(value)) {
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

function parsePostureArguments(argv) {
  let domain = null;
  let output = 'terminal';
  let quiet = false;
  let color = true;
  let selectorText = null;
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

function parseHttpArguments(argv) {
  let domain = null;
  let output = 'terminal';
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

function parseTlsArguments(argv) {
  let hostname = null;
  let output = 'terminal';
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

module.exports = { CliUsageError, MAX_CLI_ARGUMENTS, MAX_CLI_ARGUMENT_LENGTH, parseCliArguments };
