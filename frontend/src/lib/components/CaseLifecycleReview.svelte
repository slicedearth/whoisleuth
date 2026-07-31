<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import { buildDisclosureRouteReview } from '$lib/analysis/disclosure-route-review.ts';
  import {
    buildCaseLifecycleEvents,
    filterCaseLifecycleEvents,
    serializeCaseLifecycleCalendar,
  } from '$lib/analysis/case-lifecycle-calendar.ts';

  let { records }: { records: readonly CaseRecord[] } = $props();
  let message = $state('');
  let kind = $state('all');
  let window = $state('future');
  const routeReview = $derived(buildDisclosureRouteReview(records));
  const events = $derived(buildCaseLifecycleEvents(records));
  const visibleEvents = $derived(filterCaseLifecycleEvents(events, { kind, window }));

  function downloadCalendar() {
    if (!events.length) return;
    const content = serializeCaseLifecycleCalendar(records);
    const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `whoisleuth-case-reviews-${new Date().toISOString().slice(0, 10)}.ics`;
    anchor.click();
    URL.revokeObjectURL(url);
    message = `Exported ${events.length} browser-local review event${events.length === 1 ? '' : 's'}.`;
  }
</script>

<section class="lifecycle card" aria-labelledby="lifecycle-review-title">
  <header>
    <div>
      <p class="eyebrow">Follow-up controls</p>
      <h2 id="lifecycle-review-title">Contact and lifecycle review</h2>
      <p>Review saved reporting routes and export dated actions, domain expiry, or explicitly pinned certificate and disclosure expiry evidence as a local calendar.</p>
    </div>
    <button type="button" class="btn" onclick={downloadCalendar} disabled={!events.length}>Export review calendar ({events.length})</button>
  </header>
  {#if message}<p class="message" role="status">{message}</p>{/if}
  <fieldset class="timeline-filters">
    <legend>Lifecycle review filters</legend>
    <label class="field">Event type<select bind:value={kind}><option value="all">All review events</option><option value="action_due">Action due dates</option><option value="action_follow_up">Action follow-ups</option><option value="domain_expiry_review">Domain expiry reviews</option><option value="certificate_expiry_review">Certificate reviews</option><option value="disclosure_expiry_review">Disclosure reviews</option></select></label>
    <label class="field">Time window<select bind:value={window}><option value="future">All upcoming</option><option value="30d">Next 30 days</option><option value="90d">Next 90 days</option><option value="overdue">Overdue</option><option value="all">All retained time</option></select></label>
  </fieldset>
  {#if visibleEvents.length}
    <ol class="timeline" aria-label="Browser-local lifecycle review timeline">
      {#each visibleEvents.slice(0, 24) as event}
        <li>
          <time datetime={event.startsAt}>{new Date(event.startsAt).toLocaleDateString()}</time>
          <div><strong>{event.summary}</strong><p>{event.description}</p><small>{event.sourceLabel}</small><a href={`/monitor?view=cases&case=${encodeURIComponent(event.caseId)}`}>Open {event.domain}</a></div>
        </li>
      {/each}
    </ol>
    {#if visibleEvents.length > 24}<p class="note">Showing the next 24 of {visibleEvents.length} matching browser-local review events. Export includes all {events.length} retained events.</p>{/if}
  {:else}
    <p class="empty">No lifecycle review events match these filters.</p>
  {/if}
  {#if routeReview.routes.length}
    <div class="route-grid">
      {#each routeReview.routes.slice(0, 12) as route}
        <article>
          <div><strong>{route.domain}</strong><span class:due={route.review === 'due'}>{route.review}</span></div>
          <p>{route.actionType.replaceAll('_', ' ')} · {route.state.replaceAll('_', ' ')}</p>
          <small>{route.recipient}</small>
          <small>{route.source}</small>
          <a href={`/monitor?view=cases&case=${encodeURIComponent(route.caseId)}`}>Open case</a>
        </article>
      {/each}
    </div>
    {#if routeReview.routes.length > 12}<p class="note">Showing 12 of {routeReview.routes.length} recorded contact routes.</p>{/if}
  {:else}
    <p class="empty">No reviewed reporting routes are saved in current cases.</p>
  {/if}
  <ul class="limitations">{#each routeReview.limitations as limitation}<li>{limitation}</li>{/each}</ul>
</section>

<style>
  .lifecycle{display:grid;gap:14px;margin-top:14px;padding:var(--card-pad)}
  .lifecycle>header{display:flex;flex-wrap:wrap;align-items:start;justify-content:space-between;gap:14px}
  h2,p{margin:0}.lifecycle>header h2{margin-top:3px;font:700 var(--text-lg) var(--mono)}.lifecycle>header p:last-child{margin-top:7px;color:var(--muted);font-size:var(--text-sm)}
  .route-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .route-grid article{min-width:0;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .route-grid article>div{display:flex;justify-content:space-between;gap:8px}.route-grid strong,.route-grid small{overflow-wrap:anywhere}
  .route-grid span{color:var(--accent2);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}.route-grid span.due{color:var(--warning)}
  .route-grid p,.route-grid small{display:block;margin-top:5px;color:var(--muted);font-size:var(--text-2xs);line-height:1.4}.route-grid a{display:inline-block;margin-top:8px;font-size:var(--text-xs)}
  .message{color:var(--accent);font-size:var(--text-xs)}.empty,.note,.limitations{color:var(--muted);font-size:var(--text-xs)}.limitations{margin:0;padding-left:18px}
  .timeline-filters{display:flex;flex-wrap:wrap;gap:10px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md)}.timeline-filters legend{padding:0 5px;color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  .timeline{display:grid;gap:0;padding:0;margin:0;list-style:none}.timeline li{display:grid;grid-template-columns:minmax(96px,130px) minmax(0,1fr);gap:14px;padding:11px 0;border-top:1px solid var(--border)}.timeline li:first-child{border-top:0}.timeline time{color:var(--accent2);font:650 var(--text-xs) var(--mono)}.timeline strong,.timeline p,.timeline small,.timeline a{display:block;overflow-wrap:anywhere}.timeline p,.timeline small{margin-top:4px;color:var(--muted);font-size:var(--text-xs);line-height:1.45}.timeline a{margin-top:6px;font-size:var(--text-xs)}
  @media(max-width:850px){.route-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:600px){.lifecycle>header,.timeline-filters{display:grid}.lifecycle>header button,.timeline-filters select{width:100%}.route-grid{grid-template-columns:1fr}.timeline li{grid-template-columns:1fr;gap:4px}}
</style>
