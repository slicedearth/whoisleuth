import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, failBrowserLocalManifestWrites, migrateLegacyBrowserData, readBrowserLocalCollection, requiredValue } from './helpers';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { ArchiveInspectionReport } from '../cli/archive-inspect.mts';
import { CASE_SCHEMA_VERSION, normalizeCaseStore } from '../frontend/src/lib/analysis/case-model';
import { sha256ArtifactDigest } from '../frontend/src/lib/analysis/artifact-integrity';
import type { WorkspaceArchiveDocument } from '../frontend/src/lib/analysis/workspace-archive';
import type { EncryptedWorkspaceArchiveEnvelope } from '../frontend/src/lib/analysis/workspace-archive-crypto';

const NOW = '2026-07-14T08:00:00.000Z';

async function runOfflineCliJson<T>(argv: string[], input: unknown): Promise<T> {
  const { FORCE_COLOR: _forceColor, NO_COLOR: _noColor, ...environment } = process.env;
  const execution = spawnSync(process.execPath, [
    resolve(process.cwd(), 'bin/whoisleuth.mts'),
    ...argv,
  ], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: environment,
  });
  expect(execution.status, execution.stderr).toBe(0);
  expect(execution.stderr).toBe('');
  return JSON.parse(execution.stdout) as T;
}

function caseRecord(id: string, domain: string, status: string) {
  return {
    id,
    domain,
    status,
    disposition: 'unreviewed',
    brandProfileIds: [],
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
    'whoisleuth-website-snapshots-v1': {
      schema: 'whoisleuth.website-profile-snapshots',
      version: 1,
      snapshots: [{
        id: 'archive-website-snapshot',
        domain: 'archive-case.invalid',
        observedAt: NOW,
        savedAt: NOW,
        complete: true,
        truncated: false,
        technologies: [{ id: 'cms-one', name: 'CMS One', category: 'cms', confidence: 'high' }],
        posture: [{ id: 'https', state: 'observed' }],
        identity: {
          normalizedHtml: 'a'.repeat(64),
          visibleText: null,
          domStructure: null,
          formStructure: null,
          resourceHosts: null,
          trackingIdentifiers: null,
          faviconHash: null,
        },
        sources: [{ source: 'page', state: 'success' }],
      }],
    },
    'whoisleuth-investigation-templates-v1': {
      schema: 'whoisleuth.investigation-templates',
      version: 1,
      templates: [{
        id: 'archive-investigation-template',
        label: 'Archive review template',
        summary: 'A portable bounded guide template.',
        recipeId: 'new_domain_triage',
        stages: [{
          id: 'lookup',
          label: 'Collect evidence',
          detail: 'Review one bounded target.',
          expectedEvidence: 'Separately attributed evidence.',
          completionCriteria: 'Source states were reviewed.',
          instructions: ['Run a Deep lookup.'],
          requiresApproval: true,
        }],
        createdAt: NOW,
        updatedAt: NOW,
      }],
    },
    'whoisleuth-bulk-review-v1': {
      schema: 'whoisleuth.bulk-review',
      version: 1,
      presets: [{
        kind: 'preset',
        id: 'archive-review-view',
        name: 'Archive priority review',
        view: {
          primaryFilter: 'high_risk',
          mutationFilter: '',
          signalFilters: [],
          sourceFilter: '',
          lifecycleFilter: '',
          ageFilter: '',
          mailFilter: '',
          registrarFilter: '',
          caseDispositionFilter: '',
          reviewStateFilter: 'reviewing',
          groupBy: '',
          sortKey: 'risk',
          sortDirection: -1,
        },
        createdAt: NOW,
        updatedAt: NOW,
      }],
      rows: [{
        kind: 'row',
        domain: 'archive-case.invalid',
        state: 'reviewing',
        updatedAt: NOW,
      }],
    },
    'whoisleuth:theme:v1': 'light',
    'unrelated-private-key': 'must-not-export',
  }, { clearStorage: true });
}

async function downloadWorkspaceArchive(page: import('@playwright/test').Page) {
  await page.getByText('How workspace backups work', { exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download unencrypted backup' }).click();
  const download = await pending;
  const body = await (await download.createReadStream()).toArray();
  return { download, content: Buffer.concat(body).toString('utf-8') };
}

async function downloadEncryptedWorkspaceArchive(
  page: import('@playwright/test').Page,
  passphrase: string,
) {
  await page.getByRole('button', { name: 'Download encrypted backup' }).click();
  await page.getByLabel(/^Passphrase/).fill(passphrase);
  await page.getByLabel('Confirm passphrase').fill(passphrase);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Encrypt and download' }).click();
  const download = await pending;
  const body = await (await download.createReadStream()).toArray();
  return { download, content: Buffer.concat(body).toString('utf-8') };
}

test('the Dashboard presents task lanes without duplicating the sidebar labels', {
  tag: ['@analyst-journey', '@journey-first-domain-assessment'],
}, async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View public homepage' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('heading', { name: 'Start an investigation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Continue saved work' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Follow a guided investigation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Back up or move saved work' })).toBeVisible();
  await expect(page.locator('.quick-card')).toHaveCount(4);
  await expect(page.locator('.quick-card .quick-icon svg')).toHaveCount(4);
  await expect(page.locator('.quick-card', { hasText: 'Investigate a target' }).locator('.quick-icon svg')).toHaveAttribute('data-icon', 'lookup');
  await expect(page.locator('.quick-card', { hasText: 'Protect owned domains' }).locator('.quick-icon svg')).toHaveAttribute('data-icon', 'brand');
  await expect(page.locator('.quick-card', { hasText: 'Review candidates' }).locator('.quick-icon svg')).toHaveAttribute('data-icon', 'bulk');
  await expect(page.locator('.quick-card', { hasText: 'Assess acquisition' }).locator('.quick-icon svg')).toHaveAttribute('data-icon', 'registry');
  await expect(page.locator('.quick-card', { hasText: 'Protect owned domains' })).toHaveAttribute('href', '/brands');
  await expect(page.locator('.quick-card', { hasText: 'Review candidates' })).toHaveAttribute('href', '/bulk');
  await expect(page.locator('.quick-card', { hasText: 'Assess acquisition' })).toHaveAttribute('href', '/lookup?depth=deep&task=acquisition#query');
  await expect(page.locator('.quick-card', { hasText: 'Continue case work' })).toHaveCount(0);
  await expect(page.locator('.workspace-card')).toHaveCount(0);
  await expect(page.locator('.summary-card .summary-icon svg')).toHaveCount(3);
  await expect(page.locator('.summary-card', { hasText: 'Open cases' })).toHaveAttribute('href', '/monitor?view=cases');
  await expect(page.locator('.summary-card', { hasText: 'Watchlists' })).toHaveAttribute('href', '/monitor?view=watchlists');
  await expect(page.getByRole('link', { name: /Check domain-ending support/ })).toHaveAttribute('href', '/registry-support');
  await expect(page.getByRole('link', { name: /Open resources/ })).toHaveAttribute('href', '/resources#start');
  await expect(page.getByRole('combobox', { name: 'Guide' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start guide' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Compare two domains' })).toHaveCount(0);
  await expect(page.getByLabel('First domain')).toHaveCount(0);
  await expect(page.getByText('Start recipe', { exact: true })).toHaveCount(0);
  await expect(page.getByText('indexed entities', { exact: false })).toHaveCount(0);
  await expect(page.getByText('Investigation tools', { exact: true })).toHaveCount(0);
});

test('the Console navigation exposes semantic groups without changing link order or mobile keyboard access', async ({ page }) => {
  await page.goto('/dashboard');
  const consoleNavigation = page.getByRole('navigation', { name: 'Console' });
  const start = consoleNavigation.getByRole('group', { name: 'Start' });
  const investigate = consoleNavigation.getByRole('group', { name: 'Investigate' });
  const protect = consoleNavigation.getByRole('group', { name: 'Protect & review' });
  await expect(start.getByRole('link')).toHaveCount(1);
  await expect(investigate.getByRole('link')).toHaveCount(3);
  await expect(protect.getByRole('link')).toHaveCount(2);
  await expect(consoleNavigation.getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('href')))).resolves.toEqual([
    '/dashboard', '/lookup', '/discover', '/bulk', '/monitor', '/brands',
  ]);

  await investigate.getByRole('link', { name: /^Lookup/ }).focus();
  await page.keyboard.press('Tab');
  await expect(investigate.getByRole('link', { name: /^Discover/ })).toBeFocused();

  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(start).toBeVisible();
  await expect(investigate).toBeVisible();
  await expect(protect).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Toggle navigation' })).toHaveAttribute('aria-expanded', 'false');
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 700 });
    await expectNoHorizontalOverflow(page);
  }
});

test('the privacy-safe browser handoff previews exact third-party disclosure before opening', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByLabel('Domain or URL').fill('https://user:secret@Sub.Example.Invalid:8443/private?token=secret#fragment');
  await page.getByLabel('Destination').selectOption('external_https');
  await page.getByLabel('Disclose').selectOption('sanitized_url');
  await page.getByLabel('Exact endpoint').fill('https://analyst-service.invalid/review');
  await page.getByRole('button', { name: 'Prepare exact preview' }).click();

  const preview = page.locator('.browser-handoff .preview');
  await expect(preview).toContainText('Configured external service');
  await expect(preview).toContainText('https://sub.example.invalid/');
  await expect(preview).toContainText('third party');
  await expect(preview).toContainText('https://analyst-service.invalid/review?target=https%3A%2F%2Fsub.example.invalid%2F');
  await expect(preview).toContainText('Removed: credentials, port, path, query, fragment.');
  await expect(preview).not.toContainText('secret');
  await expect(preview).not.toContainText('token');
  await expect(page.getByRole('button', { name: 'Open reviewed destination' })).toBeDisabled();
  await page.getByLabel(/I reviewed the exact endpoint/).check();
  await expect(page.getByRole('button', { name: 'Open reviewed destination' })).toBeEnabled();

  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);
});

test('the dashboard reports bounded browser-local counts and recent saved work', async ({ page }) => {
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
  const recentWork = page.getByRole('list', { name: 'Recent local investigation work' });
  await expect(page.getByRole('heading', { name: 'Recent saved work' })).toBeVisible();
  await expect(recentWork.locator(':scope > li')).toHaveCount(6);
  await expect(recentWork).toContainText('open.invalid');
  await expect(recentWork).toContainText('First profile');

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

test('the dashboard exports one checksummed workspace archive without unrelated storage', {
  tag: ['@analyst-journey', '@journey-workspace-portability-review'],
}, async ({ page }) => {
  await page.goto('/dashboard');
  await seedArchiveWorkspace(page);

  const { download, content } = await downloadWorkspaceArchive(page);
  expect(download.suggestedFilename()).toMatch(/^whoisleuth-workspace-\d{4}-\d{2}-\d{2}\.json$/);
  const archive = JSON.parse(content) as WorkspaceArchiveDocument;
  expect(archive.schema).toBe('whoisleuth.workspace-archive');
  expect(archive.version).toBe(5);
  expect(archive.manifest.sectionCount).toBe(12);
  expect(archive.manifest.sections.map((section) => section.id)).toEqual([
    'cases', 'campaigns', 'brandProfiles', 'watchlists', 'shortlist', 'detectionRules', 'relationshipObservations', 'bulkSessions', 'websiteSnapshots', 'investigationTemplates', 'bulkReview', 'settings',
  ]);
  expect(archive.manifest.sections.every((section) => /^sha256:[a-f0-9]{64}$/.test(section.checksum))).toBe(true);
  const archivedCase = requiredValue(archive.sections.cases.cases[0], 'The exported case fixture is missing.');
  expect(requiredValue(archivedCase.notes[0], 'The exported case note fixture is missing.').body).toBe('Analyst archive note');
  expect(archive.sections.relationshipObservations.observations).toHaveLength(1);
  expect(requiredValue(
    archive.sections.relationshipObservations.observations[0],
    'The exported relationship fixture is missing.',
  ).normalizedValue).toBe('192.0.2.20');
  expect(archive.sections.websiteSnapshots.snapshots).toHaveLength(1);
  expect(archive.sections.websiteSnapshots.snapshots[0]?.domain).toBe('archive-case.invalid');
  expect(archive.sections.investigationTemplates.templates[0]?.label).toBe('Archive review template');
  expect(archive.sections.bulkReview.presets[0]?.name).toBe('Archive priority review');
  expect(archive.sections.bulkReview.rows[0]?.state).toBe('reviewing');
  expect(archive.sections.settings).toMatchObject({ activeProfileId: 'archive-profile', theme: 'light' });
  expect(content).not.toContain('must-not-export');
  expect(content).not.toContain('private.invalid');
  expect(content).not.toContain('wrt_session');
  await expect(page.getByRole('status')).toContainText('Downloaded an unencrypted workspace backup with 12 verified data sections');
});

test('reviewed case evidence keeps the same workspace content through two CLI and browser hand-offs', {
  tag: ['@analyst-journey', '@journey-workspace-portability-review'],
}, async ({ page }) => {
  test.slow();
  const caseExport = {
    version: CASE_SCHEMA_VERSION,
    exportedAt: NOW,
    cases: normalizeCaseStore({
      version: CASE_SCHEMA_VERSION,
      cases: [caseRecord('round-trip-case', 'round-trip.invalid', 'reviewing')],
    }).cases,
  };

  const firstCasePack = await runOfflineCliJson<Record<string, unknown>>([
    'case-pack', '--audience', 'trusted', '--reviewed', '--json',
  ], caseExport);

  await page.goto('/monitor?view=cases');
  await migrateLegacyBrowserData(page, {}, { clearStorage: true });
  await page.locator('.case-toolbar input[type="file"]').setInputFiles({
    name: 'reviewed-case-pack.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(firstCasePack)),
  });
  await expect(page.getByRole('status')).toContainText('Imported 1 new');
  await expect(page.locator('.case-head', { hasText: 'round-trip.invalid' })).toBeVisible();

  await page.goto('/dashboard');
  const firstWebExport = await downloadWorkspaceArchive(page);
  const firstArchive = JSON.parse(firstWebExport.content) as WorkspaceArchiveDocument;
  const firstInspection = await runOfflineCliJson<ArchiveInspectionReport>([
    'inspect-archive', '--json',
  ], firstArchive);
  expect(firstInspection.summary.recordCount).toBeGreaterThanOrEqual(1);

  const secondCasePack = await runOfflineCliJson<Record<string, unknown>>([
    'case-pack', '--audience', 'trusted', '--reviewed', '--json',
  ], firstArchive.sections.cases);

  await migrateLegacyBrowserData(page, {}, { clearStorage: true });
  await page.goto('/monitor?view=cases');
  await page.locator('.case-toolbar input[type="file"]').setInputFiles({
    name: 'reviewed-case-pack-second-pass.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(secondCasePack)),
  });
  await expect(page.getByRole('status')).toContainText('Imported 1 new');
  await expect(page.locator('.case-head', { hasText: 'round-trip.invalid' })).toBeVisible();

  await page.goto('/dashboard');
  const secondWebExport = await downloadWorkspaceArchive(page);
  const secondArchive = JSON.parse(secondWebExport.content) as WorkspaceArchiveDocument;
  const secondInspection = await runOfflineCliJson<ArchiveInspectionReport>([
    'inspect-archive',
    '--expect-content-digest',
    firstInspection.summary.contentDigestSha256,
    '--json',
  ], secondArchive);
  expect(secondInspection.summary.contentDigestSha256).toBe(firstInspection.summary.contentDigestSha256);
  expect(secondArchive.sections.cases.cases).toEqual(firstArchive.sections.cases.cases);
});

test('the dashboard encrypts and locally unlocks a portable workspace backup', async ({ page }) => {
  const passphrase = 'portable archive fixture passphrase';
  await page.goto('/dashboard');
  await seedArchiveWorkspace(page);

  const { download, content } = await downloadEncryptedWorkspaceArchive(page, passphrase);
  expect(download.suggestedFilename()).toMatch(/^whoisleuth-workspace-encrypted-\d{4}-\d{2}-\d{2}\.json$/);
  const envelope = JSON.parse(content) as EncryptedWorkspaceArchiveEnvelope;
  expect(envelope.schema).toBe('whoisleuth.encrypted-workspace-archive');
  expect(envelope.version).toBe(1);
  expect(envelope.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000 });
  expect(envelope.cipher).toMatchObject({ name: 'AES-GCM', keyBits: 256, tagBits: 128 });
  expect(content).not.toContain('archive-case.invalid');
  expect(content).not.toContain('Analyst archive note');
  expect(content).not.toContain(passphrase);
  await expect(page.getByRole('status')).toContainText('Keep the passphrase separately');

  await migrateLegacyBrowserData(page, {}, { clearStorage: true });
  await page.getByLabel('Review backup file').setInputFiles({
    name: 'workspace-encrypted.json',
    mimeType: 'application/json',
    buffer: Buffer.from(content),
  });
  await expect(page.getByRole('status')).toContainText('Encrypted backup selected');
  await page.getByLabel('Backup passphrase').fill('incorrect archive passphrase');
  await page.getByRole('button', { name: 'Unlock and review' }).click();
  await expect(page.getByRole('status')).toContainText('passphrase is incorrect or the encrypted file is corrupted');
  await expect(page.getByLabel('Backup passphrase')).toHaveValue('');

  await page.getByLabel('Backup passphrase').fill(passphrase);
  await page.getByRole('button', { name: 'Unlock and review' }).click();
  const preview = page.locator('.preview');
  await expect(preview.getByRole('heading', { name: 'Choose saved data to add' })).toBeVisible();
  await expect(preview.locator('li')).toHaveCount(12);
  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);
  await preview.getByRole('button', { name: 'Add selected data' }).click();
  const cases = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1, minimumRevision: 2 });
  expect(cases.records.map((record) => record.value.domain)).toContain('archive-case.invalid');
});

test('workspace archive import previews conflicts before a non-destructive mobile-safe merge', {
  tag: ['@analyst-journey', '@journey-workspace-portability-review'],
}, async ({ page }) => {
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
  await expect(preview.locator('li')).toHaveCount(12);
  await expect(preview.locator('li', { hasText: 'Cases' })).toContainText('1 new');
  await expect(preview.locator('li', { hasText: 'Workspace settings' })).toContainText('Ready');
  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);

  await preview.getByRole('button', { name: 'Add selected data' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added backup data from 12 sections' })).toBeVisible();
  const [cases, campaigns, profiles, relationshipObservations, websiteSnapshots, investigationTemplates, bulkReview, settings] = await Promise.all([
    readBrowserLocalCollection(page, 'cases', { minimumRevision: 2 }),
    readBrowserLocalCollection(page, 'campaigns', { minimumRevision: 2 }),
    readBrowserLocalCollection(page, 'brand_profiles', { minimumRevision: 2 }),
    readBrowserLocalCollection(page, 'relationship_observations', { minimumRevision: 2 }),
    readBrowserLocalCollection(page, 'website_snapshots', { minimumRevision: 2 }),
    readBrowserLocalCollection(page, 'investigation_templates', { minimumRevision: 2 }),
    readBrowserLocalCollection(page, 'bulk_review', { minimumRevision: 2 }),
    page.evaluate(() => ({
    activeProfile: localStorage.getItem('whois-rdap-active-brand-profile-v1'),
    theme: localStorage.getItem('whoisleuth:theme:v1'),
    })),
  ]);
  expect(cases.records.map((record) => record.value.domain).sort()).toEqual(['archive-case.invalid', 'local-only.invalid']);
  expect(campaigns.records).toHaveLength(1);
  expect(profiles.records).toHaveLength(1);
  expect(relationshipObservations.records).toHaveLength(1);
  expect(websiteSnapshots.records).toHaveLength(1);
  expect(investigationTemplates.records).toHaveLength(1);
  expect(bulkReview.records).toHaveLength(2);
  expect(settings.activeProfile).toBe('archive-profile');
  expect(settings.theme).toBe('light');
});

test('workspace application skips the same malformed Brand Profile identifiers as preview', async ({ page }) => {
  await page.goto('/dashboard');
  await seedArchiveWorkspace(page);
  const { content } = await downloadWorkspaceArchive(page);
  const archive = JSON.parse(content) as WorkspaceArchiveDocument;
  const profile = archive.sections.brandProfiles.profiles[0] as unknown as Record<string, unknown>;
  profile.id = ' malformed-profile';
  const profileManifest = archive.manifest.sections.find((section) => section.id === 'brandProfiles');
  if (!profileManifest) throw new Error('The workspace fixture is missing its Brand Profiles manifest.');
  profileManifest.bytes = new TextEncoder().encode(JSON.stringify(archive.sections.brandProfiles)).byteLength;
  profileManifest.checksum = await sha256ArtifactDigest(archive.sections.brandProfiles);

  await migrateLegacyBrowserData(page, {}, { clearStorage: true });
  await page.getByLabel('Review backup file').setInputFiles({
    name: 'workspace-malformed-profile.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(archive)),
  });
  const preview = page.locator('.preview');
  const profiles = preview.locator('li', { hasText: 'Brand Profiles' });
  const settings = preview.locator('li', { hasText: 'Workspace settings' });
  await expect(profiles).toContainText('1 skipped');
  await expect(settings).toContainText('1 skipped');
  for (const checkbox of await preview.getByRole('checkbox').all()) {
    if (await checkbox.isChecked()) await checkbox.uncheck();
  }
  await profiles.getByRole('checkbox').check();
  await settings.getByRole('checkbox').check();
  await preview.getByRole('button', { name: 'Add selected data' }).click();

  const storedProfiles = await readBrowserLocalCollection(page, 'brand_profiles');
  expect(storedProfiles.records).toHaveLength(0);
  expect(await page.evaluate(() => localStorage.getItem('whois-rdap-active-brand-profile-v1'))).toBeNull();
});

test('workspace Settings preview and application preserve the active profile when imported Profiles are deselected', async ({ page }) => {
  await page.goto('/dashboard');
  await seedArchiveWorkspace(page);
  const { content } = await downloadWorkspaceArchive(page);
  await migrateLegacyBrowserData(page, {
    'whois-rdap-brand-profiles-v1': { version: 6, profiles: [profile('local-profile', 'Local retained profile')] },
    'whois-rdap-active-brand-profile-v1': 'local-profile',
  }, { clearStorage: true });
  await page.getByLabel('Review backup file').setInputFiles({
    name: 'workspace-settings-with-profile.json',
    mimeType: 'application/json',
    buffer: Buffer.from(content),
  });

  const preview = page.locator('.preview');
  const profiles = preview.locator('li', { hasText: 'Brand Profiles' });
  const settings = preview.locator('li', { hasText: 'Workspace settings' });
  await expect(settings).toContainText('0 skipped');
  await profiles.getByRole('checkbox').uncheck();
  await expect(settings).toContainText('1 skipped');
  await expect(settings).toContainText('not available in the selected Profile data or the current browser');
  for (const checkbox of await preview.getByRole('checkbox').all()) {
    const isSettings = await checkbox.evaluate((element) => (
      element.closest('li')?.textContent?.includes('Workspace settings') === true
    ));
    if (await checkbox.isChecked() && !isSettings) {
      await checkbox.uncheck();
    }
  }
  if (!await settings.getByRole('checkbox').isChecked()) await settings.getByRole('checkbox').check();
  await preview.getByRole('button', { name: 'Add selected data' }).click();

  await expect(page.getByRole('status').filter({ hasText: '1 skipped' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('whois-rdap-active-brand-profile-v1'))).toBe('local-profile');
  const storedProfiles = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  expect(storedProfiles.records.map((record) => record.value.name)).toEqual(['Local retained profile']);
});

test('workspace Settings application preserves malformed active-profile values and honors an exact clear', async ({ page }) => {
  await page.goto('/dashboard');
  await seedArchiveWorkspace(page);
  const { content } = await downloadWorkspaceArchive(page);
  const sourceArchive = JSON.parse(content) as WorkspaceArchiveDocument;
  await migrateLegacyBrowserData(page, {
    'whois-rdap-brand-profiles-v1': { version: 6, profiles: [profile('local-profile', 'Local retained profile')] },
    'whois-rdap-active-brand-profile-v1': 'local-profile',
    'whoisleuth:theme:v1': 'dark',
  }, { clearStorage: true });

  const importOnlySettings = async (archive: WorkspaceArchiveDocument, filename: string) => {
    await page.getByLabel('Review backup file').setInputFiles({
      name: filename,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(archive)),
    });
    const preview = page.locator('.preview');
    const settings = preview.locator('li', { hasText: 'Workspace settings' });
    await expect(settings.getByRole('checkbox')).toBeVisible();
    for (const checkbox of await preview.getByRole('checkbox').all()) {
      const isSettings = await checkbox.evaluate((element) => (
        element.closest('li')?.textContent?.includes('Workspace settings') === true
      ));
      if (await checkbox.isChecked() && !isSettings) await checkbox.uncheck();
    }
    if (!await settings.getByRole('checkbox').isChecked()) await settings.getByRole('checkbox').check();
    return { preview, settings };
  };

  const malformed = structuredClone(sourceArchive);
  malformed.sections.settings.activeProfileId = ' malformed-profile';
  const malformedEntry = malformed.manifest.sections.find((section) => section.id === 'settings');
  if (!malformedEntry) throw new Error('The workspace fixture is missing its Settings manifest.');
  malformedEntry.bytes = new TextEncoder().encode(JSON.stringify(malformed.sections.settings)).byteLength;
  malformedEntry.checksum = await sha256ArtifactDigest(malformed.sections.settings);
  const malformedPreview = await importOnlySettings(malformed, 'workspace-settings-malformed.json');
  await expect(malformedPreview.settings).toContainText('1 skipped');
  await expect(malformedPreview.settings).toContainText('missing or malformed');
  await malformedPreview.preview.getByRole('button', { name: 'Add selected data' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 skipped' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('whois-rdap-active-brand-profile-v1'))).toBe('local-profile');
  expect(await page.evaluate(() => localStorage.getItem('whoisleuth:theme:v1'))).toBe('light');

  const clear = structuredClone(sourceArchive);
  clear.sections.settings.activeProfileId = '';
  const clearEntry = clear.manifest.sections.find((section) => section.id === 'settings');
  if (!clearEntry) throw new Error('The workspace fixture is missing its Settings manifest.');
  clearEntry.bytes = new TextEncoder().encode(JSON.stringify(clear.sections.settings)).byteLength;
  clearEntry.checksum = await sha256ArtifactDigest(clear.sections.settings);
  const clearPreview = await importOnlySettings(clear, 'workspace-settings-clear.json');
  await expect(clearPreview.settings).toContainText('0 skipped');
  await clearPreview.preview.getByRole('button', { name: 'Add selected data' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added backup data from 1 sections:' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('whois-rdap-active-brand-profile-v1'))).toBeNull();
  const storedProfiles = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  expect(storedProfiles.records.map((record) => record.value.id)).toEqual(['local-profile']);
});

test('workspace identifier collisions cannot rebind Cases or the active-profile setting', async ({ page }) => {
  await page.goto('/dashboard');
  await seedArchiveWorkspace(page);
  const { content } = await downloadWorkspaceArchive(page);
  await migrateLegacyBrowserData(page, {
    'whois-rdap-brand-profiles-v1': { version: 6, profiles: [profile('archive-profile', 'Local distinct profile')] },
    'whois-rdap-cases-v1': { version: 12, cases: [{ ...caseRecord('local-collision-case', 'local-collision.invalid', 'new'), brandProfileIds: ['archive-profile'] }] },
  }, { clearStorage: true });
  await page.getByLabel('Review backup file').setInputFiles({
    name: 'workspace-profile-collision.json',
    mimeType: 'application/json',
    buffer: Buffer.from(content),
  });

  const preview = page.locator('.preview');
  const profiles = preview.locator('li', { hasText: 'Brand Profiles' });
  const cases = preview.locator('li', { hasText: 'Cases' });
  const settings = preview.locator('li', { hasText: 'Workspace settings' });
  await expect(profiles).toContainText('Blocked');
  await expect(cases).toContainText('Blocked');
  await expect(settings).toContainText('Blocked');
  expect(await profiles.locator('.state').evaluate((element) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--danger)';
    document.body.append(probe);
    const matches = getComputedStyle(element).color === getComputedStyle(probe).color;
    probe.remove();
    return matches;
  })).toBe(true);
  await expect(profiles.getByRole('checkbox')).toBeDisabled();
  await expect(cases.getByRole('checkbox')).toBeDisabled();
  await expect(settings.getByRole('checkbox')).toBeDisabled();

  for (const checkbox of await preview.getByRole('checkbox').all()) {
    if (await checkbox.isChecked()) await checkbox.uncheck();
  }
  await preview.locator('li', { hasText: 'Campaigns' }).getByRole('checkbox').check();
  await preview.getByRole('button', { name: 'Add selected data' }).click();
  const [storedProfiles, storedCases, activeProfile] = await Promise.all([
    readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 }),
    readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 }),
    page.evaluate(() => localStorage.getItem('whois-rdap-active-brand-profile-v1')),
  ]);
  expect(storedProfiles.records[0]?.value.name).toBe('Local distinct profile');
  expect(storedCases.records[0]?.value.brandProfileIds).toEqual(['archive-profile']);
  expect(activeProfile).toBeNull();
});

test('workspace archive import reports future sections and rolls back an interrupted merge', async ({ page }) => {
  await page.goto('/dashboard');
  await seedArchiveWorkspace(page);
  const { content } = await downloadWorkspaceArchive(page);
  const future = JSON.parse(content) as WorkspaceArchiveDocument;
  const futureWatchlistManifest = future.manifest.sections.find((section) => section.id === 'watchlists');
  if (!futureWatchlistManifest) throw new Error('The workspace fixture is missing its watchlists manifest.');
  Reflect.set(future.sections.watchlists, 'version', 999);
  futureWatchlistManifest.version = 999;
  futureWatchlistManifest.bytes = new TextEncoder().encode(JSON.stringify(future.sections.watchlists)).byteLength;
  futureWatchlistManifest.checksum = await sha256ArtifactDigest(future.sections.watchlists);
  await page.getByLabel('Review backup file').setInputFiles({ name: 'future.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(future)) });
  const futureWatchlists = page.locator('.preview li', { hasText: 'Watchlists' });
  await expect(futureWatchlists).toContainText('Unsupported');
  await expect(futureWatchlists.getByRole('checkbox')).toBeDisabled();
  expect(await futureWatchlists.evaluate((element) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--muted)';
    document.body.append(probe);
    const result = {
      borderStyle: getComputedStyle(element).borderStyle,
      colourMatches: getComputedStyle(element.querySelector('.state')!).color === getComputedStyle(probe).color,
    };
    probe.remove();
    return result;
  })).toEqual({ borderStyle: 'dotted', colourMatches: true });

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
  const domains = (await readBrowserLocalCollection(page, 'cases')).records.map((record) => record.value.domain);
  expect(domains).toEqual(['rollback.invalid']);
});

test('workspace rollback preserves a settings value changed after the import begins', async ({ page }) => {
  await page.goto('/dashboard');
  await seedArchiveWorkspace(page);
  const { content } = await downloadWorkspaceArchive(page);
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: 2, cases: [{
      id: 'settings-rollback-case', domain: 'settings-rollback.invalid', status: 'new', disposition: 'unreviewed', tags: [], notes: [],
      source: 'manual', evidenceHistory: [], createdAt: NOW, updatedAt: NOW,
    }] },
    'whoisleuth:theme:v1': 'dark',
  }, { clearStorage: true });
  await page.getByLabel('Review backup file').setInputFiles({ name: 'workspace.json', mimeType: 'application/json', buffer: Buffer.from(content) });
  const preview = page.locator('.preview');
  for (const checkbox of await preview.getByRole('checkbox').all()) {
    if (await checkbox.isChecked()) await checkbox.uncheck();
  }
  await preview.locator('li', { hasText: 'Cases' }).getByRole('checkbox').check();
  await preview.locator('li', { hasText: 'Workspace settings' }).getByRole('checkbox').check();
  await page.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (key === 'whoisleuth:theme:v1' && value === 'light') {
        originalSetItem.call(this, key, 'system');
        throw new DOMException('A concurrent settings update won the import race.', 'QuotaExceededError');
      }
      originalSetItem.call(this, key, value);
    };
  });
  await preview.getByRole('button', { name: 'Add selected data' }).click();

  await expect(page.getByRole('status')).toContainText('could not be fully restored');
  expect(await page.evaluate(() => localStorage.getItem('whoisleuth:theme:v1'))).toBe('system');
  const domains = (await readBrowserLocalCollection(page, 'cases')).records.map((record) => record.value.domain);
  expect(domains).toEqual(['settings-rollback.invalid']);
});
