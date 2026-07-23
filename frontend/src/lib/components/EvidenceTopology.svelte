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

  const graph = $derived(projectEvidenceTopology(target, nodes));
  const statusLabel = (value: string) => value.replaceAll('_', ' ');
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
            class:derived={edge.provenance === 'derived'}
            class:partial={edge.status === 'partial' || edge.status === 'warning' || edge.status === 'inconclusive' || edge.status === 'rate_limited'}
            class:failed={edge.status === 'error' || edge.status === 'unavailable'}
            class:limited={edge.status === 'unsupported' || edge.status === 'skipped' || edge.status === 'disabled' || edge.status === 'not_found'}
          />
        {/each}
      </g>

      <g class="target-node">
        <title>{graph.target.label}: {graph.target.detail || graph.target.status}</title>
        <rect x={graph.target.x} y={graph.target.y} width={graph.target.width} height={graph.target.height} rx="12" filter={`url(#${id}-glow)`} />
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
          <g class={`source-node state-${node.status}`}>
            <title>{node.label}: {node.detail || statusLabel(node.status)}</title>
            <rect x={node.x} y={node.y} width={node.width} height={node.height} rx="9" />
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
        {/each}
      </g>
    </svg>
  </div>

  <ol class="source-rail" aria-label="Evidence source status">
    {#each graph.nodes as node (node.id)}
      <li class={`state-${node.status}`}>
        {#if node.href}
          <a href={node.href}>
            <span class="source-glyph" aria-hidden="true">{node.glyph}</span>
            <span class="source-copy"><strong>{node.label}</strong><small>{node.detail || 'No additional source detail'}</small></span>
            <span class="source-state">{statusLabel(node.status)}</span>
          </a>
        {:else}
          <div>
            <span class="source-glyph" aria-hidden="true">{node.glyph}</span>
            <span class="source-copy"><strong>{node.label}</strong><small>{node.detail || 'No additional source detail'}</small></span>
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
  .topology-frame{max-width:100%;margin-top:14px;overflow:auto;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised);overscroll-behavior-x:contain}
  svg{display:block;width:100%;min-width:680px;height:auto;max-height:500px}
  .graph-background{fill:var(--panel-raised)}
  .grid-line{fill:none;stroke:color-mix(in srgb,var(--border) 55%,transparent);stroke-width:1}
  .topology-edges path{fill:none;stroke:color-mix(in srgb,var(--accent) 58%,var(--border));stroke-width:2}
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
  .source-node rect{fill:var(--panel);stroke:var(--border);stroke-width:1.5}
  .source-node .glyph-disc{fill:rgb(var(--accent-rgb) / .08);stroke:color-mix(in srgb,var(--accent) 58%,var(--border))}
  .source-node .node-glyph{fill:var(--accent);font-size:9px;font-weight:800}
  .source-node .status-dot{fill:var(--muted)}
  .source-node.state-success .status-dot{fill:var(--accent2)}
  .source-node.state-partial .status-dot,.source-node.state-warning .status-dot,.source-node.state-inconclusive .status-dot,.source-node.state-rate_limited .status-dot{fill:var(--amber)}
  .source-node.state-error .status-dot{fill:var(--danger)}
  .source-node.state-unavailable .status-dot,.source-node.state-unsupported .status-dot,.source-node.state-not_found .status-dot,.source-node.state-skipped .status-dot,.source-node.state-disabled .status-dot{fill:var(--muted)}
  .source-rail{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(138px,100%),1fr));gap:7px;margin:10px 0 0;padding:0;list-style:none}
  .source-rail li{min-width:0}
  .source-rail a,.source-rail li>div{display:grid;grid-template-columns:26px minmax(0,1fr);gap:7px;align-items:center;min-height:42px;padding:6px 7px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);color:var(--text);text-decoration:none}
  .source-rail a:hover,.source-rail a:focus-visible{border-color:var(--accent);background:rgb(var(--accent-rgb) / .045)}
  .source-glyph{display:grid;width:24px;height:24px;place-items:center;border:1px solid color-mix(in srgb,var(--accent) 45%,var(--border));border-radius:50%;color:var(--accent);font:750 var(--text-2xs) var(--mono)}
  .source-copy{min-width:0}
  .source-copy strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .source-copy strong{font:650 var(--text-xs) var(--mono)}
  .source-copy small{display:none}
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
  .compact .source-copy small,.compact .source-glyph{display:none}
  .compact .source-copy strong{font-size:.61rem}
  .compact .source-state{margin-left:auto;padding:2px 4px;font-size:.5rem}
  @media(max-width:700px){
    .topology-heading{align-items:stretch;flex-direction:column}.topology-summary{display:flex;align-items:baseline;justify-content:flex-start;gap:6px;min-width:0;text-align:left}
    svg{min-width:0}
    .source-rail{grid-template-columns:repeat(2,minmax(0,1fr))}
    .compact .source-rail{grid-template-columns:minmax(0,1fr)}
    .compact .source-rail a,.compact .source-rail li>div{display:grid;grid-template-columns:minmax(0,1fr) auto}
  }
</style>
