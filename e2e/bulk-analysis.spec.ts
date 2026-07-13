import { expect, test } from './fixtures';
import { boundingBox, expectNoHorizontalOverflow, pseudoContent, runBulkScan } from './helpers';

// Dotless values - classifyQuery rejects them with a 400 before any
// RDAP/WHOIS/DNS/CT call, so every "scan" below runs entirely against the
// local server with no upstream network access.
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
