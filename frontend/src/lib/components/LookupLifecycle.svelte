<script lang="ts">
  import VisualizationFrame from '$lib/components/VisualizationFrame.svelte';
  import {
    projectLifecycleEvents,
    type LifecycleEventInput,
  } from '$lib/analysis/visualization-models.ts';

  let { events }: { events: readonly LifecycleEventInput[] } = $props();
  const timeline = $derived(projectLifecycleEvents(events));
  const lifecycleLegend = [
    { token: 'registration' as const, label: 'Registry event', shape: 'circle' as const },
    { token: 'certificate' as const, label: 'Certificate event', shape: 'diamond' as const },
    { token: 'observation' as const, label: 'Lookup observation', shape: 'square' as const },
  ];

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
  <VisualizationFrame
    id="lookup-lifecycle"
    eyebrow="Time context"
    title="Observed lifecycle"
    description="Chronological registry and certificate events from this response. Spacing shows sequence, not elapsed duration."
    metric={timeline.events.length}
    metricLabel="dated events"
    visualLabel="Chronological lookup lifecycle overview"
    legend={lifecycleLegend}
    legendLabel="Lifecycle event key"
    fallbackMode="mobile"
    note={timeline.truncated ? `The visual is capped at ${timeline.events.length} dated events. Detailed source sections remain available below.` : undefined}
  >
    {#snippet visual()}
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
          <g class={`event event-${event.kind}`} data-kind={event.kind}>
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
    {/snippet}
    {#snippet fallback()}
      <ol class="visual-fallback-list timeline-list" aria-label="Lookup lifecycle events">
        {#each timeline.events as event (event.id)}
          <li class={`event-${event.kind}`} data-kind={event.kind}>
            <span class="event-marker" aria-hidden="true"></span>
            <span><strong>{event.label}</strong>{#if event.detail}<small>{event.detail}</small>{/if}</span>
            <time datetime={event.date}>{displayDate(event.date)}</time>
          </li>
        {/each}
      </ol>
    {/snippet}
  </VisualizationFrame>
{/if}

<style>
  svg{display:block;width:100%;height:auto}
  .timeline-background{fill:var(--panel-raised)}
  .grid-line{fill:none;stroke:color-mix(in srgb,var(--border) 55%,transparent);stroke-width:1}
  .timeline-axis{stroke:var(--border-strong);stroke-width:2}
  .event-registry{--event-color:var(--visual-registration-stroke)}
  .event-certificate{--event-color:var(--visual-certificate-stroke)}
  .event-observation{--event-color:var(--visual-observation-stroke)}
  .event line{stroke:color-mix(in srgb,var(--event-color) 48%,var(--border-strong));stroke-width:1}
  .event-shape{fill:var(--panel);stroke:var(--event-color);stroke-width:3}
  .event-label,.event-date{font-family:var(--mono)}
  .event-label{fill:var(--text);font-size:11px;font-weight:750}
  .event-date{fill:var(--muted);font-size:9px}
  .timeline-list{display:grid;list-style:none}
  .timeline-list li{display:grid;grid-template-columns:8px minmax(0,1fr);gap:8px;align-items:start;padding:8px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .event-marker{width:7px;height:7px;margin-top:5px;border:2px solid var(--event-color);border-radius:50%}
  .event-certificate .event-marker{border-radius:1px;transform:rotate(45deg)}
  .event-observation .event-marker{border-radius:2px}
  .timeline-list strong,.timeline-list small{display:block}
  .timeline-list strong{font:680 var(--text-xs) var(--mono)}
  .timeline-list small{margin-top:2px;color:var(--muted);font-size:var(--text-2xs);line-height:1.4}
  .timeline-list time{grid-column:2;color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  @media(max-width:620px){
    .timeline-list{grid-template-columns:minmax(0,1fr);gap:0}
    .timeline-list li{position:relative;grid-template-columns:14px minmax(0,1fr);gap:0 10px;min-height:58px;padding:7px 0 12px;border:0;border-radius:0;background:transparent}
    .timeline-list li:not(:last-child)::after{position:absolute;z-index:0;top:17px;bottom:-7px;left:3px;width:1px;background:var(--border-strong);content:""}
    .event-marker{z-index:1;width:9px;height:9px;margin-top:3px;background:var(--panel)}
    .timeline-list time{grid-column:2;margin-top:4px}
  }
</style>
