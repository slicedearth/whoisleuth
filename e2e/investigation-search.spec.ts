import { expect, test } from './fixtures';
import { currentBrandProfileBrowserStore, currentBrowserLocalDocument, expectFocusedResultsVisible, expectNoHorizontalOverflow, failBrowserLocalCollectionReads, failBrowserLocalReads, holdBrowserLocalReads, migrateLegacyBrowserData, openDashboardSecondaryWorkspaces, useTheme } from './helpers';
import { CASE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/case-model';
import { productionChunkPath } from './production-build';
import { normalizeCaseStore, serializeCaseStore, MAX_CASE_STORE_BYTES } from '../packages/cases/case-model.mts';

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
    'One or more required browser-local collections are unavailable.',
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
  await expect(warning.locator('summary')).toContainText('1 saved-data warning');
  await warning.locator('summary').click();
  await expect(warning.getByText(/Campaigns: unavailable in browser-local storage and not searched/u)).toBeVisible();

  await search.fill('not-retained.invalid');
  await expect(page.getByRole('status').filter({ hasText: 'No match was found in the searchable subset. Local search coverage is partial.' })).toBeVisible();
  await expect(warning.getByText(/Campaigns: unavailable in browser-local storage and not searched/u)).toBeVisible();
});

test('dashboard does not expose template controls when their collection is unavailable', async ({ page }) => {
  await page.goto('/bulk');
  await expect(page.locator('#domains')).toBeEditable();
  await failBrowserLocalCollectionReads(page, 'investigation_templates');
  await page.locator('#console-navigation').getByRole('link', { name: /^Dashboard/u }).click();

  await expect(page.locator('.summary-error')).toContainText('One or more required browser-local collections are unavailable.');
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
    await expect(page.getByText('Preparing saved-work search.', { exact: true })).toBeVisible();
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
        await test.info().attach(`saved-search-${viewport.width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
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
