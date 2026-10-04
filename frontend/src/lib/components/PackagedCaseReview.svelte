<script lang="ts">
  import { onMount } from 'svelte';
  import type { readPackagedCaseReview } from '#lib/case-review-package.ts';
  import { buildCaseReport } from '../../../../packages/cases/case-report.mts';
  import { supportsArtifactPreview } from '#lib/artifact-preview.ts';
  import { downloadLocalFile } from '#lib/download-local-file.ts';
  import CaseReportReading from './CaseReportReading.svelte';
  import CaseAssessmentComparison from './CaseAssessmentComparison.svelte';
  import ArtifactPreview from './ArtifactPreview.svelte';
  let { review, onclose }: { review: Awaited<ReturnType<typeof readPackagedCaseReview>>; onclose: () => void } = $props();
  const id = $props.id();
  let dialog: HTMLDialogElement;
  let heading: HTMLHeadingElement;
  let activeFile = $state('');
  const report = $derived(buildCaseReport(review.record, { includeNotes: true, applicationVersion: __WHOISLEUTH_VERSION__, generatedAt: review.record.updatedAt }).json);
  onMount(() => { dialog.showModal(); heading.focus({ preventScroll: true }); return () => dialog.close(); });
</script>

<dialog bind:this={dialog} aria-labelledby={id} onclose={onclose}>
  <header><h2 {id} bind:this={heading} tabindex="-1">Temporary Case review</h2><button type="button" class="btn" onclick={() => dialog.close()}>Return to package</button></header>
  <p>Read-only packaged evidence. No saved workspace is read or changed. Close the package to clear its decrypted contents from this page.</p>
  <CaseReportReading {report} timeLabel="retained Case update" />
  <CaseAssessmentComparison record={review.record} />
  <section aria-label="Packaged original files"><h3>Original files · {review.attachments.length}</h3>
    <ul>{#each review.attachments as item}<li><h4>{item.attachment.fileName}</h4><p>{item.attachment.source} · {item.attachment.byteLength.toLocaleString()} bytes</p><p>SHA-256: <code>{item.attachment.digestSha256}</code></p>
      {#if !item.entries.length}<p>Matching bytes are not in this package. No other workspace was searched.</p>{/if}
      {#each item.entries as entryId}
        {@const file = review.files.get(entryId)}
        {@const selection = `${item.attachment.id}:${entryId}`}
        {#if file}<div class="file-actions"><button class="btn" type="button" onclick={() => downloadLocalFile(file, `${entryId}.bin`)}>Download original {entryId}</button>
          {#if supportsArtifactPreview(item.attachment.mediaType)}<button class="btn" type="button" aria-expanded={activeFile === selection} onclick={() => activeFile = activeFile === selection ? '' : selection}>View original {entryId}</button>{/if}</div>
          {#if activeFile === selection}<ArtifactPreview {file} mediaType={item.attachment.mediaType} label={item.attachment.fileName} />{/if}
        {/if}
      {/each}
    </li>{/each}</ul>
  </section>
  <details><summary>Exact Case document</summary><pre>{review.document}</pre></details>
</dialog>

<style>
  dialog{width:min(1080px,calc(100% - 24px));max-height:calc(100dvh - 24px);padding:24px;border:1px solid var(--border-strong);border-radius:var(--radius-md);background:var(--panel);color:var(--text);overflow:auto;overflow-wrap:anywhere}dialog::backdrop{background:rgb(0 0 0 / .6)}header,.file-actions{display:flex;align-items:start;gap:12px;flex-wrap:wrap}header{justify-content:space-between}h2,h3,h4{font-family:var(--font-sans);margin-block:0 8px}p,li{line-height:1.6}li{margin-block:20px}code{overflow-wrap:anywhere}summary{min-height:44px}pre{max-height:28rem;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:var(--text-xs)/1.5 var(--mono)}
  @media(max-width:600px){dialog{padding:16px}.file-actions button{width:100%}}
</style>
