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
  const requests: string[] = [];
  page.on('request', request => { if (/\/api\/(?:lookup|bulk|discover|ct-search)/u.test(request.url())) requests.push(request.url()); });
  const { before, bytes, gallery, select, missing } = await retainPair(page);
  await page.screenshot({ path: testInfo.outputPath('gallery-default.png') });
  await select('text');
  const originalSelection = [await gallery.getByRole('combobox', { name: 'Reference file', exact: true }).inputValue(), await gallery.getByRole('combobox', { name: 'Candidate file', exact: true }).inputValue()];
  const pages = gallery.getByRole('navigation', { name: 'Retained gallery pages', exact: true });
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
  await expect(review.getByRole('region', { name: 'Candidate gallery source', exact: true })).toContainText('Observed: Unknown');
  for (const theme of ['light', 'dark'] as const) for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: width === 320 ? 700 : 720 }); await useTheme(page, theme);
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

test('changing gallery component cancels a held text worker without publishing a late result', async ({ page }) => {
  const { before, bytes, gallery, select } = await retainPair(page);
  const path = productionChunkPath('src/lib/workers/investigation-package.worker.ts');
  let release = () => {}, arrived = () => {};
  const held = new Promise<void>(resolve => { release = resolve; }), received = new Promise<void>(resolve => { arrived = resolve; });
  await page.route(`**${path}`, async route => { arrived(); await held; try { await route.fallback(); } catch (cause) { if (!route.request().failure()) throw cause; } });
  try {
    await select('text'); await gallery.getByRole('button', { name: 'Compare selected text', exact: true }).click(); await received;
    await gallery.getByRole('combobox', { name: 'Evidence component', exact: true }).selectOption('png');
    release();
    await expect(gallery.getByRole('button', { name: 'Open selected PNGs', exact: true })).toBeDisabled();
    await expect(gallery.getByRole('region', { name: 'Selected retained file comparison', exact: true })).toHaveCount(0);
    await expect(gallery.getByRole('heading', { name: '1 shared passage', exact: true })).toHaveCount(0);
    expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before); expect(await storedFiles(page)).toEqual(bytes);
  } finally { release(); }
});
