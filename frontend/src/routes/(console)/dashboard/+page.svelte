<script lang="ts">
  import { onMount } from 'svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import InvestigationSearch from '$lib/components/InvestigationSearch.svelte';
  import WorkspaceArchive from '$lib/components/WorkspaceArchive.svelte';
  import { loadProfiles } from '$lib/brand-profiles';
  import { loadCases } from '$lib/cases';
  import { loadLocalInvestigationSearchIndex } from '$lib/investigation-search';
  import { loadWatchlists } from '$lib/watchlists';
  import { referenceWorkspaces, workspaces } from '$lib/workspaces';
  import {
    investigationRecipes,
    startInvestigationGuide,
    type InvestigationRecipeId,
  } from '$lib/investigation-guide';
  import type { InvestigationSearchIndex } from '$lib/analysis/investigation-search.ts';

  const quickActions = [
    { href: '/lookup', label: 'Run a lookup', detail: 'Inspect a domain, IP address, or ASN across separately attributed sources.' },
    { href: '/discover', label: 'Discover candidates', detail: 'Generate brand-related variants and review bounded discovery evidence.' },
    { href: '/bulk', label: 'Start bulk triage', detail: 'Assess a focused candidate set and compare explainable signals.' },
  ];

  let counts = $state({ cases: 0, openCases: 0, watchlists: 0, profiles: 0 });
  let investigationIndex = $state<InvestigationSearchIndex | null>(null);
  let guideDomain = $state('');
  let guideRecipeId = $state<InvestigationRecipeId>('new_domain_triage');
  let guideError = $state('');
  const selectedRecipe = $derived(investigationRecipes.find((recipe) => recipe.id === guideRecipeId) || investigationRecipes[0]);

  function refreshLocalSummary() {
    const cases = loadCases();
    counts = {
      cases: cases.length,
      openCases: cases.filter((record) => record.status !== 'resolved').length,
      watchlists: Object.keys(loadWatchlists()).length,
      profiles: loadProfiles().length,
    };
    investigationIndex = loadLocalInvestigationSearchIndex();
  }

  onMount(refreshLocalSummary);

  function startGuide(event:SubmitEvent) {
    event.preventDefault();
    guideError = '';
    try {
      startInvestigationGuide(guideDomain, guideRecipeId);
    } catch (cause) {
      guideError = cause instanceof Error ? cause.message : 'Could not start the guided investigation.';
    }
  }
</script>

<svelte:head>
  <title>Dashboard · WHOISleuth</title>
  <meta name="description" content="Start or continue a WHOISleuth domain investigation from the protected console dashboard.">
</svelte:head>

<PageHeading eyebrow="Console" title="Investigation dashboard" description="Start a focused task or continue work retained in this browser.">
  <a class="btn" href="/">View public homepage</a>
</PageHeading>

<section class="guide-launcher card" aria-labelledby="guide-launcher-title">
  <div>
    <p class="eyebrow">Guided recipes</p>
    <h2 id="guide-launcher-title">Coordinate a bounded investigation</h2>
    <p>Choose a fixed analyst recipe. Every collection stage shows its request implications and requires approval before it can be opened.</p>
  </div>
  <form onsubmit={startGuide}>
    <label for="guide-recipe">Recipe</label>
    <select id="guide-recipe" bind:value={guideRecipeId}>
      {#each investigationRecipes as recipe}
        <option value={recipe.id}>{recipe.label}</option>
      {/each}
    </select>
    <p class="recipe-detail">{selectedRecipe.summary}</p>
    <label for="guide-domain">{selectedRecipe.targetLabel}</label>
    <div class="guide-input">
      <input id="guide-domain" bind:value={guideDomain} maxlength="253" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="example.test">
      <button class="primary" type="submit">Start recipe</button>
    </div>
    {#if guideError}<p class="error" role="alert">{guideError}</p>{/if}
    <p class="guide-note">Starting or navigating a recipe does not scan anything. Progress stays in this tab, and each workspace action remains manual.</p>
  </form>
</section>

<InvestigationSearch index={investigationIndex} />

<section class="dashboard-section" aria-labelledby="quick-actions-title">
  <div class="section-intro">
    <p class="eyebrow">Start here</p>
    <h2 id="quick-actions-title">Quick actions</h2>
  </div>
  <div class="quick-grid">
    {#each quickActions as action,index}
      <a class="quick-card card" href={action.href}>
        <span aria-hidden="true">0{index + 1}</span>
        <h3>{action.label}</h3>
        <p>{action.detail}</p>
        <strong>Open <span aria-hidden="true">→</span></strong>
      </a>
    {/each}
  </div>
</section>

<section class="dashboard-section" aria-labelledby="reference-title">
  <div class="section-intro">
    <p class="eyebrow">Reference</p>
    <h2 id="reference-title">Collection support</h2>
    <p>Review implemented compatibility coverage without running a registry query.</p>
  </div>
  <div class="workspace-grid">
    {#each referenceWorkspaces as item}
      <a class="workspace-card card" href={item.href}>
        <span aria-hidden="true">REF</span>
        <div><h3>{item.label}</h3><p>{item.detail}.</p></div>
        <strong aria-hidden="true">→</strong>
      </a>
    {/each}
  </div>
</section>

<section class="dashboard-section" aria-labelledby="local-summary-title">
  <div class="section-intro">
    <p class="eyebrow">Current browser</p>
    <h2 id="local-summary-title">Browser-local workspace summary</h2>
    <p>Counts are derived from bounded local stores and are not sent to the server.</p>
  </div>
  <div class="local-grid">
    <a class="summary-card card" href="/monitor">
      <span>Open cases</span><strong>{counts.openCases}</strong><p>{counts.cases} total saved case{counts.cases === 1 ? '' : 's'}</p>
    </a>
    <a class="summary-card card" href="/monitor">
      <span>Watchlists</span><strong>{counts.watchlists}</strong><p>Saved change-tracking workspace{counts.watchlists === 1 ? '' : 's'}</p>
    </a>
    <a class="summary-card card" href="/brands">
      <span>Brand profiles</span><strong>{counts.profiles}</strong><p>Saved analysis profile{counts.profiles === 1 ? '' : 's'}</p>
    </a>
  </div>
</section>

<WorkspaceArchive onimport={refreshLocalSummary} />

<section class="dashboard-section" aria-labelledby="workspaces-title">
  <div class="section-intro">
    <p class="eyebrow">Console map</p>
    <h2 id="workspaces-title">Investigation workspaces</h2>
  </div>
  <div class="workspace-grid">
    {#each workspaces as item,index}
      <a class="workspace-card card" href={item.href}>
        <span aria-hidden="true">0{index + 1}</span>
        <div><h3>{item.label}</h3><p>{item.detail}.</p></div>
        <strong aria-hidden="true">→</strong>
      </a>
    {/each}
  </div>
</section>

<style>
  .guide-launcher{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(280px,.8fr);gap:24px;margin-top:28px;padding:21px}
  .guide-launcher h2{margin:4px 0 7px;font:700 var(--text-lg) var(--mono)}
  .guide-launcher>div>p:not(.eyebrow){margin:0;color:var(--muted);font-size:var(--text-sm);line-height:1.55}
  .guide-launcher form{align-self:center;min-width:0}
  .guide-launcher label{display:block;margin-bottom:6px;font:700 var(--text-xs) var(--mono)}
  .guide-launcher select{width:100%;margin-bottom:7px}
  .recipe-detail{margin:0 0 13px;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .guide-input{display:flex;gap:7px;min-width:0}
  .guide-input input{min-width:0;flex:1}
  .guide-input button{flex:none;white-space:nowrap}
  .guide-note{margin:7px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .guide-launcher .error{margin:7px 0 0}
  .dashboard-section{margin-top:34px}
  .section-intro{max-width:760px;margin-bottom:14px}
  .section-intro h2{margin:3px 0 0;font:700 1.15rem var(--mono)}
  .section-intro>p:not(.eyebrow){margin:7px 0 0;color:var(--muted);font-size:var(--text-sm);line-height:1.55}
  .quick-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
  .quick-card{display:flex;min-height:210px;flex-direction:column;padding:20px}
  .quick-card>span,.workspace-card>span{color:var(--accent2);font:700 var(--text-2xs) var(--mono)}
  .quick-card h3{margin:22px 0 8px;font:700 var(--text-lg) var(--mono)}
  .quick-card p{margin:0;color:var(--muted);font-size:var(--text-sm);line-height:1.55}
  .quick-card strong{margin-top:auto;padding-top:24px;color:var(--accent);font:700 var(--text-xs) var(--mono)}
  .local-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .summary-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 16px;align-items:start;padding:17px 18px}
  .summary-card>span{color:var(--muted);font:700 var(--text-2xs) var(--mono);letter-spacing:.06em;text-transform:uppercase}
  .summary-card>strong{grid-row:1 / span 2;grid-column:2;color:var(--accent2);font:750 1.7rem var(--mono)}
  .summary-card>p{margin:0;color:var(--text);font-size:var(--text-xs);line-height:1.45}
  .workspace-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .workspace-card{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:13px;align-items:center;padding:15px 17px}
  .workspace-card h3{margin:0;font:700 var(--text-md) var(--mono)}
  .workspace-card p{margin:4px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  .workspace-card>strong{color:var(--accent);font:700 var(--text-lg) var(--mono)}
  @media(max-width:760px){.guide-launcher,.quick-grid,.local-grid,.workspace-grid{grid-template-columns:1fr}.quick-card{min-height:180px}}
  @media(max-width:460px){.guide-input{align-items:stretch;flex-direction:column}.guide-input button{width:100%}}
</style>
