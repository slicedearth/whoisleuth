import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';

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
  const previous = { schema: 'whoisleuth.watchlists', version: 2, watchlists: { Priority: entry('priority.invalid') } };
  await page.goto('/monitor');
  await page.evaluate(({ key, stored }) => localStorage.setItem(key, JSON.stringify(stored)), { key: WATCHLIST_KEY, stored: previous });
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
  expect(stored).toEqual(previous);
});

test('watchlist history filters material changes and hands retained domains back to Bulk', async ({ page }) => {
  const retained = {
    ...entry('priority.invalid'),
    history: [
      {
        checkedAt: '2026-07-13T08:00:00.000Z', mode: 'fast', resultCount: 1,
        conclusiveCount: 1, changeCount: 0, omittedChanges: 0, changes: [],
      },
      {
        checkedAt: NOW, mode: 'deep', resultCount: 1, conclusiveCount: 1,
        changeCount: 1, omittedChanges: 0,
        changes: [{
          domain: 'priority.invalid', field: 'availability', before: 'available',
          after: 'registered', kind: 'changed', tone: 'danger',
        }],
      },
    ],
  };
  await seed(page, { Priority: retained });

  await page.getByRole('row', { name: /Priority/ }).getByRole('button', { name: 'History' }).click();
  const history = page.locator('.history');
  await expect(history.getByRole('heading', { name: 'Priority' })).toBeVisible();
  await expect(history.locator('.events article')).toHaveCount(2);
  await expect(history).toContainText('Availability');
  await history.getByRole('button', { name: 'Material changes only' }).click();
  await expect(history.locator('.events article')).toHaveCount(1);
  await expect(history.getByRole('button', { name: 'Material changes only' })).toHaveAttribute('aria-pressed', 'true');

  await page.setViewportSize({ width: 390, height: 700 });
  await expectNoHorizontalOverflow(page);
  await history.getByRole('button', { name: 'Close' }).click();
  await expect(history).toHaveCount(0);

  await page.getByRole('row', { name: /Priority/ }).getByRole('button', { name: 'Rescan in Bulk' }).click();
  await expect(page).toHaveURL(/\/bulk\?source=watchlist$/);
  await expect(page.getByLabel('Domains')).toHaveValue('priority.invalid');
});
