import { expect, test } from './fixtures';
import { boundingBox, expectNoHorizontalOverflow } from './helpers';

const VIEWPORTS = [
  { label: '390x568', width: 390, height: 568 },
  { label: '390x844', width: 390, height: 844 },
];

// The CSS floor for the drawer's protected browser-chrome/safe-area region
// (see app.css: `padding-bottom: max(72px, calc(env(safe-area-inset-bottom)
// + 24px))`). In a desktop-Chromium test run env(safe-area-inset-bottom) is
// always 0, so this 72px floor is exactly the value that must hold - if the
// padding rule regressed to just the 24px term (or was dropped entirely),
// this would catch it.
const MIN_SAFE_AREA_PX = 72;

for (const viewport of VIEWPORTS) {
  test.describe(`mobile navigation @ ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('drawer opens with a safely-placed session action and no overflow', async ({ page }) => {
      await page.goto('/lookup');

      // Exactly one visible WHOISleuth logo/title (the header's, not the
      // drawer's - aside .brand is display:none below 900px) so there's only
      // ever one cursor-blink treatment on screen at once. Wait for the
      // authenticated shell before counting so this assertion cannot race the
      // client-side session check after navigation.
      await expect(page.locator('.shell > header strong', { hasText: 'WHOISleuth' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'WHOISleuth dashboard' })).toHaveAttribute('href', '/dashboard');
      const visibleBrandCount = await page
        .locator('strong', { hasText: 'WHOISleuth' })
        .evaluateAll((els) => els.filter((el) => (el as HTMLElement).offsetParent !== null).length);
      expect(visibleBrandCount).toBe(1);

      const shell = page.locator('.shell');
      const toggle = page.getByRole('button', { name: 'Toggle navigation' });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(shell).not.toHaveClass(/open/);

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(shell).toHaveClass(/open/);

      const drawer = page.locator('#workspace-navigation');
      const drawerBox = await boundingBox(drawer);
      // Fits the dynamic viewport height and scrolls internally rather than
      // pushing content (or itself) past the bottom edge.
      expect(drawerBox.height).toBeLessThanOrEqual(viewport.height + 1);
      await expect(drawer).toHaveCSS('overflow-y', 'auto');

      // The drawer must reserve the full protected-chrome region at its own
      // bottom edge, not just happen to have its actions end above the fold.
      const paddingBottom = await drawer.evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
      expect(paddingBottom).toBeGreaterThanOrEqual(MIN_SAFE_AREA_PX);

      const signOutButton = drawer.getByRole('button', { name: 'Sign out' });
      await expect(signOutButton).toBeVisible();
      await expect(signOutButton).toBeEnabled();
      await expect(signOutButton).toHaveCSS('white-space', 'nowrap');
      await expect(page.getByRole('link', { name: 'Privacy' })).toHaveCount(1);

      // hover() performs the same occlusion/actionability checks Playwright
      // runs before a click, proving this is a real, unobstructed pointer
      // target rather than just a present-but-covered DOM node.
      await signOutButton.hover();

      const signOutBox = await boundingBox(signOutButton);
      expect(signOutBox.width).toBeGreaterThan(0);
      expect(signOutBox.height).toBeGreaterThan(0);
      // At least the full protected-chrome region of clearance from the
      // viewport bottom - not merely "somewhere above the fold". This
      // fails if the 72px reservation shrinks or disappears, even though
      // the action would still technically render on screen.
      const clearance = viewport.height - (signOutBox.y + signOutBox.height);
      expect(clearance).toBeGreaterThanOrEqual(MIN_SAFE_AREA_PX);

      await expectNoHorizontalOverflow(page);

    });

  });
}

test('closing the mobile drawer updates aria-expanded, and the footer links to Privacy', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/lookup');

  const shell = page.locator('.shell');
  const toggle = page.getByRole('button', { name: 'Toggle navigation' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(shell).toHaveClass(/open/);

  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(shell).not.toHaveClass(/open/);

  const footer = page.locator('footer.site-footer');
  await expect(footer).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
  await expectNoHorizontalOverflow(page);
});
