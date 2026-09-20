import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { openDashboardSecondaryWorkspaces } from './helpers';

// Independent on-disk expectations: selecting another workspace must not change
// these public default names, or include directory identity in a portable file.
export const DIRECTORY = 'whoisleuth-workspace-directory-v1';
export const SELECTION = 'whoisleuth:workspace-selection:v1';
export const DEFAULT_DATABASE = 'whoisleuth-browser-data-v1';
export const NOW = '2026-09-01T00:00:00.000Z';
export type DirectoryRow = { id: string; name: string; revision: number; state: string; createdAt: string; updatedAt: string };
export const namedDatabase = (id: string) => `whoisleuth-workspace-${id}-v1`;
export const manager = (page: Page) => page.getByRole('region', { name: 'Browser workspaces', exact: true });
export const indicator = (page: Page) => page.locator('#main-content > .workspace-scope strong');

export async function directoryRows(page: Page): Promise<DirectoryRow[]> {
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

export async function openManager(page: Page) {
  await expect(indicator(page)).not.toHaveText('Loading…');
  const disclosure = page.locator('#workspaces');
  if (await disclosure.getAttribute('open') === null) await disclosure.locator(':scope > summary').click();
  await expect(manager(page).getByRole('button', { name: 'Create workspace', exact: true })).toBeVisible();
  await expect(manager(page).getByLabel('New workspace name', { exact: true })).toBeEnabled();
  return manager(page);
}

export async function createWorkspace(page: Page, name: string) {
  const panel = await openManager(page);
  await panel.getByLabel('New workspace name', { exact: true }).fill(name);
  await panel.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Workspace created.');
  const row = (await directoryRows(page)).find(row => row.name === name);
  expect(row).toBeDefined();
  return row!;
}

export async function switchWorkspace(page: Page, name: string) {
  const panel = await openManager(page);
  await panel.getByRole('button', { name: name === 'Default' ? 'Open default workspace' : `Open workspace ${name}`, exact: true }).click();
  await expect(panel.getByRole('heading', { name: `Open ${name}?`, exact: true })).toBeFocused();
  await Promise.all([page.waitForEvent('load'), panel.getByRole('button', { name: 'Switch workspace', exact: true }).click()]);
  await expect(indicator(page)).toHaveText(name);
}

export async function openArchive(page: Page, empty = false) {
  if (empty) await page.getByRole('button', { name: /Import existing work/u }).click();
  else await openDashboardSecondaryWorkspaces(page);
  const archive = page.locator('.workspace-archive');
  await expect(archive.getByLabel('Review backup file', { exact: true })).toBeVisible();
  return archive;
}
