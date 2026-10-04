import { createHash } from 'node:crypto';
import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import { expect, test } from './fixtures';
import {
  currentBrandProfileBrowserStore,
  currentBrowserLocalDocument,
  expectNoHorizontalOverflow,
  failNextBrowserLocalCollectionReadAfterWrite,
  migrateLegacyBrowserData,
  readBrowserLocalCollection,
  useTheme,
} from './helpers';
import { normalizeBrandProfile } from '../packages/workspace/brand-profile-model.mts';
import { reviseBrandKeywordCampaign } from '../packages/workspace/brand-keyword-campaign.mts';

const NOW = '2000-01-01T00:00:00.000Z';
const profile = normalizeBrandProfile(
  { id: 'example-brand', name: 'Example Brand', createdAt: NOW, updatedAt: NOW },
  { nowIso: NOW },
)!;
const saved = reviseBrandKeywordCampaign(
  null,
  {
    id: 'example-launch',
    name: 'Example launch',
    positiveTerms: ['launch'],
    negativeTerms: ['excluded'],
    startsAt: NOW,
    endsAt: '2099-01-01T00:00:00.000Z',
    paused: false,
    defaultPriority: 'p2',
  },
  null,
  NOW,
);

async function seed(page: import('@playwright/test').Page, campaigns = [saved]) {
  await page.goto('/brands');
  await migrateLegacyBrowserData(
    page,
    {
      'whois-rdap-brand-profiles-v1': currentBrandProfileBrowserStore([
        { ...profile, keywordCampaigns: campaigns },
      ]),
      'whois-rdap-active-brand-profile-v1': profile.id,
      'whois-rdap-watchlist-v1': currentBrowserLocalDocument('watchlists', {}),
    },
    { clearStorage: true, destination: '/brands' },
  );
  const workspace = page.locator('#brand-candidate-review'),
    panel = workspace.locator('.keyword-campaigns');
  await expect(
    workspace.getByRole('heading', { name: 'Candidate review for Example Brand' }),
  ).toBeVisible();
  await panel.locator(':scope > summary').click();
  return { workspace, panel, intake: workspace.locator('.feed-intake') };
}

test('campaign preview and retained revision preserve exact source provenance and historical Watchlist defaults without collection', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (
      /\/api\/(domain-feed|lookup|bulk|discover|scheduled-monitor)(?:[/?]|$)/u.test(request.url())
    )
      requests.push(request.url());
  });
  const { workspace, panel, intake } = await seed(page, []);
  await panel.getByRole('button', { name: 'New keyword campaign', exact: true }).click();
  await expect(
    panel.getByRole('heading', { name: 'New keyword campaign', exact: true }),
  ).toBeFocused();
  await panel.getByLabel('Campaign name', { exact: true }).fill('Example launch');
  await panel.getByLabel('Positive literal terms', { exact: true }).fill('launch');
  await panel.getByLabel('Negative literal terms', { exact: true }).fill('excluded');
  await panel.getByLabel('Campaign start (explicit timezone)', { exact: true }).fill(NOW);
  await panel
    .getByLabel('Campaign end (explicit timezone)', { exact: true })
    .fill('2099-01-01T00:00:00Z');
  await panel.getByLabel('Default Watchlist review priority').selectOption('p2');
  await panel
    .getByLabel('Example hostnames to preview (optional)')
    .fill(
      'launch.example\nprelaunch.example\nlaunc-h.example\nexcluded-launch.example\n例え.example',
    );
  await panel.getByRole('button', { name: 'Preview keyword campaign', exact: true }).click();
  const preview = panel.getByRole('region', { name: 'Keyword campaign preview' });
  await expect(preview).toContainText('prelaunch.example: literal match: launch');
  await expect(preview).toContainText('launc-h.example: no literal match');
  await expect(preview).toContainText('excluded-launch.example: vetoed by excluded');
  await expect(preview).toContainText('xn--r8jz45g.example: no literal match');
  await panel.getByRole('button', { name: 'Save reviewed campaign revision' }).click();
  await expect(panel.getByRole('status', { name: 'Keyword campaign action status' })).toBeFocused();
  let retained = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  const campaign = retained.records[0]!.value.keywordCampaigns![0]!;
  expect(campaign.revision).toBe(1);
  expect(retained.records[0]!.value.candidateObservations).toEqual([]);
  await intake.locator(':scope > summary').click();
  await intake
    .getByRole('combobox', { name: 'Matching intent', exact: true })
    .selectOption(campaign.id);
  const raw = `${Array.from({ length: 205 }, (_, index) => `excluded-launch-${index}.example`).join('\n')}\nlaunch.example\n`;
  await intake
    .getByLabel('Local domain-only feed file')
    .setInputFiles({ name: 'example-feed.txt', mimeType: 'text/plain', buffer: Buffer.from(raw) });
  await intake.getByRole('button', { name: 'Scan local file', exact: true }).click();
  await expect(intake.getByRole('heading', { name: 'Staged feed nominations' })).toBeFocused();
  await expect(intake.getByRole('checkbox')).toHaveCount(1);
  await intake.getByRole('checkbox', { name: /^launch\.example/u }).check();
  await intake.getByRole('button', { name: 'Retain selected feed candidates' }).click();
  await expect(intake.getByRole('status', { name: 'Domain feed review status' })).toContainText(
    '1 candidates retained',
  );
  retained = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  const candidate = retained.records[0]!.value.candidateObservations[0]!;
  expect(candidate.matches[0]!.ruleKey).toMatch(new RegExp(`^keyword:${campaign.id}:1:`));
  expect(candidate.sources[0]!.revision).toBe(
    `sha256:${createHash('sha256').update(raw).digest('hex')}`,
  );
  expect(candidate.sources[0]!.sourceLastObservedAt).toBeNull();
  await panel.getByRole('button', { name: 'Edit campaign Example launch' }).click();
  await panel.getByLabel('Positive literal terms', { exact: true }).fill('different');
  await panel.getByLabel('Default Watchlist review priority').selectOption('p4');
  await panel.getByRole('button', { name: 'Preview keyword campaign', exact: true }).click();
  await panel.getByRole('button', { name: 'Save reviewed campaign revision' }).click();
  await expect(panel.getByRole('status', { name: 'Keyword campaign action status' })).toContainText(
    'revision 2 saved',
  );
  await expect(intake.getByRole('heading', { name: 'Staged feed nominations' })).toHaveCount(0);
  await workspace.getByRole('checkbox', { name: 'launch.example', exact: true }).check();
  await expect(
    workspace.getByRole('combobox', { name: 'Analyst review priority', exact: true }),
  ).toHaveValue('p2');
  await workspace.getByLabel('Destination watchlist').fill('Example review');
  await workspace
    .getByLabel('Reason', { exact: true })
    .fill('Review this exact retained nomination.');
  await workspace.getByRole('button', { name: 'Preview exact watchlist handoff' }).click();
  await expect(workspace.getByRole('region', { name: 'Watchlist handoff preview' })).toContainText(
    'Additional requests: 0',
  );
  await workspace.getByRole('button', { name: 'Add reviewed domains without collection' }).click();
  await expect(
    workspace.getByRole('status', { name: 'Candidate review action status' }),
  ).toContainText('1 domains retained');
  const watched = (await readBrowserLocalCollection(page, 'watchlists', { minimumRecords: 1 }))
    .records[0]!.value;
  expect(watched.domainMetadata[0]!.contexts[0]!.priority).toBe('p2');
  expect(watched.results).toEqual([]);
  expect(watched.baseline).toEqual([]);
  await page.reload();
  retained = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  expect(retained.records[0]!.value.keywordCampaigns![0]!.history[0]!.positiveTerms).toEqual([
    'launch',
  ]);
  expect(retained.records[0]!.value.candidateObservations[0]).toEqual(candidate);
  expect(requests).toEqual([]);
});

test('paused and expired campaign intent cannot start a feed scan and leaves retained intent readable', async ({
  page,
}) => {
  const paused = reviseBrandKeywordCampaign(saved, { ...saved, paused: true }, 1, NOW);
  const expired = reviseBrandKeywordCampaign(
    null,
    { ...saved, id: 'expired-launch', name: 'Expired launch', endsAt: '2000-02-01T00:00:00Z' },
    null,
    NOW,
  );
  const { intake, panel } = await seed(page, [paused, expired]);
  await intake.locator(':scope > summary').click();
  await intake.getByLabel('Local domain-only feed file').setInputFiles({
    name: 'example-feed.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('launch.example'),
  });
  for (const campaign of [paused, expired]) {
    await intake
      .getByRole('combobox', { name: 'Matching intent', exact: true })
      .selectOption(campaign.id);
    await expect(
      intake.getByRole('button', { name: 'Scan local file', exact: true }),
    ).toBeDisabled();
  }
  await panel.getByRole('button', { name: 'Edit campaign Example launch' }).click();
  await expect(panel.getByLabel('Pause new campaign nominations')).toBeChecked();
  const retained = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  expect(retained.records[0]!.value.candidateObservations).toEqual([]);
});

test('campaign form, example preview and history remain usable in both themes at supported widths', async ({
  page,
}, testInfo) => {
  const { panel } = await seed(page);
  await panel.getByRole('button', { name: 'Edit campaign Example launch' }).click();
  await panel
    .getByLabel('Example hostnames to preview (optional)')
    .fill('launch.example\n例え.example');
  await panel.getByRole('button', { name: 'Preview keyword campaign', exact: true }).click();
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1280, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(panel.getByLabel('Positive literal terms', { exact: true })).toBeVisible();
      await expect(
        panel.getByRole('button', { name: 'Save reviewed campaign revision' }),
      ).toBeVisible();
      await expect(panel.getByRole('region', { name: 'Keyword campaign preview' })).toContainText(
        'xn--r8jz45g.example',
      );
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled())
        await panel.screenshot({
          path: testInfo.outputPath(`keyword-campaign-${theme}-${width}.png`),
        });
    }
  }
});

test('committed campaign refresh failures preserve the draft and disable another write until reload', async ({
  page,
}) => {
  const { panel } = await seed(page);
  await panel.getByRole('button', { name: 'Edit campaign Example launch' }).click();
  await panel.getByLabel('Negative literal terms', { exact: true }).fill('excluded\nretired');
  await panel.getByRole('button', { name: 'Preview keyword campaign', exact: true }).click();
  await failNextBrowserLocalCollectionReadAfterWrite(page, 'brand_profiles');
  await panel.getByRole('button', { name: 'Save reviewed campaign revision' }).click();
  await expect(panel.getByRole('status', { name: 'Keyword campaign action status' })).toContainText(
    'revision was saved, but',
  );
  await expect(panel.getByLabel('Negative literal terms', { exact: true })).toHaveValue(
    'excluded\nretired',
  );
  await expect(
    panel.getByRole('button', { name: 'Preview keyword campaign', exact: true }),
  ).toBeDisabled();
  const retained = await readBrowserLocalCollection(page, 'brand_profiles', { minimumRecords: 1 });
  expect(retained.records[0]!.value.keywordCampaigns![0]!.revision).toBe(2);
  expect(retained.records[0]!.value.keywordCampaigns![0]!.history[0]!.negativeTerms).toEqual([
    'excluded',
  ]);
});
