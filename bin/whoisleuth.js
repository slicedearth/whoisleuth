#!/usr/bin/env node
'use strict';

const { runCli } = require('../cli/runner');
const { boundedCliErrorMessage } = require('../cli/errors');

for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error) => {
    if (error.code === 'EPIPE') process.exit(0);
    throw error;
  });
}

runCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}).catch((error) => {
  process.stderr.write(`Internal CLI error: ${boundedCliErrorMessage(error)}\n`);
  process.exitCode = 70;
});
