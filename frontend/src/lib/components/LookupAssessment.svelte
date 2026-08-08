<script lang="ts">
  import {
    riskTone,
    scoreTone,
    type OpportunityExplanation,
    type RiskExplanation,
    type RiskScoreSensitivity,
  } from '$lib/analysis/scoring.ts';
  import { projectScoreFactors } from '$lib/analysis/visualization-models.ts';
  import type { LookupTaskView } from '$lib/analysis/lookup-presentation.ts';

  type SyntheticRiskExplanation = Readonly<{
    synthetic: true;
    modelVersion: null;
    score: number;
    rawScore: number;
    capped: false;
    factors: Array<{ label: string; delta: number }>;
  }>;
  type DisplayRiskExplanation = RiskExplanation | SyntheticRiskExplanation;
  type ScoreExplanation = OpportunityExplanation | DisplayRiskExplanation;
  type ScoreHierarchy = 'primary' | 'secondary';

  let {
    detail,
    confidence,
    risk,
    riskSensitivity = null,
    opportunity,
    signals,
    trusted,
    task = 'general',
  }: {
    detail: string;
    confidence: string;
    risk: DisplayRiskExplanation | null;
    riskSensitivity?: RiskScoreSensitivity | null;
    opportunity: OpportunityExplanation | null;
    signals: Array<{ label: string; tone: string; detail?: string }>;
    trusted: string;
    task?: LookupTaskView;
  } = $props();

  function scoreTitle(score: ScoreExplanation) {
    return score.factors
      .map((factor) => `${factor.label} ${factor.delta >= 0 ? '+' : ''}${Math.round(factor.delta)}`)
      .join('\n');
  }

  function qualitySummary(score: OpportunityExplanation | RiskExplanation): string {
    const quality = score.evidenceQuality;
    return `${quality.completeSources} complete · ${quality.limitedSources + quality.unavailableSources} limited source${quality.limitedSources + quality.unavailableSources === 1 ? '' : 's'}`;
  }

  function isSynthetic(score: ScoreExplanation): score is SyntheticRiskExplanation {
    return 'synthetic' in score && score.synthetic === true;
  }

  function hierarchyLabel(value: ScoreHierarchy): string {
    return value === 'primary' ? 'Primary' : 'Secondary';
  }
</script>

{#snippet FactorChart(score: ScoreExplanation, label: string)}
  {@const chart = projectScoreFactors(score.factors)}
  {#if chart.factors.length}
    <div class="factor-chart" aria-hidden="true">
      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} aria-hidden="true">
        <line x1={chart.zeroX} x2={chart.zeroX} y1="8" y2={chart.height - 8} class="zero-line" />
        {#each chart.factors as factor}
          <g class:negative={factor.delta < 0} class:zero={factor.delta === 0} class="factor">
            <text x="8" y={factor.y + 12}>{factor.label}</text>
            {#if factor.delta === 0}
              <circle cx={chart.zeroX} cy={factor.y + 8} r="4" class="zero-marker">
                <title>{factor.label}: 0</title>
              </circle>
            {:else}
              <rect x={factor.x} y={factor.y} width={factor.width} height="16" rx="3">
                <title>{factor.label}: {factor.delta >= 0 ? '+' : ''}{Math.round(factor.delta)}</title>
              </rect>
            {/if}
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

{#snippet RiskScore(hierarchy: ScoreHierarchy)}
  {#if risk}
    <div class="score score-{hierarchy} {riskTone(risk.score)}" data-score-hierarchy={hierarchy} role="group" aria-label={`${hierarchyLabel(hierarchy)} assessment: Risk score ${risk.score}`} title={scoreTitle(risk)}>
      <span>Risk</span><strong>{risk.score}</strong><i><b style:width={`${risk.score}%`}></b></i>
      <small><em>{hierarchyLabel(hierarchy)}</em> · {isSynthetic(risk) ? 'Synthetic fixture' : `v${risk.modelVersion} · ${risk.evidenceQuality.state}`}</small>
    </div>
  {/if}
{/snippet}

{#snippet OpportunityScore(hierarchy: ScoreHierarchy)}
  {#if opportunity}
    <div class="score score-{hierarchy} {scoreTone(opportunity.score)}" data-score-hierarchy={hierarchy} role="group" aria-label={`${hierarchyLabel(hierarchy)} assessment: Opportunity score ${opportunity.score}`} title={scoreTitle(opportunity)}>
      <span>Opportunity</span><strong>{opportunity.score}</strong><i><b style:width={`${opportunity.score}%`}></b></i>
      <small><em>{hierarchyLabel(hierarchy)}</em> · v{opportunity.modelVersion} · {opportunity.evidenceQuality.state}</small>
    </div>
  {/if}
{/snippet}

{#snippet RiskDetails(hierarchy: ScoreHierarchy)}
  {#if risk}
    <details class="disclosure score-detail score-detail-{hierarchy}" data-score-hierarchy={hierarchy} aria-label={`${hierarchyLabel(hierarchy)} Risk score explanation`}>
      <summary>Why the risk score is {risk.score}</summary>
      {#if isSynthetic(risk)}
        <p class="score-quality">Fixed demonstration score for layout and workflow practice. It was not produced by the live Risk model.</p>
      {:else}
        <p class="score-quality"><strong>Evidence coverage:</strong> {qualitySummary(risk)} · {risk.evidenceQuality.observedFamilies.length} observed scoring families. {risk.evidenceQuality.freshness === 'observed' ? 'Observation time recorded.' : 'Observation time unavailable.'}</p>
        {#if riskSensitivity?.scenarios.length}
          <p class="score-quality"><strong>Single-family sensitivity:</strong> the score ranges from {riskSensitivity.minimumScenarioScore} to {riskSensitivity.baselineScore} when each contributing evidence family is removed and the model is recalculated. {riskSensitivity.thresholdState === 'crosses' ? `The ${riskSensitivity.reviewThreshold}-point review threshold depends on combined evidence.` : riskSensitivity.thresholdState === 'stable_above' ? `It stays above the ${riskSensitivity.reviewThreshold}-point review threshold in every scenario.` : 'It is already below the review threshold.'}</p>
        {/if}
      {/if}
      {#if risk.capped}<p class="score-quality">Raw total {risk.rawScore}; displayed score capped at {risk.score}.</p>{/if}
      {@render FactorChart(risk, 'Risk')}
      <ul class="factor-list">{#each risk.factors as factor}<li><span>{factor.label}</span><strong>{factor.delta >= 0 ? '+' : ''}{Math.round(factor.delta)}</strong></li>{/each}</ul>
    </details>
  {/if}
{/snippet}

{#snippet OpportunityDetails(hierarchy: ScoreHierarchy)}
  {#if opportunity}
    <details class="disclosure score-detail score-detail-{hierarchy}" data-score-hierarchy={hierarchy} aria-label={`${hierarchyLabel(hierarchy)} Opportunity score explanation`}>
      <summary>Why the opportunity score is {opportunity.score}</summary>
      <p class="score-quality"><strong>Evidence coverage:</strong> {qualitySummary(opportunity)}. This estimates acquisition readiness, not value or eventual availability.</p>
      {#if opportunity.dimensions.length}<dl class="dimensions">{#each opportunity.dimensions as dimension}<div><dt>{dimension.label}</dt><dd>{dimension.contribution >= 0 ? '+' : ''}{dimension.contribution}</dd></div>{/each}</dl>{/if}
      {#if opportunity.capped}<p class="score-quality">Raw total {opportunity.rawScore}; displayed score capped at {opportunity.score}.</p>{/if}
      {@render FactorChart(opportunity, 'Opportunity')}
      <ul class="factor-list">{#each opportunity.factors as factor}<li><span>{factor.label}</span><strong>{factor.delta >= 0 ? '+' : ''}{Math.round(factor.delta)}</strong></li>{/each}</ul>
    </details>
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
      {#if task === 'acquisition'}
        {@render OpportunityScore('primary')}
        {@render RiskScore('secondary')}
      {:else}
        {@render RiskScore('primary')}
        {@render OpportunityScore('secondary')}
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
    {#if task === 'acquisition'}
      {@render OpportunityDetails('primary')}
      {@render RiskDetails('secondary')}
    {:else}
      {@render RiskDetails('primary')}
      {@render OpportunityDetails('secondary')}
    {/if}
  </div>
</section>

<style>
  .availability{padding:var(--card-pad)}
  .availability h4{margin:0;font-size:1.05rem}
  .scores{display:flex;gap:9px}
  .score{display:grid;grid-template-columns:1fr auto;gap:3px;width:150px;padding:9px 10px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .score-primary{border-color:var(--accent2);background:var(--panel-raised)}
  .score span{font:600 var(--text-2xs) var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
  .score small em{color:var(--text);font-style:normal}
  .score strong{font-size:1.05rem}
  .score i{grid-column:1/-1;height:5px;overflow:hidden;border-radius:99px;background:var(--border)}
  .score b{display:block;height:100%;background:var(--accent)}
  .score small{grid-column:1/-1;color:var(--muted);font:600 var(--text-2xs) var(--mono);text-transform:capitalize}
  .score.danger b{background:var(--danger)}
  .score.warn b{background:var(--amber)}
  .signals{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}
  .signals .chip{white-space:normal}
  .score-details{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;min-width:0;margin-top:12px}
  .score-details details{min-width:0;margin-top:0;overflow:hidden}
  .score-detail-primary{border-inline-start:3px solid var(--accent2)}
  .factor-chart{width:calc(100% - 24px);min-width:0;margin:10px 12px 0;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .factor-chart svg{display:block;width:100%;min-width:0;height:auto}
  .zero-line{stroke:var(--border-strong);stroke-width:1.5}
  .factor text{fill:var(--muted);font-family:var(--mono);font-size:9px}
  .factor rect{fill:rgb(var(--violet-rgb) / .22);stroke:var(--violet)}
  .factor.negative rect{fill:rgb(var(--accent-rgb) / .2);stroke:var(--accent)}
  .zero-marker{fill:var(--panel);stroke:var(--muted);stroke-width:2}
  .factor .factor-value{fill:var(--text);font-weight:700}
  .factor-limit{margin:7px 12px 0;color:var(--muted);font-size:var(--text-2xs)}
  .score-details ul{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0;list-style:none}
  .score-details li{display:flex;justify-content:space-between;gap:10px;color:var(--muted);font-size:var(--text-xs)}
  .score-details li strong{color:var(--text)}
  .score-quality{margin:10px 12px 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .dimensions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:10px 12px 0}
  .dimensions div{display:flex;justify-content:space-between;gap:8px;padding:7px 8px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  .dimensions dt,.dimensions dd{margin:0;font-size:var(--text-2xs)}
  .dimensions dt{color:var(--muted)}
  @media(max-width:900px){
    .availability .section-head{display:block}
    .scores{margin-top:12px}
  }
  @media(max-width:650px){
    .scores{display:grid;grid-template-columns:1fr 1fr}
    .score{width:auto}
    .factor-chart{display:none}
    .score-details ul{position:static;display:grid;width:auto;height:auto;gap:6px;margin:10px 12px;padding:0;overflow:visible;clip:auto;clip-path:none;white-space:normal}
  }
</style>
