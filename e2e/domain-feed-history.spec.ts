import { expect, test } from './fixtures';
import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import {
  currentBrandProfileBrowserStore,
  expectNoHorizontalOverflow,
  migrateLegacyBrowserData,
  readBrowserLocalCollection,
  useTheme,
} from './helpers';
import { normalizeBrandProfile } from '../packages/workspace/brand-profile-model.mts';
import { reviseBrandKeywordCampaign } from '../packages/workspace/brand-keyword-campaign.mts';
import {
  normalizeDomainFeedSelection,
  scanDomainFeed,
} from '../packages/monitoring/domain-feed.mts';
import {
  domainFeedSelectionDigest,
  type DomainFeedHistoryPage,
} from '../packages/monitoring/domain-feed-history.mts';

const NOW = '2000-01-01T00:00:00.000Z',
  epoch = '00000000-0000-4000-8000-000000000000';
const campaign = reviseBrandKeywordCampaign(
  null,
  {
    id: 'example-launch',
    name: 'Example launch',
    positiveTerms: ['launch'],
    negativeTerms: ['excluded'],
    startsAt: NOW,
    endsAt: '2099-01-01T00:00:00Z',
    paused: false,
    defaultPriority: 'p2',
  },
  null,
  NOW,
);
const profile = normalizeBrandProfile(
  {
    id: 'example-brand',
    name: 'Example Brand',
    keywordCampaigns: [campaign],
    createdAt: NOW,
    updatedAt: NOW,
  },
  { nowIso: NOW },
)!;
const selection = normalizeDomainFeedSelection({ terms: ['launch'], negativeTerms: ['excluded'] });
async function pages() {
  const review = await scanDomainFeed(
    (async function* () {
      yield new TextEncoder().encode('launch.example\nexcluded-launch.example');
    })(),
    { feedId: 'nrd7', selection, importedAt: NOW, acquiredAt: NOW },
  );
  const {
    feedId,
    revision,
    importedAt,
    acquiredAt,
    declaredPublishedAt,
    declaredVersion,
    bytes,
    rows,
  } = review;
  const metadata = {
    feedId,
    revision,
    importedAt,
    acquiredAt,
    declaredPublishedAt,
    declaredVersion,
    bytes,
    rows,
  };
  const first: DomainFeedHistoryPage = {
    feedId,
    epoch,
    through: 2,
    sequence: 1,
    state: 'review',
    review,
    nextCursor: {
      schemaVersion: 1,
      feedId,
      epoch,
      through: 2,
      sequence: 2,
      after: '',
      selectionDigest: domainFeedSelectionDigest(selection),
    },
    editions: [
      { sequence: 1, metadata, membershipRetained: true },
      {
        sequence: 2,
        metadata: { ...metadata, revision: `sha256:${'a'.repeat(64)}` },
        membershipRetained: false,
      },
    ],
    attempts: [
      { at: NOW, outcome: 'updated' },
      { at: '2000-01-02T00:00:00.000Z', outcome: 'failed' },
    ],
    earlierEditionsUnavailable: false,
  };
  const gap: DomainFeedHistoryPage = {
    ...first,
    sequence: 2,
    state: 'gap',
    review: null,
    nextCursor: { ...first.nextCursor, sequence: 3 },
  };
  const complete: DomainFeedHistoryPage = { ...gap, sequence: 3, state: 'complete' };
  return { first, gap, complete };
}
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
  const workspace = page.locator('#brand-candidate-review'),
    intake = workspace.locator('.feed-intake'),
    history = intake.locator('.feed-history');
  await expect(
    workspace.getByRole('heading', { name: 'Candidate review for Example Brand' }),
  ).toBeVisible();
  await intake.locator(':scope > summary').click();
  await intake.getByLabel('Domain feed source').selectOption('nrd7');
  await intake
    .getByRole('combobox', { name: 'Matching intent', exact: true })
    .selectOption(campaign.id);
  await intake.getByText('Optional hosted feed cache', { exact: true }).click();
  await history.locator(':scope > summary').click();
  await expect(
    history.getByRole('button', { name: 'Start retained-edition review' }),
  ).toBeEnabled();
  return { workspace, intake, history };
}

test('retained history explicitly stages campaign nominations, acknowledges gaps and downloads source-bound progress', async ({
  page,
}, testInfo) => {
  const fixture = await pages(),
    requests: Array<Record<string, unknown>> = [],
    targets: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/(lookup|bulk|discover|scheduled-monitor)(?:[/?]|$)/u.test(request.url()))
      targets.push(request.url());
  });
  await page.route('**/api/domain-feed', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    if (body.operation === 'status')
      return route.fulfill({
        json: {
          enabled: true,
          feeds: [{ feedId: 'nrd7', cached: true, stale: true, error: null }],
        },
      });
    const cursor = body.cursor as { sequence: number } | null;
    await route.fulfill({
      json: {
        enabled: true,
        history:
          cursor?.sequence === 2
            ? fixture.gap
            : cursor?.sequence === 3
              ? fixture.complete
              : fixture.first,
      },
    });
  });
  const { workspace, intake, history } = await seed(page);
  expect(requests).toEqual([{ operation: 'status' }]);
  await history.getByRole('button', { name: 'Start retained-edition review' }).click();
  await expect(history.getByRole('status', { name: 'Feed history review status' })).toContainText(
    '1 historical nominations staged',
  );
  expect(requests[1]).toEqual({
    operation: 'history',
    feedIds: ['nrd7'],
    selection: { hosts: [], terms: ['launch'], negativeTerms: ['excluded'] },
    cursor: null,
  });
  await intake.getByRole('checkbox', { name: /^launch\.example/u }).check();
  await intake.getByRole('button', { name: 'Retain selected feed candidates' }).click();
  await expect(intake.getByRole('status', { name: 'Domain feed review status' })).toContainText(
    '1 candidates retained',
  );
  const candidate = (
    await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 })
  ).records[0]!.value.candidateObservations[0]!;
  expect(candidate.matches[0]!.ruleKey).toMatch(/^keyword:example-launch:1:/u);
  expect(candidate.sources[0]!.revision).toBe(fixture.first.review!.revision);
  expect(candidate.sources[0]!.sourceFirstObservedAt).toBeNull();
  await history.getByRole('button', { name: 'Continue after reviewing this page' }).click();
  await expect(history.getByRole('status', { name: 'Feed history review status' })).toContainText(
    'explicit acknowledgement',
  );
  await expect(history).toContainText('Membership for editions 2–2 is unavailable');
  await expect(
    workspace.getByRole('checkbox', { name: 'launch.example', exact: true }),
  ).toBeVisible();
  expect(requests).toHaveLength(3);
  await history.getByText('Dated source editions (2)', { exact: true }).click();
  await history.getByText('Retained refresh outcomes (2)', { exact: true }).click();
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1280, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(
        history.getByRole('button', { name: 'Acknowledge gap and continue' }),
      ).toBeVisible();
      await expect(
        history.getByText('Membership unavailable; metadata only.', { exact: false }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled())
        await history.screenshot({
          path: testInfo.outputPath(`feed-history-${theme}-${width}.png`),
        });
    }
  }
  await history.getByRole('button', { name: 'Acknowledge gap and continue' }).click();
  await expect(history.getByRole('status', { name: 'Feed history review status' })).toContainText(
    'range is complete',
  );
  const download = page.waitForEvent('download');
  await history.getByRole('button', { name: 'Download progress after reviewed page' }).click();
  expect((await download).suggestedFilename()).toBe('whoisleuth-domain-feed-nrd7-cursor.json');
  expect(requests).toHaveLength(4);
  expect(
    (await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 })).records[0]!
      .value.candidateObservations[0],
  ).toEqual(candidate);
  expect(targets).toEqual([]);
});

test('changed matching intent rejects a saved cursor locally and cancels held history replies', async ({
  page,
}) => {
  const fixture = await pages();
  let held: import('@playwright/test').Route | null = null,
    histories = 0;
  await page.route('**/api/domain-feed', async (route) => {
    if (route.request().postDataJSON().operation === 'status')
      return route.fulfill({
        json: {
          enabled: true,
          feeds: [{ feedId: 'nrd7', cached: true, stale: false, error: null }],
        },
      });
    histories++;
    held = route;
  });
  const { intake, history } = await seed(page);
  await history.getByRole('button', { name: 'Start retained-edition review' }).click();
  await expect(history.getByRole('button', { name: 'Cancel history request' })).toBeVisible();
  await history.getByRole('button', { name: 'Cancel history request' }).click();
  await expect(history.getByRole('status', { name: 'Feed history review status' })).toBeFocused();
  await intake.getByRole('combobox', { name: 'Matching intent', exact: true }).selectOption('');
  await intake.getByLabel('Literal Brand terms', { exact: true }).fill('launch');
  await intake.getByLabel('Negative feed literals', { exact: true }).fill('different');
  await history.getByText('Resume from a saved cursor', { exact: true }).click();
  await history
    .getByLabel('Saved feed cursor', { exact: true })
    .fill(JSON.stringify(fixture.first.nextCursor));
  await history.getByRole('button', { name: 'Resume retained-edition review' }).click();
  await expect(history.getByRole('status', { name: 'Feed history review status' })).toContainText(
    'does not match',
  );
  expect(histories).toBe(1);
  const late = held as import('@playwright/test').Route | null;
  if (late) await late.fulfill({ json: { enabled: true, history: fixture.first } }).catch(() => {});
  await expect(intake.getByRole('heading', { name: 'Staged feed nominations' })).toHaveCount(0);
  expect(
    (await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 })).records[0]!
      .value.candidateObservations,
  ).toEqual([]);
});
