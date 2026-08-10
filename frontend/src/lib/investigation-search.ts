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
  markInvestigationSearchSourcesUnavailable,
  type InvestigationSearchIndex,
} from './analysis/investigation-search.ts';
import type { InvestigationProjection, InvestigationStoreName } from './analysis/investigation-projection.ts';
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

/** Builds a disposable index after a deliberate browser-local read. */
export async function loadLocalInvestigationSearchIndex(): Promise<InvestigationSearchIndex> {
  const results = await Promise.allSettled([
    loadCases(),
    loadCampaigns(),
    loadProfiles(),
    loadRelationshipObservations(),
  ]);
  if (results.every((result) => result.status === 'rejected')) {
    throw new Error('Saved context is unavailable because browser-local collections could not be read.');
  }
  const [cases, campaigns, brandProfiles, relationshipObservations] = results;
  const unavailableStores: InvestigationStoreName[] = [];
  if (cases?.status === 'rejected') unavailableStores.push('cases');
  if (campaigns?.status === 'rejected') unavailableStores.push('campaigns');
  if (brandProfiles?.status === 'rejected') unavailableStores.push('brandProfiles');
  if (relationshipObservations?.status === 'rejected') unavailableStores.push('relationshipObservations');
  const index = buildLocalInvestigationSearchIndex({
    cases: cases?.status === 'fulfilled' ? cases.value : undefined,
    campaigns: campaigns?.status === 'fulfilled' ? campaigns.value : undefined,
    brandProfiles: brandProfiles?.status === 'fulfilled' ? brandProfiles.value : undefined,
    relationshipObservations: relationshipObservations?.status === 'fulfilled' ? relationshipObservations.value : undefined,
  });
  return markInvestigationSearchSourcesUnavailable(index, unavailableStores);
}
