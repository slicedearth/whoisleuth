import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { useTheme } from './helpers';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

async function expectNoAccessibilityViolations(page: Page, testInfo: TestInfo, state: string) {
  const startedAt = Date.now();
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const durationMs = Date.now() - startedAt;
  await testInfo.attach(`axe-${state}.json`, {
    body: JSON.stringify({
      state,
      durationMs,
      passes: results.passes.length,
      incomplete: results.incomplete.length,
      inapplicable: results.inapplicable.length,
    }),
    contentType: 'application/json',
  });
  expect(results.violations, `${state} produced accessibility violations`).toEqual([]);
  return durationMs;
}

test('scans representative public initial, error, populated, and expanded states', async ({ page }, testInfo) => {
  await useTheme(page, 'dark');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const initialDuration = await expectNoAccessibilityViolations(page, testInfo, 'public-initial-dark-desktop');

  await page.goto('/demo');
  await page.evaluate(() => sessionStorage.setItem('whoisleuth:synthetic-demo:v1', '{malformed'));
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Stored demo progress was invalid');
  const errorDuration = await expectNoAccessibilityViolations(page, testInfo, 'public-error-dark-desktop');

  await page.setViewportSize({ width: 390, height: 844 });
  await useTheme(page, 'light');
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Begin with Brands' }).click();
  await page.getByRole('button', { name: 'Use synthetic profile' }).click();
  await page.getByRole('button', { name: 'Load synthetic candidates' }).click();
  await page.getByRole('button', { name: 'Inspect northstar-login.example' }).click();
  await page.locator('.technology-card > summary').click();
  await expect(page.locator('.technology-card')).toHaveAttribute('open', '');
  const expandedDuration = await expectNoAccessibilityViolations(page, testInfo, 'public-populated-expanded-light-mobile');

  expect(initialDuration + errorDuration + expandedDuration).toBeLessThan(15_000);
});

test('scans authenticated desktop and expanded mobile drawer states', async ({ page }, testInfo) => {
  await useTheme(page, 'light');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  const desktopDuration = await expectNoAccessibilityViolations(page, testInfo, 'console-initial-light-desktop');

  await useTheme(page, 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/lookup');
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(page.getByRole('button', { name: 'Close navigation' })).toBeFocused();
  const drawerDuration = await expectNoAccessibilityViolations(page, testInfo, 'console-drawer-dark-mobile');

  expect(desktopDuration + drawerDuration).toBeLessThan(10_000);
});
