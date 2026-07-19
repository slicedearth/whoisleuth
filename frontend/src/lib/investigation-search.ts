// Browser-only adapter for the pure investigation projection and search index.
// It reads the three existing bounded stores, never writes derived data, and
// never sends retained values to the server.
import { PROFILES_KEY } from './brand-profiles';
import { CAMPAIGNS_KEY } from './campaigns';
import { CASES_KEY } from './cases';
import { MAX_PROFILE_STORE_BYTES } from './analysis/brand-profile-model.js';
import { MAX_CAMPAIGN_STORE_BYTES } from './analysis/campaign-model.js';
import { MAX_CASE_STORE_BYTES } from './analysis/case-model.js';
import { buildInvestigationProjection } from './analysis/investigation-projection.ts';
import {
  buildInvestigationSearchIndex,
  type InvestigationSearchIndex,
} from './analysis/investigation-search.ts';
import type { InvestigationProjection } from './analysis/investigation-projection.ts';

function readBoundedStore(key: string, maximumBytes: number): unknown {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return undefined;
    if (raw.length > maximumBytes || new TextEncoder().encode(raw).byteLength > maximumBytes) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Builds a disposable projection from the current browser's bounded stores. */
export function loadLocalInvestigationProjection(): InvestigationProjection {
  return buildInvestigationProjection({
    cases: readBoundedStore(CASES_KEY, MAX_CASE_STORE_BYTES),
    campaigns: readBoundedStore(CAMPAIGNS_KEY, MAX_CAMPAIGN_STORE_BYTES),
    brandProfiles: readBoundedStore(PROFILES_KEY, MAX_PROFILE_STORE_BYTES),
  });
}

/** Builds the relationship workspace projection without unrelated profile data. */
export function loadLocalCaseInvestigationProjection(): InvestigationProjection {
  return buildInvestigationProjection({
    cases: readBoundedStore(CASES_KEY, MAX_CASE_STORE_BYTES),
    campaigns: readBoundedStore(CAMPAIGNS_KEY, MAX_CAMPAIGN_STORE_BYTES),
  });
}

/** Builds a disposable in-memory index from the current browser's local stores. */
export function loadLocalInvestigationSearchIndex(): InvestigationSearchIndex {
  return buildInvestigationSearchIndex(loadLocalInvestigationProjection());
}
