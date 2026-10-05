import { type ParsedCommandArguments } from './command-argument-grammar.mts';
import { CliUsageError } from './errors.mts';
import type {
  InvestigationPlanRecipe,
  RunnableInvestigationPlanRecipe,
} from './investigation-plan.mts';
import type { WorkflowArtifactBinding } from '../packages/contracts/investigation-run.mts';
import { type CliFailPolicy } from './fail-policy.mts';
import { commandDefaultNumber } from './command-reference.mts';
import { WORKFLOW_COMMAND_DEFINITIONS } from './workflow-command-definitions.mts';
import { parseDomainFeedSelectors } from './domain-feed.mts';
import {
  terminalOptions,
  jsonOutput,
  failPolicies,
  parseOutput,
  type TerminalOptions,
} from './argument-values.mts';

type MonitorOnceArguments = {
  action: 'monitor-once';
  source: string | null;
  previousSource: string | null;
  output: 'terminal' | 'json' | 'junit';
  limit: number;
  concurrency: number;
  failOn?: readonly CliFailPolicy[];
} & TerminalOptions;

type WatchlistReviewArguments = { action: 'watchlist-review'; operation: 'plan' | 'export'; source: string | null; output: 'terminal' | 'json' } & TerminalOptions;
type DomainFeedArguments = { action: 'domain-feed'; operation: 'review' | 'watch-input'; feedId: string; source: string; contextSource: string | null;
  selection: ReturnType<typeof parseDomainFeedSelectors>; output: 'terminal' | 'json' } & TerminalOptions;
function parseDomainFeedArguments(parsed: ParsedCommandArguments<DomainFeedArguments['action']>): DomainFeedArguments {
  const operation = parsed.positionalValue('operation') as DomainFeedArguments['operation'];
  const contextSource = parsed.positionalValue('context');
  if ((operation === 'watch-input') !== Boolean(contextSource)) throw new CliUsageError('watch-input requires one existing candidate-watch-input context file; review does not accept a context file.');
  return { action: 'domain-feed', operation, feedId: parsed.positionalValue('feed')!, source: parsed.positionalValue('source')!, contextSource,
    selection: parseDomainFeedSelectors(parsed.optionValues('--select')), output: jsonOutput(parsed), ...terminalOptions(parsed) };
}
function parseWatchlistReviewArguments(parsed: ParsedCommandArguments<WatchlistReviewArguments['action']>): WatchlistReviewArguments {
  return { action: 'watchlist-review', operation: parsed.positionalValue('operation') as 'plan' | 'export', source: parsed.positionalValue('source'), output: jsonOutput(parsed), ...terminalOptions(parsed) };
}

type WorkflowPlanArguments =
  | ({
      action: 'workflow-plan';
      recipe: InvestigationPlanRecipe;
      subject: string;
      output: 'terminal' | 'json';
    } & TerminalOptions)
  | ({ action: 'workflow-plan'; discovery: 'list'; output: 'terminal' | 'json' } & TerminalOptions)
  | ({
      action: 'workflow-plan';
      discovery: 'explain';
      recipe: InvestigationPlanRecipe;
      output: 'terminal' | 'json';
    } & TerminalOptions);

type WorkflowRunArguments = {
  action: 'workflow-run';
  recipe: RunnableInvestigationPlanRecipe;
  subject: string;
  resumeSource: string | null;
  selections: readonly Readonly<{ stepId: string; value: string }>[];
  artifactBindings: readonly WorkflowArtifactBinding[];
  confirmedReviews: readonly string[];
  approveNetwork: boolean;
  interactive: boolean;
  preview?: true;
  output: 'terminal' | 'json';
} & TerminalOptions;

function parseMonitorOnceArguments(parsed: ParsedCommandArguments<MonitorOnceArguments['action']>): MonitorOnceArguments {
  const selectedFailPolicies = failPolicies(parsed, 'monitor-once');
  return {
    action: 'monitor-once',
    source: parsed.positionalValue('source'),
    previousSource: parsed.optionValue('--previous'),
    output: parseOutput(parsed, WORKFLOW_COMMAND_DEFINITIONS['monitor-once']),
    limit: parsed.integerOption('--limit') ?? commandDefaultNumber('monitor-once', '--limit'),
    concurrency:
      parsed.integerOption('--concurrency') ??
      commandDefaultNumber('monitor-once', '--concurrency'),
    ...terminalOptions(parsed),
    ...(selectedFailPolicies ? { failOn: selectedFailPolicies } : {}),
  };
}

function parseWorkflowPlanArguments(parsed: ParsedCommandArguments<WorkflowPlanArguments['action']>): WorkflowPlanArguments {
  const options = { output: jsonOutput(parsed), ...terminalOptions(parsed) };
  if (parsed.hasOption('--list')) {
    if (parsed.allPositionals.length > 0)
      throw new CliUsageError('workflow-plan discovery options do not accept a subject.');
    return { action: 'workflow-plan', discovery: 'list', ...options };
  }
  if (parsed.hasOption('--explain')) {
    if (parsed.allPositionals.length > 0)
      throw new CliUsageError('workflow-plan discovery options do not accept a subject.');
    return {
      action: 'workflow-plan',
      discovery: 'explain',
      recipe: parsed.optionValue('--explain') as InvestigationPlanRecipe,
      ...options,
    };
  }
  if (parsed.allPositionals.length !== 2) {
    throw new CliUsageError(
      'workflow-plan requires one fixed recipe and one subject, --list, or --explain <recipe>.',
    );
  }
  return {
    action: 'workflow-plan',
    recipe: parsed.positionalValue('recipe') as InvestigationPlanRecipe,
    subject: parsed.positionalValue('subject')!,
    ...options,
  };
}

function parseWorkflowRunArguments(parsed: ParsedCommandArguments<WorkflowRunArguments['action']>): WorkflowRunArguments {
  const artifactBindings = parsed.optionValues('--use-artifact').map((value) => {
    const match = /^([a-z0-9]+(?:-[a-z0-9]+)*):([1-9][0-9]?)=([a-z0-9]+(?:-[a-z0-9]+)*)$/u.exec(
      value,
    );
    if (!match)
      throw new CliUsageError(
        '--use-artifact requires <step-id>:<input-number>=<earlier-step-id>.',
      );
    return Object.freeze({ stepId: match[1]!, input: Number(match[2]), sourceStepId: match[3]! });
  });
  const selections = parsed.optionValues('--select').map((value) => {
    const separator = value.indexOf('=');
    const stepId = separator === -1 ? '' : value.slice(0, separator);
    const selection = separator === -1 ? '' : value.slice(separator + 1);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(stepId) || !selection.trim()) {
      throw new CliUsageError('--select requires <step-id>=<path-or-value>.');
    }
    if (selection.startsWith('-')) {
      throw new CliUsageError(
        '--select values cannot start with a hyphen; prefix a file path with ./ when needed.',
      );
    }
    return Object.freeze({ stepId, value: selection });
  });
  return {
    action: 'workflow-run',
    recipe: parsed.positionalValue('recipe') as RunnableInvestigationPlanRecipe,
    subject: parsed.positionalValue('subject')!,
    resumeSource: parsed.optionValue('--resume'),
    selections: Object.freeze(selections),
    artifactBindings: Object.freeze(artifactBindings),
    confirmedReviews: Object.freeze(parsed.optionValues('--confirm-review')),
    approveNetwork: parsed.hasOption('--approve-network'),
    interactive: parsed.hasOption('--interactive'),
    ...(parsed.hasOption('--preview') ? { preview: true } : {}),
    output: jsonOutput(parsed),
    ...terminalOptions(parsed),
  };
}

export const WORKFLOW_ARGUMENT_PARSERS = Object.freeze({
  'domain-feed': parseDomainFeedArguments,
  'watchlist-review': parseWatchlistReviewArguments,
  'monitor-once': parseMonitorOnceArguments,
  'workflow-plan': parseWorkflowPlanArguments,
  'workflow-run': parseWorkflowRunArguments,
});
