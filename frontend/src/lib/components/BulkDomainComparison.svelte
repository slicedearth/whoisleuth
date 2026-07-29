<script lang="ts">
  import type { BulkDomainComparison } from '$lib/analysis/bulk-domain-comparison.ts';
  import {
    projectEvidenceMatrix,
    type MatrixInput,
  } from '$lib/analysis/visualization-models.ts';

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

  const comparisonMatrix = $derived(comparison
    ? projectEvidenceMatrix(
      [comparison.leftDomain, comparison.rightDomain],
      comparison.rows.map((row): MatrixInput => ({
        id: row.id,
        label: row.label,
        cells: [
          { column: comparison.leftDomain, state: row.state, detail: row.left },
          { column: comparison.rightDomain, state: row.state, detail: row.right },
        ],
      })),
    )
    : null);
</script>

{#if comparison}
  <section class="comparison card" aria-labelledby="domain-comparison-title">
    <header>
      <div>
        <p class="eyebrow">Settled evidence</p>
        <h2 id="domain-comparison-title">Two-domain comparison</h2>
        <p>{comparison.leftDomain} and {comparison.rightDomain} are compared field by field. Missing evidence remains different from an observed difference.</p>
        <p class="freshness" data-state={comparison.freshness.state}>
          Evidence freshness: <strong>{comparison.freshness.state}</strong>
          {#if comparison.observedAt}
            · observed <time datetime={comparison.observedAt}>{comparison.observedAt.slice(0, 10)}</time>
            {#if comparison.freshness.ageDays !== null} · {comparison.freshness.ageDays} day{comparison.freshness.ageDays === 1 ? '' : 's'} ago{/if}
          {:else}
            · no reliable observation time recorded
          {/if}
        </p>
      </div>
      <button class="btn" type="button" onclick={exportComparison}>Export comparison</button>
    </header>
    <div class="comparison-summary" role="group" aria-label="Comparison summary">
      <span><strong>{comparison.counts.equal}</strong> equal</span>
      <span><strong>{comparison.counts.different}</strong> different</span>
      <span><strong>{comparison.counts.missing}</strong> one-sided</span>
      <span><strong>{comparison.counts.conflicting}</strong> conflicting</span>
      <span><strong>{comparison.counts.not_recorded}</strong> not recorded</span>
      <span><strong>{comparison.counts.unavailable}</strong> unavailable</span>
    </div>
    {#if comparisonMatrix?.rows.length}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -- scrollable matrix must be keyboard reachable -->
      <div class="comparison-matrix" role="img" tabindex="0" aria-label="Two-domain evidence comparison matrix. Exact values and limitations are in the following table.">
        <svg viewBox={`0 0 ${comparisonMatrix.width} ${comparisonMatrix.height}`} aria-hidden="true">
          {#each comparisonMatrix.columns as column}
            <text x={column.x + column.width / 2} y="30" text-anchor="middle" class="column-label">{column.label}</text>
          {/each}
          {#each comparisonMatrix.rows as row}
            <text x="8" y={row.y + row.height / 2 + 3} class="row-label">{row.label}</text>
            {#each row.cells as cell}
              <rect x={cell.x} y={row.y} width={cell.width} height={row.height} rx="4" class={`state-${cell.state}`}>
                <title>{row.label}, {cell.column}: {cell.state.replaceAll('_', ' ')}. {cell.detail}</title>
              </rect>
            {/each}
          {/each}
        </svg>
      </div>
    {/if}
    <div class="table-wrap">
      <table>
        <thead><tr><th>Evidence</th><th>{comparison.leftDomain}</th><th>{comparison.rightDomain}</th><th>Assessment</th></tr></thead>
        <tbody>
          {#each comparison.rows as row (row.id)}
            <tr class:different={row.state === 'different'}>
              <th scope="row"><span>{category(row.category)}</span><strong>{row.label}</strong><small>{row.method}</small></th>
              <td data-label={comparison.leftDomain}>
                {row.left}
                <small>{row.source} · {row.leftSourceState.replaceAll('_', ' ')}</small>
                {#if row.leftEvidenceHref}<a class="evidence-link" href={row.leftEvidenceHref}>View settled row</a>{/if}
              </td>
              <td data-label={comparison.rightDomain}>
                {row.right}
                <small>{row.source} · {row.rightSourceState.replaceAll('_', ' ')}</small>
                {#if row.rightEvidenceHref}<a class="evidence-link" href={row.rightEvidenceHref}>View settled row</a>{/if}
              </td>
              <td data-label="Assessment">
                <span class={`chip state-${row.state}`}>{row.state.replaceAll('_', ' ')}</span>
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
  header .freshness{font-size:var(--text-2xs);font-family:var(--mono)}
  .freshness strong{color:var(--accent);text-transform:capitalize}.freshness[data-state="stale"] strong{color:var(--amber)}
  .comparison-summary{display:flex;flex-wrap:wrap;gap:7px;margin:14px 0}
  .comparison-summary span{padding:7px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--muted);font:var(--text-2xs) var(--mono)}
  .comparison-summary strong{color:var(--accent);font-size:var(--text-sm)}
  .comparison-matrix{max-width:100%;margin:0 0 14px;overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .comparison-matrix:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .comparison-matrix svg{display:block;width:100%;min-width:650px;height:auto}
  .comparison-matrix text{fill:var(--muted);font:600 9px var(--mono)}
  .comparison-matrix .row-label{fill:var(--text)}
  .comparison-matrix rect{fill:var(--panel);stroke:var(--border);stroke-width:1}
  .comparison-matrix .state-equal{fill:color-mix(in srgb,var(--success) 15%,var(--panel));stroke:var(--success)}
  .comparison-matrix .state-different,.comparison-matrix .state-partial{fill:rgb(var(--amber-rgb) / .14);stroke:var(--amber)}
  .comparison-matrix .state-conflict{fill:rgb(var(--danger-rgb) / .12);stroke:var(--danger)}
  .comparison-matrix .state-not_collected,.comparison-matrix .state-unavailable,.comparison-matrix .state-unknown{stroke:var(--muted);stroke-dasharray:3 3}
  .table-wrap{border:1px solid var(--border);border-radius:var(--radius-sm)}
  tr.different{background:rgb(var(--amber-rgb) / .035)}
  th span,th strong,th small,td small{display:block;overflow-wrap:anywhere}
  th span{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  th strong{margin-top:2px}
  th small,td small{margin-top:4px;color:var(--muted);font-size:var(--text-2xs);line-height:1.4}
  .chip{display:inline-block;text-transform:capitalize}
  .state-equal{color:var(--accent)}
  .state-different{border-color:color-mix(in srgb,var(--amber) 45%,var(--border));color:var(--amber)}
  .state-conflicting{color:var(--danger)}
  .state-missing,.state-not_recorded,.state-unavailable{color:var(--muted)}
  .evidence-link{display:inline-block;margin-top:4px;color:var(--accent);font:650 var(--text-2xs) var(--mono)}
  .limitations{margin:12px 0 0;padding-left:18px;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  @media(max-width:700px){
    header{align-items:stretch;flex-direction:column}
    header .btn{width:100%}
    .table-wrap{margin-inline:calc(-1 * var(--card-pad));border-inline:0;border-radius:0}
  }
</style>
