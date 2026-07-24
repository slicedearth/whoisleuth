import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { boundingBox, expectNoHorizontalOverflow, migrateLegacyBrowserData, pseudoContent, runBulkScan } from './helpers';

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
  await expect(page.locator('.results-table .confidence')).toHaveText(Array(domains.length).fill('unknown confidence'));
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
  await expect(page.getByLabel('Sort')).toHaveValue('risk');
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
        availability: { domain, ...evidence },
        diagnostics: { rdap: { status: 'complete' }, whois: { status: 'skipped' }, availability: { status: 'complete' } },
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

  await page.getByLabel('Sort').selectOption('registrar');
  await expect.poll(domains).toEqual(['alpha.example', 'bravo.example', 'charlie.example']);

  await page.getByLabel('Sort').selectOption('confidence');
  await expect(page.getByLabel('Order')).toHaveValue('-1');
  await expect.poll(domains).toEqual(['alpha.example', 'bravo.example', 'charlie.example']);

  await page.getByLabel('Sort').selectOption('activity');
  await page.getByLabel('Order').selectOption('-1');
  await expect.poll(domains).toEqual(['bravo.example', 'alpha.example', 'charlie.example']);

  await page.getByRole('button', { name: /^Registration/ }).click();
  await expect.poll(domains).toEqual(['alpha.example', 'bravo.example', 'charlie.example']);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Sort')).toBeVisible();
  await expect(page.getByLabel('Order')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('keeps the current queue, results, filters, sort, and page during console navigation only', async ({ page }) => {
  const domains = invalidDomains(101);
  await runBulkScan(page, domains);
  await page.locator('.filters').getByRole('button', { name: /^errors / }).click();
  await page.getByLabel('Sort').selectOption('domain');
  await page.getByLabel('Order').selectOption('-1');
  await page.getByRole('navigation', { name: 'Bulk result pages' }).getByRole('button', { name: 'Next' }).click();

  const consoleNavigation = page.locator('#console-navigation');
  await consoleNavigation.getByRole('link', { name: /^Dashboard/ }).click();
  await consoleNavigation.getByRole('link', { name: /^Bulk/ }).click();

  await expect(page.locator('#domains')).toHaveValue(domains.join('\n'));
  await expect(page.getByLabel('Sort')).toHaveValue('domain');
  await expect(page.getByLabel('Order')).toHaveValue('-1');
  await expect(page.getByRole('navigation', { name: 'Bulk result pages' })).toContainText('Page 2 of 2');
  await expect(page.locator('.results-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.filters').getByRole('button', { name: /^errors / })).toHaveClass(/active/);

  await page.reload();
  await expect(page.locator('#domains')).toHaveValue('');
  await expect(page.locator('.results-table')).toHaveCount(0);
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
        availability: { domain, state: 'registered', confidence: 'high' },
        diagnostics: { rdap: { status: 'complete' }, whois: { status: 'skipped' }, availability: { status: 'complete' } },
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
  const mobileDomainBox = await boundingBox(domainValue);
  const mobileRowBox = await boundingBox(row);
  expect(mobileDomainBox.width).toBeGreaterThan(200);
  expect(mobileRowBox.height).toBeLessThan(500);
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
  await expect(riskCell).toHaveAttribute('title', /Risk model v6/);

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

  await page.getByLabel('Defensive format').selectOption('stix');
  const stixDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export 1 high-risk indicator' }).click();
  const stixDownload = await stixDownloadPromise;
  expect(stixDownload.suggestedFilename()).toMatch(/^whoisleuth-defensive-domains-\d{4}-\d{2}-\d{2}\.stix\.json$/);
  const stixPath = await stixDownload.path();
  expect(stixPath).not.toBeNull();
  const bundle = JSON.parse(await readFile(stixPath!, 'utf8'));
  expect(bundle.type).toBe('bundle');
  expect(bundle.objects.some((item: Record<string, unknown>) => item.type === 'observed-data' && item.x_whoisleuth_evidence_kind === 'direct-observation')).toBe(true);
  expect(bundle.objects.some((item: Record<string, unknown>) => item.type === 'indicator' && item.x_whoisleuth_evidence_kind === 'heuristic-inference')).toBe(true);
  expect(JSON.stringify(bundle)).not.toContain('official.example');

  await page.getByLabel('Defensive format').selectOption('misp');
  const mispDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export 1 high-risk indicator' }).click();
  const mispDownload = await mispDownloadPromise;
  expect(mispDownload.suggestedFilename()).toMatch(/^whoisleuth-defensive-domains-\d{4}-\d{2}-\d{2}\.misp\.json$/);
  const mispPath = await mispDownload.path();
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
          domain,
          state: domain.startsWith('login-') ? 'registered' : 'available',
          confidence: 'high',
        },
        diagnostics: { rdap: { status: 'complete' }, whois: { status: 'skipped' }, availability: { status: 'complete' } },
      }),
    });
  });

  await runBulkScan(page, ['login-example.example', 'secure-example.example']);
  const coverage = page.locator('section.coverage');
  await expect(coverage.getByRole('heading', { name: 'Coverage · 0%' })).toBeVisible();
  await expect(coverage).toContainText('Generated 2');
  await expect(coverage).toContainText('Registered 1');
  await expect(coverage).toContainText('Available 1');
  await expect(coverage.getByText('Impersonation term', { exact: true })).toBeVisible();

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
  await expectNoHorizontalOverflow(page);
});
