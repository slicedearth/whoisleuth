import { Buffer } from 'node:buffer';
import { createReadStream } from 'node:fs';
import { createRequire } from 'node:module';

import { abortable } from '../lib/abort.mts';
import { resolvePublicAddresses, safeFetch } from '../lib/safe-fetch.mts';
import { whoisQuery } from '../lib/whois-transport.mts';
import { REGISTRY_CAPABILITIES_VERSION, registryCapabilityFor } from '../lib/registry-capabilities.mts';
import { explainRiskScore, RISK_MODEL_VERSION, RISK_REVIEW_THRESHOLD } from '../lib/risk-scoring.mts';
import { CLI_COMMANDS, parseCliArguments } from './arguments.mts';
import type { CliArguments, CliCommand } from './arguments.mts';
import { runBulkCommand } from './bulk-command-runner.mts';
import { buildCliCommandCatalogue, formatCliCommandCatalogue } from './command-catalogue.mts';
import { buildShellCompletion } from './completion.mts';
import { buildDoctorReport, formatDoctorReport } from './doctor.mts';
import type { BoundedTextStream } from './bulk.mts';
import {
  MAX_COMPARE_INPUT_BYTES,
  compareLookupDocument,
  parseCliLookupDocument,
  readCompareInputBounded,
} from './compare.mts';
import { runDiscoveryCommand } from './discovery-command-runner.mts';
import { runDiscoveryScanCommand } from './discovery-scan-command-runner.mts';
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
  buildCliCompareDocument,
  formatJsonDocument,
} from './formatters/json.mts';
import { formatLookupEvidenceMarkdown } from './formatters/markdown.mts';
import {
  formatTerminalCompare,
  formatTerminalRegistrySupport,
  formatTerminalRiskCalibration,
} from './formatters/terminal.mts';
import { buildCliLookupDiff, formatCliLookupDiff } from './lookup-diff.mts';
import {
  MAX_LOOKUP_TIMELINE_INPUT_BYTES,
  buildCliLookupTimeline,
  formatCliLookupTimeline,
} from './lookup-timeline.mts';
import { buildCliPageComparison, formatCliPageComparison } from './page-compare.mts';
import {
  MAX_MAIL_REVIEW_INPUT_BYTES,
  buildCliMailReview,
  formatCliMailReview,
} from './mail-review.mts';
import { runLookupCommand } from './lookup-command-runner.mts';
import { buildCliManual } from './manual.mts';
import { createBufferedOutput, writePrivateFile } from './output-file.mts';
import { createTerminalProgress, type TerminalProgress } from './progress.mts';
import type { CliProgressEvents } from './progress-events.mts';
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
import {
  presentTerminalOutput,
  terminalPresentation,
  type TerminalEnvironment,
} from './terminal-presentation.mts';
import { runNetworkCommand } from './network-command-runner.mts';
import type { CliCommandContext, CliDependencies, WritableLike } from './runner-types.mts';

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
  discover-scan      Collect a bounded candidate review queue.
  registry-support   Explain local registry coverage without a request.

Review saved evidence:
  source-report      Summarise source reliability without retaining targets.
  compare            Compare saved registry publications.
  page-compare       Compare saved static page and TLS evidence.
  mail-review        Review saved passive mail exposure evidence.
  diff               Compare two saved domain observations.
  timeline           Compare a sequence of observations for one domain.
  export             Convert a saved lookup into an evidence report.
  inspect-archive    Inspect a workspace archive, redacted by default.
  verify-artifact    Validate saved evidence or an integrity envelope offline.

Integrity and calibration:
  sign-artifact      Sign one reviewed packet or manifest locally.
  verify-signature   Verify one signed evidence package locally.
  risk-calibrate     Replay reviewed labels without changing the model.

Terminal:
  doctor             Check the local runtime; network tests require --network.
  commands           List command contracts for people or local tooling.
  completion         Print completion for bash, zsh, fish, or PowerShell.
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
  completion: 'whoisleuth completion <bash|zsh|fish|powershell>',
  doctor: 'whoisleuth doctor [--network] [--json] [--quiet] [--no-color]',
  commands: 'whoisleuth commands [--json] [--quiet] [--no-color]',
  manual: 'whoisleuth manual',
  lookup: 'whoisleuth lookup <domain|IP|ASN> [--json|--markdown|--html] [--fast|--deep] [--plan] [--summary|--verbose] [--strict-exit] [--events] [--quiet] [--no-color]',
  bulk: 'whoisleuth bulk [file] [--json|--jsonl|--csv|--domains|--queries] [--registered-only|--inconclusive-only|--errors-only] [--fast|--deep] [--concurrency <1-8>] [--checkpoint <file> [--resume]] [--events]',
  'ct-search': 'whoisleuth ct-search <keyword> [--json] [--quiet] [--no-color]',
  discover: 'whoisleuth discover <brand|domain> [--tlds <list>] [--preset <name>|--families <ids>] [--keyboard <layout>] [--dictionary <file>] [--snapshot <file>] [--json|--jsonl|--domains]',
  'discover-scan': 'whoisleuth discover-scan <brand|domain> [--fast|--deep] [--scan-limit <n>] [--chunk-size <n>] [--concurrency <n>] [--resolver <IPs>] [--allowlist <file>] [--checkpoint <file> [--resume]] [--observation-snapshot <file>] [--json|--jsonl|--csv|--domains]',
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
  'page-compare': 'whoisleuth page-compare <left.json> <right.json> [--json] [--quiet] [--no-color]',
  'mail-review': 'whoisleuth mail-review [bulk.json|bulk.jsonl] [--json] [--quiet] [--no-color]',
  diff: 'whoisleuth diff <left.json> <right.json> [--json] [--quiet] [--no-color]',
  timeline: 'whoisleuth timeline <observation.json> <observation.json> [...] [--json] [--quiet] [--no-color]',
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
  commands: {
    description: 'List the installed command contracts in terminal or versioned JSON form.',
    example: 'whoisleuth commands --json',
    boundary: 'Catalogue generation is offline. It reports declared command modes and limits without executing collection or inspecting local evidence.',
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
    boundary: 'Fast and deep jobs use separate concurrency ceilings. Filters affect output only; collection failures and inconclusive authority states remain explicit in JSON, JSONL, and CSV.',
  },
  'ct-search': {
    description: 'Search certificate-transparency observations for one bounded keyword.',
    example: 'whoisleuth ct-search "example brand" --json',
    boundary: 'Certificate observations do not prove website activity, registration ownership, or malicious intent.',
  },
  discover: {
    description: 'Generate bounded lookalike-domain candidates from local mutation rules.',
    example: 'whoisleuth discover example.test --preset common --jsonl',
    boundary: 'Generation and optional local snapshot comparison are offline. Candidates are leads only and are not resolved, registered, or classified as malicious.',
  },
  'discover-scan': {
    description: 'Generate a bounded candidate set, collect a selected subset, and produce a supervised review queue.',
    example: 'whoisleuth discover-scan example.test --scan-limit 50 --checkpoint scan.json --json',
    boundary: 'This command performs network collection. Fast compact lookup is the default; deep mode is capped at 50 candidates. Allowlisting changes review priority only and shared infrastructure remains a lead, not attribution.',
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
    description: 'Validate a supported archive, packet, manifest, or saved Lookup without printing evidence contents.',
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
  'page-compare': {
    description: 'Compare static page identity, favicon, technology, and TLS evidence in two saved deep lookups.',
    example: 'whoisleuth page-compare official.json candidate.json --json',
    boundary: 'Comparison is offline and component-based. It executes no page code and produces no aggregate similarity or maliciousness score.',
  },
  'mail-review': {
    description: 'Review passive MX, null MX, SPF, DMARC, and shared mail-provider evidence from saved Bulk results.',
    example: 'whoisleuth mail-review candidates.json --json',
    boundary: 'Review is offline and sends no SMTP traffic. Missing or partial DNS evidence remains inconclusive.',
  },
  diff: {
    description: 'Compare bounded evidence retained in two saved domain lookups.',
    example: 'whoisleuth diff first.json second.json --json',
    boundary: 'Comparison is offline. Missing, unavailable, equal, and different evidence remain separate states.',
  },
  timeline: {
    description: 'Build an ordered same-domain history from saved Lookup observations.',
    example: 'whoisleuth timeline first.json second.json latest.json --json',
    boundary: 'The command is offline, accepts 2 to 20 bounded inputs for one domain, retains no filenames or raw registry payloads, and does not treat changed collection conditions as a domain change.',
  },
  export: {
    description: 'Convert one saved lookup into a versioned evidence report.',
    example: 'whoisleuth export lookup.json --markdown',
    boundary: 'Exports preserve source attribution and limitations. Compact output intentionally omits raw registry payloads.',
  },
});

const COMMAND_COLLECTION: Readonly<Record<CliCommand, Readonly<{
  mode: 'offline' | 'network';
  scope: string;
}>>> = Object.freeze({
  completion: { mode: 'offline', scope: 'Prints one static script and changes no shell configuration.' },
  doctor: { mode: 'network', scope: 'Network access is opt-in with --network and is limited to fixed public DNS, HTTPS, and WHOIS diagnostics.' },
  commands: { mode: 'offline', scope: 'Reads the embedded command catalogue and performs no collection.' },
  manual: { mode: 'offline', scope: 'Builds documentation from the embedded command catalogue.' },
  lookup: { mode: 'network', scope: 'Accepts one target. Fast is the default; deep collection must be selected explicitly.' },
  bulk: { mode: 'network', scope: 'Accepts at most 500 fast or 50 deep targets, with concurrency capped at 8 fast or 3 deep.' },
  'ct-search': { mode: 'network', scope: 'Accepts one bounded search keyword and queries the fixed certificate-transparency source.' },
  discover: { mode: 'offline', scope: 'Generates a bounded candidate set from local rules, dictionaries, and optional saved snapshots.' },
  'discover-scan': { mode: 'network', scope: 'Scans at most 500 fast or 50 deep candidates, with concurrency capped at 8 fast or 3 deep.' },
  posture: { mode: 'network', scope: 'Accepts one domain and performs bounded DNS queries only.' },
  http: { mode: 'network', scope: 'Accepts one domain and follows only the bounded SSRF-guarded homepage redirect workflow.' },
  tls: { mode: 'network', scope: 'Accepts one public hostname and opens one bounded certificate connection.' },
  'registry-support': { mode: 'offline', scope: 'Reads the embedded registry capability catalogue for one domain or suffix.' },
  'risk-calibrate': { mode: 'offline', scope: 'Reads one bounded reviewed-label dataset and changes no model or evidence.' },
  'verify-artifact': { mode: 'offline', scope: 'Reads one selected bounded archive, packet, manifest, or saved Lookup document.' },
  'inspect-archive': { mode: 'offline', scope: 'Reads one selected bounded workspace archive with redacted output by default.' },
  'sign-artifact': { mode: 'offline', scope: 'Reads one selected artifact and one local private key without transmitting either.' },
  'verify-signature': { mode: 'offline', scope: 'Reads one selected signed package and optional local public key.' },
  'source-report': { mode: 'offline', scope: 'Reads bounded saved evidence and emits target-free source reliability data.' },
  compare: { mode: 'offline', scope: 'Reads one saved Lookup and compares its separately attributed registry publications.' },
  'page-compare': { mode: 'offline', scope: 'Reads two saved Lookup documents and executes no page code.' },
  'mail-review': { mode: 'offline', scope: 'Reads one saved Bulk result and sends no DNS or SMTP traffic.' },
  diff: { mode: 'offline', scope: 'Reads two saved Lookup documents for different domains.' },
  timeline: { mode: 'offline', scope: 'Reads 2 to 20 saved observations for one domain, capped at 32 MiB in total.' },
  export: { mode: 'offline', scope: 'Reads one saved Lookup and writes one bounded report.' },
});

function commandHelp(command: CliCommand): string {
  const detail = COMMAND_DETAILS[command];
  const collection = COMMAND_COLLECTION[command];
  return `WHOISleuth ${command}\n${detail.description}\n\nUsage:\n  ${COMMAND_USAGE[command]}\n\nExample:\n  ${detail.example}\n\nCollection:\n  ${collection.mode === 'offline' ? 'Offline' : 'Network'}: ${collection.scope}\n\nBoundary:\n  ${detail.boundary}\n\nRun "whoisleuth --help" to see the grouped command list.\n`;
}

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

function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true
    || Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
}

function usageEventReason(error: unknown): string {
  const message = boundedCliErrorMessage(error, 'Invalid command input').toLowerCase();
  if (message.includes('could not read')) return 'input_unavailable';
  if (message.includes('cannot be combined') || message.includes('mutually exclusive')) return 'conflicting_options';
  if (message.includes('requires') || message.includes('did not contain')) return 'missing_input';
  return 'invalid_input';
}

async function runParsedCli(args: CliArguments, dependencies: CliDependencies = {}): Promise<number> {
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  const environment = dependencies.environment || process.env;
  let progress: TerminalProgress | null = null;
  const eventProgress: { current: CliProgressEvents | null } = { current: null };
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
    const readSingleInput = async (): Promise<string> => (
      dependencies.readStdin
        ? await dependencies.readStdin()
        : await readStdinBounded(dependencies.stdin || process.stdin)
    );
    const commandContext: CliCommandContext = Object.freeze({
      stdout,
      stderr,
      terminal,
      writeStdout: (value: string) => write(stdout, value),
      writeStderr: (value: string) => write(stderr, value),
      readSingleInput,
      now: () => dependencies.now ? dependencies.now() : new Date().toISOString(),
      beginProgress,
      endProgress,
      withProgress,
      setEventProgress: (next: CliProgressEvents) => {
        eventProgress.current = next;
      },
    });
    if (args.action === 'help') {
      write(stdout, terminal(args.command ? commandHelp(args.command) : HELP));
      return EXIT_CODES.SUCCESS;
    }
    if (args.action === 'version') { write(stdout, `${VERSION}\n`); return EXIT_CODES.SUCCESS; }

    if (args.action === 'completion') {
      write(stdout, buildShellCompletion(args.shell));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'commands') {
      const catalogue = buildCliCommandCatalogue({
        commands: CLI_COMMANDS,
        collections: COMMAND_COLLECTION,
        details: COMMAND_DETAILS,
        usage: COMMAND_USAGE,
        packageVersion: VERSION,
      });
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(catalogue)
        : terminal(formatCliCommandCatalogue(catalogue), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'manual') {
      write(stdout, buildCliManual({
        commands: CLI_COMMANDS,
        collections: COMMAND_COLLECTION,
        details: COMMAND_DETAILS,
        usage: COMMAND_USAGE,
        version: VERSION,
      }));
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
        ...(dependencies.safeFetch ? { fetchHttps: dependencies.safeFetch } : { fetchHttps: safeFetch }),
        ...(dependencies.whoisQuery ? { queryWhois: dependencies.whoisQuery } : {}),
      });
      const report = args.network
        ? await withProgress('Checking public DNS, HTTPS, and WHOIS connectivity', buildReport)
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

    if (args.action === 'page-compare') {
      failureLabel = 'Static page comparison';
      const readDiffInput = dependencies.readDiffInput || (async (source: string) => (
        readSavedLookupInputBounded(createReadStream(source, { highWaterMark: 64 * 1024 }), {
          limit: MAX_SAVED_LOOKUP_INPUT_BYTES,
          label: 'Page comparison input',
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
        throw new CliUsageError(`Could not read page comparison input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      const document = buildCliPageComparison(leftInput, rightInput, commandContext.now());
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatCliPageComparison(document), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'mail-review') {
      failureLabel = 'Passive mail review';
      let input: string;
      try {
        input = dependencies.readMailReviewInput
          ? await dependencies.readMailReviewInput(args.source)
          : await readSavedLookupInputBounded(args.source
            ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, {
              limit: MAX_MAIL_REVIEW_INPUT_BYTES,
              label: 'Mail review input',
            });
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read mail review input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      const document = buildCliMailReview(input, commandContext.now());
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatCliMailReview(document), args.color));
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

    if (args.action === 'timeline') {
      failureLabel = 'Lookup observation timeline';
      const readTimelineInput = dependencies.readDiffInput || (async (source: string) => (
        readSavedLookupInputBounded(createReadStream(source, { highWaterMark: 64 * 1024 }), {
          limit: MAX_SAVED_LOOKUP_INPUT_BYTES,
          label: 'Lookup timeline input',
        })
      ));
      const inputs: string[] = [];
      let totalBytes = 0;
      try {
        for (const source of args.sources) {
          const input = await readTimelineInput(source);
          totalBytes += Buffer.byteLength(input, 'utf8');
          if (totalBytes > MAX_LOOKUP_TIMELINE_INPUT_BYTES) {
            throw new CliUsageError(`Lookup timeline input is limited to ${MAX_LOOKUP_TIMELINE_INPUT_BYTES} bytes in total.`);
          }
          inputs.push(input);
        }
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read Lookup timeline input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      const document = buildCliLookupTimeline(inputs, commandContext.now());
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatCliLookupTimeline(document), args.color));
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
      return await runBulkCommand(args, dependencies, commandContext);
    }

    if (args.action === 'discover') {
      failureLabel = 'Candidate generation';
      return await runDiscoveryCommand(args, dependencies, commandContext);
    }

    if (args.action === 'discover-scan') {
      failureLabel = 'Candidate scan';
      return await runDiscoveryScanCommand(args, dependencies, commandContext);
    }

    if (args.action === 'ct-search'
      || args.action === 'posture'
      || args.action === 'http'
      || args.action === 'tls') {
      failureLabel = args.action === 'ct-search'
        ? 'Certificate Transparency search'
        : args.action === 'posture'
          ? 'Domain posture audit'
          : args.action === 'http'
            ? 'HTTP probe'
            : 'TLS intelligence';
      return await runNetworkCommand(args, dependencies, commandContext);
    }

    return await runLookupCommand(args, dependencies, commandContext);
  } catch (error) {
    (progress as TerminalProgress | null)?.stop();
    progress = null;
    if (isCancellation(error, dependencies.signal)) {
      eventProgress.current?.emit({ event: 'cancelled', exitCode: EXIT_CODES.CANCELLED });
      if (!eventProgress.current?.enabled) write(stderr, 'Cancelled by analyst.\n');
      return EXIT_CODES.CANCELLED;
    }
    if (error instanceof CliUsageError) {
      eventProgress.current?.emit({
        event: 'failed',
        state: 'usage',
        reason: usageEventReason(error),
        exitCode: EXIT_CODES.USAGE,
      });
      if (!eventProgress.current?.enabled) write(stderr, `Usage error: ${boundedCliErrorMessage(error, 'Invalid command')}\n`);
      return EXIT_CODES.USAGE;
    }
    eventProgress.current?.emit({ event: 'failed', state: 'operational', exitCode: EXIT_CODES.LOOKUP_FAILED });
    if (!eventProgress.current?.enabled) write(stderr, `${failureLabel} failed: ${boundedCliErrorMessage(error, 'Unexpected command failure')}\n`);
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
