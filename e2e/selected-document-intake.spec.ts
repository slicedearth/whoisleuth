import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import { test, expect, isLookupEndpointUrl } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { selectedPdfFixture, selectedDocxFixture, selectedHarFixture } from '../fixtures/selected-input-examples.mts';
import { expectNoHorizontalOverflow, useTheme } from './helpers';

function harWithMeasuredDuration() {
  const archive = JSON.parse(new TextDecoder().decode(selectedHarFixture()));
  archive.log.entries.push({ startedDateTime: '2026-09-20T00:01:00.050Z', time: 100,
    request: { method: 'GET', url: 'https://asset.example/private?access_token=private-value' },
    response: { status: 200, content: { mimeType: 'image/png' } },
    timings: { blocked: 0, dns: 5, connect: 50, ssl: 30, send: 5, wait: 25, receive: 15 }, _resourceType: 'image' });
  return new TextEncoder().encode(JSON.stringify(archive));
}

const selectedDocuments = [
  { kind: 'pdf', bytes: () => selectedPdfFixture(), hostname: 'document-qr.example' },
  { kind: 'docx', bytes: () => selectedDocxFixture(), hostname: 'docx-link.example' },
  { kind: 'har', bytes: harWithMeasuredDuration, hostname: 'request.example' },
] as const;

async function openOfflineIntake(page: Page) {
  let collections = 0;
  await page.route(url => isLookupEndpointUrl(url.href), route => { collections++; return route.abort(); });
  await page.goto('/lookup');
  await page.getByText('Review a message, link or selected file', { exact: true }).click();
  return { intake: page.locator('details.intake'), collectionCount: () => collections };
}

async function reviewDocument(intake: Locator, document: typeof selectedDocuments[number]) {
  await intake.getByLabel('Input type').selectOption(document.kind);
  await intake.getByLabel('Select a file', { exact: true }).setInputFiles({
    name: `selected.${document.kind}`,
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(document.bytes()),
  });
  await intake.getByRole('button', { name: 'Review locally', exact: true }).click();
  await expect(intake.getByRole('heading', { name: 'Extracted destinations' })).toBeFocused();
  await expect(intake.getByRole('button', { name: 'Remove file', exact: true })).toHaveAccessibleDescription('Select a file');
  await expect(intake.getByRole('button', { name: `Use ${document.hostname} in Lookup`, exact: true })).toBeVisible();
}

test('document and HTTP-archive intake share offline navigation, provenance and minimised downloads', async ({ page }) => {
  const { intake, collectionCount } = await openOfflineIntake(page);
  for (const document of selectedDocuments) {
    const { kind, hostname } = document;
    await reviewDocument(intake, document);
    if (kind === 'har') {
      const sequence = intake.getByRole('region', { name: 'Recorded HTTP sequence' });
      const records = sequence.getByRole('list', { name: 'HTTP request records' }).getByRole('listitem');
      await expect(sequence).toContainText('Duration unavailable');
      await expect(sequence).toContainText('0 ms');
      await expect(records.first()).toContainText('#1 · POST · https://request.example');
      const beforeOrder = await page.evaluate(() => ({
        hash: location.hash, local: Object.fromEntries(Object.entries(localStorage)), session: Object.fromEntries(Object.entries(sessionStorage)),
      }));
      await sequence.getByLabel('Request order').focus();
      await sequence.getByLabel('Request order').selectOption('started');
      await expect(sequence.getByLabel('Request order')).toHaveValue('started');
      await expect(sequence.getByLabel('Request order')).toBeFocused();
      await expect(records.first()).toContainText('#2 · GET · https://later.example');
      await expect(records.nth(1)).toContainText('Starts 1000 ms after the earliest reported request');
      await records.nth(1).getByText('Reported timings', { exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(records.nth(1)).toContainText('TLS (part of connect)');
      expect(await page.evaluate(() => ({
        hash: location.hash, local: Object.fromEntries(Object.entries(localStorage)), session: Object.fromEntries(Object.entries(sessionStorage)),
      }))).toEqual(beforeOrder);
      expect(collectionCount()).toBe(0);
    } else {
      await expect(intake.getByRole('region', { name: 'Document extraction coverage' })).toContainText('partial');
      if (kind === 'pdf') await expect(intake).toContainText('page 1');
    }
    const [download] = await Promise.all([page.waitForEvent('download'), intake.getByRole('button', { name: 'Download review', exact: true }).click()]);
    const chunks: Buffer[] = []; for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk));
    const output = Buffer.concat(chunks).toString('utf8'), report = JSON.parse(output);
    expect(report.source.kind).toBe(kind); expect(output).not.toMatch(/private-value|private-body|Bearer|access_token|\/private/u);
    if (kind === 'har') {
      expect(report.harReview.entries.map((entry: { sequence: number }) => entry.sequence)).toEqual([1, 2, 3]);
      expect(report.harReview.entries.map((entry: { durationMs: number | null }) => entry.durationMs)).toEqual([0, null, 100]);
    }
    await intake.getByRole('button', { name: `Use ${hostname} in Lookup`, exact: true }).click();
    await expect(page.locator('#query')).toHaveValue(hostname); await expect(page.locator('#query')).toBeFocused();
    expect(collectionCount()).toBe(0);
  }
  await intake.getByLabel('Input type').selectOption('har');
  for (const entries of [
    [{ time: 10, request: { method: 'GET', url: 'https://undated.example/' }, response: { status: 200 } }], [],
  ]) {
    await intake.getByLabel('Select a file', { exact: true }).setInputFiles({ name: 'undated.har', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ log: { version: '1.2', entries } })) });
    await intake.getByRole('button', { name: 'Review locally', exact: true }).click();
    const sequence = intake.getByRole('region', { name: 'Recorded HTTP sequence' });
    await expect(sequence).toContainText('No usable start times were reported');
    await expect(sequence.getByRole('list', { name: 'HTTP request records' }).getByRole('listitem')).toHaveCount(entries.length);
    if (!entries.length) await expect(sequence).toContainText('No request records to display');
  }
  await intake.getByLabel('Input type').selectOption('pdf');
  await intake.getByLabel('Select a file', { exact: true }).setInputFiles({ name: 'encrypted.pdf', mimeType: 'application/pdf', buffer: Buffer.from(selectedPdfFixture(true)) });
  await intake.getByRole('button', { name: 'Review locally', exact: true }).click();
  await expect(intake.getByRole('region', { name: 'Document extraction coverage' })).toContainText('encrypted');
  await expect(intake.getByRole('textbox', { name: /password/iu })).toHaveCount(0);
  expect(collectionCount()).toBe(0);
});

for (const document of selectedDocuments) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${document.kind} intake remains accessible across viewports in ${theme}`, async ({ page }, testInfo) => {
      const { intake, collectionCount } = await openOfflineIntake(page);
      await reviewDocument(intake, document);
      await useTheme(page, theme);
      if (document.kind === 'har') {
        const timingSummaries = intake.getByRole('region', { name: 'Recorded HTTP sequence' }).getByText('Reported timings', { exact: true });
        await timingSummaries.first().click();
        await timingSummaries.last().click();
      }
      for (const width of [320, 390, 1024, 1280]) {
        await test.step(`${width}px`, async () => {
          await page.setViewportSize({ width, height: width < 500 ? 844 : 768 });
          await expectNoHorizontalOverflow(page);
          expect((await new AxeBuilder({ page }).include('.intake').analyze()).violations).toEqual([]);
          if (document.kind === 'har' && (width === 320 || width === 1280)) {
            if (captureVisualEvidenceEnabled()) { await intake.getByRole('region', { name: 'Recorded HTTP sequence' }).screenshot({
              path: testInfo.outputPath(`har-${width}-${theme}.png`),
            });
              const sequence = intake.getByRole('region', { name: 'Recorded HTTP sequence' });
              const previousDensity = await page.evaluate(() => globalThis.document.documentElement.dataset.density);
              for (const density of ['comfortable', 'compact']) {
                await page.evaluate(value => { globalThis.document.documentElement.dataset.density = value; }, density);
                await expectNoHorizontalOverflow(page);
                await sequence.getByLabel('Request order').scrollIntoViewIfNeeded();
                await page.screenshot({ path: testInfo.outputPath(`har-context-${width}-${theme}-${density}.png`) });
                await sequence.getByRole('listitem').last().locator('dl').scrollIntoViewIfNeeded();
                await page.screenshot({ path: testInfo.outputPath(`har-phases-${width}-${theme}-${density}.png`) });
              }
              await page.evaluate(value => {
                if (value === undefined) delete globalThis.document.documentElement.dataset.density;
                else globalThis.document.documentElement.dataset.density = value;
              }, previousDensity);
            }
          }
        });
      }
      expect(collectionCount()).toBe(0);
    });
  }
}
