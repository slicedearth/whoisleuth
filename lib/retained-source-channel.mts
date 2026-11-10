// Target-free control and conditional promotion for a bounded pair of source editions.
import { parseBoundedJsonObject } from '../packages/analysis/bounded-json.mts';
import { MAX_RETAINED_SOURCE_EDITION_BYTES, type HostedSourceId } from '../packages/contracts/retained-source-edition.mts';
import { SOURCE_EDITION_DIGEST } from '../packages/evidence/retained-source-edition.mts';
import { admitRetainedSourceData, type EditionFile } from './retained-source-data.mts';
import type { VersionedTextStore } from './netlify-versioned-text-store.mts';

export const RETAINED_SOURCE_STORE = 'retained-source-editions-v1';
export const MAX_EDITION_STATE_BYTES = 8 * 1024 * 1024;
export const SOURCE_CONTROL_BYTES = 512;

type AutomaticSourceId = 'sslbl' | 'kev';
type Control = Readonly<
  { version: 1; action: 'hold' | 'automatic' }
  | { version: 1; action: 'promote'; from: string | null; digest: string }
  | { version: 1; action: 'rollback'; from: string | null; digest: string }
  | { version: 1; action: 'bundled'; from: string }
>;
type State = Readonly<{ version: 1; current: EditionFile | null; previous: EditionFile | null }>;
export type EditionCycle = Readonly<{
  source: HostedSourceId;
  status: 'disabled' | 'not_due' | 'unchanged' | 'updated' | 'rolled_back' | 'bundled' | 'conflict' | 'review_required' | 'unavailable';
  digest?: string | null;
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && SOURCE_EDITION_DIGEST.test(value);
}

function isAutomaticSource(source: HostedSourceId): source is AutomaticSourceId {
  return source === 'sslbl' || source === 'kev';
}

function parseEditionControl(text: string, source: HostedSourceId): Control {
  if (text.length > SOURCE_CONTROL_BYTES) throw new TypeError('Source control exceeds its byte bound.');
  const value = parseBoundedJsonObject(text, { maximumBytes: SOURCE_CONTROL_BYTES, label: 'Source control' });
  const fields = Object.keys(value).length;
  if (value.version === 1) {
    if (fields === 2 && (value.action === 'hold' || (value.action === 'automatic' && isAutomaticSource(source)))) {
      return { version: 1, action: value.action };
    }
    if (fields === 4 && (value.action === 'promote' || value.action === 'rollback') && isDigest(value.digest)
      && (value.from === null || isDigest(value.from)) && value.from !== value.digest) {
      return { version: 1, action: value.action, from: value.from, digest: value.digest };
    }
    if (fields === 3 && value.action === 'bundled' && isDigest(value.from)) return { version: 1, action: 'bundled', from: value.from };
  }
  throw new TypeError('Unsupported source control or source action.');
}

function editionFile(value: unknown): EditionFile | null {
  if (value === null) return null;
  const entry = record(value);
  if (!entry || Object.keys(entry).length !== 2 || !isDigest(entry.digest) || typeof entry.text !== 'string'
    || !entry.text.length || entry.text.length > MAX_RETAINED_SOURCE_EDITION_BYTES) throw new TypeError('Invalid source edition reference.');
  return { digest: entry.digest, text: entry.text };
}

export function parseEditionState(text: string | null): State {
  if (text === null) return { version: 1, current: null, previous: null };
  if (text.length > MAX_EDITION_STATE_BYTES) throw new TypeError('Source state exceeds its byte bound.');
  const value = parseBoundedJsonObject(text, { maximumBytes: MAX_EDITION_STATE_BYTES, label: 'Source state' });
  if (value.version !== 1 || Object.keys(value).length !== 3) throw new TypeError('Unsupported source edition state.');
  const current = editionFile(value.current);
  const previous = editionFile(value.previous);
  if (current && current.digest === previous?.digest) throw new TypeError('Repeated source edition state.');
  return { version: 1, current, previous };
}

type AutomaticResult = EditionFile | 'unchanged' | 'review_required';

// Reserve a slot before fetching. Concurrent invocations and manual reruns
// cannot exceed the certificate publisher's five-minute minimum interval.
const MIN_AUTOMATIC_INTERVAL_MS = 5 * 60_000;

async function claimAutomaticAttempt(store: VersionedTextStore, source: AutomaticSourceId, now: Date, signal: AbortSignal) {
  const key = `attempt/${source}`;
  const attempt = await store.read(key, { signal });
  if (attempt.value !== null) {
    const timestamp = Date.parse(attempt.value);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== attempt.value) {
      throw new TypeError('Invalid source attempt timestamp.');
    }
    if (now.getTime() - timestamp < MIN_AUTOMATIC_INTERVAL_MS) return false;
  }
  return store.compareAndSet(key, attempt.version, now.toISOString(), { signal });
}

export async function runSourceEditionCycle(options: Readonly<{
  source: HostedSourceId;
  store: VersionedTextStore;
  now: Date;
  signal: AbortSignal;
  observe: (source: AutomaticSourceId, current: EditionFile | null) => Promise<AutomaticResult>;
}>): Promise<EditionCycle> {
  const { source, store, now, signal } = options;
  const controlKey = `control/${source}`;
  const stateKey = `state/${source}`;
  try {
    const command = await store.read(controlKey, { signal });
    if (command.value === null) return { source, status: 'disabled' };
    const control = parseEditionControl(command.value, source);
    if (control.action === 'hold') return { source, status: 'disabled' };
    const stored = await store.read(stateKey, { signal });
    const state = parseEditionState(stored.value);
    const from = state.current?.digest ?? null;
    if ('from' in control && control.from !== from) {
      // Completed commands remain idempotent; stale commands do not undo another promotion.
      const alreadyApplied = control.action === 'bundled' ? from === null : control.digest === from;
      return { source, status: alreadyApplied ? 'unchanged' : 'conflict', digest: from };
    }
    // A damaged active edition must not prevent an explicit rollback or
    // fallback. Only keep a previous edition that can actually be read.
    const active = state.current;
    const verifiedActive = active && await admitRetainedSourceData(active, source, now).then(() => active, () => null);
    let next: State;
    let status: EditionCycle['status'];
    if (control.action === 'bundled') {
      next = { version: 1, current: null, previous: verifiedActive ?? state.previous };
      status = 'bundled';
    } else if (control.action === 'rollback') {
      if (!state.previous || state.previous.digest !== control.digest) return { source, status: 'conflict', digest: from };
      // An explicit rollback preserves the original dates and may be stale.
      await admitRetainedSourceData(state.previous, source, now);
      next = { version: 1, current: state.previous, previous: verifiedActive };
      status = 'rolled_back';
    } else {
      let candidate: AutomaticResult;
      if (control.action === 'automatic' && isAutomaticSource(source)) {
        if (active && !verifiedActive) return { source, status: 'review_required', digest: from };
        if (!await claimAutomaticAttempt(store, source, now, signal)) return { source, status: 'not_due', digest: from };
        candidate = await options.observe(source, state.current ?? state.previous);
      } else if (control.action === 'promote') {
        const pending = await store.read(`candidate/${source}`, { signal });
        if (pending.value === null) return { source, status: 'unavailable', digest: from };
        candidate = { text: pending.value, digest: control.digest };
      } else {
        return { source, status: 'review_required', digest: from };
      }
      if (typeof candidate === 'string') return { source, status: candidate, digest: from };
      if (candidate.digest === from) return { source, status: 'unchanged', digest: from };
      if (!(await admitRetainedSourceData(candidate, source, now)).current) return { source, status: 'review_required', digest: from };
      const prior = verifiedActive ?? state.previous;
      next = { version: 1, current: candidate, previous: candidate.digest === prior?.digest ? null : prior };
      status = 'updated';
    }
    // Stop if the operator changed the instruction during acquisition. The state CAS
    // also prevents a second invocation from replacing a more recent edition.
    if ((await store.read(controlKey, { signal })).version !== command.version) return { source, status: 'conflict', digest: from };
    signal.throwIfAborted();
    const committed = await store.compareAndSet(stateKey, stored.version, JSON.stringify(next), { signal });
    return { source, status: committed ? status : 'conflict', digest: committed ? next.current?.digest ?? null : from };
  } catch {
    // Do not log untrusted payloads, provider errors, paths or secrets.
    return { source, status: 'unavailable' };
  }
}
