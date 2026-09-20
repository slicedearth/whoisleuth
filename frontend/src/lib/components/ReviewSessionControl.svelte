<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { ReviewSessionPosition, ReviewSessionRecord } from '../../../../packages/contracts/review-session-contract.mts';
  import { discardReviewSession, loadReviewSession, saveReviewSession } from '../review-session.ts';
  import { failedLocalMutationOutcome } from '../local-mutation-outcome.ts';

  let { position, onresume, resumeRequested = false }: { position: ReviewSessionPosition; onresume: (saved: ReviewSessionPosition) => Promise<string>; resumeRequested?: boolean } = $props();
  let saved = $state<ReviewSessionRecord | null>(null);
  let ready = $state(false), busy = $state(false), message = $state('');
  let expanded = $state(false);
  let saveButton = $state<HTMLButtonElement>();
  let alive = true;
  onMount(() => { expanded = resumeRequested; void load().then(() => { if (alive && resumeRequested && ready && saved) void resume(); }); return () => { alive = false; }; });
  async function load() {
    busy = true;
    try { const record = await loadReviewSession(); if (alive) { saved = record; ready = true; message = ''; } }
    catch { if (alive) { ready = false; message = 'Saved review position could not be read. Your current view is unchanged.'; } }
    finally { if (alive) busy = false; }
  }
  async function save() {
    busy = true;
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
    busy = true;
    try { const result = await onresume(saved); if (alive) message = result; }
    catch { if (alive) message = 'The saved position could not be restored. No review was submitted.'; }
    finally { if (alive) busy = false; }
  }
  async function discard() {
    if (!saved) return;
    busy = true;
    let discarded = false;
    try { await discardReviewSession(saved); if (alive) { saved = null; discarded = true; message = 'Saved position and its review-form copies removed. Cases and currently open forms are unchanged.'; } }
    catch (cause) { if (alive) { if (failedLocalMutationOutcome(cause) === 'unknown') ready = false; message = cause instanceof Error ? cause.message : 'The saved review position could not be removed.'; } }
    finally { if (alive) { busy = false; await tick(); if (discarded) saveButton?.focus(); } }
  }
</script>

<details class="review-session" bind:open={expanded}>
  <summary>Review position{saved ? ' · saved' : ''}</summary>
  <p class="notice">Keep the current filters, selected item and unfinished review forms for a later visit. Case drafts recover separately; no collection or decision is replayed.</p>
  {#if saved}<p class="notice">Saved <time datetime={saved.updatedAt}>{new Date(saved.updatedAt).toLocaleString()}</time>.</p>{/if}
  <div class="toolbar">
    <button class="btn" type="button" bind:this={saveButton} disabled={!ready || busy} onclick={() => void save()}>Save current position</button>
    {#if saved}
      <button class="btn" type="button" disabled={!ready || busy} onclick={() => void resume()}>Resume saved review</button>
      <button class="btn" type="button" disabled={!ready || busy} onclick={() => void discard()}>Discard saved position and forms</button>
    {/if}
    <button class="btn" type="button" disabled={busy} onclick={() => void load()}>Reload saved position</button>
  </div>
  <p role="status">{busy ? 'Updating review position…' : message}</p>
</details>

<style>.review-session{margin-block:12px}.toolbar{display:flex;flex-wrap:wrap;gap:8px}</style>
