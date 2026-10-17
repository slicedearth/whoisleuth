import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import { expect, test } from './fixtures';
import AxeBuilder from '@axe-core/playwright';
import { normalizeBrandProfile } from '../packages/workspace/brand-profile-model.mts';
import { currentBrandProfileBrowserStore, currentBrowserLocalDocument, expectNoHorizontalOverflow, migrateLegacyBrowserData, openBrandProfileList, readBrowserLocalCollection, runBulkScan, selectBulkResultView, useTheme } from './helpers';
import { createCase } from '../packages/cases/case-record-operations.mts';
import { createWorkspace, openArchive, switchWorkspace } from './browser-workspace-fixtures';
import { caseNumber } from '../packages/cases/case-workflow-metadata.mts';

const viewports = [
  { width: 320, height: 700 }, { width: 390, height: 844 },
  { width: 1024, height: 768 }, { width: 1280, height: 720 },
  { width: 1920, height: 1080 }, { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
] as const;

test('public and console footers keep one layout and complete accessible links', async ({ page }, testInfo) => {
  for (const width of [320, 390, 412, 720, 1024, 1280]) for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 900 });
    let publicLayout: number[] | undefined;
    for (const path of ['/', '/resources', '/dashboard']) {
      await page.goto(path);
      await useTheme(page, theme);
      const footer = page.locator('.site-footer');
      const links = footer.getByRole('navigation', { name: 'Footer', exact: true });
      await expect(links.getByRole('link')).toHaveCount(5);
      for (const [label, href] of [['Privacy', '/privacy'], ['Terms', '/terms'], ['Request policy', '/request-policy'], ['Contact', '/contact']] as const) {
        const link = links.getByRole('link', { name: new RegExp(`^${label}(?: \\(|$)`, 'u') });
        await expect(link).toHaveAttribute('href', href);
        await expect(link).toBeVisible();
        if (path === '/dashboard') {
          await expect(link).toHaveAttribute('target', '_blank');
          await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        } else await expect(link).not.toHaveAttribute('target');
      }
      await expect(links.getByRole('link', { name: 'Source and licence (opens in a new tab)', exact: true })).toHaveAttribute('target', '_blank');
      await page.evaluate(() => document.fonts.ready);
      await footer.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      const layout = await footer.evaluate(element => {
        const box = element.getBoundingClientRect();
        const metadata = element.querySelector('p')!.getBoundingClientRect();
        const author = element.querySelector('p a')!.getBoundingClientRect();
        const navigation = element.querySelector('nav')!.getBoundingClientRect();
        return {
          metadataBottom: metadata.bottom - box.top,
          navigationTop: navigation.top - box.top,
          positions: [metadata.height, author.left - box.left, author.top - box.top, ...Array.from(element.querySelectorAll('nav > a')).flatMap(link => {
            const bounds = link.getBoundingClientRect();
            return [bounds.left - box.left, bounds.top - box.top];
          })],
        };
      });
      expect(layout.navigationTop).toBeGreaterThan(layout.metadataBottom);
      if (publicLayout) {
        expect(layout.positions).toHaveLength(publicLayout.length);
        layout.positions.forEach((value, index) => expect(value).toBeCloseTo(publicLayout![index]!, 0));
      } else publicLayout = layout.positions;
      if (captureVisualEvidenceEnabled()) await footer.screenshot({ path: testInfo.outputPath(`footer-${path.slice(1) || 'home'}-${width}-${theme}.png`) });
    }
  }
  await page.getByRole('navigation', { name: 'Footer' }).getByRole('link').first().focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name: /^Terms/u })).toBeFocused();
  expect((await new AxeBuilder({ page }).include('.site-footer').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
});

test('optional Case covers and workspace markers stay temporary and retain exact identities and review clocks', async ({ page }, testInfo) => {
  const record = createCase({ domain: 'cover.example' }, '2026-09-01T00:00:00.000Z');
  record.updatedAt = '2026-09-20T00:00:00.000Z';
  record.decisions = [{ id: 'cover-review', summary: 'More evidence is needed', rationale: 'Separate evidence remains incomplete',
    confidence: 'low', confidenceBasis: 'Recorded scope', evidencePinIds: [], createdAt: '2026-09-05T00:00:00.000Z' }];
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', { cases: [record] }) }, { clearStorage: true, destination: '/cases' });
  const retained = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  const covers = page.getByRole('checkbox', { name: 'Preview Case covers', exact: true });
  await expect(covers).not.toBeChecked();
  const header = page.locator(`#case-head-${record.id}`);
  const href = await header.getAttribute('href');
  const before = await page.evaluate(() => ({ local: Object.entries(localStorage).sort(), session: Object.entries(sessionStorage).sort() }));
  await covers.focus(); await covers.press('Space');
  const cover = page.locator('.case.cover');
  await expect(cover).toContainText(caseNumber(record.id));
  await expect(cover.locator('.cover-context time')).toHaveAttribute('datetime', '2026-09-05T00:00:00.000Z');
  await expect(cover.locator('time.updated')).toHaveAttribute('datetime', '2026-09-20T00:00:00.000Z');
  await expect(header).toHaveAttribute('href', href!);
  const workspace = page.getByRole('note', { name: 'Active workspace', exact: true });
  const storage = page.locator('.console-context details.context-storage').filter({ has: page.getByText('Browser-local storage', { exact: true }) });
  await expect(storage).toHaveJSProperty('open', false);
  await expect(storage.getByText('Workspace marker', { exact: true })).not.toBeVisible();
  await storage.locator(':scope > summary').focus();
  await storage.locator(':scope > summary').press('Enter');
  await storage.getByText('Workspace marker', { exact: true }).click();
  const marker = storage.getByRole('combobox', { name: 'Temporary marker', exact: true });
  await expect(marker).toHaveValue('none');
  await marker.selectOption('violet');
  await expect(workspace.locator('.workspace-marker.violet')).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(marker).toHaveValue('violet');
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(retained);
  expect(await page.evaluate(() => ({ local: Object.entries(localStorage).sort(), session: Object.entries(sessionStorage).sort() }))).toEqual(before);
  for (const width of [320, 1280]) for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: width === 320 ? 700 : 720 }); await useTheme(page, theme);
    await covers.scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page);
    expect((await new AxeBuilder({ page }).include('.case-list').include('.console-context').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    if (captureVisualEvidenceEnabled()) {
      await page.screenshot({ path: testInfo.outputPath(`optional-covers-${width}-${theme}.png`) });
      await workspace.screenshot({ path: testInfo.outputPath(`optional-marker-${width}-${theme}.png`) });
    }
  }
  await page.reload();
  await expect(covers).not.toBeChecked();
  await storage.locator(':scope > summary').click();
  await storage.getByText('Workspace marker', { exact: true }).click();
  await expect(marker).toHaveValue('none');
  await page.goto('/dashboard#workspaces');
  const created = await createWorkspace(page, 'Temporary marker check');
  await switchWorkspace(page, created.name);
  await storage.locator(':scope > summary').click();
  await storage.getByText('Workspace marker', { exact: true }).click();
  await expect(marker).toHaveValue('none');
  const archive = await openArchive(page, true);
  await expect(archive.locator('.workspace-scope').getByRole('combobox')).toHaveCount(0);
});

test('overflowing review tabs expose scroll controls without changing the selected view', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  for (const direction of ['ltr', 'rtl']) {
    await page.goto('/monitor?view=timeline');
    const tabs = page.getByRole('tablist', { name: 'Monitor views', exact: true });
    await expect(tabs.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
    await page.locator('.horizontal-navigation').evaluate((element, dir) => { element.setAttribute('dir', dir); }, direction);
    // A translated label can resize the content after mount; the observer must
    // update its controls without a page resize or a different selection.
    await tabs.getByRole('tab').last().evaluate(element => { element.prepend('Long translated navigation label '); });
    const controls = page.getByRole('group', { name: 'Scroll Monitor views', exact: true });
    await expect(controls).toBeVisible();
    const towardsEnd = controls.getByRole('button', { name: `Scroll Monitor views ${direction === 'ltr' ? 'right' : 'left'}`, exact: true });
    await expect(towardsEnd).toBeEnabled();
    const before = page.url();
    await towardsEnd.click();
    expect(page.url()).toBe(before);
    await expect(tabs.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
    const towardsStart = controls.getByRole('button', { name: `Scroll Monitor views ${direction === 'ltr' ? 'left' : 'right'}`, exact: true });
    await expect(towardsStart).toBeEnabled();
    await tabs.getByRole('tab').first().focus();
    await page.keyboard.press('End');
    const last = tabs.getByRole('tab').last();
    await expect(last).toBeFocused();
    await expect(last).toHaveAttribute('aria-selected', 'true');
    // Selection updates optimistically; reload only after navigation commits.
    await expect(page).toHaveURL(url => url.pathname === '/monitor' && url.searchParams.get('view') === 'rules');
    // The ordinary label is restored by navigation; assert its real control,
    // rather than asking an artificially wider-than-viewport label to fit.
    await page.reload();
    await expect(last).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.getByRole('tab').last()).toBeInViewport({ ratio: 1 });
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(controls).toHaveCount(0);
    await page.setViewportSize({ width: 320, height: 700 });
  }
});

test('an empty Tools destination creates a profile and returns focus to its saved record', async ({ page }) => {
  await migrateLegacyBrowserData(page, {}, { clearStorage: true, destination: '/brands?view=tools' });
  await expect(page.getByRole('tab', { name: 'Tools', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Create profile', exact: true }).click();
  const name = page.getByLabel('Brand name', { exact: true });
  await expect(name).toBeFocused();
  await name.fill('Navigation profile');
  await page.getByLabel('Official domains', { exact: true }).fill('official.example');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Edit Navigation profile/u })).toBeFocused();
  await expect(page.locator('#brand-workbench')).toBeEnabled();
  await expect(page.getByRole('tab', { name: 'Tools', exact: true })).toHaveAttribute('aria-selected', 'true');
});

for (const theme of ['light', 'dark'] as const) {
  test(`Brand and review navigation preserve accessible active controls across viewports in ${theme}`, async ({ page }, testInfo) => {
    test.slow();
    const profile = normalizeBrandProfile({ id: 'navigation-profile', name: 'Example organisation with a longer profile name', officialDomains: ['official.example'] }, { nowIso: '2026-09-01T00:00:00.000Z' });
    expect(profile).not.toBeNull();
    await migrateLegacyBrowserData(page, {
      'whois-rdap-brand-profiles-v1': currentBrandProfileBrowserStore([profile!]),
      'whois-rdap-active-brand-profile-v1': profile!.id,
    }, { clearStorage: true, destination: '/brands' });
    await useTheme(page, theme);
    const requests: string[] = [];
    await page.route('**/api/lookup**', async route => { requests.push(route.request().url()); await route.abort(); });
    await page.goto('/brands?workbench=attestations');
    const tools = page.getByRole('tab', { name: 'Tools', exact: true });
    await expect(tools).toHaveAttribute('aria-selected', 'true');
    const controls = page.getByRole('region', { name: 'Reviewed account controls', exact: true });
    await expect(controls).toBeVisible();
    await expect(page.locator('#brand-profiles-summary').locator('..')).not.toHaveAttribute('open', '');
    await tools.focus();
    await tools.press('Home');
    const overview = page.getByRole('tab', { name: 'Overview', exact: true });
    await expect(overview).toBeFocused();
    await expect(overview).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('region', { name: 'Allowlist', exact: true })).toBeVisible();
    await overview.press('End');
    await expect(tools).toBeFocused();
    await expect(controls).toBeVisible();
    // Exercise the state transition once; resizing the same populated view
    // tests layout without repeating domain operations or route preparation.
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await expectNoHorizontalOverflow(page);
      for (const tab of await page.getByRole('tablist', { name: 'Brands views', exact: true }).getByRole('tab').all()) {
        const box = await tab.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      }
      for (const control of await page.locator('.top-actions > button, .top-actions > label, #brand-workbench').all()) {
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`brands-tools-${theme}-${viewport.width}.png`), fullPage: false }); }
    }
    await openBrandProfileList(page);
    await expect(page.getByRole('radio', { name: `Set ${profile!.name} active`, exact: true })).toBeChecked();
    await page.goto('/monitor?view=watchlists');
    const tabs = page.getByRole('tablist', { name: 'Monitor views', exact: true });
    const watchlists = tabs.getByRole('tab', { name: /^Watchlists/u });
    await watchlists.focus();
    await watchlists.press('End');
    const selected = tabs.getByRole('tab', { name: /^Custom rules/u });
    await expect(selected).toBeFocused();
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await expect(selected).toHaveAttribute('aria-selected', 'true');
      await expect(selected).toBeInViewport({ ratio: 1 });
      await expectNoHorizontalOverflow(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`monitor-${theme}-${viewport.width}.png`) }); }
      if (viewport.width < 500) {
        const toggle = page.getByRole('button', { name: 'Toggle navigation', exact: true });
        await toggle.click();
        const navigation = page.getByRole('navigation', { name: 'Console', exact: true });
        await expect(navigation).toBeInViewport();
        const geometry = await navigation.evaluate(element => ({
          top: element.getBoundingClientRect().top,
          headerBottom: document.querySelector('.shell > header')?.getBoundingClientRect().bottom ?? null,
        }));
        expect(geometry.headerBottom).not.toBeNull();
        expect(geometry.top).toBeGreaterThanOrEqual(geometry.headerBottom!);
        await page.keyboard.press('Escape');
        await expect(toggle).toBeFocused();
      }
    }
    expect(requests).toEqual([]);
  });
}

test('Bulk keeps collection and result controls readable with a header-aware view switcher', async ({ page }, testInfo) => {
  test.slow();
  const targets = Array.from({ length: 24 }, (_, index) => `target-${index}.example`);
  await page.route('**/api/lookup**', async route => {
    const domain = new URL(route.request().url()).searchParams.get('q');
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      availability: { applicable: true, domain, state: 'registered', confidence: 'high' },
      diagnostics: { version: 7, rdap: { status: 'complete' }, whois: { status: 'skipped' }, availability: { status: 'complete' } },
    }) });
  });
  await page.goto('/bulk');
  await runBulkScan(page, targets);
  await selectBulkResultView(page, 'List');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (viewport.width <= 700) {
        const risk = page.locator('.results-table tbody tr').first().locator('td[data-label="Risk"]');
        const qualification = risk.locator('.bulk-risk > small');
        await expect(qualification).toContainText('comparable cohort');
        const geometry = await qualification.evaluate(element => {
          const cell = element.closest('td')!.getBoundingClientRect();
          const range = document.createRange(); range.selectNodeContents(element);
          return { left: cell.left, right: cell.right,
            text: [...range.getClientRects()].map(rect => ({ left: rect.left, right: rect.right, width: rect.width })) };
        });
        expect(geometry.text.length).toBeGreaterThan(0);
        for (const rect of geometry.text) {
          expect(rect.width).toBeGreaterThan(0);
          expect(rect.left).toBeGreaterThanOrEqual(geometry.left - 1);
          expect(rect.right).toBeLessThanOrEqual(Math.min(geometry.right, viewport.width) + 1);
        }
        await expect(risk.getByLabel(`Inspect Risk model and factors for ${targets[0]}`, { exact: true })).toBeVisible();
      }
      for (const field of [page.locator('#domains'), page.getByLabel('Scan mode'), page.getByLabel('Request pacing')]) {
        const box = await field.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`bulk-form-${theme}-${viewport.width}.png`) }); }
      const nav = page.getByRole('group', { name: 'Bulk result view', exact: true });
      await nav.getByRole('button', { name: 'List', exact: true }).focus();
      const scroll = await nav.evaluate(element => ({
        delta: Math.max(0, element.getBoundingClientRect().top - 54 + 100),
        available: document.documentElement.scrollHeight - window.innerHeight - window.scrollY,
      }));
      await page.mouse.move(viewport.width - 30, viewport.height - 60);
      if (scroll.available >= scroll.delta) {
        await page.mouse.wheel(0, scroll.delta);
        await expect.poll(async () => nav.evaluate(element => {
          const top = element.getBoundingClientRect().top;
          const header = document.querySelector('.shell > header')?.getBoundingClientRect().bottom;
          return header !== undefined && top >= header && top <= header + 9;
        })).toBe(true);
      } else {
        expect(viewport.height).toBeGreaterThan(1080);
        await expect(nav).toBeInViewport({ ratio: 1 });
      }
      if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`bulk-results-${theme}-${viewport.width}.png`) }); }
    }
    await page.setViewportSize({ width: 3840, height: 2160 });
    await page.evaluate(() => scrollTo(0, 0));
    const main = page.locator('.shell > main');
    const comfortableWidth = (await main.boundingBox())!.width;
    await page.getByRole('button', { name: /^Colour theme,/u }).click();
    await page.getByLabel('Reading density').selectOption('compact');
    await page.getByLabel('Reading density').press('Escape');
    const compactWidth = (await main.boundingBox())!.width;
    expect(compactWidth).toBeGreaterThan(comfortableWidth);
    const layout = await main.evaluate(element => ({
      right: element.getBoundingClientRect().right,
      tableWidth: element.querySelector('.results-table')?.getBoundingClientRect().width ?? 0,
      width: element.clientWidth,
    }));
    expect(layout.right).toBeLessThanOrEqual(3840);
    expect(layout.tableWidth).toBeGreaterThan(comfortableWidth - 120);
    await expect(page.locator('.results-table tbody tr')).toHaveCount(targets.length);
    await expectNoHorizontalOverflow(page);
    if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`bulk-compact-${theme}-3840.png`) }); }
    await page.getByRole('button', { name: /^Colour theme,/u }).click();
    await page.getByLabel('Reading density').selectOption('comfortable');
    await page.getByLabel('Reading density').press('Escape');
  }
});
