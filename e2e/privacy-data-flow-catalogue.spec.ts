import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';

async function selectTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  if (await page.locator('html').getAttribute('data-theme') === theme) return;
  await page.getByRole('button', { name: /^Colour theme,/u }).click();
  await page.getByRole('option', { name: `${theme === 'light' ? 'Light' : 'Dark'} theme` }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

test('privacy catalogue guidance adds no data-collection request and stays semantic and responsive', async ({ page }) => {
  test.slow();
  const dataRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/') || request.resourceType() === 'fetch' || request.resourceType() === 'xhr') {
      dataRequests.push(`${request.method()} ${url.pathname}${url.search}`);
    }
  });

  for (const surface of [
    { width: 1440, height: 1000, theme: 'light' },
    { width: 1440, height: 1000, theme: 'dark' },
    { width: 390, height: 844, theme: 'light' },
    { width: 390, height: 844, theme: 'dark' },
  ] as const) {
    await page.setViewportSize({ width: surface.width, height: surface.height });
    for (const route of ['/privacy', '/resources'] as const) {
      dataRequests.length = 0;
      await page.goto(route);
      await selectTheme(page, surface.theme);

      const summary = page.getByTestId('privacy-data-flow-summary');
      await expect(summary).toBeVisible();
      await expect(summary.getByRole('heading', {
        name: 'Structured privacy and data-flow catalogue',
        level: route === '/privacy' ? 3 : 2,
      })).toBeVisible();
      await expect(summary.getByRole('list', { name: 'Privacy processing classes' }).getByRole('listitem')).toHaveCount(7);
      await expect(summary).toContainText('32 capability families');
      await expect(summary).toContainText('47 CLI operations');
      await expect(summary).toContainText('Opening this guidance makes no capability or provider request');

      const links = summary.getByRole('link');
      await expect(links).toHaveCount(2);
      await expect(links.nth(0)).toHaveAccessibleName(/Read the concise catalogue.*opens in a new tab/u);
      await expect(links.nth(1)).toHaveAccessibleName(/Open version 1 JSON.*opens in a new tab/u);
      await links.nth(0).focus();
      await page.keyboard.press('Tab');
      await expect(links.nth(1)).toBeFocused();
      const focusStyle = await links.nth(1).evaluate((element) => {
        const style = getComputedStyle(element);
        return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
      });
      expect(focusStyle.outlineStyle).not.toBe('none');
      expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThanOrEqual(2);

      const summaryGeometry = await summary.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));
      expect(summaryGeometry.scrollWidth).toBeLessThanOrEqual(summaryGeometry.clientWidth + 1);
      await expectNoHorizontalOverflow(page);
      expect(
        dataRequests,
        `${route} made a request beyond the existing public-navigation session-status check at ${surface.width}px in ${surface.theme} theme`,
      ).toEqual(['GET /api/session']);
    }
  }
});
