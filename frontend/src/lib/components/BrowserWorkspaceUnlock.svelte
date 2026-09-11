<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { currentBrowserWorkspaceId } from '$lib/browser-workspace-context.ts';
  import { browserWorkspaceDirectory } from '$lib/browser-workspace-directory.ts';
  import { unlockCurrentBrowserWorkspace } from '$lib/browser-workspace-unlock.ts';
  import ThemeSelector from './ThemeSelector.svelte';
  import { MAX_BROWSER_WORKSPACE_PASSPHRASE_BYTES } from '$lib/browser-workspace-encryption-model.ts';
  let { onunlock }: { onunlock: () => Promise<void> } = $props();
  let name = $state('Encrypted workspace');
  let passphrase = $state('');
  let busy = $state(false);
  let error = $state('');
  let input = $state<HTMLInputElement>();
  const lifetime = new AbortController();
  onMount(() => {
    void browserWorkspaceDirectory.ready(currentBrowserWorkspaceId()).then(workspace => {
      if (!lifetime.signal.aborted) name = workspace.name;
    }).catch(() => {});
    input?.focus();
    return () => { lifetime.abort(); passphrase = ''; };
  });
  async function unlock() {
    if (busy) return;
    busy = true; error = '';
    try {
      await unlockCurrentBrowserWorkspace(passphrase, lifetime.signal);
      passphrase = '';
      await onunlock();
    } catch (cause) {
      if (!lifetime.signal.aborted) error = cause instanceof Error ? cause.message : 'The workspace could not be unlocked.';
    } finally {
      passphrase = ''; busy = false;
      if (!lifetime.signal.aborted) { await tick(); input?.focus(); }
    }
  }
</script>

<section class="workspace-unlock" aria-labelledby="workspace-unlock-title">
  <div class="unlock-appearance"><ThemeSelector /></div>
  <h1 id="workspace-unlock-title">Unlock {name}</h1>
  <p>Saved records stay encrypted until you unlock this workspace in this tab. Reloading, leaving the console or locking it removes this tab’s unlocked state.</p>
  <form onsubmit={event => { event.preventDefault(); void unlock(); }}>
    <label>Workspace passphrase<input bind:this={input} type="password" bind:value={passphrase} autocomplete="current-password" maxlength={MAX_BROWSER_WORKSPACE_PASSPHRASE_BYTES} disabled={busy} required></label>
    <button class="primary" type="submit" disabled={busy || !passphrase}>{busy ? 'Unlocking…' : 'Unlock workspace'}</button>
  </form>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <p>There is no passphrase reset. A separately encrypted backup can be restored into a new workspace using its own backup passphrase. Workspace names and storage metadata are not encrypted.</p>
</section>

<style>
  .workspace-unlock{min-width:0;overflow-wrap:anywhere;text-align:left}
  .unlock-appearance{display:flex;justify-content:flex-end;margin-bottom:12px}
  h1{font:700 var(--text-lg) var(--mono);margin:0 0 14px}
  p{font-size:var(--text-sm);line-height:1.6;color:var(--muted)}
  form,label{display:grid;gap:10px;min-width:0}form{margin:20px 0}label{font-size:var(--text-sm)}
  input{width:100%;min-width:0}.error{color:var(--danger)}
</style>
