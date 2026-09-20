import { expect, test } from './fixtures';
import { caseRecord, openSeededTimelineCase, openCaseResponseWorkspace } from './case-test-fixtures';
import { currentActionFixture, caseWorkspaceActionStatus } from './case-response-fixtures';
import { openCaseSection } from './console-navigation';
import { expectNoHorizontalOverflow, useTheme, readBrowserLocalCollection, failNextBrowserLocalManifestWrite, failNextBrowserLocalCollectionReadAfterWrite } from './helpers';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';

const NOW = '2026-09-10T10:00:00.000Z';
function action(id = 'active') {
  return currentActionFixture({ id, type: 'registrar_report', recipient: `Reviewed recipient ${id}`, contactSource: 'Retained fixture route',
    routeObservedAt: '2026-09-10T09:00:00Z', routeReviewAfter: '2026-09-10T10:01:00Z', contactLimitations: [], dueAt: null,
    targetState: 'acknowledged', reference: 'MANUAL-RECEIPT', followUpAt: '2026-09-10T10:00:30Z', outcome: 'Received for review',
    createdAt: '2026-09-10T09:00:00Z', updatedAt: '2026-09-10T09:30:00Z' });
}

test('the response queue links receipts and questions without inferring removal or starting collection', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date(NOW) });
  let collections = 0;
  await page.route('**/api/lookup', route => { collections++; return route.abort(); });
  const record = caseRecord({ domain: 'queue.example', actions: [action()], assertions: [{ id: 'question', kind: 'next_step',
    statement: 'Is the reported page still observed?', rationale: '', state: 'open', evidencePinIds: [],
    recheck: { targetHostname: 'page.queue.example', baselinePinId: null, conditions: 'Compare the reported page' }, createdAt: NOW, updatedAt: NOW }] });
  await openSeededTimelineCase(page, record.domain, [record], CASE_SCHEMA_VERSION);
  const workspace = await openCaseResponseWorkspace(page, '', 'quick');
  await openCaseSection(page, 'Response');
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  const queue = page.getByRole('region', { name: 'Response and rechecks', exact: true });
  const followUps = queue.getByRole('list', { name: 'Response follow-up queue', exact: true });
  await expect(followUps).toContainText('MANUAL-RECEIPT');
  await expect(followUps).toContainText('route current');
  await expect(followUps).toContainText('Upcoming');
  await expect(queue.getByRole('region', { name: 'Latest independent observations', exact: true })).toContainText('No independent recheck recorded');
  await page.clock.fastForward(60_000);
  await expect(followUps).toContainText('Due now');
  await expect(followUps).toContainText('route stale');
  const receipt = page.getByRole('form', { name: 'Record response event', exact: true });
  await queue.getByRole('button', { name: 'Review action: Reviewed recipient active', exact: true }).click();
  await expect(receipt.getByRole('combobox', { name: 'Provider outcome', exact: true })).toBeFocused();
  await receipt.getByLabel('Reference', { exact: true }).fill('UNSUBMITTED-RECEIPT');
  await receipt.getByLabel('Outcome detail', { exact: true }).fill('Unsubmitted provider detail');
  await openCaseSection(page, 'Assessment');
  await openCaseSection(page, 'Response');
  await workspace.getByRole('button', { name: 'Advanced', exact: true }).click();
  await workspace.getByRole('button', { name: 'Quick', exact: true }).click();
  await queue.getByRole('button', { name: 'Review action: Reviewed recipient active', exact: true }).click();
  await expect(receipt.getByLabel('Reference', { exact: true })).toHaveValue('UNSUBMITTED-RECEIPT');
  const questionButton = queue.getByRole('button', { name: 'Review question: Is the reported page still observed?', exact: true });
  await questionButton.focus();
  await page.keyboard.press('Enter');
  const recheck = page.getByRole('form', { name: 'Record a recheck', exact: true });
  await expect(recheck.getByRole('combobox', { name: 'Saved question', exact: true })).toHaveValue('question');
  await expect(recheck.getByRole('combobox', { name: 'Saved question', exact: true })).toBeFocused();
  await expect(recheck).toContainText('Compare the reported page');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const [width, height] of [[320, 700], [390, 844], [1024, 768], [1280, 720], [2560, 1440], [3840, 2160]] as const) {
      await page.setViewportSize({ width, height });
      await expectNoHorizontalOverflow(page);
      await queue.screenshot({ path: testInfo.outputPath(`response-queue-${theme}-${width}.png`) });
      if (width === 320 || width === 1280) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: testInfo.outputPath(`response-page-${theme}-${width}.png`), fullPage: true });
      }
    }
  }
  expect((await readBrowserLocalCollection(page, 'cases')).records).toEqual(before.records);
  expect(collections).toBe(0);
  // Wait for recovery copies before deliberately navigating away.
  const recovery = page.locator('.draft-recovery[data-recovery-form="action-receipt"]');
  await expect(recovery).toHaveAttribute('data-recovery-status', 'saved');
  const questionRecovery = page.locator('.draft-recovery[data-recovery-form="observed-effect"]');
  await expect(questionRecovery).toHaveAttribute('data-recovery-status', 'saved');
  await queue.getByRole('link', { name: 'Prepare recheck for queue.example', exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === '/lookup' && url.searchParams.get('q') === 'queue.example' && url.searchParams.get('case') === record.id);
  expect(collections).toBe(0);
});

test('receipt validation and write failures retain the draft while a committed refresh failure never repeats its event', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  const record = caseRecord({ domain: 'receipt.example', actions: [action()] });
  await openSeededTimelineCase(page, record.domain, [record], CASE_SCHEMA_VERSION);
  await openCaseResponseWorkspace(page, '', 'quick');
  await openCaseSection(page, 'Response');
  const receipt = page.getByRole('form', { name: 'Record response event', exact: true });
  const submit = receipt.getByRole('button', { name: 'Record final provider outcome', exact: true });
  await expect(submit).toBeDisabled();
  await receipt.getByRole('combobox', { name: 'Provider outcome', exact: true }).selectOption('provider_reports_resolved');
  await receipt.getByLabel('Reference', { exact: true }).fill('FINAL-RECEIPT');
  await receipt.getByLabel('Outcome detail', { exact: true }).fill('Provider reported resolution; not independently checked');
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  await failNextBrowserLocalManifestWrite(page, 'cases');
  await submit.click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('out of storage space');
  await expect(receipt.getByLabel('Reference', { exact: true })).toHaveValue('FINAL-RECEIPT');
  expect((await readBrowserLocalCollection(page, 'cases')).manifest.revision).toBe(before.manifest.revision);
  await failNextBrowserLocalCollectionReadAfterWrite(page, 'cases');
  await submit.click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('The change was saved, but Cases could not be reread');
  await expect(receipt).toContainText('This action is terminal');
  await expect(submit).toHaveCount(0);
  const committed = await readBrowserLocalCollection(page, 'cases');
  expect(committed.manifest.revision).toBe(before.manifest.revision + 1);
  expect(committed.records[0]!.value.actions[0]!.history.filter(event => event.reference === 'FINAL-RECEIPT')).toHaveLength(1);
  expect(committed.records[0]!.value.observedEffects.reviews).toEqual([]);
  const queue = page.getByRole('region', { name: 'Response and rechecks', exact: true });
  await expect(queue).toContainText('No open response action');
  await queue.getByRole('checkbox', { name: /Include completed actions/u }).check();
  await expect(queue).toContainText('FINAL-RECEIPT');
  await expect(queue).toContainText('No independent recheck recorded');
});
