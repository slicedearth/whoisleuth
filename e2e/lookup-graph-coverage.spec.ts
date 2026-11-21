import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import { expect, test } from './fixtures';
import { expectFocusedResultsVisible, expectNoHorizontalOverflow, expandLookupFamilies, useTheme } from './helpers';
import { lookupGraphCapacityFixture } from '../test/lookup-graph-capacity-fixture.mts';
import { sectionedLookupFixture } from './lookup-design-fixtures';

test('selected warning data qualifies existing relationship identifiers locally without changing evidence', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-11-01T00:00:00.000Z'));
  let requests = 0;
  await page.route('**/api/lookup?*', async route => {
    requests++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sectionedLookupFixture('example.test')) });
  });
  await page.goto('/lookup');
  await page.locator('#query').fill('example.test');
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  await expandLookupFamilies(page);
  await page.getByRole('tab', { name: /^Relationships/u }).click();
  const context = page.locator('.service-context');
  await context.locator(':scope > summary').click();
  await context.getByLabel('Warning-list JSON').setInputFiles({ name: 'selected-warning-data.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ name: 'Example shared namespace', version: 20261031, category: 'known', type: 'hostname', list: ['example.test'] })) });
  await context.getByLabel('Selected context').selectOption('dynamic_dns');
  await context.getByRole('button', { name: 'Review selected list', exact: true }).click();
  const result = context.getByRole('region', { name: 'Selected service context results', exact: true });
  await expect(result.getByRole('status')).toContainText('Example shared namespace');
  await expect(result.getByRole('listitem').filter({ hasText: /^example\.test/u })).toContainText('hostname exact');
  await expect(result).toContainText('current');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(result).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) {
        await context.evaluate(element => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 140, behavior: 'instant' }));
        await page.screenshot({ path: testInfo.outputPath(`selected-context-${theme}-${width}.png`) });
      }
    }
  }
  expect(requests).toBe(1);
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`complete graph relationships are reachable at ${viewport.width} in ${theme}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await useTheme(page, theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const response = lookupGraphCapacityFixture();
      let requests = 0;
      await page.route('**/api/lookup?*', async route => {
        requests += 1;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
      });
      await page.goto('/lookup');
      await page.locator('#query').fill('example.test');
      await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
      await expandLookupFamilies(page);
      await page.getByRole('tab', { name: /^Relationships/ }).click();
      const graph = page.getByRole('region', { name: 'Evidence graph', exact: true });
      await expect(graph).toBeVisible();
      await expect(graph.locator('header > .partial')).toHaveCount(0);
      const summary = graph.locator('summary').filter({ hasText: /^Review \d+ exact relationships$/ });
      const count = Number((await summary.innerText()).match(/\d+/)?.[0]);
      expect(count).toBeGreaterThan(400);
      await summary.focus(); await page.keyboard.press('Enter');
      const results = graph.getByRole('group', { name: 'Evidence graph relationship results' });
      await expect(results.locator('li')).toHaveCount(50);
      const pages = graph.getByRole('navigation', { name: 'Evidence graph relationship pages' });
      await pages.getByRole('button', { name: 'Next', exact: true }).focus(); await page.keyboard.press('Enter');
      await expectFocusedResultsVisible(page, results, results.locator('li').first());
      await expect(pages.getByRole('status')).toContainText('Page 2 of');
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) { await test.info().attach(`graph-results-${viewport.width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' }); }
      const finalPage = Math.ceil(count / 50);
      await pages.getByLabel('Evidence graph relationship page').fill(String(finalPage));
      await pages.getByRole('button', { name: 'Go', exact: true }).click();
      await expect(results.locator('li')).toHaveCount(count - (finalPage - 1) * 50);
      await expectFocusedResultsVisible(page, results, results.locator('li').first());
      const search = graph.getByLabel('Search relationships', { exact: true });
      for (const value of ['san49.example.test', 'resource29.example', 'identity15-11.example']) {
        await search.fill(value);
        await expect(results.locator('li')).toHaveCount(1);
        await expect(results).toContainText(value);
        await expect(pages).toHaveCount(0);
      }
      await search.fill('not-retained.example');
      await expect(results.locator('li')).toHaveCount(0);
      await expect(graph.getByRole('status')).toContainText('No retained relationship matches');
      await search.fill('san49.example.test');
      await results.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) { await test.info().attach(`graph-search-${viewport.width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' }); }
      await graph.locator('summary').filter({ hasText: 'Projection input coverage' }).click();
      const coverage = graph.locator('.input-coverage');
      await expect(coverage.locator('li').filter({ hasText: 'tls.dnsNames' })).toContainText('50 admitted · 50 of 50 inspected');
      expect(requests).toBe(1);
    });
  }
}
