import type { CliArguments } from './arguments.mts';
import {
  MAX_OFFLINE_ARTIFACT_BYTES,
  formatOfflineArtifactVerification,
  isCompleteOfflineArtifactVerification,
  verifyOfflineArtifact,
} from './artifact-verify.mts';
import { MAX_CASE_PACK_INPUT_BYTES, buildCliCasePack, formatCliCasePack } from './case-pack.mts';
import {
  MAX_COMPARE_INPUT_BYTES,
  compareLookupDocument,
  parseCliLookupDocument,
} from './compare.mts';
import { boundedCliErrorMessage, CliUsageError } from './errors.mts';
import EXIT_CODES from './exit-codes.mts';
import {
  MAX_OFFLINE_EVIDENCE_INPUT_BYTES,
  buildOfflineEvidenceReview,
  buildOfflineEvidenceReviewWithLocalResources,
  formatOfflineEvidenceReview,
} from './offline-evidence-review.mts';
import { buildCliLookupBrief, formatCliLookupBrief } from './lookup-brief.mts';
import {
  MAX_MAIL_REVIEW_INPUT_BYTES,
  buildCliMailReview,
  formatCliMailReview,
} from './mail-review.mts';
import { buildCliPageComparison, formatCliPageComparison } from './page-compare.mts';
import {
  MAX_SOURCE_RELIABILITY_INPUT_BYTES,
  buildSourceReliabilityReport,
  formatSourceReliabilityReport,
} from './source-reliability.mts';
import {
  buildInterchangeFidelityReport,
  formatInterchangeFidelityReport,
} from './interchange-report.mts';
import {
  buildCliCompareDocument,
  formatJsonDocument,
} from './formatters/json.mts';
import { formatTerminalCompare } from './formatters/terminal.mts';
import type { CliCommandContext, CliDependencies } from './runner-types.mts';
import { MAX_SAVED_LOOKUP_INPUT_BYTES } from './saved-lookup.mts';
import { REVIEW_INLINE_COMMANDS } from './inline-command-families.mts';

import { runDiscriminatedCommandHandler, type DiscriminatedCommandHandlerMap } from './discriminated-command-handlers.mts';
type ReviewInlineCommand = typeof REVIEW_INLINE_COMMANDS[number];
type ReviewCommandArguments = Extract<CliArguments, { action: ReviewInlineCommand }>;

async function runVerifyArtifactCommand(
  args: Extract<ReviewCommandArguments, { action: 'verify-artifact' }>,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Artefact verification');
  let input: string;
  try {
    input = dependencies.readArtifactInput
      ? await dependencies.readArtifactInput(args.source)
      : await context.readInput(args.source, MAX_OFFLINE_ARTIFACT_BYTES, 'Artefact input');
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(`Could not read artifact input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
  }
  if (!input.trim()) throw new CliUsageError('verify-artifact requires one JSON file or an artefact on stdin.');

  const passphrase = args.passphraseSource ? await context.readPassphraseSource(args.passphraseSource) : null;
  let manifest: Readonly<{ raw: string; entryId: string }> | null = null;
  if (args.manifestSource && args.manifestEntryId) {
    let raw: string;
    try {
      raw = dependencies.readArtifactInput
        ? await dependencies.readArtifactInput(args.manifestSource)
        : await context.readInput(args.manifestSource, MAX_OFFLINE_ARTIFACT_BYTES, 'Investigation manifest input');
    } catch (error) {
      if (error instanceof CliUsageError) throw error;
      throw new CliUsageError(`Could not read investigation manifest input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
    }
    if (!raw.trim()) throw new CliUsageError('The investigation manifest input is empty.');
    manifest = Object.freeze({ raw, entryId: args.manifestEntryId });
  }

  const report = await verifyOfflineArtifact(input, { passphrase, manifest });
  if (!args.quiet) {
    context.writeStdout(args.output === 'json'
      ? formatJsonDocument(report)
      : context.terminal(formatOfflineArtifactVerification(report), args.color));
  }
  return args.strictExit && !isCompleteOfflineArtifactVerification(report)
    ? EXIT_CODES.PARTIAL_FAILURE
    : EXIT_CODES.SUCCESS;
}

async function runInterchangeReportCommand(
  args: Extract<ReviewCommandArguments, { action: 'interchange-report' }>,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Interchange fidelity report');
  let input: string;
  try {
    input = dependencies.readArtifactInput
      ? await dependencies.readArtifactInput(args.source)
      : await context.readInput(args.source, MAX_OFFLINE_ARTIFACT_BYTES, 'Interchange input');
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(`Could not read interchange input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
  }
  if (!input.trim()) throw new CliUsageError('interchange-report requires one JSON file or an artefact on stdin.');
  const passphrase = args.passphraseSource ? await context.readPassphraseSource(args.passphraseSource) : null;
  const report = await buildInterchangeFidelityReport(input, {
    generatedAt: context.now(),
    passphrase,
  });
  if (!args.quiet) {
    context.writeStdout(args.output === 'json'
      ? formatJsonDocument(report)
      : context.terminal(formatInterchangeFidelityReport(report), args.color));
  }
  return EXIT_CODES.SUCCESS;
}

async function runSourceReportCommand(
  args: Extract<ReviewCommandArguments, { action: 'source-report' }>,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Source reliability report');
  let input: string;
  try {
    input = dependencies.readSourceReliabilityInput
      ? await dependencies.readSourceReliabilityInput(args.source)
      : await context.readInput(args.source, MAX_SOURCE_RELIABILITY_INPUT_BYTES, 'Source reliability input');
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(`Could not read source reliability input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
  }
  if (!input.trim()) throw new CliUsageError('source-report requires one JSON file or lookup documents on stdin.');
  const report = buildSourceReliabilityReport(input, context.now());
  if (!args.quiet) {
    context.writeStdout(args.output === 'json'
      ? formatJsonDocument(report)
      : context.terminal(formatSourceReliabilityReport(report), args.color));
  }
  return EXIT_CODES.SUCCESS;
}

async function runCompareCommand(
  args: Extract<ReviewCommandArguments, { action: 'compare' }>,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Registry comparison');
  let input: string;
  try {
    input = dependencies.readCompareInput
      ? await dependencies.readCompareInput(args.source)
      : await context.readInput(args.source, MAX_COMPARE_INPUT_BYTES, 'Comparison input');
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
  const document = buildCliCompareDocument(result, context.now());
  if (!args.quiet) {
    context.writeStdout(args.output === 'json'
      ? formatJsonDocument(document)
      : context.terminal(formatTerminalCompare(document), args.color));
  }
  return EXIT_CODES.SUCCESS;
}

async function runPageCompareCommand(
  args: Extract<ReviewCommandArguments, { action: 'page-compare' }>,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Static page comparison');
  const readDiffInput = dependencies.readDiffInput
    || ((source: string) => context.readInput(source, MAX_SAVED_LOOKUP_INPUT_BYTES, 'Page comparison input'));
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
  const document = buildCliPageComparison(leftInput, rightInput, context.now());
  if (!args.quiet) {
    context.writeStdout(args.output === 'json'
      ? formatJsonDocument(document)
      : context.terminal(formatCliPageComparison(document), args.color));
  }
  return EXIT_CODES.SUCCESS;
}

async function runMailReviewCommand(
  args: Extract<ReviewCommandArguments, { action: 'mail-review' }>,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Passive mail review');
  let input: string;
  try {
    input = dependencies.readMailReviewInput
      ? await dependencies.readMailReviewInput(args.source)
      : await context.readInput(args.source, MAX_MAIL_REVIEW_INPUT_BYTES, 'Mail review input');
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(`Could not read mail review input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
  }
  const document = buildCliMailReview(input, context.now());
  if (!args.quiet) {
    context.writeStdout(args.output === 'json'
      ? formatJsonDocument(document)
      : context.terminal(formatCliMailReview(document), args.color));
  }
  return EXIT_CODES.SUCCESS;
}

async function runOfflineEvidenceReviewCommand(
  args: Extract<ReviewCommandArguments, { action: 'review-evidence' }>,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Offline evidence review');
  let input: string;
  try {
    input = dependencies.readArtifactInput
      ? await dependencies.readArtifactInput(args.source)
      : await context.readInput(args.source, MAX_OFFLINE_EVIDENCE_INPUT_BYTES, 'Offline evidence input');
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(`Could not read offline evidence input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
  }
  if (!input.trim()) throw new CliUsageError('review-evidence requires one JSON file or a document on stdin.');
  const document = args.mmdbSource
    ? await buildOfflineEvidenceReviewWithLocalResources(input, context.now(), { mmdbPath: args.mmdbSource })
    : buildOfflineEvidenceReview(input, context.now());
  if (!args.quiet) {
    context.writeStdout(args.output === 'json'
      ? formatJsonDocument(document)
      : context.terminal(formatOfflineEvidenceReview(document), args.color));
  }
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

async function runBriefOrCasePackCommand(
  args: Extract<ReviewCommandArguments, { action: 'brief' | 'case-pack' }>,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  const isBrief = args.action === 'brief';
  context.setFailureLabel(isBrief ? 'Lookup brief' : 'Case pack');
  let input: string;
  try {
    input = dependencies.readArtifactInput
      ? await dependencies.readArtifactInput(args.source)
      : await context.readInput(
        args.source,
        isBrief ? MAX_SAVED_LOOKUP_INPUT_BYTES : MAX_CASE_PACK_INPUT_BYTES,
        isBrief ? 'Lookup brief input' : 'Case-pack input',
      );
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(`Could not read ${isBrief ? 'Lookup brief' : 'case-pack'} input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
  }
  if (!input.trim()) throw new CliUsageError(`${args.action} requires one JSON file or a document on stdin.`);
  if (args.action === 'brief') {
    const document = buildCliLookupBrief(input, context.now());
    if (!args.quiet) {
      context.writeStdout(args.output === 'json'
        ? formatJsonDocument(document)
        : context.terminal(formatCliLookupBrief(document), args.color));
    }
  } else {
    const document = buildCliCasePack(input, { audience: args.audience, reviewed: args.reviewed }, context.now());
    if (!args.quiet) {
      context.writeStdout(args.output === 'json'
        ? formatJsonDocument(document)
        : context.terminal(formatCliCasePack(document), args.color));
    }
  }
  return EXIT_CODES.SUCCESS;
}

const REVIEW_COMMAND_HANDLERS = Object.freeze({
  'verify-artifact': runVerifyArtifactCommand,
  'interchange-report': runInterchangeReportCommand,
  'source-report': runSourceReportCommand,
  'compare': runCompareCommand,
  'page-compare': runPageCompareCommand,
  'mail-review': runMailReviewCommand,
  'review-evidence': runOfflineEvidenceReviewCommand,
  'brief': runBriefOrCasePackCommand,
  'case-pack': runBriefOrCasePackCommand,
} satisfies DiscriminatedCommandHandlerMap<
  ReviewCommandArguments,
  [CliDependencies, CliCommandContext],
  number
>);

function runReviewCommand(
  args: ReviewCommandArguments,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  return runDiscriminatedCommandHandler(REVIEW_COMMAND_HANDLERS, args, dependencies, context);
}

export { REVIEW_COMMAND_HANDLERS, runReviewCommand };
