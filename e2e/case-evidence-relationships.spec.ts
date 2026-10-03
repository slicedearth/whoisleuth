import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures';
import { caseRecord, openSeededTimelineCase, openCaseResponseWorkspace } from './case-test-fixtures';
import { caseWorkspaceActionStatus } from './case-response-fixtures';
import { expectNoHorizontalOverflow, failNextBrowserLocalManifestWrite, readBrowserLocalCollection, useTheme } from './helpers';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';

test('analysts link and withdraw retained evidence without changing observations or losing a failed draft', async ({ page }, info) => {
  const at = '2026-09-23T01:00:00.000Z';
  const record = caseRecord({ domain: 'related.example.test', evidencePins: ['Source page', 'Extracted link'].map((label, index) => ({
    id: `pin-${index}`, checkpointId: null, field: null, category: null, label, value: label,
    source: 'Selected document', sourceState: 'partial', sourceSchema: null, observedAt: null, collectionDepth: 'unknown',
    completeness: 'partial', truncated: false, transitionExpectation: null, certificateObservation: null, limitations: [], createdAt: at,
  })) });
  await openSeededTimelineCase(page, record.domain, [record], CASE_SCHEMA_VERSION);
  await openCaseResponseWorkspace(page, '', 'quick', 'Evidence');
  const section = page.locator('.evidence-relationships');
  await section.locator(':scope > summary').click();
  await section.getByText('Shared retained context · 1 group', { exact: true }).click();
  await expect(section).toContainText('Same declared source: Selected document');
  const form = section.getByRole('form', { name: 'Record evidence relationship', exact: true });
  await form.getByRole('combobox', { name: 'Evidence pin', exact: true }).selectOption('pin-1');
  await form.getByRole('combobox', { name: 'Source evidence pin', exact: true }).selectOption('pin-0');
  await form.getByLabel('Attribution basis', { exact: true }).fill('The analyst extracted this link from the retained page.');
  const before = await readBrowserLocalCollection(page, 'cases');
  await failNextBrowserLocalManifestWrite(page, 'cases');
  await form.getByRole('button', { name: 'Record relationship', exact: true }).click();
  await expect(caseWorkspaceActionStatus(page)).toContainText(/not changed|could not|failed/i);
  await expect(form.getByLabel('Attribution basis', { exact: true })).toHaveValue('The analyst extracted this link from the retained page.');
  expect((await readBrowserLocalCollection(page, 'cases')).records).toEqual(before.records);
  await form.getByRole('button', { name: 'Record relationship', exact: true }).click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('Recorded the analyst-declared evidence relationship.');
  await expect(form.getByRole('button', { name: 'Record relationship', exact: true })).toBeFocused();
  const retained = (await readBrowserLocalCollection(page, 'cases')).records[0]!.value;
  expect(retained.evidencePins).toEqual(record.evidencePins);
  expect(retained.evidenceLinks).toHaveLength(1);
  const list = section.getByRole('list', { name: 'Analyst-declared evidence relationships', exact: true });
  await expect(list).toContainText('Extracted link derived from Source page');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const [width, height] of [[320, 700], [390, 844], [1024, 768], [1280, 720], [2560, 1440], [3840, 2160]] as const) {
      await page.setViewportSize({ width, height });
      await expectNoHorizontalOverflow(page);
      expect((await new AxeBuilder({ page }).include('.evidence-relationships').analyze()).violations).toEqual([]);
      if (captureVisualEvidenceEnabled()) { await section.screenshot({ path: info.outputPath(`evidence-relationships-${theme}-${width}.png`) }); }
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await section.getByText('Withdraw a relationship', { exact: true }).click();
  const withdrawal = section.getByRole('form', { name: 'Withdraw evidence relationship', exact: true });
  await withdrawal.getByLabel('Relationship to withdraw', { exact: true }).selectOption(retained.evidenceLinks![0]!.id);
  await withdrawal.getByLabel('Withdrawal reason', { exact: true }).fill('The original attribution needs correction.');
  await withdrawal.getByRole('button', { name: 'Withdraw relationship', exact: true }).click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('Withdrew the relationship');
  await expect(section.getByLabel('Include withdrawn relationships', { exact: true })).toBeFocused();
  await expect(list.getByRole('listitem')).toHaveCount(0);
  await section.getByLabel('Include withdrawn relationships', { exact: true }).check();
  await expect(list).toContainText('The original attribution needs correction.');
  const final = (await readBrowserLocalCollection(page, 'cases')).records[0]!.value;
  expect(final.evidenceLinks![0]!.basis).toBe(retained.evidenceLinks![0]!.basis);
  expect(final.evidencePins).toEqual(record.evidencePins);
});
