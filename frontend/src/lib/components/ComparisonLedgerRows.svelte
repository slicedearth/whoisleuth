<script lang="ts">
  import type {
    ComparisonLedgerMode,
    ComparisonLedgerRow,
    ComparisonLedgerSide,
    ComparisonLedgerState,
  } from '$lib/analysis/comparison-ledger.ts';

  let {
    rows,
    totalRows,
    omittedRows = 0,
    duplicateRows = 0,
    sourceOmittedRows = 0,
  }: {
    rows: readonly ComparisonLedgerRow[];
    totalRows: number;
    omittedRows?: number;
    duplicateRows?: number;
    sourceOmittedRows?: number;
  } = $props();

  const MODE_LABELS: Record<ComparisonLedgerMode, string> = {
    publication: 'Publication comparison',
    entity: 'Entity comparison',
    temporal: 'Retained temporal comparison',
    expectation: 'Expectation review',
    membership: 'Retained membership comparison',
    reconciliation: 'Evidence reconciliation',
  };
  const STATE_LABELS: Record<ComparisonLedgerState, string> = {
    equivalent: 'Equivalent within retained scope',
    added: 'Added',
    removed: 'Removed from later complete evidence',
    different: 'Different',
    conflict: 'Conflict',
    collection_changed: 'Collection changed',
    model_changed: 'Model changed',
    incomplete: 'Incomplete comparison',
    unavailable: 'Unavailable',
    unsupported: 'Unsupported',
    not_compared: 'Not compared',
  };

  function when(value: string | null): string {
    if (!value) return 'Not retained';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('en-AU');
  }

  function stateLabel(value: ComparisonLedgerState): string {
    return STATE_LABELS[value];
  }
</script>

{#snippet SideMetadata(label: string, side: ComparisonLedgerSide)}
  <section class="side-metadata" aria-label={`${label} source metadata`}>
    <h4>{label}</h4>
    <dl>
      <div><dt>Source</dt><dd>{side.source}</dd></div>
      <div><dt>Source state</dt><dd>{side.sourceState}</dd></div>
      <div><dt>Observed</dt><dd>{when(side.observedAt)}</dd></div>
      <div><dt>Published</dt><dd>{when(side.publishedAt)}</dd></div>
      <div><dt>Retained</dt><dd>{when(side.retainedAt)}</dd></div>
    </dl>
  </section>
{/snippet}

{#snippet ExactDetails(row: ComparisonLedgerRow)}
  <div class="exact-details">
    <dl class="row-contract">
      <div><dt>Mode</dt><dd>{MODE_LABELS[row.mode]}</dd></div>
      <div><dt>State</dt><dd>{stateLabel(row.state)}</dd></div>
      <div><dt>Owner ID</dt><dd><code>{row.ownerId}</code></dd></div>
      <div><dt>Entity ID</dt><dd><code>{row.entityId}</code></dd></div>
      <div><dt>Evidence family</dt><dd>{row.family}</dd></div>
      <div><dt>Completeness</dt><dd>{row.completeness.replaceAll('_', ' ')}</dd></div>
      <div><dt>Projection truncation</dt><dd>{row.truncated ? 'Truncated; review the limitation and omission counts' : 'No row-level truncation'}</dd></div>
    </dl>
    <div class="source-grid">
      {@render SideMetadata('Earlier', row.earlier)}
      {@render SideMetadata('Later', row.later)}
    </div>
    <section class="row-limitations" aria-label="Row limitations">
      <h4>Limitations</h4>
      {#if row.limitations.length}
        <ul>
          {#each row.limitations as limitation}<li>{limitation}</li>{/each}
        </ul>
      {:else}
        <p>No additional row-specific limitation is retained.</p>
      {/if}
      {#if row.omittedLimitations}<p>Omitted {row.omittedLimitations} additional bounded limitation{row.omittedLimitations === 1 ? '' : 's'}.</p>{/if}
    </section>
    <div class="value-grid" aria-label="Exact retained values">
      <section><h4>Earlier exact value</h4><code>{row.earlier.value ?? 'Not retained'}</code></section>
      <section><h4>Later exact value</h4><code>{row.later.value ?? 'Not retained'}</code></section>
    </div>
  </div>
{/snippet}

{#if rows.length}
  <p class="row-count" role="status">Showing {rows.length} of {totalRows} derived exact row{totalRows === 1 ? '' : 's'}.</p>
  {#if omittedRows || duplicateRows || sourceOmittedRows}
    <p class="omission-note">
      {#if omittedRows}The current detail bound omits {omittedRows} derived row{omittedRows === 1 ? '' : 's'}.{/if}
      {#if duplicateRows} Suppressed {duplicateRows} duplicate exact row{duplicateRows === 1 ? '' : 's'} with the same bounded rendered identity; {duplicateRows === 1 ? 'it is' : 'they are'} not counted as unique detail or detail-bound omissions.{/if}
      {#if sourceOmittedRows} The retained source had already omitted {sourceOmittedRows} change row{sourceOmittedRows === 1 ? '' : 's'} before this review.{/if}
    </p>
  {/if}

  <div class="ledger-table">
    <table aria-label="Exact retained comparison rows">
      <thead><tr><th>State</th><th>Entity and field</th><th>Mode</th><th>Completeness</th><th>Exact review</th></tr></thead>
      <tbody>
        {#each rows as row (row.id)}
          <tr data-ledger-state={row.state}>
            <td><span class="state-label">{stateLabel(row.state)}</span></td>
            <td><strong>{row.entityId}</strong><small>{row.family} · {row.field}</small></td>
            <td>{MODE_LABELS[row.mode]}</td>
            <td>{row.completeness.replaceAll('_', ' ')}{row.truncated ? ' · truncated' : ''}</td>
            <td>
              <details>
                <summary aria-label={`Inspect exact values for ${row.entityId}, ${row.field}`}>Inspect exact values</summary>
                {@render ExactDetails(row)}
              </details>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="ledger-cards" aria-label="Exact retained comparison cards">
    {#each rows as row (row.id)}
      <article data-ledger-state={row.state}>
        <header><div><span class="state-label">{stateLabel(row.state)}</span><h3>{row.field}</h3></div><small>{row.entityId}</small></header>
        <p>{MODE_LABELS[row.mode]} · {row.family} · {row.completeness.replaceAll('_', ' ')}{row.truncated ? ' · truncated' : ''}</p>
        <details>
          <summary aria-label={`Inspect exact values for ${row.entityId}, ${row.field}`}>Inspect exact values</summary>
          {@render ExactDetails(row)}
        </details>
      </article>
    {/each}
  </div>
{:else}
  <p class="empty">No exact row is available for the selected retained comparison.</p>
  {#if duplicateRows || sourceOmittedRows}
    <p class="omission-note">
      {#if duplicateRows}Suppressed {duplicateRows} duplicate exact row{duplicateRows === 1 ? '' : 's'} with the same bounded rendered identity; {duplicateRows === 1 ? 'it is' : 'they are'} not counted as unique detail or detail-bound omissions.{/if}
      {#if sourceOmittedRows} The retained source had already omitted {sourceOmittedRows} declared change row{sourceOmittedRows === 1 ? '' : 's'} before this review.{/if}
    </p>
  {/if}
{/if}

<style>
  .row-count,.omission-note,.empty{margin:10px 0;color:var(--muted);font-size:var(--text-sm)}
  .omission-note{padding:10px 12px;border:1px dashed var(--amber);border-radius:var(--radius-sm);color:var(--text)}
  .ledger-table{overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius-md)}
  table{width:100%;min-width:820px;border-collapse:collapse}
  th,td{padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--border)}
  tbody tr:last-child td{border-bottom:0}
  th{font-size:var(--text-xs);color:var(--muted);text-transform:uppercase;letter-spacing:.06em;background:var(--panel-raised)}
  td{font-size:var(--text-sm)}
  td strong,td small{display:block;overflow-wrap:anywhere}
  td small{margin-top:3px;color:var(--muted)}
  details{min-width:0}
  summary{width:max-content;max-width:100%;cursor:pointer;color:var(--accent);font-weight:700;outline-offset:3px}
  summary:focus-visible{outline:2px solid var(--accent)}
  .state-label{display:inline-block;padding:3px 7px;border:1px solid currentColor;border-radius:999px;font-size:var(--text-xs);font-weight:800;line-height:1.25;color:var(--text)}
  [data-ledger-state="equivalent"] .state-label{color:var(--success)}
  [data-ledger-state="added"] .state-label,[data-ledger-state="removed"] .state-label,[data-ledger-state="different"] .state-label{color:var(--amber)}
  [data-ledger-state="conflict"] .state-label{border-style:double;color:var(--danger)}
  [data-ledger-state="incomplete"] .state-label,[data-ledger-state="collection_changed"] .state-label,[data-ledger-state="model_changed"] .state-label{border-style:dashed;color:var(--amber)}
  [data-ledger-state="unavailable"] .state-label,[data-ledger-state="unsupported"] .state-label,[data-ledger-state="not_compared"] .state-label{border-style:dotted;color:var(--muted)}
  .exact-details{margin-top:10px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);min-width:min(620px,75vw)}
  .row-contract,.side-metadata dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px 12px;margin:0}
  dl div{min-width:0}
  dt{font-size:var(--text-xs);font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
  dd{margin:2px 0 0;overflow-wrap:anywhere}
  code{font:inherit;overflow-wrap:anywhere;word-break:break-word;white-space:pre-wrap}
  .source-grid,.value-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}
  .side-metadata,.value-grid section,.row-limitations{min-width:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)}
  h4{margin:0 0 8px;font-size:var(--text-sm)}
  .row-limitations{margin-top:12px}
  .row-limitations ul,.row-limitations p{margin:5px 0 0;padding-left:18px;font-size:var(--text-sm)}
  .row-limitations p{padding-left:0}
  .value-grid code{display:block;max-height:12rem;overflow:auto}
  .ledger-cards{display:none}
  .ledger-cards article{min-width:0;padding:12px;border:1px solid var(--border);border-left:4px solid var(--border-strong);border-radius:var(--radius-md);background:var(--panel)}
  .ledger-cards article[data-ledger-state="equivalent"]{border-left-color:var(--success)}
  .ledger-cards article[data-ledger-state="conflict"]{border-left-color:var(--danger)}
  .ledger-cards article[data-ledger-state="added"],.ledger-cards article[data-ledger-state="removed"],.ledger-cards article[data-ledger-state="different"],.ledger-cards article[data-ledger-state="incomplete"],.ledger-cards article[data-ledger-state="collection_changed"],.ledger-cards article[data-ledger-state="model_changed"]{border-left-color:var(--amber)}
  .ledger-cards article[data-ledger-state="unavailable"],.ledger-cards article[data-ledger-state="unsupported"],.ledger-cards article[data-ledger-state="not_compared"]{border-left-style:dotted;border-left-color:var(--muted)}
  .ledger-cards header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
  .ledger-cards h3{margin:7px 0 0;font-size:var(--text-md);overflow-wrap:anywhere}
  .ledger-cards header small,.ledger-cards>article>p{color:var(--muted);overflow-wrap:anywhere}
  .ledger-cards>article>p{margin:8px 0;font-size:var(--text-sm)}
  @media(max-width:680px){
    .ledger-table{display:none}
    .ledger-cards{display:grid;gap:10px}
    .exact-details{min-width:0;padding:10px}
    .row-contract,.side-metadata dl,.source-grid,.value-grid{grid-template-columns:1fr}
    .ledger-cards header{display:block}
    .ledger-cards header small{display:block;margin-top:6px}
  }
</style>
