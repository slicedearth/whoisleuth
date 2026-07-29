import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, migrateLegacyBrowserData } from './helpers';

const GUIDE_KEY = 'whoisleuth:investigation-guide:v4';
const PREVIOUS_GUIDE_KEY = 'whoisleuth:investigation-guide:v3';
const LEGACY_GUIDE_KEY = 'whoisleuth:investigation-guide:v2';
const ORIGINAL_GUIDE_KEY = 'whoisleuth:investigation-guide:v1';

type RecipeLabel = 'Brand sweep' | 'Infrastructure pivot' | 'New-domain triage';

async function startRecipe(page: import('@playwright/test').Page, recipe: RecipeLabel = 'New-domain triage') {
  await page.goto('/dashboard');
  await page.getByRole('combobox', { name: 'Guide' }).selectOption({ label: recipe });
  const targetLabel = recipe === 'Brand sweep' ? 'Official domain' : recipe === 'Infrastructure pivot' ? 'Starting domain' : 'Domain';
  await page.getByRole('textbox', { name: targetLabel, exact: true }).fill('Portal.Example.Test.');
  await page.getByRole('button', { name: 'Start guide' }).click();
  await expect(page.locator('.guide')).toBeFocused();
  await expect(currentAction(page)).toBeVisible();
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
  await useGuideReturn(page, step);
  await currentAction(page).getByRole('button', { name: 'Mark reviewed' }).click();
  await expect.poll(async () => {
    const action = currentAction(page);
    if (await action.isVisible()) return !(await action.innerText()).includes(step);
    return page.locator('.guide-complete').isVisible();
  }).toBe(true);
}

async function useGuideReturn(page: import('@playwright/test').Page, step: string) {
  const action = currentAction(page);
  const control = page.getByRole('button', { name: `Return to guided investigation: ${step}` });
  const hasStableUsefulExposure = () => action.evaluate(async (element) => {
    const exposed = () => {
      const rect = element.getBoundingClientRect();
      const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
      const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      const area = Math.max(1, rect.width * rect.height);
      return (visibleWidth * visibleHeight) / area >= 0.2;
    };
    for (let sample = 0; sample < 3; sample += 1) {
      if (!exposed()) return false;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return exposed();
  });
  await expect.poll(
    async () => await hasStableUsefulExposure() || await control.isVisible(),
    { timeout: 15_000 },
  ).toBe(true);
  if (!await hasStableUsefulExposure()) {
    await expect(control).toBeVisible();
    let usedControl = false;
    try {
      await control.click({ timeout: 5_000 });
      usedControl = true;
    } catch (cause) {
      if (!await hasStableUsefulExposure()) throw cause;
    }
    if (usedControl) await expect(action).toBeFocused();
  }
  await expect.poll(hasStableUsefulExposure, { timeout: 15_000 }).toBe(true);
}

async function installLookupFixture(page: import('@playwright/test').Page) {
  await page.route('**/api/lookup?*', async (route) => {
    const url = new URL(route.request().url());
    const domain = url.searchParams.get('q') || 'portal.example.test';
    const compact = url.searchParams.get('compact') === '1';
    const availability = {
      applicable: true,
      state: 'registered',
      confidence: 'high',
      domain,
      deepScanComplete: url.searchParams.get('fast') !== '1',
      registrar: { name: 'Example Registrar' },
      nameservers: ['ns1.example.net'],
      dns: { status: 'complete', records: { a: ['192.0.2.10'] } },
    };
    const diagnostics = {
      version: 7,
      rdap: { status: 'complete' },
      whois: { status: url.searchParams.get('fast') === '1' ? 'skipped' : 'complete' },
      availability: { status: 'complete' },
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(compact ? { availability, diagnostics } : {
        query: domain,
        type: 'domain',
        registrableDomain: domain,
        availability,
        rdap: { parsed: { status: ['active'], entities: [] } },
        whois: { parsed: {}, chain: [] },
        diagnostics,
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
  await markReviewed(page, label);
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
  await markReviewed(page, label);
}

async function retainCases(page: import('@playwright/test').Page, label: string, domains: string[]) {
  await currentAction(page).getByRole('link', { name: 'Open Monitor' }).click();
  const firstDomain = domains[0];
  if (!firstDomain) throw new Error('Case retention requires at least one domain.');
  await expect(page).toHaveURL(new RegExp(`/monitor\\?view=cases&investigation=1&domain=${firstDomain.replaceAll('.', '\\.')}`));
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
  await markReviewed(page, label);
  const completedGuide = page.locator('.guide-complete');
  await expect(completedGuide).toContainText('All');
  await expect(completedGuide).toContainText('Case needs a reviewed disposition or decision');
  await expect(completedGuide.getByRole('link', { name: 'Review case decision workspace' })).toHaveAttribute('href', /\/monitor\?view=cases&case=.+#case-response-/u);
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
  const context = guide.locator('.context-tray');
  await expect(context.getByText('Target', { exact: true })).toBeVisible();
  await expect(context.getByText('portal.example.test', { exact: true })).toBeVisible();
  await expect(context.getByText('None active', { exact: true })).toBeVisible();
  await expect(context.getByText('Not retained', { exact: true })).toBeVisible();
  await expect(context.getByText('No retained evidence', { exact: true })).toBeVisible();
  await expect(context.getByText('Confirm brand profile', { exact: true })).toBeVisible();
  await guide.getByRole('button', { name: 'Dismiss details' }).click();
  await expect(currentAction(page)).toHaveCount(0);
  await expect(context).toBeVisible();
  await guide.getByRole('button', { name: 'Show work plan' }).click();
  await expect(currentAction(page)).toContainText('Step 1 of 5');
  await expect(currentAction(page)).toContainText('Confirm brand profile');
  await expect(currentAction(page).getByRole('heading', { name: 'What to do' })).toBeVisible();
  await expect(currentAction(page).getByRole('listitem')).toHaveCount(3);
  const completionCheck = currentAction(page).getByRole('region', { name: 'Completion check for Confirm brand profile' });
  await expect(completionCheck).toContainText('Expected evidence');
  await expect(completionCheck).toContainText('Done when');
  await expect(guide.locator('#investigation-plan')).toHaveCount(0);
  const planToggle = guide.getByRole('button', { name: 'Show full plan (5 steps)' });
  await planToggle.focus();
  await expect(planToggle).toBeFocused();
  await planToggle.press('Enter');
  await expect(guide.getByRole('button', { name: 'Hide full plan' })).toHaveAttribute('aria-expanded', 'true');
  await expect(guide.locator('#investigation-plan > li')).toHaveCount(5);
  expect(analysisRequests).toEqual([]);

  const stored = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || 'null'), GUIDE_KEY);
  expect(stored).toMatchObject({ version: 4, recipeId: 'brand_sweep', template: null, domain: 'portal.example.test', focusDomain: null, status: 'active' });
  expect(stored.stages.every((stage: Record<string, unknown>) => stage.outcome === 'pending' && stage.openedAt === null)).toBe(true);
});

test('active context can change its target only through an explicit guide restart', async ({ page }) => {
  const analysisRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/(?:lookup|rdap|whois|availability|ct-search)(?:\?|$)/u.test(request.url())) analysisRequests.push(request.url());
  });
  await startRecipe(page, 'New-domain triage');

  const guide = page.locator('.guide');
  await guide.getByText('Guide options', { exact: true }).click();
  await guide.getByRole('button', { name: 'Change target' }).click();
  const target = guide.getByRole('textbox', { name: 'Investigation target' });
  await target.fill('replacement.example.test');
  await guide.getByRole('button', { name: 'Review target change' }).click();
  await expect(guide.getByRole('status')).toContainText('Changing the target restarts this guide');
  expect((await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || 'null'), GUIDE_KEY)).domain).toBe('portal.example.test');

  await guide.getByRole('button', { name: 'Confirm and restart guide' }).click();
  await expect(guide).toContainText('New-domain triage: replacement.example.test');
  await expect(guide.locator('.context-tray')).toContainText('replacement.example.test');
  await expect(currentAction(page)).toContainText('Step 1 of 3');
  const stored = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || 'null'), GUIDE_KEY);
  expect(stored.domain).toBe('replacement.example.test');
  expect(stored.stages.every((stage: Record<string, unknown>) => stage.outcome === 'pending' && stage.openedAt === null)).toBe(true);
  expect(analysisRequests).toEqual([]);

  await page.setViewportSize({ width: 320, height: 760 });
  await expectNoHorizontalOverflow(page);
});

test('an analyst can save and run a bounded local guide template without removing request gates', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'New template' }).click();
  await page.getByRole('textbox', { name: 'Template name' }).fill('Focused local review');
  await page.getByRole('textbox', { name: 'Summary' }).fill('Review the selected bounded evidence and record a decision.');
  await page.getByRole('textbox', { name: 'Step label' }).first().fill('Collect selected evidence');
  const mandatoryApproval = page.getByRole('checkbox', { name: /Require approval.+mandatory/u }).first();
  await expect(mandatoryApproval).toBeChecked();
  await expect(mandatoryApproval).toBeDisabled();
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByRole('status')).toContainText('Saved the Focused local review template.');

  await page.getByRole('combobox', { name: 'Template' }).selectOption({ label: 'Focused local review' });
  await page.getByRole('textbox', { name: 'Domain', exact: true }).fill('portal.example.test');
  await page.getByRole('button', { name: 'Start guide' }).click();
  await expect(page.locator('.guide')).toContainText('Focused local review: portal.example.test');
  await expect(currentAction(page)).toContainText('Collect selected evidence');
  await expect(currentAction(page).getByRole('button', { name: 'Review requests' })).toBeVisible();
  const stored = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || 'null'), GUIDE_KEY);
  expect(stored).toMatchObject({
    version: 4,
    recipeId: 'new_domain_triage',
    template: { label: 'Focused local review' },
  });
  expect(stored.template.stages).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'lookup', requiresApproval: true }),
  ]));

  await page.setViewportSize({ width: 320, height: 760 });
  await expectNoHorizontalOverflow(page);
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

test('brand sweep carries the official domain and selected candidates across every tool', async ({ page }) => {
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
  const candidates = (await page.locator('.candidate strong').evaluateAll((elements) => (
    elements.slice(0, 2).map((element) => element.textContent?.trim() || '')
  ))).filter(Boolean);
  expect(candidates).toHaveLength(2);
  const primaryCandidate = candidates[0];
  if (!primaryCandidate) throw new Error('Expected at least one generated candidate.');
  await page.locator('.candidate input[type="checkbox"]').nth(0).check();
  await page.locator('.candidate input[type="checkbox"]').nth(1).check();
  await page.getByRole('button', { name: 'Continue to Bulk with 2' }).click();
  await expect(currentAction(page)).toContainText('Triage candidates');
  const handedOffGuide = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || 'null'), GUIDE_KEY);
  expect(handedOffGuide.reviewDomains).toEqual(candidates);
  expect(handedOffGuide.stages.find((stage: { id: string }) => stage.id === 'discover')).toMatchObject({
    outcome: 'complete',
    reviewNote: null,
  });

  await runBulkStep(page, 'Triage candidates');
  await expect(currentAction(page)).toContainText('Inspect priority domain');
  await currentAction(page).getByRole('link', { name: 'Choose a Bulk candidate' }).click();
  await expect(page.locator('#results')).toBeInViewport();
  await page.locator('.results-table tbody tr').first().getByRole('button', { name: 'Inspect' }).click();
  await expect(currentAction(page)).toContainText('Inspect priority domain');
  await runLookupStep(page, 'Inspect priority domain', primaryCandidate);
  await retainCases(page, 'Retain reviewed work', [primaryCandidate]);
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
  await currentAction(page).getByRole('textbox', { name: 'What remains incomplete?' }).fill('The registry source was unavailable, so the evidence needs another review.');
  await currentAction(page).getByRole('button', { name: 'Confirm partial' }).click();
  await expect(currentAction(page)).toContainText('Compare relationships');
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
  expect(payload).toMatchObject({ schema: 'whoisleuth.investigation-recipe-summary', version: 3, recipe: { id: 'new_domain_triage' }, template: null });
  expect(payload.stages[0]).toHaveProperty('reviewNote', null);
  expect(Object.keys(payload).sort()).toEqual(['createdAt', 'generatedAt', 'limitations', 'recipe', 'schema', 'stages', 'status', 'target', 'template', 'updatedAt', 'version']);
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

test('prior progress migrates while future and oversized current records stay untouched', async ({ page }) => {
  await page.goto('/dashboard');
  const legacy = JSON.stringify({ version: 1, domain: 'example.test', createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:05:00.000Z', visitedStages: ['lookup'] });
  await page.evaluate(({ key, value }) => sessionStorage.setItem(key, value), { key: ORIGINAL_GUIDE_KEY, value: legacy });
  await page.reload();
  await expect(page.locator('.guide')).toContainText('New-domain triage: example.test');
  expect(await page.evaluate((key) => sessionStorage.getItem(key), ORIGINAL_GUIDE_KEY)).toBe(legacy);

  const migrated = await page.evaluate((key) => sessionStorage.getItem(key), GUIDE_KEY);
  expect(migrated).not.toBeNull();
  const previous = JSON.stringify({ ...JSON.parse(migrated || '{}'), version: 3 });
  await page.evaluate(({ current, prior, value }) => {
    sessionStorage.removeItem(current);
    sessionStorage.setItem(prior, value);
  }, { current: GUIDE_KEY, prior: PREVIOUS_GUIDE_KEY, value: previous });
  await page.reload();
  await expect(page.locator('.guide')).toContainText('New-domain triage: example.test');
  const normalized = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || 'null'), GUIDE_KEY);
  expect(normalized).toMatchObject({ version: 4, recipeId: 'new_domain_triage' });
  expect(normalized.stages.every((stage: Record<string, unknown>) => stage.reviewNote === null)).toBe(true);

  const future = JSON.stringify({ version: 5, recipeId: 'new_domain_triage' });
  await page.evaluate(({ key, value }) => sessionStorage.setItem(key, value), { key: GUIDE_KEY, value: future });
  await page.reload();
  await expect(page.locator('.guide')).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), GUIDE_KEY)).toBe(future);

  const oversized = 'x'.repeat(12_289);
  await page.evaluate(({ key, value }) => sessionStorage.setItem(key, value), { key: GUIDE_KEY, value: oversized });
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
  await currentAction(page).getByRole('textbox', { name: 'Why is this step being skipped?' }).fill('The existing profile has already been reviewed.');
  await currentAction(page).getByRole('button', { name: 'Confirm skipped' }).click();
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
  await page.evaluate((key) => sessionStorage.setItem(key, 'previous-copy'), PREVIOUS_GUIDE_KEY);
  await page.evaluate((key) => sessionStorage.setItem(key, 'legacy-copy'), LEGACY_GUIDE_KEY);
  await page.evaluate((key) => sessionStorage.setItem(key, 'original-copy'), ORIGINAL_GUIDE_KEY);
  await page.getByText('Guide options', { exact: true }).click();
  await page.getByRole('button', { name: 'End guide' }).click();
  await expect(page.locator('.guide')).toHaveCount(0);
  expect(await page.evaluate(
    ({ current, previous, legacy, original }) => [sessionStorage.getItem(current), sessionStorage.getItem(previous), sessionStorage.getItem(legacy), sessionStorage.getItem(original)],
    { current: GUIDE_KEY, previous: PREVIOUS_GUIDE_KEY, legacy: LEGACY_GUIDE_KEY, original: ORIGINAL_GUIDE_KEY },
  )).toEqual([null, null, null, null]);
});
