<script lang="ts">
  import Pagination from '$lib/components/Pagination.svelte';
  import BulkRiskSummary from '$lib/components/BulkRiskSummary.svelte';
  import type { BulkRiskPresentation } from '$lib/analysis/bulk-route-model.ts';
  import type { BulkSortKey as SortKey } from '$lib/analysis/bulk-sort.ts';

  type CaseOption = { value: string; label: string };
  type DraftAction = { mailto: string; body: string };
  type CtEvidence = { lastObservedAt: string | null; hostnameCount: number; certificateCount: number };
  type ResultRow = {
    resultIndex: number;
    domain: string;
    shortlisted: boolean;
    unicodeDomain: string;
    mixedScript: boolean;
    referenceMatch: boolean;
    trusted: string;
    profileContextReady: boolean;
    profileContextLimitation: string;
    faviconMatch: boolean;
    faviconNearMatch: boolean;
    reusesOfficialAssets: boolean;
    hasPasswordField: boolean;
    phishingLanguageMatch: string;
    ct: CtEvidence | null;
    errorRow: boolean;
    error: string;
    availability: string;
    confidence: string;
    risk: BulkRiskPresentation;
    highRisk: boolean;
    activity: string;
    registrar: string;
    mutationLabel: string;
    caseRecord: { id: string; disposition: string } | null;
    outreach: DraftAction | null;
    responseHref: string;
    reviewState: string;
  };

  let {
    rows,
    sortKey,
    sortDirection,
    setSort,
    toggleSaved,
    caseOptions,
    setDisposition,
    trackCase,
    inspectDomain,
    copyDraft,
    currentPage,
    pageCount,
    setPage,
    draftStatus,
    caseStatus,
    setReviewState,
    shortlistAvailable = true,
    caseAvailable = true,
    reviewAvailable = true,
  }: {
    rows: ResultRow[];
    sortKey: SortKey;
    sortDirection: 1 | -1;
    setSort: (value: SortKey) => void;
    toggleSaved: (resultIndex: number) => void;
    caseOptions: CaseOption[];
    setDisposition: (resultIndex: number, value: string) => void;
    trackCase: (resultIndex: number) => void;
    inspectDomain: (resultIndex: number) => void | Promise<void>;
    copyDraft: (text: string, label: string) => void | Promise<void>;
    currentPage: number;
    pageCount: number;
    setPage: (value: number) => void;
    draftStatus: string;
    caseStatus: string;
    setReviewState: (resultIndex: number, value: string) => void;
    shortlistAvailable?: boolean;
    caseAvailable?: boolean;
    reviewAvailable?: boolean;
  } = $props();

  let expandedRows = $state<Set<number>>(new Set());
  let tableRoot: HTMLDivElement;

  $effect(() => {
    rows;
    for (const control of tableRoot?.querySelectorAll<HTMLButtonElement>('.star') ?? []) control.disabled = !shortlistAvailable;
    for (const control of tableRoot?.querySelectorAll<HTMLSelectElement>('.review-state') ?? []) control.disabled = !reviewAvailable;
    for (const control of tableRoot?.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('.case-track,.case-disp') ?? []) control.disabled = !caseAvailable;
  });

  function toggleRowDetails(resultIndex: number) {
    const next = new Set(expandedRows);
    if (next.has(resultIndex)) next.delete(resultIndex);
    else next.add(resultIndex);
    expandedRows = next;
  }
</script>

{#if !shortlistAvailable || !caseAvailable || !reviewAvailable}<p class="local-source-warning">Some browser-local actions are unavailable. Shortlist, Case, and review controls are disabled independently when their saved collection could not be read; result inspection remains available.</p>{/if}
<div class="table-wrap results-table" bind:this={tableRoot}>
  <table>
    <thead><tr><th aria-sort={sortKey === 'domain' ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none'}><button class="sort" onclick={() => setSort('domain')}>Domain {sortKey === 'domain' ? (sortDirection === 1 ? '↑' : '↓') : ''}</button></th><th aria-sort={sortKey === 'availability' ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none'}><button class="sort" onclick={() => setSort('availability')}>Registration {sortKey === 'availability' ? (sortDirection === 1 ? '↑' : '↓') : ''}</button></th><th aria-sort={sortKey === 'risk' ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none'}><button class="sort" onclick={() => setSort('risk')}>Risk {sortKey === 'risk' ? (sortDirection === 1 ? '↑' : '↓') : ''}</button></th><th aria-sort={sortKey === 'activity' ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none'}><button class="sort" onclick={() => setSort('activity')}>Website {sortKey === 'activity' ? (sortDirection === 1 ? '↑' : '↓') : ''}</button></th><th aria-sort={sortKey === 'registrar' ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none'}><button class="sort" onclick={() => setSort('registrar')}>Registrar {sortKey === 'registrar' ? (sortDirection === 1 ? '↑' : '↓') : ''}</button></th><th aria-sort={sortKey === 'mutation' ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none'}><button class="sort" onclick={() => setSort('mutation')}>Mutation {sortKey === 'mutation' ? (sortDirection === 1 ? '↑' : '↓') : ''}</button></th><th>Review</th><th>Case</th><th>Actions</th></tr></thead>
    <tbody>
      {#each rows as row}
        <tr id={`bulk-result-${row.resultIndex}`} class:error-row={row.errorRow} class:trusted-row={Boolean(row.trusted)} class:mobile-expanded={expandedRows.has(row.resultIndex)}>
          <td data-label="Domain"><div class="domain"><button class="star" class:unavailable={!shortlistAvailable} disabled={!shortlistAvailable} aria-label={shortlistAvailable?`${row.shortlisted ? 'Remove' : 'Add'} ${row.domain} ${row.shortlisted ? 'from' : 'to'} shortlist`:`Shortlist state unavailable for ${row.domain}`} aria-pressed={shortlistAvailable?row.shortlisted:undefined} onclick={() => toggleSaved(row.resultIndex)}>{shortlistAvailable?(row.shortlisted?'★':'☆'):'—'}</button><div class="domain-content"><strong>{row.domain}</strong>{#if !shortlistAvailable}<small class="source-unavailable">Shortlist unavailable</small>{/if}{#if row.unicodeDomain}<small class="idn-label">Unicode: {row.unicodeDomain}</small>{/if}{#if row.mixedScript}<small class="warn-label">Mixed writing scripts</small>{/if}{#if row.referenceMatch}<small class="warn-label">Official-domain skeleton match</small>{/if}{#if row.trusted}<small class="trusted-label">{row.trusted}</small>{/if}{#if !row.profileContextReady}<small class="warn-label">Brand Profile context unevaluated{row.profileContextLimitation ? ` — ${row.profileContextLimitation}` : ''}</small>{/if}{#if row.faviconMatch}<small class="danger-label">Favicon match</small>{:else if row.faviconNearMatch}<small class="warn-label">Favicon near-match</small>{/if}{#if row.reusesOfficialAssets}<small class="warn-label">Official asset relationship</small>{/if}{#if row.hasPasswordField}<small class="warn-label">Password field</small>{/if}{#if row.phishingLanguageMatch}<small class="danger-label">Phishing language</small>{/if}{#if row.ct}<details class="ct-source"><summary>Certificate Transparency</summary><div class="ct-source-detail">{#if row.ct.lastObservedAt}<span>Latest CT observation <time datetime={row.ct.lastObservedAt}>{row.ct.lastObservedAt.slice(0, 10)}</time></span>{/if}<span>{row.ct.hostnameCount} observed hostname{row.ct.hostnameCount === 1 ? '' : 's'}</span><span>{row.ct.certificateCount} distinct certificate{row.ct.certificateCount === 1 ? '' : 's'}</span></div></details>{/if}{#if row.error}<small>{row.error}</small>{/if}</div></div><button class="mobile-row-toggle" type="button" aria-expanded={expandedRows.has(row.resultIndex)} aria-label={`${expandedRows.has(row.resultIndex) ? 'Hide' : 'Show'} details for ${row.domain}`} onclick={() => toggleRowDetails(row.resultIndex)}>{expandedRows.has(row.resultIndex) ? 'Hide details' : 'Show details'}</button></td>
          <td data-label="Registration"><span class="state" data-registration-state={row.availability}>{row.availability.replace('_', ' ')}</span><small class="confidence">{row.confidence} confidence</small></td>
          <td data-label="Risk" class:high={row.highRisk}><BulkRiskSummary risk={row.risk} domain={row.domain} /></td>
          <td class="mobile-secondary" data-label="Website">{row.activity}</td>
          <td class="mobile-secondary" data-label="Registrar">{row.registrar}</td>
          <td class="mobile-secondary" data-label="Mutation">{row.mutationLabel}</td>
          <td class="mobile-secondary" data-label="Review">{#if reviewAvailable}<select class="review-state" aria-label={`Review state for ${row.domain}`} value={row.reviewState} onchange={(event) => setReviewState(row.resultIndex, event.currentTarget.value)}><option value="unreviewed">Unreviewed</option><option value="reviewing">Reviewing</option><option value="reviewed">Reviewed</option><option value="deferred">Deferred</option></select>{:else}<span class="source-unavailable">Review unavailable</span>{/if}</td>
          <td class="mobile-secondary" data-label="Case">{#if !caseAvailable}<span class="source-unavailable">Case unavailable</span>{:else if row.caseRecord}<div class="case-cell"><select class="case-disp" aria-label={`Disposition for ${row.domain}`} value={row.caseRecord.disposition} onchange={(event) => setDisposition(row.resultIndex, event.currentTarget.value)}>{#each caseOptions as option}<option value={option.value}>{option.label}</option>{/each}</select><a class="case-open" href={`/monitor?case=${encodeURIComponent(row.caseRecord.id)}`}>Open</a></div>{:else}<button class="btn small case-track" onclick={() => trackCase(row.resultIndex)}>＋ Create case</button>{/if}</td>
          <td class="mobile-secondary" data-label="Actions"><div class="draft-actions"><button class="inspect" onclick={() => inspectDomain(row.resultIndex)}>Inspect</button>{#if row.outreach}<a href={row.outreach.mailto}>Outreach</a><button onclick={() => copyDraft(row.outreach?.body ?? '', `${row.domain} outreach draft`)}>Copy</button>{/if}{#if row.responseHref}<a href={row.responseHref}>Prepare reviewed report</a>{/if}</div></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
<Pagination {currentPage} {pageCount} {setPage} ariaLabel="Bulk result pages" />
{#if draftStatus}<p class="draft-status" aria-live="polite">{draftStatus}</p>{/if}
{#if caseStatus}<p class="draft-status" role="status" aria-live="polite">{caseStatus}</p>{/if}

<style>
  .sort{min-height:auto;min-width:0;padding:0;border:0;background:none;color:inherit;font:inherit;text-transform:inherit;letter-spacing:inherit;cursor:pointer}
  .local-source-warning{padding:9px 11px;border:1px dotted var(--muted);border-radius:var(--radius-sm);color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .domain{display:flex;gap:7px}
  .star{min-width:24px;min-height:24px;padding:0;border:0;background:none;color:var(--amber);font-size:1rem;cursor:pointer}
  .star.unavailable{color:var(--muted);cursor:not-allowed}
  .domain-content{min-width:200px}
  .domain-content,td strong,td small{display:block;max-width:300px;overflow-wrap:anywhere}
  td strong{font-size:var(--text-sm)}
  td small{margin-top:4px;color:var(--danger);font-size:var(--text-2xs)}
  td .idn-label{color:var(--muted)}
  td .trusted-label{color:var(--accent2);text-transform:capitalize}
  td .warn-label{color:var(--amber)}
  td .danger-label{color:var(--danger)}
  td .source-unavailable{color:var(--muted)}
  .ct-source{margin-top:4px}
  .ct-source summary{color:var(--accent);font-size:var(--text-2xs);cursor:pointer}
  .ct-source-detail{display:flex;flex-direction:column;gap:2px;margin-top:4px}
  .ct-source-detail span{color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
  .ct-source-detail time{color:var(--text)}
  .state{color:var(--text);text-transform:capitalize}
  .state[data-registration-state='error'],.state[data-registration-state='failed']{color:var(--danger)}
  .state[data-registration-state='unknown'],.state[data-registration-state='unavailable'],.state[data-registration-state='not_collected']{color:var(--muted)}
  td .confidence{color:var(--muted);text-transform:capitalize}
  .high{color:var(--danger);font-weight:800}
  .error-row{background:rgb(var(--danger-rgb) / .03)}
  .trusted-row{background:rgb(var(--accent2-rgb) / .03)}
  tbody tr{scroll-margin-top:calc(var(--console-mobile-toolbar-height, 0px) + 24px)}
  .draft-actions{display:grid;grid-template-columns:auto auto;gap:4px;align-items:center}
  .draft-actions a,.draft-actions button{min-height:30px;padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);font:600 var(--text-2xs) var(--mono);text-align:center}
  .draft-actions .inspect{grid-column:1 / -1;border-color:rgb(var(--accent-rgb) / .45);color:var(--accent)}
  .draft-status{color:var(--accent)!important;font-size:var(--text-xs)}
  .case-cell{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
  .case-disp{min-height:32px;padding:2px 6px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);font-size:var(--text-2xs)}
  .review-state{min-height:32px;min-width:112px;padding:2px 6px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);font-size:var(--text-2xs)}
  .case-open{color:var(--accent);font-size:var(--text-2xs);font-weight:700}
  .case-track{white-space:nowrap}
  .mobile-row-toggle{display:none}
  @media(max-width:700px){
    .table-wrap{margin-inline:calc(-1 * var(--card-pad));padding-inline:var(--card-pad)}
    .domain-content{min-width:0}
    .mobile-row-toggle{display:flex;width:100%;min-height:34px;align-items:center;justify-content:center;margin-top:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--accent);font:700 var(--text-xs) var(--mono)}
    .results-table tr:not(.mobile-expanded) td.mobile-secondary{display:none}
  }
</style>
