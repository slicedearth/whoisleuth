<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { ENCRYPTED_INVESTIGATION_PACKAGE_HEADER_BYTES, MAX_ENCRYPTED_INVESTIGATION_PACKAGE_BYTES, hasEncryptedInvestigationPackagePrefix } from '../../../../packages/contracts/investigation-package-limits.mts';
  import { MAX_WORKSPACE_ARCHIVE_PASSPHRASE_BYTES, MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS } from '../../../../packages/contracts/case-portability.mts';

  let { label, disabled = false, onreview, onselect = () => {}, control = $bindable() }: {
    label: string; disabled?: boolean; onreview: (file: Blob, passphrase?: string) => Promise<boolean>; onselect?: () => void; control?: HTMLInputElement | undefined;
  } = $props();
  let selected = $state.raw<Blob | null>(null), passphrase = $state(''), error = $state(''), working = $state(false);
  let passwordInput = $state<HTMLInputElement>();
  let generation = 0;
  onDestroy(() => { generation += 1; passphrase = ''; selected = null; });
  export function reset() { generation += 1; passphrase = ''; selected = null; error = ''; working = false; }

  async function choose(event: Event) {
    const input = event.currentTarget as HTMLInputElement, file = input.files?.[0]; input.value = '';
    if (!file || disabled || working) return;
    const current = ++generation;
    selected = null; passphrase = ''; error = ''; working = true;
    onselect();
    try {
      if (file.size < 22 || file.size > MAX_ENCRYPTED_INVESTIGATION_PACKAGE_BYTES) throw new Error('Select one evidence package within the supported byte limit.');
      const prefix = new Uint8Array(await file.slice(0, ENCRYPTED_INVESTIGATION_PACKAGE_HEADER_BYTES).arrayBuffer());
      if (current !== generation) return;
      if (hasEncryptedInvestigationPackagePrefix(prefix)) {
        selected = file;
      } else await onreview(file);
    } catch { if (current === generation) error = 'The selected evidence package could not be read. No saved records were changed.'; }
    finally { if (current === generation) { working = false; await tick(); if (selected) passwordInput?.focus(); } }
  }

  async function unlock() {
    if (!selected || disabled || working) return;
    const current = ++generation, file = selected, secret = passphrase;
    passphrase = ''; error = ''; working = true;
    try {
      if (await onreview(file, secret)) { if (current === generation) selected = null; }
    } catch { if (current === generation) error = 'The package could not be unlocked and verified. Check the passphrase and file integrity.'; }
    finally {
      if (current === generation) { working = false; await tick(); if (selected) passwordInput?.focus(); }
    }
  }
</script>

<div class="package-input">
  <label>{label}<input bind:this={control} type="file" accept="application/zip,application/octet-stream,.zip,.wlep" disabled={disabled || working} onchange={choose}></label>
  {#if selected}
    <div class="unlock">
      <p>This package is encrypted. Its contents remain unavailable until it is unlocked and verified.</p>
      <label>Unlock package passphrase<input bind:this={passwordInput} type="password" bind:value={passphrase} autocomplete="current-password" minlength={MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS} maxlength={MAX_WORKSPACE_ARCHIVE_PASSPHRASE_BYTES} disabled={disabled || working} onkeydown={event => { if (event.key === 'Enter') { event.preventDefault(); void unlock(); } }}></label>
      <div class="actions"><button class="btn" type="button" disabled={disabled || working || !passphrase} onclick={() => void unlock()}>Unlock evidence package</button><button class="btn" type="button" disabled={disabled || working} onclick={async () => { generation += 1; selected = null; passphrase = ''; error = ''; await tick(); control?.focus(); }}>Cancel encrypted package</button></div>
    </div>
  {/if}
  {#if error}<p role="alert">{error}</p>{/if}
</div>

<style>
  .package-input{display:grid;gap:8px;min-width:0;margin-block:12px}label{display:grid;gap:6px;min-width:0;font-size:var(--text-sm)}input{min-width:0;max-width:100%}.unlock{display:grid;gap:8px}.unlock p{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}.actions{display:flex;flex-wrap:wrap;gap:8px}.actions button{max-width:100%;white-space:normal;overflow-wrap:anywhere}[role=alert]{color:var(--danger);font-size:var(--text-xs)}
</style>
