import { openConsoleView } from './console-navigation';
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { caseRecord, snapshot, openCaseResponseWorkspace } from './case-test-fixtures';
import {
  currentBrandProfileBrowserStore,
  expectNoHorizontalOverflow,
  migrateLegacyBrowserData,
  readBrowserLocalCollection,
  requiredValue,
  useTheme,
} from './helpers';
import { CASE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/case-model';
import type { CaseActionRecord } from '../frontend/src/lib/analysis/case-response-model.ts';
import { LOOKUP_EVIDENCE_SCHEMA_VERSION } from '../lib/evidence-export.mts';

const PROFILES_KEY = 'whois-rdap-brand-profiles-v1';
const ACTIVE_PROFILE_KEY = 'whois-rdap-active-brand-profile-v1';
const OBSERVED_AT = '2026-08-23T00:00:00.000Z';
const CERTIFICATE_SHA256 = 'a'.repeat(64);
const EVENT_ID = 'b'.repeat(64);
const EXPECTED_SPKI_SHA256 = 'c'.repeat(64);

function readyForReviewAction(): CaseActionRecord {
  return {
    id: 'action-lifecycle-review',
    type: 'registrar_report',
    recipient: 'Reserved registrar review route',
    contactSource: 'Fixture contact source',
    routeObservedAt: OBSERVED_AT,
    routeReviewAfter: null,
    contactLimitations: ['No contact was attempted.'],
    dueAt: null,
    followUpAt: null,
    state: 'ready_for_review',
    reference: null,
    outcome: null,
    providerOutcome: null,
    originActionId: null,
    history: [
      {
        id: 'action-lifecycle-review-event-1',
        previousState: null,
        nextState: 'drafting',
        occurredAt: '2026-08-23T00:00:00.000Z',
        sourceClass: 'browser_local',
        provenance: 'browser_local_fixture_action',
        reference: null,
        evidencePinId: null,
        limitations: [],
        providerOutcome: null,
        outcomeDetail: null,
        originActionId: null,
        applied: true,
      },
      {
        id: 'action-lifecycle-review-event-2',
        previousState: 'drafting',
        nextState: 'ready_for_review',
        occurredAt: '2026-08-23T00:05:00.000Z',
        sourceClass: 'analyst',
        provenance: 'analyst_fixture_transition',
        reference: null,
        evidencePinId: null,
        limitations: [],
        providerOutcome: null,
        outcomeDetail: null,
        originActionId: null,
        applied: true,
      },
    ],
    historyOmitted: 0,
    historyLimitations: [],
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:05:00.000Z',
    metadataUpdatedAt: '2026-08-23T00:00:00.000Z',
  };
}

function certificateProfile() {
  return {
    id: 'certificate-operations-profile',
    name: 'Certificate operations profile',
    officialDomains: ['certificate-operations.example'],
    productNames: [],
    tlds: ['example'],
    approvedPartnerDomains: [],
    allowlistedDomains: [],
    allowlistedRegistrars: [],
    officialChannels: [],
    rightsReferences: [],
    dkimSelectors: [],
    retiredDkimSelectors: [],
    mailProtectionProfile: 'standard',
    protectionAttestations: [],
    desiredPostureBaselines: [{
      domain: 'certificate-operations.example',
      caa: ['0 issue fixture-ca.example'],
      tlsIssuer: 'Reviewed fixture issuer',
      tlsSanPatterns: ['certificate-operations.example'],
      tlsSpkiSha256: EXPECTED_SPKI_SHA256,
      updatedAt: OBSERVED_AT,
    }],
    trademarkOwner: '',
    trademarkRegistration: '',
    officialFaviconHash: '',
    officialFaviconPHash: '',
    pageBaseline: null,
    createdAt: OBSERVED_AT,
    updatedAt: OBSERVED_AT,
  };
}

function certificatePin(
  id: string,
  field: string,
  label: string,
  value: string,
  category: 'dns' | 'tls',
  source: string,
) {
  return {
    id,
    checkpointId: 'checkpoint-live-certificate-operations',
    label,
    value,
    field,
    category,
    source,
    sourceState: 'success',
    sourceSchema: {
      collection: 'lookup_result',
      schema: 'whoisleuth.lookup-evidence',
      version: LOOKUP_EVIDENCE_SCHEMA_VERSION,
    },
    observedAt: OBSERVED_AT,
    collectionDepth: 'deep',
    completeness: 'complete',
    truncated: false,
    transitionExpectation: null,
    limitations: [],
    certificateObservation: null,
    createdAt: OBSERVED_AT,
  };
}

function certificateCase() {
  return caseRecord({
    id: 'case-certificate-operations',
    domain: 'certificate-operations.example',
    status: 'reviewing',
    brandProfileIds: ['certificate-operations-profile'],
    source: 'import',
    evidencePins: [{
      id: 'pin-certificate-operations',
      checkpointId: null,
      label: 'Retained certificate publication',
      value: CERTIFICATE_SHA256,
      field: 'certificateSha256',
      category: 'certificate',
      source: 'Fixture publication import',
      sourceState: 'available',
      sourceSchema: {
        collection: 'external_observations',
        schema: 'whoisleuth.certificate-observation-rows',
        version: 1,
      },
      observedAt: OBSERVED_AT,
      collectionDepth: 'offline',
      completeness: 'complete',
      truncated: false,
      transitionExpectation: null,
      limitations: ['Publication evidence is not proof of live deployment.'],
      certificateObservation: {
        eventId: EVENT_ID,
        logId: 'fixture-log',
        certificateSha256: CERTIFICATE_SHA256,
        issuer: 'Different retained issuer',
        notAfter: '2030-12-01T00:00:00.000Z',
        dnsNameCount: 1,
        namesComplete: true,
      },
      createdAt: OBSERVED_AT,
    },
    certificatePin('pin-live-issuer', 'tls.issuer', 'TLS issuer', 'Reviewed fixture issuer', 'tls', 'Retained Deep TLS observation'),
    certificatePin('pin-live-san', 'tls.san_dns_names', 'TLS certificate DNS names', 'certificate-operations.example', 'tls', 'Retained Deep TLS observation'),
    certificatePin('pin-live-digest', 'tls.certificate_sha256', 'TLS certificate SHA-256', CERTIFICATE_SHA256, 'tls', 'Retained Deep TLS observation'),
    certificatePin('pin-live-spki', 'tls.spki_sha256', 'TLS public-key SHA-256', EXPECTED_SPKI_SHA256, 'tls', 'Retained Deep TLS observation'),
    certificatePin('pin-live-caa', 'dns.caa', 'CAA records', '0 issue fixture-ca.example', 'dns', 'Retained Deep DNS observation')],
    createdAt: OBSERVED_AT,
    updatedAt: OBSERVED_AT,
  });
}

function countCollectionRequests(page: Page): { count: () => number } {
  let requests = 0;
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (/^\/api\/(?:lookup|dns|tls|certificates?|certificate-transparency)(?:\/|$)/u.test(pathname)) requests += 1;
  });
  return { count: () => requests };
}

test('calendar export includes only selected follow-ups and keeps Case context opt-in', async ({ page }) => {
  const collectionRequests = countCollectionRequests(page);
  const action = {
    ...readyForReviewAction(),
    recipient: 'Private fixture response owner',
    dueAt: '2030-06-01T00:00:00.000Z',
    followUpAt: '2030-06-08T00:00:00.000Z',
  };
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': {
      version: CASE_SCHEMA_VERSION,
      cases: [{
        ...caseRecord({
          id: 'case-calendar-export',
          domain: 'calendar-export.invalid',
          actions: [action],
          createdAt: OBSERVED_AT,
          updatedAt: OBSERVED_AT,
        }),
        tags: ['case-type:phishing'],
      }],
    },
  }, { destination: '/monitor?view=inbox' });

  await page.getByText('Case reports and follow-up tools', { exact: true }).click();
  const lifecycle = page.getByRole('region', { name: 'Contact and lifecycle review' });
  const exportButton = lifecycle.getByRole('button', { name: 'Export selected (0)' });
  await expect(exportButton).toBeDisabled();
  await lifecycle.getByLabel('Event type').selectOption('action_follow_up');
  await lifecycle.getByRole('button', { name: 'Select matching (1)' }).click();

  const defaultDownload = page.waitForEvent('download');
  await lifecycle.getByRole('button', { name: 'Export selected (1)' }).click();
  const defaultBody = Buffer.concat(await (await (await defaultDownload).createReadStream()).toArray()).toString('utf8');
  const defaultCalendar = defaultBody.replaceAll(/\r\n[ \t]/gu, '');
  expect(defaultCalendar.match(/BEGIN:VEVENT/gu)).toHaveLength(1);
  expect(defaultCalendar).toMatch(/SUMMARY:Case action follow-up · WS-/u);
  expect(defaultCalendar).not.toMatch(/calendar-export\.invalid|Private fixture response owner|Phishing/u);

  await lifecycle.locator('details.calendar-privacy > summary').click();
  await lifecycle.getByLabel('Include investigated domain').check();
  await lifecycle.getByLabel('Include recipient or internal owner').check();
  await lifecycle.getByLabel('Include Case types and event details').check();
  const disclosedDownload = page.waitForEvent('download');
  await lifecycle.getByRole('button', { name: 'Export selected (1)' }).click();
  const disclosedBody = Buffer.concat(await (await (await disclosedDownload).createReadStream()).toArray()).toString('utf8');
  const disclosedCalendar = disclosedBody.replaceAll(/\r\n[ \t]/gu, '');
  expect(disclosedCalendar).toContain('calendar-export.invalid');
  expect(disclosedCalendar).toContain('Private fixture response owner');
  expect(disclosedCalendar).toContain('Case types: Phishing');
  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);
  expect(collectionRequests.count()).toBe(0);
});

test('calendar reaches and exports every matching event beyond the former five-hundred-event cap', async ({ page }, testInfo) => {
  test.slow();
  const collectionRequests = countCollectionRequests(page);
  const records = Array.from({ length: 12 }, (_, caseIndex) => caseRecord({
    id: `full-calendar-${caseIndex}`, domain: `full-calendar-${caseIndex}.invalid`,
    actions: Array.from({ length: 50 }, (_, actionIndex) => {
      const index = caseIndex * 50 + actionIndex;
      const action = readyForReviewAction();
      return { ...action, id: `calendar-action-${index}`, type: 'internal_review',
        recipient: `Private calendar owner ${String(index).padStart(3, '0')}`,
        dueAt: '2030-06-01T00:00:00.000Z', followUpAt: '2030-07-01T00:00:00.000Z',
        history: action.history.map((event, eventIndex) => ({ ...event, id: `calendar-event-${index}-${eventIndex}` })),
      };
    }),
  }));
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: records } }, { destination: '/monitor' });
  const saved = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 12 });
  expect(saved.records).toHaveLength(12);
  for (const record of saved.records) expect(record.value.actions).toHaveLength(50);
  await page.getByText('Case reports and follow-up tools', { exact: true }).click();
  const calendar = page.getByRole('region', { name: 'Contact and lifecycle review', exact: true });
  await expect(calendar.getByRole('button', { name: 'Select matching (1200)', exact: true })).toBeEnabled();
  await calendar.getByRole('combobox', { name: 'Event type', exact: true }).selectOption('action_follow_up');
  await expect(calendar.getByRole('button', { name: 'Select matching (600)', exact: true })).toBeEnabled();
  const pages = calendar.getByRole('navigation', { name: 'Lifecycle event pages', exact: true });
  const timeline = calendar.getByRole('list', { name: 'Browser-local lifecycle review timeline', exact: true });
  const owners = new Set<string>();
  for (let pageNumber = 1; pageNumber <= 25; pageNumber++) {
    await expect(pages.getByRole('status')).toHaveText(`Page ${pageNumber} of 25`);
    await expect(timeline.getByRole('listitem')).toHaveCount(24);
    for (const owner of await timeline.getByText(/^Recipient or owner: Private calendar owner \d{3}$/u).allTextContents()) owners.add(owner);
    if (pageNumber < 25) {
      const next = pages.getByRole('button', { name: 'Next', exact: true });
      await next.focus(); await next.press('Enter');
      await expect(next).toBeFocused();
    }
  }
  expect(owners.size).toBe(600);
  const last = timeline.getByRole('checkbox').last();
  await last.focus(); await last.press('Space');
  await expect(last).toBeChecked();
  await expect(calendar.getByRole('button', { name: 'Export selected (1)', exact: true })).toBeEnabled();
  await calendar.getByRole('button', { name: 'Select matching (600)', exact: true }).click();
  const exportButton = calendar.getByRole('button', { name: 'Export selected (600)', exact: true });
  const download = page.waitForEvent('download');
  await exportButton.click();
  const exported = Buffer.concat(await (await (await download).createReadStream()).toArray()).toString('utf8').replaceAll(/\r\n[ \t]/gu, '');
  expect(exported.match(/BEGIN:VEVENT/gu)).toHaveLength(600);
  expect(new Set(exported.match(/^UID:.+$/gmu)).size).toBe(600);
  expect(exported).not.toMatch(/Private calendar owner|full-calendar-\d+/u);
  await expect(exportButton).toBeFocused();
  await expect(calendar.getByRole('status').filter({ hasText: /^Exported 600 selected/ })).toHaveText('Exported 600 selected browser-local review events.');
  await calendar.getByRole('combobox', { name: 'Event type', exact: true }).selectOption('action_due');
  await expect(calendar.getByRole('button', { name: 'Export selected (0)', exact: true })).toBeDisabled();
  await calendar.getByRole('combobox', { name: 'Event type', exact: true }).selectOption('action_follow_up');
  await expect(calendar.getByRole('button', { name: 'Export selected (600)', exact: true })).toBeEnabled();
  await expect(timeline.getByRole('checkbox').first()).toBeChecked();
  for (const width of [1280, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : width === 1024 ? 768 : width === 390 ? 844 : 700 });
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      await timeline.getByRole('listitem').first().evaluate((item) => item.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
      await expect(timeline.getByRole('listitem').first()).toBeInViewport({ ratio: 1 });
      await expectNoHorizontalOverflow(page);
      await testInfo.attach(`complete-calendar-${width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
    }
  }
  expect(collectionRequests.count()).toBe(0);
});

test('platform reporting routes are unavailable before review and become usable inside the review window', async ({ page }, testInfo) => {
  const collectionRequests = countCollectionRequests(page);
  await page.clock.setFixedTime('2026-09-03T23:59:59.999Z');
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: [caseRecord({ id: 'platform-clock', domain: 'platform-clock.invalid' })] } }, { destination: '/cases?case=platform-clock' });
  const workspace = await openCaseResponseWorkspace(page, 'platform-clock');
  await workspace.getByLabel('Exact HTTP(S) URL').fill('https://t.me/example/7');
  await workspace.getByRole('button', { name: 'Add incident link', exact: true }).click();
  const routes = workspace.getByRole('region', { name: 'Official platform routes', exact: true });
  await expect(routes.getByText('unavailable', { exact: true })).toBeVisible();
  await expect(routes.getByRole('button', { name: 'Create drafting action', exact: true })).toHaveCount(0);
  await expect(routes).toContainText('within its review window at this time');
  for (const width of [1280, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : width === 1024 ? 768 : width === 390 ? 844 : 700 });
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      await routes.getByRole('article').evaluate((item) => item.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
      await expect(routes.getByRole('article')).toBeInViewport({ ratio: 1 });
      await expectNoHorizontalOverflow(page);
      await testInfo.attach(`unavailable-platform-route-${width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
    }
  }
  await page.clock.setFixedTime('2026-09-04T00:00:00.000Z');
  await page.reload();
  const refreshed = await openCaseResponseWorkspace(page, 'platform-clock');
  const reviewedRoutes = refreshed.getByRole('region', { name: 'Official platform routes', exact: true });
  await expect(reviewedRoutes.getByText('found', { exact: true })).toBeVisible();
  await expect(reviewedRoutes.getByRole('button', { name: 'Create drafting action', exact: true })).toBeEnabled();
  expect(collectionRequests.count()).toBe(0);
});

test('calendar qualifies conflicting dates and exposes superseded follow-ups only on request', async ({ page }) => {
  const review = { id: 'earlier-review', state: 'not_checked', observedAt: OBSERVED_AT, sourceClass: 'analyst', source: 'Fixture review', completeness: 'unknown', limitations: [], evidencePinId: null, sightingId: null, followUpAt: '2030-06-10T00:00:00.000Z', createdAt: OBSERVED_AT };
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: [{
    ...caseRecord({ id: 'calendar-conflict', domain: 'calendar-conflict.invalid' }),
    evidenceHistory: [
      { ...snapshot({ id: 'date-one', capturedAt: OBSERVED_AT }), expiryDate: '2030-01-01T00:00:00.000Z' },
      { ...snapshot({ id: 'date-two', capturedAt: OBSERVED_AT }), expiryDate: '2030-02-01T00:00:00.000Z' },
    ],
    observedEffects: { reviews: [review, { ...review, id: 'later-review', observedAt: '2026-08-24T00:00:00.000Z', followUpAt: null }], omitted: 0, preV13HistoryUnavailable: false, limitations: [] },
  }] } }, { destination: '/monitor' });
  await page.getByText('Case reports and follow-up tools', { exact: true }).click();
  const calendar = page.getByRole('region', { name: 'Contact and lifecycle review' });
  await expect(calendar.getByText('No lifecycle review events match these filters.')).toBeVisible();
  const disclosure = calendar.locator('summary', { hasText: 'Dates needing review (1)' });
  await disclosure.focus(); await disclosure.press('Enter');
  await expect(calendar.getByText(/latest observations disagree; no calendar date was selected/)).toBeVisible();
  await calendar.getByLabel('Include completed actions and earlier effect reviews').check();
  await expect(calendar.getByRole('list', { name: 'Browser-local lifecycle review timeline' }).getByRole('listitem')).toHaveCount(1);
  await calendar.getByLabel('Include completed actions and earlier effect reviews').uncheck();
  await expect(calendar.getByRole('button', { name: 'Export selected (0)' })).toBeDisabled();
  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);
  const reviewCase = calendar.getByRole('link', { name: 'calendar-conflict.invalid', exact: true });
  await expect(reviewCase).toHaveAttribute('href', '/cases?case=calendar-conflict');
  await reviewCase.focus(); await reviewCase.press('Enter');
  await expect(page).toHaveURL(/\/cases\?case=calendar-conflict$/u);
  await expect(page.locator('#case-response-calendar-conflict')).toBeVisible();
  await openCaseResponseWorkspace(page, 'calendar-conflict');
  await expectNoHorizontalOverflow(page);
});

test('saved reporting routes remain reachable across pages with explicit local freshness review', async ({ page }, testInfo) => {
  test.slow();
  const collectionRequests = countCollectionRequests(page);
  await page.clock.setFixedTime('2026-09-10T10:00:00.000Z');
  const reportingTypes = ['registrar_report', 'registry_report', 'network_hosting_report', 'security_contact_report', 'platform_report'] as const;
  const records = Array.from({ length: 6 }, (_, caseIndex) => caseRecord({
    id: `routes-${caseIndex}`, domain: `routes-${caseIndex}.invalid`,
    actions: Array.from({ length: 50 }, (_, actionIndex) => {
      const index = caseIndex * 50 + actionIndex;
      const action = readyForReviewAction();
      return { ...action, id: `route-${index}`, type: reportingTypes[index % reportingTypes.length],
        recipient: `Fixture route ${String(index).padStart(3, '0')}`,
        routeObservedAt: index === 0 ? null : '2026-09-10T09:00:00.123Z',
        routeReviewAfter: '2026-09-10T13:00:00.000Z',
        followUpAt: index === 299 ? '2026-09-10T11:00:00.000Z' : null,
        history: action.history.map((event, eventIndex) => ({ ...event, id: `route-${index}-event-${eventIndex}` })),
      };
    }),
  }));
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: records } }, { destination: '/monitor' });
  await page.getByText('Case reports and follow-up tools', { exact: true }).click();
  const lifecycle = page.getByRole('region', { name: 'Contact and lifecycle review', exact: true });
  const routes = lifecycle.getByRole('region', { name: 'Saved reporting routes', exact: true });
  await expect(routes.getByRole('status').first()).toHaveText('300 matching of 300 saved reporting routes.');
  const pages = routes.getByRole('navigation', { name: 'Reporting route pages', exact: true });
  const recipients = new Set<string>();
  for (let index = 1; index <= 25; index += 1) {
    await expect(pages.getByRole('status')).toHaveText(`Page ${index} of 25`);
    const cards = routes.getByRole('article');
    await expect(cards).toHaveCount(12);
    for (const recipient of await cards.locator(':scope > small').filter({ hasText: /^Fixture route \d{3}$/u }).allTextContents()) recipients.add(recipient);
    if (index < 25) {
      await pages.getByRole('button', { name: 'Next', exact: true }).focus();
      await pages.getByRole('button', { name: 'Next', exact: true }).press('Enter');
      await expect(pages.getByRole('button', { name: 'Next', exact: true })).toBeFocused();
    }
  }
  expect(recipients.size).toBe(300);
  await expect(pages.getByRole('button', { name: 'Next', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await routes.getByRole('searchbox', { name: 'Find a route', exact: true }).fill('Fixture route 299');
  await expect(routes.getByRole('article')).toHaveCount(1);
  await expect(routes.getByRole('article')).toContainText('platform report');
  await expect(routes.getByRole('article')).toContainText('Source observed: 2026-09-10T09:00:00.123Z');
  await expect(routes.getByRole('article')).toContainText('Action follow-up: 2026-09-10T11:00:00.000Z');
  await expect(routes.getByRole('article').getByRole('link', { name: 'Open case', exact: true })).toHaveAttribute('href', '/monitor?view=cases&case=routes-5');
  await routes.getByRole('combobox', { name: 'Source review', exact: true }).selectOption('current');
  await expect(routes.getByRole('article')).toHaveCount(1);
  await expect(lifecycle.getByRole('list', { name: 'Browser-local lifecycle review timeline' }).getByRole('listitem')).toHaveCount(1);
  await page.clock.setFixedTime('2026-09-10T14:00:00.000Z');
  await lifecycle.getByRole('button', { name: 'Refresh local review', exact: true }).click();
  await expect(lifecycle.getByText('Re-evaluated saved dates and routes. No collection was performed.')).toBeVisible();
  await expect(routes.getByText('No saved reporting routes match these filters.', { exact: true })).toBeVisible();
  await expect(lifecycle.getByText('No lifecycle review events match these filters.', { exact: true })).toBeVisible();
  await routes.getByRole('combobox', { name: 'Source review', exact: true }).selectOption('due');
  await expect(routes.getByRole('article')).toHaveCount(1);
  await routes.getByRole('searchbox', { name: 'Find a route', exact: true }).fill('');
  await expect(routes.getByRole('status').first()).toHaveText('299 matching of 300 saved reporting routes.');
  await routes.getByRole('combobox', { name: 'Source review', exact: true }).selectOption('unconfirmed');
  await expect(routes.getByRole('article')).toHaveCount(1);
  await expect(routes.getByRole('article')).toContainText('Source observed: Unknown');
  await routes.getByRole('combobox', { name: 'Source review', exact: true }).selectOption('all');
  for (const width of [1280, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : width === 1024 ? 768 : width === 390 ? 844 : 700 });
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      await routes.getByRole('heading', { name: 'Saved reporting routes', exact: true }).scrollIntoViewIfNeeded();
      await routes.getByRole('article').first().evaluate((card) => card.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
      await expectNoHorizontalOverflow(page);
      await expect(routes.getByRole('article').first()).toBeInViewport({ ratio: 1 });
      await testInfo.attach(`reporting-routes-${width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
    }
  }
  expect(collectionRequests.count()).toBe(0);
});

test('one canonical Review Item lifecycle persists independently and recurs after material Case evidence changes', async ({ page }) => {
  const collectionRequests = countCollectionRequests(page);
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': {
      version: CASE_SCHEMA_VERSION,
      cases: [caseRecord({
        id: 'case-lifecycle-review',
        domain: 'lifecycle-review.invalid',
        status: 'reviewing',
        actions: [readyForReviewAction()],
        createdAt: OBSERVED_AT,
        updatedAt: '2026-08-23T00:05:00.000Z',
      })],
    },
  }, { destination: '/monitor?view=inbox' });

  const item = page.locator('.review-inbox .items > li').filter({
    has: page.getByRole('heading', { name: 'Complete reviewed handoff for lifecycle-review.invalid' }),
  });
  await expect(item).toBeVisible();
  await expect(item).toContainText('packet');
  await expect(item).toContainText('open');

  const casesBefore = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  const reviewStateBefore = await readBrowserLocalCollection(page, 'analyst_review_state');
  await item.locator('details.lifecycle-controls > summary').click();
  await expect(item.getByLabel('Review outcome')).toHaveValue('');
  await expect(item.getByRole('button', { name: 'Record decision' })).toBeDisabled();
  await item.getByLabel('Review outcome').selectOption('suppressed');
  await item.getByLabel('Rationale').fill('The reviewed handoff remains intentionally paused while the bounded fixture route is unavailable.');
  await item.getByLabel(/Expiry/).fill('2030-01-01T00:00');
  await item.getByLabel('Next review').fill('2029-12-01T00:00');
  await item.getByRole('button', { name: 'Record decision' }).click();
  await expect(page.getByRole('status').filter({
    hasText: 'Recorded suppressed for Complete reviewed handoff for lifecycle-review.invalid',
  })).toBeVisible();
  await expect(item).toHaveCount(0);
  await page.getByRole('group', { name: 'Review queue' }).getByRole('button', { name: /^Everything/u }).click();
  await expect(item.locator('details.lifecycle-controls > summary')).toContainText('suppressed');
  await expect(item.locator('details.lifecycle-controls > summary')).not.toContainText('invalidated');

  const reviewStateAfter = await readBrowserLocalCollection(page, 'analyst_review_state', {
    minimumRecords: 1,
    minimumRevision: reviewStateBefore.manifest.revision + 1,
  });
  expect(reviewStateAfter.records).toHaveLength(1);
  expect(reviewStateAfter.records[0]?.value).toMatchObject({
    disposition: 'suppressed',
    evidenceFamily: 'packet',
    caseIds: ['case-lifecycle-review'],
  });
  const casesAfterDecision = await readBrowserLocalCollection(page, 'cases', {
    minimumRevision: casesBefore.manifest.revision,
  });
  expect(casesAfterDecision.records.map((record) => record.value)).toEqual(casesBefore.records.map((record) => record.value));

  await openConsoleView(page, 'cases');
  const caseHead = page.locator('.case-head', { hasText: 'lifecycle-review.invalid' });
  await caseHead.click();
  const workspace = await openCaseResponseWorkspace(page, 'case-lifecycle-review');
  const actions = workspace.locator('details', { hasText: 'Track append-only response actions' });
  await actions.getByText('Track append-only response actions', { exact: true }).click();
  await actions.getByRole('button', { name: 'Review or append event' }).click();
  await actions.getByLabel('Next state').selectOption('reviewed');
  await actions.getByRole('button', { name: 'Append transition' }).click();
  await expect(actions).toContainText('Current projection: reviewed');

  await openConsoleView(page, 'inbox');
  await page.getByRole('group', { name: 'Review queue' })
    .getByRole('button', { name: /^Changed since review/ }).click();
  const advancedFilters = page.locator('.review-inbox details.advanced-filters');
  await advancedFilters.locator(':scope > summary').click();
  const filters = advancedFilters.getByRole('group', { name: 'Advanced review filters' });
  await filters.getByLabel('Review state').selectOption('recurred');
  const recurred = page.locator('.review-inbox .items > li').filter({ hasText: 'lifecycle-review.invalid' });
  await expect(recurred).toBeVisible();
  await expect(recurred.locator('details.lifecycle-controls > summary')).toContainText('invalidated');
  await expect(recurred.locator('details.lifecycle-controls > summary')).toContainText('recurred');
  expect(collectionRequests.count()).toBe(0);
});

test('ambiguous and future certificate observations remain reviewable through the source Case', async ({ page }, testInfo) => {
  const collectionRequests = countCollectionRequests(page);
  const record = certificateCase();
  record.evidencePins.push(certificatePin('pin-equal-time-issuer', 'tls.issuer', 'TLS issuer', 'Conflicting retained issuer', 'tls', 'Independent retained fixture observation'));
  const key = certificatePin('pin-future-key', 'tls.spki_sha256', 'TLS public-key SHA-256', EXPECTED_SPKI_SHA256, 'tls', 'Future-dated retained fixture observation');
  key.observedAt = '2099-01-01T00:00:00.000Z';
  record.evidencePins.push(key);
  await migrateLegacyBrowserData(page, {
    [PROFILES_KEY]: currentBrandProfileBrowserStore([certificateProfile()]),
    'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: [record] },
  }, { clearStorage: true, destination: '/monitor?view=certificates' });
  const inbox = page.getByRole('region', { name: 'Certificate review inbox' });
  await inbox.getByLabel('Evidence class').selectOption('spki');
  const future = inbox.locator('.findings > li');
  await expect(future).toHaveCount(1);
  await expect(future).toContainText('later than the review clock');
  await expect(future).not.toContainText('Expected public key retained');
  await future.locator('details.lifecycle-controls > summary').click();
  await expect(future.getByLabel('Review outcome').locator('option[value="resolved"]')).toHaveJSProperty('disabled', true);
  await inbox.getByLabel('Evidence class').selectOption('live_tls');
  const ambiguous = inbox.locator('.findings > li').filter({ has: page.getByRole('heading', { name: 'Review retained TLS issuer context for certificate-operations.example' }) });
  await expect(ambiguous).toContainText('2 retained facts in 1 Case');
  await expect(ambiguous).toContainText('No single latest fact is selected');
  const sourceLink = ambiguous.getByRole('link', { name: 'Review source Case', exact: true });
  await expect(sourceLink).toHaveAttribute('href', '/monitor?view=cases&case=case-certificate-operations');
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      await ambiguous.getByRole('heading').evaluate((element) => window.scrollTo({ top: Math.max(0, window.scrollY + element.getBoundingClientRect().top - 96), behavior: 'instant' }));
      await expect(ambiguous.getByRole('heading')).toBeVisible();
      await expect(sourceLink).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await testInfo.attach(`certificate-context-${viewport.width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
    }
  }
  await sourceLink.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/view=cases&case=case-certificate-operations/u);
  await expect(page.locator('#case-head-case-certificate-operations')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#case-head-case-certificate-operations')).toBeFocused();
  await page.goto('/monitor?view=inbox');
  await page.getByRole('group', { name: 'Review queue' }).getByRole('button', { name: /^Changed since review/u }).click();
  const review = page.locator('.review-inbox .items > li').filter({ has: page.getByRole('heading', { name: 'Review retained TLS issuer context for certificate-operations.example' }) });
  await expect(review).toBeVisible();
  await expect(review).toContainText('inconclusive');
  expect(collectionRequests.count()).toBe(0);
});

test('the central certificate inbox keeps CT, live TLS, CAA, certificate digest, and SPKI review boundaries explicit', async ({ page }) => {
  const collectionRequests = countCollectionRequests(page);
  await migrateLegacyBrowserData(page, {
    [PROFILES_KEY]: currentBrandProfileBrowserStore([certificateProfile()]),
    [ACTIVE_PROFILE_KEY]: 'certificate-operations-profile',
    'whois-rdap-cases-v1': {
      version: CASE_SCHEMA_VERSION,
      cases: [certificateCase()],
    },
  }, { destination: '/brands' });

  const brandReview = page.getByRole('region', { name: 'Brand review inbox' });
  const centralInboxLink = brandReview.getByRole('link', { name: 'Open central certificate inbox' });
  await expect(centralInboxLink).toHaveAttribute('href', '/monitor?view=certificates&profile=certificate-operations-profile');
  await centralInboxLink.click();
  await expect(page).toHaveURL(/\/monitor\?view=certificates&profile=certificate-operations-profile$/u);

  const inbox = page.getByRole('region', { name: 'Certificate review inbox' });
  await expect(inbox.getByLabel('Brand Profile')).toHaveValue('certificate-operations-profile');
  const issuerFinding = inbox.locator('.findings > li').filter({
    has: page.getByRole('heading', { name: 'Unexpected retained issuer for certificate-operations.example' }),
  });
  await expect(issuerFinding).toBeVisible();
  await expect(issuerFinding).toContainText('certificate transparency');
  await expect(issuerFinding).toContainText(CERTIFICATE_SHA256);
  await expect(issuerFinding.getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(issuerFinding).toContainText('historical Certificate Transparency or imported publication evidence');

  await inbox.getByLabel('Evidence class').selectOption('spki');
  const spkiFinding = inbox.locator('.findings > li');
  await expect(spkiFinding).toHaveCount(1);
  await expect(spkiFinding).toContainText('Expected public key retained');
  await expect(spkiFinding).toContainText(EXPECTED_SPKI_SHA256);
  await inbox.getByLabel('Evidence class').selectOption('caa');
  const caaFinding = inbox.locator('.findings > li');
  await expect(caaFinding).toHaveCount(1);
  await expect(caaFinding).toContainText('Expected CAA evidence retained');
  await expect(caaFinding).toContainText('point-in-time DNS policy observation');
  await inbox.getByLabel('Evidence class').selectOption('certificate_digest');
  const digestFinding = inbox.locator('.findings > li');
  await expect(digestFinding).toHaveCount(1);
  await expect(digestFinding).toContainText('Review retained live certificate digest');
  await expect(digestFinding).toContainText(CERTIFICATE_SHA256);
  await expect(digestFinding).toContainText('not an SPKI digest');
  await inbox.getByLabel('Evidence class').selectOption('live_tls');
  await expect(inbox.getByRole('heading', { name: 'Expected live TLS issuer retained for certificate-operations.example' })).toBeVisible();
  await expect(inbox.getByRole('heading', { name: 'Expected live TLS certificate names retained for certificate-operations.example' })).toBeVisible();

  await inbox.getByLabel('Evidence class').selectOption('certificate_transparency');
  const casesBefore = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  const reviewStateBefore = await readBrowserLocalCollection(page, 'analyst_review_state');
  await issuerFinding.locator('details.lifecycle-controls > summary').click();
  await issuerFinding.getByLabel('Review outcome').selectOption('suppressed');
  await issuerFinding.getByLabel('Rationale').fill('The issuer difference is retained for time-bounded fixture review.');
  await issuerFinding.getByLabel(/Expiry/).fill('2030-01-01T00:00');
  await issuerFinding.getByRole('button', { name: 'Record decision' }).click();
  await expect(issuerFinding.getByRole('status')).toContainText('Review saved. Source evidence was not changed.');
  await expect(issuerFinding.locator('details.lifecycle-controls > summary')).toContainText('suppressed');

  const reviewStateAfter = await readBrowserLocalCollection(page, 'analyst_review_state', {
    minimumRecords: 1,
    minimumRevision: reviewStateBefore.manifest.revision + 1,
  });
  expect(requiredValue(reviewStateAfter.records[0], 'The certificate lifecycle state is missing.').value).toMatchObject({
    disposition: 'suppressed',
    evidenceFamily: 'certificate_transparency',
    caseIds: ['case-certificate-operations'],
  });
  const casesAfter = await readBrowserLocalCollection(page, 'cases', {
    minimumRevision: casesBefore.manifest.revision,
  });
  expect(casesAfter.records.map((record) => record.value)).toEqual(casesBefore.records.map((record) => record.value));
  expect(collectionRequests.count()).toBe(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});
