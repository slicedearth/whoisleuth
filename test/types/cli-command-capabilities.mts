import type {
  CliCommandContext,
  CliDependencies,
  CliWorkflowContext,
} from '../../cli/runner-types.mts';
import type { ReviewCommandDependencies } from '../../cli/review-command-runner.mts';
import type { HistoryCommandDependencies } from '../../cli/history-command-runner.mts';
import type { DiscoveryDependencies } from '../../cli/discovery-workflow.mts';

/** Compiled with the ordinary test project; never executed. Command-local
 * dependencies must not silently widen back to the complete dispatcher. */
export function checkCommandCapabilities(
  root: CliDependencies,
  review: ReviewCommandDependencies,
  history: HistoryCommandDependencies,
  discovery: DiscoveryDependencies,
  context: CliCommandContext,
  workflow: CliWorkflowContext,
): void {
  const accepted: [ReviewCommandDependencies, HistoryCommandDependencies, DiscoveryDependencies] = [
    root,
    root,
    root,
  ];
  void accepted;
  // @ts-expect-error Offline review does not receive a collector.
  void review.runUnifiedLookup;
  // @ts-expect-error Historical comparison does not receive networking.
  void history.safeFetch;
  // @ts-expect-error Candidate generation does not receive collection.
  void discovery.runUnifiedLookup;
  // @ts-expect-error Ordinary command context cannot invoke another command.
  void context.executeCli;
  void workflow.executeCli;
}
