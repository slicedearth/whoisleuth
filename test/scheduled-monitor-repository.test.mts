import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  MAX_UPDATE_ATTEMPTS,
  ScheduledMonitorRepository,
} from '../lib/scheduled-monitor-repository.mts';
import type {
  ScheduledMonitorRepositoryOptions,
  ScheduledMonitorUpdate,
  VersionedTextStore,
} from '../lib/scheduled-monitor-repository.mts';
import { encryptScheduledMonitorState } from '../lib/scheduled-monitor-crypto.mts';
import { recordValue } from './value-assertions.mts';

const key = randomBytes(32).toString('base64');
const namespace = 'whoisleuth:scheduled-monitor:test';
type MonitorState = { version: 1; count: number };

function emptyState(): MonitorState {
  return { version: 1, count: 0 };
}

function normalizeState(value: unknown): MonitorState {
  const candidate = recordValue(value);
  if (candidate.version !== 1) {
    throw new Error('Unsupported scheduled monitoring state schema.');
  }
  return {
    version: 1,
    count: Number.isSafeInteger(candidate.count)
      && typeof candidate.count === 'number'
      && candidate.count >= 0
      && candidate.count <= 100
      ? candidate.count
      : 0,
  };
}

class MemoryVersionedTextStore implements VersionedTextStore {
  value: string | null = null;
  version: string | null = null;
  conflicts = 0;
  readCalls = 0;
  writeCalls = 0;

  async read(): Promise<{ value: string | null; version: string | null }> {
    this.readCalls += 1;
    return { value: this.value, version: this.version };
  }

  async compareAndSet(
    _key: string,
    expectedVersion: string | null,
    nextValue: string,
  ): Promise<boolean> {
    this.writeCalls += 1;
    if (this.conflicts > 0) {
      this.conflicts -= 1;
      return false;
    }
    if (this.version !== expectedVersion) return false;
    this.value = nextValue;
    this.version = String(Number(this.version || 0) + 1);
    return true;
  }
}

function repository(
  rawStore: VersionedTextStore = new MemoryVersionedTextStore(),
  overrides: Partial<Omit<ScheduledMonitorRepositoryOptions<MonitorState>, 'rawStore'>> = {},
) {
  return new ScheduledMonitorRepository<MonitorState>({
    rawStore,
    encryptionKey: key,
    namespace,
    emptyState,
    normalizeState,
    ...overrides,
  });
}

describe('provider-neutral scheduled monitoring repository', () => {
  test('initializes through the empty-state contract and stores only ciphertext', async () => {
    const rawStore = new MemoryVersionedTextStore();
    const repo = repository(rawStore);
    assert.deepEqual(await repo.read(), emptyState());
    const outcome = await repo.update((state) => ({
      state: { ...state, count: state.count + 1 },
      result: 'updated',
    }));
    assert.equal(outcome.result, 'updated');
    assert.deepEqual(outcome.state, { version: 1, count: 1 });
    assert.deepEqual(await repo.read(), { version: 1, count: 1 });
    assert.equal(rawStore.value?.includes('"count"'), false);
  });

  test('re-reads and re-runs the mutator after a bounded compare-and-set conflict', async () => {
    const rawStore = new MemoryVersionedTextStore();
    rawStore.conflicts = 1;
    const repo = repository(rawStore);
    let mutations = 0;
    const outcome = await repo.update((state) => {
      mutations += 1;
      return { state: { ...state, count: state.count + 1 }, result: mutations };
    });
    assert.equal(mutations, 2);
    assert.equal(outcome.result, 2);
    assert.deepEqual(outcome.state, { version: 1, count: 1 });
    assert.equal(rawStore.readCalls, 2);
    assert.equal(rawStore.writeCalls, 2);
  });

  test('fails with a stable error after the conflict retry ceiling', async () => {
    const rawStore = new MemoryVersionedTextStore();
    rawStore.conflicts = MAX_UPDATE_ATTEMPTS;
    await assert.rejects(
      repository(rawStore).update((state) => ({ state, result: null })),
      /changed concurrently/i,
    );
    assert.equal(rawStore.readCalls, MAX_UPDATE_ATTEMPTS);
    assert.equal(rawStore.writeCalls, MAX_UPDATE_ATTEMPTS);
  });

  test('does not rewrite storage for an explicit no-op update', async () => {
    const rawStore = new MemoryVersionedTextStore();
    const repo = repository(rawStore);
    await repo.update((state) => ({ state, result: 'created' }));
    const encrypted = rawStore.value;
    const writes = rawStore.writeCalls;
    const outcome = await repo.update((state) => ({
      state: { ...state, count: 99 },
      result: 'idle',
      changed: false,
    }));
    assert.equal(outcome.result, 'idle');
    assert.deepEqual(outcome.state, { version: 1, count: 0 });
    assert.equal(rawStore.value, encrypted);
    assert.equal(rawStore.writeCalls, writes);
  });

  test('never overwrites ciphertext that cannot be authenticated or normalized', async () => {
    const rawStore = new MemoryVersionedTextStore();
    rawStore.value = '{"tampered":true}';
    rawStore.version = '1';
    await assert.rejects(
      repository(rawStore).update((state) => ({ state, result: null })),
      /unsupported format|malformed/i,
    );
    assert.equal(rawStore.value, '{"tampered":true}');
    assert.equal(rawStore.writeCalls, 0);

    const futureStore = new MemoryVersionedTextStore();
    futureStore.value = encryptScheduledMonitorState({ version: 2, count: 1 }, key, namespace);
    futureStore.version = '1';
    await assert.rejects(
      repository(futureStore).update((state) => ({ state, result: null })),
      /unsupported scheduled monitoring state schema/i,
    );
    assert.equal(futureStore.writeCalls, 0);
  });

  test('binds ciphertext to the storage namespace', async () => {
    const rawStore = new MemoryVersionedTextStore();
    await repository(rawStore).update((state) => ({ state, result: null }));
    await assert.rejects(
      repository(rawStore, { namespace: 'whoisleuth:scheduled-monitor:other' }).read(),
      /could not be authenticated/i,
    );
  });

  test('validates storage adapters, namespaces, snapshots, and update outcomes', async () => {
    assert.throws(() => repository({} as VersionedTextStore), /storage adapter is required/i);
    assert.throws(() => repository(new MemoryVersionedTextStore(), { namespace: 'invalid namespace' }), /namespace is invalid/i);

    const malformedSnapshot = new MemoryVersionedTextStore();
    malformedSnapshot.read = async () => ({ value: null, version: 'unexpected' });
    await assert.rejects(repository(malformedSnapshot).read(), /invalid snapshot/i);

    const unversionedValue = new MemoryVersionedTextStore();
    unversionedValue.read = async () => ({ value: '{}', version: null });
    await assert.rejects(repository(unversionedValue).read(), /invalid snapshot/i);

    const repo = repository();
    await assert.rejects(
      repo.update(() => null as unknown as ScheduledMonitorUpdate<null>),
      /did not return a state/i,
    );
    await assert.rejects(
      repo.update((state) => ({
        state,
        result: null,
        changed: 'no' as unknown as boolean,
      })),
      /invalid changed flag/i,
    );
  });

  test('normalizes every candidate state before returning or encrypting it', async () => {
    const rawStore = new MemoryVersionedTextStore();
    const repo = repository(rawStore);
    const outcome = await repo.update(() => ({
      state: { version: 1, count: 999, unknown: 'discard me' },
      result: null,
    }));
    assert.deepEqual(outcome.state, { version: 1, count: 0 });
    assert.deepEqual(await repo.read(), { version: 1, count: 0 });
    assert.equal(rawStore.value?.includes('discard me'), false);
  });

  test('returns ephemeral recovery with a subsequent write without storing the diagnostic', async () => {
    type Recovery = { version: 1; recoveredItems: number };
    const rawStore = new MemoryVersionedTextStore();
    rawStore.value = encryptScheduledMonitorState(
      { version: 1, count: 999, privateTarget: 'private-target.invalid' },
      key,
      namespace,
    );
    rawStore.version = '1';
    const repo = new ScheduledMonitorRepository<MonitorState, Recovery>({
      rawStore,
      encryptionKey: key,
      namespace,
      emptyState,
      normalizeState,
      inspectState: (value) => {
        const state = normalizeState(value);
        const candidate = recordValue(value);
        return {
          state,
          recovery: candidate.count === state.count
            ? null
            : { version: 1, recoveredItems: 1 },
        };
      },
    });

    assert.deepEqual(await repo.readWithRecovery(), {
      state: { version: 1, count: 0 },
      recovery: { version: 1, recoveredItems: 1 },
    });
    const outcome = await repo.update((state) => ({
      state: { ...state, count: 1 },
      result: 'committed',
    }));
    assert.equal(outcome.result, 'committed');
    assert.deepEqual(outcome.recovery, { version: 1, recoveredItems: 1 });
    assert.equal(rawStore.value?.includes('private-target.invalid'), false);
    assert.deepEqual(await repo.readWithRecovery(), {
      state: { version: 1, count: 1 },
      recovery: null,
    });
  });

  test('rejects a non-boolean compare-and-set response without treating it as success', async () => {
    const rawStore = new MemoryVersionedTextStore();
    rawStore.compareAndSet = async () => 'yes' as unknown as boolean;
    await assert.rejects(
      repository(rawStore).update((state) => ({ state, result: null })),
      /invalid compare-and-set result/i,
    );
    assert.equal(rawStore.value, null);
  });
});
