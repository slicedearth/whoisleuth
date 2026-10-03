import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { caseRecord } from './case-test-fixtures';
import {
  currentBrandProfileBrowserStore,
  currentBrowserLocalDocument,
  expectNoHorizontalOverflow,
  failBrowserLocalCollectionReads,
  migrateLegacyBrowserData,
  readBrowserLocalCollection,
  useTheme,
} from './helpers';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';

const DATABASE_NAME = 'whoisleuth-browser-data-v1';
const PROFILES_KEY = 'whois-rdap-brand-profiles-v1';
const ACTIVE_KEY = 'whois-rdap-active-brand-profile-v1';
const CASES_KEY = 'whois-rdap-cases-v1';
const RELATIONSHIPS_KEY = 'whoisleuth-relationship-observations-v1';
const PROFILE_ID = 'asset-profile';
const NOW = '2026-08-13T00:00:00.000Z';
const LATER = '2026-08-13T01:00:00.000Z';

function profileFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE_ID,
    name: 'Asset fixture profile',
    officialDomains: ['official.example'],
    productNames: [],
    tlds: ['example'],
    approvedPartnerDomains: ['partner.example'],
    allowlistedDomains: ['allowlisted.example'],
    allowlistedRegistrars: [],
    dkimSelectors: [],
    retiredDkimSelectors: [],
    mailProtectionProfile: 'standard',
    protectionAttestations: [],
    desiredPostureBaselines: [],
    trademarkOwner: '',
    trademarkRegistration: '',
    officialFaviconHash: '',
    officialFaviconPHash: '',
    pageBaseline: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function relationshipFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'relationship-imported-id-is-rederived',
    type: 'nameserver_set',
    label: 'Shared nameserver set',
    method: 'Exact normalised set',
    normalizedValue: 'ns1.shared.example · ns2.shared.example',
    displayValue: 'ns1.shared.example · ns2.shared.example',
    domains: ['official.example', 'lead.example'],
    description: 'Fixture relationship.',
    classification: 'derived',
    source: 'bulk_relationship_analysis',
    sourceVersion: 1,
    observedAt: NOW,
    retainedAt: LATER,
    complete: true,
    truncated: false,
    limitations: [],
    ...overrides,
  };
}

function registerEntries(options: {
  profile?: Record<string, unknown>;
  cases?: unknown[];
  relationships?: unknown[];
  activeId?: string | null;
} = {}) {
  return {
    [PROFILES_KEY]: currentBrandProfileBrowserStore([options.profile ?? profileFixture()]),
    [ACTIVE_KEY]: options.activeId === undefined ? PROFILE_ID : options.activeId,
    [CASES_KEY]: {
      version: CASE_SCHEMA_VERSION,
      cases: options.cases ?? [
        caseRecord({
          id: 'asset-case',
          domain: 'case.example',
          brandProfileIds: [PROFILE_ID],
          source: 'manual',
          createdAt: LATER,
          updatedAt: LATER,
        }),
      ],
    },
    [RELATIONSHIPS_KEY]: currentBrowserLocalDocument('relationship_observations', {
      observations: options.relationships ?? [relationshipFixture()],
    }),
  };
}

async function seedRegister(
  page: Page,
  destination = '/brands?view=assets',
  options: Parameters<typeof registerEntries>[0] = {},
) {
  await migrateLegacyBrowserData(page, registerEntries(options), { destination });
  await expect(page.getByRole('heading', {
    name: destination.startsWith('/brands') ? 'Brands' : 'Dashboard',
    exact: true,
  })).toBeVisible();
}

test('allowlist impact previews exact draft entries without saving or reclassifying workspace Cases', async ({ page }) => {
  await seedRegister(page, '/brands');
  const manager = page.getByRole('region', { name: 'Allowlist', exact: true });
  const before = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  const casesBefore = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  const requests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
  await manager.getByText('Preview domain exclusions', { exact: true }).click();
  const preview = manager.getByLabel('Domains to preview');
  await preview.fill('official.example\npartner.example\nallowlisted.example\nsub.allowlisted.example\ncase.example');
  const show = manager.getByRole('button', { name: 'Preview draft effect', exact: true });
  await show.click();
  const impact = manager.getByRole('region', { name: 'Domain exclusion impact', exact: true });
  await expect(impact.getByRole('heading')).toBeFocused();
  await expect(impact).toContainText('0 would be newly excluded');
  await manager.getByLabel('Add domains').fill('case.example');
  await show.click();
  await expect(impact).toContainText('0 would be newly excluded');
  await manager.getByRole('region', { name: 'Domains', exact: true }).getByRole('button', { name: 'Add', exact: true }).click();
  await expect(impact).toContainText('1 would be newly excluded');
  await expect(impact.getByRole('listitem').filter({ hasText: 'sub.allowlisted.example' })).toContainText('Draft: Not excluded');
  await expect(impact.getByRole('listitem').filter({ hasText: /^official\.example/u })).toContainText('Exact official-domain declaration');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 1920]) {
      await page.setViewportSize({ width, height: 844 }); await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) {
        await manager.evaluate(element => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 90, behavior: 'instant' }));
        await page.screenshot({ path: test.info().outputPath(`allowlist-${theme}-${width}.png`) });
      }
    }
  }
  await preview.fill('valid.example\nhttps://invalid.example/path');
  await show.click();
  await expect(impact.getByRole('listitem')).toHaveCount(0);
  await expect(impact).toContainText('No partial preview');
  await preview.fill(Array.from({ length: 51 }, (_, index) => `preview-${index}.example`).join('\n'));
  await show.click();
  await expect(impact.getByRole('listitem')).toHaveCount(50);
  await impact.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(impact.getByRole('listitem')).toHaveCount(1);
  await expect(impact.getByRole('heading')).toBeFocused();
  await preview.fill('');
  await manager.getByLabel('Add a retained Case domain').selectOption('case.example');
  await expect(preview).toHaveValue('case.example');
  expect(await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 })).toEqual(before);
  expect(await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).toEqual(casesBefore);
  expect(requests).toEqual([]);
});

async function rawCollectionSnapshot(page: Page, collection: string) {
  return page.evaluate(async ({ databaseName, collectionId }) => {
    const request = indexedDB.open(databaseName);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction(['manifests', 'records'], 'readonly');
      const manifestRequest = transaction.objectStore('manifests').get(collectionId);
      const recordsRequest = transaction.objectStore('records').index('collection').getAll(collectionId);
      const [manifest, records] = await Promise.all([
        new Promise<unknown>((resolve, reject) => {
          manifestRequest.onsuccess = () => resolve(manifestRequest.result);
          manifestRequest.onerror = () => reject(manifestRequest.error);
        }),
        new Promise<unknown[]>((resolve, reject) => {
          recordsRequest.onsuccess = () => resolve(recordsRequest.result as unknown[]);
          recordsRequest.onerror = () => reject(recordsRequest.error);
        }),
      ]);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => undefined;
      });
      return {
        manifest: JSON.stringify(manifest),
        records: records.map((record) => JSON.stringify(record)).sort(),
      };
    } finally {
      database.close();
    }
  }, { databaseName: DATABASE_NAME, collectionId: collection });
}

async function installFutureManifest(page: Page, collection: string) {
  await page.evaluate(async ({ databaseName, collectionId }) => {
    const request = indexedDB.open(databaseName);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction('manifests', 'readwrite');
      const store = transaction.objectStore('manifests');
      const getRequest = store.get(collectionId);
      const manifest = await new Promise<Record<string, unknown>>((resolve, reject) => {
        getRequest.onsuccess = () => resolve(getRequest.result as Record<string, unknown>);
        getRequest.onerror = () => reject(getRequest.error);
      });
      store.put({ ...manifest, schemaVersion: 99, futureMarker: 'preserve-byte-equivalent-values' });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => undefined;
      });
    } finally {
      database.close();
    }
  }, { databaseName: DATABASE_NAME, collectionId: collection });
}

test('renders the deterministic register as a desktop table and mobile cards in both compact widths', async ({ page }) => {
  await useTheme(page, 'dark');
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedRegister(page);

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('tab', { name: /Assets/u })).toHaveAttribute('aria-selected', 'true');
  const register = page.getByRole('region', { name: 'Brand asset register' });
  const registerTable = register.getByRole('table', { includeHidden: true });
  await expect(registerTable).toBeVisible();
  await expect(register.locator('.asset-cards')).toHaveCount(1);
  await expect(register.locator('.asset-cards')).toBeHidden();
  const officialRow = register.getByRole('row', { name: /official\.example/u });
  await expect(officialRow).toContainText('Official');
  await expect(officialRow).toContainText('Observed lead');
  await expect(register.getByRole('row', { name: /case\.example/u }).getByRole('link', { name: /Open Case asset-case/u })).toHaveAttribute('href', '/cases?case=asset-case');
  const relationshipLink = officialRow.getByRole('link', { name: /Open retained relationship/u });
  await expect(relationshipLink).toHaveAttribute('href', /\/monitor\?view=relationships&observation=relationship-/u);
  await expect(register).not.toContainText('ns1.shared.example');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(registerTable).toHaveCount(1);
    await expect(registerTable).toBeHidden();
    await expect(register.locator('.asset-cards')).toBeVisible();
    await expect(register.locator('.asset-cards article', { hasText: 'official.example' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

test('restores categorical filter URLs, keeps text filtering ephemeral, and normalizes invalid values in the controls', async ({ page }) => {
  await useTheme(page, 'light');
  await seedRegister(page, '/brands?view=assets&assetClass=authored_partner&assetSource=profile&assetEvidence=not_applicable');
  const register = page.getByRole('region', { name: 'Brand asset register' });
  const classification = register.getByRole('combobox', { name: 'Classification', exact: true });
  const source = register.getByRole('combobox', { name: 'Source', exact: true });
  const evidence = register.getByRole('combobox', { name: 'Observation evidence', exact: true });
  const textFilter = register.getByRole('searchbox', { name: 'Domain contains', exact: true });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(classification).toHaveValue('authored_partner');
  await expect(source).toHaveValue('profile');
  await expect(evidence).toHaveValue('not_applicable');
  await expect(register.getByRole('status').filter({ hasText: '1 matching asset row' })).toBeVisible();

  const unexpectedRequests: string[] = [];
  const origin = new URL(page.url()).origin;
  const requestListener = (request: { url(): string }) => {
    const url = new URL(request.url());
    if (url.origin !== origin || url.pathname.startsWith('/api/')) unexpectedRequests.push(request.url());
  };
  page.on('request', requestListener);
  await classification.selectOption('retained_case_scope');
  await expect(page).toHaveURL(/assetClass=retained_case_scope/u);
  await expect(classification).toBeFocused();
  await source.selectOption('all');
  await expect(page).not.toHaveURL(/assetSource=/u);
  await expect(source).toBeFocused();
  await textFilter.fill('case.example');
  expect(new URL(page.url()).searchParams.has('domain')).toBe(false);
  expect(new URL(page.url()).searchParams.has('q')).toBe(false);
  await expect(register.getByRole('status').filter({ hasText: '1 matching asset row' })).toBeVisible();
  page.off('request', requestListener);
  expect(unexpectedRequests).toEqual([]);
  await page.reload();
  await expect(classification).toHaveValue('retained_case_scope');
  await expect(source).toHaveValue('all');
  await expect(textFilter).toHaveValue('');

  await page.goto('/brands?view=assets&assetClass=invalid&assetSource=invalid&assetEvidence=invalid&assetPage=-1');
  await expect(classification).toHaveValue('all');
  await expect(source).toHaveValue('all');
  await expect(evidence).toHaveValue('all');
  await expect(register.getByRole('status').filter({ hasText: /matching asset rows/u })).toBeVisible();
});

test('supports keyboard view selection and returns focus to the register heading after URL pagination', async ({ page }) => {
  const officialDomains = Array.from({ length: 55 }, (_, index) => `asset-${String(index).padStart(2, '0')}.example`);
  await seedRegister(page, '/brands', {
    profile: profileFixture({ officialDomains, approvedPartnerDomains: [], allowlistedDomains: [] }),
    cases: [],
    relationships: [],
  });
  const overview = page.getByRole('tab', { name: 'Overview' });
  await overview.focus();
  await overview.press('ArrowRight');
  const assets = page.getByRole('tab', { name: /Assets/u });
  await expect(assets).toHaveAttribute('aria-selected', 'true');
  await expect(assets).toBeFocused();

  await page.goto('/brands?view=assets&assetPage=2');
  const register = page.getByRole('region', { name: 'Brand asset register' });
  await expect(register.getByRole('status').filter({ hasText: 'Showing 51–55' })).toBeVisible();
  await register.getByRole('button', { name: 'Previous' }).click();
  await expect(page).not.toHaveURL(/assetPage=/u);
  await expect(register.getByRole('heading', { name: 'Brand asset register' })).toBeFocused();
  await expect(register.getByRole('status').filter({ hasText: 'Showing 1–50' })).toBeVisible();
});

test('keeps no-active and unresolved-active states distinct without clearing the saved reference', async ({ page }) => {
  await seedRegister(page, '/brands?view=assets', { activeId: null });
  await expect(page.getByRole('heading', { name: 'No active Brand Profile' })).toBeVisible();

  await seedRegister(page, '/brands?view=assets', { activeId: 'missing-profile' });
  await expect(page.getByRole('heading', { name: 'Active profile unresolved' })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), ACTIVE_KEY)).toBe('missing-profile');
});

test('shows independent Case and relationship failures as unavailable counts rather than zero', async ({ page }) => {
  await seedRegister(page, '/dashboard');
  await failBrowserLocalCollectionReads(page, 'cases');
  await failBrowserLocalCollectionReads(page, 'relationship_observations');
  await page.getByRole('navigation', { name: 'Console' }).getByRole('link', { name: 'Brands' }).click();
  await page.getByRole('tab', { name: /Assets/u }).click();
  const register = page.getByRole('region', { name: 'Brand asset register' });
  await expect(register.getByRole('alert').filter({ hasText: 'Cases could not be read' })).toBeVisible();
  await expect(register.getByRole('alert').filter({ hasText: 'Retained relationship observations could not be read' })).toBeVisible();
  await expect(register.getByText('Unavailable / Unavailable', { exact: true })).toHaveCount(2);
  await expect(register.getByText('official.example', { exact: true }).first()).toBeVisible();
});

test('refuses a future relationship manifest without changing its manifest, records, or active preference', async ({ page }) => {
  await seedRegister(page, '/dashboard');
  await readBrowserLocalCollection(page, 'relationship_observations', { minimumRecords: 1 });
  await installFutureManifest(page, 'relationship_observations');
  const before = await rawCollectionSnapshot(page, 'relationship_observations');
  const activeBefore = await page.evaluate((key) => localStorage.getItem(key), ACTIVE_KEY);

  await page.getByRole('navigation', { name: 'Console' }).getByRole('link', { name: 'Brands' }).click();
  await page.getByRole('tab', { name: /Assets/u }).click();
  await expect(page.getByRole('region', { name: 'Brand asset register' }).getByRole('alert').filter({ hasText: 'Retained relationship observations could not be read' })).toBeVisible();

  const after = await rawCollectionSnapshot(page, 'relationship_observations');
  expect(after).toEqual(before);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), ACTIVE_KEY)).toBe(activeBefore);
});
