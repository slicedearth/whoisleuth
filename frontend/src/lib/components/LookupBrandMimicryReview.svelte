<script lang="ts">
  import type {
    BrandMimicryReview,
    BrandMimicryReviewState,
  } from '$lib/analysis/brand-mimicry-review.ts';

  let { review }: { review: BrandMimicryReview } = $props();

  function stateLabel(state: BrandMimicryReviewState): string {
    return {
      relationship: 'Relationship',
      context: 'Context',
      unavailable: 'Unavailable',
    }[state];
  }
</script>

<details class="mimicry-review card">
  <summary>
    <span>Brand mimicry review</span>
    <span class:attention={review.items.some((item) => item.state === 'relationship')}>
      {review.label}{review.partial ? ' · partial' : ''}
    </span>
  </summary>
  <div class="body">
    <p class="intro">Review official-site relationships and page context as separate observations. No aggregate mimicry or maliciousness score is produced.</p>
    <div class="cue-grid">
      {#each review.items as item}
        <article class:relationship={item.state === 'relationship'} class:unavailable={item.state === 'unavailable'}>
          <header><span>{item.label}</span><strong>{stateLabel(item.state)}</strong></header>
          <p>{item.detail}</p>
          {#if item.sharedValues.length}<p class="shared-values">Shared: {item.sharedValues.join(', ')}</p>{/if}
          <small>{item.provenance}</small>
        </article>
      {/each}
    </div>
    <details class="limits">
      <summary>Interpretation limits</summary>
      <ul>{#each review.limitations as limitation}<li>{limitation}</li>{/each}</ul>
    </details>
  </div>
</details>

<style>
  .mimicry-review{min-width:0;padding:0}
  .mimicry-review>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;cursor:pointer;font:700 var(--text-xs) var(--mono)}
  .mimicry-review>summary:focus-visible,.limits>summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  .mimicry-review>summary span:last-child{color:var(--muted);font-size:var(--text-2xs);text-align:right}
  .mimicry-review>summary span.attention{color:var(--amber)}
  .body{display:grid;gap:11px;padding:0 var(--card-pad) var(--card-pad);border-top:1px solid var(--border)}
  .intro{max-width:820px;margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .cue-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  article{min-width:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  article.relationship{border-color:color-mix(in srgb,var(--amber) 38%,var(--border))}
  article.unavailable{border-style:dashed}
  article header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
  article header span{font-weight:700;font-size:var(--text-xs)}
  article header strong{flex:0 0 auto;color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  article.relationship header strong{color:var(--amber)}
  article p{margin:6px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45;overflow-wrap:anywhere}
  article .shared-values{color:var(--text)}
  article small{display:block;margin-top:7px;color:var(--muted);font:var(--text-2xs) var(--mono)}
  .limits>summary{color:var(--muted);font:650 var(--text-2xs) var(--mono);cursor:pointer}
  .limits ul{margin:8px 0 0;padding-left:20px;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  @media(max-width:760px){
    .mimicry-review>summary{align-items:flex-start}
    .mimicry-review>summary span:last-child{max-width:48%}
    .cue-grid{grid-template-columns:minmax(0,1fr)}
  }
</style>
