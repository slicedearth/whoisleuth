'use strict';

const { classifyQuery } = require('../lib/classify');
const { searchCertificateTransparency } = require('../lib/ct-search');
const { checkDomainPosture, normalizeAuditDomain, normalizeDkimSelectors } = require('../lib/domain-posture');
const { fetchHomepage } = require('../lib/availability');
const { collectTlsIntelligence, normalizeTlsHostname } = require('../lib/tls-intelligence');
const { runUnifiedLookup } = require('../lib/lookup');
const fs = require('node:fs');
const EXIT_CODES = require('./exit-codes');
const { CliUsageError, parseCliArguments } = require('./arguments');
const { buildCliBulkDocument, buildCliCompareDocument, buildCliCtSearchDocument, buildCliDiscoverDocument, buildCliHttpDocument, buildCliLookupDocument, buildCliPostureDocument, buildCliTlsDocument, formatDiscoverJsonLines, formatJsonDocument, formatJsonLines } = require('./formatters/json');
const { formatTerminalBulk, formatTerminalCompare, formatTerminalCtSearch, formatTerminalDiscover, formatTerminalHttp, formatTerminalLookup, formatTerminalPosture, formatTerminalTls } = require('./formatters/terminal');
const { MAX_BULK_INPUT_BYTES, parseBulkQueries, readTextStreamBounded, runBulkLookups } = require('./bulk');
const { MAX_COMPARE_INPUT_BYTES, compareLookupDocument, parseCliLookupDocument, readCompareInputBounded } = require('./compare');
const { buildCliEvidenceExport, formatCliEvidenceExport } = require('./export-evidence');
const { MAX_SAVED_LOOKUP_INPUT_BYTES, readSavedLookupInputBounded } = require('./saved-lookup');
const { DEFAULT_DISCOVERY_TLDS, normalizeDiscoveryTlds } = require('./discover');
const { normalizePostureSelectors } = require('./posture');
const { buildHttpProbeResult } = require('./http');
const { version: VERSION } = require('../package.json');

const MAX_STDIN_BYTES = 4096;
const HELP = `WHOISleuth CLI

Usage:
  whoisleuth lookup <domain|IP|ASN> [--json] [--fast|--deep] [--quiet] [--no-color]
  printf 'example.com\\n' | whoisleuth lookup --json
  whoisleuth bulk [file] [--json|--jsonl] [--fast|--deep] [--concurrency <1-8>]
  cat domains.txt | whoisleuth bulk --jsonl
  whoisleuth ct-search <keyword> [--json] [--quiet] [--no-color]
  printf 'example brand\\n' | whoisleuth ct-search --json
  whoisleuth discover <brand|domain> [--tlds <list>] [--preset <name>] [--keyboard <layout>] [--json|--jsonl]
  whoisleuth posture <domain> [--selectors <list>] [--json] [--quiet] [--no-color]
  whoisleuth http <domain> [--json] [--quiet] [--no-color]
  whoisleuth tls <hostname> [--json] [--quiet] [--no-color]
  whoisleuth compare [lookup.json] [--json] [--quiet] [--no-color]
  whoisleuth export [lookup.json] [--compact]
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
  if (lines.length > 1) throw new CliUsageError('Single-value commands accept one stdin line. Use the bulk command for multiple inputs.');
  return lines[0] || '';
}

function write(stream, value) {
  if (stream && typeof stream.write === 'function') stream.write(value);
}

async function runCli(argv, dependencies = {}) {
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  let failureLabel = 'Lookup';
  try {
    const args = parseCliArguments(argv);
    if (args.action === 'help') { write(stdout, HELP); return EXIT_CODES.SUCCESS; }
    if (args.action === 'version') { write(stdout, `${VERSION}\n`); return EXIT_CODES.SUCCESS; }

    if (args.action === 'compare') {
      failureLabel = 'Registry comparison';
      let input;
      try {
        input = dependencies.readCompareInput
          ? await dependencies.readCompareInput(args.source)
          : await readCompareInputBounded(args.source
            ? fs.createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, MAX_COMPARE_INPUT_BYTES);
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read comparison input: ${boundedErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('compare requires one lookup JSON file or a lookup document on stdin.');
      const parsed = parseCliLookupDocument(input);
      const loadComparison = dependencies.loadRegistryComparison || (() => import('../lib/registry-comparison.mjs'));
      const comparisonModule = await loadComparison();
      const result = compareLookupDocument(parsed, comparisonModule.compareRegistrySources);
      const now = dependencies.now ? dependencies.now() : new Date().toISOString();
      const document = buildCliCompareDocument(result, now);
      if (!args.quiet) {
        write(stdout, args.output === 'json' ? formatJsonDocument(document) : formatTerminalCompare(document));
      }
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'export') {
      failureLabel = 'Evidence export';
      let input;
      try {
        input = dependencies.readExportInput
          ? await dependencies.readExportInput(args.source)
          : await readSavedLookupInputBounded(args.source
            ? fs.createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, {
              limit: MAX_SAVED_LOOKUP_INPUT_BYTES,
              label: 'Evidence export input',
            });
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read evidence export input: ${boundedErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('export requires one lookup JSON file or a lookup document on stdin.');
      const loadEvidence = dependencies.loadEvidenceExport || (() => import('../lib/evidence-export.mjs'));
      const evidenceModule = await loadEvidence();
      const now = dependencies.now ? dependencies.now() : new Date().toISOString();
      const document = buildCliEvidenceExport(input, evidenceModule, now);
      write(stdout, formatCliEvidenceExport(document, args.compact));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'bulk') {
      failureLabel = 'Bulk lookup';
      let input;
      try {
        input = dependencies.readBulkInput
          ? await dependencies.readBulkInput(args.source)
          : await readTextStreamBounded(args.source
            ? fs.createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, MAX_BULK_INPUT_BYTES);
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read bulk input: ${boundedErrorMessage(error, 'Input could not be read')}`);
      }
      const parsed = parseBulkQueries(input, { deep: args.deep });
      const items = await runBulkLookups(parsed.queries, {
        deep: args.deep,
        concurrency: args.concurrency,
        classifyQuery: dependencies.classifyQuery || classifyQuery,
        runUnifiedLookup: dependencies.runUnifiedLookup || runUnifiedLookup,
      });
      const metadata = { deep: args.deep, duplicates: parsed.duplicates, generatedAt: dependencies.now ? dependencies.now() : new Date().toISOString() };
      if (!args.quiet) {
        if (args.output === 'json') write(stdout, formatJsonDocument(buildCliBulkDocument(items, metadata)));
        else if (args.output === 'jsonl') write(stdout, formatJsonLines(items, metadata));
        else write(stdout, formatTerminalBulk(items, metadata));
      }
      return items.some((item) => !item.ok) ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
    }

    if (args.action === 'ct-search') {
      failureLabel = 'Certificate Transparency search';
      const readInput = dependencies.readStdin || (() => readStdinBounded(dependencies.stdin || process.stdin));
      const keyword = args.keyword || await readInput();
      if (!keyword) throw new CliUsageError('ct-search requires one keyword as an argument or on stdin.');
      const search = dependencies.searchCertificateTransparency || searchCertificateTransparency;
      const result = await search(keyword);
      const now = dependencies.now ? dependencies.now() : new Date().toISOString();
      const document = buildCliCtSearchDocument(keyword, result, now);
      if (!args.quiet) {
        write(stdout, args.output === 'json' ? formatJsonDocument(document) : formatTerminalCtSearch(document));
      }
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'discover') {
      failureLabel = 'Candidate generation';
      const readInput = dependencies.readStdin || (() => readStdinBounded(dependencies.stdin || process.stdin));
      const seed = args.seed || await readInput();
      if (!seed) throw new CliUsageError('discover requires one brand label or domain as an argument or on stdin.');
      const loadGenerator = dependencies.loadTyposquatGenerator || (() => import('../lib/typosquat-generator.mjs'));
      const generator = await loadGenerator();
      const tlds = normalizeDiscoveryTlds(args.tldText || DEFAULT_DISCOVERY_TLDS.join(','), generator.MAX_GENERATION_TLDS);
      const result = generator.generateTyposquatCandidateSet(seed, tlds, {
        preset: args.preset,
        keyboardLayout: args.keyboardLayout,
      });
      if (!result.inputValid) throw new CliUsageError('discover requires a valid brand label or domain with one suffix label.');
      const now = dependencies.now ? dependencies.now() : new Date().toISOString();
      const metadata = {
        generatedAt: now,
        seed,
        preset: args.preset,
        keyboardLayout: args.keyboardLayout,
        tlds,
      };
      const document = buildCliDiscoverDocument(seed, result, metadata);
      if (!args.quiet) {
        if (args.output === 'json') write(stdout, formatJsonDocument(document));
        else if (args.output === 'jsonl') write(stdout, formatDiscoverJsonLines(result.candidates, metadata));
        else write(stdout, formatTerminalDiscover(document, generator.MUTATION_LABELS));
      }
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'posture') {
      failureLabel = 'Domain posture audit';
      const readInput = dependencies.readStdin || (() => readStdinBounded(dependencies.stdin || process.stdin));
      const requestedDomain = args.domain || await readInput();
      if (!requestedDomain) throw new CliUsageError('posture requires one domain as an argument or on stdin.');
      const normalizeDomain = dependencies.normalizeAuditDomain || normalizeAuditDomain;
      const domain = normalizeDomain(requestedDomain);
      if (!domain) throw new CliUsageError('posture requires a valid domain name.');
      const normalizeSelectors = dependencies.normalizeDkimSelectors || normalizeDkimSelectors;
      const dkimSelectors = normalizePostureSelectors(args.selectorText, normalizeSelectors);
      const audit = dependencies.checkDomainPosture || checkDomainPosture;
      const report = await audit(domain, { dkimSelectors });
      const now = dependencies.now ? dependencies.now() : new Date().toISOString();
      const document = buildCliPostureDocument(requestedDomain, report, now);
      if (!args.quiet) {
        write(stdout, args.output === 'json' ? formatJsonDocument(document) : formatTerminalPosture(document));
      }
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'http') {
      failureLabel = 'HTTP probe';
      const readInput = dependencies.readStdin || (() => readStdinBounded(dependencies.stdin || process.stdin));
      const requestedDomain = args.domain || await readInput();
      if (!requestedDomain) throw new CliUsageError('http requires one domain as an argument or on stdin.');
      const normalizeDomain = dependencies.normalizeAuditDomain || normalizeAuditDomain;
      const domain = normalizeDomain(requestedDomain);
      if (!domain) throw new CliUsageError('http requires a valid domain name.');
      const probe = dependencies.fetchHomepage || fetchHomepage;
      const result = buildHttpProbeResult(domain, await probe(domain));
      const now = dependencies.now ? dependencies.now() : new Date().toISOString();
      const document = buildCliHttpDocument(requestedDomain, result, now);
      if (!args.quiet) {
        write(stdout, args.output === 'json' ? formatJsonDocument(document) : formatTerminalHttp(document));
      }
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'tls') {
      failureLabel = 'TLS intelligence';
      const readInput = dependencies.readStdin || (() => readStdinBounded(dependencies.stdin || process.stdin));
      const requestedHostname = args.hostname || await readInput();
      if (!requestedHostname) throw new CliUsageError('tls requires one hostname as an argument or on stdin.');
      const normalizeHostname = dependencies.normalizeTlsHostname || normalizeTlsHostname;
      const hostname = normalizeHostname(requestedHostname);
      if (!hostname) throw new CliUsageError('tls requires a valid DNS hostname, not an IP address.');
      const collect = dependencies.collectTlsIntelligence || collectTlsIntelligence;
      const result = await collect(hostname);
      const now = dependencies.now ? dependencies.now() : new Date().toISOString();
      const document = buildCliTlsDocument(requestedHostname, result, now);
      if (!args.quiet) {
        write(stdout, args.output === 'json' ? formatJsonDocument(document) : formatTerminalTls(document));
      }
      return EXIT_CODES.SUCCESS;
    }

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
    write(stderr, `${failureLabel} failed: ${boundedErrorMessage(error, 'Unexpected command failure')}\n`);
    return EXIT_CODES.LOOKUP_FAILED;
  }
}

module.exports = { HELP, MAX_STDIN_BYTES, VERSION, readStdinBounded, runCli };
