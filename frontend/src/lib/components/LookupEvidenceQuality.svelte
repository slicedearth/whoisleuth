<script lang="ts">
  import { untrack } from 'svelte';
  import type { LookupEvidenceQualityMatrix } from '$lib/analysis/lookup-decision-support.ts';
  import { formatCollectionDuration } from '$lib/analysis/lookup-display-shared.ts';
  import type { LookupTiming } from '$lib/analysis/lookup-response.ts';
  import type { LookupFreshnessThresholds, LookupSourceRefreshPlan } from '$lib/analysis/lookup-source-refresh.ts';
  import LookupCollectionTiming from '$lib/components/LookupCollectionTiming.svelte';
  import LookupSourceRefresh from '$lib/components/LookupSourceRefresh.svelte';

  let {
    matrix,
    refreshPlan,
    query,
    depth,
    timing,
    onpolicychange,
  }: {
    matrix: LookupEvidenceQualityMatrix;
    refreshPlan: LookupSourceRefreshPlan;
    query: string;
    depth: 'deep' | 'fast';
    timing: LookupTiming | null;
    onpolicychange: (value: { mode: 'task-default' | 'analyst-custom'; thresholdsDays: LookupFreshnessThresholds }) => void;
  } = $props();

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

{#if matrix.entries.length}
  <section class="quality card" id="evidence-quality" aria-label="Evidence coverage">
    <header>
      <div>
        <p class="eyebrow">Evidence reliability</p>
        <h4 id="evidence-quality-title">Source quality and freshness</h4>
        <p>Review endpoint class, source state, age, truncation, request timing, limitations, and downstream uses before relying on a conclusion.</p>
      </div>
      <div class="metrics" role="group" aria-label="Evidence coverage summary">
        <span><strong>{matrix.completeCount}</strong> complete</span>
        <span class:attention={matrix.limitedCount > 0}><strong>{matrix.limitedCount}</strong> limited</span>
        {#if matrix.totalMs !== null}<span><strong>{formatCollectionDuration(matrix.totalMs)}</strong> total</span>{/if}
      </div>
    </header>

    <details>
      <summary>Review {matrix.entries.length} source and analysis records</summary>
      <div class="matrix" role="table" aria-label="Source quality and freshness" aria-colcount="5">
        <div class="matrix-head" role="row">
          <span role="columnheader">Source</span>
          <span role="columnheader">State</span>
          <span role="columnheader">Observed</span>
          <span role="columnheader">Timing</span>
          <span role="columnheader">Supports</span>
        </div>
        {#each matrix.entries as entry (entry.id)}
          <div class="quality-record" class:limited={entry.state === 'partial' || entry.state === 'unavailable' || entry.state === 'unknown'} role="rowgroup">
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
                class="state state-{entry.state}"
                class:registration-source={['rdap', 'whois', 'availability', 'registrar-rdap'].includes(entry.id)}
              >{entry.statusLabel}</span>
              {#if entry.truncated}<span class="truncated">Truncated</span>{/if}
            </div>
            <div class="observed" role="cell">
              <span>{observed(entry.observedAt)}</span>
              {#if entry.ageDays !== null}<small>{entry.ageDays} day{entry.ageDays === 1 ? '' : 's'} old</small>{/if}
            </div>
            <div class="timing" role="cell">
              <span class:rejected={entry.timingOutcome === 'rejected'}>{formatCollectionDuration(entry.durationMs)}</span>
              {#if entry.timingOutcome}<small>{entry.timingOutcome === 'rejected' ? 'Request error' : 'Settled branch'}</small>{/if}
            </div>
            <div class="supports" role="cell">
              {entry.supports.length ? entry.supports.join(', ') : 'Source-specific evidence'}
            </div>
          </div>
          {#if entry.limitations.length}
            <div class="limitations-row" role="row">
              <div class="limitations" role="cell" aria-colspan="5" aria-label={`Limitations for ${entry.label}`}>
                <strong>Limitations</strong>
                <ul>{#each entry.limitations as limitation}<li>{limitation}</li>{/each}</ul>
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
        <summary>
          <span class="timing-copy">
            <span>Request diagnostics</span>
            <small>Inspect overlapping source branches and their settlement timing</small>
          </span>
          <span class="summary-arrow" aria-hidden="true">›</span>
        </summary>
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
  .timing-detail summary{display:flex;align-items:center;justify-content:space-between;gap:12px;list-style:none}
  .timing-detail summary::-webkit-details-marker{display:none}
  .timing-copy{display:flex;align-items:baseline;justify-content:space-between;gap:12px;min-width:0;width:100%}
  .timing-detail summary small{color:var(--muted);font:500 var(--text-2xs) var(--font-sans);text-align:right}
  .summary-arrow{display:grid;width:24px;height:24px;flex:0 0 24px;place-items:center;border:1px solid var(--border);border-radius:50%;color:var(--text);font:700 1rem/1 var(--mono);transition:transform .16s ease}
  .timing-detail[open] .summary-arrow{transform:rotate(90deg)}
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
  .state{display:inline-flex;width:max-content;max-width:100%;padding:3px 6px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .state-complete{border-color:color-mix(in srgb,var(--accent) 42%,var(--border));color:var(--accent)}
  .state-complete.registration-source{border-color:var(--border-strong);color:var(--text)}
  .state-partial,.state-unavailable,.state-unknown{border-color:color-mix(in srgb,var(--amber) 48%,var(--border));color:var(--amber)}
  .truncated{display:block;width:max-content;margin-top:5px;color:var(--amber);font:650 var(--text-2xs) var(--mono)}
  .observed span,.timing span,.supports{color:var(--text);font-size:var(--text-2xs);line-height:1.45;overflow-wrap:anywhere}
  .timing span.rejected{color:var(--danger)}
  .limitations{padding:8px 10px;border-top:1px solid var(--border);color:var(--muted);font-size:var(--text-2xs)}
  .limitations strong{font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  .limitations ul{margin:5px 0 0;padding-left:17px;line-height:1.45}
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
    .timing-copy{display:grid;gap:3px}
    .timing-detail summary small{text-align:left}
  }
  @media(max-width:480px){
    .quality-row{grid-template-columns:minmax(0,1fr)}
    .supports{grid-column:1}
    .policy-form{grid-template-columns:minmax(0,1fr)}
    .policy-form p{grid-column:1}
  }
  @media(prefers-reduced-motion:reduce){.summary-arrow{transition:none}}
</style>
