<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import { buildDisclosureRouteReview } from '$lib/analysis/disclosure-route-review.ts';
  import {
    projectCaseLifecycleEvents,
    serializeCaseLifecycleCalendarEvents,
  } from '$lib/analysis/case-lifecycle-calendar.ts';

  let { records }: { records: readonly CaseRecord[] } = $props();
  let message = $state('');
  let kind = $state('all');
  let window = $state('future');
  let selectedEventIds = $state<string[]>([]);
  let includeDomain = $state(false);
  let includeRecipient = $state(false);
  let includeContext = $state(false);
  let eventPage = $state(1);
  const eventPageSize = 24;
  const routeReview = $derived(buildDisclosureRouteReview(records));
  const eventProjection = $derived(projectCaseLifecycleEvents(records, { kind, window }));
  const visibleEvents = $derived(eventProjection.events);
  const eventPageCount = $derived(Math.max(1, Math.ceil(visibleEvents.length / eventPageSize)));
  const pagedEvents = $derived(visibleEvents.slice((eventPage - 1) * eventPageSize, eventPage * eventPageSize));
  const selectedEvents = $derived(visibleEvents.filter((event) => selectedEventIds.includes(event.uid)));
  const visibleSelectedCount = $derived(visibleEvents.filter((event) => selectedEventIds.includes(event.uid)).length);

  function selectVisibleEvents() {
    selectedEventIds = [...new Set([...selectedEventIds, ...visibleEvents.map((event) => event.uid)])];
  }

  function toggleEvent(uid: string, selected: boolean) {
    selectedEventIds = selected
      ? [...new Set([...selectedEventIds, uid])]
      : selectedEventIds.filter((value) => value !== uid);
  }

  $effect(() => {
    kind;
    window;
    eventPage = 1;
  });

  $effect(() => {
    if (eventPage > eventPageCount) eventPage = eventPageCount;
  });

  function downloadCalendar() {
    if (!selectedEvents.length) return;
    const content = serializeCaseLifecycleCalendarEvents(selectedEvents, {
      includeDomain,
      includeRecipient,
      includeContext,
    });
    const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `whoisleuth-case-follow-ups-${new Date().toISOString().slice(0, 10)}.ics`;
    anchor.click();
    URL.revokeObjectURL(url);
    message = `Exported ${selectedEvents.length} selected browser-local review event${selectedEvents.length === 1 ? '' : 's'}.`;
  }
</script>

<section class="lifecycle card" aria-labelledby="lifecycle-review-title">
  <header>
    <div>
      <p class="eyebrow">Follow-up controls</p>
      <h2 id="lifecycle-review-title">Contact and lifecycle review</h2>
      <p>Review saved reporting routes and select dated actions or evidence reviews for a local calendar. The default export identifies only the stable Case reference; target and response context require separate opt-in.</p>
    </div>
    <button type="button" class="btn" onclick={downloadCalendar} disabled={!selectedEvents.length}>Export selected ({selectedEvents.length})</button>
  </header>
  {#if message}<p class="message" role="status">{message}</p>{/if}
  <fieldset class="timeline-filters">
    <legend>Lifecycle review filters</legend>
    <label class="field">Event type<select bind:value={kind}><option value="all">All review events</option><option value="action_due">Action due dates</option><option value="action_follow_up">Action follow-ups</option><option value="observed_effect_follow_up">Independent effect follow-ups</option><option value="domain_expiry_review">Domain expiry reviews</option><option value="certificate_expiry_review">Certificate reviews</option><option value="disclosure_expiry_review">Disclosure reviews</option></select></label>
    <label class="field">Time window<select bind:value={window}><option value="future">All upcoming</option><option value="30d">Next 30 days</option><option value="90d">Next 90 days</option><option value="overdue">Overdue</option><option value="all">All retained time</option></select></label>
  </fieldset>
  <div class="calendar-selection">
    <div class="selection-actions">
      <button class="btn small" type="button" onclick={selectVisibleEvents} disabled={!visibleEvents.length || visibleSelectedCount === visibleEvents.length}>Select matching ({visibleEvents.length})</button>
      <button class="btn small" type="button" onclick={() => selectedEventIds = []} disabled={!selectedEvents.length}>Clear selection</button>
      <span aria-live="polite">{selectedEvents.length} selected</span>
    </div>
    <details class="calendar-privacy">
      <summary>Calendar privacy settings</summary>
      <fieldset>
        <legend>Optional exported context</legend>
        <label><input type="checkbox" bind:checked={includeDomain}> Include investigated domain</label>
        <label><input type="checkbox" bind:checked={includeRecipient}> Include recipient or internal owner</label>
        <label><input type="checkbox" bind:checked={includeContext}> Include Case types and event details</label>
      </fieldset>
      <p>Calendar applications and synchronisation providers may copy selected event fields outside this browser. Review these options before export.</p>
    </details>
  </div>
  {#if visibleEvents.length}
    <ol class="timeline" aria-label="Browser-local lifecycle review timeline">
      {#each pagedEvents as event}
        <li>
          <label class="event-select"><input type="checkbox" checked={selectedEventIds.includes(event.uid)} onchange={(input) => toggleEvent(event.uid, input.currentTarget.checked)} aria-label={`Select ${event.summary}`}><time datetime={event.startsAt}>{new Date(event.startsAt).toLocaleDateString()}</time></label>
          <div><strong>{event.summary}</strong><p>{event.description}</p><small>{event.sourceLabel}</small><a href={`/monitor?view=cases&case=${encodeURIComponent(event.caseId)}`}>Open {event.domain}</a></div>
        </li>
      {/each}
    </ol>
    <div class="event-pages" aria-label="Lifecycle event pages"><button class="btn small" type="button" onclick={() => eventPage = Math.max(1, eventPage - 1)} disabled={eventPage === 1}>Previous</button><span>Page {eventPage} of {eventPageCount}</span><button class="btn small" type="button" onclick={() => eventPage = Math.min(eventPageCount, eventPage + 1)} disabled={eventPage === eventPageCount}>Next</button></div>
    <p class="note">Showing {(eventPage - 1) * eventPageSize + 1}–{Math.min(eventPage * eventPageSize, visibleEvents.length)} of {visibleEvents.length} retained matching browser-local review events. Export includes only the {selectedEvents.length} explicitly selected event{selectedEvents.length === 1 ? '' : 's'} in this bounded matching view.{eventProjection.omittedCount ? ` ${eventProjection.omittedCount} additional matching event${eventProjection.omittedCount === 1 ? ' was' : 's were'} omitted by the ${visibleEvents.length}-event view bound.` : ''}{eventProjection.sourceCasesOmitted ? ` ${eventProjection.sourceCasesOmitted} Case${eventProjection.sourceCasesOmitted === 1 ? ' was' : 's were'} outside the bounded source population.` : ''}</p>
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
  .route-grid span{color:var(--accent2);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}.route-grid span.due{color:var(--amber)}
  .route-grid p,.route-grid small{display:block;margin-top:5px;color:var(--muted);font-size:var(--text-2xs);line-height:1.4}.route-grid a{display:inline-block;margin-top:8px;font-size:var(--text-xs)}
  .message{color:var(--accent);font-size:var(--text-xs)}.empty,.note,.limitations{color:var(--muted);font-size:var(--text-xs)}.limitations{margin:0;padding-left:18px}.event-pages{display:flex;align-items:center;justify-content:flex-end;gap:8px}.event-pages span{color:var(--muted);font:650 var(--text-xs) var(--mono)}
  .timeline-filters{display:flex;flex-wrap:wrap;gap:10px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md)}.timeline-filters legend{padding:0 5px;color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  .calendar-selection{display:grid;gap:8px}.selection-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.selection-actions span{color:var(--muted);font:650 var(--text-xs) var(--mono)}.calendar-privacy{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.calendar-privacy>summary{padding:11px 13px;font:650 var(--text-xs) var(--mono)}.calendar-privacy fieldset{display:flex;flex-wrap:wrap;gap:8px 18px;margin:0;padding:12px 13px;border:0;border-top:1px solid var(--border)}.calendar-privacy legend{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.calendar-privacy label{display:flex;align-items:flex-start;gap:7px;color:var(--text);font-size:var(--text-xs)}.calendar-privacy input{margin-top:2px}.calendar-privacy p{margin:0;padding:0 13px 13px;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .timeline{display:grid;gap:0;padding:0;margin:0;list-style:none}.timeline li{display:grid;grid-template-columns:minmax(118px,150px) minmax(0,1fr);gap:14px;padding:11px 0;border-top:1px solid var(--border)}.timeline li:first-child{border-top:0}.event-select{display:flex;align-items:flex-start;gap:8px;cursor:pointer}.event-select input{margin-top:1px}.timeline time{color:var(--accent2);font:650 var(--text-xs) var(--mono)}.timeline strong,.timeline p,.timeline small,.timeline a{display:block;overflow-wrap:anywhere}.timeline p,.timeline small{margin-top:4px;color:var(--muted);font-size:var(--text-xs);line-height:1.45}.timeline a{margin-top:6px;font-size:var(--text-xs)}
  @media(max-width:850px){.route-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:600px){.lifecycle>header,.timeline-filters{display:grid}.lifecycle>header button,.timeline-filters select{width:100%}.route-grid{grid-template-columns:1fr}.timeline li{grid-template-columns:1fr;gap:4px}}
</style>
