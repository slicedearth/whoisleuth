<script lang="ts">
  import Pagination from './Pagination.svelte';
  import {
    ANALYST_REVIEW_DISMISSAL_REASONS,
    filterAnalystReviewItems,
    type AnalystReviewAge,
    type AnalystReviewDismissalReason,
    type AnalystReviewNextAction,
    type AnalystReviewPriority,
    type AnalystReviewInbox,
    type AnalystReviewItem,
    type AnalystReviewKind,
  } from '../analysis/analyst-review-inbox.ts';

  type Filter = 'all' | 'overdue' | AnalystReviewKind;
  const PAGE_SIZE = 25;
  const filters: Array<{ value: Filter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'case', label: 'Cases' },
    { value: 'case_action', label: 'Actions' },
    { value: 'evidence_gap', label: 'Evidence gaps' },
    { value: 'watchlist_change', label: 'Changes' },
    { value: 'bulk_session', label: 'Bulk sessions' },
  ];

  let {
    inbox,
    now = new Date().toISOString(),
    ondismiss,
  }: {
    inbox: AnalystReviewInbox;
    now?: string;
    ondismiss?: (item: AnalystReviewItem, reason: AnalystReviewDismissalReason) => void | Promise<void>;
  } = $props();
  let filter = $state<Filter>('all');
  let sourceFilter = $state('');
  let ageFilter = $state<AnalystReviewAge | ''>('');
  let caseFilter = $state('');
  let priorityFilter = $state<AnalystReviewPriority | ''>('');
  let nextActionFilter = $state<AnalystReviewNextAction | ''>('');
  let page = $state(1);
  let dismissalReasons = $state<Record<string, AnalystReviewDismissalReason | ''>>({});
  const nowMs = $derived(Date.parse(now));
  const sourceOptions = $derived([...new Set(inbox.items.flatMap((item) => item.sourceIds))].sort());
  const filteredByKind = $derived(inbox.items.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'overdue') return item.dueAt !== null && Date.parse(item.dueAt) <= nowMs;
    return item.kind === filter;
  }));
  const filtered = $derived(filterAnalystReviewItems(filteredByKind, {
    ...(sourceFilter ? { source: sourceFilter } : {}),
    ...(ageFilter ? { age: ageFilter } : {}),
    ...(caseFilter ? { caseQuery: caseFilter } : {}),
    ...(priorityFilter ? { priority: priorityFilter } : {}),
    ...(nextActionFilter ? { nextAction: nextActionFilter } : {}),
  }));
  const pageCount = $derived(Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  const currentPage = $derived(Math.min(page, pageCount));
  const visible = $derived(filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE));

  function setFilter(value: Filter) {
    filter = value;
    page = 1;
  }

  function resetDetailFilters() {
    sourceFilter = '';
    ageFilter = '';
    caseFilter = '';
    priorityFilter = '';
    nextActionFilter = '';
    page = 1;
  }

  function formatDate(value: string | null): string {
    if (!value) return '';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
  }

  async function dismiss(item: AnalystReviewItem) {
    const reason = dismissalReasons[item.id];
    if (!ondismiss || !reason || !item.dismissalTarget || !item.caseId) return;
    await ondismiss(item, reason);
    dismissalReasons = { ...dismissalReasons, [item.id]: '' };
  }
</script>

<section class="review-inbox card" aria-labelledby="review-inbox-title">
  <div class="inbox-heading">
    <div>
      <p class="eyebrow">Analyst review</p>
      <h2 id="review-inbox-title">Review inbox</h2>
      <p>One queue for retained case decisions, evidence gaps, reviewed follow-ups, watchlist changes, and incomplete Bulk sessions.</p>
    </div>
    <strong>{inbox.counts.all}</strong>
  </div>

  <div class="filters" role="group" aria-label="Review inbox filters">
    {#each filters as option}
      <button type="button" class:active={filter === option.value} onclick={() => setFilter(option.value)}>
        {option.label} <span>{inbox.counts[option.value]}</span>
      </button>
    {/each}
  </div>
  <div class="detail-filters" aria-label="Review inbox detail filters">
    <label>Source
      <select bind:value={sourceFilter} onchange={() => { page = 1; }}>
        <option value="">All sources</option>
        {#each sourceOptions as source}<option value={source}>{source.replaceAll('_', ' ')}</option>{/each}
      </select>
    </label>
    <label>Age
      <select bind:value={ageFilter} onchange={() => { page = 1; }}>
        <option value="">Any age</option>
        <option value="current">Current</option>
        <option value="aging">Aging</option>
        <option value="stale">Stale</option>
      </select>
    </label>
    <label>Case
      <input bind:value={caseFilter} oninput={() => { page = 1; }} maxlength="253" placeholder="Filter domain" />
    </label>
    <label>Severity
      <select bind:value={priorityFilter} onchange={() => { page = 1; }}>
        <option value="">Any severity</option>
        <option value="urgent">Urgent</option>
        <option value="high">High</option>
        <option value="normal">Normal</option>
      </select>
    </label>
    <label>Next action
      <select bind:value={nextActionFilter} onchange={() => { page = 1; }}>
        <option value="">Any action</option>
        <option value="review">Review</option>
        <option value="refresh">Refresh</option>
        <option value="follow_up">Follow up</option>
        <option value="resume">Resume</option>
      </select>
    </label>
    <button type="button" class="reset" onclick={resetDetailFilters}>Reset detail filters</button>
  </div>

  {#if visible.length}
    <ol class="items">
      {#each visible as item}
        <li class:urgent={item.priority === 'urgent'} class:high={item.priority === 'high'}>
          <div class="item-main">
            <div class="item-meta">
              <span>{item.kind.replaceAll('_', ' ')}</span>
              <span>{item.completeness}</span>
              <span>{item.age}</span>
              <span>{item.nextAction.replaceAll('_', ' ')}</span>
              {#if item.dueAt}<span class:overdue={Date.parse(item.dueAt) <= nowMs}>due {formatDate(item.dueAt)}</span>{/if}
            </div>
            <h3>{item.title}</h3>
            <p>{item.detail}</p>
            <small>{item.source} · observed {formatDate(item.observedAt)}</small>
            <small>{item.rankingReason}</small>
          </div>
          <div class="item-actions">
            <a class="btn" href={item.href}>Review</a>
            {#if item.retryHref}<a class="btn secondary" href={item.retryHref}>Refresh evidence</a>{/if}
            {#if ondismiss && item.dismissalTarget}
              <label>
                <span class="sr-only">Dismissal reason for {item.title}</span>
                <select
                  value={dismissalReasons[item.id] ?? ''}
                  onchange={(event) => {
                    dismissalReasons = {
                      ...dismissalReasons,
                      [item.id]: (event.currentTarget as HTMLSelectElement).value as AnalystReviewDismissalReason | '',
                    };
                  }}
                >
                  <option value="">Select review outcome</option>
                  {#each ANALYST_REVIEW_DISMISSAL_REASONS as reason}
                    <option value={reason.value}>{reason.label}</option>
                  {/each}
                </select>
              </label>
              <button type="button" class="dismiss" disabled={!dismissalReasons[item.id]} onclick={() => dismiss(item)}>Dismiss gap</button>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
    <Pagination currentPage={currentPage} {pageCount} setPage={(value) => { page = value; }} ariaLabel="Review inbox pages" />
  {:else}
    <p class="empty">No retained items match this review filter.</p>
  {/if}

  {#if inbox.truncated}<p class="warning">The queue reached its {inbox.items.length}-item display bound. Narrow the underlying saved work before relying on this view.</p>{/if}
  <ul class="limitations">{#each inbox.limitations as limitation}<li>{limitation}</li>{/each}</ul>
</section>

<style>
  .review-inbox{padding:var(--card-pad)}
  .inbox-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}
  .inbox-heading h2,.inbox-heading p{margin:0}
  .inbox-heading h2{margin-top:3px;font:700 var(--text-lg) var(--mono)}
  .inbox-heading>div>p:last-child{margin-top:7px;color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  .inbox-heading>strong{color:var(--accent2);font:750 2rem var(--mono)}
  .filters{display:flex;flex-wrap:wrap;gap:6px;margin:18px 0}
  .filters button{display:flex;gap:7px;align-items:center;min-height:36px;padding:0 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--muted);font:650 var(--text-xs) var(--mono)}
  .filters button.active{border-color:rgb(var(--accent2-rgb) / .55);background:rgb(var(--accent2-rgb) / .08);color:var(--accent2)}
  .filters span{padding:1px 6px;border-radius:99px;background:var(--border);color:var(--text);font-size:var(--text-2xs)}
  .detail-filters{display:grid;grid-template-columns:repeat(5,minmax(120px,1fr)) auto;align-items:end;gap:8px;margin:-8px 0 18px}
  .detail-filters label{display:grid;gap:5px;color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  .detail-filters select,.detail-filters input,.detail-filters .reset{min-width:0;min-height:36px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);color:var(--text);font:650 var(--text-xs) var(--mono)}
  .detail-filters select,.detail-filters input{width:100%;padding:0 9px}
  .detail-filters .reset{padding:0 11px;cursor:pointer}
  .detail-filters select:focus-visible,.detail-filters input:focus-visible,.detail-filters .reset:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .items{display:grid;gap:8px;margin:0;padding:0;list-style:none}
  .items li{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:14px;border-left:3px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .items li.high{border-left-color:var(--warning)}
  .items li.urgent{border-left-color:var(--danger)}
  .item-main{min-width:0}
  .item-meta{display:flex;flex-wrap:wrap;gap:6px;color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  .item-meta span{padding:2px 6px;border:1px solid var(--border);border-radius:99px}
  .item-meta .overdue{border-color:rgb(var(--danger-rgb) / .55);color:var(--danger)}
  h3{margin:8px 0 3px;font:700 var(--text-sm) var(--mono);overflow-wrap:anywhere}
  .items p,.items small{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  .items small{display:block;margin-top:5px;font-size:var(--text-2xs)}
  .item-actions{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;min-width:168px}
  .item-actions .btn{text-align:center}
  .item-actions select,.dismiss{width:100%;min-height:34px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);color:var(--text);font:650 var(--text-2xs) var(--mono)}
  .item-actions select{padding:0 7px}
  .dismiss{cursor:pointer}
  .dismiss:disabled{cursor:not-allowed;opacity:.5}
  .item-actions select:focus-visible,.dismiss:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .empty,.warning,.limitations{color:var(--muted);font-size:var(--text-sm)}
  .warning{color:var(--warning)}
  .limitations{margin:18px 0 0;padding-left:20px}
  @media(max-width:1000px){.detail-filters{grid-template-columns:repeat(3,minmax(0,1fr))}}
  @media(max-width:640px){.items li{display:grid}.item-actions{width:100%}.items .btn{width:100%;text-align:center}.inbox-heading>strong{font-size:1.6rem}.detail-filters{grid-template-columns:1fr 1fr}.detail-filters label:nth-child(3),.detail-filters .reset{grid-column:1 / -1}}
</style>
