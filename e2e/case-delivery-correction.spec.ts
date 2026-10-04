import AxeBuilder from '@axe-core/playwright';
import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import { expect, test } from './fixtures';
import { openSeededTimelineCase, openCaseResponseWorkspace } from './case-test-fixtures';
import { caseWorkspaceActionStatus } from './case-response-fixtures';
import { expectNoHorizontalOverflow, failNextBrowserLocalManifestWrite, readBrowserLocalCollection, useTheme } from './helpers';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
import { correctionFixture } from '../test/case-delivery-correction-fixture.mts';
import { normalizeCaseStore, buildCaseExport } from '../packages/cases/case-model.mts';

test('exact delivery correction preserves originals through cancel, failed save, new draft and reload', async ({ page }, testInfo) => {
  await page.clock.setFixedTime('2026-10-03T12:00:00.000Z');
  const s = correctionFixture(), first = await s.deliver(), second = await s.deliver();
  s.transition(s.originalId, 'submitted', { reference: `response-packet-sha256:${'c'.repeat(64)}`, responseObjects: s.objects });
  const original = structuredClone(s.record.actions[0]!);
  await openSeededTimelineCase(page, s.record.domain, [s.record], CASE_SCHEMA_VERSION);
  await openCaseResponseWorkspace(page, '', 'quick', 'Response');
  const stage = page.getByRole('region', { name: 'Case response actions', exact: true });
  const outer = stage.locator('details').first();
  if (!await outer.evaluate(element => element.hasAttribute('open'))) await outer.locator('summary').first().click();
  const region = stage.locator('.correction');
  await region.locator('summary').first().click();
  await expect(region).toContainText('1 digest-only delivery record lacks an exact packet receipt');
  const form = region.getByRole('form', { name: 'Linked correction preparation', exact: true });
  const deliverySelect = form.getByRole('combobox', { name: 'Original delivery', exact: true });
  await expect(deliverySelect.locator('option')).toHaveCount(3);
  await expect(deliverySelect).toHaveValue('');
  await deliverySelect.selectOption(`${s.originalId}|${first.event.id}`);
  await expect(region).toContainText(first.receipt.packetDigestSha256);
  await form.getByLabel('Analyst reason', { exact: true }).fill('The retained capture was interpreted too broadly.');
  await form.getByLabel('Precise previous statement', { exact: true }).fill('The form accepted real credentials.');
  await form.getByLabel('Corrected statement', { exact: true }).fill('Only a demonstration form is established by the retained capture.');
  await form.getByRole('checkbox', { name: `page · ${s.objects[0]!.identifier}`, exact: true }).check();
  await form.getByRole('checkbox', { name: 'Correction observation · Fixture corrected capture', exact: true }).check();
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  await form.getByRole('button', { name: 'Preview linked correction', exact: true }).click();
  await expect(region.getByRole('heading', { name: 'Review the new linked draft', exact: true })).toBeFocused();
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1280, 1920]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(region.getByRole('region', { name: 'Linked correction preview' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) {
        await region.getByRole('heading', { name: 'Review the new linked draft', exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`delivery-correction-${theme}-${width}.png`) });
      }
    }
    expect((await new AxeBuilder({ page }).include('.correction').analyze()).violations).toEqual([]);
  }
  await region.getByRole('button', { name: 'Cancel correction preview', exact: true }).click();
  expect((await readBrowserLocalCollection(page, 'cases')).records).toEqual(before.records);
  await expect(form.getByLabel('Corrected statement', { exact: true })).toHaveValue('Only a demonstration form is established by the retained capture.');
  await form.getByRole('button', { name: 'Preview linked correction', exact: true }).click();
  await failNextBrowserLocalManifestWrite(page, 'cases');
  await region.getByRole('button', { name: 'Create linked draft', exact: true }).click();
  await expect(caseWorkspaceActionStatus(page)).toContainText(/not changed|could not|failed/i);
  expect((await readBrowserLocalCollection(page, 'cases')).records).toEqual(before.records);
  await expect(form.getByLabel('Analyst reason', { exact: true })).toHaveValue('The retained capture was interpreted too broadly.');
  await region.getByRole('button', { name: 'Create linked draft', exact: true }).click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('Created an unreviewed linked draft.');
  const saved = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  const restored = normalizeCaseStore({ version: CASE_SCHEMA_VERSION, cases: saved.records.map(row => row.value) }).cases[0]!;
  expect(restored.actions.find(action => action.id === s.originalId)).toEqual(original);
  const correction = restored.actions.find(action => action.correction)!;
  expect(correction.state).toBe('drafting'); expect(correction.correction?.deliveryEventId).toBe(first.event.id);
  expect(correction.correction?.packetDigestSha256).toBe(first.receipt.packetDigestSha256);
  expect(correction.correction?.packetDigestSha256).not.toBe(second.receipt.packetDigestSha256);
  expect(correction.responseObjects).toEqual([s.objects[0]]);
  expect(correction.history.some(event => event.nextState === 'submitted' || event.evidenceRequest)).toBe(false);
  expect(restored.observedEffects.reviews).toEqual([]); expect(restored.closures.records).toEqual([]);
  await page.reload();
  await openCaseResponseWorkspace(page, '', 'quick', 'Response');
  expect((await readBrowserLocalCollection(page, 'cases')).records).toEqual(saved.records);
  const roundTrip = normalizeCaseStore(JSON.parse(JSON.stringify(buildCaseExport([restored], '2026-10-03T12:00:00.000Z')))).cases[0]!;
  expect(roundTrip.actions).toEqual(restored.actions);
});
