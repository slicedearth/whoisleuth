import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  attributeKeywordCampaignCandidate,
  brandKeywordCampaignState,
  keywordCampaignDefaultPriority,
  keywordCampaignFeedSelection,
  keywordCampaignMatchContext,
  matchBrandKeywordTerms,
  mergeBrandKeywordCampaigns,
  normalizeBrandKeywordCampaigns,
  normalizeBrandKeywordTerms,
  reviseBrandKeywordCampaign,
  type BrandKeywordCampaignInput,
} from '../packages/workspace/brand-keyword-campaign.mts';
import {
  buildBrandProfileExport,
  mergeBrandProfiles,
  normalizeBrandProfile,
  normalizeBrandProfileStore,
  serializeBrandProfileStore,
} from '../packages/workspace/brand-profile-model.mts';
import { mergeCandidateObservations } from '../packages/workspace/brand-candidate-workflow.mts';
import {
  applyCandidateWatchHandoff,
  planCandidateWatchHandoff,
} from '../packages/workspace/candidate-watch-handoff.mts';
import {
  normalizeDomainFeedSelection,
  scanDomainFeed,
} from '../packages/monitoring/domain-feed.mts';
import {
  keywordCampaignDraft,
  previewKeywordCampaignDraft,
  previewKeywordCampaignHosts,
} from '../frontend/src/lib/controllers/brand-keyword-campaign.ts';

const NOW = '2000-01-03T00:00:00.000Z',
  LATER = '2000-01-04T00:00:00.000Z',
  END = '2000-02-01T00:00:00.000Z';
const input: BrandKeywordCampaignInput = {
  id: 'launch-review',
  name: 'Example launch review',
  positiveTerms: ['launch'],
  negativeTerms: ['excluded'],
  startsAt: NOW,
  endsAt: END,
  paused: false,
  defaultPriority: 'p2',
};
const campaign = reviseBrandKeywordCampaign(null, input, null, NOW);
const profile = normalizeBrandProfile(
  {
    id: 'example-brand',
    name: 'Example Brand',
    createdAt: NOW,
    updatedAt: NOW,
    keywordCampaigns: [campaign],
  },
  { nowIso: NOW },
)!;
async function nominations(value = campaign, raw = 'launch.example\nexcluded-launch.example\n') {
  const result = await scanDomainFeed(
    (async function* () {
      yield new TextEncoder().encode(raw);
    })(),
    {
      feedId: 'nrd7',
      selection: normalizeDomainFeedSelection(
        keywordCampaignFeedSelection(value, profile.id, LATER),
      ),
      importedAt: LATER,
    },
  );
  return {
    result,
    candidate: attributeKeywordCampaignCandidate(
      result.matches[0]!.candidate,
      value,
      profile.id,
      LATER,
    ),
  };
}

test('campaign literals are bounded, normalised and literal rather than regex, token, typo or IDN expansion', () => {
  assert.deepEqual(normalizeBrandKeywordTerms(['Launch', 'launch', '.*x']), ['launch', '.*x']);
  for (const value of [
    null,
    ['ab'],
    [' term'],
    ['term\n'],
    ['a'.repeat(81)],
    Array(21).fill('launch'),
  ])
    assert.throws(() => normalizeBrandKeywordTerms(value));
  assert.equal(matchBrandKeywordTerms('prelaunch.example', ['launch']).matched, true);
  assert.equal(matchBrandKeywordTerms('launc-h.example', ['launch']).matched, false);
  assert.equal(matchBrandKeywordTerms('launch.example', ['.*x']).matched, false);
  assert.equal(matchBrandKeywordTerms('xn--r8jz45g.example', ['例え.']).matched, false);
  assert.equal(matchBrandKeywordTerms('xn--r8jz45g.example', ['r8j']).matched, true);
  assert.deepEqual(matchBrandKeywordTerms('excluded-launch.example', ['launch'], ['excluded']), {
    terms: ['launch'],
    excludedTerms: ['excluded'],
    matched: false,
  });
  assert.throws(
    () => reviseBrandKeywordCampaign(null, { ...input, positiveTerms: [] }, null, NOW),
    /positive/u,
  );
  assert.throws(
    () => reviseBrandKeywordCampaign(null, { ...input, negativeTerms: ['LAUNCH'] }, null, NOW),
    /both positive and negative/u,
  );
});

test('campaign windows use explicit clocks, include the start, exclude the end, and cannot authorise requests', () => {
  const scheduled = reviseBrandKeywordCampaign(null, { ...input, startsAt: LATER }, null, NOW);
  assert.equal(brandKeywordCampaignState(scheduled, NOW), 'scheduled');
  assert.equal(brandKeywordCampaignState(scheduled, LATER), 'active');
  assert.equal(brandKeywordCampaignState(scheduled, END), 'expired');
  assert.equal(brandKeywordCampaignState(scheduled, '1999-01-01T00:00:00Z'), 'clock_unavailable');
  assert.equal(brandKeywordCampaignState(scheduled, 'bad'), 'clock_unavailable');
  const paused = reviseBrandKeywordCampaign(scheduled, { ...scheduled, paused: true }, 1, LATER);
  assert.equal(brandKeywordCampaignState(paused, LATER), 'paused');
  for (const [value, now] of [
    [scheduled, NOW],
    [scheduled, END],
    [paused, LATER],
  ] as const)
    assert.throws(() => keywordCampaignFeedSelection(value, profile.id, now), /active campaign/u);
  assert.deepEqual(keywordCampaignFeedSelection(campaign, profile.id, NOW), {
    hosts: [],
    terms: ['launch'],
    negativeTerms: ['excluded'],
    brandProfileId: profile.id,
  });
  for (const patch of [
    { startsAt: '2000-01-01' },
    { endsAt: NOW },
    { defaultPriority: 'critical' },
  ])
    assert.throws(() =>
      reviseBrandKeywordCampaign(
        null,
        { ...input, ...patch } as BrandKeywordCampaignInput,
        null,
        NOW,
      ),
    );
});

test('edits retain immutable bounded history, reject stale editors and rollbacks, and disclose omissions', () => {
  let current = campaign;
  for (let index = 2; index <= 11; index++)
    current = reviseBrandKeywordCampaign(
      current,
      { ...current, name: `Review ${index}`, paused: index % 2 === 0 },
      current.revision,
      LATER,
    );
  assert.equal(current.revision, 11);
  assert.equal(current.history.length, 8);
  assert.equal(current.historyOmitted, 2);
  assert.deepEqual(
    current.history.map((value) => value.revision),
    [10, 9, 8, 7, 6, 5, 4, 3],
  );
  assert.equal(campaign.revision, 1);
  assert.deepEqual(campaign.history, []);
  assert.throws(() => reviseBrandKeywordCampaign(current, input, 1, LATER), /changed/u);
  assert.throws(() => reviseBrandKeywordCampaign(current, input, 11, NOW), /clock/u);
  assert.throws(
    () => reviseBrandKeywordCampaign(current, { ...input, id: 'different' }, 11, LATER),
    /changed/u,
  );
  assert.throws(
    () => normalizeBrandKeywordCampaigns([{ ...current, historyOmitted: 0 }]),
    /omissions/u,
  );
  assert.throws(
    () =>
      normalizeBrandKeywordCampaigns([{ ...current, history: Array(9).fill(current.history[0]) }]),
    /eight/u,
  );
});

test('campaign merges check conflicting equal revisions even behind newer intent and preserve older copies', () => {
  const second = reviseBrandKeywordCampaign(
    campaign,
    { ...input, defaultPriority: 'p3' },
    1,
    LATER,
  );
  assert.deepEqual(mergeBrandKeywordCampaigns([second], [campaign]), [second]);
  assert.deepEqual(mergeBrandKeywordCampaigns([campaign], [second]), [second]);
  const conflict = { ...campaign, defaultPriority: 'p1' };
  for (const entries of [
    [second, conflict],
    [conflict, second],
  ])
    assert.throws(() => normalizeBrandKeywordCampaigns(entries), /conflicting intent/u);
  assert.throws(
    () =>
      mergeBrandKeywordCampaigns([campaign], [{ ...campaign, createdAt: '2000-01-02T00:00:00Z' }]),
    /creation identity/u,
  );
  assert.throws(
    () =>
      normalizeBrandKeywordCampaigns(
        Array.from({ length: 21 }, (_, i) => ({ ...campaign, id: `campaign-${i}` })),
      ),
    /20/u,
  );
  assert.throws(
    () =>
      mergeBrandKeywordCampaigns(
        Array.from({ length: 20 }, (_, i) => ({ ...campaign, id: `campaign-${i}` })),
        [campaign],
      ),
    /no campaign was discarded/u,
  );
});

test('Brand schema 11 preserves older envelopes without inventing campaigns and rejects epoch laundering', () => {
  assert.deepEqual(JSON.parse(serializeBrandProfileStore([profile])).profiles[0].keywordCampaigns, [
    campaign,
  ]);
  assert.equal(buildBrandProfileExport([profile], NOW).version, 11);
  for (const version of [6, 7, 8, 9, 10]) {
    const legacy = {
      version,
      profiles: [{ id: profile.id, name: profile.name, createdAt: NOW, updatedAt: NOW }],
    };
    assert.deepEqual(normalizeBrandProfileStore(legacy).profiles[0]!.keywordCampaigns, []);
    assert.throws(
      () =>
        normalizeBrandProfileStore({
          ...legacy,
          profiles: [{ ...legacy.profiles[0], keywordCampaigns: [] }],
        }),
      /schema 11/u,
    );
    assert.throws(
      () =>
        mergeBrandProfiles([], {
          ...legacy,
          schema: 'whoisleuth.brand-profiles',
          profiles: [{ ...legacy.profiles[0], keywordCampaigns: [campaign] }],
        }),
      /schema 11/u,
    );
  }
  assert.throws(
    () => normalizeBrandProfileStore({ version: 12, profiles: [profile] }),
    /unsupported/u,
  );
  for (const name of ['browser-brand-v10', 'portable-brand-v10']) {
    const historical = JSON.parse(
      readFileSync(new URL(`./fixtures/workspace-lifecycle/${name}.json`, import.meta.url), 'utf8'),
    );
    assert.equal(historical.version, 10);
    assert.deepEqual(normalizeBrandProfileStore(historical).profiles, []);
  }
});

test('Brand import combines exact campaign revisions independent of profile timestamps without reassigning Brand identity', () => {
  const second = reviseBrandKeywordCampaign(campaign, { ...input, paused: true }, 1, LATER);
  const incoming = { ...profile, keywordCampaigns: [second] };
  const merged = mergeBrandProfiles([profile], buildBrandProfileExport([incoming], LATER));
  assert.deepEqual(merged.profiles[0]!.keywordCampaigns, [second]);
  assert.equal(merged.updated, 1);
  assert.deepEqual(
    mergeBrandProfiles([incoming], buildBrandProfileExport([profile], LATER)).profiles[0]!
      .keywordCampaigns,
    [second],
  );
  assert.deepEqual(normalizeBrandProfileStore([incoming, profile]).profiles[0]!.keywordCampaigns, [
    second,
  ]);
  assert.deepEqual(
    normalizeBrandProfile({ ...profile, keywordCampaigns: [] }, { existing: incoming })!
      .keywordCampaigns,
    [second],
  );
  const conflicting = {
    ...profile,
    keywordCampaigns: [{ ...campaign, name: 'Conflicting intent' }],
  };
  assert.throws(
    () => mergeBrandProfiles([incoming], buildBrandProfileExport([conflicting], LATER)),
    /conflicting intent/u,
  );
  assert.throws(() => normalizeBrandProfileStore([incoming, conflicting]), /conflicting intent/u);
  assert.throws(
    () => normalizeBrandProfile(conflicting, { existing: incoming }),
    /conflicting intent/u,
  );
  assert.throws(
    () =>
      mergeBrandProfiles(
        [profile],
        buildBrandProfileExport([{ ...incoming, id: 'different-brand' }], LATER),
      ),
    /another Brand identifier/u,
  );
  assert.deepEqual(profile.keywordCampaigns, [campaign]);
});

test('local campaign attribution retains exact source edition and old default priority without rewriting nominations', async () => {
  const { result, candidate } = await nominations();
  assert.equal(result.matches.length, 1);
  assert.deepEqual(candidate.sources, result.matches[0]!.candidate.sources);
  assert.equal(candidate.sources[0]!.sourceFirstObservedAt, null);
  assert.match(candidate.matches[0]!.ruleKey, /^keyword:launch-review:1:[a-f0-9]{24}$/u);
  assert.equal(
    keywordCampaignMatchContext(candidate.matches[0]!.ruleKey, [campaign])!.revision.revision,
    1,
  );
  const second = reviseBrandKeywordCampaign(
    campaign,
    { ...input, positiveTerms: ['different'], defaultPriority: 'p4' },
    1,
    LATER,
  );
  assert.equal(keywordCampaignDefaultPriority([candidate], profile.id, [second]), 'p2');
  assert.equal(
    keywordCampaignDefaultPriority([result.matches[0]!.candidate], profile.id, [second]),
    null,
  );
  assert.equal(keywordCampaignDefaultPriority([candidate], profile.id, []), null);
  assert.equal(
    keywordCampaignMatchContext('keyword:launch-review:1:000000000000000000000000', [campaign]),
    null,
  );
  assert.throws(
    () => attributeKeywordCampaignCandidate(candidate, campaign, profile.id, END),
    /active/u,
  );
  assert.throws(
    () => attributeKeywordCampaignCandidate(candidate, second, profile.id, LATER),
    /does not qualify/u,
  );
  assert.throws(
    () =>
      attributeKeywordCampaignCandidate(
        { ...candidate, domain: 'excluded-launch.example' },
        campaign,
        profile.id,
        LATER,
      ),
    /does not qualify/u,
  );
});

test('campaign watch defaults stay drafts, preserve manual context and never create evidence or collection', async () => {
  const { candidate } = await nominations();
  const proposed = {
    name: 'Example review',
    candidates: [candidate],
    brandProfileId: profile.id,
    priority: keywordCampaignDefaultPriority([candidate], profile.id, [campaign])!,
    reason: 'Review supplied exact nomination.',
  };
  const plan = planCandidateWatchHandoff({}, proposed);
  assert.equal(plan.additionalRequests, 0);
  assert.equal(plan.collectionAuthorised, false);
  const first = applyCandidateWatchHandoff({}, { ...proposed, priority: 'p1' }, NOW);
  const next = applyCandidateWatchHandoff(first.watchlists, proposed, LATER);
  const entry = next.watchlists['Example review']!;
  assert.equal(entry.domainMetadata[0]!.contexts[0]!.priority, 'p1');
  assert.deepEqual(entry.results, []);
  assert.deepEqual(entry.baseline, []);
  assert.deepEqual(entry.history, []);
  assert.deepEqual(entry.domainMetadata[0]!.candidate!.sources, candidate.sources);
});

test('campaign source and match provenance capacity rejects rather than silently dropping attribution', async () => {
  const { candidate } = await nominations();
  const full = {
    ...candidate,
    sources: Array.from({ length: 12 }, (_, i) => ({
      ...candidate.sources[0]!,
      revision: `edition-${i}`,
    })),
  };
  assert.throws(() => mergeCandidateObservations(full, candidate), /capacity|provenance|sources/u);
  const previous = {
    ...candidate,
    matches: Array.from({ length: 20 }, (_, i) => ({
      ...candidate.matches[0]!,
      ruleKey: `earlier:${i}`,
    })),
  };
  assert.throws(
    () => mergeCandidateObservations(previous, candidate),
    /capacity|provenance|matches/u,
  );
});

test('campaign form preview is detached, uses existing exact Brand preview semantics and exposes literal limits', () => {
  const draft = keywordCampaignDraft(campaign, campaign.id, NOW);
  const reviewed = previewKeywordCampaignDraft(draft, campaign, LATER);
  draft.positive = 'different';
  assert.deepEqual(reviewed.input.positiveTerms, ['launch']);
  const rows = previewKeywordCampaignHosts(
    'launch.example\nprelaunch.example\nlaunc-h.example\nexcluded-launch.example\n例え.example',
    reviewed.campaign,
    { ...profile, officialDomains: ['launch.example'] },
    LATER,
  );
  assert.deepEqual(
    rows.map((row) => row.matched),
    [true, true, false, false, false],
  );
  assert.equal(rows[0]!.declaration?.kind, 'official');
  assert.equal(rows.at(-1)!.domain, 'xn--r8jz45g.example');
  assert.equal(rows[3]!.excludedTerms[0], 'excluded');
  assert.equal(
    previewKeywordCampaignHosts('launch.example', reviewed.campaign, profile, END)[0]!.active,
    false,
  );
  assert.throws(
    () =>
      previewKeywordCampaignHosts('https://launch.example/path', reviewed.campaign, profile, LATER),
    /valid domain/u,
  );
  assert.throws(
    () =>
      previewKeywordCampaignHosts(
        Array.from({ length: 21 }, (_, i) => `launch-${i}.example`).join('\n'),
        reviewed.campaign,
        profile,
        LATER,
      ),
    /20 example/u,
  );
  assert.throws(
    () => previewKeywordCampaignDraft({ ...draft, positive: 'x'.repeat(1621) }, campaign, LATER),
    /bounded/u,
  );
});

test('retained literal quality cases agree between campaign preview and streaming feed selection', async () => {
  const cases = JSON.parse(
    readFileSync(
      new URL('./fixtures/brand-candidate-workflow/keyword-literal-cases.json', import.meta.url),
      'utf8',
    ),
  ) as Array<{
    case: string;
    positive: string[];
    negative: string[];
    hostname: string;
    expected: boolean;
  }>;
  assert.equal(cases.length, 10);
  for (const value of cases) {
    const campaign = reviseBrandKeywordCampaign(
      null,
      { ...input, positiveTerms: value.positive, negativeTerms: value.negative },
      null,
      NOW,
    );
    const preview = previewKeywordCampaignHosts(value.hostname, campaign, profile, LATER);
    const review = await scanDomainFeed(
      (async function* () {
        yield new TextEncoder().encode(value.hostname);
      })(),
      {
        feedId: 'tif-mini',
        selection: normalizeDomainFeedSelection(
          keywordCampaignFeedSelection(campaign, profile.id, LATER),
        ),
        importedAt: LATER,
      },
    );
    assert.equal(preview[0]!.matched, value.expected, value.case);
    assert.equal(review.matches.length === 1, value.expected, value.case);
  }
});

test('untrusted campaign arrays reject accessors, custom prototypes and lowercasing expansion before using their contents', () => {
  let invoked = false;
  const literals: string[] = [];
  Object.defineProperty(literals, '0', {
    configurable: true,
    enumerable: true,
    get() {
      invoked = true;
      return 'launch';
    },
  });
  assert.throws(() => normalizeBrandKeywordTerms(literals), /accessor/u);
  assert.equal(invoked, false);
  const malicious = Object.assign([campaign], {
    map() {
      invoked = true;
      return [];
    },
  });
  assert.throws(() => normalizeBrandKeywordCampaigns(malicious), /custom array/u);
  assert.equal(invoked, false);
  assert.throws(() => normalizeBrandKeywordTerms(['İ'.repeat(80)]), /Lowercased/u);
});
