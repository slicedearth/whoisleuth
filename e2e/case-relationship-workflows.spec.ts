import { expect, test } from './fixtures';
import { currentBrandProfileBrowserStore, currentBrowserLocalDocument, expectNoHorizontalOverflow, failBrowserLocalCollectionReads, holdBrowserLocalReads, migrateLegacyBrowserData, readBrowserLocalCollection } from './helpers';

// Every domain here is a local/invalid value (RFC 2606 .invalid, or dotless
// bad-domain-* that classifyQuery rejects with a 400). Case features are
// entirely browser-local: creating and editing a case never reaches an
// upstream service, and the shared fixture's network guard enforces that.

import { caseRecord, snapshot } from './case-test-fixtures';
import { COMMON_INFRASTRUCTURE_SNAPSHOT } from '../frontend/src/lib/analysis/common-infrastructure.ts';
import { CASE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/case-model';
import { LOOKUP_EVIDENCE_SCHEMA_VERSION } from '../lib/evidence-export.mts';

const COHORT_PROFILE_ID = 'cohort_profile_exact';
const COHORT_OTHER_PROFILE_ID = 'cohort_profile_other';
const COHORT_NOW = '2026-08-09T00:00:00.000Z';
const ACTIVE_PROFILE_KEY = 'whois-rdap-active-brand-profile-v1';

function cohortProfile(id: string, name: string) {
  return {
    id,
    name,
    officialDomains: [],
    productNames: [],
    tlds: [],
    approvedPartnerDomains: [],
    allowlistedDomains: [],
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
    createdAt: COHORT_NOW,
    updatedAt: COHORT_NOW,
  };
}

function retainedRelationship(type: 'certificate' | 'favicon' | 'ip_address', value: string, domains: string[]) {
  return {
    id: `relationship-${type}-fixture`,
    type,
    label: type === 'certificate' ? 'Shared TLS certificate' : type === 'favicon' ? 'Similar favicon' : 'Shared IP address',
    method: type === 'certificate' ? 'Exact leaf-certificate SHA-256' : type === 'favicon' ? 'Bounded perceptual comparison' : 'Exact normalised address',
    normalizedValue: value,
    displayValue: value,
    domains,
    description: 'Bounded retained cohort fixture.',
    classification: 'derived',
    source: 'bulk_relationship_analysis',
    sourceVersion: 1,
    observedAt: COHORT_NOW,
    retainedAt: COHORT_NOW,
    complete: true,
    truncated: false,
    limitations: [type === 'favicon' ? 'L'.repeat(240) : 'Retained relationship evidence is a review pivot, not an attribution conclusion.'],
  };
}

function cohortStorage(profileName = 'P'.repeat(100)) {
  const cases = [
    caseRecord({
      id: 'cohort-alpha', domain: 'cohort-alpha.invalid', brandProfileIds: [COHORT_PROFILE_ID],
      evidenceHistory: [snapshot({ id: 'cohort-alpha-evidence', registrar: 'Example Registrar, Inc.', createdDate: '2026-08-01T00:00:00Z' })],
      assertions: [{ id: 'cohort-assertion', kind: 'hypothesis', statement: 'S'.repeat(400), rationale: null, evidencePinIds: [], evidenceRelations: [], state: 'open', createdAt: COHORT_NOW, updatedAt: COHORT_NOW }],
    }),
    caseRecord({
      id: 'cohort-beta', domain: 'cohort-beta.invalid', brandProfileIds: [COHORT_PROFILE_ID],
      evidenceHistory: [snapshot({ id: 'cohort-beta-evidence', registrar: 'example registrar inc', createdDate: '2026-08-08T00:00:00Z' })],
    }),
    caseRecord({
      id: 'cohort-gamma', domain: 'cohort-gamma.invalid', brandProfileIds: [COHORT_PROFILE_ID],
      evidenceHistory: [snapshot({ id: 'cohort-gamma-evidence', registrar: 'Other Registrar', createdDate: '2026-08-20T00:00:00Z' })],
    }),
    caseRecord({ id: 'cohort-ungrouped', domain: 'cohort-ungrouped.invalid', brandProfileIds: [COHORT_PROFILE_ID] }),
    caseRecord({ id: 'cohort-outside', domain: 'cohort-outside.invalid', brandProfileIds: [COHORT_OTHER_PROFILE_ID] }),
  ];
  const commonAddress = COMMON_INFRASTRUCTURE_SNAPSHOT.sources
    .flatMap((source) => source.values)
    .find((value) => /^\d/u.test(value))
    ?.split('/')[0];
  expect(commonAddress).toBeTruthy();
  const faviconValue = [
    'cohort-beta.invalid=dhash:0000000000000000',
    'cohort-gamma.invalid=dhash:0000000000000001',
  ].join('|');
  return {
    [ACTIVE_PROFILE_KEY]: COHORT_PROFILE_ID,
    'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases },
    'whois-rdap-brand-profiles-v1': currentBrandProfileBrowserStore([
      cohortProfile(COHORT_PROFILE_ID, profileName),
      cohortProfile(COHORT_OTHER_PROFILE_ID, 'Other exact scope'),
    ]),
    'whoisleuth-campaigns-v1': currentBrowserLocalDocument('campaigns', { campaigns: [{
      id: 'cohort-campaign', name: 'Retained cohort review', description: '',
      domains: cases.map((record) => record.domain), createdAt: COHORT_NOW, updatedAt: COHORT_NOW,
    }] }),
    'whoisleuth-relationship-observations-v1': currentBrowserLocalDocument('relationship_observations', {
      observations: [
        retainedRelationship('certificate', 'a'.repeat(64), ['cohort-alpha.invalid', 'cohort-beta.invalid', 'cohort-outside.invalid']),
        retainedRelationship('favicon', faviconValue, ['cohort-beta.invalid', 'cohort-gamma.invalid']),
        retainedRelationship('ip_address', commonAddress!, ['cohort-alpha.invalid', 'cohort-gamma.invalid']),
      ],
    }),
  };
}


test.describe('browser-local campaigns', () => {
  async function openCampaigns(
    page: import('@playwright/test').Page,
    records: ReturnType<typeof caseRecord>[] = [],
  ) {
    await page.goto('/monitor');
    await migrateLegacyBrowserData(page, {
      'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: records },
    });
    await page.getByRole('tab', { name: /Campaigns/ }).click();
  }

  test('creates a campaign, adds cases, persists details and opens a member', async ({ page }) => {
    await openCampaigns(page, [
      caseRecord({
        id: 'member-one',
        domain: 'member-one.invalid',
        evidencePins: [{
          id: 'pin-mail-route',
          field: 'dns.mx',
          category: 'dns',
          label: 'Mail route',
          value: 'mail.member-one.invalid',
          source: 'Lookup checkpoint',
          sourceSchema: { collection: 'lookup_result', schema: 'whoisleuth.lookup-evidence', version: LOOKUP_EVIDENCE_SCHEMA_VERSION },
          observedAt: '2026-06-01T00:00:00.000Z',
          completeness: 'complete',
          createdAt: '2026-06-01T00:00:00.000Z',
        }],
        evidenceHistory: [snapshot({
          hasPasswordField: true,
          hasMx: true,
          faviconMatch: true,
          httpSummaryVersion: 1,
          httpEvidenceStatus: 'success',
          httpResponseStatus: 302,
          httpCrossOriginRedirect: true,
        })],
      }),
      caseRecord({ id: 'member-two', domain: 'member-two.invalid' }),
    ]);

    await page.locator('#new-campaign').fill('Credential cluster');
    await page.getByRole('button', { name: 'Create campaign' }).click();
    await expect(page.getByRole('status')).toContainText('Created campaign');

    await page.locator('.campaign-edit textarea').fill('Domains grouped for analyst follow-up.');
    await page.getByRole('button', { name: 'Save details' }).click();
    await page.locator('.add-case select').selectOption('member-one.invalid');
    await page.getByRole('button', { name: 'Add case' }).click();
    await expect(page.locator('.members')).toContainText('member-one.invalid');
    const reviewSummary = page.getByRole('region', { name: 'Campaign review cues' });
    await expect(reviewSummary).toContainText('1/1 linked');
    await expect(reviewSummary).toContainText('1 unreviewed');
    await expect(reviewSummary.locator('article', { hasText: 'Password field observed' })).toContainText('1');
    await expect(reviewSummary.locator('article', { hasText: 'Official identity relationship' })).toContainText('1');
    await expect(reviewSummary.locator('article', { hasText: 'Redirect or transport review' })).toContainText('1');
    await expect(reviewSummary.locator('article', { hasText: 'Mail exchanger observed' })).toContainText('1');
    const sourceSequence = page.getByRole('region', { name: 'Retained source sequence' });
    await expect(sourceSequence).toContainText('Mail');
    await expect(sourceSequence).toContainText('member-one.invalid');
    await expect(sourceSequence).toContainText('1/1 observed');
    const mailCoverage = sourceSequence.locator('.coverage article[data-layer="mail"]');
    const mailEvent = sourceSequence.locator('.sequence li[data-layer="mail"]');
    await expect(mailCoverage).toBeVisible();
    await expect(mailEvent).toBeVisible();
    const mailColours = await mailCoverage.evaluate((coverageCard) => {
      const event = coverageCard.closest('.temporal-review')?.querySelector('.sequence li[data-layer="mail"]');
      const marker = event?.querySelector('.marker');
      return {
        coverage: getComputedStyle(coverageCard).borderLeftColor,
        marker: marker ? getComputedStyle(marker).backgroundColor : '',
      };
    });
    expect(mailColours.coverage).toBe(mailColours.marker);
    expect(mailColours.coverage).not.toBe('');

    await page.getByRole('tab', { name: /Cases/ }).click();
    await page.getByRole('tab', { name: /Campaigns/ }).click();
    await expect(page.locator('.campaign-head', { hasText: 'Credential cluster' })).toBeVisible();

    await page.reload();
    await page.getByRole('tab', { name: /Campaigns/ }).click();
    await page.locator('.campaign-head', { hasText: 'Credential cluster' }).click();
    await expect(page.locator('.campaign-edit textarea')).toHaveValue('Domains grouped for analyst follow-up.');
    await page.getByRole('button', { name: 'Open case' }).click();
    await expect(page.getByRole('tab', { name: /Cases/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.case-head', { hasText: 'member-one.invalid' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('reviews exact Brand-scoped cohorts without a request, write, or assertion-derived link', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard');
    await migrateLegacyBrowserData(page, cohortStorage(), {
      destination: '/monitor?view=campaigns&campaign=cohort-campaign',
    });
    const region = page.getByRole('region', { name: 'Brand campaign cohorts' });
    await expect(region).toBeVisible();
    await expect(region.locator('.metrics')).toHaveCount(0);
    await expect(region).toContainText('No selection is inferred from the active profile');

    const scope = region.getByLabel('Brand Profile scope');
    await expect(scope).toHaveValue('');
    const dataRequests: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'fetch' || request.resourceType() === 'xhr') {
        const url = new URL(request.url());
        dataRequests.push(`${request.method()} ${url.pathname}`);
      }
    });
    await page.evaluate(() => {
      const state = window as unknown as { __cohortWrites?: number; __cohortLocalStorageWrites?: number };
      state.__cohortWrites = 0;
      state.__cohortLocalStorageWrites = 0;
      const originalPut = IDBObjectStore.prototype.put;
      const originalAdd = IDBObjectStore.prototype.add;
      const originalDelete = IDBObjectStore.prototype.delete;
      const originalClear = IDBObjectStore.prototype.clear;
      const originalSetItem = Storage.prototype.setItem;
      const originalRemoveItem = Storage.prototype.removeItem;
      const originalStorageClear = Storage.prototype.clear;
      const countWrite = (storeName: string) => {
        if (storeName === 'manifests' || storeName === 'records') state.__cohortWrites = (state.__cohortWrites ?? 0) + 1;
      };
      IDBObjectStore.prototype.put = function put(value: unknown, key?: IDBValidKey) {
        countWrite(this.name);
        return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
      };
      IDBObjectStore.prototype.add = function add(value: unknown, key?: IDBValidKey) {
        countWrite(this.name);
        return key === undefined ? originalAdd.call(this, value) : originalAdd.call(this, value, key);
      };
      IDBObjectStore.prototype.delete = function deleteRecord(query: IDBValidKey | IDBKeyRange) {
        countWrite(this.name);
        return originalDelete.call(this, query);
      };
      IDBObjectStore.prototype.clear = function clear() {
        countWrite(this.name);
        return originalClear.call(this);
      };
      Storage.prototype.setItem = function setItem(key: string, value: string) {
        if (this === window.localStorage) state.__cohortLocalStorageWrites = (state.__cohortLocalStorageWrites ?? 0) + 1;
        return originalSetItem.call(this, key, value);
      };
      Storage.prototype.removeItem = function removeItem(key: string) {
        if (this === window.localStorage) state.__cohortLocalStorageWrites = (state.__cohortLocalStorageWrites ?? 0) + 1;
        return originalRemoveItem.call(this, key);
      };
      Storage.prototype.clear = function clear() {
        if (this === window.localStorage) state.__cohortLocalStorageWrites = (state.__cohortLocalStorageWrites ?? 0) + 1;
        return originalStorageClear.call(this);
      };
    });

    await scope.selectOption(COHORT_PROFILE_ID);
    await expect(region.locator('.metrics')).toContainText('4explicitly scoped cases');
    await expect(region.locator('.metrics')).toContainText('1connected cohorts');
    await expect(region.locator('.metrics')).toContainText('1without visible retained cohort rationale');
    await expect(region.locator('.legend')).toContainText('Exact link');
    await expect(region.locator('.legend')).toContainText('Bounded similarity');
    await expect(region.locator('.legend')).toContainText('Temporal co-occurrence');
    await expect(region.locator('.legend')).toContainText('Common infrastructure');

    const cohort = region.locator('details.cohort').first();
    await cohort.locator('summary').click();
    await expect(cohort).toContainText('cohort-alpha.invalid');
    await expect(cohort).toContainText('cohort-beta.invalid');
    await expect(cohort).toContainText('cohort-gamma.invalid');
    await expect(cohort).not.toContainText('cohort-outside.invalid');
    await expect(cohort).toContainText('Same registrar with creation publications linked within 7 days');
    await expect(cohort).toContainText('unknown');
    await expect(region).toContainText('1 scoped case without retained cohort rationale');

    const assertionPanel = region.getByText(/Analyst assertions · not used for cohort membership/u);
    await assertionPanel.click();
    await expect(region).toContainText('S'.repeat(400));
    expect(dataRequests).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __cohortWrites?: number }).__cohortWrites)).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __cohortLocalStorageWrites?: number }).__cohortLocalStorageWrites)).toBe(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), ACTIVE_PROFILE_KEY)).toBe(COHORT_PROFILE_ID);

    await page.setViewportSize({ width: 320, height: 720 });
    await expectNoHorizontalOverflow(page);
    const openCase = cohort.getByRole('button', { name: /Open case cohort-alpha\.invalid/u });
    await openCase.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: /Cases/ })).toHaveAttribute('aria-selected', 'true');
    const openedCase = page.locator('.case-head', { hasText: 'cohort-alpha.invalid' });
    await expect(openedCase).toHaveAttribute('aria-expanded', 'true');
    await expect(openedCase).toBeFocused();
  });

  test('keeps unreadable Brand Profile details explicit while exact Case identifiers remain usable', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto('/dashboard');
    await migrateLegacyBrowserData(page, cohortStorage('Unavailable profile fixture'), { destination: '/bulk' });
    await expect(page.locator('#console-navigation')).toBeVisible();
    await failBrowserLocalCollectionReads(page, 'brand_profiles');
    const monitor = page.locator('#console-navigation').getByRole('link', { name: /^Monitor/u });
    await monitor.evaluate((link) => link.setAttribute('href', '/monitor?view=campaigns&campaign=cohort-campaign'));
    await monitor.click();
    const region = page.getByRole('region', { name: 'Brand campaign cohorts' });
    await expect(region.getByRole('alert')).toContainText('Brand Profile details could not be read');
    await expect(region.locator('.metrics')).toHaveCount(0);
    const scope = region.getByLabel('Brand Profile scope');
    await expect(scope).toContainText(`Profile details unavailable ${COHORT_PROFILE_ID}`);
    await scope.selectOption(COHORT_PROFILE_ID);
    await expect(region).toContainText('partial');
    await expect(region.locator('.metrics')).toContainText('4explicitly scoped cases');
    await page.setViewportSize({ width: 320, height: 720 });
    await expectNoHorizontalOverflow(page);
  });

  test('does not present relationship-dependent zeroes when retained relationships are unreadable', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto('/dashboard');
    await migrateLegacyBrowserData(page, cohortStorage(), { destination: '/bulk' });
    await expect(page.locator('#console-navigation')).toBeVisible();
    await failBrowserLocalCollectionReads(page, 'relationship_observations');
    const monitor = page.locator('#console-navigation').getByRole('link', { name: /^Monitor/u });
    await monitor.evaluate((link) => link.setAttribute('href', '/monitor?view=campaigns&campaign=cohort-campaign'));
    await monitor.click();
    const region = page.getByRole('region', { name: 'Brand campaign cohorts' });
    await region.getByLabel('Brand Profile scope').selectOption(COHORT_PROFILE_ID);
    await expect(region.getByRole('alert')).toContainText('Retained relationship observations could not be read');
    await expect(region.locator('.metrics')).toContainText('connected cohort count incomplete');
    await expect(region.locator('.metrics')).toContainText('ungrouped count incomplete');
    await expect(region.locator('.metrics')).not.toContainText('0connected cohorts');
    await expect(region.locator('details.cohort')).toHaveCount(1);
    await expect(region).toContainText('without a visible rationale in currently readable evidence · count incomplete');
  });

  test('shows and focuses a saved campaign when the tab opens before browser-local loading finishes', async ({ page }) => {
    await page.goto('/dashboard');
    await migrateLegacyBrowserData(page, {
      'whoisleuth-campaigns-v1': currentBrowserLocalDocument('campaigns', { campaigns: [{
        id: 'delayed-campaign',
        name: 'Delayed campaign',
        description: '',
        domains: [],
        createdAt: '2026-08-07T00:00:00.000Z',
        updatedAt: '2026-08-07T00:00:00.000Z',
      }] }),
    });
    await holdBrowserLocalReads(page, 3_000);
    const monitorLink = page.getByRole('link', { name: /Monitor/ }).first();
    await monitorLink.evaluate((link) => {
      link.setAttribute('href', '/monitor?view=campaigns&campaign=delayed-campaign');
    });
    await monitorLink.click();
    await page.getByRole('tab', { name: /Campaigns/ }).click();

    const campaign = page.locator('.campaign-head', { hasText: 'Delayed campaign' });
    await expect(campaign).toBeVisible();
    await expect(campaign).toHaveAttribute('aria-expanded', 'true');
  });

  test('campaign export contains membership metadata but no case evidence or notes', async ({ page }) => {
    const cases = [caseRecord({
      id: 'sensitive-case',
      domain: 'export-member.invalid',
      notes: [{ createdAt: '2026-07-01T00:00:00.000Z', body: 'Do not copy this note.' }],
      evidenceHistory: [snapshot({ id: 'secret-evidence', pageTitle: 'Private evidence detail' })],
    })];
    await page.goto('/monitor');
    await migrateLegacyBrowserData(page, {
      'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases },
      'whoisleuth-campaigns-v1': currentBrowserLocalDocument('campaigns', { campaigns: [{
        id: 'portable-campaign', name: 'Portable group', description: 'Metadata only',
        domains: ['export-member.invalid'], createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
      }] }),
    });
    await page.getByRole('tab', { name: /Campaigns/ }).click();

    const downloadPromise = page.waitForEvent('download');
    await page.locator('.campaign-toolbar').getByRole('button', { name: 'Export JSON' }).click();
    const download = await downloadPromise;
    const body = await (await download.createReadStream()).toArray();
    const parsed = JSON.parse(Buffer.concat(body).toString('utf-8'));

    expect(download.suggestedFilename()).toMatch(/^whoisleuth-campaigns-.*\.json$/);
    expect(parsed.schema).toBe('whoisleuth.campaigns');
    expect(parsed.version).toBe(1);
    expect(parsed.campaigns[0].domains).toEqual(['export-member.invalid']);
    expect(JSON.stringify(parsed)).not.toContain('Do not copy this note');
    expect(JSON.stringify(parsed)).not.toContain('Private evidence detail');
  });

  test('imports campaigns and keeps unavailable case domains explicit', async ({ page }) => {
    await openCampaigns(page, [caseRecord({ id: 'present', domain: 'present.invalid' })]);
    const payload = { schema: 'whoisleuth.campaigns', version: 1, campaigns: [{
      id: 'imported-campaign', name: 'Imported group', description: '',
      domains: ['present.invalid', 'missing.invalid'],
      createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
    }] };
    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('.campaign-toolbar label', { hasText: 'Import JSON' }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: 'campaigns.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });

    await expect(page.getByRole('status')).toContainText('Imported 1 new');
    await page.locator('.campaign-head', { hasText: 'Imported group' }).click();
    await expect(page.locator('.members')).toContainText('present.invalid');
    await expect(page.locator('.members')).toContainText('missing.invalid');
    await expect(page.locator('.members')).toContainText('Case unavailable in this browser');
  });

  test('campaign management remains usable without horizontal overflow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await openCampaigns(page, [caseRecord({ id: 'mobile-member', domain: 'long-mobile-campaign-member.invalid' })]);
    await page.locator('#new-campaign').fill('A long investigation campaign name that must wrap safely on a narrow viewport');
    await page.getByRole('button', { name: 'Create campaign' }).click();
    await page.locator('.add-case select').selectOption('long-mobile-campaign-member.invalid');
    await page.getByRole('button', { name: 'Add case' }).click();
    await expect(page.getByRole('region', { name: 'Retained source sequence' })).toContainText('No source-qualified pins or sightings');
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('accessible cross-case relationship table', () => {
  async function openRelationshipTable(
    page: import('@playwright/test').Page,
    records: ReturnType<typeof caseRecord>[],
  ) {
    await page.goto('/monitor');
    await migrateLegacyBrowserData(page, {
      'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: records },
    });
    await readBrowserLocalCollection(page, 'cases', {
      minimumRecords: records.length,
      timeout: 10_000,
    });
    await expect(page.getByRole('tab', { name: new RegExp(`Cases ${records.length}`) })).toBeVisible();
    await page.getByRole('tab', { name: /Relationships/ }).click();
  }

  test('filters semantic relationship rows and opens a member case', async ({ page }) => {
    const http = {
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'success',
      httpFinalOrigin: 'https://shared-destination.invalid',
      httpResponseStatus: 200,
    };
    await openRelationshipTable(page, [
      caseRecord({ id: 'ns-a', domain: 'alpha-table.invalid', evidenceHistory: [snapshot({ nameservers: ['ns.shared-table.invalid'] })] }),
      caseRecord({ id: 'ns-b', domain: 'bravo-table.invalid', evidenceHistory: [snapshot({ nameservers: ['ns.shared-table.invalid'] })] }),
      caseRecord({ id: 'http-a', domain: 'charlie-table.invalid', evidenceHistory: [snapshot(http)] }),
      caseRecord({ id: 'http-b', domain: 'delta-table.invalid', evidenceHistory: [snapshot(http)] }),
    ]);

    await expect(page.getByRole('tab', { name: /Relationships 2/ })).toHaveAttribute('aria-selected', 'true');
    const table = page.getByRole('table', { name: 'Cross-case relationships from retained browser-local investigation evidence' });
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader')).toHaveCount(4);
    await expect(table.getByRole('row')).toHaveCount(3);
    await expect(page.getByRole('group', { name: 'Relationship workspace filters' })).toHaveCount(1);
    await expect(page.getByRole('group', { name: 'Relationship table view controls' }).getByRole('combobox')).toHaveCount(1);
    await expect(page.locator('.matching-count')).toHaveCount(1);

    const tableControls = page.getByRole('group', { name: 'Relationship table view controls' });
    await tableControls.getByLabel('Search').fill('bravo-table.invalid');
    await expect(page.locator('.result-count')).toHaveAttribute('role', 'status');
    await expect(page.locator('.result-count')).toHaveAttribute('aria-live', 'polite');
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(table).toContainText('Shared nameserver set');
    await tableControls.getByRole('button', { name: 'Clear table view' }).click();
    await page.getByRole('group', { name: 'Relationship workspace filters' }).getByLabel('Relationship').selectOption('http_final_origin');
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(table).toContainText('Shared final website origin');

    await page.getByRole('button', { name: 'Open charlie-table.invalid' }).click();
    await expect(page.getByRole('tab', { name: /Cases/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.case-head', { hasText: 'charlie-table.invalid' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('keeps successful relationship context visible when campaigns cannot load', async ({ page }) => {
    await page.goto('/monitor');
    await migrateLegacyBrowserData(page, {
      'whois-rdap-cases-v1': {
        version: CASE_SCHEMA_VERSION,
        cases: [
          caseRecord({ id: 'partial-a', domain: 'partial-a.invalid', evidenceHistory: [snapshot({ nameservers: ['ns.partial.invalid'] })] }),
          caseRecord({ id: 'partial-b', domain: 'partial-b.invalid', evidenceHistory: [snapshot({ nameservers: ['ns.partial.invalid'] })] }),
        ],
      },
    });
    await expect(page.getByRole('tab', { name: /Cases 2/ })).toBeVisible();
    await failBrowserLocalCollectionReads(page, 'campaigns');
    const navigation = page.locator('#console-navigation');
    await navigation.getByRole('link', { name: /^Dashboard/u }).click();
    await navigation.getByRole('link', { name: /^Monitor/u }).click();
    await page.getByRole('tab', { name: /Relationships/ }).click();

    await expect(page.locator('.local-context-status')).toContainText('campaigns');
    await expect(page.locator('.local-context-status')).toContainText('Successfully loaded collections remain available');
    const table = page.getByRole('table', { name: 'Cross-case relationships from retained browser-local investigation evidence' });
    await expect(table).toContainText('Shared nameserver set');
    await expect(table).toContainText('partial-a.invalid');
    await expect(table).toContainText('partial-b.invalid');
  });

  test('paginates every retained relationship and resets the page when filtering', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    const records = Array.from({ length: 52 }, (_, index) => {
      const suffix = String(index).padStart(2, '0');
      const nameserver = `ns-${suffix}.pagination.invalid`;
      return [
        caseRecord({ id: `page-a-${suffix}`, domain: `page-a-${suffix}.invalid`, evidenceHistory: [snapshot({ nameservers: [nameserver] })] }),
        caseRecord({ id: `page-b-${suffix}`, domain: `page-b-${suffix}.invalid`, evidenceHistory: [snapshot({ nameservers: [nameserver] })] }),
      ];
    }).flat();
    await openRelationshipTable(page, records);

    const table = page.getByRole('table', { name: 'Cross-case relationships from retained browser-local investigation evidence' });
    const pagination = page.getByRole('navigation', { name: 'Case relationship pages' });
    await expect(table.getByRole('row')).toHaveCount(51);
    await expect(pagination).toContainText('Page 1 of 2');
    await expect(pagination.getByRole('button', { name: 'Previous' })).toHaveAttribute('aria-disabled', 'true');

    const nextPage = pagination.getByRole('button', { name: 'Next' });
    await nextPage.click();
    await expect(nextPage).toBeFocused();
    await expect(table.getByRole('row')).toHaveCount(3);
    await expect(pagination).toContainText('Page 2 of 2');
    await expect(nextPage).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('.result-count')).toContainText('Showing 51–52 of 52 matching relationships');
    await expect(page.locator('.relationship-workspace')).not.toContainText('Partial result');
    await expectNoHorizontalOverflow(page);

    await page.getByRole('group', { name: 'Relationship workspace filters' }).getByLabel('Relationship').selectOption('nameserver_set');
    await expect(pagination).toContainText('Page 1 of 2');
    await expect(page.locator('.result-count')).toContainText('Showing 1–50 of 52 matching relationships');

    const tableControls = page.getByRole('group', { name: 'Relationship table view controls' });
    const search = tableControls.getByLabel('Search');
    await search.fill('ns-00.pagination.invalid');
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(table).toContainText('ns-00.pagination.invalid');
    await expect(page.getByRole('navigation', { name: 'Case relationship pages' })).toHaveCount(0);
    await expect(page.locator('.result-count')).toContainText('Showing 1–1 of 1 matching relationship');

    const graphRegion = page.getByRole('region', { name: 'Relationship graph' });
    const graph = graphRegion.locator('.graph-scroll > svg');
    const privateSelection = graph.getByRole('button', { name: 'Shared nameserver set: ns-01.pagination.invalid', exact: true });
    await privateSelection.focus();
    await page.keyboard.press('Space');
    await expect(privateSelection).toHaveAttribute('aria-pressed', 'true');
    await expect(search).toHaveValue('ns-00.pagination.invalid');
    await expect(table).toContainText('ns-00.pagination.invalid');
    await expect(table).not.toContainText('ns-01.pagination.invalid');

    await tableControls.getByRole('button', { name: 'Clear table view' }).click();
    await tableControls.getByLabel('Sort').selectOption('value');
    await tableControls.getByRole('button', { name: 'Ascending, switch to descending' }).click();
    await expect(pagination).toContainText('Page 2 of 2');
    const selectedRow = table.getByRole('row', { name: /ns-01\.pagination\.invalid/u });
    const inspectSelected = selectedRow.getByRole('button', { name: /Inspect relationship Shared nameserver set: ns-01\.pagination\.invalid/u });
    await expect(inspectSelected).toHaveAttribute('aria-pressed', 'true');
    await expect(selectedRow).toContainText('Selected in relationship workspace');

    const selectedCase = graph.getByRole('button', { name: 'Case page-a-01.invalid', exact: true });
    await selectedCase.focus();
    await page.keyboard.press('Enter');
    await expect(inspectSelected).toHaveAttribute('aria-pressed', 'false');
    await expect(selectedRow).not.toContainText('Selected in relationship workspace');

    await inspectSelected.click();
    await expect(privateSelection).toHaveAttribute('aria-pressed', 'true');
    await graphRegion.getByRole('group', { name: 'Relationship graph view controls' }).getByRole('button', { name: 'Hide selected' }).click();
    await expect(graph.getByRole('button', { name: 'Shared nameserver set: ns-01.pagination.invalid', exact: true })).toHaveCount(0);
    await expect(inspectSelected).toHaveAttribute('aria-pressed', 'false');
    await inspectSelected.click();
    await expect(graph.getByRole('button', { name: 'Shared nameserver set: ns-01.pagination.invalid', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expectNoHorizontalOverflow(page);
  });

  test('reserves one bounded graph slot for a relationship inspected from the table', async ({ page }) => {
    const records = Array.from({ length: 13 }, (_, index) => {
      const suffix = String(index).padStart(2, '0');
      const nameserver = `ns-${suffix}.reservation.invalid`;
      return [
        caseRecord({ id: `reserve-a-${suffix}`, domain: `reserve-a-${suffix}.invalid`, evidenceHistory: [snapshot({ nameservers: [nameserver] })] }),
        caseRecord({ id: `reserve-b-${suffix}`, domain: `reserve-b-${suffix}.invalid`, evidenceHistory: [snapshot({ nameservers: [nameserver] })] }),
      ];
    }).flat();
    await openRelationshipTable(page, records);

    const graphRegion = page.getByRole('region', { name: 'Relationship graph' });
    const graph = graphRegion.locator('.graph-scroll > svg');
    await expect(graph.getByRole('button', { name: 'Shared nameserver set: ns-12.reservation.invalid', exact: true })).toHaveCount(0);
    await expect(graphRegion).toContainText('Partial overview');
    await expect(page.locator('.matching-count')).toHaveCount(1);
    await expect(page.locator('.matching-count')).toContainText('13 of 13 matching relationships');

    const row = page.getByRole('table', { name: 'Cross-case relationships from retained browser-local investigation evidence' }).getByRole('row', { name: /ns-12\.reservation\.invalid/u });
    await row.getByRole('button', { name: /Inspect relationship Shared nameserver set: ns-12\.reservation\.invalid/u }).click();
    await expect(graph.getByRole('button', { name: 'Shared nameserver set: ns-12.reservation.invalid', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(graph.locator('.relationship-node')).toHaveCount(12);
    await expect(graphRegion).toContainText('Partial overview');
  });

  test('releases graph action capacity when retained relationships are deleted', async ({ page }) => {
    const observations = Array.from({ length: 9 }, (_, index) => ({
      id: `relationship-stale-${index}`,
      type: 'ip_address',
      label: 'Shared IP address',
      method: 'Exact normalised address',
      normalizedValue: `192.0.2.${index + 1}`,
      displayValue: `192.0.2.${index + 1}`,
      domains: ['stale-a.invalid', 'stale-b.invalid'],
      description: 'Bounded relationship fixture.',
      classification: 'derived',
      source: 'bulk_relationship_analysis',
      sourceVersion: 1,
      observedAt: '2026-07-14T00:00:00.000Z',
      retainedAt: '2026-07-14T00:00:00.000Z',
      complete: true,
      truncated: false,
      limitations: ['Shared infrastructure is not proof of common control.'],
    }));
    await page.goto('/monitor');
    await migrateLegacyBrowserData(page, {
      'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: [
        caseRecord({ id: 'stale-a', domain: 'stale-a.invalid' }),
        caseRecord({ id: 'stale-b', domain: 'stale-b.invalid' }),
      ] },
      'whoisleuth-relationship-observations-v1': currentBrowserLocalDocument('relationship_observations', {
        observations,
      }),
    });
    await page.getByRole('tab', { name: /Relationships/ }).click();

    const graphRegion = page.getByRole('region', { name: 'Relationship graph' });
    const graph = graphRegion.locator('.graph-scroll > svg');
    const viewControls = graphRegion.getByRole('group', { name: 'Relationship graph view controls' });
    for (let index = 1; index <= 8; index += 1) {
      await graph.getByRole('button', { name: `Shared IP address: 192.0.2.${index}`, exact: true }).click();
      await viewControls.getByRole('button', { name: 'Pin selected' }).click();
    }
    await expect(viewControls).toContainText('8 pinned');

    const retained = page.locator('.retained-observations li', { hasText: '192.0.2.1' });
    page.once('dialog', (dialog) => dialog.accept());
    await retained.getByRole('button', { name: 'Delete retained observation' }).click();
    await expect(viewControls).toContainText('7 pinned');

    await graph.getByRole('button', { name: 'Shared IP address: 192.0.2.9', exact: true }).click();
    await expect(viewControls.getByRole('button', { name: 'Pin selected' })).toBeEnabled();
    await viewControls.getByRole('button', { name: 'Pin selected' }).click();
    await expect(viewControls).toContainText('8 pinned');
  });

  test('inspects evidence-backed graph nodes with keyboard case pivots', async ({ page }) => {
    const http = {
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'success',
      httpFinalOrigin: 'https://shared-graph.invalid',
      httpResponseStatus: 200,
    };
    await openRelationshipTable(page, [
      caseRecord({ id: 'graph-a', domain: 'alpha-graph.invalid', evidenceHistory: [snapshot({ nameservers: ['ns.shared-graph.invalid'], ...http })] }),
      caseRecord({ id: 'graph-b', domain: 'bravo-graph.invalid', evidenceHistory: [snapshot({ nameservers: ['ns.shared-graph.invalid'], ...http })] }),
    ]);

    const graph = page.locator('.graph-scroll > svg');
    await expect(graph).toBeVisible();
    const nameserverNode = graph.getByRole('button', { name: 'Shared nameserver set: ns.shared-graph.invalid' });
    await expect(nameserverNode).toBeVisible();
    await expect(nameserverNode.locator('.graph-node-icon')).toHaveAttribute('data-icon', 'nameserver');
    const graphIcons = graph.locator('.graph-node-icon');
    await expect(graphIcons).toHaveCount(4);
    expect(await graphIcons.evaluateAll((icons) => icons.every((icon) => {
      const iconRect = icon.getBoundingClientRect();
      const discRect = icon.parentElement?.querySelector('.node-icon-disc')?.getBoundingClientRect();
      return Boolean(
        discRect
        && iconRect.width > 0
        && iconRect.width <= 14
        && iconRect.height > 0
        && iconRect.height <= 14
        && iconRect.left >= discRect.left - 1
        && iconRect.right <= discRect.right + 1
        && iconRect.top >= discRect.top - 1
        && iconRect.bottom <= discRect.bottom + 1
      );
    }))).toBe(true);

    const caseNode = graph.getByRole('button', { name: 'Case alpha-graph.invalid' });
    await caseNode.focus();
    await page.keyboard.press('Enter');
    const inspector = page.locator('.relationship-graph .inspector');
    await expect(inspector).toContainText('Selected case');
    await expect(inspector).toContainText('alpha-graph.invalid');
    await expect(inspector).toContainText('Shared nameserver set: ns.shared-graph.invalid');

    await page.getByRole('group', { name: 'Relationship workspace filters' }).getByLabel('Relationship').selectOption('http_final_origin');
    const originNode = graph.getByRole('button', { name: 'Shared final website origin: https://shared-graph.invalid' });
    await expect(originNode).toBeVisible();
    await expect(originNode.locator('.graph-node-icon')).toHaveAttribute('data-icon', 'origin');
    await expect(graph.getByRole('button', { name: 'Shared nameserver set: ns.shared-graph.invalid' })).toHaveCount(0);

    await inspector.getByRole('button', { name: 'Open case', exact: true }).click();
    await expect(page.getByRole('tab', { name: /Cases/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.case-head', { hasText: 'alpha-graph.invalid' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('focuses, pins, hides, resets, and compares bounded graph neighbours', async ({ page }) => {
    const http = {
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'success',
      httpFinalOrigin: 'https://shared-view.invalid',
      httpResponseStatus: 200,
    };
    await openRelationshipTable(page, [
      caseRecord({ id: 'view-a', domain: 'alpha-view.invalid', evidenceHistory: [snapshot({ nameservers: ['ns.shared-view.invalid'], ...http })] }),
      caseRecord({ id: 'view-b', domain: 'bravo-view.invalid', evidenceHistory: [snapshot({ nameservers: ['ns.shared-view.invalid'], ...http })] }),
      caseRecord({ id: 'view-c', domain: 'charlie-view.invalid', evidenceHistory: [snapshot({ nameservers: ['ns.shared-view.invalid'] })] }),
    ]);

    const region = page.getByRole('region', { name: 'Relationship graph' });
    const graph = region.locator('.graph-scroll > svg');
    const controls = region.getByRole('group', { name: 'Relationship graph view controls' });
    await graph.getByRole('button', { name: 'Case alpha-view.invalid', exact: true }).click();
    await controls.getByRole('button', { name: 'Focus one hop' }).click();
    await expect(controls.getByRole('button', { name: 'Show overview' })).toHaveAttribute('aria-pressed', 'true');
    await expect(graph.getByRole('button', { name: 'Case alpha-view.invalid', exact: true })).toBeVisible();
    await expect(graph.getByRole('button', { name: 'Case bravo-view.invalid', exact: true })).toHaveCount(0);
    await expect(graph.getByRole('button', { name: 'Case charlie-view.invalid', exact: true })).toHaveCount(0);
    await expect(graph.getByRole('button', { name: 'Shared nameserver set: ns.shared-view.invalid', exact: true })).toBeVisible();
    await expect(graph.getByRole('button', { name: 'Shared final website origin: https://shared-view.invalid', exact: true })).toBeVisible();

    await controls.getByRole('button', { name: 'Show overview' }).click();
    await graph.getByRole('button', { name: 'Shared nameserver set: ns.shared-view.invalid', exact: true }).click();
    await controls.getByRole('button', { name: 'Pin selected' }).click();
    await expect(controls).toContainText('1 pinned');
    const workspaceFilters = page.getByRole('group', { name: 'Relationship workspace filters' });
    await workspaceFilters.getByLabel('Relationship').selectOption('http_final_origin');
    await expect(controls).toContainText('0 pinned');
    await workspaceFilters.getByLabel('Relationship').selectOption('all');
    await expect(controls).toContainText('0 pinned');
    await graph.getByRole('button', { name: 'Shared final website origin: https://shared-view.invalid', exact: true }).click();
    await controls.getByRole('button', { name: 'Hide selected' }).click();
    await expect(graph.getByRole('button', { name: /Shared final website origin/ })).toHaveCount(0);
    await expect(page.getByRole('table', { name: 'Cross-case relationships from retained browser-local investigation evidence' })).toContainText('Shared final website origin');
    await controls.getByRole('button', { name: 'Reset view' }).click();
    await expect(graph.getByRole('button', { name: 'Shared final website origin: https://shared-view.invalid', exact: true })).toBeVisible();

    await graph.getByRole('button', { name: 'Case alpha-view.invalid', exact: true }).click();
    await region.getByRole('button', { name: 'Add to comparison group' }).click();
    await graph.getByRole('button', { name: 'Case bravo-view.invalid', exact: true }).click();
    await region.getByRole('button', { name: 'Add to comparison group' }).click();
    const comparison = region.getByRole('region', { name: 'Comparison group' });
    await expect(comparison).toContainText('alpha-view.invalid');
    await expect(comparison).toContainText('bravo-view.invalid');
    await expect(comparison.getByRole('button', { name: 'Shared nameserver set: ns.shared-view.invalid' })).toBeVisible();
    await expect(comparison.getByRole('button', { name: 'Shared final website origin: https://shared-view.invalid' })).toBeVisible();

    await graph.getByRole('button', { name: 'Case charlie-view.invalid', exact: true }).click();
    await region.getByRole('button', { name: 'Add to comparison group' }).click();
    await expect(comparison.getByRole('button', { name: 'Shared nameserver set: ns.shared-view.invalid' })).toBeVisible();
    await expect(comparison.getByRole('button', { name: 'Shared final website origin: https://shared-view.invalid' })).toHaveCount(0);
  });

  test('downloads the same filtered graph as JSON, GraphML, and GEXF without transient view state', async ({ page }) => {
    const http = {
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'success',
      httpFinalOrigin: 'https://shared-export.invalid',
      httpResponseStatus: 200,
    };
    await openRelationshipTable(page, [
      caseRecord({ id: 'export-graph-a', domain: 'alpha-export-graph.invalid', evidenceHistory: [snapshot({ nameservers: ['ns.shared-export.invalid'], ...http })] }),
      caseRecord({ id: 'export-graph-b', domain: 'bravo-export-graph.invalid', evidenceHistory: [snapshot({ nameservers: ['ns.shared-export.invalid'], ...http })] }),
    ]);

    const region = page.getByRole('region', { name: 'Relationship graph' });
    const visual = region.locator('.graph-scroll > svg');
    await visual.getByRole('button', { name: 'Shared final website origin: https://shared-export.invalid', exact: true }).click();
    await region.getByRole('group', { name: 'Relationship graph view controls' }).getByRole('button', { name: 'Hide selected' }).click();
    await expect(visual.getByRole('button', { name: /Shared final website origin/ })).toHaveCount(0);

    const controls = region.getByRole('group', { name: 'Relationship graph export controls' });
    const select = controls.getByLabel('Graph export format');
    const download = async (format: 'json' | 'graphml' | 'gexf') => {
      await select.selectOption(format);
      const pending = page.waitForEvent('download');
      await controls.getByRole('button', { name: 'Export filtered graph' }).click();
      const result = await pending;
      const body = await (await result.createReadStream()).toArray();
      return { result, content: Buffer.concat(body).toString('utf-8') };
    };

    const json = await download('json');
    expect(json.result.suggestedFilename()).toMatch(/^whoisleuth-relationship-graph-\d{4}-\d{2}-\d{2}\.json$/);
    const document = JSON.parse(json.content);
    expect(document.schema).toBe('whoisleuth.relationship-graph');
    expect(document.version).toBe(3);
    expect(document.graph.nodes).toHaveLength(4);
    expect(document.graph.edges).toHaveLength(4);
    expect(JSON.stringify(document)).not.toContain('hiddenIds');
    expect(JSON.stringify(document)).not.toContain('pinnedIds');
    expect(JSON.stringify(document)).not.toContain('groupCaseIds');

    for (const format of ['graphml', 'gexf'] as const) {
      const xml = await download(format);
      expect(xml.result.suggestedFilename()).toMatch(new RegExp(`^whoisleuth-relationship-graph-\\d{4}-\\d{2}-\\d{2}\\.${format}$`));
      const parsed = await page.evaluate((content) => {
        const document = new DOMParser().parseFromString(content, 'application/xml');
        return {
          errors: document.getElementsByTagName('parsererror').length,
          nodes: document.getElementsByTagNameNS('*', 'node').length,
          edges: document.getElementsByTagNameNS('*', 'edge').length,
        };
      }, xml.content);
      expect(parsed).toEqual({ errors: 0, nodes: 4, edges: 4 });
    }
    await expect(controls.getByRole('status')).toContainText('Downloaded 4 nodes and 4 edges');
  });

  test('shows a clear empty state when no retained evidence relates cases', async ({ page }) => {
    await openRelationshipTable(page, [
      caseRecord({ id: 'single-a', domain: 'single-a.invalid', evidenceHistory: [snapshot({ nameservers: ['ns.one.invalid'] })] }),
      caseRecord({ id: 'single-b', domain: 'single-b.invalid', evidenceHistory: [snapshot({ nameservers: ['ns.two.invalid'] })] }),
    ]);
    await expect(page.getByRole('heading', { name: 'No cross-case relationships yet' })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('filters retained relationship history and exposes provenance and campaign context', async ({ page }) => {
    const history = (prefix: string, source: string, capturedAt: string, riskScore: number) => snapshot({
      id: `${prefix}-${source}`,
      fingerprint: `${prefix}-${source}-${riskScore}`,
      source,
      capturedAt,
      firstCapturedAt: capturedAt,
      riskScore,
      nameservers: ['ns.provenance.invalid'],
    });
    const cases = [
      caseRecord({ id: 'prov-a', domain: 'provenance-a.invalid', updatedAt: '2026-07-18T00:00:00.000Z', evidenceHistory: [history('a', 'import', '2026-07-01T00:00:00.000Z', 10), history('a', 'lookup', '2026-07-18T00:00:00.000Z', 20)] }),
      caseRecord({ id: 'prov-b', domain: 'provenance-b.invalid', updatedAt: '2026-07-18T00:00:00.000Z', evidenceHistory: [history('b', 'monitor', '2026-07-02T00:00:00.000Z', 11), history('b', 'lookup', '2026-07-18T00:00:00.000Z', 21)] }),
    ];
    await page.goto('/monitor');
    await migrateLegacyBrowserData(page, {
      'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases },
      'whoisleuth-campaigns-v1': currentBrowserLocalDocument('campaigns', { campaigns: [{
        id: 'provenance-campaign', name: 'Provenance review', description: '',
        domains: ['provenance-a.invalid', 'provenance-b.invalid'],
        createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z',
      }] }),
    });
    await page.getByRole('tab', { name: /Relationships/ }).click();

    const workspaceControls = page.getByRole('group', { name: 'Relationship workspace filters' });
    await workspaceControls.getByLabel('Source').selectOption('import');
    await workspaceControls.getByLabel('Completeness').selectOption('unknown');
    await workspaceControls.getByLabel('Case or campaign').selectOption('campaign:provenance-campaign');
    await expect(page.locator('.matching-count')).toContainText('1 of 1 matching relationship');
    await page.getByRole('region', { name: 'Relationship graph' }).locator('.graph-scroll > svg').getByRole('button', { name: 'Shared nameserver set: ns.provenance.invalid' }).click();
    const inspector = page.locator('.relationship-graph .inspector');
    await expect(inspector).toContainText('Import, Lookup, Monitor');
    await expect(inspector).toContainText('Provenance review');
    await inspector.getByText(/Source observations/).click();
    await expect(inspector).toContainText('Cases · Deep');

    await workspaceControls.getByLabel('Source').selectOption('monitor');
    const table = page.getByRole('table', { name: 'Cross-case relationships from retained browser-local investigation evidence' });
    await expect(table).toContainText('Provenance review');
    await expect(table).toContainText('Import, Lookup, Monitor');
  });

  test('sorts relationship rows by case count in both directions', async ({ page }) => {
    await openRelationshipTable(page, [
      caseRecord({ id: 'large-a', domain: 'large-a.invalid', evidenceHistory: [snapshot({ nameservers: ['ns.large.invalid'] })] }),
      caseRecord({ id: 'large-b', domain: 'large-b.invalid', evidenceHistory: [snapshot({ nameservers: ['ns.large.invalid'] })] }),
      caseRecord({ id: 'large-c', domain: 'large-c.invalid', evidenceHistory: [snapshot({ nameservers: ['ns.large.invalid'] })] }),
      caseRecord({ id: 'small-a', domain: 'small-a.invalid', evidenceHistory: [snapshot({ nameservers: ['ns.small.invalid'] })] }),
      caseRecord({ id: 'small-b', domain: 'small-b.invalid', evidenceHistory: [snapshot({ nameservers: ['ns.small.invalid'] })] }),
    ]);
    await page.getByRole('group', { name: 'Relationship table view controls' }).getByLabel('Sort').selectOption('member_count');
    const rows = page.getByRole('table').getByRole('row');
    const direction = page.getByRole('button', { name: 'Ascending, switch to descending' });
    await expect(direction).toHaveText('Ascending');
    await expect(rows.nth(1)).toContainText('2 cases');
    await direction.click();
    await expect(page.getByRole('button', { name: 'Descending, switch to ascending' })).toHaveText('Descending');
    await expect(rows.nth(1)).toContainText('3 cases');
  });

  test('reviews connected evidence clusters without changing source relationships', async ({ page }) => {
    await openRelationshipTable(page, [
      caseRecord({ id: 'cluster-a', domain: 'cluster-a.invalid', evidenceHistory: [snapshot({ nameservers: ['ns.cluster-a.invalid'] })] }),
      caseRecord({ id: 'cluster-b', domain: 'cluster-b.invalid', evidenceHistory: [snapshot({ nameservers: ['ns.cluster-a.invalid'] })] }),
      caseRecord({ id: 'cluster-c', domain: 'cluster-c.invalid', evidenceHistory: [snapshot({ nameservers: ['ns.cluster-b.invalid'] })] }),
      caseRecord({ id: 'cluster-d', domain: 'cluster-d.invalid', evidenceHistory: [snapshot({ nameservers: ['ns.cluster-b.invalid'] })] }),
    ]);

    const workspace = page.getByRole('region', { name: 'Evidence clusters' });
    await expect(workspace).toBeVisible();
    await expect(workspace.locator('article')).toHaveCount(2);
    const label = workspace.getByLabel('Analyst label').first();
    await label.fill('Related review set');
    await label.press('Tab');
    await page.getByRole('region', { name: 'Undo analyst change' }).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(label).toHaveValue('');
    await label.fill('Related review set');
    await label.press('Tab');
    await workspace.getByLabel('Select cluster').nth(0).check();
    await workspace.getByLabel('Select cluster').nth(1).check();
    await workspace.getByRole('button', { name: 'Merge selected' }).click();
    await expect(workspace.locator('article')).toHaveCount(1);
    await expect(workspace).toContainText('4');
    await workspace.getByRole('button', { name: 'Split cluster-a.invalid from this review cluster' }).click();
    await expect(workspace.locator('.cases')).not.toContainText('cluster-a.invalid');
    await expect(page.getByRole('table', { name: 'Cross-case relationships from retained browser-local investigation evidence' })).toContainText('cluster-a.invalid');
    await workspace.getByRole('button', { name: 'Reset' }).click();
    await expect(workspace.locator('article')).toHaveCount(2);
  });

  test('keeps long observed values readable beside long case pivots on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openRelationshipTable(page, Array.from({ length: 23 }, (_, index) => caseRecord({
      id: `desktop-rel-${index}`,
      domain: `long-desktop-relationship-member-${String(index).padStart(2, '0')}-with-extra-context.invalid`,
      evidenceHistory: [snapshot({ nameservers: ['an-unusually-long-shared-nameserver-value.invalid'] })],
    })));
    const box = await page.locator('tbody td[data-label="Observed value"]').first().boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(180);
  });

  test('relationship filters and rows remain usable without mobile overflow', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 700 });
    await openRelationshipTable(page, [
      caseRecord({ id: 'mobile-rel-a', domain: 'long-mobile-relationship-member-a.invalid', evidenceHistory: [snapshot({ nameservers: ['an-extremely-long-shared-nameserver-value.invalid'] })] }),
      caseRecord({ id: 'mobile-rel-b', domain: 'long-mobile-relationship-member-b.invalid', evidenceHistory: [snapshot({ nameservers: ['an-extremely-long-shared-nameserver-value.invalid'] })] }),
    ]);
    await expect(page.getByRole('table', { name: 'Cross-case relationships from retained browser-local investigation evidence' })).toBeVisible();
    const graph = page.getByRole('region', { name: 'Relationship graph' });
    await graph.locator('.graph-scroll > svg').getByRole('button', { name: 'Case long-mobile-relationship-member-a.invalid', exact: true }).click();
    await graph.getByRole('button', { name: 'Add to comparison group' }).click();
    await expect(graph.getByRole('region', { name: 'Comparison group' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 320, height: 700 });
    await expectNoHorizontalOverflow(page);
  });
});
