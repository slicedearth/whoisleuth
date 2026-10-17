import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { caseRecord, openSeededTimelineCase, openCaseResponseWorkspace } from './case-test-fixtures';
import { openCaseSection } from './console-navigation';
import { currentActionFixture, caseWorkspaceActionStatus } from './case-response-fixtures';
import { expectNoHorizontalOverflow, failNextBrowserLocalManifestWrite, readBrowserLocalCollection, useTheme } from './helpers';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';

test('Case completion retains concurrent evidence-request branches through reconciliation', async ({ page }) => {
  await page.clock.setFixedTime('2026-09-23T10:00:00.000Z');
  const at = '2026-09-20T10:00:00.000Z';
  const digest = 'a'.repeat(64);
  const action = currentActionFixture({ id: 'concurrent-report', type: 'internal_review', recipient: 'Example response desk',
    contactSource: 'Analyst reviewed contact', routeObservedAt: at, contactLimitations: [], dueAt: null,
    targetState: 'acknowledged', reference: 'Recorded provider receipt', followUpAt: null, outcome: 'Received',
    createdAt: at, updatedAt: at });
  action.history.find(event => event.nextState === 'submitted')!.reference = `response-packet-sha256:${digest}`;
  const request = { ...action.history.at(-1)!, id: 'original-request', previousState: 'acknowledged' as const,
    providerOutcome: 'more_information_requested' as const,
    evidenceRequest: { id: 'need-page', packetDigestSha256: digest, summary: 'Provide the retained page evidence',
      dueAt: null, state: 'requested' as const, evidencePinIds: [], rationale: '', previousEventIds: [] } };
  const first = { ...request, id: 'prepared-one', sourceClass: 'analyst' as const, providerOutcome: null,
    evidenceRequest: { ...request.evidenceRequest, state: 'prepared' as const, evidencePinIds: ['retained-pin'],
      rationale: 'First preparation retains the page observation.', previousEventIds: [request.id] } };
  const second = { ...first, id: 'prepared-two', evidenceRequest: { ...first.evidenceRequest,
    rationale: 'Second preparation independently selects the observation.' } };
  action.history.push(request, first, second);
  const record = caseRecord({ domain: 'concurrent-request.example.test', actions: [action], evidencePins: [{
    id: 'retained-pin', checkpointId: null, field: 'http.status', category: 'http', label: 'Observed page',
    value: 'A retained observation', source: 'Fixture observation', sourceState: 'complete', sourceSchema: null,
    observedAt: at, collectionDepth: 'deep', completeness: 'complete', truncated: false,
    transitionExpectation: null, limitations: [], createdAt: at,
  }] });
  await openSeededTimelineCase(page, record.domain, [record], CASE_SCHEMA_VERSION);
  await openCaseResponseWorkspace(page, '', 'quick');
  await openCaseSection(page, 'Summary');
  await page.locator('.completion-review > summary').click();
  const completion = page.getByRole('region', { name: 'Case completion review', exact: true });
  const requests = completion.locator('details').filter({ has: page.locator('summary', { hasText: /^Undelivered evidence requests/u }) });
  await requests.locator('summary').click();
  const branches = requests.locator(':scope > ul > li');
  await expect(requests.locator('summary')).toHaveText('Undelivered evidence requests · 2');
  await expect(branches).toHaveCount(2);
  await expect(branches.locator('strong')).toHaveText(['Concurrent preparations need review', 'Concurrent preparations need review']);
  const before = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value;
  expect(before.actions[0]!.history.filter(event => event.evidenceRequest).map(event => event.id))
    .toEqual([request.id, first.id, second.id]);

  // A real unrelated save replaces the selected Case without reconciling either request branch.
  await page.locator('.metadata-editor > summary').click();
  await page.locator('.metadata-editor').getByRole('combobox', { name: /^Status/u }).selectOption('reviewing');
  await expect(caseWorkspaceActionStatus(page)).toContainText('to Reviewing.');
  await expect(branches).toHaveCount(2);
  await expect(branches.locator('strong')).toHaveText(['Concurrent preparations need review', 'Concurrent preparations need review']);
  expect((await readBrowserLocalCollection(page, 'cases')).records[0]!.value.actions).toEqual(before.actions);

  await completion.getByRole('button', { name: 'Review response and closure', exact: true }).click();
  const stage = page.getByRole('region', { name: 'Case response actions', exact: true });
  const outer = stage.locator('details').first();
  if (!await outer.evaluate(element => element.hasAttribute('open'))) await outer.locator('summary').first().click();
  const region = stage.locator('.requested-evidence');
  await region.locator('summary').first().click();
  const requirements = region.getByRole('list', { name: 'Requested evidence', exact: true });
  await expect(requirements.locator(':scope > li')).toHaveCount(2);
  await expect(requirements).toContainText(first.evidenceRequest.rationale);
  await expect(requirements).toContainText(second.evidenceRequest.rationale);
  await requirements.getByRole('button', { name: 'Review requested evidence', exact: true }).first().click();
  const form = region.getByRole('form', { name: 'Requested evidence review', exact: true });
  await form.getByRole('combobox', { name: 'Evidence preparation', exact: true }).selectOption('unavailable');
  await form.getByLabel('Preparation or unavailability reason', { exact: true }).fill('Both preparations need a replacement original.');
  await form.getByRole('button', { name: 'Save evidence preparation', exact: true }).click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('Recorded the requested-evidence review.');
  await expect(requirements.locator(':scope > li')).toHaveCount(1);
  const history = (await readBrowserLocalCollection(page, 'cases')).records[0]!.value.actions[0]!.history;
  expect(history.slice(0, before.actions[0]!.history.length)).toEqual(before.actions[0]!.history);
  const reconciled = history.filter(event => event.evidenceRequest).at(-1)!;
  expect(reconciled.evidenceRequest!.previousEventIds.sort()).toEqual([first.id, second.id]);
  expect(reconciled.evidenceRequest!.state).toBe('unavailable');
  await openCaseSection(page, 'Summary');
  await page.locator('.completion-review > summary').click();
  await expect(requests.locator('summary')).toHaveText('Undelivered evidence requests · 1');
  await requests.locator('summary').click();
  await expect(branches).toHaveCount(1);
  await expect(branches.locator('strong')).toHaveText('Cannot provide; response needs review');
});

test('requested evidence preserves failed drafts and creates a separately reviewed amendment to the exact original packet', async ({ page }, testInfo) => {
  let copied = '', refuseCopy = false;
  await page.exposeFunction('copyFixturePacketDigest', (value: string) => {
    if (refuseCopy) throw new Error('Private clipboard failure');
    copied = value;
  });
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: (value: string) => (window as unknown as { copyFixturePacketDigest(value: string): Promise<void> }).copyFixturePacketDigest(value),
  } }));
  await page.clock.setFixedTime('2026-09-23T10:00:00.000Z');
  const at = '2026-09-20T10:00:00.000Z';
  const firstDigest = 'a'.repeat(64);
  const similarDigest = `${'a'.repeat(56)}${'b'.repeat(8)}`;
  const digest = `${'a'.repeat(16)}${'c'.repeat(40)}${'b'.repeat(8)}`;
  const action = currentActionFixture({ id: 'original-report', type: 'internal_review', recipient: 'Example response desk',
    contactSource: 'Analyst reviewed contact', routeObservedAt: at, contactLimitations: [], dueAt: null,
    targetState: 'acknowledged', reference: 'Original provider receipt', followUpAt: null, outcome: 'Received',
    createdAt: at, updatedAt: '2026-09-20T10:05:00.000Z' });
  const delivery = action.history.find(event => event.nextState === 'submitted')!;
  delivery.reference = `response-packet-sha256:${firstDigest}`;
  action.history.splice(action.history.indexOf(delivery) + 1, 0, ...[similarDigest, digest].map((value, index) => ({
    ...delivery, id: `repeated-delivery-${index}`, previousState: 'submitted' as const,
    reference: `response-packet-sha256:${value}`,
  })));
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
  const beforeInspection = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  const packet = form.getByRole('combobox', { name: 'Original submitted packet', exact: true });
  const identity = form.getByRole('group', { name: 'Selected packet digest', exact: true });
  await expect(identity).toHaveCount(0);
  await expect(packet.locator('option:not([value=""])')).toHaveText([
    `Receipt 1 · aaaaaaaaaaaa…aaaaaaaa · ${delivery.occurredAt}`,
    `Receipt 2 · aaaaaaaaaaaa…bbbbbbbb · ${delivery.occurredAt}`,
    `Receipt 3 · aaaaaaaaaaaa…bbbbbbbb · ${delivery.occurredAt}`,
  ]);
  const copy = identity.getByRole('button');
  for (const value of [firstDigest, similarDigest, digest]) {
    await packet.selectOption(value);
    await expect(copy).toHaveCount(1);
    await expect(identity.locator('p code')).toHaveText(value);
    await expect(packet).toHaveAccessibleDescription(`Original packet SHA-256: ${value}`);
    await expect(copy).toHaveAccessibleName('Copy digest — Copy original submitted packet SHA-256');
    await expect(copy).toContainText('Copy digest');
    await copy.focus(); await copy.press('Enter');
    await expect.poll(() => copied).toBe(value);
    await expect(copy).toBeFocused();
    await expect(copy).toHaveAccessibleName('Copied — Copy original submitted packet SHA-256');
  }
  refuseCopy = true;
  await copy.click();
  await expect(identity.locator('.copy-fallback')).toHaveText(digest);
  await expect(identity).not.toContainText('Private clipboard failure');
  await packet.selectOption('');
  await expect(identity).toHaveCount(0);
  await packet.selectOption(digest);
  await expect(identity.locator('p code')).toHaveText(digest);
  await expect(copy).toHaveAccessibleName('Copy digest — Copy original submitted packet SHA-256');
  expect((await readBrowserLocalCollection(page, 'cases')).records).toEqual(beforeInspection.records);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const [width, height] of [[320, 700], [390, 844], [1280, 720]] as const) {
      await page.setViewportSize({ width, height });
      await expectNoHorizontalOverflow(page);
      expect((await new AxeBuilder({ page }).include('.requested-evidence').analyze()).violations).toEqual([]);
      if (captureVisualEvidenceEnabled()) {
        await packet.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.screenshot({ path: testInfo.outputPath(`packet-digest-${theme}-${width}.png`) });
      }
    }
  }
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
  const deadline = region.getByRole('button', { name: /Copy exact provider evidence deadline:/u });
  await expect(deadline.locator('time')).toHaveAttribute('datetime', '2026-09-22T12:00:00.000Z');
  refuseCopy = false;
  await deadline.focus(); await deadline.press('Enter');
  await expect.poll(() => copied).toBe('2026-09-22T12:00:00.000Z');
  await openCaseSection(page, 'Summary');
  const summary = page.getByRole('group', { name: 'Case summary', exact: true });
  await expect(summary).toContainText('Provide the retained page evidence');
  await expect(summary).toContainText('Provider deadline:');
  if (captureVisualEvidenceEnabled()) {
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      for (const width of [320, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        await expectNoHorizontalOverflow(page);
        await summary.screenshot({ path: testInfo.outputPath(`request-summary-${theme}-${width}.png`) });
      }
    }
  }
  await summary.getByRole('button', { name: 'Review next evidence request', exact: true }).click();
  await expect(form.getByRole('combobox', { name: 'Evidence preparation', exact: true })).toBeFocused();
  await form.getByRole('combobox', { name: 'Evidence preparation', exact: true }).selectOption('unavailable');
  await form.getByLabel('Preparation or unavailability reason', { exact: true }).fill('The original file is not retained.');
  await form.getByRole('button', { name: 'Save evidence preparation', exact: true }).click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('Recorded the requested-evidence review.');
  const requirements = region.getByRole('list', { name: 'Requested evidence', exact: true });
  await expect(requirements).toContainText('Cannot provide; response needs review');
  await expect(requirements).toContainText('The original file is not retained.');
  await expect(region.getByRole('button', { name: 'Create drafting amendment', exact: true })).toHaveCount(0);
  await requirements.getByRole('button', { name: 'Review requested evidence', exact: true }).click();
  await expect(form.getByRole('combobox', { name: 'Evidence preparation', exact: true })).toHaveValue('unavailable');
  await form.getByRole('combobox', { name: 'Evidence preparation', exact: true }).selectOption('prepared');
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
  await expect(requirements).toContainText('Prepared; delivery not recorded');
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
  expect(requestEvents.map(event => event.evidenceRequest!.state).sort()).toEqual(['prepared', 'requested', 'unavailable']);
  expect(requestEvents.find(event => event.evidenceRequest!.state === 'unavailable')!.evidenceRequest!.previousEventIds)
    .toEqual([requestEvents.find(event => event.evidenceRequest!.state === 'requested')!.id]);
  expect(requestEvents.find(event => event.evidenceRequest!.state === 'prepared')!.evidenceRequest!.previousEventIds)
    .toEqual([requestEvents.find(event => event.evidenceRequest!.state === 'unavailable')!.id]);
  expect(amendment.history.some(event => event.nextState === 'submitted')).toBe(false);
  await expect(region.getByText('Delivery recorded', { exact: true })).toHaveCount(0);
  await region.getByRole('button', { name: 'Review amendment · drafting', exact: true }).click();
  await expect(stage.getByRole('button', { name: 'Update metadata', exact: true })).toBeVisible();
});
