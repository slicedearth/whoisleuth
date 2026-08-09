import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { caseRecord } from './case-test-fixtures';
import {
  expectNoHorizontalOverflow,
  failBrowserLocalCollectionReads,
  holdBrowserLocalReads,
  migrateLegacyBrowserData,
} from './helpers';

const OBSERVED_AT = '2026-08-08T00:00:00.000Z';
const LONG_BULK_SOURCE = `source_${'x'.repeat(32)}`;
const LONG_CASE_SOURCE = `source ${'Y'.repeat(70)}`;

function evidencePin(
  id: string,
  domain: string,
  source: string,
  sourceState: string,
) {
  return {
    id,
    checkpointId: null,
    field: `${id}.field`,
    category: 'registration',
    label: `${domain} ${'L'.repeat(70)}`,
    value: 'Retained bounded value',
    source,
    sourceState,
    sourceSchema: null,
    observedAt: OBSERVED_AT,
    collectionDepth: 'deep',
    completeness: sourceState === 'partial' ? 'partial' : 'complete',
    truncated: false,
    transitionExpectation: null,
    limitations: [`${'R'.repeat(200)} retained source limitation`],
    createdAt: OBSERVED_AT,
  };
}

function bulkSessionStore() {
  return {
    schema: 'whoisleuth.bulk-sessions',
    version: 3,
    sessions: [{
      id: 'evidence-debt-session',
      name: `Saved ${'S'.repeat(90)}`,
      mode: 'deep',
      state: 'complete',
      inputDigest: `sha256:${'a'.repeat(64)}`,
      domains: ['bulk-debt.invalid', 'not-retained.invalid'],
      results: [{
        domain: 'bulk-debt.invalid',
        status: 'complete',
        scanDepth: 'deep',
        sourceCoverage: [
          { source: 'rdap', state: 'partial' },
          { source: LONG_BULK_SOURCE, state: 'unavailable' },
          { source: 'whois', state: 'skipped' },
        ],
      }, {
        domain: 'not-retained.invalid',
        status: 'complete',
        scanDepth: 'deep',
        sourceCoverage: [],
      }],
      startedAt: OBSERVED_AT,
      updatedAt: OBSERVED_AT,
      completedAt: OBSERVED_AT,
    }],
  };
}

function casesStore() {
  return {
    version: 8,
    cases: [
      {
        ...caseRecord({
          id: 'case-rate-limited',
          domain: 'rate-limited.invalid',
          status: 'reviewing',
          disposition: 'suspicious',
          updatedAt: OBSERVED_AT,
        }),
        evidencePins: [evidencePin('pin-rate-limited', 'rate-limited.invalid', 'whois', 'rate_limited')],
      },
      {
        ...caseRecord({
          id: 'case-conflicting',
          domain: 'conflicting.invalid',
          status: 'reviewing',
          disposition: 'suspicious',
          updatedAt: OBSERVED_AT,
        }),
        evidencePins: [evidencePin('pin-conflicting', 'conflicting.invalid', LONG_CASE_SOURCE, 'conflicting')],
      },
      caseRecord({ id: 'case-no-pins', domain: 'no-pins.invalid', status: 'reviewing' }),
    ],
  };
}

async function seedEvidenceDebt(page: Page, destination = '/monitor') {
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': casesStore(),
    'whoisleuth-bulk-sessions-v1': bulkSessionStore(),
  }, { clearStorage: true, destination });
}

async function installNoSideEffectCounters(page: Page) {
  await page.evaluate(() => {
    const state = window as typeof window & { __evidenceDebtWrites?: number };
    state.__evidenceDebtWrites = 0;
    const count = () => { state.__evidenceDebtWrites = (state.__evidenceDebtWrites || 0) + 1; };
    const originalPut = IDBObjectStore.prototype.put;
    const originalAdd = IDBObjectStore.prototype.add;
    const originalDelete = IDBObjectStore.prototype.delete;
    const originalClear = IDBObjectStore.prototype.clear;
    IDBObjectStore.prototype.put = function put(value: unknown, key?: IDBValidKey) {
      count();
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    };
    IDBObjectStore.prototype.add = function add(value: unknown, key?: IDBValidKey) {
      count();
      return key === undefined ? originalAdd.call(this, value) : originalAdd.call(this, value, key);
    };
    IDBObjectStore.prototype.delete = function remove(query: IDBValidKey | IDBKeyRange) {
      count();
      return originalDelete.call(this, query);
    };
    IDBObjectStore.prototype.clear = function clear() {
      count();
      return originalClear.call(this);
    };
    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;
    const originalStorageClear = Storage.prototype.clear;
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      count();
      return originalSetItem.call(this, key, value);
    };
    Storage.prototype.removeItem = function removeItem(key: string) {
      count();
      return originalRemoveItem.call(this, key);
    };
    Storage.prototype.clear = function clear() {
      count();
      return originalStorageClear.call(this);
    };
  });
}

test('projects exact retained debt, exposes deliberate actions, and stays read-only on mobile', async ({ page }) => {
  const collectionRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (/^\/api\/(?:lookup|bulk|discover|watchlists)/u.test(url.pathname)) collectionRequests.push(url.pathname);
  });
  await page.goto('/monitor');
  await seedEvidenceDebt(page);

  const region = page.getByRole('region', { name: 'Evidence-debt matrix' });
  await expect(region).toBeVisible();
  await installNoSideEffectCounters(page);
  await expect(region.locator('.review-heading > strong')).toHaveText('4 actionable evidence-debt items');
  await expect(region.getByRole('row', { name: /Bulk RDAP 0 0 0 1 0 0 1/u })).toBeVisible();
  await expect(region).toContainText('1 scanned Bulk row has no retained per-source coverage');
  await expect(region).toContainText('1 active case has no separately pinned evidence source');
  await expect(region).toContainText('1 retained source state explicitly records skipped collection');

  const filters = region.getByRole('group', { name: 'Evidence-debt queue filters' });
  await filters.getByLabel('Owner').selectOption('case');
  await filters.getByLabel('State').selectOption('conflicting');
  const conflicting = region.locator('.queue > li', { hasText: 'conflicting.invalid' });
  await expect(conflicting).toBeVisible();
  const reviewCase = conflicting.getByRole('link', { name: 'Review case' });
  await expect(reviewCase).toHaveAttribute(
    'href',
    '/monitor?view=cases&case=case-conflicting#case-response-case-conflicting',
  );
  await reviewCase.focus();
  await reviewCase.press('Enter');
  await expect(page.getByRole('tab', { name: /^Cases/u })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#case-head-case-conflicting')).toBeFocused();
  await page.getByRole('tab', { name: /^Inbox/u }).click();

  const returnedRegion = page.getByRole('region', { name: 'Evidence-debt matrix' });
  const returnedFilters = returnedRegion.getByRole('group', { name: 'Evidence-debt queue filters' });
  await returnedFilters.getByLabel('Source').selectOption({ label: 'WHOIS' });
  const rateLimited = returnedRegion.locator('.queue > li', { hasText: 'rate-limited.invalid' });
  await expect(rateLimited).toBeVisible();
  const deepLookup = rateLimited.getByRole('link', { name: 'Open Deep Lookup' });
  await expect(deepLookup).toHaveAttribute('href', '/lookup?q=rate-limited.invalid&depth=deep');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(returnedRegion.locator('.mobile-matrix')).toBeVisible();
  await expect(returnedRegion.locator('.desktop-matrix')).toBeHidden();
  await expect(returnedRegion).toContainText(LONG_BULK_SOURCE.replaceAll('_', ' '));
  await expect(returnedRegion).toContainText('Y'.repeat(70));
  await expectNoHorizontalOverflow(page);

  await deepLookup.focus();
  await expect(deepLookup).toBeFocused();
  await deepLookup.press('Enter');
  await expect(page).toHaveURL(/\/lookup\?q=rate-limited\.invalid&depth=deep$/u);
  await expect(page.locator('#query')).toHaveValue('rate-limited.invalid');
  await expect(page.locator('#result')).toHaveCount(0);
  expect(collectionRequests).toEqual([]);
  expect(await page.evaluate(() => (window as typeof window & { __evidenceDebtWrites?: number }).__evidenceDebtWrites || 0)).toBe(0);
  await expectNoHorizontalOverflow(page);
});

test('keeps readable Bulk debt visible while the Case source is unavailable', async ({ page }) => {
  await page.goto('/bulk');
  await seedEvidenceDebt(page, '/bulk');
  await expect(page.locator('#console-navigation')).toBeVisible();
  await failBrowserLocalCollectionReads(page, 'cases');
  await page.locator('#console-navigation').getByRole('link', { name: /^Monitor/u }).click();

  const region = page.getByRole('region', { name: 'Evidence-debt matrix' });
  await expect(region.getByRole('alert')).toContainText('Cases could not be read');
  await expect(region.locator('.review-heading > strong')).toHaveText('2 visible · incomplete');
  await expect(region.locator('.queue > li', { hasText: 'bulk-debt.invalid' })).toHaveCount(2);
  await expect(region.getByText(/No actionable debt is visible/u)).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);
});

test('announces loading without presenting a false zero', async ({ page }) => {
  await page.goto('/bulk');
  await seedEvidenceDebt(page, '/bulk');
  await expect(page.locator('#console-navigation')).toBeVisible();
  await holdBrowserLocalReads(page, 1_500);
  const navigation = page.locator('#console-navigation').getByRole('link', { name: /^Monitor/u }).click();

  const region = page.getByRole('region', { name: 'Evidence-debt matrix' });
  await expect(region).toHaveAttribute('aria-busy', 'true');
  await expect(region.locator('.review-heading > strong')).toHaveText('—');
  await expect(region.getByRole('status')).toContainText('Loading saved Bulk sessions and Cases');
  await expect(region.getByText(/No actionable partial/u)).toHaveCount(0);
  await navigation;
  await expect(region).toHaveAttribute('aria-busy', 'false', { timeout: 5_000 });
  await expect(region.locator('.review-heading > strong')).toHaveText('4 actionable evidence-debt items');
});
