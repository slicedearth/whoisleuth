// Browser-only adapter for the pure investigation projection and search index.
// It reads four bounded provider collections, never writes derived data, and
// never sends retained values to the server.
import { loadProfiles } from './brand-profiles';
import { loadCampaigns } from './campaigns';
import { loadCases } from './cases';
import { loadRelationshipObservations } from './relationship-observations';
import { buildInvestigationProjection } from './analysis/investigation-projection.ts';
import {
  buildInvestigationSearchIndex,
  type InvestigationSearchIndex,
} from './analysis/investigation-search.ts';
import type { InvestigationProjection } from './analysis/investigation-projection.ts';
import type { InvestigationProjectionInput } from './analysis/investigation-projection.ts';

/** Builds the disposable index from already loaded browser-local collections. */
export function buildLocalInvestigationSearchIndex(
  collections: InvestigationProjectionInput,
): InvestigationSearchIndex {
  return buildInvestigationSearchIndex(buildInvestigationProjection(collections));
}

/** Builds a disposable projection from the current browser's bounded stores. */
export async function loadLocalInvestigationProjection(): Promise<InvestigationProjection> {
  const [cases, campaigns, brandProfiles, relationshipObservations] = await Promise.all([
    loadCases(),
    loadCampaigns(),
    loadProfiles(),
    loadRelationshipObservations(),
  ]);
  return buildInvestigationProjection({
    cases,
    campaigns,
    brandProfiles,
    relationshipObservations,
  });
}
