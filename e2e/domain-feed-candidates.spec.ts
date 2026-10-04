import { createHash } from 'node:crypto';
import { expect, test } from './fixtures';
import { currentBrandProfileBrowserStore, currentBrowserLocalDocument, expectNoHorizontalOverflow, migrateLegacyBrowserData, openBrandProfileList, readBrowserLocalCollection, useTheme } from './helpers';
import { normalizeBrandProfile } from '../packages/workspace/brand-profile-model.mts';
import { scanDomainFeed, normalizeDomainFeedSelection } from '../packages/monitoring/domain-feed.mts';
import { openConsoleView } from './console-navigation';

const NOW = '2000-01-01T00:00:00.000Z';
const profile = normalizeBrandProfile({ id: 'example-profile', name: 'Example profile', createdAt: NOW, updatedAt: NOW }, { nowIso: NOW })!;
const raw = 'login.product.example\nother-product.example\nunrelated.example\n';
const digest = `sha256:${createHash('sha256').update(raw).digest('hex')}`;

async function seed(page: import('@playwright/test').Page, profiles = [profile]) {
  await page.goto('/brands');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-brand-profiles-v1': currentBrandProfileBrowserStore(profiles),
    'whois-rdap-active-brand-profile-v1': profile.id,
    'whois-rdap-watchlist-v1': currentBrowserLocalDocument('watchlists', { 'Example review': { updatedAt: null, results: [], baseline: [], history: [], domainMetadata: [{ domain: 'existing.example', candidate: null, contexts: [{ brandProfileId: null, priority: 'unassigned', reason: '', changedAt: null, reviewDueAt: null }] }] } }),
  }, { clearStorage: true, destination: '/brands' });
  const workspace = page.locator('#brand-candidate-review');
  await expect(workspace.getByRole('heading', { name: 'Candidate review for Example profile' })).toBeVisible();
  await workspace.getByText('Review domain feed candidates', { exact: true }).click();
  const intake = workspace.locator('.feed-intake');
  await expect(intake.getByLabel('Local domain-only feed file')).toBeEnabled();
  return { workspace, intake };
}

test('manual streamed import stages selected exact nominations and retains provenance through Monitor without feed or target requests', async ({ page }) => {
  const unexpected: string[] = [];
  page.on('request', (request) => { if (/\/api\/(domain-feed|lookup|bulk|discover|scheduled-monitor)(?:[/?]|$)/u.test(request.url())) unexpected.push(request.url()); });
  const { workspace, intake } = await seed(page);
  await intake.getByLabel('Literal Brand terms').fill('product');
  await intake.getByLabel('Local domain-only feed file').setInputFiles({ name: 'example-feed.txt', mimeType: 'text/plain', buffer: Buffer.from(raw) });
  await expect(intake.getByLabel('Local domain-only feed file')).toHaveValue('');
  await intake.getByRole('button', { name: 'Scan local file', exact: true }).click();
  await expect(intake.getByRole('heading', { name: 'Staged feed nominations' })).toBeFocused();
  await expect(intake).toContainText(digest);
  const before = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  expect(before.records[0]!.value.candidateObservations).toEqual([]);
  await intake.getByRole('checkbox', { name: /^login\.product\.example/u }).check();
  await intake.getByRole('button', { name: 'Retain selected feed candidates' }).click();
  await expect(intake.getByRole('status', { name: 'Domain feed review status' })).toContainText('1 candidates retained');
  await expect(workspace.getByRole('checkbox', { name: 'login.product.example', exact: true })).toBeEnabled();
  const retained = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  const candidates = retained.records[0]!.value.candidateObservations;
  expect(candidates).toHaveLength(1);
  expect(candidates[0]!.domain).toBe('login.product.example');
  expect(candidates[0]!.sources[0]!.observedHostname).toBe('login.product.example');
  expect(candidates[0]!.sources[0]!.revision).toBe(digest);
  expect(candidates[0]!.sources[0]!.sourceLastObservedAt).toBeNull();
  expect(JSON.stringify(retained.records)).not.toContain('example-feed.txt');
  expect(JSON.stringify(retained.records)).not.toContain('unrelated.example');
  await workspace.getByRole('checkbox', { name: 'login.product.example', exact: true }).check();
  await workspace.getByLabel('Destination watchlist').fill('Example review');
  await workspace.getByLabel('Reason', { exact: true }).fill('Review the exact independently supplied nomination.');
  await workspace.getByLabel('Analyst review priority').selectOption('p2');
  await workspace.getByRole('button', { name: 'Preview exact watchlist handoff' }).click();
  await workspace.getByRole('button', { name: 'Add reviewed domains without collection' }).click();
  await expect(workspace.getByRole('status', { name: 'Candidate review action status' })).toContainText('1 domains retained');
  const watched = await readBrowserLocalCollection(page, 'watchlists', { minimumRecords: 1 });
  expect(watched.records[0]!.value.domainMetadata.map((row) => row.domain).sort()).toEqual(['existing.example', 'login.product.example']);
  const added = watched.records[0]!.value.domainMetadata.find((row) => row.domain === 'login.product.example')!;
  expect(added.candidate!.sources[0]!.revision).toBe(digest);
  expect(added.contexts[0]!.priority).toBe('p2');
  expect(watched.records[0]!.value.results).toEqual([]);
  expect(watched.records[0]!.value.baseline).toEqual([]);
  expect(watched.records[0]!.value.history).toEqual([]);
  await page.goto('/monitor');
  await openConsoleView(page, 'watchlists');
  await page.getByRole('row', { name: /Example review/u }).getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.locator('.domain-metadata')).toContainText('login.product.example');
  expect(unexpected).toEqual([]);
});

test('optional service status is explicit and disabled configuration does not gate manual import', async ({ page }) => {
  const requests: unknown[] = [];
  await page.route('**/api/domain-feed', async (route) => { requests.push(route.request().postDataJSON()); await route.fulfill({ json: { enabled: false, feeds: [] } }); });
  const { intake } = await seed(page);
  expect(requests).toEqual([]);
  await intake.getByText('Optional hosted feed cache', { exact: true }).click();
  await expect(intake).toContainText('Not enabled by the operator');
  expect(requests).toEqual([{ operation: 'status' }]);
  await expect(intake.getByRole('button', { name: 'Query selected feed cache' })).toBeDisabled();
  await intake.getByLabel('Exact hostnames').fill('login.product.example');
  await intake.getByLabel('Local domain-only feed file').setInputFiles({ name: 'example-feed.txt', mimeType: 'text/plain', buffer: Buffer.from(raw) });
  await intake.getByRole('button', { name: 'Scan local file', exact: true }).click();
  await expect(intake.getByRole('heading', { name: 'Staged feed nominations' })).toBeVisible();
  expect(requests).toEqual([{ operation: 'status' }]);
  await intake.getByLabel('Exact hostnames').fill('different.example');
  await expect(intake.getByRole('heading', { name: 'Staged feed nominations' })).toHaveCount(0);
  await expect(intake.getByRole('button', { name: 'Retain selected feed candidates' })).toHaveCount(0);
});

test('feed selection, metadata and controls remain usable at supported widths and both themes', async ({ page }) => {
  const { intake } = await seed(page);
  await intake.getByLabel('Exact hostnames').fill('login.product.example');
  await intake.getByLabel('Local domain-only feed file').setInputFiles({ name: 'example-feed.txt', mimeType: 'text/plain', buffer: Buffer.from(raw) });
  await intake.getByRole('button', { name: 'Scan local file', exact: true }).click();
  await expect(intake.getByRole('heading', { name: 'Staged feed nominations' })).toBeVisible();
  await intake.getByText('Source details and coverage', { exact: true }).click();
  await expect(intake.getByText(digest, { exact: true })).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(intake.getByLabel('Exact hostnames')).toBeVisible();
      await expect(intake.getByRole('checkbox', { name: /^login\.product\.example/u })).toBeVisible();
      await expect(intake.getByRole('button', { name: 'Retain selected feed candidates' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  }
});

test('cancel and profile changes terminate held local workers and reject their late replies', async ({ page }) => {
  const { intake } = await seed(page, [profile, { ...profile, id: 'second-profile', name: 'Second profile' }]);
  const probe = await page.evaluateHandle(() => {
    const NativeWorker = window.Worker;
    const held: Array<() => void> = [];
    let created = 0, terminated = 0;
    window.Worker = class extends NativeWorker {
      private tracked: boolean;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.tracked = options?.name === 'domain-feed-review';
        if (!this.tracked) return;
        created++;
        const post = this.postMessage.bind(this);
        this.postMessage = (message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) => { held.push(() => { post(message, transfer as StructuredSerializeOptions); }); };
      }
      override terminate() { if (this.tracked) terminated++; super.terminate(); }
    };
    return { counts: () => ({ created, terminated, held: held.length }), release: () => { while (held.length) held.shift()?.(); }, restore: () => { window.Worker = NativeWorker; } };
  });
  try {
    await intake.getByLabel('Exact hostnames').fill('login.product.example');
    await intake.getByLabel('Local domain-only feed file').setInputFiles({ name: 'example-feed.txt', mimeType: 'text/plain', buffer: Buffer.from(raw) });
    await intake.getByRole('button', { name: 'Scan local file', exact: true }).click();
    await expect(intake.getByRole('progressbar', { name: 'Domain feed review in progress' })).toBeVisible();
    await intake.getByRole('button', { name: 'Cancel feed review' }).click();
    await expect(intake.getByRole('status', { name: 'Domain feed review status' })).toBeFocused();
    expect(await probe.evaluate((value) => value.counts())).toEqual({ created: 1, terminated: 1, held: 1 });
    await intake.getByLabel('Local domain-only feed file').setInputFiles({ name: 'replacement.txt', mimeType: 'text/plain', buffer: Buffer.from(raw) });
    await intake.getByRole('button', { name: 'Scan local file', exact: true }).click();
    await expect(intake.getByRole('progressbar', { name: 'Domain feed review in progress' })).toBeVisible();
    await openBrandProfileList(page);
    await page.getByRole('radio', { name: 'Set Second profile active' }).check();
    await expect(page.getByRole('heading', { name: 'Candidate review for Second profile' })).toBeVisible();
    expect(await probe.evaluate((value) => value.counts())).toEqual({ created: 2, terminated: 2, held: 2 });
    await probe.evaluate((value) => value.release());
    await expect(page.getByRole('heading', { name: 'Staged feed nominations' })).toHaveCount(0);
    const retained = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 2 });
    expect(retained.records.every((row) => row.value.candidateObservations.length === 0)).toBe(true);
  } finally { await probe.evaluate((value) => value.restore()); await probe.dispose(); }
});

test('explicit hosted cache query retains locally attributed nominations without transmitting Brand identity', async ({ page }) => {
  const serverReview = await scanDomainFeed((async function* () { yield Buffer.from(raw); })(), { feedId: 'tif-mini', selection: normalizeDomainFeedSelection({ hosts: ['login.product.example'] }), importedAt: NOW, acquiredAt: NOW });
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/domain-feed', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    await route.fulfill({ json: body.operation === 'status'
      ? { enabled: true, feeds: [{ feedId: 'tif-mini', cached: true, stale: true, error: null, metadata: serverReview, checkedAt: NOW }] }
      : { enabled: true, feeds: [{ feedId: 'tif-mini', stale: true, review: serverReview, error: 'Latest refresh failed; retained snapshot is available.' }], limitations: ['Cache lookup is not target collection.'] } });
  });
  const { intake } = await seed(page);
  await intake.getByLabel('Exact hostnames').fill('login.product.example');
  await intake.getByText('Optional hosted feed cache', { exact: true }).click();
  await expect(intake.getByRole('button', { name: 'Query selected feed cache' })).toBeEnabled();
  expect(requests).toEqual([{ operation: 'status' }]);
  await intake.getByRole('button', { name: 'Query selected feed cache' }).click();
  await expect(intake.getByRole('heading', { name: 'Staged feed nominations' })).toBeVisible();
  await expect(intake).toContainText('The retained feed cache is stale');
  await expect(intake.getByText('The latest refresh failed. These candidates come from the last retained snapshot.', { exact: true })).toBeVisible();
  expect(requests[1]).toEqual({ operation: 'query', feedIds: ['tif-mini'], selection: { hosts: ['login.product.example'], terms: [] } });
  const before = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  expect(before.records[0]!.value.candidateObservations).toEqual([]);
  await intake.getByRole('checkbox', { name: /^login\.product\.example/u }).check();
  await intake.getByRole('button', { name: 'Retain selected feed candidates' }).click();
  await expect(intake.getByRole('status', { name: 'Domain feed review status' })).toContainText('1 candidates retained');
  const after = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  const candidate = after.records[0]!.value.candidateObservations[0]!;
  expect(candidate.matches[0]!.brandProfileId).toBe(profile.id);
  expect(candidate.sources[0]!.revision).toBe(digest);
  expect(candidate.sources[0]!.sourceLastObservedAt).toBeNull();
  expect(candidate.sources[0]!.firstLocalObservedAt).not.toBe(NOW);
});

test('a full Brand candidate store rejects an additional nomination without evicting retained candidates', async ({ page }) => {
  const full = normalizeBrandProfile({ ...profile, candidateObservations: Array.from({ length: 200 }, (_, index) => ({
    domain: `candidate-${index}.example`,
    matches: [{ brandProfileId: profile.id, ruleKey: 'keyword:candidate', term: 'candidate', reason: 'Existing retained matching context.' }],
    sources: [{ source: 'Existing retained fixture', revision: null, observedHostname: `candidate-${index}.example`, sourceFirstObservedAt: null, sourceLastObservedAt: null, firstLocalObservedAt: NOW, completeness: 'unknown', gap: 'Per-host source time is unknown.' }],
  })) }, { nowIso: NOW })!;
  const { intake } = await seed(page, [full]);
  await intake.getByLabel('Exact hostnames').fill('login.product.example');
  await intake.getByLabel('Local domain-only feed file').setInputFiles({ name: 'example-feed.txt', mimeType: 'text/plain', buffer: Buffer.from(raw) });
  await intake.getByRole('button', { name: 'Scan local file', exact: true }).click();
  await expect(intake.getByRole('heading', { name: 'Staged feed nominations' })).toBeVisible();
  const before = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  await intake.getByRole('checkbox', { name: /^login\.product\.example/u }).check();
  await intake.getByRole('button', { name: 'Retain selected feed candidates' }).click();
  await expect(intake.getByRole('status', { name: 'Domain feed review status' })).toContainText('0 candidates retained; 1 rejected');
  const after = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  expect(after.records[0]!.value.candidateObservations).toEqual(before.records[0]!.value.candidateObservations);
  expect(after.records[0]!.value.candidateObservations).toHaveLength(200);
});
