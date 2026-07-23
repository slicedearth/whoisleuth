<script lang="ts">
  import DataVisualization from '$lib/components/DataVisualization.svelte';
  import {
    projectLifecycleEvents,
    type LifecycleEventInput,
  } from '$lib/analysis/visualization-models.ts';

  let { events }: { events: LifecycleEventInput[] } = $props();
  const timeline = $derived(projectLifecycleEvents(events));

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
        {#each timeline.events as event (event.id)}
          <g class={`event event-${event.kind}`}>
            <line x1={event.x} x2={event.x} y1={timeline.axisY} y2={event.labelY < timeline.axisY ? event.labelY + 14 : event.labelY - 12} />
            <circle cx={event.x} cy={timeline.axisY} r="6" />
            <text x={event.x} y={event.labelY} text-anchor={event.anchor} class="event-label">{event.label}</text>
            <text x={event.x} y={event.labelY + 14} text-anchor={event.anchor} class="event-date">{displayDate(event.date)}</text>
          </g>
        {/each}
      </svg>
    </div>

    <ol class="timeline-list" aria-label="Lookup lifecycle events">
      {#each timeline.events as event (event.id)}
        <li class={`event-${event.kind}`}>
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
  .event line{stroke:var(--border-strong);stroke-width:1}
  .event circle{fill:var(--panel);stroke:var(--accent2);stroke-width:3}
  .event-certificate circle{stroke:var(--accent)}
  .event-observation circle{stroke:var(--amber)}
  .event-label,.event-date{font-family:var(--mono)}
  .event-label{fill:var(--text);font-size:11px;font-weight:750}
  .event-date{fill:var(--muted);font-size:9px}
  .timeline-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(170px,100%),1fr));gap:7px;margin:9px 0 0;padding:0;list-style:none}
  .timeline-list li{display:grid;grid-template-columns:8px minmax(0,1fr);gap:8px;align-items:start;padding:8px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .event-marker{width:7px;height:7px;margin-top:5px;border:2px solid var(--accent2);border-radius:50%}
  .event-certificate .event-marker{border-color:var(--accent)}
  .event-observation .event-marker{border-color:var(--amber)}
  .timeline-list strong,.timeline-list small{display:block}
  .timeline-list strong{font:680 var(--text-xs) var(--mono)}
  .timeline-list small{margin-top:2px;color:var(--muted);font-size:var(--text-2xs);line-height:1.4}
  .timeline-list time{grid-column:2;color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .visual-note{margin:9px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  @media(max-width:620px){
    .timeline-frame{display:none}
    .timeline-list{grid-template-columns:minmax(0,1fr);gap:0;margin-top:0}
    .timeline-list li{position:relative;grid-template-columns:14px minmax(0,1fr);gap:0 10px;min-height:58px;padding:7px 0 12px;border:0;border-radius:0;background:transparent}
    .timeline-list li:not(:last-child)::after{position:absolute;z-index:0;top:17px;bottom:-7px;left:3px;width:1px;background:var(--border-strong);content:""}
    .event-marker{z-index:1;width:9px;height:9px;margin-top:3px;background:var(--panel)}
    .timeline-list time{grid-column:2;margin-top:4px}
  }
</style>
