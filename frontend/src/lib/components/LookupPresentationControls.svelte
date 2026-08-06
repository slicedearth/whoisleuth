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
    allSectionsExpanded,
    anySectionsExpanded,
    setDensity,
    setTask,
    expandAll,
    collapseAll,
  }: {
    density: LookupEvidenceDensity;
    task: LookupTaskView;
    allSectionsExpanded: boolean;
    anySectionsExpanded: boolean;
    setDensity: (value: LookupEvidenceDensity) => void;
    setTask: (value: LookupTaskView) => void;
    expandAll: () => void;
    collapseAll: () => void;
  } = $props();

  const densityDetail = $derived(LOOKUP_EVIDENCE_DENSITIES.find((option) => option.id === density)?.detail ?? '');
</script>

<section class="presentation card" aria-labelledby="lookup-presentation-title">
  <div>
    <p class="eyebrow">Result layout</p>
    <h3 id="lookup-presentation-title">Choose what to review</h3>
    <p>{densityDetail} These controls do not change collection, source states, Risk, availability, exports, or saved evidence.</p>
  </div>
  <label>Focus
    <select value={task} onchange={(event) => setTask(event.currentTarget.value as LookupTaskView)}>
      {#each LOOKUP_TASK_VIEWS as option}<option value={option.id}>{option.label}</option>{/each}
    </select>
  </label>
  <label>Detail
    <select value={density} onchange={(event) => setDensity(event.currentTarget.value as LookupEvidenceDensity)}>
      {#each LOOKUP_EVIDENCE_DENSITIES as option}<option value={option.id}>{option.label}</option>{/each}
    </select>
  </label>
  <div class="section-visibility">
    <span>Evidence families</span>
    <div role="group" aria-label="Evidence family visibility">
      <button type="button" disabled={allSectionsExpanded} onclick={expandAll}>Expand all</button>
      <button type="button" disabled={!anySectionsExpanded} onclick={collapseAll}>Collapse all</button>
    </div>
  </div>
</section>

<style>
  .presentation{display:grid;grid-template-columns:minmax(0,1fr) minmax(170px,.3fr) minmax(150px,.25fr) auto;gap:12px;align-items:end;margin:12px 0;padding:14px}
  .presentation h3{margin:3px 0 0;font:700 var(--text-sm) var(--mono)}
  .presentation p:not(.eyebrow){margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  label{display:grid;gap:5px;color:var(--muted);font:600 var(--text-xs) var(--mono)}
  select{width:100%;min-height:var(--control-h)}
  .section-visibility{display:grid;gap:5px;color:var(--muted);font:600 var(--text-xs) var(--mono)}
  .section-visibility>div{display:flex;gap:6px}
  .section-visibility button{min-height:var(--control-h);padding:0 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--text);font:650 var(--text-2xs) var(--mono);white-space:nowrap}
  .section-visibility button:hover:not(:disabled),.section-visibility button:focus-visible{border-color:var(--accent);color:var(--accent)}
  .section-visibility button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .section-visibility button:disabled{cursor:not-allowed;opacity:.45}
  @media(max-width:980px){.presentation{grid-template-columns:1fr 1fr}.presentation>div:first-child{grid-column:1 / -1}}
  @media(max-width:440px){.presentation{grid-template-columns:1fr}}
</style>
