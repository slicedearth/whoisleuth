import { expect, test } from './fixtures';
import { boundingBox, expandLookupFamilies, expectNoHorizontalOverflow, holdBrowserLocalReads, readBrowserLocalCollection } from './helpers';
import { TEST_SITE_PASSWORD } from './constants';
import { ACTIVE_PROFILE_KEY } from '../frontend/src/lib/brand-profiles';
import { LOOKUP_EVIDENCE_SCHEMA, LOOKUP_EVIDENCE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/evidence-export';

// Every value here is deliberately dotless (no TLD), so classifyQuery on the
// server rejects it with a 400 before any RDAP/WHOIS/DNS call - these tests
// never trigger a live lookup, only client-side parsing/navigation.

test.beforeEach(async ({ page }) => {
  await page.goto('/lookup');
});

function replayEvidence(target: string, registrar: string) {
  return JSON.stringify({
    schema: LOOKUP_EVIDENCE_SCHEMA,
    schemaVersion: LOOKUP_EVIDENCE_SCHEMA_VERSION,
    generatedAt: '2026-08-10T00:00:00.000Z',
    application: { name: 'WHOISleuth', version: 'fixture' },
    query: { submitted: target, registrableDomain: target, type: 'domain' },
    diagnostics: { rdap: { status: 'success', fetchedAt: '2026-08-10T00:00:00.000Z' } },
    sources: {
      rdap: { status: 'success', parsed: { domain: target, registrar: { name: registrar } } },
      whois: { status: 'unavailable', parsed: {} },
    },
    analysis: {
      availability: { state: 'registered', confidence: 'high' },
      registryComparison: null,
      registrarPublicationComparison: null,
    },
  });
}

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
  await expect(pending).toContainText('Deep lookup is waiting for one final response');
  await expect(pending.locator('.loading-meta')).toContainText(/elapsed/u);
  await expect(pending.locator('.collection-trace')).toContainText('Registry RDAP');
  await expect(pending.locator('.collection-trace')).toContainText('Domain evidence');
  await expect(page.getByRole('button', { name: 'Cancel lookup' })).toBeVisible();
  releaseLookup?.();

  await expect(page.getByRole('heading', { name: 'registered' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand Source quality evidence' }).click();
  const coverage = page.getByRole('region', { name: 'Evidence coverage' });
  await expect(coverage).toBeVisible();
  await expect(coverage.getByRole('group', { name: 'Evidence coverage summary' })).toContainText('2.4 s total');
  await coverage.getByText(/Review \d+ source and analysis records/u).click();
  await expect(coverage).toContainText('700 ms');
  await expect(coverage).toContainText('Request error');
  await expect(coverage).toContainText('WHOIS');
  await expect(coverage).toContainText('A bounded homepage request covering redirects, response metadata, and a capped body prefix.');
  await expect(coverage).toContainText('2.0 s');
  const sourceQualityTable = coverage.getByRole('table', { name: 'Source quality and freshness' });
  await expect(sourceQualityTable).toHaveAttribute('aria-colcount', '5');
  await expect(sourceQualityTable.getByRole('row').first().getByRole('columnheader')).toHaveCount(5);
  const diagnostics = coverage.locator('details.timing-detail');
  await expect(diagnostics).not.toHaveAttribute('open', '');
  await expect(diagnostics.locator('.summary-arrow')).toHaveText('›');
  await diagnostics.locator(':scope > summary').focus();
  await diagnostics.locator(':scope > summary').press('Enter');
  await expect(diagnostics).toHaveAttribute('open', '');
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

test('effective same-route URL changes invalidate held work while task and hash changes do not', async ({ page }) => {
  const releases = new Map<string, () => void>();
  const gates = new Map<string, Promise<void>>();
  const gateFor = (target: string) => {
    const gate = new Promise<void>((resolve) => releases.set(target, resolve));
    gates.set(target, gate);
  };
  gateFor('task-only.example.test');
  gateFor('stale-route.example.test');
  await page.route('**/api/lookup?*', async (route) => {
    const target = new URL(route.request().url()).searchParams.get('q') || '';
    await gates.get(target);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: target,
        type: 'domain',
        registrableDomain: target,
        availability: { applicable: true, state: 'registered', confidence: 'high', domain: target },
        rdap: { parsed: {} },
        whois: { parsed: {}, chain: [] },
        diagnostics: { rdap: { status: 'success' }, whois: { status: 'complete' }, availability: { status: 'complete' } },
      }),
    }).catch(() => {});
  });
  const navigate = async (href: string) => {
    await page.evaluate((destination) => {
      const link = document.createElement('a');
      link.href = destination;
      link.textContent = 'Same-route fixture link';
      document.body.append(link);
      link.click();
    }, href);
    await expect.poll(() => `${new URL(page.url()).pathname}${new URL(page.url()).search}`).toBe(href);
  };

  await page.locator('#query').fill('task-only.example.test');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await navigate('/lookup?task=brand');
  await page.evaluate(() => { window.location.hash = 'query'; });
  await expect(page.getByRole('button', { name: 'Cancel lookup' })).toBeVisible();
  releases.get('task-only.example.test')?.();
  await expect(page.locator('#result')).toBeVisible();

  await navigate('/lookup?q=stale-route.example.test&depth=deep');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.getByRole('button', { name: 'Cancel lookup' })).toBeVisible();
  await navigate('/lookup?q=replacement.example.test&depth=fast');
  await expect(page.locator('#query')).toHaveValue('replacement.example.test');
  await page.goBack();
  await expect(page.locator('#query')).toHaveValue('stale-route.example.test');
  releases.get('stale-route.example.test')?.();
  await expect(page.locator('#result')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run lookup' })).toBeEnabled();
});

for (const action of ['edit', 'clear'] as const) {
test(`query ${action} invalidates a response while browser-local case context is still loading`, async ({ page }) => {
  await page.evaluate(() => {
    const state = window as typeof window & {
      __delayNextCaseRead?: boolean;
      __releaseCaseRead?: () => void;
    };
    state.__delayNextCaseRead = false;
    const originalGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function delayedCaseManifestGet(query: IDBValidKey | IDBKeyRange) {
      const request = originalGet.call(this, query);
      if (this.name !== 'manifests' || query !== 'cases' || !state.__delayNextCaseRead) return request;
      state.__delayNextCaseRead = false;
      let release = () => {};
      const gate = new Promise<void>((resolve) => { release = resolve; });
      state.__releaseCaseRead = release;
      let proxy: IDBRequest;
      proxy = new Proxy(request, {
        get(target, property) {
          return Reflect.get(target, property, target);
        },
        set(target, property, value) {
          if (property === 'onsuccess' && typeof value === 'function') {
            target.onsuccess = (event) => { void gate.then(() => value.call(proxy, event)); };
            return true;
          }
          return Reflect.set(target, property, value, target);
        },
      });
      return proxy;
    };
  });
  await page.route('**/api/lookup?*', async (route) => {
    const target = new URL(route.request().url()).searchParams.get('q') || '';
    await page.evaluate(() => {
      const state = window as typeof window & {
        __delayNextCaseRead?: boolean;
        __releaseCaseRead?: () => void;
      };
      state.__delayNextCaseRead = true;
      delete state.__releaseCaseRead;
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: target,
        type: 'domain',
        registrableDomain: target,
        availability: { applicable: true, state: 'registered', confidence: 'high', domain: target },
        rdap: { parsed: {} },
        whois: { parsed: {}, chain: [] },
        diagnostics: { rdap: { status: 'success' }, whois: { status: 'complete' }, availability: { status: 'complete' } },
      }),
    });
  });

  const target = `${action}-during-case-read.example.test`;
  const query = page.locator('#query');
  const response = page.waitForResponse((candidate) => (
    new URL(candidate.url()).pathname === '/api/lookup'
    && new URL(candidate.url()).searchParams.get('q') === target
  ));
  await query.fill(target);
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await response;
  await expect.poll(() => page.evaluate(() => (
    typeof (window as typeof window & { __releaseCaseRead?: () => void }).__releaseCaseRead
  ))).toBe('function');

  if (action === 'edit') await query.fill('replacement-after-response.example.test');
  else await page.getByRole('button', { name: 'Clear query' }).click();
  await page.evaluate(() => {
    const state = window as typeof window & { __releaseCaseRead?: () => void };
    state.__releaseCaseRead?.();
    delete state.__releaseCaseRead;
  });

  await expect(page.locator('#result')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel lookup' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: target })).toHaveCount(0);
});
}

test('a completed Case action cannot publish beneath a replacement Lookup', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => {
    const target = new URL(route.request().url()).searchParams.get('q') || '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: target,
        type: 'domain',
        registrableDomain: target,
        availability: { applicable: true, state: 'registered', confidence: 'high', domain: target, deepScanComplete: true },
        rdap: { parsed: {} },
        whois: { parsed: {}, chain: [] },
        diagnostics: { rdap: { status: 'success' }, whois: { status: 'complete' }, availability: { status: 'complete' } },
      }),
    });
  });

  const query = page.locator('#query');
  await query.fill('case-action-a.example.test');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.getByRole('heading', { name: 'case-action-a.example.test' })).toBeVisible();
  await expandLookupFamilies(page);
  await holdBrowserLocalReads(page, 2_500, '.case-body > button.primary');

  await query.fill('case-action-b.example.test');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.getByRole('heading', { name: 'case-action-b.example.test' })).toBeVisible({ timeout: 10_000 });
  await expandLookupFamilies(page);
  await expect.poll(async () => (
    await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })
  ).records.map((entry) => String((entry.value as { domain?: unknown }).domain ?? '')), {
    timeout: 10_000,
  }).toContain('case-action-a.example.test');
  await expect(page.locator('.case-card')).toContainText('No case for case-action-b.example.test yet.');
  await expect(page.locator('.case-card')).not.toContainText('case-action-a.example.test');
  await expect(page.getByRole('button', { name: 'Create case' })).toBeEnabled();
});

test('a delayed replay comparison cannot rebind to a replacement primary capture', async ({ page }) => {
  const replay = page.locator('details.replay');
  await replay.locator('summary').click();
  const primaryInput = replay.locator('input[type="file"]').first();
  await primaryInput.setInputFiles({
    name: 'primary-a.json',
    mimeType: 'application/json',
    buffer: Buffer.from(replayEvidence('primary-a.example.test', 'Registrar A')),
  });
  await expect(replay.getByRole('heading', { name: 'primary-a.example.test' })).toBeVisible();

  await page.evaluate(() => {
    const original = File.prototype.text;
    let hold = true;
    File.prototype.text = function text() {
      if (!hold) return original.call(this);
      hold = false;
      return new Promise<string>((resolve, reject) => {
        Reflect.set(window, '__releaseReplayComparisonRead', () => {
          void original.call(this).then(resolve, reject);
        });
      });
    };
  });
  await replay.locator('input[type="file"]').last().setInputFiles({
    name: 'comparison-b.json',
    mimeType: 'application/json',
    buffer: Buffer.from(replayEvidence('primary-a.example.test', 'Registrar B')),
  });
  await expect(replay.getByText('Reading second evidence…', { exact: true })).toBeVisible();

  await primaryInput.setInputFiles({
    name: 'primary-c.json',
    mimeType: 'application/json',
    buffer: Buffer.from(replayEvidence('primary-c.example.test', 'Registrar C')),
  });
  await expect(replay.getByRole('heading', { name: 'primary-c.example.test' })).toBeVisible();
  await page.evaluate(() => {
    const release = Reflect.get(window, '__releaseReplayComparisonRead');
    if (typeof release !== 'function') throw new Error('The replay comparison read gate was not installed.');
    release();
  });
  await expect(replay.locator('.comparison-status')).toBeEmpty();
  await expect(replay.locator('.comparison-counts')).toHaveCount(0);
  await expect(replay).not.toContainText('Compared comparison-b.json locally');
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

test('a malformed public session response does not clear the current Lookup form', async ({ page }) => {
  await page.locator('#query').fill('retained-session-state.example');
  let unavailableChecks = 0;
  const unavailableSession = async (route: import('@playwright/test').Route) => {
    unavailableChecks += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ unexpected: 'session shape' }),
    });
  };
  await page.route('**/api/session', unavailableSession);
  await page.getByRole('button', { name: 'Open command palette' }).click();
  await page.getByLabel('Search pages').fill('Public homepage');
  await page.getByRole('option', { name: /Public homepage/u }).click();
  await expect(page).toHaveURL('/');
  await expect.poll(() => unavailableChecks).toBeGreaterThan(0);
  await page.unroute('**/api/session', unavailableSession);

  await page.locator('.public-header').getByRole('link', { name: 'Open console' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.locator('#console-navigation').getByRole('link', { name: /^Lookup/u }).click();
  await expect(page.locator('#query')).toHaveValue('retained-session-state.example');
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

test('clears transient Lookup state without an unhandled error when Console logout is unavailable', async ({ page }) => {
  const pageErrors: string[] = [];
  let logoutRequests = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/api/logout', async (route) => {
    logoutRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{',
    });
  });
  await page.locator('#query').fill('failed-signout-state.example.test');
  await page.context().clearCookies();
  await page.getByRole('button', { name: 'Sign out' }).click();

  await expect(page).toHaveURL('/login');
  await expect.poll(() => logoutRequests).toBe(1);
  expect(pageErrors).toEqual([]);
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

  await page.getByRole('button', { name: 'Expand Web and DNS evidence' }).click();
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
