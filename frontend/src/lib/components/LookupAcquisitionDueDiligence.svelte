<script lang="ts">
  import type {
    AcquisitionDueDiligence,
    AcquisitionReviewState,
  } from '$lib/analysis/acquisition-due-diligence.ts';

  let { review }: { review: AcquisitionDueDiligence } = $props();

  function stateLabel(state: AcquisitionReviewState): string {
    return {
      authoritative: 'Authority observed',
      observed: 'Observed',
      review: 'Review',
      unavailable: 'Unavailable',
    }[state];
  }
</script>

<details class="acquisition card">
  <summary>
    <span>Acquisition due diligence</span>
    <span class:attention={review.items.some((item) => item.state === 'review' || item.state === 'unavailable')}>
      {review.label}
    </span>
  </summary>
  <div class="body">
    <p class="intro">Organize existing registration, lifecycle, service, and contact evidence before a manual acquisition decision. No additional lookup or valuation is performed.</p>
    <div class="review-grid">
      {#each review.items as item}
        <article class:attention={item.state === 'review'} class:unavailable={item.state === 'unavailable'}>
          <header><span>{item.label}</span><strong>{stateLabel(item.state)}</strong></header>
          <p>{item.detail}</p>
          <small>{item.provenance}</small>
        </article>
      {/each}
    </div>
    <section class="transition-section" aria-labelledby="acquisition-transition-title">
      <h5 id="acquisition-transition-title">Transition dependency map</h5>
      <p>Plan continuity from the services observed in this capture. Unavailable evidence remains an open question.</p>
      <div class="review-grid">
        {#each review.transitionDependencies as item}
          <article class:attention={item.state === 'review'} class:unavailable={item.state === 'unavailable'}>
            <header><span>{item.label}</span><strong>{stateLabel(item.state)}</strong></header>
            <p>{item.detail}</p>
            <small>{item.provenance}</small>
          </article>
        {/each}
      </div>
    </section>
    <section class="transition-section" aria-labelledby="acquisition-policy-title">
      <h5 id="acquisition-policy-title">Registry and registrar policy checks</h5>
      <p>These are manual confirmation prompts, not policy claims derived by WHOISleuth.</p>
      <div class="review-grid">
        {#each review.policyChecks as item}
          <article class:attention={item.state === 'review'} class:unavailable={item.state === 'unavailable'}>
            <header><span>{item.label}</span><strong>{stateLabel(item.state)}</strong></header>
            <p>{item.detail}</p>
            <small>{item.provenance}</small>
          </article>
        {/each}
      </div>
    </section>
    <section class="next-steps" aria-labelledby="acquisition-next-steps-title">
      <h5 id="acquisition-next-steps-title">Manual decision checklist</h5>
      <ol>{#each review.nextSteps as step}<li>{step}</li>{/each}</ol>
    </section>
    <details class="limits">
      <summary>Interpretation limits</summary>
      <ul>{#each review.limitations as limitation}<li>{limitation}</li>{/each}</ul>
    </details>
  </div>
</details>

<style>
  .acquisition{min-width:0;padding:0}
  .acquisition>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;cursor:pointer;font:700 var(--text-xs) var(--mono)}
  .acquisition>summary:focus-visible,.limits>summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  .acquisition>summary span:last-child{color:var(--muted);font-size:var(--text-2xs);text-align:right}
  .acquisition>summary span.attention{color:var(--amber)}
  .body{display:grid;gap:11px;padding:0 var(--card-pad) var(--card-pad);border-top:1px solid var(--border)}
  .intro{max-width:820px;margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .review-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  article{min-width:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  article.attention{border-color:color-mix(in srgb,var(--amber) 38%,var(--border))}
  article.unavailable{border-style:dashed}
  article header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
  article header span{font-weight:700;font-size:var(--text-xs)}
  article header strong{flex:0 0 auto;color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  article.attention header strong{color:var(--amber)}
  article p{margin:6px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  article small{display:block;margin-top:7px;color:var(--muted);font:var(--text-2xs) var(--mono)}
  .next-steps{padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .next-steps h5,.transition-section h5{margin:0;font:700 var(--text-xs) var(--mono)}
  .next-steps ol,.limits ul{margin:8px 0 0;padding-left:20px;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .transition-section{display:grid;gap:8px;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .transition-section>p{margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .limits>summary{color:var(--muted);font:650 var(--text-2xs) var(--mono);cursor:pointer}
  @media(max-width:760px){
    .acquisition>summary{align-items:flex-start}
    .acquisition>summary span:last-child{max-width:48%}
    .review-grid{grid-template-columns:minmax(0,1fr)}
  }
</style>
