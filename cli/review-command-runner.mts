import type { CliArguments } from './arguments.mts';
import { runIntakeCommand } from './intake-command.mts';
import { runIndicatorSetCommand } from './indicator-set-command.mts';
import { CONTEXT_REVIEW_KINDS } from '../packages/contracts/context-review.mts';
import { readBoundedRegularFile } from '../lib/bounded-file.mts';
import { MAX_ENCRYPTED_INVESTIGATION_PACKAGE_BYTES } from '../packages/contracts/investigation-package-limits.mts';
import { verifyOfflineInvestigationFolder, verifyOfflineInvestigationPackage } from './investigation-package-review.mts';
import { readInvestigationFolder } from './investigation-folder.mts';
import { readBagItFolder } from './bagit-folder.mts';
import { verifyOfflineBagIt } from './bagit-review.mts';
import { MAX_BAGIT_ZIP_BYTES } from '../packages/interchange/bagit.mts';
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
import { LOCAL_MMDB_REVIEW_SCHEMA, LOCAL_MMDB_REVIEW_VERSION } from './local-mmdb-review.mts';
import EXIT_CODES from './exit-codes.mts';
import {
  MAX_OFFLINE_EVIDENCE_INPUT_BYTES,
  buildOfflineEvidenceReview,
  buildOfflineEvidenceReviewWithLocalResources,
  formatOfflineEvidenceReview,
} from './offline-evidence-review.mts';
import { buildCliLookupBrief, formatCliLookupBrief } from './lookup-brief.mts';
import { runCaseCommand } from './case-command.mts';
import {
  MAX_MAIL_REVIEW_INPUT_BYTES,
  buildCliMailReview,
  formatCliMailReview,
} from './mail-review.mts';
import {
  MAX_MAIL_HEADER_INPUT_BYTES,
  buildCliMailHeaderReview,
  formatCliMailHeaderReview,
} from './mail-header-review.mts';
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
import type { CliCommandContext } from './runner-types.mts';
import type { CaseCommandDependencies } from './case-command.mts';
import type { IntakeCommandDependencies } from './intake-command.mts';
import type { IndicatorSetCommandDependencies } from './indicator-set-command.mts';
import { MAX_SAVED_LOOKUP_INPUT_BYTES } from './saved-lookup.mts';
import { REVIEW_INLINE_COMMANDS } from './inline-command-families.mts';

import { runDiscriminatedCommandHandler, type DiscriminatedCommandHandlerMap } from './discriminated-command-handlers.mts';

export type ReviewCommandDependencies = CaseCommandDependencies & IntakeCommandDependencies & IndicatorSetCommandDependencies & {
  readArtifactInput?: (source?: string | null) => string | Promise<string>;
  readBinaryArtifactInput?: (source: string) => Uint8Array | Promise<Uint8Array>;
  readSourceReliabilityInput?: (source?: string | null) => string | Promise<string>;
  readCompareInput?: (source?: string | null) => string | Promise<string>;
  loadRegistryComparison?: () => Promise<typeof import('../lib/registry-comparison.mts')>;
  readDiffInput?: (source: string) => string | Promise<string>;
  readMailReviewInput?: (source?: string | null) => string | Promise<string>;
  readMailHeaderInput?: (source?: string | null) => string | Promise<string>;
};

type ReviewInlineCommand = typeof REVIEW_INLINE_COMMANDS[number];
type ReviewCommandArguments = Extract<CliArguments, { action: ReviewInlineCommand }>;

/** Readers retain their command-specific bounds and injection points. Only
 * usage-error presentation and empty-input handling are shared. */
async function readReviewInput(
  read: () => Promise<string>,
  label: string,
  emptyMessage?: string,
): Promise<string> {
  let input: string;
  try { input = await read(); }
  catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(`Could not read ${label}: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
  }
  if (emptyMessage && !input.trim()) throw new CliUsageError(emptyMessage);
  return input;
}

function writeReviewReport<T>(
  context: CliCommandContext,
  args: Readonly<{ quiet: boolean; output: string; color: boolean }>,
  report: T,
  format: (report: T) => string,
): void {
  if (!args.quiet) context.writeStdout(args.output === 'json'
    ? formatJsonDocument(report)
    : context.terminal(format(report), args.color));
}

async function runVerifyArtifactCommand(
  args: Extract<ReviewCommandArguments, { action: 'verify-artifact' }>,
  dependencies: ReviewCommandDependencies,
  context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Artefact verification');
  if (args.folder) {
    let files: Map<string, Uint8Array>;
    try { files = await (args.bagit ? readBagItFolder : readInvestigationFolder)(args.folder, dependencies.signal); }
    catch (cause) {
      dependencies.signal?.throwIfAborted();
      const reason = cause instanceof TypeError ? boundedCliErrorMessage(cause) : 'The selected folder is unavailable or could not be read.';
      throw new CliUsageError(`Could not read evidence folder: ${reason}`);
    }
    const report = await (args.bagit ? verifyOfflineBagIt : verifyOfflineInvestigationFolder)(files);
    dependencies.signal?.throwIfAborted();
    writeReviewReport(context, args, report, formatOfflineArtifactVerification);
    return args.strictExit && !isCompleteOfflineArtifactVerification(report) ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
  }
  if (args.package) {
    if (!args.source || args.source === '-') throw new CliUsageError('--package requires a selected ZIP file; binary stdin is not accepted.');
    let bytes: Uint8Array;
    try {
      bytes = dependencies.readBinaryArtifactInput ? await dependencies.readBinaryArtifactInput(args.source)
        : await readBoundedRegularFile(args.source, { maximumBytes: args.bagit ? MAX_BAGIT_ZIP_BYTES : MAX_ENCRYPTED_INVESTIGATION_PACKAGE_BYTES, minimumBytes: 22, label: 'Investigation package', ...(dependencies.signal ? { signal: dependencies.signal } : {}) });
    } catch (error) {
      if (error instanceof CliUsageError) throw error;
      throw new CliUsageError(`Could not read package input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
    }
    const passphrase = args.passphraseSource ? await context.readPassphraseSource(args.passphraseSource) : undefined;
    const report = args.bagit ? await verifyOfflineBagIt(bytes) : await verifyOfflineInvestigationPackage(bytes, passphrase);
    dependencies.signal?.throwIfAborted();
    writeReviewReport(context, args, report, formatOfflineArtifactVerification);
    return args.strictExit && !isCompleteOfflineArtifactVerification(report) ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
  }
  const input = await readReviewInput(
    async () => dependencies.readArtifactInput
      ? await dependencies.readArtifactInput(args.source)
      : await context.readInput(args.source, MAX_OFFLINE_ARTIFACT_BYTES, 'Artefact input'),
    'artifact input',
    'verify-artifact requires one JSON file or an artefact on stdin.',
  );

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
  writeReviewReport(context, args, report, formatOfflineArtifactVerification);
  return args.strictExit && !isCompleteOfflineArtifactVerification(report)
    ? EXIT_CODES.PARTIAL_FAILURE
    : EXIT_CODES.SUCCESS;
}

async function runInterchangeReportCommand(
  args: Extract<ReviewCommandArguments, { action: 'interchange-report' }>,
  dependencies: ReviewCommandDependencies,
  context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Interchange fidelity report');
  const input = await readReviewInput(
    async () => dependencies.readArtifactInput
      ? await dependencies.readArtifactInput(args.source)
      : await context.readInput(args.source, MAX_OFFLINE_ARTIFACT_BYTES, 'Interchange input'),
    'interchange input',
    'interchange-report requires one JSON file or an artefact on stdin.',
  );
  const passphrase = args.passphraseSource ? await context.readPassphraseSource(args.passphraseSource) : null;
  const report = await buildInterchangeFidelityReport(input, {
    generatedAt: context.now(),
    passphrase,
  });
  writeReviewReport(context, args, report, formatInterchangeFidelityReport);
  return EXIT_CODES.SUCCESS;
}

async function runSourceReportCommand(
  args: Extract<ReviewCommandArguments, { action: 'source-report' }>,
  dependencies: ReviewCommandDependencies,
  context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Source reliability report');
  const input = await readReviewInput(
    async () => dependencies.readSourceReliabilityInput
      ? await dependencies.readSourceReliabilityInput(args.source)
      : await context.readInput(args.source, MAX_SOURCE_RELIABILITY_INPUT_BYTES, 'Source reliability input'),
    'source reliability input',
    'source-report requires one JSON file or lookup documents on stdin.',
  );
  const report = buildSourceReliabilityReport(input, context.now());
  writeReviewReport(context, args, report, formatSourceReliabilityReport);
  return EXIT_CODES.SUCCESS;
}

async function runCompareCommand(
  args: Extract<ReviewCommandArguments, { action: 'compare' }>,
  dependencies: ReviewCommandDependencies,
  context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Registry comparison');
  const input = await readReviewInput(
    async () => dependencies.readCompareInput
      ? await dependencies.readCompareInput(args.source)
      : await context.readInput(args.source, MAX_COMPARE_INPUT_BYTES, 'Comparison input'),
    'comparison input',
    'compare requires one lookup JSON file or a lookup document on stdin.',
  );
  const parsed = parseCliLookupDocument(input);
  const loadComparison = dependencies.loadRegistryComparison || (() => import('../lib/registry-comparison.mts'));
  const comparisonModule = await loadComparison();
  const result = compareLookupDocument(
    parsed,
    comparisonModule.compareRegistrySources,
    comparisonModule.compareRdapPublications,
  );
  const document = buildCliCompareDocument(result, context.now());
  writeReviewReport(context, args, document, formatTerminalCompare);
  return EXIT_CODES.SUCCESS;
}

async function runPageCompareCommand(
  args: Extract<ReviewCommandArguments, { action: 'page-compare' }>,
  dependencies: ReviewCommandDependencies,
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
  writeReviewReport(context, args, document, formatCliPageComparison);
  return EXIT_CODES.SUCCESS;
}

async function runMailReviewCommand(
  args: Extract<ReviewCommandArguments, { action: 'mail-review' }>,
  dependencies: ReviewCommandDependencies,
  context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Passive mail review');
  const input = await readReviewInput(
    async () => dependencies.readMailReviewInput
      ? await dependencies.readMailReviewInput(args.source)
      : await context.readInput(args.source, MAX_MAIL_REVIEW_INPUT_BYTES, 'Mail review input'),
    'mail review input',
  );
  const document = buildCliMailReview(input, context.now());
  writeReviewReport(context, args, document, formatCliMailReview);
  return EXIT_CODES.SUCCESS;
}

async function runMailHeadersCommand(
  args: Extract<ReviewCommandArguments, { action: 'mail-headers' }>,
  dependencies: ReviewCommandDependencies,
  context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Mail-header review');
  const input = await readReviewInput(
    async () => dependencies.readMailHeaderInput
      ? await dependencies.readMailHeaderInput(args.source)
      : await context.readHeaderInput(args.source, MAX_MAIL_HEADER_INPUT_BYTES, 'Mail-header input'),
    'mail-header input',
    'mail-headers requires one message or header file, or headers on stdin.',
  );
  const document = buildCliMailHeaderReview(input, context.now(), args.trustedAuthHeaders);
  writeReviewReport(context, args, document, formatCliMailHeaderReview);
  return EXIT_CODES.SUCCESS;
}

async function runOfflineEvidenceReviewCommand(
  args: Extract<ReviewCommandArguments, { action: 'review-evidence' }>,
  dependencies: ReviewCommandDependencies,
  context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Offline evidence review');
  const input = await readReviewInput(
    async () => dependencies.readArtifactInput
      ? await dependencies.readArtifactInput(args.source)
      : await context.readInput(args.source, MAX_OFFLINE_EVIDENCE_INPUT_BYTES, 'Offline evidence input'),
    'offline evidence input',
    'review-evidence requires one JSON file or a document on stdin.',
  );
  const document = args.mmdbSource
    ? await buildOfflineEvidenceReviewWithLocalResources(input, context.now(), { mmdbPath: args.mmdbSource, ...(dependencies.signal ? { signal: dependencies.signal } : {}) })
    : buildOfflineEvidenceReview(input, context.now());
  dependencies.signal?.throwIfAborted();
  writeReviewReport(context, args, document, formatOfflineEvidenceReview);
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
    const contextPartial = ((CONTEXT_REVIEW_KINDS as readonly string[]).includes(document.kind) || document.kind === 'internal_containment') && result.state === 'partial';
    const mmdbIncomplete = result.schema === LOCAL_MMDB_REVIEW_SCHEMA && result.version === LOCAL_MMDB_REVIEW_VERSION && result.completeness !== 'complete';
    const infrastructureIncomplete = document.kind === 'infrastructure' ? result.state !== 'complete'
      : document.kind === 'infrastructure_comparison' && result.state !== 'compared';
    if (gate?.pass === false || zoneMismatch || contextPartial || mmdbIncomplete || infrastructureIncomplete) return EXIT_CODES.PARTIAL_FAILURE;
  }
  return EXIT_CODES.SUCCESS;
}

async function runBriefOrCasePackCommand(
  args: Extract<ReviewCommandArguments, { action: 'brief' | 'case-pack' }>,
  dependencies: ReviewCommandDependencies,
  context: CliCommandContext,
): Promise<number> {
  const isBrief = args.action === 'brief';
  context.setFailureLabel(isBrief ? 'Lookup brief' : 'Case pack');
  const input = await readReviewInput(
    async () => dependencies.readArtifactInput
      ? await dependencies.readArtifactInput(args.source)
      : await context.readInput(
        args.source,
        isBrief ? MAX_SAVED_LOOKUP_INPUT_BYTES : MAX_CASE_PACK_INPUT_BYTES,
        isBrief ? 'Lookup brief input' : 'Case-pack input',
      ),
    `${isBrief ? 'Lookup brief' : 'case-pack'} input`,
    `${args.action} requires one JSON file or a document on stdin.`,
  );
  if (args.action === 'brief') {
    const document = buildCliLookupBrief(input, context.now());
    writeReviewReport(context, args, document, formatCliLookupBrief);
  } else {
    const document = buildCliCasePack(input, { audience: args.audience, reviewed: args.reviewed }, context.now());
    writeReviewReport(context, args, document, formatCliCasePack);
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
  'mail-headers': runMailHeadersCommand,
  intake: runIntakeCommand,
  'review-evidence': runOfflineEvidenceReviewCommand,
  'brief': runBriefOrCasePackCommand,
  'case': runCaseCommand,
  'case-pack': runBriefOrCasePackCommand,
  'indicator-set': runIndicatorSetCommand,
} satisfies DiscriminatedCommandHandlerMap<
  ReviewCommandArguments,
  [ReviewCommandDependencies, CliCommandContext],
  number
>);

function runReviewCommand(
  args: ReviewCommandArguments,
  dependencies: ReviewCommandDependencies,
  context: CliCommandContext,
): Promise<number> {
  return runDiscriminatedCommandHandler(REVIEW_COMMAND_HANDLERS, args, dependencies, context);
}

export { REVIEW_COMMAND_HANDLERS, runReviewCommand };
