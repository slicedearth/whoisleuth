<script lang="ts">
  import DataVisualization from '$lib/components/DataVisualization.svelte';
  import {
    projectWatchlistActivity,
    type WatchlistActivityInput,
  } from '$lib/analysis/visualization-models.ts';

  let { events }: { events: WatchlistActivityInput[] } = $props();
  const activity = $derived(projectWatchlistActivity(events));
  const activeDays = $derived(activity.days.filter((day) => day.checks > 0));
  function intensity(changes: number) {
    if (changes <= 0 || activity.maxChanges <= 0) return 0;
    return 0.24 + changes / activity.maxChanges * 0.76;
  }
</script>

{#if activity.days.length}
  <DataVisualization
    id="watchlist-activity"
    eyebrow="Retained history"
    title="Watchlist activity"
    description="A 28-day view ending at the latest retained check. Empty cells mean no retained check for that day, not proof that no monitoring occurred."
    metric={activity.totalChanges}
    metricLabel="material changes"
    compact
  >
    <div class="activity-layout">
      <div class="heatmap-frame" role="img" aria-label={`${activity.totalChecks} retained watchlist checks with ${activity.totalChanges} material changes`}>
        <svg viewBox={`0 0 ${activity.width} ${activity.height}`} aria-hidden="true">
          <text x="12" y="39" class="day-label">1</text>
          <text x="12" y="100" class="day-label">4</text>
          <text x="12" y="159" class="day-label">7</text>
          {#each activity.days as day (day.date)}
            <g class:checked={day.checks > 0}>
              <rect
                x={day.x}
                y={day.y}
                width={day.width}
                height={day.height}
                rx="4"
                style:opacity={day.changes > 0 ? intensity(day.changes) : 1}
                class:changed={day.changes > 0}
              />
              {#if day.checks > 0}<text x={day.x + day.width / 2} y={day.y + day.height / 2 + 3} text-anchor="middle">{day.changes}</text>{/if}
            </g>
          {/each}
          <text x="72" y="184" class="week-label">earlier</text>
          <text x="580" y="184" text-anchor="end" class="week-label">latest retained check</text>
        </svg>
      </div>
      <div class="activity-summary">
        <div><strong>{activity.totalChecks}</strong><span>retained checks</span></div>
        <div><strong>{activeDays.length}</strong><span>days represented</span></div>
        <div><strong>{activity.maxChanges}</strong><span>largest daily change count</span></div>
      </div>
    </div>
    <ol class="activity-list" aria-label="Retained watchlist activity by day">
      {#each activeDays as day (day.date)}
        <li>
          <time datetime={day.date}>{day.label}</time>
          <span>{day.checks} check{day.checks === 1 ? '' : 's'}</span>
          <strong>{day.changes} change{day.changes === 1 ? '' : 's'}</strong>
        </li>
      {/each}
    </ol>
  </DataVisualization>
{/if}

<style>
  .activity-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(155px,.3fr);gap:10px}
  .heatmap-frame{min-width:0;overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  svg{display:block;width:100%;height:auto}
  rect{fill:var(--panel);stroke:var(--border)}
  g.checked rect{fill:rgb(var(--accent-rgb) / .14);stroke:rgb(var(--accent-rgb) / .45)}
  rect.changed{fill:var(--accent2);stroke:var(--accent2)}
  g text{fill:var(--text);font:700 9px var(--mono)}
  .day-label,.week-label{fill:var(--muted);font-family:var(--mono)}
  .day-label{font-size:8px}
  .week-label{font-size:9px}
  .activity-summary{display:grid;gap:7px}
  .activity-summary div{display:grid;align-content:center;padding:9px 11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .activity-summary strong{color:var(--accent);font:750 var(--text-lg) var(--mono)}
  .activity-summary span{color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .activity-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(165px,100%),1fr));gap:6px;margin:9px 0 0;padding:0;list-style:none}
  .activity-list li{display:grid;grid-template-columns:1fr auto;gap:3px 8px;padding:7px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);font-size:var(--text-2xs)}
  .activity-list time{color:var(--text);font:680 var(--text-2xs) var(--mono)}
  .activity-list span{grid-column:1;color:var(--muted)}
  .activity-list strong{grid-column:2;grid-row:1 / span 2;align-self:center;color:var(--accent2);font:700 var(--text-2xs) var(--mono)}
  @media(max-width:700px){
    .activity-layout{grid-template-columns:1fr}
    .activity-summary{grid-template-columns:repeat(3,minmax(0,1fr))}
  }
  @media(max-width:480px){
    .activity-summary{grid-template-columns:1fr}
  }
</style>
