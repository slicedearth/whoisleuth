<script lang="ts">
  import Pagination from './Pagination.svelte';
  import ReviewLifecycleControls from './ReviewLifecycleControls.svelte';
  import {
    ANALYST_REVIEW_EVIDENCE_FAMILIES,
    ANALYST_REVIEW_KINDS,
    ANALYST_REVIEW_QUEUE_OPTIONS,
    ANALYST_REVIEW_DISMISSAL_REASONS,
    analystReviewQueue,
    filterAnalystReviewItems,
    type AnalystReviewAge,
    type AnalystReviewDismissalReason,
    type AnalystReviewNextAction,
    type AnalystReviewPriority,
    type AnalystReviewInbox,
    type AnalystReviewInboxItem,
    type AnalystReviewItem,
    type AnalystReviewKind,
    type AnalystReviewQueue,
    type AnalystReviewEvidenceFamily,
    type AnalystReviewLifecycleState,
  } from '../analysis/analyst-review-inbox.ts';
  import type { AnalystReviewDisposition } from '../analysis/analyst-review-state.ts';

  const PAGE_SIZE = 25;

  let {
    inbox,
    now = new Date().toISOString(),
    ondismiss,
    onreview,
  }: {
    inbox: AnalystReviewInbox;
    now?: string;
    ondismiss?: (item: AnalystReviewItem, reason: AnalystReviewDismissalReason) => void | Promise<void>;
    onreview?: (item: AnalystReviewItem, input: { disposition: AnalystReviewDisposition; rationale: string; expiresAt: string | null; reviewDueAt: string | null }) => void | Promise<void>;
  } = $props();
  let queue = $state<AnalystReviewQueue>('needs_action');
  let kindFilter = $state<AnalystReviewKind | ''>('');
  let sourceFilter = $state('');
  let ageFilter = $state<AnalystReviewAge | ''>('');
  let caseFilter = $state('');
  let priorityFilter = $state<AnalystReviewPriority | ''>('');
  let nextActionFilter = $state<AnalystReviewNextAction | ''>('');
  let evidenceFamilyFilter = $state<AnalystReviewEvidenceFamily | ''>('');
  let lifecycleFilter = $state<AnalystReviewLifecycleState | ''>('');
  let page = $state(1);
  let dismissalReasons = $state<Record<string, AnalystReviewDismissalReason | ''>>({});
  const nowMs = $derived(Date.parse(now));
  const sourceOptions = $derived([...new Set(inbox.items.flatMap((item) => item.sourceIds))].sort());
  const evidenceFamilyOptions = $derived([...new Set(inbox.items.map((item) => item.evidenceFamily))].sort());
  const queueCounts = $derived(Object.fromEntries(ANALYST_REVIEW_QUEUE_OPTIONS.map((option) => [
    option.value,
    option.value === 'all' ? inbox.items.length : inbox.items.filter((item) => analystReviewQueue(item, now) === option.value).length,
  ])) as Record<AnalystReviewQueue, number>);
  const filteredByQueue = $derived(inbox.items.filter((item) => {
    if (queue !== 'all' && analystReviewQueue(item, now) !== queue) return false;
    return !kindFilter || item.kind === kindFilter;
  }));
  const filtered = $derived(filterAnalystReviewItems(filteredByQueue, {
    ...(sourceFilter ? { source: sourceFilter } : {}),
    ...(ageFilter ? { age: ageFilter } : {}),
    ...(caseFilter ? { caseQuery: caseFilter } : {}),
    ...(priorityFilter ? { priority: priorityFilter } : {}),
    ...(nextActionFilter ? { nextAction: nextActionFilter } : {}),
    ...(evidenceFamilyFilter ? { evidenceFamily: evidenceFamilyFilter } : {}),
    ...(lifecycleFilter ? { lifecycle: lifecycleFilter } : {}),
  }));
  const pageCount = $derived(Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  const currentPage = $derived(Math.min(page, pageCount));
  const visible = $derived(filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE));
  const admissionRows = $derived(ANALYST_REVIEW_EVIDENCE_FAMILIES
    .map((family) => ({ family, ...inbox.admission.byEvidenceFamily[family] }))
    .filter((row) => row.totalAtLeast > 0));

  function setQueue(value: AnalystReviewQueue) {
    queue = value;
    page = 1;
  }

  function resetDetailFilters() {
    kindFilter = '';
    sourceFilter = '';
    ageFilter = '';
    caseFilter = '';
    priorityFilter = '';
    nextActionFilter = '';
    evidenceFamilyFilter = '';
    lifecycleFilter = '';
    page = 1;
  }

  function formatDate(value: string | null): string {
    if (!value) return '';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
  }

  function omissionText(row: { omittedAtLeast: number; totalIsExact: boolean }): string {
    if (row.totalIsExact) return `${row.omittedAtLeast} omitted`;
    return row.omittedAtLeast > 0 ? `at least ${row.omittedAtLeast} omitted` : 'additional items may be omitted';
  }

  async function dismiss(item: AnalystReviewItem) {
    const reason = dismissalReasons[item.id];
    if (!ondismiss || !reason || !item.dismissalTarget || !item.caseId) return;
    await ondismiss(item, reason);
    dismissalReasons = { ...dismissalReasons, [item.id]: '' };
  }

  function lifecycleFor(item: AnalystReviewInboxItem) {
    return item.lifecycle;
  }
</script>

<section class="review-inbox card" aria-labelledby="review-inbox-title">
  <div class="inbox-heading">
    <div>
      <p class="eyebrow">Analyst review</p>
      <h2 id="review-inbox-title">Review inbox</h2>
      <p>One queue for retained case decisions, evidence gaps, reviewed follow-ups, watchlist changes, and incomplete Bulk sessions.</p>
    </div>
    <strong>{inbox.admission.displayed}</strong>
  </div>

  <div class="filters" role="group" aria-label="Review queue">
    {#each ANALYST_REVIEW_QUEUE_OPTIONS as option}
      <button type="button" class:active={queue === option.value} aria-pressed={queue === option.value} onclick={() => setQueue(option.value)}>
        {option.label} <span>{queueCounts[option.value]}</span>
      </button>
    {/each}
  </div>
  <details class="advanced-filters">
    <summary>Advanced filters</summary>
    <div class="detail-filters" role="group" aria-label="Advanced review filters">
      <label>Item type
        <select bind:value={kindFilter} onchange={() => { page = 1; }}>
          <option value="">All item types</option>
          {#each ANALYST_REVIEW_KINDS as kind}<option value={kind}>{kind.replaceAll('_', ' ')}</option>{/each}
        </select>
      </label>
      <label>Source
        <select bind:value={sourceFilter} onchange={() => { page = 1; }}>
          <option value="">All sources</option>
          {#each sourceOptions as source}<option value={source}>{source.replaceAll('_', ' ')}</option>{/each}
        </select>
      </label>
      <label>Age
        <select bind:value={ageFilter} onchange={() => { page = 1; }}>
          <option value="">Any age</option>
          <option value="current">Current</option><option value="aging">Aging</option><option value="stale">Stale</option>
        </select>
      </label>
      <label>Case
        <input bind:value={caseFilter} oninput={() => { page = 1; }} maxlength="253" placeholder="Filter domain" />
      </label>
      <label>Severity
        <select bind:value={priorityFilter} onchange={() => { page = 1; }}>
          <option value="">Any severity</option><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option>
        </select>
      </label>
      <label>Next action
        <select bind:value={nextActionFilter} onchange={() => { page = 1; }}>
          <option value="">Any action</option><option value="review">Review</option><option value="refresh">Refresh</option><option value="follow_up">Follow up</option><option value="resume">Resume</option>
        </select>
      </label>
      <label>Evidence family
        <select bind:value={evidenceFamilyFilter} onchange={() => { page = 1; }}>
          <option value="">All families</option>
          {#each evidenceFamilyOptions as family}<option value={family}>{family.replaceAll('_', ' ')}</option>{/each}
        </select>
      </label>
      <label>Review state
        <select bind:value={lifecycleFilter} onchange={() => { page = 1; }}>
          <option value="">All review states</option>
          <option value="open">Open</option><option value="expected">Expected</option><option value="suppressed">Suppressed</option><option value="resolved">Resolved</option><option value="expired">Expired</option><option value="invalidated">Invalidated</option><option value="recurred">Recurred</option><option value="orphaned">Source unavailable</option>
        </select>
      </label>
      <button type="button" class="reset" onclick={resetDetailFilters}>Reset advanced filters</button>
    </div>
  </details>

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
              <span>{item.evidenceFamily.replaceAll('_', ' ')}</span>
              <span>review {item.lifecycle.state.replaceAll('_', ' ')}</span>
              {#if item.dueAt}<span class:overdue={Date.parse(item.dueAt) <= nowMs}>due {formatDate(item.dueAt)}</span>{/if}
            </div>
            <h3>{item.title}</h3>
            <p>{item.detail}</p>
            <small>{item.source} · observed {formatDate(item.observedAt)}</small>
            <small>{item.rankingReason}</small>
            {#if onreview}<ReviewLifecycleControls {item} lifecycle={lifecycleFor(item)} {onreview} />{/if}
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

  {#if inbox.truncated}
    <div class="admission-warning">
      <p class="warning">
        Showing {inbox.admission.displayed} of {inbox.admission.totalIsExact ? '' : 'at least '}{inbox.admission.totalAtLeast} Review Items.
        {#if inbox.admission.omittedAtLeast > 0} At least {inbox.admission.omittedAtLeast} lower-ranked {inbox.admission.omittedAtLeast === 1 ? 'item is' : 'items are'} omitted.{:else} One or more sources reached an earlier bound, so additional items may be omitted.{/if}
      </p>
      <details>
        <summary>Admission by evidence family</summary>
        <ul>
          {#each admissionRows as row}
            <li><span>{row.family.replaceAll('_', ' ')}</span><span>{row.displayed} shown · {omissionText(row)}</span></li>
          {/each}
        </ul>
      </details>
    </div>
  {/if}
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
  .filters button.active{border-color:rgb(var(--interface-accent-rgb) / .55);background:rgb(var(--interface-accent-rgb) / .08);color:var(--interface-accent)}
  .filters span{padding:1px 6px;border-radius:99px;background:var(--border);color:var(--text);font-size:var(--text-2xs)}
  .advanced-filters{margin:-8px 0 18px}.advanced-filters>summary{width:max-content;cursor:pointer;color:var(--muted);font:650 var(--text-xs) var(--mono)}
  .detail-filters{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));align-items:end;gap:8px;margin-top:12px;padding:13px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .detail-filters label{display:grid;gap:5px;color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  .detail-filters select,.detail-filters input,.detail-filters .reset{min-width:0;min-height:36px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);color:var(--text);font:650 var(--text-xs) var(--mono)}
  .detail-filters select,.detail-filters input{width:100%;padding:0 9px}
  .detail-filters .reset{align-self:end;padding:0 11px;cursor:pointer}
  .detail-filters select:focus-visible,.detail-filters input:focus-visible,.detail-filters .reset:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .admission-warning{display:grid;gap:7px;margin-top:14px}.admission-warning .warning{margin:0}.admission-warning details{font-size:var(--text-xs)}.admission-warning summary{cursor:pointer;font:700 var(--text-xs) var(--mono)}.admission-warning ul{display:grid;gap:4px;margin:8px 0 0;padding:0;list-style:none}.admission-warning li{display:flex;justify-content:space-between;gap:16px;color:var(--muted);font-size:var(--text-2xs);line-height:1.4}.admission-warning li span:first-child{color:var(--text);text-transform:capitalize}
  .items{display:grid;gap:8px;margin:0;padding:0;list-style:none}
  .items li{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:14px;border-left:3px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .items li.high{border-left-color:var(--amber)}
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
  .warning{color:var(--amber)}
  .limitations{margin:18px 0 0;padding-left:20px}
  @media(max-width:1000px){.detail-filters{grid-template-columns:repeat(3,minmax(0,1fr))}}
  @media(max-width:640px){.items li{display:grid}.item-actions{width:100%}.items .btn{width:100%;text-align:center}.inbox-heading>strong{font-size:1.6rem}.detail-filters{grid-template-columns:1fr 1fr}.detail-filters label:nth-child(3),.detail-filters .reset{grid-column:1 / -1}}
</style>
