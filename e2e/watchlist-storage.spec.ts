import { expect, test } from './fixtures';

const WATCHLIST_KEY = 'whois-rdap-watchlist-v1';
const NOW = '2026-07-14T08:00:00.000Z';

function entry(domain: string) {
  return {
    updatedAt: NOW,
    results: [{ domain, availability: 'registered', scanDepth: 'fast', mutationTypes: ['omission'] }],
    baseline: [],
    history: [],
  };
}

async function seed(page: import('@playwright/test').Page, value: unknown) {
  await page.goto('/monitor');
  await page.evaluate(({ key, stored }) => localStorage.setItem(key, JSON.stringify(stored)), { key: WATCHLIST_KEY, stored: value });
  await page.reload();
  await page.getByRole('tab', { name: /Watchlists/ }).click();
}

test('a legacy watchlist map remains usable and migrates only after an explicit mutation', async ({ page }) => {
  const legacy = { Keep: entry('keep.invalid'), Remove: entry('remove.invalid') };
  await seed(page, legacy);
  await expect(page.getByRole('cell', { name: 'Keep', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Remove', exact: true })).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('row', { name: /Remove/ }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('status')).toContainText('Deleted "Remove"');
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), WATCHLIST_KEY);
  expect(stored.version).toBe(2);
  expect(stored.watchlists.Keep.results[0].domain).toBe('keep.invalid');
  expect(stored.watchlists.Remove).toBeUndefined();
});

test('a future watchlist schema is never overwritten by an older app', async ({ page }) => {
  const future = { schema: 'whoisleuth.watchlists', version: 99, watchlists: { Future: entry('future.invalid') }, futureMetadata: { retain: true } };
  await seed(page, future);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByRole('status')).toContainText('newer app version');
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), WATCHLIST_KEY);
  expect(stored).toEqual(future);
});

test('a watchlist quota failure reports a stable message and preserves the previous store', async ({ page }) => {
  const legacy = { Priority: entry('priority.invalid') };
  await page.goto('/monitor');
  await page.evaluate(({ key, stored }) => localStorage.setItem(key, JSON.stringify(stored)), { key: WATCHLIST_KEY, stored: legacy });
  await page.addInitScript((watchlistKey) => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === watchlistKey) throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      return originalSetItem.call(this, key, value);
    };
  }, WATCHLIST_KEY);
  await page.reload();
  await page.getByRole('tab', { name: /Watchlists/ }).click();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByRole('status')).toContainText('Browser storage may be full or unavailable');
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), WATCHLIST_KEY);
  expect(stored).toEqual(legacy);
});
