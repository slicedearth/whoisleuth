import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures';
import { caseRecord, openSeededTimelineCase, openCaseResponseWorkspace } from './case-test-fixtures';
import { caseWorkspaceActionStatus } from './case-response-fixtures';
import { expectNoHorizontalOverflow, failNextBrowserLocalManifestWrite, readBrowserLocalCollection, useTheme } from './helpers';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
import { normalizeCaseStore } from '../packages/cases/case-model.mts';
import type { CaseRecord } from '../packages/cases/case-record-contracts.mts';

test('source tracing follows selected claims without treating shared context or withdrawn paths as corroboration', async ({ page }, info) => {
  const at = '2026-09-23T01:00:00.000Z';
  const link = (id: string, fromPinId: string, toPinId: string, basis: string) => ({ id, fromPinId, toPinId, kind: 'derived_from' as const, basis, createdAt: at });
  const record: ReturnType<typeof caseRecord> & Pick<CaseRecord, 'evidenceLinks'> = { ...caseRecord({ domain: 'source-trace.example', evidencePins: ['Original page', 'Extracted link', 'Separate report', 'Context only'].map((label, index) => ({
    id: `pin-${index}`, checkpointId: index === 1 ? 'selected-checkpoint' : null, field: null, category: null, label, value: label,
    source: 'Selected document', sourceState: 'partial', sourceSchema: null, observedAt: index === 0 ? '2026-09-22T00:00:00.000Z' : null, collectionDepth: 'unknown',
    completeness: 'partial', truncated: false, transitionExpectation: null, certificateObservation: null, limitations: [], createdAt: at,
  })) }), evidenceLinks: [
    link('extraction', 'pin-1', 'pin-0', 'Extracted from the selected page.'),
    link('reverse', 'pin-0', 'pin-1', 'Conflicting imported attribution.'),
    link('missing', 'pin-0', 'not-retained', 'The original source was not supplied.'),
    { ...link('withdrawn', 'pin-1', 'pin-2', 'Retired attribution.'), withdrawal: { at, reason: 'The relationship was not established.' } },
    link('beyond', 'pin-2', 'pin-3', 'Beyond the withdrawn connection.'),
    ...Array.from({ length: 13 }, (_, index) => link(`other-${index}`, 'pin-2', `unretained-${index}`, `Separate source ${index + 1}.`)),
  ], assertions: [
    { id: 'claim', kind: 'hypothesis', statement: 'The retained link needs review.', rationale: null, evidencePinIds: ['pin-1'], evidenceRelations: [{ evidencePinId: 'pin-1', stance: 'supports' }], state: 'open', createdAt: at, updatedAt: at },
    { id: 'unlinked', kind: 'hypothesis', statement: 'A claim without linked evidence.', rationale: null, evidencePinIds: [], evidenceRelations: [], state: 'open', createdAt: at, updatedAt: at },
  ], decisions: [{ id: 'decision', summary: 'Review the separate report.', rationale: 'Keep the collection methods distinct.', confidence: 'unknown', confidenceBasis: 'Not assessed.', evidencePinIds: ['pin-2'], createdAt: at }] };
  expect(normalizeCaseStore({ version: CASE_SCHEMA_VERSION, cases: [record] }).cases[0]?.assertions).toEqual(record.assertions);
  expect(normalizeCaseStore({ version: CASE_SCHEMA_VERSION, cases: [record] }).cases[0]?.evidenceLinks).toEqual(record.evidenceLinks);
  await openSeededTimelineCase(page, record.domain, [record], CASE_SCHEMA_VERSION);
  await openCaseResponseWorkspace(page, '', 'quick', 'Evidence');
  const before = await readBrowserLocalCollection(page, 'cases');
  const requests: string[] = []; page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
  const section = page.locator('.evidence-relationships'); await section.locator(':scope > summary').click();
  const focus = section.getByRole('combobox', { name: 'Trace sources for', exact: true });
  const trace = section.getByRole('region', { name: 'Selected evidence source trace', exact: true });
  const list = section.getByRole('list', { name: 'Analyst-declared evidence relationships', exact: true });
  const basis = section.getByRole('form', { name: 'Record evidence relationship', exact: true }).getByLabel('Attribution basis', { exact: true });
  await basis.fill('Unsubmitted attribution draft.');
  await focus.selectOption('claim:claim');
  await expect(trace.getByRole('status').filter({ hasText: /^Active relationships in trace:/u })).toHaveText('Active relationships in trace: 3 · Related withdrawn relationships: 1');
  await expect(trace).toContainText('hypothesis · open');
  await expect(trace).toContainText('1 referenced evidence pin is not retained');
  await expect(trace).toContainText('Active derivations contain a cycle');
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(list).not.toContainText('Beyond the withdrawn connection.');
  await trace.getByText('Observation and reference trail · 3', { exact: true }).click();
  const observations = trace.getByRole('list', { name: 'Traced observation references', exact: true });
  await expect(observations.getByRole('listitem')).toHaveCount(3);
  await expect(observations.getByRole('listitem').nth(0)).toContainText('Selected checkpoint fact');
  await expect(observations.getByRole('listitem').nth(0)).toContainText('Unknown');
  const original = observations.getByRole('listitem').nth(1);
  await expect(original).toContainText('Reached through a retained source relationship');
  await expect(original.locator('time').nth(0)).toHaveAttribute('datetime', '2026-09-22T00:00:00.000Z');
  await expect(original.locator('time').nth(1)).toHaveAttribute('datetime', at);
  await expect(observations.getByRole('listitem').nth(2)).toContainText('Its source, content and observation time are unknown here');
  await expect(observations).not.toContainText('Separate report');
  await trace.getByText('Linked evidence (1)', { exact: true }).click();
  await expect(trace).toContainText('supports'); await expect(trace).toContainText('Extracted link');
  await section.getByText('Shared retained context · 1 group', { exact: true }).click();
  await expect(section).toContainText('not counts of independent sources');
  await section.getByLabel('Include withdrawn relationships', { exact: true }).check();
  await expect(list.getByRole('listitem')).toHaveCount(4);
  await expect(list).toContainText('The relationship was not established.');
  await expect(list).not.toContainText('Beyond the withdrawn connection.');
  await section.getByLabel('Include withdrawn relationships', { exact: true }).uncheck();

  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const [width, height] of [[320, 700], [1280, 720]] as const) {
      await page.setViewportSize({ width, height }); await focus.scrollIntoViewIfNeeded();
      await focus.focus(); await expect(focus).toBeFocused(); await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) {
        await page.screenshot({ path: info.outputPath(`source-trace-${theme}-${width}.png`) });
        await observations.screenshot({ path: info.outputPath(`observation-trail-${theme}-${width}.png`) });
      }
    }
    expect((await new AxeBuilder({ page }).include('.evidence-relationships').analyze()).violations).toEqual([]);
  }
  await focus.selectOption('decision:decision');
  await expect(trace.getByRole('status').filter({ hasText: /^Active relationships in trace:/u })).toHaveText('Active relationships in trace: 14 · Related withdrawn relationships: 1');
  await expect(list.getByRole('listitem')).toHaveCount(12);
  await expect(trace.getByText('Observation and reference trail · 15', { exact: true })).toBeVisible();
  await expect(observations).toBeVisible();
  await expect(observations.getByRole('listitem')).toHaveCount(12);
  await trace.getByRole('navigation', { name: 'Traced observations', exact: true }).getByRole('button', { name: 'Next', exact: true }).click();
  await expect(observations.getByRole('listitem')).toHaveCount(3);
  const pagination = section.getByRole('navigation', { name: 'Evidence relationships', exact: true });
  await pagination.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await focus.selectOption('pin:pin-3');
  await expect(trace).toContainText('No active source relationships are retained');
  await expect(trace).toContainText('This does not establish independence.');
  await expect(list.getByRole('listitem')).toHaveCount(0);
  await focus.selectOption('claim:unlinked');
  await expect(trace).toContainText('This record cites no evidence pins');
  await focus.selectOption('claim:claim');
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await focus.selectOption('');
  await expect(trace).toHaveCount(0);
  await expect(list.getByRole('listitem')).toHaveCount(12);
  await expect(basis).toHaveValue('Unsubmitted attribution draft.');
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before); expect(requests).toEqual([]);
});

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
