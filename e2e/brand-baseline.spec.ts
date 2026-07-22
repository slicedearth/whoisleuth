import { expect, test } from './fixtures';
import { failBrowserLocalManifestWrites, migrateLegacyBrowserData, readBrowserLocalCollection } from './helpers';

const PROFILES_KEY = 'whois-rdap-brand-profiles-v1';
const ACTIVE_KEY = 'whois-rdap-active-brand-profile-v1';
const ISO = '2026-07-13T04:05:06.000Z';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

function profileFixture() {
  return {
    id: 'profile-1',
    name: 'Stored Brand',
    officialDomains: ['stored.example'],
    productNames: [],
    tlds: ['example'],
    approvedPartnerDomains: [],
    allowlistedDomains: [],
    allowlistedRegistrars: [],
    dkimSelectors: [],
    trademarkOwner: '',
    trademarkRegistration: '',
    officialFaviconHash: '',
    officialFaviconPHash: '',
    pageBaseline: null,
    createdAt: ISO,
    updatedAt: ISO,
  };
}

function availabilityFixture() {
  return {
    state: 'registered',
    domain: 'example.com',
    pageTitle: 'Official account centre',
    faviconHash: 'd'.repeat(64),
    faviconPHash: '1234567890abcdef',
    pageIdentity: {
      identityVersion: 3,
      version: 1,
      status: 'success',
      observedAt: ISO,
      scanMode: 'deep',
      source: 'html',
      complete: true,
      truncated: false,
      canonical: { url: 'https://www.example.com/private/path?token=secret' },
      fingerprints: {
        fingerprintVersion: 1,
        exact: { algorithm: 'sha256', value: 'e'.repeat(64), private: 'must-not-persist' },
        normalizedHtml: { algorithm: 'sha256', value: SHA_A, tokenCount: 20, truncated: false },
        visibleText: { algorithm: 'simhash64-v1', value: '1234567890abcdef', tokenCount: 12, featureCount: 10, truncated: false },
        domStructure: { algorithm: 'sha256', value: SHA_B, nodeCount: 15, parser: 'static-tag-sequence-v1', truncated: false },
        formStructure: { algorithm: 'sha256', value: SHA_C, formCount: 1, controlCount: 2, truncated: false },
        resourceHosts: { algorithm: 'set-sha256', value: SHA_B, values: ['cdn.example.net'], truncated: false },
        identifiers: { algorithm: 'set-sha256', value: SHA_C, values: [{ type: 'google-analytics', value: 'G-ABC123' }], truncated: false },
        complete: true,
        truncated: false,
        limitations: ['must-not-persist'],
      },
      rawHtml: '<main>must-not-persist</main>',
      diagnostics: { private: 'must-not-persist' },
    },
    http: { finalUrl: 'https://example.com/private/path?token=secret' },
    rawHtml: '<main>must-not-persist</main>',
  };
}

async function cleanBrandStorage(page: import('@playwright/test').Page) {
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, {
    [PROFILES_KEY]: null,
    [ACTIVE_KEY]: null,
  });
}

async function openProfileForm(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'New profile' }).click();
  await page.getByLabel('Brand name').fill('Example Brand');
  await page.getByLabel('Official domains').fill('example.com');
}

test('captures and persists only a bounded official-site baseline after profile save', async ({ page }) => {
  await page.route('**/api/availability?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(availabilityFixture()),
  }));
  await cleanBrandStorage(page);
  await openProfileForm(page);

  await page.getByRole('button', { name: 'Capture official-site baseline' }).click();
  await expect(page.getByRole('status')).toHaveText(/Captured a complete page baseline.*Save the profile/i);
  await expect(page.getByText('Official account centre', { exact: true })).toBeVisible();
  await expect(page.getByText('www.example.com', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save profile' }).click();

  await expect(page.getByText('Page baseline', { exact: true })).toBeVisible();
  await expect(page.getByText(/example\.com · Complete/)).toBeVisible();
  const persisted = (await readBrowserLocalCollection(page, 'brand_profiles')).records[0].value;
  expect(persisted.pageBaseline).toMatchObject({
    baselineVersion: 1,
    domain: 'example.com',
    lookupDomain: 'example.com',
    observedAt: ISO,
    pageIdentityVersion: 3,
    fingerprintVersion: 1,
    pageTitle: 'Official account centre',
    canonicalHost: 'www.example.com',
    complete: true,
    truncated: false,
  });
  expect(persisted.pageBaseline.resourceHosts.values).toEqual(['cdn.example.net']);
  expect(persisted.pageBaseline.trackingIdentifiers.values).toEqual([{ type: 'google-analytics', value: 'G-ABC123' }]);
  const serialized = JSON.stringify(persisted);
  expect(serialized).not.toMatch(/rawHtml|must-not-persist|private\/path|token=|diagnostics|limitations|"exact"/);
});

test('a baseline is discarded when it no longer belongs to an official domain', async ({ page }) => {
  await page.route('**/api/availability?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(availabilityFixture()),
  }));
  await cleanBrandStorage(page);
  await openProfileForm(page);
  await page.getByRole('button', { name: 'Capture official-site baseline' }).click();
  await page.getByLabel('Official domains').fill('different.example');
  await page.getByRole('button', { name: 'Save profile' }).click();

  const persisted = (await readBrowserLocalCollection(page, 'brand_profiles')).records[0].value;
  expect(persisted.officialDomains).toEqual(['different.example']);
  expect(persisted.pageBaseline).toBeNull();
});

test('an inconclusive recapture preserves the existing form baseline', async ({ page }) => {
  let captureCount = 0;
  await page.route('**/api/availability?*', async (route) => {
    captureCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(captureCount === 1 ? availabilityFixture() : { state: 'registered', pageIdentity: null }),
    });
  });
  await cleanBrandStorage(page);
  await openProfileForm(page);
  await page.getByRole('button', { name: 'Capture official-site baseline' }).click();
  await page.getByRole('button', { name: 'Update official-site baseline' }).click();
  await expect(page.getByRole('status')).toHaveText(/existing baseline is unchanged/i);
  await expect(page.getByText('Official account centre', { exact: true })).toBeVisible();
});

test('official-site baseline controls fit a narrow mobile viewport without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await cleanBrandStorage(page);
  await openProfileForm(page);
  const fieldset = page.getByRole('group', { name: 'Official-site identity' });
  await expect(fieldset).toBeVisible();
  const layout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  const box = await fieldset.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  const buttonBox = await page.getByRole('button', { name: 'Capture official-site baseline' }).boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(buttonBox!.x).toBeGreaterThanOrEqual(box!.x);
  expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(box!.x + box!.width);
});

test('a future Brand Profile schema is never overwritten by an older app', async ({ page }) => {
  await cleanBrandStorage(page);
  const future = { version: 99, profiles: [{ future: true }] };
  await migrateLegacyBrowserData(page, { [PROFILES_KEY]: future });

  await expect(page.getByRole('heading', { name: 'Browser-local data unavailable' })).toBeVisible();
  await expect(page.getByText(/created by a newer app version/)).toBeVisible();
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), PROFILES_KEY);
  expect(stored).toEqual(future);
});

test('a browser quota failure reports a stable message and preserves the previous profiles', async ({ page }) => {
  await cleanBrandStorage(page);
  const stored = [profileFixture()];
  await migrateLegacyBrowserData(page, { [PROFILES_KEY]: stored });
  await failBrowserLocalManifestWrites(page, 'brand_profiles');

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Brand name').fill('Changed name');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status')).toContainText('out of storage space');
  const after = await readBrowserLocalCollection(page, 'brand_profiles');
  expect(after.records.map((entry) => entry.value)).toEqual(stored);
});
