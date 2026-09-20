// Bounded scheduled-function execution for hosted monitoring. Deliveries live
// only for the duration of one invocation; durable progress remains in the
// encrypted repository, so the next scheduled tick can resume after a soft
// deadline, provider failure, or runtime termination without a public queue.

import {
  normalizeScheduledMonitorDelivery,
  ScheduledMonitorDispatcher,
  scheduledMonitorTickDelivery,
  type ScheduledMonitorDelivery,
  type ScheduledMonitorLookupOptions,
} from '../packages/monitoring/scheduled-monitor-dispatcher.mts';
import { abortable } from './abort.mts';
import { SCHEDULED_MONITOR_CYCLE_BUDGET } from '../packages/contracts/scheduled-monitor-bounds.mts';

type ScheduledMonitorCycleOptions = {
  repository: unknown;
  lookup: (domain: string, options: ScheduledMonitorLookupOptions) => Promise<unknown>;
  now?: () => number;
  randomUUID: () => string;
};

type QueuedDelivery = {
  delivery: ScheduledMonitorDelivery;
  deduplicationKey: string;
};

const MAX_CYCLE_LOOKUPS = SCHEDULED_MONITOR_CYCLE_BUDGET.maxLookups;
const MAX_CYCLE_DELIVERIES = SCHEDULED_MONITOR_CYCLE_BUDGET.maxProcessedDeliveries;
const MAX_CYCLE_MS = SCHEDULED_MONITOR_CYCLE_BUDGET.softCycleBudgetMs;
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
  const controller = new AbortController();
  const expire = () => controller.abort(new DOMException('Scheduled monitoring cycle deadline reached.', 'TimeoutError'));
  const checkDeadline = () => {
    if (finiteTime(now) - startedAt >= MAX_CYCLE_MS) expire();
    controller.signal.throwIfAborted();
  };
  const timer = setTimeout(expire, MAX_CYCLE_MS);
  const pending: QueuedDelivery[] = [];
  const deduplicationKeys = new Set<string>();

  const enqueue = async (value: unknown, enqueueOptions: { deduplicationKey?: unknown } = {}) => {
    checkDeadline();
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

  let processedDeliveries = 0;
  let lookupDeliveries = 0;
  let cycleStatus = 'idle';
  let stopReason: 'complete' | 'lookup_limit' | 'deadline' | 'delivery_limit' = 'complete';
  try {
    const dispatcher = new ScheduledMonitorDispatcher({
      // A runtime factory binds the provider client to this invocation's signal.
      // Direct repository instances remain useful to management and local tests.
      repository: typeof options.repository === 'function'
        ? options.repository(controller.signal)
        : options.repository,
      lookup: async (domain, requestOptions) => {
        checkDeadline();
        lookupDeliveries += 1;
        const result = await abortable(() => options.lookup(domain, requestOptions), controller.signal);
        checkDeadline();
        return result;
      },
      enqueue,
      now,
      randomUUID: options.randomUUID,
      signal: controller.signal,
    });
    await enqueue(scheduledMonitorTickDelivery(), {
      deduplicationKey: `scheduled-monitor-cycle-${Math.floor(startedAt / 60_000)}`,
    });

    while (pending.length > 0 && processedDeliveries < MAX_CYCLE_DELIVERIES) {
      checkDeadline();
      const next = pending[0];
      if (!next) break;
      const isLookup = next.delivery.kind === 'continue';
      if (isLookup && lookupDeliveries >= MAX_CYCLE_LOOKUPS) {
        stopReason = 'lookup_limit';
        break;
      }
      const deliveryStatus = await abortable(() => dispatcher.process(next.delivery), controller.signal);
      checkDeadline();
      pending.shift();
      if (deliveryStatus === 'complete' || deliveryStatus === 'partial') {
        cycleStatus = deliveryStatus;
      } else if (cycleStatus === 'idle' && deliveryStatus !== 'idle') {
        cycleStatus = deliveryStatus;
      }
      processedDeliveries += 1;
    }
    if (pending.length > 0 && stopReason === 'complete') {
      stopReason = 'delivery_limit';
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    // A dispatched storage write may have committed before cancellation. Do
    // not retry it or infer rollback: the next tick rereads the durable state.
    stopReason = 'deadline';
  } finally {
    clearTimeout(timer);
  }

  return {
    status: stopReason === 'deadline' || pending.length > 0 ? 'deferred' : cycleStatus,
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
  runScheduledMonitorCycle,
};
export type { ScheduledMonitorCycleOptions };
