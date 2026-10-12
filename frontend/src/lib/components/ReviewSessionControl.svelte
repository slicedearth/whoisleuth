<script lang="ts">
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import { onMount, tick } from 'svelte';
  import type { ReviewSessionPosition, ReviewSessionRecord } from '../../../../packages/contracts/review-session-contract.mts';
  import type { ReviewSessionResumeBriefing } from '../../../../packages/workspace/review-session.mts';
  import { ANALYST_REVIEW_QUEUE_OPTIONS } from '../../../../packages/contracts/analyst-review-state-contract.mts';
  import { discardReviewSession, loadReviewSession, saveReviewSession } from '../review-session.ts';
  import { failedLocalMutationOutcome } from '../local-mutation-outcome.ts';

  let { position, onresume, resumeRequested = false }: {
    position: ReviewSessionPosition;
    onresume: (saved: ReviewSessionPosition) => Promise<{ message: string; briefing?: ReviewSessionResumeBriefing }>;
    resumeRequested?: boolean;
  } = $props();
  let saved = $state<ReviewSessionRecord | null>(null);
  let ready = $state(false), busy = $state(false), message = $state('');
  let expanded = $state(false);
  let resumed = $state.raw<{ checkpoint: ReviewSessionRecord; briefing: ReviewSessionResumeBriefing } | null>(null);
  let saveButton = $state<HTMLButtonElement>();
  let alive = true;
  onMount(() => { expanded = resumeRequested; void load().then(() => { if (alive && resumeRequested && ready && saved) void resume(); }); return () => { alive = false; }; });
  async function load() {
    busy = true; resumed = null;
    try { const record = await loadReviewSession(); if (alive) { saved = record; ready = true; message = ''; } }
    catch { if (alive) { ready = false; message = 'Saved review position could not be read. Your current view is unchanged.'; } }
    finally { if (alive) busy = false; }
  }
  async function save() {
    busy = true; resumed = null;
    try { const record = await saveReviewSession(position, saved); if (alive) { saved = record; message = 'Review position saved in this workspace. Later navigation does not update this checkpoint.'; } }
    catch (cause) {
      if (alive) {
        if (failedLocalMutationOutcome(cause) === 'unknown') ready = false;
        message = cause instanceof Error ? cause.message : 'The review position could not be saved.';
      }
    } finally { if (alive) busy = false; }
  }
  async function resume() {
    if (!saved) return;
    const checkpoint = saved;
    busy = true; resumed = null;
    try {
      const result = await onresume(checkpoint);
      if (alive) { message = result.message; resumed = result.briefing ? { checkpoint, briefing: result.briefing } : null; }
    }
    catch { if (alive) message = 'The saved position could not be restored. No review was submitted.'; }
    finally { if (alive) busy = false; }
  }
  async function discard() {
    if (!saved) return;
    busy = true; resumed = null;
    let discarded = false;
    try { await discardReviewSession(saved); if (alive) { saved = null; discarded = true; message = 'Saved position and its review-form copies removed. Cases and currently open forms are unchanged.'; } }
    catch (cause) { if (alive) { if (failedLocalMutationOutcome(cause) === 'unknown') ready = false; message = cause instanceof Error ? cause.message : 'The saved review position could not be removed.'; } }
    finally { if (alive) { busy = false; await tick(); if (discarded) saveButton?.focus(); } }
  }
</script>

<details class="review-session" bind:open={expanded}>
  <summary>Pause and resume review <span class="checkpoint-state">{#if ready}{#if saved}Saved <time datetime={saved.updatedAt}>{formatEvidenceDate(saved.updatedAt)}</time>{:else}No saved checkpoint{/if}{:else}{busy ? 'Loading saved checkpoint…' : 'Saved checkpoint unavailable'}{/if}</span></summary>
  <p class="notice">Save your place before leaving. This keeps the current filters, selected item and copies of unfinished review forms in this workspace. It does not submit those forms. Case drafts recover separately.</p>
  <div class="checkpoint-preview">
    <section aria-label="Current review position"><h4>Current review</h4><p>Current filters · {position.selected ? 'one selected item' : 'no selected item'} · {position.drafts.length} unfinished review {position.drafts.length === 1 ? 'form' : 'forms'}.</p></section>
    {#if ready && saved}<section aria-label="Saved review checkpoint"><h4>Saved for later</h4><p>Saved filters · {saved.selected ? 'one selected item' : 'no selected item'} · {saved.drafts.length} review-form {saved.drafts.length === 1 ? 'copy' : 'copies'}.</p><p>Later navigation and edits do not update this checkpoint. Resuming checks current evidence and keeps newer open drafts.</p></section>{/if}
  </div>
  <div class="toolbar">
    <button class="btn" type="button" bind:this={saveButton} disabled={!ready || busy} onclick={() => void save()}>Save current position</button>
    {#if saved}
      <button class="btn" type="button" disabled={!ready || busy} onclick={() => void resume()}>Resume saved review</button>
      <button class="btn" type="button" disabled={!ready || busy} onclick={() => void discard()}>Discard saved position and forms</button>
    {/if}
    <button class="btn" type="button" disabled={busy} onclick={() => void load()}>Reload saved position</button>
  </div>
  <p role="status">{busy ? 'Updating review position…' : message}</p>
  {#if resumed}
    {@const checkpoint = resumed.checkpoint}
    {@const briefing = resumed.briefing}
    <section class="resume-briefing" aria-label="Return-to-work briefing">
      <h4>Return-to-work briefing</h4>
      <p>Results when you resumed the checkpoint saved {formatEvidenceDate(checkpoint.updatedAt)}.</p>
      <dl>
        <div><dt>Saved queue</dt><dd>{ANALYST_REVIEW_QUEUE_OPTIONS.find(option => option.value === checkpoint.filters.queue)?.label}{checkpoint.filters.attentionOnly ? ' · attention filter applied' : ''}</dd></div>
        {#if checkpoint.filters.caseQuery}<div><dt>Saved Case search</dt><dd>{checkpoint.filters.caseQuery}</dd></div>{/if}
        {#if checkpoint.filters.focusedCaseId}<div><dt>Saved Case scope</dt><dd>{checkpoint.filters.focusedCaseId}</dd></div>{/if}
        <div><dt>Selected review</dt><dd>{briefing.currentTitle ?? 'No current review selected'} · {briefing.selected.state.replaceAll('_', ' ')}</dd></div>
        <div><dt>Matching retained items</dt><dd>{briefing.matchingItems} at resume, not a count of newly collected evidence</dd></div>
        <div><dt>Drafts</dt><dd>{briefing.restoredDrafts} restored from the checkpoint · {briefing.keptOpenDrafts} already-open forms kept</dd></div>
        {#if briefing.uncertainDrafts}<div><dt>Unconfirmed decisions</dt><dd>{briefing.uncertainDrafts} {briefing.uncertainDrafts === 1 ? 'form still requires' : 'forms still require'} review of the saved record before another submission</dd></div>{/if}
      </dl>
      <details><summary>What this checkpoint can compare</summary><p>The selected item's material fingerprint can identify changed retained context, but does not keep earlier evidence values or a written investigation question. Unavailable items may be filtered, outside the admitted results, or removed; this does not establish deletion. Inspect the current item and unfinished forms before deciding.</p></details>
    </section>
  {/if}
</details>

<style>
  .review-session{margin-block:12px;min-width:0}
  summary{min-height:44px;overflow-wrap:anywhere}
  .checkpoint-state{display:inline-block;margin-inline-start:8px;color:var(--muted);font:400 var(--text-sm)/1.5 var(--font-sans)}
  .checkpoint-preview{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-block:16px}
  .checkpoint-preview section{min-width:0;line-height:1.6;overflow-wrap:anywhere}
  .checkpoint-preview h4{margin:0 0 4px;font:650 var(--text-sm)/1.5 var(--font-sans)}
  .checkpoint-preview p{margin:0 0 8px;font-size:var(--text-sm)}
  .toolbar{display:flex;flex-wrap:wrap;gap:8px}
  .resume-briefing{min-width:0;margin-block:16px;font-size:var(--text-sm);line-height:1.6}.resume-briefing h4{margin:0}.resume-briefing p{margin-block:6px;color:var(--muted)}.resume-briefing dl{display:grid;gap:8px}.resume-briefing dl>div{display:grid;grid-template-columns:minmax(0,12rem) minmax(0,1fr);gap:8px}.resume-briefing dt{color:var(--muted)}.resume-briefing dd{margin:0;overflow-wrap:anywhere}.resume-briefing summary{cursor:pointer}
  @media(max-width:640px){.checkpoint-preview{grid-template-columns:1fr}}
  @media(max-width:640px){.resume-briefing dl>div{grid-template-columns:minmax(0,1fr);gap:0}}
</style>
