import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { currentBrowserLocalDocument, expectNoHorizontalOverflow, migrateLegacyBrowserData, openDashboardSecondaryWorkspaces, readBrowserLocalCollection, requiredValue, useTheme } from './helpers';
import { BROWSER_LOCAL_COLLECTIONS, type BrowserLocalCollectionId } from '../frontend/src/lib/browser-local-data-definitions';
import { buildWorkspaceArchive, readWorkspaceArchive } from '../packages/workspace/workspace-archive.mts';
import { createCase } from '../packages/cases/case-model.mts';

// Independent on-disk expectations: selecting another workspace must not change
// these public default names, or include directory identity in a portable file.
const DIRECTORY = 'whoisleuth-workspace-directory-v1';
const SELECTION = 'whoisleuth:workspace-selection:v1';
const DEFAULT_DATABASE = 'whoisleuth-browser-data-v1';
const NOW = '2026-09-01T00:00:00.000Z';
type DirectoryRow = { id: string; name: string; revision: number; state: string; createdAt: string; updatedAt: string };
const namedDatabase = (id: string) => `whoisleuth-workspace-${id}-v1`;
const manager = (page: Page) => page.getByRole('region', { name: 'Browser workspaces', exact: true });
const indicator = (page: Page) => page.locator('#main-content > .workspace-scope strong');

async function directoryRows(page: Page): Promise<DirectoryRow[]> {
  return page.evaluate(async name => {
    const request = indexedDB.open(name);
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const transaction = database.transaction('workspaces');
      const rows = transaction.objectStore('workspaces').getAll();
      return await new Promise<DirectoryRow[]>((resolve, reject) => { transaction.oncomplete = () => resolve(rows.result); transaction.onabort = () => reject(transaction.error); });
    } finally { database.close(); }
  }, DIRECTORY);
}

async function openManager(page: Page) {
  await expect(indicator(page)).not.toHaveText('Loading…');
  const disclosure = page.locator('#workspaces');
  if (await disclosure.getAttribute('open') === null) await disclosure.locator(':scope > summary').click();
  await expect(manager(page).getByRole('button', { name: 'Create workspace', exact: true })).toBeVisible();
  await expect(manager(page).getByLabel('New workspace name', { exact: true })).toBeEnabled();
  return manager(page);
}

async function createWorkspace(page: Page, name: string) {
  const panel = await openManager(page);
  await panel.getByLabel('New workspace name', { exact: true }).fill(name);
  await panel.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Workspace created.');
  const row = (await directoryRows(page)).find(row => row.name === name);
  expect(row).toBeDefined();
  return row!;
}

async function switchWorkspace(page: Page, name: string) {
  const panel = await openManager(page);
  await panel.getByRole('button', { name: name === 'Default' ? 'Open default workspace' : `Open workspace ${name}`, exact: true }).click();
  await expect(panel.getByRole('heading', { name: `Open ${name}?`, exact: true })).toBeFocused();
  await Promise.all([page.waitForEvent('load'), panel.getByRole('button', { name: 'Switch workspace', exact: true }).click()]);
  await expect(indicator(page)).toHaveText(name);
}

async function openArchive(page: Page, empty = false) {
  if (empty) await page.getByRole('button', { name: /Import existing work/u }).click();
  else await openDashboardSecondaryWorkspaces(page);
  const archive = page.locator('.workspace-archive');
  await expect(archive.getByLabel('Review backup file', { exact: true })).toBeVisible();
  return archive;
}

test('real databases, every collection and same-identity archive imports remain isolated from the default workspace', async ({ page }) => {
  const unexpectedRequests: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/') && !['/api/session', '/api/capabilities'].includes(path)) unexpectedRequests.push(path);
  });
  const original = createCase({ domain: 'shared.example' }, NOW);
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [original] }) }, { clearStorage: true, destination: '/dashboard' });
  const originalRecords = await readBrowserLocalCollection(page, 'cases');
  const legacy = await page.evaluate(() => localStorage.getItem('whois-rdap-cases-v1'));
  const first = await createWorkspace(page, 'Separate investigation');
  const second = await createWorkspace(page, 'Another investigation');
  await switchWorkspace(page, first.name);
  for (const collection of BROWSER_LOCAL_COLLECTIONS) {
    const records = await readBrowserLocalCollection(page, collection.id as BrowserLocalCollectionId, { databaseName: namedDatabase(first.id) });
    expect(records.manifest.source).toBe('empty');
    expect(records.records).toEqual([]);
  }
  const archive = await openArchive(page, true);
  await expect(archive.locator('.workspace-scope strong')).toHaveText(first.name);
  const incoming = { ...original, notes: [{ createdAt: NOW, body: 'Retained only in the selected workspace' }] };
  const input = await buildWorkspaceArchive({ cases: [incoming] }, { generatedAt: NOW });
  await archive.getByLabel('Review backup file', { exact: true }).setInputFiles({ name: 'workspace.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(input)) });
  await expect(archive.getByRole('heading', { name: 'Choose saved data to add' })).toBeVisible();
  // Simulate a navigation selection changing before a queued action completes.
  // The current page and its save coordinator must keep their captured scope.
  await page.evaluate(({ key, id }) => sessionStorage.setItem(key, id), { key: SELECTION, id: second.id });
  await archive.getByRole('button', { name: 'Add selected data', exact: true }).click();
  await expect(archive.locator('.status')).toContainText('Added backup data');
  const saved = await readBrowserLocalCollection(page, 'cases', { databaseName: namedDatabase(first.id), minimumRecords: 1 });
  const retained = requiredValue(saved.records[0], 'Expected the imported Case.');
  expect(retained.value.id).toBe(original.id);
  expect(retained.value.notes.map(note => ({ createdAt: note.createdAt, body: note.body }))).toEqual(incoming.notes);
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(originalRecords);
  expect(await page.evaluate(() => localStorage.getItem('whois-rdap-cases-v1'))).toBe(legacy);
  await page.evaluate(({ key, id }) => sessionStorage.setItem(key, id), { key: SELECTION, id: first.id });
  await page.reload();
  const exportPanel = await openArchive(page);
  await exportPanel.getByText('How workspace backups work', { exact: true }).click();
  await expect(exportPanel.getByRole('button', { name: 'Update legacy rollback copy' })).toHaveCount(0);
  const downloading = page.waitForEvent('download');
  await exportPanel.getByRole('button', { name: 'Download unencrypted backup', exact: true }).click();
  const file = await downloading;
  const text = Buffer.concat(await (await file.createReadStream()).toArray()).toString('utf8');
  expect(text).not.toContain(first.id); expect(text).not.toContain(first.name);
  const exported = await readWorkspaceArchive(JSON.parse(text));
  expect(exported.sections.find(section => section.id === 'cases')?.recordCount).toBe(1);
  const panel = await openManager(page);
  await panel.getByRole('button', { name: `Rename workspace ${first.name}`, exact: true }).click();
  await panel.getByLabel('Workspace name', { exact: true }).fill('Renamed active workspace');
  await panel.getByRole('button', { name: 'Save workspace name' }).click();
  await expect(indicator(page)).toHaveText('Renamed active workspace');
  await expect(exportPanel.locator('.workspace-scope strong')).toHaveText('Renamed active workspace');
  await switchWorkspace(page, second.name);
  expect((await readBrowserLocalCollection(page, 'cases', { databaseName: namedDatabase(second.id) })).records).toEqual([]);
  await switchWorkspace(page, 'Default');
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(originalRecords);
  expect(unexpectedRequests).toEqual([]);
});

test('tabs retain their own selection and open-workspace deletion is refused without discarding records', async ({ page, context }) => {
  await page.goto('/dashboard');
  const row = await createWorkspace(page, 'Parallel review');
  const peer = await context.newPage();
  try {
    await peer.goto('/dashboard');
    await expect(indicator(peer)).toHaveText('Default');
    await switchWorkspace(peer, row.name);
    await expect(indicator(page)).toHaveText('Default');
    const panel = manager(page);
    await panel.getByRole('button', { name: `Delete workspace ${row.name}`, exact: true }).click();
    await panel.getByLabel('Type the workspace name to confirm').fill(row.name);
    await panel.getByRole('button', { name: 'Delete workspace data', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('open in another tab');
    expect(requiredValue((await directoryRows(page))[0], 'Expected the occupied workspace.').state).toBe('ready');
    await expect(indicator(peer)).toHaveText(row.name);
    await peer.close();
    await panel.getByRole('button', { name: 'Refresh workspace directory' }).click();
    await expect(panel.getByRole('button', { name: 'Delete workspace data', exact: true })).toBeEnabled();
    await panel.getByRole('button', { name: 'Delete workspace data', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('Workspace data and directory entry deleted.');
    expect(await directoryRows(page)).toEqual([]);
    const databases = await page.evaluate(() => indexedDB.databases());
    expect(databases.map(database => database.name)).not.toContain(namedDatabase(row.id));
    expect(databases.map(database => database.name)).toContain(DEFAULT_DATABASE);
  } finally { if (!peer.isClosed()) await peer.close(); }
});

test('blocked native deletion retains its tombstone and rejects a late selection until explicit cleanup', async ({ page, context }) => {
  await page.goto('/dashboard');
  const row = await createWorkspace(page, 'Blocked deletion');
  const peer = await context.newPage();
  try {
    await peer.goto('/robots.txt');
    await peer.evaluate(async databaseName => {
      const request = indexedDB.open(databaseName, 1);
      const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      Object.defineProperty(window, '__heldWorkspaceDatabase', { value: db });
    }, namedDatabase(row.id));
    const panel = manager(page);
    await panel.getByRole('button', { name: `Delete workspace ${row.name}`, exact: true }).click();
    await panel.getByLabel('Type the workspace name to confirm').fill(row.name);
    await panel.getByRole('button', { name: 'Delete workspace data', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('Deletion is pending.', { timeout: 15_000 });
    expect(requiredValue((await directoryRows(page))[0], 'Expected the deletion tombstone.').state).toBe('deleting');
    await peer.close();
    await page.evaluate(({ key, id }) => sessionStorage.setItem(key, id), { key: SELECTION, id: row.id });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Browser-local data unavailable' })).toBeVisible();
    await expect(page.getByText('The selected workspace is missing or pending deletion.', { exact: false })).toBeVisible();
    await manager(page).getByRole('button', { name: 'Open default workspace' }).click();
    await Promise.all([page.waitForEvent('load'), manager(page).getByRole('button', { name: 'Switch workspace', exact: true }).click()]);
    const recovered = await openManager(page);
    await expect(recovered.getByText('Deletion pending', { exact: true })).toBeVisible();
    await recovered.getByRole('button', { name: `Delete workspace ${row.name}`, exact: true }).click();
    await recovered.getByLabel('Type the workspace name to confirm').fill(row.name);
    await recovered.getByRole('button', { name: 'Delete workspace data', exact: true }).click();
    await expect(recovered.getByRole('status')).toContainText('Workspace data and directory entry deleted.');
    expect(await directoryRows(page)).toEqual([]);
  } finally { if (!peer.isClosed()) await peer.close(); }
});

test('renaming preserves a conflicting draft, refreshes its revision deliberately and restores focus on cancel', async ({ page, context }) => {
  await page.goto('/dashboard');
  const row = await createWorkspace(page, 'Initial name');
  const peer = await context.newPage();
  try {
    await peer.goto('/dashboard');
    const peerPanel = await openManager(peer);
    const panel = manager(page);
    await panel.getByRole('button', { name: `Rename workspace ${row.name}`, exact: true }).click();
    await panel.getByLabel('Workspace name', { exact: true }).fill('My draft');
    await peerPanel.getByRole('button', { name: `Rename workspace ${row.name}`, exact: true }).click();
    await peerPanel.getByLabel('Workspace name', { exact: true }).fill('Changed elsewhere');
    await peerPanel.getByRole('button', { name: 'Save workspace name' }).click();
    await expect(peerPanel.getByRole('status')).toContainText('Workspace renamed.');
    await panel.getByRole('button', { name: 'Save workspace name' }).click();
    await expect(panel.getByRole('alert')).toContainText('changed in another tab');
    await expect(panel.getByLabel('Workspace name', { exact: true })).toHaveValue('My draft');
    await panel.getByRole('button', { name: 'Refresh workspace directory' }).click();
    await expect(panel.getByRole('heading', { name: 'Rename Changed elsewhere', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Save workspace name' }).click();
    await expect(panel.getByRole('status')).toContainText('Workspace renamed.');
    expect((await directoryRows(page))[0]).toMatchObject({ id: row.id, name: 'My draft', revision: 3 });
    const open = panel.getByRole('button', { name: 'Open workspace My draft', exact: true });
    await open.focus(); await page.keyboard.press('Enter');
    await expect(panel.getByRole('heading', { name: 'Open My draft?', exact: true })).toBeFocused();
    await panel.getByRole('button', { name: 'Cancel workspace change' }).click();
    await expect(open).toBeFocused();
    await expect(indicator(page)).toHaveText('Default');
  } finally { await peer.close(); }
});

test('successful directory writes with failed view refresh are not presented as failed writes', async ({ page }) => {
  await page.goto('/dashboard');
  const panel = await openManager(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.getAll;
    let reads = 0;
    IDBObjectStore.prototype.getAll = function (...args: Parameters<IDBObjectStore['getAll']>) {
      if (this.name === 'workspaces' && ++reads === 2) throw new DOMException('View unavailable', 'InvalidStateError');
      return Reflect.apply(original, this, args);
    };
  });
  await panel.getByLabel('New workspace name').fill('Committed workspace');
  await panel.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('Workspace created. Open it when ready. The directory view could not be refreshed. Refresh it before another change.');
  await expect(panel.getByLabel('New workspace name')).toHaveValue('');
  await expect(panel.getByRole('status')).toBeFocused();
  expect((await directoryRows(page)).map(row => row.name)).toEqual(['Committed workspace']);
  await panel.getByRole('button', { name: 'Refresh workspace directory' }).click();
  await expect(panel.getByRole('button', { name: 'Open workspace Committed workspace' })).toBeVisible();
});

test('a completed database deletion with failed directory cleanup stays explicitly pending until retried', async ({ page }) => {
  await page.goto('/dashboard');
  const row = await createWorkspace(page, 'Cleanup pending');
  await switchWorkspace(page, row.name);
  await switchWorkspace(page, 'Default');
  const panel = await openManager(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.delete;
    let fail = true;
    IDBObjectStore.prototype.delete = function (key: IDBValidKey | IDBKeyRange) {
      if (this.name === 'workspaces' && fail) { fail = false; throw new DOMException('Quota unavailable', 'QuotaExceededError'); }
      return original.call(this, key);
    };
  });
  await panel.getByRole('button', { name: `Delete workspace ${row.name}`, exact: true }).click();
  await panel.getByLabel('Type the workspace name to confirm').fill(row.name);
  await panel.getByRole('button', { name: 'Delete workspace data', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Workspace data was deleted, but its directory entry could not be removed.');
  expect(requiredValue((await directoryRows(page))[0], 'Expected cleanup state.').state).toBe('deleting');
  expect((await page.evaluate(() => indexedDB.databases())).map(db => db.name)).not.toContain(namedDatabase(row.id));
  await panel.getByRole('button', { name: 'Refresh workspace directory' }).click();
  await panel.getByRole('button', { name: 'Delete workspace data', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Workspace data and directory entry deleted.');
  expect(await directoryRows(page)).toEqual([]);
});

test('directory transaction failure preserves the draft and existing rows without claiming success', async ({ page }) => {
  await page.goto('/dashboard');
  const row = await createWorkspace(page, 'Preserved workspace');
  const panel = manager(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    let fail = true;
    IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
      if (this.name === 'workspaces' && fail) { fail = false; throw new DOMException('Storage quota exceeded', 'QuotaExceededError'); }
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
  });
  await panel.getByLabel('New workspace name').fill('Uncommitted draft');
  await panel.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Storage quota exceeded');
  await expect(panel.getByLabel('New workspace name')).toHaveValue('Uncommitted draft');
  expect(await directoryRows(page)).toEqual([row]);
  await panel.getByRole('button', { name: 'Refresh workspace directory' }).click();
  await panel.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Workspace created.');
  expect((await directoryRows(page)).length).toBe(2);
});

test('the full admitted directory remains searchable and paginated, and one extra workspace is refused atomically', async ({ page }) => {
  await page.goto('/robots.txt');
  await page.evaluate(async name => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspaces', { keyPath: 'id' });
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction('workspaces', 'readwrite');
    for (let index = 1; index <= 999; index++) tx.objectStore('workspaces').add({ id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`, name: `Workspace ${String(index).padStart(4, '0')}`, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', state: 'ready', revision: 1 });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    db.close();
  }, DIRECTORY);
  await page.goto('/dashboard');
  const panel = await openManager(page);
  await panel.getByLabel('New workspace name').fill('Last admitted workspace');
  await panel.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Workspace created.');
  expect((await directoryRows(page)).length).toBe(1000);
  await expect(panel.locator('ul > li')).toHaveCount(10);
  await panel.getByRole('button', { name: 'Next workspaces', exact: true }).click();
  await expect(panel.getByText('Page 2 of 100', { exact: true })).toBeVisible();
  await panel.getByLabel('Find workspace', { exact: true }).fill('Workspace 0999');
  await expect(panel.locator('ul > li')).toHaveCount(1);
  await expect(panel.getByRole('button', { name: 'Open workspace Workspace 0999', exact: true })).toBeVisible();
  await panel.getByLabel('New workspace name').fill('Beyond admitted capacity');
  await panel.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('already contains 1000 named workspaces');
  expect((await directoryRows(page)).length).toBe(1000);
});

test('default storage remains available without Web Locks while named workspace actions are disabled', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }); });
  await page.goto('/dashboard');
  await expect(indicator(page)).toHaveText('Default');
  await page.locator('#workspaces > summary').click();
  await expect(manager(page).getByText('Named workspaces require IndexedDB and Web Locks.', { exact: false })).toBeVisible();
  await expect(manager(page).getByRole('button', { name: 'Create workspace', exact: true })).toBeDisabled();
  expect((await readBrowserLocalCollection(page, 'cases')).records).toEqual([]);
});

for (const failure of ['future-version', 'wrong-key', 'malformed-row', 'excess-records'] as const) test(`directory ${failure} remains unavailable without changing default evidence or resetting metadata`, async ({ page }) => {
  await page.goto('/robots.txt');
  await page.evaluate(async ({ name, failure }) => {
    const request = indexedDB.open(name, failure === 'future-version' ? 2 : 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspaces', { keyPath: failure === 'wrong-key' ? 'name' : 'id' });
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    if (failure === 'malformed-row' || failure === 'excess-records') {
      const tx = db.transaction('workspaces', 'readwrite');
      for (let index = 0; index < (failure === 'excess-records' ? 1001 : 1); index++) tx.objectStore('workspaces').add({ id: `row-${index}`, name: 'Untrusted record' });
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    }
    db.close();
  }, { name: DIRECTORY, failure });
  await page.goto('/dashboard');
  await expect(indicator(page)).toHaveText('Default');
  await page.locator('#workspaces > summary').click();
  await expect(manager(page).getByRole('alert')).toBeVisible();
  await expect(manager(page).getByRole('button', { name: 'Create workspace', exact: true })).toBeDisabled();
  expect((await readBrowserLocalCollection(page, 'cases')).records).toEqual([]);
  const databases = await page.evaluate(() => indexedDB.databases());
  expect(databases.find(db => db.name === DIRECTORY)?.version).toBe(failure === 'future-version' ? 2 : 1);
  if (failure === 'malformed-row' || failure === 'excess-records') expect((await directoryRows(page)).length).toBe(failure === 'excess-records' ? 1001 : 1);
});

test('an invalid tab selection has an explicit default recovery path without silently resetting the selection', async ({ page }) => {
  await page.goto('/robots.txt');
  await page.evaluate(key => sessionStorage.setItem(key, 'unknown-workspace'), SELECTION);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Browser-local data unavailable' })).toBeVisible();
  expect(await page.evaluate(key => sessionStorage.getItem(key), SELECTION)).toBe('unknown-workspace');
  await manager(page).getByRole('button', { name: 'Open default workspace' }).click();
  await Promise.all([page.waitForEvent('load'), manager(page).getByRole('button', { name: 'Switch workspace', exact: true }).click()]);
  await expect(indicator(page)).toHaveText('Default');
  expect(await page.evaluate(key => sessionStorage.getItem(key), SELECTION)).toBe('default');
});

test('workspace controls remain navigable, wrapped and focusable across supported viewports and themes', async ({ page }, testInfo) => {
  await page.goto('/dashboard');
  const row = await createWorkspace(page, 'A long investigation label with distinct retained evidence and review history');
  const panel = manager(page);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
      await page.setViewportSize(viewport);
      await panel.getByRole('button', { name: `Rename workspace ${row.name}`, exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(panel.getByRole('heading', { name: `Rename ${row.name}`, exact: true })).toBeFocused();
      await expectNoHorizontalOverflow(page);
      const input = panel.getByLabel('Workspace name', { exact: true });
      await input.focus();
      await expect(input).toBeInViewport();
      await testInfo.attach(`workspaces-${theme}-${viewport.width}`, { body: await page.screenshot(), contentType: 'image/png' });
      await panel.getByRole('button', { name: 'Cancel workspace change' }).click();
      await expect(panel.getByRole('button', { name: `Rename workspace ${row.name}`, exact: true })).toBeFocused();
    }
  }
});
