import { expect, test } from './fixtures';
import {
  expectNoHorizontalOverflow,
  failBrowserLocalCollectionReads,
  failBrowserLocalReads,
  migrateLegacyBrowserData,
} from './helpers';

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

test('saved context stays dormant until keyboard activation and then renders a bounded partial preview', async ({ page }) => {
  const scriptRequests: string[] = [];
  const lookupRequests: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scriptRequests.push(request.url());
    if (new URL(request.url()).pathname === '/api/lookup') lookupRequests.push(request.url());
  });
  await page.goto('/lookup?q=saved-context');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: 2, cases: [0, 1, 2].map(retainedCase) },
    'whoisleuth-campaigns-v1': { version: 1, campaigns: [] },
    'whois-rdap-brand-profiles-v1': { version: 2, profiles: [] },
    'whoisleuth-relationship-observations-v1': {
      schema: 'whoisleuth.relationship-observations',
      version: 1,
      observations: [],
    },
  }, { clearStorage: true });

  await expect(page.getByRole('heading', { name: 'Preview saved context for this target' })).toBeVisible();
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
  const scriptCountAfterImport = scriptRequests.length;
  const readCountAfterImport = await page.evaluate(() => (window as typeof window & { __savedContextManifestReads?: number }).__savedContextManifestReads || 0);
  await page.locator('#query').fill('saved-context');
  await page.getByRole('button', { name: 'Open saved context' }).click();
  await expect(page.getByRole('status').filter({ hasText: /bounded local matches? with partial coverage/u })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /additional local matches were omitted/u })).toBeVisible();
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
    'whois-rdap-cases-v1': { version: 2, cases: [retainedCase(0)] },
    'whoisleuth-campaigns-v1': { version: 1, campaigns: [] },
    'whois-rdap-brand-profiles-v1': { version: 2, profiles: [] },
    'whoisleuth-relationship-observations-v1': {
      schema: 'whoisleuth.relationship-observations',
      version: 1,
      observations: [],
    },
  }, { clearStorage: true });
  const openButton = page.getByRole('button', { name: 'Open saved context' });
  await expect(openButton).toBeVisible();
  await failBrowserLocalCollectionReads(page, 'campaigns');

  await openButton.click();
  await expect(page.getByRole('status').filter({ hasText: /partial coverage/u })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Saved context matches' }).locator(':scope > li')).not.toHaveCount(0);
  await page.getByText('Preview limitations').click();
  await expect(page.getByText(/Campaigns saved context is unavailable and was not fully searched/u)).toBeVisible();

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
  await expect(page.getByText(/Saved context is unavailable because/u)).toHaveCount(0);
  await openButton.click();
  const unavailable = page.getByRole('alert');
  await expect(unavailable).toContainText('Saved context is unavailable because one or more browser-local collections could not be read.');
  expect(await unavailable.evaluate((element) => getComputedStyle(element).borderLeftStyle)).toBe('dotted');
  await page.setViewportSize({ width: 390, height: 700 });
  await expectNoHorizontalOverflow(page);
});
