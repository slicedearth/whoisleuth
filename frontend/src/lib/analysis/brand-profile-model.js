// Pure Brand Profile normalization and storage model. The browser wrapper owns
// localStorage and downloads; this module owns schema migration, semantic field
// bounds, import merging, and exact serialized-byte accounting.

import { normalizeDomain } from './case-model.js';
import { normalizePageBaseline } from './page-baseline.js';
import { isInformativeFaviconHash } from './utils.js';

export const BRAND_PROFILE_SCHEMA_VERSION = 2;
export const MAX_PROFILES = 100;
export const MAX_PROFILE_VALUES = 200;
export const MAX_PROFILE_VALUE_INPUTS = MAX_PROFILE_VALUES * 4;
// Profiles share the origin's localStorage quota with cases, campaigns,
// watchlists, and CT history. Fail at a predictable one-megabyte boundary.
export const MAX_PROFILE_STORE_BYTES = 1024 * 1024;
export const MAX_PROFILE_NAME_LENGTH = 100;
export const MAX_PROFILE_TEXT_LENGTH = 200;
export const MAX_PROFILE_DOMAIN_LENGTH = 253;
export const MAX_PROFILE_TLD_LENGTH = 63;
export const MAX_DKIM_SELECTOR_LENGTH = 253;
export const MAX_DKIM_SELECTORS = 10;

const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const SHA256_RE = /^[a-f0-9]{64}$/i;
const CONTROL_RE = /[\x00-\x1f\x7f]/;
const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function boundedText(value, maximum = MAX_PROFILE_TEXT_LENGTH) {
  if (typeof value !== 'string' || CONTROL_RE.test(value)) return '';
  return value.slice(0, maximum * 4).replace(/\s+/g, ' ').trim().slice(0, maximum).trim();
}

function safeId(value) {
  return typeof value === 'string' && SAFE_ID_RE.test(value) ? value : null;
}

function timestamp(value, fallback) {
  if (typeof value === 'string' && value.length <= 64 && !CONTROL_RE.test(value)) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return fallback;
}

function normalizeTld(value) {
  if (typeof value !== 'string' || CONTROL_RE.test(value)) return '';
  const tld = value.trim().toLowerCase().replace(/^\./, '');
  if (!tld || tld.length > MAX_PROFILE_TLD_LENGTH || !DNS_LABEL_RE.test(tld)) return '';
  return tld;
}

function normalizeSelector(value) {
  if (typeof value !== 'string' || CONTROL_RE.test(value)) return '';
  const selector = value.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!selector || selector.length > MAX_DKIM_SELECTOR_LENGTH) return '';
  return selector.split('.').every((label) => DNS_LABEL_RE.test(label)) ? selector : '';
}

function normalizeList(value, normalize) {
  if (!Array.isArray(value)) return [];
  const values = [];
  const seen = new Set();
  for (const item of value.slice(0, MAX_PROFILE_VALUE_INPUTS)) {
    const normalized = normalize(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(normalized);
    if (values.length >= MAX_PROFILE_VALUES) break;
  }
  return values;
}

export function normalizeProfileDomains(value) {
  return normalizeList(value, (item) => {
    if (typeof item !== 'string' || item.length > MAX_PROFILE_DOMAIN_LENGTH) return '';
    return normalizeDomain(item);
  });
}

export function normalizeProfileTextValues(value) {
  return normalizeList(value, (item) => boundedText(item));
}

export function normalizeProfileTlds(value) {
  return normalizeList(value, normalizeTld);
}

export function normalizeDkimSelectors(value) {
  return normalizeList(value, normalizeSelector).slice(0, MAX_DKIM_SELECTORS);
}

function normalizeFaviconHash(value) {
  return typeof value === 'string' && SHA256_RE.test(value) ? value.toLowerCase() : '';
}

function normalizeFaviconPHash(value) {
  return typeof value === 'string' && isInformativeFaviconHash(value) ? value.toLowerCase() : '';
}

/** Normalize one profile while retaining only known, bounded fields. */
export function normalizeBrandProfile(raw, options = {}) {
  const value = record(raw);
  const existing = options.existing ? record(options.existing) : null;
  const now = timestamp(options.nowIso, new Date().toISOString());
  const officialDomains = normalizeProfileDomains(value.officialDomains);
  const candidateBaseline = Object.prototype.hasOwnProperty.call(value, 'pageBaseline')
    ? normalizePageBaseline(value.pageBaseline)
    : normalizePageBaseline(existing?.pageBaseline);
  const pageBaseline = candidateBaseline && officialDomains.includes(candidateBaseline.domain)
    ? candidateBaseline
    : null;
  const profileId = safeId(existing?.id) || safeId(value.id) || (typeof options.makeId === 'function' ? safeId(options.makeId()) : null);
  const name = boundedText(value.name, MAX_PROFILE_NAME_LENGTH);
  if (!profileId || !name) return null;
  const createdAt = timestamp(existing?.createdAt, null) || timestamp(value.createdAt, now);
  return {
    id: profileId,
    name,
    officialDomains,
    productNames: normalizeProfileTextValues(value.productNames),
    tlds: normalizeProfileTlds(value.tlds),
    approvedPartnerDomains: normalizeProfileDomains(value.approvedPartnerDomains),
    allowlistedDomains: normalizeProfileDomains(value.allowlistedDomains),
    allowlistedRegistrars: normalizeProfileTextValues(value.allowlistedRegistrars),
    dkimSelectors: normalizeDkimSelectors(value.dkimSelectors),
    trademarkOwner: boundedText(value.trademarkOwner),
    trademarkRegistration: boundedText(value.trademarkRegistration),
    officialFaviconHash: normalizeFaviconHash(value.officialFaviconHash),
    officialFaviconPHash: normalizeFaviconPHash(value.officialFaviconPHash),
    pageBaseline,
    createdAt,
    updatedAt: options.touch === true ? now : timestamp(value.updatedAt, createdAt),
  };
}

function profileList(raw) {
  if (Array.isArray(raw)) return raw;
  const value = record(raw);
  return Array.isArray(value.profiles) ? value.profiles : [];
}

export function brandProfileStoreVersion(raw) {
  if (Array.isArray(raw)) return 1;
  const value = record(raw);
  return typeof value.version === 'number' && Number.isFinite(value.version) && value.version > 0 ? value.version : null;
}

/** Normalize an internal profile collection or current stored envelope. */
export function normalizeBrandProfileStore(raw) {
  const byId = new Map();
  for (const item of profileList(raw).slice(0, MAX_PROFILES * 4)) {
    const profile = normalizeBrandProfile(item);
    if (!profile) continue;
    const previous = byId.get(profile.id);
    if (!previous || profile.updatedAt > previous.updatedAt) byId.set(profile.id, profile);
    if (byId.size >= MAX_PROFILES) break;
  }
  return { version: BRAND_PROFILE_SCHEMA_VERSION, profiles: [...byId.values()] };
}

export function serializeBrandProfileStore(profiles) {
  return JSON.stringify(assertBrandProfileStoreBudget(profiles));
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function assertBrandProfileStoreBudget(profiles) {
  const store = normalizeBrandProfileStore(profiles);
  if (byteLength(JSON.stringify(store)) > MAX_PROFILE_STORE_BYTES) {
    throw new Error('Brand profile storage is full. Export and remove a profile before saving more.');
  }
  return store;
}

export function mergeBrandProfiles(localRaw, importedRaw, options = {}) {
  const imported = record(importedRaw);
  if (imported.schema !== 'whoisleuth.brand-profiles') {
    throw new Error('This JSON file is not a WHOISleuth Brand Profile export.');
  }
  if (!Array.isArray(imported.profiles)) {
    throw new Error('Expected a current WHOISleuth Brand Profile export.');
  }
  const importedVersion = brandProfileStoreVersion(importedRaw);
  if (importedVersion !== null && importedVersion > BRAND_PROFILE_SCHEMA_VERSION) {
    throw new Error(`This Brand Profile file uses newer schema ${importedVersion}. Update the app before importing it.`);
  }
  if (importedVersion !== BRAND_PROFILE_SCHEMA_VERSION) {
    throw new Error(`Expected a WHOISleuth Brand Profile export using schema ${BRAND_PROFILE_SCHEMA_VERSION}.`);
  }
  const local = normalizeBrandProfileStore(localRaw).profiles;
  const byName = new Map(local.map((profile) => [profile.name.toLowerCase(), profile]));
  const input = profileList(importedRaw);
  let added = 0;
  let updated = 0;
  let skipped = Math.max(0, input.length - MAX_PROFILES * 4);
  for (const item of input.slice(0, MAX_PROFILES * 4)) {
    const rawName = boundedText(record(item).name, MAX_PROFILE_NAME_LENGTH);
    const existing = rawName ? byName.get(rawName.toLowerCase()) : null;
    const profile = normalizeBrandProfile(item, {
      existing,
      touch: true,
      nowIso: options.nowIso,
      makeId: options.makeId,
    });
    if (!profile) { skipped++; continue; }
    if (existing) { byName.set(profile.name.toLowerCase(), profile); updated++; }
    else if (byName.size < MAX_PROFILES) { byName.set(profile.name.toLowerCase(), profile); added++; }
    else skipped++;
  }
  return { profiles: [...byName.values()], added, updated, skipped };
}

export function buildBrandProfileExport(profiles, nowIso = new Date().toISOString()) {
  return {
    schema: 'whoisleuth.brand-profiles',
    version: BRAND_PROFILE_SCHEMA_VERSION,
    exportedAt: timestamp(nowIso, new Date().toISOString()),
    profiles: normalizeBrandProfileStore(profiles).profiles,
  };
}
