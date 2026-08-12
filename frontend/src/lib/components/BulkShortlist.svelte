<script lang="ts">
  import Pagination from '$lib/components/Pagination.svelte';
  let {
    domains,
    status,
    loadShortlisted,
    downloadShortlist,
    importShortlistFile,
    removeAllShortlisted,
    sourceState = 'ready',
  }: {
    domains: string[];
    status: string;
    loadShortlisted: () => void;
    downloadShortlist: () => void;
    importShortlistFile: (event: Event) => void | Promise<void>;
    removeAllShortlisted: () => void;
    sourceState?: 'loading' | 'ready' | 'unavailable';
  } = $props();

  const PAGE_SIZE=100;
  let page=$state(1);
  const pageCount=$derived(Math.max(1,Math.ceil(domains.length/PAGE_SIZE)));
  const currentPage=$derived(Math.min(page,pageCount));
  const pagedDomains=$derived(domains.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE));
  function setPage(value:number){page=Math.min(pageCount,Math.max(1,Math.trunc(value)));}
  $effect(()=>{if(page>pageCount)page=pageCount;});
</script>

<section class="shortlist card">
  <header class="section-head">
    <div><p class="eyebrow">Saved</p><h2>Shortlist · {sourceState==='ready'?domains.length:'—'}</h2></div>
    {#if sourceState === 'ready'}<div class="toolbar">
      {#if domains.length}<button class="btn" onclick={loadShortlisted}>Load for scan</button><button class="btn" onclick={downloadShortlist}>Export JSON</button>{/if}
      <label class="btn file-btn">Import JSON<input type="file" accept="application/json,.json" onchange={importShortlistFile}></label>
      {#if domains.length}<button class="btn danger" onclick={removeAllShortlisted}>Clear shortlist</button>{/if}
    </div>{/if}
  </header>
  {#if status}<p role="status" aria-live="polite">{status}</p>{/if}
  {#if sourceState !== 'ready'}
    <p class="source-state {sourceState}" role={sourceState === 'unavailable' ? 'alert' : 'status'}>The shortlist {sourceState === 'loading' ? 'is still loading' : 'could not be read'}. Its count, empty state, imports, and mutations remain unavailable; reload to retry without overwriting unknown saved work.</p>
  {:else if domains.length}<div class="shortlist-items">{#each pagedDomains as domain}<span>{domain}</span>{/each}</div><Pagination {currentPage} {pageCount} {setPage} ariaLabel="Shortlist pages" />{:else}<p>No shortlisted domains yet. Star a Bulk result to save it locally.</p>{/if}
</section>

<style>
  .shortlist{margin-top:16px;padding:var(--card-pad)}
  .shortlist h2{margin:0}
  .shortlist>p{color:var(--muted);font-size:var(--text-xs)}.shortlist>.source-state{padding:10px 12px;border:1px dotted var(--muted);border-radius:var(--radius-sm);line-height:1.5}.shortlist>.source-state.loading{border-style:solid}
  .shortlist-items{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
  .shortlist-items span{padding:6px 9px;border:1px solid var(--border);border-radius:99px;font:600 var(--text-2xs) var(--mono)}
</style>
