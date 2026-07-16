<script lang="ts">
  let {
    domains,
    status,
    loadShortlisted,
    downloadShortlist,
    importShortlistFile,
    removeAllShortlisted,
  }: {
    domains: string[];
    status: string;
    loadShortlisted: () => void;
    downloadShortlist: () => void;
    importShortlistFile: (event: Event) => void | Promise<void>;
    removeAllShortlisted: () => void;
  } = $props();
</script>

<section class="shortlist card">
  <header class="section-head">
    <div><p class="eyebrow">Saved</p><h2>Shortlist · {domains.length}</h2></div>
    <div class="toolbar">
      {#if domains.length}<button class="btn" onclick={loadShortlisted}>Load for scan</button><button class="btn" onclick={downloadShortlist}>Export JSON</button>{/if}
      <label class="btn file-btn">Import JSON<input type="file" accept="application/json,.json" onchange={importShortlistFile}></label>
      {#if domains.length}<button class="btn danger" onclick={removeAllShortlisted}>Clear shortlist</button>{/if}
    </div>
  </header>
  {#if status}<p role="status" aria-live="polite">{status}</p>{/if}
  {#if domains.length}<div class="shortlist-items">{#each domains as domain}<span>{domain}</span>{/each}</div>{:else}<p>No shortlisted domains yet. Star a Bulk result to save it locally.</p>{/if}
</section>

<style>
  .shortlist{margin-top:16px;padding:var(--card-pad)}
  .shortlist h2{margin:0}
  .shortlist>p{color:var(--muted);font-size:var(--text-xs)}
  .shortlist-items{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
  .shortlist-items span{padding:6px 9px;border:1px solid var(--border);border-radius:99px;font:600 var(--text-2xs) var(--mono)}
</style>
