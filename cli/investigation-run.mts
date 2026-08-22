import { Buffer } from 'node:buffer';

import {
  buildInvestigationPlan,
  isRunnableInvestigationRecipe,
  type RunnableInvestigationPlanRecipe,
} from './investigation-plan.mts';
import { CliUsageError } from './errors.mts';
import EXIT_CODES from './exit-codes.mts';
import { scanBoundedJson } from '../lib/bounded-json.mts';
import type { CliCommand } from './command-reference.mts';

export const CLI_INVESTIGATION_RUN_SCHEMA = 'whoisleuth.cli.investigation-run';
export const CLI_INVESTIGATION_RUN_VERSION = 1;
export const MAX_INVESTIGATION_RUN_BYTES = 24 * 1024 * 1024;

type ExecutionResult = Readonly<{ exitCode: number; stdout: string }>;
type CompletedStep = Readonly<{
  id: string;
  command: CliCommand;
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
    scanBoundedJson(value);
    return JSON.parse(value);
  } catch (cause) {
    if (cause instanceof TypeError && cause.message !== 'Artefact input is not valid JSON.') {
      throw new CliUsageError(`Investigation step output ${cause.message.replace(/^Artefact JSON /u, '')}`);
    }
    return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').slice(0, MAX_INVESTIGATION_RUN_BYTES);
  }
}

function resultSchema(value: unknown): string | null {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).schema === 'string'
    ? String((value as Record<string, unknown>).schema)
    : null;
}

function sameArguments(left: unknown, right: readonly string[]): boolean {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => typeof value === 'string' && value === right[index]);
}

function parseResumeState(
  input: string | null,
  plan: ReturnType<typeof buildInvestigationPlan>,
): CompletedStep[] {
  if (!input) return [];
  if (Buffer.byteLength(input, 'utf8') > MAX_INVESTIGATION_RUN_BYTES) throw new CliUsageError('Investigation resume state exceeds the 24 MiB limit.');
  const normalizedInput = input.replace(/^\uFEFF/u, '');
  try {
    scanBoundedJson(normalizedInput);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : '';
    if (detail === 'Artefact input is not valid JSON.') throw new CliUsageError('Investigation resume state must be valid JSON.');
    throw new CliUsageError(detail ? `Investigation resume state ${detail.replace(/^Artefact JSON /u, '')}` : 'Investigation resume state must be valid JSON.');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(normalizedInput); } catch { throw new CliUsageError('Investigation resume state must be valid JSON.'); }
  const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  if (root.schema !== CLI_INVESTIGATION_RUN_SCHEMA || root.version !== CLI_INVESTIGATION_RUN_VERSION || root.recipe !== plan.recipe.id || root.subject !== plan.subject || !Array.isArray(root.completedSteps)) {
    throw new CliUsageError('Investigation resume state must match this versioned recipe and subject.');
  }
  if (root.completedSteps.length > plan.steps.length) {
    throw new CliUsageError('Investigation resume state contains more steps than the installed fixed recipe.');
  }
  const completed: CompletedStep[] = [];
  for (const [index, value] of root.completedSteps.entries()) {
    const planned = plan.steps[index];
    if (!planned || !value || typeof value !== 'object' || Array.isArray(value)) {
      throw new CliUsageError('Investigation resume state contains a malformed or out-of-order step.');
    }
    const item = value as Record<string, unknown>;
    if (
      item.id !== planned.id
      || item.command !== planned.command
      || item.mode !== planned.mode
      || !sameArguments(item.arguments, planned.arguments)
      || !Number.isSafeInteger(item.exitCode)
    ) {
      throw new CliUsageError('Investigation resume state does not match the installed fixed recipe.');
    }
    const exitCode = Number(item.exitCode);
    if (exitCode !== 0 && exitCode !== 2) {
      if (index !== root.completedSteps.length - 1) {
        throw new CliUsageError('A failed investigation step must be the final retained step.');
      }
      break;
    }
    if (resultSchema(item.result) !== planned.produces) {
      throw new CliUsageError('Investigation resume state contains output from an unexpected command contract.');
    }
    completed.push(Object.freeze({
      id: planned.id,
      command: planned.command,
      arguments: planned.arguments,
      mode: planned.mode,
      exitCode,
      result: item.result,
    }));
  }
  return completed;
}

export async function runInvestigationRecipe(
  recipe: RunnableInvestigationPlanRecipe,
  subjectValue: string,
  options: Readonly<{
    approveNetwork: boolean;
    resumeInput: string | null;
    generatedAt: string;
    signal?: AbortSignal;
    execute: (command: CliCommand, args: readonly string[]) => Promise<ExecutionResult>;
  }>,
) {
  if (!isRunnableInvestigationRecipe(recipe)) {
    throw new CliUsageError('workflow-run supports only installed recipes whose exact steps satisfy the execution contract.');
  }
  const plan = buildInvestigationPlan(recipe, subjectValue, options.generatedAt);
  const prior = parseResumeState(options.resumeInput, plan);
  const completed = [...prior];
  let state: 'complete' | 'awaiting_network_approval' | 'awaiting_analyst_selection' | 'step_failed' = 'complete';
  let currentStep: typeof plan.steps[number] | null = null;

  for (const step of plan.steps) {
    options.signal?.throwIfAborted();
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
    if (result.exitCode === EXIT_CODES.CANCELLED) {
      throw options.signal?.reason || new DOMException('Cancelled', 'AbortError');
    }
    const parsedResult = boundedResult(result.stdout);
    if ((result.exitCode === 0 || result.exitCode === 2) && resultSchema(parsedResult) !== step.produces) {
      throw new CliUsageError(`Investigation step ${step.id} returned an unexpected command contract.`);
    }
    completed.push(Object.freeze({
      id: step.id,
      command: step.command,
      arguments: step.arguments,
      mode: step.mode,
      exitCode: result.exitCode,
      result: parsedResult,
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
