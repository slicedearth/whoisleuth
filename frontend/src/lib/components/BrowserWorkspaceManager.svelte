<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { browserWorkspaceDirectory, MAX_BROWSER_WORKSPACE_NAME, type BrowserWorkspace } from '$lib/browser-workspace-directory.ts';
  import { BROWSER_WORKSPACE_DIRECTORY_EVENT, currentBrowserWorkspaceId, DEFAULT_BROWSER_WORKSPACE, DEFAULT_BROWSER_WORKSPACE_NAME, navigateToBrowserWorkspace } from '$lib/browser-workspace-context.ts';
  import { MAX_BROWSER_WORKSPACE_PASSPHRASE_BYTES, MIN_BROWSER_WORKSPACE_PASSPHRASE_CHARACTERS } from '$lib/browser-workspace-encryption-model.ts';
  import BrowserWorkspaceCopy from './BrowserWorkspaceCopy.svelte';
  import { isLocalApplication } from '$lib/local-application-context.ts';
  import LocalApplicationWorkspace from './LocalApplicationWorkspace.svelte';
  let localApplication = $state(false);

  const PAGE_SIZE = 10;
  type Intent = { kind: 'switch'; id: string; name: string } | { kind: 'rename' | 'delete'; workspace: BrowserWorkspace };
  let currentId = $state<string | null>(null);
  let workspaces = $state<readonly BrowserWorkspace[]>([]);
  let available = $state(false);
  let supported = $state(false);
  let busy = $state(false);
  let error = $state('');
  let status = $state('');
  let name = $state('');
  let encrypted = $state(false);
  let passphrase = $state('');
  let repeatedPassphrase = $state('');
  let filter = $state('');
  let page = $state(0);
  let intent = $state<Intent | null>(null);
  let confirmation = $state('');
  let renameValue = $state('');
  let heading = $state<HTMLHeadingElement>();
  let intentHeading = $state<HTMLHeadingElement>();
  let statusNode = $state<HTMLParagraphElement>();
  let returnFocus: HTMLElement | undefined;
  const matching = $derived(workspaces.filter(row => row.name.toLowerCase().includes(filter.toLowerCase())));
  const visible = $derived(matching.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE));

  async function refresh() {
    const rows = await browserWorkspaceDirectory.list();
    workspaces = [...rows].sort((a, b) => a.name.localeCompare(b.name));
    const pending = intent;
    if (pending && pending.kind !== 'switch') {
      const current = rows.find(row => row.id === pending.workspace.id);
      intent = !current || pending.kind === 'rename' && current.state !== 'ready' ? null : { ...pending, workspace: current };
    }
    available = true;
    page = Math.min(page, Math.max(0, Math.ceil(matching.length / PAGE_SIZE) - 1));
  }
  async function load() {
    if (busy) return;
    busy = true; error = '';
    try { await refresh(); status = `Read ${workspaces.length} named workspace${workspaces.length === 1 ? '' : 's'}.`; }
    catch (cause) { available = false; error = cause instanceof Error ? cause.message : 'The workspace directory is unavailable.'; }
    finally { busy = false; }
  }
  onMount(() => {
    localApplication = isLocalApplication();
    if (localApplication) return;
    try { currentId = currentBrowserWorkspaceId(); } catch { currentId = null; }
    supported = browserWorkspaceDirectory.supported();
    void load();
  });
  async function choose(next: Intent, trigger: HTMLElement) {
    returnFocus = trigger; confirmation = ''; renameValue = next.kind === 'rename' ? next.workspace.name : '';
    intent = next; error = ''; status = '';
    await tick(); intentHeading?.focus();
  }
  async function cancel() {
    intent = null;
    await tick();
    (returnFocus?.isConnected ? returnFocus : heading)?.focus();
  }
  async function mutate(action: () => Promise<unknown>, message: string, committed: () => void) {
    if (busy) return;
    busy = true; error = ''; status = '';
    try {
      await action(); committed(); status = message;
      window.dispatchEvent(new Event(BROWSER_WORKSPACE_DIRECTORY_EVENT));
      try { await refresh(); }
      catch { available = false; status = `${message} The directory view could not be refreshed. Refresh it before another change.`; }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'The workspace change could not be confirmed. Refresh the directory before retrying.';
      // An uncertain change or pending deletion must be reread deliberately.
      available = false;
    } finally { busy = false; await tick(); statusNode?.focus(); }
  }
  async function confirm() {
    const selected = intent;
    if (!selected || busy) return;
    if (selected.kind === 'switch') {
      busy = true; error = '';
      try {
        if (selected.id !== DEFAULT_BROWSER_WORKSPACE) await browserWorkspaceDirectory.ready(selected.id);
        navigateToBrowserWorkspace(selected.id);
      } catch (cause) { busy = false; error = cause instanceof Error ? cause.message : 'The workspace could not be opened.'; }
      return;
    }
    if (selected.kind === 'rename') await mutate(() => browserWorkspaceDirectory.rename(selected.workspace, renameValue), 'Workspace renamed.', () => { intent = null; });
    else if (confirmation === selected.workspace.name) await mutate(() => browserWorkspaceDirectory.remove(selected.workspace, currentId ?? DEFAULT_BROWSER_WORKSPACE), 'Workspace data and directory entry deleted.', () => { intent = null; });
  }
  async function create() {
    if (encrypted && passphrase !== repeatedPassphrase) { error = 'The workspace passphrases do not match.'; return; }
    await mutate(() => browserWorkspaceDirectory.create(name, encrypted ? { passphrase } : undefined), 'Workspace created. Open it when ready.', () => {
      name = ''; passphrase = ''; repeatedPassphrase = ''; encrypted = false;
    });
    // Do not retain passphrases in a failed form while the directory is re-read.
    passphrase = ''; repeatedPassphrase = '';
  }
</script>

{#if localApplication}<LocalApplicationWorkspace />{:else}
<section class="workspace-manager" aria-labelledby="workspace-manager-title">
  <h2 id="workspace-manager-title" bind:this={heading} tabindex="-1">Browser workspaces</h2>
  <p>Each workspace has separate Cases, Brands, saved collections and review history. They share this browser profile’s storage quota. Named workspaces can optionally encrypt their saved records with a passphrase.</p>
  <div class="default-workspace"><strong>{DEFAULT_BROWSER_WORKSPACE_NAME}</strong><span>{currentId === DEFAULT_BROWSER_WORKSPACE ? 'Current workspace' : 'Original saved work'}</span>{#if currentId !== DEFAULT_BROWSER_WORKSPACE}<button class="btn" type="button" disabled={busy} onclick={event => choose({ kind: 'switch', id: DEFAULT_BROWSER_WORKSPACE, name: DEFAULT_BROWSER_WORKSPACE_NAME }, event.currentTarget)}>Open default workspace</button>{/if}</div>
  {#if !supported}<p class="notice">Named workspaces require IndexedDB and Web Locks. The default workspace remains available; no data is moved.</p>{/if}
  <form onsubmit={event => { event.preventDefault(); void create(); }}>
    <label>New workspace name<input maxlength={MAX_BROWSER_WORKSPACE_NAME} bind:value={name} disabled={busy || !available || !supported} required></label>
    <label class="encryption-choice"><input type="checkbox" bind:checked={encrypted} disabled={busy || !available || !supported} onchange={() => { passphrase = ''; repeatedPassphrase = ''; }}>Encrypt saved workspace records</label>
    {#if encrypted}
      <fieldset class="encryption-fields" disabled={busy || !available || !supported}>
        <legend>Workspace encryption</legend>
        <label>New workspace passphrase<input type="password" bind:value={passphrase} autocomplete="new-password" maxlength={MAX_BROWSER_WORKSPACE_PASSPHRASE_BYTES} required></label>
        <label>Repeat workspace passphrase<input type="password" bind:value={repeatedPassphrase} autocomplete="new-password" maxlength={MAX_BROWSER_WORKSPACE_PASSPHRASE_BYTES} required></label>
        <p>Use at least {MIN_BROWSER_WORKSPACE_PASSPHRASE_CHARACTERS} characters. Keep the passphrase safely: it is not stored and cannot be reset. Names, collection counts, sizes and timestamps remain visible. Encryption does not protect an unlocked tab from code running on this site or protect downloaded unencrypted exports.</p>
      </fieldset>
    {/if}
    <button class="primary" type="submit" disabled={busy || !available || !supported || !name.trim()}>Create workspace</button>
  </form>
  <div class="directory-tools"><label>Find workspace<input type="search" bind:value={filter} oninput={() => { page = 0; }} disabled={!available || busy}></label><button class="btn" type="button" onclick={load} disabled={busy}>Refresh workspace directory</button></div>
  {#if available}
    <p>{matching.length} of {workspaces.length} named workspaces</p>
    <ul>
      {#each visible as workspace (workspace.id)}
        <li><div><h3>{workspace.name}</h3><p><span>{workspace.id === currentId ? 'Current workspace' : workspace.state === 'deleting' ? 'Deletion pending' : 'Saved in this browser'}</span> · <span>{workspace.encryption ? 'Encrypted records' : 'Unencrypted records'}</span></p></div>
          <div class="workspace-actions">
            {#if workspace.state === 'ready'}
              {#if workspace.id !== currentId}<button class="btn" type="button" aria-label={`Open workspace ${workspace.name}`} disabled={busy || !supported} onclick={event => choose({ kind: 'switch', id: workspace.id, name: workspace.name }, event.currentTarget)}>Open</button>{/if}
              <button class="btn" type="button" aria-label={`Rename workspace ${workspace.name}`} disabled={busy} onclick={event => choose({ kind: 'rename', workspace }, event.currentTarget)}>Rename</button>
            {/if}
            {#if workspace.id !== currentId}<button class="btn" type="button" aria-label={`Delete workspace ${workspace.name}`} disabled={busy || !supported} onclick={event => choose({ kind: 'delete', workspace }, event.currentTarget)}>{workspace.state === 'deleting' ? 'Retry deletion' : 'Delete'}</button>{/if}
          </div>
        </li>
      {/each}
    </ul>
    {#if matching.length > PAGE_SIZE}<nav aria-label="Workspace pages"><button class="btn" type="button" disabled={busy || page === 0} onclick={() => page--}>Previous workspaces</button><span>Page {page + 1} of {Math.ceil(matching.length / PAGE_SIZE)}</span><button class="btn" type="button" disabled={busy || (page + 1) * PAGE_SIZE >= matching.length} onclick={() => page++}>Next workspaces</button></nav>{/if}
  {/if}
  {#if intent}
    <section class="workspace-intent" aria-labelledby="workspace-intent-title">
      <h3 id="workspace-intent-title" tabindex="-1" bind:this={intentHeading}>{intent.kind === 'switch' ? `Open ${intent.name}?` : intent.kind === 'rename' ? `Rename ${intent.workspace.name}` : `Delete ${intent.workspace.name}?`}</h3>
      {#if intent.kind === 'switch'}<p>This opens the workspace in this tab with a fresh Dashboard. Save current edits first: unsaved forms and page results will be left behind. Other tabs keep their own workspace.</p>
      {:else if intent.kind === 'rename'}<label>Workspace name<input maxlength={MAX_BROWSER_WORKSPACE_NAME} bind:value={renameValue} disabled={busy}></label>
      {:else}<p>All saved collections in this workspace will be deleted. Export a backup from that workspace first if you need recovery. Downloaded backups and other workspaces are not deleted. Close every tab using this workspace before continuing.</p><label>Type the workspace name to confirm<input bind:value={confirmation} maxlength={MAX_BROWSER_WORKSPACE_NAME} autocomplete="off" disabled={busy}></label>{/if}
      <div class="intent-actions"><button class="primary" type="button" disabled={busy || intent.kind !== 'switch' && !available || intent.kind === 'delete' && confirmation !== intent.workspace.name || intent.kind === 'rename' && !renameValue.trim()} onclick={confirm}>{intent.kind === 'switch' ? 'Switch workspace' : intent.kind === 'rename' ? 'Save workspace name' : 'Delete workspace data'}</button><button class="btn" type="button" disabled={busy} onclick={cancel}>Cancel workspace change</button></div>
    </section>
  {/if}
  <p bind:this={statusNode} class:error={Boolean(error)} role={error ? 'alert' : 'status'} tabindex="-1">{error || status}</p>
  <p class="recovery">Backups contain the selected workspace’s supported collections, not the workspace directory or tab state. Restore into the workspace you explicitly open. Clearing site data in browser settings removes all workspaces.</p>
  <BrowserWorkspaceCopy disabled={busy || !available || !supported} onbusy={value => busy = value} onchange={() => void load()} />
</section>
{/if}

<style>
  .workspace-manager { min-width: 0; overflow-wrap: anywhere; }
  .workspace-manager h2 { font: 700 var(--text-lg) var(--mono); margin: 0 0 12px; }
  .workspace-manager p { font-size: var(--text-xs); line-height: 1.55; color: var(--muted); }
  .workspace-manager label { display: grid; gap: 5px; font-size: var(--text-xs); min-width: 0; }
  .workspace-manager input { min-width: 0; width: 100%; }
  .default-workspace, .workspace-manager li {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
    gap: 12px; padding: 12px; border: 1px solid var(--border);
    border-radius: var(--radius-sm); background: var(--panel-raised);
  }
  .default-workspace span { font-size: var(--text-xs); color: var(--muted); }
  .workspace-manager form, .directory-tools { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; margin: 18px 0; }
  .workspace-manager form label, .directory-tools label { flex: 1 1 220px; }
  .workspace-manager .encryption-choice{display:flex;align-items:center;gap:8px;flex-basis:100%}
  .workspace-manager .encryption-choice input{width:auto}
  .encryption-fields{display:grid;gap:12px;min-width:0;flex:1 1 100%;border:1px solid var(--border);padding:12px}
  .encryption-fields legend{font-size:var(--text-sm)}
  .workspace-manager ul { list-style: none; padding: 0; display: grid; gap: 10px; }
  .workspace-manager h3 { margin: 0; font-size: var(--text-sm); }
  .workspace-manager li p { margin: 5px 0 0; }
  .workspace-actions, .intent-actions, .workspace-manager nav { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .workspace-manager nav { justify-content: space-between; font-size: var(--text-xs); }
  .workspace-intent { padding: 16px; margin-top: 18px; border: 1px solid var(--border); border-radius: var(--radius-sm); }
  .intent-actions { margin-top: 12px; }
  .workspace-manager .error { color: var(--danger); }
  .workspace-manager [tabindex]:focus { outline: 2px solid var(--focus); outline-offset: 4px; }
  .recovery { margin-bottom: 0; }
  @media (max-width: 500px) {
    .workspace-manager form, .directory-tools { align-items: stretch; flex-direction: column; }
    .workspace-manager form label, .directory-tools label { flex: auto; }
    .workspace-actions, .intent-actions { width: 100%; }
    .workspace-actions button { flex: 1 1 120px; }
    .intent-actions { align-items: stretch; flex-direction: column; }
  }
</style>
