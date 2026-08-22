<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import type {
    AbuseRecipientResolution,
    ResolvedAbuseRecipient,
  } from '$lib/analysis/abuse-recipient-resolver.ts';

  type DraftAction = { email: string; body: string; mailto: string };

  let { domain, record, note, caseStatus, draftStatus, outreach, recipientResolution, setNote, createCase, addNote, recordRecipient, copyDraft, statusLabel, dispositionLabel, actionBusy = false }: {
    domain: string;
    record: CaseRecord | null;
    note: string;
    caseStatus: string;
    draftStatus: string;
    outreach: DraftAction | null;
    recipientResolution: AbuseRecipientResolution;
    setNote: (value: string) => void;
    createCase: () => void;
    addNote: () => void;
    recordRecipient: (route: ResolvedAbuseRecipient) => void | Promise<void>;
    copyDraft: (text: string, label: string) => void | Promise<void>;
    statusLabel: (value: CaseRecord['status']) => string;
    dispositionLabel: (value: CaseRecord['disposition']) => string;
    actionBusy?: boolean;
  } = $props();

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
        <p class="case-hint">{record.notes.length} note{record.notes.length === 1 ? '' : 's'} · manage status, disposition, and tags in Monitor. Cases are stored only in this browser.</p>
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
          <strong>{route.kind.replaceAll('_', ' ')} route</strong>
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
          <li><strong>{item.kind.replaceAll('_', ' ')}</strong><span class={`coverage-state state-${item.state}`}>{item.state.replaceAll('_', ' ')}</span><p>{item.detail}</p></li>
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
  .coverage li>strong{font-size:var(--text-xs);text-transform:capitalize}
  .coverage li>p,.coverage>p{margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .coverage>p{padding:0 12px 8px}
  .coverage-state{padding:3px 6px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font:650 var(--text-2xs) var(--mono);white-space:nowrap}
  .coverage-state.state-found{color:var(--text);border-color:var(--border-strong)}
  .coverage-state.state-not_collected,.coverage-state.state-unavailable{border-color:var(--muted);border-style:dotted;color:var(--muted)}
  .draft-status{margin:10px 0 0;font-size:var(--text-xs)}
  @media(max-width:700px){.coverage li{grid-template-columns:1fr auto}.coverage li>p{grid-column:1/-1}}
</style>
