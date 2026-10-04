<script lang="ts">
  import { tick } from 'svelte';
  import { downloadLocalFile } from '$lib/download-local-file.ts';
  import type { CaseRecord } from '$lib/cases';
  import { prepareCaseReportPreview, caseReportPreviewIsCurrent, type CaseReportPreview as ReportPreview } from '../../../../packages/cases/case-report-preview.mts';
  import CaseReportPreview from './CaseReportPreview.svelte';
  import { buildCaseSightingStixExport } from '$lib/analysis/case-sighting-stix-export.ts';

  let {
    record,
    onmessage,
  }: {
    record: CaseRecord;
    onmessage?: (message: string) => void;
  } = $props();

  let includeNotes = $state(false);
  let includeAttribution = $state(true);
  let preview = $state.raw<ReportPreview | null>(null);
  let previewTrigger: HTMLButtonElement;
  const options = $derived({ includeAttribution, includeNotes, applicationVersion: __WHOISLEUTH_VERSION__ });
  const current = $derived(preview !== null && caseReportPreviewIsCurrent(preview, record, options));

  function prepare() {
    try { preview = prepareCaseReportPreview(record, options, new Date().toISOString()); }
    catch { onmessage?.('Could not prepare the report preview. Nothing was downloaded.'); }
  }
  async function closePreview() {
    preview = null;
    await tick();
    if (previewTrigger?.isConnected) previewTrigger.focus({ preventScroll: true });
  }

  function exportReport(format: 'json' | 'md') {
    try {
      if (preview && !caseReportPreviewIsCurrent(preview, record, options)) throw new Error('The Case or options changed. Prepare a current preview before downloading.');
      const prepared = preview ?? prepareCaseReportPreview(record, options, new Date().toISOString());
      const file = prepared.files[format];
      downloadLocalFile(new Blob([file.content], { type: file.mimeType }), file.filename);
      onmessage?.(`Exported ${format === 'md' ? 'Markdown' : 'JSON'} report for ${record.domain}${includeNotes ? ' (with notes)' : ''}.`);
    } catch (cause) {
      onmessage?.(cause instanceof Error ? cause.message : 'Could not export case report.');
    }
  }

  function exportSightings() {
    try {
      const exported = buildCaseSightingStixExport(record);
      downloadLocalFile(new Blob([exported.content], { type: exported.mimeType }), exported.filename);
      onmessage?.(`Exported ${exported.sightingCount} source-qualified sighting${exported.sightingCount === 1 ? '' : 's'} as a local STIX 2.1 bundle.`);
    } catch (cause) {
      onmessage?.(cause instanceof Error ? cause.message : 'Could not export source-qualified sightings.');
    }
  }
</script>

<fieldset class="export-controls">
  <legend>Case evidence package</legend>
  <label class="export-choice choice">
    <input type="checkbox" bind:checked={includeNotes}>
    <span>
      Include analyst notes
      <small>Notes may contain sensitive information. Review the package before sharing it.</small>
    </span>
  </label>
  <label class="export-choice choice">
    <input type="checkbox" bind:checked={includeAttribution}>
    <span>
      Include generator footer
      <small>JSON always retains bounded generator metadata for provenance. This option controls only the Markdown footer.</small>
    </span>
  </label>
  <div class="export-actions">
    <button bind:this={previewTrigger} type="button" class="btn" onclick={event => { event.currentTarget.focus({ preventScroll: true }); prepare(); }}>Preview report</button>
    <button type="button" class="btn" onclick={() => exportReport('json')}>Export JSON</button>
    <button type="button" class="btn" onclick={() => exportReport('md')}>Export Markdown</button>
    <button type="button" class="btn" onclick={exportSightings} disabled={!record.sightings.length}>Export sightings STIX</button>
  </div>
  <small class="exchange-note">The STIX export includes only source-qualified sightings and their bounded provenance. Negative review states remain notes and never erase earlier observations.</small>
</fieldset>
{#if preview}<CaseReportPreview {preview} {current} onvalidate={() => preview !== null && caseReportPreviewIsCurrent(preview, record, options)} ondownload={exportReport} onclose={() => void closePreview()} />{/if}

<style>
  .export-controls { display: grid; gap: 10px; min-width: 0; margin: 0; padding: 13px; border: 1px solid var(--border); border-radius: var(--radius-sm); }
  legend { padding: 0 6px; color: var(--text); font: 700 var(--text-xs) var(--mono); }
  .export-choice span { font-size: var(--text-sm); }
  .export-choice small { display: block; margin-top: 3px; color: var(--muted); font-size: var(--text-xs); line-height: 1.5; }
  .export-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .exchange-note { color: var(--muted); font-size: var(--text-2xs); line-height: 1.45; }
  @media (max-width: 460px) { .export-actions .btn { flex: 1 1 130px; } }
</style>
