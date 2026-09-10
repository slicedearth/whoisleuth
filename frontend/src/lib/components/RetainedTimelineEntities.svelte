<script lang="ts">
  import Pagination from './Pagination.svelte';

  let { values }: { values: readonly string[] } = $props();
  let open = $state(false);
  let page = $state(1);
  const pageSize = 20;
  const pageCount = $derived(Math.max(1, Math.ceil(values.length / pageSize)));
  const currentPage = $derived(Math.min(page, pageCount));
  const visible = $derived(values.slice((currentPage - 1) * pageSize, currentPage * pageSize));
</script>

{#if values.length > 8}
  <details bind:open>
    <summary>{values.length} linked domains</summary>
    {#if open}
      <div class="entities">{#each visible as value}<code>{value}</code>{/each}</div>
      <Pagination {currentPage} {pageCount} setPage={(value) => page = value} ariaLabel="Timeline event domains" pageInputLabel="Timeline event domain page number" />
    {/if}
  </details>
{:else if values.length}
  <div class="entities">{#each values as value}<code>{value}</code>{/each}</div>
{/if}

<style>
  .entities{display:flex;flex-wrap:wrap;gap:5px}.entities code{max-width:100%;padding:3px 6px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);overflow-wrap:anywhere}
  details{min-width:0}summary{color:var(--muted);font-size:var(--text-xs);cursor:pointer}details .entities{margin:8px 0}
</style>
