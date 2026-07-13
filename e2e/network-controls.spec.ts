import { expect, test } from './fixtures';

test.use({ allowExpectedLookup429Noise: true });

function disabledCapabilityReport(features: string[]) {
  return {
    version: 1,
    runtime: 'express',
    authoritative: true,
    features: features.map((id) => ({
      id,
      status: 'disabled',
      execution: 'hosted',
      scanModes: id === 'lookup' ? ['fast', 'deep'] : [],
      reason: `${id.replaceAll('_', ' ')} is disabled by deployment policy.`,
    })),
    limitations: [],
  };
}

async function mockCapabilities(page: import('@playwright/test').Page, features: string[]) {
  await page.route('**/api/capabilities', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(disabledCapabilityReport(features)),
  }));
}

test('a concurrency circuit response degrades Lookup with a retryable message', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 429,
    contentType: 'application/json',
    headers: { 'Retry-After': '1' },
    body: JSON.stringify({
      error: 'This session already has the maximum number of network operations in progress. Please retry shortly.',
      errorCode: 'NETWORK_CONCURRENCY_LIMITED',
      operationClass: 'registry_deep',
      limitScope: 'session',
    }),
  }));

  await page.goto('/lookup');
  await page.getByLabel('Domain, IP address, ASN, or domain list').fill('example.invalid');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.getByRole('alert')).toHaveText(/maximum number of network operations.*retry shortly/i);
  await expect(page.getByRole('button', { name: 'Run lookup' })).toBeEnabled();
});

test('the capability endpoint reports honest in-memory concurrency scope', async ({ request }) => {
  const response = await request.get('/api/capabilities');
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.controls).toEqual({
    concurrency: {
      mode: 'in_memory',
      scope: 'process',
      distributed: false,
      classes: expect.arrayContaining([
        expect.objectContaining({ id: 'registry_light', sessionLimit: 12, runtimeLimit: 36 }),
        expect.objectContaining({ id: 'registry_deep', sessionLimit: 4, runtimeLimit: 12 }),
      ]),
    },
  });
});

test('a disabled Lookup capability prevents single and Bulk submissions', async ({ page }) => {
  await mockCapabilities(page, ['lookup']);
  await page.goto('/lookup');
  await page.getByLabel('Domain, IP address, ASN, or domain list').fill('example.invalid');
  await expect(page.getByText('lookup is disabled by deployment policy.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run lookup' })).toBeDisabled();

  await page.goto('/bulk');
  await page.getByLabel('Domains').fill('example.invalid');
  await expect(page.getByRole('button', { name: 'Scan 1 domain' })).toBeDisabled();
});

test('disabled certificate and website capabilities degrade their own controls only', async ({ page }) => {
  await mockCapabilities(page, ['certificate_transparency', 'website_probe']);
  await page.goto('/discover');
  await page.getByRole('tab', { name: 'Certificates' }).click();
  await expect(page.getByRole('button', { name: 'Search certificates' })).toBeDisabled();
  await expect(page.getByText('certificate transparency is disabled by deployment policy.', { exact: true })).toBeVisible();

  await page.goto('/brands');
  const newProfileButton = page.getByRole('button', { name: 'New profile' });
  await expect(newProfileButton).toHaveCSS('color', 'rgb(7, 16, 28)');
  await expect(newProfileButton).toHaveCSS('background-image', /linear-gradient/);
  await newProfileButton.click();
  await expect(page.getByRole('button', { name: 'Fetch from official domain' })).toBeDisabled();
  await expect(page.getByText('website probe is disabled by deployment policy.', { exact: true })).toBeVisible();
  const saveProfileButton = page.getByRole('button', { name: 'Save profile' });
  await expect(saveProfileButton).toBeEnabled();
  await expect(saveProfileButton).toHaveCSS('color', 'rgb(7, 16, 28)');
  await expect(saveProfileButton).toHaveCSS('background-image', /linear-gradient/);
});

test('an incomplete deep scan is stored conservatively so skipped probes cannot erase prior evidence', async ({ page }) => {
  await mockCapabilities(page, ['dns_intelligence', 'website_probe']);
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      availability: {
        domain: 'example.invalid',
        state: 'registered',
        confidence: 'high',
        deepScanComplete: false,
        activityStatus: 'unknown',
        websiteProbeStatus: 'skipped',
        dns: { status: 'skipped', records: {}, hasMx: null, hasSpf: null, hasDmarc: null },
      },
      diagnostics: {
        version: 3,
        rdap: { status: 'success' },
        whois: { status: 'complete' },
        availability: { status: 'complete', resultState: 'registered' },
      },
    }),
  }));

  await page.goto('/bulk');
  await page.getByLabel('Domains').fill('example.invalid');
  await page.getByLabel('Scan mode').selectOption('deep');
  await page.getByRole('button', { name: 'Scan 1 domain' }).click();
  await expect(page.getByRole('status').first()).toHaveText('Completed 1 of 1 lookups.');
  await page.getByLabel('Watchlist name').fill('Policy-safe baseline');
  await page.getByRole('button', { name: 'Save to Monitor' }).click();

  const storedDepth = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('whois-rdap-watchlist-v1') || '{}');
    return store['Policy-safe baseline']?.results?.[0]?.scanDepth;
  });
  expect(storedDepth).toBe('fast');
});
