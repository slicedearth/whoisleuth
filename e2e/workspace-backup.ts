import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { openDashboardSecondaryWorkspaces } from './helpers';

export function workspaceArchiveRegion(page: Page) {
  return page.getByRole('region', { name: /^(?:Back up or move saved work|Import a workspace)$/u });
}

export function workspaceArchivePreview(page: Page) {
  return workspaceArchiveRegion(page).getByRole('group', { name: 'Choose saved data to add', exact: true });
}

export async function downloadWorkspaceArchive(page: Page) {
  await openDashboardSecondaryWorkspaces(page);
  const archive = workspaceArchiveRegion(page);
  const details = archive.locator('details').filter({ has: page.getByText('How workspace backups work', { exact: true }) });
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
  const pending = page.waitForEvent('download');
  await archive.getByRole('button', { name: 'Download unencrypted backup' }).click();
  const download = await pending;
  const body = await (await download.createReadStream()).toArray();
  return { download, content: Buffer.concat(body).toString('utf-8') };
}

export async function downloadEncryptedWorkspaceArchive(page: Page, passphrase: string) {
  await openDashboardSecondaryWorkspaces(page);
  const archive = workspaceArchiveRegion(page);
  await archive.getByRole('button', { name: 'Download encrypted backup' }).click();
  await archive.getByLabel(/^Passphrase/).fill(passphrase);
  await archive.getByLabel('Confirm passphrase').fill(passphrase);
  const pending = page.waitForEvent('download');
  await archive.getByRole('button', { name: 'Encrypt and download' }).click();
  const download = await pending;
  const body = await (await download.createReadStream()).toArray();
  return { download, content: Buffer.concat(body).toString('utf-8') };
}

export async function reviewWorkspaceBackup(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  const savedWorkTrigger = page.getByRole('button', { name: 'Open saved-work tools' });
  const importTrigger = page.getByRole('button', { name: /Import existing work/u });
  await expect(savedWorkTrigger.or(importTrigger)).toBeVisible();
  if (await savedWorkTrigger.isVisible()) {
    await openDashboardSecondaryWorkspaces(page);
  } else {
    if (await importTrigger.getAttribute('aria-expanded') !== 'true') await importTrigger.click();
    await expect(importTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('heading', { name: 'Import existing work', exact: true })).toBeVisible();
  }
  await workspaceArchiveRegion(page).getByLabel('Review backup file').setInputFiles(file);
}

export function workspaceArchiveStatus(page: Page) {
  return workspaceArchiveRegion(page).locator(':scope > [role="status"]');
}
