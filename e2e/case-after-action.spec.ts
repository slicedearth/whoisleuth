import { expect, test } from './fixtures';
import { createCase, openCasesView, openCaseResponseWorkspace } from './case-test-fixtures';
import { openCaseSection } from './console-navigation';
import { expectNoHorizontalOverflow, failNextBrowserLocalManifestWrite, readBrowserLocalCollection, useTheme } from './helpers';

test('after-action reviews retain failed drafts and save once through the Case coordinator', async ({ page }, testInfo) => {
  await page.clock.setFixedTime('2026-09-13T10:00:00.000Z');
  await openCasesView(page); await createCase(page, 'lessons.example');
  await openCaseResponseWorkspace(page);
  await openCaseSection(page, 'History');
  const region = page.getByRole('region', { name: 'Case after-action review', exact: true });
  const summary = region.locator('summary');
  await summary.focus(); await summary.press('Enter');
  const form = region.locator('form');
  await form.getByRole('button', { name: 'Save review as a note', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('at least one lesson');
  await form.getByLabel('Which evidence was useful?', { exact: true }).fill('The dated original observation.');
  await form.getByLabel('What should change next time?', { exact: true }).fill('Record contradictory evidence earlier.');
  await expect(form.getByRole('status')).toContainText('Draft saved in this workspace');
  const before = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value;
  await failNextBrowserLocalManifestWrite(page, 'cases');
  await form.getByRole('button', { name: 'Save review as a note', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Case workspace action status', exact: true })).toContainText('out of storage space');
  await expect(form.getByLabel('Which evidence was useful?', { exact: true })).toHaveValue('The dated original observation.');
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value).toEqual(before);
  await form.getByRole('button', { name: 'Save review as a note', exact: true }).click();
  await expect(form.getByLabel('Which evidence was useful?', { exact: true })).toHaveValue('');
  const after = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value;
  expect(after.notes).toHaveLength(1);
  expect(after.notes[0]!.body).toBe('After-action review\n\nWhich evidence was useful?\nThe dated original observation.\n\nWhat should change next time?\nRecord contradictory evidence earlier.');
  expect(after.disposition).toBe(before.disposition);
  expect(after.actions).toEqual(before.actions);
  expect((await readBrowserLocalCollection(page, 'case_drafts')).records).toHaveLength(0);
  await expect(form.getByRole('button', { name: 'Save review as a note', exact: true })).toBeFocused();
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const [width, height] of [[320, 700], [1280, 720]] as const) {
      await page.setViewportSize({ width, height });
      await expectNoHorizontalOverflow(page);
      await summary.evaluate(element => element.scrollIntoView({ block: 'center' }));
      await page.screenshot({ path: testInfo.outputPath(`after-action-${theme}-${width}.png`), fullPage: true });
    }
  }
});
