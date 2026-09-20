import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { BULK_REVIEW_MANIFEST_VERSION } from '../packages/contracts/investigation-portability.mts';
import { expect, test } from './fixtures';
import { boundingBox, expectNoHorizontalOverflow, expectNoHorizontalScrollContainers, failBrowserLocalCollectionReads, failBrowserLocalReads, holdBrowserLocalReads, holdBrowserLocalTransaction, lookupDomainIdentity, openBulkFilters, openBulkWorkspaceTools, pseudoContent, readBrowserLocalCollection, runBulkScan, selectBulkResultView, useTheme } from './helpers';
import { captureDownloads, invalidDomains } from './bulk-analysis-fixtures';

// Bulk queue, review, comparison and retained-work coverage.

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

test('canonicalises equivalent hostnames into one request per registrable target', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/lookup?*', async (route) => {
    const domain = new URL(route.request().url()).searchParams.get('q') || '';
    const identity = lookupDomainIdentity(domain);
    requests.push(domain);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        availability: {
          applicable: true,
          domain: identity.registrableDomain,
          state: 'registered',
          confidence: 'high',
        },
        diagnostics: {
          version: 7,
          rdap: { status: 'complete' },
          whois: { status: 'skipped' },
          availability: { status: 'complete' },
        },
      }),
    });
  });

  await page.locator('#domains').fill([
    'BÜCHER.example.',
    'xn--bcher-kva.example',
    'portal.example.test',
    'example.test',
  ].join('\n'));
  await expect(page.locator('.input-help')).toContainText('2 equivalent hostname entries were combined by registrable target');
  await page.getByRole('button', { name: 'Scan 2 domains' }).click();

  await expect(page.locator('.status')).toHaveText('Completed 2 of 2 lookups.');
  await expect(page.locator('.results-table tbody tr')).toHaveCount(2);
  expect(requests).toEqual(['xn--bcher-kva.example', 'example.test']);
});

test('offers bounded request pacing and preserves the operator choice during console navigation', async ({ page }) => {
  const pacing = page.getByLabel('Request pacing');
  await expect(pacing).toHaveValue('standard');
  await expect(page.locator('.mode-help')).toContainText('at most 8 lookups run in parallel');

  await pacing.selectOption('gentle');
  await expect(page.locator('.mode-help')).toContainText('at most 2 lookups run in parallel');
  await page.locator('#console-navigation').getByRole('link', { name: /^Dashboard/u }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await page.locator('#console-navigation').getByRole('link', { name: /^Bulk/u }).click();
  await expect(page.getByRole('heading', { name: 'Bulk', exact: true })).toBeVisible();
  await expect(page.getByLabel('Request pacing')).toHaveValue('gentle');

  await page.getByLabel('Scan mode').selectOption('deep');
  await expect(page.locator('.mode-help')).toContainText('at most 1 lookup runs in parallel');
});

test('keeps the Bulk queue available when browser-local context cannot be loaded', async ({ page }) => {
  await expect(page.locator('#domains')).toBeEditable();
  await failBrowserLocalReads(page);
  const navigation = page.locator('#console-navigation');
  await navigation.getByRole('link', { name: /^Dashboard/u }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await navigation.getByRole('link', { name: /^Bulk/u }).click();
  await expect(page.getByRole('heading', { name: 'Bulk', exact: true })).toBeVisible();

  await expect(page.locator('.local-context-status')).toContainText('Some saved context could not be loaded');
  await expect(page.locator('.local-context-status')).toContainText('profile');
  await expect(page.locator('#domains')).toBeEditable();
  await expect(page.getByText(/Saved Bulk sessions could not be read/u)).toHaveCount(0);
  await expect(page.getByText(/Saved views and review state could not be read/u)).toHaveCount(0);
  await openBulkWorkspaceTools(page);
  await expect(page.getByText(/Saved Bulk sessions could not be read/u)).toBeVisible();
  const savedSessions = page.getByRole('region', { name: 'Saved Bulk sessions', exact: true });
  await expect(savedSessions).toBeVisible();
  await expect(savedSessions.getByRole('article')).toHaveCount(0);
  await expect(page.getByText('No Bulk sessions have been saved in this workspace.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export sessions' })).toHaveCount(0);
  await expect(page.getByLabel('Session name')).toHaveCount(0);
  await openBulkWorkspaceTools(page, 'review');
  await expect(page.getByText(/Saved views and review state could not be read/u)).toBeVisible();
  await page.locator('button.mobile-disclosure-toggle', { hasText: 'Shortlist' }).click();
  await expect(page.getByText(/The shortlist could not be read/u)).toBeVisible();
  await expect(page.getByText(/No shortlisted domains/u)).toHaveCount(0);
});

for (const width of [320, 1_280]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`distinguishes pending Bulk collections from empty or failed data at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await useTheme(page, theme);
      await expect(page.locator('#domains')).toBeEditable();
      const release = await holdBrowserLocalTransaction(page);
      try {
        await openBulkWorkspaceTools(page);
        await expect(page.getByRole('status').filter({ hasText: 'Saved Bulk sessions are still loading.' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Export sessions' })).toHaveCount(0);
        await expect(page.getByLabel('Session name')).toHaveCount(0);
        await openBulkWorkspaceTools(page, 'review');
        await expect(page.getByRole('status').filter({ hasText: 'Saved views and review state are still loading.' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Save current view' })).toHaveCount(0);
        await page.locator('button.mobile-disclosure-toggle', { hasText: 'Shortlist' }).click();
        await expect(page.getByRole('status').filter({ hasText: 'The shortlist is still loading.' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Shortlist · —', exact: true })).toBeVisible();
        await expect(page.getByText(/No Bulk sessions have been saved|No shortlisted domains|could not be read/u)).toHaveCount(0);
        await expectNoHorizontalOverflow(page);
        await page.screenshot({ path: testInfo.outputPath('loading-collections.png'), fullPage: true });
      } finally {
        await release();
      }
      await expect(page.getByRole('button', { name: 'Save current view' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Shortlist · 0', exact: true })).toBeVisible();
      await expect(page.getByText('No shortlisted domains yet. Star a Bulk result to save it locally.')).toBeVisible();
      await openBulkWorkspaceTools(page);
      await expect(page.getByLabel('Session name')).toBeEditable();
      const savedSessions = page.getByRole('region', { name: 'Saved Bulk sessions', exact: true });
      await expect(savedSessions).toBeVisible();
      await expect(savedSessions.getByRole('article')).toHaveCount(0);
      await expect(page.getByText('No Bulk sessions have been saved in this workspace.', { exact: true })).toBeVisible();
      await expect(page.getByText(/still loading|could not be read/u)).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath('ready-collections.png'), fullPage: true });
    });
  }
}

test('rejects an over-bound directly pasted Bulk list before scanning', async ({ page }) => {
  const input = `${'one.example,'.repeat(20_001)}one.example`;
  await page.locator('#domains').fill(input);
  await expect(page.getByRole('alert')).toContainText('exceeds the 2 MiB or bounded row and cell limit');
  await expect(page.getByRole('button', { name: 'Scan domains' })).toBeDisabled();
});

test('retains successfully loaded Bulk context when one collection is unavailable', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => {
    const domain = new URL(route.request().url()).searchParams.get('q') || '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        availability: { applicable: true, domain, state: 'registered', confidence: 'high' },
        diagnostics: { version: 7, rdap: { status: 'complete' }, whois: { status: 'skipped' }, availability: { status: 'complete' } },
      }),
    });
  });
  await runBulkScan(page, ['retained-context.example']);
  await openBulkWorkspaceTools(page);
  await page.getByLabel('Session name').fill('Retained partial context');
  await page.getByRole('button', { name: 'Save current session' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved Retained partial context.' })).toBeVisible();

  await failBrowserLocalCollectionReads(page, 'brand_profiles');
  const navigation = page.locator('#console-navigation');
  await navigation.getByRole('link', { name: /^Dashboard/u }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await navigation.getByRole('link', { name: /^Bulk/u }).click();
  await expect(page.getByRole('heading', { name: 'Bulk', exact: true })).toBeVisible();
  await expect(page.locator('.local-context-status')).toContainText('profile');
  await expect(page.locator('.local-context-status')).toContainText('Successfully loaded collections remain available');
  await openBulkWorkspaceTools(page);
  await expect(page.getByRole('heading', { name: 'Retained partial context' })).toBeVisible();
  await expect(page.locator('#domains')).toBeEditable();
  await openBulkFilters(page);
  await expect(page.getByRole('button', { name: 'Indicator eligibility unavailable' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Export \d+ reviewed indicators/u })).toHaveCount(0);
});

test('keeps shortlist-derived analysis unavailable instead of inferring no selection', async ({ page }) => {
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
          nameservers: ['ns1.group.example'],
          hasMx: true,
          hasSpf: true,
          hasDmarc: false,
        },
        diagnostics: {
          version: 7,
          rdap: { status: 'complete' },
          whois: { status: 'skipped' },
          availability: { status: 'complete' },
        },
      }),
    });
  });
  await runBulkScan(page, ['selection-state.example']);
  await openBulkWorkspaceTools(page);
  await page.getByLabel('Session name').fill('Unavailable shortlist review');
  await page.getByRole('button', { name: 'Save current session' }).click();
  await failBrowserLocalCollectionReads(page, 'shortlist');
  await page.locator('#console-navigation').getByRole('link', { name: /^Dashboard/u }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await page.locator('#console-navigation').getByRole('link', { name: /^Bulk/u }).click();
  await expect(page).toHaveURL(/\/bulk$/u);
  await expect(page.getByRole('heading', { name: 'Bulk', exact: true })).toBeVisible();
  await expect(page.locator('.local-context-status')).toContainText('shortlist');
  await page.locator('button.mobile-disclosure-toggle', { hasText: 'Shortlist' }).click();
  await expect(page.getByText(/The shortlist could not be read/u)).toBeVisible();
  await openBulkWorkspaceTools(page);
  await page.locator('.bulk-sessions article', { hasText: 'Unavailable shortlist review' }).getByRole('button', { name: 'Load' }).click();

  await selectBulkResultView(page, 'Analysis');
  await page.getByRole('button', { name: /^Mail exposure\b/u }).click();
  const mailReview = page.getByRole('region', { name: 'Lookalike mail exposure' });
  await expect(mailReview).toContainText('Selection unavailable');
  await expect(mailReview.getByRole('button', { name: 'Select group' }).first()).toBeDisabled();
  await openBulkFilters(page);
  await page.getByLabel('Group summary').selectOption('nameserver');
  await page.getByRole('button', { name: /^Group summary\b/u }).click();
  const groupSummary = page.locator('.bulk-groups');
  await expect(groupSummary).toContainText('selection unavailable');
  await expect(groupSummary.getByRole('button', { name: 'Select group' })).toBeDisabled();
});

test('keeps case-derived indicator eligibility unavailable when Cases cannot be read', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => {
    const domain = new URL(route.request().url()).searchParams.get('q') || '';
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
  await runBulkScan(page, ['case-state.example']);
  await page.getByRole('button', { name: /Add case-state\.example to shortlist/u }).click();
  await openBulkWorkspaceTools(page);
  await page.getByLabel('Session name').fill('Unavailable case review');
  await page.getByRole('button', { name: 'Save current session' }).click();
  await failBrowserLocalCollectionReads(page, 'cases');
  await page.locator('#console-navigation').getByRole('link', { name: /^Dashboard/u }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await page.locator('#console-navigation').getByRole('link', { name: /^Bulk/u }).click();
  await expect(page.getByRole('heading', { name: 'Bulk', exact: true })).toBeVisible();
  await openBulkWorkspaceTools(page);
  await page.locator('.bulk-sessions article', { hasText: 'Unavailable case review' }).getByRole('button', { name: 'Load' }).click();

  await openBulkFilters(page);
  await expect(page.getByText(/Case dispositions could not be read, so indicator eligibility is unavailable/u)).toBeVisible();
  const caseFilter = page.locator('.advanced-filters label.field').filter({ hasText: /^Case state/u }).locator('select');
  await expect(caseFilter).toBeDisabled();
  await expect(caseFilter).toContainText('Case evidence unavailable');
  await expect(page.getByRole('button', { name: 'Indicator eligibility unavailable' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Export 0 reviewed indicators/u })).toHaveCount(0);
});

test('a small scan completes and reports the correct error count', async ({ page }) => {
  const domains = invalidDomains(3);
  await runBulkScan(page, domains);
  await openBulkFilters(page);

  await expect(page.locator('.filters button', { hasText: 'all' }).locator('span')).toHaveText(String(domains.length));
  await expect(page.locator('.filters button', { hasText: 'errors' }).locator('span')).toHaveText(String(domains.length));
  await expect(page.locator('.results-table .confidence')).toHaveText(Array(domains.length).fill('unknown confidence'));
  const outcomes = page.locator('.outcomes');
  await expect(outcomes).toHaveAttribute('aria-label', 'Settled scan outcomes');
  await expect(outcomes.locator('div', { hasText: 'Failed' })).toContainText(String(domains.length));
  await expect(outcomes.locator('div', { hasText: 'Pending' })).toContainText('0');
});

test('selected Case dispositions commit atomically and ignore a rapid overlapping selection', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => {
    const domain = new URL(route.request().url()).searchParams.get('q') || '';
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
  const domains = ['batch-one.example', 'batch-two.example'];
  await runBulkScan(page, domains);
  for (const domain of domains) {
    await page.getByRole('button', { name: `Add ${domain} to shortlist` }).click();
  }
  await openBulkFilters(page);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Create cases' }).click();
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });

  const disposition = page.getByLabel('Set case state');
  await holdBrowserLocalReads(page, 750);
  await disposition.evaluate((element) => {
    const select = element as HTMLSelectElement;
    for (const value of ['suspicious', 'confirmed_abuse']) {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await expect(disposition).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'Marked 2 selected cases as Suspicious' }).first()).toBeVisible();

  const committed = await readBrowserLocalCollection(page, 'cases', {
    minimumRecords: 2,
    minimumRevision: before.manifest.revision + 1,
  });
  expect(committed.manifest.revision).toBe(before.manifest.revision + 1);
  expect(committed.records.map((item) => item.value.disposition)).toEqual(['suspicious', 'suspicious']);
});

test('keeps mobile Bulk review focused while making secondary tools discoverable', {
  tag: ['@analyst-journey', '@journey-bulk-peer-triage'],
}, async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
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
          nameservers: ['ns1.mobile-review.example'],
          hasMx: true,
          hasSpf: true,
          hasDmarc: false,
        },
        diagnostics: {
          version: 7,
          rdap: { status: 'complete' },
          whois: { status: 'skipped' },
          availability: { status: 'complete' },
        },
      }),
    });
  });
  const domains = ['mobile-one.example', 'mobile-two.example', 'mobile-three.example'];
  await runBulkScan(page, domains);

  const workspaceToggle = page.getByRole('button', { name: /Workspace tools/u });
  await expect(workspaceToggle).toHaveAttribute('aria-expanded', 'false');
  const savedSessionsHeading = page.locator('#bulk-sessions-title');
  await expect(savedSessionsHeading).toHaveCount(0);
  await openBulkWorkspaceTools(page);
  await expect(savedSessionsHeading).toBeVisible();
  await workspaceToggle.click();
  await expect(savedSessionsHeading).toHaveCount(0);

  const resultView = page.getByRole('group', { name: 'Bulk result view' });
  await expect(resultView.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.results-table')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Review one result' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(6_000);

  await expect(page.getByRole('combobox', { name: 'Source coverage', exact: true })).toHaveCount(0);
  await openBulkFilters(page);
  const firstRow = page.locator('.results-table tbody tr').first();
  const websiteCell = firstRow.locator('td[data-label="Website"]');
  await expect(websiteCell).toHaveCount(1);
  await expect(websiteCell).toBeHidden();
  await firstRow.getByRole('button', { name: `Show details for ${domains[0]}` }).click();
  await expect(websiteCell).toBeVisible();

  await selectBulkResultView(page, 'Review');
  await expect(page.getByRole('region', { name: 'Review one result' })).toBeVisible();
  await expect(page.locator('.results-table')).toHaveCount(0);

  await selectBulkResultView(page, 'Analysis');
  await expect(page.getByRole('button', { name: /Result distribution/u })).toHaveCount(0);
  const mailExposure = page.locator('section.mail-review');
  await expect(mailExposure).toHaveCount(0);
  const mailExposureToggle = page.getByRole('button', { name: /Mail exposure/u });
  await mailExposureToggle.click();
  await expect(mailExposureToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(mailExposure).toHaveCount(1);
  await expect(mailExposure).toBeVisible();

  await expectNoHorizontalOverflow(page);
  await expectNoHorizontalScrollContainers(page.locator('#results'));
});

test('filters, groups, and selected-only actions use compact observed evidence', {
  tag: ['@analyst-journey', '@journey-bulk-peer-triage'],
}, async ({ page }) => {
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
          observedAt: '2026-07-20T00:05:00.000Z',
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
          rdap: { status: limited ? 'partial' : 'complete', fetchedAt: '2026-07-20T00:00:00.000Z' },
          whois: { status: 'skipped' },
          availability: { status: 'complete' },
        },
      }),
    });
  });
  await runBulkScan(page, ['limited-one.example', 'available-two.example']);

  for (const state of ['registered', 'available']) {
    const value = page.locator(`.results-table .state[data-registration-state='${state}']`);
    expect(await value.evaluate((element) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--text)';
      document.body.append(probe);
      const matches = getComputedStyle(element).color === getComputedStyle(probe).color;
      probe.remove();
      return matches;
    })).toBe(true);
  }

  await openBulkFilters(page);
  await page.getByRole('combobox', { name: 'Source coverage', exact: true }).selectOption('limited');
  await expect(page.locator('.results-table tbody tr')).toHaveCount(1);
  await expect(page.getByText('1 of 2 results matched')).toBeVisible();

  await page.getByLabel('Group summary').selectOption('nameserver');
  await selectBulkResultView(page, 'Analysis');
  await page.getByRole('button', { name: /^Group summary\b/u }).click();
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

  await page.getByRole('combobox', { name: 'Desktop result sort', exact: true }).selectOption('confidence');
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
  const manifestPath = (await manifest!.path())!;
  const manifestRaw = await readFile(manifestPath, 'utf8');
  const manifestContent = JSON.parse(manifestRaw);
  expect(manifestContent).toMatchObject({
    schema: 'whoisleuth.bulk-review-manifest',
    version: BULK_REVIEW_MANIFEST_VERSION,
    selection: { count: 1, domains: ['limited-one.example'] },
    lookupProfile: 'fast',
    view: { sortKey: 'confidence' },
  });
  expect(manifestContent.rows[0].sourceCoverage).toEqual(expect.arrayContaining([
    { source: 'rdap', state: 'partial', observedAt: '2026-07-20T00:00:00.000Z' },
    { source: 'whois', state: 'skipped', observedAt: null },
    { source: 'availability', state: 'complete', observedAt: '2026-07-20T00:05:00.000Z' },
  ]));
  expect(manifestContent.rows[0].sourceCoverage[0].observedAt).not.toBe(manifestContent.generatedAt);
  expect(manifestContent.rows[0].profileContext).toEqual({
    sourceState: 'ready',
    activeProfileId: null,
    profileUpdatedAt: null,
    limitation: '',
  });
  expect(manifestContent.integrity.digestSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
  const { FORCE_COLOR: _forceColor, NO_COLOR: _noColor, ...environment } = process.env;
  const verification = spawnSync(process.execPath, [resolve(process.cwd(), 'bin/whoisleuth.mts'), 'verify-artifact', manifestPath, '--json', '--strict-exit'], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024, env: environment,
  });
  expect(verification.status, verification.stderr).toBe(0);
  expect(verification.stderr).toBe('');
  expect(JSON.parse(verification.stdout)).toMatchObject({ state: 'verified', checks: { contentIntegrity: 'verified', structure: 'verified' } });

  const restoreDigest = await page.evaluateHandle(() => {
    const original = SubtleCrypto.prototype.digest;
    SubtleCrypto.prototype.digest = () => Promise.reject(new Error('The selected manifest could not be prepared.'));
    return () => { SubtleCrypto.prototype.digest = original; };
  });
  const failedDownloads: string[] = [];
  const recordDownload = (item: import('@playwright/test').Download) => { failedDownloads.push(item.suggestedFilename()); };
  page.on('download', recordDownload);
  try {
    await page.getByRole('button', { name: 'Export selected CSV' }).click();
    const exportStatus = page.getByRole('status', { name: 'Bulk review action status', exact: true });
    await expect(exportStatus).toHaveText('The selected manifest could not be prepared.');
    await expect(exportStatus).toBeVisible();
    expect(failedDownloads).toEqual([]);
    await expect(page.getByText('1 selected in the filtered set')).toBeVisible();
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
      await page.setViewportSize(viewport);
      for (const theme of ['light', 'dark'] as const) {
        await useTheme(page, theme);
        await exportStatus.scrollIntoViewIfNeeded();
        await expect(exportStatus).toBeInViewport();
        await expectNoHorizontalOverflow(page);
        const filters = page.getByRole('group', { name: 'Bulk result filters', exact: true });
        await expect(filters).toBeVisible();
        const splitWords = await filters.evaluate((element) => {
          const split: string[] = [];
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) for (const match of (node.textContent ?? '').matchAll(/\S+/gu)) {
            const range = document.createRange();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);
            if (range.getClientRects().length > 1) split.push(match[0]);
          }
          return split;
        });
        expect(splitWords).toEqual([]);
        await test.info().attach(`bulk-export-status-${viewport.width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
      }
    }
  } finally {
    page.off('download', recordDownload);
    await restoreDigest.evaluate((restore) => restore());
    await restoreDigest.dispose();
  }
});

test('keeps an expected missing registry protocol out of limited Bulk outcomes', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => {
    const domain = new URL(route.request().url()).searchParams.get('q') || '';
    const hasNoMachineRegistryService = domain.endsWith('.gt');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        availability: {
          applicable: true,
          domain,
          state: 'registered',
          confidence: 'high',
          registrar: { name: 'Example Registrar' },
        },
        diagnostics: {
          version: 7,
          rdap: { status: hasNoMachineRegistryService ? 'unsupported' : 'complete' },
          whois: { status: 'unsupported' },
          availability: { status: 'complete' },
        },
      }),
    });
  });
  await page.getByLabel('Scan mode').selectOption('deep');
  await runBulkScan(page, ['example.dev', 'example.gt', 'example.com']);
  await openBulkFilters(page);

  const outcomes = page.locator('.outcomes');
  await expect(outcomes.locator('div', { hasText: 'Complete' })).toContainText('2');
  await expect(outcomes.locator('div', { hasText: 'Limited' })).toContainText('1');
  const sourceCoverage = page.getByRole('combobox', { name: 'Source coverage', exact: true });
  await sourceCoverage.selectOption('complete');
  await selectBulkResultView(page, 'Review');
  await expect(page.getByRole('region', { name: 'Review one result' })).toContainText(
    'whois: unsupported (no IANA-published service)',
  );
  await page.getByRole('button', { name: 'Next unresolved' }).click();
  const officialLookup = page.getByRole('region', { name: 'Review one result' }).getByRole('link', { name: /Open official registry lookup/ });
  await expect(officialLookup).toHaveAttribute('href', 'https://www.gt/sitio/');
  await expect(officialLookup).toHaveAttribute('rel', /\bnoreferrer\b/);
  await expect(page.getByRole('region', { name: 'Review one result' })).toContainText('The domain is not added to this link');

  await sourceCoverage.selectOption('limited');
  await selectBulkResultView(page, 'List');
  await expect(page.locator('.results-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.results-table tbody tr')).toContainText('example.com');
});

test('supports focused review and an evidence-qualified two-domain comparison', async ({ page }) => {
  // This scenario deliberately covers IndexedDB writes, two downloads, the
  // desktop workbench, and its final mobile disclosure state in one retained
  // workflow. Give that integration path the suite's established slow budget
  // rather than letting parallel browser load consume its final assertions.
  test.slow();
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
  await selectBulkResultView(page, 'Review');

  const cockpit = page.getByRole('region', { name: 'Review one result' });
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

  await selectBulkResultView(page, 'Analysis');
  await page.getByRole('button', { name: /^Domain comparison\b/u }).click();
  await page.getByRole('button', { name: /^Mail exposure\b/u }).click();
  const comparison = page.getByRole('region', { name: 'Two-domain comparison' });
  await expect(comparison.locator('svg')).toHaveCount(0);
  await expect(comparison.getByRole('table', { name: 'Exact retained values, source states, and derived field deltas' })).toBeVisible();
  await expect(comparison).toContainText('First Registrar');
  await expect(comparison).toContainText('Second Registrar');
  await expect(comparison.getByText('different', { exact: true }).first()).toBeVisible();
  await expect(comparison.getByText('Not recorded in compact evidence', { exact: true }).first()).toBeVisible();
  await expect(comparison.getByText('not_recorded', { exact: true }).first()).toBeVisible();
  const technologyRow = comparison.getByRole('row', { name: /Technology Technology identifiers/u });
  await expect(technologyRow).toContainText('fixture-cms, shared-edge');
  await expect(technologyRow).toContainText('fixture-commerce, shared-edge');
  await expect(technologyRow).toContainText('Exact source state complete');
  await expect(technologyRow).toContainText('Comparison state different');
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

  await page.setViewportSize({ width: 393, height: 852 });
  const exactTable = comparison.getByRole('table', { name: 'Exact retained values, source states, and derived field deltas' });
  await expect(exactTable).toBeVisible();
  await expect(exactTable).toHaveCSS('display', 'block');
  await expect(technologyRow).toBeVisible();
  await expect(technologyRow).toHaveCSS('display', 'block');
  await expect(technologyRow).toContainText('fixture-cms, shared-edge');
  await expect(technologyRow).toContainText('fixture-commerce, shared-edge');
  await expect(technologyRow).toContainText('Exact source state complete');
  await expect(technologyRow).toContainText('Comparison state different');
  expect(await pseudoContent(technologyRow.locator('td').nth(0), '::before')).toContain('left-review.example');
  expect(await pseudoContent(technologyRow.locator('td').nth(1), '::before')).toContain('right-review.example');
  expect(await pseudoContent(technologyRow.locator('td').nth(2), '::before')).toContain('Delta');
  await expectNoHorizontalOverflow(page);
  await expectNoHorizontalScrollContainers(comparison);
  await expectNoHorizontalScrollContainers(mailReview);
  const mobileEvidenceLink = technologyRow.getByRole('link', { name: 'View settled row' }).first();
  await expect(mobileEvidenceLink).toBeVisible();
  await expect(mobileEvidenceLink).toHaveAttribute('href', '#bulk-result-0');
  expect((await boundingBox(mobileEvidenceLink)).height).toBeGreaterThanOrEqual(44);
  await mobileEvidenceLink.focus();
  await expect(mobileEvidenceLink).toBeFocused();
  await mobileEvidenceLink.click();
  await expect(page).toHaveURL(/#bulk-result-0$/u);
  await expect(page.locator('#bulk-result-0')).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
  await expectNoHorizontalScrollContainers(page.locator('#results'));
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
  await openBulkWorkspaceTools(page, 'review');

  await page.getByLabel('Review state for limited-review.example').selectOption('reviewing');
  await expect(page.getByRole('region', { name: 'Undo analyst change' })).toContainText('limited-review.example');
  await page.getByRole('region', { name: 'Undo analyst change' }).getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Review state for limited-review.example')).toHaveValue('unreviewed');
  await page.getByLabel('Review state for limited-review.example').selectOption('reviewing');
  await openBulkFilters(page);
  await page.getByRole('combobox', { name: 'Source coverage', exact: true }).selectOption('limited');
  await page.getByLabel('Filter by review state').selectOption('reviewing');
  await openBulkWorkspaceTools(page, 'review');
  await page.getByLabel('New view name').fill('Limited active review');
  await page.getByRole('button', { name: 'Save current view' }).click();
  await expect(page.getByRole('status', { name: 'Bulk review action status', exact: true })).toContainText(/Saved.*Limited active review/u);

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
  await openBulkWorkspaceTools(page, 'review');
  await page.getByLabel('Saved Bulk review view').selectOption({ label: 'Limited active review' });
  await page.getByRole('button', { name: 'Load view' }).click();
  await expect(page.getByLabel('Filter by review state')).toHaveValue('reviewing');
  await expect(page.locator('.results-table')).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Bulk review action status', exact: true })).toContainText('No scan was started');

  await page.setViewportSize({ width: 390, height: 844 });
  await openBulkWorkspaceTools(page, 'review');
  await expectNoHorizontalOverflow(page);
});

test('a malformed successful response remains an explicit failure in exports and retained monitoring state', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ availability: 'registered', diagnostics: {} }),
  }));

  await runBulkScan(page, ['malformed-response.example']);
  await openBulkFilters(page);
  const row = page.locator('.results-table tbody tr');
  await expect(page.locator('.filters button', { hasText: 'errors' }).locator('span')).toHaveText('1');
  await expect(row.locator('td[data-label="Registration"]')).toContainText('error');
  expect(await row.locator('.state').evaluate((element) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--danger)';
    document.body.append(probe);
    const matches = getComputedStyle(element).color === getComputedStyle(probe).color;
    probe.remove();
    return matches;
  })).toBe(true);
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
  expect(csv.split('\n')[0]).toContain('opportunity,opportunity_model_version');

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
  await openBulkFilters(page);

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
  await openBulkFilters(page);
  const domains = () => page.locator('.results-table tbody td[data-label="Domain"] strong').allTextContents();
  await expect(page.getByRole('region', { name: 'Risk and opportunity matrix' })).toHaveCount(0);
  await expect(page.locator('#bulk-triage-plot')).toHaveCount(0);
  await expect(page.locator('.results-table tbody tr')).toHaveCount(3);

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
  await openBulkFilters(page);
  await expect(page.getByLabel('Order')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('keeps partial Bulk Risk evidence inconclusive and outside the comparable sort cohort', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => {
    const domain = new URL(route.request().url()).searchParams.get('q') || '';
    const limited = domain === 'partial-risk.example';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        availability: { applicable: true, domain, state: 'registered', confidence: 'high' },
        diagnostics: {
          version: 7,
          rdap: { status: limited ? 'partial' : 'complete' },
          whois: { status: 'skipped' },
          availability: { status: 'complete' },
        },
      }),
    });
  });

  await runBulkScan(page, ['partial-risk.example', 'settled-risk.example']);
  await openBulkFilters(page);
  const partial = page.locator('.results-table tbody tr', { hasText: 'partial-risk.example' });
  const settled = page.locator('.results-table tbody tr', { hasText: 'settled-risk.example' });
  await expect(settled.locator('td[data-label="Risk"]')).toContainText('Lower');
  await expect(partial.locator('td[data-label="Risk"]')).toContainText('Inconclusive');
  await expect(partial.locator('td[data-label="Risk"]')).not.toContainText('Lower');
  await expect(page.getByText(/Risk sorting compares 1 of 2 rows/u)).toBeVisible();
  await expect(page.getByText(/1 incompatible or inconclusive row sorts last/u)).toBeVisible();
  await expect(page.locator('.results-table tbody td[data-label="Domain"] strong')).toHaveText([
    'settled-risk.example',
    'partial-risk.example',
  ]);
  await partial.locator('td[data-label="Risk"] summary[aria-label*="Inspect Risk model and factors"]').click();
  await expect(partial.locator('td[data-label="Risk"]')).toContainText(/source evidence is partial or unavailable/u);
});

test('keeps the current queue, results, filters, sort, and page during console navigation only', async ({ page }) => {
  const domains = invalidDomains(101);
  // Load the deferred controls against one result before the intentionally
  // large result DOM is present so snapshot collection cannot consume the
  // product deadline.
  await runBulkScan(page, [domains[0]!]);
  await openBulkFilters(page);
  await runBulkScan(page, domains);
  await openBulkFilters(page);
  await page.locator('.filters').getByRole('button', { name: /^errors / }).click();
  await page.getByLabel('Desktop result sort').selectOption('domain');
  await page.getByLabel('Order').selectOption('-1');
  await page.getByRole('navigation', { name: 'Bulk result pages' }).getByRole('button', { name: 'Next' }).click();

  const consoleNavigation = page.locator('#console-navigation');
  await consoleNavigation.getByRole('link', { name: /^Dashboard/ }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await consoleNavigation.getByRole('link', { name: /^Bulk/ }).click();
  await expect(page.getByRole('heading', { name: 'Bulk', exact: true })).toBeVisible();
  await openBulkFilters(page);

  await expect(page.locator('#domains')).toHaveValue(domains.join('\n'));
  await expect(page.getByLabel('Desktop result sort')).toHaveValue('domain');
  await expect(page.getByLabel('Order')).toHaveValue('-1');
  await expect(page.getByRole('navigation', { name: 'Bulk result pages' })).toContainText('Page 2 of 2');
  await expect(page.locator('.results-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.filters').getByRole('button', { name: /^errors / })).toHaveClass(/active/);

  await page.reload();
  // A hard reload deliberately discards the in-memory session. Under the
  // four-shard suite the authenticated shell can still be resolving its
  // bounded session check when the default assertion deadline expires.
  await expect(page.locator('#domains')).toHaveValue('', { timeout: 15_000 });
  await expect(page.locator('.results-table')).toHaveCount(0);
});
