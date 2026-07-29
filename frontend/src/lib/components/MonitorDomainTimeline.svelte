<script lang="ts">
  import {
    projectMonitorTimeline,
    type MonitorTimelineInput,
  } from '$lib/analysis/visualization-models.ts';

  type TimelineEvent = {
    checkedAt: string;
    mode: string;
    groups: Array<{ key: string; label: string; changes: unknown[] }>;
  };

  let {
    events,
    formatDate,
  }: {
    events: TimelineEvent[];
    formatDate: (value: string) => string;
  } = $props();

  const timeline = $derived(projectMonitorTimeline(events.map((event, index): MonitorTimelineInput => ({
    id: `${event.checkedAt}-${index}`,
    checkedAt: event.checkedAt,
    mode: event.mode,
    groups: event.groups.map((group) => ({
      key: group.key,
      label: group.label,
      changeCount: group.changes.length,
    })),
  }))));
</script>

{#if timeline.events.length && timeline.lanes.length}
  <section class="timeline" aria-labelledby="domain-change-timeline-title">
    <header><div><p class="eyebrow">Change sequence</p><h4 id="domain-change-timeline-title">Observed domain timeline</h4></div>{#if timeline.truncated}<span>Partial visual</span>{/if}</header>
    <p>Each column is a retained check. Filled cells show the categories with recorded changes; the exact before and after values remain below.</p>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -- scrollable timeline must be keyboard reachable -->
    <div class="timeline-frame" role="img" tabindex="0" aria-label={`Observed domain timeline with ${timeline.events.length} checks and ${timeline.lanes.length} evidence categories`}>
      <svg viewBox={`0 0 ${timeline.width} ${timeline.height}`} aria-hidden="true">
        {#each timeline.lanes as lane}
          <text x="8" y={lane.y + lane.height / 2 + 3}>{lane.label}</text>
        {/each}
        {#each timeline.events as event}
          {#each event.cells as cell}
            <rect
              x={event.x}
              y={cell.y}
              width={event.width}
              height={cell.height}
              rx="4"
              class:changed={cell.count > 0}
              fill-opacity={cell.count > 0 ? Math.max(.22, cell.count / timeline.maxChanges) : 1}
            ><title>{formatDate(event.checkedAt)}: {cell.label}, {cell.count} change{cell.count === 1 ? '' : 's'}</title></rect>
          {/each}
          <text x={event.x + event.width / 2} y="25" text-anchor="middle" class="date">{formatDate(event.checkedAt).slice(0, 10)}</text>
        {/each}
      </svg>
      <div class="mobile-events" aria-hidden="true">
        {#each timeline.events as event}
          <article>
            <strong>{formatDate(event.checkedAt)}</strong>
            <div>
              {#each event.cells as cell}
                <span class:changed={cell.count > 0}>
                  {cell.label}
                  <b>{cell.count}</b>
                </span>
              {/each}
            </div>
          </article>
        {/each}
      </div>
    </div>
  </section>
{/if}

<style>
  .timeline{min-width:0;margin-top:15px;padding:13px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
  h4{margin:2px 0 0;font:700 var(--text-sm) var(--mono)}
  header span{color:var(--amber);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  .timeline>p{max-width:780px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .timeline-frame{max-width:100%;margin-top:11px;overflow:auto;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .timeline-frame:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  svg{display:block;width:100%;min-width:680px;height:auto}
  .mobile-events{display:none}
  rect{fill:var(--panel);stroke:var(--border);stroke-width:1}
  rect.changed{fill:var(--accent);stroke:var(--accent)}
  text{fill:var(--text);font:600 9px var(--mono)}
  text.date{fill:var(--muted);font-size:8px}
  @media(max-width:620px){
    .timeline-frame{overflow:visible}
    .timeline-frame svg{display:none}
    .mobile-events{display:grid;gap:8px;padding:10px}
    .mobile-events article{display:grid;gap:7px;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:rgb(var(--bg-rgb) / .35)}
    .mobile-events article>strong{color:var(--text);font:700 var(--text-2xs) var(--mono)}
    .mobile-events article>div{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px}
    .mobile-events span{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:5px;padding:6px 7px;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--muted);font:600 .58rem var(--mono);overflow-wrap:anywhere}
    .mobile-events span.changed{border-color:color-mix(in srgb,var(--accent) 55%,var(--border));background:rgb(var(--accent-rgb) / .09);color:var(--text)}
    .mobile-events b{display:grid;min-width:18px;height:18px;place-items:center;border-radius:999px;background:var(--panel-raised);color:var(--accent);font-size:.56rem}
  }
</style>
