<script lang="ts">
  import {
    CASE_DISPOSITIONS,
    isReviewedCaseDisposition,
    CASE_REVIEW_REASONS,
    caseInvestigationContext,
    parseIncidentUrlContext,
    type CaseRecord,
  } from '$lib/cases';
  import type {
    AbuseRecipientResolution,
    ResolvedAbuseRecipient,
  } from '$lib/analysis/abuse-recipient-resolver.ts';
  import { abuseRecipientKindLabel } from '$lib/analysis/abuse-recipient-resolver.ts';
  import type { CheckpointFact } from '$lib/analysis/case-evidence-checkpoint.ts';
  import type { LookupConclusionEvidenceSelection, LookupRecheckComparison, LookupRecheckOutcomeInput } from '$lib/controllers/lookup-case-controller.ts';
  import { clearsLocalMutationDraft, type LocalMutationOutcome } from '$lib/local-mutation-outcome.ts';
  import { handlesLocalLink } from '$lib/link-activation';
  import { caseWorkspaceHref } from '$lib/analysis/case-response-stage.ts';
  import CasePicker from './CasePicker.svelte';
  import LookupRecheckReview from './LookupRecheckReview.svelte';
  import { MAX_CASE_OBJECTIVE_LENGTH } from '../../../../packages/contracts/case-portability.mts';

  type DraftAction = { email: string; body: string; mailto: string };

  let {
    domain,
    lookupTarget,
    lookupDepth,
    task,
    incidentUrl,
    recheckComparison,
    record,
    cases = [],
    selectCase,
    createIncident,
    oncaseopen,
    note,
    caseStatus,
    caseSourceState,
    retryCaseRead,
    caseDisposition,
    caseReviewReason,
    checkpointFacts,
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
    recordConclusion,
    recordInvestigationContext,
    recordRecheckOutcome,
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
    task: 'general' | 'acquisition' | 'brand' | 'incident' | 'owned';
    incidentUrl: string;
    recheckComparison: LookupRecheckComparison | null;
    record: CaseRecord | null;
    cases?: CaseRecord[];
    selectCase: (id: string) => void;
    createIncident: (title: string) => Promise<LocalMutationOutcome>;
    oncaseopen: () => void;
    note: string;
    caseStatus: string;
    caseSourceState: 'loading' | 'ready' | 'unavailable';
    retryCaseRead: () => void | Promise<void>;
    caseDisposition: string;
    caseReviewReason: string;
    checkpointFacts: readonly CheckpointFact[];
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
    recordConclusion: (
      rationale: string,
      selections: readonly LookupConclusionEvidenceSelection[],
    ) => Promise<LocalMutationOutcome>;
    recordInvestigationContext: (objective: string, retainExactUrl: boolean) => Promise<LocalMutationOutcome>;
    recordRecheckOutcome: (input: LookupRecheckOutcomeInput) => Promise<LocalMutationOutcome>;
    saveToWatchlist: () => void;
    recheckCase: () => void;
    recordRecipient: (route: ResolvedAbuseRecipient) => void | Promise<void>;
    copyDraft: (text: string, label: string) => void | Promise<void>;
    statusLabel: (value: CaseRecord['status']) => string;
    dispositionLabel: (value: CaseRecord['disposition']) => string;
    actionBusy?: boolean;
    watchlistBusy?: boolean;
  } = $props();

  let conclusionRationale = $state('');
  let conclusionEvidence = $state<LookupConclusionEvidenceSelection[]>([]);
  let contextObjective = $state('');
  let retainExactIncidentUrl = $state(false);
  let appliedContextKey = $state('');
  let incidentTitle = $state('');
  let recheckDraftEdited = $state(false);
  const retainedContext = $derived(caseInvestigationContext(record));
  const currentIncidentUrl = $derived(incidentUrl || retainedContext?.incidentUrl || '');
  const incidentUrlDetails = $derived(parseIncidentUrlContext(currentIncidentUrl));
  const selectableConclusionFacts = $derived(checkpointFacts.filter((fact) => fact.value !== null && fact.observedAt !== null));
  const conclusionIncomplete = $derived(
    !isReviewedCaseDisposition(caseDisposition)
      || !caseReviewReason
      || !conclusionRationale.trim()
      || !conclusionEvidence.some((item) => item.stance === 'supports'),
  );

  $effect(() => {
    const key = record && retainedContext ? `${record.id}:${retainedContext.updatedAt}` : record?.id ?? '';
    if (!record || appliedContextKey === key) return;
    contextObjective = retainedContext?.objective ?? '';
    retainExactIncidentUrl = retainedContext?.urlRetention === 'exact';
    appliedContextKey = key;
  });

  function confirmCaseChange(): boolean {
    const edited = Boolean(note || conclusionRationale || conclusionEvidence.length || recheckDraftEdited
      || contextObjective !== (retainedContext?.objective ?? '') || retainExactIncidentUrl !== (retainedContext?.urlRetention === 'exact')
      || (record && (caseDisposition !== record.disposition || caseReviewReason !== (record.reviewReasonCode ?? ''))));
    return !edited || window.confirm('Change incident and discard unsaved Lookup Case form edits? Saved Case evidence and decisions will not change.');
  }
  function resetCaseForms() {
    setNote(''); conclusionRationale = ''; conclusionEvidence = [];
    contextObjective = ''; retainExactIncidentUrl = false; appliedContextKey = '';
    recheckDraftEdited = false;
  }
  function changeIncident(id: string): boolean {
    if (id === record?.id) return true;
    if (actionBusy || !confirmCaseChange()) return false;
    resetCaseForms(); selectCase(id); return true;
  }
  async function newIncident() {
    if (actionBusy || !incidentTitle.trim() || !confirmCaseChange()) return;
    if (clearsLocalMutationDraft(await createIncident(incidentTitle))) { incidentTitle = ''; resetCaseForms(); }
  }

  function startRecheck() {
    if (recheckDraftEdited && !window.confirm('Recheck and discard the unsaved outcome draft? Saved answers will not change.')) return;
    recheckDraftEdited = false;
    recheckCase();
  }

  function conclusionStance(field: string): LookupConclusionEvidenceSelection['stance'] {
    return conclusionEvidence.find((item) => item.field === field)?.stance ?? 'supports';
  }

  function toggleConclusionFact(field: string, selected: boolean) {
    conclusionEvidence = selected
      ? [...conclusionEvidence, { field, stance: 'supports' }]
      : conclusionEvidence.filter((item) => item.field !== field);
  }

  function setConclusionStance(field: string, stance: LookupConclusionEvidenceSelection['stance']) {
    conclusionEvidence = conclusionEvidence.map((item) => item.field === field ? { ...item, stance } : item);
  }

  async function submitConclusion() {
    if (conclusionIncomplete) return;
    if (clearsLocalMutationDraft(await recordConclusion(conclusionRationale, conclusionEvidence))) {
      conclusionRationale = '';
      conclusionEvidence = [];
    }
  }

  function routeHref(route: ResolvedAbuseRecipient): string | null {
    if (route.channel === 'email') return `mailto:${route.contact}`;
    if (route.channel === 'phone') return `tel:${route.contact.replace(/[^+\d]/gu, '')}`;
    try {
      const parsed = new URL(route.contact);
      return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
        ? parsed.toString()
        : null;
    } catch {
      return null;
    }
  }

</script>

{#if domain}
  <section class="case-card evidence-card card">
    <div class="case-intro section-head"><div><p class="eyebrow">Investigation</p><h4>Analyst case</h4></div>{#if record}<div class="case-badges"><span class={`badge status-${record.status}`}>{statusLabel(record.status)}</span><span class={`badge disposition-${record.disposition}`}>{dispositionLabel(record.disposition)}</span></div>{/if}</div>
    {#if caseSourceState === 'ready'}
      {#if cases.length > 1 || (cases.length && !record)}<CasePicker id="lookup-incident-case" records={cases} selectedId={record?.id ?? ''} disabled={actionBusy} select={changeIncident} />{/if}
      {#if record?.title}<p class="case-hint">{record.title}</p>{/if}
      <details class="case-tool"><summary>Create a separate incident</summary><form onsubmit={(event) => { event.preventDefault(); void newIncident(); }}>
        <label class="field" for="lookup-incident-title">Incident title<input id="lookup-incident-title" bind:value={incidentTitle} required maxlength={MAX_CASE_OBJECTIVE_LENGTH} disabled={actionBusy} autocomplete="off"></label>
        <button class="btn" type="submit" disabled={actionBusy || !incidentTitle.trim()}>Create incident with this evidence</button>
      </form></details>
    {/if}
    {#if caseSourceState === 'loading'}
      <p class="case-hint" role="status">Loading saved Case context…</p>
    {:else if caseSourceState === 'unavailable'}
      <div class="case-body"><p class="case-hint" role="alert">Saved Case context could not be read. Existing work may still be retained in this browser.</p><button class="btn" type="button" onclick={() => void retryCaseRead()}>Retry Case read</button></div>
    {:else if record}
      <div class="case-body">
        <form class="note-edit" onsubmit={(event) => { event.preventDefault(); addNote(); }}>
          <label class="field" for="case-note">Add note</label>
          <textarea id="case-note" value={note} oninput={(event) => setNote(event.currentTarget.value)} rows="2" placeholder="Observed behaviour, evidence, decisions…" disabled={actionBusy}></textarea>
          <div class="case-actions"><button class="btn" type="submit" disabled={actionBusy || !note.trim()}>Add note</button><button class="btn" type="button" onclick={createCase} disabled={actionBusy} aria-label={`Refresh retained Case evidence for ${domain}`}>Refresh case evidence</button><a href={caseWorkspaceHref(record.id)} onclick={(event) => { if (handlesLocalLink(event)) oncaseopen(); }}>Open Case</a></div>
        </form>
        <div class="case-tools independent-grid">
          {#if task === 'incident' && incidentUrlDetails}
            <form class="case-tool incident-context-tool" onsubmit={(event) => { event.preventDefault(); void recordInvestigationContext(contextObjective, retainExactIncidentUrl); }}>
              <div><strong>Incident context</strong><p>Lookup sent only <code>{incidentUrlDetails.hostname}</code>. Decide what this browser-local Case should retain before the URL can enter an export.</p></div>
              <p class="incident-url"><span>Current URL</span><code>{incidentUrlDetails.exactUrl}</code></p>
              {#if incidentUrlDetails.hasQuery || incidentUrlDetails.hasFragment}
                <p class="privacy-warning">This URL contains {incidentUrlDetails.hasQuery ? 'a query' : ''}{incidentUrlDetails.hasQuery && incidentUrlDetails.hasFragment ? ' and ' : ''}{incidentUrlDetails.hasFragment ? 'a fragment' : ''}. Review it for tokens, personal data or unnecessary identifiers before retaining the exact value.</p>
              {/if}
              <label class="field" for="lookup-case-objective">Investigation objective<textarea id="lookup-case-objective" bind:value={contextObjective} rows="2" maxlength="320" placeholder="Determine whether the observed page is impersonating the affected service and preserve the evidence needed for review." disabled={actionBusy}></textarea></label>
              <label class="choice retain-url"><input type="checkbox" bind:checked={retainExactIncidentUrl} disabled={actionBusy}><span><strong>Retain the exact URL in this Case and its exports</strong><small>If left clear, only the origin is retained. The exact URL remains transient in this Lookup view.</small></span></label>
              <button class="btn small" type="submit" disabled={actionBusy || !contextObjective.trim()}>Save Incident context</button>
            </form>
          {/if}
          <form class="case-tool conclusion-tool" onsubmit={(event) => { event.preventDefault(); void submitConclusion(); }}>
            <div><strong>Record conclusion</strong><p>Bind the analyst disposition and rationale to the exact normalised facts considered. Risk remains supporting context, not the conclusion.</p></div>
            <div class="classification-fields">
              <label class="field" for="lookup-case-disposition">Disposition<select id="lookup-case-disposition" value={caseDisposition} onchange={(event) => setCaseDisposition(event.currentTarget.value)} disabled={actionBusy}>{#each CASE_DISPOSITIONS as option}<option value={option.value}>{isReviewedCaseDisposition(option.value) ? option.label : 'Select a reviewed disposition'}</option>{/each}</select></label>
              <label class="field" for="lookup-case-review-reason">Review reason<select id="lookup-case-review-reason" value={caseReviewReason} onchange={(event) => setCaseReviewReason(event.currentTarget.value)} disabled={actionBusy || !isReviewedCaseDisposition(caseDisposition)}>{#each CASE_REVIEW_REASONS as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
            </div>
            <label class="field" for="lookup-case-conclusion-rationale">Rationale<textarea id="lookup-case-conclusion-rationale" bind:value={conclusionRationale} rows="3" maxlength="2000" placeholder="Explain what the evidence supports, what remains uncertain, and why this disposition is appropriate." disabled={actionBusy}></textarea></label>
            <details class="conclusion-evidence">
              <summary>Evidence considered <span>{conclusionEvidence.length} selected</span></summary>
              {#if selectableConclusionFacts.length}
                <div class="conclusion-facts">
                  {#each selectableConclusionFacts as fact (fact.field)}
                    {@const selected = conclusionEvidence.some((item) => item.field === fact.field)}
                    <div class:selected>
                      <label>
                        <input type="checkbox" checked={selected} onchange={(event) => toggleConclusionFact(fact.field, event.currentTarget.checked)} disabled={actionBusy}>
                        <span><strong>{fact.label}</strong><small>{fact.value}</small><small>{fact.source} · {fact.completeness}</small></span>
                      </label>
                      {#if selected}
                        <select aria-label={`Relationship of ${fact.label} to the conclusion`} value={conclusionStance(fact.field)} onchange={(event) => setConclusionStance(fact.field, event.currentTarget.value as LookupConclusionEvidenceSelection['stance'])} disabled={actionBusy}>
                          <option value="supports">Supports conclusion</option>
                          <option value="contradicts">Contradicts conclusion</option>
                          <option value="unresolved">Unresolved context</option>
                        </select>
                      {/if}
                    </div>
                  {/each}
                </div>
              {:else}
                <p class="field-note">No normalised fact is currently available to retain. This does not imply that evidence is absent.</p>
              {/if}
            </details>
            <button class="btn small" type="submit" disabled={actionBusy || conclusionIncomplete}>Record evidence-linked conclusion</button>
            {#if conclusionIncomplete}<p class="field-note">Choose a reviewed disposition and reason, provide a rationale, and mark at least one observed fact as supporting the conclusion.</p>{/if}
          </form>

          <section class="case-tool monitoring-tool" aria-labelledby="lookup-case-monitoring-title">
            <div><strong id="lookup-case-monitoring-title">Monitoring and recheck</strong><p>Keep a browser-local baseline, or deliberately recollect the displayed observation target with the current Lookup settings.</p></div>
            {#if watchlistSourceState === 'loading'}
              <p class="field-note" role="status">Checking browser-local watchlists…</p>
            {:else if watchlistSourceState === 'unavailable'}
              <p class="field-note warn-text">Browser-local watchlists could not be read. Existing membership is unknown and no empty state is inferred.</p>
            {:else if linkedWatchlistNames.length}
              <p class="linked-watchlists">Linked watchlist{linkedWatchlistNames.length === 1 ? '' : 's'}: {#each linkedWatchlistNames as name, index}<a href={`/monitor?view=watchlists&watchlist=${encodeURIComponent(name)}`}>{name}</a>{index < linkedWatchlistNames.length - 1 ? ', ' : ''}{/each}</p>
            {:else}
              <p class="field-note">This observation target is not in a readable browser-local watchlist.</p>
            {/if}
            {#if record.status === 'monitoring' && watchlistSourceState === 'ready' && !linkedWatchlistNames.length}
              <p class="monitoring-warning" role="note">This Case is marked Monitoring, but no readable watchlist currently contains {lookupTarget}. Add a local baseline or change its status in Cases.</p>
            {/if}
            <form class="watchlist-form" onsubmit={(event) => { event.preventDefault(); saveToWatchlist(); }}>
              <label class="field" for="lookup-case-watchlist-name">Browser-local watchlist name<input id="lookup-case-watchlist-name" value={watchlistName} oninput={(event) => setWatchlistName(event.currentTarget.value)} maxlength="100" autocomplete="off" disabled={watchlistBusy}></label>
              <button class="btn small" type="submit" disabled={watchlistBusy || !watchlistName.trim()}>Save current observation</button>
            </form>
            <div class="recheck-row"><button class="btn small" type="button" onclick={startRecheck} disabled={actionBusy || watchlistBusy}>Recheck and refresh Case</button><span>Runs a new {lookupDepth === 'deep' ? 'Deep' : 'Fast'} Lookup for {lookupTarget}; any selected optional sources keep their current settings. The watchlist is unchanged until you save the new observation.</span></div>
            {#if watchlistStatus}<p class="case-status" role="status" aria-live="polite">{watchlistStatus}</p>{/if}
          </section>
          {#if recheckComparison}
            <div class="recheck-workspace">
              {#key `${record.id}:${recheckComparison.observedAt}`}
                <LookupRecheckReview {record} comparison={recheckComparison} busy={actionBusy} save={recordRecheckOutcome} changed={edited => recheckDraftEdited = edited} />
              {/key}
            </div>
          {/if}
        </div>
        <p class="case-hint">{record.notes.length} note{record.notes.length === 1 ? '' : 's'} · Open Cases for the full evidence, assessment, response and history.</p>
      </div>
    {:else}
      <div class="case-body">{#if cases.length}<p class="case-hint">Choose an incident Case above to retain this evidence.</p>{:else}<p class="case-hint">No case for {domain} yet.</p><button class="primary" onclick={createCase} disabled={actionBusy}>Create case</button>{/if}</div>
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
          {#if route.officialSourceUrl}<p class="route-source"><a href={route.officialSourceUrl} target="_blank" rel="noreferrer">Review the official route source ↗</a></p>{/if}
          {#if route.reviewAfter}<p class="route-source">Source review due <time datetime={route.reviewAfter}>{route.reviewAfter}</time></p>{/if}
          <div>
            <button class="btn small" type="button" onclick={() => void recordRecipient(route)} disabled={!record || actionBusy}>Record in case</button>
            <button class="btn small" type="button" onclick={() => copyDraft(route.contact, `${abuseRecipientKindLabel(route.kind).toLowerCase()} destination`)}>Copy destination</button>
            {#if routeHref(route)}<a class="btn small" href={routeHref(route) ?? undefined} target={route.channel === 'url' ? '_blank' : undefined} rel={route.channel === 'url' ? 'noreferrer' : undefined}>Open {route.channel === 'email' ? 'email' : route.channel === 'phone' ? 'phone' : 'reporting route'}</a>{/if}
            {#if record}<a class="btn small" href={`${caseWorkspaceHref(record.id, 'response')}#case-response-${encodeURIComponent(record.id)}`} onclick={(event) => { if (handlesLocalLink(event)) oncaseopen(); }}>Review response packet</a>{/if}
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
  .recheck-workspace{grid-column:1/-1}
  .case-tool{display:grid;align-content:start;gap:10px;min-width:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .case-tool>div>strong{font:700 var(--text-xs) var(--mono)}
  .case-tool>div>p,.field-note,.linked-watchlists,.recheck-row span{margin:4px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .classification-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .classification-fields select,.watchlist-form input,.conclusion-tool textarea{width:100%;margin-top:5px}
  .incident-context-tool{grid-column:1/-1}.incident-context-tool textarea{width:100%;margin-top:5px}.incident-url{display:grid;gap:4px;margin:0}.incident-url span{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}.incident-url code{padding:7px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);font-size:var(--text-2xs);white-space:normal;overflow-wrap:anywhere}.privacy-warning{margin:0;padding:8px 10px;border-left:3px solid var(--amber);background:rgb(var(--amber-rgb) / .06);color:var(--muted);font-size:var(--text-2xs);line-height:1.45}.retain-url{display:flex;align-items:flex-start;gap:8px;cursor:pointer}.retain-url input{flex:0 0 auto;margin-top:2px}.retain-url span,.retain-url strong,.retain-url small{display:block;min-width:0}.retain-url strong{font-size:var(--text-xs)}.retain-url small{margin-top:2px;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .conclusion-evidence{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .conclusion-evidence summary{display:flex;justify-content:space-between;gap:8px;padding:9px 10px;cursor:pointer;font:650 var(--text-2xs) var(--mono)}
  .conclusion-evidence summary span{color:var(--muted)}
  .conclusion-facts{display:grid;gap:6px;padding:0 9px 9px}
  .conclusion-facts>div{display:grid;grid-template-columns:minmax(0,1fr) minmax(145px,.42fr);gap:8px;align-items:center;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  .conclusion-facts>div.selected{border-color:color-mix(in srgb,var(--accent) 45%,var(--border))}
  .conclusion-facts label{display:flex;align-items:flex-start;gap:8px;min-width:0;cursor:pointer}.conclusion-facts label>span,.conclusion-facts strong,.conclusion-facts small{display:block;min-width:0}.conclusion-facts input{flex:0 0 auto;margin-top:2px}.conclusion-facts strong{font-size:var(--text-xs)}.conclusion-facts small{margin-top:2px;color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}.conclusion-facts select{width:100%}
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
  .coverage-state.state-stale{color:var(--amber);border-color:var(--amber);border-style:dotted}
  .coverage-state.state-not_collected,.coverage-state.state-unavailable{border-color:var(--muted);border-style:dotted;color:var(--muted)}
  .draft-status{margin:10px 0 0;font-size:var(--text-xs)}
  @media(max-width:800px){.case-tools{grid-template-columns:1fr}}
  @media(max-width:700px){.coverage li{grid-template-columns:1fr auto}.coverage li>p{grid-column:1/-1}.classification-fields,.watchlist-form,.conclusion-facts>div{grid-template-columns:1fr}.watchlist-form .btn{justify-self:start}.recheck-row{display:grid}}
</style>
