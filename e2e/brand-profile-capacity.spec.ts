import { readFile, rm, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, openBrandWorkbench, readBrowserLocalCollection, useTheme } from './helpers';
import { assertBrandProfileStoreBudget, buildBrandProfileExport } from '../packages/workspace/brand-profile-model.mts';
import { MAX_PROFILE_IMPORT_BYTES, MAX_PROFILE_STORE_BYTES, serialiseWorkspacePortableJson } from '../packages/contracts/workspace-portability.mts';
import { brandProfileStoreAtBytes, denseBrandHistoryStore, richBrandHistoryProfiles } from '../test/brand-profile-capacity-fixture.mts';
import { beginBrowserInteractionReadiness, readBrowserInteractionReadiness } from './performance-sampling';

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
      await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toHaveText(expectedStatus);
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
