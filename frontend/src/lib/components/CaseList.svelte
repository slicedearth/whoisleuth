<script lang="ts">
  import Pagination from '$lib/components/Pagination.svelte';
  import { caseFreeformTags, caseNumber, caseTypeRecords, dispositionLabel, isReviewedCaseDisposition, statusLabel, type CaseRecord } from '$lib/cases';
  import { caseWorkspaceHref } from '$lib/analysis/case-response-stage.ts';
  import { handlesLocalLink } from '$lib/link-activation';

  let { records, selectCase, formatDate, currentPage, pageCount, setPage, calibrationMode = false, calibrationCaseIds, toggleCalibrationCase }: {
    records: CaseRecord[];
    selectCase: (record: CaseRecord) => void;
    formatDate: (value: string) => string;
    currentPage: number;
    pageCount: number;
    setPage: (value: number) => void;
    calibrationMode?: boolean;
    calibrationCaseIds: string[];
    toggleCalibrationCase: (record: CaseRecord, selected: boolean) => void;
  } = $props();
</script>

<section class="case-list" aria-label="Saved Cases">
  {#each records as record (record.id)}
    <article class="case card">
      {#if calibrationMode}
        <label class="calibration-select">
          <input type="checkbox" checked={calibrationCaseIds.includes(record.id)} disabled={!isReviewedCaseDisposition(record.disposition) || !record.evidenceHistory.length} onchange={(event) => toggleCalibrationCase(record, event.currentTarget.checked)}>
          Include in offline Risk calibration export
        </label>
      {/if}
      <a id={`case-head-${record.id}`} class="case-head" href={caseWorkspaceHref(record.id)} onclick={(event) => {
        if (handlesLocalLink(event)) { event.preventDefault(); selectCase(record); }
      }}>
        <span class="case-domain"><strong>{record.domain}</strong><small title={`Complete Case number: ${caseNumber(record.id)}`}>Case …{caseNumber(record.id).slice(-8)}{record.notes.length ? ` · ${record.notes.length} note${record.notes.length === 1 ? '' : 's'}` : ''}</small></span>
        <span class="badges"><span class={`badge status-${record.status}`}>{statusLabel(record.status)}</span><span class={`badge disposition-${record.disposition}`}>{dispositionLabel(record.disposition)}</span></span>
        <time class="updated" datetime={record.updatedAt}>{formatDate(record.updatedAt)}</time>
      </a>
      {#if caseTypeRecords(record.tags).length || caseFreeformTags(record.tags).length}<div class="tag-row">{#each caseTypeRecords(record.tags) as type}<span class="tag">{type.label}</span>{/each}{#each caseFreeformTags(record.tags) as tag}<span class="tag">{tag}</span>{/each}</div>{/if}
    </article>
  {/each}
  {#if !records.length}<p class="count">No cases match the current filters.</p>{/if}
  <Pagination {currentPage} {pageCount} {setPage} ariaLabel="Case pages" />
</section>

<style>
  .case-list { display: grid; gap: 8px; }
  .case { min-width: 0; padding: 0; }
  .case-head { display: grid; grid-template-columns: minmax(0,1fr) auto auto; gap: 12px; align-items: center; padding: 16px; color: var(--text); text-decoration: none; border-radius: inherit; }
  .case-head:hover { background: var(--panel-raised); }
  .case-head:hover strong { color: var(--accent); }
  .case-domain { display: grid; gap: 6px; min-width: 0; }
  .case-domain strong { overflow-wrap: anywhere; font: 700 var(--text-md) var(--mono); }
  .case-domain small, .updated, .count { color: var(--muted); font-size: var(--text-xs); }
  .badges, .tag-row { display: flex; flex-wrap: wrap; gap: 6px; }
  .tag-row { padding: 0 16px 12px; }
  .tag { padding: 3px 8px; border: 1px solid var(--border); border-radius: 6px; color: var(--muted); font-size: var(--text-xs); overflow-wrap: anywhere; }
  .calibration-select { display: flex; align-items: center; gap: 8px; padding: 12px 16px 0; color: var(--muted); font-size: var(--text-xs); }
  .calibration-select input { width: 18px; height: 18px; }
  @media(max-width: 900px) { .case-head { grid-template-columns: minmax(0,1fr) auto; } .updated { grid-column: 1/-1; } }
  @media(max-width: 540px) { .case-head { grid-template-columns: minmax(0,1fr); gap: 10px; } }
</style>
