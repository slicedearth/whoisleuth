<script lang="ts">
  import { tick } from 'svelte';
  import type { CaseAssociationRetention } from '$lib/cases';
  let { retention, busy, confirm, cancel, exportSnapshot }: {
    retention: CaseAssociationRetention; busy: boolean;
    confirm: () => void | Promise<void>; cancel: () => void | Promise<void>;
    exportSnapshot: () => void;
  } = $props();
  let heading = $state<HTMLHeadingElement>();
  $effect(() => {
    const reviewed = retention;
    void tick().then(() => { if (retention === reviewed) heading?.focus(); });
  });
</script>

<section class="storage-review card" aria-labelledby="case-storage-review-title" aria-busy={busy}>
  <h2 id="case-storage-review-title" tabindex="-1" bind:this={heading}>Review Case storage changes</h2>
  <p>This association change would remove {retention.preview.pruned} evidence snapshot{retention.preview.pruned === 1 ? '' : 's'} ({retention.preview.removedBytes.toLocaleString()} stored bytes). Nothing has been saved. Notes and decisions are preserved.</p>
  <ul>{#each retention.preview.removed as item (item.caseId)}
    <li><strong>{item.domain}</strong> · {item.snapshotIds.length} snapshot{item.snapshotIds.length === 1 ? '' : 's'} removed; {item.remainingSnapshots} retained{item.remainingSnapshots === 0 ? ' — no evidence snapshots would remain' : ''}</li>
  {/each}</ul>
  <div class="actions">
    <button type="button" class="btn" disabled={busy} onclick={exportSnapshot}>Export current Cases</button>
    <button type="button" class="btn" disabled={busy} onclick={cancel}>Cancel change</button>
    <button type="button" class="btn danger" disabled={busy} onclick={confirm}>Remove listed snapshots and save</button>
  </div>
</section>

<style>
  .storage-review{min-width:0;margin-block:16px;padding:16px;overflow-wrap:anywhere}
  h2{margin:0;font:650 var(--text-base) var(--mono)}
  p,li{font-size:var(--text-sm);line-height:1.5}
  ul{padding-inline-start:20px}
  .actions{display:flex;flex-wrap:wrap;gap:8px}
  @media(max-width:640px){.actions{display:grid}.actions button{white-space:normal}}
</style>
