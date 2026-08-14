import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, failBrowserLocalManifestWrites, holdBrowserLocalReads, migrateLegacyBrowserData, readBrowserLocalCollection } from './helpers';
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

const initialBaselineResponse = {
  ...structuredResponse,
  certCount: 4,
  matches: [structuredResponse.matches[0]],
  domains: ['a.example.invalid', 'login.example.invalid'],
};

const otherOnlyResponse = {
  ...structuredResponse,
  certCount: 2,
  matches: [structuredResponse.matches[1]],
  domains: ['shop.other.invalid'],
};

function ctHistoryStoreFixture(checkCount: number) {
  const history = Array.from({ length: checkCount }, (_, index) => ({
    checkedAt: new Date(Date.UTC(2026, 0, index + 1, 12, index)).toISOString(),
    resultCount: index + 1,
    certificateCount: index + 1,
    newCount: index === 0 ? 0 : 1,
    newDomains: index === 0 ? [] : [`history-${index}.invalid`],
    truncated: false,
  }));
  return {
    version: 2,
    entries: [{
      query: 'retention fixture',
      baselineAt: history.at(-1)?.checkedAt || null,
      updatedAt: history.at(-1)?.checkedAt,
      domains: ['history.invalid'],
      history,
      discardedCheckCount: 0,
      discardedCheckCountKnown: true,
      discardedCheckCountCapped: false,
    }],
  };
}

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

async function mockRdapNameserverSearch(page: Page) {
  await page.route('**/api/rdap-nameserver-search?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      schema: 'whoisleuth.rdap-nameserver-search',
      version: 1,
      state: 'partial',
      nameserver: 'ns1.infrastructure.example',
      registryScope: 'example',
      lowerBound: true,
      observedAt: '2026-08-01T00:00:00.000Z',
      source: { endpoint: 'https://registry.example/rdap/domains?nsLdhName=ns1.infrastructure.example' },
      domains: [{
        domain: 'matched.example',
        unicodeDomain: null,
        statuses: ['active'],
        nameserverObserved: true,
        partial: false,
      }],
      truncated: true,
      omittedInvalid: 1,
      limitations: ['Results cover only the .example registry selected for this request.'],
    }),
  }));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/discover');
});

test('certificate search exposes and enforces the shared bounded query contract', async ({ page, request }) => {
  await page.getByRole('tab', { name: 'Certificates' }).click();
  const input = page.getByRole('textbox', { name: 'Certificate-log keyword' });
  await expect(input).toHaveAttribute('maxlength', '200');
  await expect(page.locator('#ct-query-guidance')).toContainText('up to 200 characters');
  await expect(page.locator('#ct-query-guidance')).toContainText('does not submit the target for a live website scan');

  const missingResponse = await request.get('/api/ct-search');
  expect(missingResponse.status()).toBe(400);
  expect(missingResponse.headers()['cache-control']).toBe('no-store');
  expect(await missingResponse.json()).toMatchObject({ errorCode: 'MISSING_QUERY' });

  const invalidResponse = await request.get(`/api/ct-search?q=${encodeURIComponent('x'.repeat(201))}`);
  expect(invalidResponse.status()).toBe(400);
  expect(await invalidResponse.json()).toMatchObject({ errorCode: 'INVALID_CT_QUERY' });
});

test('does not publish a superseded certificate result after delayed history persistence', async ({ page }) => {
  await mockCtSearch(page, structuredResponse);
  await page.getByRole('tab', { name: 'Certificates' }).click();
  await page.locator('.fields input').first().fill('example');
  // Trigger the search from the browser task that observes the active hold so
  // the persistence race remains deterministic under full-suite worker load.
  await holdBrowserLocalReads(page, 4_000, '#discovery-method-panel button.primary');
  await expect(page.getByRole('button', { name: 'Searching…' })).toBeDisabled();

  await page.getByRole('tab', { name: 'Lookalikes' }).click();
  await page.getByLabel('Brand or domain').fill('superseding');
  await page.getByRole('textbox', { name: 'TLDs' }).fill('example');
  await page.getByRole('button', { name: 'Generate candidates' }).click();
  const generationStatus = page.locator('p.status[role="status"]').filter({ hasText: /^Generated /u });
  await expect(generationStatus).toBeVisible();

  await readBrowserLocalCollection(page, 'ct_history', { minimumRecords: 1, timeout: 10_000 });
  await expect(page.getByRole('tab', { name: 'Lookalikes' })).toHaveAttribute('aria-selected', 'true');
  await expect(generationStatus).toBeVisible();
  await expect(page.getByText('a.example.invalid', { exact: true })).toHaveCount(0);
});

test('registry-scoped nameserver results disclose their lower-bound scope and continue to Bulk', async ({ page }) => {
  await mockRdapNameserverSearch(page);
  await page.getByRole('tab', { name: 'Nameservers' }).click();
  await page.getByRole('textbox', { name: 'Nameserver hostname' }).fill('NS1.Infrastructure.Example.');
  await page.getByRole('textbox', { name: 'Registry suffix' }).fill('.example');
  await page.getByRole('button', { name: 'Search registry' }).click();

  await expect(page.getByRole('note').filter({ hasText: 'Registry-scoped result' })).toContainText('.example');
  await expect(page.locator('.status')).toContainText('1 bounded partial domain result');
  await expect(page.locator('.candidate strong')).toHaveText(['matched.example']);
  await expect(page.getByText(/not a global reverse-nameserver inventory/iu)).toBeVisible();

  await page.getByRole('button', { name: 'Select filtered (1)' }).click();
  await page.getByRole('button', { name: 'Continue to Bulk with 1' }).click();
  await expect(page).toHaveURL(/\/bulk/);
  await expect(page.locator('#domains')).toHaveValue('matched.example');
  await expect(page.locator('.handoff')).toContainText('Loaded 1 candidate from nameserver');
});

test('lookalike generation discloses its limits and paginates every retained candidate', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const tlds = Array.from({ length: 25 }, (_, index) =>
    `${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`,
  );
  await expect(page.locator('.generation-limits')).toContainText('20 TLDs, 1,500 label variants, and 2,000 candidates');
  await page.getByRole('textbox', { name: 'Brand or domain' }).fill('acme');
  await page.getByRole('textbox', { name: 'TLDs' }).fill(tlds.join(', '));
  await page.getByRole('button', { name: 'Generate candidates' }).click();

  await expect(page.getByRole('heading', { name: '0 selected of 2000' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to Bulk with 0' })).toBeDisabled();
  await expect(page.locator('.status')).toContainText('Generation limits were reached');
  await expect(page.locator('.candidate')).toHaveCount(100);
  await expect(page.getByRole('status').filter({ hasText: 'Showing 1–100 of 2000 matching candidates' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Candidate scope' }).locator('option[value="all"]')).toHaveText('All candidates (2000)');
  await expect(page.locator('.sort-guidance')).toContainText('Generated candidates are ordered by visible review cues');
  await expect(page.locator('.sort-guidance')).toContainText('Sorting changes presentation only');

  const pagination = page.getByRole('navigation', { name: 'Discover candidate pages' });
  await expect(pagination).toContainText('Page 1 of 20');
  const previousPage = pagination.getByRole('button', { name: 'Previous' });
  const nextPage = pagination.getByRole('button', { name: 'Next' });
  await expect(previousPage).toHaveAttribute('aria-disabled', 'true');
  await previousPage.focus();
  await expect(previousPage).toBeFocused();
  await nextPage.click();
  await expect(nextPage).toBeFocused();
  await expect(pagination).toContainText('Page 2 of 20');
  await expect(page.locator('.candidate')).toHaveCount(100);
  await expect(page.getByRole('status').filter({ hasText: 'Showing 101–200 of 2000 matching candidates' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('textbox', { name: 'Filter candidates' }).fill('login-acme.aa');
  await expect(page.locator('.candidate strong')).toHaveText(['login-acme.aa']);
  await expect(page.getByRole('navigation', { name: 'Discover candidate pages' })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Showing 1–1 of 1 matching candidate' })).toBeVisible();
  await page.getByRole('button', { name: 'Select filtered (1)' }).click();
  await expect(page.getByRole('heading', { name: '1 selected of 2000' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to Bulk with 1' })).toBeEnabled();
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page.locator('.candidate')).toHaveCount(100);
  await expect(page.getByRole('status').filter({ hasText: 'Showing 1–100 of 2000 matching candidates' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Candidate scope' })).toHaveValue('all');
  await expect(page.getByRole('combobox', { name: 'Candidate sort' })).toHaveValue('review-signals');
  await page.getByRole('button', { name: 'Clear filtered (1)' }).click();
  await expect(page.getByRole('heading', { name: '0 selected of 2000' })).toBeVisible();
});

test('lookalike presets expose a live upper-bound estimate and clear stale results', async ({ page }) => {
  const allFamilies = page.getByRole('button', { name: /^All families\b/u });
  const impersonation = page.getByRole('button', { name: /^Impersonation\b/u });
  await expect(allFamilies).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('textbox', { name: 'Brand or domain' }).fill('acme.test');
  await page.getByRole('textbox', { name: 'TLDs' }).fill('com, net, org');
  await expect(page.locator('.generation-estimate')).toContainText('Estimated maximum before validation and deduplication');
  await expect(page.locator('.generation-estimate')).toContainText('across 4 TLDs');

  await page.getByRole('button', { name: 'Generate candidates' }).click();
  await expect(page.locator('.candidate')).not.toHaveCount(0);
  await impersonation.click();
  await expect(impersonation).toHaveAttribute('aria-pressed', 'true');
  await expect(allFamilies).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.candidate')).toHaveCount(0);
  await expect(page.locator('.status')).toHaveCount(0);

  await page.getByRole('button', { name: 'Generate candidates' }).click();
  await page.getByRole('combobox', { name: 'Candidate sort' }).selectOption('generated');
  await expect(page.locator('.candidate strong', { hasText: /^loginacme\.com$/ })).toBeVisible();
  const expandedTerm = page.locator('.candidate').filter({
    has: page.locator('strong', { hasText: /^signin-acme\.com$/ }),
  });
  await expect(expandedTerm).toContainText('Impersonation term');
  await expect(page.locator('.candidate strong', { hasText: /^acm\.com$/ })).toHaveCount(0);
});

test('Unicode lookalikes show both domain forms and support evidence-aware filtering', async ({ page }) => {
  await page.getByRole('button', { name: /^Impersonation\b/u }).click();
  await page.getByRole('textbox', { name: 'Brand or domain' }).fill('scope.invalid');
  await page.getByRole('textbox', { name: 'TLDs' }).fill('invalid');
  await page.getByRole('button', { name: 'Generate candidates' }).click();

  await page.getByRole('combobox', { name: 'Mutation family' }).selectOption('unicode_whole_label');
  await expect(page.locator('.candidate')).toHaveCount(1);
  const candidate = page.locator('.candidate');
  await expect(candidate.locator('strong')).toHaveText(/^xn--/u);
  await expect(candidate).toContainText('Unicode: ѕсоре.invalid');
  await expect(candidate).toContainText('Scripts: Cyrillic, Latin');
  await expect(candidate).toContainText('Whole-label Unicode confusable');
  await expect(candidate).toContainText('Source or profile visual match');
  await expect(candidate).toContainText('Visual match: scope.invalid');
  const reviewSignals = candidate.locator('.candidate-badge.review');
  await expect(reviewSignals).toHaveText(/[2-5] review cues/u);
  await expect(reviewSignals).toHaveAttribute('title', /source or profile character match/u);
  await expect(page.getByText('Review cues count visible candidate characteristics only.')).toContainText('not a risk score');
  const reviewCueScope = page.getByRole('combobox', { name: 'Candidate scope' }).locator('option[value="review-cues"]');
  const unicodeScope = page.getByRole('combobox', { name: 'Candidate scope' }).locator('option[value="unicode"]');
  const referenceScope = page.getByRole('combobox', { name: 'Candidate scope' }).locator('option[value="reference"]');
  await expect(reviewCueScope).toHaveText(/Has review cues \([1-9]\d*\)/u);
  await expect(unicodeScope).toHaveText(/Internationalised \([1-9]\d*\)/u);
  await expect(referenceScope).toHaveText(/Source or profile match \([1-9]\d*\)/u);
  expect(Number((await reviewCueScope.textContent())?.match(/\((\d+)\)/u)?.[1] || 0)).toBeGreaterThan(1);
  expect(Number((await unicodeScope.textContent())?.match(/\((\d+)\)/u)?.[1] || 0)).toBeGreaterThan(1);
  expect(Number((await referenceScope.textContent())?.match(/\((\d+)\)/u)?.[1] || 0)).toBeGreaterThan(1);
  await expect(page.getByText('Visual matches use a bounded character comparison.')).toContainText('not proof of impersonation');
  await expect(page.getByRole('combobox', { name: 'Mutation family' }).locator('option[value="unicode_whole_label"]')).toHaveText('Whole-label Unicode confusable (1)');
  await expect(page.getByRole('combobox', { name: 'Candidate sort' })).toContainText('Most generation paths');
  await expect(page.getByRole('combobox', { name: 'Candidate sort' })).toContainText('Most review cues');
  await expect(page.getByRole('combobox', { name: 'Candidate sort' })).toContainText('Reference matches first');
  await expect(page.getByRole('combobox', { name: 'Candidate sort' })).toHaveValue('review-signals');
  await expect(page.locator('.sort-guidance')).toContainText('Generated candidates are ordered by visible review cues');

  await page.getByRole('combobox', { name: 'Candidate scope' }).selectOption('review-cues');
  await expect(candidate).toBeVisible();
  await page.getByRole('combobox', { name: 'Candidate scope' }).selectOption('reference');
  await expect(candidate).toBeVisible();
  await page.getByRole('combobox', { name: 'Candidate sort' }).selectOption('review-signals');
  await expect(candidate).toBeVisible();
  await page.getByRole('combobox', { name: 'Candidate sort' }).selectOption('domain');
  await expect(candidate).toBeVisible();
  await expect(page.locator('.sort-guidance')).toContainText('ordered alphabetically by domain');

  const checkbox = candidate.locator('input[type="checkbox"]');
  await checkbox.check();
  await expect(page.getByRole('combobox', { name: 'Candidate scope' }).locator('option[value="selected"]')).toHaveText('Selected only (1)');
  await page.getByRole('combobox', { name: 'Candidate scope' }).selectOption('selected');
  await expect(candidate).toBeVisible();
  await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.candidate')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'No candidates match the current filters' })).toBeVisible();
});

test('serializes local IDN policy provenance while a selected file is being read', async ({ page }) => {
  await page.getByRole('button', { name: /^Impersonation\b/u }).click();
  await page.getByRole('textbox', { name: 'Brand or domain' }).fill('scope.invalid');
  await page.getByRole('textbox', { name: 'TLDs' }).fill('invalid');
  await page.getByRole('button', { name: 'Generate candidates' }).click();

  const policy = page.locator('details.idn-policy');
  await policy.locator('summary').click();
  await page.evaluate(() => {
    const original = File.prototype.text;
    let hold = true;
    File.prototype.text = function text() {
      if (!hold) return original.call(this);
      hold = false;
      return new Promise<string>((resolve, reject) => {
        Reflect.set(window, '__releaseIdnPolicyRead', () => {
          void original.call(this).then(resolve, reject);
        });
      });
    };
  });
  const suffix = policy.getByLabel('Registry table suffix');
  const file = policy.locator('input[type="file"]');
  await suffix.fill('invalid');
  await file.setInputFiles({
    name: 'reviewed-invalid-lgr.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from('<?xml version="1.0"?><lgr><data><range first-cp="0061" last-cp="007A"/><char cp="0455"/><char cp="0441"/><char cp="043E"/><char cp="0440"/><char cp="0435"/></data></lgr>'),
  });
  await policy.getByRole('button', { name: 'Review local table' }).click();
  await expect(policy.getByRole('button', { name: 'Reviewing…' })).toBeDisabled();
  await expect(suffix).toBeDisabled();
  await expect(file).toBeDisabled();
  await page.evaluate(() => {
    const release = Reflect.get(window, '__releaseIdnPolicyRead');
    if (typeof release !== 'function') throw new Error('The IDN policy read gate was not installed.');
    release();
  });
  await expect(policy.getByText('Source:')).toContainText('reviewed-invalid-lgr.xml');
  await expect(policy.getByText('Outside .invalid')).toBeVisible();
  await expect(suffix).toBeEnabled();
  await expect(file).toBeEnabled();
});

test('candidate filters remain contained at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('textbox', { name: 'Brand or domain' }).fill('scope.invalid');
  await page.getByRole('textbox', { name: 'TLDs' }).fill('invalid');
  await page.getByRole('button', { name: 'Generate candidates' }).click();

  await expect(page.getByRole('combobox', { name: 'Candidate scope' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Mutation family' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Candidate sort' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
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
  await page.getByRole('button', { name: /^Common edits\b/u }).click();
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

  await page.getByRole('button', { name: /^Impersonation\b/u }).click();
  await expect(keyboardLayout).toBeDisabled();
  await expect(page.locator('.generation-options')).toContainText('Not used by the selected preset');
});

test('all-layout mode and a local custom dictionary add bounded reviewable candidates', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /^Common edits\b/u }).click();
  await page.getByRole('textbox', { name: 'Brand or domain' }).fill('z.test');
  await page.getByRole('textbox', { name: 'TLDs' }).fill('test');
  await page.getByRole('combobox', { name: 'Keyboard layout' }).selectOption('all');
  await page.getByRole('button', { name: 'Generate candidates' }).click();
  await expect(page.locator('.candidate strong', { hasText: /^e\.test$/ })).toBeVisible();
  await expect(page.locator('.candidate strong', { hasText: /^t\.test$/ })).toBeVisible();

  await page.getByRole('button', { name: /^Impersonation\b/u }).click();
  await page.getByText(/^Custom dictionary/u).click();
  const dictionaryInput = page.locator('.dictionary-file input[type="file"]');
  const dictionaryPicker = page.locator('.dictionary-file label');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await dictionaryInput.focus();
    await expect(dictionaryInput).toBeFocused();
    await expect(dictionaryPicker).toHaveCSS('outline-style', 'solid');
    await expect(dictionaryPicker).toHaveCSS('outline-width', '2px');
  }
  await dictionaryInput.setInputFiles({
    name: 'review-terms.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('invoice\ncustomer-care\nbad!\n'),
  });
  await expect(page.getByText('Loaded review-terms.txt.')).toBeVisible();
  await expect(page.getByText(/^Custom dictionary · 2 accepted terms$/u)).toBeVisible();
  await expect(page.getByText('1 invalid term will be ignored.')).toBeVisible();

  await page.getByRole('textbox', { name: 'Brand or domain' }).fill('acme.test');
  await page.getByRole('button', { name: 'Generate candidates' }).click();
  await expect(page.locator('.candidate').filter({
    has: page.locator('strong', { hasText: /^invoice-acme\.test$/ }),
  })).toContainText('Impersonation term');
  await expect(page.locator('.candidate').filter({
    has: page.locator('strong', { hasText: /^acme-customer-care\.test$/ }),
  })).toContainText('Impersonation term');
  await expect(page.locator('.status')).toContainText('Ignored 1 invalid custom dictionary term');
  await expectNoHorizontalOverflow(page);
});

test('custom dictionary can replace explicit first and last domain tokens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /^Custom families\b/u }).click();
  for (const checkbox of await page.locator('.family-grid input[type="checkbox"]').all()) await checkbox.uncheck();
  await page.getByRole('checkbox', { name: 'Dictionary token replacement' }).check();
  await page.getByText(/^Custom dictionary/u).click();
  await page.getByRole('textbox', { name: 'Dictionary terms' }).fill('account\nsupport');
  await page.getByRole('textbox', { name: 'Brand or domain' }).fill('alpha-portal.test');
  await page.getByRole('button', { name: 'Generate candidates' }).click();

  for (const domain of [
    'account-portal.test',
    'alpha-account.test',
    'support-portal.test',
    'alpha-support.test',
  ]) {
    await expect(page.locator('.candidate').filter({
      has: page.locator('strong', { hasText: new RegExp(`^${domain.replace('.', '\\.')}$`) }),
    })).toContainText('Dictionary token replacement');
  }
  await expect(page.locator('.candidate strong', { hasText: /^login-alpha-portal\.test$/ })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('custom family mode generates only the analyst-selected mutation families', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /^Custom families\b/u }).click();

  const familyCheckboxes = page.locator('.family-grid input[type="checkbox"]');
  expect(await familyCheckboxes.count()).toBeGreaterThan(10);
  for (const checkbox of await familyCheckboxes.all()) await checkbox.uncheck();
  await expect(page.getByText('Select at least one family before generating candidates.')).toBeVisible();

  await page.getByRole('textbox', { name: 'Brand or domain' }).fill('acme.test');
  await page.getByRole('button', { name: 'Generate candidates' }).click();
  await expect(page.getByRole('alert')).toContainText('Select at least one custom mutation family');

  await page.getByRole('checkbox', { name: 'Plural form' }).check();
  await page.getByRole('checkbox', { name: 'TLD embedded in label' }).check();
  await page.getByRole('button', { name: 'Generate candidates' }).click();

  await expect(page.locator('.candidate').filter({
    has: page.locator('strong', { hasText: /^acmes\.test$/ }),
  })).toContainText('Plural form');
  await expect(page.locator('.candidate').filter({
    has: page.locator('strong', { hasText: /^acmetest\.test$/ }),
  })).toContainText('TLD embedded in label');
  await expect(page.locator('.candidate strong', { hasText: /^acm\.com$/ })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Mutation family' }).locator('option')).toHaveCount(3);
  await expectNoHorizontalOverflow(page);
});

test('advanced two-character Unicode generation is explicit, bounded, and reviewable', async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('textbox', { name: 'Brand or domain' }).fill('scope.invalid');
  await page.getByRole('textbox', { name: 'TLDs' }).fill('invalid');
  await page.getByRole('button', { name: 'Generate candidates' }).click();
  await expect(page.getByRole('combobox', { name: 'Mutation family' })
    .locator('option[value="unicode_homoglyph_depth_2"]')).toHaveCount(0);

  await page.getByRole('button', { name: /^Custom families\b/u }).click();
  const advanced = page.getByRole('checkbox', { name: /Advanced two-character Unicode confusable/u });
  await expect(advanced).not.toBeChecked();
  await expect(page.getByText(/Advanced generation is excluded from every preset/u)).toBeVisible();
  for (const checkbox of await page.locator('.family-grid input[type="checkbox"]').all()) await checkbox.uncheck();
  await advanced.check();
  await page.getByRole('button', { name: 'Generate candidates' }).click();

  await expect(page.locator('.status')).toContainText('generated 59 label variants');
  await expect(page.locator('.status')).toContainText('excluded 225 cross-script or invalid combinations by policy');
  await expect(page.getByRole('combobox', { name: 'Mutation family' })
    .locator('option[value="unicode_homoglyph_depth_2"]'))
    .toHaveText('Advanced two-character Unicode confusable (59)');
  await expect(page.locator('.candidate')).toHaveCount(59);
  await expect(page.locator('.candidate').first()).toContainText('Unicode:');
  await expect(page.locator('.candidate').first()).toContainText('Advanced two-character Unicode confusable');
  await expect(page.locator('.candidate').first()).toContainText('Source or profile visual match');
  await expectNoHorizontalOverflow(page);
});

test('multi-word lookalikes retain separator and reordering provenance', async ({ page }) => {
  await page.getByRole('button', { name: /^Common edits\b/u }).click();
  await page.getByRole('textbox', { name: 'Brand or domain' }).fill('Acme Pay');
  await page.getByRole('textbox', { name: 'TLDs' }).fill('com');
  await page.getByRole('button', { name: 'Generate candidates' }).click();
  await page.getByRole('combobox', { name: 'Candidate sort' }).selectOption('generated');

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
  await page.getByRole('textbox', { name: 'Brand or domain' }).fill('acme.test');
  await page.getByRole('textbox', { name: 'TLDs' }).fill('com, net');
  await page.getByRole('button', { name: 'Generate candidates' }).click();
  await page.getByRole('combobox', { name: 'Candidate sort' }).selectOption('generated');

  const exactSubstitution = page.locator('.candidate').filter({
    has: page.locator('strong', { hasText: /^acme\.net$/ }),
  });
  await expect(exactSubstitution).toContainText('Selected TLD substitution');
  await page.getByRole('textbox', { name: 'Filter candidates' }).fill('acm.net');
  const combined = page.locator('.candidate').filter({
    has: page.locator('strong', { hasText: /^acm\.net$/ }),
  });
  await expect(combined).toContainText('Character omission');
  await expect(combined).toContainText('Selected TLD substitution');
  await page.getByRole('textbox', { name: 'Filter candidates' }).fill('acme.test');
  await expect(page.locator('.candidate strong', { hasText: /^acme\.test$/ })).toHaveCount(0);
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
  await expect(page.getByRole('combobox', { name: 'Candidate sort' })).toHaveValue('certificate-newest');
  await expect(page.locator('.sort-guidance')).toContainText('Certificate-log candidates are ordered by their latest retained observation');
  // Newest last-observation first: other.invalid (2026-09) before example.invalid (2026-06).
  await expect(page.locator('.candidate strong')).toHaveText(['other.invalid', 'example.invalid']);

  await page.getByRole('combobox', { name: 'Candidate sort' }).selectOption('domain');
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page.getByRole('combobox', { name: 'Candidate sort' })).toHaveValue('certificate-newest');
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

  await expect(page.getByRole('heading', { name: '0 selected of 2' })).toBeVisible();

  const firstCheckbox = page.locator('.candidate input[type="checkbox"]').first();
  await firstCheckbox.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { name: '1 selected of 2' })).toBeVisible();
});

test('an allowlisted canonical domain is excluded when a profile is active', async ({ page }) => {
  const profile = {
      id: 'p1', name: 'Example', officialDomains: ['example.invalid'], productNames: [], tlds: [],
      approvedPartnerDomains: [], allowlistedDomains: [], allowlistedRegistrars: [], dkimSelectors: [],
      trademarkOwner: '', trademarkRegistration: '', officialFaviconHash: '', officialFaviconPHash: '',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
  await migrateLegacyBrowserData(page, {
    'whois-rdap-brand-profiles-v1': [profile],
    'whois-rdap-active-brand-profile-v1': 'p1',
    'whoisleuth:ct-search-history:v1': {
      version: 1,
      entries: [{
        query: 'example', baselineAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z',
        domains: ['other.invalid'],
        history: [{ checkedAt: '2026-05-01T00:00:00.000Z', resultCount: 1, certificateCount: 1, newCount: 0, newDomains: [], truncated: false }],
      }],
    },
  });
  await mockCtSearch(page, structuredResponse);
  await runCtSearch(page);

  await expect(page.locator('.candidate')).toHaveCount(1);
  await expect(page.locator('.candidate strong')).toHaveText(['other.invalid']);
  await expect(page.locator('.status')).toContainText('excluded 1 trusted profile domain');
  await expect(page.locator('.status')).toContainText('0 first observed · 0 reappeared · 1 continuing since the previous complete search');
  await expect(page.getByRole('button', { name: 'Not in prior complete · 0' })).toBeVisible();
  await expect(page.locator('.ct-history-state.continuing')).toHaveCount(1);
});

test('Continue to Bulk loads canonical domains and CT provenance survives the handoff', async ({ page }) => {
  await mockCtSearch(page, structuredResponse);
  await runCtSearch(page);

  await page.getByRole('button', { name: 'Select filtered (2)' }).click();
  await page.getByRole('button', { name: 'Continue to Bulk with 2' }).click();
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
    await page.getByRole('button', { name: 'Select filtered (2)' }).click();
    await page.getByRole('button', { name: 'Continue to Bulk with 2' }).click();
    await expect(page).toHaveURL(/\/bulk/);

    await page.getByRole('button', { name: /^Scan 2 domains$/ }).click();
    await expect(page.locator('.status')).toHaveText('Completed 2 of 2 lookups.', { timeout: 20_000 });

    const exampleRow = page.locator('.results-table tbody tr', { hasText: 'example.invalid' }).first();
    const ctDetails = exampleRow.locator('details.ct-source');
    await expect(ctDetails.locator('summary')).toHaveText('Certificate Transparency');
    await ctDetails.locator('summary').click();
    await expect(ctDetails).toContainText('2 observed hostnames');
    await expect(ctDetails).toContainText('4 distinct certificates');
    await expect(ctDetails.locator('time[datetime="2026-06-01T00:00:00.000Z"]')).toBeVisible();
  });
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
  await expect(page.locator('.ct-history-state.first_observed')).toHaveCount(1);

  await page.reload();
  await runCtSearch(page);
  await expect(page.locator('.status')).toContainText('1 first observed · 0 reappeared · 1 continuing since the previous complete search');
  await expect(page.locator('.ct-history-state.first_observed')).toHaveCount(1);
  await expect(page.locator('.candidate', { has: page.locator('.ct-history-state.first_observed') }).locator('strong')).toHaveText('other.invalid');
  const history = page.locator('details.ct-history');
  await history.locator(':scope > summary').click();
  await history.locator('.ct-checks > summary').click();
  const plot = history.getByRole('img', { name: 'Certificate search trend across 2 retained checks, including 0 capped lower-bound checks, positioned by elapsed check time' });
  await expect(plot).toBeVisible();
  await expect(plot.locator('.axis-timestamp')).toHaveCount(2);
  for (const label of await plot.locator('.axis-timestamp').allTextContents()) {
    expect(label).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  }
  await expect(plot.locator('line.trend-segment')).toHaveCount(1);
  await expect(history).toContainText('Horizontal spacing represents elapsed time');

  const newOnly = page.getByRole('button', { name: 'Not in prior complete · 1' });
  await newOnly.click();
  await expect(newOnly).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.candidate')).toHaveCount(1);
  await expect(page.locator('.candidate strong')).toHaveText(['other.invalid']);
});

test('complete CT history distinguishes a reappearance from first and continuing observations', async ({ page }) => {
  let requestCount = 0;
  await page.route('**/api/ct-search**', (route) => {
    requestCount += 1;
    const body = requestCount === 1
      ? initialBaselineResponse
      : requestCount === 2
        ? otherOnlyResponse
        : structuredResponse;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await runCtSearch(page);
  await runCtSearch(page);
  await expect(page.locator('.status')).toContainText('1 first observed · 0 reappeared · 0 continuing since the previous complete search');
  await runCtSearch(page);
  await expect(page.locator('.status')).toContainText('0 first observed · 1 reappeared · 1 continuing since the previous complete search');
  const reappeared = page.locator('.candidate', { has: page.locator('.ct-history-state.reappeared') });
  await expect(reappeared.locator('strong')).toHaveText('example.invalid');
  await expect(reappeared).toContainText('Reappeared after complete-baseline absence');
  await expect(page.locator('.candidate', { has: page.locator('.ct-history-state.continuing') }).locator('strong')).toHaveText('other.invalid');
});

test('certificate history uses a compact mobile summary without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  let requestCount = 0;
  await page.route('**/api/ct-search**', (route) => {
    requestCount += 1;
    const body = requestCount === 1 ? initialBaselineResponse : structuredResponse;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await runCtSearch(page);
  await runCtSearch(page);
  const history = page.locator('details.ct-history');
  await history.locator(':scope > summary').click();
  await history.locator('.ct-checks > summary').click();

  const summary = history.locator('.ct-trend-summary');
  await expect(summary).toBeVisible();
  await expect(summary.locator('dt')).toHaveText(['First', 'Latest', 'Peak', 'Newly found', 'Capped checks']);
  await expect(summary.locator('dd')).toHaveText(['1', '2', '2', '1', '0']);
  await expect(history.locator('.ct-trend svg')).toBeHidden();
  await expect.poll(() => history.locator('.ct-trend').evaluate((element) => (
    element.scrollWidth <= element.clientWidth
  ))).toBe(true);
  await expect.poll(() => page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
});

test('previous certificate searches can be reused and deleted', async ({ page }) => {
  await mockCtSearch(page, { ...initialBaselineResponse, keyword: 'Example Brand' });
  await runCtSearch(page, 'Example Brand');

  const history = page.locator('details.ct-history');
  const historySummary = history.locator(':scope > summary');
  await expect(historySummary).toContainText('Previous certificate searches · 1');
  await historySummary.click();
  await expect(history).toContainText('example brand');
  await expect(history).toContainText('1 retained check');
  await history.locator('.ct-checks > summary', { hasText: 'View check history' }).click();
  await expect(history.locator('.ct-checks')).toContainText('1 result · 1 first · 0 reappeared · 0 continuing');

  await page.locator('.fields input').first().fill('different');
  await history.getByRole('button', { name: 'Use example brand certificate search' }).click();
  await expect(page.locator('.fields input').first()).toHaveValue('example brand');

  page.once('dialog', (dialog) => dialog.accept());
  await history.getByRole('button', { name: 'Delete example brand certificate history' }).click();
  await expect(page.locator('details.ct-history')).toHaveCount(0);
});

test('certificate history distinguishes exact capacity from confirmed pruning', async ({ page }) => {
  test.slow();
  await migrateLegacyBrowserData(page, {
    'whoisleuth:ct-search-history:v1': ctHistoryStoreFixture(20),
  }, { clearStorage: true });
  await page.getByRole('tab', { name: 'Certificates' }).click();

  let history = page.locator('details.ct-history');
  await history.locator(':scope > summary').click();
  await history.locator('.ct-checks > summary').click();
  await expect(history.locator('.history-limit')).toContainText('At capacity with 20 retained checks');
  await expect(history.locator('.history-limit')).toContainText('No older check has been discarded');
  await expect(history.locator('.axis-timestamp')).toHaveText([
    '2026-01-01T12:00:00.000Z',
    '2026-01-20T12:19:00.000Z',
  ]);

  await migrateLegacyBrowserData(page, {
    'whoisleuth:ct-search-history:v1': ctHistoryStoreFixture(21),
  }, { clearStorage: true });
  await page.getByRole('tab', { name: 'Certificates' }).click();
  history = page.locator('details.ct-history');
  await history.locator(':scope > summary').click();
  await history.locator('.ct-checks > summary').click();
  await expect(history.locator('.history-limit')).toContainText('1 older check was discarded by local retention');
  await expect(history.locator('.history-limit')).not.toContainText('No older check has been discarded');
  await expect(history.locator('.axis-timestamp')).toHaveText([
    '2026-01-02T12:01:00.000Z',
    '2026-01-21T12:20:00.000Z',
  ]);
  const stored = await readBrowserLocalCollection(page, 'ct_history', { minimumRecords: 1 });
  expect(stored.manifest.schemaVersion).toBe(3);
  expect(stored.records[0]?.value).toMatchObject({
    discardedCheckCount: 1,
    discardedCheckCountKnown: true,
    discardedCheckCountCapped: false,
  });
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
  await expect(page.locator('.ct-history-state.unclassified_partial')).toHaveCount(2);
  await expect(page.locator('.ct-history-state.reappeared')).toHaveCount(0);
  const history = page.locator('details.ct-history');
  await history.locator(':scope > summary').click();
  await history.locator('.ct-checks > summary').click();
  const plot = history.getByRole('img', { name: /including 1 capped lower-bound check, positioned by elapsed check time/u });
  await expect(plot).toBeVisible();
  const cappedMarker = plot.locator('polygon.trend-marker.capped');
  await expect(cappedMarker).toHaveCount(1);
  await expect(cappedMarker.locator('title')).toContainText('at least 2 results, at least 1 new');
  await expect(plot.locator('line.trend-segment')).toHaveCount(0);
  await expect(plot.locator(':scope > title')).toContainText('including 1 capped lower-bound check');
  await expect(history).toContainText('1 capped check is a diamond lower-bound marker');
  await expect(history).toContainText('Segments touching a capped check are omitted, leaving visible gaps');
  const cappedHistoryRow = history.locator('.ct-checks li', { hasText: 'capped lower bound' });
  await expect(cappedHistoryRow).toContainText('At least 2 results · continuity and reappearance unclassified · capped lower bound');

  await page.setViewportSize({ width: 393, height: 852 });
  const summary = history.locator('.ct-trend-summary');
  await expect(summary).toBeVisible();
  await expect(summary.locator('dd')).toHaveText(['1', 'At least 2', 'At least 2', 'At least 1', '1']);

  // The third complete response matches the original baseline. If the capped
  // response had replaced it, the original domain would be mislabelled new.
  await runCtSearch(page);
  await expect(page.locator('.status')).toContainText('0 first observed · 0 reappeared · 1 continuing since the previous complete search');
  await expect(page.locator('.ct-history-state.continuing')).toHaveCount(1);
});

test('corrupt local CT history remains unavailable and is never replaced by a new baseline', async ({ page }) => {
  const malformed = '{broken-json';
  await migrateLegacyBrowserData(page, { 'whoisleuth:ct-search-history:v1': malformed });

  await expect(page.getByRole('heading', { name: 'Browser-local data unavailable' })).toBeVisible();
  await expect(page.getByText('Legacy Certificate Transparency history data is malformed and was not migrated.')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('whoisleuth:ct-search-history:v1'))).toBe(malformed);
  const retained = await page.evaluate(async (collectionId) => {
    const databases = await indexedDB.databases();
    if (!databases.some((database) => database.name === 'whoisleuth-browser-data-v1')) {
      return { manifest: false, records: 0 };
    }
    const request = indexedDB.open('whoisleuth-browser-data-v1');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction(['manifests', 'records'], 'readonly');
      const manifestRequest = transaction.objectStore('manifests').get(collectionId);
      const recordsRequest = transaction.objectStore('records').index('collection').count(collectionId);
      const [manifest, records] = await Promise.all([
        new Promise<unknown>((resolve, reject) => {
          manifestRequest.onsuccess = () => resolve(manifestRequest.result);
          manifestRequest.onerror = () => reject(manifestRequest.error);
        }),
        new Promise<number>((resolve, reject) => {
          recordsRequest.onsuccess = () => resolve(recordsRequest.result);
          recordsRequest.onerror = () => reject(recordsRequest.error);
        }),
      ]);
      return { manifest: manifest !== undefined, records };
    } finally {
      database.close();
    }
  }, 'ct_history');
  expect(retained).toEqual({ manifest: false, records: 0 });
});

test('a browser storage write failure does not hide valid CT search results', async ({ page }) => {
  await expect(page.getByRole('tab', { name: 'Certificates' })).toBeVisible();
  await readBrowserLocalCollection(page, 'ct_history');
  await failBrowserLocalManifestWrites(page, 'ct_history');
  await mockCtSearch(page, initialBaselineResponse);
  await runCtSearch(page);

  await expect(page.locator('.candidate')).toHaveCount(1);
  await expect(page.locator('.candidate strong')).toHaveText(['example.invalid']);
  await expect(page.locator('.status')).toContainText('Found 1 registrable domain from 4 certificates');
  await expect(page.locator('.ct-history-notice')).toContainText('out of storage space');
});

test('a future CT history schema is never overwritten by an older app', async ({ page }) => {
  const future = { version: 4, entries: [{ future: true }] };
  await migrateLegacyBrowserData(page, { 'whoisleuth:ct-search-history:v1': future });

  await expect(page.getByRole('heading', { name: 'Browser-local data unavailable' })).toBeVisible();
  await expect(page.getByText(/created by a newer app version/)).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('whoisleuth:ct-search-history:v1') || 'null'));
  expect(stored).toEqual(future);
});

test('switching tabs during an in-flight CT request does not leave the UI stuck', { tag: '@timing-sensitive' }, async ({ page }) => {
  let markFirstRequestStarted = () => {};
  const firstRequestStarted = new Promise<void>((resolve) => {
    markFirstRequestStarted = resolve;
  });
  let releaseFirstResponse = () => {};
  const firstResponseReleased = new Promise<void>((resolve) => {
    releaseFirstResponse = resolve;
  });
  let requestCount = 0;
  await page.route('**/api/ct-search**', async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      markFirstRequestStarted();
      await firstResponseReleased;
    }
    try {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(structuredResponse) });
    } catch {
      /* request was aborted by the tab switch; nothing to fulfill */
    }
  });

  await page.getByRole('tab', { name: 'Certificates' }).click();
  await page.locator('.fields input').first().fill('example');
  await page.getByRole('button', { name: 'Search certificates' }).click();
  await firstRequestStarted;
  await expect(page.getByRole('button', { name: /Searching/ })).toBeDisabled();

  // Switch tabs mid-request: the loading/disabled state must not get stuck.
  await page.getByRole('tab', { name: 'Lookalikes' }).click();
  releaseFirstResponse();
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

test('discovery method tabs reflow without an inner scrollbar on narrow phones', async ({ page }) => {
  for (const width of [320, 360, 375]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto('/discover');
    const methods = page.getByRole('tablist', { name: 'Discovery method' });
    await expect(methods.getByRole('tab')).toHaveCount(4);
    expect(await methods.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expectNoHorizontalOverflow(page);
  }
});
