import { expect, test } from './fixtures';
import { readBrowserLocalCollection } from './helpers';

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
  await page.addInitScript(({ key, stored }) => localStorage.setItem(key, JSON.stringify(stored)), { key: SHORTLIST_KEY, stored: value });
  await page.goto('/bulk');
}

test('a future shortlist schema is never overwritten by an older app', async ({ page }) => {
  const future = { schema: 'whoisleuth.shortlist', version: 99, entries: [record('future.invalid')], futureMetadata: { retain: true } };
  await seed(page, future);

  await expect(page.getByRole('heading', { name: 'Browser-local data unavailable' })).toBeVisible();
  await expect(page.getByText('Shortlist was created by a newer app version.')).toBeVisible();
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), SHORTLIST_KEY);
  expect(stored).toEqual(future);
});

test('a shortlist quota failure reports a stable message and preserves the previous store', async ({ page }) => {
  const previous = { schema: 'whoisleuth.shortlist', version: 2, entries: [record('priority.invalid')] };
  await seed(page, previous);
  await readBrowserLocalCollection(page, 'shortlist', { minimumRecords: 1 });
  await page.evaluate(() => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'manifests') throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      return originalPut.call(this, value, key);
    };
  });

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Clear shortlist' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'out of storage space' })).toBeVisible();
  const stored = await readBrowserLocalCollection(page, 'shortlist');
  expect(stored.records.map((entry) => entry.value.domain)).toEqual(['priority.invalid']);
});
