import {
  createInvestigationGuide,
  INVESTIGATION_GUIDE_STAGES,
  INVESTIGATION_GUIDE_VERSION,
  investigationGuideHref,
  investigationGuideStageForPath,
  parseInvestigationGuide,
  visitInvestigationGuide,
} from './analysis/investigation-guide.js';

export const INVESTIGATION_GUIDE_KEY = 'whoisleuth:investigation-guide:v1';
export const INVESTIGATION_GUIDE_EVENT = 'whoisleuth:investigation-guide-change';
export const MAX_INVESTIGATION_GUIDE_SERIALIZED_LENGTH = 2_048;

export type InvestigationGuideStageId = 'lookup' | 'discover' | 'bulk' | 'monitor';
export type InvestigationGuide = {
  version: 1;
  domain: string;
  createdAt: string;
  updatedAt: string;
  visitedStages: InvestigationGuideStageId[];
};

export const investigationGuideStages = INVESTIGATION_GUIDE_STAGES as ReadonlyArray<{
  id: InvestigationGuideStageId;
  label: string;
  path: string;
  detail: string;
}>;

function announceGuideChange() {
  window.dispatchEvent(new CustomEvent(INVESTIGATION_GUIDE_EVENT));
}

function storeGuide(guide: InvestigationGuide) {
  const serialized = JSON.stringify(guide);
  if (serialized.length > MAX_INVESTIGATION_GUIDE_SERIALIZED_LENGTH) {
    throw new Error('Could not retain the guided investigation because its navigation record is too large.');
  }
  try { sessionStorage.setItem(INVESTIGATION_GUIDE_KEY, serialized); }
  catch { throw new Error('Could not retain the guided investigation in this tab. Browser storage may be unavailable.'); }
}

export function loadInvestigationGuide(): InvestigationGuide | null {
  try {
    const serialized = sessionStorage.getItem(INVESTIGATION_GUIDE_KEY) || '';
    if (!serialized || serialized.length > MAX_INVESTIGATION_GUIDE_SERIALIZED_LENGTH) return null;
    return parseInvestigationGuide(JSON.parse(serialized)) as InvestigationGuide | null;
  } catch {
    return null;
  }
}

export function startInvestigationGuide(domain: string): InvestigationGuide {
  const guide = createInvestigationGuide(domain) as InvestigationGuide | null;
  if (!guide) throw new Error('Enter one valid domain without a URL, path, port, or spaces.');
  storeGuide(guide);
  announceGuideChange();
  return guide;
}

export function recordInvestigationGuideVisit(pathname: string): InvestigationGuide | null {
  const current = loadInvestigationGuide();
  const next = visitInvestigationGuide(current, pathname) as InvestigationGuide | null;
  if (!current || !next) return next;
  if (next.visitedStages.length !== current.visitedStages.length) {
    try { storeGuide(next); }
    catch { return current; }
  }
  return next;
}

export function clearInvestigationGuide() {
  try { sessionStorage.removeItem(INVESTIGATION_GUIDE_KEY); } catch { /* unavailable storage is already effectively clear */ }
  announceGuideChange();
}

export { INVESTIGATION_GUIDE_VERSION, investigationGuideHref, investigationGuideStageForPath };
