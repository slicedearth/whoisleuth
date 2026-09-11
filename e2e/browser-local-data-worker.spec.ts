import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openCaseSection } from './console-navigation';
import { createCase } from '../packages/cases/case-model.mts';
import { currentBrowserLocalDocument, expectNoHorizontalOverflow, migrateLegacyBrowserData, readBrowserLocalCollection, useTheme } from './helpers';
import { productionChunkPath } from './production-build';

const DOMAIN = 'retained-worker-00.example';
async function seed(page: Page) {
  const record = createCase({ domain: DOMAIN, evidencePin: {
    label: 'Retained source fact', value: 'Source-qualified value', source: 'whois', observedAt: null,
  } }, '2026-09-01T00:00:00.000Z');
  const cases = Array.from({ length: 75 }, (_, index) => ({
    ...record, id: `worker-case-${index}`, domain: `retained-worker-${String(index).padStart(2, '0')}.example`,
    evidencePins: Array.from({ length: 40 }, (_, pin) => ({ ...record.evidencePins[0]!, id: `worker-pin-${index}-${pin}` })),
  }));
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': currentBrowserLocalDocument('cases', {
      cases,
    }),
  }, { clearStorage: true, destination: '/cases' });
  await expect(page.locator('.case-head', { hasText: DOMAIN })).toBeVisible();
}

test('held or failed verification never becomes an empty Case collection and a deliberate reload preserves the records', async ({ page }, testInfo) => {
  await useTheme(page, 'system');
  await seed(page);
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  const navigation = page.getByRole('navigation', { name: 'Console', exact: true });
  await navigation.getByRole('link', { name: /^Dashboard(?:\s|$)/u }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  const pattern = `**${productionChunkPath('src/lib/workers/browser-local-data.worker.ts')}`;
  let held = 0;
  let fail = () => {};
  const failed = new Promise<void>((resolve) => { fail = resolve; });
  await page.route(pattern, async (route) => { held += 1; await failed; await route.abort('failed'); });
  try {
    await navigation.getByRole('link', { name: /^Cases(?:\s|$)/u }).click();
    await expect.poll(() => held).toBe(1);
    await expect(page.locator('.local-collection-state')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('heading', { name: 'Loading saved work', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cases unavailable', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'No cases yet', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open or create case', exact: true })).toHaveCount(0);
    for (const viewport of [
      { width: 1280, height: 720 }, { width: 1024, height: 768 },
      { width: 390, height: 844 }, { width: 320, height: 700 },
    ]) for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('.local-collection-state')).toBeInViewport({ ratio: 1 });
      await expectNoHorizontalOverflow(page);
      await testInfo.attach(`retained-loading-${viewport.width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
    }
    fail();
    await expect(page.locator('.local-collection-state')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('heading', { name: 'Cases unavailable', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No cases yet', exact: true })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await testInfo.attach('retained-verification-unavailable', { body: await page.screenshot(), contentType: 'image/png' });
    expect(await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).toEqual(before);
  } finally { fail(); await page.unroute(pattern); }
  await page.reload();
  await expect(page.locator('.case-head', { hasText: DOMAIN })).toBeVisible();
  expect(await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).toEqual(before);
});

test('a verification worker failure after a committed note preserves the write and never offers a duplicate save retry', async ({ page }) => {
  await seed(page);
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  await page.locator('.case-head', { hasText: DOMAIN }).click();
  await openCaseSection(page, 'History');
  await page.evaluate(() => {
    let writes = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === 'manifests' && value && typeof value === 'object' && Reflect.get(value, 'collection') === 'cases') writes += 1;
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
    Object.defineProperty(window, '__caseWrites', { configurable: true, get: () => writes });
  });
  const pattern = `**${productionChunkPath('src/lib/workers/browser-local-data.worker.ts')}`;
  let rejected = 0;
  await page.route(pattern, async (route) => {
    if (await page.evaluate(() => Number(Reflect.get(window, '__caseWrites')) > 0)) {
      rejected += 1;
      await route.abort('failed');
    } else await route.fallback();
  });
  try {
    await page.getByRole('textbox', { name: 'Add note', exact: true }).fill('One committed note.');
    await page.getByRole('button', { name: 'Add note', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Case workspace action status' })).toContainText('The change was saved, but Cases could not be reread.');
    expect(rejected).toBeGreaterThan(0);
    await expect(page.locator('.notes')).toContainText('One committed note.');
    await expect(page.getByRole('textbox', { name: 'Add note', exact: true })).toHaveValue('');
    const committed = await readBrowserLocalCollection(page, 'cases', { minimumRevision: before.manifest.revision + 1 });
    expect(committed.manifest.revision).toBe(before.manifest.revision + 1);
    expect(committed.records[0]!.value.notes).toHaveLength(1);
    expect(await page.evaluate(() => Number(Reflect.get(window, '__caseWrites')))).toBe(1);
  } finally { await page.unroute(pattern); }
  await page.reload();
  await expect(page.getByRole('heading', { name: DOMAIN, exact: true })).toBeVisible();
  const after = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  expect(after.manifest.revision).toBe(before.manifest.revision + 1);
  expect(after.records[0]!.value.notes).toMatchObject([{ body: 'One committed note.' }]);
});
