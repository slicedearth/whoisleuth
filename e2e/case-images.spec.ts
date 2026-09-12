import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { openCaseSection } from './console-navigation';
import { readBrowserLocalCollection, failNextBrowserLocalCollectionReadAfterWrite, expectNoHorizontalOverflow, useTheme } from './helpers';
import { failNextFileWrite, openRetainedFiles } from './case-attachment-fixtures';
import { IMAGE_NAME, openImageReview, addImageRegion, expectEditedPixels } from './case-image-fixtures';

test('edited PNGs preserve originals and source context, verify every output pixel, and use the existing atomic save', async ({ page }) => {
  const { review, files, bytes } = await openImageReview(page, 2);
  const before = await readBrowserLocalCollection(page, 'cases');
  const original = before.records[0]!.value.attachments!.find(item => item.fileName === IMAGE_NAME)!;
  const other = before.records[0]!.value.attachments!.find(item => item.fileName !== IMAGE_NAME)!;
  await review.getByRole('combobox', { name: 'Compare with another retained PNG', exact: true }).selectOption(other.id);
  await expect(review.getByRole('region', { name: 'Comparison image', exact: true }).getByRole('img')).toBeVisible();
  await expect(review).toContainText('identical bytes'); await expect(review).toContainText('observations remain separate');
  await expect(review).toContainText('capture viewport are not recorded');
  await review.getByRole('button', { name: 'Create edited PNG', exact: true }).click();
  await addImageRegion(review, 'redact');
  await addImageRegion(review, 'outline', { x: 60, y: 40, width: 180, height: 80 });
  await review.getByRole('button', { name: 'Prepare edited PNG', exact: true }).click();
  await expectEditedPixels(review);
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  await expect(review.getByRole('button', { name: 'Retain edited PNG', exact: true })).toBeDisabled();
  await review.getByRole('checkbox', { name: 'I reviewed the edited image', exact: true }).check();
  await failNextFileWrite(page);
  await review.getByRole('button', { name: 'Retain edited PNG', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'out of storage space' })).toBeVisible();
  await expect(review.getByRole('checkbox', { name: 'I reviewed the edited image', exact: true })).toBeChecked();
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  await failNextBrowserLocalCollectionReadAfterWrite(page, 'cases');
  await review.getByRole('button', { name: 'Retain edited PNG', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'The change was saved, but Cases could not be reread' })).toBeVisible();
  await expect(review.getByRole('button', { name: 'Retain edited PNG', exact: true })).toHaveCount(0);
  await expect(review).toBeFocused();
  const after = await readBrowserLocalCollection(page, 'cases');
  expect(after.manifest.revision).toBe(before.manifest.revision + 1);
  const attachments = after.records[0]!.value.attachments!, derivative = attachments.find(item => item.derivation)!;
  expect(attachments.find(item => item.id === original.id)).toEqual(original);
  expect(derivative.id).not.toBe(original.id); expect(derivative.digestSha256).not.toBe(original.digestSha256);
  expect(derivative.source).toBe(original.source); expect(derivative.observedAt).toBe(original.observedAt);
  expect(derivative.derivation).toMatchObject({ method: 'png-regions-v1', sourceAttachmentId: original.id, source: { digestSha256: original.digestSha256, byteLength: original.byteLength } });
  for (const [label, name] of [[`Download original ${IMAGE_NAME}`, IMAGE_NAME], [`Download derivative ${derivative.fileName}`, derivative.fileName]] as const) {
    const download = page.waitForEvent('download'); await files.getByRole('button', { name: label, exact: true }).click();
    const saved = await download, output = await readFile((await saved.path())!);
    expect(saved.suggestedFilename()).toBe(name);
    if (name === IMAGE_NAME) expect(output).toEqual(bytes);
    else { expect(output.includes(Buffer.from('Private fixture metadata'))).toBe(false); expect(`sha256:${createHash('sha256').update(output).digest('hex')}`).toBe(derivative.digestSha256); }
  }
  await files.getByRole('button', { name: `Remove ${IMAGE_NAME}`, exact: true }).click();
  await expect(files).toContainText('derivatives will keep their source fingerprint');
});

test('image drafts survive stage changes and cancelled navigation; pointer, keyboard and narrow layouts remain usable', async ({ page }, testInfo) => {
  const { review, files } = await openImageReview(page, 2);
  await review.getByRole('button', { name: 'Create edited PNG', exact: true }).click();
  await review.getByRole('button', { name: 'Select a region on image', exact: true }).click();
  const picker = review.getByRole('button', { name: 'Select an image region:', exact: false });
  await expect(picker).toBeFocused();
  const bounds = await picker.boundingBox(); expect(bounds).not.toBeNull();
  // Native engines differ in delivery of injected fractional CSS coordinates.
  // Use integer positions and check the actual source-pixel mapping exactly.
  const start = { x: Math.ceil(bounds!.x + bounds!.width / 4), y: Math.ceil(bounds!.y + bounds!.height / 4) };
  const end = { x: Math.ceil(bounds!.x + bounds!.width / 2), y: Math.ceil(bounds!.y + bounds!.height / 2) };
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y); await page.mouse.up();
  await expect(review.getByRole('spinbutton', { name: 'Left', exact: true })).toHaveValue(String(Math.floor((start.x - bounds!.x) * 640 / bounds!.width)));
  await expect(review.getByRole('spinbutton', { name: 'Top', exact: true })).toHaveValue(String(Math.floor((start.y - bounds!.y) * 360 / bounds!.height)));
  await expect(review.getByRole('button', { name: 'Add region', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(review.getByRole('button', { name: 'Remove region 1', exact: true })).toBeVisible();
  await openCaseSection(page, 'Assessment'); await openRetainedFiles(page);
  await expect(review.getByRole('button', { name: 'Remove region 1', exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss()); await files.getByRole('button', { name: 'Close file preview', exact: true }).click();
  await expect(review).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('link', { name: 'All Cases', exact: true }).click();
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'Select a region on image', exact: true }).click();
  await expect(picker).toBeFocused(); await page.keyboard.press('Enter');
  await expect(review.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('640');
  await expect(review.getByRole('spinbutton', { name: 'Height', exact: true })).toHaveValue('360');
  await review.getByRole('button', { name: 'Add region', exact: true }).click();
  await review.getByRole('button', { name: 'Prepare edited PNG', exact: true }).click();
  await expect(review.getByRole('region', { name: 'Prepared edited image', exact: true }).getByRole('img')).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 2560]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 }); await review.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      const geometry = await review.evaluate(element => {
        const container = element.getBoundingClientRect();
        return [...element.querySelectorAll<HTMLElement>('button,input,select,canvas')].filter(item => item.getClientRects().length).every(item => {
          const bounds = item.getBoundingClientRect(); return bounds.left >= container.left - 1 && bounds.right <= container.right + 1;
        });
      });
      expect(geometry).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`image-review-${theme}-${width}.png`) });
      await review.locator('.image-edit').scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`image-editor-${theme}-${width}.png`) });
    }
    expect((await new AxeBuilder({ page }).include('.image-review').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  }
  page.once('dialog', dialog => dialog.accept()); await files.getByRole('button', { name: 'Close file preview', exact: true }).click();
  await expect(review).toHaveCount(0); await expect(files.getByRole('button', { name: `Preview ${IMAGE_NAME}`, exact: true })).toBeFocused();
});

test('cancelled and failed native encoding never retain a partial result or discard the region draft', async ({ page }) => {
  const { review } = await openImageReview(page);
  const before = await readBrowserLocalCollection(page, 'cases');
  await review.getByRole('button', { name: 'Create edited PNG', exact: true }).click(); await addImageRegion(review, 'redact');
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    let release: (() => void) | null = null;
    HTMLCanvasElement.prototype.toBlob = function(callback, ...arguments_) {
      original.call(this, blob => { release = () => callback(blob); }, ...arguments_);
    };
    Object.defineProperty(window, 'releaseImageEncoding', { configurable: true, value: () => { if (!release) return false; release(); HTMLCanvasElement.prototype.toBlob = original; return true; } });
    Object.defineProperty(window, 'imageEncodingWaiting', { configurable: true, get: () => release !== null });
  });
  await review.getByRole('button', { name: 'Prepare edited PNG', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { imageEncodingWaiting: boolean }).imageEncodingWaiting)).toBe(true);
  await review.getByRole('button', { name: 'Cancel preparation', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { releaseImageEncoding(): boolean }).releaseImageEncoding())).toBe(true);
  await expect(review.getByRole('button', { name: 'Prepare edited PNG', exact: true })).toBeEnabled();
  await expect(review.getByRole('region', { name: 'Prepared edited image', exact: true })).toHaveCount(0);
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback) { HTMLCanvasElement.prototype.toBlob = original; callback(null); };
  });
  await review.getByRole('button', { name: 'Prepare edited PNG', exact: true }).click();
  await expect(review.getByRole('alert')).toContainText('could not be encoded');
  await expect(review.getByRole('button', { name: 'Remove region 1', exact: true })).toBeVisible();
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  await review.getByRole('button', { name: 'Prepare edited PNG', exact: true }).click();
  await expect(review.getByRole('region', { name: 'Prepared edited image', exact: true }).getByRole('img')).toBeVisible();
});

test('another tab removing a source cannot make a prepared derivative claim a successful save', async ({ page, context }) => {
  const { review } = await openImageReview(page);
  await review.getByRole('button', { name: 'Create edited PNG', exact: true }).click(); await addImageRegion(review, 'redact');
  await review.getByRole('button', { name: 'Prepare edited PNG', exact: true }).click();
  await expect(review.getByRole('region', { name: 'Prepared edited image', exact: true }).getByRole('img')).toBeVisible();
  const peer = await context.newPage();
  try {
    await peer.goto(page.url()); const files = await openRetainedFiles(peer);
    await files.getByRole('button', { name: `Remove ${IMAGE_NAME}`, exact: true }).click();
    await files.getByRole('button', { name: 'Confirm removal', exact: true }).click();
    await expect(files).toContainText('No file references'); await page.bringToFront();
    await expect(review.getByRole('region', { name: 'Prepared edited image', exact: true })).toBeVisible();
    await review.getByRole('checkbox', { name: 'I reviewed the edited image', exact: true }).check();
    // The open form remains a deliberate snapshot; the write transaction checks
    // the current source without replacing the analyst's in-memory draft.
    await review.getByRole('button', { name: 'Retain edited PNG', exact: true }).click();
    await expect(review.getByRole('alert')).toContainText('source reference changed or was removed');
    await expect(review.getByRole('button', { name: 'Retain edited PNG', exact: true })).toBeDisabled();
    expect((await readBrowserLocalCollection(page, 'cases')).records[0]!.value.attachments).toEqual([]);
  } finally { await peer.close(); }
});

test('the exact decoded-image pixel bound can be prepared without changing retained evidence', async ({ page }) => {
  const { review } = await openImageReview(page, 1, { width: 4096, height: 4096 });
  const before = await readBrowserLocalCollection(page, 'cases');
  await review.getByRole('button', { name: 'Create edited PNG', exact: true }).click();
  await review.getByRole('button', { name: 'Add region', exact: true }).click();
  await review.getByRole('button', { name: 'Prepare edited PNG', exact: true }).click();
  const image = review.getByRole('region', { name: 'Prepared edited image', exact: true });
  await expect(image.getByRole('img', { name: /4096 by 4096/ })).toBeVisible();
  expect(await image.locator('canvas').evaluate(element => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('The bounded output canvas is required.');
    return { pixels: element.width * element.height, corner: [...element.getContext('2d')!.getImageData(4095, 4095, 1, 1).data] };
  })).toEqual({ pixels: 16_777_216, corner: [0, 0, 0, 255] });
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
});
