import { openCaseClassification, openCaseMetadata, openCaseSection, openConsoleView, openInboxReview } from './console-navigation';
import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { currentBrowserLocalDocument, currentBulkSessionBrowserStore, expectNoHorizontalOverflow, failBrowserLocalCollectionReads, failNextBrowserLocalCollectionReadAfterWrite, holdBrowserLocalReads, migrateLegacyBrowserData, readBrowserLocalCollection, requiredValue, useTheme } from './helpers';
import { caseRecord, createCase, openCaseResponseWorkspace, openCasesView, snapshot } from './case-test-fixtures';
import { CASE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/case-model';
import { caseWorkspaceActionStatus, currentActionFixture, openPacketWizardStep, operationsReportActionStatus, reviewInboxActionStatus } from './case-response-fixtures';
import { caseNumber, formattedCaseNumber } from '../packages/cases/case-workflow-metadata.mts';
import type { WebsiteProfileSnapshot } from '../packages/workspace/website-snapshot-model.mts';

// Monitor workflows, retained evidence and local control coverage.

test('Monitor views support roving keyboard navigation within the selected workspace', async ({ page }) => {
  await page.goto('/monitor');
  const tabs = page.getByRole('tablist', { name: 'Monitor views' });
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  const inbox = tabs.getByRole('tab', { name: /^Inbox/ });
  await inbox.focus();
  await inbox.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: /^Campaigns/ })).toBeFocused();
  await expect(page).toHaveURL('/monitor?view=campaigns');
  await tabs.getByRole('tab', { name: /^Campaigns/ }).press('End');
  await expect(tabs.getByRole('tab', { name: /^Relationships/ })).toBeFocused();
  await expect(page).toHaveURL('/monitor?view=relationships');
  await openConsoleView(page, 'timeline');
  const timeline = tabs.getByRole('tab', { name: /^Timeline/ });
  await timeline.focus();
  await timeline.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: /^Certificates/ })).toBeFocused();
  await tabs.getByRole('tab', { name: /^Certificates/ }).press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: /^Watchlists/ })).toBeFocused();
  await expect(page).toHaveURL('/monitor?view=watchlists');
  await page.reload();
  await expect(page.getByRole('tab', { name: /^Watchlists/ })).toHaveAttribute('aria-selected', 'true');
});

test('console workflow destinations preserve active state and browser history', async ({ page }) => {
  await page.goto('/monitor');
  const navigation = page.getByRole('navigation', { name: 'Console', exact: true });
  const respond = navigation.getByRole('link', { name: 'Review inbox', exact: true });
  const cases = navigation.getByRole('link', { name: 'Cases', exact: true });
  const monitoring = navigation.getByRole('link', { name: 'Monitoring', exact: true });
  await expect(respond).toHaveAttribute('aria-current', 'page');
  await cases.click();
  await expect(page).toHaveURL('/cases');
  await expect(cases).toHaveAttribute('aria-current', 'page');
  await expect(respond).not.toHaveAttribute('aria-current', 'page');
  await monitoring.click();
  await expect(page).toHaveURL('/monitor?view=watchlists');
  await expect(monitoring).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(page).toHaveURL('/cases');
  await expect(cases).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(page).toHaveURL('/monitor');
  await expect(respond).toHaveAttribute('aria-current', 'page');
  await page.goForward();
  await expect(page).toHaveURL('/cases');
  await page.goForward();
  await expect(page).toHaveURL('/monitor?view=watchlists');
  await expect(page.getByRole('tab', { name: /^Watchlists/ })).toHaveAttribute('aria-selected', 'true');
});

test('legacy Case destinations retain guided inputs and canonical navigation clears them', async ({ page }) => {
  await page.goto('/monitor?view=cases');
  await expect(page).toHaveURL('/cases');
  await expect(page.getByRole('heading', { name: 'Cases', exact: true })).toBeVisible();
  await openConsoleView(page, 'inbox');
  await expect(page).toHaveURL('/monitor');
  await page.reload();
  await expect(page.getByRole('tab', { name: /^Inbox/ })).toHaveAttribute('aria-selected', 'true');
  await page.goto('/monitor?view=not-a-view');
  await expect(page.getByRole('tab', { name: /^Inbox/ })).toHaveAttribute('aria-selected', 'true');

  await page.goto('/monitor?view=cases&investigation=1&domain=guided.invalid&response=1#case-review-queue');
  await expect(page).toHaveURL('/cases?investigation=1&domain=guided.invalid&response=1#case-review-queue');
  await expect(page.locator('#case-review-queue')).toBeFocused();
  await openConsoleView(page, 'inbox');
  await expect(page).toHaveURL('/monitor');
  await page.reload();
  await expect(page.getByRole('tab', { name: /^Inbox/ })).toHaveAttribute('aria-selected', 'true');

  await page.locator('#console-navigation a[href="/monitor"]').evaluate((link) => {
    link.setAttribute('href', '/monitor?view=cases&investigation=1&domain=guided.invalid#case-review-queue');
    (link as HTMLAnchorElement).click();
  });
  await expect(page).toHaveURL('/cases?investigation=1&domain=guided.invalid#case-review-queue');
  await expect(page.getByRole('heading', { name: '1 domain carried from Bulk' })).toBeVisible();
  await expect(page.locator('#case-review-queue')).toBeFocused();
  for (const reservedName of ['__proto__', 'constructor']) {
    await page.goto(`/monitor?view=watchlists&watchlist=${reservedName}`);
    await expect(page.getByRole('tab', { name: /^Watchlists/u })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#watchlist-history')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'No watchlists saved' })).toBeVisible();
  }
});

test('Cases and monitoring report unreadable collections without false empty states', async ({ page }) => {
  await page.goto('/monitor');
  await expect(page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
  await failBrowserLocalCollectionReads(page, 'cases');
  await failBrowserLocalCollectionReads(page, 'watchlists');
  await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page).toHaveURL('/dashboard');
  await openConsoleView(page, 'inbox');
  await expect(page.locator('.local-context-status')).toContainText('Some saved context could not be loaded');
  await openConsoleView(page, 'cases');
  await expect(page.getByRole('heading', { name: 'Cases unavailable' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No cases yet' })).toHaveCount(0);
  await openConsoleView(page, 'watchlists');
  await expect(page.getByRole('tab', { name: /^Watchlists/ }).locator('span')).toHaveAttribute('aria-label', 'count unavailable');
  await expect(page.getByRole('heading', { name: 'Watchlists unavailable' })).toBeVisible();
  await expect(page.getByText(/No watchlists/i)).toHaveCount(0);
});

test('recorded operations reporting stays aggregate, source-qualified, and usable on mobile', async ({ page }) => {
  const now = Date.now();
  const actionUpdatedAt = new Date(now - 60_000).toISOString();
  const actionCreatedAt = new Date(now - 9 * 86_400_000).toISOString();
  const overdueAt = new Date(now - 86_400_000).toISOString();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/monitor');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': {
      version: CASE_SCHEMA_VERSION,
      cases: [
        caseRecord({
          id: 'case-operations-prepared',
          domain: 'prepared.invalid',
          actions: [currentActionFixture({
            id: 'action-prepared', type: 'registrar_report', recipient: 'Reviewed registrar route',
            contactSource: 'Published registrar policy', contactLimitations: ['Reachability was not tested.'],
            routeObservedAt: actionCreatedAt,
            dueAt: overdueAt, targetState: 'ready_for_review', reference: null,
            followUpAt: null, outcome: null, createdAt: actionCreatedAt, updatedAt: actionUpdatedAt,
          })],
        }),
        caseRecord({
          id: 'case-operations-resolved',
          domain: 'resolved.invalid',
          actions: [currentActionFixture({
            id: 'action-resolved', type: 'security_contact_report', recipient: 'Private response route',
            contactSource: 'Analyst supplied', contactLimitations: [], dueAt: null, targetState: 'terminal',
            routeObservedAt: actionCreatedAt,
            reference: 'PRIVATE-CASE-7', followUpAt: null, outcome: 'Private analyst outcome text.',
            createdAt: actionCreatedAt, updatedAt: actionUpdatedAt,
          })],
        }),
        caseRecord({ id: 'case-packet-only', domain: 'packet-only.invalid', actions: [] }),
      ],
    },
  });

  await page.getByText('Case reports and follow-up tools', { exact: true }).click();
  const report = page.locator('.operations-report');
  await expect(report).toContainText('2 current action records across 2 of 3 inspected Cases');
  await expect(report.getByText('Ready for review', { exact: true })).toBeVisible();
  await expect(report).toContainText('Readiness is distinct from review or authorisation');
  await report.getByLabel('Audience').selectOption('executive');
  await expect(report.getByText('Cases with actions', { exact: true })).toBeVisible();
  await expect(report).toContainText('Denominator: 3 inspected Cases');
  await report.getByLabel('Time window').selectOption('all');
  await report.getByText('Exact current-state and action-type counts', { exact: true }).click();
  await report.getByText('Typed-event duration context', { exact: true }).click();
  const exactSections = report.locator('.exact-grid > section');
  const durationCards = report.locator('.duration-grid > article');
  expect(new Set(await exactSections.evaluateAll((sections) => sections.map((section) => Math.round(section.getBoundingClientRect().top)))).size).toBe(2);
  expect(new Set(await durationCards.evaluateAll((cards) => cards.map((card) => Math.round(card.getBoundingClientRect().top)))).size).toBe(2);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(new Set(await exactSections.evaluateAll((sections) => sections.map((section) => Math.round(section.getBoundingClientRect().top)))).size).toBe(2);
  expect(new Set(await durationCards.evaluateAll((cards) => cards.map((card) => Math.round(card.getBoundingClientRect().top)))).size).toBe(2);
  await expectNoHorizontalOverflow(page);

  const pending = page.waitForEvent('download');
  await report.getByRole('button', { name: 'Export aggregate JSON' }).click();
  const download = await pending;
  const path = await download.path();
  expect(path).not.toBeNull();
  const body = await readFile(path!, 'utf8');
  const exported = JSON.parse(body);
  expect(exported).toMatchObject({
    schema: 'whoisleuth.brand-protection-operations-report',
    version: 2,
    sourceState: 'ready',
    counts: { casesInspected: 3, casesWithActions: 2, actions: 2, readyForReview: 1, submitted: 0, terminal: 1 },
  });
  expect(Object.keys(exported).sort()).toEqual([
    'actionTypes', 'counts', 'durations', 'generatedAt', 'limitations', 'omissions', 'schema', 'sourceState', 'states', 'version', 'window',
  ]);
  expect(Object.keys(exported.window).sort()).toEqual(['basis', 'endAt', 'id', 'startAt']);
  expect(Object.keys(exported.omissions).sort()).toEqual(['actionsBeyondLimit', 'actionsOutsideWindow', 'actionsWithInvalidTime', 'casesBeyondLimit', 'observedEffectReviewsOmitted', 'transitionEventsOmitted']);
  for (const sentinel of [
    'case-operations-prepared', 'case-operations-resolved', 'prepared.invalid', 'resolved.invalid',
    'Reviewed registrar route', 'Published registrar policy', 'Reachability was not tested.',
    'Private response route', 'Analyst supplied', 'PRIVATE-CASE-7', 'Private analyst outcome text.',
  ]) expect(body).not.toContain(sentinel);
  await expect(operationsReportActionStatus(page, 'No response was submitted')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('response lifecycle surfaces remain accessible across major desktop and mobile viewports and both themes', async ({ page }) => {
  test.slow();
  const now = new Date().toISOString();
  const createdAt = new Date(Date.parse(now) - 5_000).toISOString();
  await page.goto('/monitor');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': {
      version: CASE_SCHEMA_VERSION,
      cases: [caseRecord({
        id: 'response-layout-case',
        domain: 'response-layout.invalid',
        actions: [currentActionFixture({
          id: 'response-layout-action', type: 'registrar_report', recipient: 'Reserved review route',
          contactSource: 'Reserved fixture source', contactLimitations: ['Reachability was not tested.'],
          routeObservedAt: createdAt,
          dueAt: null, targetState: 'acknowledged', reference: 'CASE-EXAMPLE-LAYOUT', followUpAt: null,
          outcome: 'Acknowledged for bounded review.', createdAt, updatedAt: now,
        })],
      })],
    },
  });

  for (const surface of [
    { width: 1440, height: 1000, theme: 'light' },
    { width: 1024, height: 768, theme: 'dark' },
    { width: 390, height: 844, theme: 'light' },
    { width: 320, height: 700, theme: 'dark' },
  ] as const) {
    await page.setViewportSize({ width: surface.width, height: surface.height });
    await page.evaluate((theme) => localStorage.setItem('whoisleuth:theme:v1', theme), surface.theme);
    await page.reload();
    await openConsoleView(page, 'cases');
    const head = page.locator('.case-head', { hasText: 'response-layout.invalid' });
    if (!new URL(page.url()).searchParams.has('case')) await head.click();
    const workspace = await openCaseResponseWorkspace(page, '', 'advanced', 'Response');
    const actions = workspace.locator('details', { hasText: 'Track append-only response actions' });
    await actions.getByText('Track append-only response actions', { exact: true }).click();
    const actionTimelines = actions.getByRole('list', { name: 'Response action transition timelines' });
    await expect(actionTimelines).toContainText('submitted → acknowledged');
    await expect(actionTimelines).toContainText('Provider outcome: accepted for review · Acknowledged for bounded review.');
    await actions.getByRole('button', { name: 'Review or append event' }).focus();
    await expect(actions.getByRole('button', { name: 'Review or append event' })).toBeFocused();
    const remediation = workspace.locator('details', { hasText: 'Verify remediation independently and close deliberately' });
    await remediation.getByText('Verify remediation independently and close deliberately', { exact: true }).click();
    await expect(remediation).toContainText('Provider outcome time');
    await expect(remediation).toContainText('Independently observed change time');
    const packet = workspace.locator('details', { hasText: 'Prepare a reviewed abuse evidence packet' });
    await packet.getByText('Prepare a reviewed abuse evidence packet', { exact: true }).click();
    await openPacketWizardStep(packet, 'Review');
    await expect(packet.locator('.readiness-matrix tbody tr')).toHaveCount(10);
    await expect(packet).toContainText('Partial and stale states remain visible and require deliberate freshness and limitation confirmation');
    await expect(page.locator('html')).toHaveAttribute('data-theme', surface.theme);
    await expectNoHorizontalOverflow(page);
  }
});


test('@timing-sensitive a case created from Monitor persists across a reload', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'tracked.invalid');

  await expect(caseWorkspaceActionStatus(page)).toHaveText(/Opened a new case for tracked\.invalid/);
  const head = page.locator('.case-heading', { hasText: 'tracked.invalid' });
  await expect(head.locator('.badge').first()).toHaveText('New');
  await expect(head.locator('.badge').nth(1)).toHaveText('Unreviewed');

  await page.reload();
  await openConsoleView(page, 'cases');
  await expect(page.getByRole('heading', { name: 'tracked.invalid', exact: true })).toBeVisible();
});

test('a Case keeps its stable reference, controlled types, exact incident links and reporting route together', async ({ page }, testInfo) => {
  test.slow();
  await openCasesView(page);
  await createCase(page, 'reported-content.invalid');
  const initial = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  const stored = requiredValue(initial.records[0], 'The created Case is missing.').value;
  const expectedNumber = caseNumber(stored.id);
  const head = page.locator('.case-heading', { hasText: 'reported-content.invalid' });
  await expect(head).toContainText(`Case …${expectedNumber.slice(-8)}`);

  const workspace = await openCaseResponseWorkspace(page);
  await openCaseClassification(page);
  await expect(workspace.locator('.case-number code')).toHaveText(formattedCaseNumber(stored.id), { useInnerText: true });
  await workspace.getByRole('checkbox', { name: /^Phishing/u }).check();
  await workspace.getByRole('checkbox', { name: /^Trademark infringement/u }).check();
  await workspace.getByRole('checkbox', { name: /^Copyright infringement/u }).check();
  await workspace.getByRole('button', { name: 'Save Case types', exact: true }).click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('Saved Case types');
  await expect(workspace.locator('.case-types')).not.toHaveAttribute('open', '');
  await expect(workspace.locator('.case-types').locator(':scope > summary')).toContainText('Phishing, Trademark infringement and 1 more');
  const typeReadiness = workspace.getByRole('region', { name: 'Evidence readiness by Case type' });
  await expect(typeReadiness).toContainText('required missing');
  await expect(typeReadiness).toContainText('Exact incident link');

  const incidentUrl = 'https://www.tiktok.com/@example/video/7';
  await workspace.getByLabel('Exact HTTP(S) URL').fill(incidentUrl);
  await workspace.getByRole('button', { name: 'Add incident link' }).click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('Added an exact incident target');
  const routes = workspace.locator('.reporting-routes');
  await expect(routes).toContainText('TikTok');
  await expect(routes).toContainText('Report an account or content');
  await expect(routes).toContainText('Submit a trademark or counterfeit report');
  const trademarkRoute = routes.locator('.route', { hasText: 'Submit a trademark or counterfeit report' });
  const copyrightRoute = routes.locator('.route', { hasText: 'Submit a copyright report' });
  await trademarkRoute.getByRole('checkbox').first().check();
  await expect(copyrightRoute.getByRole('checkbox').first()).not.toBeChecked();
  await workspace.locator('.case-types').locator(':scope > summary').click();
  await workspace.getByRole('checkbox', { name: /^Trademark infringement/u }).uncheck();
  await expect(trademarkRoute).toHaveCount(0);
  await expect(copyrightRoute.getByRole('checkbox').first()).not.toBeChecked();
  await workspace.getByRole('checkbox', { name: /^Trademark infringement/u }).check();
  await expect(trademarkRoute.getByRole('checkbox').first()).not.toBeChecked();
  await workspace.getByRole('button', { name: 'Save Case types', exact: true }).click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('Saved Case types');
  await routes.locator('.route', { hasText: 'Report an account or content' }).getByRole('button', { name: 'Create drafting action' }).click();
  await expect(caseWorkspaceActionStatus(page)).toContainText('Nothing was submitted');
  for (const width of [1280, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : width === 1024 ? 768 : width === 390 ? 844 : 700 });
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      await trademarkRoute.getByRole('group', { name: 'Preparation checklist', exact: true }).scrollIntoViewIfNeeded();
      await expect(trademarkRoute.getByRole('checkbox').first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await testInfo.attach(`route-checklist-${width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
    }
  }

  const packet = workspace.locator('details', { hasText: 'Prepare a reviewed abuse evidence packet' });
  await openCaseSection(page, 'Response');
  await packet.getByText('Prepare a reviewed abuse evidence packet', { exact: true }).click();
  await expect(packet.getByLabel('Abuse category')).toHaveValue('Phishing, Trademark infringement and 1 more');
  await expect(packet.getByLabel('Exact abusive HTTP(S) URLs')).toHaveValue(incidentUrl);

  await openCaseMetadata(page);
  await page.getByLabel('Additional tags').fill('priority-review');
  await page.getByRole('button', { name: 'Save tags' }).click();
  await expect.poll(async () => {
    const saved = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
    return saved.records.find((item) => item.value.id === stored.id)?.value.tags;
  }).toEqual(['case-type:phishing', 'case-type:trademark_infringement', 'case-type:copyright_infringement', 'priority-review']);
  const updated = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  const updatedCase = requiredValue(updated.records[0], 'The updated Case is missing.').value;
  expect(updatedCase.assertions).toEqual(expect.arrayContaining([expect.objectContaining({ statement: `Incident target URL: ${incidentUrl}`, state: 'open' })]));
  expect(updatedCase.actions).toEqual(expect.arrayContaining([expect.objectContaining({
    type: 'platform_report',
    recipient: 'https://www.tiktok.com/legal/report/feedback',
    routeReviewAfter: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/u),
  })]));

  await page.reload();
  await openConsoleView(page, 'cases');
  await page.getByRole('link', { name: 'All Cases', exact: true }).click();
  await page.getByLabel('Search').fill('copyright infringement');
  const restoredHead = page.locator('.case-head', { hasText: 'reported-content.invalid' });
  await expect(page.locator('.tag', { hasText: 'Phishing' })).toBeVisible();
  await restoredHead.click();
  await openCaseMetadata(page);
  await expect(page.getByLabel('Additional tags')).toHaveValue('priority-review');
  await expectNoHorizontalOverflow(page);
});

test('the evidence-gap inbox filters and dismisses a stale failed source on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto('/monitor');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': {
      version: CASE_SCHEMA_VERSION,
      cases: [{
        ...caseRecord({
          id: 'case-gap-mobile',
          domain: 'gap-mobile.invalid',
          status: 'reviewing',
          disposition: 'suspicious',
          updatedAt: '2026-05-01T00:00:00.000Z',
        }),
        evidencePins: [{
          id: 'pin-gap-mobile',
          checkpointId: null,
          field: 'whois.registrar',
          category: 'registration',
          label: 'WHOIS registrar',
          value: 'Unavailable',
          source: 'whois',
          sourceState: 'failed',
          sourceSchema: null,
          observedAt: '2026-05-01T00:00:00.000Z',
          collectionDepth: 'deep',
          completeness: 'partial',
          truncated: false,
          transitionExpectation: null,
          limitations: ['The source did not answer.'],
          createdAt: '2026-05-01T00:00:00.000Z',
        }],
        decisions: [],
        actions: [],
        assertions: [],
        manualTrail: [],
      }],
    },
  });

  const reviewInbox = page.locator('.review-inbox');
  await expect(reviewInbox).toBeVisible();
  await reviewInbox.locator('details.advanced-filters > summary').click();
  const detailFilters = reviewInbox.getByRole('group', { name: 'Advanced review filters' });
  await detailFilters.getByRole('combobox', { name: 'Source', exact: true }).selectOption('whois');
  await detailFilters.getByRole('combobox', { name: 'Age', exact: true }).selectOption('stale');
  await detailFilters.getByRole('textbox', { name: 'Case', exact: true }).fill('gap-mobile');
  await detailFilters.getByRole('combobox', { name: 'Severity', exact: true }).selectOption('high');
  await detailFilters.getByRole('combobox', { name: 'Next action', exact: true }).selectOption('refresh');
  const item = page.locator('.review-inbox .items li', { hasText: 'gap-mobile.invalid' });
  await expect(item).toBeVisible();
  await openInboxReview(item);
  await expect(item).toContainText('stale');
  await expect(item.getByRole('link', { name: 'Refresh evidence' })).toHaveAttribute('href', '/lookup?q=gap-mobile.invalid&depth=deep&case=case-gap-mobile');
  await item.getByRole('combobox').selectOption('accepted_limitation');
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  await failNextBrowserLocalCollectionReadAfterWrite(page, 'cases');
  await item.getByRole('button', { name: 'Dismiss gap' }).click();
  await expect(item).toHaveCount(0);
  await expect(reviewInboxActionStatus(page, 'Recorded the reviewed evidence-gap dismissal')).toBeVisible();
  await expect(reviewInboxActionStatus(page, 'The change was saved, but Cases could not be reread')).toBeVisible();
  const committed = await readBrowserLocalCollection(page, 'cases', {
    minimumRecords: 1,
    minimumRevision: before.manifest.revision + 1,
  });
  expect(requiredValue(committed.records[0], 'The dismissed evidence-gap Case is missing.').value.manualTrail).toHaveLength(1);
  await expectNoHorizontalOverflow(page);
});

test('the mobile review inbox reveals and focuses a saved Bulk session', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/monitor');
  await migrateLegacyBrowserData(page, {
    'whoisleuth-bulk-sessions-v1': currentBulkSessionBrowserStore([{
        id: 'inbox-partial-session',
        name: 'Incomplete review',
        mode: 'fast',
        state: 'partial',
        inputDigest: `sha256:${'a'.repeat(64)}`,
        domains: ['pending.invalid'],
        results: [],
        startedAt: '2026-08-07T00:00:00.000Z',
        updatedAt: '2026-08-07T00:00:00.000Z',
        completedAt: null,
      }]),
  });

  const item = page.locator('.review-inbox .items li', { hasText: 'Continue Incomplete review' });
  await openInboxReview(item);
  await item.getByRole('link', { name: 'Review' }).click();

  await expect(page).toHaveURL(/\/bulk#bulk-sessions-title$/u);
  await expect(page.getByRole('button', { name: /Workspace tools/u })).toHaveAttribute('aria-expanded', 'true');
  const title = page.getByRole('heading', { name: 'Saved Bulk sessions' });
  await expect(title).toBeVisible();
  await expect(title).toBeFocused();
  await expectNoHorizontalOverflow(page);
});

test('status and disposition edits persist across a reload', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'triage.invalid');
  await openCaseMetadata(page);

  await page.locator('.metadata-fields .field-grid select').first().selectOption('escalated');
  await page.locator('.metadata-fields .field-grid select').nth(1).selectOption('confirmed_abuse');

  const head = page.locator('.case-heading', { hasText: 'triage.invalid' });
  await expect(head.locator('.badge').first()).toHaveText('Escalated');
  await expect(head.locator('.badge').nth(1)).toHaveText('Confirmed abuse');

  await page.reload();
  await openConsoleView(page, 'cases');
  const reloaded = page.locator('.case-heading', { hasText: 'triage.invalid' });
  await expect(reloaded.locator('.badge').first()).toHaveText('Escalated');
  await expect(reloaded.locator('.badge').nth(1)).toHaveText('Confirmed abuse');
});

test('reviewed cases export an explicitly selected privacy-bounded Risk calibration dataset', async ({ page }) => {
  await page.goto('/monitor');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': {
      version: CASE_SCHEMA_VERSION,
      cases: [
        caseRecord({
          id: 'reviewed-calibration',
          domain: 'reviewed-calibration.invalid',
          disposition: 'confirmed_abuse',
          notes: [{ createdAt: '2026-07-29T00:00:00.000Z', body: 'Private analyst note' }],
          evidenceHistory: [snapshot({
            id: 'reviewed-calibration-evidence',
            riskScore: 75,
            faviconMatch: true,
            hasPasswordField: true,
          })],
        }),
        caseRecord({
          id: 'unreviewed-calibration',
          domain: 'unreviewed-calibration.invalid',
          disposition: 'unreviewed',
          evidenceHistory: [snapshot({ id: 'unreviewed-calibration-evidence' })],
        }),
      ],
    },
  });
  await openConsoleView(page, 'cases');

  const reviewed = page.getByRole('article').filter({
    has: page.getByText('reviewed-calibration.invalid', { exact: true }),
  });
  const unreviewed = page.getByRole('article').filter({
    has: page.getByText('unreviewed-calibration.invalid', { exact: true }),
  });
  await expect(page.getByRole('button', { name: /^Review calibration export/u })).toHaveCount(0);
  await page.getByText('Advanced Case tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Select Cases for calibration export', exact: true }).click();
  await expect(unreviewed.getByRole('checkbox', { name: 'Include in offline Risk calibration export' })).toBeDisabled();

  await reviewed.getByRole('checkbox', { name: 'Include in offline Risk calibration export' }).check();
  await expect(page.getByRole('button', { name: 'Review calibration export (1)' })).toBeEnabled();
  await page.getByRole('button', { name: 'Review calibration export (1)' }).click();
  const review = page.getByRole('dialog', { name: 'Confirm Risk calibration dataset' });
  await expect(review).toContainText('1 selected');
  await expect(review).toContainText('1 included');
  await expect(review).toContainText('0 excluded');
  await expect(review).toContainText('reviewed-calibration.invalid');
  await expect(review).toContainText('Confirmed abuse');
  await expect(review).toContainText('Notes, tags, assertions, actions, contacts, raw evidence');
  const downloadPromise = page.waitForEvent('download');
  await review.getByRole('button', { name: 'Confirm local export' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^whoisleuth-risk-calibration-\d{4}-\d{2}-\d{2}\.json$/);
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exported = JSON.parse(await readFile(downloadPath!, 'utf8'));

  expect(exported).toMatchObject({
    schema: 'whoisleuth.risk-calibration-dataset',
    version: 2,
    records: [{
      id: 'reviewed-calibration',
      domain: 'reviewed-calibration.invalid',
      analystDisposition: 'confirmed_abuse',
      evidence: {
        availability: 'registered',
        faviconMatch: true,
        hasPasswordField: true,
      },
    }],
    export: { selected: 1, included: 1, excluded: 0 },
  });
  expect(JSON.stringify(exported)).not.toContain('Private analyst note');
  expect(JSON.stringify(exported)).not.toContain('"riskScore"');
  await expect(caseWorkspaceActionStatus(page)).toContainText('No model setting was changed');

  await page.setViewportSize({ width: 390, height: 844 });
  await reviewed.getByRole('checkbox', { name: 'Include in offline Risk calibration export' }).uncheck();
  await expect(page.getByRole('button', { name: /^Review calibration export/u })).toHaveCount(0);
  await reviewed.getByRole('checkbox', { name: 'Include in offline Risk calibration export' }).check();
  await page.getByRole('button', { name: 'Review calibration export (1)' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm Risk calibration dataset' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('case tags offer bounded in-tab undo', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'undo-review.invalid');
  await openCaseMetadata(page);

  const tags = page.getByLabel('Tags');
  await tags.fill('review, phishing');
  await page.getByRole('button', { name: 'Save tags' }).click();
  await expect(page.getByRole('region', { name: 'Undo analyst change' })).toContainText('undo-review.invalid');
  await page.getByRole('region', { name: 'Undo analyst change' }).getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(tags).toHaveValue('');
});

test('Case tag undo preserves a newer change from another tab', async ({ page }) => {
  await page.clock.setFixedTime('2026-09-08T00:00:00.000Z');
  await openCasesView(page);
  await createCase(page, 'undo-conflict.invalid');
  await openCaseMetadata(page);
  const other = await page.context().newPage();
  try {
    await other.goto('/monitor?view=cases');
    await other.locator('.case-head', { hasText: 'undo-conflict.invalid' }).click();
    await openCaseMetadata(other);
    await page.getByRole('textbox', { name: /^Additional tags\b/u }).fill('first-review');
    await page.getByRole('button', { name: 'Save tags', exact: true }).click();
    const undo = page.getByRole('region', { name: 'Undo analyst change' });
    await expect(undo).toBeVisible();
    await other.getByRole('textbox', { name: /^Additional tags\b/u }).fill('later-review');
    await other.getByRole('button', { name: 'Save tags', exact: true }).click();
    await expect.poll(async () => (await readBrowserLocalCollection(other, 'cases')).records[0]?.value.tags).toEqual(['later-review']);
    await undo.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByText('The saved value changed after this action. Undo was not applied; the newer changes were preserved.', { exact: true })).toBeVisible();
    const stored = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
    expect(stored.records[0]?.value.tags).toEqual(['later-review']);
  } finally {
    await other.close();
  }
});

test('projects retained evidence into a filterable source-attributed timeline', async ({ page }) => {
  await page.goto('/monitor?view=timeline');
  const observedAt = new Date(Date.now() - 9 * 86_400_000).toISOString();
  const storedAt = new Date(Date.parse(observedAt) + 86_400_000).toISOString();
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': {
      version: CASE_SCHEMA_VERSION,
      cases: [caseRecord({
        id: 'timeline-case',
        domain: 'timeline-case.invalid',
        updatedAt: storedAt,
        evidenceHistory: [snapshot({ id: 'timeline-snapshot', capturedAt: observedAt })],
        evidencePins: [{
          id: 'timeline-pin', checkpointId: null, field: 'registration.status', category: 'registration',
          label: 'Registration status', value: 'registered', source: 'registry evidence', sourceState: 'complete',
          sourceSchema: null, observedAt, collectionDepth: 'deep', completeness: 'complete', truncated: false,
          transitionExpectation: null, limitations: ['Retained fixture evidence.'], createdAt: storedAt,
        }],
      })],
    },
    'whois-rdap-watchlist-v1': currentBrowserLocalDocument('watchlists', {
      watchlists: {
        'Timeline watchlist': {
          updatedAt: storedAt,
          results: [],
          baseline: [],
          history: [{
            checkedAt: observedAt,
            mode: 'deep',
            resultCount: 1,
            conclusiveCount: 1,
            changeCount: 1,
            omittedChanges: 0,
            changes: [{ domain: 'timeline-case.invalid', field: 'availability', before: 'available', after: 'registered', kind: 'new_registration', tone: 'danger' }],
          }],
        },
      },
    }),
    'whoisleuth-relationship-observations-v1': currentBrowserLocalDocument('relationship_observations', {
      observations: [{
        id: 'relationship-timeline-fixture',
        type: 'ip_address',
        label: 'Shared IP address',
        method: 'Exact normalized address',
        normalizedValue: '192.0.2.40',
        displayValue: '192.0.2.40',
        domains: ['timeline-case.invalid', 'timeline-related.invalid'],
        description: 'Bounded relationship fixture.',
        classification: 'derived',
        source: 'bulk_relationship_analysis',
        sourceVersion: 1,
        observedAt,
        retainedAt: storedAt,
        complete: true,
        truncated: false,
        limitations: ['Shared infrastructure is not proof of common control.'],
      }],
    }),
    'whoisleuth-website-snapshots-v1': currentBrowserLocalDocument('website_snapshots', {
      snapshots: [{
        id: 'timeline-website-snapshot',
        domain: 'timeline-case.invalid',
        observedAt,
        savedAt: storedAt,
        complete: false,
        truncated: true,
        technologies: [],
        posture: [],
        identity: {},
        sources: [{ source: 'page', state: 'partial' }],
      }],
    }),
    'whoisleuth-bulk-sessions-v1': currentBulkSessionBrowserStore([{
        id: 'timeline-bulk-session',
        name: 'Timeline Bulk review',
        mode: 'deep',
        state: 'partial',
        inputDigest: `sha256:${'a'.repeat(64)}`,
        domains: ['timeline-case.invalid'],
        results: [],
        startedAt: observedAt,
        updatedAt: storedAt,
        completedAt: observedAt,
      }]),
  });

  await expect(page.getByRole('tab', { name: /Timeline/ })).toHaveAttribute('aria-selected', 'true');
  const workspace = page.getByRole('region', { name: 'Investigation timeline' });
  await expect(workspace.locator('.timeline-list article')).toHaveCount(6);
  await expect(workspace).toContainText('Observed');
  await expect(workspace).toContainText('Stored');
  await expect(workspace).toContainText('Derived relationship');
  const pinnedEvidence = workspace.locator('.timeline-list article', { hasText: 'Evidence pin' });
  await pinnedEvidence.getByRole('link', { name: /Open Case · timeline-case\.invalid/u }).click();
  await expect(page).toHaveURL('/cases?case=timeline-case&section=evidence');
  await expect(page.getByRole('navigation', { name: 'Case sections', exact: true }).getByRole('link', { name: 'Evidence', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#case-head-timeline-case')).toBeFocused();
  await openConsoleView(page, 'timeline');
  await expect(page.getByRole('region', { name: 'Investigation timeline' })).toBeVisible();
  await page.getByLabel('Area').selectOption('bulk');
  await expect(workspace.locator('.timeline-list article')).toHaveCount(1);
  await expect(workspace).toContainText('Timeline Bulk review retained');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByLabel('Freshness').selectOption('stale');
  await expect(workspace.locator('.timeline-list article')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByLabel('Type').selectOption('change');
  await expect(workspace.locator('.timeline-list article')).toHaveCount(1);
  await expect(workspace).toContainText('watchlist change');
  await workspace.getByRole('link', { name: /Open Watchlist · Timeline watchlist/u }).click();
  await expect(page).toHaveURL('/monitor?view=watchlists&watchlist=Timeline%20watchlist');
  await expect(page.getByRole('heading', { name: 'Timeline watchlist' })).toBeVisible();
  await expect(page.locator('#watchlist-history')).toBeFocused();
  await openConsoleView(page, 'timeline');
  await page.getByRole('searchbox', { name: 'Entity', exact: true }).fill('timeline-related.invalid');
  await expect(workspace.locator('.timeline-list article')).toHaveCount(1);
  await expect(workspace.getByRole('link', { name: /Open Retained relationship/ })).toHaveAttribute('href', /view=relationships/);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test('the timeline renders every supported Case snapshot after storage admission', async ({ page }) => {
  await page.goto('/monitor?view=timeline');
  const start = Date.parse('2026-07-22T00:00:00.000Z');
  const history = Array.from({ length: 25 }, (_, index) => snapshot({
    registrar: `Fixture registrar ${index}`,
    capturedAt: new Date(start + index * 60_000).toISOString(),
  }));
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: [caseRecord({ evidenceHistory: history })] },
  });
  const stored = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  expect(stored.records[0]?.value.evidenceHistory).toHaveLength(25);
  const timeline = page.getByRole('region', { name: 'Investigation timeline' });
  await expect(timeline.locator('.timeline-list article')).toHaveCount(25);
  await expect(timeline.locator('.partial')).toHaveCount(0);
  const observed = await timeline.locator('article dl div', { has: page.getByText('Observed', { exact: true }) }).locator('time').evaluateAll((elements) => elements.map((element) => element.getAttribute('datetime')));
  expect(new Set(observed)).toEqual(new Set(history.map((item) => item.capturedAt)));
  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);
});

test('saved website profiles form searchable cross-domain pivots without another request', async ({ page }, testInfo) => {
  const observedAt = '2026-07-01T00:00:00.000Z';
  const identity = {
    normalizedHtml: 'a'.repeat(64),
    visibleText: null,
    domStructure: null,
    formStructure: null,
    resourceHosts: null,
    trackingIdentifiers: null,
    faviconHash: 'b'.repeat(64),
  };
  const snapshotRecord = (domain: string, id: string): WebsiteProfileSnapshot => ({
    id,
    domain,
    observedAt,
    savedAt: '2026-07-02T00:00:00.000Z',
    complete: true,
    truncated: false,
    profileProvenance: {
      technology: { version: 1, state: 'known' }, securityPosture: { version: 1, state: 'known' },
      pageFingerprint: { version: 1, state: 'known' },
    },
    technologies: [{ id: 'example-commerce', name: 'Example commerce', category: 'commerce', confidence: 'high', roles: [] }],
    posture: [],
    identity,
    identityValues: { resourceHosts: [], trackingIdentifiers: [], formActionOrigins: [] },
    sources: [{ source: 'http', state: 'success' }],
    dependencies: [],
    certificate: null,
  });
  const collectorRequests: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/') && !['/api/session', '/api/capabilities'].includes(pathname)) collectorRequests.push(pathname);
  });
  await page.goto('/monitor?view=relationships');
  await migrateLegacyBrowserData(page, {
    'whoisleuth-website-snapshots-v1': currentBrowserLocalDocument('website_snapshots', {
      snapshots: [
        snapshotRecord('first.invalid', 'profile-first'),
        snapshotRecord('second.invalid', 'profile-second'),
      ],
    }),
  });

  const workspace = page.getByRole('region', { name: 'Cross-domain website pivots' });
  await expect(workspace.getByText('50/100 across 3 contributing fields', { exact: true })).toBeVisible();
  await expect(workspace.getByText('Example commerce', { exact: true })).toBeVisible();
  await expect(workspace.getByRole('link', { name: 'first.invalid' }).first()).toBeVisible();
  await expect(workspace.getByRole('link', { name: 'second.invalid' }).first()).toBeVisible();
  await migrateLegacyBrowserData(page, {
    'whoisleuth-website-snapshots-v1': currentBrowserLocalDocument('website_snapshots', {
      snapshots: ['first', 'second'].map((name) => {
        const record = snapshotRecord(`${name}.invalid`, `profile-${name}`);
        return { ...record, profileProvenance: {
          ...record.profileProvenance, pageFingerprint: { version: null, state: 'legacy_unknown' },
        } };
      }),
    }),
  });
  await expect(workspace.getByText('30/100 across 2 contributing fields', { exact: true })).toBeVisible();
  await expect(workspace.getByText('50/100 across 3 contributing fields', { exact: true })).toHaveCount(0);
  await workspace.getByLabel('Search saved profiles').fill('DOM structure');
  await expect(workspace.getByText('No saved website-profile cluster matches these filters.')).toBeVisible();
  await workspace.getByLabel('Search saved profiles').fill('second.invalid');
  await expect(workspace.getByText('Example commerce', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await migrateLegacyBrowserData(page, {
    'whoisleuth-website-snapshots-v1': currentBrowserLocalDocument('website_snapshots', {
      snapshots: [
        { ...snapshotRecord('first.invalid', 'profile-first'), sources: [{ source: 'http', state: 'partial' }] },
        snapshotRecord('second.invalid', 'profile-second'),
      ],
    }),
  });
  await expect(workspace.getByText('Example commerce', { exact: true })).toBeVisible();
  await expect(workspace.getByText('Weighted website-profile relationship', { exact: true })).toHaveCount(0);
  await expect(workspace.locator('.cluster-head > strong')).toHaveText(['2 domains', '2 domains', '2 domains']);
  const observedDomain = workspace.locator('li', { has: page.getByRole('link', { name: 'first.invalid', exact: true }) });
  expect(await observedDomain.count()).toBeGreaterThan(0);
  for (const observation of await observedDomain.all()) await expect(observation).toContainText('Partial saved evidence');
  await workspace.getByLabel('Relationship type').selectOption('similarity');
  await expect(workspace.getByText('No saved website-profile cluster matches these filters.')).toBeVisible();
  await workspace.getByLabel('Relationship type').selectOption('all');
  await expectNoHorizontalOverflow(page);
  await workspace.getByText('Example commerce', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('partial-profile-pivots.png') });
  expect(collectorRequests).toEqual([]);
});

test('custom detection rules evaluate existing cases without rewriting built-in scores', async ({ page }) => {
  await page.goto('/monitor');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': {
      version: CASE_SCHEMA_VERSION,
      cases: [caseRecord({ domain: 'rule-match.invalid', evidenceHistory: [snapshot({ riskScore: 65, hasPasswordField: true })] })],
    },
  });
  await openConsoleView(page, 'rules');

  await page.getByLabel('Name', { exact: true }).fill('Password page above threshold');
  await page.getByLabel('Custom contribution').fill('15');
  await page.getByLabel('Suggested tag').fill('manual-review');
  await page.getByLabel('Field').selectOption('hasPasswordField');
  await page.getByRole('button', { name: 'Add condition' }).click();
  await page.getByLabel('Field').nth(1).selectOption('riskScore');
  await page.getByLabel('Comparison').nth(1).selectOption('at_least');
  await page.getByLabel('Value').nth(1).fill('60');
  await page.getByRole('button', { name: 'Create custom rule' }).click();

  const result = page.locator('.test-results li', { hasText: 'rule-match.invalid' });
  await expect(result).toContainText('Built-in 65');
  await expect(result).toContainText('Custom +15');
  await expect(result).toContainText('Context 80');
  await expect(result).toContainText('Suggested: manual-review');
  const storedCase = requiredValue(
    (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0],
    'The saved case fixture is missing.',
  ).value;
  const storedScore = requiredValue(
    storedCase.evidenceHistory[0],
    'The saved case evidence fixture is missing.',
  ).riskScore;
  expect(storedScore).toBe(65);
});

test('shows saved custom rules when the tab opens before browser-local loading finishes', async ({ page }) => {
  await page.goto('/dashboard');
  await migrateLegacyBrowserData(page, {
    'whoisleuth-detection-rules-v1': {
      version: 1,
      rules: [{
        id: 'delayed-rule',
        name: 'Delayed custom rule',
        enabled: true,
        match: 'all',
        conditions: [{ field: 'status', operator: 'equals', value: 'new' }],
        riskDelta: 0,
        tag: '',
      }],
    },
  });
  await expect(page.locator('a[href="/monitor?view=watchlists"]').first()).toBeVisible();
  await holdBrowserLocalReads(page, 4_000, 'a[href="/monitor?view=watchlists"]');
  await page.waitForURL(/\/monitor(?:\?|$)/u);
  await openConsoleView(page, 'rules');

  await expect(page.getByRole('region', { name: 'Custom detection rules' })
    .getByRole('article').filter({ hasText: 'Delayed custom rule' })).toBeVisible({ timeout: 10_000 });
});

test('custom rules persist, can be disabled, and export a versioned safe schema', async ({ page }) => {
  await page.goto('/monitor');
  await openConsoleView(page, 'rules');
  await page.getByLabel('Name', { exact: true }).fill('Registered domains');
  await page.getByRole('button', { name: 'Create custom rule' }).click();
  const customRules = page.getByRole('region', { name: 'Custom detection rules' });
  await expect(customRules.getByRole('article').filter({ hasText: 'Registered domains' })).toBeVisible();

  await openConsoleView(page, 'cases');
  await openConsoleView(page, 'rules');
  await expect(page.getByRole('region', { name: 'Custom detection rules' }).getByRole('article').filter({ hasText: 'Registered domains' })).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });
  const customRulesTab = page.getByRole('tab', { name: /Custom rules/ });
  await expect(customRulesTab).toBeVisible();
  await customRulesTab.click();
  const rule = page
    .getByRole('region', { name: 'Custom detection rules' })
    .getByRole('article')
    .filter({ hasText: 'Registered domains' });
  await expect(rule).toBeVisible();
  await rule.getByRole('button', { name: 'Enabled' }).click();
  await expect(rule.getByRole('button', { name: 'Disabled' })).toHaveAttribute('aria-pressed', 'false');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^whoisleuth-custom-rules-\d{4}-\d{2}-\d{2}\.json$/);
  const body = await (await download.createReadStream()).toArray();
  const payload = JSON.parse(Buffer.concat(body).toString('utf8'));
  expect(payload.schema).toBe('whoisleuth.detection-rules');
  expect(payload.version).toBe(1);
  expect(payload.rules[0].enabled).toBe(false);
  expect(JSON.stringify(payload)).not.toContain('function');
});

test('custom-rule controls and results avoid horizontal overflow on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/monitor');
  await openConsoleView(page, 'rules');
  await page.getByLabel('Name', { exact: true }).fill('Mobile layout rule');
  await page.getByRole('button', { name: 'Create custom rule' }).click();
  await expectNoHorizontalOverflow(page);
  await expect(page.getByRole('button', { name: 'Add condition' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export JSON' })).toBeVisible();
});
