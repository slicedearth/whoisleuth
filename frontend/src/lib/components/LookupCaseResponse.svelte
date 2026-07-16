<script lang="ts">
  import type { CaseRecord } from '$lib/cases';

  type DraftAction = { email: string; body: string; mailto: string };

  let { domain, record, note, caseStatus, draftStatus, outreach, abuse, setNote, createCase, addNote, copyDraft, statusLabel, dispositionLabel }: {
    domain: string;
    record: CaseRecord | null;
    note: string;
    caseStatus: string;
    draftStatus: string;
    outreach: DraftAction | null;
    abuse: DraftAction | null;
    setNote: (value: string) => void;
    createCase: () => void;
    addNote: () => void;
    copyDraft: (text: string, label: string) => void | Promise<void>;
    statusLabel: (value: CaseRecord['status']) => string;
    dispositionLabel: (value: CaseRecord['disposition']) => string;
  } = $props();
</script>

{#if domain}
  <section class="case-card evidence-card card">
    <div class="case-intro section-head"><div><p class="eyebrow">Investigation</p><h4>Analyst case</h4></div>{#if record}<div class="case-badges"><span class={`badge status-${record.status}`}>{statusLabel(record.status)}</span><span class={`badge disposition-${record.disposition}`}>{dispositionLabel(record.disposition)}</span></div>{/if}</div>
    {#if record}
      <div class="case-body">
        <form class="note-edit" onsubmit={(event) => { event.preventDefault(); addNote(); }}>
          <label class="field" for="case-note">Add note</label>
          <textarea id="case-note" value={note} oninput={(event) => setNote(event.currentTarget.value)} rows="2" placeholder="Observed behaviour, evidence, decisions…"></textarea>
          <div class="case-actions"><button class="btn" type="submit" disabled={!note.trim()}>Add note</button><a href={`/monitor?case=${encodeURIComponent(record.id)}`}>Open in Monitor →</a></div>
        </form>
        <p class="case-hint">{record.notes.length} note{record.notes.length === 1 ? '' : 's'} · manage status, disposition, and tags in Monitor. Cases are stored only in this browser.</p>
      </div>
    {:else}
      <div class="case-body"><p class="case-hint">No case for {domain} yet.</p><button class="primary" onclick={createCase}>Create case</button></div>
    {/if}
    {#if caseStatus}<p class="case-status" role="status" aria-live="polite">{caseStatus}</p>{/if}
  </section>
{/if}

{#if outreach || abuse}
  <section class="response evidence-card card">
    <div class="section-head"><div><p class="eyebrow">Respond</p><h4>Human-reviewed drafts</h4></div></div>
    <p class="card-note">Nothing is sent automatically. Review and edit every message before sending it.</p>
    <div class="response-actions">
      {#if outreach}<article><strong>Acquisition outreach</strong><span>{outreach.email}</span><div><a class="btn small" href={outreach.mailto}>Open email draft</a><button class="btn small" onclick={() => copyDraft(outreach.body, 'outreach draft')}>Copy text</button></div></article>{/if}
      {#if abuse}<article><strong>Abuse report</strong><span>{abuse.email}</span><div><a class="btn small danger" href={abuse.mailto}>Open report draft</a><button class="btn small" onclick={() => copyDraft(abuse.body, 'abuse report')}>Copy text</button></div></article>{/if}
    </div>
    {#if draftStatus}<p class="draft-status" aria-live="polite">{draftStatus}</p>{/if}
  </section>
{/if}

<style>
  .evidence-card{padding:var(--card-pad)}
  .card-note{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .case-badges{display:flex;flex-wrap:wrap;gap:6px}
  .badge.status-escalated,.badge.disposition-confirmed_abuse{color:var(--danger);border-color:rgba(255,107,107,.4)}
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
  .draft-status{margin:10px 0 0;font-size:var(--text-xs)}
</style>
