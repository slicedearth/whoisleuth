import { openCaseMetadata, openCaseSection, openConsoleView } from './console-navigation';
import type { Page, Request } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import {
  currentBrandProfileBrowserStore,
  expectNoHorizontalOverflow,
  failBrowserLocalCollectionReads,
  failBrowserLocalManifestWrites,
  failNextBrowserLocalCollectionRead,
  failNextBrowserLocalCollectionReadAfterWrite,
  holdBrowserLocalReads,
  migrateLegacyBrowserData,
  readBrowserLocalCollection,
  requiredValue,
  useTheme,
} from './helpers';
import { caseRecord, snapshot } from './case-test-fixtures';
import { CASE_SCHEMA_VERSION, MAX_CASE_STORE_BYTES, normalizeCaseStore, serializeCaseStore, type CaseRecord } from '../frontend/src/lib/analysis/case-model.ts';
import type { CaseActionRecord } from '../frontend/src/lib/analysis/case-response-model.ts';

const NOW = '2026-08-09T02:00:00.000Z';
const PROFILE_ID = 'Profile_A';
const SECOND_PROFILE_ID = 'Profile_B';
const LONG_PROFILE_ID = 'P'.repeat(128);
const PROFILES_KEY = 'whois-rdap-brand-profiles-v1';
const ACTIVE_PROFILE_KEY = 'whois-rdap-active-brand-profile-v1';
const CASES_KEY = 'whois-rdap-cases-v1';

function profileFixture(overrides: { id?: string; name?: string; officialDomains?: string[] } = {}) {
  return {
    id: overrides.id ?? PROFILE_ID,
    name: overrides.name ?? 'Fixture profile',
    officialDomains: overrides.officialDomains ?? ['official.invalid'],
    productNames: [],
    tlds: ['invalid'],
    approvedPartnerDomains: [],
    allowlistedDomains: [],
    allowlistedRegistrars: [],
    officialChannels: [],
    rightsReferences: [],
    dkimSelectors: [],
    retiredDkimSelectors: [],
    mailProtectionProfile: 'standard',
    protectionAttestations: [],
    desiredPostureBaselines: [],
    trademarkOwner: '',
    trademarkRegistration: '',
    officialFaviconHash: '',
    officialFaviconPHash: '',
    pageBaseline: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function actionFixture(id: string, recipient = 'Reserved fixture recipient'): CaseActionRecord {
  return {
    id,
    type: 'network_hosting_report',
    recipient,
    contactSource: 'manual',
    routeObservedAt: NOW,
    routeReviewAfter: null,
    contactLimitations: [],
    dueAt: NOW,
    state: 'drafting',
    reference: null,
    followUpAt: null,
    providerOutcome: null,
    outcome: null,
    originActionId: null,
    history: [{
      id: `${id}-created`,
      previousState: null,
      nextState: 'drafting',
      occurredAt: NOW,
      sourceClass: 'browser_local',
      provenance: 'browser_local_fixture_action',
      reference: null,
      evidencePinId: null,
      limitations: [],
      providerOutcome: null,
      outcomeDetail: null,
      originActionId: null,
      applied: true,
    }],
    historyOmitted: 0,
    historyLimitations: [],
    createdAt: NOW,
    metadataUpdatedAt: NOW,
    updatedAt: NOW,
  };
}

function storageEntries(
  cases: Array<ReturnType<typeof caseRecord>|CaseRecord>,
  profiles = [profileFixture()],
  activeProfileId = PROFILE_ID,
) {
  return {
    [PROFILES_KEY]: currentBrandProfileBrowserStore(profiles),
    [ACTIVE_PROFILE_KEY]: activeProfileId,
    [CASES_KEY]: { version: CASE_SCHEMA_VERSION, cases },
  };
}

function nearBudgetCaseSnapshot(): CaseRecord[] {
  const note = (caseIndex:number,noteIndex:number,length=1_987)=>({
    createdAt:new Date(Date.parse('2026-06-01T00:00:00.000Z')+noteIndex*1_000).toISOString(),
    body:`${caseIndex}-${noteIndex}-`.padEnd(length,'x'),
  });
  const fullNotes=(caseIndex:number)=>Array.from({length:50},(_,noteIndex)=>note(caseIndex,noteIndex));
  const fixed=[
    caseRecord({id:'post-write-case',domain:'post-write.invalid',brandProfileIds:[]}),
    caseRecord({id:'pruned-other-case',domain:'pruned-other.invalid',evidenceHistory:[snapshot({id:'old-prunable',capturedAt:'2026-01-01T00:00:00.000Z',firstCapturedAt:'2026-01-01T00:00:00.000Z'})]}),
    ...Array.from({length:40},(_,index)=>caseRecord({id:`budget-${index}`,domain:`budget-${index}.invalid`,notes:fullNotes(index)})),
  ];
  const build=(length:number)=>normalizeCaseStore({version:CASE_SCHEMA_VERSION,cases:[
    ...fixed,
    caseRecord({id:'budget-partial',domain:'budget-partial.invalid',notes:[
      ...Array.from({length:23},(_,index)=>note(40,index)),
      note(40,23,length),
    ]}),
  ]}).cases;
  let lower=1,upper=2_000,best=build(1);
  while(lower<=upper){
    const middle=Math.floor((lower+upper)/2);
    const candidate=build(middle);
    const bytes=new TextEncoder().encode(serializeCaseStore(candidate)).byteLength;
    if(bytes<MAX_CASE_STORE_BYTES){best=candidate;lower=middle+1;}
    else upper=middle-1;
  }
  const remaining=MAX_CASE_STORE_BYTES-new TextEncoder().encode(serializeCaseStore(best)).byteLength;
  expect(remaining).toBeGreaterThan(0);
  expect(remaining).toBeLessThan(12);
  return best;
}

function trackApiRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request: Request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) requests.push(`${request.method()} ${url.pathname}`);
  });
  return requests;
}

function expectNoFeatureApiRequests(requests: readonly string[]): void {
  const consoleBootstrap = new Set(['GET /api/session', 'GET /api/capabilities']);
  expect(requests.filter((request) => !consoleBootstrap.has(request))).toEqual([]);
}

async function openCasesTab(page: Page): Promise<void> {
  await openConsoleView(page, 'cases');
}

test('adds and removes exact associations by keyboard, restores focus, and preserves them through profile deletion', async ({ page }) => {
  const apiRequests = trackApiRequests(page);
  await page.goto('/monitor');
  await migrateLegacyBrowserData(page, storageEntries(
    [caseRecord({ id: 'associated-case', domain: 'associated.invalid', brandProfileIds: [] })],
    [profileFixture(), profileFixture({ id: SECOND_PROFILE_ID, name: 'Second fixture profile' })],
  ), { destination: '/monitor?view=cases&case=associated-case' });

  await openCaseMetadata(page);
  const associations = page.getByRole('region', { name: 'Brand Profile associations' });
  await expect(associations).toBeVisible();

  const profileSelect = associations.getByLabel('Add Brand Profile');
  await profileSelect.focus();
  await expect(profileSelect).toBeFocused();
  await profileSelect.selectOption(PROFILE_ID);
  await expect(profileSelect).toHaveValue(PROFILE_ID);
  const add = associations.getByRole('button', { name: 'Add association' });
  await add.focus();
  await add.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Added an explicit Brand Profile association' })).toBeVisible();
  await expect(associations).toContainText('Fixture profile');
  await expect(profileSelect).toBeFocused();
  let stored = requiredValue(
    (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1, minimumRevision: 2 })).records[0],
    'The associated case fixture is missing.',
  ).value;
  expect(stored.brandProfileIds).toEqual([PROFILE_ID]);

  await profileSelect.selectOption(SECOND_PROFILE_ID);
  await add.press('Enter');
  const removeFirst = associations.getByRole('button', { name: `Remove association with Fixture profile (${PROFILE_ID})` });
  const removeSecond = associations.getByRole('button', { name: `Remove association with Second fixture profile (${SECOND_PROFILE_ID})` });
  await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1, minimumRevision: 3 });
  await expect(removeSecond).toBeEnabled();
  await removeFirst.focus();
  await expect(removeFirst).toBeFocused();
  await removeFirst.press('Enter');
  await expect(removeSecond).toBeFocused();
  stored = requiredValue(
    (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1, minimumRevision: 4 })).records[0],
    'The partly updated case fixture is missing.',
  ).value;
  expect(stored.brandProfileIds).toEqual([SECOND_PROFILE_ID]);

  await removeSecond.press('Enter');
  await expect(associations).toContainText('No Brand Profile is explicitly associated');
  await expect(profileSelect).toBeFocused();
  stored = requiredValue(
    (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1, minimumRevision: 5 })).records[0],
    'The updated case fixture is missing.',
  ).value;
  expect(stored.brandProfileIds).toEqual([]);

  await profileSelect.focus();
  await expect(profileSelect).toBeFocused();
  await profileSelect.selectOption(PROFILE_ID);
  await add.focus();
  await add.press('Enter');
  await expect(associations).toContainText(PROFILE_ID);

  await page.locator('#console-navigation').getByRole('link', { name: /^Brands/u }).click();
  const inbox = page.getByRole('region', { name: 'Brand review inbox' });
  await expect(inbox).toContainText('Review associated.invalid');
  await expect(inbox).toContainText('Saved Case');
  await expect(inbox).toContainText('inconclusive');

  const profileCard = page.locator('article.profile').filter({ has: page.getByRole('heading', { name: 'Fixture profile', exact: true }) });
  await profileCard.getByRole('button', { name: `Edit Fixture profile (${PROFILE_ID})` }).click();
  const editor = page.getByRole('form', { name: 'Brand Profile', exact: true });
  await expect(page.getByLabel('Brand name')).toBeFocused();
  await expect.poll(() => editor.evaluate((element) => {
    const inboxElement = document.querySelector('.brand-review');
    return Boolean(inboxElement && (element.compareDocumentPosition(inboxElement) & Node.DOCUMENT_POSITION_FOLLOWING));
  })).toBe(true);
  const dialogPromise = page.waitForEvent('dialog');
  const clickPromise = profileCard.getByRole('button', { name: `Delete Fixture profile (${PROFILE_ID})` }).click();
  const dialog = await dialogPromise;
  expect(dialog.message()).toContain('1 linked case will retain this identifier and appear unresolved after deletion.');
  await dialog.accept();
  await clickPromise;
  await expect(page.getByRole('button', { name: `Edit Second fixture profile (${SECOND_PROFILE_ID})` })).toBeFocused();

  await expect(inbox.getByRole('heading', { name: 'Unresolved profile references' })).toBeVisible();
  await expect(inbox).toContainText(PROFILE_ID);
  await expect(inbox.getByRole('link', { name: 'Open owning case' })).toBeVisible();
  stored = requiredValue(
    (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0],
    'The case was unexpectedly removed with its profile.',
  ).value;
  expect(stored.brandProfileIds).toEqual([PROFILE_ID]);
  expectNoFeatureApiRequests(apiRequests);
});

test('keeps disjoint association intents across concurrent browser tabs', async ({ page, context }) => {
  const secondPage = await context.newPage();
  const firstRequests = trackApiRequests(page);
  const secondRequests = trackApiRequests(secondPage);
  const longProfileName = 'L'.repeat(100);
  const destination = '/monitor?view=cases&case=concurrent-case';
  await page.goto('/monitor');
  await migrateLegacyBrowserData(page, storageEntries(
    [caseRecord({ id: 'concurrent-case', domain: 'concurrent.invalid', brandProfileIds: [] })],
    [
      profileFixture(),
      profileFixture({ id: SECOND_PROFILE_ID, name: 'Second fixture profile' }),
      profileFixture({ id: LONG_PROFILE_ID, name: longProfileName }),
    ],
  ), { destination });
  await secondPage.goto(destination);

  await openCaseMetadata(page);
  await openCaseMetadata(secondPage);
  const firstAssociations = page.getByRole('region', { name: 'Brand Profile associations' });
  const secondAssociations = secondPage.getByRole('region', { name: 'Brand Profile associations' });
  await expect(firstAssociations).toBeVisible();
  await expect(secondAssociations).toBeVisible();
  await firstAssociations.getByLabel('Add Brand Profile').selectOption(PROFILE_ID);
  await secondAssociations.getByLabel('Add Brand Profile').selectOption(SECOND_PROFILE_ID);

  await holdBrowserLocalReads(page, 900);
  await Promise.all([
    firstAssociations.getByRole('button', { name: 'Add association' }).click(),
    secondAssociations.getByRole('button', { name: 'Add association' }).click(),
  ]);
  let stored = requiredValue(
    (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1, minimumRevision: 3 })).records[0],
    'The concurrently updated case fixture is missing.',
  ).value;
  expect(new Set(stored.brandProfileIds)).toEqual(new Set([PROFILE_ID, SECOND_PROFILE_ID]));

  await Promise.all([page.reload(), secondPage.reload()]);
  await openCaseMetadata(page);
  await openCaseMetadata(secondPage);
  const reloadedFirst = page.getByRole('region', { name: 'Brand Profile associations' });
  const reloadedSecond = secondPage.getByRole('region', { name: 'Brand Profile associations' });
  await expect(reloadedFirst).toContainText(PROFILE_ID);
  await expect(reloadedSecond).toContainText(SECOND_PROFILE_ID);
  await reloadedSecond.getByLabel('Add Brand Profile').selectOption(LONG_PROFILE_ID);

  await holdBrowserLocalReads(page, 900);
  await Promise.all([
    reloadedFirst.getByRole('button', { name: `Remove association with Fixture profile (${PROFILE_ID})` }).click(),
    reloadedSecond.getByRole('button', { name: 'Add association' }).click(),
  ]);
  stored = requiredValue(
    (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1, minimumRevision: 5 })).records[0],
    'The second concurrently updated case fixture is missing.',
  ).value;
  expect(new Set(stored.brandProfileIds)).toEqual(new Set([SECOND_PROFILE_ID, LONG_PROFILE_ID]));

  await secondPage.reload();
  await secondPage.setViewportSize({ width: 390, height: 844 });
  await openCaseMetadata(secondPage);
  const mobileAssociations = secondPage.getByRole('region', { name: 'Brand Profile associations' });
  await expect(mobileAssociations).toContainText(longProfileName);
  await expect(mobileAssociations).toContainText(LONG_PROFILE_ID);
  await expectNoHorizontalOverflow(secondPage);
  expectNoFeatureApiRequests(firstRequests);
  expectNoFeatureApiRequests(secondRequests);
  await secondPage.close();
});

test('previews association storage pressure, exports or cancels, and reconciles an explicitly pruned write', async ({ page }, testInfo) => {
  const boundedCases=nearBudgetCaseSnapshot();
  await page.goto('/monitor');
  await migrateLegacyBrowserData(page, storageEntries(boundedCases), { clearStorage:true,destination: '/monitor?view=cases&case=post-write-case' });

  await openCaseMetadata(page);
  const associations = page.getByRole('region', { name: 'Brand Profile associations' });
  await expect(associations).toBeVisible();
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: boundedCases.length });
  await associations.getByLabel('Add Brand Profile').selectOption(PROFILE_ID);
  await associations.getByRole('button', { name: 'Add association' }).click();

  const review = page.getByRole('region', { name: 'Review Case storage changes' });
  await expect(review).toBeVisible();
  await expect(review.getByRole('heading')).toBeFocused();
  await expect(review).toContainText('pruned-other.invalid');
  await expect(review).toContainText('no evidence snapshots would remain');
  expect(await readBrowserLocalCollection(page, 'cases', { minimumRecords: boundedCases.length })).toEqual(before);
  for (const [width, height] of [[320, 700], [390, 844], [1024, 768], [1280, 720], [2560, 1440], [3840, 2160]] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      await expect(review.getByRole('button', { name: 'Remove listed snapshots and save' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`case-storage-${width}-${theme}.png`), fullPage: true });
    }
  }
  const downloadEvent = page.waitForEvent('download');
  await review.getByRole('button', { name: 'Export current Cases' }).click();
  const download = await downloadEvent;
  const exported = JSON.parse(await readFile(requiredValue(await download.path(), 'Case export missing'), 'utf8')) as { cases: CaseRecord[] };
  expect(exported.cases).toEqual(boundedCases);
  await review.getByRole('button', { name: 'Cancel change' }).click();
  await expect(review).toHaveCount(0);
  await expect(associations.getByLabel('Add Brand Profile')).toBeFocused();
  expect(await readBrowserLocalCollection(page, 'cases', { minimumRecords: boundedCases.length })).toEqual(before);
  await associations.getByRole('button', { name: 'Add association' }).click();
  await expect(review).toBeVisible();
  await failNextBrowserLocalCollectionReadAfterWrite(page, 'cases');
  await review.getByRole('button', { name: 'Remove listed snapshots and save' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Brand Profile association saved' })).toContainText('complete committed Case snapshot');
  await expect(associations).toContainText('Fixture profile');
  await expect(associations).toBeFocused();
  await expect(review).toHaveCount(0);
  const stored = requiredValue(
    (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1, minimumRevision: 2 })).records.find((record)=>record.value.id==='post-write-case'),
    'The committed association fixture is missing.',
  ).value;
  expect(stored.brandProfileIds).toEqual([PROFILE_ID]);
  const committedSnapshot=await readBrowserLocalCollection(page,'cases',{minimumRecords:1,minimumRevision:2});
  expect(requiredValue(committedSnapshot.records.find((record)=>record.value.id==='pruned-other-case'),'The prunable other Case is missing.').value.evidenceHistory).toHaveLength(0);
  await page.getByRole('link', { name: 'All Cases', exact: true }).click();
  await page.getByLabel('Search').fill('pruned-other.invalid');
  await page.locator('.case-head',{hasText:'pruned-other.invalid'}).click();
  await openCaseSection(page, 'Evidence');
  await expect(page.getByRole('heading',{name:'Evidence timeline 0 snapshots'})).toBeVisible();
});

test('focuses the stable association region after removing the last unresolved reference', async ({ page }) => {
  const missingId = 'Unavailable_Profile';
  await page.goto('/monitor');
  await migrateLegacyBrowserData(page, storageEntries(
    [caseRecord({ id: 'unresolved-focus-case', domain: 'unresolved-focus.invalid', brandProfileIds: [missingId] })],
    [],
    '',
  ), { destination: '/monitor?view=cases&case=unresolved-focus-case' });

  await openCaseMetadata(page);
  const associations = page.getByRole('region', { name: 'Brand Profile associations' });
  await expect(associations.getByLabel('Add Brand Profile')).toBeDisabled();
  await associations.getByRole('button', { name: `Remove association with unavailable profile ${missingId}` }).click();
  await expect(associations).toContainText('No Brand Profile is explicitly associated');
  await expect(associations).toBeFocused();
});

test('resets pagination across active profiles without inference and contains max-bound text on mobile', async ({ page }) => {
  const apiRequests = trackApiRequests(page);
  const firstAssociated = Array.from({ length: 27 }, (_, index) => caseRecord({
    id: `associated-${index + 1}`,
    domain: `associated-${index + 1}.invalid`,
    brandProfileIds: [PROFILE_ID],
    updatedAt: `2026-08-${String(index + 1).padStart(2, '0')}T02:00:00.000Z`,
  }));
  const secondAssociated = Array.from({ length: 27 }, (_, index) => caseRecord({
    id: `second-associated-${index + 1}`,
    domain: `second-associated-${index + 1}.invalid`,
    brandProfileIds: [LONG_PROFILE_ID],
    disposition: index === 0 ? 'suspicious' : 'unreviewed',
    actions: index === 0 ? [actionFixture('long-action', 'R'.repeat(200))] : [],
    updatedAt: `2026-08-${String(index + 1).padStart(2, '0')}T03:00:00.000Z`,
  }));
  const matchingButUnassociated = caseRecord({
    id: 'same-domain-only',
    domain: 'official.invalid',
    brandProfileIds: [],
  });
  const longProfileName = 'N'.repeat(100);
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, storageEntries(
    [...firstAssociated, ...secondAssociated, matchingButUnassociated],
    [profileFixture(), profileFixture({ id: LONG_PROFILE_ID, name: longProfileName, officialDomains: ['second-official.invalid'] })],
  ), { destination: '/brands' });

  const inbox = page.getByRole('region', { name: 'Brand review inbox' });
  await expect(inbox).toHaveAttribute('aria-busy', 'false');
  await expect(inbox).toContainText('27 associated cases');
  await expect(inbox.locator('.review-items > li')).toHaveCount(25);
  await expect(inbox).not.toContainText('Review official.invalid');
  await expect(inbox.getByText('Showing 1–25 of 27 retained local review rows')).toBeVisible();
  const pages = inbox.getByRole('navigation', { name: 'Brand review inbox pages' });
  await pages.getByRole('button', { name: 'Next' }).click();
  await expect(pages).toContainText('Page 2 of 2');
  await expect(inbox.locator('.review-items > li')).toHaveCount(2);

  await page.getByRole('radio', { name: `Set ${longProfileName} active` }).check();
  await expect(inbox).toContainText('27 associated cases');
  await expect(pages).toContainText('Page 1 of 2');
  await expect(inbox.getByText('Showing 1–25 of 27 retained local review rows')).toBeVisible();
  await expect(inbox).toContainText('R'.repeat(200));

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  expectNoFeatureApiRequests(apiRequests);
});

test('keeps loading explicit and fails every Case association mutation closed when profiles cannot be read', async ({ page }) => {
  await page.goto('/bulk');
  await migrateLegacyBrowserData(page, storageEntries([
    caseRecord({ id: 'preserved-case', domain: 'preserved.invalid', brandProfileIds: [PROFILE_ID] }),
  ]), { destination: '/bulk' });

  await expect(page.locator('#console-navigation')).toBeVisible();
  await holdBrowserLocalReads(page, 8_000);
  const navigationPromise = page.locator('#console-navigation').getByRole('link', { name: /^Brands/u }).click();
  const loadingInbox = page.getByRole('region', { name: 'Brand review inbox' });
  await expect.poll(async () => loadingInbox.evaluate((element) => ({
    busy: element.getAttribute('aria-busy'),
    metric: element.querySelector('.review-heading > strong')?.textContent?.trim() ?? '',
    text: element.querySelector('.source-state')?.textContent?.trim() ?? '',
  }))).toEqual({
    busy: 'true',
    metric: 'Loading',
    text: 'Loading Brand Profiles and cases and the active-profile preference…',
  });
  await navigationPromise;
  await expect(loadingInbox).toHaveAttribute('aria-busy', 'false', { timeout: 12_000 });

  await page.locator('#console-navigation').getByRole('link', { name: /^Bulk/u }).click();
  await failBrowserLocalCollectionReads(page, 'brand_profiles');
  await openCasesTab(page);
  await page.locator('.case-head', { hasText: 'preserved.invalid' }).click();
  await openCaseMetadata(page);
  const associations = page.getByRole('region', { name: 'Brand Profile associations' });
  await expect(associations).toContainText('Profile details unavailable');
  await expect(associations).toContainText('association changes are unavailable');
  await expect(associations.getByRole('button', { name: 'Remove association' })).toBeDisabled();
  await expect(associations.getByRole('button', { name: 'Add association' })).toBeDisabled();
  await expect(associations.getByLabel('Add Brand Profile')).toBeDisabled();

  await page.locator('#console-navigation').getByRole('link', { name: /^Brands/u }).click();
  const unavailableInbox = page.getByRole('region', { name: 'Brand review inbox' });
  await expect(unavailableInbox.getByRole('alert')).toContainText('Brand Profiles could not be read');
  await expect(unavailableInbox.locator('.review-heading > strong')).toHaveText('Unavailable');
  await expect(unavailableInbox.getByRole('heading', { name: 'Unresolved profile references' })).toHaveCount(0);
  await expect(page.getByText('No brand profiles saved')).toHaveCount(0);
  await expect(page.locator('.local-context-status')).not.toContainText('active-profile preference could not be read');
  const stored = requiredValue(
    (await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 })).records[0],
    'The preserved case fixture is missing.',
  ).value;
  expect(stored.brandProfileIds).toEqual([PROFILE_ID]);
});

test('announces an unavailable Brand source before a concurrently loading Case source', async ({ page }) => {
  await page.goto('/bulk');
  await migrateLegacyBrowserData(page, storageEntries([
    caseRecord({ id: 'mixed-source-case', domain: 'mixed-source.invalid', brandProfileIds: [PROFILE_ID] }),
  ]), { destination: '/bulk' });
  await expect(page.locator('#console-navigation')).toBeVisible();
  await failBrowserLocalCollectionReads(page, 'brand_profiles');
  await holdBrowserLocalReads(page, 7_000);
  const navigationPromise = page.locator('#console-navigation').getByRole('link', { name: /^Brands/u }).click();
  const inbox = page.getByRole('region', { name: 'Brand review inbox' });
  await expect.poll(async () => ({
    busy: await inbox.getAttribute('aria-busy'),
    metric: await inbox.locator('.review-heading > strong').textContent(),
    alert: await inbox.getByRole('alert').textContent(),
  })).toMatchObject({
    busy: 'true',
    metric: 'Unavailable',
    alert: expect.stringMatching(/Brand Profiles could not be read.*cases is still loading/iu),
  });
  await navigationPromise;
  await expect(inbox).toHaveAttribute('aria-busy', 'false', { timeout: 11_000 });
  await expect(inbox.getByRole('alert')).toContainText('Brand Profiles could not be read');
  await expect(inbox.locator('.review-heading > strong')).toHaveText('Unavailable');
});

test('closes Brand Profile source truth after a post-ready storage failure', async ({ page }) => {
  const apiRequests = trackApiRequests(page);
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, storageEntries(
    [caseRecord({ id: 'profile-read-failure', domain: 'profile-read-failure.invalid', brandProfileIds: [PROFILE_ID] })],
    [profileFixture()],
    '',
  ), { destination: '/brands' });

  const inbox = page.getByRole('region', { name: 'Brand review inbox' });
  const metric = inbox.locator('.review-heading > strong');
  await expect(inbox).toHaveAttribute('aria-busy', 'false');
  await expect(metric).toHaveText('No active profile');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await metric.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeLessThan(14);
  await page.getByRole('radio', { name: 'Set Fixture profile active' }).check();
  await expect(metric).toHaveText('1 review items');

  const profileCard = page.locator('article.profile').filter({ has: page.getByRole('heading', { name: 'Fixture profile', exact: true }) });
  await profileCard.getByRole('button', { name: `Edit Fixture profile (${PROFILE_ID})` }).click();
  await failNextBrowserLocalCollectionReadAfterWrite(page, 'brand_profiles');
  await page.getByRole('button', { name: 'Save profile' }).click();

  const profileSourceAlert = page.locator('.profile-source-state[role="alert"]');
  const inboxSourceAlert = inbox.getByRole('alert');
  await expect(profileSourceAlert).toContainText('No empty-profile conclusion has been drawn');
  await expect(inboxSourceAlert).toContainText('Brand Profiles could not be read');
  expect(await profileSourceAlert.evaluate((element) => getComputedStyle(element).borderStyle)).toBe('dotted');
  expect(await inboxSourceAlert.evaluate((element) => getComputedStyle(element).borderStyle)).toBe('dotted');
  await expect(metric).toHaveText('Unavailable');
  await expect(page.locator('article.profile')).toHaveCount(0);
  await expect(page.getByText('No brand profiles saved')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Saved "Fixture profile"' })).toContainText('profile write was committed, but Brand Profiles could not be reread');
  expectNoFeatureApiRequests(apiRequests);
});

test('installs complete committed profile snapshots across stale tabs and preference failure', async ({ page,context }) => {
  test.slow();
  const apiRequests = trackApiRequests(page);
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, storageEntries([], [profileFixture()]), { destination: '/brands' });

  const secondPage=await context.newPage();
  await secondPage.goto('/brands');
  await secondPage.getByRole('button',{name:'New profile'}).click();
  await secondPage.getByLabel('Brand name').fill('Concurrent fixture profile');
  await secondPage.getByRole('button',{name:'Save profile'}).click();
  await expect(secondPage.getByRole('status').filter({hasText:'Saved "Concurrent fixture profile"'})).toBeVisible();

  const profileCard = page.locator('article.profile').filter({ has: page.getByRole('heading', { name: 'Fixture profile', exact: true }) });
  await profileCard.getByRole('button', { name: `Edit Fixture profile (${PROFILE_ID})` }).click();
  await page.getByLabel('Brand name').fill('Committed fixture profile');
  await page.evaluate((key) => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(name: string, value: string) {
      if (this === localStorage && name === key) throw new DOMException('Preference write denied', 'QuotaExceededError');
      return originalSetItem.call(this, name, value);
    };
  }, ACTIVE_PROFILE_KEY);
  await page.getByRole('button', { name: 'Save profile' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Saved "Committed fixture profile"' })).toContainText('profile write was committed, but the active-profile preference could not be updated or reread');
  await expect(page.getByRole('heading',{name:'Concurrent fixture profile',exact:true})).toBeVisible();
  await expect(page.getByRole('region', { name: 'Brand review inbox' }).getByRole('alert')).toContainText('active-profile preference could not be read');
  await expect(page.getByRole('region', { name: 'Brand review inbox' }).locator('.review-heading > strong')).toHaveText('Unavailable');
  let storedProfiles = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1, minimumRevision: 2 });
  expect(storedProfiles.records[0]?.value.name).toBe('Committed fixture profile');

  await page.reload();
  const committedCard = page.locator('article.profile').filter({ has: page.getByRole('heading', { name: 'Committed fixture profile', exact: true }) });
  await expect(committedCard.getByRole('button', { name: `Delete Committed fixture profile (${PROFILE_ID})` })).toBeEnabled();
  await page.evaluate((key) => {
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(name: string) {
      if (this === localStorage && name === key) throw new DOMException('Preference read denied', 'SecurityError');
      return originalGetItem.call(this, name);
    };
  }, ACTIVE_PROFILE_KEY);
  const dialogPromise = page.waitForEvent('dialog');
  const deletePromise = committedCard.getByRole('button', { name: `Delete Committed fixture profile (${PROFILE_ID})` }).click();
  const dialog = await dialogPromise;
  await dialog.accept();
  await deletePromise;

  await expect(page.getByRole('status').filter({ hasText: 'Deleted "Committed fixture profile"' })).toContainText('deletion was committed, but the active-profile preference could not be updated or reread');
  await expect(page.getByRole('button', { name: 'Refresh saved profiles', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: /Edit Concurrent fixture profile/u })).toBeDisabled();
  storedProfiles = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRevision: 3 });
  expect(storedProfiles.records).toHaveLength(1);
  expect(storedProfiles.records[0]?.value.name).toBe('Concurrent fixture profile');
  expectNoFeatureApiRequests(apiRequests);
  await secondPage.close();
});

test('profile deletion separates a committed read failure from a rejected write', async ({ page }) => {
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, storageEntries([], [profileFixture()], ''), { destination: '/brands' });
  const deleteButton=page.getByRole('button',{name:`Delete Fixture profile (${PROFILE_ID})`});
  await expect(deleteButton).toBeVisible();
  await failNextBrowserLocalCollectionReadAfterWrite(page,'brand_profiles');
  const dialogPromise=page.waitForEvent('dialog');
  const deletePromise=deleteButton.click();
  const dialog=await dialogPromise;await dialog.accept();await deletePromise;
  const alert=page.locator('#brand-profile-source-state');
  await expect(alert).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh saved profiles', exact: true })).toBeFocused();
  await expect(page.getByRole('button',{name:'New profile'})).toBeDisabled();
  await expect(page.getByRole('status').filter({hasText:'Deleted "Fixture profile"'})).toContainText('deletion was committed, but Brand Profiles could not be reread');

  await page.reload();
  await migrateLegacyBrowserData(page, storageEntries([], [profileFixture()], ''), { destination: '/brands' });
  await expect(page.getByRole('button',{name:`Delete Fixture profile (${PROFILE_ID})`})).toBeVisible();
  const before = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  await failBrowserLocalManifestWrites(page,'brand_profiles');
  const retryDialogPromise=page.waitForEvent('dialog');
  const retryPromise=page.getByRole('button',{name:`Delete Fixture profile (${PROFILE_ID})`}).click();
  const retryDialog=await retryDialogPromise;await retryDialog.accept();await retryPromise;
  await expect(page.getByRole('button',{name:`Delete Fixture profile (${PROFILE_ID})`})).toBeFocused();
  await expect(page.locator('#brand-profile-source-state')).toHaveCount(0);
  await expect(page.getByRole('status').filter({hasText:'Could not delete profile'})).toContainText(/write|storage|quota/iu);
  await expect(page.getByRole('button',{name:'New profile'})).toBeEnabled();
  const after = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  expect(after.manifest.revision).toBe(before.manifest.revision);
  expect(after.records).toEqual(before.records);
});

test('keeps healthy Profiles available after a rejected import and clears preference failure after activation succeeds', async ({ page }) => {
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, storageEntries([], [profileFixture()], ''), { destination: '/brands' });
  await expect(page.getByRole('heading',{name:'Fixture profile',exact:true})).toBeVisible();
  await page.locator('label.file-btn input[type="file"]').setInputFiles({name:'profiles.json',mimeType:'application/json',buffer:Buffer.from('{}')});
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('This JSON file is not a WHOISleuth Brand Profile export.');
  await expect(page.getByRole('heading',{name:'Fixture profile',exact:true})).toBeVisible();
  await expect(page.locator('#brand-profile-source-state')).toHaveCount(0);

  await page.evaluate((key)=>{
    const original=Storage.prototype.setItem;
    let pending=true;
    Storage.prototype.setItem=function setItem(name:string,value:string){if(pending&&this===localStorage&&name===key){pending=false;throw new DOMException('Preference write denied','QuotaExceededError');}return original.call(this,name,value);};
  },ACTIVE_PROFILE_KEY);
  const radio=page.getByRole('radio',{name:'Set Fixture profile active'});
  await radio.click();
  await expect(page.getByRole('status').filter({hasText:'active-profile preference is unavailable'})).toBeVisible();
  await expect(radio).not.toBeChecked();
  await radio.click();
  await expect(page.getByRole('status').filter({hasText:'Set "Fixture profile" active.'})).toBeVisible();
  await expect(radio).toBeChecked();
  await expect(page.getByText(/active-profile preference could not be read/iu)).toHaveCount(0);
  await expect(page.getByRole('region',{name:'Brand review inbox'}).locator('.review-heading > strong')).toHaveText('0 review items');
});

test('a saved active-profile preference is not reported as unwritten when its recovery read fails', async ({ page }) => {
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, storageEntries([], [profileFixture()], ''), { destination: '/brands' });
  const before = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    let pending = true;
    Storage.prototype.setItem = function setItem(name: string, value: string) {
      if (pending && this === localStorage && name === key) { pending = false; throw new DOMException('Preference write denied', 'QuotaExceededError'); }
      return original.call(this, name, value);
    };
  }, ACTIVE_PROFILE_KEY);
  const radio = page.getByRole('radio', { name: 'Set Fixture profile active', exact: true });
  await radio.click();
  await expect(page.getByRole('status').filter({ hasText: 'active-profile preference is unavailable' })).toBeVisible();
  await failNextBrowserLocalCollectionRead(page, 'brand_profiles');
  await radio.click();
  await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('active-profile preference was saved, but saved profiles could not be refreshed');
  expect(await page.evaluate((key) => localStorage.getItem(key), ACTIVE_PROFILE_KEY)).toBe(PROFILE_ID);
  await expect(page.locator('#brand-profile-source-state')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh saved profiles', exact: true }).click();
  await expect(radio).toBeChecked();
  const after = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  expect(after.manifest.revision).toBe(before.manifest.revision);
  expect(after.records).toEqual(before.records);
});

test('propagates unavailable active-profile context across Lookup, Bulk and Discover without requests or negative inference', async ({ page }) => {
  const apiRequests=trackApiRequests(page);
  await page.goto('/bulk');
  await migrateLegacyBrowserData(page,storageEntries([], [profileFixture()]),{destination:'/bulk'});
  await page.evaluate((key)=>{
    const original=Storage.prototype.getItem;
    Storage.prototype.getItem=function getItem(name:string){if(this===localStorage&&name===key)throw new DOMException('Preference read denied','SecurityError');return original.call(this,name);};
  },ACTIVE_PROFILE_KEY);

  await page.locator('#console-navigation').getByRole('link',{name:/^Lookup/u}).click();
  await expect(page.getByRole('status').filter({hasText:'Profile context was unavailable'})).toContainText('remain inconclusive');
  await page.locator('#console-navigation').getByRole('link',{name:/^Bulk/u}).click();
  await expect(page.locator('.local-context-status')).toContainText('(profile)');
  await page.locator('#console-navigation').getByRole('link',{name:/^Discover/u}).click();
  await expect(page.locator('.local-context-status')).toContainText('(profile)');
  await page.getByLabel('Brand or domain').fill('example.invalid');
  await page.getByRole('button',{name:'Generate candidates'}).click();
  await expect(page.getByRole('status').filter({hasText:'Profile-derived trust and allowlist exclusions remain unavailable'})).toContainText('no candidate was classified as outside those lists');
  expectNoFeatureApiRequests(apiRequests);
});

test('exposes active-preference read failure without claiming there is no active profile', async ({ page }) => {
  await page.goto('/bulk');
  await migrateLegacyBrowserData(page, storageEntries([], [profileFixture()]), { destination: '/bulk' });
  await page.evaluate((key) => {
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(name: string) {
      if (this === localStorage && name === key) throw new DOMException('Preference read denied', 'SecurityError');
      return originalGetItem.call(this, name);
    };
  }, ACTIVE_PROFILE_KEY);
  await page.locator('#console-navigation').getByRole('link', { name: /^Brands/u }).click();

  const inbox = page.getByRole('region', { name: 'Brand review inbox' });
  await expect(inbox.getByRole('alert')).toContainText('active-profile preference could not be read');
  await expect(inbox.locator('.review-heading > strong')).toHaveText('Unavailable');
  await expect(inbox).toContainText('profile-scoped review work is suppressed');
  await expect(inbox).not.toContainText('No active profile');
  await expect(page.locator('article.profile')).toHaveCount(1);
});

test('rereads cases before profile deletion and discloses unknown impact on failure', async ({ page }) => {
  const apiRequests = trackApiRequests(page);
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, storageEntries([
    caseRecord({ id: 'deletion-read-failure', domain: 'deletion-read-failure.invalid', brandProfileIds: [PROFILE_ID] }),
  ]), { destination: '/brands' });

  const inbox = page.getByRole('region', { name: 'Brand review inbox' });
  await expect(inbox).toContainText('1 associated case');
  await failNextBrowserLocalCollectionRead(page, 'cases');
  const profileCard = page.locator('article.profile').filter({ has: page.getByRole('heading', { name: 'Fixture profile', exact: true }) });
  const dialogPromise = page.waitForEvent('dialog');
  const clickPromise = profileCard.getByRole('button', { name: `Delete Fixture profile (${PROFILE_ID})` }).click();
  const dialog = await dialogPromise;
  expect(dialog.message()).toContain('Linked-case impact cannot be checked because cases could not be read.');
  expect(dialog.message()).not.toContain('0 linked cases');
  await dialog.dismiss();
  await clickPromise;

  await expect(inbox.getByRole('alert')).toContainText('cases could not be read');
  await expect(inbox.locator('.review-heading > strong')).toHaveText('Unavailable');
  await expect(inbox).not.toContainText('0 associated cases');
  await expect(page.getByRole('status').filter({ hasText: 'Cases could not be read' })).toBeVisible();
  await expect(profileCard).toBeVisible();

  const retryDialogPromise = page.waitForEvent('dialog');
  const retryClickPromise = profileCard.getByRole('button', { name: `Delete Fixture profile (${PROFILE_ID})` }).click();
  const retryDialog = await retryDialogPromise;
  expect(retryDialog.message()).toContain('1 linked case will retain this identifier and appear unresolved after deletion.');
  await retryDialog.dismiss();
  await retryClickPromise;
  await expect(page.getByRole('status').filter({ hasText: 'Cases could not be read' })).toHaveCount(0);
  expectNoFeatureApiRequests(apiRequests);
});
