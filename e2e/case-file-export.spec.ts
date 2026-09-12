import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { readBrowserLocalCollection, expectNoHorizontalOverflow, useTheme } from './helpers';
import { IMAGE_NAME, openImageReview } from './case-image-fixtures';
import { inspectInvestigationPackage } from '../packages/investigation/investigation-package.mts';

test('selected retained files export exact bytes and source declarations without becoming a whole-workspace backup', async ({ page }, testInfo) => {
  const { files, bytes } = await openImageReview(page, 2);
  await files.getByRole('button', { name: 'Close file preview', exact: true }).click();
  const before = await readBrowserLocalCollection(page, 'cases');
  const source = before.records[0]!.value.attachments!.find(item => item.fileName === IMAGE_NAME)!;
  await files.locator('.file-export-selection > summary').click();
  const selected = files.locator('.file-export-selection');
  await selected.getByRole('checkbox', { name: new RegExp(`^${IMAGE_NAME.replace('.', '\\.')}`) }).check();
  await expect(selected).toContainText('1 selected · 1 not selected');
  const download = page.waitForEvent('download');
  await selected.getByRole('button', { name: 'Download private package', exact: true }).focus(); await page.keyboard.press('Enter');
  const result = await download;
  const inspection = await inspectInvestigationPackage(await readFile((await result.path())!));
  expect(inspection.identityVerified).toBe(true); expect(inspection.entries).toHaveLength(1);
  expect(Buffer.from(inspection.contents.get('artifact-1')!)).toEqual(bytes);
  expect(inspection.manifest.artifacts[0]).toMatchObject({ contentDigestSha256: source.digestSha256, source: { identity: source.source, observedAt: source.observedAt } });
  expect(JSON.stringify(inspection.manifest)).not.toContain(IMAGE_NAME);
  await expect(page.getByRole('status').filter({ hasText: 'not a complete workspace backup' })).toBeVisible();
  await expect(selected.getByRole('button', { name: 'Download private package', exact: true })).toBeFocused();
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 2560]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      await selected.scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page);
      expect(await selected.evaluate(element => {
        const outer = element.getBoundingClientRect();
        return [...element.querySelectorAll('button,input')].every(input => {
          const box = input.getBoundingClientRect(); return box.width > 0 && box.left >= outer.left - 1 && box.right <= outer.right + 1;
        });
      })).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`selected-file-export-${theme}-${width}.png`) });
    }
  }
});

test('missing retained bytes stop a selected export without clearing selection or changing Case metadata', async ({ page }) => {
  const { files } = await openImageReview(page);
  await files.getByRole('button', { name: 'Close file preview', exact: true }).click();
  const before = await readBrowserLocalCollection(page, 'cases');
  await files.locator('.file-export-selection > summary').click();
  const selected = files.locator('.file-export-selection');
  await selected.getByRole('checkbox').check();
  await page.evaluate(async () => {
    const request = indexedDB.open('whoisleuth-browser-data-v1');
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const transaction = database.transaction('files', 'readwrite'); transaction.objectStore('files').clear();
      await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); });
    } finally { database.close(); }
  });
  let downloads = 0; page.on('download', () => downloads++);
  await selected.getByRole('button', { name: 'Download private package', exact: true }).click();
  await expect(selected.getByRole('alert')).toContainText('original bytes are missing');
  await expect(selected.getByRole('checkbox')).toBeChecked();
  await expect(selected.getByRole('button', { name: 'Download private package', exact: true })).toBeEnabled();
  expect(downloads).toBe(0); expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
});
