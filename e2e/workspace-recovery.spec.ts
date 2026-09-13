import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { readBrowserLocalCollection, expectNoHorizontalOverflow, useTheme } from './helpers';
import { directoryRows, namedDatabase, SELECTION } from './browser-workspace-fixtures';
import { downloadWorkspaceArchive, reviewWorkspaceBackup, workspaceArchiveRegion } from './workspace-backup';
import { openImageReview } from './case-image-fixtures';
import { storedFiles } from './case-attachment-fixtures';
import { buildWorkspaceArchive } from '../packages/workspace/workspace-archive.mts';
import { encryptWorkspaceArchive } from '../packages/workspace/workspace-archive-crypto.mts';
import { createCase } from '../packages/cases/case-model.mts';
import type { CaseAttachment } from '../packages/cases/case-attachment-model.mts';
import { decryptInvestigationPackage } from '../packages/investigation/investigation-package-crypto.mts';

const NOW = '2026-09-01T00:00:00.000Z', PASSWORD = '<synthetic recovery fixture>';
const panel = (page: Page) => page.locator('details.recovery');

async function review(page: Page, content: string) {
  await reviewWorkspaceBackup(page, { name: 'workspace.json', mimeType: 'application/json', buffer: Buffer.from(content) });
  await expect(panel(page).locator(':scope > summary')).toBeVisible();
  await panel(page).locator(':scope > summary').click();
}
async function start(page: Page, name = 'Recovery fixture', encrypted = false) {
  const recovery = panel(page);
  await recovery.getByLabel('Rehearsal workspace name', { exact: true }).fill(name);
  if (encrypted) {
    await recovery.getByLabel('Rehearsal passphrase', { exact: true }).fill(PASSWORD);
    await recovery.getByLabel('Confirm rehearsal passphrase', { exact: true }).fill(PASSWORD);
  } else await recovery.getByRole('checkbox', { name: 'Encrypt rehearsal workspace', exact: true }).uncheck();
  await recovery.getByRole('button', { name: 'Create rehearsal and restore', exact: true }).focus();
  await page.keyboard.press('Enter');
  return recovery;
}
async function deleteRehearsal(page: Page) {
  await panel(page).getByRole('button', { name: 'Delete rehearsal workspace', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Confirm rehearsal deletion', exact: true }).click();
  await expect(panel(page).getByRole('status')).toHaveText('Rehearsal workspace deleted. The active workspace is unchanged.');
  await expect(panel(page).getByRole('status')).toBeFocused();
  expect(await directoryRows(page)).toEqual([]);
}
async function simpleBackup(attachments: CaseAttachment[] = []) {
  return JSON.stringify(await buildWorkspaceArchive({ cases: [{ ...createCase({ domain: 'recovery.example' }, NOW), id: 'recovery-case', ...(attachments.length ? { attachments } : {}) }] }, { generatedAt: NOW }));
}

test('downloaded backup and file packages rehearse independently without switching or changing the active workspace', async ({ page }, testInfo) => {
  test.slow(); // One behavioural journey includes the complete rendering matrix.
  const { bytes } = await openImageReview(page, 2);
  await page.goto('/dashboard');
  const before = await readBrowserLocalCollection(page, 'cases');
  const originalSelection = await page.evaluate(key => sessionStorage.getItem(key), SELECTION);
  const { content } = await downloadWorkspaceArchive(page);
  const fileBackup = page.locator('.file-backup');
  await expect(fileBackup.locator(':scope > summary')).toContainText('1 referenced file separately');
  await fileBackup.locator(':scope > summary').click();
  const packagePassphrase = 'independent recovery package passphrase';
  await fileBackup.getByRole('checkbox', { name: 'Encrypt package download', exact: true }).check();
  await fileBackup.getByLabel('Package passphrase', { exact: true }).fill(packagePassphrase);
  await fileBackup.getByLabel('Confirm package passphrase', { exact: true }).fill(packagePassphrase);
  const pending = page.waitForEvent('download');
  await fileBackup.getByRole('button', { name: 'Download private package', exact: true }).click();
  const filePackage = await readFile((await (await pending).path())!);
  const independent = (await decryptInvestigationPackage(filePackage, packagePassphrase)).review;
  expect(independent.identityVerified).toBe(true); expect(independent.contents.size).toBe(1);
  expect(Buffer.from(independent.contents.get('artifact-1')!)).toEqual(bytes);
  expect(independent.manifest.artifacts[0]).toMatchObject({ source: { identity: null, observedAt: null } });
  await review(page, content); const recovery = await start(page);
  await expect(recovery.getByRole('status')).toContainText('recovery is not fully verified');
  await expect(recovery.locator('.result')).toContainText('0 of 1 unique files verified · 1 missing');
  const [row] = await directoryRows(page); expect(row).toBeDefined();
  const destination = namedDatabase(row!.id);
  expect((await readBrowserLocalCollection(page, 'cases', { databaseName: destination })).records.map(item => item.value)).toEqual(before.records.map(item => item.value));
  expect(await page.evaluate(id => navigator.locks.request(`whoisleuth-workspace:whoisleuth-workspace-${id}-v1`, { mode: 'shared', ifAvailable: true }, lock => Boolean(lock)), row!.id)).toBe(false);
  await recovery.getByLabel('Restore evidence package', { exact: true }).setInputFiles({ name: 'files.wlep', mimeType: 'application/octet-stream', buffer: filePackage });
  const packagePassword = recovery.getByLabel('Unlock package passphrase', { exact: true });
  await expect(packagePassword).toBeFocused();
  expect(await storedFiles(page, destination)).toHaveLength(0);
  await packagePassword.fill('wrong recovery package passphrase'); await page.keyboard.press('Enter');
  await expect(recovery.getByRole('alert')).toContainText('could not be unlocked and verified');
  expect(await storedFiles(page, destination)).toHaveLength(0);
  await expect(packagePassword).toBeFocused(); await expect(packagePassword).toHaveValue('');
  await packagePassword.fill(packagePassphrase); await page.keyboard.press('Enter');
  await expect(recovery.getByRole('status')).toContainText('Recovery verified for the selected backup data and every referenced file.');
  expect((await storedFiles(page, destination))[0]!.bytes).toEqual([...bytes]);
  await recovery.getByLabel('Restore original files', { exact: true }).setInputFiles({ name: 'renamed.png', mimeType: 'image/png', buffer: bytes });
  await expect(recovery.getByRole('status')).toContainText('Recovery verified');
  expect(await storedFiles(page, destination)).toHaveLength(1);
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  expect(await page.evaluate(key => sessionStorage.getItem(key), SELECTION)).toBe(originalSelection);
  await recovery.getByText('Section comparison', { exact: true }).click();
  expect((await new AxeBuilder({ page }).include('details.recovery').analyze()).violations).toEqual([]);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 1920, 2560, 3840]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      await recovery.scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page);
      expect(await recovery.evaluate(element => [...element.querySelectorAll('button,input')].filter(control => control.getClientRects().length).every(control => {
        const parent = element.getBoundingClientRect(), rect = control.getBoundingClientRect();
        return rect.width > 0 && rect.left >= parent.left - 1 && rect.right <= parent.right + 1;
      }))).toBe(true);
      await recovery.screenshot({ path: testInfo.outputPath(`recovery-${theme}-${width}.png`) });
      if (width === 320 || width === 1280 || width === 3840) {
        const summary = recovery.locator(':scope > summary');
        // Element screenshots reposition the page without changing focus. Make
        // each viewport exercise a new focus transition, not an already-focused
        // control moved by the screenshot operation itself.
        await summary.evaluate(element => (element as HTMLElement).blur());
        await summary.focus(); await expect(summary).toBeInViewport({ ratio: 1 });
        const header = await page.getByRole('banner').boundingBox(), target = await summary.boundingBox();
        expect(header).not.toBeNull(); expect(target).not.toBeNull();
        expect(target!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
        await page.screenshot({ path: testInfo.outputPath(`recovery-viewport-${theme}-${width}.png`) });
      }
    }
  }
  await deleteRehearsal(page);
  expect(await page.evaluate(name => indexedDB.databases().then(rows => rows.some(item => item.name === name)), destination)).toBe(false);
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
});

test('encrypted backup cannot create a plaintext rehearsal and leaving does not silently delete it', async ({ page }, testInfo) => {
  const body = Buffer.from('Encrypted rehearsal original bytes.');
  const envelope = await encryptWorkspaceArchive(JSON.parse(await simpleBackup([{ id: 'protected-original', fileName: 'original.bin', mediaType: 'application/octet-stream',
    source: null, observedAt: null, retainedAt: NOW, byteLength: body.length, digestSha256: `sha256:${createHash('sha256').update(body).digest('hex')}` }])), PASSWORD);
  await page.goto('/dashboard');
  await reviewWorkspaceBackup(page, { name: 'protected.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(envelope)) });
  await workspaceArchiveRegion(page).getByLabel('Backup passphrase', { exact: true }).fill(PASSWORD);
  await workspaceArchiveRegion(page).getByRole('button', { name: 'Unlock and review', exact: true }).click();
  await panel(page).locator(':scope > summary').click();
  await expect(panel(page).getByRole('checkbox', { name: 'Encrypt rehearsal workspace', exact: true })).toBeChecked();
  await expect(panel(page).getByRole('checkbox', { name: 'Encrypt rehearsal workspace', exact: true })).toBeDisabled();
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 }); await expectNoHorizontalOverflow(page);
      await panel(page).screenshot({ path: testInfo.outputPath(`recovery-form-${theme}-${width}.png`) });
    }
  }
  const recovery = await start(page, 'Protected rehearsal', true);
  await expect(recovery.getByRole('status')).toContainText('recovery is not fully verified');
  await recovery.getByLabel('Restore original files', { exact: true }).setInputFiles({ name: 'renamed.bin', mimeType: 'application/octet-stream', buffer: body });
  await expect(recovery.getByRole('status')).toContainText('Recovery verified');
  const [row] = await directoryRows(page); expect(row).toHaveProperty('encryption');
  const persisted = await storedFiles(page, namedDatabase(row!.id));
  expect(persisted).toHaveLength(1); expect(persisted[0]!.codec).toBe('aes-gcm-hmac-v1');
  expect(persisted[0]!.bytes).toHaveLength(body.length + 28); expect(persisted[0]!.bytes).not.toEqual([...body]);
  const raw = await page.evaluate(async name => {
    const request = indexedDB.open(name); const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const tx = db.transaction('records'), records = tx.objectStore('records').getAll();
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
      return JSON.stringify(records.result);
    } finally { db.close(); }
  }, namedDatabase(row!.id));
  expect(raw).not.toContain('recovery.example'); expect(raw).not.toContain('recovery-case'); expect(raw).toContain('aes-gcm-hmac-v1');
  await page.reload();
  expect(await directoryRows(page)).toHaveLength(1);
  expect(await page.evaluate(id => navigator.locks.request(`whoisleuth-workspace:whoisleuth-workspace-${id}-v1`, { mode: 'shared', ifAvailable: true }, lock => Boolean(lock)), row!.id)).toBe(true);
});

test('a committed restore followed by failed reconciliation offers verification, not a second restore', async ({ page }) => {
  await page.goto('/dashboard'); await review(page, await simpleBackup());
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put, transaction = IDBDatabase.prototype.transaction;
    let failRead = false;
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      if (this.transaction.db.name.startsWith('whoisleuth-workspace-') && this.name === 'manifests' && value && typeof value === 'object'
        && Reflect.get(value, 'collection') === 'cases' && Reflect.get(value, 'revision') === 2) {
        // The next readonly transaction follows this awaited write. Arming in
        // the put avoids relying on microtasks between completion listeners.
        failRead = true;
      }
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
    IDBDatabase.prototype.transaction = function(...args: Parameters<IDBDatabase['transaction']>) {
      if (this.name.startsWith('whoisleuth-workspace-') && this.name !== 'whoisleuth-workspace-directory-v1' && (!args[1] || args[1] === 'readonly') && failRead) {
        failRead = false; throw new DOMException('Synthetic post-commit read failure', 'UnknownError');
      }
      return transaction.apply(this, args);
    };
  });
  const recovery = await start(page);
  await expect(recovery.getByRole('alert')).toContainText('The write completed');
  await expect(recovery.getByRole('alert')).toBeFocused();
  await expect(recovery.getByRole('button', { name: 'Create rehearsal and restore', exact: true })).toHaveCount(0);
  const [row] = await directoryRows(page);
  expect((await readBrowserLocalCollection(page, 'cases', { databaseName: namedDatabase(row!.id) })).records).toHaveLength(1);
  await recovery.getByRole('button', { name: 'Verify restored data', exact: true }).click();
  await expect(recovery.getByRole('status')).toContainText('Recovery verified');
  await deleteRehearsal(page);
});

test('unmatched recovery files do not change saved metadata or retain unreferenced bytes', async ({ page }) => {
  await page.goto('/dashboard'); await review(page, await simpleBackup()); const recovery = await start(page);
  await expect(recovery.getByRole('status')).toContainText('Recovery verified');
  const [row] = await directoryRows(page), destination = namedDatabase(row!.id);
  const before = await readBrowserLocalCollection(page, 'cases', { databaseName: destination });
  await recovery.getByLabel('Restore original files', { exact: true }).setInputFiles({ name: 'unmatched.txt', mimeType: 'text/plain', buffer: Buffer.from('Not in this backup') });
  await expect(recovery.getByRole('alert')).toContainText('No files from this operation were added.');
  await expect(recovery.getByRole('alert')).not.toContainText('The write completed');
  expect(await readBrowserLocalCollection(page, 'cases', { databaseName: destination })).toEqual(before);
  expect(await storedFiles(page, destination)).toEqual([]);
  await deleteRehearsal(page);
});

test('an aborted restore cannot be reported as saved and its empty destination can be inspected and deleted', async ({ page }) => {
  await page.goto('/dashboard'); await review(page, await simpleBackup());
  const before = await readBrowserLocalCollection(page, 'cases');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put; let pending = true;
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      if (pending && this.transaction.db.name.startsWith('whoisleuth-workspace-') && this.name === 'manifests' && value && typeof value === 'object'
        && Reflect.get(value, 'collection') === 'cases' && Reflect.get(value, 'revision') === 2) {
        pending = false; throw new DOMException('Synthetic restore quota failure', 'QuotaExceededError');
      }
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
  });
  const recovery = await start(page);
  await expect(recovery.getByRole('alert')).toContainText('write outcome is unconfirmed');
  await expect(recovery.getByRole('alert')).toBeFocused();
  await expect(recovery.locator(':scope > .status')).toHaveCount(1);
  await expect(recovery.locator(':scope > .status')).toHaveText('');
  const [row] = await directoryRows(page); expect(row).toBeDefined();
  expect((await readBrowserLocalCollection(page, 'cases', { databaseName: namedDatabase(row!.id) })).records).toEqual([]);
  await recovery.getByRole('button', { name: 'Verify restored data', exact: true }).click();
  await expect(recovery.getByRole('status')).toContainText('recovery is not fully verified');
  await expect(recovery.locator('.result')).toContainText('0 Cases · Case identities not verified');
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  await deleteRehearsal(page);
});

test('a workspace larger than one file-operation allowance recovers every original across separate batches', async ({ page }) => {
  test.slow();
  const size = 33 * 1024 * 1024;
  const references = [1, 2].map(value => ({ id: `large-${value}`, fileName: `original-${value}.bin`, mediaType: 'application/octet-stream' as const,
    source: null, observedAt: null, retainedAt: NOW, byteLength: size,
    digestSha256: `sha256:${createHash('sha256').update(Buffer.alloc(size, value)).digest('hex')}` }));
  const archive = await buildWorkspaceArchive({ cases: [{ ...createCase({ domain: 'large-recovery.example' }, NOW), id: 'large-recovery', attachments: references }] }, { generatedAt: NOW });
  await page.goto('/dashboard'); await review(page, JSON.stringify(archive)); const recovery = await start(page);
  await expect(recovery.locator('.result')).toContainText('0 of 2 unique files verified · 2 missing');
  for (const value of [1, 2]) {
    await recovery.getByLabel('Restore original files', { exact: true }).setInputFiles({ name: `renamed-${value}.bin`, mimeType: 'application/octet-stream', buffer: Buffer.alloc(size, value) });
    await expect(recovery.locator('.result')).toContainText(`${value} of 2 unique files verified · ${2 - value} missing`);
  }
  await expect(recovery.getByRole('status')).toContainText('Recovery verified');
  const [row] = await directoryRows(page);
  const actual = await page.evaluate(async name => {
    const request = indexedDB.open(name); const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const read = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const keys = await read(db.transaction('files').objectStore('files').getAllKeys());
      if (keys.length !== 2) throw new Error('The independent large-file fixture requires exactly two stored files.');
      const results: { bytes: number; digest: string }[] = [];
      for (const key of keys) {
        const item = await read(db.transaction('files').objectStore('files').get(key)) as { payload: ArrayBuffer };
        if (!(item.payload instanceof ArrayBuffer) || item.payload.byteLength !== 33 * 1024 * 1024) throw new Error('Unexpected retained fixture size.');
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', item.payload));
        results.push({ bytes: item.payload.byteLength, digest: `sha256:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}` });
      }
      return results;
    } finally { db.close(); }
  }, namedDatabase(row!.id));
  expect(actual.map(item => item.digest).sort()).toEqual(references.map(item => item.digestSha256).sort());
  expect(actual.reduce((sum, item) => sum + item.bytes, 0)).toBe(66 * 1024 * 1024);
  expect((await readBrowserLocalCollection(page, 'cases')).records).toEqual([]);
  await deleteRehearsal(page);
});
