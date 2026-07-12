import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';
import type { Page } from '@playwright/test';

// Every CT search below is fulfilled locally with fixture JSON, so no test
// contacts crt.sh, WHOIS, RDAP, DNS, or any external service. Canonical
// fixture domains use the reserved `.invalid` TLD so that, in the one test
// that also scans them in Bulk, the /api/lookup call is likewise mocked and
// never reaches the network. The shared fixture's network + console guard
// (auto) is the backstop that enforces this.

const structuredResponse = {
  keyword: 'example',
  domains: ['a.example.invalid', 'login.example.invalid', 'shop.other.invalid'],
  certCount: 12,
  truncated: false,
  matches: [
    {
      domain: 'example.invalid',
      hostnames: ['a.example.invalid', 'login.example.invalid'],
      firstObservedAt: '2026-01-01T00:00:00.000Z',
      lastObservedAt: '2026-06-01T00:00:00.000Z',
      certificateCount: 4,
    },
    {
      domain: 'other.invalid',
      hostnames: ['shop.other.invalid'],
      firstObservedAt: '2026-02-01T00:00:00.000Z',
      lastObservedAt: '2026-09-01T00:00:00.000Z',
      certificateCount: 2,
    },
  ],
};

const legacyResponse = {
  keyword: 'example',
  domains: ['a.example.invalid', 'b.example.invalid'],
  certCount: 5,
  truncated: false,
};

async function mockCtSearch(page: Page, body: unknown, status = 200) {
  await page.route('**/api/ct-search**', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

async function runCtSearch(page: Page, keyword = 'example') {
  await page.getByRole('tab', { name: 'Certificates' }).click();
  await page.locator('.fields input').first().fill(keyword);
  await page.getByRole('button', { name: 'Search certificates' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/discover');
});

test('structured CT matches render one candidate per canonical domain, newest first', async ({ page }) => {
  await mockCtSearch(page, structuredResponse);
  await runCtSearch(page);

  await expect(page.locator('.candidate')).toHaveCount(2);
  // Newest last-observation first: other.invalid (2026-09) before example.invalid (2026-06).
  await expect(page.locator('.candidate strong')).toHaveText(['other.invalid', 'example.invalid']);

  // Observed hostnames are provenance (rendered as <code>), never separate
  // selectable candidates - the count of checkboxes stays at the two domains.
  await expect(page.locator('.candidate input[type="checkbox"]')).toHaveCount(2);
  await expect(page.locator('.candidate strong', { hasText: 'a.example.invalid' })).toHaveCount(0);
  await expect(page.locator('.ct-hosts code', { hasText: 'a.example.invalid' })).toBeVisible();
});

test('certificate count and CT observation times render as time elements', async ({ page }) => {
  await mockCtSearch(page, structuredResponse);
  await runCtSearch(page);

  const exampleCard = page.locator('.candidate', { hasText: 'example.invalid' }).first();
  await expect(exampleCard.locator('.ct-stat', { hasText: '4 distinct certificates' })).toBeVisible();
  await expect(exampleCard.locator('time[datetime="2026-01-01T00:00:00.000Z"]')).toHaveText('2026-01-01');
  await expect(exampleCard.locator('time[datetime="2026-06-01T00:00:00.000Z"]')).toHaveText('2026-06-01');
});

test('filtering by an observed hostname finds its canonical candidate', async ({ page }) => {
  await mockCtSearch(page, structuredResponse);
  await runCtSearch(page);

  await page.getByRole('textbox', { name: 'Filter candidates' }).fill('login');
  await expect(page.locator('.candidate')).toHaveCount(1);
  await expect(page.locator('.candidate strong')).toHaveText(['example.invalid']);
});

test('selection is keyed by canonical domain and is keyboard-accessible', async ({ page }) => {
  await mockCtSearch(page, structuredResponse);
  await runCtSearch(page);

  await expect(page.getByRole('heading', { name: '2 selected of 2' })).toBeVisible();

  const firstCheckbox = page.locator('.candidate input[type="checkbox"]').first();
  await firstCheckbox.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { name: '1 selected of 2' })).toBeVisible();
});

test('an allowlisted canonical domain is excluded when a profile is active', async ({ page }) => {
  await page.addInitScript(() => {
    const profile = {
      id: 'p1', name: 'Example', officialDomains: ['example.invalid'], productNames: [], tlds: [],
      approvedPartnerDomains: [], allowlistedDomains: [], allowlistedRegistrars: [], dkimSelectors: [],
      trademarkOwner: '', trademarkRegistration: '', officialFaviconHash: '', officialFaviconPHash: '',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    localStorage.setItem('whois-rdap-brand-profiles-v1', JSON.stringify([profile]));
    localStorage.setItem('whois-rdap-active-brand-profile-v1', 'p1');
  });
  await page.goto('/discover');
  await mockCtSearch(page, structuredResponse);
  await runCtSearch(page);

  await expect(page.locator('.candidate')).toHaveCount(1);
  await expect(page.locator('.candidate strong')).toHaveText(['other.invalid']);
  await expect(page.locator('.status')).toContainText('excluded 1 trusted profile domain');
});

test('Continue to Bulk loads canonical domains and CT provenance survives the handoff', async ({ page }) => {
  await mockCtSearch(page, structuredResponse);
  await runCtSearch(page);

  await page.getByRole('button', { name: 'Continue to Bulk' }).click();
  await expect(page).toHaveURL(/\/bulk/);

  const textarea = page.locator('#domains');
  await expect(textarea).toHaveValue(/example\.invalid/);
  await expect(textarea).toHaveValue(/other\.invalid/);
  await expect(page.locator('.handoff')).toContainText('Loaded 2 candidates from certificate transparency');
});

test.describe('CT provenance badge in Bulk results', () => {
  test.use({ allowExpectedBulkLookup400Noise: true });

  test('a scanned CT candidate shows the Certificate Transparency provenance indicator', async ({ page }) => {
    await page.route('**/api/lookup**', (route) =>
      route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Rejected in test' }) }),
    );
    await mockCtSearch(page, structuredResponse);
    await runCtSearch(page);
    await page.getByRole('button', { name: 'Continue to Bulk' }).click();
    await expect(page).toHaveURL(/\/bulk/);

    await page.getByRole('button', { name: /^Scan 2 domains$/ }).click();
    await expect(page.locator('.status')).toHaveText('Completed 2 of 2 lookups.', { timeout: 20_000 });

    const exampleRow = page.locator('tbody tr', { hasText: 'example.invalid' }).first();
    const ctDetails = exampleRow.locator('details.ct-source');
    await expect(ctDetails.locator('summary')).toHaveText('Certificate Transparency');
    await ctDetails.locator('summary').click();
    await expect(ctDetails).toContainText('2 observed hostnames');
    await expect(ctDetails).toContainText('4 distinct certificates');
    await expect(ctDetails.locator('time[datetime="2026-06-01T00:00:00.000Z"]')).toBeVisible();
  });
});

test('a legacy domains-only response renders and hands off safely', async ({ page }) => {
  await mockCtSearch(page, legacyResponse);
  await runCtSearch(page);

  await expect(page.locator('.ct-legacy')).toContainText('Detailed certificate provenance was unavailable');
  await expect(page.locator('.candidate')).toHaveCount(2);
  await expect(page.locator('.candidate strong')).toHaveText(['a.example.invalid', 'b.example.invalid']);
  // No manufactured CT metadata on legacy candidates.
  await expect(page.locator('.ct-meta')).toHaveCount(0);

  await page.getByRole('button', { name: 'Continue to Bulk' }).click();
  await expect(page).toHaveURL(/\/bulk/);
  await expect(page.locator('#domains')).toHaveValue(/a\.example\.invalid/);
});

test('switching tabs during an in-flight CT request does not leave the UI stuck', async ({ page }) => {
  // A deliberately slow CT response so the request is still in flight when the
  // tab switches. The handler tolerates the request being aborted by that switch.
  await page.route('**/api/ct-search**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(structuredResponse) });
    } catch {
      /* request was aborted by the tab switch; nothing to fulfill */
    }
  });

  await page.getByRole('tab', { name: 'Certificates' }).click();
  await page.locator('.fields input').first().fill('example');
  await page.getByRole('button', { name: 'Search certificates' }).click();
  await expect(page.getByRole('button', { name: /Searching/ })).toBeDisabled();

  // Switch tabs mid-request: the loading/disabled state must not get stuck.
  await page.getByRole('tab', { name: 'Lookalikes' }).click();
  await expect(page.getByRole('button', { name: 'Generate candidates' })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Searching/ })).toHaveCount(0);

  // A fresh search still works after returning to the Certificates tab.
  await page.getByRole('tab', { name: 'Certificates' }).click();
  await page.locator('.fields input').first().fill('example');
  await page.getByRole('button', { name: 'Search certificates' }).click();
  await expect(page.locator('.candidate')).toHaveCount(2);
});

test('a malformed structured response shows a visible error and no stale candidates', async ({ page }) => {
  await mockCtSearch(page, { keyword: 'example', matches: 'not-an-array' });
  await runCtSearch(page);

  await expect(page.getByRole('alert')).toContainText('malformed');
  await expect(page.locator('.candidate')).toHaveCount(0);
});

test('no horizontal overflow at 390px for structured CT results', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCtSearch(page, structuredResponse);
  await runCtSearch(page);

  await expect(page.locator('.candidate')).toHaveCount(2);
  await expectNoHorizontalOverflow(page);
});
