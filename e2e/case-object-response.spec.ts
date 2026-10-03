import { expect, test } from './fixtures';
import { createCase, updateCase } from '../packages/cases/case-record-operations.mts';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
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
      await openCaseClassification(page); await coverage.scrollIntoViewIfNeeded();
      await expect(coverage.getByRole('table')).toBeVisible(); await expectNoHorizontalOverflow(page);
    }
  }
});
