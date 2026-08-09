import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import type {
  BrowserLocalCollectionManifest,
  BrowserLocalStoredRecord,
} from '../frontend/src/lib/browser-local-data';
import { decodeBrowserLocalCollectionRecord } from '../frontend/src/lib/browser-local-data-definitions';
import type {
  BrowserLocalDecodedCollectionRecord,
  BrowserLocalCollectionId,
} from '../frontend/src/lib/browser-local-data-definitions';
import { WHOISLEUTH_SOURCE_REPOSITORY_URL } from '../lib/project-metadata.mts';

// A few px of tolerance for subpixel layout rounding across engines.
const OVERFLOW_TOLERANCE_PX = 1;
const THEME_STORAGE_KEY = 'whoisleuth:theme:v1';
const LOCAL_DATA_DATABASE_NAME = 'whoisleuth-browser-data-v1';

type LegacyStorageValue = string | number | boolean | null | Record<string, unknown> | unknown[];

type BrowserLocalCollectionSnapshot<Collection extends BrowserLocalCollectionId> = {
  manifest: BrowserLocalCollectionManifest;
  records: BrowserLocalDecodedCollectionRecord<Collection>[];
};

type RawBrowserLocalCollectionSnapshot = {
  manifest: BrowserLocalCollectionManifest;
  records: BrowserLocalStoredRecord[];
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
    const offenders = [...document.querySelectorAll<HTMLElement>('body *')]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.classList.length ? `.${[...element.classList].join('.')}` : ''}`,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((item) => item.right > doc.clientWidth + 1 || item.left < -1)
      .slice(0, 8);
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, offenders };
  });
  expect(
    overflow.scrollWidth,
    `horizontal overflow: ${JSON.stringify(overflow.offenders)}`,
  ).toBeLessThanOrEqual(overflow.clientWidth + OVERFLOW_TOLERANCE_PX);
}

export async function expandLookupFamilies(page: Page): Promise<void> {
  const expandAll = page
    .getByRole('group', { name: 'Evidence family visibility' })
    .getByRole('button', { name: 'Expand all' });
  await expect(expandAll).toBeEnabled();
  await expandAll.click();
}

export async function expectNoHorizontalScrollContainers(locator: Locator) {
  const offenders = await locator.evaluate((root) => {
    const elements = root instanceof HTMLElement
      ? [root, ...root.querySelectorAll<HTMLElement>('*')]
      : [...root.querySelectorAll<HTMLElement>('*')];
    return elements
      .filter((element) => {
        const { overflowX } = getComputedStyle(element);
        return (overflowX === 'auto' || overflowX === 'scroll')
          && element.clientWidth > 0
          && element.scrollWidth > element.clientWidth + 1;
      })
      .slice(0, 8)
      .map((element) => ({
        element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.classList.length ? `.${[...element.classList].join('.')}` : ''}`,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
  });
  expect(
    offenders,
    `nested horizontal scroll containers: ${JSON.stringify(offenders)}`,
  ).toEqual([]);
}

export async function boundingBox(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box, 'expected element to have a rendered bounding box').not.toBeNull();
  return box!;
}

export async function expectVersionedSourceLink(locator: Locator) {
  const href = await locator.getAttribute('href');
  expect(href, 'expected an exact deployed-source link').not.toBeNull();
  const actual = new URL(href!);
  const repository = new URL(WHOISLEUTH_SOURCE_REPOSITORY_URL);
  const revisionPrefix = `${repository.pathname.replace(/\/$/u, '')}/tree/`;
  expect(actual.origin).toBe(repository.origin);
  expect(actual.pathname.startsWith(revisionPrefix)).toBe(true);
  expect(actual.pathname.slice(revisionPrefix.length)).toMatch(/^[a-f0-9]{40}$/u);
  expect(actual.search).toBe('');
  expect(actual.hash).toBe('');
}

export function requiredValue<Value>(
  value: Value | null | undefined,
  message: string,
): Value {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

async function tryReadBrowserLocalCollection<Collection extends BrowserLocalCollectionId>(
  page: Page,
  collection: Collection,
): Promise<BrowserLocalCollectionSnapshot<Collection> | null> {
  const snapshot = await page.evaluate(async ({
    databaseName,
    collectionId,
  }): Promise<RawBrowserLocalCollectionSnapshot | null> => {
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
      const manifestRequest = transaction.objectStore('manifests').get(collectionId) as
        IDBRequest<BrowserLocalCollectionManifest | undefined>;
      const recordRequest = transaction.objectStore('records').index('collection').getAll(collectionId) as
        IDBRequest<BrowserLocalStoredRecord[]>;
      const [manifest, records] = await Promise.all([
        new Promise<BrowserLocalCollectionManifest | undefined>((resolve, reject) => {
          manifestRequest.onsuccess = () => resolve(manifestRequest.result);
          manifestRequest.onerror = () => reject(manifestRequest.error);
        }),
        new Promise<BrowserLocalStoredRecord[]>((resolve, reject) => {
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
        records: records.sort((left, right) => left.ordinal - right.ordinal),
      };
    } finally {
      database.close();
    }
  }, { databaseName: LOCAL_DATA_DATABASE_NAME, collectionId: collection });
  if (!snapshot) return null;
  return {
    manifest: snapshot.manifest,
    records: await Promise.all(snapshot.records.map((record) => (
      decodeBrowserLocalCollectionRecord(collection, record, snapshot.manifest)
    ))),
  };
}

export async function readBrowserLocalCollection<Collection extends BrowserLocalCollectionId>(
  page: Page,
  collection: Collection,
  options: BrowserLocalCollectionReadOptions = {},
): Promise<BrowserLocalCollectionSnapshot<Collection>> {
  const minimumRecords = options.minimumRecords ?? 0;
  const minimumRevision = options.minimumRevision ?? 1;
  let snapshot: BrowserLocalCollectionSnapshot<Collection> | null = null;

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
  options: Readonly<{ clearStorage?: boolean; destination?: string }> = {},
) {
  const current = options.destination ? null : new URL(page.url());
  const destination = options.destination
    ?? `${current?.pathname ?? '/'}${current?.search ?? ''}${current?.hash ?? ''}`;
  // Use a static same-origin document before deleting the database. That
  // closes any live IndexedDB connection without starting another application
  // session or storage load that the fixture would immediately abort.
  await page.goto('/robots.txt');
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

export async function failBrowserLocalReads(page: Page) {
  await page.evaluate(() => {
    const originalGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function get(query: IDBValidKey | IDBKeyRange) {
      if (this.name === 'manifests') {
        throw new DOMException('Browser-local reads are unavailable', 'InvalidStateError');
      }
      return originalGet.call(this, query);
    };
  });
}

export async function failBrowserLocalCollectionReads(
  page: Page,
  collection: BrowserLocalCollectionId,
) {
  const installFailure = (collectionId: BrowserLocalCollectionId) => {
    const originalGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function get(query: IDBValidKey | IDBKeyRange) {
      if (this.name === 'manifests' && query === collectionId) {
        throw new DOMException(`Browser-local ${collectionId} reads are unavailable`, 'InvalidStateError');
      }
      return originalGet.call(this, query);
    };
  };
  await page.evaluate(installFailure, collection);
}

export async function failNextBrowserLocalCollectionRead(
  page: Page,
  collection: BrowserLocalCollectionId,
) {
  await page.evaluate((collectionId) => {
    const originalGet = IDBObjectStore.prototype.get;
    let pending = true;
    IDBObjectStore.prototype.get = function get(query: IDBValidKey | IDBKeyRange) {
      if (pending && this.name === 'manifests' && query === collectionId) {
        pending = false;
        throw new DOMException(`Browser-local ${collectionId} read is unavailable once`, 'InvalidStateError');
      }
      return originalGet.call(this, query);
    };
  }, collection);
}

export async function failNextBrowserLocalCollectionReadAfterWrite(
  page: Page,
  collection: BrowserLocalCollectionId,
) {
  await page.evaluate((collectionId) => {
    const originalGet = IDBObjectStore.prototype.get;
    const originalPut = IDBObjectStore.prototype.put;
    let failNextRead = false;
    IDBObjectStore.prototype.put = function put(value: unknown, key?: IDBValidKey) {
      if (this.name === 'manifests'
        && value
        && typeof value === 'object'
        && Reflect.get(value, 'collection') === collectionId) failNextRead = true;
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    };
    IDBObjectStore.prototype.get = function get(query: IDBValidKey | IDBKeyRange) {
      if (failNextRead && this.name === 'manifests' && query === collectionId) {
        failNextRead = false;
        throw new DOMException(`Browser-local ${collectionId} post-write read is unavailable`, 'InvalidStateError');
      }
      return originalGet.call(this, query);
    };
  }, collection);
}

export async function holdBrowserLocalReads(page: Page, delayMs = 750, triggerSelector?: string) {
  await page.evaluate(({ databaseName, delay, selector }) => new Promise<void>((resolve, reject) => {
    const trigger = selector ? document.querySelector<HTMLElement>(selector) : null;
    if (selector && !trigger) {
      reject(new Error(`Could not find the browser-local read hold trigger: ${selector}`));
      return;
    }
    const readyDeadline = performance.now() + 5_000;
    const openReadyDatabase = () => {
      const openRequest = indexedDB.open(databaseName);
      let abortedEmptyCreation = false;
      openRequest.onupgradeneeded = () => {
        // Production owns schema creation. Aborting here keeps this timing
        // helper from winning the race and creating an empty test database.
        abortedEmptyCreation = true;
        openRequest.transaction?.abort();
      };
      openRequest.onerror = () => {
        if (abortedEmptyCreation && performance.now() < readyDeadline) {
          window.requestAnimationFrame(() => openReadyDatabase());
          return;
        }
        reject(openRequest.error);
      };
      openRequest.onsuccess = () => {
        const database = openRequest.result;
        if (!database.objectStoreNames.contains('manifests')) {
          database.close();
          if (performance.now() < readyDeadline) {
            window.requestAnimationFrame(() => openReadyDatabase());
            return;
          }
          reject(new Error('Browser-local manifests store was not ready before the read hold deadline.'));
          return;
        }
        const transaction = database.transaction('manifests', 'readwrite');
        const store = transaction.objectStore('manifests');
        const releaseAt = performance.now() + delay;
        let started = false;
        const keepAlive = () => {
          const request = store.get('__playwright_read_hold__');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            if (!started) {
              started = true;
              // Trigger inside the page task that observes the active hold so
              // constrained full-suite workers cannot let a timed hold expire
              // between separate host-side Playwright commands.
              trigger?.click();
              resolve();
            }
            if (performance.now() < releaseAt) keepAlive();
            else database.close();
          };
        };
        keepAlive();
      };
    };
    openReadyDatabase();
  }), { databaseName: LOCAL_DATA_DATABASE_NAME, delay: delayMs, selector: triggerSelector });
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
