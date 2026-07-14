import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { boundingBox, expectNoHorizontalOverflow, pseudoContent, runBulkScan } from './helpers';

// Default fixtures use dotless values so classifyQuery rejects them before
// any upstream work. Tests that need completed result data install an explicit
// local /api/lookup route before using domain-shaped values.
const invalidDomains = (count: number) => Array.from({ length: count }, (_, i) => `bad-domain-${i + 1}`);

// Only this spec legitimately produces Chrome's synthetic "responded with a
// status of 400" console noise (one per deliberately-rejected domain in
// runBulkScan) as expected, already-handled behavior - every other spec
// keeps the shared fixture's console guard fully strict.
test.use({ allowExpectedBulkLookup400Noise: true });

test.beforeEach(async ({ page }) => {
  await page.goto('/bulk');
});

test('the scan button only takes the high-contrast primary treatment once ready', async ({ page }) => {
  const scanButton = page.locator('.queue-actions button.primary');
  await expect(scanButton).toBeDisabled();
  expect(await scanButton.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');

  await page.locator('#domains').fill(invalidDomains(1).join('\n'));
  await expect(scanButton).toBeEnabled();
  expect(await scanButton.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('gradient');
});

test('a small scan completes and reports the correct error count', async ({ page }) => {
  const domains = invalidDomains(3);
  await runBulkScan(page, domains);

  await expect(page.locator('.filters button', { hasText: 'all' }).locator('span')).toHaveText(String(domains.length));
  await expect(page.locator('.filters button', { hasText: 'errors' }).locator('span')).toHaveText(String(domains.length));
});

test('results stay a sortable table at desktop width', async ({ page }) => {
  const domains = invalidDomains(5);
  await runBulkScan(page, domains);

  const thead = page.locator('.results-table thead');
  const theadBox = await boundingBox(thead);
  expect(theadBox.height).toBeGreaterThan(10);

  const riskHeader = page.locator('.results-table th', { has: page.getByRole('button', { name: /^Risk/ }) });
  await expect(riskHeader).toHaveAttribute('aria-sort', 'descending');
  await riskHeader.getByRole('button').click();
  await expect(riskHeader).toHaveAttribute('aria-sort', 'ascending');

  await expect(page.locator('.results-table tbody tr')).toHaveCount(domains.length);
  await expectNoHorizontalOverflow(page);
});

test('results become labelled stacked cards at mobile width, with compact and full-width fields', async ({ page }) => {
  const domains = invalidDomains(5);
  await runBulkScan(page, domains);

  await page.setViewportSize({ width: 390, height: 844 });

  const thead = page.locator('.results-table thead');
  const theadBox = await boundingBox(thead);
  expect(theadBox.width).toBeLessThanOrEqual(2);
  expect(theadBox.height).toBeLessThanOrEqual(2);

  const row = page.locator('.results-table tbody tr').first();
  const rowBox = await boundingBox(row);

  const compactLabels = ['Registration', 'Risk', 'Opportunity'];
  for (const label of compactLabels) {
    const cell = row.locator(`td[data-label="${label}"]`);
    const cellBox = await boundingBox(cell);
    expect(cellBox.width, `${label} should be compact`).toBeLessThan(rowBox.width * 0.5);
    expect(await pseudoContent(cell, '::before')).toContain(label);
  }

  const fullWidthLabels = ['Website', 'Registrar', 'Mutation', 'Actions'];
  for (const label of fullWidthLabels) {
    const cell = row.locator(`td[data-label="${label}"]`);
    const cellBox = await boundingBox(cell);
    expect(cellBox.width, `${label} should be full-width`).toBeGreaterThan(rowBox.width * 0.85);
    expect(await pseudoContent(cell, '::before')).toContain(label);
  }

  await expectNoHorizontalOverflow(page);
});

test('a 101-result scan paginates 100 then 1, and Previous/Next update the page', async ({ page }) => {
  const domains = invalidDomains(101);
  await runBulkScan(page, domains);

  const pagination = page.getByRole('navigation', { name: 'Bulk result pages' });
  const previousButton = pagination.getByRole('button', { name: 'Previous' });
  const nextButton = pagination.getByRole('button', { name: 'Next' });

  await expect(page.locator('.results-table tbody tr')).toHaveCount(100);
  await expect(pagination).toContainText('Page 1 of 2');
  await expect(previousButton).toBeDisabled();
  await expect(nextButton).toBeEnabled();

  await nextButton.click();
  await expect(page.locator('.results-table tbody tr')).toHaveCount(1);
  await expect(pagination).toContainText('Page 2 of 2');
  await expect(nextButton).toBeDisabled();
  await expect(previousButton).toBeEnabled();

  await previousButton.click();
  await expect(page.locator('.results-table tbody tr')).toHaveCount(100);
  await expect(pagination).toContainText('Page 1 of 2');
});

test('IDN evidence renders and filters without changing the risk score', async ({ page }) => {
  await page.evaluate(() => {
    const profile = {
      id: 'idn-profile', name: 'Example Brand', officialDomains: ['paypal.com'], productNames: [], tlds: ['com'],
      approvedPartnerDomains: [], allowlistedDomains: [], allowlistedRegistrars: [], dkimSelectors: [],
      trademarkOwner: '', trademarkRegistration: '', officialFaviconHash: '', officialFaviconPHash: '',
      createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
    };
    localStorage.setItem('whois-rdap-brand-profiles-v1', JSON.stringify([profile]));
    localStorage.setItem('whois-rdap-active-brand-profile-v1', profile.id);
  });
  await page.reload();
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      availability: {
        domain: 'xn--ypal-43d9g.com', state: 'registered', confidence: 'high',
        nameservers: [], privacyProtected: null, activityStatus: null,
      },
      diagnostics: { rdap: { status: 'unsupported' }, whois: { status: 'skipped' }, availability: { status: 'complete' } },
    }),
  }));

  await runBulkScan(page, ['xn--ypal-43d9g.com']);
  const row = page.locator('.results-table tbody tr');
  await expect(row.getByText('Unicode: раypal.com', { exact: true })).toBeVisible();
  await expect(row.getByText('Mixed writing scripts', { exact: true })).toBeVisible();
  await expect(row.getByText('Official-domain skeleton match', { exact: true })).toBeVisible();
  await expect(row.locator('td[data-label="Risk"]')).toHaveText('10');

  await page.getByRole('button', { name: 'IDN / confusable' }).click();
  await expect(row).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test('risk model v4 exposes cross-family corroboration in Bulk triage', async ({ page }) => {
  await page.evaluate(() => {
    const profile = {
      id: 'risk-profile', name: 'Example profile', officialDomains: ['official.example'], productNames: [], tlds: ['example'],
      approvedPartnerDomains: [], allowlistedDomains: [], allowlistedRegistrars: [], dkimSelectors: [],
      trademarkOwner: '', trademarkRegistration: '', officialFaviconHash: 'a'.repeat(64), officialFaviconPHash: '', pageBaseline: null,
      createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
    };
    localStorage.setItem('whois-rdap-brand-profiles-v1', JSON.stringify([profile]));
    localStorage.setItem('whois-rdap-active-brand-profile-v1', profile.id);
    sessionStorage.setItem('whoisleuth:candidate-handoff:v1', JSON.stringify({
      version: 1,
      createdAt: '2026-07-13T00:00:00.000Z',
      source: 'typosquat',
      candidates: [{ domain: 'candidate.example', source: 'official.example', mutationTypes: ['dictionary'] }],
    }));
  });
  await page.reload();
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      availability: {
        domain: 'candidate.example', state: 'registered', confidence: 'high',
        faviconHash: 'a'.repeat(64), externalAssetHosts: ['official.example'],
        phishingLanguageMatch: 'verify your account', hasPasswordField: true,
      },
      diagnostics: { rdap: { status: 'complete' }, whois: { status: 'skipped' }, availability: { status: 'complete' } },
    }),
  }));

  await runBulkScan(page, ['candidate.example']);
  const row = page.locator('.results-table tbody tr');
  const riskCell = row.locator('td[data-label="Risk"]');
  await expect(riskCell).toHaveText('85');
  await expect(riskCell).toHaveAttribute('title', /Corroborating context across 3 distinct evidence families \+20/);
  await expect(riskCell).toHaveAttribute('title', /Risk model v4/);

  await page.getByRole('button', { name: 'high risk' }).click();
  await expect(row).toBeVisible();

  await page.getByLabel('Defensive format').selectOption('hosts');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export 1 high-risk indicator' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^whoisleuth-defensive-domains-\d{4}-\d{2}-\d{2}\.txt$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  const content = await readFile(path!, 'utf8');
  expect(content).toContain('Review before use. Heuristic findings can include false positives.');
  expect(content).toContain('0.0.0.0 candidate.example');
  expect(content).not.toContain('official.example\n');
  await expect(page.getByRole('status').filter({ hasText: 'Check for false positives before use' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test('deep results present bounded relationship evidence including exact native certificate identity', async ({ page }) => {
  await page.evaluate(() => {
    const profile = {
      id: 'relationship-profile', name: 'Example profile', officialDomains: ['official.example'], productNames: [], tlds: ['example'],
      approvedPartnerDomains: [], allowlistedDomains: [], allowlistedRegistrars: [], dkimSelectors: [],
      trademarkOwner: '', trademarkRegistration: '', officialFaviconHash: '', officialFaviconPHash: '', pageBaseline: null,
      createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
    };
    localStorage.setItem('whois-rdap-brand-profiles-v1', JSON.stringify([profile]));
    localStorage.setItem('whois-rdap-active-brand-profile-v1', profile.id);
  });
  await page.reload();
  await page.route('**/api/lookup?*', async (route) => {
    const domain = new URL(route.request().url()).searchParams.get('q') || '';
    const shared = domain !== 'third.example';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        availability: {
          domain, state: 'registered', confidence: 'high', activityStatus: 'active', deepScanComplete: true,
          nameservers: shared ? ['ns2.shared.example', 'ns1.shared.example'] : ['ns.third.example'],
          faviconHash: shared ? 'a'.repeat(64) : 'b'.repeat(64),
          externalAssetHosts: domain === 'third.example' ? ['static.official.example'] : [],
          dns: { status: 'complete', records: { a: [shared ? '203.0.113.9' : '203.0.113.10'], aaaa: [], ns: [] } },
          pageIdentity: {
            fingerprints: {
              identifiers: { values: shared ? [{ type: 'tag-container', value: 'GTM-SHARED' }] : [] },
            },
          },
          tls: shared ? {
            source: 'tls', profileVersion: 1, status: 'success',
            certificate: { fingerprintSha256: 'c'.repeat(64) },
          } : null,
        },
        diagnostics: { rdap: { status: 'complete' }, whois: { status: 'complete' }, availability: { status: 'complete' } },
      }),
    });
  });

  await page.getByLabel('Scan mode').selectOption('deep');
  await runBulkScan(page, ['first.example', 'second.example', 'third.example']);

  const section = page.getByRole('region', { name: '6 observed relationships' });
  await expect(section).toBeVisible();
  await expect(section.getByText('Shared nameserver set', { exact: true })).toBeVisible();
  await expect(section.getByText('Shared IP address', { exact: true })).toBeVisible();
  await expect(section.getByText('Shared TLS certificate', { exact: true })).toBeVisible();
  await expect(section.getByText('Exact leaf-certificate SHA-256', { exact: true })).toBeVisible();
  await expect(section.getByText('Shared tracking identifier', { exact: true })).toBeVisible();
  await expect(section.getByText('Similar favicon', { exact: true })).toBeVisible();
  await expect(section.getByText('Official asset relationship', { exact: true })).toBeVisible();
  await expect(section).toContainText('not ownership or maliciousness conclusions');
  await section.getByText('Interpretation limits').click();
  await expect(section).toContainText('does not establish common control');

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});
