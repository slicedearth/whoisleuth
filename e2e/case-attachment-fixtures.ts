import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { openCaseSection } from './console-navigation';

export const FILE_BYTES = Buffer.from('{"observation":"A deliberately retained original, not an inferred verdict."}\n');
export const FILE_NAME = 'original-observation.json';

export async function openRetainedFiles(page: Page) {
  await openCaseSection(page, 'Evidence');
  const files = page.locator('.case-files');
  if (await files.getAttribute('open') === null) await files.locator(':scope > summary').click();
  await expect(files.getByLabel('Choose original files', { exact: true })).toBeEnabled();
  return files;
}

export async function selectOriginal(page: Page, name = FILE_NAME, bytes = FILE_BYTES) {
  const files = await openRetainedFiles(page);
  await files.getByLabel('Choose original files', { exact: true }).setInputFiles({ name, mimeType: 'application/json', buffer: bytes });
  await expect(files.getByRole('heading', { name: '1 selected · not saved', exact: true })).toBeVisible();
  return files;
}

/** Independent persisted bytes, not the application's decoder or projections. */
export async function storedFiles(page: Page, name = 'whoisleuth-browser-data-v1') {
  return page.evaluate(async databaseName => {
    const request = indexedDB.open(databaseName);
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const transaction = database.transaction('files', 'readonly');
      const rows = transaction.objectStore('files').getAll();
      await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); });
      if (rows.result.length > 10) throw new Error('The synthetic file fixture exceeded its inspection bound.');
      return (rows.result as { key: string[]; collection: string; lookupKey: string; codec: string; payload: ArrayBuffer }[]).map(row => {
        if (!(row.payload instanceof ArrayBuffer) || row.payload.byteLength > 4096) throw new Error('Unexpected fixture body.');
        return { key: row.key, collection: row.collection, lookupKey: row.lookupKey, codec: row.codec, bytes: Array.from(new Uint8Array(row.payload)) };
      });
    } finally { database.close(); }
  }, name);
}

export async function failNextFileWrite(page: Page) {
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    let pending = true;
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      if (pending && this.name === 'files') { pending = false; throw new DOMException('File quota fixture', 'QuotaExceededError'); }
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
  });
}
