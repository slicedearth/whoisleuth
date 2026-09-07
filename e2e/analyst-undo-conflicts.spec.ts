import { expect, test } from './fixtures';
import {
  currentBrowserLocalDocument,
  failNextBrowserLocalManifestWrite,
  holdBrowserLocalTransaction,
  migrateLegacyBrowserData,
  openBulkFilters,
  openBulkWorkspaceTools,
  readBrowserLocalCollection,
  runBulkScan,
} from './helpers';

const DOMAINS = ['undo-a.example', 'undo-b.example'];

test.beforeEach(async ({ context, page }) => {
  // Exercise mutation ordering independently of the separate Undo expiry contract.
  await page.clock.setFixedTime('2026-09-08T00:00:00.000Z');
  await context.route('**/api/lookup?*', async (route) => {
    const domain = new URL(route.request().url()).searchParams.get('q');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      availability: { applicable: true, domain, state: 'registered', confidence: 'high' },
      diagnostics: { version: 7, rdap: { status: 'complete' }, whois: { status: 'skipped' }, availability: { status: 'complete' } },
    }) });
  });
  await page.goto('/bulk');
});

test('a failed saved view retains its name and a completed earlier save preserves later edits', async ({ page }) => {
  await runBulkScan(page, DOMAINS);
  await openBulkWorkspaceTools(page, 'review');
  const views = page.getByRole('region', { name: 'Saved views and review queue' });
  const name = views.getByLabel('New view name');
  await name.fill('Submitted view');
  await failNextBrowserLocalManifestWrite(page, 'bulk_review');
  await views.getByRole('button', { name: 'Save current view' }).click();
  await expect(views.getByRole('status')).toContainText(/storage|quota|save/iu);
  await expect(name).toHaveValue('Submitted view');
  const release = await holdBrowserLocalTransaction(page);
  try {
    await views.getByRole('button', { name: 'Save current view' }).click();
    await expect(views.getByRole('button', { name: 'Save current view' })).toBeDisabled();
    await name.fill('Next view draft');
  } finally {
    await release();
  }
  await expect(views.getByRole('status')).toContainText('Submitted view');
  await expect(name).toHaveValue('Next view draft');
  await expect(views.getByRole('combobox', { name: 'Saved Bulk review view' }).getByRole('option', { name: 'Submitted view' })).toHaveCount(1);
});

test('Bulk review undo preserves a newer row state written in another tab', async ({ page }) => {
  await runBulkScan(page, DOMAINS);
  await openBulkWorkspaceTools(page, 'review');
  const other = await page.context().newPage();
  try {
    await other.goto('/bulk');
    await runBulkScan(other, DOMAINS);
    await openBulkWorkspaceTools(other, 'review');
    await page.getByLabel('Review state for undo-a.example', { exact: true }).selectOption('reviewing');
    const undo = page.getByRole('region', { name: 'Undo analyst change' });
    await expect(undo).toBeVisible();
    await other.getByLabel('Review state for undo-a.example', { exact: true }).selectOption('reviewed');
    await expect.poll(async () => (await readBrowserLocalCollection(other, 'bulk_review')).records.map((entry) => entry.value)).toEqual([
      expect.objectContaining({ domain: 'undo-a.example', state: 'reviewed' }),
    ]);
    await undo.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByText(/Undo was not applied; the newer changes were preserved/u)).toBeVisible();
    const stored = await readBrowserLocalCollection(page, 'bulk_review');
    expect(stored.records.map((entry) => entry.value)).toEqual([expect.objectContaining({ domain: 'undo-a.example', state: 'reviewed' })]);
  } finally {
    await other.close();
  }
});

test('shortlist compensation rejects the whole selection when one member changed', async ({ page }) => {
  await runBulkScan(page, DOMAINS);
  await openBulkFilters(page);
  const other = await page.context().newPage();
  try {
    await other.goto('/bulk');
    await runBulkScan(other, DOMAINS);
    await page.getByRole('button', { name: 'Select matched', exact: true }).click();
    await readBrowserLocalCollection(page, 'shortlist', { minimumRecords: 2 });
    await other.reload();
    await runBulkScan(other, DOMAINS);
    await other.getByRole('button', { name: 'Remove undo-b.example from shortlist', exact: true }).click();
    await expect.poll(async () => (await readBrowserLocalCollection(other, 'shortlist')).records.map((entry) => entry.value.domain)).toEqual(['undo-a.example']);
    await page.getByRole('region', { name: 'Undo analyst change' }).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByText(/Undo was not applied; the newer changes were preserved/u)).toBeVisible();
    const stored = await readBrowserLocalCollection(page, 'shortlist');
    expect(stored.records.map((entry) => entry.value.domain)).toEqual(['undo-a.example']);
  } finally {
    await other.close();
  }
});

test('shortlist undo restores previous values with one atomic manifest write', async ({ page }) => {
  const prior = { domain: DOMAINS[0], scanDepth: 'fast', availability: 'registered', riskModelVersion: 5, riskScore: 42, opportunityScore: 20, mutationTypes: ['omission'], savedAt: '2026-09-01T00:00:00.000Z' };
  await migrateLegacyBrowserData(page, {
    'whois-rdap-shortlist-v1': currentBrowserLocalDocument('shortlist', { entries: [prior] }),
  });
  const original = await readBrowserLocalCollection(page, 'shortlist', { minimumRecords: 1 });
  await runBulkScan(page, DOMAINS);
  await openBulkFilters(page);
  await page.getByRole('button', { name: 'Select matched', exact: true }).click();
  const selected = await readBrowserLocalCollection(page, 'shortlist', { minimumRecords: 2 });
  await page.evaluate(() => {
    const target = window as typeof window & { compensationWrites?: number };
    target.compensationWrites = 0;
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === 'manifests' && value && typeof value === 'object' && Reflect.get(value, 'collection') === 'shortlist') {
        target.compensationWrites = (target.compensationWrites ?? 0) + 1;
        if (target.compensationWrites > 1) throw new DOMException('A second compensation write is unavailable.', 'QuotaExceededError');
      }
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    };
  });
  await page.getByRole('region', { name: 'Undo analyst change' }).getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('Restored the prior shortlist membership for 2 domains.', { exact: true })).toBeVisible();
  const restored = await readBrowserLocalCollection(page, 'shortlist');
  expect(restored.records.map((entry) => entry.value)).toEqual(original.records.map((entry) => entry.value));
  expect(restored.manifest.revision).toBe(selected.manifest.revision + 1);
  expect(await page.evaluate(() => (window as typeof window & { compensationWrites?: number }).compensationWrites)).toBe(1);
});
