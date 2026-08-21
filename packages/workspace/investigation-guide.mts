import { normalizeDomain } from '../cases/case-model.mts';
import { parse } from 'tldts';
import { normalizeExplicitIsoTimestamp, normalizeLegacyIsoTimestamp } from '../evidence/observation.mts';

export const INVESTIGATION_GUIDE_SCHEMA = 'whoisleuth.investigation-recipe';
export const INVESTIGATION_GUIDE_VERSION = 5;
export const INVESTIGATION_GUIDE_LEGACY_VERSION = 1;
export const INVESTIGATION_GUIDE_EXPORT_VERSION = 4;
export const INVESTIGATION_GUIDE_SUPPORTED_VERSIONS = [2, 3, 4, INVESTIGATION_GUIDE_VERSION] as const;
export const INVESTIGATION_GUIDE_EXPORT_SCHEMA = 'whoisleuth.investigation-recipe-summary';
export const MAX_INVESTIGATION_GUIDE_DOMAIN_LENGTH = 253;
export const MAX_INVESTIGATION_GUIDE_REVIEW_DOMAINS = 25;
export const MAX_INVESTIGATION_GUIDE_REVIEW_NOTE_LENGTH = 500;
export const MAX_INVESTIGATION_GUIDE_TIMESTAMP_LENGTH = 64;
export const MAX_INVESTIGATION_GUIDE_SERIALIZED_BYTES = 12_288;
export const MAX_INVESTIGATION_GUIDE_EXPORT_BYTES = 16_384;

export type InvestigationRecipeId =
  | 'brand_sweep'
  | 'infrastructure_pivot'
  | 'new_domain_triage'
  | 'credential_impersonation_response'
  | 'mail_abuse_response'
  | 'domain_control_change_response';
export type InvestigationGuideStatus = 'active' | 'paused';
export type InvestigationGuideOutcome = 'pending' | 'complete' | 'partial' | 'skipped';
export type InvestigationWorkspaceId = 'brands' | 'discover' | 'bulk' | 'lookup' | 'monitor';

export interface InvestigationRecipeStage {
  id: string;
  workspace: InvestigationWorkspaceId;
  label: string;
  path: string;
  detail: string;
  expectedEvidence: string;
  requestImpact: string;
  prerequisite: string;
  completionCriteria: string;
  instructions: readonly string[];
  requiresApproval: boolean;
}

export interface InvestigationRecipe {
  id: InvestigationRecipeId;
  label: string;
  summary: string;
  targetLabel: string;
  stages: readonly InvestigationRecipeStage[];
}

export interface InvestigationGuideTemplateSnapshot {
  id: string;
  label: string;
  summary: string;
  recipeId: InvestigationRecipeId;
  stages: InvestigationRecipeStage[];
}

export interface InvestigationGuideStageProgress {
  id: string;
  outcome: InvestigationGuideOutcome;
  approvedAt: string | null;
  openedAt: string | null;
  reviewNote: string | null;
  updatedAt: string;
}

export interface InvestigationGuide {
  version: typeof INVESTIGATION_GUIDE_VERSION;
  recipeId: InvestigationRecipeId;
  template: InvestigationGuideTemplateSnapshot | null;
  domain: string;
  focusDomain: string | null;
  reviewDomains: string[];
  reviewDomainsTruncated: boolean;
  status: InvestigationGuideStatus;
  createdAt: string;
  updatedAt: string;
  stages: InvestigationGuideStageProgress[];
}

export interface InvestigationGuideSummary {
  schema: typeof INVESTIGATION_GUIDE_EXPORT_SCHEMA;
  version: typeof INVESTIGATION_GUIDE_EXPORT_VERSION;
  generatedAt: string;
  recipe: {
    id: InvestigationRecipeId;
    label: string;
  };
  template: {
    id: string;
    label: string;
  } | null;
  target: {
    type: 'domain';
    value: string;
  };
  status: InvestigationGuideStatus;
  createdAt: string;
  updatedAt: string;
  stages: Array<{
    id: string;
    workspace: InvestigationWorkspaceId;
    outcome: InvestigationGuideOutcome;
    approved: boolean;
    opened: boolean;
    reviewNote: string | null;
    updatedAt: string;
  }>;
  limitations: string[];
}

type UnknownRecord = Record<string, unknown>;

const CONTROL_RE = /[\x00-\x1f\x7f]/u;
const SAFE_TEMPLATE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/u;
const GUIDE_STATUSES = new Set<InvestigationGuideStatus>(['active', 'paused']);
const GUIDE_OUTCOMES = new Set<InvestigationGuideOutcome>(['pending', 'complete', 'partial', 'skipped']);
const PRE_RESPONSE_RECIPE_IDS = new Set<InvestigationRecipeId>(['brand_sweep', 'infrastructure_pivot', 'new_domain_triage']);

function stage(
  id: string,
  workspace: InvestigationWorkspaceId,
  label: string,
  detail: string,
  expectedEvidence: string,
  requestImpact: string,
  prerequisite: string,
  completionCriteria: string,
  instructions: readonly string[],
  requiresApproval: boolean,
): InvestigationRecipeStage {
  return Object.freeze({
    id,
    workspace,
    label,
    path: `/${workspace}`,
    detail,
    expectedEvidence,
    requestImpact,
    prerequisite,
    completionCriteria,
    instructions: Object.freeze([...instructions]),
    requiresApproval,
  });
}

function registrableGuideDomain(domain: string): string {
  return parse(domain).domain || domain;
}

function normalizeReviewDomains(values: unknown): { domains: string[]; truncated: boolean } {
  if (!Array.isArray(values)) return { domains: [], truncated: false };
  const domains: string[] = [];
  const seen = new Set<string>();
  let truncated = false;
  for (const value of values.slice(0, MAX_INVESTIGATION_GUIDE_REVIEW_DOMAINS + 1)) {
    const domain = normalizeInvestigationGuideDomain(value);
    if (!domain || seen.has(domain)) continue;
    if (domains.length >= MAX_INVESTIGATION_GUIDE_REVIEW_DOMAINS) {
      truncated = true;
      break;
    }
    seen.add(domain);
    domains.push(domain);
  }
  if (values.length > MAX_INVESTIGATION_GUIDE_REVIEW_DOMAINS + 1) truncated = true;
  return { domains, truncated };
}

export const INVESTIGATION_RECIPES: readonly InvestigationRecipe[] = Object.freeze([
  Object.freeze({
    id: 'brand_sweep',
    label: 'Brand sweep',
    summary: 'Define the official brand boundary, discover candidates, triage a bounded set, inspect priority domains, and retain reviewed cases.',
    targetLabel: 'Official domain',
    stages: Object.freeze([
      stage('brands', 'brands', 'Confirm brand profile', 'Review the official domain, allowlists, and brand context before generating candidates.', 'A bounded Brand Profile with the official domain and any reviewed allowlists.', 'Local-only. Opening Brands makes no analysis request.', 'Know the official domain and the brand boundary you intend to assess.', 'The relevant profile is reviewed, or this stage is explicitly skipped with the limitation understood.', ['Open the pre-filled profile form.', 'Add the brand name and any known trusted domains or registrars.', 'Save the profile, then mark this step reviewed.'], false),
      stage('discover', 'discover', 'Discover candidates', 'Generate bounded permutations and optionally query separately attributed Certificate Transparency observations.', 'A reviewed candidate set with mutation and discovery provenance.', 'Candidate generation is local. Certificate Transparency search is an explicit network action with its own bounded request budget.', 'Confirm the profile boundary and choose the candidate sources you intend to use.', 'Useful candidates are shortlisted, or the result is marked partial or skipped without implying absence.', ['Generate a bounded candidate set from the pre-filled registrable domain.', 'Remove irrelevant candidates and keep only domains worth checking.', 'Send the selected candidates to Bulk. The handoff records the reviewed set and completes this step.'], true),
      stage('bulk', 'bulk', 'Triage candidates', 'Scan only the candidate set you deliberately hand off and compare explainable domain signals.', 'Bounded fast or deep results with availability, source health, Risk factors, and relationship evidence.', 'Bulk collection makes one or more bounded analysis requests according to the selected depth and candidate count.', 'Review the handoff count, depth, and request implications before starting the scan.', 'Priority candidates are identified and incomplete sources remain visible, or the stage is marked partial.', ['Confirm the candidate queue came from Discover.', 'Choose Fast for registration triage or Deep for compact web and mail evidence.', 'Run the scan, review source limitations, then use Inspect on one priority row.'], true),
      stage('lookup', 'lookup', 'Inspect priority domain', 'Open a priority candidate for separately attributed deep evidence and source comparison.', 'Registry, registrar, DNS, certificate, HTTP, page-identity, and threat-source observations where supported.', 'Deep Lookup can contact several public services within explicit deadlines and response caps.', 'Choose one candidate based on the triage evidence rather than the score alone.', 'Material evidence and limitations are reviewed; a case may be created only by an explicit analyst action.', ['Choose Inspect in Lookup on a priority Bulk row.', 'Run a Deep lookup for that candidate.', 'Review the source states and evidence, then mark this step reviewed or partial.'], true),
      stage('monitor', 'monitor', 'Retain reviewed work', 'Create or update an analyst case and choose whether the domain belongs on a watchlist.', 'A bounded case timeline, analyst disposition, and optional compact monitoring baseline.', 'Local case work makes no request. A rescan or hosted-monitor change remains a separate explicit action.', 'Review evidence provenance and avoid converting a heuristic score into a verdict.', 'The analyst records the intended disposition or explicitly skips retention.', ['Open or create the pre-filled case for the inspected candidate.', 'Record an analyst disposition, notes, or follow-up only when supported by the evidence.', 'Mark this step reviewed when the retained record is useful.'], false),
    ]),
  }),
  Object.freeze({
    id: 'infrastructure_pivot',
    label: 'Infrastructure pivot',
    summary: 'Collect one domain, inspect explainable relationships, review connected evidence, and retain only defensible pivots.',
    targetLabel: 'Starting domain',
    stages: Object.freeze([
      stage('lookup', 'lookup', 'Collect starting evidence', 'Run a deliberate deep lookup for the starting domain before evaluating infrastructure links.', 'Separately attributed registry, DNS, certificate, HTTP, and page evidence for the starting domain.', 'Deep Lookup can contact several public services within explicit deadlines and response caps.', 'Confirm the starting domain is in scope and review the deep collection implications.', 'The lookup settles with success, partial, unsupported, or error states preserved.', ['Run the pre-filled lookup in Deep mode.', 'Review DNS, certificate, network, redirect, and page-identity evidence.', 'Mark the step reviewed, or partial if important sources did not settle.'], true),
      stage('bulk', 'bulk', 'Compare relationships', 'Use a bounded candidate set to inspect nameserver, IP, origin, favicon, tracker, and certificate relationships.', 'Explainable relationship rows with source observations, method, completeness, and truncation limits.', 'Bulk collection makes bounded analysis requests according to the selected candidate count and depth.', 'Prepare a focused candidate set; shared infrastructure alone is not proof of common control.', 'Useful pivots are reviewed with their limitations, or the stage is marked partial when sources are incomplete.', ['The starting domain is pre-filled. Add only domains that are plausible comparison peers.', 'Run a bounded scan and review the Relationships section below the table.', 'Treat shared infrastructure as a pivot, not attribution, then mark the step reviewed.'], true),
      stage('monitor', 'monitor', 'Retain defensible pivots', 'Review the bounded domain set carried from Bulk and attach only defensible pivots to cases or campaigns without asserting ownership.', 'A bounded review queue plus analyst cases or campaign membership linked to retained source evidence.', 'Local case and campaign edits make no request. Any rescan is a separate explicit action.', 'Keep directly observed relationships separate from analyst conclusions.', 'Only defensible pivots are retained, or retention is explicitly skipped.', ['Review the domains carried from Bulk and open only the cases you intend to retain.', 'Record only relationships you reviewed, including their limitations.', 'Mark this step reviewed, or skip it if nothing is defensible enough to retain.'], false),
    ]),
  }),
  Object.freeze({
    id: 'new_domain_triage',
    label: 'New-domain triage',
    summary: 'Collect a domain, compare it with a focused peer set when useful, and record a reviewable disposition.',
    targetLabel: 'Domain',
    stages: Object.freeze([
      stage('lookup', 'lookup', 'Collect domain evidence', 'Start with separately attributed registry and network evidence for the domain under review.', 'Authority-aware availability plus supported registry, DNS, certificate, HTTP, page, and threat-source observations.', 'Fast and deep Lookup have different request budgets. Collection starts only from the tool action you choose.', 'Confirm the domain is in scope and select the appropriate lookup depth.', 'Available evidence and explicit source failures are reviewed without treating a miss as safety.', ['Confirm the pre-filled domain and choose Fast or Deep.', 'Run the lookup and review source states before interpreting the result.', 'Mark the step reviewed, or partial if important evidence did not settle.'], true),
      stage('bulk', 'bulk', 'Compare focused peers', 'Optionally compare the domain with a small candidate set to expose relative signals and shared infrastructure.', 'Bounded peer results and relationship evidence with explainable factors.', 'Bulk makes bounded analysis requests according to candidate count and selected depth.', 'Use only a focused, relevant peer set; this stage may be skipped when comparison adds no value.', 'Relevant differences are reviewed, or the stage is marked skipped or partial with the reason retained outside this compact record.', ['The investigated domain is pre-filled. Add only relevant comparison domains.', 'Run a bounded scan and compare registration, activity, Risk factors, and relationships.', 'Mark the step reviewed, partial, or skip it when peer comparison adds no value.'], true),
      stage('monitor', 'monitor', 'Record disposition', 'Review the bounded domain set carried from Bulk and create or update only the cases that need an analyst decision or follow-up plan.', 'A bounded review queue plus case records with dispositions, notes, evidence history, and optional monitoring intent.', 'Local case editing makes no request. Rescans and hosted-monitor changes remain separate explicit actions.', 'Review source provenance, limitations, and any scoring explanation before deciding.', 'The analyst records the required dispositions or explicitly skips retention; the recipe never decides automatically.', ['Review the domains carried from Bulk and open only the cases that need retention.', 'Record a disposition and any concise evidence-based follow-up for each retained case.', 'Mark the step reviewed when the retained cases reflect your decision.'], false),
    ]),
  }),
  Object.freeze({
    id: 'credential_impersonation_response',
    label: 'Credential impersonation response',
    summary: 'Review observed impersonation evidence, confirm the affected brand boundary, and prepare a local response packet from explicitly recorded routes.',
    targetLabel: 'Domain under review',
    stages: Object.freeze([
      stage('lookup', 'lookup', 'Review impersonation evidence', 'Collect separately attributed deep evidence for the domain without treating visual or naming similarity as attribution.', 'Current registry, DNS, certificate, HTTP, page-identity, and source-health observations where supported.', 'Deep Lookup can contact several public services within explicit deadlines and response caps.', 'Confirm the target is in scope and do not enter a credential-bearing URL or secret.', 'Observed facts and missing sources are reviewed without making an ownership, intent, or harm conclusion.', ['Run the pre-filled Lookup in Deep mode.', 'Review exact page, redirect, certificate, and registration observations with their source states.', 'Create or update a Case only when the retained observations need reviewed follow-up.'], true),
      stage('brands', 'brands', 'Confirm affected brand boundary', 'Review the saved Brand Profile that defines official and allowlisted references; do not infer an association from similarity.', 'An analyst-selected Brand Profile boundary, or an explicit decision to continue without one.', 'Local-only. Opening Brands makes no analysis request.', 'Know which saved profile, if any, is relevant to the affected party.', 'The relevant profile boundary is reviewed, or the stage is marked partial or skipped without creating an association.', ['Open the saved Brand Profiles list.', 'Review the official references and allowlists for the affected party.', 'Return to the guide without adding a profile association unless you deliberately selected one in Monitor.'], false),
      stage('monitor', 'monitor', 'Prepare reviewed response', 'Open the Case response workspace, record only analyst-selected published recipient routes, and review packet preflight.', 'A Case action with recipient provenance and limitations plus an optional local draft packet that remains unsubmitted.', 'Local Case edits and packet generation make no request. WHOISleuth never sends the packet.', 'Retain supporting facts and reasoning before recording an external route; confirm the route manually.', 'The reviewed action and packet preflight are recorded, or the stage is partial or skipped without implying submission.', ['Open or create the pre-filled Case, then review its evidence and reasoning.', 'Record an analyst-selected published route with its source and limitations; do not claim it is reachable.', 'Open response preflight and prepare a local draft only if its required facts are complete.'], false),
    ]),
  }),
  Object.freeze({
    id: 'mail_abuse_response',
    label: 'Mail abuse response',
    summary: 'Review official mail posture and observed domain evidence before preparing a source-qualified, unsent response packet.',
    targetLabel: 'Domain under review',
    stages: Object.freeze([
      stage('brands', 'brands', 'Review official mail posture', 'Review the affected Brand Profile and retained mail posture without treating a missing control as proof of abuse.', 'Analyst-selected official-domain, mail, and Brand Profile context with explicit availability states.', 'Local-only unless the analyst separately starts a Brand posture refresh.', 'Identify the affected profile and distinguish official infrastructure from the domain under review.', 'Relevant retained posture is reviewed, or unavailable context is marked partial rather than absent.', ['Open the saved Brand Profiles list.', 'Review official MX, SPF, DMARC, and approved-domain context where retained.', 'Do not refresh or change a profile unless that separate action is necessary and approved.'], false),
      stage('lookup', 'lookup', 'Review domain and mail evidence', 'Collect current deep evidence for the domain and keep DNS, mail, registration, and page observations separately attributed.', 'Authority-aware availability plus bounded DNS, mail, TLS, HTTP, and page observations where supported.', 'Deep Lookup can contact several public services within explicit deadlines and response caps.', 'Confirm the domain is in scope; email content and mailbox data are outside this workflow.', 'Current observations and source failures are reviewed without claiming message origin, sender control, or maliciousness.', ['Run the pre-filled Lookup in Deep mode.', 'Review MX, SPF, DMARC, registration, certificate, HTTP, and page source states.', 'Retain only the evidence needed for a reviewed Case.'], true),
      stage('monitor', 'monitor', 'Prepare mail-abuse response', 'Record a reviewed recipient route and use Case packet preflight without sending or claiming delivery.', 'A bounded Case action and optional local response draft with exact recipient provenance and limitations.', 'Local Case edits and packet generation make no request. WHOISleuth never sends the packet.', 'Confirm the intended recipient and retain the observed facts and limitations that support review.', 'The current action state and packet preflight are recorded, or the stage remains partial without a delivery conclusion.', ['Open or create the pre-filled Case and review its retained evidence.', 'Record only a deliberately selected published route, its source, and known limitations.', 'Use the response preflight to prepare a local draft; submission remains a separate manual action recorded later.'], false),
    ]),
  }),
  Object.freeze({
    id: 'domain_control_change_response',
    label: 'Domain-control change response',
    summary: 'Review retained control posture and current authority-aware evidence before documenting a bounded internal or provider response.',
    targetLabel: 'Official domain',
    stages: Object.freeze([
      stage('brands', 'brands', 'Review retained control posture', 'Review the saved domain-control passport, posture matrix, and source limitations before interpreting a change.', 'Retained official-domain control observations with separately attributed registry, DNS, certificate, mail, and web states.', 'Local-only unless the analyst separately starts a posture refresh.', 'Confirm the domain belongs to the reviewed Brand Profile; a saved association is analyst-selected, not inferred.', 'The retained baseline and its completeness are understood, or the stage is partial when required context is unavailable.', ['Open the relevant saved Brand Profile.', 'Review the domain-control passport, portfolio matrix, and observation times.', 'Identify which source actually supports the suspected change and preserve unavailable states.'], false),
      stage('lookup', 'lookup', 'Confirm current domain evidence', 'Collect a deliberate deep Lookup so current authority-aware evidence remains distinct from the retained baseline.', 'Current registry, registrar, DNS, certificate, HTTP, and page observations with explicit source health.', 'Deep Lookup can contact several public services within explicit deadlines and response caps.', 'Confirm a fresh collection is necessary and review its request implications.', 'The current result is reviewed against the retained baseline without converting incomplete evidence into removal or compromise.', ['Run the pre-filled Lookup in Deep mode.', 'Compare current observations with the retained control evidence source by source.', 'Record only facts and limitations that need a Case response.'], true),
      stage('monitor', 'monitor', 'Document control-change response', 'Record an internal or provider action and review an optional response packet without automatic enforcement or submission.', 'A bounded Case action, due or follow-up dates, recipient provenance when external, and an optional unsubmitted packet.', 'Local Case edits and packet generation make no request. WHOISleuth never changes DNS, registrar, hosting, mail, or defensive systems.', 'Document supporting evidence and confirm any recipient route or internal owner manually.', 'The reviewed action state is recorded, or the stage is partial without a compromise, delivery, or remediation claim.', ['Open or create the pre-filled Case and retain the relevant comparison facts.', 'Record the internal owner or analyst-selected provider route, source, limitations, and follow-up dates.', 'Review packet preflight when a draft is useful; record submission or resolution only after it actually occurs.'], false),
    ]),
  }),
]);

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function timestamp(value: unknown, legacy = false): string {
  return normalizeExplicitIsoTimestamp(value)
    ?? (legacy ? normalizeLegacyIsoTimestamp(value) : null)
    ?? '';
}

function nullableTimestamp(value: unknown, legacy = false): string | null {
  if (value === null || value === undefined || value === '') return null;
  return timestamp(value, legacy) || null;
}

function boundedTemplateText(value: unknown, maximum: number, fallback = ''): string {
  if (typeof value !== 'string' || value.length > maximum * 4 || CONTROL_RE.test(value)) return fallback;
  return value.replace(/\s+/gu, ' ').trim().slice(0, maximum).trim() || fallback;
}

function boundedReviewNote(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_INVESTIGATION_GUIDE_REVIEW_NOTE_LENGTH * 4) return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  return normalized ? normalized.slice(0, MAX_INVESTIGATION_GUIDE_REVIEW_NOTE_LENGTH).trim() || null : null;
}

function templateInstructions(value: unknown, fallback: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) return fallback;
  const instructions = value
    .slice(0, 6)
    .map((item) => boundedTemplateText(item, 240))
    .filter(Boolean);
  return instructions.length ? instructions : fallback;
}

export function normalizeInvestigationGuideTemplateSnapshot(
  value: unknown,
  requiredRecipeId: InvestigationRecipeId | null = null,
): InvestigationGuideTemplateSnapshot | null {
  const input = record(value);
  const id = typeof input?.id === 'string' && SAFE_TEMPLATE_ID_RE.test(input.id) ? input.id : '';
  const recipe = investigationGuideRecipe(input?.recipeId);
  const label = boundedTemplateText(input?.label, 80);
  if (!id || !recipe || !label || (requiredRecipeId && recipe.id !== requiredRecipeId)) return null;
  const supplied = new Map<string, UnknownRecord>();
  for (const candidate of (Array.isArray(input?.stages) ? input.stages : []).slice(0, recipe.stages.length * 2)) {
    const item = record(candidate);
    if (item && typeof item.id === 'string' && !supplied.has(item.id)) supplied.set(item.id, item);
  }
  const stages = recipe.stages.flatMap((base) => {
    const item = supplied.get(base.id);
    if (!item || item.enabled === false) return [];
    return [{
      ...base,
      label: boundedTemplateText(item.label, 100, base.label),
      detail: boundedTemplateText(item.detail, 400, base.detail),
      expectedEvidence: boundedTemplateText(item.expectedEvidence, 500, base.expectedEvidence),
      completionCriteria: boundedTemplateText(item.completionCriteria, 500, base.completionCriteria),
      instructions: templateInstructions(item.instructions, base.instructions),
      requiresApproval: base.requiresApproval || item.requiresApproval === true,
    }];
  });
  if (!stages.length) return null;
  return {
    id,
    label,
    summary: boundedTemplateText(input?.summary, 400, recipe.summary),
    recipeId: recipe.id,
    stages,
  };
}

export function investigationGuideStagesForGuide(value: unknown): readonly InvestigationRecipeStage[] {
  const guide = record(value);
  const recipe = investigationGuideRecipe(guide?.recipeId);
  if (!recipe) return [];
  return normalizeInvestigationGuideTemplateSnapshot(guide?.template, recipe.id)?.stages || recipe.stages;
}

function investigationGuideStageForGuide(value: unknown, stageId: unknown): InvestigationRecipeStage | null {
  return typeof stageId === 'string'
    ? investigationGuideStagesForGuide(value).find((candidate) => candidate.id === stageId) || null
    : null;
}

export function investigationGuideStageForGuidePath(value: unknown, pathname: unknown): InvestigationRecipeStage | null {
  if (typeof pathname !== 'string') return null;
  return investigationGuideStagesForGuide(value)
    .find((candidate) => pathname === candidate.path || pathname.startsWith(`${candidate.path}/`)) || null;
}

function guideStatus(value: unknown): InvestigationGuideStatus {
  return typeof value === 'string' && GUIDE_STATUSES.has(value as InvestigationGuideStatus)
    ? value as InvestigationGuideStatus
    : 'active';
}

function guideOutcome(value: unknown): InvestigationGuideOutcome {
  return typeof value === 'string' && GUIDE_OUTCOMES.has(value as InvestigationGuideOutcome)
    ? value as InvestigationGuideOutcome
    : 'pending';
}

/**
 * The launcher accepts one bare DNS hostname only. Unlike evidence-import
 * normalization, it does not silently strip a URL, path, port, or userinfo.
 */
export function normalizeInvestigationGuideDomain(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_INVESTIGATION_GUIDE_DOMAIN_LENGTH
    || /[\x00-\x1f\x7f\s\\/%@:?#]/u.test(value)) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return normalizeDomain(trimmed);
}

export function investigationGuideRecipe(value: unknown): InvestigationRecipe | null {
  return typeof value === 'string'
    ? INVESTIGATION_RECIPES.find((recipe) => recipe.id === value) || null
    : null;
}

export function investigationGuideStagesForRecipe(value: unknown): readonly InvestigationRecipeStage[] {
  return investigationGuideRecipe(value)?.stages || [];
}

export function investigationGuideStage(value: unknown, recipeId: unknown = 'new_domain_triage'): InvestigationRecipeStage | null {
  return typeof value === 'string'
    ? investigationGuideStagesForRecipe(recipeId).find((candidate) => candidate.id === value) || null
    : null;
}

export function investigationGuideStageForPath(pathname: unknown, recipeId: unknown = 'new_domain_triage'): InvestigationRecipeStage | null {
  if (typeof pathname !== 'string') return null;
  return investigationGuideStagesForRecipe(recipeId)
    .find((candidate) => pathname === candidate.path || pathname.startsWith(`${candidate.path}/`)) || null;
}

export function investigationGuideHref(
  stageId: unknown,
  domain: unknown,
  recipeId: unknown = 'new_domain_triage',
  focusDomain: unknown = null,
): string {
  const stageDefinition = investigationGuideStage(stageId, recipeId);
  const normalized = normalizeInvestigationGuideDomain(domain);
  const normalizedFocus = normalizeInvestigationGuideDomain(focusDomain);
  if (!stageDefinition || !normalized) return '/dashboard';
  const workingDomain = normalizedFocus || normalized;
  if (stageDefinition.workspace === 'lookup') {
    if (recipeId === 'brand_sweep' && !normalizedFocus) return '/bulk#results';
    return `/lookup?q=${encodeURIComponent(workingDomain)}&depth=deep#query`;
  }
  if (stageDefinition.workspace === 'discover') return `/discover?q=${encodeURIComponent(registrableGuideDomain(normalized))}#discovery-seed`;
  if (stageDefinition.workspace === 'bulk') return `/bulk?investigation=${encodeURIComponent(normalized)}#domains`;
  if (stageDefinition.workspace === 'monitor') {
    const response = typeof recipeId === 'string' && recipeId.endsWith('_response') ? '&response=1' : '';
    return `/monitor?view=cases&investigation=1${response}&domain=${encodeURIComponent(workingDomain)}#case-review-queue`;
  }
  if (stageDefinition.workspace === 'brands') {
    return typeof recipeId === 'string' && recipeId.endsWith('_response')
      ? '/brands'
      : `/brands?new=1&domain=${encodeURIComponent(normalized)}#official-domains`;
  }
  return stageDefinition.path;
}

export function investigationGuideApprovedHref(guide: InvestigationGuide, stageId: unknown): string {
  const stageDefinition = investigationGuideStageForGuide(guide, stageId);
  if (!stageDefinition) return '/dashboard';
  if (stageDefinition.workspace === 'bulk'
    && guide.recipeId === 'brand_sweep'
    && guide.reviewDomains.length > 0) {
    return '/bulk?source=discover#domains';
  }
  return investigationGuideHref(stageDefinition.id, guide.domain, guide.recipeId, guide.focusDomain);
}

function createStageProgress(stageDefinition: InvestigationRecipeStage, now: string): InvestigationGuideStageProgress {
  return { id: stageDefinition.id, outcome: 'pending', approvedAt: null, openedAt: null, reviewNote: null, updatedAt: now };
}

export function createInvestigationGuide(
  domain: unknown,
  recipeId: unknown = 'new_domain_triage',
  now: unknown = new Date().toISOString(),
  templateValue: unknown = null,
): InvestigationGuide | null {
  const normalized = normalizeInvestigationGuideDomain(domain);
  const recipe = investigationGuideRecipe(recipeId);
  const createdAt = timestamp(now);
  if (!normalized || !recipe || !createdAt) return null;
  const template = templateValue === null || templateValue === undefined
    ? null
    : normalizeInvestigationGuideTemplateSnapshot(templateValue, recipe.id);
  if (templateValue !== null && templateValue !== undefined && !template) return null;
  const stages = template?.stages || recipe.stages;
  return {
    version: INVESTIGATION_GUIDE_VERSION,
    recipeId: recipe.id,
    template,
    domain: normalized,
    focusDomain: null,
    reviewDomains: recipe.id === 'brand_sweep' ? [] : [normalized],
    reviewDomainsTruncated: false,
    status: 'active',
    createdAt,
    updatedAt: createdAt,
    stages: stages.map((stageDefinition) => createStageProgress(stageDefinition, createdAt)),
  };
}

function parseLegacyGuide(input: UnknownRecord): InvestigationGuide | null {
  const domain = normalizeInvestigationGuideDomain(input.domain);
  const createdAt = timestamp(input.createdAt, true);
  const updatedAt = timestamp(input.updatedAt, true);
  const recipe = investigationGuideRecipe('new_domain_triage');
  if (!domain || !createdAt || !updatedAt || !recipe) return null;
  const opened = new Set(
    (Array.isArray(input.visitedStages) ? input.visitedStages : [])
      .slice(0, recipe.stages.length * 2)
      .filter((value): value is string => typeof value === 'string'),
  );
  return {
    version: INVESTIGATION_GUIDE_VERSION,
    recipeId: recipe.id,
    template: null,
    domain,
    focusDomain: null,
    reviewDomains: [domain],
    reviewDomainsTruncated: false,
    status: 'active',
    createdAt,
    updatedAt,
    stages: recipe.stages.map((stageDefinition) => ({
      ...createStageProgress(stageDefinition, updatedAt),
      openedAt: opened.has(stageDefinition.id) ? updatedAt : null,
    })),
  };
}

export function parseInvestigationGuide(value: unknown): InvestigationGuide | null {
  const input = record(value);
  if (!input) return null;
  if (input.version === INVESTIGATION_GUIDE_LEGACY_VERSION) return parseLegacyGuide(input);
  if (!INVESTIGATION_GUIDE_SUPPORTED_VERSIONS.includes(input.version as 2 | 3 | 4 | 5)) return null;
  const legacyTimestamps = input.version !== INVESTIGATION_GUIDE_VERSION;
  const recipe = investigationGuideRecipe(input.recipeId);
  const domain = normalizeInvestigationGuideDomain(input.domain);
  const createdAt = timestamp(input.createdAt, legacyTimestamps);
  const updatedAt = timestamp(input.updatedAt, legacyTimestamps);
  if (!recipe || !domain || !createdAt || !updatedAt
    || (input.version !== INVESTIGATION_GUIDE_VERSION && !PRE_RESPONSE_RECIPE_IDS.has(recipe.id))) return null;
  const supportsTemplate = input.version === 3 || input.version === 4 || input.version === INVESTIGATION_GUIDE_VERSION;
  const template = supportsTemplate && input.template !== null && input.template !== undefined
    ? normalizeInvestigationGuideTemplateSnapshot(input.template, recipe.id)
    : null;
  if (supportsTemplate && input.template !== null && input.template !== undefined && !template) return null;
  const stageDefinitions = template?.stages || recipe.stages;
  const normalizedReview = normalizeReviewDomains(input.reviewDomains);
  const reviewDomains = normalizedReview.domains.length
    ? normalizedReview.domains
    : recipe.id === 'brand_sweep' ? [] : [domain];

  const supplied = new Map<string, UnknownRecord>();
  for (const candidate of (Array.isArray(input.stages) ? input.stages : []).slice(0, stageDefinitions.length * 2)) {
    const item = record(candidate);
    if (item && typeof item.id === 'string' && !supplied.has(item.id)) supplied.set(item.id, item);
  }

  return {
    version: INVESTIGATION_GUIDE_VERSION,
    recipeId: recipe.id,
    template,
    domain,
    focusDomain: recipe.id === 'brand_sweep' ? normalizeInvestigationGuideDomain(input.focusDomain) || null : null,
    reviewDomains,
    reviewDomainsTruncated: normalizedReview.truncated || input.reviewDomainsTruncated === true,
    status: guideStatus(input.status),
    createdAt,
    updatedAt,
    stages: stageDefinitions.map((stageDefinition) => {
      const item = supplied.get(stageDefinition.id);
      return {
        id: stageDefinition.id,
        outcome: guideOutcome(item?.outcome),
        approvedAt: nullableTimestamp(item?.approvedAt, legacyTimestamps),
        openedAt: nullableTimestamp(item?.openedAt, legacyTimestamps),
        reviewNote: input.version === 4 || input.version === INVESTIGATION_GUIDE_VERSION
          ? boundedReviewNote(item?.reviewNote)
          : null,
        updatedAt: timestamp(item?.updatedAt, legacyTimestamps) || updatedAt,
      };
    }),
  };
}

export function setInvestigationGuideFocusDomain(
  value: unknown,
  domain: unknown,
  now: unknown = new Date().toISOString(),
): InvestigationGuide | null {
  const guide = parseInvestigationGuide(value);
  const focusDomain = normalizeInvestigationGuideDomain(domain);
  const updatedAt = timestamp(now);
  if (!guide || guide.recipeId !== 'brand_sweep' || !focusDomain || !updatedAt || guide.status === 'paused') return guide;
  if (guide.focusDomain === focusDomain) return guide;
  return { ...guide, focusDomain, updatedAt };
}

export function setInvestigationGuideReviewDomains(
  value: unknown,
  domains: unknown,
  now: unknown = new Date().toISOString(),
): InvestigationGuide | null {
  const guide = parseInvestigationGuide(value);
  const updatedAt = timestamp(now);
  if (!guide || !updatedAt || guide.status === 'paused') return guide;
  const reviewDomains = Array.isArray(domains) ? domains : [];
  const normalized = normalizeReviewDomains(guide.recipeId === 'brand_sweep'
    ? reviewDomains
    : [guide.domain, ...reviewDomains]);
  const reviewDomainsTruncated = normalized.truncated;
  if (
    guide.reviewDomainsTruncated === reviewDomainsTruncated
    && guide.reviewDomains.length === normalized.domains.length
    && guide.reviewDomains.every((domain, index) => domain === normalized.domains[index])
  ) return guide;
  return { ...guide, reviewDomains: normalized.domains, reviewDomainsTruncated, updatedAt };
}

function updateStage(
  value: unknown,
  stageId: unknown,
  now: unknown,
  updater: (progress: InvestigationGuideStageProgress, updatedAt: string) => InvestigationGuideStageProgress,
): InvestigationGuide | null {
  const guide = parseInvestigationGuide(value);
  const updatedAt = timestamp(now);
  const stageDefinition = investigationGuideStageForGuide(guide, stageId);
  if (!guide || !updatedAt || !stageDefinition) return guide;
  return {
    ...guide,
    updatedAt,
    stages: guide.stages.map((progress) => progress.id === stageDefinition.id ? updater(progress, updatedAt) : progress),
  };
}

export function visitInvestigationGuide(value: unknown, pathname: unknown, now: unknown = new Date().toISOString()): InvestigationGuide | null {
  const guide = parseInvestigationGuide(value);
  const stageDefinition = investigationGuideStageForGuidePath(guide, pathname);
  if (!guide || guide.status === 'paused' || !stageDefinition) return guide;
  const progress = guide.stages.find((item) => item.id === stageDefinition.id);
  if (stageDefinition.requiresApproval && !progress?.approvedAt) return guide;
  if (progress?.openedAt) return guide;
  return updateStage(guide, stageDefinition.id, now, (current, updatedAt) => ({ ...current, openedAt: updatedAt, updatedAt }));
}

export function approveInvestigationGuideStage(value: unknown, stageId: unknown, now: unknown = new Date().toISOString()): InvestigationGuide | null {
  const guide = parseInvestigationGuide(value);
  const stageDefinition = investigationGuideStageForGuide(guide, stageId);
  if (!guide || guide.status === 'paused' || !stageDefinition?.requiresApproval) return guide;
  const progress = guide.stages.find((item) => item.id === stageDefinition.id);
  if (progress?.approvedAt) return guide;
  return updateStage(guide, stageDefinition.id, now, (current, updatedAt) => ({ ...current, approvedAt: updatedAt, updatedAt }));
}

export function setInvestigationGuideStageOutcome(
  value: unknown,
  stageId: unknown,
  outcome: unknown,
  now: unknown = new Date().toISOString(),
  reviewNote: unknown = null,
): InvestigationGuide | null {
  const guide = parseInvestigationGuide(value);
  const normalizedOutcome = guideOutcome(outcome);
  const normalizedReviewNote = boundedReviewNote(reviewNote);
  const stageDefinition = investigationGuideStageForGuide(guide, stageId);
  if (!guide || guide.status === 'paused' || !stageDefinition) return guide;
  const progress = guide.stages.find((item) => item.id === stageDefinition.id);
  if (!progress || ((normalizedOutcome === 'complete' || normalizedOutcome === 'partial') && !progress.openedAt)) return guide;
  if ((normalizedOutcome === 'partial' || normalizedOutcome === 'skipped') && !normalizedReviewNote) return guide;
  const nextReviewNote = normalizedOutcome === 'pending' ? null : normalizedReviewNote;
  if (progress.outcome === normalizedOutcome && progress.reviewNote === nextReviewNote) return guide;
  return updateStage(guide, stageDefinition.id, now, (current, updatedAt) => ({
    ...current,
    outcome: normalizedOutcome,
    reviewNote: nextReviewNote,
    updatedAt,
  }));
}

export function setInvestigationGuideStatus(
  value: unknown,
  status: unknown,
  now: unknown = new Date().toISOString(),
): InvestigationGuide | null {
  const guide = parseInvestigationGuide(value);
  const updatedAt = timestamp(now);
  if (!guide || !updatedAt || typeof status !== 'string' || !GUIDE_STATUSES.has(status as InvestigationGuideStatus)) return guide;
  if (guide.status === status) return guide;
  return { ...guide, status: status as InvestigationGuideStatus, updatedAt };
}

export function restartInvestigationGuide(value: unknown, now: unknown = new Date().toISOString()): InvestigationGuide | null {
  const guide = parseInvestigationGuide(value);
  return guide ? createInvestigationGuide(guide.domain, guide.recipeId, now, guide.template) : null;
}

export function buildInvestigationGuideSummary(
  value: unknown,
  generatedAt: unknown = new Date().toISOString(),
): InvestigationGuideSummary | null {
  const guide = parseInvestigationGuide(value);
  const recipe = investigationGuideRecipe(guide?.recipeId);
  const normalizedGeneratedAt = timestamp(generatedAt);
  if (!guide || !recipe || !normalizedGeneratedAt) return null;
  const stages: InvestigationGuideSummary['stages'] = [];
  for (const stageDefinition of investigationGuideStagesForGuide(guide)) {
    const progress = guide.stages.find((candidate) => candidate.id === stageDefinition.id);
    if (!progress) return null;
    stages.push({
      id: stageDefinition.id,
      workspace: stageDefinition.workspace,
      outcome: progress.outcome,
      approved: progress.approvedAt !== null,
      opened: progress.openedAt !== null,
      reviewNote: progress.reviewNote,
      updatedAt: progress.updatedAt,
    });
  }
  return {
    schema: INVESTIGATION_GUIDE_EXPORT_SCHEMA,
    version: INVESTIGATION_GUIDE_EXPORT_VERSION,
    generatedAt: normalizedGeneratedAt,
    recipe: { id: recipe.id, label: recipe.label },
    template: guide.template ? { id: guide.template.id, label: guide.template.label } : null,
    target: { type: 'domain', value: guide.domain },
    status: guide.status,
    createdAt: guide.createdAt,
    updatedAt: guide.updatedAt,
    stages,
    limitations: [
      'This compact summary records analyst-controlled recipe progress and bounded stage-review notes only. It contains no raw evidence, case notes, credentials, provider responses, or scan results.',
      'Opened, approved, complete, partial, and skipped states are analyst workflow markers, not findings or claims about the target.',
      'The recipe never starts collection, submits a target, exports evidence, or changes a case disposition automatically.',
    ],
  };
}

export function investigationGuideSummaryFilename(value: unknown, generatedAt: unknown = new Date().toISOString()): string {
  const guide = parseInvestigationGuide(value);
  const normalizedGeneratedAt = timestamp(generatedAt);
  if (!guide || !normalizedGeneratedAt) return 'whoisleuth-investigation-recipe.json';
  const safeDomain = guide.domain.replace(/[^a-z0-9.-]+/giu, '-').replace(/\.{2,}/gu, '.').slice(0, 120) || 'domain';
  return `whoisleuth-recipe-${safeDomain}-${normalizedGeneratedAt.replace(/[:.]/gu, '-')}.json`;
}
