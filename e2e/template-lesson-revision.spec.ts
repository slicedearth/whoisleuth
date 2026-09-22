import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { createCase, openCasesView, openCaseResponseWorkspace } from './case-test-fixtures';
import { openCaseSection } from './console-navigation';
import { expectNoHorizontalOverflow, failNextBrowserLocalManifestWrite, openDashboardSecondaryWorkspaces, readBrowserLocalCollection, useTheme } from './helpers';

async function prepareLesson(page: Page) {
  await page.clock.setFixedTime('2026-09-20T10:00:00.000Z');
  await openCasesView(page);
  await createCase(page, 'lesson-private.example');
  const caseUrl = page.url();
  await page.goto('/dashboard');
  await openDashboardSecondaryWorkspaces(page);
  await page.getByRole('button', { name: 'New template', exact: true }).click();
  await page.getByLabel('Template name', { exact: true }).fill('Source date review');
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(page.locator('.template-manager .message')).toContainText('Saved the Source date review template.');
  const original = (await readBrowserLocalCollection(page, 'investigation_templates', { minimumRecords: 1 })).records[0]!.value;
  await page.goto(caseUrl);
  await openCaseResponseWorkspace(page);
  await openCaseSection(page, 'History');
  const region = page.getByRole('region', { name: 'Case after-action review', exact: true });
  await region.getByText('Record lessons from this investigation', { exact: true }).click();
  await region.getByLabel('What should change next time?', { exact: true }).fill('Keep the source date separate. Private lesson canary.');
  await region.getByRole('button', { name: 'Save review as a note', exact: true }).click();
  await expect(region.getByLabel('What should change next time?', { exact: true })).toHaveValue('');
  await region.getByText('Use a saved lesson to revise a template', { exact: true }).click();
  await region.getByRole('combobox', { name: 'Saved lesson', exact: true }).selectOption({ index: 1 });
  await region.getByRole('button', { name: 'Revise using lesson', exact: true }).click();
  const editor = region.locator('#investigation-template-editor');
  await editor.getByLabel('When this guidance applies', { exact: true }).fill('Conflicting source dates.');
  await editor.getByLabel('Why this revision is useful', { exact: true }).fill('Separate collection time from observation time.');
  await editor.getByLabel('Instructions, one per line', { exact: true }).first().fill('Compare the source times.');
  await editor.getByLabel('Completion criteria', { exact: true }).first().fill('Each source has its own date or an explicit unavailable state.');
  return { region, editor, original };
}

test('a lesson revision previews exact guidance, preserves failed drafts and saves a distinct private-safe template', async ({ page }, testInfo) => {
  const { region, editor, original } = await prepareLesson(page);
  const save = editor.getByRole('button', { name: 'Save new revision', exact: true });
  await expect(save).toBeDisabled();
  await editor.getByRole('button', { name: 'Preview revision', exact: true }).click();
  const preview = editor.getByRole('region', { name: 'Template revision preview', exact: true });
  await expect(preview).toBeFocused();
  await expect(preview).toContainText('Compare the source times.');
  await expect(preview).not.toContainText('Private lesson canary');
  await expect(save).toBeEnabled();
  await editor.getByLabel('Completion criteria', { exact: true }).first().fill('Record each observation time separately.');
  await expect(save).toBeDisabled();
  await expect(preview).toHaveCount(0);
  await editor.getByRole('button', { name: 'Preview revision', exact: true }).click();
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 768 });
      await expectNoHorizontalOverflow(page);
      expect((await new AxeBuilder({ page }).include('.template-manager').analyze()).violations).toEqual([]);
      if (width === 320 || width === 1280) await editor.screenshot({ path: testInfo.outputPath(`lesson-revision-${theme}-${width}.png`) });
    }
  }
  await failNextBrowserLocalManifestWrite(page, 'investigation_templates');
  await save.click();
  await expect(region.locator('.template-manager .message')).toContainText('out of storage space');
  await expect(editor.getByLabel('Instructions, one per line', { exact: true }).first()).toHaveValue('Compare the source times.');
  expect((await readBrowserLocalCollection(page, 'investigation_templates')).records.map(row => row.value)).toEqual([original]);
  await save.click();
  await expect(editor).toHaveCount(0);
  const values = (await readBrowserLocalCollection(page, 'investigation_templates', { minimumRecords: 2 })).records.map(row => row.value);
  expect(values.find(item => item.id === original.id)).toEqual(original);
  const revision = values.find(item => item.id !== original.id)!;
  expect(revision.lessonRevision).toMatchObject({ parentTemplateId: original.id, canonicalization: 'sorted-json-v2', applicability: 'Conflicting source dates.' });
  expect(revision.stages[0]?.completionCriteria).toBe('Record each observation time separately.');
  expect(revision.stages[0]?.requiresApproval).toBe(true);
  expect(JSON.stringify(revision)).not.toContain('Private lesson canary');
  expect(JSON.stringify(revision)).not.toContain('lesson-private.example');
  await expect(region.locator(`#edit-investigation-template-${revision.id}`)).toBeFocused();
});

test('another tab changing the source blocks revision saving without overwriting either draft or source', async ({ page, context }) => {
  const { region, editor, original } = await prepareLesson(page);
  await editor.getByRole('button', { name: 'Preview revision', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Save new revision', exact: true })).toBeEnabled();
  const other = await context.newPage();
  await other.goto('/dashboard');
  await openDashboardSecondaryWorkspaces(other);
  await other.locator(`#edit-investigation-template-${original.id}`).click();
  await other.getByLabel('Template name', { exact: true }).fill('A concurrent source change');
  await other.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(other.locator('.template-manager .message')).toContainText('Saved the A concurrent source change template.');
  await editor.getByRole('button', { name: 'Save new revision', exact: true }).click();
  await expect(region.getByRole('button', { name: 'Refresh saved templates', exact: true })).toBeVisible();
  await expect(editor.getByLabel('Instructions, one per line', { exact: true }).first()).toHaveValue('Compare the source times.');
  await region.getByRole('button', { name: 'Refresh saved templates', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('source template changed');
  await expect(editor.getByRole('button', { name: 'Save new revision', exact: true })).toBeDisabled();
  const stored = (await readBrowserLocalCollection(page, 'investigation_templates')).records;
  expect(stored).toHaveLength(1);
  expect(stored[0]!.value.label).toBe('A concurrent source change');
  await other.close();
});
