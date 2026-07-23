import { expect, test } from './fixtures';
import { boundingBox, expectNoHorizontalOverflow, useTheme } from './helpers';

test('public pages expose a first-focusable skip link in the dark desktop theme', async ({ page }) => {
  await useTheme(page, 'dark');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  const main = page.locator('#main-content');
  const hiddenBox = await boundingBox(skipLink);
  expect(hiddenBox.y + hiddenBox.height).toBeLessThanOrEqual(0);

  await page.keyboard.press('Tab');
  await expect(skipLink).toBeFocused();
  await expect.poll(async () => (await skipLink.boundingBox())?.y ?? -1, {
    message: 'waiting for the focused skip link to finish entering the viewport',
  }).toBeGreaterThanOrEqual(0);
  const focusedBox = await boundingBox(skipLink);
  expect(focusedBox.y).toBeGreaterThanOrEqual(0);
  expect(focusedBox.x).toBeGreaterThanOrEqual(0);
  await expect(skipLink).toHaveCSS('background-color', 'rgb(23, 26, 33)');

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main-content$/u);
  await expect(main).toBeFocused();
  await expect(main).toBeInViewport();
  await expectNoHorizontalOverflow(page);
});

test('Console pages expose the same skip target in the light mobile theme', async ({ page }) => {
  await useTheme(page, 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/lookup');
  await expect(page.locator('.shell')).toBeVisible();

  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  const main = page.locator('#main-content');
  await page.keyboard.press('Tab');
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toHaveCSS('background-color', 'rgb(255, 255, 255)');

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main-content$/u);
  await expect(main).toBeFocused();
  await expect(main).not.toHaveAttribute('inert', '');
  await expect(page.getByRole('button', { name: 'Toggle navigation' })).toHaveAttribute('aria-expanded', 'false');
  await expectNoHorizontalOverflow(page);
});

test('skip navigation removes its reveal transition when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skipLink).toHaveCSS('transition-property', 'none');
  await page.keyboard.press('Tab');
  await expect(skipLink).toBeFocused();
  const focusedBox = await boundingBox(skipLink);
  expect(focusedBox.y).toBeGreaterThanOrEqual(0);
});
