import { REGISTRY_CAPABILITIES_VERSION, registryCapabilityFor } from '../lib/registry-capabilities.mts';
import { buildRiskCalibrationSummaryReport } from '../lib/risk-calibration-summary.mts';
import { explainRiskScore, explainRiskScoreV6, RISK_MODEL_VERSION, RISK_REVIEW_THRESHOLD } from '../lib/risk-scoring.mts';
import type { CliArguments } from './arguments.mts';
import { buildCliCommandCatalogue, formatCliCommandCatalogue, selectCliCommands } from './command-catalogue.mts';
import {
  CLI_COMMAND_REGISTRY,
  CLI_COMMANDS,
  COMMAND_COLLECTION,
  COMMAND_DETAILS,
  COMMAND_USAGE,
} from './command-reference.mts';
import { buildShellCompletion } from './completion.mts';
import { buildDoctorReport, formatDoctorReport } from './doctor.mts';
import { boundedCliErrorMessage, CliUsageError } from './errors.mts';
import EXIT_CODES from './exit-codes.mts';
import { formatJsonDocument } from './formatters/json.mts';
import {
  formatTerminalRegistrySupport,
  formatTerminalRiskCalibration,
} from './formatters/terminal.mts';
import { buildCliManual } from './manual.mts';
import {
  MAX_LOOKALIKE_CALIBRATION_BYTES,
  buildLookalikeCalibration,
  formatLookalikeCalibration,
} from './lookalike-calibration.mts';
import {
  MAX_REGISTRY_COHORT_INPUT_BYTES,
  buildRegistryCohortReport,
  formatRegistryCohortReport,
} from './registry-cohort.mts';
import { buildRegistryDoctorReport, formatRegistryDoctorReport } from './registry-doctor.mts';
import { buildRegistryFixtureScaffold } from './registry-fixture-scaffold.mts';
import { buildRegistrySupportDocument } from './registry-support.mts';
import {
  MAX_RISK_CALIBRATION_INPUT_BYTES,
  buildRiskCalibrationReport,
  parseRiskCalibrationDataset,
  serializeRiskCalibrationReport,
} from './risk-calibration.mts';
import type { CliCommandContext, CliDependencies } from './runner-types.mts';
import { MAX_SAVED_LOOKUP_INPUT_BYTES } from './saved-lookup.mts';
import { SUPPORT_INLINE_COMMANDS } from './inline-command-families.mts';

type SupportInlineCommand = typeof SUPPORT_INLINE_COMMANDS[number];
type SupportCommandArguments = Extract<CliArguments, { action: SupportInlineCommand }>;

async function runSupportCommand(
  args: SupportCommandArguments,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  if (args.action === 'completion') {
    context.writeStdout(buildShellCompletion(args.shell));
    return EXIT_CODES.SUCCESS;
  }

  if (args.action === 'commands') {
    const selectedCommands = selectCliCommands(CLI_COMMAND_REGISTRY, {
      common: args.common,
      group: args.group,
      mode: args.mode,
    });
    const catalogue = buildCliCommandCatalogue({
      commands: selectedCommands,
      collections: COMMAND_COLLECTION,
      details: COMMAND_DETAILS,
      usage: COMMAND_USAGE,
      packageVersion: context.packageVersion,
    });
    if (!args.quiet) {
      context.writeStdout(args.output === 'json'
        ? formatJsonDocument(catalogue)
        : context.terminal(formatCliCommandCatalogue(catalogue), args.color));
    }
    return EXIT_CODES.SUCCESS;
  }

  if (args.action === 'manual') {
    context.writeStdout(buildCliManual({
      commands: CLI_COMMANDS,
      collections: COMMAND_COLLECTION,
      details: COMMAND_DETAILS,
      usage: COMMAND_USAGE,
      version: context.packageVersion,
    }));
    return EXIT_CODES.SUCCESS;
  }

  if (args.action === 'doctor') {
    context.setFailureLabel('CLI diagnostics');
    const buildReport = () => buildDoctorReport({
      version: context.packageVersion,
      generatedAt: context.now(),
      network: args.network,
      presentation: context.presentation(args.color),
      ...(dependencies.resolvePublicAddresses ? { resolveAddresses: dependencies.resolvePublicAddresses } : {}),
      ...(dependencies.safeFetch ? { fetchHttps: dependencies.safeFetch } : {}),
      ...(dependencies.whoisQuery ? { queryWhois: dependencies.whoisQuery } : {}),
    });
    const report = args.network
      ? await context.withProgress('Checking public DNS, HTTPS, and WHOIS connectivity', buildReport)
      : await buildReport();
    if (!args.quiet) {
      context.writeStdout(args.output === 'json'
        ? formatJsonDocument(report)
        : context.terminal(formatDoctorReport(report), args.color));
    }
    return report.state === 'partial' ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
  }

  if (args.action === 'registry-support') {
    context.setFailureLabel('Registry support');
    const requestedInput = args.target || await context.readSingleInput();
    if (!requestedInput) throw new CliUsageError('registry-support requires one domain or suffix as an argument or on stdin.');
    const lookupCapability = dependencies.registryCapabilityFor || registryCapabilityFor;
    const capability = lookupCapability(requestedInput);
    if (!capability) throw new CliUsageError('registry-support requires a valid domain or suffix.');
    const catalogueVersion = dependencies.registryCapabilitiesVersion || REGISTRY_CAPABILITIES_VERSION;
    const document = buildRegistrySupportDocument(requestedInput, capability, catalogueVersion, context.now());
    if (!args.quiet) {
      context.writeStdout(args.output === 'json'
        ? formatJsonDocument(document)
        : context.terminal(formatTerminalRegistrySupport(document), args.color));
    }
    return EXIT_CODES.SUCCESS;
  }

  if (args.action === 'registry-doctor') {
    context.setFailureLabel('Registry compatibility diagnostic');
    let input: string;
    try {
      input = dependencies.readCompareInput
        ? await dependencies.readCompareInput(args.source)
        : await context.readInput(args.source, MAX_SAVED_LOOKUP_INPUT_BYTES, 'Registry doctor input');
    } catch (error) {
      if (error instanceof CliUsageError) throw error;
      throw new CliUsageError(`Could not read registry doctor input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
    }
    if (!input.trim()) throw new CliUsageError('registry-doctor requires one saved Lookup JSON file or a document on stdin.');
    const report = buildRegistryDoctorReport(input, context.now());
    if (!args.quiet) {
      context.writeStdout(args.output === 'json'
        ? formatJsonDocument(report)
        : context.terminal(formatRegistryDoctorReport(report), args.color));
    }
    return report.summary.investigate ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
  }

  if (args.action === 'registry-cohort') {
    context.setFailureLabel('Registry quality cohort');
    let input: string;
    try {
      input = dependencies.readCompareInput
        ? await dependencies.readCompareInput(args.source)
        : await context.readInput(args.source, MAX_REGISTRY_COHORT_INPUT_BYTES, 'Registry cohort input');
    } catch (error) {
      if (error instanceof CliUsageError) throw error;
      throw new CliUsageError(`Could not read registry cohort input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
    }
    const report = buildRegistryCohortReport(input, context.now());
    if (!args.quiet) {
      context.writeStdout(args.output === 'json'
        ? formatJsonDocument(report)
        : context.terminal(formatRegistryCohortReport(report), args.color));
    }
    return report.cohorts.some((cohort) => cohort.state === 'review')
      ? EXIT_CODES.PARTIAL_FAILURE
      : EXIT_CODES.SUCCESS;
  }

  if (args.action === 'registry-scaffold') {
    context.setFailureLabel('Registry fixture scaffold');
    try {
      context.writeStdout(buildRegistryFixtureScaffold(args.profile, args.suffix, args.scenario));
    } catch (error) {
      throw new CliUsageError(boundedCliErrorMessage(error, 'Registry fixture scaffold failed'));
    }
    return EXIT_CODES.SUCCESS;
  }

  if (args.action === 'risk-calibrate') {
    context.setFailureLabel('Risk calibration');
    let input: string;
    try {
      input = dependencies.readRiskCalibrationInput
        ? await dependencies.readRiskCalibrationInput(args.source)
        : await context.readInput(args.source, MAX_RISK_CALIBRATION_INPUT_BYTES, 'Risk calibration input');
    } catch (error) {
      if (error instanceof CliUsageError) throw error;
      throw new CliUsageError(`Could not read Risk calibration input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
    }
    if (!input.trim()) throw new CliUsageError('risk-calibrate requires one dataset JSON file or a dataset on stdin.');
    const dataset = parseRiskCalibrationDataset(input);
    const report = buildRiskCalibrationReport(dataset, dependencies.explainRiskScore || explainRiskScore, {
      generatedAt: context.now(),
      modelVersion: dependencies.riskModelVersion || RISK_MODEL_VERSION,
      reviewThreshold: dependencies.riskReviewThreshold || RISK_REVIEW_THRESHOLD,
      ...(!dependencies.explainRiskScore ? {
        previousModelVersion: 6,
        explainPreviousRiskScore: explainRiskScoreV6,
      } : {}),
    });
    if (!args.quiet) {
      context.writeStdout(args.output === 'summary_json'
        ? serializeRiskCalibrationReport(buildRiskCalibrationSummaryReport(report))
        : args.output === 'json'
          ? serializeRiskCalibrationReport(report)
          : context.terminal(formatTerminalRiskCalibration(report), args.color));
    }
    return EXIT_CODES.SUCCESS;
  }

  if (args.action === 'lookalike-calibrate') {
    context.setFailureLabel('Lookalike review-yield calibration');
    let input: string;
    try {
      input = dependencies.readRiskCalibrationInput
        ? await dependencies.readRiskCalibrationInput(args.source)
        : await context.readInput(args.source, MAX_LOOKALIKE_CALIBRATION_BYTES, 'Lookalike calibration input');
    } catch (error) {
      if (error instanceof CliUsageError) throw error;
      throw new CliUsageError(`Could not read lookalike calibration input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
    }
    if (!input.trim()) throw new CliUsageError('lookalike-calibrate requires one dataset JSON file or a document on stdin.');
    let report;
    try {
      report = buildLookalikeCalibration(input, context.now());
    } catch (error) {
      throw new CliUsageError(boundedCliErrorMessage(error, 'Lookalike calibration input is invalid'));
    }
    if (!args.quiet) {
      context.writeStdout(args.output === 'json'
        ? formatJsonDocument(report)
        : context.terminal(formatLookalikeCalibration(report), args.color));
    }
    return EXIT_CODES.SUCCESS;
  }

  throw new Error('Support command routing is inconsistent.');
}

export { runSupportCommand };
