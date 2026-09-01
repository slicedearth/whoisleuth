import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { currentBulkSessionBrowserStore, expectNoHorizontalOverflow, expectNoHorizontalScrollContainers, migrateLegacyBrowserData, openBulkFilters, openBulkWorkspaceTools, readBrowserLocalCollection, runBulkScan, selectBulkResultView } from './helpers';

// Saved Bulk sessions, provenance, resumption and cancellation coverage.

test.use({ allowExpectedBulkLookup400Noise: true });

test.beforeEach(async ({ page }) => {
  await page.goto('/bulk');
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
  await openBulkWorkspaceTools(page);
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
  const baseline = stored.records.find((record) => record.value.name === 'Baseline review')?.value;
  expect(baseline?.profileContext).toEqual({
    sourceState: 'ready',
    activeProfileId: null,
    profileUpdatedAt: null,
    limitation: '',
  });
  expect(baseline?.results[0]).toMatchObject({
    risk: 6,
    riskModelVersion: 7,
    trusted: null,
    faviconMatch: false,
    faviconNearMatch: false,
    reusesOfficialAssets: false,
    idnReferenceMatch: false,
    pageBaselineMatch: false,
    hasActiveBrandProfile: false,
  });
  expect(baseline?.results[0]?.riskFactors).toContainEqual({
    label: 'Base context for “registered”',
    points: 6,
  });

  await page.getByText('Compare two saved sessions', { exact: true }).click();
  await page.getByLabel('Baseline', { exact: true }).selectOption({ label: 'Baseline review' });
  await page.getByLabel('Later session', { exact: true }).selectOption({ label: 'Later review' });
  await expect(page.getByText('Registration: registered → available')).toBeVisible();
  await expect(page.getByText(/source-state change may reflect collection availability/i)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await openBulkWorkspaceTools(page);
  await expectNoHorizontalOverflow(page);
  await expectNoHorizontalScrollContainers(page.getByRole('region', { name: 'Saved Bulk sessions' }));

  await page.reload();
  await openBulkWorkspaceTools(page);
  await expect(page.getByRole('heading', { name: 'Saved Bulk sessions' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Baseline review' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Later review' })).toBeVisible();
  await page.locator('article').filter({ hasText: 'Baseline review' }).getByRole('button', { name: 'Load' }).click();
  await expect(page.locator('.results-table tbody tr')).toHaveCount(1);
  await page.getByRole('group', { name: 'Bulk result view' }).getByRole('button', { name: 'List', exact: true }).click();
  const restoredRisk = page.locator('.results-table tbody tr').first().locator('td[data-label="Risk"]');
  await expect(restoredRisk).toContainText('Lower');
  await restoredRisk.locator('summary[aria-label*="Inspect Risk model and factors"]').click();
  await expect(restoredRisk).toContainText('6/100');
  await expect(page.getByRole('status').filter({ hasText: /Loaded Baseline review/ })).toBeVisible();
});

test('isolates saved-session controls while an active scan owns the result state', async ({ page }) => {
  let releaseLookup = () => {};
  const lookupGate = new Promise<void>((resolve) => { releaseLookup = resolve; });
  await page.route('**/api/lookup?*', async (route) => {
    const domain = new URL(route.request().url()).searchParams.get('q') || '';
    if (domain === 'active-review.invalid') await lookupGate;
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

  await runBulkScan(page, ['saved-review.invalid']);
  await openBulkWorkspaceTools(page);
  await page.getByLabel('Session name').fill('Saved review');
  await page.getByRole('button', { name: 'Save current session' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved Saved review.' })).toBeVisible();
  const savedSessions = page.getByRole('region', { name: 'Saved Bulk sessions' });
  const saved = savedSessions.getByRole('article').filter({ hasText: 'Saved review' });

  await page.locator('#domains').fill('active-review.invalid');
  await page.getByRole('button', { name: 'Scan 1 domain' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Scanning 1 domain…' })).toBeVisible();
  await expect(saved.getByRole('button', { name: 'Load' })).toBeDisabled();
  await expect(saved.getByRole('button', { name: 'Delete' })).toBeDisabled();
  await expect(savedSessions.getByRole('button', { name: 'Export sessions' })).toBeDisabled();

  releaseLookup();
  await expect(page.getByRole('status').filter({ hasText: 'Completed 1 of 1 lookups.' })).toBeVisible();
  await expect(saved.getByRole('button', { name: 'Load' })).toBeEnabled();
  await expect(page.locator('.results-table tbody tr', { hasText: 'active-review.invalid' })).toHaveCount(1);
  await expect(page.locator('.results-table tbody tr', { hasText: 'saved-review.invalid' })).toHaveCount(0);
});

test('resumes only unstarted rows from an explicitly saved partial session', async ({ page }) => {
  const savedAt = '2026-07-28T03:00:00.000Z';
  await migrateLegacyBrowserData(page, {
    'whoisleuth-bulk-sessions-v1': currentBulkSessionBrowserStore([{
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
      }]),
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

  await openBulkWorkspaceTools(page);
  await page.getByRole('button', { name: 'Resume unstarted' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Completed 1 of 1 lookups.' })).toBeVisible();
  expect(requests).toEqual(['pending.invalid']);
  const stored = await readBrowserLocalCollection(page, 'bulk_sessions', { minimumRecords: 1, minimumRevision: 2 });
  expect(stored.records[0]?.value?.results).toHaveLength(2);
});

test('an unavailable Profile context stays inconclusive in Bulk rows, sessions, CSV, and Monitor actions', async ({ page }) => {
  const requestedDomains: string[] = [];
  await page.route('**/api/lookup?*', async (route) => {
    const domain = new URL(route.request().url()).searchParams.get('q') || '';
    requestedDomains.push(domain);
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
          faviconHash: 'a'.repeat(64),
          pageTitle: 'Reserved fixture page',
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
  await page.goto('/lookup');
  await migrateLegacyBrowserData(page, {}, { destination: '/lookup' });
  await page.evaluate(() => {
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(name: string) {
      if (this === localStorage && name === 'whois-rdap-active-brand-profile-v1') {
        throw new DOMException('Preference read denied', 'SecurityError');
      }
      return originalGetItem.call(this, name);
    };
  });
  await page.locator('#console-navigation').getByRole('link', { name: /^Bulk/u }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Brand Profile context is unavailable' })).toBeVisible();
  await page.locator('#domains').fill('profile-context.invalid');
  await page.getByRole('button', { name: 'Scan 1 domain' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Completed 1 of 1 lookups.' })).toContainText('profile-derived fields are retained as inconclusive');
  expect(requestedDomains).toEqual(['profile-context.invalid']);

  const row = page.locator('.results-table tbody tr', { hasText: 'profile-context.invalid' });
  await expect(row).toContainText('Brand Profile context unevaluated');
  await expect(row.locator('td[data-label="Risk"]')).toContainText('Inconclusive');
  await expect(row.locator('td[data-label="Risk"]')).toContainText('Excluded from Risk comparison');
  await selectBulkResultView(page, 'Review');
  await page.getByLabel('Current row monitor list').fill('Unavailable context review');
  await expect(page.getByRole('button', { name: 'Save current to Monitor' })).toBeDisabled();
  await openBulkFilters(page);
  await expect(page.getByRole('button', { name: 'Save to Monitor' })).toBeDisabled();

  const csvPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const csvPath = await (await csvPromise).path();
  expect(csvPath).not.toBeNull();
  const csv = await readFile(csvPath!, 'utf8');
  expect(csv.split('\n')[0]).toContain('profile_context_state,profile_context_limitation,profile_status');
  expect(csv).toContain('profile-context.invalid,,Latin,false,,registered,high,unavailable');
  expect(csv).toContain('profile-dependent Risk assessment remain inconclusive');
  expect(csv).not.toContain(',official,');
  expect(csv).not.toContain(',allowlisted,');

  await openBulkWorkspaceTools(page);
  await page.getByLabel('Session name').fill('Unavailable profile review');
  await page.getByRole('button', { name: 'Save current session' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved Unavailable profile review.' })).toBeVisible();
  const stored = await readBrowserLocalCollection(page, 'bulk_sessions', { minimumRecords: 1 });
  expect(stored.manifest.schemaVersion).toBe(4);
  expect(stored.records[0]?.value.profileContext).toMatchObject({ sourceState: 'unavailable' });
  expect(stored.records[0]?.value.results[0]).toMatchObject({
    risk: null,
    riskModelVersion: null,
    riskFactors: [],
    trusted: null,
    faviconMatch: null,
    faviconNearMatch: null,
    reusesOfficialAssets: null,
    idnReferenceMatch: null,
    pageBaselineMatch: null,
    hasActiveBrandProfile: null,
  });

  const exportPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export sessions' }).click();
  const exportPath = await (await exportPromise).path();
  expect(exportPath).not.toBeNull();
  const exported = JSON.parse(await readFile(exportPath!, 'utf8'));
  expect(exported).toMatchObject({ schema: 'whoisleuth.bulk-sessions', version: 4 });
  expect(exported.sessions[0].profileContext.sourceState).toBe('unavailable');
  expect(exported.sessions[0].results[0].risk).toBeNull();
  expect(exported.sessions[0].results[0].idnReferenceMatch).toBeNull();
});

test('aggregate Monitor saves are atomic when one settled row lacks ready profile provenance', async ({ page }) => {
  const savedAt = '2026-07-29T03:00:00.000Z';
  const readyContext = {
    sourceState: 'ready',
    activeProfileId: null,
    profileUpdatedAt: null,
    limitation: '',
  };
  const unavailableContext = {
    sourceState: 'unavailable',
    activeProfileId: null,
    profileUpdatedAt: null,
    limitation: 'This row requires a local profile-context rescan.',
  };
  const compactRow = (domain: string, profileContext: typeof readyContext | typeof unavailableContext) => ({
    domain,
    status: 'error',
    availability: 'error',
    confidence: 'unknown',
    registrar: '—',
    activity: '—',
    risk: null,
    opportunity: null,
    mutationTypes: [],
    trusted: null,
    error: 'Reserved fixture failure',
    scanDepth: 'fast',
    nameservers: [],
    faviconMatch: profileContext.sourceState === 'ready' ? false : null,
    faviconNearMatch: profileContext.sourceState === 'ready' ? false : null,
    reusesOfficialAssets: profileContext.sourceState === 'ready' ? false : null,
    hasPasswordField: false,
    idnReferenceMatch: profileContext.sourceState === 'ready' ? false : null,
    pageBaselineMatch: profileContext.sourceState === 'ready' ? false : null,
    hasActiveBrandProfile: profileContext.sourceState === 'ready' ? false : null,
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
    profileContext,
  });
  await migrateLegacyBrowserData(page, {
    'whoisleuth-bulk-sessions-v1': currentBulkSessionBrowserStore([{
        id: 'mixed-profile-context',
        name: 'Mixed profile context',
        mode: 'fast',
        state: 'complete',
        inputDigest: `sha256:${'d'.repeat(64)}`,
        domains: ['ready-row.invalid', 'unavailable-row.invalid'],
        results: [
          compactRow('ready-row.invalid', readyContext),
          compactRow('unavailable-row.invalid', unavailableContext),
        ],
        startedAt: savedAt,
        updatedAt: savedAt,
        completedAt: savedAt,
        profileContext: {
          sourceState: 'mixed',
          activeProfileId: null,
          profileUpdatedAt: null,
          limitation: 'Rows in this saved Bulk session were evaluated under more than one Brand Profile context. Review each row provenance before comparison.',
        },
      }]),
  });

  await openBulkWorkspaceTools(page);
  await page.locator('article', { hasText: 'Mixed profile context' }).getByRole('button', { name: 'Load' }).click();
  await expect(page.locator('.results-table tbody tr')).toHaveCount(2);
  await openBulkFilters(page);
  await page.getByLabel('Watchlist name').fill('Atomic review');
  const saveAll = page.getByRole('button', { name: 'Save to Monitor', exact: true });
  await expect(saveAll).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: '1 result row requires a local rescan' })).toBeVisible();

  await saveAll.evaluate((element) => {
    (element as HTMLButtonElement).disabled = false;
    (element as HTMLButtonElement).click();
  });
  await expect(page.locator('.save-watchlist').getByRole('status')).toContainText('Nothing was saved. 1 target row has unevaluated Brand Profile context');
  expect((await readBrowserLocalCollection(page, 'watchlists')).records).toHaveLength(0);

  await page.getByRole('button', { name: 'Select matched' }).click();
  await expect(page.getByText(/1 selected row is excluded because Brand Profile context is unavailable/u)).toBeVisible();
  const saveSelected = page.getByRole('button', { name: 'Save selected', exact: true });
  await expect(saveSelected).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: '1 selected row requires a local rescan' })).toBeVisible();
  await saveSelected.evaluate((element) => {
    (element as HTMLButtonElement).disabled = false;
    (element as HTMLButtonElement).click();
  });
  await expect(page.locator('.save-watchlist').getByRole('status')).toContainText('Nothing was saved. 1 selected row has unevaluated Brand Profile context');
  expect((await readBrowserLocalCollection(page, 'watchlists')).records).toHaveLength(0);
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
