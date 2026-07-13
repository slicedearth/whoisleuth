// Browser-only campaign persistence. The pure campaign model owns validation,
// bounds, merge semantics, and export shaping; this wrapper owns localStorage
// and Blob downloads.
import {
  assertCampaignStoreBudget,
  buildCampaignExport,
  CAMPAIGN_SCHEMA_VERSION,
  campaignStoreVersion,
  createCampaign as createCampaignRecord,
  mergeCampaigns,
  normalizeCampaignStore,
  removeCampaignDomain as removeDomain,
  serializeCampaignStore,
  updateCampaign as updateCampaignRecord,
  addCampaignDomain as addDomain,
} from './analysis/campaign-model.js';

export { MAX_CAMPAIGN_IMPORT_BYTES } from './analysis/campaign-model.js';

export const CAMPAIGNS_KEY = 'whoisleuth-campaigns-v1';

export interface CampaignRecord {
  id: string;
  name: string;
  description: string;
  domains: string[];
  createdAt: string;
  updatedAt: string;
}

function readRaw(): unknown {
  const raw = localStorage.getItem(CAMPAIGNS_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function loadCampaigns(): CampaignRecord[] {
  try { return normalizeCampaignStore(readRaw()).campaigns as CampaignRecord[]; }
  catch { return []; }
}

function persist(campaigns: CampaignRecord[]): CampaignRecord[] {
  let version: number | null = null;
  try { version = campaignStoreVersion(readRaw()); } catch { /* corrupt data can be replaced safely */ }
  if (version !== null && version > CAMPAIGN_SCHEMA_VERSION) {
    throw new Error('Campaigns were created by a newer app version. Update the app before saving.');
  }
  const store = assertCampaignStoreBudget(campaigns);
  try { localStorage.setItem(CAMPAIGNS_KEY, serializeCampaignStore(store.campaigns)); }
  catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('Campaign storage is full')) throw cause;
    throw new Error('Could not save campaigns. Browser storage may be full or unavailable.');
  }
  return store.campaigns as CampaignRecord[];
}

export function createCampaign(input: { name: string; description?: string }): { campaigns: CampaignRecord[]; record: CampaignRecord } {
  const result = createCampaignRecord(loadCampaigns(), input);
  const campaigns = persist(result.campaigns as CampaignRecord[]);
  return { campaigns, record: campaigns.find((campaign) => campaign.id === result.record.id) ?? result.record as CampaignRecord };
}

export function editCampaign(id: string, patch: { name?: string; description?: string; domains?: string[] }): CampaignRecord[] {
  return persist(updateCampaignRecord(loadCampaigns(), id, patch).campaigns as CampaignRecord[]);
}

export function addCampaignDomain(id: string, domain: string): CampaignRecord[] {
  return persist(addDomain(loadCampaigns(), id, domain).campaigns as CampaignRecord[]);
}

export function removeCampaignDomain(id: string, domain: string): CampaignRecord[] {
  return persist(removeDomain(loadCampaigns(), id, domain).campaigns as CampaignRecord[]);
}

export function deleteCampaign(id: string): CampaignRecord[] {
  return persist(loadCampaigns().filter((campaign) => campaign.id !== id));
}

export function importCampaigns(raw: unknown): { campaigns: CampaignRecord[]; added: number; updated: number; skipped: number } {
  const result = mergeCampaigns(loadCampaigns(), raw);
  return { campaigns: persist(result.campaigns as CampaignRecord[]), added: result.added, updated: result.updated, skipped: result.skipped };
}

export function exportCampaigns(): void {
  let version: number | null = null;
  try { version = campaignStoreVersion(readRaw()); } catch { /* export normalized recovery */ }
  if (version !== null && version > CAMPAIGN_SCHEMA_VERSION) {
    throw new Error('Campaigns were created by a newer app version. Update the app before exporting.');
  }
  const blob = new Blob([JSON.stringify(buildCampaignExport(loadCampaigns()), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `whoisleuth-campaigns-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
