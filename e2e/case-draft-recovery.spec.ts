import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { createCase, openCasesView, openCaseResponseWorkspace } from './case-test-fixtures';
import { openCaseSection } from './console-navigation';
import { expectNoHorizontalOverflow, failNextBrowserLocalManifestWrite, migrateLegacyBrowserData, readBrowserLocalCollection, useTheme } from './helpers';
import { downloadWorkspaceArchive, workspaceArchiveRegion } from './workspace-backup';
import { caseStoreAtCapacity } from '../test/workspace-backup-capacity-fixture.mts';
import { beginBrowserInteractionReadiness, readBrowserInteractionReadiness } from './performance-sampling';

async function pinForm(page: Page) {
  const workspace = await openCaseResponseWorkspace(page);
  await openCaseSection(page, 'Evidence');
  const details = workspace.locator('details').filter({ has: page.getByText('Pin an observed fact', { exact: true }) });
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
  return details.locator('form').first();
}

test('Case drafts recover after reload, stay out of backups and clear atomically on submission', async ({ page }, testInfo) => {
  await openCasesView(page); await createCase(page, 'draft-recovery.example');
  let form = await pinForm(page);
  await form.getByLabel('Label', { exact: true }).fill('Unsubmitted fixture evidence');
  await form.getByLabel('Fact', { exact: true }).fill('Private unfinished reasoning, not yet evidence.');
  await expect(form.getByRole('status')).toContainText('Draft saved in this workspace');
  const selected = page.url();
  const stored = await readBrowserLocalCollection(page, 'case_drafts', { minimumRecords: 1 });
  expect(stored.records).toHaveLength(1);
  await page.reload(); form = await pinForm(page);
  await expect(form.getByLabel('Label', { exact: true })).toHaveValue('');
  await form.getByText('1 saved draft for this form', { exact: true }).click();
  await form.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await expect(form.getByLabel('Label', { exact: true })).toHaveValue('Unsubmitted fixture evidence');
  for (const [width, height] of [[1280, 720], [1024, 768], [390, 844], [320, 700]] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme); await expectNoHorizontalOverflow(page);
      await expect(form.getByRole('button', { name: 'Discard this draft' })).toBeVisible();
      if (width === 320 || width === 1280) await form.screenshot({ path: testInfo.outputPath(`case-draft-${theme}-${width}.png`) });
    }
  }
  expect((await new AxeBuilder({ page }).include('.case-response-stage').analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Dashboard', exact: true }).click();
  const backup = await downloadWorkspaceArchive(page);
  expect(backup.content).not.toContain('Private unfinished reasoning');
  expect(backup.content).not.toContain('case_drafts');
  await page.goto(selected); form = await pinForm(page);
  await form.getByText('1 saved draft for this form', { exact: true }).click();
  await form.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await form.getByRole('button', { name: 'Pin evidence', exact: true }).click();
  await expect(form.getByLabel('Fact', { exact: true })).toHaveValue('');
  expect((await readBrowserLocalCollection(page, 'case_drafts')).records).toHaveLength(0);
  const cases = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  expect(cases.records[0]?.value.evidencePins).toHaveLength(1);
});

test('a failed recovery save protects navigation and can be retried without submitting evidence', async ({ page }) => {
  await openCasesView(page); await createCase(page, 'failed-draft.example');
  const form = await pinForm(page); const selected = page.url();
  await failNextBrowserLocalManifestWrite(page, 'case_drafts');
  await form.getByLabel('Label', { exact: true }).fill('Keep this unfinished form');
  await expect(form.getByRole('status')).toContainText('could not be saved for recovery');
  let dialogs = 0;
  page.on('dialog', async dialog => { await dialog.dismiss(); dialogs++; });
  await openCaseSection(page, 'Response');
  await openCaseSection(page, 'Evidence');
  expect(dialogs).toBe(0);
  await page.getByRole('link', { name: 'All Cases', exact: true }).click();
  await expect.poll(() => dialogs).toBe(1); await expect(page).toHaveURL(selected);
  await expect(form.getByLabel('Label', { exact: true })).toHaveValue('Keep this unfinished form');
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect.poll(() => dialogs).toBe(2); await expect(page).toHaveURL(selected);
  await form.getByRole('button', { name: 'Retry recovery save', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('Draft saved in this workspace');
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]?.value.evidencePins).toHaveLength(0);
  await page.getByRole('link', { name: 'All Cases', exact: true }).click();
  await expect(page).not.toHaveURL(selected); expect(dialogs).toBe(2);
});

test('storage estimates are independent of explicit retention requests and backup preparation', async ({ page }) => {
  await page.addInitScript(() => {
    let requests = 0;
    Object.defineProperty(navigator, 'storage', { configurable: true, value: {
      persisted: async () => false, estimate: async () => ({ usage: 2 * 1024 * 1024, quota: 20 * 1024 * 1024 }),
      persist: async () => { requests++; return false; },
    } });
    Object.defineProperty(window, '__persistenceRequests', { get: () => requests });
  });
  await openCasesView(page); await createCase(page, 'backup-health.example');
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Dashboard', exact: true }).click();
  await downloadWorkspaceArchive(page);
  const archive = workspaceArchiveRegion(page);
  const health = archive.locator('.storage-health');
  await health.locator('summary').click();
  await expect(health).toContainText('2 MiB');
  await expect(health).toContainText('20 MiB');
  await expect(health).not.toContainText('None recorded');
  expect(await page.evaluate(() => (window as unknown as { __persistenceRequests: number }).__persistenceRequests)).toBe(0);
  await health.getByRole('button', { name: 'Request persistent storage', exact: true }).click();
  await expect(health.getByRole('status')).toContainText('did not grant persistent storage');
  expect(await page.evaluate(() => (window as unknown as { __persistenceRequests: number }).__persistenceRequests)).toBe(1);
  await page.setViewportSize({ width: 320, height: 700 }); await expectNoHorizontalOverflow(page);
});

test('deleting a Case also removes its unsubmitted recovery copies', async ({ page }) => {
  await openCasesView(page); await createCase(page, 'delete-draft.example');
  const form = await pinForm(page);
  await form.getByLabel('Label', { exact: true }).fill('Delete this recovery copy with its Case');
  await expect(form.getByRole('status')).toContainText('Draft saved in this workspace');
  await page.locator('.case-more > summary').click();
  page.once('dialog', dialog => { void dialog.accept(); });
  await page.getByRole('button', { name: 'Delete case', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cases', exact: true })).toBeVisible();
  expect((await readBrowserLocalCollection(page, 'cases')).records).toHaveLength(0);
  expect((await readBrowserLocalCollection(page, 'case_drafts')).records).toHaveLength(0);
});

test('action metadata and transition drafts keep independent targets through selection and recovery', async ({ page }) => {
  await openCasesView(page); await createCase(page, 'action-recovery.example');
  async function actionStage() {
    const workspace = await openCaseResponseWorkspace(page, '', 'advanced', 'Response');
    const stage = workspace.getByRole('region', { name: 'Case response actions', exact: true });
    const details = stage.locator(':scope > details');
    if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
    return stage;
  }
  let stage = await actionStage();
  for (const recipient of ['First fixture desk', 'Second fixture desk']) {
    await stage.getByLabel('Recipient or internal owner', { exact: true }).fill(recipient);
    await stage.getByRole('button', { name: 'Create drafting action', exact: true }).click();
    await expect(stage.getByLabel('Recipient or internal owner', { exact: true })).toHaveValue('');
  }
  const stored = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  const actions = stored.records[0]!.value.actions as { id: string; recipient: string }[];
  const first = actions.find(action => action.recipient === 'First fixture desk')!.id;
  const second = actions.find(action => action.recipient === 'Second fixture desk')!.id;
  await stage.getByRole('combobox', { name: 'Action metadata', exact: true }).selectOption(first);
  await stage.getByLabel(/Contact limitations/).fill('Unsubmitted metadata for the first desk');
  await stage.getByRole('combobox', { name: 'Action for transition', exact: true }).selectOption(first);
  await stage.getByLabel('Bounded reference', { exact: true }).fill('first-desk-event-reference');
  await expect(stage.locator('.draft-recovery[data-recovery-form="action-transition"]')).toHaveAttribute('data-recovery-status', 'saved');
  await stage.getByRole('combobox', { name: 'Action metadata', exact: true }).selectOption(second);
  await expect(stage.getByLabel('Recipient or internal owner', { exact: true })).toHaveValue('Second fixture desk');
  await expect(stage.getByLabel('Bounded reference', { exact: true })).toHaveValue('first-desk-event-reference');
  await page.reload(); stage = await actionStage();
  const metadata = stage.locator('.draft-recovery[data-recovery-form="action-details"]');
  await metadata.locator('summary').click(); await metadata.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await expect(stage.getByRole('combobox', { name: 'Action metadata', exact: true })).toHaveValue(first);
  await expect(stage.getByLabel(/Contact limitations/)).toHaveValue('Unsubmitted metadata for the first desk');
  await expect(stage.locator('form[data-recovery-form="action-transition"]')).toHaveCount(0);
  const transition = stage.locator('.draft-recovery[data-recovery-form="action-transition"]');
  await transition.locator('summary').click(); await transition.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await expect(stage.getByRole('combobox', { name: 'Action for transition', exact: true })).toHaveValue(first);
  await expect(stage.getByLabel('Bounded reference', { exact: true })).toHaveValue('first-desk-event-reference');
});

test('recovery saves retain a full-capacity Case workspace without rewriting its evidence', async ({ page }, testInfo) => {
  test.slow();
  const source = caseStoreAtCapacity();
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': source }, {
    clearStorage: true, destination: '/cases?case=capacity-case-0&section=evidence',
  });
  const form = await pinForm(page);
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 500 });
  const samples = [];
  for (let sample = 0; sample < 3; sample++) {
    const tasks = await page.evaluateHandle(() => {
      const durations: number[] = [];
      const observer = PerformanceObserver.supportedEntryTypes.includes('longtask')
        ? new PerformanceObserver(list => { durations.push(...list.getEntries().map(entry => entry.duration)); }) : null;
      observer?.observe({ type: 'longtask' });
      return { finish() {
        durations.push(...(observer?.takeRecords() ?? []).map(entry => entry.duration));
        observer?.disconnect();
        return observer ? durations : null;
      } };
    });
    await beginBrowserInteractionReadiness(page, {
      start: { event: 'input', selector: 'form[data-recovery-form="evidence-pin"] input' },
      targets: [{ selector: 'form[data-recovery-form="evidence-pin"] [data-recovery-status="saved"] [role="status"]', exactText: 'Draft saved in this workspace. Not yet added to the Case.' }],
    });
    await form.getByLabel('Label', { exact: true }).fill(`Capacity recovery sample ${sample}`);
    await expect(form.getByRole('status')).toContainText('Draft saved in this workspace');
    samples.push({ ...await readBrowserInteractionReadiness(page), longTasksMs: await tasks.evaluate(probe => probe.finish()) });
    expect((await readBrowserLocalCollection(page, 'case_drafts', { minimumRecords: 1 })).records[0]?.value.fields.pinLabel).toBe(`Capacity recovery sample ${sample}`);
    await tasks.dispose();
  }
  const after = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 500 });
  expect(after.manifest.revision).toBe(before.manifest.revision);
  expect(after.manifest.digest).toBe(before.manifest.digest);
  expect((await readBrowserLocalCollection(page, 'case_drafts', { minimumRecords: 1 })).records).toHaveLength(1);
  await testInfo.attach('case-draft-capacity-measurements', { body: JSON.stringify({ samples, scope: 'Input through durable recovery, including the debounce; local observations, not timing gates.' }), contentType: 'application/json' });
});
