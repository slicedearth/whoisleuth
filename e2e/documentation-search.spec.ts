import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, useTheme } from './helpers';
import { documentationSearchDocuments } from '../frontend/src/lib/documentation-search';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('the console palette searches documentation without reading saved work or retaining the query', async ({ page }) => {
  await page.goto('/dashboard');
  const trigger = page.getByRole('button', { name: 'Search console navigation' });
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
  let releaseScripts = () => {};
  const scriptsReleased = new Promise<void>(resolve => { releaseScripts = resolve; });
  let heldScripts = 0;
  await page.route('**/_app/**', async route => {
    if (route.request().resourceType() === 'script') {
      heldScripts++;
      await scriptsReleased;
    }
    await route.fallback();
  });
  const print = page.getByRole('button', { name: 'Print this guide', exact: true });
  try {
    await page.goto('/resources', { waitUntil: 'commit' });
    await expect.poll(() => heldScripts).toBeGreaterThan(0);
    await expect(page.locator('#glossary')).toHaveCount(1);
    await expect(page.locator('#glossary')).not.toHaveAttribute('open', '');
    await expect(print).toBeDisabled();
  } finally { releaseScripts(); }
  await expect(print).toBeEnabled();
  // Replace only the native dialog. Exercise the actual button and print handlers.
  await page.evaluate(() => {
    Reflect.set(window, 'guidePrintCalls', 0);
    window.print = () => {
      Reflect.set(window, 'guidePrintCalls', Number(Reflect.get(window, 'guidePrintCalls')) + 1);
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
  await page.locator('#tool-monitor > summary').click();
  await expect(page.locator('#tool-monitor')).toHaveAttribute('open', '');
  await expect(page.locator('#glossary')).not.toHaveAttribute('open', '');
  await print.focus();
  await print.press('Enter');
  expect(await page.evaluate(() => Reflect.get(window, 'guidePrintCalls'))).toBe(1);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#term-dmarc')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Public navigation' })).not.toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('#glossary')).not.toHaveAttribute('open', '');
  await expect(page.locator('#tool-monitor')).toHaveAttribute('open', '');
});

test('methodology field cards print independently without saved work and restore the reading state', async ({ page, browserName }, testInfo) => {
  const collectionRequests: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/') && !['/api/session', '/api/capabilities'].includes(path)) collectionRequests.push(path);
  });
  await page.addInitScript(() => {
    const accesses: string[] = [];
    Reflect.set(window, 'fieldCardStorageAccess', accesses);
    IDBFactory.prototype.open = function(name) { accesses.push(`open:${name}`); throw new Error('Public reference must not open saved work'); };
    IDBFactory.prototype.deleteDatabase = function(name) { accesses.push(`delete:${name}`); throw new Error('Public reference must not delete saved work'); };
    localStorage.setItem('saved-work-sentinel', 'Private Case sentinel');
    sessionStorage.setItem('saved-work-sentinel', 'Private draft sentinel');
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/methodology');
  const print = page.getByRole('button', { name: 'Print this guide', exact: true });
  await expect(print).toBeEnabled();
  const disclosure = page.locator('#analyst-field-cards');
  const toggle = disclosure.locator('summary');
  const choice = disclosure.getByRole('checkbox', { name: 'Print field cards only', includeHidden: true });
  const cards = page.getByRole('region', { name: 'Printable analyst reference', includeHidden: true });
  const authority = page.getByRole('heading', { name: 'Authority-aware registration decisions', includeHidden: true });
  await expect(disclosure).not.toHaveAttribute('open', '');
  await expect(choice).not.toBeChecked();
  await page.evaluate(() => {
    Reflect.set(window, 'fieldCardPrintCalls', 0);
    window.print = () => {
      Reflect.set(window, 'fieldCardPrintCalls', Number(Reflect.get(window, 'fieldCardPrintCalls')) + 1);
      window.dispatchEvent(new Event('beforeprint'));
    };
  });

  // The full guide remains the default, including content closed on screen.
  await print.focus(); await print.press('Enter');
  await expect(print).toBeFocused();
  await page.emulateMedia({ media: 'print' });
  await expect(authority).toBeVisible();
  await expect(cards).toBeVisible();
  await expect(cards.getByRole('article')).toHaveCount(4);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: 'screen' });
  await expect(disclosure).not.toHaveAttribute('open', '');

  await toggle.focus(); await toggle.press('Enter');
  await expect(disclosure).toHaveAttribute('open', '');
  const applicationVersion = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8')).version;
  await expect(cards).toContainText(`WHOISleuth ${applicationVersion}`);
  await expect(cards).toContainText('Missing DNS or an unreachable page alone does not prove');
  await expect(cards).toContainText('Preparation is not delivery');
  for (const density of ['comfortable', 'compact'] as const) {
    await page.getByRole('button', { name: /^Colour theme,/u }).click();
    await page.getByLabel('Reading density').selectOption(density);
    await page.getByLabel('Reading density').press('Escape');
    for (const width of [320, 1280]) for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: width === 320 ? 700 : 720 });
      await useTheme(page, theme);
      await choice.focus(); await expect(choice).toBeInViewport();
      await expectNoHorizontalOverflow(page);
      expect((await new AxeBuilder({ page }).include('#analyst-field-cards').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
      if (captureVisualEvidenceEnabled()) await disclosure.screenshot({ path: testInfo.outputPath(`field-cards-${density}-${theme}-${width}.png`) });
    }
  }

  await choice.focus(); await choice.press('Space');
  await expect(choice).toBeChecked();
  await toggle.focus(); await toggle.press('Enter');
  await print.focus(); await print.press('Enter');
  await expect(print).toBeFocused();
  await page.emulateMedia({ media: 'print' });
  await expect(authority).not.toBeVisible();
  await expect(cards).toBeVisible();
  const publicNavigation = page.getByRole('navigation', { name: 'Public navigation', includeHidden: true });
  await expect(publicNavigation).not.toHaveCount(0);
  for (const navigation of await publicNavigation.all()) await expect(navigation).not.toBeVisible();
  await expect(choice).not.toBeVisible();
  await expect(page.locator('body')).not.toContainText('Private Case sentinel');
  await expect(page.locator('body')).not.toContainText('Private draft sentinel');
  if (captureVisualEvidenceEnabled()) {
    await cards.screenshot({ path: testInfo.outputPath('field-cards-print.png') });
    if (browserName === 'chromium') await page.pdf({ path: testInfo.outputPath('analyst-field-cards.pdf'), format: 'A4', margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
  }
  expect(await page.evaluate(() => Reflect.get(window, 'fieldCardPrintCalls'))).toBe(2);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: 'screen' });
  await expect(disclosure).not.toHaveAttribute('open', '');
  await expect(choice).toBeChecked();
  await expect(authority).toBeVisible();
  // Print-media emulation hides the trigger and clears browser focus on return;
  // it does not exercise the native print dialog's focus restoration.
  await expect(print).toBeEnabled();
  expect(await page.evaluate(() => Reflect.get(window, 'fieldCardStorageAccess'))).toEqual([]);
  expect(await page.evaluate(() => [localStorage.getItem('saved-work-sentinel'), sessionStorage.getItem('saved-work-sentinel')])).toEqual(['Private Case sentinel', 'Private draft sentinel']);

  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Resources', exact: true }).click();
  await expect(page).toHaveURL('/resources');
  await page.locator('a[href="/methodology"]').first().click();
  await expect(page).toHaveURL('/methodology');
  await expect(choice).not.toBeChecked();
  await page.goto('/methodology#analyst-field-cards');
  await expect(disclosure).toHaveAttribute('open', '');
  await expect(choice).not.toBeChecked();
  expect(await page.evaluate(() => Reflect.get(window, 'fieldCardStorageAccess'))).toEqual([]);
  expect(collectionRequests).toEqual([]);
});
