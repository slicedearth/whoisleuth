import {
  buildShortlistExport,
  MAX_SHORTLIST_ENTRIES,
  mergeShortlistStores,
  normalizeShortlistRecord,
  setShortlistSelection as applyShortlistSelection,
  serializeShortlistStore,
  type ShortlistRecord,
} from './analysis/shortlist-model.ts';
import { readBrowserLocalData, updateBrowserLocalData } from './browser-local-data-service.ts';
import { LEGACY_SHORTLIST_KEY } from './browser-local-data-contract.ts';
import { serialiseWorkspacePortableJson } from '../../../packages/contracts/workspace-portability.mts';
export { MAX_SHORTLIST_IMPORT_BYTES } from '../../../packages/contracts/workspace-portability.mts';

export const SHORTLIST_KEY = LEGACY_SHORTLIST_KEY;

export type { ShortlistRecord };

export async function loadShortlist(): Promise<ShortlistRecord[]> {
  return readBrowserLocalData('shortlist');
}

function boundedShortlist(records: ShortlistRecord[]): ShortlistRecord[] {
  return JSON.parse(serializeShortlistStore(records)).entries as ShortlistRecord[];
}

export async function toggleShortlist(raw: unknown): Promise<boolean> {
  const record = normalizeShortlistRecord(raw, { fallbackTimestamp: new Date().toISOString() });
  if (!record) throw new Error('Invalid shortlist record.');
  return updateBrowserLocalData('shortlist', (current) => {
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

export async function setShortlistSelection(raw: unknown[], selected: boolean) {
  return updateBrowserLocalData('shortlist', (current) => {
    const result = applyShortlistSelection(current, raw, selected);
    return {
      document: boundedShortlist(result.entries),
      result: {
        added: result.added,
        updated: result.updated,
        removed: result.removed,
        skipped: result.skipped,
      },
    };
  });
}

export async function clearShortlist(): Promise<void> {
  await updateBrowserLocalData('shortlist', () => ({ document: [], result: undefined }));
}

export async function importShortlist(value: unknown) {
  return updateBrowserLocalData('shortlist', (current) => {
    const result = mergeShortlistStores(current, value);
    return {
      document: boundedShortlist(result.entries),
      result: { added: result.added, updated: result.updated, skipped: result.skipped },
    };
  });
}

export async function exportShortlist() {
  const url = URL.createObjectURL(new Blob([serialiseWorkspacePortableJson(buildShortlistExport(await loadShortlist()))], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `whoisleuth-shortlist-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
