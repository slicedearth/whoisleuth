<script lang="ts">
  import { onMount } from 'svelte';
  import BrowserLookupHandoff from '$lib/components/BrowserLookupHandoff.svelte';
  import InvestigationSearch from '$lib/components/InvestigationSearch.svelte';
  import InvestigationTemplateManager from '$lib/components/InvestigationTemplateManager.svelte';
  import WorkspaceArchive from '$lib/components/WorkspaceArchive.svelte';
  import { loadCampaigns } from '$lib/campaigns';
  import { loadCases } from '$lib/cases';
  import { loadProfiles } from '$lib/brand-profiles';
  import { buildLocalInvestigationSearchIndex } from '$lib/investigation-search';
  import { loadRelationshipObservations } from '$lib/relationship-observations';
  import {
    investigationRecipes,
    startInvestigationGuide,
    type InvestigationRecipeId,
  } from '$lib/investigation-guide';
  import {
    markInvestigationSearchSourcesUnavailable,
    unavailableInvestigationSearchIndex,
    type InvestigationSearchIndex,
  } from '$lib/analysis/investigation-search.ts';
  import type { InvestigationStoreName } from '$lib/analysis/investigation-projection.ts';
  import { isExpectedBrowserLocalDataFailure } from '$lib/browser-local-data.ts';
  import { loadInvestigationTemplates, type InvestigationTemplate } from '$lib/investigation-templates';
  import { publicResources } from '$lib/workspaces';

  let { onsummarychange, mode = 'all' }: {
    onsummarychange?: (message?: string) => void | Promise<void>;
    mode?: 'all' | 'guide' | 'import';
  } = $props();

  const publicResource = publicResources[0];
  let investigationIndex = $state<InvestigationSearchIndex | null>(null);
  let guideDomain = $state('');
  let guideRecipeId = $state<InvestigationRecipeId>('new_domain_triage');
  let guideTemplateId = $state('');
  let templates = $state<InvestigationTemplate[]>([]);
  let templateLoadState = $state<'loading' | 'ready' | 'unavailable'>('loading');
  let guideError = $state('');
  let workspaceMessage = $state('');
  const selectedRecipe = $derived(investigationRecipes.find((recipe) => recipe.id === guideRecipeId) || investigationRecipes[0]);
  const compatibleTemplates = $derived(templates.filter((template) => template.recipeId === guideRecipeId));

  async function refreshSecondaryWorkspaces() {
    templateLoadState = 'loading';
    workspaceMessage = '';
    const results = await Promise.allSettled([
      loadCases(),
      loadCampaigns(),
      loadProfiles(),
      loadRelationshipObservations(),
      loadInvestigationTemplates(),
    ]);
    const [caseResult, campaignResult, profileResult, relationshipResult, templateResult] = results;
    if (templateResult?.status === 'fulfilled') {
      templates = templateResult.value;
      templateLoadState = 'ready';
    } else {
      templateLoadState = 'unavailable';
      guideTemplateId = '';
    }

    const searchResults = [caseResult, campaignResult, profileResult, relationshipResult];
    if (searchResults.some((result) => result?.status === 'fulfilled')) {
      const unavailableStores: InvestigationStoreName[] = [];
      if (caseResult?.status === 'rejected') unavailableStores.push('cases');
      if (campaignResult?.status === 'rejected') unavailableStores.push('campaigns');
      if (profileResult?.status === 'rejected') unavailableStores.push('brandProfiles');
      if (relationshipResult?.status === 'rejected') unavailableStores.push('relationshipObservations');
      investigationIndex = markInvestigationSearchSourcesUnavailable(buildLocalInvestigationSearchIndex({
        cases: caseResult?.status === 'fulfilled' ? caseResult.value : undefined,
        campaigns: campaignResult?.status === 'fulfilled' ? campaignResult.value : undefined,
        brandProfiles: profileResult?.status === 'fulfilled' ? profileResult.value : undefined,
        relationshipObservations: relationshipResult?.status === 'fulfilled' ? relationshipResult.value : undefined,
      }), unavailableStores);
    } else {
      investigationIndex = unavailableInvestigationSearchIndex('Saved-work search is unavailable because one or more required browser-local collections could not be read.');
    }
    const expectedFailures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .filter((result) => isExpectedBrowserLocalDataFailure(result.reason));
    const unexpectedFailure = results.find((result): result is PromiseRejectedResult =>
      result.status === 'rejected' && !isExpectedBrowserLocalDataFailure(result.reason));
    if (expectedFailures.length > 0) workspaceMessage = 'Some browser-local workspaces are unavailable. Available saved work remains usable.';
    if (unexpectedFailure) throw unexpectedFailure.reason;
  }

  async function handleArchiveImport(resultMessage: string) {
    await Promise.all([refreshSecondaryWorkspaces(), onsummarychange?.(resultMessage)]);
    workspaceMessage = workspaceMessage ? `${resultMessage} ${workspaceMessage}` : resultMessage;
  }

  function startGuide(event: SubmitEvent) {
    event.preventDefault();
    guideError = '';
    try {
      const template = compatibleTemplates.find((candidate) => candidate.id === guideTemplateId) || null;
      startInvestigationGuide(guideDomain, guideRecipeId, template);
    } catch (cause) {
      guideError = cause instanceof Error ? cause.message : 'Could not start the guided investigation.';
    }
  }

  onMount(() => {
    void refreshSecondaryWorkspaces();
  });
</script>

<section class="secondary-workspaces" aria-labelledby="secondary-workspaces-title">
  <h2 id="secondary-workspaces-title" tabindex="-1">{mode === 'all' ? 'Saved-work tools' : mode === 'guide' ? 'Start a guided investigation' : 'Import existing work'}</h2>
  <p class="workspace-message" role="status" aria-live="polite">{workspaceMessage}</p>

  {#if mode === 'all'}
    <BrowserLookupHandoff />
    <InvestigationSearch index={investigationIndex} />
  {/if}

  {#if mode !== 'import'}<section class="guide-launcher card" aria-labelledby="guide-launcher-title">
    <div>
      <p class="eyebrow">Step-by-step help</p>
      <h3 id="guide-launcher-title">Follow a guided investigation</h3>
      <p>Choose a guide and a domain. WHOISleuth saves progress in this tab so you can work through one clearly explained step at a time.</p>
      <nav class="help-links" aria-label="Investigation help">
        {#if publicResource}<a href={`${publicResource.href}#start`} target="_blank" rel="noopener noreferrer" aria-label="Open resources. Learn the tools, result states, common mistakes, and source boundaries. Opens in a new tab."><strong>Open resources</strong><span>Learn the tools, result states, common mistakes, and source boundaries.</span></a>{/if}
        <a href="/registry-support"><strong>Check domain-ending support</strong><span>See which domain endings have tested lookup support and known limits.</span></a>
      </nav>
    </div>
    <form onsubmit={startGuide}>
      <label for="guide-recipe">Guide</label>
      <select id="guide-recipe" bind:value={guideRecipeId} onchange={() => { guideTemplateId = ''; }}>
        {#each investigationRecipes as recipe}<option value={recipe.id}>{recipe.label}</option>{/each}
      </select>
      <p class="recipe-detail">{selectedRecipe?.summary ?? ''}</p>
      <label for="guide-template">Template</label>
      <select id="guide-template" bind:value={guideTemplateId} disabled={templateLoadState !== 'ready'}>
        <option value="">Standard guide</option>
        {#each compatibleTemplates as template}<option value={template.id}>{template.label}</option>{/each}
      </select>
      <p class="recipe-detail">{templateLoadState === 'unavailable' ? 'Saved templates are unavailable; the reviewed standard steps remain available.' : guideTemplateId ? 'Uses your saved local labels, guidance, included steps, and additional approval gates.' : 'Uses the reviewed standard steps.'}</p>
      <label for="guide-domain">{selectedRecipe?.targetLabel ?? 'Domain'}</label>
      <div class="guide-input">
        <input id="guide-domain" bind:value={guideDomain} maxlength="253" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="example.test">
        <button class="primary" type="submit">Start guide</button>
      </div>
      {#if guideError}<p class="error" role="alert">{guideError}</p>{/if}
      <p class="guide-note">Starting a guide only saves its steps. Before a network step, you review what it requests and allow that step. Opening a tool only takes you there; you still start the check yourself.</p>
    </form>
  </section>{/if}

  {#if mode === 'all'}<InvestigationTemplateManager {templates} loadState={templateLoadState} onchange={(value) => { templates = value; if (!value.some((item) => item.id === guideTemplateId)) guideTemplateId = ''; }} />{/if}
  {#if mode !== 'guide'}<WorkspaceArchive onimport={handleArchiveImport} importOnly={mode === 'import'} />{/if}
</section>

<style>
  .secondary-workspaces{min-width:0;margin-top:20px;overflow-wrap:anywhere}.secondary-workspaces>h2{margin:0;font:700 var(--text-lg) var(--mono)}.secondary-workspaces>h2:focus{outline:none}.secondary-workspaces>h2:focus-visible{outline:2px solid var(--focus);outline-offset:5px}.workspace-message{margin:8px 0 0;color:var(--amber);font-size:var(--text-sm)}.workspace-message:empty{display:none}
  .guide-launcher{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(280px,.8fr);gap:24px;margin-top:28px;padding:21px}.guide-launcher h3{margin:4px 0 7px;font:700 var(--text-lg) var(--mono)}.guide-launcher>div>p:not(.eyebrow){margin:0;color:var(--muted);font-size:var(--text-sm);line-height:1.55}.help-links{display:grid;gap:7px;margin-top:18px}.help-links a{display:grid;gap:2px;padding:10px 11px;border:1px solid var(--border);border-radius:var(--radius-sm)}.help-links a:hover,.help-links a:focus-visible{border-color:var(--accent);background:rgb(var(--accent-rgb) / .06)}.help-links strong{font:700 var(--text-xs) var(--mono)}.help-links span{color:var(--muted);font-size:var(--text-2xs);line-height:1.4}.guide-launcher form{align-self:center;min-width:0}.guide-launcher label{display:block;margin-bottom:6px;font:700 var(--text-xs) var(--mono)}.guide-launcher select{width:100%;margin-bottom:7px}.recipe-detail{margin:0 0 13px;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}.guide-input{display:flex;gap:7px;min-width:0}.guide-input input{min-width:0;flex:1}.guide-input button{flex:none;white-space:nowrap}.guide-note{margin:7px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}.guide-launcher .error{margin:7px 0 0}
  @media(max-width:760px){.guide-launcher{grid-template-columns:1fr}}
  @media(max-width:460px){.guide-input{align-items:stretch;flex-direction:column}.guide-input button{width:100%}}
</style>
