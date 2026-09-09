import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { currentBrandProfileBrowserStore, expectNoHorizontalOverflow, failBrowserLocalManifestWrites, failNextBrowserLocalManifestWrite, holdBrowserLocalReads, holdBrowserLocalTransaction, migrateLegacyBrowserData, openBrandWorkbench, readBrowserLocalCollection, requiredValue, useTheme } from './helpers';
import {
  buildDomainControlManifest,
  DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
} from '../lib/domain-control-manifest.mts';
import { CASE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/case-model';
import { PUBLIC_BRAND_PROFILE_SCHEMA_VERSION } from '../packages/contracts/workspace-portability.mts';
import { extractHtmlSignals } from '../lib/html-signals.mts';
import { LEGACY_WEBSITE_SNAPSHOTS_KEY } from '../frontend/src/lib/browser-local-data-contract.ts';
import { brandPostureObservationContext, normalizeBrandProfile } from '../packages/workspace/brand-profile-model.mts';

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

function postureFixture(domain: string, checkedAt = ISO) {
  return {
    domain,
    checkedAt,
    dkimSelectors: [],
    retiredDkimSelectors: [],
    mailProtectionProfile: 'standard',
    summary: { pass: 1, warning: 0, danger: 0, info: 0 },
    checks: [{
      id: 'nameservers',
      label: 'Nameservers',
      status: 'pass',
      summary: 'Observed configured delegation',
      detail: '',
      records: [`ns1.${domain}`],
      remediation: '',
      sourceContext: { version: 1, source: 'dns_ns', observedAt: checkedAt, state: 'complete', omittedRecords: 0 },
    }],
    spfExpansion: {
      version: 1,
      state: 'complete',
      lookupLimit: 10,
      lookupsUsed: 0,
      voidLookupLimit: 2,
      voidLookups: 0,
      maxDepth: 5,
      dnsLookupTerms: 0,
      branches: [],
      issues: [],
    },
    dmarcAuthorizations: [],
    externalDependencies: [],
  };
}

async function cleanBrandStorage(page: import('@playwright/test').Page) {
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, {
    [PROFILES_KEY]: null,
    [ACTIVE_KEY]: null,
  });
}

async function openProfileForm(page: import('@playwright/test').Page, options?: 'Official-site identity' | 'Matching and mail settings' | 'Rights and official channels') {
  await page.getByRole('button', { name: 'New profile' }).click();
  await page.getByLabel('Brand name').fill('Example Brand');
  await page.getByLabel('Official domains').fill('example.com');
  if (options) await page.getByText(options, { exact: true }).click();
}

test('Brand Profile saving preserves a newer editable draft', async ({ page }) => {
  await cleanBrandStorage(page);
  await openProfileForm(page);
  const release = await holdBrowserLocalTransaction(page);
  try {
    await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
    await page.getByLabel('Brand name', { exact: true }).fill('Later unsaved brand');
  } finally { await release(); }
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('Saved "Example Brand"');
  await expect(page.getByLabel('Brand name', { exact: true })).toHaveValue('Later unsaved brand');
  const snapshot = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  expect(snapshot.records.map((item) => item.value.name)).toEqual(['Example Brand']);
});

test('expected-setting drafts follow the selected profile even for a shared domain', async ({ page }) => {
  const profiles = ['a', 'b'].map((suffix) => ({
    ...profileFixture(), id: `profile-${suffix}`, name: `Profile ${suffix}`,
    desiredPostureBaselines: [{ domain: 'stored.example', nameservers: [`ns-${suffix}.example`], updatedAt: ISO }],
  }));
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, {
    [PROFILES_KEY]: currentBrandProfileBrowserStore(profiles), [ACTIVE_KEY]: 'profile-a',
  });
  await openBrandWorkbench(page, 'baselines');
  const baseline = page.locator('#desired-posture-baseline');
  await expect(baseline.getByLabel('Nameservers', { exact: true })).toHaveValue('ns-a.example');
  await baseline.getByLabel('Nameservers', { exact: true }).fill('unsaved-a.example');
  await page.getByRole('radio', { name: 'Set Profile b active', exact: true }).check();
  await expect(baseline.getByLabel('Nameservers', { exact: true })).toHaveValue('ns-b.example');
  await baseline.getByRole('button', { name: 'Save expected settings', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('Saved expected domain settings');
  const snapshot = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 2 });
  expect(snapshot.records.find((item) => item.id === 'profile-a')?.value.desiredPostureBaselines[0]?.nameservers).toEqual(['ns-a.example']);
  expect(snapshot.records.find((item) => item.id === 'profile-b')?.value.desiredPostureBaselines[0]?.nameservers).toEqual(['ns-b.example']);
});

test('a rejected profile write keeps optional drafts for a deliberate retry and returns focus after success', async ({ page }) => {
  await cleanBrandStorage(page);
  await openProfileForm(page, 'Matching and mail settings');
  await page.getByLabel('Product names', { exact: true }).fill('Retained product draft');
  await page.getByText('Matching and mail settings', { exact: true }).click();
  await page.getByText('Rights and official channels', { exact: true }).click();
  await page.getByLabel('Trademark owner', { exact: true }).fill('Reserved rights holder');
  await page.getByText('Rights and official channels', { exact: true }).click();
  await failNextBrowserLocalManifestWrite(page, 'brand_profiles');
  const save = page.getByRole('button', { name: 'Save profile', exact: true });
  await save.click();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('out of storage space');
  await expect(save).toBeFocused();
  await expect(page.getByLabel('Brand name', { exact: true })).toHaveValue('Example Brand');
  await page.getByText('Matching and mail settings', { exact: true }).click();
  await expect(page.getByLabel('Product names', { exact: true })).toHaveValue('Retained product draft');
  await page.getByText('Rights and official channels', { exact: true }).click();
  await expect(page.getByLabel('Trademark owner', { exact: true })).toHaveValue('Reserved rights holder');
  expect((await readBrowserLocalCollection(page, 'brand_profiles')).records).toHaveLength(0);
  await save.click();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('Saved "Example Brand"');
  const snapshot = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  expect(snapshot.records).toHaveLength(1);
  expect(snapshot.records[0]?.value).toMatchObject({ productNames: ['Retained product draft'], trademarkOwner: 'Reserved rights holder' });
  await expect(page.getByRole('button', { name: /^Edit Example Brand/u })).toBeFocused();
});

test('passport export preserves an intentional empty selection and exports only reselected domains', async ({ page }) => {
  const profile = {
    ...profileFixture(), officialDomains: ['stored.example', 'second.example'],
    desiredPostureBaselines: ['stored.example', 'second.example'].map((domain) => ({ domain, nameservers: ['ns.example'], updatedAt: ISO })),
  };
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, {
    [PROFILES_KEY]: currentBrandProfileBrowserStore([profile]), [ACTIVE_KEY]: profile.id,
  });
  await openBrandWorkbench(page, 'passport');
  const passport = page.getByRole('region', { name: 'Portable domain settings' });
  const first = passport.getByRole('checkbox', { name: 'stored.example', exact: true });
  const second = passport.getByRole('checkbox', { name: 'second.example', exact: true });
  await expect(first).toBeChecked();
  await expect(second).toBeChecked();
  await first.uncheck();
  await second.uncheck();
  await expect(first).not.toBeChecked();
  await expect(second).not.toBeChecked();
  await expect(passport.getByRole('button', { name: 'Export passport', exact: true })).toBeDisabled();
  await second.check();
  const downloaded = page.waitForEvent('download');
  await passport.getByRole('button', { name: 'Export passport', exact: true }).click();
  const file = await downloaded;
  const manifest = JSON.parse(await readFile(requiredValue(await file.path(), 'Passport download is missing.'), 'utf8'));
  expect(manifest.entries.map((entry: { domain: string }) => entry.domain)).toEqual(['second.example']);
  await expect(first).not.toBeChecked();
  await expect(second).toBeChecked();
});

test('rapid repeated Brand Profile save persists only one record', async ({ page }) => {
  await cleanBrandStorage(page);
  await openProfileForm(page);
  await page.getByRole('button', { name: 'Save profile' }).evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('Saved "Example Brand"');
  const snapshot = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  expect(snapshot.records).toHaveLength(1);
});

test('official channels and rights references remain editable and browser-local', async ({ page }) => {
  await cleanBrandStorage(page);
  await openProfileForm(page, 'Rights and official channels');
  await page.getByRole('button', { name: 'Add channel' }).click();
  await page.getByLabel('Official channel 1 platform').selectOption('instagram');
  await page.getByLabel('Official channel 1 exact public URL').fill('https://social.example/example/');
  await page.getByLabel('Official channel 1 public handle').fill('@example');
  await page.getByLabel('Official channel 1 last reviewed').fill('2026-09-01');
  await page.getByRole('button', { name: 'Add reference' }).click();
  await page.getByLabel('Rights reference 1 owner').fill('Example Rights Holder');
  await page.getByLabel('Rights reference 1 identifier').fill('TM-123');
  await page.getByLabel('Rights reference 1 jurisdiction').fill('AU');
  await page.getByLabel('Rights reference 1 official reference URL').fill('https://register.example/record/123');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('Saved "Example Brand"');

  const snapshot = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  const stored = requiredValue(snapshot.records[0], 'The saved Brand Profile is missing.').value;
  expect(stored.officialChannels).toEqual([expect.objectContaining({ platform: 'instagram', url: 'https://social.example/example/', handle: '@example' })]);
  expect(stored.rightsReferences).toEqual([expect.objectContaining({ kind: 'trademark', owner: 'Example Rights Holder', identifier: 'TM-123', jurisdiction: 'AU' })]);

  await page.reload();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByText('Rights and official channels', { exact: true }).click();
  await expect(page.getByLabel('Official channel 1 exact public URL')).toHaveValue('https://social.example/example/');
  await expect(page.getByLabel('Rights reference 1 identifier')).toHaveValue('TM-123');
});

test('the active Brand Profile has a separate maintainable allowlist', async ({ page }) => {
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, {
    [PROFILES_KEY]: currentBrandProfileBrowserStore([profileFixture()]),
    [ACTIVE_KEY]: 'profile-1',
  });
  const before = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  const allowlist = page.getByRole('region', { name: 'Allowlist' });
  await expect(allowlist).toBeVisible();
  await allowlist.getByLabel('Add domains').fill('reviewed.example\nstored.example');
  await allowlist.getByRole('button', { name: 'Add', exact: true }).first().click();
  await expect(allowlist.getByText('reviewed.example', { exact: true })).toBeVisible();
  await expect(allowlist.locator('li', { hasText: 'stored.example' })).toHaveCount(0);
  await allowlist.getByLabel('Add registrar names').fill('Example Registrar');
  await allowlist.getByRole('button', { name: 'Add', exact: true }).nth(1).click();
  await expect(allowlist.getByText('Example Registrar', { exact: true })).toBeVisible();
  await expect(allowlist).toContainText('Unsaved allowlist changes');
  await allowlist.getByRole('button', { name: 'Save allowlist' }).click();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('Saved the allowlist');

  const after = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1, minimumRevision: before.manifest.revision + 1 });
  const persisted = requiredValue(after.records[0], 'The saved Brand Profile is missing.').value;
  expect(persisted.allowlistedDomains).toEqual(['reviewed.example']);
  expect(persisted.allowlistedRegistrars).toEqual(['Example Registrar']);

  await page.reload();
  await expect(page.getByRole('region', { name: 'Allowlist' }).getByText('reviewed.example', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Allowlisted domains')).toHaveCount(0);
  await expect(page.getByLabel('Allowlisted registrars')).toHaveCount(0);

  const openEditorAllowlist = page.getByRole('region', { name: 'Allowlist' });
  await openEditorAllowlist.getByLabel('Add domains').fill('later-review.example');
  await openEditorAllowlist.getByRole('button', { name: 'Add', exact: true }).first().click();
  await openEditorAllowlist.getByRole('button', { name: 'Save allowlist' }).click();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('Saved the allowlist');
  await page.getByLabel('Brand name').fill('Renamed Example Brand');
  await page.getByRole('button', { name: 'Save profile' }).click();

  const afterEditorSave = await readBrowserLocalCollection(page, 'brand_profiles', {
    minimumRecords: 1,
    minimumRevision: after.manifest.revision + 2,
  });
  const edited = requiredValue(afterEditorSave.records[0], 'The edited Brand Profile is missing.').value;
  expect(edited.name).toBe('Renamed Example Brand');
  expect(edited.allowlistedDomains).toEqual(['reviewed.example', 'later-review.example']);
  expect(edited.allowlistedRegistrars).toEqual(['Example Registrar']);
  await expectNoHorizontalOverflow(page);
});

test('captures and persists only a bounded official-site baseline after profile save', async ({ page }) => {
  await page.route('**/api/availability?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(availabilityFixture()),
  }));
  await cleanBrandStorage(page);
  await openProfileForm(page, 'Official-site identity');

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

test('public HTML baselines migrate unchanged and a deliberate recapture adopts native fingerprints', async ({ page }) => {
  const archive = JSON.parse(await readFile('test/fixtures/workspace-html-baseline-v8-public.json', 'utf8'));
  const publishedBaseline = archive.sections.brandProfiles.profiles[0].pageBaseline;
  const publishedIdentity = archive.sections.websiteSnapshots.snapshots[0].identity;
  const domain = 'baseline.example';
  const html = `<main><h1>Current account centre</h1>${'<div>Account information</div>'.repeat(4_000)}<form><input type=password></form></main>`;
  const signals = extractHtmlSignals(html, domain, { observedAt: ISO });
  const fingerprints = requiredValue(signals.pageIdentity, 'The recaptured page identity is missing.').fingerprints;
  expect(fingerprints.normalizedHtml.tokenCount).toBeGreaterThan(4_096);
  expect(fingerprints.domStructure.nodeCount).toBeGreaterThan(4_096);
  expect(fingerprints.complete).toBe(true);
  let requests = 0;
  await page.route('**/api/availability?*', async (route) => {
    requests += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      applicable: true, state: 'registered', confidence: 'high', domain, ...signals,
      faviconHash: null, faviconPHash: null, http: { finalUrl: `https://${domain}/` },
    }) });
  });
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, {
    [PROFILES_KEY]: { version: archive.sections.brandProfiles.version, profiles: archive.sections.brandProfiles.profiles },
    [ACTIVE_KEY]: 'baseline-profile',
    [LEGACY_WEBSITE_SNAPSHOTS_KEY]: archive.sections.websiteSnapshots,
  }, { clearStorage: true });
  const migrated = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  expect(migrated.records[0]?.value.pageBaseline).toEqual(publishedBaseline);
  const website = await readBrowserLocalCollection(page, 'website_snapshots', { minimumRecords: 1 });
  expect(website.records[0]?.value.identity).toEqual(publishedIdentity);
  expect(website.records[0]?.value.profileProvenance.pageFingerprint).toEqual({ version: 1, state: 'known' });
  expect(requests).toBe(0);
  await page.getByRole('button', { name: 'Edit Example account (baseline-profile)', exact: true }).click();
  await page.getByText('Official-site identity', { exact: true }).click();
  await page.getByRole('button', { name: 'Update official-site baseline' }).click();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('Captured a complete page baseline');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('Saved');
  await page.reload();
  const current = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  expect(current.records[0]?.value.pageBaseline).toMatchObject({
    fingerprintVersion: 2,
    normalizedHtml: { tokenCount: fingerprints.normalizedHtml.tokenCount, truncated: false },
    domStructure: { parser: 'html-tree-v2', nodeCount: fingerprints.domStructure.nodeCount, truncated: false },
  });
  expect((await readBrowserLocalCollection(page, 'website_snapshots', { minimumRecords: 1 })).records[0]?.value.identity).toEqual(publishedIdentity);
  expect(requests).toBe(1);
});

test('a baseline is discarded when it no longer belongs to an official domain', async ({ page }) => {
  await page.route('**/api/availability?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(availabilityFixture()),
  }));
  await cleanBrandStorage(page);
  await openProfileForm(page, 'Official-site identity');
  await page.getByRole('button', { name: 'Capture official-site baseline' }).click();
  await page.getByLabel('Official domains').fill('different.example');
  await page.getByRole('button', { name: 'Save profile' }).click();

  const persisted = requiredValue(
    (await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 })).records[0],
    'The saved brand-profile fixture is missing.',
  ).value;
  expect(persisted.officialDomains).toEqual(['different.example']);
  expect(persisted.pageBaseline).toBeNull();
  expect(persisted.officialFaviconHash).toBe('');
  expect(persisted.officialFaviconPHash).toBe('');
});

test('a late capture cannot bind one official domain identity to another', async ({ page }) => {
  let releaseCapture = () => {};
  let completeCapture = () => {};
  const captureGate = new Promise<void>((resolve) => { releaseCapture = resolve; });
  const captureCompleted = new Promise<void>((resolve) => { completeCapture = resolve; });
  await page.route('**/api/availability?*', async (route) => {
    try {
      await captureGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(availabilityFixture()),
      }).catch(() => {});
    } finally {
      completeCapture();
    }
  });
  await cleanBrandStorage(page);
  await openProfileForm(page, 'Official-site identity');

  await page.getByRole('button', { name: 'Capture official-site baseline' }).click();
  await expect(page.getByRole('button', { name: 'Capturing…' })).toBeVisible();
  await page.getByLabel('Official domains').fill('different.example');
  await expect(page.getByRole('button', { name: 'Capture official-site baseline' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toHaveCount(0);
  releaseCapture();
  await captureCompleted;
  await expect(page.getByText('Not captured', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Official favicon hash')).toHaveValue('');
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save profile' }).click();

  const persisted = requiredValue(
    (await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 })).records[0],
    'The saved brand-profile fixture is missing.',
  ).value;
  expect(persisted.officialDomains).toEqual(['different.example']);
  expect(persisted.pageBaseline).toBeNull();
  expect(persisted.officialFaviconHash).toBe('');
  expect(persisted.officialFaviconPHash).toBe('');
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
        faviconHash: 'f'.repeat(64),
        faviconPHash: 'fedcba0987654321',
        pageIdentity: null,
      }),
    });
  });
  await cleanBrandStorage(page);
  await openProfileForm(page, 'Official-site identity');
  await page.getByRole('button', { name: 'Capture official-site baseline' }).click();
  await page.getByRole('button', { name: 'Update official-site baseline' }).click();
  await expect(page.getByRole('status')).toHaveText(/existing baseline is unchanged/i);
  await expect(page.getByText('Official account centre', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Official favicon hash')).toHaveValue('d'.repeat(64));
});

test('a malformed successful capture cannot populate or persist identity evidence', async ({ page }) => {
  await page.route('**/api/availability?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ faviconHash: 'a'.repeat(64) }),
  }));
  await cleanBrandStorage(page);
  await openProfileForm(page, 'Official-site identity');

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
  await openBrandWorkbench(page, 'posture');

  await page.getByRole('button', { name: 'Review official domains' }).click();
  await expect(page.getByRole('status')).toHaveText('Reviewed 0/1 official domain.');
  await expect(page.getByText('Official-domain review returned an invalid response.', { exact: true })).toBeVisible();
});

test('a profile switch invalidates an in-flight posture audit before it can publish stale results', async ({ page }) => {
  let releaseAudit = () => {};
  let markAuditStarted = () => {};
  let requestSettled = false;
  const auditGate = new Promise<void>((resolve) => { releaseAudit = resolve; });
  const auditStarted = new Promise<void>((resolve) => { markAuditStarted = resolve; });
  await page.route('**/api/domain-posture?*', async (route) => {
    markAuditStarted();
    await auditGate;
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ summary: 'complete', checks: [] }),
      });
    } catch {
      // Switching profiles aborts the browser request; the stale route may
      // therefore already be closed when the fixture releases it.
    } finally {
      requestSettled = true;
    }
  });
  const secondProfile = {
    ...profileFixture(),
    id: 'profile-2',
    name: 'Second stored brand',
    officialDomains: ['second.example'],
  };
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, {
    [PROFILES_KEY]: currentBrandProfileBrowserStore([profileFixture(), secondProfile]),
    [ACTIVE_KEY]: 'profile-1',
  }, { destination: '/brands' });
  await openBrandWorkbench(page, 'posture');

  await page.getByRole('button', { name: 'Review official domains' }).click();
  await auditStarted;
  await expect(page.getByRole('button', { name: 'Reviewing…' })).toBeDisabled();
  await page.getByRole('radio', { name: 'Set Second stored brand active' }).check();
  await expect(page.getByRole('radio', { name: 'Set Second stored brand active' })).toBeChecked();
  await expect(page.getByRole('status').filter({ hasText: 'Set "Second stored brand" active.' })).toBeVisible();

  releaseAudit();
  await expect.poll(() => requestSettled).toBe(true);
  await expect(page.getByText('Official-domain review returned an invalid response.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Reviewed 0/1 official domain.' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review official domains' })).toBeEnabled();
});

test('editing the active profile invalidates its in-flight posture audit before stale publication', async ({ page }) => {
  let releaseAudit = () => {};
  let markAuditStarted = () => {};
  let requestSettled = false;
  const auditGate = new Promise<void>((resolve) => { releaseAudit = resolve; });
  const auditStarted = new Promise<void>((resolve) => { markAuditStarted = resolve; });
  await page.route('**/api/domain-posture?*', async (route) => {
    markAuditStarted();
    await auditGate;
    try {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ summary: 'complete', checks: [] }) });
    } catch {
      // Saving the edited profile aborts the obsolete request.
    } finally {
      requestSettled = true;
    }
  });
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, {
    [PROFILES_KEY]: currentBrandProfileBrowserStore([profileFixture()]),
    [ACTIVE_KEY]: 'profile-1',
  }, { destination: '/brands' });
  await openBrandWorkbench(page, 'posture');

  await page.getByRole('button', { name: 'Review official domains' }).click();
  await auditStarted;
  await page.getByRole('button', { name: 'Edit Stored Brand (profile-1)' }).click();
  await page.getByLabel('Official domains').fill('changed.example');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('Saved "Stored Brand"');

  releaseAudit();
  await expect.poll(() => requestSettled).toBe(true);
  await expect(page.getByText('Official-domain review returned an invalid response.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review official domains' })).toBeEnabled();
});

test('creating a new active profile clears ownership of an older in-flight posture audit', async ({ page }) => {
  let releaseAudit = () => {};
  let markAuditStarted = () => {};
  let requestSettled = false;
  const auditGate = new Promise<void>((resolve) => { releaseAudit = resolve; });
  const auditStarted = new Promise<void>((resolve) => { markAuditStarted = resolve; });
  await page.route('**/api/domain-posture?*', async (route) => {
    markAuditStarted();
    await auditGate;
    try {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ summary: 'complete', checks: [] }) });
    } catch {
      // Creating the replacement profile aborts the obsolete request.
    } finally {
      requestSettled = true;
    }
  });
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, {
    [PROFILES_KEY]: currentBrandProfileBrowserStore([profileFixture()]),
    [ACTIVE_KEY]: 'profile-1',
  }, { destination: '/brands' });
  await openBrandWorkbench(page, 'posture');

  await page.getByRole('button', { name: 'Review official domains' }).click();
  await auditStarted;
  await page.getByRole('button', { name: 'New profile' }).click();
  await page.getByLabel('Brand name').fill('Replacement Brand');
  await page.getByLabel('Official domains').fill('replacement.example');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('Saved "Replacement Brand"');

  releaseAudit();
  await expect.poll(() => requestSettled).toBe(true);
  await expect(page.getByText('Official-domain review returned an invalid response.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review official domains' })).toBeEnabled();
});

test('defensive mail settings, retired selectors, and expiring reviewed controls persist locally', async ({ page }) => {
  await cleanBrandStorage(page);
  await openProfileForm(page, 'Matching and mail settings');
  await page.getByLabel('Mail posture profile').selectOption('defensive_no_mail');
  await page.getByLabel('Active DKIM selectors').fill('active');
  await page.getByLabel('Retired DKIM selectors').fill('retired, active');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await openBrandWorkbench(page, 'attestations');

  const registrarMfa = page.getByRole('group', { name: 'Registrar MFA' });
  await registrarMfa.getByLabel('Review state').selectOption('observed');
  await registrarMfa.getByLabel('Review expiry').fill('2026-10-01');
  await registrarMfa.getByLabel('Review note').fill('Reviewed with the domain owner.');
  await page.getByRole('button', { name: 'Save controls' }).click();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('Saved reviewed account controls');

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
  await openBrandWorkbench(page, 'posture');
  await page.getByRole('button', { name: 'Review official domains' }).click();

  await expect(page.getByRole('status')).toHaveText('Reviewed 1/1 official domain.');
  await expect(page.getByText('SPF expansion', { exact: true })).toBeVisible();
  await page.getByText('External dependency review', { exact: true }).click();
  await expect(page.getByText('ns1.example.net', { exact: true })).toBeVisible();
});

test('retains two completed posture observations sequentially without discarding either audit result', async ({ page }) => {
  await page.route('**/api/domain-posture?*', async (route) => {
    const domain = new URL(route.request().url()).searchParams.get('q') || 'first.example';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(postureFixture(domain)) });
  });
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, {
    [PROFILES_KEY]: currentBrandProfileBrowserStore([{
      ...profileFixture(),
      officialDomains: ['first.example', 'second.example'],
      desiredPostureBaselines: [
        { domain: 'first.example', nameservers: ['ns1.first.example'], updatedAt: ISO },
        { domain: 'second.example', nameservers: ['ns1.second.example'], updatedAt: ISO },
      ],
    }]),
    [ACTIVE_KEY]: 'profile-1',
  }, { destination: '/brands' });
  await openBrandWorkbench(page, 'posture');

  await page.getByRole('button', { name: 'Review official domains' }).click();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toHaveText('Reviewed 2/2 official domains.');
  const results = page.locator('.audit-results > article');
  await expect(results).toHaveCount(2);
  await results.filter({ hasText: 'first.example' }).getByRole('button', { name: 'Retain this observation' }).click();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('first.example');
  await expect(results).toHaveCount(2);
  await results.filter({ hasText: 'second.example' }).getByRole('button', { name: 'Retain this observation' }).click();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('second.example');
  await expect(results).toHaveCount(2);

  const persisted = requiredValue(
    (await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 })).records[0],
    'The saved brand-profile fixture is missing.',
  ).value;
  expect(persisted.desiredPostureBaselines).toEqual(expect.arrayContaining([
    expect.objectContaining({ domain: 'first.example', observationHistory: [expect.objectContaining({ observedAt: ISO })] }),
    expect.objectContaining({ domain: 'second.example', observationHistory: [expect.objectContaining({ observedAt: ISO })] }),
  ]));
});

test('keeps completed posture results visible when retaining an observation cannot be written', async ({ page }) => {
  await page.route('**/api/domain-posture?*', async (route) => {
    const domain = new URL(route.request().url()).searchParams.get('q') || 'first.example';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(postureFixture(domain)) });
  });
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, {
    [PROFILES_KEY]: currentBrandProfileBrowserStore([{
      ...profileFixture(),
      officialDomains: ['first.example', 'second.example'],
      desiredPostureBaselines: [
        { domain: 'first.example', nameservers: ['ns1.first.example'], updatedAt: ISO },
        { domain: 'second.example', nameservers: ['ns1.second.example'], updatedAt: ISO },
      ],
    }]),
    [ACTIVE_KEY]: 'profile-1',
  }, { destination: '/brands' });
  await openBrandWorkbench(page, 'posture');

  await page.getByRole('button', { name: 'Review official domains' }).click();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toHaveText('Reviewed 2/2 official domains.');
  const results = page.locator('.audit-results > article');
  await expect(results).toHaveCount(2);
  await failBrowserLocalManifestWrites(page, 'brand_profiles');
  await results.filter({ hasText: 'first.example' }).getByRole('button', { name: 'Retain this observation' }).click();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('out of storage space');
  await expect(results).toHaveCount(2);
  await expect(page.getByText(/Brand Profiles could not be read/u)).toHaveCount(0);
});

test('equal-time posture captures retain both source records and remain unknown in portfolio views', async ({ page }) => {
  let requestCount = 0;
  await page.route('**/api/domain-posture?*', async (route) => {
    const report = postureFixture('stored.example');
    report.checks[0]!.records = [`ns${++requestCount}.stored.example`];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(report) });
  });
  await migrateLegacyBrowserData(page, {
    [PROFILES_KEY]: currentBrandProfileBrowserStore([{ ...profileFixture(), desiredPostureBaselines: [{ domain: 'stored.example', nameservers: ['ns1.stored.example'], updatedAt: ISO }] }]),
    [ACTIVE_KEY]: 'profile-1',
  }, { destination: '/brands' });
  await openBrandWorkbench(page, 'posture');
  const status = page.getByRole('status', { name: 'Brand Profile action status' });
  for (let index = 0; index < 2; index += 1) {
    await page.getByRole('button', { name: 'Review official domains' }).click();
    await expect(status).toHaveText('Reviewed 1/1 official domain.');
    await page.getByRole('button', { name: 'Retain this observation' }).click();
    await expect(status).toContainText(`Saved the ${ISO} settings observation`);
  }
  const saved = requiredValue((await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 })).records[0], 'The saved profile is missing.').value;
  const baseline = requiredValue(saved.desiredPostureBaselines[0], 'The saved baseline is missing.');
  const history = requiredValue(baseline.observationHistory, 'The saved observation history is missing.');
  expect(baseline.previousObservation).toBeNull();
  expect(history).toHaveLength(2);
  expect(history.map((value) => value.checks[0]?.records[0]).sort()).toEqual(['ns1.stored.example', 'ns2.stored.example']);
  const first = requiredValue(history[0], 'The first retained observation is missing.');
  expect(first.context).toMatchObject({ version: 1, domain: 'stored.example', profileId: 'profile-1' });
  expect(requiredValue(first.checks[0], 'The retained check is missing.').sourceContext).toEqual({ version: 1, source: 'dns_ns', observedAt: ISO, state: 'complete', omittedRecords: 0 });
  await openBrandWorkbench(page, 'portfolio');
  const matrix = page.getByRole('region', { name: 'Owned-domain comparison' });
  await expect(matrix.locator('tbody tr')).toContainText('Unknown');
  const records = matrix.locator('[id="retained-posture-observation-stored.example"]');
  expect(await records.locator(':scope > summary').evaluate((element) => getComputedStyle(element).display)).toBe('list-item');
  await records.locator(':scope > summary').focus();
  await records.locator(':scope > summary').press('Enter');
  await expect(records).toContainText('Distinct observations share the latest capture time');
  await expect(records.locator('summary').filter({ hasText: /^Capture / })).toHaveCount(2);
  for (const summary of await records.locator('summary').filter({ hasText: /^Capture / }).all()) { await summary.focus(); await summary.press('Enter'); }
  await expect(records.locator('pre').filter({ hasText: /^ns1\.stored\.example$/ })).toBeVisible();
  await expect(records.locator('pre').filter({ hasText: /^ns2\.stored\.example$/ })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);
  expect(requestCount).toBe(2);
});

test('legacy posture records remain readable without claiming current alignment', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/domain-posture**', (route) => { requests += 1; return route.abort(); });
  await migrateLegacyBrowserData(page, {
    [PROFILES_KEY]: currentBrandProfileBrowserStore([{ ...profileFixture(), desiredPostureBaselines: [{
      domain: 'stored.example', nameservers: ['ns1.stored.example'], updatedAt: ISO,
      previousObservation: { observedAt: ISO, checks: [{ id: 'nameservers', status: 'pass', records: ['ns1.stored.example'] }] },
    }] }]), [ACTIVE_KEY]: 'profile-1',
  }, { destination: '/brands' });
  await openBrandWorkbench(page, 'portfolio');
  const matrix = page.getByRole('region', { name: 'Owned-domain comparison' });
  await expect(matrix.locator('tbody tr')).toContainText('Unknown');
  await expect(matrix.locator('tbody tr')).not.toContainText('Aligned');
  const retained = matrix.locator('[id="retained-posture-observation-stored.example"]');
  await retained.locator(':scope > summary').click();
  await retained.locator('summary').filter({ hasText: /^Capture / }).click();
  await expect(retained).toContainText('Target and collection context were not retained');
  await expect(retained.getByText('ns1.stored.example', { exact: true })).toBeVisible();
  expect(requests).toBe(0);
  await page.goto('/monitor?view=inbox');
  const inbox = page.getByRole('region', { name: 'Review inbox', exact: true });
  await expect(inbox).toContainText('observed at an unknown time');
  await inbox.getByText('Advanced filters', { exact: true }).click();
  await inbox.getByRole('combobox', { name: 'Age', exact: true }).selectOption('unknown');
  const item = inbox.locator('.items > li');
  await expect(item).toHaveCount(1);
  await item.locator('summary', { hasText: 'Review state:' }).click();
  await expect(item.getByRole('option', { name: 'Resolved', exact: true })).toHaveJSProperty('disabled', true);
  await page.setViewportSize({ width: 320, height: 700 });
  const filter = inbox.getByRole('combobox', { name: 'Age', exact: true });
  await expect(filter).toBeVisible();
  const widths = await inbox.locator('.detail-filters').evaluate((element) => {
    const controls = [...element.querySelectorAll('select')];
    return controls.map((control) => ({ width: control.getBoundingClientRect().width, parentWidth: element.clientWidth, height: control.getBoundingClientRect().height }));
  });
  expect(widths.length).toBeGreaterThan(0);
  for (const control of widths) { expect(control.width).toBeGreaterThan(control.parentWidth * 0.8); expect(control.height).toBeGreaterThanOrEqual(44); }
  for (const width of [320, 390, 1024, 1280, 1920, 2560, 3840]) {
    await page.setViewportSize({ width, height: 800 });
    const form = item.locator('.lifecycle-controls');
    await expect(form).toBeVisible();
    const geometry = await form.evaluate((element) => ({
      width: element.clientWidth, scrollWidth: element.scrollWidth,
      controls: [...element.querySelectorAll('input,select,textarea,button')].map((control) => ({
        width: control.getBoundingClientRect().width, height: control.getBoundingClientRect().height,
      })),
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
    expect(geometry.controls.length).toBe(5);
    for (const control of geometry.controls) {
      expect(control.width).toBeGreaterThanOrEqual(Math.min(200, geometry.width));
      if (width <= 640) expect(control.height).toBeGreaterThanOrEqual(44);
    }
    const cardBounds = requiredValue(await inbox.boundingBox(), 'Review inbox geometry is missing.');
    const itemBounds = requiredValue(await item.boundingBox(), 'Review Item geometry is missing.');
    expect(itemBounds.x + itemBounds.width).toBeLessThanOrEqual(cardBounds.x + cardBounds.width);
    await expectNoHorizontalOverflow(page);
  }
  expect(requests).toBe(0);
});

test('posture disclosures retain native markers and wrap every admitted source record', async ({ page }) => {
  const report = postureFixture('stored.example');
  const records = Array.from({ length: 64 }, (_, index) => `ns-${index}.${'d'.repeat(50)}.example.test`);
  report.checks[0]!.records = records;
  let requests = 0;
  await page.route('**/api/domain-posture?*', (route) => { requests += 1; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(report) }); });
  await migrateLegacyBrowserData(page, { [PROFILES_KEY]: currentBrandProfileBrowserStore([profileFixture()]), [ACTIVE_KEY]: 'profile-1' }, { destination: '/brands' });
  await openBrandWorkbench(page, 'posture');
  await page.getByRole('button', { name: 'Review official domains' }).click();
  const check = page.locator('.checks > details');
  await expect(check).toHaveCount(1);
  const summary = check.locator(':scope > summary');
  await summary.focus(); await summary.press('Enter');
  await expect(summary).toBeFocused();
  const source = check.locator('pre');
  await expect(source).toHaveText(records.join('\n'));
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      await expect(source).toBeVisible();
      const marker = await summary.evaluate((element) => ({ display: getComputedStyle(element).display, type: getComputedStyle(element).listStyleType }));
      expect(marker.display).toBe('list-item'); expect(marker.type).not.toBe('none');
      expect(await source.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await expectNoHorizontalOverflow(page);
    }
  }
  expect(requests).toBe(1);
});

test('official-site baseline controls fit a narrow mobile viewport without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await cleanBrandStorage(page);
  await openProfileForm(page, 'Official-site identity');
  const fieldset = page.locator('details.profile-options').filter({ has: page.getByText('Official-site identity', { exact: true }) });
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

test('cross-domain posture matrix links exact retained baselines and observations without collection', async ({ page }) => {
  await page.clock.setFixedTime(new Date(ISO));
  let postureRequests = 0;
  await page.route('**/api/domain-posture**', (route) => {
    postureRequests += 1;
    return route.abort();
  });
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, {
    [PROFILES_KEY]: currentBrandProfileBrowserStore([{
      ...profileFixture(),
      officialDomains: ['stored.example', 'unavailable.example', 'unset.example'],
      desiredPostureBaselines: [{
        domain: 'stored.example',
        nameservers: ['ns1.stored.example'],
        ds: ['12345 13 2 abcdef'],
        observationHistory: [{
          observedAt: '2026-07-12T00:00:00.000Z',
          context: brandPostureObservationContext(requiredValue(normalizeBrandProfile({ ...profileFixture(), officialDomains: ['stored.example', 'unavailable.example', 'unset.example'] }), 'The profile fixture is invalid.'), 'stored.example'),
          checks: [{ id: 'nameservers', status: 'pass', records: ['ns1.stored.example'], sourceContext: { version: 1, source: 'dns_ns', observedAt: '2026-07-12T00:00:00.000Z', state: 'complete', omittedRecords: 0 } }],
        }],
        updatedAt: ISO,
      }, {
        domain: 'unavailable.example',
        nameservers: ['ns1.unavailable.example'],
        updatedAt: ISO,
      }],
    }]),
    [ACTIVE_KEY]: 'profile-1',
  });
  await openBrandWorkbench(page, 'portfolio');

  const matrix = page.getByRole('region', { name: 'Owned-domain comparison' });
  await expect(matrix).toContainText('2/3 configured · 1 observed');
  const storedRow = matrix.locator('tbody tr', { hasText: 'stored.example' });
  await expect(storedRow).toContainText('Aligned');
  await expect(storedRow).toContainText('Unsupported');
  const unavailableRow = matrix.locator('tbody tr', { hasText: 'unavailable.example' });
  await expect(unavailableRow).toContainText('Unavailable');
  const unconfiguredRow = matrix.locator('tbody tr', { hasText: 'unset.example' });
  await expect(unconfiguredRow).toContainText('Not configured');
  await expect(storedRow.getByRole('link', { name: 'Observed' }).first()).toHaveAttribute('href', '#retained-posture-observation-stored.example');

  await storedRow.getByRole('link', { name: 'Expected' }).first().click();
  await expect(page).toHaveURL(/baseline=stored\.example#desired-posture-baseline/u);
  await expect(page.getByLabel('Official domain')).toHaveValue('stored.example');
  await openBrandWorkbench(page, 'portfolio');
  await expect(matrix.locator('[id="retained-posture-observation-stored.example"]')).toContainText('nameservers · pass');
  expect(postureRequests).toBe(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(matrix.locator('.mobile-rows')).toBeVisible();
  await expectNoHorizontalOverflow(page);
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
    [PROFILES_KEY]: currentBrandProfileBrowserStore([profile]),
    [ACTIVE_KEY]: 'profile-1',
    'whois-rdap-cases-v1': {
      version: CASE_SCHEMA_VERSION,
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
  await openBrandWorkbench(page, 'certificates');

  const replay = page.getByRole('region', { name: 'Certificate event review' });
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
    [PROFILES_KEY]: currentBrandProfileBrowserStore([{
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
    }]),
    [ACTIVE_KEY]: 'profile-1',
  });
  await openBrandWorkbench(page, 'passport');

  const passport = page.getByRole('region', { name: 'Portable domain settings' });
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

  const duplicateVersion = content.replace(/("version"\s*:\s*\d+)/u, '$1,$1');
  expect(duplicateVersion).not.toBe(content);
  await passport.getByLabel('Review passport').setInputFiles({
    name: 'duplicate-key-passport.json',
    mimeType: 'application/json',
    buffer: Buffer.from(duplicateVersion),
  });
  await expect(passport.getByRole('status')).toContainText('duplicate object key');

  await passport.getByLabel('Review passport').setInputFiles(path!);
  await expect(passport).toContainText('Verified 1 passport entry');
  await expect(passport.getByRole('heading', { name: 'Import preview' })).toBeVisible();
  await expect(passport.getByText('Not configured; destination remains unchanged').first()).toBeVisible();

  await failNextBrowserLocalManifestWrite(page, 'brand_profiles');
  await passport.getByRole('button', { name: 'Import selected fields' }).click();
  await expect(passport.getByRole('status')).toContainText(/storage|quota|write/iu);
  await expect(passport.getByRole('heading', { name: 'Import preview' })).toBeVisible();
  await passport.getByRole('button', { name: 'Import selected fields' }).click();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('Imported the selected domain-control passport fields');
  await expect(passport.getByRole('heading', { name: 'Import preview' })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test('owned-domain baseline feedback reflects the committed browser-local write', async ({ page }) => {
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, {
    [PROFILES_KEY]: currentBrandProfileBrowserStore([profileFixture()]),
    [ACTIVE_KEY]: 'profile-1',
  });
  await openBrandWorkbench(page, 'baselines');
  const baseline = page.locator('#desired-posture-baseline');
  const consumers = baseline.getByRole('complementary', { name: 'Where these expectations are reviewed' });
  await expect(consumers).toContainText('owned-domain posture matrix currently marks DS comparison unsupported');
  await expect(consumers).toContainText('certificate-policy review');
  await expect(consumers).toContainText('SAN patterns are not a posture-matrix column');
  await expect(consumers).toContainText('DNS change rehearsal');
  await baseline.getByRole('combobox', { name: 'Nameservers expectation', exact: true }).selectOption('expect_records');
  await baseline.getByRole('textbox', { name: 'Nameservers', exact: true }).fill('ns1.stored.example');
  await failNextBrowserLocalManifestWrite(page, 'brand_profiles');
  await baseline.getByRole('button', { name: 'Save expected settings' }).click();
  await expect(baseline.getByRole('status')).toContainText(/storage|quota|write/iu);
  await expect(baseline.getByRole('status')).not.toContainText('Saved expected domain settings');
  let stored = requiredValue(
    (await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 })).records[0],
    'The Brand Profile fixture is missing.',
  ).value;
  expect(stored.desiredPostureBaselines).toEqual([]);

  await holdBrowserLocalReads(page, 1_200, '#desired-posture-baseline button.primary');
  await expect(baseline.getByRole('textbox', { name: 'Nameservers', exact: true })).toBeDisabled();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('Saved expected domain settings.');
  await expect(baseline.getByRole('textbox', { name: 'Nameservers', exact: true })).toBeEnabled();
  await expect(baseline.getByRole('textbox', { name: 'Nameservers', exact: true })).toHaveValue('ns1.stored.example');
  stored = requiredValue(
    (await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 })).records[0],
    'The updated Brand Profile fixture is missing.',
  ).value;
  expect(stored.desiredPostureBaselines).toEqual([
    expect.objectContaining({ domain: 'stored.example', nameservers: ['ns1.stored.example'] }),
  ]);
});

test('preserves explicit record expectations, null MX and complete record sets through save and export', async ({ page }) => {
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, {
    [PROFILES_KEY]: currentBrandProfileBrowserStore([profileFixture()]),
    [ACTIVE_KEY]: 'profile-1',
  });
  await openBrandWorkbench(page, 'baselines');
  const baseline = page.locator('#desired-posture-baseline');
  const nameservers = Array.from({ length: 64 }, (_, index) => `ns${String(index + 1).padStart(2, '0')}.stored.example`);
  for (const name of ['Nameservers', 'DS records', 'Mail exchangers', 'CAA policy']) {
    await expect(baseline.getByRole('combobox', { name: `${name} expectation`, exact: true })).toHaveValue('unconfigured');
    await expect(baseline.getByRole('textbox', { name, exact: true })).toHaveCount(0);
  }
  await baseline.getByRole('combobox', { name: 'Nameservers expectation', exact: true }).selectOption('expect_records');
  await expect(baseline.getByRole('textbox', { name: 'Nameservers', exact: true })).toHaveAccessibleDescription(/One record per line/u);
  await baseline.getByRole('textbox', { name: 'Nameservers', exact: true }).fill(nameservers.join('\n'));
  await baseline.getByRole('combobox', { name: 'Nameservers expectation', exact: true }).selectOption('observe_only');
  await expect(baseline.getByRole('textbox', { name: 'Nameservers', exact: true })).toHaveCount(0);
  await baseline.getByRole('combobox', { name: 'Nameservers expectation', exact: true }).selectOption('expect_records');
  await expect(baseline.getByRole('textbox', { name: 'Nameservers', exact: true })).toHaveValue(nameservers.join('\n'));
  await baseline.getByRole('combobox', { name: 'DS records expectation', exact: true }).selectOption('expect_none');
  await baseline.getByRole('combobox', { name: 'Mail exchangers expectation', exact: true }).selectOption('expect_records');
  await baseline.getByRole('textbox', { name: 'Mail exchangers', exact: true }).fill('0 .');
  await baseline.getByRole('combobox', { name: 'CAA policy expectation', exact: true }).selectOption('observe_only');
  await baseline.getByRole('button', { name: 'Save expected settings' }).click();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('Saved expected domain settings.');
  await expect(baseline.getByRole('button', { name: 'Save expected settings' })).toBeFocused();

  const expectedModes = { nameservers: 'expect_records', ds: 'expect_none', mx: 'expect_records', caa: 'observe_only' };
  const stored = requiredValue((await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 })).records[0], 'The saved profile is missing.').value;
  expect(stored.desiredPostureBaselines[0]).toEqual(expect.objectContaining({ nameservers, ds: [], mx: ['0 .'], caa: [], recordModes: expectedModes }));
  await page.reload();
  await openBrandWorkbench(page, 'baselines');
  await expect(baseline.getByRole('textbox', { name: 'Nameservers', exact: true })).toHaveValue(nameservers.join('\n'));
  await expect(baseline.getByRole('combobox', { name: 'DS records expectation', exact: true })).toHaveValue('expect_none');
  await expect(baseline.getByRole('textbox', { name: 'Mail exchangers', exact: true })).toHaveValue('0 .');
  await expect(baseline.getByRole('combobox', { name: 'CAA policy expectation', exact: true })).toHaveValue('observe_only');

  await openBrandWorkbench(page, 'passport');
  const passport = page.getByRole('region', { name: 'Portable domain settings' });
  const downloadPromise = page.waitForEvent('download');
  await passport.getByRole('button', { name: 'Export passport' }).click();
  const file = requiredValue(await (await downloadPromise).path(), 'The exported passport is missing.');
  const exported = JSON.parse(await readFile(file, 'utf8'));
  expect(exported.entries[0]).toEqual(expect.objectContaining({ nameservers, ds: [], mx: ['0 .'], caa: [], recordModes: expectedModes }));
  await passport.getByLabel('Review passport').setInputFiles(file);
  await expect(passport).toContainText('Verified 1 passport entry');
  await expect(passport.getByRole('heading', { name: 'Import preview' })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);
});

test('a stale expected-settings editor preserves its draft and cannot overwrite another tab', async ({ page, context }) => {
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, {
    [PROFILES_KEY]: currentBrandProfileBrowserStore([{
      ...profileFixture(),
      desiredPostureBaselines: [{ domain: 'stored.example', nameservers: ['ns1.stored.example'], updatedAt: ISO }],
    }]),
    [ACTIVE_KEY]: 'profile-1',
  });
  await openBrandWorkbench(page, 'baselines');
  const baseline = page.locator('#desired-posture-baseline');
  await baseline.getByRole('textbox', { name: 'Nameservers', exact: true }).fill('draft.stored.example');
  const other = await context.newPage();
  try {
    await other.goto('/brands');
    await openBrandWorkbench(other, 'baselines');
    const current = other.locator('#desired-posture-baseline');
    await current.getByRole('textbox', { name: 'Nameservers', exact: true }).fill('concurrent.stored.example');
    await current.getByRole('button', { name: 'Save expected settings' }).click();
    await expect(other.getByRole('status', { name: 'Brand Profile action status' })).toContainText('Saved expected domain settings.');
    await page.bringToFront();
    await baseline.getByRole('button', { name: 'Save expected settings' }).click();
    await expect(baseline.getByRole('status')).toContainText('changed after this editor opened');
    await expect(baseline.getByRole('textbox', { name: 'Nameservers', exact: true })).toHaveValue('draft.stored.example');
    await expect(baseline.getByRole('button', { name: 'Save expected settings' })).toBeFocused();
    const stored = requiredValue((await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 })).records[0], 'The current profile is missing.').value;
    expect(stored.desiredPostureBaselines[0]?.nameservers).toEqual(['concurrent.stored.example']);
  } finally {
    await other.close();
  }
});

test('Brand Profile v6 change windows migrate to stable v7 identities and round-trip', async ({ page }) => {
  const storedProfile = {
    ...profileFixture(),
    desiredPostureBaselines: [{
      domain: 'stored.example',
      approvedChangeWindows: [{
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2026-09-01T02:00:00.000Z',
        summary: 'Existing reviewed maintenance',
      }],
      suppressions: [{ field: 'nameservers', expiresAt: null, reason: 'Existing reviewed exception' }],
      updatedAt: ISO,
    }],
  };
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, {
    [PROFILES_KEY]: { version: PUBLIC_BRAND_PROFILE_SCHEMA_VERSION, profiles: [storedProfile] },
    [ACTIVE_KEY]: 'profile-1',
  });
  await openBrandWorkbench(page, 'baselines');
  const baseline = page.locator('#desired-posture-baseline');
  const existingWindow = baseline.locator('.change-window-row').first();
  await expect(existingWindow.getByLabel('Reviewed summary')).toHaveValue('Existing reviewed maintenance');
  await expect(baseline.locator('.suppression-row').first().getByLabel('Reviewed rationale')).toHaveValue('Existing reviewed exception');
  await expect(baseline.getByText(/No expiry is retained/iu)).toBeVisible();

  await baseline.getByRole('button', { name: 'Add change window' }).click();
  const addedWindow = baseline.locator('.change-window-row').nth(1);
  await addedWindow.getByLabel('Start timestamp with timezone').fill('2026-09-02T10:00:00+10:00');
  await addedWindow.getByLabel('End timestamp with timezone').fill('2026-09-02T09:00:00+10:00');
  await addedWindow.getByLabel('Reviewed summary').fill('Second reviewed maintenance');
  await baseline.getByRole('button', { name: 'Save expected settings' }).click();
  await expect(baseline.getByRole('status')).toContainText('must end after it starts');
  await addedWindow.getByLabel('End timestamp with timezone').fill('2026-09-02T12:00:00+10:00');

  await baseline.getByRole('button', { name: 'Add suppression' }).click();
  const addedSuppression = baseline.locator('.suppression-row').nth(1);
  await addedSuppression.getByLabel('Supported field').selectOption('nameservers');
  await addedSuppression.getByLabel('Expiry with timezone').fill('2026-10-01T00:00:00Z');
  await addedSuppression.getByLabel('Reviewed rationale').fill('Second reviewed exception');
  await baseline.getByRole('button', { name: 'Save expected settings' }).click();
  await expect(baseline.getByRole('status')).toContainText('Only one suppression may be retained for nameservers');
  await addedSuppression.getByLabel('Supported field').selectOption('caa');
  await baseline.getByRole('button', { name: 'Save expected settings' }).click();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('Saved expected domain settings.');

  const stored = requiredValue(
    (await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 })).records[0],
    'The structured Brand Profile fixture is missing.',
  ).value;
  expect(stored.desiredPostureBaselines[0]?.approvedChangeWindows).toEqual([
    expect.objectContaining({
      id: expect.stringMatching(/^cw-[0-9a-f]{32}$/u),
      startsAt: '2026-09-01T00:00:00.000Z',
      endsAt: '2026-09-01T02:00:00.000Z',
      summary: 'Existing reviewed maintenance',
    }),
    expect.objectContaining({
      id: expect.stringMatching(/^cw-/u),
      startsAt: '2026-09-02T00:00:00.000Z',
      endsAt: '2026-09-02T02:00:00.000Z',
      summary: 'Second reviewed maintenance',
    }),
  ]);
  expect(stored.desiredPostureBaselines[0]?.suppressions).toEqual([
    { field: 'nameservers', expiresAt: null, reason: 'Existing reviewed exception' },
    { field: 'caa', expiresAt: '2026-10-01T00:00:00.000Z', reason: 'Second reviewed exception' },
  ]);

  await baseline.getByRole('button', { name: 'Remove change window 1' }).click();
  await expect(baseline.locator('.change-window-row').first().getByLabel('Reviewed summary')).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test('requires an explicit official-domain choice before enabling new-domain passport fields', async ({ page }) => {
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, {
    [PROFILES_KEY]: currentBrandProfileBrowserStore([profileFixture()]),
    [ACTIVE_KEY]: 'profile-1',
  });
  await openBrandWorkbench(page, 'passport');
  const passport = buildDomainControlManifest({
    schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
    version: 1,
    expiresAt: '2026-09-13T04:05:06.000Z',
    entries: [{
      domain: 'new-control.example',
      nameservers: ['ns1.new-control.example'],
      ds: [],
      mx: [],
      caa: [],
      tlsIssuer: null,
      tlsSpkiSha256: null,
      registrarLock: null,
      renewalReviewAt: null,
      note: null,
    }],
  }, ISO);
  const region = page.getByRole('region', { name: 'Portable domain settings' });
  await region.getByLabel('Review passport').setInputFiles({
    name: 'new-domain-passport.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(passport)),
  });
  const entry = region.locator('fieldset', { hasText: 'new-control.example' });
  const addDomain = entry.getByRole('checkbox', { name: 'Add as an official domain' });
  const entrySelection = entry.locator('legend').getByRole('checkbox');
  const nameservers = entry.getByRole('checkbox', { name: 'Nameservers' });
  await expect(entrySelection).not.toBeChecked();
  await expect(nameservers).toBeDisabled();

  await addDomain.check();
  await expect(entrySelection).toBeChecked();
  await expect(nameservers).toBeEnabled();
  await addDomain.uncheck();
  await expect(entrySelection).not.toBeChecked();
  await expect(nameservers).toBeDisabled();
  await expect(region.getByRole('button', { name: 'Import selected fields' })).toBeDisabled();
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
  await migrateLegacyBrowserData(page, { [PROFILES_KEY]: currentBrandProfileBrowserStore(stored) });
  const before = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  await failBrowserLocalManifestWrites(page, 'brand_profiles');

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Brand name').fill('Changed name');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('out of storage space');
  await expect(page.locator('.local-context-status')).toHaveCount(0);
  await expect(page.getByLabel('Brand name')).toHaveValue('Changed name');
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeFocused();
  const after = await readBrowserLocalCollection(page, 'brand_profiles');
  expect(after.records.map((entry) => entry.value)).toEqual(before.records.map((entry) => entry.value));
});
