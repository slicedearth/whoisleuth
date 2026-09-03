import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { caseRecord, openCaseResponseWorkspace } from './case-test-fixtures';
import {
  currentBrandProfileBrowserStore,
  expectNoHorizontalOverflow,
  migrateLegacyBrowserData,
  readBrowserLocalCollection,
  requiredValue,
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
  await expect(item.getByLabel('Disposition')).toHaveValue('');
  await expect(item.getByRole('button', { name: 'Record decision' })).toBeDisabled();
  await item.getByLabel('Disposition').selectOption('suppressed');
  await item.getByLabel('Rationale').fill('The reviewed handoff remains intentionally paused while the bounded fixture route is unavailable.');
  await item.getByLabel(/Expiry/).fill('2030-01-01T00:00');
  await item.getByLabel('Next review').fill('2029-12-01T00:00');
  await item.getByRole('button', { name: 'Record decision' }).click();
  await expect(item.getByRole('status')).toContainText('Review lifecycle saved');
  await expect(item.locator('details.lifecycle-controls > summary')).toContainText('suppressed');

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

  await page.getByRole('tab', { name: /Cases/ }).click();
  const caseHead = page.locator('.case-head', { hasText: 'lifecycle-review.invalid' });
  await caseHead.click();
  const workspace = await openCaseResponseWorkspace(page, 'case-lifecycle-review');
  const actions = workspace.locator('details', { hasText: 'Track append-only response actions' });
  await actions.getByText('Track append-only response actions', { exact: true }).click();
  await actions.getByRole('button', { name: 'Review or append event' }).click();
  await actions.getByLabel('Next state').selectOption('reviewed');
  await actions.getByRole('button', { name: 'Append transition' }).click();
  await expect(actions).toContainText('Current projection: reviewed');

  await page.getByRole('tab', { name: /Inbox/ }).click();
  const filters = page.getByRole('group', { name: 'Review inbox detail filters' });
  await filters.getByLabel('Lifecycle').selectOption('recurred');
  const recurred = page.locator('.review-inbox .items > li').filter({ hasText: 'lifecycle-review.invalid' });
  await expect(recurred).toBeVisible();
  await expect(recurred.locator('details.lifecycle-controls > summary')).toContainText('invalidated');
  await expect(recurred.locator('details.lifecycle-controls > summary')).toContainText('recurred');
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
  await issuerFinding.getByLabel('Disposition').selectOption('suppressed');
  await issuerFinding.getByLabel('Rationale').fill('The issuer difference is retained for time-bounded fixture review.');
  await issuerFinding.getByLabel(/Expiry/).fill('2030-01-01T00:00');
  await issuerFinding.getByRole('button', { name: 'Record decision' }).click();
  await expect(issuerFinding.getByRole('status')).toContainText('Review lifecycle saved');
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
