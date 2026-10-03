<script lang="ts">
  import { onDestroy } from 'svelte';
  let { value, label = 'Copy', description = label }: { value: string; label?: string; description?: string } = $props();
  let state = $state<'idle' | 'copied' | 'failed'>('idle');
  let generation = 0;
  $effect(() => { value; generation++; state = 'idle'; });
  onDestroy(() => { generation++; });
  async function copy() {
    const selected = value, request = ++generation;
    try {
      await navigator.clipboard.writeText(selected);
      if (request === generation && value === selected) state = 'copied';
    } catch {
      if (request === generation && value === selected) state = 'failed';
    }
  }
</script>

<span class="copy-control">
  <button class="btn" type="button" aria-label={description} onclick={() => void copy()}>{state === 'copied' ? 'Copied' : label}</button>
  <span class:sr-only={state !== 'failed'} aria-live="polite">{state === 'copied' ? `${description}: copied.` : state === 'failed' ? 'Clipboard unavailable. Select the value below to copy it.' : ''}</span>
  {#if state === 'failed'}<code class="copy-fallback">{value}</code>{/if}
</span>

<style>
  .copy-control{display:inline-grid;min-width:0;max-width:100%;align-items:stretch;vertical-align:middle}
  button{min-height:44px;padding:7px 11px;font:600 var(--text-xs)/1.4 var(--font-sans);white-space:normal}
  .copy-fallback{display:block;min-width:0;max-width:100%;overflow-wrap:anywhere;white-space:pre-wrap;user-select:all;font-size:var(--text-xs)}
  .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
  @media print{.copy-control{display:none}}
</style>
