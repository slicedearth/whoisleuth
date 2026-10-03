import { expect, test, isLookupEndpointUrl } from './fixtures';
import { openSeededTimelineCase } from './case-test-fixtures';
import { openCaseClassification, openCaseSection } from './console-navigation';
import { currentActionFixture } from './case-response-fixtures';
import { expectNoHorizontalOverflow, failNextBrowserLocalManifestWrite, migrateLegacyBrowserData, readBrowserLocalCollection, useTheme } from './helpers';
import { createCase, updateCase } from '../packages/cases/case-model.mts';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';

const AT = '2026-09-22T00:00:00.000Z';
async function capturePanel(page: import('@playwright/test').Page, panel: import('@playwright/test').Locator, name: string) {
  if (!captureVisualEvidenceEnabled()) return;
  await panel.evaluate(element => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 140, behavior: 'instant' }));
  await page.screenshot({ path: test.info().outputPath(name) });
}
function noticeAction(id: string, recipient: string) {
  return currentActionFixture({ id, type: 'registrar_report', recipient, contactSource: 'Analyst-reviewed fixture route', contactLimitations: ['No live verification'], routeObservedAt: AT, routeReviewAfter: '2026-10-01T00:00:00.000Z', dueAt: null, targetState: 'acknowledged', reference: 'REF-1', followUpAt: null, outcome: null, createdAt: AT, updatedAt: AT });
}

test('exact incident coverage preserves resolved and open URLs without object-level outcome claims', async ({ page }) => {
  let record = createCase({ domain: 'coverage.example', incidentTarget: 'https://shared.example/landing?id=one' }, AT);
  const first = record.workflowMetadata!.incidentTargets[0]!;
  record = updateCase([record], record.id, { incidentTarget: 'https://shared.example/post?id=two', incidentTargetResolution: first.id }, AT).record;
  await openSeededTimelineCase(page, record.domain, [record], CASE_SCHEMA_VERSION);
  await openCaseClassification(page);
  const coverage = page.locator('details.coverage');
  await coverage.locator(':scope > summary').click();
  await expect(coverage.getByRole('row')).toHaveCount(3);
  await expect(coverage).toContainText('https://shared.example/landing?id=one');
  await expect(coverage).toContainText('https://shared.example/post?id=two');
  await expect(coverage).toContainText('Analyst-resolved link');
  await expect(coverage).toContainText('Open link');
  await expect(coverage.getByRole('cell', { name: /Unknown action binding/ })).toHaveCount(2);
  await expect(coverage.getByText('About this review', { exact: true })).toHaveCount(1);
  await page.setViewportSize({ width: 320, height: 844 });
  const tableRegion = coverage.getByRole('region', { name: 'Incident link coverage table', exact: true });
  await tableRegion.focus();
  await tableRegion.press('ArrowRight');
  await expect.poll(() => tableRegion.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await tableRegion.evaluate(element => { element.scrollLeft = 0; });
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 1920]) {
      await page.setViewportSize({ width, height: 844 }); await expect(coverage.getByRole('table')).toBeVisible(); await expectNoHorizontalOverflow(page);
      await capturePanel(page, coverage, `incident-coverage-${theme}-${width}.png`);
    }
  }
  const stored = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  expect(stored.records[0]!.value.actions).toEqual([]);
});

test('notice review stays transient, clears on action and input changes, and never advances a response', async ({ page }) => {
  let collections = 0;
  await page.route(url => isLookupEndpointUrl(url.href), route => { collections++; return route.abort(); });
  const base = createCase({ domain: 'notice.example' }, AT);
  const record = { ...base, actions: [noticeAction('notice-first', 'review@route.example'), noticeAction('notice-second', 'review@other.example')] };
  await openSeededTimelineCase(page, record.domain, [record], CASE_SCHEMA_VERSION);
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  const intake = page.locator('details.intake');
  await intake.locator(':scope > summary').click();
  await intake.getByLabel('Input type').selectOption('email');
  const selected = { name: 'notice.eml', mimeType: 'message/rfc822', buffer: Buffer.from('From: private@route.example\r\nReply-To: private@other.example\r\nContent-Type: text/plain\r\n\r\nhttps://route.example/private?token=secret') };
  await intake.getByLabel('Select a file', { exact: true }).setInputFiles(selected);
  await intake.getByRole('button', { name: 'Review locally', exact: true }).click();
  const notice = intake.locator('details.notice');
  await notice.locator(':scope > summary').click();
  await notice.getByLabel('Recorded action').selectOption('notice-first');
  await expect(notice).toContainText('from domain: route.example · match');
  await expect(notice).toContainText('reply to domain: other.example · mismatch');
  await notice.getByLabel('Reference in the notice (optional, transient)').fill('REF-1');
  await notice.getByLabel('Claimed organisation (optional, transient)').fill('TRANSIENT-CLAIM');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 }); await expectNoHorizontalOverflow(page);
      await capturePanel(page, notice, `notice-${theme}-${width}.png`);
    }
  }
  await notice.getByRole('checkbox').check();
  await notice.getByLabel('Recorded action').selectOption('notice-second');
  await expect(notice.getByLabel('Reference in the notice (optional, transient)')).toHaveValue('');
  await expect(notice.getByLabel('Claimed organisation (optional, transient)')).toHaveValue('');
  await expect(notice.getByRole('checkbox')).not.toBeChecked();
  await intake.getByLabel('Select a file', { exact: true }).setInputFiles(selected);
  await expect(notice).toHaveCount(0);
  expect(await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).toEqual(before);
  expect(collections).toBe(0);
});

test('conditional recovery follow-up preserves local selection after failed save and remains an open question', async ({ page }) => {
  const record = createCase({ domain: 'recovery.example' }, AT);
  await openSeededTimelineCase(page, record.domain, [record], CASE_SCHEMA_VERSION);
  await openCaseSection(page, 'Response');
  const recovery = page.locator('details.identity');
  await recovery.locator(':scope > summary').click();
  await expect(recovery.getByText('About this review', { exact: true })).toHaveCount(1);
  await recovery.getByRole('checkbox', { name: 'Entered a password', exact: true }).check();
  const button = recovery.getByRole('button', { name: 'Record as open follow-up: Review and revoke suspicious account sessions', exact: true });
  await failNextBrowserLocalManifestWrite(page, 'cases');
  await button.focus();
  await button.press('Enter');
  await expect(button).toBeEnabled();
  await expect(button).toBeFocused();
  await expect(recovery.getByRole('checkbox', { name: 'Entered a password', exact: true })).toBeChecked();
  expect((await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value.assertions).toEqual([]);
  await button.press('Enter');
  await expect(recovery.getByRole('status')).toContainText('Open follow-up recorded');
  await expect(button).toBeFocused();
  const stored = (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0]!.value;
  expect(stored.assertions).toHaveLength(1);
  expect(stored.assertions[0]).toMatchObject({ kind: 'next_step', state: 'open', evidencePinIds: [] });
  expect(stored.actions).toEqual([]);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 }); await expectNoHorizontalOverflow(page);
      await capturePanel(page, recovery, `recovery-${theme}-${width}.png`);
    }
  }
  await recovery.getByRole('button', { name: 'Clear local recovery selections', exact: true }).click();
});

test('retained internal follow-ups expose independent context without changing or sharing the Case', async ({ page }) => {
  const base = createCase({ domain: 'recovery-context.example', evidencePins: [
    { field: 'http.page', category: 'http', label: 'Retained page observation', value: 'A credential form was observed', source: 'Fixture static page observation', observedAt: AT, observationHostname: 'signin.recovery-context.example', completeness: 'partial', limitations: ['Only the selected page was observed'] },
    { field: 'http.page', category: 'http', label: 'Separate supplied observation', value: 'The supplied observation shows a different page', source: 'Fixture supplied image', observedAt: null, completeness: 'unknown', limitations: [] },
  ] }, AT);
  const record = updateCase([base], base.id, { assertion: { kind: 'next_step', statement: 'Review the reported session exposure', rationale: 'The two sources need separate review.', state: 'open', evidenceRelations: [
    { evidencePinId: base.evidencePins[0]!.id, stance: 'supports' }, { evidencePinId: base.evidencePins[1]!.id, stance: 'contradicts' },
  ] } }, AT).record;
  await openSeededTimelineCase(page, record.domain, [record], CASE_SCHEMA_VERSION);
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  await openCaseSection(page, 'Response');
  const recovery = page.locator('details.identity');
  await recovery.locator(':scope > summary').click();
  const followUps = recovery.locator('details.retained-follow-ups');
  await followUps.locator(':scope > summary').click();
  await expect(followUps).toContainText(record.domain);
  await expect(followUps).toContainText('The two sources need separate review.');
  await followUps.getByText('Linked evidence (2)', { exact: true }).click();
  const context = followUps.locator('details.linked-evidence');
  await expect(context.getByText('supports', { exact: true })).toBeVisible();
  await expect(context.getByText('contradicts', { exact: true })).toBeVisible();
  await expect(context).toContainText('signin.recovery-context.example');
  await expect(context).toContainText('Fixture static page observation');
  await expect(context).toContainText('Observation time unavailable');
  await expect(context.locator('time')).toHaveAttribute('datetime', AT);
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      await expectNoHorizontalOverflow(page);
      await capturePanel(page, followUps, `internal-context-${theme}-${width}.png`);
    }
  }
  expect(await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).toEqual(before);
});

test('operations contributor links keep distinct Case IDs local and aggregate downloads private-safe', async ({ page }) => {
  const first = { ...createCase({ domain: 'shared.example' }, AT), id: 'contributor-first', actions: [noticeAction('contributor-action-first', 'private@route.example')] };
  const second = { ...createCase({ domain: 'shared.example' }, AT), id: 'contributor-second', actions: [noticeAction('contributor-action-second', 'private@route.example')] };
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: [first, second] } }, { destination: '/monitor', clearStorage: true });
  await page.getByText('Case reports and follow-up tools', { exact: true }).click();
  const report = page.locator('.operations-report');
  await report.getByLabel('Time window').selectOption('all');
  const contributors = report.locator('details.contributors');
  await contributors.locator(':scope > summary').click();
  await expect(contributors.getByRole('combobox', { name: 'Metric or exclusion' })).toHaveValue('counts.actions');
  await expect(contributors.locator('caption')).toHaveText('Current actions · contributing records');
  expect(await contributors.locator('option').allTextContents()).toContain('Submission to provider outcome interval');
  expect((await contributors.locator('option').allTextContents()).join(' ')).not.toMatch(/counts\.|durations\.|states\.|actionTypes\.|omissions\./u);
  await expect(contributors.getByText('About this review', { exact: true })).toHaveCount(1);
  await expect(contributors.getByRole('link', { name: 'Case contributor-first', exact: true })).toHaveAttribute('href', '/cases?case=contributor-first&section=response');
  await expect(contributors.getByRole('link', { name: 'Case contributor-second', exact: true })).toHaveAttribute('href', '/cases?case=contributor-second&section=response');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1280, 1920]) {
      await page.setViewportSize({ width, height: 844 }); await expect(contributors.getByRole('table')).toBeVisible(); await expectNoHorizontalOverflow(page);
      await capturePanel(page, contributors, `contributors-${theme}-${width}.png`);
    }
  }
  const [download] = await Promise.all([page.waitForEvent('download'), report.getByRole('button', { name: 'Export aggregate JSON', exact: true }).click()]);
  const chunks: Buffer[] = []; for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString('utf8');
  for (const value of ['contributor-first', 'contributor-second', 'contributor-action', 'private@', 'REF-1', 'shared.example', 'contributors']) expect(body).not.toContain(value);
  expect(Object.keys(JSON.parse(body)).sort()).toEqual(['actionTypes', 'counts', 'durations', 'generatedAt', 'limitations', 'omissions', 'schema', 'sourceState', 'states', 'version', 'window']);
});
