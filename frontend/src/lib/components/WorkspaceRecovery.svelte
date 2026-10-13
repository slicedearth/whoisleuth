<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { formatRecoverySetInventory, type ReviewedWorkspaceArchive } from '../../../../packages/workspace/workspace-recovery.mts';
  import type { RetainedFileReference } from '../../../../packages/evidence/retained-file.mts';
  import { ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA, ENCRYPTED_WORKSPACE_ARCHIVE_VERSION } from '../../../../packages/contracts/case-portability.mts';
  import type { WorkspaceRecovery, WorkspaceRecoveryReport } from '#lib/workspace-recovery.ts';
  import { MAX_BROWSER_WORKSPACE_NAME } from '#lib/browser-workspace-directory.ts';
  import { MIN_BROWSER_WORKSPACE_PASSPHRASE_CHARACTERS, MAX_BROWSER_WORKSPACE_PASSPHRASE_BYTES } from '#lib/browser-workspace-encryption-model.ts';
  import { MAX_SELECTED_FILES, MAX_SELECTED_FILE_TOTAL_BYTES } from '../../../../packages/contracts/selected-file-limits.mts';
  import { downloadLocalFile } from '#lib/download-local-file.ts';
  import EvidencePackageInput from './EvidencePackageInput.svelte';
  import RecoveryFileChecklist from './RecoveryFileChecklist.svelte';
  import CopyButton from './CopyButton.svelte';

  let { readArchive, archiveFile, archiveSchema, archiveVersion, encryptedSource, requireEncryption = false, onbusy = () => {} }: {
    readArchive: () => ReviewedWorkspaceArchive; requireEncryption?: boolean; onbusy?: (value: boolean) => void;
    archiveFile: RetainedFileReference; archiveSchema: string; archiveVersion: number; encryptedSource: boolean;
  } = $props();
  let name = $state(`Recovery rehearsal ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
  let encrypted = $state(true), passphrase = $state(''), confirmation = $state('');
  let recovery = $state.raw<WorkspaceRecovery | null>(null), report = $state.raw<WorkspaceRecoveryReport | null>(null);
  let busy = $state(false), message = $state(''), error = $state(''), confirmDelete = $state(false);
  let status = $state<HTMLParagraphElement>();
  let errorStatus = $state<HTMLParagraphElement>();
  let disposed = false;
  let inventoryClosed = $state(false);
  let root = $state<HTMLDetailsElement>(), inventory = $state<HTMLDetailsElement>();
  let sourceIndex = $state.raw<WorkspaceRecovery['sourceIndex']>({ originalFiles: 0, packages: [] });
  let sourcePage = $state(1);
  const SOURCE_PAGE_SIZE = 20;
  const sourcePages = $derived(Math.max(1, Math.ceil(sourceIndex.packages.length / SOURCE_PAGE_SIZE)));
  onMount(() => {
    const close = () => { inventoryClosed = true; void recovery?.close(); };
    window.addEventListener('pagehide', close);
    return () => window.removeEventListener('pagehide', close);
  });
  onDestroy(() => { disposed = true; passphrase = ''; confirmation = ''; void recovery?.close(); onbusy(false); });

  async function operation(work: () => Promise<void>) {
    if (busy) return false;
    const origin = document.activeElement;
    busy = true; onbusy(true); message = ''; error = '';
    try { await work(); return true; }
    catch (cause) {
      error = cause instanceof Error ? cause.message : 'Recovery could not be completed.';
      if (recovery?.writeState === 'committed') error += ' The write completed, but this operation did not verify the restored state. Verify the destination before using it; do not repeat the restore.';
      else if (recovery?.writeState === 'unconfirmed') error += ' The write outcome is unconfirmed. Verify the destination or remove the rehearsal; do not repeat the restore.';
      return false;
    } finally {
      if (!disposed) { sourceIndex = recovery?.sourceIndex ?? { originalFiles: 0, packages: [] }; sourcePage = 1; }
      busy = false; onbusy(false); passphrase = ''; confirmation = '';
      await tick();
      if (!disposed && (document.activeElement === origin || document.activeElement === document.body)) (error ? errorStatus : status)?.focus();
    }
  }
  function showReport(value: WorkspaceRecoveryReport) {
    report = value;
    message = value.verified
      ? 'Recovery verified for the selected backup data and every referenced file. The active workspace is unchanged.'
      : 'Restore inspected, but recovery is not fully verified. Review section differences and missing files below.';
  }
  async function start() {
    await operation(async () => {
      const protect = requireEncryption || encrypted;
      if (protect && passphrase !== confirmation) throw new Error('The rehearsal passphrases do not match.');
      const { openWorkspaceRecovery, WorkspaceRecoveryStartError } = await import('#lib/workspace-recovery.ts');
      try {
        const opened = await openWorkspaceRecovery(readArchive(), { name, requireEncryption, ...(protect ? { passphrase } : {}) });
        if (disposed) { await opened.close(); return; }
        recovery = opened;
        showReport(await opened.restore());
      } catch (cause) {
        if (cause instanceof WorkspaceRecoveryStartError) message = `Created ${cause.workspace.name}. It remains visible in Browser workspaces for inspection or deletion.`;
        throw cause;
      }
    });
  }
  async function addFiles(event: Event, kind: 'originals' | 'package') {
    const input = event.currentTarget as HTMLInputElement, files = Array.from(input.files ?? []); input.value = '';
    if (!recovery || !files.length) return;
    await operation(async () => { showReport(await recovery!.addFiles(files, kind)); });
  }
  function downloadInventory() {
    if (busy || disposed || inventoryClosed || !root?.open || !inventory?.open || !inventory.isConnected) return;
    try {
      const content = formatRecoverySetInventory({ ...archiveFile, schema: archiveSchema, version: archiveVersion, encrypted: encryptedSource }, sourceIndex);
      downloadLocalFile(new Blob([content], { type: 'text/plain;charset=utf-8' }), 'whoisleuth-recovery-set.txt');
      message = 'Prepared the recovery set inventory. Check the downloaded file before sharing; recovery verification is separate.';
    } catch { error = 'The recovery set inventory could not be prepared. No saved data was changed.'; }
  }
</script>

<details class="recovery" bind:this={root}>
  <summary>Rehearse recovery in a separate workspace</summary>
  <p>Restore this reviewed backup without switching workspaces. Section checksums cover saved records and their links; original file bytes must be supplied separately. Preferences are validated in the backup review, not applied to this tab.</p>
  <details class="set-index" bind:this={inventory}>
    <summary>Recovery set index</summary>
    <p>This index identifies selected bytes, not completed downloads or writes. Use the recovery result below to check the destination.</p>
    <p>Download an unencrypted plain-text copy to keep with your backup. Digests can correlate private files; review before sharing. No filenames, paths, Case details or original contents are included.</p>
    <button class="btn" type="button" disabled={busy || inventoryClosed} onclick={downloadInventory}>Download recovery set inventory</button>
    <section aria-label="Selected workspace backup">
      <h4>Selected workspace backup</h4>
      <p><code>{archiveSchema}</code> v{archiveVersion}{#if encryptedSource} inside <code>{ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA}</code> v{ENCRYPTED_WORKSPACE_ARCHIVE_VERSION}{/if}</p>
      <p><code>{archiveFile.digestSha256}</code> · {archiveFile.byteLength.toLocaleString()} bytes{encryptedSource ? ' (encrypted file)' : ''}</p>
      <CopyButton value={archiveFile.digestSha256} label="Copy SHA-256" description="Copy selected backup SHA-256" />
    </section>
    <section aria-label="Matching recovery sources">
      <h4>Matching recovery sources</h4>
      <p>{sourceIndex.packages.length} package{sourceIndex.packages.length === 1 ? '' : 's'} · {sourceIndex.originalFiles} original file{sourceIndex.originalFiles === 1 ? '' : 's'} supplied directly.</p>
      <p>Each original uses its latest matching selection. Re-selecting files can replace a package in this index; saved provenance is unchanged. An unreadable or unmatched selection does not join the set. Format checks do not establish source authenticity.</p>
      <ol start={(sourcePage - 1) * SOURCE_PAGE_SIZE + 1}>
        {#each sourceIndex.packages.slice((sourcePage - 1) * SOURCE_PAGE_SIZE, sourcePage * SOURCE_PAGE_SIZE) as item (item.digestSha256)}
          <li><p><code>{item.manifestSchema}</code> v{item.manifestVersion} · {item.encryptionVersion === null ? 'ZIP' : `Encrypted package v${item.encryptionVersion}`} · {item.matchedFiles} matched original{item.matchedFiles === 1 ? '' : 's'}</p>
            <p><code>{item.digestSha256}</code> · {item.byteLength.toLocaleString()} bytes</p>
            <CopyButton value={item.digestSha256} label="Copy SHA-256" description={`Copy recovery package SHA-256 ${item.digestSha256}`} />
          </li>
        {/each}
      </ol>
      {#if sourcePages > 1}<nav aria-label="Recovery package pages">
        <button class="btn" type="button" disabled={sourcePage === 1} onclick={() => sourcePage--}>Previous packages</button>
        <span>Page {sourcePage} of {sourcePages}</span>
        <button class="btn" type="button" disabled={sourcePage === sourcePages} onclick={() => sourcePage++}>Next packages</button>
      </nav>{/if}
    </section>
  </details>
  {#if !recovery}
    <form onsubmit={event => { event.preventDefault(); void start(); }}>
      <label>Rehearsal workspace name <input bind:value={name} maxlength={MAX_BROWSER_WORKSPACE_NAME} required disabled={busy}></label>
      <label class="choice"><input type="checkbox" checked={requireEncryption || encrypted} onchange={event => { encrypted = event.currentTarget.checked; }} disabled={busy || requireEncryption}> Encrypt rehearsal workspace</label>
      {#if requireEncryption || encrypted}
        <div class="passwords">
          <label>Rehearsal passphrase <input type="password" bind:value={passphrase} autocomplete="new-password" minlength={MIN_BROWSER_WORKSPACE_PASSPHRASE_CHARACTERS} maxlength={MAX_BROWSER_WORKSPACE_PASSPHRASE_BYTES} required disabled={busy}></label>
          <label>Confirm rehearsal passphrase <input type="password" bind:value={confirmation} autocomplete="new-password" minlength={MIN_BROWSER_WORKSPACE_PASSPHRASE_CHARACTERS} maxlength={MAX_BROWSER_WORKSPACE_PASSPHRASE_BYTES} required disabled={busy}></label>
        </div>
        <p>Keep the passphrase if you retain this workspace. It is not saved or recoverable.</p>
      {/if}
      <button class="primary" type="submit" disabled={busy}>Create rehearsal and restore</button>
    </form>
  {:else}
    <h4>{recovery.workspace.name}</h4>
    <p>Other tabs cannot open this workspace until you finish the rehearsal. Leaving the page keeps its data; keep or delete it deliberately when finished.</p>
    {#if report}
      <p class="result">Last completed verification: {report.caseCount ?? 'Unknown'} Case{report.caseCount === 1 ? '' : 's'} · Case identities {report.identitiesMatch ? 'match' : 'not verified'} · {report.files.verified} of {report.files.expected} unique files verified · {report.files.missing} missing · {report.files.unverified} unverified</p>
      <RecoveryFileChecklist files={report.files.checklist} />
      <details><summary>Section comparison</summary><ul>
        {#each report.sections as section}<li><strong>{section.label}</strong>: {section.state === 'exact' ? 'Checksum matches' : section.state === 'migrated' ? 'Migrated format — review normalised data' : section.state === 'changed' ? 'Data differs from the backup' : 'Not restored'} · {section.records ?? 'Unknown'} of {section.expectedRecords} records</li>{/each}
      </ul>{#if report.omissions}<p>{report.omissions} skipped or omitted records prevent complete recovery verification.</p>{/if}</details>
    {/if}
    <div class="actions">
      <label class="btn file-btn">Restore original files<input type="file" multiple disabled={busy} onchange={event => void addFiles(event, 'originals')}></label>
      <button class="btn" type="button" disabled={busy} onclick={() => void operation(async () => { showReport(await recovery!.verify()); })}>Verify restored data</button>
    </div>
    <EvidencePackageInput label="Restore evidence package" disabled={busy} onreview={(file, secret) => operation(async () => { showReport(await recovery!.addFiles([file], 'package', secret)); })} />
    <p>Up to {MAX_SELECTED_FILES} files and {MAX_SELECTED_FILE_TOTAL_BYTES / 1024 / 1024} MiB per operation, plus package metadata and encryption overhead. Add further groups as needed; matches use content, not filenames.</p>
    <div class="actions">
      <button class="btn" type="button" disabled={busy} onclick={() => void operation(async () => { const saved = recovery!; await saved.close(); recovery = null; report = null; message = `Kept ${saved.workspace.name}. Open it from Browser workspaces when needed.`; })}>Keep rehearsal workspace</button>
      <button class="btn" type="button" disabled={busy} aria-expanded={confirmDelete} onclick={() => { confirmDelete = !confirmDelete; }}>Delete rehearsal workspace</button>
    </div>
    {#if confirmDelete}<div class="delete-confirmation"><p>Delete <strong>{recovery.workspace.name}</strong> and all data restored into it? The downloaded backup and active workspace remain unchanged.</p><button class="btn" type="button" disabled={busy} onclick={() => void operation(async () => { await recovery!.remove(); recovery = null; report = null; confirmDelete = false; message = 'Rehearsal workspace deleted. The active workspace is unchanged.'; })}>Confirm rehearsal deletion</button></div>{/if}
  {/if}
  {#if error}<p bind:this={errorStatus} role="alert" tabindex="-1">{error}</p>{/if}
  <p bind:this={status} class="status" role="status" tabindex="-1">{message}</p>
</details>

<style>
  .set-index{margin-block:14px}.set-index section,.set-index li{min-width:0}.set-index h4{margin-block:12px 6px}.set-index ol{padding-inline-start:22px}.set-index code{overflow-wrap:anywhere;word-break:break-all}.set-index nav{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
  .recovery{margin-top:18px;border-top:1px solid var(--border);padding-top:14px;min-width:0}summary{cursor:pointer;font-weight:700}p,li{font-size:var(--text-xs);line-height:1.55;color:var(--muted);overflow-wrap:anywhere}form,label{display:grid;gap:6px;min-width:0}form{gap:12px;margin-block:12px}input{min-width:0;max-width:100%}.choice{display:flex;align-items:center;gap:8px}.passwords{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-block:12px}.actions>*{max-width:100%;white-space:normal;overflow-wrap:anywhere}.result{color:var(--text)}h4{overflow-wrap:anywhere}.delete-confirmation{border-left:2px solid var(--danger);padding-left:12px}[role=alert]{color:var(--danger)}.status:empty{display:none}@media(max-width:600px){.passwords{grid-template-columns:minmax(0,1fr)}.actions{display:grid;grid-template-columns:minmax(0,1fr)}}
</style>
