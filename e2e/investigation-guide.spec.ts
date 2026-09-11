import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, failBrowserLocalReads, holdBrowserLocalTransaction, lookupDomainIdentity, migrateLegacyBrowserData, openDashboardGuidedInvestigation, openDashboardSecondaryWorkspaces, selectBulkResultView, useTheme } from './helpers';
import { BASE_URL } from './constants.ts';
import { CASE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/case-model';
import { INVESTIGATION_GUIDE_KEY as GUIDE_KEY } from '../frontend/src/lib/investigation-guide-storage';

type RecipeLabel =
  | 'Brand sweep'
  | 'Infrastructure pivot'
  | 'New-domain triage'
  | 'Credential impersonation response'
  | 'Mail abuse response'
  | 'Domain-control change response';

type LookupRevealProbe = {
  resultReveals: number;
  immediateHeading: { top: number; bottom: number; headerBottom: number; viewportHeight: number } | null;
};

async function startRecipe(
  page: import('@playwright/test').Page,
  recipe: RecipeLabel = 'New-domain triage',
  target = 'Portal.Example.Test.',
) {
  await page.goto('/dashboard');
  await openDashboardGuidedInvestigation(page);
  await page.getByRole('combobox', { name: 'Guide' }).selectOption({ label: recipe });
  const targetLabel = recipe === 'Brand sweep' || recipe === 'Domain-control change response'
    ? 'Official domain'
    : recipe === 'Infrastructure pivot'
      ? 'Starting domain'
      : recipe.endsWith('response')
        ? 'Domain under review'
        : 'Domain';
  await page.getByRole('textbox', { name: targetLabel, exact: true }).fill(target);
  await page.getByRole('button', { name: 'Start guide' }).click();
  await expect(page.locator('.guide')).toBeFocused();
  await expect(currentAction(page)).toBeVisible();
}

function currentAction(page: import('@playwright/test').Page) {
  return page.locator('.guide .current-action');
}

async function openWorkPlan(page: import('@playwright/test').Page) {
  const plan = page.locator('details.work-plan');
  await expect(plan).toHaveCount(1);
  if (!await plan.evaluate((element: HTMLDetailsElement) => element.open)) await plan.locator(':scope > summary').click();
  await expect(plan).toHaveJSProperty('open', true);
}

async function allowAndOpen(page: import('@playwright/test').Page, tool: 'Discover' | 'Bulk' | 'Lookup') {
  await openWorkPlan(page);
  const action = currentAction(page);
  await action.getByRole('button', { name: 'Review requests' }).click();
  const review = action.getByRole('region', { name: /Review requests for/ });
  await expect(review).toBeVisible();
  await expect(review).toContainText('1 target');
  await expect(review).toContainText('Retention');
  await expect(review).toContainText('Controls');
  await expect(review).toContainText('Limits');
  await action.getByRole('button', { name: `Allow and open ${tool}` }).click();
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
  await openWorkPlan(page);
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

async function installLookupFixture(page: import('@playwright/test').Page, beforeResponse?: () => Promise<void>) {
  await page.route('**/api/lookup?*', async (route) => {
    const url = new URL(route.request().url());
    const domain = url.searchParams.get('q') || 'portal.example.test';
    const identity = lookupDomainIdentity(domain);
    const compact = url.searchParams.get('compact') === '1';
    const availability = {
      applicable: true,
      state: 'registered',
      confidence: 'high',
      domain: identity.registrableDomain,
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
    await beforeResponse?.();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(compact ? { availability, diagnostics } : {
        ...identity,
        availability,
        rdap: { parsed: { status: ['active'], entities: [] } },
        whois: { parsed: {}, chain: [] },
        diagnostics,
      }),
    });
  });
}

for (const width of [1280, 390]) for (const intent of ['unchanged', 'guide', 'wheel'] as const) {
  test(`late Lookup reveal respects ${intent} viewport intent at ${width}px`, { tag: '@timing-sensitive' }, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 844 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(() => {
      const state: LookupRevealProbe = { resultReveals: 0, immediateHeading: null };
      Object.defineProperty(window, '__lookupRevealProbe', { value: state });
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (options?: boolean | ScrollIntoViewOptions) {
        if (this.id === 'result') state.resultReveals += 1;
        original.call(this, options);
        if (this.id === 'result') {
          const heading = this.querySelector('h2');
          const header = document.querySelector('.shell > header');
          if (!heading || !header) throw new Error('The completed Lookup must contain its result heading and console header.');
          const rect = heading.getBoundingClientRect();
          state.immediateHeading = { top: rect.top, bottom: rect.bottom, headerBottom: header.getBoundingClientRect().bottom, viewportHeight: window.innerHeight };
        }
      };
    });
    let release: (() => Promise<void>) | null = null;
    await installLookupFixture(page, async () => { release = await holdBrowserLocalTransaction(page); });
    await startRecipe(page, 'New-domain triage', 'portal.test');
    await allowAndOpen(page, 'Lookup');
    const run = page.getByRole('button', { name: 'Run lookup', exact: true });
    await run.click();
    const resultHeading = page.getByRole('heading', { name: 'portal.test', exact: true });
    let retainedResultTop = 0;
    try {
      await expect(page.getByRole('heading', { name: 'registered', exact: true })).toBeVisible();
      await expect.poll(() => release !== null).toBe(true);
      await expect(page.getByRole('button', { name: 'Looking up…', exact: true })).toBeDisabled();
      if (intent === 'guide') {
        await openWorkPlan(page);
        await expect(page.locator('details.work-plan > summary')).toBeFocused();
      } else if (intent === 'wheel') {
        const before = await page.evaluate(() => window.scrollY);
        await page.mouse.move(width * 0.75, 300);
        await page.mouse.wheel(0, 1000);
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
        retainedResultTop = await resultHeading.evaluate(async (element) => {
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          return element.getBoundingClientRect().top;
        });
      }
    } finally {
      const finish = release as (() => Promise<void>) | null;
      if (finish) await finish();
    }
    await expect(run).toBeEnabled();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
    const reveal = await page.evaluate(() => (window as unknown as { __lookupRevealProbe: LookupRevealProbe }).__lookupRevealProbe);
    if (intent === 'unchanged') {
      expect(reveal.resultReveals).toBe(1);
      const immediate = reveal.immediateHeading;
      if (!immediate) throw new Error('The completed Lookup did not record a result reveal.');
      expect(immediate.top).toBeGreaterThanOrEqual(immediate.headerBottom);
      expect(immediate.bottom).toBeLessThanOrEqual(immediate.viewportHeight);
      await expect(resultHeading).toBeInViewport();
      await expect.poll(() => resultHeading.evaluate((element) =>
        element.getBoundingClientRect().top - (document.querySelector('.shell > header')?.getBoundingClientRect().bottom ?? 0),
      )).toBeGreaterThanOrEqual(0);
      for (const theme of ['light', 'dark'] as const) {
        await useTheme(page, theme);
        await page.screenshot({ path: testInfo.outputPath(`lookup-reveal-${width}-${theme}.png`) });
      }
      await openWorkPlan(page);
      await expect(page.locator('details.work-plan > summary')).toBeFocused();
      await expect(page.locator('details.work-plan > summary')).toBeInViewport();
    } else {
      expect(reveal.resultReveals).toBe(0);
      if (intent === 'guide') {
        await expect(page.locator('details.work-plan > summary')).toBeFocused();
        await expect(page.locator('details.work-plan > summary')).toBeInViewport();
      } else {
        // Removing the loading note can change scrollY through native scroll anchoring.
        // The content the analyst reached must retain its viewport position.
        const resultTop = await resultHeading.evaluate(element => element.getBoundingClientRect().top);
        expect(Math.abs(resultTop - retainedResultTop)).toBeLessThanOrEqual(1);
      }
    }
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
  await currentAction(page).getByRole('link', { name: 'Open Cases' }).click();
  const firstDomain = domains[0];
  if (!firstDomain) throw new Error('Case retention requires at least one domain.');
  await expect(page).toHaveURL(new RegExp(`/cases\\?investigation=1&domain=${firstDomain.replaceAll('.', '\\.')}`));
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
  for (const [index, domain] of domains.entries()) {
    await expect(queue).toContainText(domain);
    await queue.getByRole('button', { name: `Open case for ${domain}` }).click();
    const caseHeader = page.locator('.case-heading', { hasText: domain });
    await expect(caseHeader).toBeVisible();
    await expect(caseHeader).toBeFocused();
    if (index < domains.length - 1) await page.getByRole('link', { name: 'All Cases', exact: true }).click();
  }
  await markReviewed(page, label);
  const completedGuide = page.locator('.guide-complete');
  await expect(completedGuide).toContainText('All');
  await expect(completedGuide).not.toContainText('No case retained');
  const caseSelector = page.getByRole('combobox', { name: 'Case for this guide' });
  if (domains.length > 1) {
    await expect(completedGuide).toContainText('Selected Case has another target');
    const chooseCase = completedGuide.getByRole('button', { name: 'Choose Case for handoff' });
    await chooseCase.focus();
    await chooseCase.press('Enter');
    await expect(caseSelector).toBeFocused();
    await caseSelector.selectOption({ label: firstDomain });
    await expect(caseSelector).toBeFocused();
  } else {
    await expect(completedGuide.getByRole('button', { name: 'Choose Case for handoff' })).toHaveCount(0);
    await expect(caseSelector.locator('option:checked')).toHaveText(firstDomain);
  }
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
  const disclosure = guide.locator('details.work-plan > summary');
  await disclosure.focus();
  await disclosure.press('Enter');
  await expect(currentAction(page)).toHaveCount(1);
  await expect(currentAction(page)).toBeHidden();
  await expect(context).toBeHidden();
  await expect(disclosure).toContainText('0 of 5 steps reviewed');
  await disclosure.press('Enter');
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
  const fullPlan = guide.locator('#investigation-plan');
  const planItems = fullPlan.locator(':scope > li');
  await expect(planItems).toHaveCount(5);
  await expect(fullPlan).toHaveCSS('align-items', 'start');
  const fourthStepHeight = (await planItems.nth(3).boundingBox())?.height ?? 0;
  await planItems.nth(2).locator('summary').click();
  expect((await planItems.nth(3).boundingBox())?.height ?? 0).toBeCloseTo(fourthStepHeight, 0);
  await expect(guide.locator('.secondary-details')).toHaveCSS('align-items', 'flex-start');
  for (const surface of [
    { width: 1280, height: 720, theme: 'light' },
    { width: 1280, height: 720, theme: 'dark' },
    { width: 1024, height: 768, theme: 'light' },
    { width: 1024, height: 768, theme: 'dark' },
    { width: 390, height: 844, theme: 'light' },
    { width: 390, height: 844, theme: 'dark' },
    { width: 320, height: 700, theme: 'light' },
    { width: 320, height: 700, theme: 'dark' },
  ] as const) {
    await page.setViewportSize({ width: surface.width, height: surface.height });
    await useTheme(page, surface.theme);
    const stepRows = await planItems.evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
    expect(new Set(stepRows).size).toBe(surface.width <= 900 ? 5 : 3);
    await expectNoHorizontalOverflow(page);
  }
  expect(analysisRequests).toEqual([]);

  const stored = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || 'null'), GUIDE_KEY);
  expect(stored).toMatchObject({ version: 5, recipeId: 'brand_sweep', template: null, domain: 'portal.example.test', focusDomain: null, status: 'active' });
  expect(stored.stages.every((stage: Record<string, unknown>) => stage.outcome === 'pending' && stage.openedAt === null)).toBe(true);
});

test('a response playbook reaches focused local packet preflight without a request or submission', async ({ page }) => {
  const observedRequests: Array<{ method: string; origin: string; path: string; resourceType: string }> = [];
  const sockets: string[] = [];
  const expectedOrigin = new URL(BASE_URL).origin;
  page.on('request', (request) => {
    const url = new URL(request.url());
    const resourceType = request.resourceType();
    if (['fetch', 'xhr', 'ping'].includes(resourceType)
      || url.origin !== expectedOrigin
      || url.pathname.startsWith('/api/')
      || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      observedRequests.push({
        method: request.method(),
        origin: url.origin,
        path: `${url.pathname}${url.search}`,
        resourceType,
      });
    }
  });
  page.on('websocket', (socket) => sockets.push(socket.url()));
  await startRecipe(page, 'Credential impersonation response');
  await expect(page.locator('.guide')).toContainText('0 of 3 steps reviewed');
  await expect(currentAction(page)).toContainText('Review impersonation evidence');

  await currentAction(page).getByRole('button', { name: 'Skip this step' }).click();
  await currentAction(page).getByRole('textbox', { name: 'Why is this step being skipped?' }).fill('Current evidence is already retained in the Case.');
  await currentAction(page).getByRole('button', { name: 'Confirm skipped' }).click();
  await expect(currentAction(page)).toContainText('Confirm affected brand boundary');
  await currentAction(page).getByRole('button', { name: 'Skip this step' }).click();
  await currentAction(page).getByRole('textbox', { name: 'Why is this step being skipped?' }).fill('No saved profile is required for this source-qualified review.');
  await currentAction(page).getByRole('button', { name: 'Confirm skipped' }).click();
  await expect(currentAction(page)).toContainText('Prepare reviewed response');

  await currentAction(page).getByRole('link', { name: /Open Cases|Go to/ }).click();
  await expect(page).toHaveURL(/\/cases\?investigation=1&response=1&domain=portal\.example\.test#case-review-queue/u);
  const queue = page.locator('#case-review-queue');
  await queue.getByRole('button', { name: 'Open case for portal.example.test' }).click();
  const preflight = page.locator('details[id^="case-response-preflight-"]');
  await expect(preflight).toHaveAttribute('open', '');
  await expect(preflight.getByText('Prepare a reviewed abuse evidence packet', { exact: true })).toBeFocused();
  await expect(preflight).toContainText('This prepares local drafts only; nothing is sent.');
  await expect(preflight).toContainText('Lookup Decision Facts are transient and are not copied into browser-local cases');
  const allowedStartupReads = new Set(['/api/session', '/api/capabilities']);
  for (const request of observedRequests) {
    expect(request.origin).toBe(expectedOrigin);
    expect(request.method).toBe('GET');
    expect(allowedStartupReads.has(request.path)).toBe(true);
    expect(['fetch', 'xhr'].includes(request.resourceType)).toBe(true);
  }
  expect(new Set(observedRequests.map((request) => request.path))).toEqual(allowedStartupReads);
  expect(sockets).toEqual([]);
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
  await expect(guide.getByRole('status').filter({ hasText: 'Changing the target restarts this guide' })).toBeVisible();
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
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: [{
      id: 'template-context', domain: 'template-context.example.test', status: 'new', disposition: 'unreviewed', tags: [], notes: [],
      source: 'manual', evidenceHistory: [], createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    }] },
  });
  await openDashboardSecondaryWorkspaces(page);
  await page.getByRole('button', { name: 'New template' }).click();
  await page.getByRole('textbox', { name: 'Template name' }).fill('Focused local review');
  await page.getByRole('textbox', { name: 'Summary' }).fill('Review the selected bounded evidence and record a decision.');
  await page.getByRole('textbox', { name: 'Step label' }).first().fill('Collect selected evidence');
  const mandatoryApproval = page.getByRole('checkbox', { name: /Require approval.+mandatory/u }).first();
  await expect(mandatoryApproval).toBeChecked();
  await expect(mandatoryApproval).toBeDisabled();
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved the Focused local review template.' })).toBeVisible();

  await page.getByRole('combobox', { name: 'Template' }).selectOption({ label: 'Focused local review' });
  await page.getByRole('textbox', { name: 'Domain', exact: true }).fill('portal.example.test');
  await page.getByRole('button', { name: 'Start guide' }).click();
  await expect(page.locator('.guide')).toContainText('Focused local review: portal.example.test');
  await expect(currentAction(page)).toContainText('Collect selected evidence');
  await expect(currentAction(page).getByRole('button', { name: 'Review requests' })).toBeVisible();
  const stored = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || 'null'), GUIDE_KEY);
  expect(stored).toMatchObject({
    version: 5,
    recipeId: 'new_domain_triage',
    template: { label: 'Focused local review' },
  });
  expect(stored.template.stages).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'lookup', requiresApproval: true }),
  ]));

  await page.setViewportSize({ width: 320, height: 760 });
  await expectNoHorizontalOverflow(page);
});

test('new-domain triage leads from a deep lookup through comparison and a review queue', {
  tag: ['@timing-sensitive', '@analyst-journey', '@journey-guided-new-domain-triage'],
}, async ({ page }) => {
  test.slow();
  await installLookupFixture(page);
  await startRecipe(page, 'New-domain triage', 'Portal.Test.');
  await expect(currentAction(page).getByRole('button', { name: 'Review requests' })).toBeVisible();

  await runLookupStep(page, 'Collect domain evidence', 'portal.test');
  await expect(currentAction(page)).toContainText('Compare focused peers');
  await runBulkStep(page, 'Compare focused peers', ['portal.test', 'peer.test']);
  await expect(currentAction(page)).toContainText('Record disposition');
  await page.setViewportSize({ width: 320, height: 760 });
  await retainCases(page, 'Record disposition', ['portal.test', 'peer.test']);
  await expectNoHorizontalOverflow(page);
  await expect(page.locator('.guide')).toContainText('3 of 3 steps reviewed');
});

test('infrastructure pivot keeps the starting domain through lookup, peer comparison, and retention', {
  tag: ['@timing-sensitive', '@analyst-journey', '@journey-guided-infrastructure-pivot'],
}, async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 393, height: 852 });
  await installLookupFixture(page);
  await startRecipe(page, 'Infrastructure pivot', 'Portal.Test.');
  await expect(currentAction(page).getByRole('button', { name: 'Review requests' })).toBeVisible();

  await runLookupStep(page, 'Collect starting evidence', 'portal.test');
  await runBulkStep(page, 'Compare relationships', ['portal.test', 'related.test']);
  await retainCases(page, 'Retain defensible pivots', ['portal.test', 'related.test']);
  await expect(page.locator('.guide')).toContainText('3 of 3 steps reviewed');
});

test('returning to the same guided Bulk step keeps its peer set and completed results', { tag: '@timing-sensitive' }, async ({ page }) => {
  test.slow();
  await installLookupFixture(page);
  await startRecipe(page, 'New-domain triage', 'Portal.Test.');

  await runLookupStep(page, 'Collect domain evidence', 'portal.test');
  await allowAndOpen(page, 'Bulk');
  const peers = ['portal.test', 'peer.test'];
  await page.locator('#domains').fill(peers.join('\n'));
  await page.getByRole('button', { name: 'Scan 2 domains' }).click();
  await expect(page.locator('.results-table tbody tr')).toHaveCount(2);

  await page.locator('#console-navigation').getByRole('link', { name: /^Dashboard/ }).click();
  await openWorkPlan(page);
  await expect(currentAction(page)).toContainText('Compare focused peers');
  await currentAction(page).getByRole('link', { name: 'Open Bulk' }).click();

  await expect(page.locator('#domains')).toHaveValue(peers.join('\n'));
  await expect(page.locator('.results-table tbody tr')).toHaveCount(2);
  await expect(page.getByRole('status').filter({ hasText: 'Completed 2 of 2 lookups.' })).toBeVisible();
});

test('brand sweep carries the official domain and selected candidates across every tool', {
  tag: ['@timing-sensitive', '@analyst-journey', '@journey-guided-brand-sweep'],
}, async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 393, height: 852 });
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
  await expect(page).toHaveURL(/\/bulk\?source=discover&handoff=[0-9a-f]{32}$/u);
  await expect(currentAction(page)).toContainText('Triage candidates');
  const handedOffGuide = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || 'null'), GUIDE_KEY);
  expect(handedOffGuide.reviewDomains).toEqual(candidates);
  expect(handedOffGuide.stages.find((stage: { id: string }) => stage.id === 'discover')).toMatchObject({
    outcome: 'complete',
    reviewNote: null,
  });

  await runBulkStep(page, 'Triage candidates');
  await expect(currentAction(page)).toContainText('Inspect priority domain');
  const candidateSelectionLink = currentAction(page).getByRole('link', { name: 'Choose a Bulk candidate' });
  await expect(candidateSelectionLink).toHaveAttribute('href', '#results');
  await candidateSelectionLink.click();
  await expect(page).toHaveURL(/\/bulk\?source=discover&handoff=[0-9a-f]{32}#results$/u);
  await expect(page.locator('#results')).toBeInViewport();
  await selectBulkResultView(page, 'Review');
  const reviewCockpit = page.getByRole('region', { name: 'Review one result' });
  await expect(reviewCockpit.getByRole('heading', { name: primaryCandidate })).toBeVisible();
  await reviewCockpit.getByRole('button', { name: 'Inspect in Lookup' }).click();
  await expect(page).toHaveURL(new RegExp(`/lookup\\?q=${primaryCandidate.replaceAll('.', '\\.')}.*depth=deep`));
  await expect.poll(async () => page.evaluate((key) => {
    const stored = JSON.parse(sessionStorage.getItem(key) || 'null');
    return stored?.focusDomain || null;
  }, GUIDE_KEY)).toBe(primaryCandidate);
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

test('return control recovers when the first action-panel scroll is displaced', { tag: '@timing-sensitive' }, async ({ page }) => {
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

test('a browser-local context failure does not block or misstate a guided investigation', async ({ page }) => {
  await page.goto('/dashboard');
  await openDashboardGuidedInvestigation(page);
  await expect(page.getByRole('combobox', { name: 'Template' })).toBeEnabled();
  await page.getByRole('textbox', { name: 'Domain', exact: true }).fill('portal.example.test');
  await failBrowserLocalReads(page);
  await page.getByRole('button', { name: 'Start guide' }).click();

  const guide = page.locator('.guide');
  await expect(guide).toBeFocused();
  await expect(currentAction(page)).toContainText('Collect domain evidence');
  await expect(guide.getByRole('status').filter({ hasText: 'Some browser-local investigation context is unavailable' })).toContainText('unreadable saved data is not treated as absent');
  await expect(guide.getByText('Unavailable', { exact: true })).toHaveCount(3);
  await guide.getByText('Saved evidence unavailable', { exact: true }).click();
  await expect(guide).toContainText('do not interpret this state as an empty evidence history');

  await page.evaluate((key) => {
    const stored = JSON.parse(sessionStorage.getItem(key) || 'null');
    const now = new Date().toISOString();
    for (const stage of stored.stages.slice(0, 2)) {
      stage.outcome = 'complete';
      stage.updatedAt = now;
    }
    stored.updatedAt = now;
    sessionStorage.setItem(key, JSON.stringify(stored));
    window.dispatchEvent(new CustomEvent('whoisleuth:investigation-guide-change'));
  }, GUIDE_KEY);

  const caseHandoff = guide.getByRole('region', { name: 'Case handoff readiness' });
  await expect(currentAction(page)).toContainText('Record disposition');
  await expect(caseHandoff).toContainText('Handoff context unavailable');
  await expect(caseHandoff).toContainText('No handoff check is inferred from unavailable saved data.');
  await expect(caseHandoff).not.toContainText(/No case retained|No typed|Open questions reviewed/u);

  await page.evaluate((key) => {
    const stored = JSON.parse(sessionStorage.getItem(key) || 'null');
    const now = new Date().toISOString();
    for (const stage of stored.stages) {
      stage.outcome = 'complete';
      stage.updatedAt = now;
    }
    stored.updatedAt = now;
    sessionStorage.setItem(key, JSON.stringify(stored));
    window.dispatchEvent(new CustomEvent('whoisleuth:investigation-guide-change'));
  }, GUIDE_KEY);

  const completedHandoff = guide.getByRole('region', { name: 'Completed guide handoff readiness' });
  await expect(guide.locator('.guide-complete')).toBeVisible();
  await expect(completedHandoff).toContainText('Handoff context unavailable');
  await expect(completedHandoff).toContainText('No completed handoff state is inferred from unavailable saved data.');
  await expect(completedHandoff).not.toContainText(/evidence pin|decision|unresolved unknown/u);
});

test('an unavailable active-profile preference does not hide a healthy retained Case', async ({ page }) => {
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: [{
      id: 'healthy-guide-case',
      domain: 'portal.example.test',
      status: 'reviewing',
      disposition: 'unreviewed',
      brandProfileIds: [],
      tags: [],
      notes: [],
      source: 'lookup',
      evidenceHistory: [],
      evidencePins: [],
      decisions: [],
      actions: [],
      assertions: [],
      manualTrail: [],
      sightings: [],
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }] },
  });
  await openDashboardSecondaryWorkspaces(page);
  await page.evaluate(() => {
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(name: string) {
      if (this === localStorage && name === 'whois-rdap-active-brand-profile-v1') {
        throw new DOMException('Preference read denied', 'SecurityError');
      }
      return originalGetItem.call(this, name);
    };
  });
  await page.getByRole('textbox', { name: 'Domain', exact: true }).fill('portal.example.test');
  await page.getByRole('button', { name: 'Start guide' }).click();

  const guide = page.locator('.guide');
  await expect(guide.getByText('Unavailable', { exact: true })).toHaveCount(1);
  await expect(guide.locator('.context-tray').getByText('reviewing · unreviewed', { exact: true })).toBeVisible();
  const unavailableContext = guide.getByRole('status').filter({ hasText: 'Some browser-local investigation context is unavailable' });
  await expect(unavailableContext).toContainText('active-profile preference');
  await expect(unavailableContext).not.toContainText('Cases');
  await page.evaluate((key) => {
    const stored = JSON.parse(sessionStorage.getItem(key) || 'null');
    const now = new Date().toISOString();
    for (const stage of stored.stages.slice(0, 2)) {
      stage.outcome = 'complete';
      stage.updatedAt = now;
    }
    stored.updatedAt = now;
    sessionStorage.setItem(key, JSON.stringify(stored));
    window.dispatchEvent(new CustomEvent('whoisleuth:investigation-guide-change'));
  }, GUIDE_KEY);
  const handoff = guide.getByRole('region', { name: 'Case handoff readiness' });
  await expect(handoff).toBeVisible();
  await expect(handoff).not.toContainText('Handoff context unavailable');
  await expect(handoff.getByRole('link', { name: 'Open case decision workspace' })).toBeVisible();
});

test('partial progress, pause, resume, and restart remain explicit', async ({ page }) => {
  await startRecipe(page, 'Infrastructure pivot');
  await allowAndOpen(page, 'Lookup');
  await openWorkPlan(page);
  await currentAction(page).getByRole('button', { name: 'Mark partial' }).click();
  await currentAction(page).getByRole('textbox', { name: 'What remains incomplete?' }).fill('The registry source was unavailable, so the evidence needs another review.');
  await currentAction(page).getByRole('button', { name: 'Confirm partial' }).click();
  await expect(currentAction(page)).toContainText('Compare relationships');
  await page.getByText('Guide options', { exact: true }).click();
  await page.getByRole('button', { name: 'Pause guide' }).click();
  await expect(page.locator('.guide')).toContainText('Paused');
  await page.reload();
  await openWorkPlan(page);
  await page.getByRole('button', { name: 'Resume guide' }).click();
  await page.getByText('Guide options', { exact: true }).click();
  await page.getByRole('button', { name: 'Restart guide' }).click();
  await page.getByRole('button', { name: 'Confirm restart' }).click();
  await expect(page.locator('.guide')).toContainText('0 of 3 steps reviewed');
  await expect(currentAction(page)).toContainText('Collect starting evidence');
});

test('failed guide progress and clear operations retain the draft and visible context', async ({ page }) => {
  await startRecipe(page, 'Infrastructure pivot');
  await allowAndOpen(page, 'Lookup');
  await openWorkPlan(page);
  await currentAction(page).getByRole('button', { name: 'Mark partial', exact: true }).click();
  const rationale = currentAction(page).getByRole('textbox', { name: 'What remains incomplete?', exact: true });
  await rationale.fill('The selected source needs a later review.');
  await page.evaluate((key) => {
    const target = window as typeof window & { failGuideWrites?: boolean };
    target.failGuideWrites = true;
    const set = Storage.prototype.setItem;
    const remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (name: string, value: string) {
      if (this === sessionStorage && name === key && target.failGuideWrites) throw new DOMException('Unavailable', 'QuotaExceededError');
      return set.call(this, name, value);
    };
    Storage.prototype.removeItem = function (name: string) {
      if (this === sessionStorage && name === key && target.failGuideWrites) throw new DOMException('Unavailable', 'InvalidStateError');
      return remove.call(this, name);
    };
  }, GUIDE_KEY);
  await currentAction(page).getByRole('button', { name: 'Confirm partial', exact: true }).click();
  await expect(page.locator('.guide').getByRole('alert')).toContainText('Could not retain');
  await expect(rationale).toHaveValue('The selected source needs a later review.');
  await expect(page.locator('.guide')).toContainText('0 of 3 steps reviewed');
  await page.getByRole('button', { name: 'Clear context', exact: true }).click();
  await expect(page.locator('.guide').getByRole('alert')).toContainText('Could not clear');
  await expect(rationale).toHaveValue('The selected source needs a later review.');
  await page.evaluate(() => { (window as typeof window & { failGuideWrites?: boolean }).failGuideWrites = false; });
  await currentAction(page).getByRole('button', { name: 'Confirm partial', exact: true }).click();
  await expect(page.locator('.guide')).toContainText('1 of 3 steps reviewed');
  expect(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || 'null').stages[0].reviewNote, GUIDE_KEY)).toBe('The selected source needs a later review.');
  await page.getByRole('button', { name: 'Clear context', exact: true }).click();
  await expect(page.locator('.guide')).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), GUIDE_KEY)).toBeNull();
});

test('step selection and disclosure preserve separate temporary outcome notes without recording progress', async ({ page }) => {
  await startRecipe(page, 'Infrastructure pivot');
  await allowAndOpen(page, 'Lookup');
  await openWorkPlan(page);
  await currentAction(page).getByRole('button', { name: 'Mark partial', exact: true }).click();
  await currentAction(page).getByRole('textbox', { name: 'What remains incomplete?', exact: true }).fill('Unsubmitted evidence note.');
  const stage = page.getByRole('combobox', { name: 'Review step', exact: true });
  await stage.selectOption('bulk');
  await currentAction(page).getByRole('button', { name: 'Skip this step', exact: true }).click();
  await currentAction(page).getByRole('textbox', { name: 'Why is this step being skipped?', exact: true }).fill('Unsubmitted comparison note.');
  await stage.selectOption('lookup');
  const note = currentAction(page).getByRole('textbox', { name: 'What remains incomplete?', exact: true });
  await expect(note).toHaveValue('Unsubmitted evidence note.');
  const summary = page.locator('details.work-plan > summary');
  await summary.click();
  await expect(currentAction(page).locator('textarea')).toHaveCount(1);
  await expect(note).toBeHidden();
  await summary.press('Enter');
  await expect(note).toHaveValue('Unsubmitted evidence note.');
  const before = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || 'null'), GUIDE_KEY);
  expect(before.stages.every((item: { outcome: string; reviewNote: string | null }) => item.outcome === 'pending' && item.reviewNote === null)).toBe(true);
  expect(before.stages.find((item: { id: string }) => item.id === 'bulk').approvedAt).toBeNull();
  await stage.selectOption('bulk');
  await expect(currentAction(page).getByRole('textbox', { name: 'Why is this step being skipped?', exact: true })).toHaveValue('Unsubmitted comparison note.');
  await currentAction(page).getByRole('button', { name: 'Confirm skipped', exact: true }).click();
  await expect(currentAction(page)).toBeFocused();
  const after = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || 'null'), GUIDE_KEY);
  expect(after.stages.find((item: { id: string }) => item.id === 'bulk')).toMatchObject({ outcome: 'skipped', reviewNote: 'Unsubmitted comparison note.' });
  expect(after.stages.find((item: { id: string }) => item.id === 'lookup')).toMatchObject({ outcome: 'pending', reviewNote: null });
  await expect(note).toHaveValue('Unsubmitted evidence note.');
  await page.reload();
  await expect(page.locator('details.work-plan')).toHaveJSProperty('open', false);
  await openWorkPlan(page);
  await expect(currentAction(page).getByRole('textbox')).toHaveCount(0);
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
  expect(payload).toMatchObject({ schema: 'whoisleuth.investigation-recipe-summary', version: 4, recipe: { id: 'new_domain_triage' }, template: null });
  expect(payload.stages[0]).toHaveProperty('reviewNote', null);
  expect(Object.keys(payload).sort()).toEqual(['createdAt', 'generatedAt', 'limitations', 'recipe', 'schema', 'stages', 'status', 'target', 'template', 'updatedAt', 'version']);
});

test('shows retained Case context without treating a record update as evidence or workflow completion', async ({ page }) => {
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: [{
      id: 'case-recipe-1', domain: 'portal.example.test', status: 'new', disposition: 'unreviewed', tags: [], notes: [],
      source: 'lookup', evidenceHistory: [], createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z',
    }] },
  });
  await openDashboardSecondaryWorkspaces(page);
  await page.getByRole('textbox', { name: 'Domain', exact: true }).fill('portal.example.test');
  await page.getByRole('button', { name: 'Start guide' }).click();
  await page.getByText(/^Saved evidence/).click();
  await expect(page.locator('.evidence-checkpoint')).toContainText('0 observations');
  await expect(page.locator('.context-tray')).toContainText('Retained context only; no evidence captures');
  await expect(page.locator('.guide')).toContainText('0 of 3 steps reviewed');
});

test('the guide does not arbitrarily choose between retained hostname and parent Cases', async ({ page }) => {
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: ['example.test', 'login.example.test'].map((domain, index) => ({
      id: `guide-case-${index}`, domain, status: 'new', disposition: 'unreviewed', tags: [], notes: [], source: 'manual', evidenceHistory: [], createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z',
    })) },
  }, { destination: '/dashboard' });
  await startRecipe(page, 'New-domain triage', 'login.example.test');
  await expect(page.locator('.context-tray')).toContainText('Choose a Case (2 match this target)');
  await expect(page.locator('.guide').getByRole('link', { name: 'Review case decision workspace' })).toHaveCount(0);
  const caseSelector = page.getByRole('combobox', { name: 'Case for this guide' });
  await expect(caseSelector).toHaveValue('');
  await expect(caseSelector.getByRole('option')).toHaveCount(3);
  await caseSelector.focus();
  await caseSelector.selectOption({ label: 'login.example.test' });
  await expect(caseSelector).toHaveValue('guide-case-1');
  await expect(caseSelector).toBeFocused();
  await expect(page.locator('.context-tray')).toContainText('new · unreviewed');
  await page.setViewportSize({ width: 320, height: 760 });
  expect(await caseSelector.evaluate((element) => {
    const control = element.getBoundingClientRect();
    const context = element.closest('.context-tray')!.getBoundingClientRect();
    return control.width >= context.width * 0.9 && control.height >= 44;
  })).toBe(true);
  await expectNoHorizontalOverflow(page);
});

test('future and oversized current guide records stay untouched', async ({ page }) => {
  await page.goto('/dashboard');
  const future = JSON.stringify({ version: 6, recipeId: 'new_domain_triage' });
  await page.evaluate(({ key, value }) => sessionStorage.setItem(key, value), { key: GUIDE_KEY, value: future });
  await page.reload();
  await openDashboardGuidedInvestigation(page);
  await expect(page.locator('.guide')).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), GUIDE_KEY)).toBe(future);

  const oversized = 'x'.repeat(12_289);
  await page.evaluate(({ key, value }) => sessionStorage.setItem(key, value), { key: GUIDE_KEY, value: oversized });
  await page.reload();
  await openDashboardGuidedInvestigation(page);
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

test('ending a recipe removes its current tab record only', async ({ page }) => {
  await startRecipe(page);
  await page.getByText('Guide options', { exact: true }).click();
  await page.getByRole('button', { name: 'End guide' }).click();
  await expect(page.locator('.guide')).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), GUIDE_KEY)).toBeNull();
});
