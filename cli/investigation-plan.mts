import { domainToASCII } from 'node:url';
import { normalizeExplicitIsoTimestamp } from '../packages/evidence/observation.mts';
import type { WorkflowArtifactBinding } from '../packages/contracts/investigation-run.mts';
import { cliInvocationNetworkEffect } from './command-reference.mts';
import {
  INVESTIGATION_RECIPE_DEFINITIONS,
  INVESTIGATION_PLAN_RECIPES,
  RUNNABLE_INVESTIGATION_PLAN_RECIPES,
  type InvestigationPlanRecipe,
  type RunnableInvestigationPlanRecipe,
  type RecipeStep as Step,
  type RecipeDefinition,
} from './investigation-recipes.mts';

export const CLI_INVESTIGATION_PLAN_SCHEMA = 'whoisleuth.cli.investigation-plan';
export const CLI_INVESTIGATION_PLAN_VERSION = 1;
export const CLI_WORKFLOW_RECIPE_CATALOGUE_SCHEMA = 'whoisleuth.cli.workflow-recipe-catalogue';
export const CLI_WORKFLOW_RECIPE_CATALOGUE_VERSION = 1;
export { INVESTIGATION_PLAN_RECIPES, RUNNABLE_INVESTIGATION_PLAN_RECIPES };
export type { InvestigationPlanRecipe, RunnableInvestigationPlanRecipe };

type Recipe = RecipeDefinition & Readonly<{ id: InvestigationPlanRecipe }>;
const RECIPES = Object.freeze(
  Object.fromEntries(
    INVESTIGATION_PLAN_RECIPES.map((id) => [
      id,
      Object.freeze({
        ...INVESTIGATION_RECIPE_DEFINITIONS[id],
        id,
        steps: (subject: string) =>
          validatedSteps(INVESTIGATION_RECIPE_DEFINITIONS[id].steps(subject)),
      }),
    ]),
  ),
) as Readonly<Record<InvestigationPlanRecipe, Recipe>>;

export const INVESTIGATION_RECIPE_REGISTRY = RECIPES;

export function workflowStandardInputs(
  recipe: InvestigationPlanRecipe,
): readonly WorkflowArtifactBinding[] {
  return RECIPES[recipe].standardInputs ?? [];
}

export const INVESTIGATION_PLAN_RECIPE_LABELS = Object.freeze(
  Object.fromEntries(INVESTIGATION_PLAN_RECIPES.map((recipe) => [recipe, RECIPES[recipe].label])),
) as Readonly<Record<InvestigationPlanRecipe, string>>;

export function isRunnableInvestigationRecipe(
  value: InvestigationPlanRecipe,
): value is RunnableInvestigationPlanRecipe {
  return RUNNABLE_INVESTIGATION_PLAN_RECIPES.includes(value as RunnableInvestigationPlanRecipe);
}

export function workflowReviewDeclarations(step: Pick<Step, 'arguments'>): readonly string[] {
  return step.arguments.filter((argument) =>
    [
      '--reviewed',
      '--human-reviewed',
      '--personal-data-reviewed',
      '--redactions-confirmed',
    ].includes(argument),
  );
}

function recipeCatalogueEntry(recipe: Recipe) {
  const exampleSubject =
    recipe.subjectRequirement === 'domain' ? 'example.test' : 'Example Organisation';
  const steps = recipe.steps(exampleSubject).map((item) =>
    Object.freeze({
      id: item.id,
      label: item.label,
      command: item.command,
      exampleArguments: item.arguments,
      mode: item.mode,
      approval: item.approval,
      produces: item.produces,
      completion: item.completion,
    }),
  );
  return Object.freeze({
    id: recipe.id,
    label: recipe.label,
    objective: recipe.objective,
    subjectRequirement: recipe.subjectRequirement,
    runnableByWorkflowRun: isRunnableInvestigationRecipe(recipe.id),
    networkModes: Object.freeze([...new Set(steps.map((item) => item.mode))]),
    approvals: Object.freeze([...new Set(steps.map((item) => item.approval))]),
    steps: Object.freeze(steps),
    limitations: recipe.limitations,
  });
}

export function buildWorkflowRecipeCatalogue(recipeId: InvestigationPlanRecipe | null = null) {
  const selected = recipeId === null ? INVESTIGATION_PLAN_RECIPES : [recipeId];
  return Object.freeze({
    schema: CLI_WORKFLOW_RECIPE_CATALOGUE_SCHEMA,
    version: CLI_WORKFLOW_RECIPE_CATALOGUE_VERSION,
    recipes: Object.freeze(selected.map((id) => recipeCatalogueEntry(RECIPES[id]))),
    limitations: Object.freeze([
      'Catalogue and explanation modes are fixed metadata. They make no request, read no evidence file, and execute no step.',
      'workflow-run remains limited to recipes explicitly marked runnable by the installed registry.',
    ]),
  });
}

export function formatWorkflowRecipeCatalogue(
  catalogue: ReturnType<typeof buildWorkflowRecipeCatalogue>,
): string {
  return [
    'WHOISleuth workflow recipes',
    '',
    ...catalogue.recipes.flatMap((recipe) => [
      `${recipe.id} — ${recipe.label}`,
      `  Subject: ${recipe.subjectRequirement.replaceAll('_', ' ')}`,
      `  Workflow run: ${recipe.runnableByWorkflowRun ? 'supported' : 'plan and explanation only'}`,
      `  ${recipe.objective}`,
      ...recipe.steps.map(
        (item, index) =>
          `  ${index + 1}. ${item.label} [${item.mode}; ${item.approval.replaceAll('_', ' ')}]`,
      ),
      ...recipe.limitations.map((item) => `  Limitation: ${item}`),
      '',
    ]),
    ...catalogue.limitations.map((item) => `Limitation: ${item}`),
    '',
  ].join('\n');
}

function validatedSteps(steps: readonly Step[]): readonly Step[] {
  for (const step of steps) {
    const invocationEffect = cliInvocationNetworkEffect(step.command, step.arguments);
    if ((step.mode === 'network') !== (invocationEffect === 'network')) {
      throw new Error(
        `Investigation step ${step.id} does not match the registered network effect for ${step.command}.`,
      );
    }
  }
  return steps;
}

function boundedSubject(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 253 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(
      'Investigation-plan subject must be bounded text without control characters.',
    );
  }
  return value.replace(/\s+/gu, ' ').trim();
}

function normalizedDomain(value: string): string | null {
  const candidate = domainToASCII(value.toLowerCase().replace(/\.$/u, ''));
  if (!candidate || candidate.length > 253 || !candidate.includes('.')) return null;
  return candidate
    .split('.')
    .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
    ? candidate
    : null;
}

export function buildInvestigationPlan(
  recipeId: InvestigationPlanRecipe,
  subjectValue: unknown,
  generatedAtValue = new Date().toISOString(),
) {
  const recipe = RECIPES[recipeId];
  if (!recipe) throw new TypeError('Investigation-plan recipe is unsupported.');
  const suppliedSubject = boundedSubject(subjectValue);
  const subject =
    recipe.subjectRequirement === 'domain'
      ? normalizedDomain(suppliedSubject)
      : suppliedSubject.toLowerCase();
  if (!subject) throw new TypeError('This investigation-plan recipe requires one valid domain.');
  const generatedAt = normalizeExplicitIsoTimestamp(generatedAtValue);
  if (!generatedAt)
    throw new TypeError('Investigation-plan generation time must use an explicit timezone.');
  const steps = recipe.steps(subject);
  return Object.freeze({
    schema: CLI_INVESTIGATION_PLAN_SCHEMA,
    version: CLI_INVESTIGATION_PLAN_VERSION,
    generatedAt,
    recipe: Object.freeze({ id: recipeId, label: recipe.label, objective: recipe.objective }),
    subject,
    execution: 'plan_only' as const,
    steps,
    limitations: Object.freeze([
      ...recipe.limitations,
      'This document is a fixed plan. It does not execute commands, expand placeholders, make requests, read files, change cases, or submit reports.',
      'Network steps require deliberate execution and disclose the selected target to the sources described by that command.',
      'Analyst-selection steps require reviewed local artefacts; placeholders are never interpreted as file paths by this planner.',
    ]),
  });
}

export function formatInvestigationPlan(plan: ReturnType<typeof buildInvestigationPlan>): string {
  return [
    `Investigation plan: ${plan.recipe.label}`,
    `Subject  ${plan.subject}`,
    `Mode     ${plan.execution}`,
    '',
    ...plan.steps.flatMap((item, index) => [
      `${index + 1}. ${item.label}`,
      `   ${item.command} ${item.arguments.join(' ')}`,
      `   ${item.mode}; approval: ${item.approval.replaceAll('_', ' ')}`,
      `   ${item.completion}`,
    ]),
    '',
    ...plan.limitations.map((item) => `Limitation: ${item}`),
    '',
  ].join('\n');
}
