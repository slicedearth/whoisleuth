import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';
import { workspaces, referenceWorkspaces } from '../frontend/src/lib/workspaces';

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
  await page.evaluate(({ now }) => {
    const archiveCase = {
      id: 'archive-case', domain: 'archive-case.invalid', status: 'new', disposition: 'unreviewed',
      tags: ['archive'], notes: [{ id: 'archive-note', body: 'Analyst archive note', createdAt: now }],
      source: 'lookup', evidenceHistory: [], createdAt: now, updatedAt: now,
    };
    const archiveProfile = {
      id: 'archive-profile', name: 'Archive profile', officialDomains: ['official.invalid'], productNames: [], tlds: [],
      approvedPartnerDomains: [], allowlistedDomains: [], allowlistedRegistrars: [], dkimSelectors: [],
      trademarkOwner: '', trademarkRegistration: '', officialFaviconHash: '', officialFaviconPHash: '', pageBaseline: null,
      createdAt: now, updatedAt: now,
    };
    localStorage.setItem('whois-rdap-cases-v1', JSON.stringify({ version: 2, cases: [archiveCase] }));
    localStorage.setItem('whoisleuth-campaigns-v1', JSON.stringify({ version: 1, campaigns: [{
      id: 'archive-campaign', name: 'Archive campaign', description: 'Portable workspace fixture',
      domains: ['archive-case.invalid'], createdAt: now, updatedAt: now,
    }] }));
    localStorage.setItem('whois-rdap-brand-profiles-v1', JSON.stringify({ version: 2, profiles: [archiveProfile] }));
    localStorage.setItem('whois-rdap-active-brand-profile-v1', 'archive-profile');
    localStorage.setItem('whois-rdap-watchlist-v1', JSON.stringify({
      schema: 'whoisleuth.watchlists', version: 2,
      watchlists: { 'Archive watchlist': { updatedAt: now, results: [], baseline: [], history: [] } },
    }));
    localStorage.setItem('whois-rdap-shortlist-v1', JSON.stringify({
      schema: 'whoisleuth.shortlist', version: 2,
      entries: [{ domain: 'archive-case.invalid', availability: 'unknown', mutationTypes: [], savedAt: now }],
    }));
    localStorage.setItem('whoisleuth-detection-rules-v1', JSON.stringify({
      version: 1,
      rules: [{ id: 'archive-rule', name: 'Archive rule', enabled: true, match: 'all',
        conditions: [{ field: 'status', operator: 'equals', value: 'new' }], riskDelta: 0, tag: 'archive' }],
    }));
    localStorage.setItem('whoisleuth:theme:v1', 'light');
    localStorage.setItem('unrelated-private-key', 'must-not-export');
    sessionStorage.setItem('whoisleuth:investigation-guide:v1', JSON.stringify({ domain: 'private.invalid' }));
  }, { now: NOW });
  await page.reload();
}

async function downloadWorkspaceArchive(page: import('@playwright/test').Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export workspace' }).click();
  const download = await pending;
  const body = await (await download.createReadStream()).toArray();
  return { download, content: Buffer.concat(body).toString('utf-8') };
}

test('the dashboard launches every workspace and links back to the public homepage', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Investigation dashboard' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View public homepage' })).toHaveAttribute('href', '/');
  await expect(page.locator('.quick-card')).toHaveCount(3);
  await expect(page.locator('.workspace-card')).toHaveCount(workspaces.length + referenceWorkspaces.length);

  for (const { label, href } of [...workspaces, ...referenceWorkspaces]) {
    await expect(page.locator('.workspace-card').filter({ hasText: label }).first()).toHaveAttribute('href', href);
  }
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
  await page.evaluate((value) => {
    localStorage.setItem('whois-rdap-cases-v1', JSON.stringify(value.cases));
    localStorage.setItem('whois-rdap-watchlist-v1', JSON.stringify(value.watchlists));
    localStorage.setItem('whois-rdap-brand-profiles-v1', JSON.stringify(value.profiles));
  }, stored);
  await page.reload();

  await expect(page.locator('.summary-card', { hasText: 'Open cases' }).locator('strong')).toHaveText('1');
  await expect(page.locator('.summary-card', { hasText: 'Open cases' })).toContainText('2 total saved cases');
  await expect(page.locator('.summary-card', { hasText: 'Watchlists' }).locator('strong')).toHaveText('2');
  await expect(page.locator('.summary-card', { hasText: 'Brand profiles' }).locator('strong')).toHaveText('2');
  await expect(page.locator('main')).not.toContainText('open.invalid');
  await expect(page.locator('main')).not.toContainText('First profile');

  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);
});

test('the dashboard exports one checksummed workspace archive without unrelated storage', async ({ page }) => {
  await page.goto('/dashboard');
  await seedArchiveWorkspace(page);

  const { download, content } = await downloadWorkspaceArchive(page);
  expect(download.suggestedFilename()).toMatch(/^whoisleuth-workspace-\d{4}-\d{2}-\d{2}\.json$/);
  const archive = JSON.parse(content);
  expect(archive.schema).toBe('whoisleuth.workspace-archive');
  expect(archive.version).toBe(1);
  expect(archive.manifest.sectionCount).toBe(7);
  expect(archive.manifest.sections.map((section: any) => section.id)).toEqual([
    'cases', 'campaigns', 'brandProfiles', 'watchlists', 'shortlist', 'detectionRules', 'settings',
  ]);
  expect(archive.manifest.sections.every((section: any) => /^sha256:[a-f0-9]{64}$/.test(section.checksum))).toBe(true);
  expect(archive.sections.cases.cases[0].notes[0].body).toBe('Analyst archive note');
  expect(archive.sections.settings).toMatchObject({ activeProfileId: 'archive-profile', theme: 'light' });
  expect(content).not.toContain('must-not-export');
  expect(content).not.toContain('private.invalid');
  expect(content).not.toContain('wrt_session');
  await expect(page.getByRole('status')).toContainText('Downloaded 7 verified workspace sections');
});

test('workspace archive import previews conflicts before a non-destructive mobile-safe merge', async ({ page }) => {
  await page.goto('/dashboard');
  await seedArchiveWorkspace(page);
  const { content } = await downloadWorkspaceArchive(page);

  await page.evaluate(({ now }) => {
    localStorage.clear();
    localStorage.setItem('whois-rdap-cases-v1', JSON.stringify({ version: 2, cases: [{
      id: 'local-case', domain: 'local-only.invalid', status: 'new', disposition: 'unreviewed', tags: [], notes: [],
      source: 'manual', evidenceHistory: [], createdAt: now, updatedAt: now,
    }] }));
  }, { now: NOW });
  await page.reload();
  await page.getByLabel('Preview archive').setInputFiles({ name: 'workspace.json', mimeType: 'application/json', buffer: Buffer.from(content) });

  const preview = page.locator('.preview');
  await expect(preview.getByRole('heading', { name: 'Choose sections to merge' })).toBeVisible();
  await expect(preview.locator('li')).toHaveCount(7);
  await expect(preview.locator('li', { hasText: 'Cases' })).toContainText('1 new');
  await expect(preview.locator('li', { hasText: 'Workspace settings' })).toContainText('Ready');
  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);

  await preview.getByRole('button', { name: 'Merge selected sections' }).click();
  await expect(page.getByRole('status')).toContainText('Merged 7 sections');
  const stored = await page.evaluate(() => ({
    cases: JSON.parse(localStorage.getItem('whois-rdap-cases-v1') || '{}').cases,
    campaigns: JSON.parse(localStorage.getItem('whoisleuth-campaigns-v1') || '{}').campaigns,
    profiles: JSON.parse(localStorage.getItem('whois-rdap-brand-profiles-v1') || '{}').profiles,
    activeProfile: localStorage.getItem('whois-rdap-active-brand-profile-v1'),
    theme: localStorage.getItem('whoisleuth:theme:v1'),
  }));
  expect(stored.cases.map((record: any) => record.domain).sort()).toEqual(['archive-case.invalid', 'local-only.invalid']);
  expect(stored.campaigns).toHaveLength(1);
  expect(stored.profiles).toHaveLength(1);
  expect(stored.activeProfile).toBe('archive-profile');
  expect(stored.theme).toBe('light');
});

test('workspace archive import reports future sections and rolls back an interrupted merge', async ({ page }) => {
  await page.goto('/dashboard');
  await seedArchiveWorkspace(page);
  const { content } = await downloadWorkspaceArchive(page);
  const future = JSON.parse(content);
  future.manifest.sections.find((section: any) => section.id === 'watchlists').version = 999;
  await page.getByLabel('Preview archive').setInputFiles({ name: 'future.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(future)) });
  const futureWatchlists = page.locator('.preview li', { hasText: 'Watchlists' });
  await expect(futureWatchlists).toContainText('Unsupported');
  await expect(futureWatchlists.getByRole('checkbox')).toBeDisabled();

  await page.evaluate(({ now }) => {
    localStorage.clear();
    localStorage.setItem('whois-rdap-cases-v1', JSON.stringify({ version: 2, cases: [{
      id: 'rollback-case', domain: 'rollback.invalid', status: 'new', disposition: 'unreviewed', tags: [], notes: [],
      source: 'manual', evidenceHistory: [], createdAt: now, updatedAt: now,
    }] }));
  }, { now: NOW });
  await page.reload();
  await page.getByLabel('Preview archive').setInputFiles({ name: 'workspace.json', mimeType: 'application/json', buffer: Buffer.from(content) });
  const preview = page.locator('.preview');
  for (const checkbox of await preview.getByRole('checkbox').all()) {
    if (await checkbox.isChecked()) await checkbox.uncheck();
  }
  await preview.locator('li', { hasText: 'Cases' }).getByRole('checkbox').check();
  await preview.locator('li', { hasText: 'Campaigns' }).getByRole('checkbox').check();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Object.defineProperty(Storage.prototype, 'setItem', {
      configurable: true,
      value(key: string, value: string) {
        if (key === 'whoisleuth-campaigns-v1') throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
        return original.call(this, key, value);
      },
    });
  });
  await preview.getByRole('button', { name: 'Merge selected sections' }).click();
  await expect(page.getByRole('status')).toContainText('No archive changes were kept');
  const domains = await page.evaluate(() => JSON.parse(localStorage.getItem('whois-rdap-cases-v1') || '{}').cases.map((record: any) => record.domain));
  expect(domains).toEqual(['rollback.invalid']);
});
