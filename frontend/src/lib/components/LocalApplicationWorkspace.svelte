<script lang="ts">
  import { onMount } from 'svelte';
  import { localApplicationInfo, type LocalApplicationInfo } from '#lib/local-application-storage.ts';
  import { PUBLIC_CLI_GUIDANCE } from '#lib/generated/public-cli-guidance.ts';
  import CopyableCommand from './CopyableCommand.svelte';
  import TemporaryWorkspaceShortlist from './TemporaryWorkspaceShortlist.svelte';
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
      <div><dt>Workspace format at launch</dt><dd>{info.workspaceFormatVersionAtLaunch ?? 'Not provided by this launch'}</dd></div>
      <div><dt>Lock observation</dt><dd>Unavailable</dd></div>
      <div><dt>Collection</dt><dd>{info.offline ? 'Offline — network collection disabled' : 'Available through the local application'}</dd></div>
    </dl>
    <p>Saved records, review drafts and retained evidence files live in this folder. Clearing browser data does not delete them. Appearance preferences and temporary page state still belong to this browser.</p>
    <p>The workspace file is not encrypted. Protect the folder with your operating system’s access controls and disk encryption; use an encrypted export for a portable backup.</p>
    <p>Stop the application in its terminal before moving or deleting the folder. To use another workspace, start the application with that folder and open its new launch link.</p>
    <p>The format was validated when this application opened the folder, not checked again here. Lock status is not observed; a successful launch does not mean no other process holds a lock.</p>
    <details class="restart-guidance">
      <summary>Use another filesystem workspace</summary>
      <ol>
        <li>Save current work and review any unconfirmed write before stopping.</li>
        <li>Stop the application in its terminal with <kbd>Ctrl</kbd> + <kbd>C</kbd>. Closing a browser tab does not stop it.</li>
        <li>Choose the other folder explicitly and reopen it without <code>--init</code>. Open the new private launch link printed in the terminal.</li>
      </ol>
      <p>These fixed examples use <code>./review-workspace</code>, relative to the terminal's launch directory, and keep collection offline. They do not contain your selected folder or private launch link. This page cannot switch folders or stop a process.</p>
      <h3>Reopen an existing workspace</h3>
      <CopyableCommand command={PUBLIC_CLI_GUIDANCE.localArchive.reopen} label="existing filesystem workspace command" />
      <h3>Initialise a new workspace</h3>
      <p>Use <code>--init</code> only when deliberately creating a workspace.</p>
      <CopyableCommand command={PUBLIC_CLI_GUIDANCE.localArchive.initialize} label="new filesystem workspace command" />
    </details>
    <TemporaryWorkspaceShortlist workspaceId={info.workspaceId} directory={info.directory} formatVersionAtLaunch={info.workspaceFormatVersionAtLaunch} />
    <a href="/cli#local-application">Local application setup and recovery</a>
  {:else if error}<p role="alert">{error}</p>
  {:else}<p role="status">Reading filesystem workspace information…</p>{/if}
</section>

<style>
  .local-workspace{min-width:0;overflow-wrap:anywhere}h2{margin:0 0 14px;font-size:var(--text-lg)}dl{display:grid;gap:14px}dt{font-size:var(--text-xs);color:var(--muted)}dd{margin:4px 0 0;min-width:0}code{white-space:normal;overflow-wrap:anywhere;font-size:var(--text-xs)}p{max-width:75ch;font-size:var(--text-sm);line-height:1.6;color:var(--muted)}a{font-size:var(--text-sm)}[role=alert]{color:var(--danger)}
  .restart-guidance { margin-block: 16px; }
  .restart-guidance summary { min-height: 44px; align-content: center; cursor: pointer; }
  .restart-guidance ol { padding-inline-start: 20px; font-size: var(--text-sm); line-height: 1.6; }
  .restart-guidance li + li { margin-top: 8px; }
  .restart-guidance h3 { font-size: var(--text-sm); margin-top: 16px; }
</style>
