import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  expectNoHorizontalOverflow,
  failBrowserLocalCollectionReads,
  failNextBrowserLocalCollectionReadAfterWrite,
  migrateLegacyBrowserData,
  useTheme,
} from './helpers';
import { caseRecord, snapshot } from './case-test-fixtures';
import { CASE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/case-model';

const RETAINED_AT = '2026-08-20T10:00:00.000Z';

function campaign(id: string, name: string, domains: string[]) {
  return {
    id,
    name,
    description: '',
    domains,
    createdAt: RETAINED_AT,
    updatedAt: RETAINED_AT,
  };
}

function retainedParentCase() {
  return caseRecord({
    id: 'parent-scope-case',
    domain: 'example.test',
    notes: [{ createdAt: RETAINED_AT, body: 'Private Case note outside the derived review.' }],
    evidenceHistory: [
      snapshot({
        id: 'scope-apex',
        fingerprint: 'scope-apex',
        inputHostname: 'example.test',
        capturedAt: '2026-08-20T09:58:00.000Z',
        firstCapturedAt: '2026-08-20T09:58:00.000Z',
        scanDepth: 'fast',
      }),
      snapshot({
        id: 'scope-account',
        fingerprint: 'scope-account',
        inputHostname: 'account.example.test',
        capturedAt: '2026-08-20T09:59:00.000Z',
        firstCapturedAt: '2026-08-20T09:59:00.000Z',
        scanDepth: 'deep',
      }),
      snapshot({
        id: 'scope-login',
        fingerprint: 'scope-login',
        inputHostname: 'login.example.test',
        capturedAt: RETAINED_AT,
        firstCapturedAt: RETAINED_AT,
        scanDepth: 'deep',
      }),
    ],
  });
}

function otherParentCase() {
  return caseRecord({
    id: 'other-parent-scope-case',
    domain: 'other.test',
    evidenceHistory: [
      snapshot({ id: 'other-portal', fingerprint: 'other-portal', inputHostname: 'portal.other.test' }),
      snapshot({ id: 'other-signin', fingerprint: 'other-signin', inputHostname: 'signin.other.test' }),
    ],
  });
}

function parentScopeStorage(records = [retainedParentCase(), otherParentCase()]) {
  return {
    'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: records },
    'whoisleuth-campaigns-v1': {
      version: 1,
      campaigns: [
        campaign('parent-scope-campaign', 'Exact parent review', ['example.test']),
        campaign('other-parent-campaign', 'Other parent review', ['other.test']),
      ],
    },
  };
}

async function openParentScope(page: Page, records = [retainedParentCase(), otherParentCase()]) {
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, parentScopeStorage(records), {
    destination: '/monitor?view=campaigns&campaign=parent-scope-campaign',
  });
  const scope = page.getByRole('region', { name: 'Parent-domain scope' });
  await expect(scope).toBeVisible();
  return scope;
}

async function installTransientInteractionCounters(page: Page) {
  await page.evaluate(() => {
    const state = window as typeof window & {
      __parentScopeIndexedDbWrites?: number;
      __parentScopeLocalStorageWrites?: number;
    };
    state.__parentScopeIndexedDbWrites = 0;
    state.__parentScopeLocalStorageWrites = 0;
    const originalPut = IDBObjectStore.prototype.put;
    const originalAdd = IDBObjectStore.prototype.add;
    const originalDelete = IDBObjectStore.prototype.delete;
    const originalClear = IDBObjectStore.prototype.clear;
    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;
    const originalStorageClear = Storage.prototype.clear;
    const countIndexedDbWrite = (storeName: string) => {
      if (storeName === 'manifests' || storeName === 'records') {
        state.__parentScopeIndexedDbWrites = (state.__parentScopeIndexedDbWrites ?? 0) + 1;
      }
    };
    IDBObjectStore.prototype.put = function put(value: unknown, key?: IDBValidKey) {
      countIndexedDbWrite(this.name);
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    };
    IDBObjectStore.prototype.add = function add(value: unknown, key?: IDBValidKey) {
      countIndexedDbWrite(this.name);
      return key === undefined ? originalAdd.call(this, value) : originalAdd.call(this, value, key);
    };
    IDBObjectStore.prototype.delete = function deleteRecord(query: IDBValidKey | IDBKeyRange) {
      countIndexedDbWrite(this.name);
      return originalDelete.call(this, query);
    };
    IDBObjectStore.prototype.clear = function clear() {
      countIndexedDbWrite(this.name);
      return originalClear.call(this);
    };
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (this === window.localStorage) {
        state.__parentScopeLocalStorageWrites = (state.__parentScopeLocalStorageWrites ?? 0) + 1;
      }
      return originalSetItem.call(this, key, value);
    };
    Storage.prototype.removeItem = function removeItem(key: string) {
      if (this === window.localStorage) {
        state.__parentScopeLocalStorageWrites = (state.__parentScopeLocalStorageWrites ?? 0) + 1;
      }
      return originalRemoveItem.call(this, key);
    };
    Storage.prototype.clear = function clear() {
      if (this === window.localStorage) {
        state.__parentScopeLocalStorageWrites = (state.__parentScopeLocalStorageWrites ?? 0) + 1;
      }
      return originalStorageClear.call(this);
    };
  });
}

test('reviews, filters, selects and exports exact parent scope without collection or persistence side effects', async ({ page }) => {
  await useTheme(page, 'light');
  let scope = await openParentScope(page);
  const table = scope.getByRole('table', {
    name: 'Exact retained hostnames grouped by canonical registrable parent',
  });
  await expect(table).toBeVisible();
  await expect(table.getByRole('row')).toHaveCount(4);
  await expect(table).toContainText('example.test');
  await expect(table).toContainText('account.example.test');
  await expect(table).toContainText('login.example.test');
  await expect(table.getByText('Parent apex', { exact: true })).toHaveCount(1);
  await expect(table.getByText('Child hostname', { exact: true })).toHaveCount(2);
  await expect(table).toContainText('lookup Case snapshot ev-');
  await expect(table).toContainText('Observation:');
  await expect(table).toContainText('completeness: complete');
  await expect(scope).toContainText('Namespace hierarchy does not establish common ownership');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const lightTableBackground = await table.evaluate((element) => getComputedStyle(element).backgroundColor);

  await page.getByRole('button', { name: /Colour theme/u }).click();
  await page.getByRole('option', { name: 'Dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await table.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(lightTableBackground);
  await page.setViewportSize({ width: 360, height: 780 });
  await expectNoHorizontalOverflow(page);

  const dataRequests: string[] = [];
  const recordDataRequest = (request: import('@playwright/test').Request) => {
    if (request.resourceType() === 'fetch' || request.resourceType() === 'xhr') {
      const url = new URL(request.url());
      dataRequests.push(`${request.method()} ${url.pathname}`);
    }
  };
  page.on('request', recordDataRequest);
  await installTransientInteractionCounters(page);

  const firstCampaign = page.locator('.campaign-head', { hasText: 'Exact parent review' });
  await firstCampaign.click();
  await expect(scope).toHaveCount(0);
  await firstCampaign.click();
  scope = page.getByRole('region', { name: 'Parent-domain scope' });
  await expect(scope).toBeVisible();

  const filter = scope.getByLabel('Filter exact hostnames');
  await filter.fill('login');
  await expect(scope.getByRole('row')).toHaveCount(2);
  const loginSelection = scope.getByRole('checkbox', {
    name: 'Select exact hostname login.example.test under example.test for transient response-scope review',
  });
  await expect(loginSelection).toHaveCount(1);
  await loginSelection.focus();
  await expect(loginSelection).toBeFocused();
  expect(await loginSelection.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
  await page.keyboard.press('Space');
  await expect(scope.getByRole('status')).toContainText('1 of 3 exact hostnames selected; 1 currently shown');

  await page.locator('.campaign-head', { hasText: 'Other parent review' }).click();
  scope = page.getByRole('region', { name: 'Parent-domain scope' });
  await expect(scope.getByRole('status')).toContainText('0 of 2 exact hostnames selected; 2 currently shown');
  await page.locator('.campaign-head', { hasText: 'Exact parent review' }).click();
  scope = page.getByRole('region', { name: 'Parent-domain scope' });
  await expect(scope.getByLabel('Filter exact hostnames')).toHaveValue('');
  await expect(scope.getByRole('status')).toContainText('0 of 3 exact hostnames selected; 3 currently shown');

  const accountSelection = scope.getByRole('checkbox', {
    name: 'Select exact hostname account.example.test under example.test for transient response-scope review',
  });
  await accountSelection.check();
  await expect(scope.getByRole('status')).toContainText('1 of 3 exact hostnames selected');
  const downloadPromise = page.waitForEvent('download');
  await scope.getByRole('button', { name: 'Export hostname review' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const body = await readFile(path!, 'utf8');
  const exported = JSON.parse(body);
  expect(exported).toMatchObject({
    schema: 'whoisleuth.parent-domain-campaign-review',
    version: 1,
    campaign: { id: 'parent-scope-campaign', memberDomains: ['example.test'] },
    review: { state: 'ready' },
  });
  expect(exported.review.parents[0].hostnames.map((item: { hostname: string }) => item.hostname)).toEqual([
    'example.test',
    'account.example.test',
    'login.example.test',
  ]);
  expect(body).not.toContain('Private Case note outside the derived review.');
  expect(body).not.toContain('selected');
  expect(body).not.toContain('responseScope');

  expect(dataRequests).toEqual([]);
  expect(await page.evaluate(() => (window as typeof window & { __parentScopeIndexedDbWrites?: number }).__parentScopeIndexedDbWrites)).toBe(0);
  expect(await page.evaluate(() => (window as typeof window & { __parentScopeLocalStorageWrites?: number }).__parentScopeLocalStorageWrites)).toBe(0);
  page.off('request', recordDataRequest);

  const pivot = scope.getByRole('button', {
    name: 'Open Case example.test for retained hostname account.example.test',
  });
  await pivot.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(pivot).toBeFocused();
  expect(await pivot.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: /Cases/u })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.case-head', { hasText: 'example.test' })).toHaveAttribute('aria-expanded', 'true');
});

test('presents loading and ready parent-domain evidence without inferring a loading count', async ({ page }) => {
  await page.goto('/bulk');
  await migrateLegacyBrowserData(page, parentScopeStorage(), { destination: '/bulk' });
  await expect(page.locator('#console-navigation')).toBeVisible();
  await page.evaluate(() => {
    const originalGet = IDBObjectStore.prototype.get;
    let pending = true;
    IDBObjectStore.prototype.get = function delayedCaseRead(query: IDBValidKey | IDBKeyRange) {
      const request = originalGet.call(this, query);
      if (!pending || this.name !== 'manifests' || query !== 'cases') return request;
      pending = false;
      const store = this;
      const releaseAt = performance.now() + 1_500;
      const keepTransactionAlive = () => {
        const keepAlive = originalGet.call(store, '__parent_scope_case_read_hold__');
        keepAlive.onsuccess = () => {
          if (performance.now() < releaseAt) keepTransactionAlive();
        };
      };
      keepTransactionAlive();
      return request;
    };
  });
  const monitor = page.locator('#console-navigation').getByRole('link', { name: /^Monitor/u });
  await monitor.evaluate((link) => link.setAttribute('href', '/monitor?view=campaigns&campaign=parent-scope-campaign'));
  await monitor.click();

  const scope = page.getByRole('region', { name: 'Parent-domain scope' });
  await expect(scope).toContainText('Case evidence is loading. No hostname or parent count is inferred yet.', {
    timeout: 2_000,
  });
  expect(await scope.getByRole('table').count()).toBe(0);
  expect(await scope.getByText(/0 of .* exact hostnames/u).count()).toBe(0);
  await expect(scope.getByRole('table', {
    name: 'Exact retained hostnames grouped by canonical registrable parent',
  })).toBeVisible();
});

test('presents unavailable and insufficient parent-domain evidence without misleading zeroes', async ({ page }) => {
  await page.goto('/bulk');
  await migrateLegacyBrowserData(page, parentScopeStorage(), { destination: '/bulk' });
  await expect(page.locator('#console-navigation')).toBeVisible();
  await failBrowserLocalCollectionReads(page, 'cases');
  const monitor = page.locator('#console-navigation').getByRole('link', { name: /^Monitor/u });
  await monitor.evaluate((link) => link.setAttribute('href', '/monitor?view=campaigns&campaign=parent-scope-campaign'));
  await monitor.click();
  let scope = page.getByRole('region', { name: 'Parent-domain scope' });
  await expect(scope).toContainText('Case evidence is unavailable');
  await expect(scope.getByRole('table')).toHaveCount(0);
  await expect(scope.getByText(/0 of .* exact hostnames/u)).toHaveCount(0);

  await migrateLegacyBrowserData(page, parentScopeStorage([
    caseRecord({
      id: 'insufficient-parent-case',
      domain: 'example.test',
      evidenceHistory: [snapshot({ id: 'only-child', inputHostname: 'only.example.test' })],
    }),
  ]), { destination: '/monitor?view=campaigns&campaign=parent-scope-campaign' });
  scope = page.getByRole('region', { name: 'Parent-domain scope' });
  await expect(scope).toContainText('There is insufficient retained evidence');
  await expect(scope).toContainText('This is not proof that no child hostname exists');
  await expect(scope.getByRole('table')).toHaveCount(0);
});

test('keeps attributable rows visible as partial after a committed Case reread fails', async ({ page }) => {
  await openParentScope(page, [retainedParentCase()]);
  await page.getByRole('tab', { name: /Cases/u }).click();
  await page.locator('.case-head', { hasText: 'example.test' }).click();
  const openCase = page.locator('article.case.open');
  await failNextBrowserLocalCollectionReadAfterWrite(page, 'cases');
  await openCase.getByRole('combobox', { name: /^Status/u }).selectOption('reviewing');
  await expect(page.getByRole('status').filter({
    hasText: 'The change was saved, but Cases could not be reread',
  })).toBeVisible();

  await page.getByRole('tab', { name: /Campaigns/u }).click();
  await page.locator('.campaign-head', { hasText: 'Exact parent review' }).click();
  const scope = page.getByRole('region', { name: 'Parent-domain scope' });
  await expect(scope).toContainText('The review is partial. Visible rows remain attributable');
  await expect(scope.getByRole('table', {
    name: 'Exact retained hostnames grouped by canonical registrable parent',
  })).toContainText('login.example.test');
});
