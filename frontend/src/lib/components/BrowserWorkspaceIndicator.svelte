<script lang="ts">
  import { onMount } from 'svelte';
  import { BROWSER_WORKSPACE_DIRECTORY_EVENT, currentBrowserWorkspaceId, DEFAULT_BROWSER_WORKSPACE, DEFAULT_BROWSER_WORKSPACE_NAME } from '$lib/browser-workspace-context.ts';
  let { destination = false }: { destination?: boolean } = $props();
  let name = $state('Loading…');
  onMount(() => {
    let active = true;
    let generation = 0;
    const refresh = async () => {
      const request = ++generation;
      try {
        const id = currentBrowserWorkspaceId();
        if (id === DEFAULT_BROWSER_WORKSPACE) { name = DEFAULT_BROWSER_WORKSPACE_NAME; return; }
        const { browserWorkspaceDirectory } = await import('$lib/browser-workspace-directory.ts');
        const workspace = await browserWorkspaceDirectory.ready(id);
        if (active && request === generation) name = workspace.name;
      } catch { if (active && request === generation) name = 'Unavailable'; }
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

<p class="workspace-scope">{destination ? 'Backup and import workspace:' : 'Workspace:'} <strong>{name}</strong>{#if !destination} <a href="/dashboard#workspaces">Manage workspaces</a>{/if}</p>

<style>
  .workspace-scope{display:flex;flex-wrap:wrap;align-items:baseline;gap:5px 8px;margin:0 0 12px;font-size:var(--text-xs);color:var(--muted);overflow-wrap:anywhere;min-width:0}.workspace-scope strong{color:var(--text);min-width:0}.workspace-scope a{margin-left:auto;color:var(--accent);text-underline-offset:3px}
</style>
