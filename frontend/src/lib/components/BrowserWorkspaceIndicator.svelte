<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { BROWSER_WORKSPACE_DIRECTORY_EVENT, currentBrowserWorkspaceId, DEFAULT_BROWSER_WORKSPACE, DEFAULT_BROWSER_WORKSPACE_NAME } from '#lib/browser-workspace-context.ts';
  import BrowserWorkspaceLock from './BrowserWorkspaceLock.svelte';
  import { isLocalApplication } from '#lib/local-application-context.ts';
  let { destination = false, compact = false, layout }: {
    destination?: boolean;
    compact?: boolean;
    layout?: Snippet<[identity: Snippet, markerControls: Snippet]>;
  } = $props();
  let name = $state('Loading…');
  let encrypted = $state(false);
  let selectedId = $state<string | null>(null);
  let localApplication = $state(false);
  let marker = $state('none');
  let identity: string | null = null;
  function resolveIdentity(key: string | null, label: string, id: string | null = null, protectedWorkspace = false) {
    if (key !== identity || key === null) marker = 'none';
    identity = key; name = label; selectedId = id; encrypted = protectedWorkspace;
  }
  onMount(() => {
    localApplication = isLocalApplication();
    let active = true;
    let generation = 0;
    const refresh = async () => {
      const request = ++generation;
      try {
        if (localApplication) {
          const { localApplicationInfo } = await import('#lib/local-application-storage.ts');
          await localApplicationInfo();
          if (active && request === generation) resolveIdentity('filesystem', 'Filesystem workspace');
          return;
        }
        const id = currentBrowserWorkspaceId();
        if (id === DEFAULT_BROWSER_WORKSPACE) { resolveIdentity(id, DEFAULT_BROWSER_WORKSPACE_NAME); return; }
        const { browserWorkspaceDirectory } = await import('#lib/browser-workspace-directory.ts');
        const workspace = await browserWorkspaceDirectory.ready(id);
        if (active && request === generation) resolveIdentity(workspace.id, workspace.name, workspace.id, Boolean(workspace.encryption));
      } catch { if (active && request === generation) resolveIdentity(null, 'Unavailable'); }
    };
    void refresh();
    window.addEventListener(BROWSER_WORKSPACE_DIRECTORY_EVENT, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener(BROWSER_WORKSPACE_DIRECTORY_EVENT, refresh);
      window.removeEventListener('focus', refresh);
    };
  });
</script>

{#snippet identityView()}
<div class="workspace-scope" class:compact role={compact ? 'note' : undefined} aria-label={compact ? 'Active workspace' : undefined}>
  {destination ? 'Backup and import workspace:' : 'Workspace ·'}
  {#if !destination && marker !== 'none'}<span class="workspace-marker" class:blue={marker === 'blue'} class:violet={marker === 'violet'} class:amber={marker === 'amber'} aria-hidden="true"></span>{/if}
  <strong>{name}</strong>
  {#if !destination}
    {#if encrypted && selectedId}<BrowserWorkspaceLock id={selectedId} />{/if}
    <a href="/dashboard#workspaces">{localApplication ? 'Workspace details' : 'Manage workspaces'}</a>
  {/if}
</div>
{/snippet}

{#snippet markerControls()}
  {#if !destination}
    <details class="marker-preview">
      <summary>Workspace marker</summary>
      <label>Temporary marker <select bind:value={marker} disabled={name === 'Loading…' || name === 'Unavailable'}><option value="none">None</option><option value="blue">Blue</option><option value="violet">Violet</option><option value="amber">Amber</option></select></label>
      <p>Reload clears this preview. Colour does not indicate protection, permission or risk.</p>
    </details>
  {/if}
{/snippet}

{#if layout}{@render layout(identityView, markerControls)}{:else}{@render identityView()}{/if}

<style>
  .workspace-scope{display:flex;flex-wrap:wrap;align-items:baseline;gap:5px 8px;margin:0 0 12px;font-size:var(--text-xs);color:var(--muted);overflow-wrap:anywhere;min-width:0}.workspace-scope strong{color:var(--text);min-width:0}.workspace-scope a{margin-left:auto;color:var(--accent);text-underline-offset:3px}
  .workspace-scope.compact{margin:0;flex:1 1 22rem}
  .workspace-scope.compact strong{font-weight:600}
  .workspace-marker { width: 10px; height: 10px; flex: 0 0 10px; border-radius: 50%; align-self: center; }
  .workspace-marker.blue { background: #3687c4; } .workspace-marker.violet { background: #926dc9; } .workspace-marker.amber { background: #bc852d; }
  .marker-preview { min-width: 0; }
  .marker-preview summary { min-height: 44px; display: list-item; align-content: center; cursor: pointer; }
  .marker-preview[open] { flex-basis: 100%; }
  .marker-preview label { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .marker-preview select { min-height: 44px; width: auto; max-width: 100%; }
  .marker-preview p { margin: 8px 0; }
  @media print { .marker-preview, .workspace-marker { display: none; } }
</style>
