<script lang="ts">
  import { onMount } from 'svelte';
  import { downloadLocalFile } from '#lib/download-local-file.ts';
  import { selectComparisonReportRows } from '../../../../packages/comparison/comparison-row-report.mts';
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import ComparisonLedgerRows from '#lib/components/ComparisonLedgerRows.svelte';
  import IntelligenceIcon from './IntelligenceIcon.svelte';
  import ComparisonFrame from '#lib/components/ComparisonFrame.svelte';
  import CaseCheckpointStage from '#lib/components/CaseCheckpointStage.svelte';
  import {
    buildComparisonLedgerDetails,
    buildComparisonLedgerIndex,
    comparisonLedgerBulkPairIndexId,
    type ComparisonLedgerDetails,
    type ComparisonLedgerIndexSide,
    type ComparisonLedgerMode,
  } from '#lib/analysis/comparison-ledger.ts';
  import type { CaseRecord } from '#lib/cases.ts';
  import type { WebsiteProfileSnapshot } from '#lib/website-snapshots.ts';
  import type { BulkSession } from '#lib/bulk-sessions.ts';
  import type { Watchlists } from '#lib/watchlists.ts';

  let {
    cases,
    websiteSnapshots,
    watchlists,
    bulkSessions,
  }: {
    cases: readonly CaseRecord[];
    websiteSnapshots: readonly WebsiteProfileSnapshot[];
    watchlists: Watchlists;
    bulkSessions: readonly BulkSession[];
  } = $props();

  let selectedItemId = $state('');
  let earlierBulkId = $state('');
  let laterBulkId = $state('');
  let selectedBulkPair = $state<{ earlierSessionId: string; laterSessionId: string } | null>(null);
  let pairStatus = $state('');

  const EMPTY_DETAILS: ComparisonLedgerDetails = Object.freeze({
    selectedItems: Object.freeze([]),
    rows: Object.freeze([]),
    totalRows: 0,
    limitations: Object.freeze([]),
    omissions: Object.freeze({
      inputRecords: 0,
      inputScanTruncations: 0,
      invalidRecords: 0,
      duplicateRecords: 0,
      indexItems: 0,
      entityRequests: 0,
      duplicateEntityRequests: 0,
      invalidEntityRequests: 0,
      missingEntities: 0,
      duplicateDetailRows: 0,
      detailRows: 0,
      sourceRows: 0,
      limitations: 0,
      truncatedStrings: 0,
    }),
    truncated: false,
  });

  const orderedBulkSessions = $derived([...bulkSessions].sort((left, right) => (
    left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id)
  )));
  const ledgerInput = $derived({
    cases,
    websiteSnapshots,
    watchlists,
    bulkSessions,
    bulkPairs: selectedBulkPair ? [selectedBulkPair] : [],
  });
  const index = $derived(buildComparisonLedgerIndex(ledgerInput));
  const selectedItem = $derived(index.items.find((item) => item.id === selectedItemId) ?? null);
  const details = $derived(selectedItem
    ? buildComparisonLedgerDetails(ledgerInput, { itemIds: [selectedItem.id] })
    : EMPTY_DETAILS);
  let reportSelection = $state.raw<ReturnType<typeof selectComparisonReportRows> | null>(null);
  let reportDetails = $state.raw<ComparisonLedgerDetails | null>(null);
  let reportStatus = $state('');

  function clearReport(message = ''): void {
    reportSelection = null;
    reportDetails = null;
    reportStatus = message;
  }
  $effect(() => {
    if (reportDetails && reportDetails !== details) clearReport('The displayed comparison changed. Select the rows again before downloading.');
  });
  onMount(() => {
    const clear = () => clearReport();
    window.addEventListener('pagehide', clear);
    return () => { window.removeEventListener('pagehide', clear); clear(); };
  });

  function selectReportRow(rowId: string, checked: boolean): void {
    if (reportDetails && reportDetails !== details) {
      clearReport('The displayed comparison changed. Select the rows again before downloading.');
      return;
    }
    const ids = new Set(reportSelection?.rowIds ?? []);
    if (checked) ids.add(rowId); else ids.delete(rowId);
    try {
      reportSelection = ids.size ? selectComparisonReportRows(details, [...ids]) : null;
      reportDetails = reportSelection ? details : null;
      reportStatus = '';
    } catch {
      clearReport('These rows could not be prepared. No file was downloaded.');
    }
  }

  function downloadReport(): void {
    if (!reportSelection) return;
    if (reportDetails !== details) {
      clearReport('The displayed comparison changed. Select the rows again before downloading.');
      return;
    }
    try {
      // Revalidate the complete selected content immediately before creating bytes.
      const content = reportSelection.render(details);
      downloadLocalFile(new Blob([content], { type: 'text/plain;charset=utf-8' }), 'whoisleuth-comparison.txt');
      reportStatus = 'Prepared the selected-row text download. No saved record was changed.';
    } catch {
      clearReport('The selected rows are no longer available for this report. No file was downloaded; select them again.');
    }
  }

  const MODE_LABELS: Record<ComparisonLedgerMode, string> = {
    publication: 'Publication comparison',
    entity: 'Entity comparison',
    temporal: 'Retained temporal comparison',
    expectation: 'Expectation review',
    membership: 'Retained membership comparison',
    reconciliation: 'Evidence reconciliation',
  };

  function when(value: string | null): string {
    return formatEvidenceDate(value, 'Not retained');
  }

  function comparisonTimeSummary(item: { earlier: ComparisonLedgerIndexSide; later: ComparisonLedgerIndexSide }): string {
    const earlier = item.earlier.observedAt ?? item.earlier.publishedAt ?? item.earlier.retainedAt;
    const later = item.later.observedAt ?? item.later.publishedAt ?? item.later.retainedAt;
    return `${when(earlier)} → ${when(later)}`;
  }

  function chooseBulkPair(): void {
    const earlier = orderedBulkSessions.find((item) => item.id === earlierBulkId);
    const later = orderedBulkSessions.find((item) => item.id === laterBulkId);
    if (!earlier || !later) {
      pairStatus = 'Choose both saved sessions explicitly.';
      return;
    }
    if (earlier.id === later.id) {
      pairStatus = 'Choose two different saved sessions.';
      return;
    }
    if (earlier.updatedAt > later.updatedAt) {
      pairStatus = 'The earlier saved session must precede the later saved session.';
      return;
    }
    selectedBulkPair = { earlierSessionId: earlier.id, laterSessionId: later.id };
    selectedItemId = comparisonLedgerBulkPairIndexId(earlier.id, later.id);
    pairStatus = `Added the explicit ${earlier.name} to ${later.name} pair to this transient review.`;
  }
</script>

<section id="retained-change-review" class="change-review card" aria-labelledby="retained-change-title">
  <header class="section-head">
    <div><p class="eyebrow">Derived review</p><h2 id="retained-change-title">Retained change review</h2></div>
    <span class="bounded-count">{index.counts.retained} eligible retained comparison{index.counts.retained === 1 ? '' : 's'}</span>
  </header>
  <p>
    Compare adjacent case snapshots, website profiles, retained watchlist changes or one selected saved Bulk pair. Exact values load only for the selected record.
  </p>
  {#if cases.some(record => record.evidenceHistory.length >= 2)}
    <details class="checkpoint-disclosure"><summary>Choose Case checkpoints</summary><CaseCheckpointStage {cases} /></details>
  {/if}

  {#if orderedBulkSessions.length >= 2}
    <fieldset class="bulk-pair-controls">
      <legend>Add an explicit saved Bulk pair</legend>
      <p>Saved sessions are never paired automatically. Choose the chronological direction, then add only that pair to this transient review.</p>
      <div class="pair-grid">
        <label>Earlier saved session<select bind:value={earlierBulkId}><option value="">Choose earlier</option>{#each orderedBulkSessions as session}<option value={session.id}>{session.name} · {when(session.updatedAt)}</option>{/each}</select></label>
        <label>Later saved session<select bind:value={laterBulkId}><option value="">Choose later</option>{#each orderedBulkSessions as session}<option value={session.id}>{session.name} · {when(session.updatedAt)}</option>{/each}</select></label>
        <button class="btn" type="button" onclick={chooseBulkPair}>Review selected Bulk pair</button>
      </div>
      {#if pairStatus}<p class="pair-status" role="status" aria-live="polite">{pairStatus}</p>{/if}
    </fieldset>
  {/if}

  {#if index.items.length}
    <label class="owner-select">Retained owner or explicit pair
      <select value={selectedItemId} onchange={(event) => selectedItemId = event.currentTarget.value}>
        <option value="">Choose retained comparison</option>
        {#each index.items as item (item.id)}
          <option value={item.id}>{item.label} · {comparisonTimeSummary(item)} · {MODE_LABELS[item.mode]}</option>
        {/each}
      </select>
    </label>
    <p class="selection-status" role="status" aria-live="polite">
      {selectedItem ? `Selected ${selectedItem.label}. Exact details are derived below.` : 'Choose one retained owner or explicit pair to derive exact details.'}
    </p>
  {:else}
    <div class="empty-state">
      <h3>No eligible retained comparison yet</h3>
      <p>Retain two case snapshots, two website profiles for one domain, or a later watchlist check. Saved Bulk sessions appear only after you select a pair above.</p>
    </div>
  {/if}

  {#if index.truncated}
    <p class="index-limit" role="status">
      Bounded index: omitted {index.omissions.indexItems} over-limit item{index.omissions.indexItems === 1 ? '' : 's'}, {index.omissions.inputRecords} over-limit input{index.omissions.inputRecords === 1 ? '' : 's'}, stopped {index.omissions.inputScanTruncations} over-limit input scan{index.omissions.inputScanTruncations === 1 ? '' : 's'}, found {index.omissions.invalidRecords} invalid record{index.omissions.invalidRecords === 1 ? '' : 's'}, {index.omissions.duplicateRecords} duplicate{index.omissions.duplicateRecords === 1 ? '' : 's'}, {index.omissions.limitations} limitation{index.omissions.limitations === 1 ? '' : 's'}, and truncated {index.omissions.truncatedStrings} string{index.omissions.truncatedStrings === 1 ? '' : 's'}.
    </p>
  {/if}

  {#if selectedItem}
    <article class="selected-comparison" aria-labelledby="selected-comparison-title">
      <ComparisonFrame>
      {#snippet header()}<div><p class="eyebrow">Selected retained comparison</p><h3 id="selected-comparison-title">{selectedItem.label}</h3></div><a class="owner-link" href={selectedItem.ownerHref}>Open owning record <IntelligenceIcon name="arrow-right" size={16} /></a>{/snippet}
      {#snippet left()}
        <section aria-label="Earlier comparison source"><h4>Earlier</h4><dl class="comparison-metadata">
          <div><dt>Source</dt><dd>{selectedItem.earlier.source}</dd></div>
          <div><dt>State</dt><dd>{selectedItem.earlier.sourceState}</dd></div>
          <div><dt>Observed</dt><dd>{when(selectedItem.earlier.observedAt)}</dd></div>
          <div><dt>Published</dt><dd>{when(selectedItem.earlier.publishedAt)}</dd></div>
          <div><dt>Retained locally</dt><dd>{when(selectedItem.earlier.retainedAt)}</dd></div>
        </dl></section>
      {/snippet}
      {#snippet right()}
        <section aria-label="Later comparison source"><h4>Later</h4><dl class="comparison-metadata">
          <div><dt>Source</dt><dd>{selectedItem.later.source}</dd></div>
          <div><dt>State</dt><dd>{selectedItem.later.sourceState}</dd></div>
          <div><dt>Observed</dt><dd>{when(selectedItem.later.observedAt)}</dd></div>
          <div><dt>Published</dt><dd>{when(selectedItem.later.publishedAt)}</dd></div>
          <div><dt>Retained locally</dt><dd>{when(selectedItem.later.retainedAt)}</dd></div>
        </dl></section>
      {/snippet}
      {#snippet context()}
      <dl class="comparison-metadata">
        <div><dt>Mode</dt><dd>{MODE_LABELS[selectedItem.mode]}</dd></div>
        <div><dt>Completeness</dt><dd>{selectedItem.completeness.replaceAll('_', ' ')}</dd></div>
        <div><dt>Owner ID</dt><dd><code>{selectedItem.ownerId}</code></dd></div>
        <div><dt>Entity ID</dt><dd><code>{selectedItem.entityId}</code></dd></div>
        <div><dt>Source truncation</dt><dd>{selectedItem.truncated ? 'Yes; review omission counts' : 'No retained source truncation reported'}</dd></div>
      </dl>
      <section class="comparison-limitations" aria-label="Selected comparison limitations">
        <h4>Limitations before exact values</h4>
        <ul>{#each selectedItem.limitations as limitation}<li>{limitation}</li>{/each}</ul>
        {#if selectedItem.omittedLimitations}<p>Omitted {selectedItem.omittedLimitations} additional bounded limitation{selectedItem.omittedLimitations === 1 ? '' : 's'}.</p>{/if}
      </section>
      {/snippet}
      <section class="row-report" aria-label="Selected-row text report">
        <h4>Download selected rows</h4>
        <p>The text file includes selected normalised values, which may be private, with source states, separate clocks, limitations and omission counts. Unselected values and owning records are excluded. It is not an original-evidence package; missing endpoint or algorithm details remain unavailable.</p>
        <p>Selections stay on this page and clear when the displayed comparison changes. Reload the page to include changes made elsewhere; downloading does not reread saved data, collect evidence or upload anything.</p>
        <div class="report-actions">
          <button class="btn" type="button" disabled={!reportSelection} onclick={downloadReport}>Download selected rows ({reportSelection?.rowIds.length ?? 0})</button>
          <button class="btn small" type="button" disabled={!reportSelection} onclick={() => clearReport('Row selection cleared.')}>Clear row selection</button>
        </div>
        <p role="status" aria-live="polite">{reportStatus || `${reportSelection?.rowIds.length ?? 0} selected. Choose rows below.`}</p>
      </section>
      <ComparisonLedgerRows
        rows={details.rows}
        totalRows={details.totalRows}
        omittedRows={details.omissions.detailRows}
        duplicateRows={details.omissions.duplicateDetailRows}
        sourceOmittedRows={details.omissions.sourceRows}
        selection={{ rowIds: reportSelection?.rowIds ?? [], toggle: selectReportRow }}
      />
      </ComparisonFrame>
    </article>
  {/if}
</section>

<style>
  .change-review{margin-top:16px}
  .checkpoint-disclosure{margin:14px 0}
  .section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  .section-head h2,.selected-comparison h3{margin:2px 0 0}
  .bounded-count{flex:0 0 auto;padding:5px 8px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font-size:var(--text-xs)}
  .bulk-pair-controls{min-width:0;margin:16px 0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md)}
  .bulk-pair-controls legend{padding:0 6px;font-weight:800}
  .bulk-pair-controls>p{margin:0 0 10px;color:var(--muted);font-size:var(--text-sm)}
  .pair-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr)) auto;align-items:end;gap:10px}
  label{display:grid;min-width:0;gap:5px;font-weight:700;font-size:var(--text-sm)}
  select{min-width:0;width:100%}
  .pair-status,.selection-status,.index-limit{margin:9px 0 0;color:var(--muted);font-size:var(--text-sm)}
  .index-limit{padding:10px;border:1px dashed var(--amber);border-radius:var(--radius-sm);color:var(--text)}
  .owner-select{max-width:760px;margin-top:14px}
  .empty-state{margin-top:14px;padding:14px;border:1px dashed var(--border);border-radius:var(--radius-md)}
  .empty-state h3,.empty-state p{margin:0}
  .empty-state p{margin-top:6px;color:var(--muted)}
  .selected-comparison{margin-top:16px;padding-top:16px;border-top:1px solid var(--border)}
  .owner-link{font-weight:800;overflow-wrap:anywhere}
  .comparison-metadata{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px 14px;margin:14px 0 0}
  .comparison-metadata div{min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  dt{font-size:var(--text-xs);font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
  dd{margin:3px 0 0;overflow-wrap:anywhere}
  code{font:inherit;overflow-wrap:anywhere}
  .comparison-limitations{margin:12px 0;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  .comparison-limitations h4{margin:0;font-size:var(--text-sm)}
  .comparison-limitations ul{margin:7px 0 0;padding-left:20px}
  .comparison-limitations p{margin:7px 0 0;color:var(--muted);font-size:var(--text-sm)}
  .row-report{margin-top:16px;min-width:0}
  .row-report h4{margin:0}
  .row-report p{margin:8px 0;font-size:var(--text-sm);color:var(--muted)}
  .report-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
  @media(max-width:760px){
    .pair-grid,.comparison-metadata{grid-template-columns:1fr}
    .pair-grid .btn{width:100%}
  }
  @media(max-width:520px){
    .section-head{display:grid}
    .bounded-count{width:max-content;max-width:100%}
  }
</style>
