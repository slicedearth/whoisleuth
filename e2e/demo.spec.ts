import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';

test.use({ storageState: { cookies: [], origins: [] } });

async function progressToLookup(page: Page) {
  await page.getByRole('button', { name: 'Begin with Brands' }).click();
  await expect(page.getByRole('heading', { name: 'Define the protected identity' })).toBeFocused();
  await page.getByRole('button', { name: 'Use synthetic profile' }).click();
  await expect(page.getByRole('heading', { name: 'Generate bounded candidate coverage' })).toBeFocused();
  await page.getByRole('button', { name: 'Generate fixed candidates' }).click();
  await expect(page.locator('.discover-candidates article')).toHaveCount(3);
  await page.getByRole('button', { name: 'Review 3 candidates in Bulk' }).click();
  await expect(page.getByRole('heading', { name: 'Prioritise candidates without collapsing evidence' })).toBeFocused();
  await page.getByRole('button', { name: 'Inspect northstar-login.example' }).click();
  await expect(page.getByRole('heading', { name: 'northstar-login.example' })).toBeFocused();
}

async function workspaceTop(page: Page) {
  return page.locator('#demo-workspace').evaluate((element) => Math.round(element.getBoundingClientRect().top));
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
  await expect(page.getByText('Synthetic fixtures · No live findings')).toBeVisible();
  await expect(page.locator('.demo-stage-summary')).toContainText('Stage 1 of 6');
  await expect(page.getByRole('button', { name: /Dashboard.*Current/ })).toHaveAttribute('aria-current', 'step');
  await expect(page.getByRole('button', { name: /Monitor.*Upcoming/ })).toBeDisabled();
  const stageGuidance = page.getByLabel('What this stage teaches');
  await expect(stageGuidance).toContainText('Task');
  await expect(stageGuidance).toContainText('Decision');
  await expect(stageGuidance).toContainText('Boundary');

  await page.getByRole('button', { name: 'Begin with Brands' }).click();
  await expect(page.getByRole('heading', { name: 'Define the protected identity' })).toBeFocused();
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
  await expect(page.getByText('Priority 78/100')).toBeVisible();
  await expect(page.getByText('Three review cues')).toBeVisible();
  const familyControls = page.locator('.lookup-family button[aria-expanded]');
  await expect(familyControls).toHaveCount(5);
  expect(await familyControls.evaluateAll((buttons) => buttons.every((button) => button.getAttribute('aria-expanded') === 'false'))).toBe(true);
  const monitorHandoff = page.getByRole('button', { name: 'Open synthetic case in Monitor' });
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
  await expect(page.getByRole('heading', { name: 'DNS intelligence' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'HTTP intelligence' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'TLS and certificate intelligence' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Case evidence, not a live watchlist' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Watchlist activity' })).toHaveCount(0);

  await page.getByLabel('Status').selectOption('reviewing');
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
  await page.getByRole('button', { name: 'Open synthetic case in Monitor' }).click();
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
  await page.addInitScript(() => {
    Element.prototype.scrollIntoView = function noAutomaticScroll() {};
  });
  await page.goto('/demo');
  const workspace = page.locator('#demo-workspace');

  await page.getByRole('button', { name: 'Begin with Brands' }).click();
  await expect(page.getByRole('heading', { name: 'Define the protected identity' })).toBeFocused();
  await expect(workspace).toHaveAttribute('aria-busy', 'true');
  expect(await workspace.evaluate((element) => Number.parseFloat(getComputedStyle(element).minHeight))).toBeGreaterThan(0);

  await page.evaluate(() => window.dispatchEvent(new Event('scrollend')));
  await expect(workspace).toHaveAttribute('aria-busy', 'false');
  await expect(workspace).toHaveCSS('min-height', '0px');

  await page.getByRole('button', { name: 'Use synthetic profile' }).click();
  await expect(page.getByRole('heading', { name: 'Generate bounded candidate coverage' })).toBeFocused();
  await expect(workspace).toHaveAttribute('aria-busy', 'true');
  expect(await workspace.evaluate((element) => Number.parseFloat(getComputedStyle(element).minHeight))).toBeGreaterThan(0);
  await expect(workspace).toHaveAttribute('aria-busy', 'false', { timeout: 2500 });
  await expect(workspace).toHaveCSS('min-height', '0px');
});

test('keeps the guided workflow usable at narrow mobile widths', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/demo');
  const rail = page.locator('.demo-steps');
  const mobileGuidance = page.locator('.mobile-stage-guidance');
  expect(await rail.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await rail.locator('button').evaluateAll((buttons) => buttons.every((button) => button.getBoundingClientRect().height >= 44))).toBe(true);
  await expect(page.locator('.stage-guidance')).toBeHidden();
  await expect(mobileGuidance).toBeVisible();
  await expect(mobileGuidance).not.toHaveAttribute('open', '');
  await expect(page.locator('.hero-full-title')).toBeVisible();
  await expect(page.locator('.hero-compact-title')).toBeHidden();
  expect(await mobileGuidance.evaluate((element) => Math.round(element.getBoundingClientRect().height))).toBeLessThanOrEqual(56);
  const guidanceSummary = mobileGuidance.locator('summary');
  await guidanceSummary.focus();
  await guidanceSummary.press('Enter');
  await expect(mobileGuidance).toHaveAttribute('open', '');
  await expect(mobileGuidance.locator(':scope > div').first()).toBeVisible();
  expect(await mobileGuidance.evaluate((element) => {
    const summaryLabels = element.querySelectorAll<HTMLElement>('.mobile-stage-guidance-headings > *');
    const firstGuidance = element.querySelector<HTMLElement>(':scope > div');
    const guidanceFields = firstGuidance?.querySelectorAll<HTMLElement>(':scope > *');
    if (summaryLabels.length !== 2 || guidanceFields?.length !== 2) return false;
    return Math.abs(summaryLabels[0]!.getBoundingClientRect().left - guidanceFields[0]!.getBoundingClientRect().left) <= 1
      && Math.abs(summaryLabels[1]!.getBoundingClientRect().left - guidanceFields[1]!.getBoundingClientRect().left) <= 1;
  })).toBe(true);
  await expect(guidanceSummary).toBeFocused();
  await guidanceSummary.press('Space');
  await expect(mobileGuidance).not.toHaveAttribute('open', '');
  await expect(guidanceSummary).toBeFocused();
  await expect(page.locator('.demo-panel')).toHaveCSS('min-height', '0px');
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Begin with Brands' }).click();
  await expect(page.locator('.hero-full-title')).toBeHidden();
  await expect(page.locator('.hero-compact-title')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use synthetic profile' })).toBeInViewport();
  await page.getByRole('button', { name: 'Use synthetic profile' }).click();
  await page.getByRole('button', { name: 'Generate fixed candidates' }).click();
  await expect(page.locator('.discover-candidates article')).toHaveCount(3);
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Review 3 candidates in Bulk' }).click();
  await expect(page.locator('.map-frame')).toBeHidden();
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
  await expect(page.getByRole('button', { name: 'Open synthetic case in Monitor' })).toBeInViewport();
  await expectNoHorizontalOverflow(page);

  await rail.evaluate((element) => element.scrollTo({ left: 0, behavior: 'auto' }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'northstar-login.example' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'northstar-login.example' })).not.toBeFocused();
  await expect(page.locator('.hero-full-title')).toBeHidden();
  await expect(page.locator('.hero-compact-title')).toBeVisible();
  await expect.poll(activeStageCenterOffset).toBeLessThanOrEqual(3);

  await page.setViewportSize({ width: 360, height: 760 });
  await page.getByRole('button', { name: 'Expand Registration evidence' }).click();
  await expect(page.getByRole('region', { name: 'Exact source comparisons' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Expand Web, DNS, and TLS evidence' }).click();
  await expect(page.getByRole('heading', { name: 'TLS and certificate intelligence' })).toBeVisible();
  await page.setViewportSize({ width: 393, height: 852 });
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Open synthetic case in Monitor' }).click();
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
  await expect(page.getByRole('status')).toHaveText('Loaded three fixed synthetic candidates without making an investigation request.');
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
  await expect(page.getByRole('heading', { name: 'Define the protected identity' })).toBeFocused();
  await expect(page.locator('#demo-workspace')).toHaveCSS('min-height', '0px');
  const firstTop = await workspaceTop(page);
  expect(await workspaceTop(page)).toBe(firstTop);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
});
