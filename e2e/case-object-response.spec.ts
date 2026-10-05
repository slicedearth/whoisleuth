import { expect, test } from './fixtures';
import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import { createCase, updateCase } from '../packages/cases/case-record-operations.mts';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
import { buildCaseExport } from '../packages/cases/case-storage-model.mts';
import { openSeededTimelineCase, openCaseResponseWorkspace } from './case-test-fixtures';
import { openCaseClassification, openCaseSection } from './console-navigation';
import { caseWorkspaceActionStatus } from './case-response-fixtures';
import { expectNoHorizontalOverflow, failNextBrowserLocalManifestWrite, failNextBrowserLocalCollectionReadAfterWrite, readBrowserLocalCollection, useTheme } from './helpers';

const before = '2026-09-01T10:00:00.000Z', after = '2026-09-02T10:00:00.000Z';
function fixture() {
  let record = createCase({ domain: 'object-response.example', incidentTarget: 'https://object-response.example/one' }, before);
  record = updateCase([record], record.id, { incidentTarget: 'https://object-response.example/two' }, before).record;
  const objects = record.workflowMetadata!.incidentTargets.map(target => ({ kind: 'page' as const, identifier: target.url, incidentTargetId: target.id }));
  record = updateCase([record], record.id, { action: { type: 'network_hosting_report', recipient: 'Example response desk', contactSource: 'Reviewed fixture route', responseObjects: objects } }, before).record;
  for (const nextState of ['ready_for_review', 'reviewed', 'authorised', 'submitted', 'acknowledged']) record = updateCase([record], record.id, {
    actionUpdate: { id: record.actions[0]!.id, transition: { nextState, sourceClass: nextState === 'acknowledged' ? 'provider' : 'analyst', provenance: 'Fixture manual event' } },
  }, before).record;
  return { record, objects };
}

test('exact affected subset survives failed writes and committed refresh failure without duplicating the shared receipt', async ({ page }) => {
  const { record, objects } = fixture();
  await page.clock.setFixedTime(after);
  await openSeededTimelineCase(page, record.domain, [record], CASE_SCHEMA_VERSION);
  await openCaseResponseWorkspace(page, '', 'quick'); await openCaseSection(page, 'Response');
  const form = page.getByRole('form', { name: 'Record response event', exact: true });
  const subset = form.getByRole('listbox', { name: 'Objects affected by the provider result', exact: true });
  await expect(subset).toBeVisible();
  await form.getByRole('combobox', { name: 'Provider outcome', exact: true }).selectOption('partially_remediated');
  await expect(form.getByRole('button', { name: 'Record final provider outcome', exact: true })).toBeDisabled();
  await subset.selectOption(objects.map(object => JSON.stringify(object)));
  await expect(form.getByRole('button', { name: 'Record final provider outcome', exact: true })).toBeEnabled();
  await subset.selectOption([]);
  await form.getByRole('combobox', { name: 'Provider outcome', exact: true }).selectOption('provider_reports_resolved');
  const submit = form.getByRole('button', { name: 'Record final provider outcome', exact: true });
  await expect(submit).toBeDisabled();
  await subset.selectOption(JSON.stringify(objects[0]));
  await form.getByRole('combobox', { name: 'Reported object outcome', exact: true }).selectOption('removed');
  await form.getByLabel('Reference', { exact: true }).fill('EXAMPLE-SHARED-RECEIPT');
  const initial = await readBrowserLocalCollection(page, 'cases');
  await failNextBrowserLocalManifestWrite(page, 'cases'); await submit.click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('out of storage space');
  await expect(subset).toHaveValues([JSON.stringify(objects[0])]);
  expect((await readBrowserLocalCollection(page, 'cases')).manifest.revision).toBe(initial.manifest.revision);
  await failNextBrowserLocalCollectionReadAfterWrite(page, 'cases');
  await submit.focus(); await page.keyboard.press('Enter');
  await expect(caseWorkspaceActionStatus(page)).toContainText('The change was saved, but Cases could not be reread');
  await expect(form).toContainText('This action is terminal');
  const saved = (await readBrowserLocalCollection(page, 'cases')).records[0]!.value;
  expect(saved.actions).toHaveLength(1);
  expect(saved.actions[0]!.history.filter(event => event.reference === 'EXAMPLE-SHARED-RECEIPT')).toEqual([expect.objectContaining({ responseObjects: [objects[0]], objectOutcome: 'removed', sourceClass: 'provider' })]);
  expect(saved.actions[0]!.responseObjects).toEqual(objects); expect(saved.observedEffects.reviews).toEqual([]);
  expect(saved.status).not.toBe('closed');
});

test('closure selector follows exact-object provider history rather than the action-wide latest status', async ({ page }) => {
  const fixtureValue = fixture(); let record = fixtureValue.record;
  const objects = fixtureValue.objects;
  for (const [index, providerOutcome, occurredAt] of [
    [0, 'provider_reports_resolved', '2026-09-02T10:00:00.000Z'],
    [1, 'partially_remediated', '2026-09-03T10:00:00.000Z'],
  ] as const) record = updateCase([record], record.id, { actionUpdate: { id: record.actions[0]!.id, transition: {
    nextState: 'acknowledged', sourceClass: 'provider', provenance: 'Reviewed exact-object receipt',
    providerOutcome, responseObjects: [objects[index]], occurredAt,
  } } }, occurredAt).record;
  await page.clock.setFixedTime('2026-09-04T10:00:00.000Z');
  await openSeededTimelineCase(page, record.domain, [record], CASE_SCHEMA_VERSION);
  await openCaseResponseWorkspace(page, '', 'advanced'); await openCaseSection(page, 'Response');
  const outcome = page.getByRole('region', { name: 'Case independent review and closure', exact: true });
  await outcome.locator(':scope > details > summary').click();
  const closure = outcome.locator('form.closure-form');
  await closure.getByRole('combobox', { name: 'Closure reason', exact: true }).selectOption('provider_reported_resolution_not_independently_checked');
  const action = closure.getByRole('combobox', { name: 'Provider action', exact: true });
  await closure.getByRole('combobox', { name: 'Closure scope', exact: true }).selectOption(JSON.stringify(objects[1]));
  await expect(action.locator('option')).toHaveCount(1);
  await closure.getByRole('combobox', { name: 'Closure scope', exact: true }).selectOption(JSON.stringify(objects[0]));
  await expect(action.locator('option')).toHaveCount(2);
  await action.selectOption(record.actions[0]!.id);
  await closure.getByRole('textbox', { name: 'Closure summary', exact: true }).fill('Provider reported this exact page resolved.');
  await closure.getByRole('button', { name: 'Record object closure', exact: true }).click();
  await expect.poll(async () => (await readBrowserLocalCollection(page, 'cases')).records[0]!.value.closures.records.length).toBe(1);
  const saved = (await readBrowserLocalCollection(page, 'cases')).records[0]!.value;
  expect(saved.closures.records[0]!.responseObject).toEqual(objects[0]);
  expect(saved.status).toBe(record.status);
  expect(saved.workflowMetadata!.incidentTargets[1]!.state).toBe('open');
});

for (const keepAuthored of [false, true]) test(`imported competing legal terminal receipts withhold new closure${keepAuthored ? ' and preserve an authored closure' : ''} in the real selector and storage`,async({page})=>{
  const {record,objects}=fixture();
  const branch=(resolved:boolean,id:string)=>{
    const value=updateCase([record],record.id,{actionUpdate:{id:record.actions[0]!.id,transition:{nextState:'terminal',sourceClass:'provider',provenance:'Independent exact-object receipt',providerOutcome:resolved?'provider_reports_resolved':'partially_remediated',objectOutcome:resolved?'removed':'restored',responseObjects:[objects[0]!],occurredAt:after}}},after).record;
    value.actions[0]!.history.at(-1)!.id=id; return value;
  };
  let resolved=branch(true,keepAuthored?'receipt-z':'receipt-a');
  const conflicting=branch(false,keepAuthored?'receipt-a':'receipt-z');
  if (keepAuthored) resolved = updateCase([resolved], resolved.id, { closure: { reason: 'provider_reported_resolution_not_independently_checked', summary: 'Earlier deliberate closure from the provider receipt.', actionId: resolved.actions[0]!.id, responseObject: objects[0] } }, after).record;
  const authored = structuredClone(resolved.closures.records);
  await page.clock.setFixedTime('2026-09-04T10:00:00.000Z');
  await openSeededTimelineCase(page,record.domain,[resolved],CASE_SCHEMA_VERSION);
  await page.getByRole('link',{name:'All Cases',exact:true}).click();
  await page.getByRole('region',{name:'Case workspace controls'}).getByLabel('Import JSON',{exact:true}).setInputFiles({name:'conflicting-case.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(buildCaseExport([conflicting],'2026-09-03T00:00:00.000Z')))});
  await expect(caseWorkspaceActionStatus(page)).toContainText('Imported 0 new and 1 merged cases');
  await page.locator('.case-head',{hasText:record.domain}).click();
  await openCaseResponseWorkspace(page,'','advanced'); await openCaseSection(page,'Response');
  const outcome=page.getByRole('region',{name:'Case independent review and closure',exact:true});
  await outcome.locator(':scope > details > summary').click();
  const closure=outcome.locator('form.closure-form');
  await closure.getByRole('combobox',{name:'Closure reason',exact:true}).selectOption('provider_reported_resolution_not_independently_checked');
  await closure.getByRole('combobox',{name:'Closure scope',exact:true}).selectOption(JSON.stringify(objects[0]));
  const action=closure.getByRole('combobox',{name:'Provider action',exact:true});
  await expect(action.locator('option')).toHaveCount(1);
  await closure.getByRole('textbox',{name:'Closure summary',exact:true}).fill('This conflicted receipt cannot support a closure.');
  const beforeSave=await readBrowserLocalCollection(page,'cases');
  await closure.getByRole('button',{name:'Record object closure',exact:true}).click();
  await expect(action).toBeFocused();
  expect(await action.evaluate(element=>(element as HTMLSelectElement).validity.valueMissing)).toBe(true);
  const afterSave=await readBrowserLocalCollection(page,'cases');
  expect(afterSave.manifest.revision).toBe(beforeSave.manifest.revision);
  const saved=afterSave.records[0]!.value;
  expect(saved.actions[0]!.history.filter(event=>event.nextState==='terminal')).toHaveLength(2);
  expect(saved.actions[0]!.history.filter(event=>event.nextState==='terminal'&&!event.applied)).toHaveLength(1);
  expect(saved.closures.records).toEqual(authored); expect(saved.status).toBe(record.status);
  if (keepAuthored) {
    const history = outcome.getByRole('list', { name: 'Deliberate case closures', exact: true });
    await expect(history).toContainText(authored[0]!.summary);
    await expect(history).toContainText('As of the latest retained receipt');
    await expect(history).toContainText('This historical analyst decision is preserved');
    for (const theme of ['light', 'dark'] as const) for (const width of [320, 390, 1280]) {
      await useTheme(page, theme); await page.setViewportSize({ width, height: 900 });
      await history.scrollIntoViewIfNeeded(); await expect(history).toBeVisible(); await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) await history.screenshot({ path: test.info().outputPath(`closure-history-${theme}-${width}.png`) });
    }
    await page.reload(); await openCaseResponseWorkspace(page, '', 'quick'); await openCaseSection(page, 'Response');
    await expect(page.getByRole('list', { name: 'Deliberate case closures', exact: true })).toContainText(authored[0]!.summary);
    expect((await readBrowserLocalCollection(page, 'cases')).records[0]!.value.closures.records).toEqual(authored);
  }
});

test('object authoring and qualified coverage remain available with native keyboard controls and bounded layout', async ({ page }) => {
  const { record, objects } = fixture();
  await openSeededTimelineCase(page, record.domain, [record], CASE_SCHEMA_VERSION);
  const workspace = await openCaseResponseWorkspace(page, '', 'advanced'); await openCaseSection(page, 'Response');
  const actions = workspace.getByRole('region', { name: 'Case response actions', exact: true });
  const disclosure = actions.locator(':scope > details');
  if (!await disclosure.evaluate(element => (element as HTMLDetailsElement).open)) await disclosure.locator(':scope > summary').click();
  const binding = actions.getByRole('listbox', { name: 'Objects concerned by this action', exact: true });
  await expect(binding).toBeVisible(); await binding.selectOption(objects.map(object => JSON.stringify(object))); await binding.focus();
  await expect(binding).toBeFocused();
  await openCaseClassification(page);
  const coverage = page.locator('details.coverage').first();
  await expect(coverage).toBeAttached(); await coverage.locator(':scope > summary').click();
  await expect(coverage.getByRole('table')).toContainText(objects[0]!.identifier);
  await expect(coverage.getByRole('table')).toContainText(objects[1]!.identifier);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 }); await openCaseSection(page, 'Response'); await binding.scrollIntoViewIfNeeded();
      await expect(binding).toBeVisible(); await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) await page.screenshot({ path: test.info().outputPath(`object-authoring-${theme}-${width}.png`) });
      await openCaseClassification(page); await coverage.scrollIntoViewIfNeeded();
      await expect(coverage.getByRole('table')).toBeVisible(); await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) await page.screenshot({ path: test.info().outputPath(`object-coverage-${theme}-${width}.png`) });
    }
  }
});
