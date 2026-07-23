<script lang="ts">
  import {
    projectEvidenceTopology,
    type EvidenceTopologyInput,
    type EvidenceTopologyTarget,
  } from '$lib/analysis/evidence-topology.ts';

  let {
    id = 'evidence-topology',
    title = 'Evidence topology',
    description = 'Inspect how each separately attributed source connects to this lookup.',
    target,
    nodes,
    embedded = false,
    compact = false,
  }: {
    id?: string;
    title?: string;
    description?: string;
    target: EvidenceTopologyTarget;
    nodes: EvidenceTopologyInput[];
    embedded?: boolean;
    compact?: boolean;
  } = $props();

  let activeNodeId = $state('');
  const graph = $derived(projectEvidenceTopology(target, nodes));
  const statusLabel = (value: string) => value.replaceAll('_', ' ');
  const chamferedPoints = (node: { x: number; y: number; width: number; height: number }) => {
    const cut = 9;
    return [
      `${node.x + cut},${node.y}`,
      `${node.x + node.width - cut},${node.y}`,
      `${node.x + node.width},${node.y + cut}`,
      `${node.x + node.width},${node.y + node.height - cut}`,
      `${node.x + node.width - cut},${node.y + node.height}`,
      `${node.x + cut},${node.y + node.height}`,
      `${node.x},${node.y + node.height - cut}`,
      `${node.x},${node.y + cut}`,
    ].join(' ');
  };
  const setActiveNode = (nodeId: string) => {
    activeNodeId = nodeId;
  };
  const clearActiveNode = (nodeId: string) => {
    if (activeNodeId === nodeId) activeNodeId = '';
  };
  const openNodeHref = (href: string) => {
    if (href) window.location.hash = href.slice(1);
  };
</script>

<section
  class:embedded
  class:compact
  class="evidence-topology card"
  aria-labelledby={`${id}-title`}
>
  {#if !embedded}
    <header class="topology-heading">
      <div>
        <p class="eyebrow">Source map</p>
        <h4 id={`${id}-title`}>{title}</h4>
        <p>{description}</p>
      </div>
      <div class="topology-summary" aria-label={`${graph.nodes.length} mapped evidence sources`}>
        <strong>{graph.nodes.length}</strong>
        <span>sources</span>
      </div>
    </header>
  {:else}
    <h4 id={`${id}-title`} class="sr-only">{title}</h4>
  {/if}

  {#if !compact}
    <div class="visual-key" role="group" aria-label="Evidence topology visual key">
      <span class="key-intro">Shape and colour identify the evidence family:</span>
      <span class="key-item family-registry"><i aria-hidden="true"></i>Registry</span>
      <span class="key-item family-network"><i aria-hidden="true"></i>Network</span>
      <span class="key-item family-web"><i aria-hidden="true"></i>Web</span>
      <span class="key-item family-derived"><i aria-hidden="true"></i>Derived</span>
      <span class="key-item family-analyst"><i aria-hidden="true"></i>Analyst</span>
      <span class="key-state"><i aria-hidden="true"></i>Dot and label show source state</span>
    </div>
  {/if}

  <div class="topology-frame" role="img" aria-label={`${title} visual overview`}>
    <svg viewBox={`0 0 ${graph.width} ${graph.height}`} aria-hidden="true">
      <defs>
        <pattern id={`${id}-grid`} width="22" height="22" patternUnits="userSpaceOnUse">
          <path d="M 22 0 L 0 0 0 22" class="grid-line" />
        </pattern>
        <filter id={`${id}-glow`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect width={graph.width} height={graph.height} class="graph-background" />
      <rect width={graph.width} height={graph.height} fill={`url(#${id}-grid)`} />

      <g class="topology-edges">
        {#each graph.edges as edge (edge.id)}
          <path
            d={edge.path}
            class:active={activeNodeId === edge.nodeId}
            class:dimmed={Boolean(activeNodeId) && activeNodeId !== edge.nodeId}
            class:derived={edge.provenance === 'derived'}
            class:partial={edge.status === 'partial' || edge.status === 'warning' || edge.status === 'inconclusive' || edge.status === 'rate_limited'}
            class:failed={edge.status === 'error' || edge.status === 'unavailable'}
            class:limited={edge.status === 'unsupported' || edge.status === 'skipped' || edge.status === 'disabled' || edge.status === 'not_found'}
          />
        {/each}
      </g>

      <g class="target-node">
        <title>{graph.target.label}: {graph.target.detail || graph.target.status}</title>
        <rect x={graph.target.x} y={graph.target.y} width={graph.target.width} height={graph.target.height} rx="12" filter={`url(#${id}-glow)`} class="node-surface" />
        <text x={graph.target.x + 16} y={graph.target.y + 27} class="node-kicker">LOOKUP TARGET</text>
        <foreignObject
          x={graph.target.x + 16}
          y={graph.target.y + 34}
          width={graph.target.width - 32}
          height="18"
          class="node-copy target-title-copy"
        >
          <div xmlns="http://www.w3.org/1999/xhtml" class="node-title">{graph.target.label}</div>
        </foreignObject>
        <foreignObject
          x={graph.target.x + 16}
          y={graph.target.y + 55}
          width={graph.target.width - 32}
          height="14"
          class="node-copy target-detail-copy"
        >
          <div xmlns="http://www.w3.org/1999/xhtml" class="node-detail">{graph.target.detail || graph.target.status}</div>
        </foreignObject>
      </g>

      <g class="source-nodes">
        {#each graph.nodes as node (node.id)}
          <g
            role="presentation"
            class:linked={Boolean(node.href)}
            onmouseenter={() => setActiveNode(node.id)}
            onmouseleave={() => clearActiveNode(node.id)}
            onpointerup={() => openNodeHref(node.href)}
          >
            <g
              class={`source-node family-${node.family} state-${node.status}`}
              class:active={activeNodeId === node.id}
              class:dimmed={Boolean(activeNodeId) && activeNodeId !== node.id}
            >
              <title>{node.label}: {node.detail || statusLabel(node.status)}</title>
              {#if node.family === 'network' || node.family === 'derived'}
                <polygon points={chamferedPoints(node)} class="node-surface" />
              {:else}
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={node.family === 'web' ? 15 : node.family === 'analyst' ? 11 : 4}
                  class="node-surface"
                />
              {/if}
              <circle cx={node.x + 22} cy={node.y + 23} r="12" class="glyph-disc" />
              <text x={node.x + 22} y={node.y + 27} text-anchor="middle" class="node-glyph">{node.glyph}</text>
              <foreignObject
                x={node.x + 42}
                y={node.y + 10}
                width={node.width - 70}
                height="16"
                class="node-copy source-title-copy"
              >
                <div xmlns="http://www.w3.org/1999/xhtml" class="node-title">{node.label}</div>
              </foreignObject>
              <foreignObject
                x={node.x + 42}
                y={node.y + 31}
                width={node.width - 56}
                height="14"
                class="node-copy source-detail-copy"
              >
                <div xmlns="http://www.w3.org/1999/xhtml" class="node-detail">{node.detail}</div>
              </foreignObject>
              <circle cx={node.x + node.width - 14} cy={node.y + 14} r="4" class="status-dot" />
            </g>
          </g>
        {/each}
      </g>
    </svg>
  </div>

  <ol class="source-rail" aria-label="Evidence source status">
    {#each graph.nodes as node (node.id)}
      <li
        class={`family-${node.family} state-${node.status}`}
        class:active={activeNodeId === node.id}
        onmouseenter={() => setActiveNode(node.id)}
        onmouseleave={() => clearActiveNode(node.id)}
        onfocusin={() => setActiveNode(node.id)}
        onfocusout={() => clearActiveNode(node.id)}
      >
        {#if node.href}
          <a href={node.href}>
            <span class="source-glyph" aria-hidden="true">{node.glyph}</span>
            <span class="source-copy"><strong>{node.label}</strong><small>{node.detail || 'No additional source detail'}</small><span class="source-family">{node.family}</span></span>
            <span class="source-state">{statusLabel(node.status)}</span>
          </a>
        {:else}
          <div>
            <span class="source-glyph" aria-hidden="true">{node.glyph}</span>
            <span class="source-copy"><strong>{node.label}</strong><small>{node.detail || 'No additional source detail'}</small><span class="source-family">{node.family}</span></span>
            <span class="source-state">{statusLabel(node.status)}</span>
          </div>
        {/if}
      </li>
    {/each}
  </ol>

  {#if graph.truncated}
    <p class="topology-note">This overview reached its {graph.nodes.length}-source display limit. Other evidence remains available below.</p>
  {:else if !compact}
    <p class="topology-note"><span class="solid-sample" aria-hidden="true"></span> Solid paths are collected sources. <span class="derived-sample" aria-hidden="true"></span> Dashed paths are bounded analysis derived from collected evidence.</p>
  {/if}
</section>

<style>
  .evidence-topology{min-width:0;padding:var(--card-pad);overflow:hidden;background:linear-gradient(145deg,var(--panel),color-mix(in srgb,var(--panel-raised) 82%,var(--accent) 3%))}
  .topology-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}
  .topology-heading h4{margin:0;font-size:var(--text-lg)}
  .topology-heading p:not(.eyebrow){max-width:680px;margin:5px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .topology-summary{display:grid;flex:0 0 auto;min-width:70px;padding:9px 12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised);text-align:right}
  .topology-summary strong{color:var(--accent);font:750 var(--text-xl) var(--mono)}
  .topology-summary span{color:var(--muted);font:var(--text-2xs) var(--mono);text-transform:uppercase}
  .visual-key{display:flex;flex-wrap:wrap;align-items:center;gap:5px 10px;margin-top:13px;color:var(--muted);font:var(--text-2xs) var(--mono)}
  .key-intro{flex:0 0 auto}
  .key-item,.key-state{display:inline-flex;align-items:center;gap:5px}
  .key-item{--key-color:var(--accent)}
  .key-item.family-registry{--key-color:var(--accent2)}
  .key-item.family-network{--key-color:var(--accent)}
  .key-item.family-web{--key-color:var(--amber)}
  .key-item.family-derived{--key-color:var(--violet)}
  .key-item.family-analyst{--key-color:var(--text)}
  .key-item i{display:inline-block;width:12px;height:9px;border:1.5px solid var(--key-color);border-radius:2px;background:color-mix(in srgb,var(--key-color) 7%,transparent)}
  .key-item.family-network i{clip-path:polygon(24% 0,76% 0,100% 50%,76% 100%,24% 100%,0 50%)}
  .key-item.family-web i{border-radius:999px}
  .key-item.family-derived i{border-style:dashed;clip-path:polygon(24% 0,76% 0,100% 50%,76% 100%,24% 100%,0 50%)}
  .key-item.family-analyst i{border-radius:4px}
  .key-state{margin-left:auto}
  .key-state i{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--accent2);box-shadow:0 0 5px rgb(var(--accent2-rgb) / .35)}
  .topology-frame{max-width:100%;margin-top:14px;overflow:auto;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised);overscroll-behavior-x:contain}
  svg{display:block;width:100%;min-width:680px;height:auto;max-height:500px}
  .graph-background{fill:var(--panel-raised)}
  .grid-line{fill:none;stroke:color-mix(in srgb,var(--border) 55%,transparent);stroke-width:1}
  .topology-edges path{fill:none;stroke:color-mix(in srgb,var(--accent) 58%,var(--border));stroke-width:2;transition:opacity .16s,stroke-width .16s,filter .16s}
  .topology-edges path.active{stroke-width:3;filter:drop-shadow(0 0 4px rgb(var(--accent-rgb) / .55))}
  .topology-edges path.dimmed{opacity:.18}
  .topology-edges path.derived{stroke-dasharray:6 5}
  .topology-edges path.partial{stroke:color-mix(in srgb,var(--amber) 72%,var(--border))}
  .topology-edges path.failed{stroke:color-mix(in srgb,var(--danger) 56%,var(--border));stroke-dasharray:3 5}
  .topology-edges path.limited{stroke:color-mix(in srgb,var(--muted) 55%,var(--border));stroke-dasharray:2 6}
  .target-node rect{fill:color-mix(in srgb,var(--accent) 11%,var(--panel));stroke:var(--accent);stroke-width:2}
  .node-kicker,.node-title,.node-detail,.node-glyph{font-family:var(--mono)}
  .node-kicker{fill:var(--accent);font-size:9px;font-weight:750;letter-spacing:.12em}
  .node-copy{overflow:hidden}
  .node-copy div{display:block;min-width:0;overflow:hidden;color:var(--text);font-family:var(--mono);font-size:12px;font-weight:700;line-height:16px;text-overflow:ellipsis;white-space:nowrap}
  .node-copy .node-detail{color:var(--muted);font-size:9px;font-weight:400;line-height:14px}
  .source-node{--family-color:var(--accent);transform-box:fill-box;transform-origin:center;transition:opacity .16s,filter .16s,transform .16s;animation:source-reveal .32s ease-out both}
  .source-nodes>g.linked{cursor:pointer}
  .source-node.family-registry{--family-color:var(--accent2)}
  .source-node.family-network{--family-color:var(--accent)}
  .source-node.family-web{--family-color:var(--amber)}
  .source-node.family-derived{--family-color:var(--violet)}
  .source-node.family-analyst{--family-color:var(--text)}
  .source-node .node-surface{fill:var(--panel);stroke:color-mix(in srgb,var(--family-color) 58%,var(--border));stroke-width:1.5}
  .source-node.family-derived .node-surface{stroke-dasharray:5 3}
  .source-node .glyph-disc{fill:color-mix(in srgb,var(--family-color) 9%,transparent);stroke:color-mix(in srgb,var(--family-color) 58%,var(--border))}
  .source-node .node-glyph{fill:var(--family-color);font-size:9px;font-weight:800}
  .source-node.active{filter:drop-shadow(0 0 7px color-mix(in srgb,var(--family-color) 55%,transparent));transform:translateY(-1px)}
  .source-node.dimmed{opacity:.32}
  .source-node .status-dot{fill:var(--muted)}
  .source-node.state-success .status-dot{fill:var(--accent2)}
  .source-node.state-partial .status-dot,.source-node.state-warning .status-dot,.source-node.state-inconclusive .status-dot,.source-node.state-rate_limited .status-dot{fill:var(--amber)}
  .source-node.state-error .status-dot{fill:var(--danger)}
  .source-node.state-unavailable .status-dot,.source-node.state-unsupported .status-dot,.source-node.state-not_found .status-dot,.source-node.state-skipped .status-dot,.source-node.state-disabled .status-dot{fill:var(--muted)}
  .source-rail{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(138px,100%),1fr));gap:7px;margin:10px 0 0;padding:0;list-style:none}
  .source-rail li{min-width:0}
  .source-rail li{--family-color:var(--accent)}
  .source-rail li.family-registry{--family-color:var(--accent2)}
  .source-rail li.family-network{--family-color:var(--accent)}
  .source-rail li.family-web{--family-color:var(--amber)}
  .source-rail li.family-derived{--family-color:var(--violet)}
  .source-rail li.family-analyst{--family-color:var(--text)}
  .source-rail a,.source-rail li>div{display:grid;grid-template-columns:26px minmax(0,1fr);gap:7px;align-items:center;min-height:42px;padding:6px 7px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);color:var(--text);text-decoration:none;transition:border-color .16s,background .16s,box-shadow .16s}
  .source-rail a:hover,.source-rail a:focus-visible,.source-rail li.active a,.source-rail li.active>div{border-color:var(--family-color);background:color-mix(in srgb,var(--family-color) 5%,var(--panel));box-shadow:inset 2px 0 var(--family-color)}
  .source-glyph{display:grid;width:24px;height:24px;place-items:center;border:1px solid color-mix(in srgb,var(--family-color) 45%,var(--border));border-radius:50%;color:var(--family-color);font:750 var(--text-2xs) var(--mono)}
  .source-copy{min-width:0}
  .source-copy strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .source-copy strong{font:650 var(--text-xs) var(--mono)}
  .source-copy small{display:none}
  .source-family{display:block;color:var(--family-color);font:650 .5rem var(--mono);letter-spacing:.06em;text-transform:uppercase}
  .source-state{grid-column:2;padding:0;border:0;color:var(--muted);font:650 .55rem var(--mono);text-transform:uppercase}
  .state-success .source-state{color:var(--accent2)}
  .state-partial .source-state,.state-warning .source-state,.state-inconclusive .source-state,.state-rate_limited .source-state{color:var(--amber)}
  .state-error .source-state{color:var(--danger)}
  .topology-note{margin:10px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .solid-sample,.derived-sample{display:inline-block;width:18px;margin:0 4px 3px 0;border-top:2px solid var(--accent);vertical-align:middle}
  .derived-sample{margin-left:8px;border-top-style:dashed}
  .embedded{padding:0;border:0;border-radius:0;background:transparent;box-shadow:none}
  .embedded .topology-frame{margin-top:0;border:0;border-radius:0}
  .compact svg{min-width:0;max-height:260px}
  .compact .source-rail{grid-template-columns:repeat(3,minmax(0,1fr));padding:8px;margin:0;border-top:1px solid var(--border)}
  .compact .source-rail a,.compact .source-rail li>div{display:flex;gap:6px;min-height:0;padding:5px 7px}
  .compact .source-copy small,.compact .source-glyph,.compact .source-family{display:none}
  .compact .source-copy strong{font-size:.61rem}
  .compact .source-state{margin-left:auto;padding:2px 4px;font-size:.5rem}
  @keyframes source-reveal{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
  @media(prefers-reduced-motion:reduce){.source-node{animation:none;transition:none}.topology-edges path,.source-rail a,.source-rail li>div{transition:none}}
  @media(max-width:700px){
    .topology-heading{align-items:stretch;flex-direction:column}.topology-summary{display:flex;align-items:baseline;justify-content:flex-start;gap:6px;min-width:0;text-align:left}
    .key-intro{flex-basis:100%}.key-state{flex-basis:100%;margin-left:0}
    svg{min-width:0}
    .source-rail{grid-template-columns:repeat(2,minmax(0,1fr))}
    .compact .source-rail{grid-template-columns:minmax(0,1fr)}
    .compact .source-rail a,.compact .source-rail li>div{display:grid;grid-template-columns:minmax(0,1fr) auto}
  }
</style>
