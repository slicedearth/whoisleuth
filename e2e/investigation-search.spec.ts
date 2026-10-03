import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import { expect, test } from './fixtures';
import { currentBrandProfileBrowserStore, currentBrowserLocalDocument, expectFocusedResultsVisible, expectNoHorizontalOverflow, failBrowserLocalCollectionReads, failBrowserLocalReads, holdBrowserLocalReads, migrateLegacyBrowserData, openDashboardSecondaryWorkspaces, readBrowserLocalCollection, useTheme } from './helpers';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
import { productionChunkPath } from './production-build';
import { normalizeCaseStore } from '../packages/cases/case-migration-model.mts';
import { serializeCaseStore } from '../packages/cases/case-storage-model.mts';
import { MAX_CASE_STORE_BYTES } from '../packages/contracts/case-portability.mts';
import { readFile } from 'node:fs/promises';
import { parseInfrastructureObservation } from '../packages/investigation/infrastructure-observation.mts';
import { convertInfrastructureObservation } from '../packages/interchange/external-findings-converters.mts';
import { externalFindingCaseProjection } from '../packages/interchange/external-findings-import.mts';

const NOW = '2026-07-19T00:00:00.000Z';

function caseRecord(id: string, domain: string) {
  return {
    id,
    domain,
    status: 'reviewing',
    disposition: 'unreviewed',
    tags: [],
    notes: [],
    source: 'lookup',
    evidenceHistory: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function campaign(id: string, name: string, domains: string[] = []) {
  return { id, name, description: '', domains, createdAt: NOW, updatedAt: NOW };
}

function profile(id: string, name: string, officialDomains: string[] = []) {
  return {
    id,
    name,
    officialDomains,
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

async function seedInvestigationStores(page: import('@playwright/test').Page) {
  await page.goto('/dashboard');
  const cases = [caseRecord('case-source', 'candidate.invalid')];
  const campaigns = [campaign('campaign-source', 'Priority review', ['candidate.invalid'])];
  const profiles = [
      ...Array.from({ length: 12 }, (_, index) => profile(`profile-${index + 1}`, `Profile ${index + 1}`)),
      profile('profile-source', 'Reserved identity', ['official.invalid']),
  ];
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases },
    'whoisleuth-campaigns-v1': currentBrowserLocalDocument('campaigns', { campaigns }),
    'whois-rdap-brand-profiles-v1': currentBrandProfileBrowserStore(profiles),
  });
  await openDashboardSecondaryWorkspaces(page);
}

test('multi-host snapshot review exposes exact outcomes, wildcards and history without automatic collection', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/') && !['/api/session', '/api/capabilities'].includes(path)) requests.push(path); });
  const early = parseInfrastructureObservation(await readFile('test/fixtures/infrastructure-observations/infrastructure-observation-v1.json', 'utf8'));
  const later = structuredClone(early); later.id = 'selected-example-later'; later.observedAt = '2026-10-02T12:00:00.000Z'; later.coverage.state = 'partial'; later.dns[2] = { ...later.dns[2]!, values: [], outcome: 'failed', complete: false };
  const pins = [early, later].map((snapshot, index) => { const document = convertInfrastructureObservation(snapshot); return { ...externalFindingCaseProjection(document.findings[0]!, document.source).evidencePin, id: `snapshot-pin-${index}` }; });
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: [{ ...caseRecord('snapshot-case', 'example.test'), evidencePins: pins }] } });
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  await openDashboardSecondaryWorkspaces(page);
  await page.getByText('Browse retained infrastructure', { exact: true }).click();
  const snapshots = page.getByRole('region', { name: 'Source-qualified infrastructure snapshots', exact: true });
  await expect(snapshots).toContainText('2 admitted source-qualified snapshots');
  await snapshots.getByRole('checkbox', { name: /^selected-example-early/u }).check();
  const exact = snapshots.getByRole('region', { name: 'Exact snapshot selected-example-early', exact: true });
  await expect(exact.getByRole('link', { name: 'Prepare Lookup for www.example.test', exact: true })).toHaveAttribute('href', '/lookup?q=www.example.test#query');
  await exact.getByText('1 certificate observations, exact names and wildcard patterns', { exact: true }).click();
  await expect(exact).toContainText('*.example.test · Wildcard pattern, not an enumerated host');
  await expect(exact.getByRole('checkbox', { name: '*.example.test', exact: true })).toHaveCount(0);
  await snapshots.getByRole('checkbox', { name: /^selected-example-later/u }).check();
  const comparison = snapshots.getByRole('region', { name: 'Infrastructure snapshot comparison', exact: true });
  await expect(comparison).toContainText('Comparison · partial'); await expect(comparison).toContainText('unknown'); await expect(comparison).toContainText('failed');
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme); await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) {
        await snapshots.scrollIntoViewIfNeeded();
        await page.screenshot({ path: test.info().outputPath(`snapshot-review-${theme}-${width}.png`) });
      }
    }
  }
  expect(await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).toEqual(before);
  expect(requests).toEqual([]);
});

test('retained infrastructure exposes exact independent sources and keyboard return without collection', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/') && !['/api/session', '/api/capabilities'].includes(path)) requests.push(path);
  });
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: [
    caseRecord('inventory-first', 'shared.example'),
    { ...caseRecord('inventory-second', 'shared.example'), updatedAt: '2026-07-20T00:00:00.000Z' },
  ] } });
  await openDashboardSecondaryWorkspaces(page);
  await page.getByText('Browse retained infrastructure', { exact: true }).click();
  const inventory = page.getByRole('region', { name: 'Retained infrastructure inventory', exact: true });
  const rows = inventory.getByRole('list', { name: 'Retained infrastructure identities', exact: true });
  await expect(rows.getByRole('listitem')).toHaveCount(1);
  await expect(rows.getByText('2 observations · 2 one-hop relationships', { exact: true })).toBeVisible();
  const inspect = rows.getByRole('button', { name: 'Inspect retained evidence for shared.example', exact: true });
  await inspect.focus(); await inspect.press('Enter');
  const detail = inventory.getByRole('region', { name: 'Selected retained infrastructure evidence', exact: true });
  await expect(detail.getByRole('heading', { name: 'Retained evidence for shared.example', exact: true })).toBeFocused();
  await expect(detail.getByRole('heading', { name: '2 retained observations', exact: true })).toBeVisible();
  await expect(detail.getByRole('heading', { name: '2 one-hop relationships', exact: true })).toBeVisible();
  await expect(detail.getByRole('list', { name: 'Retained relationship sources', exact: true }).getByRole('listitem')).toHaveCount(2);
  for (const href of await detail.locator('a').evaluateAll(elements => elements.map(element => element.getAttribute('href')))) expect(href).toMatch(/^\/monitor\?case=/u);
  for (const width of [1920, 1280, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      await expectNoHorizontalOverflow(page);
      await expect(detail.getByRole('heading', { name: '2 one-hop relationships', exact: true })).toBeVisible();
      if (captureVisualEvidenceEnabled()) {
        await detail.evaluate(element => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 140, behavior: 'instant' }));
        await page.screenshot({ path: test.info().outputPath(`infrastructure-${theme}-${width}.png`) });
      }
    }
  }
  await detail.getByRole('button', { name: 'Return to inventory results', exact: true }).click();
  await expect(inspect).toBeFocused();
  expect(requests).toEqual([]);
});

test('optional retained topology preserves full source list, long identity pivots and accessible mobile fallback', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/') && !['/api/session', '/api/capabilities'].includes(path)) requests.push(path);
  });
  const prefix = 'a'.repeat(63), first = `${prefix}.one.topology.example`, second = `${prefix}.two.topology.example`;
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: [caseRecord('topology-first', first), caseRecord('topology-independent', first), caseRecord('topology-second', second)] },
    'whoisleuth-campaigns-v1': currentBrowserLocalDocument('campaigns', { campaigns: [campaign('topology-campaign', 'Long-name topology review', [first, second])] }),
  });
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 3 });
  const campaignsBefore = await readBrowserLocalCollection(page, 'campaigns', { minimumRecords: 1 });
  await openDashboardSecondaryWorkspaces(page);
  await page.getByText('Browse retained infrastructure', { exact: true }).click();
  const inventory = page.getByRole('region', { name: 'Retained infrastructure inventory', exact: true });
  const inspect = inventory.getByRole('list', { name: 'Retained infrastructure identities', exact: true }).getByRole('button', { name: `Inspect retained evidence for ${first}`, exact: true });
  await inspect.click();
  const detail = inventory.getByRole('region', { name: 'Selected retained infrastructure evidence', exact: true });
  const relationships = detail.getByRole('region', { name: 'Directly supported retained relationships', exact: true });
  const sourceList = relationships.getByRole('list', { name: 'Retained relationship sources', exact: true });
  await expect(sourceList.getByRole('listitem')).toHaveCount(3);
  const toggle = relationships.getByRole('button', { name: 'Topology and list', exact: true });
  await toggle.focus(); await toggle.press('Enter');
  await expect(toggle).toBeFocused(); await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(relationships.getByRole('region', { name: 'Retained one-hop topology', exact: true })).toBeVisible();
  await expect(sourceList.getByRole('listitem')).toHaveCount(3);
  await relationships.getByRole('searchbox', { name: 'Search complete retained topology', exact: true }).fill('no-diagram-match');
  await expect(relationships).toContainText('No admitted relationships match this diagram search');
  await expect(sourceList.getByRole('listitem')).toHaveCount(3);
  await expect(sourceList.getByRole('link')).toHaveCount(3);
  await relationships.getByRole('searchbox', { name: 'Search complete retained topology', exact: true }).fill('');
  const initialFocus = relationships.getByRole('combobox', { name: 'Focus diagram identity', exact: true });
  const campaignOption = (await initialFocus.locator('option').allTextContents()).find(value => value.includes('topology-campaign · campaign'));
  expect(campaignOption).toBeDefined();
  await initialFocus.selectOption({ label: campaignOption! });
  await relationships.getByRole('button', { name: 'Show exact source rows for topology-campaign', exact: true }).click();
  await expect(sourceList.locator('li.highlighted')).toHaveCount(1);
  await expect(sourceList.locator('li.highlighted')).toBeFocused();
  await relationships.getByRole('button', { name: 'Inspect retained evidence for topology-campaign', exact: true }).click();
  await expect(detail.getByRole('heading', { name: 'Retained evidence for Long-name topology review', exact: true })).toBeFocused();
  await relationships.getByRole('button', { name: 'Topology and list', exact: true }).click();
  const focus = relationships.getByRole('combobox', { name: 'Focus diagram identity', exact: true });
  const options = await focus.locator('option').allTextContents();
  expect(options.filter(value => value.includes(first))).toHaveLength(1);
  expect(options.filter(value => value.includes(second))).toHaveLength(1);
  await focus.selectOption({ label: options.find(value => value.includes(second))! });
  await expect(relationships.locator('.topology-controls > p').filter({ hasText: 'Focused identity [' })).toContainText(`${second} · domain`);
  await relationships.getByRole('button', { name: `Show exact source rows for ${second}`, exact: true }).click();
  await expect(sourceList.locator('li.highlighted').first()).toBeFocused();
  const map = relationships.getByRole('region', { name: 'Retained one-hop topology', exact: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(map.locator('.map-frame svg')).toBeVisible();
  await expect(map.locator('path[marker-end]')).toHaveCount(5);
  await map.locator('.map-frame').scrollIntoViewIfNeeded();
  const box = await map.locator('.map-frame').boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, Math.max(10, Math.min(700, box!.y + box!.height / 2)));
  const previousScroll = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 240);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(previousScroll);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 1920, 2560]) {
      await page.setViewportSize({ width, height: 844 });
      await expectNoHorizontalOverflow(page);
      if (width < 660) {
        await expect(map.locator('.map-frame')).toBeHidden();
        await expect(map.locator('.map-mobile')).toBeVisible();
      }
      if (captureVisualEvidenceEnabled()) await test.info().attach(`retained-topology-${width}-${theme}`, {
        body: await relationships.locator('.topology-controls').screenshot(), contentType: 'image/png',
      });
    }
  }
  await relationships.getByRole('button', { name: 'List only', exact: true }).click();
  await expect(map).toHaveCount(0);
  await expect(sourceList.getByRole('listitem')).toHaveCount(5);
  await sourceList.getByRole('button', { name: `Inspect retained evidence for ${second}`, exact: true }).first().click();
  await expect(detail.getByRole('heading', { name: `Retained evidence for ${second}`, exact: true })).toBeFocused();
  expect(await readBrowserLocalCollection(page, 'cases', { minimumRecords: 3 })).toEqual(before);
  expect(await readBrowserLocalCollection(page, 'campaigns', { minimumRecords: 1 })).toEqual(campaignsBefore);
  expect(requests).toEqual([]);
});

test('retained topology keeps dense source pages complete and resets diagram search on paging', async ({ page }) => {
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION,
    cases: Array.from({ length: 53 }, (_, index) => caseRecord(`dense-case-${String(index).padStart(3, '0')}`, 'dense-topology.example')),
  } });
  await openDashboardSecondaryWorkspaces(page);
  await page.getByText('Browse retained infrastructure', { exact: true }).click();
  const inventory = page.getByRole('region', { name: 'Retained infrastructure inventory', exact: true });
  await inventory.getByRole('combobox', { name: 'Infrastructure type', exact: true }).selectOption('domain');
  await inventory.getByRole('list', { name: 'Retained infrastructure identities', exact: true }).getByRole('button', { name: 'Inspect retained evidence for dense-topology.example', exact: true }).click();
  const relationships = inventory.getByRole('region', { name: 'Directly supported retained relationships', exact: true });
  const sources = relationships.getByRole('list', { name: 'Retained relationship sources', exact: true });
  await expect(sources.getByRole('listitem')).toHaveCount(50);
  await relationships.getByRole('button', { name: 'Topology and list', exact: true }).click();
  await expect(relationships.getByRole('region', { name: 'Retained one-hop topology', exact: true })).toContainText('Partial visual');
  await expect(sources.getByRole('listitem')).toHaveCount(50);
  if (captureVisualEvidenceEnabled()) {
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      for (const width of [320, 390, 1024, 1280, 1920, 2560]) {
        await page.setViewportSize({ width, height: 844 });
        await test.info().attach(`retained-topology-dense-${width}-${theme}`, {
          body: await relationships.locator('.topology-controls').screenshot(), contentType: 'image/png',
        });
      }
    }
  }
  const search = relationships.getByRole('searchbox', { name: 'Search complete retained topology', exact: true });
  await search.fill('no-current-page-diagram-match');
  await expect(relationships).toContainText('No admitted relationships match this diagram search');
  await expect(sources.getByRole('listitem')).toHaveCount(50);
  await search.fill('dense-case-052');
  await expect(relationships.getByRole('region', { name: 'Retained one-hop topology', exact: true })).toBeVisible();
  await expect(relationships.getByRole('region', { name: 'Retained one-hop topology', exact: true }).locator('path[marker-end]')).toHaveCount(1);
  const pages = relationships.getByRole('navigation', { name: 'Retained relationship pages', exact: true });
  await pages.getByRole('button', { name: 'Next', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(pages.getByText('Page 2 of 2', { exact: true })).toBeVisible();
  await expect(relationships.getByRole('heading', { name: '53 one-hop relationships', exact: true })).toBeFocused();
  await expect(search).toHaveValue('dense-case-052');
  await expect(sources.getByRole('listitem')).toHaveCount(3);
  const map = relationships.getByRole('region', { name: 'Retained one-hop topology', exact: true });
  await expect(map.locator('path[marker-end]')).toHaveCount(1);
  await expect(relationships).toContainText('Source page 2 of 2 · 3 rows shown');
  await expect(sources.getByRole('link')).toHaveCount(3);
});

test('main search and infrastructure filters settle independently while a worker operation is held', async ({ page }) => {
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION,
    cases: [caseRecord('concurrent-views', 'shared.example')],
  } });
  const probe = await page.evaluateHandle(() => {
    const NativeWorker = window.Worker;
    let held: (() => void) | undefined;
    let hold = true;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (options?.name !== 'saved-work-search') return;
        const post = this.postMessage.bind(this);
        this.postMessage = (message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) => {
          const send = () => { if (Array.isArray(transfer)) post(message, transfer); else post(message, transfer); };
          if (hold && typeof message === 'object' && message !== null && 'kind' in message && message.kind === 'infrastructure') {
            hold = false; held = send;
          } else send();
        };
      }
    };
    return { held: () => Boolean(held), release: () => { const send = held; held = undefined; send?.(); },
      restore: () => { const send = held; held = undefined; send?.(); window.Worker = NativeWorker; } };
  });
  try {
    await openDashboardSecondaryWorkspaces(page);
    await page.getByText('Browse retained infrastructure', { exact: true }).click();
    await expect.poll(() => probe.evaluate(value => value.held())).toBe(true);
    await page.getByRole('searchbox', { name: 'Search saved work', exact: true }).fill('shared.example');
    const inventory = page.getByRole('region', { name: 'Retained infrastructure inventory', exact: true });
    await inventory.getByRole('searchbox', { name: 'Search retained infrastructure', exact: true }).fill('shared.example');
    await probe.evaluate(value => value.release());
    await expect(page.getByRole('list', { name: 'Local investigation search results' })).toContainText('shared.example');
    await expect(inventory.getByRole('list', { name: 'Retained infrastructure identities' })).toContainText('shared.example');
    await expect(inventory.getByRole('alert')).toHaveCount(0);
  } finally { await probe.evaluate(value => value.restore()); await probe.dispose(); }
});

test('retained infrastructure filters before pagination and exposes every admitted match', async ({ page }) => {
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION,
    cases: Array.from({ length: 123 }, (_, index) => caseRecord(`inventory-${index}`, `target-${index}.example`)),
  } });
  await openDashboardSecondaryWorkspaces(page);
  await page.getByText('Browse retained infrastructure', { exact: true }).click();
  const inventory = page.getByRole('region', { name: 'Retained infrastructure inventory', exact: true });
  await inventory.getByRole('combobox', { name: 'Infrastructure type', exact: true }).selectOption('domain');
  await inventory.getByRole('searchbox', { name: 'Search retained infrastructure', exact: true }).fill('target-');
  const rows = inventory.getByRole('list', { name: 'Retained infrastructure identities', exact: true });
  const pages = inventory.getByRole('navigation', { name: 'Retained infrastructure pages', exact: true });
  await expect(rows.getByRole('listitem')).toHaveCount(50);
  await expect(pages.getByText('Page 1 of 3', { exact: true })).toBeVisible();
  await pages.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(pages.getByText('Page 2 of 3', { exact: true })).toBeVisible();
  await expect(rows.getByRole('listitem')).toHaveCount(50);
  await pages.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(pages.getByText('Page 3 of 3', { exact: true })).toBeVisible();
  await expect(rows.getByRole('listitem')).toHaveCount(23);
  await expect(inventory.getByRole('heading', { name: 'Retained infrastructure inventory', exact: true })).toBeFocused();
});

test('dashboard local search pivots to exact cases, campaigns, and brand profiles without scanning', async ({ page }) => {
  const lookupRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/lookup') lookupRequests.push(request.url());
  });
  await seedInvestigationStores(page);

  const search = page.getByRole('searchbox', { name: 'Search saved work' });
  await expect(page.getByRole('list', { name: 'Local investigation search results' })).toHaveCount(0);
  await search.fill('candidate.invalid');
  const caseResult = page.locator('.result-card').filter({ hasText: 'Case' }).filter({ hasText: 'candidate.invalid' });
  await caseResult.getByRole('link', { name: /Open case/ }).click();
  await expect(page).toHaveURL('/cases?case=case-source', { timeout: 15_000 });
  await expect(page.locator('.case-heading', { hasText: 'candidate.invalid' })).toBeVisible();

  await page.goto('/dashboard');
  await openDashboardSecondaryWorkspaces(page);
  await page.getByRole('searchbox', { name: 'Search saved work' }).fill('Priority review');
  await page.getByRole('link', { name: /Open campaign/ }).click();
  await expect(page).toHaveURL('/monitor?view=campaigns&campaign=campaign-source', { timeout: 15_000 });
  await expect(page.locator('.campaign-head', { hasText: 'Priority review' })).toHaveAttribute('aria-expanded', 'true');

  await page.goto('/dashboard');
  await openDashboardSecondaryWorkspaces(page);
  await page.getByRole('searchbox', { name: 'Search saved work' }).fill('Reserved identity');
  await page.getByRole('link', { name: /Open profile/ }).click();
  await expect(page).toHaveURL('/brands?profile=profile-source', { timeout: 15_000 });
  const focusedProfile = page.locator('#profile-profile-source');
  await expect(focusedProfile).toBeVisible();
  await expect(focusedProfile).toHaveClass(/focused/);
  await expect(focusedProfile.getByText('Search result')).toBeVisible();
  expect(lookupRequests).toEqual([]);
});

test('dashboard local search exposes future-store limitations without indexing future values', async ({ page }) => {
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: 99, cases: [caseRecord('future-case', 'future.invalid')] },
  });

  await expect(page.getByRole('heading', { name: 'Browser-local data unavailable' })).toBeVisible();
  await expect(page.getByText(/created by a newer app version/)).toBeVisible();
  await expect(page.getByText('future-case', { exact: true })).toHaveCount(0);
});

test('saved-work history keeps independent incidents navigable without starting collection', async ({ page }) => {
  const collections: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/lookup') collections.push(request.url());
  });
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: [
      caseRecord('incident-first', 'shared.example'),
      { ...caseRecord('incident-second', 'shared.example'), updatedAt: '2026-07-20T00:00:00.000Z' },
    ] },
  });
  await openDashboardSecondaryWorkspaces(page);
  await page.getByRole('searchbox', { name: 'Search saved work' }).fill('shared.example');
  const result = page.locator('.result-card').filter({ has: page.locator('.type-badge', { hasText: /^Domain$/u }) });
  await expect(result).toHaveCount(1);
  await result.getByText('Retained history', { exact: true }).click();
  const history = result.getByRole('region', { name: 'Retained observation history' });
  await expect(history.getByRole('heading', { name: '2 retained observations' })).toBeVisible();
  await expect(history.getByRole('link', { name: 'Open source case' })).toHaveCount(2);
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      await expect(history.getByRole('heading', { name: '2 retained observations' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) await test.info().attach(`retained-history-${viewport.width}-${theme}`, {
        body: await result.screenshot(), contentType: 'image/png',
      });
    }
  }
  const source = history.locator('a[href="/monitor?case=incident-first"]');
  await source.focus();
  await expect(source).toBeFocused();
  await source.press('Enter');
  await expect(page).toHaveURL('/cases?case=incident-first');
  await expect(page.locator('.case-heading', { hasText: 'shared.example' })).toBeVisible();
  expect(collections).toEqual([]);
});

test('dashboard local search remains usable without horizontal overflow on narrow mobile screens', async ({ page }) => {
  await seedInvestigationStores(page);
  await page.setViewportSize({ width: 320, height: 700 });
  const search = page.getByRole('searchbox', { name: 'Search saved work' });
  const placeholderFit = await search.evaluate((element: HTMLInputElement) => {
    const style = getComputedStyle(element);
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return { availableWidth: 0, textWidth: Number.POSITIVE_INFINITY };
    context.font = style.font;
    return {
      availableWidth: element.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight),
      textWidth: context.measureText(element.placeholder).width,
    };
  });
  expect(placeholderFit.availableWidth).toBeGreaterThanOrEqual(placeholderFit.textWidth);
  await search.fill('candidate.invalid');
  await expect(page.locator('.result-card').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('link', { name: 'Open case', exact: true }).focus();
  await expect(page.getByRole('link', { name: 'Open case', exact: true })).toBeFocused();
});

test('dashboard local search reports an unavailable store without remaining in a loading state', async ({ page }) => {
  await page.goto('/bulk');
  await expect(page.locator('#domains')).toBeEditable();
  await failBrowserLocalReads(page);
  await page.locator('#console-navigation').getByRole('link', { name: /^Dashboard/u }).click();

  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.summary-error')).toContainText(
    'One or more required saved collections are unavailable.',
    { timeout: 15_000 },
  );
  await expect(page.getByRole('navigation', { name: 'New investigation', exact: true })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search saved work' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Preparing your Dashboard' })).toHaveCount(0);
});

test('dashboard distinguishes pending counts from unavailable collections', async ({ page }) => {
  await page.goto('/bulk');
  await expect(page.locator('#domains')).toBeEditable();
  await holdBrowserLocalReads(page, 4_000, '#console-navigation a[href="/dashboard"]');

  const pending = page.locator('section.dashboard-state[aria-busy="true"]');
  await expect(pending.getByRole('heading', { name: 'Preparing your Dashboard' })).toBeVisible();
  await expect(pending).not.toContainText('Unavailable');
  await expect(pending).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Get started' })).toBeVisible();
});

test('dashboard preserves fulfilled counts and search when one local collection is unavailable', async ({ page }) => {
  await seedInvestigationStores(page);
  await page.locator('#console-navigation').getByRole('link', { name: /^Bulk/u }).click();
  await failBrowserLocalCollectionReads(page, 'watchlists');
  await page.locator('#console-navigation').getByRole('link', { name: /^Dashboard/u }).click();
  await openDashboardSecondaryWorkspaces(page);

  const recent = page.getByRole('region', { name: 'Recent Cases', exact: true });
  await expect(recent.getByRole('listitem')).toHaveCount(1);
  await expect(recent.getByRole('link', { name: /^Watchlists/ })).toContainText('Unavailable');
  await expect(recent.getByRole('link', { name: /^Brand profiles/ })).toContainText('13');
  await expect(page.locator('.summary-error')).toContainText('Available saved work is still shown');

  await page.getByRole('searchbox', { name: 'Search saved work' }).fill('candidate.invalid');
  await expect(page.getByRole('link', { name: 'Open case', exact: true })).toBeVisible();
});

test('dashboard search retains matches and discloses one unavailable search provider through no-match states', async ({ page }) => {
  await seedInvestigationStores(page);
  await page.locator('#console-navigation').getByRole('link', { name: /^Bulk/u }).click();
  await failBrowserLocalCollectionReads(page, 'campaigns');
  await page.locator('#console-navigation').getByRole('link', { name: /^Dashboard/u }).click();
  await openDashboardSecondaryWorkspaces(page);

  const search = page.getByRole('searchbox', { name: 'Search saved work' });
  await search.fill('candidate.invalid');
  await expect(page.getByRole('link', { name: 'Open case', exact: true })).toBeVisible();
  const warning = page.locator('.source-warning');
  await expect(page.locator('.search-details > summary')).toHaveText('Search incomplete');
  await page.locator('.search-details > summary').click();
  await expect(warning).toContainText('1 saved-data warning');
  await expect(warning.getByText(/Campaigns: unavailable in workspace storage and not searched/u)).toBeVisible();

  await search.fill('not-retained.invalid');
  await expect(page.getByRole('status').filter({ hasText: 'No match was found in the searchable subset. Local search coverage is partial.' })).toBeVisible();
  await expect(warning.getByText(/Campaigns: unavailable in workspace storage and not searched/u)).toBeVisible();
});

test('dashboard does not expose template controls when their collection is unavailable', async ({ page }) => {
  await page.goto('/bulk');
  await expect(page.locator('#domains')).toBeEditable();
  await failBrowserLocalCollectionReads(page, 'investigation_templates');
  await page.locator('#console-navigation').getByRole('link', { name: /^Dashboard/u }).click();

  await expect(page.locator('.summary-error')).toContainText('One or more required saved collections are unavailable.');
  await expect(page.getByText(/No custom templates are saved/)).toHaveCount(0);
  await expect(page.locator('#guide-template')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start guide' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New template' })).toHaveCount(0);
});

test('saved-work search waits for its worker, retains typing and pages through every indexed match', async ({ page }) => {
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION,
      cases: Array.from({ length: 76 }, (_, index) => caseRecord(`page-case-${index}`, `item-${String(index).padStart(3, '0')}.example`)) },
  });
  let release = () => {};
  const released = new Promise<void>((resolve) => { release = resolve; });
  let held = 0;
  const workerPath = productionChunkPath('src/lib/workers/investigation-search.worker.ts');
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === workerPath) {
      held += 1;
      await released;
    }
    await route.fallback();
  });
  try {
    await openDashboardSecondaryWorkspaces(page);
    const search = page.getByRole('searchbox', { name: 'Search saved work' });
    await expect.poll(() => held).toBe(1);
    await expect(page.locator('.investigation-search .index-count')).toHaveText('Preparing index');
    await search.fill('item-');
    await search.focus();
    await page.keyboard.type('000');
    await expect(search).toHaveValue('item-000');
    await expect(search).toBeFocused();
    await expect(page.getByRole('list', { name: 'Local investigation search results' })).toHaveCount(0);
    release();
    const results = page.getByRole('list', { name: 'Local investigation search results' });
    await expect(results.locator(':scope > li')).toHaveCount(2);
    await expect(search).toBeFocused();
    await search.fill('item-');
    const pages = page.getByRole('navigation', { name: 'Saved-work search pages' });
    const seen = new Set<string>();
    for (let currentPage = 1; currentPage <= 4; currentPage += 1) {
      await expect(pages.getByRole('status')).toHaveText(`Page ${currentPage} of 4`);
      await expect(results).toHaveAttribute('aria-busy', 'false');
      const identities = await results.locator('.result-card').evaluateAll((cards) => cards.map((card) =>
        `${card.querySelector('.type-badge')?.textContent}:${card.querySelector('h3')?.textContent}`));
      expect(identities).toHaveLength(currentPage === 4 ? 2 : 50);
      for (const identity of identities) { expect(seen.has(identity)).toBe(false); seen.add(identity); }
      if (currentPage < 4) {
        await pages.getByRole('button', { name: 'Next', exact: true }).focus();
        await page.keyboard.press('Enter');
        await expectFocusedResultsVisible(page, results);
      }
    }
    expect(seen.size).toBe(152);
    await expect(pages.getByRole('button', { name: 'Next', exact: true })).toHaveAttribute('aria-disabled', 'true');
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
      await page.setViewportSize(viewport);
      for (const theme of ['light', 'dark'] as const) {
        await useTheme(page, theme);
        await pages.getByRole('button', { name: 'Previous', exact: true }).press('Enter');
        await expect(pages.getByRole('status')).toHaveText('Page 3 of 4');
        await pages.getByRole('button', { name: 'Next', exact: true }).press('Enter');
        await expect(pages.getByRole('status')).toHaveText('Page 4 of 4');
        await expectFocusedResultsVisible(page, results);
        await expectNoHorizontalOverflow(page);
        await expect(pages.getByRole('button', { name: 'Previous', exact: true })).toBeVisible();
        if (captureVisualEvidenceEnabled()) { await test.info().attach(`saved-search-${viewport.width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' }); }
      }
    }
    await search.fill('item-000');
    await expect(results.locator(':scope > li')).toHaveCount(2);
    await expect(pages).toHaveCount(0);
    await expect(search).toBeFocused();
    await search.fill('nothing-retained.example');
    await expect(results).toHaveCount(0);
    await expect(page.locator('.result-status')).toContainText('No indexed saved work matched that search.');
  } finally { release(); }
});

test('saved-work search reports a worker load failure without blaming empty or unreadable storage', async ({ page }) => {
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: [caseRecord('worker-failure', 'retained.example')] } });
  await page.route(`**${productionChunkPath('src/lib/workers/investigation-search.worker.ts')}`, (route) => route.abort('failed'));
  await openDashboardSecondaryWorkspaces(page);
  const search = page.getByRole('region', { name: 'Search saved work', exact: true });
  await expect(search.locator('.search-details > summary')).toHaveText('Search unavailable');
  await search.locator('.search-details > summary').click();
  await expect(search.getByRole('alert')).toContainText('Saved-work search could not be prepared. No saved records were changed.');
  await expect(search.getByRole('button', { name: 'Reload page', exact: true })).toBeVisible();
  await expect(search).not.toContainText('No indexed saved work matched');
  await expect(page.getByRole('region', { name: 'Recent Cases', exact: true }).getByRole('listitem')).toHaveCount(1);
});

test('saved-work search indexes a rich admitted Case workspace off the main thread and reports phase measurements', async ({ page }) => {
  const cases = normalizeCaseStore({ version: CASE_SCHEMA_VERSION, cases: Array.from({ length: 500 }, (_, index) => ({
    ...caseRecord(`capacity-case-${index}`, `item-${index}.example`),
    updatedAt: '2026-08-02T00:00:00.000Z',
    evidenceHistory: Array.from({ length: 4 }, (_, capture) => ({
      capturedAt: `2026-08-01T00:0${capture}:00.000Z`, scanDepth: 'deep', source: 'lookup', inputHostname: `item-${index}.example`,
      availability: 'registered', nameservers: Array.from({ length: 12 }, (_, ns) => `ns-${ns}.capture-${capture}.item-${index}.example`),
    })),
  })) }).cases;
  const storeBytes = Buffer.byteLength(serializeCaseStore(cases));
  expect(cases).toHaveLength(500);
  expect(cases.every((record) => record.evidenceHistory.length === 4 && record.evidenceHistory.every((entry) => entry.nameservers.length === 12))).toBe(true);
  expect(storeBytes).toBeLessThanOrEqual(MAX_CASE_STORE_BYTES);
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases } });
  await expect(page.getByRole('button', { name: 'Open saved-work tools' })).toBeVisible();
  const probe = await page.evaluateHandle(() => {
    const NativeWorker = window.Worker;
    const marks = { startedAt: performance.now(), workerCreatedAt: 0, buildPostedAt: 0, postMessageReturnedAt: 0, workerReadyAt: 0, animationFrames: 0 };
    const tasks: { start: number; duration: number }[] = [];
    let taskOverflow = false;
    const collect = (entries: readonly PerformanceEntry[]) => { for (const entry of entries) {
      if (tasks.length >= 1_000) taskOverflow = true;
      else tasks.push({ start: entry.startTime, duration: entry.duration });
    } };
    const supported = PerformanceObserver.supportedEntryTypes.includes('longtask');
    const observer = supported ? new PerformanceObserver((list) => collect(list.getEntries())) : null;
    observer?.observe({ type: 'longtask' });
    let frame = 0;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (options?.name !== 'saved-work-search') return;
        marks.workerCreatedAt = performance.now();
        const next = () => { marks.animationFrames += 1; frame = requestAnimationFrame(next); };
        frame = requestAnimationFrame(next);
        this.addEventListener('message', (event) => {
          if (event.data?.kind === 'build') { marks.workerReadyAt = performance.now(); cancelAnimationFrame(frame); }
        });
        const post = this.postMessage.bind(this);
        this.postMessage = (message: unknown, options?: StructuredSerializeOptions | Transferable[]) => {
          const build = !!message && typeof message === 'object' && 'kind' in message && message.kind === 'build';
          if (build) marks.buildPostedAt = performance.now();
          if (Array.isArray(options)) post(message, options);
          else post(message, options);
          if (build) marks.postMessageReturnedAt = performance.now();
        };
      }
    };
    return { finish: () => {
      collect(observer?.takeRecords() ?? []); observer?.disconnect(); cancelAnimationFrame(frame); window.Worker = NativeWorker;
      const workerTasks = tasks.filter((task) => task.start < marks.workerReadyAt && task.start + task.duration > marks.postMessageReturnedAt);
      return { ...marks, mainThreadLongTasks: supported ? tasks : null, workerIntervalMainThreadLongTasks: supported ? workerTasks : null, taskOverflow };
    } };
  });
  try {
    await openDashboardSecondaryWorkspaces(page);
    await expect(page.locator('.investigation-search .index-count')).toHaveText('3000 searchable items', { timeout: 30_000 });
    const measurements = await probe.evaluate((value) => value.finish());
    expect(measurements.workerCreatedAt).toBeGreaterThan(measurements.startedAt);
    expect(measurements.workerReadyAt).toBeGreaterThan(measurements.postMessageReturnedAt);
    expect(measurements.postMessageReturnedAt).toBeGreaterThanOrEqual(measurements.buildPostedAt);
    expect(measurements.taskOverflow).toBe(false);
    await page.getByRole('searchbox', { name: 'Search saved work' }).fill('ns-11.capture-3.item-499.example');
    const results = page.getByRole('list', { name: 'Local investigation search results' });
    await expect(results.locator(':scope > li')).toHaveCount(1);
    await expect(results).toContainText('ns-11.capture-3.item-499.example');
    await test.info().attach('saved-search-capacity-measurement', { body: JSON.stringify({
      ...measurements, caseCount: 500, snapshotCount: 2_000, storeBytes, searchableEntities: 3_000,
      timingAcceptance: 'informational', scope: 'activation includes browser collection reads; worker interval includes transfer and worker preparation',
      peakMemoryAvailable: false,
    }), contentType: 'application/json' });
  } finally { await probe.evaluate((value) => value.finish()).catch(() => undefined); await probe.dispose(); }
});
