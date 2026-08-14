<script lang="ts">
  import { tick } from 'svelte';
  import {
    projectTrendPoints,
    type TrendPointInput,
  } from '$lib/analysis/visualization-models.ts';
  import { MAX_CT_HISTORY_EVENTS } from '$lib/analysis/ct-history.ts';
  type HistoryCheck = {
    checkedAt: string;
    checkedLabel: string;
    resultCount: number;
    newCount: number;
    truncated: boolean;
    classificationComplete: boolean;
    firstObservedCount: number;
    continuingCount: number;
    reappearedCount: number;
    historyUnknownCount: number;
  };
  type HistoryEntry = {
    query: string;
    domainCount: number;
    checkCount: number;
    updatedLabel: string;
    latestNewCount: number;
    everSeenCount: number;
    everSeenComplete: boolean;
    discardedCheckCount: number;
    discardedCheckCountKnown: boolean;
    discardedCheckCountCapped: boolean;
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
    deleteEntry: (query: string) => void | Promise<void>;
    clearHistory: () => void | Promise<void>;
  } = $props();

  function focusMovedAway(origin: Element | null): boolean {
    const active = document.activeElement;
    return active instanceof HTMLElement
      && active !== origin
      && active !== document.body
      && active.isConnected;
  }

  function certificateViewStillOwnsFocus(owner: HTMLElement | null, origin: Element | null): boolean {
    const tab = document.getElementById('discovery-tab-certificate-transparency');
    return Boolean(owner?.isConnected
      && tab?.isConnected
      && tab.getAttribute('aria-selected') === 'true'
      && !focusMovedAway(origin));
  }

  function checkTrend(checks: HistoryCheck[]) {
    return projectTrendPoints(checks.map((check, index): TrendPointInput => ({
      id: `${check.checkedAt}-${index}`,
      date: check.checkedAt,
      total: check.resultCount,
      added: check.newCount,
      partial: check.truncated,
    })));
  }

  type TrendPoint = ReturnType<typeof projectTrendPoints>['points'][number];

  function cappedMarkerPoints(point: TrendPoint): string {
    const radius = 7;
    return `${point.x},${point.y - radius} ${point.x + radius},${point.y} ${point.x},${point.y + radius} ${point.x - radius},${point.y}`;
  }

  function cappedCheckLabel(count: number): string {
    return `${count} capped lower-bound check${count === 1 ? '' : 's'}`;
  }

  function axisTimestamp(value: string | null): string {
    if (!value) return 'Unknown';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 'Unknown' : parsed.toISOString();
  }

  async function deleteAndFocus(query: string) {
    const origin = document.activeElement;
    const owner = origin instanceof HTMLElement
      ? origin.closest<HTMLElement>('#discovery-method-panel')
      : null;
    const previousIndex = entries.findIndex((entry) => entry.query === query);
    await deleteEntry(query);
    await tick();
    if (!certificateViewStillOwnsFocus(owner, origin)) return;
    if (origin instanceof HTMLElement && origin.isConnected) {
      origin.focus();
      return;
    }
    const deleteButtons = [...document.querySelectorAll<HTMLElement>('[data-ct-history-delete]')];
    const nextDelete = deleteButtons[Math.min(Math.max(0, previousIndex), deleteButtons.length - 1)] ?? null;
    const candidates = [
      nextDelete,
      document.getElementById('discovery-seed'),
      document.getElementById('discovery-tab-certificate-transparency'),
    ];
    const target = candidates.find((candidate) => candidate instanceof HTMLElement);
    if (target instanceof HTMLElement) target.focus();
  }

  async function clearAndFocus() {
    const origin = document.activeElement;
    const owner = origin instanceof HTMLElement
      ? origin.closest<HTMLElement>('#discovery-method-panel')
      : null;
    await clearHistory();
    await tick();
    if (!certificateViewStillOwnsFocus(owner, origin)) return;
    if (origin instanceof HTMLElement && origin.isConnected) {
      origin.focus();
      return;
    }
    const target = document.getElementById('discovery-seed')
      ?? document.getElementById('discovery-tab-certificate-transparency');
    if (target instanceof HTMLElement) target.focus();
  }
</script>

<details class="ct-history">
  <summary>Previous certificate searches · {entries.length}</summary>
  <div class="ct-history-list">
    {#each entries as entry, index (entry.query)}
      <article>
        <div>
          <strong>{entry.query}</strong>
          <small>{entry.domainCount} baseline domain{entry.domainCount === 1 ? '' : 's'} · {entry.checkCount} retained check{entry.checkCount === 1 ? '' : 's'}</small>
          <small>Last checked {entry.updatedLabel}{entry.latestNewCount ? ` · ${entry.latestNewCount} not in the prior complete baseline` : ''}</small>
          <small>{entry.everSeenComplete ? entry.everSeenCount : `At least ${entry.everSeenCount}`} domain{entry.everSeenCount === 1 ? '' : 's'} in the retained ever-seen set{entry.everSeenComplete ? '' : ' · earlier history incomplete'}</small>
          {#if entry.checks.length}
            <details class="ct-checks"><summary>View check history</summary>{@render Trend(entry.checks)}<ol>{#each entry.checks as check}<li><time datetime={check.checkedAt}>{check.checkedLabel}</time><span>{#if check.truncated}At least {check.resultCount} result{check.resultCount === 1 ? '' : 's'} · continuity and reappearance unclassified · capped lower bound{:else if check.classificationComplete}{check.resultCount} result{check.resultCount === 1 ? '' : 's'} · {check.firstObservedCount} first · {check.reappearedCount} reappeared · {check.continuingCount} continuing{check.historyUnknownCount ? ` · ${check.historyUnknownCount} history unknown` : ''}{:else}{check.resultCount} result{check.resultCount === 1 ? '' : 's'} · earlier-schema classification unavailable{/if}</span></li>{/each}</ol>{#if entry.discardedCheckCountKnown && entry.discardedCheckCount > 0}<p class="history-limit">Showing the {entry.checkCount} most recent retained checks. {entry.discardedCheckCountCapped ? 'At least ' : ''}{entry.discardedCheckCount} older check{entry.discardedCheckCount === 1 ? '' : 's'} {entry.discardedCheckCount === 1 ? 'was' : 'were'} discarded by local retention.</p>{:else if !entry.discardedCheckCountKnown && entry.discardedCheckCount > 0}<p class="history-limit">Showing the {entry.checkCount} most recent retained checks. At least {entry.discardedCheckCount} older check{entry.discardedCheckCount === 1 ? '' : 's'} {entry.discardedCheckCount === 1 ? 'was' : 'were'} discarded while this history was normalised or retained; any earlier schema 1 pruning remains unknown.</p>{:else if !entry.discardedCheckCountKnown}<p class="history-limit">This history was migrated from an earlier retention schema. Whether older checks were discarded before migration is unknown.</p>{:else if entry.checks.length === MAX_CT_HISTORY_EVENTS}<p class="history-limit">At capacity with {MAX_CT_HISTORY_EVENTS} retained checks. No older check has been discarded under the current retention record.</p>{/if}</details>
          {/if}
        </div>
        <div><button class="btn small" aria-label={`Use ${entry.query} certificate search`} onclick={() => useEntry(entry.query)}>Use</button><button class="btn small danger" data-ct-history-delete={index} aria-label={`Delete ${entry.query} certificate history`} onclick={() => void deleteAndFocus(entry.query)}>Delete</button></div>
      </article>
    {/each}
  </div>
  <button class="btn small danger ct-clear-history" onclick={() => void clearAndFocus()}>Clear all certificate history</button>
</details>

{#snippet Trend(checks: HistoryCheck[])}
  {@const trend = checkTrend(checks)}
  {#if trend.points.length > 1}
    <figure class="ct-trend">
      <svg viewBox={`0 0 ${trend.width} ${trend.height}`} role="img" aria-label={`Certificate search trend across ${trend.points.length} retained checks, including ${cappedCheckLabel(trend.summary.partialChecks)}, positioned by elapsed check time`}>
        <title>Certificate search result trend across {trend.points.length} retained checks, including {cappedCheckLabel(trend.summary.partialChecks)}, positioned by elapsed check time</title>
        {#each trend.ticks as tick}<line class="grid-line" x1="64" x2="850" y1={tick.y} y2={tick.y}></line><text x="52" y={tick.y + 3} text-anchor="end">{tick.value}</text>{/each}
        {#each trend.segments as segment}
          <line class="trend-segment" x1={segment.x1} y1={segment.y1} x2={segment.x2} y2={segment.y2}><title>Measured change between adjacent complete retained checks</title></line>
        {/each}
        {#each trend.points as point}
          {#if point.partial}
            <polygon class="trend-marker capped" points={cappedMarkerPoints(point)}><title>{point.date}: at least {point.total} results, at least {point.added} new; capped lower bound</title></polygon>
          {:else}
            <circle class="trend-marker" cx={point.x} cy={point.y} r="5"><title>{point.date}: {point.total} results, {point.added} new</title></circle>
          {/if}
        {/each}
        <text class="axis-timestamp" x="64" y="215" text-anchor="start">{axisTimestamp(trend.elapsed.firstAt)}</text>
        <text x="450" y="215" text-anchor="middle" class="elapsed-label">Elapsed check time</text>
        <text class="axis-timestamp" x="850" y="215" text-anchor="end">{axisTimestamp(trend.elapsed.latestAt)}</text>
      </svg>
      <dl class="ct-trend-summary" aria-label="Certificate search trend summary">
        <div><dt>First</dt><dd>{trend.summary.first.label}</dd></div>
        <div><dt>Latest</dt><dd>{trend.summary.latest.label}</dd></div>
        <div><dt>Peak</dt><dd>{trend.summary.peak.label}</dd></div>
        <div><dt>Newly found</dt><dd>{trend.summary.newlyObserved.label}</dd></div>
        <div><dt>Capped checks</dt><dd>{trend.summary.partialChecks}</dd></div>
      </dl>
      <figcaption>Horizontal spacing represents elapsed time between retained check timestamps, not equal sequence steps.{#if trend.summary.partialChecks} {trend.summary.partialChecks} capped check{trend.summary.partialChecks === 1 ? '' : 's'} {trend.summary.partialChecks === 1 ? 'is a' : 'are'} diamond lower-bound marker{trend.summary.partialChecks === 1 ? '' : 's'}. Segments touching a capped check are omitted, leaving visible gaps because the rise or drop is unknown.{/if}{#if trend.truncated} Only the latest {trend.points.length} valid checks are plotted.{/if}</figcaption>
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
  .history-limit{margin:7px 0 0;color:var(--amber);font-size:var(--text-2xs);line-height:1.45}
  .ct-trend{max-width:100%;margin:8px 0 0;overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .ct-trend svg{display:block;width:100%;height:auto}
  .ct-trend .grid-line{stroke:var(--border);stroke-width:1}
  .ct-trend text{fill:var(--muted);font:9px var(--mono)}
  .ct-trend .elapsed-label{font-weight:700;text-transform:uppercase;letter-spacing:.04em}
  .ct-trend .trend-segment{stroke:var(--accent);stroke-width:3}
  .ct-trend .trend-marker{fill:var(--panel);stroke:var(--accent);stroke-width:3}
  .ct-trend .trend-marker.capped{fill:var(--panel);stroke:var(--amber)}
  .ct-trend-summary{display:none}
  .ct-trend figcaption{padding:7px 10px;border-top:1px solid var(--border);color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
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
    .ct-trend-summary dd{margin:3px 0 0;color:var(--text);font:700 var(--text-md) var(--mono)}
  }
</style>
