<script lang="ts">
  import { tick } from 'svelte';
  import { restoreSubmittedFocus } from '../controllers/submitted-draft.ts';
  import { page as route } from '$app/state';
  import { goto } from '$app/navigation';
  import { handlesLocalLink } from '../link-activation.ts';
  import { setCaseNavigationContext } from '../console-workflow-state.ts';
  import { analystReviewNeedsAttention } from '../analysis/analyst-review-attention.ts';
  import Pagination from './Pagination.svelte';
  import AnalystReviewInboxItem from './AnalystReviewInboxItem.svelte';
  import ReviewSessionControl from './ReviewSessionControl.svelte';
  import type { ReviewFormDraft, ReviewSessionPosition } from '../../../../packages/contracts/review-session-contract.mts';
  import { resolveReviewSessionSelection } from '../../../../packages/workspace/review-session.mts';
  import { MAX_ANALYST_REVIEW_ITEMS } from '../../../../packages/contracts/analyst-review-state-contract.mts';
  import {
    ANALYST_REVIEW_EVIDENCE_FAMILIES,
    ANALYST_REVIEW_KINDS,
    ANALYST_REVIEW_QUEUE_OPTIONS,
    analystReviewQueue,
    filterAnalystReviewItems,
    type AnalystReviewAge,
    type AnalystReviewDismissalReason,
    type AnalystReviewNextAction,
    type AnalystReviewPriority,
    type AnalystReviewInbox,
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
    selectedSubjectKey = '',
    now = new Date().toISOString(),
    ondismiss,
    onreview,
  }: {
    inbox: AnalystReviewInbox;
    selectedSubjectKey?: string;
    now?: string;
    ondismiss?: (item: AnalystReviewItem, reason: AnalystReviewDismissalReason) => void | Promise<void>;
    onreview?: (item: AnalystReviewItem, input: { disposition: AnalystReviewDisposition; rationale: string; expiresAt: string | null; reviewDueAt: string | null }) => void | Promise<void>;
  } = $props();
  const attentionOnly = $derived(route.url.searchParams.get('attention') === '1');
  const queue = $derived<AnalystReviewQueue>(ANALYST_REVIEW_QUEUE_OPTIONS.find(option => option.value === route.url.searchParams.get('queue'))?.value ?? 'needs_action');
  let kindFilter = $state<AnalystReviewKind | ''>('');
  let sourceFilter = $state('');
  let ageFilter = $state<AnalystReviewAge | ''>('');
  let caseFilter = $state('');
  let priorityFilter = $state<AnalystReviewPriority | ''>('');
  let nextActionFilter = $state<AnalystReviewNextAction | ''>('');
  let evidenceFamilyFilter = $state<AnalystReviewEvidenceFamily | ''>('');
  let lifecycleFilter = $state<AnalystReviewLifecycleState | ''>('');
  let page = $state(1);
  let expandedId = $state<string | null | undefined>(undefined);
  let reviewDrafts = $state<ReviewFormDraft[]>([]);
  let restoreRevision = $state(0);
  let showDrafts = $state(false);
  let itemsElement = $state<HTMLOListElement>();
  let inboxElement = $state<HTMLElement>();
  let draftsSummary = $state<HTMLElement>();
  const focusedCaseId = $derived(route.url.searchParams.get('case-review') ?? '');
  const scopedItems = $derived(focusedCaseId ? inbox.items.filter(item => item.caseId === focusedCaseId) : inbox.items);
  const sourceOptions = $derived([...new Set(inbox.items.flatMap((item) => item.sourceIds))].sort());
  const evidenceFamilyOptions = $derived([...new Set(inbox.items.map((item) => item.evidenceFamily))].sort());
  const queueCounts = $derived(Object.fromEntries(ANALYST_REVIEW_QUEUE_OPTIONS.map((option) => [
    option.value,
    option.value === 'all' ? scopedItems.length : scopedItems.filter((item) => analystReviewQueue(item, now) === option.value).length,
  ])) as Record<AnalystReviewQueue, number>);
  const filteredByQueue = $derived(scopedItems.filter((item) => {
    if (selectedSubjectKey) return item.subjectKey === selectedSubjectKey;
    if (attentionOnly) return analystReviewNeedsAttention(item.lifecycle);
    if (queue !== 'all' && analystReviewQueue(item, now) !== queue) return false;
    return !kindFilter || item.kind === kindFilter;
  }));
  const filtered = $derived(selectedSubjectKey ? filteredByQueue : filterAnalystReviewItems(filteredByQueue, {
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
  const expanded = $derived(expandedId === undefined ? visible[0]?.id : expandedId);
  const filterKey = $derived(JSON.stringify([attentionOnly, queue, focusedCaseId, selectedSubjectKey, kindFilter,
    sourceFilter, ageFilter, caseFilter, priorityFilter, nextActionFilter, evidenceFamilyFilter, lifecycleFilter]));
  $effect(() => { filterKey; page = 1; expandedId = undefined; });
  const currentItem = $derived(filtered.find(item => item.id === expanded));
  const position = $derived<ReviewSessionPosition>({
    filters: { queue, attentionOnly, focusedCaseId, kind: kindFilter, source: sourceFilter, age: ageFilter, caseQuery: caseFilter,
      priority: priorityFilter, nextAction: nextActionFilter, evidenceFamily: evidenceFamilyFilter, lifecycle: lifecycleFilter },
    selected: currentItem ? { id: currentItem.id, subjectKey: currentItem.subjectKey, materialFingerprint: currentItem.materialFingerprint, caseId: currentItem.caseId } : null,
    drafts: reviewDrafts,
  });
  const admissionRows = $derived(ANALYST_REVIEW_EVIDENCE_FAMILIES
    .map((family) => ({ family, ...inbox.admission.byEvidenceFamily[family] }))
    .filter((row) => row.totalAtLeast > 0));

  function setQueue(value: AnalystReviewQueue) {
    const url = new URL(route.url);
    url.searchParams.delete('attention');
    url.searchParams.set('queue', value);
    void goto(`${url.pathname}${url.search}${url.hash}`, { noScroll: true, keepFocus: true });
    page = 1;
  }

  function retainCaseReturn(event: MouseEvent, item: AnalystReviewItem) {
    if (!handlesLocalLink(event) || !item.caseId) return;
    const target = new URL(item.href, route.url);
    if (target.origin !== route.url.origin || target.pathname !== '/cases' || target.searchParams.get('case') !== item.caseId) return;
    setCaseNavigationContext(item.caseId, `${route.url.pathname}${route.url.search}${route.url.hash}`, 'review inbox');
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

  function omissionText(row: { omittedAtLeast: number; totalIsExact: boolean }): string {
    if (row.totalIsExact) return `${row.omittedAtLeast} omitted`;
    return row.omittedAtLeast > 0 ? `at least ${row.omittedAtLeast} omitted` : 'additional items may be omitted';
  }

  async function focusReview(index: number) {
    const item = filtered[index];
    if (!item) return;
    page = Math.floor(index / PAGE_SIZE) + 1;
    expandedId = item.id;
    await tick();
    const visibleIndex = visible.findIndex(current => current.id === item.id);
    if (visibleIndex < 0 || expandedId !== item.id) return;
    itemsElement?.querySelectorAll<HTMLElement>(':scope > li > details > summary')[visibleIndex]?.focus();
  }

  async function resumeReview(saved: ReviewSessionPosition): Promise<string> {
    const retained = new Map(reviewDrafts.map(draft => [draft.id, draft]));
    for (const draft of saved.drafts) if (!retained.has(draft.id)) retained.set(draft.id, draft);
    if (retained.size > MAX_ANALYST_REVIEW_ITEMS) return 'Saved and current forms exceed one admitted review queue. Finish or discard current drafts before resuming; no forms were removed.';
    reviewDrafts = [...retained.values()];
    restoreRevision += 1;
    const url = new URL(route.url);
    url.searchParams.delete('review');
    url.searchParams.delete('resume');
    url.searchParams.delete('attention');
    url.searchParams.delete('case-review');
    url.searchParams.set('queue', saved.filters.queue);
    if (saved.filters.attentionOnly) url.searchParams.set('attention', '1');
    if (saved.filters.focusedCaseId) url.searchParams.set('case-review', saved.filters.focusedCaseId);
    await goto(`${url.pathname}${url.search}${url.hash}`, { noScroll: true, keepFocus: true });
    kindFilter = saved.filters.kind; sourceFilter = saved.filters.source; ageFilter = saved.filters.age;
    caseFilter = saved.filters.caseQuery; priorityFilter = saved.filters.priority; nextActionFilter = saved.filters.nextAction;
    evidenceFamilyFilter = saved.filters.evidenceFamily; lifecycleFilter = saved.filters.lifecycle;
    await tick();
    const selected = resolveReviewSessionSelection(saved, filtered);
    if (selected.index >= 0) await focusReview(selected.index);
    else { page = 1; expandedId = null; }
    if (selected.state === 'changed') return 'Position restored. The selected review has changed since this checkpoint; inspect the current evidence before deciding.';
    if (selected.state === 'unavailable' || selected.state === 'ambiguous') return 'Filters restored, but the saved item is unavailable or ambiguous in the current results. No other item was substituted.';
    return 'Review position restored against current results. No decision or collection was replayed.';
  }

  async function reviewMutation(item: AnalystReviewItem, operation: () => void | Promise<void>) {
    const origin = inboxElement?.contains(document.activeElement) ? document.activeElement : null;
    expandedId = item.id;
    try { await operation(); }
    finally {
      await tick();
      if (origin && !origin.isConnected) restoreSubmittedFocus(origin, inboxElement?.querySelector<HTMLElement>('#review-inbox-title'), inboxElement);
    }
  }

  async function discardDraft(id: string, origin: EventTarget | null) {
    reviewDrafts = reviewDrafts.filter(current => current.id !== id);
    restoreRevision += 1;
    await tick();
    restoreSubmittedFocus(origin instanceof Element ? origin : null,
      draftsSummary?.isConnected ? draftsSummary : inboxElement?.querySelector<HTMLElement>('#review-inbox-title'), inboxElement);
  }
</script>

<section class="review-inbox card" aria-label="Review inbox" bind:this={inboxElement}>
  {#if !selectedSubjectKey}<ReviewSessionControl {position} onresume={resumeReview} resumeRequested={route.url.searchParams.get('resume') === '1'} />{/if}
  {#if reviewDrafts.length}
    <details class="current-drafts" bind:open={showDrafts}>
      <summary bind:this={draftsSummary}>Unfinished review forms ({reviewDrafts.length})</summary>
      {#if showDrafts}
        <p class="notice">Discarding here clears the form for this visit. Save the current position again to replace any checkpoint copy.</p>
        <ol>{#each reviewDrafts as draft, index (draft.id)}
          {@const label = inbox.items.find(item => item.id === draft.id)?.title ?? 'Review no longer in the current inbox'}
          <li><strong>{label}</strong><p>{draft.rationale || 'No rationale entered.'}</p>
            {#if draft.uncertain}<p>This decision may already have been saved. Check its current state; discarding the form does not cancel or undo a write.</p>{/if}
            <button type="button" class="btn" aria-label={`Discard ${draft.uncertain ? 'uncertain ' : ''}draft ${index + 1}: ${label}`} onclick={event => void discardDraft(draft.id, event.currentTarget)}>{draft.uncertain ? 'Discard uncertain draft' : 'Discard draft'}</button>
          </li>
        {/each}</ol>
      {/if}
    </details>
  {/if}
  {#if inbox.items.length || inbox.truncated}
  <div class="inbox-heading">
    <div>
      <h2 id="review-inbox-title" tabindex="-1">Retained review items</h2>
      {#if focusedCaseId}<p>Associated with the selected Case.</p>{/if}
    </div>
    {#if inbox.items.length || inbox.truncated}<strong aria-label={`${scopedItems.length} retained review items${focusedCaseId ? ' for the selected Case' : ''}`}>{scopedItems.length}</strong>{/if}
  </div>
  {/if}

  {#if selectedSubjectKey}
    <p class="selected-review" role="status">{filteredByQueue.length ? 'Showing the selected review and its retained history.' : 'The selected review is unavailable in the admitted inbox. No other review has been substituted.'} <a href="/monitor?view=inbox&queue=all#review-inbox-title">Show all review items</a></p>
  {/if}
  {#if inbox.items.length && !selectedSubjectKey}
  <div class="filters" role="group" aria-label="Review queue">
    {#if focusedCaseId}<span class="active">Selected Case</span><a href="/monitor?view=inbox&queue=all">Show all Cases</a>{/if}
    {#if attentionOnly}<span class="active" role="status">Attention needed · {filteredByQueue.length}</span>{/if}
    {#each ANALYST_REVIEW_QUEUE_OPTIONS as option}
      <button type="button" class:active={!attentionOnly && queue === option.value} aria-pressed={!attentionOnly && queue === option.value} onclick={() => setQueue(option.value)}>
        {option.label} <span>{queueCounts[option.value]}</span>
      </button>
    {/each}
  </div>
  <details class="advanced-filters">
    <summary>Advanced filters</summary>
    <div class="detail-filters responsive-grid" role="group" aria-label="Advanced review filters">
      <label class="field">Item type
        <select bind:value={kindFilter} onchange={() => { page = 1; }}>
          <option value="">All item types</option>
          {#each ANALYST_REVIEW_KINDS as kind}<option value={kind}>{kind.replaceAll('_', ' ')}</option>{/each}
        </select>
      </label>
      <label class="field">Source
        <select bind:value={sourceFilter} onchange={() => { page = 1; }}>
          <option value="">All sources</option>
          {#each sourceOptions as source}<option value={source}>{source.replaceAll('_', ' ')}</option>{/each}
        </select>
      </label>
      <label class="field">Age
        <select bind:value={ageFilter} onchange={() => { page = 1; }}>
          <option value="">Any age</option>
          <option value="current">Current</option><option value="aging">Aging</option><option value="stale">Stale</option><option value="unknown">Age unknown</option>
        </select>
      </label>
      <label class="field">Case
        <input bind:value={caseFilter} oninput={() => { page = 1; }} maxlength="253" placeholder="Filter domain" />
      </label>
      <label class="field">Severity
        <select bind:value={priorityFilter} onchange={() => { page = 1; }}>
          <option value="">Any severity</option><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option>
        </select>
      </label>
      <label class="field">Next action
        <select bind:value={nextActionFilter} onchange={() => { page = 1; }}>
          <option value="">Any action</option><option value="review">Review</option><option value="refresh">Refresh</option><option value="follow_up">Follow up</option><option value="resume">Resume</option>
        </select>
      </label>
      <label class="field">Evidence family
        <select bind:value={evidenceFamilyFilter} onchange={() => { page = 1; }}>
          <option value="">All families</option>
          {#each evidenceFamilyOptions as family}<option value={family}>{family.replaceAll('_', ' ')}</option>{/each}
        </select>
      </label>
      <label class="field">Review state
        <select bind:value={lifecycleFilter} onchange={() => { page = 1; }}>
          <option value="">All review states</option>
          <option value="open">Open</option><option value="expected">Expected</option><option value="suppressed">Suppressed</option><option value="resolved">Resolved</option><option value="expired">Expired</option><option value="invalidated">Invalidated</option><option value="recurred">Recurred</option><option value="orphaned">Source unavailable</option>
        </select>
      </label>
      <button type="button" class="btn reset" onclick={resetDetailFilters}>Reset advanced filters</button>
    </div>
  </details>
  {/if}

  {#if visible.length}
    <ol class="items" bind:this={itemsElement}>
      {#key restoreRevision}
      {#each visible as item, index (item.id)}
        <li>
          <AnalystReviewInboxItem {item} {now} expanded={expanded === item.id}
            onexpand={() => expandedId = item.id} oncollapse={() => expandedId = null}
            {...(reviewDrafts.find(draft => draft.id === item.id) ? { restoredDraft: reviewDrafts.find(draft => draft.id === item.id)! } : {})}
            draftCapacityReached={reviewDrafts.length >= MAX_ANALYST_REVIEW_ITEMS && !reviewDrafts.some(draft => draft.id === item.id)}
            ondraft={draft => { reviewDrafts = [...reviewDrafts.filter(current => current.id !== item.id), ...(draft ? [draft] : [])]; }}
            {...((currentPage - 1) * PAGE_SIZE + index > 0 ? { onprevious: () => void focusReview((currentPage - 1) * PAGE_SIZE + index - 1) } : {})}
            {...((currentPage - 1) * PAGE_SIZE + index + 1 < filtered.length ? { onnext: () => void focusReview((currentPage - 1) * PAGE_SIZE + index + 1) } : {})}
            {...(ondismiss ? { ondismiss: (current, reason) => reviewMutation(current, () => ondismiss?.(current, reason)) } : {})}
            {...(onreview ? { onreview: (current, input) => reviewMutation(current, () => onreview?.(current, input)) } : {})}
            onopen={(event) => retainCaseReturn(event, item)} />
        </li>
      {/each}
      {/key}
    </ol>
    <Pagination currentPage={currentPage} {pageCount} setPage={(value) => { page = value; expandedId = undefined; }} ariaLabel="Review inbox pages" />
  {:else if !inbox.items.length && !inbox.truncated}
    <div class="empty-start">
      <h2 id="review-inbox-title" tabindex="-1">No retained review items</h2>
      <p>Investigate a domain or open saved Cases.</p>
      <div class="toolbar"><a class="primary" href="/lookup">Investigate a domain</a><a class="btn" href="/cases">Open Cases</a></div>
    </div>
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
  <details class="review-scope"><summary>Review scope and limitations</summary><ul class="limitations">{#each inbox.limitations as limitation}<li>{limitation}</li>{/each}</ul></details>
</section>

<style>
  .review-inbox{padding:var(--card-pad)}
  .current-drafts{margin-block:12px}.current-drafts li{overflow-wrap:anywhere;margin-block:12px}.current-drafts p{white-space:pre-wrap}
  .empty-start{max-width:70ch;margin:20px 0}
  .empty-start h2{font-size:var(--text-lg)}
  .empty-start p{color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  .review-scope{margin-top:16px;padding-top:10px;border-top:1px solid var(--border)}
  .review-scope summary{cursor:pointer;font-size:var(--text-sm)}
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
  .detail-filters{--grid-min:13rem;align-items:end;margin-top:12px}
  .detail-filters select,.detail-filters input{min-width:0}
  .detail-filters .reset:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .admission-warning{display:grid;gap:7px;margin-top:14px}.admission-warning .warning{margin:0}.admission-warning details{font-size:var(--text-xs)}.admission-warning summary{cursor:pointer;font:700 var(--text-xs) var(--mono)}.admission-warning ul{display:grid;gap:4px;margin:8px 0 0;padding:0;list-style:none}.admission-warning li{display:flex;justify-content:space-between;gap:16px;color:var(--muted);font-size:var(--text-2xs);line-height:1.4}.admission-warning li span:first-child{color:var(--text);text-transform:capitalize}
  .items{display:grid;gap:0;margin:0;padding:0;list-style:none}
  .items>li{min-width:0}
  .selected-review{margin:14px 0;color:var(--muted);font-size:var(--text-sm);line-height:1.5;overflow-wrap:anywhere}
  .empty,.warning,.limitations{color:var(--muted);font-size:var(--text-sm)}
  .warning{color:var(--amber)}
  .limitations{margin:18px 0 0;padding-left:20px}
  @media(max-width:640px){.filters button,.detail-filters select,.detail-filters input,.detail-filters .reset{min-height:44px}.inbox-heading>strong{font-size:1.6rem}}
</style>
