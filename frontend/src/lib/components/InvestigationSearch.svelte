<script lang="ts">
  import { tick } from 'svelte';
  import Pagination from './Pagination.svelte';
  import { reloadDeferredModulePage } from '$lib/deferred-module';
  import {
    MAX_INVESTIGATION_SEARCH_QUERY_LENGTH,
    MAX_INVESTIGATION_SEARCH_RESULTS,
    type InvestigationSearchField,
    type InvestigationSearchResponse,
    type InvestigationSearchResult,
    type InvestigationSearchSourceSummary,
  } from '$lib/analysis/investigation-search.ts';
  import type { InvestigationSearchSession } from '$lib/investigation-search-session';

  let { session, loadError = '' } = $props<{ session: InvestigationSearchSession | null; loadError?: string }>();
  let query = $state('');
  let resultPage = $state(1);
  let resultList = $state<HTMLOListElement>();
  let pending = $state(false);
  let queryError = $state('');
  let completed = $state.raw<{ session: InvestigationSearchSession; query: string; page: number; response: InvestigationSearchResponse } | null>(null);
  let focusRequest: { query: string; page: number } | null = null;
  const index = $derived(session?.summary ?? null);
  const response = $derived(completed?.session === session && completed?.query === query ? completed.response : null);
  const pageCount = $derived(Math.max(1, Math.ceil((response?.totalMatches ?? 0) / MAX_INVESTIGATION_SEARCH_RESULTS)));
  const currentPage = $derived(Math.min(completed?.page ?? 1, pageCount));
  const recentResults = $derived(index?.recentResults ?? []);
  const sourceWarnings = $derived.by(() => {
    if (!index) return [] as Array<[string, InvestigationSearchSourceSummary]>;
    return (Object.entries(index.sources) as Array<[string, InvestigationSearchSourceSummary]>)
      .filter(([, source]) => source.state === 'invalid' || source.state === 'unsupported' || source.state === 'unavailable');
  });

  $effect(() => {
    const currentSession = session;
    const currentQuery = query;
    const page = resultPage;
    if (!currentSession) return;
    let active = true;
    pending = true;
    queryError = '';
    void currentSession.search(currentQuery, { page }).then(async (result: InvestigationSearchResponse) => {
      if (!active) return;
      completed = { session: currentSession, query: currentQuery, page, response: result };
      pending = false;
      if (focusRequest && focusRequest.query === currentQuery && focusRequest.page === page) {
        focusRequest = null;
        await tick();
        if (!active) return;
        resultList?.focus({ preventScroll: true });
        resultList?.scrollIntoView({ block: 'start' });
      }
    }).catch((cause: unknown) => {
      if (!active) return;
      pending = false;
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        queryError = 'Saved-work search could not return results. Reload the page to retry.';
      }
    });
    return () => { active = false; };
  });

  const typeLabels: Record<InvestigationSearchResult['entityType'], string> = {
    domain: 'Domain',
    nameserver_set: 'Nameserver set',
    http_origin: 'HTTP origin',
    favicon: 'Favicon',
    certificate: 'Certificate',
    ip_address: 'IP address',
    tracking_identifier: 'Tracking identifier',
    favicon_cluster: 'Favicon relationship',
    official_asset_host: 'Official asset host',
    brand: 'Brand profile',
    case: 'Case',
    campaign: 'Campaign',
  };
  const fieldLabels: Record<InvestigationSearchField, string> = {
    canonical: 'Canonical value',
    label: 'Label',
    domain: 'Domain',
    name: 'Name',
    nameserver: 'Nameserver',
    origin: 'HTTP origin',
    sha256: 'SHA-256',
    ip: 'IP address',
    identifier: 'Identifier',
    value: 'Relationship value',
  };
  const storeLabels: Record<string, string> = {
    cases: 'Cases',
    campaigns: 'Campaigns',
    brandProfiles: 'Brand profiles',
    relationshipRows: 'Scan relationship evidence',
    relationshipObservations: 'Retained relationship observations',
  };

  function evidenceState(result: InvestigationSearchResult): string {
    if (result.complete === true && result.truncated !== true) return 'Complete';
    if (result.complete === false || result.truncated === true) return 'Partial';
    return 'Completeness unknown';
  }

  function formatDate(value: string): string {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 'Unknown time' : parsed.toLocaleString();
  }
  function setResultPage(value: number) {
    if (pending) return;
    resultPage = Math.min(pageCount, Math.max(1, value));
    focusRequest = { query, page: resultPage };
  }
</script>

{#snippet resultCard(result: InvestigationSearchResult)}
  <article class="result-card">
    <div class="result-heading">
      <div>
        <span class="type-badge">{typeLabels[result.entityType]}</span>
        <h3>{result.label}</h3>
      </div>
      <span class:partial={evidenceState(result) !== 'Complete'} class="evidence-state">{evidenceState(result)}</span>
    </div>
    <dl>
      <div><dt>{fieldLabels[result.matchedField]}</dt><dd>{result.matchedValue}</dd></div>
      <div><dt>Source</dt><dd>{storeLabels[result.sourceStore] || result.sourceStore} · {result.source}</dd></div>
      {#if result.classification}<div><dt>Classification</dt><dd>{result.classification === 'derived' ? 'Derived observation' : 'Normalized observation'}</dd></div>{/if}
      <div><dt>Observed</dt><dd>{formatDate(result.observedAt)}</dd></div>
    </dl>
    {#if result.limitations.length || result.truncated === true}
      <details class="limitations">
        <summary>Evidence limitations</summary>
        <ul>
          {#each result.limitations as limitation}<li>{limitation}</li>{/each}
          {#if result.truncated === true}<li>The source observation reports truncated evidence.</li>{/if}
        </ul>
      </details>
    {/if}
    <a class="result-action" href={result.href}>{result.action} <span aria-hidden="true">→</span></a>
  </article>
{/snippet}

<section class="investigation-search card" aria-labelledby="investigation-search-title">
  <div class="search-intro">
    <div>
      <p class="eyebrow">Find saved work</p>
      <h2 id="investigation-search-title">Search what this browser remembers</h2>
      <p>Find saved domains, cases, campaigns, brand profiles, and related infrastructure without starting another check.</p>
    </div>
    {#if index?.state === 'ready'}
      <span class="index-count">{index.entityCount} searchable item{index.entityCount === 1 ? '' : 's'}</span>
    {/if}
  </div>

  <label for="investigation-search-query">Search saved work</label>
  <input
    id="investigation-search-query"
    type="search"
    bind:value={query}
    oninput={() => { resultPage = 1; focusRequest = null; }}
    maxlength={MAX_INVESTIGATION_SEARCH_QUERY_LENGTH}
    autocomplete="off"
    autocapitalize="none"
    spellcheck="false"
    placeholder="Domain, case, brand, or IP"
  >
  <p class="search-note">This searches only data already retained in this browser. It does not contact a provider or start a new check.</p>

  {#if loadError}
    <p class="state-row error" role="alert">{loadError}</p>
    <button class="btn" type="button" onclick={reloadDeferredModulePage}>Reload page</button>
  {:else if !index}
    <p class="state-row" role="status">Preparing saved-work search.</p>
  {:else if index.state !== 'ready'}
    <p class="state-row error" role="alert">{index.limitations[0] || 'Saved-work search is unavailable.'}</p>
  {:else}
    {#if sourceWarnings.length}
      <details class="source-warning">
        <summary>{sourceWarnings.length} saved-data warning{sourceWarnings.length === 1 ? '' : 's'}</summary>
        <ul>
          {#each sourceWarnings as [store, source]}
            <li>{storeLabels[store] || store}: {source.state === 'unsupported'
              ? 'created by a newer version and not searched'
              : source.state === 'unavailable'
                ? 'unavailable in browser-local storage and not searched'
                : 'could not be read safely'}.</li>
          {/each}
        </ul>
      </details>
    {/if}
    {#if index.limitations.length}
      <details class="index-limitations">
        <summary>{index.truncated ? 'Partial search coverage' : 'Search coverage'}</summary>
        <ul>{#each index.limitations as limitation}<li>{limitation}</li>{/each}</ul>
      </details>
    {/if}

    {#if queryError}
      <p class="result-status error" role="alert">{queryError}</p>
      <button class="btn" type="button" onclick={reloadDeferredModulePage}>Reload page</button>
    {:else if pending}
      <p class="result-status" role="status">Searching saved work…</p>
    {:else if response && response.state !== 'idle'}
      <p class:error={response.state === 'invalid'} class="result-status" role="status" aria-live="polite">{response.detail}</p>
    {/if}

    {#if response?.state === 'idle' && recentResults.length}
      <section class="recent-work" aria-labelledby="recent-work-title">
        <div>
          <h3 id="recent-work-title">Recent saved work</h3>
          <p>Most recently observed items in the current bounded local index.</p>
        </div>
        <ol class="result-list independent-grid" aria-label="Recent local investigation work">
          {#each recentResults as result (result.entityId)}
            <li>{@render resultCard(result)}</li>
          {/each}
        </ol>
      </section>
    {/if}

    {#if response?.state === 'results'}
      <ol class="result-list independent-grid paged-results" aria-label="Local investigation search results" aria-busy={pending} tabindex="-1" bind:this={resultList}>
        {#each response.results as result (result.entityId)}
          <li>{@render resultCard(result)}</li>
        {/each}
      </ol>
      <Pagination {currentPage} {pageCount} setPage={setResultPage} ariaLabel="Saved-work search pages" />
    {/if}
  {/if}
</section>

<style>
  .investigation-search{margin-top:28px;padding:21px;min-width:0}
  .search-intro{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}
  .search-intro h2{margin:4px 0 7px;font:700 var(--text-lg) var(--mono)}
  .search-intro p:not(.eyebrow){max-width:760px;margin:0;color:var(--muted);font-size:var(--text-sm);line-height:1.55}
  .index-count{flex:none;border:1px solid var(--border);border-radius:999px;padding:5px 9px;color:var(--muted);font:700 var(--text-2xs) var(--mono)}
  label{display:block;margin:18px 0 6px;font:700 var(--text-xs) var(--mono)}
  input{width:100%;min-width:0}
  .search-note{margin:7px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .state-row,.result-status{margin:14px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .error{color:var(--danger)}
  .source-warning,.index-limitations,.limitations{margin-top:12px;color:var(--muted);font-size:var(--text-xs)}
  summary{cursor:pointer;font:700 var(--text-xs) var(--mono)}
  .source-warning ul,.index-limitations ul,.limitations ul{margin:8px 0 0;padding-left:20px;line-height:1.5}
  .result-list{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:14px 0 0;padding:0;list-style:none}
  .recent-work{margin-top:18px;padding-top:15px;border-top:1px solid var(--border)}
  .recent-work>div h3{margin:0;font:700 var(--text-sm) var(--mono)}
  .recent-work>div p{margin:4px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .result-card{height:100%;min-width:0;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised);padding:15px}
  .result-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  .type-badge{color:var(--accent2);font:700 var(--text-2xs) var(--mono);letter-spacing:.05em;text-transform:uppercase}
  h3{margin:4px 0 0;overflow-wrap:anywhere;font:700 var(--text-md) var(--mono)}
  .evidence-state{flex:none;border:1px solid var(--border-strong);border-radius:999px;padding:3px 7px;color:var(--text);font:700 var(--text-2xs) var(--mono)}
  .evidence-state.partial{border-color:var(--amber);border-style:dashed;color:var(--amber)}
  dl{display:grid;gap:6px;margin:13px 0 0}
  dl>div{display:grid;grid-template-columns:100px minmax(0,1fr);gap:9px}
  dt{color:var(--muted);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  dd{min-width:0;margin:0;overflow-wrap:anywhere;font-size:var(--text-xs);line-height:1.45}
  .result-action{display:inline-block;margin-top:14px;color:var(--accent);font:700 var(--text-xs) var(--mono)}
  @media(max-width:760px){.result-list{grid-template-columns:1fr}}
  @media(max-width:520px){.search-intro{display:block}.index-count{display:inline-block;margin-top:12px}.result-heading{display:block}.evidence-state{display:inline-block;margin-top:8px}dl>div{grid-template-columns:1fr;gap:2px}}
</style>
