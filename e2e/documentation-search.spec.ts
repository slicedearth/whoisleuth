import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, useTheme } from './helpers';
import { documentationSearchDocuments } from '../frontend/src/lib/documentation-search';

test('the console palette searches documentation without reading saved work or retaining the query', async ({ page }) => {
  await page.goto('/dashboard');
  const trigger = page.getByRole('button', { name: 'Open console navigation' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Go to', exact: true });
  await dialog.getByRole('button', { name: 'Documentation', exact: true }).click();
  const query = dialog.getByRole('searchbox', { name: 'Command, task or term' });
  await expect(query).toBeFocused();
  await query.fill('DMARC');
  await expect(dialog.getByRole('link', { name: /Glossary DMARC/u })).toBeVisible();
  await expect(page).toHaveURL('/dashboard');
  await query.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole('button', { name: 'Documentation', exact: true }).click();
  await expect(query).toHaveValue('');
  await query.fill('verify-artifact');
  const destination = dialog.getByRole('link', { name: /^CLI command verify-artifact /u });
  await expect(destination).toBeVisible();
  await query.press('ArrowDown');
  await expect(destination).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/cli#command-verify-artifact');
  await expect(page.locator('[data-command-detail="verify-artifact"]')).toBeVisible();
});

test('documentation search supports keyboard selection, focus recovery and private queries', async ({ page }, testInfo) => {
  const requests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/') && !/\/(session|capabilities)$/u.test(new URL(request.url()).pathname)) requests.push(request.url()); });
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 1024, height: 768 }, { width: 1280, height: 720 }, { width: 2560, height: 1440 }, { width: 3840, height: 2160 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/resources');
      const trigger = page.getByRole('button', { name: 'Search documentation', exact: true });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'Search documentation', exact: true });
      const input = dialog.getByRole('searchbox', { name: 'Command, task or term' });
      await expect(input).toBeFocused();
      await input.fill('DMARC');
      await expect(dialog.getByRole('link', { name: /Glossary DMARC/u })).toBeVisible();
      await expect(page).toHaveURL('/resources');
      await expectNoHorizontalOverflow(page);
      const scan = await new AxeBuilder({ page }).include('.documentation-search').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(scan.violations).toEqual([]);
      if ([320, 1280].includes(viewport.width)) if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`search-${theme}-${viewport.width}.png`) }); }
      await input.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
    }
  }
  await page.getByRole('button', { name: 'Search documentation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Search documentation', exact: true });
  await dialog.getByRole('searchbox').fill('verify-artifact');
  const destination = dialog.getByRole('link', { name: /^CLI command verify-artifact /u });
  await expect(destination).toBeVisible();
  await dialog.getByRole('searchbox').press('ArrowDown');
  await expect(destination).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/cli#command-verify-artifact');
  await expect(page.locator('[data-command-detail="verify-artifact"]')).toBeVisible();
  expect(requests).toEqual([]);
});

test('every indexed destination exists and hidden guide sections open on direct navigation', async ({ page }) => {
  const documents = documentationSearchDocuments();
  for (const pathname of new Set(documents.map(item => item.href.split('#')[0]!))) {
    await page.goto(pathname);
    for (const document of documents.filter(item => item.href.startsWith(`${pathname}#`))) {
      const id = document.href.split('#')[1]!;
      await expect(page.locator(`[id="${id}"]`), document.href).toHaveCount(1);
    }
  }
  await page.goto('/resources#term-dmarc');
  await expect(page.locator('#glossary')).toHaveAttribute('open', '');
  await expect(page.locator('#term-dmarc')).toBeInViewport();
  await page.goto('/resources#tool-monitor-next');
  await expect(page.locator('#tool-monitor')).toHaveAttribute('open', '');
  await expect(page.locator('#tool-monitor-next')).toBeInViewport();
});

test('command contents follow the selected command and preserve subsection links', async ({ page }) => {
  await page.goto('/cli#command-bulk--inputs');
  await expect(page.locator('#command-bulk--inputs')).toBeInViewport();
  await expect(page.locator('#command-bulk--inputs')).toContainText('4 in Fast mode; 2 in Deep mode');
  const contents = page.getByRole('navigation', { name: 'bulk command sections' });
  const pageContents = page.getByRole('navigation', { name: 'CLI sections', exact: true });
  await expect(pageContents.getByRole('link', { name: 'Command reference' })).toHaveAttribute('href', '#commands');
  await expect(pageContents.getByRole('link', { name: 'Get started' })).toHaveCount(1);
  await expect(contents.getByRole('link', { name: 'All commands', exact: true })).toHaveCount(0);
  await expect(contents.getByRole('link', { name: 'Inputs and options' })).toHaveAttribute('href', '#command-bulk--inputs');
  await contents.getByRole('link', { name: 'Interpretation and limits' }).click();
  await expect(page.locator('#command-bulk--interpretation')).toHaveAttribute('open', '');
  await expect(page.locator('#command-bulk--interpretation')).toBeInViewport();
  await page.goBack();
  await expect(page).toHaveURL('/cli#command-bulk--inputs');
  await expect(page.locator('#command-bulk--inputs')).toBeInViewport();
  await page.getByRole('link', { name: /Back to \d+ filtered commands/u }).click();
  await expect(page.getByRole('searchbox', { name: 'Search commands' })).toBeVisible();
});

test('guide printing includes disclosed reference text and restores the reading state', async ({ page }) => {
  await page.goto('/resources');
  await expect(page.locator('#glossary')).not.toHaveAttribute('open', '');
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#term-dmarc')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Public navigation' })).not.toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('#glossary')).not.toHaveAttribute('open', '');
});
