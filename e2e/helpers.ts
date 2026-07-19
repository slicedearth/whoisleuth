import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

// A few px of tolerance for subpixel layout rounding across engines.
const OVERFLOW_TOLERANCE_PX = 1;
const THEME_STORAGE_KEY = 'whoisleuth:theme:v1';

export async function useTheme(page: Page, preference: 'dark' | 'light' | 'system') {
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, value);
  }, { key: THEME_STORAGE_KEY, value: preference });
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + OVERFLOW_TOLERANCE_PX);
}

export async function boundingBox(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box, 'expected element to have a rendered bounding box').not.toBeNull();
  return box!;
}

// Computed content of a pseudo-element - used to check the CSS-only
// data-label treatment that only applies to Bulk's stacked mobile cards.
export async function pseudoContent(locator: Locator, pseudo: '::before' | '::after') {
  return locator.evaluate((el, p) => window.getComputedStyle(el, p).content, pseudo);
}

// Fills Bulk's domain queue and runs it to completion. Shared by every Bulk
// spec that needs a finished scan rather than just the empty queue state.
export async function runBulkScan(page: Page, domains: string[]) {
  await page.locator('#domains').fill(domains.join('\n'));
  await page.getByRole('button', { name: `Scan ${domains.length} domain${domains.length === 1 ? '' : 's'}` }).click();
  await expect(page.locator('.status')).toHaveText(`Completed ${domains.length} of ${domains.length} lookups.`, {
    timeout: 20_000,
  });
}
