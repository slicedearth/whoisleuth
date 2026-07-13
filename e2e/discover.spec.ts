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

const initialBaselineResponse = {
  ...structuredResponse,
  certCount: 4,
  matches: [structuredResponse.matches[0]],
  domains: ['a.example.invalid', 'login.example.invalid'],
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

test('lookalike generation discloses and enforces its candidate limits', async ({ page }) => {
  const tlds = Array.from({ length: 25 }, (_, index) =>
    `${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`,
  );
  await expect(page.locator('.generation-limits')).toContainText('20 TLDs, 1,500 label variants, and 2,000 candidates');
  await page.getByRole('textbox', { name: 'Brand or domain' }).fill('acme');
  await page.getByRole('textbox', { name: 'TLDs' }).fill(tlds.join(', '));
  await page.getByRole('button', { name: 'Generate candidates' }).click();

  await expect(page.getByRole('heading', { name: '2000 selected of 2000' })).toBeVisible();
  await expect(page.locator('.status')).toContainText('Generation limits were reached');
  await expect(page.locator('.candidate')).toHaveCount(300);
  await expect(page.locator('.limit')).toContainText('first 300 matching candidates');
});

test('lookalike presets expose a live upper-bound estimate and clear stale results', async ({ page }) => {
  const allFamilies = page.getByRole('button', { name: 'Use All families generation preset' });
  const impersonation = page.getByRole('button', { name: 'Use Impersonation generation preset' });
  await expect(allFamilies).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('textbox', { name: 'Brand or domain' }).fill('acme.com');
  await page.getByRole('textbox', { name: 'TLDs' }).fill('com, net, org');
  await expect(page.locator('.generation-estimate')).toContainText('Estimated maximum before validation and deduplication');
  await expect(page.locator('.generation-estimate')).toContainText('across 3 TLDs');

  await page.getByRole('button', { name: 'Generate candidates' }).click();
  await expect(page.locator('.candidate')).not.toHaveCount(0);
  await impersonation.click();
  await expect(impersonation).toHaveAttribute('aria-pressed', 'true');
  await expect(allFamilies).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.candidate')).toHaveCount(0);
  await expect(page.locator('.status')).toHaveCount(0);

  await page.getByRole('button', { name: 'Generate candidates' }).click();
  await expect(page.locator('.candidate strong', { hasText: /^loginacme\.com$/ })).toBeVisible();
  const expandedTerm = page.locator('.candidate').filter({
    has: page.locator('strong', { hasText: /^signin-acme\.com$/ }),
  });
  await expect(expandedTerm).toContainText('Impersonation term');
  await expect(page.locator('.candidate strong', { hasText: /^acm\.com$/ })).toHaveCount(0);
});

test('lookalike estimate discloses when the hard generation cap may apply', async ({ page }) => {
  const tlds = Array.from({ length: 20 }, (_, index) =>
    `${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`,
  );
  await page.getByRole('textbox', { name: 'Brand or domain' }).fill('acme');
  await page.getByRole('textbox', { name: 'TLDs' }).fill(tlds.join(', '));
  await expect(page.locator('.generation-estimate')).toContainText('up to 2,000 candidates');
  await expect(page.locator('.generation-estimate')).toContainText('hard cap may apply');
});

test('keyboard layout selection adds locale-specific neighbours and clears stale results', async ({ page }) => {
  await page.getByRole('button', { name: 'Use Common edits generation preset' }).click();
  await page.getByRole('textbox', { name: 'Brand or domain' }).fill('z.com');
  await page.getByRole('textbox', { name: 'TLDs' }).fill('com');

  const keyboardLayout = page.getByRole('combobox', { name: 'Keyboard layout' });
  await expect(keyboardLayout).toHaveValue('qwerty');
  await page.getByRole('button', { name: 'Generate candidates' }).click();
  await expect(page.locator('.candidate strong', { hasText: /^e\.com$/ })).toHaveCount(0);

  await keyboardLayout.selectOption('azerty');
  await expect(page.locator('.candidate')).toHaveCount(0);
  await page.getByRole('button', { name: 'Generate candidates' }).click();
  const azertyNeighbour = page.locator('.candidate').filter({
    has: page.locator('strong', { hasText: /^e\.com$/ }),
  });
  await expect(azertyNeighbour).toContainText('Keyboard substitution');

  await page.getByRole('button', { name: 'Use Impersonation generation preset' }).click();
  await expect(keyboardLayout).toBeDisabled();
  await expect(page.locator('.generation-options')).toContainText('Not used by the selected preset');
});

test('multi-word lookalikes retain separator and reordering provenance', async ({ page }) => {
  await page.getByRole('button', { name: 'Use Common edits generation preset' }).click();
  await page.getByRole('textbox', { name: 'Brand or domain' }).fill('Acme Pay');
  await page.getByRole('textbox', { name: 'TLDs' }).fill('com');
  await page.getByRole('button', { name: 'Generate candidates' }).click();

  const hyphenated = page.locator('.candidate').filter({
    has: page.locator('strong', { hasText: /^acme-pay\.com$/ }),
  });
  await expect(hyphenated).toContainText('Hyphen insertion');
  const reordered = page.locator('.candidate').filter({
    has: page.locator('strong', { hasText: /^pay-acme\.com$/ }),
  });
  await expect(reordered).toContainText('Word reordering');
});

test('lookalike generation rejects ambiguous dotted input and invalid mutation labels', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Brand or domain' }).fill('example.co.uk');
  await page.getByRole('button', { name: 'Generate candidates' }).click();
  await expect(page.getByRole('alert')).toContainText('domain with one suffix label');
  await expect(page.locator('.candidate')).toHaveCount(0);

  await page.getByRole('textbox', { name: 'Brand or domain' }).fill('m.com');
  await page.getByRole('button', { name: 'Generate candidates' }).click();
  await expect(page.locator('.candidate strong', { hasText: /^-\.com$/ })).toHaveCount(0);
  await expect(page.locator('.candidate')).not.toHaveCount(0);
});

test('domain seeds expand across selected TLDs with combined provenance', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Brand or domain' }).fill('acme.com');
  await page.getByRole('textbox', { name: 'TLDs' }).fill('com, net');
  await page.getByRole('button', { name: 'Generate candidates' }).click();

  const exactSubstitution = page.locator('.candidate').filter({
    has: page.locator('strong', { hasText: /^acme\.net$/ }),
  });
  await expect(exactSubstitution).toContainText('Selected TLD substitution');
  const combined = page.locator('.candidate').filter({
    has: page.locator('strong', { hasText: /^acm\.net$/ }),
  });
  await expect(combined).toContainText('Character omission');
  await expect(combined).toContainText('Selected TLD substitution');
  await expect(page.locator('.candidate strong', { hasText: /^acme\.com$/ })).toHaveCount(0);
});

test('name-idea generation refuses labels that exceed DNS bounds', async ({ page }) => {
  await page.getByRole('tab', { name: 'Name ideas' }).click();
  await page.getByRole('textbox', { name: 'Keyword' }).fill('a'.repeat(80));
  await page.getByRole('button', { name: 'Generate candidates' }).click();
  await expect(page.getByRole('alert')).toContainText('shorter keyword');
  await expect(page.locator('.candidate')).toHaveCount(0);
});

test('candidate limit guidance and controls do not overflow at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.generation-limits')).toBeVisible();
  await expect(page.locator('.generation-presets')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Keyboard layout' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
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
    localStorage.setItem('whoisleuth:ct-search-history:v1', JSON.stringify({
      version: 1,
      entries: [{
        query: 'example', baselineAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z',
        domains: ['other.invalid'],
        history: [{ checkedAt: '2026-05-01T00:00:00.000Z', resultCount: 1, certificateCount: 1, newCount: 0, newDomains: [], truncated: false }],
      }],
    }));
  });
  await page.goto('/discover');
  await mockCtSearch(page, structuredResponse);
  await runCtSearch(page);

  await expect(page.locator('.candidate')).toHaveCount(1);
  await expect(page.locator('.candidate strong')).toHaveText(['other.invalid']);
  await expect(page.locator('.status')).toContainText('excluded 1 trusted profile domain');
  await expect(page.locator('.status')).toContainText('0 new since the previous complete search');
  await expect(page.getByRole('button', { name: 'New only · 0' })).toBeVisible();
  await expect(page.locator('.ct-new')).toHaveCount(0);
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

test('a complete CT baseline persists across reload and labels newly observed domains', async ({ page }) => {
  let requestCount = 0;
  await page.route('**/api/ct-search**', (route) => {
    requestCount += 1;
    const body = requestCount === 1 ? initialBaselineResponse : structuredResponse;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await runCtSearch(page);
  await expect(page.locator('.status')).toContainText('Saved as the first local baseline');
  await expect(page.locator('.ct-new')).toHaveCount(0);

  await page.reload();
  await runCtSearch(page);
  await expect(page.locator('.status')).toContainText('1 new since the previous complete search');
  await expect(page.locator('.ct-new')).toHaveCount(1);
  await expect(page.locator('.candidate', { has: page.locator('.ct-new') }).locator('strong')).toHaveText('other.invalid');

  const newOnly = page.getByRole('button', { name: 'New only · 1' });
  await newOnly.click();
  await expect(newOnly).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.candidate')).toHaveCount(1);
  await expect(page.locator('.candidate strong')).toHaveText(['other.invalid']);
});

test('previous certificate searches can be reused and deleted', async ({ page }) => {
  await mockCtSearch(page, initialBaselineResponse);
  await runCtSearch(page, 'Example Brand');

  const history = page.locator('details.ct-history');
  const historySummary = history.locator(':scope > summary');
  await expect(historySummary).toContainText('Previous certificate searches · 1');
  await historySummary.click();
  await expect(history).toContainText('example brand');
  await expect(history).toContainText('1 retained check');
  await history.locator('.ct-checks > summary', { hasText: 'View check history' }).click();
  await expect(history.locator('.ct-checks')).toContainText('1 result · 0 new');

  await page.locator('.fields input').first().fill('different');
  await history.getByRole('button', { name: 'Use example brand certificate search' }).click();
  await expect(page.locator('.fields input').first()).toHaveValue('example brand');

  page.once('dialog', (dialog) => dialog.accept());
  await history.getByRole('button', { name: 'Delete example brand certificate history' }).click();
  await expect(page.locator('details.ct-history')).toHaveCount(0);
});

test('a capped search does not replace the previous complete baseline', async ({ page }) => {
  let requestCount = 0;
  await page.route('**/api/ct-search**', (route) => {
    requestCount += 1;
    const body = requestCount === 2
      ? { ...structuredResponse, truncated: true }
      : initialBaselineResponse;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await runCtSearch(page);
  await runCtSearch(page);
  await expect(page.locator('.status')).toContainText('Capped results did not replace that baseline');
  await expect(page.locator('.ct-new')).toHaveCount(1);

  // The third complete response matches the original baseline. If the capped
  // response had replaced it, the original domain would be mislabelled new.
  await runCtSearch(page);
  await expect(page.locator('.status')).toContainText('0 new since the previous complete search');
  await expect(page.locator('.ct-new')).toHaveCount(0);
});

test('corrupt local CT history is recovered without losing search results', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('whoisleuth:ct-search-history:v1', '{broken-json'));
  await mockCtSearch(page, initialBaselineResponse);
  await runCtSearch(page);

  await expect(page.locator('.candidate')).toHaveCount(1);
  await expect(page.locator('.status')).toContainText('Saved as the first local baseline');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('whoisleuth:ct-search-history:v1') || 'null'));
  expect(stored.version).toBe(1);
  expect(stored.entries).toHaveLength(1);
});

test('a browser storage write failure does not hide valid CT search results', async ({ page }) => {
  await page.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'whoisleuth:ct-search-history:v1') {
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      }
      return originalSetItem.call(this, key, value);
    };
  });
  await page.reload();
  await mockCtSearch(page, initialBaselineResponse);
  await runCtSearch(page);

  await expect(page.locator('.candidate')).toHaveCount(1);
  await expect(page.locator('.candidate strong')).toHaveText(['example.invalid']);
  await expect(page.locator('.status')).toContainText('Found 1 registrable domain from 4 certificates');
  await expect(page.locator('.ct-history-notice')).toContainText('Browser storage may be full or unavailable');
});

test('a future CT history schema is never overwritten by an older app', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('whoisleuth:ct-search-history:v1', JSON.stringify({ version: 2, entries: [{ future: true }] })));
  await mockCtSearch(page, initialBaselineResponse);
  await runCtSearch(page);

  await expect(page.locator('.candidate')).toHaveCount(1);
  await expect(page.locator('.ct-history-notice')).toContainText('newer app version');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('whoisleuth:ct-search-history:v1') || 'null'));
  expect(stored).toEqual({ version: 2, entries: [{ future: true }] });
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
