import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, openBulkWorkspaceTools, readBrowserLocalCollection, runBulkScan, selectBulkResultView, useTheme } from './helpers';

test('saved Bulk columns survive reload without collecting targets or dropping result evidence', async ({ page }, testInfo) => {
  let requests = 0;
  await page.route('**/api/lookup?*', async (route) => {
    requests += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      availability: { applicable: true, domain: 'columns.example', state: 'registered', confidence: 'high' },
      diagnostics: { version: 7, rdap: { status: 'complete' }, whois: { status: 'skipped' }, availability: { status: 'complete' } },
    }) });
  });
  await page.goto('/bulk');
  await runBulkScan(page, ['columns.example']);
  await selectBulkResultView(page, 'List');
  const picker = page.locator('.column-picker');
  await picker.locator('summary').click();
  const registration = picker.getByRole('checkbox', { name: 'Registration', exact: true });
  await registration.focus();
  await page.keyboard.press('Space');
  await expect(registration).not.toBeChecked();
  await expect(registration).toBeFocused();
  await picker.getByRole('checkbox', { name: 'Registrar', exact: true }).uncheck();
  const row = page.locator('.results-table tbody tr');
  await expect(row).toHaveCount(1);
  await expect(row.locator('td[data-label="Registration"]')).toHaveCount(0);
  await expect(row.locator('td[data-label="Registrar"]')).toHaveCount(0);
  await expect(row.locator('td[data-label="Risk"]')).toHaveCount(1);
  await expect(row.locator('td[data-label="Domain"]')).toContainText('columns.example');
  await expect(row.getByRole('button', { name: 'Inspect', exact: true })).toBeVisible();
  await openBulkWorkspaceTools(page, 'review');
  await page.getByRole('textbox', { name: 'New view name' }).fill('Evidence columns');
  await page.getByRole('button', { name: 'Save current view', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Bulk review action status', exact: true })).toContainText('Saved');
  const store = await readBrowserLocalCollection(page, 'bulk_review', { minimumRecords: 1 });
  const preset = store.records.find((record) => record.value.kind === 'preset');
  expect(preset?.value.kind).toBe('preset');
  if (preset?.value.kind !== 'preset') throw new Error('The view was not persisted.');
  expect(preset.value.view.columns).toEqual(['risk', 'website', 'mutation', 'review', 'case']);
  expect(JSON.stringify(preset)).not.toContain('columns.example');
  await page.reload();
  await openBulkWorkspaceTools(page, 'review');
  await page.getByRole('combobox', { name: 'Saved Bulk review view' }).selectOption({ label: 'Evidence columns' });
  await page.getByRole('button', { name: 'Load view', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Bulk review action status', exact: true })).toContainText('No scan was started');
  expect(requests).toBe(1);
  await runBulkScan(page, ['columns.example']);
  await selectBulkResultView(page, 'List');
  await expect(row.locator('td[data-label="Registration"]')).toHaveCount(0);
  await picker.locator('summary').click();
  await expect(picker.getByRole('checkbox', { name: 'Registration', exact: true })).not.toBeChecked();
  for (const width of [320, 390, 1024, 1280, 2560, 3840]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      await picker.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      if (width >= 1024) {
        const wrappedLabels = await page.locator('.results-table th,.results-table .draft-actions .inspect').evaluateAll(elements => elements.filter(element => {
          const range = document.createRange(); range.selectNodeContents(element.querySelector('button') ?? element);
          const lines = new Set([...range.getClientRects()].filter(rect => rect.height > 0).map(rect => Math.round(rect.top)));
          return lines.size > 1;
        }).map(element => element.textContent));
        expect(wrappedLabels).toEqual([]);
      }
      for (const input of await picker.getByRole('checkbox').all()) {
        await expect(input).toBeVisible();
        const geometry = await input.evaluate((element) => {
          const control = element.getBoundingClientRect(), owner = element.closest('fieldset')!.getBoundingClientRect();
          return { within: control.left >= owner.left && control.right <= owner.right };
        });
        expect(geometry.within).toBe(true);
      }
      if ([320, 1280, 3840].includes(width)) await testInfo.attach(`columns-${width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await picker.getByRole('button', { name: 'Show all columns' }).click();
  await expect(row.locator('td[data-label="Registration"]')).toContainText('registered');
  expect(requests).toBe(2);
});
