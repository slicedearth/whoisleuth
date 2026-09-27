import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { caseRecord, openSeededTimelineCase, openCaseResponseWorkspace } from './case-test-fixtures';
import { currentActionFixture, caseWorkspaceActionStatus } from './case-response-fixtures';
import { expectNoHorizontalOverflow, failNextBrowserLocalManifestWrite, readBrowserLocalCollection, useTheme } from './helpers';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';

test('requested evidence preserves failed drafts and creates a separately reviewed amendment to the exact original packet', async ({ page }, testInfo) => {
  await page.clock.setFixedTime('2026-09-23T10:00:00.000Z');
  const at = '2026-09-20T10:00:00.000Z';
  const digest = 'a'.repeat(64);
  const action = currentActionFixture({ id: 'original-report', type: 'internal_review', recipient: 'Example response desk',
    contactSource: 'Analyst reviewed contact', routeObservedAt: at, contactLimitations: [], dueAt: null,
    targetState: 'acknowledged', reference: 'Original provider receipt', followUpAt: null, outcome: 'Received',
    createdAt: at, updatedAt: '2026-09-20T10:05:00.000Z' });
  action.history.find(event => event.nextState === 'submitted')!.reference = `response-packet-sha256:${digest}`;
  const record = caseRecord({ domain: 'requested-evidence.example.test', actions: [action], evidencePins: [{
    id: 'requested-pin', checkpointId: null, field: 'http.status', category: 'http', label: 'Observed page', value: 'A retained observation',
    source: 'Fixture observation', sourceState: 'complete', sourceSchema: null, observedAt: at, collectionDepth: 'deep',
    completeness: 'complete', truncated: false, transitionExpectation: null, limitations: [], createdAt: at,
  }] });
  await openSeededTimelineCase(page, record.domain, [record], CASE_SCHEMA_VERSION);
  await openCaseResponseWorkspace(page, '', 'quick', 'Response');
  const stage = page.getByRole('region', { name: 'Case response actions', exact: true });
  const outer = stage.locator('details').first();
  if (!await outer.evaluate(element => element.hasAttribute('open'))) await outer.locator('summary').first().click();
  const region = stage.locator('.requested-evidence');
  await region.locator('summary').first().click();
  const form = region.getByRole('form', { name: 'Requested evidence review', exact: true });
  await form.getByRole('combobox', { name: 'Submitted action', exact: true }).selectOption(action.id);
  await form.getByRole('combobox', { name: 'Original submitted packet', exact: true }).selectOption(digest);
  await form.getByLabel('Evidence requested', { exact: true }).fill('Provide the retained page evidence');
  await form.getByLabel('Provider deadline').fill('2026-09-22T12:00');
  await form.getByLabel('Provider request reference', { exact: true }).fill('Private provider request');
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  await failNextBrowserLocalManifestWrite(page, 'cases');
  await form.getByRole('button', { name: 'Record evidence request', exact: true }).click();
  await expect(caseWorkspaceActionStatus(page)).toContainText(/not changed|could not|failed/i);
  await expect(form.getByLabel('Evidence requested', { exact: true })).toHaveValue('Provide the retained page evidence');
  expect((await readBrowserLocalCollection(page, 'cases')).records).toEqual(before.records);
  await form.getByRole('button', { name: 'Record evidence request', exact: true }).click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('Recorded the provider evidence request.');
  await expect(region.getByRole('list', { name: 'Requested evidence', exact: true })).toContainText('overdue');
  await region.getByRole('button', { name: 'Review requested evidence', exact: true }).click();
  await expect(form.getByRole('combobox', { name: 'Evidence preparation', exact: true })).toBeFocused();
  await form.getByRole('checkbox', { name: 'Observed page · Fixture observation', exact: true }).check();
  await form.getByLabel('Preparation or unavailability reason', { exact: true }).fill('The selected source supplies the requested fact.');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const [width, height] of [[320, 700], [390, 844], [1024, 768], [1280, 720], [2560, 1440], [3840, 2160]] as const) {
      await page.setViewportSize({ width, height });
      await expectNoHorizontalOverflow(page);
      expect((await new AxeBuilder({ page }).include('.requested-evidence').analyze()).violations).toEqual([]);
      if (captureVisualEvidenceEnabled()) { await region.screenshot({ path: testInfo.outputPath(`requested-evidence-${theme}-${width}.png`) }); }
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await form.getByRole('button', { name: 'Save evidence preparation', exact: true }).click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('Recorded the requested-evidence review.');
  await region.getByRole('button', { name: 'Create drafting amendment', exact: true }).click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('Created a drafting amendment.');
  const stored = (await readBrowserLocalCollection(page, 'cases')).records[0]!.value;
  const original = stored.actions.find(item => item.id === action.id)!;
  const amendment = stored.actions.find(item => item.amendment)!;
  expect(amendment.state).toBe('drafting');
  expect(amendment.originActionId).toBe(action.id);
  expect(amendment.amendment!.packetDigestSha256).toBe(digest);
  expect(original.history.slice(0, action.history.length)).toEqual(action.history);
  const requestEvents = original.history.filter(event => event.evidenceRequest);
  expect(requestEvents.map(event => event.evidenceRequest!.state).sort()).toEqual(['prepared', 'requested']);
  expect(requestEvents.find(event => event.evidenceRequest!.state === 'prepared')!.evidenceRequest!.previousEventIds)
    .toEqual([requestEvents.find(event => event.evidenceRequest!.state === 'requested')!.id]);
  expect(amendment.history.some(event => event.nextState === 'submitted')).toBe(false);
  await expect(region.getByText('Delivery recorded', { exact: true })).toHaveCount(0);
  await region.getByRole('button', { name: 'Review amendment · drafting', exact: true }).click();
  await expect(stage.getByRole('button', { name: 'Update metadata', exact: true })).toBeVisible();
});
