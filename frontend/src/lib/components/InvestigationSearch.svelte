<script lang="ts">
  import {
    MAX_INVESTIGATION_SEARCH_QUERY_LENGTH,
    searchInvestigationIndex,
    type InvestigationSearchField,
    type InvestigationSearchIndex,
    type InvestigationSearchResult,
    type InvestigationSearchSourceSummary,
  } from '$lib/analysis/investigation-search.ts';

  let { index } = $props<{ index: InvestigationSearchIndex | null }>();
  let query = $state('');
  const response = $derived(index ? searchInvestigationIndex(index, query) : null);
  const sourceWarnings = $derived.by(() => {
    if (!index) return [] as Array<[string, InvestigationSearchSourceSummary]>;
    return (Object.entries(index.sources) as Array<[string, InvestigationSearchSourceSummary]>)
      .filter(([, source]) => source.state === 'invalid' || source.state === 'unsupported');
  });

  const typeLabels: Record<InvestigationSearchResult['entityType'], string> = {
    domain: 'Domain',
    nameserver_set: 'Nameserver set',
    http_origin: 'HTTP origin',
    favicon: 'Favicon',
    certificate: 'Certificate',
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
  };
  const storeLabels: Record<string, string> = {
    cases: 'Cases',
    campaigns: 'Campaigns',
    brandProfiles: 'Brand profiles',
    relationshipRows: 'Scan relationship evidence',
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
</script>

<section class="investigation-search card" aria-labelledby="investigation-search-title">
  <div class="search-intro">
    <div>
      <p class="eyebrow">Local pivots</p>
      <h2 id="investigation-search-title">Search retained investigation evidence</h2>
      <p>Find known domains, cases, campaigns, brand profiles, infrastructure, and exact retained fingerprints in this browser.</p>
    </div>
    {#if index?.state === 'ready'}
      <span class="index-count">{index.entityCount} indexed entit{index.entityCount === 1 ? 'y' : 'ies'}</span>
    {/if}
  </div>

  <label for="investigation-search-query">Search local evidence</label>
  <input
    id="investigation-search-query"
    type="search"
    bind:value={query}
    maxlength={MAX_INVESTIGATION_SEARCH_QUERY_LENGTH}
    autocomplete="off"
    autocapitalize="none"
    spellcheck="false"
    placeholder="Domain, campaign, nameserver, origin, or hash"
  >
  <p class="search-note">Search runs only in memory. It does not query a provider, start a scan, or persist a separate index.</p>

  {#if !index}
    <p class="state-row" role="status">Preparing the local index.</p>
  {:else if index.state !== 'ready'}
    <p class="state-row error" role="alert">{index.limitations[0] || 'The local investigation index is unavailable.'}</p>
  {:else}
    {#if sourceWarnings.length}
      <details class="source-warning">
        <summary>{sourceWarnings.length} local source warning{sourceWarnings.length === 1 ? '' : 's'}</summary>
        <ul>
          {#each sourceWarnings as [store, source]}
            <li>{storeLabels[store] || store}: {source.state === 'unsupported' ? 'newer schema not indexed' : 'stored value could not be interpreted'}.</li>
          {/each}
        </ul>
      </details>
    {/if}
    {#if index.limitations.length}
      <details class="index-limitations">
        <summary>Index coverage and limitations</summary>
        <ul>{#each index.limitations as limitation}<li>{limitation}</li>{/each}</ul>
      </details>
    {/if}

    {#if response && response.state !== 'idle'}
      <p class:error={response.state === 'invalid'} class="result-status" role="status" aria-live="polite">{response.detail}</p>
    {/if}

    {#if response?.state === 'results'}
      <ol class="result-list" aria-label="Local investigation search results">
        {#each response.results as result (result.entityId)}
          <li>
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
          </li>
        {/each}
      </ol>
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
  .result-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:14px 0 0;padding:0;list-style:none}
  .result-card{height:100%;min-width:0;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface2);padding:15px}
  .result-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  .type-badge{color:var(--accent2);font:700 var(--text-2xs) var(--mono);letter-spacing:.05em;text-transform:uppercase}
  h3{margin:4px 0 0;overflow-wrap:anywhere;font:700 var(--text-md) var(--mono)}
  .evidence-state{flex:none;border:1px solid var(--success);border-radius:999px;padding:3px 7px;color:var(--success);font:700 var(--text-2xs) var(--mono)}
  .evidence-state.partial{border-color:var(--warning);color:var(--warning)}
  dl{display:grid;gap:6px;margin:13px 0 0}
  dl>div{display:grid;grid-template-columns:100px minmax(0,1fr);gap:9px}
  dt{color:var(--muted);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  dd{min-width:0;margin:0;overflow-wrap:anywhere;font-size:var(--text-xs);line-height:1.45}
  .result-action{display:inline-block;margin-top:14px;color:var(--accent);font:700 var(--text-xs) var(--mono)}
  @media(max-width:760px){.result-list{grid-template-columns:1fr}}
  @media(max-width:520px){.search-intro{display:block}.index-count{display:inline-block;margin-top:12px}.result-heading{display:block}.evidence-state{display:inline-block;margin-top:8px}dl>div{grid-template-columns:1fr;gap:2px}}
</style>
