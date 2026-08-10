<script lang="ts">
  import type { BulkSortDirection, BulkSortKey } from '$lib/analysis/bulk-sort.ts';
  import type { BulkAgeFilter, BulkGroupBy, BulkMailFilter, BulkSourceFilter } from '$lib/analysis/bulk-triage.ts';

  type Filter = 'all' | 'available' | 'registered' | 'high_risk' | 'trusted' | 'profile_unevaluated' | 'errors';
  type IndicatorFormat = 'domains' | 'hosts' | 'dnsmasq' | 'rpz' | 'stix' | 'misp';
  type Counts = Record<Filter, number>;

  const filterKeys: Filter[] = ['all', 'available', 'registered', 'high_risk', 'trusted', 'profile_unevaluated', 'errors'];
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
    indicatorProfileContextUnavailableCount,
    indicatorWildcards,
    setIndicatorWildcards,
    selectedIndicatorCount,
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
    saveSelectedResults,
    saveStatus,
    sourceFilter,
    reviewFilter,
    setSourceFilter,
    lifecycleFilter,
    setLifecycleFilter,
    ageFilter,
    setAgeFilter,
    mailFilter,
    setMailFilter,
    registrarFilter,
    setRegistrarFilter,
    caseDispositionFilter,
    setCaseDispositionFilter,
    groupBy,
    setGroupBy,
    advancedFilterOptions,
    selectedCount,
    monitorAllBlockedCount,
    monitorSelectedBlockedCount,
    selectFiltered,
    clearFilteredSelection,
    exportSelectedCsv,
    deepRescanSelected,
    createCasesSelected,
    setSelectedDisposition,
    caseOptions,
    profileContextState,
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
    indicatorProfileContextUnavailableCount: number;
    indicatorWildcards: boolean;
    setIndicatorWildcards: (value: boolean) => void;
    selectedIndicatorCount: number;
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
    saveSelectedResults: () => void;
    saveStatus: string;
    sourceFilter: BulkSourceFilter;
    reviewFilter: string;
    setSourceFilter: (value: BulkSourceFilter) => void;
    lifecycleFilter: string;
    setLifecycleFilter: (value: string) => void;
    ageFilter: BulkAgeFilter;
    setAgeFilter: (value: BulkAgeFilter) => void;
    mailFilter: BulkMailFilter;
    setMailFilter: (value: BulkMailFilter) => void;
    registrarFilter: string;
    setRegistrarFilter: (value: string) => void;
    caseDispositionFilter: string;
    setCaseDispositionFilter: (value: string) => void;
    groupBy: BulkGroupBy;
    setGroupBy: (value: BulkGroupBy) => void;
    advancedFilterOptions: { lifecycle: string[]; registrars: string[]; caseDispositions: string[] };
    selectedCount: number;
    monitorAllBlockedCount: number;
    monitorSelectedBlockedCount: number;
    selectFiltered: () => void | Promise<void>;
    clearFilteredSelection: () => void | Promise<void>;
    exportSelectedCsv: () => void | Promise<void>;
    deepRescanSelected: () => void | Promise<void>;
    createCasesSelected: () => void | Promise<void>;
    setSelectedDisposition: (value: string) => void | Promise<void>;
    caseOptions: ReadonlyArray<{ value: string; label: string }>;
    profileContextState: 'loading' | 'ready' | 'unavailable';
  } = $props();

  let filterPanelOpen = $state(false);
  let outputPanelOpen = $state(false);
  let selectionPanelOpen = $state(false);
  const activeFilterCount = $derived(
    (filter === 'all' ? 0 : 1)
    + (mutationFilter ? 1 : 0)
    + signalFilters.size
    + (sourceFilter ? 1 : 0)
    + (lifecycleFilter ? 1 : 0)
    + (ageFilter ? 1 : 0)
    + (mailFilter ? 1 : 0)
    + (registrarFilter ? 1 : 0)
    + (caseDispositionFilter ? 1 : 0)
    + (reviewFilter ? 1 : 0),
  );

</script>

<div class="triage-head">
  <div class="filters desktop-filter-row">{#each filterKeys as key}<button class="btn" class:active={filter === key} aria-pressed={filter === key} onclick={() => setFilter(key)}>{key.replace('_', ' ')} <span>{counts[key]}</span></button>{/each}</div>
  <div id="bulk-output-tools" class:mobile-collapsed={!outputPanelOpen} class="triage-actions">
    {#if counts.errors}<button class="btn" onclick={retryErrors} disabled={running || profileContextState === 'loading'}>Retry errors</button>{/if}
    <button class="btn" onclick={exportCsv}>Export CSV</button>
    <label class="indicator-format">Defensive format<select value={indicatorFormat} onchange={(event) => setIndicatorFormat(event.currentTarget.value as IndicatorFormat)}><option value="domains">Domains</option><option value="hosts">Hosts file</option><option value="dnsmasq">dnsmasq</option><option value="rpz">RPZ</option><option value="stix">STIX 2.1</option><option value="misp">MISP event JSON</option></select></label>
    {#if indicatorFormat === 'rpz'}<label class="wildcard-choice choice"><input type="checkbox" checked={indicatorWildcards} onchange={(event) => setIndicatorWildcards(event.currentTarget.checked)}><span>Include wildcard subdomains</span></label>{/if}
    <button class="btn" onclick={exportIndicators} disabled={profileContextState !== 'ready' || !indicatorCount}>Export {indicatorCount} reviewed indicator{indicatorCount === 1 ? '' : 's'}</button>
  </div>
</div>
<div class="mobile-review-bar">
  <div class="mobile-review-controls">
    <label class="field mobile-sort">Sort<select aria-label="Mobile result sort" value={sortKey} onchange={(event) => setSortKey(event.currentTarget.value as BulkSortKey)}><option value="risk">Risk</option><option value="domain">Domain</option><option value="availability">Registration</option><option value="confidence">Confidence</option><option value="activity">Website</option><option value="registrar">Registrar</option><option value="mutation">Mutation</option></select></label>
    <button class="btn mobile-panel-toggle" type="button" aria-controls="bulk-advanced-filter-panel" aria-expanded={filterPanelOpen} onclick={() => filterPanelOpen = !filterPanelOpen}>Filters <span>{activeFilterCount}</span></button>
    <button class="btn mobile-panel-toggle" type="button" aria-controls="bulk-output-tools" aria-expanded={outputPanelOpen} onclick={() => outputPanelOpen = !outputPanelOpen}>Actions</button>
  </div>
</div>
<p class:mobile-collapsed={!outputPanelOpen} class="review-note">Defensive exports use only shortlisted domains with a Suspicious or Confirmed abuse case disposition. {selectedIndicatorCount} shortlisted domain{selectedIndicatorCount === 1 ? ' is' : 's are'} in the current result set.{indicatorProfileContextUnavailableCount?` ${indicatorProfileContextUnavailableCount} selected row${indicatorProfileContextUnavailableCount===1?' is':'s are'} excluded because Brand Profile context is unavailable.`:''} A review manifest and rollback set are downloaded with the indicator file.</p>
<div id="bulk-advanced-filter-panel" class:mobile-collapsed={!filterPanelOpen} class="advanced-filter-panel">
  <div class="advanced-filters">
  <label class="field">Mutation<select value={mutationFilter} onchange={(event) => setMutationFilter(event.currentTarget.value)}><option value="">All mutations</option>{#each mutationOptions as mutation}<option value={mutation.value}>{mutation.label}</option>{/each}</select></label>
  <label class="field">Source coverage<select value={sourceFilter} onchange={(event) => setSourceFilter(event.currentTarget.value as BulkSourceFilter)}><option value="">Any coverage</option><option value="complete">Complete recorded sources</option><option value="limited">At least one limited source</option><option value="unrecorded">Coverage not recorded</option></select></label>
  <label class="field">Lifecycle<select value={lifecycleFilter} onchange={(event) => setLifecycleFilter(event.currentTarget.value)}><option value="">Any lifecycle</option>{#each advancedFilterOptions.lifecycle as value}<option value={value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
  <label class="field">Registration age<select value={ageFilter} onchange={(event) => setAgeFilter(event.currentTarget.value as BulkAgeFilter)}><option value="">Any observed age</option><option value="new_30">30 days or newer</option><option value="new_365">31 to 365 days</option><option value="older_365">Older than 365 days</option><option value="unknown">Not observed</option></select></label>
  <label class="field">Mail posture<select value={mailFilter} onchange={(event) => setMailFilter(event.currentTarget.value as BulkMailFilter)}><option value="">Any mail state</option><option value="mail">MX observed</option><option value="no_mail">No MX observed</option><option value="authenticated">SPF and DMARC observed</option><option value="auth_gap">SPF or DMARC gap</option><option value="unknown">Incomplete evidence</option></select></label>
  <label class="field">Registrar<select value={registrarFilter} onchange={(event) => setRegistrarFilter(event.currentTarget.value)}><option value="">Any registrar</option>{#each advancedFilterOptions.registrars as value}<option value={value}>{value}</option>{/each}</select></label>
  <label class="field">Case state<select value={caseDispositionFilter} onchange={(event) => setCaseDispositionFilter(event.currentTarget.value)}><option value="">Any case state</option>{#each advancedFilterOptions.caseDispositions as value}<option value={value}>{value === 'untracked' ? 'No case' : value.replaceAll('_', ' ')}</option>{/each}</select></label>
  <label class="field">Group summary<select value={groupBy} onchange={(event) => setGroupBy(event.currentTarget.value as BulkGroupBy)}><option value="">No grouping</option><option value="mutation">Mutation family</option><option value="tld">TLD</option><option value="registrar">Registrar</option><option value="nameserver">Nameserver set</option></select></label>
  <label class="field desktop-sort-control">Sort<select aria-label="Desktop result sort" value={sortKey} onchange={(event) => setSortKey(event.currentTarget.value as BulkSortKey)}><option value="risk">Risk</option><option value="domain">Domain</option><option value="availability">Registration</option><option value="confidence">Confidence</option><option value="activity">Website</option><option value="registrar">Registrar</option><option value="mutation">Mutation</option></select></label>
  <label class="field">Order<select value={String(sortDirection)} onchange={(event) => setSortDirection(Number(event.currentTarget.value) === 1 ? 1 : -1)}><option value="-1">Descending</option><option value="1">Ascending</option></select></label>
  <div class="signal-filters" role="group" aria-label="Evidence filters">{#each signalOptions as option}<button class="btn small" class:active={signalFilters.has(option[0])} aria-pressed={signalFilters.has(option[0])} onclick={() => toggleSignal(option[0])}>{option[1]}</button>{/each}</div>
  <button class="btn" onclick={clearFilters} disabled={filter === 'all' && !mutationFilter && !signalFilters.size && !sourceFilter && !lifecycleFilter && !ageFilter && !mailFilter && !registrarFilter && !caseDispositionFilter && !reviewFilter}>Clear filters</button>
  </div>
</div>
{#if indicatorStatus}<p class="indicator-status" role="status" aria-live="polite">{indicatorStatus}</p>{/if}
<div class="results-status">
  <p>{matchedCount} of {resultCount} result{resultCount === 1 ? '' : 's'} matched · showing {visibleCount} on page {currentPage} of {pageCount}</p>
  <button class="btn" onclick={selectFiltered} disabled={!matchedCount}>Select matched</button>
</div>
{#if selectedCount}
<section class="selection-actions" aria-labelledby="selection-actions-title">
  <div class="selection-summary"><div><strong id="selection-actions-title">{selectedCount} selected in the filtered set</strong><span>Only selected rows are included in these actions.</span></div><button class="btn mobile-selection-toggle" type="button" aria-controls="bulk-selection-actions" aria-expanded={selectionPanelOpen} onclick={() => selectionPanelOpen = !selectionPanelOpen}>Actions</button></div>
  <div id="bulk-selection-actions" class:mobile-collapsed={!selectionPanelOpen} class="action-row">
    <button class="btn" onclick={clearFilteredSelection} disabled={!selectedCount}>Clear filtered selection</button>
    <button class="btn" onclick={exportSelectedCsv} disabled={!selectedCount}>Export selected CSV</button>
    <button class="btn" onclick={deepRescanSelected} disabled={!selectedCount || running || profileContextState === 'loading'}>Deep rescan selected</button>
    <button class="btn" onclick={createCasesSelected} disabled={!selectedCount}>Create cases</button>
    <label class="field disposition">Set case state<select onchange={(event) => { const value = event.currentTarget.value; if (value) setSelectedDisposition(value); event.currentTarget.value = ''; }} disabled={!selectedCount}><option value="">Choose state</option>{#each caseOptions as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
  </div>
</section>
{/if}
<div class:mobile-collapsed={!outputPanelOpen} class="save-watchlist"><input aria-label="Watchlist name" value={watchlistName} oninput={(event) => setWatchlistName(event.currentTarget.value)} placeholder="Watchlist name"><button class="btn" onclick={saveSelectedResults} disabled={profileContextState !== 'ready' || !selectedCount || monitorSelectedBlockedCount>0}>Save selected</button><button class="btn" onclick={saveResults} disabled={profileContextState !== 'ready' || monitorAllBlockedCount>0}>Save to Monitor</button><span role="status" aria-live="polite">{saveStatus}{#if selectedCount && monitorSelectedBlockedCount} {monitorSelectedBlockedCount} selected row{monitorSelectedBlockedCount===1?' requires':'s require'} a local rescan before a selected Monitor save.{/if}{#if monitorAllBlockedCount} {monitorAllBlockedCount} result row{monitorAllBlockedCount===1?' requires':'s require'} a local rescan before an aggregate Monitor save.{/if}</span></div>

<style>
  .triage-head{display:flex;min-width:0;justify-content:space-between;gap:14px}
  .filters,.triage-head>div{display:flex;min-width:0;flex-wrap:wrap;gap:6px}
  .mobile-review-bar,.mobile-selection-toggle{display:none}
  .filters button{text-transform:capitalize}
  .filters span{color:var(--muted);font-weight:400}
  .filters .active span{color:inherit}
  .indicator-format{display:flex;min-width:0;align-items:center;gap:6px;padding:0 4px 0 10px;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  .indicator-format select{min-width:0;min-height:32px;border:0;background:var(--panel-raised);font-size:var(--text-2xs)}
  .indicator-status{color:var(--amber)!important}
  .review-note{margin:10px 0 0;padding:9px 10px;border-left:3px solid var(--amber);background:rgb(var(--amber-rgb) / .05)}
  .wildcard-choice{min-height:var(--control-h);padding:0 9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);font-size:var(--text-2xs)}
  .advanced-filter-panel{margin-top:12px}
  .advanced-filters{display:flex;flex-wrap:wrap;gap:10px;align-items:end;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .advanced-filters select{min-width:200px}
  .signal-filters{display:flex;flex-wrap:wrap;gap:5px}
  .selection-actions{display:grid;gap:10px;margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .selection-actions strong,.selection-actions span{display:block}
  .selection-actions span{margin-top:3px;color:var(--muted);font-size:var(--text-2xs)}
  .selection-summary{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .action-row{display:flex;flex-wrap:wrap;gap:7px;align-items:end}
  .disposition select{min-width:160px}
  p{color:var(--muted);font-size:var(--text-xs)}
  .results-status{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px}
  .results-status p{margin:0}
  .save-watchlist{display:grid;grid-template-columns:minmax(180px,280px) auto auto 1fr;gap:8px;align-items:center;margin:12px 0}
  .save-watchlist input{min-height:var(--control-h)}
  .save-watchlist span{color:var(--muted);font-size:var(--text-xs)}
  @media(max-width:700px){
    .triage-head{display:block}
    .desktop-filter-row{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-bottom:8px}
    .mobile-review-bar{display:grid;gap:8px}
    .desktop-filter-row button{min-width:0;padding-inline:7px;font-size:var(--text-2xs)}
    .mobile-review-controls{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px;align-items:end}
    .mobile-sort{min-width:0}
    .mobile-sort select{width:100%;min-width:0;min-height:36px}
    .mobile-panel-toggle{min-height:36px;padding-inline:9px}
    .mobile-panel-toggle span{color:var(--muted);font-weight:400}
    .triage-actions{display:grid;width:100%;grid-template-columns:minmax(0,1fr)}
    .triage-actions>*{width:100%;min-width:0}
    .indicator-format{justify-content:space-between;min-height:var(--control-h)}
    .advanced-filter-panel{padding:10px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
    .advanced-filters{margin-top:10px;padding:0;border:0;background:transparent}
    .advanced-filters select{width:100%;min-width:0}
    .desktop-sort-control{display:none}
    .mobile-collapsed{display:none!important}
    .results-status{align-items:stretch;flex-direction:column;gap:7px}
    .results-status .btn{width:100%}
    .selection-actions{position:sticky;z-index:5;bottom:8px;padding:10px;box-shadow:0 12px 30px rgb(var(--shadow-rgb) / .2)}
    .selection-summary{align-items:center}
    .mobile-selection-toggle{display:block;flex:0 0 auto}
    .action-row{display:grid;grid-template-columns:1fr}
    .action-row>*{width:100%;min-width:0}
    .save-watchlist{grid-template-columns:1fr}
  }
</style>
