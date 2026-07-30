<script lang="ts">
  import type { EvidenceCoverageLedger } from '$lib/analysis/evidence-coverage-ledger.ts';
  import type { LookupSourceRefreshPlan } from '$lib/analysis/lookup-source-refresh.ts';
  import LookupSourceRefresh from '$lib/components/LookupSourceRefresh.svelte';

  let {
    ledger,
    refreshPlan,
    query,
    depth,
  }: {
    ledger: EvidenceCoverageLedger;
    refreshPlan: LookupSourceRefreshPlan;
    query: string;
    depth: 'deep' | 'fast';
  } = $props();

  function categoryLabel(value: string) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
</script>

{#if ledger.entries.length}
  <section class="coverage card" aria-labelledby="coverage-title">
    <header class="section-head">
      <div>
        <p class="eyebrow">Source health</p>
        <h4 id="coverage-title">Evidence coverage</h4>
        <p>What this lookup collected, what was limited, and where a source did not produce complete evidence.</p>
      </div>
      <div class="coverage-metrics" role="group" aria-label="Evidence coverage summary">
        <span><strong>{ledger.completeCount}</strong> complete</span>
        <span class:attention={ledger.limitedCount > 0}><strong>{ledger.limitedCount}</strong> limited</span>
      </div>
    </header>

    <details>
      <summary>Review {ledger.entries.length} source and analysis states</summary>
      <ul class="coverage-list">
        {#each ledger.entries as entry (entry.id)}
          <li class:limited={entry.manualReviewSuggested}>
            <div class="source-title">
              <span>{categoryLabel(entry.category)}</span>
              <strong>{entry.label}</strong>
            </div>
            <span class={`state state-${entry.state}`}>{entry.statusLabel}</span>
            {#if entry.limitations.length}
              <span class="limitations-label">Limits</span>
              <ul class="limitations">
                {#each entry.limitations as limitation}
                  <li>{limitation}</li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
      <p class="coverage-note">Bullets identify source-specific limitations, not general descriptions, so a complete source may have none. Limited, unavailable, skipped, unsupported, unknown, and not-found states remain distinct. No source is retried automatically from this view.</p>
      <LookupSourceRefresh plan={refreshPlan} {query} {depth} />
    </details>
  </section>
{/if}

<style>
  .coverage{min-width:0;padding:var(--card-pad)}
  .section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
  .section-head h4{margin:0;font-size:var(--text-lg)}
  .section-head p:not(.eyebrow){max-width:680px;margin:5px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .coverage-metrics{display:flex;flex:0 0 auto;gap:7px}
  .coverage-metrics span{padding:7px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--muted);font:var(--text-2xs) var(--mono)}
  .coverage-metrics strong{color:var(--accent);font-size:var(--text-sm)}
  .coverage-metrics .attention strong{color:var(--amber)}
  details{margin-top:12px;border-top:1px solid var(--border)}
  summary{padding:11px 0;color:var(--text);font:680 var(--text-xs) var(--mono);cursor:pointer}
  summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  .coverage-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:0;padding:0;list-style:none}
  .coverage-list>li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px 10px;min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .coverage-list>li.limited{border-color:color-mix(in srgb,var(--amber) 38%,var(--border))}
  .source-title{min-width:0}
  .source-title span,.source-title strong{display:block}
  .source-title span{color:var(--muted);font:var(--text-2xs) var(--mono);text-transform:uppercase}
  .source-title strong{margin-top:2px;overflow-wrap:anywhere;font-size:var(--text-xs)}
  .state{align-self:start;padding:3px 6px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .state-complete{border-color:color-mix(in srgb,var(--accent) 42%,var(--border));color:var(--accent)}
  .state-partial,.state-unavailable,.state-unknown{border-color:color-mix(in srgb,var(--amber) 48%,var(--border));color:var(--amber)}
  .state-not_found,.state-skipped,.state-unsupported{color:var(--muted)}
  .limitations-label{grid-column:1/-1;color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  .limitations{grid-column:1/-1;margin:0;padding-left:17px;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .coverage-note{margin:9px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  @media(max-width:720px){
    .section-head{flex-direction:column}
    .coverage-metrics{width:100%}
    .coverage-metrics span{flex:1}
    .coverage-list{grid-template-columns:minmax(0,1fr)}
  }
</style>
