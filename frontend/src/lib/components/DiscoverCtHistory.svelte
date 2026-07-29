<script lang="ts">
  import {
    projectTrendPoints,
    type TrendPointInput,
  } from '$lib/analysis/visualization-models.ts';
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

  function checkTrend(checks: HistoryCheck[]) {
    return projectTrendPoints(checks.map((check, index): TrendPointInput => ({
      id: `${check.checkedAt}-${index}`,
      date: check.checkedAt,
      total: check.resultCount,
      added: check.newCount,
      partial: check.truncated,
    })));
  }
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
            <details class="ct-checks"><summary>View check history</summary>{@render Trend(entry.checks)}<ol>{#each entry.checks as check}<li><time datetime={check.checkedAt}>{check.checkedLabel}</time><span>{check.resultCount} result{check.resultCount === 1 ? '' : 's'} · {check.newCount} new{check.truncated ? ' · capped' : ''}</span></li>{/each}</ol></details>
          {/if}
        </div>
        <div><button class="btn small" aria-label={`Use ${entry.query} certificate search`} onclick={() => useEntry(entry.query)}>Use</button><button class="btn small danger" aria-label={`Delete ${entry.query} certificate history`} onclick={() => deleteEntry(entry.query)}>Delete</button></div>
      </article>
    {/each}
  </div>
  <button class="btn small danger ct-clear-history" onclick={clearHistory}>Clear all certificate history</button>
</details>

{#snippet Trend(checks: HistoryCheck[])}
  {@const trend = checkTrend(checks)}
  {#if trend.points.length > 1}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -- scrollable trend must be keyboard reachable -->
    <div class="ct-trend" role="img" tabindex="0" aria-label={`Certificate search trend across ${trend.points.length} retained checks`}>
      <svg viewBox={`0 0 ${trend.width} ${trend.height}`} aria-hidden="true">
        {#each trend.ticks as tick}<line x1="64" x2="850" y1={tick.y} y2={tick.y}></line><text x="52" y={tick.y + 3} text-anchor="end">{tick.value}</text>{/each}
        <polyline points={trend.points.map((point) => `${point.x},${point.y}`).join(' ')}></polyline>
        {#each trend.points as point}
          <circle cx={point.x} cy={point.y} r="5" class:partial={point.partial}><title>{point.date}: {point.total} results, {point.added} new{point.partial ? ', capped' : ''}</title></circle>
        {/each}
      </svg>
    </div>
  {/if}
{/snippet}

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
  .ct-trend{max-width:100%;margin-top:8px;overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .ct-trend:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .ct-trend svg{display:block;width:100%;min-width:460px;height:auto}
  .ct-trend line{stroke:var(--border);stroke-width:1}
  .ct-trend text{fill:var(--muted);font:9px var(--mono)}
  .ct-trend polyline{fill:none;stroke:var(--accent);stroke-width:3}
  .ct-trend circle{fill:var(--panel);stroke:var(--accent);stroke-width:3}
  .ct-trend circle.partial{stroke:var(--amber)}
  .ct-clear-history{margin-top:9px}
  @media(max-width:700px){
    .ct-history article{align-items:flex-start;flex-direction:column}
    .ct-history article>div:last-child{width:100%}
  }
</style>
