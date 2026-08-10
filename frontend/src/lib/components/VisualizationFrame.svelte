<script lang="ts">
  import type { Snippet } from 'svelte';
  import DataVisualization from '$lib/components/DataVisualization.svelte';

  type LegendToken =
    | 'registration'
    | 'certificate'
    | 'observation'
    | 'activity-empty'
    | 'activity-checked'
    | 'activity-changed';
  type LegendShape = 'circle' | 'square' | 'diamond';
  type LegendItem = Readonly<{ token: LegendToken; label: string; shape?: LegendShape; dashed?: boolean }>;

  let {
    id,
    eyebrow,
    title,
    description,
    metric,
    metricLabel,
    visualLabel,
    legend,
    legendLabel = 'Visual key',
    fallbackMode = 'always',
    note,
    visual,
    fallback,
  }: {
    id: string;
    eyebrow: string;
    title: string;
    description: string;
    metric?: string | number | undefined;
    metricLabel?: string | undefined;
    visualLabel: string;
    legend: readonly LegendItem[];
    legendLabel?: string;
    fallbackMode?: 'always' | 'mobile';
    note?: string | undefined;
    visual: Snippet;
    fallback: Snippet;
  } = $props();

  // Both consumers use small, static keys; keep the shared contract bounded if
  // a later caller accidentally supplies a larger collection.
  const boundedLegend = $derived(legend.slice(0, 8));
</script>

<DataVisualization {id} {eyebrow} {title} {description} {metric} {metricLabel} compact>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -- the bounded chart is keyboard reachable -->
  <div class:replace-on-mobile={fallbackMode === 'mobile'} class="visual-frame" role="img" tabindex="0" aria-label={visualLabel}>
    {@render visual()}
  </div>
  <ul class="visual-legend" aria-label={legendLabel}>
    {#each boundedLegend as item (`${item.token}-${item.label}`)}
      <li>
        <span class={`legend-mark token-${item.token} shape-${item.shape ?? 'circle'}`} class:dashed={item.dashed} aria-hidden="true"></span>
        <span>{item.label}</span>
      </li>
    {/each}
  </ul>
  <div class:mobile-only={fallbackMode === 'mobile'} class="visual-fallback">
    {@render fallback()}
  </div>
  {#if note}<p class="visual-note">{note}</p>{/if}
</DataVisualization>

<style>
  .visual-frame{min-width:0;max-width:100%;overflow:auto;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  .visual-frame:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .visual-legend{display:flex;flex-wrap:wrap;gap:7px 14px;margin:9px 0 0;padding:0;list-style:none}
  .visual-legend li{display:flex;align-items:center;gap:6px;color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .legend-mark{--legend-colour:var(--muted);display:inline-block;width:10px;height:10px;flex:0 0 auto;border:2px solid var(--legend-colour);border-radius:50%;background:var(--panel)}
  .legend-mark.shape-square{border-radius:2px}
  .legend-mark.shape-diamond{border-radius:1px;transform:rotate(45deg)}
  .legend-mark.dashed{border-style:dashed}
  .token-registration{--legend-colour:var(--visual-registration-stroke)}
  .token-certificate{--legend-colour:var(--visual-certificate-stroke)}
  .token-observation{--legend-colour:var(--visual-observation-stroke)}
  .token-activity-empty{--legend-colour:var(--border-strong)}
  .token-activity-checked{--legend-colour:var(--source-network-stroke);background:color-mix(in srgb,var(--source-network-stroke) 18%,var(--panel))}
  .token-activity-changed{--legend-colour:var(--source-whois-stroke);background:var(--source-whois-stroke)}
  .visual-note{margin:9px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .mobile-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
  .visual-fallback :global(.visual-fallback-list){display:grid;grid-template-columns:repeat(auto-fit,minmax(min(165px,100%),1fr));gap:6px;margin:9px 0 0;padding:0;list-style:none}
  .visual-fallback :global(.visual-fallback-list > li){min-width:0;padding:7px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);font-size:var(--text-2xs)}
  @media(max-width:620px){
    .replace-on-mobile{display:none}
    .mobile-only{position:static;width:auto;height:auto;margin:0;overflow:visible;clip:auto;clip-path:none;white-space:normal}
  }
</style>
