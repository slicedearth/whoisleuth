<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import { buildCaseReport, caseReportFilename } from '$lib/analysis/case-report.js';

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
</script>

<fieldset class="export-controls">
  <legend>Case evidence package</legend>
  <label class="export-notes">
    <input type="checkbox" bind:checked={includeNotes}>
    <span>
      Include analyst notes
      <small>Notes may contain sensitive information. Review the package before sharing it.</small>
    </span>
  </label>
  <div class="export-actions">
    <button type="button" onclick={() => exportReport('json')}>Export JSON</button>
    <button type="button" onclick={() => exportReport('md')}>Export Markdown</button>
  </div>
</fieldset>

<style>
  .export-controls { display: grid; gap: 10px; min-width: 0; margin: 0; padding: 13px; border: 1px solid var(--border); border-radius: 9px; }
  legend { padding: 0 6px; color: var(--muted); font-size: .66rem; }
  .export-notes { display: flex; gap: 9px; align-items: start; min-width: 0; font-size: .7rem; }
  .export-notes input { width: 16px; min-height: auto; flex: 0 0 auto; margin-top: 2px; padding: 0; }
  .export-notes span { min-width: 0; overflow-wrap: anywhere; }
  .export-notes small { display: block; margin-top: 3px; color: var(--muted); font-size: .62rem; line-height: 1.45; }
  .export-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .export-actions button { min-height: 36px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel-raised); font-size: .68rem; }
  @media (max-width: 460px) { .export-actions button { flex: 1 1 130px; } }
</style>
