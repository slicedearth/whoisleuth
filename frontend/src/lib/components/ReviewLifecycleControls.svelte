<script lang="ts">
  import {
    ANALYST_REVIEW_DISPOSITION_OPTIONS,
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
    onreview: (item: AnalystReviewItem, input: {
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
    message = '';
    const selectedDisposition = disposition;
    if (!selectedDisposition) {
      message = 'Choose a disposition before recording this lifecycle decision.';
      return;
    }
    if (!rationale.trim()) {
      message = 'Enter a rationale before recording this lifecycle decision.';
      return;
    }
    if (needsExpiry && !expiresAt) {
      message = 'Expected and suppressed decisions require an expiry.';
      return;
    }
    busy = true;
    try {
      await onreview(item, {
        disposition: selectedDisposition,
        rationale: rationale.trim(),
        expiresAt: iso(expiresAt),
        reviewDueAt: iso(reviewDueAt),
      });
      rationale = '';
      disposition = '';
      expiresAt = '';
      reviewDueAt = '';
      message = 'Review lifecycle saved. Source evidence was not changed.';
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'The Review Item lifecycle could not be saved.';
    } finally {
      busy = false;
    }
  }
</script>

<details class="lifecycle-controls">
  <summary>
    Lifecycle: <strong>{lifecycle.state.replaceAll('_', ' ')}</strong>
    {#if lifecycle.recurred}<span>recurred</span>{/if}
  </summary>
  <p class="lifecycle-reason">{lifecycle.reason}</p>
  {#if lifecycle.decision}
    <p class="last-decision">
      Last decision: {lifecycle.decision.disposition} · {new Date(lifecycle.decision.reviewedAt).toLocaleString('en-AU')}
      {#if lifecycle.decision.expiresAt} · expires {new Date(lifecycle.decision.expiresAt).toLocaleString('en-AU')}{/if}
    </p>
    <p class="retained-rationale">{lifecycle.decision.rationale}</p>
  {/if}
  <div class="decision-grid">
    <label>Disposition
      <select bind:value={disposition} disabled={busy}>
        <option value="">Choose a disposition</option>
        {#each ANALYST_REVIEW_DISPOSITION_OPTIONS as option}
          <option value={option.value} disabled={option.value === 'resolved' && (item.completeness !== 'complete' || item.age === 'stale')}>{option.label}</option>
        {/each}
      </select>
    </label>
    <label class="rationale">Rationale
      <textarea bind:value={rationale} maxlength="1000" rows="2" disabled={busy} placeholder="Record why this lifecycle state applies"></textarea>
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
</details>

<style>
  .lifecycle-controls{min-width:0;margin-top:8px;padding-top:7px;border-top:1px solid var(--border);color:var(--muted);font-size:var(--text-xs)}
  summary{cursor:pointer;color:var(--text);font:650 var(--text-xs) var(--mono);overflow-wrap:anywhere}
  summary span{margin-left:6px;padding:1px 6px;border:1px solid var(--amber);border-radius:99px;color:var(--amber);font-size:var(--text-2xs)}
  .lifecycle-reason,.last-decision,.retained-rationale,.message{margin:7px 0 0;line-height:1.45;overflow-wrap:anywhere}
  .retained-rationale{padding:7px;border-left:2px solid var(--border);background:var(--panel)}
  .decision-grid{display:grid;grid-template-columns:minmax(110px,.7fr) minmax(220px,2fr) minmax(160px,1fr) minmax(160px,1fr) auto;align-items:end;gap:7px;margin-top:10px}
  label{display:grid;min-width:0;gap:4px;color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  select,textarea,input,button{min-width:0;min-height:36px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);color:var(--text);font:600 var(--text-xs) var(--mono)}
  select,input{padding:0 7px}textarea{width:100%;padding:7px;resize:vertical}button{padding:0 10px;cursor:pointer}button:disabled{cursor:not-allowed;opacity:.55}
  select:focus-visible,textarea:focus-visible,input:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  small{display:block;margin-top:8px;line-height:1.4}.message{color:var(--accent)}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  @media(max-width:1100px){.decision-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.rationale{grid-column:1/-1}}
  @media(max-width:640px){.decision-grid{grid-template-columns:minmax(0,1fr)}.rationale{grid-column:auto}}
</style>
