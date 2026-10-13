<script lang="ts">
  import { lookupCollectionReceiptReview } from '../../../../packages/evidence/lookup-collection-review.mts';
  let { receipt }: { receipt: unknown } = $props();
  const review = $derived(lookupCollectionReceiptReview(receipt));
</script>

{#if review}
  <section class="receipt" aria-label="Collection receipt">
    <h5>Original collection choices</h5>
    <p>{review.selection}. These choices were captured when this Lookup was submitted.</p>
    <ul aria-label="Optional source selections">
      {#each review.choices as choice}<li>{choice.label}: {choice.selected ? 'selected' : 'not selected'}</li>{/each}
    </ul>
    <details>
      <summary>Collector execution · {review.sources.length} source families</summary>
      <dl>{#each review.sources as source (source.id)}
        <div><dt>{source.label}</dt><dd>{source.summary}<br />{source.outcome}</dd></div>
      {/each}</dl>
      <p>Starting a collector does not prove a request reached a provider. Source results and their individual limitations remain separate; a completed Lookup does not make every source complete.</p>
    </details>
  </section>
{/if}

<style>
  .receipt{min-width:0;margin:1rem 0;padding:0 0 1rem;border-bottom:1px solid var(--border)}
  h5{margin:0 0 .4rem;font-size:var(--text-sm)}
  p,li,dt,dd{overflow-wrap:anywhere}
  dl{display:grid;gap:.75rem;margin:.75rem 0}
  dt{font-weight:600}dd{margin:.2rem 0 0;color:var(--muted);line-height:1.5}
</style>
