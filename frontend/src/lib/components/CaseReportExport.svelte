<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import { buildCaseReport, caseReportFilename } from '$lib/analysis/case-report.ts';
  import { buildCaseSightingStixExport } from '$lib/analysis/case-sighting-stix-export.ts';

  let {
    record,
    onmessage,
  }: {
    record: CaseRecord;
    onmessage?: (message: string) => void;
  } = $props();

  let includeNotes = $state(false);

  function exportReport(format: 'json' | 'md') {
    try {
      const generatedAt = new Date().toISOString();
      const { json, markdown } = buildCaseReport(record, {
        includeNotes,
        generatedAt,
      });
      const content = format === 'md' ? markdown : JSON.stringify(json, null, 2);
      const blob = new Blob([content], {
        type: format === 'md' ? 'text/markdown' : 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = caseReportFilename(record.domain, format, generatedAt);
      anchor.click();
      URL.revokeObjectURL(url);
      onmessage?.(`Exported ${format === 'md' ? 'Markdown' : 'JSON'} report for ${record.domain}${includeNotes ? ' (with notes)' : ''}.`);
    } catch (cause) {
      onmessage?.(cause instanceof Error ? cause.message : 'Could not export case report.');
    }
  }

  function exportSightings() {
    try {
      const exported = buildCaseSightingStixExport(record);
      const url = URL.createObjectURL(new Blob([exported.content], { type: exported.mimeType }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = exported.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      onmessage?.(`Exported ${exported.sightingCount} source-qualified sighting${exported.sightingCount === 1 ? '' : 's'} as a local STIX 2.1 bundle.`);
    } catch (cause) {
      onmessage?.(cause instanceof Error ? cause.message : 'Could not export source-qualified sightings.');
    }
  }
</script>

<fieldset class="export-controls">
  <legend>Case evidence package</legend>
  <label class="export-notes choice">
    <input type="checkbox" bind:checked={includeNotes}>
    <span>
      Include analyst notes
      <small>Notes may contain sensitive information. Review the package before sharing it.</small>
    </span>
  </label>
  <div class="export-actions">
    <button type="button" class="btn" onclick={() => exportReport('json')}>Export JSON</button>
    <button type="button" class="btn" onclick={() => exportReport('md')}>Export Markdown</button>
    <button type="button" class="btn" onclick={exportSightings} disabled={!record.sightings.length}>Export sightings STIX</button>
  </div>
  <small class="exchange-note">The STIX export includes only source-qualified sightings and their bounded provenance. Negative review states remain notes and never erase earlier observations.</small>
</fieldset>

<style>
  .export-controls { display: grid; gap: 10px; min-width: 0; margin: 0; padding: 13px; border: 1px solid var(--border); border-radius: var(--radius-sm); }
  legend { padding: 0 6px; color: var(--text); font: 700 var(--text-xs) var(--mono); }
  .export-notes span { font-size: var(--text-sm); }
  .export-notes small { display: block; margin-top: 3px; color: var(--muted); font-size: var(--text-xs); line-height: 1.5; }
  .export-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .exchange-note { color: var(--muted); font-size: var(--text-2xs); line-height: 1.45; }
  @media (max-width: 460px) { .export-actions .btn { flex: 1 1 130px; } }
</style>
