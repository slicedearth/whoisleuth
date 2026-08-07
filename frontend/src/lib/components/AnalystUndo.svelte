<script lang="ts">
  import { onMount } from 'svelte';
  import {
    dismissAnalystUndo,
    expireAnalystUndo,
    runAnalystUndo,
    subscribeAnalystUndo,
    type AnalystUndoAction,
  } from '$lib/analyst-undo';

  let action = $state<AnalystUndoAction | null>(null);
  let outcome = $state('');
  let busy = $state(false);
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  let outcomeTimer: ReturnType<typeof setTimeout> | null = null;

  function clearExpiryTimer(): void {
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = null;
  }

  function showOutcome(message: string): void {
    if (outcomeTimer) clearTimeout(outcomeTimer);
    outcome = message;
    outcomeTimer = setTimeout(() => {
      outcome = '';
      outcomeTimer = null;
    }, 5_000);
  }

  onMount(() => {
    const unsubscribe = subscribeAnalystUndo((next) => {
      clearExpiryTimer();
      action = next;
      busy = false;
      if (!next) return;
      outcome = '';
      expiryTimer = setTimeout(() => {
        if (expireAnalystUndo(next.id)) showOutcome(`Undo expired for ${next.affectedRecord}.`);
      }, Math.max(0, next.expiresAt - Date.now()));
    });
    return () => {
      unsubscribe();
      clearExpiryTimer();
      if (outcomeTimer) clearTimeout(outcomeTimer);
    };
  });

  async function undo(): Promise<void> {
    if (!action || busy) return;
    busy = true;
    const result = await runAnalystUndo(action.id);
    showOutcome(result.message);
    busy = false;
  }

  function dismiss(): void {
    if (!action) return;
    dismissAnalystUndo(action.id);
  }
</script>

{#if action}
  <section class="undo-toast" aria-live="polite" aria-label="Undo analyst change">
    <div>
      <strong>{action.action}</strong>
      <span>{action.affectedRecord}</span>
      <small>Available for 12 seconds in this tab only.</small>
    </div>
    <button type="button" class="undo" disabled={busy} onclick={undo}>{busy ? 'Restoring…' : 'Undo'}</button>
    <button type="button" class="dismiss" aria-label="Dismiss undo" onclick={dismiss}>×</button>
  </section>
{:else if outcome}
  <p class="undo-outcome" role="status">{outcome}</p>
{/if}

<style>
  .undo-toast,.undo-outcome{position:fixed;right:20px;bottom:20px;z-index:75;max-width:min(440px,calc(100vw - 32px));border:1px solid color-mix(in srgb,var(--accent) 48%,var(--border));border-radius:var(--radius-md);background:color-mix(in srgb,var(--panel-raised) 96%,transparent);box-shadow:0 18px 48px rgb(var(--shadow-rgb) / .24);backdrop-filter:blur(12px)}
  .undo-toast{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:12px;padding:12px 12px 12px 14px}
  .undo-toast div{display:grid;min-width:0;gap:2px}.undo-toast strong{font-size:var(--text-sm)}.undo-toast span{overflow:hidden;color:var(--text);font:650 var(--text-xs) var(--mono);text-overflow:ellipsis;white-space:nowrap}.undo-toast small{color:var(--muted);font-size:var(--text-2xs)}
  button{min-height:34px}.undo{padding:0 11px;border:1px solid var(--accent);border-radius:var(--radius-sm);background:rgb(var(--accent-rgb) / .1);color:var(--accent);font:700 var(--text-xs) var(--mono);cursor:pointer}.dismiss{width:34px;padding:0;border:0;background:none;color:var(--muted);font-size:1.3rem;cursor:pointer}
  .undo-outcome{margin:0;padding:11px 14px;color:var(--text);font-size:var(--text-xs)}
  @media(max-width:600px){.undo-toast,.undo-outcome{right:12px;bottom:12px;max-width:calc(100vw - 24px)}.undo-toast{grid-template-columns:minmax(0,1fr) auto;padding:11px}.dismiss{position:absolute;right:4px;top:3px;width:28px;min-height:28px}.undo-toast div{padding-right:18px}}
  @media(prefers-reduced-motion:reduce){.undo-toast,.undo-outcome{backdrop-filter:none}}
</style>
