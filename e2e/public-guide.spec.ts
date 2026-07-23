import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';

test('homepage presents plain-language goals, restrained branding, and synthetic product previews', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Understand a domain. Before you act.' })).toBeVisible();
  await expect(page.locator('.hero-kicker')).toHaveText('Domain intelligence console');
  await expect(page.locator('.public-header .mark')).toHaveCount(1);
  await expect(page.locator('.hero .mark')).toHaveCount(0);
  await expect(page.locator('.terminal-preview').getByText(/Static markup/)).toBeVisible();
  await expect(page.locator('.terminal-preview').getByText(/IP RDAP/)).toBeVisible();
  await expect(page.locator('.goal-grid article')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'Inspect one domain' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Find brand lookalikes' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Track important findings' })).toBeVisible();
  await expect(page.locator('.product-preview .preview-panel')).toHaveCount(3);
  const topology = page.getByRole('region', { name: 'Synthetic lookup evidence topology' });
  await expect(topology).toBeVisible();
  await expect(topology.getByRole('img', { name: 'Synthetic lookup evidence topology visual overview' })).toBeVisible();
  await expect(topology.getByRole('list', { name: 'Evidence source status' }).getByRole('listitem')).toHaveCount(5);
  await expect(page.getByText('Fixed fictional data from the public demo. No live target is contacted.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Explore the interactive demo' })).toHaveAttribute('href', '/demo');
  await expect(page.locator('.hero-actions').getByRole('link', { name: 'Open console' })).toHaveAttribute('href', '/dashboard');
  await expect(page.getByRole('link', { name: 'Sign in to investigate' })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('public guide explains tasks, result states, glossary terms, and common questions', async ({ page }) => {
  await page.goto('/guide');

  await expect(page.getByRole('heading', { name: 'Use WHOISleuth with confidence.' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Guide sections' })).toBeVisible();
  const workflowMap = page.getByRole('region', { name: 'Common WHOISleuth workflow map' });
  await expect(workflowMap).toBeVisible();
  await expect(workflowMap.getByText('Path 01')).toBeVisible();
  const lookupStep = workflowMap.getByRole('link', { name: /1.*Lookup/ }).first();
  await expect(lookupStep).toHaveAttribute('href', '#tool-lookup');
  await lookupStep.click();
  await expect(page.locator('#tool-lookup')).toBeInViewport();
  await expect(page.locator('.goal-grid article')).toHaveCount(3);
  await expect(page.locator('.tool-guide article')).toHaveCount(5);
  await expect(page.locator('.reference-guide article')).toHaveCount(1);
  await expect(page.locator('.state-grid article')).toHaveCount(9);
  await expect(page.locator('.glossary-grid > div')).toHaveCount(40);
  await expect(page.locator('.faq-list details')).toHaveCount(17);

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
  await expect(sectionNavigation.getByRole('link')).toHaveCount(10);
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
