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
  if (command !== 'lookup') throw new CliUsageError(`Unknown command "${command}". This release supports: lookup.`);
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
    else throw new CliUsageError('lookup accepts one query. Use a future bulk command for multiple inputs.');
  }
  if (quiet && output !== 'terminal') throw new CliUsageError('--quiet cannot be combined with machine-readable output.');
  return { action: 'lookup', query, output, deep, quiet, color };
}

module.exports = { CliUsageError, MAX_CLI_ARGUMENTS, MAX_CLI_ARGUMENT_LENGTH, parseCliArguments };
