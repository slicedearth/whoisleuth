<script lang="ts">
  import {
    LOOKUP_EVIDENCE_DENSITIES,
    LOOKUP_TASK_VIEWS,
    type LookupEvidenceDensity,
    type LookupTaskView,
  } from '$lib/analysis/lookup-presentation.ts';

  let {
    density,
    task,
    setDensity,
    setTask,
  }: {
    density: LookupEvidenceDensity;
    task: LookupTaskView;
    setDensity: (value: LookupEvidenceDensity) => void;
    setTask: (value: LookupTaskView) => void;
  } = $props();

  const densityDetail = $derived(LOOKUP_EVIDENCE_DENSITIES.find((option) => option.id === density)?.detail ?? '');
</script>

<section class="presentation card" aria-labelledby="lookup-presentation-title">
  <div>
    <p class="eyebrow">Presentation only</p>
    <h3 id="lookup-presentation-title">Evidence view</h3>
    <p>{densityDetail} These controls do not change collection, source states, Risk, availability, exports, or saved evidence.</p>
  </div>
  <label>Task
    <select value={task} onchange={(event) => setTask(event.currentTarget.value as LookupTaskView)}>
      {#each LOOKUP_TASK_VIEWS as option}<option value={option.id}>{option.label}</option>{/each}
    </select>
  </label>
  <label>Density
    <select value={density} onchange={(event) => setDensity(event.currentTarget.value as LookupEvidenceDensity)}>
      {#each LOOKUP_EVIDENCE_DENSITIES as option}<option value={option.id}>{option.label}</option>{/each}
    </select>
  </label>
</section>

<style>
  .presentation{display:grid;grid-template-columns:minmax(0,1fr) minmax(170px,.3fr) minmax(150px,.25fr);gap:12px;align-items:end;margin:12px 0;padding:14px}
  .presentation h3{margin:3px 0 0;font:700 var(--text-sm) var(--mono)}
  .presentation p:not(.eyebrow){margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  label{display:grid;gap:5px;color:var(--muted);font:600 var(--text-xs) var(--mono)}
  select{width:100%;min-height:var(--control-h)}
  @media(max-width:720px){.presentation{grid-template-columns:1fr 1fr}.presentation>div{grid-column:1 / -1}}
  @media(max-width:440px){.presentation{grid-template-columns:1fr}}
</style>
