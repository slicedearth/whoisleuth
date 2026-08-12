<script lang="ts">
  import {
    projectRedirectPath,
    type RedirectInput,
  } from '$lib/analysis/visualization-models.ts';
  import { MAX_HTTP_EVIDENCE_REDIRECTS } from '../../../../lib/http-evidence-bounds.mts';

  let { redirects }: { redirects: RedirectInput[] } = $props();
  const boundedRedirects = $derived(redirects.slice(0, MAX_HTTP_EVIDENCE_REDIRECTS));
  const path = $derived(projectRedirectPath(boundedRedirects));
</script>

{#if path.nodes.length}
  <div class="redirect-path">
    <svg viewBox={`0 0 ${path.width} ${path.height}`} role="img" aria-label={`HTTP redirect path with ${boundedRedirects.length} hop${boundedRedirects.length === 1 ? '' : 's'}`}>
      <defs>
        <marker id="redirect-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
      <line x1="45" x2="855" y1="70" y2="70" class="path-axis" />
      {#each path.edges as edge (edge.id)}
        <line x1={edge.fromX + 11} x2={edge.toX - 11} y1={edge.y} y2={edge.y} class="path-edge" marker-end="url(#redirect-arrow)" />
      {/each}
      {#each path.nodes as node, index (node.id)}
        <g class="path-node">
          <circle cx={node.x} cy={node.y} r="10" />
          <text x={node.x} y="37" text-anchor="middle" class="path-step">{index === 0 ? 'START' : `HTTP ${node.status}`}</text>
          <text x={node.x} y="104" text-anchor="middle" class="path-label">{node.label.slice(0, 22)}</text>
          {#if node.queryOmitted}<text x={node.x} y="119" text-anchor="middle" class="path-detail">query omitted</text>{/if}
        </g>
      {/each}
    </svg>
    <ol class="redirect-mobile" aria-label="HTTP redirect steps">
      {#each boundedRedirects as redirect, index (`${index}:${redirect.from}:${redirect.to}`)}
        <li>
          <span class="mobile-node" aria-hidden="true"></span>
          <div>
            <small>Hop {index + 1} · HTTP {redirect.status}</small>
            <strong><span>From</span>{redirect.from}</strong>
            <b><span>To</span>{redirect.to}</b>
            {#if redirect.queryOmitted}<em>Query omitted from retained provenance</em>{/if}
          </div>
        </li>
      {/each}
    </ol>
    {#if redirects.length > boundedRedirects.length}<p>Additional redirect records were omitted at the display bound.</p>{/if}
    {#if path.truncated}<p>The path visual reached its {path.nodes.length}-node display limit.</p>{/if}
  </div>
{/if}

<style>
  .redirect-path{max-width:100%;overflow:hidden;border-bottom:1px solid var(--border);background:var(--panel-raised)}
  svg{display:block;width:100%;height:auto}
  marker path{fill:var(--accent)}
  .path-axis{stroke:var(--border);stroke-width:1}
  .path-edge{stroke:var(--accent);stroke-width:2}
  .path-node circle{fill:var(--panel);stroke:var(--accent2);stroke-width:3}
  .path-step,.path-label,.path-detail{font-family:var(--mono)}
  .path-step{fill:var(--accent2);font-size:9px;font-weight:750;letter-spacing:.06em}
  .path-label{fill:var(--text);font-size:9px;font-weight:680}
  .path-detail{fill:var(--muted);font-size:8px}
  .redirect-mobile{display:none}
  p{margin:0;padding:7px 10px;color:var(--muted);font-size:var(--text-2xs)}
  @media(max-width:720px){
    svg{display:none}
    .redirect-mobile{display:grid;margin:0;padding:12px 14px;list-style:none}
    .redirect-mobile li{display:grid;position:relative;grid-template-columns:18px minmax(0,1fr);gap:9px;min-width:0;padding:0 0 14px}
    .redirect-mobile li:not(:last-child)::after{position:absolute;top:14px;bottom:0;left:5px;width:2px;background:var(--border);content:""}
    .redirect-mobile li:last-child{padding-bottom:0}
    .mobile-node{z-index:1;width:12px;height:12px;margin-top:2px;border:2px solid var(--accent2);border-radius:50%;background:var(--panel)}
    .redirect-mobile div{display:grid;gap:3px;min-width:0}
    .redirect-mobile small{color:var(--accent2);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
    .redirect-mobile strong,.redirect-mobile b{display:grid;grid-template-columns:34px minmax(0,1fr);gap:6px;color:var(--text);font:650 var(--text-xs) var(--mono);overflow-wrap:anywhere;word-break:break-word}
    .redirect-mobile b{font-weight:500}.redirect-mobile strong span,.redirect-mobile b span{color:var(--muted);font:600 var(--text-2xs) var(--mono);text-transform:uppercase}
    .redirect-mobile em{color:var(--muted);font-size:var(--text-2xs);font-style:normal}
  }
</style>
