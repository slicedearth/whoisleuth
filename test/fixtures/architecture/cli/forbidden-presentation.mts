import { adapterValue } from '../frontend/src/lib/components/adapter.mts';
import { historicalArtifactIntegrityFacade } from '../frontend/src/lib/analysis/artifact-integrity.mts';
import { historicalDomainControlFacade } from '../frontend/src/lib/analysis/domain-control-manifest-core.mts';
import { historicalDomainControlRecordsFacade } from '../frontend/src/lib/analysis/domain-control-records.mts';
import { historicalObservationFacade } from '../lib/observation.mts';
import { historicalExternalFindingsFacade } from '../frontend/src/lib/analysis/external-findings-import.mts';
import { historicalPageSimilarityFacade } from '../frontend/src/lib/analysis/page-similarity.mts';
import { historicalWorkspaceArchiveFacade } from '../frontend/src/lib/analysis/workspace-archive.mts';

export const forbiddenPresentationValue = `${adapterValue}:${historicalArtifactIntegrityFacade}:${historicalDomainControlFacade}:${historicalDomainControlRecordsFacade}:${historicalObservationFacade}:${historicalExternalFindingsFacade}:${historicalPageSimilarityFacade}:${historicalWorkspaceArchiveFacade}`;
