import { Buffer } from 'node:buffer';
import { isDeepStrictEqual } from 'node:util';

import {
  buildInvestigationPlan,
  isRunnableInvestigationRecipe,
  workflowReviewDeclarations,
  workflowStandardInputs,
  type RunnableInvestigationPlanRecipe,
} from './investigation-plan.mts';
import { CliUsageError } from './errors.mts';
import { hasUnsafeCliText } from './errors.mts';
import EXIT_CODES from './exit-codes.mts';
import { scanBoundedJson } from '../lib/bounded-json.mts';
import type { CliCommand } from './command-reference.mts';
import {
  CLI_INVESTIGATION_RUN_SCHEMA,
  CLI_INVESTIGATION_RUN_VERSION,
  SUPPORTED_CLI_INVESTIGATION_RUN_VERSIONS,
  MAX_INVESTIGATION_RUN_BYTES,
  MAX_INVESTIGATION_RUN_SELECTIONS,
  MAX_INVESTIGATION_RUN_SELECTION_LENGTH,
  type InvestigationRunState,
  type WorkflowArtifactBinding,
} from '../packages/contracts/investigation-run.mts';
import {
  normalizeWorkflowBindings, validateWorkflowResult, workflowArtifactReference, workflowInputSchemas,
  type WorkflowArtifact, type WorkflowArtifactInput, type WorkflowStepInputs,
} from './investigation-artifacts.mts';

export {
  CLI_INVESTIGATION_RUN_SCHEMA,
  CLI_INVESTIGATION_RUN_VERSION,
  SUPPORTED_CLI_INVESTIGATION_RUN_VERSIONS,
  MAX_INVESTIGATION_RUN_BYTES,
  MAX_INVESTIGATION_RUN_SELECTIONS,
  MAX_INVESTIGATION_RUN_SELECTION_LENGTH,
};

type ExecutionResult = Readonly<{ exitCode: number; stdout: string }>;
type CompletedStep = Readonly<{
  id: string;
  command: CliCommand;
  arguments: readonly string[];
  mode: 'offline' | 'network';
  exitCode: number;
  result: unknown;
  artifact: WorkflowArtifact | null;
  inputs: readonly WorkflowArtifactInput[];
}>;
type WorkflowSelection = Readonly<{ stepId: string; value: string }>;
type RetainedSelections = Readonly<{ stepId: string; values: readonly string[] }>;
type InvestigationPlan = ReturnType<typeof buildInvestigationPlan>;
type InvestigationStep = InvestigationPlan['steps'][number];

const PLACEHOLDER_PATTERN = /^<[^>]+>$/u;
// These collectors can return useful incomplete observations. Offline validation
// and export failures are not observations and must remain retryable failures.
const PARTIAL_OBSERVATION_COMMANDS: ReadonlySet<CliCommand> = new Set(['lookup', 'posture', 'discover-scan', 'ct-search', 'monitor-once']);

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

function stepDisposition(step: InvestigationStep, exitCode: number, result: unknown, retained = false) {
  const partial = exitCode === EXIT_CODES.PARTIAL_FAILURE && step.mode === 'network'
    && PARTIAL_OBSERVATION_COMMANDS.has(step.command);
  if (exitCode === EXIT_CODES.SUCCESS || partial) {
    try {
      const artifact = validateWorkflowResult(step, result, retained);
      return { disposition: partial ? 'partial' as const : 'complete' as const, artifact };
    } catch {
      if (!partial) throw new CliUsageError(`Investigation step ${step.id} returned an unexpected command contract or invalid result.`);
    }
  }
  return { disposition: 'failed' as const, artifact: null };
}

function sameArguments(left: unknown, right: readonly string[]): boolean {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => typeof value === 'string' && value === right[index]);
}

function selectedArguments(
  step: InvestigationStep, values: readonly string[], bindings: readonly WorkflowArtifactBinding[], completed: readonly CompletedStep[],
): readonly string[] {
  let selectionIndex = 0;
  let input = 0;
  return Object.freeze(step.arguments.map((argument) => {
    if (!PLACEHOLDER_PATTERN.test(argument)) return argument;
    input += 1;
    const binding = bindings.find((item) => item.stepId === step.id && item.input === input);
    if (binding) {
      const artifact = completed.find((item) => item.id === binding.sourceStepId)?.artifact;
      return artifact ? workflowArtifactReference(artifact) : argument;
    }
    const selected = values[selectionIndex];
    selectionIndex += 1;
    return selected ?? argument;
  }));
}

function selectedStep(
  step: InvestigationStep, values: readonly string[], bindings: readonly WorkflowArtifactBinding[], completed: readonly CompletedStep[],
): InvestigationStep {
  return Object.freeze({ ...step, arguments: selectedArguments(step, values, bindings, completed) });
}

function resolveStepInputs(step: InvestigationStep, bindings: readonly WorkflowArtifactBinding[], completed: readonly CompletedStep[]) {
  const files = new Map<string, string>();
  const inputs = bindings.filter((binding) => binding.stepId === step.id).map((binding) => {
    const source = completed.find((item) => item.id === binding.sourceStepId);
    if (!source?.artifact) throw new CliUsageError(`Workflow step ${step.id} has no validated source artefact.`);
    files.set(workflowArtifactReference(source.artifact), JSON.stringify(source.result));
    return Object.freeze({ input: binding.input, sourceStepId: source.id, artifactId: source.artifact.id });
  });
  return { files, inputs: Object.freeze(inputs) };
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
  bindings: readonly WorkflowArtifactBinding[],
): RetainedSelections[] {
  const merged = new Map(retained.map((item) => [item.stepId, item.values]));
  for (const item of supplied) {
    const completedStep = completed.find((step) => step.id === item.stepId);
    if (completedStep && !sameArguments(completedStep.arguments, selectedArguments(
      plan.steps.find((step) => step.id === item.stepId)!,
      item.values,
      bindings, completed,
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

function mergeBindings(plan: InvestigationPlan, retained: readonly WorkflowArtifactBinding[], supplied: readonly WorkflowArtifactBinding[], completed: readonly CompletedStep[]) {
  const merged = [...retained];
  for (const binding of supplied) {
    const index = merged.findIndex((item) => item.stepId === binding.stepId && item.input === binding.input);
    if (completed.some((step) => step.id === binding.stepId) && !isDeepStrictEqual(merged[index], binding)) {
      throw new CliUsageError(`workflow-run cannot change artefact inputs for completed step ${binding.stepId}.`);
    }
    if (index === -1) merged.push(binding); else merged[index] = binding;
  }
  return normalizeWorkflowBindings(plan, merged);
}

function validateSelectedInputs(plan: InvestigationPlan, selections: readonly RetainedSelections[], bindings: readonly WorkflowArtifactBinding[], completed: readonly CompletedStep[]) {
  for (const selection of selections) {
    const step = plan.steps.find((item) => item.id === selection.stepId)!;
    if (selection.values.length + bindings.filter((item) => item.stepId === step.id).length > placeholderCount(step)) {
      throw new CliUsageError(`Workflow step ${step.id} has more selections and artefact bindings than inputs.`);
    }
    // Ordinary filenames remain literal. A caller cannot make a selected file
    // alias an explicitly bound in-memory document in the same invocation.
    if (selection.values.some((value) => bindings.some((binding) => binding.stepId === step.id && completed.some((item) =>
      item.id === binding.sourceStepId && item.artifact && value === workflowArtifactReference(item.artifact))))) {
      throw new CliUsageError(`Workflow step ${step.id} has a filename that conflicts with an artefact reference.`);
    }
  }
}

function parseResumeState(
  input: string | null,
  plan: InvestigationPlan,
): Readonly<{ completed: readonly CompletedStep[]; selections: readonly RetainedSelections[]; bindings: readonly WorkflowArtifactBinding[] }> {
  if (!input) return Object.freeze({ completed: Object.freeze([]), selections: Object.freeze([]), bindings: Object.freeze([]) });
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
    || !SUPPORTED_CLI_INVESTIGATION_RUN_VERSIONS.some((version) => root.version === version)
    || root.recipe !== plan.recipe.id || root.subject !== plan.subject || !Array.isArray(root.completedSteps)) {
    throw new CliUsageError('Investigation resume state must match this versioned recipe and subject.');
  }
  const selections = root.version === 1
    ? Object.freeze([]) as readonly RetainedSelections[]
    : Object.freeze(normalizeRetainedSelections(plan, root.selections, 'Investigation resume state'));
  if (root.version === 1 && root.selections !== undefined) {
    throw new CliUsageError('Investigation resume state version 1 cannot contain analyst selections.');
  }
  const bindings = root.version === CLI_INVESTIGATION_RUN_VERSION ? normalizeWorkflowBindings(plan, root.artifactBindings) : [];
  if (root.version !== CLI_INVESTIGATION_RUN_VERSION && root.artifactBindings !== undefined) {
    throw new CliUsageError('Legacy investigation checkpoints cannot declare artefact bindings.');
  }
  validateSelectedInputs(plan, selections, bindings, []);
  const selectionsByStep = new Map(selections.map((item) => [item.stepId, item.values]));
  if (root.completedSteps.length > plan.steps.length) {
    throw new CliUsageError('Investigation resume state contains more steps than the installed fixed recipe.');
  }
  const completed: CompletedStep[] = [];
  for (const [index, value] of root.completedSteps.entries()) {
    const baseStep = plan.steps[index];
    const planned = baseStep ? selectedStep(baseStep, selectionsByStep.get(baseStep.id) ?? [], bindings, completed) : null;
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
    const { disposition, artifact } = stepDisposition(planned, exitCode, item.result, true);
    const { inputs } = resolveStepInputs(planned, bindings, completed);
    if (root.version === CLI_INVESTIGATION_RUN_VERSION) {
      if (!isDeepStrictEqual(item.artifact, artifact) || !isDeepStrictEqual(item.inputs, inputs)) {
        throw new CliUsageError('Investigation checkpoint artefact identity or input bindings do not match the retained results.');
      }
    } else if (item.artifact !== undefined || item.inputs !== undefined) {
      throw new CliUsageError('Legacy investigation steps cannot declare artefact identities.');
    }
    if (disposition === 'failed') {
      if (index !== root.completedSteps.length - 1) {
        throw new CliUsageError('A failed investigation step must be the final retained step.');
      }
      break;
    }
    completed.push(Object.freeze({
      id: planned.id,
      command: planned.command,
      arguments: planned.arguments,
      mode: planned.mode,
      exitCode,
      result: item.result,
      artifact,
      inputs,
    }));
  }
  validateSelectedInputs(plan, selections, bindings, completed);
  return Object.freeze({ completed: Object.freeze(completed), selections, bindings });
}

export async function runInvestigationRecipe(
  recipe: RunnableInvestigationPlanRecipe,
  subjectValue: string,
  options: Readonly<{
    approveNetwork: boolean;
    resumeInput: string | null;
    selections?: readonly WorkflowSelection[];
    artifactBindings?: readonly WorkflowArtifactBinding[];
    confirmedReviews?: readonly string[];
    selectInputs?: (request: Readonly<{ stepId: string; label: string; inputs: readonly string[] }>) => Promise<readonly string[]>;
    generatedAt: string;
    signal?: AbortSignal;
    execute: (command: CliCommand, args: readonly string[], inputs: WorkflowStepInputs) => Promise<ExecutionResult>;
  }>,
) {
  if (!isRunnableInvestigationRecipe(recipe)) {
    throw new CliUsageError('workflow-run supports only installed recipes whose exact steps satisfy the execution contract.');
  }
  const plan = buildInvestigationPlan(recipe, subjectValue, options.generatedAt);
  const confirmedReviews = options.confirmedReviews ?? [];
  if (!Array.isArray(confirmedReviews) || confirmedReviews.length > plan.steps.length
    || new Set(confirmedReviews).size !== confirmedReviews.length
    || confirmedReviews.some(id => !plan.steps.some(step => step.id === id && workflowReviewDeclarations(step).length))) {
    throw new CliUsageError('--confirm-review must name each selected review-declaration step at most once.');
  }
  const prior = parseResumeState(options.resumeInput, plan);
  const suppliedSelections = normalizeInvocationSelections(plan, options.selections ?? []);
  // A complete explicit input list replaces a not-yet-run step's standard or
  // retained connections. Partial lists fill the remaining unbound slots.
  const explicitSteps = new Set(suppliedSelections.filter(selection =>
    selection.values.length === placeholderCount(plan.steps.find(step => step.id === selection.stepId)!)
      && !prior.completed.some(step => step.id === selection.stepId)).map(selection => selection.stepId));
  const initialBindings = options.resumeInput === null ? workflowStandardInputs(recipe) : prior.bindings;
  const bindings = mergeBindings(plan, initialBindings.filter(binding => !explicitSteps.has(binding.stepId)),
    normalizeWorkflowBindings(plan, options.artifactBindings ?? []), prior.completed);
  let selections = mergeSelections(plan, prior.selections, suppliedSelections, prior.completed, bindings);
  validateSelectedInputs(plan, selections, bindings, prior.completed);
  const selectionsByStep = new Map(selections.map((item) => [item.stepId, item.values]));
  const completed = [...prior.completed];
  let state: InvestigationRunState = completed.some((step) => step.exitCode === EXIT_CODES.PARTIAL_FAILURE) ? 'partial' : 'complete';
  let currentStep: typeof plan.steps[number] | null = null;

  for (const baseStep of plan.steps) {
    options.signal?.throwIfAborted();
    let step = selectedStep(baseStep, selectionsByStep.get(baseStep.id) ?? [], bindings, completed);
    if (completed.some((item) => item.id === step.id)) continue;
    const missingInputs = step.arguments.filter(argument => PLACEHOLDER_PATTERN.test(argument));
    if (missingInputs.length && options.selectInputs) {
      const supplied = await options.selectInputs({ stepId: step.id, label: step.label, inputs: missingInputs });
      options.signal?.throwIfAborted();
      if (!Array.isArray(supplied) || supplied.length > missingInputs.length) throw new CliUsageError('Interactive selections exceed the remaining fixed-recipe inputs.');
      if (supplied.length) {
        const values = [...(selectionsByStep.get(step.id) ?? []), ...supplied];
        const added = normalizeRetainedSelections(plan, [{ stepId: step.id, values }], 'Interactive selections');
        selections = mergeSelections(plan, selections, added, completed, bindings);
        validateSelectedInputs(plan, selections, bindings, completed);
        selectionsByStep.set(step.id, values);
        step = selectedStep(baseStep, values, bindings, completed);
      }
    }
    currentStep = step;
    if (step.arguments.some((argument) => /^<[^>]+>$/u.test(argument))) {
      state = 'awaiting_analyst_selection';
      break;
    }
    if (step.mode === 'network' && !options.approveNetwork) {
      state = 'awaiting_network_approval';
      break;
    }
    if (workflowReviewDeclarations(step).length && !confirmedReviews.includes(step.id)) {
      state = 'awaiting_review_confirmation';
      break;
    }
    validateSelectedInputs(plan, selections, bindings, completed);
    const { files, inputs } = resolveStepInputs(step, bindings, completed);
    const result = await options.execute(step.command, step.arguments, files);
    options.signal?.throwIfAborted();
    if (result.exitCode === EXIT_CODES.CANCELLED) {
      throw options.signal?.reason || new DOMException('Cancelled', 'AbortError');
    }
    const parsedResult = boundedResult(result.stdout);
    const { disposition, artifact } = stepDisposition(step, result.exitCode, parsedResult);
    completed.push(Object.freeze({
      id: step.id,
      command: step.command,
      arguments: step.arguments,
      mode: step.mode,
      exitCode: result.exitCode,
      result: parsedResult,
      artifact,
      inputs,
    }));
    if (disposition === 'failed') {
      state = 'step_failed';
      break;
    }
    if (disposition === 'partial') {
      state = 'partial';
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
    reviewsConfirmedForThisRun: Object.freeze([...confirmedReviews]),
    selections: Object.freeze(selections),
    artifactBindings: bindings,
    completedSteps: Object.freeze(completed),
    currentStep,
    limitations: Object.freeze([
      'Only commands and arguments from the installed fixed recipe can execute; no shell, script, arbitrary command, or enforcement action is accepted.',
      'Network steps run only with --approve-network for the current invocation. Unresolved analyst selections pause; supplied values replace exact placeholders and are passed as arguments without shell interpretation.',
      'Steps declaring human review require --confirm-review for that exact step in the current invocation. Confirm only after reviewing its selected material and each listed declaration; checkpoint metadata never grants permission to another step.',
      'A resume file is a local checkpoint and can retain selected local paths or values. It is not proof that prior evidence remains current or that a human reviewed each stored result.',
      'Standard and explicit artefact bindings reuse validated compatible earlier outputs without temporary extraction files. Full explicit input lists override uncompleted step connections. Resumes preserve their recorded connections; no new standard inputs are added to an older checkpoint. Content digests identify retained JSON, not source authenticity or currency.',
      'An incomplete collection pauses for review. Resuming retains it without recollection; the run remains partial even after later steps finish. Failed validation or export steps are retried, not accepted as evidence.',
    ]),
  });
}

export function investigationRunExitCode(document: Awaited<ReturnType<typeof runInvestigationRecipe>>): number {
  if (document.state === 'step_failed') {
    const code = document.completedSteps.at(-1)?.exitCode;
    return typeof code === 'number' && code !== EXIT_CODES.SUCCESS && Object.values(EXIT_CODES).some((known) => code === known)
      ? code : EXIT_CODES.INTERNAL_ERROR;
  }
  return document.completedSteps.some((step) => step.exitCode === EXIT_CODES.PARTIAL_FAILURE)
    ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
}

export function formatInvestigationRun(document: Awaited<ReturnType<typeof runInvestigationRecipe>>): string {
  const stepLabel = document.state === 'step_failed' ? 'Failed' : document.state === 'partial' ? 'Review' : 'Next';
  const plan = buildInvestigationPlan(document.recipe, document.subject, document.generatedAt);
  const accepted = document.completedSteps.filter(step => step.artifact);
  const current = document.currentStep;
  const inputs = current?.arguments.flatMap((argument, position) => {
    if (!PLACEHOLDER_PATTERN.test(argument)) return [];
    // Slots refer to the fixed recipe, including inputs already bound or selected.
    const base = plan.steps.find(step => step.id === current.id)!;
    const input = base.arguments.slice(0, position + 1).filter(value => PLACEHOLDER_PATTERN.test(value)).length;
    const compatible = workflowInputSchemas(current.command);
    const reusable = accepted.filter(step => step.artifact && compatible.includes(step.artifact.schema));
    return [
      `Input ${current.id}:${input}  ${argument} — --select ${current.id}=<path-or-value>`,
      ...reusable.map(source => `  Reuse deliberately: --use-artifact ${current.id}:${input}=${source.id}`),
    ];
  }) ?? [];
  return [
    `Investigation run: ${document.recipe}`,
    `Subject    ${document.subject}`,
    `State      ${document.state.replaceAll('_', ' ')}`,
    `Progress   ${accepted.length} of ${plan.steps.length} steps retained`,
    ...accepted.map(step => `  ${step.id}: ${step.exitCode === EXIT_CODES.PARTIAL_FAILURE ? 'partial observation' : 'completed'} · ${step.artifact!.schema} v${step.artifact!.version} · ${step.artifact!.id}`),
    ...(document.currentStep ? [
      `${stepLabel.padEnd(11)}${document.currentStep.label}`,
      ...(document.state === 'partial' || document.state === 'step_failed' ? [] : [`Approval   ${document.currentStep.approval.replaceAll('_', ' ')}`]),
    ] : []),
    ...inputs,
    ...(document.state === 'awaiting_network_approval' ? ['Continue with --approve-network only after reviewing the next command’s network disclosure.'] : []),
    ...(document.state === 'awaiting_review_confirmation' && current ? [
      `Declarations: ${workflowReviewDeclarations(current).join(', ')}`,
      `After reviewing the selected material, continue with --confirm-review ${current.id}.`,
    ] : []),
    ...(current ? ['Keep the JSON checkpoint with --json --output <run.json>, then continue the same recipe and subject with --resume <run.json>.'] : [
      document.state === 'partial' ? 'All steps have run; retained incomplete observations remain incomplete.' : 'All recipe steps have run. This is not an analyst verdict or proof that every finding is resolved.',
    ]),
    '',
  ].join('\n');
}
