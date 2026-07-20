import { normalizeDomain } from './case-model.js';

export const INVESTIGATION_GUIDE_SCHEMA = 'whoisleuth.investigation-recipe';
export const INVESTIGATION_GUIDE_VERSION = 2;
export const INVESTIGATION_GUIDE_LEGACY_VERSION = 1;
export const INVESTIGATION_GUIDE_EXPORT_SCHEMA = 'whoisleuth.investigation-recipe-summary';
export const INVESTIGATION_GUIDE_EXPORT_VERSION = 1;
export const MAX_INVESTIGATION_GUIDE_DOMAIN_LENGTH = 253;
export const MAX_INVESTIGATION_GUIDE_TIMESTAMP_LENGTH = 64;
export const MAX_INVESTIGATION_GUIDE_SERIALIZED_BYTES = 12_288;
export const MAX_INVESTIGATION_GUIDE_EXPORT_BYTES = 16_384;

export type InvestigationRecipeId = 'brand_sweep' | 'infrastructure_pivot' | 'new_domain_triage';
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
  requiresApproval: boolean;
}

export interface InvestigationRecipe {
  id: InvestigationRecipeId;
  label: string;
  summary: string;
  targetLabel: string;
  stages: readonly InvestigationRecipeStage[];
}

export interface InvestigationGuideStageProgress {
  id: string;
  outcome: InvestigationGuideOutcome;
  approvedAt: string | null;
  openedAt: string | null;
  updatedAt: string;
}

export interface InvestigationGuide {
  version: typeof INVESTIGATION_GUIDE_VERSION;
  recipeId: InvestigationRecipeId;
  domain: string;
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
    updatedAt: string;
  }>;
  limitations: string[];
}

type UnknownRecord = Record<string, unknown>;

const CONTROL_RE = /[\x00-\x1f\x7f]/u;
const GUIDE_STATUSES = new Set<InvestigationGuideStatus>(['active', 'paused']);
const GUIDE_OUTCOMES = new Set<InvestigationGuideOutcome>(['pending', 'complete', 'partial', 'skipped']);

function stage(
  id: string,
  workspace: InvestigationWorkspaceId,
  label: string,
  detail: string,
  expectedEvidence: string,
  requestImpact: string,
  prerequisite: string,
  completionCriteria: string,
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
    requiresApproval,
  });
}

export const INVESTIGATION_RECIPES: readonly InvestigationRecipe[] = Object.freeze([
  Object.freeze({
    id: 'brand_sweep',
    label: 'Brand sweep',
    summary: 'Define the official brand boundary, discover candidates, triage a bounded set, inspect priority domains, and retain reviewed cases.',
    targetLabel: 'Official domain',
    stages: Object.freeze([
      stage('brands', 'brands', 'Confirm brand profile', 'Review the official domain, allowlists, and brand context before generating candidates.', 'A bounded Brand Profile with the official domain and any reviewed allowlists.', 'Local-only. Opening Brands makes no analysis request.', 'Know the official domain and the brand boundary you intend to assess.', 'The relevant profile is reviewed, or this stage is explicitly skipped with the limitation understood.', false),
      stage('discover', 'discover', 'Discover candidates', 'Generate bounded permutations and optionally query separately attributed Certificate Transparency observations.', 'A reviewed candidate set with mutation and discovery provenance.', 'Candidate generation is local. Certificate Transparency search is an explicit network action with its own bounded request budget.', 'Confirm the profile boundary and choose the candidate sources you intend to use.', 'Useful candidates are shortlisted, or the result is marked partial or skipped without implying absence.', true),
      stage('bulk', 'bulk', 'Triage candidates', 'Scan only the candidate set you deliberately hand off and compare explainable domain signals.', 'Bounded fast or deep results with availability, source health, Risk factors, and relationship evidence.', 'Bulk collection makes one or more bounded analysis requests according to the selected depth and candidate count.', 'Review the handoff count, depth, and request implications before starting the scan.', 'Priority candidates are identified and incomplete sources remain visible, or the stage is marked partial.', true),
      stage('lookup', 'lookup', 'Inspect priority domain', 'Open a priority candidate for separately attributed deep evidence and source comparison.', 'Registry, registrar, DNS, certificate, HTTP, page-identity, and threat-source observations where supported.', 'Deep Lookup can contact several public services within explicit deadlines and response caps.', 'Choose one candidate based on the triage evidence rather than the score alone.', 'Material evidence and limitations are reviewed; a case may be created only by an explicit analyst action.', true),
      stage('monitor', 'monitor', 'Retain reviewed work', 'Create or update an analyst case and choose whether the domain belongs on a watchlist.', 'A bounded case timeline, analyst disposition, and optional compact monitoring baseline.', 'Local case work makes no request. A rescan or hosted-monitor change remains a separate explicit action.', 'Review evidence provenance and avoid converting a heuristic score into a verdict.', 'The analyst records the intended disposition or explicitly skips retention.', false),
    ]),
  }),
  Object.freeze({
    id: 'infrastructure_pivot',
    label: 'Infrastructure pivot',
    summary: 'Collect one domain, inspect explainable relationships, review connected evidence, and retain only defensible pivots.',
    targetLabel: 'Starting domain',
    stages: Object.freeze([
      stage('lookup', 'lookup', 'Collect starting evidence', 'Run a deliberate deep lookup for the starting domain before evaluating infrastructure links.', 'Separately attributed registry, DNS, certificate, HTTP, and page evidence for the starting domain.', 'Deep Lookup can contact several public services within explicit deadlines and response caps.', 'Confirm the starting domain is in scope and review the deep collection implications.', 'The lookup settles with success, partial, unsupported, or error states preserved.', true),
      stage('bulk', 'bulk', 'Compare relationships', 'Use a bounded candidate set to inspect nameserver, IP, origin, favicon, tracker, and certificate relationships.', 'Explainable relationship rows with source observations, method, completeness, and truncation limits.', 'Bulk collection makes bounded analysis requests according to the selected candidate count and depth.', 'Prepare a focused candidate set; shared infrastructure alone is not proof of common control.', 'Useful pivots are reviewed with their limitations, or the stage is marked partial when sources are incomplete.', true),
      stage('monitor', 'monitor', 'Retain defensible pivots', 'Attach reviewed domains and relationship context to cases or campaigns without asserting ownership.', 'Bounded analyst cases or campaign membership linked to the retained source evidence.', 'Local case and campaign edits make no request. Any rescan is a separate explicit action.', 'Keep directly observed relationships separate from analyst conclusions.', 'Only defensible pivots are retained, or retention is explicitly skipped.', false),
    ]),
  }),
  Object.freeze({
    id: 'new_domain_triage',
    label: 'New-domain triage',
    summary: 'Collect a domain, compare it with a focused peer set when useful, and record a reviewable disposition.',
    targetLabel: 'Domain',
    stages: Object.freeze([
      stage('lookup', 'lookup', 'Collect domain evidence', 'Start with separately attributed registry and network evidence for the domain under review.', 'Authority-aware availability plus supported registry, DNS, certificate, HTTP, page, and threat-source observations.', 'Fast and deep Lookup have different request budgets. Collection starts only from the workspace action you choose.', 'Confirm the domain is in scope and select the appropriate lookup depth.', 'Available evidence and explicit source failures are reviewed without treating a miss as safety.', true),
      stage('bulk', 'bulk', 'Compare focused peers', 'Optionally compare the domain with a small candidate set to expose relative signals and shared infrastructure.', 'Bounded peer results and relationship evidence with explainable factors.', 'Bulk makes bounded analysis requests according to candidate count and selected depth.', 'Use only a focused, relevant peer set; this stage may be skipped when comparison adds no value.', 'Relevant differences are reviewed, or the stage is marked skipped or partial with the reason retained outside this compact record.', true),
      stage('monitor', 'monitor', 'Record disposition', 'Create or update a case with the analyst decision and optional follow-up plan.', 'A bounded case record with disposition, notes, evidence history, and optional monitoring intent.', 'Local case editing makes no request. Rescans and hosted-monitor changes remain separate explicit actions.', 'Review source provenance, limitations, and any scoring explanation before deciding.', 'The analyst records a disposition or explicitly skips retention; the recipe never decides automatically.', false),
    ]),
  }),
]);

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_INVESTIGATION_GUIDE_TIMESTAMP_LENGTH || CONTROL_RE.test(value)) return '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function nullableTimestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return timestamp(value) || null;
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

export function investigationGuideHref(stageId: unknown, domain: unknown, recipeId: unknown = 'new_domain_triage'): string {
  const stageDefinition = investigationGuideStage(stageId, recipeId);
  const normalized = normalizeInvestigationGuideDomain(domain);
  if (!stageDefinition || !normalized) return '/dashboard';
  if (stageDefinition.workspace === 'lookup' || stageDefinition.workspace === 'discover') {
    return `${stageDefinition.path}?q=${encodeURIComponent(normalized)}`;
  }
  if (stageDefinition.workspace === 'monitor') return '/monitor?view=cases';
  return stageDefinition.path;
}

function createStageProgress(stageDefinition: InvestigationRecipeStage, now: string): InvestigationGuideStageProgress {
  return { id: stageDefinition.id, outcome: 'pending', approvedAt: null, openedAt: null, updatedAt: now };
}

export function createInvestigationGuide(
  domain: unknown,
  recipeId: unknown = 'new_domain_triage',
  now: unknown = new Date().toISOString(),
): InvestigationGuide | null {
  const normalized = normalizeInvestigationGuideDomain(domain);
  const recipe = investigationGuideRecipe(recipeId);
  const createdAt = timestamp(now);
  if (!normalized || !recipe || !createdAt) return null;
  return {
    version: INVESTIGATION_GUIDE_VERSION,
    recipeId: recipe.id,
    domain: normalized,
    status: 'active',
    createdAt,
    updatedAt: createdAt,
    stages: recipe.stages.map((stageDefinition) => createStageProgress(stageDefinition, createdAt)),
  };
}

function parseLegacyGuide(input: UnknownRecord): InvestigationGuide | null {
  const domain = normalizeInvestigationGuideDomain(input.domain);
  const createdAt = timestamp(input.createdAt);
  const updatedAt = timestamp(input.updatedAt);
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
    domain,
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
  if (input.version !== INVESTIGATION_GUIDE_VERSION) return null;
  const recipe = investigationGuideRecipe(input.recipeId);
  const domain = normalizeInvestigationGuideDomain(input.domain);
  const createdAt = timestamp(input.createdAt);
  const updatedAt = timestamp(input.updatedAt);
  if (!recipe || !domain || !createdAt || !updatedAt) return null;

  const supplied = new Map<string, UnknownRecord>();
  for (const candidate of (Array.isArray(input.stages) ? input.stages : []).slice(0, recipe.stages.length * 2)) {
    const item = record(candidate);
    if (item && typeof item.id === 'string' && !supplied.has(item.id)) supplied.set(item.id, item);
  }

  return {
    version: INVESTIGATION_GUIDE_VERSION,
    recipeId: recipe.id,
    domain,
    status: guideStatus(input.status),
    createdAt,
    updatedAt,
    stages: recipe.stages.map((stageDefinition) => {
      const item = supplied.get(stageDefinition.id);
      return {
        id: stageDefinition.id,
        outcome: guideOutcome(item?.outcome),
        approvedAt: nullableTimestamp(item?.approvedAt),
        openedAt: nullableTimestamp(item?.openedAt),
        updatedAt: timestamp(item?.updatedAt) || updatedAt,
      };
    }),
  };
}

function updateStage(
  value: unknown,
  stageId: unknown,
  now: unknown,
  updater: (progress: InvestigationGuideStageProgress, updatedAt: string) => InvestigationGuideStageProgress,
): InvestigationGuide | null {
  const guide = parseInvestigationGuide(value);
  const updatedAt = timestamp(now);
  const stageDefinition = investigationGuideStage(stageId, guide?.recipeId);
  if (!guide || !updatedAt || !stageDefinition) return guide;
  return {
    ...guide,
    updatedAt,
    stages: guide.stages.map((progress) => progress.id === stageDefinition.id ? updater(progress, updatedAt) : progress),
  };
}

export function visitInvestigationGuide(value: unknown, pathname: unknown, now: unknown = new Date().toISOString()): InvestigationGuide | null {
  const guide = parseInvestigationGuide(value);
  const stageDefinition = investigationGuideStageForPath(pathname, guide?.recipeId);
  if (!guide || guide.status === 'paused' || !stageDefinition) return guide;
  const progress = guide.stages.find((item) => item.id === stageDefinition.id);
  if (stageDefinition.requiresApproval && !progress?.approvedAt) return guide;
  if (progress?.openedAt) return guide;
  return updateStage(guide, stageDefinition.id, now, (current, updatedAt) => ({ ...current, openedAt: updatedAt, updatedAt }));
}

export function approveInvestigationGuideStage(value: unknown, stageId: unknown, now: unknown = new Date().toISOString()): InvestigationGuide | null {
  const guide = parseInvestigationGuide(value);
  const stageDefinition = investigationGuideStage(stageId, guide?.recipeId);
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
): InvestigationGuide | null {
  const guide = parseInvestigationGuide(value);
  const normalizedOutcome = guideOutcome(outcome);
  const stageDefinition = investigationGuideStage(stageId, guide?.recipeId);
  if (!guide || guide.status === 'paused' || !stageDefinition) return guide;
  const progress = guide.stages.find((item) => item.id === stageDefinition.id);
  if (!progress || ((normalizedOutcome === 'complete' || normalizedOutcome === 'partial') && !progress.openedAt)) return guide;
  if (progress.outcome === normalizedOutcome) return guide;
  return updateStage(guide, stageDefinition.id, now, (current, updatedAt) => ({ ...current, outcome: normalizedOutcome, updatedAt }));
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
  return guide ? createInvestigationGuide(guide.domain, guide.recipeId, now) : null;
}

export function buildInvestigationGuideSummary(
  value: unknown,
  generatedAt: unknown = new Date().toISOString(),
): InvestigationGuideSummary | null {
  const guide = parseInvestigationGuide(value);
  const recipe = investigationGuideRecipe(guide?.recipeId);
  const normalizedGeneratedAt = timestamp(generatedAt);
  if (!guide || !recipe || !normalizedGeneratedAt) return null;
  return {
    schema: INVESTIGATION_GUIDE_EXPORT_SCHEMA,
    version: INVESTIGATION_GUIDE_EXPORT_VERSION,
    generatedAt: normalizedGeneratedAt,
    recipe: { id: recipe.id, label: recipe.label },
    target: { type: 'domain', value: guide.domain },
    status: guide.status,
    createdAt: guide.createdAt,
    updatedAt: guide.updatedAt,
    stages: recipe.stages.map((stageDefinition) => {
      const progress = guide.stages.find((candidate) => candidate.id === stageDefinition.id)!;
      return {
        id: stageDefinition.id,
        workspace: stageDefinition.workspace,
        outcome: progress.outcome,
        approved: progress.approvedAt !== null,
        opened: progress.openedAt !== null,
        updatedAt: progress.updatedAt,
      };
    }),
    limitations: [
      'This compact summary records analyst-controlled recipe progress only. It contains no raw evidence, notes, credentials, provider responses, or scan results.',
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
