<script lang="ts">
  import type { BulkDomainComparison } from '$lib/analysis/bulk-domain-comparison.ts';

  let {
    comparison,
    exportComparison,
  }: {
    comparison: BulkDomainComparison | null;
    exportComparison: () => void | Promise<void>;
  } = $props();

  function category(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
</script>

{#if comparison}
  <section class="comparison card" aria-labelledby="domain-comparison-title">
    <header>
      <div>
        <p class="eyebrow">Settled evidence</p>
        <h2 id="domain-comparison-title">Two-domain comparison</h2>
        <p>{comparison.leftDomain} and {comparison.rightDomain} are compared field by field. Missing evidence remains different from an observed difference.</p>
      </div>
      <button class="btn" type="button" onclick={exportComparison}>Export comparison</button>
    </header>
    <div class="comparison-summary" aria-label="Comparison summary">
      <span><strong>{comparison.counts.equal}</strong> equal</span>
      <span><strong>{comparison.counts.different}</strong> different</span>
      <span><strong>{comparison.counts.missing}</strong> one-sided</span>
      <span><strong>{comparison.counts.unavailable}</strong> unavailable</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Evidence</th><th>{comparison.leftDomain}</th><th>{comparison.rightDomain}</th><th>Assessment</th></tr></thead>
        <tbody>
          {#each comparison.rows as row (row.id)}
            <tr class:different={row.state === 'different'}>
              <th scope="row"><span>{category(row.category)}</span><strong>{row.label}</strong><small>{row.method}</small></th>
              <td data-label={comparison.leftDomain}>{row.left}</td>
              <td data-label={comparison.rightDomain}>{row.right}</td>
              <td data-label="Assessment">
                <span class={`chip state-${row.state}`}>{row.state}</span>
                {#each row.limitations as limitation}<small>{limitation}</small>{/each}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <ul class="limitations">{#each comparison.limitations as limitation}<li>{limitation}</li>{/each}</ul>
  </section>
{/if}

<style>
  .comparison{margin-top:16px;padding:var(--card-pad)}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
  h2,p{margin:0}h2{margin-top:4px;font:700 var(--text-lg) var(--mono)}
  header p:not(.eyebrow){max-width:760px;margin-top:7px;color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  .comparison-summary{display:flex;flex-wrap:wrap;gap:7px;margin:14px 0}
  .comparison-summary span{padding:7px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--muted);font:var(--text-2xs) var(--mono)}
  .comparison-summary strong{color:var(--accent);font-size:var(--text-sm)}
  .table-wrap{border:1px solid var(--border);border-radius:var(--radius-sm)}
  tr.different{background:rgb(var(--amber-rgb) / .035)}
  th span,th strong,th small,td small{display:block;overflow-wrap:anywhere}
  th span{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  th strong{margin-top:2px}
  th small,td small{margin-top:4px;color:var(--muted);font-size:var(--text-2xs);line-height:1.4}
  .chip{display:inline-block;text-transform:capitalize}
  .state-equal{color:var(--accent)}
  .state-different{border-color:color-mix(in srgb,var(--amber) 45%,var(--border));color:var(--amber)}
  .state-missing,.state-unavailable{color:var(--muted)}
  .limitations{margin:12px 0 0;padding-left:18px;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  @media(max-width:700px){
    header{align-items:stretch;flex-direction:column}
    header .btn{width:100%}
    .table-wrap{margin-inline:calc(-1 * var(--card-pad));border-inline:0;border-radius:0}
  }
</style>
