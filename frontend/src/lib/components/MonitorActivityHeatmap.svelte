<script lang="ts">
  import VisualizationFrame from '$lib/components/VisualizationFrame.svelte';
  import {
    projectWatchlistActivity,
    type WatchlistActivityInput,
  } from '$lib/analysis/visualization-models.ts';

  let { events }: { events: WatchlistActivityInput[] } = $props();
  const activity = $derived(projectWatchlistActivity(events));
  const activeDays = $derived(activity.days.filter((day) => day.checks > 0));
  const activityLegend = [
    { token: 'activity-empty' as const, label: 'No retained check', shape: 'square' as const, dashed: true },
    { token: 'activity-checked' as const, label: 'Retained check · no material change', shape: 'square' as const },
    { token: 'activity-changed' as const, label: 'Retained check · material-change count shown', shape: 'square' as const },
  ];
  function intensity(changes: number) {
    if (changes <= 0 || activity.maxChanges <= 0) return 0;
    return 0.24 + changes / activity.maxChanges * 0.76;
  }
</script>

{#if activity.days.length}
  <VisualizationFrame
    id="watchlist-activity"
    eyebrow="Retained history"
    title="Watchlist activity"
    description="Rows are UTC weekdays and columns are consecutive seven-day blocks in a 28-day window ending at the latest retained check. Empty cells mean no retained check, not proof that no monitoring occurred."
    metric={activity.totalChanges}
    metricLabel="material changes"
    visualLabel={`${activity.totalChecks} retained watchlist checks with ${activity.totalChanges} material changes from ${activity.windowStart} through ${activity.windowEnd}, grouped by UTC calendar day`}
    legend={activityLegend}
    legendLabel="Watchlist activity cell key"
  >
    {#snippet visual()}
      <div class="activity-layout">
        <svg viewBox={`0 0 ${activity.width} ${activity.height}`} aria-hidden="true">
          <defs>
            <pattern id="activity-change-pattern" width="6" height="6" patternUnits="userSpaceOnUse">
              <rect width="6" height="6" class="changed-background" />
              <path d="M -1 1 L 1 -1 M 0 6 L 6 0 M 5 7 L 7 5" class="changed-stripe" />
            </pattern>
          </defs>
          <text x="12" y="20" class="axis-title">UTC weekday</text>
          {#each activity.weekdayLabels as weekday (weekday.index)}
            <text x="12" y={weekday.y} class="day-label">{weekday.label}</text>
          {/each}
          {#each activity.days as day (day.date)}
            <g class:checked={day.checks > 0} class:changed={day.changes > 0} data-state={day.changes > 0 ? 'changed' : day.checks > 0 ? 'checked' : 'empty'}>
              <rect
                x={day.x}
                y={day.y}
                width={day.width}
                height={day.height}
                rx="4"
                style:opacity={day.changes > 0 ? intensity(day.changes) : 1}
              ><title>{day.label} UTC: {day.checks} retained check{day.checks === 1 ? '' : 's'}, {day.changes} material change{day.changes === 1 ? '' : 's'}</title></rect>
              {#if day.checks > 0}<text x={day.x + day.width / 2} y={day.y + day.height / 2 + 3} text-anchor="middle">{day.changes}</text>{/if}
            </g>
          {/each}
          {#each activity.weekLabels as week (week.index)}
            <text x={week.x} y="211" text-anchor="middle" class="week-label">{week.label}</text>
          {/each}
          <text x="92" y="228" class="axis-title">Consecutive seven-day blocks →</text>
        </svg>
        <div class="activity-summary">
          <div><strong>{activity.totalChecks}</strong><span>retained checks</span></div>
          <div><strong>{activeDays.length}</strong><span>UTC days represented</span></div>
          <div><strong>{activity.maxChanges}</strong><span>largest daily change count</span></div>
        </div>
      </div>
    {/snippet}
    {#snippet fallback()}
      <p class="fallback-note">Exact retained activity within {activity.windowStart}–{activity.windowEnd} UTC. Days not listed have no retained check.</p>
      <ol class="visual-fallback-list activity-list" aria-label="Retained watchlist activity by UTC day">
        {#each activeDays as day (day.date)}
          <li>
            <time datetime={day.date}>{day.label} UTC</time>
            <span>{day.checks} check{day.checks === 1 ? '' : 's'}</span>
            <strong>{day.changes} change{day.changes === 1 ? '' : 's'}</strong>
          </li>
        {/each}
      </ol>
    {/snippet}
  </VisualizationFrame>
{/if}

<style>
  .activity-layout{display:grid;grid-template-columns:minmax(600px,1fr) minmax(155px,.3fr);gap:10px;padding:10px}
  svg{display:block;width:100%;min-width:600px;height:auto}
  g rect{fill:var(--panel);stroke:var(--border-strong);stroke-dasharray:3 2}
  g.checked rect{fill:color-mix(in srgb,var(--source-network-stroke) 18%,var(--panel));stroke:var(--source-network-stroke);stroke-dasharray:none}
  g.changed rect{fill:url(#activity-change-pattern);stroke:var(--source-whois-stroke);stroke-dasharray:none}
  .changed-background{fill:color-mix(in srgb,var(--source-whois-stroke) 72%,var(--panel))}
  .changed-stripe{fill:none;stroke:color-mix(in srgb,var(--panel) 58%,transparent);stroke-width:1.3}
  g text{fill:var(--text);font:700 9px var(--mono)}
  .day-label,.week-label,.axis-title{fill:var(--muted);font-family:var(--mono)}
  .day-label{font-size:9px}
  .week-label{font-size:8px}
  .axis-title{font-size:8px;font-weight:700;letter-spacing:.03em;text-transform:uppercase}
  .activity-summary{display:grid;gap:7px}
  .activity-summary div{display:grid;align-content:center;padding:9px 11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .activity-summary strong{color:var(--accent);font:750 var(--text-lg) var(--mono)}
  .activity-summary span{color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .activity-list li{display:grid;grid-template-columns:1fr auto;gap:3px 8px;padding:7px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);font-size:var(--text-2xs)}
  .activity-list time{color:var(--text);font:680 var(--text-2xs) var(--mono)}
  .activity-list span{grid-column:1;color:var(--muted)}
  .activity-list strong{grid-column:2;grid-row:1 / span 2;align-self:center;color:var(--source-whois-text);font:700 var(--text-2xs) var(--mono)}
  .fallback-note{margin:10px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  @media(max-width:700px){
    .activity-layout{grid-template-columns:minmax(600px,1fr)}
    .activity-summary{grid-template-columns:repeat(3,minmax(0,1fr))}
  }
  @media(max-width:480px){
    .activity-summary{grid-template-columns:1fr}
  }
</style>
