<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { LOOKUP_INVALID_QUERY_MESSAGE } from '#lib/analysis/lookup-response.ts';
  import type { PriorRegistrationReview } from '../../../../packages/evidence/prior-registration.mts';
  import { CT_DATE_LABELS } from '../../../../packages/investigation/ct-results.mts';
  import { EVIDENCE_INELIGIBLE_LABELS } from '../../../../packages/evidence/evidence-eligibility.mts';
  import { tokenLabel } from '../../../../packages/analysis/display-label.mts';
  import Pagination from '#lib/components/Pagination.svelte';
  import BulkRiskSummary from '#lib/components/BulkRiskSummary.svelte';
  import CasePicker from './CasePicker.svelte';
  import IntelligenceIcon from './IntelligenceIcon.svelte';
  import { casesForDomain } from '../../../../packages/cases/case-selection.mts';
  import type { CaseRecord } from '#lib/analysis/case-model.ts';
  import type { BulkRiskPresentation } from '#lib/analysis/bulk-route-model.ts';
  import type { BulkSortKey as SortKey } from '#lib/analysis/bulk-sort.ts';
  import type { BrowserLocalCollectionLoadState } from '#lib/browser-local-data-service.ts';
  import { BULK_RESULT_COLUMNS, DEFAULT_BULK_RESULT_COLUMNS, type BulkResultColumn } from '../../../../packages/workspace/bulk-columns.mts';

  type CaseOption = Readonly<{ value: string; label: string }>;
  type DraftAction = { mailto: string; body: string };
  type CtEvidence = { firstObservedAt: string | null; lastObservedAt: string | null; hostnameCount: number; certificateCount: number; chronologyContradicted: boolean; validityRange: { first: string; last: string } | null; priorRegistration: PriorRegistrationReview };
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
    popularity: { rank: number; listSha256: string } | null;
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
    columns = DEFAULT_BULK_RESULT_COLUMNS,
    setColumns,
    caseRecords = [],
    selectIncident,
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
    shortlistSourceState = 'ready',
    caseSourceState = 'ready',
    reviewSourceState = 'ready',
  }: {
    rows: ResultRow[];
    columns?: readonly BulkResultColumn[];
    setColumns: (value: BulkResultColumn[]) => void;
    caseRecords?: CaseRecord[];
    selectIncident: (domain: string, id: string) => boolean;
    sortKey: SortKey;
    sortDirection: 1 | -1;
    setSort: (value: SortKey) => void;
    toggleSaved: (resultIndex: number) => void;
    caseOptions: readonly CaseOption[];
    setDisposition: (resultIndex: number, value: string) => void;
    trackCase: (resultIndex: number) => void | Promise<unknown>;
    inspectDomain: (resultIndex: number) => void | Promise<void>;
    copyDraft: (text: string, label: string) => void | Promise<void>;
    currentPage: number;
    pageCount: number;
    setPage: (value: number) => void;
    draftStatus: string;
    caseStatus: string;
    setReviewState: (resultIndex: number, value: string) => void;
    shortlistSourceState?: BrowserLocalCollectionLoadState;
    caseSourceState?: BrowserLocalCollectionLoadState;
    reviewSourceState?: BrowserLocalCollectionLoadState;
  } = $props();

  let expandedRows = $state<Set<number>>(new Set());
  let tableRoot: HTMLDivElement;

  // Only the server's own invalid-query rejection removes Case creation; a
  // valid target whose collection failed keeps the action.

  // Creating a Case replaces its button with the disposition control. The save
  // is asynchronous, so focus moves when that control renders, and only while
  // the initiating action still owns focus: the button itself, or the page body
  // after the button was removed. Focus the analyst moved elsewhere is kept.
  // Raw state keeps the original object, so identity checks below compare the
  // same value rather than a reactive proxy of it.
  type PendingCaseFocus = Readonly<{ domain: string; initiator: HTMLElement | null; release: (event: FocusEvent) => void }>;
  let pendingCaseFocus = $state.raw<PendingCaseFocus | null>(null);
  // Every way a pending action ends (focus restored, focus moved away, a
  // failed or finished save, a newer action or unmounting) removes its listener.
  function endPendingCaseFocus(pending: PendingCaseFocus | null) {
    if (!pending) return;
    document.removeEventListener('focusin', pending.release, true);
    if (pendingCaseFocus === pending) pendingCaseFocus = null;
  }
  async function createCase(resultIndex: number, domain: string, initiator: HTMLElement | null) {
    // Repeating the same activation cannot start a new write. Keep the
    // original save's focus recovery until the action actually ends.
    if (pendingCaseFocus && pendingCaseFocus.domain === domain && pendingCaseFocus.initiator === initiator) return;
    endPendingCaseFocus(pendingCaseFocus);
    // Any focus the analyst moves elsewhere during the save cancels the restore.
    const release = (event: FocusEvent) => {
      if (event.target !== initiator) endPendingCaseFocus(pending);
    };
    const pending: PendingCaseFocus = { domain, initiator, release };
    pendingCaseFocus = pending;
    document.addEventListener('focusin', release, true);
    try {
      await trackCase(resultIndex);
    } finally {
      // A failed or unchanged save never renders the control; give a
      // successful one its update before deciding.
      await tick();
      if (pendingCaseFocus === pending && !rows.some((row) => row.domain === domain && row.caseRecord)) endPendingCaseFocus(pending);
    }
  }
  onDestroy(() => endPendingCaseFocus(pendingCaseFocus));
  function caseActionOwnsFocus(initiator: HTMLElement | null): boolean {
    const active = document.activeElement;
    return !active || active === document.body || active === document.documentElement || active === initiator;
  }
  $effect(() => {
    const pending = pendingCaseFocus;
    if (!pending || !rows.some((row) => row.domain === pending.domain && row.caseRecord)) return;
    void tick().then(() => {
      if (pendingCaseFocus !== pending) return;
      endPendingCaseFocus(pending);
      if (!caseActionOwnsFocus(pending.initiator)) return;
      const disposition = [...(tableRoot?.querySelectorAll<HTMLSelectElement>('select.case-disp') ?? [])]
        .find((control) => control.getAttribute('aria-label') === `Disposition for ${pending.domain}`);
      disposition?.focus();
    });
  });
  const shortlistAvailable = $derived(shortlistSourceState === 'ready');
  const caseAvailable = $derived(caseSourceState === 'ready');
  const reviewAvailable = $derived(reviewSourceState === 'ready');
  const unavailableSources = $derived([
    shortlistSourceState === 'unavailable' ? 'shortlist' : '',
    caseSourceState === 'unavailable' ? 'Case' : '',
    reviewSourceState === 'unavailable' ? 'review' : '',
  ].filter(Boolean));
  const loadingSources = $derived([
    shortlistSourceState === 'loading' ? 'shortlist' : '',
    caseSourceState === 'loading' ? 'Case' : '',
    reviewSourceState === 'loading' ? 'review' : '',
  ].filter(Boolean));

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

{#if unavailableSources.length}<p class="local-source-warning">Some workspace actions are unavailable ({unavailableSources.join(', ')}). Controls are disabled only where their saved collection could not be read; result inspection remains available.</p>
{:else if loadingSources.length}<p class="local-source-warning" role="status" aria-live="polite">Loading workspace {loadingSources.join(' and ')} actions. Result inspection remains available.</p>
{:else if reviewSourceState === 'idle'}<p class="local-source-warning" role="note">Review state loads only when the Review view is selected. Primary result inspection remains available.</p>{/if}
<details class="column-picker">
  <summary>List columns</summary>
  <fieldset>
    <legend>Show in the result list</legend>
    {#each BULK_RESULT_COLUMNS as column}
      <label><input type="checkbox" checked={columns.includes(column.id)} onchange={(event) => setColumns(event.currentTarget.checked ? [...columns, column.id] : columns.filter((id) => id !== column.id))}>{column.label}</label>
    {/each}
  </fieldset>
  <p>Domain and actions stay available. This only changes the List view, not evidence or exports. Save a review view to reuse these choices.</p>
  <button type="button" class="btn small" onclick={() => setColumns([...DEFAULT_BULK_RESULT_COLUMNS])}>Show all columns</button>
</details>
<div class="table-wrap results-table" class:all-columns={columns.length === BULK_RESULT_COLUMNS.length} bind:this={tableRoot}>
  <table>
    <thead><tr>
      <th aria-sort={sortKey === 'domain' ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none'}><button class="sort" onclick={() => setSort('domain')}>Domain {sortKey === 'domain' ? (sortDirection === 1 ? '↑' : '↓') : ''}</button></th>
      {#if columns.includes('registration')}<th aria-sort={sortKey === 'availability' ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none'}><button class="sort" onclick={() => setSort('availability')}>Registration {sortKey === 'availability' ? (sortDirection === 1 ? '↑' : '↓') : ''}</button></th>{/if}
      {#if columns.includes('risk')}<th aria-sort={sortKey === 'risk' ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none'}><button class="sort" onclick={() => setSort('risk')}>Risk {sortKey === 'risk' ? (sortDirection === 1 ? '↑' : '↓') : ''}</button></th>{/if}
      {#if columns.includes('website')}<th aria-sort={sortKey === 'activity' ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none'}><button class="sort" onclick={() => setSort('activity')}>Website {sortKey === 'activity' ? (sortDirection === 1 ? '↑' : '↓') : ''}</button></th>{/if}
      {#if columns.includes('registrar')}<th aria-sort={sortKey === 'registrar' ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none'}><button class="sort" onclick={() => setSort('registrar')}>Registrar {sortKey === 'registrar' ? (sortDirection === 1 ? '↑' : '↓') : ''}</button></th>{/if}
      {#if columns.includes('mutation')}<th aria-sort={sortKey === 'mutation' ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none'}><button class="sort" onclick={() => setSort('mutation')}>Mutation {sortKey === 'mutation' ? (sortDirection === 1 ? '↑' : '↓') : ''}</button></th>{/if}
      {#if columns.includes('review')}<th>Review</th>{/if}
      {#if columns.includes('case')}<th>Case</th>{/if}
      <th>Actions</th>
    </tr></thead>
    <tbody>
      {#each rows as row}
        {@const incidents=casesForDomain(caseRecords,row.domain)}
        <tr id={`bulk-result-${row.resultIndex}`} class:error-row={row.errorRow} class:trusted-row={Boolean(row.trusted)} class:mobile-expanded={expandedRows.has(row.resultIndex)}>
          <td data-label="Domain"><div class="domain"><button class="star" class:unavailable={!shortlistAvailable} disabled={!shortlistAvailable} aria-label={shortlistAvailable?`${row.shortlisted ? 'Remove' : 'Add'} ${row.domain} ${row.shortlisted ? 'from' : 'to'} shortlist`:shortlistSourceState==='loading'?`Shortlist state loading for ${row.domain}`:shortlistSourceState==='idle'?`Shortlist state not loaded for ${row.domain}`:`Shortlist state unavailable for ${row.domain}`} aria-pressed={shortlistAvailable?row.shortlisted:undefined} onclick={() => toggleSaved(row.resultIndex)}><IntelligenceIcon name={shortlistAvailable ? (row.shortlisted ? 'star-filled' : 'star') : shortlistSourceState === 'loading' ? 'ellipsis' : 'minus'} size={16} /></button><div class="domain-content"><strong>{row.domain}</strong>{#if shortlistSourceState === 'loading'}<small class="source-unavailable">Shortlist loading</small>{:else if shortlistSourceState === 'idle'}<small class="source-unavailable">Shortlist not loaded</small>{:else if !shortlistAvailable}<small class="source-unavailable">Shortlist unavailable</small>{/if}{#if row.unicodeDomain}<small class="idn-label">Unicode: {row.unicodeDomain}</small>{/if}{#if row.mixedScript}<small class="warn-label">Mixed writing scripts</small>{/if}{#if row.referenceMatch}<small class="warn-label">Official-domain skeleton match</small>{/if}{#if row.trusted}<small class="trusted-label">{row.trusted}</small>{/if}{#if !row.profileContextReady}<small class="warn-label">Brand Profile context unevaluated{row.profileContextLimitation ? ` — ${row.profileContextLimitation}` : ''}</small>{/if}{#if row.faviconMatch}<small class="danger-label">Favicon match</small>{:else if row.faviconNearMatch}<small class="warn-label">Favicon near-match</small>{/if}{#if row.reusesOfficialAssets}<small class="warn-label">Observed official-asset relationship</small>{/if}{#if row.hasPasswordField}<small class="warn-label">Password field</small>{/if}{#if row.phishingLanguageMatch}<small class="danger-label">Matched phishing-language pattern</small>{/if}{#if row.ct?.priorRegistration.state === 'earlier_observation'}<small class="warn-label">Certificate logged before current registration</small>{/if}{#if row.popularity}<small class="popularity-label">Ranked #{row.popularity.rank.toLocaleString()} in selected list · <span class="list-digest">sha256:{row.popularity.listSha256.slice(0, 12)}</span></small>{/if}{#if row.ct}<details class="ct-source"><summary>Certificate Transparency</summary><div class="ct-source-detail">{#if row.ct.firstObservedAt}<span>{CT_DATE_LABELS.firstObserved} <time datetime={row.ct.firstObservedAt}>{row.ct.firstObservedAt.slice(0, 10)}</time></span>{/if}{#if row.ct.lastObservedAt}<span>{CT_DATE_LABELS.lastObserved} <time datetime={row.ct.lastObservedAt}>{row.ct.lastObservedAt.slice(0, 10)}</time></span>{/if}{#if row.ct.validityRange}<span>{CT_DATE_LABELS.validityRange} <time datetime={row.ct.validityRange.first}>{row.ct.validityRange.first.slice(0, 10)}</time>{#if row.ct.validityRange.last !== row.ct.validityRange.first} to <time datetime={row.ct.validityRange.last}>{row.ct.validityRange.last.slice(0, 10)}</time>{/if} (context only)</span>{/if}<span>{row.ct.hostnameCount} observed hostname{row.ct.hostnameCount === 1 ? '' : 's'}</span><span>{row.ct.certificateCount} distinct certificate{row.ct.certificateCount === 1 ? '' : 's'}</span>{#if row.ct.chronologyContradicted}<span>Not compared with the registration date: {EVIDENCE_INELIGIBLE_LABELS.chronology_contradictory}.</span>{/if}{#each row.ct.priorRegistration.observations as observation (observation.source)}{#if observation.daysBeforeRegistration !== null}<span>{observation.label}: {observation.daysBeforeRegistration} days before the current registration was created{observation.context ? ' (context only)' : ''}</span>{/if}{/each}{#if row.ct.priorRegistration.state !== 'not_comparable'}<span>{row.ct.priorRegistration.limitations[0]}</span>{/if}</div></details>{/if}{#if row.error}<small>{row.error}</small>{/if}</div></div><button class="mobile-row-toggle" type="button" aria-expanded={expandedRows.has(row.resultIndex)} aria-label={`${expandedRows.has(row.resultIndex) ? 'Hide' : 'Show'} details for ${row.domain}`} onclick={() => toggleRowDetails(row.resultIndex)}>{expandedRows.has(row.resultIndex) ? 'Hide details' : 'Show details'}</button></td>
          {#if columns.includes('registration')}<td data-label="Registration"><span class="state" data-registration-state={row.availability}>{tokenLabel(row.availability)}</span><small class="confidence">{tokenLabel(row.confidence)} confidence</small></td>{/if}
          {#if columns.includes('risk')}<td data-label="Risk" class:high={row.highRisk}><BulkRiskSummary risk={row.risk} domain={row.domain} /></td>{/if}
          {#if columns.includes('website')}<td class="mobile-secondary" data-label="Website">{row.activity}</td>{/if}
          {#if columns.includes('registrar')}<td class="mobile-secondary" data-label="Registrar">{row.registrar}</td>{/if}
          {#if columns.includes('mutation')}<td class="mobile-secondary" data-label="Mutation">{row.mutationLabel}</td>{/if}
          {#if columns.includes('review')}<td class="mobile-secondary" data-label="Review">{#if reviewAvailable}<select class="review-state" aria-label={`Review state for ${row.domain}`} value={row.reviewState} onchange={(event) => setReviewState(row.resultIndex, event.currentTarget.value)}><option value="unreviewed">Unreviewed</option><option value="reviewing">Reviewing</option><option value="reviewed">Reviewed</option><option value="deferred">Deferred</option></select>{:else if reviewSourceState === 'loading'}<span class="source-unavailable">Review loading</span>{:else if reviewSourceState === 'idle'}<span class="source-unavailable">Open Review to load</span>{:else}<span class="source-unavailable">Review unavailable</span>{/if}</td>{/if}
          {#if columns.includes('case')}<td class="mobile-secondary" data-label="Case">
            {#if caseSourceState === 'loading'}<span class="source-unavailable">Case loading</span>
            {:else if caseSourceState === 'idle'}<span class="source-unavailable">Case not loaded</span>
            {:else if !caseAvailable}<span class="source-unavailable">Case unavailable</span>
            {:else}
              {#if incidents.length>1}<CasePicker id={`bulk-incident-${row.resultIndex}`} records={incidents} selectedId={row.caseRecord?.id??''} select={(id)=>selectIncident(row.domain,id)} />{/if}
              {#if row.caseRecord}<div class="case-cell"><select class="case-disp" aria-label={`Disposition for ${row.domain}`} value={row.caseRecord.disposition} onchange={(event) => setDisposition(row.resultIndex, event.currentTarget.value)}>{#each caseOptions as option}<option value={option.value}>{option.label}</option>{/each}</select><a class="case-open" href={`/monitor?case=${encodeURIComponent(row.caseRecord.id)}`} aria-label={`Open case for ${row.domain}`}>Open</a></div>
              {:else if row.errorRow && row.error === LOOKUP_INVALID_QUERY_MESSAGE}<span class="source-unavailable">Rejected as not a lookup target</span>
              {:else if !incidents.length}<button class="btn small case-track" aria-label={`Create case for ${row.domain}`} onclick={(event) => void createCase(row.resultIndex, row.domain, event.currentTarget)}>＋ Create case</button>{/if}
            {/if}
          </td>{/if}
          <td class="mobile-secondary" data-label="Actions"><div class="draft-actions"><button class="inspect" aria-label={`Inspect ${row.domain}`} onclick={() => inspectDomain(row.resultIndex)}>Inspect</button>{#if row.outreach}<a href={row.outreach.mailto} aria-label={`Outreach email for ${row.domain}`}>Outreach</a><button aria-label={`Copy outreach draft for ${row.domain}`} onclick={() => copyDraft(row.outreach?.body ?? '', `${row.domain} outreach draft`)}>Copy</button>{/if}{#if row.responseHref}<a href={row.responseHref} aria-label={`Prepare reviewed report for ${row.domain}`}>Prepare reviewed report</a>{/if}</div></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
<Pagination {currentPage} {pageCount} {setPage} ariaLabel="Bulk result pages" />
{#if draftStatus}<p class="draft-status" aria-live="polite">{draftStatus}</p>{/if}
{#if caseStatus}<p class="draft-status" role="status" aria-live="polite">{caseStatus}</p>{/if}

<style>
  .column-picker{margin:10px 0}.column-picker summary{cursor:pointer;font:650 var(--text-xs) var(--mono)}.column-picker fieldset{display:flex;flex-wrap:wrap;gap:10px 18px;min-width:0;margin:10px 0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm)}.column-picker legend{font:650 var(--text-xs) var(--mono)}.column-picker label{display:flex;align-items:center;gap:6px;min-height:32px;font-size:var(--text-sm);cursor:pointer}.column-picker input{width:16px;height:16px;min-height:0}.column-picker p{margin:8px 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5;overflow-wrap:anywhere}
  .sort{min-height:auto;min-width:0;padding:0;border:0;background:none;color:inherit;font:inherit;text-transform:inherit;letter-spacing:inherit;cursor:pointer}
  .local-source-warning{padding:9px 11px;border:1px dotted var(--muted);border-radius:var(--radius-sm);color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .domain{display:flex;gap:7px}
  .star{display:inline-flex;align-items:center;justify-content:center;min-width:24px;min-height:24px;padding:0;border:0;background:none;color:var(--amber);cursor:pointer}
  .star.unavailable{color:var(--muted);cursor:not-allowed}
  .domain-content{min-width:200px}
  .domain-content,td strong,td small{display:block;max-width:300px;overflow-wrap:anywhere}
  td strong{font-size:var(--text-sm)}
  td small{margin-top:4px;color:var(--danger);font-size:var(--text-2xs)}
  td .idn-label{color:var(--muted)}
  td .trusted-label{color:var(--accent2);text-transform:capitalize}
  td .warn-label{color:var(--amber)}
  td .popularity-label{color:var(--muted)}td .popularity-label .list-digest{font-family:var(--mono);overflow-wrap:anywhere}
  td .danger-label{color:var(--danger)}
  td .source-unavailable{color:var(--muted)}
  .ct-source{margin-top:4px}
  .ct-source summary{color:var(--accent);font-size:var(--text-2xs);cursor:pointer}
  .ct-source-detail{display:flex;flex-direction:column;gap:2px;margin-top:4px}
  .ct-source-detail span{color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
  .ct-source-detail time{color:var(--text)}
  .state{color:var(--text)}
  .state[data-registration-state='error'],.state[data-registration-state='failed']{color:var(--danger)}
  .state[data-registration-state='unknown'],.state[data-registration-state='unavailable'],.state[data-registration-state='not_collected']{color:var(--muted)}
  td .confidence{color:var(--muted)}
  .high{color:var(--danger);font-weight:800}
  .error-row{background:rgb(var(--danger-rgb) / .03)}
  .trusted-row{background:rgb(var(--accent2-rgb) / .03)}
  tbody tr{scroll-margin-top:calc(var(--console-toolbar-height, 0px) + 80px)}
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
  @media(min-width:701px){.results-table.all-columns table{min-width:1020px}th,.draft-actions>a,.draft-actions>button{white-space:nowrap}}
  @media(max-width:700px){
    .table-wrap{margin-inline:calc(-1 * var(--card-pad));padding-inline:var(--card-pad)}
    .domain-content{min-width:0}
    .mobile-row-toggle{display:flex;width:100%;min-height:34px;align-items:center;justify-content:center;margin-top:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--accent);font:700 var(--text-xs) var(--mono)}
    .results-table tr:not(.mobile-expanded) td.mobile-secondary{display:none}
  }
</style>
