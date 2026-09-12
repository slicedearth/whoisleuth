<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import type { SelectedInvestigationFile } from '$lib/investigation-package-worker-model.ts';
  import { runInvestigationPackageWorker } from '$lib/investigation-package-worker.ts';
  import { chooseEvidenceFolderParent, supportsEvidenceFolderWrite, writeBrowserInvestigationFolder } from '$lib/investigation-folder.ts';
  import { downloadLocalFile } from '$lib/download-local-file.ts';

  let { getFiles, workflow, disabled = false, onbusy = () => {}, onmessage }: {
    getFiles: (signal: AbortSignal) => Promise<readonly SelectedInvestigationFile[]>;
    workflow: string; disabled?: boolean; onbusy?: (value: boolean) => void; onmessage?: (value: string) => void;
  } = $props();
  let folderSupported = $state(false), busy = $state(false), stopping = $state(false);
  let message = $state(''), error = $state('');
  let controller: AbortController | null = null;
  let downloadButton = $state<HTMLButtonElement>();
  let folderButton = $state<HTMLButtonElement>();
  onMount(() => { folderSupported = supportsEvidenceFolderWrite(); });
  onDestroy(() => { controller?.abort(); onbusy(false); });

  async function exportFiles(kind: 'build' | 'folder') {
    if (busy || disabled) return;
    const current = new AbortController(); controller = current;
    busy = true; stopping = false; message = ''; error = ''; onbusy(true); onmessage?.('');
    const purpose = workflow;
    const trigger = kind === 'folder' ? folderButton : downloadButton;
    const origin = document.activeElement;
    let writtenFolder: string | null = null;
    try {
      // Obtain permission before awaiting file reads: pickers require the
      // original user activation, not a deferred callback from a worker.
      const parent = kind === 'folder' ? await chooseEvidenceFolderParent() : null;
      current.signal.throwIfAborted();
      const files = await getFiles(current.signal), generatedAt = new Date().toISOString();
      current.signal.throwIfAborted();
      const input = { files, workflow: purpose, generatedAt, applicationVersion: __WHOISLEUTH_VERSION__ };
      if (kind === 'folder' && parent) {
        const prepared = await runInvestigationPackageWorker('folder', input, { signal: current.signal });
        const saved = await writeBrowserInvestigationFolder(parent, prepared, current.signal);
        writtenFolder = saved.name;
        const review = await runInvestigationPackageWorker('inspectFolder', { files: saved.files }, { signal: current.signal });
        if (!review.identityVerified || review.manifest.integrity.digestSha256 !== prepared.manifest.integrity.digestSha256) throw new Error(`Folder ${saved.name} was written, but its read-back verification failed. Inspect it before using or sharing it.`);
        const count = review.entries.length;
        message = `Created ${saved.name} and verified ${count} file${count === 1 ? '' : 's'} by reading ${count === 1 ? 'it' : 'them'} back. This is a selected evidence export, not a complete workspace backup.`;
      } else {
        const prepared = await runInvestigationPackageWorker('build', input, { signal: current.signal });
        current.signal.throwIfAborted();
        downloadLocalFile(prepared.file, `whoisleuth-evidence-${generatedAt.slice(0, 10)}.zip`);
        const count = prepared.manifest.artifacts.length;
        message = `Prepared a private package of ${count} unchanged file${count === 1 ? '' : 's'} for download. Confirm that the download completed; this is not a complete workspace backup.`;
      }
    } catch (cause) {
      if (writtenFolder) error = `Folder ${writtenFolder} was written, but verification did not complete. Inspect it before using or sharing it. No browser records were changed.`;
      else if (cause instanceof DOMException && cause.name === 'AbortError') message = 'Export cancelled. No browser records were changed.';
      else error = cause instanceof Error ? cause.message : 'Evidence export failed. No browser records were changed.';
    } finally {
      if (message) onmessage?.(message);
      if (controller === current) { controller = null; busy = false; stopping = false; onbusy(false); }
      await tick();
      if (document.activeElement === origin || document.activeElement === document.body) trigger?.focus();
    }
  }
</script>

<div class="evidence-export">
  <div class="export-actions">
    <button class="primary" bind:this={downloadButton} type="button" disabled={disabled || busy} onclick={() => void exportFiles('build')}>Download private package</button>
    {#if folderSupported}<button class="btn" bind:this={folderButton} type="button" disabled={disabled || busy} onclick={() => void exportFiles('folder')}>Write new evidence folder</button>{/if}
    {#if busy}<button class="btn" type="button" disabled={stopping} onclick={() => { stopping = true; controller?.abort(); }}>{stopping ? 'Stopping export…' : 'Cancel export'}</button>{/if}
  </div>
  <p>Files are unchanged and unencrypted. A folder export creates a new child inside the folder you choose; it never synchronises in the background.{#if !folderSupported} To use a local folder, extract the downloaded ZIP.{/if}</p>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if !onmessage}<p class="export-status" role="status">{message}</p>{/if}
</div>

<style>
  .evidence-export{display:grid;gap:10px;min-width:0}.export-actions{display:flex;flex-wrap:wrap;gap:8px}.export-actions button{max-width:100%;white-space:normal;overflow-wrap:anywhere}p{margin:0;color:var(--muted);font:400 var(--text-xs)/1.55 var(--font-sans);overflow-wrap:anywhere}.error{color:var(--danger)}.export-status:empty{display:none}
</style>
