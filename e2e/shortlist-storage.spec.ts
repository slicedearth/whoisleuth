import { expect, test } from './fixtures';

const SHORTLIST_KEY = 'whois-rdap-shortlist-v1';
const NOW = '2026-07-14T08:00:00.000Z';

function record(domain: string) {
  return {
    domain,
    scanDepth: 'fast',
    availability: 'registered',
    riskModelVersion: 5,
    riskScore: 40,
    opportunityScore: 20,
    mutationTypes: ['omission'],
    savedAt: NOW,
  };
}

async function seed(page: import('@playwright/test').Page, value: unknown) {
  await page.goto('/bulk');
  await page.evaluate(({ key, stored }) => localStorage.setItem(key, JSON.stringify(stored)), { key: SHORTLIST_KEY, stored: value });
  await page.reload();
}

test('a legacy shortlist remains readable and migrates only after an explicit mutation', async ({ page }) => {
  await seed(page, [record('keep.invalid')]);
  await expect(page.getByRole('heading', { name: 'Shortlist · 1' })).toBeVisible();
  await expect(page.getByText('keep.invalid', { exact: true })).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Clear shortlist' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Shortlist cleared' })).toBeVisible();
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), SHORTLIST_KEY);
  expect(stored.schema).toBe('whoisleuth.shortlist');
  expect(stored.version).toBe(2);
  expect(stored.entries).toEqual([]);
});

test('a future shortlist schema is never overwritten by an older app', async ({ page }) => {
  const future = { schema: 'whoisleuth.shortlist', version: 99, entries: [record('future.invalid')], futureMetadata: { retain: true } };
  await seed(page, future);

  await page.getByRole('button', { name: 'Export JSON' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'newer app version' })).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Clear shortlist' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'newer app version' })).toBeVisible();
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), SHORTLIST_KEY);
  expect(stored).toEqual(future);
});

test('a shortlist quota failure reports a stable message and preserves the previous store', async ({ page }) => {
  const legacy = [record('priority.invalid')];
  await page.goto('/bulk');
  await page.evaluate(({ key, stored }) => localStorage.setItem(key, JSON.stringify(stored)), { key: SHORTLIST_KEY, stored: legacy });
  await page.addInitScript((shortlistKey) => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === shortlistKey) throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      return originalSetItem.call(this, key, value);
    };
  }, SHORTLIST_KEY);
  await page.reload();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Clear shortlist' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Browser storage may be full or unavailable' })).toBeVisible();
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), SHORTLIST_KEY);
  expect(stored).toEqual(legacy);
});
