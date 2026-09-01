import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { boundingBox, currentBrandProfileBrowserStore, expectNoHorizontalOverflow, expectNoHorizontalScrollContainers, migrateLegacyBrowserData, openBulkFilters, pseudoContent, runBulkScan, selectBulkResultView } from './helpers';
import { TLS_RELATIONSHIP_PROFILE_VERSION } from '../packages/comparison/relationship-evidence.mts';
import { captureDownloads, invalidDomains } from './bulk-analysis-fixtures';

// Bulk responsive presentation, identifier and relationship-evidence coverage.

test.use({ allowExpectedBulkLookup400Noise: true });

test.beforeEach(async ({ page }) => {
  await page.goto('/bulk');
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
  await openBulkFilters(page);

  const thead = page.locator('.results-table thead');
  const theadBox = await boundingBox(thead);
  expect(theadBox.width).toBeLessThanOrEqual(2);
  expect(theadBox.height).toBeLessThanOrEqual(2);

  const row = page.locator('.results-table tbody tr').first();
  const rowBox = await boundingBox(row);

  const compactLabels = ['Registration', 'Risk'];
  for (const label of compactLabels) {
    const cell = row.locator(`td[data-label="${label}"]`);
    const cellBox = await boundingBox(cell);
    expect(cellBox.width, `${label} should be compact`).toBeLessThan(rowBox.width * 0.5);
    expect(await pseudoContent(cell, '::before')).toContain(label);
  }
  await expect(row.locator('td[data-label="Opportunity"]')).toHaveCount(0);
  await expect(page.getByLabel('Mobile result sort').locator('option[value="opportunity"]')).toHaveCount(0);
  await expect(page.getByLabel('Desktop result sort').locator('option[value="opportunity"]')).toHaveCount(0);
  await expect(page.locator('.cockpit').getByText('Opportunity', { exact: true })).toHaveCount(0);

  const collapsedLabels = ['Website', 'Registrar', 'Mutation', 'Actions'];
  for (const label of collapsedLabels) {
    const collapsedCell = row.locator(`td[data-label="${label}"]`);
    await expect(collapsedCell).toHaveCount(1);
    await expect(collapsedCell).toBeHidden();
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
  await expect(previousButton).toHaveAttribute('aria-disabled', 'true');
  await expect(nextButton).toHaveAttribute('aria-disabled', 'false');
  await previousButton.focus();
  await expect(previousButton).toBeFocused();
  await expect(pagination).toContainText('Page 1 of 2');

  await nextButton.click();
  await expect(nextButton).toBeFocused();
  await expect(page.locator('.results-table tbody tr')).toHaveCount(1);
  await expect(pagination).toContainText('Page 2 of 2');
  await expect(nextButton).toHaveAttribute('aria-disabled', 'true');
  await expect(previousButton).toHaveAttribute('aria-disabled', 'false');

  await previousButton.click();
  await expect(previousButton).toBeFocused();
  await expect(page.locator('.results-table tbody tr')).toHaveCount(100);
  await expect(pagination).toContainText('Page 1 of 2');
});

test('IDN official-domain skeleton evidence renders, filters, and contributes once to Risk', async ({ page }) => {
  const profile = {
    id: 'idn-profile', name: 'Example Brand', officialDomains: ['sample.example'], productNames: [], tlds: ['example'],
    approvedPartnerDomains: [], allowlistedDomains: [], allowlistedRegistrars: [], dkimSelectors: [],
    trademarkOwner: '', trademarkRegistration: '', officialFaviconHash: '', officialFaviconPHash: '',
    createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
  };
  await migrateLegacyBrowserData(page, {
    'whois-rdap-brand-profiles-v1': currentBrandProfileBrowserStore([profile]),
    'whois-rdap-active-brand-profile-v1': profile.id,
  });
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      availability: {
        applicable: true, domain: 'xn--smple-4ve.example', state: 'registered', confidence: 'high',
        nameservers: [], privacyProtected: null, activityStatus: null,
      },
      diagnostics: { version: 7, rdap: { status: 'unsupported' }, whois: { status: 'skipped' }, availability: { status: 'complete' } },
    }),
  }));

  await runBulkScan(page, ['xn--smple-4ve.example']);
  const row = page.locator('.results-table tbody tr');
  await expect(row.getByText('Unicode: sаmple.example', { exact: true })).toBeVisible();
  await expect(row.getByText('Mixed writing scripts', { exact: true })).toBeVisible();
  await expect(row.getByText('Official-domain skeleton match', { exact: true })).toBeVisible();
  const riskCell = row.locator('td[data-label="Risk"]');
  await expect(riskCell).toContainText('Lower');
  await expect(riskCell).toContainText('Risk model v7');
  await riskCell.locator('summary[aria-label*="Inspect Risk model and factors"]').click();
  await expect(riskCell).toContainText('26/100');
  await expect(riskCell).toContainText(/IDN skeleton matches an official Brand Profile domain/u);

  await openBulkFilters(page);
  await page.getByRole('button', { name: 'IDN / confusable' }).click();
  await expect(row).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test('risk model v7 exposes capped cross-family corroboration in Bulk triage', async ({ page }) => {
  const profile = {
    id: 'risk-profile', name: 'Example profile', officialDomains: ['official.example'], productNames: [], tlds: ['example'],
    approvedPartnerDomains: [], allowlistedDomains: [], allowlistedRegistrars: [], dkimSelectors: [],
    trademarkOwner: '', trademarkRegistration: '', officialFaviconHash: 'a'.repeat(64), officialFaviconPHash: '', pageBaseline: null,
    createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
  };
  await migrateLegacyBrowserData(page, {
    'whois-rdap-brand-profiles-v1': currentBrandProfileBrowserStore([profile]),
    'whois-rdap-active-brand-profile-v1': profile.id,
  });
  const handoffToken = '0123456789abcdef0123456789abcdef';
  await page.evaluate((token) => {
    sessionStorage.setItem('whoisleuth:candidate-handoff:v2', JSON.stringify({
      version: 2,
      token,
      createdAt: '2026-07-13T00:00:00.000Z',
      source: 'typosquat',
      candidates: [{ domain: 'candidate.example', source: 'official.example', mutationTypes: ['dictionary'] }],
    }));
  }, handoffToken);
  await page.goto(`/bulk?source=typosquat&handoff=${handoffToken}`);
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      availability: {
        applicable: true, domain: 'candidate.example', state: 'registered', confidence: 'high',
        faviconHash: 'a'.repeat(64), externalAssetHosts: ['official.example'],
        phishingLanguageMatch: 'Reviewed English account-verification language', hasPasswordField: true,
      },
      diagnostics: { version: 7, rdap: { status: 'complete' }, whois: { status: 'skipped' }, availability: { status: 'complete' } },
    }),
  }));

  await runBulkScan(page, ['candidate.example']);
  const row = page.locator('.results-table tbody tr');
  const riskCell = row.locator('td[data-label="Risk"]');
  await expect(riskCell).toContainText('Elevated');
  await expect(riskCell).toContainText('Risk model v7');
  await riskCell.locator('summary[aria-label*="Inspect Risk model and factors"]').click();
  await expect(riskCell).toContainText('79/100');
  await expect(riskCell).toContainText(/Corroborating context across 3 independent evidence families/u);

  await openBulkFilters(page);
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
    'whois-rdap-brand-profiles-v1': currentBrandProfileBrowserStore([profile]),
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
            source: 'tls', profileVersion: TLS_RELATIONSHIP_PROFILE_VERSION, status: 'success',
            certificate: { fingerprintSha256: 'c'.repeat(64) },
          } : null,
        },
        diagnostics: { version: 7, rdap: { status: 'complete' }, whois: { status: 'complete' }, availability: { status: 'complete' } },
      }),
    });
  });

  await page.getByLabel('Scan mode').selectOption('deep');
  await runBulkScan(page, ['first.example', 'second.example', 'third.example']);
  await selectBulkResultView(page, 'Analysis');
  await page.getByRole('button', { name: /^Relationships\b/u }).click();

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
  await expect(relationshipList.getByText('Official asset host match', { exact: true })).toBeVisible();
  await expect(section.locator('.relationship-glyph svg')).toHaveCount(6);
  await expect(section.locator('article', { hasText: 'Shared nameserver set' }).locator('.relationship-glyph svg')).toHaveAttribute('data-icon', 'nameserver');
  await expect(section.locator('article', { hasText: 'Shared TLS certificate' }).locator('.relationship-glyph svg')).toHaveAttribute('data-icon', 'tls');
  await expect(section.locator('article', { hasText: 'Similar favicon' }).locator('.relationship-glyph svg')).toHaveAttribute('data-icon', 'favicon');
  await expect(section).toContainText('not ownership or maliciousness conclusions');
  await section.getByText('Interpretation limits').click();
  await expect(section).toContainText('does not establish common control');

  const certificateRelationship = section.locator('article', { hasText: 'Shared TLS certificate' });
  const admissionRequests: string[] = [];
  page.on('request', (request) => {
    if (['fetch', 'xhr', 'ping'].includes(request.resourceType())) admissionRequests.push(request.url());
  });
  const previewRetention = certificateRelationship.getByRole('button', { name: 'Preview retention' });
  await previewRetention.click();
  const admission = section.getByRole('dialog', { name: 'Retain this relationship observation?' });
  await expect(admission).toBeFocused();
  await expect(admission).toContainText('Exact leaf-certificate SHA-256');
  await expect(admission.getByText('2 requests', { exact: false })).toHaveCount(0);
  await expect(admission).toContainText('0 requests · no external service receives the target');
  await expect(admission).toContainText('One bounded browser-local relationship observation');
  await expect(admission).toContainText('does not establish shared ownership, control, actor identity, coordination, intent, safety, or maliciousness');
  await admission.getByRole('button', { name: 'Cancel' }).click();
  await expect(previewRetention).toBeFocused();
  await previewRetention.click();
  await section.getByRole('dialog', { name: 'Retain this relationship observation?' })
    .getByRole('button', { name: 'Retain reviewed observation' }).click();
  await expect(certificateRelationship.getByRole('button', { name: 'Retained in Monitor' })).toBeDisabled();
  await expect(section.getByRole('status')).toContainText('Retained shared tls certificate for 2 domains in this browser');
  expect(admissionRequests).toEqual([]);

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

test('candidate handoff presents profile-listed actions, limitations, and export', async ({ page }) => {
  const profile = {
    id: 'listing-profile', name: 'Listing profile', officialDomains: ['official.example'], productNames: [], tlds: ['example'],
    approvedPartnerDomains: [], allowlistedDomains: ['secure-example.example'], allowlistedRegistrars: [], dkimSelectors: [],
    trademarkOwner: '', trademarkRegistration: '', officialFaviconHash: '', officialFaviconPHash: '', pageBaseline: null,
    createdAt: '2026-07-16T00:00:00.000Z', updatedAt: '2026-07-16T00:00:00.000Z',
  };
  await migrateLegacyBrowserData(page, {
    'whois-rdap-brand-profiles-v1': currentBrandProfileBrowserStore([profile]),
    'whois-rdap-active-brand-profile-v1': profile.id,
  }, { destination: '/bulk' });
  const handoffToken = 'fedcba9876543210fedcba9876543210';
  await page.evaluate((token) => {
    sessionStorage.setItem('whoisleuth:candidate-handoff:v2', JSON.stringify({
      version: 2,
      token,
      createdAt: '2026-07-16T00:00:00.000Z',
      source: 'typosquat',
      candidates: [
        { domain: 'login-example.example', source: 'official.example', mutationTypes: ['dictionary'] },
        { domain: 'secure-example.example', source: 'official.example', mutationTypes: ['dictionary'] },
      ],
    }));
  }, handoffToken);
  await page.goto(`/bulk?source=typosquat&handoff=${handoffToken}`);
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
  await selectBulkResultView(page, 'Analysis');
  await page.getByRole('button', { name: /^Profile listing\b/u }).click();
  const coverage = page.locator('section.coverage');
  await expect(coverage.getByRole('heading', { name: 'Profile-listed share · 50%' })).toBeVisible();
  await expect(coverage).toContainText('Profile-listed is an overlapping local profile-membership count, separate from the retained registration outcome.');
  await expect(coverage).toContainText('Generated 2');
  await expect(coverage).toContainText('Registered 1');
  await expect(coverage).toContainText('Available 1');
  await expect(coverage).toContainText('Profile-listed 1 · overlaps outcomes');
  await expect(coverage).toContainText('Registered, available, and unknown partition the generated candidates.');
  await expect(coverage.getByRole('cell', { name: 'Impersonation term', exact: true }).first()).toBeVisible();
  await expect(coverage.getByRole('img', { name: /Mutation-family profile listing.*Registration outcomes form each stacked bar/ })).toBeVisible();
  await expect(coverage.getByRole('img', { name: /TLD profile listing.*Registration outcomes form each stacked bar/ })).toBeVisible();
  await expect(coverage.locator('.state-profileListed')).toHaveCount(0);
  await expect(coverage.locator('.profile-listing-marker')).toHaveCount(2);
  const mutationRow = coverage.locator('.coverage-tables > div').first().locator('tbody tr').first();
  await expect(mutationRow.locator('td[data-label="Group"]')).toHaveText('Impersonation term');
  await expect(mutationRow.locator('td[data-label="Profile-listed (overlap)"]')).toHaveText('1');

  const plan = coverage.locator('details.coverage-plan');
  await plan.locator(':scope > summary').click();
  const listedAvailable = plan.locator('article', { hasText: 'secure-example.example' });
  await expect(listedAvailable).toContainText('P1');
  await expect(listedAvailable).toContainText('Review defensive acquisition · Available · Profile-listed');

  const downloadPromise = page.waitForEvent('download');
  await coverage.getByRole('button', { name: 'Export profile listing CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^defensive-registration-profile-listing-\d{4}-\d{2}-\d{2}\.csv$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  const content = await readFile(path!, 'utf8');
  expect(content).toContain('dimension,group,total,registered,available,unknown,profile_listed_overlapping,profile_listed_share,domain,outcome,profile_listed,priority,action,rationale');
  expect(content).toContain('mutation,Impersonation term,2,1,1,0,1,50');
  expect(content).toContain('candidate,,,,,,,,secure-example.example,available,true,P1,Review defensive acquisition');

  await coverage.getByRole('button', { name: 'Load group' }).first().click();
  await expect(page.locator('#domains')).toHaveValue('login-example.example\nsecure-example.example');
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await expectNoHorizontalScrollContainers(coverage);
});
