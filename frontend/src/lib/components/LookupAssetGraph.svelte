<script lang="ts">
  import BoundedRelationshipMap from '$lib/components/BoundedRelationshipMap.svelte';
  import {
    countLookupAssetGraphEdgesByLens,
    projectLookupAssetGraph,
    type LookupAssetGraph,
    type LookupAssetGraphLens,
  } from '$lib/analysis/lookup-asset-graph.ts';

  let {
    graph,
    headingId = 'lookup-asset-graph-title',
    evidenceLinks = true,
  }: {
    graph: LookupAssetGraph;
    headingId?: string;
    evidenceLinks?: boolean;
  } = $props();

  let lens = $state<LookupAssetGraphLens>('all');
  const projection = $derived(projectLookupAssetGraph(graph, lens));
  const lensCounts = $derived(countLookupAssetGraphEdgesByLens(graph));
  const collapsedRelationshipCount = $derived(
    projection.collapsedGroups.reduce((total, group) => total + group.omittedEdges, 0),
  );
  const labels: Readonly<Record<LookupAssetGraphLens, string>> = {
    all: 'Infrastructure',
    identity: 'Identity & trust',
    delegation: 'Delegation',
    certificate: 'Certificate',
  };
  const lensOptions = Object.entries(labels) as [LookupAssetGraphLens, string][];
</script>

{#if graph.nodes.length > 1 && graph.edges.length}
  <section class="asset-graph card" aria-labelledby={headingId}>
    <header>
      <div>
        <p class="eyebrow">Observed assets and dependencies</p>
        <h4 id={headingId}>Evidence graph</h4>
        <p>Change lenses to examine the same separately attributed evidence without starting another request.</p>
      </div>
      {#if graph.truncated}<span class="partial">Partial graph</span>{/if}
    </header>

    <div class="lenses" role="group" aria-label="Evidence graph lens">
      {#each lensOptions as [id, label]}
        <button
          type="button"
          class:active={lens === id}
          aria-pressed={lens === id}
          aria-label={`${label}: ${lensCounts[id]} exact relationship${lensCounts[id] === 1 ? '' : 's'}`}
          onclick={() => lens = id}
        >{label}<span aria-hidden="true">{lensCounts[id]}</span></button>
      {/each}
    </div>

    {#if projection.edges.length}
      <BoundedRelationshipMap
        title={`${labels[lens]} evidence relationships`}
        description="Nodes are bounded facts from the current Deep lookup. Dashed visual edges indicate partial or uncertain collection, not inferred absence."
        nodes={projection.nodes}
        links={projection.links}
        focusNodeId={graph.targetId}
      />
      {#if projection.collapsedGroups.length}
        <details class="collapsed-summary">
          <summary>
            Visual grouping: {collapsedRelationshipCount} relationship{collapsedRelationshipCount === 1 ? '' : 's'} across {projection.collapsedGroups.length} high-degree hub{projection.collapsedGroups.length === 1 ? '' : 's'}
          </summary>
          <p>Only the visual layout is condensed. The exact relationship list remains complete.</p>
          <ul>
            {#each projection.collapsedGroups as group (group.hubId)}
              <li><strong>{group.hubLabel}</strong><span>{group.omittedEdges} grouped relationship{group.omittedEdges === 1 ? '' : 's'}</span></li>
            {/each}
          </ul>
        </details>
      {/if}
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
              {#if evidenceLinks}<a href={edge.href}>Open source evidence</a>{/if}
            </li>
          {/each}
        </ul>
      </details>
      <details class="source-ledger">
        <summary>Review {graph.sources.length} attributed source{graph.sources.length === 1 ? '' : 's'}</summary>
        <ul>
          {#each graph.sources as source (source.id)}
            <li>
              <div><strong>{source.label}</strong><span class:partial-source={source.completeness !== 'complete'}>{source.completeness}</span></div>
              <p>{source.observedAt ? new Date(source.observedAt).toLocaleString() : 'Observation time unavailable'}</p>
              {#if source.limitations.length}<small>{source.limitations.join(' ')}</small>{/if}
              {#if evidenceLinks}<a href={source.href}>Open attributed evidence</a>{/if}
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
  .lenses button{display:inline-flex;align-items:center;gap:7px;min-height:34px;padding:6px 8px 6px 10px;border:1px solid var(--border);border-radius:999px;background:var(--panel-raised);color:var(--muted);font:650 var(--text-2xs) var(--mono);cursor:pointer}
  .lenses button span{display:grid;min-width:21px;min-height:21px;place-items:center;padding:0 5px;border:1px solid var(--border);border-radius:999px;background:var(--panel);color:var(--text);font-size:var(--text-2xs)}
  .lenses button:hover,.lenses button.active{border-color:var(--accent);color:var(--accent)}
  .lenses button.active span{border-color:color-mix(in srgb,var(--accent) 45%,var(--border));color:var(--accent)}
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
  .edge-list .boundary{width:max-content;padding:2px 6px;border:1px solid var(--border);border-radius:999px;color:var(--source-network-text);font:650 var(--text-2xs) var(--mono);text-transform:capitalize}
  .edge-list a{width:max-content;font:650 var(--text-2xs) var(--mono)}
  .limits ul{margin:0;padding-left:18px;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .source-ledger>ul{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:0;padding:0;list-style:none}
  .source-ledger li{display:grid;gap:4px;min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .source-ledger li>div{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
  .source-ledger span{color:var(--success);font:650 var(--text-2xs) var(--mono);text-transform:capitalize}
  .source-ledger span.partial-source{color:var(--amber)}
  .source-ledger p,.source-ledger small{margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.4;overflow-wrap:anywhere}
  .source-ledger a{width:max-content;font:650 var(--text-2xs) var(--mono)}
  .empty{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .collapsed-summary{margin-top:8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .collapsed-summary summary{padding:9px 10px;font-size:var(--text-2xs)}
  .collapsed-summary p{margin:0;padding:0 10px;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .collapsed-summary ul{display:grid;gap:5px;margin:8px 0 0;padding:0 10px 10px;list-style:none}
  .collapsed-summary li{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;min-width:0;padding-top:5px;border-top:1px solid var(--border);font-size:var(--text-2xs)}
  .collapsed-summary strong{overflow-wrap:anywhere}
  .collapsed-summary li span{flex:0 0 auto;color:var(--muted);font-family:var(--mono);overflow-wrap:anywhere}
  @media(max-width:720px){
    .edge-list,.source-ledger>ul{grid-template-columns:minmax(0,1fr)}
    .collapsed-summary li{display:grid;gap:3px}
  }
</style>
