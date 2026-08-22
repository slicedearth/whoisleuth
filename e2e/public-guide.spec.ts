import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';

test('homepage presents plain-language goals, restrained branding, and synthetic product previews', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: /Understand a domain.+Before you act/u })).toBeVisible();
  await expect(page.locator('.hero-kicker')).toHaveText('Domain intelligence console');
  await expect(page.locator('.public-header .mark')).toHaveCount(1);
  await expect(page.locator('.hero .mark')).toHaveCount(0);
  await expect(page.locator('.goal-paths article')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'Inspect one domain' })).toBeVisible();
  await expect(page.getByRole('link', { name: /See these steps/u }).first()).toHaveCSS('cursor', 'pointer');
  await expect(page.getByRole('link', { name: /Browse the topic library/u })).toHaveCSS('cursor', 'pointer');
  await expect(page.getByRole('heading', { name: 'Find brand lookalikes' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Track important findings' })).toBeVisible();
  const goalCards = page.locator('.goal-paths article');
  const featuredBox = await goalCards.nth(0).boundingBox();
  const secondBox = await goalCards.nth(1).boundingBox();
  const thirdBox = await goalCards.nth(2).boundingBox();
  expect(featuredBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  expect(thirdBox).not.toBeNull();
  expect(featuredBox!.width).toBeGreaterThan(secondBox!.width * 1.8);
  expect(Math.abs(secondBox!.y - thirdBox!.y)).toBeLessThanOrEqual(2);
  const goalBorders = await goalCards.evaluateAll((cards) => cards.map((card) => getComputedStyle(card).borderColor));
  expect(new Set(goalBorders).size).toBe(1);
  await expect(page.locator('.product-preview .preview-panel')).toHaveCount(3);
  const candidateButtons = page.locator('.discover-panel .candidate-row');
  await expect(candidateButtons).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Show northstar-login.example in the preview' })).toHaveAttribute('aria-pressed', 'true');
  const previewTabs = page.getByRole('tablist', { name: 'Lookup result layout preview' });
  await expect(previewTabs.getByRole('tab', { name: 'Evidence' })).toHaveAttribute('aria-selected', 'true');
  const topology = page.getByRole('region', { name: 'Where this result comes from' });
  await expect(topology).toBeVisible();
  await expect(topology.locator('#homepage-evidence-map-title')).toHaveCSS('clip-path', 'inset(50%)');
  await expect(topology.getByRole('img', { name: 'Separately attributed evidence flow' })).toBeVisible();
  await expect(page.locator('.mobile-source-summary > li')).toHaveCount(5);
  await page.getByRole('button', { name: 'Show northstarr.example in the preview' }).click();
  await expect(page.getByRole('button', { name: 'Show northstarr.example in the preview' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.lookup-panel > header small')).toHaveText('northstarr.example');
  await expect(topology).toContainText('unavailable');
  await expect(topology).toContainText('Watch for change');
  await expect(page.locator('.monitor-panel')).toContainText('Watch for material change');
  await previewTabs.getByRole('tab', { name: 'At a glance' }).click();
  const previewOverview = page.getByRole('tabpanel', { name: 'At a glance' });
  await expect(previewOverview.getByText('4 sources + 1 derived', { exact: true })).toBeVisible();
  await expect(previewOverview.getByText('34/100', { exact: true })).toBeVisible();
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

test('public resources offer task-specific source boundaries on desktop and mobile', async ({ page }) => {
  await page.goto('/resources');

  await expect(page.getByRole('heading', { name: 'Guides for common investigation tasks' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Guides for common investigation tasks sections' })).toBeVisible();
  await expect(page.locator('.resource-grid article')).toHaveCount(8);
  await page.locator('.resource-grid').getByRole('link', { name: 'RDAP versus WHOIS', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'RDAP versus WHOIS: why registration sources disagree' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Public navigation' }).getByRole('link', { name: 'Resources' })).toHaveAttribute('aria-current', 'location');
  await expect(page.getByRole('table', { name: 'Evidence sources and limitations' })).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(4);
  await expect(page.getByRole('heading', { name: 'Questions worth answering' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Inspect synthetic registration evidence' })).toHaveAttribute('href', '/demo');
  await expect(page.getByRole('link', { name: 'Open docs/registry-data-contract.md' })).toHaveAttribute(
    'href',
    'https://github.com/slicedearth/whoisleuth/blob/main/docs/registry-data-contract.md',
  );
  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
  const breadcrumbLayout = await breadcrumb.locator(':scope > *').evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      y: box.y,
      height: box.height,
      margin: style.margin,
      padding: style.padding,
    };
  }));
  expect(new Set(breadcrumbLayout.map((item) => Math.round(item.y))).size).toBe(1);
  expect(new Set(breadcrumbLayout.map((item) => Math.round(item.height))).size).toBe(1);
  expect(breadcrumbLayout[0]?.margin).toBe('0px');
  expect(breadcrumbLayout[0]?.padding).toBe('0px');
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 320, height: 700 });
  await page.reload();
  await expect(page.getByRole('table', { name: 'Evidence sources and limitations' })).toBeVisible();
  expect(await breadcrumb.evaluate((element) => getComputedStyle(element).marginLeft)).toBe('0px');
  await expectNoHorizontalOverflow(page);
});

test('public guide explains tasks, result states, glossary terms, and common questions', async ({ page }) => {
  await page.goto('/resources');
  await expect(page.getByText(/At a glance separates complete, limited, disagreeing and unresolved evidence/i)).toBeVisible();
  await expect(page.getByText(/Focus changes section order for the selected task/i)).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Guides for common investigation tasks' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Guides for common investigation tasks sections' })).toBeVisible();
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
  await expect(page.locator('.goal-paths article')).toHaveCount(3);
  await page.getByRole('button', { name: 'Open offline practice' }).click();
  const practice = page.getByRole('region', { name: 'Try a guided analyst decision.' });
  await expect(practice).toBeVisible();
  await expect(practice.getByLabel('Practice scenario')).toHaveValue('brand-boundary-review');
  await practice.getByLabel('Review the official domain and trusted allowlists before generating candidates.').check();
  await expect(practice.getByText('Defensible choice')).toBeVisible();
  await expect(practice.getByRole('button', { name: 'Next decision' })).toBeEnabled();
  await expect(page.locator('.tool-guide article')).toHaveCount(5);
  await expect(page.locator('.reference-guide article')).toHaveCount(1);
  const resultLayout = page.getByRole('article', { name: 'Start with the decision, then open the evidence you need' });
  await expect(resultLayout).toBeVisible();
  await expect(resultLayout.getByText('Relationships and history', { exact: true })).toBeVisible();
  await expect(resultLayout).toContainText('Each family can be opened or collapsed independently.');
  await expect(page.locator('.state-grid article')).toHaveCount(9);
  await expect(page.locator('.glossary-grid > div')).toHaveCount(59);
  await expect(page.locator('.glossary-grid').getByText('DANE', { exact: true })).toBeVisible();
  await expect(page.locator('.glossary-grid').getByText('MTA-STS', { exact: true })).toBeVisible();
  await expect(page.locator('.glossary-grid').getByText('TLSA', { exact: true })).toBeVisible();
  await expect(page.locator('.glossary-grid').getByText('Browser-library advisory match', { exact: true })).toBeVisible();
  await expect(page.locator('.glossary-grid').getByText('HTTPS service binding', { exact: true })).toBeVisible();
  await expect(page.locator('.glossary-grid').getByText('PTR', { exact: true })).toBeVisible();
  await expect(page.locator('.glossary-grid').getByText('SOA', { exact: true })).toBeVisible();
  await expect(page.locator('.glossary-grid').getByText('Website profile snapshot', { exact: true })).toBeVisible();
  await expect(page.locator('.faq-list details')).toHaveCount(21);

  const question = page.getByText('Does WHOISleuth decide whether a domain is malicious?', { exact: true });
  await question.click();
  await expect(page.getByText('No. It organises observed evidence and provides an explainable Risk score for prioritisation.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Try the synthetic demo' })).toHaveAttribute('href', '/demo');
  await expect(page.locator('.reference-actions').getByRole('link', { name: 'Open console' })).toHaveAttribute('href', '/dashboard');
  await expect(page.locator('.closing-actions').getByRole('link', { name: 'Open console' })).toHaveAttribute('href', '/dashboard');
  await expect(page.getByRole('link', { name: 'Sign in to investigate' })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('privacy policy offers concise section navigation at desktop and mobile widths', async ({ page }) => {
  await page.goto('/privacy');

  const sectionNavigation = page.getByRole('navigation', { name: 'Privacy policy sections' });
  await expect(sectionNavigation).toBeVisible();
  await expect(sectionNavigation.getByRole('link')).toHaveCount(8);
  const headingIds = await page.locator('.policy h2[id]').evaluateAll((headings) => headings.map((heading) => heading.id));
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
  expect(await sectionNavigation.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2);
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
  const sectionBrowser = page.locator('.section-navigation-mobile');
  await expect(sectionBrowser).toBeVisible();
  await sectionBrowser.locator(':scope > summary').click();
  const resourceSections = sectionBrowser.getByRole('navigation', { name: 'Guides for common investigation tasks sections' });
  await expect(resourceSections).toBeVisible();
  await expect(page.getByRole('region', { name: 'Common WHOISleuth tasks' })).toBeVisible();
  await expect(resourceSections.getByRole('link', { name: 'Topics' })).toHaveAttribute('href', '#topics');
  await expect(resourceSections.getByRole('link', { name: 'Tools' })).toHaveAttribute('href', '#tools');
  await expect(resourceSections.getByRole('link', { name: 'Practice' })).toHaveAttribute('href', '#practice');
  await expect(resourceSections.getByRole('link', { name: 'Reference' })).toHaveAttribute('href', '#reference');
  await expect(page.getByRole('heading', { name: 'Domain investigation terms' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Start with the decision, then open the evidence you need' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('public footer keeps an even compact rhythm on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto('/');

  const footer = page.locator('footer.site-footer');
  const links = footer.locator('.footer-links a');
  await expect(footer).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Privacy', exact: true })).toHaveAttribute('href', '/privacy');
  await expect(footer.getByRole('link', { name: 'Terms', exact: true })).toHaveAttribute('href', '/terms');
  await expect(footer.getByRole('link', { name: 'Request policy', exact: true })).toHaveAttribute('href', '/request-policy');
  await expect(footer.getByRole('link', { name: 'Contact', exact: true })).toHaveAttribute('href', '/contact');
  await expect(links).toHaveCount(5);
  const footerHrefs = await links.evaluateAll((elements) => elements.map((element) => element.getAttribute('href')));
  expect(new Set(footerHrefs).size).toBe(footerHrefs.length);

  const linkLayout = await links.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      height: box.height,
      y: box.y,
      marginLeft: style.marginLeft,
      marginRight: style.marginRight,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight
    };
  }));

  expect(linkLayout.every((link) => link.height <= 32)).toBe(true);
  const rows = [...new Set(linkLayout.map((link) => Math.round(link.y)))].sort((a, b) => a - b);
  expect(rows.length).toBeLessThanOrEqual(3);
  expect(rows.slice(1).every((row, index) => row - rows[index]! <= 40)).toBe(true);
  expect(linkLayout.every((link) => link.marginLeft === '0px' && link.marginRight === '0px')).toBe(true);
  expect(linkLayout.every((link) => link.paddingLeft === '0px' && link.paddingRight === '0px')).toBe(true);
  expect((await footer.boundingBox())?.height).toBeLessThan(210);
  await expectNoHorizontalOverflow(page);
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
