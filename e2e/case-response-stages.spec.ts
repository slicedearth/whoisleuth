import { expect, test } from './fixtures';
import {
  expectNoHorizontalOverflow,
  failNextBrowserLocalCollectionReadAfterWrite,
  failNextBrowserLocalManifestWrite,
  holdBrowserLocalTransaction,
  readBrowserLocalCollection,
} from './helpers';
import { createCase, openCaseResponseWorkspace, openCasesView } from './case-test-fixtures';
import { caseWorkspaceActionStatus } from './case-response-fixtures';

test('Quick records an observation, conclusion, response receipt, independent review and closure', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCasesView(page);
  await createCase(page, 'quick-stages.invalid');
  const workspace = await openCaseResponseWorkspace(page, '', 'quick');
  const stages = workspace.getByRole('navigation', { name: 'Case response stages', exact: true });
  await expect(stages.getByRole('button')).toHaveCount(5);

  const observation = workspace.getByRole('region', { name: 'Case observations', exact: true });
  await observation.getByLabel('Label', { exact: true }).fill('Selected page observation');
  await observation.getByLabel('Source', { exact: true }).first().fill('Fixture page review');
  await observation.getByLabel('Fact', { exact: true }).fill('An observed credential form requires reviewed escalation.');
  await observation.getByRole('button', { name: 'Pin evidence', exact: true }).click();
  await expect(observation.locator('ol.records').first().locator('li')).toHaveCount(1);

  const assessment = workspace.getByRole('region', { name: 'Case assessment', exact: true });
  await assessment.getByRole('combobox', { name: 'Disposition', exact: true }).selectOption('suspicious');
  await assessment.getByRole('combobox', { name: 'Review reason', exact: true }).selectOption('other_reviewed');
  await assessment.getByLabel('Conclusion summary', { exact: true }).fill('Request an authorised review');
  await assessment.getByLabel('Evidence-based rationale', { exact: true }).fill('The selected observation supports review, not an automatic verdict.');
  await assessment.getByRole('checkbox', { name: 'Selected page observation', exact: true }).check();
  await assessment.getByRole('button', { name: 'Record conclusion', exact: true }).click();
  await expect(assessment.locator('ol.records > li')).toHaveCount(1);

  const actions = workspace.getByRole('region', { name: 'Case response actions', exact: true });
  await actions.getByRole('combobox', { name: 'Action type', exact: true }).selectOption('registrar_report');
  await actions.getByLabel('Recipient or owner', { exact: true }).fill('Fixture abuse review desk');
  await actions.getByLabel('How this route was found', { exact: true }).fill('Fixture registration evidence');
  await actions.getByLabel('Route observed at', { exact: true }).fill('2026-09-01T10:00');
  await actions.getByLabel(/Contact limitations/).fill('Selected registrar route; no delivery performed by the application.');
  await actions.getByRole('button', { name: 'Create drafting action', exact: true }).click();
  for (const name of ['Ready for review', 'Mark reviewed', 'Authorise']) {
    await actions.getByRole('button', { name, exact: true }).click();
  }
  await expect(actions.getByRole('button', { name: 'Mark sent', exact: true })).toBeDisabled();
  await stages.getByRole('button', { name: /4\. Evidence handoff/ }).click();
  const packet = workspace.locator('details[id^="case-response-preflight-"]');
  await expect(packet).toHaveAttribute('open', '');
  await expect(packet.locator(':scope > summary')).toBeFocused();
  await expect(packet.locator(':scope > summary')).toBeInViewport({ ratio: 1 });
  await expect(packet.getByRole('combobox', { name: 'Audience profile', exact: true })).toBeVisible();

  await stages.getByRole('button', { name: /3\. Response decision/ }).click();
  await expect(actions.locator(':scope > details > summary')).toBeInViewport({ ratio: 1 });
  await actions.getByLabel('Delivery reference', { exact: true }).fill('FIXTURE-DELIVERY-1');
  await actions.getByRole('button', { name: 'Mark sent', exact: true }).click();
  await actions.getByRole('combobox', { name: 'Provider outcome', exact: true }).selectOption('accepted_for_review');
  await actions.getByLabel('Reference', { exact: true }).fill('FIXTURE-RECEIPT-1');
  await actions.getByLabel('Outcome detail', { exact: true }).fill('Provider acknowledged the report for review.');
  await actions.getByRole('button', { name: 'Record provider response', exact: true }).click();

  const outcome = workspace.getByRole('region', { name: 'Case independent review and closure', exact: true });
  await expect(outcome.getByRole('list', { name: 'Independent observed-effect reviews' })).toHaveCount(0);
  await expect(outcome).toContainText('accepted for review');
  await outcome.getByRole('combobox', { name: 'Observed effect', exact: true }).selectOption('not_reproduced');
  await outcome.getByLabel('Source', { exact: true }).fill('Separately performed fixture review');
  await outcome.getByRole('combobox', { name: 'Completeness', exact: true }).selectOption('partial');
  await outcome.getByLabel('Limitations', { exact: false }).first().fill('One source failed; this does not establish takedown.');
  await outcome.getByRole('button', { name: 'Record independent outcome', exact: true }).click();
  await outcome.getByRole('combobox', { name: 'Reason', exact: true }).selectOption('unable_to_proceed');
  await outcome.getByLabel('Closure summary', { exact: true }).fill('Closed without asserting removal; independent evidence remains incomplete.');
  await outcome.getByRole('button', { name: 'Close case with reason', exact: true }).click();
  await expect(outcome.getByRole('list', { name: 'Deliberate case closures' })).toContainText('unable to proceed');

  const stored = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value;
  expect(stored).toMatchObject({ status: 'resolved', disposition: 'suspicious' });
  expect(stored.evidencePins).toHaveLength(1);
  expect(stored.decisions).toHaveLength(1);
  expect(stored.actions).toHaveLength(1);
  expect(stored.actions[0]).toMatchObject({ state: 'acknowledged', providerOutcome: 'accepted_for_review', reference: 'FIXTURE-RECEIPT-1' });
  expect(stored.actions[0]!.history.map((event) => event.nextState)).toEqual(['drafting', 'ready_for_review', 'reviewed', 'authorised', 'submitted', 'acknowledged']);
  expect(stored.observedEffects.reviews).toEqual([expect.objectContaining({ state: 'not_reproduced', completeness: 'partial', limitations: ['One source failed; this does not establish takedown.'] })]);
  expect(stored.closures.records).toEqual([expect.objectContaining({ reason: 'unable_to_proceed' })]);
  await expect(workspace.getByRole('button', { name: 'Quick', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expectNoHorizontalOverflow(page);
});

test('a Quick closure without a response action preserves validation, failed-write and committed-refresh outcomes', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'no-action-closure.invalid');
  const workspace = await openCaseResponseWorkspace(page, '', 'quick');
  const outcome = workspace.getByRole('region', { name: 'Case independent review and closure', exact: true });
  const summary = outcome.getByLabel('Closure summary', { exact: true });
  const submit = outcome.getByRole('button', { name: 'Close case with reason', exact: true });
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  await submit.click();
  expect(await summary.evaluate((element) => (element as HTMLTextAreaElement).validity.valueMissing)).toBe(true);
  await outcome.getByRole('combobox', { name: 'Reason', exact: true }).selectOption('false_positive');
  await summary.fill('The retained concern was reviewed as a false positive.');
  await failNextBrowserLocalManifestWrite(page, 'cases');
  await submit.click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('out of storage space');
  await expect(summary).toHaveValue('The retained concern was reviewed as a false positive.');
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).manifest.revision).toBe(before.manifest.revision);
  await failNextBrowserLocalCollectionReadAfterWrite(page, 'cases');
  await submit.click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('The change was saved, but Cases could not be reread');
  await expect(summary).toHaveValue('');
  const stored = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  expect(stored.manifest.revision).toBe(before.manifest.revision + 1);
  expect(stored.records[0]!.value.actions).toEqual([]);
  expect(stored.records[0]!.value.observedEffects.reviews).toEqual([]);
  expect(stored.records[0]!.value.closures.records).toEqual([expect.objectContaining({ reason: 'false_positive' })]);
});

test('stage changes and pending saves preserve later assessment, outcome and branch drafts', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'stage-drafts.invalid');
  const workspace = await openCaseResponseWorkspace(page, '', 'quick');
  const observation = workspace.getByRole('region', { name: 'Case observations', exact: true });
  await observation.getByLabel('Label', { exact: true }).fill('Draft fixture evidence');
  await observation.getByLabel('Fact', { exact: true }).fill('A bounded retained fact.');
  await observation.getByRole('button', { name: 'Pin evidence', exact: true }).click();
  const assessment = workspace.getByRole('region', { name: 'Case assessment', exact: true });
  await assessment.getByRole('combobox', { name: 'Disposition', exact: true }).selectOption('suspicious');
  await assessment.getByRole('combobox', { name: 'Review reason', exact: true }).selectOption('other_reviewed');
  await assessment.getByLabel('Conclusion summary', { exact: true }).fill('Submitted conclusion');
  await assessment.getByLabel('Evidence-based rationale', { exact: true }).fill('Submitted rationale');
  await assessment.getByRole('checkbox', { name: 'Draft fixture evidence', exact: true }).check();
  const outcome = workspace.getByRole('region', { name: 'Case independent review and closure', exact: true });
  await outcome.getByLabel('Source', { exact: true }).fill('Unsubmitted independent review');
  await outcome.getByLabel('Closure summary', { exact: true }).fill('Unsubmitted closure');
  const release = await holdBrowserLocalTransaction(page);
  try {
    await assessment.getByRole('button', { name: 'Record conclusion', exact: true }).click();
    await expect(assessment.getByRole('button', { name: 'Record conclusion', exact: true })).toBeDisabled();
    await workspace.getByRole('button', { name: 'Advanced', exact: true }).click();
    await assessment.getByText('Record an analyst decision', { exact: true }).click();
    await assessment.getByLabel('Decision summary', { exact: true }).fill('Later conclusion');
    await assessment.getByLabel('Rationale', { exact: true }).fill('Later rationale');
    await workspace.getByRole('button', { name: 'Quick', exact: true }).click();
  } finally { await release(); }
  await expect(assessment.locator('ol.records > li')).toHaveCount(1);
  await expect(assessment.getByLabel('Conclusion summary', { exact: true })).toHaveValue('Later conclusion');
  await expect(assessment.getByLabel('Evidence-based rationale', { exact: true })).toHaveValue('Later rationale');
  await expect(outcome.getByLabel('Source', { exact: true })).toHaveValue('Unsubmitted independent review');
  await expect(outcome.getByLabel('Closure summary', { exact: true })).toHaveValue('Unsubmitted closure');
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value.decisions.map((item) => item.summary)).toEqual(['Submitted conclusion']);

  await workspace.getByRole('button', { name: 'Advanced', exact: true }).click();
  const branch = assessment.locator('details', { hasText: 'Group evidence and decisions into investigation branches' });
  await branch.locator('summary').click();
  await branch.getByLabel('Branch name', { exact: true }).fill('Submitted branch');
  await branch.getByRole('checkbox', { name: 'Draft fixture evidence', exact: true }).check();
  const releaseBranch = await holdBrowserLocalTransaction(page);
  try {
    await branch.getByRole('button', { name: 'Create branch', exact: true }).click();
    await expect(branch.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
    await branch.getByLabel('Branch name', { exact: true }).fill('Later branch');
    await workspace.getByRole('button', { name: 'Quick', exact: true }).click();
  } finally { await releaseBranch(); }
  await expect(caseWorkspaceActionStatus(page)).toContainText('Created an investigation branch');
  await workspace.getByRole('button', { name: 'Advanced', exact: true }).click();
  await branch.locator('summary').click();
  await expect(branch.getByLabel('Branch name', { exact: true })).toHaveValue('Later branch');
  await expect(branch.getByRole('checkbox', { name: 'Draft fixture evidence', exact: true })).toBeChecked();
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value.branches?.map((item) => item.name)).toEqual(['Submitted branch']);
});
