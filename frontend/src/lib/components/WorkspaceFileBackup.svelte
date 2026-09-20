<script lang="ts">
  import { readWorkspaceArchive, type WorkspaceArchiveDocument } from '../../../../packages/workspace/workspace-archive.mts';
  import { workspaceAttachmentGroups } from '../../../../packages/workspace/workspace-recovery.mts';
  import type { CaseAttachment } from '../../../../packages/cases/case-attachment-model.mts';
  import { readRetainedCaseFiles } from '$lib/case-attachments.ts';
  import EvidenceFileExport from './EvidenceFileExport.svelte';

  let { archive }: { archive: WorkspaceArchiveDocument } = $props();
  let groups = $state.raw<readonly (readonly CaseAttachment[])[]>([]), selected = $state(0), busy = $state(false), error = $state('');
  const count = $derived(groups.reduce((sum, group) => sum + group.length, 0));
  $effect(() => {
    const current = archive;
    let disposed = false;
    groups = []; selected = 0; error = '';
    void readWorkspaceArchive(current).then(review => {
      if (!disposed) groups = workspaceAttachmentGroups(review);
    }).catch(() => { if (!disposed) error = 'The required file list could not be prepared. This backup has not been checked for complete file coverage.'; });
    return () => { disposed = true; };
  });
  async function getFiles(signal: AbortSignal) {
    const group = groups[selected];
    if (!group?.length) throw new Error('Choose a file group from this backup.');
    const files = await readRetainedCaseFiles(group);
    signal.throwIfAborted();
    // Sources belong to each Case reference in the paired JSON, not one
    // arbitrarily chosen reference to these deduplicated content bytes.
    return files.map(({ file }) => ({ file, mediaType: 'application/octet-stream' as const, source: { identity: null, observedAt: null } }));
  }
</script>

{#if groups.length}
  <details class="file-backup">
    <summary>Back up {count} referenced file{count === 1 ? '' : 's'} separately</summary>
    <p>The JSON backup retains references and provenance, not file bodies. Keep every file group with that backup. Rehearse from the downloaded JSON and packages to confirm coverage.</p>
    <label>Backup file group <select bind:value={selected} disabled={busy}>{#each groups as group, index}<option value={index}>Group {index + 1} of {groups.length} · {group.length} files · {group.reduce((sum, file) => sum + file.byteLength, 0).toLocaleString()} bytes</option>{/each}</select></label>
    <EvidenceFileExport {getFiles} workflow={`Workspace file backup group ${selected + 1} of ${groups.length}`} onbusy={value => { busy = value; }} />
    <p>Package encryption is a separate choice from JSON backup encryption. Enable it for each protected file group and keep its passphrase separately; no completed download is assumed.</p>
  </details>
{/if}
{#if error}<p role="alert">{error}</p>{/if}

<style>
  .file-backup{margin-top:14px;min-width:0}summary{cursor:pointer;font-weight:700}p{font-size:var(--text-xs);line-height:1.55;color:var(--muted);overflow-wrap:anywhere}label{display:grid;gap:6px;margin-block:12px;min-width:0}select{max-width:100%;min-width:0}[role=alert]{color:var(--danger)}
</style>
