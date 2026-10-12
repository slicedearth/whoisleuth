import { expect, test } from './fixtures';
import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import {
  currentBrandProfileBrowserStore,
  migrateLegacyBrowserData,
  readBrowserLocalCollection,
  expectNoHorizontalOverflow,
  useTheme,
  failNextBrowserLocalCollectionReadAfterWrite,
  failNextBrowserLocalManifestWrite,
  currentBrowserLocalDocument,
  currentBulkSessionBrowserStore,
  holdBrowserLocalTransaction,
  openBulkWorkspaceTools,
  openBulkFilters,
} from './helpers';
import { richBulkSessionStore } from '../test/bulk-session-fixture.mts';
import { openConsoleView } from './console-navigation';
import { normalizeBrandProfile } from '../packages/workspace/brand-profile-model.mts';
import type { WatchDomainContext, WatchDomainMetadata } from '../packages/workspace/brand-candidate-workflow.mts';
import { reviseCandidateException, candidateMaterialFingerprint, MAX_CANDIDATE_TEXT } from '../packages/workspace/brand-candidate-workflow.mts';
import { BRAND_PROFILE_SCHEMA, BRAND_PROFILE_SCHEMA_VERSION } from '../packages/contracts/workspace-portability.mts';
import { candidateReviewItem } from '../packages/monitoring/brand-candidate-review.mts';
import { emptyAnalystReviewStateStore, setAnalystReviewDecision } from '../packages/monitoring/analyst-review-state.mts';

const NOW = '2000-01-03T00:00:00.000Z';
const candidate = {
  domain: 'candidate.example',
  matches: [
    {
      brandProfileId: 'example-brand',
      ruleKey: 'keyword:example',
      term: 'example',
      reason: 'Exact imported keyword nomination',
    },
  ],
  sources: [
    {
      source: 'Imported candidate record',
      revision: null,
      observedHostname: 'login.candidate.example',
      sourceFirstObservedAt: null,
      sourceLastObservedAt: null,
      firstLocalObservedAt: NOW,
      completeness: 'partial' as const,
      gap: 'Source interval and continuous coverage are unknown.',
    },
  ],
};
const profile = normalizeBrandProfile(
  {
    id: 'example-brand',
    name: 'Example Brand',
    createdAt: NOW,
    updatedAt: NOW,
    candidateObservations: [candidate],
  },
  { nowIso: NOW },
)!;

async function seed(page: import('@playwright/test').Page, extra: Record<string, unknown> = {}) {
  await page.goto('/brands');
  await migrateLegacyBrowserData(
    page,
    {
      'whois-rdap-brand-profiles-v1': currentBrandProfileBrowserStore([profile]),
      'whois-rdap-active-brand-profile-v1': profile.id,
      ...extra,
    },
    { clearStorage: true, destination: '/brands' },
  );
  const workspace = page.locator('#brand-candidate-review');
  await expect(
    workspace.getByRole('heading', { name: 'Candidate review for Example Brand' }),
  ).toBeVisible();
  await expect(
    workspace.getByRole('checkbox', { name: 'candidate.example', exact: true }),
  ).toBeEnabled();
  return workspace;
}

test('candidate inspection preserves queue state and keeps inspected and submitted domains separate', async ({ page }) => {
  const candidates = [candidate, ...Array.from({ length: 29 }, (_, index) => ({
    ...candidate,
    domain: `sample-${String(index).padStart(2, '0')}.example`,
    matches: index === 0 ? [...candidate.matches, { ...candidate.matches[0]!, ruleKey: 'keyword:alternate', reason: 'Alternate imported keyword nomination' }] : candidate.matches,
    sources: [{ ...candidate.sources[0]!, observedHostname: `login.sample-${String(index).padStart(2, '0')}.example` }],
  }))];
  const groupedProfile = normalizeBrandProfile({ ...profile, candidateObservations: candidates,
    officialDomains: ['sample-28.example'] }, { nowIso: NOW })!;
  const scopedException = reviseCandidateException(null, {
    id: 'grouped-rule-exception', domain: candidates[1]!.domain, ruleKey: 'keyword:example',
    purpose: 'irrelevant_match', reason: 'Only this exact retained rule was reviewed.',
    reviewedAt: NOW, expiresAt: '2099-01-01T00:00:00.000Z', enabled: true,
    reviewedFingerprint: candidateMaterialFingerprint(groupedProfile.candidateObservations.find(row => row.domain === 'sample-00.example')!, profile.id, 'keyword:example'),
  }, null);
  const workspace = await seed(page, { 'whois-rdap-brand-profiles-v1': currentBrandProfileBrowserStore([{
    ...groupedProfile, candidateExceptions: [scopedException],
  }]) });
  const brandsBefore = await readBrowserLocalCollection(page, 'brand_profiles');
  const reviewsBefore = await readBrowserLocalCollection(page, 'analyst_review_state');
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/')) requests.push(request.url()); });
  await workspace.getByRole('checkbox', { name: candidate.domain, exact: true }).check();
  await workspace.getByLabel('Candidate search').fill('sample-');
  await workspace.getByLabel('Candidate order').selectOption('domain');
  await workspace.getByRole('navigation', { name: 'Candidate pages' }).getByRole('button', { name: 'Next', exact: true }).click();
  const inspect = workspace.getByRole('button', { name: 'Inspect sample-25.example', exact: true });
  await inspect.focus();
  await inspect.press('p');
  await expect(workspace.getByRole('heading', { name: 'sample-25.example', exact: true })).toBeFocused();
  const evidence = workspace.getByRole('complementary', { name: 'Retained evidence inspector' });
  await expect(evidence).toContainText('login.sample-25.example');
  await expect(evidence).toContainText('Start unknown');
  await expect(evidence).toContainText('partial');
  await workspace.getByLabel('Destination watchlist').fill('Only checked candidates');
  await workspace.getByLabel('Reason', { exact: true }).fill('A checked nomination, not the open inspector.');
  await workspace.getByRole('button', { name: 'Preview exact watchlist handoff' }).click();
  const preview = workspace.getByRole('region', { name: 'Watchlist handoff preview' });
  await expect(preview).toContainText(candidate.domain);
  await expect(preview).not.toContainText('sample-25.example');
  await workspace.getByRole('button', { name: 'Back to queue', exact: true }).click();
  await expect(inspect).toBeFocused();
  await expect(workspace.getByLabel('Candidate search')).toHaveValue('sample-');
  await expect(workspace.getByLabel('Candidate order')).toHaveValue('domain');
  await expect(workspace.getByRole('navigation', { name: 'Candidate pages' })).toContainText('Page 2 of 2');
  await workspace.getByText('Explainable pattern groups (2)', { exact: true }).click();
  await workspace.getByText('29 contributing domains · Exact imported keyword nomination', { exact: true }).click();
  const contributors = workspace.getByRole('region', { name: 'Pattern group contributors for keyword:example', exact: true });
  await expect(contributors).toContainText('Group rule: keyword:example');
  await expect(contributors.getByRole('button', { name: /^Inspect grouped / })).toHaveCount(25);
  await expect(contributors.locator('li').filter({ hasText: 'sample-00.example' })).toContainText('Exact rule exception for keyword:example · active: Only this exact retained rule was reviewed.');
  await expect(contributors.locator('li').filter({ hasText: 'sample-00.example' })).toContainText('Review status: new');
  await workspace.getByText('1 contributing domain · Alternate imported keyword nomination', { exact: true }).click();
  const alternate = workspace.getByRole('region', { name: 'Pattern group contributors for keyword:alternate', exact: true });
  await expect(alternate).toContainText('Group rule: keyword:alternate');
  await expect(alternate).toContainText('Exact rule exception for keyword:example · active: Only this exact retained rule was reviewed.');
  await expect(alternate).toContainText('Review status: new');
  await contributors.getByRole('navigation', { name: 'Pattern contributor pages' }).getByRole('button', { name: 'Next', exact: true }).click();
  await expect(contributors.getByRole('button', { name: /^Inspect grouped / })).toHaveCount(4);
  await expect(contributors.locator('li').filter({ hasText: 'sample-28.example' })).toContainText('Exact official-domain declaration; not a safety verdict.');
  const groupedInspect = contributors.getByRole('button', { name: 'Inspect grouped sample-28.example', exact: true });
  await groupedInspect.focus();
  await groupedInspect.press('Enter');
  await expect(workspace.getByRole('heading', { name: 'sample-28.example', exact: true })).toBeFocused();
  await expect(evidence).toContainText('login.sample-28.example');
  await expect(preview).toContainText(candidate.domain);
  await expect(preview).not.toContainText('sample-28.example');
  await workspace.getByRole('button', { name: 'Back to queue', exact: true }).click();
  await expect(groupedInspect).toBeFocused();
  await expect(contributors.getByRole('navigation', { name: 'Pattern contributor pages' })).toContainText('Page 2 of 2');
  await expect(workspace.getByRole('navigation', { name: 'Candidate pages' })).toContainText('Page 2 of 2');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1280, 1920]) {
      await page.setViewportSize({ width, height: 844 });
      if (captureVisualEvidenceEnabled() && (width === 320 || width === 1280)) {
        await groupedInspect.scrollIntoViewIfNeeded();
        await workspace.locator('.workbench-queue').screenshot({ path: test.info().outputPath(`candidate-group-${theme}-${width}.png`) });
      }
      await inspect.click();
      await expect(workspace.getByRole('heading', { name: 'sample-25.example', exact: true })).toBeFocused();
      await expectNoHorizontalOverflow(page);
      await expect(evidence).toBeVisible();
      if (width <= 390) await expect(workspace.getByLabel('Candidate search')).toBeHidden();
      if (captureVisualEvidenceEnabled()) {
        await workspace.scrollIntoViewIfNeeded();
        await page.screenshot({ path: test.info().outputPath(`candidate-inspector-${theme}-${width}.png`), fullPage: true });
      }
      await workspace.getByRole('button', { name: 'Back to queue', exact: true }).click();
      await expect(inspect).toBeFocused();
      await expect(workspace.getByLabel('Candidate search')).toHaveValue('sample-');
    }
  }
  await workspace.getByLabel('Candidate search').fill('');
  await expect(workspace.getByRole('checkbox', { name: candidate.domain, exact: true })).toBeChecked();
  expect(await readBrowserLocalCollection(page, 'brand_profiles')).toEqual(brandsBefore);
  expect(await readBrowserLocalCollection(page, 'analyst_review_state')).toEqual(reviewsBefore);
  expect((await readBrowserLocalCollection(page, 'watchlists')).records).toEqual([]);
  expect(requests).toEqual([]);
});

test('reusing a candidate reason copies editable text without inheriting a decision or target', async ({ page }, testInfo) => {
  const nextCandidate = { ...candidate, domain: 'next-candidate.example',
    sources: [{ ...candidate.sources[0]!, observedHostname: 'login.next-candidate.example' }] };
  const longCandidate = { ...candidate, domain: 'long-reason.example',
    sources: [{ ...candidate.sources[0]!, observedHostname: 'login.long-reason.example' }] };
  const other = normalizeBrandProfile({ ...profile, id: 'other-brand', name: 'Other Brand',
    candidateObservations: [{ ...candidate, matches: candidate.matches.map(match => ({ ...match, brandProfileId: 'other-brand' })) }],
  }, { nowIso: NOW })!;
  const originalReason = 'Review the separately retained page before assessing this nomination.';
  const longReason = 'x'.repeat(MAX_CANDIDATE_TEXT + 1);
  let reviews = setAnalystReviewDecision(emptyAnalystReviewStateStore(), candidateReviewItem(candidate, profile, NOW), {
    disposition: 'suppressed', rationale: originalReason, reviewedAt: NOW, expiresAt: '2097-01-01T00:00:00Z',
  });
  reviews = setAnalystReviewDecision(reviews, candidateReviewItem(longCandidate, profile, NOW), {
    disposition: 'expected', rationale: longReason, reviewedAt: NOW, expiresAt: '2097-01-01T00:00:00Z',
  });
  reviews = setAnalystReviewDecision(reviews, candidateReviewItem(other.candidateObservations[0]!, other, NOW), {
    disposition: 'suppressed', rationale: 'Other Brand wording must not appear in this review.', reviewedAt: NOW, expiresAt: '2097-01-01T00:00:00Z',
  });
  const workspace = await seed(page, {
    'whois-rdap-brand-profiles-v1': currentBrandProfileBrowserStore([{ ...profile, candidateObservations: [candidate, nextCandidate, longCandidate] }, other]),
    'whoisleuth-analyst-review-state-v1': reviews,
  });
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/')) requests.push(request.url()); });
  const before = await readBrowserLocalCollection(page, 'analyst_review_state');
  const brandsBefore = await readBrowserLocalCollection(page, 'brand_profiles');
  const reason = workspace.getByLabel('Reason', { exact: true });
  await reason.fill('Keep this current draft until explicitly replaced.');
  await workspace.getByLabel('Next review / expiry date (UTC)', { exact: true }).fill('2099-01-01');
  await workspace.getByLabel('Analyst review priority').selectOption('p3');
  await workspace.getByLabel('Destination watchlist').fill('Current selection');
  await workspace.getByText('Reuse an earlier reason', { exact: true }).click();
  const sources = workspace.getByRole('combobox', { name: 'Earlier candidate reason', exact: true });
  await expect(sources.locator('option')).toHaveCount(3);
  await sources.selectOption({ label: candidate.domain });
  await expect(workspace.locator('.saved-reason')).toHaveText(originalReason);
  await expect(reason).toHaveValue('Keep this current draft until explicitly replaced.');
  const copy = workspace.getByRole('button', { name: 'Replace draft reason with this text', exact: true });
  await expect(copy).toBeDisabled();
  await workspace.getByRole('checkbox', { name: nextCandidate.domain, exact: true }).check();
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await copy.scrollIntoViewIfNeeded();
      await expect(copy).toBeInViewport();
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) await page.screenshot({ path: testInfo.outputPath(`reused-reason-${theme}-${width}.png`) });
    }
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await copy.focus(); await copy.press('Enter');
  await expect(reason).toBeFocused();
  await expect(reason).toBeInViewport();
  await expect(reason).toHaveValue(originalReason);
  await expect(workspace.getByRole('checkbox', { name: candidate.domain, exact: true })).not.toBeChecked();
  await expect(workspace.getByRole('checkbox', { name: nextCandidate.domain, exact: true })).toBeChecked();
  await expect(workspace.getByLabel('Next review / expiry date (UTC)', { exact: true })).toHaveValue('2099-01-01');
  await expect(workspace.getByLabel('Analyst review priority')).toHaveValue('p3');
  await expect(workspace.getByLabel('Destination watchlist')).toHaveValue('Current selection');
  expect(await readBrowserLocalCollection(page, 'analyst_review_state')).toEqual(before);
  expect(await readBrowserLocalCollection(page, 'brand_profiles')).toEqual(brandsBefore);
  expect((await readBrowserLocalCollection(page, 'watchlists')).records).toEqual([]);
  await sources.selectOption({ label: longCandidate.domain });
  await expect(workspace.locator('.saved-reason')).toHaveText(longReason);
  await expect(copy).toBeDisabled();
  await expect(reason).toHaveValue(originalReason);
  await reason.fill('Edited for the next candidate only.');
  await workspace.getByRole('button', { name: 'Defer selected until review', exact: true }).click();
  await expect(workspace.getByRole('status', { name: 'Candidate review action status' })).toContainText('1 exact Brand candidate decisions recorded');
  const after = await readBrowserLocalCollection(page, 'analyst_review_state', { minimumRecords: 4 });
  for (const old of before.records) expect(after.records.find(record => record.id === old.id)).toEqual(old);
  const saved = after.records.find(record => record.value.subjectKey === candidateReviewItem(nextCandidate, profile, NOW).subjectKey)!.value;
  expect(saved).toMatchObject({ disposition: 'expected', rationale: 'Edited for the next candidate only.', reviewDueAt: '2099-01-01T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', history: [] });
  const profiles = page.locator('details.brand-profiles');
  if (await profiles.getAttribute('open') === null) await profiles.locator(':scope > summary').click();
  await page.getByRole('radio', { name: 'Set Other Brand active', exact: true }).check();
  await expect(workspace.getByRole('heading', { name: 'Candidate review for Other Brand' })).toBeVisible();
  await expect(sources).toHaveValue('');
  await expect(reason).toHaveValue('');
  await expect(workspace.locator('.saved-reason')).toHaveCount(0);
  expect(requests).toEqual([]);
});

test('a rejected candidate decision preserves its selection and permits a deliberate retry', async ({ page }) => {
  const workspace = await seed(page);
  const selected = workspace.getByRole('checkbox', { name: candidate.domain, exact: true });
  await selected.check();
  const reason = workspace.getByLabel('Reason', { exact: true });
  await reason.fill('Review the exact nominated candidate.');
  await workspace.getByLabel('Next review / expiry date (UTC)', { exact: true }).fill('2099-01-01');
  await failNextBrowserLocalManifestWrite(page, 'analyst_review_state');
  const save = workspace.getByRole('button', { name: 'Defer selected until review', exact: true });
  await save.click();
  const status = workspace.getByRole('status', { name: 'Candidate review action status' });
  await expect(status).toContainText('0 decisions confirmed saved; 1 decision was not saved; 0 candidates were not attempted');
  await expect(selected).toBeChecked();
  await expect(reason).toHaveValue('Review the exact nominated candidate.');
  await expect(save).toBeEnabled();
  expect((await readBrowserLocalCollection(page, 'analyst_review_state')).records).toEqual([]);
  await save.click();
  await expect(status).toContainText('1 exact Brand candidate decisions recorded');
  expect((await readBrowserLocalCollection(page, 'analyst_review_state')).records).toHaveLength(1);
});

test('switching Brand replaces an initial context read and ignores its late failure', { tag: '@timing-sensitive' }, async ({ page }) => {
  const second = normalizeBrandProfile({
    ...profile, id: 'second-brand', name: 'Second Brand',
    candidateObservations: [{ ...candidate, domain: 'second-candidate.example',
      matches: candidate.matches.map(match => ({ ...match, brandProfileId: 'second-brand' })) }],
  }, { nowIso: NOW })!;
  await seed(page, { 'whois-rdap-brand-profiles-v1': currentBrandProfileBrowserStore([profile, second]) });
  // Delay one real readonly transaction's acknowledgement, not the database or
  // Brand selection. Replacement reads can finish before this old one fails.
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
    if (!descriptor?.set) throw new Error('Native transaction completion is unavailable.');
    const originalGet = IDBObjectStore.prototype.get;
    let held: IDBTransaction | null = null;
    const state = { held: false, released: false, release: () => {
      if (state.released) return;
      state.released = true;
      IDBObjectStore.prototype.get = originalGet;
      Object.defineProperty(IDBTransaction.prototype, 'oncomplete', descriptor);
      held?.onabort?.call(held, new Event('abort'));
    } };
    (window as typeof window & { candidateContextRead?: typeof state }).candidateContextRead = state;
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
      ...descriptor,
      set(this: IDBTransaction, callback: IDBTransaction['oncomplete']) {
        descriptor.set!.call(this, callback && ((event: Event) => {
          if (this === held && !state.released) state.held = true;
          else callback.call(this, event);
        }));
      },
    });
    IDBObjectStore.prototype.get = function (key: IDBValidKey | IDBKeyRange) {
      if (!held && this.name === 'manifests' && key === 'watchlists'
        && this.transaction.mode === 'readonly' && document.querySelector('#brand-candidate-review')) held = this.transaction;
      return originalGet.call(this, key);
    };
  });
  await page.reload();
  const workspace = page.locator('#brand-candidate-review');
  const release = () => page.evaluate(() =>
    (window as typeof window & { candidateContextRead?: { release: () => void } }).candidateContextRead?.release());
  try {
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & { candidateContextRead?: { held: boolean } }).candidateContextRead?.held)).toBe(true);
    await expect(workspace.getByRole('checkbox', { name: candidate.domain, exact: true })).toBeDisabled();
    const profiles = page.locator('details.brand-profiles');
    if (await profiles.getAttribute('open') === null) await profiles.locator(':scope > summary').click();
    await expect(page.getByRole('radio', { name: 'Set Second Brand active', exact: true })).toBeVisible();
    await page.getByRole('radio', { name: 'Set Second Brand active', exact: true }).check();
    await expect(workspace.getByRole('heading', { name: 'Candidate review for Second Brand' })).toBeVisible();
    const selected = workspace.getByRole('checkbox', { name: 'second-candidate.example', exact: true });
    await expect(selected).toBeEnabled();
    await selected.check();
    const reason = workspace.getByLabel('Reason', { exact: true });
    const destination = workspace.getByLabel('Destination watchlist');
    await reason.fill('Keep this new Brand draft after the old read finishes.');
    await destination.fill('Second Brand review');
    await workspace.getByRole('button', { name: 'Shortlist selected', exact: true }).click();
    const status = workspace.getByRole('status', { name: 'Candidate review action status' });
    await expect(status).toContainText('1 domains added to Shortlist');
    await release();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(selected).toBeEnabled();
    await expect(selected).toBeChecked();
    await expect(reason).toHaveValue('Keep this new Brand draft after the old read finishes.');
    await expect(destination).toHaveValue('Second Brand review');
    await expect(status).toContainText('1 domains added to Shortlist');
    await expect(workspace.getByText('Saved watch and review context is unavailable or loading.', { exact: false })).toHaveCount(0);
  } finally { if (!page.isClosed()) await release(); }
});

test('candidate nomination preserves full Shortlist evidence and a concurrent observed refresh', { tag: '@timing-sensitive' }, async ({ page, context }) => {
  const session = richBulkSessionStore(1).sessions[0]!;
  session.domains = [candidate.domain];
  session.results = session.results.map(row => ({ ...row, domain: candidate.domain, registrar: 'Updated Example Registrar', pageTitle: 'New retained page' }));
  const workspace = await seed(page, {
    'whoisleuth-bulk-sessions-v1': currentBulkSessionBrowserStore([session]),
    'whois-rdap-shortlist-v1': currentBrowserLocalDocument('shortlist', { entries: [{
      domain: candidate.domain, savedAt: NOW, scanDepth: 'deep', availability: 'registered',
      registrarName: 'Original Example Registrar', pageTitle: 'Retained original page',
      riskModelVersion: 9, riskScore: 72, opportunityModelVersion: 2, opportunityScore: 41, mutationTypes: ['omission'],
    }] }),
  });
  await workspace.getByRole('checkbox', { name: candidate.domain, exact: true }).check();
  const nominate = workspace.getByRole('button', { name: 'Shortlist selected', exact: true });
  const before = (await readBrowserLocalCollection(page, 'shortlist', { minimumRecords: 1 })).records[0]!.value;
  await nominate.click();
  await expect(workspace.getByRole('status')).toContainText('0 domains added to Shortlist; 1 already present and unchanged; 0 skipped');
  expect((await readBrowserLocalCollection(page, 'shortlist')).records[0]!.value).toEqual(before);
  const peer = await context.newPage();
  try {
    await peer.goto('/bulk'); await openBulkWorkspaceTools(peer);
    await peer.getByRole('article').filter({ has: peer.getByRole('heading', { name: session.name, exact: true }) }).getByRole('button', { name: 'Load', exact: true }).click();
    await openBulkFilters(peer);
    const release = await holdBrowserLocalTransaction(peer);
    try {
      await peer.getByRole('button', { name: 'Select matched', exact: true }).click();
      await nominate.click();
    } finally { await release(); }
    await expect(nominate).toBeEnabled();
    await expect.poll(async () => (await readBrowserLocalCollection(peer, 'shortlist')).records[0]!.value.registrarName).toBe('Updated Example Registrar');
    await page.reload();
    const retained = (await readBrowserLocalCollection(page, 'shortlist')).records[0]!.value;
    expect(retained).toMatchObject({ domain: candidate.domain, availability: 'registered', registrarName: 'Updated Example Registrar', pageTitle: 'New retained page' });
  } finally { await peer.close(); }
});

test('retained candidate review hands off exact local context without collection or a fake baseline', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/(lookup|bulk|discover|scheduled-monitor)/u.test(request.url()))
      requests.push(request.url());
  });
  const workspace = await seed(page);
  await workspace.getByRole('checkbox', { name: 'candidate.example', exact: true }).check();
  await workspace
    .getByLabel('Reason', { exact: true })
    .fill('Review this independently observed matching pattern.');
  await workspace.getByLabel('Destination watchlist').fill('Example review');
  await workspace.getByLabel('Analyst review priority').selectOption('p2');
  await workspace.getByRole('button', { name: 'Preview exact watchlist handoff' }).click();
  await expect(workspace.getByRole('region', { name: 'Watchlist handoff preview' })).toContainText(
    'Additional requests: 0',
  );
  await workspace.getByRole('button', { name: 'Add reviewed domains without collection' }).click();
  await expect(workspace.getByRole('status')).toContainText('1 domains retained');
  const stored = await readBrowserLocalCollection(page, 'watchlists', { minimumRecords: 1 });
  const entry = stored.records[0]!.value;
  expect(entry.results).toEqual([]);
  expect(entry.baseline).toEqual([]);
  expect(entry.history).toEqual([]);
  expect(entry.updatedAt).toBeNull();
  expect(entry.domainMetadata[0]!.candidate!.sources[0]!.observedHostname).toBe(
    'login.candidate.example',
  );
  expect(entry.domainMetadata[0]!.contexts[0]!.priority).toBe('p2');
  await page.goto('/monitor');
  await openConsoleView(page, 'watchlists');
  await page
    .getByRole('row', { name: /Example review/ })
    .getByRole('button', { name: 'History', exact: true })
    .click();
  const metadata = page.locator('.domain-metadata');
  await expect(metadata).toContainText(
    '1 retained domains · 0 latest observed results · 0 retained checks',
  );
  const watchContext = metadata.getByRole('checkbox', { name: 'candidate.example — Brand Example Brand', exact: true });
  await expect(watchContext).toHaveAccessibleDescription('Exact Brand identifier: example-brand');
  await watchContext.check();
  await metadata.getByLabel('New analyst priority').selectOption('p1');
  await metadata
    .getByLabel('New watch reason')
    .fill('Deliberately escalate the independent concern.');
  await metadata.getByRole('button', { name: 'Preview selected priority changes' }).click();
  await expect(metadata.getByRole('button', { name: 'Apply reviewed context changes' })).toBeVisible();
  const beforeInvalidation = await readBrowserLocalCollection(page, 'watchlists', { minimumRecords: 1 });
  await metadata.getByLabel('New analyst priority').selectOption('p3');
  await expect(
    metadata.getByRole('button', { name: 'Apply reviewed context changes' }),
  ).toHaveCount(0);
  const afterInvalidation = await readBrowserLocalCollection(page, 'watchlists', { minimumRecords: 1 });
  expect(afterInvalidation.manifest.revision).toBe(beforeInvalidation.manifest.revision);
  expect(afterInvalidation.records).toEqual(beforeInvalidation.records);
  await metadata.getByRole('button', { name: 'Preview selected priority changes' }).click();
  await metadata.getByRole('button', { name: 'Apply reviewed context changes' }).click();
  await expect(metadata.getByRole('status')).toContainText('1 exact domain contexts changed');
  await page.reload();
  await openConsoleView(page, 'watchlists');
  await page
    .getByRole('row', { name: /Example review/ })
    .getByRole('button', { name: 'History', exact: true })
    .click();
  await expect(page.locator('.domain-metadata')).toContainText('P3 routine review');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) await page.screenshot({ path: test.info().outputPath(`watch-context-${theme}-${width}.png`), fullPage: true });
    }
  }
  expect(requests).toEqual([]);
});

test('scoped candidate exceptions expose exact scope and retained reversible revisions', async ({
  page,
}) => {
  const workspace = await seed(page);
  await workspace
    .getByLabel('Reason', { exact: true })
    .fill('Reviewed irrelevant exact matching pattern.');
  await workspace.getByLabel('Next review / expiry date (UTC)').fill('2099-01-01');
  await workspace.getByText('Preview an exact scoped exception', { exact: true }).click();
  await workspace.getByLabel('Exact candidate domain').selectOption(candidate.domain);
  await workspace.getByLabel('Exact matching rule').selectOption('keyword:example');
  await expect(workspace).toContainText('only candidate.example, only Example Brand');
  if (captureVisualEvidenceEnabled()) {
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await expectNoHorizontalOverflow(page);
        await page.screenshot({ path: test.info().outputPath(`candidate-review-${theme}-${width}.png`), fullPage: true });
      }
    }
  }
  await workspace.getByRole('button', { name: 'Record reviewed exact exception' }).click();
  await expect(workspace.getByRole('status')).toContainText(
    'exact Brand/domain/rule exception was recorded',
  );
  await workspace.getByLabel('Candidate filter').selectOption('excluded');
  await expect(
    workspace.getByRole('checkbox', { name: candidate.domain, exact: true }),
  ).toBeVisible();
  await workspace.getByRole('button', { name: 'Disable exception revision 1' }).click();
  await expect(workspace.getByRole('status')).toContainText('Exception disabled');
  await workspace.getByLabel('Candidate filter').selectOption('new');
  await expect(
    workspace.getByRole('checkbox', { name: candidate.domain, exact: true }),
  ).toBeVisible();
  const stored = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  const exception = stored.records[0]!.value.candidateExceptions[0]!;
  expect(exception.enabled).toBe(false);
  expect(exception.revision).toBe(2);
  expect(exception.history).toHaveLength(1);
});

test('a committed exception retains handoff drafts and its refresh-failure warning', async ({ page }) => {
  const workspace = await seed(page);
  await workspace.getByRole('checkbox', { name: candidate.domain, exact: true }).check();
  await workspace.getByLabel('Reason', { exact: true }).fill('Retain this independently reviewed draft.');
  await workspace.getByLabel('Destination watchlist').fill('Unsaved destination');
  await workspace.getByLabel('Analyst review priority').selectOption('p2');
  await workspace.getByLabel('Next review / expiry date (UTC)').fill('2099-01-01');
  await workspace.getByRole('button', { name: 'Preview exact watchlist handoff' }).click();
  await expect(workspace.getByRole('button', { name: 'Add reviewed domains without collection' })).toBeEnabled();
  await workspace.getByText('Preview an exact scoped exception', { exact: true }).click();
  await workspace.getByLabel('Exact candidate domain').selectOption(candidate.domain);
  await workspace.getByLabel('Exact matching rule').selectOption('keyword:example');
  await failNextBrowserLocalCollectionReadAfterWrite(page, 'brand_profiles');
  await workspace.getByRole('button', { name: 'Record reviewed exact exception' }).click();
  const status = workspace.getByRole('status', { name: 'Candidate review action status' });
  await expect(status).toContainText('The write committed, but refreshing the visible Brand failed');
  await expect(status).toBeFocused();
  await expect(workspace.getByRole('checkbox', { name: candidate.domain, exact: true })).toBeChecked();
  await expect(workspace.getByLabel('Reason', { exact: true })).toHaveValue('Retain this independently reviewed draft.');
  await expect(workspace.getByLabel('Destination watchlist')).toHaveValue('Unsaved destination');
  await expect(workspace.getByLabel('Analyst review priority')).toHaveValue('p2');
  await expect(workspace.getByLabel('Next review / expiry date (UTC)')).toHaveValue('2099-01-01');
  await expect(workspace.getByRole('button', { name: 'Add reviewed domains without collection' })).toBeDisabled();
  const committed = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  expect(committed.records[0]!.value.candidateExceptions).toHaveLength(1);
  expect(committed.records[0]!.value.candidateExceptions[0]!.revision).toBe(1);
  await page.getByRole('button', { name: 'Refresh saved profiles', exact: true }).click();
  await expect(workspace.getByLabel('Destination watchlist')).toHaveValue('Unsaved destination');
  await expect(workspace.getByLabel('Exact matching rule')).toHaveValue('keyword:example');
  const after = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  expect(after.manifest.revision).toBe(committed.manifest.revision);
});

test('invalid edits remove a valid handoff preview without writing or unhandled rejection', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const workspace = await seed(page);
  await workspace.getByRole('checkbox', { name: candidate.domain, exact: true }).check();
  await workspace.getByLabel('Destination watchlist').fill('Reviewed destination');
  await workspace.getByLabel('Reason', { exact: true }).fill('A valid reviewed reason.');
  const before = await readBrowserLocalCollection(page, 'watchlists');
  for (const label of ['Destination watchlist', 'Reason']) {
    await workspace.getByRole('button', { name: 'Preview exact watchlist handoff' }).click();
    await expect(workspace.getByRole('button', { name: 'Add reviewed domains without collection' })).toBeEnabled();
    await workspace.getByLabel(label, { exact: true }).fill('');
    await expect(workspace.getByRole('button', { name: 'Add reviewed domains without collection' })).toHaveCount(0);
    await expect(workspace.getByRole('status', { name: 'Candidate review action status' })).toContainText(label === 'Reason' ? 'watch reason' : 'watchlist name');
    await workspace.getByRole('button', { name: 'Preview exact watchlist handoff' }).click();
    await expect(workspace.getByRole('button', { name: 'Add reviewed domains without collection' })).toHaveCount(0);
    await workspace.getByLabel(label, { exact: true }).fill(label === 'Reason' ? 'A valid reviewed reason.' : 'Reviewed destination');
  }
  const after = await readBrowserLocalCollection(page, 'watchlists');
  expect(after.manifest.revision).toBe(before.manifest.revision);
  expect(after.records).toEqual(before.records);
  expect(errors).toEqual([]);
});

test('domain context pages preserve exact selections beyond 200 and distinguish shared Brands', async ({ page }) => {
  const context: WatchDomainContext = { brandProfileId: null, priority: 'unassigned', reason: '', changedAt: null, reviewDueAt: null };
  const metadata: WatchDomainMetadata[] = Array.from({ length: 200 }, (_, index) => ({ domain: `domain-${String(index).padStart(3, '0')}.example`, contexts: [context], candidate: null }));
  metadata.push({ domain: 'shared.example', contexts: [{ ...context, brandProfileId: 'first-brand' }, { ...context, brandProfileId: 'second-brand' }, { ...context, brandProfileId: 'missing-brand' }], candidate: null });
  await page.goto('/monitor');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-watchlist-v1': currentBrowserLocalDocument('watchlists', { Paged: { updatedAt: null, results: [], baseline: [], history: [], domainMetadata: metadata } }),
    'whois-rdap-brand-profiles-v1': currentBrandProfileBrowserStore([{ ...profile, id: 'first-brand', name: 'First Brand', candidateObservations: [] }, { ...profile, id: 'second-brand', name: 'Second Brand', candidateObservations: [] }]),
  }, { clearStorage: true, destination: '/monitor?view=watchlists' });
  await openConsoleView(page, 'watchlists');
  await page.getByRole('row', { name: /Paged/ }).getByRole('button', { name: 'History', exact: true }).click();
  const workspace = page.locator('.domain-metadata');
  await expect(workspace.locator('.metadata-grid > article')).toHaveCount(200);
  await workspace.getByRole('checkbox', { name: 'domain-000.example — Watchlist-only context', exact: true }).check();
  const pages = workspace.getByRole('navigation', { name: 'Domain context pages' });
  await pages.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(pages.getByRole('status')).toHaveText('Page 2 of 2');
  await expect(workspace.locator('.metadata-grid > article')).toHaveCount(3);
  const first = workspace.getByRole('checkbox', { name: 'shared.example — Brand First Brand', exact: true });
  const second = workspace.getByRole('checkbox', { name: 'shared.example — Brand Second Brand', exact: true });
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await expect(first).toHaveAccessibleDescription('Exact Brand identifier: first-brand');
  await expect(second).toHaveAccessibleDescription('Exact Brand identifier: second-brand');
  await expect(workspace.getByRole('checkbox', { name: 'shared.example — Brand name unavailable (missing-brand)', exact: true })).toBeEnabled();
  await first.check();
  await second.check();
  await workspace.getByLabel('Search domain contexts').fill('First Brand');
  await expect(first).toBeChecked();
  await expect(second).toHaveCount(0);
  await workspace.getByLabel('Search domain contexts').fill('shared.example');
  await expect(first).toBeChecked();
  await expect(second).toBeChecked();
  await expect(workspace).toContainText('3 selected across pages and filters');
  await workspace.getByLabel('New analyst priority').selectOption('p1');
  await workspace.getByLabel('New watch reason').fill('Review these exact independent contexts.');
  await workspace.getByRole('button', { name: 'Preview selected priority changes' }).click();
  const preview = workspace.getByRole('region', { name: 'Domain priority change preview' });
  await expect(preview).toContainText('domain-000.example');
  await expect(preview).toContainText('Brand First Brand');
  await expect(preview).toContainText('Brand Second Brand');
  await preview.getByRole('button', { name: 'Apply reviewed context changes' }).click();
  await expect(workspace.getByRole('status').filter({ hasText: 'exact domain contexts changed' })).toContainText('3 exact domain contexts changed');
  const stored = await readBrowserLocalCollection(page, 'watchlists', { minimumRecords: 1 });
  const retained = stored.records[0]!.value.domainMetadata;
  expect(retained.find(row => row.domain === 'domain-000.example')!.contexts[0]!.priority).toBe('p1');
  expect(retained.find(row => row.domain === 'domain-199.example')!.contexts[0]!.priority).toBe('unassigned');
  const sharedContexts = retained.find(row => row.domain === 'shared.example')!.contexts;
  expect(sharedContexts).toHaveLength(3);
  expect(Object.fromEntries(sharedContexts.map(row => [row.brandProfileId, row.priority]))).toEqual({ 'first-brand': 'p1', 'second-brand': 'p1', 'missing-brand': 'unassigned' });
});

test('conflicting exception import orders leave the browser store unchanged', async ({ page }) => {
  await seed(page);
  const observed = profile.candidateObservations[0]!;
  const saved = reviseCandidateException(null, {
    id: 'exception-1', domain: candidate.domain, ruleKey: 'keyword:example', purpose: 'irrelevant_match',
    reason: 'Reviewed exact candidate nomination.', reviewedAt: NOW, expiresAt: '2099-01-01T00:00:00.000Z',
    reviewedFingerprint: candidateMaterialFingerprint(observed, profile.id, 'keyword:example'), enabled: true,
  }, null);
  const conflicting = { ...saved, reason: 'A conflicting review of this same revision.' };
  const before = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  for (const candidateExceptions of [[saved, conflicting], [conflicting, saved]]) {
    const payload = { schema: BRAND_PROFILE_SCHEMA, version: BRAND_PROFILE_SCHEMA_VERSION, exportedAt: NOW, profiles: [{ ...profile, updatedAt: '2098-01-01T00:00:00.000Z', candidateExceptions }] };
    await page.locator('label.file-btn input[type="file"]').setInputFiles({ name: 'profiles.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
    await expect(page.getByRole('status', { name: 'Brand Profile action status' })).toContainText('conflicting decisions');
    const after = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
    expect(after.manifest.revision).toBe(before.manifest.revision);
    expect(after.records).toEqual(before.records);
  }
});
