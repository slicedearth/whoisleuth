import type { Page, Route } from '@playwright/test';

import { CLI_COMMANDS } from '../cli/command-reference.mts';
import { CASE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/case-model';
import { caseRecord } from './case-test-fixtures';
import { ALLOWED_ORIGIN, expect, test } from './fixtures';
import { expectNoHorizontalOverflow, migrateLegacyBrowserData } from './helpers';
import { productionChunkPath } from './production-build';
import {
  beginBrowserInteractionReadiness,
  installNavigationReadinessMark,
  isBrowserInteractionReadinessMarked,
  isNavigationReadinessMarked,
  readBrowserInteractionReadiness,
  readNavigationReadinessMark,
} from './performance-sampling';

const CASES_KEY = 'whois-rdap-cases-v1';

function isChunk(route: Route, pathname: string): boolean {
  return new URL(route.request().url()).pathname === pathname;
}

async function failChunkOnce(page: Page, pathname: string): Promise<() => number> {
  let requestCount = 0;
  await page.route('**/*', async (route) => {
    if (!isChunk(route, pathname)) {
      await route.fallback();
      return;
    }
    requestCount += 1;
    if (requestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: 'throw new Error("Synthetic deferred module failure");',
      });
      return;
    }
    await route.fallback();
  });
  return () => requestCount;
}

async function waitForAnimationFrames(page: Page, count = 3): Promise<void> {
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    throw new TypeError('The animation-frame control must remain between one and ten frames.');
  }
  await page.evaluate(async (frameCount) => new Promise<void>((resolve) => {
    let remaining = frameCount;
    const next = (): void => {
      remaining -= 1;
      if (remaining === 0) resolve();
      else requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  }), count);
}

test('CLI navigation readiness waits for working client-side filtering', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  let releaseScripts = () => {};
  const scriptsReleased = new Promise<void>((resolve) => { releaseScripts = resolve; });
  let heldScriptCount = 0;

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== ALLOWED_ORIGIN
      || request.resourceType() !== 'script'
      || !url.pathname.startsWith('/_app/')) {
      await route.fallback();
      return;
    }
    heldScriptCount += 1;
    await scriptsReleased;
    await route.fallback();
  });

  await installNavigationReadinessMark(page, [
    { selector: 'h1', exactText: 'WHOISleuth CLI' },
    { selector: '.filters input[type="search"]', requireEnabled: true },
    { selector: '[data-testid="public-cli-catalogue"][data-client-ready="true"]' },
  ]);

  try {
    await page.goto('/cli', { waitUntil: 'commit' });
    await expect.poll(() => heldScriptCount, {
      message: 'waiting for at least one application script to be held',
      timeout: 5_000,
    }).toBeGreaterThan(0);
    const catalogue = page.getByTestId('public-cli-catalogue');
    const search = catalogue.getByRole('searchbox', { name: 'Search commands' });
    const status = catalogue.getByRole('status');
    await expect(page.getByRole('heading', { name: 'WHOISleuth CLI', exact: true })).toBeVisible();
    await expect(search).toBeVisible();
    await expect(search).toBeEnabled();
    await expect(catalogue).toHaveAttribute('data-client-ready', 'false');
    await waitForAnimationFrames(page);
    expect(await isNavigationReadinessMarked(page)).toBe(false);

    // The enabled prerendered control accepts DOM input, but cannot update its
    // result set until the component's client handlers are installed.
    await search.fill('workflow-plan');
    await expect(status).toHaveText(`Showing ${CLI_COMMANDS.length} of ${CLI_COMMANDS.length} commands.`);
    expect(await isNavigationReadinessMarked(page)).toBe(false);

    releaseScripts();
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 });
    await expect.poll(() => isNavigationReadinessMarked(page), {
      message: 'waiting for client-owned CLI readiness after releasing scripts',
      timeout: 5_000,
    }).toBe(true);
    expect(await readNavigationReadinessMark(page)).toBeGreaterThan(0);
    await expect(catalogue).toHaveAttribute('data-client-ready', 'true');

    await search.fill('');
    await search.focus();
    await page.keyboard.type('workflow-plan');
    await expect(search).toBeFocused();
    await expect(status).toHaveText(`Showing 1 of ${CLI_COMMANDS.length} commands.`);
    const command = catalogue.locator('article[data-command="workflow-plan"]');
    const open = command.locator(':scope > .command-row > button');
    await expect(open).toBeEnabled();
    await open.focus();
    await page.keyboard.press('Enter');
    const workspace = catalogue.locator('article[data-command-detail="workflow-plan"]');
    await expect(workspace).toBeFocused();
    await workspace.getByRole('link', { name: /Back to 1 filtered command/u }).click();
    await expect(open).toBeFocused();
    await expectNoHorizontalOverflow(page);
    expect(heldScriptCount).toBeGreaterThan(0);
  } finally {
    releaseScripts();
  }
});

test('Case preparation readiness cannot complete while its deferred workspace is held', async ({ page }) => {
  const caseId = 'held-response-preparation';
  const chunkPath = productionChunkPath('src/lib/components/CaseResponseWorkspace.svelte');
  let releaseChunk = () => {};
  const chunkReleased = new Promise<void>((resolve) => { releaseChunk = resolve; });
  let requestSeen = false;

  await page.route('**/*', async (route) => {
    if (!isChunk(route, chunkPath)) {
      await route.fallback();
      return;
    }
    if (!requestSeen) {
      requestSeen = true;
    }
    await chunkReleased;
    await route.fallback();
  });

  try {
    await migrateLegacyBrowserData(page, {
      [CASES_KEY]: {
        version: CASE_SCHEMA_VERSION,
        cases: [caseRecord({ id: caseId, domain: 'held-response.example.test' })],
      },
    }, { clearStorage: true, destination: '/monitor?view=cases' });
    const caseHeading = page.locator(`#case-head-${caseId}`);
    const caseBody = page.locator(`#case-body-${caseId}`);
    const disclosure = page.locator(`#case-response-${caseId}`);
    const summary = disclosure.locator(':scope > summary');
    const responseWorkspace = disclosure.locator('.response-workspace');
    await expect(caseHeading).toBeVisible();
    await expect.poll(() => requestSeen, {
      message: 'waiting for the Case response module request to be held',
      timeout: 5_000,
    }).toBe(true);

    await beginBrowserInteractionReadiness(page, {
      start: { event: 'click', selector: `#case-head-${caseId}` },
      targets: [
        { selector: `#case-body-${caseId}` },
        { selector: `#case-response-${caseId}` },
        { selector: `#case-response-${caseId} .response-workspace`, visibility: 'attached' },
        { selector: `#case-response-${caseId} > summary`, requireEnabled: true },
      ],
    });
    await caseHeading.click();
    await expect(caseBody).toBeVisible();
    await expect(disclosure).toBeVisible();
    await expect(responseWorkspace).toHaveCount(0);
    await waitForAnimationFrames(page);
    expect(await isBrowserInteractionReadinessMarked(page)).toBe(false);

    // Native disclosure is immediate, but a fast reveal cannot substitute for
    // the held preparation phase or manufacture usable response controls.
    await summary.click();
    await expect(disclosure).toHaveAttribute('open', '');
    await expect(responseWorkspace).toHaveCount(0);
    await expect(disclosure.getByRole('button', { name: 'Advanced', exact: true })).toHaveCount(0);
    await waitForAnimationFrames(page);
    expect(await isBrowserInteractionReadinessMarked(page)).toBe(false);

    releaseChunk();
    await expect.poll(() => isBrowserInteractionReadinessMarked(page), {
      message: 'waiting for Case preparation readiness after releasing its workspace',
      timeout: 5_000,
    }).toBe(true);
    expect((await readBrowserInteractionReadiness(page)).browserReadyMs).toBeGreaterThan(0);
    await expect(responseWorkspace).toBeVisible();
    await expect(disclosure.getByRole('button', { name: 'Advanced', exact: true })).toBeEnabled();
    await expectNoHorizontalOverflow(page);
  } finally {
    releaseChunk();
  }
});

test('a pending protected module reaches a terminal reload state and ignores late completion', async ({ page }) => {
  test.slow();
  const chunkPath = productionChunkPath('src/lib/components/WebsiteProfileClusters.svelte');
  let releaseChunk = () => {};
  let markRequested = () => {};
  const requested = new Promise<void>((resolve) => { markRequested = resolve; });
  const held = new Promise<void>((resolve) => { releaseChunk = resolve; });
  let requestSeen = false;

  await page.route('**/*', async (route) => {
    if (!isChunk(route, chunkPath)) {
      await route.fallback();
      return;
    }
    if (!requestSeen) {
      requestSeen = true;
      markRequested();
    }
    await held;
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({
      response,
      body: `globalThis.__whoisleuthLateDeferredChunkEvaluated = true;\n${body}`,
    });
  });

  await page.goto('/monitor');
  await page.getByRole('tab', { name: /^Relationships\b/u }).click();
  await requested;
  const placeholder = page.locator('[data-deferred-placeholder="workspace"]').first();
  await expect(placeholder).toBeVisible();
  expect((await placeholder.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(220);

  const unavailable = page.getByRole('alert').filter({
    hasText: 'Website-profile relationships could not be loaded.',
  });
  await expect(unavailable).toBeVisible({ timeout: 7_000 });
  const surface = unavailable.locator('..');
  await expect(surface).toHaveAttribute('data-deferred-state', 'unavailable');
  await expect(surface).toHaveAttribute('aria-busy', 'false');
  await expect(unavailable.getByRole('button', { name: 'Reload page' })).toBeVisible();

  releaseChunk();
  await page.waitForFunction(() => Reflect.get(globalThis, '__whoisleuthLateDeferredChunkEvaluated') === true);
  await expect(surface).toHaveAttribute('data-deferred-state', 'unavailable');
  await expect(unavailable.getByRole('button', { name: 'Reload page' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('a cached CLI module failure recovers only after the accessible reload action', async ({ page }) => {
  const chunkPath = productionChunkPath('src/lib/generated/public-cli-catalogue.ts');
  const requestCount = await failChunkOnce(page, chunkPath);

  await page.goto('/cli#command-commands');
  const alert = page.getByRole('alert').filter({ hasText: 'Command details are unavailable.' });
  await expect(alert).toBeVisible();
  const command = page.locator('article[data-command="commands"]');
  await expect(command.locator(':scope > .command-row > button')).toBeDisabled();
  await expect(page).toHaveURL(/\/cli#command-commands$/u);

  await alert.getByRole('button', { name: 'Reload page' }).click();
  const workspace = page.locator('article[data-command-detail="commands"]');
  await expect(workspace.locator('.command-detail')).toBeVisible();
  await expect(page).toHaveURL(/\/cli#command-commands$/u);
  expect(requestCount()).toBe(2);
  await expectNoHorizontalOverflow(page);
});

test('public examples and demo stages terminate failed module activation with reload recovery', async ({ page }) => {
  const examplesChunk = productionChunkPath('src/lib/generated/public-examples.ts');
  await failChunkOnce(page, examplesChunk);
  await page.goto('/examples');
  const example = page.locator('article[data-example="case-handoff"]');
  const exampleButton = example.locator(':scope > button');
  await exampleButton.focus();
  await page.keyboard.press('Enter');
  const examplesAlert = page.getByRole('alert').filter({ hasText: 'Synthetic output is unavailable.' });
  await expect(examplesAlert).toBeVisible();
  await expect(examplesAlert.getByRole('button', { name: 'Reload page' })).toBeVisible();
  await expect(exampleButton).toBeDisabled();

  const demoChunk = productionChunkPath('src/lib/components/demo-stages/brands.ts');
  await failChunkOnce(page, demoChunk);
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Begin with Brands' }).click();
  const workspace = page.getByRole('region', { name: 'Brands demo workspace' });
  await expect(workspace.getByRole('alert')).toContainText('This part of the demo could not be loaded.');
  await expect(workspace.getByRole('button', { name: 'Reload page' })).toBeVisible();
  await expect(workspace).toHaveAttribute('aria-busy', 'false');
  await expectNoHorizontalOverflow(page);
});
