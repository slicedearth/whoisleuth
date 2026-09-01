import type { CliArguments } from './arguments.mts';
import { formatCliJunit } from './ci-report.mts';
import { formatDomainControlMonitor, runDomainControlMonitor } from './domain-control-monitor.mts';
import { boundedCliErrorMessage, CliUsageError } from './errors.mts';
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
  runInvestigationRecipe,
} from './investigation-run.mts';
import { MAX_OFFLINE_EVIDENCE_INPUT_BYTES } from './offline-evidence-review.mts';
import { createBufferedOutput } from './output-file.mts';
import type { CliCommandContext, CliDependencies } from './runner-types.mts';
import { WORKFLOW_INLINE_COMMANDS } from './inline-command-families.mts';

type WorkflowInlineCommand = typeof WORKFLOW_INLINE_COMMANDS[number];
type WorkflowCommandArguments = Extract<CliArguments, { action: WorkflowInlineCommand }>;

async function runWorkflowCommand(
  args: WorkflowCommandArguments,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  if (args.action === 'monitor-once') {
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

  if (args.action === 'workflow-plan') {
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

  if (args.action === 'workflow-run') {
    context.setFailureLabel('Investigation workflow');
    let resumeInput: string | null = null;
    if (args.resumeSource) {
      try {
        resumeInput = dependencies.readDiffInput
          ? await dependencies.readDiffInput(args.resumeSource)
          : await context.readInput(args.resumeSource, MAX_INVESTIGATION_RUN_BYTES, 'Investigation resume state');
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read investigation resume state: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
    }
    const document = await runInvestigationRecipe(args.recipe, args.subject, {
      approveNetwork: args.approveNetwork,
      resumeInput,
      generatedAt: context.now(),
      ...(dependencies.signal ? { signal: dependencies.signal } : {}),
      execute: async (command, stepArguments) => {
        const stepStdout = createBufferedOutput();
        const stepStderr = createBufferedOutput();
        const exitCode = await context.executeCli([command, ...stepArguments], {
          stdout: stepStdout.stream,
          stderr: stepStderr.stream,
        });
        return { exitCode, stdout: stepStdout.value() };
      },
    });
    if (!args.quiet) {
      context.writeStdout(args.output === 'json'
        ? formatJsonDocument(document)
        : context.terminal(formatInvestigationRun(document), args.color));
    }
    return document.state === 'step_failed' ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
  }

  throw new Error('Workflow command routing is inconsistent.');
}

export { runWorkflowCommand };
