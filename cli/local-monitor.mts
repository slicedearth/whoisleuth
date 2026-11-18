import { randomUUID } from 'node:crypto';
import { classifyQuery } from '../lib/classify.mts';
import { runScheduledMonitorCycle, MAX_CYCLE_LOOKUPS } from '../lib/scheduled-monitor-cycle.mts';
import { parseBoundedJson } from '../packages/analysis/bounded-json.mts';
import { exact } from '../packages/evidence/artifact-structure.mts';
import { sha256ArtifactDigestV2 } from '../packages/evidence/artifact-integrity.mts';
import { normalizeExplicitIsoTimestamp } from '../packages/evidence/observation.mts';
import { buildMonitoringPlan, monitoringPriorityRank } from '../packages/monitoring/monitoring-plan.mts';
import { createScheduledWatchlist, emptyScheduledMonitorState, normalizeScheduledMonitorStateWithRecovery,
  MAX_SCHEDULED_DOMAINS, type ScheduledMonitorState } from '../packages/monitoring/scheduled-monitor-model.mts';
import type { ScheduledMonitorRepositoryContract } from '../packages/monitoring/scheduled-monitor-dispatcher.mts';
import { buildWatchlistExport } from '../packages/workspace/watchlist-store.mts';
import { LOCAL_MONITOR_STATE_SCHEMA, LOCAL_MONITOR_STATE_VERSION, MAX_LOCAL_MONITOR_STATE_BYTES, LOCAL_MONITOR_STALE_RUN_MS } from '../packages/contracts/monitoring-plan.mts';
import { MAX_WATCHLIST_IMPORT_BYTES } from '../packages/contracts/workspace-portability.mts';
import { CliUsageError } from './errors.mts';
import type { LookupDependency } from './runner-types.mts';

type MonitorPlan = ReturnType<typeof buildMonitoringPlan>;
type LocalState = { schema: typeof LOCAL_MONITOR_STATE_SCHEMA; version: typeof LOCAL_MONITOR_STATE_VERSION;
  configurationDigestSha256: string; quota: { day: string; attempts: number }; scheduler: ScheduledMonitorState };

export function readLocalMonitoringPlan(raw: string, at: string): MonitorPlan {
  return buildMonitoringPlan(parseBoundedJson(raw, { maximumBytes: MAX_WATCHLIST_IMPORT_BYTES, label: 'Monitoring plan' }), at);
}

/** The execution identity excludes private watchlist notes and saved evidence. */
export async function localMonitorConfiguration(plan: MonitorPlan) {
  if (plan.pausedWatchlists.length || !plan.targets.length || plan.targets.length > MAX_SCHEDULED_DOMAINS) throw new CliUsageError(`Local monitoring requires 1–${MAX_SCHEDULED_DOMAINS} active targets without membership recovery.`);
  if (plan.localLimits.maxLookupsPerDay < plan.targets.length) throw new CliUsageError('The daily quota must allow at least one attempt for every selected target, so a partially completed group cannot starve later targets.');
  const targets = plan.targets.map(({ domain, purpose, mode, intervalHours, priority }) => {
    const target = classifyQuery(domain);
    if (target.type !== 'domain' || target.isSubdomain || target.inputHostname !== domain) throw new CliUsageError('Local monitoring supports exact registrable-domain selections only; child hostnames are not silently retargeted.');
    return { domain, purpose, mode, intervalHours, priority };
  });
  return { targets, digest: await sha256ArtifactDigestV2({ targets, limits: plan.localLimits }) };
}

export async function prepareLocalMonitorState(plan: MonitorPlan, raw: string | null, at: string): Promise<LocalState> {
  const configuration = await localMonitorConfiguration(plan);
  const time = normalizeExplicitIsoTimestamp(at);
  if (!time) throw new CliUsageError('Local monitoring requires a valid clock.');
  if (raw !== null) {
    const input = exact(parseBoundedJson(raw, { maximumBytes: MAX_LOCAL_MONITOR_STATE_BYTES, label: 'Local monitor state' }),
      ['schema', 'version', 'configurationDigestSha256', 'quota', 'scheduler'], 'Local monitor state');
    const quota = exact(input.quota, ['day', 'attempts'], 'Local monitor quota');
    if (input.schema !== LOCAL_MONITOR_STATE_SCHEMA || input.version !== LOCAL_MONITOR_STATE_VERSION
      || input.configurationDigestSha256 !== configuration.digest || typeof quota.day !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/u.test(quota.day) || normalizeExplicitIsoTimestamp(`${quota.day}T00:00:00.000Z`)?.slice(0, 10) !== quota.day
      || !Number.isSafeInteger(quota.attempts) || Number(quota.attempts) < 0 || Number(quota.attempts) > plan.localLimits.maxLookupsPerDay) {
      throw new CliUsageError('Local monitor state is unsupported or differs from the selected configuration. Keep the original and deliberately choose a new state file.');
    }
    const inspected = normalizeScheduledMonitorStateWithRecovery(input.scheduler);
    if (inspected.recovery?.recoveredItems) throw new CliUsageError('Local monitor state needs recovery; no collection started and no evidence was pruned.');
    const expected = initialScheduler(plan, time);
    if (inspected.state.watchlists.length !== expected.watchlists.length || expected.watchlists.some(group => {
      const retained = inspected.state.watchlists.find(item => item.id === group.id);
      return !retained?.enabled || retained.intervalHours !== group.intervalHours
        || JSON.stringify(retained.sources) !== JSON.stringify(group.sources);
    })) throw new CliUsageError('Local monitor membership differs from its configuration. No collection started.');
    return { schema: LOCAL_MONITOR_STATE_SCHEMA, version: LOCAL_MONITOR_STATE_VERSION, configurationDigestSha256: configuration.digest,
      quota: { day: quota.day, attempts: Number(quota.attempts) }, scheduler: inspected.state };
  }
  return { schema: LOCAL_MONITOR_STATE_SCHEMA, version: LOCAL_MONITOR_STATE_VERSION, configurationDigestSha256: configuration.digest,
    quota: { day: time.slice(0, 10), attempts: 0 }, scheduler: initialScheduler(plan, time) };
}

function monitoringGroups(plan: MonitorPlan) {
  const groups = new Map<string, typeof plan.targets>();
  for (const target of plan.targets) {
    const key = `${target.mode}-${target.intervalHours}`, members = groups.get(key) ?? [];
    members.push(target); groups.set(key, members);
  }
  return [...groups].map(([key, members]) => {
    const priority = [...members].sort((a, b) => monitoringPriorityRank(a.priority) - monitoringPriorityRank(b.priority))[0]!.priority;
    return { id: `local-${priority}-monitor-${key}`, members, mode: members[0]!.mode };
  });
}
function initialScheduler(plan: MonitorPlan, at: string): ScheduledMonitorState {
  const state = emptyScheduledMonitorState();
  state.watchlists = monitoringGroups(plan).map(({ id, members }) => createScheduledWatchlist({ id,
    name: `${members[0]!.purpose} · ${members[0]!.intervalHours} hours`, intervalHours: members[0]!.intervalHours, now: at,
    // The first actual local cycle establishes its own baseline. Differing
    // observations from overlapping watchlists are never arbitrarily merged.
    entry: { updatedAt: null, results: [...members].sort((a, b) => monitoringPriorityRank(a.priority) - monitoringPriorityRank(b.priority) || a.domain.localeCompare(b.domain))
      .map(target => ({ domain: target.domain, scanDepth: 'fast', availability: 'unknown', mutationTypes: [] })), history: [], baseline: [] },
  }));
  return state;
}

/** One bounded invocation, not another scheduler or an installed background job. */
export async function runLocalMonitorTick(options: Readonly<{ plan: MonitorPlan; state: LocalState; lookup: LookupDependency;
  persist: (text: string) => Promise<void>; now: () => string; signal?: AbortSignal }>) {
  let current = structuredClone(options.state);
  const at = options.now(), nowMs = Date.parse(at);
  if (!Number.isFinite(nowMs) || at.slice(0, 10) < current.quota.day) throw new CliUsageError('The local monitoring clock moved behind its retained quota day. No collection started.');
  if (at.slice(0, 10) > current.quota.day) current.quota = { day: at.slice(0, 10), attempts: 0 };
  const pendingWrites = new Set<Promise<void>>();
  const persist = async () => {
    const text = `${JSON.stringify(current, null, 2)}\n`;
    if (Buffer.byteLength(text) > MAX_LOCAL_MONITOR_STATE_BYTES) throw new CliUsageError('Local monitor state exceeds its byte bound.');
    const write = options.persist(text);
    pendingWrites.add(write);
    try { await write; } finally { pendingWrites.delete(write); }
  };
  const remaining = options.plan.localLimits.maxLookupsPerDay - current.quota.attempts;
  if (!remaining) return { status: 'deferred', stopReason: 'daily_quota', lookupDeliveries: 0, state: current, watchlists: localMonitorWatchlists(current, at) };
  const repository: ScheduledMonitorRepositoryContract = {
    read: async () => structuredClone(current.scheduler),
    update: async (mutator, operation = {}) => {
      operation.signal?.throwIfAborted();
      const update = await mutator(structuredClone(current.scheduler));
      operation.signal?.throwIfAborted();
      if (update.changed !== false) {
        const inspected = normalizeScheduledMonitorStateWithRecovery(update.state);
        if (inspected.recovery?.recoveredItems) throw new Error('Local monitor produced non-canonical progress.');
        current.scheduler = inspected.state;
        await persist();
      }
      return { state: structuredClone(current.scheduler), result: update.result };
    },
  };
  const watchlistModes = new Map(monitoringGroups(options.plan).map(group => [group.id, group.mode]));
  let cycle;
  try { cycle = await runScheduledMonitorCycle({ repository, watchlistModes, staleRunMs: LOCAL_MONITOR_STALE_RUN_MS,
    lookupLimit: Math.min(remaining, MAX_CYCLE_LOOKUPS), now: () => Date.parse(options.now()), randomUUID,
    ...(options.signal ? { signal: options.signal } : {}),
    lookup: async (domain, request) => {
      request.signal?.throwIfAborted();
      current.quota.attempts += 1;
      await persist(); // Charge the durable attempt before handing control to any collector.
      request.signal?.throwIfAborted();
      return options.lookup(classifyQuery(domain), request);
    },
  }); } finally {
    // A deadline may stop delivery after an atomic write was dispatched. Keep
    // the file lease until that write settles before another process can own it.
    await Promise.allSettled([...pendingWrites]);
  }
  return { ...cycle, state: current, watchlists: localMonitorWatchlists(current, options.now()) };
}

function localMonitorWatchlists(state: LocalState, at: string) {
  return buildWatchlistExport(Object.fromEntries(state.scheduler.watchlists.map(item => [item.name, item.entry])), at);
}
