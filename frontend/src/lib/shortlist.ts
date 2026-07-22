import {
  buildShortlistExport,
  MAX_SHORTLIST_ENTRIES,
  mergeShortlistStores,
  normalizeShortlistRecord,
  serializeShortlistStore,
} from './analysis/shortlist-model.js';
import { browserLocalDataProvider } from './browser-local-data-service.js';
import { LEGACY_SHORTLIST_KEY, SHORTLIST_COLLECTION } from './browser-local-data-definitions.js';

export const SHORTLIST_KEY = LEGACY_SHORTLIST_KEY;
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

export async function loadShortlist(): Promise<ShortlistRecord[]> {
  return (await browserLocalDataProvider()).read(SHORTLIST_COLLECTION) as Promise<ShortlistRecord[]>;
}

function boundedShortlist(records: ShortlistRecord[]): ShortlistRecord[] {
  return JSON.parse(serializeShortlistStore(records)).entries as ShortlistRecord[];
}

export async function toggleShortlist(raw: unknown): Promise<boolean> {
  const record = normalizeShortlistRecord(raw, { fallbackTimestamp: new Date().toISOString() }) as ShortlistRecord | null;
  if (!record) throw new Error('Invalid shortlist record.');
  return (await browserLocalDataProvider()).update(SHORTLIST_COLLECTION, (current) => {
    const records = [...current] as ShortlistRecord[];
    const index = records.findIndex((item) => item.domain === record.domain);
    if (index >= 0) records.splice(index, 1);
    else {
      if (records.length >= MAX_SHORTLIST_ENTRIES) throw new Error(`Shortlist is limited to ${MAX_SHORTLIST_ENTRIES} domains.`);
      records.push(record);
    }
    return { document: boundedShortlist(records), result: index < 0 };
  });
}

export async function clearShortlist(): Promise<void> {
  await (await browserLocalDataProvider()).update(SHORTLIST_COLLECTION, () => ({ document: [], result: undefined }));
}

export async function importShortlist(value: unknown) {
  return (await browserLocalDataProvider()).update(SHORTLIST_COLLECTION, (current) => {
    const result = mergeShortlistStores(current, value);
    return {
      document: boundedShortlist(result.entries as ShortlistRecord[]),
      result: { added: result.added, updated: result.updated, skipped: result.skipped },
    };
  });
}

export async function exportShortlist() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(buildShortlistExport(await loadShortlist()), null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `whoisleuth-shortlist-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
