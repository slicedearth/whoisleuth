<script lang="ts">
  import Pagination from '$lib/components/Pagination.svelte';
  import {
    fieldLabels,
    formatValue,
    type WatchlistEntry,
    type WatchlistEvent,
    type Watchlists,
  } from '$lib/watchlists';

  let {
    watchlists,
    names,
    entry,
    selected,
    setSelected,
    history,
    changedOnly,
    setChangedOnly,
    message,
    downloadWatchlists,
    importFile,
    clearAll,
    rescan,
    remove,
    formatDate,
  }: {
    watchlists: Watchlists;
    names: string[];
    entry: WatchlistEntry | null;
    selected: string;
    setSelected: (value: string) => void;
    history: WatchlistEvent[];
    changedOnly: boolean;
    setChangedOnly: (value: boolean) => void;
    message: string;
    downloadWatchlists: () => void;
    importFile: (event: Event) => void | Promise<void>;
    clearAll: () => void;
    rescan: (name: string) => void | Promise<void>;
    remove: (name: string) => void;
    formatDate: (value: string) => string;
  } = $props();

  const PAGE_SIZE=25;
  let page=$state(1);
  const pageCount=$derived(Math.max(1,Math.ceil(names.length/PAGE_SIZE)));
  const currentPage=$derived(Math.min(page,pageCount));
  const pagedNames=$derived(names.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE));
  function setPage(value:number){page=Math.min(pageCount,Math.max(1,Math.trunc(value)));}
  $effect(()=>{if(page>pageCount)page=pageCount;});
</script>

<section class="wl-toolbar card"><div class="top-actions toolbar"><button class="btn" onclick={downloadWatchlists} disabled={!names.length}>Export JSON</button><label class="btn file-btn">Import JSON<input type="file" accept="application/json,.json" onchange={importFile}></label><button class="btn danger" onclick={clearAll} disabled={!names.length}>Clear all</button></div></section>
{#if message}<p class="message" role="status" aria-live="polite">{message}</p>{/if}

{#if names.length}
  <section class="watchlists card"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Domains</th><th>Checks</th><th>Latest changes</th><th>Updated</th><th>Actions</th></tr></thead><tbody>{#each pagedNames as name}{@const item=watchlists[name]}{@const latest=item.history.at(-1)}<tr><td><strong>{name}</strong></td><td>{item.results.length}</td><td>{item.history.length}</td><td><span class:changed={(latest?.changeCount || 0) > 0}>{latest?.changeCount || 0}</span></td><td>{formatDate(item.updatedAt)}</td><td><div class="actions toolbar"><button class="btn small" onclick={() => rescan(name)}>Rescan in Bulk</button><button class="btn small" onclick={() => { setSelected(name); setChangedOnly(false); }}>History</button><button class="btn small danger" onclick={() => remove(name)}>Delete</button></div></td></tr>{/each}</tbody></table></div><Pagination {currentPage} {pageCount} {setPage} ariaLabel="Watchlist pages" /></section>
{:else}
  <section class="empty-state card"><h2>No watchlists saved</h2><p>Run a Bulk scan, then save its results to begin a browser-local monitoring timeline.</p><a href="/bulk">Open Bulk analysis →</a></section>
{/if}

{#if entry}
  <section class="history card"><header class="section-head"><div><p class="eyebrow">History</p><h2>{selected}</h2><p>{entry.history.length} retained check{entry.history.length === 1 ? '' : 's'} · {entry.results.length} domain{entry.results.length === 1 ? '' : 's'}</p></div><div class="toolbar"><button class="btn" class:active={changedOnly} aria-pressed={changedOnly} onclick={() => setChangedOnly(!changedOnly)}>Material changes only</button><button class="btn" onclick={() => setSelected('')}>Close</button></div></header>
    <div class="events">{#each [...history].reverse() as event}<article><div class="event-head"><time datetime={event.checkedAt}>{formatDate(event.checkedAt)}</time><span>{event.mode} scan</span><strong class:changed={event.changeCount > 0}>{event.changeCount} change{event.changeCount === 1 ? '' : 's'}</strong><small>{event.conclusiveCount}/{event.resultCount} conclusive</small></div>{#if event.changes.length}<ul>{#each event.changes as change}<li class={change.tone}><strong>{change.domain}</strong><span>{fieldLabels[change.field] || change.field}</span><small>{formatValue(change.before, change.field)} → {formatValue(change.after, change.field)}</small></li>{/each}</ul>{:else}<p class="no-change">No material changes detected.</p>{/if}{#if event.omittedChanges}<p class="no-change">{event.omittedChanges} additional changes omitted to keep storage bounded.</p>{/if}</article>{/each}</div>
  </section>
{/if}

<style>
  .message{color:var(--accent);font-size:var(--text-sm)}
  .wl-toolbar{padding:16px}
  .watchlists,.history{padding:var(--card-pad)}
  .changed{color:var(--danger);font-weight:700}
  .history{margin-top:16px}
  .history h2{margin:0}
  .history .section-head p:not(.eyebrow){margin:5px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .events{display:grid;gap:10px;margin-top:18px}
  .events article{padding:15px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .event-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .event-head span,.event-head strong{padding:4px 9px;border:1px solid var(--border);border-radius:99px;font:600 var(--text-2xs) var(--mono);text-transform:capitalize}
  .event-head strong.changed{border-color:rgb(var(--danger-rgb) / .4)}
  .event-head time{font-size:var(--text-xs)}
  .event-head small{margin-left:auto;color:var(--muted);font-size:var(--text-2xs)}
  .events ul{display:grid;gap:6px;margin:14px 0 0;padding:0;list-style:none}
  .events li{display:grid;grid-template-columns:minmax(150px,1fr) 130px minmax(180px,1fr);gap:10px;padding:8px 10px;border-left:3px solid var(--border);font-size:var(--text-xs)}
  .events li.danger{border-color:var(--danger)}
  .events li.warn{border-color:var(--amber)}
  .events li.good{border-color:var(--accent2)}
  .events li strong{overflow-wrap:anywhere}
  .events li span,.events li small{color:var(--muted);font-size:var(--text-xs);overflow-wrap:anywhere}
  .no-change{color:var(--muted);font-size:var(--text-xs)}
  @media(max-width:800px){
    .history .section-head{display:block}
    .history .section-head .toolbar{margin-top:12px}
    .table-wrap{margin-inline:calc(-1 * var(--card-pad));padding-inline:var(--card-pad)}
    .events li{grid-template-columns:1fr}
    .event-head small{width:100%;margin:0}
  }
</style>
