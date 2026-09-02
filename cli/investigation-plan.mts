import { domainToASCII } from 'node:url';
import { normalizeExplicitIsoTimestamp } from '../packages/evidence/observation.mts';
import {
  INVESTIGATION_PLAN_RECIPES,
  RUNNABLE_INVESTIGATION_PLAN_RECIPES,
  cliInvocationNetworkEffect,
  type CliCommand,
} from './command-reference.mts';

export const CLI_INVESTIGATION_PLAN_SCHEMA = 'whoisleuth.cli.investigation-plan';
export const CLI_INVESTIGATION_PLAN_VERSION = 1;
export const CLI_WORKFLOW_RECIPE_CATALOGUE_SCHEMA = 'whoisleuth.cli.workflow-recipe-catalogue';
export const CLI_WORKFLOW_RECIPE_CATALOGUE_VERSION = 1;
export { INVESTIGATION_PLAN_RECIPES, RUNNABLE_INVESTIGATION_PLAN_RECIPES };
export type InvestigationPlanRecipe = typeof INVESTIGATION_PLAN_RECIPES[number];
export type RunnableInvestigationPlanRecipe = typeof RUNNABLE_INVESTIGATION_PLAN_RECIPES[number];

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
  id: InvestigationPlanRecipe;
  label: string;
  subjectRequirement: 'domain' | 'brand_or_domain' | 'review_label';
  objective: string;
  runnable: boolean;
  limitations: readonly string[];
  steps(subject: string): readonly Step[];
}>;

const RECIPES: Readonly<Record<InvestigationPlanRecipe, Recipe>> = Object.freeze({
  'domain-triage': Object.freeze({
    id: 'domain-triage',
    label: 'New domain triage',
    subjectRequirement: 'domain',
    objective: 'Collect and preserve separately attributed registration, DNS, HTTP, TLS, page, and network-context evidence.',
    runnable: true,
    limitations: Object.freeze([
      'Collection remains analyst-triggered and source limitations remain explicit.',
      'Disposition, reviewed response actions, monitoring, and closure continue in the browser-local Case workspace; this CLI recipe does not submit reports.',
    ]),
    steps: (domain: string) => Object.freeze([
      step('collect', 'Collect a Deep lookup', 'lookup', [domain, '--deep', '--json'], 'network', 'network_disclosure', 'whoisleuth.cli.lookup', 'Review source health and limitations before using missing fields.'),
      step('export', 'Create a portable evidence report', 'export', ['<saved-lookup.json>'], 'offline', 'analyst_selection', 'whoisleuth.lookup-evidence', 'Select the reviewed lookup file; the plan never guesses a path.'),
      step('verify', 'Verify the exported artefact', 'verify-artifact', ['<evidence.json>', '--json'], 'offline', 'analyst_selection', 'whoisleuth.offline-artifact-verification', 'Keep verification distinct from a claim that the observations are correct or current.'),
    ]),
  }),
  'lookalike-review': Object.freeze({
    id: 'lookalike-review',
    label: 'Lookalike candidate review',
    subjectRequirement: 'brand_or_domain',
    objective: 'Generate a bounded candidate queue, collect only the selected scope, and retain a reviewed candidate lookup.',
    runnable: true,
    limitations: Object.freeze([
      'Candidate generation does not establish registration, control, intent, or maliciousness.',
      'Official-reference collection and page comparison require analyst-selected saved evidence; use page-compare after retaining the reference and candidate observations.',
    ]),
    steps: (subject: string) => Object.freeze([
      step('generate', 'Generate candidates offline', 'discover', [subject, '--preset', 'all', '--json'], 'offline', 'none', 'whoisleuth.cli.discover', 'Review mutation families and suppressions before collection.'),
      step('scan', 'Collect a bounded candidate queue', 'discover-scan', [subject, '--fast', '--scan-limit', '50', '--json'], 'network', 'network_disclosure', 'whoisleuth.cli.discovery-scan', 'Fast collection is a triage boundary; partial or inconclusive authority evidence remains explicit.'),
      step('inspect', 'Deep-review one selected candidate', 'lookup', ['<selected-domain>', '--deep', '--json'], 'network', 'analyst_selection', 'whoisleuth.cli.lookup', 'Select a candidate deliberately; generation does not prove registration, control, intent, or maliciousness.'),
    ]),
  }),
  'owned-domain-review': Object.freeze({
    id: 'owned-domain-review',
    label: 'Owned domain posture review',
    subjectRequirement: 'domain',
    objective: 'Review current passive posture and compare supplied observations with an analyst-authored control manifest.',
    runnable: true,
    limitations: Object.freeze(['Use only for a domain the analyst owns or is authorised to review.']),
    steps: (domain: string) => Object.freeze([
      step('posture', 'Collect bounded DNS posture', 'posture', [domain, '--json'], 'network', 'network_disclosure', 'whoisleuth.cli.posture', 'Review mail profile and delegation evidence before interpreting missing records.'),
      step('lookup', 'Collect supporting Deep evidence', 'lookup', [domain, '--deep', '--json'], 'network', 'network_disclosure', 'whoisleuth.cli.lookup', 'Retain separately attributed registration, DNS, TLS, and page observations.'),
      step('manifest', 'Review the domain control manifest', 'domain-control', ['<review-input.json>', '--json'], 'offline', 'analyst_selection', 'whoisleuth.domain-control-review', 'Only complete supplied observations may produce drift.'),
    ]),
  }),
  'historical-comparison': Object.freeze({
    id: 'historical-comparison',
    label: 'Historical observation comparison',
    subjectRequirement: 'domain',
    objective: 'Collect a current observation and compare it with analyst-selected saved observations without merging source states.',
    runnable: true,
    limitations: Object.freeze(['A later observation does not retroactively refresh retained evidence.']),
    steps: (domain: string) => Object.freeze([
      step('current', 'Collect the current lookup', 'lookup', [domain, '--deep', '--json'], 'network', 'network_disclosure', 'whoisleuth.cli.lookup', 'A current request does not refresh or validate older provider-reported history.'),
      step('diff', 'Compare two selected observations', 'diff', ['<previous.json>', '<current.json>', '--json'], 'offline', 'analyst_selection', 'whoisleuth.cli.lookup-diff', 'Equal, different, conflicting, and unavailable evidence remain separate.'),
      step('timeline', 'Build a bounded local timeline', 'timeline', ['<oldest.json>', '<newer.json>', '<current.json>', '--json'], 'offline', 'analyst_selection', 'whoisleuth.cli.lookup-timeline', 'Choose two to twenty same-domain files in chronological scope.'),
    ]),
  }),
  'campaign-review': Object.freeze({
    id: 'campaign-review',
    label: 'Campaign candidate review',
    subjectRequirement: 'brand_or_domain',
    objective: 'Prepare a bounded candidate set, collect a deliberately selected queue, and review retained evidence without asserting campaign attribution.',
    runnable: false,
    limitations: Object.freeze(['Grouping candidates is analyst triage and does not prove common ownership, control, infrastructure, or intent.']),
    steps: (subject: string) => Object.freeze([
      step('prepare', 'Prepare candidates offline', 'discover', [subject, '--preset', 'all', '--json'], 'offline', 'none', 'whoisleuth.cli.discover', 'Review mutation families and bounded omissions before selecting a collection scope.'),
      step('collect', 'Collect the selected candidate queue', 'discover-scan', [subject, '--fast', '--scan-limit', '50', '--json'], 'network', 'network_disclosure', 'whoisleuth.cli.discovery-scan', 'Treat partial and inconclusive authority results as explicit outcomes.'),
      step('review', 'Review selected retained evidence', 'review-evidence', ['<selected-evidence.json>', '--json'], 'offline', 'analyst_selection', 'whoisleuth.cli.offline-evidence-review', 'Keep source observations separate and record any campaign grouping as analyst-authored.'),
    ]),
  }),
  'certificate-anomaly': Object.freeze({
    id: 'certificate-anomaly',
    label: 'Certificate anomaly review',
    subjectRequirement: 'domain',
    objective: 'Review bounded certificate observations alongside current source-qualified domain evidence without treating issuance as proof of control or intent.',
    runnable: false,
    limitations: Object.freeze(['Certificate observations are separately attributed and do not establish current service control.']),
    steps: (domain: string) => Object.freeze([
      step('search', 'Collect bounded certificate observations', 'ct-search', [domain, '--json'], 'network', 'network_disclosure', 'whoisleuth.cli.ct-search', 'Review source availability, truncation, and observation timing.'),
      step('intake', 'Normalise the selected observations', 'ct-intake', ['<certificate-events.json>', '--json'], 'offline', 'analyst_selection', 'whoisleuth.ct-event-batch', 'Only selected saved observations enter the offline intake.'),
      step('corroborate', 'Collect supporting domain evidence', 'lookup', [domain, '--deep', '--json'], 'network', 'network_disclosure', 'whoisleuth.cli.lookup', 'Compare evidence families without collapsing certificate and registration identities.'),
    ]),
  }),
  'registry-disagreement': Object.freeze({
    id: 'registry-disagreement',
    label: 'Registry disagreement review',
    subjectRequirement: 'domain',
    objective: 'Collect separately attributed registration evidence and review conflicting publications without selecting an arbitrary source as truth.',
    runnable: false,
    limitations: Object.freeze(['Only authority-aware registration evidence may decide availability; disagreement remains explicit.']),
    steps: (domain: string) => Object.freeze([
      step('collect', 'Collect source-qualified registration evidence', 'lookup', [domain, '--deep', '--json'], 'network', 'network_disclosure', 'whoisleuth.cli.lookup', 'Retain RDAP, registrar RDAP, WHOIS, and authority states separately.'),
      step('compare', 'Compare registry publications offline', 'compare', ['<saved-lookup.json>', '--json'], 'offline', 'analyst_selection', 'whoisleuth.cli.compare', 'Do not convert conflicting or unavailable publications into equivalence.'),
      step('report', 'Prepare a target-free source report', 'source-report', ['<saved-lookup.json>', '--json'], 'offline', 'analyst_selection', 'whoisleuth.source-reliability-report', 'The report describes source behaviour, not ownership, safety, or legal status.'),
    ]),
  }),
  'evidence-handoff': Object.freeze({
    id: 'evidence-handoff',
    label: 'Reviewed evidence handoff',
    subjectRequirement: 'review_label',
    objective: 'Verify, minimise, and package analyst-selected evidence for a deliberate handoff without transmitting or submitting it.',
    runnable: false,
    limitations: Object.freeze(['The recipe prepares local material only; sharing remains a separate deliberate action.']),
    steps: () => Object.freeze([
      step('verify', 'Verify the selected artefact', 'verify-artifact', ['<evidence.json>', '--json'], 'offline', 'analyst_selection', 'whoisleuth.offline-artifact-verification', 'Verification checks structure and integrity, not the truth or currency of observations.'),
      step('package', 'Build a reviewed public Case-pack', 'case-pack', ['<cases.json>', '--audience', 'public', '--reviewed', '--json'], 'offline', 'analyst_selection', 'whoisleuth.cli.case-pack', 'Review minimisation and audience projection before retaining the separate package.'),
      step('lint', 'Review deliberate-sharing metadata', 'sharing-review', ['<package.json>', '--marking', 'clear', '--recipient-scope', 'public', '--purpose', 'reviewed evidence handoff', '--human-reviewed', '--personal-data-reviewed', '--redactions-confirmed', '--json'], 'offline', 'analyst_selection', 'whoisleuth.cli.sharing-review', 'A clear lint result does not send, upload, publish, or authorise the artefact.'),
    ]),
  }),
  'planned-domain-change': Object.freeze({
    id: 'planned-domain-change',
    label: 'Planned domain change',
    subjectRequirement: 'domain',
    objective: 'Review an analyst-authored desired state and prepare bounded change material without changing DNS, registry, mail, or hosted configuration.',
    runnable: false,
    limitations: Object.freeze(['Planning and packaging never apply, submit, schedule, or enforce a change.']),
    steps: () => Object.freeze([
      step('control', 'Review the desired-state manifest', 'domain-control', ['<review-input.json>', '--json'], 'offline', 'analyst_selection', 'whoisleuth.domain-control-review', 'Only supplied complete observations may produce drift.'),
      step('assure', 'Review change and recovery assumptions', 'assurance', ['<assurance-input.json>', '--json'], 'offline', 'analyst_selection', 'whoisleuth.domain-assurance', 'Record uncertainty, rollback dependencies, and unavailable evidence explicitly.'),
      step('package', 'Build a reviewed change packet', 'change-packet', ['<change-packet-input.json>', '--json'], 'offline', 'analyst_selection', 'whoisleuth.domain-change-packet', 'The packet is local reviewed material and performs no submission or enforcement.'),
    ]),
  }),
  'post-change-verification': Object.freeze({
    id: 'post-change-verification',
    label: 'Post-change verification',
    subjectRequirement: 'domain',
    objective: 'Perform one explicit later observation and compare it with analyst-selected retained evidence after an authorised change.',
    runnable: false,
    limitations: Object.freeze(['This is a one-time recheck, not monitoring setup or proof that every resolver or service has converged.']),
    steps: () => Object.freeze([
      step('recheck', 'Run one bounded retained-manifest review', 'monitor-once', ['<manifest.json>', '--limit', '1', '--json'], 'network', 'network_disclosure', 'whoisleuth.domain-control-review', 'One later observation may remain partial, unavailable, stale, or conflicting.'),
      step('compare', 'Compare selected before and after evidence', 'diff', ['<before.json>', '<after.json>', '--json'], 'offline', 'analyst_selection', 'whoisleuth.cli.lookup-diff', 'Materiality is derived from compatible retained evidence and does not infer intent.'),
      step('record', 'Record reviewed completion material', 'change-packet', ['<post-change-input.json>', '--json'], 'offline', 'analyst_selection', 'whoisleuth.domain-change-packet', 'Recording reviewed material does not submit it or start automatic monitoring.'),
    ]),
  }),
});

export const INVESTIGATION_RECIPE_REGISTRY = RECIPES;

export const INVESTIGATION_PLAN_RECIPE_LABELS = Object.freeze(Object.fromEntries(
  INVESTIGATION_PLAN_RECIPES.map((recipe) => [recipe, RECIPES[recipe].label]),
)) as Readonly<Record<InvestigationPlanRecipe, string>>;

export function isRunnableInvestigationRecipe(value: InvestigationPlanRecipe): value is RunnableInvestigationPlanRecipe {
  return RUNNABLE_INVESTIGATION_PLAN_RECIPES.includes(value as RunnableInvestigationPlanRecipe);
}

function recipeCatalogueEntry(recipe: Recipe) {
  const exampleSubject = recipe.subjectRequirement === 'domain' ? 'example.test' : 'Example Organisation';
  const steps = recipe.steps(exampleSubject).map((item) => Object.freeze({
    id: item.id,
    label: item.label,
    command: item.command,
    exampleArguments: item.arguments,
    mode: item.mode,
    approval: item.approval,
    produces: item.produces,
    completion: item.completion,
  }));
  return Object.freeze({
    id: recipe.id,
    label: recipe.label,
    objective: recipe.objective,
    subjectRequirement: recipe.subjectRequirement,
    runnableByWorkflowRun: recipe.runnable,
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

export function formatWorkflowRecipeCatalogue(catalogue: ReturnType<typeof buildWorkflowRecipeCatalogue>): string {
  return [
    'WHOISleuth workflow recipes',
    '',
    ...catalogue.recipes.flatMap((recipe) => [
      `${recipe.id} — ${recipe.label}`,
      `  Subject: ${recipe.subjectRequirement.replaceAll('_', ' ')}`,
      `  Workflow run: ${recipe.runnableByWorkflowRun ? 'supported' : 'plan and explanation only'}`,
      `  ${recipe.objective}`,
      ...recipe.steps.map((item, index) => `  ${index + 1}. ${item.label} [${item.mode}; ${item.approval.replaceAll('_', ' ')}]`),
      ...recipe.limitations.map((item) => `  Limitation: ${item}`),
      '',
    ]),
    ...catalogue.limitations.map((item) => `Limitation: ${item}`),
    '',
  ].join('\n');
}

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
  const subject = recipe.subjectRequirement === 'domain' ? normalizedDomain(suppliedSubject) : suppliedSubject.toLowerCase();
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
