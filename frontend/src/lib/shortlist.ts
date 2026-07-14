import {
  buildShortlistExport,
  MAX_SHORTLIST_ENTRIES,
  mergeShortlistStores,
  normalizeShortlistRecord,
  normalizeShortlistStore,
  serializeShortlistStore,
  SHORTLIST_SCHEMA_VERSION,
  shortlistStoreVersion,
} from './analysis/shortlist-model.js';

export const SHORTLIST_KEY = 'whois-rdap-shortlist-v1';
export const MAX_SHORTLIST_IMPORT_BYTES = 2 * 1024 * 1024;

export interface ShortlistRecord {
  domain: string;
  availability: string;
  riskScore: number | null;
  opportunityScore: number | null;
  registrarName?: string | null;
  activityStatus?: string | null;
  mutationTypes: string[];
  savedAt: string;
  [key: string]: unknown;
}

function readRaw(): unknown {
  const raw = localStorage.getItem(SHORTLIST_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function loadShortlist(): ShortlistRecord[] {
  try { return normalizeShortlistStore(readRaw()).entries as ShortlistRecord[]; }
  catch { return []; }
}

function writeShortlist(records: ShortlistRecord[]) {
  let version: number | null = null;
  try { version = shortlistStoreVersion(readRaw()); } catch { /* corrupt data can be replaced safely */ }
  if (version !== null && version > SHORTLIST_SCHEMA_VERSION) {
    throw new Error('The shortlist was created by a newer app version. Update the app before saving.');
  }
  const serialized = serializeShortlistStore(records);
  try { localStorage.setItem(SHORTLIST_KEY, serialized); }
  catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('Shortlist storage is full')) throw cause;
    throw new Error('Could not save the shortlist. Browser storage may be full or unavailable.');
  }
}

export function toggleShortlist(raw: unknown) {
  const record = normalizeShortlistRecord(raw, { fallbackTimestamp: new Date().toISOString() }) as ShortlistRecord | null;
  if (!record) throw new Error('Invalid shortlist record.');
  const records = loadShortlist();
  const index = records.findIndex((item) => item.domain === record.domain);
  if (index >= 0) records.splice(index, 1);
  else {
    if (records.length >= MAX_SHORTLIST_ENTRIES) throw new Error(`Shortlist is limited to ${MAX_SHORTLIST_ENTRIES} domains.`);
    records.push(record);
  }
  writeShortlist(records);
  return index < 0;
}

export function clearShortlist() { writeShortlist([]); }

export function importShortlist(value: unknown) {
  const result = mergeShortlistStores(loadShortlist(), value);
  writeShortlist(result.entries as ShortlistRecord[]);
  return { added: result.added, updated: result.updated, skipped: result.skipped };
}

export function exportShortlist() {
  let version: number | null = null;
  try { version = shortlistStoreVersion(readRaw()); } catch { /* export normalized recovery */ }
  if (version !== null && version > SHORTLIST_SCHEMA_VERSION) {
    throw new Error('The shortlist was created by a newer app version. Update the app before exporting.');
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(buildShortlistExport(loadShortlist()), null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `whoisleuth-shortlist-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
