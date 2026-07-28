import {
  buildWebsiteSnapshotExport,
  deleteWebsiteSnapshot as removeSnapshot,
  mergeWebsiteSnapshots,
  saveWebsiteSnapshot as retainSnapshot,
  serializeWebsiteSnapshotStore,
  type WebsiteProfileSnapshot,
} from './analysis/website-snapshot-model.ts';
import { browserLocalDataProvider } from './browser-local-data-service.ts';
import { WEBSITE_SNAPSHOTS_COLLECTION } from './browser-local-data-definitions.ts';

export { MAX_WEBSITE_SNAPSHOT_IMPORT_BYTES } from './analysis/website-snapshot-model.ts';
export type { WebsiteProfileSnapshot, WebsiteSnapshotChange } from './analysis/website-snapshot-model.ts';
export { compareWebsiteSnapshots } from './analysis/website-snapshot-model.ts';

function bounded(values: WebsiteProfileSnapshot[]): WebsiteProfileSnapshot[] {
  return JSON.parse(serializeWebsiteSnapshotStore(values)).snapshots as WebsiteProfileSnapshot[];
}
export async function loadWebsiteSnapshots(): Promise<WebsiteProfileSnapshot[]> {
  return (await browserLocalDataProvider()).read(WEBSITE_SNAPSHOTS_COLLECTION) as Promise<WebsiteProfileSnapshot[]>;
}
export async function retainWebsiteSnapshot(raw: unknown): Promise<WebsiteProfileSnapshot[]> {
  return (await browserLocalDataProvider()).update(WEBSITE_SNAPSHOTS_COLLECTION, (current) => {
    const snapshots = bounded(retainSnapshot(current, raw));
    return { document: snapshots, result: snapshots };
  });
}
export async function deleteWebsiteSnapshot(id: string): Promise<WebsiteProfileSnapshot[]> {
  return (await browserLocalDataProvider()).update(WEBSITE_SNAPSHOTS_COLLECTION, (current) => {
    const snapshots = bounded(removeSnapshot(current, id));
    return { document: snapshots, result: snapshots };
  });
}
export async function importWebsiteSnapshots(raw: unknown) {
  return (await browserLocalDataProvider()).update(WEBSITE_SNAPSHOTS_COLLECTION, (current) => {
    const result = mergeWebsiteSnapshots(current, raw);
    const snapshots = bounded(result.snapshots);
    return { document: snapshots, result: { ...result, snapshots } };
  });
}
export async function exportWebsiteSnapshots(): Promise<void> {
  const body = JSON.stringify(buildWebsiteSnapshotExport(await loadWebsiteSnapshots()), null, 2);
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `whoisleuth-website-snapshots-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
