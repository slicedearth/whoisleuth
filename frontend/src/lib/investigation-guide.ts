import {
  approveInvestigationGuideStage,
  buildInvestigationGuideSummary,
  createInvestigationGuide,
  INVESTIGATION_GUIDE_EXPORT_SCHEMA,
  INVESTIGATION_GUIDE_EXPORT_VERSION,
  INVESTIGATION_GUIDE_SCHEMA,
  INVESTIGATION_GUIDE_VERSION,
  INVESTIGATION_RECIPES,
  investigationGuideApprovedHref,
  investigationGuideHref,
  investigationGuideRecipe,
  investigationGuideStageForGuidePath,
  investigationGuideStageForPath,
  investigationGuideStagesForGuide,
  investigationGuideStagesForRecipe,
  investigationGuideSummaryFilename,
  MAX_INVESTIGATION_GUIDE_REVIEW_NOTE_LENGTH,
  MAX_INVESTIGATION_GUIDE_EXPORT_BYTES,
  MAX_INVESTIGATION_GUIDE_SERIALIZED_BYTES,
  parseInvestigationGuide,
  restartInvestigationGuide,
  setInvestigationGuideFocusDomain,
  setInvestigationGuideReviewDomains,
  setInvestigationGuideStageOutcome,
  setInvestigationGuideStatus,
  visitInvestigationGuide,
  type InvestigationGuide,
  type InvestigationGuideOutcome,
  type InvestigationRecipeId,
  type InvestigationGuideTemplateSnapshot,
} from './analysis/investigation-guide.ts';
import {
  INVESTIGATION_GUIDE_EVENT,
  INVESTIGATION_GUIDE_KEY,
} from './investigation-guide-storage.ts';
import { parseBoundedJson } from './bounded-json.ts';

export {
  INVESTIGATION_GUIDE_EVENT,
  INVESTIGATION_GUIDE_KEY,
} from './investigation-guide-storage.ts';

export type {
  InvestigationGuide,
  InvestigationGuideOutcome,
  InvestigationGuideStageProgress,
  InvestigationGuideStatus,
  InvestigationGuideSummary,
  InvestigationGuideTemplateSnapshot,
  InvestigationRecipe,
  InvestigationRecipeId,
  InvestigationRecipeStage,
  InvestigationWorkspaceId,
} from './analysis/investigation-guide.ts';

export const investigationRecipes = INVESTIGATION_RECIPES;

function announceGuideChange() {
  window.dispatchEvent(new CustomEvent(INVESTIGATION_GUIDE_EVENT));
}

function serializedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function readStoredGuide(key: string): InvestigationGuide | null {
  try {
    const serialized = sessionStorage.getItem(key);
    if (serialized === null) return null;
    if (serialized.length > MAX_INVESTIGATION_GUIDE_SERIALIZED_BYTES
      || serializedBytes(serialized) > MAX_INVESTIGATION_GUIDE_SERIALIZED_BYTES) {
      return null;
    }
    return parseInvestigationGuide(parseBoundedJson(serialized, {
      label: 'Guided investigation state',
      maximumBytes: MAX_INVESTIGATION_GUIDE_SERIALIZED_BYTES,
    }));
  } catch {
    return null;
  }
}

function storeGuide(guide: InvestigationGuide) {
  const serialized = JSON.stringify(guide);
  if (serialized.length > MAX_INVESTIGATION_GUIDE_SERIALIZED_BYTES
    || serializedBytes(serialized) > MAX_INVESTIGATION_GUIDE_SERIALIZED_BYTES) {
    throw new Error('Could not retain the guided investigation because its progress record is too large.');
  }
  try {
    sessionStorage.setItem(INVESTIGATION_GUIDE_KEY, serialized);
  } catch {
    throw new Error('Could not retain the guided investigation in this tab. Browser storage may be unavailable.');
  }
}

function updateStoredGuide(next: InvestigationGuide | null, fallback: InvestigationGuide | null): InvestigationGuide | null {
  if (!next) return next;
  if (fallback && JSON.stringify(next) === JSON.stringify(fallback)) return fallback;
  try {
    storeGuide(next);
    announceGuideChange();
    return next;
  } catch {
    return fallback;
  }
}

export function loadInvestigationGuide(): InvestigationGuide | null {
  return readStoredGuide(INVESTIGATION_GUIDE_KEY);
}

export function startInvestigationGuide(
  domain: string,
  recipeId: InvestigationRecipeId = 'new_domain_triage',
  template: InvestigationGuideTemplateSnapshot | null = null,
): InvestigationGuide {
  const guide = createInvestigationGuide(domain, recipeId, new Date().toISOString(), template) as InvestigationGuide | null;
  if (!guide) throw new Error('Enter one valid domain without a URL, path, port, or spaces.');
  storeGuide(guide);
  announceGuideChange();
  return guide;
}

export function recordInvestigationGuideVisit(pathname: string): InvestigationGuide | null {
  const current = loadInvestigationGuide();
  return updateStoredGuide(visitInvestigationGuide(current, pathname), current);
}

export function approveInvestigationGuideCollection(stageId: string): InvestigationGuide | null {
  const current = loadInvestigationGuide();
  return updateStoredGuide(approveInvestigationGuideStage(current, stageId), current);
}

export function updateInvestigationGuideOutcome(stageId: string, outcome: InvestigationGuideOutcome, reviewNote: string | null = null): InvestigationGuide | null {
  const current = loadInvestigationGuide();
  return updateStoredGuide(setInvestigationGuideStageOutcome(current, stageId, outcome, new Date().toISOString(), reviewNote), current);
}

export function selectInvestigationGuideFocusDomain(domain: string): InvestigationGuide | null {
  const current = loadInvestigationGuide();
  return updateStoredGuide(setInvestigationGuideFocusDomain(current, domain), current);
}

export function selectInvestigationGuideReviewDomains(domains: string[]): InvestigationGuide | null {
  const current = loadInvestigationGuide();
  return updateStoredGuide(setInvestigationGuideReviewDomains(current, domains), current);
}

export function pauseInvestigationGuide(): InvestigationGuide | null {
  const current = loadInvestigationGuide();
  return updateStoredGuide(setInvestigationGuideStatus(current, 'paused'), current);
}

export function resumeInvestigationGuide(): InvestigationGuide | null {
  const current = loadInvestigationGuide();
  return updateStoredGuide(setInvestigationGuideStatus(current, 'active'), current);
}

export function restartStoredInvestigationGuide(): InvestigationGuide | null {
  const current = loadInvestigationGuide();
  return updateStoredGuide(restartInvestigationGuide(current), current);
}

export function downloadInvestigationGuideSummary(): void {
  const guide = loadInvestigationGuide();
  const generatedAt = new Date().toISOString();
  const summary = buildInvestigationGuideSummary(guide, generatedAt);
  if (!guide || !summary) throw new Error('There is no valid guided investigation to export.');
  const content = `${JSON.stringify(summary, null, 2)}\n`;
  if (serializedBytes(content) > MAX_INVESTIGATION_GUIDE_EXPORT_BYTES) {
    throw new Error('Could not export the guided investigation because its summary is too large.');
  }
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = investigationGuideSummaryFilename(guide, generatedAt);
  anchor.click();
  URL.revokeObjectURL(url);
}

export function clearInvestigationGuide() {
  try {
    sessionStorage.removeItem(INVESTIGATION_GUIDE_KEY);
  } catch {
    // Unavailable storage is already effectively clear.
  }
  announceGuideChange();
}

export {
  INVESTIGATION_GUIDE_EXPORT_SCHEMA,
  INVESTIGATION_GUIDE_EXPORT_VERSION,
  INVESTIGATION_GUIDE_SCHEMA,
  INVESTIGATION_GUIDE_VERSION,
  MAX_INVESTIGATION_GUIDE_REVIEW_NOTE_LENGTH,
  investigationGuideApprovedHref,
  investigationGuideHref,
  investigationGuideRecipe,
  investigationGuideStageForGuidePath,
  investigationGuideStageForPath,
  investigationGuideStagesForGuide,
  investigationGuideStagesForRecipe,
};
