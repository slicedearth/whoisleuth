// Browser-only adapter for the pure investigation projection and search index.
// It reads four bounded provider collections, never writes derived data, and
// never sends retained values to the server.
import { loadProfiles } from './brand-profiles';
import { loadCampaigns } from './campaigns';
import { loadCases } from './cases';
import { loadRelationshipObservations } from './relationship-observations';
import { buildInvestigationProjection } from './analysis/investigation-projection.ts';
import type { InvestigationProjection, InvestigationStoreName } from './analysis/investigation-projection.ts';
import type { InvestigationProjectionInput } from './analysis/investigation-projection.ts';
import { createInvestigationSearchSession } from './investigation-search-session.ts';

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

async function readLocalInvestigationCollections() {
  const results = await Promise.allSettled([
    loadCases(),
    loadCampaigns(),
    loadProfiles(),
    loadRelationshipObservations(),
  ]);
  if (results.every((result) => result.status === 'rejected')) {
    throw new Error('Saved context is unavailable because workspace collections could not be read.');
  }
  const [cases, campaigns, brandProfiles, relationshipObservations] = results;
  const unavailableStores: InvestigationStoreName[] = [];
  if (cases?.status === 'rejected') unavailableStores.push('cases');
  if (campaigns?.status === 'rejected') unavailableStores.push('campaigns');
  if (brandProfiles?.status === 'rejected') unavailableStores.push('brandProfiles');
  if (relationshipObservations?.status === 'rejected') unavailableStores.push('relationshipObservations');
  const collections: InvestigationProjectionInput = {
    cases: cases?.status === 'fulfilled' ? cases.value : undefined,
    campaigns: campaigns?.status === 'fulfilled' ? campaigns.value : undefined,
    brandProfiles: brandProfiles?.status === 'fulfilled' ? brandProfiles.value : undefined,
    relationshipObservations: relationshipObservations?.status === 'fulfilled' ? relationshipObservations.value : undefined,
  };
  return { collections, unavailableStores };
}

/** Keeps the disposable index and query execution off the browser's main thread. */
export async function loadLocalInvestigationSearchSession(signal?: AbortSignal) {
  const { collections, unavailableStores } = await readLocalInvestigationCollections();
  return createInvestigationSearchSession(collections, unavailableStores, signal ? { signal } : {});
}
