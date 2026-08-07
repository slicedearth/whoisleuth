<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import IntelligenceIcon, { type IntelligenceIconName } from '$lib/components/IntelligenceIcon.svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import InvestigationSearch from '$lib/components/InvestigationSearch.svelte';
  import WorkspaceArchive from '$lib/components/WorkspaceArchive.svelte';
  import InvestigationTemplateManager from '$lib/components/InvestigationTemplateManager.svelte';
  import BrowserLookupHandoff from '$lib/components/BrowserLookupHandoff.svelte';
  import { loadProfiles } from '$lib/brand-profiles';
  import { loadCases } from '$lib/cases';
  import { loadLocalInvestigationSearchIndex } from '$lib/investigation-search';
  import { loadWatchlists } from '$lib/watchlists';
  import {
    investigationRecipes,
    startInvestigationGuide,
    type InvestigationRecipeId,
  } from '$lib/investigation-guide';
  import {
    unavailableInvestigationSearchIndex,
    type InvestigationSearchIndex,
  } from '$lib/analysis/investigation-search.ts';
  import { isExpectedBrowserLocalDataFailure } from '$lib/browser-local-data.ts';
  import { saveCandidateHandoff } from '$lib/candidate-handoff';
  import { parseDomainInput } from '$lib/analysis/utils.ts';
  import { loadInvestigationTemplates, type InvestigationTemplate } from '$lib/investigation-templates';

  const quickActions: Array<{ href: string; label: string; detail: string; icon: IntelligenceIconName }> = [
    { href: '/lookup', label: 'Investigate a target', detail: 'Review a domain, IP address, or ASN across separately identified sources.', icon: 'lookup' },
    { href: '/brands', label: 'Protect owned domains', detail: 'Review externally visible controls, dependencies, mail posture, and expiring attestations.', icon: 'brand' },
    { href: '/bulk', label: 'Review candidates', detail: 'Check a focused list and prioritise which domains need closer review.', icon: 'bulk' },
    { href: '/lookup?depth=deep#query', label: 'Assess acquisition', detail: 'Separate registration confidence, lifecycle, contactability, and apparent use before deciding what to verify manually.', icon: 'registry' },
    { href: '/monitor?view=cases', label: 'Continue case work', detail: 'Return to retained evidence, decisions, response actions, and follow-up dates.', icon: 'case' },
  ];

  let counts = $state({ cases: 0, openCases: 0, watchlists: 0, profiles: 0 });
  let investigationIndex = $state<InvestigationSearchIndex | null>(null);
  let summaryError = $state('');
  let guideDomain = $state('');
  let guideRecipeId = $state<InvestigationRecipeId>('new_domain_triage');
  let guideTemplateId = $state('');
  let templates = $state<InvestigationTemplate[]>([]);
  let guideError = $state('');
  let compareLeft = $state('');
  let compareRight = $state('');
  let compareError = $state('');
  const selectedRecipe = $derived(investigationRecipes.find((recipe) => recipe.id === guideRecipeId) || investigationRecipes[0]);
  const compatibleTemplates = $derived(templates.filter((template) => template.recipeId === guideRecipeId));

  async function refreshLocalSummary() {
    summaryError = '';
    try {
      const [cases, watchlists, profiles, searchIndex, savedTemplates] = await Promise.all([
        loadCases(),
        loadWatchlists(),
        loadProfiles(),
        loadLocalInvestigationSearchIndex(),
        loadInvestigationTemplates(),
      ]);
      counts = {
        cases: cases.length,
        openCases: cases.filter((record) => record.status !== 'resolved').length,
        watchlists: Object.keys(watchlists).length,
        profiles: profiles.length,
      };
      investigationIndex = searchIndex;
      templates = savedTemplates;
    } catch (cause) {
      summaryError = 'Saved-work counts and local search could not be refreshed. Reload the Dashboard to try again.';
      investigationIndex ??= unavailableInvestigationSearchIndex(summaryError);
      if (!isExpectedBrowserLocalDataFailure(cause)) throw cause;
    }
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

  async function compareDomains(event: SubmitEvent) {
    event.preventDefault();
    compareError = '';
    const parsed = parseDomainInput(`${compareLeft}\n${compareRight}`);
    if (parsed.entries.length !== 2) {
      compareError = 'Enter two different valid domains without URLs, paths, or ports.';
      return;
    }
    const handoffResult = saveCandidateHandoff('manual', parsed.entries.map((domain) => ({
      domain,
      source: 'analyst comparison',
      mutationTypes: [],
    })));
    if (!handoffResult.saved) {
      compareError = 'This browser could not retain the comparison targets for Bulk. Check site-storage access and try again.';
      return;
    }
    await goto(`/bulk?source=manual&handoff=${handoffResult.token}#domains`);
  }
</script>

<svelte:head>
  <title>Dashboard · WHOISleuth</title>
  <meta name="description" content="Start or continue a WHOISleuth domain investigation from the protected console's Dashboard.">
</svelte:head>

<PageHeading eyebrow="Console" title="Dashboard" description="Start new work, continue something saved in this browser, or follow a step-by-step guide.">
  <a class="btn" href="/">View public homepage</a>
</PageHeading>

<section class="dashboard-section" aria-labelledby="quick-actions-title">
  <div class="section-intro">
    <p class="eyebrow">Start here</p>
    <h2 id="quick-actions-title">Start an investigation</h2>
    <p>Choose the task that best matches what you need to learn. Nothing runs until you submit a check in the tool you open.</p>
  </div>
  <div class="quick-grid">
    {#each quickActions as action,index}
      <a class="quick-card card" href={action.href}>
        <span class="quick-meta" aria-hidden="true"><span>0{index + 1}</span><span class="quick-icon"><IntelligenceIcon name={action.icon} size={22} /></span></span>
        <h3>{action.label}</h3>
        <p>{action.detail}</p>
        <strong>Open <span aria-hidden="true">→</span></strong>
      </a>
    {/each}
  </div>
</section>

<section class="dashboard-section" aria-labelledby="local-summary-title">
  <div class="section-intro">
    <p class="eyebrow">Saved in this browser</p>
    <h2 id="local-summary-title">Continue saved work</h2>
    <p>Open retained cases, watchlists, and brand profiles. These counts stay in this browser and are not sent to the server.</p>
  </div>
  <div class="local-grid">
    <a class="summary-card card" href="/monitor?view=cases">
      <span class="summary-icon" aria-hidden="true"><IntelligenceIcon name="case" size={19} /></span><span class="summary-label">Open cases</span><strong>{counts.openCases}</strong><p>{counts.cases} total saved case{counts.cases === 1 ? '' : 's'}</p>
    </a>
    <a class="summary-card card" href="/monitor?view=watchlists">
      <span class="summary-icon" aria-hidden="true"><IntelligenceIcon name="watchlist" size={19} /></span><span class="summary-label">Watchlists</span><strong>{counts.watchlists}</strong><p>Saved change-tracking list{counts.watchlists === 1 ? '' : 's'}</p>
    </a>
    <a class="summary-card card" href="/brands">
      <span class="summary-icon" aria-hidden="true"><IntelligenceIcon name="brand" size={19} /></span><span class="summary-label">Brand profiles</span><strong>{counts.profiles}</strong><p>Saved analysis profile{counts.profiles === 1 ? '' : 's'}</p>
    </a>
  </div>
  <p class="summary-error" role="status">{summaryError}</p>
</section>

<section class="domain-compare card" aria-labelledby="domain-compare-title">
  <div>
    <p class="eyebrow">Focused comparison</p>
    <h2 id="domain-compare-title">Compare two domains</h2>
    <p>Load exactly two analyst-selected domains into Bulk. The comparison keeps registration, DNS, TLS, page, source-health, and infrastructure rows separate and does not imply common control.</p>
  </div>
  <form onsubmit={compareDomains}>
    <label for="compare-left">First domain</label>
    <input id="compare-left" bind:value={compareLeft} maxlength="253" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="first.example">
    <label for="compare-right">Second domain</label>
    <input id="compare-right" bind:value={compareRight} maxlength="253" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="second.example">
    <button class="primary" type="submit">Load comparison</button>
    {#if compareError}<p class="error" role="alert">{compareError}</p>{/if}
  </form>
</section>

<BrowserLookupHandoff />

<InvestigationSearch index={investigationIndex} />

<section class="guide-launcher card" aria-labelledby="guide-launcher-title">
  <div>
    <p class="eyebrow">Step-by-step help</p>
    <h2 id="guide-launcher-title">Follow a guided investigation</h2>
    <p>Choose a guide and a domain. WHOISleuth saves progress in this tab so you can work through one clearly explained step at a time.</p>
    <nav class="help-links" aria-label="Investigation help">
      <a href="/guide"><strong>Read the guide</strong><span>Learn the tools, result states, and common mistakes.</span></a>
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
    <select id="guide-template" bind:value={guideTemplateId}>
      <option value="">Standard guide</option>
      {#each compatibleTemplates as template}
        <option value={template.id}>{template.label}</option>
      {/each}
    </select>
    <p class="recipe-detail">{guideTemplateId ? 'Uses your saved local labels, guidance, included steps, and additional approval gates.' : 'Uses the reviewed standard steps.'}</p>
    <label for="guide-domain">{selectedRecipe?.targetLabel ?? 'Domain'}</label>
    <div class="guide-input">
      <input id="guide-domain" bind:value={guideDomain} maxlength="253" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="example.test">
      <button class="primary" type="submit">Start guide</button>
    </div>
    {#if guideError}<p class="error" role="alert">{guideError}</p>{/if}
    <p class="guide-note">Starting a guide only saves its steps. Before a network step, you review what it requests and allow that step. Opening a tool only takes you there; you still start the check yourself.</p>
  </form>
</section>

<InvestigationTemplateManager {templates} onchange={(value) => { templates = value; if (!value.some((item) => item.id === guideTemplateId)) guideTemplateId = ''; }} />

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
  .quick-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px}
  .quick-card{display:flex;min-height:210px;flex-direction:column;padding:20px}
  .quick-meta{display:flex;align-items:center;justify-content:space-between;color:var(--accent2);font:700 var(--text-2xs) var(--mono)}
  .quick-icon{display:grid;width:38px;height:38px;place-items:center;border:1px solid color-mix(in srgb,var(--accent) 48%,var(--border));border-radius:50%;background:rgb(var(--accent-rgb) / .07);color:var(--accent);transition:border-color .16s,background .16s,box-shadow .16s,transform .16s}
  .quick-card:hover .quick-icon,.quick-card:focus-visible .quick-icon{border-color:var(--accent);background:rgb(var(--accent-rgb) / .12);box-shadow:0 0 18px rgb(var(--accent-rgb) / .12);transform:translateY(-1px)}
  .quick-card h3{margin:16px 0 8px;font:700 var(--text-lg) var(--mono)}
  .quick-card p{margin:0;color:var(--muted);font-size:var(--text-sm);line-height:1.55}
  .quick-card strong{margin-top:auto;padding-top:24px;color:var(--accent);font:700 var(--text-xs) var(--mono)}
  .local-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .summary-card{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:5px 10px;align-items:center;padding:17px 18px}
  .summary-icon{display:grid;width:32px;height:32px;grid-row:1 / span 2;place-items:center;border:1px solid color-mix(in srgb,var(--accent2) 42%,var(--border));border-radius:50%;background:rgb(var(--accent2-rgb) / .06);color:var(--accent2)}
  .summary-label{color:var(--muted);font:700 var(--text-2xs) var(--mono);letter-spacing:.06em;text-transform:uppercase}
  .summary-card>strong{grid-row:1 / span 2;grid-column:3;color:var(--accent2);font:750 1.7rem var(--mono)}
  .summary-card>p{grid-column:2;margin:0;color:var(--text);font-size:var(--text-xs);line-height:1.45}
  .domain-compare{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.72fr);gap:24px;margin-top:28px;padding:21px}
  .domain-compare h2{margin:4px 0 7px;font:700 var(--text-lg) var(--mono)}
  .domain-compare>div>p:not(.eyebrow){margin:0;color:var(--muted);font-size:var(--text-sm);line-height:1.55}
  .domain-compare form{display:grid;grid-template-columns:1fr 1fr;gap:7px;align-self:center}
  .domain-compare form label{font:700 var(--text-xs) var(--mono)}
  .domain-compare form button,.domain-compare form .error{grid-column:1/-1}
  @media(prefers-reduced-motion:reduce){.quick-icon{transition:none}.quick-card:hover .quick-icon,.quick-card:focus-visible .quick-icon{transform:none}}
  @media(max-width:1120px){.quick-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
  @media(max-width:760px){.guide-launcher,.quick-grid,.local-grid,.domain-compare{grid-template-columns:1fr}.quick-card{min-height:180px}}
  @media(max-width:520px){.domain-compare form{grid-template-columns:1fr}}
  @media(max-width:460px){.guide-input{align-items:stretch;flex-direction:column}.guide-input button{width:100%}}
</style>
