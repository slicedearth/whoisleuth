<script lang="ts">
  import BoundedRelationshipMap from '$lib/components/BoundedRelationshipMap.svelte';
  import {
    projectLookupAssetGraph,
    type LookupAssetGraph,
    type LookupAssetGraphLens,
  } from '$lib/analysis/lookup-asset-graph.ts';

  let { graph }: { graph: LookupAssetGraph } = $props();

  let lens = $state<LookupAssetGraphLens>('all');
  const projection = $derived(projectLookupAssetGraph(graph, lens));
  const labels: Readonly<Record<LookupAssetGraphLens, string>> = {
    all: 'Infrastructure',
    identity: 'Identity & trust',
    delegation: 'Delegation',
    certificate: 'Certificate',
  };
</script>

{#if graph.nodes.length > 1 && graph.edges.length}
  <section class="asset-graph card" aria-labelledby="asset-graph-title">
    <header>
      <div>
        <p class="eyebrow">Observed assets and dependencies</p>
        <h4 id="asset-graph-title">Evidence graph</h4>
        <p>Change lenses to examine the same separately attributed evidence without starting another request.</p>
      </div>
      {#if graph.truncated}<span class="partial">Partial graph</span>{/if}
    </header>

    <div class="lenses" role="group" aria-label="Evidence graph lens">
      {#each Object.entries(labels) as [id, label]}
        <button
          type="button"
          class:active={lens === id}
          aria-pressed={lens === id}
          onclick={() => lens = id as LookupAssetGraphLens}
        >{label}</button>
      {/each}
    </div>

    {#if projection.edges.length}
      <BoundedRelationshipMap
        title={`${labels[lens]} evidence relationships`}
        description="Nodes are bounded facts from the current Deep lookup. Dashed visual edges indicate partial or uncertain collection, not inferred absence."
        nodes={projection.nodes}
        links={projection.links}
      />
      <details>
        <summary>Review {projection.edges.length} exact relationship{projection.edges.length === 1 ? '' : 's'}</summary>
        <ul class="edge-list">
          {#each projection.edges as edge (edge.id)}
            <li class:partial-edge={edge.completeness !== 'complete'}>
              <div>
                <strong>{graph.nodes.find((node) => node.id === edge.source)?.label ?? edge.source}</strong>
                <span>{edge.label}</span>
                <strong>{graph.nodes.find((node) => node.id === edge.target)?.label ?? edge.target}</strong>
              </div>
              <p>{edge.sourceLabel}{edge.observedAt ? ` · ${new Date(edge.observedAt).toLocaleString()}` : ''} · {edge.completeness}</p>
              {#if edge.boundary}<p class="boundary">{edge.boundary.replaceAll('_', ' ')}</p>{/if}
              {#if edge.limitations.length}<small>{edge.limitations.join(' ')}</small>{/if}
              <a href={edge.href}>Open source evidence</a>
            </li>
          {/each}
        </ul>
      </details>
    {:else}
      <p class="empty">This lookup did not retain settled relationships for the selected lens. That is not evidence that the relationship type is absent.</p>
    {/if}

    <details class="limits">
      <summary>Interpretation limits</summary>
      <ul>{#each graph.limitations as limitation}<li>{limitation}</li>{/each}</ul>
    </details>
  </section>
{/if}

<style>
  .asset-graph{min-width:0;padding:var(--card-pad)}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  header h4{margin:2px 0 0;font:700 var(--text-lg) var(--mono)}
  header p:not(.eyebrow){max-width:720px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .partial{color:var(--amber);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  .lenses{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}
  .lenses button{min-height:34px;padding:6px 10px;border:1px solid var(--border);border-radius:999px;background:var(--panel-raised);color:var(--muted);font:650 var(--text-2xs) var(--mono);cursor:pointer}
  .lenses button:hover,.lenses button.active{border-color:var(--accent);color:var(--accent)}
  .lenses button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  details{margin-top:10px;border-top:1px solid var(--border)}
  summary{padding:11px 0;color:var(--text);font:680 var(--text-xs) var(--mono);cursor:pointer}
  summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  .edge-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:0;padding:0;list-style:none}
  .edge-list>li{display:grid;gap:5px;min-width:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .edge-list>li.partial-edge{border-style:dashed}
  .edge-list div{display:flex;align-items:center;gap:5px;min-width:0;flex-wrap:wrap;font-size:var(--text-xs)}
  .edge-list strong{overflow-wrap:anywhere}
  .edge-list div span{color:var(--accent);font:650 var(--text-2xs) var(--mono)}
  .edge-list p,.edge-list small{margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45;overflow-wrap:anywhere}
  .edge-list .boundary{width:max-content;padding:2px 6px;border:1px solid var(--border);border-radius:999px;color:var(--cyan);font:650 var(--text-2xs) var(--mono);text-transform:capitalize}
  .edge-list a{width:max-content;font:650 var(--text-2xs) var(--mono)}
  .limits ul{margin:0;padding-left:18px;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .empty{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs)}
  @media(max-width:720px){.edge-list{grid-template-columns:minmax(0,1fr)}}
</style>
