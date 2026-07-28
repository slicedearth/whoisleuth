<script lang="ts">
  import type { ServiceDependencyReview } from '$lib/analysis/service-dependency-review.ts';

  let { review }: { review: ServiceDependencyReview } = $props();
</script>

<details class="dependency-review card">
  <summary>
    <span>Service dependency review</span>
    <span class:attention={review.state === 'review'} class:unavailable={review.state === 'unavailable'}>{review.label}</span>
  </summary>
  <div class="body">
    <p class="intro">Surface observed DNS aliases for a conservative manual dangling-service check. WHOISleuth does not follow targets or test whether a service can be claimed.</p>
    {#if review.dependencies.length}
      <div class="dependency-grid">
        {#each review.dependencies as dependency}
          <article class:attention={dependency.state === 'review'}>
            <header><span>{dependency.recordType}</span><strong>{dependency.relation === 'external' ? 'External' : 'In domain'}</strong></header>
            <code>{dependency.target}</code>
            <p>{dependency.detail}</p>
            <small>{dependency.provenance}</small>
          </article>
        {/each}
      </div>
    {/if}
    <section class="next-steps" aria-labelledby="dependency-next-steps-title">
      <h5 id="dependency-next-steps-title">Manual verification</h5>
      <ol>{#each review.nextSteps as step}<li>{step}</li>{/each}</ol>
    </section>
    <details class="limits">
      <summary>Interpretation limits</summary>
      <ul>{#each review.limitations as limitation}<li>{limitation}</li>{/each}</ul>
    </details>
  </div>
</details>

<style>
  .dependency-review{min-width:0;padding:0}
  .dependency-review>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;cursor:pointer;font:700 var(--text-xs) var(--mono)}
  .dependency-review>summary:focus-visible,.limits>summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  .dependency-review>summary span:last-child{color:var(--muted);font-size:var(--text-2xs);text-align:right}
  .dependency-review>summary span.attention{color:var(--amber)}
  .dependency-review>summary span.unavailable{color:var(--muted)}
  .body{display:grid;gap:11px;padding:0 var(--card-pad) var(--card-pad);border-top:1px solid var(--border)}
  .intro{max-width:820px;margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .dependency-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  article{min-width:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  article.attention{border-color:color-mix(in srgb,var(--amber) 38%,var(--border))}
  article header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
  article header span{font:700 var(--text-2xs) var(--mono)}
  article header strong{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  article.attention header strong{color:var(--amber)}
  article code{display:block;margin-top:7px;color:var(--text);font-size:var(--text-xs);overflow-wrap:anywhere}
  article p{margin:6px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  article small{display:block;margin-top:7px;color:var(--muted);font:var(--text-2xs) var(--mono)}
  .next-steps{padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .next-steps h5{margin:0;font:700 var(--text-xs) var(--mono)}
  .next-steps ol,.limits ul{margin:8px 0 0;padding-left:20px;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .limits>summary{color:var(--muted);font:650 var(--text-2xs) var(--mono);cursor:pointer}
  @media(max-width:760px){
    .dependency-review>summary{align-items:flex-start}
    .dependency-review>summary span:last-child{max-width:48%}
    .dependency-grid{grid-template-columns:minmax(0,1fr)}
  }
</style>
