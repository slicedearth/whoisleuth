<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import { buildDisclosureRouteReview } from '$lib/analysis/disclosure-route-review.ts';
  import Pagination from '$lib/components/Pagination.svelte';
  import {
    collectCaseLifecycleEvents,
    filterCaseLifecycleEvents,
    serializeCaseLifecycleCalendarEvents,
  } from '$lib/analysis/case-lifecycle-calendar.ts';

  let { records }: { records: readonly CaseRecord[] } = $props();
  let message = $state('');
  let kind = $state('all');
  let window = $state('future');
  let includeHistorical = $state(false);
  let selectedEventIds = $state<string[]>([]);
  let includeDomain = $state(false);
  let includeRecipient = $state(false);
  let includeContext = $state(false);
  let eventPage = $state(1);
  let routePage = $state(1);
  let routeState = $state('all');
  let routeQuery = $state('');
  let evaluatedAt = $state(new Date().toISOString());
  const eventPageSize = 24;
  const routePageSize = 12;
  const routeReview = $derived(buildDisclosureRouteReview(records, evaluatedAt));
  const routeSearch = $derived(routeQuery.trim().toLowerCase());
  const matchingRoutes = $derived(routeReview.routes.filter((route) =>
    (routeState === 'all' || route.review === routeState)
      && (!routeSearch || [route.domain, route.recipient, route.source].some((value) => value.toLowerCase().includes(routeSearch)))));
  const routePageCount = $derived(Math.max(1, Math.ceil(matchingRoutes.length / routePageSize)));
  const pagedRoutes = $derived(matchingRoutes.slice((routePage - 1) * routePageSize, routePage * routePageSize));
  const eventProjection = $derived(collectCaseLifecycleEvents(records, includeHistorical, evaluatedAt));
  const visibleEvents = $derived(filterCaseLifecycleEvents(eventProjection.events, { kind, window }, evaluatedAt));
  const eventPageCount = $derived(Math.max(1, Math.ceil(visibleEvents.length / eventPageSize)));
  const pagedEvents = $derived(visibleEvents.slice((eventPage - 1) * eventPageSize, eventPage * eventPageSize));
  const selectedEventSet = $derived(new Set(selectedEventIds));
  const selectedEvents = $derived(visibleEvents.filter((event) => selectedEventSet.has(event.uid)));
  const visibleSelectedCount = $derived(selectedEvents.length);

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
    includeHistorical;
    eventPage = 1;
  });

  $effect(() => {
    if (eventPage > eventPageCount) eventPage = eventPageCount;
  });

  $effect(() => {
    records;
    evaluatedAt = new Date().toISOString();
  });

  $effect(() => {
    routeState;
    routeQuery;
    routePage = 1;
  });

  $effect(() => {
    if (routePage > routePageCount) routePage = routePageCount;
  });

  function refreshReview() {
    evaluatedAt = new Date().toISOString();
    message = 'Re-evaluated saved dates and routes. No collection was performed.';
  }

  function downloadCalendar() {
    if (!selectedEvents.length) return;
    try {
      const generatedAt = new Date().toISOString();
      const content = serializeCaseLifecycleCalendarEvents(selectedEvents, {
        includeDomain,
        includeRecipient,
        includeContext,
      }, generatedAt);
      const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `whoisleuth-case-follow-ups-${generatedAt.slice(0, 10)}.ics`;
        anchor.click();
      } finally {
        URL.revokeObjectURL(url);
      }
      message = `Exported ${selectedEvents.length} selected browser-local review event${selectedEvents.length === 1 ? '' : 's'}.`;
    } catch (error) {
      message = `Calendar was not exported. ${error instanceof Error ? error.message : 'Review the selected events and try again.'}`;
    }
  }
</script>

<section class="lifecycle card" aria-labelledby="lifecycle-review-title">
  <header>
    <div>
      <p class="eyebrow">Follow-up controls</p>
      <h2 id="lifecycle-review-title">Contact and lifecycle review</h2>
      <p>Review saved reporting routes and select dated actions or evidence reviews for a local calendar. The default export identifies only the stable Case reference; target and response context require separate opt-in.</p>
    </div>
    <div class="selection-actions"><button type="button" class="btn" onclick={refreshReview}>Refresh local review</button><button type="button" class="btn" onclick={downloadCalendar} disabled={!selectedEvents.length}>Export selected ({selectedEvents.length})</button></div>
  </header>
  <p class="note">Evaluated at <time datetime={evaluatedAt}>{evaluatedAt}</time>. Refresh to re-evaluate saved dates against the current time.</p>
  {#if message}<p class="message" role="status">{message}</p>{/if}
  <fieldset class="timeline-filters">
    <legend>Lifecycle review filters</legend>
    <label class="field">Event type<select bind:value={kind}><option value="all">All review events</option><option value="action_due">Action due dates</option><option value="action_follow_up">Action follow-ups</option><option value="observed_effect_follow_up">Independent effect follow-ups</option><option value="domain_expiry_review">Domain expiry reviews</option><option value="certificate_expiry_review">Certificate reviews</option><option value="disclosure_expiry_review">Disclosure reviews</option></select></label>
    <label class="field">Time window<select bind:value={window}><option value="future">All upcoming</option><option value="30d">Next 30 days</option><option value="90d">Next 90 days</option><option value="overdue">Overdue</option><option value="all">All retained time</option></select></label>
  </fieldset>
  <label><input type="checkbox" bind:checked={includeHistorical}> Include completed actions and earlier effect reviews</label>
  {#if !eventProjection.evaluatedAt}<p class="note">The review clock is unavailable. Time-window classification is unavailable; explicitly dated events remain in All retained time.</p>{/if}
  {#if eventProjection.sourceCasesOmitted || eventProjection.sourceActionsOmitted || eventProjection.sourceReviewsOmitted || eventProjection.sourceSnapshotsOmitted || eventProjection.sourcePinsOmitted}
    <p class="note">Outside the calendar source bounds: {eventProjection.sourceCasesOmitted} Cases; within admitted Cases, {eventProjection.sourceActionsOmitted} actions, {eventProjection.sourceReviewsOmitted} effect reviews, {eventProjection.sourceSnapshotsOmitted} snapshots and {eventProjection.sourcePinsOmitted} evidence pins. Their dates were not evaluated.</p>
  {/if}
  {#if eventProjection.dateLimitations.length}
    <details><summary>Dates needing review ({eventProjection.dateLimitations.length})</summary><ul>{#each eventProjection.dateLimitations as item}<li><a href={`/cases?case=${encodeURIComponent(item.caseId)}`}>{item.domain}</a>: {item.detail}</li>{/each}</ul></details>
  {/if}
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
      {#each pagedEvents as event, index (event.uid)}
        <li>
          <label class="event-select"><input type="checkbox" checked={selectedEventSet.has(event.uid)} onchange={(input) => toggleEvent(event.uid, input.currentTarget.checked)} aria-label={`Select event ${(eventPage - 1) * eventPageSize + index + 1}: ${event.summary}${event.recipient ? ` · ${event.recipient}` : ''} · ${event.startsAt}`}><time datetime={event.startsAt}>{new Date(event.startsAt).toLocaleString()}</time></label>
          <div><strong>{event.summary}</strong>{#if event.recipient}<small>Recipient or owner: {event.recipient}</small>{/if}<p>{event.description}</p><small>{event.sourceLabel}</small><a href={`/monitor?view=cases&case=${encodeURIComponent(event.caseId)}`}>Open {event.domain}</a></div>
        </li>
      {/each}
    </ol>
    <Pagination currentPage={eventPage} pageCount={eventPageCount} setPage={(page) => eventPage = page} ariaLabel="Lifecycle event pages" />
    <p class="note">Showing {(eventPage - 1) * eventPageSize + 1}–{Math.min(eventPage * eventPageSize, visibleEvents.length)} of {visibleEvents.length} matching browser-local review events. Times use your browser’s time zone. Export includes all {selectedEvents.length} explicitly selected event{selectedEvents.length === 1 ? '' : 's'} in this matching view.</p>
  {:else}
    <p class="empty">No lifecycle review events match these filters.</p>
  {/if}
  <section class="saved-routes" aria-labelledby="saved-routes-title">
    <h3 id="saved-routes-title">Saved reporting routes</h3>
    <fieldset class="timeline-filters">
      <legend>Reporting route filters</legend>
      <label class="field">Source review<select bind:value={routeState}><option value="all">All saved routes</option><option value="due">Due</option><option value="unconfirmed">Unconfirmed</option><option value="current">Current</option></select></label>
      <label class="field route-search">Find a route<input type="search" bind:value={routeQuery} maxlength="200" placeholder="Domain, recipient or source"></label>
    </fieldset>
    <p class="note" role="status">{matchingRoutes.length} matching of {routeReview.routes.length} saved reporting routes.</p>
  {#if matchingRoutes.length}
    <div class="route-grid">
      {#each pagedRoutes as route (route.id)}
        <article>
          <div><strong>{route.domain}</strong><span class:due={route.review === 'due'}>{route.review}</span></div>
          <p>{route.actionType.replaceAll('_', ' ')} · {route.state.replaceAll('_', ' ')}</p>
          <small>{route.recipient}</small>
          <small>Source: {route.source}</small>
          <small>Source observed: {#if route.observedAt}<time datetime={route.observedAt}>{route.observedAt}</time>{:else}Unknown{/if}</small>
          {#if route.nextReviewAt}<small>Source review due: <time datetime={route.nextReviewAt}>{route.nextReviewAt}</time></small>{/if}
          {#if route.followUpAt}<small>Action follow-up: <time datetime={route.followUpAt}>{route.followUpAt}</time></small>{/if}
          <details><summary>Saved action details</summary><small>Action updated: {#if route.updatedAt}<time datetime={route.updatedAt}>{route.updatedAt}</time>{:else}Unknown{/if}</small>{#if route.limitations.length}<ul>{#each route.limitations as limitation}<li>{limitation}</li>{/each}</ul>{/if}</details>
          <a href={`/monitor?view=cases&case=${encodeURIComponent(route.caseId)}`}>Open case</a>
        </article>
      {/each}
    </div>
    <Pagination currentPage={routePage} pageCount={routePageCount} setPage={(page) => routePage = page} ariaLabel="Reporting route pages" />
    <p class="note">Showing {(routePage - 1) * routePageSize + 1}–{Math.min(routePage * routePageSize, matchingRoutes.length)} of {matchingRoutes.length} matching routes.</p>
  {:else}
    <p class="empty">{routeReview.routes.length ? 'No saved reporting routes match these filters.' : 'No reporting routes are saved in current Cases.'}</p>
  {/if}
    {#if routeReview.truncated}<p class="note">Outside the source bounds: {routeReview.sourceCasesOmitted} Cases and {routeReview.sourceActionsOmitted} actions within admitted Cases. Their reporting routes were not evaluated.</p>{/if}
  </section>
  <ul class="limitations">{#each routeReview.limitations as limitation}<li>{limitation}</li>{/each}</ul>
</section>

<style>
  .lifecycle{display:grid;gap:14px;margin-top:14px;padding:var(--card-pad)}
  .lifecycle>header{display:flex;flex-wrap:wrap;align-items:start;justify-content:space-between;gap:14px}
  h2,p{margin:0}.lifecycle>header h2{margin-top:3px;font:700 var(--text-lg) var(--mono)}.lifecycle>header p:last-child{margin-top:7px;color:var(--muted);font-size:var(--text-sm)}
  .saved-routes{display:grid;min-width:0;gap:10px}.saved-routes h3{margin:0;font:650 var(--text-sm) var(--mono)}
  .route-search{flex:1;min-width:0}.route-search input{width:100%}
  .route-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));align-items:start;gap:8px}
  .route-grid article{min-width:0;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .route-grid article>div{display:flex;justify-content:space-between;gap:8px}.route-grid strong,.route-grid small{overflow-wrap:anywhere}
  .route-grid span{color:var(--accent2);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}.route-grid span.due{color:var(--amber)}
  .route-grid p,.route-grid small{display:block;margin-top:5px;color:var(--muted);font-size:var(--text-2xs);line-height:1.4}.route-grid a{display:inline-block;margin-top:8px;font-size:var(--text-xs)}
  .route-grid details{margin-top:8px;overflow-wrap:anywhere;font-size:var(--text-2xs)}.route-grid summary{font-weight:600}.route-grid ul{padding-left:18px;color:var(--muted)}
  .message{color:var(--accent);font-size:var(--text-xs)}.empty,.note,.limitations{color:var(--muted);font-size:var(--text-xs);overflow-wrap:anywhere}.limitations{margin:0;padding-left:18px}
  .timeline-filters{display:flex;flex-wrap:wrap;gap:10px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md)}.timeline-filters legend{padding:0 5px;color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  .calendar-selection{display:grid;gap:8px}.selection-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.selection-actions span{color:var(--muted);font:650 var(--text-xs) var(--mono)}.calendar-privacy{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.calendar-privacy>summary{padding:11px 13px;font:650 var(--text-xs) var(--mono)}.calendar-privacy fieldset{display:flex;flex-wrap:wrap;gap:8px 18px;margin:0;padding:12px 13px;border:0;border-top:1px solid var(--border)}.calendar-privacy legend{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.calendar-privacy label{display:flex;align-items:flex-start;gap:7px;color:var(--text);font-size:var(--text-xs)}.calendar-privacy input{margin-top:2px}.calendar-privacy p{margin:0;padding:0 13px 13px;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .timeline{display:grid;gap:0;padding:0;margin:0;list-style:none}.timeline li{display:grid;grid-template-columns:minmax(118px,150px) minmax(0,1fr);gap:14px;padding:11px 0;border-top:1px solid var(--border)}.timeline li:first-child{border-top:0}.event-select{display:flex;align-items:flex-start;gap:8px;cursor:pointer}.event-select input{margin-top:1px}.timeline time{color:var(--accent2);font:650 var(--text-xs) var(--mono)}.timeline strong,.timeline p,.timeline small,.timeline a{display:block;overflow-wrap:anywhere}.timeline p,.timeline small{margin-top:4px;color:var(--muted);font-size:var(--text-xs);line-height:1.45}.timeline a{margin-top:6px;font-size:var(--text-xs)}
  @media(max-width:600px){.lifecycle>header,.timeline-filters{display:grid}.lifecycle>header button,.timeline-filters select{width:100%}.timeline li{grid-template-columns:1fr;gap:4px}}
</style>
