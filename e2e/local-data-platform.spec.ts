import { expect, test } from './fixtures';
import { runIndexedDbFeasibilityProbe } from '../frontend/src/lib/local-data-platform-probe';
import { currentBrowserLocalDocument, openBulkShortlist, openDashboardSecondaryWorkspaces, readBrowserLocalCollection } from './helpers';
import type {
  BrowserLocalCollectionManifest,
  BrowserLocalStoredRecord,
} from '../frontend/src/lib/browser-local-data';
import {
  CAMPAIGNS_COLLECTION,
  CASES_COLLECTION,
} from '../frontend/src/lib/browser-local-data-definitions';

const SHORTLIST_KEY = 'whois-rdap-shortlist-v1';

function publicShortlist() {
  return currentBrowserLocalDocument('shortlist', {
    entries: [{
      domain: 'priority.invalid',
      scanDepth: 'fast',
      availability: 'registered',
      riskModelVersion: 5,
      riskScore: 40,
      opportunityScore: 20,
      mutationTypes: ['omission'],
      savedAt: '2026-07-22T01:00:00.000Z',
    }],
  });
}

async function rawLocalDataSnapshot(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(async () => {
    const request = indexedDB.open('whoisleuth-browser-data-v1');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction(['manifests', 'records'], 'readonly');
      const manifestRequest = transaction.objectStore('manifests').getAll() as IDBRequest<BrowserLocalCollectionManifest[]>;
      const recordRequest = transaction.objectStore('records').getAll() as IDBRequest<BrowserLocalStoredRecord[]>;
      const [manifests, records] = await Promise.all([
        new Promise<BrowserLocalCollectionManifest[]>((resolve, reject) => {
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
      return JSON.stringify({ manifests, records });
    } finally {
      database.close();
    }
  });
}

test('native IndexedDB satisfies the bounded local data feasibility probe', async ({ page }) => {
  await page.goto('/dashboard');
  const result = await page.evaluate(runIndexedDbFeasibilityProbe);

  expect(result).toEqual({
    supported: true,
    opened: true,
    transactionCommitted: true,
    keyedReadMatched: true,
    indexedCollectionReadMatched: true,
    abortedTransactionRolledBack: true,
    deleteMatched: true,
    cleanupSucceeded: true,
    error: null,
  });

  const retainedProbeDatabases = await page.evaluate(async () => {
    const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    return databases
      .map((database) => database.name || '')
      .filter((name) => name.startsWith('whoisleuth-local-data-probe-'));
  });
  expect(retainedProbeDatabases).toEqual([]);
});

test('public browser data migrates once into verified IndexedDB records without deleting the source', async ({ page }) => {
  const legacy = publicShortlist();
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: SHORTLIST_KEY,
    value: legacy,
  });
  await page.goto('/bulk');

  const collection = await readBrowserLocalCollection(page, 'shortlist', { minimumRecords: 1 });
  expect(collection.manifest).toMatchObject({
    collection: 'shortlist',
    schemaVersion: 3,
    codec: 'json-v1',
    revision: 1,
    recordCount: 1,
    source: 'legacy-localstorage',
    legacyKey: SHORTLIST_KEY,
  });
  expect(collection.manifest.digest).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(collection.manifest.legacyDigest).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(collection.records.map((entry) => entry.value.domain)).toEqual(['priority.invalid']);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), SHORTLIST_KEY)).toEqual(legacy);
});

test('malformed legacy data remains unavailable and is never replaced with an authoritative empty collection', async ({ page }) => {
  const malformed = '{"schema":"whoisleuth.shortlist","entries":[';
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: SHORTLIST_KEY,
    value: malformed,
  });

  await page.goto('/bulk');

  await expect(page.getByRole('heading', { name: 'Browser-local data unavailable' })).toBeVisible();
  await expect(page.getByText('Legacy Shortlist data is malformed and was not migrated.')).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), SHORTLIST_KEY)).toBe(malformed);
  expect(JSON.parse(await rawLocalDataSnapshot(page))).toEqual({ manifests: [], records: [] });
});

test('wrong-shaped legacy data remains unavailable and is never normalized to an empty collection', async ({ page }) => {
  const malformed = '{}';
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: SHORTLIST_KEY,
    value: malformed,
  });

  await page.goto('/bulk');

  await expect(page.getByRole('heading', { name: 'Browser-local data unavailable' })).toBeVisible();
  await expect(page.getByText('Legacy Shortlist data is malformed and was not migrated.')).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), SHORTLIST_KEY)).toBe(malformed);
  expect(JSON.parse(await rawLocalDataSnapshot(page))).toEqual({ manifests: [], records: [] });
});

test('retired unversioned Case stores remain preserved and unavailable during migration', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, '[]'), CASES_COLLECTION.legacyKey);

  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Browser-local data unavailable' })).toBeVisible();
  await expect(page.getByText('Unversioned Cases data is retired. Export it with the last broad-reader release or choose an explicit reset before continuing; no data was changed.')).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), CASES_COLLECTION.legacyKey)).toBe('[]');
  expect(JSON.parse(await rawLocalDataSnapshot(page))).toEqual({ manifests: [], records: [] });
});

test('application writes remain authoritative across reloads while the retained legacy source stays untouched', async ({ page }) => {
  const legacy = publicShortlist();
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: SHORTLIST_KEY,
    value: legacy,
  });
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: CAMPAIGNS_COLLECTION.legacyKey,
    value: currentBrowserLocalDocument('campaigns', {
      campaigns: [{
        id: 'rollback-tools-campaign',
        name: 'Rollback tools fixture',
        description: '',
        domains: [],
        createdAt: '2026-07-22T01:00:00.000Z',
        updatedAt: '2026-07-22T01:00:00.000Z',
      }],
    }),
  });
  await page.goto('/bulk');
  await openBulkShortlist(page);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Clear shortlist' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Shortlist cleared.' })).toBeVisible();
  await page.reload();

  const collection = await readBrowserLocalCollection(page, 'shortlist', { minimumRevision: 2 });
  expect(collection.manifest).toMatchObject({ revision: 2, recordCount: 0, source: 'application' });
  expect(collection.records).toEqual([]);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), SHORTLIST_KEY)).toEqual(legacy);

  await page.goto('/dashboard');
  await openDashboardSecondaryWorkspaces(page);
  await page.getByText('How workspace backups work', { exact: true }).click();
  await page.getByRole('button', { name: 'Update legacy rollback copy' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Updated the legacy rollback copy' })).toBeVisible();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), SHORTLIST_KEY)).toEqual({
    schema: 'whoisleuth.shortlist',
    version: 3,
    entries: [],
  });
});

test('a tampered IndexedDB record stops the console instead of presenting an empty collection', async ({ page }) => {
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: SHORTLIST_KEY,
    value: publicShortlist(),
  });
  await page.goto('/bulk');
  await openBulkShortlist(page);
  await expect(page.getByRole('button', { name: 'Clear shortlist' })).toBeVisible();
  await readBrowserLocalCollection(page, 'shortlist', { minimumRecords: 1 });
  await page.evaluate(async () => {
    const request = indexedDB.open('whoisleuth-browser-data-v1');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('records', 'readwrite');
    const store = transaction.objectStore('records');
    const recordRequest = store.get(['shortlist', 'priority.invalid']) as
      IDBRequest<BrowserLocalStoredRecord | undefined>;
    const record = await new Promise<BrowserLocalStoredRecord | undefined>((resolve, reject) => {
      recordRequest.onsuccess = () => resolve(recordRequest.result);
      recordRequest.onerror = () => reject(recordRequest.error);
    });
    if (!record) throw new Error('The shortlist test record is missing.');
    const payload = record.payload.replace('priority.invalid', 'tampered.invalid');
    store.put({
      ...record,
      payload,
      payloadBytes: new TextEncoder().encode(payload).byteLength,
    } satisfies BrowserLocalStoredRecord);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => undefined;
    });
    database.close();
  });
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Browser-local data unavailable' })).toBeVisible();
  await expect(page.getByText('Shortlist contains a record that could not be verified.')).toBeVisible();
});

test('a retired local-only IndexedDB schema remains preserved and unavailable', async ({ page }) => {
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: SHORTLIST_KEY,
    value: publicShortlist(),
  });
  await page.goto('/bulk');
  await openBulkShortlist(page);
  await expect(page.getByRole('button', { name: 'Clear shortlist' })).toBeVisible();
  await readBrowserLocalCollection(page, 'shortlist', { minimumRecords: 1 });
  await page.evaluate(async () => {
    const request = indexedDB.open('whoisleuth-browser-data-v1');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('manifests', 'readwrite');
    const store = transaction.objectStore('manifests');
    const manifestRequest = store.get('shortlist') as
      IDBRequest<BrowserLocalCollectionManifest | undefined>;
    const manifest = await new Promise<BrowserLocalCollectionManifest | undefined>((resolve, reject) => {
      manifestRequest.onsuccess = () => resolve(manifestRequest.result);
      manifestRequest.onerror = () => reject(manifestRequest.error);
    });
    if (!manifest) throw new Error('The shortlist test manifest is missing.');
    store.put({ ...manifest, schemaVersion: 1 } satisfies BrowserLocalCollectionManifest);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => undefined;
    });
    database.close();
  });
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Browser-local data unavailable' })).toBeVisible();
  await expect(page.getByText('Shortlist schema 1 is retired. Restore or export it with the last broad-reader release, or choose an explicit reset; no data was changed.')).toBeVisible();
  const retained = JSON.parse(await rawLocalDataSnapshot(page)) as {
    manifests: BrowserLocalCollectionManifest[];
    records: BrowserLocalStoredRecord[];
  };
  expect(retained.manifests.find((manifest) => manifest.collection === 'shortlist')).toMatchObject({
    schemaVersion: 1,
    revision: 1,
    recordCount: 1,
    source: 'legacy-localstorage',
  });
  expect(retained.records).toHaveLength(1);
  expect(retained.records[0]?.payload).toContain('priority.invalid');
});

test('initialization validates every existing collection before writing a missing collection', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await page.evaluate(async ({ casesId, campaignsId, futureVersion }) => {
    const request = indexedDB.open('whoisleuth-browser-data-v1');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(['manifests', 'records'], 'readwrite');
    const manifests = transaction.objectStore('manifests');
    const records = transaction.objectStore('records');
    const campaignRequest = manifests.get(campaignsId) as IDBRequest<BrowserLocalCollectionManifest | undefined>;
    const campaignManifest = await new Promise<BrowserLocalCollectionManifest | undefined>((resolve, reject) => {
      campaignRequest.onsuccess = () => resolve(campaignRequest.result);
      campaignRequest.onerror = () => reject(campaignRequest.error);
    });
    if (!campaignManifest) throw new Error('The fixture campaign manifest is missing.');
    records.delete(IDBKeyRange.bound([casesId], [casesId, []]));
    manifests.delete(casesId);
    manifests.put({ ...campaignManifest, schemaVersion: futureVersion });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => undefined;
    });
    database.close();
  }, {
    casesId: CASES_COLLECTION.id,
    campaignsId: CAMPAIGNS_COLLECTION.id,
    futureVersion: CAMPAIGNS_COLLECTION.schemaVersion + 1,
  });
  const beforeReload = await rawLocalDataSnapshot(page);

  await page.reload();

  await expect(page.getByRole('heading', { name: 'Browser-local data unavailable' })).toBeVisible();
  await expect(page.getByText('Campaigns schema 2 was created by a newer app version. Update the app before reading it; no data was changed.')).toBeVisible();
  expect(await rawLocalDataSnapshot(page)).toBe(beforeReload);
});

test('collection reads use a bounded cursor and stop at the configured maximum', async ({ page }) => {
  await page.addInitScript(({ casesId }) => {
    const originalOpenCursor = IDBIndex.prototype.openCursor;
    const originalGetAll = IDBIndex.prototype.getAll;
    const originalContinue = IDBCursor.prototype.continue;
    const calls = { openCursor: [] as Array<string | null>, getAll: [] as Array<string | null>, casesContinued: 0 };
    Object.defineProperty(window, '__whoisleuthCursorCalls', { value: calls, configurable: true });
    IDBIndex.prototype.openCursor = function openCursor(query?: IDBValidKey | IDBKeyRange | null, direction?: IDBCursorDirection) {
      calls.openCursor.push(typeof query === 'string' ? query : null);
      return originalOpenCursor.call(this, query, direction);
    };
    IDBIndex.prototype.getAll = function getAll(query?: IDBValidKey | IDBKeyRange | null, count?: number) {
      calls.getAll.push(typeof query === 'string' ? query : null);
      return originalGetAll.call(this, query, count);
    };
    IDBCursor.prototype.continue = function continueCursor(key?: IDBValidKey) {
      if (this.key === casesId) calls.casesContinued += 1;
      return key === undefined ? originalContinue.call(this) : originalContinue.call(this, key);
    };
  }, { casesId: CASES_COLLECTION.id });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await page.evaluate(async ({ collection, maximumRecords }) => {
    const request = indexedDB.open('whoisleuth-browser-data-v1');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(['manifests', 'records'], 'readwrite');
    const manifests = transaction.objectStore('manifests');
    const records = transaction.objectStore('records');
    const manifestRequest = manifests.get(collection) as IDBRequest<BrowserLocalCollectionManifest | undefined>;
    const manifest = await new Promise<BrowserLocalCollectionManifest | undefined>((resolve, reject) => {
      manifestRequest.onsuccess = () => resolve(manifestRequest.result);
      manifestRequest.onerror = () => reject(manifestRequest.error);
    });
    if (!manifest) throw new Error('The fixture cases manifest is missing.');
    records.delete(IDBKeyRange.bound([collection], [collection, []]));
    for (let ordinal = 0; ordinal < maximumRecords; ordinal++) {
      const lookupKey = `record-${String(ordinal).padStart(6, '0')}`;
      records.put({
        key: [collection, lookupKey],
        collection,
        lookupKey,
        ordinal,
        codec: 'json-v1',
        payload: '{}',
        payloadBytes: 2,
      } satisfies BrowserLocalStoredRecord);
    }
    const lookupKey = 'zzzz-overflow';
    records.put({
      key: [collection, lookupKey],
      collection,
      lookupKey,
      ordinal: maximumRecords,
      codec: 'json-v1',
      payload: '{}',
      payloadBytes: 2,
    } satisfies BrowserLocalStoredRecord);
    manifests.put({ ...manifest, recordCount: maximumRecords });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => undefined;
    });
    database.close();
  }, { collection: CASES_COLLECTION.id, maximumRecords: CASES_COLLECTION.maximumRecords });

  await page.reload();

  await expect(page.getByRole('heading', { name: 'Browser-local data unavailable' })).toBeVisible();
  await expect(page.getByText('Cases exceeds its bounded record count.')).toBeVisible();
  const calls = await page.evaluate(() => (
    window as typeof window & {
      __whoisleuthCursorCalls?: { openCursor: Array<string | null>; getAll: Array<string | null>; casesContinued: number };
    }
  ).__whoisleuthCursorCalls);
  expect(calls?.openCursor).toContain(CASES_COLLECTION.id);
  expect(calls?.getAll).not.toContain(CASES_COLLECTION.id);
  expect(calls?.casesContinued).toBe(CASES_COLLECTION.maximumRecords);
});
