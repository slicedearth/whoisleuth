<script lang="ts">
  import { onDestroy } from 'svelte';
  import { evidenceTime } from '../analysis/evidence-time.ts';

  let { value, label = 'timestamp', unavailable = 'Time unavailable', copyable = true }: {
    value: string | null | undefined;
    label?: string;
    unavailable?: string;
    copyable?: boolean;
  } = $props();
  const time = $derived(evidenceTime(value));
  let status = $state<'idle' | 'copied' | 'failed'>('idle');
  let operation = 0;
  $effect(() => { value; status = 'idle'; operation += 1; });
  onDestroy(() => { operation += 1; });

  async function copy() {
    if (!time) return;
    const expected = ++operation;
    const exact = time.exact;
    try {
      await navigator.clipboard.writeText(exact);
      if (expected === operation && value === exact) status = 'copied';
    } catch {
      if (expected === operation && value === exact) status = 'failed';
    }
  }
</script>

<span class="evidence-timestamp">
  {#if time}
    {#if copyable}
      <button type="button" class="timestamp" title={time.exact} aria-label={`Copy exact ${label}: ${time.exact}`} onclick={copy}>
        <time datetime={time.datetime}>{time.readable}</time><span class="copy-hint" aria-hidden="true">Copy</span>
      </button>
      <span class:sr-only={status !== 'failed'} aria-live="polite" aria-atomic="true">{status === 'copied' ? `Exact ${label} copied.` : status === 'failed' ? 'Clipboard unavailable. Select the exact timestamp below.' : ''}</span>
      {#if status === 'failed'}<code>{time.exact}</code>{/if}
    {:else}<time datetime={time.datetime} title={time.exact}>{time.readable}</time>{/if}
  {:else}<span>{unavailable}</span>{/if}
</span>

<style>
  .evidence-timestamp{min-width:0;overflow-wrap:anywhere}
  .timestamp{display:inline-flex;align-items:baseline;flex-wrap:wrap;gap:4px 8px;max-width:100%;padding:3px 0;border:0;border-radius:2px;background:transparent;color:inherit;font:inherit;text-align:start;cursor:pointer}
  time,code{min-width:0;overflow-wrap:anywhere}.copy-hint{color:var(--interface-accent);font-size:.85em;text-decoration:underline;text-underline-offset:3px}
  .timestamp:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  code{display:block;font-size:inherit;user-select:all}.sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  @media(max-width:640px){.timestamp{min-height:44px;align-items:center}}
</style>
