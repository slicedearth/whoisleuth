import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';

import { abortable } from '../lib/abort.mts';
import { scanBoundedJson } from '../lib/bounded-json.mts';
import { REGISTRY_CAPABILITIES_VERSION, registryCapabilityFor } from '../lib/registry-capabilities.mts';
import { explainRiskScore, explainRiskScoreV6, RISK_MODEL_VERSION, RISK_REVIEW_THRESHOLD } from '../lib/risk-scoring.mts';
import { buildRiskCalibrationSummaryReport } from '../lib/risk-calibration-summary.mts';
import { CLI_COMMANDS, parseCliArguments } from './arguments.mts';
import type { CliArguments } from './arguments.mts';
import { buildCliCommandCatalogue, formatCliCommandCatalogue } from './command-catalogue.mts';
import {
  COMMAND_COLLECTION,
  COMMAND_DETAILS,
  COMMAND_USAGE,
  HELP,
  commandHelp,
} from './command-reference.mts';
import { buildShellCompletion } from './completion.mts';
import { buildDoctorReport, formatDoctorReport } from './doctor.mts';
import type { BoundedTextStream } from './bulk.mts';
import {
  MAX_COMPARE_INPUT_BYTES,
  compareLookupDocument,
  parseCliLookupDocument,
} from './compare.mts';
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
import {
  MAX_RETAINED_ARTIFACT_DIFF_BYTES,
  buildCliRetainedArtifactDiff,
  formatCliRetainedArtifactDiff,
} from './retained-artifact-diff.mts';
import {
  MAX_LOOKUP_RECONCILIATION_INPUT_BYTES,
  buildCliLookupReconciliation,
  formatCliLookupReconciliation,
} from './lookup-reconcile.mts';
import {
  MAX_SHARING_REVIEW_BYTES,
  buildSharingReview,
  formatSharingReview,
} from './sharing-review.mts';
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
import {
  MAX_OFFLINE_EVIDENCE_INPUT_BYTES,
  buildOfflineEvidenceReview,
  buildOfflineEvidenceReviewWithLocalResources,
  formatOfflineEvidenceReview,
} from './offline-evidence-review.mts';
import {
  DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
  DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
  buildDomainControlManifest,
  formatDomainControlResult,
  reviewDomainControlManifest,
} from '../lib/domain-control-manifest.mts';
import {
  DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA,
  buildDomainControlFlightRecorder,
  formatDomainControlFlightRecorder,
} from '../lib/domain-control-flight-recorder.mts';
import {
  CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
  MAX_DOMAIN_CONTROL_REVIEW_JSON_DEPTH,
  MAX_DOMAIN_CONTROL_REVIEW_JSON_KEYS,
  MAX_DOMAIN_CONTROL_REVIEW_JSON_VALUES,
  buildCliDomainControlReview,
  formatCliDomainControlReview,
} from './domain-control-observations.mts';
import { buildCliLookupBrief, formatCliLookupBrief } from './lookup-brief.mts';
import { buildCliCasePack, formatCliCasePack } from './case-pack.mts';
import { formatDomainControlMonitor, runDomainControlMonitor } from './domain-control-monitor.mts';
import {
  MAX_ASSURANCE_INPUT_BYTES,
  buildDomainAssurance,
  formatDomainAssurance,
} from '../lib/domain-assurance.mts';
import {
  MAX_DOMAIN_CHANGE_PACKET_INPUT_BYTES,
  buildDomainChangePacket,
  formatDomainChangePacket,
} from '../lib/domain-change-packet.mts';
import { buildCliManual } from './manual.mts';
import {
  MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES,
  MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES,
  buildInvestigationManifest,
  formatInvestigationManifest,
} from './investigation-manifest.mts';
import {
  MAX_EXTERNAL_OBSERVATION_MAPPING_BYTES,
  mapExternalObservations,
  formatExternalObservationMapping,
} from './external-observation-mapping.mts';
import {
  buildOpenAssetModelBridge,
  formatOpenAssetModelBridge,
} from './open-asset-model-bridge.mts';
import {
  MAX_CT_EVENT_INPUT_BYTES,
  buildCtEventFindings,
  formatCtEventFindings,
} from './ct-event-intake.mts';
import { buildInvestigationPlan, formatInvestigationPlan } from './investigation-plan.mts';
import { MAX_INVESTIGATION_RUN_BYTES, formatInvestigationRun, runInvestigationRecipe } from './investigation-run.mts';
import { readCliTextInput } from './input.mts';
import { evaluateCliFailPolicies, formatFailPolicyNotice } from './fail-policy.mts';
import { formatCliJunit } from './ci-report.mts';
import { cleanupPendingOutputFiles, createBufferedOutput, writePrivateFile } from './output-file.mts';
import {
  canLaunchInteractiveCli,
  launchInteractiveCli,
  type InteractiveLauncherInput,
  type InteractiveLauncherOutput,
} from './interactive-launcher.mts';
import { createTerminalProgress, type TerminalProgress } from './progress.mts';
import type { CliProgressEvents } from './progress-events.mts';
import { buildRegistrySupportDocument } from './registry-support.mts';
import { buildRegistryDoctorReport, formatRegistryDoctorReport } from './registry-doctor.mts';
import {
  MAX_REGISTRY_COHORT_INPUT_BYTES,
  buildRegistryCohortReport,
  formatRegistryCohortReport,
} from './registry-cohort.mts';
import { buildRegistryFixtureScaffold } from './registry-fixture-scaffold.mts';
import {
  MAX_OFFLINE_ARTIFACT_BYTES,
  MAX_OFFLINE_PASSPHRASE_FILE_BYTES,
  formatOfflineArtifactVerification,
  isCompleteOfflineArtifactVerification,
  verifyOfflineArtifact,
} from './artifact-verify.mts';
import {
  buildInterchangeFidelityReport,
  formatInterchangeFidelityReport,
} from './interchange-report.mts';
import {
  MAX_SOURCE_RELIABILITY_INPUT_BYTES,
  buildSourceReliabilityReport,
  formatSourceReliabilityReport,
} from './source-reliability.mts';
import {
  MAX_RISK_CALIBRATION_INPUT_BYTES,
  buildRiskCalibrationReport,
  parseRiskCalibrationDataset,
} from './risk-calibration.mts';
import {
  MAX_LOOKALIKE_CALIBRATION_BYTES,
  buildLookalikeCalibration,
  formatLookalikeCalibration,
} from './lookalike-calibration.mts';
import { MAX_SAVED_LOOKUP_INPUT_BYTES } from './saved-lookup.mts';
import {
  presentTerminalOutput,
  terminalPresentation,
  type TerminalEnvironment,
  type TerminalPalette,
} from './terminal-presentation.mts';
import type { CliCommandContext, CliDependencies, WritableLike } from './runner-types.mts';

const require = createRequire(import.meta.url);
const { version: VERSION } = require('../package.json') as { version: string };
const MAX_STDIN_BYTES = 4096;

async function readStdinBounded(
  stream: BoundedTextStream | null | undefined,
  limit = MAX_STDIN_BYTES,
  signal?: AbortSignal,
): Promise<string> {
  const text = (await readCliTextInput(null, stream, {
    maximumBytes: limit,
    label: 'Standard input',
    ...(signal ? { signal } : {}),
  })).trim();
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
  palette: TerminalPalette,
): string {
  return presentTerminalOutput(value, terminalPresentation(stream, color, environment, palette));
}

function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  if (error instanceof AggregateError) {
    return error.errors.length > 0 && error.errors.every((item) => isCancellation(item));
  }
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
    const palette = args.palette || 'auto';
    const terminal = (value: string, color = true) => formatForTerminal(value, stdout, color, environment, palette);
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
        palette,
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
        : await readStdinBounded(dependencies.stdin || process.stdin, MAX_STDIN_BYTES, dependencies.signal)
    );
    const readInput = async (source: string | null | undefined, maximumBytes: number, label: string): Promise<string> => (
      readCliTextInput(source, dependencies.stdin || process.stdin, {
        maximumBytes,
        label,
        ...(dependencies.signal ? { signal: dependencies.signal } : {}),
      })
    );
    const readPassphraseSource = async (source: string): Promise<string> => {
      let passphraseText: string;
      try {
        passphraseText = dependencies.readPassphraseFile
          ? await dependencies.readPassphraseFile(source)
          : await readInput(source, MAX_OFFLINE_PASSPHRASE_FILE_BYTES, 'Passphrase file');
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read passphrase file: ${boundedCliErrorMessage(error, 'File could not be read')}`);
      }
      const passphrase = passphraseText.replace(/\r?\n$/u, '');
      if (!passphrase || /[\r\n\u0000]/u.test(passphrase)) {
        throw new CliUsageError('Passphrase file must contain exactly one non-empty UTF-8 line.');
      }
      return passphrase;
    };
    const commandContext: CliCommandContext = Object.freeze({
      stdout,
      stderr,
      terminal,
      writeStdout: (value: string) => write(stdout, value),
      writeStderr: (value: string) => write(stderr, value),
      readSingleInput,
      readInput,
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

    if (args.action === 'manifest') {
      failureLabel = 'Investigation manifest';
      const artifacts: { content: string }[] = [];
      let totalBytes = 0;
      try {
        for (const source of args.sources) {
          const content = dependencies.readDiffInput
            ? await dependencies.readDiffInput(source)
            : await readInput(source, MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES, 'Manifest artefact input');
          totalBytes += Buffer.byteLength(content, 'utf8');
          if (totalBytes > MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES) {
            throw new CliUsageError(`Manifest artefacts exceed the ${MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES}-byte combined limit.`);
          }
          artifacts.push({ content });
        }
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read manifest artefact input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      let document;
      try {
        document = await buildInvestigationManifest({
          workflow: args.workflow,
          configurationDigestSha256: args.configurationDigestSha256,
          artifacts,
        }, commandContext.now(), VERSION);
      } catch (error) {
        throw new CliUsageError(boundedCliErrorMessage(error, 'Investigation manifest input is invalid'));
      }
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatInvestigationManifest(document), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'map-observations' || args.action === 'oam-export') {
      const mapping = args.action === 'map-observations';
      failureLabel = mapping ? 'External observation mapping' : 'Open Asset Model export';
      let input: string;
      try {
        input = dependencies.readArtifactInput
          ? await dependencies.readArtifactInput(args.source)
          : await readInput(
            args.source,
            MAX_EXTERNAL_OBSERVATION_MAPPING_BYTES,
            mapping ? 'External observation mapping input' : 'Open Asset Model bridge input',
          );
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read ${mapping ? 'observation mapping' : 'asset bridge'} input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError(`${args.action} requires one versioned JSON file or a document on stdin.`);
      let parsed: unknown;
      try {
        scanBoundedJson(input);
        parsed = JSON.parse(input);
      } catch {
        throw new CliUsageError(`${mapping ? 'External observation mapping' : 'Open Asset Model bridge'} input is not valid bounded JSON without duplicate keys.`);
      }
      let document;
      try {
        document = mapping
          ? mapExternalObservations(parsed)
          : buildOpenAssetModelBridge(parsed, commandContext.now());
      } catch (error) {
        throw new CliUsageError(boundedCliErrorMessage(error, `${mapping ? 'External observation mapping' : 'Open Asset Model bridge'} input is invalid`));
      }
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(mapping
          ? formatExternalObservationMapping(document as ReturnType<typeof mapExternalObservations>)
          : formatOpenAssetModelBridge(document as ReturnType<typeof buildOpenAssetModelBridge>), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'doctor') {
      failureLabel = 'CLI diagnostics';
      const buildReport = () => buildDoctorReport({
        version: VERSION,
        generatedAt: dependencies.now ? dependencies.now() : new Date().toISOString(),
        network: args.network,
        presentation: terminalPresentation(stdout, args.color, environment, palette),
        ...(dependencies.resolvePublicAddresses ? { resolveAddresses: dependencies.resolvePublicAddresses } : {}),
        ...(dependencies.safeFetch ? { fetchHttps: dependencies.safeFetch } : {}),
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
      const readInput = dependencies.readStdin || (() => readStdinBounded(
        dependencies.stdin || process.stdin,
        MAX_STDIN_BYTES,
        dependencies.signal,
      ));
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

    if (args.action === 'registry-doctor') {
      failureLabel = 'Registry compatibility diagnostic';
      let input: string;
      try {
        input = dependencies.readCompareInput
          ? await dependencies.readCompareInput(args.source)
          : await readInput(args.source, MAX_SAVED_LOOKUP_INPUT_BYTES, 'Registry doctor input');
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read registry doctor input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('registry-doctor requires one saved Lookup JSON file or a document on stdin.');
      const report = buildRegistryDoctorReport(input, commandContext.now());
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(report)
        : terminal(formatRegistryDoctorReport(report), args.color));
      return report.summary.investigate ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
    }

    if (args.action === 'registry-cohort') {
      failureLabel = 'Registry quality cohort';
      let input: string;
      try {
        input = dependencies.readCompareInput
          ? await dependencies.readCompareInput(args.source)
          : await readInput(args.source, MAX_REGISTRY_COHORT_INPUT_BYTES, 'Registry cohort input');
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read registry cohort input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      const report = buildRegistryCohortReport(input, commandContext.now());
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(report)
        : terminal(formatRegistryCohortReport(report), args.color));
      return report.cohorts.some((cohort) => cohort.state === 'review')
        ? EXIT_CODES.PARTIAL_FAILURE
        : EXIT_CODES.SUCCESS;
    }

    if (args.action === 'registry-scaffold') {
      failureLabel = 'Registry fixture scaffold';
      try {
        write(stdout, buildRegistryFixtureScaffold(args.profile, args.suffix, args.scenario));
      } catch (error) {
        throw new CliUsageError(boundedCliErrorMessage(error, 'Registry fixture scaffold failed'));
      }
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'risk-calibrate') {
      failureLabel = 'Risk calibration';
      let input: string;
      try {
        input = dependencies.readRiskCalibrationInput
          ? await dependencies.readRiskCalibrationInput(args.source)
          : await readInput(args.source, MAX_RISK_CALIBRATION_INPUT_BYTES, 'Risk calibration input');
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
        ...(!dependencies.explainRiskScore ? {
          previousModelVersion: 6,
          explainPreviousRiskScore: explainRiskScoreV6,
        } : {}),
      });
      if (!args.quiet) write(stdout, args.output === 'summary_json'
        ? formatJsonDocument(buildRiskCalibrationSummaryReport(report))
        : args.output === 'json'
          ? formatJsonDocument(report)
          : terminal(formatTerminalRiskCalibration(report), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'lookalike-calibrate') {
      failureLabel = 'Lookalike review-yield calibration';
      let input: string;
      try {
        input = dependencies.readRiskCalibrationInput
          ? await dependencies.readRiskCalibrationInput(args.source)
          : await readInput(args.source, MAX_LOOKALIKE_CALIBRATION_BYTES, 'Lookalike calibration input');
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read lookalike calibration input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('lookalike-calibrate requires one dataset JSON file or a document on stdin.');
      let report;
      try {
        report = buildLookalikeCalibration(input, commandContext.now());
      } catch (error) {
        throw new CliUsageError(boundedCliErrorMessage(error, 'Lookalike calibration input is invalid'));
      }
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(report)
        : terminal(formatLookalikeCalibration(report), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'verify-artifact') {
      failureLabel = 'Artefact verification';
      let input: string;
      try {
        input = dependencies.readArtifactInput
          ? await dependencies.readArtifactInput(args.source)
          : await readInput(args.source, MAX_OFFLINE_ARTIFACT_BYTES, 'Artefact input');
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read artifact input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('verify-artifact requires one JSON file or an artefact on stdin.');

      const passphrase = args.passphraseSource ? await readPassphraseSource(args.passphraseSource) : null;
      let manifest: Readonly<{ raw: string; entryId: string }> | null = null;
      if (args.manifestSource && args.manifestEntryId) {
        let raw: string;
        try {
          raw = dependencies.readArtifactInput
            ? await dependencies.readArtifactInput(args.manifestSource)
            : await readInput(args.manifestSource, MAX_OFFLINE_ARTIFACT_BYTES, 'Investigation manifest input');
        } catch (error) {
          if (error instanceof CliUsageError) throw error;
          throw new CliUsageError(`Could not read investigation manifest input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
        }
        if (!raw.trim()) throw new CliUsageError('The investigation manifest input is empty.');
        manifest = Object.freeze({ raw, entryId: args.manifestEntryId });
      }

      const report = await verifyOfflineArtifact(input, { passphrase, manifest });
      if (!args.quiet) {
        write(stdout, args.output === 'json'
          ? formatJsonDocument(report)
          : terminal(formatOfflineArtifactVerification(report), args.color));
      }
      return args.strictExit && !isCompleteOfflineArtifactVerification(report)
        ? EXIT_CODES.PARTIAL_FAILURE
        : EXIT_CODES.SUCCESS;
    }

    if (args.action === 'interchange-report') {
      failureLabel = 'Interchange fidelity report';
      let input: string;
      try {
        input = dependencies.readArtifactInput
          ? await dependencies.readArtifactInput(args.source)
          : await readInput(args.source, MAX_OFFLINE_ARTIFACT_BYTES, 'Interchange input');
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read interchange input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('interchange-report requires one JSON file or an artefact on stdin.');
      const passphrase = args.passphraseSource ? await readPassphraseSource(args.passphraseSource) : null;
      const report = await buildInterchangeFidelityReport(input, {
        generatedAt: commandContext.now(),
        passphrase,
      });
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(report)
        : terminal(formatInterchangeFidelityReport(report), args.color));
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
        signal: dependencies.signal,
      });
    }

    if (args.action === 'source-report') {
      failureLabel = 'Source reliability report';
      let input: string;
      try {
        input = dependencies.readSourceReliabilityInput
          ? await dependencies.readSourceReliabilityInput(args.source)
          : await readInput(args.source, MAX_SOURCE_RELIABILITY_INPUT_BYTES, 'Source reliability input');
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
          : await readInput(args.source, MAX_COMPARE_INPUT_BYTES, 'Comparison input');
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
      const readDiffInput = dependencies.readDiffInput
        || ((source: string) => readInput(source, MAX_SAVED_LOOKUP_INPUT_BYTES, 'Page comparison input'));
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
          : await readInput(args.source, MAX_MAIL_REVIEW_INPUT_BYTES, 'Mail review input');
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

    if (args.action === 'review-evidence') {
      failureLabel = 'Offline evidence review';
      let input: string;
      try {
        input = dependencies.readArtifactInput
          ? await dependencies.readArtifactInput(args.source)
          : await readInput(args.source, MAX_OFFLINE_EVIDENCE_INPUT_BYTES, 'Offline evidence input');
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read offline evidence input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('review-evidence requires one JSON file or a document on stdin.');
      const document = args.mmdbSource
        ? await buildOfflineEvidenceReviewWithLocalResources(input, commandContext.now(), { mmdbPath: args.mmdbSource })
        : buildOfflineEvidenceReview(input, commandContext.now());
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatOfflineEvidenceReview(document), args.color));
      if (args.strictExit) {
        const result = document.result && typeof document.result === 'object' && !Array.isArray(document.result)
          ? document.result as Record<string, unknown>
          : {};
        const gate = result.gate && typeof result.gate === 'object' && !Array.isArray(result.gate)
          ? result.gate as Record<string, unknown>
          : null;
        const zoneMismatch = document.kind === 'zone_intent' && (
          result.complete !== true
          || (result.counts && typeof result.counts === 'object' && !Array.isArray(result.counts)
            && ['different', 'missing', 'unexpected', 'incomplete'].some((key) => Number((result.counts as Record<string, unknown>)[key]) > 0))
        );
        if (gate?.pass === false || zoneMismatch) return EXIT_CODES.PARTIAL_FAILURE;
      }
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'brief' || args.action === 'case-pack') {
      const isBrief = args.action === 'brief';
      failureLabel = isBrief ? 'Lookup brief' : 'Case pack';
      let input: string;
      try {
        input = dependencies.readArtifactInput
          ? await dependencies.readArtifactInput(args.source)
          : await readInput(
            args.source,
            isBrief ? MAX_SAVED_LOOKUP_INPUT_BYTES : 4 * 1024 * 1024,
            isBrief ? 'Lookup brief input' : 'Case-pack input',
          );
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read ${isBrief ? 'Lookup brief' : 'case-pack'} input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError(`${args.action} requires one JSON file or a document on stdin.`);
      if (args.action === 'brief') {
        const document = buildCliLookupBrief(input, commandContext.now());
        if (!args.quiet) write(stdout, args.output === 'json'
          ? formatJsonDocument(document)
          : terminal(formatCliLookupBrief(document), args.color));
      } else {
        const document = buildCliCasePack(input, { audience: args.audience, reviewed: args.reviewed }, commandContext.now());
        if (!args.quiet) write(stdout, args.output === 'json'
          ? formatJsonDocument(document)
          : terminal(formatCliCasePack(document), args.color));
      }
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'domain-control') {
      failureLabel = 'Domain control review';
      let input: string;
      try {
        input = dependencies.readArtifactInput
          ? await dependencies.readArtifactInput(args.source)
          : await readInput(args.source, MAX_OFFLINE_EVIDENCE_INPUT_BYTES, 'Domain control input');
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read domain control input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('domain-control requires one JSON file or a document on stdin.');
      const normalizedDomainControlInput = input.replace(/^\uFEFF/u, '');
      let parsed: unknown;
      try {
        scanBoundedJson(normalizedDomainControlInput, {
          maximumDepth: MAX_DOMAIN_CONTROL_REVIEW_JSON_DEPTH,
          maximumKeys: MAX_DOMAIN_CONTROL_REVIEW_JSON_KEYS,
          maximumValues: MAX_DOMAIN_CONTROL_REVIEW_JSON_VALUES,
        });
        parsed = JSON.parse(normalizedDomainControlInput);
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : '';
        if (detail.startsWith('Artefact JSON ')) {
          throw new CliUsageError(`Domain control input ${detail.slice('Artefact JSON '.length)}`);
        }
        throw new CliUsageError('Domain control input is not valid JSON.');
      }
      const schema = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).schema
        : null;
      const document = schema === DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA
        ? buildDomainControlManifest(parsed, commandContext.now())
        : schema === DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA
          ? reviewDomainControlManifest(parsed, commandContext.now())
          : schema === CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA
            ? buildCliDomainControlReview(input, commandContext.now())
            : schema === DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA
              ? buildDomainControlFlightRecorder(parsed, commandContext.now())
              : null;
      if (!document) {
        throw new CliUsageError(`Domain control input must use a supported manifest, review, saved-Lookup review, or flight-recorder schema.`);
      }
      const terminalDocument = schema === CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA
        ? formatCliDomainControlReview(document as ReturnType<typeof buildCliDomainControlReview>)
        : schema === DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA
          ? formatDomainControlFlightRecorder(document as ReturnType<typeof buildDomainControlFlightRecorder>)
          : formatDomainControlResult(document as ReturnType<typeof buildDomainControlManifest> | ReturnType<typeof reviewDomainControlManifest>);
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(terminalDocument, args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'monitor-once') {
      failureLabel = 'One-shot domain control review';
      let manifestInput: string;
      let previousInput: string | null = null;
      try {
        manifestInput = dependencies.readArtifactInput
          ? await dependencies.readArtifactInput(args.source)
          : await readInput(args.source, MAX_OFFLINE_EVIDENCE_INPUT_BYTES, 'Domain-control manifest input');
        if (args.previousSource) {
          previousInput = dependencies.readDiffInput
            ? await dependencies.readDiffInput(args.previousSource)
            : await readInput(args.previousSource, MAX_OFFLINE_EVIDENCE_INPUT_BYTES, 'Prior monitor snapshot');
        }
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read monitor input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!manifestInput.trim()) throw new CliUsageError('monitor-once requires one domain-control manifest file or a document on stdin.');
      const executeLookup = dependencies.runUnifiedLookup || (await import('../lib/lookup.mts')).runUnifiedLookup;
      const progress = commandContext.beginProgress('Collecting bounded domain-control evidence');
      let document;
      try {
        document = await runDomainControlMonitor(manifestInput, previousInput, {
          executeLookup,
          now: commandContext.now,
          limit: args.limit,
          concurrency: args.concurrency,
          ...(dependencies.signal ? { signal: dependencies.signal } : {}),
          onSettled: (completed, total) => progress.update(`Collected ${completed} of ${total} owned domains`),
        });
      } finally {
        commandContext.endProgress();
      }
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : args.output === 'junit'
          ? formatCliJunit(document)
          : terminal(formatDomainControlMonitor(document), args.color));
      const policyFindings = evaluateCliFailPolicies(document, args.failOn || []);
      if (policyFindings.length) write(stderr, formatFailPolicyNotice(policyFindings));
      return document.collection.failed || policyFindings.length ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
    }

    if (args.action === 'assurance') {
      failureLabel = 'Domain assurance review';
      let input: string;
      try {
        input = dependencies.readArtifactInput
          ? await dependencies.readArtifactInput(args.source)
          : await readInput(args.source, MAX_ASSURANCE_INPUT_BYTES, 'Domain assurance input');
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read domain assurance input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('assurance requires one versioned JSON file or a document on stdin.');
      let parsed: unknown;
      try {
        scanBoundedJson(input);
        parsed = JSON.parse(input);
      } catch {
        throw new CliUsageError('Domain assurance input is not valid bounded JSON without duplicate keys.');
      }
      let document;
      try {
        document = buildDomainAssurance(parsed, commandContext.now());
      } catch (error) {
        throw new CliUsageError(boundedCliErrorMessage(error, 'Domain assurance input is invalid'));
      }
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatDomainAssurance(document), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'change-packet') {
      failureLabel = 'Domain change packet';
      let input: string;
      try {
        input = dependencies.readArtifactInput
          ? await dependencies.readArtifactInput(args.source)
          : await readInput(args.source, MAX_DOMAIN_CHANGE_PACKET_INPUT_BYTES, 'Domain change packet input');
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read domain change packet input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('change-packet requires one versioned JSON file or a document on stdin.');
      let parsed: unknown;
      try {
        scanBoundedJson(input);
        parsed = JSON.parse(input);
      } catch {
        throw new CliUsageError('Domain change packet input is not valid bounded JSON without duplicate keys.');
      }
      let document;
      try {
        document = await buildDomainChangePacket(parsed, commandContext.now());
      } catch (error) {
        throw new CliUsageError(boundedCliErrorMessage(error, 'Domain change packet input is invalid'));
      }
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatDomainChangePacket(document), args.color));
      return document.gate.pass ? EXIT_CODES.SUCCESS : EXIT_CODES.PARTIAL_FAILURE;
    }

    if (args.action === 'sharing-review') {
      failureLabel = 'Evidence sharing review';
      let input: string;
      try {
        input = dependencies.readArtifactInput
          ? await dependencies.readArtifactInput(args.source)
          : await readInput(args.source, MAX_SHARING_REVIEW_BYTES, 'Sharing review input');
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read sharing review input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('sharing-review requires one artefact JSON file or a document on stdin.');
      let document;
      try {
        document = await buildSharingReview(input, {
          marking: args.marking,
          recipientScope: args.recipientScope,
          purpose: args.purpose,
          humanReviewed: args.humanReviewed,
          personalDataReviewed: args.personalDataReviewed,
          redactionsConfirmed: args.redactionsConfirmed,
        }, commandContext.now());
      } catch (error) {
        throw new CliUsageError(boundedCliErrorMessage(error, 'Sharing review input is invalid'));
      }
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatSharingReview(document), args.color));
      return document.summary.status === 'blocked' ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
    }

    if (args.action === 'workflow-plan') {
      failureLabel = 'Investigation plan';
      const document = buildInvestigationPlan(args.recipe, args.subject, commandContext.now());
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatInvestigationPlan(document), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'workflow-run') {
      failureLabel = 'Investigation workflow';
      let resumeInput: string | null = null;
      if (args.resumeSource) {
        try {
          resumeInput = dependencies.readDiffInput
            ? await dependencies.readDiffInput(args.resumeSource)
            : await readInput(args.resumeSource, MAX_INVESTIGATION_RUN_BYTES, 'Investigation resume state');
        } catch (error) {
          if (error instanceof CliUsageError) throw error;
          throw new CliUsageError(`Could not read investigation resume state: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
        }
      }
      const document = await runInvestigationRecipe(args.recipe, args.subject, {
        approveNetwork: args.approveNetwork,
        resumeInput,
        generatedAt: commandContext.now(),
        execute: async (command, stepArguments) => {
          const stepStdout = createBufferedOutput();
          const stepStderr = createBufferedOutput();
          const exitCode = await runCli([command, ...stepArguments], {
            ...dependencies,
            stdout: stepStdout.stream,
            stderr: stepStderr.stream,
          });
          return { exitCode, stdout: stepStdout.value() };
        },
      });
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatInvestigationRun(document), args.color));
      return document.state === 'step_failed' ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
    }

    if (args.action === 'diff') {
      failureLabel = 'Retained artifact diff';
      const readDiffInput = dependencies.readDiffInput
        || ((source: string) => readInput(source, MAX_RETAINED_ARTIFACT_DIFF_BYTES, 'Retained diff input'));
      let leftInput: string;
      let rightInput: string;
      try {
        [leftInput, rightInput] = await Promise.all([
          readDiffInput(args.leftSource),
          readDiffInput(args.rightSource),
        ]);
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read retained diff input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      const document = buildCliRetainedArtifactDiff(
        leftInput,
        rightInput,
        { leftSessionId: args.leftSessionId, rightSessionId: args.rightSessionId },
        dependencies.now ? dependencies.now() : new Date().toISOString(),
      );
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatCliRetainedArtifactDiff(document), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'reconcile') {
      failureLabel = 'Lookup observation reconciliation';
      const readReconciliationInput = dependencies.readDiffInput
        || ((source: string) => readInput(source, MAX_SAVED_LOOKUP_INPUT_BYTES, 'Lookup reconciliation input'));
      const inputs: string[] = [];
      let totalBytes = 0;
      try {
        for (const source of args.sources) {
          const input = await readReconciliationInput(source);
          totalBytes += Buffer.byteLength(input, 'utf8');
          if (totalBytes > MAX_LOOKUP_RECONCILIATION_INPUT_BYTES) {
            throw new CliUsageError(`Lookup reconciliation input is limited to ${MAX_LOOKUP_RECONCILIATION_INPUT_BYTES} bytes in total.`);
          }
          inputs.push(input);
        }
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read Lookup reconciliation input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      const document = buildCliLookupReconciliation(inputs, commandContext.now());
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatCliLookupReconciliation(document), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'timeline') {
      failureLabel = 'Lookup observation timeline';
      const readTimelineInput = dependencies.readDiffInput
        || ((source: string) => readInput(source, MAX_SAVED_LOOKUP_INPUT_BYTES, 'Lookup timeline input'));
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
          : await readInput(args.source, MAX_SAVED_LOOKUP_INPUT_BYTES, 'Evidence export input');
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
        ? formatLookupEvidenceMarkdown(document, { includeAttribution: args.includeAttribution })
        : args.format === 'html'
          ? formatLookupEvidenceHtml(document, { includeAttribution: args.includeAttribution })
          : formatCliEvidenceExport(document, args.compact);
      write(stdout, output);
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'bulk') {
      failureLabel = 'Bulk lookup';
      const { runBulkCommand } = await import('./bulk-command-runner.mts');
      return await runBulkCommand(args, dependencies, commandContext);
    }

    if (args.action === 'discover') {
      failureLabel = 'Candidate generation';
      const { runDiscoveryCommand } = await import('./discovery-command-runner.mts');
      return await runDiscoveryCommand(args, dependencies, commandContext);
    }

    if (args.action === 'discover-scan') {
      failureLabel = 'Candidate scan';
      const { runDiscoveryScanCommand } = await import('./discovery-scan-command-runner.mts');
      return await runDiscoveryScanCommand(args, dependencies, commandContext);
    }

    if (args.action === 'ct-intake') {
      failureLabel = 'Certificate event intake';
      let input: string;
      try {
        input = dependencies.readArtifactInput
          ? await dependencies.readArtifactInput(args.source)
          : await readInput(args.source, MAX_CT_EVENT_INPUT_BYTES, 'Certificate event input');
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read certificate event input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('ct-intake requires one versioned JSON file or a document on stdin.');
      let parsed: unknown;
      try {
        scanBoundedJson(input);
        parsed = JSON.parse(input);
      } catch {
        throw new CliUsageError('Certificate event input is not valid bounded JSON without duplicate keys.');
      }
      let document;
      try {
        document = buildCtEventFindings(parsed);
      } catch (error) {
        throw new CliUsageError(boundedCliErrorMessage(error, 'Certificate event input is invalid'));
      }
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatCtEventFindings(document), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'ct-search'
      || args.action === 'posture'
      || args.action === 'http'
      || args.action === 'tls'
      || args.action === 'dnssec-validate'
      || args.action === 'mail-transport') {
      failureLabel = args.action === 'ct-search'
        ? 'Certificate Transparency search'
        : args.action === 'posture'
          ? 'Domain posture audit'
          : args.action === 'http'
            ? 'HTTP probe'
            : args.action === 'tls'
              ? 'TLS intelligence'
              : args.action === 'dnssec-validate'
                ? 'DNSSEC chain validation'
                : 'Mail transport review';
      const { runNetworkCommand } = await import('./network-command-runner.mts');
      return await runNetworkCommand(args, dependencies, commandContext);
    }

    const { runLookupCommand } = await import('./lookup-command-runner.mts');
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

async function runCliCommand(argv: unknown, dependencies: CliDependencies = {}): Promise<number> {
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  const environment = dependencies.environment || process.env;
  if (Array.isArray(argv) && argv.length === 0) {
    const input = (dependencies.stdin || process.stdin) as InteractiveLauncherInput;
    const output = stdout as InteractiveLauncherOutput;
    const supportsInteractiveLaunch = dependencies.canLaunchInteractiveCli || canLaunchInteractiveCli;
    if (supportsInteractiveLaunch(input, output, environment)) {
      const launch = dependencies.launchInteractiveCli || launchInteractiveCli;
      try {
        const launchedArgv = await launch({
          input,
          output,
          environment,
          ...(dependencies.signal ? { signal: dependencies.signal } : {}),
        });
        if (launchedArgv === null) return EXIT_CODES.SUCCESS;
        argv = launchedArgv;
      } catch (error) {
        if (isCancellation(error, dependencies.signal)) {
          write(stderr, 'Cancelled by analyst.\n');
          return EXIT_CODES.CANCELLED;
        }
        if (error instanceof CliUsageError) {
          write(stderr, `Usage error: ${boundedCliErrorMessage(error, 'Invalid interactive selection')}\n`);
          return EXIT_CODES.USAGE;
        }
        write(stderr, `CLI startup failed: ${boundedCliErrorMessage(error, 'Interactive launch failed')}\n`);
        return EXIT_CODES.INTERNAL_ERROR;
      }
    }
  }
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

async function runCli(argv: unknown, dependencies: CliDependencies = {}): Promise<number> {
  const stderr = dependencies.stderr || process.stderr;
  try {
    return await runCliCommand(argv, dependencies);
  } finally {
    const cleanup = dependencies.cleanupPendingOutputFiles || cleanupPendingOutputFiles;
    try {
      const report = await cleanup();
      if (report.retainedPublished > 0) {
        write(stderr, `Output cleanup warning: Published output is intact, but ${report.retainedPublished} linked temporary output ${report.retainedPublished === 1 ? 'file remains' : 'files remain'} in the selected output directory.\n`);
      }
      if (report.retainedUnpublished > 0) {
        write(stderr, `Output cleanup warning: ${report.retainedUnpublished} unpublished temporary output ${report.retainedUnpublished === 1 ? 'file remains' : 'files remain'} in the selected output directory.\n`);
      }
    } catch {
      write(stderr, 'Output cleanup warning: Temporary output cleanup could not be verified.\n');
    }
  }
}

export { HELP, MAX_STDIN_BYTES, VERSION, readStdinBounded, runCli };
export type { CliDependencies, WritableLike };
