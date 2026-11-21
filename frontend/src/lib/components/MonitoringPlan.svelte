<script lang="ts">
  import type { WatchlistEntry } from '#lib/watchlists.ts';
  import { buildMonitoringPlan, type MonitoringTargetPolicy } from '../../../../packages/monitoring/monitoring-plan.mts';
  import { MONITORING_PLAN_INPUT_SCHEMA, MONITORING_PLAN_VERSION, MONITORING_PURPOSES, type MonitoringPurpose } from '../../../../packages/contracts/monitoring-plan.mts';
  import { ALLOWED_SCHEDULE_INTERVAL_HOURS, MAX_SCHEDULED_DOMAINS } from '../../../../packages/monitoring/scheduled-monitor-model.mts';
  import { WATCH_PRIORITIES } from '../../../../packages/workspace/brand-candidate-workflow.mts';
  import { downloadLocalFile } from '../download-local-file';
  import { tokenLabel } from '../../../../packages/analysis/display-label.mts';
  import { LOOKUP_SOURCE_LABELS } from '../../../../packages/evidence/lookup-collection-review.mts';

  let { name, entry }: { name: string; entry: WatchlistEntry } = $props();
  let purpose = $state<MonitoringPurpose>('registration');
  let intervalHours = $state(24);
  let policies = $state<Record<string, MonitoringTargetPolicy>>({});
  let selectedDomain = $state('');
  let maxLookupsPerDay = $state(MAX_SCHEDULED_DOMAINS);
  const baseInput = $derived({ schema: MONITORING_PLAN_INPUT_SCHEMA, version: MONITORING_PLAN_VERSION,
    watchlists: { [name]: entry }, purpose, intervalHours });
  const defaults = $derived(buildMonitoringPlan(baseInput));
  const input = $derived({ ...baseInput, targetPolicies: Object.values(policies).filter(policy => defaults.targets.some(target => target.domain === policy.domain)), maxLookupsPerDay });
  const plan = $derived(buildMonitoringPlan(input));
  const selected = $derived(plan.targets.find(target => target.domain === selectedDomain) ?? plan.targets[0]);
  const dailyOptions = $derived([...new Set([Math.min(MAX_SCHEDULED_DOMAINS, Math.max(1, plan.targets.length)), MAX_SCHEDULED_DOMAINS,
    MAX_SCHEDULED_DOMAINS * 24 / Math.min(...ALLOWED_SCHEDULE_INTERVAL_HOURS)])].sort((a, b) => a - b));
  const canExecute = $derived(plan.targets.length > 0 && plan.targets.length <= MAX_SCHEDULED_DOMAINS && !plan.pausedWatchlists.length && maxLookupsPerDay >= plan.targets.length);
  function updatePolicy(patch: Partial<Omit<MonitoringTargetPolicy, 'domain'>>) {
    if (selected) policies = { ...policies, [selected.domain]: { domain: selected.domain, purpose: selected.purpose,
      intervalHours: selected.intervalHours, priority: selected.priority, ...patch } };
  }
</script>

<details class="monitoring-plan card">
  <summary>Plan monitoring workload</summary>
  <p>Preview a collection purpose and cadence for this watchlist. Nothing is scheduled or collected.</p>
  <div class="controls">
    <label>Collection purpose<select bind:value={purpose}>{#each MONITORING_PURPOSES as option}<option value={option.value}>{option.label} ({tokenLabel(option.mode)})</option>{/each}</select></label>
    <label>Check interval<select bind:value={intervalHours}>{#each ALLOWED_SCHEDULE_INTERVAL_HOURS as hours}<option value={hours}>{hours === 168 ? 'Weekly' : `Every ${hours} hours`}</option>{/each}</select></label>
  </div>
  {#if selected}<details><summary>Per-domain collection settings</summary>
    <p>Override one domain without changing its saved watchlist. Priority sets the order of due work.</p>
    <div class="controls">
      <label>Domain<select value={selected.domain} onchange={event => selectedDomain = event.currentTarget.value}>{#each plan.targets as target (target.domain)}<option value={target.domain}>{target.domain}</option>{/each}</select></label>
      <label>Domain collection purpose<select value={selected.purpose} onchange={event => updatePolicy({ purpose: event.currentTarget.value as MonitoringPurpose })}>{#each MONITORING_PURPOSES as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
      <label>Domain check interval<select value={selected.intervalHours} onchange={event => updatePolicy({ intervalHours: Number(event.currentTarget.value) })}>{#each ALLOWED_SCHEDULE_INTERVAL_HOURS as hours}<option value={hours}>{hours === 168 ? 'Weekly' : `Every ${hours} hours`}</option>{/each}</select></label>
      <label>Domain review priority<select value={selected.priority} onchange={event => updatePolicy({ priority: event.currentTarget.value as MonitoringTargetPolicy['priority'] })}>{#each WATCH_PRIORITIES as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
    </div>
    <button class="btn" type="button" onclick={() => { const { [selected.domain]: _removed, ...rest } = policies; policies = rest; }}>Use defaults for this domain</button>
  </details>{/if}
  <dl aria-live="polite">
    <div><dt>Distinct targets</dt><dd>{plan.counts.distinctTargets}</dd></div>
    <div><dt>Planned Lookups per week</dt><dd>{plan.counts.plannedLookupsPerWeek}</dd></div>
    <div><dt>Targets without retained observations</dt><dd>{plan.counts.withoutRetainedObservation}</dd></div>
    <div><dt>Requests, storage and cost</dt><dd>Not estimated</dd></div>
  </dl>
  <p>Source families: {plan.sources.map(source => LOOKUP_SOURCE_LABELS[source]).join(', ')}. Enabled capabilities, caching and source responses determine the actual request count.</p>
  <label class="quota">Local daily attempt quota<select bind:value={maxLookupsPerDay}>{#each dailyOptions as attempts}<option value={attempts}>{attempts} Lookup attempts</option>{/each}</select></label>
  <button class="btn" type="button" disabled={!canExecute} onclick={() => downloadLocalFile(new Blob([`${JSON.stringify(input, null, 2)}\n`], { type: 'application/json' }), 'monitoring-plan.json')}>Download local monitoring plan</button>
  <p>Run <code>whoisleuth monitor-tick monitoring-plan.json</code> to preview it offline. Collection requires a separate explicit approval and private state file.</p>
  <details><summary>Targets and execution requirements</summary>
    <p>{plan.execution.browser} {plan.execution.local}</p>
    <p>Hosted monitoring supports Fast collection for up to {plan.execution.hosted.capacity} domains.</p>
    {#if !plan.execution.hosted.collectionModeCompatible}<p>Deep collection is not available in hosted monitoring.</p>{/if}
    {#if !plan.execution.hosted.targetCountWithinCapacity}<p>This selection exceeds the current hosted target capacity.</p>{/if}
    {#if plan.pausedWatchlists.length}<p>Membership recovery is required before this watchlist can supply active targets.</p>{/if}
    <ul>{#each plan.targets.slice(0, 50) as target}<li>{target.domain} · {tokenLabel(target.mode)} · {target.intervalHours === 168 ? 'weekly' : `${target.intervalHours} hours`} · {target.priority.toUpperCase()}</li>{/each}</ul>
    {#if plan.targets.length > 50}<p>{plan.targets.length - 50} additional targets are included in the totals.</p>{/if}
  </details>
</details>

<style>
  .monitoring-plan{padding:var(--card-pad);margin-top:16px;min-width:0}
  summary{cursor:pointer;font-weight:600}
  p{color:var(--muted);font-size:var(--text-sm);line-height:1.55}
  .controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:16px 0}
  label{display:grid;gap:6px;font-size:var(--text-sm);min-width:0}
  select{width:100%;min-width:0}
  .quota{max-width:26rem;margin:14px 0}code{overflow-wrap:anywhere}
  dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  dl div{min-width:0}dt{color:var(--muted);font-size:var(--text-xs)}dd{margin:4px 0 0;font-weight:600;overflow-wrap:anywhere}
  li{overflow-wrap:anywhere}details details{margin-top:12px}
  @media(max-width:600px){.controls,dl{grid-template-columns:1fr}}
</style>
