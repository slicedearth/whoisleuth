import type { CliArguments } from './arguments.mts';
import {
  CLI_COMMANDS, INLINE_COMMAND_FAMILIES, inlineCommandFamily, inlineCommandsFor,
  type CliCommand, type InlineCommandFamily,
} from './command-reference.mts';
import type { CliCommandContext, CliDependencies } from './runner-types.mts';

const FAMILY_COMMANDS = Object.freeze(INLINE_COMMAND_FAMILIES.map(family =>
  Object.freeze({ family, commands: inlineCommandsFor(family) })));
const INLINE_CLI_COMMANDS: readonly CliCommand[] = Object.freeze(
  CLI_COMMANDS.filter((command) => inlineCommandFamily(command) !== null),
);

async function runInlineCommand(
  args: CliArguments,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  const family = inlineCommandFamily(args.action as CliCommand);
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
