<script lang="ts">
  import { onMount } from 'svelte';
  import type { CaseReportPreview } from '../../../../packages/cases/case-report-preview.mts';
  import CaseReportReading from './CaseReportReading.svelte';
  let { preview, current, ondownload, onclose }: { preview: CaseReportPreview; current: boolean; ondownload: (format: 'json' | 'md') => void; onclose: () => void } = $props();
  const id = $props.id();
  let dialog: HTMLDialogElement;
  let heading: HTMLHeadingElement;
  onMount(() => { dialog.showModal(); heading.focus({ preventScroll: true }); return () => dialog.close(); });
</script>

<dialog bind:this={dialog} aria-labelledby={id} onclose={onclose}>
  <header><h2 {id} bind:this={heading} tabindex="-1">Case report preview</h2><button class="btn" type="button" onclick={() => dialog.close()}>Close report preview</button></header>
  {#if !current}<p role="alert">The Case or report options changed. Close this preview and prepare the current report before downloading.</p>{/if}
  <div class="actions"><button class="btn" type="button" disabled={!current} onclick={() => ondownload('json')}>Download previewed JSON ({preview.files.json.bytes.toLocaleString()} bytes)</button><button class="btn" type="button" disabled={!current} onclick={() => ondownload('md')}>Download previewed Markdown ({preview.files.md.bytes.toLocaleString()} bytes)</button></div>
  <p>Notes: {preview.report.json.case.notesIncluded ? 'included' : 'excluded'}. Original files and unfinished forms are not included.</p>
  {#if preview.markings.length}<section aria-label="Imported sharing restrictions"><h3>Imported sharing restrictions</h3><ul>{#each preview.markings as marking}<li>{marking}</li>{/each}</ul><p>{preview.strictestMarking ? `Most restrictive recognised marking: ${preview.strictestMarking}.` : 'No recognised TLP marking.'} {preview.unknownMarkings.length ? 'Other restrictions need source-specific review.' : ''} Markings are retained unchanged; they do not encrypt or redact this download.</p></section>{/if}
  <CaseReportReading report={preview.report.json} />
  <details><summary>Exact Markdown download</summary><pre>{preview.files.md.content}</pre></details>
  <details><summary>Exact JSON download</summary><pre>{preview.files.json.content}</pre></details>
</dialog>

<style>
  dialog{width:min(960px,calc(100% - 24px));max-height:calc(100dvh - 24px);padding:24px;border:1px solid var(--border-strong);border-radius:var(--radius-md);background:var(--panel);color:var(--text);overflow:auto;overflow-wrap:anywhere}dialog::backdrop{background:rgb(0 0 0 / .6)}header,.actions{display:flex;align-items:start;justify-content:space-between;gap:12px;flex-wrap:wrap}h2{margin:0;font-family:var(--font-sans)}p,li{line-height:1.6}.actions{justify-content:start;margin-top:20px}details{margin-top:20px}summary{min-height:44px}pre{max-height:28rem;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:var(--text-xs)/1.5 var(--mono)}
  @media(max-width:600px){dialog{padding:16px}.actions button{width:100%}}
</style>
