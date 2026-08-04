import { expect, test } from './fixtures';
import { boundingBox, expectNoHorizontalOverflow, migrateLegacyBrowserData, readBrowserLocalCollection } from './helpers';
import { readFile } from 'node:fs/promises';
import { TEST_SITE_PASSWORD } from './constants';
import { ACTIVE_PROFILE_KEY } from '../frontend/src/lib/brand-profiles';

// Every value here is deliberately dotless (no TLD), so classifyQuery on the
// server rejects it with a 400 before any RDAP/WHOIS/DNS call - these tests
// never trigger a live lookup, only client-side parsing/navigation.

test.beforeEach(async ({ page }) => {
  await page.goto('/lookup');
});

test('a single domain can be entered normally', async ({ page }) => {
  const query = page.locator('#query');
  await query.fill('bad-domain-one');
  await expect(query).toHaveValue('bad-domain-one');
  await expect(page.getByRole('button', { name: 'Run lookup' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Deep/u })).toBeChecked();
  await expect(page.getByRole('radio', { name: /Fast/u })).not.toBeChecked();
  await expect(page.getByText('Separate multiple domains with commas, semicolons, tabs, or new lines.')).toBeVisible();
  await expect(page.getByText('Press Ctrl+Enter or ⌘+Enter to run.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run lookup' })).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
});

test('the query keyboard shortcut uses the validated lookup submission', async ({ page }) => {
  let lookupRequests = 0;
  await page.route('**/api/lookup?*', async (route) => {
    lookupRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: 'shortcut.example.test',
        type: 'domain',
        registrableDomain: 'example.test',
        availability: {
          applicable: true,
          state: 'registered',
          confidence: 'medium',
          domain: 'example.test',
          deepScanComplete: true,
        },
        rdap: { error: 'Fixture source unavailable' },
        whois: { parsed: {}, chain: [] },
        diagnostics: {
          version: 8,
          rdap: { status: 'error' },
          whois: { status: 'partial' },
          availability: { status: 'complete' },
        },
      }),
    });
  });

  const query = page.locator('#query');
  await query.fill('shortcut.example.test');
  await query.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'registered' })).toBeVisible();
  expect(lookupRequests).toBe(1);
});

test('fast lookup mode is explicit and sends the fast contract parameter', async ({ page }) => {
  let releaseLookup: (() => void) | undefined;
  const lookupGate = new Promise<void>((resolve) => {
    releaseLookup = resolve;
  });
  await page.route('**/api/lookup?*', async (route) => {
    const url = new URL(route.request().url());
    await lookupGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: url.searchParams.get('q'), type: 'domain', registrableDomain: 'example.test',
        availability: { applicable: true, state: 'registered', confidence: 'medium', domain: 'example.test', deepScanComplete: false },
        rdap: { error: 'Fixture source unavailable' }, whois: { skipped: true, detail: 'WHOIS is omitted in fast RDAP-only mode.' },
        diagnostics: { version: 7, rdap: { status: 'error' }, whois: { status: 'skipped' }, availability: { status: 'complete' } },
      }),
    });
  });

  await page.locator('#query').fill('example.test');
  await expect(page.getByRole('radio', { name: /Deep/u })).toBeChecked();
  await page.getByRole('radio', { name: /Fast/u }).check();
  await expect(page.getByText(/Fast returns lower-request registration evidence/u)).toBeVisible();

  const requestPromise = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === '/api/lookup' && url.searchParams.get('fast') === '1';
  });
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await requestPromise;
  await expect(page.getByText(/Fast lookup is checking authoritative registration evidence/u)).toBeVisible();
  releaseLookup?.();
  await expect(page.getByRole('heading', { name: 'registered' })).toBeVisible();
});

test('deep lookup reports pending elapsed time and final source settle timing', async ({ page }) => {
  let releaseLookup: (() => void) | undefined;
  const lookupGate = new Promise<void>((resolve) => {
    releaseLookup = resolve;
  });
  await page.route('**/api/lookup?*', async (route) => {
    await lookupGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: 'timing.example.test',
        type: 'domain',
        registrableDomain: 'example.test',
        availability: {
          applicable: true,
          state: 'registered',
          confidence: 'medium',
          domain: 'example.test',
          deepScanComplete: true,
        },
        rdap: { error: 'Fixture source unavailable' },
        whois: { parsed: {}, chain: [] },
        diagnostics: {
          version: 8,
          timing: {
            version: 1,
            totalMs: 2_400,
            sources: [
              { source: 'rdap', outcome: 'rejected', durationMs: 700, completedAfterMs: 700 },
              { source: 'whois', outcome: 'fulfilled', durationMs: 2_000, completedAfterMs: 2_100 },
              { source: 'domain_evidence', outcome: 'fulfilled', durationMs: 2_200, completedAfterMs: 2_300 },
            ],
          },
          rdap: { status: 'error' },
          whois: { status: 'partial' },
          availability: { status: 'complete' },
        },
      }),
    });
  });

  await page.locator('#query').fill('timing.example.test');
  await page.getByRole('button', { name: 'Run lookup' }).click();

  const pending = page.locator('.loading-note');
  await expect(page.getByRole('status')).toContainText('Deep lookup is waiting for one final response');
  await expect(pending.locator('.loading-meta')).toContainText(/elapsed/u);
  await expect(pending.locator('.collection-trace')).toContainText('Registry RDAP');
  await expect(pending.locator('.collection-trace')).toContainText('Domain evidence');
  await expect(page.getByRole('button', { name: 'Cancel lookup' })).toBeVisible();
  releaseLookup?.();

  await expect(page.getByRole('heading', { name: 'registered' })).toBeVisible();
  const coverage = page.getByRole('region', { name: 'Evidence coverage' });
  await expect(coverage).toBeVisible();
  await expect(coverage.getByRole('group', { name: 'Evidence coverage summary' })).toContainText('2.4 s total');
  await coverage.getByText(/Review \d+ source and analysis records/u).click();
  await expect(coverage).toContainText('700 ms');
  await expect(coverage).toContainText('Request error');
  await expect(coverage).toContainText('WHOIS');
  await expect(coverage).toContainText('A bounded homepage request covering redirects, response metadata, and a capped body prefix.');
  await expect(coverage).toContainText('2.0 s');
  const diagnostics = coverage.locator('details.timing-detail');
  await expect(diagnostics).not.toHaveAttribute('open', '');
  await diagnostics.getByText('Request diagnostics', { exact: true }).click();
  await expect(diagnostics.getByRole('heading', { name: 'Collection timing' })).toBeVisible();
  await expect(diagnostics.getByRole('img', { name: 'Overlapping collection timing for 3 source branches' })).toBeVisible();
  const timingSummary = diagnostics.locator('.timing-summary');
  await expect(timingSummary).toContainText('Longest branch');
  await expect(timingSummary).toContainText('Domain evidence');
  await expect(timingSummary).toContainText('Request errors');
  await expect(timingSummary).toContainText('1 branch');
  await page.setViewportSize({ width: 320, height: 720 });
  await expect(diagnostics.locator('svg')).toBeHidden();
  await expect(diagnostics.locator('.mobile-timing')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('browser-local profile failure does not block collected lookup evidence', async ({ page }) => {
  await page.route('**/api/lookup?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      query: 'local-context.example.test',
      type: 'domain',
      registrableDomain: 'example.test',
      availability: {
        applicable: true,
        state: 'registered',
        confidence: 'medium',
        domain: 'example.test',
        deepScanComplete: true,
      },
      rdap: { error: 'Fixture source unavailable' },
      whois: { parsed: {}, chain: [] },
      diagnostics: {
        version: 8,
        rdap: { status: 'error' },
        whois: { status: 'partial' },
        availability: { status: 'complete' },
      },
    }),
  }));
  await page.evaluate((activeProfileKey) => {
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(key: string) {
      if (key === activeProfileKey) {
        throw new DOMException('Active profile storage is unavailable', 'InvalidStateError');
      }
      return originalGetItem.call(this, key);
    };
  }, ACTIVE_PROFILE_KEY);

  await page.locator('#query').fill('local-context.example.test');
  await page.getByRole('button', { name: 'Run lookup' }).click();

  await expect(page.getByRole('heading', { name: 'registered' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('an analyst can cancel a pending lookup without retaining a partial result', async ({ page }) => {
  let releaseLookup: (() => void) | undefined;
  const lookupGate = new Promise<void>((resolve) => {
    releaseLookup = resolve;
  });
  await page.route('**/api/lookup?*', async (route) => {
    await lookupGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: 'cancel.example.test',
        type: 'domain',
        registrableDomain: 'example.test',
        rdap: {},
        whois: {},
        availability: { applicable: true, state: 'unknown' },
        diagnostics: { version: 8 },
      }),
    }).catch(() => {});
  });

  await page.locator('#query').fill('cancel.example.test');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await page.getByRole('button', { name: 'Cancel lookup' }).click();

  await expect(page.getByRole('alert')).toHaveText('Lookup cancelled. No partial response was retained.');
  await expect(page.locator('#result')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run lookup' })).toBeEnabled();
  releaseLookup?.();
});

test('navigation away aborts the browser wait without restoring a late result', async ({ page }) => {
  let releaseLookup: (() => void) | undefined;
  const lookupGate = new Promise<void>((resolve) => {
    releaseLookup = resolve;
  });
  await page.route('**/api/lookup?*', async (route) => {
    await lookupGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: 'navigation.example.test',
        type: 'domain',
        registrableDomain: 'example.test',
        rdap: {},
        whois: {},
        availability: { applicable: true, state: 'registered' },
        diagnostics: { version: 8 },
      }),
    }).catch(() => {});
  });

  await page.locator('#query').fill('navigation.example.test');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await page.locator('#console-navigation').getByRole('link', { name: /^Dashboard/ }).click();
  await expect(page).toHaveURL('/dashboard');
  releaseLookup?.();
  await page.locator('#console-navigation').getByRole('link', { name: /^Lookup/ }).click();

  await expect(page.locator('#query')).toHaveValue('navigation.example.test');
  await expect(page.locator('#result')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test.describe('lookup timeout presentation', () => {
  test.use({ allowExpectedLookup504Noise: true });

  test('a bounded server timeout remains an explicit neutral request failure', async ({ page }) => {
    await page.route('**/api/lookup?*', async (route) => route.fulfill({
      status: 504,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'Lookup timed out before a final response was available.',
        errorCode: 'LOOKUP_TIMEOUT',
      }),
    }));

    await page.locator('#query').fill('timeout.example.test');
    await page.getByRole('button', { name: 'Run lookup' }).click();

    await expect(page.getByRole('alert')).toHaveText('Lookup timed out before a final response was available.');
    await expect(page.locator('#result')).toHaveCount(0);
  });
});

test('keeps the current Lookup form and result during console navigation only', async ({ page }) => {
  let requestCount = 0;
  await page.route('**/api/lookup?*', async (route) => {
    requestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: 'portal.example.test', type: 'domain', registrableDomain: 'example.test',
        availability: { applicable: true, state: 'registered', confidence: 'high', domain: 'example.test', deepScanComplete: true },
        rdap: { error: 'Fixture source unavailable' }, whois: { parsed: {}, chain: [] },
        diagnostics: { version: 7, rdap: { status: 'error' }, whois: { status: 'partial' }, availability: { status: 'complete' } },
      }),
    });
  });

  await page.locator('#query').fill('portal.example.test');
  await page.getByRole('checkbox', { name: /Retrieve security\.txt contacts/u }).check();
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.getByRole('heading', { name: 'registered' })).toBeVisible();

  const consoleNavigation = page.locator('#console-navigation');
  await consoleNavigation.getByRole('link', { name: /^Dashboard/ }).click();
  await consoleNavigation.getByRole('link', { name: /^Lookup/ }).click();

  await expect(page.locator('#query')).toHaveValue('portal.example.test');
  await expect(page.getByRole('radio', { name: /Deep/u })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Retrieve security\.txt contacts/u })).toBeChecked();
  await expect(page.getByRole('heading', { name: 'registered' })).toBeVisible();
  expect(requestCount).toBe(1);

  await page.reload();
  await expect(page.locator('#query')).toHaveValue('');
  await expect(page.locator('#result')).toHaveCount(0);
});

test('clears transient Lookup state when signing out through the Console', async ({ page }) => {
  await page.locator('#query').fill('transient-state.example.test');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/login');

  await page.getByLabel('Password').fill(TEST_SITE_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/dashboard');
  await page.locator('#console-navigation').getByRole('link', { name: /^Lookup/ }).click();

  await expect(page.locator('#query')).toHaveValue('');
  await expect(page.locator('#result')).toHaveCount(0);
});

test('does not show a saved Fast result after a same-domain Deep handoff', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => {
    const url = new URL(route.request().url());
    const domain = url.searchParams.get('q') || 'same-depth.example.test';
    const compact = url.searchParams.get('compact') === '1';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(compact ? {
        availability: { applicable: true, state: 'registered', confidence: 'high', domain, deepScanComplete: true },
        diagnostics: { version: 7, rdap: { status: 'complete' }, whois: { status: 'skipped' }, availability: { status: 'complete' } },
      } : {
        query: domain,
        type: 'domain',
        registrableDomain: domain,
        availability: { applicable: true, state: 'registered', confidence: 'medium', domain, deepScanComplete: false },
        rdap: { parsed: {}, data: {} },
        whois: { skipped: true, detail: 'WHOIS is omitted in fast mode.' },
        diagnostics: { version: 7, rdap: { status: 'complete' }, whois: { status: 'skipped' }, availability: { status: 'complete' } },
      }),
    });
  });

  const domain = 'same-depth.example.test';
  await page.locator('#query').fill(domain);
  await page.getByRole('radio', { name: /Fast/u }).check();
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.getByRole('heading', { name: 'registered' })).toBeVisible();

  await page.locator('#console-navigation').getByRole('link', { name: /^Bulk/ }).click();
  await page.locator('#domains').fill(domain);
  await page.getByLabel('Scan mode').selectOption('deep');
  await page.getByRole('button', { name: 'Scan 1 domain' }).click();
  await expect(page.locator('.results-table tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Inspect', exact: true }).click();

  await expect(page.locator('#query')).toHaveValue(domain);
  await expect(page.getByRole('radio', { name: /Deep/u })).toBeChecked();
  await expect(page.locator('#result')).toHaveCount(0);
});

test('a malformed successful response is rejected at the Lookup boundary', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      query: 'example.test',
      type: 'domain',
      rdap: {},
      whois: {},
      availability: {},
    }),
  }));

  await page.goto('/lookup');
  await page.locator('#query').fill('example.test');
  await page.getByRole('button', { name: 'Run lookup' }).click();

  await expect(page.getByRole('alert')).toHaveText('Lookup returned an invalid response.');
  await expect(page.locator('#result')).toHaveCount(0);
});

test('security.txt collection is explicit, separately presented, and mobile safe', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: 'portal.example.test', type: 'domain', inputHostname: 'portal.example.test',
        registrableDomain: 'example.test', isSubdomain: true,
        availability: { applicable: true, state: 'registered', confidence: 'high', domain: 'example.test' },
        rdap: { error: 'Fixture source unavailable' }, whois: { parsed: {}, chain: [] },
        diagnostics: { version: 7, rdap: { status: 'error' }, whois: { status: 'partial' }, availability: { status: 'complete' } },
        securityTxt: {
          securityTxtVersion: 1, version: 1, state: 'present', status: 'success',
          observedAt: '2026-07-22T01:00:00.000Z', scanMode: 'deep', source: 'security_txt',
          durationMs: 9, complete: true, truncated: false, limitations: [], diagnostics: {},
          detail: 'A current security disclosure file was published for this hostname.',
          requestedUrl: 'https://portal.example.test/.well-known/security.txt',
          finalUrl: 'https://portal.example.test/.well-known/security.txt', httpStatus: 200,
          redirectCount: 0, contacts: ['mailto:security@example.test'],
          policies: ['https://portal.example.test/security-policy'], encryption: [], canonical: [],
          preferredLanguages: ['en'], expiresAt: '2027-01-01T00:00:00.000Z', signed: false, canonicalMatches: null,
        },
      }),
    });
  });

  const option = page.getByRole('checkbox', { name: /Retrieve security\.txt contacts/u });
  await expect(option).not.toBeChecked();
  await page.locator('#query').fill('192.0.2.1');
  await expect(option).toBeDisabled();
  await page.locator('#query').fill('AS64496');
  await expect(option).toBeDisabled();
  await page.locator('#query').fill('one.example.test, two.example.test');
  await expect(option).toBeDisabled();
  await page.locator('#query').fill('portal.example.test');
  await expect(option).toBeEnabled();
  await option.check();
  const requestPromise = page.waitForRequest((request) => (
    new URL(request.url()).pathname === '/api/lookup'
    && new URL(request.url()).searchParams.get('security_txt') === '1'
  ));
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await requestPromise;

  const disclosure = page.locator('details.security-txt');
  await expect(disclosure).not.toHaveAttribute('open', '');
  await disclosure.locator('summary').click();
  await expect(disclosure.getByText('mailto:security@example.test', { exact: true })).toBeVisible();
  await expect(disclosure.getByText(/does not authorise testing/u)).toBeVisible();

  await page.setViewportSize({ width: 320, height: 640 });
  await expectNoHorizontalOverflow(page);
});

test('newlines, commas, and semicolons all parse as multiple domains and hand off to Bulk', async ({ page }) => {
  // Each delimiter gets its own line: the client-side parser picks one
  // dominant delimiter per line, so a line mixing "," and ";" together would
  // only split on one of them. Using `.invalid` (RFC 2606) keeps these
  // syntactically domain-shaped - required for the parser to treat a line as
  // a pasted list rather than a single free-text token - without this test
  // ever reaching /api/lookup: the multi-domain path only hands candidates
  // off to Bulk client-side and never submits a lookup itself.
  const query = page.locator('#query');
  await query.fill(
    [
      'bad-domain-one.invalid',
      'bad-domain-two.invalid,bad-domain-three.invalid',
      'bad-domain-four.invalid;bad-domain-five.invalid',
    ].join('\n')
  );
  await expect(page.getByRole('button', { name: 'Open 5 in Bulk' })).toBeVisible();

  await page.getByRole('button', { name: 'Open 5 in Bulk' }).click();
  await expect(page).toHaveURL(/\/bulk/);
  await expect(page.locator('#domains')).toHaveValue(
    [
      'bad-domain-one.invalid',
      'bad-domain-two.invalid',
      'bad-domain-three.invalid',
      'bad-domain-four.invalid',
      'bad-domain-five.invalid',
    ].join('\n')
  );
});

test('Enter inserts a newline in the query field instead of submitting', async ({ page }) => {
  const query = page.locator('#query');
  await query.fill('bad-domain-one');
  await query.press('End');
  await query.press('Enter');
  await query.pressSequentially('bad-domain-two');

  await expect(query).toHaveValue('bad-domain-one\nbad-domain-two');
  // Enter must not have already submitted the multi-domain handoff.
  await expect(page).toHaveURL(/\/lookup$/);
  await expect(page.getByRole('button', { name: 'Open 2 in Bulk' })).toBeVisible();
});

test('the clear action empties the field', async ({ page }) => {
  const query = page.locator('#query');
  await query.fill('bad-domain-one');
  await page.getByRole('button', { name: 'Clear query' }).click();
  await expect(query).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Clear query' })).toHaveCount(0);
});

test('the clear action stays within the input wrapper at desktop and mobile widths, with no overflow', async ({ page }) => {
  const query = page.locator('#query');
  const wrapper = page.locator('.query-field');
  const clearButton = page.getByRole('button', { name: 'Clear query' });

  for (const size of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await query.fill('bad-domain-one');
    const wrapperBox = await boundingBox(wrapper);
    const clearBox = await boundingBox(clearButton);
    expect(clearBox.x).toBeGreaterThanOrEqual(wrapperBox.x - 1);
    expect(clearBox.y).toBeGreaterThanOrEqual(wrapperBox.y - 1);
    expect(clearBox.x + clearBox.width).toBeLessThanOrEqual(wrapperBox.x + wrapperBox.width + 1);
    expect(clearBox.y + clearBox.height).toBeLessThanOrEqual(wrapperBox.y + wrapperBox.height + 1);
    await expectNoHorizontalOverflow(page);
    await query.fill('');
  }
});
