<script lang="ts">
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import {
    clearInvestigationGuide,
    INVESTIGATION_GUIDE_EVENT,
    investigationGuideHref,
    investigationGuideStageForPath,
    investigationGuideStages,
    loadInvestigationGuide,
    recordInvestigationGuideVisit,
    type InvestigationGuide,
  } from '$lib/investigation-guide';

  let guide = $state<InvestigationGuide|null>(null);
  let mounted = $state(false);
  const currentStage = $derived(investigationGuideStageForPath(page.url.pathname));

  function refresh() {
    guide = loadInvestigationGuide();
  }

  function endGuide() {
    clearInvestigationGuide();
    guide = null;
  }

  onMount(() => {
    mounted = true;
    refresh();
    window.addEventListener(INVESTIGATION_GUIDE_EVENT, refresh);
    return () => window.removeEventListener(INVESTIGATION_GUIDE_EVENT, refresh);
  });

  $effect(() => {
    const pathname = page.url.pathname;
    if (mounted) guide = recordInvestigationGuideVisit(pathname);
  });
</script>

{#if guide}
  <section class="guide card" aria-labelledby="investigation-guide-title">
    <div class="guide-heading">
      <div>
        <p class="eyebrow">Guided investigation</p>
        <strong class="guide-title" id="investigation-guide-title">{guide.domain}</strong>
      </div>
      <button class="btn compact" type="button" onclick={endGuide}>End guide</button>
    </div>
    <ol aria-label="Investigation stages">
      {#each investigationGuideStages as stage,index}
        {@const isCurrent = currentStage?.id === stage.id}
        {@const wasOpened = guide.visitedStages.includes(stage.id)}
        <li class:current={isCurrent} class:opened={wasOpened}>
          <a href={investigationGuideHref(stage.id,guide.domain)} aria-current={isCurrent?'step':undefined}>
            <span aria-hidden="true">0{index+1}</span>
            <span><strong>{stage.label}</strong><small>{stage.detail}</small></span>
            <span class="stage-state">{isCurrent?'Current':wasOpened?'Opened':'Not opened'}</span>
          </a>
        </li>
      {/each}
    </ol>
    <p class="boundary">Opened records navigation only. It does not mean evidence was collected or reviewed.</p>
  </section>
{/if}

<style>
  .guide{margin:0 0 24px;padding:15px 16px}
  .guide-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}
  .guide-title{display:block;margin:3px 0 0;overflow-wrap:anywhere;font:700 var(--text-md) var(--mono)}
  .compact{flex:none;padding:8px 11px;font-size:var(--text-xs)}
  ol{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:14px 0 0;padding:0;list-style:none}
  li{min-width:0}
  li a{display:grid;height:100%;grid-template-columns:auto minmax(0,1fr);gap:5px 9px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface2)}
  li a>span:first-child{color:var(--muted);font:700 var(--text-2xs) var(--mono)}
  li a>span:nth-child(2){min-width:0}
  li strong,li small{display:block}
  li strong{font:700 var(--text-xs) var(--mono)}
  li small{margin-top:3px;color:var(--muted);font-size:var(--text-2xs);line-height:1.35}
  .stage-state{grid-column:2;color:var(--muted);font:700 var(--text-2xs) var(--mono)}
  li.opened a{border-color:color-mix(in srgb,var(--accent2) 38%,var(--border))}
  li.current a{border-color:var(--accent);box-shadow:inset 3px 0 0 var(--accent)}
  li.current .stage-state{color:var(--accent)}
  .boundary{margin:10px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  @media(max-width:760px){ol{grid-template-columns:1fr 1fr}}
  @media(max-width:460px){.guide-heading{align-items:flex-start}.guide-heading{flex-wrap:wrap}ol{grid-template-columns:1fr}}
</style>
