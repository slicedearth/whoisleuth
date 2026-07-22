<script lang="ts">
  import type { BulkSortDirection, BulkSortKey } from '$lib/analysis/bulk-sort.js';

  type Filter = 'all' | 'available' | 'registered' | 'high_risk' | 'trusted' | 'errors';
  type IndicatorFormat = 'domains' | 'hosts' | 'dnsmasq' | 'rpz' | 'stix' | 'misp';
  type Counts = Record<Filter, number>;

  const filterKeys: Filter[] = ['all', 'available', 'registered', 'high_risk', 'trusted', 'errors'];
  const signalOptions = [['favicon', 'Favicon'], ['password', 'Password field'], ['phishing', 'Phishing language'], ['asset_reuse', 'Official assets'], ['idn', 'IDN / confusable']] as const;

  let {
    counts,
    filter,
    setFilter,
    running,
    retryErrors,
    exportCsv,
    indicatorFormat,
    setIndicatorFormat,
    exportIndicators,
    indicatorCount,
    mutationFilter,
    setMutationFilter,
    mutationOptions,
    signalFilters,
    toggleSignal,
    clearFilters,
    sortKey,
    sortDirection,
    setSortKey,
    setSortDirection,
    indicatorStatus,
    matchedCount,
    resultCount,
    visibleCount,
    currentPage,
    pageCount,
    watchlistName,
    setWatchlistName,
    saveResults,
    saveStatus,
  }: {
    counts: Counts;
    filter: Filter;
    setFilter: (value: Filter) => void;
    running: boolean;
    retryErrors: () => void | Promise<void>;
    exportCsv: () => void;
    indicatorFormat: IndicatorFormat;
    setIndicatorFormat: (value: IndicatorFormat) => void;
    exportIndicators: () => void;
    indicatorCount: number;
    mutationFilter: string;
    setMutationFilter: (value: string) => void;
    mutationOptions: Array<{ value: string; label: string }>;
    signalFilters: Set<string>;
    toggleSignal: (value: string) => void;
    clearFilters: () => void;
    sortKey: BulkSortKey;
    sortDirection: BulkSortDirection;
    setSortKey: (value: BulkSortKey) => void;
    setSortDirection: (value: BulkSortDirection) => void;
    indicatorStatus: string;
    matchedCount: number;
    resultCount: number;
    visibleCount: number;
    currentPage: number;
    pageCount: number;
    watchlistName: string;
    setWatchlistName: (value: string) => void;
    saveResults: () => void;
    saveStatus: string;
  } = $props();
</script>

<div class="triage-head">
  <div class="filters">{#each filterKeys as key}<button class="btn" class:active={filter === key} onclick={() => setFilter(key)}>{key.replace('_', ' ')} <span>{counts[key]}</span></button>{/each}</div>
  <div class="triage-actions">
    {#if counts.errors}<button class="btn" onclick={retryErrors} disabled={running}>Retry errors</button>{/if}
    <button class="btn" onclick={exportCsv}>Export CSV</button>
    <label class="indicator-format">Defensive format<select value={indicatorFormat} onchange={(event) => setIndicatorFormat(event.currentTarget.value as IndicatorFormat)}><option value="domains">Domains</option><option value="hosts">Hosts file</option><option value="dnsmasq">dnsmasq</option><option value="rpz">RPZ</option><option value="stix">STIX 2.1</option><option value="misp">MISP event JSON</option></select></label>
    <button class="btn" onclick={exportIndicators} disabled={!indicatorCount}>Export {indicatorCount} high-risk indicator{indicatorCount === 1 ? '' : 's'}</button>
  </div>
</div>
<div class="advanced-filters">
  <label class="field">Mutation<select value={mutationFilter} onchange={(event) => setMutationFilter(event.currentTarget.value)}><option value="">All mutations</option>{#each mutationOptions as mutation}<option value={mutation.value}>{mutation.label}</option>{/each}</select></label>
  <label class="field">Sort<select value={sortKey} onchange={(event) => setSortKey(event.currentTarget.value as BulkSortKey)}><option value="risk">Risk</option><option value="opportunity">Opportunity</option><option value="domain">Domain</option><option value="availability">Registration</option><option value="confidence">Confidence</option><option value="activity">Website</option><option value="registrar">Registrar</option><option value="mutation">Mutation</option></select></label>
  <label class="field">Order<select value={String(sortDirection)} onchange={(event) => setSortDirection(Number(event.currentTarget.value) === 1 ? 1 : -1)}><option value="-1">Descending</option><option value="1">Ascending</option></select></label>
  <div class="signal-filters" aria-label="Evidence filters">{#each signalOptions as option}<button class="btn small" class:active={signalFilters.has(option[0])} aria-pressed={signalFilters.has(option[0])} onclick={() => toggleSignal(option[0])}>{option[1]}</button>{/each}</div>
  <button class="btn" onclick={clearFilters} disabled={filter === 'all' && !mutationFilter && !signalFilters.size}>Clear filters</button>
</div>
{#if indicatorStatus}<p class="indicator-status" role="status" aria-live="polite">{indicatorStatus}</p>{/if}
<p>{matchedCount} of {resultCount} result{resultCount === 1 ? '' : 's'} matched · showing {visibleCount} on page {currentPage} of {pageCount}</p>
<div class="save-watchlist"><input aria-label="Watchlist name" value={watchlistName} oninput={(event) => setWatchlistName(event.currentTarget.value)} placeholder="Watchlist name"><button class="btn" onclick={saveResults}>Save to Monitor</button><span role="status" aria-live="polite">{saveStatus}</span></div>

<style>
  .triage-head{display:flex;min-width:0;justify-content:space-between;gap:14px}
  .filters,.triage-head>div{display:flex;min-width:0;flex-wrap:wrap;gap:6px}
  .filters button{text-transform:capitalize}
  .filters span{color:var(--muted);font-weight:400}
  .filters .active span{color:inherit}
  .indicator-format{display:flex;min-width:0;align-items:center;gap:6px;padding:0 4px 0 10px;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  .indicator-format select{min-width:0;min-height:32px;border:0;background:var(--panel-raised);font-size:var(--text-2xs)}
  .indicator-status{color:var(--amber)!important}
  .advanced-filters{display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .advanced-filters select{min-width:200px}
  .signal-filters{display:flex;flex-wrap:wrap;gap:5px}
  p{color:var(--muted);font-size:var(--text-xs)}
  .save-watchlist{display:grid;grid-template-columns:minmax(180px,280px) auto 1fr;gap:8px;align-items:center;margin:12px 0}
  .save-watchlist input{min-height:var(--control-h)}
  .save-watchlist span{color:var(--muted);font-size:var(--text-xs)}
  @media(max-width:700px){
    .triage-head{align-items:stretch;flex-direction:column}
    .triage-actions{display:grid;width:100%;grid-template-columns:minmax(0,1fr)}
    .triage-actions>*{width:100%;min-width:0}
    .indicator-format{justify-content:space-between;min-height:var(--control-h)}
    .advanced-filters select{width:100%;min-width:0}
    .save-watchlist{grid-template-columns:1fr}
  }
</style>
