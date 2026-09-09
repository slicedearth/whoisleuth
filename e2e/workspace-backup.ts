import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { openDashboardSecondaryWorkspaces } from './helpers';

export async function downloadWorkspaceArchive(page: Page) {
  await openDashboardSecondaryWorkspaces(page);
  const details = page.locator('.workspace-archive details.archive-details');
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download unencrypted backup' }).click();
  const download = await pending;
  const body = await (await download.createReadStream()).toArray();
  return { download, content: Buffer.concat(body).toString('utf-8') };
}

export async function downloadEncryptedWorkspaceArchive(page: Page, passphrase: string) {
  await openDashboardSecondaryWorkspaces(page);
  await page.getByRole('button', { name: 'Download encrypted backup' }).click();
  await page.getByLabel(/^Passphrase/).fill(passphrase);
  await page.getByLabel('Confirm passphrase').fill(passphrase);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Encrypt and download' }).click();
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
  await page.getByLabel('Review backup file').setInputFiles(file);
}

export function workspaceArchiveStatus(page: Page) {
  return page.locator('.workspace-archive .status[role="status"]');
}
