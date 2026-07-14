#!/usr/bin/env node
'use strict';

const { runCli } = require('../cli/runner');

for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error) => {
    if (error.code === 'EPIPE') process.exit(0);
    throw error;
  });
}

runCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}).catch((error) => {
  process.stderr.write(`Internal CLI error: ${String(error?.message || error).slice(0, 300)}\n`);
  process.exitCode = 70;
});
