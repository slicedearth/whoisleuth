<script lang="ts">
  import type { WatchlistEntry } from '#lib/watchlists.ts';
  import { buildMonitoringPlan } from '../../../../packages/monitoring/monitoring-plan.mts';
  import { MONITORING_PLAN_INPUT_SCHEMA, MONITORING_PLAN_VERSION, MONITORING_PURPOSES, type MonitoringPurpose } from '../../../../packages/contracts/monitoring-plan.mts';
  import { ALLOWED_SCHEDULE_INTERVAL_HOURS } from '../../../../packages/monitoring/scheduled-monitor-model.mts';
  import { tokenLabel } from '../../../../packages/analysis/display-label.mts';
  import { LOOKUP_SOURCE_LABELS } from '../../../../packages/evidence/lookup-collection-review.mts';

  let { name, entry }: { name: string; entry: WatchlistEntry } = $props();
  let purpose = $state<MonitoringPurpose>('registration');
  let intervalHours = $state(24);
  const plan = $derived(buildMonitoringPlan({ schema: MONITORING_PLAN_INPUT_SCHEMA, version: MONITORING_PLAN_VERSION,
    watchlists: { [name]: entry }, purpose, intervalHours }));
</script>

<details class="monitoring-plan card">
  <summary>Plan monitoring workload</summary>
  <p>Preview a collection purpose and cadence for this watchlist. Nothing is scheduled or collected.</p>
  <div class="controls">
    <label>Collection purpose<select bind:value={purpose}>{#each MONITORING_PURPOSES as option}<option value={option.value}>{option.label} ({tokenLabel(option.mode)})</option>{/each}</select></label>
    <label>Check interval<select bind:value={intervalHours}>{#each ALLOWED_SCHEDULE_INTERVAL_HOURS as hours}<option value={hours}>{hours === 168 ? 'Weekly' : `Every ${hours} hours`}</option>{/each}</select></label>
  </div>
  <dl aria-live="polite">
    <div><dt>Distinct targets</dt><dd>{plan.counts.distinctTargets}</dd></div>
    <div><dt>Planned Lookups per week</dt><dd>{plan.counts.plannedLookupsPerWeek}</dd></div>
    <div><dt>Targets without retained observations</dt><dd>{plan.counts.withoutRetainedObservation}</dd></div>
    <div><dt>Requests, storage and cost</dt><dd>Not estimated</dd></div>
  </dl>
  <p>Source families: {plan.sources.map(source => LOOKUP_SOURCE_LABELS[source]).join(', ')}. Enabled capabilities, caching and source responses determine the actual request count.</p>
  <details><summary>Targets and execution requirements</summary>
    <p>{plan.execution.browser} {plan.execution.local}</p>
    <p>Existing hosted monitoring supports Fast collection and at most {plan.execution.hosted.capacity} domains. This plan does not enable it.</p>
    {#if !plan.execution.hosted.collectionModeCompatible}<p>Deep collection is not supported by the current hosted monitoring contract.</p>{/if}
    {#if !plan.execution.hosted.targetCountWithinCapacity}<p>This selection exceeds the current hosted target capacity.</p>{/if}
    {#if plan.pausedWatchlists.length}<p>Membership recovery is required before this watchlist can supply active targets.</p>{/if}
    <p>Review priority remains separate from cadence and collection permission.</p>
    <ul>{#each plan.targets.slice(0, 50) as target}<li>{target.domain}{#if target.priorities.length} · {target.priorities.map(tokenLabel).join(', ')}{/if}</li>{/each}</ul>
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
  dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  dl div{min-width:0}dt{color:var(--muted);font-size:var(--text-xs)}dd{margin:4px 0 0;font-weight:600;overflow-wrap:anywhere}
  li{overflow-wrap:anywhere}details details{margin-top:12px}
  @media(max-width:600px){.controls,dl{grid-template-columns:1fr}}
</style>
