import { expect, test } from './fixtures';
import { boundingBox, expectNoHorizontalOverflow } from './helpers';

const VIEWPORTS = [
  { label: '320x640', width: 320, height: 640 },
  { label: '390x568', width: 390, height: 568 },
  { label: '390x844', width: 390, height: 844 },
];

// The CSS floor for the drawer's protected browser-chrome/safe-area region
// (see app.css: `padding-bottom: max(74px, calc(env(safe-area-inset-bottom)
// + 24px))`). In a desktop-Chromium test run env(safe-area-inset-bottom) is
// always 0. The assertion keeps a 72px contractual floor while the extra CSS
// allowance absorbs subpixel device scaling; if the padding regressed to just
// the 24px term (or was dropped entirely), this would catch it.
const MIN_SAFE_AREA_PX = 72;

for (const viewport of VIEWPORTS) {
  test.describe(`mobile navigation @ ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('header keeps sign out accessible while the drawer opens without overflow', async ({ page }) => {
      await page.goto('/lookup');

      // Exactly one visible WHOISleuth logo/title (the header's, not the
      // drawer's - aside .brand is display:none below 900px) so there's only
      // ever one cursor treatment on screen at once. Wait for the
      // authenticated shell before counting so this assertion cannot race the
      // client-side session check after navigation.
      await expect(page.locator('.shell > header strong', { hasText: 'WHOISleuth' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'WHOISleuth Dashboard' })).toHaveAttribute('href', '/dashboard');
      const visibleBrandCount = await page
        .locator('strong', { hasText: 'WHOISleuth' })
        .evaluateAll((els) => els.filter((el) => (el as HTMLElement).offsetParent !== null).length);
      expect(visibleBrandCount).toBe(1);

      const header = page.locator('.shell > header');
      const signOutButton = header.getByRole('button', { name: 'Sign out' });
      await expect(signOutButton).toBeVisible();
      await expect(signOutButton).toBeEnabled();
      await expect(signOutButton).toHaveCSS('white-space', 'nowrap');
      await expect(page.locator('#console-navigation').getByRole('button', { name: 'Sign out' })).toHaveCount(0);

      const shell = page.locator('.shell');
      const toggle = page.locator('.navigation-toggle');
      await expect(toggle).toHaveAttribute('aria-label', 'Toggle navigation');
      const drawer = page.locator('#console-navigation');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(shell).not.toHaveClass(/open/);
      await expect(drawer).toHaveCSS('visibility', 'hidden');

      await toggle.focus();
      for (let index = 0; index < 12; index += 1) {
        await page.keyboard.press('Tab');
        expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(false);
      }

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(shell).toHaveClass(/open/);
      await expect(drawer).toHaveCSS('visibility', 'visible');
      await expect(page.locator('#main-content')).toHaveAttribute('inert', '');

      const closeButton = drawer.getByRole('button', { name: 'Close navigation' });
      await expect(closeButton).toBeFocused();

      const lastDrawerControl = drawer.locator('a[href], button:not([disabled])').last();
      const headerBrand = page.locator('.shell > header > a');
      await lastDrawerControl.focus();
      await page.keyboard.press('Tab');
      await expect(headerBrand).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(lastDrawerControl).toBeFocused();

      const drawerBox = await boundingBox(drawer);
      // Fits the dynamic viewport height and scrolls internally rather than
      // pushing content (or itself) past the bottom edge.
      expect(drawerBox.height).toBeLessThanOrEqual(viewport.height + 1);
      await expect(drawer).toHaveCSS('overflow-y', 'auto');

      // The drawer must reserve the full protected-chrome region at its own
      // bottom edge, not just happen to have its actions end above the fold.
      const paddingBottom = await drawer.evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
      expect(paddingBottom).toBeGreaterThanOrEqual(MIN_SAFE_AREA_PX);

      await expect(page.locator('a[href="/privacy"]')).toHaveCount(1);
      await expect(page.getByRole('link', { name: 'Privacy' })).toHaveCount(0);

      // hover() performs the same occlusion/actionability checks Playwright
      // runs before a click, proving this is a real, unobstructed pointer
      // target rather than just a present-but-covered DOM node.
      await signOutButton.hover();

      const signOutBox = await boundingBox(signOutButton);
      expect(signOutBox.width).toBeGreaterThan(0);
      expect(signOutBox.height).toBeGreaterThan(0);
      const headerBox = await boundingBox(header);
      expect(signOutBox.y).toBeGreaterThanOrEqual(headerBox.y);
      expect(signOutBox.y + signOutBox.height).toBeLessThanOrEqual(headerBox.y + headerBox.height + 1);

      await expectNoHorizontalOverflow(page);

    });

  });
}

test('the desktop header keeps sign out reachable while the sidebar scrolls independently', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 560 });
  await page.goto('/lookup');

  const sidebar = page.locator('#console-navigation');
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveCSS('overflow-y', 'auto');
  expect(await sidebar.evaluate((element) => element.scrollHeight)).toBeGreaterThan(
    await sidebar.evaluate((element) => element.clientHeight),
  );

  const header = page.locator('.shell > header');
  const signOutButton = header.getByRole('button', { name: 'Sign out' });
  await expect(signOutButton).toBeVisible();
  await expect(signOutButton).toBeEnabled();
  await expect(sidebar.getByRole('button', { name: 'Sign out' })).toHaveCount(0);

  const headerBox = await boundingBox(header);
  const signOutBox = await boundingBox(signOutButton);
  expect(signOutBox.y).toBeGreaterThanOrEqual(headerBox.y);
  expect(signOutBox.y + signOutBox.height).toBeLessThanOrEqual(headerBox.y + headerBox.height + 1);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const scrolledHeaderBox = await boundingBox(header);
  const scrolledSignOutBox = await boundingBox(signOutButton);
  expect(scrolledHeaderBox.y).toBe(0);
  expect(scrolledSignOutBox.y).toBeGreaterThanOrEqual(scrolledHeaderBox.y);
  expect(scrolledSignOutBox.y + scrolledSignOutBox.height).toBeLessThanOrEqual(scrolledHeaderBox.y + scrolledHeaderBox.height + 1);
  await expectNoHorizontalOverflow(page);
});

test('closing the mobile drawer updates aria-expanded, and the footer exposes legal links', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/lookup');

  const shell = page.locator('.shell');
  const toggle = page.locator('.navigation-toggle');
  await expect(toggle).toHaveAttribute('aria-label', 'Toggle navigation');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(shell).toHaveClass(/open/);

  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(shell).not.toHaveClass(/open/);
  await expect(toggle).toBeFocused();
  await expect(page.locator('#main-content')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#console-navigation')).toHaveCSS('visibility', 'hidden');

  const footer = page.locator('footer.site-footer');
  await expect(footer).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
  await expect(footer.getByRole('link', { name: 'Source and licence' })).toHaveAttribute('href', 'https://github.com/slicedearth/whoisleuth');
  await expectNoHorizontalOverflow(page);
});
