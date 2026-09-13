import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, useTheme } from './helpers';

test.use({ storageState: { cookies: [], origins: [] } });

async function isolateCasePractice(page: Page) {
  const requests: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/') && path !== '/api/session') requests.push(path);
  });
  await page.addInitScript(() => {
    const accesses: string[] = [];
    Object.defineProperty(window, '__practiceStorageAccess', { value: accesses });
    IDBFactory.prototype.open = function(name) { accesses.push(`open:${name}`); throw new Error('Practice must not open saved work.'); };
    IDBFactory.prototype.deleteDatabase = function(name) { accesses.push(`delete:${name}`); throw new Error('Practice must not delete saved work.'); };
    localStorage.setItem('saved-work-sentinel', 'Keep this saved value.');
    sessionStorage.setItem('saved-work-sentinel', 'Keep this tab value.');
  });
  return async () => {
    expect(requests).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __practiceStorageAccess: string[] }).__practiceStorageAccess)).toEqual([]);
    expect(await page.evaluate(() => [localStorage.getItem('saved-work-sentinel'), sessionStorage.getItem('saved-work-sentinel')])).toEqual(['Keep this saved value.', 'Keep this tab value.']);
    const practice = page.getByRole('region', { name: 'Practise a Case review', exact: true });
    await expect(practice.locator('a[href], input[type=file]')).toHaveCount(0);
  };
}

test('real Case forms practise evidence, conclusions and inconclusive rechecks without saved-work access', async ({ page }) => {
  const verifyIsolation = await isolateCasePractice(page);
  await page.goto('/demo#case-practice');
  const practice = page.getByRole('region', { name: 'Practise a Case review', exact: true });
  await expect(practice).toBeVisible();
  const pin = practice.locator('form[data-recovery-form="evidence-pin"]');
  await pin.getByLabel('Label', { exact: true }).fill('Practice fact');
  await pin.getByLabel('Fact', { exact: true }).fill('The fictional page asks for an email address and password.');
  await pin.getByLabel('Source', { exact: true }).fill('Fictional supplied capture');
  await pin.getByLabel('Observed at', { exact: true }).fill('2026-09-01T12:00');
  await expect(pin.getByRole('status')).toContainText('page only');
  await practice.getByRole('button', { name: '2. Record a conclusion', exact: true }).click();
  await expect(practice.locator('#practice-assessment')).toBeFocused();
  await practice.getByRole('button', { name: '1. Pin a fact', exact: true }).click();
  await expect(pin.getByLabel('Label', { exact: true })).toHaveValue('Practice fact');
  await pin.getByRole('button', { name: 'Pin evidence', exact: true }).click();
  await expect(pin.getByLabel('Fact', { exact: true })).toHaveValue('');
  await expect(practice.locator('.practice-status')).toContainText('nothing was written to your saved workspace');

  await practice.getByRole('button', { name: '2. Record a conclusion', exact: true }).click();
  const decision = practice.locator('form[data-recovery-form="decision"]');
  await decision.getByRole('combobox', { name: 'Disposition', exact: true }).selectOption('suspicious');
  await decision.getByRole('combobox', { name: 'Review reason', exact: true }).selectOption('other_reviewed');
  await decision.getByLabel('Conclusion summary', { exact: true }).fill('The claimed identity needs verification');
  await decision.getByLabel('Evidence-based rationale', { exact: true }).fill('The form requests credentials, but its operator and purpose are not established.');
  await decision.getByRole('checkbox', { name: /Practice fact/u }).check();
  await decision.getByRole('button', { name: 'Record conclusion', exact: true }).click();
  await expect(decision.getByLabel('Conclusion summary', { exact: true })).toHaveValue('');
  await expect(practice.getByRole('region', { name: 'Case assessment' })).toContainText('The claimed identity needs verification');

  await practice.getByRole('button', { name: '3. Review a later capture', exact: true }).click();
  const recheck = practice.locator('form[data-recovery-form="observed-effect"]');
  await recheck.getByRole('combobox', { name: 'Saved question', exact: true }).selectOption({ label: 'Is the credential form still present?' });
  const laterId = await recheck.getByRole('combobox', { name: 'Current evidence', exact: true }).locator('option').filter({ hasText: 'Later capture did not complete' }).getAttribute('value');
  expect(laterId).toBeTruthy();
  await recheck.getByRole('combobox', { name: 'Current evidence', exact: true }).selectOption(laterId!);
  await recheck.getByRole('combobox', { name: 'Comparison conditions', exact: true }).selectOption('comparable');
  await recheck.getByRole('combobox', { name: 'Observed effect', exact: true }).selectOption('not_reproduced');
  await recheck.getByRole('button', { name: 'Record independent outcome', exact: true }).click();
  await expect(recheck.getByRole('alert')).toContainText('requires a complete observation');
  await expect(practice.getByRole('list', { name: 'Practice recheck records' })).toHaveCount(0);
  await recheck.getByRole('combobox', { name: 'Observed effect', exact: true }).selectOption('unavailable');
  await recheck.getByRole('button', { name: 'Record independent outcome', exact: true }).click();
  await expect(practice.getByRole('list', { name: 'Practice recheck records' })).toContainText('unavailable · partial · Fictional later capture');
  await expect(recheck.getByRole('button', { name: 'Record independent outcome', exact: true })).toBeFocused();
  await verifyIsolation();
});

test('Case practice is reachable, responsive and discarded on restart or reload', async ({ page }, testInfo) => {
  const verifyIsolation = await isolateCasePractice(page);
  await page.goto('/resources');
  await page.getByRole('link', { name: 'practise an evidence-to-recheck workflow with the real Case forms' }).click();
  await expect(page).toHaveURL(/\/demo#case-practice$/u);
  const practice = page.getByRole('region', { name: 'Practise a Case review', exact: true });
  const form = practice.locator('form[data-recovery-form="evidence-pin"]');
  await expect(form).toBeVisible();
  await form.getByLabel('Label', { exact: true }).fill('Discard this practice draft');
  await expect(form.getByRole('status')).toContainText('page only');
  await practice.getByRole('button', { name: 'Discard practice and restart', exact: true }).click();
  await expect(practice.getByRole('heading', { name: 'Practise a Case review', exact: true })).toBeFocused();
  await expect(form.getByLabel('Label', { exact: true })).toHaveValue('');
  await form.getByLabel('Label', { exact: true }).fill('Discard this on reload too');
  await expect(form.getByRole('status')).toContainText('page only');
  await page.reload();
  await expect(form.getByLabel('Label', { exact: true })).toHaveValue('');
  for (const [width, height] of [[320, 700], [390, 844], [1024, 768], [1280, 720], [2560, 1440]] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      for (const name of ['1. Pin a fact', '2. Record a conclusion', '3. Review a later capture']) {
        await practice.getByRole('button', { name, exact: true }).click();
        const ids = ['practice-evidence', 'practice-assessment', 'practice-recheck'];
        for (const [index, id] of ids.entries()) {
          const heading = practice.locator(`#${id}`);
          await expect(heading).toHaveCount(1);
          if (index === Number(name[0]) - 1) await expect(heading).toBeVisible(); else await expect(heading).toBeHidden();
        }
        await expectNoHorizontalOverflow(page);
        if (width === 320 || width === 1280) await page.screenshot({ path: testInfo.outputPath(`case-practice-${name[0]}-${theme}-${width}.png`) });
      }
      if (width === 320 || width === 1280) expect((await new AxeBuilder({ page }).include('#case-practice').analyze()).violations).toEqual([]);
    }
  }
  await verifyIsolation();
});

test('the suspicious-domain and change-review scenarios can start directly', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const apiRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
  await page.goto('/demo');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [390, 1920]) {
      await page.setViewportSize({ width, height: 1080 });
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`scenario-choices-${theme}-${width}.png`) });
    }
  }
  await page.getByRole('button', { name: 'Inspect suspicious domain' }).click();
  await expect(page.getByRole('heading', { name: 'northstar-login.example', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Open synthetic Case' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand Relationships and history evidence' }).click();
  const evidence = page.getByRole('region', { name: 'Where this result came from', exact: true });
  await expect(evidence).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [390, 1920]) {
      await page.setViewportSize({ width, height: 1080 });
      await evidence.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`scenario-evidence-${theme}-${width}.png`) });
    }
  }
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await page.getByRole('button', { name: 'Compare a reported change' }).click();
  await expect(page.getByRole('heading', { name: 'Document and revisit northstar-login.example' })).toBeFocused();
  await page.getByRole('button', { name: 'Load later synthetic observation' }).click();
  await expect(page.getByRole('heading', { name: 'Repeated evidence and material changes stay distinct' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export synthetic case report' })).toBeVisible();
  expect(apiRequests.filter(url => new URL(url).pathname !== '/api/session')).toEqual([]);
});

async function progressToLookup(page: Page) {
  const workspace = page.locator('#demo-workspace');
  await page.getByRole('button', { name: 'Begin with Brands' }).click();
  await expect(page.getByRole('heading', { name: 'Define the official identity' })).toBeFocused();
  await expect(workspace).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Use synthetic profile' }).click();
  await expect(page.getByRole('heading', { name: 'Generate bounded candidate coverage' })).toBeFocused();
  await expect(workspace).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Generate fixed candidates' }).click();
  await expect(page.locator('.discover-candidates article')).toHaveCount(3);
  await page.getByRole('button', { name: 'Review 3 candidates in Bulk' }).click();
  await expect(page.getByRole('heading', { name: 'Prioritise candidates without collapsing evidence' })).toBeFocused();
  await expect(workspace).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Inspect northstar-login.example' }).click();
  await expect(page.getByRole('heading', { name: 'northstar-login.example' })).toBeFocused();
  await expect(workspace).toHaveAttribute('aria-busy', 'false');
}

async function workspaceTop(page: Page) {
  return page.locator('#demo-workspace').evaluate((element) => Math.round(element.getBoundingClientRect().top));
}

async function workspaceNeedsScroll(page: Page) {
  return page.locator('#demo-workspace').evaluate((element) => {
    const margin = Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
    return Math.abs(element.getBoundingClientRect().top - margin) > 1;
  });
}

test('completes the guided synthetic workflow without investigation requests or production-store access', async ({ page }) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const apiRequestPaths: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/api/')) apiRequestPaths.push(pathname);
  });

  await page.goto('/demo');
  await expect(page.locator('.demo-footer').getByRole('link', { name: 'Sign in to investigate' })).toHaveAttribute('href', '/login');
  await expect(page.getByRole('heading', { name: 'Explore a synthetic domain investigation.' })).toBeVisible();
  await expect(page.getByText('Synthetic demo · State resets with this tab')).toBeVisible();
  await expect(page.locator('.demo-stage-summary')).toContainText('Tool substep 1 of 6');
  await expect(page.getByRole('button', { name: /Dashboard.*Current/ })).toHaveAttribute('aria-current', 'step');
  await expect(page.getByRole('button', { name: /Cases.*Upcoming/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Begin with Brands' }).click();
  await expect(page.getByRole('heading', { name: 'Define the official identity' })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Northstar Outfitters' })).toBeVisible();
  await expect(page.getByText(/northstar\.example · Complete/)).toBeVisible();
  await page.getByRole('button', { name: 'Use synthetic profile' }).click();
  await expect(page.getByRole('heading', { name: 'Generate bounded candidate coverage' })).toBeFocused();

  await page.getByRole('button', { name: 'Generate fixed candidates' }).click();
  await expect(page.getByRole('heading', { name: 'Three candidates, two evidence origins' })).toBeVisible();
  await expect(page.locator('.discover-candidates article')).toHaveCount(3);
  await expect(page.getByText('Certificate Transparency · 2 certificate observations')).toBeVisible();
  await expect(page.getByText('Generated candidate · generated locally')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /Bulk.*Upcoming/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Review 3 candidates in Bulk' }).click();
  await expect(page.getByRole('heading', { name: 'Prioritise candidates without collapsing evidence' })).toBeFocused();
  await expect(page.locator('.candidate')).toHaveCount(3);
  await page.getByRole('button', { name: 'High priority · 1' }).click();
  await expect(page.locator('.candidate')).toHaveCount(1);

  await page.getByRole('button', { name: 'Inspect northstar-login.example' }).click();
  await expect(page.getByRole('heading', { name: 'northstar-login.example' })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'What needs analyst attention?' })).toBeVisible();
  await expect(page.locator('.demo-decision-brief .priority-cue')).toHaveText('Elevated review priority');
  await expect(page.locator('.demo-decision-brief')).not.toContainText('78/100');
  await expect(page.getByText('Three review cues')).toBeVisible();
  const familyControls = page.locator('.lookup-family button[aria-expanded]');
  await expect(familyControls).toHaveCount(5);
  expect(await familyControls.evaluateAll((buttons) => buttons.every((button) => button.getAttribute('aria-expanded') === 'false'))).toBe(true);
  const monitorHandoff = page.getByRole('button', { name: 'Open synthetic Case' });
  await expect(monitorHandoff).toBeVisible();
  await expect(monitorHandoff).toBeInViewport();
  await expect(page.locator('#demo-evidence-registry')).toHaveCount(0);
  await expect(page.locator('.dns-card')).toHaveCount(0);

  await page.getByRole('button', { name: 'Expand Registration evidence' }).click();
  await expect(page.locator('#demo-evidence-registry')).toBeVisible();
  const authorityTrace = page.getByRole('region', { name: 'Registration authority trace' });
  await expect(authorityTrace).toContainText('primary publication for domain existence');
  await expect(authorityTrace).toContainText('cannot decide domain existence');

  await page.getByRole('button', { name: 'Expand Web, DNS, and TLS evidence' }).click();
  await expect(page.locator('#demo-evidence-registry')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'DNS evidence' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'HTTP evidence' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'TLS and certificate evidence' })).toBeVisible();
  await expect(page.getByText('Also separated in the signed-in Console')).toBeVisible();

  await page.getByRole('button', { name: 'Expand Relationships and history evidence' }).click();
  await expect(page.locator('.dns-card')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Where this result came from' })).toBeVisible();
  await page.getByRole('link', { name: /^Registry/ }).click();
  await expect(page.locator('#demo-evidence-registry')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse Registration evidence' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#demo-family-web .family-details')).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand Relationships and history evidence' }).click();
  const relationshipTabs = page.getByRole('tablist', { name: 'Synthetic relationship and history view' });
  const evidenceTab = relationshipTabs.getByRole('tab', { name: /^Evidence/ });
  await evidenceTab.focus();
  await evidenceTab.press('End');
  await expect(relationshipTabs.getByRole('tab', { name: /^Timeline/ })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Observed lifecycle' })).toBeVisible();

  await page.getByRole('button', { name: 'Expand Source quality evidence' }).click();
  await expect(page.getByRole('heading', { name: 'Where this result came from' })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Overlapping collection timing for 4 source branches' })).toBeVisible();
  await expect(page.locator('.timing-summary')).toContainText('Network context');

  await monitorHandoff.click();
  await expect(page.getByRole('heading', { name: 'Document and revisit northstar-login.example' })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Document and revisit northstar-login.example' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Watchlist activity' })).toHaveCount(0);

  await page.getByRole('combobox', { name: /^Status/u }).selectOption('reviewing');
  await expect(page.getByRole('status')).toHaveText('Synthetic case updated.');
  await page.getByLabel('Analyst note').fill('Fixture reviewed for demonstration.');
  await page.getByRole('button', { name: 'Load later synthetic observation' }).click();
  const changeReview = page.locator('.change-review');
  await expect(changeReview.getByRole('heading', { name: 'Repeated evidence and material changes stay distinct' })).toBeVisible();
  await expect(changeReview).toContainText('2 retained observations');
  await expect(changeReview).toContainText('matched this retained state');
  await expect(changeReview).toContainText('Material change');
  await expect(page.locator('.retained-case')).toContainText('History entries2');

  const storage = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }));
  expect(storage.local).toEqual([]);
  expect(storage.session).toEqual(['whoisleuth:synthetic-demo:v1']);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export synthetic case report' }).click();
  const download = await downloadPromise;
  const body = await (await download.createReadStream()).toArray();
  const payload = JSON.parse(Buffer.concat(body).toString('utf-8'));
  expect(download.suggestedFilename()).toBe('whoisleuth-synthetic-demo-case.json');
  expect(payload).toMatchObject({ schema: 'whoisleuth.synthetic-demo-case', version: 5, synthetic: true, case: { domain: 'northstar-login.example', status: 'monitoring', note: 'Fixture reviewed for demonstration.' } });
  expect(payload.timeline).toHaveLength(2);
  expect(payload.evidence.registry.source).toBe('Registry RDAP fixture');
  expect(payload.evidence.securityTxt.state).toBe('present');
  expect(payload.evidence.credentialSurface.categories.password).toBe(1);
  expect(payload.evidence.structuredIdentity.entities[0].name).toBe('Northstar account service');
  expect(payload.evidence.observedNetwork.address).toBe('203.0.113.44');

  await page.reload();
  const restoredHeading = page.getByRole('heading', { name: 'Document and revisit northstar-login.example' });
  await expect(restoredHeading).toBeVisible();
  await expect(restoredHeading).not.toBeFocused();
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a focused investigation task' })).toBeFocused();
  expect(await page.evaluate(() => sessionStorage.getItem('whoisleuth:synthetic-demo:v1'))).toBeNull();
  expect(apiRequestPaths.length).toBeGreaterThan(0);
  expect(apiRequestPaths.every((path) => path === '/api/session')).toBe(true);
});

test('settles long-to-short stage transitions at one stable workspace anchor', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/demo');
  await progressToLookup(page);
  await page.getByRole('button', { name: 'Open synthetic Case' }).click();
  await expect(page.getByRole('heading', { name: 'Document and revisit northstar-login.example' })).toBeFocused();
  await expect(page.locator('#demo-workspace')).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => workspaceTop(page), { timeout: 2500 }).toBe(24);
  await expect(page.locator('#demo-workspace')).toHaveCSS('min-height', '0px');
  const settledTop = await workspaceTop(page);
  expect(await workspaceTop(page)).toBe(settledTop);

  await page.getByRole('button', { name: 'Load later synthetic observation' }).click();
  await page.getByRole('button', { name: 'Review Lookup evidence' }).click();
  await expect(page.getByRole('heading', { name: 'northstar-login.example' })).toBeFocused();
  await expect(page.locator('#demo-workspace')).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => workspaceTop(page), { timeout: 2500 }).toBe(24);
  await expect(page.locator('#demo-workspace')).toHaveCSS('min-height', '0px');
  const returnTop = await workspaceTop(page);
  expect(await workspaceTop(page)).toBe(returnTop);
});

test('retains the stage surface until scrolling completes or reaches its bounded fallback', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    Element.prototype.scrollIntoView = function noAutomaticScroll() {};
  });
  await page.goto('/demo');
  const workspace = page.locator('#demo-workspace');

  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await workspaceNeedsScroll(page)).toBe(true);
  await page.getByRole('button', { name: 'Begin with Brands' }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(workspace).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('heading', { name: 'Define the official identity' })).toBeFocused();
  expect(await workspace.evaluate((element) => Number.parseFloat(getComputedStyle(element).minHeight))).toBeGreaterThan(0);

  await page.evaluate(() => window.dispatchEvent(new Event('scrollend')));
  await expect(workspace).toHaveAttribute('aria-busy', 'false');
  await expect(workspace).toHaveCSS('min-height', '0px');

  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await workspaceNeedsScroll(page)).toBe(true);
  await page.getByRole('button', { name: 'Use synthetic profile' }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(workspace).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('heading', { name: 'Generate bounded candidate coverage' })).toBeFocused();
  expect(await workspace.evaluate((element) => Number.parseFloat(getComputedStyle(element).minHeight))).toBeGreaterThan(0);
  await expect(workspace).toHaveAttribute('aria-busy', 'false', { timeout: 2500 });
  await expect(workspace).toHaveCSS('min-height', '0px');
});

test('keeps the guided workflow usable at narrow mobile widths', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/demo');
  const rail = page.locator('.demo-steps');
  const stageSummary = page.locator('.demo-stage-summary');
  expect(await rail.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await rail.locator('button').evaluateAll((buttons) => buttons.every((button) => button.getBoundingClientRect().height >= 44))).toBe(true);
  await expect(stageSummary).toBeVisible();
  await expect(stageSummary).toContainText('Tool substep 1 of 6');
  await expect(stageSummary.locator('span')).toBeHidden();
  await expect(page.locator('.hero-full-title')).toBeVisible();
  await expect(page.locator('.hero-compact-title')).toHaveCount(1);
  await expect(page.locator('.hero-compact-title')).toBeHidden();
  await expect(page.locator('.demo-panel')).toHaveCSS('min-height', '0px');
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Begin with Brands' }).click();
  await expect(page.locator('.hero-full-title')).toHaveCount(1);
  await expect(page.locator('.hero-full-title')).toBeHidden();
  await expect(page.locator('.hero-compact-title')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use synthetic profile' })).toBeInViewport();
  await page.getByRole('button', { name: 'Use synthetic profile' }).click();
  await page.getByRole('button', { name: 'Generate fixed candidates' }).click();
  await expect(page.locator('.discover-candidates article')).toHaveCount(3);
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Review 3 candidates in Bulk' }).click();
  const desktopMap = page.locator('.map-frame');
  await expect(desktopMap).toHaveCount(1);
  await expect(desktopMap).toBeHidden();
  await expect(page.locator('.map-mobile')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Inspect northstar-login.example' }).click();
  await expect(page.getByRole('heading', { name: 'northstar-login.example' })).toBeFocused();
  const activeStageCenterOffset = () => rail.evaluate((element) => {
    const active = element.querySelector('[aria-current="step"]');
    if (!active) return Number.POSITIVE_INFINITY;
    const railRect = element.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    return Math.abs((activeRect.left + activeRect.right) / 2 - (railRect.left + railRect.right) / 2);
  });
  await expect.poll(activeStageCenterOffset).toBeLessThanOrEqual(3);
  await expect(page.locator('.lookup-family button[aria-expanded="true"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open synthetic Case' })).toBeInViewport();
  await expectNoHorizontalOverflow(page);

  await rail.evaluate((element) => element.scrollTo({ left: 0, behavior: 'auto' }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'northstar-login.example' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'northstar-login.example' })).not.toBeFocused();
  await expect(page.locator('.hero-full-title')).toHaveCount(1);
  await expect(page.locator('.hero-full-title')).toBeHidden();
  await expect(page.locator('.hero-compact-title')).toBeVisible();
  await expect.poll(activeStageCenterOffset).toBeLessThanOrEqual(3);

  await page.setViewportSize({ width: 360, height: 760 });
  await page.getByRole('button', { name: 'Expand Registration evidence' }).click();
  await expect(page.getByRole('region', { name: 'Exact source comparisons' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Expand Web, DNS, and TLS evidence' }).click();
  await expect(page.getByRole('heading', { name: 'TLS and certificate evidence' })).toBeVisible();
  await page.setViewportSize({ width: 393, height: 852 });
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Open synthetic Case' }).click();
  await page.getByRole('button', { name: 'Load later synthetic observation' }).click();
  await expect(page.getByRole('heading', { name: 'Repeated evidence and material changes stay distinct' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Watchlist activity' })).toHaveCount(0);
  const mobileChangeArrows = page.locator('.change-list dd b');
  await expect(mobileChangeArrows.first()).toBeVisible();
  expect(await mobileChangeArrows.evaluateAll((arrows) => arrows.every((arrow) => {
    const row = arrow.closest('dd');
    if (!row) return false;
    const arrowBounds = arrow.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    return getComputedStyle(arrow).transform === 'none'
      && getComputedStyle(arrow, '::after').content.includes('↓')
      && arrowBounds.left >= rowBounds.left
      && arrowBounds.right <= rowBounds.right;
  }))).toBe(true);
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Reset demo' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a focused investigation task' })).toBeFocused();
  await expect(page.locator('.hero-full-title')).toBeVisible();
  await expect(page.locator('.hero-compact-title')).toHaveCount(1);
  await expect(page.locator('.hero-compact-title')).toBeHidden();
});

test('recovers safely from malformed and future tab state', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: 'Choose a focused investigation task' })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('whoisleuth:synthetic-demo:v1', '{malformed'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Choose a focused investigation task' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Stored demo progress was invalid or unsupported and has been reset.');
  expect(await page.evaluate(() => sessionStorage.getItem('whoisleuth:synthetic-demo:v1'))).toBeNull();
  await page.evaluate(() => sessionStorage.setItem('whoisleuth:synthetic-demo:v1', JSON.stringify({ version: 99, profileReady: true })));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Choose a focused investigation task' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Stored demo progress was invalid or unsupported and has been reset.');
  expect(await page.evaluate(() => sessionStorage.getItem('whoisleuth:synthetic-demo:v1'))).toBeNull();
});

test('keeps progressing in memory when tab storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (key === 'whoisleuth:synthetic-demo:v1') throw new DOMException('Storage disabled', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Begin with Brands' }).click();
  await page.getByRole('button', { name: 'Use synthetic profile' }).click();
  await page.getByRole('button', { name: 'Generate fixed candidates' }).click();
  await expect(page.getByRole('heading', { name: 'Three candidates, two evidence origins' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Loaded three synthetic candidates.');
  await expect(page.getByRole('button', { name: /Bulk.*Upcoming/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Review 3 candidates in Bulk' }).click();
  await expect(page.getByRole('heading', { name: 'Prioritise candidates without collapsing evidence' })).toBeFocused();
  await expect(page.getByRole('status')).toContainText('Progress updated in memory');
});

test('uses immediate focus-safe transitions when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/demo');
  const start = page.getByRole('button', { name: 'Begin with Brands' });
  await start.focus();
  await start.press('Enter');
  await expect(page.getByRole('heading', { name: 'Define the official identity' })).toBeFocused();
  await expect(page.locator('#demo-workspace')).toHaveCSS('min-height', '0px');
  const firstTop = await workspaceTop(page);
  expect(await workspaceTop(page)).toBe(firstTop);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
});
