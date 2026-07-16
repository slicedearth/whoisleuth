// Provider-neutral encrypted repository for optional scheduled monitoring.
// Concrete storage adapters own their network, credential, and atomic-CAS
// behavior; this boundary owns ciphertext authentication, normalization, and
// bounded optimistic retries without knowing which service stores the value.

import {
  decryptScheduledMonitorState,
  encryptScheduledMonitorState,
  MAX_ENVELOPE_BYTES,
  parseScheduledMonitorKey,
} from './scheduled-monitor-crypto.mts';

type VersionedTextSnapshot = {
  value: string | null;
  version: string | null;
};

type VersionedTextStore = {
  read: (key: string) => Promise<VersionedTextSnapshot>;
  compareAndSet: (
    key: string,
    expectedVersion: string | null,
    nextValue: string,
  ) => Promise<boolean>;
};

type ScheduledMonitorUpdate<State, Result> = {
  state: unknown;
  result: Result;
  changed?: boolean;
};

type ScheduledMonitorRepositoryOptions<State> = {
  rawStore: VersionedTextStore;
  encryptionKey: string;
  namespace: string;
  emptyState: () => unknown;
  normalizeState: (value: unknown) => State;
};

const MAX_UPDATE_ATTEMPTS = 4;
const MAX_NAMESPACE_LENGTH = 200;
const MAX_VERSION_LENGTH = 256;
const NAMESPACE_RE = /^[A-Za-z0-9:_-]+$/u;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;

function validNamespace(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_NAMESPACE_LENGTH
    && NAMESPACE_RE.test(value);
}

function validVersion(value: unknown): value is string | null {
  return value === null || (typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_VERSION_LENGTH
    && !CONTROL_RE.test(value));
}

function validRawStore(value: unknown): value is VersionedTextStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<VersionedTextStore>;
  return typeof candidate.read === 'function' && typeof candidate.compareAndSet === 'function';
}

function normalizeSnapshot(value: unknown): VersionedTextSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Scheduled monitoring storage returned an invalid snapshot.');
  }
  const snapshot = value as Partial<VersionedTextSnapshot>;
  if ((snapshot.value !== null && typeof snapshot.value !== 'string')
    || !validVersion(snapshot.version)
    || (snapshot.value === null && snapshot.version !== null)
    || (typeof snapshot.value === 'string' && typeof snapshot.version !== 'string')
    || (typeof snapshot.value === 'string'
      && Buffer.byteLength(snapshot.value, 'utf8') > MAX_ENVELOPE_BYTES)) {
    throw new Error('Scheduled monitoring storage returned an invalid snapshot.');
  }
  return { value: snapshot.value, version: snapshot.version } as VersionedTextSnapshot;
}

function normalizeUpdate<State, Result>(value: unknown): ScheduledMonitorUpdate<State, Result> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'state')) {
    throw new Error('Scheduled monitoring update did not return a state.');
  }
  const update = value as ScheduledMonitorUpdate<State, Result>;
  if (update.changed !== undefined && typeof update.changed !== 'boolean') {
    throw new Error('Scheduled monitoring update returned an invalid changed flag.');
  }
  return update;
}

class ScheduledMonitorRepository<State> {
  rawStore: VersionedTextStore;
  encryptionKey: string;
  namespace: string;
  emptyState: () => unknown;
  normalizeState: (value: unknown) => State;

  constructor(options: ScheduledMonitorRepositoryOptions<State>) {
    if (!options || !validRawStore(options.rawStore)) {
      throw new Error('A versioned scheduled monitoring storage adapter is required.');
    }
    if (!validNamespace(options.namespace)) {
      throw new Error('Scheduled monitoring storage namespace is invalid.');
    }
    if (typeof options.emptyState !== 'function' || typeof options.normalizeState !== 'function') {
      throw new Error('Scheduled monitoring state contracts are required.');
    }
    parseScheduledMonitorKey(options.encryptionKey);
    this.rawStore = options.rawStore;
    this.encryptionKey = options.encryptionKey.trim();
    this.namespace = options.namespace;
    this.emptyState = options.emptyState;
    this.normalizeState = options.normalizeState;
  }

  decode(value: string | null): State {
    const plaintext = value === null
      ? structuredClone(this.emptyState())
      : decryptScheduledMonitorState(value, this.encryptionKey, this.namespace);
    return this.normalizeState(plaintext);
  }

  async snapshot(): Promise<{ state: State; version: string | null }> {
    const raw = normalizeSnapshot(await this.rawStore.read(this.namespace));
    return { state: this.decode(raw.value), version: raw.version };
  }

  async read(): Promise<State> {
    return (await this.snapshot()).state;
  }

  async update<Result>(
    mutator: (state: State) => ScheduledMonitorUpdate<State, Result> | Promise<ScheduledMonitorUpdate<State, Result>>,
  ): Promise<{ state: State; result: Result }> {
    if (typeof mutator !== 'function') throw new Error('A scheduled monitoring state update is required.');
    for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt += 1) {
      const current = await this.snapshot();
      const outcome = normalizeUpdate<State, Result>(await mutator(structuredClone(current.state)));
      if (outcome.changed === false) return { state: current.state, result: outcome.result };
      const state = this.normalizeState(outcome.state);
      const encrypted = encryptScheduledMonitorState(state, this.encryptionKey, this.namespace);
      const committed = await this.rawStore.compareAndSet(this.namespace, current.version, encrypted);
      if (committed === true) {
        return { state, result: outcome.result };
      }
      if (committed !== false) {
        throw new Error('Scheduled monitoring storage returned an invalid compare-and-set result.');
      }
    }
    throw new Error('Scheduled monitoring state changed concurrently; try again.');
  }
}

export {
  MAX_UPDATE_ATTEMPTS,
  ScheduledMonitorRepository,
};
export type {
  ScheduledMonitorRepositoryOptions,
  ScheduledMonitorUpdate,
  VersionedTextSnapshot,
  VersionedTextStore,
};
