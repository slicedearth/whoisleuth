<script lang="ts">
  import { tick } from 'svelte';
  import Pagination from './Pagination.svelte';
  import CasePicker from './CasePicker.svelte';
  import { casesForDomain, selectedCasesByDomain } from '../../../../packages/cases/case-selection.mts';
  import type { CaseRecord } from '$lib/cases';
  import {
    filterWebsiteProfileClusters,
    type WebsiteProfileCluster,
    type WebsiteProfileClusterSummary,
  } from '$lib/analysis/website-profile-clusters.ts';

  let {
    summary,
    onpin = null,
    cases = [],
  }: {
    summary: WebsiteProfileClusterSummary;
    onpin?: ((cluster: WebsiteProfileCluster, domain: string, caseId?: string) => void | Promise<void>) | null;
    cases?: readonly CaseRecord[];
  } = $props();
  let query = $state('');
  let kind = $state<'all' | WebsiteProfileCluster['kind']>('all');
  let message = $state('');
  let pinning = $state('');
  let caseSelections = $state(new Map<string, string>());
  const selectedCases = $derived(selectedCasesByDomain(cases, caseSelections));
  const pageSize = 20;
  let resultPage = $state(1);
  let resultList = $state<HTMLOListElement>();
  const filtered = $derived(filterWebsiteProfileClusters(summary, query)
    .filter((item) => kind === 'all' || item.kind === kind));
  const pageCount = $derived(Math.max(1, Math.ceil(filtered.length / pageSize)));
  const currentPage = $derived(Math.min(resultPage, pageCount));
  const firstResult = $derived((currentPage - 1) * pageSize);
  const visibleClusters = $derived(filtered.slice(firstResult, firstResult + pageSize));

  $effect(() => { summary; resultPage = 1; });

  async function setPage(value: number) {
    const expected = { summary, query, kind };
    resultPage = Math.min(pageCount, Math.max(1, value));
    await tick();
    if (summary !== expected.summary || query !== expected.query || kind !== expected.kind) return;
    resultList?.focus({ preventScroll: true });
    resultList?.scrollIntoView({ block: 'start' });
  }

  async function pin(cluster: WebsiteProfileCluster, domain: string) {
    if (!onpin) return;
    pinning = `${cluster.id}:${domain}`;
    message = '';
    try {
      await onpin(cluster, domain, selectedCases.get(domain)?.id);
      message = `Recorded the ${cluster.label.toLowerCase()} relationship as an analyst review lead for ${domain}.`;
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'Could not record the review lead.';
    } finally {
      pinning = '';
    }
  }
</script>

<section class="profile-clusters card" aria-labelledby="profile-clusters-title">
  <header class="section-head">
    <div>
      <p class="eyebrow">Saved website profiles</p>
      <h2 id="profile-clusters-title">Cross-domain website pivots</h2>
      <p>Find exact and weighted, explainable relationships across compact website observations saved in this browser.</p>
    </div>
    <span>{summary.clusters.length} cluster{summary.clusters.length === 1 ? '' : 's'}</span>
  </header>
  <div class="filters">
    <label class="field">Search saved profiles<input type="search" bind:value={query} oninput={() => resultPage = 1} maxlength="200" placeholder="Domain, technology, or evidence type"></label>
    <label class="field">Relationship type<select bind:value={kind} onchange={() => resultPage = 1}><option value="all">All</option><option value="similarity">Weighted relationships</option><option value="technology">Technology</option><option value="identity">Page identity</option><option value="tracker">Tracking identifier</option><option value="form_action">Form action</option><option value="resource_host">Resource host</option></select></label>
  </div>
  <p class="coverage">{summary.snapshotsReviewed} saved observation{summary.snapshotsReviewed === 1 ? '' : 's'} across {summary.domainsReviewed} domain{summary.domainsReviewed === 1 ? '' : 's'} reviewed. Search, weighting, and grouping remain local to this browser.</p>
  {#if filtered.length}
    <p class="coverage" role="status">Showing {firstResult + 1}–{firstResult + visibleClusters.length} of {filtered.length} matching relationships · similarity model {summary.version}</p>
    <ol class="cluster-grid independent-grid paged-results" aria-label="Saved website relationship results" tabindex="-1" bind:this={resultList}>
      {#each visibleClusters as cluster (cluster.id)}
        <li class="cluster-card">
          <div class="cluster-head">
            <div><span>{cluster.kind.replaceAll('_', ' ')}</span><h3>{cluster.label}</h3><small>{cluster.evidence}</small></div>
            <strong>{cluster.domains.length} <small>domains</small></strong>
          </div>
          {#if cluster.contributingFields.length}
            <details class="contributions"><summary>{cluster.contributingFields.length} contributing field{cluster.contributingFields.length === 1 ? '' : 's'}</summary><ul>{#each cluster.contributingFields as field}<li><strong>{field.label} · +{field.weight}</strong><small>{field.detail}</small>{#if field.sharedValues.length}<code>{field.sharedValues.join(' · ')}</code>{/if}</li>{/each}</ul></details>
          {/if}
          <small class="range">Saved relationship observed {new Date(cluster.firstObservedAt).toLocaleDateString()} to {new Date(cluster.lastObservedAt).toLocaleDateString()}</small>
          <ul>
            {#each cluster.observations as observation}
              {@const incidents = casesForDomain(cases, observation.domain)}
              {@const selectedCase = selectedCases.get(observation.domain)}
              <li>
                <a href={`/lookup?q=${encodeURIComponent(observation.domain)}`}>{observation.domain}</a>
                <small>{observation.complete && !observation.truncated ? 'Complete saved evidence' : 'Partial saved evidence'} · {new Date(observation.firstObservedAt).toLocaleDateString()} to {new Date(observation.lastObservedAt).toLocaleDateString()}</small>
                {#if onpin}
                  {#if incidents.length > 1}<CasePicker id={`website-case-${cluster.id}-${observation.domain}`} records={incidents} selectedId={selectedCase?.id ?? ''} disabled={Boolean(pinning)} select={(id) => { caseSelections = new Map(caseSelections).set(observation.domain, id); }} />{/if}
                  <button class="btn small" type="button" disabled={Boolean(pinning) || (incidents.length > 1 && !selectedCase)} onclick={() => void pin(cluster, observation.domain)}>{pinning === `${cluster.id}:${observation.domain}` ? 'Recording…' : 'Record review lead'}</button>
                {/if}
              </li>
            {/each}
          </ul>
          <details><summary>Interpretation limits</summary><ul>{#each cluster.limitations as limitation}<li>{limitation}</li>{/each}</ul></details>
        </li>
      {/each}
    </ol>
    <Pagination {currentPage} {pageCount} setPage={(value) => void setPage(value)} ariaLabel="Website relationship pages" pageInputLabel="Website relationship page" />
  {:else}
    <p class="empty">{summary.clusters.length ? 'No saved website-profile cluster matches these filters.' : 'Save compact website-profile snapshots for at least two domains to find cross-domain relationships.'}</p>
  {/if}
  {#if message}<p class="message" role="status">{message}</p>{/if}
  <details class="summary-limits"><summary>{summary.truncated ? 'Partial source coverage' : 'Source coverage'}</summary><ul>{#each summary.limitations as limitation}<li>{limitation}</li>{/each}{#if summary.truncated}<li>Some supplied snapshot evidence is incomplete. Pagination does not omit retained relationships.</li>{/if}</ul></details>
</section>

<style>
  .profile-clusters{margin:0 0 16px;padding:var(--card-pad)}
  .section-head h2{margin:0}
  .section-head p:not(.eyebrow){max-width:760px;margin:6px 0 0;color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  .section-head>span{flex:none;padding:4px 8px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font:700 var(--text-2xs) var(--mono)}
  .filters{display:grid;grid-template-columns:minmax(0,2fr) minmax(180px,1fr);gap:10px;margin-top:16px}
  .coverage,.empty{color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .cluster-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:12px 0 0;padding:0;list-style:none}
  .cluster-card{min-width:0;padding:13px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .cluster-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  .cluster-head>div{min-width:0}
  .cluster-head span{color:var(--accent2);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  .cluster-head h3{margin:3px 0 2px;overflow-wrap:anywhere;font:700 var(--text-sm) var(--mono)}
  .cluster-head small{color:var(--muted);font-size:var(--text-2xs)}
  .cluster-head>strong{flex:none;font:700 var(--text-lg) var(--mono)}
  .cluster-head>strong small{display:block;white-space:nowrap;color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  .cluster-grid ul{display:grid;gap:7px;margin:12px 0 0;padding:0;list-style:none}
  .cluster-grid li{min-width:0}
  .cluster-grid li a{display:block;overflow-wrap:anywhere;font:700 var(--text-xs) var(--mono)}
  .cluster-grid li small{display:block;margin-top:2px;color:var(--muted);font-size:var(--text-2xs)}
  .cluster-grid li .btn{margin-top:6px}
  .range{display:block;margin-top:9px;color:var(--muted);font-size:var(--text-2xs)}
  .contributions ul li{display:grid;gap:3px}
  .contributions code{overflow-wrap:anywhere;color:var(--muted);font-size:var(--text-2xs)}
  .message{color:var(--muted);font-size:var(--text-xs)}
  details{margin-top:10px;color:var(--muted);font-size:var(--text-xs)}
  summary{cursor:pointer;font:700 var(--text-2xs) var(--mono)}
  details ul{padding-left:18px!important;list-style:disc!important;line-height:1.5}
  @media(max-width:760px){.cluster-grid,.filters{grid-template-columns:1fr}.section-head{display:block}.section-head>span{display:inline-block;margin-top:10px}}
</style>
