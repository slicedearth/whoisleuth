import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';

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
  await page.evaluate(({ cases, campaigns, profiles }) => {
    localStorage.setItem('whois-rdap-cases-v1', JSON.stringify({ version: 2, cases }));
    localStorage.setItem('whoisleuth-campaigns-v1', JSON.stringify({ version: 1, campaigns }));
    localStorage.setItem('whois-rdap-brand-profiles-v1', JSON.stringify(profiles));
  }, {
    cases: [caseRecord('case-source', 'candidate.invalid')],
    campaigns: [campaign('campaign-source', 'Priority review', ['candidate.invalid'])],
    profiles: [
      ...Array.from({ length: 12 }, (_, index) => profile(`profile-${index + 1}`, `Profile ${index + 1}`)),
      profile('profile-source', 'Reserved identity', ['official.invalid']),
    ],
  });
  await page.reload();
}

test('dashboard local search pivots to exact cases, campaigns, and brand profiles without scanning', async ({ page }) => {
  const lookupRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/lookup') lookupRequests.push(request.url());
  });
  await seedInvestigationStores(page);

  const search = page.getByRole('searchbox', { name: 'Search saved work' });
  await expect(page.locator('main')).not.toContainText('candidate.invalid');
  await search.fill('candidate.invalid');
  const caseResult = page.locator('.result-card').filter({ hasText: 'Case' }).filter({ hasText: 'candidate.invalid' });
  await caseResult.getByRole('link', { name: /Open case/ }).click();
  await expect(page).toHaveURL('/monitor?case=case-source');
  await expect(page.locator('.case-head', { hasText: 'candidate.invalid' })).toHaveAttribute('aria-expanded', 'true');

  await page.goto('/dashboard');
  await page.getByRole('searchbox', { name: 'Search saved work' }).fill('Priority review');
  await page.getByRole('link', { name: /Open campaign/ }).click();
  await expect(page).toHaveURL('/monitor?view=campaigns&campaign=campaign-source');
  await expect(page.locator('.campaign-head', { hasText: 'Priority review' })).toHaveAttribute('aria-expanded', 'true');

  await page.goto('/dashboard');
  await page.getByRole('searchbox', { name: 'Search saved work' }).fill('Reserved identity');
  await page.getByRole('link', { name: /Open profile/ }).click();
  await expect(page).toHaveURL('/brands?profile=profile-source');
  const focusedProfile = page.locator('#profile-profile-source');
  await expect(focusedProfile).toBeVisible();
  await expect(focusedProfile).toHaveClass(/focused/);
  await expect(focusedProfile.getByText('Search result')).toBeVisible();
  expect(lookupRequests).toEqual([]);
});

test('dashboard local search exposes future-store limitations without indexing future values', async ({ page }) => {
  await page.goto('/dashboard');
  await page.evaluate((record) => {
    localStorage.setItem('whois-rdap-cases-v1', JSON.stringify({ version: 3, cases: [record] }));
  }, caseRecord('future-case', 'future.invalid'));
  await page.reload();

  await expect(page.getByText('1 saved-data warning')).toBeVisible();
  await page.getByText('1 saved-data warning').click();
  await expect(page.getByText('Cases: created by a newer version and not searched.')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search saved work' }).fill('future.invalid');
  await expect(page.getByRole('status')).toContainText('Nothing saved in this browser matched');
  await expect(page.locator('main')).not.toContainText('future-case');
});

test('dashboard local search remains usable without horizontal overflow on narrow mobile screens', async ({ page }) => {
  await seedInvestigationStores(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByRole('searchbox', { name: 'Search saved work' }).fill('candidate.invalid');
  await expect(page.locator('.result-card').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('link', { name: 'Open case', exact: true }).focus();
  await expect(page.getByRole('link', { name: 'Open case', exact: true })).toBeFocused();
});
