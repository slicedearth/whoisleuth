import { expect, test } from './fixtures';
import { currentBrandProfileBrowserStore, currentBrowserLocalDocument, expectNoHorizontalOverflow, failBrowserLocalCollectionReads, failBrowserLocalReads, holdBrowserLocalReads, migrateLegacyBrowserData, openDashboardSecondaryWorkspaces } from './helpers';
import { CASE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/case-model';

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
  await expect(page).toHaveURL('/monitor?case=case-source', { timeout: 15_000 });
  await expect(page.locator('.case-head', { hasText: 'candidate.invalid' })).toHaveAttribute('aria-expanded', 'true');

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

  await expect(page.locator('.summary-error')).toContainText('One or more required browser-local collections are unavailable.');
  await expect(page.getByRole('heading', { name: 'Choose an analyst job' })).toBeVisible();
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

  const openCases = page.locator('.summary-card').filter({ hasText: 'Open cases' });
  const watchlists = page.locator('.summary-card').filter({ hasText: 'Watchlists' });
  const profiles = page.locator('.summary-card').filter({ hasText: 'Brand profiles' });
  await expect(openCases.locator('strong')).toHaveText('1');
  await expect(openCases).toContainText('1 total saved case');
  await expect(watchlists.locator('strong')).toHaveText('Unavailable');
  await expect(profiles.locator('strong')).toHaveText('13');
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
  await expect(page.getByRole('status').filter({ hasText: 'Nothing saved in this browser matched' })).toBeVisible();
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
