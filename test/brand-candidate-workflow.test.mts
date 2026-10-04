import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  normalizeCandidateObservation,
  mergeCandidateObservations,
  candidateMaterialFingerprint,
  candidateExceptionState,
  reviseCandidateException,
  mergeWatchDomainMetadata,
  normalizeCandidateExceptions,
} from '../packages/workspace/brand-candidate-workflow.mts';
import {
  applyCandidateWatchHandoff,
  planCandidateWatchHandoff,
  setWatchDomainContexts,
} from '../packages/workspace/candidate-watch-handoff.mts';
import {
  normalizeBrandProfile,
  normalizeBrandProfileStore,
  mergeBrandProfiles,
  buildBrandProfileExport,
} from '../packages/workspace/brand-profile-model.mts';
import {
  normalizeWatchlistStore,
  mergeWatchlistStores,
  buildWatchlistExport,
} from '../packages/workspace/watchlist-store.mts';
import {
  appendWatchlistScan,
  compactWatchlistResults,
} from '../packages/workspace/watchlist-history.mts';
import {
  projectBrandCandidateReview,
  candidateReviewItem,
  scopedCandidateExclusion,
  discoveryCandidateObservation,
} from '../packages/monitoring/brand-candidate-review.mts';
import { projectWatchlistContextReviews } from '../packages/monitoring/watchlist-context-review.mts';
import {
  emptyAnalystReviewStateStore,
  setAnalystReviewDecision,
} from '../packages/monitoring/analyst-review-state.mts';
import { createScheduledWatchlist } from '../packages/monitoring/scheduled-monitor-model.mts';
import { reviewCandidateWatchInput, parseCandidateWatchInput } from '../cli/watchlist-review.mts';
import { runCli } from '../cli/runner.mts';
import { mergeHostedWatchlist } from '../frontend/src/lib/watchlists.ts';

const fixtureText = readFileSync(
  new URL('./fixtures/brand-candidate-workflow/candidate-watch-input-v1.json', import.meta.url),
  'utf8',
);
const fixture = JSON.parse(fixtureText);
const NOW = '2000-01-04T00:00:00.000Z',
  LATER = '2000-01-05T00:00:00.000Z',
  EXPIRY = '2000-02-01T00:00:00.000Z';
const candidate = normalizeCandidateObservation(fixture.selection.candidates[0])!;
const brand = normalizeBrandProfile(
  {
    id: 'example-brand',
    name: 'Example Brand',
    createdAt: NOW,
    updatedAt: NOW,
    candidateObservations: [candidate],
  },
  { nowIso: NOW },
)!;
const input = { ...fixture.selection, candidates: [candidate] };
test('discovery adapter keeps registry nominations distinct and incomplete matching scope eligible', () => {
  const raw = {
    domain: candidate.domain,
    source: 'ns1.example',
    mutationTypes: ['rdap_nameserver_search'],
  };
  const observed = discoveryCandidateObservation(raw, brand, NOW)!;
  assert.equal(observed.sources[0]!.source, 'registry nameserver-search nomination');
  assert.equal(observed.sources[0]!.sourceLastObservedAt, null);
  assert.equal(
    discoveryCandidateObservation(
      { ...raw, mutationTypes: Array.from({ length: 21 }, (_, index) => `rule-${index}`) },
      brand,
      NOW,
    ),
    null,
  );
});
test('omitted hostname material changes invalidate reviewed source provenance without fabricating a revision', () => {
  const raw = {
    domain: candidate.domain,
    source: 'example',
    mutationTypes: ['certificate_search'],
    certificateTransparency: {
      hostnames: Array.from({ length: 13 }, (_, index) => `host-${index}.candidate.example`),
      firstObservedAt: null,
      lastObservedAt: null,
    },
  };
  const first = discoveryCandidateObservation(raw, brand, NOW)!;
  const next = discoveryCandidateObservation(
    {
      ...raw,
      certificateTransparency: {
        ...raw.certificateTransparency,
        hostnames: [
          ...raw.certificateTransparency.hostnames.slice(0, 12),
          'changed.candidate.example',
        ],
      },
    },
    brand,
    LATER,
  )!;
  assert.notEqual(
    candidateMaterialFingerprint(first, brand.id),
    candidateMaterialFingerprint(next, brand.id),
  );
  assert.equal(first.sources[0]!.revision, null);
  assert.match(first.sources[0]!.gap, /content digest/);
});
test('malformed clocks and imported URLs cannot become complete or retained raw provenance', () => {
  const partial = normalizeCandidateObservation({
    ...candidate,
    sources: candidate.sources.map((source) => ({
      ...source,
      completeness: 'complete',
      sourceFirstObservedAt: '2000-01-01T00:00:00',
    })),
  })!;
  assert.equal(partial.sources[0]!.completeness, 'partial');
  assert.equal(partial.sources[0]!.sourceFirstObservedAt, null);
  assert.deepEqual(
    normalizeCandidateObservation({
      ...candidate,
      sources: [{ ...candidate.sources[0]!, source: 'https://source.example/?query=private' }],
    })!.sources,
    [],
  );
  assert.throws(
    () => planCandidateWatchHandoff({}, { ...input, brandProfileId: undefined }),
    /identifier/,
  );
});
function exception(ruleKey = candidate.matches[0]!.ruleKey) {
  return reviseCandidateException(
    null,
    {
      id: 'exception-1',
      domain: candidate.domain,
      ruleKey,
      purpose: 'irrelevant_match',
      reason: 'Exact rule reviewed independently.',
      reviewedAt: NOW,
      expiresAt: EXPIRY,
      reviewedFingerprint: candidateMaterialFingerprint(candidate, brand.id, ruleKey),
      enabled: true,
    },
    null,
  );
}
function watched() {
  return applyCandidateWatchHandoff({}, input, NOW).watchlists;
}

test('a candidate-only watch has provenance but no successful scan, baseline or history', () => {
  const result = watched()['Example review']!;
  assert.equal(result.updatedAt, null);
  assert.deepEqual([result.results, result.baseline, result.history], [[], [], []]);
  assert.equal(
    result.domainMetadata[0]!.candidate!.sources[0]!.observedHostname,
    'login.candidate.example',
  );
  assert.equal(result.domainMetadata[0]!.contexts[0]!.priority, 'p2');
});
test('handoff preview discloses exact partial outcomes and zero requests', () => {
  const plan = planCandidateWatchHandoff(
    {},
    { ...input, candidates: [candidate, candidate, { ...candidate, domain: 'invalid domain' }] },
  );
  assert.deepEqual(
    plan.rows.map((row) => row.state),
    ['add', 'rejected', 'rejected'],
  );
  assert.equal(plan.additionalRequests, 0);
  assert.equal(plan.collectionAuthorised, false);
  assert.equal(
    applyCandidateWatchHandoff({}, { ...input, candidates: [candidate, candidate] }, NOW)
      .watchlists['Example review']!.domainMetadata.length,
    1,
  );
});
test('canonicalised domain selection retains full source hostname separately', () => {
  const value = applyCandidateWatchHandoff(
    {},
    { ...input, candidates: [{ ...candidate, domain: 'CANDIDATE.EXAMPLE.' }] },
    NOW,
  );
  assert.equal(
    value.watchlists['Example review']!.domainMetadata[0]!.candidate!.domain,
    candidate.domain,
  );
});
test('manual priority is preserved by default and requires explicit replacement', () => {
  const local = watched();
  const unchanged = applyCandidateWatchHandoff(
    local,
    { ...input, priority: 'p4', reason: 'Another nomination' },
    LATER,
  ).watchlists;
  assert.equal(unchanged['Example review']!.domainMetadata[0]!.contexts[0]!.priority, 'p2');
  const changed = applyCandidateWatchHandoff(
    local,
    { ...input, priority: 'p4', reason: 'Deliberately revised', replaceExistingContext: true },
    LATER,
  ).watchlists;
  assert.equal(changed['Example review']!.domainMetadata[0]!.contexts[0]!.priority, 'p4');
});
test('preview identity changes for same-priority concurrent reason edits and material provenance', () => {
  const local = watched(),
    before = planCandidateWatchHandoff(local, input);
  const changed = applyCandidateWatchHandoff(
    local,
    { ...input, reason: 'Concurrent independently reviewed reason', replaceExistingContext: true },
    LATER,
  ).watchlists;
  assert.notDeepEqual(planCandidateWatchHandoff(changed, input), before);
  const next = {
    ...candidate,
    sources: candidate.sources.map((source) => ({ ...source, revision: 'changed' })),
  };
  assert.notDeepEqual(planCandidateWatchHandoff(local, { ...input, candidates: [next] }), before);
});
test('hosted restoration preserves exact local Brand contexts and candidate-only domains', () => {
  const local = watched(),
    restored = mergeHostedWatchlist(local, 'EXAMPLE REVIEW', {
      updatedAt: LATER,
      results: [
        {
          domain: 'observed.example',
          scanDepth: 'fast',
          availability: 'registered',
          registrarName: null,
          nameservers: [],
          mutationTypes: [],
          riskModelVersion: null,
          riskScore: null,
        },
      ],
      baseline: [],
      history: [],
    });
  const metadata = restored['Example review']!.domainMetadata;
  assert.deepEqual(
    metadata.find((row) => row.domain === candidate.domain),
    local['Example review']!.domainMetadata[0],
  );
  assert.equal(metadata.length, 2);
});
test('the same domain retains separate Brand reasons and priorities', () => {
  const local = applyCandidateWatchHandoff(
    watched(),
    { ...input, brandProfileId: 'other-brand', priority: 'p1', reason: 'Independent concern' },
    LATER,
  ).watchlists;
  assert.deepEqual(
    local['Example review']!.domainMetadata[0]!.contexts.map((context) => context.priority),
    ['p2', 'p1'],
  );
});
test('context edits fail atomically on stale evidence and preserve other contexts', () => {
  const local = watched(),
    expected = local['Example review']!.domainMetadata[0]!.contexts[0]!;
  const changed = setWatchDomainContexts(local, 'Example review', [
    {
      domain: candidate.domain,
      expected,
      input: { ...expected, priority: 'p1', changedAt: LATER },
    },
  ]);
  assert.throws(
    () =>
      setWatchDomainContexts(changed, 'Example review', [
        {
          domain: candidate.domain,
          expected,
          input: { ...expected, priority: 'p4', changedAt: LATER },
        },
      ]),
    /changed/,
  );
  assert.equal(local['Example review']!.domainMetadata[0]!.contexts[0]!.priority, 'p2');
});
test('unknown or tied context clocks do not replace a local manual override', () => {
  const local = watched()['Example review']!.domainMetadata;
  const incoming = local.map((value) => ({
    ...value,
    contexts: value.contexts.map((context) => ({ ...context, priority: 'p4', changedAt: null })),
  }));
  assert.equal(mergeWatchDomainMetadata(local, incoming)[0]!.contexts[0]!.priority, 'p2');
});
test('independent newer metadata imports without replacing an older scan baseline', () => {
  const local = watched();
  const changed = applyCandidateWatchHandoff(
    local,
    { ...input, priority: 'p1', replaceExistingContext: true },
    LATER,
  ).watchlists;
  const merged = mergeWatchlistStores(local, buildWatchlistExport(changed, LATER));
  assert.equal(merged.watchlists['Example review']!.domainMetadata[0]!.contexts[0]!.priority, 'p1');
  assert.equal(merged.watchlists['Example review']!.updatedAt, null);
});
test('later deliberate scans retain watch reason and candidate provenance', () => {
  const entry = watched()['Example review']!;
  const next = appendWatchlistScan(
    entry,
    [{ domain: candidate.domain, availability: 'registered', scanDepth: 'fast' }],
    { checkedAt: LATER, mode: 'fast' },
  ).entry;
  assert.deepEqual(next.domainMetadata, entry.domainMetadata);
  assert.equal(next.results.length, 1);
});
test('local capture time alone does not resurface a candidate or reset its earliest clock', () => {
  const next = {
    ...candidate,
    sources: candidate.sources.map((source) => ({ ...source, firstLocalObservedAt: LATER })),
  };
  const merged = mergeCandidateObservations(candidate, next)!;
  assert.equal(merged.sources.length, 1);
  assert.equal(merged.sources[0]!.firstLocalObservedAt, candidate.sources[0]!.firstLocalObservedAt);
  assert.equal(
    candidateMaterialFingerprint(candidate, brand.id),
    candidateMaterialFingerprint(next, brand.id),
  );
});
test('source revision changes are material and conflicting rule identities are rejected', () => {
  const changed = normalizeCandidateObservation({
    ...candidate,
    sources: candidate.sources.map((source) => ({ ...source, revision: 'fixture-2' })),
  })!;
  assert.notEqual(
    candidateMaterialFingerprint(candidate, brand.id),
    candidateMaterialFingerprint(changed, brand.id),
  );
  assert.throws(
    () =>
      normalizeCandidateObservation({
        ...candidate,
        matches: [candidate.matches[0], { ...candidate.matches[0], reason: 'Conflicting reason' }],
      }),
    /conflicting/,
  );
  assert.throws(
    () =>
      normalizeCandidateObservation({
        ...candidate,
        sources: Array.from({ length: 13 }, () => candidate.sources[0]),
      }),
    /bound/,
  );
});
test('duplicate selection cannot replace the first previewed candidate provenance', () => {
  const repeated = { ...candidate, sources: candidate.sources.map(source => ({ ...source, revision: 'second-selection' })) };
  const result = applyCandidateWatchHandoff({}, { ...input, candidates: [candidate, repeated] }, NOW);
  assert.equal(result.plan.rows[1]!.state, 'rejected');
  assert.deepEqual(result.watchlists['Example review']!.domainMetadata[0]!.candidate, candidate);
});
test('handoff preview binds review date and replacement authority even for a new destination', () => {
  const before = planCandidateWatchHandoff({}, input);
  const after = planCandidateWatchHandoff({}, { ...input, reviewDueAt: EXPIRY, replaceExistingContext: true });
  assert.notDeepEqual(after, before);
  assert.equal(after.reviewDueAt, EXPIRY);
  assert.equal(after.replaceExistingContext, true);
});
test('scoped exceptions expire and resurface on material source changes', () => {
  const saved = exception();
  assert.equal(candidateExceptionState(saved, candidate, brand.id, LATER), 'active');
  assert.equal(candidateExceptionState(saved, candidate, brand.id, EXPIRY), 'expired');
  assert.equal(
    candidateExceptionState(
      saved,
      {
        ...candidate,
        sources: candidate.sources.map((source) => ({ ...source, revision: 'fixture-2' })),
      },
      brand.id,
      LATER,
    ),
    'changed',
  );
  assert.equal(candidateExceptionState(saved, candidate, 'other-brand', LATER), 'unmatched');
  assert.equal(candidateExceptionState(saved, candidate, brand.id, 'invalid'), 'clock_unavailable');
});
test('an independent matching rule prevents a narrow exception from hiding the candidate', () => {
  const profile = { ...brand, candidateExceptions: [exception()] };
  assert.equal(scopedCandidateExclusion(candidate, profile, LATER)?.kind, 'scoped_exception');
  const next = {
    ...candidate,
    matches: [...candidate.matches, { ...candidate.matches[0]!, ruleKey: 'independent:second' }],
  };
  assert.equal(scopedCandidateExclusion(next, profile, LATER), null);
  assert.equal(
    projectBrandCandidateReview(
      { ...profile, candidateObservations: [next] },
      {},
      undefined,
      LATER,
    )[0]!.status,
    'new',
  );
});
test('exception revisions are reversible, bounded and optimistic', () => {
  let saved = exception();
  for (let index = 0; index < 10; index++)
    saved = reviseCandidateException(
      saved,
      { ...saved, reason: `Reviewed revision ${index}`, enabled: false, reviewedAt: LATER },
      saved.revision,
    );
  assert.equal(saved.history.length, 8);
  assert.equal(saved.historyOmitted, 2);
  assert.equal(candidateExceptionState(saved, candidate, brand.id, EXPIRY), 'disabled');
  assert.throws(() => reviseCandidateException(saved, saved, 1), /changed/);
  assert.throws(
    () => reviseCandidateException(saved, { ...saved, domain: 'other.example' }, saved.revision),
    /widen/,
  );
});
test('conflicting duplicate exception revisions reject both import orders without changing local state', () => {
  const saved = exception();
  const local = [{ ...brand, candidateExceptions: [saved] }];
  const retained = structuredClone(local);
  const conflicting = { ...saved, reason: 'A conflicting exact review decision.' };
  for (const entries of [[saved, conflicting], [conflicting, saved]]) {
    assert.throws(() => normalizeCandidateExceptions(entries), /conflicting decisions/);
    assert.throws(() => mergeBrandProfiles(local, { schema: 'whoisleuth.brand-profiles', version: 10, profiles: [{ ...brand, updatedAt: LATER, candidateExceptions: entries }] }), /conflicting decisions/);
    assert.deepEqual(local, retained);
  }
  assert.deepEqual(normalizeCandidateExceptions([saved, structuredClone(saved)]), [saved]);
  const importedTie = { ...saved, reason: 'A separately imported equal revision.' };
  const merged = mergeBrandProfiles(local, buildBrandProfileExport([{ ...brand, updatedAt: LATER, candidateExceptions: [importedTie] }], LATER));
  assert.deepEqual(merged.profiles[0]!.candidateExceptions, [saved]);
});
test('duplicate exception revisions are checked even behind a newer revision', () => {
  const saved = exception();
  const newer = reviseCandidateException(saved, { ...saved, reviewedAt: LATER }, saved.revision);
  const conflicting = { ...saved, enabled: false };
  assert.throws(() => normalizeCandidateExceptions([newer, saved, conflicting]), /conflicting decisions/);
  assert.throws(() => normalizeCandidateExceptions([conflicting, newer, saved]), /conflicting decisions/);
});
test('renewal and re-enable reject review-clock rollback while disabling preserves its guard', () => {
  const initial = exception();
  const saved = reviseCandidateException(initial, { ...initial, reviewedAt: LATER }, initial.revision);
  assert.throws(() => reviseCandidateException(saved, { ...saved, reviewedAt: NOW, expiresAt: '2000-03-01T00:00:00.000Z' }, saved.revision), /review clock precedes/);
  const disabled = reviseCandidateException(saved, { ...saved, reviewedAt: NOW, enabled: false }, saved.revision);
  assert.equal(disabled.reviewedAt, LATER);
  assert.equal(candidateExceptionState(disabled, candidate, brand.id, NOW), 'disabled');
  assert.throws(() => reviseCandidateException(disabled, { ...disabled, reviewedAt: NOW, enabled: true }, disabled.revision), /review clock precedes/);
  const enabled = reviseCandidateException(disabled, { ...disabled, reviewedAt: LATER, enabled: true }, disabled.revision);
  assert.equal(candidateExceptionState(enabled, candidate, brand.id, NOW), 'clock_unavailable');
  assert.equal(candidateExceptionState(enabled, candidate, brand.id, LATER), 'active');
});
test('context edits beyond the first render page preserve exact Brand identities and other contexts', () => {
  const context = { brandProfileId: null, priority: 'unassigned' as const, reason: '', changedAt: null, reviewDueAt: null };
  const domains = Array.from({ length: 201 }, (_, index) => ({ domain: `domain-${String(index).padStart(3, '0')}.example`, contexts: [context], candidate: null }));
  const shared = { domain: 'shared.example', contexts: [{ ...context, brandProfileId: 'first-brand' }, { ...context, brandProfileId: 'second-brand' }], candidate: null };
  const entry = { updatedAt: null, results: [], baseline: [], history: [], domainMetadata: [...domains, shared] };
  const edits = [
    { domain: domains[200]!.domain, expected: context, input: { ...context, priority: 'p2' as const, reason: 'Reviewed beyond the first page.', changedAt: NOW } },
    ...shared.contexts.map(expected => ({ domain: shared.domain, expected, input: { ...expected, priority: 'p1' as const, reason: 'Reviewed this exact Brand context.', changedAt: NOW } })),
  ];
  const updated = setWatchDomainContexts({ Paged: entry }, 'Paged', edits).Paged!;
  assert.equal(updated.domainMetadata[200]!.contexts[0]!.priority, 'p2');
  assert.equal(updated.domainMetadata[0]!.contexts[0]!.priority, 'unassigned');
  assert.deepEqual(updated.domainMetadata.at(-1)!.contexts.map(value => [value.brandProfileId, value.priority]), [['first-brand', 'p1'], ['second-brand', 'p1']]);
  assert.equal(updated.updatedAt, null);
});
test('candidate dismissals are Brand-specific and resurface on expiry or material provenance', () => {
  const item = candidateReviewItem(candidate, brand, NOW);
  const state = setAnalystReviewDecision(emptyAnalystReviewStateStore(), item, {
    disposition: 'suppressed',
    rationale: 'Deferred exact candidate assessment.',
    expiresAt: EXPIRY,
    reviewedAt: NOW,
  });
  assert.equal(projectBrandCandidateReview(brand, {}, state, LATER)[0]!.status, 'deferred');
  assert.equal(projectBrandCandidateReview(brand, {}, state, EXPIRY)[0]!.status, 'new');
  const changed = {
    ...candidate,
    sources: candidate.sources.map((source) => ({ ...source, revision: 'new' })),
  };
  assert.equal(
    projectBrandCandidateReview(
      { ...brand, candidateObservations: [changed] },
      {},
      state,
      LATER,
    )[0]!.status,
    'new',
  );
});
test('candidate projections show unknown source time rather than substituting local retention', () => {
  const withoutClock = {
    ...candidate,
    sources: candidate.sources.map((source) => ({
      ...source,
      sourceFirstObservedAt: null,
      sourceLastObservedAt: null,
    })),
  };
  assert.equal(candidateReviewItem(withoutClock, brand, NOW).observedAt, '');
  assert.equal(candidateReviewItem(withoutClock, brand, NOW).completeness, 'partial');
});
test('historical Brand fixtures migrate without invented provenance or review decisions', () => {
  for (const version of [6, 7, 8, 9]) {
    const raw = JSON.parse(
      readFileSync(
        new URL(`./fixtures/workspace-lifecycle/browser-brand-v${version}.json`, import.meta.url),
        'utf8',
      ),
    );
    assert.deepEqual(normalizeBrandProfileStore(raw).profiles, []);
    assert.throws(
      () => normalizeBrandProfileStore({ ...raw, profiles: [{ ...brand }] }),
      /schema 10/,
    );
  }
  assert.deepEqual(
    normalizeBrandProfileStore({
      version: 9,
      profiles: [{ id: brand.id, name: brand.name, createdAt: NOW, updatedAt: NOW }],
    }).profiles[0]!.candidateObservations,
    [],
  );
  assert.equal(
    normalizeBrandProfileStore(buildBrandProfileExport([brand], NOW)).profiles[0]!
      .candidateObservations[0]!.domain,
    candidate.domain,
  );
});
test('Brand import cannot reassign candidate decisions to a same-name different identifier', () => {
  assert.throws(
    () =>
      mergeBrandProfiles(
        [{ ...brand, id: 'local-brand' }],
        buildBrandProfileExport([brand], LATER),
      ),
    /another Brand identifier/,
  );
});
test('Brand import cannot repurpose an existing exact exception identifier', () => {
  const saved = exception();
  assert.throws(
    () => mergeBrandProfiles(
      [{ ...brand, candidateExceptions: [saved] }],
      buildBrandProfileExport([{ ...brand, updatedAt: LATER, candidateExceptions: [{ ...saved, revision: saved.revision + 1, purpose: 'deferred_review' }] }], LATER),
    ),
    /scope or purpose/,
  );
});
test('historical Watchlist fixtures migrate to unassigned context without new scalar meaning', () => {
  for (const version of [2, 3, 4]) {
    const raw = JSON.parse(
      readFileSync(
        new URL(
          `./fixtures/workspace-lifecycle/browser-watchlist-v${version}.json`,
          import.meta.url,
        ),
        'utf8',
      ),
    );
    assert.deepEqual(normalizeWatchlistStore(raw).watchlists, {});
    assert.throws(() => normalizeWatchlistStore({ ...raw, watchlists: watched() }), /schema 5/);
    assert.throws(
      () =>
        normalizeWatchlistStore({
          ...raw,
          watchlists: {
            legacy: { results: [{ domain: candidate.domain, hasExternalPasswordForm: false }] },
          },
        }),
      /schema 5/,
    );
  }
  const legacy = normalizeWatchlistStore({
    schema: 'whoisleuth.watchlists',
    version: 4,
    watchlists: { legacy: { results: [{ domain: candidate.domain }] } },
  }).watchlists.legacy!;
  assert.equal(legacy.results[0]!.hasExternalPasswordForm, null);
  assert.deepEqual(legacy.domainMetadata[0]!.contexts[0], {
    brandProfileId: null,
    priority: 'unassigned',
    reason: '',
    changedAt: null,
    reviewDueAt: null,
  });
});
test('nullable external password-form attribution remains local and hosted projection is explicit', () => {
  for (const value of [true, false, null])
    assert.equal(
      compactWatchlistResults([{ domain: candidate.domain, hasExternalPasswordForm: value }])[0]!
        .hasExternalPasswordForm,
      value,
    );
  const entry = appendWatchlistScan(
    watched()['Example review']!,
    [{ domain: candidate.domain, hasExternalPasswordForm: true }],
    { checkedAt: NOW },
  ).entry;
  const hosted = createScheduledWatchlist({
    id: 'watchlist-example-1',
    name: 'Example review',
    entry,
    intervalHours: 24,
    now: NOW,
  });
  assert.equal(Object.hasOwn(hosted.entry, 'domainMetadata'), false);
  assert.equal(Object.hasOwn(hosted.entry.results[0]!, 'hasExternalPasswordForm'), false);
  assert.equal(Object.hasOwn(hosted.entry.baseline[0]!, 'hasExternalPasswordForm'), false);
});
test('score-only and candidate-only updates do not create contextual activation reviews', () => {
  assert.deepEqual(projectWatchlistContextReviews(watched(), NOW).items, []);
  const first = appendWatchlistScan(
    watched()['Example review']!,
    [{ domain: candidate.domain, availability: 'registered', riskScore: 10 }],
    { checkedAt: NOW },
  ).entry;
  const next = appendWatchlistScan(
    first,
    [{ domain: candidate.domain, availability: 'registered', riskScore: 80 }],
    { checkedAt: LATER },
  ).entry;
  assert.deepEqual(projectWatchlistContextReviews({ 'Example review': next }, LATER).items, []);
});
test('comparable delegation changes produce per-context activation without automatic priority writes', () => {
  const first = appendWatchlistScan(
    watched()['Example review']!,
    [{ domain: candidate.domain, availability: 'registered', nameservers: 'ns1.example' }],
    { checkedAt: NOW },
  ).entry;
  const next = appendWatchlistScan(
    first,
    [{ domain: candidate.domain, availability: 'registered', nameservers: 'ns2.example' }],
    { checkedAt: LATER },
  ).entry;
  const items = projectWatchlistContextReviews({ 'Example review': next }, LATER).items;
  assert.equal(items.length, 1);
  assert.match(items[0]!.detail, /nameservers/);
  assert.equal(next.domainMetadata[0]!.contexts[0]!.priority, 'p2');
  assert.equal(
    projectWatchlistContextReviews({ 'Example review': next }, EXPIRY).items[0]!
      .materialFingerprint,
    items[0]!.materialFingerprint,
  );
});
test('offline fixture plan and portable export never require a Lookup result', () => {
  assert.equal(parseCandidateWatchInput(fixtureText).schema, fixture.schema);
  const plan = reviewCandidateWatchInput(fixtureText, 'plan', NOW) as ReturnType<
    typeof planCandidateWatchHandoff
  >;
  assert.equal(plan.additionalRequests, 0);
  const exported = reviewCandidateWatchInput(fixtureText, 'export', NOW) as ReturnType<
    typeof buildWatchlistExport
  >;
  assert.equal(exported.version, 6);
  assert.deepEqual(exported.watchlists['Example review']!.baseline, []);
  assert.throws(() => parseCandidateWatchInput({ ...fixture, version: 2 }), /schema 1/);
  assert.throws(
    () =>
      parseCandidateWatchInput({
        ...fixture,
        selection: { ...fixture.selection, scanDepth: 'deep' },
      }),
    /undeclared/,
  );
});
test('installed command dispatch keeps candidate review offline with truthful per-row outcomes', async () => {
  let stdout = '',
    stderr = '';
  const code = await runCli(['watchlist-review', 'plan', 'selection.json', '--json'], {
    now: () => NOW,
    stdout: {
      write(value: string) {
        stdout += value;
      },
    },
    stderr: {
      write(value: string) {
        stderr += value;
      },
    },
    readArtifactInput: (source) => {
      assert.equal(source, 'selection.json');
      return fixtureText;
    },
    runUnifiedLookup: () => assert.fail('Offline review must not collect evidence.'),
  });
  assert.equal(code, 0, stderr);
  assert.equal(JSON.parse(stdout).additionalRequests, 0);
});
