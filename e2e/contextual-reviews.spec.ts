import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { openCasesView, createCase, openSeededTimelineCase } from './case-test-fixtures';
import { createCase as createCaseRecord, updateCase } from '../packages/cases/case-record-operations.mts';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
import { openCaseSection } from './console-navigation';
import { expectNoHorizontalOverflow, readBrowserLocalCollection, useTheme } from './helpers';
import { failNextFileWrite } from './case-attachment-fixtures';
import { contextInputs } from '../test/context-review-fixtures.mts';

async function openReview(page: Page, name: string) {
  await openCasesView(page); await createCase(page, 'example.test'); await openCaseSection(page, 'Evidence');
  const entry = page.locator('.context-entry'); await entry.locator(':scope > summary').click();
  const summary = entry.getByText(name, { exact: true }); await summary.click();
  return summary.locator('..');
}
async function retainedJson(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('whoisleuth-browser-data-v1');
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const transaction = database.transaction('files', 'readonly'), files = transaction.objectStore('files').getAll();
      await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); });
      if (files.result.length > 8) throw new Error('Too many synthetic retained files.');
      return files.result.map((row: { payload: ArrayBuffer }) => { if (!(row.payload instanceof ArrayBuffer) || row.payload.byteLength > 64 * 1024) throw new Error('Unexpected synthetic attachment.'); return new TextDecoder().decode(row.payload); });
    } finally { database.close(); }
  });
}

test('connector review excludes secret values, saves only the report and pivots without collecting', async ({ page }, testInfo) => {
  const review = await openReview(page, 'Connector and MCP configuration provenance');
  const input = contextInputs()[3]!.evidence as { current: unknown };
  await review.getByLabel('Current configuration', { exact: true }).fill(JSON.stringify(input.current));
  const before = await readBrowserLocalCollection(page, 'cases');
  const requests: string[] = []; page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
  await review.getByRole('button', { name: 'Review connector provenance', exact: true }).click();
  const report = review.getByRole('region', { name: 'Connector provenance', exact: true });
  await expect(report).toContainText('@example/connector@1.0.0'); await expect(report).not.toContainText('excluded-auth-value');
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before); expect(await retainedJson(page)).toEqual([]);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 2560]) { await page.setViewportSize({ width, height: 900 }); await report.scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page); if (width === 320 || width === 1280) await page.screenshot({ path: testInfo.outputPath(`connector-${theme}-${width}.png`) }); }
    expect((await new AxeBuilder({ page }).include('.context-entry').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  }
  await report.getByRole('button', { name: 'Save review in Case', exact: true }).click();
  await expect(report.getByRole('status')).toContainText('Review saved'); await expect(report.getByRole('heading')).toBeFocused();
  const files = await retainedJson(page); expect(files).toHaveLength(1); expect(files[0]).not.toMatch(/excluded-|private\/selected|--secret|Authorization/u);
  await report.getByRole('link', { name: 'Review connector.example.test in Lookup', exact: true }).click();
  await expect(page).toHaveURL(/\/lookup\?q=connector.example.test&case=/u); expect(requests).toEqual([]);
});

test('platform continuity reloads editable observations and keeps provider claims separate from rechecks', async ({ page }) => {
  const review = await openReview(page, 'Platform objects and version continuity');
  await review.getByLabel('Load an earlier platform review input').setInputFiles({ name: 'objects.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(contextInputs()[1])) });
  await review.getByRole('button', { name: 'Edit observation 1', exact: true }).click();
  await expect(review.getByLabel('Stable object ID')).toHaveValue('extension-17');
  await review.getByRole('combobox', { name: 'Independent recheck', exact: true }).selectOption('not_reproduced');
  await review.getByRole('button', { name: 'Update object observation', exact: true }).click();
  await review.getByRole('button', { name: 'Review platform continuity', exact: true }).click();
  const report = review.getByRole('region', { name: 'Platform object continuity', exact: true });
  await expect(report).toContainText('Recorded observations: 2; distinct platform objects: 1');
  await expect(report).toContainText('provider reports resolved'); await expect(report).toContainText('not reproduced'); await expect(report).toContainText('still observed');
  await report.getByRole('button', { name: 'Save review in Case', exact: true }).click(); await expect(report.getByRole('status')).toContainText('Review saved');
  const files = await retainedJson(page); expect(files).toHaveLength(2);
  const input = files.map(value => JSON.parse(value)).find(value => value.schema === 'whoisleuth.platform-continuity.input');
  expect(input.evidence).toHaveLength(2); expect(input.evidence[0].observedAt).toBe('2026-09-20T00:00:00.000Z'); expect(input.evidence[0].recheck).toBe('not_reproduced');
  await openCaseSection(page, 'Assessment'); await openCaseSection(page, 'Evidence'); await expect(report).toBeVisible();
});

test('storefront review requires current authority and preserves a failed-save draft for deliberate retry', async ({ page }) => {
  const review = await openReview(page, 'Storefront and official-site comparison');
  await review.getByLabel('Load an earlier storefront review input').setInputFiles({ name: 'storefront.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(contextInputs()[2])) });
  await expect(review.getByLabel('Official hostname')).toHaveValue('official.example.test');
  const authority = review.getByRole('checkbox', { name: 'I own or am authorised to use this official comparator.', exact: true });
  await expect(authority).not.toBeChecked(); await review.getByRole('button', { name: 'Compare storefront evidence' }).click();
  const report = review.getByRole('region', { name: 'Storefront comparison', exact: true }); await expect(report).toHaveCount(0);
  await authority.check(); await review.getByRole('button', { name: 'Compare storefront evidence' }).click();
  await expect(report).toContainText('Exact shared values: 1'); await expect(report).toContainText('Rights-holder reseller register');
  const before = await readBrowserLocalCollection(page, 'cases');
  await failNextFileWrite(page); await report.getByRole('button', { name: 'Save review in Case' }).click(); await expect(report.getByRole('status')).toContainText('not confirmed');
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before); expect(await retainedJson(page)).toEqual([]);
  await expect(review.getByLabel('Official hostname')).toHaveValue('official.example.test');
  await report.getByRole('button', { name: 'Save review in Case' }).click(); await expect(report.getByRole('status')).toContainText('Review saved');
  expect(await retainedJson(page)).toHaveLength(2);
  await review.getByLabel('Official hostname').fill('different.example.test'); await expect(report).toHaveCount(0);
});

test('domain-history declarations remain qualified and an empty Case does not claim unchanged evidence', async ({ page }) => {
  const review = await openReview(page, 'Domain history and retired dependencies');
  await review.getByRole('button', { name: 'Review retained history', exact: true }).click();
  const report = review.getByRole('region', { name: 'Domain history and retired dependencies', exact: true });
  await expect(report).toContainText('Retained snapshots: 0'); await expect(report).toContainText('Some comparison evidence is unavailable');
  await review.getByText('Declare an expected change or retired dependency', { exact: true }).click();
  await review.getByRole('checkbox', { name: 'I own or am authorised to review the affected assets.', exact: true }).check();
  await review.getByLabel('Owned asset hostname').fill('www.example.test'); await review.getByLabel('Dependency hostname').fill('retired.example.test');
  await review.getByLabel('Retirement time (local)').fill('2026-09-20T10:00'); await review.getByLabel('Source or change reference', { exact: true }).fill('Owned asset register');
  await review.getByRole('button', { name: 'Add retired dependency' }).click(); await review.getByRole('button', { name: 'Review retained history', exact: true }).click();
  await expect(report).toContainText('Declared retired web dependency · reported'); await expect(report).toContainText('www.example.test depended on retired.example.test');
  await report.getByRole('button', { name: 'Save review in Case' }).click(); await expect(report.getByRole('status')).toContainText('Review saved');
  expect(await retainedJson(page)).toHaveLength(1);
  for (const theme of ['light', 'dark'] as const) { await useTheme(page, theme); for (const width of [320, 390, 1024, 1280]) { await page.setViewportSize({ width, height: 900 }); await expectNoHorizontalOverflow(page); } }
});

test('incident sequence keeps source provenance, unknown times and chosen order through a Case save', async ({ page }, testInfo) => {
  const now = '2026-09-22T00:00:00.000Z';
  const initial = createCaseRecord({ domain: 'example.test' }, now);
  const selected = updateCase([initial], initial.id, { evidencePin: { label: 'Recorded page prompt', value: 'A credential form was visible.', source: 'Selected capture', observedAt: null, completeness: 'partial', limitations: ['Only the visible form was captured.'] } }, now).record;
  await openSeededTimelineCase(page, selected.domain, [selected], CASE_SCHEMA_VERSION); await openCaseSection(page, 'Evidence');
  const entry = page.locator('.context-entry'); await entry.locator(':scope > summary').click();
  const summary = entry.getByText('Incident sequence and reported actions', { exact: true }); await summary.click(); const review = summary.locator('..');
  await review.getByLabel('Load an earlier incident-sequence input').setInputFiles({ name: 'sequence.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(contextInputs()[4])) });
  await review.getByRole('combobox', { name: 'Evidence basis', exact: true }).selectOption('retained_observation');
  await review.getByRole('combobox', { name: 'Stage kind', exact: true }).selectOption('identity_prompt');
  await review.getByRole('combobox', { name: 'Retained Case observation', exact: true }).selectOption(selected.evidencePins[0]!.id);
  await review.getByRole('button', { name: 'Add incident stage', exact: true }).click();
  await expect(review.getByRole('list', { name: 'Incident stage draft' }).locator(':scope > li')).toHaveCount(2);
  await review.getByRole('button', { name: 'Move stage 2 earlier', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(review.getByRole('heading', { name: 'Selected stage order' })).toBeFocused();
  await expect(review.getByRole('list', { name: 'Incident stage draft' }).locator(':scope > li').first()).toContainText('retained observation');
  await review.getByRole('button', { name: 'Review incident sequence', exact: true }).click();
  const report = review.getByRole('region', { name: 'Incident sequence', exact: true });
  await expect(report).toContainText('retained observations: 1; imported records: 0; reported actions: 1');
  await expect(report).toContainText('Time not supplied'); await expect(report).toContainText('Only the visible form was captured.');
  for (const theme of ['light', 'dark'] as const) { await useTheme(page, theme); for (const width of [320, 390, 1024, 1280]) { await page.setViewportSize({ width, height: 900 }); await expectNoHorizontalOverflow(page); } }
  expect((await new AxeBuilder({ page }).include('.context-entry').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  await report.scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath('incident-sequence-dark-1280.png') });
  await report.getByRole('button', { name: 'Save review in Case', exact: true }).click(); await expect(report.getByRole('status')).toContainText('Review saved');
  const files = (await retainedJson(page)).map(value => JSON.parse(value));
  const input = files.find(value => value.schema === 'whoisleuth.incident-sequence.input');
  expect(input.evidence).toHaveLength(2); expect(input.evidence[0]).toMatchObject({ basis: 'retained_observation', occurredAt: null, reference: selected.evidencePins[0]!.id, completeness: 'partial' });
  expect(input.evidence[1]).toMatchObject({ basis: 'reported_action', occurredAt: null, source: 'Reporter interview' });
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]?.value.evidencePins[0]).toMatchObject(selected.evidencePins[0]!);
});
