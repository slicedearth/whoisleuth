export const INVESTIGATION_GUIDE_KEY = 'whoisleuth:investigation-guide:v5';
export const INVESTIGATION_GUIDE_EVENT = 'whoisleuth:investigation-guide-change';

export function hasStoredInvestigationGuide(): boolean {
  try {
    return sessionStorage.getItem(INVESTIGATION_GUIDE_KEY) !== null;
  } catch {
    return false;
  }
}
