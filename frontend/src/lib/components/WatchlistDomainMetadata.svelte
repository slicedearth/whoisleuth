<script lang="ts">
  import { tick } from 'svelte';
  import Pagination from '$lib/components/Pagination.svelte';
  import { watchContextBrandDisplay, type WatchBrandNames } from '$lib/analysis/watchlist-context-labels';
  import { formatEvidenceDate } from '$lib/analysis/evidence-time';
  import type { WatchlistEntry } from '$lib/watchlists';
  import { updateWatchContexts } from '$lib/watchlists';
  import {
    WATCH_PRIORITIES,
    type WatchPriority,
  } from '../../../../packages/workspace/brand-candidate-workflow.mts';
  import { projectWatchlistContextReviews } from '../../../../packages/monitoring/watchlist-context-review.mts';
  import { analystReviewSubjectKey } from '../../../../packages/monitoring/analyst-review-state.mts';
  import {
    formatWatchlistValue,
    watchlistFieldLabel,
  } from '../../../../packages/workspace/watchlist-history.mts';
  let {
    name,
    entry,
    onrefresh,
    brandNames,
  }: { name: string; entry: WatchlistEntry; onrefresh: () => Promise<unknown>; brandNames: WatchBrandNames } = $props();
  const contextControlsId = $props.id();
  let filter = $state('all'),
    search = $state(''),
    page = $state(1),
    sort = $state<'priority' | 'domain'>('priority'),
    selected = $state<Set<string>>(new Set()),
    priority = $state<WatchPriority>('unassigned');
  let reason = $state(''),
    reviewDate = $state(''),
    busy = $state(false),
    message = $state(''),
    preview = $state(''),
    identity = $state('');
  const all = $derived(
    entry.domainMetadata.flatMap((metadata) =>
      metadata.contexts.map((context) => ({
        domain: metadata.domain,
        context,
        candidate: metadata.candidate,
        brand: watchContextBrandDisplay(context.brandProfileId, brandNames),
        key: `${metadata.domain}:${context.brandProfileId ?? ''}`,
      })),
    ),
  );
  const PAGE_SIZE = 200;
  let contextsHeading = $state<HTMLHeadingElement>();
  const filteredRows = $derived(
    all
      .filter((row) => (filter === 'all' || row.context.priority === filter) && (!search.trim() || `${row.domain} ${row.brand.label} ${row.context.brandProfileId ?? ''} ${row.context.reason}`.toLowerCase().includes(search.trim().toLowerCase())))
      .sort((a, b) =>
        sort === 'priority'
          ? (a.context.priority === 'unassigned' ? 5 : Number(a.context.priority.slice(1))) -
              (b.context.priority === 'unassigned' ? 5 : Number(b.context.priority.slice(1))) ||
            a.domain.localeCompare(b.domain)
          : a.domain.localeCompare(b.domain),
      ),
  );
  const pageCount = $derived(Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE)));
  const currentPage = $derived(Math.min(page, pageCount));
  const rows = $derived(filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE));
  $effect(() => { filter; search; sort; page = 1; });
  const chosen = $derived(all.filter((row) => selected.has(row.key)));
  const previewIdentity = $derived(
    JSON.stringify({
      name,
      selected: chosen.map((row) => ({ domain: row.domain, context: row.context })),
      priority,
      reason,
      reviewDate,
    }),
  );
  const reviews = $derived(
    projectWatchlistContextReviews({ [name]: entry }, new Date().toISOString()),
  );
  $effect(() => {
    if (identity !== name) {
      identity = name;
      selected = new Set();
      preview = '';
      reason = '';
      message = '';
      page = 1;
    }
  });
  function toggle(key: string, checked: boolean) {
    const next = new Set(selected);
    checked ? next.add(key) : next.delete(key);
    selected = next;
    preview = '';
  }
  async function setPage(value: number) {
    page = Math.max(1, Math.min(value, pageCount));
    await tick();
    contextsHeading?.focus();
  }
  async function save() {
    if (!preview || busy || !chosen.length) return;
    if (preview !== previewIdentity) {
      preview = '';
      message =
        'The selection, context or proposed reason changed. Preview the exact changes again.';
      return;
    }
    const submitted = [...chosen],
      selectedName = name,
      changedAt = new Date().toISOString();
    const input = {
      priority,
      reason,
      reviewDueAt: reviewDate ? new Date(`${reviewDate}T00:00:00Z`).toISOString() : null,
      changedAt,
    };
    busy = true;
    try {
      await updateWatchContexts(
        selectedName,
        submitted.map((row) => ({
          domain: row.domain,
          expected: row.context,
          input: { ...input, brandProfileId: row.context.brandProfileId },
        })),
      );
      if (name !== selectedName) return;
      message = `${submitted.length} exact domain contexts changed. Collection mode, cadence, evidence and other Brand contexts were not changed.`;
      preview = '';
      try {
        await onrefresh();
      } catch {
        message +=
          ' The write committed, but refreshing the visible watchlist failed. Reload before another edit.';
      }
    } catch (cause) {
      message =
        cause instanceof Error
          ? cause.message
          : 'The context edit failed; the draft remains available.';
    } finally {
      busy = false;
    }
  }
</script>

<section class="domain-metadata card" aria-labelledby="watch-context-title">
  <h3 id="watch-context-title" bind:this={contextsHeading} tabindex="-1">Domain watch reasons and priorities</h3>
  <p
    >{entry.domainMetadata.length} retained domains · {entry.results.length} latest observed results ·
    {entry.history.length} retained checks. Metadata-only domains have no invented successful scan or
    evidence baseline.</p
  >
  <p
    >Urgency, Risk, confidence, Case severity and collection cadence are separate. A due review date
    does not schedule a scan.</p
  >
  {#if message}<p role="status" aria-live="polite">{message}</p>{/if}
  <div class="toolbar"
    ><label>Search domain contexts<input type="search" bind:value={search} maxlength="300" /></label><label
      >Filter review priority<select bind:value={filter}
        ><option value="all">All priorities</option>{#each WATCH_PRIORITIES as option}<option
            value={option.value}>{option.label}</option
          >{/each}</select
      ></label
    ><label
      >Sort domain contexts<select bind:value={sort}
        ><option value="priority">Review priority</option><option value="domain">Domain</option
        ></select
      ></label
    ></div
  >
  <p
    >{rows.length} contexts shown on this page · {filteredRows.length} matching · {all.length} retained; {chosen.length} selected across pages and filters. Every bulk edit
    lists its exact selected contexts before saving.</p
  >
  <div class="metadata-grid"
    >{#each rows as row, index (row.key)}<article>
        <label
          ><input
            type="checkbox"
            aria-label={`${row.domain} — ${row.brand.label}`}
            aria-describedby={row.context.brandProfileId ? `${contextControlsId}-${index}` : undefined}
            checked={selected.has(row.key)}
            onchange={(event) => toggle(row.key, event.currentTarget.checked)}
            disabled={busy}
          /><strong>{row.domain}</strong></label
        >
        <p>{WATCH_PRIORITIES.find((option) => option.value === row.context.priority)?.label}</p>
        <p>{row.brand.label}</p>
        {#if row.context.brandProfileId}<details><summary>Exact Brand identity</summary><p id={`${contextControlsId}-${index}`}>{row.brand.description}</p></details>{/if}
        <p>Reason: {row.context.reason || 'Unassigned; historical evidence was not rewritten.'}</p>
        <p
          >Analyst changed: {formatEvidenceDate(row.context.changedAt, 'Unknown')} · next review: {formatEvidenceDate(row.context.reviewDueAt, 'Not set')}</p
        >
        {#if row.candidate}<details
            ><summary>Retained candidate source context</summary
            >{#each row.candidate.sources as source}<p
                >{source.observedHostname} · {source.source} · revision {source.revision ||
                  'unknown'} · interval {formatEvidenceDate(source.sourceFirstObservedAt)} to {formatEvidenceDate(source.sourceLastObservedAt)} · first retained locally {formatEvidenceDate(source.firstLocalObservedAt)}</p
              ><p>{source.completeness}: {source.gap || 'Continuous coverage unknown'}</p
              >{/each}</details
          >{/if}
        {#each reviews.items.filter((item) => item.subjectKey === analystReviewSubjectKey( 'comparison', ['watch_domain_context', name, row.domain, row.context.brandProfileId] )) as item}<details
            ><summary>Observed change review</summary><p>{item.detail}</p>
            <ul
              >{#each reviews.details.find((detail) => detail.subjectKey === item.subjectKey)?.changes ?? [] as change}<li
                  >{watchlistFieldLabel(change.field)}: {formatWatchlistValue(
                    change.field,
                    change.before,
                  )} → {formatWatchlistValue(change.field, change.after)}</li
                >{/each}</ul
            >
            <p
              >Before: last comparable retained baseline; exact earlier field observation time
              unknown.</p
            ><p
              >Later retained check: {item.observedAt || 'Time unknown'} · completeness {item.completeness}.
              {item.rankingReason}</p
            ><a href={`/cases?domain=${encodeURIComponent(row.domain)}`}
              >Review a deliberate Case handoff</a
            ></details
          >{/each}
      </article>{/each}</div
  >
  <Pagination {currentPage} {pageCount} {setPage} ariaLabel="Domain context pages" pageInputLabel="Domain context page" />
  {#if reviews.truncated}<p
      >Additional contextual change reviews were omitted by the 500-item bound; no absence is
      inferred.</p
    >{/if}
  <fieldset disabled={busy}
    ><legend>Reviewed selected-context change</legend>
    <label
      >New analyst priority<select bind:value={priority}
        >{#each WATCH_PRIORITIES as option}<option value={option.value}>{option.label}</option
          >{/each}</select
      ></label
    >
    <label>New watch reason<textarea bind:value={reason} maxlength="300" rows="2"></textarea></label
    >
    <label>Optional next review date (UTC)<input type="date" bind:value={reviewDate} /></label>
    <button
      class="btn"
      disabled={!chosen.length || !reason.trim()}
      onclick={() => (preview = previewIdentity)}>Preview selected priority changes</button
    >
    {#if preview === previewIdentity}<section aria-label="Domain priority change preview"
        ><p
          >Set {WATCH_PRIORITIES.find((option) => option.value === priority)?.label} with reason “{reason}”.
          Additional requests: 0.</p
        ><ul
          >{#each chosen as row}<li
              >{row.domain} · {row.brand.label} · {row.context
                .priority} → {priority}{#if row.context.brandProfileId}<details><summary>Exact Brand identity</summary><p>{row.brand.description}</p></details>{/if}</li
            >{/each}</ul
        ><button class="btn" onclick={() => void save()} disabled={!chosen.length}
          >Apply reviewed context changes</button
        ></section
      >{/if}
  </fieldset>
</section>

<style>
  .domain-metadata {
    min-width: 0;
    padding: var(--card-pad);
    display: grid;
    gap: 12px;
    margin-top: 16px;
  }
  .domain-metadata p,
  .domain-metadata li,
  .domain-metadata summary {
    overflow-wrap: anywhere;
  }
  .domain-metadata label {
    display: grid;
    gap: 6px;
  }
  .domain-metadata label:has(input[type='checkbox']) {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .metadata-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
    gap: 12px;
  }
  .metadata-grid article {
    min-width: 0;
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }
  .domain-metadata fieldset {
    min-width: 0;
    display: grid;
    gap: 12px;
    padding: 12px;
    border: 1px solid var(--border);
  }
  .domain-metadata select,
  .domain-metadata textarea,
  .domain-metadata input:not([type='checkbox']) {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }
  .toolbar {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .domain-metadata summary {
    cursor: pointer;
  }
</style>
