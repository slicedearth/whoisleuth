import { historicalWorkspaceFacade } from '../../frontend/src/lib/analysis/brand-profile-model.mts';
import { historicalWorkspaceArchiveFacade } from '../../frontend/src/lib/analysis/workspace-archive.mts';

export const forbiddenWorkspaceDomain = `${historicalWorkspaceFacade}:${historicalWorkspaceArchiveFacade}`;
