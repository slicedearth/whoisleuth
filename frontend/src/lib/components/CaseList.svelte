<script lang="ts">
  import Pagination from '#lib/components/Pagination.svelte';
  import { caseNumber, caseTypeRecords } from '../../../../packages/cases/case-workflow-metadata.mts';
  import {
    dispositionLabel,
    isReviewedCaseDisposition,
    statusLabel,
  } from '../../../../packages/cases/case-record-decisions.mts';
  import type { CaseRecord } from '../cases.ts';
  import { caseWorkspaceHref } from '#lib/analysis/case-response-stage.ts';
  import { handlesLocalLink } from '#lib/link-activation.ts';
  import AnalystWorkbench from './AnalystWorkbench.svelte';
  import CaseEvidenceFact from './CaseEvidenceFact.svelte';
  import CopyButton from './CopyButton.svelte';
  import { buildCaseDecisionOverview, latestRetainedCaseReview } from '../../../../packages/cases/case-decision-overview.mts';
  import IntelligenceIcon from './IntelligenceIcon.svelte';
  import { MAX_CASE_BATCH_MUTATIONS } from '../../../../packages/cases/case-batch-limits.mts';
  import { openRetainedPeek } from '#lib/controllers/retained-peek-key.ts';

  let { records, selectCase, formatDate, currentPage, pageCount, setPage, calibrationMode = false, calibrationCaseIds, toggleCalibrationCase, tagMode = false, tagCaseIds = [], tagSelectionDisabled = false, toggleTagCase }: {
    records: CaseRecord[];
    selectCase: (record: CaseRecord) => void;
    formatDate: (value: string) => string;
    currentPage: number;
    pageCount: number;
    setPage: (value: number) => void;
    calibrationMode?: boolean;
    calibrationCaseIds: string[];
    toggleCalibrationCase: (record: CaseRecord, selected: boolean) => void;
    tagMode?: boolean; tagCaseIds?: readonly string[]; tagSelectionDisabled?: boolean;
    toggleTagCase?: (record: CaseRecord, selected: boolean) => void;
  } = $props();
  let inspectedId = $state<string | null>(null);
  let covers = $state(false);
  const inspected = $derived(records.find(record => record.id === inspectedId) ?? null);
  const overview = $derived(inspected ? buildCaseDecisionOverview(inspected, new Date().toISOString()) : null);
  $effect(() => { if (inspectedId && !inspected) inspectedId = null; });
</script>

<AnalystWorkbench label="Saved Case review" selected={inspected?.id ?? null} detailTitle={inspected?.title || inspected?.domain || ''} onclose={() => inspectedId = null}>
{#snippet queue()}
<section class="case-list" aria-label="Saved Cases">
  <label class="cover-choice"><input type="checkbox" bind:checked={covers}>Preview Case covers</label>
  {#each records as record (record.id)}
    <article class="case card" class:cover={covers} class:inspected={inspectedId === record.id}>
      {#if tagMode && toggleTagCase}
        <label class="calibration-select"><input type="checkbox" aria-label={`Select Case ${caseNumber(record.id)} for tag changes`}
          checked={tagCaseIds.includes(record.id)} disabled={tagSelectionDisabled || (tagCaseIds.length >= MAX_CASE_BATCH_MUTATIONS && !tagCaseIds.includes(record.id))}
          onchange={event => toggleTagCase?.(record, event.currentTarget.checked)}>Select for tag changes</label>
      {/if}
      {#if calibrationMode}
        <label class="calibration-select">
          <input type="checkbox" checked={calibrationCaseIds.includes(record.id)} disabled={!isReviewedCaseDisposition(record.disposition) || !record.evidenceHistory.length} onchange={(event) => toggleCalibrationCase(record, event.currentTarget.checked)}>
          Include in offline Risk calibration export
        </label>
      {/if}
      <a id={`case-head-${record.id}`} class="case-head" href={caseWorkspaceHref(record.id)} onclick={(event) => {
        if (handlesLocalLink(event)) { event.preventDefault(); selectCase(record); }
      }}>
        {#if covers}<span class="cover-icon" aria-hidden="true"><IntelligenceIcon name="case" size={28} /></span>{/if}
        <span class="case-domain"><strong>{record.title || record.domain}</strong>{#if record.title}<small>{record.domain}</small>{/if}<small title={`Complete Case number: ${caseNumber(record.id)}`}>Case …{caseNumber(record.id).slice(-8)}{record.notes.length ? ` · ${record.notes.length} note${record.notes.length === 1 ? '' : 's'}` : ''}</small></span>
        <span class="badges"><span class={`badge status-${record.status}`}>{statusLabel(record.status)}</span><span class={`badge disposition-${record.disposition}`}>{dispositionLabel(record.disposition)}</span></span>
        <time class="updated" datetime={record.updatedAt}>{formatDate(record.updatedAt)}</time>
      </a>
      {#if covers}
        {@const review = latestRetainedCaseReview(record)}
        <div class="cover-context">
          <code>{caseNumber(record.id)}</code>
          <p>Retained domain: <span>{record.domain}</span></p>
          <p>Latest retained review record: {#if review.recordedAt}<time datetime={review.recordedAt}>{formatDate(review.recordedAt)}</time>{:else}No dated review record{/if}{#if review.tiedRecords > 1} · {review.tiedRecords} equally dated records{/if}</p>
          <small>Recorded conclusions and independent outcome reviews.{#if review.undatedRecords} {review.undatedRecords} undated record{review.undatedRecords === 1 ? '' : 's'}; the latest review is unknown.{/if}{#if review.historyLimited} Retained review history is incomplete.{/if}</small>
          {#if record.observedEffects.limitations.length}<details class="cover-limitations"><summary>Retained review context</summary><ul>{#each record.observedEffects.limitations as limitation}<li>{limitation}</li>{/each}</ul></details>{/if}
        </div>
      {/if}
      {#if caseTypeRecords(record).length || record.tags.length}<div class="tag-row">{#each caseTypeRecords(record) as type}<span class="tag">{type.label}</span>{/each}{#each record.tags as tag}<span class="tag">{tag}</span>{/each}</div>{/if}
      <button class="btn peek" type="button" aria-label={`Inspect saved Case ${caseNumber(record.id)}`} aria-pressed={inspectedId === record.id} aria-keyshortcuts="P" title="Preview retained evidence: P while this button is focused" onclick={() => inspectedId = record.id} onkeydown={event => openRetainedPeek(event, () => inspectedId = record.id)}>Inspect retained evidence</button>
    </article>
  {/each}
  {#if !records.length}<p class="count">No cases match the current filters.</p>{/if}
  <Pagination {currentPage} {pageCount} {setPage} ariaLabel="Case pages" />
</section>
{/snippet}
{#snippet children()}
  {#if inspected && overview}
    <p><code>{caseNumber(inspected.id)}</code> <CopyButton value={caseNumber(inspected.id)} label="Copy Case number" /></p>
    <p>{statusLabel(inspected.status)} · {dispositionLabel(inspected.disposition)}</p>
    <p>{inspected.evidencePins.length} evidence pins · {inspected.assertions.length} analyst assertions · {inspected.actions.length} response actions.</p>
    <p>{overview.evidenceGaps.length} pins have incomplete evidence or an unavailable observation time. {overview.reviews.length} dated follow-ups are retained.</p>
    <h4>Analyst conclusions</h4>
    {#if overview.conclusions.length}<ul>{#each overview.conclusions as row}<li>{row.decision.summary}{#if row.evidenceAddedLater} — evidence was added after this decision.{/if}</li>{/each}</ul>{:else}<p>No dated or undated conclusion is retained.</p>{/if}
    <a class="btn" href={caseWorkspaceHref(inspected.id)} onclick={event => { if (handlesLocalLink(event) && inspected) { event.preventDefault(); selectCase(inspected); } }}>Open Case workspace</a>
  {/if}
{/snippet}
{#snippet inspector()}
  {#if inspected}
    <h4>Evidence pins</h4>
    <p>First {Math.min(5, inspected.evidencePins.length)} of {inspected.evidencePins.length} retained pins. Open the Case workspace for the complete record and linked history.</p>
    {#each inspected.evidencePins.slice(0, 5) as pin (pin.id)}<div class="peek-pin"><CaseEvidenceFact {pin} copyable /></div>{/each}
  {/if}
{/snippet}
</AnalystWorkbench>

<style>
  .case-list { container: case-list / inline-size; display: grid; gap: 8px; }
  .cover-choice { display: flex; align-items: center; gap: 8px; min-height: 44px; font-size: var(--text-xs); }
  .cover-choice input { width: 18px; height: 18px; }
  .cover .case-head { grid-template-columns: auto minmax(0, 1fr) auto auto; }
  .cover-icon { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 12px; background: var(--panel-raised); }
  .cover-context { padding: 0 16px 16px; overflow-wrap: anywhere; }
  .cover-context p { margin: 8px 0; font-size: var(--text-xs); }
  .cover-context small { color: var(--muted); }
  .cover-limitations { font-size: var(--text-xs); color: var(--muted); }
  .cover-limitations summary { min-height: 44px; align-content: center; cursor: pointer; }
  .cover-limitations ul { padding-inline-start: 20px; }
  .case { min-width: 0; padding: 0; }
  .peek { margin: 0 1rem 1rem; }
  .peek-pin { padding-block: .75rem; border-bottom: 1px solid var(--border); }
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
  @container case-list (max-width: 900px) { .case-head { grid-template-columns: minmax(0,1fr) auto; } .cover .case-head { grid-template-columns: auto minmax(0,1fr); } .updated, .cover .badges { grid-column: 1/-1; } }
  @container case-list (max-width: 540px) { .case-head { grid-template-columns: minmax(0,1fr); gap: 10px; } }
</style>
