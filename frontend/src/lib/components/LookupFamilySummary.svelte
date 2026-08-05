<script lang="ts">
  let {
    label,
    description,
    metrics = [],
    expanded = false,
    onshow,
    onhide,
  }: {
    label: string;
    description: string;
    metrics?: readonly string[];
    expanded?: boolean;
    onshow: () => void;
    onhide: () => void;
  } = $props();

  const accessibleLabel = $derived(/evidence$/iu.test(label) ? label : `${label} evidence`);
</script>

<button
  class="family-summary card"
  class:expanded
  type="button"
  aria-label={`${expanded ? 'Collapse' : 'Expand'} ${accessibleLabel}`}
  aria-expanded={expanded}
  onclick={expanded ? onhide : onshow}
>
  <span class="family-copy">
    <span class="description">{description}</span>
    {#if metrics.length}
      <span class="metrics">
        {#each metrics as metric}<span class="metric">{metric}</span>{/each}
      </span>
    {/if}
  </span>
  <span class="section-toggle">
    <span aria-hidden="true">{expanded ? '−' : '+'}</span>
    {expanded ? 'Collapse details' : 'Expand details'}
  </span>
</button>

<style>
  .family-summary{display:flex;width:100%;align-items:center;justify-content:space-between;gap:18px;min-width:0;padding:13px 14px;border-left:2px solid var(--section-accent,var(--accent));color:var(--text);font:inherit;text-align:left;cursor:pointer;appearance:none}
  .family-summary:hover{border-color:var(--accent);background:var(--panel-raised)}
  .family-summary:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .family-summary.expanded{border-bottom-right-radius:0;border-bottom-left-radius:0;background:var(--panel-raised)}
  .family-copy{display:block;min-width:0}
  .description{display:block;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .metrics{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .metric{padding:4px 7px;border:1px solid var(--border);border-radius:999px;background:var(--panel-raised);color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .section-toggle{display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;gap:7px;white-space:nowrap;color:var(--text);font:700 var(--text-2xs) var(--mono)}
  .section-toggle>span{display:grid;width:17px;height:17px;place-items:center;border:1px solid currentColor;border-radius:50%;font:750 var(--text-2xs) var(--mono);line-height:1}
  .family-summary:hover .section-toggle{color:var(--accent)}
  @media(max-width:620px){
    .family-summary{align-items:stretch;flex-direction:column;gap:11px}
    .section-toggle{justify-content:flex-start}
  }
</style>
