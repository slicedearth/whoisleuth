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
