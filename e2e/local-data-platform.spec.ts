import { expect, test } from './fixtures';
import { runIndexedDbFeasibilityProbe } from '../frontend/src/lib/local-data-platform-probe';
import { readBrowserLocalCollection } from './helpers';

const SHORTLIST_KEY = 'whois-rdap-shortlist-v1';

function legacyShortlist() {
  return {
    schema: 'whoisleuth.shortlist',
    version: 2,
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
  };
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

test('legacy browser data migrates once into verified IndexedDB records without deleting the source', async ({ page }) => {
  const legacy = legacyShortlist();
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: SHORTLIST_KEY,
    value: legacy,
  });
  await page.goto('/bulk');

  const collection = await readBrowserLocalCollection(page, 'shortlist', { minimumRecords: 1 });
  expect(collection.manifest).toMatchObject({
    collection: 'shortlist',
    schemaVersion: 2,
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

test('application writes remain authoritative across reloads while the retained legacy source stays untouched', async ({ page }) => {
  const legacy = legacyShortlist();
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: SHORTLIST_KEY,
    value: legacy,
  });
  await page.goto('/bulk');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Clear shortlist' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Shortlist cleared.' })).toBeVisible();
  await page.reload();

  const collection = await readBrowserLocalCollection(page, 'shortlist', { minimumRevision: 2 });
  expect(collection.manifest).toMatchObject({ revision: 2, recordCount: 0, source: 'application' });
  expect(collection.records).toEqual([]);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), SHORTLIST_KEY)).toEqual(legacy);

  await page.goto('/dashboard');
  await page.getByText('How workspace backups work', { exact: true }).click();
  await page.getByRole('button', { name: 'Update legacy rollback copy' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Updated the legacy rollback copy' })).toBeVisible();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), SHORTLIST_KEY)).toEqual({
    schema: 'whoisleuth.shortlist',
    version: 2,
    entries: [],
  });
});

test('a tampered IndexedDB record stops the console instead of presenting an empty collection', async ({ page }) => {
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: SHORTLIST_KEY,
    value: legacyShortlist(),
  });
  await page.goto('/bulk');
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
    const recordRequest = store.get(['shortlist', 'priority.invalid']);
    const record = await new Promise<any>((resolve, reject) => {
      recordRequest.onsuccess = () => resolve(recordRequest.result);
      recordRequest.onerror = () => reject(recordRequest.error);
    });
    record.payload = record.payload.replace('priority.invalid', 'tampered.invalid');
    record.payloadBytes = new TextEncoder().encode(record.payload).byteLength;
    store.put(record);
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

test('an older IndexedDB collection schema is normalized and recommitted at the current version', async ({ page }) => {
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: SHORTLIST_KEY,
    value: legacyShortlist(),
  });
  await page.goto('/bulk');
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
    const manifestRequest = store.get('shortlist');
    const manifest = await new Promise<any>((resolve, reject) => {
      manifestRequest.onsuccess = () => resolve(manifestRequest.result);
      manifestRequest.onerror = () => reject(manifestRequest.error);
    });
    manifest.schemaVersion = 1;
    store.put(manifest);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => undefined;
    });
    database.close();
  });
  await page.reload();

  const collection = await readBrowserLocalCollection(page, 'shortlist', { minimumRecords: 1, minimumRevision: 2 });
  expect(collection.manifest).toMatchObject({ schemaVersion: 2, revision: 2, source: 'application' });
  expect(collection.records.map((entry) => entry.value.domain)).toEqual(['priority.invalid']);
});
