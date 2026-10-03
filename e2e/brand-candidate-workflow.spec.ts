import { expect, test } from './fixtures';
import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import {
  currentBrandProfileBrowserStore,
  migrateLegacyBrowserData,
  readBrowserLocalCollection,
  expectNoHorizontalOverflow,
  useTheme,
  failNextBrowserLocalCollectionReadAfterWrite,
  currentBrowserLocalDocument,
} from './helpers';
import { openConsoleView } from './console-navigation';
import { normalizeBrandProfile } from '../packages/workspace/brand-profile-model.mts';
import type { WatchDomainContext, WatchDomainMetadata } from '../packages/workspace/brand-candidate-workflow.mts';
import { reviseCandidateException, candidateMaterialFingerprint } from '../packages/workspace/brand-candidate-workflow.mts';
import { BRAND_PROFILE_SCHEMA, BRAND_PROFILE_SCHEMA_VERSION } from '../packages/contracts/workspace-portability.mts';

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
      completeness: 'partial',
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

async function seed(page: import('@playwright/test').Page) {
  await page.goto('/brands');
  await migrateLegacyBrowserData(
    page,
    {
      'whois-rdap-brand-profiles-v1': currentBrandProfileBrowserStore([profile]),
      'whois-rdap-active-brand-profile-v1': profile.id,
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
  await metadata.getByRole('checkbox', { name: 'candidate.example — Brand example-brand', exact: true }).check();
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
  metadata.push({ domain: 'shared.example', contexts: [{ ...context, brandProfileId: 'first-brand' }, { ...context, brandProfileId: 'second-brand' }], candidate: null });
  await page.goto('/monitor');
  await migrateLegacyBrowserData(page, { 'whois-rdap-watchlist-v1': currentBrowserLocalDocument('watchlists', { Paged: { updatedAt: null, results: [], baseline: [], history: [], domainMetadata: metadata } }) }, { clearStorage: true, destination: '/monitor' });
  await openConsoleView(page, 'watchlists');
  await page.getByRole('row', { name: /Paged/ }).getByRole('button', { name: 'History', exact: true }).click();
  const workspace = page.locator('.domain-metadata');
  await expect(workspace.locator('.metadata-grid > article')).toHaveCount(200);
  await workspace.getByRole('checkbox', { name: 'domain-000.example — Watchlist-only context', exact: true }).check();
  const pages = workspace.getByRole('navigation', { name: 'Domain context pages' });
  await pages.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(pages.getByRole('status')).toHaveText('Page 2 of 2');
  await expect(workspace.locator('.metadata-grid > article')).toHaveCount(2);
  const first = workspace.getByRole('checkbox', { name: 'shared.example — Brand first-brand', exact: true });
  const second = workspace.getByRole('checkbox', { name: 'shared.example — Brand second-brand', exact: true });
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await first.check();
  await second.check();
  await workspace.getByLabel('Search domain contexts').fill('shared.example');
  await expect(first).toBeChecked();
  await expect(second).toBeChecked();
  await expect(workspace).toContainText('3 selected across pages and filters');
  await workspace.getByLabel('New analyst priority').selectOption('p1');
  await workspace.getByLabel('New watch reason').fill('Review these exact independent contexts.');
  await workspace.getByRole('button', { name: 'Preview selected priority changes' }).click();
  const preview = workspace.getByRole('region', { name: 'Domain priority change preview' });
  await expect(preview).toContainText('domain-000.example');
  await expect(preview).toContainText('first-brand');
  await expect(preview).toContainText('second-brand');
  await preview.getByRole('button', { name: 'Apply reviewed context changes' }).click();
  await expect(workspace.getByRole('status').filter({ hasText: 'exact domain contexts changed' })).toContainText('3 exact domain contexts changed');
  const stored = await readBrowserLocalCollection(page, 'watchlists', { minimumRecords: 1 });
  const retained = stored.records[0]!.value.domainMetadata;
  expect(retained.find(row => row.domain === 'domain-000.example')!.contexts[0]!.priority).toBe('p1');
  expect(retained.find(row => row.domain === 'domain-199.example')!.contexts[0]!.priority).toBe('unassigned');
  expect(retained.find(row => row.domain === 'shared.example')!.contexts.map(row => [row.brandProfileId, row.priority])).toEqual([['first-brand', 'p1'], ['second-brand', 'p1']]);
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
