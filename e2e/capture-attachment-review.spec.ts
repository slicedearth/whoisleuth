import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import { expect, test } from './fixtures';
import { createCase, openCasesView } from './case-test-fixtures';
import { openCaseSection } from './console-navigation';
import { readBrowserLocalCollection, failNextBrowserLocalManifestWrite, expectNoHorizontalOverflow, useTheme } from './helpers';
import { captureReviewFixture } from '../test/capture-review-fixture.mts';
import { storedFiles, openRetainedFiles, failNextFileWrite } from './case-attachment-fixtures';
import { createHash } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { sourceImage } from './case-image-fixtures';
import { readWebCaptureManifest } from '../packages/interchange/web-capture-import.mts';
import { externalFindingsCaseTargets } from '../packages/interchange/external-findings-import.mts';
import type { Page, Locator } from '@playwright/test';
import { openManager, indicator, switchWorkspace } from './browser-workspace-fixtures';

async function expand(disclosure: Locator) {
  if (await disclosure.getAttribute('open') === null) await disclosure.locator(':scope > summary').click();
}

async function openSessionDeclarations(page: Page, bytes: Buffer) {
  await openCaseSection(page, 'Evidence');
  const workspace = page.locator('.capture-workspace'); await expand(workspace);
  const firstInput = workspace.getByLabel('Select capture manifest', { exact: true });
  await firstInput.setInputFiles({ name: 'capture.json', mimeType: 'application/json', buffer: bytes });
  const comparison = workspace.locator('.capture-comparison'); await expand(comparison);
  const secondInput = comparison.getByLabel('Comparison capture manifest', { exact: true });
  await secondInput.setInputFiles({ name: 'capture.json', mimeType: 'application/json', buffer: bytes });
  const matrix = comparison.locator('.capture-condition-matrix'); await expand(matrix);
  for (const checkbox of await matrix.getByRole('checkbox').all()) await checkbox.check();
  const annotations = matrix.locator('.session-annotations'); await expand(annotations);
  const declaration = (label: string) => annotations.getByRole('combobox', { name: `Session declaration — ${label}`, exact: true });
  return { workspace, comparison, matrix, annotations, firstInput, secondInput, declaration };
}

test('temporary capture-session declarations preserve input identity, comparison evidence and private lifecycle', async ({ page }, testInfo) => {
  const fixture = captureReviewFixture();
  // All labels, times, domains and image digests match. Only input identity and ordinal distinguish these captures.
  const bytes = Buffer.from(JSON.stringify({ ...fixture.manifest, captures: [fixture.manifest.captures[0], fixture.manifest.captures[0]] }));
  const original = readWebCaptureManifest(JSON.parse(bytes.toString()));
  await openCasesView(page); await createCase(page, 'capture.example');
  const { workspace, comparison, matrix, annotations, firstInput, secondInput, declaration } = await openSessionDeclarations(page, bytes);
  const before = await readBrowserLocalCollection(page, 'cases');
  const requests: string[] = []; page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
  const grid = matrix.getByRole('region', { name: 'Selected capture condition comparison', exact: true });
  const sourceConditions = await grid.innerText();
  const first = declaration('First manifest · capture 1'), sibling = declaration('First manifest · capture 2');
  const second = declaration('Second manifest · capture 1');
  await expect(annotations.getByRole('combobox')).toHaveCount(4);
  await expect(annotations.getByRole('status')).toContainText('4 without a declaration; 0 explicitly unknown');
  // Deny persistence and application clipboard writes while exercising the new controls.
  await page.evaluate(() => {
    const calls: string[] = [], set = Storage.prototype.setItem, transaction = IDBDatabase.prototype.transaction, copy = navigator.clipboard.writeText;
    Storage.prototype.setItem = function() { calls.push('storage'); throw new Error('Temporary declarations must not be stored.'); };
    IDBDatabase.prototype.transaction = function() { calls.push('indexedDB'); throw new Error('Temporary declarations must not access saved work.'); };
    navigator.clipboard.writeText = async () => { calls.push('clipboard'); throw new Error('Temporary declarations must not be copied.'); };
    Reflect.set(window, 'restoreDeclarationGuard', () => { Storage.prototype.setItem = set; IDBDatabase.prototype.transaction = transaction; navigator.clipboard.writeText = copy; return calls; });
  });
  // Native type-ahead works without relying on a platform popup's arrow handling.
  await first.focus(); await first.press('s'); await first.press('Tab'); await expect(first).toHaveValue('signed_out');
  await sibling.selectOption('signed_in'); await second.selectOption('unknown');
  await expect(first).toHaveValue('signed_out'); await expect(sibling).toHaveValue('signed_in');
  await expect(annotations.getByRole('status')).toContainText('1 without a declaration; 1 explicitly unknown');
  const annotatedAt = await first.locator('..').locator('..').locator('time').getAttribute('datetime');
  expect(annotatedAt).not.toBe(fixture.manifest.captures[0]!.capturedAt);
  expect(Number.isFinite(Date.parse(annotatedAt!))).toBe(true);
  expect(await page.evaluate(() => Reflect.get(window, 'restoreDeclarationGuard')())).toEqual([]);
  await second.selectOption('signed_out'); await declaration('Second manifest · capture 2').selectOption('signed_out');
  await expect(annotations.getByRole('status')).toContainText('Different analyst declarations');
  await sibling.selectOption('signed_out'); await expect(annotations.getByRole('status')).toContainText('Matching analyst declarations');
  expect(await grid.innerText()).toBe(sourceConditions);
  await expect(comparison.getByRole('combobox', { name: 'First page observation', exact: true })).toHaveValue('');
  for (const theme of ['light', 'dark'] as const) for (const width of [320, 1280]) {
    await useTheme(page, theme); await page.setViewportSize({ width, height: width === 320 ? 700 : 720 });
    await annotations.scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page);
    await first.focus(); await expect(first).toBeFocused();
    expect((await new AxeBuilder({ page }).include('.session-annotations').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    if (captureVisualEvidenceEnabled()) await page.screenshot({ path: testInfo.outputPath(`session-declarations-${theme}-${width}.png`) });
  }
  await page.emulateMedia({ media: 'print' }); await expect(annotations).toBeHidden(); await page.emulateMedia({ media: 'screen' });
  await expect(first).toHaveValue('signed_out');
  const choices = matrix.getByRole('list', { name: 'Capture observations', exact: true }).getByRole('checkbox');
  await choices.nth(0).uncheck(); await choices.nth(0).check(); await expect(first).toHaveValue(''); await expect(second).toHaveValue('signed_out');
  for (const disclosure of [annotations, matrix, comparison, workspace]) {
    await first.selectOption('signed_in');
    await disclosure.locator(':scope > summary').click(); await expand(disclosure); await expand(annotations);
    await expect(first).toHaveValue(''); await expect(second).toHaveValue('');
  }
  await first.selectOption('signed_in'); await openCaseSection(page, 'Assessment'); await openCaseSection(page, 'Evidence');
  await expect(first).toHaveValue('');
  await first.selectOption('signed_in');
  // Hold a genuine worker completion, replace its owner, then deliver the stale reply deliberately.
  await page.evaluate(() => {
    const post = Worker.prototype.postMessage; let hold = true;
    Worker.prototype.postMessage = function(message: unknown, ...rest: unknown[]) {
      if (hold && (message as { kind?: string } | null)?.kind === 'capture') {
        hold = false; const receiver = this.onmessage;
        this.onmessage = event => { Reflect.set(window, 'releaseCaptureReply', () => receiver?.call(this, event)); };
      }
      return Reflect.apply(post, this, [message, ...rest]);
    };
  });
  await secondInput.setInputFiles({ name: 'capture.json', mimeType: 'application/json', buffer: bytes });
  await expect.poll(() => page.evaluate(() => typeof Reflect.get(window, 'releaseCaptureReply'))).toBe('function');
  await expect(matrix).toHaveCount(0);
  await firstInput.setInputFiles({ name: 'capture.json', mimeType: 'application/json', buffer: bytes });
  await expect(matrix).toHaveCount(0); await expand(comparison);
  await secondInput.setInputFiles({ name: 'capture.json', mimeType: 'application/json', buffer: bytes });
  await expand(matrix); await expect(matrix.locator('.selection-status')).toContainText('0 of 4');
  for (const checkbox of await matrix.getByRole('checkbox').all()) await checkbox.check();
  await expand(annotations); await first.selectOption('unknown');
  await page.evaluate(() => Reflect.get(window, 'releaseCaptureReply')());
  await expect(first).toHaveValue('unknown'); await expect(second).toHaveValue('');
  await matrix.getByRole('button', { name: 'Clear condition selection', exact: true }).click();
  await expect(annotations).toHaveCount(0);
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before); expect(await storedFiles(page)).toEqual([]); expect(requests).toEqual([]);
  expect(readWebCaptureManifest(JSON.parse(bytes.toString()))).toEqual(original);
});

test('temporary capture-session declarations are discarded by Case, workspace and lock navigation', async ({ page }) => {
  await page.goto('/dashboard');
  const panel = await openManager(page), passphrase = 'Synthetic session review passphrase';
  await panel.getByLabel('New workspace name', { exact: true }).fill('Session review');
  await panel.getByRole('checkbox', { name: 'Encrypt saved workspace records', exact: true }).check();
  await panel.getByLabel('New workspace passphrase', { exact: true }).fill(passphrase);
  await panel.getByLabel('Repeat workspace passphrase', { exact: true }).fill(passphrase);
  await panel.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Workspace created.');
  await panel.getByRole('button', { name: 'Open workspace Session review', exact: true }).click();
  await Promise.all([page.waitForEvent('load'), panel.getByRole('button', { name: 'Switch workspace', exact: true }).click()]);
  const unlock = async () => {
    await page.getByLabel('Workspace passphrase', { exact: true }).fill(passphrase);
    await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click(); await expect(indicator(page)).toHaveText('Session review');
  };
  await unlock();
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Cases', exact: true }).click();
  await createCase(page, 'capture.example');
  const bytes = captureReviewFixture().manifestBytes;
  let review = await openSessionDeclarations(page, bytes);
  const caseUrl = page.url();
  await review.declaration('First manifest · capture 1').selectOption('signed_in');
  await createCase(page, 'other.example'); await page.goto(caseUrl); await unlock();
  await expect(page.locator('.capture-comparison')).toHaveCount(0);
  review = await openSessionDeclarations(page, bytes);
  await expect(review.declaration('First manifest · capture 1')).toHaveValue('');
  await review.declaration('First manifest · capture 1').selectOption('signed_in');
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Lock workspace', exact: true }).click()]);
  await unlock(); await expect(page.locator('.capture-comparison')).toHaveCount(0);
  review = await openSessionDeclarations(page, bytes); await expect(review.declaration('First manifest · capture 1')).toHaveValue('');
  await review.declaration('First manifest · capture 1').selectOption('unknown');
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page.locator('.session-annotations')).toHaveCount(0);
  await switchWorkspace(page, 'Default');
  const manager = await openManager(page);
  await manager.getByRole('button', { name: 'Open workspace Session review', exact: true }).click();
  await Promise.all([page.waitForEvent('load'), manager.getByRole('button', { name: 'Switch workspace', exact: true }).click()]);
  await unlock();
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Cases', exact: true }).click();
  await expect(page.locator('.session-annotations')).toHaveCount(0);
});

test('multi-capture conditions remain selectable, bounded and separate from eligible page pairs', async ({ page }, testInfo) => {
  const { manifest, manifestBytes } = captureReviewFixture();
  const conditions = { browser: 'chromium', browserVersion: '151', viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, locale: 'en-AU', timezone: 'UTC', colourScheme: 'light' };
  const first = { ...manifest, captures: Array.from({ length: 11 }, (_, index) => ({ ...manifest.captures[0]!,
    domain: index < 2 ? 'capture.example' : `capture-${index}.capture.example`, observerLabel: 'Analyst A', vantageLabel: 'Declared network',
    conditions: index === 2 ? null : { ...conditions, locale: index === 1 ? 'en-GB' : 'en-AU' },
  })) };
  const second = { ...first, captures: first.captures.map(capture => ({ ...capture, capturedAt: '2026-09-01T01:00:00.000Z', observerLabel: 'Analyst B' })) };
  // Exercise admitted multi-capture data, including repeated domains and instants.
  expect(readWebCaptureManifest(first).captures).toHaveLength(11);
  expect(readWebCaptureManifest(second).captures).toHaveLength(11);
  expect(externalFindingsCaseTargets(readWebCaptureManifest(first).document, 'capture.example')).toEqual([...new Set(first.captures.map(capture => capture.domain))]);
  await openCasesView(page); await createCase(page, 'capture.example'); await openCaseSection(page, 'Evidence');
  const capture = page.locator('.capture-workspace'); await capture.locator(':scope > summary').click();
  const before = await readBrowserLocalCollection(page, 'cases');
  const requests: string[] = []; page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
  const firstInput = capture.getByLabel('Select capture manifest', { exact: true });
  await firstInput.setInputFiles({ name: 'first.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(first)) });
  const comparison = capture.locator('.capture-comparison'); await comparison.locator(':scope > summary').click();
  const secondInput = comparison.getByLabel('Comparison capture manifest', { exact: true });
  await secondInput.setInputFiles({ name: 'second.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(second)) });
  const firstPage = comparison.getByRole('combobox', { name: 'First page observation', exact: true });
  const secondPage = comparison.getByRole('combobox', { name: 'Second page observation', exact: true });
  await expect(firstPage).toHaveValue(''); await expect(secondPage).toHaveValue('');
  const matrix = comparison.locator('.capture-condition-matrix'); await matrix.locator(':scope > summary').click();
  const count = matrix.locator('.selection-status').getByRole('status');
  const row = (label: string) => matrix.getByRole('listitem').filter({ has: page.getByText(label, { exact: true }) });
  const grid = matrix.getByRole('region', { name: 'Selected capture condition comparison', exact: true });
  await expect(count).toHaveText('0 of 22 observations selected · maximum 20');
  await expect(grid).toHaveCount(0);
  const firstCheck = row('First manifest · capture 1').getByRole('checkbox');
  await firstCheck.focus(); await firstCheck.press('Space'); await expect(firstCheck).toBeChecked();
  await row('First manifest · capture 2').getByRole('checkbox').check();
  await expect(grid.getByRole('columnheader')).toHaveCount(3);
  await expect(grid.getByRole('rowheader', { name: 'Declared locale Different declarations', exact: true })).toBeVisible();
  await expect(matrix).toContainText('Observation times: the same instant.');
  await row('First manifest · capture 3').getByRole('checkbox').check();
  const viewport = grid.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Declared viewport Not fully declared', exact: true }) });
  await expect(viewport.getByRole('cell')).toHaveText(['1024 × 768', '1024 × 768', 'Not declared']);
  await expect(firstPage).toHaveValue(''); await expect(secondPage).toHaveValue('');
  await row('First manifest · capture 2').getByRole('button', { name: 'Use as first page', exact: true }).click();
  await expect(firstPage).toHaveValue('1');
  const pages = matrix.getByRole('navigation', { name: 'Capture observations', exact: true });
  await pages.getByRole('button', { name: 'Next', exact: true }).click();
  await row('Second manifest · capture 1').getByRole('button', { name: 'Use as second page', exact: true }).click();
  await expect(secondPage).toHaveValue('0');
  await expect(comparison.getByRole('region', { name: 'Page dependency comparison', exact: true })).toBeVisible();
  await expect(count).toHaveText('3 of 22 observations selected · maximum 20');
  await expect(comparison.getByRole('combobox', { name: 'First screenshot', exact: true })).toHaveCount(0);
  await matrix.getByText('How to interpret this comparison', { exact: true }).click();
  await expect(matrix).toContainText('Exact capture URLs and observed login or session state are not retained');
  await expect(matrix).toContainText('Viewports are declarations, not image dimensions.');

  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: width === 320 ? 700 : 720 });
      if (captureVisualEvidenceEnabled()) {
        await count.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`capture-selection-${theme}-${width}.png`) });
      }
      await grid.scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page);
      await grid.focus(); await expect(grid).toBeFocused();
      if (width === 320) {
        await grid.evaluate(element => { element.scrollLeft = 0; });
        await grid.press('ArrowRight');
        await expect.poll(() => grid.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
      }
      if (captureVisualEvidenceEnabled()) await page.screenshot({ path: testInfo.outputPath(`capture-matrix-${theme}-${width}.png`) });
    }
    expect((await new AxeBuilder({ page }).include('.capture-comparison').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  }
  await matrix.getByRole('button', { name: 'Clear condition selection', exact: true }).click();
  await pages.getByRole('button', { name: 'Previous', exact: true }).click();
  for (const checkbox of await matrix.getByRole('checkbox').all()) await checkbox.check();
  await pages.getByRole('button', { name: 'Next', exact: true }).click();
  for (const checkbox of await matrix.getByRole('checkbox').all()) await checkbox.check();
  await expect(count).toHaveText('20 of 22 observations selected · maximum 20');
  await expect(grid.getByRole('columnheader')).toHaveCount(21);
  await pages.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(matrix.getByRole('checkbox')).toHaveCount(2);
  for (const checkbox of await matrix.getByRole('checkbox').all()) await expect(checkbox).toBeDisabled();
  await pages.getByRole('button', { name: 'Previous', exact: true }).click();
  await row('First manifest · capture 11').getByRole('checkbox').uncheck();
  await pages.getByRole('button', { name: 'Next', exact: true }).click();
  await row('Second manifest · capture 10').getByRole('checkbox').check();
  await expect(count).toHaveText('20 of 22 observations selected · maximum 20');

  const historical = { ...manifest, schemaVersion: 2, captures: [{ ...manifest.captures[0]!, pageBehaviour: undefined }] };
  await secondInput.setInputFiles({ name: 'historical.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(historical)) });
  await expect(secondPage).toHaveValue('');
  await expect(secondPage.locator('option').nth(1)).toHaveJSProperty('disabled', true);
  await secondPage.focus(); await secondPage.press('ArrowDown'); await secondPage.press('Enter');
  await expect(secondPage).toHaveValue('');
  await expect(comparison.getByRole('region', { name: 'Page dependency comparison', exact: true })).toHaveCount(0);
  await matrix.locator(':scope > summary').click();
  await expect(count).toHaveText('0 of 12 observations selected · maximum 20');
  await expect(grid).toHaveCount(0);
  await pages.getByRole('button', { name: 'Next', exact: true }).click();
  const historicalRow = row('Second manifest · capture 1');
  await expect(historicalRow).toContainText('Page observations not retained');
  await expect(historicalRow.getByRole('button')).toHaveCount(0);
  await historicalRow.getByRole('checkbox').check();
  await row('First manifest · capture 11').getByRole('checkbox').check();
  await expect(grid.getByRole('rowheader', { name: 'Declared viewport Not fully declared', exact: true })).toBeVisible();
  await firstInput.setInputFiles({ name: 'replacement.json', mimeType: 'application/json', buffer: manifestBytes });
  await expect(matrix).toHaveCount(0);
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  expect(await storedFiles(page)).toEqual([]); expect(requests).toEqual([]);
});

test('page dependency comparison works without images and records only an explicitly expected change', async ({ page }, testInfo) => {
  await openCasesView(page); await createCase(page, 'capture.example'); await openCaseSection(page, 'Evidence');
  const workspace = page.locator('.capture-workspace'); await workspace.locator(':scope > summary').click();
  const fixture = captureReviewFixture();
  const request = { position: 1, kind: 'script', origin: 'https://static.example.test', contentSha256: 'a'.repeat(64), status: 200, cspEnforced: false, cspReportOnly: true };
  const coverage = { ...fixture.manifest.captures[0]!.pageBehaviour.coverage, attempts: [
    { position: 1, channel: 'script', method: 'read', origin: 'https://static.example.test', state: 'observed', reason: null, collectionStarted: true },
    { position: 2, channel: 'fetch', method: 'read', origin: 'https://api.example.test', state: 'observed', reason: null, collectionStarted: true },
    { position: 3, channel: 'beacon', method: 'non_read', origin: null, state: 'refused', reason: 'method', collectionStarted: false },
  ] };
  const first = { ...fixture.manifest, captures: [{ ...fixture.manifest.captures[0]!, pageBehaviour: { version: 1, state: 'partial', requests: [request], elements: [], actionHints: ['verification_prompt'], clipboardWriteAttempts: 1, coverage } }] };
  const second = { ...first, captures: [{ ...first.captures[0]!, capturedAt: '2026-09-01T01:00:00.000Z', pageBehaviour: { ...first.captures[0]!.pageBehaviour, requests: [{ ...request, contentSha256: 'b'.repeat(64) }] } }] };
  const before = await readBrowserLocalCollection(page, 'cases');
  const requests: string[] = []; page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
  await workspace.getByLabel('Select capture manifest', { exact: true }).setInputFiles({ name: 'first.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(first)) });
  const observations = workspace.locator('.page-behaviour'); await observations.locator(':scope > summary').click();
  await expect(observations).toContainText('https://static.example.test'); await expect(observations).toContainText('1 Clipboard API write attempts');
  await observations.getByText('Request-channel coverage', { exact: true }).click();
  await expect(observations.getByRole('definition').filter({ hasText: '1 supplied · 0 refused · 0 unavailable' })).toHaveCount(2);
  await expect(observations).toContainText('Interactions: not exercised');
  await expect(observations).toContainText('collector not started');
  const comparison = workspace.locator('.capture-comparison'); await comparison.locator(':scope > summary').click();
  await comparison.getByLabel('Comparison capture manifest', { exact: true }).setInputFiles({ name: 'second.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(second)) });
  const result = comparison.getByRole('region', { name: 'Page dependency comparison', exact: true });
  await expect(result).toContainText('inconclusive'); await expect(result).toContainText('Added observation × 1'); await expect(result).toContainText('Not re-observed × 1');
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  await result.getByText('Record an expected change', { exact: true }).click();
  const save = result.getByRole('button', { name: 'Record expected page change', exact: true });
  await save.click(); expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
  await result.getByRole('checkbox').check(); await result.getByLabel('Reason or change reference').fill('Approved static asset update; release record 17.');
  await save.click();
  await expect(result.getByRole('status')).toContainText('Expected change recorded');
  const after = await readBrowserLocalCollection(page, 'cases', { minimumRevision: before.manifest.revision + 1 });
  expect(JSON.stringify(after)).toContain('Approved static asset update'); expect(JSON.stringify(after)).toContain('sorted-json-v2');
  expect(await storedFiles(page)).toEqual([]); expect(requests).toEqual([]);
  for (const theme of ['light', 'dark'] as const) { await useTheme(page, theme); for (const width of [320, 390, 1024, 1280, 2560]) { await page.setViewportSize({ width, height: 900 }); await expectNoHorizontalOverflow(page);
      if (width === 320 || width === 1280) { await observations.scrollIntoViewIfNeeded(); if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`channel-coverage-${theme}-${width}.png`) }); } }
    }
    expect((await new AxeBuilder({ page }).include('.page-behaviour').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  }
});

test('capture comparison exposes declared conditions, handles unmatched and different-sized images, and saves nothing', async ({ page }, testInfo) => {
  await openCasesView(page); await createCase(page, 'capture.example'); await openCaseSection(page, 'Evidence');
  const capture = page.locator('.capture-workspace'); await capture.locator(':scope > summary').click();
  const { manifest, screenshot, manifestBytes } = captureReviewFixture();
  const before = await readBrowserLocalCollection(page, 'cases');
  // The manifest parser's existing 1 MiB byte boundary also applies to this UI.
  await capture.getByLabel('Select capture manifest', { exact: true }).setInputFiles({ name: 'manifest.json', mimeType: 'application/json', buffer: Buffer.concat([manifestBytes, Buffer.alloc(1024 * 1024 - manifestBytes.length, 32)]) });
  await capture.getByLabel('Select capture attachments to check', { exact: true }).setInputFiles({ name: 'left.png', mimeType: 'image/png', buffer: Buffer.from(screenshot) });
  const comparison = capture.locator('.capture-comparison'); await comparison.locator(':scope > summary').click();
  const second = { ...manifest, captures: [{ ...manifest.captures[0]!, capturedAt: '2026-09-01T00:05:00.000Z', observerLabel: 'Analyst B', vantageLabel: 'Selected network',
    conditions: { browser: 'chromium', browserVersion: '151', viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, locale: 'en-AU', timezone: 'UTC', colourScheme: 'light' } }] };
  const manifestInput = comparison.getByLabel('Comparison capture manifest', { exact: true });
  await manifestInput.setInputFiles({ name: 'second.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(second)) });
  const attachments = comparison.getByLabel('Comparison capture attachments', { exact: true });
  await expect(attachments).toBeEnabled();
  await attachments.setInputFiles({ name: 'wrong.png', mimeType: 'image/png', buffer: Buffer.from('Not the selected screenshot') });
  await expect(attachments).toBeEnabled();
  await expect(comparison).toContainText('No comparison PNG has matching selected bytes yet.');
  await attachments.setInputFiles([
    { name: 'first.png', mimeType: 'image/png', buffer: Buffer.from(screenshot) },
    { name: 'second.png', mimeType: 'image/png', buffer: Buffer.from(screenshot) },
  ]);
  const select = comparison.getByRole('combobox', { name: 'Second screenshot', exact: true });
  await expect(select).toHaveValue('');
  await expect(comparison.getByRole('region', { name: 'Second capture image', exact: true })).toHaveCount(0);
  await select.selectOption({ index: 1 });
  const pixels = comparison.locator('.image-change-review'); await pixels.locator(':scope > summary').click();
  await pixels.getByRole('button', { name: 'Calculate image changes', exact: true }).click();
  await expect(pixels.getByRole('status')).toHaveText('0 of 1,024 compared pixels differ (0.00%). 0 pixels excluded.');
  await expect(pixels.getByRole('img')).toHaveCount(0);
  await pixels.getByText('Observation times and capture conditions', { exact: true }).click();
  await expect(pixels).toContainText('300 seconds apart'); await expect(pixels).toContainText('Declared viewport · unknown');
  await expect(pixels).toContainText('Analyst B'); await expect(pixels).toContainText('collection independence is not verified');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 1920, 2560, 3840]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      await pixels.scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page);
      if (width === 320 || width === 1280) if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`capture-context-${theme}-${width}.png`) }); }
    }
    expect((await new AxeBuilder({ page }).include('.capture-comparison').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  }
  const different = sourceImage();
  second.captures[0]!.artifacts = [{ ...second.captures[0]!.artifacts[0]!, bytes: different.length, sha256: createHash('sha256').update(different).digest('hex'), width: 640, height: 360 }];
  await manifestInput.setInputFiles({ name: 'different.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(second)) });
  await expect(pixels).toHaveCount(0);
  await attachments.setInputFiles({ name: 'different.png', mimeType: 'image/png', buffer: different });
  await pixels.locator(':scope > summary').click(); await pixels.getByRole('button', { name: 'Calculate image changes', exact: true }).click();
  await expect(pixels.getByRole('status')).toHaveText('The dimensions differ; pixels were not resized or compared.');
  await page.evaluate(() => {
    const post = Worker.prototype.postMessage, terminate = Worker.prototype.terminate;
    let held: Worker | null = null, stopped = 0;
    Worker.prototype.postMessage = function(message: unknown, ...rest: unknown[]) {
      if ((message as { kind?: string } | null)?.kind === 'capture') { held = this; return; }
      return Reflect.apply(post, this, [message, ...rest]);
    };
    Worker.prototype.terminate = function() { if (held === this) { held = null; stopped++; } return terminate.call(this); };
    Object.defineProperty(window, 'heldComparison', { get: () => ({ held: held !== null, stopped }) });
  });
  await attachments.setInputFiles({ name: 'waiting.png', mimeType: 'image/png', buffer: different });
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'heldComparison'))).toEqual({ held: true, stopped: 0 });
  await expect(pixels).toHaveCount(0);
  await comparison.getByRole('button', { name: 'Cancel comparison capture', exact: true }).click();
  await expect(attachments).toBeFocused();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'heldComparison'))).toEqual({ held: false, stopped: 1 });
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before); expect(await storedFiles(page)).toEqual([]);
});

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
  const comparison = capture.locator('.capture-comparison'); await expand(comparison);
  await comparison.getByLabel('Comparison capture manifest', { exact: true }).setInputFiles({ name: 'comparison.json', mimeType: 'application/json', buffer: manifestBytes });
  const matrix = comparison.locator('.capture-condition-matrix'); await expand(matrix);
  for (const checkbox of await matrix.getByRole('checkbox').all()) await checkbox.check();
  const annotations = matrix.locator('.session-annotations'); await expand(annotations);
  await annotations.getByRole('combobox', { name: 'Session declaration — First manifest · capture 1', exact: true }).selectOption('signed_in');
  await annotations.getByRole('combobox', { name: 'Session declaration — Second manifest · capture 1', exact: true }).selectOption('unknown');
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
  const download = page.waitForEvent('download');
  await files.getByRole('button', { name: 'Download original manifest.json', exact: true }).click();
  const exportedBytes = Buffer.concat(await (await (await download).createReadStream()).toArray());
  expect(exportedBytes).toEqual(manifestBytes);
  expect(readWebCaptureManifest(JSON.parse(exportedBytes.toString()))).toEqual(readWebCaptureManifest(JSON.parse(manifestBytes.toString())));
  expect(JSON.stringify(saved)).not.toMatch(/annotatedAt|sessionDeclarations|signed_in|Analyst cannot determine/u);
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
      if (width === 320 || width === 1280) if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`capture-review-${theme}-${width}.png`) }); }
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
      if ((message as { kind?: string; input?: { files?: unknown[] } } | null)?.kind === 'capture' && (message as { input?: { files?: unknown[] } }).input?.files?.length) { held.add(this); return; }
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
