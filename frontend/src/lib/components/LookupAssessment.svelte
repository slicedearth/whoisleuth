<script lang="ts">
  import {
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
  type RiskBandId = 'elevated' | 'review' | 'lower';
  type OpportunityBandId = 'higher' | 'developing' | 'limited';

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

  function qualitySummary(score: OpportunityExplanation | RiskExplanation): string {
    const quality = score.evidenceQuality;
    const limited = quality.limitedSources + quality.unavailableSources;
    return `${quality.completeSources} complete · ${limited} limited or unavailable · ${quality.skippedSources} skipped or unsupported`;
  }

  function evidenceStateLabel(value: RiskExplanation['evidenceQuality']['state']): string {
    return value === 'complete' ? 'Complete'
      : value === 'limited' ? 'Limited'
        : value === 'partial' ? 'Partial'
          : 'Unknown';
  }

  function isSynthetic(score: ScoreExplanation): score is SyntheticRiskExplanation {
    return 'synthetic' in score && score.synthetic === true;
  }

  function riskBand(score: number): Readonly<{ id: RiskBandId; label: string; summary: string }> {
    if (score >= 70) return {
      id: 'elevated',
      label: 'Elevated review priority',
      summary: 'Prioritise the attributed evidence for analyst review; the band is not a finding.',
    };
    if (score >= 40) return {
      id: 'review',
      label: 'Review priority',
      summary: 'Review the contributing evidence and limitations before deciding what to do next.',
    };
    return {
      id: 'lower',
      label: 'Lower triage band',
      summary: 'A lower Risk band is neutral; review the evidence before deciding.',
    };
  }

  function opportunityBand(score: number): Readonly<{ id: OpportunityBandId; label: string }> {
    if (score >= 70) return { id: 'higher', label: 'Higher readiness context' };
    if (score >= 40) return { id: 'developing', label: 'Developing readiness context' };
    return { id: 'limited', label: 'Limited readiness context' };
  }

  function familyLabel(value: string): string {
    return value.replaceAll('-', ' ');
  }
</script>

{#snippet FactorChart(score: ScoreExplanation)}
  {@const chart = projectScoreFactors(score.factors)}
  {#if chart.factors.length}
    <div class="factor-chart" aria-hidden="true">
      {#each chart.factors as factor}
        <div class:negative={factor.delta < 0} class:zero={factor.delta === 0} class="factor-row">
          <span class="factor-label">{factor.label}</span>
          <span class="factor-track">
            <i class="zero-line"></i>
            {#if factor.delta === 0}
              <i class="zero-marker"></i>
            {:else}
              <i
                class="factor-bar"
                style:width={`${Math.max(1, (Math.abs(factor.delta) / chart.maximum) * 50)}%`}
              ></i>
            {/if}
          </span>
          <strong class="factor-value">{factor.delta >= 0 ? '+' : ''}{Math.round(factor.delta)}</strong>
        </div>
      {/each}
    </div>
    {#if chart.truncated}<p class="factor-limit">The chart is capped at {chart.factors.length} factors. The complete accessible factor list remains below.</p>{/if}
  {/if}
{/snippet}

{#snippet FactorList(score: ScoreExplanation, label: string)}
  <section class="factor-section" aria-labelledby={`${label.toLowerCase()}-factor-title`}>
    <h6 id={`${label.toLowerCase()}-factor-title`}>Complete factor list</h6>
    <ul class="factor-list">
      {#each score.factors as factor}
        <li>
          <span><strong>{factor.label}</strong>{#if 'family' in factor}<small>{familyLabel(String(factor.family))}</small>{/if}</span>
          <b>{factor.delta >= 0 ? '+' : ''}{Math.round(factor.delta)}</b>
        </li>
      {/each}
    </ul>
  </section>
{/snippet}

<section class="availability card" aria-labelledby="lookup-assessment-title">
  <header class="section-head">
    <div>
      <p class="eyebrow">Evidence assessment</p>
      <h4 id="lookup-assessment-title">{detail}</h4>
      <p>{confidence} confidence · review the canonical evidence and limitations above before using either triage model.</p>
    </div>
  </header>

  {#if signals.length}
    <div class="signals" role="group" aria-label="Assessment observations">
      {#each signals as signal}
        <span class="chip {signal.tone === 'neutral' ? '' : signal.tone}" title={signal.detail || ''}>{signal.label}</span>
      {/each}
    </div>
  {/if}

  {#if trusted}
    <p class="callout info">This domain is {trusted} in the active brand profile. Triage remains evidence context and is not treated as an untrusted finding.</p>
  {/if}

  <div class="assessment-bands">
    {#if risk}
      {@const band = riskBand(risk.score)}
      <section class="triage-band risk-band band-{band.id}" data-risk-band={band.id} aria-labelledby="risk-band-title">
        <header>
          <div>
            <p class="eyebrow">Secondary triage</p>
            <h5 id="risk-band-title">Risk · {band.label}</h5>
          </div>
          <span class="model-label">{isSynthetic(risk) ? 'Synthetic fixture' : `Risk model v${risk.modelVersion}`}</span>
        </header>
        <p class="band-summary">{band.summary}</p>
        {#if isSynthetic(risk)}
          <div class="coverage-state state-unknown"><strong>Evidence coverage: demonstration only</strong><span>This fixed score was not produced by the live Risk model.</span></div>
        {:else}
          <div class="coverage-state state-{risk.evidenceQuality.state}">
            <strong>Evidence coverage: {evidenceStateLabel(risk.evidenceQuality.state)}</strong>
            <span>{qualitySummary(risk)} · {risk.evidenceQuality.observedFamilies.length} observed scoring families · {risk.evidenceQuality.scanDepth} scan</span>
          </div>
          <ul class="material-limitations" aria-label="Material Risk limitations">
            {#each risk.evidenceQuality.limitations as limitation}<li>{limitation}</li>{/each}
          </ul>
        {/if}

        <details class="score-detail" aria-label="Risk triage explanation">
          <summary><span>Explain Risk triage</span><small>Exact model result, factors and sensitivity</small></summary>
          <div class="score-detail-body">
            <dl class="exact-score">
              <div><dt>Exact model result</dt><dd>{risk.score}/100</dd></div>
              <div><dt>Model</dt><dd>{isSynthetic(risk) ? 'Synthetic fixture' : `Risk v${risk.modelVersion}`}</dd></div>
              {#if !isSynthetic(risk)}
                <div><dt>Coverage state</dt><dd>{evidenceStateLabel(risk.evidenceQuality.state)}</dd></div>
                <div><dt>Observation time</dt><dd>{risk.evidenceQuality.freshness === 'observed' ? 'Recorded' : 'Unavailable'}</dd></div>
              {/if}
            </dl>
            {#if risk.capped}<p class="score-quality">Raw total {risk.rawScore}; displayed result capped at {risk.score}.</p>{/if}
            {@render FactorChart(risk)}
            {@render FactorList(risk, 'Risk')}
            {#if !isSynthetic(risk)}
              <section class="sensitivity" aria-labelledby="risk-sensitivity-title">
                <h6 id="risk-sensitivity-title">Single-family sensitivity</h6>
                {#if riskSensitivity}
                  <p>The baseline is {riskSensitivity.baselineScore}/100. Removing each contributing family in turn produces a minimum of {riskSensitivity.minimumScenarioScore}/100. {riskSensitivity.thresholdState === 'crosses' ? `The ${riskSensitivity.reviewThreshold}-point review threshold depends on combined evidence.` : riskSensitivity.thresholdState === 'stable_above' ? `Every scenario remains above the ${riskSensitivity.reviewThreshold}-point review threshold.` : 'The baseline is below the review threshold.'}</p>
                  {#if riskSensitivity.scenarios.length}
                    <ul class="scenario-list">
                      {#each riskSensitivity.scenarios as scenario}
                        <li><span>Without {familyLabel(scenario.excludedFamily)}</span><strong>{scenario.score}/100 <small>({scenario.difference})</small></strong></li>
                      {/each}
                    </ul>
                  {:else}
                    <p>No removable positive evidence family was present, so there is no alternate single-family scenario.</p>
                  {/if}
                  <ul class="sensitivity-limitations">{#each riskSensitivity.limitations as limitation}<li>{limitation}</li>{/each}</ul>
                {:else}
                  <p>Sensitivity was unavailable for this retained explanation.</p>
                {/if}
              </section>
            {/if}
          </div>
        </details>
      </section>
    {/if}

    {#if task === 'acquisition' && opportunity}
      {@const band = opportunityBand(opportunity.score)}
      <section class="triage-band opportunity-band band-{band.id}" data-opportunity-band={band.id} aria-labelledby="opportunity-band-title">
        <header>
          <div>
            <p class="eyebrow">Acquisition task only</p>
            <h5 id="opportunity-band-title">Opportunity · {band.label}</h5>
          </div>
          <span class="model-label">Opportunity model v{opportunity.modelVersion}</span>
        </header>
        <p class="band-summary">Opportunity is acquisition-readiness context only. It is not availability, value, eligibility, price, or likely purchase success.</p>
        <div class="coverage-state state-{opportunity.evidenceQuality.state}">
          <strong>Evidence coverage: {evidenceStateLabel(opportunity.evidenceQuality.state)}</strong>
          <span>{qualitySummary(opportunity)} · {opportunity.evidenceQuality.scanDepth} scan</span>
        </div>
        <ul class="material-limitations" aria-label="Material Opportunity limitations">
          {#each opportunity.evidenceQuality.limitations as limitation}<li>{limitation}</li>{/each}
        </ul>
        <details class="score-detail" aria-label="Opportunity acquisition-readiness explanation">
          <summary><span>Explain Opportunity context</span><small>Exact model result, dimensions and factors</small></summary>
          <div class="score-detail-body">
            <dl class="exact-score">
              <div><dt>Exact model result</dt><dd>{opportunity.score}/100</dd></div>
              <div><dt>Model</dt><dd>Opportunity v{opportunity.modelVersion}</dd></div>
              <div><dt>Coverage state</dt><dd>{evidenceStateLabel(opportunity.evidenceQuality.state)}</dd></div>
              <div><dt>Observation time</dt><dd>{opportunity.evidenceQuality.freshness === 'observed' ? 'Recorded' : 'Unavailable'}</dd></div>
            </dl>
            {#if opportunity.dimensions.length}<dl class="dimensions">{#each opportunity.dimensions as dimension}<div><dt>{dimension.label}</dt><dd>{dimension.contribution >= 0 ? '+' : ''}{dimension.contribution}</dd></div>{/each}</dl>{/if}
            {#if opportunity.capped}<p class="score-quality">Raw total {opportunity.rawScore}; displayed result capped at {opportunity.score}.</p>{/if}
            {@render FactorChart(opportunity)}
            {@render FactorList(opportunity, 'Opportunity')}
          </div>
        </details>
      </section>
    {/if}
  </div>
</section>

<style>
  .availability{min-width:0;padding:var(--card-pad)}
  .availability h4{margin:0;font-size:1.05rem;overflow-wrap:anywhere}
  .availability .section-head p:not(.eyebrow){margin:5px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .signals{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}
  .signals .chip{white-space:normal}
  .assessment-bands{display:grid;gap:10px;min-width:0;margin-top:14px}
  .triage-band{min-width:0;padding:14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  .triage-band>header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  .triage-band h5{margin:2px 0 0;font:700 var(--text-md) var(--mono);overflow-wrap:anywhere}
  .model-label{flex:0 0 auto;padding:4px 7px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .risk-band.band-elevated{border-left:3px solid var(--danger)}
  .risk-band.band-review{border-left:3px solid var(--amber)}
  .risk-band.band-lower{border-left:3px solid var(--muted)}
  .opportunity-band{border-left:3px solid var(--violet)}
  .band-summary{margin:8px 0 0;color:var(--text);font-size:var(--text-xs);line-height:1.55;overflow-wrap:anywhere}
  .coverage-state{display:grid;gap:3px;margin-top:10px;padding:9px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .coverage-state strong{font:700 var(--text-xs) var(--mono)}
  .coverage-state span{color:var(--muted);font-size:var(--text-2xs);line-height:1.45;overflow-wrap:anywhere}
  .coverage-state.state-limited strong,.coverage-state.state-partial strong{color:var(--amber)}
  .coverage-state.state-unknown strong{color:var(--muted)}
  .material-limitations{display:grid;gap:4px;margin:9px 0 0;padding-left:18px;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .score-detail{min-width:0;margin-top:11px;border-top:1px solid var(--border)}
  .score-detail>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 1px 0;color:var(--accent);font:700 var(--text-xs) var(--mono);cursor:pointer}
  .score-detail>summary small{color:var(--muted);font:400 var(--text-2xs) var(--font-sans);text-align:right}
  .score-detail>summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  .score-detail-body{min-width:0;padding-top:10px}
  .exact-score{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:0}
  .exact-score div,.dimensions div{min-width:0;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .exact-score dt,.dimensions dt{color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .exact-score dd,.dimensions dd{margin:4px 0 0;color:var(--text);font:700 var(--text-xs) var(--mono);overflow-wrap:anywhere}
  .score-quality{margin:10px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .factor-chart{display:grid;width:100%;min-width:0;gap:6px;margin:10px 0 0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .factor-row{display:grid;grid-template-columns:minmax(220px,1.15fr) minmax(180px,1fr) 34px;min-width:0;align-items:center;gap:10px}
  .factor-label{min-width:0;color:var(--muted);font:9px/1.45 var(--mono);overflow-wrap:anywhere}
  .factor-track{position:relative;min-width:0;height:18px;border-radius:3px;background:color-mix(in srgb,var(--border) 30%,transparent)}
  .zero-line{position:absolute;top:-2px;bottom:-2px;left:50%;width:1px;background:var(--border-strong)}
  .factor-bar{position:absolute;top:1px;bottom:1px;left:50%;border:1px solid var(--violet);border-radius:3px;background:rgb(var(--violet-rgb) / var(--factor-fill-alpha))}
  .factor-row.negative .factor-bar{right:50%;left:auto;border-color:var(--accent);background:rgb(var(--accent-rgb) / var(--factor-negative-fill-alpha))}
  .zero-marker{position:absolute;top:5px;left:calc(50% - 4px);width:8px;height:8px;border:2px solid var(--muted);border-radius:50%;background:var(--panel)}
  .factor-value{color:var(--text);font:700 9px var(--mono);text-align:right}
  .factor-limit{margin:7px 0 0;color:var(--muted);font-size:var(--text-2xs)}
  .factor-section,.sensitivity{margin-top:12px;padding-top:11px;border-top:1px solid var(--border)}
  .factor-section h6,.sensitivity h6{margin:0;font:700 var(--text-xs) var(--mono)}
  .factor-list,.scenario-list{display:grid;gap:6px;margin:8px 0 0;padding:0;list-style:none}
  .factor-list li,.scenario-list li{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;min-width:0;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .factor-list li>span{min-width:0}
  .factor-list strong,.factor-list small{display:block;overflow-wrap:anywhere}
  .factor-list strong{font-size:var(--text-xs)}
  .factor-list small{margin-top:3px;color:var(--muted);font:var(--text-2xs) var(--mono);text-transform:capitalize}
  .factor-list b,.scenario-list>li>strong{flex:0 0 auto;color:var(--text);font:700 var(--text-xs) var(--mono)}
  .sensitivity>p{margin:7px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .scenario-list li>span{font-size:var(--text-xs);text-transform:capitalize;overflow-wrap:anywhere}
  .scenario-list strong small{color:var(--muted);font:inherit}
  .sensitivity-limitations{display:grid;gap:4px;margin:9px 0 0;padding-left:18px;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .dimensions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:10px 0 0}
  @media(max-width:900px){
    .exact-score{grid-template-columns:repeat(2,minmax(0,1fr))}
  }
  @media(max-width:650px){
    .triage-band>header,.score-detail>summary{align-items:flex-start;flex-direction:column}
    .model-label{flex:initial}
    .score-detail>summary small{text-align:left}
    .factor-chart{display:none}
    .exact-score,.dimensions{grid-template-columns:minmax(0,1fr)}
    .factor-list li,.scenario-list li{gap:8px}
  }
  @media(min-width:651px) and (max-width:820px){
    .factor-row{grid-template-columns:minmax(170px,1fr) minmax(140px,.9fr) 32px}
  }
</style>
