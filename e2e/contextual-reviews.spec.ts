import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { openCasesView, createCase, openSeededTimelineCase } from './case-test-fixtures';
import { createCase as createCaseRecord, updateCase } from '../packages/cases/case-record-operations.mts';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
import { openCaseSection } from './console-navigation';
import { expectNoHorizontalOverflow, readBrowserLocalCollection, useTheme } from './helpers';
import { failNextFileWrite } from './case-attachment-fixtures';
import { contextInputs, platformObject, incidentStage, historyCase } from '../test/context-review-fixtures.mts';
import { MAX_CONTEXT_RECORDS } from '../packages/contracts/context-review.mts';

async function openReview(page: Page, name: string) {
  await openCasesView(page); await createCase(page, 'example.test'); await openCaseSection(page, 'Evidence');
  const entry = page.locator('.context-entry'); await entry.locator(':scope > summary').click();
  const tasks: Record<string, string> = {
    'Connector and MCP configuration provenance': 'Review connector configuration',
    'Platform objects and version continuity': 'Track platform objects',
    'Storefront and official-site comparison': 'Compare a storefront',
    'Domain history and retired dependencies': 'Check domain history',
    'Incident sequence and reported actions': 'Trace an incident',
  };
  const task = tasks[name];
  if (!task) throw new Error(`No review task for ${name}`);
  await entry.getByRole('button', { name: task, exact: true }).click();
  return entry.getByRole('region', { name, exact: true });
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
  const copied: string[] = [];
  await page.exposeFunction('recordReviewCopy', (value: string) => copied.push(value));
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (value: string) => (window as unknown as { recordReviewCopy(value: string): Promise<void> }).recordReviewCopy(value) } }));
  await report.getByRole('button', { name: 'Copy defanged indicator for connector.example.test', exact: true }).click();
  await expect.poll(() => copied).toEqual(['connector[.]example[.]test']);
  await report.getByText('Sources and interpretation', { exact: true }).click();
  await report.getByRole('button', { name: /^Copy citation for/ }).click();
  await expect.poll(() => copied.length).toBe(2);
  expect(copied[1]).toContain('Source: Analyst-selected local configuration');
  expect(copied[1]).toContain('Observed: Time not supplied');
  expect(copied[1]).not.toContain('excluded-');
  await report.getByText('Sources and interpretation', { exact: true }).click();
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before); expect(await retainedJson(page)).toEqual([]);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 2560]) { await page.setViewportSize({ width, height: 900 }); await report.scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page); if (width === 320 || width === 1280) if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`connector-${theme}-${width}.png`) }); } }
    expect((await new AxeBuilder({ page }).include('.context-entry').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  }
  await report.getByRole('button', { name: 'Save review in Case', exact: true }).click();
  await expect(report.getByRole('status')).toContainText('Review saved'); await expect(report.getByRole('heading', { name: 'Connector provenance', exact: true })).toBeFocused();
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
  await page.getByRole('button', { name: 'Check domain history', exact: true }).click();
  await page.getByRole('button', { name: 'Track platform objects', exact: true }).click();
  await expect(report).toBeVisible();
  await report.getByRole('button', { name: 'Print review', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Platform object continuity', exact: true });
  await expect(preview.getByRole('heading', { level: 2 })).toBeFocused();
  await expect(preview).toContainText('provider outcome: provider reports resolved');
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('navigation', { name: 'Case sections', exact: true })).toBeHidden();
  await expect(preview.locator('ol > li')).toHaveCount(2);
  await page.emulateMedia({ media: 'screen' });
  await preview.getByRole('button', { name: 'Close print preview', exact: true }).click();
  await expect(report.getByRole('button', { name: 'Print review', exact: true })).toBeFocused();
  await report.getByRole('button', { name: 'Save review in Case', exact: true }).click(); await expect(report.getByRole('status')).toContainText('Review saved');
  const files = await retainedJson(page); expect(files).toHaveLength(2);
  const input = files.map(value => JSON.parse(value)).find(value => value.schema === 'whoisleuth.platform-continuity.input');
  expect(input.evidence).toHaveLength(2); expect(input.evidence[0].observedAt).toBe('2026-09-20T00:00:00.000Z'); expect(input.evidence[0].recheck).toBe('not_reproduced');
  await openCaseSection(page, 'Assessment'); await openCaseSection(page, 'Evidence'); await expect(report).toBeVisible();
});

test('capacity explanations preserve editing and recover after removing a draft record', async ({ page }) => {
  const review = await openReview(page, 'Platform objects and version continuity');
  await review.getByLabel('Load an earlier platform review input').setInputFiles({ name: 'objects.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    schema: 'whoisleuth.platform-continuity.input', version: 1,
    evidence: Array.from({ length: MAX_CONTEXT_RECORDS }, (_, index) => ({ ...platformObject(), objectId: `object-${index}` })),
  })) });
  await expect(review.getByRole('button', { name: 'Add object observation', exact: true })).toBeDisabled();
  await expect(review.getByRole('status').filter({ hasText: 'observation limit is reached' })).toBeVisible();
  await review.getByRole('button', { name: 'Edit observation 1', exact: true }).click();
  await expect(review.getByLabel('Stable object ID')).toBeEnabled();
  await review.getByLabel('Stable object ID').fill('updated-object');
  await review.getByRole('button', { name: 'Update object observation', exact: true }).click();
  await review.getByRole('button', { name: /^Remove observation / }).first().click();
  await expect(review.getByRole('button', { name: 'Add object observation', exact: true })).toBeEnabled();
  await expect(review.getByText(/observation limit is reached/)).toHaveCount(0);

  await page.getByRole('button', { name: 'Trace an incident', exact: true }).click();
  const sequence = page.getByRole('region', { name: 'Incident sequence and reported actions', exact: true });
  await sequence.getByLabel('Load an earlier incident-sequence input').setInputFiles({ name: 'sequence.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    schema: 'whoisleuth.incident-sequence.input', version: 1,
    evidence: Array.from({ length: MAX_CONTEXT_RECORDS }, (_, index) => ({ ...incidentStage(), id: `stage-${index}` })),
  })) });
  await expect(sequence.getByRole('button', { name: 'Add incident stage', exact: true })).toBeDisabled();
  await expect(sequence.getByRole('status').filter({ hasText: 'stage limit is reached' })).toBeVisible();
  await sequence.getByRole('button', { name: /^Remove stage / }).first().click();
  await expect(sequence.getByRole('button', { name: 'Add incident stage', exact: true })).toBeEnabled();
});

test('storefront review requires current authority and preserves a failed-save draft for deliberate retry', async ({ page }, testInfo) => {
  const review = await openReview(page, 'Storefront and official-site comparison');
  await review.getByLabel('Load an earlier storefront review input').setInputFiles({ name: 'storefront.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(contextInputs()[2])) });
  await expect(review.getByLabel('Official hostname')).toHaveValue('official.example.test');
  const authority = review.getByRole('checkbox', { name: 'I own or am authorised to use this official comparator.', exact: true });
  await expect(authority).not.toBeChecked(); await review.getByRole('button', { name: 'Compare storefront evidence' }).click();
  const report = review.getByRole('region', { name: 'Storefront comparison', exact: true }); await expect(report).toHaveCount(0);
  await authority.check(); await review.getByRole('button', { name: 'Compare storefront evidence' }).click();
  await expect(report).toContainText('Exact shared values: 1'); await expect(report).toContainText('Rights-holder reseller register');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1280, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      const comparison = report.getByRole('table', { name: 'Official and candidate storefront evidence' });
      await expect(comparison.getByRole('rowheader')).toHaveCount(6);
      await expectNoHorizontalOverflow(page);
      await report.scrollIntoViewIfNeeded();
      if (width === 320 || width === 1280) if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`storefront-${theme}-${width}.png`) }); }
    }
    expect((await new AxeBuilder({ page }).include('.context-entry').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  }
  const before = await readBrowserLocalCollection(page, 'cases');
  await failNextFileWrite(page); await report.getByRole('button', { name: 'Save review in Case' }).click(); await expect(report.getByRole('status')).toContainText('not confirmed');
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before); expect(await retainedJson(page)).toEqual([]);
  await expect(review.getByLabel('Official hostname')).toHaveValue('official.example.test');
  await report.getByRole('button', { name: 'Save review in Case' }).click(); await expect(report.getByRole('status')).toContainText('Review saved');
  expect(await retainedJson(page)).toHaveLength(2);
  await review.getByLabel('Official hostname').fill('different.example.test'); await expect(report).toHaveCount(0);
});

test('domain-history scopes survive report download, print, retention and related-target navigation', async ({ page }, testInfo) => {
  let selected = historyCase();
  selected.evidenceHistory = selected.evidenceHistory.map(snapshot => ({ ...snapshot, inputHostname: 'login.example.test', observationHostname: 'login.example.test' }));
  selected = updateCase([selected], selected.id, { evidencePin: { field: 'fingerprintSha256', category: 'certificate', label: 'Certificate publication', value: 'a'.repeat(64),
    source: 'Supplied certificate event', sourceSchema: { collection: 'external_observations', schema: 'whoisleuth.certificate-observation-rows', version: 1 },
    observedAt: '2026-09-22T00:00:00.000Z', completeness: 'partial', observationHostname: 'certificate.example.test',
    certificateObservation: { eventId: 'event-17', logId: 'fixture-log', certificateSha256: 'a'.repeat(64), issuer: null, notAfter: null, dnsNameCount: 1, namesComplete: true } } }, '2026-09-22T00:00:00.000Z').record;
  await openSeededTimelineCase(page, selected.domain, [selected], CASE_SCHEMA_VERSION); await openCaseSection(page, 'Evidence');
  const entry = page.locator('.context-entry'); await entry.locator(':scope > summary').click();
  await entry.getByRole('button', { name: 'Check domain history', exact: true }).click();
  const review = entry.getByRole('region', { name: 'Domain history and retired dependencies', exact: true });
  await review.getByRole('button', { name: 'Review retained history', exact: true }).click();
  const report = review.locator('.context-report');
  for (const host of ['example.test', 'login.example.test', 'certificate.example.test']) await expect(report.getByRole('link', { name: `Review ${host} in Lookup`, exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download'); await report.getByRole('button', { name: 'Download review', exact: true }).click();
  const download = await downloadPromise, path = testInfo.outputPath('history-review.json'); await download.saveAs(path);
  const { readFile } = await import('node:fs/promises');
  const exported = JSON.parse(await readFile(path, 'utf8'));
  expect(exported.observations.find((row: { label: string }) => row.label === 'registration · Registrar').hostname).toBe('example.test');
  expect(exported.observations.find((row: { label: string }) => row.label === 'web · Page title').hostname).toBe('login.example.test');
  expect(exported.observations.find((row: { label: string }) => row.label === 'Retained certificate · Certificate publication').hostname).toBe('certificate.example.test');
  await report.getByRole('button', { name: 'Print review', exact: true }).click();
  const print = page.getByRole('dialog', { name: 'Domain history and retired dependencies', exact: true });
  await expect(print.locator('li').filter({ has: print.getByRole('heading', { name: 'registration · Registrar · changed', exact: true }) })).toContainText('Target: example.test');
  await expect(print.locator('li').filter({ has: print.getByRole('heading', { name: 'web · Page title · changed', exact: true }) })).toContainText('Target: login.example.test');
  await print.getByRole('button', { name: 'Close print preview', exact: true }).click();
  await report.getByRole('button', { name: 'Save review in Case', exact: true }).click(); await expect(report.getByRole('status')).toContainText('Review saved');
  expect((await retainedJson(page)).map(value => JSON.parse(value))).toContainEqual(exported);
  await report.getByRole('link', { name: 'Review login.example.test in Lookup', exact: true }).click();
  await expect(page).toHaveURL(/\/lookup\?q=login.example.test&case=/u);
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
  await entry.getByRole('button', { name: 'Trace an incident', exact: true }).click();
  const review = entry.getByRole('region', { name: 'Incident sequence and reported actions', exact: true });
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
  const stageKind = review.getByRole('combobox', { name: 'Stage kind', exact: true });
  const evidenceBasis = review.getByRole('combobox', { name: 'Evidence basis', exact: true });
  const navigation = page.getByRole('navigation', { name: 'Case sections', exact: true });
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
      await stageKind.focus();
      for (const control of [stageKind, evidenceBasis]) {
        if (control === evidenceBasis) await page.keyboard.press('Tab');
        await expect(control).toBeFocused();
        await expect.poll(async () => {
          const box = await control.boundingBox(), nav = await navigation.boundingBox();
          return Boolean(box && nav && box.height >= 24 && box.y >= nav.y + nav.height && box.y + box.height <= 900);
        }).toBe(true);
      }
    }
  }
  // Resizing preserves a scroll position that can partly crop an unfocused
  // control beneath the sticky navigation. Check actual focus above, then scan
  // from a stable page position without disabling the target-size rule.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  expect((await new AxeBuilder({ page }).include('.context-entry').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  await report.scrollIntoViewIfNeeded(); if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath('incident-sequence-dark-1280.png') }); }
  await report.getByRole('button', { name: 'Save review in Case', exact: true }).click(); await expect(report.getByRole('status')).toContainText('Review saved');
  const files = (await retainedJson(page)).map(value => JSON.parse(value));
  const input = files.find(value => value.schema === 'whoisleuth.incident-sequence.input');
  expect(input.evidence).toHaveLength(2); expect(input.evidence[0]).toMatchObject({ basis: 'retained_observation', occurredAt: null, reference: selected.evidencePins[0]!.id, completeness: 'partial' });
  expect(input.evidence[1]).toMatchObject({ basis: 'reported_action', occurredAt: null, source: 'Reporter interview' });
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]?.value.evidencePins[0]).toMatchObject(selected.evidencePins[0]!);
});
