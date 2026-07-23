<script lang="ts">
  import Pagination from '$lib/components/Pagination.svelte';

  type CertificateEvidence = {
    certificateCount: number;
    firstObservedAt: string | null;
    lastObservedAt: string | null;
    hostnames: string[];
  };
  type CandidateRow = {
    domain: string;
    mutationLabel: string;
    selected: boolean;
    isNew: boolean;
    unicodeDomain: string;
    scripts: string[];
    mixedScript: boolean;
    referenceDomains: string[];
    certificateEvidence: CertificateEvidence | null;
  };

  let {
    selectedCount,
    candidateCount,
    continueToBulk,
    filter,
    setFilter,
    candidateScope,
    scopeCounts,
    setCandidateScope,
    mutationFilter,
    mutationOptions,
    setMutationFilter,
    candidateSort,
    setCandidateSort,
    structured,
    previousCheckedAt,
    newOnly,
    newCount,
    toggleNewOnly,
    selectMatching,
    selectedVisibleCount,
    reviewControlsActive,
    resetReviewControls,
    rows,
    visibleCount,
    currentPage,
    pageCount,
    pageSize,
    setPage,
    toggleCandidate,
  }: {
    selectedCount: number;
    candidateCount: number;
    continueToBulk: () => void | Promise<void>;
    filter: string;
    setFilter: (value: string) => void;
    candidateScope: string;
    scopeCounts: { unicode: number; mixed: number; reference: number; selected: number };
    setCandidateScope: (value: string) => void;
    mutationFilter: string;
    mutationOptions: Array<{ value: string; label: string; count: number }>;
    setMutationFilter: (value: string) => void;
    candidateSort: string;
    setCandidateSort: (value: string) => void;
    structured: boolean;
    previousCheckedAt: string | null;
    newOnly: boolean;
    newCount: number;
    toggleNewOnly: () => void;
    selectMatching: (selected: boolean) => void;
    selectedVisibleCount: number;
    reviewControlsActive: boolean;
    resetReviewControls: () => void;
    rows: CandidateRow[];
    visibleCount: number;
    currentPage: number;
    pageCount: number;
    pageSize: number;
    setPage: (page: number) => void;
    toggleCandidate: (domain: string) => void;
  } = $props();
</script>

<section class="results card">
  <header class="section-head"><div><p class="eyebrow">Candidates</p><h2>{selectedCount} selected of {candidateCount}</h2></div><button class="primary" onclick={continueToBulk} disabled={!selectedCount}>Continue to Bulk with {selectedCount}</button></header>
  <div class="toolbar results-toolbar">
    <input value={filter} oninput={(event) => setFilter(event.currentTarget.value)} aria-label="Filter candidates" placeholder={structured ? 'Filter by domain or observed hostname' : 'Filter candidates'}>
    <label>Show
      <select value={candidateScope} onchange={(event) => setCandidateScope(event.currentTarget.value)} aria-label="Candidate scope">
        <option value="all">All candidates ({candidateCount})</option>
        <option value="unicode">Internationalised ({scopeCounts.unicode})</option>
        <option value="mixed">Mixed writing scripts ({scopeCounts.mixed})</option>
        <option value="reference">Source or profile match ({scopeCounts.reference})</option>
        <option value="selected">Selected only ({scopeCounts.selected})</option>
      </select>
    </label>
    <label>Mutation
      <select value={mutationFilter} onchange={(event) => setMutationFilter(event.currentTarget.value)} aria-label="Mutation family">
        <option value="">All mutation families ({candidateCount})</option>
        {#each mutationOptions as option}<option value={option.value}>{option.label} ({option.count})</option>{/each}
      </select>
    </label>
    <label>Sort
      <select value={candidateSort} onchange={(event) => setCandidateSort(event.currentTarget.value)} aria-label="Candidate sort">
        <option value="generated">Generated order</option>
        <option value="domain">Domain A–Z</option>
        <option value="generation-paths">Most generation paths</option>
        {#if scopeCounts.reference}<option value="reference">Reference matches first</option>{/if}
        {#if scopeCounts.mixed}<option value="mixed">Mixed writing scripts first</option>{/if}
        {#if structured}<option value="certificate-newest">Newest certificate observation</option>{/if}
      </select>
    </label>
    {#if structured && previousCheckedAt}<button class="btn" class:active={newOnly} aria-pressed={newOnly} onclick={toggleNewOnly}>New only · {newCount}</button>{/if}
    <button class="btn" onclick={() => selectMatching(true)} disabled={!visibleCount}>Select filtered ({visibleCount})</button>
    <button class="btn" onclick={() => selectMatching(false)} disabled={!selectedVisibleCount}>Clear filtered ({selectedVisibleCount})</button>
    {#if reviewControlsActive}<button class="btn" onclick={resetReviewControls}>Reset view</button>{/if}
  </div>
  <div class="candidate-list">
    {#each rows as candidate, index (candidate.domain)}
      <div class="candidate" class:has-ct={candidate.certificateEvidence}>
        <input type="checkbox" id={`candidate-${index}`} checked={candidate.selected} onchange={() => toggleCandidate(candidate.domain)}>
        <div class="candidate-body">
          <label for={`candidate-${index}`}>
            <strong>{candidate.domain}</strong>
            {#if candidate.unicodeDomain}<span class="unicode-domain">Unicode: {candidate.unicodeDomain}</span>{/if}
            <small>{candidate.mutationLabel}</small>
            {#if candidate.scripts.length}<span class="script-summary">Scripts: {candidate.scripts.join(', ')}</span>{/if}
            <span class="candidate-badges">
              {#if candidate.unicodeDomain}<span class="candidate-badge">Internationalised</span>{/if}
              {#if candidate.mixedScript}<span class="candidate-badge warning">Mixed writing scripts</span>{/if}
              {#if candidate.referenceDomains.length}<span class="candidate-badge warning">Source or profile visual match</span>{/if}
              {#if candidate.isNew}<span class="ct-new">New since previous search</span>{/if}
            </span>
          </label>
          {#if candidate.referenceDomains.length}
            <span class="reference-summary">
              Visual match: {candidate.referenceDomains.slice(0, 3).join(', ')}{candidate.referenceDomains.length > 3 ? ` +${candidate.referenceDomains.length - 3} more` : ''}
            </span>
          {/if}
          {#if candidate.certificateEvidence}
            {@const ct = candidate.certificateEvidence}
            <div class="ct-meta">
              <span class="ct-stat">{ct.certificateCount} distinct certificate{ct.certificateCount === 1 ? '' : 's'}</span>
              {#if ct.firstObservedAt}<span class="ct-stat">Earliest CT observation <time datetime={ct.firstObservedAt}>{ct.firstObservedAt.slice(0, 10)}</time></span>{/if}
              {#if ct.lastObservedAt}<span class="ct-stat">Latest CT observation <time datetime={ct.lastObservedAt}>{ct.lastObservedAt.slice(0, 10)}</time></span>{/if}
            </div>
            {#if ct.hostnames.length}
              <div class="ct-hosts">
                {#each ct.hostnames.slice(0, 3) as host}<code>{host}</code>{/each}
                {#if ct.hostnames.length > 3}<details><summary>Show all {ct.hostnames.length} observed hostnames</summary><div class="ct-host-list">{#each ct.hostnames as host}<code>{host}</code>{/each}</div></details>{/if}
              </div>
            {/if}
          {/if}
        </div>
      </div>
    {/each}
  </div>
  {#if scopeCounts.reference}
    <p class="candidate-note">Visual matches use a bounded character comparison. They are review leads, not proof of impersonation.</p>
  {/if}
  {#if !selectedCount}
    <p class="candidate-note">Select individual candidates or the current filtered set before continuing to Bulk.</p>
  {/if}
  {#if visibleCount}
    <p class="page-summary" role="status" aria-live="polite">Showing {(currentPage - 1) * pageSize + 1}–{(currentPage - 1) * pageSize + rows.length} of {visibleCount} matching candidate{visibleCount === 1 ? '' : 's'}.</p>
  {:else}
    <p class="page-summary" role="status">No candidates match the current filters.</p>
  {/if}
  <Pagination {currentPage} {pageCount} {setPage} ariaLabel="Discover candidate pages" />
</section>

<style>
  .results{margin-top:16px;padding:var(--card-pad)}
  .results h2{margin:0}
  .results-toolbar{display:grid;grid-template-columns:minmax(220px,1fr) repeat(3,minmax(140px,auto));margin:16px 0 12px}
  .results-toolbar label{display:grid;gap:4px;color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  .results-toolbar select{min-width:0}
  .results-toolbar button{align-self:end}
  .candidate-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;align-items:start}
  .candidate{display:flex;gap:10px;min-width:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .candidate.has-ct{align-items:flex-start}
  .candidate input{margin-top:2px}
  .candidate-body{flex:1;min-width:0}
  .candidate-body label{display:block;min-width:0;cursor:pointer}
  .candidate strong{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;overflow-wrap:anywhere;font-size:var(--text-sm)}
  .unicode-domain{display:block;margin-top:4px;overflow-wrap:anywhere;color:var(--text);font-size:var(--text-xs)}
  .candidate small{display:block;margin-top:4px;color:var(--muted);font-size:var(--text-2xs);text-transform:capitalize}
  .script-summary{display:block;margin-top:4px;color:var(--muted);font-size:var(--text-2xs)}
  .candidate-badges{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}
  .candidate-badge{display:inline-block;padding:3px 8px;border:1px solid rgb(var(--accent-rgb) / .35);border-radius:99px;color:var(--accent);font:600 var(--text-2xs) var(--mono)}
  .candidate-badge.warning{border-color:rgb(var(--amber-rgb) / .45);color:var(--amber)}
  .reference-summary{display:block;margin-top:6px;overflow-wrap:anywhere;color:var(--muted);font-size:var(--text-2xs)}
  .ct-new{display:inline-block;margin-top:6px;padding:3px 8px;border:1px solid rgb(var(--accent2-rgb) / .45);border-radius:99px;color:var(--accent2);font:600 var(--text-2xs) var(--mono)}
  .ct-meta{display:flex;flex-wrap:wrap;gap:3px 10px;margin-top:6px}
  .ct-stat{color:var(--muted);font-size:var(--text-2xs)}
  .ct-stat time{color:var(--text)}
  .ct-hosts{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
  .ct-hosts code{min-width:0;padding:2px 6px;overflow-wrap:anywhere;border:1px solid var(--border);border-radius:6px;background:rgb(var(--bg-rgb) / .5);font-size:var(--text-2xs)}
  .ct-hosts details{width:100%}
  .ct-hosts summary{color:var(--accent);cursor:pointer;font-size:var(--text-2xs)}
  .ct-host-list{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
  .candidate-note{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .page-summary{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs)}
  @media(max-width:700px){
    .results-toolbar,.candidate-list{grid-template-columns:1fr}
    .results-toolbar label,.results-toolbar select,.results-toolbar button{width:100%}
    .results .section-head{display:block}
    .results .section-head button{width:100%;margin-top:14px}
  }
</style>
