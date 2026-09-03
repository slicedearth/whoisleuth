import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import {
  expandLookupFamilies,
  expectNoHorizontalOverflow,
  lookupDomainIdentity,
  readBrowserLocalCollection,
} from './helpers';
import { sectionedLookupFixture } from './lookup-design-fixtures';

const LOOKUP_TARGET = 'login.response-loop.invalid';
const CASE_DOMAIN = 'response-loop.invalid';
const WATCHLIST_NAME = `Monitor · ${LOOKUP_TARGET}`;

function responseLoopFixture(sequence: number) {
  const base = sectionedLookupFixture(CASE_DOMAIN);
  const identity = lookupDomainIdentity(LOOKUP_TARGET);
  return {
    ...base,
    ...identity,
    availability: {
      ...base.availability,
      domain: CASE_DOMAIN,
      deepScanComplete: true,
      pageTitle: sequence === 1 ? 'Fixture sign-in review' : 'Fixture account review',
      nameservers: sequence === 1
        ? ['ns1.response-loop.invalid', 'ns2.response-loop.invalid']
        : ['ns1.response-loop.invalid', 'ns3.response-loop.invalid'],
    },
    rdap: {
      ...base.rdap,
      parsed: { ...base.rdap.parsed, domain: CASE_DOMAIN },
    },
  };
}

async function runDeepLookup(page: Page): Promise<void> {
  await page.getByRole('radio', { name: /Deep/u }).check();
  await page.locator('#query').fill(LOOKUP_TARGET);
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  await expect(page.getByRole('heading', { name: CASE_DOMAIN, exact: true })).toBeVisible();
  await expandLookupFamilies(page);
}

test('an Incident URL sends only its hostname and retains exact Case context only by choice', async ({ page }) => {
  const incidentUrl = 'https://login.incident.invalid/sign-in?reference=fixture,secondary;third#review';
  const lookupTarget = 'login.incident.invalid';
  const caseDomain = 'incident.invalid';
  const requests: string[] = [];
  await page.route('**/api/lookup?*', async (route) => {
    const requestUrl = new URL(route.request().url());
    requests.push(requestUrl.searchParams.get('q') ?? '');
    const base = sectionedLookupFixture(caseDomain);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...base,
        ...lookupDomainIdentity(lookupTarget),
        availability: { ...base.availability, domain: caseDomain, deepScanComplete: true },
        rdap: { ...base.rdap, parsed: { ...base.rdap.parsed, domain: caseDomain } },
      }),
    });
  });

  await page.goto('/lookup?task=incident&depth=deep');
  await page.locator('#query').fill(incidentUrl);
  await page.getByRole('button', { name: 'Run lookup', exact: true }).click();
  await expect(page.getByRole('heading', { name: caseDomain, exact: true })).toBeVisible();
  expect(requests).toEqual([lookupTarget]);
  await expect(page.locator('#query')).toHaveValue(incidentUrl);
  await expandLookupFamilies(page);

  const caseCard = page.locator('.case-card');
  await caseCard.getByRole('button', { name: 'Create case' }).click();
  const incidentContext = caseCard.locator('.incident-context-tool');
  await expect(incidentContext).toContainText(`Lookup sent only ${lookupTarget}`);
  await expect(incidentContext).toContainText('query and a fragment');
  await incidentContext.getByLabel('Investigation objective').fill('Review the observed page and preserve only the evidence needed for response preparation.');
  await incidentContext.getByRole('button', { name: 'Save Incident context' }).click();

  const originOnly = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  expect(JSON.stringify(originOnly.records[0]?.value)).not.toContain('reference=fixture');
  expect(originOnly.records[0]?.value?.assertions).toEqual([
    expect.objectContaining({ statement: 'Investigate incident URL: https://login.incident.invalid' }),
  ]);

  await incidentContext.getByRole('checkbox', { name: /Retain the exact URL/ }).check();
  await incidentContext.getByRole('button', { name: 'Save Incident context' }).click();
  const exact = await readBrowserLocalCollection(page, 'cases', {
    minimumRecords: 1,
    minimumRevision: originOnly.manifest.revision + 1,
  });
  expect(exact.records[0]?.value?.assertions).toEqual([
    expect.objectContaining({ statement: `Investigate incident URL: ${incidentUrl}` }),
  ]);
  await expectNoHorizontalOverflow(page);
});

test('partial Lookup evidence can be classified, monitored, rechecked, and reviewed on mobile', {
  tag: ['@analyst-journey', '@journey-response-monitoring-recheck'],
}, async ({ page }) => {
  let lookupRequests = 0;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/lookup?*', async (route) => {
    const requestUrl = new URL(route.request().url());
    expect(requestUrl.searchParams.get('q')).toBe(LOOKUP_TARGET);
    expect(requestUrl.searchParams.get('fast')).toBeNull();
    lookupRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(responseLoopFixture(lookupRequests)),
    });
  });

  await page.goto('/lookup');
  await runDeepLookup(page);
  await expect(page.locator('.dns-card .dns-warning')).toContainText('Partial observation');

  const caseCard = page.locator('.case-card');
  await caseCard.getByRole('button', { name: 'Create case' }).click();
  await caseCard.locator('#lookup-case-disposition').selectOption('suspicious');
  await caseCard.locator('#lookup-case-review-reason').selectOption('insufficient_evidence');
  await caseCard.locator('#lookup-case-conclusion-rationale').fill('The collected sources remain incomplete and require monitored follow-up.');
  const conclusionEvidence = caseCard.locator('.conclusion-evidence');
  await conclusionEvidence.locator(':scope > summary').click();
  const conclusionFacts = conclusionEvidence.locator('.conclusion-facts input[type="checkbox"]');
  await expect(conclusionFacts.first()).toBeVisible();
  await conclusionFacts.first().check();
  await caseCard.getByRole('button', { name: 'Record evidence-linked conclusion' }).click();
  await expect(caseCard).toContainText('Recorded an evidence-linked analyst conclusion');

  const classifiedCases = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  expect(classifiedCases.records[0]?.value).toEqual(expect.objectContaining({
    domain: CASE_DOMAIN,
    disposition: 'suspicious',
    reviewReasonCode: 'insufficient_evidence',
    decisions: [expect.objectContaining({ evidencePinIds: [expect.any(String)] })],
  }));

  await caseCard.getByRole('link', { name: 'Open in Monitor →' }).click();
  await expect(page).toHaveURL(/\/monitor\?view=cases&case=/u);
  const monitorCase = page.locator('.case.open');
  await expect(monitorCase).toContainText(CASE_DOMAIN);
  await monitorCase.getByLabel('Status').selectOption('monitoring');
  await expect(monitorCase.getByLabel('Status')).toHaveValue('monitoring');
  await page.goBack();
  await expect(page.getByRole('heading', { name: CASE_DOMAIN, exact: true })).toBeVisible();
  await expandLookupFamilies(page);
  await expect(page.locator('.monitoring-warning')).toContainText(
    `This Case is marked Monitoring, but no readable watchlist currently contains ${LOOKUP_TARGET}.`,
  );

  await expect(caseCard.getByLabel('Browser-local watchlist name')).toHaveValue(WATCHLIST_NAME);
  await caseCard.getByRole('button', { name: 'Save current observation' }).click();
  await expect(caseCard).toContainText(`Created the browser-local watchlist “${WATCHLIST_NAME}”`);

  const firstWatchlist = await readBrowserLocalCollection(page, 'watchlists', { minimumRecords: 1 });
  expect(firstWatchlist.records).toHaveLength(1);
  expect(firstWatchlist.records[0]?.id).toBe(WATCHLIST_NAME);
  expect(firstWatchlist.records[0]?.value?.results).toEqual([
    expect.objectContaining({
      domain: LOOKUP_TARGET,
      scanDepth: 'deep',
      pageTitle: 'Fixture sign-in review',
    }),
  ]);
  expect(firstWatchlist.records[0]?.value?.history).toHaveLength(1);
  await expectNoHorizontalOverflow(page);

  await caseCard.getByRole('button', { name: 'Recheck and refresh Case' }).click();
  await expect.poll(() => lookupRequests).toBe(2);
  await expect(page.getByRole('heading', { name: CASE_DOMAIN, exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#case-response$/u);
  await expect(page.locator('.case-card')).toContainText(`Refreshed the retained Case evidence for ${CASE_DOMAIN}.`);

  const refreshedCases = await readBrowserLocalCollection(page, 'cases', {
    minimumRecords: 1,
    minimumRevision: classifiedCases.manifest.revision + 1,
  });
  const evidenceHistory = refreshedCases.records[0]?.value?.evidenceHistory;
  expect(evidenceHistory).toHaveLength(2);
  expect(evidenceHistory?.map((snapshot) => snapshot.inputHostname)).toEqual([
    LOOKUP_TARGET,
    LOOKUP_TARGET,
  ]);
  expect(evidenceHistory?.at(-1)?.pageTitle).toBe('Fixture account review');

  const unchangedWatchlist = await readBrowserLocalCollection(page, 'watchlists', {
    minimumRecords: 1,
    minimumRevision: firstWatchlist.manifest.revision,
  });
  expect(unchangedWatchlist.manifest.revision).toBe(firstWatchlist.manifest.revision);
  expect(unchangedWatchlist.records[0]?.value?.history).toHaveLength(1);
  expect(unchangedWatchlist.records[0]?.value?.results?.[0]?.pageTitle).toBe('Fixture sign-in review');

  const refreshedCaseCard = page.locator('.case-card');
  await refreshedCaseCard.getByRole('button', { name: 'Save current observation' }).click();
  await expect(refreshedCaseCard).toContainText(`Updated “${WATCHLIST_NAME}” and retained`);
  const changedWatchlist = await readBrowserLocalCollection(page, 'watchlists', {
    minimumRecords: 1,
    minimumRevision: firstWatchlist.manifest.revision + 1,
  });
  expect(changedWatchlist.records[0]?.value?.results?.[0]?.pageTitle).toBe('Fixture account review');
  expect(changedWatchlist.records[0]?.value?.history).toHaveLength(2);
  expect(changedWatchlist.records[0]?.value?.history?.at(-1)?.changes).toEqual(
    expect.arrayContaining([expect.objectContaining({ domain: LOOKUP_TARGET, field: 'pageTitle' })]),
  );

  await expectNoHorizontalOverflow(page);
  await refreshedCaseCard.getByRole('link', { name: WATCHLIST_NAME }).click();
  await expect(page).toHaveURL(`/monitor?view=watchlists&watchlist=${encodeURIComponent(WATCHLIST_NAME)}`);
  await expect(page.getByRole('heading', { name: WATCHLIST_NAME, exact: true })).toBeVisible();
  await expect(page.locator('#watchlist-history')).toBeFocused();
  await expectNoHorizontalOverflow(page);
});
