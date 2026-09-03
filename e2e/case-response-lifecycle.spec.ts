import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, failNextBrowserLocalCollectionRead, failNextBrowserLocalCollectionReadAfterWrite, holdBrowserLocalReads, readBrowserLocalCollection, requiredValue } from './helpers';
import { createCase, openCaseResponseWorkspace, openCasesView } from './case-test-fixtures';
import { addFixtureCasePin, caseWorkspaceActionStatus, openPacketWizardStep } from './case-response-fixtures';

// Case response mutation, failure recovery and lifecycle coverage.

test('rapid repeated note submission persists one note and is shown in the record', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'noted.invalid');

  await page.locator('.case-body .note-edit textarea').fill('This domain looks suspicious.');
  await page.locator('.case-body .note-edit').evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
    (form as HTMLFormElement).requestSubmit();
  });

  await expect(page.locator('.notes p').first()).toHaveText('This domain looks suspicious.');
  await expect(page.locator('.notes p')).toHaveCount(1);
  await expect(page.locator('.case-domain small')).toContainText('1 note');

  await page.reload();
  await page.getByRole('tab', { name: /Cases/ }).click();
  await expect(page.locator('.case-head', { hasText: 'noted.invalid' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.notes p').first()).toHaveText('This domain looks suspicious.');
});

test('a Case response save preserves unrelated analyst drafts and keyboard focus', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'draft-retention.invalid');

  const workspace = await openCaseResponseWorkspace(page);
  const packet = workspace.locator('details', { hasText: 'Prepare a reviewed abuse evidence packet' });
  await packet.getByText('Prepare a reviewed abuse evidence packet', { exact: true }).click();
  await packet.getByLabel('Abuse category').fill('Fixture abuse review');
  await packet.getByLabel('Affected party').fill('Fixture affected party');
  await packet.getByLabel('Exact abusive HTTP(S) URLs').fill('https://draft-retention.invalid/review');
  await packet.getByLabel('Observed harm').fill('A bounded draft that must survive an unrelated Case mutation.');

  const pin = workspace.locator('details', { hasText: 'Pin an observed fact' });
  await pin.getByText('Pin an observed fact', { exact: true }).click();
  await pin.getByLabel('Label').fill('Draft-retention pin');
  await pin.getByLabel('Source').fill('Fixture evidence');
  await pin.getByLabel('Fact').fill('A separately reviewed fixture fact.');
  const submit = pin.getByRole('button', { name: 'Pin evidence' });
  await submit.click();

  await expect(workspace).toContainText('Draft-retention pin');
  await expect(packet.getByLabel('Abuse category')).toHaveValue('Fixture abuse review');
  await expect(packet.getByLabel('Affected party')).toHaveValue('Fixture affected party');
  await expect(packet.getByLabel('Exact abusive HTTP(S) URLs')).toHaveValue('https://draft-retention.invalid/review');
  await expect(packet.getByLabel('Observed harm')).toHaveValue('A bounded draft that must survive an unrelated Case mutation.');
  await expect(submit).toBeFocused();
});

test('Quick and Advanced Case Response presentations keep one record and focus the selected work', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCasesView(page);
  await createCase(page, 'quick-response.invalid');

  const workspace = await openCaseResponseWorkspace(page, '', 'quick');
  await expect(workspace.getByRole('heading', { name: 'Evidence, reasoning, and actions' })).toBeVisible();
  await expect(workspace.getByRole('status', { name: 'Next Case requirement' })).toContainText('Observation');
  await expect(workspace.locator('details[id^="case-response-observation-"]')).toHaveCount(0);
  await workspace.getByRole('button', { name: 'Advanced history and fields' }).click();
  const observation = workspace.locator('details[id^="case-response-observation-"]').first();
  await expect(observation).toHaveAttribute('open', '');
  await expect(observation.getByText('Pin an observed fact', { exact: true })).toBeFocused();
  await expect(workspace.getByRole('button', { name: 'Advanced', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await workspace.getByRole('button', { name: 'Quick', exact: true }).click();
  await expect(workspace.getByRole('heading', { name: 'Next analyst action' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('Case mutation focus recovery respects deliberate movement and restores a displaced branch control', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'focus-recovery.invalid');

  const workspace = await openCaseResponseWorkspace(page);
  const pin = workspace.locator('details', { hasText: 'Pin an observed fact' });
  await pin.getByText('Pin an observed fact', { exact: true }).click();
  await pin.getByLabel('Label').fill('Focus fixture pin');
  await pin.getByLabel('Source').fill('Fixture evidence');
  await pin.getByLabel('Fact').fill('A bounded fact used to exercise focus recovery.');
  const pinSubmit = pin.getByRole('button', { name: 'Pin evidence' });

  await holdBrowserLocalReads(page, 750);
  await pinSubmit.click();
  const caseSearch = page.locator('.case-filters').getByRole('textbox', { name: 'Search' });
  await caseSearch.focus();
  await expect(workspace).toContainText('Focus fixture pin');
  await expect(caseSearch).toBeFocused();

  const branch = workspace.locator('details', { hasText: 'Group evidence and decisions into investigation branches' });
  await branch.getByText('Group evidence and decisions into investigation branches', { exact: true }).click();
  await branch.getByLabel('Branch name').fill('Focus recovery branch');
  await branch.getByRole('checkbox', { name: 'Focus fixture pin' }).check();
  const branchSubmit = branch.getByRole('button', { name: 'Create branch' });
  await holdBrowserLocalReads(page, 750);
  await branchSubmit.click();
  await expect(branch).toContainText('Focus recovery branch');
  await expect(branch.getByLabel('Branch name')).toBeFocused();

  const assertions = workspace.locator('details', { hasText: 'Structure facts, hypotheses, unknowns, and next steps' });
  await assertions.getByText('Structure facts, hypotheses, unknowns, and next steps', { exact: true }).click();
  await assertions.getByLabel('Statement').fill('Focus fallback assertion');
  await assertions.getByRole('button', { name: 'Record assertion' }).click();
  const assertionItem = assertions.locator('ol.records > li', { hasText: 'Focus fallback assertion' });
  await expect(assertionItem).toBeVisible();
  const resolveAssertion = assertionItem.getByRole('button', { name: 'Mark resolved' });
  await holdBrowserLocalReads(page, 750);
  await resolveAssertion.click();
  await expect(assertionItem).toContainText('resolved');
  await expect(resolveAssertion).toHaveCount(0);
  await expect(assertionItem).toBeFocused();
});

test('a committed note remains singular when its immediate reread fails', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'note-neighbour.invalid');
  await createCase(page, 'note-committed.invalid');
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });

  const note = page.locator('.case-body .note-edit');
  await note.getByLabel('Add note').fill('One committed fixture note.');
  await failNextBrowserLocalCollectionReadAfterWrite(page, 'cases');
  await note.getByRole('button', { name: 'Add note' }).click();

  await expect(caseWorkspaceActionStatus(page)).toContainText('The change was saved, but Cases could not be reread');
  await expect(note.getByLabel('Add note')).toHaveValue('');
  await expect(page.locator('.case-head', { hasText: 'note-neighbour.invalid' })).toBeVisible();
  const committed = await readBrowserLocalCollection(page, 'cases', {
    minimumRecords: 2,
    minimumRevision: before.manifest.revision + 1,
  });
  const stored = requiredValue(
    committed.records.find((item) => item.value.domain === 'note-committed.invalid'),
    'The post-write note Case is missing.',
  ).value;
  expect(stored.notes).toHaveLength(1);
  expect(stored.notes[0]?.body).toBe('One committed fixture note.');

  await page.reload();
  await page.getByRole('tab', { name: /Cases/ }).click();
  await expect(page.locator('.case-head', { hasText: 'note-committed.invalid' })).toBeVisible();
  const reloaded = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  expect(requiredValue(
    reloaded.records.find((item) => item.value.domain === 'note-committed.invalid'),
    'The reloaded note Case is missing.',
  ).value.notes).toHaveLength(1);
});

test('committed Case status, tags and deletion reconcile when immediate rereads fail', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'reconcile-neighbour.invalid');
  await createCase(page, 'reconcile-target.invalid');
  const openCaseRecord = page.locator('article.case.open');
  const status = openCaseRecord.getByRole('combobox', { name: /^Status/u });

  await failNextBrowserLocalCollectionReadAfterWrite(page, 'cases');
  await status.selectOption('reviewing');
  await expect(caseWorkspaceActionStatus(page).filter({
    hasText: 'Set reconcile-target.invalid to Reviewing. The change was saved, but Cases could not be reread',
  })).toBeVisible();
  await expect(status).toHaveValue('reviewing');
  await expect(page.locator('.case-head', { hasText: 'reconcile-neighbour.invalid' })).toBeVisible();
  let committed = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  expect(requiredValue(
    committed.records.find((item) => item.value.domain === 'reconcile-target.invalid'),
    'The reconciled status Case is missing.',
  ).value.status).toBe('reviewing');

  await page.getByLabel('Tags').fill('reviewed, retained');
  await failNextBrowserLocalCollectionReadAfterWrite(page, 'cases');
  await page.getByRole('button', { name: 'Save tags' }).click();
  await expect(caseWorkspaceActionStatus(page).filter({
    hasText: 'Updated tags for reconcile-target.invalid. The change was saved, but Cases could not be reread',
  })).toBeVisible();
  await expect(page.getByLabel('Tags')).toHaveValue('reviewed, retained');
  await expect(page.locator('.tag-row')).toContainText('reviewed');
  committed = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  expect(requiredValue(
    committed.records.find((item) => item.value.domain === 'reconcile-target.invalid'),
    'The reconciled tag Case is missing.',
  ).value.tags).toEqual(['reviewed', 'retained']);

  await failNextBrowserLocalCollectionReadAfterWrite(page, 'cases');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete case' }).click();
  await expect(caseWorkspaceActionStatus(page).filter({
    hasText: 'Deleted the case for reconcile-target.invalid. The change was saved, but Cases could not be reread',
  })).toBeVisible();
  await expect(page.locator('.case-head', { hasText: 'reconcile-target.invalid' })).toHaveCount(0);
  await expect(page.locator('.case-head', { hasText: 'reconcile-neighbour.invalid' })).toBeVisible();
  committed = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  expect(committed.records.map((item) => item.value.domain)).toEqual(['reconcile-neighbour.invalid']);
});

test('rapid repeated action submission persists one drafting action', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'action-single.invalid');
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  const details = (await openCaseResponseWorkspace(page)).locator('details', { hasText: 'Track append-only response actions' });
  await details.getByText('Track append-only response actions', { exact: true }).click();
  await details.getByLabel('Recipient or internal owner').fill('Fixture review owner');
  await details.getByLabel('Contact source').fill('Fixture source');
  await details.locator('form').evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
    (form as HTMLFormElement).requestSubmit();
  });

  await expect(details).toContainText('internal review · drafting');
  const committed = await readBrowserLocalCollection(page, 'cases', {
    minimumRecords: 1,
    minimumRevision: before.manifest.revision + 1,
  });
  const stored = requiredValue(committed.records[0], 'The rapid action Case is missing.').value;
  expect(stored.actions).toHaveLength(1);
  expect(stored.actions[0]).toMatchObject({ recipient: 'Fixture review owner', contactSource: 'Fixture source' });
  expect(committed.manifest.revision).toBe(before.manifest.revision + 1);
});

test('rapid repeated branch submission persists one investigation branch', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'branch-single.invalid');
  await addFixtureCasePin(page, 'Single branch pin');
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  const details = (await openCaseResponseWorkspace(page)).locator('details', { hasText: 'Group evidence and decisions into investigation branches' });
  await details.getByText('Group evidence and decisions into investigation branches', { exact: true }).click();
  await details.getByLabel('Branch name').fill('Single branch');
  await details.getByRole('checkbox', { name: 'Single branch pin' }).check();
  await details.locator('form').evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
    (form as HTMLFormElement).requestSubmit();
  });

  await expect(details.locator('.branches li')).toHaveCount(1);
  const committed = await readBrowserLocalCollection(page, 'cases', {
    minimumRecords: 1,
    minimumRevision: before.manifest.revision + 1,
  });
  const stored = requiredValue(committed.records[0], 'The rapid branch Case is missing.').value;
  expect(stored.branches ?? []).toHaveLength(1);
  expect(stored.branches?.[0]).toMatchObject({ name: 'Single branch', state: 'active' });
  expect(committed.manifest.revision).toBe(before.manifest.revision + 1);
});

test('keeps a drafting action form when the Case update fails before commit', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'action-draft.invalid');

  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  const workspace = await openCaseResponseWorkspace(page);
  const action = workspace.locator('details', { hasText: 'Track append-only response actions' });
  await action.getByText('Track append-only response actions', { exact: true }).click();
  await action.getByLabel('Action type').selectOption('registrar_report');
  await action.getByLabel('Recipient or internal owner').fill('Fixture review desk');
  await action.getByLabel('Contact source').fill('Fixture registry role');
  await action.getByLabel('Due at').fill('2026-08-18T10:00');
  await action.getByLabel('Follow-up at').fill('2026-08-19T11:30');
  await action.getByLabel(/Contact limitations/).fill('Fixture contact route; no delivery attempted');

  await failNextBrowserLocalCollectionRead(page, 'cases');
  await action.getByRole('button', { name: 'Create drafting action' }).click();

  await expect(caseWorkspaceActionStatus(page).filter({ hasText: 'Cases could not be read' })).toBeVisible();
  await expect(action.getByLabel('Action type')).toHaveValue('registrar_report');
  await expect(action.getByLabel('Recipient or internal owner')).toHaveValue('Fixture review desk');
  await expect(action.getByLabel('Contact source')).toHaveValue('Fixture registry role');
  await expect(action.getByLabel('Due at')).toHaveValue('2026-08-18T10:00');
  await expect(action.getByLabel('Follow-up at')).toHaveValue('2026-08-19T11:30');
  await expect(action.getByLabel(/Contact limitations/)).toHaveValue('Fixture contact route; no delivery attempted');

  const unchanged = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  expect(unchanged.manifest.revision).toBe(before.manifest.revision);
  expect(requiredValue(unchanged.records[0], 'The action-draft Case is missing.').value.actions).toEqual([]);

  await action.getByRole('button', { name: 'Create drafting action' }).click();
  await expect(workspace).toContainText('registrar report · drafting');
  const committed = await readBrowserLocalCollection(page, 'cases', {
    minimumRecords: 1,
    minimumRevision: before.manifest.revision + 1,
  });
  expect(requiredValue(committed.records[0], 'The committed action Case is missing.').value.actions).toHaveLength(1);
});

test('shows the complete committed Case snapshot when the immediate action reread fails', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'action-neighbour.invalid');
  await createCase(page, 'action-committed.invalid');

  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  const workspace = await openCaseResponseWorkspace(page);
  const action = workspace.locator('details', { hasText: 'Track append-only response actions' });
  await action.getByText('Track append-only response actions', { exact: true }).click();
  await action.getByLabel('Action type').selectOption('registry_report');
  await action.getByLabel('Recipient or internal owner').fill('Fixture registry desk');
  await action.getByLabel('Contact source').fill('Fixture registry evidence');

  await failNextBrowserLocalCollectionReadAfterWrite(page, 'cases');
  await action.getByRole('button', { name: 'Create drafting action' }).click();

  await expect(caseWorkspaceActionStatus(page).filter({ hasText: 'The change was saved, but Cases could not be reread' })).toContainText('complete committed Case snapshot');
  await expect(workspace).toContainText('registry report · drafting');
  await expect(page.locator('.case-head', { hasText: 'action-neighbour.invalid' })).toBeVisible();
  const committed = await readBrowserLocalCollection(page, 'cases', {
    minimumRecords: 1,
    minimumRevision: before.manifest.revision + 1,
  });
  expect(committed.records).toHaveLength(2);
  const stored = requiredValue(
    committed.records.find((item) => item.value.domain === 'action-committed.invalid'),
    'The post-write action Case is missing.',
  ).value;
  expect(stored.actions).toHaveLength(1);
  expect(stored.actions[0]).toMatchObject({
    type: 'registry_report',
    recipient: 'Fixture registry desk',
    contactSource: 'Fixture registry evidence',
  });
});

test('keeps an investigation-branch draft when the Case update fails before commit', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'branch-draft.invalid');
  await addFixtureCasePin(page, 'Branch fixture pin');

  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  const workspace = await openCaseResponseWorkspace(page);
  const branch = workspace.locator('details', { hasText: 'Group evidence and decisions into investigation branches' });
  await branch.getByText('Group evidence and decisions into investigation branches', { exact: true }).click();
  await branch.getByLabel('Branch name').fill('Draft branch');
  await branch.getByRole('checkbox', { name: 'Branch fixture pin' }).check();

  await failNextBrowserLocalCollectionRead(page, 'cases');
  await branch.getByRole('button', { name: 'Create branch' }).click();

  await expect(caseWorkspaceActionStatus(page).filter({ hasText: 'Cases could not be read' })).toBeVisible();
  await expect(branch.getByLabel('Branch name')).toHaveValue('Draft branch');
  await expect(branch.getByRole('checkbox', { name: 'Branch fixture pin' })).toBeChecked();
  const unchanged = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  expect(unchanged.manifest.revision).toBe(before.manifest.revision);
  expect(requiredValue(unchanged.records[0], 'The branch-draft Case is missing.').value.branches).toEqual([]);

  await branch.getByRole('button', { name: 'Create branch' }).click();
  await expect(workspace).toContainText('Draft branch');
  const committed = await readBrowserLocalCollection(page, 'cases', {
    minimumRecords: 1,
    minimumRevision: before.manifest.revision + 1,
  });
  expect(requiredValue(committed.records[0], 'The committed branch Case is missing.').value.branches).toHaveLength(1);
});

test('shows the complete committed Case snapshot when an investigation-branch reread fails', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'branch-neighbour.invalid');
  await createCase(page, 'branch-committed.invalid');
  await addFixtureCasePin(page, 'Committed branch pin');

  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 2 });
  const workspace = await openCaseResponseWorkspace(page);
  const branch = workspace.locator('details', { hasText: 'Group evidence and decisions into investigation branches' });
  await branch.getByText('Group evidence and decisions into investigation branches', { exact: true }).click();
  await branch.getByLabel('Branch name').fill('Committed branch');
  await branch.getByRole('checkbox', { name: 'Committed branch pin' }).check();

  await failNextBrowserLocalCollectionReadAfterWrite(page, 'cases');
  await branch.getByRole('button', { name: 'Create branch' }).click();

  await expect(caseWorkspaceActionStatus(page).filter({ hasText: 'The change was saved, but Cases could not be reread' })).toContainText('complete committed Case snapshot');
  await expect(workspace).toContainText('Committed branch');
  await expect(page.locator('.case-head', { hasText: 'branch-neighbour.invalid' })).toBeVisible();
  const committed = await readBrowserLocalCollection(page, 'cases', {
    minimumRecords: 2,
    minimumRevision: before.manifest.revision + 1,
  });
  expect(committed.records).toHaveLength(2);
  const stored = requiredValue(
    committed.records.find((item) => item.value.domain === 'branch-committed.invalid'),
    'The post-write branch Case is missing.',
  ).value;
  expect(stored.branches ?? []).toHaveLength(1);
  expect(stored.branches?.[0]).toMatchObject({ name: 'Committed branch', state: 'active' });
});

test('append-only response review, exact authorisation, independent verification, and closure persist locally', {
  tag: ['@analyst-journey', '@journey-reviewed-response-decision'],
}, async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'response.invalid');
  await page.locator('.case-body').getByLabel('Disposition').selectOption('confirmed_abuse');
  await page.locator('.case-body').getByLabel('Review reason').selectOption('confirmed_credential_abuse');

  const workspace = await openCaseResponseWorkspace(page);
  const pin = workspace.locator('details', { hasText: 'Pin an observed fact' });
  await pin.getByText('Pin an observed fact', { exact: true }).click();
  await pin.getByLabel('Label').fill('Observed credential form');
  await pin.getByLabel('Source').fill('Lookup evidence');
  await pin.getByLabel('Observed at').fill('2026-07-28T10:00');
  await pin.getByLabel('Fact').fill('A password field was observed in the captured static page.');
  await pin.getByLabel(/Limitations/).fill('Static page evidence only');
  await pin.getByRole('button', { name: 'Pin evidence' }).click();
  await expect(workspace).toContainText('Observed credential form');

  const decision = workspace.locator('details', { hasText: 'Record an analyst decision' });
  await decision.getByText('Record an analyst decision', { exact: true }).click();
  await decision.getByLabel('Decision summary').fill('Escalate for reviewed reporting');
  await decision.getByLabel('Rationale').fill('The observed page and exact URL require human review.');
  await decision.getByRole('checkbox', { name: 'Observed credential form' }).check();
  await decision.getByRole('button', { name: 'Record decision' }).click();
  await expect(workspace).toContainText('Escalate for reviewed reporting');

  await workspace.getByRole('button', { name: 'Quick', exact: true }).click();
  const nextRequirement = workspace.getByRole('status', { name: 'Next Case requirement' });
  await expect(nextRequirement).toHaveAttribute('data-status', 'not_started');
  await expect(nextRequirement).toContainText('Response decision');
  await workspace.getByRole('button', { name: 'Advanced', exact: true }).click();

  const action = workspace.locator('details', { hasText: 'Track append-only response actions' });
  await action.getByText('Track append-only response actions', { exact: true }).click();
  await action.getByLabel('Action type').selectOption('registrar_report');
  await action.getByLabel('Recipient or internal owner').fill('Registrar abuse desk');
  await action.getByLabel('Contact source').fill('RDAP entity role');
  await action.getByRole('button', { name: 'Create drafting action' }).click();
  await expect(workspace).toContainText('registrar report · drafting');

  const branch = workspace.locator('details', { hasText: 'Group evidence and decisions into investigation branches' });
  await branch.getByText('Group evidence and decisions into investigation branches', { exact: true }).click();
  await branch.getByLabel('Branch name').fill('Registrar response path');
  await branch.getByRole('checkbox', { name: 'Observed credential form' }).check();
  await branch.getByRole('checkbox', { name: /registrar report.*Registrar abuse desk/iu }).check();
  await branch.getByRole('button', { name: 'Create branch' }).click();
  await expect(branch).toContainText('Registrar response path');
  await expect(branch).toContainText('1 pin · 0 checkpoints · 0 assertions · 1 action');

  await action.getByRole('button', { name: 'Review or append event' }).click();
  for (const state of ['ready_for_review', 'reviewed', 'authorised'] as const) {
    await action.getByLabel('Next state').selectOption(state);
    await action.getByRole('button', { name: 'Append transition' }).click();
    await expect(action).toContainText(`Current projection: ${state.replaceAll('_', ' ')}`);
  }
  await expect(action.locator('.transition-timeline > li')).toHaveCount(4);

  const packet = workspace.locator('details', { hasText: 'Prepare a reviewed abuse evidence packet' });
  await packet.getByText('Prepare a reviewed abuse evidence packet', { exact: true }).click();
  await expect(packet.getByLabel('Audience profile')).toHaveValue('internal_soc');
  await expect(packet).toContainText('Internal security operations or incident-response team');
  await packet.getByLabel('Audience profile').selectOption('registrar');
  await expect(packet).toContainText('Domain registrar abuse or compliance team');
  await expect(packet).toContainText('Raw WHOIS or RDAP payloads');
  await packet.getByLabel('Abuse category').fill('Credential phishing');
  await packet.getByLabel('Affected party').fill('Example service');
  await packet.getByLabel('Observed at').fill('2026-07-28T10:00');
  await packet.getByLabel(/Exact abusive HTTP/).fill('https://response.invalid/sign-in');
  await packet.getByLabel('Observed harm').fill('The page solicited account credentials using the affected party name.');
  await packet.getByLabel('Case action for this packet').selectOption({ index: 1 });
  await expect(packet).toContainText('Registrar abuse desk');
  await expect(packet).toContainText('RDAP entity role');
  await packet.getByRole('checkbox', { name: /Observed credential form/ }).check();
  await openPacketWizardStep(packet, 'Review');
  await expect(packet).toContainText('review cautions');
  const infrastructure = packet.locator('.readiness-editor section', { hasText: 'Infrastructure responsibility' });
  await infrastructure.getByLabel('State').selectOption('complete');
  await infrastructure.getByLabel('Detail').fill('The selected registration evidence supports this bounded registrar route.');
  const authority = packet.locator('.readiness-editor section', { hasText: 'Analyst authority' });
  await authority.getByLabel('State').selectOption('complete');
  await authority.getByLabel('Detail').fill('The analyst confirmed authority for this exact recipient and scope.');
  const contradictionReview = packet.locator('.readiness-editor section', { hasText: 'Contradiction review' });
  await contradictionReview.getByLabel('State').selectOption('complete');
  await contradictionReview.getByLabel('Detail').fill('The exact selected inputs were reviewed for contradictions.');
  const sourceLimitations = packet.locator('.readiness-editor section', { hasText: 'Source limitations review' });
  await sourceLimitations.getByLabel('State').selectOption('partial');
  await sourceLimitations.getByLabel('Detail').fill('Known static-capture limitations remain explicit.');
  await sourceLimitations.getByLabel('Limitations').fill('No delivery or provider monitoring check was performed.');
  await expect(packet.locator('.readiness-matrix tbody tr')).toHaveCount(10);
  await expect(packet).toContainText('Profile-specific readiness matrix');
  await packet.getByLabel('Label', { exact: true }).last().fill('Reviewed static capture metadata');
  await packet.getByLabel('Captured at').fill('2026-07-28T10:00');
  await packet.getByLabel('SHA-256 digest').fill('a'.repeat(64));
  await packet.getByLabel('Byte length').fill('1024');
  await expect(packet).toContainText('review cautions');

  await packet.getByRole('button', { name: 'Review and bind exact inputs' }).click();
  await expect(packet).toContainText('draft · authorisation incomplete');
  await openPacketWizardStep(packet, 'Prepare');
  await packet.getByLabel('Observed harm').fill('The page solicited account credentials using the affected party name and logo.');
  await openPacketWizardStep(packet, 'Review');
  await expect(packet).toContainText('Material inputs changed after review');
  await packet.getByRole('button', { name: 'Review and bind exact inputs' }).click();
  for (const confirmation of [
    'I reviewed the exact selected evidence.',
    'I reviewed the recipient and scope.',
    'I reviewed privacy and redactions.',
    'I confirm analyst authority for this scope.',
    'I reviewed evidence freshness and retained cautions.',
  ]) await packet.getByRole('checkbox', { name: confirmation }).check();
  await expect(packet.getByLabel('Confirmation time')).toBeEnabled();
  await packet.getByRole('button', { name: 'Authorise exact bound inputs' }).click();
  await openPacketWizardStep(packet, 'Review');
  await expect(packet.getByLabel('Confirmation time')).not.toHaveValue('');
  await openPacketWizardStep(packet, 'Export and record');
  await expect(packet).toContainText('The current exact inputs are authorised for deliberate local export.');

  const downloadPromise = page.waitForEvent('download');
  await packet.getByRole('button', { name: 'Export JSON draft or authorised packet' }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exported = JSON.parse(await readFile(downloadPath!, 'utf8'));
  expect(exported).toMatchObject({
    schema: 'whoisleuth.case-response-packet',
    reviewRequired: true,
    submissionPerformed: false,
    schemaVersion: 8,
    profile: {
      id: 'registrar',
      audience: 'Domain registrar abuse or compliance team',
    },
    incident: {
      category: 'Credential phishing',
      affectedParty: 'Example service',
      abusiveUrls: ['https://response.invalid/sign-in'],
    },
    provenance: { evidencePinCount: 1, decisionCount: 1 },
    escalationHistory: [{
      type: 'registrar_report',
      recipient: 'Registrar abuse desk',
      state: 'authorised',
      providerOutcome: null,
    }],
    readiness: { profileId: 'registrar' },
    artefactReferences: [{ label: 'Reviewed static capture metadata', byteLength: 1024 }],
    authorisation: { status: 'authorised', digestMatches: true, missingConfirmations: [] },
    responseLifecycle: {
      latestProviderOutcome: null,
      latestObservedEffect: null,
      latestObservedChangeAt: null,
    },
    preflight: {
      status: 'review_cautions',
      canExport: true,
      actionSummary: {
        total: 1,
        active: 1,
      },
    },
    integrity: {
      algorithm: 'SHA-256',
      canonicalization: 'sorted-json-v2',
      scope: 'packet excluding integrity',
    },
  });
  expect(exported.escalationHistory[0].transitions).toHaveLength(4);
  expect(exported.readiness.rows).toHaveLength(10);
  expect(exported.integrity.digestSha256).toMatch(/^[a-f0-9]{64}$/u);
  await expect(caseWorkspaceActionStatus(page)).toContainText('Nothing was submitted');
  await packet.getByRole('button', { name: 'Continue to record delivery' }).click();
  const quickResponse = workspace.locator('.quick-workspace');
  await expect(quickResponse.getByLabel('Delivery reference')).toHaveValue(`response-packet-sha256:${exported.integrity.digestSha256}`);
  await expect(caseWorkspaceActionStatus(page)).toContainText('Prepared the delivery record');
  await quickResponse.getByRole('button', { name: 'Mark sent' }).click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('Mark sent recorded');

  await workspace.getByRole('button', { name: 'Advanced', exact: true }).click();
  await action.getByText('Track append-only response actions', { exact: true }).click();
  await action.getByRole('button', { name: 'Review or append event' }).click();
  await action.getByLabel('Event source').selectOption('provider');
  await action.getByLabel('Next state').selectOption('acknowledged');
  await action.getByLabel('Bounded reference').fill('CASE-EXAMPLE-101');
  await action.getByLabel('Typed provider outcome').selectOption('accepted_for_review');
  await action.getByLabel('Provider outcome detail').fill('The provider acknowledged the bounded report for review.');
  await action.getByLabel('Event limitations').fill('Acknowledgement is not independent remediation evidence.');
  await action.getByRole('button', { name: 'Append transition' }).click();
  await expect(action).toContainText('registrar report · acknowledged');
  await expect(action).toContainText('Latest typed provider outcome: accepted for review');
  await expect(action.locator('.transition-timeline > li')).toHaveCount(6);

  const remediation = workspace.locator('details', { hasText: 'Verify remediation independently and close deliberately' });
  await remediation.getByText('Verify remediation independently and close deliberately', { exact: true }).click();
  await expect(remediation).toContainText('accepted for review');
  await expect(remediation).toContainText('Withheld — missing');
  await remediation.getByLabel('Observed effect').selectOption('changed');
  await remediation.getByLabel('Separately attributed source').fill('Independent fixture review');
  await remediation.getByLabel('Completeness').selectOption('complete');
  await remediation.getByLabel('Evidence pin').selectOption({ index: 1 });
  await remediation.getByLabel('Limitations').first().fill('The independent check covers only the retained exact URL.');
  await remediation.getByRole('button', { name: 'Record independent review' }).click();
  await expect(remediation.getByRole('list', { name: 'Independent observed-effect reviews' })).toContainText('changed');
  await expect(remediation).not.toContainText('Withheld — no independent changed review');
  await remediation.getByLabel('Closure reason').selectOption('infrastructure_changed');
  await remediation.getByLabel('Independent review').selectOption({ index: 1 });
  await remediation.getByLabel('Provider action').selectOption({ index: 1 });
  await remediation.getByLabel('Closure summary').fill('Independent review recorded a bounded infrastructure change.');
  await remediation.getByLabel('Closure limitations').fill('Closure is not a safety or provider-performance conclusion.');
  await remediation.getByRole('button', { name: 'Close case with reason' }).click();
  await expect(remediation.getByRole('list', { name: 'Deliberate case closures' })).toContainText('infrastructure changed');

  const persisted = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  const stored = requiredValue(persisted.records.find((item) => item.value.domain === 'response.invalid'), 'The response-lifecycle Case is missing.').value;
  const storedAction = requiredValue(stored.actions[0], 'The response action is missing.');
  expect(stored.status).toBe('resolved');
  expect(storedAction).toMatchObject({ state: 'acknowledged', providerOutcome: 'accepted_for_review', reference: 'CASE-EXAMPLE-101' });
  expect(storedAction.history).toHaveLength(6);
  expect(stored.observedEffects.reviews).toHaveLength(1);
  expect(stored.observedEffects.reviews[0]).toMatchObject({ state: 'changed', source: 'Independent fixture review' });
  expect(stored.closures.records).toHaveLength(1);
  expect(stored.closures.records[0]).toMatchObject({ reason: 'infrastructure_changed' });

  await page.reload();
  await page.getByRole('tab', { name: /Cases/ }).click();
  await expect(page.locator('.case-head', { hasText: 'response.invalid' })).toHaveAttribute('aria-expanded', 'true');
  const restoredWorkspace=await openCaseResponseWorkspace(page);
  await expect(restoredWorkspace).toContainText('1 pin · 0 sightings · 1 decision · 0 assertions · 1 action · 1 branch');
  await expect(restoredWorkspace).toContainText('Registrar response path');
  await expect(restoredWorkspace).toContainText('registrar report · acknowledged');
});
