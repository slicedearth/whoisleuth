// Bounded scheduled-function execution for hosted monitoring. Deliveries live
// only for the duration of one invocation; durable progress remains in the
// encrypted repository, so the next scheduled tick can resume after a soft
// deadline, provider failure, or runtime termination without a public queue.

import {
  normalizeScheduledMonitorDelivery,
  ScheduledMonitorDispatcher,
  scheduledMonitorTickDelivery,
} from '../frontend/src/lib/analysis/scheduled-monitor-dispatcher.js';

type ScheduledMonitorCycleOptions = {
  repository: unknown;
  lookup: (domain: string, options: { fast: true; compact: true }) => Promise<unknown>;
  now?: () => number;
  randomUUID: () => string;
};

type QueuedDelivery = {
  delivery: Record<string, unknown>;
  deduplicationKey: string;
};

const MAX_CYCLE_LOOKUPS = 2;
const MAX_CYCLE_DELIVERIES = 8;
const MAX_CYCLE_MS = 24 * 1000;
// A fast lookup can spend up to 12 seconds across registry RDAP endpoints,
// then up to 4 seconds proving a positive DNS delegation when RDAP is
// unavailable. Do not begin another lookup unless that entire bounded path
// still fits inside the soft cycle budget.
const MIN_LOOKUP_WINDOW_MS = 16 * 1000;
const MAX_DEDUPLICATION_KEY_LENGTH = 200;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;

function validDeduplicationKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_DEDUPLICATION_KEY_LENGTH
    && !CONTROL_RE.test(value);
}

function finiteTime(now: () => number): number {
  const value = now();
  if (!Number.isFinite(value)) throw new Error('Scheduled monitoring clock returned an invalid time.');
  return Math.trunc(value);
}

function validateCycleOptions(options: ScheduledMonitorCycleOptions): void {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Scheduled monitoring cycle options are required.');
  }
  if (typeof options.lookup !== 'function') {
    throw new Error('A scheduled monitoring lookup function is required.');
  }
  if (typeof options.randomUUID !== 'function') {
    throw new Error('A scheduled monitoring identifier function is required.');
  }
  if (options.now !== undefined && typeof options.now !== 'function') {
    throw new Error('A scheduled monitoring clock function is required.');
  }
}

async function runScheduledMonitorCycle(options: ScheduledMonitorCycleOptions) {
  validateCycleOptions(options);
  const now = options.now || Date.now;
  const startedAt = finiteTime(now);
  const pending: QueuedDelivery[] = [];
  const deduplicationKeys = new Set<string>();

  const enqueue = async (value: unknown, enqueueOptions: { deduplicationKey?: unknown } = {}) => {
    const delivery = normalizeScheduledMonitorDelivery(value);
    if (!delivery || !validDeduplicationKey(enqueueOptions.deduplicationKey)) {
      throw new Error('Scheduled monitoring produced an invalid in-invocation delivery.');
    }
    if (deduplicationKeys.has(enqueueOptions.deduplicationKey)) return;
    if (pending.length >= MAX_CYCLE_DELIVERIES) {
      throw new Error('Scheduled monitoring exceeded the in-invocation delivery limit.');
    }
    deduplicationKeys.add(enqueueOptions.deduplicationKey);
    pending.push({
      delivery: structuredClone(delivery),
      deduplicationKey: enqueueOptions.deduplicationKey,
    });
  };

  const dispatcher = new ScheduledMonitorDispatcher({
    repository: options.repository,
    lookup: options.lookup,
    enqueue,
    now,
    randomUUID: options.randomUUID,
  });
  await enqueue(scheduledMonitorTickDelivery(), {
    deduplicationKey: `scheduled-monitor-cycle-${Math.floor(startedAt / 60_000)}`,
  });

  let processedDeliveries = 0;
  let lookupDeliveries = 0;
  let cycleStatus = 'idle';
  let stopReason: 'complete' | 'lookup_limit' | 'deadline' | 'delivery_limit' = 'complete';
  while (pending.length > 0 && processedDeliveries < MAX_CYCLE_DELIVERIES) {
    const next = pending[0];
    const isLookup = next.delivery.kind === 'continue';
    const elapsed = Math.max(0, finiteTime(now) - startedAt);
    if (isLookup && lookupDeliveries >= MAX_CYCLE_LOOKUPS) {
      stopReason = 'lookup_limit';
      break;
    }
    if (isLookup && elapsed > MAX_CYCLE_MS - MIN_LOOKUP_WINDOW_MS) {
      stopReason = 'deadline';
      break;
    }
    pending.shift();
    const deliveryStatus = await dispatcher.process(next.delivery);
    if (deliveryStatus === 'complete' || deliveryStatus === 'partial') {
      cycleStatus = deliveryStatus;
    } else if (cycleStatus === 'idle' && deliveryStatus !== 'idle') {
      cycleStatus = deliveryStatus;
    }
    processedDeliveries += 1;
    lookupDeliveries += isLookup ? 1 : 0;
  }
  if (pending.length > 0 && stopReason === 'complete') {
    stopReason = 'delivery_limit';
  }

  return {
    status: pending.length > 0 ? 'deferred' : cycleStatus,
    stopReason,
    processedDeliveries,
    lookupDeliveries,
    deferredDeliveries: pending.length,
  };
}

export {
  MAX_CYCLE_DELIVERIES,
  MAX_CYCLE_LOOKUPS,
  MAX_CYCLE_MS,
  MIN_LOOKUP_WINDOW_MS,
  runScheduledMonitorCycle,
};
export type { ScheduledMonitorCycleOptions };
