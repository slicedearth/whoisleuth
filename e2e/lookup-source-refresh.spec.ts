import fs from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { sectionedLookupFixture } from './lookup-design-fixtures';
import { expectNoHorizontalOverflow, failNextBrowserLocalManifestWrite, readBrowserLocalCollection, useTheme } from './helpers';

const EARLIER = '2026-07-13T00:00:00.000Z';
const LATER = '2026-07-14T00:00:00.000Z';
const DOMAIN = 'source-review.test';

async function start(page: Page, selected = false) {
  await page.route('**/api/lookup?*', async route => {
    const fixture = sectionedLookupFixture(DOMAIN);
    Object.assign(fixture.rdap, { fetchedAt: EARLIER });
    Object.assign(fixture.rdap.parsed, { registrar: { name: 'Original registrar' } });
    Object.assign(fixture.availability, { applicable: true, observationHostname: DOMAIN });
    if (selected) Object.assign(fixture.availability, { webObservationMode: 'selected_url' });
    await route.fulfill({ json: fixture });
  });
  await page.goto('/lookup');
  await page.locator('#query').fill(DOMAIN);
  await page.getByRole('radio', { name: /Deep/u }).check();
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  await page.getByRole('button', { name: 'Expand Source quality evidence', exact: true }).click();
  await page.locator('#source-quality .records-disclosure > summary').click();
  await expect(page.locator('.source-refresh')).toBeVisible();
}

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
  await start(page);
  const refresh = page.locator('.source-refresh');
  await refresh.getByRole('button', { name: 'Refresh Registry RDAP', exact: true }).click();
  await expect(refresh.locator('.refresh-results > li')).toHaveCount(1);
  const comparison = refresh.locator('article', { has: page.locator('strong', { hasText: /^Registrar$/u }) });
  await expect(comparison).toContainText('changed');
  await expect(comparison).toContainText('Original registrar');
  await expect(comparison).toContainText('Updated registrar');
  await expect(comparison).toContainText(LATER);
  await page.getByRole('button', { name: 'Collapse Source quality evidence', exact: true }).click();
  await page.getByRole('button', { name: 'Expand Source quality evidence', exact: true }).click();
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
      await page.screenshot({ path: testInfo.outputPath(`source-refresh-${theme}-${width}.png`) });
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
});

test('cancelling a held source response does not retain late evidence', async ({ page }) => {
  let release: (() => void) | undefined;
  await page.route('**/api/rdap?*', async route => {
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: { query: DOMAIN, type: 'domain', upstreamStatus: 200, fetchedAt: LATER,
      parsed: { domain: DOMAIN, registrar: { name: 'Late registrar' } } } });
  });
  await start(page);
  const refresh = page.locator('.source-refresh');
  await refresh.getByRole('button', { name: 'Refresh Registry RDAP', exact: true }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await refresh.getByRole('button', { name: 'Cancel source refresh' }).click();
  await expect(refresh.getByRole('status')).toContainText('cancelled');
  release!();
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
