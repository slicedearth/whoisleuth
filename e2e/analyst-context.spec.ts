import { expect, test } from './fixtures';
import {
  currentBrandProfileBrowserStore,
  currentBrowserLocalDocument,
  expectFocusedResultsVisible,
  expectNoHorizontalOverflow,
  failBrowserLocalCollectionReads,
  failBrowserLocalReads,
  migrateLegacyBrowserData,
  useTheme,
} from './helpers';
import { CASE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/case-model';

const OBSERVED_AT = '2026-08-01T02:00:00.000Z';

function retainedCase(index: number) {
  return {
    id: `saved-context-case-${index}`,
    domain: `saved-context-${index}.invalid`,
    status: 'new',
    disposition: 'unreviewed',
    tags: [],
    notes: [],
    source: 'lookup',
    evidenceHistory: [],
    createdAt: OBSERVED_AT,
    updatedAt: OBSERVED_AT,
  };
}

test('saved context stays dormant until keyboard activation and then renders a paged preview', async ({ page }) => {
  const scriptRequests: string[] = [];
  const lookupRequests: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scriptRequests.push(request.url());
    if (new URL(request.url()).pathname === '/api/lookup') lookupRequests.push(request.url());
  });
  await page.goto('/lookup?q=saved-context');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: [0, 1, 2].map(retainedCase) },
    'whoisleuth-campaigns-v1': currentBrowserLocalDocument('campaigns', { campaigns: [] }),
    'whois-rdap-brand-profiles-v1': currentBrandProfileBrowserStore([]),
    'whoisleuth-relationship-observations-v1': currentBrowserLocalDocument('relationship_observations', {
      observations: [],
    }),
  }, { clearStorage: true });

  await expect(page.getByRole('heading', { name: 'Saved context' })).toBeVisible();
  await page.evaluate(() => {
    const state = window as typeof window & { __savedContextManifestReads?: number; __savedContextWrites?: number };
    state.__savedContextManifestReads = 0;
    state.__savedContextWrites = 0;
    const originalGet = IDBObjectStore.prototype.get;
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.get = function get(query: IDBValidKey | IDBKeyRange) {
      if (this.name === 'manifests') state.__savedContextManifestReads = (state.__savedContextManifestReads || 0) + 1;
      return originalGet.call(this, query);
    };
    IDBObjectStore.prototype.put = function put(value: unknown, key?: IDBValidKey) {
      if (this.name === 'manifests' || this.name === 'records') state.__savedContextWrites = (state.__savedContextWrites || 0) + 1;
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    };
  });

  const openButton = page.getByRole('button', { name: 'Open saved context' });
  await openButton.focus();
  await expect(openButton).toBeFocused();
  expect(await page.evaluate(() => (window as typeof window & { __savedContextManifestReads?: number }).__savedContextManifestReads)).toBe(0);
  const scriptCountBeforeOpen = scriptRequests.length;

  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Clear query' }).click();
  const closeButton = page.getByRole('button', { name: 'Close saved context' });
  await expect(closeButton).toBeEnabled();
  await closeButton.click();
  await expect(page.getByRole('button', { name: 'Open saved context' })).toBeDisabled();
  await expect.poll(() => scriptRequests.length).toBeGreaterThan(scriptCountBeforeOpen);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __savedContextManifestReads?: number }).__savedContextManifestReads || 0)).toBe(4);
  await expect(page.locator('#lookup-saved-context-results .state')).toHaveText('Enter a target before opening saved context.');
  const scriptCountAfterImport = scriptRequests.length;
  const readCountAfterImport = await page.evaluate(() => (window as typeof window & { __savedContextManifestReads?: number }).__savedContextManifestReads || 0);
  await page.locator('#query').fill('saved-context');
  await page.getByRole('button', { name: 'Open saved context' }).click();
  await expect(page.locator('#lookup-saved-context-results .state')).toHaveText('Showing matches 1–3 of 6.');
  await expect(page.getByRole('navigation', { name: 'Saved context pages' })).toContainText('Page 1 of 2');
  const resultList = page.getByRole('list', { name: 'Saved context matches' });
  await expect(resultList.locator(':scope > li')).toHaveCount(3);
  await expect(resultList.getByRole('link', { name: /Open case|Open source case/u }).first()).toHaveAttribute('href', /\/monitor\?case=/u);
  await page.getByRole('button', { name: 'Close saved context' }).click();
  await page.getByRole('button', { name: 'Open saved context' }).click();
  await expect(resultList).toBeVisible();
  expect(scriptRequests.length).toBe(scriptCountAfterImport);
  expect(await page.evaluate(() => (window as typeof window & { __savedContextManifestReads?: number }).__savedContextManifestReads || 0)).toBe(readCountAfterImport);
  expect(await page.evaluate(() => (window as typeof window & { __savedContextWrites?: number }).__savedContextWrites || 0)).toBe(0);
  expect(lookupRequests).toEqual([]);

  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);
});

test('saved context retains successful matches and unavailable source state after one local store fails', async ({ page }) => {
  const lookupRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/lookup') lookupRequests.push(request.url());
  });
  await page.goto('/lookup?q=saved-context-0.invalid');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: [retainedCase(0)] },
    'whoisleuth-campaigns-v1': currentBrowserLocalDocument('campaigns', { campaigns: [] }),
    'whois-rdap-brand-profiles-v1': currentBrandProfileBrowserStore([]),
    'whoisleuth-relationship-observations-v1': currentBrowserLocalDocument('relationship_observations', {
      observations: [],
    }),
  }, { clearStorage: true });
  const openButton = page.getByRole('button', { name: 'Open saved context' });
  await expect(openButton).toBeVisible();
  await failBrowserLocalCollectionReads(page, 'campaigns');

  await openButton.click();
  await expect(page.getByRole('status').filter({ hasText: /coverage is partial/u })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Saved context matches' }).locator(':scope > li')).not.toHaveCount(0);
  await page.getByText('Preview limitations').click();
  await expect(page.getByText(/Saved collections not fully searched: Campaigns \(unavailable\)/u)).toBeVisible();

  await page.locator('#query').fill('nothing-retained.invalid');
  await expect(page.getByRole('status').filter({ hasText: /No match was found.*coverage is partial/u })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Saved context matches' })).toHaveCount(0);
  expect(lookupRequests).toEqual([]);
  await page.setViewportSize({ width: 360, height: 700 });
  await expectNoHorizontalOverflow(page);
});

test('saved context reports unavailable browser-local reads only after it is opened', async ({ page }) => {
  await page.goto('/lookup?q=unavailable-context');
  const openButton = page.getByRole('button', { name: 'Open saved context' });
  await expect(openButton).toBeVisible();
  await failBrowserLocalReads(page);
  await expect(page.getByText(/Saved context could not be prepared/u)).toHaveCount(0);
  await openButton.click();
  const unavailable = page.getByRole('alert');
  await expect(unavailable).toContainText('Saved context could not be prepared. No saved records were changed.');
  expect(await unavailable.evaluate((element) => getComputedStyle(element).borderLeftStyle)).toBe('dotted');
  await page.setViewportSize({ width: 390, height: 700 });
  await expectNoHorizontalOverflow(page);
});

test('saved context reaches matches after the first fifty and restores query and page focus', async ({ page }) => {
  await page.goto('/lookup?q=saved-context');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: Array.from({ length: 31 }, (_, index) => retainedCase(index)) },
  });
  await page.getByRole('button', { name: 'Open saved context' }).click();
  const results = page.getByRole('list', { name: 'Saved context matches' });
  const pages = page.getByRole('navigation', { name: 'Saved context pages' });
  const identities = new Set<string>();
  for (let currentPage = 1; currentPage <= 21; currentPage += 1) {
    await expect(pages.getByRole('status')).toHaveText(`Page ${currentPage} of 21`);
    await expect(results).toHaveAttribute('aria-busy', 'false');
    const visible = await results.locator('article').evaluateAll((cards) => cards.map((card) =>
      `${card.querySelector('header span')?.textContent}:${card.querySelector('h3')?.textContent}`));
    expect(visible).toHaveLength(currentPage === 21 ? 2 : 3);
    for (const identity of visible) { expect(identities.has(identity)).toBe(false); identities.add(identity); }
    if (currentPage < 21) {
      await pages.getByRole('button', { name: 'Next', exact: true }).press('Enter');
      await expectFocusedResultsVisible(page, results);
    }
  }
  expect(identities.size).toBe(62);
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      await pages.getByRole('button', { name: 'Previous', exact: true }).press('Enter');
      await expect(pages.getByRole('status')).toHaveText('Page 20 of 21');
      await pages.getByRole('button', { name: 'Next', exact: true }).press('Enter');
      await expect(pages.getByRole('status')).toHaveText('Page 21 of 21');
      await expectFocusedResultsVisible(page, results);
      await expectNoHorizontalOverflow(page);
      await expect(pages.getByRole('button', { name: 'Previous', exact: true })).toBeVisible();
      await test.info().attach(`saved-context-${viewport.width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
    }
  }
  await page.locator('#query').fill('saved-context-0.invalid');
  await expect(results.locator(':scope > li')).toHaveCount(2);
  await expect(pages).toHaveCount(0);
  await expect(page.locator('#query')).toBeFocused();
  await page.locator('#query').fill('nothing-retained.invalid');
  await expect(results).toHaveCount(0);
  await expect(page.locator('#lookup-saved-context-results .state')).toContainText('No indexed saved work matched that search.');
});
