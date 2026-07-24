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

/** Builds the relationship workspace projection without unrelated profile data. */
export async function loadLocalCaseInvestigationProjection(): Promise<InvestigationProjection> {
  const [cases, campaigns, relationshipObservations] = await Promise.all([
    loadCases(),
    loadCampaigns(),
    loadRelationshipObservations(),
  ]);
  return buildInvestigationProjection({
    cases,
    campaigns,
    relationshipObservations,
  });
}

/** Builds a disposable in-memory index from the current browser's local stores. */
export async function loadLocalInvestigationSearchIndex(): Promise<InvestigationSearchIndex> {
  return buildInvestigationSearchIndex(await loadLocalInvestigationProjection());
}
