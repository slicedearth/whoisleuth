import { plannedLookupSources } from '../evidence/lookup-collection-receipt.mts';
import { exact } from '../evidence/artifact-structure.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { MAX_WATCHLIST_DOMAINS, watchlistActiveDomains } from '../workspace/watchlist-history.mts';
import { normalizeWatchlistStore } from '../workspace/watchlist-store.mts';
import { WATCH_PRIORITIES, type WatchPriority } from '../workspace/brand-candidate-workflow.mts';
import { ALLOWED_SCHEDULE_INTERVAL_HOURS, MAX_SCHEDULED_DOMAINS } from './scheduled-monitor-model.mts';
import { MONITORING_PLAN_INPUT_SCHEMA, MONITORING_PLAN_SCHEMA, MONITORING_PLAN_VERSION, MONITORING_PURPOSES } from '../contracts/monitoring-plan.mts';

/** Read-only workload preview. It never grants collection or changes a schedule. */
export function buildMonitoringPlan(value: unknown, generatedAt = new Date().toISOString()) {
  const input = exact(value, ['schema', 'version', 'watchlists', 'purpose', 'intervalHours'], 'Monitoring plan input');
  if (input.schema !== MONITORING_PLAN_INPUT_SCHEMA || input.version !== MONITORING_PLAN_VERSION) throw new TypeError('Monitoring plan schema or version is unsupported.');
  const purpose = MONITORING_PURPOSES.find(candidate => candidate.value === input.purpose);
  const at = normalizeExplicitIsoTimestamp(generatedAt);
  if (!purpose || !at || typeof input.intervalHours !== 'number' || !ALLOWED_SCHEDULE_INTERVAL_HOURS.includes(input.intervalHours)) throw new TypeError('Choose a supported monitoring purpose, interval and review time.');
  const store = normalizeWatchlistStore(input.watchlists);
  const members = new Map<string, { watchlists: string[]; priorities: Set<WatchPriority>; observed: boolean }>();
  const pausedWatchlists: string[] = [];
  for (const [name, entry] of Object.entries(store.watchlists)) {
    if (entry.membershipRecovery) { pausedWatchlists.push(name); continue; }
    const metadata = new Map(entry.domainMetadata.map(item => [item.domain, item]));
    const observed = new Set(entry.results.map(item => item.domain));
    for (const domain of watchlistActiveDomains(entry)) {
      let member = members.get(domain);
      if (!member) {
        if (members.size >= MAX_WATCHLIST_DOMAINS) throw new TypeError(`Select at most ${MAX_WATCHLIST_DOMAINS} distinct monitoring targets per plan.`);
        member = { watchlists: [], priorities: new Set(), observed: false };
        members.set(domain, member);
      }
      member.watchlists.push(name);
      for (const context of metadata.get(domain)?.contexts ?? []) member.priorities.add(context.priority);
      member.observed ||= observed.has(domain);
    }
  }
  const targets = [...members].sort(([left], [right]) => left.localeCompare(right)).map(([domain, item]) => ({
    domain, watchlists: item.watchlists, priorities: WATCH_PRIORITIES.filter(priority => item.priorities.has(priority.value)).map(priority => priority.value),
    hasRetainedObservation: item.observed,
  }));
  const checksPerWeek = 168 / input.intervalHours;
  const totalMemberships = targets.reduce((total, target) => total + target.watchlists.length, 0);
  return Object.freeze({
    schema: MONITORING_PLAN_SCHEMA, version: MONITORING_PLAN_VERSION, generatedAt: at,
    state: pausedWatchlists.length ? 'review_required' as const : 'plan_only' as const,
    purpose: purpose.value, mode: purpose.mode, intervalHours: input.intervalHours,
    targets, pausedWatchlists,
    counts: { distinctTargets: targets.length, watchlistMemberships: totalMemberships, sharedMemberships: totalMemberships - targets.length,
      withoutRetainedObservation: targets.filter(target => !target.hasRetainedObservation).length, checksPerTargetPerWeek: checksPerWeek,
      plannedLookupsPerWeek: targets.length * checksPerWeek },
    sources: plannedLookupSources('domain', purpose.mode),
    estimates: { networkRequests: null, storageBytes: null, cost: null },
    execution: {
      browser: 'Application must remain open; this preview starts no checks.',
      local: 'Requires an explicitly configured external scheduler and a running local process.',
      hosted: { capacity: MAX_SCHEDULED_DOMAINS, targetCountWithinCapacity: targets.length <= MAX_SCHEDULED_DOMAINS,
        collectionModeCompatible: purpose.mode === 'fast', enabledByPlan: false },
    },
    networkRequestsMade: false, changesSchedules: false,
    limitations: [
      'Workload assumes every target is checked at the selected interval. Compatible overlapping memberships are counted once; this preview does not change the dispatcher.',
      'Actual requests, storage and cost depend on enabled sources, cache state, referrals, failures and the execution environment; no numeric estimate is invented.',
      'Review priority is retained context, not a collection cadence, Risk score or permission to collect. No scan or background schedule is enabled.',
    ],
  });
}
