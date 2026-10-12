import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { caseRecord, snapshot } from './case-test-fixtures';
import { currentBrowserLocalDocument, currentBulkSessionBrowserStore, expandLookupFamilies, expectNoHorizontalOverflow, migrateLegacyBrowserData, readBrowserLocalCollection, useTheme } from './helpers';
import { sectionedLookupFixture } from './lookup-design-fixtures';
import { comparisonLedgerCasePairIndexId } from '../frontend/src/lib/analysis/comparison-ledger.ts';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
import type { CaseRecord } from '../packages/cases/case-record-contracts.mts';
import type { WebsiteProfileSnapshot, WebsiteSnapshotTechnology } from '../packages/workspace/website-snapshot-model.mts';
import {
  TECHNOLOGY_PROFILE_VERSION,
  WEBSITE_SECURITY_POSTURE_VERSION,
} from '../lib/lookup-child-profile-contract.mts';

const EARLIER = '2026-06-01T01:00:00.000Z';
const MIDDLE = '2026-06-01T12:00:00.000Z';
const LATER = '2026-06-02T01:00:00.000Z';

function unexpectedApiRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/') && !['/api/session', '/api/capabilities'].includes(pathname)) {
      requests.push(`${request.method()} ${pathname}`);
    }
  });
  return requests;
}

function websiteSnapshot(
  id: string,
  domain: string,
  observedAt: string,
  options: Readonly<{ complete?: boolean; technologies?: readonly WebsiteSnapshotTechnology[] }> = {},
): WebsiteProfileSnapshot {
  const complete = options.complete ?? true;
  return {
    id,
    domain,
    observedAt,
    savedAt: observedAt,
    complete,
    truncated: false,
    profileProvenance: {
      technology: { version: TECHNOLOGY_PROFILE_VERSION, state: 'known' },
      securityPosture: { version: WEBSITE_SECURITY_POSTURE_VERSION, state: 'known' },
      pageFingerprint: { version: 1, state: 'known' },
    },
    technologies: [...(options.technologies ?? [{
      id: 'cms',
      name: 'Example CMS',
      category: 'framework',
      confidence: 'high',
      roles: ['framework_runtime'],
    }])],
    posture: [],
    identity: {
      normalizedHtml: null,
      visibleText: null,
      domStructure: null,
      formStructure: null,
      resourceHosts: null,
      trackingIdentifiers: null,
      faviconHash: null,
    },
    identityValues: { resourceHosts: [], trackingIdentifiers: [], formActionOrigins: [] },
    sources: [{ source: 'http', state: complete ? 'complete' : 'partial' }],
    dependencies: [],
    certificate: null,
  };
}

function bulkResult(domain: string, registrar: string) {
  return {
    domain,
    status: 'complete',
    scanDepth: 'deep',
    availability: 'registered',
    confidence: 'high',
    registrar,
    activity: 'Observed response',
    activityStatus: 'active',
    risk: 20,
    opportunity: 30,
    riskModelVersion: 1,
    opportunityModelVersion: 1,
    sourceCoverage: [
      { source: 'rdap', state: 'complete' },
      { source: 'availability', state: 'complete' },
      { source: 'http', state: 'complete' },
    ],
  };
}

function bulkSession(id: string, name: string, updatedAt: string, digestCharacter: string, registrar: string) {
  return {
    id,
    name,
    mode: 'deep',
    state: 'complete',
    inputDigest: `sha256:${digestCharacter.repeat(64)}`,
    domains: ['paired.reservation.invalid'],
    results: [bulkResult('paired.reservation.invalid', registrar)],
    startedAt: updatedAt,
    updatedAt,
    completedAt: updatedAt,
  };
}

function retainedFixture() {
  return {
    'whois-rdap-cases-v1': {
      version: CASE_SCHEMA_VERSION,
      cases: [caseRecord({
        id: 'ledger-case',
        domain: 'case-change.reservation.invalid',
        updatedAt: LATER,
        evidenceHistory: [
          snapshot({ id: 'case-before', capturedAt: EARLIER, registrar: 'Earlier Registrar', availability: 'registered' }),
          snapshot({ id: 'case-after', capturedAt: LATER, registrar: 'Later Registrar', availability: 'unknown' }),
        ],
      })],
    },
    'whoisleuth-website-snapshots-v1': currentBrowserLocalDocument('website_snapshots', {
      snapshots: [
        websiteSnapshot('website-complete-before', 'complete-profile.reservation.invalid', EARLIER),
        websiteSnapshot('website-complete-after', 'complete-profile.reservation.invalid', LATER, { technologies: [] }),
        websiteSnapshot('website-partial-before', 'partial-profile.reservation.invalid', EARLIER),
        websiteSnapshot('website-partial-after', 'partial-profile.reservation.invalid', LATER, { complete: false, technologies: [] }),
      ],
    }),
    'whois-rdap-watchlist-v1': currentBrowserLocalDocument('watchlists', {
      watchlists: {
        'Watch review': {
          updatedAt: LATER,
          results: [{ domain: 'watch.reservation.invalid', scanDepth: 'deep', availability: 'available' }],
          baseline: [],
          history: [
            { checkedAt: EARLIER, mode: 'deep', resultCount: 1, conclusiveCount: 1, changeCount: 0, omittedChanges: 0, changes: [] },
            {
              checkedAt: LATER,
              mode: 'deep',
              resultCount: 1,
              conclusiveCount: 1,
              changeCount: 1,
              omittedChanges: 0,
              changes: [{
                domain: 'watch.reservation.invalid',
                field: 'availability',
                before: 'registered',
                after: 'available',
                kind: 'availability_changed',
                tone: 'neutral',
              }],
            },
          ],
        },
        'Omission only': {
          updatedAt: LATER,
          results: [],
          baseline: [],
          history: [{
            checkedAt: LATER,
            mode: 'deep',
            resultCount: 1,
            conclusiveCount: 1,
            changeCount: 7,
            omittedChanges: 1,
            changes: [],
          }],
        },
        'Duplicate rows': {
          updatedAt: LATER,
          results: [],
          baseline: [],
          history: [{
            checkedAt: LATER,
            mode: 'deep',
            resultCount: 1,
            conclusiveCount: 1,
            changeCount: 2,
            omittedChanges: 0,
            changes: [0, 1].map(() => ({
              domain: 'duplicate-row.reservation.invalid',
              field: 'pageTitle',
              before: 'Earlier title',
              after: 'Later title',
              kind: 'field_changed',
              tone: 'neutral',
            })),
          }],
        },
      },
    }),
  };
}

function multiIntervalCaseFixture() {
  return {
    'whois-rdap-cases-v1': {
      version: CASE_SCHEMA_VERSION,
      cases: [caseRecord({
        id: 'ledger-interval-case',
        domain: 'case-intervals.reservation.invalid',
        updatedAt: LATER,
        evidenceHistory: [
          snapshot({ id: 'case-interval-a', capturedAt: EARLIER, registrar: 'Registrar A', availability: 'registered' }),
          snapshot({ id: 'case-interval-b', capturedAt: MIDDLE, registrar: 'Registrar B', availability: 'registered' }),
          snapshot({ id: 'case-interval-c', capturedAt: LATER, registrar: 'Registrar C', availability: 'registered' }),
        ],
      })],
    },
  };
}

async function openRetainedReview(
  page: Page,
  entries: Parameters<typeof migrateLegacyBrowserData>[1],
) {
  await migrateLegacyBrowserData(page, entries, {
    clearStorage: true,
    destination: '/monitor?view=timeline',
  });
  const review = page.getByRole('region', { name: 'Retained change review' });
  await expect(review).toBeVisible();
  return review;
}

async function selectRetainedComparison(review: Locator, text: string) {
  const select = review.getByLabel('Retained owner or explicit pair');
  const option = select.locator('option').filter({ hasText: text }).first();
  const value = await option.getAttribute('value');
  expect(value).toBeTruthy();
  await select.selectOption(value ?? '');
}

test('reviews retained case, website and watchlist changes without turning incomplete evidence into removal', async ({ page }) => {
  const requests = unexpectedApiRequests(page);
  const review = await openRetainedReview(page, retainedFixture());

  await selectRetainedComparison(review, 'case-change.reservation.invalid · adjacent case snapshots');
  for (const side of ['Earlier', 'Later']) {
    const source = review.getByRole('region', { name: `${side} comparison source` });
    await expect(source).toBeVisible();
    await expect(source.getByText('Observed', { exact: true })).toBeVisible();
    await expect(source.getByText('Published', { exact: true })).toBeVisible();
    await expect(source.getByText('Retained locally', { exact: true })).toBeVisible();
    await expect(source.getByText('Not retained', { exact: true })).toHaveCount(2);
  }
  const caseRow = review.locator('.ledger-table tbody', { hasText: 'Availability' });
  await expect(caseRow.locator('.state-label')).toHaveText('Incomplete comparison');
  expect(await caseRow.locator('.state-label').evaluate((element) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--amber)';
    document.body.append(probe);
    const result = {
      colourMatches: getComputedStyle(element).color === getComputedStyle(probe).color,
      borderStyle: getComputedStyle(element).borderStyle,
    };
    probe.remove();
    return result;
  })).toEqual({ colourMatches: true, borderStyle: 'dashed' });
  await expect(caseRow.getByText('Removed from later complete evidence', { exact: true })).toHaveCount(0);
  const summary = caseRow.getByRole('button', { name: /^Inspect exact values/u });
  await summary.focus();
  await expect(summary).toBeFocused();
  await summary.press('Enter');
  await expect(summary).toHaveAttribute('aria-expanded', 'true');
  await expect(caseRow.getByText('registered', { exact: true })).toBeVisible();
  await expect(caseRow.getByText('unknown', { exact: true })).toBeVisible();
  await expect(caseRow.locator('.side-metadata').first().getByText('retained', { exact: true })).toBeVisible();
  await expect(caseRow.locator('.side-metadata').nth(1).getByText('incomplete', { exact: true })).toBeVisible();
  await expect(caseRow.getByRole('region', { name: 'Earlier source metadata' })).toBeVisible();
  await expect(caseRow.getByRole('region', { name: 'Later source metadata' })).toBeVisible();
  await expect(review.getByRole('link', { name: 'Open owning record' })).toHaveAttribute(
    'href',
    '/cases?case=ledger-case&section=evidence',
  );

  await selectRetainedComparison(review, 'complete-profile.reservation.invalid · adjacent website profiles');
  const completeWebsiteRow = review.locator('.ledger-table tbody tr', { hasText: 'technology.cms' });
  await expect(completeWebsiteRow.locator('.state-label')).toHaveText('Removed from later complete evidence');
  await expect(review.getByRole('link', { name: 'Open owning record' })).toHaveAttribute(
    'href',
    '/lookup?q=complete-profile.reservation.invalid#website-profile-snapshots',
  );

  await selectRetainedComparison(review, 'partial-profile.reservation.invalid · adjacent website profiles');
  const partialWebsiteRow = review.locator('.ledger-table tbody tr', { hasText: 'technology.cms' });
  await expect(partialWebsiteRow.locator('.state-label')).toHaveText('Incomplete comparison');
  await expect(partialWebsiteRow.getByText('Removed from later complete evidence', { exact: true })).toHaveCount(0);

  await selectRetainedComparison(review, 'Watch review · retained watchlist check');
  const watchlistRow = review.locator('.ledger-table tbody', { hasText: 'Availability' });
  await expect(watchlistRow.locator('.state-label')).toHaveText('Different');
  expect(await watchlistRow.locator('.state-label').evaluate((element) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--amber)';
    document.body.append(probe);
    const matches = getComputedStyle(element).color === getComputedStyle(probe).color;
    probe.remove();
    return matches;
  })).toBe(true);
  await watchlistRow.getByRole('button', { name: /^Inspect exact values/u }).click();
  await expect(watchlistRow.getByText('registered', { exact: true })).toBeVisible();
  await expect(watchlistRow.getByText('available', { exact: true })).toBeVisible();

  await selectRetainedComparison(review, 'Omission only · retained watchlist check');
  await expect(review.getByText('No exact row is available for the selected retained comparison.')).toBeVisible();
  await expect(review.getByText('The retained source had already omitted 7 declared change rows before this review.')).toBeVisible();

  await selectRetainedComparison(review, 'Duplicate rows · retained watchlist check');
  await expect(review.getByText(/Suppressed 1 duplicate exact row with the same bounded rendered identity/iu)).toBeVisible();
  await expect(review.getByText('The current detail bound omits 1 derived row.', { exact: true })).toHaveCount(0);
  await expect(review.locator('.ledger-table tbody tr')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(review.locator('.ledger-cards article')).toHaveCount(1);
  await expect(review.getByText(/Suppressed 1 duplicate exact row with the same bounded rendered identity/iu)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(requests).toEqual([]);
});

test('adds only the saved Bulk pair selected explicitly', async ({ page }) => {
  const requests = unexpectedApiRequests(page);
  const earlier = bulkSession('bulk-earlier', 'Earlier saved review', EARLIER, '1', 'Earlier Registrar');
  const unpaired = bulkSession('bulk-unpaired', 'Unpaired saved review', MIDDLE, '2', 'Unpaired Registrar');
  const later = bulkSession('bulk-later', 'Later saved review', LATER, '3', 'Later Registrar');
  const review = await openRetainedReview(page, {
    'whoisleuth-bulk-sessions-v1': currentBulkSessionBrowserStore([later, unpaired, earlier]),
  });

  await expect(review.getByText('No eligible retained comparison yet')).toBeVisible();
  await expect(review.getByLabel('Retained owner or explicit pair')).toHaveCount(0);
  await review.getByLabel('Earlier saved session').selectOption('bulk-earlier');
  await review.getByLabel('Later saved session').selectOption('bulk-later');
  await review.getByRole('button', { name: 'Review selected Bulk pair' }).click();

  await expect(review.getByText('1 eligible retained comparison')).toBeVisible();
  await expect(review.getByRole('heading', {
    name: 'Earlier saved review → Later saved review · explicit saved-session pair',
  })).toBeVisible();
  const registrarRow = review.locator('.ledger-table tbody', { hasText: 'Registrar' });
  await expect(registrarRow.locator('.state-label')).toHaveText('Not compared');
  expect(await registrarRow.locator('.state-label').evaluate((element) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--muted)';
    document.body.append(probe);
    const result = {
      colourMatches: getComputedStyle(element).color === getComputedStyle(probe).color,
      borderStyle: getComputedStyle(element).borderStyle,
    };
    probe.remove();
    return result;
  })).toEqual({ colourMatches: true, borderStyle: 'dotted' });
  await registrarRow.getByRole('button', { name: /^Inspect exact values/u }).click();
  await expect(registrarRow.getByText('Earlier Registrar', { exact: true })).toBeVisible();
  await expect(registrarRow.getByText('Later Registrar', { exact: true })).toBeVisible();
  await expect(registrarRow.locator('.side-metadata').first().getByText('not_reported', { exact: true })).toBeVisible();
  await expect(registrarRow.locator('.side-metadata').nth(1).getByText('not_reported', { exact: true })).toBeVisible();
  await expect(registrarRow).not.toContainText('Unpaired Registrar');
  await expect(review.getByRole('link', { name: 'Open owning record' })).toHaveAttribute('href', '/bulk#bulk-sessions-title');
  expect(requests).toEqual([]);
});

test('uses exact stacked cards without page overflow at narrow supported widths', async ({ page }, testInfo) => {
  const requests = unexpectedApiRequests(page);
  await page.setViewportSize({ width: 320, height: 844 });
  const review = await openRetainedReview(page, multiIntervalCaseFixture());
  const owner = review.getByLabel('Retained owner or explicit pair');
  const options = owner.locator('option').filter({ hasText: 'case-intervals.reservation.invalid · adjacent case snapshots' });
  await expect(options).toHaveCount(2);
  const firstLabel = await options.nth(0).textContent();
  const secondLabel = await options.nth(1).textContent();
  expect(firstLabel).toContain('→');
  expect(secondLabel).toContain('→');
  expect(firstLabel).not.toBe(secondLabel);
  const firstSelection = await options.nth(0).getAttribute('value');
  const secondSelection = await options.nth(1).getAttribute('value');
  expect(firstSelection).toBeTruthy();
  expect(secondSelection).toBeTruthy();
  expect(firstSelection).not.toBe(secondSelection);

  await owner.focus();
  await expect(owner).toBeFocused();
  await owner.selectOption(firstSelection ?? '');
  await expect(review.getByRole('heading', { name: 'case-intervals.reservation.invalid · adjacent case snapshots' })).toBeVisible();

  for (const width of [320, 360, 390, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    const card = review.locator('.ledger-cards article', { hasText: 'Registrar' });
    await expect(card).toBeVisible();
    const desktopLedger = review.locator('.ledger-table');
    await expect(desktopLedger).toHaveCount(1);
    await expect(desktopLedger).toBeHidden();
    await expect(card.locator('.state-label')).toHaveText('Different');
    await expectNoHorizontalOverflow(page);
  }

  await owner.selectOption(secondSelection ?? '');
  await expect(owner).toHaveValue(secondSelection ?? '');
  const card = review.locator('.ledger-cards article', { hasText: 'Registrar' });
  await card.locator('summary').focus();
  await expect(card.locator('summary')).toBeFocused();
  await card.locator('summary').press('Enter');
  await expect(card.getByText('Registrar A', { exact: true })).toBeVisible();
  await expect(card.getByText('Registrar B', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const desktop = review.locator('.ledger-table');
  const expanded = desktop.getByRole('region', { name: /^Exact values for/u });
  await expect(expanded).toBeVisible();
  await expect(expanded.getByText('Registrar A', { exact: true })).toBeVisible();
  await expect(expanded.getByText('Registrar B', { exact: true })).toBeVisible();
  const [tableBox, detailBox] = await Promise.all([desktop.boundingBox(), expanded.boundingBox()]);
  expect(tableBox).not.toBeNull();
  expect(detailBox).not.toBeNull();
  expect(detailBox!.width).toBeGreaterThan(tableBox!.width * 0.8);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [390, 1920]) {
      await page.setViewportSize({ width, height: 1080 });
      const detail = width === 390 ? card.locator('.exact-details') : expanded;
      await expect(detail).toBeVisible();
      await detail.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) { await page.screenshot({ path: testInfo.outputPath(`exact-comparison-${theme}-${width}.png`) }); }
    }
  }
  await desktop.getByRole('button', { name: /^Inspect exact values/u }).press('Enter');
  await expect(expanded).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  expect(requests).toEqual([]);
});

test('shows exact saved website observations and distinct clocks without recollecting or rewriting them', async ({ page }, testInfo) => {
  const domain = 'comparison-profile.example';
  const earlier = { ...websiteSnapshot('retained-earlier', domain, EARLIER), savedAt: MIDDLE };
  const later = websiteSnapshot('retained-later', domain, LATER, { complete: false, technologies: [] });
  const fixture = sectionedLookupFixture(domain);
  const profile = { version: 1, status: 'success', observedAt: LATER, scanMode: 'deep', source: 'derived',
    durationMs: null, complete: true, truncated: false, limitations: [], diagnostics: {}, findings: [] };
  let lookupRequests = 0;
  await page.route('**/api/lookup?*', async route => {
    lookupRequests += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...fixture,
      availability: { ...fixture.availability,
        technologyProfile: { ...profile, profileVersion: TECHNOLOGY_PROFILE_VERSION },
        securityPosture: { ...profile, postureVersion: WEBSITE_SECURITY_POSTURE_VERSION,
          summary: { observed: 0, potentialExposure: 0, observedAbsence: 0, unavailable: 0 } },
      },
    }) });
  });
  await migrateLegacyBrowserData(page, {
    'whoisleuth-website-snapshots-v1': currentBrowserLocalDocument('website_snapshots', { snapshots: [earlier, later] }),
  }, { clearStorage: true, destination: '/lookup' });
  const retainedBefore = await readBrowserLocalCollection(page, 'website_snapshots');
  await page.getByRole('radio', { name: /Deep/u }).check();
  await page.locator('#query').fill(domain);
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  await expandLookupFamilies(page);
  const manager = page.getByRole('region', { name: 'Website profile snapshots' });
  await manager.getByLabel('Earlier snapshot').selectOption(earlier.id);
  await manager.getByLabel('Later snapshot').selectOption(later.id);
  const first = manager.getByRole('region', { name: 'Earlier website observation' });
  const second = manager.getByRole('region', { name: 'Later website observation' });
  await expect(first).toContainText(earlier.id);
  await expect(second).toContainText(later.id);
  await expect(first.locator('dt')).toHaveText(['Snapshot ID', 'Observed', 'Saved locally', 'Collection']);
  expect(await first.locator('dd').nth(1).textContent()).not.toBe(await first.locator('dd').nth(2).textContent());
  await expect(first.getByText('Complete', { exact: true })).toBeVisible();
  await expect(second.getByText('Partial', { exact: true })).toBeVisible();
  await expect(manager.getByText(/Apparent absences remain incomparable/u)).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await first.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) await manager.screenshot({ path: testInfo.outputPath(`website-comparison-${theme}-${width}.png`) });
    }
  }
  const retainedAfter = await readBrowserLocalCollection(page, 'website_snapshots');
  expect(retainedAfter.records).toEqual(retainedBefore.records);
  expect(retainedAfter.manifest.revision).toBe(retainedBefore.manifest.revision);
  expect(lookupRequests).toBe(1);
});

test('selects two or three exact Case checkpoints without saving a timeline or substituting endpoints', async ({ page }, testInfo) => {
  const requests = unexpectedApiRequests(page);
  const fixture = multiIntervalCaseFixture();
  fixture['whois-rdap-cases-v1'].cases.push(caseRecord({ id: 'other-checkpoint-case', domain: 'other-checkpoint.example',
    evidenceHistory: [snapshot({ id: 'other-a', capturedAt: EARLIER, registrar: 'Other A' }), snapshot({ id: 'other-b', capturedAt: LATER, registrar: 'Other B' })],
  }));
  const review = await openRetainedReview(page, fixture);
  const retainedBefore = await readBrowserLocalCollection(page, 'cases');
  const retainedHistory = retainedBefore.records.find(item => item.value.id === 'ledger-interval-case')!.value.evidenceHistory as CaseRecord['evidenceHistory'];
  expect(retainedHistory).toHaveLength(3);
  const earlierId = retainedHistory.find(item => item.capturedAt === EARLIER)!.id;
  const middleId = retainedHistory.find(item => item.capturedAt === MIDDLE)!.id;
  const laterId = retainedHistory.find(item => item.capturedAt === LATER)!.id;
  expect(new Set([earlierId, middleId, laterId]).size).toBe(3);
  await review.getByText('Choose Case checkpoints', { exact: true }).click();
  const stage = review.getByRole('region', { name: 'Case checkpoint stage' });
  await stage.getByLabel('Case for checkpoint review').selectOption('ledger-interval-case');
  const first = stage.getByRole('checkbox', { name: new RegExp(earlierId, 'u') });
  const middle = stage.getByRole('checkbox', { name: new RegExp(middleId, 'u') });
  const last = stage.getByRole('checkbox', { name: new RegExp(laterId, 'u') });
  await expect(first).toBeVisible();
  await first.focus(); await first.press('Space'); await expect(first).toBeChecked();
  await last.check();
  const intervals = stage.getByLabel('Interval to inspect');
  await expect(intervals.locator('option')).toHaveCount(2);
  await intervals.selectOption(comparisonLedgerCasePairIndexId('ledger-interval-case', earlierId, laterId));
  await expect(stage.getByRole('region', { name: 'Earlier selected checkpoint' })).toContainText(earlierId);
  await expect(stage.getByRole('region', { name: 'Later selected checkpoint' })).toContainText(laterId);
  const registrar = stage.locator('.ledger-table tbody', { hasText: 'Registrar' });
  await registrar.getByRole('button', { name: /^Inspect exact values/u }).click();
  await expect(registrar.getByText('Registrar A', { exact: true })).toBeVisible();
  await expect(registrar.getByText('Registrar C', { exact: true })).toBeVisible();
  await expect(registrar.getByText('Registrar B', { exact: true })).toHaveCount(0);
  await middle.check();
  await expect(stage.getByRole('heading', { name: 'Selected checkpoint interval' })).toHaveCount(0);
  await expect(intervals.locator('option')).toHaveCount(4);
  await intervals.focus(); await expect(intervals).toBeFocused();
  await intervals.selectOption(comparisonLedgerCasePairIndexId('ledger-interval-case', middleId, laterId));
  await expect(stage.getByRole('region', { name: 'Earlier selected checkpoint' })).toContainText(middleId);
  await expect(stage.getByRole('region', { name: 'Later selected checkpoint' })).toContainText(laterId);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await stage.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) await page.screenshot({ path: testInfo.outputPath(`checkpoint-stage-${theme}-${width}.png`) });
    }
  }
  await stage.getByLabel('Case for checkpoint review').selectOption('other-checkpoint-case');
  await expect(stage.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await expect(stage.getByLabel('Interval to inspect')).toHaveCount(0);
  await expect(stage.getByRole('heading', { name: 'Selected checkpoint interval' })).toHaveCount(0);
  await stage.getByRole('button', { name: 'Clear stage' }).click();
  await expect(stage.getByLabel('Case for checkpoint review')).toHaveValue('');
  const retainedAfter = await readBrowserLocalCollection(page, 'cases');
  expect(retainedAfter.records).toEqual(retainedBefore.records);
  expect(retainedAfter.manifest.revision).toBe(retainedBefore.manifest.revision);
  await stage.getByLabel('Case for checkpoint review').selectOption('ledger-interval-case');
  await first.check(); await last.check();
  await intervals.selectOption(comparisonLedgerCasePairIndexId('ledger-interval-case', earlierId, laterId));
  await expect(stage.getByRole('heading', { name: 'Selected checkpoint interval' })).toBeVisible();
  await page.goto('/resources'); await page.goBack();
  const disclosure = page.getByText('Choose Case checkpoints', { exact: true }).locator('..');
  if (await disclosure.getAttribute('open') === null) await disclosure.locator(':scope > summary').click();
  await expect(page.getByLabel('Case for checkpoint review')).toBeVisible();
  await expect(page.getByLabel('Case for checkpoint review')).toHaveValue('');
  expect(requests).toEqual([]);
});
