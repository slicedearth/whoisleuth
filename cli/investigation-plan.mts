import { domainToASCII } from 'node:url';
import { normalizeExplicitIsoTimestamp } from '../packages/evidence/observation.mts';
import {
  INVESTIGATION_PLAN_RECIPES,
  cliInvocationNetworkEffect,
  type CliCommand,
} from './command-reference.mts';

export const CLI_INVESTIGATION_PLAN_SCHEMA = 'whoisleuth.cli.investigation-plan';
export const CLI_INVESTIGATION_PLAN_VERSION = 1;
export { INVESTIGATION_PLAN_RECIPES };
export type InvestigationPlanRecipe = typeof INVESTIGATION_PLAN_RECIPES[number];

type Step = Readonly<{
  id: string;
  label: string;
  command: CliCommand;
  arguments: readonly string[];
  mode: 'offline' | 'network';
  approval: 'none' | 'network_disclosure' | 'analyst_selection';
  produces: string;
  completion: string;
}>;

type Recipe = Readonly<{
  label: string;
  requiresDomain: boolean;
  objective: string;
  steps(subject: string): readonly Step[];
}>;

const RECIPES: Readonly<Record<InvestigationPlanRecipe, Recipe>> = Object.freeze({
  'domain-triage': Object.freeze({
    label: 'New domain triage',
    requiresDomain: true,
    objective: 'Collect and preserve a source-aware registration, DNS, HTTP, TLS, page, and network-context review.',
    steps: (domain: string) => Object.freeze([
      step('collect', 'Collect a Deep lookup', 'lookup', [domain, '--deep', '--json'], 'network', 'network_disclosure', 'whoisleuth.cli.lookup', 'Review source health and limitations before using missing fields.'),
      step('export', 'Create a portable evidence report', 'export', ['<saved-lookup.json>'], 'offline', 'analyst_selection', 'whoisleuth.lookup-evidence', 'Select the reviewed lookup file; the plan never guesses a path.'),
      step('verify', 'Verify the exported artefact', 'verify-artifact', ['<evidence.json>', '--json'], 'offline', 'analyst_selection', 'whoisleuth.offline-artifact-verification', 'Keep verification distinct from a claim that the observations are correct or current.'),
    ]),
  }),
  'lookalike-review': Object.freeze({
    label: 'Lookalike candidate review',
    requiresDomain: false,
    objective: 'Generate a bounded candidate queue, collect only the selected scope, and retain a reviewed candidate lookup.',
    steps: (subject: string) => Object.freeze([
      step('generate', 'Generate candidates offline', 'discover', [subject, '--preset', 'all', '--json'], 'offline', 'none', 'whoisleuth.cli.discover', 'Review mutation families and suppressions before collection.'),
      step('scan', 'Collect a bounded candidate queue', 'discover-scan', [subject, '--fast', '--scan-limit', '50', '--json'], 'network', 'network_disclosure', 'whoisleuth.cli.discovery-scan', 'Fast collection is a triage boundary; partial or inconclusive authority evidence remains explicit.'),
      step('inspect', 'Deep-review one selected candidate', 'lookup', ['<selected-domain>', '--deep', '--json'], 'network', 'analyst_selection', 'whoisleuth.cli.lookup', 'Select a candidate deliberately; generation does not prove registration, control, intent, or maliciousness.'),
    ]),
  }),
  'owned-domain-review': Object.freeze({
    label: 'Owned domain posture review',
    requiresDomain: true,
    objective: 'Review current passive posture and compare supplied observations with an analyst-authored control manifest.',
    steps: (domain: string) => Object.freeze([
      step('posture', 'Collect bounded DNS posture', 'posture', [domain, '--json'], 'network', 'network_disclosure', 'whoisleuth.cli.posture', 'Review mail profile and delegation evidence before interpreting missing records.'),
      step('lookup', 'Collect supporting Deep evidence', 'lookup', [domain, '--deep', '--json'], 'network', 'network_disclosure', 'whoisleuth.cli.lookup', 'Retain separately attributed registration, DNS, TLS, and page observations.'),
      step('manifest', 'Review the domain control manifest', 'domain-control', ['<review-input.json>', '--json'], 'offline', 'analyst_selection', 'whoisleuth.domain-control-review', 'Only complete supplied observations may produce drift.'),
    ]),
  }),
  'historical-comparison': Object.freeze({
    label: 'Historical observation comparison',
    requiresDomain: true,
    objective: 'Collect a current observation and compare it with analyst-selected saved observations without merging source states.',
    steps: (domain: string) => Object.freeze([
      step('current', 'Collect the current lookup', 'lookup', [domain, '--deep', '--json'], 'network', 'network_disclosure', 'whoisleuth.cli.lookup', 'A current request does not refresh or validate older provider-reported history.'),
      step('diff', 'Compare two selected observations', 'diff', ['<previous.json>', '<current.json>', '--json'], 'offline', 'analyst_selection', 'whoisleuth.cli.lookup-diff', 'Equal, different, conflicting, and unavailable evidence remain separate.'),
      step('timeline', 'Build a bounded local timeline', 'timeline', ['<oldest.json>', '<newer.json>', '<current.json>', '--json'], 'offline', 'analyst_selection', 'whoisleuth.cli.lookup-timeline', 'Choose two to twenty same-domain files in chronological scope.'),
    ]),
  }),
});

export const INVESTIGATION_PLAN_RECIPE_LABELS = Object.freeze(Object.fromEntries(
  INVESTIGATION_PLAN_RECIPES.map((recipe) => [recipe, RECIPES[recipe].label]),
)) as Readonly<Record<InvestigationPlanRecipe, string>>;

function step(
  id: string,
  label: string,
  command: CliCommand,
  args: readonly string[],
  mode: Step['mode'],
  approval: Step['approval'],
  produces: string,
  completion: string,
): Step {
  const invocationEffect = cliInvocationNetworkEffect(command, args);
  if ((mode === 'network') !== (invocationEffect === 'network')) {
    throw new Error(`Investigation step ${id} does not match the registered network effect for ${command}.`);
  }
  return Object.freeze({ id, label, command, arguments: Object.freeze([...args]), mode, approval, produces, completion });
}

function boundedSubject(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 253 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError('Investigation-plan subject must be bounded text without control characters.');
  }
  return value.replace(/\s+/gu, ' ').trim();
}

function normalizedDomain(value: string): string | null {
  const candidate = domainToASCII(value.toLowerCase().replace(/\.$/u, ''));
  if (!candidate || candidate.length > 253 || !candidate.includes('.')) return null;
  return candidate.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
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
  const subject = recipe.requiresDomain ? normalizedDomain(suppliedSubject) : suppliedSubject.toLowerCase();
  if (!subject) throw new TypeError('This investigation-plan recipe requires one valid domain.');
  const generatedAt = normalizeExplicitIsoTimestamp(generatedAtValue);
  if (!generatedAt) throw new TypeError('Investigation-plan generation time must use an explicit timezone.');
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
