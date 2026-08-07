import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';

const STORAGE_KEY = 'whoisleuth:theme:v1';

async function chooseTheme(page: import('@playwright/test').Page, label: 'Dark' | 'Light' | 'System') {
  const trigger = page.getByRole('button', { name: /^Colour theme,/ });
  await trigger.click();
  await page.getByRole('option', { name: `${label} theme` }).click();
}

async function clearThemePreference(page: import('@playwright/test').Page) {
  await page.addInitScript((key) => {
    const sentinel = 'whoisleuth:e2e-theme-initialized';
    if (sessionStorage.getItem(sentinel)) return;
    localStorage.removeItem(key);
    sessionStorage.setItem(sentinel, '1');
  }, STORAGE_KEY);
}

test('the default system preference follows the operating-system colour scheme', async ({ page }) => {
  await clearThemePreference(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
  const trigger = page.getByRole('button', { name: 'Colour theme, System selected' });
  await expect(trigger).toHaveAttribute('title', 'System theme');
  await expect(trigger.locator('.theme-trigger-label')).toHaveText('Theme');
  await expect(trigger.locator('[data-theme-symbol="system"]')).toBeVisible();
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f6f9ff');
  await expect(page.locator('.hero-preview .lookup-panel')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('.hero-preview .preview-note')).toHaveCSS('color', 'rgb(51, 75, 100)');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(246, 249, 255)');
  await expect(page.locator('.hero-preview .lookup-panel')).toHaveCSS('border-color', 'rgb(123, 146, 170)');

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0f1115');
  await expect(page.locator('.hero-preview .lookup-panel')).toHaveCSS('background-color', 'rgb(23, 26, 33)');
  await expect(page.locator('.hero-preview .preview-note')).toHaveCSS('color', 'rgb(139, 147, 167)');

  const navFontSizes = await page.locator('.public-header').evaluate((header) => ({
    navigation: getComputedStyle(header.querySelector('a[href="/demo"]')!).fontSize,
    themeLabel: getComputedStyle(header.querySelector('.theme-trigger-label')!).fontSize,
  }));
  expect(navFontSizes.themeLabel).toBe(navFontSizes.navigation);
});

test('light preference applies before reload and persists across public pages', async ({ page }) => {
  await clearThemePreference(page);
  await page.goto('/');

  await chooseTheme(page, 'Light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f6f9ff');
  await expect(page.locator('.hero-preview .lookup-panel')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe('light');

  await page.goto('/demo');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const trigger = page.getByRole('button', { name: 'Colour theme, Light selected' });
  await expect(trigger.locator('[data-theme-symbol="light"]')).toBeVisible();
  await expect(trigger).not.toContainText('Light');
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

test('the theme trigger controls only a rendered option list', async ({ page }) => {
  await clearThemePreference(page);
  await page.goto('/');

  const trigger = page.getByRole('button', { name: /^Colour theme,/ });
  await expect(trigger).not.toHaveAttribute('aria-controls');
  await expect(page.locator('#colour-theme-options')).toHaveCount(0);

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-controls', 'colour-theme-options');
  await expect(page.locator('#colour-theme-options')).toBeVisible();

  await page.getByRole('option', { name: 'System theme' }).click();
  await expect(trigger).not.toHaveAttribute('aria-controls');
  await expect(page.locator('#colour-theme-options')).toHaveCount(0);
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
  await expect(page.getByRole('button', { name: 'Colour theme, Light selected' }).locator('[data-theme-symbol="light"]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('theme controls fit beside authenticated public navigation across common phone widths', async ({ page }) => {
  await clearThemePreference(page);
  for (const width of [320, 360, 375, 390, 412, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

    const publicNavigation = page.getByRole('navigation', { name: 'Public navigation' });
    const publicBrand = page.locator('.public-brand');
    const demoLink = publicNavigation.locator('a[href="/demo"]');
    const theme = publicNavigation.locator('.theme-selector');
    const trigger = publicNavigation.getByRole('button', { name: /^Colour theme,/ });
    const consoleLink = publicNavigation.getByRole('link', { name: 'Open console' });
    const signOut = publicNavigation.getByRole('button', { name: 'Sign out' });
    const [brandBox, navigationBox, demoBox, themeBox, triggerBox, consoleBox, signOutBox] = await Promise.all([
      publicBrand.boundingBox(),
      publicNavigation.boundingBox(),
      demoLink.boundingBox(),
      theme.boundingBox(),
      trigger.boundingBox(),
      consoleLink.boundingBox(),
      signOut.boundingBox(),
    ]);

    expect(brandBox).not.toBeNull();
    expect(navigationBox).not.toBeNull();
    if (width > 330) expect(demoBox).not.toBeNull();
    else expect(demoBox).toBeNull();
    expect(themeBox).not.toBeNull();
    expect(triggerBox).not.toBeNull();
    expect(consoleBox).not.toBeNull();
    expect(signOutBox).not.toBeNull();
    expect(navigationBox!.x - (brandBox!.x + brandBox!.width)).toBeGreaterThanOrEqual(2);
    if (demoBox) expect(demoBox.x - (brandBox!.x + brandBox!.width)).toBeGreaterThanOrEqual(2);
    expect(consoleBox!.x - (triggerBox!.x + triggerBox!.width)).toBeGreaterThanOrEqual(5);
    expect(consoleBox!.x - (themeBox!.x + themeBox!.width)).toBeGreaterThanOrEqual(5);
    expect(signOutBox!.x - (consoleBox!.x + consoleBox!.width)).toBeGreaterThanOrEqual(5);
    expect(signOutBox!.x + signOutBox!.width).toBeLessThanOrEqual(width);
    const [themeFontSize, consoleFontSize, signOutFontSize] = await Promise.all([
      trigger.evaluate((element) => getComputedStyle(element).fontSize),
      consoleLink.evaluate((element) => getComputedStyle(element).fontSize),
      signOut.evaluate((element) => getComputedStyle(element).fontSize),
    ]);
    const themeSymbolSize = await trigger.locator('.theme-symbol').evaluate(
      (element) => parseFloat(getComputedStyle(element).width),
    );
    expect(themeFontSize).toBe(consoleFontSize);
    expect(themeFontSize).toBe(signOutFontSize);
    expect(themeSymbolSize).toBeLessThanOrEqual(16);
    await expectNoHorizontalOverflow(page);
  }

  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(page.getByRole('button', { name: /^Colour theme,/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('the mobile option list is anchored directly beneath its trigger', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await clearThemePreference(page);
  await page.goto('/');

  const trigger = page.getByRole('button', { name: /^Colour theme,/ });
  await expect(trigger.locator('.theme-trigger-label')).toHaveText('Theme');
  await expect(trigger.locator('.theme-trigger-label')).toBeVisible();
  await trigger.click();
  const options = page.getByRole('listbox', { name: 'Colour theme options' });
  const triggerBox = await trigger.boundingBox();
  const optionsBox = await options.boundingBox();

  expect(triggerBox).not.toBeNull();
  expect(optionsBox).not.toBeNull();
  expect(Math.abs(optionsBox!.x - triggerBox!.x)).toBeLessThan(1);
  expect(Math.abs(optionsBox!.width - triggerBox!.width)).toBeLessThan(1);
  expect(optionsBox!.y).toBeGreaterThanOrEqual(triggerBox!.y + triggerBox!.height + 5);
  expect(await options.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await expectNoHorizontalOverflow(page);
});
