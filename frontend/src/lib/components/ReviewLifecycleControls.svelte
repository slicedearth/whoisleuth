<script lang="ts">
  import { tick } from 'svelte';
  import { createDraftRevision, restoreSubmittedFocus } from '../controllers/submitted-draft.ts';
  import { failedLocalMutationOutcome } from '../local-mutation-outcome.ts';
  import { utcDateTimeInputAttributes } from '../analysis/case-response-form-values.ts';
  import EvidenceTimestamp from './EvidenceTimestamp.svelte';
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
  let uncertain = $state(false);
  let draftFingerprint = $state<string | null>(null);
  let form = $state<HTMLFormElement>();
  let statusElement = $state<HTMLParagraphElement>();
  const draft = createDraftRevision(() => item.id);
  const changedEvidence = $derived(draftFingerprint !== null && draftFingerprint !== item.materialFingerprint);
  const needsExpiry = $derived(disposition === 'expected' || disposition === 'suppressed');

  function iso(value: string): string | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  async function submit() {
    if (!onreview || busy || uncertain || changedEvidence) return;
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
    const unchanged = draft.capture();
    const origin = form?.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const submittedRationale = rationale.trim();
    let saved = false;
    try {
      await onreview(item, {
        disposition: selectedDisposition,
        rationale: submittedRationale,
        expiresAt: iso(expiresAt),
        reviewDueAt: iso(reviewDueAt),
      });
      if (!unchanged()) return;
      rationale = '';
      disposition = '';
      expiresAt = '';
      reviewDueAt = '';
      draftFingerprint = null;
      message = 'Review saved. Source evidence was not changed.';
      saved = true;
    } catch (cause) {
      uncertain = failedLocalMutationOutcome(cause) === 'unknown';
      message = cause instanceof Error ? cause.message : 'The Review Item could not be saved.';
    } finally {
      busy = false;
      await tick();
      restoreSubmittedFocus(origin, uncertain ? statusElement : saved ? form?.querySelector<HTMLSelectElement>('select') : origin, form);
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
      Last decision: {lifecycle.decision.disposition} · <EvidenceTimestamp value={lifecycle.decision.reviewedAt} label={`review time for ${item.title}`} />
      {#if lifecycle.decision.expiresAt} · expires <EvidenceTimestamp value={lifecycle.decision.expiresAt} label={`expiry for ${item.title}`} />{/if}
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
              <p><strong>{decision.disposition}</strong> · <EvidenceTimestamp value={decision.reviewedAt} label={`earlier review time for ${item.title}`} /></p>
              <p>{decision.rationale}</p>
              {#if decision.expiresAt}<p>Expiry: <EvidenceTimestamp value={decision.expiresAt} label={`earlier expiry for ${item.title}`} /></p>{/if}
              {#if decision.reviewDueAt}<p>Next review: <EvidenceTimestamp value={decision.reviewDueAt} label={`earlier follow-up time for ${item.title}`} /></p>{/if}
            </li>
          {/each}
        </ol>
      </details>
    {/if}
  {/if}
  {#if onreview}
  {#if changedEvidence}<p class="message" role="status">The evidence changed while this draft was open. Review the current item before applying this rationale.</p><button type="button" class="btn" disabled={busy || uncertain} onclick={() => { draftFingerprint = item.materialFingerprint; draft.changed(); }}>Use draft with current evidence</button>{/if}
  <form class="decision-grid responsive-grid" bind:this={form} aria-label={`Review decision for ${item.title}`} oninput={() => { draft.changed(); draftFingerprint ??= item.materialFingerprint; }} onsubmit={(event) => { event.preventDefault(); void submit(); }}>
    <label class="field">Review outcome
      <select bind:value={disposition} required disabled={busy || uncertain}>
        <option value="">Choose an outcome</option>
        {#each ANALYST_REVIEW_DISPOSITION_OPTIONS as option}
          <option value={option.value} disabled={option.value === 'resolved' && !analystReviewCanResolve(item)}>{option.label}</option>
        {/each}
      </select>
    </label>
    <label class="field">Rationale
      <textarea bind:value={rationale} required maxlength="1000" rows="2" disabled={busy || uncertain} placeholder="Record why this review outcome applies"></textarea>
    </label>
    <label class="field">Expiry {#if needsExpiry}<span aria-hidden="true">*</span><span class="sr-only">required</span>{/if}
      <input type="datetime-local" {...utcDateTimeInputAttributes} bind:value={expiresAt} required={needsExpiry} disabled={busy || uncertain} />
    </label>
    <label class="field">Next review
      <input type="datetime-local" {...utcDateTimeInputAttributes} bind:value={reviewDueAt} disabled={busy || uncertain} />
    </label>
    <button type="submit" class="btn" disabled={busy || uncertain || changedEvidence || !disposition || !rationale.trim() || (needsExpiry && !expiresAt)}>{busy ? 'Saving…' : 'Record decision'}</button>
  </form>
  <small>Times use this device’s timezone and are stored as UTC. Material evidence changes or expiry reopen the item; earlier rationale remains historical.</small>
  {#if message}<p class="message" bind:this={statusElement} tabindex="-1" role="status" aria-live="polite">{message}</p>{/if}
  {/if}
</details>

<style>
  .lifecycle-controls{min-width:0;margin-top:8px;padding-top:7px;border-top:1px solid var(--border);color:var(--muted);font-size:var(--text-xs)}
  summary{min-height:24px;align-content:center;cursor:pointer;color:var(--text);font:650 var(--text-xs) var(--mono);overflow-wrap:anywhere}
  summary span{margin-left:6px;padding:1px 6px;border:1px solid var(--amber);border-radius:99px;color:var(--amber);font-size:var(--text-2xs)}
  .lifecycle-reason,.last-decision,.retained-rationale,.message{margin:7px 0 0;line-height:1.45;overflow-wrap:anywhere}
  .retained-rationale{padding:7px;border-left:2px solid var(--border);background:var(--panel)}
  .decision-history{margin-top:8px}.decision-history ol{display:grid;gap:8px;padding-left:22px}.decision-history li{min-width:0;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm)}.decision-history p{margin:0;overflow-wrap:anywhere}.decision-history p+p{margin-top:5px}
  .decision-grid{--grid-min:13rem;--grid-gap:7px;align-items:end;margin-top:10px}
  select,textarea,input,button{min-width:0}button:disabled{cursor:not-allowed;opacity:.55}
  button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  small{display:block;margin-top:8px;line-height:1.4}.message{color:var(--accent)}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  @media(max-width:640px){select,textarea,input,button,summary{min-height:44px}}
</style>
