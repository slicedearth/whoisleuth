<script lang="ts">
  import {
    ANALYST_REVIEW_DISPOSITION_OPTIONS,
    analystReviewCanResolve,
    type AnalystReviewDisposition,
    type AnalystReviewItem,
    type AnalystReviewLifecycle,
  } from '../analysis/analyst-review-state.ts';

  let {
    item,
    lifecycle,
    onreview,
  }: {
    item: AnalystReviewItem;
    lifecycle: AnalystReviewLifecycle;
    onreview?: (item: AnalystReviewItem, input: {
      disposition: AnalystReviewDisposition;
      rationale: string;
      expiresAt: string | null;
      reviewDueAt: string | null;
    }) => void | Promise<void>;
  } = $props();

  let disposition = $state<AnalystReviewDisposition | ''>('');
  let rationale = $state('');
  let expiresAt = $state('');
  let reviewDueAt = $state('');
  let busy = $state(false);
  let message = $state('');
  const needsExpiry = $derived(disposition === 'expected' || disposition === 'suppressed');

  function iso(value: string): string | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  async function submit() {
    if (!onreview || busy) return;
    message = '';
    const selectedDisposition = disposition;
    if (!selectedDisposition) {
      message = 'Choose a review outcome before saving.';
      return;
    }
    if (!rationale.trim()) {
      message = 'Enter a rationale before saving this review.';
      return;
    }
    if (needsExpiry && !expiresAt) {
      message = 'Expected and suppressed decisions require an expiry.';
      return;
    }
    busy = true;
    const itemId = item.id;
    const submittedRationale = rationale.trim();
    try {
      await onreview(item, {
        disposition: selectedDisposition,
        rationale: submittedRationale,
        expiresAt: iso(expiresAt),
        reviewDueAt: iso(reviewDueAt),
      });
      if (item.id !== itemId || rationale.trim() !== submittedRationale) return;
      rationale = '';
      disposition = '';
      expiresAt = '';
      reviewDueAt = '';
      message = 'Review saved. Source evidence was not changed.';
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'The Review Item could not be saved.';
    } finally {
      busy = false;
    }
  }
</script>

<details class="lifecycle-controls">
  <summary>
    Review state: <strong>{lifecycle.state.replaceAll('_', ' ')}</strong>
    {#if lifecycle.recurred}<span>recurred</span>{/if}
  </summary>
  <p class="lifecycle-reason">{lifecycle.reason}</p>
  {#if lifecycle.decision}
    <p class="last-decision">
      Last decision: {lifecycle.decision.disposition} · {new Date(lifecycle.decision.reviewedAt).toLocaleString('en-AU')}
      {#if lifecycle.decision.expiresAt} · expires {new Date(lifecycle.decision.expiresAt).toLocaleString('en-AU')}{/if}
      {#if lifecycle.decision.history.length} · {lifecycle.decision.history.length} earlier decision{lifecycle.decision.history.length === 1 ? '' : 's'} retained{/if}
      {#if lifecycle.decision.historyOmitted} · at least {lifecycle.decision.historyOmitted} additional omitted{/if}
    </p>
    <p class="retained-rationale">{lifecycle.decision.rationale}</p>
    {#if lifecycle.decision.history.length}
      <details class="decision-history">
        <summary>Earlier decisions ({lifecycle.decision.history.length})</summary>
        <ol>
          {#each lifecycle.decision.history as decision}
            <li>
              <p><strong>{decision.disposition}</strong> · <time datetime={decision.reviewedAt}>{new Date(decision.reviewedAt).toLocaleString('en-AU')}</time></p>
              <p>{decision.rationale}</p>
              {#if decision.expiresAt}<p>Expiry: <time datetime={decision.expiresAt}>{new Date(decision.expiresAt).toLocaleString('en-AU')}</time></p>{/if}
              {#if decision.reviewDueAt}<p>Next review: <time datetime={decision.reviewDueAt}>{new Date(decision.reviewDueAt).toLocaleString('en-AU')}</time></p>{/if}
            </li>
          {/each}
        </ol>
      </details>
    {/if}
  {/if}
  {#if onreview}
  <div class="decision-grid">
    <label>Review outcome
      <select bind:value={disposition} disabled={busy}>
        <option value="">Choose an outcome</option>
        {#each ANALYST_REVIEW_DISPOSITION_OPTIONS as option}
          <option value={option.value} disabled={option.value === 'resolved' && !analystReviewCanResolve(item)}>{option.label}</option>
        {/each}
      </select>
    </label>
    <label class="rationale">Rationale
      <textarea bind:value={rationale} maxlength="1000" rows="2" disabled={busy} placeholder="Record why this review outcome applies"></textarea>
    </label>
    <label>Expiry {#if needsExpiry}<span aria-hidden="true">*</span><span class="sr-only">required</span>{/if}
      <input type="datetime-local" bind:value={expiresAt} required={needsExpiry} disabled={busy} />
    </label>
    <label>Next review
      <input type="datetime-local" bind:value={reviewDueAt} disabled={busy} />
    </label>
    <button type="button" disabled={busy || !disposition || !rationale.trim() || (needsExpiry && !expiresAt)} onclick={submit}>{busy ? 'Saving…' : 'Record decision'}</button>
  </div>
  <small>Times use this device’s timezone and are stored as UTC. Material evidence changes or expiry reopen the item; earlier rationale remains historical.</small>
  {#if message}<p class="message" role="status" aria-live="polite">{message}</p>{/if}
  {/if}
</details>

<style>
  .lifecycle-controls{min-width:0;margin-top:8px;padding-top:7px;border-top:1px solid var(--border);color:var(--muted);font-size:var(--text-xs)}
  summary{min-height:24px;align-content:center;cursor:pointer;color:var(--text);font:650 var(--text-xs) var(--mono);overflow-wrap:anywhere}
  summary span{margin-left:6px;padding:1px 6px;border:1px solid var(--amber);border-radius:99px;color:var(--amber);font-size:var(--text-2xs)}
  .lifecycle-reason,.last-decision,.retained-rationale,.message{margin:7px 0 0;line-height:1.45;overflow-wrap:anywhere}
  .retained-rationale{padding:7px;border-left:2px solid var(--border);background:var(--panel)}
  .decision-history{margin-top:8px}.decision-history ol{display:grid;gap:8px;padding-left:22px}.decision-history li{min-width:0;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm)}.decision-history p{margin:0;overflow-wrap:anywhere}.decision-history p+p{margin-top:5px}
  .decision-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,13rem),1fr));align-items:end;gap:7px;margin-top:10px}
  label{display:grid;min-width:0;gap:4px;color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  select,textarea,input,button{min-width:0;min-height:36px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);color:var(--text);font:600 var(--text-xs) var(--mono)}
  select,input{padding:0 7px}textarea{width:100%;padding:7px;resize:vertical}button{padding:0 10px;cursor:pointer}button:disabled{cursor:not-allowed;opacity:.55}
  select:focus-visible,textarea:focus-visible,input:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  small{display:block;margin-top:8px;line-height:1.4}.message{color:var(--accent)}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  @media(max-width:640px){select,textarea,input,button,summary{min-height:44px}}
</style>
