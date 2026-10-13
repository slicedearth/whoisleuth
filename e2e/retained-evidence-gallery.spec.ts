import { expect, test } from './fixtures';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { createCase, openCasesView } from './case-test-fixtures';
import { openRetainedFiles, storedFiles } from './case-attachment-fixtures';
import { sourceImage } from './case-image-fixtures';
import { createCase as caseRecord } from '../packages/cases/case-record-operations.mts';
import { readCaseAttachment } from '../packages/cases/case-attachment-model.mts';
import { currentBrowserLocalDocument, expectNoHorizontalOverflow, migrateLegacyBrowserData, readBrowserLocalCollection, useTheme } from './helpers';
import { productionChunkPath } from './production-build';

async function retainPair(page: Page) {
  const missing = { ...caseRecord({ domain: 'missing-original.example' }, '2026-09-01T00:00:00.000Z'), attachments: [readCaseAttachment({
    id: 'missing-text', fileName: 'missing.txt', mediaType: 'application/octet-stream', source: 'Declared metadata only', observedAt: null,
    retainedAt: '2026-09-01T00:00:00.000Z', byteLength: 20, digestSha256: `sha256:${'f'.repeat(64)}`,
  }), readCaseAttachment({
    id: 'other-missing-text', fileName: 'missing.txt', mediaType: 'application/octet-stream', source: 'Second declared observation',
    observedAt: '2026-09-01T00:20:30.456Z', retainedAt: '2026-09-02T05:06:07.890Z',
    byteLength: 20, digestSha256: `sha256:${'f'.repeat(56)}${'e'.repeat(8)}`,
  }), readCaseAttachment({
    id: 'repeated-missing-text', fileName: 'missing.txt', mediaType: 'application/octet-stream', source: 'Separate observation of the same content',
    observedAt: '2026-09-03T00:20:30.456Z', retainedAt: '2026-09-04T05:06:07.890Z',
    byteLength: 20, digestSha256: `sha256:${'f'.repeat(64)}`,
  })] };
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [missing] }) }, { clearStorage: true, destination: '/cases' });
  await openCasesView(page);
  for (const side of ['reference', 'candidate']) {
    await createCase(page, `${side}.example`);
    const files = await openRetainedFiles(page);
    const inputs = [
      { name: `${side}.txt`, mimeType: 'text/plain', buffer: Buffer.from(side === 'reference' ? 'alpha beta gamma delta epsilon zeta.' : 'New offer: ALPHA BETA GAMMA DELTA EPSILON ZETA.') },
      { name: `${side}.png`, mimeType: 'image/png', buffer: sourceImage() },
      ...(side === 'reference' ? Array.from({ length: 21 }, (_, index) => ({ name: `reference-copy-${index}.txt`, mimeType: 'text/plain', buffer: Buffer.from('alpha beta gamma delta epsilon zeta.') })) : []),
    ];
    await files.getByLabel('Choose original files', { exact: true }).setInputFiles(inputs);
    await expect(files.getByRole('heading', { name: `${inputs.length} selected · not saved`, exact: true })).toBeVisible();
    await files.getByLabel('Source', { exact: true }).fill(`${side} source declaration`);
    if (side === 'reference') await files.getByLabel('Observed at (UTC)', { exact: true }).fill('2026-09-01T12:30');
    await files.getByRole('button', { name: 'Retain selected files', exact: true }).click();
    await expect(files.getByRole('button', { name: `Download original ${side}.txt`, exact: true })).toBeVisible();
  }
  const before = await readBrowserLocalCollection(page, 'cases'), bytes = await storedFiles(page);
  const left = before.records.find(item => item.value.domain === 'reference.example')!.value.id as string;
  const right = before.records.find(item => item.value.domain === 'candidate.example')!.value.id as string;
  await page.goto('/monitor?view=relationships');
  const gallery = page.getByRole('region', { name: 'Retained evidence gallery', exact: true });
  await expect(gallery.getByRole('combobox', { name: 'Evidence component', exact: true })).toBeVisible();
  async function choose(selector: Locator, value: string) {
    for (const number of [1, 2]) {
      if (await selector.locator('option').evaluateAll((options, expected) => options.some(option => (option as HTMLOptionElement).value === expected), value)) {
        await selector.selectOption(value); return;
      }
      const pages = gallery.getByRole('navigation', { name: 'Retained gallery pages', exact: true });
      await pages.getByRole('spinbutton', { name: 'Retained gallery page', exact: true }).fill(String(number));
      await pages.getByRole('button', { name: 'Go', exact: true }).click();
    }
    await selector.selectOption(value);
  }
  async function select(kind: 'text' | 'png', candidate = right, filename = `candidate.${kind === 'text' ? 'txt' : 'png'}`) {
    await gallery.getByRole('combobox', { name: 'Evidence component', exact: true }).selectOption(kind);
    const referenceFile = before.records.find(item => item.value.id === left)!.value.attachments!.find(file => file.fileName === `reference.${kind === 'text' ? 'txt' : 'png'}`)!;
    const candidateFile = before.records.find(item => item.value.id === candidate)!.value.attachments!.find(file => file.fileName === filename)!;
    await choose(gallery.getByRole('combobox', { name: 'Reference file', exact: true }), JSON.stringify([left, referenceFile.id]));
    await choose(gallery.getByRole('combobox', { name: 'Candidate file', exact: true }), JSON.stringify([candidate, candidateFile.id]));
  }
  return { before, bytes, gallery, select, missing };
}

test('cross-Case gallery preserves exact originals, independent sources and temporary comparison scope', async ({ page }, testInfo) => {
  let copied = '', denyCopy = false;
  await page.exposeFunction('copyGalleryFixture', (value: string) => { if (denyCopy) throw new Error('Private clipboard failure'); copied = value; });
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: (value: string) => (window as unknown as { copyGalleryFixture(value: string): Promise<void> }).copyGalleryFixture(value),
  } }));
  const requests: string[] = [];
  page.on('request', request => { if (/\/api\/(?:lookup|bulk|discover|ct-search)/u.test(request.url())) requests.push(request.url()); });
  const { before, bytes, gallery, select, missing } = await retainPair(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.get;
    Reflect.set(window, 'galleryOriginalReads', 0);
    IDBObjectStore.prototype.get = function(key) {
      if (this.name === 'files') Reflect.set(window, 'galleryOriginalReads', Number(Reflect.get(window, 'galleryOriginalReads')) + 1);
      return original.call(this, key);
    };
  });
  await page.screenshot({ path: testInfo.outputPath('gallery-default.png') });
  await select('text', missing.id, 'missing.txt');
  const pages = gallery.getByRole('navigation', { name: 'Retained gallery pages', exact: true });
  await pages.getByRole('spinbutton', { name: 'Retained gallery page', exact: true }).fill('2');
  await pages.getByRole('button', { name: 'Go', exact: true }).click();
  const candidateSelector = gallery.getByRole('combobox', { name: 'Candidate file', exact: true });
  const sameNameLabels = await candidateSelector.locator('option').evaluateAll((options, prefix) => options
    .filter(option => (option as HTMLOptionElement).value.startsWith(prefix))
    .map(option => option.textContent), JSON.stringify([missing.id]).slice(0, -1));
  expect(sameNameLabels).toHaveLength(3);
  expect(new Set(sameNameLabels).size).toBe(3);
  const selectedDetails = gallery.locator('details').filter({ has: page.getByText('Candidate file details', { exact: true }) });
  await selectedDetails.locator('summary').click();
  const copyHash = selectedDetails.getByRole('button', { name: 'Copy Candidate selected file SHA-256', exact: true });
  await expect(selectedDetails.getByText('Unknown', { exact: true })).toBeVisible();
  await copyHash.focus(); await copyHash.press('Enter');
  await expect.poll(() => copied).toBe(missing.attachments[0]!.digestSha256);
  await expect(copyHash).toBeFocused();
  const other = missing.attachments[1]!;
  await candidateSelector.selectOption(JSON.stringify([missing.id, other.id]));
  await expect(pages.getByRole('spinbutton', { name: 'Retained gallery page', exact: true })).toHaveValue('2');
  await expect(copyHash).toHaveText('Copy hash');
  await expect(selectedDetails.locator('code').filter({ hasText: other.digestSha256 })).toHaveText(other.digestSha256);
  await copyHash.click(); await expect.poll(() => copied).toBe(other.digestSha256);
  await selectedDetails.getByRole('button', { name: 'Copy Candidate selected file attachment ID', exact: true }).click();
  await expect.poll(() => copied).toBe(other.id);
  const observedTime = selectedDetails.getByRole('button', { name: /Copy exact Candidate selected file observation time:/u });
  await expect(observedTime).toContainText('UTC');
  await expect(observedTime.locator('time')).toHaveAttribute('datetime', '2026-09-01T00:20:30.456Z');
  await observedTime.click(); await expect.poll(() => copied).toBe(other.observedAt);
  await selectedDetails.getByRole('button', { name: /Copy exact Candidate selected file retention time:/u }).click();
  await expect.poll(() => copied).toBe(other.retainedAt);
  const repeated = missing.attachments[2]!;
  const rowCandidate = gallery.getByRole('button', { name: /Use as candidate:.*repeated-missing-text$/u });
  await rowCandidate.focus(); await rowCandidate.press('Enter');
  await expect(rowCandidate).toBeFocused(); await expect(rowCandidate).toHaveAttribute('aria-pressed', 'true');
  await expect(candidateSelector).toHaveValue(JSON.stringify([missing.id, repeated.id]));
  await expect(pages.getByRole('spinbutton', { name: 'Retained gallery page', exact: true })).toHaveValue('2');
  const rowReference = gallery.getByRole('button', { name: /Use as reference:.* · missing-text$/u });
  await rowReference.focus(); await rowReference.press('Enter');
  await expect(rowReference).toBeFocused(); await expect(rowReference).toHaveAttribute('aria-pressed', 'true');
  await expect(gallery.getByRole('combobox', { name: 'Reference file', exact: true })).toHaveValue(JSON.stringify([missing.id, missing.attachments[0]!.id]));
  await expect(gallery.getByRole('button', { name: 'Compare selected text', exact: true })).toBeEnabled();
  expect(repeated.digestSha256).toBe(missing.attachments[0]!.digestSha256);
  expect(await page.evaluate(() => Reflect.get(window, 'galleryOriginalReads'))).toBe(0);
  await rowReference.press('Enter');
  await expect(rowReference).toBeFocused(); await expect(rowReference).toHaveAttribute('aria-pressed', 'false');
  await expect(gallery.getByRole('combobox', { name: 'Reference file', exact: true })).toHaveValue('');
  await expect(gallery.getByRole('button', { name: 'Compare selected text', exact: true })).toBeDisabled();
  await rowReference.press('Enter');
  await expect(rowReference).toHaveAttribute('aria-pressed', 'true');
  await selectedDetails.getByRole('button', { name: 'Copy Candidate selected file attachment ID', exact: true }).click();
  await expect.poll(() => copied).toBe(repeated.id);
  await observedTime.click(); await expect.poll(() => copied).toBe(repeated.observedAt);
  await copyHash.click(); await expect.poll(() => copied).toBe(missing.attachments[0]!.digestSha256);
  denyCopy = true; await copyHash.click();
  await expect(selectedDetails.locator('.copy-fallback')).toHaveText(repeated.digestSha256);
  await expect(selectedDetails).not.toContainText('Private clipboard failure');
  denyCopy = false;
  await expect(gallery.getByRole('region', { name: 'Selected retained file comparison', exact: true })).toHaveCount(0);
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  expect(await storedFiles(page)).toEqual(bytes);
  await select('text');
  await selectedDetails.locator('summary').click();
  const originalSelection = [await gallery.getByRole('combobox', { name: 'Reference file', exact: true }).inputValue(), await gallery.getByRole('combobox', { name: 'Candidate file', exact: true }).inputValue()];
  await pages.getByRole('spinbutton', { name: 'Retained gallery page', exact: true }).fill('2');
  await pages.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(pages.getByRole('spinbutton', { name: 'Retained gallery page', exact: true })).toHaveValue('2');
  await expect(gallery.getByRole('combobox', { name: 'Reference file', exact: true })).toHaveValue(originalSelection[0]!);
  await expect(gallery.getByRole('combobox', { name: 'Candidate file', exact: true })).toHaveValue(originalSelection[1]!);
  expect(await gallery.getByRole('combobox', { name: 'Reference file', exact: true }).locator('option').count()).toBeLessThanOrEqual(23);
  const compare = gallery.getByRole('button', { name: 'Compare selected text', exact: true });
  await compare.focus(); await compare.press('Enter');
  const review = gallery.getByRole('region', { name: 'Selected retained file comparison', exact: true });
  await expect(review.getByRole('heading', { name: 'Two selected retained sources', exact: true })).toBeFocused();
  await expect(review.getByRole('heading', { name: '1 shared passage', exact: true })).toBeVisible();
  await expect(review.getByRole('region', { name: 'Reference gallery source', exact: true })).toContainText('reference source declaration');
  await expect(review.getByRole('region', { name: 'Candidate gallery source', exact: true }).getByText('Unknown', { exact: true })).toBeVisible();
  await rowCandidate.focus(); await rowCandidate.press('Enter');
  await expect(rowCandidate).toBeFocused();
  await expect(pages.getByRole('spinbutton', { name: 'Retained gallery page', exact: true })).toHaveValue('2');
  await expect(review).toHaveCount(0);
  await select('text');
  await pages.getByRole('spinbutton', { name: 'Retained gallery page', exact: true }).fill('2');
  await pages.getByRole('button', { name: 'Go', exact: true }).click();
  await compare.click();
  await expect(review.getByRole('heading', { name: '1 shared passage', exact: true })).toBeVisible();
  for (const theme of ['light', 'dark'] as const) for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: width === 320 ? 700 : 720 }); await useTheme(page, theme);
    await rowReference.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`gallery-rows-${theme}-${width}.png`) });
    await review.getByRole('heading', { name: 'Two selected retained sources', exact: true }).scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page);
    expect((await new AxeBuilder({ page }).include('.retained-gallery').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`gallery-${theme}-${width}.png`) });
  }
  await gallery.getByRole('searchbox', { name: 'Search retained metadata', exact: true }).fill('not in metadata');
  await expect(review).toHaveCount(0);
  await expect(compare).toBeDisabled();
  await gallery.getByRole('searchbox', { name: 'Search retained metadata', exact: true }).fill('');
  await select('text', missing.id, 'missing.txt'); await compare.click();
  await expect(gallery.getByRole('alert')).toContainText('original bytes are missing');
  await expect(review).toHaveCount(0);
  await select('png'); await gallery.getByRole('button', { name: 'Open selected PNGs', exact: true }).click();
  await expect(review.locator('canvas')).toHaveCount(2);
  await review.getByText('Compare image regions', { exact: true }).click();
  await review.getByRole('button', { name: 'Calculate image changes', exact: true }).click();
  await expect(review.getByRole('heading', { name: 'Image comparison: same pixels', exact: true })).toBeVisible();
  await review.getByRole('heading', { name: 'Image comparison: same pixels', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('gallery-png.png') });
  await page.emulateMedia({ media: 'print' }); await expect(gallery).not.toBeVisible(); await page.emulateMedia({ media: null });
  await gallery.getByRole('button', { name: 'Close selected comparison', exact: true }).click();
  await expect(review).toHaveCount(0);
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before); expect(await storedFiles(page)).toEqual(bytes); expect(requests).toEqual([]);
  await page.reload(); await expect(gallery.getByRole('combobox', { name: 'Evidence component', exact: true })).toHaveValue('profiles');
});

for (const change of ['component', 'pair'] as const) test(`changing gallery ${change} cancels a held text worker without publishing a late result`, async ({ page }) => {
  const { before, bytes, gallery, select } = await retainPair(page);
  const path = productionChunkPath('src/lib/workers/investigation-package.worker.ts');
  let release = () => {}, arrived = () => {};
  const held = new Promise<void>(resolve => { release = resolve; }), received = new Promise<void>(resolve => { arrived = resolve; });
  await page.route(`**${path}`, async route => { arrived(); await held; try { await route.fallback(); } catch (cause) { if (!route.request().failure()) throw cause; } });
  try {
    await select('text');
    const pages = gallery.getByRole('navigation', { name: 'Retained gallery pages', exact: true });
    await pages.getByRole('spinbutton', { name: 'Retained gallery page', exact: true }).fill('2');
    await pages.getByRole('button', { name: 'Go', exact: true }).click();
    await gallery.getByRole('button', { name: 'Compare selected text', exact: true }).click(); await received;
    if (change === 'component') await gallery.getByRole('combobox', { name: 'Evidence component', exact: true }).selectOption('png');
    else {
      const action = gallery.getByRole('button', { name: /Use as candidate:.*repeated-missing-text$/u });
      await action.focus(); await action.press('Enter'); await expect(action).toBeFocused();
      await expect(pages.getByRole('spinbutton', { name: 'Retained gallery page', exact: true })).toHaveValue('2');
      await expect(gallery.getByRole('button', { name: 'Compare selected text', exact: true })).toBeEnabled();
    }
    release();
    if (change === 'component') await expect(gallery.getByRole('button', { name: 'Open selected PNGs', exact: true })).toBeDisabled();
    await expect(gallery.getByRole('region', { name: 'Selected retained file comparison', exact: true })).toHaveCount(0);
    await expect(gallery.getByRole('heading', { name: '1 shared passage', exact: true })).toHaveCount(0);
    expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before); expect(await storedFiles(page)).toEqual(bytes);
  } finally { release(); }
});
