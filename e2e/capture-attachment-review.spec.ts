import { expect, test } from './fixtures';
import { createCase, openCasesView } from './case-test-fixtures';
import { openCaseSection } from './console-navigation';
import { readBrowserLocalCollection, failNextBrowserLocalManifestWrite, expectNoHorizontalOverflow, useTheme } from './helpers';
import { captureReviewFixture } from '../test/capture-review-fixture.mts';
import { storedFiles, openRetainedFiles, failNextFileWrite } from './case-attachment-fixtures';

test('explicit capture retention commits matching original files with the imported evidence, excluding unmatched selections', async ({ page }) => {
  await openCasesView(page); await createCase(page, 'capture.example'); await openCaseSection(page, 'Evidence');
  const capture = page.locator('.capture-workspace'); await capture.locator(':scope > summary').click();
  const { manifestBytes, screenshot, dom } = captureReviewFixture();
  const before = await readBrowserLocalCollection(page, 'cases');
  await capture.getByLabel('Select capture manifest', { exact: true }).setInputFiles({ name: 'manifest.json', mimeType: 'application/json', buffer: manifestBytes });
  await capture.getByLabel('Select capture attachments to check', { exact: true }).setInputFiles([
    { name: 'renamed.png', mimeType: 'image/png', buffer: Buffer.from(screenshot) },
    { name: 'renamed.json', mimeType: 'application/json', buffer: dom },
    { name: 'unmatched.txt', mimeType: 'text/plain', buffer: Buffer.from('Unmatched bytes must not be retained by this action.') },
  ]);
  await expect(capture.getByRole('region', { name: 'Selected capture attachment checks', exact: true })).toContainText('1 selected file did not match');
  const retain = capture.getByRole('checkbox', { name: 'Retain this manifest and verified matching files in this workspace', exact: true });
  await expect(retain).not.toBeChecked(); await retain.check();
  expect(await storedFiles(page)).toEqual([]);
  await failNextFileWrite(page);
  await capture.getByRole('button', { name: 'Import into this Case', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'out of storage space' })).toBeVisible();
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before); expect(await storedFiles(page)).toEqual([]);
  await expect(retain).toBeChecked();
  await capture.getByRole('button', { name: 'Import into this Case', exact: true }).click();
  await expect(capture.getByRole('heading', { name: 'Manifest evidence', exact: true })).toHaveCount(0);
  const saved = await readBrowserLocalCollection(page, 'cases', { minimumRevision: before.manifest.revision + 1 });
  expect(saved.manifest.revision).toBe(before.manifest.revision + 1);
  const references = saved.records[0]!.value.attachments!;
  expect(references.map(item => item.fileName).sort()).toEqual(['dom-digest.json', 'manifest.json', 'screenshot.png']);
  expect(references.filter(item => item.fileName !== 'manifest.json').every(item => item.observedAt === '2026-09-01T00:00:00.000Z')).toBe(true);
  expect(references.find(item => item.fileName === 'manifest.json')!.observedAt).toBeNull();
  const bodies = (await storedFiles(page)).map(row => Buffer.from(row.bytes).toString('base64')).sort();
  expect(bodies).toEqual([manifestBytes, Buffer.from(screenshot), dom].map(bytes => bytes.toString('base64')).sort());
  const files = await openRetainedFiles(page);
  await files.getByRole('button', { name: 'Preview screenshot.png', exact: true }).click(); await expect(files.getByRole('img')).toBeVisible();
});

test('Case capture attachments are checked separately and metadata import preserves its failure and retention boundaries', async ({ page }, testInfo) => {
  await openCasesView(page); await createCase(page, 'capture.example'); await openCaseSection(page, 'Evidence');
  const capture = page.locator('.capture-workspace');
  await capture.locator(':scope > summary').click();
  const { manifestBytes, screenshot, dom } = captureReviewFixture();
  const before = await readBrowserLocalCollection(page, 'cases');
  const requests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
  await capture.getByLabel('Select capture manifest', { exact: true }).setInputFiles({ name: 'manifest.json', mimeType: 'application/json', buffer: manifestBytes });
  await expect(capture.getByRole('heading', { name: 'Manifest evidence', exact: true })).toBeVisible();
  const attachments = capture.getByLabel('Select capture attachments to check', { exact: true });
  await attachments.setInputFiles([
    { name: 'screenshot.png', mimeType: 'image/png', buffer: Buffer.from('Wrong screenshot bytes') },
    { name: 'dom-digest.json', mimeType: 'application/json', buffer: dom },
  ]);
  const review = capture.getByRole('region', { name: 'Selected capture attachment checks', exact: true });
  await expect(review).toContainText('screenshot.png · Matching bytes not found');
  await expect(review).toContainText('dom-digest.json · Byte count and digest match');
  await expect(review.getByRole('button', { name: 'View file-1', exact: true })).toHaveCount(0);
  await attachments.setInputFiles([
    { name: 'renamed.png', mimeType: 'image/png', buffer: Buffer.from(screenshot) },
    { name: 'renamed.json', mimeType: 'application/json', buffer: dom },
  ]);
  await expect(review).not.toContainText('Matching bytes not found');
  await review.getByRole('button', { name: 'View file-1', exact: true }).click();
  await expect(review.getByRole('img')).toBeVisible();
  await review.getByRole('button', { name: 'View file-2', exact: true }).click();
  await expect(review.locator('pre')).toContainText('whoisleuth.dom-digest');
  await expect(review.getByRole('img')).toHaveCount(0);
  await review.getByRole('button', { name: 'View file-1', exact: true }).click();
  await expect(review.getByRole('img')).toBeVisible();
  await expect(review.locator('pre')).toHaveCount(0);
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      await review.scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page);
      if (width === 320 || width === 1280) await page.screenshot({ path: testInfo.outputPath(`capture-review-${theme}-${width}.png`) });
    }
  }
  await failNextBrowserLocalManifestWrite(page, 'cases');
  await capture.getByRole('button', { name: 'Import into this Case', exact: true }).click();
  await expect(capture.getByRole('button', { name: 'Import into this Case', exact: true })).toBeEnabled();
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  await expect(review.getByRole('img')).toBeVisible();
  await capture.getByRole('button', { name: 'Import into this Case', exact: true }).click();
  await expect(capture.getByRole('heading', { name: 'Manifest evidence', exact: true })).toHaveCount(0);
  const after = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1, minimumRevision: before.manifest.revision + 1 });
  expect(JSON.stringify(after)).toContain('Imported capture metadata');
  expect(JSON.stringify(after)).not.toMatch(/matchingIds|unusedIds|data:image|RGBA PNG|renamed\.(?:png|json)/u);
  expect(requests).toEqual([]);
});

test('cancelling capture attachment processing terminates its worker and clears no saved evidence', async ({ page }) => {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage, terminate = Worker.prototype.terminate;
    const held = new Set<Worker>(); let stopped = 0;
    Worker.prototype.postMessage = function(message: unknown, ...rest: unknown[]) {
      if ((message as { kind?: string } | null)?.kind === 'capture') { held.add(this); return; }
      return Reflect.apply(post, this, [message, ...rest]);
    };
    Worker.prototype.terminate = function() { if (held.delete(this)) stopped++; return terminate.call(this); };
    Object.defineProperty(window, 'captureWorkerState', { get: () => ({ held: held.size, stopped }) });
  });
  await openCasesView(page); await createCase(page, 'capture.example'); await openCaseSection(page, 'Evidence');
  const capture = page.locator('.capture-workspace'); await capture.locator(':scope > summary').click();
  const before = await readBrowserLocalCollection(page, 'cases');
  const { manifestBytes, screenshot } = captureReviewFixture();
  await capture.getByLabel('Select capture manifest', { exact: true }).setInputFiles({ name: 'manifest.json', mimeType: 'application/json', buffer: manifestBytes });
  await capture.getByLabel('Select capture attachments to check', { exact: true }).setInputFiles({ name: 'screenshot.png', mimeType: 'image/png', buffer: Buffer.from(screenshot) });
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'captureWorkerState'))).toEqual({ held: 1, stopped: 0 });
  await capture.getByRole('button', { name: 'Cancel attachment check', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'captureWorkerState'))).toEqual({ held: 0, stopped: 1 });
  await expect(capture.getByLabel('Select capture attachments to check', { exact: true })).toBeFocused();
  await expect(capture.getByRole('region', { name: 'Selected capture attachment checks', exact: true })).toHaveCount(0);
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
});
