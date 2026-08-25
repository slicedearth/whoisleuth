<script lang="ts">
  import { untrack } from 'svelte';
  import type { DecisionFact } from '../../../../packages/evidence/decision-fact.mts';
  import { buildLookupEvidenceQualityModel } from '$lib/analysis/lookup-evidence-quality-model.ts';
  import type { LookupEvidenceQualityMatrix } from '$lib/analysis/lookup-decision-support.ts';
  import { formatCollectionDuration } from '$lib/analysis/lookup-display-shared.ts';
  import type { LookupTiming } from '$lib/analysis/lookup-response.ts';
  import type { LookupFreshnessThresholds, LookupSourceRefreshPlan } from '$lib/analysis/lookup-source-refresh.ts';
  import LookupCollectionTiming from '$lib/components/LookupCollectionTiming.svelte';
  import LookupSourceRefresh from '$lib/components/LookupSourceRefresh.svelte';

  let {
    matrix,
    lookupDecisionFacts,
    refreshPlan,
    query,
    depth,
    timing,
    onpolicychange,
  }: {
    matrix: LookupEvidenceQualityMatrix;
    lookupDecisionFacts: readonly DecisionFact[];
    refreshPlan: LookupSourceRefreshPlan;
    query: string;
    depth: 'deep' | 'fast';
    timing: LookupTiming | null;
    onpolicychange: (value: { mode: 'task-default' | 'analyst-custom'; thresholdsDays: LookupFreshnessThresholds }) => void;
  } = $props();

  const model = $derived(buildLookupEvidenceQualityModel({
    matrix,
    facts: lookupDecisionFacts,
  }));

  const initialFreshnessPolicy = untrack(() => refreshPlan.freshnessPolicy);
  let policyMode = $state<'task-default' | 'analyst-custom'>(initialFreshnessPolicy.id === 'analyst-custom' ? 'analyst-custom' : 'task-default');
  let registrationDays = $state(initialFreshnessPolicy.thresholdsDays.registration);
  let networkDays = $state(initialFreshnessPolicy.thresholdsDays.network);
  let webDays = $state(initialFreshnessPolicy.thresholdsDays.web);

  function boundedDays(value: number, fallback: number): number {
    return Number.isFinite(value) ? Math.max(1, Math.min(365, Math.round(value))) : fallback;
  }
  function updatePolicy() {
    onpolicychange({
      mode: policyMode,
      thresholdsDays: {
        registration: boundedDays(registrationDays, refreshPlan.freshnessPolicy.thresholdsDays.registration),
        network: boundedDays(networkDays, refreshPlan.freshnessPolicy.thresholdsDays.network),
        web: boundedDays(webDays, refreshPlan.freshnessPolicy.thresholdsDays.web),
      },
    });
  }
  function selectPolicy(event: Event) {
    policyMode = (event.currentTarget as HTMLSelectElement).value === 'analyst-custom' ? 'analyst-custom' : 'task-default';
    if (policyMode === 'analyst-custom') {
      registrationDays = refreshPlan.freshnessPolicy.thresholdsDays.registration;
      networkDays = refreshPlan.freshnessPolicy.thresholdsDays.network;
      webDays = refreshPlan.freshnessPolicy.thresholdsDays.web;
    }
    updatePolicy();
  }

  function observed(value: string | null): string {
    if (!value) return 'Observation time unavailable';
    return new Date(value).toLocaleString();
  }
</script>

{#if model.entries.length}
  <section class="quality card" id="evidence-quality" aria-label="Evidence coverage">
    <header>
      <div>
        <p class="eyebrow">Evidence reliability</p>
        <h4 id="evidence-quality-title">Source quality and freshness</h4>
        <p>Review endpoint class, source state, age, truncation, request timing, limitations, and downstream uses before relying on a conclusion.</p>
      </div>
      <div class="metrics" role="group" aria-label="Evidence coverage summary">
        <span data-summary="complete"><strong>{model.completeCount}</strong> complete</span>
        <span data-summary="limited" class:attention={model.limitedCount > 0}><strong>{model.limitedCount}</strong> limited</span>
        {#if model.totalMs !== null}<span><strong>{formatCollectionDuration(model.totalMs)}</strong> total</span>{/if}
      </div>
    </header>

    <details class="records-disclosure">
      <summary>Review {model.entries.length} source and analysis records</summary>
      <div
        class="matrix"
        role="table"
        aria-label="Source quality and freshness"
        aria-colcount="5"
        data-displayed-row-count={model.displayedRowCount}
        data-canonical-fact-count={model.canonicalCoverageFactCount}
      >
        <div class="matrix-head" role="row">
          <span role="columnheader">Source</span>
          <span role="columnheader">State</span>
          <span role="columnheader">Observed</span>
          <span role="columnheader">Timing</span>
          <span role="columnheader">Supports</span>
        </div>
        {#each model.entries as entry (entry.id)}
          <div
            class="quality-record"
            class:limited={entry.countsAsLimited}
            role="rowgroup"
            data-evidence-id={entry.id}
            data-fact-id={entry.factId}
            data-counts-as-complete={String(entry.countsAsComplete)}
            data-counts-as-limited={String(entry.countsAsLimited)}
          >
          <div class="quality-row" role="row">
            <div class="source" role="cell">
              <small>{entry.category}</small>
              <strong>{entry.label}</strong>
              <span class="endpoint">{entry.endpointClass}</span>
              <span class="description">{entry.description}</span>
              {#if entry.refreshAvailable}<span class="refresh">Refresh available</span>{/if}
            </div>
            <div role="cell">
              <span
                class="state tone-{entry.statePresentation.tone}"
                data-evidence-state={entry.evidenceState}
                data-tone={entry.statePresentation.tone}
                aria-label={`${entry.statePresentation.label}. ${entry.statePresentation.assistiveText}`}
              >
                <span class="presentation-icon" data-icon={entry.statePresentation.icon} aria-hidden="true"></span>
                <span>{entry.statePresentation.label}</span>
              </span>
              <ul class="contributors" aria-label={`Canonical contributors for ${entry.label}`}>
                {#each entry.contributors as contributor (contributor.id)}
                  <li
                    data-contributor-id={contributor.id}
                    data-provenance={contributor.provenance}
                    aria-label={`${contributor.label}. ${contributor.provenancePresentation.label}. ${contributor.provenancePresentation.assistiveText}`}
                  >
                    <span class="presentation-icon" data-icon={contributor.provenancePresentation.icon} aria-hidden="true"></span>
                    <span><strong>{contributor.label}</strong><small>{contributor.provenancePresentation.label}</small></span>
                  </li>
                {/each}
              </ul>
              {#if entry.truncated}<span class="truncated">Truncated</span>{/if}
            </div>
            <div class="observed" role="cell">
              <span>{observed(entry.observedAt)}</span>
              {#if entry.ageDays !== null}<small>{entry.ageDays} day{entry.ageDays === 1 ? '' : 's'} old</small>{/if}
              <span
                class="freshness tone-{entry.freshnessPresentation.tone}"
                data-freshness={entry.freshness}
                data-tone={entry.freshnessPresentation.tone}
                aria-label={`${entry.freshnessPresentation.label}. ${entry.freshnessPresentation.assistiveText}`}
              >
                <span class="presentation-icon" data-icon={entry.freshnessPresentation.icon} aria-hidden="true"></span>
                <span>{entry.freshnessPresentation.label}</span>
              </span>
            </div>
            <div class="timing" role="cell">
              <span class:rejected={entry.timingOutcome === 'rejected'}>{formatCollectionDuration(entry.durationMs)}</span>
              {#if entry.timingOutcome}<small>{entry.timingOutcome === 'rejected' ? 'Request error' : 'Settled branch'}</small>{/if}
            </div>
            <div class="supports" role="cell">
              {entry.supports.length ? entry.supports.join(', ') : 'Source-specific evidence'}
            </div>
          </div>
          {#if entry.limitationCount > 0}
            <div class="limitations-row" role="row">
              <div class="limitations" role="cell" aria-colspan="5" aria-label={`Limitations for ${entry.label}`}>
                <strong>Limitations</strong>
                <div class="limitation-groups">
                  {#each entry.contributors.filter((contributor) => contributor.limitations.length > 0) as contributor (contributor.id)}
                    <section aria-label={`Limitations from ${contributor.label}`}>
                      <h5>{contributor.label}</h5>
                      <ul>{#each contributor.limitations as limitation}<li>{limitation}</li>{/each}</ul>
                    </section>
                  {/each}
                  {#if entry.unattributedLimitations.length}
                    <section aria-label={`Fact limitations for ${entry.label}`}>
                      <h5>Canonical fact</h5>
                      <ul>{#each entry.unattributedLimitations as limitation}<li>{limitation}</li>{/each}</ul>
                    </section>
                  {/if}
                </div>
              </div>
            </div>
          {/if}
          </div>
        {/each}
      </div>
      <p class="note">Source branches may overlap, so their durations do not add up to total request time. Missing, failed, stale, unsupported, and not-found evidence remains distinct and is never treated as proof of absence or safety.</p>
      <details class="freshness-policy">
        <summary>Freshness policy · {refreshPlan.freshnessPolicy.id === 'analyst-custom' ? 'analyst-defined' : `${refreshPlan.freshnessPolicy.task} task default`}</summary>
        <div class="policy-form">
          <label>Policy<select value={policyMode} onchange={selectPolicy}><option value="task-default">Task default</option><option value="analyst-custom">Analyst-defined</option></select></label>
          {#if policyMode === 'analyst-custom'}
            <label>Registration days<input type="number" min="1" max="365" bind:value={registrationDays} onchange={updatePolicy}></label>
            <label>Network days<input type="number" min="1" max="365" bind:value={networkDays} onchange={updatePolicy}></label>
            <label>Web days<input type="number" min="1" max="365" bind:value={webDays} onchange={updatePolicy}></label>
          {:else}
            <p>Registration {refreshPlan.freshnessPolicy.thresholdsDays.registration} days · network {refreshPlan.freshnessPolicy.thresholdsDays.network} days · web {refreshPlan.freshnessPolicy.thresholdsDays.web} days.</p>
          {/if}
        </div>
        <p class="note">Thresholds organise source-refresh suggestions for results in this open Lookup page. They are not retained in browser-local storage. A deliberately downloaded investigation brief records the policy used. Thresholds do not make older evidence false or newer evidence complete.</p>
      </details>
      <LookupSourceRefresh plan={refreshPlan} {query} {depth} />
    </details>

    {#if timing}
      <details class="timing-detail">
        <summary>Request diagnostics</summary>
        <LookupCollectionTiming {timing} embedded />
      </details>
    {/if}
  </section>
{/if}

<style>
  .quality{min-width:0;padding:var(--card-pad);scroll-margin-top:calc(var(--local-nav-anchor-offset, 72px) + 12px)}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
  header h4{margin:2px 0 0;font:700 var(--text-lg) var(--mono)}
  header p:not(.eyebrow){max-width:720px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .metrics{display:flex;flex:0 0 auto;gap:7px;flex-wrap:wrap;justify-content:flex-end}
  .metrics span{padding:7px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--muted);font:var(--text-2xs) var(--mono)}
  .metrics strong{color:var(--text);font-size:var(--text-sm)}
  .metrics .attention strong{color:var(--amber)}
  details{margin-top:12px;border-top:1px solid var(--border)}
  summary{padding:12px 0;color:var(--text);font:680 var(--text-xs) var(--mono);cursor:pointer}
  summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  .matrix{display:grid;gap:7px}
  .matrix-head,.quality-row{display:grid;grid-template-columns:minmax(150px,1.25fr) minmax(92px,.65fr) minmax(155px,1fr) minmax(120px,.8fr) minmax(180px,1.25fr);gap:9px;align-items:start}
  .matrix-head{padding:0 10px;color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  .quality-record{min-width:0;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);overflow:hidden}
  .quality-row{min-width:0;padding:10px}
  .quality-record.limited{border-color:color-mix(in srgb,var(--amber) 38%,var(--border))}
  .source,.observed,.timing{display:grid;gap:2px;min-width:0}
  .source small,.observed small,.timing small{color:var(--muted);font:var(--text-2xs) var(--mono)}
  .source small{text-transform:uppercase}
  .source strong{overflow-wrap:anywhere;font-size:var(--text-xs)}
  .endpoint{color:var(--muted);font:650 var(--text-2xs) var(--mono);line-height:1.4;overflow-wrap:anywhere}
  .description{margin-top:3px;color:var(--muted);font-size:var(--text-2xs);line-height:1.45;overflow-wrap:anywhere}
  .refresh{width:max-content;margin-top:3px;color:var(--accent);font:650 var(--text-2xs) var(--mono)}
  .state,.freshness{display:inline-flex;width:max-content;max-width:100%;align-items:center;gap:5px;padding:3px 6px;border:1px solid var(--border-strong);border-radius:999px;color:var(--text);font:650 var(--text-2xs) var(--mono);overflow-wrap:anywhere}
  .state.tone-neutral,.freshness.tone-neutral{border-color:var(--border-strong);color:var(--text)}
  .state.tone-caution,.freshness.tone-caution{border-color:var(--amber);border-style:dashed;color:var(--amber)}
  .state.tone-conflict,.freshness.tone-conflict{border-color:var(--danger);border-style:dashed;color:var(--danger)}
  .presentation-icon{display:grid;flex:0 0 auto;width:14px;height:14px;place-items:center;border:1px solid currentColor;border-radius:50%;font:700 9px/1 var(--mono)}
  .presentation-icon::before{content:'•'}
  .presentation-icon[data-icon='evidence-observed']::before,.presentation-icon[data-icon='observation-current']::before{content:'●';font-size:6px}
  .presentation-icon[data-icon='bounded-non-observation']::before{content:'○'}
  .presentation-icon[data-icon='collection-not-run']::before,.presentation-icon[data-icon='state-not-applicable']::before{content:'−'}
  .presentation-icon[data-icon='evidence-limited']::before{content:'◐'}
  .presentation-icon[data-icon='source-unsupported']::before{content:'×'}
  .presentation-icon[data-icon='source-unavailable']::before,.presentation-icon[data-icon='observation-stale']::before{content:'!'}
  .presentation-icon[data-icon='state-unknown']::before{content:'?'}
  .presentation-icon[data-icon='evidence-direct']::before{content:'D'}
  .presentation-icon[data-icon='evidence-reported']::before{content:'P'}
  .presentation-icon[data-icon='evidence-analyst-supplied']::before{content:'A'}
  .presentation-icon[data-icon='evidence-derived']::before{content:'ƒ'}
  .contributors{display:grid;gap:4px;margin:7px 0 0;padding:0;list-style:none}
  .contributors li{display:grid;grid-template-columns:14px minmax(0,1fr);align-items:start;gap:5px;min-width:0;color:var(--muted)}
  .contributors li>span:last-child{display:grid;gap:1px;min-width:0}
  .contributors strong,.contributors small{overflow-wrap:anywhere}
  .contributors strong{color:var(--text);font-size:var(--text-2xs)}
  .contributors small{color:var(--muted);font:var(--text-2xs) var(--font-sans)}
  .contributors .presentation-icon{margin-top:1px}
  .truncated{display:block;width:max-content;margin-top:5px;color:var(--amber);font:650 var(--text-2xs) var(--mono)}
  .observed>span:first-child,.timing span,.supports{color:var(--text);font-size:var(--text-2xs);line-height:1.45;overflow-wrap:anywhere}
  .observed .freshness{margin-top:4px}
  .observed .freshness.tone-caution{color:var(--amber)}
  .timing span.rejected{color:var(--danger)}
  .limitations{padding:8px 10px;border-top:1px solid var(--border);color:var(--muted);font-size:var(--text-2xs)}
  .limitations strong{font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  .limitation-groups{display:grid;gap:7px;margin-top:5px}
  .limitation-groups section{min-width:0}
  .limitation-groups h5{margin:0;color:var(--text);font:650 var(--text-2xs) var(--mono);overflow-wrap:anywhere}
  .limitations ul{margin:3px 0 0;padding-left:17px;line-height:1.45}
  .note{margin:9px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .freshness-policy{margin-top:9px;border-top:0}
  .freshness-policy>summary{padding:9px 0}
  .policy-form{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .policy-form label{display:grid;gap:4px;color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .policy-form p{grid-column:2/-1;align-self:center;margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  @media(max-width:920px){
    .matrix-head{display:none}
    .quality-row{grid-template-columns:repeat(2,minmax(0,1fr))}
    .supports{grid-column:1/-1}
  }
  @media(max-width:720px){
    header{display:grid}
    .metrics{width:100%;justify-content:flex-start}
    .metrics span{flex:1}
  }
  @media(max-width:480px){
    .quality-row{grid-template-columns:minmax(0,1fr)}
    .supports{grid-column:1}
    .policy-form{grid-template-columns:minmax(0,1fr)}
    .policy-form p{grid-column:1}
  }
</style>
