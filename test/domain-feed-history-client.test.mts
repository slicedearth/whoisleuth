import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeDomainFeedSelection,
  scanDomainFeed,
  type DomainFeedReview,
} from '../packages/monitoring/domain-feed.mts';
import {
  domainFeedSelectionDigest,
  type DomainFeedHistoryPage,
} from '../packages/monitoring/domain-feed-history.mts';
import {
  queryDomainFeedHistory,
  type PreparedDomainFeedHistory,
} from '../frontend/src/lib/domain-feed-client.ts';
import {
  DomainFeedHistoryController,
  parseDomainFeedHistoryCursor,
  type DomainFeedHistoryState,
} from '../frontend/src/lib/controllers/domain-feed-history.ts';

const NOW = '2000-01-01T00:00:00.000Z',
  LATER = '2000-01-02T00:00:00.000Z';
const selected = normalizeDomainFeedSelection({
  terms: ['launch'],
  negativeTerms: ['excluded'],
  brandProfileId: 'local-example-brand',
});
const epoch = '00000000-0000-4000-8000-000000000000';
async function sourceReview() {
  return scanDomainFeed(
    (async function* () {
      yield new TextEncoder().encode('launch.example\nexcluded-launch.example\n');
    })(),
    {
      feedId: 'nrd7',
      selection: normalizeDomainFeedSelection({ terms: ['launch'], negativeTerms: ['excluded'] }),
      importedAt: NOW,
      acquiredAt: NOW,
    },
  );
}
function history(review: DomainFeedReview): DomainFeedHistoryPage {
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
  return {
    feedId,
    epoch,
    through: 1,
    sequence: 1,
    state: 'review',
    review,
    nextCursor: {
      schemaVersion: 1,
      feedId,
      epoch,
      through: 1,
      sequence: 2,
      after: '',
      selectionDigest: domainFeedSelectionDigest(selected),
    },
    editions: [
      {
        sequence: 1,
        metadata: {
          feedId,
          revision,
          importedAt,
          acquiredAt,
          declaredPublishedAt,
          declaredVersion,
          bytes,
          rows,
        },
        membershipRetained: true,
      },
    ],
    attempts: [
      { at: NOW, outcome: 'updated' },
      { at: LATER, outcome: 'failed' },
    ],
    earlierEditionsUnavailable: false,
  };
}
async function prepared(): Promise<PreparedDomainFeedHistory> {
  const page = history(await sourceReview());
  return queryDomainFeedHistory(
    'nrd7',
    selected,
    null,
    new AbortController().signal,
    async () => Response.json({ enabled: true, history: page }),
    LATER,
  );
}

test('explicit retained-history query sends only selectors and cursor and reconstructs local attribution separately', async () => {
  const page = history(await sourceReview());
  let sent: unknown;
  const result = await queryDomainFeedHistory(
    'nrd7',
    selected,
    null,
    new AbortController().signal,
    async (_url, init) => {
      sent = JSON.parse(init!.body as string);
      return Response.json({ enabled: true, history: page });
    },
    LATER,
  );
  assert.deepEqual(sent, {
    operation: 'history',
    feedIds: ['nrd7'],
    selection: { hosts: [], terms: ['launch'], negativeTerms: ['excluded'] },
    cursor: null,
  });
  assert.equal(JSON.stringify(sent).includes('local-example-brand'), false);
  assert.equal(result.history.review?.selection.brandProfileId, null);
  assert.equal(result.history.review?.importedAt, NOW);
  assert.equal(
    result.prepared?.candidates[0]?.candidate.matches[0]?.brandProfileId,
    'local-example-brand',
  );
  assert.equal(result.prepared?.candidates[0]?.candidate.sources[0]?.firstLocalObservedAt, LATER);
  assert.equal(result.prepared?.candidates[0]?.candidate.sources[0]?.sourceLastObservedAt, null);
  assert.equal(
    result.prepared?.candidates[0]?.candidate.sources[0]?.revision,
    page.review?.revision,
  );
  assert.deepEqual(result.history.attempts, page.attempts);
});

test('saved cursors reject changed rules, sources and oversized text before a request', async () => {
  const page = history(await sourceReview());
  let requests = 0;
  assert.deepEqual(
    parseDomainFeedHistoryCursor(JSON.stringify(page.nextCursor), 'nrd7', selected),
    page.nextCursor,
  );
  assert.throws(() => parseDomainFeedHistoryCursor('x'.repeat(4097), 'nrd7', selected), /4,096/u);
  assert.throws(() => parseDomainFeedHistoryCursor('[]', 'nrd7', selected), /cursor/u);
  assert.throws(
    () =>
      parseDomainFeedHistoryCursor(
        JSON.stringify(page.nextCursor),
        'nrd7',
        normalizeDomainFeedSelection({ ...selected, negativeTerms: ['different'] }),
      ),
    /rules/u,
  );
  assert.throws(
    () => parseDomainFeedHistoryCursor(JSON.stringify(page.nextCursor), 'tif-mini', selected),
    /rules/u,
  );
  await assert.rejects(
    queryDomainFeedHistory(
      'nrd7',
      normalizeDomainFeedSelection({ terms: ['different'] }),
      page.nextCursor,
      new AbortController().signal,
      async () => {
        requests++;
        return Response.json({ enabled: true, history: page });
      },
    ),
    /rules/u,
  );
  assert.equal(requests, 0);
});

test('history continuation binds the requested edition, epoch and prior hostname position', async () => {
  const page = history(await sourceReview());
  const reply = async () => Response.json({ enabled: true, history: page });
  await assert.rejects(
    queryDomainFeedHistory('nrd7', selected, page.nextCursor, new AbortController().signal, reply),
    /does not continue/u,
  );
  const previous = { ...page.nextCursor, sequence: 1, after: 'launch.example' };
  await assert.rejects(
    queryDomainFeedHistory('nrd7', selected, previous, new AbortController().signal, reply),
    /does not continue/u,
  );
  await assert.rejects(
    queryDomainFeedHistory(
      'nrd7',
      selected,
      { ...previous, after: '', epoch: '11111111-1111-4111-8111-111111111111' },
      new AbortController().signal,
      reply,
    ),
    /does not continue/u,
  );
  const cancelled = new AbortController();
  cancelled.abort();
  let fetched = false;
  await assert.rejects(
    queryDomainFeedHistory('nrd7', selected, null, cancelled.signal, async () => {
      fetched = true;
      return Response.json({});
    }),
    /cancelled/u,
  );
  assert.equal(fetched, false);
});

test('gaps and complete pages retain explicit state without fabricating empty membership or local nominations', async () => {
  const base = history(await sourceReview());
  for (const state of ['gap', 'complete'] as const) {
    const page: DomainFeedHistoryPage = {
      ...base,
      state,
      sequence: state === 'complete' ? 2 : 1,
      review: null,
      editions: base.editions.map((value) => ({
        ...value,
        membershipRetained: state === 'complete',
      })),
    };
    const result = await queryDomainFeedHistory(
      'nrd7',
      selected,
      state === 'complete' ? base.nextCursor : null,
      new AbortController().signal,
      async () => Response.json({ enabled: true, history: page }),
    );
    assert.equal(result.history.state, state);
    assert.equal(result.prepared, null);
  }
  await assert.rejects(
    queryDomainFeedHistory('nrd7', selected, null, new AbortController().signal, async () =>
      Response.json({
        enabled: true,
        history: { ...base, state: 'complete', sequence: 2, review: null },
      }),
    ),
    /oldest available/u,
  );
});

test('history controller rejects late replies after selector edits, cancellation and newer requests', async () => {
  const page = await prepared();
  let context = 'brand:campaign:1',
    state: DomainFeedHistoryState | undefined;
  const held: Array<{ resolve: (value: PreparedDomainFeedHistory) => void; signal: AbortSignal }> =
      [],
    staged: unknown[] = [];
  const controller = new DomainFeedHistoryController({
    context: () => context,
    publish: (value) => {
      state = value;
    },
    stage: (value) => {
      staged.push(value);
    },
    query: async (_feed, _selection, _cursor, signal) =>
      new Promise((resolve) => {
        held.push({ resolve, signal });
      }),
  });
  const first = controller.load('nrd7', selected, null);
  context = 'brand:campaign:2';
  controller.changed();
  held[0]!.resolve(page);
  await first;
  assert.equal(held[0]!.signal.aborted, true);
  assert.equal(state?.page, null);
  assert.deepEqual(staged, []);
  const second = controller.load('nrd7', selected, null);
  controller.cancel();
  held[1]!.resolve(page);
  await second;
  assert.equal(state?.page, null);
  assert.deepEqual(staged, []);
  const third = controller.load('nrd7', selected, null),
    fourth = controller.load('nrd7', selected, null);
  held[2]!.resolve(page);
  await third;
  assert.deepEqual(staged, []);
  held[3]!.resolve(page);
  await fourth;
  assert.equal(staged.length, 1);
  assert.equal(state?.page, page);
  assert.equal(state?.busy, false);
  controller.dispose();
});

test('failed requests and failed nomination staging cannot advance the last reviewed page or cursor', async () => {
  const page = await prepared();
  let state: DomainFeedHistoryState | undefined,
    failure = '',
    calls = 0;
  const controller = new DomainFeedHistoryController({
    context: () => 'unchanged',
    publish: (value) => {
      state = value;
    },
    stage: () => {
      if (failure === 'stage') throw new Error('Campaign revision changed');
    },
    query: async () => {
      calls++;
      if (failure === 'request') throw new Error('Unavailable retained source');
      return page;
    },
  });
  await controller.load('nrd7', selected, null);
  assert.equal(state?.page, page);
  for (const value of ['request', 'stage']) {
    failure = value;
    await controller.load('nrd7', selected, page.history.nextCursor);
    assert.equal(state?.page, page);
    assert.equal(state?.page?.history.nextCursor, page.history.nextCursor);
    assert.match(state?.message ?? '', /cursor is unchanged/u);
    assert.equal(state?.busy, false);
  }
  assert.equal(calls, 3);
  controller.dispose();
});
