<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { tick } from 'svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import CaseRelationships from '$lib/components/CaseRelationships.svelte';
  import EvidenceTimeline from '$lib/components/EvidenceTimeline.svelte';
  import CaseReportExport from '$lib/components/CaseReportExport.svelte';
  import CaseResponseWorkspace from '$lib/components/CaseResponseWorkspace.svelte';
  import CaseBrandAssociations from '$lib/components/CaseBrandAssociations.svelte';
  import { readCaseNavigationContext } from '$lib/console-workflow-state';
  import { handlesLocalLink } from '$lib/link-activation';
  import { restoreSubmittedFocus } from '$lib/controllers/submitted-draft';
  import { CASE_WORKSPACE_SECTIONS, caseWorkspaceHref, caseWorkspaceSection, type CaseWorkspaceSection } from '$lib/analysis/case-response-stage.ts';
  import type { BrandProfile } from '$lib/brand-profiles';
  import { CASE_DISPOSITIONS, CASE_REVIEW_REASONS, caseLookupTarget, caseNumber, caseStatusOptionsForDirectEdit, dispositionLabel, sourceLabel, statusLabel, type CaseRecord } from '$lib/cases';

  let {
    record, allRecords, tagDraft, setTagDraft, noteDraft, setNoteDraft, pendingNoteCaseIds,
    selectCase, returnToList, setStatus, setDisposition, setReviewReason,
    addBrandProfileAssociation, removeBrandProfileAssociation, saveTags, addNote, removeCase,
    refreshCases, installCommittedCaseSnapshot, setMessage, formatDate, brandProfiles, brandProfilesUnavailable,
  }: {
    record: CaseRecord;
    allRecords: CaseRecord[];
    tagDraft: string;
    setTagDraft: (value: string) => void;
    noteDraft: string;
    setNoteDraft: (value: string) => void;
    pendingNoteCaseIds: string[];
    selectCase: (record: CaseRecord) => void;
    returnToList: () => void | Promise<void>;
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
    brandProfiles: BrandProfile[];
    brandProfilesUnavailable: boolean;
  } = $props();
  const activeSection = $derived(caseWorkspaceSection(page.url));
  const returnContext = $derived(readCaseNavigationContext(record.id));
  const deepLinkTargetId = $derived(page.url.searchParams.get('response') === '1'
    ? `case-response-preflight-${record.id}`
    : page.url.hash.startsWith('#case-response-') ? page.url.hash.slice(1) : null);

  async function selectSection(section: CaseWorkspaceSection) {
    if (section !== activeSection) await goto(caseWorkspaceHref(record.id, section), { noScroll: true, keepFocus: true });
  }
  $effect(() => {
    const targetId = deepLinkTargetId;
    let current = true;
    void tick().then(() => {
      if (!current || !targetId) return;
      const target = document.getElementById(targetId);
      if (!target?.closest(`[data-case-detail]`)) return;
      if (target instanceof HTMLDetailsElement) target.open = true;
      const heading = target.querySelector<HTMLElement>(':scope > summary') ?? target;
      if (restoreSubmittedFocus(null, heading, target)) {
        heading.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
    });
    return () => { current = false; };
  });
</script>

<article class="case-detail" data-case-detail={record.id}>
  <div class="case-return">
    <a href="/cases" onclick={(event) => { if (handlesLocalLink(event)) { event.preventDefault(); void returnToList(); } }}>All Cases</a>
    {#if returnContext && returnContext.href !== '/cases'}<a href={returnContext.href}>Return to {returnContext.label}</a>{/if}
  </div>
  <div id={`case-head-${record.id}`} class="case-heading" tabindex="-1">
    <PageHeading eyebrow="Case" title={record.title || record.domain} description={record.title ? record.domain : ''} />
    <div class="case-identity">
      <span class={`badge status-${record.status}`}>{statusLabel(record.status)}</span>
      <span class={`badge disposition-${record.disposition}`}>{dispositionLabel(record.disposition)}</span>
      <span title={`Complete Case number: ${caseNumber(record.id)}`}>Case …{caseNumber(record.id).slice(-8)}</span>
      <span>Updated <time datetime={record.updatedAt}>{formatDate(record.updatedAt)}</time></span>
    </div>
  </div>
  <div class="case-actions">
    <a class="btn" href={`/lookup?q=${encodeURIComponent(caseLookupTarget(record))}&case=${encodeURIComponent(record.id)}`}>Look up {caseLookupTarget(record) === record.domain ? 'domain' : 'latest hostname'}</a>
    <a class="btn" href={`/monitor?view=inbox&queue=all&case-review=${encodeURIComponent(record.id)}`}>Review follow-up</a>
    <details class="case-more">
      <summary>Case options</summary>
      <div><span>Source: {sourceLabel(record.source)}</span><span>Opened {formatDate(record.createdAt)}</span><span class="complete-id">{caseNumber(record.id)}</span><button id={`case-delete-${record.id}`} class="btn danger" onclick={() => void removeCase(record)}>Delete case</button></div>
    </details>
  </div>
  <nav class="case-sections workspace-view-nav" aria-label="Case sections">
    {#each CASE_WORKSPACE_SECTIONS as section}
      <a href={caseWorkspaceHref(record.id, section.id)} aria-current={activeSection === section.id ? 'page' : undefined}
        onclick={(event) => { if (handlesLocalLink(event)) { event.preventDefault(); void selectSection(section.id); } }}>{section.label}</a>
    {/each}
  </nav>
  <CaseResponseWorkspace {record} onsaved={refreshCases} oncommitted={installCommittedCaseSnapshot} onmessage={setMessage}
    {activeSection} {selectSection} advancedInitially={page.url.searchParams.get('response') === '1' || page.url.hash.startsWith('#case-response-')}>
    {#snippet summary()}
      <details class="metadata-editor">
      <summary>Edit status, tags and Brand associations</summary>
      <div class="metadata-fields">
      <div class="field-grid">
        <label class="field">Status<select value={record.status} onchange={(event) => setStatus(record, event.currentTarget.value)}>{#each caseStatusOptionsForDirectEdit(record.status) as option}<option value={option.value}>{option.label}</option>{/each}</select><small>Record a new deliberate closure in Response.</small></label>
        <label class="field">Disposition<select value={record.disposition} onchange={(event) => setDisposition(record, event.currentTarget.value)}>{#each CASE_DISPOSITIONS as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
        <label class="field">Review reason<select value={record.reviewReasonCode ?? ''} onchange={(event) => setReviewReason(record, event.currentTarget.value)}>{#each CASE_REVIEW_REASONS as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
      </div>
      <CaseBrandAssociations {record} profiles={brandProfiles} profilesUnavailable={brandProfilesUnavailable} addAssociation={addBrandProfileAssociation} removeAssociation={removeBrandProfileAssociation} />
      <form class="tags-edit" onsubmit={(event) => { event.preventDefault(); saveTags(record); }}>
        <label class="field" for={`tags-${record.id}`}>Additional tags <small>comma separated</small></label>
        <div><input id={`tags-${record.id}`} value={tagDraft} oninput={(event) => setTagDraft(event.currentTarget.value)} placeholder="campaign-name, priority" autocomplete="off"><button class="btn" type="submit">Save tags</button></div>
      </form>
      </div>
      </details>
    {/snippet}
    {#snippet evidence()}
      <EvidenceTimeline {record} />
      <CaseRelationships {record} records={allRecords} onselect={selectCase} />
    {/snippet}
    {#snippet history()}
      <form class="note-edit" onsubmit={(event) => { event.preventDefault(); addNote(record); }}>
        <label class="field" for={`note-${record.id}`}>Add note</label>
        <textarea id={`note-${record.id}`} value={noteDraft} oninput={(event) => setNoteDraft(event.currentTarget.value)} rows="3" placeholder="Observations, evidence or decisions"></textarea>
        <button class="btn" type="submit" disabled={!noteDraft.trim() || pendingNoteCaseIds.includes(record.id)}>{pendingNoteCaseIds.includes(record.id) ? 'Adding…' : 'Add note'}</button>
      </form>
      {#if record.notes.length}<ol class="notes">{#each [...record.notes].reverse() as note}<li><time datetime={note.createdAt}>{formatDate(note.createdAt)}</time><p>{note.body}</p></li>{/each}</ol>{/if}
    {/snippet}
    {#snippet exports()}<CaseReportExport {record} onmessage={setMessage} />{/snippet}
  </CaseResponseWorkspace>
</article>

<style>
  .case-detail { min-width: 0; }
  .case-return, .case-actions, .case-identity { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
  .case-return { margin-bottom: 12px; font-size: var(--text-sm); }
  .case-heading { margin-bottom: 16px; scroll-margin-top: 90px; }
  .case-heading :global(.heading) { margin-bottom: 8px; }
  .case-identity { color: var(--muted); font-size: var(--text-xs); overflow-wrap: anywhere; }
  .case-actions { margin-bottom: 18px; align-items: start; }
  .case-more { min-width: 0; }
  .case-more summary { min-height: 44px; padding: 10px 12px; cursor: pointer; }
  .case-more > div { display: grid; gap: 8px; max-width: 32rem; padding: 12px; border: 1px solid var(--border); background: var(--panel); color: var(--muted); font-size: var(--text-xs); }
  .complete-id { overflow-wrap: anywhere; }
  .case-more .btn { justify-self: start; }
  .field-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
  .metadata-editor { min-width: 0; border-bottom: 1px solid var(--border); }
  .metadata-editor > summary { padding-block: 14px; cursor: pointer; font-weight: 650; }
  .metadata-fields { display: grid; gap: 16px; padding-bottom: 16px; }
  .tags-edit > div { display: flex; gap: 8px; margin-top: 6px; }
  .tags-edit input { min-width: 0; flex: 1; }
  .note-edit textarea { width: 100%; margin-block: 6px 8px; }
  .notes { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
  .notes li { padding: 12px; border-bottom: 1px solid var(--border); }
  .notes time { color: var(--muted); font-size: var(--text-xs); }
  .notes p { margin: 6px 0 0; font-size: var(--text-sm); line-height: 1.55; overflow-wrap: anywhere; white-space: pre-wrap; }
  @media(max-width: 720px) { .field-grid { grid-template-columns: minmax(0,1fr); } }
  @media(max-width: 480px) { .case-sections { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 0; } .case-sections a { grid-column: span 2; justify-content: center; padding-inline: 4px; } .case-sections a:nth-last-child(-n+2) { grid-column: span 3; } .tags-edit > div { flex-wrap: wrap; } }
</style>
