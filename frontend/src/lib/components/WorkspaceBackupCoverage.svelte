<script lang="ts">
  import type { workspaceBackupCoverage } from '../../../../packages/workspace/workspace-recovery.mts';
  let { coverage }: { coverage: ReturnType<typeof workspaceBackupCoverage> } = $props();
</script>

<details class="backup-coverage">
  <summary>Backup contents and recovery limits</summary>
  <p>Reviewed workspace backup v{coverage.sourceVersion}. These are recorded contents, not confirmation of a completed download or restore. Rehearse recovery from your downloaded files to check the destination.</p>
  <h4>Saved records</h4>
  <ul>
    {#each coverage.sections as section (section.id)}
      <li><strong>{section.label}</strong>: {section.recordCount.toLocaleString()} recorded{section.status === 'ready' ? '' : ' · unsupported — cannot restore this section'}
        {#if section.reason}<p>{section.reason}</p>{/if}
      </li>
    {/each}
  </ul>
  <h4>Original files kept separately</h4>
  {#if coverage.originals.state === 'known'}
    <p>{coverage.originals.references.toLocaleString()} Case file {coverage.originals.references === 1 ? 'reference requires' : 'references require'} {coverage.originals.files.toLocaleString()} distinct original {coverage.originals.files === 1 ? 'file' : 'files'} ({coverage.originals.byteLength.toLocaleString()} declared bytes). File bodies are not in the JSON backup. This count does not check whether the originals are available or how many downloaded packages contain them.</p>
  {:else}
    <p>Required original-file coverage is unknown: the Case section or its file references could not be interpreted. Do not treat this as a backup with no original files.</p>
  {/if}
  <h4>Not in this backup</h4>
  <ul>{#each coverage.localOnly as label}<li>{label}</li>{/each}</ul>
  <p>Temporary comparisons, pinned checkpoints, favourites and the navigation trail stay in the current tab. Save unfinished work deliberately before backing up. Preferences can be reviewed during import; a recovery rehearsal does not apply them to this tab.</p>
</details>

<style>
  .backup-coverage{min-width:0;margin-block:14px}summary{cursor:pointer;font-weight:700}h4{font-size:var(--text-sm);margin-block:14px 6px}p,li{font-size:var(--text-xs);line-height:1.55;color:var(--muted);overflow-wrap:anywhere}ul{padding-inline-start:20px}li+li{margin-top:5px}li p{margin-block:4px 8px}
</style>
