<script lang="ts">
  import Pagination from '$lib/components/Pagination.svelte';
  import {
    filterRetainedEvidenceTimeline,
    RETAINED_TIMELINE_AREAS,
    type RetainedEvidenceTimeline,
    type RetainedTimelineArea,
    type RetainedTimelineEventType,
    type RetainedTimelineFreshness,
    type RetainedTimelineTimeFilter,
  } from '$lib/analysis/retained-evidence-timeline.ts';

  const PAGE_SIZE = 50;
  let { timeline }: { timeline: RetainedEvidenceTimeline } = $props();
  let entity = $state('');
  let caseId = $state('');
  let source = $state('');
  let area = $state<'' | RetainedTimelineArea>('');
  let freshness = $state<'all' | RetainedTimelineFreshness>('all');
  let eventType = $state<'all' | RetainedTimelineEventType>('all');
  let time = $state<RetainedTimelineTimeFilter>('all');
  let page = $state(1);
  const filtered = $derived(filterRetainedEvidenceTimeline(timeline, { entity, caseId, source, area, freshness, eventType, time }));
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
    page = 1;
  }
  function formatDate(value: string): string {
    return new Date(value).toLocaleString();
  }
  function kindLabel(value: string): string {
    return value.replaceAll('_', ' ');
  }
  function areaLabel(value: string): string {
    if (value === 'evidence_pin') return 'Pinned evidence';
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
</script>

<section class="timeline-workspace" aria-labelledby="retained-evidence-timeline-title">
  <header>
    <div>
      <p class="eyebrow">Retained evidence</p>
      <h2 id="retained-evidence-timeline-title">Investigation timeline</h2>
      <p>Review when retained evidence was observed and when this browser stored it. Open an owner to inspect exact values, limitations, and analyst context.</p>
    </div>
    <div class="metrics" role="group" aria-label="Timeline summary">
      <span><strong>{timeline.counts.all}</strong> retained events</span>
      <span><strong>{timeline.counts.change}</strong> changes</span>
      <span><strong>{timeline.freshnessCounts.stale}</strong> stale</span>
    </div>
  </header>

  <div class="filters" role="group" aria-label="Timeline filters">
    <label>Entity<select bind:value={entity} onchange={resetPage}><option value="">All entities</option>{#each timeline.entities as option}<option value={option}>{option}</option>{/each}</select></label>
    <label>Case<select bind:value={caseId} onchange={resetPage}><option value="">All cases</option>{#each timeline.cases as option}<option value={option.id}>{option.label}</option>{/each}</select></label>
    <label>Source<select bind:value={source} onchange={resetPage}><option value="">All sources</option>{#each timeline.sources as option}<option value={option}>{option}</option>{/each}</select></label>
    <label>Area<select bind:value={area} onchange={resetPage}><option value="">All areas</option>{#each RETAINED_TIMELINE_AREAS as option}<option value={option}>{areaLabel(option)}</option>{/each}</select></label>
    <label>Freshness<select bind:value={freshness} onchange={resetPage}><option value="all">Any freshness</option><option value="current">Current</option><option value="stale">Stale</option><option value="unknown">Unknown</option></select></label>
    <label>Type<select bind:value={eventType} onchange={resetPage}><option value="all">Evidence and changes</option><option value="evidence">Evidence</option><option value="change">Changes</option></select></label>
    <label>Observed<select bind:value={time} onchange={resetPage}><option value="all">Any time</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option></select></label>
    <button type="button" class="btn" onclick={clearFilters} disabled={!entity&&!caseId&&!source&&!area&&freshness==='all'&&eventType==='all'&&time==='all'}>Clear filters</button>
  </div>

  {#if timeline.truncated}<p class="partial">Partial timeline. One or more retained-record or projection bounds were reached.</p>{/if}
  <p class="result-count">{filtered.length} matching event{filtered.length === 1 ? '' : 's'}</p>

  {#if visible.length}
    <ol class="timeline-list">
      {#each visible as item (item.id)}
        <li class:change={item.eventType === 'change'} class:derived={item.derived}>
          <div class="rail" aria-hidden="true"><span></span></div>
          <article>
            <header>
              <div><span class="kind">{kindLabel(item.kind)}</span><h3>{item.title}</h3></div>
              <div class="item-states">
                <span class={`freshness-state freshness-${item.freshness}`}>{item.freshness}</span>
                <span class={`completeness state-${item.completeness}`}>{item.completeness}</span>
              </div>
            </header>
            <p>{item.detail}</p>
            {#if item.entities.length}<div class="entities">{#each item.entities as value}<code>{value}</code>{/each}</div>{/if}
            <dl>
              <div><dt>Observed</dt><dd><time datetime={item.observedAt}>{formatDate(item.observedAt)}</time></dd></div>
              <div><dt>Stored</dt><dd><time datetime={item.storedAt}>{formatDate(item.storedAt)}</time></dd></div>
              <div><dt>Freshness</dt><dd>{item.ageDays === null ? 'Unknown age' : `${item.ageDays} day${item.ageDays === 1 ? '' : 's'} old`} · stale at {item.freshnessThresholdDays} days</dd></div>
              <div><dt>Source</dt><dd>{item.source} · {item.sourceState}</dd></div>
              <div><dt>Area</dt><dd>{item.areas.map(areaLabel).join(' · ')}</dd></div>
              <div><dt>Interpretation</dt><dd>{item.derived ? 'Derived relationship' : item.eventType === 'change' ? 'Observed change record' : 'Retained observation'}</dd></div>
            </dl>
            <div class="item-actions">
              <a class="btn" href={item.href}>Open {item.owner}</a>
              {#if item.truncated}<span class="truncated">Truncated</span>{/if}
            </div>
            <details><summary>Limitations</summary>{#each item.limitations as limitation}<p>{limitation}</p>{/each}</details>
          </article>
        </li>
      {/each}
    </ol>
    <Pagination currentPage={currentPage} {pageCount} setPage={(value)=>page=value} ariaLabel="Investigation timeline pages" />
  {:else}
    <section class="empty card">
      <h3>No retained events match</h3>
      <p>{timeline.items.length ? 'Clear or broaden the timeline filters.' : 'Retain case evidence, website snapshots, watchlist history, or reviewed relationships to build this timeline.'}</p>
    </section>
  {/if}

  <details class="scope"><summary>Timeline scope and interpretation</summary>{#each timeline.limitations as limitation}<p>{limitation}</p>{/each}</details>
</section>

<style>
  .timeline-workspace{display:grid;gap:14px}.timeline-workspace>header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.timeline-workspace>header h2{margin:0}.timeline-workspace>header p:not(.eyebrow){max-width:760px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .metrics{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:7px}.metrics span{padding:7px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--muted);font:650 var(--text-2xs) var(--mono);white-space:nowrap}.metrics strong{color:var(--accent)}
  .filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));align-items:end;gap:8px;padding:11px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}.filters label{display:grid;gap:4px;color:var(--muted);font:650 var(--text-2xs) var(--mono)}.filters select{min-width:0;width:100%}.filters button{min-height:38px}
  .partial{margin:0;color:var(--amber);font:650 var(--text-xs) var(--mono)}.result-count{margin:0;color:var(--muted);font-size:var(--text-xs)}
  .timeline-list{display:grid;gap:0;margin:0;padding:0;list-style:none}.timeline-list>li{display:grid;grid-template-columns:22px minmax(0,1fr);gap:7px}.rail{display:grid;justify-items:center}.rail::after{width:1px;height:100%;background:var(--border);content:''}.rail span{width:10px;height:10px;margin-top:20px;border:2px solid var(--accent);border-radius:50%;background:var(--panel-raised);box-shadow:0 0 12px rgb(var(--accent-rgb) / .32)}li.change .rail span{border-color:var(--amber);box-shadow:0 0 12px rgb(var(--amber-rgb) / .32)}li.derived .rail span{border-radius:2px}
  article{display:grid;gap:9px;margin-bottom:11px;padding:13px 14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}article>header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}article h3{margin:3px 0 0;font-size:var(--text-md)}article>p{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}.kind{color:var(--accent);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  .item-states{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:5px}.completeness,.freshness-state,.truncated{padding:3px 7px;border:1px solid var(--border);border-radius:999px;font:650 var(--text-2xs) var(--mono);text-transform:capitalize}.state-complete{color:var(--accent2)}.state-partial,.truncated{color:var(--amber)}.state-inconclusive{color:var(--danger)}.state-unknown{color:var(--muted)}.freshness-current{color:var(--accent)}.freshness-stale{color:var(--amber)}.freshness-unknown{color:var(--muted)}
  .entities{display:flex;flex-wrap:wrap;gap:5px}.entities code{max-width:100%;padding:3px 6px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);overflow-wrap:anywhere}
  dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:0}dl div{min-width:0;padding:7px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}dt{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}dd{margin:3px 0 0;font-size:var(--text-xs);overflow-wrap:anywhere}
  .item-actions{display:flex;align-items:center;justify-content:space-between;gap:8px}.item-actions .btn{font-size:var(--text-xs)}details summary{color:var(--muted);font-size:var(--text-xs);cursor:pointer}details p{margin:7px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.45}.empty{padding:16px}.empty h3,.empty p{margin:0}.empty p{margin-top:5px;color:var(--muted);font-size:var(--text-xs)}.scope{margin-top:2px}
  @media(max-width:1100px){.filters{grid-template-columns:repeat(3,minmax(0,1fr))}.filters button{width:100%}}
  @media(max-width:760px){.timeline-workspace>header{display:grid}.metrics{justify-content:flex-start}.filters{grid-template-columns:1fr 1fr}dl{grid-template-columns:1fr 1fr}}
  @media(max-width:480px){.filters,dl{grid-template-columns:1fr}.timeline-list>li{grid-template-columns:14px minmax(0,1fr);gap:4px}.item-actions{align-items:flex-start;flex-direction:column}.item-actions .btn{width:100%}}
</style>
