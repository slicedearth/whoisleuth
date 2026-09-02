<script lang="ts">
  import {
    CASE_DISPOSITIONS,
    CASE_REVIEW_REASONS,
    type CaseRecord,
  } from '$lib/cases';
  import type {
    AbuseRecipientResolution,
    ResolvedAbuseRecipient,
  } from '$lib/analysis/abuse-recipient-resolver.ts';
  import { abuseRecipientKindLabel } from '$lib/analysis/abuse-recipient-resolver.ts';

  type DraftAction = { email: string; body: string; mailto: string };

  let {
    domain,
    lookupTarget,
    lookupDepth,
    record,
    note,
    caseStatus,
    caseDisposition,
    caseReviewReason,
    draftStatus,
    outreach,
    recipientResolution,
    linkedWatchlistNames,
    watchlistSourceState,
    watchlistName,
    watchlistStatus,
    setNote,
    setCaseDisposition,
    setCaseReviewReason,
    setWatchlistName,
    createCase,
    addNote,
    saveClassification,
    saveToWatchlist,
    recheckCase,
    recordRecipient,
    copyDraft,
    statusLabel,
    dispositionLabel,
    actionBusy = false,
    watchlistBusy = false,
  }: {
    domain: string;
    lookupTarget: string;
    lookupDepth: 'fast' | 'deep';
    record: CaseRecord | null;
    note: string;
    caseStatus: string;
    caseDisposition: string;
    caseReviewReason: string;
    draftStatus: string;
    outreach: DraftAction | null;
    recipientResolution: AbuseRecipientResolution;
    linkedWatchlistNames: string[];
    watchlistSourceState: 'loading' | 'ready' | 'unavailable';
    watchlistName: string;
    watchlistStatus: string;
    setNote: (value: string) => void;
    setCaseDisposition: (value: string) => void;
    setCaseReviewReason: (value: string) => void;
    setWatchlistName: (value: string) => void;
    createCase: () => void;
    addNote: () => void;
    saveClassification: () => void;
    saveToWatchlist: () => void;
    recheckCase: () => void;
    recordRecipient: (route: ResolvedAbuseRecipient) => void | Promise<void>;
    copyDraft: (text: string, label: string) => void | Promise<void>;
    statusLabel: (value: CaseRecord['status']) => string;
    dispositionLabel: (value: CaseRecord['disposition']) => string;
    actionBusy?: boolean;
    watchlistBusy?: boolean;
  } = $props();

  const classificationUnchanged = $derived(Boolean(record
    && record.disposition === caseDisposition
    && (record.reviewReasonCode ?? '') === (caseDisposition === 'unreviewed' ? '' : caseReviewReason)));
  const classificationIncomplete = $derived(caseDisposition !== 'unreviewed' && !caseReviewReason);

  function caseWorkspaceHref(recordId: string, focusResponse = false): string {
    const encodedId = encodeURIComponent(recordId);
    const base = `/monitor?view=cases&case=${encodedId}`;
    return focusResponse ? `${base}#case-response-${encodedId}` : base;
  }
</script>

{#if domain}
  <section class="case-card evidence-card card">
    <div class="case-intro section-head"><div><p class="eyebrow">Investigation</p><h4>Analyst case</h4></div>{#if record}<div class="case-badges"><span class={`badge status-${record.status}`}>{statusLabel(record.status)}</span><span class={`badge disposition-${record.disposition}`}>{dispositionLabel(record.disposition)}</span></div>{/if}</div>
    {#if record}
      <div class="case-body">
        <form class="note-edit" onsubmit={(event) => { event.preventDefault(); addNote(); }}>
          <label class="field" for="case-note">Add note</label>
          <textarea id="case-note" value={note} oninput={(event) => setNote(event.currentTarget.value)} rows="2" placeholder="Observed behaviour, evidence, decisions…" disabled={actionBusy}></textarea>
          <div class="case-actions"><button class="btn" type="submit" disabled={actionBusy || !note.trim()}>Add note</button><button class="btn" type="button" onclick={createCase} disabled={actionBusy} aria-label={`Refresh retained Case evidence for ${domain}`}>Refresh case evidence</button><a href={caseWorkspaceHref(record.id)}>Open in Monitor →</a></div>
        </form>
        <div class="case-tools">
          <form class="case-tool" onsubmit={(event) => { event.preventDefault(); saveClassification(); }}>
            <div><strong>Analyst classification</strong><p>Record your conclusion separately from source observations and the Risk score.</p></div>
            <div class="classification-fields">
              <label class="field" for="lookup-case-disposition">Disposition<select id="lookup-case-disposition" value={caseDisposition} onchange={(event) => setCaseDisposition(event.currentTarget.value)} disabled={actionBusy}>{#each CASE_DISPOSITIONS as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
              <label class="field" for="lookup-case-review-reason">Review reason<select id="lookup-case-review-reason" value={caseReviewReason} onchange={(event) => setCaseReviewReason(event.currentTarget.value)} disabled={actionBusy || caseDisposition === 'unreviewed'}>{#each CASE_REVIEW_REASONS as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
            </div>
            <button class="btn small" type="submit" disabled={actionBusy || classificationUnchanged || classificationIncomplete}>Save classification</button>
            {#if classificationIncomplete}<p class="field-note">Choose a reviewed reason before saving this disposition.</p>{/if}
          </form>

          <section class="case-tool monitoring-tool" aria-labelledby="lookup-case-monitoring-title">
            <div><strong id="lookup-case-monitoring-title">Monitoring and recheck</strong><p>Keep a browser-local baseline, or deliberately recollect the exact hostname with the current Lookup settings.</p></div>
            {#if watchlistSourceState === 'loading'}
              <p class="field-note" role="status">Checking browser-local watchlists…</p>
            {:else if watchlistSourceState === 'unavailable'}
              <p class="field-note warn-text">Browser-local watchlists could not be read. Existing membership is unknown and no empty state is inferred.</p>
            {:else if linkedWatchlistNames.length}
              <p class="linked-watchlists">Linked watchlist{linkedWatchlistNames.length === 1 ? '' : 's'}: {#each linkedWatchlistNames as name, index}<a href={`/monitor?view=watchlists&watchlist=${encodeURIComponent(name)}`}>{name}</a>{index < linkedWatchlistNames.length - 1 ? ', ' : ''}{/each}</p>
            {:else}
              <p class="field-note">This exact hostname is not in a readable browser-local watchlist.</p>
            {/if}
            {#if record.status === 'monitoring' && watchlistSourceState === 'ready' && !linkedWatchlistNames.length}
              <p class="monitoring-warning" role="note">This Case is marked Monitoring, but no readable watchlist currently contains {lookupTarget}. Add a local baseline or change the Case status in Monitor.</p>
            {/if}
            <form class="watchlist-form" onsubmit={(event) => { event.preventDefault(); saveToWatchlist(); }}>
              <label class="field" for="lookup-case-watchlist-name">Browser-local watchlist name<input id="lookup-case-watchlist-name" value={watchlistName} oninput={(event) => setWatchlistName(event.currentTarget.value)} maxlength="100" autocomplete="off" disabled={watchlistBusy}></label>
              <button class="btn small" type="submit" disabled={watchlistBusy || !watchlistName.trim()}>Save current observation</button>
            </form>
            <div class="recheck-row"><button class="btn small" type="button" onclick={recheckCase} disabled={actionBusy || watchlistBusy}>Recheck and refresh Case</button><span>Runs a new {lookupDepth === 'deep' ? 'Deep' : 'Fast'} Lookup for {lookupTarget}; any selected optional sources keep their current settings. The watchlist is unchanged until you save the new observation.</span></div>
            {#if watchlistStatus}<p class="case-status" role="status" aria-live="polite">{watchlistStatus}</p>{/if}
          </section>
        </div>
        <p class="case-hint">{record.notes.length} note{record.notes.length === 1 ? '' : 's'} · full status, tags, decisions, response actions, evidence comparison and closure remain in Monitor. Cases and local watchlists stay in this browser.</p>
      </div>
    {:else}
      <div class="case-body"><p class="case-hint">No case for {domain} yet.</p><button class="primary" onclick={createCase} disabled={actionBusy}>Create case</button></div>
    {/if}
    {#if caseStatus}<p class="case-status" role="status" aria-live="polite">{caseStatus}</p>{/if}
  </section>
{/if}

{#if outreach || recipientResolution.recipients.length}
  <section class="response evidence-card card">
    <div class="section-head"><div><p class="eyebrow">Respond</p><h4>Published routes and reviewed drafts</h4></div></div>
    <p class="card-note">Nothing is sent automatically. Verify the recipient, evidence and message before recording a route in the case.</p>
    <div class="response-actions">
      {#if outreach}<article><strong>Acquisition outreach</strong><span>{outreach.email}</span><div><a class="btn small" href={outreach.mailto}>Open email draft</a><button class="btn small" onclick={() => copyDraft(outreach.body, 'outreach draft')}>Copy text</button></div></article>{/if}
      {#each recipientResolution.recipients as route}
        <article>
          <strong>{abuseRecipientKindLabel(route.kind)}</strong>
          <span>{route.contact}</span>
          <p><b>{route.channel}</b> · source: {route.source}</p>
          {#if route.limitations.length}<ul>{#each route.limitations.slice(0, 3) as limitation}<li>{limitation}</li>{/each}</ul>{/if}
          <div>
            <button class="btn small" type="button" onclick={() => void recordRecipient(route)} disabled={!record || actionBusy}>Record in case</button>
            {#if record}<a class="btn small" href={caseWorkspaceHref(record.id, true)}>Review response packet</a>{/if}
          </div>
        </article>
      {/each}
    </div>
    <details class="coverage">
      <summary>Response-route coverage</summary>
      <ul>
        {#each recipientResolution.coverage as item}
          <li><strong>{abuseRecipientKindLabel(item.kind)}</strong><span class={`coverage-state state-${item.state}`}>{item.state.replaceAll('_', ' ')}</span><p>{item.detail}</p></li>
        {/each}
      </ul>
      {#each recipientResolution.limitations as limitation}<p>{limitation}</p>{/each}
    </details>
    {#if draftStatus}<p class="draft-status" aria-live="polite">{draftStatus}</p>{/if}
  </section>
{/if}

<style>
  .evidence-card{padding:var(--card-pad)}
  .card-note{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .case-badges{display:flex;flex-wrap:wrap;gap:6px}
  .badge.status-escalated,.badge.disposition-confirmed_abuse{color:var(--danger);border-color:rgb(var(--danger-rgb) / .4)}
  .badge.status-resolved,.badge.disposition-false_positive,.badge.disposition-expected{color:var(--accent2)}
  .badge.disposition-suspicious{color:var(--amber)}
  .case-body{margin-top:12px}
  .note-edit textarea{width:100%;margin-top:6px;font-size:var(--text-sm)}
  .case-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:10px}
  .case-actions a{color:var(--accent);font:600 var(--text-xs) var(--mono)}
  .case-body>.primary{margin-top:10px}
  .case-hint,.case-status{margin:10px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .case-status,.draft-status{color:var(--accent)}
  .case-tools{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}
  .case-tool{display:grid;align-content:start;gap:10px;min-width:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .case-tool>div>strong{font:700 var(--text-xs) var(--mono)}
  .case-tool>div>p,.field-note,.linked-watchlists,.recheck-row span{margin:4px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .classification-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .classification-fields select,.watchlist-form input{width:100%;margin-top:5px}
  .case-tool>.btn{justify-self:start}
  .watchlist-form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end}
  .linked-watchlists{overflow-wrap:anywhere}
  .linked-watchlists a{color:var(--accent);font-weight:650}
  .monitoring-warning{margin:0;padding:8px 10px;border:1px dotted var(--amber);border-radius:var(--radius-sm);color:var(--text);background:rgb(var(--amber-rgb) / .08);font-size:var(--text-2xs);line-height:1.5}
  .warn-text{color:var(--amber)}
  .recheck-row{display:flex;align-items:start;gap:8px}
  .recheck-row .btn{flex:0 0 auto}
  .response-actions{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px;margin-top:12px}
  .response-actions article{padding:13px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .response-actions strong,.response-actions span{display:block}
  .response-actions strong{font-size:var(--text-sm)}
  .response-actions span{margin-top:5px;color:var(--muted);font-size:var(--text-xs);overflow-wrap:anywhere}
  .response-actions article>div{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px}
  .response-actions p{margin:7px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .response-actions b{color:var(--text);font-weight:600;text-transform:capitalize}
  .response-actions ul{display:grid;gap:4px;margin:8px 0 0;padding-left:18px;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .coverage{margin-top:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .coverage summary{padding:10px 12px;cursor:pointer;font:650 var(--text-xs) var(--mono)}
  .coverage>ul{display:grid;gap:6px;margin:0;padding:0 12px 10px;list-style:none}
  .coverage li{display:grid;grid-template-columns:minmax(110px,.3fr) auto minmax(0,1fr);gap:8px;align-items:center;padding:7px;border-top:1px solid var(--border)}
  .coverage li>strong{font-size:var(--text-xs)}
  .coverage li>p,.coverage>p{margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .coverage>p{padding:0 12px 8px}
  .coverage-state{padding:3px 6px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font:650 var(--text-2xs) var(--mono);white-space:nowrap}
  .coverage-state.state-found{color:var(--text);border-color:var(--border-strong)}
  .coverage-state.state-not_collected,.coverage-state.state-unavailable{border-color:var(--muted);border-style:dotted;color:var(--muted)}
  .draft-status{margin:10px 0 0;font-size:var(--text-xs)}
  @media(max-width:800px){.case-tools{grid-template-columns:1fr}}
  @media(max-width:700px){.coverage li{grid-template-columns:1fr auto}.coverage li>p{grid-column:1/-1}.classification-fields,.watchlist-form{grid-template-columns:1fr}.watchlist-form .btn{justify-self:start}.recheck-row{display:grid}}
</style>
