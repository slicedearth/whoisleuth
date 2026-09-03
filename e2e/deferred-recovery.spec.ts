import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page, Route } from '@playwright/test';

import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';

type ClientManifest = Readonly<Record<string, Readonly<{ file?: string }>>>;

async function productionChunk(source: string): Promise<string> {
  const manifest = JSON.parse(await readFile(
    join(process.cwd(), 'frontend', '.svelte-kit', 'output', 'client', '.vite', 'manifest.json'),
    'utf8',
  )) as ClientManifest;
  const file = manifest[source]?.file;
  if (!file) throw new TypeError(`The production manifest does not own ${source}.`);
  return `/${file}`;
}

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

test('a pending protected module reaches a terminal reload state and ignores late completion', async ({ page }) => {
  test.slow();
  const chunkPath = await productionChunk('src/lib/components/WebsiteProfileClusters.svelte');
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
  const chunkPath = await productionChunk('src/lib/generated/public-cli-catalogue.ts');
  const requestCount = await failChunkOnce(page, chunkPath);

  await page.goto('/cli#command-commands');
  const alert = page.getByRole('alert').filter({ hasText: 'Command details are unavailable.' });
  await expect(alert).toBeVisible();
  const command = page.locator('article[data-command="commands"]');
  await expect(command.locator(':scope > .command-row > button')).toBeDisabled();
  await expect(page).toHaveURL(/\/cli#command-commands$/u);

  await alert.getByRole('button', { name: 'Reload page' }).click();
  await expect(command.locator('.command-detail')).toBeVisible();
  await expect(command.locator(':scope > .command-row > button')).toHaveAttribute('aria-expanded', 'true');
  await expect(page).toHaveURL(/\/cli#command-commands$/u);
  expect(requestCount()).toBe(2);
  await expectNoHorizontalOverflow(page);
});

test('public examples and demo stages terminate failed module activation with reload recovery', async ({ page }) => {
  const examplesChunk = await productionChunk('src/lib/generated/public-examples.ts');
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

  const demoChunk = await productionChunk('src/lib/components/demo-stages/brands.ts');
  await failChunkOnce(page, demoChunk);
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Begin with Brands' }).click();
  const workspace = page.getByRole('region', { name: 'Brands demo workspace' });
  await expect(workspace.getByRole('alert')).toContainText('This part of the demo could not be loaded.');
  await expect(workspace.getByRole('button', { name: 'Reload page' })).toBeVisible();
  await expect(workspace).toHaveAttribute('aria-busy', 'false');
  await expectNoHorizontalOverflow(page);
});
