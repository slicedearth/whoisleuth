import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import fs from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { sectionedLookupFixture } from './lookup-design-fixtures';
import { holdFixtureResponse } from './held-response';
import { expectNoHorizontalOverflow, failNextBrowserLocalManifestWrite, readBrowserLocalCollection, useTheme } from './helpers';
import { formatEvidenceDate } from '../frontend/src/lib/analysis/evidence-time';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const EARLIER = '2026-07-13T00:00:00.000Z';
const LATER = '2026-07-14T00:00:00.000Z';
const DOMAIN = 'source-review.test';

async function start(page: Page, selected = false, includeReceipt = false) {
  await page.route('**/api/lookup?*', async route => {
    const fixture = sectionedLookupFixture(DOMAIN);
    Object.assign(fixture.rdap, { fetchedAt: EARLIER });
    Object.assign(fixture.rdap.parsed, { registrar: { name: 'Original registrar' } });
    Object.assign(fixture.availability, { applicable: true, observationHostname: DOMAIN });
    if (selected) Object.assign(fixture.availability, { webObservationMode: 'selected_url' });
    if (includeReceipt) {
      Object.assign(fixture, { collectionReceipt: JSON.parse(readFileSync(path.resolve(__dirname, '../test/fixtures/cli-lookup-v3.json'), 'utf8')).collectionReceipt });
      Object.assign(fixture.availability.dns, {observedAt: EARLIER});
    }
    await route.fulfill({ json: fixture });
  });
  await page.goto('/lookup');
  await page.locator('#query').fill(DOMAIN);
  await page.getByRole('radio', { name: /Deep/u }).check();
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  await page.getByRole('button', { name: 'Expand details: Source quality evidence', exact: true }).click();
  await page.locator('#source-quality .records-disclosure > summary').click();
  await expect(page.locator('.source-refresh')).toBeVisible();
}

test('completed source-plan review stays bound to its original target, mode and observations while the draft changes', async ({ page }, testInfo) => {
  await start(page, false, true);
  const review = page.locator('#evidence-quality .collection-outcomes');
  await review.locator(':scope > summary').click();
  const receipt = review.getByRole('region', { name: 'Collection receipt', exact: true });
  await expect(receipt).toContainText('security.txt: not selected');
  await receipt.locator('summary').click();
  await expect(receipt.locator('dt')).toHaveCount(10);
  await expect(receipt).toContainText('Collector started');
  await expect(receipt).toContainText('Collector not started');
  await expect(receipt).toContainText('Not requested in this Lookup');
  await expect(review).not.toContainText('original selection unknown');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) {
        await receipt.locator('h5').evaluate(element => element.scrollIntoView({ block: 'center' }));
        await page.screenshot({ path: testInfo.outputPath(`receipt-${theme}-${width}.png`) });
      }
    }
  }
  await expect(review).toContainText(DOMAIN);
  const rdap = review.locator('[data-planned-source="rdap"]');
  await expect(rdap).toContainText(formatEvidenceDate(EARLIER));
  const before = await review.innerText();
  await page.locator('#query').fill('AS64496');
  await page.getByRole('radio', { name: /Fast/u }).check();
  await expect.poll(() => review.innerText()).toBe(before);
  await expect(review.locator('[data-planned-source="domain_evidence"]')).toBeVisible();
  await expect(review).not.toContainText('AS64496');
  await expect(page.locator('.source-refresh .refresh-results > li')).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand details: Web and DNS evidence', exact: true }).click();
  const checkpoint = page.locator('.source-checkpoint', { has: page.locator('summary', { hasText: 'Pin DNS facts to Case' }) });
  await checkpoint.locator('summary').click();
  await checkpoint.getByRole('button', { name: 'Save lookup to Case', exact: true }).click();
  const saved = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value;
  const originalReceipt = JSON.parse(readFileSync(path.resolve(__dirname, '../test/fixtures/cli-lookup-v3.json'), 'utf8')).collectionReceipt;
  expect(saved.evidenceHistory).toEqual([expect.objectContaining({collectionReceipt: originalReceipt, scanDepth: 'deep'})]);
  const nameservers = checkpoint.getByRole('checkbox', { name: /^Nameservers /u });
  await expect(nameservers).toBeEnabled();
  await nameservers.check();
  await checkpoint.getByRole('button', { name: 'Save 1 checkpoint fact', exact: true }).click();
  await expect(checkpoint.getByRole('status')).toContainText('Saved 1 analyst-selected checkpoint fact');
  const retained = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value;
  expect(retained.evidenceHistory).toEqual(saved.evidenceHistory);
  expect(retained.evidencePins).toHaveLength(1);
  expect(retained.checkpointCollectionReceipts).toEqual([{checkpointId: (retained.evidencePins as {checkpointId: string}[])[0]!.checkpointId, collectionReceipt: originalReceipt}]);
  await page.goto(`/cases?case=${encodeURIComponent(String(retained.id))}&section=evidence`);
  const observations = page.getByRole('region', { name: 'Case observations', exact: true });
  const pinDisclosure = observations.getByText('Pin an observed fact', { exact: true });
  if (await pinDisclosure.locator('..').getAttribute('open') === null) await pinDisclosure.click();
  await observations.getByText('Collection context for selected checkpoints', {exact: true}).click();
  await observations.getByRole('combobox', { name: 'Evidence reference to trace', exact: true }).selectOption((retained.evidencePins as {id: string}[])[0]!.id);
  const context = observations.getByRole('region', {name: 'Selected checkpoint collection context'});
  await expect(context).toContainText('Nameservers');
  await expect(context).toContainText('security.txt: not selected');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [390, 1280]) {
      await page.setViewportSize({width, height: 844});
      await expectNoHorizontalOverflow(page);
      await expect(context).toBeVisible();
      if (captureVisualEvidenceEnabled()) {
        await context.getByRole('heading', {name: 'Original collection choices'}).evaluate(element => element.scrollIntoView({block: 'center'}));
        await page.screenshot({path: testInfo.outputPath(`checkpoint-receipt-${theme}-${width}.png`)});
      }
    }
  }
});

test('inconclusive WHOIS discovery is explained as incomplete evidence rather than absent service', async ({ page }, testInfo) => {
  let requests = 0;
  await page.route('**/api/lookup?*', async route => {
    requests++;
    const fixture = sectionedLookupFixture(DOMAIN);
    Object.assign(fixture, {
      whois: { chain: [{ server: 'whois.iana.org', response: 'Service temporarily unavailable.' }],
        parsed: { registrationStatus: 'inconclusive', chainStatus: 'partial', notFound: false, nameservers: [], contactsByRole: {} } },
    });
    Object.assign(fixture.diagnostics.whois, { status: 'partial' });
    await route.fulfill({ json: fixture });
  });
  await page.goto('/lookup');
  await page.locator('#query').fill(DOMAIN);
  await page.getByRole('radio', { name: /Deep/u }).check();
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  await page.getByRole('button', { name: 'Expand details: Source quality evidence', exact: true }).click();
  await page.locator('#evidence-quality .collection-outcomes > summary').click();
  const source = page.locator('[data-planned-source="whois"]');
  await expect(source).toContainText('Completed diagnostic: partial');
  await expect(source).toContainText('incomplete or inconclusive');
  await expect(source).toContainText('a later retry may help');
  await expect(source).not.toContainText('No applicable service');
  await expect(source).not.toContainText('Not requested');
  for (const width of [320, 1280]) for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 844 });
    await useTheme(page, theme);
    await source.scrollIntoViewIfNeeded();
    await expect(source).toBeVisible();
    await expectNoHorizontalOverflow(page);
    if (captureVisualEvidenceEnabled()) await source.screenshot({ path: testInfo.outputPath(`whois-inconclusive-${width}-${theme}.png`) });
  }
  expect(requests).toBe(1);
});

test('refreshed facts survive section navigation and save through the existing Case checkpoint without replacing its observation', async ({ page }, testInfo) => {
  let requests = 0;
  await page.route('**/api/rdap?*', async route => {
    requests++;
    expect(new URL(route.request().url()).searchParams.get('q')).toBe(DOMAIN);
    await route.fulfill({ json: { query: DOMAIN, type: 'domain', upstreamStatus: 200,
      fetchedAt: LATER, parsed: { domain: DOMAIN, registrar: { name: 'Updated registrar' } },
      data: { rawContact: 'private-example-contact' },
    } });
  });
  await start(page, false, true);
  const refresh = page.locator('.source-refresh');
  await refresh.getByRole('button', { name: 'Refresh Registry RDAP', exact: true }).click();
  await expect(refresh.locator('.refresh-results > li')).toHaveCount(1);
  const comparison = refresh.locator('article', { has: page.locator('strong', { hasText: /^Registrar$/u }) });
  await expect(comparison).toContainText('changed');
  await expect(comparison).toContainText('Original registrar');
  await expect(comparison).toContainText('Updated registrar');
  await expect(comparison).toContainText(LATER);
  const overview = refresh.getByRole('region', { name: 'Original and refreshed observations', exact: true });
  const registryTimes = overview.getByRole('listitem', { name: 'Registry RDAP', exact: true });
  await expect(registryTimes.locator('time')).toHaveCount(3);
  await expect(registryTimes.locator('time').nth(0)).toHaveAttribute('datetime', EARLIER);
  await expect(registryTimes.locator('time').nth(1)).toHaveAttribute('datetime', LATER);
  expect(await registryTimes.locator('time').nth(2).getAttribute('datetime')).not.toBe(LATER);
  await expect(overview.getByRole('listitem', { name: 'WHOIS', exact: true })).toContainText('No refresh retained in this review');
  await page.getByRole('button', { name: 'Collapse details: Source quality evidence', exact: true }).click();
  await page.getByRole('button', { name: 'Expand details: Source quality evidence', exact: true }).click();
  await page.locator('#source-quality .records-disclosure > summary').click();
  await expect(refresh.locator('.refresh-results > li')).toHaveCount(1);
  expect(requests).toBe(1);

  const pin = refresh.locator('.source-checkpoint');
  await pin.locator('summary').click();
  await pin.getByRole('button', { name: 'Save lookup to Case', exact: true }).click();
  const before = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value;
  const selection = pin.getByRole('checkbox', { name: /^Registrar Updated registrar/u });
  await selection.check();
  await failNextBrowserLocalManifestWrite(page, 'cases');
  await pin.getByRole('button', { name: 'Save 1 checkpoint fact', exact: true }).click();
  await expect(pin.getByRole('status')).toContainText(/quota|storage/iu);
  await expect(selection).toBeChecked();
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value.evidencePins).toEqual([]);
  await pin.getByRole('button', { name: 'Save 1 checkpoint fact', exact: true }).click();
  await expect(pin.getByRole('status')).toContainText('Saved 1 analyst-selected checkpoint fact');
  const after = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value;
  expect(after.evidenceHistory).toEqual(before.evidenceHistory);
  expect(after.checkpointCollectionReceipts).toBeUndefined();
  expect(after.evidencePins).toEqual([expect.objectContaining({ value: 'Updated registrar', source: 'Registry RDAP', observedAt: LATER })]);
  expect(JSON.stringify(after)).not.toContain('private-example-contact');
  const downloaded = page.waitForEvent('download');
  await refresh.getByRole('button', { name: 'Download readable refresh review' }).click();
  const download = await downloaded;
  const path = await download.path();
  expect(path).not.toBeNull();
  const report = await fs.readFile(path!, 'utf8');
  expect(report).toContain('Original registrar');
  expect(report).toContain('Updated registrar');
  expect(report).not.toContain('private-example-contact');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      await refresh.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) {
        await page.screenshot({ path: testInfo.outputPath(`source-refresh-${theme}-${width}.png`) });
        await overview.screenshot({ path: testInfo.outputPath(`observation-overview-${theme}-${width}.png`) });
      }
    }
  }
  await refresh.getByRole('button', { name: 'Refresh Registry RDAP', exact: true }).click();
  await expect(refresh.locator('.refresh-results > li')).toHaveCount(2);
  const later = refresh.locator('.refresh-results > li').nth(1);
  await expect(later).toContainText('Compared with the original Lookup.');
  await refresh.getByRole('combobox', { name: 'Compare with', exact: true }).selectOption('previous');
  await expect(later).toContainText('Compared with refresh 1.');
  await expect(later.locator('article', { has: page.locator('strong', { hasText: /^Registrar$/u }) })).toContainText('equal');
  expect(requests).toBe(2);
  const earlierRequest = await later.locator(':scope > details > p > time').getAttribute('datetime');
  expect(earlierRequest).not.toBeNull();
  // A non-admitted response retains an unavailable attempt, never the prior
  // observation as the latest result. HTTP failure paths are covered in the model.
  await page.route('**/api/rdap?*', route => route.fulfill({ json: { error: 'Fixture unavailable' } }));
  await refresh.getByRole('button', { name: 'Refresh Registry RDAP', exact: true }).click();
  await expect(refresh.locator('.refresh-results > li')).toHaveCount(3);
  await expect(registryTimes).toContainText('No observation retained by this request');
  await expect(registryTimes.locator('time').first()).toHaveAttribute('datetime', EARLIER);
  await expect(later).toContainText('Updated registrar');

  // Keep another source family in the review while all RDAP entries are removed.
  await page.route('**/api/whois?*', route => route.fulfill({ json: { error: 'Fixture unavailable' } }));
  await refresh.getByRole('button', { name: 'Refresh WHOIS', exact: true }).click();
  await expect(refresh.locator('.refresh-results > li')).toHaveCount(4);
  const removeEntry = async (index: number) => {
    const entry = refresh.locator('.refresh-results > li').nth(index);
    if (await entry.locator(':scope > details').getAttribute('open') === null) await entry.locator(':scope > details > summary').click();
    await entry.getByRole('button', { name: `Remove transient refresh ${index + 1}`, exact: true }).click();
  };
  await removeEntry(2);
  await expect(refresh.locator('.refresh-results > li')).toHaveCount(3);
  await expect(registryTimes).toContainText('Latest retained refresh · fact times');
  await expect(registryTimes).toContainText('Latest retained request in this review:');
  await expect(registryTimes.locator('time').nth(1)).toHaveAttribute('datetime', LATER);
  await expect(registryTimes.locator('time').last()).toHaveAttribute('datetime', earlierRequest!);
  await expect(registryTimes).not.toContainText('No observation retained by this request');
  await expect(overview).toContainText('removed and cancelled requests are not represented');
  await removeEntry(1); await removeEntry(0);
  await expect(refresh.locator('.refresh-results > li')).toHaveCount(1);
  await expect(registryTimes).toContainText('No refresh retained in this review');
  await expect(registryTimes).not.toContainText('Latest retained request in this review:');
  await expect(registryTimes).not.toContainText('Not requested');
  await expect(registryTimes.locator('time')).toHaveCount(1);
  await expect(registryTimes.locator('time')).toHaveAttribute('datetime', EARLIER);
  await expect(overview.getByRole('listitem', { name: 'WHOIS', exact: true })).toContainText('No observation retained by this request');
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value.evidencePins).toEqual(after.evidencePins);
});

test('cancelling a held source response does not retain late evidence', async ({ page }) => {
  const held = await holdFixtureResponse(page, url => url.pathname === '/api/rdap', {
    json: { query: DOMAIN, type: 'domain', upstreamStatus: 200, fetchedAt: LATER,
      parsed: { domain: DOMAIN, registrar: { name: 'Late registrar' } } },
  });
  await start(page);
  const refresh = page.locator('.source-refresh');
  await refresh.getByRole('button', { name: 'Refresh Registry RDAP', exact: true }).click();
  const request = await held.received;
  const failed = page.waitForEvent('requestfailed', candidate => candidate === request);
  await refresh.getByRole('button', { name: 'Cancel source refresh' }).click();
  await expect(refresh.getByRole('status')).toContainText('cancelled');
  await held.release();
  await failed;
  expect(request.failure()).not.toBeNull();
  await expect(refresh.getByRole('button', { name: 'Refresh Registry RDAP', exact: true })).toBeEnabled();
  await expect(refresh.getByRole('button', { name: 'Refresh Registry RDAP', exact: true })).toBeFocused();
  await expect(refresh.locator('.refresh-results > li')).toHaveCount(0);
  await expect(refresh).not.toContainText('Late registrar');
});

test('selected-page review blocks implicit homepage refresh while leaving registry refresh available', async ({ page }) => {
  await start(page, true);
  const refresh = page.locator('.source-refresh');
  await expect(refresh.getByRole('button', { name: 'Refresh Domain evidence', exact: true })).toBeDisabled();
  await expect(refresh).toContainText('select its URL again in a new Deep lookup');
  await expect(refresh.getByRole('button', { name: 'Refresh Registry RDAP', exact: true })).toBeEnabled();
});
