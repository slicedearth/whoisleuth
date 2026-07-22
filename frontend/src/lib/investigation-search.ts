// Browser-only adapter for the pure investigation projection and search index.
// It reads three bounded provider collections, never writes derived data, and
// never sends retained values to the server.
import { loadProfiles } from './brand-profiles';
import { loadCampaigns } from './campaigns';
import { loadCases } from './cases';
import { buildInvestigationProjection } from './analysis/investigation-projection.ts';
import {
  buildInvestigationSearchIndex,
  type InvestigationSearchIndex,
} from './analysis/investigation-search.ts';
import type { InvestigationProjection } from './analysis/investigation-projection.ts';

/** Builds a disposable projection from the current browser's bounded stores. */
export async function loadLocalInvestigationProjection(): Promise<InvestigationProjection> {
  const [cases, campaigns, brandProfiles] = await Promise.all([loadCases(), loadCampaigns(), loadProfiles()]);
  return buildInvestigationProjection({
    cases,
    campaigns,
    brandProfiles,
  });
}

/** Builds the relationship workspace projection without unrelated profile data. */
export async function loadLocalCaseInvestigationProjection(): Promise<InvestigationProjection> {
  const [cases, campaigns] = await Promise.all([loadCases(), loadCampaigns()]);
  return buildInvestigationProjection({
    cases,
    campaigns,
  });
}

/** Builds a disposable in-memory index from the current browser's local stores. */
export async function loadLocalInvestigationSearchIndex(): Promise<InvestigationSearchIndex> {
  return buildInvestigationSearchIndex(await loadLocalInvestigationProjection());
}
