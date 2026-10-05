<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { caseReportPrintBlocks, type CaseReportPreview } from '../../../../packages/cases/case-report-preview.mts';
  import CaseReportReading from './CaseReportReading.svelte';
  import './print-surface.css';
  let { preview, current, onvalidate, ondownload, onclose }: { preview: CaseReportPreview; current: boolean; onvalidate: () => boolean; ondownload: (format: 'json' | 'md') => void; onclose: () => void } = $props();
  const id = $props.id();
  let dialog: HTMLDialogElement;
  let heading: HTMLHeadingElement;
  let printButton: HTMLButtonElement;
  let printing = $state(false), busy = $state(false), error = $state('');
  let mounted = false;
  const printBlocks = $derived(caseReportPrintBlocks(preview));
  onMount(() => {
    mounted = true; dialog.showModal(); heading.focus({ preventScroll: true });
    const afterPrint = async () => { printing = false; await tick(); if (mounted && dialog.open) printButton.focus({ preventScroll: true }); };
    const beforePrint = () => {
      if (!printing || !onvalidate()) { printing = false; dialog.classList.remove('print-approved'); }
    };
    window.addEventListener('afterprint', afterPrint); window.addEventListener('beforeprint', beforePrint);
    return () => { mounted = false; window.removeEventListener('afterprint', afterPrint); window.removeEventListener('beforeprint', beforePrint); dialog.close(); };
  });
  async function printReport() {
    if (busy || printing) return;
    busy = true; error = '';
    try {
      if (!onvalidate()) throw new Error('The Case or options changed. Prepare a current report before printing.');
      printing = true;
      await tick();
      if (!mounted || !dialog.open) return;
      if (!onvalidate()) throw new Error('The Case or options changed while preparing print. Regenerate the report.');
      window.print();
    } catch (cause) { printing = false; error = cause instanceof Error ? cause.message : 'The prepared report could not be printed.'; }
    finally { busy = false; }
  }
</script>

<dialog data-print-surface class:print-approved={printing} bind:this={dialog} aria-labelledby={id} onclose={onclose}>
  <header class="print-controls"><h2 {id} bind:this={heading} tabindex="-1">Case report preview</h2><button class="btn" type="button" onclick={() => dialog.close()}>Close report preview</button></header>
  {#if !current}<p class="print-controls" role="alert">The Case or report options changed. Close this preview and prepare the current report before downloading or printing.</p>{/if}
  <div class="actions print-controls"><button class="btn" type="button" disabled={!current} onclick={() => ondownload('json')}>Download previewed JSON ({preview.files.json.bytes.toLocaleString()} bytes)</button><button class="btn" type="button" disabled={!current} onclick={() => ondownload('md')}>Download previewed Markdown ({preview.files.md.bytes.toLocaleString()} bytes)</button><button bind:this={printButton} class="btn" type="button" disabled={!current || busy || printing} onclick={() => void printReport()}>Print or save PDF</button></div>
  <p class="print-controls">Printing uses the complete, immutable prepared ordinary report, with all sections expanded. The print dialog does not confirm saving or delivery. Report data digests are not hashes of PDF bytes.</p>
  {#if error}<p class="print-controls" role="alert">{error}</p>{/if}
  <p class="print-guard">Use “Print or save PDF” in a current prepared report before printing.</p>
  <div class="report-content">
  <p>Notes: {preview.report.json.case.notesIncluded ? 'included' : 'excluded'}. Original files and unfinished forms are not included.</p>
  {#if preview.markings.length}<section aria-label="Imported sharing restrictions"><h3>Imported sharing restrictions</h3><ul>{#each preview.markings as marking}<li>{marking}</li>{/each}</ul><p>{preview.strictestMarking ? `Most restrictive recognised marking: ${preview.strictestMarking}.` : 'No recognised TLP marking.'} {preview.unknownMarkings.length ? 'Other restrictions need source-specific review.' : ''} Markings are retained unchanged; they do not encrypt or redact this download.</p></section>{/if}
    <div class="screen-reading"><CaseReportReading report={preview.report.json} /></div>
    <article class="report-print-content" aria-label="Complete prepared ordinary Case report">
      <p>Times retain their source-qualified meaning. ISO times ending in Z are UTC; unknown observation times remain unknown.</p>
      {#each printBlocks as block}
        {#if block.kind === 'heading'}<svelte:element this={`h${block.level}`}>{block.text}</svelte:element>
        {:else if block.kind === 'table'}<table><thead><tr>{#each block.headers as cell}<th scope="col">{cell}</th>{/each}</tr></thead><tbody>{#each block.rows as row}<tr>{#each row as cell}<td>{cell}</td>{/each}</tr>{/each}</tbody></table>
        {:else if block.kind === 'quote'}<blockquote>{block.text}</blockquote>
        {:else}<p class:report-item={block.kind === 'item'} class:indented={block.depth > 0}>{block.kind === 'item' ? '• ' : ''}{block.text}</p>{/if}
      {/each}
    </article>
  </div>
  <details class="screen-reading"><summary>Exact Markdown download</summary>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -- the named scroll region provides keyboard access to the complete report -->
    <div class="text-scroll" role="region" tabindex="0" aria-label="Exact report Markdown"><pre>{preview.files.md.content}</pre></div>
  </details>
  <details class="screen-reading"><summary>Exact JSON download</summary>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -- the named scroll region provides keyboard access to the complete report -->
    <div class="text-scroll" role="region" tabindex="0" aria-label="Exact report JSON"><pre>{preview.files.json.content}</pre></div>
  </details>
</dialog>

<style>
  dialog{width:min(960px,calc(100% - 24px));max-height:calc(100dvh - 24px);padding:24px;border:1px solid var(--border-strong);border-radius:var(--radius-md);background:var(--panel);color:var(--text);overflow:auto;overflow-wrap:anywhere}dialog::backdrop{background:rgb(0 0 0 / .6)}header,.actions{display:flex;align-items:start;justify-content:space-between;gap:12px;flex-wrap:wrap}h2{margin:0;font-family:var(--font-sans)}p,li{line-height:1.6}.actions{justify-content:start;margin-top:20px}details{margin-top:20px}summary{min-height:44px}.text-scroll{max-height:28rem;overflow:auto}.text-scroll:focus-visible{outline:2px solid var(--focus);outline-offset:3px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:var(--text-xs)/1.5 var(--mono)}
  @media(max-width:600px){dialog{padding:16px}.actions button{width:100%}}
  .report-print-content,.print-guard{display:none}
  @media print {
    dialog{position:static!important;inset:auto!important;width:100%!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;overflow:visible!important;background:#fff!important;color:#111!important;font:11pt/1.5 system-ui,sans-serif}
    dialog::backdrop{background:transparent}.print-controls,.screen-reading{display:none!important}
    .print-guard{display:block}.report-content{display:none}
    .print-approved .report-content,.report-print-content{display:block}.print-approved .print-guard{display:none}
    :global(.report-print-content h1){font-size:21pt;line-height:1.2}:global(.report-print-content h2){font-size:16pt;margin-top:22pt}:global(.report-print-content h3){font-size:13pt;margin-top:16pt}:global(.report-print-content h4){font-size:11pt;margin-top:12pt}
    :global(.report-print-content h1),:global(.report-print-content h2),:global(.report-print-content h3),:global(.report-print-content h4){break-after:avoid;overflow-wrap:anywhere}
    p,li,blockquote,td,th{overflow-wrap:anywhere;white-space:pre-wrap;orphans:3;widows:3}
    table{width:100%;border-collapse:collapse;table-layout:fixed;margin-block:12pt;font:10pt/1.4 system-ui,sans-serif}th,td{border:1px solid #bbb;padding:5pt;text-align:left;vertical-align:top}thead{display:table-header-group}tr{break-inside:avoid}
    blockquote{margin:6pt 0;padding-left:10pt;border-left:2pt solid #999}.report-item{margin-bottom:4pt}.indented{margin-left:14pt}
  }
</style>
