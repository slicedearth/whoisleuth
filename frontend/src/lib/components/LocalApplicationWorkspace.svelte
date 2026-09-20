<script lang="ts">
  import { onMount } from 'svelte';
  import { localApplicationInfo, type LocalApplicationInfo } from '$lib/local-application-storage.ts';
  let info = $state<LocalApplicationInfo | null>(null);
  let error = $state('');
  onMount(() => {
    let active = true;
    void localApplicationInfo().then(value => { if (active) info = value; })
      .catch(cause => { if (active) error = cause instanceof Error ? cause.message : 'The filesystem workspace is unavailable.'; });
    return () => { active = false; };
  });
</script>

<section class="local-workspace" aria-labelledby="local-workspace-title">
  <h2 id="local-workspace-title">Filesystem workspace</h2>
  {#if info}
    <dl>
      <div><dt>Selected folder</dt><dd><code>{info.directory}</code></dd></div>
      <div><dt>Workspace ID</dt><dd><code>{info.workspaceId}</code></dd></div>
      <div><dt>Collection</dt><dd>{info.offline ? 'Offline — network collection disabled' : 'Available through the local application'}</dd></div>
    </dl>
    <p>Saved records, review drafts and retained evidence files live in this folder. Clearing browser data does not delete them. Appearance preferences and temporary page state still belong to this browser.</p>
    <p>The workspace file is not encrypted. Protect the folder with your operating system’s access controls and disk encryption; use an encrypted export for a portable backup.</p>
    <p>Stop the application in its terminal before moving or deleting the folder. To use another workspace, start the application with that folder and open its new launch link.</p>
    <a href="/cli#local-application">Local application setup and recovery</a>
  {:else if error}<p role="alert">{error}</p>
  {:else}<p role="status">Reading filesystem workspace information…</p>{/if}
</section>

<style>
  .local-workspace{min-width:0;overflow-wrap:anywhere}h2{margin:0 0 14px;font-size:var(--text-lg)}dl{display:grid;gap:14px}dt{font-size:var(--text-xs);color:var(--muted)}dd{margin:4px 0 0;min-width:0}code{white-space:normal;overflow-wrap:anywhere;font-size:var(--text-xs)}p{max-width:75ch;font-size:var(--text-sm);line-height:1.6;color:var(--muted)}a{font-size:var(--text-sm)}[role=alert]{color:var(--danger)}
</style>
