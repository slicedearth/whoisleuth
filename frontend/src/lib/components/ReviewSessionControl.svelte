<script lang="ts">
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import { onMount, tick } from 'svelte';
  import type { ReviewSessionPosition, ReviewSessionRecord } from '../../../../packages/contracts/review-session-contract.mts';
  import type { ReviewSessionResumeBriefing } from '../../../../packages/workspace/review-session.mts';
  import { ANALYST_REVIEW_QUEUE_OPTIONS } from '../../../../packages/contracts/analyst-review-state-contract.mts';
  import { MAX_ANALYST_REVIEW_RATIONALE_LENGTH } from '../../../../packages/contracts/analyst-review-state-contract.mts';
  import { currentBrowserWorkspaceId } from '#lib/browser-workspace-context.ts';
  import { discardReviewSession, loadReviewSession, saveReviewSession } from '../review-session.ts';
  import { failedLocalMutationOutcome } from '../local-mutation-outcome.ts';

  let { position, onresume, resumeRequested = false }: {
    position: ReviewSessionPosition;
    onresume: (saved: ReviewSessionPosition, ownsRequest: () => boolean) => Promise<{ message: string; briefing?: ReviewSessionResumeBriefing }>;
    resumeRequested?: boolean;
  } = $props();
  let saved = $state<ReviewSessionRecord | null>(null);
  let ready = $state(false), busy = $state(false), message = $state('');
  let expanded = $state(false);
  let resumed = $state.raw<{ checkpoint: ReviewSessionRecord; briefing: ReviewSessionResumeBriefing } | null>(null);
  let saveButton = $state<HTMLButtonElement>();
  let question = $state(''), questionRevision = 0;
  let alive = true, generation = 0;
  function begin() {
    const request = ++generation, workspace = currentBrowserWorkspaceId();
    return () => alive && request === generation && workspace === currentBrowserWorkspaceId();
  }
  onMount(() => { expanded = resumeRequested; void load().then(() => { if (alive && resumeRequested && ready && saved) void resume(); }); return () => { alive = false; generation++; }; });
  async function load() {
    const current = begin();
    busy = true; resumed = null;
    try { const record = await loadReviewSession(); if (current()) { saved = record; ready = true; message = ''; } }
    catch { if (current()) { ready = false; message = 'Saved review position could not be read. Your current view is unchanged.'; } }
    finally { if (current()) busy = false; }
  }
  async function save() {
    const current = begin();
    busy = true; resumed = null;
    try { const record = await saveReviewSession({ ...position, question }, saved); if (current()) { saved = record; message = 'Review position saved in this workspace. Later navigation does not update this checkpoint.'; } }
    catch (cause) {
      if (current()) {
        if (failedLocalMutationOutcome(cause) === 'unknown') ready = false;
        message = cause instanceof Error ? cause.message : 'The review position could not be saved.';
      }
    } finally { if (current()) busy = false; }
  }
  async function resume() {
    if (!saved) return;
    const current = begin(), priorQuestion = questionRevision;
    const checkpoint = saved;
    busy = true; resumed = null;
    try {
      const result = await onresume(checkpoint, current);
      if (current()) {
        message = result.message; resumed = result.briefing ? { checkpoint, briefing: result.briefing } : null;
        if (result.briefing && priorQuestion === 0 && questionRevision === 0) question = checkpoint.question ?? '';
      }
    }
    catch { if (current()) message = 'The saved position could not be restored. No review was submitted.'; }
    finally { if (current()) busy = false; }
  }
  async function discard() {
    if (!saved) return;
    const current = begin();
    busy = true; resumed = null;
    let discarded = false;
    try { await discardReviewSession(saved); if (current()) { saved = null; discarded = true; message = 'Saved position and its review-form copies removed. Cases and currently open forms are unchanged.'; } }
    catch (cause) { if (current()) { if (failedLocalMutationOutcome(cause) === 'unknown') ready = false; message = cause instanceof Error ? cause.message : 'The saved review position could not be removed.'; } }
    finally { if (current()) { busy = false; await tick(); if (current() && discarded) saveButton?.focus(); } }
  }
</script>

<details class="review-session" bind:open={expanded}>
  <summary>Pause and resume review <span class="checkpoint-state">{#if ready}{#if saved}Saved <time datetime={saved.updatedAt}>{formatEvidenceDate(saved.updatedAt)}</time>{:else}No saved checkpoint{/if}{:else}{busy ? 'Loading saved checkpoint…' : 'Saved checkpoint unavailable'}{/if}</span></summary>
  <p class="notice">Save your place before leaving. This keeps your question, current filters, selected item, a small comparison baseline and copies of unfinished review forms in this workspace. It does not submit those forms. Case drafts recover separately.</p>
  <label class="question">Question for your next review (optional)<input type="text" bind:value={question} oninput={() => { questionRevision++; }} maxlength={MAX_ANALYST_REVIEW_RATIONALE_LENGTH} autocomplete="off" aria-describedby="review-question-retention"></label>
  <p id="review-question-retention" class="notice">Saved only when you save the current position, protected by this workspace's encryption when enabled, and excluded from backups and exports. Discarding the checkpoint removes its saved question and baseline.</p>
  <div class="checkpoint-preview">
    <section aria-label="Current review position"><h4>Current review</h4><p>Current filters · {position.selected ? 'one selected item' : 'no selected item'} · {position.drafts.length} unfinished review {position.drafts.length === 1 ? 'form' : 'forms'}.</p></section>
    {#if ready && saved}<section aria-label="Saved review checkpoint"><h4>Saved for later</h4><p>Saved filters · {saved.selected ? 'one selected item' : 'no selected item'} · {saved.drafts.length} review-form {saved.drafts.length === 1 ? 'copy' : 'copies'}.</p><p>Question: {saved.question === null ? 'Not retained by this older checkpoint' : saved.question || 'No question entered'}</p><p>Later navigation and edits do not update this checkpoint. Resuming checks current evidence and keeps newer open drafts.</p></section>{/if}
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
        <div><dt>Saved question</dt><dd>{checkpoint.question === null ? 'Not retained by this older checkpoint' : checkpoint.question || 'No question entered'}</dd></div>
        <div><dt>Saved queue</dt><dd>{ANALYST_REVIEW_QUEUE_OPTIONS.find(option => option.value === checkpoint.filters.queue)?.label}{checkpoint.filters.attentionOnly ? ' · attention filter applied' : ''}</dd></div>
        {#if checkpoint.filters.caseQuery}<div><dt>Saved Case search</dt><dd>{checkpoint.filters.caseQuery}</dd></div>{/if}
        {#if checkpoint.filters.focusedCaseId}<div><dt>Saved Case scope</dt><dd>{checkpoint.filters.focusedCaseId}</dd></div>{/if}
        <div><dt>Selected review</dt><dd>{briefing.currentTitle ?? 'No current review selected'} · {briefing.selected.state.replaceAll('_', ' ')}</dd></div>
        <div><dt>Matching retained items</dt><dd>{briefing.matchingItems} at resume, not a count of newly collected evidence</dd></div>
        <div><dt>Retained context comparison</dt><dd>{#if briefing.comparison.state === 'unknown'}No earlier baseline is available; a change count cannot be established.{:else}{briefing.comparison.unchanged} unchanged · {briefing.comparison.changed} changed · {briefing.comparison.newlyMatching} newly matching · {briefing.comparison.ambiguous} ambiguous · {briefing.comparison.unavailable} unavailable or not comparable{#if briefing.comparison.state === 'qualified'}<p>One view was incomplete, had unavailable sources, or used different source context. Counts cover only admitted subjects.</p>{/if}{/if}</dd></div>
        <div><dt>Drafts</dt><dd>{briefing.restoredDrafts} restored from the checkpoint · {briefing.keptOpenDrafts} already-open forms kept</dd></div>
        {#if briefing.uncertainDrafts}<div><dt>Unconfirmed decisions</dt><dd>{briefing.uncertainDrafts} {briefing.uncertainDrafts === 1 ? 'form still requires' : 'forms still require'} review of the saved record before another submission</dd></div>{/if}
      </dl>
      <details><summary>What this checkpoint can compare</summary><p>The baseline keeps subject identities, material fingerprints, source identities and completeness for this saved filtered view, not earlier evidence values. Newly matching means present in the current retained view, not newly collected. Unavailable subjects may be filtered, outside the admitted results, or removed; this does not establish deletion. Inspect the current items and unfinished forms before deciding.</p></details>
    </section>
  {/if}
</details>

<style>
  .review-session{margin-block:12px;min-width:0}
  .question{display:grid;gap:6px;max-width:52rem;min-width:0}.question input{min-width:0;width:100%}
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
