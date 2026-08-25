// Provider-neutral scheduled-monitoring dispatcher. Queue and scheduler
// adapters transport only opaque run/cursor messages; lookup work is injected
// and always requested through the existing fast, compact contract.

import {
  appendWatchlistScan,
  compactWatchlistResults,
  type CompactWatchlistRecord,
} from '../workspace/watchlist-history.mts';
import {
  assertScheduledMonitorStaticBudget,
  isScheduledMonitorId,
  nextScheduledMonitorRevision,
  pruneScheduledMonitorHistoryToStaticBudget,
  type ScheduledMonitorState,
  type ScheduledRunSource,
  type ScheduledWatchlist,
} from './scheduled-monitor-model.mts';
import {
  SCHEDULED_MONITOR_DELIVERY_SCHEMA,
  SCHEDULED_MONITOR_DELIVERY_VERSION,
} from '../contracts/monitoring-portability.mts';

export {
  SCHEDULED_MONITOR_DELIVERY_SCHEMA,
  SCHEDULED_MONITOR_DELIVERY_VERSION,
} from '../contracts/monitoring-portability.mts';

export const SCHEDULED_MONITOR_LEASE_MS = 75 * 1000;
export const SCHEDULED_MONITOR_STALE_RUN_MS = 2 * 60 * 60 * 1000;
export const SCHEDULED_MONITOR_RETRY_DELAY_MS = 60 * 60 * 1000;
export const MAX_SCHEDULED_RESULT_BYTES = 5 * 1024;

const CONCLUSIVE_AVAILABILITY = new Set(['available', 'registered', 'for_sale', 'expiring']);
const AVAILABILITY_STATES = new Set([...CONCLUSIVE_AVAILABILITY, 'unknown', 'error']);
const TICK_KEYS = new Set(['schema', 'version', 'kind']);
const CONTINUE_KEYS = new Set(['schema', 'version', 'kind', 'runId', 'cursor']);

export interface ScheduledMonitorTickDelivery {
  schema: typeof SCHEDULED_MONITOR_DELIVERY_SCHEMA;
  version: typeof SCHEDULED_MONITOR_DELIVERY_VERSION;
  kind: 'tick';
}

export interface ScheduledMonitorContinueDelivery {
  schema: typeof SCHEDULED_MONITOR_DELIVERY_SCHEMA;
  version: typeof SCHEDULED_MONITOR_DELIVERY_VERSION;
  kind: 'continue';
  runId: string;
  cursor: number;
}

export type ScheduledMonitorDelivery =
  | ScheduledMonitorTickDelivery
  | ScheduledMonitorContinueDelivery;

interface ScheduledMonitorUpdate<Result> {
  state: ScheduledMonitorState;
  result: Result;
  changed?: boolean;
}

type ScheduledMonitorClaimResult =
  | { status: 'ignored' | 'busy' | 'superseded' }
  | { status: 'resumed'; cursor: number }
  | { status: 'claimed'; source: ScheduledRunSource };

type ScheduledMonitorCompletionResult =
  | { status: 'superseded' }
  | { status: 'continue'; cursor: number }
  | {
      status: 'complete' | 'partial';
      changes: number;
      prunedHistoryEvents: number;
    };

export interface ScheduledMonitorRepositoryContract {
  read: () => Promise<ScheduledMonitorState>;
  update: <Result>(
    mutator: (
      state: ScheduledMonitorState,
    ) => ScheduledMonitorUpdate<Result> | Promise<ScheduledMonitorUpdate<Result>>,
  ) => Promise<{ state: ScheduledMonitorState; result: Result }>;
}

export interface ScheduledMonitorDispatcherOptions {
  repository: unknown;
  lookup: (domain: string, options: { fast: true; compact: true }) => Promise<unknown>;
  enqueue: (
    delivery: ScheduledMonitorDelivery,
    options: { deduplicationKey: string },
  ) => Promise<unknown>;
  now?: () => number;
  randomUUID: () => string;
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function entityName(value: unknown): string | null {
  if (typeof value === 'string') return value;
  const record = plainRecord(value);
  if (!record) return null;
  for (const candidate of [record.name, record.org, record.handle]) {
    if (typeof candidate === 'string') return candidate;
  }
  return null;
}

function failedLookupResult(source: ScheduledRunSource): CompactWatchlistRecord {
  const result = compactWatchlistResults([{
    domain: source.domain,
    scanDepth: 'fast',
    availability: 'error',
    mutationTypes: [],
  }])[0];
  if (!result) throw new Error('Scheduled monitoring source is invalid.');
  return result;
}

export function scheduledLookupResult(
  source: ScheduledRunSource,
  response: unknown,
): CompactWatchlistRecord {
  const availability = plainRecord(plainRecord(response)?.availability);
  const availabilityState = availability?.state;
  const result = compactWatchlistResults([{
    domain: source.domain,
    scanDepth: 'fast',
    availability: typeof availabilityState === 'string' && AVAILABILITY_STATES.has(availabilityState)
      ? availabilityState
      : 'unknown',
    registrarName: entityName(availability?.registrar),
    nameservers: availability?.nameservers,
    createdDate: availability?.createdDate,
    expiryDate: availability?.expiryDate,
    privacyProtected: availability?.privacyProtected,
    mutationTypes: [],
  }])[0] || failedLookupResult(source);
  return byteLength(result) <= MAX_SCHEDULED_RESULT_BYTES ? result : failedLookupResult(source);
}

export function normalizeScheduledMonitorDelivery(value: unknown): ScheduledMonitorDelivery | null {
  const record = plainRecord(value);
  if (!record
    || record.schema !== SCHEDULED_MONITOR_DELIVERY_SCHEMA
    || record.version !== SCHEDULED_MONITOR_DELIVERY_VERSION) return null;
  if (record.kind === 'tick' && hasOnlyKeys(record, TICK_KEYS)) {
    return {
      schema: SCHEDULED_MONITOR_DELIVERY_SCHEMA,
      version: SCHEDULED_MONITOR_DELIVERY_VERSION,
      kind: 'tick',
    };
  }
  if (record.kind === 'continue'
    && hasOnlyKeys(record, CONTINUE_KEYS)
    && isScheduledMonitorId(record.runId)
    && Number.isSafeInteger(record.cursor)
    && Number(record.cursor) >= 0
    && Number(record.cursor) <= 100) {
    return {
      schema: SCHEDULED_MONITOR_DELIVERY_SCHEMA,
      version: SCHEDULED_MONITOR_DELIVERY_VERSION,
      kind: 'continue',
      runId: record.runId,
      cursor: Number(record.cursor),
    };
  }
  return null;
}

export function scheduledMonitorTickDelivery(): ScheduledMonitorTickDelivery {
  return {
    schema: SCHEDULED_MONITOR_DELIVERY_SCHEMA,
    version: SCHEDULED_MONITOR_DELIVERY_VERSION,
    kind: 'tick',
  };
}

export function scheduledMonitorContinueDelivery(
  runId: unknown,
  cursor: unknown,
): ScheduledMonitorContinueDelivery | null {
  const delivery = normalizeScheduledMonitorDelivery({
    schema: SCHEDULED_MONITOR_DELIVERY_SCHEMA,
    version: SCHEDULED_MONITOR_DELIVERY_VERSION,
    kind: 'continue',
    runId,
    cursor,
  });
  return delivery?.kind === 'continue' ? delivery : null;
}

function dueTime(record: ScheduledWatchlist): number {
  const parsed = Date.parse(record.nextRunAt || record.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function repositoryContract(value: unknown): value is ScheduledMonitorRepositoryContract {
  const record = plainRecord(value);
  return Boolean(record
    && typeof record.read === 'function'
    && typeof record.update === 'function');
}

export class ScheduledMonitorDispatcher {
  repository: ScheduledMonitorRepositoryContract;
  lookup: ScheduledMonitorDispatcherOptions['lookup'];
  enqueue: ScheduledMonitorDispatcherOptions['enqueue'];
  now: () => number;
  randomUUID: () => string;

  constructor({
    repository,
    lookup,
    enqueue,
    now = () => Date.now(),
    randomUUID,
  }: ScheduledMonitorDispatcherOptions) {
    if (!repositoryContract(repository)) throw new Error('A scheduled monitoring repository is required.');
    if (typeof lookup !== 'function') throw new Error('A scheduled monitoring lookup function is required.');
    if (typeof enqueue !== 'function') throw new Error('A scheduled monitoring queue function is required.');
    if (typeof now !== 'function' || typeof randomUUID !== 'function') {
      throw new Error('Scheduled monitoring clock and identifier functions are required.');
    }
    this.repository = repository;
    this.lookup = lookup;
    this.enqueue = enqueue;
    this.now = now;
    this.randomUUID = randomUUID;
  }

  nowMs(): number {
    const value = this.now();
    if (!Number.isFinite(value)) throw new Error('Scheduled monitoring clock returned an invalid time.');
    return Math.trunc(value);
  }

  newId(): string {
    const value = this.randomUUID();
    if (!isScheduledMonitorId(value)) throw new Error('Scheduled monitoring identifier source returned an invalid value.');
    return value;
  }

  async publish(delivery: unknown, deduplicationKey: string | null = null): Promise<void> {
    const normalized = normalizeScheduledMonitorDelivery(delivery);
    if (!normalized) throw new Error('Scheduled monitoring attempted to publish an invalid delivery.');
    const key = deduplicationKey || (normalized.kind === 'tick'
      ? `scheduled-monitor-tick-${Math.floor(this.nowMs() / 60_000)}`
      : `scheduled-monitor-${normalized.runId}-${normalized.cursor}`);
    await this.enqueue(normalized, { deduplicationKey: key });
  }

  async tick(): Promise<string> {
    const nowMs = this.nowMs();
    const timestamp = new Date(nowMs).toISOString();
    const outcome = await this.repository.update((state) => {
      let changed = false;
      const active = state.activeRun;
      if (active) {
        const updatedAt = Date.parse(active.updatedAt);
        if (!Number.isFinite(updatedAt) || nowMs - updatedAt >= SCHEDULED_MONITOR_STALE_RUN_MS) {
          const watchlist = state.watchlists.find((item) => item.id === active.watchlistId);
          if (watchlist) {
            watchlist.status = active.cursor > 0 ? 'partial' : 'failed';
            watchlist.lastError = active.cursor > 0
              ? `The previous scheduled scan expired after ${active.cursor} of ${active.sources.length} lookups; prior evidence was retained.`
              : 'The previous scheduled scan expired before any lookup completed; prior evidence was retained.';
            watchlist.updatedAt = timestamp;
            watchlist.nextRunAt = new Date(nowMs + SCHEDULED_MONITOR_RETRY_DELAY_MS).toISOString();
          }
          state.activeRun = null;
          changed = true;
        } else {
          const leaseExpiresAt = active.lease ? Date.parse(active.lease.expiresAt) : null;
          if (active.lease
            && leaseExpiresAt !== null
            && Number.isFinite(leaseExpiresAt)
            && leaseExpiresAt > nowMs) {
            return { state, result: { status: 'busy', delivery: null }, changed: false };
          }
          if (active.lease) {
            active.lease = null;
            active.updatedAt = timestamp;
            changed = true;
          }
          return {
            state,
            result: {
              status: 'queued',
              delivery: scheduledMonitorContinueDelivery(active.id, active.cursor),
            },
            changed,
          };
        }
      }

      const due = state.watchlists
        .filter((watchlist) => watchlist.enabled && dueTime(watchlist) <= nowMs)
        .sort((left, right) => dueTime(left) - dueTime(right) || left.id.localeCompare(right.id))[0];
      if (!due) return { state, result: { status: 'idle', delivery: null }, changed };

      assertScheduledMonitorStaticBudget(state);
      const runId = this.newId();
      state.activeRun = {
        id: runId,
        watchlistId: due.id,
        watchlistRevision: due.revision,
        cursor: 0,
        sources: due.sources.map(({ domain }) => ({ domain })),
        results: [],
        errorCount: 0,
        startedAt: timestamp,
        updatedAt: timestamp,
        lease: null,
      };
      due.status = 'queued';
      due.lastError = null;
      due.updatedAt = timestamp;
      return {
        state,
        result: {
          status: 'queued',
          delivery: scheduledMonitorContinueDelivery(runId, 0),
        },
      };
    });
    if (outcome.result.delivery) await this.publish(outcome.result.delivery);
    return outcome.result.status;
  }

  async continue(delivery: unknown): Promise<string> {
    const message = normalizeScheduledMonitorDelivery(delivery);
    if (!message || message.kind !== 'continue') return 'ignored';
    const nowMs = this.nowMs();
    const timestamp = new Date(nowMs).toISOString();
    const leaseId = this.newId();
    const claim = await this.repository.update<ScheduledMonitorClaimResult>((state) => {
      const run = state.activeRun;
      if (!run || run.id !== message.runId || message.cursor > run.cursor) {
        return { state, result: { status: 'ignored' }, changed: false };
      }
      if (message.cursor < run.cursor) {
        return { state, result: { status: 'resumed', cursor: run.cursor }, changed: false };
      }
      if (run.lease && Date.parse(run.lease.expiresAt) > nowMs) {
        return { state, result: { status: 'busy' }, changed: false };
      }
      const source = run.sources[run.cursor];
      if (!source) {
        state.activeRun = null;
        return { state, result: { status: 'superseded' } };
      }
      run.lease = {
        token: leaseId,
        cursor: run.cursor,
        expiresAt: new Date(nowMs + SCHEDULED_MONITOR_LEASE_MS).toISOString(),
      };
      run.updatedAt = timestamp;
      return { state, result: { status: 'claimed', source: structuredClone(source) } };
    });

    if (claim.result.status === 'resumed') {
      await this.publish(scheduledMonitorContinueDelivery(message.runId, claim.result.cursor));
      return 'resumed';
    }
    if (claim.result.status !== 'claimed') return claim.result.status;

    let result;
    try {
      const response = await this.lookup(claim.result.source.domain, { fast: true, compact: true });
      result = scheduledLookupResult(claim.result.source, response);
    } catch {
      result = failedLookupResult(claim.result.source);
    }
    const inconclusive = typeof result.availability !== 'string'
      || !CONCLUSIVE_AVAILABILITY.has(result.availability);
    const completedMs = this.nowMs();
    const completedAt = new Date(completedMs).toISOString();
    const completion = await this.repository.update<ScheduledMonitorCompletionResult>((state) => {
      const run = state.activeRun;
      if (!run
        || run.id !== message.runId
        || run.cursor !== message.cursor
        || run.lease?.token !== leaseId) {
        return { state, result: { status: 'superseded' }, changed: false };
      }
      run.results.push(result);
      run.cursor += 1;
      run.errorCount += inconclusive ? 1 : 0;
      run.updatedAt = completedAt;
      run.lease = null;
      if (run.cursor < run.sources.length) {
        return { state, result: { status: 'continue', cursor: run.cursor } };
      }

      const watchlist = state.watchlists.find((item) => item.id === run.watchlistId);
      if (!watchlist || !watchlist.enabled || watchlist.revision !== run.watchlistRevision) {
        state.activeRun = null;
        return { state, result: { status: 'superseded' } };
      }
      const mutationTypes = new Map(watchlist.sources.map((source) => [source.domain, source.mutationTypes]));
      const completedResults = run.results.map((item) => ({
        ...item,
        mutationTypes: mutationTypes.get(item.domain) || [],
      }));
      const appended = appendWatchlistScan(watchlist.entry, completedResults, {
        checkedAt: completedAt,
        mode: 'fast',
      });
      const status = run.errorCount > 0 ? 'partial' : 'complete';
      watchlist.entry = appended.entry;
      watchlist.lastRunAt = completedAt;
      watchlist.nextRunAt = new Date(completedMs + watchlist.intervalHours * 60 * 60 * 1000).toISOString();
      watchlist.status = status;
      watchlist.lastError = run.errorCount > 0
        ? `${run.errorCount} of ${run.sources.length} scheduled lookups were inconclusive; prior conclusive evidence was retained.`
        : null;
      watchlist.updatedAt = completedAt;
      watchlist.revision = nextScheduledMonitorRevision(watchlist.revision);
      state.activeRun = null;
      const boundedState = pruneScheduledMonitorHistoryToStaticBudget(state);
      return {
        state: boundedState.state,
        result: {
          status,
          changes: appended.changes.length,
          prunedHistoryEvents: boundedState.pruned,
        },
      };
    });

    if (completion.result.status === 'continue') {
      await this.publish(scheduledMonitorContinueDelivery(message.runId, completion.result.cursor));
    } else if (completion.result.status === 'complete' || completion.result.status === 'partial') {
      await this.publish(
        scheduledMonitorTickDelivery(),
        `scheduled-monitor-tick-after-${message.runId}`,
      );
    }
    return completion.result.status;
  }

  async process(value: unknown): Promise<string> {
    const delivery = normalizeScheduledMonitorDelivery(value);
    if (!delivery) return 'ignored';
    return delivery.kind === 'tick' ? this.tick() : this.continue(delivery);
  }
}
