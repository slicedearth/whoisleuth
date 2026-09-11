import { readFile, rm, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, openBrandProfileList, openBrandWorkbench, readBrowserLocalCollection, useTheme } from './helpers';
import { assertBrandProfileStoreBudget, buildBrandProfileExport, normalizeBrandProfile } from '../packages/workspace/brand-profile-model.mts';
import { MAX_PROFILE_IMPORT_BYTES, MAX_PROFILE_STORE_BYTES, serialiseWorkspacePortableJson } from '../packages/contracts/workspace-portability.mts';
import { brandProfileStoreAtBytes, denseBrandHistoryStore, richBrandHistoryProfiles } from '../test/brand-profile-capacity-fixture.mts';
import { beginBrowserInteractionReadiness, readBrowserInteractionReadiness } from './performance-sampling';
import { productionChunkPath } from './production-build';

const NOW = '2026-09-09T00:00:00.000Z';

async function selectProfileFile(page: Page, content: string | Uint8Array, verify: () => Promise<void>) {
  const path = test.info().outputPath('profile-import.json');
  await writeFile(path, content, { flag: 'wx' });
  try {
    await page.getByLabel('Import JSON', { exact: true }).setInputFiles(path);
    await verify();
  } finally { await rm(path, { force: true }); }
}

async function measureImport(page: Page, expectedStatus: string, content: string) {
  await beginBrowserInteractionReadiness(page, {
    start: { event: 'change', selector: 'input[type="file"]' },
    targets: [
      { selector: '[role="status"][aria-label="Brand Profile action status"]', exactText: expectedStatus },
      { selector: 'input[type="file"]', visibility: 'attached', requireEnabled: true },
    ],
  });
  const session = await page.context().newCDPSession(page);
  const beforeHeap = await session.send('Runtime.getHeapUsage');
  const observer = await page.evaluateHandle(() => {
    const tasks: { start: number; end: number }[] = [];
    let overflow = false;
    const collect = (entries: readonly PerformanceEntry[]) => { for (const entry of entries) { if (tasks.length >= 1_000) { overflow = true; continue; } tasks.push({ start: entry.startTime, end: entry.startTime + entry.duration }); } };
    const supported = PerformanceObserver.supportedEntryTypes.includes('longtask');
    const probe = supported ? new PerformanceObserver((list) => collect(list.getEntries())) : null;
    probe?.observe({ type: 'longtask' });
    return { close: () => probe?.disconnect(), finish: (interval: { startedAtMs: number; readyAtMs: number }) => {
      collect(probe?.takeRecords() ?? []);
      probe?.disconnect();
      const overlaps = tasks.map((task) => Math.max(0, Math.min(task.end, interval.readyAtMs) - Math.max(task.start, interval.startedAtMs))).filter((duration) => duration > 0);
      return { longTaskCount: supported ? overlaps.length : null, longestTaskOverlapMs: supported ? Math.max(0, ...overlaps) : null, totalLongTaskOverlapMs: supported ? overlaps.reduce((sum, duration) => sum + duration, 0) : null, taskProbeOverflow: overflow };
    } };
  });
  try {
    await selectProfileFile(page, content, async () => {
      // Completion uses the bounded workflow deadline, not the default short
      // assertion timeout. The observed import duration remains informational.
      await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toHaveText(expectedStatus, { timeout: test.info().timeout });
      const ready = await readBrowserInteractionReadiness(page);
      const work = await observer.evaluate((probe, interval) => probe.finish(interval), ready);
      const afterHeap = await session.send('Runtime.getHeapUsage');
      expect(work.taskProbeOverflow).toBe(false);
      await test.info().attach('profile-import-measurement', { body: JSON.stringify({ ...ready, ...work, heapBeforeBytes: beforeHeap.usedSize, heapAfterBytes: afterHeap.usedSize, peakHeapAvailable: false, memoryScope: 'sampled main JavaScript isolate, not peak or total process memory', clock: 'file-change-through-committed-refresh-and-usable-control', timingAcceptance: 'informational' }), contentType: 'application/json' });
    });
  } finally {
    await observer.evaluate((probe) => probe.close()).catch(() => undefined);
    await observer.dispose();
    await session.detach();
  }
}

test('rich Brand histories import, render and export without dropping captured records', async ({ page }) => {
  test.slow(); // Import, eight rendered view/theme combinations, export and reload.
  const profiles = assertBrandProfileStoreBudget(richBrandHistoryProfiles(2)).profiles;
  await page.goto('/brands');
  const input = page.getByLabel('Import JSON', { exact: true });
  await expect(input).toBeEnabled();
  await measureImport(page, 'Imported 2 new and 0 updated profiles.', serialiseWorkspacePortableJson(buildBrandProfileExport(profiles, NOW)));
  const stored = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 2 });
  expect(isDeepStrictEqual(stored.records.map((record) => record.value), profiles)).toBe(true);
  await page.getByRole('radio', { name: 'Set Capacity profile 0 active', exact: true }).check();
  await openBrandWorkbench(page, 'portfolio');
  const matrix = page.getByRole('region', { name: 'Owned-domain comparison', exact: true });
  await expect(matrix.locator('tbody tr')).toHaveCount(20);
  const history = matrix.locator('[id="retained-posture-observation-domain-0-0.example"]');
  await history.locator(':scope > summary').focus();
  await history.locator(':scope > summary').press('Enter');
  const captures = history.locator('summary').filter({ hasText: /^Capture /u });
  await expect(captures).toHaveCount(12);
  await captures.first().focus();
  await captures.first().press('Enter');
  await expect(captures.first()).toBeFocused();
  const records = history.locator('pre').filter({ hasText: /^ns-0\./u }).first();
  await expect(records).toBeVisible();
  await expect(records).toContainText('ns-63.');
  expect((await records.innerText()).split('\n')).toHaveLength(64);
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      await history.locator(':scope > summary').scrollIntoViewIfNeeded();
      await expect(records).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await test.info().attach(`history-${viewport.width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
    }
  }
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const download = await pendingDownload;
  const path = await download.path();
  expect(path).not.toBeNull();
  const exported = JSON.parse(await readFile(path!, 'utf8'));
  expect(isDeepStrictEqual(exported.profiles, profiles)).toBe(true);
  await page.reload();
  await openBrandProfileList(page);
  await expect(page.getByRole('radio', { name: 'Set Capacity profile 0 active', exact: true })).toBeChecked();
  expect(isDeepStrictEqual((await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 2 })).records.map((record) => record.value), profiles)).toBe(true);
});

test('a complete profile collection rejects an over-capacity import without changing saved records', async ({ page }) => {
  const store = brandProfileStoreAtBytes(MAX_PROFILE_STORE_BYTES);
  await page.goto('/brands');
  const input = page.getByLabel('Import JSON', { exact: true });
  await expect(input).toBeEnabled();
  await measureImport(page, 'Imported 100 new and 0 updated profiles.', serialiseWorkspacePortableJson(buildBrandProfileExport(store.profiles, NOW)));
  const status = page.getByRole('status', { name: 'Brand Profile action status' });
  await expect(status).toHaveText('Imported 100 new and 0 updated profiles.');
  const before = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 100 });
  expect(isDeepStrictEqual(before.records.map((record) => record.value), store.profiles)).toBe(true);
  const tooLarge = brandProfileStoreAtBytes(MAX_PROFILE_STORE_BYTES + 1);
  await selectProfileFile(page, serialiseWorkspacePortableJson(buildBrandProfileExport(tooLarge.profiles, NOW)), () => expect(status).toContainText('storage is full'));
  const after = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 100 });
  expect(isDeepStrictEqual(after, before)).toBe(true);
  await selectProfileFile(page, Buffer.alloc(MAX_PROFILE_IMPORT_BYTES + 1, ' '), () => expect(status).toContainText(`Profile imports are limited to ${MAX_PROFILE_IMPORT_BYTES / 1024 / 1024} MiB.`));
  expect(isDeepStrictEqual(await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 100 }), before)).toBe(true);
});

test('dense formatted histories remain importable with no omitted profiles', async ({ page }) => {
  const store = denseBrandHistoryStore();
  const document = serialiseWorkspacePortableJson(buildBrandProfileExport(store.profiles, NOW));
  expect(Buffer.byteLength(document)).toBeGreaterThan(16 * 1024 * 1024);
  await page.goto('/brands');
  const input = page.getByLabel('Import JSON', { exact: true });
  await expect(input).toBeEnabled();
  await measureImport(page, `Imported ${store.profiles.length} new and 0 updated profiles.`, document);
  const saved = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: store.profiles.length });
  expect(isDeepStrictEqual(saved.records.map((record) => record.value), store.profiles)).toBe(true);
});

test('concurrent imports retain both distinct profiles through the current collection revision', async ({ page, context }) => {
  const other = await context.newPage();
  try {
    const pages = [page, other];
    await Promise.all(pages.map(async (target) => {
      await target.goto('/brands');
      await expect(target.getByLabel('Import JSON', { exact: true })).toBeEnabled();
    }));
    await Promise.all(pages.map(async (target, index) => {
      const profile = normalizeBrandProfile({ id: `import-${index}`, name: `Imported profile ${index}`, createdAt: NOW, updatedAt: NOW });
      expect(profile).not.toBeNull();
      const content = serialiseWorkspacePortableJson(buildBrandProfileExport([profile], NOW));
      await target.getByLabel('Import JSON', { exact: true }).setInputFiles({ name: `profile-${index}.json`, mimeType: 'application/json', buffer: Buffer.from(content) });
      await expect(target.getByRole('status', { name: 'Brand Profile action status' })).toHaveText('Imported 1 new and 0 updated profiles.');
    }));
    const saved = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 2 });
    expect(saved.records.map((record) => record.id).sort()).toEqual(['import-0', 'import-1']);
  } finally { await other.close(); }
});

test('held or failed file preparation cannot claim a save and allows a deliberate retry', async ({ page }) => {
  await useTheme(page, 'system');
  await page.goto('/brands');
  const input = page.getByLabel('Import JSON', { exact: true });
  await expect(input).toBeEnabled();
  const before = await readBrowserLocalCollection(page, 'brand_profiles');
  const profile = normalizeBrandProfile({ id: 'held-import', name: 'Held import', createdAt: NOW, updatedAt: NOW });
  const content = serialiseWorkspacePortableJson(buildBrandProfileExport([profile], NOW));
  const pattern = `**${productionChunkPath('src/lib/workers/browser-local-data.worker.ts')}`;
  let held = 0;
  let release = () => {};
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  await page.route(pattern, async (route) => { held += 1; await barrier; await route.abort('failed'); });
  const status = page.getByRole('status', { name: 'Brand Profile action status' });
  try {
    await selectProfileFile(page, content, async () => {
      await expect.poll(() => held).toBe(1);
      await expect(status).toHaveText('Importing Brand Profiles…');
      await expect(input).toBeDisabled();
      await expect(page.getByRole('button', { name: 'New profile', exact: true })).toBeDisabled();
      expect(await readBrowserLocalCollection(page, 'brand_profiles')).toEqual(before);
      for (const viewport of [
        { width: 1280, height: 720 }, { width: 1024, height: 768 },
        { width: 390, height: 844 }, { width: 320, height: 700 },
      ]) for (const theme of ['light', 'dark'] as const) {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: theme });
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(status).toBeInViewport({ ratio: 1 });
        await expectNoHorizontalOverflow(page);
        await test.info().attach(`profile-import-pending-${viewport.width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
      }
      release();
      await expect(status).toContainText('worker is unavailable. No changes were saved.');
      await expect(input).toBeEnabled();
      expect(await readBrowserLocalCollection(page, 'brand_profiles')).toEqual(before);
    });
  } finally { release(); await page.unroute(pattern); }
  await selectProfileFile(page, content, () => expect(status).toHaveText('Imported 1 new and 0 updated profiles.'));
  const saved = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  expect(saved.manifest.revision).toBe(before.manifest.revision + 1);
  expect(saved.records[0]!.value).toEqual(profile);
});

test('leaving Brands cancels held file preparation before the collection can change', async ({ page }) => {
  await page.goto('/brands');
  await expect(page.getByLabel('Import JSON', { exact: true })).toBeEnabled();
  const before = await readBrowserLocalCollection(page, 'brand_profiles');
  const profile = normalizeBrandProfile({ id: 'cancelled-import', name: 'Cancelled import', createdAt: NOW, updatedAt: NOW });
  const pattern = `**${productionChunkPath('src/lib/workers/browser-local-data.worker.ts')}`;
  let held = 0;
  let release = () => {};
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  await page.route(pattern, async (route) => { held += 1; await barrier; await route.abort('failed'); });
  try {
    await selectProfileFile(page, serialiseWorkspacePortableJson(buildBrandProfileExport([profile], NOW)), async () => {
      await expect.poll(() => held).toBe(1);
      await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toHaveText('Importing Brand Profiles…');
      await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: /^Dashboard(?:\s|$)/u }).click();
      await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
      release();
    });
  } finally { release(); await page.unroute(pattern); }
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: /^Brands(?:\s|$)/u }).click();
  await expect(page.getByLabel('Import JSON', { exact: true })).toBeEnabled();
  expect(await readBrowserLocalCollection(page, 'brand_profiles')).toEqual(before);
  await expect(page.getByRole('radio', { name: 'Set Cancelled import active', exact: true })).toHaveCount(0);
});

test('an unavailable preparation module leaves the collection readable and gives a reload recovery', async ({ page }) => {
  await page.goto('/brands');
  const input = page.getByLabel('Import JSON', { exact: true });
  await expect(input).toBeEnabled();
  const before = await readBrowserLocalCollection(page, 'brand_profiles');
  const profile = normalizeBrandProfile({ id: 'module-import', name: 'Module recovery', createdAt: NOW, updatedAt: NOW });
  const content = serialiseWorkspacePortableJson(buildBrandProfileExport([profile], NOW));
  const pattern = `**${productionChunkPath('src/lib/browser-local-data-preparation.ts')}`;
  let failed = 0;
  await page.route(pattern, async (route) => {
    failed += 1;
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: 'throw new Error("Synthetic local preparation module failure");' });
  });
  try {
    await selectProfileFile(page, content, async () => {
      await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('No changes were saved. Reload this page to request the unavailable module again.');
      expect(failed).toBeGreaterThan(0);
      await expect(input).toBeEnabled();
      expect(await readBrowserLocalCollection(page, 'brand_profiles')).toEqual(before);
    });
  } finally { await page.unroute(pattern); }
  await page.reload();
  await expect(input).toBeEnabled();
  await selectProfileFile(page, content, () => expect(page.getByRole('status', { name: 'Brand Profile action status' })).toHaveText('Imported 1 new and 0 updated profiles.'));
});

test('failed refresh after a profile import preserves the committed records and offers refresh rather than another write', async ({ page }) => {
  await page.goto('/brands');
  await expect(page.getByLabel('Import JSON', { exact: true })).toBeEnabled();
  const before = await readBrowserLocalCollection(page, 'brand_profiles');
  const profiles = assertBrandProfileStoreBudget(richBrandHistoryProfiles(2)).profiles;
  await page.evaluate(() => {
    let writes = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === 'manifests' && value && typeof value === 'object' && Reflect.get(value, 'collection') === 'brand_profiles') writes += 1;
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
    Object.defineProperty(window, '__profileImportWrites', { configurable: true, get: () => writes });
  });
  const pattern = `**${productionChunkPath('src/lib/workers/browser-local-data.worker.ts')}`;
  let rejected = 0;
  await page.route(pattern, async (route) => {
    if (await page.evaluate(() => Number(Reflect.get(window, '__profileImportWrites')) > 0)) {
      rejected += 1; await route.abort('failed');
    } else await route.fallback();
  });
  try {
    await selectProfileFile(page, serialiseWorkspacePortableJson(buildBrandProfileExport(profiles, NOW)), async () => {
      const status = page.getByRole('status', { name: 'Brand Profile action status' });
      await expect(status).toContainText('Imported 2 new and 0 updated profiles.');
      await expect(page.getByRole('button', { name: 'Refresh saved profiles', exact: true })).toBeEnabled();
      await expect(page.getByLabel('Import JSON', { exact: true })).toBeDisabled();
      expect(rejected).toBeGreaterThan(0);
      expect(await page.evaluate(() => Number(Reflect.get(window, '__profileImportWrites')))).toBe(1);
      const saved = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 2 });
      expect(saved.manifest.revision).toBe(before.manifest.revision + 1);
      expect(isDeepStrictEqual(saved.records.map((record) => record.value), profiles)).toBe(true);
    });
  } finally { await page.unroute(pattern); }
  await page.getByRole('button', { name: 'Refresh saved profiles', exact: true }).click();
  await expect(page.getByLabel('Import JSON', { exact: true })).toBeEnabled();
  expect(await page.evaluate(() => Number(Reflect.get(window, '__profileImportWrites')))).toBe(1);
});
