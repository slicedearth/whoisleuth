import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { directoryRows, indicator, namedDatabase, openArchive, openManager, SELECTION } from './browser-workspace-fixtures';
import { expectNoHorizontalOverflow, useTheme } from './helpers';
import { downloadEncryptedWorkspaceArchive } from './workspace-backup';
import { createCase } from '../packages/cases/case-model.mts';
import { buildWorkspaceArchive, readWorkspaceArchive } from '../packages/workspace/workspace-archive.mts';
import { decryptWorkspaceArchive, encryptWorkspaceArchive } from '../packages/workspace/workspace-archive-crypto.mts';
import { createCase as createCaseThroughForm, openCaseResponseWorkspace } from './case-test-fixtures';
import { openCaseSection } from './console-navigation';

const WORKSPACE_PASSWORD = '<synthetic workspace fixture>';
const BACKUP_PASSWORD = '<separate archive fixture>';
const DOMAIN = 'private-investigation.example';
const NOTE = 'This retained observation belongs only to the protected fixture.';
const NOW = '2026-09-01T00:00:00.000Z';

async function createEncrypted(page: Page, name: string) {
  const panel = await openManager(page);
  await panel.getByLabel('New workspace name', { exact: true }).fill(name);
  await panel.getByRole('checkbox', { name: 'Encrypt saved workspace records', exact: true }).check();
  await panel.getByLabel('New workspace passphrase', { exact: true }).fill(WORKSPACE_PASSWORD);
  await panel.getByLabel('Repeat workspace passphrase', { exact: true }).fill(WORKSPACE_PASSWORD);
  await panel.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Workspace created.');
  const row = (await directoryRows(page)).find(item => item.name === name);
  expect(row).toBeDefined();
  await panel.getByRole('button', { name: `Open workspace ${name}`, exact: true }).click();
  await Promise.all([page.waitForEvent('load'), panel.getByRole('button', { name: 'Switch workspace', exact: true }).click()]);
  await expect(page.getByRole('heading', { name: `Unlock ${name}`, exact: true })).toBeVisible();
  return row!;
}

async function unlock(page: Page, name: string) {
  await page.getByLabel('Workspace passphrase', { exact: true }).fill(WORKSPACE_PASSWORD);
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(indicator(page)).toHaveText(name);
}

async function storedBytes(page: Page, databaseName: string) {
  return page.evaluate(async name => {
    const opened = indexedDB.open(name);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error); });
    try {
      const tx = db.transaction(['records', 'manifests']);
      const records = tx.objectStore('records').getAll();
      const manifests = tx.objectStore('manifests').getAll();
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
      return { records: records.result as { payload: string; lookupKey: string; codec: string }[], manifests: manifests.result as { codec: string }[], session: { ...sessionStorage }, local: { ...localStorage } };
    } finally { db.close(); }
  }, databaseName);
}

test('unfinished Case forms use the encrypted workspace and remain outside its portable backup', async ({ page }) => {
  await page.goto('/dashboard');
  const row = await createEncrypted(page, 'Encrypted draft fixture'); await unlock(page, row.name);
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Cases', exact: true }).click();
  await createCaseThroughForm(page, 'encrypted-draft.example');
  await openCaseResponseWorkspace(page); await openCaseSection(page, 'Evidence');
  let details = page.locator('details').filter({ has: page.getByText('Pin an observed fact', { exact: true }) });
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
  await details.getByLabel('Label', { exact: true }).fill('Protected unfinished fixture');
  await details.getByLabel('Fact', { exact: true }).fill('This recovery-only sentence must not enter a backup.');
  await expect(details.getByRole('status')).toContainText('Draft saved in this workspace');
  expect(JSON.stringify(await storedBytes(page, namedDatabase(row.id)))).not.toContain('recovery-only sentence');
  await page.reload(); await unlock(page, row.name);
  await openCaseResponseWorkspace(page); await openCaseSection(page, 'Evidence');
  details = page.locator('details').filter({ has: page.getByText('Pin an observed fact', { exact: true }) });
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
  await details.getByText('1 saved draft for this form', { exact: true }).click();
  await details.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await expect(details.getByLabel('Fact', { exact: true })).toHaveValue('This recovery-only sentence must not enter a backup.');
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Dashboard', exact: true }).click();
  const { content } = await downloadEncryptedWorkspaceArchive(page, BACKUP_PASSWORD);
  expect(JSON.stringify(await decryptWorkspaceArchive(JSON.parse(content), BACKUP_PASSWORD))).not.toContain('recovery-only sentence');
});

test('encrypted workspace stays locked across reloads and supports a separately encrypted backup round trip', async ({ page, context }) => {
  const unexpected: string[] = [];
  page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/') && !['/api/session', '/api/capabilities'].includes(path)) unexpected.push(path); });
  await page.goto('/dashboard');
  const row = await createEncrypted(page, 'Protected investigation');
  await expect(page.locator('#main-content')).toHaveCount(0);
  await page.getByLabel('Workspace passphrase', { exact: true }).fill('incorrect synthetic passphrase');
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('incorrect or');
  await expect(page.getByLabel('Workspace passphrase', { exact: true })).toHaveValue('');
  await expect(page.locator('#main-content')).toHaveCount(0);
  await unlock(page, row.name);
  const record = createCase({ domain: DOMAIN }, NOW);
  record.notes = [{ id: 'fixture-note', createdAt: NOW, body: NOTE }];
  const archive = await buildWorkspaceArchive({ cases: [record] }, { generatedAt: NOW });
  const encrypted = await encryptWorkspaceArchive(archive, BACKUP_PASSWORD);
  const panel = await openArchive(page, true);
  await panel.getByLabel('Review backup file', { exact: true }).setInputFiles({ name: 'protected-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(encrypted)) });
  await panel.getByLabel('Backup passphrase', { exact: true }).fill(BACKUP_PASSWORD);
  await panel.getByRole('button', { name: 'Unlock and review', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Choose saved data to add' })).toBeVisible();
  await panel.getByRole('button', { name: 'Add selected data', exact: true }).click();
  await expect(panel.locator('.status')).toContainText('Added backup data');
  const bytes = await storedBytes(page, namedDatabase(row.id));
  expect(bytes.records.length).toBeGreaterThan(0);
  expect(bytes.records.every(item => item.codec === 'aes-gcm-hmac-v1')).toBe(true);
  expect(bytes.manifests.every(item => item.codec === 'aes-gcm-hmac-v1')).toBe(true);
  for (const sensitive of [DOMAIN, NOTE, WORKSPACE_PASSWORD, BACKUP_PASSWORD, record.id]) expect(JSON.stringify(bytes)).not.toContain(sensitive);

  await page.reload();
  await expect(page.getByRole('heading', { name: `Unlock ${row.name}`, exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(DOMAIN);
  expect((await storedBytes(page, namedDatabase(row.id))).records).toEqual(bytes.records);
  await unlock(page, row.name);
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Cases', exact: true }).click();
  await expect(page.getByText(DOMAIN, { exact: true }).first()).toBeVisible();
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Dashboard', exact: true }).click();
  const { content: output } = await downloadEncryptedWorkspaceArchive(page, BACKUP_PASSWORD);
  expect(output).not.toContain(DOMAIN);
  const restored = await decryptWorkspaceArchive(JSON.parse(output), BACKUP_PASSWORD);
  expect(JSON.stringify(await readWorkspaceArchive(restored))).toContain(NOTE);

  const peer = await context.newPage();
  try {
    await peer.goto('/dashboard');
    await peer.evaluate(({ key, id }) => sessionStorage.setItem(key, id), { key: SELECTION, id: row.id });
    await peer.reload();
    await expect(peer.getByRole('heading', { name: `Unlock ${row.name}`, exact: true })).toBeVisible();
    await expect(peer.locator('body')).not.toContainText(DOMAIN);
  } finally { await peer.close(); }

  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Unlock ${row.name}`, exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(DOMAIN);
  await unlock(page, row.name);
  await expect(page.getByRole('link', { name: 'Privacy (opens in a new tab)', exact: true })).toHaveAttribute('target', '_blank');
  await page.goto('/privacy');
  await expect(page).toHaveURL(/\/privacy$/u);
  await page.goBack();
  await expect(page.getByRole('heading', { name: `Unlock ${row.name}`, exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(DOMAIN);
  expect(unexpected).toEqual([]);
});

test('missing encrypted collection manifests never create replacement empty data', async ({ page }) => {
  await page.goto('/dashboard');
  const row = await createEncrypted(page, 'Missing-manifest fixture');
  await unlock(page, row.name);
  await page.evaluate(async name => {
    const request = indexedDB.open(name);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const transaction = db.transaction('manifests', 'readwrite');
      transaction.objectStore('manifests').delete('cases');
      await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); });
    } finally { db.close(); }
  }, namedDatabase(row.id));
  await page.reload();
  await page.getByLabel('Workspace passphrase', { exact: true }).fill(WORKSPACE_PASSWORD);
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browser-local data unavailable', exact: true })).toBeVisible();
  await expect(page.locator('.workspace-error')).toContainText('No empty collections were created');
  await expect(page.locator('#main-content')).toHaveCount(0);
  const records = await storedBytes(page, namedDatabase(row.id));
  expect(records.manifests.every(item => item.codec === 'aes-gcm-hmac-v1')).toBe(true);
  expect(records.manifests.length).toBeGreaterThan(0);
  expect(JSON.stringify(records)).not.toContain('"collection":"cases"');
});

for (const failure of ['directory', 'initialisation'] as const) test(`a refused encrypted ${failure} write removes only its newly prepared empty database`, async ({ page }) => {
  await page.goto('/dashboard');
  const panel = await openManager(page);
  const before = await page.evaluate(() => indexedDB.databases());
  await page.evaluate(failure => {
    const method = failure === 'directory' ? 'add' : 'put';
    const write = IDBObjectStore.prototype[method];
    let fail = true;
    IDBObjectStore.prototype[method] = function (value: unknown, key?: IDBValidKey) {
      const selected = failure === 'directory' ? this.name === 'workspaces' : this.transaction.db.name.startsWith('whoisleuth-workspace-') && this.name === 'manifests';
      if (selected && fail) { fail = false; throw new DOMException('Workspace quota fixture', 'QuotaExceededError'); }
      return key === undefined ? write.call(this, value) : write.call(this, value, key);
    };
  }, failure);
  await panel.getByLabel('New workspace name', { exact: true }).fill('Uncommitted protected workspace');
  await panel.getByRole('checkbox', { name: 'Encrypt saved workspace records', exact: true }).check();
  await panel.getByLabel('New workspace passphrase', { exact: true }).fill(WORKSPACE_PASSWORD);
  await panel.getByLabel('Repeat workspace passphrase', { exact: true }).fill(WORKSPACE_PASSWORD);
  await panel.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText(failure === 'directory' ? 'Workspace quota fixture' : 'Could not save browser-local data');
  await expect(panel.getByLabel('New workspace name', { exact: true })).toHaveValue('Uncommitted protected workspace');
  await expect(panel.getByLabel('New workspace passphrase', { exact: true })).toHaveValue('');
  expect(await directoryRows(page)).toEqual([]);
  expect((await page.evaluate(() => indexedDB.databases())).map(row => row.name).sort()).toEqual(before.map(row => row.name).sort());
  await panel.getByRole('button', { name: 'Refresh workspace directory', exact: true }).click();
  await panel.getByLabel('New workspace passphrase', { exact: true }).fill(WORKSPACE_PASSWORD);
  await panel.getByLabel('Repeat workspace passphrase', { exact: true }).fill(WORKSPACE_PASSWORD);
  await panel.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Workspace created.');
  expect((await directoryRows(page)).length).toBe(1);
});

test('workspace creation and unlock are usable at supported widths in both themes', async ({ page }, testInfo) => {
  await page.goto('/dashboard');
  const panel = await openManager(page);
  await panel.getByRole('checkbox', { name: 'Encrypt saved workspace records', exact: true }).check();
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
      await page.setViewportSize(viewport);
      await expect(panel.getByLabel('New workspace passphrase', { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  }
  const row = await createEncrypted(page, 'A deliberately long protected investigation workspace name');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [1280, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 768 });
      await expectNoHorizontalOverflow(page);
      await expect(page.getByLabel('Workspace passphrase', { exact: true })).toBeVisible();
      if (width === 320 || width === 1280) await page.screenshot({ path: testInfo.outputPath(`unlock-${theme}-${width}.png`) });
    }
    expect((await new AxeBuilder({ page }).include('.workspace-unlock').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
  }
  await page.getByLabel('Workspace passphrase', { exact: true }).fill(WORKSPACE_PASSWORD);
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(indicator(page)).toHaveText(row.name);
});
