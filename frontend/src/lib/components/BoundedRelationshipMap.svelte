<script lang="ts">
  import {
    projectBoundedForceGraph,
    type ForceGraphLinkKind,
    type ForceGraphLinkInput,
    type ForceGraphNodeInput,
  } from '$lib/analysis/visualization-models.ts';

  let {
    title,
    description,
    nodes,
    links,
    focusNodeId = '',
  }: {
    title: string;
    description: string;
    nodes: ForceGraphNodeInput[];
    links: ForceGraphLinkInput[];
    focusNodeId?: string;
  } = $props();

  const graph = $derived(projectBoundedForceGraph(nodes, links, { focusNodeId }));
  let activeGroup = $state('');
  let activeLinkKind = $state<'all' | ForceGraphLinkKind>('all');
  const linkKindLabels: Readonly<Record<ForceGraphLinkKind, string>> = {
    observed: 'Observed',
    partial: 'Partial',
    unknown: 'Unknown',
    derived: 'Derived',
    summary: 'Grouped',
  };
  const selectedGroup = $derived(graph.clusters.some((cluster) => cluster.id === activeGroup) ? activeGroup : '');
  const selectedCluster = $derived(graph.clusters.find((cluster) => cluster.id === selectedGroup));
  const graphIdentity = $derived([
    focusNodeId,
    ...graph.nodes.map((node) => node.id),
    ...graph.links.map((link) => link.id),
  ].join('|'));
  $effect(() => {
    if (graphIdentity) {
      activeGroup = '';
      activeLinkKind = 'all';
    }
  });
  const nodeLabel = (id: string) => graph.nodes.find((node) => node.id === id)?.label ?? id;
  const nodeGroup = (id: string) => graph.nodes.find((node) => node.id === id)?.group ?? '';
  const linkMatchesFocus = (link: (typeof graph.links)[number]) => (
    (!selectedGroup
      || nodeGroup(link.sourceId) === selectedGroup
      || nodeGroup(link.targetId) === selectedGroup)
    && (activeLinkKind === 'all' || link.kind === activeLinkKind)
  );
  const focusedLinks = $derived(graph.links.filter(linkMatchesFocus));
  const focusedNodeIds = $derived(new Set(focusedLinks.flatMap((link) => [link.sourceId, link.targetId])));
  const omittedInputCount = $derived(graph.omittedNodeInputs + graph.omittedLinkInputs);
  const availableLinkKinds = $derived((Object.keys(linkKindLabels) as ForceGraphLinkKind[])
    .map((kind) => ({
      kind,
      label: linkKindLabels[kind],
      count: graph.links.filter((link) => link.kind === kind).length,
    }))
    .filter((item) => item.count > 0));
  const nodeIsMuted = (node: (typeof graph.nodes)[number]) => Boolean(
    node.kind !== 'target'
      && (
        Boolean(selectedGroup && node.group !== selectedGroup)
        || Boolean(activeLinkKind !== 'all' && !focusedNodeIds.has(node.id))
      ),
  );
  const linkIsMuted = (link: (typeof graph.links)[number]) => !linkMatchesFocus(link);
  const mobileLinks = $derived(focusedLinks);
  const filtersActive = $derived(Boolean(selectedGroup) || activeLinkKind !== 'all');
  const resetVisualFilters = () => {
    activeGroup = '';
    activeLinkKind = 'all';
  };
  const linkPath = (link: (typeof graph.links)[number]) => {
    const deltaX = link.targetX - link.sourceX;
    const deltaY = link.targetY - link.sourceY;
    const distance = Math.max(1, Math.hypot(deltaX, deltaY));
    const direction = [...link.id].reduce((total, character) => total + character.charCodeAt(0), 0) % 2 ? 1 : -1;
    const curve = Math.min(22, distance * 0.08) * direction;
    const controlX = (link.sourceX + link.targetX) / 2 - deltaY / distance * curve;
    const controlY = (link.sourceY + link.targetY) / 2 + deltaX / distance * curve;
    return `M ${link.sourceX} ${link.sourceY} Q ${controlX} ${controlY} ${link.targetX} ${link.targetY}`;
  };
</script>

{#if graph.nodes.length > 1 && graph.links.length}
  <section class="relationship-map" aria-label={title}>
    <header>
      <div><p class="eyebrow">Bounded relationship map</p><h3>{title}</h3></div>
      <div class="map-summary" role="group" aria-label="Map summary">
        <span>{graph.nodes.length} facts</span>
        <span>{graph.links.length} links</span>
        {#if graph.truncated}<strong>Partial visual · {omittedInputCount} omitted</strong>{/if}
      </div>
    </header>
    <p>{description}</p>
    {#if graph.clusters.length}
      <ul class="cluster-legend" aria-label="Evidence groups">
        {#each graph.clusters as cluster (cluster.id)}
          <li class={`cluster-${cluster.index}`}>
            <button
              type="button"
              aria-pressed={selectedGroup === cluster.id}
              aria-label={`${selectedGroup === cluster.id ? 'Show all groups instead of' : 'Focus'} ${cluster.label}, ${cluster.count} facts`}
              onclick={() => activeGroup = selectedGroup === cluster.id ? '' : cluster.id}
            ><i aria-hidden="true"></i>{cluster.label}<span>{cluster.count}</span></button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if availableLinkKinds.length > 1}
      <div class="link-filter" role="group" aria-label="Relationship evidence filter">
        <button type="button" aria-pressed={activeLinkKind === 'all'} onclick={() => activeLinkKind = 'all'}>All <span>{graph.links.length}</span></button>
        {#each availableLinkKinds as item (item.kind)}
          <button type="button" aria-pressed={activeLinkKind === item.kind} onclick={() => activeLinkKind = item.kind}>
            <i class={item.kind} aria-hidden="true"></i>{item.label} <span>{item.count}</span>
          </button>
        {/each}
      </div>
    {/if}
    {#if filtersActive}
      <div class="focus-status">
        <p class="focus-note" role="status">
          Showing {focusedLinks.length} of {graph.links.length} mapped relationships{selectedCluster ? ` for ${selectedCluster.label}` : ''}: {activeLinkKind === 'all' ? 'all relationship states' : `${linkKindLabels[activeLinkKind].toLowerCase()} only`}.
        </p>
        <button type="button" onclick={resetVisualFilters}>Reset visual filters</button>
      </div>
    {/if}
    <div
      class="map-frame"
      role="img"
      aria-label={`${title}. ${graph.nodes.length} nodes and ${graph.links.length} relationships.${graph.truncated ? ` ${omittedInputCount} visual inputs omitted after bounded normalization.` : ''} Exact evidence follows the visual.`}
    >
      <svg viewBox={`0 0 ${graph.width} ${graph.height}`} aria-hidden="true">
        <rect width={graph.width} height={graph.height} class="background"></rect>
        {#each graph.nodes.filter((node) => node.kind === 'target') as node (node.id)}
          <circle cx={node.x} cy={node.y} r="96" class="focus-halo"></circle>
        {/each}
        <g class="links">
          {#each graph.links as link (link.id)}
            <path
              d={linkPath(link)}
              class:partial={link.kind === 'partial'}
              class:unknown={link.kind === 'unknown'}
              class:derived={link.kind === 'derived'}
              class:summary={link.kind === 'summary'}
              class:muted={linkIsMuted(link)}
            ><title>{link.detail || link.kind}</title></path>
            <circle
              cx={link.targetX}
              cy={link.targetY}
              r="2.4"
              class:partial={link.kind === 'partial'}
              class:unknown={link.kind === 'unknown'}
              class:derived={link.kind === 'derived'}
              class:summary={link.kind === 'summary'}
              class:muted={linkIsMuted(link)}
            ></circle>
          {/each}
        </g>
        <g class="nodes">
          {#each graph.nodes as node (node.id)}
            <g
              transform={`translate(${node.x} ${node.y})`}
              class={`node kind-${node.kind} cluster-${node.clusterIndex}`}
              class:muted={nodeIsMuted(node)}
            >
              {#if node.kind === 'target'}
                <rect
                  class="node-shape target-shape"
                  x={-(node.labelWidth + 20) / 2}
                  y={-(node.labelLines.length * 13 + 17) / 2}
                  width={node.labelWidth + 20}
                  height={node.labelLines.length * 13 + 17}
                  rx="9"
                ></rect>
              {:else if node.kind === 'technology'}
                <path class="node-shape" d="M0 -20 20 0 0 20-20 0Z"></path>
              {:else if node.kind === 'relationship'}
                <rect class="node-shape" x="-18" y="-18" width="36" height="36" rx="6"></rect>
              {:else}
                <circle class="node-shape" r={node.kind === 'summary' ? 15 : 18}></circle>
              {/if}
              {#if node.kind !== 'target'}
                <rect
                  class="label-plate"
                  x={-node.labelWidth / 2}
                  y="25"
                  width={node.labelWidth}
                  height={node.labelLines.length * 13 + 8}
                  rx="6"
                ></rect>
              {/if}
              <text
                class:target-label={node.kind === 'target'}
                y={node.kind === 'target' ? -(node.labelLines.length - 1) * 6.5 + 4 : 37}
                text-anchor="middle"
              >{#each node.labelLines as line, index}<tspan x="0" dy={index === 0 ? 0 : 13}>{line}</tspan>{/each}</text>
              <title>{node.label}{node.detail ? `: ${node.detail}` : ''}</title>
            </g>
          {/each}
        </g>
      </svg>
    </div>
    <div
      class="map-mobile"
      role="img"
      aria-label={`${title}. ${graph.nodes.length} nodes and ${graph.links.length} relationships.${graph.truncated ? ` ${omittedInputCount} visual inputs omitted after bounded normalization.` : ''} Exact evidence follows the visual.`}
    >
      <ul aria-hidden="true">
        {#each mobileLinks.slice(0, 12) as link (link.id)}
          <li class:partial={link.kind === 'partial'} class:unknown={link.kind === 'unknown'} class:derived={link.kind === 'derived'} class:summary={link.kind === 'summary'}>
            <span>{nodeLabel(link.sourceId)}</span>
            <b aria-hidden="true">→</b>
            <span>{nodeLabel(link.targetId)}</span>
            <small>{link.detail || link.kind}</small>
          </li>
        {/each}
      </ul>
      {#if mobileLinks.length > 12}<p>Showing 12 of {mobileLinks.length} mapped relationships. Exact evidence remains below.</p>{/if}
      {#if !mobileLinks.length}<p>No mapped relationships match these visual filters. Exact evidence remains below.</p>{/if}
    </div>
    {#if graph.truncated}
      <p class="visual-limit">The bounded visual omitted {graph.omittedNodeInputs} fact {graph.omittedNodeInputs === 1 ? 'input' : 'inputs'} and {graph.omittedLinkInputs} relationship {graph.omittedLinkInputs === 1 ? 'input' : 'inputs'} after normalisation or display limits. Use the exact evidence below for source detail.</p>
    {/if}
    <p class="limit">Lines show observed or explicitly derived relationships in the current bounded dataset. They do not establish common ownership or intent.</p>
  </section>
{/if}

<style>
  .relationship-map{container-type:inline-size;min-width:0;margin:13px 0;padding:13px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  h3{margin:2px 0 0;font:700 var(--text-sm) var(--mono)}
  .map-summary{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:5px}
  .map-summary span,.map-summary strong{padding:3px 7px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font:650 var(--text-2xs) var(--mono);white-space:nowrap}
  .map-summary strong{color:var(--amber)}
  .relationship-map>p{max-width:760px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .cluster-legend{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0;padding:0;list-style:none}
  .cluster-legend li{--cluster-tone:var(--accent)}
  .cluster-legend button{display:inline-flex;align-items:center;gap:6px;padding:4px 7px;border:1px solid color-mix(in srgb,var(--cluster-tone) 32%,var(--border));border-radius:999px;background:color-mix(in srgb,var(--cluster-tone) 5%,var(--panel-raised));color:var(--muted);font:650 var(--text-2xs) var(--mono);cursor:pointer}
  .cluster-legend button:hover{border-color:color-mix(in srgb,var(--cluster-tone) 60%,var(--border-strong));color:var(--text)}
  .cluster-legend button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .cluster-legend button[aria-pressed="true"]{border-color:var(--cluster-tone);background:color-mix(in srgb,var(--cluster-tone) 14%,var(--panel-raised));color:var(--text)}
  .cluster-legend i{width:7px;height:7px;border-radius:50%;background:var(--cluster-tone);box-shadow:0 0 8px color-mix(in srgb,var(--cluster-tone) 38%,transparent)}
  .cluster-legend span{color:var(--text)}
  .link-filter{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
  .link-filter button{display:inline-flex;align-items:center;gap:6px;padding:3px 7px;border:1px solid var(--border);border-radius:999px;background:var(--panel-raised);color:var(--muted);font:600 var(--text-2xs) var(--mono);cursor:pointer}
  .link-filter button:hover{border-color:var(--border-strong);color:var(--text)}
  .link-filter button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .link-filter button[aria-pressed="true"]{border-color:var(--border-strong);color:var(--text);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--border-strong) 42%,transparent)}
  .link-filter i{display:block;width:23px;border-top:1.5px solid color-mix(in srgb,var(--muted) 65%,transparent)}
  .link-filter span{color:var(--text);font-variant-numeric:tabular-nums}
  .link-filter i.partial{border-color:var(--amber);border-top-style:dashed}
  .link-filter i.unknown{border-top-style:dotted}
  .link-filter i.derived{border-color:var(--accent);border-top-style:dashed}
  .link-filter i.summary{border-top-style:dotted}
  .focus-status{display:flex;align-items:center;justify-content:space-between;gap:9px;margin-top:7px}
  .focus-note{margin:0!important;color:var(--text)!important;font:650 var(--text-2xs) var(--mono)!important}
  .focus-status button{flex:0 0 auto;padding:3px 7px;border:1px solid var(--border);border-radius:999px;background:var(--panel-raised);color:var(--muted);font:600 var(--text-2xs) var(--mono);cursor:pointer}
  .focus-status button:hover{border-color:var(--border-strong);color:var(--text)}
  .focus-status button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .map-frame{max-width:100%;margin-top:11px;overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-sm);background-color:var(--panel-raised);background-image:radial-gradient(circle,color-mix(in srgb,var(--border) 70%,transparent) 1px,transparent 1px);background-size:24px 24px;overscroll-behavior:auto;touch-action:pan-y pinch-zoom}
  .map-mobile{display:none}
  svg{display:block;width:100%;height:auto}
  .background{fill:transparent}
  .focus-halo{fill:color-mix(in srgb,var(--accent) 5%,transparent);stroke:color-mix(in srgb,var(--accent) 12%,transparent);stroke-width:1;pointer-events:none}
  .links path{fill:none;stroke:color-mix(in srgb,var(--muted) 46%,transparent);stroke-width:1.35}
  .links path.partial{stroke:color-mix(in srgb,var(--amber) 66%,var(--border));stroke-dasharray:5 5}
  .links path.unknown{stroke-dasharray:2 5}
  .links path.derived{stroke:color-mix(in srgb,var(--accent) 56%,var(--border));stroke-dasharray:7 4}
  .links path.summary{stroke-dasharray:2 4}
  .links path.muted,.links circle.muted{opacity:.1}
  .links circle{fill:color-mix(in srgb,var(--muted) 64%,transparent)}
  .links circle.partial,.links circle.unknown,.links circle.derived,.links circle.summary{fill:var(--panel-raised);stroke:color-mix(in srgb,var(--muted) 64%,transparent);stroke-width:1}
  .node{--cluster-tone:var(--accent)}
  .cluster-0{--cluster-tone:#5eb3ff}.cluster-1{--cluster-tone:#b89cff}.cluster-2{--cluster-tone:#d66fd6}.cluster-3{--cluster-tone:#2db7c5}
  .cluster-4{--cluster-tone:#8a91ff}.cluster-5{--cluster-tone:#bb77ff}.cluster-6{--cluster-tone:#5f8fd6}.cluster-7{--cluster-tone:#d388b7}
  .node-shape{fill:color-mix(in srgb,var(--cluster-tone) 9%,var(--panel));stroke:var(--cluster-tone);stroke-width:1.7}
  .node.kind-target .node-shape{fill:color-mix(in srgb,var(--accent) 12%,var(--panel));stroke:var(--accent);stroke-width:2}
  .node.kind-relationship .node-shape,.node.kind-summary .node-shape{stroke-dasharray:3 3}
  .label-plate{fill:color-mix(in srgb,var(--panel-raised) 94%,transparent);stroke:color-mix(in srgb,var(--cluster-tone) 28%,var(--border));stroke-width:1}
  .node text{fill:var(--text);font:650 10px var(--mono);pointer-events:none}
  .node text.target-label{font-weight:750}
  .node.muted{opacity:.14}
  .visual-limit{color:var(--amber)!important;font-size:var(--text-2xs)!important}
  .limit{font-size:var(--text-2xs)!important}
  @media(max-width:700px){
    header{align-items:flex-start}.map-summary{max-width:130px}
    .cluster-legend{gap:5px}.cluster-legend button{padding:3px 6px}
    .focus-status{align-items:flex-start;flex-direction:column}
  }
  @container(max-width:660px){
    .map-frame{display:none}
    .map-mobile{display:grid;gap:7px;margin-top:11px}
    .map-mobile ul{display:grid;gap:7px;margin:0;padding:0;list-style:none}
    .map-mobile li{display:grid;grid-template-columns:14px minmax(0,1fr);gap:3px 8px;align-items:center;min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
    .map-mobile li.partial{border-color:color-mix(in srgb,var(--amber) 48%,var(--border));border-style:dashed}
    .map-mobile li.unknown,.map-mobile li.summary{border-style:dotted}
    .map-mobile li.derived{border-color:color-mix(in srgb,var(--accent) 44%,var(--border));border-style:dashed}
    .map-mobile li span{min-width:0;color:var(--text);font:650 var(--text-2xs) var(--mono);line-height:1.35;overflow-wrap:anywhere;white-space:normal}
    .map-mobile li span:first-child{grid-column:2;grid-row:1}
    .map-mobile li span:nth-of-type(2){grid-column:2;grid-row:2}
    .map-mobile li b{grid-column:1;grid-row:1/3;align-self:center;color:var(--accent);font-size:var(--text-xs);transform:rotate(90deg)}
    .map-mobile li small{grid-column:2;grid-row:3;color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
    .map-mobile>p{margin:0;color:var(--muted);font-size:var(--text-2xs)}
  }
</style>
