import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, failBrowserLocalManifestWrites, migrateLegacyBrowserData, readBrowserLocalCollection, requiredValue } from './helpers';

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
    retiredDkimSelectors: [],
    mailProtectionProfile: 'standard',
    protectionAttestations: [],
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
    applicable: true,
    state: 'registered',
    confidence: 'high',
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
  const persisted = requiredValue(
    (await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 })).records[0],
    'The saved brand-profile fixture is missing.',
  ).value;
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
  const pageBaseline = requiredValue(persisted.pageBaseline, 'The saved page baseline is missing.');
  expect(pageBaseline.resourceHosts.values).toEqual(['cdn.example.net']);
  expect(pageBaseline.trackingIdentifiers.values).toEqual([{ type: 'google-analytics', value: 'G-ABC123' }]);
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

  const persisted = requiredValue(
    (await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 })).records[0],
    'The saved brand-profile fixture is missing.',
  ).value;
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
      body: JSON.stringify(captureCount === 1 ? availabilityFixture() : {
        applicable: true,
        domain: 'example.com',
        state: 'registered',
        confidence: 'high',
        pageIdentity: null,
      }),
    });
  });
  await cleanBrandStorage(page);
  await openProfileForm(page);
  await page.getByRole('button', { name: 'Capture official-site baseline' }).click();
  await page.getByRole('button', { name: 'Update official-site baseline' }).click();
  await expect(page.getByRole('status')).toHaveText(/existing baseline is unchanged/i);
  await expect(page.getByText('Official account centre', { exact: true })).toBeVisible();
});

test('a malformed successful capture cannot populate or persist identity evidence', async ({ page }) => {
  await page.route('**/api/availability?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ faviconHash: 'a'.repeat(64) }),
  }));
  await cleanBrandStorage(page);
  await openProfileForm(page);

  await page.getByRole('button', { name: 'Capture official-site baseline' }).click();
  await expect(page.getByRole('status')).toHaveText('Official-site capture returned an invalid response.');
  await expect(page.getByLabel('Official favicon hash')).toHaveValue('');
  await page.getByRole('button', { name: 'Save profile' }).click();

  const persisted = requiredValue(
    (await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 })).records[0],
    'The saved brand-profile fixture is missing.',
  ).value;
  expect(persisted.officialFaviconHash).toBe('');
  expect(persisted.pageBaseline).toBeNull();
});

test('a malformed successful posture report renders as an explicit audit error', async ({ page }) => {
  await page.route('**/api/domain-posture?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ summary: 'complete', checks: [] }),
  }));
  await cleanBrandStorage(page);
  await openProfileForm(page);
  await page.getByRole('button', { name: 'Save profile' }).click();

  await page.getByRole('button', { name: 'Audit official domains' }).click();
  await expect(page.getByRole('status')).toHaveText('Audited 0/1 official domain.');
  await expect(page.getByText('Official-domain audit returned an invalid response.', { exact: true })).toBeVisible();
});

test('defensive mail settings, retired selectors, and expiring analyst attestations persist locally', async ({ page }) => {
  await cleanBrandStorage(page);
  await openProfileForm(page);
  await page.getByLabel('Mail posture profile').selectOption('defensive_no_mail');
  await page.getByLabel('Active DKIM selectors').fill('active');
  await page.getByLabel('Retired DKIM selectors').fill('retired, active');
  await page.getByRole('button', { name: 'Save profile' }).click();

  const registrarMfa = page.getByRole('group', { name: 'Registrar MFA' });
  await registrarMfa.getByLabel('Review state').selectOption('observed');
  await registrarMfa.getByLabel('Review expiry').fill('2026-10-01');
  await registrarMfa.getByLabel('Bounded note').fill('Reviewed with the domain owner.');
  await page.getByRole('button', { name: 'Save attestations' }).click();
  await expect(page.getByRole('status')).toContainText('Saved reviewed protection attestations');

  const persisted = requiredValue(
    (await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 })).records[0],
    'The saved brand-profile fixture is missing.',
  ).value;
  expect(persisted.mailProtectionProfile).toBe('defensive_no_mail');
  expect(persisted.dkimSelectors).toEqual(['active']);
  expect(persisted.retiredDkimSelectors).toEqual(['retired']);
  expect(persisted.protectionAttestations).toContainEqual(expect.objectContaining({
    control: 'registrar_mfa',
    state: 'observed',
    expiresAt: '2026-10-01T23:59:59.999Z',
    note: 'Reviewed with the domain owner.',
  }));
});

test('valid posture results disclose bounded SPF and external-dependency evidence', async ({ page }) => {
  await page.route('**/api/domain-posture?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      domain: 'example.com',
      checkedAt: ISO,
      dkimSelectors: [],
      retiredDkimSelectors: [],
      mailProtectionProfile: 'standard',
      summary: { pass: 1, warning: 0, danger: 0, info: 0 },
      checks: [{
        id: 'spf',
        label: 'SPF',
        status: 'pass',
        summary: 'Restrictive fail-all policy',
        detail: '',
        records: ['v=spf1 -all'],
        remediation: '',
      }],
      spfExpansion: {
        version: 1,
        state: 'complete',
        lookupLimit: 10,
        lookupsUsed: 1,
        voidLookupLimit: 2,
        voidLookups: 0,
        maxDepth: 5,
        dnsLookupTerms: 0,
        branches: [{
          domain: 'example.com',
          parent: null,
          relation: 'root',
          depth: 0,
          state: 'success',
          terminalPolicy: 'fail',
          dnsLookupTerms: 0,
          issues: [],
        }],
        issues: [],
      },
      dmarcAuthorizations: [],
      externalDependencies: [{
        kind: 'nameserver',
        target: 'ns1.example.net',
        source: 'DNS NS',
        scope: 'external',
        state: 'observed',
        limitation: 'A shared or external dependency is an operational review lead, not evidence of common ownership, insecurity, exploitability, or availability.',
      }],
    }),
  }));
  await cleanBrandStorage(page);
  await openProfileForm(page);
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.getByRole('button', { name: 'Audit official domains' }).click();

  await expect(page.getByRole('status')).toHaveText('Audited 1/1 official domain.');
  await expect(page.getByText('SPF expansion', { exact: true })).toBeVisible();
  await page.getByText('External dependency review', { exact: true }).click();
  await expect(page.getByText('ns1.example.net', { exact: true })).toBeVisible();
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

test('retained certificate events replay reviewed expectations without mobile overflow', async ({ page }) => {
  await page.goto('/brands');
  const profile = {
    ...profileFixture(),
    officialDomains: ['stored.example'],
    desiredPostureBaselines: [{
      domain: 'stored.example',
      tlsIssuer: 'Fixture issuer',
      tlsSanPatterns: ['stored.example'],
      updatedAt: ISO,
    }],
  };
  await migrateLegacyBrowserData(page, {
    [PROFILES_KEY]: [profile],
    [ACTIVE_KEY]: 'profile-1',
    'whois-rdap-cases-v1': {
      version: 11,
      cases: [{
        id: 'case-certificate-event',
        domain: 'stored.example',
        status: 'reviewing',
        disposition: 'unreviewed',
        source: 'import',
        evidencePins: [{
          id: 'pin-certificate-event',
          label: 'External certificate finding',
          value: SHA_A,
          field: 'certificateSha256',
          category: 'certificate',
          source: 'Deployment observation: Fixture feed',
          sourceSchema: { collection: 'external_observations', schema: 'whoisleuth.certificate-observation-rows', version: 1 },
          observedAt: ISO,
          completeness: 'complete',
          certificateObservation: {
            eventId: SHA_B,
            logId: 'fixture-log',
            certificateSha256: SHA_A,
            issuer: 'Fixture issuer',
            notAfter: '2026-12-01T00:00:00.000Z',
            dnsNameCount: 1,
            namesComplete: true,
          },
          limitations: [],
          createdAt: ISO,
        }],
        createdAt: ISO,
        updatedAt: ISO,
      }],
    },
  });

  const replay = page.getByRole('region', { name: 'Certificate expectation replay' });
  await expect(replay).toContainText('1 retained event');
  await expect(replay).toContainText('Aligned');
  await replay.getByText(/Certificate …/u).click();
  await expect(replay).toContainText('The retained event matches the reviewed expectation.');
  await expect(replay.getByRole('link', { name: 'stored.example' })).toHaveAttribute('href', /view=cases/);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test('exports and locally verifies a selective domain-control passport on desktop and mobile', async ({ page }) => {
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, {
    [PROFILES_KEY]: [{
      ...profileFixture(),
      desiredPostureBaselines: [{
        version: 1,
        domain: 'stored.example',
        nameservers: ['ns1.stored.example'],
        mx: ['10 mail.stored.example'],
        caa: ['0 issue "ca.example"'],
        tlsIssuer: 'Fixture issuer',
        tlsSanPatterns: ['*.stored.example'],
        recoveryDependency: 'must-not-export',
        note: 'must-not-export',
        lifecycle: 'change_planned',
        updatedAt: ISO,
      }],
    }],
    [ACTIVE_KEY]: 'profile-1',
  });

  const passport = page.getByRole('region', { name: 'Domain-control passport' });
  await expect(passport).toContainText('stored.example');
  const downloadPromise = page.waitForEvent('download');
  await passport.getByRole('button', { name: 'Export passport' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const content = await download.createReadStream().then(async (stream) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  });
  expect(content).toContain('whoisleuth.domain-control-manifest');
  expect(content).toContain('10 mail.stored.example');
  expect(content).not.toMatch(/must-not-export|Stored Brand|change_planned/iu);

  await passport.getByLabel('Review passport').setInputFiles(path!);
  await expect(passport).toContainText('Verified 1 passport entry');
  await expect(passport.getByRole('heading', { name: 'Import preview' })).toBeVisible();
  await expect(passport.getByText('Not configured; destination remains unchanged').first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
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
  const before = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  await failBrowserLocalManifestWrites(page, 'brand_profiles');

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Brand name').fill('Changed name');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status')).toContainText('out of storage space');
  const after = await readBrowserLocalCollection(page, 'brand_profiles');
  expect(after.records.map((entry) => entry.value)).toEqual(before.records.map((entry) => entry.value));
});
