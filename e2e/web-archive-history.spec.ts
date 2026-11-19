import type { Page } from '@playwright/test';
import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import { expect, test } from './fixtures';
import { expandLookupFamilies, expectNoHorizontalOverflow, useTheme } from './helpers';
import { sectionedLookupFixture } from './lookup-design-fixtures';
import { collectWebArchiveHistory } from '../lib/web-archive-history.mts';

const DOMAIN = 'archive-review.example';

async function openArchivePanel(page: Page) {
  await page.locator('#query').fill(DOMAIN);
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  await expandLookupFamilies(page);
  const panel = page.locator('details.web-archive-history');
  await expect(panel).toHaveCount(1);
  await panel.locator(':scope > summary').click();
  return panel;
}

async function enableArchiveCapability(page: Page) {
  // The real server keeps this feature off by default; enable only its capability entry here.
  await page.route('**/api/capabilities', async route => {
    const response = await route.fetch();
    const report = await response.json() as { features: Array<{ id: string; status: string; reason?: string }> };
    expect(report.features.find(feature => feature.id === 'web_archive_history')?.status).toBe('disabled');
    report.features = report.features.map(feature => {
      if (feature.id !== 'web_archive_history') return feature;
      const { reason: _reason, ...enabled } = feature;
      return { ...enabled, status: 'supported' };
    });
    await route.fulfill({ response, json: report });
  });
}

test('web archive history stays unavailable until the deployment opts in', async ({ page }) => {
  await page.route('**/api/lookup?*', route => route.fulfill({ json: sectionedLookupFixture(DOMAIN) }));
  let requests = 0;
  await page.route('**/api/web-archive-history?*', route => { requests++; return route.abort(); });
  await page.goto('/lookup');
  const panel = await openArchivePanel(page);
  await expect(panel.getByText('Web archive history is not enabled for this deployment.', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Read archive history', exact: true })).toBeDisabled();
  expect(requests).toBe(0);
});

test('web archive history shows captures and compares the earliest with the registration date', async ({ page }, testInfo) => {
  await enableArchiveCapability(page);
  let lookups = 0;
  await page.route('**/api/lookup?*', route => { lookups++; return route.fulfill({ json: sectionedLookupFixture(DOMAIN) }); });
  const report = await collectWebArchiveHistory(DOMAIN, {}, {
    now: () => '2026-10-01T00:00:00.000Z',
    fetch: async url => Response.json(new URL(url).searchParams.get('limit') === '1'
      ? [['timestamp', 'statuscode'], ['20120304050607', '200']]
      : [['timestamp', 'statuscode'], ['20260901000000', '-']]),
  });
  let requests = 0;
  await page.route('**/api/web-archive-history?*', async route => {
    requests++;
    expect(new URL(route.request().url()).searchParams.get('q')).toBe(DOMAIN);
    await route.fulfill({ json: report });
  });
  await page.goto('/lookup');
  const panel = await openArchivePanel(page);
  expect(requests).toBe(0);
  await panel.getByRole('button', { name: 'Read archive history', exact: true }).click();

  const captures = panel.getByRole('region', { name: 'Web archive captures' });
  await expect(captures.locator('[data-query="earliest"] dd')).toContainText('2012');
  await expect(captures.locator('[data-query="earliest"] dd')).toContainText('Archive recorded HTTP 200');
  await expect(captures.locator('[data-query="earliest"]').getByRole('link', { name: 'Open capture' }))
    .toHaveAttribute('href', `https://web.archive.org/web/20120304050607/${DOMAIN}/`);
  await expect(captures.locator('[data-query="latest"] dd')).toContainText('No HTTP status recorded');
  // The fixture registration was created on 2 January 2020, years after the earliest capture.
  const comparison = captures.getByRole('region', { name: 'Registration comparison' });
  await expect(comparison).toHaveAttribute('data-state', 'earlier_observation');
  await expect(comparison).toContainText('Observed before the current registration');
  await expect(comparison).toContainText('does not identify a previous or current owner');
  await expect(panel.getByRole('status').filter({ hasText: 'Web archive history finished' })).toHaveText(/^Web archive history finished: earliest .+, latest .+\.$/u);
  expect(requests).toBe(1);
  expect(lookups).toBe(1);

  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) await panel.screenshot({ path: testInfo.outputPath(`web-archive-${width}-${theme}.png`) });
    }
  }
});
