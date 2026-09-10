<script lang="ts">
  import { tick } from 'svelte';
  import Pagination from './Pagination.svelte';
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
  let query = $state('');
  let page = $state(1);
  let listOpen = $state(false);
  let results = $state<HTMLDivElement>();
  const pageSize = 50;
  const projection = $derived(projectLookupAssetGraph(graph, lens));
  const nodesById = $derived(new Map(graph.nodes.map((node) => [node.id, node])));
  const searchText = $derived(query.trim().toLowerCase());
  const matchingEdges = $derived(projection.edges.filter((edge) => !searchText || [
    nodesById.get(edge.source)?.label, nodesById.get(edge.target)?.label,
    edge.label, edge.sourceLabel, edge.boundary, edge.completeness, ...edge.limitations,
  ].some((value) => value?.toLowerCase().includes(searchText))));
  const pageCount = $derived(Math.max(1, Math.ceil(matchingEdges.length / pageSize)));
  const currentPage = $derived(Math.min(page, pageCount));
  const offset = $derived((currentPage - 1) * pageSize);
  const inputRows = $derived(graph.coverage.inputs.filter((row) => row.supplied > 0));
  $effect(() => { graph; page = 1; query = ''; });
  async function setPage(value: number) {
    const expectedGraph = graph;
    const expectedLens = lens;
    const expectedQuery = query;
    page = Math.max(1, Math.min(pageCount, value));
    await tick();
    if (graph !== expectedGraph || lens !== expectedLens || query !== expectedQuery || !listOpen) return;
    results?.focus({ preventScroll: true });
    results?.scrollIntoView({ block: 'start' });
  }
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

{#if graph.targetId && (graph.edges.length || graph.truncated)}
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
          onclick={() => { lens = id; page = 1; }}
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
          <p>Only the visual layout is condensed. Every retained relationship is available in the searchable list.</p>
          <ul>
            {#each projection.collapsedGroups as group (group.hubId)}
              <li><strong>{group.hubLabel}</strong><span>{group.omittedEdges} grouped relationship{group.omittedEdges === 1 ? '' : 's'}</span></li>
            {/each}
          </ul>
        </details>
      {/if}
      <details bind:open={listOpen}>
        <summary>Review {projection.edges.length} exact relationship{projection.edges.length === 1 ? '' : 's'}</summary>
        {#if listOpen}
        <label class="search">Search relationships<input type="search" bind:value={query} oninput={() => page = 1} maxlength="200"></label>
        <p class="list-count" role="status">{matchingEdges.length ? `Showing ${offset + 1}–${Math.min(matchingEdges.length, offset + pageSize)} of ${matchingEdges.length} matching relationships` : 'No retained relationship matches this search.'}</p>
        <div class="paged-results" tabindex="-1" role="group" aria-label="Evidence graph relationship results" bind:this={results}>
        <ul class="edge-list">
          {#each matchingEdges.slice(offset, offset + pageSize) as edge (edge.id)}
            <li class:partial-edge={edge.completeness !== 'complete'}>
              <div>
                <strong>{nodesById.get(edge.source)?.label ?? edge.source}</strong>
                <span>{edge.label}</span>
                <strong>{nodesById.get(edge.target)?.label ?? edge.target}</strong>
              </div>
              <p>{edge.sourceLabel} · {edge.observedAt ? new Date(edge.observedAt).toLocaleString() : 'Observation time unavailable'} · {edge.completeness}</p>
              {#if edge.boundary}<p class="boundary">{edge.boundary.replaceAll('_', ' ')}</p>{/if}
              {#if edge.limitations.length}<small>{edge.limitations.join(' ')}</small>{/if}
              {#if evidenceLinks}<a href={edge.href}>Open source evidence</a>{/if}
            </li>
          {/each}
        </ul>
        </div>
        <Pagination {currentPage} {pageCount} setPage={(value) => void setPage(value)} ariaLabel="Evidence graph relationship pages" pageInputLabel="Evidence graph relationship page" />
        {/if}
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

    {#if inputRows.length}
      <details class="input-coverage">
        <summary>Projection input coverage</summary>
        <p>These counts cover values supplied to the graph, not upstream records outside this Lookup. Every admitted relationship is retained; grouping and pagination affect display only.</p>
        <ul>{#each inputRows as row (row.id)}
          <li><code>{row.id}</code><span>{row.admitted} admitted · {row.inspected} of {row.supplied} inspected</span>
            {#if row.duplicates || row.invalid || row.omitted || row.supplied > row.inspected}<small>{row.duplicates} duplicates · {row.invalid} invalid · {row.omitted} over capacity · {row.supplied - row.inspected} uninspected</small>{/if}
          </li>
        {/each}</ul>
      </details>
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
  .search{display:grid;gap:5px;max-width:36rem;font-size:var(--text-xs);color:var(--muted)}
  .search input{width:100%;min-width:0}
  .list-count,.input-coverage p{font-size:var(--text-xs);color:var(--muted);line-height:1.5}
  .paged-results{min-width:0}
  .paged-results:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  .input-coverage ul{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:0;list-style:none}
  .input-coverage li{display:grid;gap:4px;min-width:0;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:var(--text-2xs);overflow-wrap:anywhere}
  .input-coverage span,.input-coverage small{color:var(--muted)}
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
  .source-ledger span{color:var(--text);font:650 var(--text-2xs) var(--mono);text-transform:capitalize}
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
    .edge-list,.source-ledger>ul,.input-coverage ul{grid-template-columns:minmax(0,1fr)}
    .collapsed-summary li{display:grid;gap:3px}
  }
</style>
