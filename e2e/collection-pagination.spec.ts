import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';

const NOW = '2026-07-17T00:00:00.000Z';

function caseRecord(index: number) {
  return {
    id: `case-${index}`,
    domain: `case-${String(index).padStart(2, '0')}.invalid`,
    status: 'new',
    disposition: 'unreviewed',
    tags: [],
    notes: [],
    source: 'monitor',
    evidenceHistory: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function watchlistEntry(index: number) {
  return {
    updatedAt: NOW,
    results: [{ domain: `watch-${index}.invalid`, availability: 'registered', scanDepth: 'fast', mutationTypes: [] }],
    baseline: [],
    history: [],
  };
}

function shortlistRecord(index: number) {
  return {
    domain: `short-${String(index).padStart(3, '0')}.invalid`,
    scanDepth: 'fast',
    availability: 'registered',
    riskModelVersion: 5,
    riskScore: 40,
    opportunityScore: 20,
    mutationTypes: [],
    savedAt: NOW,
  };
}

function profile(index: number) {
  return {
    id: `profile-${index}`,
    name: `Profile ${String(index).padStart(2, '0')}`,
    officialDomains: [`profile-${index}.invalid`],
    productNames: [],
    tlds: ['invalid'],
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

function campaign(index: number, domains: string[] = []) {
  return {
    id: `campaign-${index}`,
    name: `Campaign ${String(index).padStart(2, '0')}`,
    description: '',
    domains,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

test('case pagination keeps deep-linked cases visible and expanded', async ({ page }) => {
  const cases = Array.from({ length: 27 }, (_, index) => caseRecord(index + 1));
  await page.goto('/monitor');
  await page.evaluate((records) => {
    localStorage.setItem('whois-rdap-cases-v1', JSON.stringify({ version: 2, cases: records }));
  }, cases);
  await page.goto('/monitor?case=case-26');

  const pagination = page.getByRole('navigation', { name: 'Case pages' });
  await expect(pagination).toContainText('Page 2 of 2');
  await expect(page.locator('.case-head', { hasText: 'case-26.invalid' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.case-head')).toHaveCount(2);
});

test('watchlist pagination preserves table actions on mobile', async ({ page }) => {
  const watchlists = Object.fromEntries(Array.from({ length: 27 }, (_, index) => [
    `Watchlist ${String(index + 1).padStart(2, '0')}`,
    watchlistEntry(index + 1),
  ]));
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('/monitor');
  await page.evaluate((records) => {
    localStorage.setItem('whois-rdap-watchlist-v1', JSON.stringify({ schema: 'whoisleuth.watchlists', version: 2, watchlists: records }));
  }, watchlists);
  await page.reload();

  const pagination = page.getByRole('navigation', { name: 'Watchlist pages' });
  await pagination.getByRole('button', { name: 'Next' }).click();
  await expect(pagination).toContainText('Page 2 of 2');
  await expect(page.getByRole('row', { name: /Watchlist 26/ })).toBeVisible();
  await page.getByRole('row', { name: /Watchlist 26/ }).getByRole('button', { name: 'History' }).click();
  await expect(page.getByRole('heading', { name: 'Watchlist 26' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('shortlist pagination displays every retained entry without changing collection actions', async ({ page }) => {
  const entries = Array.from({ length: 101 }, (_, index) => shortlistRecord(index + 1));
  await page.goto('/bulk');
  await page.evaluate((records) => {
    localStorage.setItem('whois-rdap-shortlist-v1', JSON.stringify({ schema: 'whoisleuth.shortlist', version: 2, entries: records }));
  }, entries);
  await page.reload();

  const pagination = page.getByRole('navigation', { name: 'Shortlist pages' });
  await expect(page.getByRole('heading', { name: 'Shortlist · 101' })).toBeVisible();
  await pagination.getByRole('button', { name: 'Next' }).click();
  await expect(pagination).toContainText('Page 2 of 2');
  await expect(page.getByText('short-101.invalid', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load for scan' })).toBeVisible();
});

test('brand profile pagination opens on the active profile page', async ({ page }) => {
  const profiles = Array.from({ length: 13 }, (_, index) => profile(index + 1));
  await page.goto('/brands');
  await page.evaluate((records) => {
    localStorage.setItem('whois-rdap-brand-profiles-v1', JSON.stringify(records));
    localStorage.setItem('whois-rdap-active-brand-profile-v1', 'profile-13');
  }, profiles);
  await page.reload();

  const pagination = page.getByRole('navigation', { name: 'Brand profile pages' });
  await expect(pagination).toContainText('Page 2 of 2');
  await expect(page.getByRole('heading', { name: 'Profile 13' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Set Profile 13 active' })).toBeChecked();
});

test('campaign and member pagination preserve expansion and case controls', async ({ page }) => {
  const members = Array.from({ length: 26 }, (_, index) => `member-${String(index + 1).padStart(2, '0')}.invalid`);
  const campaigns = Array.from({ length: 11 }, (_, index) => campaign(index + 1, index === 10 ? members : []));
  await page.goto('/monitor');
  await page.evaluate((records) => {
    localStorage.setItem('whois-rdap-cases-v1', JSON.stringify({ version: 2, cases: [] }));
    localStorage.setItem('whoisleuth-campaigns-v1', JSON.stringify({ version: 1, campaigns: records }));
  }, campaigns);
  await page.reload();
  await page.getByRole('tab', { name: /Campaigns/ }).click();

  const campaignPages = page.getByRole('navigation', { name: 'Campaign pages' });
  await campaignPages.getByRole('button', { name: 'Next' }).click();
  await expect(campaignPages).toContainText('Page 2 of 2');
  await page.locator('.campaign-head', { hasText: 'Campaign 11' }).click();

  const memberPages = page.getByRole('navigation', { name: 'Case pages for Campaign 11' });
  await expect(memberPages).toContainText('Page 1 of 2');
  await memberPages.getByRole('button', { name: 'Next' }).click();
  await expect(memberPages).toContainText('Page 2 of 2');
  await expect(page.getByText('member-26.invalid', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
});
