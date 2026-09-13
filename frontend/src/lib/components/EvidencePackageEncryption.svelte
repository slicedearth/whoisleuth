<script lang="ts">
  import { onDestroy } from 'svelte';
  import { assertPassphrase } from '../../../../packages/evidence/passphrase-encryption.mts';
  import { MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS, MAX_WORKSPACE_ARCHIVE_PASSPHRASE_BYTES } from '../../../../packages/contracts/case-portability.mts';

  let { encrypted = $bindable(false), disabled = false, required = false }: { encrypted?: boolean; disabled?: boolean; required?: boolean } = $props();
  let passphrase = $state(''), confirmation = $state('');
  export function reset() { passphrase = ''; confirmation = ''; }
  export function takePassphrase(): string | undefined {
    if (!encrypted && !required) { reset(); return undefined; }
    if (passphrase !== confirmation) throw new Error('The package passphrases do not match.');
    assertPassphrase(passphrase).fill(0);
    const submitted = passphrase; reset(); return submitted;
  }
  onDestroy(reset);
</script>

<div class="encryption-options">
  {#if !required}<label class="choice"><input type="checkbox" checked={encrypted} {disabled} onchange={event => { encrypted = event.currentTarget.checked; reset(); }}> Encrypt package download</label>{/if}
  {#if encrypted || required}
    <div class="passwords">
      <label>Package passphrase<input type="password" bind:value={passphrase} autocomplete="new-password" minlength={MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS} maxlength={MAX_WORKSPACE_ARCHIVE_PASSPHRASE_BYTES} {disabled}></label>
      <label>Confirm package passphrase<input type="password" bind:value={confirmation} autocomplete="new-password" minlength={MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS} maxlength={MAX_WORKSPACE_ARCHIVE_PASSPHRASE_BYTES} {disabled}></label>
    </div>
    <p>Use at least {MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS} characters. The passphrase is not saved or recoverable; send it separately. Both the manifest and files are encrypted.</p>
  {/if}
</div>

<style>
  .encryption-options{display:grid;gap:10px;min-width:0}.choice{display:flex;align-items:center;gap:8px;font-size:var(--text-sm)}.choice input{width:16px;height:16px;min-height:0}.passwords{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.passwords label{display:grid;gap:5px;min-width:0;font-size:var(--text-xs)}.passwords input{min-width:0;max-width:100%}p{margin:0;color:var(--muted);font:400 var(--text-xs)/1.55 var(--font-sans);overflow-wrap:anywhere}@media(max-width:600px){.passwords{grid-template-columns:minmax(0,1fr)}}
</style>
