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

    test('drawer opens with real, safely-placed hit targets and no overflow', async ({ page }) => {
      await page.goto('/');

      // Exactly one visible WHOISleuth logo/title (the header's, not the
      // drawer's - aside .brand is display:none below 900px) so there's only
      // ever one cursor-blink treatment on screen at once.
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

      const privacyLink = drawer.getByRole('link', { name: 'Privacy' });
      const signOutButton = drawer.getByRole('button', { name: 'Sign out' });
      await expect(privacyLink).toBeVisible();
      await expect(signOutButton).toBeVisible();
      await expect(signOutButton).toBeEnabled();

      // hover() performs the same occlusion/actionability checks Playwright
      // runs before a click, proving these are real, unobstructed pointer
      // targets rather than just present-but-covered DOM nodes.
      await privacyLink.hover();
      await signOutButton.hover();

      const privacyBox = await boundingBox(privacyLink);
      const signOutBox = await boundingBox(signOutButton);
      for (const box of [privacyBox, signOutBox]) {
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);
        // At least the full protected-chrome region of clearance from the
        // viewport bottom - not merely "somewhere above the fold". This
        // fails if the 72px reservation shrinks or disappears, even though
        // the action would still technically render on screen.
        const clearance = viewport.height - (box.y + box.height);
        expect(clearance).toBeGreaterThanOrEqual(MIN_SAFE_AREA_PX);
      }

      await expectNoHorizontalOverflow(page);

      await privacyLink.click();
      await expect(page).toHaveURL(/\/privacy$/);
      await expect(page.getByRole('heading', { name: 'Privacy policy' })).toBeVisible();
    });

    test('closing the drawer updates aria-expanded, and the footer links to Privacy', async ({ page }) => {
      await page.goto('/');

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
  });
}
