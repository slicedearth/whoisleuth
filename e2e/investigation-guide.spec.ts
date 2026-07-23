import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, migrateLegacyBrowserData } from './helpers';

const GUIDE_KEY = 'whoisleuth:investigation-guide:v2';
const LEGACY_GUIDE_KEY = 'whoisleuth:investigation-guide:v1';

type RecipeLabel = 'Brand sweep' | 'Infrastructure pivot' | 'New-domain triage';

async function startRecipe(page: import('@playwright/test').Page, recipe: RecipeLabel = 'New-domain triage') {
  await page.goto('/dashboard');
  await page.getByRole('combobox', { name: 'Guide' }).selectOption({ label: recipe });
  const targetLabel = recipe === 'Brand sweep' ? 'Official domain' : recipe === 'Infrastructure pivot' ? 'Starting domain' : 'Domain';
  await page.getByRole('textbox', { name: targetLabel, exact: true }).fill('Portal.Example.Test.');
  await page.getByRole('button', { name: 'Start guide' }).click();
}

function currentAction(page: import('@playwright/test').Page) {
  return page.locator('.guide .current-action');
}

async function allowAndOpen(page: import('@playwright/test').Page, tool: 'Discover' | 'Bulk' | 'Lookup') {
  const action = currentAction(page);
  await action.getByRole('button', { name: 'Review requests' }).click();
  await expect(action.getByRole('region', { name: /Review requests for/ })).toContainText('Requests:');
  await action.getByRole('button', { name: `Allow and open ${tool}` }).click();
}

async function returnToGuide(page: import('@playwright/test').Page, step: string) {
  const action = currentAction(page);
  await action.scrollIntoViewIfNeeded();
  await expect(action).toContainText(step);
}

async function markReviewed(page: import('@playwright/test').Page, step: string) {
  await returnToGuide(page, step);
  await currentAction(page).getByRole('button', { name: 'Mark reviewed' }).click();
}

async function useGuideReturn(page: import('@playwright/test').Page, step: string) {
  const action = currentAction(page);
  const control = page.getByRole('button', { name: `Return to guided investigation: ${step}` });
  const hasUsefulExposure = () => action.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    const area = Math.max(1, rect.width * rect.height);
    return (visibleWidth * visibleHeight) / area >= 0.2;
  });
  await expect.poll(async () => await hasUsefulExposure() || await control.isVisible()).toBe(true);
  if (!await hasUsefulExposure()) {
    await expect(control).toBeVisible();
    let usedControl = false;
    try {
      await control.click({ timeout: 5_000 });
      usedControl = true;
    } catch (cause) {
      if (!await hasUsefulExposure()) throw cause;
    }
    if (usedControl) await expect(action).toBeFocused();
  }
  await expect.poll(hasUsefulExposure).toBe(true);
}

async function installLookupFixture(page: import('@playwright/test').Page) {
  await page.route('**/api/lookup?*', async (route) => {
    const url = new URL(route.request().url());
    const domain = url.searchParams.get('q') || 'portal.example.test';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: domain,
        type: 'domain',
        registrableDomain: domain,
        availability: {
          applicable: true,
          state: 'registered',
          confidence: 'high',
          domain,
          deepScanComplete: url.searchParams.get('fast') !== '1',
          registrar: { name: 'Example Registrar' },
          nameservers: ['ns1.example.net'],
          dns: { status: 'complete', records: { a: ['192.0.2.10'] } },
        },
        rdap: { parsed: { status: ['active'], entities: [] } },
        whois: { parsed: {}, chain: [] },
        diagnostics: {
          version: 7,
          rdap: { status: 'complete' },
          whois: { status: url.searchParams.get('fast') === '1' ? 'skipped' : 'complete' },
          availability: { status: 'complete' },
        },
      }),
    });
  });
}

async function runLookupStep(page: import('@playwright/test').Page, label: string, expectedDomain: string) {
  await allowAndOpen(page, 'Lookup');
  await expect(page).toHaveURL(new RegExp(`/lookup\\?q=${expectedDomain.replaceAll('.', '\\.')}.*depth=deep`));
  await expect(page.getByRole('radio', { name: /Deep/ })).toBeChecked();
  await expect(page.locator('#query')).toHaveValue(expectedDomain);
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.getByRole('heading', { name: 'registered' })).toBeVisible();
  await useGuideReturn(page, label);
  await currentAction(page).getByRole('button', { name: 'Mark reviewed' }).click();
}

async function runBulkStep(
  page: import('@playwright/test').Page,
  label: string,
  domains?: string[],
) {
  await allowAndOpen(page, 'Bulk');
  if (domains) await page.locator('#domains').fill(domains.join('\n'));
  const count = (await page.locator('#domains').inputValue()).split(/\s+/u).filter(Boolean).length;
  await page.getByRole('button', { name: `Scan ${count} domain${count === 1 ? '' : 's'}` }).click();
  await expect(page.locator('.results-table tbody tr')).toHaveCount(count);
  await useGuideReturn(page, label);
  await currentAction(page).getByRole('button', { name: 'Mark reviewed' }).click();
}

async function retainCases(page: import('@playwright/test').Page, label: string, domains: string[]) {
  await currentAction(page).getByRole('link', { name: 'Open Monitor' }).click();
  await expect(page).toHaveURL(new RegExp(`/monitor\\?view=cases&investigation=1&domain=${domains[0].replaceAll('.', '\\.')}`));
  const queue = page.locator('#case-review-queue');
  await expect(queue).toBeFocused();
  await expect(queue.locator('li')).toHaveCount(domains.length);
  await expect(page.locator('#new-case')).toHaveValue('');
  expect(await queue.evaluate((element) => {
    const toolbar = document.querySelector('.case-toolbar');
    return Boolean(
      toolbar
      && element.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  })).toBe(true);
  for (const domain of domains) {
    await expect(queue).toContainText(domain);
    await queue.getByRole('button', { name: `Open case for ${domain}` }).click();
    const caseHeader = page.locator('.case-head', { hasText: domain });
    await expect(caseHeader).toBeVisible();
    await expect(caseHeader).toBeFocused();
  }
  await useGuideReturn(page, label);
  await currentAction(page).getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(page.locator('.guide-complete')).toContainText('All');
}

test('the dashboard starts a selected tab-scoped recipe without navigation or analysis', async ({ page }) => {
  const analysisRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/(?:lookup|rdap|whois|availability|ct-search)(?:\?|$)/u.test(request.url())) analysisRequests.push(request.url());
  });
  await startRecipe(page, 'Brand sweep');

  await expect(page).toHaveURL('/dashboard');
  const guide = page.locator('.guide');
  await expect(guide).toContainText('Brand sweep: portal.example.test');
  await expect(guide).toBeFocused();
  await expect(guide).toContainText('0 of 5 steps reviewed');
  await expect(currentAction(page)).toContainText('Step 1 of 5');
  await expect(currentAction(page)).toContainText('Confirm brand profile');
  await expect(currentAction(page).getByRole('heading', { name: 'What to do' })).toBeVisible();
  await expect(currentAction(page).getByRole('listitem')).toHaveCount(3);
  await expect(guide.locator('#investigation-plan')).toHaveCount(0);
  await guide.getByRole('button', { name: 'Show full plan (5 steps)' }).click();
  await expect(guide.locator('#investigation-plan > li')).toHaveCount(5);
  expect(analysisRequests).toEqual([]);

  const stored = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || 'null'), GUIDE_KEY);
  expect(stored).toMatchObject({ version: 2, recipeId: 'brand_sweep', domain: 'portal.example.test', focusDomain: null, status: 'active' });
  expect(stored.stages.every((stage: Record<string, unknown>) => stage.outcome === 'pending' && stage.openedAt === null)).toBe(true);
});

test('new-domain triage leads from a deep lookup through comparison and a review queue', async ({ page }) => {
  test.slow();
  await installLookupFixture(page);
  await startRecipe(page);

  await runLookupStep(page, 'Collect domain evidence', 'portal.example.test');
  await expect(currentAction(page)).toContainText('Compare focused peers');
  await runBulkStep(page, 'Compare focused peers', ['portal.example.test', 'peer.example.test']);
  await expect(currentAction(page)).toContainText('Record disposition');
  await page.setViewportSize({ width: 320, height: 760 });
  await retainCases(page, 'Record disposition', ['portal.example.test', 'peer.example.test']);
  await expectNoHorizontalOverflow(page);
  await expect(page.locator('.guide')).toContainText('3 of 3 steps reviewed');
});

test('infrastructure pivot keeps the starting domain through lookup, peer comparison, and retention', async ({ page }) => {
  test.slow();
  await installLookupFixture(page);
  await startRecipe(page, 'Infrastructure pivot');

  await runLookupStep(page, 'Collect starting evidence', 'portal.example.test');
  await runBulkStep(page, 'Compare relationships', ['portal.example.test', 'related.example.test']);
  await retainCases(page, 'Retain defensible pivots', ['portal.example.test', 'related.example.test']);
  await expect(page.locator('.guide')).toContainText('3 of 3 steps reviewed');
});

test('returning to the same guided Bulk step keeps its peer set and completed results', async ({ page }) => {
  await installLookupFixture(page);
  await startRecipe(page);

  await runLookupStep(page, 'Collect domain evidence', 'portal.example.test');
  await allowAndOpen(page, 'Bulk');
  const peers = ['portal.example.test', 'peer.example.test'];
  await page.locator('#domains').fill(peers.join('\n'));
  await page.getByRole('button', { name: 'Scan 2 domains' }).click();
  await expect(page.locator('.results-table tbody tr')).toHaveCount(2);

  await page.locator('#console-navigation').getByRole('link', { name: /^Dashboard/ }).click();
  await expect(currentAction(page)).toContainText('Compare focused peers');
  await currentAction(page).getByRole('link', { name: 'Open Bulk' }).click();

  await expect(page.locator('#domains')).toHaveValue(peers.join('\n'));
  await expect(page.locator('.results-table tbody tr')).toHaveCount(2);
  await expect(page.getByRole('status').filter({ hasText: 'Completed 2 of 2 lookups.' })).toBeVisible();
});

test('brand sweep carries the official domain into a profile and a selected candidate across every tool', async ({ page }) => {
  test.slow();
  await installLookupFixture(page);
  await startRecipe(page, 'Brand sweep');

  await currentAction(page).getByRole('link', { name: 'Open Brands' }).click();
  await expect(page.getByRole('heading', { name: 'New profile' })).toBeVisible();
  await expect(page.locator('#official-domains')).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Official domains' })).toHaveValue('portal.example.test');
  await page.getByRole('textbox', { name: 'Brand name' }).fill('Example Brand');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await markReviewed(page, 'Confirm brand profile');

  await allowAndOpen(page, 'Discover');
  await expect(page.locator('#discovery-seed')).toHaveValue('example.test');
  await page.getByRole('button', { name: 'Generate candidates' }).click();
  await expect(page.locator('.candidate').first()).toBeVisible();
  const candidate = (await page.locator('.candidate strong').first().textContent())?.trim() || '';
  expect(candidate).not.toBe('');
  await page.locator('.candidate input[type="checkbox"]').first().check();
  await page.getByRole('button', { name: 'Continue to Bulk with 1' }).click();
  await markReviewed(page, 'Discover candidates');

  await runBulkStep(page, 'Triage candidates');
  await expect(currentAction(page)).toContainText('Inspect priority domain');
  await currentAction(page).getByRole('link', { name: 'Choose a Bulk candidate' }).click();
  await expect(page.locator('#results')).toBeInViewport();
  await page.locator('.results-table tbody tr').first().getByRole('button', { name: 'Inspect' }).click();
  await expect(currentAction(page)).toContainText('Inspect priority domain');
  await runLookupStep(page, 'Inspect priority domain', candidate);
  await retainCases(page, 'Retain reviewed work', [candidate]);
  await expect(page.locator('.guide')).toContainText('5 of 5 steps reviewed');
});

test('request review is keyboard-operable and opening a tool does not claim completion', async ({ page }) => {
  await installLookupFixture(page);
  await startRecipe(page);
  const review = currentAction(page).getByRole('button', { name: 'Review requests' });
  await expect(currentAction(page).getByRole('link', { name: 'Open Lookup' })).toHaveCount(0);
  await review.focus();
  await page.keyboard.press('Enter');
  await expect(currentAction(page)).toContainText('Fast and deep Lookup have different request budgets');
  await currentAction(page).getByRole('button', { name: 'Allow and open Lookup' }).click();

  await expect.poll(async () => page.evaluate((key) => {
    const stored = JSON.parse(sessionStorage.getItem(key) || 'null');
    return Boolean(stored?.stages?.[0]?.openedAt);
  }, GUIDE_KEY)).toBe(true);
  const stored = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || 'null'), GUIDE_KEY);
  expect(stored.stages[0].approvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  expect(stored.stages[0].openedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  expect(stored.stages[0].outcome).toBe('pending');
});

test('return control recovers when the first action-panel scroll is displaced', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 568 });
  await startRecipe(page);
  const action = currentAction(page);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const control = page.getByRole('button', { name: 'Return to guided investigation: Collect domain evidence' });
  await expect(control).toBeVisible();

  await action.evaluate((element) => {
    const originalScrollIntoView = element.scrollIntoView.bind(element);
    let callCount = 0;
    element.scrollIntoView = (options?: boolean | ScrollIntoViewOptions) => {
      callCount += 1;
      if (callCount > 1) originalScrollIntoView(options);
    };
  });

  await control.click();
  await expect(action).toBeFocused();
  await expect.poll(() => action.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    return (visibleWidth * visibleHeight) / Math.max(1, rect.width * rect.height);
  })).toBeGreaterThanOrEqual(0.2);
});

test('partial progress, pause, resume, and restart remain explicit', async ({ page }) => {
  await startRecipe(page, 'Infrastructure pivot');
  await allowAndOpen(page, 'Lookup');
  await currentAction(page).getByRole('button', { name: 'Mark partial' }).click();
  await page.getByText('Guide options', { exact: true }).click();
  await page.getByRole('button', { name: 'Pause guide' }).click();
  await expect(page.locator('.guide')).toContainText('Paused');
  await page.reload();
  await page.getByRole('button', { name: 'Resume guide' }).click();
  await page.getByText('Guide options', { exact: true }).click();
  await page.getByRole('button', { name: 'Restart guide' }).click();
  await page.getByRole('button', { name: 'Confirm restart' }).click();
  await expect(page.locator('.guide')).toContainText('0 of 3 steps reviewed');
  await expect(currentAction(page)).toContainText('Collect starting evidence');
});

test('exports only a compact versioned progress summary after explicit confirmation', async ({ page }) => {
  await startRecipe(page);
  await page.getByText('Guide options', { exact: true }).click();
  await page.getByRole('button', { name: 'Export summary' }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Confirm export' }).click();
  const download = await pending;
  const body = await (await download.createReadStream()).toArray();
  const payload = JSON.parse(Buffer.concat(body).toString('utf-8'));

  expect(download.suggestedFilename()).toMatch(/^whoisleuth-recipe-portal\.example\.test-.+\.json$/u);
  expect(payload).toMatchObject({ schema: 'whoisleuth.investigation-recipe-summary', version: 1, recipe: { id: 'new_domain_triage' } });
  expect(Object.keys(payload).sort()).toEqual(['createdAt', 'generatedAt', 'limitations', 'recipe', 'schema', 'stages', 'status', 'target', 'updatedAt', 'version']);
});

test('shows retained evidence without treating it as workflow completion', async ({ page }) => {
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: 2, cases: [{
      id: 'case-recipe-1', domain: 'portal.example.test', status: 'new', disposition: 'unreviewed', tags: [], notes: [],
      source: 'lookup', evidenceHistory: [], createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z',
    }] },
  });
  await page.getByRole('textbox', { name: 'Domain', exact: true }).fill('portal.example.test');
  await page.getByRole('button', { name: 'Start guide' }).click();
  await page.getByText(/^Saved evidence/).click();
  await expect(page.locator('.evidence-checkpoint')).toContainText('1 observation');
  await expect(page.locator('.guide')).toContainText('0 of 3 steps reviewed');
});

test('legacy progress migrates while future and oversized current records stay untouched', async ({ page }) => {
  await page.goto('/dashboard');
  const legacy = JSON.stringify({ version: 1, domain: 'example.test', createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:05:00.000Z', visitedStages: ['lookup'] });
  await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [LEGACY_GUIDE_KEY, legacy]);
  await page.reload();
  await expect(page.locator('.guide')).toContainText('New-domain triage: example.test');
  expect(await page.evaluate((key) => sessionStorage.getItem(key), LEGACY_GUIDE_KEY)).toBe(legacy);

  const future = JSON.stringify({ version: 3, recipeId: 'new_domain_triage' });
  await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [GUIDE_KEY, future]);
  await page.reload();
  await expect(page.locator('.guide')).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), GUIDE_KEY)).toBe(future);

  const oversized = 'x'.repeat(12_289);
  await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [GUIDE_KEY, oversized]);
  await page.reload();
  await expect(page.locator('.guide')).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), GUIDE_KEY)).toBe(oversized);
});

test('the one-step flow remains usable at 320 pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await startRecipe(page, 'Brand sweep');
  await expectNoHorizontalOverflow(page);
  await expect(currentAction(page).getByRole('listitem')).toHaveCount(3);
  await currentAction(page).getByRole('button', { name: 'Skip this step' }).click();
  await expect(currentAction(page)).toBeFocused();
  await expect(currentAction(page)).toBeInViewport();
  await expect(currentAction(page)).toContainText('Discover candidates');
  await expectNoHorizontalOverflow(page);
});

test('malformed guide focus fragments are ignored without disrupting the active recipe', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await startRecipe(page);
  await page.goto('/bulk?investigation=portal.example.test#%');
  await expect(page.locator('.guide')).toContainText('New-domain triage: portal.example.test');
  expect(pageErrors).toEqual([]);
});

test('ending a recipe removes current and legacy tab records only', async ({ page }) => {
  await startRecipe(page);
  await page.evaluate((key) => sessionStorage.setItem(key, 'legacy-copy'), LEGACY_GUIDE_KEY);
  await page.getByText('Guide options', { exact: true }).click();
  await page.getByRole('button', { name: 'End guide' }).click();
  await expect(page.locator('.guide')).toHaveCount(0);
  expect(await page.evaluate(([current, legacy]) => [sessionStorage.getItem(current), sessionStorage.getItem(legacy)], [GUIDE_KEY, LEGACY_GUIDE_KEY])).toEqual([null, null]);
});
