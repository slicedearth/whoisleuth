<script lang="ts">
  import CaseRelationships from '$lib/components/CaseRelationships.svelte';
  import EvidenceTimeline from '$lib/components/EvidenceTimeline.svelte';
  import CaseReportExport from '$lib/components/CaseReportExport.svelte';
  import {
    CASE_DISPOSITIONS,
    CASE_STATUSES,
    dispositionLabel,
    sourceLabel,
    statusLabel,
    type CaseRecord,
  } from '$lib/cases';

  let {
    records,
    allRecords,
    expandedId,
    tagDraft,
    setTagDraft,
    noteDraft,
    setNoteDraft,
    expand,
    setStatus,
    setDisposition,
    saveTags,
    addNote,
    removeCase,
    setMessage,
    formatDate,
  }: {
    records: CaseRecord[];
    allRecords: CaseRecord[];
    expandedId: string;
    tagDraft: string;
    setTagDraft: (value: string) => void;
    noteDraft: string;
    setNoteDraft: (value: string) => void;
    expand: (record: CaseRecord) => void;
    setStatus: (record: CaseRecord, value: string) => void;
    setDisposition: (record: CaseRecord, value: string) => void;
    saveTags: (record: CaseRecord) => void;
    addNote: (record: CaseRecord) => void;
    removeCase: (record: CaseRecord) => void;
    setMessage: (value: string) => void;
    formatDate: (value: string) => string;
  } = $props();
</script>

<section class="case-list">
  {#each records as record (record.id)}
    <article class="case card" class:open={expandedId === record.id}>
      <button class="case-head" aria-expanded={expandedId === record.id} aria-controls={`case-body-${record.id}`} onclick={() => expand(record)}>
        <span class="case-domain"><strong>{record.domain}</strong>{#if record.notes.length}<small>{record.notes.length} note{record.notes.length === 1 ? '' : 's'}</small>{/if}</span>
        <span class="badges"><span class={`badge status-${record.status}`}>{statusLabel(record.status)}</span><span class={`badge disposition-${record.disposition}`}>{dispositionLabel(record.disposition)}</span></span>
        <span class="updated">{formatDate(record.updatedAt)}</span>
      </button>
      {#if record.tags.length}<div class="tag-row">{#each record.tags as tag}<span class="tag">{tag}</span>{/each}</div>{/if}
      {#if expandedId === record.id}
        <div class="case-body" id={`case-body-${record.id}`}>
          <div class="field-grid">
            <label class="field">Status<select value={record.status} onchange={(event) => setStatus(record, event.currentTarget.value)}>{#each CASE_STATUSES as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
            <label class="field">Disposition<select value={record.disposition} onchange={(event) => setDisposition(record, event.currentTarget.value)}>{#each CASE_DISPOSITIONS as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
          </div>
          <form class="tags-edit" onsubmit={(event) => { event.preventDefault(); saveTags(record); }}>
            <label class="field" for={`tags-${record.id}`}>Tags <small>comma separated</small></label>
            <div><input id={`tags-${record.id}`} value={tagDraft} oninput={(event) => setTagDraft(event.currentTarget.value)} placeholder="phishing, active-campaign" autocomplete="off"><button class="btn" type="submit">Save tags</button></div>
          </form>
          <form class="note-edit" onsubmit={(event) => { event.preventDefault(); addNote(record); }}>
            <label class="field" for={`note-${record.id}`}>Add note</label>
            <textarea id={`note-${record.id}`} value={noteDraft} oninput={(event) => setNoteDraft(event.currentTarget.value)} rows="2" placeholder="Observed behaviour, evidence, decisions…"></textarea>
            <button class="btn" type="submit" disabled={!noteDraft.trim()}>Add note</button>
          </form>
          {#if record.notes.length}<ol class="notes">{#each [...record.notes].reverse() as note}<li><time datetime={note.createdAt}>{formatDate(note.createdAt)}</time><p>{note.body}</p></li>{/each}</ol>{/if}
          <CaseRelationships {record} records={allRecords} onselect={expand} />
          {#key record.id}<EvidenceTimeline {record} />{/key}
          {#key record.id}<CaseReportExport {record} onmessage={setMessage} />{/key}
          <div class="case-meta"><span>Source: {sourceLabel(record.source)}</span><span>Opened {formatDate(record.createdAt)}</span></div>
          <div class="case-actions"><a class="btn" href={`/lookup?q=${encodeURIComponent(record.domain)}`}>Look up domain</a><button class="btn danger" onclick={() => removeCase(record)}>Delete case</button></div>
        </div>
      {/if}
    </article>
  {/each}
  {#if !records.length}<p class="count">No cases match the current filters.</p>{/if}
</section>

<style>
  .count{margin:12px 2px;color:var(--muted);font-size:var(--text-xs)}
  .case-list{display:grid;gap:10px}
  .case{padding:0;overflow:hidden}
  .case.open{border-color:var(--accent)}
  .case-head{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:12px;align-items:center;width:100%;padding:15px 18px;border:0;background:none;text-align:left;cursor:pointer}
  .case-head:hover .case-domain strong{color:var(--accent)}
  .case-domain{display:flex;flex-direction:column;gap:3px;min-width:0}
  .case-domain strong{overflow-wrap:anywhere;font:700 var(--text-md) var(--mono)}
  .case-domain small,.updated{color:var(--muted);font-size:var(--text-2xs)}
  .badges{display:flex;flex-wrap:wrap;gap:6px}
  .badge.status-escalated{color:var(--danger);border-color:rgba(255,107,107,.4)}
  .badge.status-resolved{color:var(--accent2)}
  .badge.disposition-confirmed_abuse{color:var(--danger);border-color:rgba(255,107,107,.4)}
  .badge.disposition-suspicious{color:var(--amber)}
  .badge.disposition-false_positive,.badge.disposition-expected{color:var(--accent2)}
  .tag-row{display:flex;flex-wrap:wrap;gap:6px;padding:0 18px 14px}
  .tag{padding:3px 8px;border:1px solid var(--border);border-radius:6px;color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  .case-body{display:grid;gap:14px;padding:16px 18px;border-top:1px solid var(--border);background:var(--panel)}
  .field-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .tags-edit>div{display:flex;gap:8px;margin-top:6px}
  .tags-edit input{flex:1;min-height:var(--control-h)}
  .note-edit textarea{width:100%;margin-top:6px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .note-edit button{margin-top:8px}
  .notes{display:grid;gap:8px;margin:0;padding:0;list-style:none}
  .notes li{display:grid;gap:5px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .notes time{color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  .notes p{margin:0;font-size:var(--text-sm);line-height:1.55;overflow-wrap:anywhere;white-space:pre-wrap}
  .case-meta{display:flex;flex-wrap:wrap;gap:14px;color:var(--muted);font-size:var(--text-2xs)}
  .case-actions{display:flex;flex-wrap:wrap;gap:8px}
  @media(max-width:800px){
    .case-head{grid-template-columns:1fr;gap:7px}
    .updated{order:3}
    .field-grid{grid-template-columns:1fr}
  }
</style>
