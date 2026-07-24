export const INVESTIGATION_GUIDE_KEY = 'whoisleuth:investigation-guide:v2';
export const LEGACY_INVESTIGATION_GUIDE_KEY = 'whoisleuth:investigation-guide:v1';
export const INVESTIGATION_GUIDE_EVENT = 'whoisleuth:investigation-guide-change';

export function hasStoredInvestigationGuide(): boolean {
  try {
    return sessionStorage.getItem(INVESTIGATION_GUIDE_KEY) !== null
      || sessionStorage.getItem(LEGACY_INVESTIGATION_GUIDE_KEY) !== null;
  } catch {
    return false;
  }
}
