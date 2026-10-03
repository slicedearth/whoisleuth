import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, useTheme } from './helpers';
import { PUBLIC_RESOURCES } from '../frontend/src/lib/public-resources';
import { PUBLIC_REFERENCE_DESTINATIONS } from '../frontend/src/lib/public-reference-navigation';
import { glossaryTerms, guideFaqs, publicGuideGoals, resultStates, toolGuides, referenceGuides } from '../frontend/src/lib/public-guide';

test('missing-page artefact provides usable navigation without a client runtime', async ({ browser, request }, testInfo) => {
  const missing = await request.get('/missing-page?private=not-for-display');
  expect(missing.status()).toBe(404);
  const body = await missing.text();
  expect(body).toContain('Page not found');
  expect(body).not.toContain('not-for-display');
  expect(body).not.toContain('Cannot GET');
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    for (const theme of ['light', 'dark'] as const) {
      await page.goto('/404');
      // Exercise both CSS palettes while application scripts remain disabled.
      await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
      for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 1024, height: 768 }, { width: 1280, height: 720 }]) {
        await page.setViewportSize(viewport);
        await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Continue browsing' }).getByRole('link')).toHaveCount(3);
        await expectNoHorizontalOverflow(page);
        if (captureVisualEvidenceEnabled()) await page.screenshot({ path: testInfo.outputPath(`not-found-${theme}-${viewport.width}.png`), fullPage: true });
      }
    }
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'WHOISleuth', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Homepage', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/$/u);
  } finally { await context.close(); }
});

for (const theme of ['light', 'dark'] as const) {
  test(`every reference introduction remains readable on mobile and tablet in ${theme}`, async ({ page }, testInfo) => {
    test.slow();
    const measurements: unknown[] = [];
    await useTheme(page, theme);
    for (const destination of PUBLIC_REFERENCE_DESTINATIONS) {
      await page.goto(destination.href);
      for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 768, height: 1024 }]) {
        await page.setViewportSize(viewport);
        await page.evaluate(() => scrollTo(0, 0));
        await expect(page.locator('main h1')).toHaveCount(1);
        await expect(page.locator('main h1')).toBeInViewport({ ratio: 1 });
        await expect(page.getByRole('navigation', { name: 'Breadcrumb', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Browse documentation', exact: true })).toBeVisible();
        await expectNoHorizontalOverflow(page);
        const bodyTop = await page.locator('.reference-body').evaluate(element => element.getBoundingClientRect().top);
        measurements.push({ href: destination.href, theme, ...viewport, bodyTop });
        expect(bodyTop, `${destination.href} places all practical content below the first viewport`).toBeLessThan(viewport.height);
        if (viewport.width === 320) if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`${destination.href.replaceAll('/', '-')}-${theme}-320.png`) }); }
      }
    }
    await testInfo.attach('reference-introductions.json', { body: JSON.stringify(measurements), contentType: 'application/json' });
  });
}

test('delivered third-party notices include browser framework code independently of dependency classification', async ({ request }) => {
  const response = await request.get('/third-party-notices.txt');
  expect(response.ok()).toBe(true);
  const notice = await response.text();
  expect(notice).toMatch(/^svelte@\d+\.\d+\.\d+\nRelationship: bundled browser dependency/mu);
  expect(notice).toMatch(/^@sveltejs\/kit@\d+\.\d+\.\d+\nRelationship: bundled browser dependency/mu);
  expect(notice).not.toMatch(/^(?:typescript|eslint|@playwright\/test)@/mu);
  expect(notice).not.toContain('This is the production-package base.');
});

test('reference section navigation is available before client hydration', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto('/cli');
    const sections = page.getByRole('navigation', { name: 'CLI sections' });
    await expect(sections).toBeVisible();
    const commands = sections.getByRole('link', { name: 'Command reference' });
    await expect(commands).toHaveAttribute('href', '#commands');
    await expect(sections.getByRole('link', { name: 'Capture companion' })).toHaveAttribute('href', '#capture-companion');
    const targets = await sections.getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(new Set(targets).size).toBe(targets.length);
    for (const target of targets) {
      expect(target).toMatch(/^#[a-z][a-z0-9-]*$/u);
      await expect(page.locator(target!)).toHaveCount(1);
    }
    await commands.click();
    await expect(page).toHaveURL(/\/cli#commands$/u);
  } finally {
    await context.close();
  }
});

test('homepage presents plain-language goals, restrained branding, and synthetic product previews', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: /Understand a domain.+Before you act/u })).toBeVisible();
  await expect(page.locator('.hero-kicker')).toHaveText('Domain intelligence console');
  await expect(page.locator('.public-header .mark')).toHaveCount(1);
  await expect(page.locator('.hero .mark')).toHaveCount(0);
  await expect(page.locator('.goal-paths article')).toHaveCount(publicGuideGoals.length);
  await expect(page.getByRole('heading', { name: 'Inspect one domain' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Inspect one domain guide' })).toHaveCSS('cursor', 'pointer');
  await expect(page.getByRole('link', { name: 'Find brand lookalikes guide' })).toHaveAttribute('href', '/resources#find-brand-lookalikes');
  await expect(page.getByRole('link', { name: 'Track important findings guide' })).toHaveAttribute('href', '/resources#track-important-findings');
  await expect(page.getByRole('link', { name: /Browse the topic library/u })).toHaveCSS('cursor', 'pointer');
  await expect(page.getByRole('heading', { name: 'Find brand lookalikes' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Track important findings' })).toBeVisible();
  await expect(page.locator('.product-preview .preview-panel')).toHaveCount(3);
  const candidateButtons = page.locator('.discover-panel .candidate-row');
  await expect(candidateButtons).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Show northstar-login.example in the preview' })).toHaveAttribute('aria-pressed', 'true');
  const previewTabs = page.getByRole('tablist', { name: 'Lookup result layout preview' });
  await expect(previewTabs.getByRole('tab', { name: 'At a glance' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'At a glance' })).toBeVisible();
  await previewTabs.getByRole('tab', { name: 'Evidence' }).click();
  await expect(previewTabs.getByRole('tab', { name: 'Evidence' })).toHaveAttribute('aria-selected', 'true');
  const topology = page.getByRole('region', { name: 'Where this result comes from' });
  await expect(topology).toBeVisible();
  const topologyGraphic = topology.getByRole('img', { name: 'Separately attributed evidence flow' });
  await expect(topologyGraphic).toBeVisible();
  await expect(page.locator('.mobile-source-summary > li')).toHaveCount(5);
  await page.getByRole('button', { name: 'Show northstarr.example in the preview' }).click();
  await expect(page.getByRole('button', { name: 'Show northstarr.example in the preview' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.lookup-panel > header small')).toHaveText('northstarr.example');
  await expect(topology).toContainText('unavailable');
  await expect(topology).toContainText('Repeat certificate');
  await expect(page.locator('.monitor-panel')).toContainText('Repeat certificate collection');
  await previewTabs.getByRole('tab', { name: 'At a glance' }).click();
  const previewOverview = page.getByRole('tabpanel', { name: 'At a glance' });
  await expect(previewOverview.getByText('2/4 sources complete', { exact: true })).toBeVisible();
  const riskTriage = previewOverview.getByText('Risk triage 34/100', { exact: true });
  await expect(riskTriage).toBeVisible();
  await expect(previewOverview.getByText('Character edit', { exact: true })).toBeVisible();
  await expect(previewOverview.getByText('Parked page pattern', { exact: true })).toBeVisible();
  await expect(topology).toHaveCount(0);
  const overviewTab = previewTabs.getByRole('tab', { name: 'At a glance' });
  await overviewTab.focus();
  await overviewTab.press('End');
  await expect(previewTabs.getByRole('tab', { name: 'Timeline' })).toBeFocused();
  await expect(previewTabs.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'true');
  const lookupTimeline = page.getByRole('list', { name: 'Synthetic lookup timeline' });
  await expect(lookupTimeline).toBeVisible();
  await expect(lookupTimeline.getByText('Material change', { exact: true })).toBeVisible();
  await expect(lookupTimeline.getByText(/changed fields · Website activity/)).toBeVisible();
  await expect(page.locator('.monitor-panel ol')).toHaveCount(0);
  await previewTabs.getByRole('tab', { name: 'Timeline' }).press('ArrowLeft');
  await expect(previewTabs.getByRole('tab', { name: 'Evidence' })).toBeFocused();
  await expect(previewTabs.getByRole('tab', { name: 'Evidence' })).toHaveAttribute('aria-selected', 'true');
  await expect(topology).toBeVisible();
  await expect(page.getByText('Fixed fictional data from the public demo. No live target is contacted.')).toBeVisible();
  await expect(page.locator('.hero-actions').getByRole('link', { name: 'Open console' })).toHaveAttribute('href', '/dashboard');
  await expect(page.getByRole('link', { name: 'Sign in to investigate' })).toHaveCount(0);
  await expect(page.locator('.learn article')).toHaveCount(4);
  await expect(page.getByRole('link', { name: 'Browse the topic library' })).toHaveAttribute('href', '/resources');

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileDomainPicker = page.getByLabel('Example domain');
  await expect(mobileDomainPicker).toBeVisible();
  await mobileDomainPicker.selectOption('alternate-tld');
  await expect(page.locator('.lookup-panel > header small')).toHaveText('northstar.invalid');
  await previewTabs.getByRole('tab', { name: 'Evidence' }).click();
  const sourceSummary = page.locator('.mobile-source-summary');
  await expect(sourceSummary).toBeVisible();
  await expect(sourceSummary.locator('.state-inconclusive', { hasText: 'Registry' })).toBeVisible();
  await expect(sourceSummary.locator('.state-unavailable')).toHaveCount(2);
  const sourceStateColors = await sourceSummary.evaluate((summary) => {
    const warning = summary.querySelector('.state-warning strong');
    const success = summary.querySelector('.state-success strong');
    const unavailable = summary.querySelector('.state-unavailable strong');
    const reference = document.createElement('span');
    reference.style.color = 'var(--amber)';
    const mutedReference = document.createElement('span');
    mutedReference.style.color = 'var(--muted)';
    document.body.append(reference);
    document.body.append(mutedReference);
    const colors = {
      warning: warning ? getComputedStyle(warning).color : '',
      success: success ? getComputedStyle(success).color : '',
      unavailable: unavailable ? getComputedStyle(unavailable).color : '',
      amber: getComputedStyle(reference).color,
      muted: getComputedStyle(mutedReference).color,
    };
    reference.remove();
    mutedReference.remove();
    return colors;
  });
  expect(sourceStateColors.warning).toBe(sourceStateColors.amber);
  expect(sourceStateColors.warning).not.toBe(sourceStateColors.success);
  expect(sourceStateColors.unavailable).toBe(sourceStateColors.muted);
  expect(sourceStateColors.unavailable).not.toBe(sourceStateColors.warning);
  await expectNoHorizontalOverflow(page);
});

test('public resources offer task-specific source boundaries on desktop and mobile', async ({ page }, testInfo) => {
  await page.goto('/resources');

  await expect(page.getByRole('heading', { name: 'Guides for common investigation tasks' })).toBeVisible();
  await expect(page.locator('.page-sections')).toBeVisible();
  await expect(page.locator('.resource-grid article')).toHaveCount(PUBLIC_RESOURCES.length);
  await page.locator('.resource-grid').getByRole('link', { name: 'RDAP versus WHOIS', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'RDAP versus WHOIS', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Public navigation' }).getByRole('link', { name: 'Resources' })).toHaveAttribute('aria-current', 'location');
  await expect(page.getByRole('table', { name: 'Evidence sources and limitations' })).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(4);
  await expect(page.getByRole('heading', { name: 'Before you decide' })).toBeVisible();
  const references = page.locator('#primary-references');
  await expect(references.getByRole('heading', { name: 'Further reading' })).toBeVisible();
  await expect(references.getByRole('link')).toHaveCount(3);
  await expect(references.getByRole('link', { name: /IETF RFC 3912: WHOIS protocol/u })).toHaveAttribute('href', 'https://www.rfc-editor.org/rfc/rfc3912');
  await expect(page.getByRole('link', { name: 'Inspect synthetic registration evidence', exact: true })).toHaveAttribute('href', '/demo');
  await expect(page.getByRole('link', { name: 'Open docs/registry-data-contract.md' })).toHaveAttribute(
    'href',
    'https://github.com/slicedearth/whoisleuth/blob/main/docs/registry-data-contract.md',
  );
  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(breadcrumb.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
  await expect(breadcrumb.getByRole('link', { name: 'Resources' })).toHaveAttribute('href', '/resources');
  await expect(breadcrumb.locator(':scope > span').last()).toHaveText('RDAP versus WHOIS');
  await expect(breadcrumb).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 320, height: 700 });
  await page.reload();
  const evidenceTable = page.getByRole('table', { name: 'Evidence sources and limitations' });
  await expect(evidenceTable).toBeVisible();
  await expect(evidenceTable.getByRole('columnheader')).toHaveText(['Source', 'Useful for', 'Important limit']);
  await expect(evidenceTable.getByRole('row').nth(1).locator('.mobile-column-label')).toHaveText(['Source', 'Useful for', 'Important limit']);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    await expectNoHorizontalOverflow(page);
    await evidenceTable.scrollIntoViewIfNeeded();
    if (captureVisualEvidenceEnabled()) await page.screenshot({ path: testInfo.outputPath(`resource-table-${theme}.png`) });
  }
  await page.getByRole('button', { name: 'Browse documentation', exact: true }).click();
  const articleSections = page.getByRole('dialog');
  await expect(articleSections.locator('.page-sections').getByRole('link')).toHaveCount(5);
  await articleSections.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(breadcrumb).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto('/resources/reporting-and-takedown-guidance');
  await expect(page.getByRole('heading', { name: 'Prepare an abuse or infringement report' })).toBeVisible();
  const reportingReferences = page.locator('#primary-references');
  await expect(reportingReferences.getByRole('heading', { name: 'Official reporting guidance' })).toBeVisible();
  await expect(reportingReferences).toContainText('verify the current reporting route, eligibility and disclosure terms');
  await expect(reportingReferences.getByRole('link')).toHaveCount(11);
  await expect(reportingReferences.getByRole('link', { name: /Google Play: Review app or developer reporting/u })).toHaveAttribute('href', 'https://support.google.com/googleplay/answer/2853570?hl=en');
  await expect(reportingReferences.getByRole('link', { name: /Shopify: Choose a merchant abuse route/u })).toHaveAttribute('href', 'https://www.shopify.com/legal/tools/report-an-issue/report-a-merchant');
  await expect(reportingReferences.getByRole('link', { name: /TikTok report form/u })).toHaveAttribute('href', 'https://www.tiktok.com/legal/report/feedback');
  await expect(reportingReferences.getByRole('link', { name: /Telegram reporting guidance/u })).toHaveAttribute('href', /telegram\.org\/faq/iu);
  await expectNoHorizontalOverflow(page);
});

test('public guide explains tasks, result states, glossary terms, and common questions', async ({ page }) => {
  await page.goto('/resources');
  await expect(page.getByRole('region', { name: 'Source health is part of the evidence' })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Guides for common investigation tasks' })).toBeVisible();
  await expect(page.locator('.page-sections')).toBeVisible();
  const taskPaths = page.getByRole('region', { name: 'Common WHOISleuth tasks' });
  await expect(taskPaths).toBeVisible();
  await expect(taskPaths.getByRole('heading', { name: 'Inspect one domain' })).toBeVisible();
  const lookupStep = taskPaths
    .getByRole('list', { name: 'Inspect one domain steps' })
    .getByRole('link', { name: 'Lookup', exact: true });
  await expect(lookupStep).toHaveAttribute('href', '#tool-lookup');
  await lookupStep.click();
  await expect(page.locator('#tool-lookup')).toBeInViewport();
  const trackingPath = taskPaths.getByRole('list', { name: 'Track important findings steps' });
  const trackingSteps = trackingPath.getByRole('link');
  await expect(trackingSteps).toHaveCount(3);
  await expect(trackingSteps.nth(0)).toHaveAttribute('href', '#tool-monitor-input');
  await expect(trackingSteps.nth(1)).toHaveAttribute('href', '#tool-monitor-result');
  await expect(trackingSteps.nth(2)).toHaveAttribute('href', '#tool-monitor-next');
  await trackingSteps.nth(2).click();
  await expect(page.locator('#tool-monitor-next')).toBeInViewport();
  await expect(page.locator('.goal-paths article')).toHaveCount(publicGuideGoals.length);
  await page.getByRole('button', { name: 'Open offline practice' }).click();
  const practice = page.getByRole('region', { name: 'Try a guided analyst decision.' });
  await expect(practice).toBeVisible();
  await expect(practice.getByLabel('Practice scenario')).toHaveValue('brand-boundary-review');
  await practice.getByLabel('Review the official domain and trusted allowlists before generating candidates.').check();
  await expect(practice.getByText('Defensible choice')).toBeVisible();
  await expect(practice.getByRole('button', { name: 'Next decision' })).toBeEnabled();
  const toolCards = page.locator('.tool-guide details');
  const referenceCards = page.locator('.reference-guide article');
  await expect(toolCards).toHaveCount(toolGuides.length);
  const cases = page.locator('#tool-cases');
  await cases.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(cases).toHaveAttribute('open', '');
  await expect(cases.locator('dl')).toContainText('Each Case holds evidence');
  await expect(referenceCards).toHaveCount(referenceGuides.length);
  await expect(page.locator('#tool-monitor')).toHaveAttribute('open', '');
  await expect(page.locator('#tool-monitor-next')).toContainText('Open the relevant Case');
  const resultLayout = page.getByRole('article', { name: 'Find your way around a Lookup result' });
  await expect(resultLayout).toBeVisible();
  await expect(resultLayout.getByText('Relationships and history', { exact: true })).toBeVisible();
  await expect(resultLayout).toContainText('Use Jump to section to move around a long result.');
  await expect(page.locator('.state-grid article')).toHaveCount(resultStates.length);
  await expect(page.locator('.glossary-grid > div')).toHaveCount(glossaryTerms.length);
  await page.locator('#glossary > summary').click();
  await expect(page.locator('.glossary-grid').getByText('DANE', { exact: true })).toBeVisible();
  await expect(page.locator('.glossary-grid').getByText('MTA-STS', { exact: true })).toBeVisible();
  await expect(page.locator('.glossary-grid').getByText('TLSA', { exact: true })).toBeVisible();
  await expect(page.locator('.glossary-grid').getByText('Browser-library advisory match', { exact: true })).toBeVisible();
  await expect(page.locator('.glossary-grid').getByText('HTTPS service binding', { exact: true })).toBeVisible();
  await expect(page.locator('.glossary-grid').getByText('PTR', { exact: true })).toBeVisible();
  await expect(page.locator('.glossary-grid').getByText('SOA', { exact: true })).toBeVisible();
  await expect(page.locator('.glossary-grid').getByText('Website profile snapshot', { exact: true })).toBeVisible();
  await expect(page.locator('.faq-list details')).toHaveCount(guideFaqs.length);

  const question = page.getByText('Does WHOISleuth decide whether a domain is malicious?', { exact: true });
  await question.click();
  await expect(page.getByText('No. It organises observed evidence and provides an explainable Risk score for prioritisation.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Try the synthetic demo' })).toHaveAttribute('href', '/demo');
  await expect(page.locator('.reference-actions').getByRole('link', { name: 'Open console' })).toHaveAttribute('href', '/dashboard');
  await expect(page.getByRole('link', { name: 'Sign in to investigate' })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 320, height: 700 });
  await expect(cases.locator('dl')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('privacy policy offers concise section navigation at desktop and mobile widths', async ({ page }) => {
  await page.goto('/privacy');

  const sectionNavigation = page.getByRole('navigation', { name: 'Privacy policy sections' });
  await expect(sectionNavigation).toBeVisible();
  const headingIds = await page.locator('.policy h2[id]').evaluateAll((headings) => headings.map((heading) => heading.id));
  expect(headingIds.length).toBeGreaterThan(0);
  expect(new Set(headingIds).size).toBe(headingIds.length);
  await expect(sectionNavigation.getByRole('link')).toHaveCount(headingIds.length);
  const indexedIds = await sectionNavigation.getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('href')?.slice(1)));
  expect(indexedIds).toEqual(headingIds);
  const security = sectionNavigation.getByRole('link', { name: 'Security' });
  await expect(security).toHaveAttribute('href', '#privacy-security');
  await security.click();
  await expect(page.locator('#privacy-security')).toBeInViewport();

  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/privacy');
  await expect(sectionNavigation).toBeVisible();
  expect(await sectionNavigation.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expectNoHorizontalOverflow(page);
});

test('homepage and guide remain usable on a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });

  await page.goto('/');
  await expect(page.locator('.hero-kicker')).toBeVisible();
  await expect(page.locator('.hero .mark')).toHaveCount(0);
  await expect(page.locator('.product-preview .preview-panel')).toHaveCount(3);
  await expectNoHorizontalOverflow(page);

  await page.goto('/resources');
  await page.getByRole('button', { name: 'Browse documentation', exact: true }).click();
  const resourceSections = page.getByRole('dialog');
  await expect(resourceSections).toBeVisible();
  await expect(resourceSections.getByRole('link', { name: 'Topics' })).toHaveAttribute('href', '#topics');
  await expect(resourceSections.getByRole('link', { name: 'Tools' })).toHaveAttribute('href', '#tools');
  await expect(resourceSections.getByRole('link', { name: 'Practice' })).toHaveAttribute('href', '#practice');
  await expect(resourceSections.getByRole('link', { name: 'Reference' })).toHaveAttribute('href', '#reference');
  await resourceSections.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Common WHOISleuth tasks' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Domain investigation terms' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Find your way around a Lookup result' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('public footer links remain reachable without overlap on mobile', async ({ page }) => {
  for (const width of [320, 390, 412]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    const footer = page.locator('footer.site-footer');
    const links = footer.locator('.footer-links a');
    await expect(footer).toBeVisible();
    for (const [label, href] of [['Privacy', '/privacy'], ['Terms', '/terms'], ['Request policy', '/request-policy'], ['Contact', '/contact']] as const) {
      await expect(footer.getByRole('link', { name: label, exact: true })).toHaveAttribute('href', href);
    }
    await expect(links).toHaveCount(5);
    const layout = await links.evaluateAll((elements) => elements.map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height, href: element.getAttribute('href') };
    }));
    expect(new Set(layout.map(link => link.href)).size).toBe(5);
    expect(layout.every(link => link.height >= 44 && link.x >= 0 && link.x + link.width <= width)).toBe(true);
    for (const [index, link] of layout.entries()) {
      for (const other of layout.slice(index + 1)) {
        const overlaps = Math.min(link.x + link.width, other.x + other.width) > Math.max(link.x, other.x)
          && Math.min(link.y + link.height, other.y + other.height) > Math.max(link.y, other.y);
        expect(overlaps).toBe(false);
      }
    }
    await expectNoHorizontalOverflow(page);
  }
});

test('authenticated console groups its public reference without duplicating Ctrl+K', async ({ page }) => {
  await page.goto('/lookup');
  await expect(page.getByText('Domain intelligence console', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Console' })).toBeVisible();
  const reference = page.getByRole('navigation', { name: 'Reference' });
  await expect(reference.getByRole('link')).toHaveCount(2);
  await expect(reference.getByRole('link', { name: /Registry support/ })).toHaveAttribute('href', '/registry-support');
  await expect(reference.getByRole('link', { name: /Registry support/ })).not.toHaveAttribute('target', '_blank');

  await expect(page.getByRole('navigation', { name: 'Public site' })).toHaveCount(0);
  const resources = reference.getByRole('link', { name: /Resources/ });
  await expect(resources).toHaveAttribute('href', '/resources');
  await expect(resources).toHaveAttribute('target', '_blank');
  await expect(resources).toHaveAttribute('rel', 'noopener noreferrer');
  await page.locator('#query').fill('preserved-console-state.example');
  const resourcesPagePromise = page.waitForEvent('popup');
  await resources.click();
  const resourcesPage = await resourcesPagePromise;
  await resourcesPage.waitForLoadState('domcontentloaded');
  await expect(resourcesPage).toHaveURL(/\/resources$/u);
  await expect(page).toHaveURL(/\/lookup$/u);
  await expect(page.locator('#query')).toHaveValue('preserved-console-state.example');
  await resourcesPage.close();
  await expect(page.getByRole('navigation', { name: 'Console' }).getByRole('link', { name: /Registry support/ })).toHaveCount(0);
});

test('legacy guide links redirect to the consolidated Resources hub', async ({ page }) => {
  await page.goto('/guide');
  await expect(page).toHaveURL('/resources');
  await expect(page.getByRole('heading', { name: 'Guides for common investigation tasks' })).toBeVisible();
});
