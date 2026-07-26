import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';

test('homepage presents plain-language goals, restrained branding, and synthetic product previews', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Understand a domain. Before you act.' })).toBeVisible();
  await expect(page.locator('.hero-kicker')).toHaveText('Domain intelligence console');
  await expect(page.locator('.public-header .mark')).toHaveCount(1);
  await expect(page.locator('.hero .mark')).toHaveCount(0);
  await expect(page.locator('.goal-paths article')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'Inspect one domain' })).toBeVisible();
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
  const topology = page.getByRole('region', { name: 'Synthetic lookup evidence topology' });
  await expect(topology).toBeVisible();
  await expect(topology.getByRole('img', { name: 'Synthetic lookup evidence topology visual overview' })).toBeVisible();
  await expect(topology.getByRole('list', { name: 'Evidence source status' }).getByRole('listitem')).toHaveCount(5);
  await expect(page.getByText('Fixed fictional data from the public demo. No live target is contacted.')).toBeVisible();
  await expect(page.locator('.hero-actions').getByRole('link', { name: 'Open console' })).toHaveAttribute('href', '/dashboard');
  await expect(page.getByRole('link', { name: 'Sign in to investigate' })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const sourceSummary = page.locator('.mobile-source-summary');
  await expect(sourceSummary).toBeVisible();
  const sourceStateColors = await sourceSummary.evaluate((summary) => {
    const warning = summary.querySelector('.state-warning strong');
    const success = summary.querySelector('.state-success strong');
    const reference = document.createElement('span');
    reference.style.color = 'var(--amber)';
    document.body.append(reference);
    const colors = {
      warning: warning ? getComputedStyle(warning).color : '',
      success: success ? getComputedStyle(success).color : '',
      amber: getComputedStyle(reference).color,
    };
    reference.remove();
    return colors;
  });
  expect(sourceStateColors.warning).toBe(sourceStateColors.amber);
  expect(sourceStateColors.warning).not.toBe(sourceStateColors.success);
  await expectNoHorizontalOverflow(page);
});

test('public guide explains tasks, result states, glossary terms, and common questions', async ({ page }) => {
  await page.goto('/guide');

  await expect(page.getByRole('heading', { name: 'Use WHOISleuth with confidence.' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Guide sections' })).toBeVisible();
  const workflowMap = page.getByRole('region', { name: 'Common WHOISleuth workflow map' });
  await expect(workflowMap).toBeVisible();
  await expect(workflowMap.getByRole('heading', { name: 'Inspect one domain' })).toBeVisible();
  const lookupStep = workflowMap
    .getByRole('list', { name: 'Inspect one domain workflow' })
    .getByRole('link', { name: 'Lookup', exact: true });
  await expect(lookupStep).toHaveAttribute('href', '#tool-lookup');
  await lookupStep.click();
  await expect(page.locator('#tool-lookup')).toBeInViewport();
  const trackingWorkflow = workflowMap.getByRole('list', { name: 'Track important findings workflow' });
  const trackingSteps = trackingWorkflow.getByRole('link');
  await expect(trackingSteps).toHaveCount(3);
  await expect(trackingSteps.nth(0)).toHaveAttribute('href', '#tool-monitor-input');
  await expect(trackingSteps.nth(1)).toHaveAttribute('href', '#tool-monitor-result');
  await expect(trackingSteps.nth(2)).toHaveAttribute('href', '#tool-monitor-next');
  await trackingSteps.nth(2).click();
  await expect(page.locator('#tool-monitor-next')).toBeInViewport();
  await expect(page.locator('.goal-paths article')).toHaveCount(3);
  await expect(page.locator('.tool-guide article')).toHaveCount(5);
  await expect(page.locator('.reference-guide article')).toHaveCount(1);
  await expect(page.locator('.state-grid article')).toHaveCount(9);
  await expect(page.locator('.glossary-grid > div')).toHaveCount(45);
  await expect(page.locator('.glossary-grid').getByText('Browser-library advisory match', { exact: true })).toBeVisible();
  await expect(page.locator('.glossary-grid').getByText('HTTPS service binding', { exact: true })).toBeVisible();
  await expect(page.locator('.glossary-grid').getByText('PTR', { exact: true })).toBeVisible();
  await expect(page.locator('.glossary-grid').getByText('SOA', { exact: true })).toBeVisible();
  await expect(page.locator('.faq-list details')).toHaveCount(18);

  const question = page.getByText('Does WHOISleuth decide whether a domain is malicious?', { exact: true });
  await question.click();
  await expect(page.getByText('No. It organises observed evidence and provides an explainable Risk score for prioritisation.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Try the synthetic demo' })).toHaveAttribute('href', '/demo');
  await expect(page.locator('.guide-actions').getByRole('link', { name: 'Open console' })).toHaveAttribute('href', '/dashboard');
  await expect(page.locator('.closing-actions').getByRole('link', { name: 'Open console' })).toHaveAttribute('href', '/dashboard');
  await expect(page.getByRole('link', { name: 'Sign in to investigate' })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('privacy policy offers compact section navigation without changing policy content', async ({ page }) => {
  await page.goto('/privacy');

  const sectionNavigation = page.getByRole('navigation', { name: 'Privacy policy sections' });
  await expect(sectionNavigation).toBeVisible();
  await expect(sectionNavigation.getByRole('link')).toHaveCount(13);
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
  expect(await sectionNavigation.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await sectionNavigation.evaluate((element) => getComputedStyle(element).maskImage)).toContain('linear-gradient');
  await expectNoHorizontalOverflow(page);
});

test('homepage and guide remain usable on a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });

  await page.goto('/');
  await expect(page.locator('.hero-kicker')).toBeVisible();
  await expect(page.locator('.hero .mark')).toHaveCount(0);
  await expect(page.locator('.product-preview .preview-panel')).toHaveCount(3);
  await expectNoHorizontalOverflow(page);

  await page.goto('/guide');
  await expect(page.getByRole('navigation', { name: 'Guide sections' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Common WHOISleuth workflow map' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Guide sections' }).getByRole('link', { name: 'Tools' })).toHaveAttribute('href', '#tools');
  await expect(page.getByRole('navigation', { name: 'Guide sections' }).getByRole('link', { name: 'Reference' })).toHaveAttribute('href', '#reference');
  await expect(page.getByRole('heading', { name: 'Domain investigation terms.' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('authenticated console groups the guide and registry support under Reference', async ({ page }) => {
  await page.goto('/lookup');
  await expect(page.getByText('Domain intelligence console', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Console' })).toBeVisible();
  const reference = page.getByRole('navigation', { name: 'Reference' });
  await expect(reference.getByRole('link', { name: /Guide/ })).toHaveAttribute('href', '/guide');
  await expect(reference.getByRole('link', { name: /Registry support/ })).toHaveAttribute('href', '/registry-support');
  await expect(page.getByRole('navigation', { name: 'Console' }).getByRole('link', { name: /Registry support/ })).toHaveCount(0);
});
