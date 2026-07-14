import { boundedCliErrorMessage } from '../cli/errors.mts';
import { runCli } from '../cli/runner.mts';

for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(0);
    throw error;
  });
}

runCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}).catch((error: unknown) => {
  process.stderr.write(`Internal CLI error: ${boundedCliErrorMessage(error)}\n`);
  process.exitCode = 70;
});
