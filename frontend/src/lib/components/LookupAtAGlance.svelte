<script lang="ts">
  import type { DecisionFact } from '../../../../packages/evidence/decision-fact.mts';
  import {
    buildLookupAtAGlanceModel,
    type LookupAtAGlanceGroupId,
  } from '$lib/analysis/lookup-at-a-glance-model.ts';
  import type { LookupReviewActionModel } from '$lib/analysis/lookup-review-action-model.ts';
  import type { LookupSummarySignal } from '$lib/analysis/lookup-summary-model.ts';

  let {
    reviewActions,
    lookupDecisionFacts,
    signals,
  }: {
    reviewActions: LookupReviewActionModel;
    lookupDecisionFacts: readonly DecisionFact[];
    signals: readonly LookupSummarySignal[];
  } = $props();

  const notableSignals = $derived.by(() => {
    const priority = signals.filter((signal) => signal.tone !== 'neutral');
    return (priority.length ? priority : signals).slice(0, 4);
  });
  const nextReviews = $derived(reviewActions.recommendedNextReviews);
  const metricGroups = $derived.by(() => buildLookupAtAGlanceModel(lookupDecisionFacts).groups);
  let selectedMetricId = $state<LookupAtAGlanceGroupId | null>(null);
  const selectedMetric = $derived(
    metricGroups.find((metric) => metric.id === selectedMetricId) ?? null,
  );

  function toggleMetric(metricId: LookupAtAGlanceGroupId): void {
    selectedMetricId = selectedMetricId === metricId ? null : metricId;
  }
</script>

<section class="at-a-glance card" aria-labelledby="lookup-at-a-glance-title">
  <header class="glance-header">
    <div class="glance-intro">
      <p class="eyebrow">Analyst synthesis</p>
      <h4 id="lookup-at-a-glance-title">Analyst assessment</h4>
      <p>Use one evidence-led view of the current observations, disagreements, unknowns and next review. Record the analyst's conclusion separately.</p>
    </div>
    <div class="metrics" role="group" aria-label="Evidence coverage and review cues">
      {#each metricGroups as metric (metric.id)}
        <button
          type="button"
          class={`metric-trigger tone-${metric.presentation.tone}`}
          class:selected={selectedMetricId === metric.id}
          data-metric-id={metric.id}
          data-tone={metric.presentation.tone}
          data-count={metric.count}
          data-displayed-count={metric.displayedItems.length}
          data-omitted-count={metric.omittedCount}
          aria-label={metric.presentation.assistiveText}
          aria-expanded={selectedMetricId === metric.id}
          aria-controls={selectedMetric ? 'lookup-metric-detail' : undefined}
          onclick={() => toggleMetric(metric.id)}
        >
          <span class="metric-value">
            <span class="metric-icon" data-icon={metric.presentation.icon} aria-hidden="true"></span>
            <strong>{metric.count}</strong>
          </span>
          <span class="metric-label">{metric.presentation.label}</span>
          <span class="metric-action" aria-hidden="true">{selectedMetricId === metric.id ? 'Close' : 'Details'}</span>
        </button>
      {/each}
      <p class="metric-note">Complete and limited describe evidence coverage; neither state establishes safety.</p>
    </div>
  </header>

  {#if selectedMetric}
    <section
      class={`metric-detail tone-${selectedMetric.presentation.tone}`}
      id="lookup-metric-detail"
      aria-label={`${selectedMetric.presentation.label} detail`}
      data-selected-metric-id={selectedMetric.id}
    >
      <header>
        <strong>{selectedMetric.count} {selectedMetric.presentation.label}</strong>
        <p>{selectedMetric.presentation.explanation}</p>
      </header>
      {#if selectedMetric.displayedItems.length}
        <ul class="metric-items">
          {#each selectedMetric.displayedItems as item (item.factId)}
            <li class="metric-item" data-fact-id={item.factId}>
              <a class="metric-item-link" href={item.destination}>
                <strong>{item.label}</strong>
                <small><span class="state-label">{item.statePresentation.label}</span> · {item.detail}</small>
              </a>
              {#if item.contributors.length}
                <ul class="contributors" aria-label={`Contributors for ${item.label}`}>
                  {#each item.contributors as contributor (contributor.id)}
                    <li>
                      <span class="contributor-heading">
                        <strong>{contributor.label}</strong>
                        <small>{contributor.provenancePresentation.label} · {contributor.evidencePresentation.label}</small>
                      </span>
                      {#each contributor.limitations as limitation}
                        <p class="limitation"><strong>Limitation:</strong> {limitation}</p>
                      {/each}
                    </li>
                  {/each}
                </ul>
              {/if}
              {#each item.limitations as limitation}
                <p class="limitation fact-limitation"><strong>Fact limitation:</strong> {limitation}</p>
              {/each}
            </li>
          {/each}
        </ul>
      {:else}
        <p>{selectedMetric.emptyMessage}</p>
      {/if}
      {#if selectedMetric.omittedCount > 0}
        <p class="metric-omitted">
          <strong>{selectedMetric.omittedCount}</strong> additional contributing fact{selectedMetric.omittedCount === 1 ? ' is' : 's are'} omitted from this summary.
          <a href={selectedMetric.destination}>Inspect source detail.</a>
        </p>
      {/if}
    </section>
  {/if}

  <div class="glance-grid independent-grid">
    <section aria-labelledby="lookup-key-findings-title">
      <h5 id="lookup-key-findings-title">Current observations</h5>
      {#if notableSignals.length}
        <ul class="signals">
          {#each notableSignals as signal}
            <li class={`tone-${signal.tone}`}>
              <span aria-hidden="true"></span>
              <div><strong>{signal.label}</strong>{#if signal.detail}<small>{signal.detail}</small>{/if}</div>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty">No compact observation is available. Review the source-quality section before drawing a conclusion.</p>
      {/if}
    </section>

    <section aria-labelledby="lookup-next-review-title">
      <h5 id="lookup-next-review-title">Next review</h5>
      {#if nextReviews.displayedItems.length}
        <p class="action-counts" data-action-counts>
          Showing <strong>{nextReviews.displayedCount}</strong> of <strong>{nextReviews.total}</strong> ranked review action{nextReviews.total === 1 ? '' : 's'}.
          {#if nextReviews.omittedCount > 0}<span>{nextReviews.omittedCount} omitted from this bounded display.</span>{/if}
        </p>
        <div
          class="next-actions"
          data-total={nextReviews.total}
          data-displayed-count={nextReviews.displayedCount}
          data-omitted-count={nextReviews.omittedCount}
          data-contributing-fact-ids={nextReviews.contributingFactIds.join(',')}
        >
          {#each nextReviews.displayedItems as nextAction (nextAction.id)}
            <a
              class="next-action"
              href={nextAction.href}
              data-action-id={nextAction.id}
              data-basis={nextAction.basis}
              data-contributing-fact-ids={nextAction.contributingFactIds.join(',')}
            >
              <strong>{nextAction.label}</strong>
              <span>{nextAction.reason}</span>
              <small>{nextAction.expectedOutcome}</small>
              <small class="action-basis"><b>Basis:</b> {nextAction.basisLabel}</small>
              {#if nextAction.contributingFactIds.length}
                <small class="action-facts"><b>Decision Facts:</b> {nextAction.contributingFactIds.join(' · ')}</small>
              {:else}
                <small class="contextual-note">Contextual guidance; no evidence fact or provenance is claimed.</small>
              {/if}
            </a>
          {/each}
        </div>
      {:else}
        <p class="empty">No contextual action is available from the settled evidence. Review source coverage and freshness next.</p>
      {/if}
    </section>
  </div>
</section>

<style>
  .at-a-glance{container-type:inline-size;min-width:0;padding:var(--card-pad)}
  .glance-header{display:grid;grid-template-columns:minmax(240px,.7fr) minmax(0,2fr);align-items:start;gap:18px}
  .glance-intro{min-width:0}
  h4{margin:2px 0 0;font:700 var(--text-lg) var(--mono)}
  .glance-header p:not(.eyebrow){max-width:660px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;min-width:0;width:100%}
  .metric-trigger{display:grid;grid-template-columns:auto minmax(0,1fr) auto;min-width:0;min-height:44px;align-items:center;gap:7px;padding:7px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--muted);font:var(--text-2xs) var(--mono);text-align:left;cursor:pointer}
  .metric-trigger:hover{border-color:var(--border-strong);background:var(--control-hover)}
  .metric-trigger.selected{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 7%,var(--panel-raised))}
  .metric-trigger:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .metric-action{color:var(--accent);font-size:var(--text-2xs)}
  .metric-value{display:inline-flex;align-items:center;gap:6px;min-width:0}
  .metric-label{min-width:0;overflow-wrap:break-word}
  .metric-value>strong{color:var(--text);font-size:var(--text-sm)}
  .metric-icon{display:grid;width:16px;height:16px;place-items:center;border:1px solid currentColor;border-radius:50%;color:var(--muted);font:700 var(--text-2xs) var(--mono)}
  .metric-icon::before{content:'•'}
  .metric-icon[data-icon='evidence-observed']::before{content:'●';font-size:7px}
  .metric-icon[data-icon='evidence-limited']::before{content:'!'}
  .metric-icon[data-icon='source-disagreement']::before{content:'≠'}
  .metric-icon[data-icon='state-unknown']::before{content:'?'}
  .metrics .tone-caution .metric-value>strong,.metrics .tone-caution .metric-icon{color:var(--amber)}
  .metrics .tone-conflict .metric-value>strong,.metrics .tone-conflict .metric-icon{color:var(--danger)}
  .metric-detail{min-width:0;margin-top:10px;padding:10px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .metric-detail>header>strong{color:var(--text);font:700 var(--text-xs) var(--mono)}
  .metric-detail p{margin:6px 0 0;color:var(--muted);font:var(--text-2xs) var(--font-sans);line-height:1.5}
  .metric-items{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:8px 0 0;padding:0;list-style:none}
  .metric-item{min-width:0;padding:8px;border-left:2px solid var(--accent);background:color-mix(in srgb,var(--accent) 5%,transparent)}
  .metric-item-link{display:grid;gap:3px;min-width:0;text-decoration:none}
  .metric-item-link strong,.metric-item-link small,.contributor-heading strong,.contributor-heading small{overflow-wrap:anywhere}
  .metric-item-link>strong{font-size:var(--text-xs)}
  .metric-item-link>small{color:var(--muted);font:var(--text-2xs) var(--font-sans);line-height:1.4}
  .state-label{color:var(--text);font-weight:700}
  .contributors{display:grid;gap:5px;margin:7px 0 0;padding:7px 0 0;border-top:1px solid var(--border);list-style:none}
  .contributors>li{min-width:0}
  .contributor-heading{display:flex;flex-wrap:wrap;align-items:baseline;gap:3px 7px;min-width:0}
  .contributor-heading strong{color:var(--text);font-size:var(--text-2xs)}
  .contributor-heading small{color:var(--muted);font:var(--text-2xs) var(--font-sans)}
  .metric-detail .limitation{margin:3px 0 0;padding-left:9px;border-left:1px solid var(--amber);overflow-wrap:anywhere}
  .metric-detail .limitation strong{color:var(--text);font-weight:600}
  .metric-detail .fact-limitation{margin-top:7px}
  .metric-detail .metric-omitted{overflow-wrap:anywhere}
  .metric-omitted a{white-space:normal}
  .metric-note{grid-column:1/-1;max-width:none;margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45;text-align:right;overflow-wrap:anywhere}
  .glance-grid{grid-template-columns:minmax(0,1.1fr) minmax(260px,.9fr);gap:9px;margin-top:14px}
  .glance-grid>section{min-width:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  h5{margin:0 0 9px;font:700 var(--text-xs) var(--mono)}
  .signals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:0;padding:0;list-style:none}
  .signals li{display:grid;grid-template-columns:8px minmax(0,1fr);gap:8px;min-width:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.4}
  .signals li>span{width:7px;height:7px;margin-top:4px;border:2px solid var(--muted);border-radius:50%}
  .signals .tone-danger>span{border-color:var(--danger)}
  .signals .tone-warn>span{border-color:var(--amber)}
  .signals .tone-good>span{border-color:var(--accent2)}
  .signals strong,.signals small{display:block;overflow-wrap:anywhere}
  .signals strong{color:var(--text);font-size:var(--text-xs)}
  .signals small{margin-top:2px;color:var(--muted)}
  .next-action{display:grid;gap:4px;padding:10px;border-left:2px solid var(--accent);background:color-mix(in srgb,var(--accent) 5%,transparent)}
  .next-actions{display:grid;gap:7px}
  .next-action strong{color:var(--text);font:700 var(--text-xs) var(--mono)}
  .next-action span,.next-action small{color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .next-action small{color:var(--text)}
  .action-counts{margin:0 0 7px;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}.action-counts span{display:block}.action-counts strong{color:var(--text)}
  .next-action .action-basis,.next-action .action-facts,.next-action .contextual-note{min-width:0;color:var(--muted);overflow-wrap:anywhere}.next-action .action-basis{padding-top:5px;border-top:1px solid var(--border)}.next-action .action-basis b,.next-action .action-facts b{color:var(--text)}
  .empty{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  @container(max-width:760px){
    .glance-header{grid-template-columns:minmax(0,1fr)}
    .metric-note{text-align:left}
  }
  @container(max-width:420px){
    .metrics{grid-template-columns:minmax(0,1fr)}
  }
  @media(max-width:840px){
    .glance-grid{grid-template-columns:minmax(0,1fr)}
  }
  @media(max-width:520px){
    .signals{grid-template-columns:minmax(0,1fr)}
    .metric-items{grid-template-columns:minmax(0,1fr)}
  }
</style>
