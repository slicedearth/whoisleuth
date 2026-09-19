import { openCasePacket, openCaseSection } from './console-navigation';
import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import {
  expectNoHorizontalOverflow,
  failNextBrowserLocalCollectionReadAfterWrite,
  failNextBrowserLocalManifestWrite,
  holdBrowserLocalTransaction,
  readBrowserLocalCollection,
  requiredValue,
  useTheme,
} from './helpers';
import { caseRecord, createCase, openCaseResponseWorkspace, openCasesView, openSeededTimelineCase } from './case-test-fixtures';
import { addFixtureCasePin, caseWorkspaceActionStatus, currentActionFixture, openPacketWizardStep } from './case-response-fixtures';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';

test.use({ timezoneId: 'UTC' });

test('an open Case updates due reviews as time advances without changing retained evidence', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-10T10:00:00Z') });
  const action = currentActionFixture({
    id: 'clock-review', type: 'registrar_report', recipient: 'Fixture reporting route',
    contactSource: 'Retained reporting route', routeObservedAt: '2026-09-10T09:00:00Z', contactLimitations: [],
    dueAt: '2026-09-10T10:00:30Z', targetState: 'acknowledged', reference: 'Manual receipt',
    followUpAt: '2026-09-10T10:00:30Z', outcome: 'Received for review',
    createdAt: '2026-09-10T09:00:00Z', updatedAt: '2026-09-10T09:30:00Z',
  });
  const record = caseRecord({ domain: 'review-clock.example', actions: [action] });
  await openSeededTimelineCase(page, record.domain, [record], CASE_SCHEMA_VERSION);
  const workspace = await openCaseResponseWorkspace(page, '', 'quick');
  await openCaseSection(page, 'Summary');
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  await expect(workspace.getByText('0 overdue', { exact: true })).toBeVisible();
  await expect(workspace.getByText('0 follow-up due', { exact: true })).toBeVisible();
  await page.clock.fastForward(60_000);
  await expect(workspace.getByText('1 overdue', { exact: true })).toBeVisible();
  await expect(workspace.getByText('1 follow-up due', { exact: true })).toBeVisible();
  expect(await readBrowserLocalCollection(page, 'cases')).toEqual(before);
});

test('the decision overview retains opposing evidence and unknowns across responsive layouts', async ({ page }, testInfo) => {
  const at = '2026-09-10T10:00:00.000Z';
  const pin = { id: 'supporting-pin', checkpointId: null, field: 'http.status', category: 'http', label: 'Observed page', value: 'A sign-in page was observed',
    source: 'Direct HTTP observation', sourceState: 'complete', sourceSchema: null, observedAt: at, collectionDepth: 'deep',
    completeness: 'complete', truncated: false, transitionExpectation: null, limitations: [], createdAt: at };
  const record = caseRecord({ domain: 'decision-overview.example',
    evidencePins: [pin, { ...pin, id: 'contrary-pin', label: 'Separate observation', value: 'The supplied screenshot shows a different page', source: 'Analyst-supplied screenshot', observedAt: null, completeness: 'unknown' }],
    assertions: [{ id: 'assessment', kind: 'hypothesis', statement: 'Does this page imitate the reported service?', rationale: 'Compare the retained observations.', state: 'open',
      evidencePinIds: ['supporting-pin', 'contrary-pin'], evidenceRelations: [{ evidencePinId: 'supporting-pin', stance: 'supports' }, { evidencePinId: 'contrary-pin', stance: 'contradicts' }], createdAt: at, updatedAt: at }],
    decisions: [{ id: 'decision', summary: 'Further review needed', rationale: 'The two sources disagree.', confidence: 'low', confidenceBasis: 'The supplied screenshot is undated.', evidencePinIds: ['supporting-pin', 'contrary-pin'], createdAt: at }],
  });
  await openSeededTimelineCase(page, record.domain, [record], CASE_SCHEMA_VERSION);
  await openCaseResponseWorkspace(page, '', 'quick');
  await openCaseSection(page, 'Summary');
  const overview = page.getByRole('region', { name: 'Decision overview', exact: true });
  await expect(overview.getByRole('region', { name: 'Supporting evidence' })).toContainText('Direct HTTP observation');
  await expect(overview.getByRole('region', { name: 'Contrary evidence' })).toContainText('Observation time unavailable');
  await expect(overview).toContainText('Further review needed');
  await overview.getByText('Incomplete or undated pinned evidence · 1', { exact: true }).click();
  await expect(overview).toContainText('Separate observation');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const [width, height] of [[320, 700], [390, 844], [1024, 768], [1280, 720], [2560, 1440], [3840, 2160]] as const) {
      await page.setViewportSize({ width, height });
      await expectNoHorizontalOverflow(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await page.screenshot({ path: testInfo.outputPath(`decision-page-${theme}-${width}.png`), fullPage: true });
      await overview.screenshot({ path: testInfo.outputPath(`decision-overview-${theme}-${width}.png`) });
    }
  }
  await overview.getByRole('button', { name: 'Review assessment', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Case sections' }).getByRole('link', { name: 'Assessment', exact: true })).toHaveAttribute('aria-current', 'page');
  const stored = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  expect(stored.records[0]!.value.decisions[0]?.summary).toBe('Further review needed');
  expect(stored.records[0]!.value.evidencePins).toHaveLength(2);
});

test('a recheck uses selected evidence without advancing its clock or discarding the manual draft', async ({ page }, testInfo) => {
  const observedAt = '2026-09-01T10:00:00.123Z';
  const pin = {
    id: 'pin-retained', checkpointId: null, field: 'http.status', category: 'http', label: 'Retained web response',
    value: 'Response 200', source: 'Fixture HTTP observation', sourceState: 'partial', sourceSchema: null,
    observedAt, collectionDepth: 'deep', completeness: 'partial', truncated: true, transitionExpectation: null,
    limitations: ['The response body was incomplete.'], createdAt: observedAt,
  };
  const record = caseRecord({ domain: 'retained-recheck.invalid', evidencePins: [pin, { ...pin, id: 'pin-undated', observedAt: null }] });
  await openSeededTimelineCase(page, record.domain, [record]);
  const workspace = await openCaseResponseWorkspace(page, '', 'quick');
  await openCaseSection(page, 'Response');
  const form = workspace.getByRole('form', { name: 'Record a recheck', exact: true });
  await form.getByLabel('Source', { exact: true }).fill('Separate manual review');
  await form.getByLabel('Observed at', { exact: true }).fill('2026-09-02T11:30');
  await form.getByRole('combobox', { name: 'Observed effect', exact: true }).selectOption('still_observed');
  const source = form.getByRole('combobox', { name: 'Current evidence', exact: true });
  await source.selectOption('pin-undated');
  await expect(form.getByRole('status').filter({ hasText: 'no observation time' })).toBeVisible();
  await expect(form.getByRole('button', { name: 'Record independent outcome', exact: true })).toBeDisabled();
  await source.selectOption('pin-retained');
  await expect(form.getByLabel('Source', { exact: true })).toHaveCount(0);
  await expect(form.getByLabel('Observed at', { exact: true })).toHaveCount(0);
  await expect(form.getByRole('combobox', { name: 'Completeness', exact: true })).toHaveCount(0);
  await expect(form).toContainText(observedAt);
  await expect(form).toContainText('The response body was incomplete.');
  const useSource = form.getByRole('checkbox', { name: 'Use selected source details', exact: true });
  await useSource.uncheck();
  await expect(source).toHaveValue('pin-retained');
  await expect(form.getByLabel('Source', { exact: true })).toHaveValue('Separate manual review');
  await useSource.check();
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const [width, height] of [[320, 700], [390, 844], [1024, 768], [1280, 720], [2560, 1440]] as const) {
      await page.setViewportSize({ width, height });
      await expect(source).toBeVisible();
      await expect(useSource).toBeChecked();
      await source.focus();
      await page.keyboard.press('Tab');
      await expect(useSource).toBeFocused();
      const box = await useSource.boundingBox();
      const header = await page.locator('.shell > header').boundingBox();
      expect(box && header && box.y >= header.y + header.height).toBe(true);
      expect(await useSource.locator('..').evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      await expectNoHorizontalOverflow(page);
      await form.screenshot({ path: testInfo.outputPath(`retained-recheck-${theme}-${width}.png`), animations: 'disabled' });
      await page.screenshot({ path: testInfo.outputPath(`retained-recheck-viewport-${theme}-${width}.png`), animations: 'disabled' });
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await source.selectOption('');
  await expect(form.getByLabel('Source', { exact: true })).toHaveValue('Separate manual review');
  await expect(form.getByLabel('Observed at', { exact: true })).toHaveValue('2026-09-02T11:30');
  await source.selectOption('pin-retained');
  await form.getByLabel('Limitations', { exact: false }).fill('The same page was still present in this retained observation.');
  await openCaseSection(page, 'Assessment');
  await openCaseSection(page, 'Response');
  await expect(source).toHaveValue('pin-retained');
  const save = form.getByRole('button', { name: 'Record independent outcome', exact: true });
  await save.focus();
  await page.keyboard.press('Enter');
  await expect(caseWorkspaceActionStatus(page)).toContainText('Recorded an independent observed-effect review');
  await expect(save).toBeFocused();
  const stored = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value;
  expect(stored.observedEffects.reviews).toEqual([expect.objectContaining({
    state: 'still_observed', observedAt, sourceClass: 'analyst', source: 'Fixture HTTP observation',
    completeness: 'partial', evidencePinId: 'pin-retained',
    limitations: ['The same page was still present in this retained observation.'],
  })]);
  expect(stored.evidencePins[0]).toEqual(expect.objectContaining(pin));
  await expect(form.getByLabel('Source', { exact: true })).toHaveValue('Separate manual review');
  await expectNoHorizontalOverflow(page);
});

test('undated Case observations persist once and remain usable across viewport and theme changes', async ({ page }, testInfo) => {
  const savedAt = '2026-09-10T10:00:00.000Z';
  await page.clock.setFixedTime(savedAt);
  await page.setViewportSize({ width: 390, height: 844 });
  await useTheme(page, 'light');
  await openCasesView(page);
  await createCase(page, 'undated.invalid');
  const workspace = await openCaseResponseWorkspace(page, '', 'quick');
  await openCaseSection(page, 'Evidence');
  const observation = workspace.getByRole('region', { name: 'Case observations', exact: true });
  await observation.getByLabel('Label', { exact: true }).fill('Retained undated evidence');
  await observation.getByLabel('Fact', { exact: true }).fill('The source fact is retained independently of its unknown date.');
  const sourceTime = observation.getByLabel('Observed at', { exact: true });
  await expect(sourceTime).toHaveValue('');
  await expect(sourceTime).toHaveAccessibleDescription('Optional; leave blank if unknown.');
  const pin = observation.getByRole('button', { name: 'Pin evidence', exact: true });
  await pin.focus();
  await page.keyboard.press('Enter');
  await expect(caseWorkspaceActionStatus(page)).toContainText('Pinned analyst-selected evidence');
  await expect(observation.locator('ol.records').first()).toContainText('Observation time unavailable');
  await observation.getByText('Record a source-qualified sighting', { exact: true }).click();
  await observation.getByRole('combobox', { name: 'Sighting state', exact: true }).selectOption('reported_by_provider');
  await observation.getByLabel('Source', { exact: true }).nth(1).fill('Retained provider report');
  const sightingTime = observation.getByLabel('Observed or reviewed at', { exact: true });
  await expect(sightingTime).toHaveValue('');
  await expect(sightingTime).toHaveAccessibleDescription('Optional; leave blank if unknown.');
  const sighting = observation.getByRole('button', { name: 'Record sighting', exact: true });
  await sighting.focus();
  await page.keyboard.press('Enter');
  await expect(observation.getByRole('region', { name: 'Observation chronology', exact: true })).toContainText('Time unavailable');
  const stored = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value;
  expect(stored.evidencePins).toEqual([expect.objectContaining({ observedAt: null, createdAt: savedAt })]);
  expect(stored.sightings).toEqual([expect.objectContaining({ observedAt: null, createdAt: savedAt })]);
  await page.reload();
  await openCaseResponseWorkspace(page, '', 'quick');
  await expect(observation.locator('ol.records').first()).toContainText('Observation time unavailable');
  const restored = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value;
  expect(restored.evidencePins).toEqual(stored.evidencePins);
  expect(restored.sightings).toEqual(stored.sightings);
  await observation.getByText('Record a source-qualified sighting', { exact: true }).click();
  for (const viewport of [
    { width: 1280, height: 720 }, { width: 1024, height: 768 },
    { width: 390, height: 844 }, { width: 320, height: 700 },
  ]) {
    for (const theme of ['light', 'dark'] as const) {
      await test.step(`render and keyboard operation at ${viewport.width}px in ${theme}`, async () => {
        await page.setViewportSize(viewport);
        await useTheme(page, theme);
        await expect(sourceTime).toHaveValue('');
        await expect(sourceTime).toHaveAccessibleDescription('Optional; leave blank if unknown.');
        await expect(sightingTime).toHaveValue('');
        await expect(sightingTime).toHaveAccessibleDescription('Optional; leave blank if unknown.');
        await pin.focus();
        await page.keyboard.press('Enter');
        await expect(observation.getByLabel('Label', { exact: true })).toBeFocused();
        await sighting.locator('..').getByRole('textbox', { name: /^Limitations/u }).focus();
        await page.keyboard.press('Tab');
        await expect(sighting).toBeFocused();
        await expect(sighting).toBeInViewport({ ratio: 1 });
        await expect(observation.locator('ol.records').first()).toContainText('Observation time unavailable');
        await expect(observation.getByRole('region', { name: 'Observation chronology', exact: true })).toContainText('Time unavailable');
        await expectNoHorizontalOverflow(page);
        await testInfo.attach(`undated-observations-${viewport.width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
      });
    }
  }
  const afterRendering = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value;
  expect(afterRendering.evidencePins).toEqual(stored.evidencePins);
  expect(afterRendering.sightings).toEqual(stored.sightings);
});

for (const timezoneId of ['Australia/Melbourne', 'America/New_York']) {
  test.describe(`Case UTC entry in ${timezoneId}`, () => {
    test.use({ timezoneId });
    test('preserves distinct source instants through metadata edits and new evidence entry', async ({ page }) => {
      await page.clock.setFixedTime('2026-09-10T10:00:00.000Z');
      const instants = ['2026-04-04T15:30:12.345Z', '2026-04-04T16:30:12.345Z'];
      const actions = instants.map((routeObservedAt, index) => currentActionFixture({
        id: `utc-route-${index}`, type: 'registrar_report', recipient: `Fixture route ${index}`,
        contactSource: 'Retained fixture route', routeObservedAt, contactLimitations: [],
        dueAt: null, targetState: 'ready_for_review', reference: null, followUpAt: null, outcome: null,
        createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-05T00:00:00.000Z',
      }));
      await openSeededTimelineCase(page, 'utc-entry.invalid', [caseRecord({ id: 'utc-entry', domain: 'utc-entry.invalid', actions })], CASE_SCHEMA_VERSION);
      const workspace = await openCaseResponseWorkspace(page, 'utc-entry');
      await openCaseSection(page, 'Response');
      const actionStage = workspace.getByRole('region', { name: 'Case response actions', exact: true });
      await actionStage.getByText('Track append-only response actions', { exact: true }).click();
      for (const [index, instant] of instants.entries()) {
        await actionStage.getByRole('combobox', { name: 'Action metadata', exact: true }).selectOption(`utc-route-${index}`);
        await expect(actionStage.getByLabel('Route observed at', { exact: true })).toHaveValue(instant.slice(0, -1));
        await actionStage.getByLabel(/Contact limitations/).fill(`Reviewed fixture ${index}`);
        await actionStage.getByRole('button', { name: 'Update metadata', exact: true }).click();
        await expect.poll(async () => (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value.actions
          .find((action: { id: string }) => action.id === `utc-route-${index}`)).toMatchObject({
          routeObservedAt: instant, contactLimitations: [`Reviewed fixture ${index}`],
        });
      }
      await openCaseSection(page, 'Evidence');
      const observation = workspace.getByRole('region', { name: 'Case observations', exact: true });
      await observation.getByText('Pin an observed fact', { exact: true }).click();
      await expect(observation.getByText('Date and time fields use UTC.', { exact: true }).first()).toBeVisible();
      await observation.getByLabel('Label', { exact: true }).fill('Explicit UTC observation');
      await observation.getByLabel('Source', { exact: true }).first().fill('Fixture source');
      await observation.getByLabel('Fact', { exact: true }).fill('A source observation, not the record edit time.');
      const observedInput = observation.getByLabel('Observed at', { exact: true });
      await observedInput.fill('10000-01-01T00:00');
      expect(await observedInput.evaluate((input) => (input as HTMLInputElement).validity.rangeOverflow)).toBe(true);
      await observation.getByRole('button', { name: 'Pin evidence', exact: true }).click();
      await expect(observedInput).toBeFocused();
      expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value.evidencePins).toHaveLength(0);
      await expect(observation.getByLabel('Label', { exact: true })).toHaveValue('Explicit UTC observation');
      await observedInput.fill('2026-04-05T02:30:12.345');
      await observation.getByRole('button', { name: 'Pin evidence', exact: true }).click();
      await expect.poll(async () => (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value.evidencePins)
        .toMatchObject([{ observedAt: '2026-04-05T02:30:12.345Z' }]);
    });
  });
}

test('Quick completes reviewed packet handoff, a response receipt, recheck and closure', async ({ page }, testInfo) => {
  test.slow();
  await page.clock.setFixedTime('2026-09-10T10:00:00.000Z');
  let collectionRequests = 0;
  await page.route('**/api/lookup', async (route) => { collectionRequests += 1; await route.abort(); });
  await page.setViewportSize({ width: 390, height: 844 });
  await openCasesView(page);
  await createCase(page, 'quick-stages.invalid');
  const workspace = await openCaseResponseWorkspace(page, '', 'quick');
  await expect(page.getByRole('navigation', { name: 'Case sections' }).getByRole('link')).toHaveCount(5);

  await openCaseSection(page, 'Evidence');
  const observation = workspace.getByRole('region', { name: 'Case observations', exact: true });
  await observation.getByLabel('Label', { exact: true }).fill('Selected page observation');
  await observation.getByLabel('Source', { exact: true }).first().fill('Fixture page review');
  await observation.getByLabel('Fact', { exact: true }).fill('An observed credential form requires reviewed escalation.');
  await observation.getByLabel('Observed at', { exact: true }).fill('2026-09-10T10:00');
  await observation.getByRole('button', { name: 'Pin evidence', exact: true }).click();
  await expect(observation.locator('ol.records').first().locator('li')).toHaveCount(1);

  await openCaseSection(page, 'Assessment');
  const assessment = workspace.getByRole('region', { name: 'Case assessment', exact: true });
  await assessment.getByRole('combobox', { name: 'Disposition', exact: true }).selectOption('suspicious');
  await assessment.getByRole('combobox', { name: 'Review reason', exact: true }).selectOption('other_reviewed');
  await assessment.getByLabel('Conclusion summary', { exact: true }).fill('Request an authorised review');
  await assessment.getByLabel('Evidence-based rationale', { exact: true }).fill('The selected observation supports review, not an automatic verdict.');
  await assessment.getByRole('checkbox', { name: /^Pin 1: Selected page observation · Fixture page review · 2026-09-10T10:00:00.000Z$/u }).check();
  await assessment.getByRole('button', { name: 'Record conclusion', exact: true }).click();
  await expect(assessment.locator('ol.records > li')).toHaveCount(1);

  await openCaseSection(page, 'Response');
  const actions = workspace.getByRole('region', { name: 'Case response actions', exact: true });
  await actions.getByRole('combobox', { name: 'Action type', exact: true }).selectOption('registrar_report');
  await actions.getByLabel('Recipient or owner', { exact: true }).fill('Fixture abuse review desk');
  await actions.getByLabel('How this route was found', { exact: true }).fill('Fixture registration evidence');
  await actions.getByLabel('Route observed at', { exact: true }).fill('2026-09-01T10:00');
  await actions.getByLabel('Route review after', { exact: true }).fill('2026-09-20T10:00');
  await actions.getByLabel(/Contact limitations/).fill('Selected registrar route; no delivery performed by the application.');
  await actions.getByRole('button', { name: 'Create drafting action', exact: true }).click();
  for (const [index, name] of ['Ready for review', 'Mark reviewed', 'Authorise'].entries()) {
    await page.clock.setFixedTime(`2026-09-10T10:0${index + 1}:00.000Z`);
    await actions.getByRole('button', { name, exact: true }).click();
  }
  await expect(actions.getByRole('button', { name: 'Mark sent', exact: true })).toBeDisabled();
  await openCasePacket(page);
  const packet = workspace.locator('details[id^="case-response-preflight-"]');
  await expect(packet).toHaveAttribute('open', '');
  await expect(packet.locator(':scope > summary')).toBeFocused();
  await expect(packet.locator(':scope > summary')).toBeInViewport();
  await expect(packet.getByRole('combobox', { name: 'Audience profile', exact: true })).toBeVisible();
  await packet.getByRole('combobox', { name: 'Audience profile', exact: true }).selectOption('registrar');
  await packet.getByLabel('Abuse category', { exact: true }).fill('Credential phishing');
  await packet.getByLabel('Affected party', { exact: true }).fill('Example organisation');
  await packet.getByLabel('Observed at', { exact: true }).fill('2026-09-10T10:00');
  await packet.getByLabel(/Exact abusive HTTP/).fill('https://quick-stages.invalid/review');
  await packet.getByLabel('Observed harm', { exact: true }).fill('An observed credential form requires reviewed escalation.');
  await expect(packet.getByRole('checkbox', { name: /Selected page observation/ })).toBeChecked();
  await expect(packet).toContainText('2026-09-20T10:00:00.000Z');
  await openPacketWizardStep(packet, 'Review');
  for (const label of ['Infrastructure responsibility', 'Analyst authority', 'Contradiction review', 'Source limitations review']) {
    const section = packet.locator('.readiness-editor section', { hasText: label });
    await section.getByRole('combobox', { name: 'State', exact: true }).selectOption('complete');
    await section.getByLabel('Detail', { exact: true }).fill(`Explicit fixture ${label.toLowerCase()}.`);
  }
  await packet.getByRole('button', { name: 'Review and bind exact inputs', exact: true }).click();
  for (const confirmation of await packet.locator('.confirmations input[type="checkbox"]').all()) await confirmation.check();
  await packet.getByRole('button', { name: 'Authorise exact bound inputs', exact: true }).click();
  await packet.getByRole('button', { name: 'Preview manual complaint', exact: true }).click();
  const preview = packet.getByRole('textbox', { name: /^Exact manual complaint/ });
  await expect(preview).toBeFocused();
  const exactEmail = await preview.inputValue();
  expect(exactEmail).toContain('An observed credential form');
  const clipboard = { text: '' };
  await page.exposeFunction('retainFixtureClipboard', (text: string) => { clipboard.text = text; });
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: (text: string) => (window as typeof window & { retainFixtureClipboard: (value: string) => Promise<void> }).retainFixtureClipboard(text),
  } }));
  await packet.getByRole('button', { name: 'Copy email draft', exact: true }).click();
  await expect.poll(() => clipboard.text).toBe(exactEmail);
  for (const format of ['email draft', 'JSON draft or authorised packet']) {
    const downloaded = page.waitForEvent('download');
    await packet.getByRole('button', { name: `Export ${format}`, exact: true }).click();
    const content = await readFile(requiredValue(await (await downloaded).path(), 'The exact packet download is missing.'), 'utf8');
    if (format === 'email draft') expect(content).toBe(exactEmail);
    else {
      const exported = JSON.parse(content);
      expect(exported).toMatchObject({ submissionPerformed: false, authorisation: { status: 'authorised', digestMatches: true } });
      expect(exported.selectedEvidence).toHaveLength(1);
    }
  }
  for (const width of [1280, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : width === 1024 ? 768 : width === 390 ? 844 : 700 });
    for (const theme of ['light', 'dark']) {
      await useTheme(page, theme as 'light' | 'dark');
      await preview.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      await testInfo.attach(`quick-packet-${width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
    }
  }
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value.actions[0]!.state).toBe('authorised');
  await packet.getByRole('button', { name: 'Continue to record delivery', exact: true }).click();
  await expect(actions.getByLabel('Delivery reference', { exact: true })).toHaveValue(/^response-packet-sha256:[a-f0-9]{64}$/u);
  await page.clock.setFixedTime('2026-09-10T10:10:00.000Z');
  await actions.getByLabel(/^Event time/).fill('2026-09-10T10:05:12.345');
  await actions.getByRole('button', { name: 'Mark sent', exact: true }).click();
  await page.clock.setFixedTime('2026-09-10T11:00:00.000Z');
  await actions.getByRole('combobox', { name: 'Provider outcome', exact: true }).selectOption('accepted_for_review');
  await actions.getByLabel('Reference', { exact: true }).fill('FIXTURE-RECEIPT-1');
  await actions.getByLabel('Outcome detail', { exact: true }).fill('Provider acknowledged the report for review.');
  await actions.getByLabel(/^Event time/).fill('2026-09-10T10:30:20.678');
  await actions.getByText('Event evidence and limitations', { exact: true }).click();
  await actions.getByRole('combobox', { name: 'Receipt evidence', exact: true }).selectOption({ label: 'Pin 1: Selected page observation · Fixture page review · 2026-09-10T10:00:00.000Z' });
  await actions.getByLabel(/^Receipt limitations/).fill('Receipt confirms review only, not removal.');
  await actions.getByRole('button', { name: 'Record provider response', exact: true }).click();
  await expect(actions.locator('.draft-recovery[data-recovery-form="action-receipt"]')).toHaveAttribute('data-recovery-status', 'idle');
  await expect(actions.getByLabel('Outcome detail', { exact: true })).toHaveValue('');

  const recheck = workspace.getByRole('link', { name: 'Prepare a recheck for quick-stages.invalid', exact: true });
  const caseId = new URL(page.url()).searchParams.get('case');
  expect(caseId).toBeTruthy();
  await recheck.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(url => url.pathname === '/lookup' && url.searchParams.get('q') === 'quick-stages.invalid' && url.searchParams.get('case') === caseId);
  const selectedContext = page.getByRole('region', { name: 'Selected Case', exact: true });
  await expect(selectedContext).toContainText('quick-stages.invalid');
  expect(collectionRequests).toBe(0);
  await selectedContext.getByRole('link', { name: 'quick-stages.invalid', exact: true }).click();
  await openCaseResponseWorkspace(page, '', 'quick');
  await openCaseSection(page, 'Response');
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
  expect(stored.actions[0]!.history.at(-2)).toMatchObject({ occurredAt: '2026-09-10T10:05:12.345Z', sourceClass: 'analyst' });
  expect(stored.actions[0]!.history.at(-1)).toMatchObject({ occurredAt: '2026-09-10T10:30:20.678Z', sourceClass: 'provider', evidencePinId: stored.evidencePins[0]!.id, limitations: ['Receipt confirms review only, not removal.'] });
  expect(collectionRequests).toBe(0);
  await expectNoHorizontalOverflow(page);
});

test('Quick recipient refresh invalidates approval and stale manual previews cannot be copied', async ({ page }) => {
  await page.clock.setFixedTime('2026-09-10T12:00:00.000Z');
  const record = caseRecord({ id: 'route-review-case', domain: 'route-review.invalid', actions: [currentActionFixture({
    id: 'route-review-action', type: 'registrar_report', recipient: 'Fixture registrar desk', contactSource: 'Fixture published route',
    routeObservedAt: '2026-09-10T11:00:00.123Z', routeReviewAfter: '2026-09-10T13:00:00.456Z',
    contactLimitations: ['Publisher expiry retained as the source deadline.'], dueAt: null, targetState: 'ready_for_review',
    reference: null, followUpAt: '2026-10-01T00:00:00.000Z', outcome: null,
    createdAt: '2026-09-10T11:00:00.000Z', updatedAt: '2026-09-10T11:30:00.000Z',
  })] });
  await openSeededTimelineCase(page, record.domain, [record], CASE_SCHEMA_VERSION);
  await addFixtureCasePin(page, 'Route review evidence');
  const workspace = await openCaseResponseWorkspace(page, '', 'quick');
  await openCaseSection(page, 'Response');
  const actions = workspace.getByRole('region', { name: 'Case response actions', exact: true });
  for (const name of ['Mark reviewed', 'Authorise']) await actions.getByRole('button', { name, exact: true }).click();
  await openCasePacket(page);
  const packet = workspace.locator('details[id^="case-response-preflight-"]');
  await packet.getByRole('combobox', { name: 'Audience profile', exact: true }).selectOption('registrar');
  await packet.getByLabel('Abuse category', { exact: true }).fill('Reviewed fixture concern');
  await packet.getByLabel('Affected party', { exact: true }).fill('Example organisation');
  await packet.getByLabel('Observed harm', { exact: true }).fill('A source-qualified review request.');
  await packet.getByLabel('Observed at', { exact: true }).fill('2026-09-10T11:00');
  await packet.getByLabel(/Exact abusive HTTP/).fill('https://route-review.invalid/review');
  await packet.getByRole('checkbox', { name: /Route review evidence/ }).check();
  await openPacketWizardStep(packet, 'Export and record');
  await packet.getByRole('button', { name: 'Preview manual complaint', exact: true }).click();
  await expect(packet.getByRole('textbox', { name: /^Exact manual complaint/ })).toBeVisible();
  let copies = 0;
  await page.exposeFunction('countFixtureClipboard', () => { copies += 1; });
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: () => (window as typeof window & { countFixtureClipboard: () => Promise<void> }).countFixtureClipboard(),
  } }));
  await page.clock.setFixedTime('2026-09-10T13:00:00.457Z');
  await packet.getByRole('button', { name: 'Copy email draft', exact: true }).click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('freshness changed after the preview');
  await expect(packet.getByRole('textbox', { name: /^Exact manual complaint/ })).toHaveCount(0);
  expect(copies).toBe(0);

  await openCaseSection(page, 'Response');
  await actions.getByRole('button', { name: 'Review recipient and schedule', exact: true }).click();
  await expect(actions.getByLabel('Route observed at', { exact: true })).toBeFocused();
  await expect(actions.getByLabel('Route observed at', { exact: true })).toHaveValue('2026-09-10T11:00:00.123');
  await expect(actions.getByLabel('Route review after', { exact: true })).toHaveValue('2026-09-10T13:00:00.456');
  await actions.getByLabel('Route observed at', { exact: true }).fill('2026-09-10T13:00:00.457');
  await actions.getByLabel('Route review after', { exact: true }).fill('2026-09-12T13:00:00.789');
  await actions.getByRole('button', { name: 'Update metadata', exact: true }).click();
  await expect(actions.getByRole('button', { name: 'Ready for review', exact: true })).toBeVisible();
  const retained = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value.actions[0]!;
  expect(retained).toMatchObject({ state: 'drafting', routeObservedAt: '2026-09-10T13:00:00.457Z', routeReviewAfter: '2026-09-12T13:00:00.789Z', followUpAt: '2026-10-01T00:00:00.000Z' });
  expect(retained.history.at(-1)).toMatchObject({ previousState: 'authorised', nextState: 'drafting', provenance: 'material_action_change' });
  await openCasePacket(page);
  await packet.getByRole('button', { name: 'Copy email draft', exact: true }).click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('preview is out of date');
  expect(copies).toBe(0);
  await packet.getByRole('button', { name: 'Refresh manual complaint preview', exact: true }).click();
  await expect(packet.getByRole('textbox', { name: /^Exact manual complaint/ })).toBeVisible();
  await packet.getByRole('button', { name: 'Copy email draft', exact: true }).click();
  await expect.poll(() => copies).toBe(1);
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value.actions[0]!.state).toBe('drafting');
});

test('a Quick closure without a response action preserves validation, failed-write and committed-refresh outcomes', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'no-action-closure.invalid');
  const workspace = await openCaseResponseWorkspace(page, '', 'quick');
  await openCaseSection(page, 'Response');
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
  await openCaseSection(page, 'Evidence');
  const observation = workspace.getByRole('region', { name: 'Case observations', exact: true });
  await observation.getByLabel('Label', { exact: true }).fill('Draft fixture evidence');
  await observation.getByLabel('Fact', { exact: true }).fill('A bounded retained fact.');
  await observation.getByRole('button', { name: 'Pin evidence', exact: true }).click();
  await openCaseSection(page, 'Assessment');
  const assessment = workspace.getByRole('region', { name: 'Case assessment', exact: true });
  await assessment.getByRole('combobox', { name: 'Disposition', exact: true }).selectOption('suspicious');
  await assessment.getByRole('combobox', { name: 'Review reason', exact: true }).selectOption('other_reviewed');
  await assessment.getByLabel('Conclusion summary', { exact: true }).fill('Submitted conclusion');
  await assessment.getByLabel('Evidence-based rationale', { exact: true }).fill('Submitted rationale');
  await assessment.getByRole('checkbox', { name: /^Pin 1: Draft fixture evidence ·/u }).check();
  await openCaseSection(page, 'Response');
  const outcome = workspace.getByRole('region', { name: 'Case independent review and closure', exact: true });
  await outcome.getByLabel('Source', { exact: true }).fill('Unsubmitted independent review');
  await outcome.getByLabel('Closure summary', { exact: true }).fill('Unsubmitted closure');
  await openCaseSection(page, 'Assessment');
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
  await openCaseSection(page, 'Response');
  await expect(outcome.getByLabel('Source', { exact: true })).toHaveValue('Unsubmitted independent review');
  await expect(outcome.getByLabel('Closure summary', { exact: true })).toHaveValue('Unsubmitted closure');
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value.decisions.map((item) => item.summary)).toEqual(['Submitted conclusion']);

  await openCaseSection(page, 'Assessment');
  await workspace.getByRole('button', { name: 'Advanced', exact: true }).click();
  const branch = assessment.locator('details', { hasText: 'Group evidence and decisions into investigation branches' });
  await branch.locator(':scope > summary').click();
  await branch.getByLabel('Branch name', { exact: true }).fill('Submitted branch');
  await branch.getByRole('checkbox', { name: /^Pin 1: Draft fixture evidence ·/u }).check();
  const releaseBranch = await holdBrowserLocalTransaction(page);
  try {
    const submit = branch.locator('button[type="submit"]');
    await expect(submit).toHaveAccessibleName('Create branch');
    await submit.click();
    await expect(submit).toBeDisabled();
    await branch.getByLabel('Branch name', { exact: true }).fill('Later branch');
    await workspace.getByRole('button', { name: 'Quick', exact: true }).click();
  } finally { await releaseBranch(); }
  await expect(caseWorkspaceActionStatus(page)).toContainText('Created an investigation branch');
  await workspace.getByRole('button', { name: 'Advanced', exact: true }).click();
  await branch.locator(':scope > summary').click();
  await expect(branch.getByLabel('Branch name', { exact: true })).toHaveValue('Later branch');
  await expect(branch.getByRole('checkbox', { name: /^Pin 1: Draft fixture evidence ·/u })).toBeChecked();
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value.branches?.map((item) => item.name)).toEqual(['Submitted branch']);
});
