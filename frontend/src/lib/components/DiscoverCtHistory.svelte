<script lang="ts">
  type HistoryCheck = { checkedAt: string; checkedLabel: string; resultCount: number; newCount: number; truncated: boolean };
  type HistoryEntry = {
    query: string;
    domainCount: number;
    checkCount: number;
    updatedLabel: string;
    latestNewCount: number;
    checks: HistoryCheck[];
  };

  let {
    entries,
    useEntry,
    deleteEntry,
    clearHistory,
  }: {
    entries: HistoryEntry[];
    useEntry: (query: string) => void;
    deleteEntry: (query: string) => void;
    clearHistory: () => void;
  } = $props();
</script>

<details class="ct-history">
  <summary>Previous certificate searches · {entries.length}</summary>
  <div class="ct-history-list">
    {#each entries as entry (entry.query)}
      <article>
        <div>
          <strong>{entry.query}</strong>
          <small>{entry.domainCount} baseline domain{entry.domainCount === 1 ? '' : 's'} · {entry.checkCount} retained check{entry.checkCount === 1 ? '' : 's'}</small>
          <small>Last checked {entry.updatedLabel}{entry.latestNewCount ? ` · ${entry.latestNewCount} new` : ''}</small>
          {#if entry.checks.length}
            <details class="ct-checks"><summary>View check history</summary><ol>{#each entry.checks as check}<li><time datetime={check.checkedAt}>{check.checkedLabel}</time><span>{check.resultCount} result{check.resultCount === 1 ? '' : 's'} · {check.newCount} new{check.truncated ? ' · capped' : ''}</span></li>{/each}</ol></details>
          {/if}
        </div>
        <div><button class="btn small" aria-label={`Use ${entry.query} certificate search`} onclick={() => useEntry(entry.query)}>Use</button><button class="btn small danger" aria-label={`Delete ${entry.query} certificate history`} onclick={() => deleteEntry(entry.query)}>Delete</button></div>
      </article>
    {/each}
  </div>
  <button class="btn small danger ct-clear-history" onclick={clearHistory}>Clear all certificate history</button>
</details>

<style>
  .ct-history{margin-top:14px;padding-top:12px;border-top:1px solid var(--border)}
  .ct-history>summary{color:var(--accent);cursor:pointer;font:600 var(--text-xs) var(--mono)}
  .ct-history-list{display:grid;gap:7px;margin-top:10px}
  .ct-history article{display:flex;justify-content:space-between;gap:12px;padding:11px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .ct-history article strong,.ct-history article small{display:block}
  .ct-history article strong{overflow-wrap:anywhere;font-size:var(--text-sm)}
  .ct-history article small{margin-top:3px;color:var(--muted);font-size:var(--text-2xs)}
  .ct-history article>div:last-child{display:flex;gap:5px;align-items:center}
  .ct-checks{margin-top:7px}
  .ct-checks summary{color:var(--accent);cursor:pointer;font-size:var(--text-2xs)}
  .ct-checks ol{display:grid;gap:4px;margin:6px 0 0;padding-left:18px}
  .ct-checks li{font-size:var(--text-2xs)}
  .ct-checks li span{display:block;color:var(--muted)}
  .ct-clear-history{margin-top:9px}
  @media(max-width:700px){
    .ct-history article{align-items:flex-start;flex-direction:column}
    .ct-history article>div:last-child{width:100%}
  }
</style>
