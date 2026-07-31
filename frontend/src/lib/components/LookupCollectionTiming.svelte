<script lang="ts">
  import type {
    LookupTiming,
    LookupTimingSource,
  } from '$lib/analysis/lookup-response.ts';
  import { formatCollectionDuration } from '$lib/analysis/lookup-display-shared.ts';
  import { projectCollectionTiming } from '$lib/analysis/visualization-models.ts';

  let { timing, embedded = false }: { timing: LookupTiming; embedded?: boolean } = $props();

  const sourceLabels: Record<LookupTimingSource, string> = {
    rdap: 'Registry RDAP',
    whois: 'WHOIS chain',
    domain_evidence: 'Domain evidence',
    reverse_dns: 'Reverse DNS',
    registrar_rdap: 'Registrar RDAP',
    network_context: 'Network context',
    security_txt: 'security.txt',
    external_intelligence: 'Archived web intelligence',
    malware_host_intelligence: 'Malware host intelligence',
    malware_ioc_intelligence: 'Malware infrastructure intelligence',
  };
  const chart = $derived(projectCollectionTiming(timing.sources, timing.totalMs));

  function mobileBarStyle(source: (typeof chart.sources)[number]): string {
    const total = chart.totalMs;
    const start = Math.max(0, source.completedAfterMs - source.durationMs);
    const startPercent = Math.min(100, (start / total) * 100);
    const widthPercent = Math.max(2, Math.min(100 - startPercent, (source.durationMs / total) * 100));
    return `--timing-start:${startPercent}%;--timing-width:${widthPercent}%`;
  }
</script>

<section class="collection-timing" class:card={!embedded} class:embedded aria-labelledby="collection-timing-title">
  <header>
    <div>
      {#if !embedded}<p class="eyebrow">Request diagnostics</p>{/if}
      {#if embedded}
        <h5 id="collection-timing-title">Collection timing</h5>
      {:else}
        <h4 id="collection-timing-title">Collection timing</h4>
      {/if}
    </div>
    <span class="chip info">{formatCollectionDuration(timing.totalMs)} total</span>
  </header>

  <p class="timing-note">
    Reported after the final response. Source branches overlap, so their durations do not add up to the total.
    A settled branch can still report partial, unavailable, or not-found evidence in its source card.
  </p>

  {#if chart.sources.length}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -- scrollable diagnostic chart must be keyboard reachable -->
    <div class="timing-chart" role="img" tabindex="0" aria-label={`Overlapping collection timing for ${chart.sources.length} source branches`}>
      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} aria-hidden="true">
        {#each chart.ticks as tick}
          <line x1={tick.x} x2={tick.x} y1="18" y2={chart.height - 10} class="tick-line" />
          <text x={tick.x} y="13" text-anchor="middle" class="tick-label">{formatCollectionDuration(tick.value)}</text>
        {/each}
        {#each chart.sources as source}
          <g class:rejected={source.outcome === 'rejected'} class="timing-source">
            <text x="8" y={source.y + 13}>{sourceLabels[source.label as LookupTimingSource] ?? source.label}</text>
            <rect x={source.x} y={source.y} width={source.width} height="17" rx="4">
              <title>{formatCollectionDuration(source.durationMs)} duration, settled at +{formatCollectionDuration(source.completedAfterMs)}</title>
            </rect>
            <circle cx={source.x + source.width} cy={source.y + 8.5} r="4" />
          </g>
        {/each}
      </svg>
      <div class="mobile-timing" aria-hidden="true">
        {#each chart.sources as source}
          <div class:rejected={source.outcome === 'rejected'} class="mobile-timing-source">
            <span>{sourceLabels[source.label as LookupTimingSource] ?? source.label}</span>
            <strong>{formatCollectionDuration(source.durationMs)} · +{formatCollectionDuration(source.completedAfterMs)}</strong>
            <i style={mobileBarStyle(source)}><b></b></i>
          </div>
        {/each}
      </div>
    </div>
    {#if chart.truncated}<p class="timing-limit">The visual is capped at {chart.sources.length} branches. The complete timing list remains available to assistive technology.</p>{/if}
  {/if}

  <ul class="timing-data" aria-label="Exact collection timing data">
    {#each timing.sources as source}
      <li>
        <span class="source">{sourceLabels[source.source]}</span>
        <span class:rejected={source.outcome === 'rejected'} class="outcome">
          {source.outcome === 'rejected' ? 'request error' : 'settled'}
        </span>
        <span class="duration">{formatCollectionDuration(source.durationMs)}</span>
        <span class="settled">at +{formatCollectionDuration(source.completedAfterMs)}</span>
      </li>
    {/each}
  </ul>
</section>

<style>
  .collection-timing{min-width:0;padding:var(--card-pad)}
  .collection-timing.embedded{padding:4px 0 0}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  header :is(h4,h5){margin:2px 0 0;font:700 var(--text-lg) var(--mono)}
  .embedded header h5{font-size:var(--text-sm)}
  header .chip{flex:0 0 auto}
  .timing-note{max-width:78ch;margin:10px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .timing-chart{max-width:100%;margin-top:14px;overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised);overscroll-behavior-x:contain}
  .timing-chart:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .timing-chart svg{display:block;width:100%;min-width:680px;height:auto}
  .mobile-timing{display:none}
  .tick-line{stroke:var(--border);stroke-width:1}
  .tick-label,.timing-source text{fill:var(--muted);font-family:var(--mono);font-size:9px}
  .timing-source rect{fill:rgb(var(--accent-rgb) / .24);stroke:var(--accent)}
  .timing-source circle{fill:var(--accent);stroke:var(--panel);stroke-width:2}
  .timing-source.rejected rect{fill:rgb(var(--danger-rgb) / .12);stroke:var(--danger)}
  .timing-source.rejected circle{fill:var(--danger)}
  .timing-limit{margin:7px 0 0;color:var(--muted);font-size:var(--text-2xs)}
  .timing-data{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0;list-style:none}
  @media(max-width:760px){
    .timing-chart{overflow:visible}
    .timing-chart svg{display:none}
    .mobile-timing{display:grid;gap:11px;padding:12px}
    .mobile-timing-source{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 8px}
    .mobile-timing-source>span{min-width:0;color:var(--text);font:650 var(--text-2xs) var(--mono);overflow-wrap:anywhere}
    .mobile-timing-source>strong{color:var(--muted);font:600 var(--text-2xs) var(--mono);font-variant-numeric:tabular-nums;text-align:right}
    .mobile-timing-source>i{position:relative;grid-column:1/-1;height:10px;border:1px solid var(--border);border-radius:999px;background:rgb(var(--bg-rgb) / .5);overflow:hidden}
    .mobile-timing-source>i b{position:absolute;inset-block:1px;left:var(--timing-start);width:var(--timing-width);border-radius:999px;background:rgb(var(--accent-rgb) / .42);box-shadow:inset 0 0 0 1px var(--accent)}
    .mobile-timing-source.rejected>i b{background:rgb(var(--danger-rgb) / .22);box-shadow:inset 0 0 0 1px var(--danger)}
  }
</style>
