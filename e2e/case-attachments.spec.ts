import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { createCase, openCasesView } from './case-test-fixtures';
import { openCaseSection } from './console-navigation';
import { readBrowserLocalCollection, failNextBrowserLocalManifestWrite, failNextBrowserLocalCollectionReadAfterWrite, expectNoHorizontalOverflow, useTheme } from './helpers';
import { FILE_BYTES, FILE_NAME, openRetainedFiles, selectOriginal, storedFiles, failNextFileWrite } from './case-attachment-fixtures';

test('selected originals require a deliberate atomic save and preserve drafts across failure and section changes', async ({ page }, testInfo) => {
  await openCasesView(page); await createCase(page, 'attachment.example');
  const before = await readBrowserLocalCollection(page, 'cases');
  let files = await selectOriginal(page);
  await files.getByLabel('Source', { exact: true }).fill('Analyst-selected fixture');
  await files.getByLabel('Observed at (UTC)', { exact: true }).fill('2026-08-01T12:30');
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  expect(await storedFiles(page)).toEqual([]);
  await openCaseSection(page, 'Assessment'); await openRetainedFiles(page);
  await expect(files.getByLabel('Source', { exact: true })).toHaveValue('Analyst-selected fixture');
  for (const fail of [failNextBrowserLocalManifestWrite, async (target: typeof page) => failNextFileWrite(target)]) {
    await fail(page, 'cases');
    await files.getByRole('button', { name: 'Retain selected files', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'out of storage space' })).toBeVisible();
    expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
    expect(await storedFiles(page)).toEqual([]);
    await expect(files.getByRole('heading', { name: '1 selected · not saved', exact: true })).toBeVisible();
    await expect(files.getByLabel('Source', { exact: true })).toHaveValue('Analyst-selected fixture');
  }
  await failNextBrowserLocalCollectionReadAfterWrite(page, 'cases');
  await files.getByRole('button', { name: 'Retain selected files', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'The change was saved, but Cases could not be reread' })).toBeVisible();
  await expect(files.getByRole('button', { name: 'Retain selected files', exact: true })).toHaveCount(0);
  const saved = await readBrowserLocalCollection(page, 'cases', { minimumRevision: before.manifest.revision + 1 });
  expect(saved.manifest.revision).toBe(before.manifest.revision + 1);
  expect(saved.records[0]!.value.attachments).toEqual([expect.objectContaining({ fileName: FILE_NAME, source: 'Analyst-selected fixture', observedAt: '2026-08-01T12:30:00.000Z', byteLength: FILE_BYTES.length, digestSha256: `sha256:${createHash('sha256').update(FILE_BYTES).digest('hex')}` })]);
  expect((await storedFiles(page))[0]!.bytes).toEqual([...FILE_BYTES]);
  await page.reload(); files = await openRetainedFiles(page);
  const preview = files.getByRole('button', { name: `Preview ${FILE_NAME}`, exact: true });
  await preview.focus(); await page.keyboard.press('Enter');
  await expect(files.locator('pre')).toContainText('A deliberately retained original');
  await files.getByRole('button', { name: 'Close file preview', exact: true }).click();
  await expect(preview).toBeFocused();
  const download = page.waitForEvent('download');
  await files.getByRole('button', { name: `Download original ${FILE_NAME}`, exact: true }).click();
  const result = await download;
  expect(result.suggestedFilename()).toBe(FILE_NAME);
  expect(await readFile((await result.path())!)).toEqual(FILE_BYTES);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 2560]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      await files.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      await expect(preview).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`retained-files-${theme}-${width}.png`) });
    }
    expect((await new AxeBuilder({ page }).include('.case-files').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  }
});

test('shared original bytes retain independent provenance and survive removal of only one Case', async ({ page }) => {
  await openCasesView(page); await createCase(page, 'first-file.example');
  let files = await selectOriginal(page);
  await files.getByLabel('Source', { exact: true }).fill('First observation');
  await files.getByRole('button', { name: 'Retain selected files', exact: true }).click();
  await expect(files.getByRole('button', { name: `Preview ${FILE_NAME}`, exact: true })).toBeVisible();
  await createCase(page, 'second-file.example'); files = await selectOriginal(page, 'independent-copy.json');
  await files.getByLabel('Source', { exact: true }).fill('Independent observation');
  await files.getByRole('button', { name: 'Retain selected files', exact: true }).click();
  await expect(files.getByRole('button', { name: 'Preview independent-copy.json', exact: true })).toBeVisible();
  const records = (await readBrowserLocalCollection(page, 'cases')).records;
  const references = records.flatMap(record => record.value.attachments ?? []);
  expect(references).toHaveLength(2); expect(new Set(references.map(item => item.id)).size).toBe(2);
  expect(references.map(item => item.source).sort()).toEqual(['First observation', 'Independent observation']);
  expect(await storedFiles(page)).toHaveLength(1);
  await page.getByRole('link', { name: 'All Cases', exact: true }).click();
  await page.locator('.case-head', { hasText: 'first-file.example' }).click();
  await page.getByText('Case options', { exact: true }).click();
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Delete case', exact: true }).click();
  await expect(page).toHaveURL('/cases'); expect(await storedFiles(page)).toHaveLength(1);
  await page.locator('.case-head', { hasText: 'second-file.example' }).click(); files = await openRetainedFiles(page);
  await files.getByRole('button', { name: 'Preview independent-copy.json', exact: true }).click();
  await expect(files.locator('pre')).toContainText('A deliberately retained original');
  await files.getByRole('button', { name: 'Remove independent-copy.json', exact: true }).click();
  await files.getByRole('button', { name: 'Confirm removal', exact: true }).click();
  await expect(files).toContainText('No file references'); expect(await storedFiles(page)).toEqual([]);
  expect((await readBrowserLocalCollection(page, 'cases')).records[0]!.value.attachments).toEqual([]);
});

test('missing and damaged file bodies remain explicit without rewriting Case evidence', async ({ page }) => {
  await openCasesView(page); await createCase(page, 'damaged-file.example');
  let files = await selectOriginal(page);
  await files.getByRole('button', { name: 'Retain selected files', exact: true }).click();
  await expect(files.getByRole('button', { name: `Preview ${FILE_NAME}`, exact: true })).toBeVisible();
  const before = await readBrowserLocalCollection(page, 'cases');
  for (const mode of ['corrupt', 'missing'] as const) {
    await page.evaluate(async action => {
      const request = indexedDB.open('whoisleuth-browser-data-v1');
      const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try {
        const tx = db.transaction('files', 'readwrite'), store = tx.objectStore('files');
        const rows = store.getAll();
        rows.onsuccess = () => {
          if (rows.result.length !== 1) { tx.abort(); return; }
          const row = rows.result[0];
          if (action === 'missing') store.delete(row.key);
          else store.put({ ...row, payload: new Uint8Array(row.payload.byteLength).fill(65).buffer });
        };
        await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
      } finally { db.close(); }
    }, mode);
    await files.getByRole('button', { name: `Preview ${FILE_NAME}`, exact: true }).click();
    await expect(files.getByRole('alert')).toContainText(mode === 'missing' ? 'original bytes are missing' : 'could not be verified');
    await expect(files.locator('pre')).toHaveCount(0);
    expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  }
  files = await selectOriginal(page, 'restored-original.json');
  await files.getByRole('button', { name: 'Retain selected files', exact: true }).click();
  await expect(files.getByRole('button', { name: 'Preview restored-original.json', exact: true })).toBeVisible();
  await files.getByRole('button', { name: `Preview ${FILE_NAME}`, exact: true }).click();
  await expect(files.locator('pre')).toContainText('A deliberately retained original');
  expect(await storedFiles(page)).toHaveLength(1);
  const restored = await readBrowserLocalCollection(page, 'cases');
  expect(restored.manifest.revision).toBe(before.manifest.revision + 1);
  expect(restored.records[0]!.value.attachments).toHaveLength(2);
});

test('file retention from another tab cannot overwrite a concurrently changed Case', async ({ page, context }) => {
  await openCasesView(page); await createCase(page, 'parallel-file.example');
  const files = await selectOriginal(page), peer = await context.newPage();
  try {
    await peer.goto(page.url());
    const otherFiles = await selectOriginal(peer, 'peer-original.json', Buffer.from('{"peer":"Distinct bytes"}'));
    await otherFiles.getByRole('button', { name: 'Retain selected files', exact: true }).click();
    await expect(otherFiles.getByRole('button', { name: 'Preview peer-original.json', exact: true })).toBeVisible();
    await page.bringToFront();
    await expect(files.getByRole('heading', { name: '1 selected · not saved', exact: true })).toBeVisible();
    await files.getByRole('button', { name: 'Retain selected files', exact: true }).click();
    await expect(files.getByRole('button', { name: `Preview ${FILE_NAME}`, exact: true })).toBeVisible();
    const saved = await readBrowserLocalCollection(page, 'cases');
    expect(saved.records[0]!.value.attachments?.map(item => item.fileName).sort()).toEqual([FILE_NAME, 'peer-original.json'].sort());
    expect(await storedFiles(page)).toHaveLength(2);
  } finally { await peer.close(); }
});

test('an existing version-one record database upgrades additively without rewriting its records', async ({ page }) => {
  await openCasesView(page); await createCase(page, 'upgrade-file.example');
  const before = await readBrowserLocalCollection(page, 'cases');
  await page.goto('/privacy');
  await page.evaluate(async () => {
    const result = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const name = 'whoisleuth-browser-data-v1', db = await result(indexedDB.open(name));
    const transaction = db.transaction(['records', 'manifests']);
    const [records, manifests] = await Promise.all([result(transaction.objectStore('records').getAll()), result(transaction.objectStore('manifests').getAll())]);
    db.close(); await result(indexedDB.deleteDatabase(name));
    const opening = indexedDB.open(name, 1);
    opening.onupgradeneeded = () => {
      const old = opening.result, values = old.createObjectStore('records', { keyPath: 'key' });
      values.createIndex('collection', 'collection', { unique: false }); values.createIndex('collection-order', ['collection', 'ordinal'], { unique: true });
      const metadata = old.createObjectStore('manifests', { keyPath: 'collection' });
      for (const row of records) values.put(row); for (const row of manifests) metadata.put(row);
    };
    (await result(opening)).close();
  });
  await openCasesView(page);
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  expect(await page.evaluate(async () => {
    const request = indexedDB.open('whoisleuth-browser-data-v1');
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { return { version: db.version, stores: [...db.objectStoreNames] }; } finally { db.close(); }
  })).toEqual({ version: 2, stores: ['files', 'manifests', 'records'] });
  expect(await storedFiles(page)).toEqual([]);
});
