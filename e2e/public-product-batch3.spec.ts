import type { Page, Request } from '@playwright/test';
import { CLI_COMMANDS } from '../cli/command-reference.mts';
import { PUBLIC_COVERAGE_SUMMARY } from '../frontend/src/lib/generated/public-coverage-summary.ts';
import { PUBLIC_METHODOLOGY } from '../frontend/src/lib/generated/public-methodology.ts';
import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, useTheme } from './helpers';
import { productionChunkPath } from './production-build';

function collectInvestigationRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request: Request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return;
    if (url.pathname === '/api/session' || url.pathname === '/api/capabilities') return;
    requests.push(`${request.method()} ${url.pathname}`);
  });
  return requests;
}

test('CLI workflow recipes and review confirmation remain reachable without empty planning groups', async ({ page }, testInfo) => {
  await page.goto('/cli');
  const workflows = page.locator('[aria-labelledby="runnable-recipes-title"]');
  await expect(workflows.locator('li')).toHaveCount(10);
  await expect(workflows).toContainText('certificate-anomaly');
  await expect(workflows).toContainText('evidence-handoff');
  await expect(page.getByRole('heading', { name: 'Planning templates', exact: true })).toHaveCount(0);
  await page.goto('/cli#command-workflow-run');
  const command = page.locator('.command-workspace');
  await expect(command.getByRole('heading', { name: 'workflow-run', exact: true })).toBeVisible();
  await expect(command).toContainText('--confirm-review');
  await expect(command).toContainText('Checkpoints do not grant later approvals.');
  await expect(command).toContainText('--interactive');
  await expect(command).toContainText('New runs connect compatible earlier outputs');
  await expect(command).toContainText('It grants neither network approval nor human-review confirmation.');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
      if (width === 320 || width === 1280) await command.screenshot({ path: testInfo.outputPath(`workflow-review-${theme}-${width}.png`) });
    }
  }
});

test('offline Case file guidance is reachable from tasks and direct command links', async ({ page }, testInfo) => {
  const investigationRequests = collectInvestigationRequests(page);
  await page.goto('/cli#command-case');
  const command = page.locator('article[data-command-detail="case"]');
  await expect(command.getByRole('heading', { name: 'case', exact: true })).toBeVisible();
  await expect(command).toContainText('Mutations require --output');
  await command.getByText('Operational boundary', { exact: true }).click();
  await expect(command).toContainText('Not reproduced requires an existing saved question');
  await command.getByText('Limits and contracts', { exact: true }).click();
  await expect(command).toContainText('without pruning');
  await expect(page.getByRole('link', { name: 'Case file inputs and examples' })).toHaveAttribute('href', /docs\/cli\.md#local-case-files$/u);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
      if (width === 320 || width === 1280) {
        const skip = page.getByRole('link', { name: 'Skip to main content', exact: true });
        await expect(skip).not.toBeFocused();
        expect(await skip.evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);
        await command.screenshot({ path: testInfo.outputPath(`case-files-${theme}-${width}.png`) });
        await page.screenshot({ path: testInfo.outputPath(`case-files-viewport-${theme}-${width}.png`) });
      }
    }
  }
  expect(investigationRequests).toEqual([]);
});

test('keeps desktop and narrow public navigation complete and request-free', async ({ page }) => {
  const investigationRequests = collectInvestigationRequests(page);
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');

  const navigation = page.getByRole('navigation', { name: 'Public navigation' });
  await expect(page.getByRole('link', { name: 'WHOISleuth overview' })).toHaveAttribute('href', '/');
  await expect(navigation.getByRole('link', { name: 'Demo' })).toHaveAttribute('href', '/demo');
  await expect(navigation.getByRole('link', { name: 'CLI' })).toHaveAttribute('href', '/cli');
  await expect(navigation.getByRole('link', { name: 'Resources' })).toHaveAttribute('href', '/resources');
  await expect(navigation.getByText('More', { exact: true })).toHaveCount(0);

  await page.goto('/resources');
  let documentation = page.getByRole('navigation', { name: 'Documentation' });
  for (const [label, href] of [['Resources', '/resources'], ['CLI', '/cli'], ['Methodology', '/methodology'], ['Coverage', '/coverage'], ['Examples', '/examples']] as const) {
    await expect(documentation.getByRole('link', { name: label, exact: true })).toHaveAttribute('href', href);
  }
  const productReferences = page.getByRole('navigation', { name: 'Product references' });
  for (const [label, href] of [['CLI', '/cli'], ['Methodology', '/methodology'], ['Coverage', '/coverage'], ['Examples', '/examples']] as const) {
    await expect(productReferences.getByRole('link', { name: new RegExp(`^${label}\\b`, 'u') })).toHaveAttribute('href', href);
  }

  for (const [path, heading] of [
    ['/cli', 'WHOISleuth CLI'],
    ['/methodology', 'Evidence methodology'],
    ['/coverage', 'Capability and registry coverage'],
    ['/examples', 'See the output before running a command'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    documentation = page.getByRole('navigation', { name: 'Documentation' });
    await expect(documentation.getByRole('link', { name: path === '/cli' ? 'CLI' : path === '/methodology' ? 'Methodology' : path === '/coverage' ? 'Coverage' : 'Examples', exact: true })).toHaveAttribute('aria-current', 'page');
    if (path !== '/cli') {
      await expect(navigation.getByRole('link', { name: 'Resources' })).toHaveAttribute('aria-current', 'location');
    }
    await expectNoHorizontalOverflow(page);
  }

  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/cli');
  await expect(page.locator('.reference-tree')).toBeVisible();
  await expect(page.locator('.page-sections')).toBeVisible();
  await expect(page.locator('.page-sections').getByRole('link', { name: 'Command reference' })).toHaveAttribute('href', '#commands');
  await expect(page.locator('.public-section-navigation')).toHaveCount(0);
  expect((await page.locator('.reference-document').boundingBox())?.width ?? 0).toBeGreaterThan(800);
  const startNotes = page.locator('.start-notes');
  await expect(startNotes).toHaveCSS('align-items', 'start');
  const installedHelpNote = startNotes.locator(':scope > p');
  const helpNoteHeight = (await installedHelpNote.boundingBox())?.height ?? 0;
  await startNotes.locator('.update-instructions > summary').click();
  expect((await installedHelpNote.boundingBox())?.height ?? 0).toBeCloseTo(helpNoteHeight, 0);
  const behaviourDetails = page.locator('.additional-behaviour > details');
  await expect(page.locator('.additional-behaviour')).toHaveCSS('align-items', 'start');
  const closedBehaviourHeight = (await behaviourDetails.nth(1).boundingBox())?.height ?? 0;
  await behaviourDetails.nth(0).locator(':scope > summary').click();
  expect((await behaviourDetails.nth(1).boundingBox())?.height ?? 0).toBeCloseTo(closedBehaviourHeight, 0);

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator('.reference-tree')).toBeHidden();
  await expect(page.locator('.reference-browser')).toBeVisible();
  await page.locator('.reference-browser > summary').click();
  await expect(page.locator('.reference-browser > nav')).toHaveCSS('align-items', 'start');
  expect((await page.locator('.reference-document').boundingBox())?.width ?? 0).toBeGreaterThan(880);
  await expectNoHorizontalOverflow(page);

  const footer = page.getByRole('navigation', { name: 'Footer' });
  for (const label of ['Privacy', 'Terms', 'Request policy', 'Contact', 'Source and licence']) {
    await expect(footer.getByRole('link', { name: label })).toBeVisible();
  }
  for (const label of ['Overview', 'Demo', 'CLI', 'Resources', 'Methodology', 'Coverage', 'Examples']) {
    await expect(footer.getByRole('link', { name: label, exact: true })).toHaveCount(0);
  }

  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/cli');
  const siteMenu = page.locator('.site-menu');
  await siteMenu.getByText('Menu', { exact: true }).click();
  const mobileNavigation = siteMenu.getByRole('navigation', { name: 'Public navigation' });
  for (const [label, href] of [['Demo', '/demo'], ['Resources', '/resources'], ['CLI', '/cli']] as const) {
    await expect(mobileNavigation.getByRole('link', { name: label, exact: true })).toHaveAttribute('href', href);
  }
  await expect(mobileNavigation.getByRole('link', { name: 'Overview', exact: true })).toHaveCount(0);
  await siteMenu.getByText('Menu', { exact: true }).click();
  await page.getByText('Browse documentation', { exact: true }).click();
  documentation = page.getByRole('navigation', { name: 'Documentation' });
  await expect(documentation.getByRole('link', { name: 'Methodology', exact: true })).toBeVisible();
  await expect(documentation.getByRole('link', { name: 'CLI', exact: true })).toHaveAttribute('aria-current', 'page');
  await expectNoHorizontalOverflow(page);
  expect(investigationRequests).toEqual([]);
});

test('long reference labels remain distinct and the mobile navigator works by keyboard', async ({ page }, testInfo) => {
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    await page.goto('/resources/reporting-and-takedown-guidance');
    for (const viewport of [
      { width: 1280, height: 720 }, { width: 1024, height: 768 },
      { width: 390, height: 844 }, { width: 320, height: 700 },
    ]) {
      await page.setViewportSize(viewport);
      const browser = page.locator('.reference-browser');
      const summary = browser.locator(':scope > summary');
      await expect(summary).toHaveCount(1);
      if (viewport.width > 1080) {
        await expect(browser).toBeHidden();
        await expect(page.locator('.reference-tree').getByRole('link', { name: 'Reporting and takedown guidance', exact: true })).toHaveAttribute('aria-current', 'page');
      } else {
        await expect(summary).toBeVisible();
        await expect(summary.locator('span')).toHaveText('Browse documentation');
        await expect(summary.locator('strong')).toHaveText('Reporting and takedown guidance');
        const geometry = await summary.evaluate((element) => {
          const a = element.querySelector('span')!.getBoundingClientRect();
          const current = element.querySelector('strong')!;
          const b = current.getBoundingClientRect();
          const showsCurrent = getComputedStyle(current).display !== 'none';
          const bounds = element.getBoundingClientRect();
          return {
            separated: !showsCurrent || a.right < b.left || a.bottom < b.top,
            contained: [a, ...(showsCurrent ? [b] : [])].every((box) => box.left >= bounds.left && box.right <= bounds.right && box.bottom <= bounds.bottom),
          };
        });
        expect(geometry.separated).toBe(true);
        expect(geometry.contained).toBe(true);
        await summary.focus();
        await page.keyboard.press('Enter');
        await expect(browser).toHaveAttribute('open', '');
        await expect(browser.getByRole('link', { name: 'Reporting and takedown guidance', exact: true })).toHaveAttribute('aria-current', 'page');
        await expect(summary).toBeFocused();
        await page.keyboard.press('Space');
        await expect(browser).not.toHaveAttribute('open', '');
      }
      await expectNoHorizontalOverflow(page);
      await page.evaluate(() => scrollTo(0, 0));
      if (viewport.width === 320 || viewport.width === 1280) {
        await page.screenshot({ path: testInfo.outputPath(`reference-labels-${viewport.width}-${theme}.png`) });
      }
    }
  }
});

test('reference pages expose the first recipe on mobile and constrain wide prose', async ({ page }) => {
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/cli');
    const firstCommand = page.locator('.start-steps .copyable-command').first();
    await expect(firstCommand.getByRole('button', { name: 'Copy run-once help command' })).toBeVisible();
    await expect(firstCommand.locator('code')).toBeInViewport({ ratio: 1 });
    const copy = firstCommand.getByRole('button', { name: 'Copy run-once help command' });
    await copy.focus();
    await expect(copy).toBeFocused();
    await expect(copy).toBeInViewport({ ratio: 1 });
    await expectNoHorizontalOverflow(page);

    for (const width of [1920, 3840]) {
      await page.setViewportSize({ width, height: 1080 });
      await page.goto('/resources/lookalike-domain-checker');
      const paragraph = page.locator('.reference-heading > p:not(.eyebrow)');
      await expect(paragraph).toContainText('Similar spelling is a lead');
      const proseBox = await paragraph.boundingBox();
      expect(proseBox).not.toBeNull();
      expect(proseBox!.width).toBeLessThanOrEqual(800);
      await expectNoHorizontalOverflow(page);
    }
  }
});

test('filters and opens the canonical CLI catalogue entirely by keyboard', async ({ page }) => {
  const investigationRequests = collectInvestigationRequests(page);
  await page.goto('/cli');
  const catalogue = page.getByTestId('public-cli-catalogue');
  const search = catalogue.getByRole('searchbox', { name: 'Search commands' });
  await search.focus();
  await page.keyboard.type('workflow-plan');
  await expect(search).toBeFocused();
  await expect(catalogue.getByRole('status')).toHaveText(`Showing 1 of ${CLI_COMMANDS.length} commands.`);

  const command = catalogue.locator('article[data-command="workflow-plan"]');
  const open = command.locator(':scope > .command-row > button');
  await open.focus();
  await page.keyboard.press('Enter');
  const workspace = catalogue.locator('article[data-command-detail="workflow-plan"]');
  await expect(workspace).toBeFocused();
  await expect(workspace.locator('.command-detail')).toContainText('Network behaviour');
  await expect(workspace.locator('.command-detail')).toContainText('Schemas');
  await workspace.getByRole('link', { name: /Back to 1 filtered command/u }).click();
  await expect(catalogue.locator('article[data-command="workflow-plan"] .command-open')).toBeFocused();
  await expect(page).toHaveURL(/\?q=workflow-plan#commands$/u);
  await expectNoHorizontalOverflow(page);
  expect(investigationRequests).toEqual([]);
});

test('keeps CLI catalogue filters shareable across reloads', async ({ page }) => {
  await page.goto('/cli?q=workflow&mode=offline&common=1#commands');
  const catalogue = page.getByTestId('public-cli-catalogue');
  await expect(catalogue.getByRole('searchbox', { name: 'Search commands' })).toHaveValue('workflow');
  await expect(catalogue.getByRole('combobox', { name: 'Mode' })).toHaveValue('offline');
  await expect(catalogue.getByRole('checkbox', { name: 'Common commands only' })).toBeChecked();
  const status = catalogue.getByRole('status');
  const before = await status.textContent();
  await page.reload();
  await expect(status).toHaveText(before ?? '');
  await expect(page).toHaveURL(/\?q=workflow&mode=offline&common=1#commands$/u);
});

test('signer trust guidance is reachable by direct command link at supported widths and themes', async ({ page }, testInfo) => {
  const investigationRequests = collectInvestigationRequests(page);
  for (const viewport of [
    { width: 1280, height: 720 }, { width: 1024, height: 768 },
    { width: 390, height: 844 }, { width: 320, height: 700 },
  ]) {
    for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize(viewport);
      await useTheme(page, theme);
      await page.goto('/cli?q=verify-signature#command-verify-signature');
      const detail = page.locator('article[data-command-detail="verify-signature"]');
      await expect(detail).toBeVisible();
      await expect(detail).toContainText('--trust-store-file');
      await expect(detail).toContainText('whoisleuth.evidence-signer-trust-report');
      await expect(detail).toBeFocused();
      await detail.getByText('Operational boundary', { exact: true }).click();
      await expect(detail.locator('.boundary p')).toBeVisible();
      await expect(detail.locator('.boundary p')).toContainText('unknown, retired, revoked or future-reviewed entries exit 4');
      await expectNoHorizontalOverflow(page);
      await testInfo.attach(`signer-trust-${viewport.width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
      await detail.getByRole('link', { name: /Back to 1 filtered command/u }).click();
      await expect(page.locator('article[data-command="verify-signature"] .command-open')).toBeFocused();
    }
  }
  expect(investigationRequests).toEqual([]);
});

test('preserves CLI filter and router state across public Back and Forward navigation', async ({ page }) => {
  await page.goto('/cli');
  const search = page.getByTestId('public-cli-catalogue').getByRole('searchbox', { name: 'Search commands' });
  await search.fill('lookup');
  await expect(page).toHaveURL(/\/cli\?q=lookup$/u);

  await page.getByRole('navigation', { name: 'Public navigation' })
    .getByRole('link', { name: 'Resources', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Guides for common investigation tasks' })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/cli\?q=lookup$/u);
  await expect(page.getByRole('heading', { name: 'WHOISleuth CLI', exact: true })).toBeVisible();
  await expect(page.getByTestId('public-cli-catalogue')).toBeVisible();
  await expect(search).toHaveValue('lookup');

  await page.goForward();
  await expect(page).toHaveURL('/resources');
  await expect(page.getByRole('heading', { name: 'Guides for common investigation tasks' })).toBeVisible();
});

test('opens a directly linked CLI command without loading unrelated command details', async ({ page }) => {
  const investigationRequests = collectInvestigationRequests(page);
  await page.goto('/cli#command-workflow-plan');
  const catalogue = page.getByTestId('public-cli-catalogue');
  const command = catalogue.locator('article[data-command-detail="workflow-plan"]');
  await expect(command).toBeVisible();
  await expect(command.locator('.command-detail')).toContainText('Limits and contracts');
  await expect(catalogue.locator('.command-detail')).toHaveCount(1);
  await expect.poll(async () => {
    const commandBox = await command.boundingBox();
    const filtersBox = await catalogue.locator('.filters').boundingBox();
    return commandBox && filtersBox
      ? commandBox.y >= filtersBox.y + filtersBox.height
      : false;
  }).toBe(true);
  await expectNoHorizontalOverflow(page);
  expect(investigationRequests).toEqual([]);
});

test('command and return links preserve open-in-new-tab activation @timing-sensitive', async ({ page, context }) => {
  await page.goto('/cli#command-lookup');
  const command = page.locator('[data-command-detail="lookup"]');
  await expect(command).toBeVisible();
  for (const link of [command.locator('.related-commands a').first(), command.locator('.back-to-results')]) {
    await page.bringToFront();
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toMatch(/^#(?:command-|commands)/u);
    const expectedHref = new URL(href!, page.url()).href;
    const expectedDetail = href!.startsWith('#command-') ? href!.slice('#command-'.length) : null;
    const [destination] = await Promise.all([
      context.waitForEvent('page'),
      link.click({ modifiers: ['ControlOrMeta'] }),
    ]);
    try {
      // Activate the tab before checking its hydrated content; background
      // load-event timing is not part of the link's navigation contract.
      await destination.bringToFront();
      // Read the actual document and usable destination together. The string
      // URL matcher also waits for engine navigation bookkeeping, which can
      // remain pending after this native modified-click destination is ready.
      await expect.poll(() => destination.evaluate(() => ({
        href: location.href,
        ready: document.readyState,
        clientReady: document.querySelector('[data-testid="public-cli-catalogue"]')?.getAttribute('data-client-ready'),
        detail: document.querySelector('[data-command-detail]')?.getAttribute('data-command-detail') ?? null,
      }))).toEqual({ href: expectedHref, ready: 'complete', clientReady: 'true', detail: expectedDetail });
    } finally {
      await destination.close();
      await page.bringToFront();
    }
    await expect(page).toHaveURL(/#command-lookup$/u);
    await expect(command).toBeVisible();
  }
});

test('command details distinguish an artefact from its presentation and destination', async ({ page }) => {
  await page.goto('/cli#command-export');
  const command = page.locator('[data-command-detail="export"]');
  await expect(command).toBeVisible();
  await expect(command.locator('.command-facts')).toContainText('Portable evidence report');
  const formats = command.locator('dt').filter({ hasText: /^Presentation options$/u }).locator('..');
  await expect(formats).toContainText('--markdown');
  await expect(formats).toContainText('--html');
  await expect(formats).not.toContainText('--json');
  await expect(command.locator('.command-facts')).toContainText('--output <file>');
  await command.getByText('Limits and contracts', { exact: true }).click();
  await expect(command.locator('.contract-details')).toContainText('Exit 0 reports command completion');
});

test('distinguishes compact and metadata CSV in responsive command details', async ({ page }, testInfo) => {
  const requests = collectInvestigationRequests(page);
  for (const commandId of ['bulk', 'discover-scan']) {
    await page.goto(`/cli#command-${commandId}`);
    const command = page.locator(`[data-command-detail="${commandId}"]`);
    await expect(command).toBeVisible();
    const presentations = command.locator('dt').filter({ hasText: /^Presentation options$/u }).locator('..');
    await expect(presentations.getByText('--csv', { exact: true })).toBeVisible();
    await expect(presentations.getByText('--csv-with-metadata', { exact: true })).toBeVisible();
    await command.getByText('Operational boundary', { exact: true }).click();
    const boundary = command.locator('.boundary p');
    await expect(boundary).toContainText('separate observation and report times');
    await expect(boundary).toContainText('--csv retains the compact columns');
    if (commandId !== 'bulk') continue;
    for (const viewport of [
      { width: 1280, height: 720 }, { width: 1024, height: 768 },
      { width: 390, height: 844 }, { width: 320, height: 700 },
    ]) {
      await page.setViewportSize(viewport);
      for (const theme of ['light', 'dark'] as const) {
        await useTheme(page, theme);
        await presentations.scrollIntoViewIfNeeded();
        await expect(presentations).toBeInViewport();
        await expectNoHorizontalOverflow(page);
        await testInfo.attach(`csv-options-${viewport.width}-${theme}`, {
          body: await page.screenshot(), contentType: 'image/png',
        });
        await boundary.scrollIntoViewIfNeeded();
        await expect(boundary).toBeInViewport();
        await expectNoHorizontalOverflow(page);
      }
    }
  }
  expect(requests).toEqual([]);
});

test('opens a directly linked CLI workflow section after the responsive layout settles', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/cli#browser-handoff');
  const handoff = page.locator('#browser-handoff');
  await expect(handoff).toBeVisible();
  await expect.poll(async () => {
    const box = await handoff.boundingBox();
    return box ? box.y >= 0 && box.y < 220 : false;
  }).toBe(true);
  await expectNoHorizontalOverflow(page);
});

test('keeps workflow partial-result and resume guidance readable across reference layouts', async ({ page }, testInfo) => {
  const requests = collectInvestigationRequests(page);
  await page.goto('/cli#command-workflow-run');
  const detail = page.locator('article[data-command-detail="workflow-run"]');
  await expect(detail).toBeVisible();
  await expect(detail.locator('details.boundary')).toHaveJSProperty('open', true);
  const boundary = detail.locator('details.boundary > p');
  await expect(boundary).toBeVisible();
  await expect(boundary).toContainText(/Partial collections pause for review.*not recollected.*resume/u);
  await expect(boundary).toContainText('failed validation or export steps remain retryable');
  await expect(boundary).toContainText(/diagnostics go to stderr/iu);
  await expect(boundary).toContainText('--use-artifact <step-id>:<input-number>=<earlier-step-id>');
  await expect(boundary).toContainText('Repeat --select for remaining placeholders in order');
  await expect(boundary).toContainText(/not (?:proof of )?authenticity or freshness/u);
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 768 },
    { width: 390, height: 844 }, { width: 320, height: 700 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      await boundary.scrollIntoViewIfNeeded();
      await expect(boundary).toBeInViewport();
      await expectNoHorizontalOverflow(page);
      await testInfo.attach(`workflow-artifact-${viewport.width}-${theme}`, {
        body: await page.screenshot(), contentType: 'image/png',
      });
    }
  }
  expect(requests).toEqual([]);
});

test('reveals related CLI commands even when the current filters exclude them', async ({ page }) => {
  await page.goto('/cli');
  const catalogue = page.getByTestId('public-cli-catalogue');
  const search = catalogue.getByRole('searchbox', { name: 'Search commands' });
  await search.fill('lookup');
  const source = catalogue.locator('article[data-command="lookup"]');
  await source.locator(':scope > .command-row > button').click();
  const sourceDetail = catalogue.locator('article[data-command-detail="lookup"]');
  const related = sourceDetail.locator('.related-commands a').first();
  const targetId = (await related.getAttribute('href'))?.replace('#command-', '') ?? '';
  expect(targetId).not.toBe('');
  await related.click();
  await expect(search).toHaveValue('');
  const target = catalogue.locator(`article[data-command-detail="${targetId}"]`);
  await expect(target).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#command-${targetId}$`, 'u'));
});

test('keeps the final CLI section current at the end of the document', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/cli');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const contents = page.locator('.page-sections');
  await expect(contents.getByRole('link', { name: 'More documentation' })).toHaveAttribute('aria-current', 'location');
});

test('renders methodology and deferred coverage from fixed metadata without requests', async ({ page }, testInfo) => {
  const investigationRequests = collectInvestigationRequests(page);
  await page.goto('/methodology');
  await expect(page.locator('.topic-grid article')).toHaveCount(PUBLIC_METHODOLOGY.topics.length);
  await expect(page.getByRole('heading', { name: 'Authority-aware registration decisions' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Deliberate non-inferences' })).toBeVisible();
  const authority = page.locator('.topic-grid article').filter({ has: page.getByRole('heading', { name: 'Authority-aware registration decisions' }) });
  await expect(authority).toContainText('positive authoritative DNS delegation can support registered status at medium confidence');
  await expect(authority).toContainText('Missing DNS never proves availability');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const viewport of [
      { width: 1280, height: 720 }, { width: 1024, height: 768 },
      { width: 390, height: 844 }, { width: 320, height: 700 },
    ]) {
      await page.setViewportSize(viewport);
      await authority.scrollIntoViewIfNeeded();
      await expect(authority).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (viewport.width === 320 || viewport.width === 1280) {
        await page.screenshot({ path: testInfo.outputPath(`registration-authority-${viewport.width}-${theme}.png`) });
      }
    }
  }

  await page.goto('/coverage');
  await expect(page.locator('.distinction-grid article')).toHaveCount(PUBLIC_COVERAGE_SUMMARY.distinctions.length);
  const open = page.getByRole('button', { name: 'Open capability catalogue' });
  await open.focus();
  await page.keyboard.press('Enter');
  const catalogue = page.getByTestId('public-coverage-catalogue');
  await expect(catalogue).toBeVisible();
  await expect(catalogue.getByRole('status')).toContainText('implemented capability families');
  await catalogue.getByRole('checkbox', { name: 'Optional or configuration-dependent only' }).check();
  await expect(catalogue.getByRole('status')).not.toContainText('Showing 32 of 32');
  expect(investigationRequests).toEqual([]);
});

test('contains an optional chunk preload failure without a page error', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const coverageChunkPath = productionChunkPath('src/lib/components/PublicCoverageCatalogue.svelte');
  const isCoverageChunk = (url: string) => {
    const pathname = new URL(url).pathname;
    return pathname === coverageChunkPath;
  };
  await page.route('**/*', (route) => (isCoverageChunk(route.request().url())
    ? route.fulfill({ status: 200, contentType: 'text/javascript', body: 'globalThis.__coverageFailureEvaluated = true; throw new Error("synthetic chunk failure");' })
    : route.fallback()));
  const failedChunk = page.waitForRequest((request) => isCoverageChunk(request.url()));
  await page.goto('/coverage');
  await page.getByRole('button', { name: 'Open capability catalogue' }).hover();
  await failedChunk;
  await page.waitForFunction(() => Reflect.get(window, '__coverageFailureEvaluated') === true);
  await page.getByRole('button', { name: 'Open capability catalogue' }).click();
  await expect(page.getByRole('alert')).toContainText('Capability details could not be loaded.');
  expect(pageErrors).toEqual([]);
});

test('opens, filters and downloads a large synthetic example without workspace access', async ({ page }) => {
  const investigationRequests = collectInvestigationRequests(page);
  await page.goto('/examples');
  const before = await page.evaluate(async () => ({
    local: Object.keys(localStorage).sort(),
    session: Object.keys(sessionStorage).sort(),
    workspace: (await indexedDB.databases()).some((database) => database.name === 'whoisleuth-browser-data-v1'),
  }));
  expect(before.workspace).toBe(false);

  const gallery = page.getByTestId('public-example-gallery');
  const exampleCards = gallery.locator('article[data-example]');
  await expect(exampleCards).toHaveCount(4);
  await expect(exampleCards.getByRole('button', { name: 'Open synthetic output' })).toHaveCount(4);
  for (const button of await exampleCards.getByRole('button', { name: 'Open synthetic output' }).all()) {
    await expect(button).not.toHaveAttribute('aria-controls');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  }
  await expect(gallery.locator('.example-grid')).toHaveCSS('align-items', 'start');
  const unchangedPeerHeight = (await exampleCards.nth(1).boundingBox())?.height ?? 0;
  await exampleCards.nth(0).getByRole('button', { name: 'Open synthetic output' }).click();
  await expect(exampleCards.nth(0).getByRole('textbox')).toBeVisible();
  expect((await exampleCards.nth(1).boundingBox())?.height ?? 0).toBeCloseTo(unchangedPeerHeight, 0);
  await gallery.getByLabel('Format').selectOption('JSON');
  await expect(gallery.locator('article[data-example]')).toHaveCount(1);
  const example = gallery.locator('article[data-example="case-handoff"]');
  const disclosure = example.getByRole('button', { name: 'Open synthetic output' });
  await disclosure.focus();
  await page.keyboard.press('Enter');
  const output = example.getByRole('textbox', { name: 'Importable public Case handoff synthetic output' });
  await expect(output).toHaveValue(/"schema": "whoisleuth\.cli\.case-pack"/u);
  await expect(output).toHaveValue(/"domain": "example\.test"/u);
  await expect(output).toHaveValue(/"digestSha256": "sha256:[a-f0-9]{64}"/u);
  await expect(example.getByRole('button', { name: 'Close synthetic output' })).toHaveAttribute('aria-controls', 'example-output-case-handoff');
  await expect(example.locator('#example-output-case-handoff')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await example.getByRole('button', { name: 'Download example' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('synthetic-reviewed-case-handoff.json');
  await example.getByRole('button', { name: 'Close synthetic output' }).click();
  await expect(example.locator('#example-output-case-handoff')).toHaveCount(0);
  await expect(example.getByRole('button', { name: 'Open synthetic output' })).not.toHaveAttribute('aria-controls');

  const after = await page.evaluate(async () => ({
    local: Object.keys(localStorage).sort(),
    session: Object.keys(sessionStorage).sort(),
    workspace: (await indexedDB.databases()).some((database) => database.name === 'whoisleuth-browser-data-v1'),
  }));
  expect(after).toEqual(before);
  expect(investigationRequests).toEqual([]);
});

test('uses Investigate, Respond and Assure as the only top-level product jobs', async ({ page }) => {
  const investigationRequests = collectInvestigationRequests(page);
  await page.goto('/');
  await expect(page.getByText('Investigate · Respond · Assure', { exact: true })).toBeVisible();
  await expect(page.getByTestId('practical-workflow')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Start with the work in front of you' })).toBeVisible();

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.getByTestId('practical-workflow')).toHaveCount(0);
  const navigation = page.getByRole('navigation', { name: 'Console', exact: true });
  for (const job of ['Investigate', 'Respond', 'Assure']) {
    await expect(navigation.getByRole('group', { name: job, exact: true })).toBeVisible();
  }
  await expect(navigation.getByRole('group', { name: /^(Verify|Package|Recheck)$/u })).toHaveCount(0);
  expect(investigationRequests).toEqual([]);
});

test('keeps privacy detail on the policy page and links to it from resources', async ({ page }) => {
  const investigationRequests = collectInvestigationRequests(page);
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy policy', exact: true })).toBeVisible();
  const compatibility = page.locator('p').filter({ has: page.getByText('Compatibility.', { exact: true }) });
  await expect(compatibility).toBeVisible();
  await expect(compatibility).toContainText('remain readable');
  await expect(page.getByTestId('privacy-data-flow-summary')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name: 'Privacy' })).toHaveAttribute('aria-current', 'page');

  await page.goto('/resources');
  const privacySection = page.locator('#privacy');
  await expect(privacySection.getByRole('heading', { name: 'Privacy and data handling' })).toBeVisible();
  await expect(privacySection.getByRole('link', { name: /Read the privacy policy/u })).toHaveAttribute('href', '/privacy');
  await expect(page.getByTestId('privacy-data-flow-summary')).toHaveCount(0);
  expect(investigationRequests).toEqual([]);
});
