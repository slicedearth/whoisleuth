import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { test, expect, openLocalApplication } from './local-application-fixtures';
import { createCase, openCasesView, openCaseResponseWorkspace } from './case-test-fixtures';
import { selectOriginal, openRetainedFiles, FILE_BYTES, FILE_NAME } from './case-attachment-fixtures';
import { downloadWorkspaceArchive, downloadEncryptedWorkspaceArchive, reviewWorkspaceBackup, workspaceArchiveRegion } from './workspace-backup';
import { expectNoHorizontalOverflow, useTheme } from './helpers';
import { caseStoreAtCapacity } from '../test/workspace-backup-capacity-fixture.mts';
import { serializeCaseStore, normalizeCaseStore, MAX_CASE_STORE_BYTES } from '../packages/cases/case-model.mts';
import { MAX_SELECTED_FILE_TOTAL_BYTES } from '../packages/contracts/selected-file-limits.mts';

async function pinForm(page: import('@playwright/test').Page) {
  const workspace = await openCaseResponseWorkspace(page);
  const details = workspace.locator('details').filter({ has: page.getByText('Pin an observed fact', { exact: true }) });
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
  return details.locator('form').first();
}

test('filesystem records, original files and recovery drafts survive restart and browser-data removal', async ({ page, context, localApplication }) => {
  test.slow();
  await openLocalApplication(page, localApplication);
  await openCasesView(page); await createCase(page, 'filesystem.example');
  const selected = page.url();
  let files = await selectOriginal(page);
  await files.getByRole('button', { name: 'Retain selected files', exact: true }).click();
  await expect(files).toContainText(FILE_NAME);
  let form = await pinForm(page);
  await form.getByLabel('Label', { exact: true }).fill('Unsubmitted local observation');
  await form.getByLabel('Fact', { exact: true }).fill('Recovery text is not submitted evidence.');
  await expect(form.getByRole('status')).toContainText('Draft saved in this workspace');
  await page.goto('/dashboard');
  const backup = await downloadWorkspaceArchive(page);
  expect(backup.content).toContain('filesystem.example');
  expect(backup.content).not.toContain('Recovery text is not submitted evidence.');
  expect(backup.content).not.toContain(localApplication.instance.directory);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await context.clearCookies();
  await localApplication.restart();
  await openLocalApplication(page, localApplication);
  await page.goto(selected); form = await pinForm(page);
  await form.getByText('1 saved draft for this form', { exact: true }).click();
  await form.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await expect(form.getByLabel('Fact', { exact: true })).toHaveValue('Recovery text is not submitted evidence.');
  await form.getByRole('button', { name: 'Pin evidence', exact: true }).click();
  await expect(form.getByLabel('Fact', { exact: true })).toHaveValue('');
  files = await openRetainedFiles(page);
  const pending = page.waitForEvent('download');
  await files.getByRole('button', { name: `Download original ${FILE_NAME}`, exact: true }).click();
  expect(Buffer.concat(await (await (await pending).createReadStream()).toArray())).toEqual(FILE_BYTES);
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
});

test('encrypted portable backups restore into a fresh filesystem workspace without browser recovery controls', async ({ page, localApplication }) => {
  test.slow();
  await openLocalApplication(page, localApplication);
  await openCasesView(page); await createCase(page, 'restored-filesystem.example');
  await page.goto('/dashboard');
  const password = '<synthetic filesystem backup passphrase>';
  const backup = await downloadEncryptedWorkspaceArchive(page, password);
  expect(backup.content).not.toContain('restored-filesystem.example');
  const previousId = await page.locator('meta[name="whoisleuth-local-workspace"]').getAttribute('content');
  await localApplication.restart(true);
  await openLocalApplication(page, localApplication);
  expect(await page.locator('meta[name="whoisleuth-local-workspace"]').getAttribute('content')).not.toBe(previousId);
  await reviewWorkspaceBackup(page, { name: 'encrypted-workspace.json', mimeType: 'application/json', buffer: Buffer.from(backup.content) });
  const archive = workspaceArchiveRegion(page);
  await archive.getByLabel('Backup passphrase', { exact: true }).fill(password);
  await archive.getByRole('button', { name: 'Unlock and review', exact: true }).click();
  await expect(archive.getByText('Rehearse filesystem recovery', { exact: true })).toBeVisible();
  await expect(archive.getByRole('button', { name: 'Create rehearsal and restore', exact: true })).toHaveCount(0);
  await archive.getByRole('button', { name: 'Add selected data', exact: true }).click();
  await expect(archive.locator(':scope > [role=status]')).toContainText('1 new, 0 existing matches, 0 skipped');
  await openCasesView(page);
  await expect(page.getByText('restored-filesystem.example', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
});

for (const theme of ['light', 'dark'] as const) {
  test(`local session and filesystem workspace use the shared layout in ${theme}`, async ({ page, localApplication }, testInfo) => {
    test.slow();
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Open local workspace', exact: true })).toBeVisible();
    await useTheme(page, theme);
    const viewports = [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 1024, height: 768 },
      { width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 3840, height: 2160 }];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport); await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`local-login-${theme}-${viewport.width}.png`) });
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await openLocalApplication(page, localApplication);
    await page.locator('#workspaces > summary').click();
    const workspace = page.getByRole('region', { name: 'Filesystem workspace', exact: true });
    await expect(workspace).toContainText('Offline — network collection disabled');
    await expect(page.getByRole('button', { name: 'Create workspace', exact: true })).toHaveCount(0);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport); await expectNoHorizontalOverflow(page);
      await page.locator('#workspaces > summary').focus();
      await page.locator('#workspaces').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
      const header = await page.locator('.shell > header').boundingBox();
      const heading = await workspace.getByRole('heading', { name: 'Filesystem workspace', exact: true }).boundingBox();
      expect(header).not.toBeNull(); expect(heading).not.toBeNull();
      expect(heading!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
      await page.screenshot({ path: testInfo.outputPath(`local-workspace-${theme}-${viewport.width}.png`) });
      if (viewport.width === 320 || viewport.width === 1280) expect((await new AxeBuilder({ page }).include('.local-workspace').analyze()).violations).toEqual([]);
    }
    const link = workspace.getByRole('link', { name: 'Local application setup and recovery', exact: true });
    await link.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Console with a filesystem workspace', exact: true })).toBeInViewport();
  });
}

test('a maximum Case collection and retained file reach the filesystem Console without pruning', async ({ page, localApplication }, testInfo) => {
  test.slow();
  await openLocalApplication(page, localApplication);
  await page.goto('/cli');
  const { cases } = caseStoreAtCapacity();
  const bytes = Buffer.alloc(MAX_SELECTED_FILE_TOTAL_BYTES, 83);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const record = cases[0]!;
  record.attachments = [{ id: 'maximum-original', fileName: 'maximum-original.bin', mediaType: 'application/octet-stream',
    source: null, observedAt: null, retainedAt: record.updatedAt, byteLength: bytes.byteLength, digestSha256: `sha256:${digest}` }];
  const extra = Buffer.byteLength(serializeCaseStore(cases)) - MAX_CASE_STORE_BYTES;
  expect(extra).toBeGreaterThan(0);
  const note = cases.flatMap(item => item.notes).find(item => item.body.length > extra)!;
  expect(note).toBeDefined(); note.body = note.body.slice(0, -extra);
  expect(normalizeCaseStore(JSON.parse(serializeCaseStore(cases))).cases).toEqual(cases);
  expect(Buffer.byteLength(serializeCaseStore(cases))).toBe(MAX_CASE_STORE_BYTES);
  // Independently populate a valid on-disk fixture. Driver tests separately
  // exercise maximum writes; this test measures actual browser admission.
  const database = new DatabaseSync(path.join(localApplication.instance.directory, 'workspace.sqlite'));
  try {
    const manifest = JSON.parse(String(database.prepare('SELECT manifest FROM collections WHERE id=?').get('cases')!.manifest));
    const rows = cases.map((item, ordinal) => {
      const payload = JSON.stringify({ id: item.id, value: item });
      return [item.id, ordinal, 'json-v1', payload, Buffer.byteLength(payload)];
    });
    manifest.revision++; manifest.recordCount = cases.length; manifest.serializedBytes = MAX_CASE_STORE_BYTES;
    manifest.digest = createHash('sha256').update(JSON.stringify(rows)).digest('base64url'); manifest.source = 'application';
    database.exec('BEGIN IMMEDIATE');
    database.prepare('DELETE FROM records WHERE collection=?').run('cases');
    database.prepare('UPDATE collections SET manifest=? WHERE id=?').run(JSON.stringify(manifest), 'cases');
    const insert = database.prepare('INSERT INTO records(collection,key,ordinal,payload,bytes) VALUES(?,?,?,?,?)');
    for (const row of rows) insert.run('cases', String(row[0]), Number(row[1]), String(row[3]), Number(row[4]));
    database.prepare('INSERT INTO files(key,content) VALUES(?,?)').run(`sha256:${digest}`, bytes);
    database.exec('COMMIT');
  } finally { database.close(); }
  await page.goto(`/cases?case=${record.id}`);
  await expect(page.getByRole('heading', { name: record.domain, exact: true })).toBeVisible({ timeout: 30_000 });
  const browserElapsedAtVerifiedRender = await page.evaluate(() => performance.now());
  const files = await openRetainedFiles(page);
  await expect(files).toContainText('maximum-original.bin');
  const pending = page.waitForEvent('download');
  await files.getByRole('button', { name: 'Download original maximum-original.bin', exact: true }).click();
  const downloaded = Buffer.concat(await (await (await pending).createReadStream()).toArray());
  expect(downloaded.byteLength).toBe(MAX_SELECTED_FILE_TOTAL_BYTES);
  expect(createHash('sha256').update(downloaded).digest('hex')).toBe(digest);
  await testInfo.attach('filesystem-maximum-observation', { contentType: 'application/json', body: JSON.stringify({
    cases: cases.length, caseBytes: MAX_CASE_STORE_BYTES, retainedFileBytes: downloaded.byteLength,
    browserElapsedAtVerifiedRender, interpretation: 'Browser elapsed time at the host assertion, not a universal performance threshold or peak-memory measurement.',
  }) });
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
});
