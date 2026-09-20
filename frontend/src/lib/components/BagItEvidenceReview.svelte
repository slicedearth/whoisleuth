<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { runInvestigationPackageWorker } from '$lib/investigation-package-worker.ts';
  import type { BrowserBagItReview } from '$lib/investigation-package-worker-model.ts';
  import { selectedBagItFolderFiles } from '$lib/investigation-folder.ts';
  import { MAX_BAGIT_ZIP_BYTES } from '../../../../packages/interchange/bagit.mts';
  import { downloadLocalFile } from '$lib/download-local-file.ts';

  let { disabled = false, onbusy = () => {} }: { disabled?: boolean; onbusy?: (value: boolean) => void } = $props();
  let review = $state.raw<BrowserBagItReview | null>(null);
  let busy = $state(false), error = $state(''), message = $state(''), page = $state(0);
  let heading = $state<HTMLHeadingElement>();
  let controller: AbortController | null = null;
  let trigger: HTMLInputElement | null = null;
  const rows = $derived(review?.review.entries.slice(page * 8, (page + 1) * 8) ?? []);
  onDestroy(() => { controller?.abort(); onbusy(false); });

  async function choose(event: Event, folder: boolean) {
    const input = event.currentTarget as HTMLInputElement;
    if (!input.files?.length || busy || disabled) { input.value = ''; return; }
    const selection = input.files;
    review = null; page = 0; error = ''; message = ''; trigger = input;
    const current = new AbortController(); controller = current; busy = true; onbusy(true);
    try {
      if (folder) {
        const files = selectedBagItFolderFiles(selection); input.value = '';
        review = await runInvestigationPackageWorker('bagitInspectFolder', { files }, { signal: current.signal });
      } else {
        const file = selection[0]!; input.value = '';
        if (file.size < 22 || file.size > MAX_BAGIT_ZIP_BYTES) throw new TypeError('Select one BagIt ZIP within the supported file limits.');
        review = await runInvestigationPackageWorker('bagitInspect', { file }, { signal: current.signal });
      }
      if (current.signal.aborted) { review = null; return; }
      message = `BagIt review complete: ${review.review.state}. Nothing was fetched or imported.`;
      await tick(); if (!current.signal.aborted) heading?.focus();
    } catch (cause) { if (!current.signal.aborted) error = cause instanceof Error ? cause.message : 'BagIt could not be reviewed.'; }
    finally { input.value = ''; if (controller === current) { controller = null; busy = false; onbusy(false); } }
  }
  async function close() {
    controller?.abort(); controller = null; busy = false; onbusy(false); review = null; error = '';
    message = 'BagIt review closed. No saved records were changed.';
    await tick(); trigger?.focus();
  }
</script>

<section class="bagit-review" aria-label="BagIt verification">
  <p>Verify BagIt 1.0 with UTF-8 tags and SHA-256 or SHA-512. Files stay local. Missing files listed in <code>fetch.txt</code> are reported, never downloaded. Use a ZIP for an empty payload directory.</p>
  <div class="inputs"><label>Review BagIt ZIP<input type="file" accept="application/zip,.zip" disabled={busy || disabled} onchange={event => void choose(event, false)}></label>
    <label>Review BagIt folder<input type="file" webkitdirectory multiple disabled={busy || disabled} onchange={event => void choose(event, true)}></label></div>
  {#if busy}<button class="btn" type="button" onclick={close}>Cancel BagIt review</button>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <p class="message" role="status">{message}</p>
  {#if review}
    <h3 bind:this={heading} tabindex="-1">BagIt result: {review.review.state}</h3>
    <dl><div><dt>Present payload</dt><dd>{review.review.entries.filter(entry => entry.byteLength !== null).length} of {review.review.entries.length} files · {review.review.payloadBytes.toLocaleString('en-AU')} bytes</dd></div>
      <div><dt>Completeness</dt><dd>{review.review.complete ? 'Complete BagIt structure' : 'Structure is incomplete or inconsistent'}</dd></div>
      <div><dt>Checksums</dt><dd>{review.review.checksumsVerified ? 'All declared checksums match' : 'Verification is not complete'} · {review.review.algorithms.join(', ') || 'No supported algorithm'}</dd></div>
      <div><dt>Tag files</dt><dd>{review.review.verifiedTagFiles} of {review.review.tagFiles} have matching checksums</dd></div>
      <div><dt>Fetch declarations</dt><dd>{review.review.fetchEntries} entries · {review.review.fetchMissing} files absent · No requests made</dd></div>
      <div><dt>Unsupported manifests</dt><dd>{review.review.unsupportedManifests}</dd></div></dl>
    <p>File integrity does not establish source identity, trusted time or factual accuracy. Payload formats are not validated here. Files are download-only and nothing has been imported.</p>
    {#if review.review.issues.length}<ul>{#each review.review.issues as issue}<li>{issue}</li>{/each}</ul>{/if}
    <ul class="entries">{#each rows as entry (entry.id)}<li><span><strong>{entry.id}</strong> · {entry.state} · {entry.byteLength === null ? 'unknown size' : `${entry.byteLength.toLocaleString('en-AU')} bytes`}</span>
      {#if review.contents.has(entry.id)}<button class="btn" type="button" onclick={() => { const file = review?.contents.get(entry.id); if (file) { downloadLocalFile(file, `${entry.id}.bin`); message = `Prepared ${entry.id} for download. Confirm that the download completed.`; } }}>Download {entry.id}</button>{/if}</li>{/each}</ul>
    {#if review.review.entries.length > 8}<nav aria-label="BagIt entries"><button class="btn" type="button" disabled={page === 0} onclick={() => page--}>Previous entries</button><span>Page {page + 1} of {Math.ceil(review.review.entries.length / 8)}</span><button class="btn" type="button" disabled={(page + 1) * 8 >= review.review.entries.length} onclick={() => page++}>Next entries</button></nav>{/if}
    <button class="btn" type="button" onclick={close}>Close BagIt review</button>
  {/if}
</section>

<style>
  .bagit-review{display:grid;gap:12px;min-width:0;margin-block:12px;overflow-wrap:anywhere}.bagit-review p{margin:0;font-size:var(--text-xs);line-height:1.55;color:var(--muted)}.inputs,dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.inputs label{display:grid;gap:6px;min-width:0;font-size:var(--text-sm)}input{min-width:0;max-width:100%}dl{margin:0;font-size:var(--text-xs);line-height:1.55}dt{font-weight:700}dd{margin:2px 0 0;color:var(--muted)}h3{margin:0}h3:focus{outline:2px solid var(--focus);outline-offset:4px}.entries{list-style:none;padding:0;margin:0;display:grid;gap:8px}.entries li,nav{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}.entries li{padding-block:8px;border-bottom:1px solid var(--border);font-size:var(--text-xs)}button{max-width:100%;white-space:normal;overflow-wrap:anywhere}.message:empty{display:none}.bagit-review .error{color:var(--danger)}@media(max-width:700px){.inputs,dl{grid-template-columns:minmax(0,1fr)}nav{display:grid;grid-template-columns:minmax(0,1fr)}}
</style>
