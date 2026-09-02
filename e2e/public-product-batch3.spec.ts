import type { Page, Request } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLI_COMMANDS } from '../cli/command-reference.mts';
import {
  CASE_SCHEMA_VERSION,
  PUBLIC_CASE_SCHEMA_VERSION,
  PUBLISHED_V2_CASE_SCHEMA_VERSION,
} from '../packages/contracts/case-portability.mts';
import { PUBLIC_COVERAGE_SUMMARY } from '../frontend/src/lib/generated/public-coverage-summary.ts';
import { PUBLIC_METHODOLOGY } from '../frontend/src/lib/generated/public-methodology.ts';
import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';

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
  await expect(page.locator('.reference-body.has-sections')).toHaveCount(0);
  await expect(page.locator('.public-section-navigation.inline')).toBeVisible();
  expect((await page.locator('.reference-document-slot').boundingBox())?.width ?? 0).toBeGreaterThan(800);

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator('.reference-tree')).toBeHidden();
  await expect(page.locator('.reference-browser')).toBeVisible();
  expect((await page.locator('.reference-document-slot').boundingBox())?.width ?? 0).toBeGreaterThan(880);
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
  const disclosure = command.locator(':scope > .command-row > button');
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await expect(disclosure).toBeFocused();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(command.locator('.command-detail')).toContainText('Network behaviour');
  await expect(command.locator('.command-detail')).toContainText('Schemas');
  await expectNoHorizontalOverflow(page);
  expect(investigationRequests).toEqual([]);
});

test('opens a directly linked CLI command without loading unrelated command details', async ({ page }) => {
  const investigationRequests = collectInvestigationRequests(page);
  await page.goto('/cli#command-workflow-plan');
  const catalogue = page.getByTestId('public-cli-catalogue');
  const command = catalogue.locator('article[data-command="workflow-plan"]');
  await expect(command.locator(':scope > .command-row > button')).toHaveAttribute('aria-expanded', 'true');
  await expect(command.locator('.command-detail')).toContainText('Limits and contracts');
  await expect(catalogue.locator('.command-detail')).toHaveCount(1);
  await expect.poll(async () => {
    const commandBox = await command.boundingBox();
    const sectionNavigationBox = await page.locator('.public-section-navigation.inline').boundingBox();
    return commandBox && sectionNavigationBox
      ? commandBox.y >= sectionNavigationBox.y + sectionNavigationBox.height
      : false;
  }).toBe(true);
  await expectNoHorizontalOverflow(page);
  expect(investigationRequests).toEqual([]);
});

test('reveals related CLI commands even when the current filters exclude them', async ({ page }) => {
  await page.goto('/cli');
  const catalogue = page.getByTestId('public-cli-catalogue');
  const search = catalogue.getByRole('searchbox', { name: 'Search commands' });
  await search.fill('lookup');
  const source = catalogue.locator('article[data-command="lookup"]');
  await source.locator(':scope > .command-row > button').click();
  const related = source.locator('.related-commands a').first();
  const targetId = (await related.getAttribute('href'))?.replace('#command-', '') ?? '';
  expect(targetId).not.toBe('');
  await related.click();
  await expect(search).toHaveValue('');
  const target = catalogue.locator(`article[data-command="${targetId}"]`);
  await expect(target).toBeVisible();
  await expect(target.locator(':scope > .command-row > button')).toHaveAttribute('aria-expanded', 'true');
  await expect(page).toHaveURL(new RegExp(`#command-${targetId}$`, 'u'));
});

test('keeps the final CLI section current at the end of the document', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/cli');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const contents = page.getByRole('navigation', { name: 'WHOISleuth CLI sections' });
  await expect(contents.getByRole('link', { name: 'More documentation' })).toHaveAttribute('aria-current', 'location');
});

test('renders methodology and deferred coverage from fixed metadata without requests', async ({ page }) => {
  const investigationRequests = collectInvestigationRequests(page);
  await page.goto('/methodology');
  await expect(page.locator('.topic-grid article')).toHaveCount(PUBLIC_METHODOLOGY.topics.length);
  await expect(page.getByRole('heading', { name: 'Authority-aware registration decisions' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Deliberate non-inferences' })).toBeVisible();

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
  const builtManifest = JSON.parse(
    readFileSync(join(process.cwd(), 'frontend', '.svelte-kit', 'output', 'client', '.vite', 'manifest.json'), 'utf8'),
  ) as Record<string, { file: string }>;
  const coverageChunkPath = builtManifest['src/lib/components/PublicCoverageCatalogue.svelte']?.file;
  if (!coverageChunkPath) throw new TypeError('The production manifest does not own the capability catalogue chunk.');
  const isCoverageChunk = (url: string) => {
    const pathname = new URL(url).pathname;
    return pathname === `/${coverageChunkPath}`;
  };
  await page.route('**/*', (route) => (isCoverageChunk(route.request().url())
    ? route.fulfill({ status: 200, contentType: 'text/javascript', body: 'throw new Error("synthetic chunk failure");' })
    : route.fallback()));
  const failedChunk = page.waitForRequest((request) => isCoverageChunk(request.url()));
  await page.goto('/coverage');
  await page.getByRole('button', { name: 'Open capability catalogue' }).hover();
  await failedChunk;
  await expect.poll(() => pageErrors).toEqual([]);
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
  await gallery.getByLabel('Format').selectOption('JSON');
  await expect(gallery.locator('article[data-example]')).toHaveCount(1);
  const example = gallery.locator('article[data-example="case-handoff"]');
  const disclosure = example.getByRole('button', { name: 'Open synthetic output' });
  await disclosure.focus();
  await page.keyboard.press('Enter');
  const output = example.getByRole('textbox', { name: 'Reviewed public Case handoff synthetic output' });
  await expect(output).toHaveValue(/"synthetic": true/u);
  await expect(output).toHaveValue(/"domain": "example\.test"/u);

  const downloadPromise = page.waitForEvent('download');
  await example.getByRole('button', { name: 'Download example' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('synthetic-reviewed-case-handoff.json');

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
  await expect(page.getByText('Start or resume Investigate, Respond and Assure work.', { exact: true })).toBeVisible();
  await expect(page.getByText('Verify', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Package', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Recheck', { exact: true })).toHaveCount(0);
  expect(investigationRequests).toEqual([]);
});

test('keeps privacy detail on the policy page and links to it from resources', async ({ page }) => {
  const investigationRequests = collectInvestigationRequests(page);
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy policy', exact: true })).toBeVisible();
  await expect(page.getByText(new RegExp(
    `Current Case schema ${CASE_SCHEMA_VERSION}.*Published v2 Case schema ${PUBLISHED_V2_CASE_SCHEMA_VERSION}.*public v1 Case schema ${PUBLIC_CASE_SCHEMA_VERSION} remain readable`,
    'iu',
  ))).toBeVisible();
  await expect(page.getByTestId('privacy-data-flow-summary')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name: 'Privacy' })).toHaveAttribute('aria-current', 'page');

  await page.goto('/resources');
  const privacySection = page.locator('#privacy');
  await expect(privacySection.getByRole('heading', { name: 'Privacy and data handling' })).toBeVisible();
  await expect(privacySection.getByRole('link', { name: /Read the privacy policy/u })).toHaveAttribute('href', '/privacy');
  await expect(page.getByTestId('privacy-data-flow-summary')).toHaveCount(0);
  expect(investigationRequests).toEqual([]);
});
