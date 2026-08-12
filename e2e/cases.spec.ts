import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync, zipSync } from 'fflate';
import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow, failBrowserLocalCollectionReads, holdBrowserLocalReads, migrateLegacyBrowserData, readBrowserLocalCollection, requiredValue, runBulkScan } from './helpers';

// Every domain here is a local/invalid value (RFC 2606 .invalid, or dotless
// bad-domain-* that classifyQuery rejects with a 400). Case features are
// entirely browser-local: creating and editing a case never reaches an
// upstream service, and the shared fixture's network guard enforces that.

import { caseRecord, createCase, openCasesView, snapshot } from './case-test-fixtures';

test('Monitor views support roving keyboard navigation', async ({ page }) => {
  await page.goto('/monitor');
  const tabs = page.getByRole('tablist', { name: 'Monitor views' });
  const inbox = tabs.getByRole('tab', { name: /^Inbox/ });
  await inbox.focus();
  await inbox.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: /^Timeline/ })).toBeFocused();
  await expect(tabs.getByRole('tab', { name: /^Timeline/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL('/monitor?view=timeline');
  await tabs.getByRole('tab', { name: /^Timeline/ }).press('End');
  await expect(tabs.getByRole('tab', { name: /^Watchlists/ })).toBeFocused();
  await expect(tabs.getByRole('tab', { name: /^Watchlists/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL('/monitor?view=watchlists');
  await page.reload();
  await expect(page.getByRole('tab', { name: /^Watchlists/ })).toHaveAttribute('aria-selected', 'true');
});

test('Monitor keeps its URL, default view, and guided-route cleanup consistent', async ({ page }) => {
  await page.goto('/monitor?view=cases');
  await expect(page.getByRole('tab', { name: /^Cases/ })).toHaveAttribute('aria-selected', 'true');

  await page.locator('#console-navigation a[href="/monitor"]').click();
  await expect(page).toHaveURL('/monitor');
  await expect(page.getByRole('tab', { name: /^Inbox/ })).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await expect(page.getByRole('tab', { name: /^Inbox/ })).toHaveAttribute('aria-selected', 'true');

  await page.goto('/monitor?view=not-a-view');
  await expect(page.getByRole('tab', { name: /^Inbox/ })).toHaveAttribute('aria-selected', 'true');

  await page.goto('/monitor?view=cases&investigation=1&domain=guided.invalid&response=1#case-review-queue');
  await expect(page.getByRole('tab', { name: /^Cases/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#case-review-queue')).toBeFocused();
  await page.getByRole('tab', { name: /^Inbox/ }).click();
  await expect(page).toHaveURL('/monitor?view=inbox');
  await page.reload();
  await expect(page.getByRole('tab', { name: /^Inbox/ })).toHaveAttribute('aria-selected', 'true');

  const monitorLink = page.locator('#console-navigation a[href="/monitor"]');
  await monitorLink.evaluate((link) => {
    link.setAttribute('href', '/monitor?view=cases&investigation=1&domain=guided.invalid#case-review-queue');
    (link as HTMLAnchorElement).click();
  });
  await expect(page).toHaveURL('/monitor?view=cases&investigation=1&domain=guided.invalid#case-review-queue');
  await expect(page.getByRole('heading', { name: '1 domain carried from Bulk' })).toBeVisible();
  await expect(page.locator('#case-review-queue')).toBeFocused();

  for (const reservedName of ['__proto__', 'constructor']) {
    await page.goto(`/monitor?view=watchlists&watchlist=${reservedName}`);
    await expect(page.getByRole('tab', { name: /^Watchlists/u })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#watchlist-history')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'No watchlists saved' })).toBeVisible();
  }
});

test('Monitor reports unreadable browser-local collections without false empty states', async ({ page }) => {
  await page.goto('/monitor');
  const navigation = page.locator('#console-navigation');
  await expect(navigation.getByRole('link', { name: /^Dashboard/u })).toBeVisible();
  await failBrowserLocalCollectionReads(page, 'cases');
  await failBrowserLocalCollectionReads(page, 'watchlists');
  await navigation.getByRole('link', { name: /^Dashboard/u }).click();
  await navigation.getByRole('link', { name: /^Monitor/u }).click();

  await expect(page.locator('.local-context-status')).toContainText('Some browser-local context could not be loaded');
  await expect(page.getByRole('tab', { name: /^Cases/ }).locator('span')).toHaveAttribute('aria-label', 'count unavailable');
  await page.getByRole('tab', { name: /^Cases/ }).click();
  await expect(page.getByRole('heading', { name: 'Cases unavailable' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No cases yet' })).toHaveCount(0);
  await page.getByRole('tab', { name: /^Watchlists/ }).click();
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
      version: 12,
      cases: [
        caseRecord({
          id: 'case-operations-prepared',
          domain: 'prepared.invalid',
          actions: [{
            id: 'action-prepared', type: 'registrar_report', recipient: 'Reviewed registrar route',
            contactSource: 'Published registrar policy', contactLimitations: ['Reachability was not tested.'],
            dueAt: overdueAt, state: 'ready_for_review', reference: null,
            followUpAt: null, outcome: null, createdAt: actionCreatedAt, updatedAt: actionUpdatedAt,
          }],
        }),
        caseRecord({
          id: 'case-operations-resolved',
          domain: 'resolved.invalid',
          actions: [{
            id: 'action-resolved', type: 'security_contact_report', recipient: 'Private response route',
            contactSource: 'Analyst supplied', contactLimitations: [], dueAt: null, state: 'resolved',
            reference: 'PRIVATE-CASE-7', followUpAt: null, outcome: 'Private analyst outcome text.',
            createdAt: actionCreatedAt, updatedAt: actionUpdatedAt,
          }],
        }),
        caseRecord({ id: 'case-packet-only', domain: 'packet-only.invalid', actions: [] }),
      ],
    },
  });

  const report = page.locator('.operations-report');
  await expect(report).toContainText('2 current action records across 2 of 3 inspected Cases');
  await expect(report.getByText('Prepared', { exact: true })).toBeVisible();
  await expect(report).toContainText('State recorded as ready for review');
  await report.getByLabel('Audience').selectOption('executive');
  await expect(report.getByText('Cases with actions', { exact: true })).toBeVisible();
  await expect(report).toContainText('Denominator: 3 inspected Cases');
  await report.getByLabel('Time window').selectOption('all');

  const pending = page.waitForEvent('download');
  await report.getByRole('button', { name: 'Export aggregate JSON' }).click();
  const download = await pending;
  const path = await download.path();
  expect(path).not.toBeNull();
  const body = await readFile(path!, 'utf8');
  const exported = JSON.parse(body);
  expect(exported).toMatchObject({
    schema: 'whoisleuth.brand-protection-operations-report',
    version: 1,
    sourceState: 'ready',
    counts: { casesInspected: 3, casesWithActions: 2, actions: 2, prepared: 1, submitted: 0, resolved: 1 },
  });
  expect(Object.keys(exported).sort()).toEqual([
    'actionTypes', 'counts', 'generatedAt', 'limitations', 'omissions', 'schema', 'sourceState', 'states', 'version', 'window',
  ]);
  expect(Object.keys(exported.window).sort()).toEqual(['basis', 'endAt', 'id', 'startAt']);
  expect(Object.keys(exported.omissions).sort()).toEqual(['actionsBeyondLimit', 'actionsOutsideWindow', 'actionsWithInvalidTime', 'casesBeyondLimit']);
  for (const sentinel of [
    'case-operations-prepared', 'case-operations-resolved', 'prepared.invalid', 'resolved.invalid',
    'Reviewed registrar route', 'Published registrar policy', 'Reachability was not tested.',
    'Private response route', 'Analyst supplied', 'PRIVATE-CASE-7', 'Private analyst outcome text.',
  ]) expect(body).not.toContain(sentinel);
  await expect(page.getByRole('status')).toContainText('No response was submitted');
  await expectNoHorizontalOverflow(page);
});


test('a case created from Monitor persists across a reload', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'tracked.invalid');

  await expect(page.getByRole('status')).toHaveText(/Opened a new case for tracked\.invalid/);
  const head = page.locator('.case-head', { hasText: 'tracked.invalid' });
  await expect(head.locator('.badge').first()).toHaveText('New');
  await expect(head.locator('.badge').nth(1)).toHaveText('Unreviewed');

  await page.reload();
  await page.getByRole('tab', { name: /Cases/ }).click();
  await expect(page.locator('.case-head', { hasText: 'tracked.invalid' })).toBeVisible();
});

test('the evidence-gap inbox filters and dismisses a stale failed source on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto('/monitor');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': {
      version: 8,
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

  await page.getByLabel('Review inbox detail filters').getByLabel('Source').selectOption('whois');
  await page.getByLabel('Review inbox detail filters').getByLabel('Age').selectOption('stale');
  await page.getByLabel('Review inbox detail filters').getByLabel('Case').fill('gap-mobile');
  await page.getByLabel('Review inbox detail filters').getByLabel('Severity').selectOption('high');
  await page.getByLabel('Review inbox detail filters').getByLabel('Next action').selectOption('refresh');
  const item = page.locator('.review-inbox .items li', { hasText: 'gap-mobile.invalid' });
  await expect(item).toBeVisible();
  await expect(item).toContainText('stale');
  await expect(item.getByRole('link', { name: 'Refresh evidence' })).toHaveAttribute('href', '/lookup?q=gap-mobile.invalid&depth=deep');
  await item.getByRole('combobox').selectOption('accepted_limitation');
  await item.getByRole('button', { name: 'Dismiss gap' }).click();
  await expect(item).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Recorded the reviewed evidence-gap dismissal');
  await expectNoHorizontalOverflow(page);
});

test('the mobile review inbox reveals and focuses a saved Bulk session', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/monitor');
  await migrateLegacyBrowserData(page, {
    'whoisleuth-bulk-sessions-v1': {
      schema: 'whoisleuth.bulk-sessions',
      version: 3,
      sessions: [{
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
      }],
    },
  });

  const item = page.locator('.review-inbox .items li', { hasText: 'Continue Incomplete review' });
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

  await page.locator('.case-body .field-grid select').first().selectOption('escalated');
  await page.locator('.case-body .field-grid select').nth(1).selectOption('confirmed_abuse');

  const head = page.locator('.case-head', { hasText: 'triage.invalid' });
  await expect(head.locator('.badge').first()).toHaveText('Escalated');
  await expect(head.locator('.badge').nth(1)).toHaveText('Confirmed abuse');

  await page.reload();
  await page.getByRole('tab', { name: /Cases/ }).click();
  const reloaded = page.locator('.case-head', { hasText: 'triage.invalid' });
  await expect(reloaded.locator('.badge').first()).toHaveText('Escalated');
  await expect(reloaded.locator('.badge').nth(1)).toHaveText('Confirmed abuse');
});

test('reviewed cases export an explicitly selected privacy-bounded Risk calibration dataset', async ({ page }) => {
  await page.goto('/monitor');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': {
      version: 2,
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
  await page.getByRole('tab', { name: /Cases/ }).click();

  const reviewed = page.getByRole('article').filter({
    has: page.getByText('reviewed-calibration.invalid', { exact: true }),
  });
  const unreviewed = page.getByRole('article').filter({
    has: page.getByText('unreviewed-calibration.invalid', { exact: true }),
  });
  const exportButton = page.getByRole('button', { name: 'Review calibration export (0)' });
  await expect(exportButton).toBeDisabled();
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
  await expect(page.getByRole('status')).toContainText('No model setting was changed');

  await page.setViewportSize({ width: 390, height: 844 });
  await reviewed.getByRole('checkbox', { name: 'Include in offline Risk calibration export' }).uncheck();
  await reviewed.getByRole('checkbox', { name: 'Include in offline Risk calibration export' }).check();
  await page.getByRole('button', { name: 'Review calibration export (1)' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm Risk calibration dataset' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('case tags offer bounded in-tab undo', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'undo-review.invalid');

  const tags = page.getByLabel('Tags');
  await tags.fill('review, phishing');
  await page.getByRole('button', { name: 'Save tags' }).click();
  await expect(page.getByRole('region', { name: 'Undo analyst change' })).toContainText('undo-review.invalid');
  await page.getByRole('region', { name: 'Undo analyst change' }).getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(tags).toHaveValue('');
});

test('projects retained evidence into a filterable source-aware timeline', async ({ page }) => {
  await page.goto('/monitor?view=timeline');
  const observedAt = '2026-07-20T00:00:00.000Z';
  const storedAt = '2026-07-21T00:00:00.000Z';
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': {
      version: 2,
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
    'whois-rdap-watchlist-v1': {
      schema: 'whoisleuth.watchlists',
      version: 2,
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
    },
    'whoisleuth-relationship-observations-v1': {
      schema: 'whoisleuth.relationship-observations',
      version: 1,
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
    },
    'whoisleuth-website-snapshots-v1': {
      schema: 'whoisleuth.website-profile-snapshots',
      version: 1,
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
    },
    'whoisleuth-bulk-sessions-v1': {
      schema: 'whoisleuth.bulk-sessions',
      version: 1,
      sessions: [{
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
      }],
    },
  });

  await expect(page.getByRole('tab', { name: /Timeline/ })).toHaveAttribute('aria-selected', 'true');
  const workspace = page.getByRole('region', { name: 'Investigation timeline' });
  await expect(workspace.locator('.timeline-list article')).toHaveCount(6);
  await expect(workspace).toContainText('Observed');
  await expect(workspace).toContainText('Stored');
  await expect(workspace).toContainText('Derived relationship');
  const pinnedEvidence = workspace.locator('.timeline-list article', { hasText: 'Evidence pin' });
  await pinnedEvidence.getByRole('link', { name: /Open Case · timeline-case\.invalid/u }).click();
  await expect(page).toHaveURL('/monitor?view=cases&case=timeline-case#case-response-timeline-case');
  await expect(page.locator('#case-response-timeline-case')).toBeFocused();
  await page.getByRole('tab', { name: /^Timeline/u }).click();
  await expect(page.getByRole('region', { name: 'Investigation timeline' })).toBeVisible();
  await page.getByLabel('Area').selectOption('bulk');
  await expect(workspace.locator('.timeline-list article')).toHaveCount(1);
  await expect(workspace).toContainText('Timeline Bulk review retained');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByLabel('Freshness').selectOption('stale');
  await expect(workspace.locator('.timeline-list article')).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByLabel('Type').selectOption('change');
  await expect(workspace.locator('.timeline-list article')).toHaveCount(1);
  await expect(workspace).toContainText('watchlist change');
  await workspace.getByRole('link', { name: /Open Watchlist · Timeline watchlist/u }).click();
  await expect(page).toHaveURL('/monitor?view=watchlists&watchlist=Timeline%20watchlist');
  await expect(page.getByRole('heading', { name: 'Timeline watchlist' })).toBeVisible();
  await expect(page.locator('#watchlist-history')).toBeFocused();
  await page.getByRole('tab', { name: /^Timeline/u }).click();
  await page.getByLabel('Entity').selectOption('timeline-related.invalid');
  await expect(workspace.locator('.timeline-list article')).toHaveCount(1);
  await expect(workspace.getByRole('link', { name: /Open Retained relationship/ })).toHaveAttribute('href', /view=relationships/);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test('saved website profiles form searchable cross-domain pivots without another request', async ({ page }) => {
  const observedAt = '2026-07-01T00:00:00.000Z';
  const identity = {
    normalizedHtml: 'a'.repeat(64),
    visibleText: null,
    domStructure: null,
    formStructure: null,
    resourceHosts: null,
    trackingIdentifiers: null,
    faviconHash: null,
  };
  const snapshotRecord = (domain: string, id: string) => ({
    id,
    domain,
    observedAt,
    savedAt: '2026-07-02T00:00:00.000Z',
    complete: true,
    truncated: false,
    technologies: [{ id: 'example-commerce', name: 'Example commerce', category: 'commerce', confidence: 'high' }],
    posture: [],
    identity,
    sources: [{ source: 'http', state: 'success' }],
  });
  await page.goto('/monitor?view=relationships');
  await migrateLegacyBrowserData(page, {
    'whoisleuth-website-snapshots-v1': {
      schema: 'whoisleuth.website-profile-snapshots',
      version: 1,
      snapshots: [
        snapshotRecord('first.invalid', 'profile-first'),
        snapshotRecord('second.invalid', 'profile-second'),
      ],
    },
  });

  const workspace = page.getByRole('region', { name: 'Cross-domain website pivots' });
  await expect(workspace.getByText('Example commerce', { exact: true })).toBeVisible();
  await expect(workspace.getByRole('link', { name: 'first.invalid' }).first()).toBeVisible();
  await expect(workspace.getByRole('link', { name: 'second.invalid' }).first()).toBeVisible();
  await workspace.getByLabel('Search saved profiles').fill('DOM structure');
  await expect(workspace.getByText('No saved website-profile cluster matches these filters.')).toBeVisible();
  await workspace.getByLabel('Search saved profiles').fill('second.invalid');
  await expect(workspace.getByText('Example commerce', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test('custom detection rules evaluate existing cases without rewriting built-in scores', async ({ page }) => {
  await page.goto('/monitor');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': {
      version: 2,
      cases: [caseRecord({ domain: 'rule-match.invalid', evidenceHistory: [snapshot({ riskScore: 65, hasPasswordField: true })] })],
    },
  });
  await page.getByRole('tab', { name: /Custom rules/ }).click();

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
  await expect(page.locator('a[href="/monitor"]').first()).toBeVisible();
  await holdBrowserLocalReads(page, 4_000, 'a[href="/monitor"]');
  await page.waitForURL(/\/monitor(?:\?|$)/u);
  await page.getByRole('tab', { name: /Custom rules/ }).click();

  await expect(page.getByRole('region', { name: 'Custom detection rules' })
    .getByRole('article').filter({ hasText: 'Delayed custom rule' })).toBeVisible({ timeout: 10_000 });
});

test('custom rules persist, can be disabled, and export a versioned safe schema', async ({ page }) => {
  await page.goto('/monitor');
  await page.getByRole('tab', { name: /Custom rules/ }).click();
  await page.getByLabel('Name', { exact: true }).fill('Registered domains');
  await page.getByRole('button', { name: 'Create custom rule' }).click();
  const customRules = page.getByRole('region', { name: 'Custom detection rules' });
  await expect(customRules.getByRole('article').filter({ hasText: 'Registered domains' })).toBeVisible();

  await page.getByRole('tab', { name: /Cases/ }).click();
  await page.getByRole('tab', { name: /Custom rules/ }).click();
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
  await page.getByRole('tab', { name: /Custom rules/ }).click();
  await page.getByLabel('Name', { exact: true }).fill('Mobile layout rule');
  await page.getByRole('button', { name: 'Create custom rule' }).click();
  await expectNoHorizontalOverflow(page);
  await expect(page.getByRole('button', { name: 'Add condition' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export JSON' })).toBeVisible();
});

test('rapid repeated note submission persists one note and is shown in the record', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'noted.invalid');

  await page.locator('.case-body .note-edit textarea').fill('This domain looks suspicious.');
  await page.locator('.case-body .note-edit').evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
    (form as HTMLFormElement).requestSubmit();
  });

  await expect(page.locator('.notes p').first()).toHaveText('This domain looks suspicious.');
  await expect(page.locator('.notes p')).toHaveCount(1);
  await expect(page.locator('.case-domain small')).toHaveText('1 note');

  await page.reload();
  await page.getByRole('tab', { name: /Cases/ }).click();
  await expect(page.locator('.case-head', { hasText: 'noted.invalid' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.notes p').first()).toHaveText('This domain looks suspicious.');
});

test('reviewed response records persist and produce a local non-submitted packet', {
  tag: ['@analyst-journey', '@journey-reviewed-response-decision'],
}, async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'response.invalid');

  const workspace = page.locator('.response-workspace');
  const pin = workspace.locator('details', { hasText: 'Pin an observed fact' });
  await pin.getByText('Pin an observed fact', { exact: true }).click();
  await pin.getByLabel('Label').fill('Observed credential form');
  await pin.getByLabel('Source').fill('Lookup evidence');
  await pin.getByLabel('Observed at').fill('2026-07-28T10:00');
  await pin.getByLabel('Fact').fill('A password field was observed in the captured static page.');
  await pin.getByLabel(/Limitations/).fill('Static page evidence only');
  await pin.getByRole('button', { name: 'Pin evidence' }).click();
  await expect(workspace).toContainText('Observed credential form');

  const decision = workspace.locator('details', { hasText: 'Record an analyst decision' });
  await decision.getByText('Record an analyst decision', { exact: true }).click();
  await decision.getByLabel('Decision summary').fill('Escalate for reviewed reporting');
  await decision.getByLabel('Rationale').fill('The observed page and exact URL require human review.');
  await decision.getByRole('checkbox', { name: 'Observed credential form' }).check();
  await decision.getByRole('button', { name: 'Record decision' }).click();
  await expect(workspace).toContainText('Escalate for reviewed reporting');

  const action = workspace.locator('details', { hasText: 'Track a reviewed action or outcome' });
  await action.getByText('Track a reviewed action or outcome', { exact: true }).click();
  await action.getByLabel('Action type').selectOption('registrar_report');
  await action.getByLabel('Recipient or internal owner').fill('Registrar abuse desk');
  await action.getByLabel('Contact source').fill('RDAP entity role');
  await action.getByRole('button', { name: 'Record action' }).click();
  await expect(workspace).toContainText('registrar report · planned');

  const branch = workspace.locator('details', { hasText: 'Group evidence and decisions into investigation branches' });
  await branch.getByText('Group evidence and decisions into investigation branches', { exact: true }).click();
  await branch.getByLabel('Branch name').fill('Registrar response path');
  await branch.getByRole('checkbox', { name: 'Observed credential form' }).check();
  await branch.getByRole('checkbox', { name: /registrar report.*Registrar abuse desk/iu }).check();
  await branch.getByRole('button', { name: 'Create branch' }).click();
  await expect(branch).toContainText('Registrar response path');
  await expect(branch).toContainText('1 pin · 0 checkpoints · 0 assertions · 1 action');

  const packet = workspace.locator('details', { hasText: 'Prepare a reviewed abuse evidence packet' });
  await packet.getByText('Prepare a reviewed abuse evidence packet', { exact: true }).click();
  await expect(packet.getByLabel('Audience profile')).toHaveValue('internal_soc');
  await expect(packet).toContainText('Internal security operations or incident-response team');
  await packet.getByLabel('Audience profile').selectOption('registrar');
  await expect(packet).toContainText('Domain registrar abuse or compliance team');
  await expect(packet).toContainText('Raw WHOIS or RDAP payloads');
  await packet.getByLabel('Abuse category').fill('Credential phishing');
  await packet.getByLabel('Affected party').fill('Example service');
  await packet.getByLabel('Observed at').fill('2026-07-28T10:00');
  await packet.getByLabel(/Exact abusive HTTP/).fill('https://response.invalid/sign-in');
  await packet.getByLabel('Observed harm').fill('The page solicited account credentials using the affected party name.');
  await expect(packet).toContainText('review cautions');
  await packet.getByRole('button', { name: 'Use recorded case routes' }).click();
  await expect(packet.getByLabel(/registrar contact/i)).toHaveValue('Registrar abuse desk');

  const downloadPromise = page.waitForEvent('download');
  await packet.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exported = JSON.parse(await readFile(downloadPath!, 'utf8'));
  expect(exported).toMatchObject({
    schema: 'whoisleuth.case-response-packet',
    reviewRequired: true,
    submissionPerformed: false,
    schemaVersion: 6,
    profile: {
      id: 'registrar',
      audience: 'Domain registrar abuse or compliance team',
    },
    incident: {
      category: 'Credential phishing',
      affectedParty: 'Example service',
      abusiveUrls: ['https://response.invalid/sign-in'],
    },
    provenance: { evidencePinCount: 1, decisionCount: 1 },
    escalationHistory: [{
      type: 'registrar_report',
      recipient: 'Registrar abuse desk',
      state: 'planned',
    }],
    preflight: {
      status: 'review_cautions',
      canExport: true,
      actionSummary: {
        total: 1,
        active: 1,
      },
    },
    integrity: {
      algorithm: 'SHA-256',
      canonicalization: 'sorted-json-v2',
      scope: 'packet excluding integrity',
    },
  });
  expect(exported.integrity.digestSha256).toMatch(/^[a-f0-9]{64}$/u);
  await expect(page.getByRole('status')).toContainText('Nothing was submitted');

  await page.reload();
  await page.getByRole('tab', { name: /Cases/ }).click();
  await expect(page.locator('.case-head', { hasText: 'response.invalid' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.response-workspace')).toContainText('1 pin · 0 sightings · 1 decision · 0 assertions · 1 action · 1 branch');
  await expect(page.locator('.response-workspace')).toContainText('Registrar response path');
});

test('external findings require a validated preview before creating local evidence pins', async ({ page }) => {
  await openCasesView(page);
  const externalImport = page.locator('details', { hasText: 'Import bounded external findings' });
  await externalImport.getByText('Import bounded external findings', { exact: true }).click();
  const payload = JSON.stringify({
    schema: 'whoisleuth.external-findings',
    schemaVersion: 2,
    source: { name: 'Local analyst export', reference: 'offline review' },
    findings: [{
      domain: 'external-review.invalid',
      category: 'page',
      evidenceClass: 'provider_report',
      summary: 'A credential form was reported in a retained external observation.',
      observedAt: '2026-07-28T01:00:00.000Z',
      completeness: 'partial',
      limitations: ['Rendered behavior was not retained.'],
      reference: 'finding-17',
    }],
  });
  const file = { name: 'external-findings.json', mimeType: 'application/json', buffer: Buffer.from(payload) };

  await externalImport.locator('input[type="file"]').setInputFiles(file);
  await expect(externalImport.getByRole('heading', { name: 'Local analyst export' })).toBeVisible();
  await expect(externalImport).toContainText('1 finding · 1 domain');
  await expect(externalImport).toContainText('page · provider report · partial');
  await expect(page.locator('.case-head', { hasText: 'external-review.invalid' })).toHaveCount(0);

  await externalImport.getByRole('button', { name: 'Import into cases' }).click();
  await expect(page.locator('.case-head', { hasText: 'external-review.invalid' })).toBeVisible();
  await page.locator('.case-head', { hasText: 'external-review.invalid' }).click();
  await expect(page.locator('.response-workspace')).toContainText('External page finding');
  await expect(page.locator('.response-workspace')).toContainText('Provider report: Local analyst export');
  await expect(page.locator('.response-workspace')).toContainText('reported by provider · website');
  await expect(page.locator('.response-workspace')).toContainText('WHOISleuth did not collect or independently verify this provider finding');

  await externalImport.locator('input[type="file"]').setInputFiles(file);
  await externalImport.getByRole('button', { name: 'Import into cases' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'skipped 1 duplicate' })).toBeVisible();
  await expect(page.locator('.response-workspace')).toContainText('1 pin · 1 sighting · 0 decisions');
});

test('external findings serialize file parsing before exposing import actions', async ({ page }) => {
  await openCasesView(page);
  const externalImport = page.locator('details', { hasText: 'Import bounded external findings' });
  await externalImport.getByText('Import bounded external findings', { exact: true }).click();
  await page.evaluate(() => {
    const originalArrayBuffer = File.prototype.arrayBuffer;
    let holdNextRead = true;
    File.prototype.arrayBuffer = function arrayBuffer() {
      if (!holdNextRead) return originalArrayBuffer.call(this);
      holdNextRead = false;
      return new Promise<ArrayBuffer>((resolve, reject) => {
        Reflect.set(window, '__releaseExternalFileRead', () => {
          void originalArrayBuffer.call(this).then(resolve, reject);
        });
      });
    };
  });
  const payload = JSON.stringify({
    schema: 'whoisleuth.external-findings',
    schemaVersion: 2,
    source: { name: 'Serialized local review', reference: 'offline fixture' },
    findings: [{
      domain: 'serialized-review.invalid',
      category: 'page',
      evidenceClass: 'provider_report',
      summary: 'A bounded retained observation.',
      observedAt: '2026-07-28T01:00:00.000Z',
      completeness: 'partial',
      limitations: ['Rendered behavior was not retained.'],
      reference: 'serialized-17',
    }],
  });

  await externalImport.locator('input[type="file"]').setInputFiles({
    name: 'serialized-findings.json',
    mimeType: 'application/json',
    buffer: Buffer.from(payload),
  });
  await expect(externalImport).toHaveAttribute('aria-busy', 'true');
  await expect(externalImport.locator('input[type="file"]')).toBeDisabled();
  await expect(externalImport.getByText('Reading selected file…', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const release = Reflect.get(window, '__releaseExternalFileRead');
    if (typeof release !== 'function') throw new Error('The external-file read gate was not installed.');
    release();
  });

  await expect(externalImport).toHaveAttribute('aria-busy', 'false');
  await expect(externalImport.getByRole('heading', { name: 'Serialized local review' })).toBeVisible();
  await expect(externalImport.getByRole('button', { name: 'Import into cases' })).toBeEnabled();
});

test('portable WARC evidence is normalized locally before deliberate case import', async ({ page }) => {
  await openCasesView(page);
  const externalImport = page.locator('details', { hasText: 'Import bounded external findings' });
  await externalImport.getByText('Import bounded external findings', { exact: true }).click();
  const block = Buffer.from([
    'HTTP/1.1 200 OK',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<!doctype html><html><head><title>Reviewed archive page</title></head><body>private body</body></html>',
  ].join('\r\n'));
  const digest = createHash('sha256').update(block).digest('hex');
  const headers = Buffer.from([
    'WARC/1.1',
    'WARC-Type: response',
    'WARC-Date: 2026-07-28T01:00:00.000Z',
    'WARC-Record-ID: <urn:uuid:e2e-response>',
    'WARC-Target-URI: https://archive-review.invalid/private?token=secret',
    `WARC-Block-Digest: sha256:${digest}`,
    'Content-Type: application/http; msgtype=response',
    `Content-Length: ${block.byteLength}`,
    '',
    '',
  ].join('\r\n'));
  await externalImport.locator('input[type="file"]').setInputFiles({
    name: 'reviewed-evidence.warc',
    mimeType: 'application/warc',
    buffer: Buffer.concat([headers, block, Buffer.from('\r\n\r\n')]),
  });
  await expect(externalImport.getByRole('heading', { name: 'Portable WARC evidence' })).toBeVisible();
  await expect(externalImport).toContainText('Reviewed archive page');
  await expect(externalImport).not.toContainText('private body');
  await expect(externalImport).not.toContainText('token=secret');
  await externalImport.getByRole('button', { name: 'Import into cases' }).click();
  await expect(page.locator('.case-head', { hasText: 'archive-review.invalid' })).toBeVisible();
});

test('portable WACZ evidence verifies package fixity before using the WARC privacy filter', async ({ page }) => {
  await openCasesView(page);
  const externalImport = page.locator('details', { hasText: 'Import bounded external findings' });
  await externalImport.getByText('Import bounded external findings', { exact: true }).click();
  const block = Buffer.from([
    'HTTP/1.1 200 OK',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<!doctype html><html><head><title>Reviewed packaged page</title></head><body>discarded package body</body></html>',
  ].join('\r\n'));
  const recordDigest = createHash('sha256').update(block).digest('hex');
  const headers = Buffer.from([
    'WARC/1.1',
    'WARC-Type: response',
    'WARC-Date: 2026-07-28T01:00:00.000Z',
    'WARC-Record-ID: <urn:uuid:wacz-e2e-response>',
    'WARC-Target-URI: https://package-review.invalid/private?token=secret',
    `WARC-Block-Digest: sha256:${recordDigest}`,
    'Content-Type: application/http; msgtype=response',
    `Content-Length: ${block.byteLength}`,
    '',
    '',
  ].join('\r\n'));
  const compressedWarc = gzipSync(Buffer.concat([headers, block, Buffer.from('\r\n\r\n')]));
  const manifest = Buffer.from(JSON.stringify({
    profile: 'data-package',
    wacz_version: '1.1.1',
    resources: [{
      name: 'capture.warc.gz',
      path: 'archive/capture.warc.gz',
      hash: `sha256:${createHash('sha256').update(compressedWarc).digest('hex')}`,
      bytes: compressedWarc.byteLength,
    }],
  }));
  const wacz = zipSync({
    'archive/capture.warc.gz': [compressedWarc, { level: 0 }],
    'datapackage.json': manifest,
    'datapackage-digest.json': Buffer.from(JSON.stringify({
      path: 'datapackage.json',
      hash: `sha256:${createHash('sha256').update(manifest).digest('hex')}`,
    })),
  });
  await externalImport.locator('input[type="file"]').setInputFiles({
    name: 'reviewed-evidence.wacz',
    mimeType: 'application/wacz',
    buffer: Buffer.from(wacz),
  });
  await expect(externalImport.getByRole('heading', { name: 'Portable WACZ evidence' })).toBeVisible();
  await expect(externalImport).toContainText('Reviewed packaged page');
  await expect(externalImport).not.toContainText('discarded package body');
  await expect(externalImport).not.toContainText('token=secret');
  await externalImport.getByRole('button', { name: 'Import into cases' }).click();
  await expect(page.locator('.case-head', { hasText: 'package-review.invalid' })).toBeVisible();
});

test('STIX claims require an existing selected case and remain separate from collected evidence', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'intelligence-case.invalid');
  const externalImport = page.locator('details', { hasText: 'Import bounded external findings' });
  await externalImport.getByText('Import bounded external findings', { exact: true }).click();
  const payload = JSON.stringify({
    type: 'bundle',
    id: 'bundle--00000000-0000-4000-8000-000000000101',
    objects: [
      {
        type: 'identity',
        spec_version: '2.1',
        id: 'identity--00000000-0000-4000-8000-000000000102',
        name: 'External review source',
      },
      {
        type: 'indicator',
        spec_version: '2.1',
        id: 'indicator--00000000-0000-4000-8000-000000000103',
        created_by_ref: 'identity--00000000-0000-4000-8000-000000000102',
        pattern_type: 'stix',
        pattern: "[domain-name:value = 'reported.invalid']",
        valid_from: '2026-07-28T01:00:00.000Z',
        labels: ['analyst-review'],
        confidence: 60,
      },
    ],
  });
  await externalImport.locator('input[type="file"]').setInputFiles({
    name: 'external-review.stix.json',
    mimeType: 'application/stix+json',
    buffer: Buffer.from(payload),
  });

  await expect(externalImport.getByRole('heading', { name: /bundle--/ })).toBeVisible();
  await expect(externalImport).toContainText('1 accepted');
  await expect(externalImport.getByRole('button', { name: 'Merge assertions into case' })).toBeDisabled();
  await externalImport.getByLabel('Merge into existing case').selectOption({ label: 'intelligence-case.invalid' });
  await externalImport.getByRole('button', { name: 'Merge assertions into case' }).click();
  await expect(page.locator('#monitor-view-panel > p.message[role="status"]'))
    .toContainText('Merged 1 external assertion');

  const caseHead = page.locator('.case-head', { hasText: 'intelligence-case.invalid' });
  if (await caseHead.getAttribute('aria-expanded') !== 'true') await caseHead.click();
  const response = page.locator('.response-workspace');
  await expect(response).toContainText('0 pins · 0 sightings · 0 decisions · 1 assertion');
  await response.getByText('Structure facts, hypotheses, unknowns, and next steps', { exact: true }).click();
  await expect(response).toContainText('external import · open');
  await expect(response).toContainText('External review source');
  await expect(response).toContainText('File SHA-256');
  await expect(response).toContainText('WHOISleuth did not collect or independently verify this claim');
});

test('deleting a case removes it after confirmation', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'delete-me.invalid');

  page.on('dialog', (dialog) => dialog.accept());
  await page.locator('.case-actions .danger').click();

  await expect(page.locator('.case-head', { hasText: 'delete-me.invalid' })).toHaveCount(0);
});

test('a case file imports and merges through the Cases toolbar', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'local.invalid');

  const importPayload = {
    version: 3,
    exportedAt: '2026-07-01T00:00:00.000Z',
    cases: [
      {
        id: 'imported-1',
        domain: 'imported.invalid',
        status: 'reviewing',
        disposition: 'suspicious',
        tags: ['phishing'],
        notes: [],
        source: 'lookup',
        evidenceHistory: [],
        createdAt: '2026-06-15T00:00:00.000Z',
        updatedAt: '2026-06-15T00:00:00.000Z',
      },
    ],
  };

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('.case-toolbar label', { hasText: 'Import JSON' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: 'cases.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(importPayload)),
  });

  await expect(page.locator('#monitor-view-panel > p.message[role="status"]')).toHaveText(/Imported 1 new/);
  await expect(page.locator('.case-head', { hasText: 'local.invalid' })).toBeVisible();
  await expect(page.locator('.case-head', { hasText: 'imported.invalid' })).toBeVisible();
});

test('filtering by status narrows the visible cases', async ({ page }) => {
  await openCasesView(page);
  await createCase(page, 'filter-a.invalid');
  await createCase(page, 'filter-b.invalid');

  // Escalate one.
  await page.locator('.case-head', { hasText: 'filter-a.invalid' }).click();
  await page.locator('.case-body .field-grid select').first().selectOption('escalated');

  await page.locator('.case-filters select').first().selectOption('escalated');
  await expect(page.locator('.case-head', { hasText: 'filter-a.invalid' })).toBeVisible();
  await expect(page.locator('.case-head', { hasText: 'filter-b.invalid' })).toHaveCount(0);
});

test('the Cases view has no horizontal overflow on a short mobile viewport', {
  tag: ['@analyst-journey', '@journey-reviewed-response-decision'],
}, async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 560 });
  await openCasesView(page);
  await createCase(page, 'mobile.invalid');
  await page.locator('.case-body .note-edit textarea').fill('A fairly long note that should wrap rather than push the layout wider than the viewport.');
  await expectNoHorizontalOverflow(page);
});

test('the Lookup query prefills from the q parameter for case navigation', async ({ page }) => {
  await page.goto('/lookup?q=lookmeup.invalid');
  await expect(page.locator('#query')).toHaveValue('lookmeup.invalid');
});

test.describe('cases from Bulk', () => {
  test.use({ allowExpectedBulkLookup400Noise: true });

  const bulkDomains = ['bad-domain-1.invalid', 'bad-domain-2.invalid'];

  test('a case opened from a Bulk row appears in Monitor and marks the row', async ({ page }) => {
    await page.route('**/api/lookup**', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Rejected in test', errorCode: 'INVALID_QUERY' }),
      }),
    );

    await page.goto('/bulk');
    await runBulkScan(page, bulkDomains);

    const caseCell = page.locator('td[data-label="Case"]').first();
    await caseCell.getByRole('button', { name: /Create case/ }).click();
    await expect(caseCell.locator('select.case-disp')).toBeVisible();
    await expect(caseCell.getByRole('link', { name: 'Open' })).toBeVisible();

    await page.goto('/monitor');
    await page.getByRole('tab', { name: /Cases/ }).click();
    await expect(page.locator('.case-head', { hasText: 'bad-domain-1.invalid' })).toBeVisible();
    await expect(page.locator('.case-head', { hasText: 'bad-domain-1.invalid' }).locator('.badge').first()).toHaveText('New');
  });
});
