#!/usr/bin/env node

import { createRequire } from 'node:module';

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
  try {
    resolvedArgv = await configModule.resolveCliProfileArguments(argv);
  } catch (error) {
    process.stderr.write(`Usage error: ${errorsModule.boundedCliErrorMessage(error, 'Invalid CLI profile')}\n`);
    process.exitCode = 64;
    resolvedArgv = [];
  }
  const cancellation = new AbortController();
  let interruptionCount = 0;
  const interrupt = () => {
    interruptionCount += 1;
    if (interruptionCount === 1) cancellation.abort(new DOMException('Aborted', 'AbortError'));
    else {
      outputModule.cleanupPendingOutputFilesSync();
      process.exit(130);
    }
  };
  process.on('SIGINT', interrupt);

  const execution = resolvedArgv.length ? runnerModule.runCli(resolvedArgv, { signal: cancellation.signal }) : Promise.resolve(process.exitCode || 64);
  execution.then((code) => {
    if (code === 130) {
      process.removeListener('SIGINT', interrupt);
      process.exit(130);
    }
    process.exitCode = code;
  }).catch((error: unknown) => {
    process.stderr.write(`Internal CLI error: ${errorsModule.boundedCliErrorMessage(error)}\n`);
    process.exitCode = 70;
  }).finally(() => {
    process.removeListener('SIGINT', interrupt);
  });
}
