import { normalizeDomain } from './case-model.js';

export const INVESTIGATION_GUIDE_VERSION = 1;
export const MAX_INVESTIGATION_GUIDE_DOMAIN_LENGTH = 253;
export const MAX_INVESTIGATION_GUIDE_TIMESTAMP_LENGTH = 64;

export const INVESTIGATION_GUIDE_STAGES = Object.freeze([
  Object.freeze({ id: 'lookup', label: 'Lookup', path: '/lookup', detail: 'Collect separately attributed domain evidence.' }),
  Object.freeze({ id: 'discover', label: 'Discover', path: '/discover', detail: 'Generate and select related candidates.' }),
  Object.freeze({ id: 'bulk', label: 'Bulk', path: '/bulk', detail: 'Triage the selected candidate set.' }),
  Object.freeze({ id: 'monitor', label: 'Monitor', path: '/monitor', detail: 'Retain reviewed cases and follow-up context.' }),
]);

/** @type {Set<string>} */
const STAGE_IDS = new Set(INVESTIGATION_GUIDE_STAGES.map((stage) => stage.id));

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function timestamp(value) {
  if (typeof value !== 'string' || value.length > MAX_INVESTIGATION_GUIDE_TIMESTAMP_LENGTH
    || /[\x00-\x1f\x7f]/u.test(value)) return '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

/**
 * The launcher accepts one bare DNS hostname only. Unlike evidence-import
 * normalization, it does not silently strip a URL, path, port, or userinfo.
 * @param {unknown} value
 */
export function normalizeInvestigationGuideDomain(value) {
  if (typeof value !== 'string' || value.length > MAX_INVESTIGATION_GUIDE_DOMAIN_LENGTH
    || /[\x00-\x1f\x7f\s\\/%@:?#]/u.test(value)) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return normalizeDomain(trimmed);
}

/** @param {unknown} value */
export function investigationGuideStage(value) {
  return typeof value === 'string' && STAGE_IDS.has(value)
    ? INVESTIGATION_GUIDE_STAGES.find((stage) => stage.id === value) || null
    : null;
}

/** @param {unknown} pathname */
export function investigationGuideStageForPath(pathname) {
  if (typeof pathname !== 'string') return null;
  return INVESTIGATION_GUIDE_STAGES.find((stage) => pathname === stage.path || pathname.startsWith(`${stage.path}/`)) || null;
}

/** @param {unknown} stageId @param {unknown} domain */
export function investigationGuideHref(stageId, domain) {
  const stage = investigationGuideStage(stageId);
  const normalized = normalizeInvestigationGuideDomain(domain);
  if (!stage || !normalized) return '/dashboard';
  if (stage.id === 'lookup' || stage.id === 'discover') return `${stage.path}?q=${encodeURIComponent(normalized)}`;
  if (stage.id === 'monitor') return '/monitor?view=cases';
  return stage.path;
}

/** @param {unknown} domain @param {unknown} now */
export function createInvestigationGuide(domain, now = new Date().toISOString()) {
  const normalized = normalizeInvestigationGuideDomain(domain);
  const createdAt = timestamp(now);
  if (!normalized || !createdAt) return null;
  return {
    version: INVESTIGATION_GUIDE_VERSION,
    domain: normalized,
    createdAt,
    updatedAt: createdAt,
    visitedStages: [],
  };
}

/** @param {unknown} value */
export function parseInvestigationGuide(value) {
  const input = record(value);
  if (!input || input.version !== INVESTIGATION_GUIDE_VERSION) return null;
  const domain = normalizeInvestigationGuideDomain(input.domain);
  const createdAt = timestamp(input.createdAt);
  const updatedAt = timestamp(input.updatedAt);
  if (!domain || !createdAt || !updatedAt) return null;
  const rawStages = Array.isArray(input.visitedStages)
    ? input.visitedStages.slice(0, INVESTIGATION_GUIDE_STAGES.length * 2)
    : [];
  const visitedStages = [];
  for (const stage of rawStages) {
    if (typeof stage === 'string' && STAGE_IDS.has(stage) && !visitedStages.includes(stage)) visitedStages.push(stage);
  }
  return {
    version: INVESTIGATION_GUIDE_VERSION,
    domain,
    createdAt,
    updatedAt,
    visitedStages,
  };
}

/** @param {unknown} value @param {unknown} pathname @param {unknown} now */
export function visitInvestigationGuide(value, pathname, now = new Date().toISOString()) {
  const guide = parseInvestigationGuide(value);
  const stage = investigationGuideStageForPath(pathname);
  if (!guide || !stage || guide.visitedStages.includes(stage.id)) return guide;
  const updatedAt = timestamp(now);
  if (!updatedAt) return guide;
  return { ...guide, updatedAt, visitedStages: [...guide.visitedStages, stage.id] };
}
