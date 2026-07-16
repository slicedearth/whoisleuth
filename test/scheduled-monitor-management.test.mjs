import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMITTED_LOOKUPS_PER_WEEK,
  applyScheduledMonitorCommand,
  CAPACITY_RESERVE_PERCENT,
  createScheduledMonitorManager,
  MANAGEMENT_ERROR_CODES,
  scheduledMonitorCapacity,
  THEORETICAL_LOOKUPS_PER_WEEK,
} from '../lib/scheduled-monitor-management.mts';
import {
  createScheduledWatchlist,
  emptyScheduledMonitorState,
  MAX_SCHEDULED_WATCHLISTS,
  normalizeScheduledMonitorState,
} from '../frontend/src/lib/analysis/scheduled-monitor-model.js';

const NOW_MS = Date.parse('2026-07-16T12:00:00.000Z');
const NOW = new Date(NOW_MS).toISOString();

function entry(domains = ['alpha.invalid']) {
  return {
    updatedAt: NOW,
    results: domains.map((domain) => ({
      domain,
      scanDepth: 'fast',
      availability: 'registered',
      mutationTypes: ['omission'],
    })),
    baseline: [],
    history: [],
  };
}

function watchlist({
  id = 'watchlist-00000001',
  name = 'Priority domains',
  domains = ['alpha.invalid'],
  intervalHours = 24,
  now = NOW,
} = {}) {
  return createScheduledWatchlist({ id, name, entry: entry(domains), intervalHours, now });
}

function state(watchlists = [], activeRun = null) {
  return normalizeScheduledMonitorState({
    ...emptyScheduledMonitorState(),
    watchlists,
    activeRun,
  });
}

class MemoryRepository {
  constructor(initial = state()) {
    this.state = structuredClone(initial);
    this.writes = 0;
  }

  async read() {
    return structuredClone(this.state);
  }

  async update(mutator) {
    const outcome = await mutator(structuredClone(this.state));
    if (outcome.changed !== false) {
      this.state = normalizeScheduledMonitorState(outcome.state);
      this.writes += 1;
    }
    return { state: structuredClone(this.state), result: outcome.result };
  }
}

function manager(initial = state(), overrides = {}) {
  const repository = new MemoryRepository(initial);
  let sequence = 0;
  return {
    repository,
    manager: createScheduledMonitorManager({
      repository,
      now: () => NOW_MS,
      randomUUID: () => `generated-${String(++sequence).padStart(8, '0')}`,
      ...overrides,
    }),
  };
}

function managementCode(code) {
  return (error) => {
    assert.equal(error.code, code);
    return true;
  };
}

test('reports exact weekly capacity with a fixed reserve and excludes paused watchlists', () => {
  const sixHourly = watchlist({
    domains: Array.from({ length: 100 }, (_, index) => `item-${index}.invalid`),
    intervalHours: 6,
  });
  const paused = { ...watchlist({ id: 'watchlist-00000002', name: 'Paused' }), enabled: false };
  const capacity = scheduledMonitorCapacity(state([sixHourly, paused]));

  assert.equal(THEORETICAL_LOOKUPS_PER_WEEK, 4032);
  assert.equal(ADMITTED_LOOKUPS_PER_WEEK, 3024);
  assert.equal(CAPACITY_RESERVE_PERCENT, 25);
  assert.deepEqual(capacity, {
    version: 1,
    triggerIntervalMinutes: 5,
    lookupLimitPerInvocation: 2,
    theoreticalLookupsPerWeek: 4032,
    admittedLookupsPerWeek: 3024,
    projectedLookupsPerWeek: 2800,
    remainingLookupsPerWeek: 224,
    utilizationPercent: 92.59,
    reservePercent: 25,
  });
});

test('reads only bounded public state and capacity without operational leases', async () => {
  const item = watchlist();
  const activeRun = {
    id: 'active-run-000001',
    watchlistId: item.id,
    watchlistRevision: item.revision,
    cursor: 0,
    sources: [{ domain: 'alpha.invalid' }],
    results: [],
    errorCount: 0,
    startedAt: NOW,
    updatedAt: NOW,
    lease: null,
  };
  const harness = manager(state([item], activeRun));
  const result = await harness.manager.read();

  assert.equal(result.state.watchlists[0].name, 'Priority domains');
  assert.deepEqual(result.state.watchlists[0].progress, { completed: 0, total: 1 });
  assert.equal(result.state.activeRun, undefined);
  assert.equal(result.state.watchlists[0].sources, undefined);
  assert.equal(result.capacity.projectedLookupsPerWeek, 7);
  assert.equal(harness.repository.writes, 0);
});

test('creates a normalized scheduled watchlist and drops unknown compact evidence', async () => {
  const harness = manager();
  const result = await harness.manager.execute({
    action: 'create',
    name: '  Priority   domains  ',
    intervalHours: 12,
    entry: entry(['HTTPS://ALPHA.INVALID/private']),
  });

  assert.equal(result.action, 'created');
  assert.equal(result.id, 'generated-00000001');
  assert.equal(result.state.watchlists[0].name, 'Priority domains');
  assert.equal(result.state.watchlists[0].entry.results[0].domain, 'alpha.invalid');
  assert.equal(result.state.watchlists[0].entry.results[0].rawWhois, undefined);
  assert.equal(result.capacity.projectedLookupsPerWeek, 14);
  assert.equal(harness.repository.writes, 1);
});

test('rejects malformed commands, unknown fields, invalid names, identifiers, and intervals', async () => {
  const harness = manager(state([watchlist()]));
  const invalid = [
    null,
    {},
    { action: 'unknown' },
    { action: 'create', name: 'New', entry: entry(), intervalHours: 24, extra: true },
    { action: 'create', name: 'bad\nname', entry: entry(), intervalHours: 24 },
    { action: 'update', id: 'watchlist-00000001' },
    { action: 'update', id: 'short', enabled: false },
    { action: 'update', id: 'watchlist-00000001', intervalHours: 48 },
    { action: 'update', id: 'watchlist-00000001', enabled: 'yes' },
    { action: 'delete', id: 'watchlist-00000001', extra: true },
  ];
  for (const command of invalid) {
    await assert.rejects(
      harness.manager.execute(command),
      managementCode(MANAGEMENT_ERROR_CODES.INVALID_REQUEST),
    );
  }
  assert.equal(harness.repository.writes, 0);
});

test('maps invalid compact evidence and exhausted revisions to stable management errors', async () => {
  const harness = manager(state([{
    ...watchlist(),
    revision: Number.MAX_SAFE_INTEGER,
  }]));
  await assert.rejects(harness.manager.execute({
    action: 'create',
    name: 'Invalid evidence',
    entry: { results: [] },
    intervalHours: 24,
  }), managementCode(MANAGEMENT_ERROR_CODES.INVALID_REQUEST));
  await assert.rejects(harness.manager.execute({
    action: 'update',
    id: 'watchlist-00000001',
    enabled: false,
  }), managementCode(MANAGEMENT_ERROR_CODES.LIMIT_REACHED));
  assert.equal(harness.repository.writes, 0);
});

test('rejects duplicate names and the watchlist count limit without changing stored state', async () => {
  const duplicateHarness = manager(state([watchlist()]));
  await assert.rejects(duplicateHarness.manager.execute({
    action: 'create',
    name: 'PRIORITY DOMAINS',
    entry: entry(['beta.invalid']),
    intervalHours: 24,
  }), managementCode(MANAGEMENT_ERROR_CODES.NAME_CONFLICT));
  assert.equal(duplicateHarness.repository.writes, 0);

  const full = Array.from({ length: MAX_SCHEDULED_WATCHLISTS }, (_, index) => watchlist({
    id: `watchlist-${String(index).padStart(8, '0')}`,
    name: `List ${index}`,
    intervalHours: 168,
  }));
  const fullHarness = manager(state(full));
  await assert.rejects(fullHarness.manager.execute({
    action: 'create',
    name: 'One more',
    entry: entry(['extra.invalid']),
    intervalHours: 168,
  }), managementCode(MANAGEMENT_ERROR_CODES.LIMIT_REACHED));
  assert.equal(fullHarness.repository.writes, 0);
});

test('rejects schedules above admitted capacity and leaves the repository unchanged', async () => {
  const nearCapacity = watchlist({
    domains: Array.from({ length: 100 }, (_, index) => `item-${index}.invalid`),
    intervalHours: 6,
  });
  const harness = manager(state([nearCapacity]));
  const before = await harness.repository.read();
  await assert.rejects(harness.manager.execute({
    action: 'create',
    name: 'Overflow',
    entry: entry(Array.from({ length: 9 }, (_, index) => `overflow-${index}.invalid`)),
    intervalHours: 6,
  }), managementCode(MANAGEMENT_ERROR_CODES.CAPACITY_EXCEEDED));
  assert.deepEqual(await harness.repository.read(), before);
  assert.equal(harness.repository.writes, 0);
});

test('updates names, membership, intervals, and enabled state while superseding an active run', async () => {
  const item = watchlist();
  const activeRun = {
    id: 'active-run-000001',
    watchlistId: item.id,
    watchlistRevision: item.revision,
    cursor: 0,
    sources: [{ domain: 'alpha.invalid' }],
    results: [],
    errorCount: 0,
    startedAt: NOW,
    updatedAt: NOW,
    lease: null,
  };
  const harness = manager(state([item], activeRun));
  const result = await harness.manager.execute({
    action: 'update',
    id: item.id,
    name: 'Updated domains',
    entry: entry(['beta.invalid']),
    intervalHours: 12,
    enabled: false,
  });
  const updated = result.state.watchlists[0];

  assert.equal(result.action, 'updated');
  assert.equal(updated.name, 'Updated domains');
  assert.equal(updated.intervalHours, 12);
  assert.equal(updated.enabled, false);
  assert.equal(updated.status, 'paused');
  assert.equal(updated.nextRunAt, null);
  assert.equal(updated.revision, 2);
  assert.equal(updated.entry.results[0].domain, 'beta.invalid');
  assert.equal(updated.progress, null);
  assert.equal((await harness.repository.read()).activeRun, null);
});

test('resuming or materially changing a schedule queues it from the management timestamp', async () => {
  const original = { ...watchlist(), enabled: false, status: 'paused', nextRunAt: null };
  const harness = manager(state([original]));
  const resumed = await harness.manager.execute({
    action: 'update',
    id: original.id,
    enabled: true,
  });
  assert.equal(resumed.state.watchlists[0].nextRunAt, NOW);
  assert.equal(resumed.state.watchlists[0].status, 'idle');

  const interval = await harness.manager.execute({
    action: 'update',
    id: original.id,
    intervalHours: 6,
  });
  assert.equal(interval.state.watchlists[0].nextRunAt, NOW);
  assert.equal(interval.state.watchlists[0].revision, 3);
});

test('a semantically empty update avoids a repository write and revision change', async () => {
  const item = watchlist();
  const harness = manager(state([item]));
  const result = await harness.manager.execute({
    action: 'update',
    id: item.id,
    name: item.name,
    enabled: item.enabled,
    intervalHours: item.intervalHours,
  });

  assert.equal(result.action, 'unchanged');
  assert.equal(result.state.watchlists[0].revision, 1);
  assert.equal(harness.repository.writes, 0);
});

test('deletes an existing watchlist, cancels its active run, and rejects missing records', async () => {
  const item = watchlist();
  const activeRun = {
    id: 'active-run-000001',
    watchlistId: item.id,
    watchlistRevision: item.revision,
    cursor: 0,
    sources: [{ domain: 'alpha.invalid' }],
    results: [],
    errorCount: 0,
    startedAt: NOW,
    updatedAt: NOW,
    lease: null,
  };
  const harness = manager(state([item], activeRun));
  const result = await harness.manager.execute({ action: 'delete', id: item.id });

  assert.equal(result.action, 'deleted');
  assert.deepEqual(result.state.watchlists, []);
  assert.equal((await harness.repository.read()).activeRun, null);
  await assert.rejects(
    harness.manager.execute({ action: 'delete', id: item.id }),
    managementCode(MANAGEMENT_ERROR_CODES.NOT_FOUND),
  );
});

test('pure command application does not mutate the input state or command', () => {
  const sourceState = state([watchlist()]);
  const command = { action: 'update', id: 'watchlist-00000001', enabled: false };
  const beforeState = structuredClone(sourceState);
  const beforeCommand = structuredClone(command);
  const result = applyScheduledMonitorCommand(sourceState, command, {
    now: () => NOW_MS,
    randomUUID: () => 'generated-00000001',
  });

  assert.deepEqual(sourceState, beforeState);
  assert.deepEqual(command, beforeCommand);
  assert.equal(result.state.watchlists[0].enabled, false);
});

test('validates manager dependencies, clock, and generated identifiers', async () => {
  assert.throws(() => createScheduledMonitorManager({}), /repository is required/i);
  assert.throws(() => createScheduledMonitorManager({ repository: new MemoryRepository(), now: 1 }), /clock is required/i);
  assert.throws(() => createScheduledMonitorManager({ repository: new MemoryRepository(), randomUUID: null }), /identifier source/i);

  const badClock = manager(state(), { now: () => Number.NaN });
  await assert.rejects(badClock.manager.execute({
    action: 'create', name: 'New', entry: entry(), intervalHours: 24,
  }), /clock returned an invalid time/i);
  const badId = manager(state(), { randomUUID: () => 'short' });
  await assert.rejects(badId.manager.execute({
    action: 'create', name: 'New', entry: entry(), intervalHours: 24,
  }), /identifier source returned an invalid value/i);
});
