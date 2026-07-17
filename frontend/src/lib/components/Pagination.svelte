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
    <button class="btn small" type="button" onclick={() => setPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1}>Previous</button>
    <span>Page {currentPage} of {pageCount}</span>
    <button class="btn small" type="button" onclick={() => setPage(Math.min(pageCount, currentPage + 1))} disabled={currentPage === pageCount}>Next</button>
  </nav>
{/if}

<style>
  .pagination{display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:12px}
  .pagination span{color:var(--muted);font-size:var(--text-xs)}
  @media(max-width:700px){.pagination{justify-content:space-between}}
</style>
