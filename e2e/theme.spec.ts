import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';

const STORAGE_KEY = 'whoisleuth:theme:v1';

async function chooseTheme(page: import('@playwright/test').Page, label: 'Dark' | 'Light' | 'System') {
  const trigger = page.getByRole('button', { name: 'Colour theme' });
  await trigger.click();
  await page.getByRole('option', { name: label }).click();
}

async function clearThemePreference(page: import('@playwright/test').Page) {
  await page.addInitScript((key) => {
    const sentinel = 'whoisleuth:e2e-theme-initialized';
    if (sessionStorage.getItem(sentinel)) return;
    localStorage.removeItem(key);
    sessionStorage.setItem(sentinel, '1');
  }, STORAGE_KEY);
}

test('dark remains the default and is disclosed by the public selector', async ({ page }) => {
  await clearThemePreference(page);
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark');
  await expect(page.getByRole('button', { name: 'Colour theme' })).toHaveText('Dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0f1115');
  await expect(page.locator('.terminal-preview')).toHaveCSS('background-color', 'rgb(17, 20, 26)');
  await expect(page.locator('.terminal-window-red')).toHaveCSS('background-color', 'rgb(255, 107, 107)');
  await expect(page.locator('.terminal-window-yellow')).toHaveCSS('background-color', 'rgb(242, 184, 75)');
  await expect(page.locator('.terminal-window-green')).toHaveCSS('background-color', 'rgb(126, 224, 168)');

  const navFontSizes = await page.locator('.public-header').evaluate((header) => ({
    navigation: getComputedStyle(header.querySelector('a[href="/demo"]')!).fontSize,
    themeLabel: getComputedStyle(header.querySelector('.theme-selector > span')!).fontSize,
  }));
  expect(navFontSizes.themeLabel).toBe(navFontSizes.navigation);
});

test('light preference applies before reload and persists across public pages', async ({ page }) => {
  await clearThemePreference(page);
  await page.goto('/');

  await chooseTheme(page, 'Light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#edf2f7');
  await expect(page.locator('.terminal-preview')).toHaveCSS('background-color', 'rgb(245, 248, 251)');
  await expect(page.locator('.terminal-window-red')).toHaveCSS('background-color', 'rgb(255, 107, 107)');
  await expect(page.locator('.terminal-window-yellow')).toHaveCSS('background-color', 'rgb(242, 184, 75)');
  await expect(page.locator('.terminal-window-green')).toHaveCSS('background-color', 'rgb(126, 224, 168)');
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe('light');

  await page.goto('/demo');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Colour theme' })).toHaveText('Light');
});

test('system preference follows operating-system colour-scheme changes', async ({ page }) => {
  await clearThemePreference(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await chooseTheme(page, 'System');

  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('a theme still applies to the current tab when persistent storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, 'getItem', { configurable: true, value: () => { throw new Error('blocked'); } });
    Object.defineProperty(Storage.prototype, 'setItem', { configurable: true, value: () => { throw new Error('blocked'); } });
  });
  await page.goto('/');

  await chooseTheme(page, 'Light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('status')).toContainText('Theme applies to this tab only');
});

test('the authenticated console reuses the same persisted selector', async ({ page }) => {
  await clearThemePreference(page);
  await page.goto('/dashboard');

  await chooseTheme(page, 'Light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Colour theme' })).toHaveText('Light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('theme controls do not create horizontal overflow on narrow public and console layouts', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await clearThemePreference(page);
  await page.goto('/');
  await expectNoHorizontalOverflow(page);

  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(page.getByRole('button', { name: 'Colour theme' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('the mobile option list is anchored directly beneath its trigger', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await clearThemePreference(page);
  await page.goto('/');

  const trigger = page.getByRole('button', { name: 'Colour theme' });
  await trigger.click();
  const options = page.getByRole('listbox', { name: 'Colour theme options' });
  const triggerBox = await trigger.boundingBox();
  const optionsBox = await options.boundingBox();

  expect(triggerBox).not.toBeNull();
  expect(optionsBox).not.toBeNull();
  expect(Math.abs(optionsBox!.x - triggerBox!.x)).toBeLessThan(1);
  expect(optionsBox!.y).toBeGreaterThanOrEqual(triggerBox!.y + triggerBox!.height + 5);
  await expectNoHorizontalOverflow(page);
});
