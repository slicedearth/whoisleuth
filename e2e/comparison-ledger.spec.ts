import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { caseRecord, snapshot } from './case-test-fixtures';
import { expectNoHorizontalOverflow, migrateLegacyBrowserData } from './helpers';

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
  options: Readonly<{ complete?: boolean; technologies?: readonly Record<string, string>[] }> = {},
) {
  const complete = options.complete ?? true;
  return {
    id,
    domain,
    observedAt,
    savedAt: observedAt,
    complete,
    truncated: false,
    technologies: options.technologies ?? [{ id: 'cms', name: 'Example CMS', category: 'framework', confidence: 'high' }],
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
      version: 2,
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
    'whoisleuth-website-snapshots-v1': {
      schema: 'whoisleuth.website-profile-snapshots',
      version: 4,
      snapshots: [
        websiteSnapshot('website-complete-before', 'complete-profile.reservation.invalid', EARLIER),
        websiteSnapshot('website-complete-after', 'complete-profile.reservation.invalid', LATER, { technologies: [] }),
        websiteSnapshot('website-partial-before', 'partial-profile.reservation.invalid', EARLIER),
        websiteSnapshot('website-partial-after', 'partial-profile.reservation.invalid', LATER, { complete: false, technologies: [] }),
      ],
    },
    'whois-rdap-watchlist-v1': {
      schema: 'whoisleuth.watchlists',
      version: 2,
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
    },
  };
}

function multiIntervalCaseFixture() {
  return {
    'whois-rdap-cases-v1': {
      version: 2,
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
  const caseRow = review.locator('.ledger-table tbody tr', { hasText: 'Availability' });
  await expect(caseRow.locator('.state-label')).toHaveText('Incomplete comparison');
  await expect(caseRow.getByText('Removed from later complete evidence', { exact: true })).toHaveCount(0);
  const summary = caseRow.locator('summary');
  await summary.focus();
  await expect(summary).toBeFocused();
  await summary.press('Enter');
  await expect(caseRow.locator('details')).toHaveAttribute('open', '');
  await expect(caseRow.getByText('registered', { exact: true })).toBeVisible();
  await expect(caseRow.getByText('unknown', { exact: true })).toBeVisible();
  await expect(caseRow.locator('.side-metadata').first().getByText('retained', { exact: true })).toBeVisible();
  await expect(caseRow.locator('.side-metadata').nth(1).getByText('incomplete', { exact: true })).toBeVisible();
  expect(await caseRow.locator('.exact-details').evaluate((element) => (
    [...element.children].map((child) => child.classList.item(0))
  ))).toEqual(['row-contract', 'source-grid', 'row-limitations', 'value-grid']);
  await expect(review.getByRole('link', { name: 'Open owning record' })).toHaveAttribute(
    'href',
    /\/monitor\?view=cases&case=ledger-case#case-response-ledger-case$/u,
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
  const watchlistRow = review.locator('.ledger-table tbody tr', { hasText: 'Availability' });
  await expect(watchlistRow.locator('.state-label')).toHaveText('Different');
  await watchlistRow.locator('summary').click();
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
    'whoisleuth-bulk-sessions-v1': {
      schema: 'whoisleuth.bulk-sessions',
      version: 3,
      sessions: [later, unpaired, earlier],
    },
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
  const registrarRow = review.locator('.ledger-table tbody tr', { hasText: 'Registrar' });
  await expect(registrarRow.locator('.state-label')).toHaveText('Not compared');
  await registrarRow.locator('summary').click();
  await expect(registrarRow.getByText('Earlier Registrar', { exact: true })).toBeVisible();
  await expect(registrarRow.getByText('Later Registrar', { exact: true })).toBeVisible();
  await expect(registrarRow.locator('.side-metadata').first().getByText('not_reported', { exact: true })).toBeVisible();
  await expect(registrarRow.locator('.side-metadata').nth(1).getByText('not_reported', { exact: true })).toBeVisible();
  await expect(registrarRow).not.toContainText('Unpaired Registrar');
  await expect(review.getByRole('link', { name: 'Open owning record' })).toHaveAttribute('href', '/bulk#bulk-sessions-title');
  expect(requests).toEqual([]);
});

test('uses exact stacked cards without page overflow at narrow supported widths', async ({ page }) => {
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

  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const card = review.locator('.ledger-cards article', { hasText: 'Registrar' });
    await expect(card).toBeVisible();
    await expect(review.locator('.ledger-table')).toBeHidden();
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
  expect(requests).toEqual([]);
});
