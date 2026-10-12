<script lang="ts">
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import { caseWorkspaceHref } from '#lib/analysis/case-response-stage.ts';
  import Pagination from '#lib/components/Pagination.svelte';
  import RetainedTimelineEntities from './RetainedTimelineEntities.svelte';
  import {
    filterRetainedEvidenceTimeline,
    retainedTimelineLanes,
    RETAINED_TIMELINE_AREAS,
    RETAINED_TIMELINE_FAMILIES,
    type RetainedEvidenceTimeline,
    type RetainedTimelineArea,
    type RetainedTimelineEventType,
    type RetainedTimelineFreshness,
    type RetainedTimelineFamily,
    type RetainedTimelineTimeFilter,
  } from '#lib/analysis/retained-evidence-timeline.ts';

  const PAGE_SIZE = 50;
  let { timeline, recordNavigation = true }: { timeline: RetainedEvidenceTimeline; recordNavigation?: boolean } = $props();
  let entity = $state('');
  let caseId = $state('');
  let source = $state('');
  let area = $state<'' | RetainedTimelineArea>('');
  let freshness = $state<'all' | RetainedTimelineFreshness>('all');
  let eventType = $state<'all' | RetainedTimelineEventType>('all');
  let time = $state<RetainedTimelineTimeFilter>('all');
  let family = $state<'' | RetainedTimelineFamily>('');
  let page = $state(1);
  let journal = $state(false);
  const matching = $derived(filterRetainedEvidenceTimeline(timeline, { entity, caseId, source, area, freshness, eventType, time }));
  const lanes = $derived(retainedTimelineLanes(matching));
  const filtered = $derived(family ? matching.filter(item => item.family === family) : matching);
  const pageCount = $derived(Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  const currentPage = $derived(Math.min(page, pageCount));
  const visible = $derived(filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE));

  function resetPage(): void {
    page = 1;
  }
  function clearFilters(): void {
    entity = '';
    caseId = '';
    source = '';
    area = '';
    freshness = 'all';
    eventType = 'all';
    time = 'all';
    family = '';
    page = 1;
  }
  function formatDate(value: string | null): string {
    return formatEvidenceDate(value, 'Unknown time');
  }
  function kindLabel(value: string): string {
    return value.replaceAll('_', ' ');
  }
  function areaLabel(value: string): string {
    if (value === 'evidence_pin') return 'Pinned evidence';
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
</script>

<section class="timeline-workspace" class:journal aria-labelledby="retained-evidence-timeline-title">
  <header>
    <div>
      <p class="eyebrow">Retained evidence</p>
      <h2 id="retained-evidence-timeline-title">Investigation timeline</h2>
      <p>Review source observations and local activity, with storage times kept separate. {recordNavigation ? 'Open a record for its evidence and analyst context.' : 'These fictional records do not open saved workspace records.'}</p>
    </div>
    <div class="metrics" role="group" aria-label="Timeline summary">
      <span><strong>{timeline.counts.all}</strong> retained events</span>
      <span><strong>{timeline.counts.change}</strong> changes</span>
      <span><strong>{timeline.freshnessCounts.stale}</strong> stale</span>
    </div>
  </header>
  <label class="journal-choice"><input type="checkbox" bind:checked={journal}> Field journal reading layout</label>

  <div class="filters" role="group" aria-label="Timeline filters">
    <label>Entity<input type="search" bind:value={entity} oninput={resetPage} maxlength="253" placeholder="Filter domains"></label>
    <label>Case<select bind:value={caseId} onchange={resetPage}><option value="">All cases</option>{#each timeline.cases as option}<option value={option.id}>{option.label}</option>{/each}</select></label>
    <label>Source<input type="search" bind:value={source} oninput={resetPage} maxlength="120" placeholder="Filter sources"></label>
    <label>Area<select bind:value={area} onchange={resetPage}><option value="">All areas</option>{#each RETAINED_TIMELINE_AREAS as option}<option value={option}>{areaLabel(option)}</option>{/each}</select></label>
    <label>Freshness<select bind:value={freshness} onchange={resetPage}><option value="all">Any freshness</option><option value="current">Current</option><option value="stale">Stale</option><option value="unknown">Unknown</option></select></label>
    <label>Type<select bind:value={eventType} onchange={resetPage}><option value="all">All events</option><option value="evidence">Evidence</option><option value="change">Changes</option><option value="activity">Local activity</option></select></label>
    <label>Event time<select bind:value={time} onchange={resetPage}><option value="all">Any time</option><option value="undated">Time unavailable</option><option value="7d" disabled={!timeline.evaluatedAt}>Last 7 days</option><option value="30d" disabled={!timeline.evaluatedAt}>Last 30 days</option><option value="90d" disabled={!timeline.evaluatedAt}>Last 90 days</option></select></label>
    <button type="button" class="btn" onclick={clearFilters} disabled={!entity&&!caseId&&!source&&!area&&!family&&freshness==='all'&&eventType==='all'&&time==='all'}>Clear filters</button>
  </div>

  <details class="family-coverage">
    <summary>Evidence family coverage{family ? ` · ${RETAINED_TIMELINE_FAMILIES[family]}` : ''}</summary>
    <p>Counts cover records matching the filters above, across all pages. Empty lanes mean no matching retained records. The time between observations remains unobserved here.</p>
    <button type="button" class="btn" aria-pressed={!family} onclick={() => { family = ''; resetPage(); }}>Show all families</button>
    <ul class="family-lanes" aria-label="Evidence families">
      {#each lanes as lane (lane.family)}
        <li>
          <button type="button" class="btn" aria-pressed={family === lane.family} onclick={() => { family = lane.family; resetPage(); }}>Show {lane.label}</button>
          <p>{lane.count} retained record{lane.count === 1 ? '' : 's'} · {lane.undated} undated{lane.clock === 'Observed' ? ` · ${lane.limited} with incomplete or unknown coverage` : ''}</p>
          {#if lane.count}
            <dl>
              <div><dt>Earliest {lane.clock.toLowerCase()}</dt><dd>{#if lane.earliest}<time datetime={lane.earliest}>{formatDate(lane.earliest)}</time>{:else}Time unavailable{/if}</dd></div>
              <div><dt>Latest {lane.clock.toLowerCase()}</dt><dd>{#if lane.latest}<time datetime={lane.latest}>{formatDate(lane.latest)}</time>{:else}Time unavailable{/if}</dd></div>
            </dl>
          {/if}
        </li>
      {/each}
    </ul>
    <p>Combined observations have no separate family clocks. Categories group records, not independent corroboration. These are observations retained now, not a reconstruction of what was known at a past date; equal-time records remain separate and may disagree.</p>
  </details>

  {#if timeline.truncated}<div class="partial"><p>Partial timeline. Source omissions are listed below.</p><ul>{#each timeline.omissions as omission}<li>{omission.source}: {omission.count === Number.MAX_SAFE_INTEGER ? 'at least ' : ''}{omission.count}</li>{/each}</ul></div>{/if}
  {#if !timeline.evaluatedAt}<p class="partial" role="status">Review time unavailable. Source freshness and relative-date filters cannot be evaluated.</p>{/if}
  <p class="result-count" role="status">{filtered.length} matching event{filtered.length === 1 ? '' : 's'}{family ? ` · ${RETAINED_TIMELINE_FAMILIES[family]}` : ''}</p>

  {#if visible.length}
    <ol class="timeline-list">
      {#each visible as item (item.id)}
        <li class:change={item.eventType === 'change'} class:derived={item.derived}>
          <div class="rail" aria-hidden="true"><span></span></div>
          <article>
            <header>
              <div><span class="kind">{kindLabel(item.kind)}</span><h3>{item.title}</h3></div>
              <div class="item-states">
                {#if item.eventType === 'activity'}<span class="completeness">Local activity</span>{:else}
                <span class={`freshness-state freshness-${item.freshness}`}>{item.freshness}</span>
                <span class={`completeness state-${item.completeness}`}>{item.completeness}</span>
                {/if}
              </div>
            </header>
            <p>{item.detail}</p>
            <RetainedTimelineEntities values={item.entities} />
            <dl>
              {#if item.eventType === 'activity'}
                <div><dt>{item.kind === 'review_decision' ? 'Analyst decision' : 'Session activity'}</dt><dd>{#if item.activityAt}<time datetime={item.activityAt}>{formatDate(item.activityAt)}</time>{:else}Time unavailable{/if}</dd></div>
              {:else}
                <div><dt>Observed</dt><dd>{#if item.observedAt}<time datetime={item.observedAt}>{formatDate(item.observedAt)}</time>{:else}Observation time unavailable{/if}</dd></div>
              {/if}
              {#if item.eventType !== 'activity' || item.storedAt}<div><dt>{['case_snapshot', 'bulk_session', 'watchlist_check'].includes(item.kind) ? 'Record updated' : 'Stored'}</dt><dd>{#if item.storedAt}<time datetime={item.storedAt}>{formatDate(item.storedAt)}</time>{:else}Storage time unavailable{/if}</dd></div>{/if}
              {#if item.eventType !== 'activity'}<div><dt>Freshness</dt><dd>{item.ageDays === null ? 'Unknown age' : `${item.ageDays} day${item.ageDays === 1 ? '' : 's'} old`} · stale at {item.freshnessThresholdDays} days</dd></div>{/if}
              <div><dt>Source</dt><dd>{item.source} · {item.sourceState}</dd></div>
              <div><dt>Family</dt><dd>{RETAINED_TIMELINE_FAMILIES[item.family]}</dd></div>
              <div><dt>Area</dt><dd>{item.areas.map(areaLabel).join(' · ')}</dd></div>
              {#if item.eventType !== 'activity'}<div><dt>Interpretation</dt><dd>{item.derived ? 'Derived relationship' : item.eventType === 'change' ? 'Observed change record' : 'Retained observation'}</dd></div>{/if}
            </dl>
            {#if item.caseAssociations?.length}
              <details class="case-associations">
                <summary>Currently associated Cases ({item.caseAssociations.length})</summary>
                <ul>{#each item.caseAssociations as association}<li>{#if association.present && recordNavigation}<a href={caseWorkspaceHref(association.id)}>{association.label}</a>{:else}{association.label}{/if}</li>{/each}</ul>
              </details>
            {/if}
            <div class="item-actions">
              {#if recordNavigation}<a class="btn" href={item.href}>Open {item.owner}</a>{:else}<span>{item.owner} · fictional record</span>{/if}
              {#if item.truncated}<span class="truncated">Truncated</span>{/if}
            </div>
            <details><summary>Limitations</summary>{#each item.limitations as limitation}<p>{limitation}</p>{/each}</details>
          </article>
        </li>
      {/each}
    </ol>
    <Pagination currentPage={currentPage} {pageCount} setPage={(value)=>page=value} ariaLabel="Investigation timeline pages" pageInputLabel="Investigation timeline page number" />
  {:else}
    <section class="empty card">
      <h3>No retained events match</h3>
      <p>{timeline.items.length ? 'Clear or broaden the timeline filters.' : 'Retain Case evidence, website snapshots, watchlist history, relationships, or analyst decisions to build this timeline.'}</p>
    </section>
  {/if}

  <details class="scope"><summary>Timeline scope and interpretation</summary>{#each timeline.limitations as limitation}<p>{limitation}</p>{/each}</details>
</section>

<style>
  .journal-choice{display:flex;align-items:center;gap:8px;min-height:44px;font-size:var(--text-sm)}.journal-choice input{width:18px;height:18px;flex:none}.journal article{padding:clamp(16px,3vw,26px);border-radius:var(--radius-sm)}.journal article>p{font-size:var(--text-sm);line-height:1.75;max-width:75ch}.journal article h3{font-size:var(--text-lg)}.journal dl{grid-template-columns:repeat(2,minmax(0,1fr))}.journal dl div{border:0;padding:7px 0;border-bottom:1px solid var(--border);border-radius:0;background:transparent}@media(max-width:480px){.journal dl{grid-template-columns:1fr}}@media print{.journal-choice{display:none}}
  .timeline-workspace{display:grid;gap:14px}.timeline-workspace>header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.timeline-workspace>header h2{margin:0}.timeline-workspace>header p:not(.eyebrow){max-width:760px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .metrics{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:7px}.metrics span{padding:7px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--muted);font:650 var(--text-2xs) var(--mono);white-space:nowrap}.metrics strong{color:var(--accent)}
  .filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));align-items:end;gap:8px;padding:11px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}.filters label{display:grid;gap:4px;color:var(--muted);font:650 var(--text-2xs) var(--mono)}.filters select,.filters input{min-width:0;width:100%}.filters button{min-height:38px}
  .partial{margin:0;color:var(--amber);font:650 var(--text-xs) var(--mono)}.result-count{margin:0;color:var(--muted);font-size:var(--text-xs)}
  .timeline-list{display:grid;gap:0;margin:0;padding:0;list-style:none}.timeline-list>li{display:grid;grid-template-columns:22px minmax(0,1fr);gap:7px}.rail{display:grid;justify-items:center}.rail::after{width:1px;height:100%;background:var(--border);content:''}.rail span{width:10px;height:10px;margin-top:20px;border:2px solid var(--accent);border-radius:50%;background:var(--panel-raised);box-shadow:0 0 12px rgb(var(--accent-rgb) / .32)}li.change .rail span{border-color:var(--amber);box-shadow:0 0 12px rgb(var(--amber-rgb) / .32)}li.derived .rail span{border-radius:2px}
  article{display:grid;gap:9px;margin-bottom:11px;padding:13px 14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}article>header{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:10px}article>header>div:first-child{flex:1 1 12rem;min-width:0}article h3{margin:3px 0 0;font-size:var(--text-md)}article>p{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}.kind{color:var(--accent);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  .item-states{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:5px;max-width:100%}.completeness,.freshness-state,.truncated{padding:3px 7px;border:1px solid var(--border-strong);border-radius:999px;color:var(--text);font:650 var(--text-2xs) var(--mono);text-transform:capitalize;white-space:nowrap}.state-complete,.freshness-current{color:var(--text)}.state-partial,.state-inconclusive,.freshness-stale,.truncated{border-color:var(--amber);border-style:dashed;color:var(--amber)}.state-unknown,.freshness-unknown{border-color:var(--muted);border-style:dotted;color:var(--muted)}
  dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:0}dl div{min-width:0;padding:7px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}dt{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}dd{margin:3px 0 0;font-size:var(--text-xs);overflow-wrap:anywhere}
  .item-actions{display:flex;align-items:center;justify-content:space-between;gap:8px}.item-actions .btn{font-size:var(--text-xs)}details summary{color:var(--muted);font-size:var(--text-xs);cursor:pointer}details p{margin:7px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.45}.empty{padding:16px}.empty h3,.empty p{margin:0}.empty p{margin-top:5px;color:var(--muted);font-size:var(--text-xs)}.scope{margin-top:2px}
  .case-associations ul{display:grid;gap:7px;padding-left:22px;font-size:var(--text-xs);overflow-wrap:anywhere}article>p{overflow-wrap:anywhere}
  .family-coverage{padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}.family-coverage>summary{color:var(--text);font-weight:650}.family-coverage>.btn{margin-top:10px}.family-lanes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:14px 0 0;padding:0;list-style:none}.family-lanes>li{min-width:0;padding-top:10px;border-top:1px solid var(--border)}.family-lanes .btn{max-width:100%;white-space:normal;text-align:left;overflow-wrap:anywhere}.family-coverage .btn[aria-pressed="true"]{border-color:var(--interface-accent);background:rgb(var(--interface-accent-rgb) / .07)}.family-lanes dl{grid-template-columns:repeat(2,minmax(0,1fr));margin-top:8px}.family-coverage .btn:focus-visible,.family-coverage>summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
  @media(max-width:1100px){.filters{grid-template-columns:repeat(3,minmax(0,1fr))}.filters button{width:100%}}
  @media(max-width:760px){.timeline-workspace>header{display:grid}.metrics{justify-content:flex-start}.filters{grid-template-columns:1fr 1fr}dl{grid-template-columns:1fr 1fr}.family-lanes{grid-template-columns:1fr}}
  @media(max-width:480px){.filters,dl,.family-lanes dl{grid-template-columns:1fr}.timeline-list>li{grid-template-columns:14px minmax(0,1fr);gap:4px}.item-actions{align-items:flex-start;flex-direction:column}.item-actions .btn{width:100%}}
</style>
