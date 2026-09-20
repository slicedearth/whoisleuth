<script lang="ts">
  let {
    currentPage,
    pageCount,
    setPage,
    ariaLabel,
    pageInputLabel,
  }: {
    currentPage: number;
    pageCount: number;
    setPage: (page: number) => void;
    ariaLabel: string;
    pageInputLabel?: string;
  } = $props();
  let pageInput = $state<HTMLInputElement>();

  function goToPage(event: SubmitEvent): void {
    event.preventDefault();
    const value = pageInput?.valueAsNumber;
    if (value !== undefined && Number.isInteger(value) && value >= 1 && value <= pageCount) setPage(value);
  }
</script>

{#if pageCount > 1}
  <nav class="pagination" aria-label={ariaLabel}>
    <button class="btn small" type="button" onclick={() => { if (currentPage > 1) setPage(currentPage - 1); }} aria-disabled={currentPage === 1}>Previous</button>
    <span role="status" aria-live="polite" aria-atomic="true">Page {currentPage} of {pageCount}</span>
    <button class="btn small" type="button" onclick={() => { if (currentPage < pageCount) setPage(currentPage + 1); }} aria-disabled={currentPage === pageCount}>Next</button>
    {#if pageInputLabel}
      <form onsubmit={goToPage}>
        <label>Page<input bind:this={pageInput} aria-label={pageInputLabel} type="number" min="1" max={pageCount} step="1" required value={currentPage}></label>
        <button class="btn small" type="submit">Go</button>
      </form>
    {/if}
  </nav>
{/if}

<style>
  .pagination{display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:10px;margin-top:12px}
  .pagination span{color:var(--muted);font-size:var(--text-xs)}
  .pagination button[aria-disabled='true']{cursor:not-allowed;opacity:.45}
  form,label{display:flex;align-items:center;gap:7px}
  label{color:var(--muted);font-size:var(--text-xs)}
  input{width:5rem;min-height:32px;padding:5px 7px}
  form{flex-basis:100%;justify-content:flex-end}
  @media(max-width:700px){.pagination{justify-content:space-between}}
</style>
