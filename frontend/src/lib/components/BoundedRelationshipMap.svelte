<script lang="ts">
  import {
    projectBoundedForceGraph,
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
  const nodeLabel = (id: string) => graph.nodes.find((node) => node.id === id)?.label ?? id;
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
        {#if graph.truncated}<strong>Partial visual</strong>{/if}
      </div>
    </header>
    <p>{description}</p>
    {#if graph.clusters.length}
      <ul class="cluster-legend" aria-label="Evidence groups">
        {#each graph.clusters as cluster (cluster.id)}
          <li class={`cluster-${cluster.index}`}><i aria-hidden="true"></i>{cluster.label}<span>{cluster.count}</span></li>
        {/each}
      </ul>
    {/if}
    <div
      class="map-frame"
      role="img"
      aria-label={`${title}. ${graph.nodes.length} nodes and ${graph.links.length} relationships. Exact evidence follows the visual.`}
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
              class:derived={link.kind === 'derived'}
            ><title>{link.detail || link.kind}</title></path>
            <circle cx={link.targetX} cy={link.targetY} r="2.4" class:derived={link.kind === 'derived'}></circle>
          {/each}
        </g>
        <g class="nodes">
          {#each graph.nodes as node (node.id)}
            <g transform={`translate(${node.x} ${node.y})`} class={`node kind-${node.kind} cluster-${node.clusterIndex}`}>
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
      aria-label={`${title}. ${graph.nodes.length} nodes and ${graph.links.length} relationships. Exact evidence follows the visual.`}
    >
      <ul aria-hidden="true">
        {#each graph.links.slice(0, 12) as link (link.id)}
          <li class:derived={link.kind === 'derived'}>
            <span>{nodeLabel(link.sourceId)}</span>
            <b aria-hidden="true">→</b>
            <span>{nodeLabel(link.targetId)}</span>
            <small>{link.detail || link.kind}</small>
          </li>
        {/each}
      </ul>
      {#if graph.links.length > 12}<p>Showing 12 of {graph.links.length} mapped relationships. Exact evidence remains below.</p>{/if}
    </div>
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
  .cluster-legend li{--cluster-tone:var(--accent);display:inline-flex;align-items:center;gap:6px;padding:4px 7px;border:1px solid color-mix(in srgb,var(--cluster-tone) 32%,var(--border));border-radius:999px;background:color-mix(in srgb,var(--cluster-tone) 5%,var(--panel-raised));color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .cluster-legend i{width:7px;height:7px;border-radius:50%;background:var(--cluster-tone);box-shadow:0 0 8px color-mix(in srgb,var(--cluster-tone) 38%,transparent)}
  .cluster-legend span{color:var(--text)}
  .map-frame{max-width:100%;margin-top:11px;overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-sm);background-color:var(--panel-raised);background-image:radial-gradient(circle,color-mix(in srgb,var(--border) 70%,transparent) 1px,transparent 1px);background-size:24px 24px;overscroll-behavior:contain}
  .map-mobile{display:none}
  svg{display:block;width:100%;height:auto}
  .background{fill:transparent}
  .focus-halo{fill:color-mix(in srgb,var(--accent) 5%,transparent);stroke:color-mix(in srgb,var(--accent) 12%,transparent);stroke-width:1;pointer-events:none}
  .links path{fill:none;stroke:color-mix(in srgb,var(--muted) 46%,transparent);stroke-width:1.35}
  .links path.derived{stroke-dasharray:5 5}
  .links circle{fill:color-mix(in srgb,var(--muted) 64%,transparent)}
  .links circle.derived{fill:var(--panel-raised);stroke:color-mix(in srgb,var(--muted) 64%,transparent);stroke-width:1}
  .node{--cluster-tone:var(--accent)}
  .cluster-0{--cluster-tone:#5eb3ff}.cluster-1{--cluster-tone:#b89cff}.cluster-2{--cluster-tone:#d66fd6}.cluster-3{--cluster-tone:#2db7c5}
  .cluster-4{--cluster-tone:#8a91ff}.cluster-5{--cluster-tone:#bb77ff}.cluster-6{--cluster-tone:#5f8fd6}.cluster-7{--cluster-tone:#d388b7}
  .node-shape{fill:color-mix(in srgb,var(--cluster-tone) 9%,var(--panel));stroke:var(--cluster-tone);stroke-width:1.7}
  .node.kind-target .node-shape{fill:color-mix(in srgb,var(--accent) 12%,var(--panel));stroke:var(--accent);stroke-width:2}
  .node.kind-relationship .node-shape,.node.kind-summary .node-shape{stroke-dasharray:3 3}
  .label-plate{fill:color-mix(in srgb,var(--panel-raised) 94%,transparent);stroke:color-mix(in srgb,var(--cluster-tone) 28%,var(--border));stroke-width:1}
  .node text{fill:var(--text);font:650 10px var(--mono);pointer-events:none}
  .node text.target-label{font-weight:750}
  .limit{font-size:var(--text-2xs)!important}
  @media(max-width:700px){
    header{align-items:flex-start}.map-summary{max-width:130px}
    .cluster-legend{gap:5px}.cluster-legend li{padding:3px 6px}
  }
  @container(max-width:660px){
    .map-frame{display:none}
    .map-mobile{display:grid;gap:7px;margin-top:11px}
    .map-mobile ul{display:grid;gap:7px;margin:0;padding:0;list-style:none}
    .map-mobile li{display:grid;grid-template-columns:14px minmax(0,1fr);gap:3px 8px;align-items:center;min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
    .map-mobile li.derived{border-style:dashed}
    .map-mobile li span{min-width:0;color:var(--text);font:650 var(--text-2xs) var(--mono);line-height:1.35;overflow-wrap:anywhere;white-space:normal}
    .map-mobile li span:first-child{grid-column:2;grid-row:1}
    .map-mobile li span:nth-of-type(2){grid-column:2;grid-row:2}
    .map-mobile li b{grid-column:1;grid-row:1/3;align-self:center;color:var(--accent);font-size:var(--text-xs);transform:rotate(90deg)}
    .map-mobile li small{grid-column:2;grid-row:3;color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
    .map-mobile>p{margin:0;color:var(--muted);font-size:var(--text-2xs)}
  }
</style>
