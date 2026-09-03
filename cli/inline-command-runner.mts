import type { CliArguments } from './arguments.mts';
import { CLI_COMMANDS, commandDefinition, type CliCommand } from './command-reference.mts';
import {
  ASSURANCE_INLINE_COMMANDS,
  HISTORY_INLINE_COMMANDS,
  REVIEW_INLINE_COMMANDS,
  SUPPORT_INLINE_COMMANDS,
  WORKFLOW_INLINE_COMMANDS,
} from './inline-command-families.mts';
import type { CliCommandContext, CliDependencies } from './runner-types.mts';

type InlineCommandFamily = 'assurance' | 'history' | 'review' | 'support' | 'workflow';

const FAMILY_COMMANDS: readonly Readonly<{
  family: InlineCommandFamily;
  commands: readonly CliCommand[];
}>[] = Object.freeze([
  Object.freeze({ family: 'support', commands: SUPPORT_INLINE_COMMANDS }),
  Object.freeze({ family: 'review', commands: REVIEW_INLINE_COMMANDS }),
  Object.freeze({ family: 'assurance', commands: ASSURANCE_INLINE_COMMANDS }),
  Object.freeze({ family: 'workflow', commands: WORKFLOW_INLINE_COMMANDS }),
  Object.freeze({ family: 'history', commands: HISTORY_INLINE_COMMANDS }),
]);

function buildInlineCommandOwnership(): ReadonlyMap<CliCommand, InlineCommandFamily> {
  const ownership = new Map<CliCommand, InlineCommandFamily>();
  for (const { family, commands } of FAMILY_COMMANDS) {
    for (const command of commands) {
      if (ownership.has(command)) throw new Error(`Inline CLI command ${command} has more than one command-family owner.`);
      ownership.set(command, family);
    }
  }
  return ownership;
}

const INLINE_COMMAND_OWNERSHIP = buildInlineCommandOwnership();
const INLINE_CLI_COMMANDS: readonly CliCommand[] = Object.freeze(
  CLI_COMMANDS.filter((command) => commandDefinition(command).execution.handlerOwner === 'inline'),
);

function validateInlineCommandOwnership(): void {
  const missing = INLINE_CLI_COMMANDS.filter((command) => !INLINE_COMMAND_OWNERSHIP.has(command));
  const unexpected = [...INLINE_COMMAND_OWNERSHIP.keys()].filter((command) => !INLINE_CLI_COMMANDS.includes(command));
  if (missing.length || unexpected.length) {
    throw new Error(`Inline CLI command-family ownership is inconsistent (missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}).`);
  }
}

validateInlineCommandOwnership();

async function runInlineCommand(
  args: CliArguments,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  const family = INLINE_COMMAND_OWNERSHIP.get(args.action as CliCommand);
  if (family === 'support') {
    const { runSupportCommand } = await import('./support-command-runner.mts');
    return runSupportCommand(args as Parameters<typeof runSupportCommand>[0], dependencies, context);
  }
  if (family === 'review') {
    const { runReviewCommand } = await import('./review-command-runner.mts');
    return runReviewCommand(args as Parameters<typeof runReviewCommand>[0], dependencies, context);
  }
  if (family === 'assurance') {
    const { runAssuranceCommand } = await import('./assurance-command-runner.mts');
    return runAssuranceCommand(args as Parameters<typeof runAssuranceCommand>[0], dependencies, context);
  }
  if (family === 'workflow') {
    const { runWorkflowCommand } = await import('./workflow-command-runner.mts');
    return runWorkflowCommand(args as Parameters<typeof runWorkflowCommand>[0], dependencies, context);
  }
  if (family === 'history') {
    const { runHistoryCommand } = await import('./history-command-runner.mts');
    return runHistoryCommand(args as Parameters<typeof runHistoryCommand>[0], dependencies, context);
  }
  throw new Error('No inline CLI command-family route is registered for the parsed command.');
}

export {
  FAMILY_COMMANDS,
  INLINE_CLI_COMMANDS,
  runInlineCommand,
};
export type { InlineCommandFamily };
