import { plannedLookupSources } from '../evidence/lookup-collection-receipt.mts';
import { exact, exactOptional } from '../evidence/artifact-structure.mts';
import { normalizeDomain } from '../evidence/domain-name.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { MAX_WATCHLIST_DOMAINS, watchlistActiveDomains } from '../workspace/watchlist-history.mts';
import { normalizeWatchlistStore } from '../workspace/watchlist-store.mts';
import { WATCH_PRIORITIES, type WatchPriority } from '../workspace/brand-candidate-workflow.mts';
import { ALLOWED_SCHEDULE_INTERVAL_HOURS, MAX_SCHEDULED_DOMAINS } from './scheduled-monitor-model.mts';
import { MONITORING_PLAN_INPUT_SCHEMA, MONITORING_PLAN_SCHEMA, MONITORING_PLAN_VERSION, MONITORING_PLAN_SUPPORTED_VERSIONS, MONITORING_PURPOSES } from '../contracts/monitoring-plan.mts';
import type { MonitoringPurpose } from '../contracts/monitoring-plan.mts';

export type MonitoringTargetPolicy = Readonly<{ domain: string; purpose: MonitoringPurpose; intervalHours: number; priority: WatchPriority }>;
export function monitoringPriorityRank(priority: WatchPriority): number {
  return priority === 'unassigned' ? WATCH_PRIORITIES.length : WATCH_PRIORITIES.findIndex(item => item.value === priority);
}

/** Read-only workload preview. It never grants collection or changes a schedule. */
export function buildMonitoringPlan(value: unknown, generatedAt = new Date().toISOString()) {
  const input = exactOptional(value, ['schema', 'version', 'watchlists', 'purpose', 'intervalHours'], ['targetPolicies', 'maxLookupsPerDay'], 'Monitoring plan input');
  if (input.schema !== MONITORING_PLAN_INPUT_SCHEMA || !MONITORING_PLAN_SUPPORTED_VERSIONS.includes(input.version as number)
    || input.version === 1 && (input.targetPolicies !== undefined || input.maxLookupsPerDay !== undefined)) throw new TypeError('Monitoring plan schema or version is unsupported.');
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
  if (input.targetPolicies !== undefined && (!Array.isArray(input.targetPolicies) || input.targetPolicies.length > MAX_WATCHLIST_DOMAINS)) throw new TypeError('Monitoring target policies exceed the selected target bound.');
  const policies = new Map<string, { purpose: typeof purpose.value; mode: typeof purpose.mode; intervalHours: number; priority: WatchPriority }>();
  for (const value of (input.targetPolicies ?? []) as unknown[]) {
    const item = exact(value, ['domain', 'purpose', 'intervalHours', 'priority'], 'Monitoring target policy');
    const selectedPurpose = MONITORING_PURPOSES.find(candidate => candidate.value === item.purpose);
    const domain = typeof item.domain === 'string' && item.domain.length <= 253 ? normalizeDomain(item.domain) : '';
    if (!domain || domain !== item.domain || !members.has(domain) || policies.has(domain) || !selectedPurpose
      || typeof item.intervalHours !== 'number' || !ALLOWED_SCHEDULE_INTERVAL_HOURS.includes(item.intervalHours)
      || !WATCH_PRIORITIES.some(priority => priority.value === item.priority)) throw new TypeError('Each target policy must select one active domain, supported purpose, cadence and independent priority.');
    policies.set(domain, { purpose: selectedPurpose.value, mode: selectedPurpose.mode, intervalHours: item.intervalHours, priority: item.priority as WatchPriority });
  }
  const maxLookupsPerDay = input.maxLookupsPerDay ?? MAX_SCHEDULED_DOMAINS;
  const maximumDailyLookups = MAX_SCHEDULED_DOMAINS * 24 / Math.min(...ALLOWED_SCHEDULE_INTERVAL_HOURS);
  if (!Number.isSafeInteger(maxLookupsPerDay) || Number(maxLookupsPerDay) < 1 || Number(maxLookupsPerDay) > maximumDailyLookups) throw new TypeError(`The local daily attempt quota must be 1–${maximumDailyLookups}.`);
  const targets = [...members].sort(([left], [right]) => left.localeCompare(right)).map(([domain, item]) => ({
    domain, watchlists: item.watchlists, priorities: WATCH_PRIORITIES.filter(priority => item.priorities.has(priority.value)).map(priority => priority.value),
    hasRetainedObservation: item.observed,
    ...(policies.get(domain) ?? { purpose: purpose.value, mode: purpose.mode, intervalHours: input.intervalHours as number,
      priority: [...item.priorities].sort((a, b) => monitoringPriorityRank(a) - monitoringPriorityRank(b))[0] ?? 'unassigned' }),
  }));
  const checksPerWeek = 168 / input.intervalHours;
  const totalMemberships = targets.reduce((total, target) => total + target.watchlists.length, 0);
  return Object.freeze({
    schema: MONITORING_PLAN_SCHEMA, version: MONITORING_PLAN_VERSION, generatedAt: at,
    state: pausedWatchlists.length ? 'review_required' as const : 'plan_only' as const,
    purpose: purpose.value, mode: purpose.mode, intervalHours: input.intervalHours,
    targets, pausedWatchlists,
    counts: { distinctTargets: targets.length, watchlistMemberships: totalMemberships, sharedMemberships: totalMemberships - targets.length,
      withoutRetainedObservation: targets.filter(target => !target.hasRetainedObservation).length,
      checksPerTargetPerWeek: targets.every(target => target.intervalHours === input.intervalHours) ? checksPerWeek : null,
      plannedLookupsPerWeek: targets.reduce((total, target) => total + 168 / target.intervalHours, 0) },
    sources: [...new Set(targets.length ? targets.flatMap(target => plannedLookupSources('domain', target.mode)) : plannedLookupSources('domain', purpose.mode))],
    localLimits: { maxLookupsPerDay: Number(maxLookupsPerDay) },
    estimates: { networkRequests: null, storageBytes: null, cost: null },
    execution: {
      browser: 'Application must remain open; this preview starts no checks.',
      local: 'monitor-tick previews this selection offline; --approve-network runs one bounded local cycle with a private resumable state file. An external scheduler is optional and is not installed automatically.',
      hosted: { capacity: MAX_SCHEDULED_DOMAINS, targetCountWithinCapacity: targets.length <= MAX_SCHEDULED_DOMAINS,
        collectionModeCompatible: targets.every(target => target.mode === 'fast'), enabledByPlan: false },
    },
    networkRequestsMade: false, changesSchedules: false,
    limitations: [
      'Workload assumes every target is checked at its selected interval. Overlapping memberships are counted once; purpose, cadence and priority remain independent.',
      'Actual requests, storage and cost depend on enabled sources, cache state, referrals, failures and the execution environment; no numeric estimate is invented.',
      'Review priority is retained context, not a collection cadence, Risk score or permission to collect. No scan or background schedule is enabled.',
    ],
  });
}
