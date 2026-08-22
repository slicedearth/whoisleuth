// Pure, framework-neutral browser-local campaign model. Campaigns deliberately
// reference normalized case domains rather than copying case evidence, notes,
// or mutable case ids. The browser wrapper owns persistence and downloads.

import { normalizeDomain } from '../cases/case-model.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { assertWorkspaceDeclaredVersion, assertWorkspaceInputGraph, assertWorkspacePortableVersion, ordinaryWorkspaceRecord } from './hostile-input.mts';
import {
  CAMPAIGN_SCHEMA,
  CAMPAIGN_SCHEMA_VERSION,
  MAX_CAMPAIGNS,
  MAX_CAMPAIGN_DESCRIPTION_LENGTH,
  MAX_CAMPAIGN_DOMAINS,
  MAX_CAMPAIGN_INPUT_RECORDS,
  MAX_CAMPAIGN_NAME_LENGTH,
  MAX_CAMPAIGN_STORE_BYTES,
} from '../contracts/workspace-portability.mts';

export {
  CAMPAIGN_SCHEMA,
  CAMPAIGN_SCHEMA_VERSION,
  MAX_CAMPAIGNS,
  MAX_CAMPAIGN_DESCRIPTION_LENGTH,
  MAX_CAMPAIGN_DOMAINS,
  MAX_CAMPAIGN_IMPORT_BYTES,
  MAX_CAMPAIGN_INPUT_RECORDS,
  MAX_CAMPAIGN_NAME_LENGTH,
  MAX_CAMPAIGN_STORE_BYTES,
} from '../contracts/workspace-portability.mts';

const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type CampaignRecord = {
  id: string;
  name: string;
  description: string;
  domains: string[];
  createdAt: string;
  updatedAt: string;
};

export type CampaignStore = {
  version: typeof CAMPAIGN_SCHEMA_VERSION;
  campaigns: CampaignRecord[];
};

export type CampaignInput = {
  name?: unknown;
  description?: unknown;
  domains?: unknown;
};

function plainRecord(value: unknown): Record<string, unknown> | null {
  return ordinaryWorkspaceRecord(value, 'Campaign input');
}

function hashString(value: string): string {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}

function safeId(value: unknown): string | null {
  return typeof value === 'string' && SAFE_ID_RE.test(value) ? value : null;
}

function makeId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `campaign-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isoOrNull(value: unknown): string | null {
  return normalizeExplicitIsoTimestamp(value);
}

function normalizeName(value: unknown): string {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, MAX_CAMPAIGN_NAME_LENGTH).trim();
}

function normalizeDescription(value: unknown): string {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .trim()
    .slice(0, MAX_CAMPAIGN_DESCRIPTION_LENGTH)
    .trim();
}

export function normalizeCampaignDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const domains = new Set<string>();
  for (const item of value.slice(0, MAX_CAMPAIGN_DOMAINS * 4)) {
    const domain = normalizeDomain(item);
    if (domain) domains.add(domain);
    if (domains.size >= MAX_CAMPAIGN_DOMAINS) break;
  }
  return [...domains].sort();
}

/** Normalize one record, or return null when it has no usable name. */
export function normalizeCampaign(
  raw: unknown,
  fallbackNow: unknown = new Date().toISOString(),
): CampaignRecord | null {
  const record = plainRecord(raw) || {};
  const name = normalizeName(record.name);
  if (!name) return null;
  const fallback = isoOrNull(fallbackNow) || new Date().toISOString();
  const createdAt = isoOrNull(record.createdAt) || fallback;
  const updatedAt = isoOrNull(record.updatedAt) || createdAt;
  return {
    id: safeId(record.id) || `campaign-${hashString(`${name.toLowerCase()}|${createdAt}`)}`,
    name,
    description: normalizeDescription(record.description),
    domains: normalizeCampaignDomains(record.domains),
    createdAt,
    updatedAt,
  };
}

function asCampaignList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const value = plainRecord(raw);
  if (value && Array.isArray(value.campaigns)) return value.campaigns;
  return [];
}

export function campaignStoreVersion(raw: unknown): number | null {
  const value = plainRecord(raw);
  return value && typeof value.version === 'number' && Number.isFinite(value.version) ? value.version : null;
}

/** Recover a deterministic, bounded store from parsed browser data. */
export function normalizeCampaignStore(raw: unknown): CampaignStore {
  assertWorkspaceInputGraph(raw, 'Campaign store');
  assertWorkspaceDeclaredVersion(raw, 'Campaign store');
  const fallback = new Date(0).toISOString();
  const byId = new Map<string, CampaignRecord>();
  for (const item of asCampaignList(raw).slice(0, MAX_CAMPAIGN_INPUT_RECORDS)) {
    const campaign = normalizeCampaign(item, fallback);
    if (!campaign) continue;
    const existing = byId.get(campaign.id);
    const campaignKey = `${campaign.name}\u0000${campaign.description}\u0000${campaign.domains.join('\u0000')}\u0000${campaign.createdAt}`;
    const existingKey = existing ? `${existing.name}\u0000${existing.description}\u0000${existing.domains.join('\u0000')}\u0000${existing.createdAt}` : '';
    if (!existing
      || Date.parse(campaign.updatedAt) > Date.parse(existing.updatedAt)
      || (campaign.updatedAt === existing.updatedAt && campaignKey.localeCompare(existingKey) > 0)) {
      byId.set(campaign.id, campaign);
    }
  }
  const used = new Set<string>();
  const campaigns = [...byId.values()]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
      || left.name.localeCompare(right.name)
      || left.id.localeCompare(right.id))
    .slice(0, MAX_CAMPAIGNS)
    .map((campaign) => {
      let id = campaign.id;
      if (used.has(id)) {
        const base = `campaign-${hashString(`${campaign.name}|${campaign.createdAt}`)}`;
        id = base;
        let suffix = 2;
        while (used.has(id)) id = `${base}-${suffix++}`;
      }
      used.add(id);
      return { ...campaign, id };
    });
  return { version: CAMPAIGN_SCHEMA_VERSION, campaigns };
}

export function createCampaign(
  campaigns: readonly CampaignRecord[],
  input: CampaignInput,
  nowIso: unknown = new Date().toISOString(),
) {
  if (campaigns.length >= MAX_CAMPAIGNS) throw new Error(`Campaigns are limited to ${MAX_CAMPAIGNS}. Delete or export one first.`);
  const name = normalizeName(input?.name);
  if (!name) throw new Error('A campaign name is required.');
  const now = isoOrNull(nowIso) || new Date().toISOString();
  const record = {
    id: makeId(),
    name,
    description: normalizeDescription(input?.description),
    domains: normalizeCampaignDomains(input?.domains),
    createdAt: now,
    updatedAt: now,
  };
  return { campaigns: [record, ...campaigns], record };
}

export function updateCampaign(
  campaigns: readonly CampaignRecord[],
  id: string,
  patch: CampaignInput,
  nowIso: unknown = new Date().toISOString(),
) {
  const index = campaigns.findIndex((campaign) => campaign.id === id);
  if (index < 0) throw new Error('That campaign no longer exists.');
  const current = campaigns[index];
  if (!current) throw new Error('That campaign no longer exists.');
  const name = patch.name === undefined ? current.name : normalizeName(patch.name);
  if (!name) throw new Error('A campaign name is required.');
  const record = {
    ...current,
    name,
    description: patch.description === undefined
      ? current.description
      : normalizeDescription(patch.description),
    domains: patch.domains === undefined ? current.domains : normalizeCampaignDomains(patch.domains),
    updatedAt: isoOrNull(nowIso) || new Date().toISOString(),
  };
  const next = [...campaigns];
  next[index] = record;
  return { campaigns: next, record };
}

export function addCampaignDomain(
  campaigns: readonly CampaignRecord[],
  id: string,
  domain: unknown,
  nowIso?: unknown,
) {
  const record = campaigns.find((campaign) => campaign.id === id);
  if (!record) throw new Error('That campaign no longer exists.');
  const normalized = normalizeDomain(domain);
  if (!normalized) throw new Error('A valid case domain is required.');
  if (record.domains.includes(normalized)) return { campaigns, record, added: false };
  if (record.domains.length >= MAX_CAMPAIGN_DOMAINS) {
    throw new Error(`Each campaign is limited to ${MAX_CAMPAIGN_DOMAINS} case domains.`);
  }
  const result = updateCampaign(campaigns, id, { domains: [...record.domains, normalized] }, nowIso);
  return { ...result, added: true };
}

export function removeCampaignDomain(
  campaigns: readonly CampaignRecord[],
  id: string,
  domain: unknown,
  nowIso?: unknown,
) {
  const record = campaigns.find((campaign) => campaign.id === id);
  if (!record) throw new Error('That campaign no longer exists.');
  const normalized = normalizeDomain(domain);
  return updateCampaign(campaigns, id, { domains: record.domains.filter((item) => item !== normalized) }, nowIso);
}

function mergeCampaign(local: CampaignRecord, imported: CampaignRecord): CampaignRecord {
  const importedNewer = Date.parse(imported.updatedAt) > Date.parse(local.updatedAt);
  return {
    ...local,
    name: importedNewer ? imported.name : local.name,
    description: importedNewer ? imported.description : local.description,
    domains: normalizeCampaignDomains([...local.domains, ...imported.domains]),
    createdAt: Date.parse(imported.createdAt) < Date.parse(local.createdAt) ? imported.createdAt : local.createdAt,
    updatedAt: importedNewer ? imported.updatedAt : local.updatedAt,
  };
}

/** Non-destructively merge a portable export into local campaigns by id. */
export function mergeCampaigns(localRaw: unknown, importedRaw: unknown) {
  assertWorkspaceInputGraph(localRaw, 'Local campaign store');
  assertWorkspaceInputGraph(importedRaw, 'Imported campaign document');
  assertWorkspacePortableVersion(importedRaw, CAMPAIGN_SCHEMA_VERSION, 'Imported campaign document');
  const importedEnvelope = plainRecord(importedRaw);
  if (!importedEnvelope
    || importedEnvelope.schema !== CAMPAIGN_SCHEMA
    || !Array.isArray(importedEnvelope.campaigns)) {
    throw new Error('This JSON file is not a WHOISleuth campaign export.');
  }
  const version = campaignStoreVersion(importedRaw);
  if (version !== null && version > CAMPAIGN_SCHEMA_VERSION) {
    throw new Error(`This campaign file uses newer schema ${version}. Update the app before importing it.`);
  }
  if (version !== CAMPAIGN_SCHEMA_VERSION) {
    throw new Error(`Expected campaign schema ${CAMPAIGN_SCHEMA_VERSION}.`);
  }
  const local = normalizeCampaignStore(localRaw).campaigns;
  const byId = new Map(local.map((campaign) => [campaign.id, campaign]));
  let added = 0;
  let updated = 0;
  const importedList = asCampaignList(importedRaw);
  let skipped = Math.max(0, importedList.length - MAX_CAMPAIGN_INPUT_RECORDS);
  for (const raw of importedList.slice(0, MAX_CAMPAIGN_INPUT_RECORDS)) {
    const imported = normalizeCampaign(raw, '1970-01-01T00:00:00.000Z');
    if (!imported) { skipped++; continue; }
    const existing = byId.get(imported.id);
    if (existing) {
      byId.set(imported.id, mergeCampaign(existing, imported));
      updated++;
    } else if (byId.size < MAX_CAMPAIGNS) {
      byId.set(imported.id, imported);
      added++;
    } else skipped++;
  }
  return { ...normalizeCampaignStore([...byId.values()]), added, updated, skipped };
}

export function serializeCampaignStore(campaigns: unknown): string {
  return JSON.stringify(normalizeCampaignStore(campaigns));
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function assertCampaignStoreBudget(campaigns: unknown): CampaignStore {
  const store = normalizeCampaignStore(campaigns);
  if (byteLength(JSON.stringify(store)) > MAX_CAMPAIGN_STORE_BYTES) {
    throw new Error('Campaign storage is full. Remove case domains or export and delete a campaign before saving.');
  }
  return store;
}

export function buildCampaignExport(campaigns: unknown, nowIso: unknown = new Date().toISOString()) {
  return {
    schema: CAMPAIGN_SCHEMA,
    version: CAMPAIGN_SCHEMA_VERSION,
    exportedAt: isoOrNull(nowIso) || new Date().toISOString(),
    campaigns: normalizeCampaignStore(campaigns).campaigns,
    limitations: 'Campaigns contain browser-local labels and domain membership only. They do not prove common ownership, coordination, intent, or maliciousness.',
  };
}
