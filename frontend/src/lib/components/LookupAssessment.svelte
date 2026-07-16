<script lang="ts">
  import { riskTone, scoreTone } from '$lib/analysis/scoring.js';

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
        <ul>{#each risk.factors as factor}<li><span>{factor.label}</span><strong>{factor.delta >= 0 ? '+' : ''}{Math.round(factor.delta)}</strong></li>{/each}</ul>
      </details>
    {/if}
    {#if opportunity}
      <details class="disclosure">
        <summary>Why the opportunity score is {opportunity.score}</summary>
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
