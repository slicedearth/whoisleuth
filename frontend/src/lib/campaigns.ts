import { downloadLocalFile } from './download-local-file.ts';
// Browser-only campaign persistence. The pure campaign model owns validation,
// bounds, merge semantics, and export shaping; this wrapper owns asynchronous
// provider access and Blob downloads.
import {
  assertCampaignStoreBudget,
  buildCampaignExport,
  createCampaign as createCampaignRecord,
  mergeCampaigns,
  removeCampaignDomain as removeDomain,
  updateCampaign as updateCampaignRecord,
  addCampaignDomain as addDomain,
} from './analysis/campaign-model.ts';
import { readBrowserLocalData, updateBrowserLocalData } from './browser-local-data-service.ts';
import { assertLocalRecordCurrent } from './local-mutation-outcome.ts';
import { LEGACY_CAMPAIGNS_KEY } from './browser-local-data-contract.ts';
import { serialiseWorkspacePortableJson } from '../../../packages/contracts/workspace-portability.mts';

export { MAX_CAMPAIGN_IMPORT_BYTES } from './analysis/campaign-model.ts';

export const CAMPAIGNS_KEY = LEGACY_CAMPAIGNS_KEY;

export interface CampaignRecord {
  id: string;
  name: string;
  description: string;
  domains: string[];
  createdAt: string;
  updatedAt: string;
}

export async function loadCampaigns(): Promise<CampaignRecord[]> {
  return readBrowserLocalData('campaigns');
}

function boundedCampaigns(campaigns: CampaignRecord[]): CampaignRecord[] {
  const store = assertCampaignStoreBudget(campaigns);
  return store.campaigns as CampaignRecord[];
}

export async function createCampaign(input: { name: string; description?: string }): Promise<{ campaigns: CampaignRecord[]; record: CampaignRecord }> {
  return updateBrowserLocalData('campaigns', (current) => {
    const result = createCampaignRecord(current, input);
    const campaigns = boundedCampaigns(result.campaigns as CampaignRecord[]);
    return { document: campaigns, result: { campaigns, record: campaigns.find((campaign) => campaign.id === result.record.id) ?? result.record as CampaignRecord } };
  });
}

export async function editCampaign(id: string, patch: { name?: string; description?: string; domains?: string[] }, expected: CampaignRecord | null = null): Promise<CampaignRecord[]> {
  return updateBrowserLocalData('campaigns', (current) => {
    assertLocalRecordCurrent(current.find((campaign) => campaign.id === id), expected, 'campaign', Object.keys(patch) as (keyof CampaignRecord)[]);
    const campaigns = boundedCampaigns(updateCampaignRecord(current, id, patch).campaigns as CampaignRecord[]);
    return { document: campaigns, result: campaigns };
  });
}

export async function addCampaignDomain(id: string, domain: string): Promise<CampaignRecord[]> {
  return updateBrowserLocalData('campaigns', (current) => {
    const campaigns = boundedCampaigns(addDomain(current, id, domain).campaigns as CampaignRecord[]);
    return { document: campaigns, result: campaigns };
  });
}

export async function removeCampaignDomain(id: string, domain: string): Promise<CampaignRecord[]> {
  return updateBrowserLocalData('campaigns', (current) => {
    const campaigns = boundedCampaigns(removeDomain(current, id, domain).campaigns as CampaignRecord[]);
    return { document: campaigns, result: campaigns };
  });
}

export async function deleteCampaign(id: string, expected: CampaignRecord | null = null): Promise<CampaignRecord[]> {
  return updateBrowserLocalData('campaigns', (current) => {
    assertLocalRecordCurrent(current.find((campaign) => campaign.id === id), expected, 'campaign');
    const campaigns = boundedCampaigns(current.filter((campaign) => campaign.id !== id));
    return { document: campaigns, result: campaigns };
  });
}

export async function importCampaigns(raw: unknown): Promise<{ campaigns: CampaignRecord[]; added: number; updated: number; skipped: number }> {
  return updateBrowserLocalData('campaigns', (current) => {
    const result = mergeCampaigns(current, raw);
    const campaigns = boundedCampaigns(result.campaigns as CampaignRecord[]);
    return { document: campaigns, result: { campaigns, added: result.added, updated: result.updated, skipped: result.skipped } };
  });
}

export async function exportCampaigns(): Promise<void> {
  const blob = new Blob([serialiseWorkspacePortableJson(buildCampaignExport(await loadCampaigns()))], { type: 'application/json' });
  downloadLocalFile(blob, `whoisleuth-campaigns-${new Date().toISOString().slice(0, 10)}.json`);
}
