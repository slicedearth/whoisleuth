<script lang="ts">
  import type { DecisionFact } from '../../../../packages/evidence/decision-fact.mts';
  import {
    buildLookupAtAGlanceModel,
    type LookupAtAGlanceGroupId,
    type LookupAtAGlanceItem,
  } from '$lib/analysis/lookup-at-a-glance-model.ts';
  import { formatDate } from '$lib/analysis/lookup-display-shared.ts';
  import type { LookupPresentedReviewAction, LookupReviewActionModel } from '$lib/analysis/lookup-review-action-model.ts';
  import type { LookupSummarySignal } from '$lib/analysis/lookup-summary-model.ts';
  import { lookupQuestionsNeedingEvidence, type LookupClaimReadiness } from '$lib/analysis/lookup-claim-readiness.ts';

  let {
    reviewActions,
    lookupDecisionFacts,
    signals,
    readiness,
  }: {
    reviewActions: LookupReviewActionModel;
    lookupDecisionFacts: readonly DecisionFact[];
    signals: readonly LookupSummarySignal[];
    readiness: LookupClaimReadiness;
  } = $props();

  const notableSignals = $derived.by(() => {
    const priority = signals.filter((signal) => signal.tone !== 'neutral');
    return (priority.length ? priority : signals).slice(0, 4);
  });
  const nextReviews = $derived(reviewActions.recommendedNextReviews);
  const furtherReviews = $derived(nextReviews.rankedItems.slice(nextReviews.displayedCount));
  let allReviewsOpen = $state(false);
  const glance = $derived(buildLookupAtAGlanceModel(lookupDecisionFacts));
  const openQuestions = $derived(lookupQuestionsNeedingEvidence(readiness));
  const metricGroups = $derived(glance.groups);
  const factsById = $derived(new Map(glance.items.map((item) => [item.factId, item])));
  let selectedMetricId = $state<LookupAtAGlanceGroupId | null>(null);
  const selectedMetric = $derived(
    metricGroups.find((metric) => metric.id === selectedMetricId) ?? null,
  );

  function toggleMetric(metricId: LookupAtAGlanceGroupId): void {
    selectedMetricId = selectedMetricId === metricId ? null : metricId;
  }
</script>

{#snippet factDetail(item: LookupAtAGlanceItem)}
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
          <p class="source-time">Observed {#if contributor.observedAt}<time datetime={contributor.observedAt}>{formatDate(contributor.observedAt)}</time>{:else}time unavailable{/if}</p>
          {#each contributor.limitations as limitation}
            <p class="limitation"><strong>Limitation:</strong> {limitation}</p>
          {/each}
          {#if contributor.references.length}
            <ul class="technical-references" aria-label={`References for ${contributor.label}`}>
              {#each contributor.references as reference}<li><code>{reference}</code></li>{/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#each item.contradictions as contradiction}
    <p class="limitation"><strong>Disagreement:</strong> {contradiction}</p>
  {/each}
  {#each item.limitations as limitation}
    <p class="limitation fact-limitation"><strong>Limitation:</strong> {limitation}</p>
  {/each}
  <p class="action-facts">Technical reference: <code>{item.factId}</code></p>
  {#if item.references.length}
    <ul class="technical-references" aria-label={`References for ${item.label}`}>
      {#each item.references as reference}<li><code>{reference}</code></li>{/each}
    </ul>
  {/if}
{/snippet}

{#snippet reviewAction(nextAction: LookupPresentedReviewAction)}
  <article class="review-action">
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
    </a>
    {#if nextAction.contributingFactIds.length}
      <details class="action-evidence">
        <summary>Evidence and sources<span class="sr-only"> for {nextAction.label}</span></summary>
        <ul class="metric-items">
          {#each nextAction.contributingFactIds as factId (factId)}
            {@const item = factsById.get(factId)}
            <li class="metric-item" data-fact-id={factId}>
              {#if item}{@render factDetail(item)}{:else}<p>Source details unavailable for <code>{factId}</code>.</p>{/if}
            </li>
          {/each}
        </ul>
      </details>
    {:else}
      <small class="contextual-note">{nextAction.basisLabel}; not an observed finding.</small>
    {/if}
  </article>
{/snippet}

<section class="at-a-glance card" aria-labelledby="lookup-at-a-glance-title">
  <header class="glance-header">
    <div class="glance-intro">
      <p class="eyebrow">Retained evidence</p>
      <h4 id="lookup-at-a-glance-title">Evidence overview</h4>
      <p>Review source coverage and disagreements before recording an assessment.</p>
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

  {#if openQuestions.length}
    <details class="open-questions">
      <summary>Questions needing evidence ({openQuestions.length})</summary>
      <ul>
        {#each openQuestions as question (question.id)}
          <li>
            <strong>{question.question}</strong>
            {#if question.requirements.length}
              <ul>{#each question.requirements as requirement (requirement.id)}
                <li><a href={requirement.href}>{requirement.label}</a><span> — {requirement.mode === 'local_review' ? 'local review' : 'source evidence'} · {requirement.state.replaceAll('_', ' ')}</span></li>
              {/each}</ul>
            {:else}<a href={question.href}>Review the conflicting or limited sources</a>{/if}
          </li>
        {/each}
      </ul>
    </details>
  {/if}

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
              {@render factDetail(item)}
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
          <strong>{nextReviews.displayedCount}</strong> priority review{nextReviews.displayedCount === 1 ? '' : 's'}.
          {#if furtherReviews.length}<span>{furtherReviews.length} further review{furtherReviews.length === 1 ? '' : 's'} available below.</span>{/if}
        </p>
        <div
          class="next-actions"
          data-total={nextReviews.total}
          data-displayed-count={nextReviews.displayedCount}
          data-omitted-count={nextReviews.omittedCount}
          data-contributing-fact-ids={nextReviews.contributingFactIds.join(',')}
        >
          {#each nextReviews.displayedItems as nextAction (nextAction.id)}
            {@render reviewAction(nextAction)}
          {/each}
        </div>
        {#if furtherReviews.length}
          <details class="further-reviews" bind:open={allReviewsOpen}>
            <summary>More reviews ({furtherReviews.length})</summary>
            {#if allReviewsOpen}
              <div class="additional-actions">
                {#each furtherReviews as nextAction (nextAction.id)}{@render reviewAction(nextAction)}{/each}
              </div>
            {/if}
          </details>
        {/if}
      {:else}
        <p class="empty">No contextual action is available from the settled evidence. Review source coverage and freshness next.</p>
      {/if}
    </section>
  </div>
</section>

<style>
  .open-questions { margin-block: 16px; border-block: 1px solid var(--border); }
  .open-questions summary { min-height: 44px; padding-block: 12px; cursor: pointer; font-weight: 650; font-size: var(--text-sm); }
  .open-questions ul { display: grid; gap: 12px; padding-inline-start: 20px; font-size: var(--text-sm); }
  .open-questions ul ul { gap: 8px; margin-top: 8px; }
  .open-questions li { min-width: 0; overflow-wrap: anywhere; }
  .open-questions span { color: var(--muted); }
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
  .metric-detail{min-width:0;margin-top:10px;padding:12px 0;border-top:1px solid var(--border-strong)}
  .metric-detail>header>strong{color:var(--text);font:700 var(--text-xs) var(--mono)}
  .metric-detail p{margin:6px 0 0;color:var(--muted);font:var(--text-xs) var(--font-sans);line-height:1.5}
  .metric-items{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:16px 24px;margin:8px 0 0;padding:0;list-style:none}
  .metric-item{min-width:0;padding:10px 0;border-top:1px solid var(--border)}
  .metric-item-link{display:grid;gap:3px;min-width:0;text-decoration:none}
  .metric-item-link strong,.metric-item-link small,.contributor-heading strong,.contributor-heading small{overflow-wrap:anywhere}
  .metric-item-link>strong{font-size:var(--text-xs)}
  .metric-item-link>small{color:var(--muted);font:var(--text-xs) var(--font-sans);line-height:1.5}
  .state-label{color:var(--text);font-weight:700}
  .contributors{display:grid;gap:5px;margin:7px 0 0;padding:7px 0 0;border-top:1px solid var(--border);list-style:none}
  .contributors>li{min-width:0}
  .contributor-heading{display:flex;flex-wrap:wrap;align-items:baseline;gap:3px 7px;min-width:0}
  .contributor-heading strong{color:var(--text);font-size:var(--text-xs)}
  .contributor-heading small{color:var(--muted);font:var(--text-xs) var(--font-sans)}
  .limitation{margin:6px 0 0;padding-left:9px;border-left:1px solid var(--amber);color:var(--muted);font-size:var(--text-xs);line-height:1.5;overflow-wrap:anywhere}
  .limitation strong{color:var(--text);font-weight:600}
  .fact-limitation{margin-top:7px}
  .metric-detail .metric-omitted{overflow-wrap:anywhere}
  .metric-omitted a{white-space:normal}
  .metric-note{grid-column:1/-1;max-width:none;margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45;text-align:right;overflow-wrap:anywhere}
  .glance-grid{grid-template-columns:minmax(0,1fr);gap:18px;margin-top:18px}
  .glance-grid>section{min-width:0;padding:16px 0 0;border-top:1px solid var(--border)}
  h5{margin:0 0 9px;font:700 var(--text-xs) var(--mono)}
  .signals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:0;padding:0;list-style:none}
  .signals li{display:grid;grid-template-columns:8px minmax(0,1fr);gap:8px;min-width:0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .signals li>span{width:7px;height:7px;margin-top:4px;border:2px solid var(--muted);border-radius:50%}
  .signals .tone-danger>span{border-color:var(--danger)}
  .signals .tone-warn>span{border-color:var(--amber)}
  .signals .tone-good>span{border-color:var(--accent2)}
  .signals strong,.signals small{display:block;overflow-wrap:anywhere}
  .signals strong{color:var(--text);font-size:var(--text-xs)}
  .signals small{margin-top:2px;color:var(--muted)}
  .next-action{display:grid;gap:5px;max-width:78ch}
  .next-actions{display:grid}
  .review-action{min-width:0;padding:12px 0;border-top:1px solid var(--border)}
  .review-action:first-child{border-top:0}
  .next-action strong{color:var(--text);font:700 var(--text-xs) var(--mono)}
  .next-action span,.next-action small{color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .next-action small{color:var(--text)}
  .action-counts{margin:0 0 7px;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}.action-counts span{display:block}.action-counts strong{color:var(--text)}
  .action-evidence{margin-top:6px}
  .action-evidence summary,.further-reviews>summary{display:list-item;min-height:44px;align-content:center;width:fit-content;max-width:100%;color:var(--accent);font:600 var(--text-xs) var(--mono);cursor:pointer;overflow-wrap:anywhere}
  .further-reviews{border-top:1px solid var(--border)}
  .action-facts,.source-time,.contextual-note{display:block;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5;overflow-wrap:anywhere}
  .technical-references{display:grid;gap:4px;margin:6px 0 0;padding-left:18px;color:var(--muted);font-size:var(--text-xs);overflow-wrap:anywhere}
  .technical-references code,.action-facts code{font-size:inherit}
  .empty{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  @container(max-width:760px){
    .glance-header{grid-template-columns:minmax(0,1fr)}
    .metric-note{text-align:left}
  }
  @container(max-width:420px){
    .metrics{grid-template-columns:minmax(0,1fr)}
  }
  @media(max-width:520px){
    .signals{grid-template-columns:minmax(0,1fr)}
    .metric-items{grid-template-columns:minmax(0,1fr)}
  }
</style>
