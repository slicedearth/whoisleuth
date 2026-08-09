<script lang="ts">
  import Pagination from './Pagination.svelte';
  import type { BrandReviewInbox } from '../analysis/brand-review-inbox.ts';

  const PAGE_SIZE = 25;
  let { inbox }: { inbox: BrandReviewInbox } = $props();
  let page = $state(1);
  let pageScope = $state('');
  const sourceEntries = $derived([
    ['Brand Profiles', inbox.sources.profiles],
    ['cases', inbox.sources.cases],
    ['the active-profile preference', inbox.sources.activePreference],
  ] as const);
  const unavailableLabels = $derived(sourceEntries.filter(([, state]) => state === 'unavailable').map(([label]) => label));
  const loadingLabels = $derived(sourceEntries.filter(([, state]) => state === 'loading').map(([label]) => label));
  const unavailableText = $derived(unavailableLabels.map((label) => `${label} could not be read`).join(' and '));
  const unavailable = $derived(unavailableLabels.length > 0);
  const loading = $derived(!unavailable && loadingLabels.length > 0);
  const anyLoading = $derived(loadingLabels.length > 0);
  const ready = $derived(!unavailable && !anyLoading);
  const numericMetric = $derived(ready && inbox.activeProfile !== null);
  const metricText = $derived(unavailable
    ? 'Unavailable'
    : loading
      ? 'Loading'
      : inbox.activeProfile
        ? String(inbox.items.length)
        : 'No active profile');
  const pageCount = $derived(Math.max(1, Math.ceil(inbox.items.length / PAGE_SIZE)));
  const currentPage = $derived(Math.min(page, pageCount));
  const visibleItems = $derived(inbox.items.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE));
  const firstVisible = $derived(inbox.items.length ? ((currentPage - 1) * PAGE_SIZE) + 1 : 0);
  const lastVisible = $derived(Math.min(currentPage * PAGE_SIZE, inbox.items.length));

  function formatDate(value: string): string {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('en-AU');
  }

  $effect(() => {
    const nextScope = `${inbox.sources.profiles}:${inbox.sources.cases}:${inbox.sources.activePreference}:${inbox.activeProfile?.id ?? ''}`;
    if (nextScope === pageScope) return;
    pageScope = nextScope;
    page = 1;
  });
</script>

<section class="brand-review card" aria-labelledby="brand-review-title" aria-busy={anyLoading}>
  <div class="review-heading">
    <div>
      <p class="eyebrow">Explicit associations</p>
      <h2 id="brand-review-title">Brand review inbox</h2>
      {#if inbox.activeProfile}
        <p>Existing review work for cases explicitly associated with <strong>{inbox.activeProfile.name}</strong>.</p>
      {:else if inbox.sources.activePreference === 'unavailable'}
        <p>The active-profile preference is unavailable, so profile-scoped review work is suppressed until it can be reread.</p>
      {:else}
        <p>Set a Brand Profile active to view its explicitly associated case-review work.</p>
      {/if}
    </div>
    <strong class:numeric={numericMetric}>{metricText}{#if numericMetric}{' '}<span class="sr-only">review items</span>{/if}</strong>
  </div>

  {#if unavailable}
    <p class="source-state unavailable" role="alert">This inbox is unavailable because {unavailableText}. No empty-state conclusion has been drawn.{#if anyLoading} {loadingLabels.join(' and ')} {loadingLabels.length === 1 ? 'is' : 'are'} still loading.{/if}</p>
  {:else if loading}
    <p class="source-state" role="status">Loading {loadingLabels.join(' and ')}…</p>
  {/if}

  {#if ready && inbox.activeProfile}
    <p class="association-count">{inbox.associatedCaseCount} associated case{inbox.associatedCaseCount === 1 ? '' : 's'} · keyed by <code>{inbox.activeProfile.id}</code></p>
    {#if inbox.items.length}
      <p class="display-bound">Showing {firstVisible}–{lastVisible} of {inbox.items.length} retained local review rows; at most {PAGE_SIZE} rows are rendered per page.</p>
      <ol class="review-items">
        {#each visibleItems as item (item.id)}
          <li class:urgent={item.priority === 'urgent'} class:high={item.priority === 'high'}>
            <div>
              <p class="meta"><span>{item.kind.replaceAll('_', ' ')}</span><span>{item.completeness}</span><span>{item.sourceIds.join(', ').replaceAll('_', ' ')}</span></p>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
              <small>{item.source} · observed {formatDate(item.observedAt)}</small>
            </div>
            <div class="actions"><a class="btn" href={item.href}>Open owning case</a>{#if item.retryHref}<a class="btn secondary" href={item.retryHref}>Refresh evidence</a>{/if}</div>
          </li>
        {/each}
      </ol>
      <Pagination currentPage={currentPage} {pageCount} setPage={(value) => { page = value; }} ariaLabel="Brand review inbox pages" />
    {:else}
      <p class="empty">No current analyst-review row is retained for the associated cases.</p>
    {/if}
  {/if}

  {#if ready && inbox.unresolvedReferences.length}
    <section class="unresolved" aria-labelledby="unresolved-brand-references-title">
      <h3 id="unresolved-brand-references-title">Unresolved profile references</h3>
      <p>The cases still retain these exact opaque references, but the corresponding local profile is unavailable.</p>
      <ul>
        {#each inbox.unresolvedReferences as reference (reference.id)}
          <li><code>{reference.brandProfileId}</code><span>{reference.caseDomain}</span><a href={reference.href}>Open owning case</a></li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if inbox.truncated}<p class="warning">The local projection reached an inspection or display bound. Narrow the saved workspace before relying on this view as complete.</p>{/if}
  <details><summary>Interpretation limits</summary><ul>{#each inbox.limitations as limitation}<li>{limitation}</li>{/each}</ul></details>
</section>

<style>
  .brand-review{min-width:0;margin-top:16px;padding:var(--card-pad)}
  .review-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
  .review-heading>div{min-width:0}
  .review-heading h2,.review-heading p{margin:0;overflow-wrap:anywhere}
  .review-heading h2{margin-top:3px;font:700 var(--text-lg) var(--mono)}
  .review-heading>div>p:last-child{margin-top:7px;color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  .review-heading>strong{max-width:45%;color:var(--accent2);font:700 var(--text-xs) var(--mono);overflow-wrap:anywhere;text-align:right}
  .review-heading>strong.numeric{font-size:2rem;font-weight:750}
  .association-count,.display-bound,.empty,.warning,.source-state,.unresolved>p,details{color:var(--muted);font-size:var(--text-sm)}
  .display-bound{margin:10px 0 0}
  .source-state.unavailable{color:var(--amber)}
  code{overflow-wrap:anywhere}
  .review-items{display:grid;gap:8px;margin:16px 0 0;padding:0;list-style:none}
  .review-items li{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:18px;padding:14px;border-left:3px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .review-items li>div{min-width:0}
  .review-items li.high{border-left-color:var(--amber)}
  .review-items li.urgent{border-left-color:var(--danger)}
  .review-items h3,.review-items p,.review-items small{margin:0}
  .review-items h3{margin:7px 0 3px;font:700 var(--text-sm) var(--mono);overflow-wrap:anywhere}
  .review-items p,.review-items small{color:var(--muted);font-size:var(--text-xs);line-height:1.45;overflow-wrap:anywhere}
  .review-items small{display:block;margin-top:5px;font-size:var(--text-2xs)}
  .meta{display:flex;flex-wrap:wrap;gap:6px;text-transform:uppercase}
  .meta span{min-width:0;padding:2px 6px;border:1px solid var(--border);border-radius:99px;font:650 var(--text-2xs) var(--mono);overflow-wrap:anywhere}
  .actions{display:grid;gap:6px;min-width:150px;max-width:100%;text-align:center}
  .unresolved{margin-top:18px;padding-top:16px;border-top:1px solid var(--border)}
  .unresolved h3{margin:0;font:700 var(--text-sm) var(--mono)}
  .unresolved ul{display:grid;gap:7px;margin:10px 0 0;padding:0;list-style:none}
  .unresolved li{display:grid;min-width:0;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;align-items:center;gap:10px;padding:9px 11px;border-radius:var(--radius-sm);background:var(--panel-raised);font-size:var(--text-xs)}
  .unresolved li>*{min-width:0;overflow-wrap:anywhere}
  details{margin-top:16px}
  details summary{cursor:pointer;color:var(--text);font-weight:650}
  details ul{padding-left:20px}
  details li{overflow-wrap:anywhere}
  .warning{color:var(--amber)}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  @media(max-width:640px){.review-items li{display:grid}.actions{width:100%}.unresolved li{grid-template-columns:1fr}.review-heading>strong{font-size:1.6rem}}
</style>
