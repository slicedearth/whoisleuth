import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { caseRecord } from './case-test-fixtures';
import { currentBrowserLocalDocument, expectNoHorizontalOverflow, failNextBrowserLocalManifestWrite, failBrowserLocalCollectionReads, migrateLegacyBrowserData, readBrowserLocalCollection, useTheme } from './helpers';
import { createWorkspace, namedDatabase, openArchive, switchWorkspace } from './browser-workspace-fixtures';
import { downloadWorkspaceArchive, downloadEncryptedWorkspaceArchive } from './workspace-backup';

async function seed(page: Page) {
  await page.clock.setFixedTime('2026-09-13T10:00:00.000Z');
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [
    caseRecord({ id: 'first-view-case', domain: 'first-view.example', status: 'monitoring', disposition: 'suspicious' }),
    caseRecord({ id: 'second-view-case', domain: 'second-view.example', status: 'reviewing' }),
  ] }) }, { clearStorage: true, destination: '/cases' });
}
async function savedViews(page: Page) {
  const panel = page.locator('details.saved-views');
  const summary = panel.locator(':scope > summary');
  await expect(summary).toBeVisible();
  if (await panel.getAttribute('open') === null) await summary.click();
  await expect(panel.getByLabel('View name', { exact: true })).toBeEnabled();
  return panel;
}
function collectionCounter(page: Page) {
  let count = 0;
  page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/') && !['/api/session', '/api/capabilities'].includes(path)) count += 1; });
  return () => count;
}

test('saved Case views preserve failed drafts, reject concurrent replacement and filter without collection', async ({ page, context }, testInfo) => {
  const requests = collectionCounter(page);
  await seed(page);
  const casesBefore = await readBrowserLocalCollection(page, 'cases');
  const filters = page.locator('.case-filters');
  await filters.getByRole('combobox', { name: 'Status', exact: true }).selectOption('monitoring');
  await filters.getByRole('combobox', { name: 'Disposition', exact: true }).selectOption('suspicious');
  await filters.getByLabel('Search', { exact: true }).fill('first-view');
  await filters.getByRole('combobox', { name: 'Sort', exact: true }).selectOption('domain');
  await expect(page.locator('.case-head')).toHaveCount(1);
  let panel = await savedViews(page);
  await panel.getByLabel('View name', { exact: true }).fill('Follow up suspicious Cases');
  const save = panel.getByRole('button', { name: 'Save as new view', exact: true });
  await failNextBrowserLocalManifestWrite(page, 'case_views');
  await save.focus(); await page.keyboard.press('Enter');
  await expect(panel.getByRole('status')).toContainText(/quota|storage|write/iu);
  await expect(save).toBeFocused();
  await expect(panel.getByLabel('View name', { exact: true })).toHaveValue('Follow up suspicious Cases');
  expect((await readBrowserLocalCollection(page, 'case_views')).records).toEqual([]);
  await save.press('Enter');
  await expect(panel.getByRole('status')).toContainText('Saved the view in this workspace');
  await expect(panel.getByRole('combobox', { name: 'Saved view', exact: true })).toBeFocused();
  const stored = await readBrowserLocalCollection(page, 'case_views', { minimumRecords: 1 });
  const view = stored.records[0]!.value;
  expect(view.filters).toEqual({ status: 'monitoring', disposition: 'suspicious', search: 'first-view', sort: 'domain' });
  await page.reload(); panel = await savedViews(page);
  await expect(page.locator('.case-head')).toHaveCount(2);
  await panel.getByRole('combobox', { name: 'Saved view', exact: true }).selectOption(view.id);
  await panel.getByRole('button', { name: 'Apply view', exact: true }).press('Enter');
  await expect(page.locator('.case-head')).toHaveCount(1);
  await expect(filters.getByLabel('Search', { exact: true })).toHaveValue('first-view');
  await expect(filters.getByRole('combobox', { name: 'Sort', exact: true })).toHaveValue('domain');

  const peer = await context.newPage();
  const peerRequests = collectionCounter(peer);
  try {
    await peer.clock.setFixedTime('2026-09-13T11:00:00.000Z');
    await peer.goto('/cases');
    const other = await savedViews(peer);
    await other.getByRole('combobox', { name: 'Saved view', exact: true }).selectOption(view.id);
    await other.getByLabel('View name', { exact: true }).fill('Reviewed in another tab');
    await other.getByRole('button', { name: 'Update selected view', exact: true }).click();
    await expect(other.getByRole('status')).toContainText('Saved the view');
    await panel.getByLabel('View name', { exact: true }).fill('Keep this unsaved name');
    await panel.getByRole('button', { name: 'Update selected view', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('changed or was deleted');
    await expect(panel.getByLabel('View name', { exact: true })).toHaveValue('Keep this unsaved name');
    expect((await readBrowserLocalCollection(page, 'case_views')).records[0]!.value.name).toBe('Reviewed in another tab');
    await panel.getByRole('button', { name: 'Refresh saved views', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('changed elsewhere');
    await expect(panel.getByRole('button', { name: 'Update selected view', exact: true })).toBeDisabled();
    await expect(panel.getByLabel('View name', { exact: true })).toHaveValue('Keep this unsaved name');
    await panel.getByRole('combobox', { name: 'Saved view', exact: true }).selectOption('');
    await panel.getByRole('combobox', { name: 'Saved view', exact: true }).selectOption(view.id);
    await expect(panel.getByLabel('View name', { exact: true })).toHaveValue('Reviewed in another tab');
  } finally { await peer.close(); }

  for (const width of [320, 390, 1024, 1280, 2560]) for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    await useTheme(page, theme);
    await panel.locator(':scope > summary').focus();
    await expectNoHorizontalOverflow(page);
    const geometry = await panel.evaluate(element => {
      const outer = element.getBoundingClientRect();
      return [...element.querySelectorAll('input,select,button')].map(control => ({ left: control.getBoundingClientRect().left - outer.left, right: control.getBoundingClientRect().right - outer.left, height: control.getBoundingClientRect().height, width: outer.width }));
    });
    expect(geometry).toHaveLength(7);
    for (const control of geometry) { expect(control.left).toBeGreaterThanOrEqual(-1); expect(control.right).toBeLessThanOrEqual(control.width + 1); if (width < 500) expect(control.height).toBeGreaterThanOrEqual(44); }
    await page.screenshot({ path: testInfo.outputPath(`case-views-${theme}-${width}.png`) });
  }
  expect((await new AxeBuilder({ page }).include('.saved-views').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  page.once('dialog', dialog => dialog.accept());
  await panel.getByRole('button', { name: 'Delete selected view', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Deleted the saved view');
  expect((await readBrowserLocalCollection(page, 'case_views')).records).toEqual([]);
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(casesBefore);
  expect(requests()).toBe(0); expect(peerRequests()).toBe(0);
});

test('real saved views travel in encrypted and unencrypted backups and restore only into the selected workspace', async ({ page }) => {
  const requests = collectionCounter(page);
  await seed(page);
  const panel = await savedViews(page);
  await page.locator('.case-filters').getByLabel('Search', { exact: true }).fill('first-view');
  await panel.getByLabel('View name', { exact: true }).fill('Private selected review');
  await panel.getByRole('button', { name: 'Save as new view', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Saved the view');
  const original = await readBrowserLocalCollection(page, 'case_views', { minimumRecords: 1 });
  await page.goto('/dashboard');
  const plain = await downloadWorkspaceArchive(page);
  const document = JSON.parse(plain.content);
  expect(document.version).toBe(9);
  expect(document.sections.caseViews.views).toEqual(original.records.map(record => record.value));
  expect(JSON.stringify(document.sections.cases)).not.toContain('Private selected review');
  const passphrase = 'Reserved encrypted backup fixture';
  const encrypted = await downloadEncryptedWorkspaceArchive(page, passphrase);
  expect(encrypted.content).not.toContain('Private selected review');
  expect(encrypted.content).not.toContain('first-view');
  const row = await createWorkspace(page, 'View restoration');
  await switchWorkspace(page, row.name);
  const archive = await openArchive(page, true);
  await archive.getByLabel('Review backup file', { exact: true }).setInputFiles({ name: 'selected-backup.json', mimeType: 'application/json', buffer: Buffer.from(encrypted.content) });
  await archive.getByLabel('Backup passphrase', { exact: true }).fill(passphrase);
  await archive.getByRole('button', { name: 'Unlock and review', exact: true }).click();
  await expect(archive.getByRole('heading', { name: 'Choose saved data to add' })).toBeVisible();
  await expect(archive).toContainText('Saved Case views');
  await archive.getByRole('button', { name: 'Add selected data', exact: true }).click();
  await expect(archive.locator('.status')).toContainText('Added backup data');
  expect((await readBrowserLocalCollection(page, 'case_views', { databaseName: namedDatabase(row.id), minimumRecords: 1 })).records.map(record => record.value)).toEqual(original.records.map(record => record.value));
  expect(await readBrowserLocalCollection(page, 'case_views')).toEqual(original);
  await page.goto('/cases');
  const restored = await savedViews(page);
  await restored.getByRole('combobox', { name: 'Saved view', exact: true }).selectOption(original.records[0]!.value.id);
  await restored.getByRole('button', { name: 'Apply view', exact: true }).click();
  await expect(page.locator('.case-head')).toHaveCount(1);
  await expect(page.locator('.case-head')).toContainText('first-view.example');
  expect(requests()).toBe(0);
});

test('unavailable saved views do not hide Cases or permit an empty replacement', async ({ page }) => {
  await seed(page);
  const panel = await savedViews(page);
  await failBrowserLocalCollectionReads(page, 'case_views');
  await panel.getByRole('button', { name: 'Refresh saved views', exact: true }).click();
  await expect(panel.getByRole('status')).not.toHaveText('');
  await expect(panel.getByLabel('View name', { exact: true })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Save as new view', exact: true })).toBeDisabled();
  await expect(page.locator('.case-head')).toHaveCount(2);
});
