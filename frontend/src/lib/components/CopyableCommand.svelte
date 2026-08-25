<script lang="ts">
  import { onDestroy } from 'svelte';

  let {
    command,
    label = 'command',
    compact = false,
  }: {
    command: string;
    label?: string;
    compact?: boolean;
  } = $props();

  let state = $state<'idle' | 'copied' | 'failed'>('idle');
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  onDestroy(() => {
    if (resetTimer) clearTimeout(resetTimer);
  });

  async function copyCommand() {
    if (resetTimer) clearTimeout(resetTimer);
    try {
      await navigator.clipboard.writeText(command);
      state = 'copied';
    } catch {
      state = 'failed';
    }
    resetTimer = setTimeout(() => { state = 'idle'; }, 3_000);
  }
</script>

<div class="copyable-command" class:compact>
  <code>{command}</code>
  <button type="button" onclick={() => void copyCommand()} aria-label={`Copy ${label}`}>
    {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy unavailable' : 'Copy'}
  </button>
</div>
<p class="sr-only" aria-live="polite">
  {state === 'copied' ? `${label} copied to the clipboard.` : state === 'failed' ? `Clipboard access was unavailable. Select the ${label} manually.` : ''}
</p>

<style>
  .copyable-command{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:stretch;overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)}
  code{display:block;min-width:0;padding:13px 14px;color:var(--accent);font-size:var(--text-xs);line-height:1.55;overflow-wrap:anywhere;white-space:pre-wrap}
  button{min-width:72px;padding:0 12px;border:0;border-left:1px solid var(--border);border-radius:0;background:var(--panel-raised);color:var(--muted);font:700 var(--text-2xs) var(--mono)}
  button:hover,button:focus-visible{color:var(--text);background:rgb(var(--accent-rgb) / .08)}
  .compact code{padding:10px 11px;font-size:var(--text-2xs)}
  .compact button{min-width:64px;padding-inline:9px}
  @media(max-width:460px){.copyable-command{grid-template-columns:1fr}.copyable-command button{min-height:38px;border-top:1px solid var(--border);border-left:0}}
</style>
