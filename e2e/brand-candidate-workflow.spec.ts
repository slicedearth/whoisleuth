import { expect, test } from './fixtures';
import {
  currentBrandProfileBrowserStore,
  migrateLegacyBrowserData,
  readBrowserLocalCollection,
  expectNoHorizontalOverflow,
  useTheme,
} from './helpers';
import { openConsoleView } from './console-navigation';
import { normalizeBrandProfile } from '../packages/workspace/brand-profile-model.mts';

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
  await metadata.getByRole('checkbox', { name: 'candidate.example', exact: true }).check();
  await metadata.getByLabel('New analyst priority').selectOption('p1');
  await metadata
    .getByLabel('New watch reason')
    .fill('Deliberately escalate the independent concern.');
  await metadata.getByRole('button', { name: 'Preview selected priority changes' }).click();
  await metadata.getByLabel('New analyst priority').selectOption('p3');
  await expect(
    metadata.getByRole('button', { name: 'Apply reviewed context changes' }),
  ).toHaveCount(0);
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
    await page.setViewportSize({ width: 320, height: 700 });
    await expectNoHorizontalOverflow(page);
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
