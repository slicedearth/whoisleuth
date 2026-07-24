import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, failBrowserLocalManifestWrites, migrateLegacyBrowserData, readBrowserLocalCollection } from './helpers';

const NOW = '2026-07-14T08:00:00.000Z';

function caseRecord(id: string, domain: string, status: string) {
  return {
    id,
    domain,
    status,
    disposition: 'unreviewed',
    tags: [],
    notes: [],
    source: 'lookup',
    evidenceHistory: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function watchlistEntry(domain: string) {
  return {
    updatedAt: NOW,
    results: [{ domain, availability: 'registered', scanDepth: 'fast', mutationTypes: [] }],
    baseline: [],
    history: [],
  };
}

function profile(id: string, name: string) {
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
    trademarkOwner: '',
    trademarkRegistration: '',
    officialFaviconHash: '',
    officialFaviconPHash: '',
    pageBaseline: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

async function seedArchiveWorkspace(page: import('@playwright/test').Page) {
  const archiveCase = {
      id: 'archive-case', domain: 'archive-case.invalid', status: 'new', disposition: 'unreviewed',
      tags: ['archive'], notes: [{ id: 'archive-note', body: 'Analyst archive note', createdAt: NOW }],
      source: 'lookup', evidenceHistory: [], createdAt: NOW, updatedAt: NOW,
    };
  const archiveProfile = {
      id: 'archive-profile', name: 'Archive profile', officialDomains: ['official.invalid'], productNames: [], tlds: [],
      approvedPartnerDomains: [], allowlistedDomains: [], allowlistedRegistrars: [], dkimSelectors: [],
      trademarkOwner: '', trademarkRegistration: '', officialFaviconHash: '', officialFaviconPHash: '', pageBaseline: null,
      createdAt: NOW, updatedAt: NOW,
    };
  await page.evaluate(() => sessionStorage.setItem('whoisleuth:investigation-guide:v1', JSON.stringify({ domain: 'private.invalid' })));
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: 2, cases: [archiveCase] },
    'whoisleuth-campaigns-v1': { version: 1, campaigns: [{
      id: 'archive-campaign', name: 'Archive campaign', description: 'Portable workspace fixture',
      domains: ['archive-case.invalid'], createdAt: NOW, updatedAt: NOW,
    }] },
    'whois-rdap-brand-profiles-v1': { version: 2, profiles: [archiveProfile] },
    'whois-rdap-active-brand-profile-v1': 'archive-profile',
    'whois-rdap-watchlist-v1': {
      schema: 'whoisleuth.watchlists', version: 2,
      watchlists: { 'Archive watchlist': { updatedAt: NOW, results: [], baseline: [], history: [] } },
    },
    'whois-rdap-shortlist-v1': {
      schema: 'whoisleuth.shortlist', version: 2,
      entries: [{ domain: 'archive-case.invalid', availability: 'unknown', mutationTypes: [], savedAt: NOW }],
    },
    'whoisleuth-detection-rules-v1': {
      version: 1,
      rules: [{ id: 'archive-rule', name: 'Archive rule', enabled: true, match: 'all',
        conditions: [{ field: 'status', operator: 'equals', value: 'new' }], riskDelta: 0, tag: 'archive' }],
    },
    'whoisleuth-relationship-observations-v1': {
      schema: 'whoisleuth.relationship-observations',
      version: 1,
      observations: [{
        id: 'relationship-fixture-alias',
        type: 'ip_address',
        label: 'Shared IP address',
        method: 'Exact normalized address',
        normalizedValue: '192.0.2.20',
        displayValue: '192.0.2.20',
        domains: ['archive-case.invalid', 'archive-related.invalid'],
        description: 'Bounded relationship fixture.',
        classification: 'derived',
        source: 'bulk_relationship_analysis',
        sourceVersion: 2,
        observedAt: NOW,
        retainedAt: NOW,
        complete: true,
        truncated: false,
        limitations: ['Shared infrastructure is not proof of common control.'],
      }],
    },
    'whoisleuth:theme:v1': 'light',
    'unrelated-private-key': 'must-not-export',
  }, { clearStorage: true });
}

async function downloadWorkspaceArchive(page: import('@playwright/test').Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const download = await pending;
  const body = await (await download.createReadStream()).toArray();
  return { download, content: Buffer.concat(body).toString('utf-8') };
}

test('the Dashboard groups core tasks without duplicating the sidebar tool map', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View public homepage' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('heading', { name: 'Start an investigation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Continue saved work' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Follow a guided investigation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Back up or move saved work' })).toBeVisible();
  await expect(page.locator('.quick-card')).toHaveCount(3);
  await expect(page.locator('.quick-card .quick-icon svg')).toHaveCount(3);
  await expect(page.locator('.quick-card', { hasText: 'Check one target' }).locator('.quick-icon svg')).toHaveAttribute('data-icon', 'lookup');
  await expect(page.locator('.quick-card', { hasText: 'Find lookalike domains' }).locator('.quick-icon svg')).toHaveAttribute('data-icon', 'discover');
  await expect(page.locator('.quick-card', { hasText: 'Compare domain candidates' }).locator('.quick-icon svg')).toHaveAttribute('data-icon', 'bulk');
  await expect(page.locator('.workspace-card')).toHaveCount(0);
  await expect(page.locator('.summary-card .summary-icon svg')).toHaveCount(3);
  await expect(page.locator('.summary-card', { hasText: 'Open cases' })).toHaveAttribute('href', '/monitor?view=cases');
  await expect(page.locator('.summary-card', { hasText: 'Watchlists' })).toHaveAttribute('href', '/monitor?view=watchlists');
  await expect(page.getByRole('link', { name: /Check domain-ending support/ })).toHaveAttribute('href', '/registry-support');
  await expect(page.getByRole('link', { name: /Read the guide/ })).toHaveAttribute('href', '/guide');
  await expect(page.getByRole('combobox', { name: 'Guide' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start guide' })).toBeVisible();
  await expect(page.getByText('Start recipe', { exact: true })).toHaveCount(0);
  await expect(page.getByText('indexed entities', { exact: false })).toHaveCount(0);
  await expect(page.getByText('Investigation tools', { exact: true })).toHaveCount(0);
});

test('the dashboard reports bounded browser-local counts without exposing stored values', async ({ page }) => {
  await page.goto('/dashboard');
  const stored = {
    cases: {
      version: 2,
      cases: [
        caseRecord('case-open', 'open.invalid', 'new'),
        caseRecord('case-resolved', 'resolved.invalid', 'resolved'),
      ],
    },
    watchlists: {
      First: watchlistEntry('first.invalid'),
      Second: watchlistEntry('second.invalid'),
    },
    profiles: [profile('profile-one', 'First profile'), profile('profile-two', 'Second profile')],
  };
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': stored.cases,
    'whois-rdap-watchlist-v1': stored.watchlists,
    'whois-rdap-brand-profiles-v1': stored.profiles,
  }, { clearStorage: true });

  await expect(page.locator('.summary-card', { hasText: 'Open cases' }).locator('strong')).toHaveText('1');
  await expect(page.locator('.summary-card', { hasText: 'Open cases' })).toContainText('2 total saved cases');
  await expect(page.locator('.summary-card', { hasText: 'Watchlists' }).locator('strong')).toHaveText('2');
  await expect(page.locator('.summary-card', { hasText: 'Brand profiles' }).locator('strong')).toHaveText('2');
  await expect(page.locator('main')).not.toContainText('open.invalid');
  await expect(page.locator('main')).not.toContainText('First profile');

  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);
});

test('saved-work cards open the matching Monitor view', async ({ page }) => {
  await page.goto('/dashboard');
  await page.locator('.summary-card', { hasText: 'Open cases' }).click();
  await expect(page).toHaveURL('/monitor?view=cases');
  await expect(page.getByRole('tab', { name: /Cases/ })).toHaveAttribute('aria-selected', 'true');

  await page.goto('/dashboard');
  await page.locator('.summary-card', { hasText: 'Watchlists' }).click();
  await expect(page).toHaveURL('/monitor?view=watchlists');
  await expect(page.getByRole('tab', { name: /Watchlists/ })).toHaveAttribute('aria-selected', 'true');
});

test('the dashboard exports one checksummed workspace archive without unrelated storage', async ({ page }) => {
  await page.goto('/dashboard');
  await seedArchiveWorkspace(page);

  const { download, content } = await downloadWorkspaceArchive(page);
  expect(download.suggestedFilename()).toMatch(/^whoisleuth-workspace-\d{4}-\d{2}-\d{2}\.json$/);
  const archive = JSON.parse(content);
  expect(archive.schema).toBe('whoisleuth.workspace-archive');
  expect(archive.version).toBe(1);
  expect(archive.manifest.sectionCount).toBe(8);
  expect(archive.manifest.sections.map((section: any) => section.id)).toEqual([
    'cases', 'campaigns', 'brandProfiles', 'watchlists', 'shortlist', 'detectionRules', 'relationshipObservations', 'settings',
  ]);
  expect(archive.manifest.sections.every((section: any) => /^sha256:[a-f0-9]{64}$/.test(section.checksum))).toBe(true);
  expect(archive.sections.cases.cases[0].notes[0].body).toBe('Analyst archive note');
  expect(archive.sections.relationshipObservations.observations).toHaveLength(1);
  expect(archive.sections.relationshipObservations.observations[0].normalizedValue).toBe('192.0.2.20');
  expect(archive.sections.settings).toMatchObject({ activeProfileId: 'archive-profile', theme: 'light' });
  expect(content).not.toContain('must-not-export');
  expect(content).not.toContain('private.invalid');
  expect(content).not.toContain('wrt_session');
  await expect(page.getByRole('status')).toContainText('Downloaded a workspace backup with 8 verified data sections');
});

test('workspace archive import previews conflicts before a non-destructive mobile-safe merge', async ({ page }) => {
  await page.goto('/dashboard');
  await seedArchiveWorkspace(page);
  const { content } = await downloadWorkspaceArchive(page);

  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: 2, cases: [{
      id: 'local-case', domain: 'local-only.invalid', status: 'new', disposition: 'unreviewed', tags: [], notes: [],
      source: 'manual', evidenceHistory: [], createdAt: NOW, updatedAt: NOW,
    }] },
  }, { clearStorage: true });
  await page.getByLabel('Review backup file').setInputFiles({ name: 'workspace.json', mimeType: 'application/json', buffer: Buffer.from(content) });

  const preview = page.locator('.preview');
  await expect(preview.getByRole('heading', { name: 'Choose saved data to add' })).toBeVisible();
  await expect(preview.locator('li')).toHaveCount(8);
  await expect(preview.locator('li', { hasText: 'Cases' })).toContainText('1 new');
  await expect(preview.locator('li', { hasText: 'Workspace settings' })).toContainText('Ready');
  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);

  await preview.getByRole('button', { name: 'Add selected data' }).click();
  await expect(page.getByRole('status')).toContainText('Added backup data from 8 sections');
  const [cases, campaigns, profiles, relationshipObservations, settings] = await Promise.all([
    readBrowserLocalCollection(page, 'cases', { minimumRevision: 2 }),
    readBrowserLocalCollection(page, 'campaigns', { minimumRevision: 2 }),
    readBrowserLocalCollection(page, 'brand_profiles', { minimumRevision: 2 }),
    readBrowserLocalCollection(page, 'relationship_observations', { minimumRevision: 2 }),
    page.evaluate(() => ({
    activeProfile: localStorage.getItem('whois-rdap-active-brand-profile-v1'),
    theme: localStorage.getItem('whoisleuth:theme:v1'),
    })),
  ]);
  expect(cases.records.map((record: any) => record.value.domain).sort()).toEqual(['archive-case.invalid', 'local-only.invalid']);
  expect(campaigns.records).toHaveLength(1);
  expect(profiles.records).toHaveLength(1);
  expect(relationshipObservations.records).toHaveLength(1);
  expect(settings.activeProfile).toBe('archive-profile');
  expect(settings.theme).toBe('light');
});

test('workspace archive import reports future sections and rolls back an interrupted merge', async ({ page }) => {
  await page.goto('/dashboard');
  await seedArchiveWorkspace(page);
  const { content } = await downloadWorkspaceArchive(page);
  const future = JSON.parse(content);
  future.manifest.sections.find((section: any) => section.id === 'watchlists').version = 999;
  await page.getByLabel('Review backup file').setInputFiles({ name: 'future.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(future)) });
  const futureWatchlists = page.locator('.preview li', { hasText: 'Watchlists' });
  await expect(futureWatchlists).toContainText('Unsupported');
  await expect(futureWatchlists.getByRole('checkbox')).toBeDisabled();

  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: 2, cases: [{
      id: 'rollback-case', domain: 'rollback.invalid', status: 'new', disposition: 'unreviewed', tags: [], notes: [],
      source: 'manual', evidenceHistory: [], createdAt: NOW, updatedAt: NOW,
    }] },
  }, { clearStorage: true });
  await page.getByLabel('Review backup file').setInputFiles({ name: 'workspace.json', mimeType: 'application/json', buffer: Buffer.from(content) });
  const preview = page.locator('.preview');
  for (const checkbox of await preview.getByRole('checkbox').all()) {
    if (await checkbox.isChecked()) await checkbox.uncheck();
  }
  await preview.locator('li', { hasText: 'Cases' }).getByRole('checkbox').check();
  await preview.locator('li', { hasText: 'Campaigns' }).getByRole('checkbox').check();
  await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  await failBrowserLocalManifestWrites(page, 'campaigns');
  await preview.getByRole('button', { name: 'Add selected data' }).click();
  await expect(page.getByRole('status')).toContainText('No archive changes were kept');
  const domains = (await readBrowserLocalCollection(page, 'cases')).records.map((record: any) => record.value.domain);
  expect(domains).toEqual(['rollback.invalid']);
});
