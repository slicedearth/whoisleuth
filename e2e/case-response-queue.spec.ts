import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import { expect, test, isLookupEndpointUrl } from './fixtures';
import { caseRecord, openSeededTimelineCase, openCaseResponseWorkspace } from './case-test-fixtures';
import { currentActionFixture, caseWorkspaceActionStatus } from './case-response-fixtures';
import { openCaseSection, inboxReviewControls, openInboxReview } from './console-navigation';
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
  await page.clock.setFixedTime(NOW);
  let collections = 0;
  await page.route(url => isLookupEndpointUrl(url.href), route => { collections++; return route.abort(); });
  const record = caseRecord({ domain: 'queue.example', actions: [action()], assertions: [{ id: 'question', kind: 'next_step',
    statement: 'Is the reported page still observed?', rationale: '', state: 'open', evidencePinIds: [],
    recheck: { targetHostname: 'page.queue.example', baselinePinId: null, conditions: 'Compare the reported page' }, createdAt: NOW, updatedAt: NOW }] });
  const undated = caseRecord({ id: 'undated-response', domain: 'waiting.example', actions: [{ ...action('undated'), followUpAt: null }] });
  await openSeededTimelineCase(page, record.domain, [record, undated], CASE_SCHEMA_VERSION);
  const retained = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  await page.goto('/monitor?view=inbox&queue=waiting');
  const inbox = page.getByRole('region', { name: 'Review inbox', exact: true });
  const providerItem = await openInboxReview(inboxReviewControls(page, 'registrar report for waiting.example'));
  await expect(providerItem.locator('.waiting-on')).toContainText('Provider response');
  await expect(providerItem.locator('.waiting-on')).toContainText('no final provider outcome is recorded');
  await expect(providerItem.locator('.item-facts')).not.toContainText('Due');
  const queues = inbox.getByRole('group', { name: 'Review queue', exact: true });
  await queues.getByRole('button', { name: /^Needs action/u }).click();
  await openInboxReview(inboxReviewControls(page, 'registrar report for waiting.example'));
  await expect(providerItem.locator('.waiting-on')).toContainText('Provider response');
  await queues.getByRole('button', { name: /^Waiting on/u }).click();
  const analystItem = await openInboxReview(inboxReviewControls(page, 'Review waiting.example'));
  await expect(analystItem.locator('.waiting-on')).toContainText('Analyst decision');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await openInboxReview(inboxReviewControls(page, 'registrar report for waiting.example'));
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) await providerItem.screenshot({ path: testInfo.outputPath(`waiting-on-${theme}-${width}.png`) });
    }
  }
  expect((await readBrowserLocalCollection(page, 'cases')).records).toEqual(retained.records);
  await queues.getByRole('button', { name: /^Waiting on/u }).click();
  const timedItem = await openInboxReview(inboxReviewControls(page, 'registrar report for queue.example'));
  await expect(timedItem.locator('.waiting-on')).toContainText('Reviewed time');
  const source = timedItem.getByRole('link', { name: 'Review', exact: true });
  await source.focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(url => url.pathname === '/cases' && url.searchParams.get('case') === record.id && url.searchParams.get('section') === 'response');
  const workspace = await openCaseResponseWorkspace(page, '', 'quick');
  await openCaseSection(page, 'Response');
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  const queue = page.getByRole('region', { name: 'Response and rechecks', exact: true });
  const followUps = queue.getByRole('list', { name: 'Response follow-up queue', exact: true });
  await expect(followUps).toContainText('MANUAL-RECEIPT');
  await expect(followUps).toContainText('route current');
  await expect(followUps).toContainText('Upcoming');
  await expect(queue.getByRole('region', { name: 'Latest independent observations', exact: true })).toContainText('No independent recheck recorded');
  await page.clock.setFixedTime(new Date(Date.parse(NOW) + 60_000));
  await page.clock.fastForward(60_000);
  await expect(followUps).toContainText('Due now');
  await expect(followUps).toContainText('route stale');
  const receipt = page.getByRole('form', { name: 'Record response event', exact: true });
  const actionReview = followUps.getByRole('listitem').filter({ has: page.getByText('Reviewed recipient active', { exact: true }) }).getByRole('button', { name: /^Review action/u });
  await expect(actionReview).toHaveAccessibleName('Review action and receipt — Reviewed recipient active');
  await actionReview.click();
  await expect(receipt.getByRole('combobox', { name: 'Provider outcome', exact: true })).toBeFocused();
  await receipt.getByLabel('Reference', { exact: true }).fill('UNSUBMITTED-RECEIPT');
  await receipt.getByLabel('Outcome detail', { exact: true }).fill('Unsubmitted provider detail');
  await openCaseSection(page, 'Assessment');
  await openCaseSection(page, 'Response');
  await workspace.getByRole('button', { name: 'Advanced', exact: true }).click();
  await workspace.getByRole('button', { name: 'Quick', exact: true }).click();
  await actionReview.click();
  await expect(receipt.getByLabel('Reference', { exact: true })).toHaveValue('UNSUBMITTED-RECEIPT');
  const questionButton = queue.getByRole('region', { name: 'Open recheck questions', exact: true }).getByRole('article')
    .filter({ has: page.getByText('Is the reported page still observed?', { exact: true }) }).getByRole('button', { name: /^Review question/u });
  await expect(questionButton).toHaveAccessibleName('Review question and answers · 0 — Is the reported page still observed?');
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
      if (captureVisualEvidenceEnabled()) { await queue.screenshot({ path: testInfo.outputPath(`response-queue-${theme}-${width}.png`) }); }
      if (width === 320 || width === 1280) {
        await page.evaluate(() => window.scrollTo(0, 0));
        if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`response-page-${theme}-${width}.png`), fullPage: true }); }
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
  await expect(caseWorkspaceActionStatus(page)).toContainText('The change was saved, but cases could not be reread');
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
