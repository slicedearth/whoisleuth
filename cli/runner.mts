import { createRequire } from 'node:module';

import { abortable } from '../lib/abort.mts';
import { parseCliArguments } from './arguments.mts';
import type { CliArguments } from './arguments.mts';
import type { BoundedTextStream } from './bulk.mts';
import {
  HELP,
  commandDefinition,
  commandHelp,
} from './command-reference.mts';
import { boundedCliErrorMessage, CliUsageError } from './errors.mts';
import {
  evidenceCommandFailureLabel,
  isEvidenceCommand,
  runEvidenceCommand,
} from './evidence-command-runner.mts';
import EXIT_CODES from './exit-codes.mts';
import { readCliTextInput } from './input.mts';
import { INLINE_CLI_COMMANDS, runInlineCommand } from './inline-command-runner.mts';
import {
  canLaunchInteractiveCli,
  launchInteractiveCli,
  type InteractiveLauncherInput,
  type InteractiveLauncherOutput,
} from './interactive-launcher.mts';
import {
  MAX_OFFLINE_PASSPHRASE_FILE_BYTES,
} from './artifact-verify.mts';
import { cleanupPendingOutputFiles, createBufferedOutput, writePrivateFile } from './output-file.mts';
import { createTerminalProgress, type TerminalProgress } from './progress.mts';
import type { CliProgressEvents } from './progress-events.mts';
import type { CliCommandContext, CliDependencies, WritableLike } from './runner-types.mts';
import {
  presentTerminalOutput,
  terminalPresentation,
  type TerminalEnvironment,
  type TerminalPalette,
} from './terminal-presentation.mts';

const require = createRequire(import.meta.url);
const { version: VERSION } = require('../package.json') as { version: string };
const MAX_STDIN_BYTES = 4096;

async function readStdinBounded(
  stream: BoundedTextStream | null | undefined,
  limit = MAX_STDIN_BYTES,
  signal?: AbortSignal,
): Promise<string> {
  const text = (await readCliTextInput(null, stream, {
    maximumBytes: limit,
    label: 'Standard input',
    ...(signal ? { signal } : {}),
  })).trim();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1) throw new CliUsageError('Single-value commands accept one stdin line. Use the bulk command for multiple inputs.');
  return lines[0] || '';
}

function write(stream: WritableLike | null | undefined, value: string): void {
  if (stream && typeof stream.write === 'function') stream.write(value);
}

function formatForTerminal(
  value: string,
  stream: WritableLike,
  color: boolean,
  environment: TerminalEnvironment,
  palette: TerminalPalette,
): string {
  return presentTerminalOutput(value, terminalPresentation(stream, color, environment, palette));
}

function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  if (error instanceof AggregateError) {
    return error.errors.length > 0 && error.errors.every((item) => isCancellation(item));
  }
  return signal?.aborted === true
    || Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
}

function usageEventReason(error: unknown): string {
  const message = boundedCliErrorMessage(error, 'Invalid command input').toLowerCase();
  if (message.includes('could not read')) return 'input_unavailable';
  if (message.includes('cannot be combined') || message.includes('mutually exclusive')) return 'conflicting_options';
  if (message.includes('requires') || message.includes('did not contain')) return 'missing_input';
  return 'invalid_input';
}

async function runParsedCli(args: CliArguments, dependencies: CliDependencies = {}): Promise<number> {
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  const environment = dependencies.environment || process.env;
  let progress: TerminalProgress | null = null;
  const eventProgress: { current: CliProgressEvents | null } = { current: null };
  let failureLabel = 'Lookup';
  try {
    const palette = args.palette || 'auto';
    const terminal = (value: string, color = true) => formatForTerminal(value, stdout, color, environment, palette);
    const beginProgress = (message: string): TerminalProgress => {
      const terminalOutput = 'output' in args
        && args.output === 'terminal'
        && 'quiet' in args
        && 'color' in args;
      const eventOutput = 'events' in args && args.events;
      const enabled = terminalOutput && !args.quiet && !eventOutput;
      progress = createTerminalProgress(stderr, {
        enabled,
        color: terminalOutput ? args.color : false,
        environment,
        palette,
        ...(dependencies.nowMs ? { now: dependencies.nowMs } : {}),
      });
      progress.start(message);
      return progress;
    };
    const endProgress = () => {
      progress?.stop();
      progress = null;
    };
    const withProgress = async <T,>(message: string, operation: () => T | Promise<T>): Promise<T> => {
      beginProgress(message);
      try {
        return await abortable(operation, dependencies.signal);
      } finally {
        endProgress();
      }
    };
    const readSingleInput = async (): Promise<string> => (
      dependencies.readStdin
        ? await dependencies.readStdin()
        : await readStdinBounded(dependencies.stdin || process.stdin, MAX_STDIN_BYTES, dependencies.signal)
    );
    const readInput = async (source: string | null | undefined, maximumBytes: number, label: string): Promise<string> => (
      readCliTextInput(source, dependencies.stdin || process.stdin, {
        maximumBytes,
        label,
        ...(dependencies.signal ? { signal: dependencies.signal } : {}),
      })
    );
    const readPassphraseSource = async (source: string): Promise<string> => {
      let passphraseText: string;
      try {
        passphraseText = dependencies.readPassphraseFile
          ? await dependencies.readPassphraseFile(source)
          : await readInput(source, MAX_OFFLINE_PASSPHRASE_FILE_BYTES, 'Passphrase file');
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read passphrase file: ${boundedCliErrorMessage(error, 'File could not be read')}`);
      }
      const passphrase = passphraseText.replace(/\r?\n$/u, '');
      if (!passphrase || /[\r\n\u0000]/u.test(passphrase)) {
        throw new CliUsageError('Passphrase file must contain exactly one non-empty UTF-8 line.');
      }
      return passphrase;
    };
    const commandContext: CliCommandContext = Object.freeze({
      packageVersion: VERSION,
      stdout,
      stderr,
      terminal,
      presentation: (color: boolean) => terminalPresentation(stdout, color, environment, palette),
      writeStdout: (value: string) => write(stdout, value),
      writeStderr: (value: string) => write(stderr, value),
      readSingleInput,
      readInput,
      readPassphraseSource,
      now: () => dependencies.now ? dependencies.now() : new Date().toISOString(),
      beginProgress,
      endProgress,
      withProgress,
      setEventProgress: (next: CliProgressEvents) => {
        eventProgress.current = next;
      },
      setFailureLabel: (label: string) => {
        failureLabel = label;
      },
      executeCli: (argv: readonly string[], overrides: CliDependencies = {}) => runCli(argv, {
        ...dependencies,
        ...overrides,
      }),
    });
    if (args.action === 'help') {
      write(stdout, terminal(args.command ? commandHelp(args.command) : HELP));
      return EXIT_CODES.SUCCESS;
    }
    if (args.action === 'version') { write(stdout, `${VERSION}\n`); return EXIT_CODES.SUCCESS; }

    const handlerOwner = commandDefinition(args.action).execution.handlerOwner;
    if (handlerOwner === 'bulk') {
      if (args.action !== 'bulk') throw new Error('Bulk command registry ownership is inconsistent.');
      failureLabel = 'Bulk lookup';
      const { runBulkCommand } = await import('./bulk-command-runner.mts');
      return await runBulkCommand(args, dependencies, commandContext);
    }
    if (handlerOwner === 'discovery') {
      if (args.action !== 'discover') throw new Error('Discovery command registry ownership is inconsistent.');
      failureLabel = 'Candidate generation';
      const { runDiscoveryCommand } = await import('./discovery-command-runner.mts');
      return await runDiscoveryCommand(args, dependencies, commandContext);
    }
    if (handlerOwner === 'discovery_scan') {
      if (args.action !== 'discover-scan') throw new Error('Discovery-scan command registry ownership is inconsistent.');
      failureLabel = 'Candidate scan';
      const { runDiscoveryScanCommand } = await import('./discovery-scan-command-runner.mts');
      return await runDiscoveryScanCommand(args, dependencies, commandContext);
    }
    if (handlerOwner === 'evidence') {
      if (!isEvidenceCommand(args)) throw new Error('Evidence command registry ownership is inconsistent.');
      failureLabel = evidenceCommandFailureLabel(args.action);
      const evidenceStdout = args.action !== 'sign-artifact' && args.output === 'terminal'
        ? { write: (value: string) => write(stdout, terminal(value, args.color)) }
        : stdout;
      return await runEvidenceCommand(args, {
        stdout: evidenceStdout,
        stdin: dependencies.stdin || process.stdin,
        readArtifactInput: dependencies.readArtifactInput,
        readPassphraseFile: dependencies.readPassphraseFile,
        readPrivateKeyFile: dependencies.readPrivateKeyFile,
        readPublicKeyFile: dependencies.readPublicKeyFile,
        now: dependencies.now,
        signal: dependencies.signal,
      });
    }
    if (handlerOwner === 'network') {
      if (args.action !== 'ct-search'
        && args.action !== 'posture'
        && args.action !== 'http'
        && args.action !== 'tls'
        && args.action !== 'dnssec-validate'
        && args.action !== 'mail-transport') {
        throw new Error('Network command registry ownership is inconsistent.');
      }
      failureLabel = args.action === 'ct-search'
        ? 'Certificate Transparency search'
        : args.action === 'posture'
          ? 'Domain posture audit'
          : args.action === 'http'
            ? 'HTTP probe'
            : args.action === 'tls'
              ? 'TLS evidence collection'
              : args.action === 'dnssec-validate'
                ? 'DNSSEC chain validation'
                : 'Mail transport review';
      const { runNetworkCommand } = await import('./network-command-runner.mts');
      return await runNetworkCommand(args, dependencies, commandContext);
    }
    if (handlerOwner === 'lookup') {
      if (args.action !== 'lookup') throw new Error('Lookup command registry ownership is inconsistent.');
      const { runLookupCommand } = await import('./lookup-command-runner.mts');
      return await runLookupCommand(args, dependencies, commandContext);
    }
    if (handlerOwner !== 'inline' || !INLINE_CLI_COMMANDS.includes(args.action)) {
      throw new Error('No CLI execution route is registered for the parsed command.');
    }

    return await runInlineCommand(args, dependencies, commandContext);
  } catch (error) {
    (progress as TerminalProgress | null)?.stop();
    progress = null;
    if (isCancellation(error, dependencies.signal)) {
      eventProgress.current?.emit({ event: 'cancelled', exitCode: EXIT_CODES.CANCELLED });
      if (!eventProgress.current?.enabled) write(stderr, 'Cancelled by analyst.\n');
      return EXIT_CODES.CANCELLED;
    }
    if (error instanceof CliUsageError) {
      eventProgress.current?.emit({
        event: 'failed',
        state: 'usage',
        reason: usageEventReason(error),
        exitCode: EXIT_CODES.USAGE,
      });
      if (!eventProgress.current?.enabled) write(stderr, `Usage error: ${boundedCliErrorMessage(error, 'Invalid command')}\n`);
      return EXIT_CODES.USAGE;
    }
    eventProgress.current?.emit({ event: 'failed', state: 'operational', exitCode: EXIT_CODES.LOOKUP_FAILED });
    if (!eventProgress.current?.enabled) write(stderr, `${failureLabel} failed: ${boundedCliErrorMessage(error, 'Unexpected command failure')}\n`);
    return EXIT_CODES.LOOKUP_FAILED;
  }
}

async function runCliCommand(argv: unknown, dependencies: CliDependencies = {}): Promise<number> {
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  const environment = dependencies.environment || process.env;
  if (Array.isArray(argv) && argv.length === 0) {
    const input = (dependencies.stdin || process.stdin) as InteractiveLauncherInput;
    const output = stdout as InteractiveLauncherOutput;
    const supportsInteractiveLaunch = dependencies.canLaunchInteractiveCli || canLaunchInteractiveCli;
    if (supportsInteractiveLaunch(input, output, environment)) {
      const launch = dependencies.launchInteractiveCli || launchInteractiveCli;
      try {
        const launchedArgv = await launch({
          input,
          output,
          environment,
          ...(dependencies.signal ? { signal: dependencies.signal } : {}),
        });
        if (launchedArgv === null) return EXIT_CODES.SUCCESS;
        argv = launchedArgv;
      } catch (error) {
        if (isCancellation(error, dependencies.signal)) {
          write(stderr, 'Cancelled by analyst.\n');
          return EXIT_CODES.CANCELLED;
        }
        if (error instanceof CliUsageError) {
          write(stderr, `Usage error: ${boundedCliErrorMessage(error, 'Invalid interactive selection')}\n`);
          return EXIT_CODES.USAGE;
        }
        write(stderr, `CLI startup failed: ${boundedCliErrorMessage(error, 'Interactive launch failed')}\n`);
        return EXIT_CODES.INTERNAL_ERROR;
      }
    }
  }
  let args: CliArguments;
  try {
    args = parseCliArguments(argv);
  } catch (error) {
    if (error instanceof CliUsageError) {
      write(stderr, `Usage error: ${boundedCliErrorMessage(error, 'Invalid command')}\n`);
      return EXIT_CODES.USAGE;
    }
    write(stderr, `CLI startup failed: ${boundedCliErrorMessage(error, 'Unexpected command failure')}\n`);
    return EXIT_CODES.INTERNAL_ERROR;
  }
  if (!args.destination) return runParsedCli(args, dependencies);
  const buffered = createBufferedOutput();
  const code = await runParsedCli(args, { ...dependencies, stdout: buffered.stream });
  if (code !== EXIT_CODES.SUCCESS && code !== EXIT_CODES.PARTIAL_FAILURE) return code;
  try {
    await writePrivateFile(args.destination, buffered.value(), { force: args.force === true });
    return code;
  } catch (error) {
    if (error instanceof CliUsageError) {
      write(stderr, `Usage error: ${boundedCliErrorMessage(error, 'Output file could not be written')}\n`);
      return EXIT_CODES.USAGE;
    }
    write(stderr, `Output failed: ${boundedCliErrorMessage(error, 'Output file could not be written')}\n`);
    return EXIT_CODES.LOOKUP_FAILED;
  }
}

async function runCli(argv: unknown, dependencies: CliDependencies = {}): Promise<number> {
  const stderr = dependencies.stderr || process.stderr;
  try {
    return await runCliCommand(argv, dependencies);
  } finally {
    const cleanup = dependencies.cleanupPendingOutputFiles || cleanupPendingOutputFiles;
    try {
      const report = await cleanup();
      if (report.retainedPublished > 0) {
        write(stderr, `Output cleanup warning: Published output is intact, but ${report.retainedPublished} linked temporary output ${report.retainedPublished === 1 ? 'file remains' : 'files remain'} in the selected output directory.\n`);
      }
      if (report.retainedUnpublished > 0) {
        write(stderr, `Output cleanup warning: ${report.retainedUnpublished} unpublished temporary output ${report.retainedUnpublished === 1 ? 'file remains' : 'files remain'} in the selected output directory.\n`);
      }
    } catch {
      write(stderr, 'Output cleanup warning: Temporary output cleanup could not be verified.\n');
    }
  }
}

export { HELP, INLINE_CLI_COMMANDS, MAX_STDIN_BYTES, VERSION, readStdinBounded, runCli };
export type { CliDependencies, WritableLike };
