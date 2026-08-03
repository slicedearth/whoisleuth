import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { boundingBox, expectNoHorizontalOverflow, expectNoHorizontalScrollContainers, failBrowserLocalReads, migrateLegacyBrowserData, pseudoContent, readBrowserLocalCollection, runBulkScan } from './helpers';

// Default fixtures use dotless values so classifyQuery rejects them before
// any upstream work. Tests that need completed result data install an explicit
// local /api/lookup route before using domain-shaped values.
const invalidDomains = (count: number) => Array.from({ length: count }, (_, i) => `bad-domain-${i + 1}`);

async function captureDownloads(
  page: import('@playwright/test').Page,
  action: () => Promise<void>,
  expectedCount = 3,
) {
  const downloads: import('@playwright/test').Download[] = [];
  const listener = (download: import('@playwright/test').Download) => downloads.push(download);
  page.on('download', listener);
  try {
    await action();
    await expect.poll(() => downloads.length).toBe(expectedCount);
    return downloads;
  } finally {
    page.off('download', listener);
  }
}

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

test('offers bounded request pacing and preserves the operator choice during console navigation', async ({ page }) => {
  const pacing = page.getByLabel('Request pacing');
  await expect(pacing).toHaveValue('standard');
  await expect(page.locator('.mode-help')).toContainText('at most 12 lookups run in parallel');

  await pacing.selectOption('gentle');
  await expect(page.locator('.mode-help')).toContainText('at most 2 lookups run in parallel');
  await page.locator('#console-navigation').getByRole('link', { name: /^Dashboard/u }).click();
  await page.locator('#console-navigation').getByRole('link', { name: /^Bulk/u }).click();
  await expect(page.getByLabel('Request pacing')).toHaveValue('gentle');

  await page.getByLabel('Scan mode').selectOption('deep');
  await expect(page.locator('.mode-help')).toContainText('at most 1 lookup runs in parallel');
});

test('keeps the Bulk queue available when browser-local context cannot be loaded', async ({ page }) => {
  await expect(page.locator('#domains')).toBeEditable();
  await failBrowserLocalReads(page);
  const navigation = page.locator('#console-navigation');
  await navigation.getByRole('link', { name: /^Dashboard/u }).click();
  await navigation.getByRole('link', { name: /^Bulk/u }).click();

  await expect(page.locator('.local-context-status')).toContainText('browser-local profile, shortlist, case, relationship, or saved-session context could not be loaded');
  await expect(page.locator('#domains')).toBeEditable();
});

test('a small scan completes and reports the correct error count', async ({ page }) => {
  const domains = invalidDomains(3);
  await runBulkScan(page, domains);

  await expect(page.locator('.filters button', { hasText: 'all' }).locator('span')).toHaveText(String(domains.length));
  await expect(page.locator('.filters button', { hasText: 'errors' }).locator('span')).toHaveText(String(domains.length));
  await expect(page.locator('.results-table .confidence')).toHaveText(Array(domains.length).fill('unknown confidence'));
  const outcomes = page.locator('.outcomes');
  await expect(outcomes).toHaveAttribute('aria-label', 'Settled scan outcomes');
  await expect(outcomes.locator('div', { hasText: 'Failed' })).toContainText(String(domains.length));
  await expect(outcomes.locator('div', { hasText: 'Pending' })).toContainText('0');
});

test('keeps mobile Bulk review focused while making secondary tools discoverable', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  const domains = invalidDomains(3);
  await runBulkScan(page, domains);

  const workspaceToggle = page.getByRole('button', { name: /Workspace tools/u });
  await expect(workspaceToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('heading', { name: 'Saved Bulk sessions' })).toBeHidden();

  const resultView = page.getByRole('group', { name: 'Bulk result view' });
  await expect(resultView.getByRole('button', { name: 'Review', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Bulk review cockpit' })).toBeVisible();
  await expect(page.locator('.results-table')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(6_000);

  const filtersToggle = page.getByRole('button', { name: /^Filters 0$/u });
  await expect(page.getByLabel('Source coverage')).toBeHidden();
  await filtersToggle.click();
  await expect(page.getByLabel('Source coverage')).toBeVisible();
  await expect(filtersToggle).toHaveAttribute('aria-expanded', 'true');
  await filtersToggle.click();

  await resultView.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator('.results-table')).toBeVisible();
  const firstRow = page.locator('.results-table tbody tr').first();
  const websiteCell = firstRow.locator('td[data-label="Website"]');
  await expect(websiteCell).toBeHidden();
  await firstRow.getByRole('button', { name: `Show details for ${domains[0]}` }).click();
  await expect(websiteCell).toBeVisible();

  await resultView.getByRole('button', { name: 'Analysis', exact: true }).click();
  await expect(page.getByRole('button', { name: /Result distribution/u })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Lookalike mail exposure' })).toBeHidden();
  const mailExposureToggle = page.getByRole('button', { name: /Mail exposure/u });
  await mailExposureToggle.click();
  await expect(mailExposureToggle).toHaveAttribute('aria-expanded', 'true');

  await expectNoHorizontalOverflow(page);
  await expectNoHorizontalScrollContainers(page.locator('#results'));
});

test('filters, groups, and selected-only actions use compact observed evidence', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => {
    const domain = new URL(route.request().url()).searchParams.get('q') || '';
    const limited = domain.startsWith('limited');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        availability: {
          applicable: true,
          domain,
          state: limited ? 'registered' : 'available',
          confidence: 'high',
          registrar: limited ? { name: 'Example Registrar' } : null,
          createdDate: limited ? '2026-07-20T00:00:00.000Z' : null,
          nameservers: limited ? ['ns1.shared.example'] : [],
          hasMx: limited,
          hasSpf: limited,
          hasDmarc: false,
        },
        diagnostics: {
          version: 7,
          rdap: { status: limited ? 'partial' : 'complete' },
          whois: { status: 'skipped' },
          availability: { status: 'complete' },
        },
      }),
    });
  });
  await runBulkScan(page, ['limited-one.example', 'available-two.example']);

  await page.getByLabel('Source coverage').selectOption('limited');
  await expect(page.locator('.results-table tbody tr')).toHaveCount(1);
  await expect(page.getByText('1 of 2 results matched')).toBeVisible();

  await page.getByLabel('Group summary').selectOption('nameserver');
  const groups = page.getByRole('region', { name: '1 observed group' });
  await expect(groups).toContainText('ns1.shared.example');
  await groups.getByRole('button', { name: 'Select group' }).click();
  await expect(page.getByText('1 selected in the filtered set')).toBeVisible();

  const stored = await readBrowserLocalCollection(page, 'shortlist', { minimumRecords: 1 });
  expect(stored.records[0]?.value).toMatchObject({ domain: 'limited-one.example' });
  await page.getByRole('region', { name: 'Undo analyst change' }).getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('1 selected in the filtered set')).toBeHidden();
  await groups.getByRole('button', { name: 'Select group' }).click();
  await expect(page.getByText('1 selected in the filtered set')).toBeVisible();

  const downloads = await captureDownloads(
    page,
    () => page.getByRole('button', { name: 'Export selected CSV' }).click(),
    2,
  );
  const download = downloads.find((item) => item.suggestedFilename().endsWith('.csv'));
  const manifest = downloads.find((item) => item.suggestedFilename().endsWith('.manifest.json'));
  expect(download).toBeDefined();
  expect(manifest).toBeDefined();
  expect(download!.suggestedFilename()).toMatch(/^whoisleuth-selected-/);
  const content = await readFile((await download!.path())!, 'utf8');
  expect(content).toContain('limited-one.example');
  expect(content).not.toContain('available-two.example');
  expect(content).toContain('technology_ids,tls_issuer,tls_spki_sha256');
  const manifestContent = JSON.parse(await readFile((await manifest!.path())!, 'utf8'));
  expect(manifestContent).toMatchObject({
    schema: 'whoisleuth.bulk-review-manifest',
    selection: { count: 1, domains: ['limited-one.example'] },
    lookupProfile: 'fast',
  });
  expect(manifestContent.integrity.digestSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
});

test('supports focused review and an evidence-qualified two-domain comparison', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => {
    const domain = new URL(route.request().url()).searchParams.get('q') || '';
    const left = domain.startsWith('left');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        availability: {
          applicable: true,
          domain,
          state: 'registered',
          confidence: 'high',
          registrar: { name: left ? 'First Registrar' : 'Second Registrar' },
          nameservers: left ? ['ns1.shared.example'] : ['ns2.separate.example'],
          hasMx: left,
          hasNullMx: !left,
          hasSpf: left,
          hasDmarc: false,
          dns: {
            status: 'success',
            records: { a: [], aaaa: [], cname: [], caa: [] },
          },
          bulkComparison: {
            version: 1,
            technology: {
              state: 'success',
              ids: left ? ['fixture-cms', 'shared-edge'] : ['fixture-commerce', 'shared-edge'],
              truncated: false,
            },
            tls: {
              state: 'success',
              issuerLabel: left ? 'CN=Fixture Authority One' : 'CN=Fixture Authority Two',
              spkiSha256: left ? 'a'.repeat(64) : 'b'.repeat(64),
            },
          },
        },
        diagnostics: {
          version: 7,
          rdap: { status: left ? 'complete' : 'partial' },
          whois: { status: 'skipped' },
          availability: { status: 'complete' },
        },
      }),
    });
  });
  await page.getByLabel('Scan mode').selectOption('deep');
  await runBulkScan(page, ['left-review.example', 'right-review.example']);

  const cockpit = page.getByRole('region', { name: 'Bulk review cockpit' });
  await expect(cockpit).toContainText('1 of 2');
  await cockpit.getByRole('button', { name: 'Mark reviewed' }).click();
  await cockpit.getByRole('button', { name: 'Next unresolved' }).click();
  await expect(cockpit.getByRole('heading', { level: 3 })).toHaveText('right-review.example');
  await expect(cockpit.getByText('Evidence freshness')).toBeVisible();
  await cockpit.getByRole('button', { name: 'Create case' }).click();
  await expect(cockpit.getByLabel('Case disposition')).toBeEnabled();
  await cockpit.getByLabel('Case disposition').selectOption('suspicious');
  await expect(cockpit.getByRole('status')).toContainText('Marked right-review.example as Suspicious');
  await cockpit.getByLabel('Current row monitor list').fill('Focused review');
  await cockpit.getByRole('button', { name: 'Save current to Monitor' }).click();
  await expect(cockpit.getByRole('status')).toContainText('Saved right-review.example to Focused review');
  const storedCase = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]?.value;
  expect(storedCase).toMatchObject({ domain: 'right-review.example', disposition: 'suspicious' });
  const storedWatchlist = await readBrowserLocalCollection(page, 'watchlists', { minimumRecords: 1 });
  expect(storedWatchlist.records[0]?.value?.results?.[0]).toMatchObject({ domain: 'right-review.example' });

  const comparison = page.getByRole('region', { name: 'Two-domain comparison' });
  await expect(comparison.getByRole('img', { name: 'Two-domain evidence comparison matrix. Exact values and limitations are in the following table.' })).toBeVisible();
  await expect(comparison).toContainText('First Registrar');
  await expect(comparison).toContainText('Second Registrar');
  await expect(comparison.getByText('different', { exact: true }).first()).toBeVisible();
  await expect(comparison.getByText('not recorded', { exact: true }).first()).toBeVisible();
  const technologyRow = comparison.getByRole('row', { name: /Technology Technology identifiers/u });
  await expect(technologyRow).toContainText('fixture-cms, shared-edge');
  await expect(technologyRow).toContainText('fixture-commerce, shared-edge');
  const issuerRow = comparison.getByRole('row', { name: /Certificate TLS issuer label/u });
  await expect(issuerRow).toContainText('CN=Fixture Authority One');
  await expect(issuerRow).toContainText('CN=Fixture Authority Two');
  await expect(comparison.getByRole('row', { name: /Certificate TLS public-key fingerprint/u })).toBeVisible();
  await expect(comparison.getByText('Evidence freshness')).toBeVisible();
  await expect(comparison.getByRole('link', { name: 'View settled row' })).toHaveCount(56);

  const downloadPromise = page.waitForEvent('download');
  await comparison.getByRole('button', { name: 'Export comparison' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^whoisleuth-domain-comparison-/u);
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported).toMatchObject({
    schema: 'whoisleuth.domain-comparison',
    comparison: {
      version: 3,
      leftDomain: expect.any(String),
      rightDomain: expect.any(String),
    },
  });
  expect(exported.integrity.digestSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);

  const mailReview = page.getByRole('region', { name: 'Lookalike mail exposure' });
  await expect(mailReview.getByText('Authentication gap', { exact: true })).toBeVisible();
  await expect(mailReview.getByText('Null MX', { exact: true })).toBeVisible();
  await expect(mailReview).toContainText('No SMTP connection');
  const mailDownloadPromise = page.waitForEvent('download');
  await mailReview.getByRole('button', { name: 'Export review' }).click();
  const mailDownload = await mailDownloadPromise;
  expect(mailDownload.suggestedFilename()).toMatch(/^whoisleuth-mail-exposure-/u);
  const mailExport = JSON.parse(await readFile((await mailDownload.path())!, 'utf8'));
  expect(mailExport).toMatchObject({
    schema: 'whoisleuth.bulk-mail-exposure',
    report: {
      counts: {
        mail_auth_gap: 1,
        null_mx: 1,
      },
    },
  });
  expect(mailExport.integrity.digestSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('group', { name: 'Bulk result view' }).getByRole('button', { name: 'Analysis', exact: true }).click();
  await page.getByRole('button', { name: /Mail exposure/u }).click();
  await page.getByRole('button', { name: /Domain comparison/u }).click();
  await expectNoHorizontalOverflow(page);
  await expectNoHorizontalScrollContainers(page.locator('#results'));
  await expectNoHorizontalScrollContainers(comparison);
  await expectNoHorizontalScrollContainers(mailReview);
});

test('persists named review views and per-domain review state without restarting collection', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => {
    const domain = new URL(route.request().url()).searchParams.get('q') || '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        availability: {
          applicable: true,
          domain,
          state: 'registered',
          confidence: 'high',
        },
        diagnostics: {
          version: 7,
          rdap: { status: domain.startsWith('limited') ? 'partial' : 'complete' },
          whois: { status: 'skipped' },
          availability: { status: 'complete' },
        },
      }),
    });
  });
  await runBulkScan(page, ['limited-review.example', 'complete-review.example']);

  await page.getByLabel('Review state for limited-review.example').selectOption('reviewing');
  await expect(page.getByRole('region', { name: 'Undo analyst change' })).toContainText('limited-review.example');
  await page.getByRole('region', { name: 'Undo analyst change' }).getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Review state for limited-review.example')).toHaveValue('unreviewed');
  await page.getByLabel('Review state for limited-review.example').selectOption('reviewing');
  await page.getByLabel('Source coverage').selectOption('limited');
  await page.getByLabel('Filter by review state').selectOption('reviewing');
  await page.getByLabel('New view name').fill('Limited active review');
  await page.getByRole('button', { name: 'Save current view' }).click();
  await expect(page.locator('.review-views .review-status')).toContainText('Saved the “Limited active review” view.');

  const stored = await readBrowserLocalCollection(page, 'bulk_review', { minimumRecords: 2 });
  expect(JSON.stringify(stored.records)).not.toContain('availability');
  expect(stored.records.map((record) => record.value.kind).sort()).toEqual(['preset', 'row']);
  const presetRecord = stored.records.find((record) => record.value.kind === 'preset');
  if (presetRecord?.value.kind !== 'preset') throw new Error('The saved Bulk review preset is missing.');
  expect(presetRecord.value.view).toMatchObject({
    sourceFilter: 'limited',
    reviewStateFilter: 'reviewing',
  });

  await page.reload();
  await page.getByLabel('Saved Bulk review view').selectOption({ label: 'Limited active review' });
  await page.getByRole('button', { name: 'Load view' }).click();
  await expect(page.getByLabel('Filter by review state')).toHaveValue('reviewing');
  await expect(page.locator('.results-table')).toHaveCount(0);
  await expect(page.locator('.review-views .review-status')).toContainText('No scan was started');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /Workspace tools/u }).click();
  await expectNoHorizontalOverflow(page);
});

test('a malformed successful response remains an explicit failure in exports and retained monitoring state', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ availability: 'registered', diagnostics: {} }),
  }));

  await runBulkScan(page, ['malformed-response.example']);
  const row = page.locator('.results-table tbody tr');
  await expect(page.locator('.filters button', { hasText: 'errors' }).locator('span')).toHaveText('1');
  await expect(row.locator('td[data-label="Registration"]')).toContainText('error');
  await expect(row.locator('td[data-label="Domain"]')).toContainText('Bulk lookup returned an invalid response.');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const csv = await readFile(path!, 'utf8');
  expect(csv).toContain('malformed-response.example');
  expect(csv).toContain('Bulk lookup returned an invalid response.');
  expect(csv).not.toContain('malformed-response.example,,,,,unknown');

  await page.getByLabel('Watchlist name').fill('Invalid response audit');
  await page.getByRole('button', { name: 'Save to Monitor' }).click();
  await expect(page.locator('.save-watchlist').getByRole('status')).toHaveText(
    'Saved 1 result to Invalid response audit.',
    { timeout: 10_000 },
  );
  const retained = await readBrowserLocalCollection(page, 'watchlists', { minimumRecords: 1 });
  expect(retained.records[0]?.value?.results?.[0]).toMatchObject({
    domain: 'malformed-response.example',
    availability: 'error',
  });
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

  for (const header of ['Registration', 'Website', 'Registrar', 'Mutation']) {
    await expect(page.locator('.results-table th', { has: page.getByRole('button', { name: new RegExp(`^${header}`) }) })).toBeVisible();
  }
  await expect(page.getByLabel('Desktop result sort')).toHaveValue('risk');
  await expect(page.getByLabel('Order')).toHaveValue('1');

  await expect(page.locator('.results-table tbody tr')).toHaveCount(domains.length);
  await expectNoHorizontalOverflow(page);
});

test('sorts complete results by registration, confidence, website, registrar, and mutation evidence', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => {
    const domain = new URL(route.request().url()).searchParams.get('q') || '';
    const evidence = {
      'charlie.example': { state: 'registered', confidence: 'low', activityStatus: 'inactive', registrar: { name: 'Zulu Registrar' } },
      'alpha.example': { state: 'available', confidence: 'high', activityStatus: 'active', registrar: { name: 'Alpha Registrar' } },
      'bravo.example': { state: 'registered', confidence: 'medium', activityStatus: 'parked', registrar: { name: 'Middle Registrar' } },
    }[domain] || {};
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        availability: { applicable: true, domain, ...evidence },
        diagnostics: { version: 7, rdap: { status: 'complete' }, whois: { status: 'skipped' }, availability: { status: 'complete' } },
      }),
    });
  });

  await runBulkScan(page, ['charlie.example', 'alpha.example', 'bravo.example']);
  const domains = () => page.locator('.results-table tbody td[data-label="Domain"] strong').allTextContents();
  const triagePlot = page.getByRole('region', { name: 'Risk and opportunity matrix' });
  await expect(triagePlot).toBeVisible();
  await expect(triagePlot.getByRole('img', { name: /2 filtered domains plotted/ })).toBeVisible();
  const quadrantSummary = triagePlot.getByLabel('Risk and opportunity quadrant counts');
  await expect(quadrantSummary).toBeVisible();
  await expect(quadrantSummary.locator('dt')).toHaveText([
    'Available / review',
    'Priority review',
    'Lower scores',
    'Risk-led review',
  ]);
  expect(
    (await quadrantSummary.locator('dd').allTextContents())
      .map(Number)
      .reduce((total, count) => total + count, 0),
  ).toBe(2);

  await page.getByLabel('Desktop result sort').selectOption('registrar');
  await expect.poll(domains).toEqual(['alpha.example', 'bravo.example', 'charlie.example']);

  await page.getByLabel('Desktop result sort').selectOption('confidence');
  await expect(page.getByLabel('Order')).toHaveValue('-1');
  await expect.poll(domains).toEqual(['alpha.example', 'bravo.example', 'charlie.example']);

  await page.getByLabel('Desktop result sort').selectOption('activity');
  await page.getByLabel('Order').selectOption('-1');
  await expect.poll(domains).toEqual(['bravo.example', 'alpha.example', 'charlie.example']);

  await page.getByRole('button', { name: /^Registration/ }).click();
  await expect.poll(domains).toEqual(['alpha.example', 'bravo.example', 'charlie.example']);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Mobile result sort')).toBeVisible();
  await page.getByRole('button', { name: /^Filters 0$/u }).click();
  await expect(page.getByLabel('Order')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('keeps the current queue, results, filters, sort, and page during console navigation only', async ({ page }) => {
  const domains = invalidDomains(101);
  await runBulkScan(page, domains);
  await page.locator('.filters').getByRole('button', { name: /^errors / }).click();
  await page.getByLabel('Desktop result sort').selectOption('domain');
  await page.getByLabel('Order').selectOption('-1');
  await page.getByRole('navigation', { name: 'Bulk result pages' }).getByRole('button', { name: 'Next' }).click();

  const consoleNavigation = page.locator('#console-navigation');
  await consoleNavigation.getByRole('link', { name: /^Dashboard/ }).click();
  await consoleNavigation.getByRole('link', { name: /^Bulk/ }).click();

  await expect(page.locator('#domains')).toHaveValue(domains.join('\n'));
  await expect(page.getByLabel('Desktop result sort')).toHaveValue('domain');
  await expect(page.getByLabel('Order')).toHaveValue('-1');
  await expect(page.getByRole('navigation', { name: 'Bulk result pages' })).toContainText('Page 2 of 2');
  await expect(page.locator('.results-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.filters').getByRole('button', { name: /^errors / })).toHaveClass(/active/);

  await page.reload();
  await expect(page.locator('#domains')).toHaveValue('');
  await expect(page.locator('.results-table')).toHaveCount(0);
});

test('saves compact Bulk sessions, restores them after reload, and compares later observations', async ({ page }) => {
  let availability = 'registered';
  await page.route('**/api/lookup?*', async (route) => {
    const domain = new URL(route.request().url()).searchParams.get('q') || '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        availability: {
          applicable: true,
          domain,
          state: availability,
          confidence: 'high',
          registrant: { email: 'must-not-persist@priority.invalid' },
        },
        diagnostics: {
          version: 7,
          rdap: { status: availability === 'registered' ? 'complete' : 'not_found' },
          whois: { status: 'skipped' },
          availability: { status: 'complete' },
        },
      }),
    });
  });

  await runBulkScan(page, ['priority.invalid']);
  await page.getByLabel('Session name').fill('Baseline review');
  await page.getByRole('button', { name: 'Save current session' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved Baseline review.' })).toBeVisible();

  availability = 'available';
  await page.getByRole('button', { name: 'Scan 1 domain' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Completed 1 of 1 lookups.' })).toBeVisible();
  await page.getByLabel('Session name').fill('Later review');
  await page.getByRole('button', { name: 'Save current session' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved Later review.' })).toBeVisible();

  const stored = await readBrowserLocalCollection(page, 'bulk_sessions', { minimumRecords: 2 });
  expect(stored.records).toHaveLength(2);
  expect(JSON.stringify(stored.records)).not.toContain('must-not-persist@priority.invalid');

  await page.getByText('Compare two saved sessions', { exact: true }).click();
  await page.getByLabel('Baseline', { exact: true }).selectOption({ label: 'Baseline review' });
  await page.getByLabel('Later session', { exact: true }).selectOption({ label: 'Later review' });
  await expect(page.getByText('Registration: registered → available')).toBeVisible();
  await expect(page.getByText(/source-state change may reflect collection availability/i)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /Workspace tools/u }).click();
  await expectNoHorizontalOverflow(page);
  await expectNoHorizontalScrollContainers(page.getByRole('region', { name: 'Saved Bulk sessions' }));

  await page.reload();
  await page.getByRole('button', { name: /Workspace tools/u }).click();
  await expect(page.getByRole('heading', { name: 'Saved Bulk sessions' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Baseline review' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Later review' })).toBeVisible();
  await page.locator('article').filter({ hasText: 'Baseline review' }).getByRole('button', { name: 'Load' }).click();
  await expect(page.locator('.results-table tbody tr')).toHaveCount(1);
  await expect(page.getByRole('status').filter({ hasText: /Loaded Baseline review/ })).toBeVisible();
});

test('resumes only unstarted rows from an explicitly saved partial session', async ({ page }) => {
  const savedAt = '2026-07-28T03:00:00.000Z';
  await migrateLegacyBrowserData(page, {
    'whoisleuth-bulk-sessions-v1': {
      schema: 'whoisleuth.bulk-sessions',
      version: 1,
      sessions: [{
        id: 'partial-review',
        name: 'Partial review',
        mode: 'fast',
        state: 'partial',
        inputDigest: `sha256:${'a'.repeat(64)}`,
        domains: ['settled.invalid', 'pending.invalid'],
        results: [{
          domain: 'settled.invalid',
          status: 'error',
          availability: 'error',
          confidence: 'unknown',
          registrar: '—',
          activity: '—',
          risk: null,
          opportunity: null,
          mutationTypes: [],
          trusted: null,
          error: 'Earlier lookup failed',
          scanDepth: 'fast',
          nameservers: [],
          faviconMatch: false,
          faviconNearMatch: false,
          reusesOfficialAssets: false,
          hasPasswordField: false,
          riskFactors: [],
          relationship: {
            version: 2,
            nameservers: [],
            ipAddresses: [],
            trackingIdentifiers: [],
            officialAssetHosts: [],
            faviconHash: null,
            faviconPHash: null,
            certificateFingerprint: null,
            truncated: false,
          },
          sourceCoverage: [{ source: 'lookup', state: 'error' }],
        }],
        startedAt: savedAt,
        updatedAt: savedAt,
        completedAt: null,
      }],
    },
  });
  const requests: string[] = [];
  await page.route('**/api/lookup?*', async (route) => {
    const domain = new URL(route.request().url()).searchParams.get('q') || '';
    requests.push(domain);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        availability: { applicable: true, domain, state: 'registered', confidence: 'high' },
        diagnostics: {
          version: 7,
          rdap: { status: 'complete' },
          whois: { status: 'skipped' },
          availability: { status: 'complete' },
        },
      }),
    });
  });

  await page.getByRole('button', { name: 'Resume unstarted' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Completed 1 of 1 lookups.' })).toBeVisible();
  expect(requests).toEqual(['pending.invalid']);
  const stored = await readBrowserLocalCollection(page, 'bulk_sessions', { minimumRecords: 1, minimumRevision: 2 });
  expect(stored.records[0]?.value?.results).toHaveLength(2);
});

test('leaving a paused scan retains every settled result and releases paused workers', async ({ page }) => {
  const domains = Array.from({ length: 13 }, (_, index) => `paused-${index + 1}.example`);
  let releaseDelayed!: () => void;
  const delayed = new Promise<void>((resolve) => { releaseDelayed = resolve; });
  await page.route('**/api/lookup?*', async (route) => {
    const domain = new URL(route.request().url()).searchParams.get('q') || '';
    if (domain !== domains[0]) {
      await delayed;
      await route.abort('aborted').catch(() => {});
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        availability: { applicable: true, domain, state: 'registered', confidence: 'high' },
        diagnostics: { version: 7, rdap: { status: 'complete' }, whois: { status: 'skipped' }, availability: { status: 'complete' } },
      }),
    });
  });

  await page.locator('#domains').fill(domains.join('\n'));
  await page.getByRole('button', { name: 'Scan 13 domains' }).click();
  await expect(page.getByRole('progressbar', { name: 'Bulk scan progress' })).toHaveAttribute('aria-valuenow', '1');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.locator('#console-navigation').getByRole('link', { name: /^Dashboard/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  releaseDelayed();
  await page.locator('#console-navigation').getByRole('link', { name: /^Bulk/ }).click();

  await expect(page.locator('#domains')).toHaveValue(domains.join('\n'));
  await expect(page.locator('.results-table tbody tr')).toHaveCount(1);
  await expect(page.getByRole('status').filter({ hasText: 'Stopped after 1 of 13 lookups when you left Bulk.' })).toBeVisible();
});

test('long domains retain a readable table column and wrap safely in mobile cards', async ({ page }) => {
  const domain = `long-${'b'.repeat(58)}`;
  await page.setViewportSize({ width: 1024, height: 844 });
  await runBulkScan(page, [domain]);

  const row = page.locator('.results-table tbody tr');
  const domainValue = row.locator('td[data-label="Domain"] strong');
  const desktopDomainBox = await boundingBox(domainValue);
  const desktopRowBox = await boundingBox(row);
  expect(desktopDomainBox.width).toBeGreaterThanOrEqual(190);
  expect(desktopRowBox.height).toBeLessThan(350);
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('group', { name: 'Bulk result view' }).getByRole('button', { name: 'List', exact: true }).click();
  const mobileDomainBox = await boundingBox(domainValue);
  const mobileRowBox = await boundingBox(row);
  expect(mobileDomainBox.width).toBeGreaterThan(200);
  expect(mobileRowBox.height).toBeLessThan(360);
  await expectNoHorizontalOverflow(page);
});

test('results become labelled stacked cards at mobile width, with compact and full-width fields', async ({ page }) => {
  const domains = invalidDomains(5);
  await runBulkScan(page, domains);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('group', { name: 'Bulk result view' }).getByRole('button', { name: 'List', exact: true }).click();

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

  const collapsedLabels = ['Website', 'Registrar', 'Mutation', 'Actions'];
  for (const label of collapsedLabels) {
    await expect(row.locator(`td[data-label="${label}"]`)).toBeHidden();
  }

  await row.getByRole('button', { name: `Show details for ${domains[0]}` }).click();
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
  const profile = {
    id: 'idn-profile', name: 'Example Brand', officialDomains: ['paypal.com'], productNames: [], tlds: ['com'],
    approvedPartnerDomains: [], allowlistedDomains: [], allowlistedRegistrars: [], dkimSelectors: [],
    trademarkOwner: '', trademarkRegistration: '', officialFaviconHash: '', officialFaviconPHash: '',
    createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
  };
  await migrateLegacyBrowserData(page, {
    'whois-rdap-brand-profiles-v1': [profile],
    'whois-rdap-active-brand-profile-v1': profile.id,
  });
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      availability: {
        applicable: true, domain: 'xn--ypal-43d9g.com', state: 'registered', confidence: 'high',
        nameservers: [], privacyProtected: null, activityStatus: null,
      },
      diagnostics: { version: 7, rdap: { status: 'unsupported' }, whois: { status: 'skipped' }, availability: { status: 'complete' } },
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

test('risk model v6 exposes cross-family corroboration in Bulk triage', async ({ page }) => {
  const profile = {
    id: 'risk-profile', name: 'Example profile', officialDomains: ['official.example'], productNames: [], tlds: ['example'],
    approvedPartnerDomains: [], allowlistedDomains: [], allowlistedRegistrars: [], dkimSelectors: [],
    trademarkOwner: '', trademarkRegistration: '', officialFaviconHash: 'a'.repeat(64), officialFaviconPHash: '', pageBaseline: null,
    createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
  };
  await page.evaluate(() => {
    sessionStorage.setItem('whoisleuth:candidate-handoff:v1', JSON.stringify({
      version: 1,
      createdAt: '2026-07-13T00:00:00.000Z',
      source: 'typosquat',
      candidates: [{ domain: 'candidate.example', source: 'official.example', mutationTypes: ['dictionary'] }],
    }));
  });
  await migrateLegacyBrowserData(page, {
    'whois-rdap-brand-profiles-v1': [profile],
    'whois-rdap-active-brand-profile-v1': profile.id,
  });
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      availability: {
        applicable: true, domain: 'candidate.example', state: 'registered', confidence: 'high',
        faviconHash: 'a'.repeat(64), externalAssetHosts: ['official.example'],
        phishingLanguageMatch: 'verify your account', hasPasswordField: true,
      },
      diagnostics: { version: 7, rdap: { status: 'complete' }, whois: { status: 'skipped' }, availability: { status: 'complete' } },
    }),
  }));

  await runBulkScan(page, ['candidate.example']);
  const row = page.locator('.results-table tbody tr');
  const riskCell = row.locator('td[data-label="Risk"]');
  await expect(riskCell).toHaveText('85');
  await expect(riskCell).toHaveAttribute('title', /Corroborating context across 3 distinct evidence families \+20/);
  await expect(riskCell).toHaveAttribute('title', /Risk model v6/);

  await page.getByRole('button', { name: 'high risk' }).click();
  await expect(row).toBeVisible();
  await row.locator('.star').click();
  await row.getByRole('button', { name: /Create case/ }).click();
  await row.locator('select.case-disp').selectOption('suspicious');

  await page.getByLabel('Defensive format').selectOption('hosts');
  const hostDownloads = await captureDownloads(page, async () => {
    await page.getByRole('button', { name: 'Export 1 reviewed indicator' }).click();
  });
  const download = hostDownloads.find((item) => /\.txt$/u.test(item.suggestedFilename()));
  expect(download).toBeDefined();
  expect(download!.suggestedFilename()).toMatch(/^whoisleuth-defensive-domains-\d{4}-\d{2}-\d{2}\.txt$/);
  const path = await download!.path();
  expect(path).not.toBeNull();
  const content = await readFile(path!, 'utf8');
  expect(content).toContain('Review before use. Heuristic findings can include false positives.');
  expect(content).toContain('0.0.0.0 candidate.example');
  expect(content).not.toContain('official.example\n');
  const manifestDownload = hostDownloads.find((item) => item.suggestedFilename().endsWith('.manifest.json'));
  const rollbackDownload = hostDownloads.find((item) => item.suggestedFilename().endsWith('.rollback.json'));
  expect(manifestDownload).toBeDefined();
  expect(rollbackDownload).toBeDefined();
  const manifest = JSON.parse(await readFile((await manifestDownload!.path())!, 'utf8'));
  expect(manifest).toMatchObject({ reviewRequired: true, includeWildcards: false });
  expect(manifest.entries).toHaveLength(1);
  const rollback = JSON.parse(await readFile((await rollbackDownload!.path())!, 'utf8'));
  expect(rollback.removes).toEqual([{ domain: 'candidate.example', includeWildcard: false, reason: expect.any(String) }]);
  await expect(page.getByRole('status').filter({ hasText: 'a provenance manifest, and a rollback set' })).toBeVisible();

  await page.getByLabel('Defensive format').selectOption('stix');
  const stixDownloads = await captureDownloads(page, async () => {
    await page.getByRole('button', { name: 'Export 1 reviewed indicator' }).click();
  });
  const stixDownload = stixDownloads.find((item) => item.suggestedFilename().endsWith('.stix.json'));
  expect(stixDownload).toBeDefined();
  expect(stixDownload!.suggestedFilename()).toMatch(/^whoisleuth-defensive-domains-\d{4}-\d{2}-\d{2}\.stix\.json$/);
  const stixPath = await stixDownload!.path();
  expect(stixPath).not.toBeNull();
  const bundle = JSON.parse(await readFile(stixPath!, 'utf8'));
  expect(bundle.type).toBe('bundle');
  expect(bundle.objects.some((item: Record<string, unknown>) => item.type === 'observed-data' && item.x_whoisleuth_evidence_kind === 'direct-observation')).toBe(true);
  expect(bundle.objects.some((item: Record<string, unknown>) => item.type === 'indicator' && item.x_whoisleuth_evidence_kind === 'heuristic-inference')).toBe(true);
  expect(JSON.stringify(bundle)).not.toContain('official.example');

  await page.getByLabel('Defensive format').selectOption('misp');
  const mispDownloads = await captureDownloads(page, async () => {
    await page.getByRole('button', { name: 'Export 1 reviewed indicator' }).click();
  });
  const mispDownload = mispDownloads.find((item) => item.suggestedFilename().endsWith('.misp.json'));
  expect(mispDownload).toBeDefined();
  expect(mispDownload!.suggestedFilename()).toMatch(/^whoisleuth-defensive-domains-\d{4}-\d{2}-\d{2}\.misp\.json$/);
  const mispPath = await mispDownload!.path();
  expect(mispPath).not.toBeNull();
  const event = JSON.parse(await readFile(mispPath!, 'utf8')).Event;
  expect(event.published).toBe(false);
  expect(event.distribution).toBe('0');
  expect(event.Attribute).toHaveLength(1);
  expect(event.Attribute[0]).toMatchObject({ value: 'candidate.example', type: 'domain', to_ids: false, disable_correlation: true });
  expect(JSON.stringify(event)).not.toContain('official.example');
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test('deep results present bounded relationship evidence including exact native certificate identity', async ({ page }) => {
  test.slow();
  const profile = {
    id: 'relationship-profile', name: 'Example profile', officialDomains: ['official.example'], productNames: [], tlds: ['example'],
    approvedPartnerDomains: [], allowlistedDomains: [], allowlistedRegistrars: [], dkimSelectors: [],
    trademarkOwner: '', trademarkRegistration: '', officialFaviconHash: '', officialFaviconPHash: '', pageBaseline: null,
    createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
  };
  await migrateLegacyBrowserData(page, {
    'whois-rdap-brand-profiles-v1': [profile],
    'whois-rdap-active-brand-profile-v1': profile.id,
  });
  await page.route('**/api/lookup?*', async (route) => {
    const domain = new URL(route.request().url()).searchParams.get('q') || '';
    const shared = domain !== 'third.example';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        availability: {
          applicable: true, domain, state: 'registered', confidence: 'high', activityStatus: 'active', deepScanComplete: true,
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
        diagnostics: { version: 7, rdap: { status: 'complete' }, whois: { status: 'complete' }, availability: { status: 'complete' } },
      }),
    });
  });

  await page.getByLabel('Scan mode').selectOption('deep');
  await runBulkScan(page, ['first.example', 'second.example', 'third.example']);

  const section = page.getByRole('region', { name: '6 observed relationships' });
  await expect(section).toBeVisible();
  await expect(section.getByRole('img', { name: /Shared evidence relationships/u })).toBeVisible();
  const relationshipList = section.locator('.relationship-list');
  await expect(relationshipList.getByText('Shared nameserver set', { exact: true })).toBeVisible();
  await expect(relationshipList.getByText('Shared IP address', { exact: true })).toBeVisible();
  await expect(relationshipList.getByText('Shared TLS certificate', { exact: true })).toBeVisible();
  await expect(relationshipList.getByText('Exact leaf-certificate SHA-256', { exact: true })).toBeVisible();
  await expect(relationshipList.getByText('Shared tracking identifier', { exact: true })).toBeVisible();
  await expect(relationshipList.getByText('Similar favicon', { exact: true })).toBeVisible();
  await expect(relationshipList.getByText('Official asset relationship', { exact: true })).toBeVisible();
  await expect(section.locator('.relationship-glyph svg')).toHaveCount(6);
  await expect(section.locator('article', { hasText: 'Shared nameserver set' }).locator('.relationship-glyph svg')).toHaveAttribute('data-icon', 'nameserver');
  await expect(section.locator('article', { hasText: 'Shared TLS certificate' }).locator('.relationship-glyph svg')).toHaveAttribute('data-icon', 'tls');
  await expect(section.locator('article', { hasText: 'Similar favicon' }).locator('.relationship-glyph svg')).toHaveAttribute('data-icon', 'favicon');
  await expect(section).toContainText('not ownership or maliciousness conclusions');
  await section.getByText('Interpretation limits').click();
  await expect(section).toContainText('does not establish common control');

  const certificateRelationship = section.locator('article', { hasText: 'Shared TLS certificate' });
  await certificateRelationship.getByRole('button', { name: 'Retain observation' }).click();
  await expect(certificateRelationship.getByRole('button', { name: 'Retained in Monitor' })).toBeDisabled();
  await expect(section.getByRole('status')).toContainText('Retained shared tls certificate for 2 domains in this browser');

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);

  await page.goto('/monitor?view=relationships');
  const retained = page.getByRole('region', { name: 'Retained relationship observations' });
  await expect(retained).toContainText('Shared TLS certificate');
  await expect(retained).toContainText('Exact leaf-certificate SHA-256');
  await expect(retained).toContainText('Derived observation');
  await expect(retained.getByRole('link', { name: 'first.example' })).toHaveAttribute('href', '/lookup?q=first.example');
  await expectNoHorizontalOverflow(page);

  const retainedItem = retained.locator('li[id^="retained-"]').first();
  const retainedElementId = await retainedItem.getAttribute('id');
  expect(retainedElementId).toMatch(/^retained-relationship-/);
  const retainedId = retainedElementId!.slice('retained-'.length);
  await page.goto(`/monitor?view=relationships&observation=${encodeURIComponent(retainedId)}`);
  await expect(page.locator(`#retained-${retainedId}`)).toBeFocused();
  await expect(page.locator(`#retained-${retainedId}`)).toHaveClass(/focused/);

  page.once('dialog', (dialog) => dialog.accept());
  const focusedRetained = page.getByRole('region', { name: 'Retained relationship observations' });
  await focusedRetained.getByRole('button', { name: 'Delete retained observation' }).click();
  await expect(focusedRetained.getByRole('heading', { name: 'No retained relationship observations' })).toBeVisible();
});

test('candidate handoff presents defensive coverage actions and export', async ({ page }) => {
  await page.evaluate(() => {
    sessionStorage.setItem('whoisleuth:candidate-handoff:v1', JSON.stringify({
      version: 1,
      createdAt: '2026-07-16T00:00:00.000Z',
      source: 'typosquat',
      candidates: [
        { domain: 'login-example.example', source: 'official.example', mutationTypes: ['dictionary'] },
        { domain: 'secure-example.example', source: 'official.example', mutationTypes: ['dictionary'] },
      ],
    }));
  });
  await page.reload();
  await page.route('**/api/lookup?*', async (route) => {
    const domain = new URL(route.request().url()).searchParams.get('q') || '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        availability: {
          applicable: true,
          domain,
          state: domain.startsWith('login-') ? 'registered' : 'available',
          confidence: 'high',
        },
        diagnostics: { version: 7, rdap: { status: 'complete' }, whois: { status: 'skipped' }, availability: { status: 'complete' } },
      }),
    });
  });

  await runBulkScan(page, ['login-example.example', 'secure-example.example']);
  const coverage = page.locator('section.coverage');
  await expect(coverage.getByRole('heading', { name: 'Coverage · 0%' })).toBeVisible();
  await expect(coverage).toContainText('Generated 2');
  await expect(coverage).toContainText('Registered 1');
  await expect(coverage).toContainText('Available 1');
  await expect(coverage.getByRole('cell', { name: 'Impersonation term', exact: true }).first()).toBeVisible();
  await expect(coverage.getByRole('img', { name: 'Mutation-family coverage. Exact counts are in the following table.' })).toBeVisible();
  await expect(coverage.getByRole('img', { name: 'TLD coverage. Exact counts are in the following table.' })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await coverage.getByRole('button', { name: 'Export coverage CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^defensive-registration-coverage-\d{4}-\d{2}-\d{2}\.csv$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  const content = await readFile(path!, 'utf8');
  expect(content).toContain('mutation,Impersonation term,2,0,1,1,0,0');

  await coverage.getByRole('button', { name: 'Load gaps' }).first().click();
  await expect(page.locator('#domains')).toHaveValue('login-example.example\nsecure-example.example');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('group', { name: 'Bulk result view' }).getByRole('button', { name: 'Analysis', exact: true }).click();
  await page.getByRole('button', { name: /Defensive coverage/u }).click();
  await expectNoHorizontalOverflow(page);
  await expectNoHorizontalScrollContainers(coverage);
});
