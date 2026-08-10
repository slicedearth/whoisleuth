#!/usr/bin/env node

import { createRequire } from 'node:module';
import EXIT_CODES from '../cli/exit-codes.mts';

for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(0);
    throw error;
  });
}

const argv = process.argv.slice(2);
if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-V')) {
  const require = createRequire(import.meta.url);
  const metadata = require('../package.json') as { version?: unknown };
  if (typeof metadata.version !== 'string' || !metadata.version) {
    process.stderr.write('Internal CLI error: Package version is unavailable.\n');
    process.exitCode = 70;
  } else {
    process.stdout.write(`${metadata.version}\n`);
  }
} else {
  const [configModule, errorsModule, outputModule, runnerModule] = await Promise.all([
    import('../cli/config-profile.mts'),
    import('../cli/errors.mts'),
    import('../cli/output-file.mts'),
    import('../cli/runner.mts'),
  ]);
  let resolvedArgv: string[];
  let profileResolutionFailed = false;
  try {
    resolvedArgv = await configModule.resolveCliProfileArguments(argv);
  } catch (error) {
    process.stderr.write(`Usage error: ${errorsModule.boundedCliErrorMessage(error, 'Invalid CLI profile')}\n`);
    process.exitCode = EXIT_CODES.USAGE;
    profileResolutionFailed = true;
    resolvedArgv = [];
  }
  const cancellation = new AbortController();
  let interruptionCount = 0;
  let requestedExitCode = 130;
  const interrupt = (signal: 'SIGINT' | 'SIGTERM') => {
    interruptionCount += 1;
    if (interruptionCount === 1) {
      requestedExitCode = signal === 'SIGTERM' ? 143 : 130;
      cancellation.abort(new DOMException('Aborted', 'AbortError'));
    }
    else {
      outputModule.cleanupPendingOutputFilesSync();
      process.exit(requestedExitCode);
    }
  };
  const onSigint = () => interrupt('SIGINT');
  const onSigterm = () => interrupt('SIGTERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  const execution = profileResolutionFailed
    ? Promise.resolve(process.exitCode || EXIT_CODES.USAGE)
    : runnerModule.runCli(resolvedArgv, { signal: cancellation.signal });
  execution.then((code) => {
    if (code === 130) {
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      process.exit(requestedExitCode);
    }
    process.exitCode = code;
  }).catch((error: unknown) => {
    process.stderr.write(`Internal CLI error: ${errorsModule.boundedCliErrorMessage(error)}\n`);
    process.exitCode = 70;
  }).finally(() => {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  });
}
