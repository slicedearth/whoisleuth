<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { WatchlistUpdatePreview } from '../analysis/watchlist-store.ts';
  let { preview, busy, confirm, cancel }: {
    preview: WatchlistUpdatePreview; busy: boolean;
    confirm: () => void | Promise<void>; cancel: () => void;
  } = $props();
  let heading: HTMLHeadingElement;
  const groups = $derived([
    { label: 'Retained current members', domains: preview.retained },
    { label: 'Added current members', domains: preview.added },
    { label: 'Removed current members', domains: preview.removed },
  ]);
  onMount(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void tick().then(() => heading?.focus());
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  });
</script>

<section class="membership-review card" aria-labelledby="monitor-membership-title">
  <h2 id="monitor-membership-title" tabindex="-1" bind:this={heading}>Review Monitor membership</h2>
  <p><strong>{preview.name}</strong> · {preview.operation === 'merge' ? 'Scoped merge' : 'Full snapshot replacement'} · {preview.input.length} submitted result{preview.input.length === 1 ? '' : 's'}.</p>
  <p>{preview.operation === 'merge' ? 'Unrelated current members and their evidence stay retained. This history event describes only the submitted subset; retained members are not presented as rechecked.' : 'Current membership will become exactly the reviewed result set. Removed members will not be included in future rescans. Older bounded change events are not full snapshots.'}</p>
  <div class="membership-groups">
    {#each groups as group (group.label)}
      <details><summary>{group.label}: {group.domains.length}</summary>
        {#if group.domains.length}<ul>{#each group.domains as domain (domain)}<li>{domain}</li>{/each}</ul>{:else}<p>None</p>{/if}
      </details>
    {/each}
  </div>
  <p role="note">The destination and reviewed evidence are checked again inside the save transaction. A changed destination requires a fresh review. No lookup starts here.</p>
  <div class="actions"><button class="btn" type="button" disabled={busy} onclick={cancel}>Cancel Monitor save</button><button class="primary" type="button" disabled={busy} onclick={() => void confirm()}>{busy ? 'Saving reviewed update…' : preview.operation === 'merge' ? 'Confirm scoped merge' : 'Confirm snapshot replacement'}</button></div>
</section>

<style>
  .membership-review{display:grid;gap:12px;padding:18px;margin-bottom:18px;min-width:0}
  h2,p{margin:0}p{line-height:1.6;overflow-wrap:anywhere}
  .membership-groups{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;min-width:0}
  details{min-width:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  summary{cursor:pointer;font-weight:600;overflow-wrap:anywhere}
  ul{max-height:220px;overflow:auto;padding-left:20px;margin:10px 0 0}li{overflow-wrap:anywhere}
  .actions{display:flex;gap:8px;flex-wrap:wrap}
  @media(max-width:640px){.membership-groups{grid-template-columns:1fr}}
</style>
