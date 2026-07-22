import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, failBrowserLocalManifestWrites, readBrowserLocalCollection } from './helpers';

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
  await page.addInitScript(({ key, stored }) => localStorage.setItem(key, JSON.stringify(stored)), { key: WATCHLIST_KEY, stored: value });
  await page.goto('/monitor');
  await page.getByRole('tab', { name: /Watchlists/ }).click();
}

test('a future watchlist schema is never overwritten by an older app', async ({ page }) => {
  const future = { schema: 'whoisleuth.watchlists', version: 99, watchlists: { Future: entry('future.invalid') }, futureMetadata: { retain: true } };
  await page.addInitScript(({ key, stored }) => localStorage.setItem(key, JSON.stringify(stored)), { key: WATCHLIST_KEY, stored: future });
  await page.goto('/monitor');

  await expect(page.getByRole('heading', { name: 'Browser-local data unavailable' })).toBeVisible();
  await expect(page.getByText('Watchlists was created by a newer app version.')).toBeVisible();
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), WATCHLIST_KEY);
  expect(stored).toEqual(future);
});

test('a watchlist quota failure reports a stable message and preserves the previous store', async ({ page }) => {
  const previous = { schema: 'whoisleuth.watchlists', version: 2, watchlists: { Priority: entry('priority.invalid') } };
  await seed(page, previous);
  await readBrowserLocalCollection(page, 'watchlists', { minimumRecords: 1 });
  await failBrowserLocalManifestWrites(page, 'watchlists');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByRole('status')).toContainText('out of storage space');
  const stored = await readBrowserLocalCollection(page, 'watchlists');
  expect(stored.records.map((entry) => entry.id)).toEqual(['Priority']);
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

test('watchlist history focuses one domain without implying complete coverage', async ({ page }) => {
  const retained = {
    updatedAt: NOW,
    results: [
      { domain: 'priority.invalid', availability: 'registered', scanDepth: 'deep' },
      { domain: 'other.invalid', availability: 'registered', scanDepth: 'fast' },
    ],
    baseline: [],
    history: [
      {
        checkedAt: '2026-07-12T08:00:00.000Z', mode: 'saved', resultCount: 2,
        conclusiveCount: 2, changeCount: 0, omittedChanges: 0, changes: [],
      },
      {
        checkedAt: '2026-07-13T08:00:00.000Z', mode: 'fast', resultCount: 2,
        conclusiveCount: 2, changeCount: 2, omittedChanges: 0, changes: [
          {
            domain: 'priority.invalid', field: 'nameservers', before: ['ns1.old.invalid'],
            after: ['ns1.new.invalid'], kind: 'infrastructure_changed', tone: 'warn',
          },
          {
            domain: 'other.invalid', field: 'availability', before: 'available',
            after: 'registered', kind: 'new_registration', tone: 'danger',
          },
        ],
      },
      {
        checkedAt: NOW, mode: 'deep', resultCount: 2,
        conclusiveCount: 2, changeCount: 2, omittedChanges: 3, changes: [
          {
            domain: 'priority.invalid', field: 'hasMx', before: false,
            after: true, kind: 'mail_activated', tone: 'warn',
          },
          {
            domain: 'priority.invalid', field: 'riskScore', before: 20,
            after: 80, kind: 'high_risk', tone: 'danger',
          },
        ],
      },
    ],
  };
  await seed(page, { Priority: retained });

  await page.getByRole('row', { name: /Priority/ }).getByRole('button', { name: 'History' }).click();
  const history = page.locator('.history');
  await history.getByLabel('History focus').selectOption('priority.invalid');

  const domainHistory = history.locator('.domain-history');
  await expect(domainHistory.getByRole('heading', { name: 'priority.invalid' })).toBeVisible();
  await expect(domainHistory).toContainText('Retained watchlist window');
  await expect(domainHistory).toContainText('Material changes');
  await expect(domainHistory).toContainText('Delegation');
  await expect(domainHistory).toContainText('Mail');
  await expect(domainHistory).toContainText('Risk');
  await expect(domainHistory).not.toContainText('other.invalid');
  await expect(domainHistory).toContainText('does not prove this domain was included in every check');
  await expect(domainHistory).toContainText('cannot be attributed reliably to this domain');

  await page.setViewportSize({ width: 360, height: 740 });
  await expectNoHorizontalOverflow(page);

  await domainHistory.getByRole('button', { name: 'Open case' }).click();
  await expect(page.getByRole('tab', { name: /Cases/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.case.open')).toContainText('priority.invalid');
  await expect(page.getByRole('status')).toContainText('Watchlist history remains separately attributed');
});
