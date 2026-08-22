<script lang="ts">
  import type { BulkDomainComparison } from '$lib/analysis/bulk-domain-comparison.ts';

  let {
    comparison,
    exportComparison,
    openSettledRow,
  }: {
    comparison: BulkDomainComparison | null;
    exportComparison: () => void | Promise<void>;
    openSettledRow: () => void;
  } = $props();

  function category(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function assessment(value: string): string {
    return ({
      conflicting: 'Conflicting retained evidence',
      different: 'Observed values differ',
      equal: 'Observed values equal',
      missing: 'One-sided observed value',
      not_recorded: 'Not recorded in compact evidence',
      unavailable: 'Unavailable or incomplete evidence',
    } as Record<string, string>)[value] ?? 'Comparison unavailable';
  }
</script>

{#if comparison}
  <section class="comparison card" aria-labelledby="domain-comparison-title">
    <header>
      <div>
        <p class="eyebrow">Settled evidence</p>
        <h2 id="domain-comparison-title">Two-domain comparison</h2>
        <p>{comparison.leftDomain} and {comparison.rightDomain} are compared field by field in the exact delta table. Missing evidence remains different from an observed difference.</p>
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
      <span class="summary-equal"><strong>{comparison.counts.equal}</strong> equal</span>
      <span class="summary-different"><strong>{comparison.counts.different}</strong> different</span>
      <span class="summary-unavailable"><strong>{comparison.counts.missing}</strong> one-sided</span>
      <span class="summary-conflicting"><strong>{comparison.counts.conflicting}</strong> conflicting</span>
      <span class="summary-unavailable"><strong>{comparison.counts.not_recorded}</strong> not recorded</span>
      <span class="summary-unavailable"><strong>{comparison.counts.unavailable}</strong> unavailable</span>
    </div>
    <div class="table-wrap">
      <table>
        <caption>Exact retained values, source states, and derived field deltas</caption>
        <thead><tr><th>Evidence</th><th>{comparison.leftDomain}</th><th>{comparison.rightDomain}</th><th>Delta</th></tr></thead>
        <tbody>
          {#each comparison.rows as row (row.id)}
            <tr data-state={row.state} class:different={row.state === 'different'}>
              <th scope="row" data-label="Evidence"><span>{category(row.category)}</span><strong>{row.label}</strong><small>{row.method}</small></th>
              <td data-label={comparison.leftDomain}>
                <span class="exact-value">{row.left}</span>
                <small>{row.source}</small>
                <small>Exact source state <code>{row.leftSourceState}</code></small>
                {#if row.leftEvidenceHref}<a class="evidence-link" href={row.leftEvidenceHref} onclick={openSettledRow}>View settled row</a>{/if}
              </td>
              <td data-label={comparison.rightDomain}>
                <span class="exact-value">{row.right}</span>
                <small>{row.source}</small>
                <small>Exact source state <code>{row.rightSourceState}</code></small>
                {#if row.rightEvidenceHref}<a class="evidence-link" href={row.rightEvidenceHref} onclick={openSettledRow}>View settled row</a>{/if}
              </td>
              <td data-label="Delta">
                <span class={`chip state-${row.state}`}>{assessment(row.state)}</span>
                <small>Comparison state <code>{row.state}</code></small>
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
  .freshness strong{color:var(--text);text-transform:capitalize}.freshness[data-state="stale"] strong{color:var(--amber)}
  .comparison-summary{display:flex;flex-wrap:wrap;gap:7px;margin:14px 0}
  .comparison-summary span{padding:7px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--muted);font:var(--text-2xs) var(--mono)}
  .comparison-summary strong{color:var(--text);font-size:var(--text-sm)}
  .comparison-summary .summary-equal strong{color:var(--success)}
  .comparison-summary .summary-different strong{color:var(--amber)}
  .comparison-summary .summary-conflicting strong{color:var(--danger)}
  .comparison-summary .summary-unavailable{border-style:dotted}
  .table-wrap{border:1px solid var(--border);border-radius:var(--radius-sm)}
  caption{padding:9px 10px;border-bottom:1px solid var(--border);color:var(--muted);font:650 var(--text-2xs) var(--mono);text-align:left}
  tr.different{background:rgb(var(--amber-rgb) / .035)}
  th span,th strong,th small,td small,.exact-value{display:block;overflow-wrap:anywhere}
  th span{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  th strong{margin-top:2px}
  th small,td small{margin-top:4px;color:var(--muted);font-size:var(--text-2xs);line-height:1.4}
  td code{color:var(--text);font-size:inherit}
  .chip{display:inline-block}
  .state-equal{border-color:color-mix(in srgb,var(--success) 45%,var(--border));color:var(--success)}
  .state-different{border-color:color-mix(in srgb,var(--amber) 45%,var(--border));color:var(--amber)}
  .state-conflicting{border-color:color-mix(in srgb,var(--danger) 45%,var(--border));color:var(--danger)}
  .state-missing,.state-not_recorded,.state-unavailable{border-color:var(--muted);border-style:dotted;color:var(--muted)}
  .evidence-link{display:inline-flex;align-items:center;margin-top:4px;color:var(--accent);font:650 var(--text-2xs) var(--mono)}
  .limitations{margin:12px 0 0;padding-left:18px;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  @media(max-width:700px){
    header{align-items:stretch;flex-direction:column}
    header .btn{width:100%}
    .table-wrap{margin-inline:0;overflow:visible;border:0}
    table,tbody{display:block}
    thead{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    tbody{display:grid;gap:10px}
    tr{display:block;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
    th,td{display:block;min-width:0;padding:9px 0;border:0;overflow-wrap:anywhere}
    th{padding-top:0;padding-bottom:11px;border-bottom:1px solid var(--border)}
    td::before{content:attr(data-label);display:block;margin-bottom:5px;color:var(--muted);font:600 .62rem var(--mono);letter-spacing:.06em;text-transform:uppercase;overflow-wrap:anywhere}
    td+td{border-top:1px solid var(--border)}
    .evidence-link{min-height:44px}
  }
</style>
