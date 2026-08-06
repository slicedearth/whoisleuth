<script lang="ts">
  let {
    currentPage,
    pageCount,
    setPage,
    ariaLabel,
  }: {
    currentPage: number;
    pageCount: number;
    setPage: (page: number) => void;
    ariaLabel: string;
  } = $props();
</script>

{#if pageCount > 1}
  <nav class="pagination" aria-label={ariaLabel}>
    <button class="btn small" type="button" onclick={() => { if (currentPage > 1) setPage(currentPage - 1); }} aria-disabled={currentPage === 1}>Previous</button>
    <span role="status" aria-live="polite" aria-atomic="true">Page {currentPage} of {pageCount}</span>
    <button class="btn small" type="button" onclick={() => { if (currentPage < pageCount) setPage(currentPage + 1); }} aria-disabled={currentPage === pageCount}>Next</button>
  </nav>
{/if}

<style>
  .pagination{display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:12px}
  .pagination span{color:var(--muted);font-size:var(--text-xs)}
  .pagination button[aria-disabled='true']{cursor:not-allowed;opacity:.45}
  @media(max-width:700px){.pagination{justify-content:space-between}}
</style>
