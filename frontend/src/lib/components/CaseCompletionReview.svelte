<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { CaseRecord } from '../../../../packages/cases/case-record-contracts.mts';
  import { buildCaseCompletionReview, caseCompletionNextActions, type CaseCompletionReviewTarget } from '../../../../packages/cases/case-decision-overview.mts';
  import { caseRecheckEvidence } from '#lib/analysis/case-evidence-presentation.ts';
  import { inspectRetainedCaseOriginals } from '#lib/case-review-package.ts';
  import { evidenceTime } from '#lib/analysis/evidence-time.ts';
  import type { CaseWorkspaceSection } from '#lib/analysis/case-response-stage.ts';
  import { reviewClock } from '#lib/review-clock.ts';
  import Pagination from './Pagination.svelte';

  let {
    record,
    visible,
    selectSection,
  }: {
    record: CaseRecord;
    visible: boolean;
    selectSection: (section: CaseWorkspaceSection) => void | Promise<void>;
  } = $props();
  const review = $derived(buildCaseCompletionReview(record, new Date($reviewClock).toISOString()));
  const nextReviews = $derived(caseCompletionNextActions(review, record.attachments?.length ?? 0));
  let reviewBody = $state<HTMLDivElement>();
  let reviewGeneration = 0;
  let requestsExpanded = $state(false);
  let expanded = $state(false),
    busy = $state(false),
    error = $state('');
  let files = $state.raw<Awaited<ReturnType<typeof inspectRetainedCaseOriginals>> | null>(null);
  let controller: AbortController | null = null;
  type ListId = CaseCompletionReviewTarget | 'scopes';
  const pageSize = 10;
  let pages = $state<Partial<Record<ListId, number>>>({});
  const currentPage = (count: number, id: ListId) =>
    Math.min(pages[id] ?? 1, Math.max(1, Math.ceil(count / pageSize)));
  const visibleRows = <T,>(rows: readonly T[], id: ListId) =>
    rows.slice(
      (currentPage(rows.length, id) - 1) * pageSize,
      currentPage(rows.length, id) * pageSize,
    );

  function resetFiles() {
    controller?.abort();
    controller = null;
    busy = false;
    files = null;
    error = '';
  }
  $effect(() => {
    record;
    visible;
    resetFiles();
    pages = {};
    reviewGeneration += 1;
    requestsExpanded = false;
    if (!visible) expanded = false;
  });
  onDestroy(() => { reviewGeneration += 1; resetFiles(); });

  async function openReview(target: CaseCompletionReviewTarget) {
    if (!visible) return;
    const generation = reviewGeneration, selected = record;
    expanded = true;
    if (target === 'requests') requestsExpanded = true;
    await tick();
    if (!visible || !expanded || generation !== reviewGeneration || record !== selected) return;
    const heading = reviewBody?.querySelector<HTMLElement>(`[data-completion-section="${target}"]`);
    heading?.focus();
  }

  async function checkOriginals() {
    if (busy || !visible || !expanded) return;
    resetFiles();
    const current = new AbortController();
    controller = current;
    busy = true;
    try {
      const result = await inspectRetainedCaseOriginals(record, current.signal);
      if (controller === current && !current.signal.aborted) files = result;
    } catch (cause) {
      if (controller === current && !current.signal.aborted)
        error =
          cause instanceof Error
            ? cause.message
            : 'The referenced files could not be checked. No saved work changed.';
    } finally {
      if (controller === current) {
        controller = null;
        busy = false;
      }
    }
  }
</script>

{#snippet pagination(count: number, id: ListId, label: string)}
  <Pagination
    currentPage={currentPage(count, id)}
    pageCount={Math.ceil(count / pageSize)}
    setPage={(page) => (pages[id] = page)}
    ariaLabel={label}
  />
{/snippet}

{#snippet nextAction(action: (typeof nextReviews.actions)[number])}
  <li>
    <button class="btn small" type="button" onclick={() => void openReview(action.id)}>{action.label}</button>
    <p>{action.reason}</p>
    <details><summary>What this review can tell you</summary>
      <p>{action.expectedOutcome}</p><p>{action.prerequisite}</p><p>{action.limitation}</p>
    </details>
  </li>
{/snippet}

<section class="next-reviews" aria-label="Next reviews before pausing or closing this Case">
  <h3>Before pausing or closing this Case</h3>
  {#if nextReviews.actions.length}
    <p>Start with these saved-record reviews. Opening a review does not collect data, read file bodies or change the Case.</p>
    <ol>{#each nextReviews.actions as action (action.id)}{@render nextAction(action)}{/each}</ol>
    {#if nextReviews.further.length}<details><summary>More completion reviews · {nextReviews.further.length}</summary>
      <ol start={nextReviews.actions.length + 1}>{#each nextReviews.further as action (action.id)}{@render nextAction(action)}{/each}</ol>
    </details>{/if}
  {:else}<p>No matching completion items are recorded. This is not confirmation that the investigation is complete or ready to close.</p>{/if}
</section>

<details
  class="completion-review"
  bind:open={expanded}
  ontoggle={() => {
    if (!expanded) resetFiles();
  }}
>
  <summary>Case completion review</summary>
  {#if expanded}
    <div bind:this={reviewBody} class="review-body" role="region" aria-label="Case completion review">
      <p
        >Review what remains before pausing or closing this Case. This summary does not change its
        status or replace your closure decision.</p
      >
      <section aria-label="Open incident objects">
        <h4 tabindex="-1" data-completion-section="objects">Open incident objects · {review.openObjects.length}</h4>
        {#if review.openObjects.length}<ul
            >{#each visibleRows(review.openObjects, 'objects') as row (JSON.stringify(row.object))}<li
                ><code>{row.object.identifier}</code><small
                  >{row.object.kind.replaceAll('_', ' ')} · analyst-recorded open link</small
                ></li
              >{/each}</ul
          >{@render pagination(review.openObjects.length, 'objects', 'Open incident object pages')}
        {:else}<p
            >No current incident links are recorded as open. This does not establish removal.</p
          >{/if}
        {#if review.otherObjects.length}<details
            ><summary>Other retained scopes · {review.otherObjects.length}</summary><p
              >Domain, hostname and historical objects have no matching current incident-link state.
              Their reviews and closures remain separate.</p
            ><ul
              >{#each visibleRows(review.otherObjects, 'scopes') as row (JSON.stringify(row.object))}<li
                  ><code>{row.object.identifier}</code><small
                    >{row.object.kind.replaceAll('_', ' ')}</small
                  ></li
                >{/each}</ul
            >{@render pagination(
              review.otherObjects.length,
              'scopes',
              'Other retained scope pages',
            )}</details
          >{/if}
        <p>Review exact-object histories under Classification and incident links in this summary.</p
        >
      </section>
      <section aria-label="Contrary or unresolved evidence">
        <h4 tabindex="-1" data-completion-section="claims">Contrary or unresolved evidence · {review.opposingClaims.length} assessment{review.opposingClaims.length === 1 ? '' : 's'}</h4>
        {#if review.opposingClaims.length}<ul
            >{#each visibleRows(review.opposingClaims, 'claims') as claim (claim.assertion.id)}<li
                ><strong>{claim.assertion.statement}</strong><ul
                  >{#each claim.references as reference (reference.id)}<li
                      >{reference.stance === 'contradicts' ? 'Contrary' : 'Unresolved'} · {reference
                        .pin?.label ?? `Unavailable pin: ${reference.id}`}</li
                    >{/each}</ul
                ></li
              >{/each}</ul
          >{@render pagination(review.opposingClaims.length, 'claims', 'Assessment review pages')}
        {:else}<p>No contrary or unresolved links are recorded against an open assessment.</p>{/if}
        <button class="btn small" type="button" onclick={() => void selectSection('assessment')}
          >Review assessments</button
        >
      </section>
      <section aria-label="Incomplete or undated observations">
        <h4 tabindex="-1" data-completion-section="gaps">Incomplete or undated observations · {review.evidenceGaps.length}</h4>
        {#if review.evidenceGaps.length}<ul>{#each visibleRows(review.evidenceGaps, 'gaps') as pin (pin.id)}<li>
          <strong>{pin.label}</strong><small>{pin.source} · {caseRecheckEvidence(pin).completeness} · {evidenceTime(pin.observedAt)?.readable ?? 'Observation time unavailable'}{#if pin.truncated} · truncated{/if}</small>
          {#if pin.limitations.length}<p>{pin.limitations.join(' ')}</p>{/if}
        </li>{/each}</ul>{@render pagination(review.evidenceGaps.length, 'gaps', 'Observation gap pages')}
        {:else}<p>No retained pin matches this incomplete-or-undated check. Uncollected evidence remains unknown.</p>{/if}
        <button class="btn small" type="button" onclick={() => void selectSection('evidence')}>Review retained observations</button>
      </section>
      <section aria-label="Referenced original files">
        <h4 tabindex="-1" data-completion-section="files">Referenced files · {record.attachments?.length ?? 0}</h4>
        <p
          >References alone do not confirm that original or derived files are available. Check the
          current workspace's bytes explicitly.</p
        >
        <button
          class="btn small"
          type="button"
          disabled={busy || !record.attachments?.length}
          onclick={() => void checkOriginals()}
          >{busy ? 'Checking referenced files…' : 'Check referenced files'}</button
        >
        <div role="status" aria-label="Case original-file check" aria-busy={busy}>
          {#if files}<p
              >{files.verified} of {files.expected} distinct files verified · {files.missing} missing
              · {files.unverified} unverified.</p
            ><p
              >Verification checks size and SHA-256 against each retained reference. It does not
              verify source declarations or content accuracy.</p
            >
          {:else if busy}<p>Reading and verifying bounded groups of retained files…</p>
          {:else}<p
              >{record.attachments?.length
                ? 'Original-file availability has not been checked.'
                : 'No file references are recorded.'}</p
            >{/if}
        </div>
        {#if files?.checklist.length}<ul
            >{#each visibleRows(files.checklist, 'files') as file (file.digestSha256)}<li
                ><strong
                  >{file.state === 'missing'
                    ? 'Missing bytes'
                    : 'Unverified — storage could not be read'}</strong
                ><code>{file.digestSha256}</code><small
                  >{file.byteLength.toLocaleString('en-AU')} expected bytes</small
                ><ul
                  >{#each file.references as reference (reference.attachment.id)}<li
                      >{reference.attachment.fileName} · reference {reference.attachment.id}</li
                    >{/each}</ul
                ></li
              >{/each}</ul
          >{@render pagination(files.checklist.length, 'files', 'Original-file review pages')}{/if}
        {#if error}<p role="alert">{error}</p>{/if}
        <button class="btn small" type="button" onclick={() => void selectSection('evidence')}
          >Review retained files</button
        >
      </section>
      <section aria-label="Remaining follow-up commitments">
        <h4 tabindex="-1" data-completion-section="reviews">Follow-up commitments</h4>
        {#if review.reviews.length}<ul
            >{#each visibleRows(review.reviews, 'reviews') as item (item.id)}<li
                ><strong
                  >{item.kind === 'action'
                    ? 'Action due'
                    : item.kind === 'recheck'
                      ? 'Independent recheck'
                      : 'Response follow-up'}</strong
                >
                · {item.label}<small
                  >{evidenceTime(item.at)?.readable} · {item.due === null
                    ? 'Current time unavailable'
                    : item.due
                      ? 'Due now'
                      : 'Upcoming'}</small
                ></li
              >{/each}</ul
          >{@render pagination(
            review.reviews.length,
            'reviews',
            'Follow-up commitment pages',
          )}{:else}<p>No dated review commitment is retained.</p>{/if}
        {#if review.requests.length}<details bind:open={requestsExpanded}
            ><summary data-completion-section="requests">Undelivered evidence requests · {review.requests.length}</summary><ul
              >{#each visibleRows(review.requests, 'requests') as item (JSON.stringify([item.actionId, item.eventId]))}<li
                  ><strong>{item.label}</strong> · {item.recipient}<p>{item.request.summary}</p
                  ><small
                    >{item.deadline
                      ? `Provider deadline: ${evidenceTime(item.deadline)?.readable}`
                      : 'No provider deadline recorded'}</small
                  ></li
                >{/each}</ul
            >{@render pagination(
              review.requests.length,
              'requests',
              'Undelivered request pages',
            )}</details
          >{/if}
        <button class="btn small" type="button" onclick={() => void selectSection('response')}
          >Review response and closure</button
        >
      </section>
    </div>
  {/if}
</details>

<style>
  .completion-review,
  .review-body,
  section,
  li {
    min-width: 0;
  }
  .completion-review {
    border-block: 1px solid var(--border);
  }
  .next-reviews { padding-bottom: 14px; }
  .next-reviews h3 { margin: 0; font-size: var(--text-sm); }
  .next-reviews ol { display: grid; gap: 12px; margin: 0; padding-left: 20px; }
  .next-reviews li { display: grid; gap: 4px; }
  [data-completion-section]:focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
  summary {
    min-height: 44px;
    padding-block: 10px;
    cursor: pointer;
    font: 650 var(--text-xs)/1.5 var(--font-sans);
    overflow-wrap: anywhere;
  }
  .review-body {
    display: grid;
    gap: 18px;
    padding-block: 8px 18px;
  }
  section {
    display: grid;
    gap: 8px;
    border-top: 1px solid var(--border);
    padding-top: 14px;
  }
  h4,
  p {
    margin: 0;
  }
  h4 {
    font-size: var(--text-sm);
  }
  p,
  li,
  small {
    font-size: var(--text-xs);
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  p,
  small {
    color: var(--muted);
  }
  ul {
    margin: 0;
    padding-left: 20px;
    display: grid;
    gap: 8px;
  }
  li > small,
  li > code {
    display: block;
  }
  code {
    white-space: normal;
    overflow-wrap: anywhere;
    font-size: var(--text-2xs);
  }
  .btn {
    justify-self: start;
    max-width: 100%;
    white-space: normal;
  }
  [role='alert'] {
    color: var(--danger);
  }
</style>
