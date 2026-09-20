import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { migrateLegacyBrowserData, expectNoHorizontalOverflow, useTheme } from './helpers';
import { currentCaseFixture, currentCaseCollection } from '../test/support/current-case.mts';

const viewports = [[320, 700], [390, 844], [768, 1024], [1024, 768], [1280, 720], [1920, 1080], [2560, 1440]] as const;

for (const destination of ['/dashboard', '/lookup', '/bulk', '/monitor', '/brands', '/cases?case=case-example']) {
  test(`console reading hierarchy remains usable across densities and layouts: ${destination}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.clock.setFixedTime('2026-09-13T10:00:00.000Z');
    await migrateLegacyBrowserData(page, {
      'whois-rdap-cases-v1': currentCaseCollection([currentCaseFixture()]),
    }, { destination, clearStorage: true });
    const heading = page.locator('main h1');
    await expect(heading).toBeVisible();
    if (destination.startsWith('/cases?')) {
      await expect(page.getByRole('navigation', { name: 'Case sections', exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Case evidence, reasoning and actions', exact: true })).toBeVisible();
    } else await expect(page.locator('.shell .card').first()).toBeVisible();
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      for (const [width, height] of viewports) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => { document.documentElement.dataset.density = 'comfortable'; window.scrollTo(0, 0); });
        const comfortable = await heading.evaluate(element => {
          const style = getComputedStyle(element);
          return { fontSize: style.fontSize, family: style.fontFamily };
        });
        await page.evaluate(() => { document.documentElement.dataset.density = 'compact'; });
        await expect(heading).toHaveCSS('font-size', comfortable.fontSize);
        await expect(heading).toHaveCSS('font-family', comfortable.family);
        // Density changes space, not the size of labels or reading text.
        const sizes = await page.evaluate(() => {
          const root = document.documentElement;
          const measured = () => ['--text-2xs', '--text-xs', '--text-sm', '--text-md'].map(name => getComputedStyle(root).getPropertyValue(name));
          const compact = measured(); root.dataset.density = 'comfortable';
          const comfortable = measured(); root.dataset.density = 'compact';
          return { compact, comfortable };
        });
        expect(sizes.compact).toEqual(sizes.comfortable);
        await expectNoHorizontalOverflow(page);
        const box = await heading.boundingBox();
        const toolbar = await page.locator('.shell > header').boundingBox();
        expect(box && toolbar && box.y >= toolbar.y + toolbar.height).toBe(true);
        for (const card of await page.locator('.shell .card:visible').all()) {
          await expect(card).toHaveCSS('box-shadow', 'none');
        }
        await page.screenshot({ path: testInfo.outputPath(`console-${theme}-${width}.png`), animations: 'disabled' });
        if (width === 320 || width === 1280) {
          expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
        }
      }
    }
    await page.evaluate(() => { document.documentElement.dataset.density = 'comfortable'; });
  });
}
