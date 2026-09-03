import { Buffer } from 'node:buffer';

import {
  buildInvestigationPlan,
  isRunnableInvestigationRecipe,
  type RunnableInvestigationPlanRecipe,
} from './investigation-plan.mts';
import { CliUsageError } from './errors.mts';
import { hasUnsafeCliText } from './errors.mts';
import EXIT_CODES from './exit-codes.mts';
import { scanBoundedJson } from '../lib/bounded-json.mts';
import type { CliCommand } from './command-reference.mts';

export const CLI_INVESTIGATION_RUN_SCHEMA = 'whoisleuth.cli.investigation-run';
export const CLI_INVESTIGATION_RUN_VERSION = 2;
export const MAX_INVESTIGATION_RUN_BYTES = 24 * 1024 * 1024;
export const MAX_INVESTIGATION_RUN_SELECTIONS = 16;
export const MAX_INVESTIGATION_RUN_SELECTION_LENGTH = 1_024;

type ExecutionResult = Readonly<{ exitCode: number; stdout: string }>;
type CompletedStep = Readonly<{
  id: string;
  command: CliCommand;
  arguments: readonly string[];
  mode: 'offline' | 'network';
  exitCode: number;
  result: unknown;
}>;
type WorkflowSelection = Readonly<{ stepId: string; value: string }>;
type RetainedSelections = Readonly<{ stepId: string; values: readonly string[] }>;
type InvestigationPlan = ReturnType<typeof buildInvestigationPlan>;
type InvestigationStep = InvestigationPlan['steps'][number];

const PLACEHOLDER_PATTERN = /^<[^>]+>$/u;

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

function selectedArguments(step: InvestigationStep, values: readonly string[]): readonly string[] {
  let selectionIndex = 0;
  return Object.freeze(step.arguments.map((argument) => {
    if (!PLACEHOLDER_PATTERN.test(argument)) return argument;
    const selected = values[selectionIndex];
    selectionIndex += 1;
    return selected ?? argument;
  }));
}

function selectedStep(step: InvestigationStep, values: readonly string[]): InvestigationStep {
  return Object.freeze({ ...step, arguments: selectedArguments(step, values) });
}

function placeholderCount(step: InvestigationStep): number {
  return step.arguments.filter((argument) => PLACEHOLDER_PATTERN.test(argument)).length;
}

function validateSelectionValue(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_INVESTIGATION_RUN_SELECTION_LENGTH
    && Boolean(value.trim())
    && !value.startsWith('-')
    && !hasUnsafeCliText(value);
}

function normalizeRetainedSelections(
  plan: InvestigationPlan,
  value: unknown,
  label: string,
): RetainedSelections[] {
  if (!Array.isArray(value) || value.length > MAX_INVESTIGATION_RUN_SELECTIONS) {
    throw new CliUsageError(`${label} must contain at most ${MAX_INVESTIGATION_RUN_SELECTIONS} bounded analyst selections.`);
  }
  const plannedById = new Map(plan.steps.map((step) => [step.id, step]));
  const seen = new Set<string>();
  const retained: RetainedSelections[] = [];
  for (const itemValue of value) {
    if (!itemValue || typeof itemValue !== 'object' || Array.isArray(itemValue)) {
      throw new CliUsageError(`${label} contains a malformed analyst selection.`);
    }
    const item = itemValue as Record<string, unknown>;
    if (Object.keys(item).length !== 2 || !Object.hasOwn(item, 'stepId') || !Object.hasOwn(item, 'values')) {
      throw new CliUsageError(`${label} contains a malformed analyst selection.`);
    }
    const stepId = typeof item.stepId === 'string' ? item.stepId : '';
    const planned = plannedById.get(stepId);
    if (!planned || seen.has(stepId) || placeholderCount(planned) === 0 || !Array.isArray(item.values)) {
      throw new CliUsageError(`${label} does not match the installed fixed recipe.`);
    }
    if (item.values.length === 0 || item.values.length > placeholderCount(planned)
      || item.values.some((selection) => !validateSelectionValue(selection))) {
      throw new CliUsageError(`${label} contains an invalid value for step ${stepId}.`);
    }
    seen.add(stepId);
    retained.push(Object.freeze({ stepId, values: Object.freeze([...item.values] as string[]) }));
  }
  return plan.steps.flatMap((step) => {
    const selection = retained.find((item) => item.stepId === step.id);
    return selection ? [selection] : [];
  });
}

function normalizeInvocationSelections(
  plan: InvestigationPlan,
  selections: readonly WorkflowSelection[],
): RetainedSelections[] {
  if (!Array.isArray(selections) || selections.length > MAX_INVESTIGATION_RUN_SELECTIONS) {
    throw new CliUsageError(`workflow-run accepts at most ${MAX_INVESTIGATION_RUN_SELECTIONS} analyst selections.`);
  }
  const grouped = new Map<string, string[]>();
  for (const item of selections) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.stepId !== 'string' || !validateSelectionValue(item.value)) {
      throw new CliUsageError('workflow-run selections must use bounded <step-id>=<path-or-value> entries whose values do not start with a hyphen.');
    }
    const values = grouped.get(item.stepId) ?? [];
    values.push(item.value);
    grouped.set(item.stepId, values);
  }
  return normalizeRetainedSelections(plan, [...grouped].map(([stepId, values]) => ({ stepId, values })), 'workflow-run selections');
}

function mergeSelections(
  plan: InvestigationPlan,
  retained: readonly RetainedSelections[],
  supplied: readonly RetainedSelections[],
  completed: readonly CompletedStep[],
): RetainedSelections[] {
  const merged = new Map(retained.map((item) => [item.stepId, item.values]));
  for (const item of supplied) {
    const completedStep = completed.find((step) => step.id === item.stepId);
    if (completedStep && !sameArguments(completedStep.arguments, selectedArguments(
      plan.steps.find((step) => step.id === item.stepId)!,
      item.values,
    ))) {
      throw new CliUsageError(`workflow-run cannot change analyst selections for completed step ${item.stepId}.`);
    }
    merged.set(item.stepId, item.values);
  }
  return plan.steps.flatMap((step) => {
    const values = merged.get(step.id);
    return values ? [Object.freeze({ stepId: step.id, values: Object.freeze([...values]) })] : [];
  });
}

function parseResumeState(
  input: string | null,
  plan: InvestigationPlan,
): Readonly<{ completed: readonly CompletedStep[]; selections: readonly RetainedSelections[] }> {
  if (!input) return Object.freeze({ completed: Object.freeze([]), selections: Object.freeze([]) });
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
  if (root.schema !== CLI_INVESTIGATION_RUN_SCHEMA
    || (root.version !== 1 && root.version !== CLI_INVESTIGATION_RUN_VERSION)
    || root.recipe !== plan.recipe.id || root.subject !== plan.subject || !Array.isArray(root.completedSteps)) {
    throw new CliUsageError('Investigation resume state must match this versioned recipe and subject.');
  }
  const selections = root.version === 1
    ? Object.freeze([]) as readonly RetainedSelections[]
    : Object.freeze(normalizeRetainedSelections(plan, root.selections, 'Investigation resume state'));
  if (root.version === 1 && root.selections !== undefined) {
    throw new CliUsageError('Investigation resume state version 1 cannot contain analyst selections.');
  }
  const selectionsByStep = new Map(selections.map((item) => [item.stepId, item.values]));
  if (root.completedSteps.length > plan.steps.length) {
    throw new CliUsageError('Investigation resume state contains more steps than the installed fixed recipe.');
  }
  const completed: CompletedStep[] = [];
  for (const [index, value] of root.completedSteps.entries()) {
    const baseStep = plan.steps[index];
    const planned = baseStep ? selectedStep(baseStep, selectionsByStep.get(baseStep.id) ?? []) : null;
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
  return Object.freeze({ completed: Object.freeze(completed), selections });
}

export async function runInvestigationRecipe(
  recipe: RunnableInvestigationPlanRecipe,
  subjectValue: string,
  options: Readonly<{
    approveNetwork: boolean;
    resumeInput: string | null;
    selections?: readonly WorkflowSelection[];
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
  const suppliedSelections = normalizeInvocationSelections(plan, options.selections ?? []);
  const selections = mergeSelections(plan, prior.selections, suppliedSelections, prior.completed);
  const selectionsByStep = new Map(selections.map((item) => [item.stepId, item.values]));
  const completed = [...prior.completed];
  let state: 'complete' | 'awaiting_network_approval' | 'awaiting_analyst_selection' | 'step_failed' = 'complete';
  let currentStep: typeof plan.steps[number] | null = null;

  for (const baseStep of plan.steps) {
    options.signal?.throwIfAborted();
    const step = selectedStep(baseStep, selectionsByStep.get(baseStep.id) ?? []);
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
    selections: Object.freeze(selections),
    completedSteps: Object.freeze(completed),
    currentStep,
    limitations: Object.freeze([
      'Only commands and arguments from the installed fixed recipe can execute; no shell, script, arbitrary command, or enforcement action is accepted.',
      'Network steps run only with --approve-network for the current invocation. Unresolved analyst selections pause; supplied values replace exact placeholders and are passed as arguments without shell interpretation.',
      'A resume file is a local checkpoint and can retain selected local paths or values. It is not proof that prior evidence remains current or that a human reviewed each stored result.',
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
