import { openConsoleView } from './console-navigation';
import { expect, test } from './fixtures';
import { currentBrowserLocalDocument, expectNoHorizontalOverflow, failBrowserLocalManifestWrites, failNextBrowserLocalCollectionReadAfterWrite, readBrowserLocalCollection } from './helpers';
import { appendWatchlistScan } from '../packages/workspace/watchlist-history.mts';

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
  const stored = currentBrowserLocalDocument('watchlists', value);
  await page.addInitScript(({ key, stored: fixture }) => localStorage.setItem(key, JSON.stringify(fixture)), { key: WATCHLIST_KEY, stored });
  await page.goto('/monitor');
  await openConsoleView(page, 'watchlists');
}

test('incomplete web collection is visible while a usable Watchlist baseline survives reload', async ({ page }) => {
  const complete = { domain: 'quality.invalid', availability: 'registered', scanDepth: 'deep', pageTitle: 'Earlier page',
    hasPasswordField: true, riskScore: 80, riskModelVersion: 8, webCollectionQuality: { version: 1, page: 'complete', favicon: 'complete', combined: 'complete' } };
  const first = appendWatchlistScan(null, [complete], { checkedAt: '2026-07-13T08:00:00.000Z', mode: 'deep' }).entry;
  const latest = appendWatchlistScan(first, [{ ...complete, hasPasswordField: false, riskScore: 10,
    webCollectionQuality: { version: 1, page: 'unavailable', favicon: 'unknown', combined: 'partial' } }], { checkedAt: NOW, mode: 'deep' }).entry;
  await seed(page, { Quality: latest });
  await page.getByRole('row', { name: /Quality/ }).getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.locator('.events article').first()).toContainText('Web comparison was limited for 1 domain');
  await expect(page.locator('.events article').first().locator('li')).toHaveCount(0);
  await page.getByLabel('History focus', { exact: true }).selectOption('quality.invalid');
  await expect(page.locator('.history-summary')).toContainText('Page: unavailable · Favicon: unknown');
  const stored = await readBrowserLocalCollection(page, 'watchlists', { minimumRecords: 1 });
  expect(stored.records[0]!.value.baseline[0]!.riskScore).toBe(80);
  expect(stored.records[0]!.value.results[0]!.riskScore).toBe(10);
  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);
});

test('unknown Watchlist times remain visible and portable without invented dates', async ({ page }) => {
  await seed(page, { Undated: { ...entry('undated.invalid'), updatedAt: null, history: [{
    checkedAt: null, mode: 'saved', resultCount: 1, conclusiveCount: 1, changeCount: 1, omittedChanges: 0,
    changes: [{ domain: 'undated.invalid', field: 'nameservers', before: ['ns1.example.test'],
      after: ['ns2.example.test'], kind: 'infrastructure_changed', tone: 'warn' }],
  }] } });
  const row = page.getByRole('row', { name: /Undated/ });
  await expect(row).toContainText('Time unknown');
  await row.getByRole('button', { name: 'History', exact: true }).click();
  await page.getByLabel('History focus', { exact: true }).selectOption('undated.invalid');
  await expect(page.locator('.history')).toContainText('cannot be placed on the dated chart');
  await expect(page.locator('.domain-events')).toContainText('Time unknown');
  await expect(page.locator('.domain-events')).not.toContainText('1970');
  const stored = await readBrowserLocalCollection(page, 'watchlists', { minimumRecords: 1 });
  expect(stored.records[0]!.value.updatedAt).toBeNull();
  expect(stored.records[0]!.value.history[0]!.checkedAt).toBeNull();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const download = await downloadEvent;
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Watchlist export stream is unavailable.');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(exported.version).toBe(4);
  expect(exported.watchlists.Undated.history[0].checkedAt).toBeNull();
  for (const theme of ['dark', 'light']) for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    await expect(page.locator('.domain-events')).toContainText('Time unknown');
    await expect(page.locator('.history-summary')).toContainText('Times unknown');
    await expectNoHorizontalOverflow(page);
    if (width === 320) {
      const table = page.getByRole('region', { name: 'Saved watchlists', exact: true });
      await table.focus();
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => table.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
      await row.getByRole('button', { name: 'History', exact: true }).focus();
      await expect(row.getByRole('button', { name: 'History', exact: true })).toBeInViewport();
      await table.evaluate(element => element.scrollLeft = 0);
    }
    if (process.env.WHOISLEUTH_E2E_VISUAL_EVIDENCE === '1') {
      await test.info().attach(`watchlist-unknown-${theme}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    }
  }
});

for (const all of [false, true]) test(`a committed watchlist ${all ? 'clear' : 'deletion'} remains visible when rereading fails`, async ({ page }) => {
  await seed(page, { Priority: entry('priority.invalid'), Other: entry('other.invalid') });
  const before = await readBrowserLocalCollection(page, 'watchlists', { minimumRecords: 2 });
  await failNextBrowserLocalCollectionReadAfterWrite(page, 'watchlists');
  page.once('dialog', dialog => dialog.accept());
  await (all ? page.getByRole('button', { name: 'Clear all', exact: true }) : page.getByRole('row', { name: /Priority/ }).getByRole('button', { name: 'Delete', exact: true })).click();
  const result = page.getByRole('status').filter({ hasText: all ? 'Cleared all watchlists.' : 'Deleted "Priority".' });
  await expect(result).toContainText('committed');
  await expect(page.getByRole('row', { name: /Priority/ })).toHaveCount(0);
  await expect(result).not.toContainText('Could not');
  const after = await readBrowserLocalCollection(page, 'watchlists', { minimumRevision: before.manifest.revision + 1 });
  expect(after.records.map(record => record.id)).toEqual(all ? [] : ['Other']);
});

test('history distinguishes omitted changes from a completed check with no changes', async ({ page }) => {
  await seed(page, { Priority: { ...entry('priority.invalid'), history: [
    { checkedAt: NOW, mode: 'fast', resultCount: 1, conclusiveCount: 1, changeCount: 0, omittedChanges: 3, changes: [] },
    { checkedAt: '2026-07-13T08:00:00.000Z', mode: 'fast', resultCount: 1, conclusiveCount: 1, changeCount: 0, omittedChanges: 0, changes: [] },
  ] } });
  await page.getByRole('row', { name: /Priority/ }).getByRole('button', { name: 'History', exact: true }).click();
  const events = page.locator('.history .events article');
  await expect(events).toHaveCount(2);
  const omitted = events.filter({ hasText: '3 change details were omitted' });
  await expect(omitted).toHaveCount(1);
  await expect(omitted).not.toContainText('No comparable material changes');
  await expect(events.filter({ hasText: 'No comparable material changes' })).toHaveCount(1);
});

test('a future watchlist schema is never overwritten by an older app', async ({ page }) => {
  const future = { schema: 'whoisleuth.watchlists', version: 99, watchlists: { Future: entry('future.invalid') }, futureMetadata: { retain: true } };
  await page.addInitScript(({ key, stored }) => localStorage.setItem(key, JSON.stringify(stored)), { key: WATCHLIST_KEY, stored: future });
  await page.goto('/monitor');

  await expect(page.getByRole('heading', { name: 'Browser-local data unavailable' })).toBeVisible();
  await expect(page.getByText('Watchlists schema 99 was created by a newer app version. Update the app before migration; no data was changed.')).toBeVisible();
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), WATCHLIST_KEY);
  expect(stored).toEqual(future);
});

test('a watchlist quota failure reports a stable message and preserves the previous store', async ({ page }) => {
  const previous = { watchlists: { Priority: entry('priority.invalid') } };
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

  const activity = page.getByRole('region', { name: 'Watchlist activity' });
  await expect(activity).toBeVisible();
  await expect(activity.getByRole('img', { name: /2 retained watchlist checks with 1 material changes from 2026-06-17 through 2026-07-14, grouped by UTC calendar day/u })).toBeVisible();
  await expect(activity).toContainText('Each column covers seven days; dates use UTC.');
  await expect(activity.locator('.day-label')).toHaveCount(7);
  await expect(activity.locator('.week-label')).toHaveCount(4);
  await expect(activity.locator('g[data-state="changed"]')).toHaveCount(1);
  await expect(activity.locator('g[data-state="checked"]')).toHaveCount(1);
  await expect(activity.getByRole('list', { name: 'Retained watchlist activity by UTC day' })).toContainText(/14 July UTC/u);

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
  await expect(page).toHaveURL(/\/bulk\?source=watchlist&handoff=[0-9a-f]{32}$/u);
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
  await expect(domainHistory.getByRole('img', { name: 'Observed domain timeline with 2 checks and 3 evidence categories' })).toBeVisible();
  await expect(domainHistory).not.toContainText('other.invalid');
  await expect(domainHistory).toContainText('does not prove this domain was included in every check');
  await expect(domainHistory).toContainText('cannot be attributed reliably to this domain');

  await page.setViewportSize({ width: 360, height: 740 });
  await expectNoHorizontalOverflow(page);

  await domainHistory.getByRole('button', { name: 'Open case' }).click();
  await expect(page).toHaveURL(/\/cases\?case=/u);
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Cases', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
  await expect(page.locator('article.case-detail')).toContainText('priority.invalid');
  await expect(page.getByRole('status', { name: 'Case workspace action status' })).toContainText('Watchlist history remains separately attributed');
});
