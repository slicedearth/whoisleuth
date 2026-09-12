<script lang="ts">
  import { tick, type ComponentProps } from 'svelte';
  import { restoreSubmittedFocus } from '../controllers/submitted-draft.ts';
  import { failedLocalMutationOutcome } from '../local-mutation-outcome.ts';
  import {
    ANALYST_REVIEW_DISMISSAL_REASONS, ANALYST_REVIEW_QUEUE_OPTIONS, analystReviewQueueMembership,
    type AnalystReviewDismissalReason, type AnalystReviewInboxItem,
  } from '../analysis/analyst-review-inbox.ts';
  import ReviewLifecycleControls from './ReviewLifecycleControls.svelte';
  import EvidenceTimestamp from './EvidenceTimestamp.svelte';

  let { item, now, expanded, onexpand, oncollapse, onprevious, onnext, onreview, ondismiss, onopen }: {
    item: AnalystReviewInboxItem;
    now: string;
    expanded: boolean;
    onexpand: () => void;
    oncollapse: () => void;
    onprevious?: () => void;
    onnext?: () => void;
    onreview?: ComponentProps<typeof ReviewLifecycleControls>['onreview'];
    ondismiss?: (item: AnalystReviewInboxItem, reason: AnalystReviewDismissalReason) => void | Promise<void>;
    onopen: (event: MouseEvent) => void;
  } = $props();
  let reason = $state<AnalystReviewDismissalReason | ''>('');
  let busy = $state(false);
  let uncertain = $state(false);
  let message = $state('');
  let form = $state<HTMLFormElement>();
  let statusElement = $state<HTMLParagraphElement>();
  let prepared = $state(false);
  $effect(() => { if (expanded) prepared = true; });
  const membership = $derived(analystReviewQueueMembership(item, now));

  async function dismiss() {
    if (!ondismiss || !reason || !item.dismissalTarget || !item.caseId || busy || uncertain) return;
    const submitted = reason;
    const origin = form?.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    busy = true;
    message = '';
    try {
      await ondismiss(item, submitted);
      if (reason === submitted) reason = '';
    } catch (cause) {
      uncertain = failedLocalMutationOutcome(cause) === 'unknown';
      message = cause instanceof Error ? cause.message : 'The evidence-gap review could not be saved.';
    } finally {
      busy = false;
      await tick();
      restoreSubmittedFocus(origin, uncertain ? statusElement : origin, form);
    }
  }
</script>

<details class="review-item" class:urgent={item.priority === 'urgent'} class:high={item.priority === 'high'} open={expanded}
  ontoggle={(event) => {
    if (event.currentTarget.open && !expanded) onexpand();
    else if (!event.currentTarget.open && expanded) oncollapse();
  }}>
  <summary>
    <h3>{item.title}</h3>
    <span class="summary-meta">{item.priority} priority · {item.nextAction.replaceAll('_', ' ')} · review {item.lifecycle.state.replaceAll('_', ' ')}</span>
  </summary>
  {#if expanded || prepared}
  <div class="item-body">
    {#if onprevious || onnext}
      <nav class="review-navigation" aria-label={`Adjacent reviews for ${item.title}`}>
        <button type="button" class="btn" disabled={!onprevious} onclick={onprevious}>Previous item</button>
        <button type="button" class="btn" disabled={!onnext} onclick={onnext}>Next item</button>
      </nav>
    {/if}
    <p>{item.detail}</p>
    <dl class="item-facts">
      <div><dt>Source</dt><dd>{item.source}</dd></div>
      <div><dt>Observed</dt><dd><EvidenceTimestamp value={item.observedAt} label={`observation time for ${item.title}`} unavailable="at an unknown time" /></dd></div>
      <div><dt>Evidence</dt><dd>{item.evidenceFamily.replaceAll('_', ' ')} · {item.completeness} · {item.age}</dd></div>
      <div><dt>Item type</dt><dd>{item.kind.replaceAll('_', ' ')}</dd></div>
      {#if item.dueAt}<div class:overdue={Date.parse(item.dueAt) <= Date.parse(now)}><dt>Due</dt><dd><EvidenceTimestamp value={item.dueAt} label={`due time for ${item.title}`} /></dd></div>{/if}
    </dl>
    <p class="reason">{item.rankingReason}</p>
    <p class="reason">{ANALYST_REVIEW_QUEUE_OPTIONS.find(option => option.value === membership.queue)?.label}: {membership.reason}</p>
    <div class="item-actions">
      <a class="btn" href={item.href} onclick={onopen}>Review</a>
      {#if item.retryHref}<a class="btn secondary" href={item.retryHref}>Refresh evidence</a>{/if}
    </div>
    {#if ondismiss && item.dismissalTarget}
      <form class="dismissal" bind:this={form} aria-label={`Dismiss evidence gap for ${item.title}`} onsubmit={(event) => { event.preventDefault(); void dismiss(); }}>
        <label class="field">Dismissal reason
          <select bind:value={reason} required disabled={busy || uncertain}>
            <option value="">Select review outcome</option>
            {#each ANALYST_REVIEW_DISMISSAL_REASONS as option}<option value={option.value}>{option.label}</option>{/each}
          </select>
        </label>
        <button type="submit" class="btn" disabled={!reason || busy || uncertain}>{busy ? 'Saving…' : 'Dismiss gap'}</button>
        {#if message}<p bind:this={statusElement} tabindex="-1" role="status">{message}</p>{/if}
      </form>
    {/if}
    <ReviewLifecycleControls {item} lifecycle={item.lifecycle} {...(onreview ? { onreview } : {})} />
  </div>
  {/if}
</details>

<style>
  .review-item{min-width:0;border-block-end:1px solid var(--border);border-inline-start:3px solid var(--border)}
  .review-item.high{border-inline-start-color:var(--amber)}.review-item.urgent{border-inline-start-color:var(--danger)}
  summary{display:list-item;padding:12px 14px;cursor:pointer;color:var(--text);overflow-wrap:anywhere}
  summary:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  h3{display:inline;margin:0;font-family:inherit;font-size:var(--text-sm);font-weight:650}
  .summary-meta{display:block;margin-top:4px;color:var(--muted);font-size:var(--text-xs)}
  .item-body{min-width:0;padding:0 14px 16px;overflow-wrap:anywhere}
  .item-body>p{margin:8px 0;color:var(--text);font-size:var(--text-sm);line-height:1.5}
  .item-body>.reason{color:var(--muted);font-size:var(--text-xs)}
  .item-facts{display:grid;gap:5px;margin:12px 0;font-size:var(--text-xs);line-height:1.5}
  .item-facts>div{display:grid;grid-template-columns:6rem minmax(0,1fr);gap:8px;align-items:baseline}
  dt{color:var(--muted)}dd{margin:0;min-width:0}.overdue dt{color:var(--danger)}
  .review-navigation,.item-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.review-navigation{justify-content:flex-end;margin-block:0 10px}
  button,select{min-width:0}button:disabled{opacity:.55;cursor:not-allowed}button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .dismissal{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin-top:12px;font-size:var(--text-xs)}.dismissal label{min-width:0;flex:1 1 15rem}.dismissal p{flex-basis:100%;margin:0;color:var(--muted)}
  @media(max-width:640px){summary,button,select{min-height:44px}.item-facts>div{grid-template-columns:minmax(0,1fr);gap:0}.item-actions .btn{flex:1 1 auto}.item-body{padding-inline:12px}}
</style>
