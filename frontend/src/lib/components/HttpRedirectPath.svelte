<script lang="ts">
  import {
    projectRedirectPath,
    type RedirectInput,
  } from '$lib/analysis/visualization-models.ts';

  let { redirects }: { redirects: RedirectInput[] } = $props();
  const path = $derived(projectRedirectPath(redirects));
</script>

{#if path.nodes.length}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -- scrollable chart must be keyboard reachable -->
  <div class="redirect-path" role="img" tabindex="0" aria-label={`HTTP redirect path with ${redirects.length} hop${redirects.length === 1 ? '' : 's'}`}>
    <svg viewBox={`0 0 ${path.width} ${path.height}`} aria-hidden="true">
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
    {#if path.truncated}<p>The path visual reached its {path.nodes.length}-node display limit.</p>{/if}
  </div>
{/if}

<style>
  .redirect-path{max-width:100%;overflow-x:auto;border-bottom:1px solid var(--border);background:var(--panel-raised);overscroll-behavior-x:contain}
  .redirect-path:focus-visible{outline:2px solid var(--focus);outline-offset:-3px}
  svg{display:block;width:100%;min-width:620px;height:auto}
  marker path{fill:var(--accent)}
  .path-axis{stroke:var(--border);stroke-width:1}
  .path-edge{stroke:var(--accent);stroke-width:2}
  .path-node circle{fill:var(--panel);stroke:var(--accent2);stroke-width:3}
  .path-step,.path-label,.path-detail{font-family:var(--mono)}
  .path-step{fill:var(--accent2);font-size:9px;font-weight:750;letter-spacing:.06em}
  .path-label{fill:var(--text);font-size:9px;font-weight:680}
  .path-detail{fill:var(--muted);font-size:8px}
  p{margin:0;padding:7px 10px;color:var(--muted);font-size:var(--text-2xs)}
  @media(max-width:620px){svg{min-width:680px}}
</style>
