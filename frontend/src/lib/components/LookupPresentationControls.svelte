<script lang="ts">
  import {
    LOOKUP_TASK_VIEWS,
    type LookupTaskView,
  } from '$lib/analysis/lookup-presentation.ts';

  let {
    task,
    allSectionsExpanded,
    anySectionsExpanded,
    setTask,
    expandAll,
    collapseAll,
  }: {
    task: LookupTaskView;
    allSectionsExpanded: boolean;
    anySectionsExpanded: boolean;
    setTask: (value: LookupTaskView) => void;
    expandAll: () => void;
    collapseAll: () => void;
  } = $props();

</script>

<section class="presentation card" aria-labelledby="lookup-presentation-title">
  <div>
    <p class="eyebrow">Result layout</p>
    <h3 id="lookup-presentation-title">Choose what to review</h3>
    <p>Focus reorders the same evidence for the task at hand. Open individual families or all of them without changing collection, source states, Risk, availability, exports, or saved evidence.</p>
  </div>
  <label>Focus
    <select value={task} onchange={(event) => setTask(event.currentTarget.value as LookupTaskView)}>
      {#each LOOKUP_TASK_VIEWS as option}<option value={option.id}>{option.label}</option>{/each}
    </select>
  </label>
  <div class="section-visibility">
    <span>Evidence families</span>
    <div role="group" aria-label="Evidence family visibility">
      <button type="button" aria-disabled={allSectionsExpanded} onclick={() => { if (!allSectionsExpanded) expandAll(); }}>Expand all</button>
      <button type="button" aria-disabled={!anySectionsExpanded} onclick={() => { if (anySectionsExpanded) collapseAll(); }}>Collapse all</button>
    </div>
  </div>
</section>

<style>
  .presentation{display:grid;grid-template-columns:minmax(0,1fr) minmax(180px,.32fr) auto;gap:12px;align-items:end;margin:12px 0;padding:14px}
  .presentation h3{margin:3px 0 0;font:700 var(--text-sm) var(--mono)}
  .presentation p:not(.eyebrow){margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  label{display:grid;gap:5px;color:var(--muted);font:600 var(--text-xs) var(--mono)}
  select{width:100%;min-height:var(--control-h)}
  .section-visibility{display:grid;gap:5px;color:var(--muted);font:600 var(--text-xs) var(--mono)}
  .section-visibility>div{display:flex;gap:6px}
  .section-visibility button{min-height:var(--control-h);padding:0 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--text);font:650 var(--text-2xs) var(--mono);white-space:nowrap}
  .section-visibility button:hover:not([aria-disabled='true']),.section-visibility button:focus-visible{border-color:var(--accent);color:var(--accent)}
  .section-visibility button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .section-visibility button[aria-disabled='true']{cursor:not-allowed;opacity:.45}
  @media(max-width:980px){.presentation{grid-template-columns:1fr 1fr}.presentation>div:first-child{grid-column:1 / -1}}
  @media(max-width:440px){.presentation{grid-template-columns:1fr}}
</style>
