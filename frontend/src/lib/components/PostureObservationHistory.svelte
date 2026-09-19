<script lang="ts">
  import { currentDesiredPostureObservation, desiredPostureObservations, type DesiredPostureBaseline } from '$lib/analysis/brand-profile-model.ts';
  import { buildDesiredPostureHistory } from '$lib/analysis/owned-domain-posture-review.ts';
  import { POSTURE_SOURCE_LABELS } from '../../../../packages/evidence/domain-posture-context.mts';
  import { reviewClock } from '$lib/review-clock.ts';

  let { baseline }: { baseline: DesiredPostureBaseline } = $props();
  const observations = $derived(desiredPostureObservations(baseline));
  const selected = $derived(currentDesiredPostureObservation(baseline));
  const transitions = $derived(buildDesiredPostureHistory(observations, new Date($reviewClock).toISOString()));
  let filter = $state<'all' | 'changed' | 'unknown'>('all');
  const visibleTransitions = $derived(transitions.filter(item => filter === 'all' || filter === 'changed' && item.changedChecks.length > 0 || filter === 'unknown' && item.unknownChecks > 0));
</script>

<div class="posture-history">
  {#if selected.limitation}<p>{selected.limitation}</p>{/if}
  {#if transitions.length}
    <details>
      <summary>Source comparisons <span>{transitions.length}</span></summary>
      <label>Show comparisons <select bind:value={filter}><option value="all">All</option><option value="changed">Changed</option><option value="unknown">Unknown</option></select></label>
      <p role="status">Showing {visibleTransitions.length} of {transitions.length} source comparisons. All retained captures remain below.</p>
      <ol>{#each [...visibleTransitions].reverse() as transition}
        <li>
          <span>{transition.previousObservedAt || 'Unknown capture time'} → {transition.observedAt || 'Unknown capture time'}</span>
          <strong>{transition.changedChecks.length} changed · {transition.comparableChecks} comparable · {transition.unknownChecks} unknown</strong>
          {#if transition.changedChecks.length}<small>{transition.changedChecks.join(' · ')}</small>{/if}
          {#if transition.limitation}<small>{transition.limitation}</small>{/if}
        </li>
      {/each}</ol>
    </details>
  {/if}
  {#each [...observations].reverse() as observation, index}
    <details>
      <summary>Capture {observation.observedAt || 'time unknown'} <span>Record {observations.length - index}</span></summary>
      {#if observation.context}<p>{observation.context.domain} · comparison version {observation.context.version}</p>
      {:else}<p>Target and collection context were not retained; these records cannot establish alignment or change.</p>{/if}
      {#if observation.omittedChecks}<p>{observation.omittedChecks} checks were not retained.</p>{/if}
      <ul>{#each observation.checks as check}
        <li>
          <strong>{check.id.replaceAll('_', ' ')} · {check.status}</strong>
          {#if check.sourceContext}
            <small>{POSTURE_SOURCE_LABELS[check.sourceContext.source]} · observed {check.sourceContext.observedAt || 'at an unknown time'} · {check.sourceContext.state}{#if check.sourceContext.omittedRecords !== 0} · {check.sourceContext.omittedRecords === null ? 'omissions unknown' : `${check.sourceContext.omittedRecords} records omitted`}{/if}</small>
          {/if}
          {#if check.records.length}<pre>{check.records.join('\n')}</pre>{:else}<small>No record values retained.</small>{/if}
        </li>
      {/each}</ul>
    </details>
  {/each}
  {#if !observations.length}<p>No observation has been retained.</p>{/if}
</div>

<style>
  .posture-history{display:grid;gap:8px;min-width:0}.posture-history details{min-width:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}summary{cursor:pointer;overflow-wrap:anywhere;line-height:1.5;font-size:var(--text-xs)}summary span{margin-inline-start:8px;color:var(--muted)}p,small,li{font-size:var(--text-xs);line-height:1.5;overflow-wrap:anywhere}p,small{color:var(--muted)}ol,ul{display:grid;gap:10px;margin:10px 0 0;padding-inline-start:20px}li>strong,li>span,li>small{display:block}pre{max-width:100%;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:var(--text-2xs)}
</style>
