<script lang="ts">
  import { riskTone, scoreTone } from '$lib/analysis/scoring.ts';
  import { projectScoreFactors } from '$lib/analysis/visualization-models.ts';

  type ScoreExplanation = {
    score: number;
    factors: Array<{ label: string; delta: number }>;
  } | null;

  let {
    detail,
    confidence,
    risk,
    opportunity,
    signals,
    trusted,
  }: {
    detail: string;
    confidence: string;
    risk: ScoreExplanation;
    opportunity: ScoreExplanation;
    signals: Array<{ label: string; tone: string; detail?: string }>;
    trusted: string;
  } = $props();

  function scoreTitle(score: NonNullable<ScoreExplanation>) {
    return score.factors
      .map((factor) => `${factor.label} ${factor.delta >= 0 ? '+' : ''}${Math.round(factor.delta)}`)
      .join('\n');
  }
</script>

{#snippet FactorChart(score: NonNullable<ScoreExplanation>, label: string)}
  {@const chart = projectScoreFactors(score.factors)}
  {#if chart.factors.length}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -- scrollable contribution chart must be keyboard reachable -->
    <div class="factor-chart" role="img" tabindex="0" aria-label={`${label} score contribution chart with ${chart.factors.length} non-zero factors`}>
      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} aria-hidden="true">
        <line x1={chart.zeroX} x2={chart.zeroX} y1="8" y2={chart.height - 8} class="zero-line" />
        {#each chart.factors as factor}
          <g class:negative={factor.delta < 0} class="factor">
            <text x="8" y={factor.y + 12}>{factor.label}</text>
            <rect x={factor.x} y={factor.y} width={factor.width} height="16" rx="3">
              <title>{factor.label}: {factor.delta >= 0 ? '+' : ''}{Math.round(factor.delta)}</title>
            </rect>
            <text
              x={factor.delta < 0 ? factor.x - 7 : factor.x + factor.width + 7}
              y={factor.y + 12}
              text-anchor={factor.delta < 0 ? 'end' : 'start'}
              class="factor-value"
            >{factor.delta >= 0 ? '+' : ''}{Math.round(factor.delta)}</text>
          </g>
        {/each}
      </svg>
    </div>
    {#if chart.truncated}<p class="factor-limit">The chart is capped at {chart.factors.length} factors. The exact list below remains complete.</p>{/if}
  {/if}
{/snippet}

<section class="availability card">
  <header class="section-head">
    <div>
      <p class="eyebrow">Assessment</p>
      <h4>{detail}</h4>
      <p>{confidence} confidence</p>
    </div>
    <div class="scores">
      {#if risk}
        <div class="score {riskTone(risk.score)}" title={scoreTitle(risk)}>
          <span>Risk</span><strong>{risk.score}</strong><i><b style:width={`${risk.score}%`}></b></i>
        </div>
      {/if}
      {#if opportunity}
        <div class="score {scoreTone(opportunity.score)}" title={scoreTitle(opportunity)}>
          <span>Opportunity</span><strong>{opportunity.score}</strong><i><b style:width={`${opportunity.score}%`}></b></i>
        </div>
      {/if}
    </div>
  </header>

  {#if signals.length}
    <div class="signals">
      {#each signals as signal}
        <span class="chip {signal.tone === 'neutral' ? '' : signal.tone}" title={signal.detail || ''}>{signal.label}</span>
      {/each}
    </div>
  {/if}

  {#if trusted}
    <p class="callout info">This domain is {trusted} in the active brand profile. Scores remain visible as evidence context but are not treated as an untrusted finding.</p>
  {/if}

  <div class="score-details">
    {#if risk}
      <details class="disclosure">
        <summary>Why the risk score is {risk.score}</summary>
        {@render FactorChart(risk, 'Risk')}
        <ul>{#each risk.factors as factor}<li><span>{factor.label}</span><strong>{factor.delta >= 0 ? '+' : ''}{Math.round(factor.delta)}</strong></li>{/each}</ul>
      </details>
    {/if}
    {#if opportunity}
      <details class="disclosure">
        <summary>Why the opportunity score is {opportunity.score}</summary>
        {@render FactorChart(opportunity, 'Opportunity')}
        <ul>{#each opportunity.factors as factor}<li><span>{factor.label}</span><strong>{factor.delta >= 0 ? '+' : ''}{Math.round(factor.delta)}</strong></li>{/each}</ul>
      </details>
    {/if}
  </div>
</section>

<style>
  .availability{padding:var(--card-pad)}
  .availability h4{margin:0;font-size:1.05rem}
  .scores{display:flex;gap:9px}
  .score{display:grid;grid-template-columns:1fr auto;gap:3px;width:150px;padding:9px 10px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .score span{font:600 var(--text-2xs) var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
  .score strong{font-size:1.05rem}
  .score i{grid-column:1/-1;height:5px;overflow:hidden;border-radius:99px;background:var(--border)}
  .score b{display:block;height:100%;background:var(--accent)}
  .score.danger b{background:var(--danger)}
  .score.warn b{background:var(--amber)}
  .signals{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}
  .signals .chip{white-space:normal}
  .score-details{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
  .score-details details{margin-top:0}
  .factor-chart{max-width:100%;margin:10px 12px 0;overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);overscroll-behavior-x:contain}
  .factor-chart:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .factor-chart svg{display:block;width:100%;min-width:620px;height:auto}
  .zero-line{stroke:var(--border-strong);stroke-width:1.5}
  .factor text{fill:var(--muted);font-family:var(--mono);font-size:9px}
  .factor rect{fill:rgb(var(--violet-rgb) / .22);stroke:var(--violet)}
  .factor.negative rect{fill:rgb(var(--accent-rgb) / .2);stroke:var(--accent)}
  .factor .factor-value{fill:var(--text);font-weight:700}
  .factor-limit{margin:7px 12px 0;color:var(--muted);font-size:var(--text-2xs)}
  .score-details ul{display:grid;gap:6px;margin:10px 12px;padding:0;list-style:none}
  .score-details li{display:flex;justify-content:space-between;gap:10px;color:var(--muted);font-size:var(--text-xs)}
  .score-details li strong{color:var(--text)}
  @media(max-width:900px){
    .availability .section-head{display:block}
    .scores{margin-top:12px}
  }
  @media(max-width:650px){
    .score-details{grid-template-columns:1fr}
    .scores{display:grid;grid-template-columns:1fr 1fr}
    .score{width:auto}
  }
</style>
