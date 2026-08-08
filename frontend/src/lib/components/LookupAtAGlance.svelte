<script lang="ts">
  import type {
    LookupDecisionSupport,
    LookupEvidenceQualityMatrix,
  } from '$lib/analysis/lookup-decision-support.ts';
  import { projectLookupNextActions } from '$lib/analysis/lookup-decision-support.ts';
  import type { LookupSummarySignal } from '$lib/analysis/lookup-summary-model.ts';

  let {
    support,
    quality,
    signals,
  }: {
    support: LookupDecisionSupport;
    quality: LookupEvidenceQualityMatrix;
    signals: readonly LookupSummarySignal[];
  } = $props();

  const notableSignals = $derived.by(() => {
    const priority = signals.filter((signal) => signal.tone !== 'neutral');
    return (priority.length ? priority : signals).slice(0, 4);
  });
  const nextActions = $derived(projectLookupNextActions(support.actions, support.guidance.task));
</script>

<section class="at-a-glance card" aria-labelledby="lookup-at-a-glance-title">
  <header>
    <div>
      <p class="eyebrow">Start here</p>
      <h4 id="lookup-at-a-glance-title">At a glance</h4>
      <p>Review the strongest observations and unresolved evidence before opening source detail.</p>
    </div>
    <div class="metrics" role="group" aria-label="Evidence coverage and review cues">
      <span title="Evidence collectors or derived checks that returned a complete usable result."><strong>{quality.completeCount}</strong> evidence check{quality.completeCount === 1 ? '' : 's'} complete</span>
      <span class:attention={quality.limitedCount > 0} title="Evidence collectors or derived checks whose result is partial, unavailable, or unknown."><strong>{quality.limitedCount}</strong> evidence check{quality.limitedCount === 1 ? '' : 's'} limited</span>
      <span class:attention={support.counts.conflicts > 0}><strong>{support.counts.conflicts}</strong> source disagreement{support.counts.conflicts === 1 ? '' : 's'}</span>
      <span class:attention={support.counts.uncertainties > 0}><strong>{support.counts.uncertainties}</strong> unresolved item{support.counts.uncertainties === 1 ? '' : 's'}</span>
      <small class="metric-note">Each evidence check is one collector or derived check. Limited means partial, unavailable, or unknown.</small>
    </div>
  </header>

  <div class="glance-grid">
    <section aria-labelledby="lookup-key-findings-title">
      <h5 id="lookup-key-findings-title">Key observations</h5>
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
      <h5 id="lookup-next-review-title">Recommended next reviews</h5>
      {#if nextActions.length}
        <div class="next-actions">
          {#each nextActions as nextAction (nextAction.id)}
            <a class="next-action" href={nextAction.href}>
              <strong>{nextAction.label}</strong>
              <span>{nextAction.reason}</span>
              <small>{nextAction.expectedOutcome}</small>
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
  .at-a-glance{min-width:0;padding:var(--card-pad)}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
  h4{margin:2px 0 0;font:700 var(--text-lg) var(--mono)}
  header p:not(.eyebrow){max-width:660px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .metrics{display:flex;flex:0 0 auto;flex-wrap:wrap;justify-content:flex-end;gap:6px}
  .metrics span{padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--muted);font:var(--text-2xs) var(--mono)}
  .metrics strong{color:var(--text);font-size:var(--text-sm)}
  .metrics .attention strong{color:var(--amber)}
  .metric-note{flex-basis:100%;max-width:440px;color:var(--muted);font-size:var(--text-2xs);line-height:1.45;text-align:right}
  .glance-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(260px,.9fr);gap:9px;margin-top:14px}
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
  .empty{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  @media(max-width:840px){
    header{display:grid}
    .metrics{justify-content:flex-start}
    .glance-grid{grid-template-columns:minmax(0,1fr)}
  }
  @media(max-width:520px){
    .metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100%}
    .metrics span{min-width:0}
    .metric-note{grid-column:1/-1;max-width:none;text-align:left}
    .signals{grid-template-columns:minmax(0,1fr)}
  }
</style>
