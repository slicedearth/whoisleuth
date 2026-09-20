import { workspaceSessionStorage } from './browser-workspace-context.ts';

export const INVESTIGATION_GUIDE_KEY = 'whoisleuth:investigation-guide:v5';
export const INVESTIGATION_GUIDE_EVENT = 'whoisleuth:investigation-guide-change';

export function hasStoredInvestigationGuide(): boolean {
  try {
    return workspaceSessionStorage().getItem(INVESTIGATION_GUIDE_KEY) !== null;
  } catch {
    return false;
  }
}
