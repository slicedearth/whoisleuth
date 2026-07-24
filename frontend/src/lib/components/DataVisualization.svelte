<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    id,
    eyebrow,
    title,
    description,
    metric,
    metricLabel,
    compact = false,
    children,
  }: {
    id: string;
    eyebrow: string;
    title: string;
    description: string;
    metric?: string | number;
    metricLabel?: string;
    compact?: boolean;
    children: Snippet;
  } = $props();
</script>

<section {id} class:compact class="data-visualization card" aria-labelledby={`${id}-title`}>
  <header>
    <div>
      <p class="eyebrow">{eyebrow}</p>
      <h4 id={`${id}-title`}>{title}</h4>
      <p>{description}</p>
    </div>
    {#if metric !== undefined}
      <div class="visual-metric">
        <strong>{metric}</strong>
        {#if metricLabel}<span>{metricLabel}</span>{/if}
      </div>
    {/if}
  </header>
  <div class="visual-content">{@render children()}</div>
</section>

<style>
  .data-visualization{min-width:0;padding:var(--card-pad);overflow:hidden;background:linear-gradient(145deg,var(--panel),color-mix(in srgb,var(--panel-raised) 86%,var(--accent) 2%))}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}
  header h4{margin:0;font:720 var(--text-lg) var(--mono);letter-spacing:-.025em}
  header p:not(.eyebrow){max-width:700px;margin:5px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .visual-metric{display:grid;flex:0 0 auto;min-width:72px;padding:9px 12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised);text-align:right}
  .visual-metric strong{color:var(--accent);font:750 var(--text-xl) var(--mono)}
  .visual-metric span{color:var(--muted);font:650 var(--text-2xs) var(--mono);letter-spacing:.05em;text-transform:uppercase}
  .visual-content{min-width:0;margin-top:14px}
  .compact{padding:16px}
  .compact header p:not(.eyebrow){max-width:56ch}
  @media(max-width:700px){
    header{align-items:stretch;flex-direction:column}
    .visual-metric{display:flex;min-width:0;align-items:baseline;justify-content:flex-start;gap:6px;text-align:left}
  }
</style>
