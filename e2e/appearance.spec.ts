import { expect, test } from './fixtures';
import type { Route } from '@playwright/test';
import { expectNoHorizontalOverflow, useTheme } from './helpers';

test('reading preferences persist without touching saved work and synchronise between tabs', async ({ page }) => {
  await page.goto('/resources');
  const trigger = page.getByRole('button', { name: /^Colour theme,/u });
  await trigger.click();
  await page.getByLabel('Reading density').selectOption('compact');
  await page.getByLabel('Decorative effects').uncheck();
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await expect(page.locator('html')).toHaveAttribute('data-effects', 'minimal');
  await page.getByLabel('Reading density').press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Appearance' })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await expect(page.locator('html')).toHaveAttribute('data-effects', 'minimal');
  const other = await page.context().newPage();
  try {
    await other.goto('/cli');
    await expect(other.locator('html')).toHaveAttribute('data-density', 'compact');
    await trigger.click();
    await page.getByLabel('Reading density').selectOption('comfortable');
    await expect(other.locator('html')).toHaveAttribute('data-density', 'comfortable');
    expect(await page.evaluate(() => localStorage.getItem('whoisleuth:appearance:v1'))).toBe('comfortable:minimal');
  } finally { await other.close(); }
});

test('the blocking appearance initialiser works before application hydration', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('whoisleuth:appearance:v1', 'compact:minimal');
    localStorage.setItem('whoisleuth:theme:v1', 'light');
  });
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  const pattern = '**/_app/immutable/**/*.js';
  const holdScript = async (route: Route) => { await held; await route.fallback(); };
  await page.route(pattern, holdScript);
  try {
    await page.goto('/resources', { waitUntil: 'commit' });
    await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
    await expect(page.locator('html')).toHaveAttribute('data-effects', 'minimal');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('heading', { name: 'Guides for common investigation tasks', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Colour theme, System selected' })).toBeVisible();
  } finally { release(); }
  await expect(page.getByRole('button', { name: 'Colour theme, Light selected' })).toBeVisible();
  await page.unroute(pattern, holdScript);
});

test('appearance controls remain usable at narrow and wide widths in both themes', async ({ page }, testInfo) => {
  await page.goto('/resources');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 1920, 2560, 3840]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      const trigger = page.getByRole('button', { name: /^Colour theme,/u });
      await trigger.click();
      const panel = page.getByRole('dialog', { name: 'Appearance' });
      await expect(panel).toBeVisible();
      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await expect(page.getByLabel('Reading density')).toBeInViewport();
      await expect(page.getByLabel('Decorative effects')).toBeInViewport();
      await expectNoHorizontalOverflow(page);
      if (width === 390 || width === 1920) await page.screenshot({ path: testInfo.outputPath(`appearance-${theme}-${width}.png`) });
      await page.getByLabel('Reading density').press('Escape');
      await expect(trigger).toBeFocused();
    }
  }
});
