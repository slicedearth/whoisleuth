import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BulkSessionWorkspace } from '../frontend/src/lib/controllers/bulk-session-workspace.ts';
import { BulkSessionCapacityError } from '../frontend/src/lib/bulk-sessions.ts';
import { BrowserLocalDataError } from '../frontend/src/lib/browser-local-data-content.ts';
import {
  bulkSessionInputDigest,
  fromBulkSessionResult,
} from '../frontend/src/lib/analysis/bulk-result-model.ts';
import {
  normalizeBulkSession,
  prepareBulkSessionSave,
} from '../packages/workspace/bulk-session-model.mts';
import { richBulkSessionStore } from './bulk-session-fixture.mts';

type Options = ConstructorParameters<typeof BulkSessionWorkspace>[0];
type Storage = Awaited<ReturnType<Options['loadStorage']>>;
type Session = Awaited<ReturnType<Storage['loadBulkSessions']>>[number];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
function harness(overrides: Partial<Storage> = {}) {
  const record = normalizeBulkSession(richBulkSessionStore(1).sessions[0])!;
  const scan = {
    running: false,
    mode: record.mode,
    domains: [...record.domains],
    results: record.results.map((row) => fromBulkSessionResult(row)),
    cancelled: false,
  };
  const writes: Parameters<Storage['saveBulkSession']>[] = [];
  let records: Session[] = [],
    publications = 0,
    confirmed = true,
    loads = 0,
    exports = 0;
  const storage: Storage = {
    BulkSessionCapacityError,
    loadBulkSessions: async () => {
      loads++;
      return records;
    },
    saveBulkSession: async (...args) => {
      writes.push(args);
      const session = normalizeBulkSession(args[0]);
      assert.ok(session);
      const added = !records.some((row) => row.id === session.id);
      records = [session];
      return { session, added, pruned: 0 };
    },
    deleteBulkSession: async (expected) => {
      assert.equal(expected, record);
      records = [];
      return [];
    },
    exportBulkSessions: async () => {
      exports++;
    },
    ...overrides,
  };
  const options = {
    loadStorage: async () => storage,
    scan: () => scan,
    publish: () => {
      publications++;
    },
    confirm: () => confirmed,
    now: () => '2026-09-20T00:00:00.000Z',
  } satisfies Options;
  const workspace = new BulkSessionWorkspace(options);
  return {
    workspace,
    storage,
    scan,
    record,
    writes,
    options,
    get loads() {
      return loads;
    },
    get exports() {
      return exports;
    },
    get publications() {
      return publications;
    },
    confirm(value: boolean) {
      confirmed = value;
    },
    records(value: Session[]) {
      records = value;
    },
  };
}

test('session loading is shared, retryable after failure and cannot publish after disposal', async () => {
  const h = harness();
  const held = deferred<Storage>();
  let imports = 0;
  h.options.loadStorage = () => {
    imports++;
    return held.promise;
  };
  const first = h.workspace.ensureLoaded(),
    second = h.workspace.ensureLoaded();
  assert.equal(imports, 1);
  held.resolve(h.storage);
  await Promise.all([first, second]);
  assert.equal(h.loads, 1);
  await h.workspace.ensureLoaded();
  assert.equal(h.loads, 1);
  const broken = harness({
    loadBulkSessions: async () => {
      throw new Error('Storage unavailable');
    },
  });
  await broken.workspace.ensureLoaded();
  assert.equal(broken.workspace.state.sourceState, 'unavailable');
  broken.storage.loadBulkSessions = async () => [broken.record];
  await broken.workspace.ensureLoaded();
  assert.deepEqual(broken.workspace.state.sessions, [broken.record]);
  const waiting = deferred<Session[]>();
  const disposed = harness({ loadBulkSessions: () => waiting.promise });
  const loading = disposed.workspace.ensureLoaded();
  disposed.workspace.dispose();
  const publications = disposed.publications;
  waiting.resolve([disposed.record]);
  await loading;
  assert.equal(disposed.publications, publications);
});

test('saving captures one coherent result and prevents competing session or scan operations', async () => {
  const h = harness();
  const held = deferred<Storage>();
  h.options.loadStorage = () => held.promise;
  h.workspace.setName('Reviewed rows');
  const originalDomain = h.scan.domains[0]!;
  h.scan.results[0]!.registrant = {
    name: 'Private sentinel',
    org: null,
    email: 'private@example.test',
  };
  const saving = h.workspace.save();
  h.scan.domains = ['changed.example'];
  h.scan.mode = 'fast';
  h.scan.results = [];
  assert.equal(h.workspace.beginScan(true), false);
  assert.equal(h.workspace.select(h.record), false);
  await h.workspace.save();
  await h.workspace.remove(h.record);
  await h.workspace.export();
  held.resolve(h.storage);
  await saving;
  assert.equal(h.writes.length, 1);
  const saved = normalizeBulkSession(h.writes[0]![0])!;
  assert.deepEqual(saved.domains, [originalDomain]);
  assert.equal(saved.mode, 'deep');
  assert.equal(saved.state, 'complete');
  assert.equal(saved.inputDigest, await bulkSessionInputDigest([originalDomain], 'deep'));
  assert.doesNotMatch(JSON.stringify(saved), /Private sentinel|private@example\.test/u);
  assert.equal(h.workspace.state.busy, false);
  assert.equal(h.workspace.state.currentId, saved.id);
});

test('save admission, partial/cancelled state and expected-record concurrency are owned together', async () => {
  const h = harness();
  await h.workspace.save();
  assert.equal(h.writes.length, 0);
  h.records([h.record]);
  assert.equal(h.workspace.select(h.record), true);
  h.scan.running = true;
  await h.workspace.save();
  assert.equal(h.writes.length, 0);
  h.scan.running = false;
  h.scan.domains.push('pending.example');
  await h.workspace.save();
  assert.equal(h.writes[0]?.[1]?.expected, h.record);
  assert.equal(normalizeBulkSession(h.writes[0]?.[0])?.state, 'partial');
  h.scan.cancelled = true;
  await h.workspace.save();
  assert.equal(normalizeBulkSession(h.writes[1]?.[0])?.state, 'cancelled');
  assert.equal(normalizeBulkSession(h.writes[1]?.[0])?.completedAt, null);
});

test('committed and uncertain saves block writes until a deliberate refresh, never retry automatically', async () => {
  for (const outcome of ['committed', 'unknown'] as const) {
    const h = harness();
    h.workspace.setName('Keep draft');
    await h.workspace.ensureLoaded();
    let writes = 0;
    const save = h.storage.saveBulkSession;
    h.storage.saveBulkSession = async (...args) => {
      writes++;
      if (outcome === 'unknown')
        throw new BrowserLocalDataError('LOCAL_DATA_COMMIT_UNKNOWN', 'Unconfirmed');
      return save(...args);
    };
    const load = h.storage.loadBulkSessions;
    h.storage.loadBulkSessions = async () => {
      throw new Error('Read unavailable');
    };
    await h.workspace.save();
    assert.equal(h.workspace.state.refreshRequired, true);
    assert.match(
      h.workspace.state.status,
      outcome === 'committed' ? /Saved .*do not repeat the save/u : /may already be stored/u,
    );
    await h.workspace.save();
    await h.workspace.confirmRetention();
    assert.equal(writes, 1);
    await h.workspace.refresh();
    assert.equal(h.workspace.state.refreshRequired, true);
    h.storage.loadBulkSessions = load;
    await h.workspace.refresh();
    assert.equal(h.workspace.state.refreshRequired, false);
    assert.equal(h.workspace.state.name, 'Keep draft');
    assert.equal(writes, 1);
  }
});

test('retention needs explicit approval and changing the draft or starting a scan invalidates the preview', async () => {
  const h = harness();
  const preview = prepareBulkSessionSave([], h.record);
  let approval: unknown;
  h.storage.saveBulkSession = async (_input, options) => {
    if (!options?.retention) throw new BulkSessionCapacityError(preview);
    approval = options.retention;
    return { session: preview.session, added: true, pruned: 1 };
  };
  h.workspace.setName('Retained rows');
  await h.workspace.save();
  assert.equal(h.workspace.state.retention, preview);
  assert.equal(approval, undefined);
  await h.workspace.confirmRetention();
  assert.equal(approval, preview);
  assert.equal(h.workspace.state.retention, null);
  assert.match(h.workspace.state.status, /Removed 1 reviewed session/u);
  await h.workspace.save();
  h.workspace.setName('Changed');
  assert.equal(h.workspace.state.retention, null);
  await h.workspace.save();
  h.workspace.cancelRetention();
  assert.equal(h.workspace.state.retention, null);
  assert.match(h.workspace.state.status, /not changed/u);
  await h.workspace.save();
  assert.equal(h.workspace.beginScan(false), true);
  assert.equal(h.workspace.state.retention, null);
});

test('write rejection preserves the draft and next scan detaches a saved record without losing a new draft', async () => {
  const h = harness({
    saveBulkSession: async () => {
      throw new Error('Record changed; reopen it.');
    },
  });
  h.workspace.setName('Unsaved name');
  h.workspace.beginScan(true);
  assert.equal(h.workspace.state.name, 'Unsaved name');
  assert.equal(h.workspace.state.startedAt, '2026-09-20T00:00:00.000Z');
  await h.workspace.save();
  assert.equal(h.workspace.state.name, 'Unsaved name');
  assert.equal(h.workspace.state.refreshRequired, false);
  assert.equal(h.workspace.state.status, 'Record changed; reopen it.');
  h.workspace.select(h.record);
  h.workspace.beginScan(true);
  assert.equal(h.workspace.state.currentId, '');
  assert.equal(h.workspace.state.name, '');
});

test('deletion needs confirmation and the exact opened record; export does not mutate selection', async () => {
  const h = harness();
  h.records([h.record]);
  h.workspace.select(h.record);
  h.confirm(false);
  await h.workspace.remove(h.record);
  assert.equal(h.loads, 0);
  h.confirm(true);
  h.scan.running = true;
  await h.workspace.remove(h.record);
  assert.equal(h.loads, 0);
  h.scan.running = false;
  await h.workspace.export();
  assert.equal(h.exports, 1);
  assert.equal(h.workspace.state.currentId, h.record.id);
  await h.workspace.remove(h.record);
  assert.deepEqual(h.workspace.state.sessions, []);
  assert.equal(h.workspace.state.currentId, '');
  assert.equal(h.workspace.state.name, '');
});

test('leaving while storage is loading prevents a write and leaving during a write prevents late publication', async () => {
  const h = harness();
  const held = deferred<Storage>();
  h.options.loadStorage = () => held.promise;
  h.workspace.setName('Waiting');
  const saving = h.workspace.save();
  h.workspace.dispose();
  held.resolve(h.storage);
  await saving;
  assert.equal(h.writes.length, 0);
  const write = deferred<Awaited<ReturnType<Storage['saveBulkSession']>>>();
  const started = deferred<void>();
  const active = harness({
    saveBulkSession: () => {
      started.resolve();
      return write.promise;
    },
  });
  active.workspace.setName('Submitted');
  const pending = active.workspace.save();
  await started.promise;
  active.workspace.dispose();
  const publications = active.publications;
  write.resolve({ session: active.record, added: true, pruned: 0 });
  await pending;
  assert.equal(active.publications, publications);
});
