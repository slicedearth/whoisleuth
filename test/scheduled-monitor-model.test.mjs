import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALLOWED_SCHEDULE_INTERVAL_HOURS,
  createScheduledWatchlist,
  emptyScheduledMonitorState,
  MAX_SCHEDULED_CHANGES_PER_EVENT,
  MAX_SCHEDULED_DOMAINS,
  MAX_SCHEDULED_HISTORY_EVENTS,
  MAX_SCHEDULED_MONITOR_STATIC_BYTES,
  MAX_SCHEDULED_MONITOR_STORE_BYTES,
  MAX_SCHEDULED_WATCHLIST_INPUTS,
  MAX_SCHEDULED_WATCHLISTS,
  normalizeScheduledMonitorState,
  normalizeScheduledWatchlistName,
  nextScheduledMonitorRevision,
  pruneScheduledMonitorHistoryToStaticBudget,
  scheduledMonitorPublicState,
  SCHEDULED_MONITOR_SCHEMA,
  SCHEDULED_MONITOR_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/scheduled-monitor-model.js';

const NOW = '2026-07-16T08:00:00.000Z';
const WATCHLIST_ID = 'watchlist-00000001';
const RUN_ID = 'active-run-000001';
const LEASE_ID = 'lease-token-00001';

function entry(overrides = {}) {
  return {
    updatedAt: NOW,
    results: [{
      domain: 'alpha.example',
      scanDepth: 'fast',
      availability: 'registered',
      mutationTypes: ['omission'],
    }],
    baseline: [],
    history: [],
    ...overrides,
  };
}

function watchlist(overrides = {}) {
  return createScheduledWatchlist({
    name: 'Priority domains',
    entry: entry(),
    intervalHours: 24,
    now: NOW,
    id: WATCHLIST_ID,
    ...overrides,
  });
}

function state(watchlists = [watchlist()], activeRun = null) {
  return {
    schema: SCHEDULED_MONITOR_SCHEMA,
    version: SCHEDULED_MONITOR_SCHEMA_VERSION,
    watchlists,
    activeRun,
  };
}

test('creates a strict scheduled watchlist from compact authority-aware evidence', () => {
  const source = entry({
    results: [{
      domain: 'HTTPS://ALPHA.EXAMPLE/private',
      scanDepth: 'deep',
      availability: 'registered',
      registrarName: 'Example Registrar',
      mutationTypes: ['OMISSION', 'omission'],
      rawWhois: 'must not be retained',
      unknown: { secret: true },
    }],
    baseline: [{
      domain: 'alpha.example',
      availability: 'registered',
      scanDepth: 'deep',
      rawRdap: { secret: true },
    }],
    privateStoreField: 'drop me',
  });
  const before = structuredClone(source);
  const result = watchlist({ name: '  Priority   domains  ', entry: source });

  assert.deepEqual(source, before);
  assert.equal(result.name, 'Priority domains');
  assert.equal(result.sources[0].domain, 'alpha.example');
  assert.deepEqual(result.sources[0].mutationTypes, ['omission']);
  assert.equal(result.entry.results[0].rawWhois, undefined);
  assert.equal(result.entry.results[0].unknown, undefined);
  assert.equal(result.entry.baseline[0].rawRdap, undefined);
  assert.equal(result.entry.privateStoreField, undefined);
  assert.deepEqual(Object.keys(result).sort(), [
    'createdAt', 'enabled', 'entry', 'id', 'intervalHours', 'lastError', 'lastRunAt',
    'name', 'nextRunAt', 'prunedHistoryEvents', 'revision', 'sources', 'status', 'updatedAt',
  ]);
});

test('validates creation names, identifiers, intervals, timestamps, and domain limits', () => {
  assert.equal(normalizeScheduledWatchlistName('__proto__'), '');
  assert.equal(normalizeScheduledWatchlistName('bad\nname'), '');
  assert.throws(() => watchlist({ name: '__proto__' }), /names must be/i);
  assert.throws(() => watchlist({ id: 'short' }), /identifier is invalid/i);
  assert.throws(() => watchlist({ intervalHours: 48 }), /unsupported scheduled scan interval/i);
  assert.throws(() => watchlist({ now: 'not-a-date' }), /timestamp is invalid/i);
  assert.throws(() => watchlist({ entry: { results: [] } }), /no valid domains/i);
  assert.throws(() => watchlist({
    entry: entry({
      results: Array.from({ length: MAX_SCHEDULED_DOMAINS + 1 }, (_, index) => ({
        domain: `item-${index}.example`,
      })),
    }),
  }), /limited to 100 domains/i);
  assert.deepEqual(ALLOWED_SCHEDULE_INTERVAL_HOURS, [6, 12, 24, 168]);
});

test('uses an explicit identity and rejects missing, unrelated, and future schemas', () => {
  assert.deepEqual(emptyScheduledMonitorState(), {
    schema: 'whoisleuth.scheduled-monitor',
    version: 1,
    watchlists: [],
    activeRun: null,
  });
  assert.throws(() => normalizeScheduledMonitorState(null), /unsupported schema version/i);
  assert.throws(() => normalizeScheduledMonitorState({ version: 1 }), /unsupported schema version/i);
  assert.throws(() => normalizeScheduledMonitorState({
    ...emptyScheduledMonitorState(),
    schema: 'whoisleuth.watchlists',
  }), /unsupported schema version/i);
  assert.throws(() => normalizeScheduledMonitorState({
    ...emptyScheduledMonitorState(),
    version: 2,
  }), /unsupported schema version/i);
});

test('bounds collection recovery and removes duplicate identifiers and names', () => {
  const candidates = Array.from({ length: MAX_SCHEDULED_WATCHLIST_INPUTS + 10 }, (_, index) => ({
    ...watchlist({ name: `List ${index}`, id: `watchlist-${String(index).padStart(8, '0')}` }),
  }));
  candidates[1] = { ...candidates[1], id: candidates[0].id };
  candidates[2] = { ...candidates[2], name: candidates[0].name.toUpperCase() };
  const result = normalizeScheduledMonitorState(state(candidates));
  assert.equal(result.watchlists.length, MAX_SCHEDULED_WATCHLISTS);
  assert.equal(new Set(result.watchlists.map((item) => item.id)).size, MAX_SCHEDULED_WATCHLISTS);
  assert.equal(new Set(result.watchlists.map((item) => item.name.toLowerCase())).size, MAX_SCHEDULED_WATCHLISTS);
});

test('keeps only bounded recent history and discloses newly omitted relevant changes', () => {
  const changes = Array.from({ length: MAX_SCHEDULED_CHANGES_PER_EVENT + 5 }, (_, index) => ({
    domain: 'alpha.example',
    field: 'pageTitle',
    before: `Old ${index}`,
    after: `New ${index}`,
    kind: 'field_changed',
    tone: 'neutral',
    raw: 'drop me',
  }));
  const history = Array.from({ length: MAX_SCHEDULED_HISTORY_EVENTS + 3 }, (_, index) => ({
    checkedAt: `2026-07-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`,
    mode: 'deep',
    resultCount: 1,
    conclusiveCount: 1,
    changeCount: changes.length,
    omittedChanges: 2,
    changes,
  }));
  const result = watchlist({ entry: entry({ history }) });
  const latest = result.entry.history.at(-1);
  assert.equal(result.entry.history.length, MAX_SCHEDULED_HISTORY_EVENTS);
  assert.equal(latest.changes.length, MAX_SCHEDULED_CHANGES_PER_EVENT);
  assert.equal(latest.omittedChanges, 7);
  assert.equal(latest.changeCount, 107);
  assert.equal(latest.changes[0].raw, undefined);
  assert.equal(result.entry.history[0].checkedAt, '2026-07-04T08:00:00.000Z');
});

test('filters baseline and history evidence to the scheduled membership', () => {
  const result = watchlist({ entry: entry({
    results: [{ domain: 'alpha.example', availability: 'registered' }],
    baseline: [
      { domain: 'alpha.example', availability: 'registered' },
      { domain: 'other.example', availability: 'available' },
    ],
    history: [{
      checkedAt: NOW,
      mode: 'fast',
      resultCount: 2,
      conclusiveCount: 2,
      changeCount: 2,
      omittedChanges: 0,
      changes: [
        { domain: 'alpha.example', field: 'availability', before: 'available', after: 'registered' },
        { domain: 'other.example', field: 'availability', before: 'registered', after: 'available' },
      ],
    }],
  }) });
  assert.deepEqual(result.entry.baseline.map((item) => item.domain), ['alpha.example']);
  assert.deepEqual(result.entry.history[0].changes.map((item) => item.domain), ['alpha.example']);
});

test('normalizes disabled and malformed operational fields without inventing activity', () => {
  const source = {
    ...watchlist(),
    enabled: false,
    status: 'running',
    nextRunAt: NOW,
    lastError: ` failed\n${'x'.repeat(500)} `,
    unknown: 'drop me',
  };
  const result = normalizeScheduledMonitorState(state([source])).watchlists[0];
  assert.equal(result.enabled, false);
  assert.equal(result.status, 'paused');
  assert.equal(result.nextRunAt, null);
  assert.equal(result.lastError.includes('\n'), false);
  assert.equal(result.lastError.length, 300);
  assert.equal(result.unknown, undefined);
});

test('retains a consistent active run and derives only bounded public progress', () => {
  const storedWatchlist = watchlist({ entry: entry({
    results: [
      { domain: 'alpha.example', availability: 'registered', mutationTypes: ['omission'] },
      { domain: 'beta.example', availability: 'available', mutationTypes: ['addition'] },
    ],
  }) });
  const activeRun = {
    id: RUN_ID,
    watchlistId: storedWatchlist.id,
    watchlistRevision: storedWatchlist.revision,
    cursor: 1,
    sources: structuredClone(storedWatchlist.sources),
    results: [{
      domain: 'alpha.example',
      availability: 'registered',
      rawWhois: 'drop me',
    }],
    errorCount: 0,
    startedAt: NOW,
    updatedAt: NOW,
    lease: { token: LEASE_ID, cursor: 1, expiresAt: '2026-07-16T08:05:00.000Z', secret: 'drop me' },
    rawQueue: ['drop me'],
  };
  const normalized = normalizeScheduledMonitorState(state([storedWatchlist], activeRun));
  assert.equal(normalized.watchlists[0].status, 'running');
  assert.equal(normalized.activeRun.results[0].rawWhois, undefined);
  assert.deepEqual(normalized.activeRun.lease, {
    token: LEASE_ID,
    cursor: 1,
    expiresAt: '2026-07-16T08:05:00.000Z',
  });
  const publicState = scheduledMonitorPublicState(normalized);
  assert.deepEqual(publicState.watchlists[0].progress, { completed: 1, total: 2 });
  assert.equal(publicState.activeRun, undefined);
  assert.equal(publicState.watchlists[0].sources, undefined);
  assert.equal(publicState.watchlists[0].lease, undefined);
});

test('drops active runs with stale revisions, changed sources, invalid cursors, or misordered results', () => {
  const storedWatchlist = watchlist();
  const base = {
    id: RUN_ID,
    watchlistId: storedWatchlist.id,
    watchlistRevision: storedWatchlist.revision,
    cursor: 1,
    sources: structuredClone(storedWatchlist.sources),
    results: [{ domain: 'alpha.example', availability: 'registered' }],
    errorCount: 0,
    startedAt: NOW,
    updatedAt: NOW,
    lease: null,
  };
  const variants = [
    { ...base, watchlistRevision: 2 },
    { ...base, sources: [{ domain: 'other.example' }] },
    { ...base, cursor: 2 },
    { ...base, results: [{ domain: 'other.example' }] },
  ];
  for (const activeRun of variants) {
    const normalized = normalizeScheduledMonitorState(state([
      { ...storedWatchlist, status: 'running' },
    ], activeRun));
    assert.equal(normalized.activeRun, null);
    assert.equal(normalized.watchlists[0].status, 'idle');
  }
  const orphanedQueue = normalizeScheduledMonitorState(state([
    { ...storedWatchlist, status: 'queued' },
  ], null));
  assert.equal(orphanedQueue.watchlists[0].status, 'idle');
});

test('drops runs for disabled watchlists and releases malformed leases without losing valid progress', () => {
  const storedWatchlist = watchlist();
  const activeRun = {
    id: RUN_ID,
    watchlistId: storedWatchlist.id,
    watchlistRevision: storedWatchlist.revision,
    cursor: 0,
    sources: structuredClone(storedWatchlist.sources),
    results: [],
    errorCount: 0,
    startedAt: NOW,
    updatedAt: NOW,
    lease: { token: LEASE_ID, cursor: 1, expiresAt: '2026-07-16T08:05:00.000Z' },
  };
  const normalized = normalizeScheduledMonitorState(state([storedWatchlist], activeRun));
  assert.ok(normalized.activeRun);
  assert.equal(normalized.activeRun.lease, null);
  assert.equal(normalized.watchlists[0].status, 'queued');

  const disabled = { ...storedWatchlist, enabled: false, status: 'paused' };
  const paused = normalizeScheduledMonitorState(state([disabled], activeRun));
  assert.equal(paused.activeRun, null);
  assert.equal(paused.watchlists[0].status, 'paused');
});

test('rejects oversized normalized stores before encryption', () => {
  const results = Array.from({ length: MAX_SCHEDULED_DOMAINS }, (_, index) => ({
    domain: `item-${index}.example`,
    scanDepth: 'deep',
    availability: 'registered',
    registrarName: 'r'.repeat(300),
    pageTitle: 't'.repeat(200),
    phishingLanguageMatch: 'p'.repeat(200),
    nameservers: Array.from({ length: 12 }, (_, server) => `ns-${server}-${index}.example`),
  }));
  const watchlists = Array.from({ length: MAX_SCHEDULED_WATCHLISTS }, (_, index) => watchlist({
    name: `Large ${index}`,
    id: `watchlist-${String(index).padStart(8, '0')}`,
    entry: entry({ results }),
  }));
  assert.throws(
    () => normalizeScheduledMonitorState(state(watchlists)),
    /scheduled monitoring storage is full/i,
  );
  assert.equal(MAX_SCHEDULED_MONITOR_STORE_BYTES, 1536 * 1024);
});

test('prunes the oldest hosted history with an explicit cumulative count to preserve run headroom', () => {
  const watchlists = Array.from({ length: 4 }, (_, listIndex) => {
    const domain = `history-${listIndex}.example`;
    const changes = Array.from({ length: MAX_SCHEDULED_CHANGES_PER_EVENT }, (_, changeIndex) => ({
      domain,
      field: 'pageTitle',
      before: `before-${changeIndex}-${'b'.repeat(180)}`,
      after: `after-${changeIndex}-${'a'.repeat(182)}`,
      kind: 'field_changed',
      tone: 'neutral',
    }));
    const history = Array.from({ length: MAX_SCHEDULED_HISTORY_EVENTS }, (_, eventIndex) => ({
      checkedAt: `2026-06-${String(eventIndex + 1).padStart(2, '0')}T08:00:00.000Z`,
      mode: 'deep',
      resultCount: 1,
      conclusiveCount: 1,
      changeCount: changes.length,
      omittedChanges: 0,
      changes,
    }));
    return watchlist({
      id: `watchlist-${String(listIndex).padStart(8, '0')}`,
      name: `History ${listIndex}`,
      entry: entry({
        results: [{ domain, availability: 'registered', scanDepth: 'deep' }],
        history,
      }),
    });
  });
  const oversizedStatic = normalizeScheduledMonitorState(state(watchlists));
  assert.ok(new TextEncoder().encode(JSON.stringify(oversizedStatic)).byteLength > MAX_SCHEDULED_MONITOR_STATIC_BYTES);
  const result = pruneScheduledMonitorHistoryToStaticBudget(oversizedStatic);
  assert.ok(result.pruned > 0);
  assert.equal(
    result.state.watchlists.reduce((total, item) => total + item.prunedHistoryEvents, 0),
    result.pruned,
  );
  assert.ok(result.state.watchlists.every((item) => item.entry.history.length >= 1));
  assert.ok(result.state.watchlists.some((item, index) => item.revision > watchlists[index].revision));
  assert.ok(new TextEncoder().encode(JSON.stringify(result.state)).byteLength <= MAX_SCHEDULED_MONITOR_STATIC_BYTES);
  assert.throws(
    () => pruneScheduledMonitorHistoryToStaticBudget({
      ...oversizedStatic,
      activeRun: { id: 'active-run-000001' },
    }),
    /cannot be pruned while a scan is active/i,
  );
  assert.equal(nextScheduledMonitorRevision(1), 2);
  assert.throws(() => nextScheduledMonitorRevision(Number.MAX_SAFE_INTEGER), /revision is invalid or exhausted/i);
});

test('normalization does not mutate authenticated stored input', () => {
  const input = state([{ ...watchlist(), unknown: { secret: true } }]);
  const before = structuredClone(input);
  const result = normalizeScheduledMonitorState(input);
  assert.deepEqual(input, before);
  assert.equal(result.watchlists[0].unknown, undefined);
});
