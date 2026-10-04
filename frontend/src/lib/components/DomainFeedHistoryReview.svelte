<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import { downloadLocalFile } from '#lib/download-local-file.ts';
  import {
    DomainFeedHistoryController,
    parseDomainFeedHistoryCursor,
    type DomainFeedHistoryState,
  } from '#lib/controllers/domain-feed-history.ts';
  import type { PreparedDomainFeedReview } from '#lib/domain-feed-client.ts';
  import type { DomainFeedCursor } from '../../../../packages/monitoring/domain-feed-history.mts';
  import type { DomainFeedSelection } from '../../../../packages/monitoring/domain-feed.mts';

  let {
    feedId,
    getselection,
    getcontext,
    onstage,
    onstart,
    disabled = false,
  }: {
    feedId: string;
    getselection: () => DomainFeedSelection;
    getcontext: () => string;
    onstage: (reviews: readonly PreparedDomainFeedReview[], context: string) => void;
    onstart: () => void;
    disabled?: boolean;
  } = $props();
  let reviewState = $state<DomainFeedHistoryState>({ page: null, busy: false, message: '' });
  let cursorText = $state(''),
    message = $state(''),
    openedContext = $state(''),
    status = $state<HTMLParagraphElement>();
  const controller = new DomainFeedHistoryController({
    context: () => getcontext(),
    publish: (value) => {
      reviewState = value;
    },
    stage: (reviews, context) => onstage(reviews, context),
  });
  const page = $derived(reviewState.page?.history);
  $effect(() => {
    const next = getcontext();
    if (openedContext !== next) {
      openedContext = next;
      controller.changed();
      cursorText = '';
      message = '';
    }
  });
  onDestroy(() => controller.dispose());
  async function load(cursor: DomainFeedCursor | null, fromText = false) {
    if (disabled || reviewState.busy) return;
    message = '';
    try {
      const selection = getselection();
      const selectedCursor = fromText
        ? parseDomainFeedHistoryCursor(cursorText, feedId, selection)
        : cursor;
      onstart();
      await controller.load(feedId, selection, selectedCursor);
    } catch (cause) {
      message =
        cause instanceof Error ? cause.message : 'The history selection or cursor is invalid.';
    }
    await tick();
    status?.focus();
  }
  function download() {
    if (!page || reviewState.busy || disabled) return;
    downloadLocalFile(
      new Blob([JSON.stringify(page.nextCursor, null, 2)], { type: 'application/json' }),
      `whoisleuth-domain-feed-${feedId}-cursor.json`,
    );
    message =
      page.state === 'gap'
        ? 'Gap acknowledged in the downloaded progress cursor. No missing membership was inferred.'
        : 'Progress after this reviewed page downloaded. No browser cursor or candidates were saved automatically.';
  }
  async function cancel() {
    controller.cancel();
    await tick();
    status?.focus();
  }
</script>

<details class="feed-history">
  <summary>Retained editions and catch-up</summary>
  <p
    >Explicitly review retained source editions in bounded pages. Starting or continuing shares only
    the source, selected positive/negative literals, exact hostnames and cursor with the configured
    feed service. No candidate target is contacted.</p
  >
  <button class="btn" onclick={() => void load(null)} disabled={disabled || reviewState.busy}
    >Start retained-edition review</button
  >
  <details
    ><summary>Resume from a saved cursor</summary>
    <label
      >Saved feed cursor<textarea
        bind:value={cursorText}
        maxlength="4096"
        rows="4"
        disabled={disabled || reviewState.busy}></textarea></label
    >
    <p
      >A cursor binds the source, retained cache and matching rules, not a Brand identity, campaign
      revision or decision. It may include the last reviewed hostname. Reuse requires the same
      rules; changed or replaced history is not silently skipped.</p
    >
    <button
      class="btn"
      onclick={() => void load(null, true)}
      disabled={disabled || reviewState.busy || !cursorText.trim()}
      >Resume retained-edition review</button
    >
  </details>
  {#if reviewState.busy}<p role="status"
      >Reading one retained edition page. The last reviewed cursor remains unchanged.</p
    ><button class="btn" onclick={() => void cancel()}>Cancel history request</button>{/if}
  {#if message || reviewState.message}<p
      bind:this={status}
      role="status"
      tabindex="-1"
      aria-label="Feed history review status">{message || reviewState.message}</p
    >{/if}
  {#if page}<section aria-label="Retained feed history">
      <h4>Review position {page.sequence} · retained range through edition {page.through}</h4>
      {#if page.earlierEditionsUnavailable}<p
          >Earlier editions are no longer retained. This history cannot establish complete past
          coverage.</p
        >{/if}
      {#if page.state === 'gap'}<p
          >Membership for editions {page.sequence}–{page.nextCursor.sequence - 1} is unavailable. Acknowledging
          this gap records progress only; it does not establish absence or removal.</p
        >
      {:else if page.state === 'review'}<p
          >{page.review?.matches.length} nominations staged below from edition {page.sequence}{page
            .review?.truncated
            ? '; further matching hostnames remain in this edition'
            : ''}. Select individuals to retain, or deliberately leave them unretained before
          advancing. Existing retained and dismissed candidates are not removed.</p
        >
      {:else}<p
          >All pages in this reviewed retained range are complete, not a claim of complete source
          coverage. Check explicitly for newer retained editions when ready.</p
        >{/if}
      <details
        ><summary>Dated source editions ({page.editions.length})</summary>
        <ol
          >{#each page.editions as edition}<li
              >Edition {edition.sequence}: {edition.metadata.revision}<br />Publisher date {formatEvidenceDate(
                edition.metadata.declaredPublishedAt,
                'unknown',
              )}; acquired {formatEvidenceDate(edition.metadata.acquiredAt, 'unknown')}; imported {formatEvidenceDate(
                edition.metadata.importedAt,
              )}. Declared version {edition.metadata.declaredVersion || 'unknown'}. {edition.metadata.rows.toLocaleString()}
              rows; {edition.metadata.bytes.toLocaleString()} bytes. {edition.membershipRetained
                ? 'Membership retained.'
                : 'Membership unavailable; metadata only.'}</li
            >{/each}</ol
        >
      </details>
      <details
        ><summary>Retained refresh outcomes ({page.attempts?.length ?? 'unavailable'})</summary>
        {#if page.attempts === null}<p
            >Refresh history could not be read. The source editions above were checked separately.</p
          >
        {:else if page.attempts.length}<ol
            >{#each page.attempts as attempt}<li
                >{formatEvidenceDate(attempt.at)}: {attempt.outcome.replaceAll('-', ' ')}</li
              >{/each}</ol
          >{:else}<p
            >No refresh attempts are retained in this reply. No success or continuity is inferred.</p
          >{/if}
        <p
          >Refresh outcomes describe the optional feed cache, not target activity. Unchanged
          acquisitions do not invent another source edition.</p
        >
      </details>
      <div class="actions">
        <button
          class="btn"
          onclick={() => void load(page.nextCursor)}
          disabled={disabled || reviewState.busy}
          >{page.state === 'gap'
            ? 'Acknowledge gap and continue'
            : page.state === 'complete'
              ? 'Check for newer retained editions'
              : 'Continue after reviewing this page'}</button
        >
        <button class="btn" onclick={download} disabled={disabled || reviewState.busy}
          >{page.state === 'gap'
            ? 'Acknowledge gap and download progress'
            : 'Download progress after reviewed page'}</button
        >
      </div>
      <p
        >Progress is held in page memory until deliberately downloaded. A failed request or staging
        failure cannot advance it. Advancing or downloading does not retain unchecked nominations,
        start monitoring or alter prior decisions.</p
      >
    </section>{/if}
</details>

<style>
  .feed-history,
  section,
  details {
    min-width: 0;
  }
  .feed-history {
    margin-block: 16px;
  }
  summary {
    cursor: pointer;
    overflow-wrap: anywhere;
  }
  p,
  li,
  h4,
  label {
    overflow-wrap: anywhere;
  }
  label {
    display: grid;
    gap: 6px;
    margin-block: 12px;
  }
  textarea {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
  }
  ol {
    padding-inline-start: 24px;
  }
  li {
    margin-block: 12px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-block: 12px;
  }
  .btn {
    min-width: 0;
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
  }
</style>
