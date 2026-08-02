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
    <figure class="ct-trend">
      <svg viewBox={`0 0 ${trend.width} ${trend.height}`} role="img" aria-label={`Certificate search trend across ${trend.points.length} retained checks`}>
        <title>Certificate search result trend across {trend.points.length} retained checks</title>
        {#each trend.ticks as tick}<line x1="64" x2="850" y1={tick.y} y2={tick.y}></line><text x="52" y={tick.y + 3} text-anchor="end">{tick.value}</text>{/each}
        <polyline points={trend.points.map((point) => `${point.x},${point.y}`).join(' ')}></polyline>
        {#each trend.points as point}
          <circle cx={point.x} cy={point.y} r="5" class:partial={point.partial}><title>{point.date}: {point.total} results, {point.added} new{point.partial ? ', capped' : ''}</title></circle>
        {/each}
      </svg>
      <dl class="ct-trend-summary" aria-label="Certificate search trend summary">
        <div><dt>First</dt><dd>{trend.summary.firstTotal}</dd></div>
        <div><dt>Latest</dt><dd>{trend.summary.latestTotal}</dd></div>
        <div><dt>Peak</dt><dd>{trend.summary.peakTotal}</dd></div>
        <div><dt>Newly found</dt><dd>{trend.summary.newlyObserved}</dd></div>
      </dl>
    </figure>
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
  .ct-trend{max-width:100%;margin:8px 0 0;overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .ct-trend svg{display:block;width:100%;height:auto}
  .ct-trend line{stroke:var(--border);stroke-width:1}
  .ct-trend text{fill:var(--muted);font:9px var(--mono)}
  .ct-trend polyline{fill:none;stroke:var(--accent);stroke-width:3}
  .ct-trend circle{fill:var(--panel);stroke:var(--accent);stroke-width:3}
  .ct-trend circle.partial{stroke:var(--amber)}
  .ct-trend-summary{display:none}
  .ct-clear-history{margin-top:9px}
  @media(max-width:700px){
    .ct-history article{align-items:flex-start;flex-direction:column}
    .ct-history article>div:last-child{width:100%}
  }
  @media(max-width:600px){
    .ct-trend svg{display:none}
    .ct-trend-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin:0;background:var(--border)}
    .ct-trend-summary div{min-width:0;padding:10px;background:var(--panel-raised)}
    .ct-trend-summary dt{color:var(--muted);font:600 var(--text-2xs) var(--mono);text-transform:uppercase;letter-spacing:.06em}
    .ct-trend-summary dd{margin:3px 0 0;color:var(--text);font:700 var(--text-base) var(--mono)}
  }
</style>
