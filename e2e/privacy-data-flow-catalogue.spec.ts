import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';
import { MAX_HOMEPAGE_BYTES } from '../lib/outbound-request-bounds.mts';

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
    { width: 1280, height: 720, theme: 'light' },
    { width: 1280, height: 720, theme: 'dark' },
    { width: 1024, height: 768, theme: 'light' },
    { width: 1024, height: 768, theme: 'dark' },
    { width: 390, height: 844, theme: 'light' },
    { width: 390, height: 844, theme: 'dark' },
    { width: 320, height: 700, theme: 'light' },
    { width: 320, height: 700, theme: 'dark' },
  ] as const) {
    await page.setViewportSize({ width: surface.width, height: surface.height });
    dataRequests.length = 0;
    await page.goto('/privacy');
    await selectTheme(page, surface.theme);

    await expect(page.getByRole('heading', { name: 'Privacy policy', exact: true })).toBeVisible();
    const sections = page.getByRole('navigation', { name: 'Privacy policy sections' });
    await expect(sections).toBeVisible();
    await expect(sections.getByRole('link', { name: 'Local application', exact: true })).toHaveAttribute('href', '#privacy-local-application');
    const compatibility = page.locator('p').filter({ has: page.getByText('Compatibility.', { exact: true }) });
    await expect(compatibility).toBeVisible();
    await expect(compatibility).toContainText('remain readable');
    await expect(page.getByText(/current writer emits workspace archive version/iu)).toBeVisible();
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
    const policyLink = page.getByRole('link', { name: 'request-policy limits', exact: true });
    await expect(policyLink).toHaveAttribute('href', '/request-policy');
    if (surface.width === 320 || surface.width === 1280) {
      await page.getByRole('heading', { name: 'Privacy policy', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath(`privacy-${surface.width}-${surface.theme}.png`) });
    }
    const metadata = page.locator('p').filter({ hasText: 'Optional metadata CSV' });
    await expect(metadata).toContainText('collection and report times');
    await expect(metadata).toContainText('collection origin');
    await metadata.scrollIntoViewIfNeeded();
    await expect(metadata).toBeInViewport();
    await expectNoHorizontalOverflow(page);
    await test.info().attach(`csv-privacy-${surface.width}-${surface.theme}`, {
      body: await page.screenshot(), contentType: 'image/png',
    });
    const bulkManifest = page.locator('p').filter({ hasText: 'Selected Bulk CSV exports include a review manifest' });
    await expect(bulkManifest).toContainText('source states, observation times');
    await expect(bulkManifest).toContainText('Raw responses, contacts, Profile contents and notes are excluded.');
    await bulkManifest.scrollIntoViewIfNeeded();
    await expect(bulkManifest).toBeInViewport();
    await expectNoHorizontalOverflow(page);
    await test.info().attach(`bulk-manifest-privacy-${surface.width}-${surface.theme}`, {
      body: await page.screenshot(), contentType: 'image/png',
    });
    const trust = page.locator('p').filter({ hasText: 'An optional signer trust file' });
    await expect(trust).toContainText('not private keys');
    await expect(trust).toContainText('without its path or other entries');
    await trust.scrollIntoViewIfNeeded();
    await expect(trust).toBeInViewport();
    await expectNoHorizontalOverflow(page);
    await test.info().attach(`signer-privacy-${surface.width}-${surface.theme}`, {
      body: await page.screenshot(), contentType: 'image/png',
    });
    const cases = page.locator('p').filter({ hasText: 'The offline case command creates and updates ordinary local Case files' });
    await expect(cases).toContainText('private analyst content');
    await expect(cases).toContainText('Case files are unencrypted unless packaged separately with encryption.');
    await cases.scrollIntoViewIfNeeded();
    await expect(cases).toBeInViewport();
    await expectNoHorizontalOverflow(page);
    if (surface.width === 320 || surface.width === 1280) await page.screenshot({ path: test.info().outputPath(`case-file-privacy-${surface.width}-${surface.theme}.png`) });
  }
});

test('request policy exposes the current capture boundary across supported widths and themes', async ({ page }) => {
  for (const viewport of [
    { width: 1280, height: 720 }, { width: 1024, height: 768 },
    { width: 390, height: 844 }, { width: 320, height: 700 },
  ]) {
    for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize(viewport);
      await page.goto('/request-policy');
      await selectTheme(page, theme);
      await expect(page.getByRole('heading', { name: 'Outbound request policy', exact: true })).toBeVisible();
      const captureLimit = page.locator('#web-title').locator('..').getByText(`${MAX_HOMEPAGE_BYTES.toLocaleString('en-US')} bytes`, { exact: false });
      await captureLimit.scrollIntoViewIfNeeded();
      await expect(captureLimit).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (viewport.width === 320 || viewport.width === 1280) {
        await page.screenshot({ path: test.info().outputPath(`request-policy-${viewport.width}-${theme}.png`) });
      }
    }
  }
});
