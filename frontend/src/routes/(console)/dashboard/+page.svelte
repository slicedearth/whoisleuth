<script lang="ts">
  import { onMount } from 'svelte';
  import IntelligenceIcon, { type IntelligenceIconName } from '$lib/components/IntelligenceIcon.svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import InvestigationSearch from '$lib/components/InvestigationSearch.svelte';
  import WorkspaceArchive from '$lib/components/WorkspaceArchive.svelte';
  import InvestigationTemplateManager from '$lib/components/InvestigationTemplateManager.svelte';
  import BrowserLookupHandoff from '$lib/components/BrowserLookupHandoff.svelte';
  import { loadProfiles } from '$lib/brand-profiles';
  import { loadCampaigns } from '$lib/campaigns';
  import { loadCases } from '$lib/cases';
  import { buildLocalInvestigationSearchIndex } from '$lib/investigation-search';
  import { loadRelationshipObservations } from '$lib/relationship-observations';
  import { loadWatchlists } from '$lib/watchlists';
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
  import { publicHomepage, publicResources } from '$lib/workspaces';

  const publicResource = publicResources[0];

  type WorkflowAction = { href: string; label: string; detail: string; icon: IntelligenceIconName; taskPack?: true };
  const workflowLanes: Array<{
    id: 'investigate' | 'respond' | 'assure';
    label: string;
    detail: string;
    icon: IntelligenceIconName;
    actions: WorkflowAction[];
  }> = [
    {
      id: 'investigate',
      label: 'Investigate',
      detail: 'Collect and compare source-attributed evidence for one target or a bounded candidate set.',
      icon: 'lookup',
      actions: [
        { href: '/lookup', label: 'Lookup a target', detail: 'Review one domain, IP address, or ASN.', icon: 'lookup' },
        { href: '/discover', label: 'Discover candidates', detail: 'Generate or search bounded domain leads.', icon: 'discover' },
        { href: '/bulk', label: 'Triage a list', detail: 'Compare a focused set without broadening collection.', icon: 'bulk' },
        { href: '/lookup?depth=deep&task=acquisition#query', label: 'Acquisition task pack', detail: 'Open Lookup with acquisition-readiness context; no request starts automatically.', icon: 'registry', taskPack: true },
      ],
    },
    {
      id: 'respond',
      label: 'Respond',
      detail: 'Continue retained review work, prepare bounded response material, and document follow-up.',
      icon: 'case',
      actions: [
        { href: '/monitor', label: 'Review inbox', detail: 'Prioritise unfinished retained work.', icon: 'analysis' },
        { href: '/monitor?view=cases', label: 'Cases & response', detail: 'Review evidence, decisions, and response preparation.', icon: 'case' },
        { href: '/monitor?view=campaigns', label: 'Campaign review', detail: 'Review analyst-defined cohorts and hand-offs.', icon: 'discover' },
      ],
    },
    {
      id: 'assure',
      label: 'Assure',
      detail: 'Review retained change evidence, watchlists, owned-domain profiles, and local controls.',
      icon: 'brand',
      actions: [
        { href: '/monitor?view=timeline', label: 'Monitoring history', detail: 'Compare retained observations and material changes.', icon: 'analysis' },
        { href: '/monitor?view=watchlists', label: 'Watchlists', detail: 'Review saved change-tracking lists.', icon: 'watchlist' },
        { href: '/monitor?view=rules', label: 'Control rules', detail: 'Review browser-local detection rules.', icon: 'registry' },
        { href: '/brands', label: 'Owned-domain controls', detail: 'Review profiles, dependencies, and control posture.', icon: 'brand' },
      ],
    },
  ];

  type LocalCounts = { cases: number | null; openCases: number | null; watchlists: number | null; profiles: number | null };

  let counts = $state<LocalCounts>({ cases: null, openCases: null, watchlists: null, profiles: null });
  let investigationIndex = $state<InvestigationSearchIndex | null>(null);
  let summaryPending = $state(true);
  let summaryError = $state('');
  let guideDomain = $state('');
  let guideRecipeId = $state<InvestigationRecipeId>('new_domain_triage');
  let guideTemplateId = $state('');
  let templates = $state<InvestigationTemplate[]>([]);
  let templateLoadState = $state<'loading' | 'ready' | 'unavailable'>('loading');
  let guideError = $state('');
  const selectedRecipe = $derived(investigationRecipes.find((recipe) => recipe.id === guideRecipeId) || investigationRecipes[0]);
  const compatibleTemplates = $derived(templates.filter((template) => template.recipeId === guideRecipeId));

  async function refreshLocalSummary() {
    summaryPending = true;
    templateLoadState = 'loading';
    summaryError = '';
    const results = await Promise.allSettled([
        loadCases(),
        loadWatchlists(),
        loadProfiles(),
        loadCampaigns(),
        loadRelationshipObservations(),
        loadInvestigationTemplates(),
      ]);
    summaryPending = false;
    const [caseResult, watchlistResult, profileResult, campaignResult, relationshipResult, templateResult] = results;
    const expectedFailures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .filter((result) => isExpectedBrowserLocalDataFailure(result.reason));
    const unexpectedFailure = results.find((result): result is PromiseRejectedResult =>
      result.status === 'rejected' && !isExpectedBrowserLocalDataFailure(result.reason));

    counts = {
      cases: caseResult?.status === 'fulfilled' ? caseResult.value.length : null,
      openCases: caseResult?.status === 'fulfilled' ? caseResult.value.filter((record) => record.status !== 'resolved').length : null,
      watchlists: watchlistResult?.status === 'fulfilled' ? Object.keys(watchlistResult.value).length : null,
      profiles: profileResult?.status === 'fulfilled' ? profileResult.value.length : null,
    };
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
    if (expectedFailures.length > 0) {
      summaryError = 'Some browser-local collections are unavailable. Available saved work is still shown below.';
    }
    if (unexpectedFailure) throw unexpectedFailure.reason;
  }

  function countText(value: number | null): string {
    return value === null ? (summaryPending ? 'Loading' : 'Unavailable') : String(value);
  }

  function countDetail(value: number | null, ready: string, unavailable: string): string {
    if (value !== null) return ready;
    return summaryPending ? 'Loading browser-local count' : unavailable;
  }

  onMount(()=>{
    void refreshLocalSummary();
  });

  function startGuide(event:SubmitEvent) {
    event.preventDefault();
    guideError = '';
    try {
      const template = compatibleTemplates.find((candidate) => candidate.id === guideTemplateId) || null;
      startInvestigationGuide(guideDomain, guideRecipeId, template);
    } catch (cause) {
      guideError = cause instanceof Error ? cause.message : 'Could not start the guided investigation.';
    }
  }

</script>

<svelte:head>
  <title>Dashboard · WHOISleuth</title>
  <meta name="description" content="Start or continue a WHOISleuth domain investigation from the protected console's Dashboard.">
</svelte:head>

<PageHeading eyebrow="Console" title="Dashboard" description="Start or resume Investigate, Respond, and Assure work without beginning a request automatically.">
  <a class="btn" href={publicHomepage.href} target="_blank" rel="noopener noreferrer" aria-label="View public homepage. Opens in a new tab.">View public homepage</a>
</PageHeading>

<section class="dashboard-section" aria-labelledby="quick-actions-title">
  <div class="section-intro">
    <p class="eyebrow">Start here</p>
    <h2 id="quick-actions-title">Choose an analyst job</h2>
    <p>Dashboard is the stable starting point. Opening any destination only navigates there; collection still requires an explicit submission.</p>
  </div>
  <div class="workflow-grid">
    {#each workflowLanes as lane,index}
      <article class="workflow-lane" data-workflow={lane.id}>
        <header>
          <span class="workflow-meta" aria-hidden="true"><span>0{index + 1}</span><span class="workflow-icon"><IntelligenceIcon name={lane.icon} size={22} /></span></span>
          <p class="eyebrow">Analyst job</p>
          <h3>{lane.label}</h3>
          <p class="workflow-detail">{lane.detail}</p>
        </header>
        <nav aria-label={`${lane.label} actions`}>
          {#each lane.actions as action}
            <a class="workflow-action" data-task-pack={action.taskPack ? 'acquisition' : undefined} href={action.href}>
              <span class="action-icon" aria-hidden="true"><IntelligenceIcon name={action.icon} size={18} /></span>
              <span><strong>{action.label}</strong><small>{action.detail}</small></span>
              <span class="action-arrow" aria-hidden="true">→</span>
            </a>
          {/each}
        </nav>
      </article>
    {/each}
  </div>
</section>

<section class="dashboard-section" aria-labelledby="local-summary-title" aria-busy={summaryPending}>
  <div class="section-intro">
    <p class="eyebrow">Saved in this browser</p>
    <h2 id="local-summary-title">Continue saved work</h2>
    <p>Open retained cases, watchlists, and brand profiles. These counts stay in this browser and are not sent to the server.</p>
  </div>
  <div class="local-grid">
    <a class="summary-card card" href="/monitor?view=cases">
      <span class="summary-icon" aria-hidden="true"><IntelligenceIcon name="case" size={19} /></span><span class="summary-label">Open cases</span><strong>{countText(counts.openCases)}</strong><p>{countDetail(counts.cases, `${counts.cases} total saved case${counts.cases === 1 ? '' : 's'}`, 'Case count unavailable')}</p>
    </a>
    <a class="summary-card card" href="/monitor?view=watchlists">
      <span class="summary-icon" aria-hidden="true"><IntelligenceIcon name="watchlist" size={19} /></span><span class="summary-label">Watchlists</span><strong>{countText(counts.watchlists)}</strong><p>{countDetail(counts.watchlists, `Saved change-tracking list${counts.watchlists === 1 ? '' : 's'}`, 'Watchlist count unavailable')}</p>
    </a>
    <a class="summary-card card" href="/brands">
      <span class="summary-icon" aria-hidden="true"><IntelligenceIcon name="brand" size={19} /></span><span class="summary-label">Brand profiles</span><strong>{countText(counts.profiles)}</strong><p>{countDetail(counts.profiles, `Saved analysis profile${counts.profiles === 1 ? '' : 's'}`, 'Profile count unavailable')}</p>
    </a>
  </div>
  <p class="summary-error" role="status">{summaryError}</p>
</section>

<BrowserLookupHandoff />

<InvestigationSearch index={investigationIndex} />

<section class="guide-launcher card" aria-labelledby="guide-launcher-title">
  <div>
    <p class="eyebrow">Step-by-step help</p>
    <h2 id="guide-launcher-title">Follow a guided investigation</h2>
    <p>Choose a guide and a domain. WHOISleuth saves progress in this tab so you can work through one clearly explained step at a time.</p>
    <nav class="help-links" aria-label="Investigation help">
      {#if publicResource}<a href={`${publicResource.href}#start`} target="_blank" rel="noopener noreferrer" aria-label="Open resources. Learn the tools, result states, common mistakes, and source boundaries. Opens in a new tab."><strong>Open resources</strong><span>Learn the tools, result states, common mistakes, and source boundaries.</span></a>{/if}
      <a href="/registry-support"><strong>Check domain-ending support</strong><span>See which domain endings have tested lookup support and known limits.</span></a>
    </nav>
  </div>
  <form onsubmit={startGuide}>
    <label for="guide-recipe">Guide</label>
    <select id="guide-recipe" bind:value={guideRecipeId} onchange={() => { guideTemplateId = ''; }}>
      {#each investigationRecipes as recipe}
        <option value={recipe.id}>{recipe.label}</option>
      {/each}
    </select>
    <p class="recipe-detail">{selectedRecipe?.summary ?? ''}</p>
    <label for="guide-template">Template</label>
    <select id="guide-template" bind:value={guideTemplateId} disabled={templateLoadState !== 'ready'}>
      <option value="">Standard guide</option>
      {#each compatibleTemplates as template}
        <option value={template.id}>{template.label}</option>
      {/each}
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
</section>

<InvestigationTemplateManager {templates} loadState={templateLoadState} onchange={(value) => { templates = value; if (!value.some((item) => item.id === guideTemplateId)) guideTemplateId = ''; }} />

<WorkspaceArchive onimport={refreshLocalSummary} />

<style>
  .summary-error{margin:14px 0 0;color:var(--amber);font-size:var(--text-sm)}
  .summary-error:empty{display:none}
  .guide-launcher{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(280px,.8fr);gap:24px;margin-top:28px;padding:21px}
  .guide-launcher h2{margin:4px 0 7px;font:700 var(--text-lg) var(--mono)}
  .guide-launcher>div>p:not(.eyebrow){margin:0;color:var(--muted);font-size:var(--text-sm);line-height:1.55}
  .help-links{display:grid;gap:7px;margin-top:18px}
  .help-links a{display:grid;gap:2px;padding:10px 11px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  .help-links a:hover,.help-links a:focus-visible{border-color:var(--accent);background:rgb(var(--accent-rgb) / .06)}
  .help-links strong{font:700 var(--text-xs) var(--mono)}
  .help-links span{color:var(--muted);font-size:var(--text-2xs);line-height:1.4}
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
  .workflow-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
  .workflow-lane{display:grid;min-width:0;align-content:start;border:1px solid var(--border);border-radius:var(--radius-md);background:rgb(var(--panel-rgb) / .55);overflow:hidden}
  .workflow-lane>header{display:grid;min-height:174px;align-content:start;padding:18px;border-bottom:1px solid var(--border)}
  .workflow-meta{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;color:var(--interface-accent);font:700 var(--text-2xs) var(--mono)}
  .workflow-icon{display:grid;width:38px;height:38px;place-items:center;border:1px solid color-mix(in srgb,var(--accent) 48%,var(--border));border-radius:50%;background:rgb(var(--accent-rgb) / .07);color:var(--accent)}
  .workflow-lane h3{margin:5px 0 0;font:700 var(--text-lg) var(--mono)}
  .workflow-detail{margin:7px 0 0;color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  .workflow-lane nav{display:grid;margin:0;padding:7px}
  .workflow-action{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:8px;align-items:center;min-width:0;padding:10px;border:1px solid transparent;border-radius:var(--radius-sm)}
  .workflow-action:hover,.workflow-action:focus-visible{border-color:var(--border-strong);background:rgb(var(--accent-rgb) / .06)}
  .action-icon{display:grid;width:28px;height:28px;place-items:center;color:var(--accent)}
  .workflow-action>span:nth-child(2){min-width:0}
  .workflow-action strong,.workflow-action small{display:block;overflow-wrap:anywhere}
  .workflow-action strong{color:var(--text);font:700 var(--text-xs) var(--mono)}
  .workflow-action small{margin-top:3px;color:var(--muted);font-size:var(--text-2xs);line-height:1.4}
  .action-arrow{color:var(--accent);font:700 var(--text-sm) var(--mono)}
  .local-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .summary-card{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:5px 10px;align-items:center;padding:17px 18px}
  .summary-icon{display:grid;width:32px;height:32px;grid-row:1 / span 2;place-items:center;border:1px solid color-mix(in srgb,var(--interface-accent) 42%,var(--border));border-radius:50%;background:rgb(var(--interface-accent-rgb) / .06);color:var(--interface-accent)}
  .summary-label{color:var(--muted);font:700 var(--text-2xs) var(--mono);letter-spacing:.06em;text-transform:uppercase}
  .summary-card>strong{grid-row:1 / span 2;grid-column:3;color:var(--interface-accent);font:750 1.7rem var(--mono)}
  .summary-card>p{grid-column:2;margin:0;color:var(--text);font-size:var(--text-xs);line-height:1.45}
  @media(max-width:980px){.workflow-grid{grid-template-columns:minmax(0,1fr)}.workflow-lane>header{min-height:0}}
  @media(max-width:760px){.guide-launcher,.local-grid{grid-template-columns:1fr}}
  @media(max-width:460px){.guide-input{align-items:stretch;flex-direction:column}.guide-input button{width:100%}}
</style>
