<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { LOCAL_WORKSPACE_MAX_DIRECTORY_CHARACTERS } from '../../../../packages/contracts/local-application.mts';
  import { addTemporaryWorkspaceReference, TEMPORARY_WORKSPACE_REFERENCE_COUNT, TEMPORARY_WORKSPACE_LABEL_CHARACTERS,
    type TemporaryWorkspaceReference } from '#lib/analysis/temporary-workspace-references.ts';
  let { workspaceId, directory, formatVersionAtLaunch }: { workspaceId: string; directory: string; formatVersionAtLaunch: number | undefined } = $props();
  let root = $state<HTMLDetailsElement>(), heading = $state<HTMLHeadingElement>();
  let enabled = $state(false), rows = $state.raw<readonly TemporaryWorkspaceReference[]>([]);
  let label = $state(''), path = $state(''), error = $state(''), status = $state('');
  function clear() { rows = []; label = ''; path = ''; error = ''; status = ''; }
  $effect(() => { workspaceId; directory; untrack(() => { enabled = false; clear(); }); });
  onMount(() => {
    const leave = () => { enabled = false; clear(); };
    const closedAncestor = (event: Event) => {
      const disclosure = event.target;
      if (root && disclosure instanceof HTMLDetailsElement && !disclosure.open && disclosure.contains(root)) leave();
    };
    window.addEventListener('pagehide', leave);
    document.addEventListener('toggle', closedAncestor, true);
    return () => { leave(); window.removeEventListener('pagehide', leave); document.removeEventListener('toggle', closedAncestor, true); };
  });
  function add(currentLaunch = false) {
    try {
      rows = addTemporaryWorkspaceReference(rows, { label: currentLaunch ? 'Folder shown by this launch' : label,
        path: currentLaunch ? directory : path, basis: currentLaunch ? 'current_launch' : 'supplied' }, new Date().toISOString());
      label = ''; path = ''; error = ''; status = 'Added a temporary reference. No folder was inspected or opened.';
    } catch (cause) { error = cause instanceof Error ? cause.message : 'The reference could not be added.'; }
  }
  async function remove(id: string) { rows = rows.filter(row => row.id !== id); status = 'Removed the reference only; no folder or file was deleted.'; await tick(); heading?.focus(); }
  async function clearRows() { clear(); status = 'Temporary references cleared; no folder or file was deleted.'; await tick(); heading?.focus(); }
</script>

<details class="temporary-workspace-shortlist" bind:this={root} ontoggle={event => { if (!event.currentTarget.open) { enabled = false; clear(); } }}>
  <summary>Temporary restart shortlist</summary>
  <p>Keep supplied folder references only while this workspace panel is open. Folders are not inspected, opened or switched; paths never become executable commands.</p>
  <label class="opt-in"><input type="checkbox" checked={enabled} onchange={event => { enabled = event.currentTarget.checked; if (!enabled) clear(); }} />Use temporary folder references</label>
  {#if enabled}
    <h3 bind:this={heading} tabindex="-1">Restart references in this page</h3>
    <p>Most recently added first. Up to {TEMPORARY_WORKSPACE_REFERENCE_COUNT} references; this is not a verified history of opened folders.</p>
    <button class="btn" onclick={() => add(true)}>Add displayed launch folder</button>
    <form autocomplete="off" onsubmit={event => { event.preventDefault(); add(); }}>
      <label>Reference label<input maxlength={TEMPORARY_WORKSPACE_LABEL_CHARACTERS} required bind:value={label} /></label>
      <label>Supplied folder reference<input maxlength={LOCAL_WORKSPACE_MAX_DIRECTORY_CHARACTERS} required bind:value={path} autocomplete="off" spellcheck="false" /></label>
      <button class="btn" type="submit">Add supplied reference</button>
    </form>
    {#if error}<p role="alert">{error}</p>{/if}
    {#if status}<p role="status">{status}</p>{/if}
    <ol>{#each rows as row (row.id)}<li>
      <h4>{row.label}</h4><p>{row.basis === 'current_launch' ? 'Folder shown by this launch' : 'Analyst-supplied reference'} · Added <time datetime={row.addedAt}>{row.addedAt}</time></p>
      <p>Format/version:
        {#if row.basis !== 'current_launch'}Not checked
        {:else if formatVersionAtLaunch === undefined}Not provided by this launch
        {:else}{formatVersionAtLaunch} (validated at launch){/if}
        · Lock observation: Unavailable
      </p>
      <details><summary>Reveal supplied path</summary><code>{row.path}</code></details>
      <button class="btn" aria-label={`Remove reference: ${row.label}`} onclick={() => void remove(row.id)}>Remove from shortlist</button>
    </li>{/each}</ol>
    <button class="btn" disabled={!rows.length} onclick={() => void clearRows()}>Clear shortlist</button>
    <p>Remove and clear erase references, not files. Closing this panel, leaving the page or reloading clears all entries and unfinished inputs. Use the fixed reopen examples above and choose the folder yourself in the terminal.</p>
  {/if}
</details>

<style>
  .temporary-workspace-shortlist{margin-block:16px;min-width:0}summary{min-height:44px;align-content:center;cursor:pointer}p{font-size:var(--text-xs);line-height:1.6;color:var(--muted);overflow-wrap:anywhere}
  form{display:grid;gap:10px;margin-block:12px;min-width:0}label{display:grid;gap:6px;font-size:var(--text-xs);min-width:0}.opt-in{display:flex;align-items:center;gap:8px;min-height:44px}input{min-width:0;max-width:100%}
  ol{padding-left:20px;display:grid;gap:14px}li{min-width:0}h3,h4{overflow-wrap:anywhere}h3:focus{outline:2px solid var(--focus);outline-offset:3px}code{white-space:pre-wrap;overflow-wrap:anywhere;font-size:var(--text-xs)}button{max-width:100%;white-space:normal}[role='alert']{color:var(--danger)}
  @media print{.temporary-workspace-shortlist{display:none}}
</style>
