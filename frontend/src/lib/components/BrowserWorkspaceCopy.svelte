<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { MAX_BROWSER_WORKSPACE_NAME } from '$lib/browser-workspace-directory.ts';
  import { MAX_BROWSER_WORKSPACE_PASSPHRASE_BYTES, MIN_BROWSER_WORKSPACE_PASSPHRASE_CHARACTERS } from '$lib/browser-workspace-encryption-model.ts';
  import type { BrowserWorkspaceCopy, BrowserWorkspaceCopyReport } from '$lib/browser-workspace-copy.ts';

  let { disabled = false, onbusy = () => {}, onchange = () => {} }: { disabled?: boolean; onbusy?: (value: boolean) => void; onchange?: () => void } = $props();
  let name = $state(''), passphrase = $state(''), confirmation = $state(''), busy = $state(false), message = $state(''), error = $state('');
  let copy = $state.raw<BrowserWorkspaceCopy | null>(null), report = $state.raw<BrowserWorkspaceCopyReport | null>(null);
  let status = $state<HTMLParagraphElement>();
  let disposed = false;
  onMount(() => {
    const close = () => { void copy?.close(); };
    window.addEventListener('pagehide', close);
    return () => window.removeEventListener('pagehide', close);
  });
  onDestroy(() => { disposed = true; passphrase = ''; confirmation = ''; void copy?.close(); onbusy(false); });
  function show(result: BrowserWorkspaceCopyReport) {
    report = result;
    message = result.verified ? 'Encrypted copy verified against the saved source records and every referenced original.'
      : 'The copy is not fully verified. Review the differences and missing originals before relying on it.';
  }
  async function operation(work: () => Promise<void>) {
    if (busy || disabled) return;
    busy = true; onbusy(true); error = ''; message = '';
    try { await work(); }
    catch (cause) {
      report = null;
      error = cause instanceof Error ? cause.message : 'The workspace copy could not be completed.';
      if (copy?.writeState === 'committed') error += ' A write completed, but verification did not. Verify the destination; do not repeat its metadata write.';
      else if (copy?.writeState === 'unconfirmed') error += ' The write outcome is unconfirmed. Verify the destination before taking another action.';
    } finally {
      busy = false; onbusy(false); passphrase = ''; confirmation = '';
      if (!disposed) { onchange(); await tick(); status?.focus(); }
    }
  }
  async function start() {
    await operation(async () => {
      if (passphrase !== confirmation) throw new Error('The replacement workspace passphrases do not match.');
      const { openEncryptedWorkspaceCopy } = await import('$lib/browser-workspace-copy.ts');
      const { WorkspaceDestinationStartError } = await import('$lib/browser-workspace-destination.ts');
      try {
        const opened = await openEncryptedWorkspaceCopy({ name, passphrase });
        if (disposed) { await opened.close(); return; }
        copy = opened; show(await opened.copy());
      } catch (cause) {
        if (cause instanceof WorkspaceDestinationStartError) message = `Created ${cause.workspace.name}; inspect it in the directory before starting again.`;
        throw cause;
      }
    });
  }
</script>

<details class="workspace-copy">
  <summary>Create an encrypted replacement</summary>
  <p>Copy this workspace’s saved collections, recovery drafts and original files into a new encrypted workspace. Use this to change a passphrase or protect unencrypted saved work. The original remains unchanged and its old passphrase, if any, still works. This is a point-in-time copy, not synchronisation or an independent backup.</p>
  {#if !copy}<form onsubmit={event => { event.preventDefault(); void start(); }}>
    <label>Replacement workspace name<input bind:value={name} maxlength={MAX_BROWSER_WORKSPACE_NAME} required disabled={disabled || busy}></label>
    <div class="passwords">
      <label>Replacement passphrase<input type="password" bind:value={passphrase} autocomplete="new-password" minlength={MIN_BROWSER_WORKSPACE_PASSPHRASE_CHARACTERS} maxlength={MAX_BROWSER_WORKSPACE_PASSPHRASE_BYTES} required disabled={disabled || busy}></label>
      <label>Confirm replacement passphrase<input type="password" bind:value={confirmation} autocomplete="new-password" maxlength={MAX_BROWSER_WORKSPACE_PASSPHRASE_BYTES} required disabled={disabled || busy}></label>
    </div>
    <p>Save current edits first. Page-only state, browser preferences and downloaded files are not copied. Keep the new passphrase separately; it cannot be reset.</p>
    <button class="primary" type="submit" disabled={disabled || busy || !name.trim()}>Create and verify encrypted copy</button>
  </form>{:else}
    <h3>{copy.workspace.name}</h3>
    {#if report}
      <p class="copy-result">{report.collections.filter(item => item.matches).length} of {report.collections.length} collections match · {report.files.verified} of {report.files.expected} originals verified · {report.files.missing} missing</p>
      {#if !report.sourceMatches}<p class="error">Source records changed during verification. This copy has not been updated automatically.</p>{/if}
      <details><summary>Saved collection checks</summary><ul>{#each report.collections as item}<li>{item.label}: {item.records} records · {item.matches ? 'Exact match' : 'Different or incomplete'}</li>{/each}</ul></details>
    {/if}
    <div class="actions">
      <button class="btn" type="button" disabled={disabled || busy} onclick={() => void operation(async () => show(await copy!.verify()))}>Verify encrypted copy</button>
      <button class="btn" type="button" disabled={disabled || busy} onclick={() => void operation(async () => show(await copy!.retryFiles()))}>Copy missing originals</button>
      <button class="btn" type="button" disabled={disabled || busy} onclick={() => void operation(async () => {
        const retained = copy!; await retained.close(); copy = null; report = null;
        message = `Kept ${retained.workspace.name}. Open it from the workspace directory and check it with its new passphrase. The original remains available.`;
      })}>Finish verification and keep copy</button>
    </div>
    <p>The new workspace stays closed to other tabs during verification. Leaving keeps any completed writes; an interrupted copy may be incomplete. Export and rehearse a separate backup before deliberately deleting an older workspace.</p>
  {/if}
  <p bind:this={status} role={error ? 'alert' : 'status'} tabindex="-1" class:error>{error}{error && message ? ' ' : ''}{message}</p>
</details>

<style>
  .workspace-copy{min-width:0;overflow-wrap:anywhere;margin-top:16px}summary{padding:8px 0;cursor:pointer;font-size:var(--text-sm)}p,li{font-size:var(--text-xs);line-height:1.6;color:var(--muted)}form,label{display:grid;gap:8px;min-width:0}form{gap:14px;margin-block:14px}label{font-size:var(--text-xs)}input{width:100%;min-width:0}.passwords{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-block:12px}button{justify-self:start;max-width:100%;white-space:normal}h3{font-size:var(--text-sm)}ul{padding-left:20px}.error{color:var(--danger)}[tabindex]:focus{outline:2px solid var(--focus);outline-offset:4px}[role=status]:empty{display:none}@media(max-width:600px){.passwords{grid-template-columns:1fr}.actions{align-items:stretch;flex-direction:column}.actions button{width:100%}}
</style>
