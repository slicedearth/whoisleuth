import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

// A few px of tolerance for subpixel layout rounding across engines.
const OVERFLOW_TOLERANCE_PX = 1;
const THEME_STORAGE_KEY = 'whoisleuth:theme:v1';
const LOCAL_DATA_DATABASE_NAME = 'whoisleuth-browser-data-v1';

type LegacyStorageValue = string | number | boolean | null | Record<string, unknown> | unknown[];

type BrowserLocalCollectionSnapshot = {
  manifest: any;
  records: any[];
};

type BrowserLocalCollectionReadOptions = Readonly<{
  minimumRecords?: number;
  minimumRevision?: number;
  timeout?: number;
}>;

export async function useTheme(page: Page, preference: 'dark' | 'light' | 'system') {
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, value);
  }, { key: THEME_STORAGE_KEY, value: preference });
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + OVERFLOW_TOLERANCE_PX);
}

export async function boundingBox(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box, 'expected element to have a rendered bounding box').not.toBeNull();
  return box!;
}

async function tryReadBrowserLocalCollection(
  page: Page,
  collection: string,
): Promise<BrowserLocalCollectionSnapshot | null> {
  return page.evaluate(async ({ databaseName, collectionId }) => {
    if (typeof indexedDB.databases !== 'function') {
      throw new Error('The browser does not support non-creating IndexedDB discovery.');
    }
    const databases = await indexedDB.databases();
    if (!databases.some((database) => database.name === databaseName)) return null;

    const request = indexedDB.open(databaseName);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!database.objectStoreNames.contains('records')
        || !database.objectStoreNames.contains('manifests')) return null;

      const transaction = database.transaction(['records', 'manifests'], 'readonly');
      const manifestRequest = transaction.objectStore('manifests').get(collectionId);
      const recordRequest = transaction.objectStore('records').index('collection').getAll(collectionId);
      const [manifest, records] = await Promise.all([
        new Promise<any>((resolve, reject) => {
          manifestRequest.onsuccess = () => resolve(manifestRequest.result);
          manifestRequest.onerror = () => reject(manifestRequest.error);
        }),
        new Promise<any[]>((resolve, reject) => {
          recordRequest.onsuccess = () => resolve(recordRequest.result);
          recordRequest.onerror = () => reject(recordRequest.error);
        }),
      ]);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => undefined;
      });
      if (!manifest) return null;
      return {
        manifest,
        records: records
          .sort((left, right) => left.ordinal - right.ordinal)
          .map((record) => JSON.parse(record.payload)),
      };
    } finally {
      database.close();
    }
  }, { databaseName: LOCAL_DATA_DATABASE_NAME, collectionId: collection });
}

export async function readBrowserLocalCollection(
  page: Page,
  collection: string,
  options: BrowserLocalCollectionReadOptions = {},
) {
  const minimumRecords = options.minimumRecords ?? 0;
  const minimumRevision = options.minimumRevision ?? 1;
  let snapshot: BrowserLocalCollectionSnapshot | null = null;

  await expect.poll(async () => {
    snapshot = await tryReadBrowserLocalCollection(page, collection);
    return snapshot !== null
      && snapshot.records.length >= minimumRecords
      && Number(snapshot.manifest?.revision) >= minimumRevision;
  }, {
    message: `waiting for the ${collection} IndexedDB collection to be ready`,
    timeout: options.timeout ?? 5_000,
  }).toBe(true);

  return snapshot!;
}

/**
 * Recreates a browser that has legacy localStorage data but has not completed
 * the IndexedDB migration yet. This is intentionally test-only: production
 * code migrates once and then treats IndexedDB as authoritative.
 */
export async function migrateLegacyBrowserData(
  page: Page,
  entries: Record<string, LegacyStorageValue>,
  options: Readonly<{ clearStorage?: boolean }> = {},
) {
  const current = new URL(page.url());
  const destination = `${current.pathname}${current.search}${current.hash}`;
  // Use a full document navigation before deleting the database. That closes
  // the console document and its live IndexedDB connection, so the fixture
  // cannot trigger transient "connection is closing" errors in page code.
  await page.goto('/');
  await page.evaluate(async ({ databaseName, values, clearStorage }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error(`Could not reset ${databaseName} for the migration fixture.`));
    });
    if (clearStorage) localStorage.clear();
    for (const [key, value] of Object.entries(values)) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
  }, { databaseName: LOCAL_DATA_DATABASE_NAME, values: entries, clearStorage: options.clearStorage === true });
  await page.goto(destination);
}

export async function failBrowserLocalManifestWrites(page: Page, collection: string) {
  await page.evaluate((collectionId) => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === 'manifests'
        && value !== null
        && typeof value === 'object'
        && (value as { collection?: unknown }).collection === collectionId) {
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      }
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    };
  }, collection);
}

// Computed content of a pseudo-element - used to check the CSS-only
// data-label treatment that only applies to Bulk's stacked mobile cards.
export async function pseudoContent(locator: Locator, pseudo: '::before' | '::after') {
  return locator.evaluate((el, p) => window.getComputedStyle(el, p).content, pseudo);
}

// Fills Bulk's domain queue and runs it to completion. Shared by every Bulk
// spec that needs a finished scan rather than just the empty queue state.
export async function runBulkScan(page: Page, domains: string[]) {
  await page.locator('#domains').fill(domains.join('\n'));
  await page.getByRole('button', { name: `Scan ${domains.length} domain${domains.length === 1 ? '' : 's'}` }).click();
  await expect(page.locator('.status')).toHaveText(`Completed ${domains.length} of ${domains.length} lookups.`, {
    timeout: 20_000,
  });
}
