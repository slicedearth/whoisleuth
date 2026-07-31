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
  }: {
    title: string;
    description: string;
    nodes: ForceGraphNodeInput[];
    links: ForceGraphLinkInput[];
  } = $props();

  const graph = $derived(projectBoundedForceGraph(nodes, links));
  const shortLabel = (value: string) => value.length > 22 ? `${value.slice(0, 20)}…` : value;
  const nodeLabel = (id: string) => graph.nodes.find((node) => node.id === id)?.label ?? id;
</script>

{#if graph.nodes.length > 1 && graph.links.length}
  <section class="relationship-map" aria-label={title}>
    <header>
      <div><p class="eyebrow">Bounded relationship map</p><h3>{title}</h3></div>
      {#if graph.truncated}<span>Partial visual</span>{/if}
    </header>
    <p>{description}</p>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -- scrollable relationship map must be keyboard reachable -->
    <div
      class="map-frame"
      role="img"
      tabindex="0"
      aria-label={`${title}. ${graph.nodes.length} nodes and ${graph.links.length} relationships. Exact evidence follows the visual.`}
    >
      <svg viewBox={`0 0 ${graph.width} ${graph.height}`} aria-hidden="true">
        <defs>
          <pattern id="relationship-map-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" class="grid-line"></path>
          </pattern>
        </defs>
        <rect width={graph.width} height={graph.height} class="background"></rect>
        <rect width={graph.width} height={graph.height} fill="url(#relationship-map-grid)"></rect>
        <g class="links">
          {#each graph.links as link (link.id)}
            <line
              x1={link.sourceX}
              y1={link.sourceY}
              x2={link.targetX}
              y2={link.targetY}
              class:derived={link.kind === 'derived'}
            ><title>{link.detail || link.kind}</title></line>
          {/each}
        </g>
        <g class="nodes">
          {#each graph.nodes as node (node.id)}
            <g transform={`translate(${node.x} ${node.y})`} class={`node kind-${node.kind}`}>
              {#if node.kind === 'target'}
                <rect x="-47" y="-17" width="94" height="34" rx="6"></rect>
              {:else if node.kind === 'technology'}
                <path d="M0 -20 20 0 0 20-20 0Z"></path>
              {:else if node.kind === 'relationship'}
                <rect x="-18" y="-18" width="36" height="36" rx="4"></rect>
              {:else}
                <circle r="18"></circle>
              {/if}
              <text y={node.kind === 'target' ? 4 : 34} text-anchor="middle">{shortLabel(node.label)}</text>
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
  .relationship-map{min-width:0;margin:13px 0;padding:13px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  h3{margin:2px 0 0;font:700 var(--text-sm) var(--mono)}
  header span{color:var(--amber);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  .relationship-map>p{max-width:760px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .map-frame{max-width:100%;margin-top:11px;overflow:auto;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);overscroll-behavior:contain}
  .map-frame:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .map-mobile{display:none}
  svg{display:block;width:100%;min-width:640px;height:auto}
  .background{fill:var(--panel-raised)}
  .grid-line{fill:none;stroke:color-mix(in srgb,var(--border) 58%,transparent);stroke-width:1}
  .links line{stroke:color-mix(in srgb,var(--muted) 52%,transparent);stroke-width:1.4}
  .links line.derived{stroke-dasharray:5 4}
  .node circle,.node rect,.node path{fill:var(--panel);stroke:var(--border-strong);stroke-width:1.5}
  .node.kind-target rect{fill:color-mix(in srgb,var(--accent) 8%,var(--panel));stroke:var(--accent)}
  .node.kind-relationship rect{stroke-dasharray:3 2}
  .node.kind-technology path{fill:color-mix(in srgb,var(--violet) 8%,var(--panel));stroke:var(--violet)}
  .node text{fill:var(--text);font:650 10px var(--mono);paint-order:stroke;stroke:var(--panel-raised);stroke-width:4px;stroke-linejoin:round}
  .limit{font-size:var(--text-2xs)!important}
  @media(max-width:700px){
    .map-frame{display:none}
    .map-mobile{display:grid;gap:7px;margin-top:11px}
    .map-mobile ul{display:grid;gap:7px;margin:0;padding:0;list-style:none}
    .map-mobile li{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:6px;align-items:center;min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
    .map-mobile li.derived{border-style:dashed}
    .map-mobile li span{min-width:0;font:650 var(--text-2xs) var(--mono);overflow-wrap:anywhere}
    .map-mobile li b{color:var(--accent);font-size:var(--text-xs)}
    .map-mobile li small{grid-column:1/-1;color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
    .map-mobile>p{margin:0;color:var(--muted);font-size:var(--text-2xs)}
  }
</style>
