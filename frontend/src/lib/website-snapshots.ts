import {
  buildWebsiteSnapshotExport,
  deleteWebsiteSnapshot as removeSnapshot,
  mergeWebsiteSnapshots,
  saveWebsiteSnapshot as retainSnapshot,
  serializeWebsiteSnapshotStore,
  type WebsiteProfileSnapshot,
} from './analysis/website-snapshot-model.ts';
import { readBrowserLocalData, updateBrowserLocalData } from './browser-local-data-service.ts';
import { serialiseWorkspacePortableJson } from '../../../packages/contracts/workspace-portability.mts';

export { MAX_WEBSITE_SNAPSHOT_IMPORT_BYTES } from './analysis/website-snapshot-model.ts';
export type { WebsiteProfileSnapshot, WebsiteSnapshotChange } from './analysis/website-snapshot-model.ts';
export { compareWebsiteSnapshots } from './analysis/website-snapshot-model.ts';

function bounded(values: WebsiteProfileSnapshot[]): WebsiteProfileSnapshot[] {
  return JSON.parse(serializeWebsiteSnapshotStore(values)).snapshots as WebsiteProfileSnapshot[];
}
export async function loadWebsiteSnapshots(): Promise<WebsiteProfileSnapshot[]> {
  return readBrowserLocalData('website_snapshots');
}
export async function retainWebsiteSnapshot(raw: unknown): Promise<WebsiteProfileSnapshot[]> {
  return updateBrowserLocalData('website_snapshots', (current) => {
    const snapshots = bounded(retainSnapshot(current, raw));
    return { document: snapshots, result: snapshots };
  });
}
export async function deleteWebsiteSnapshot(id: string): Promise<WebsiteProfileSnapshot[]> {
  return updateBrowserLocalData('website_snapshots', (current) => {
    const snapshots = bounded(removeSnapshot(current, id));
    return { document: snapshots, result: snapshots };
  });
}
export async function importWebsiteSnapshots(raw: unknown) {
  return updateBrowserLocalData('website_snapshots', (current) => {
    const result = mergeWebsiteSnapshots(current, raw);
    const snapshots = bounded(result.snapshots);
    return { document: snapshots, result: { ...result, snapshots } };
  });
}
export async function exportWebsiteSnapshots(): Promise<void> {
  const body = serialiseWorkspacePortableJson(buildWebsiteSnapshotExport(await loadWebsiteSnapshots()));
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `whoisleuth-website-snapshots-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
