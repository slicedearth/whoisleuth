<script lang="ts">
  import DataVisualization from '$lib/components/DataVisualization.svelte';
  import {
    projectTriagePoints,
    type TriagePointInput,
  } from '$lib/analysis/visualization-models.ts';

  let { points, matchedCount }: { points: TriagePointInput[]; matchedCount: number } = $props();
  const plot = $derived(projectTriagePoints(points));
  const ticks = [0, 25, 50, 75, 100];
  const x = (value: number) => 58 + value / 100 * 784;
  const y = (value: number) => 308 - value / 100 * 280;
</script>

{#if matchedCount > 0}
  <DataVisualization
    id="bulk-triage-plot"
    eyebrow="Result distribution"
    title="Risk and opportunity matrix"
    description="A visual index of the currently filtered results. Both axes are explainable heuristics, not a maliciousness or ownership determination."
    metric={matchedCount}
    metricLabel="filtered results"
    compact
  >
    {#if plot.points.length}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -- scrollable chart must be keyboard reachable -->
      <div class="plot-frame" role="img" tabindex="0" aria-label={`${plot.points.length} filtered domains plotted by risk and opportunity score`}>
        <svg viewBox={`0 0 ${plot.width} ${plot.height}`} aria-hidden="true">
          <rect x="58" y="28" width="392" height="140" class="quadrant review" />
          <rect x="450" y="28" width="392" height="140" class="quadrant priority" />
          <rect x="58" y="168" width="392" height="140" class="quadrant low" />
          <rect x="450" y="168" width="392" height="140" class="quadrant watch" />
          {#each ticks as tick}
            <line x1={x(tick)} x2={x(tick)} y1="28" y2="308" class="grid-line" />
            <line x1="58" x2="842" y1={y(tick)} y2={y(tick)} class="grid-line" />
            <text x={x(tick)} y="329" text-anchor="middle" class="tick-label">{tick}</text>
            <text x="44" y={y(tick) + 3} text-anchor="end" class="tick-label">{tick}</text>
          {/each}
          <text x="450" y="350" text-anchor="middle" class="axis-label">RISK SCORE →</text>
          <text x="16" y="168" text-anchor="middle" transform="rotate(-90 16 168)" class="axis-label">OPPORTUNITY SCORE →</text>
          <text x="74" y="48" class="quadrant-label">AVAILABLE / REVIEW</text>
          <text x="826" y="48" text-anchor="end" class="quadrant-label">PRIORITY REVIEW</text>
          <text x="74" y="298" class="quadrant-label">LOWER SCORES</text>
          <text x="826" y="298" text-anchor="end" class="quadrant-label">RISK-LED REVIEW</text>
          {#each plot.points as point (point.domain)}
            <circle cx={point.x} cy={point.y} r="4.5" class={`plot-point ${point.tone}`}>
              <title>{point.domain}: risk {point.risk}, opportunity {point.opportunity}, {point.availability}</title>
            </circle>
          {/each}
        </svg>
      </div>
      <ul class="plot-legend" aria-label="Risk and opportunity plot legend">
        <li><span class="available"></span>Available</li>
        <li><span class="registered"></span>Registered or review</li>
        <li><span class="trusted"></span>Trusted by active profile</li>
        <li><span class="error"></span>Error</li>
      </ul>
      <dl class="quadrant-summary" aria-label="Risk and opportunity quadrant counts">
        <div><dt>Available / review</dt><dd>{plot.quadrants.availableReview}</dd></div>
        <div><dt>Priority review</dt><dd>{plot.quadrants.priorityReview}</dd></div>
        <div><dt>Lower scores</dt><dd>{plot.quadrants.lowerScores}</dd></div>
        <div><dt>Risk-led review</dt><dd>{plot.quadrants.riskLedReview}</dd></div>
      </dl>
      <p class="plot-note">
        Plotted {plot.points.length} of {plot.eligibleCount} results with both scores.
        {#if plot.omittedCount}{plot.omittedCount} filtered result{plot.omittedCount === 1 ? '' : 's'} lacked a complete score pair.{/if}
        {#if plot.sampled} The visual uses a deterministic {plot.points.length}-point sample; the table below retains every result.{/if}
      </p>
    {:else}
      <p class="empty-plot">No currently filtered result has both a Risk and Opportunity score. The table remains the complete result view.</p>
    {/if}
  </DataVisualization>
{/if}

<style>
  .plot-frame{max-width:100%;overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  .plot-frame:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  svg{display:block;width:100%;height:auto}
  .quadrant{fill:rgb(var(--overlay-rgb) / .012)}
  .quadrant.review{fill:rgb(var(--accent-rgb) / .025)}
  .quadrant.priority{fill:rgb(var(--amber-rgb) / .04)}
  .quadrant.watch{fill:rgb(var(--danger-rgb) / .025)}
  .grid-line{stroke:var(--border);stroke-width:1}
  .tick-label,.axis-label,.quadrant-label{fill:var(--muted);font-family:var(--mono)}
  .tick-label{font-size:9px}
  .axis-label{font-size:9px;font-weight:750;letter-spacing:.08em}
  .quadrant-label{font-size:8px;font-weight:700;letter-spacing:.06em}
  .plot-point{fill:var(--amber);stroke:var(--panel);stroke-width:1.5;opacity:.82}
  .plot-point.available{fill:var(--accent)}
  .plot-point.trusted{fill:var(--accent2)}
  .plot-point.error{fill:var(--danger)}
  .plot-legend{display:flex;flex-wrap:wrap;gap:8px 15px;margin:10px 0 0;padding:0;list-style:none;color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .plot-legend li{display:flex;align-items:center;gap:6px}
  .plot-legend span{width:8px;height:8px;border-radius:50%;background:var(--amber)}
  .plot-legend .available{background:var(--accent)}
  .plot-legend .trusted{background:var(--accent2)}
  .plot-legend .error{background:var(--danger)}
  .quadrant-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:10px 0 0}
  .quadrant-summary div{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .quadrant-summary dt{color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .quadrant-summary dd{margin:0;color:var(--text);font:750 var(--text-xs) var(--mono);font-variant-numeric:tabular-nums}
  .plot-note,.empty-plot{margin:9px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  @media(max-width:620px){
    .plot-frame{overflow-x:auto;overscroll-behavior-x:contain}
    svg{min-width:680px}
    .quadrant-summary{grid-template-columns:repeat(2,minmax(0,1fr))}
  }
</style>
