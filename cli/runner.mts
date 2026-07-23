import { Buffer } from 'node:buffer';
import { createReadStream } from 'node:fs';
import { createRequire } from 'node:module';

import { fetchHomepage } from '../lib/availability.mts';
import { classifyQuery } from '../lib/classify.mts';
import { searchCertificateTransparency } from '../lib/ct-search.mts';
import { checkDomainPosture, normalizeAuditDomain, normalizeDkimSelectors } from '../lib/domain-posture.mts';
import { runUnifiedLookup } from '../lib/lookup.mts';
import { REGISTRY_CAPABILITIES_VERSION, registryCapabilityFor } from '../lib/registry-capabilities.mts';
import { collectTlsIntelligence, normalizeTlsHostname } from '../lib/tls-intelligence.mts';
import { explainRiskScore, RISK_MODEL_VERSION, RISK_REVIEW_THRESHOLD } from '../lib/risk-scoring.mts';
import { CliUsageError, parseCliArguments } from './arguments.mts';
import {
  MAX_BULK_INPUT_BYTES,
  parseBulkQueries,
  readTextStreamBounded,
  runBulkLookups,
} from './bulk.mts';
import type { BoundedTextStream } from './bulk.mts';
import {
  MAX_COMPARE_INPUT_BYTES,
  compareLookupDocument,
  parseCliLookupDocument,
  readCompareInputBounded,
} from './compare.mts';
import {
  DEFAULT_DISCOVERY_TLDS,
  MAX_DISCOVERY_DICTIONARY_BYTES,
  normalizeDiscoveryTlds,
  readDiscoveryDictionaryBounded,
} from './discover.mts';
import { boundedCliErrorMessage } from './errors.mts';
import { buildCliEvidenceExport, formatCliEvidenceExport } from './export-evidence.mts';
import EXIT_CODES from './exit-codes.mts';
import { formatLookupEvidenceHtml } from './formatters/html.mts';
import {
  buildCliBulkDocument,
  buildCliCompareDocument,
  buildCliCtSearchDocument,
  buildCliDiscoverDocument,
  buildCliHttpDocument,
  buildCliLookupDocument,
  buildCliPostureDocument,
  buildCliTlsDocument,
  formatDiscoverJsonLines,
  formatJsonDocument,
  formatJsonLines,
} from './formatters/json.mts';
import { formatLookupEvidenceMarkdown } from './formatters/markdown.mts';
import {
  formatTerminalBulk,
  formatTerminalCompare,
  formatTerminalCtSearch,
  formatTerminalDiscover,
  formatTerminalHttp,
  formatTerminalLookup,
  formatTerminalPosture,
  formatTerminalRegistrySupport,
  formatTerminalRiskCalibration,
  formatTerminalTls,
} from './formatters/terminal.mts';
import { buildHttpProbeResult } from './http.mts';
import { normalizePostureSelectors } from './posture.mts';
import { buildRegistrySupportDocument } from './registry-support.mts';
import {
  MAX_RISK_CALIBRATION_INPUT_BYTES,
  buildRiskCalibrationReport,
  parseRiskCalibrationDataset,
  readRiskCalibrationInputBounded,
} from './risk-calibration.mts';
import { MAX_SAVED_LOOKUP_INPUT_BYTES, readSavedLookupInputBounded } from './saved-lookup.mts';
import type { UnknownRecord } from './saved-lookup.mts';

const require = createRequire(import.meta.url);
const { version: VERSION } = require('../package.json') as { version: string };
const MAX_STDIN_BYTES = 4096;
const HELP = `WHOISleuth CLI

Usage:
  whoisleuth lookup <domain|IP|ASN> [--json] [--fast|--deep] [--quiet] [--no-color]
  printf 'example.com\\n' | whoisleuth lookup --json
  whoisleuth bulk [file] [--json|--jsonl] [--fast|--deep] [--concurrency <1-8>]
  cat domains.txt | whoisleuth bulk --jsonl
  whoisleuth ct-search <keyword> [--json] [--quiet] [--no-color]
  printf 'example brand\\n' | whoisleuth ct-search --json
  whoisleuth discover <brand|domain> [--tlds <list>] [--preset <name>|--families <ids>] [--keyboard <layout>] [--dictionary <file>] [--json|--jsonl]
  whoisleuth posture <domain> [--selectors <list>] [--json] [--quiet] [--no-color]
  whoisleuth http <domain> [--json] [--quiet] [--no-color]
  whoisleuth tls <hostname> [--json] [--quiet] [--no-color]
  whoisleuth registry-support <domain|suffix> [--json] [--quiet] [--no-color]
  whoisleuth risk-calibrate [dataset.json] [--json] [--quiet] [--no-color]
  whoisleuth compare [lookup.json] [--json] [--quiet] [--no-color]
  whoisleuth export [lookup.json] [--markdown|--html|--compact]
  whoisleuth --help
  whoisleuth --version

Lookup defaults to fast mode. Deep mode must be requested explicitly and may
perform WHOIS, website, DNS, and TLS work through the shared bounded pipeline.
Machine-readable output is written to stdout; diagnostics are written to stderr.
Registry support is an offline catalogue view and never tests live reachability.
Risk calibration is an offline fixture replay and never changes the scoring model.

Copyright 2026 slicedearth. Licensed under AGPL-3.0-only.
Source and licence: https://github.com/slicedearth/whoisleuth
`;

type WritableLike = { write(value: string): unknown };
type CliDependencies = {
  stdout?: WritableLike;
  stderr?: WritableLike;
  stdin?: BoundedTextStream;
  // Tests and embedders inject bounded implementations for every external
  // operation; individual commands validate their results at existing module
  // boundaries before formatting or persistence.
  [key: string]: any;
};

async function readStdinBounded(
  stream: BoundedTextStream | null | undefined,
  limit = MAX_STDIN_BYTES,
): Promise<string> {
  if (!stream || stream.isTTY) return '';
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<unknown>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > limit) throw new CliUsageError(`Standard input is limited to ${limit} bytes.`);
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1) throw new CliUsageError('Single-value commands accept one stdin line. Use the bulk command for multiple inputs.');
  return lines[0] || '';
}

function write(stream: WritableLike | null | undefined, value: string): void {
  if (stream && typeof stream.write === 'function') stream.write(value);
}

async function runCli(argv: unknown, dependencies: CliDependencies = {}): Promise<number> {
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  let failureLabel = 'Lookup';
  try {
    const args = parseCliArguments(argv);
    if (args.action === 'help') { write(stdout, HELP); return EXIT_CODES.SUCCESS; }
    if (args.action === 'version') { write(stdout, `${VERSION}\n`); return EXIT_CODES.SUCCESS; }

    if (args.action === 'registry-support') {
      failureLabel = 'Registry support';
      const readInput = dependencies.readStdin || (() => readStdinBounded(dependencies.stdin || process.stdin));
      const requestedInput = args.target || await readInput();
      if (!requestedInput) throw new CliUsageError('registry-support requires one domain or suffix as an argument or on stdin.');
      const lookupCapability = dependencies.registryCapabilityFor || registryCapabilityFor;
      const capability = lookupCapability(requestedInput);
      if (!capability) throw new CliUsageError('registry-support requires a valid domain or suffix.');
      const now = dependencies.now ? dependencies.now() : new Date().toISOString();
      const catalogueVersion = dependencies.registryCapabilitiesVersion || REGISTRY_CAPABILITIES_VERSION;
      const document = buildRegistrySupportDocument(requestedInput, capability, catalogueVersion, now);
      if (!args.quiet) write(stdout, args.output === 'json' ? formatJsonDocument(document) : formatTerminalRegistrySupport(document));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'risk-calibrate') {
      failureLabel = 'Risk calibration';
      let input: string;
      try {
        input = dependencies.readRiskCalibrationInput
          ? await dependencies.readRiskCalibrationInput(args.source)
          : await readRiskCalibrationInputBounded(args.source
            ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, MAX_RISK_CALIBRATION_INPUT_BYTES);
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read Risk calibration input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('risk-calibrate requires one dataset JSON file or a dataset on stdin.');
      const dataset = parseRiskCalibrationDataset(input);
      const report = buildRiskCalibrationReport(dataset, dependencies.explainRiskScore || explainRiskScore, {
        generatedAt: dependencies.now ? dependencies.now() : new Date().toISOString(),
        modelVersion: dependencies.riskModelVersion || RISK_MODEL_VERSION,
        reviewThreshold: dependencies.riskReviewThreshold || RISK_REVIEW_THRESHOLD,
      });
      if (!args.quiet) write(stdout, args.output === 'json' ? formatJsonDocument(report) : formatTerminalRiskCalibration(report));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'compare') {
      failureLabel = 'Registry comparison';
      let input: string;
      try {
        input = dependencies.readCompareInput
          ? await dependencies.readCompareInput(args.source)
          : await readCompareInputBounded(args.source
            ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, MAX_COMPARE_INPUT_BYTES);
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read comparison input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('compare requires one lookup JSON file or a lookup document on stdin.');
      const parsed = parseCliLookupDocument(input);
      const loadComparison = dependencies.loadRegistryComparison || (() => import('../lib/registry-comparison.mts'));
      const comparisonModule = await loadComparison();
      const result = compareLookupDocument(
        parsed,
        comparisonModule.compareRegistrySources,
        comparisonModule.compareRdapPublications,
      );
      const now = dependencies.now ? dependencies.now() : new Date().toISOString();
      const document = buildCliCompareDocument(result, now);
      if (!args.quiet) write(stdout, args.output === 'json' ? formatJsonDocument(document) : formatTerminalCompare(document));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'export') {
      failureLabel = 'Evidence export';
      let input: string;
      try {
        input = dependencies.readExportInput
          ? await dependencies.readExportInput(args.source)
          : await readSavedLookupInputBounded(args.source
            ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, {
              limit: MAX_SAVED_LOOKUP_INPUT_BYTES,
              label: 'Evidence export input',
            });
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read evidence export input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('export requires one lookup JSON file or a lookup document on stdin.');
      const loadEvidence = dependencies.loadEvidenceExport || (() => import('../lib/evidence-export.mts'));
      const evidenceModule = await loadEvidence();
      const now = dependencies.now ? dependencies.now() : new Date().toISOString();
      const document = buildCliEvidenceExport(input, evidenceModule, now);
      const output = args.format === 'markdown'
        ? formatLookupEvidenceMarkdown(document)
        : args.format === 'html'
          ? formatLookupEvidenceHtml(document)
          : formatCliEvidenceExport(document, args.compact);
      write(stdout, output);
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'bulk') {
      failureLabel = 'Bulk lookup';
      let input: string;
      try {
        input = dependencies.readBulkInput
          ? await dependencies.readBulkInput(args.source)
          : await readTextStreamBounded(args.source
            ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, MAX_BULK_INPUT_BYTES);
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read bulk input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
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
      const document = buildCliCtSearchDocument(keyword, result as UnknownRecord, now);
      if (!args.quiet) write(stdout, args.output === 'json' ? formatJsonDocument(document) : formatTerminalCtSearch(document));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'discover') {
      failureLabel = 'Candidate generation';
      const readInput = dependencies.readStdin || (() => readStdinBounded(dependencies.stdin || process.stdin));
      const seed = args.seed || await readInput();
      if (!seed) throw new CliUsageError('discover requires one brand label or domain as an argument or on stdin.');
      const loadGenerator = dependencies.loadTyposquatGenerator || (() => import('../lib/typosquat-generator.mts'));
      const generator = await loadGenerator();
      const tlds = normalizeDiscoveryTlds(args.tldText || DEFAULT_DISCOVERY_TLDS.join(','), generator.MAX_GENERATION_TLDS);
      const requestedFamilies = args.familyText
        ? [...new Set(args.familyText.split(',').map((value) => value.trim()).filter(Boolean))]
        : [];
      const mutationFamilies = args.preset === 'custom'
        ? generator.normalizeMutationFamilyIds(requestedFamilies)
        : [];
      if (args.preset === 'custom'
        && (!mutationFamilies.length || mutationFamilies.length !== requestedFamilies.length)) {
        throw new CliUsageError(`--families requires one or more supported IDs: ${generator.MUTATION_FAMILY_IDS.join(', ')}.`);
      }
      let dictionaryText = '';
      if (args.dictionarySource) {
        if (args.preset === 'custom'
          && !mutationFamilies.includes('dictionary')
          && !mutationFamilies.includes('dictionary_token_replacement')) {
          throw new CliUsageError('--dictionary requires a dictionary mutation family.');
        }
        try {
          dictionaryText = dependencies.readDiscoveryDictionary
            ? await dependencies.readDiscoveryDictionary(args.dictionarySource)
            : await readDiscoveryDictionaryBounded(
              createReadStream(args.dictionarySource, { highWaterMark: MAX_DISCOVERY_DICTIONARY_BYTES }),
              MAX_DISCOVERY_DICTIONARY_BYTES,
            );
        } catch (error) {
          if (error instanceof CliUsageError) throw error;
          throw new CliUsageError(`Could not read discovery dictionary: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
        }
        const normalizedDictionary = generator.normalizeCustomDictionaryTerms(dictionaryText);
        if (!normalizedDictionary.values.length) {
          throw new CliUsageError('The discovery dictionary did not contain any valid terms.');
        }
      }
      const result = generator.generateTyposquatCandidateSet(seed, tlds, {
        preset: args.preset,
        keyboardLayout: args.keyboardLayout,
        dictionaryTerms: dictionaryText,
        ...(args.preset === 'custom' ? { mutationTypes: mutationFamilies } : {}),
      });
      if (!result.inputValid) throw new CliUsageError('discover requires a valid brand label or domain with one suffix label.');
      const now = dependencies.now ? dependencies.now() : new Date().toISOString();
      const normalizedDictionary = generator.normalizeCustomDictionaryTerms(dictionaryText);
      const metadata = {
        generatedAt: now,
        seed,
        preset: args.preset,
        keyboardLayout: args.keyboardLayout,
        tlds,
        mutationFamilies,
        dictionaryTermCount: normalizedDictionary.values.length,
        rejectedDictionaryTermCount: normalizedDictionary.rejectedCount,
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
      const document = buildCliPostureDocument(requestedDomain, report as UnknownRecord, now);
      if (!args.quiet) write(stdout, args.output === 'json' ? formatJsonDocument(document) : formatTerminalPosture(document));
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
      const document = buildCliHttpDocument(requestedDomain, result as unknown as UnknownRecord, now);
      if (!args.quiet) write(stdout, args.output === 'json' ? formatJsonDocument(document) : formatTerminalHttp(document));
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
      const document = buildCliTlsDocument(requestedHostname, result as UnknownRecord, now);
      if (!args.quiet) write(stdout, args.output === 'json' ? formatJsonDocument(document) : formatTerminalTls(document));
      return EXIT_CODES.SUCCESS;
    }

    const readInput = dependencies.readStdin || (() => readStdinBounded(dependencies.stdin || process.stdin));
    const query = args.query || await readInput();
    if (!query) throw new CliUsageError('lookup requires one domain, IP address, or ASN as an argument or on stdin.');
    const classify = dependencies.classifyQuery || classifyQuery;
    const executeLookup = dependencies.runUnifiedLookup || runUnifiedLookup;
    let classified;
    try { classified = classify(query); }
    catch (error) { throw new CliUsageError(boundedCliErrorMessage(error, 'Invalid query')); }
    const result = await executeLookup(classified, { fast: !args.deep, compact: false });
    const now = dependencies.now ? dependencies.now() : new Date().toISOString();
    const document = buildCliLookupDocument(query, classified, result as UnknownRecord, now, args.deep ? 'deep' : 'fast');
    if (!args.quiet) write(stdout, args.output === 'json' ? formatJsonDocument(document) : formatTerminalLookup(document));
    return EXIT_CODES.SUCCESS;
  } catch (error) {
    if (error instanceof CliUsageError) {
      write(stderr, `Usage error: ${boundedCliErrorMessage(error, 'Invalid command')}\n`);
      return EXIT_CODES.USAGE;
    }
    write(stderr, `${failureLabel} failed: ${boundedCliErrorMessage(error, 'Unexpected command failure')}\n`);
    return EXIT_CODES.LOOKUP_FAILED;
  }
}

export { HELP, MAX_STDIN_BYTES, VERSION, readStdinBounded, runCli };
export type { CliDependencies, WritableLike };
