<script lang="ts">
  import { onMount } from 'svelte';
  import {
    projectInvestigationContextPreview,
    type InvestigationContextPreview,
  } from '$lib/analysis/investigation-context-preview.ts';
  import type {
    InvestigationSearchIndex,
    InvestigationSearchResult,
  } from '$lib/analysis/investigation-search.ts';

  let { query } = $props<{ query: string }>();
  let loadState = $state<'loading' | 'ready' | 'unavailable'>('loading');
  let index = $state<InvestigationSearchIndex | null>(null);
  const preview = $derived<InvestigationContextPreview | null>(index
    ? projectInvestigationContextPreview(index, query)
    : null);

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
  const storeLabels: Record<InvestigationSearchResult['sourceStore'], string> = {
    cases: 'Cases',
    campaigns: 'Campaigns',
    brandProfiles: 'Brand profiles',
    relationshipRows: 'Scan relationship evidence',
    relationshipObservations: 'Retained relationship observations',
  };

  function evidenceState(result: InvestigationSearchResult): string {
    if (result.complete === true && result.truncated !== true) return 'Complete retained evidence';
    if (result.complete === false || result.truncated === true) return 'Partial retained evidence';
    return 'Completeness not reported';
  }

  function formatDate(value: string): string {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 'Unknown time' : parsed.toLocaleString('en-AU');
  }

  onMount(() => {
    void (async () => {
      try {
        const module = await import('$lib/investigation-search');
        index = await module.loadLocalInvestigationSearchIndex();
        loadState = 'ready';
      } catch {
        loadState = 'unavailable';
      }
    })();
  });
</script>

{#if loadState === 'loading'}
  <p class="state" role="status">Reading bounded saved context from this browser…</p>
{:else if loadState === 'unavailable'}
  <p class="state unavailable" role="alert">Saved context is unavailable because one or more browser-local collections could not be read.</p>
{:else if preview}
  <p class="state state-{preview.state}" role="status" aria-live="polite">{preview.detail}</p>
  {#if preview.limitations.length}
    <details>
      <summary>Preview limitations</summary>
      <ul>{#each preview.limitations as limitation}<li>{limitation}</li>{/each}</ul>
    </details>
  {/if}
  {#if preview.results.length}
    <ol class="context-list" aria-label="Saved context matches">
      {#each preview.results as result (result.entityId)}
        <li>
          <article>
            <header><span>{typeLabels[result.entityType]}</span><strong>{evidenceState(result)}</strong></header>
            <h3>{result.label}</h3>
            <dl>
              <div><dt>Matched value</dt><dd>{result.matchedValue}</dd></div>
              <div><dt>Source</dt><dd>{storeLabels[result.sourceStore]} · {result.source}</dd></div>
              <div><dt>Observed</dt><dd>{formatDate(result.observedAt)}</dd></div>
            </dl>
            <a href={result.href}>{result.action} <span aria-hidden="true">→</span></a>
          </article>
        </li>
      {/each}
    </ol>
  {/if}
{/if}

<style>
  .state{margin:0;padding:9px;border-left:2px solid var(--accent);background:var(--panel-raised);color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .state-partial,.unavailable{border-color:var(--amber)}
  details{margin-top:10px;color:var(--muted);font-size:var(--text-xs)}
  summary{cursor:pointer;font:700 var(--text-xs) var(--mono)}
  details ul{margin:8px 0 0;padding-left:20px;line-height:1.5}
  .context-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0 0;padding:0;list-style:none}
  article{height:100%;min-width:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  article header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;color:var(--accent2);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  article header strong{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-align:right;text-transform:none}
  h3{margin:7px 0 0;font:700 var(--text-sm) var(--mono);overflow-wrap:anywhere}
  dl{display:grid;gap:6px;margin:10px 0 0}
  dl div{min-width:0}
  dt{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  dd{margin:2px 0 0;font-size:var(--text-xs);line-height:1.4;overflow-wrap:anywhere}
  article>a{display:inline-block;margin-top:11px;font:700 var(--text-xs) var(--mono)}
  @media(max-width:820px){.context-list{grid-template-columns:1fr}}
</style>
