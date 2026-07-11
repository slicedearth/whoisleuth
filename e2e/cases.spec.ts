import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, runBulkScan } from './helpers';

// Every domain here is a local/invalid value (RFC 2606 .invalid, or dotless
// bad-domain-* that classifyQuery rejects with a 400). Case features are
// entirely browser-local: creating and editing a case never reaches an
// upstream service, and the shared fixture's network guard enforces that.

async function openCasesView(page: import('@playwright/test').Page) {
  await page.goto('/monitor');
  await page.getByRole('tab', { name: /Cases/ }).click();
}

async function createCase(page: import('@playwright/test').Page, domain: string) {
  await page.locator('#new-case').fill(domain);
  await page.getByRole('button', { name: 'Open case' }).click();
  await expect(page.locator('.case-head', { hasText: domain })).toBeVisible();
}

test('a case created from Monitor persists across a reload', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'tracked.invalid');

  await expect(page.getByRole('status')).toHaveText(/Opened a new case for tracked\.invalid/);
  const head = page.locator('.case-head', { hasText: 'tracked.invalid' });
  await expect(head.locator('.badge').first()).toHaveText('New');
  await expect(head.locator('.badge').nth(1)).toHaveText('Unreviewed');

  await page.reload();
  await page.getByRole('tab', { name: /Cases/ }).click();
  await expect(page.locator('.case-head', { hasText: 'tracked.invalid' })).toBeVisible();
});

test('status and disposition edits persist across a reload', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'triage.invalid');

  await page.locator('.case-body .field-grid select').first().selectOption('escalated');
  await page.locator('.case-body .field-grid select').nth(1).selectOption('confirmed_abuse');

  const head = page.locator('.case-head', { hasText: 'triage.invalid' });
  await expect(head.locator('.badge').first()).toHaveText('Escalated');
  await expect(head.locator('.badge').nth(1)).toHaveText('Confirmed abuse');

  await page.reload();
  await page.getByRole('tab', { name: /Cases/ }).click();
  const reloaded = page.locator('.case-head', { hasText: 'triage.invalid' });
  await expect(reloaded.locator('.badge').first()).toHaveText('Escalated');
  await expect(reloaded.locator('.badge').nth(1)).toHaveText('Confirmed abuse');
});

test('a note can be added and is shown in the record', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'notes.invalid');

  await page.locator('.case-body .note-edit textarea').fill('Cloned login form observed.');
  await page.locator('.case-body').getByRole('button', { name: 'Add note' }).click();

  await expect(page.locator('.case-body .notes li')).toHaveCount(1);
  await expect(page.locator('.case-body .notes li')).toContainText('Cloned login form observed.');

  await page.reload();
  await page.getByRole('tab', { name: /Cases/ }).click();
  await expect(page.locator('.case-head', { hasText: 'notes.invalid' }).locator('small')).toHaveText('1 note');
});

test('deleting a case removes it after confirmation', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'delete.invalid');

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('.case-body').getByRole('button', { name: 'Delete case' }).click();

  await expect(page.locator('.case-head', { hasText: 'delete.invalid' })).toHaveCount(0);
  await expect(page.getByText('No cases yet')).toBeVisible();
});

test('a case file imports and merges through the Cases toolbar', async ({ page }) => {
  await openCasesView(page);
  const payload = {
    version: 1,
    exportedAt: '2026-05-01T00:00:00.000Z',
    cases: [
      {
        id: 'import-1',
        domain: 'imported.invalid',
        status: 'monitoring',
        disposition: 'suspicious',
        tags: ['imported'],
        notes: [{ id: 'n1', body: 'From an exported file.', createdAt: '2026-05-01T00:00:00.000Z' }],
        source: 'manual',
        evidence: null,
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      },
    ],
  };
  await page.locator('#panel-cases input[type="file"]').setInputFiles({
    name: 'cases.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload)),
  });

  await expect(page.getByRole('status')).toHaveText(/Imported 1 new/);
  const head = page.locator('.case-head', { hasText: 'imported.invalid' });
  await expect(head).toBeVisible();
  await expect(head.locator('.badge').first()).toHaveText('Monitoring');
});

test('filtering by status narrows the visible cases', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'first.invalid');
  await createCase(page, 'second.invalid');
  await page.locator('.case-body .field-grid select').first().selectOption('resolved');

  await page.locator('.case-filters select').first().selectOption('resolved');
  await expect(page.locator('.case-head')).toHaveCount(1);
  await expect(page.locator('.case-head', { hasText: 'second.invalid' })).toBeVisible();
});

test('the Cases view has no horizontal overflow on a short mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 560 });
  await openCasesView(page);
  await createCase(page, 'mobile.invalid');
  await page.locator('.case-body .note-edit textarea').fill('A fairly long note that should wrap rather than push the layout wider than the viewport.');
  await expectNoHorizontalOverflow(page);
});

test('the Lookup query prefills from the q parameter for case navigation', async ({ page }) => {
  await page.goto('/lookup?q=lookmeup.invalid');
  await expect(page.locator('#query')).toHaveValue('lookmeup.invalid');
});

test.describe('cases from Bulk', () => {
  test.use({ allowExpectedBulkLookup400Noise: true });

  // These domains are syntactically valid hostnames (so the case store's strict
  // normalizer accepts them), but classifyQuery does NOT reject a .invalid TLD -
  // it would attempt a real RDAP/WHOIS lookup. So the lookup endpoint is
  // intercepted in the browser and fulfilled locally with the same 400 the
  // server returns for a rejected query: the request never leaves the page, and
  // no upstream service is contacted.
  const bulkDomains = ['bad-domain-1.invalid', 'bad-domain-2.invalid'];

  test('a case opened from a Bulk row appears in Monitor and marks the row', async ({ page }) => {
    await page.route('**/api/lookup**', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Rejected in test', errorCode: 'INVALID_QUERY' }),
      }),
    );

    await page.goto('/bulk');
    await runBulkScan(page, bulkDomains);

    const caseCell = page.locator('td[data-label="Case"]').first();
    await caseCell.getByRole('button', { name: /Case/ }).click();
    // The button is replaced by a disposition control plus an Open link.
    await expect(caseCell.locator('select.case-disp')).toBeVisible();
    await expect(caseCell.getByRole('link', { name: 'Open' })).toBeVisible();

    await page.goto('/monitor');
    await page.getByRole('tab', { name: /Cases/ }).click();
    await expect(page.locator('.case-head', { hasText: 'bad-domain-1.invalid' })).toBeVisible();
    await expect(page.locator('.case-head', { hasText: 'bad-domain-1.invalid' }).locator('.badge').first()).toHaveText('New');
  });
});
