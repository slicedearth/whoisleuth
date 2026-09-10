import type { CliArguments } from './arguments.mts';
import { formatCliJunit } from './ci-report.mts';
import { formatDomainControlMonitor, runDomainControlMonitor } from './domain-control-monitor.mts';
import { boundedCliErrorMessage, createCliDiagnosticOutput, CliUsageError } from './errors.mts';
import EXIT_CODES from './exit-codes.mts';
import { evaluateCliFailPolicies, formatFailPolicyNotice } from './fail-policy.mts';
import { formatJsonDocument } from './formatters/json.mts';
import {
  buildInvestigationPlan,
  buildWorkflowRecipeCatalogue,
  formatInvestigationPlan,
  formatWorkflowRecipeCatalogue,
} from './investigation-plan.mts';
import {
  MAX_INVESTIGATION_RUN_BYTES,
  formatInvestigationRun,
  investigationRunExitCode,
  runInvestigationRecipe,
} from './investigation-run.mts';
import { MAX_OFFLINE_EVIDENCE_INPUT_BYTES } from './offline-evidence-review.mts';
import { MAX_OFFLINE_ARTIFACT_BYTES } from './artifact-verify.mts';
import { MAX_RETAINED_ARTIFACT_DIFF_BYTES } from './retained-artifact-diff.mts';
import { MAX_SAVED_LOOKUP_INPUT_BYTES } from './saved-lookup.mts';
import type { WorkflowStepInputs } from './investigation-artifacts.mts';
import type { CliCommand } from './command-reference.mts';
import { createBufferedOutput } from './output-file.mts';
import type { CliCommandContext, CliDependencies } from './runner-types.mts';
import { WORKFLOW_INLINE_COMMANDS } from './inline-command-families.mts';
import { runDiscriminatedCommandHandler, type DiscriminatedCommandHandlerMap } from './discriminated-command-handlers.mts';

type WorkflowInlineCommand = typeof WORKFLOW_INLINE_COMMANDS[number];
type WorkflowCommandArguments = Extract<CliArguments, { action: WorkflowInlineCommand }>;

function boundWorkflowInputs(command: CliCommand, inputs: WorkflowStepInputs, dependencies: CliDependencies, context: CliCommandContext): Partial<CliDependencies> {
  if (!inputs.size) return {};
  const read = (source: string | null | undefined, fallback: (() => string | Promise<string>)) =>
    typeof source === 'string' && inputs.has(source) ? inputs.get(source)! : fallback();
  switch (command) {
    case 'export': return { readExportInput: (source) => read(source, () => dependencies.readExportInput
      ? dependencies.readExportInput(source) : context.readInput(source, MAX_SAVED_LOOKUP_INPUT_BYTES, 'Evidence export input')) };
    case 'verify-artifact': return { readArtifactInput: (source) => read(source, () => dependencies.readArtifactInput
      ? dependencies.readArtifactInput(source) : context.readInput(source, MAX_OFFLINE_ARTIFACT_BYTES, 'Artefact input')) };
    case 'diff':
    case 'timeline': return { readDiffInput: (source) => read(source, () => dependencies.readDiffInput
      ? dependencies.readDiffInput(source) : context.readInput(source,
        command === 'diff' ? MAX_RETAINED_ARTIFACT_DIFF_BYTES : MAX_SAVED_LOOKUP_INPUT_BYTES,
        command === 'diff' ? 'Retained diff input' : 'Lookup timeline input')) };
    default: throw new CliUsageError('This fixed-workflow command does not accept retained artefacts.');
  }
}

async function runMonitorOnceCommand(
  args: Extract<WorkflowCommandArguments, { action: 'monitor-once' }>,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('One-shot domain control review');
  let manifestInput: string;
  let previousInput: string | null = null;
  try {
    manifestInput = dependencies.readArtifactInput
      ? await dependencies.readArtifactInput(args.source)
      : await context.readInput(args.source, MAX_OFFLINE_EVIDENCE_INPUT_BYTES, 'Domain-control manifest input');
    if (args.previousSource) {
      previousInput = dependencies.readDiffInput
        ? await dependencies.readDiffInput(args.previousSource)
        : await context.readInput(args.previousSource, MAX_OFFLINE_EVIDENCE_INPUT_BYTES, 'Prior monitor snapshot');
    }
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(`Could not read monitor input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
  }
  if (!manifestInput.trim()) throw new CliUsageError('monitor-once requires one domain-control manifest file or a document on stdin.');
  const executeLookup = dependencies.runUnifiedLookup || (await import('../lib/lookup.mts')).runUnifiedLookup;
  const progress = context.beginProgress('Collecting bounded domain-control evidence');
  let document;
  try {
    document = await runDomainControlMonitor(manifestInput, previousInput, {
      executeLookup,
      now: context.now,
      limit: args.limit,
      concurrency: args.concurrency,
      ...(dependencies.signal ? { signal: dependencies.signal } : {}),
      onSettled: (completed, total) => progress.update(`Collected ${completed} of ${total} owned domains`),
    });
  } finally {
    context.endProgress();
  }
  if (!args.quiet) {
    context.writeStdout(args.output === 'json'
      ? formatJsonDocument(document)
      : args.output === 'junit'
        ? formatCliJunit(document)
        : context.terminal(formatDomainControlMonitor(document), args.color));
  }
  const policyFindings = evaluateCliFailPolicies(document, args.failOn || []);
  if (policyFindings.length) context.writeStderr(formatFailPolicyNotice(policyFindings));
  return document.collection.failed || policyFindings.length
    ? EXIT_CODES.PARTIAL_FAILURE
    : EXIT_CODES.SUCCESS;
}

async function runWorkflowPlanCommand(
  args: Extract<WorkflowCommandArguments, { action: 'workflow-plan' }>,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Investigation plan');
  if ('discovery' in args) {
    const catalogue = buildWorkflowRecipeCatalogue(args.discovery === 'explain' ? args.recipe : null);
    if (!args.quiet) {
      context.writeStdout(args.output === 'json'
        ? formatJsonDocument(catalogue)
        : context.terminal(formatWorkflowRecipeCatalogue(catalogue), args.color));
    }
    return EXIT_CODES.SUCCESS;
  }
  const document = buildInvestigationPlan(args.recipe, args.subject, context.now());
  if (!args.quiet) {
    context.writeStdout(args.output === 'json'
      ? formatJsonDocument(document)
      : context.terminal(formatInvestigationPlan(document), args.color));
  }
  return EXIT_CODES.SUCCESS;
}

async function runWorkflowRecipeCommand(
  args: Extract<WorkflowCommandArguments, { action: 'workflow-run' }>,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  context.setFailureLabel('Investigation workflow');
  let resumeInput: string | null = null;
  if (args.resumeSource) {
    try {
      resumeInput = dependencies.workflowResumeInput !== undefined
        ? dependencies.workflowResumeInput
        : dependencies.readDiffInput
          ? await dependencies.readDiffInput(args.resumeSource)
          : await context.readInput(args.resumeSource, MAX_INVESTIGATION_RUN_BYTES, 'Investigation resume state');
    } catch (error) {
      if (error instanceof CliUsageError) throw error;
      throw new CliUsageError(`Could not read investigation resume state: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
    }
  }
  const document = await runInvestigationRecipe(args.recipe, args.subject, {
    approveNetwork: args.approveNetwork,
    selections: args.selections,
    artifactBindings: args.artifactBindings,
    resumeInput,
    generatedAt: context.now(),
    ...(dependencies.signal ? { signal: dependencies.signal } : {}),
    execute: async (command, stepArguments, inputs) => {
      const stepStdout = createBufferedOutput();
      const stepStderr = createCliDiagnosticOutput();
      try {
        const exitCode = await context.executeCli([command, ...stepArguments], {
          stdout: stepStdout.stream,
          stderr: stepStderr.stream,
          ...boundWorkflowInputs(command, inputs, dependencies, context),
        });
        return { exitCode, stdout: stepStdout.value() };
      } finally {
        const diagnostic = stepStderr.value();
        if (diagnostic) context.writeStderr(`${command}: ${diagnostic}\n`);
      }
    },
  });
  if (!args.quiet) {
    context.writeStdout(args.output === 'json'
      ? formatJsonDocument(document)
      : context.terminal(formatInvestigationRun(document), args.color));
  }
  return investigationRunExitCode(document);
}

const WORKFLOW_COMMAND_HANDLERS = Object.freeze({
  'monitor-once': runMonitorOnceCommand,
  'workflow-plan': runWorkflowPlanCommand,
  'workflow-run': runWorkflowRecipeCommand,
} satisfies DiscriminatedCommandHandlerMap<
  WorkflowCommandArguments,
  [CliDependencies, CliCommandContext],
  number
>);

function runWorkflowCommand(
  args: WorkflowCommandArguments,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  return runDiscriminatedCommandHandler(WORKFLOW_COMMAND_HANDLERS, args, dependencies, context);
}

export { WORKFLOW_COMMAND_HANDLERS, runWorkflowCommand };
