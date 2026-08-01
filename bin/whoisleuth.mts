#!/usr/bin/env node

import { boundedCliErrorMessage } from '../cli/errors.mts';
import { runCli } from '../cli/runner.mts';

for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(0);
    throw error;
  });
}

const cancellation = new AbortController();
let interruptionCount = 0;
const interrupt = () => {
  interruptionCount += 1;
  if (interruptionCount === 1) cancellation.abort(new DOMException('Aborted', 'AbortError'));
  else process.exit(130);
};
process.on('SIGINT', interrupt);

runCli(process.argv.slice(2), { signal: cancellation.signal }).then((code) => {
  if (code === 130) {
    process.removeListener('SIGINT', interrupt);
    process.exit(130);
  }
  process.exitCode = code;
}).catch((error: unknown) => {
  process.stderr.write(`Internal CLI error: ${boundedCliErrorMessage(error)}\n`);
  process.exitCode = 70;
}).finally(() => {
  process.removeListener('SIGINT', interrupt);
});
