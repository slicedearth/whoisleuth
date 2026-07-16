<script lang="ts">
  type ComparisonItem = {
    label: string;
    method: string;
    outcome: string;
    detail: string;
    status: string;
    sharedValues: string[];
  };

  let {
    comparison,
    unavailable,
  }: {
    comparison: {
      partial: boolean;
      referenceDomain: string;
      referenceObservedAt: string;
      referenceObservedLabel: string;
      components: ComparisonItem[];
    } | null;
    unavailable: boolean;
  } = $props();
</script>

{#if comparison}
  <section class="page-comparison evidence-card card" aria-labelledby="page-comparison-title">
    <header class="section-head">
      <div><p class="eyebrow">Active Brand Profile</p><h4 id="page-comparison-title">Official-site comparison</h4></div>
      <span class:partial={comparison.partial}>{comparison.partial ? 'Partial evidence' : 'Comparable captures'}</span>
    </header>
    <p class="comparison-context">Comparing this capture with the bounded baseline for <strong>{comparison.referenceDomain}</strong>, observed <time datetime={comparison.referenceObservedAt}>{comparison.referenceObservedLabel}</time>.</p>
    <div class="page-comparison-grid">
      {#each comparison.components as item}
        <article class={`comparison-${item.status}`}>
          <div><small>{item.label}</small><span>{item.method}</span></div>
          <strong>{item.outcome}</strong>
          <p>{item.detail}</p>
          {#if item.sharedValues.length}<p class="shared-values">Shared: {item.sharedValues.join(', ')}</p>{/if}
        </article>
      {/each}
    </div>
    <p class="callout warn page-comparison-note">Each component stands on its own. WHOISleuth does not combine these observations into a page-similarity score or use them to change the Risk score. Matches can arise from shared templates, providers, libraries, or analytics, and do not prove common ownership, copying, intent, or maliciousness.</p>
  </section>
{:else if unavailable}
  <section class="page-comparison unavailable-comparison evidence-card card" aria-labelledby="page-comparison-title">
    <header class="section-head"><div><p class="eyebrow">Active Brand Profile</p><h4 id="page-comparison-title">Official-site comparison</h4></div><span class="partial">Unavailable</span></header>
    <p class="card-note">No current compatible page fingerprint was captured, so the saved official-site baseline cannot be compared with this result. This does not indicate that the pages differ.</p>
  </section>
{/if}

<style>
  .evidence-card{padding:var(--card-pad)}
  .card-note{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .comparison-context{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .comparison-context strong{color:var(--text)}
  .page-comparison-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;margin-top:13px}
  .page-comparison-grid article{min-width:0;padding:11px 12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .page-comparison-grid article.comparison-same{border-color:rgba(126,224,168,.3)}
  .page-comparison-grid article.comparison-overlap{border-color:rgba(242,184,75,.35)}
  .page-comparison-grid article>div{display:flex;align-items:start;justify-content:space-between;gap:8px}
  .page-comparison-grid small{color:var(--muted);font:600 var(--text-2xs) var(--mono);text-transform:uppercase;letter-spacing:.05em}
  .page-comparison-grid article>div>span{color:var(--muted);font-size:var(--text-2xs);text-align:right}
  .page-comparison-grid strong{display:block;margin-top:7px;font-size:var(--text-sm);overflow-wrap:anywhere}
  .page-comparison-grid .comparison-same strong{color:var(--accent2)}
  .page-comparison-grid .comparison-overlap strong{color:var(--amber)}
  .page-comparison-grid p{margin:5px 0 0;color:var(--muted);font-size:var(--text-xs);overflow-wrap:anywhere}
  .page-comparison-grid .shared-values{color:var(--text)}
</style>
