import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';
import {
  CASE_SCHEMA_VERSION,
  PUBLIC_CASE_SCHEMA_VERSION,
  PUBLISHED_V2_CASE_SCHEMA_VERSION,
  PUBLIC_WORKSPACE_ARCHIVE_VERSION,
  PUBLISHED_V2_WORKSPACE_ARCHIVE_VERSION,
  WORKSPACE_ARCHIVE_VERSION,
} from '../packages/contracts/case-portability.mts';

async function selectTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  if (await page.locator('html').getAttribute('data-theme') === theme) return;
  await page.getByRole('button', { name: /^Colour theme,/u }).click();
  await page.getByRole('option', { name: `${theme === 'light' ? 'Light' : 'Dark'} theme` }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

test('privacy guidance stays concise, request-free and responsive', async ({ page }) => {
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
    dataRequests.length = 0;
    await page.goto('/privacy');
    await selectTheme(page, surface.theme);

    await expect(page.getByRole('heading', { name: 'Privacy policy', exact: true })).toBeVisible();
    const sections = page.getByRole('navigation', { name: 'Privacy policy sections' });
    await expect(sections.getByRole('link')).toHaveCount(8);
    await expect(page.getByText(new RegExp(
      `Current Case schema ${CASE_SCHEMA_VERSION}.*Published v2 Case schema ${PUBLISHED_V2_CASE_SCHEMA_VERSION}.*public v1 Case schema ${PUBLIC_CASE_SCHEMA_VERSION} remain readable`,
      'iu',
    ))).toBeVisible();
    await expect(page.getByText(new RegExp(
      `current writer emits workspace archive version ${WORKSPACE_ARCHIVE_VERSION}.*Exact versions ${PUBLIC_WORKSPACE_ARCHIVE_VERSION} and ${PUBLISHED_V2_WORKSPACE_ARCHIVE_VERSION} remain readable`,
      'iu',
    ))).toBeVisible();
    await expect(page.getByText(/IndexedDB as plaintext JSON/iu)).toBeVisible();
    const catalogueLink = page.getByRole('link', { name: /data-flow catalogue.*opens in a new tab/u });
    await expect(catalogueLink).toHaveAttribute('href', /docs\/privacy-data-flow-catalogue\.md$/u);
    await catalogueLink.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(catalogueLink).toBeFocused();
    const focusStyle = await catalogueLink.evaluate((element) => {
      const style = getComputedStyle(element);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
    });
    expect(focusStyle.outlineStyle).not.toBe('none');
    expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('privacy-data-flow-summary')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    expect(
      dataRequests,
      `/privacy made a request beyond the existing public-navigation session-status check at ${surface.width}px in ${surface.theme} theme`,
    ).toEqual(['GET /api/session']);
  }
});
