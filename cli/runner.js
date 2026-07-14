'use strict';

const { classifyQuery } = require('../lib/classify');
const { runUnifiedLookup } = require('../lib/lookup');
const EXIT_CODES = require('./exit-codes');
const { CliUsageError, parseCliArguments } = require('./arguments');
const { buildCliLookupDocument, formatJsonDocument } = require('./formatters/json');
const { formatTerminalLookup } = require('./formatters/terminal');
const { version: VERSION } = require('../package.json');

const MAX_STDIN_BYTES = 4096;
const HELP = `WHOISleuth CLI

Usage:
  whoisleuth lookup <domain|IP|ASN> [--json] [--fast|--deep] [--quiet] [--no-color]
  printf 'example.com\\n' | whoisleuth lookup --json
  whoisleuth --help
  whoisleuth --version

Lookup defaults to fast mode. Deep mode must be requested explicitly and may
perform WHOIS, website, DNS, and TLS work through the shared bounded pipeline.
Machine-readable output is written to stdout; diagnostics are written to stderr.
`;

function boundedErrorMessage(error, fallback) {
  return String(error?.message || fallback)
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300) || fallback;
}

async function readStdinBounded(stream, limit = MAX_STDIN_BYTES) {
  if (!stream || stream.isTTY) return '';
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limit) throw new CliUsageError(`Standard input is limited to ${limit} bytes.`);
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1) throw new CliUsageError('lookup accepts one stdin query. Use a future bulk command for multiple inputs.');
  return lines[0] || '';
}

function write(stream, value) {
  if (stream && typeof stream.write === 'function') stream.write(value);
}

async function runCli(argv, dependencies = {}) {
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  try {
    const args = parseCliArguments(argv);
    if (args.action === 'help') { write(stdout, HELP); return EXIT_CODES.SUCCESS; }
    if (args.action === 'version') { write(stdout, `${VERSION}\n`); return EXIT_CODES.SUCCESS; }

    const readInput = dependencies.readStdin || (() => readStdinBounded(dependencies.stdin || process.stdin));
    const query = args.query || await readInput();
    if (!query) throw new CliUsageError('lookup requires one domain, IP address, or ASN as an argument or on stdin.');
    const classify = dependencies.classifyQuery || classifyQuery;
    const executeLookup = dependencies.runUnifiedLookup || runUnifiedLookup;
    let classified;
    try { classified = classify(query); }
    catch (error) { throw new CliUsageError(boundedErrorMessage(error, 'Invalid query')); }
    const result = await executeLookup(classified, { fast: !args.deep, compact: false });
    const now = dependencies.now ? dependencies.now() : new Date().toISOString();
    const document = buildCliLookupDocument(query, classified, result, now, args.deep ? 'deep' : 'fast');
    if (!args.quiet) write(stdout, args.output === 'json' ? formatJsonDocument(document) : formatTerminalLookup(document));
    return EXIT_CODES.SUCCESS;
  } catch (error) {
    if (error instanceof CliUsageError) {
      write(stderr, `Usage error: ${boundedErrorMessage(error, 'Invalid command')}\n`);
      return EXIT_CODES.USAGE;
    }
    write(stderr, `Lookup failed: ${boundedErrorMessage(error, 'Unexpected lookup failure')}\n`);
    return EXIT_CODES.LOOKUP_FAILED;
  }
}

module.exports = { HELP, MAX_STDIN_BYTES, VERSION, readStdinBounded, runCli };
