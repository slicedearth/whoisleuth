// Pure, framework-neutral browser-local campaign model. Campaigns deliberately
// reference normalized case domains rather than copying case evidence, notes,
// or mutable case ids. The browser wrapper owns localStorage and downloads.

import { normalizeDomain } from './case-model.js';

export const CAMPAIGN_SCHEMA_VERSION = 1;
export const MAX_CAMPAIGNS = 50;
export const MAX_CAMPAIGN_DOMAINS = 50;
export const MAX_CAMPAIGN_NAME_LENGTH = 100;
export const MAX_CAMPAIGN_DESCRIPTION_LENGTH = 1000;
export const MAX_CAMPAIGN_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_CAMPAIGN_INPUT_RECORDS = 500;
// Cases and watchlists share the same per-origin localStorage quota. Keep this
// collection smaller than the case store and fail before a browser quota error.
export const MAX_CAMPAIGN_STORE_BYTES = 512 * 1024;

const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** @typedef {{ id: string, name: string, description: string, domains: string[], createdAt: string, updatedAt: string }} CampaignRecord */
/** @typedef {{ version: number, campaigns: CampaignRecord[] }} CampaignStore */

function hashString(value) {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}

function safeId(value) {
  return typeof value === 'string' && SAFE_ID_RE.test(value) ? value : null;
}

function makeId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `campaign-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isoOrNull(value) {
  if (typeof value !== 'string' || value.length > 64 || /[\x00-\x1f\x7f]/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeName(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, MAX_CAMPAIGN_NAME_LENGTH).trim();
}

function normalizeDescription(value) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .trim()
    .slice(0, MAX_CAMPAIGN_DESCRIPTION_LENGTH)
    .trim();
}

export function normalizeCampaignDomains(value) {
  if (!Array.isArray(value)) return [];
  const domains = new Set();
  for (const item of value) {
    const domain = normalizeDomain(item);
    if (domain) domains.add(domain);
  }
  return [...domains].sort().slice(0, MAX_CAMPAIGN_DOMAINS);
}

/** Normalize one record, or return null when it has no usable name. */
export function normalizeCampaign(raw, fallbackNow = new Date().toISOString()) {
  const record = raw && typeof raw === 'object' ? raw : {};
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

function asCampaignList(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.campaigns)) return raw.campaigns;
  return [];
}

export function campaignStoreVersion(raw) {
  return raw && typeof raw === 'object' && typeof raw.version === 'number' && Number.isFinite(raw.version) ? raw.version : null;
}

/** Recover a deterministic, bounded store from parsed browser data. */
export function normalizeCampaignStore(raw) {
  const now = new Date().toISOString();
  const byId = new Map();
  for (const item of asCampaignList(raw).slice(0, MAX_CAMPAIGN_INPUT_RECORDS)) {
    const campaign = normalizeCampaign(item, now);
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
  const used = new Set();
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

export function createCampaign(campaigns, input, nowIso = new Date().toISOString()) {
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

export function updateCampaign(campaigns, id, patch, nowIso = new Date().toISOString()) {
  const index = campaigns.findIndex((campaign) => campaign.id === id);
  if (index < 0) throw new Error('That campaign no longer exists.');
  const current = campaigns[index];
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

export function addCampaignDomain(campaigns, id, domain, nowIso) {
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

export function removeCampaignDomain(campaigns, id, domain, nowIso) {
  const record = campaigns.find((campaign) => campaign.id === id);
  if (!record) throw new Error('That campaign no longer exists.');
  const normalized = normalizeDomain(domain);
  return updateCampaign(campaigns, id, { domains: record.domains.filter((item) => item !== normalized) }, nowIso);
}

function mergeCampaign(local, imported) {
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
export function mergeCampaigns(localRaw, importedRaw) {
  if (importedRaw && typeof importedRaw === 'object' && typeof importedRaw.schema === 'string' && importedRaw.schema !== 'whoisleuth.campaigns') {
    throw new Error('This JSON file is not a WHOISleuth campaign export.');
  }
  const version = campaignStoreVersion(importedRaw);
  if (version !== null && version > CAMPAIGN_SCHEMA_VERSION) {
    throw new Error(`This campaign file uses newer schema ${version}. Update the app before importing it.`);
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

export function serializeCampaignStore(campaigns) {
  return JSON.stringify(normalizeCampaignStore(campaigns));
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function assertCampaignStoreBudget(campaigns) {
  const store = normalizeCampaignStore(campaigns);
  if (byteLength(JSON.stringify(store)) > MAX_CAMPAIGN_STORE_BYTES) {
    throw new Error('Campaign storage is full. Remove case domains or export and delete a campaign before saving.');
  }
  return store;
}

export function buildCampaignExport(campaigns, nowIso = new Date().toISOString()) {
  return {
    schema: 'whoisleuth.campaigns',
    version: CAMPAIGN_SCHEMA_VERSION,
    exportedAt: isoOrNull(nowIso) || new Date().toISOString(),
    campaigns: normalizeCampaignStore(campaigns).campaigns,
    limitations: 'Campaigns contain browser-local labels and domain membership only. They do not prove common ownership, coordination, intent, or maliciousness.',
  };
}
