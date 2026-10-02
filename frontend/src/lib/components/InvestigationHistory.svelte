<script lang="ts">
  import { tick } from 'svelte';
  import { formatEvidenceDate } from '$lib/analysis/evidence-time.ts';
  import type { InvestigationHistory } from '$lib/analysis/investigation-search.ts';
  import type { InvestigationSearchSession } from '$lib/investigation-search-session.ts';
  import Pagination from './Pagination.svelte';

  let { session, entityId, onopen }: {
    session: InvestigationSearchSession | null;
    entityId: string;
    onopen: (event: MouseEvent, href: string) => void;
  } = $props();
  let page = $state(1);
  let response = $state.raw<InvestigationHistory | null>(null);
  let error = $state('');
  let pending = $state(false);
  let heading = $state<HTMLHeadingElement>();
  let focusPage = false;

  $effect(() => {
    const current = session;
    const selected = entityId;
    const requestedPage = page;
    if (!current) return;
    let active = true;
    pending = true;
    response = null;
    error = '';
    void current.history(selected, requestedPage).then(async value => {
      if (!active) return;
      response = value;
      pending = false;
      if (focusPage) {
        focusPage = false;
        await tick();
        if (active) heading?.focus({ preventScroll: true });
      }
    }).catch(() => {
      if (!active) return;
      pending = false;
      error = 'Saved history could not be read. Close and reopen this section to retry.';
    });
    return () => { active = false; };
  });
</script>

<section class="saved-history" aria-label="Retained observation history" aria-busy={pending}>
  {#if error}<p role="alert">{error}</p>
  {:else if pending || !response}<p role="status">Reading saved history…</p>
  {:else if response.state !== 'ready'}<p role="status">This item is no longer available in saved work.</p>
  {:else}
    <h4 tabindex="-1" bind:this={heading}>{response.total} retained observation{response.total === 1 ? '' : 's'}</h4>
    <p class="interval">{formatEvidenceDate(response.firstObservedAt, 'Unknown first observation')} – {formatEvidenceDate(response.lastObservedAt, 'Unknown last observation')}</p>
    {#if response.partial}<p>Some saved evidence or source coverage is incomplete.</p>{/if}
    <ol>
      {#each response.entries as entry (entry.id)}
        <li>
          <div class="entry-heading"><time datetime={entry.observedAt}>{formatEvidenceDate(entry.observedAt)}</time><span>{entry.complete === true && entry.truncated !== true ? 'Complete' : entry.complete === null && entry.truncated !== true ? 'Completeness unknown' : 'Partial'}</span></div>
          <p>{entry.source} · {entry.recordId}</p>
          <a href={entry.href} onclick={event => onopen(event, entry.href)}>{entry.action}</a>
          {#if entry.limitations.length}<details><summary>Source limitations</summary><ul>{#each entry.limitations as limitation}<li>{limitation}</li>{/each}</ul></details>{/if}
        </li>
      {/each}
    </ol>
    <Pagination currentPage={response.page} pageCount={response.pageCount} setPage={value => { focusPage = true; page = value; }} ariaLabel="Retained history pages" />
    <details><summary>History scope</summary><ul>{#each response.limitations as limitation}<li>{limitation}</li>{/each}</ul></details>
  {/if}
</section>

<style>
  .saved-history{min-width:0;margin-top:12px;font-size:var(--text-xs);line-height:1.55}
  h4{margin:0;font:700 var(--text-sm) var(--mono)}
  p{margin:6px 0;overflow-wrap:anywhere}.interval{color:var(--muted)}
  ol{list-style:none;margin:12px 0;padding:0;display:grid;gap:12px}
  ol>li{min-width:0;border-top:1px solid var(--border);padding-top:10px}
  .entry-heading{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;color:var(--muted)}
  a{display:inline-block;padding-block:4px;color:var(--accent);overflow-wrap:anywhere}
  details{margin-top:8px}summary{cursor:pointer}ul{padding-left:20px;overflow-wrap:anywhere}
</style>
