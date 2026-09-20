<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import type { ReviewedWorkspaceArchive } from '../../../../packages/workspace/workspace-recovery.mts';
  import type { WorkspaceRecovery, WorkspaceRecoveryReport } from '$lib/workspace-recovery.ts';
  import { MAX_BROWSER_WORKSPACE_NAME } from '$lib/browser-workspace-directory.ts';
  import { MIN_BROWSER_WORKSPACE_PASSPHRASE_CHARACTERS, MAX_BROWSER_WORKSPACE_PASSPHRASE_BYTES } from '$lib/browser-workspace-encryption-model.ts';
  import { MAX_SELECTED_FILES, MAX_SELECTED_FILE_TOTAL_BYTES } from '../../../../packages/contracts/selected-file-limits.mts';
  import EvidencePackageInput from './EvidencePackageInput.svelte';

  let { readArchive, requireEncryption = false, onbusy = () => {} }: {
    readArchive: () => ReviewedWorkspaceArchive; requireEncryption?: boolean; onbusy?: (value: boolean) => void;
  } = $props();
  let name = $state(`Recovery rehearsal ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
  let encrypted = $state(true), passphrase = $state(''), confirmation = $state('');
  let recovery = $state.raw<WorkspaceRecovery | null>(null), report = $state.raw<WorkspaceRecoveryReport | null>(null);
  let busy = $state(false), message = $state(''), error = $state(''), confirmDelete = $state(false);
  let status = $state<HTMLParagraphElement>();
  let errorStatus = $state<HTMLParagraphElement>();
  let disposed = false;
  onMount(() => {
    const close = () => { void recovery?.close(); };
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
      const { openWorkspaceRecovery, WorkspaceRecoveryStartError } = await import('$lib/workspace-recovery.ts');
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
</script>

<details class="recovery">
  <summary>Rehearse recovery in a separate workspace</summary>
  <p>Restore this reviewed backup without switching workspaces. Section checksums cover saved records and their links; original file bytes must be supplied separately. Preferences are validated in the backup review, not applied to this tab.</p>
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
      <p class="result">{report.caseCount ?? 'Unknown'} Case{report.caseCount === 1 ? '' : 's'} · Case identities {report.identitiesMatch ? 'match' : 'not verified'} · {report.files.verified} of {report.files.expected} unique files verified · {report.files.missing} missing</p>
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
  .recovery{margin-top:18px;border-top:1px solid var(--border);padding-top:14px;min-width:0}summary{cursor:pointer;font-weight:700}p,li{font-size:var(--text-xs);line-height:1.55;color:var(--muted);overflow-wrap:anywhere}form,label{display:grid;gap:6px;min-width:0}form{gap:12px;margin-block:12px}input{min-width:0;max-width:100%}.choice{display:flex;align-items:center;gap:8px}.passwords{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-block:12px}.actions>*{max-width:100%;white-space:normal;overflow-wrap:anywhere}.result{color:var(--text)}h4{overflow-wrap:anywhere}.delete-confirmation{border-left:2px solid var(--danger);padding-left:12px}[role=alert]{color:var(--danger)}.status:empty{display:none}@media(max-width:600px){.passwords{grid-template-columns:minmax(0,1fr)}.actions{display:grid;grid-template-columns:minmax(0,1fr)}}
</style>
