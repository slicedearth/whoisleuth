<script lang="ts">
  import DataVisualization from '$lib/components/DataVisualization.svelte';
  import {
    projectLifecycleEvents,
    type LifecycleEventInput,
  } from '$lib/analysis/visualization-models.ts';

  let { events }: { events: readonly LifecycleEventInput[] } = $props();
  const timeline = $derived(projectLifecycleEvents(events));
  const EVENT_COLOURS = [
    '#a3f7ff',
    '#9500ff',
    '#ff0095',
    '#006bd6',
    '#f1b1f1',
    '#e65ff2',
    '#307fa6',
    '#0055ff',
  ] as const;
  const eventColour = (index: number): string => EVENT_COLOURS[index] ?? '#a3f7ff';

  function displayDate(value: string) {
    return new Date(value).toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }
</script>

{#if timeline.events.length}
  <DataVisualization
    id="lookup-lifecycle"
    eyebrow="Time context"
    title="Observed lifecycle"
    description="Chronological registry and certificate events from this response. Spacing shows sequence, not elapsed duration."
    metric={timeline.events.length}
    metricLabel="dated events"
    compact
  >
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -- scrollable chart must be keyboard reachable -->
    <div class="timeline-frame" role="img" tabindex="0" aria-label="Chronological lookup lifecycle overview">
      <svg viewBox={`0 0 ${timeline.width} ${timeline.height}`} aria-hidden="true">
        <defs>
          <pattern id="lifecycle-grid" width="22" height="22" patternUnits="userSpaceOnUse">
            <path d="M 22 0 L 0 0 0 22" class="grid-line" />
          </pattern>
        </defs>
        <rect width={timeline.width} height={timeline.height} class="timeline-background" />
        <rect width={timeline.width} height={timeline.height} fill="url(#lifecycle-grid)" />
        <line x1="54" x2="846" y1={timeline.axisY} y2={timeline.axisY} class="timeline-axis" />
        {#each timeline.events as event, index (event.id)}
          <g class={`event event-${event.kind}`} style={`--event-color:${eventColour(index)}`}>
            <line x1={event.x} x2={event.x} y1={timeline.axisY} y2={event.labelY < timeline.axisY ? event.labelY + 14 : event.labelY - 12} />
            {#if event.kind === 'certificate'}
              <rect x={event.x - 5} y={timeline.axisY - 5} width="10" height="10" class="event-shape certificate-shape" transform={`rotate(45 ${event.x} ${timeline.axisY})`} />
            {:else if event.kind === 'observation'}
              <rect x={event.x - 5} y={timeline.axisY - 5} width="10" height="10" rx="2" class="event-shape observation-shape" />
            {:else}
              <circle cx={event.x} cy={timeline.axisY} r="6" class="event-shape registry-shape" />
            {/if}
            <text x={event.x} y={event.labelY} text-anchor={event.anchor} class="event-label">{event.label}</text>
            <text x={event.x} y={event.labelY + 14} text-anchor={event.anchor} class="event-date">{displayDate(event.date)}</text>
          </g>
        {/each}
      </svg>
    </div>

    <ol class="timeline-list" aria-label="Lookup lifecycle events">
      {#each timeline.events as event, index (event.id)}
        <li class={`event-${event.kind}`} style={`--event-color:${eventColour(index)}`}>
          <span class="event-marker" aria-hidden="true"></span>
          <span><strong>{event.label}</strong>{#if event.detail}<small>{event.detail}</small>{/if}</span>
          <time datetime={event.date}>{displayDate(event.date)}</time>
        </li>
      {/each}
    </ol>
    {#if timeline.truncated}<p class="visual-note">The visual is capped at {timeline.events.length} dated events. Detailed source sections remain available below.</p>{/if}
  </DataVisualization>
{/if}

<style>
  .timeline-frame{overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  .timeline-frame:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  svg{display:block;width:100%;height:auto}
  .timeline-background{fill:var(--panel-raised)}
  .grid-line{fill:none;stroke:color-mix(in srgb,var(--border) 55%,transparent);stroke-width:1}
  .timeline-axis{stroke:var(--border-strong);stroke-width:2}
  .event line{stroke:color-mix(in srgb,var(--event-color) 48%,var(--border-strong));stroke-width:1}
  .event-shape{fill:var(--panel);stroke:var(--event-color);stroke-width:3}
  .event-label,.event-date{font-family:var(--mono)}
  .event-label{fill:var(--text);font-size:11px;font-weight:750}
  .event-date{fill:var(--muted);font-size:9px}
  .timeline-list{position:absolute;display:grid;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0;list-style:none}
  .timeline-list li{display:grid;grid-template-columns:8px minmax(0,1fr);gap:8px;align-items:start;padding:8px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .event-marker{width:7px;height:7px;margin-top:5px;border:2px solid var(--event-color);border-radius:50%}
  .event-certificate .event-marker{border-radius:1px;transform:rotate(45deg)}
  .event-observation .event-marker{border-radius:2px}
  .timeline-list strong,.timeline-list small{display:block}
  .timeline-list strong{font:680 var(--text-xs) var(--mono)}
  .timeline-list small{margin-top:2px;color:var(--muted);font-size:var(--text-2xs);line-height:1.4}
  .timeline-list time{grid-column:2;color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .visual-note{margin:9px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  @media(max-width:620px){
    .timeline-frame{display:none}
    .timeline-list{position:static;width:auto;height:auto;margin:0;overflow:visible;clip:auto;clip-path:none;white-space:normal;grid-template-columns:minmax(0,1fr);gap:0}
    .timeline-list li{position:relative;grid-template-columns:14px minmax(0,1fr);gap:0 10px;min-height:58px;padding:7px 0 12px;border:0;border-radius:0;background:transparent}
    .timeline-list li:not(:last-child)::after{position:absolute;z-index:0;top:17px;bottom:-7px;left:3px;width:1px;background:var(--border-strong);content:""}
    .event-marker{z-index:1;width:9px;height:9px;margin-top:3px;background:var(--panel)}
    .timeline-list time{grid-column:2;margin-top:4px}
  }
</style>
