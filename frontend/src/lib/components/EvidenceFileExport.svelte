<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import type { SelectedInvestigationFile } from '$lib/investigation-package-worker-model.ts';
  import { runInvestigationPackageWorker } from '$lib/investigation-package-worker.ts';
  import { chooseEvidenceFolderParent, supportsEvidenceFolderWrite, writeBrowserInvestigationFolder } from '$lib/investigation-folder.ts';
  import { downloadLocalFile } from '$lib/download-local-file.ts';
  import EvidencePackageEncryption from './EvidencePackageEncryption.svelte';

  let { getFiles, workflow, disabled = false, onbusy = () => {}, onmessage, requireEncryption = false, validateSelection, allowBagIt = false }: {
    getFiles: (signal: AbortSignal) => Promise<readonly SelectedInvestigationFile[]>;
    workflow: string; disabled?: boolean; onbusy?: (value: boolean) => void; onmessage?: (value: string) => void;
    requireEncryption?: boolean; validateSelection?: () => Promise<void>; allowBagIt?: boolean;
  } = $props();
  let folderSupported = $state(false), busy = $state(false), stopping = $state(false);
  let message = $state(''), error = $state('');
  let encrypted = $state(false);
  let format = $state<'evidence' | 'bagit'>('evidence');
  let encryptionOptions = $state<{ takePassphrase(): string | undefined }>();
  let controller: AbortController | null = null;
  let downloadButton = $state<HTMLButtonElement>();
  let folderButton = $state<HTMLButtonElement>();
  onMount(() => { folderSupported = supportsEvidenceFolderWrite(); });
  onDestroy(() => { controller?.abort(); onbusy(false); });

  async function exportFiles(kind: 'build' | 'folder') {
    if (busy || disabled) return;
    const bagit = allowBagIt && !requireEncryption && format === 'bagit';
    if (bagit && encrypted) { error = 'BagIt is unencrypted. Turn off package encryption explicitly before selecting it.'; return; }
    if (kind === 'folder' && (encrypted || requireEncryption)) { error = 'Choose a package download to keep the selected files encrypted.'; return; }
    const verifyEncrypted = requireEncryption;
    const protect = encrypted || verifyEncrypted;
    let submittedPassphrase: string | undefined;
    try { submittedPassphrase = bagit ? undefined : encryptionOptions?.takePassphrase(); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Enter and confirm the package passphrase.'; return; }
    if (protect && submittedPassphrase === undefined) { error = 'The package encryption controls are unavailable.'; return; }
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
        const prepared = await runInvestigationPackageWorker(bagit ? 'bagitFolder' : 'folder', input, { signal: current.signal });
        await validateSelection?.(); current.signal.throwIfAborted();
        const saved = await writeBrowserInvestigationFolder(parent, prepared, current.signal, bagit ? 'bagit' : 'evidence');
        writtenFolder = saved.name;
        if (bagit) {
          const checked = await runInvestigationPackageWorker('bagitInspectFolder', { files: saved.files }, { signal: current.signal });
          const expected = prepared.files.find(item => item.path === 'tagmanifest-sha512.txt')?.file;
          const actual = saved.files.find(item => item.path === 'tagmanifest-sha512.txt')?.file;
          if (checked.review.state !== 'valid' || !expected || !actual || await expected.text() !== await actual.text()) throw new Error('BagIt folder read-back did not match the prepared export.');
        } else {
          const review = await runInvestigationPackageWorker('inspectFolder', { files: saved.files }, { signal: current.signal });
          if (!review.identityVerified || review.manifest.integrity.digestSha256 !== prepared.manifest.integrity.digestSha256) throw new Error(`Folder ${saved.name} was written, but its read-back verification failed. Inspect it before using or sharing it.`);
        }
        const count = prepared.manifest.artifacts.length;
        message = `Created ${saved.name} and verified ${count} file${count === 1 ? '' : 's'} by reading ${count === 1 ? 'it' : 'them'} back. This is a selected evidence export, not a complete workspace backup.`;
      } else {
        const prepared = bagit ? await runInvestigationPackageWorker('bagitBuild', input, { signal: current.signal })
          : await runInvestigationPackageWorker('build', { ...input, ...(submittedPassphrase === undefined ? {} : { passphrase: submittedPassphrase }) }, { signal: current.signal });
        if (bagit) {
          const checked = await runInvestigationPackageWorker('bagitInspect', { file: prepared.file }, { signal: current.signal });
          if (checked.review.state !== 'valid') throw new Error('The BagIt download did not pass its read-back check. Nothing was downloaded.');
        }
        if (verifyEncrypted) {
          if (submittedPassphrase === undefined) throw new Error('The encrypted handoff passphrase is unavailable. Nothing was downloaded.');
          const checked = await runInvestigationPackageWorker('inspect', { file: prepared.file, passphrase: submittedPassphrase }, { signal: current.signal });
          if (checked.encryption !== 'verified' || !checked.identityVerified || checked.manifest.integrity.digestSha256 !== prepared.manifest.integrity.digestSha256) throw new Error('The encrypted handoff did not pass its independent read-back check. Nothing was downloaded.');
        }
        await validateSelection?.();
        current.signal.throwIfAborted();
        downloadLocalFile(prepared.file, `whoisleuth-${bagit ? 'bagit' : 'evidence'}-${generatedAt.slice(0, 10)}.${protect ? 'wlep' : 'zip'}`);
        const count = prepared.manifest.artifacts.length;
        message = `Prepared ${bagit ? 'an unencrypted BagIt ZIP' : protect ? 'an encrypted package' : 'a private package'} of ${count} unchanged file${count === 1 ? '' : 's'} for download.${verifyEncrypted ? ' The encrypted container and every file passed read-back verification.' : bagit ? ' All declared checksums passed read-back verification.' : ''} Confirm that the download completed; this is not a complete workspace backup.`;
      }
    } catch (cause) {
      if (writtenFolder) error = `Folder ${writtenFolder} was written, but verification did not complete. Inspect it before using or sharing it. No browser records were changed.`;
      else if (cause instanceof DOMException && cause.name === 'AbortError') message = 'Export cancelled. No browser records were changed.';
      else error = cause instanceof Error ? cause.message : 'Evidence export failed. No browser records were changed.';
    } finally {
      submittedPassphrase = undefined;
      if (message) onmessage?.(message);
      if (controller === current) { controller = null; busy = false; stopping = false; onbusy(false); }
      await tick();
      if (document.activeElement === origin || document.activeElement === document.body) trigger?.focus();
    }
  }
</script>

<div class="evidence-export">
  {#if allowBagIt && !requireEncryption}<label class="export-format">Export format<select bind:value={format} disabled={disabled || busy || encrypted} onchange={() => { message = ''; error = ''; onmessage?.(''); }}><option value="evidence">Evidence package</option><option value="bagit">BagIt 1.0</option></select></label>{/if}
  {#if format === 'evidence' || requireEncryption}<EvidencePackageEncryption bind:this={encryptionOptions} bind:encrypted disabled={disabled || busy} required={requireEncryption} />
  {:else}<p>BagIt is unencrypted. It includes unchanged files, SHA-512 manifests and the existing source-declaration manifest. Checksums establish file integrity, not authenticity.</p>{/if}
  <div class="export-actions">
    <button class="primary" bind:this={downloadButton} type="button" disabled={disabled || busy} onclick={() => void exportFiles('build')}>{requireEncryption ? 'Download encrypted Case handoff' : format === 'bagit' ? 'Download BagIt ZIP' : 'Download private package'}</button>
    {#if folderSupported && !requireEncryption}<button class="btn" bind:this={folderButton} type="button" disabled={disabled || busy || encrypted} onclick={() => void exportFiles('folder')}>Write new evidence folder</button>{/if}
    {#if busy}<button class="btn" type="button" disabled={stopping} onclick={() => { stopping = true; controller?.abort(); }}>{stopping ? 'Stopping export…' : 'Cancel export'}</button>{/if}
  </div>
  {#if !requireEncryption}<p>File contents stay unchanged. Ordinary ZIPs and folder exports are unencrypted. A folder export creates a new child inside the folder you choose; it never synchronises in the background.{#if !folderSupported} For an unencrypted folder, extract the downloaded ZIP locally.{/if}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if !onmessage}<p class="export-status" role="status">{message}</p>{/if}
</div>

<style>
  .export-format{display:grid;gap:6px;max-width:28rem;font-size:var(--text-sm)}.export-format select{min-width:0;max-width:100%}
  .evidence-export{display:grid;gap:10px;min-width:0}.export-actions{display:flex;flex-wrap:wrap;gap:8px}.export-actions button{max-width:100%;white-space:normal;overflow-wrap:anywhere}p{margin:0;color:var(--muted);font:400 var(--text-xs)/1.55 var(--font-sans);overflow-wrap:anywhere}.error{color:var(--danger)}.export-status:empty{display:none}
</style>
