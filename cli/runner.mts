import { Buffer } from 'node:buffer';
import { createReadStream } from 'node:fs';
import { createRequire } from 'node:module';

import { fetchHomepage } from '../lib/availability.mts';
import { classifyQuery } from '../lib/classify.mts';
import type { ClassifiedQuery } from '../lib/classify.mts';
import { searchCertificateTransparency } from '../lib/ct-search.mts';
import { checkDomainPosture, normalizeAuditDomain, normalizeDkimSelectors } from '../lib/domain-posture.mts';
import { runUnifiedLookup } from '../lib/lookup.mts';
import type { LookupSourceSettlement } from '../lib/lookup.mts';
import { resolvePublicAddresses } from '../lib/safe-fetch.mts';
import { whoisQuery } from '../lib/whois-transport.mts';
import { REGISTRY_CAPABILITIES_VERSION, registryCapabilityFor } from '../lib/registry-capabilities.mts';
import type { RegistryCompatibilityRow } from '../lib/registry-capabilities.mts';
import { collectTlsIntelligence, normalizeTlsHostname } from '../lib/tls-intelligence.mts';
import { explainRiskScore, RISK_MODEL_VERSION, RISK_REVIEW_THRESHOLD } from '../lib/risk-scoring.mts';
import { CLI_COMMANDS, parseCliArguments } from './arguments.mts';
import type { CliArguments, CliCommand } from './arguments.mts';
import { createBulkCheckpointWriter } from './bulk-checkpoint.mts';
import { buildShellCompletion } from './completion.mts';
import { buildDoctorReport, formatDoctorReport } from './doctor.mts';
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
import { boundedCliErrorMessage, CliUsageError } from './errors.mts';
import {
  evidenceCommandFailureLabel,
  isEvidenceCommand,
  runEvidenceCommand,
} from './evidence-command-runner.mts';
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
import { buildCliLookupDiff, formatCliLookupDiff } from './lookup-diff.mts';
import { buildCliManual } from './manual.mts';
import { createBufferedOutput, writePrivateFile } from './output-file.mts';
import { normalizePostureSelectors } from './posture.mts';
import { createTerminalProgress, type TerminalProgress } from './progress.mts';
import { createCliProgressEvents, type CliProgressEvents } from './progress-events.mts';
import { buildRegistrySupportDocument } from './registry-support.mts';
import {
  MAX_OFFLINE_ARTIFACT_BYTES,
  MAX_OFFLINE_PASSPHRASE_FILE_BYTES,
  formatOfflineArtifactVerification,
  verifyOfflineArtifact,
} from './artifact-verify.mts';
import {
  MAX_SOURCE_RELIABILITY_INPUT_BYTES,
  buildSourceReliabilityReport,
  formatSourceReliabilityReport,
} from './source-reliability.mts';
import {
  MAX_RISK_CALIBRATION_INPUT_BYTES,
  buildRiskCalibrationReport,
  parseRiskCalibrationDataset,
  readRiskCalibrationInputBounded,
} from './risk-calibration.mts';
import { MAX_SAVED_LOOKUP_INPUT_BYTES, readSavedLookupInputBounded } from './saved-lookup.mts';
import type { UnknownRecord } from './saved-lookup.mts';
import { lookupStrictExitFindings } from './strict-exit.mts';
import {
  presentTerminalOutput,
  terminalPresentation,
  type TerminalEnvironment,
  type WritableTerminal,
} from './terminal-presentation.mts';

const require = createRequire(import.meta.url);
const { version: VERSION } = require('../package.json') as { version: string };
const MAX_STDIN_BYTES = 4096;
const HELP = `WHOISleuth CLI
Source-aware domain investigation from your terminal.

Quick start:
  whoisleuth lookup example.test
  whoisleuth lookup example.test --deep
  cat domains.txt | whoisleuth bulk --jsonl

Investigate:
  lookup             Collect one domain, IP, or ASN.
  bulk               Triage newline-delimited targets with bounded concurrency.
  http               Inspect one homepage request and redirect chain.
  tls                Inspect one hostname's current certificate connection.
  posture            Review DNS mail and domain-control posture.

Discover:
  ct-search          Search certificate-transparency observations.
  discover           Generate offline lookalike candidates.
  registry-support   Explain local registry coverage without a request.

Review saved evidence:
  source-report      Summarise source reliability without retaining targets.
  compare            Compare saved registry publications.
  diff               Compare two saved domain observations.
  export             Convert a saved lookup into an evidence report.
  inspect-archive    Inspect a workspace archive, redacted by default.
  verify-artifact    Validate an archive, packet, or manifest offline.

Integrity and calibration:
  sign-artifact      Sign one reviewed packet or manifest locally.
  verify-signature   Verify one signed evidence package locally.
  risk-calibrate     Replay reviewed labels without changing the model.

Terminal:
  doctor             Check the local runtime; network tests require --network.
  completion         Print a completion script for bash, zsh, or fish.
  manual             Print the generated manual page.

Run "whoisleuth <command> --help" for focused usage and an example.
Use --json or --jsonl where supported for machine-readable stdout.
Use --output <file> for atomic private file output and --force to replace it.
Diagnostics are written to stderr. Fast lookup is the default; deep collection
must be requested explicitly and can disclose a target to additional sources.

Copyright 2026 slicedearth. Licensed under AGPL-3.0-only.
Source and licence: https://github.com/slicedearth/whoisleuth
`;
const COMMAND_USAGE: Readonly<Record<CliCommand, string>> = Object.freeze({
  completion: 'whoisleuth completion <bash|zsh|fish>',
  doctor: 'whoisleuth doctor [--network] [--json] [--quiet] [--no-color]',
  manual: 'whoisleuth manual',
  lookup: 'whoisleuth lookup <domain|IP|ASN> [--json|--markdown|--html] [--fast|--deep] [--summary|--verbose] [--strict-exit] [--events] [--quiet] [--no-color]',
  bulk: 'whoisleuth bulk [file] [--json|--jsonl] [--fast|--deep] [--concurrency <1-8>] [--checkpoint <file> [--resume]] [--events]',
  'ct-search': 'whoisleuth ct-search <keyword> [--json] [--quiet] [--no-color]',
  discover: 'whoisleuth discover <brand|domain> [--tlds <list>] [--preset <name>|--families <ids>] [--keyboard <layout>] [--dictionary <file>] [--json|--jsonl]',
  posture: 'whoisleuth posture <domain> [--selectors <list>] [--retired-selectors <list>] [--mail-profile <profile>] [--json] [--quiet] [--no-color]',
  http: 'whoisleuth http <domain> [--json] [--quiet] [--no-color]',
  tls: 'whoisleuth tls <hostname> [--json] [--quiet] [--no-color]',
  'registry-support': 'whoisleuth registry-support <domain|suffix> [--json] [--quiet] [--no-color]',
  'risk-calibrate': 'whoisleuth risk-calibrate [dataset.json] [--json] [--quiet] [--no-color]',
  'verify-artifact': 'whoisleuth verify-artifact [artifact.json] [--passphrase-file <file>] [--json] [--quiet] [--no-color]',
  'inspect-archive': 'whoisleuth inspect-archive [archive.json] [--passphrase-file <file>] [--search <value>] [--require-match] [--reveal] [--json]',
  'sign-artifact': 'whoisleuth sign-artifact [artifact.json] --private-key-file <file>',
  'verify-signature': 'whoisleuth verify-signature [package.json] [--public-key-file <file>] [--json] [--quiet] [--no-color]',
  'source-report': 'whoisleuth source-report [lookup.json] [--json] [--quiet] [--no-color]',
  compare: 'whoisleuth compare [lookup.json] [--json] [--quiet] [--no-color]',
  diff: 'whoisleuth diff <left.json> <right.json> [--json] [--quiet] [--no-color]',
  export: 'whoisleuth export [lookup.json] [--markdown|--html|--compact]',
});

const COMMAND_DETAILS: Readonly<Record<CliCommand, Readonly<{ description: string; example: string; boundary: string }>>> = Object.freeze({
  completion: {
    description: 'Print a static shell-completion script for the installed CLI.',
    example: 'whoisleuth completion zsh > ~/.zfunc/_whoisleuth',
    boundary: 'Generation is offline and writes only the script to stdout. The command never modifies shell configuration.',
  },
  doctor: {
    description: 'Check the supported runtime and local terminal capabilities.',
    example: 'whoisleuth doctor --json',
    boundary: 'The default check is offline. Public DNS and port 43 checks run only when --network is explicitly supplied.',
  },
  manual: {
    description: 'Print a generated roff manual page for local installation.',
    example: 'whoisleuth manual | man -l -',
    boundary: 'Generation is offline and derives from the same command catalogue as focused help.',
  },
  lookup: {
    description: 'Collect registration evidence for one domain, IP, or ASN.',
    example: 'whoisleuth lookup example.test --deep',
    boundary: 'Fast is the default. Deep mode adds bounded WHOIS, DNS, HTTP, TLS, technology, posture, and network context where applicable.',
  },
  bulk: {
    description: 'Triage newline-delimited domains, IPs, or ASNs with bounded concurrency.',
    example: 'cat domains.txt | whoisleuth bulk --jsonl',
    boundary: 'Fast and deep jobs use separate concurrency ceilings. Each target retains its own explicit source and failure state.',
  },
  'ct-search': {
    description: 'Search certificate-transparency observations for one bounded keyword.',
    example: 'whoisleuth ct-search "example brand" --json',
    boundary: 'Certificate observations do not prove website activity, registration ownership, or malicious intent.',
  },
  discover: {
    description: 'Generate bounded lookalike-domain candidates from local mutation rules.',
    example: 'whoisleuth discover example.test --preset common --jsonl',
    boundary: 'Generation is offline. Candidates are leads only and are not resolved, registered, or classified as malicious.',
  },
  posture: {
    description: 'Review bounded DNS mail, delegation, and domain-control posture.',
    example: 'whoisleuth posture example.test --mail-profile standard --json',
    boundary: 'Missing or failed DNS observations remain inconclusive and are not reported as absent controls.',
  },
  http: {
    description: 'Inspect one homepage request, redirects, and bounded response metadata.',
    example: 'whoisleuth http example.test --json',
    boundary: 'Requests use the shared public-address and redirect guards. This is not a rendered browser or vulnerability scan.',
  },
  tls: {
    description: 'Inspect one hostname certificate through a bounded TLS connection.',
    example: 'whoisleuth tls example.test --json',
    boundary: 'One observed connection is point-in-time evidence and does not establish every address, edge, or historical certificate.',
  },
  'registry-support': {
    description: 'Explain the local registry capability profile for one domain or suffix.',
    example: 'whoisleuth registry-support example.test --json',
    boundary: 'This command is offline. Catalogue coverage does not test live reachability or decide registration or availability.',
  },
  'risk-calibrate': {
    description: 'Replay reviewed labels against the current explainable Risk model.',
    example: 'whoisleuth risk-calibrate calibration.json --json',
    boundary: 'Calibration is offline and diagnostic. It never trains, tunes, or changes the scoring model automatically.',
  },
  'verify-artifact': {
    description: 'Validate a supported archive, packet, or manifest without printing evidence contents.',
    example: 'whoisleuth verify-artifact workspace.json --json',
    boundary: 'Verification is offline and redacted. Encrypted archives require an explicitly supplied passphrase file.',
  },
  'inspect-archive': {
    description: 'Summarise or search one workspace archive with redacted output by default.',
    example: 'whoisleuth inspect-archive workspace.json --search example.test --json',
    boundary: 'Exact matches require --reveal. The archive is read locally and is never uploaded.',
  },
  'sign-artifact': {
    description: 'Sign one reviewed response packet or supported manifest with a local private key.',
    example: 'whoisleuth sign-artifact packet.json --private-key-file analyst-private.pem',
    boundary: 'The command never creates, stores, or transmits keys. Key custody and signer identity remain the operator\'s responsibility.',
  },
  'verify-signature': {
    description: 'Verify the integrity and signature of one signed evidence package.',
    example: 'whoisleuth verify-signature packet.signed.json --json',
    boundary: 'A valid signature proves package consistency for the embedded key, not the real-world identity or authority of its holder.',
  },
  'source-report': {
    description: 'Create a target-free reliability summary from a saved lookup.',
    example: 'whoisleuth source-report lookup.json --json',
    boundary: 'The report retains source states and timings but excludes targets, queries, endpoints, and raw evidence.',
  },
  compare: {
    description: 'Compare separately attributed registry publications in a saved lookup.',
    example: 'whoisleuth compare lookup.json --json',
    boundary: 'Comparison is offline. Differences are review context and do not by themselves prove which publication is current.',
  },
  diff: {
    description: 'Compare bounded evidence retained in two saved domain lookups.',
    example: 'whoisleuth diff first.json second.json --json',
    boundary: 'Comparison is offline. Missing, unavailable, equal, and different evidence remain separate states.',
  },
  export: {
    description: 'Convert one saved lookup into a versioned evidence report.',
    example: 'whoisleuth export lookup.json --markdown',
    boundary: 'Exports preserve source attribution and limitations. Compact output intentionally omits raw registry payloads.',
  },
});

function commandHelp(command: CliCommand): string {
  const detail = COMMAND_DETAILS[command];
  return `WHOISleuth ${command}\n${detail.description}\n\nUsage:\n  ${COMMAND_USAGE[command]}\n\nExample:\n  ${detail.example}\n\nBoundary:\n  ${detail.boundary}\n\nRun "whoisleuth --help" to see the grouped command list.\n`;
}

type WritableLike = WritableTerminal;
type LookupDependency = (
  classified: ClassifiedQuery,
  options?: { fast?: boolean; compact?: boolean; onSourceSettled?: (settlement: LookupSourceSettlement) => void; signal?: AbortSignal },
) => unknown | Promise<unknown>;
type DiscoveryGeneratorDependency = {
  MAX_GENERATION_TLDS: number;
  MUTATION_FAMILY_IDS: readonly string[];
  MUTATION_LABELS: Readonly<Record<string, string>>;
  normalizeMutationFamilyIds(raw: unknown): string[];
  normalizeCustomDictionaryTerms(raw: unknown): { values: string[]; rejectedCount: number };
  generateTyposquatCandidateSet(
    seed: string,
    tlds: string[],
    options: Record<string, unknown>,
  ): UnknownRecord & {
    inputValid: boolean;
    candidates: Array<{ domain: unknown; source: unknown; tld: unknown; mutationTypes: unknown }>;
  };
};
type CliDependencies = {
  stdout?: WritableLike;
  stderr?: WritableLike;
  stdin?: BoundedTextStream;
  readStdin?: () => string | Promise<string>;
  readBulkInput?: (source?: string | null) => string | Promise<string>;
  readCompareInput?: (source?: string | null) => string | Promise<string>;
  readDiffInput?: (source: string) => string | Promise<string>;
  readDiscoveryDictionary?: (source: string) => string | Promise<string>;
  readExportInput?: (source?: string | null) => string | Promise<string>;
  readRiskCalibrationInput?: (source?: string | null) => string | Promise<string>;
  readArtifactInput?: (source?: string | null) => string | Promise<string>;
  readPassphraseFile?: (source: string) => string | Promise<string>;
  readPrivateKeyFile?: (source: string) => string | Promise<string>;
  readPublicKeyFile?: (source: string) => string | Promise<string>;
  readSourceReliabilityInput?: (source?: string | null) => string | Promise<string>;
  now?: () => string;
  nowMs?: () => number;
  environment?: TerminalEnvironment;
  signal?: AbortSignal;
  classifyQuery?: typeof classifyQuery;
  runUnifiedLookup?: LookupDependency;
  searchCertificateTransparency?: (keyword: unknown) => unknown | Promise<unknown>;
  loadTyposquatGenerator?: () => Promise<DiscoveryGeneratorDependency>;
  normalizeAuditDomain?: (raw: unknown) => string | null;
  normalizeDkimSelectors?: (raw: unknown) => string[];
  checkDomainPosture?: (
    domain: string,
    options?: { dkimSelectors?: unknown[]; retiredDkimSelectors?: unknown[]; mailProtectionProfile?: unknown },
  ) => unknown | Promise<unknown>;
  fetchHomepage?: (domain: string) => unknown | Promise<unknown>;
  normalizeTlsHostname?: (value: unknown) => string | null;
  collectTlsIntelligence?: (hostname: string) => unknown | Promise<unknown>;
  registryCapabilityFor?: (value: unknown) => RegistryCompatibilityRow | null;
  registryCapabilitiesVersion?: number;
  explainRiskScore?: typeof explainRiskScore;
  riskModelVersion?: number;
  riskReviewThreshold?: number;
  loadRegistryComparison?: () => Promise<typeof import('../lib/registry-comparison.mts')>;
  loadEvidenceExport?: () => Promise<typeof import('../lib/evidence-export.mts')>;
  resolvePublicAddresses?: typeof resolvePublicAddresses;
  whoisQuery?: typeof whoisQuery;
  createBulkCheckpointWriter?: typeof createBulkCheckpointWriter;
  // Tests and embedders inject bounded implementations for every external
  // operation; individual commands validate their results at existing module
  // boundaries before formatting or persistence.
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

function formatForTerminal(
  value: string,
  stream: WritableLike,
  color: boolean,
  environment: TerminalEnvironment,
): string {
  return presentTerminalOutput(value, terminalPresentation(stream, color, environment));
}

function cancellationError(signal?: AbortSignal): unknown {
  return signal?.reason || new DOMException('Aborted', 'AbortError');
}

function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true
    || Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
}

function abortable<T>(operation: () => T | Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return Promise.resolve().then(operation);
  if (signal.aborted) return Promise.reject(cancellationError(signal));
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(cancellationError(signal));
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve()
      .then(operation)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', aborted));
  });
}

async function runParsedCli(args: CliArguments, dependencies: CliDependencies = {}): Promise<number> {
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  const environment = dependencies.environment || process.env;
  let progress: TerminalProgress | null = null;
  let eventProgress: CliProgressEvents | null = null;
  let failureLabel = 'Lookup';
  try {
    const terminal = (value: string, color = true) => formatForTerminal(value, stdout, color, environment);
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
    if (args.action === 'help') {
      write(stdout, terminal(args.command ? commandHelp(args.command) : HELP));
      return EXIT_CODES.SUCCESS;
    }
    if (args.action === 'version') { write(stdout, `${VERSION}\n`); return EXIT_CODES.SUCCESS; }

    if (args.action === 'completion') {
      write(stdout, buildShellCompletion(args.shell));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'manual') {
      write(stdout, buildCliManual({ commands: CLI_COMMANDS, details: COMMAND_DETAILS, usage: COMMAND_USAGE, version: VERSION }));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'doctor') {
      failureLabel = 'CLI diagnostics';
      const buildReport = () => buildDoctorReport({
        version: VERSION,
        generatedAt: dependencies.now ? dependencies.now() : new Date().toISOString(),
        network: args.network,
        presentation: terminalPresentation(stdout, args.color, environment),
        ...(dependencies.resolvePublicAddresses ? { resolveAddresses: dependencies.resolvePublicAddresses } : {}),
        ...(dependencies.whoisQuery ? { queryWhois: dependencies.whoisQuery } : {}),
      });
      const report = args.network
        ? await withProgress('Checking public DNS and WHOIS connectivity', buildReport)
        : await buildReport();
      if (!args.quiet) {
        write(stdout, args.output === 'json'
          ? formatJsonDocument(report)
          : terminal(formatDoctorReport(report), args.color));
      }
      return report.state === 'partial' ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
    }

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
      if (!args.quiet) write(stdout, args.output === 'json' ? formatJsonDocument(document) : terminal(formatTerminalRegistrySupport(document), args.color));
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
      if (!args.quiet) write(stdout, args.output === 'json' ? formatJsonDocument(report) : terminal(formatTerminalRiskCalibration(report), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'verify-artifact') {
      failureLabel = 'Artifact verification';
      let input: string;
      try {
        input = dependencies.readArtifactInput
          ? await dependencies.readArtifactInput(args.source)
          : await readSavedLookupInputBounded(args.source
            ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, {
              limit: MAX_OFFLINE_ARTIFACT_BYTES,
              label: 'Artifact input',
            });
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read artifact input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('verify-artifact requires one JSON file or an artifact on stdin.');

      let passphrase: string | null = null;
      if (args.passphraseSource) {
        let passphraseText: string;
        try {
          passphraseText = dependencies.readPassphraseFile
            ? await dependencies.readPassphraseFile(args.passphraseSource)
            : await readSavedLookupInputBounded(
              createReadStream(args.passphraseSource, { highWaterMark: MAX_OFFLINE_PASSPHRASE_FILE_BYTES }),
              {
                limit: MAX_OFFLINE_PASSPHRASE_FILE_BYTES,
                label: 'Passphrase file',
              },
            );
        } catch (error) {
          if (error instanceof CliUsageError) throw error;
          throw new CliUsageError(`Could not read passphrase file: ${boundedCliErrorMessage(error, 'File could not be read')}`);
        }
        passphrase = passphraseText.replace(/\r?\n$/u, '');
        if (!passphrase || /[\r\n\u0000]/u.test(passphrase)) {
          throw new CliUsageError('Passphrase file must contain exactly one non-empty UTF-8 line.');
        }
      }

      const report = await verifyOfflineArtifact(input, { passphrase });
      if (!args.quiet) {
        write(stdout, args.output === 'json'
          ? formatJsonDocument(report)
          : terminal(formatOfflineArtifactVerification(report), args.color));
      }
      return EXIT_CODES.SUCCESS;
    }

    if (isEvidenceCommand(args)) {
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
      });
    }

    if (args.action === 'source-report') {
      failureLabel = 'Source reliability report';
      let input: string;
      try {
        input = dependencies.readSourceReliabilityInput
          ? await dependencies.readSourceReliabilityInput(args.source)
          : await readSavedLookupInputBounded(args.source
            ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, {
              limit: MAX_SOURCE_RELIABILITY_INPUT_BYTES,
              label: 'Source reliability input',
            });
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read source reliability input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('source-report requires one JSON file or lookup documents on stdin.');
      const report = buildSourceReliabilityReport(
        input,
        dependencies.now ? dependencies.now() : new Date().toISOString(),
      );
      if (!args.quiet) {
        write(stdout, args.output === 'json'
          ? formatJsonDocument(report)
          : terminal(formatSourceReliabilityReport(report), args.color));
      }
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
      if (!args.quiet) write(stdout, args.output === 'json' ? formatJsonDocument(document) : terminal(formatTerminalCompare(document), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'diff') {
      failureLabel = 'Lookup evidence diff';
      const readDiffInput = dependencies.readDiffInput || (async (source: string) => (
        readSavedLookupInputBounded(createReadStream(source, { highWaterMark: 64 * 1024 }), {
          limit: MAX_SAVED_LOOKUP_INPUT_BYTES,
          label: 'Lookup diff input',
        })
      ));
      let leftInput: string;
      let rightInput: string;
      try {
        [leftInput, rightInput] = await Promise.all([
          readDiffInput(args.leftSource),
          readDiffInput(args.rightSource),
        ]);
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read Lookup diff input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      const document = buildCliLookupDiff(
        leftInput,
        rightInput,
        dependencies.now ? dependencies.now() : new Date().toISOString(),
      );
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatCliLookupDiff(document), args.color));
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
      eventProgress = createCliProgressEvents(stderr, {
        command: 'bulk',
        enabled: args.events,
        ...(dependencies.now ? { now: dependencies.now } : {}),
      });
      eventProgress.emit({ event: 'started' });
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
      const classify = dependencies.classifyQuery || classifyQuery;
      const checkpointWriter = dependencies.createBulkCheckpointWriter || createBulkCheckpointWriter;
      const checkpoint = args.checkpoint
        ? await checkpointWriter({
            path: args.checkpoint,
            queries: parsed.queries,
            deep: args.deep,
            resume: args.resume,
            classifyQuery: classify,
            ...(dependencies.now ? { now: dependencies.now } : {}),
          })
        : null;
      const indicator = beginProgress(`Collecting 0 of ${parsed.queries.length} targets`);
      let completed = checkpoint?.initialResults.length || 0;
      if (completed) indicator.update(`Resumed ${completed} of ${parsed.queries.length} targets`);
      let items: Awaited<ReturnType<typeof runBulkLookups>>;
      let checkpointFailure: unknown = null;
      try {
        items = await runBulkLookups(parsed.queries, {
          deep: args.deep,
          concurrency: args.concurrency,
          classifyQuery: classify,
          runUnifiedLookup: dependencies.runUnifiedLookup || runUnifiedLookup,
          ...(checkpoint ? { initialResults: checkpoint.initialResults } : {}),
          ...(dependencies.signal ? { signal: dependencies.signal } : {}),
          onItemSettled: (item) => {
            completed += 1;
            indicator.update(`Collected ${completed} of ${parsed.queries.length} targets`);
            eventProgress?.emit({ event: 'item_settled', index: item.index, ok: item.ok });
            checkpoint?.record(item);
          },
        });
      } finally {
        endProgress();
        try {
          await checkpoint?.flush();
        } catch (error) {
          checkpointFailure = error;
        }
      }
      const metadata = { deep: args.deep, duplicates: parsed.duplicates, generatedAt: dependencies.now ? dependencies.now() : new Date().toISOString() };
      if (!args.quiet) {
        if (args.output === 'json') write(stdout, formatJsonDocument(buildCliBulkDocument(items, metadata)));
        else if (args.output === 'jsonl') write(stdout, formatJsonLines(items, metadata));
        else write(stdout, terminal(formatTerminalBulk(items, metadata), args.color));
      }
      if (checkpointFailure) {
        eventProgress.emit({ event: 'warning', state: 'checkpoint_unavailable' });
        if (!eventProgress.enabled) {
          write(stderr, `Checkpoint warning: ${boundedCliErrorMessage(checkpointFailure, 'Checkpoint could not be written')}. Completed output is still available.\n`);
        }
      }
      const exitCode = checkpointFailure || items.some((item) => !item.ok)
        ? EXIT_CODES.PARTIAL_FAILURE
        : EXIT_CODES.SUCCESS;
      eventProgress.emit({ event: 'completed', exitCode });
      return exitCode;
    }

    if (args.action === 'ct-search') {
      failureLabel = 'Certificate Transparency search';
      const readInput = dependencies.readStdin || (() => readStdinBounded(dependencies.stdin || process.stdin));
      const keyword = args.keyword || await readInput();
      if (!keyword) throw new CliUsageError('ct-search requires one keyword as an argument or on stdin.');
      const search = dependencies.searchCertificateTransparency || searchCertificateTransparency;
      const result = await withProgress('Searching certificate observations', () => search(keyword));
      const now = dependencies.now ? dependencies.now() : new Date().toISOString();
      const document = buildCliCtSearchDocument(keyword, result as UnknownRecord, now);
      if (!args.quiet) write(stdout, args.output === 'json' ? formatJsonDocument(document) : terminal(formatTerminalCtSearch(document), args.color));
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
        else write(stdout, terminal(formatTerminalDiscover(document, generator.MUTATION_LABELS), args.color));
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
      const retiredDkimSelectors = normalizePostureSelectors(args.retiredSelectorText, normalizeSelectors)
        .filter((selector) => !dkimSelectors.includes(selector))
        .slice(0, Math.max(0, 10 - dkimSelectors.length));
      const audit = dependencies.checkDomainPosture || checkDomainPosture;
      const report = await withProgress('Collecting domain posture evidence', () => audit(domain, {
          dkimSelectors,
          retiredDkimSelectors,
          mailProtectionProfile: args.mailProfile,
        }));
      const now = dependencies.now ? dependencies.now() : new Date().toISOString();
      const document = buildCliPostureDocument(requestedDomain, report as UnknownRecord, now);
      if (!args.quiet) write(stdout, args.output === 'json' ? formatJsonDocument(document) : terminal(formatTerminalPosture(document), args.color));
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
      const result = buildHttpProbeResult(
        domain,
        await withProgress('Inspecting the homepage request', () => probe(domain)),
      );
      const now = dependencies.now ? dependencies.now() : new Date().toISOString();
      const document = buildCliHttpDocument(requestedDomain, result, now);
      if (!args.quiet) write(stdout, args.output === 'json' ? formatJsonDocument(document) : terminal(formatTerminalHttp(document), args.color));
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
      const result = await withProgress('Inspecting the current TLS connection', () => collect(hostname));
      const now = dependencies.now ? dependencies.now() : new Date().toISOString();
      const document = buildCliTlsDocument(requestedHostname, result as UnknownRecord, now);
      if (!args.quiet) write(stdout, args.output === 'json' ? formatJsonDocument(document) : terminal(formatTerminalTls(document), args.color));
      return EXIT_CODES.SUCCESS;
    }

    eventProgress = createCliProgressEvents(stderr, {
      command: 'lookup',
      enabled: args.events,
      ...(dependencies.now ? { now: dependencies.now } : {}),
    });
    eventProgress.emit({ event: 'started' });
    const readInput = dependencies.readStdin || (() => readStdinBounded(dependencies.stdin || process.stdin));
    const query = args.query || await readInput();
    if (!query) throw new CliUsageError('lookup requires one domain, IP address, or ASN as an argument or on stdin.');
    const classify = dependencies.classifyQuery || classifyQuery;
    const executeLookup = dependencies.runUnifiedLookup || runUnifiedLookup;
    let classified;
    try { classified = classify(query); }
    catch (error) { throw new CliUsageError(boundedCliErrorMessage(error, 'Invalid query')); }
    if ((args.output === 'markdown' || args.output === 'html') && classified.type !== 'domain') {
      throw new CliUsageError('Markdown and HTML reports support domain lookups only.');
    }
    const indicator = beginProgress(args.deep ? 'Collecting deep Lookup evidence' : 'Collecting registration evidence');
    let settledSources = 0;
    let result: unknown;
    try {
      result = await abortable(() => executeLookup(classified, args.deep
        ? {
            fast: false,
            compact: false,
            ...(dependencies.signal ? { signal: dependencies.signal } : {}),
            onSourceSettled: (settlement) => {
              settledSources += 1;
              indicator.update(
                `Collected ${settledSources} source${settledSources === 1 ? '' : 's'} · ${settlement.source.replaceAll('_', ' ')} ${settlement.state}`,
              );
              eventProgress?.emit({ event: 'source_settled', source: settlement.source, state: settlement.state });
            },
          }
          : {
            fast: true,
            compact: false,
            ...(dependencies.signal ? { signal: dependencies.signal } : {}),
          }), dependencies.signal);
    } finally {
      endProgress();
    }
    const now = dependencies.now ? dependencies.now() : new Date().toISOString();
    const document = buildCliLookupDocument(query, classified, result as UnknownRecord, now, args.deep ? 'deep' : 'fast');
    if (!args.quiet) {
      if (args.output === 'json') write(stdout, formatJsonDocument(document));
      else if (args.output === 'markdown' || args.output === 'html') {
        const loadEvidence = dependencies.loadEvidenceExport || (() => import('../lib/evidence-export.mts'));
        const evidenceModule = await loadEvidence();
        const report = buildCliEvidenceExport(JSON.stringify(document), evidenceModule, now);
        write(stdout, args.output === 'markdown'
          ? formatLookupEvidenceMarkdown(report)
          : formatLookupEvidenceHtml(report));
      } else {
        write(stdout, terminal(formatTerminalLookup(document, { detail: args.detail }), args.color));
      }
    }
    const strictFindings = args.strictExit ? lookupStrictExitFindings(document) : [];
    const exitCode = strictFindings.length ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
    if (strictFindings.length && !args.events) {
      write(stderr, `Strict exit: ${strictFindings.length} requested source state${strictFindings.length === 1 ? '' : 's'} were incomplete.\n`);
    }
    eventProgress.emit({ event: 'completed', exitCode });
    return exitCode;
  } catch (error) {
    (progress as TerminalProgress | null)?.stop();
    progress = null;
    if (isCancellation(error, dependencies.signal)) {
      eventProgress?.emit({ event: 'cancelled', exitCode: EXIT_CODES.CANCELLED });
      if (!eventProgress?.enabled) write(stderr, 'Cancelled by analyst.\n');
      return EXIT_CODES.CANCELLED;
    }
    if (error instanceof CliUsageError) {
      eventProgress?.emit({ event: 'failed', state: 'usage', exitCode: EXIT_CODES.USAGE });
      if (!eventProgress?.enabled) write(stderr, `Usage error: ${boundedCliErrorMessage(error, 'Invalid command')}\n`);
      return EXIT_CODES.USAGE;
    }
    eventProgress?.emit({ event: 'failed', state: 'operational', exitCode: EXIT_CODES.LOOKUP_FAILED });
    if (!eventProgress?.enabled) write(stderr, `${failureLabel} failed: ${boundedCliErrorMessage(error, 'Unexpected command failure')}\n`);
    return EXIT_CODES.LOOKUP_FAILED;
  }
}

async function runCli(argv: unknown, dependencies: CliDependencies = {}): Promise<number> {
  const stderr = dependencies.stderr || process.stderr;
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

export { HELP, MAX_STDIN_BYTES, VERSION, readStdinBounded, runCli };
export type { CliDependencies, WritableLike };
