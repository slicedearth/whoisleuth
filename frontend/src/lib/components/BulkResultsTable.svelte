<script lang="ts">
  import Pagination from '$lib/components/Pagination.svelte';

  type SortKey = 'domain' | 'risk' | 'opportunity';
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
    faviconMatch: boolean;
    faviconNearMatch: boolean;
    reusesOfficialAssets: boolean;
    hasPasswordField: boolean;
    phishingLanguageMatch: string;
    ct: CtEvidence | null;
    errorRow: boolean;
    error: string;
    availability: string;
    risk: number | null;
    highRisk: boolean;
    riskTitle: string | undefined;
    opportunity: number | null;
    activity: string;
    registrar: string;
    mutationLabel: string;
    caseRecord: { id: string; disposition: string } | null;
    outreach: DraftAction | null;
    abuse: DraftAction | null;
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
    copyDraft,
    currentPage,
    pageCount,
    setPage,
    draftStatus,
    caseStatus,
  }: {
    rows: ResultRow[];
    sortKey: SortKey;
    sortDirection: 1 | -1;
    setSort: (value: SortKey) => void;
    toggleSaved: (resultIndex: number) => void;
    caseOptions: CaseOption[];
    setDisposition: (resultIndex: number, value: string) => void;
    trackCase: (resultIndex: number) => void;
    copyDraft: (text: string, label: string) => void | Promise<void>;
    currentPage: number;
    pageCount: number;
    setPage: (value: number) => void;
    draftStatus: string;
    caseStatus: string;
  } = $props();
</script>

<div class="table-wrap results-table">
  <table>
    <thead><tr><th aria-sort={sortKey === 'domain' ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none'}><button class="sort" onclick={() => setSort('domain')}>Domain {sortKey === 'domain' ? (sortDirection === 1 ? '↑' : '↓') : ''}</button></th><th>Registration</th><th aria-sort={sortKey === 'risk' ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none'}><button class="sort" onclick={() => setSort('risk')}>Risk {sortKey === 'risk' ? (sortDirection === 1 ? '↑' : '↓') : ''}</button></th><th aria-sort={sortKey === 'opportunity' ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none'}><button class="sort" onclick={() => setSort('opportunity')}>Opportunity {sortKey === 'opportunity' ? (sortDirection === 1 ? '↑' : '↓') : ''}</button></th><th>Website</th><th>Registrar</th><th>Mutation</th><th>Case</th><th>Actions</th></tr></thead>
    <tbody>
      {#each rows as row}
        <tr class:error-row={row.errorRow} class:trusted-row={Boolean(row.trusted)}>
          <td data-label="Domain"><div class="domain"><button class="star" aria-label={`${row.shortlisted ? 'Remove' : 'Add'} ${row.domain} ${row.shortlisted ? 'from' : 'to'} shortlist`} aria-pressed={row.shortlisted} onclick={() => toggleSaved(row.resultIndex)}>{row.shortlisted ? '★' : '☆'}</button><div class="domain-content"><strong>{row.domain}</strong>{#if row.unicodeDomain}<small class="idn-label">Unicode: {row.unicodeDomain}</small>{/if}{#if row.mixedScript}<small class="warn-label">Mixed writing scripts</small>{/if}{#if row.referenceMatch}<small class="warn-label">Official-domain skeleton match</small>{/if}{#if row.trusted}<small class="trusted-label">{row.trusted}</small>{/if}{#if row.faviconMatch}<small class="danger-label">Favicon match</small>{:else if row.faviconNearMatch}<small class="warn-label">Favicon near-match</small>{/if}{#if row.reusesOfficialAssets}<small class="warn-label">Official asset relationship</small>{/if}{#if row.hasPasswordField}<small class="warn-label">Password field</small>{/if}{#if row.phishingLanguageMatch}<small class="danger-label">Phishing language</small>{/if}{#if row.ct}<details class="ct-source"><summary>Certificate Transparency</summary><div class="ct-source-detail">{#if row.ct.lastObservedAt}<span>Latest CT observation <time datetime={row.ct.lastObservedAt}>{row.ct.lastObservedAt.slice(0, 10)}</time></span>{/if}<span>{row.ct.hostnameCount} observed hostname{row.ct.hostnameCount === 1 ? '' : 's'}</span><span>{row.ct.certificateCount} distinct certificate{row.ct.certificateCount === 1 ? '' : 's'}</span></div></details>{/if}{#if row.error}<small>{row.error}</small>{/if}</div></div></td>
          <td data-label="Registration"><span class="state">{row.availability.replace('_', ' ')}</span></td>
          <td data-label="Risk" class:high={row.highRisk} title={row.riskTitle}>{row.risk ?? '—'}</td>
          <td data-label="Opportunity">{row.opportunity ?? '—'}</td>
          <td data-label="Website">{row.activity}</td>
          <td data-label="Registrar">{row.registrar}</td>
          <td data-label="Mutation">{row.mutationLabel}</td>
          <td data-label="Case">{#if row.caseRecord}<div class="case-cell"><select class="case-disp" aria-label={`Disposition for ${row.domain}`} value={row.caseRecord.disposition} onchange={(event) => setDisposition(row.resultIndex, event.currentTarget.value)}>{#each caseOptions as option}<option value={option.value}>{option.label}</option>{/each}</select><a class="case-open" href={`/monitor?case=${encodeURIComponent(row.caseRecord.id)}`}>Open</a></div>{:else}<button class="btn small case-track" onclick={() => trackCase(row.resultIndex)}>＋ Create case</button>{/if}</td>
          <td data-label="Actions"><div class="draft-actions">{#if row.outreach}<a href={row.outreach.mailto}>Outreach</a><button onclick={() => copyDraft(row.outreach?.body ?? '', `${row.domain} outreach draft`)}>Copy</button>{/if}{#if row.abuse}<a class="danger" href={row.abuse.mailto}>Report abuse</a><button onclick={() => copyDraft(row.abuse?.body ?? '', `${row.domain} abuse draft`)}>Copy</button>{/if}{#if !row.outreach && !row.abuse}—{/if}</div></td>
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
  .domain{display:flex;gap:7px}
  .star{min-width:24px;min-height:24px;padding:0;border:0;background:none;color:var(--amber);font-size:1rem;cursor:pointer}
  .domain-content{min-width:200px}
  .domain-content,td strong,td small{display:block;max-width:300px;overflow-wrap:anywhere}
  td strong{font-size:var(--text-sm)}
  td small{margin-top:4px;color:var(--danger);font-size:var(--text-2xs)}
  td .idn-label{color:var(--muted)}
  td .trusted-label{color:var(--accent2);text-transform:capitalize}
  td .warn-label{color:var(--amber)}
  td .danger-label{color:var(--danger)}
  .ct-source{margin-top:4px}
  .ct-source summary{color:var(--accent);font-size:var(--text-2xs);cursor:pointer}
  .ct-source-detail{display:flex;flex-direction:column;gap:2px;margin-top:4px}
  .ct-source-detail span{color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
  .ct-source-detail time{color:var(--text)}
  .state{color:var(--accent);text-transform:capitalize}
  .high{color:var(--danger);font-weight:800}
  .error-row{background:rgb(var(--danger-rgb) / .03)}
  .trusted-row{background:rgb(var(--accent2-rgb) / .03)}
  .draft-actions{display:grid;grid-template-columns:auto auto;gap:4px;align-items:center}
  .draft-actions a,.draft-actions button{min-height:30px;padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);font:600 var(--text-2xs) var(--mono);text-align:center}
  .draft-actions a.danger{border-color:rgb(var(--danger-rgb) / .34);background:rgb(var(--danger-rgb) / .05)}
  .draft-status{color:var(--accent)!important;font-size:var(--text-xs)}
  .case-cell{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
  .case-disp{min-height:32px;padding:2px 6px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);font-size:var(--text-2xs)}
  .case-open{color:var(--accent);font-size:var(--text-2xs);font-weight:700}
  .case-track{white-space:nowrap}
  @media(max-width:700px){
    .table-wrap{margin-inline:calc(-1 * var(--card-pad));padding-inline:var(--card-pad)}
    .domain-content{min-width:0}
  }
</style>
