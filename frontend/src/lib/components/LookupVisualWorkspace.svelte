<script lang="ts">
  import AnalystEvidencePivots from '$lib/components/AnalystEvidencePivots.svelte';
  import EvidenceTopology from '$lib/components/EvidenceTopology.svelte';
  import LookupActivationContext from '$lib/components/LookupActivationContext.svelte';
  import LookupAssetGraph from '$lib/components/LookupAssetGraph.svelte';
  import LookupLifecycle from '$lib/components/LookupLifecycle.svelte';
  import type { ActivationContext } from '$lib/analysis/activation-context.ts';
  import type { AnalystEvidencePivot } from '$lib/analysis/analyst-evidence-pivots.ts';
  import {
    projectEvidenceTopology,
    type EvidenceTopologyInput,
    type EvidenceTopologyTarget,
  } from '$lib/analysis/evidence-topology.ts';
  import type { LookupAssetGraph as LookupAssetGraphModel } from '$lib/analysis/lookup-asset-graph.ts';
  import type { LifecycleEventInput } from '$lib/analysis/visualization-models.ts';

  export type LookupVisualView = 'sources' | 'relationships' | 'timeline';

  let {
    view,
    setview,
    target,
    nodes,
    graph,
    pivots,
    events,
    context = null,
    onnavigate,
  }: {
    view: LookupVisualView;
    setview: (value: LookupVisualView) => void;
    target: EvidenceTopologyTarget;
    nodes: EvidenceTopologyInput[];
    graph: LookupAssetGraphModel;
    pivots: AnalystEvidencePivot[];
    events: readonly LifecycleEventInput[];
    context?: ActivationContext | null;
    onnavigate?: (href: string) => void;
  } = $props();

  const datedEventCount = $derived(events.filter((event) => typeof event.date === 'string' && Number.isFinite(Date.parse(event.date))).length);
  const mappedSourceCount = $derived(projectEvidenceTopology(target, nodes).nodes.length);
  const options = $derived([
    { id: 'sources' as const, label: 'Sources', count: mappedSourceCount },
    { id: 'relationships' as const, label: 'Relationships', count: graph.edges.length },
    { id: 'timeline' as const, label: 'Timeline', count: datedEventCount },
  ]);
</script>

<div class="visual-workspace">
  <div class="visual-switcher card">
    <div>
      <p class="eyebrow">Maps and timeline</p>
      <h4 id="lookup-visual-workspace-title">Relationships and history</h4>
      <p>Move between source coverage, exact observed relationships, and dated events without repeating the underlying evidence.</p>
    </div>
    <div class="visual-tabs" role="tablist" aria-label="Relationship and history view">
      {#each options as option}
        <button
          type="button"
          role="tab"
          aria-selected={view === option.id}
          aria-controls={`lookup-visual-${option.id}`}
          class:active={view === option.id}
          onclick={() => setview(option.id)}
        >{option.label}<span>{option.count}</span></button>
      {/each}
    </div>
  </div>

  <div id={`lookup-visual-${view}`} class="visual-panel" role="tabpanel" aria-labelledby="lookup-visual-workspace-title">
    {#if view === 'sources'}
      <EvidenceTopology
        id="lookup-evidence-topology"
        title="Where this result came from"
        description="Use this bounded map to jump to separately attributed source and derived-evidence sections. Missing or failed sources remain explicit and are not treated as evidence of absence."
        {target}
        {nodes}
        {onnavigate}
      />
    {:else if view === 'relationships'}
      <LookupAssetGraph {graph} />
      <AnalystEvidencePivots {pivots} />
    {:else}
      <LookupLifecycle {events} />
      {#if context}<LookupActivationContext {context} />{/if}
    {/if}
  </div>
</div>

<style>
  .visual-workspace{min-width:0}
  .visual-switcher{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;min-width:0;padding:var(--card-pad)}
  .visual-switcher h4{margin:2px 0 0;font:700 var(--text-lg) var(--mono)}
  .visual-switcher p:not(.eyebrow){max-width:680px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .visual-tabs{display:flex;flex:0 0 auto;gap:6px}
  .visual-tabs button{display:flex;align-items:center;gap:7px;min-height:44px;padding:7px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--muted);font:650 var(--text-2xs) var(--mono);cursor:pointer}
  .visual-tabs button span{display:grid;min-width:21px;height:21px;place-items:center;padding:0 5px;border:1px solid var(--border);border-radius:999px;background:var(--panel);color:var(--text)}
  .visual-tabs button:hover,.visual-tabs button.active{border-color:var(--accent);color:var(--accent)}
  .visual-tabs button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .visual-panel{min-width:0;margin-top:10px}
  .visual-panel>:global(*+*){margin-top:10px}
  @media(max-width:820px){
    .visual-switcher{align-items:stretch;flex-direction:column}
    .visual-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));width:100%}
    .visual-tabs button{justify-content:space-between;min-width:0}
  }
  @media(max-width:460px){
    .visual-tabs{grid-template-columns:minmax(0,1fr)}
  }
</style>
