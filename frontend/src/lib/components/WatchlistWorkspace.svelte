<script lang="ts">
  import Pagination from '$lib/components/Pagination.svelte';
  import {
    fieldLabels,
    formatValue,
    projectWatchlistDomainHistory,
    watchlistHistoryDomains,
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
    openCase,
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
    openCase: (domain: string) => void;
    formatDate: (value: string) => string;
  } = $props();

  const PAGE_SIZE=25;
  let page=$state(1);
  const pageCount=$derived(Math.max(1,Math.ceil(names.length/PAGE_SIZE)));
  const currentPage=$derived(Math.min(page,pageCount));
  const pagedNames=$derived(names.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE));
  let focusedDomain=$state('');
  const domainOptions=$derived(watchlistHistoryDomains(entry));
  const domainHistory=$derived(focusedDomain?projectWatchlistDomainHistory(entry,focusedDomain):null);
  function setPage(value:number){page=Math.min(pageCount,Math.max(1,Math.trunc(value)));}
  $effect(()=>{if(page>pageCount)page=pageCount;});
</script>

<section class="wl-toolbar card"><div class="top-actions toolbar"><button class="btn" onclick={downloadWatchlists} disabled={!names.length}>Export JSON</button><label class="btn file-btn">Import JSON<input type="file" accept="application/json,.json" onchange={importFile}></label><button class="btn danger" onclick={clearAll} disabled={!names.length}>Clear all</button></div></section>
{#if message}<p class="message" role="status" aria-live="polite">{message}</p>{/if}

{#if names.length}
  <section class="watchlists card"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Domains</th><th>Checks</th><th>Latest changes</th><th>Updated</th><th>Actions</th></tr></thead><tbody>{#each pagedNames as name}{@const item=watchlists[name]}{@const latest=item.history.at(-1)}<tr><td><strong>{name}</strong></td><td>{item.results.length}</td><td>{item.history.length}</td><td><span class:changed={(latest?.changeCount || 0) > 0}>{latest?.changeCount || 0}</span></td><td>{formatDate(item.updatedAt)}</td><td><div class="actions toolbar"><button class="btn small" onclick={() => rescan(name)}>Rescan in Bulk</button><button class="btn small" onclick={() => { focusedDomain=''; setSelected(name); setChangedOnly(false); }}>History</button><button class="btn small danger" onclick={() => remove(name)}>Delete</button></div></td></tr>{/each}</tbody></table></div><Pagination {currentPage} {pageCount} {setPage} ariaLabel="Watchlist pages" /></section>
{:else}
  <section class="empty-state card"><h2>No watchlists saved</h2><p>Run a Bulk scan, then save its results to begin a browser-local monitoring timeline.</p><a href="/bulk">Open Bulk analysis →</a></section>
{/if}

{#if entry}
  <section class="history card">
    <header class="section-head">
      <div>
        <p class="eyebrow">History</p>
        <h2>{selected}</h2>
        <p>{entry.history.length} retained watchlist check{entry.history.length === 1 ? '' : 's'} · {entry.results.length} current domain{entry.results.length === 1 ? '' : 's'}</p>
      </div>
      <div class="toolbar">
        {#if !focusedDomain}<button class="btn" class:active={changedOnly} aria-pressed={changedOnly} onclick={() => setChangedOnly(!changedOnly)}>Material changes only</button>{/if}
        <button class="btn" onclick={() => { focusedDomain=''; setSelected(''); }}>Close</button>
      </div>
    </header>

    <div class="history-focus">
      <label for="watchlist-history-domain">History focus</label>
      <select id="watchlist-history-domain" bind:value={focusedDomain}>
        <option value="">All domains</option>
        {#each domainOptions.domains as domain}<option value={domain}>{domain}</option>{/each}
      </select>
      <p>Choose a domain to group its retained material changes by evidence category.</p>
      {#if domainOptions.omittedDomains}<p class="partial">{domainOptions.omittedDomains} older domain option{domainOptions.omittedDomains === 1 ? '' : 's'} omitted to keep this control bounded.</p>{/if}
    </div>

    {#if domainHistory}
      <section class="domain-history" aria-labelledby="domain-history-heading">
        <header class="domain-head">
          <div>
            <p class="eyebrow">Domain evidence history</p>
            <h3 id="domain-history-heading">{domainHistory.domain}</h3>
          </div>
          <button class="btn small" onclick={() => openCase(domainHistory.domain)}>Open case workspace</button>
        </header>

        <dl class="history-summary">
          <div><dt>Retained watchlist window</dt><dd>{formatDate(domainHistory.watchlistFirstCheckedAt || '')} to {formatDate(domainHistory.watchlistLastCheckedAt || '')}</dd></div>
          <div><dt>Watchlist checks</dt><dd>{domainHistory.retainedWatchlistChecks}</dd></div>
          <div><dt>Material changes</dt><dd>{domainHistory.materialChangeCount}</dd></div>
          <div><dt>Scan modes</dt><dd>{domainHistory.scanModes.join(', ') || 'None retained'}</dd></div>
        </dl>

        <p class="coverage-note">The window describes retained checks for the watchlist. It does not prove this domain was included in every check, or that unrecorded fields stayed unchanged.</p>
        {#if domainHistory.omittedChanges}<p class="partial">This watchlist omitted {domainHistory.omittedChanges} additional change{domainHistory.omittedChanges === 1 ? '' : 's'} across retained checks. They cannot be attributed reliably to this domain, so this view may be incomplete.</p>{/if}

        {#if domainHistory.events.length}
          <div class="domain-events">
            {#each [...domainHistory.events].reverse() as event}
              <article>
                <div class="event-head"><time datetime={event.checkedAt}>{formatDate(event.checkedAt)}</time><span>{event.mode} scan</span></div>
                {#each event.groups as group}
                  <section class="change-group" aria-label={`${group.label} changes`}>
                    <h4>{group.label}</h4>
                    <ul>{#each group.changes as change}<li class={change.tone}><span>{fieldLabels[change.field] || change.field}</span><small>{formatValue(change.before, change.field)} → {formatValue(change.after, change.field)}</small></li>{/each}</ul>
                  </section>
                {/each}
              </article>
            {/each}
          </div>
        {:else}
          <div class="domain-empty"><h4>No retained material changes</h4><p>This means no comparable change for this domain is present in the bounded watchlist history. It does not establish that the domain or its unobserved evidence stayed unchanged.</p></div>
        {/if}
      </section>
    {:else}
      <div class="events">{#each [...history].reverse() as event}<article><div class="event-head"><time datetime={event.checkedAt}>{formatDate(event.checkedAt)}</time><span>{event.mode} scan</span><strong class:changed={event.changeCount > 0}>{event.changeCount} change{event.changeCount === 1 ? '' : 's'}</strong><small>{event.conclusiveCount}/{event.resultCount} conclusive</small></div>{#if event.changes.length}<ul>{#each event.changes as change}<li class={change.tone}><strong>{change.domain}</strong><span>{fieldLabels[change.field] || change.field}</span><small>{formatValue(change.before, change.field)} → {formatValue(change.after, change.field)}</small></li>{/each}</ul>{:else}<p class="no-change">No material changes detected.</p>{/if}{#if event.omittedChanges}<p class="no-change">{event.omittedChanges} additional changes omitted to keep storage bounded.</p>{/if}</article>{/each}</div>
    {/if}
  </section>
{/if}

<style>
  .message{color:var(--accent);font-size:var(--text-sm)}
  .wl-toolbar{padding:16px}
  .watchlists,.history{padding:var(--card-pad)}
  .changed{color:var(--danger);font-weight:700}
  .history{margin-top:16px}
  .history h2{margin:0}
  .history h3,.history h4{margin:0}
  .history .section-head p:not(.eyebrow){margin:5px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .history-focus{display:grid;grid-template-columns:minmax(220px,360px) minmax(0,1fr);gap:5px 14px;align-items:end;margin-top:18px;padding:14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .history-focus label{font:600 var(--text-xs) var(--mono)}
  .history-focus select{grid-row:2;min-width:0;width:100%}
  .history-focus p{grid-column:2;grid-row:2;margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  .history-focus .partial{grid-column:1/-1;grid-row:auto}
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
  .domain-history{min-width:0;margin-top:14px}
  .domain-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 0}
  .domain-head h3{overflow-wrap:anywhere}
  .history-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:0}
  .history-summary div{min-width:0;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .history-summary dt{color:var(--muted);font:600 var(--text-2xs) var(--mono);text-transform:uppercase;letter-spacing:.04em}
  .history-summary dd{margin:5px 0 0;font-size:var(--text-xs);overflow-wrap:anywhere}
  .coverage-note,.partial{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .partial{color:var(--amber)}
  .domain-events{display:grid;gap:10px;margin-top:16px}
  .domain-events>article{padding:15px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .change-group{margin-top:13px}
  .change-group h4{font-size:var(--text-sm)}
  .change-group ul{display:grid;gap:6px;margin:8px 0 0;padding:0;list-style:none}
  .change-group li{display:grid;grid-template-columns:minmax(140px,180px) minmax(0,1fr);gap:10px;padding:8px 10px;border-left:3px solid var(--border);font-size:var(--text-xs)}
  .change-group li.danger{border-color:var(--danger)}
  .change-group li.warn{border-color:var(--amber)}
  .change-group li.good{border-color:var(--accent2)}
  .change-group li span,.change-group li small{overflow-wrap:anywhere}
  .change-group li small{color:var(--muted);font-size:var(--text-xs)}
  .domain-empty{margin-top:16px;padding:16px;border:1px dashed var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .domain-empty p{margin:7px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  @media(max-width:800px){
    .history .section-head{display:block}
    .history .section-head .toolbar{margin-top:12px}
    .table-wrap{margin-inline:calc(-1 * var(--card-pad));padding-inline:var(--card-pad)}
    .events li{grid-template-columns:1fr}
    .event-head small{width:100%;margin:0}
    .history-focus{grid-template-columns:1fr}
    .history-focus select,.history-focus p{grid-column:1;grid-row:auto}
    .domain-head{align-items:flex-start;flex-direction:column}
    .history-summary{grid-template-columns:repeat(2,minmax(0,1fr))}
    .change-group li{grid-template-columns:1fr}
  }
  @media(max-width:420px){
    .history-summary{grid-template-columns:1fr}
  }
</style>
