import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';

test('homepage presents plain-language goals, restrained branding, and synthetic product previews', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Understand a domain. Before you act.' })).toBeVisible();
  await expect(page.locator('.hero-brand')).toContainText('WHOISleuth');
  await expect(page.locator('.hero-brand .mark')).toHaveCSS('width', '58px');
  await expect(page.locator('.goal-grid article')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'Inspect one domain' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Find brand lookalikes' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Track important findings' })).toBeVisible();
  await expect(page.locator('.product-preview .preview-panel')).toHaveCount(3);
  await expect(page.getByText('Fixed fictional data from the public demo. No live target is contacted.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Explore the interactive demo' })).toHaveAttribute('href', '/demo');
  await expectNoHorizontalOverflow(page);
});

test('public guide explains tasks, result states, glossary terms, and common questions', async ({ page }) => {
  await page.goto('/guide');

  await expect(page.getByRole('heading', { name: 'Use WHOISleuth with confidence.' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Guide sections' })).toBeVisible();
  await expect(page.locator('.goal-grid article')).toHaveCount(3);
  await expect(page.locator('.workspace-guide article')).toHaveCount(6);
  await expect(page.locator('.state-grid article')).toHaveCount(5);
  await expect(page.locator('.glossary-grid > div')).toHaveCount(28);
  await expect(page.locator('.faq-list details')).toHaveCount(12);

  const question = page.getByText('Does WHOISleuth decide whether a domain is malicious?', { exact: true });
  await question.click();
  await expect(page.getByText('No. It organises observed evidence and provides an explainable Risk score for prioritisation.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Try the synthetic demo' })).toHaveAttribute('href', '/demo');
  await expectNoHorizontalOverflow(page);
});

test('homepage and guide remain usable on a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });

  await page.goto('/');
  await expect(page.locator('.hero-brand .mark')).toHaveCSS('width', '46px');
  await expect(page.locator('.product-preview .preview-panel')).toHaveCount(3);
  await expectNoHorizontalOverflow(page);

  await page.goto('/guide');
  await expect(page.getByRole('navigation', { name: 'Guide sections' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Domain investigation terms.' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('authenticated console exposes the public guide as a reference without changing protected destinations', async ({ page }) => {
  await page.goto('/lookup');
  const reference = page.getByRole('navigation', { name: 'Reference' });
  await expect(reference.getByRole('link', { name: /Guide/ })).toHaveAttribute('href', '/guide');
});
