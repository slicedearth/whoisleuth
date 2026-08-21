<script lang="ts">
  import { tick } from 'svelte';
  import CaseRelationships from '$lib/components/CaseRelationships.svelte';
  import EvidenceTimeline from '$lib/components/EvidenceTimeline.svelte';
  import CaseReportExport from '$lib/components/CaseReportExport.svelte';
  import CaseResponseWorkspace from '$lib/components/CaseResponseWorkspace.svelte';
  import CaseBrandAssociations from '$lib/components/CaseBrandAssociations.svelte';
  import Pagination from '$lib/components/Pagination.svelte';
  import type { BrandProfile } from '$lib/brand-profiles';
  import {
    CASE_DISPOSITIONS,
    CASE_REVIEW_REASONS,
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
    pendingNoteCaseIds,
    calibrationCaseIds,
    toggleCalibrationCase,
    expand,
    setStatus,
    setDisposition,
    setReviewReason,
    addBrandProfileAssociation,
    removeBrandProfileAssociation,
    saveTags,
    addNote,
    removeCase,
    refreshCases,
    installCommittedCaseSnapshot,
    setMessage,
    formatDate,
    currentPage,
    pageCount,
    setPage,
    brandProfiles,
    brandProfilesUnavailable,
  }: {
    records: CaseRecord[];
    allRecords: CaseRecord[];
    expandedId: string;
    tagDraft: string;
    setTagDraft: (value: string) => void;
    noteDraft: string;
    setNoteDraft: (value: string) => void;
    pendingNoteCaseIds: string[];
    calibrationCaseIds: string[];
    toggleCalibrationCase: (record: CaseRecord, selected: boolean) => void;
    expand: (record: CaseRecord) => void;
    setStatus: (record: CaseRecord, value: string) => void;
    setDisposition: (record: CaseRecord, value: string) => void;
    setReviewReason: (record: CaseRecord, value: string) => void;
    addBrandProfileAssociation: (record: CaseRecord, id: string) => boolean | Promise<boolean>;
    removeBrandProfileAssociation: (record: CaseRecord, id: string) => boolean | Promise<boolean>;
    saveTags: (record: CaseRecord) => void;
    addNote: (record: CaseRecord) => void;
    removeCase: (record: CaseRecord) => void | Promise<void>;
    refreshCases: () => void | Promise<void>;
    installCommittedCaseSnapshot: (cases: CaseRecord[]) => void;
    setMessage: (value: string) => void;
    formatDate: (value: string) => string;
    currentPage: number;
    pageCount: number;
    setPage: (value: number) => void;
    brandProfiles: BrandProfile[];
    brandProfilesUnavailable: boolean;
  } = $props();

  function focusMovedAway(origin: Element | null): boolean {
    const active = document.activeElement;
    return active instanceof HTMLElement
      && active !== origin
      && active !== document.body
      && active.isConnected;
  }

  async function removeAndFocus(record: CaseRecord) {
    const origin = document.activeElement;
    const owner = origin instanceof HTMLElement
      ? origin.closest<HTMLElement>('#monitor-view-panel')
      : null;
    const previousIndex = records.findIndex((item) => item.id === record.id);
    const previousPage = currentPage;
    await removeCase(record);
    await tick();
    if (!owner?.isConnected || focusMovedAway(origin)) return;
    if (origin instanceof HTMLElement && origin.isConnected) {
      origin.focus();
      return;
    }
    const next = currentPage < previousPage
      ? records.at(-1)
      : records[Math.min(Math.max(0, previousIndex), records.length - 1)];
    const candidates = [
      next ? document.getElementById(`case-head-${next.id}`) : null,
      document.getElementById('new-case'),
      document.getElementById('tab-cases'),
    ];
    const target = candidates.find((candidate) => candidate instanceof HTMLElement);
    if (target instanceof HTMLElement) target.focus();
  }
</script>

<section class="case-list">
  {#each records as record (record.id)}
    <article class="case card" class:open={expandedId === record.id}>
      <label class="calibration-select" class:unavailable={record.disposition === 'unreviewed' || !record.evidenceHistory.length}>
        <input
          type="checkbox"
          checked={calibrationCaseIds.includes(record.id)}
          disabled={record.disposition === 'unreviewed' || !record.evidenceHistory.length}
          onchange={(event) => toggleCalibrationCase(record, event.currentTarget.checked)}
        >
        Include in offline Risk calibration export
      </label>
      <button id={`case-head-${record.id}`} class="case-head" aria-expanded={expandedId === record.id} aria-controls={`case-body-${record.id}`} onclick={() => expand(record)}>
        <span class="case-domain"><strong>{record.domain}</strong>{#if record.notes.length}<small>{record.notes.length} note{record.notes.length === 1 ? '' : 's'}</small>{/if}</span>
        <span class="badges"><span class={`badge status-${record.status}`}>{statusLabel(record.status)}</span><span class={`badge disposition-${record.disposition}`}>{dispositionLabel(record.disposition)}</span></span>
        <span class="updated">{formatDate(record.updatedAt)}</span>
      </button>
      {#if record.tags.length}<div class="tag-row">{#each record.tags as tag}<span class="tag">{tag}</span>{/each}</div>{/if}
      {#if expandedId === record.id}
        <div class="case-body" id={`case-body-${record.id}`}>
          <div class="field-grid">
            <label class="field">Status<select value={record.status} onchange={(event) => setStatus(record, event.currentTarget.value)}>{#each CASE_STATUSES.filter((option) => option.value !== 'resolved' || record.status === 'resolved') as option}<option value={option.value}>{option.label}</option>{/each}</select><small>Use the independent-remediation section for a new deliberate closure.</small></label>
            <label class="field">Disposition<select value={record.disposition} onchange={(event) => setDisposition(record, event.currentTarget.value)}>{#each CASE_DISPOSITIONS as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
            <label class="field">Review reason<select value={record.reviewReasonCode ?? ''} onchange={(event) => setReviewReason(record, event.currentTarget.value)}>{#each CASE_REVIEW_REASONS as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
          </div>
          <CaseBrandAssociations {record} profiles={brandProfiles} profilesUnavailable={brandProfilesUnavailable} addAssociation={addBrandProfileAssociation} removeAssociation={removeBrandProfileAssociation} />
          <form class="tags-edit" onsubmit={(event) => { event.preventDefault(); saveTags(record); }}>
            <label class="field" for={`tags-${record.id}`}>Tags <small>comma separated</small></label>
            <div><input id={`tags-${record.id}`} value={tagDraft} oninput={(event) => setTagDraft(event.currentTarget.value)} placeholder="phishing, active-campaign" autocomplete="off"><button class="btn" type="submit">Save tags</button></div>
          </form>
          <form class="note-edit" onsubmit={(event) => { event.preventDefault(); addNote(record); }}>
            <label class="field" for={`note-${record.id}`}>Add note</label>
            <textarea id={`note-${record.id}`} value={noteDraft} disabled={pendingNoteCaseIds.includes(record.id)} oninput={(event) => setNoteDraft(event.currentTarget.value)} rows="2" placeholder="Observed behaviour, evidence, decisions…"></textarea>
            <button class="btn" type="submit" disabled={!noteDraft.trim() || pendingNoteCaseIds.includes(record.id)}>{pendingNoteCaseIds.includes(record.id) ? 'Adding…' : 'Add note'}</button>
          </form>
          {#if record.notes.length}<ol class="notes">{#each [...record.notes].reverse() as note}<li><time datetime={note.createdAt}>{formatDate(note.createdAt)}</time><p>{note.body}</p></li>{/each}</ol>{/if}
          <CaseRelationships {record} records={allRecords} onselect={expand} />
          {#key record.id}<EvidenceTimeline {record} />{/key}
          {#key record.id}<CaseResponseWorkspace {record} onsaved={refreshCases} oncommitted={installCommittedCaseSnapshot} onmessage={setMessage} />{/key}
          {#key record.id}<CaseReportExport {record} onmessage={setMessage} />{/key}
          <div class="case-meta"><span>Source: {sourceLabel(record.source)}</span><span>Opened {formatDate(record.createdAt)}</span></div>
          <div class="case-actions"><a class="btn" href={`/lookup?q=${encodeURIComponent(record.domain)}`}>Look up domain</a><button id={`case-delete-${record.id}`} class="btn danger" onclick={() => void removeAndFocus(record)}>Delete case</button></div>
        </div>
      {/if}
    </article>
  {/each}
  {#if !records.length}<p class="count">No cases match the current filters.</p>{/if}
  <Pagination {currentPage} {pageCount} {setPage} ariaLabel="Case pages" />
</section>

<style>
  .count{margin:12px 2px;color:var(--muted);font-size:var(--text-xs)}
  .case-list{display:grid;gap:10px}
  .case{padding:0;overflow:hidden}
  .case.open{border-color:var(--accent)}
  .calibration-select{display:flex;align-items:center;gap:8px;padding:9px 18px 0;color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  .calibration-select input{width:16px;height:16px}
  .calibration-select.unavailable{opacity:.6}
  .case-head{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:12px;align-items:center;width:100%;padding:15px 18px;border:0;background:none;text-align:left;cursor:pointer}
  .case-head:hover .case-domain strong{color:var(--accent)}
  .case-domain{display:flex;flex-direction:column;gap:3px;min-width:0}
  .case-domain strong{overflow-wrap:anywhere;font:700 var(--text-md) var(--mono)}
  .case-domain small,.updated{color:var(--muted);font-size:var(--text-2xs)}
  .badges{display:flex;flex-wrap:wrap;gap:6px}
  .badge.status-escalated{color:var(--danger);border-color:rgb(var(--danger-rgb) / .4)}
  .badge.status-resolved{color:var(--accent2)}
  .badge.disposition-confirmed_abuse{color:var(--danger);border-color:rgb(var(--danger-rgb) / .4)}
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
