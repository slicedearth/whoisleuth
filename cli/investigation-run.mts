import { Buffer } from 'node:buffer';

import {
  buildInvestigationPlan,
  type InvestigationPlanRecipe,
} from './investigation-plan.mts';
import { CliUsageError } from './errors.mts';

export const CLI_INVESTIGATION_RUN_SCHEMA = 'whoisleuth.cli.investigation-run';
export const CLI_INVESTIGATION_RUN_VERSION = 1;
export const MAX_INVESTIGATION_RUN_BYTES = 24 * 1024 * 1024;

type ExecutionResult = Readonly<{ exitCode: number; stdout: string }>;
type CompletedStep = Readonly<{
  id: string;
  command: string;
  arguments: readonly string[];
  mode: 'offline' | 'network';
  exitCode: number;
  result: unknown;
}>;

function boundedResult(value: string): unknown {
  if (Buffer.byteLength(value, 'utf8') > MAX_INVESTIGATION_RUN_BYTES) {
    throw new CliUsageError(`Investigation step output is limited to ${MAX_INVESTIGATION_RUN_BYTES} bytes.`);
  }
  try {
    return JSON.parse(value);
  } catch {
    return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').slice(0, MAX_INVESTIGATION_RUN_BYTES);
  }
}

function parseResumeState(input: string | null, recipe: InvestigationPlanRecipe, subject: string): CompletedStep[] {
  if (!input) return [];
  if (Buffer.byteLength(input, 'utf8') > MAX_INVESTIGATION_RUN_BYTES) throw new CliUsageError('Investigation resume state exceeds the 24 MiB limit.');
  let parsed: unknown;
  try { parsed = JSON.parse(input.replace(/^\uFEFF/u, '')); } catch { throw new CliUsageError('Investigation resume state must be valid JSON.'); }
  const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  if (root.schema !== CLI_INVESTIGATION_RUN_SCHEMA || root.version !== CLI_INVESTIGATION_RUN_VERSION || root.recipe !== recipe || root.subject !== subject || !Array.isArray(root.completedSteps)) {
    throw new CliUsageError('Investigation resume state must match this versioned recipe and subject.');
  }
  return root.completedSteps.slice(0, 16).flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.command !== 'string' || !Array.isArray(item.arguments) || !['offline', 'network'].includes(String(item.mode)) || !Number.isSafeInteger(item.exitCode)) return [];
    return [Object.freeze({
      id: item.id,
      command: item.command,
      arguments: Object.freeze(item.arguments.filter((entry): entry is string => typeof entry === 'string').slice(0, 32)),
      mode: item.mode as 'offline' | 'network',
      exitCode: Number(item.exitCode),
      result: item.result,
    })];
  });
}

export async function runInvestigationRecipe(
  recipe: InvestigationPlanRecipe,
  subjectValue: string,
  options: Readonly<{
    approveNetwork: boolean;
    resumeInput: string | null;
    generatedAt: string;
    execute: (command: string, args: readonly string[]) => Promise<ExecutionResult>;
  }>,
) {
  const plan = buildInvestigationPlan(recipe, subjectValue, options.generatedAt);
  const prior = parseResumeState(options.resumeInput, recipe, plan.subject);
  const allowedStepIds = new Set(plan.steps.map((step) => step.id));
  if (prior.some((step) => !allowedStepIds.has(step.id))) throw new CliUsageError('Investigation resume state contains a step outside the fixed recipe.');
  const completed = [...prior];
  let state: 'complete' | 'awaiting_network_approval' | 'awaiting_analyst_selection' | 'step_failed' = 'complete';
  let currentStep: typeof plan.steps[number] | null = null;

  for (const step of plan.steps) {
    if (completed.some((item) => item.id === step.id)) continue;
    currentStep = step;
    if (step.arguments.some((argument) => /^<[^>]+>$/u.test(argument))) {
      state = 'awaiting_analyst_selection';
      break;
    }
    if (step.mode === 'network' && !options.approveNetwork) {
      state = 'awaiting_network_approval';
      break;
    }
    const result = await options.execute(step.command, step.arguments);
    completed.push(Object.freeze({
      id: step.id,
      command: step.command,
      arguments: step.arguments,
      mode: step.mode,
      exitCode: result.exitCode,
      result: boundedResult(result.stdout),
    }));
    if (result.exitCode !== 0 && result.exitCode !== 2) {
      state = 'step_failed';
      break;
    }
    currentStep = null;
  }

  return Object.freeze({
    schema: CLI_INVESTIGATION_RUN_SCHEMA,
    version: CLI_INVESTIGATION_RUN_VERSION,
    generatedAt: options.generatedAt,
    recipe,
    subject: plan.subject,
    state,
    networkApprovedForThisRun: options.approveNetwork,
    completedSteps: Object.freeze(completed),
    currentStep,
    limitations: Object.freeze([
      'Only commands and arguments from the installed fixed recipe can execute; no shell, script, arbitrary command, or enforcement action is accepted.',
      'Network steps run only with --approve-network for the current invocation. Analyst-selection placeholders always pause and are never interpreted as paths or values.',
      'A resume file is a local checkpoint, not proof that prior evidence remains current or that a human reviewed each stored result.',
    ]),
  });
}

export function formatInvestigationRun(document: Awaited<ReturnType<typeof runInvestigationRecipe>>): string {
  return [
    `Investigation run: ${document.recipe}`,
    `Subject    ${document.subject}`,
    `State      ${document.state.replaceAll('_', ' ')}`,
    `Completed  ${document.completedSteps.length}`,
    ...(document.currentStep ? [`Next       ${document.currentStep.label}`, `Approval   ${document.currentStep.approval.replaceAll('_', ' ')}`] : []),
    '',
  ].join('\n');
}
