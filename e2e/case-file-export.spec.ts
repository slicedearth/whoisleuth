import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { readBrowserLocalCollection, expectNoHorizontalOverflow, useTheme, openDashboardSecondaryWorkspaces } from './helpers';
import { IMAGE_NAME, openImageReview, addImageRegion, expectEditedPixels } from './case-image-fixtures';
import { inspectInvestigationPackage } from '../packages/investigation/investigation-package.mts';
import { verifyOfflineInvestigationPackage } from '../cli/investigation-package-review.mts';

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
  expect(inspection.manifest.artifacts[0]).toMatchObject({ contentDigestSha256: source.digestSha256, source: { identity: source.source, observedAt: source.observedAt }, imageDerivation: null });
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
      if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`selected-file-export-${theme}-${width}.png`) }); }
    }
  }
});

test('selected redacted images carry minimal parent declarations through browser and offline CLI review', async ({ page }, testInfo) => {
  const { files, review, bytes: originalBytes } = await openImageReview(page);
  await review.getByRole('button', { name: 'Create edited PNG', exact: true }).click();
  await addImageRegion(review, 'redact');
  await addImageRegion(review, 'outline', { x: 60, y: 40, width: 180, height: 80 });
  await review.getByRole('button', { name: 'Prepare edited PNG', exact: true }).click();
  await expectEditedPixels(review);
  await review.getByRole('checkbox', { name: 'I reviewed the edited image', exact: true }).check();
  await review.getByRole('button', { name: 'Retain edited PNG', exact: true }).click();
  await expect(review.getByRole('button', { name: 'Retain edited PNG', exact: true })).toHaveCount(0);
  await files.getByRole('button', { name: 'Close file preview', exact: true }).click();
  const before = await readBrowserLocalCollection(page, 'cases');
  const record = before.records[0]!.value, attachments = record.attachments!;
  const parent = attachments.find(item => !item.derivation)!, derivative = attachments.find(item => item.derivation)!;
  await files.locator('.file-export-selection > summary').click();
  const selection = files.locator('.file-export-selection');
  await selection.getByRole('checkbox', { name: derivative.fileName }).check();
  await expect(selection).toContainText('1 selected · 1 not selected');
  const downloading = page.waitForEvent('download');
  await selection.getByRole('button', { name: 'Download private package', exact: true }).click();
  const download = await downloading, archive = await readFile((await download.path())!);
  const inspected = await inspectInvestigationPackage(archive);
  expect(inspected.identityVerified).toBe(true); expect(inspected.entries).toHaveLength(1);
  const declaration = { method: 'png-regions-v1', source: { digestSha256: parent.digestSha256, byteLength: parent.byteLength }, operations: ['redact', 'outline'] };
  expect(inspected.manifest.version).toBe(4);
  expect(inspected.manifest.artifacts[0]).toMatchObject({ contentDigestSha256: derivative.digestSha256, byteLength: derivative.byteLength, imageDerivation: declaration });
  expect(Buffer.from(inspected.contents.get('artifact-1')!)).not.toEqual(originalBytes);
  const metadata = JSON.stringify(inspected.manifest);
  for (const privateValue of [record.id, parent.id, derivative.id, parent.fileName, derivative.fileName, 'Private fixture metadata', 'sourceAttachmentId', '"plan"', '"regions"']) expect(metadata).not.toContain(privateValue);
  const offline = await verifyOfflineInvestigationPackage(archive);
  expect(offline.state).toBe('verified'); expect(offline.package!.entries[0]!.imageDerivation).toEqual(declaration);
  expect(offline.package!.caseFiles).toEqual([]);
  await page.goto('/dashboard'); await openDashboardSecondaryWorkspaces(page);
  const panel = page.getByRole('region', { name: 'Package and review evidence files' });
  await panel.getByLabel('Review evidence package', { exact: true }).setInputFiles({ name: 'selected.zip', mimeType: 'application/zip', buffer: archive });
  const edits = panel.locator('.image-derivation');
  await edits.getByText('Declared image edits: redaction, outline', { exact: true }).click();
  await expect(edits).toContainText(parent.digestSha256);
  await expect(edits).toContainText('does not prove the edits');
  await expect(panel).toContainText('Bytes verified');
  for (const theme of ['light', 'dark'] as const) for (const width of [320, 390, 1280]) {
    await useTheme(page, theme); await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    await edits.scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page);
    if (captureVisualEvidenceEnabled()) await page.screenshot({ path: testInfo.outputPath(`image-declaration-${theme}-${width}.png`) });
  }
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
});

test('missing retained bytes stop a selected export without clearing selection or changing Case metadata', async ({ page }) => {
  const { files } = await openImageReview(page);
  await files.getByRole('button', { name: 'Close file preview', exact: true }).click();
  const before = await readBrowserLocalCollection(page, 'cases');
  await files.locator('.file-export-selection > summary').click();
  const selected = files.locator('.file-export-selection');
  const selection = selected.getByRole('checkbox', { name: new RegExp(`^${IMAGE_NAME.replace('.', '\\.')}`) });
  await selection.check();
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
  await expect(selection).toBeChecked();
  await expect(selected.getByRole('button', { name: 'Download private package', exact: true })).toBeEnabled();
  expect(downloads).toBe(0); expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
});
