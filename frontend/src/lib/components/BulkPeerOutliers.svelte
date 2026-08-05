<script lang="ts">
  import Pagination from '$lib/components/Pagination.svelte';
  import {
    filterBulkPeerOutlierRows,
    MAX_BULK_PEER_OUTLIER_FILTER_LENGTH,
    type BulkPeerOutlierMatrix,
  } from '$lib/analysis/bulk-peer-outliers.ts';

  let {
    matrix,
    exportMatrix,
  }: {
    matrix: BulkPeerOutlierMatrix;
    exportMatrix: () => void;
  } = $props();

  const PAGE_SIZE = 12;
  let query = $state('');
  let dimension = $state('all');
  let page = $state(1);
  const availableDimensions = $derived(
    [...new Map(matrix.rows
      .flatMap((row) => row.findings)
      .map((finding) => [finding.dimension, finding.label] as const)).entries()]
      .sort((left, right) => left[1].localeCompare(right[1])),
  );
  const filteredRows = $derived(filterBulkPeerOutlierRows(matrix, query, dimension));
  const pageCount = $derived(Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE)));
  const currentPage = $derived(Math.min(page, pageCount));
  const visibleRows = $derived(filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE));
  const firstVisibleRow = $derived(filteredRows.length ? ((currentPage - 1) * PAGE_SIZE) + 1 : 0);
  const lastVisibleRow = $derived(((currentPage - 1) * PAGE_SIZE) + visibleRows.length);
  const filtering = $derived(Boolean(query.trim()) || dimension !== 'all');

  function setPage(value: number) {
    page = Math.max(1, Math.min(pageCount, Math.trunc(value) || 1));
  }

  function resetFilters() {
    query = '';
    dimension = 'all';
    page = 1;
  }
</script>

{#if matrix.cohortSize >= 3}
  <section class="outliers card" aria-labelledby="bulk-outlier-title">
    <header>
      <div>
        <p class="eyebrow">Peer comparison</p>
        <h2 id="bulk-outlier-title">Local cohort outliers</h2>
        <p>Find low-frequency differences within the current filtered view. These are review cues, not risk or attribution conclusions.</p>
      </div>
      <button type="button" class="btn small" disabled={!matrix.rows.length} onclick={exportMatrix}>Export all outliers</button>
    </header>

    <div class="summary" role="group" aria-label="Peer comparison summary">
      <span><strong>{matrix.cohortSize}</strong> compared</span>
      <span><strong>{matrix.dimensions.length}</strong> dimensions</span>
      <span><strong>{matrix.rows.length}</strong> uncommon rows</span>
    </div>

    {#if matrix.rows.length}
      <fieldset class="filters">
        <legend>Filter uncommon rows</legend>
        <label>Domain or evidence
          <input
            type="search"
            maxlength={MAX_BULK_PEER_OUTLIER_FILTER_LENGTH}
            placeholder="Filter domains or values"
            value={query}
            oninput={(event) => { query = event.currentTarget.value; page = 1; }}
          >
        </label>
        <label>Evidence dimension
          <select value={dimension} onchange={(event) => { dimension = event.currentTarget.value; page = 1; }}>
            <option value="all">All dimensions</option>
            {#each availableDimensions as [id, label]}
              <option value={id}>{label}</option>
            {/each}
          </select>
        </label>
        <button type="button" class="btn small" disabled={!filtering} onclick={resetFilters}>Reset filters</button>
      </fieldset>
      <p class="result-count" role="status" aria-live="polite">
        Showing {firstVisibleRow}–{lastVisibleRow} of {filteredRows.length} matching uncommon domain{filteredRows.length === 1 ? '' : 's'} ({matrix.rows.length} total).
      </p>

      {#if visibleRows.length}
        <div class="row-list">
          {#each visibleRows as row (row.domain)}
            <article>
              <header><strong>{row.domain}</strong><span>{row.reviewScore}% contrast</span></header>
              <p class="row-summary">{row.findings.length} uncommon value{row.findings.length === 1 ? '' : 's'}{row.strongFindingCount ? ` · ${row.strongFindingCount} strong` : ''}</p>
              <ul>
                {#each row.findings as finding}
                  <li>
                    <strong>{finding.label}</strong>
                    <code>{finding.value}</code>
                    <span class="finding-strength" data-strength={finding.strength}>{finding.strength} contrast · {Math.round(finding.contrast * 100)}%</span>
                    <span>Observed in {finding.frequency} of {finding.observedCount}; local baseline in {finding.baselineCount}: {finding.baselineValue}</span>
                  </li>
                {/each}
              </ul>
            </article>
          {/each}
        </div>
        <Pagination {currentPage} {pageCount} {setPage} ariaLabel="Peer outlier pages" />
      {:else}
        <p class="empty">No uncommon row matches the current filters. Reset the view to review the complete local comparison.</p>
      {/if}
    {:else}
      <p class="empty">No value met the conservative low-frequency threshold in this view. This does not mean the domains are equivalent or complete.</p>
    {/if}

    <details>
      <summary>Comparison baselines and limits</summary>
      <div class="baselines">
        {#each matrix.dimensions as dimension}
          <p><strong>{dimension.label}</strong><span>{dimension.consensus} consensus · {dimension.baselineValue} · {dimension.baselineCount}/{dimension.observedCount} observed{dimension.excludedCount ? ` · ${dimension.excludedCount} unavailable` : ''}</span></p>
        {/each}
      </div>
      <ul class="limitations">{#each matrix.limitations as limitation}<li>{limitation}</li>{/each}</ul>
    </details>
  </section>
{/if}

<style>
  .outliers{min-width:0;padding:var(--card-pad)}
  .outliers>header{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
  h2{margin:2px 0 0;font-size:var(--text-lg)}
  header p:not(.eyebrow){max-width:720px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  header button{flex:0 0 auto}
  .summary{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}
  .summary span{padding:7px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--muted);font:var(--text-2xs) var(--mono)}
  .summary strong{color:var(--violet);font-size:var(--text-sm)}
  .filters{display:grid;grid-template-columns:minmax(220px,1fr) minmax(180px,.7fr) auto;gap:10px;align-items:end;margin-top:12px;padding:11px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  .filters legend{padding:0 5px;color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  .filters label{display:grid;gap:5px;min-width:0;color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  .filters input,.filters select{width:100%;min-width:0;min-height:var(--control-h)}
  .result-count{margin:9px 2px 0;color:var(--muted);font-size:var(--text-2xs)}
  .row-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}
  .row-list article{min-width:0;padding:11px;border:1px solid color-mix(in srgb,var(--violet) 34%,var(--border));border-radius:var(--radius-md);background:var(--panel-raised)}
  .row-list article>header{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .row-list article>header strong{overflow-wrap:anywhere}
  .row-list article>header span{flex:0 0 auto;color:var(--violet);font:650 var(--text-2xs) var(--mono)}
  .row-summary{margin:4px 0 0;color:var(--muted);font-size:var(--text-2xs)}
  .row-list ul{display:grid;gap:7px;margin:10px 0 0;padding:0;list-style:none}
  .row-list li{display:grid;min-width:0;max-width:100%;gap:3px;padding-top:7px;border-top:1px solid var(--border)}
  .row-list li strong{font-size:var(--text-xs)}
  .row-list code{min-width:0;color:var(--text);font-size:var(--text-2xs);overflow-wrap:anywhere}
  .row-list li span,.empty{min-width:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45;overflow-wrap:anywhere}
  .row-list li .finding-strength{width:max-content;padding:2px 6px;border:1px solid color-mix(in srgb,var(--violet) 38%,var(--border));border-radius:999px;color:var(--violet);font:650 var(--text-2xs) var(--mono);text-transform:capitalize}
  .row-list li .finding-strength[data-strength='strong']{border-color:color-mix(in srgb,var(--source-network) 42%,var(--border));color:var(--source-network)}
  details{margin-top:12px;border-top:1px solid var(--border)}
  summary{padding:11px 0;color:var(--text);font:680 var(--text-xs) var(--mono);cursor:pointer}
  summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  .baselines{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
  .baselines p{display:grid;gap:2px;margin:0;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .baselines strong{font-size:var(--text-xs)}
  .baselines span{color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
  .limitations{margin:10px 0 0;padding-left:18px;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  @media(max-width:720px){
    .outliers>header{display:grid}
    .outliers>header button{width:100%}
    .filters{grid-template-columns:minmax(0,1fr)}
    .filters button{width:100%}
    .row-list,.baselines{grid-template-columns:minmax(0,1fr)}
  }
</style>
