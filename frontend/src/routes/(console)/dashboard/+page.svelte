<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import IntelligenceIcon from '$lib/components/IntelligenceIcon.svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import DashboardAttentionSummary from '$lib/components/DashboardAttentionSummary.svelte';
  import DeferredSurface from '$lib/components/DeferredSurface.svelte';
  import { readBrowserLocalData } from '$lib/browser-local-data-service.ts';
  import { isExpectedBrowserLocalDataFailure } from '$lib/browser-local-data.ts';
  import type { BrowserLocalCollectionDocumentMap } from '$lib/browser-local-data-definitions.ts';
  import { preloadBestEffort, preloadOnIdle } from '$lib/idle-preload';
  import { loadDeferredModule } from '$lib/deferred-module';
  import {
    DASHBOARD_REQUIRED_COLLECTION_IDS,
    buildDashboardAttentionSummary,
    dashboardCollectionRecordCount,
    dashboardWorkspaceState,
    type DashboardAttentionSummary as DashboardAttentionSummaryModel,
    type DashboardWorkspaceState,
  } from '$lib/analysis/dashboard-workspace-state.ts';
  import { publicHomepage } from '$lib/workspaces';
  import { caseStatusIsClosed, statusLabel } from '$lib/analysis/case-record-decisions.ts';
  import { ANALYST_REVIEW_REQUIRED_COLLECTION_IDS } from '$lib/analysis/analyst-review-source-state.ts';
  let workspaceManagerRequested = $state(false);
  let lookupTarget = $state('');
  let recentCases = $state<BrowserLocalCollectionDocumentMap['cases']>([]);

  function openLookup(event: SubmitEvent) {
    event.preventDefault();
    if (lookupTarget.trim()) void goto(`/lookup?${new URLSearchParams({ q: lookupTarget.trim() })}`);
  }


  type LocalCounts = { cases: number | null; openCases: number | null; watchlists: number | null; profiles: number | null };

  let counts = $state<LocalCounts>({ cases: null, openCases: null, watchlists: null, profiles: null });
  let summaryPending = $state(true);
  let summaryError = $state('');
  let secondaryOpen = $state(false);
  let firstUseTool = $state<'guide' | 'import' | ''>('');
  let workspaceState = $state<DashboardWorkspaceState>('loading');
  let attentionSummary = $state<DashboardAttentionSummaryModel | null>(null);
  let attentionUnavailable = $state(false);
  let workspaceMutationStatus = $state('');
  const moduleController = new AbortController();

  async function refreshLocalSummary(message = '') {
    if (message) workspaceMutationStatus = message;
    summaryPending = true;
    summaryError = '';
    attentionSummary = null;
    attentionUnavailable = false;
    const results = await Promise.allSettled(DASHBOARD_REQUIRED_COLLECTION_IDS.map(async (collection) => ({
      collection,
      document: await readBrowserLocalData(collection),
    })));
    summaryPending = false;
    const documents = new Map<string, unknown>();
    const sourceStates = results.map((result) => {
      if (result.status === 'rejected') return { status: 'unavailable' as const };
      documents.set(result.value.collection, result.value.document);
      return {
        status: 'ready' as const,
        count: dashboardCollectionRecordCount(result.value.collection, result.value.document),
      };
    });
    workspaceState = dashboardWorkspaceState(sourceStates);
    const caseRecords = (documents.get('cases') ?? []) as BrowserLocalCollectionDocumentMap['cases'];
    recentCases = [...caseRecords].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)).slice(0, 5);
    const watchlists = (documents.get('watchlists') ?? {}) as BrowserLocalCollectionDocumentMap['watchlists'];
    const profiles = (documents.get('brand_profiles') ?? []) as BrowserLocalCollectionDocumentMap['brand_profiles'];
    const expectedFailures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .filter((result) => isExpectedBrowserLocalDataFailure(result.reason));
    const unexpectedFailure = results.find((result): result is PromiseRejectedResult =>
      result.status === 'rejected' && !isExpectedBrowserLocalDataFailure(result.reason));

    counts = {
      cases: documents.has('cases') ? caseRecords.length : null,
      openCases: documents.has('cases') ? caseRecords.filter((record) => !caseStatusIsClosed(record.status)).length : null,
      watchlists: documents.has('watchlists') ? Object.keys(watchlists).length : null,
      profiles: documents.has('brand_profiles') ? profiles.length : null,
    };
    if (expectedFailures.length > 0) {
      summaryError = workspaceState === 'unavailable'
        ? 'One or more required browser-local collections are unavailable. WHOISleuth cannot classify this workspace as empty.'
        : 'Some browser-local collections are unavailable. Available saved work is still shown below.';
    }
    if (unexpectedFailure) throw unexpectedFailure.reason;

    if (workspaceState === 'returning') {
      if (ANALYST_REVIEW_REQUIRED_COLLECTION_IDS.some((source) => !documents.has(source))) {
        attentionUnavailable = true;
      } else {
        let modules;
        try {
          modules = await loadDeferredModule(() => Promise.all([
            import('$lib/analysis/analyst-review-inbox.ts'),
            import('$lib/analysis/certificate-review-inbox.ts'),
            import('$lib/analysis/analyst-review-local-projections.ts'),
          ]), { signal: moduleController.signal });
        } catch {
          attentionUnavailable = true;
          return;
        }
        const [{ buildAnalystReviewInbox }, { buildCertificateReviewInbox }, { buildLocalAnalystReviewProjection }] = modules;
        const reviewState = documents.get('analyst_review_state') as BrowserLocalCollectionDocumentMap['analyst_review_state'];
        const reviewNow = new Date().toISOString();
        const localProjection = buildLocalAnalystReviewProjection({
          cases: caseRecords,
          profiles,
          detectionRules: documents.get('detection_rules') as BrowserLocalCollectionDocumentMap['detection_rules'],
          websiteSnapshots: documents.get('website_snapshots') as BrowserLocalCollectionDocumentMap['website_snapshots'],
          watchlists,
          bulkSessions: documents.get('bulk_sessions') as BrowserLocalCollectionDocumentMap['bulk_sessions'],
          reviewState,
        }, reviewNow);
        const certificateInbox = buildCertificateReviewInbox(profiles, caseRecords, { now: reviewNow, reviewState });
        const inbox = buildAnalystReviewInbox({
          cases: caseRecords,
          watchlists,
          bulkSessions: documents.get('bulk_sessions') as BrowserLocalCollectionDocumentMap['bulk_sessions'],
          reviewState,
          projectedItems: [...localProjection.items, ...certificateInbox.reviewItems],
          projectedAdmissions: [localProjection.admission, certificateInbox.reviewAdmission],
        }, reviewNow);
        attentionSummary = buildDashboardAttentionSummary({
          reviewItems: inbox.items,
          cases: caseRecords,
          watchlistCount: Object.keys(watchlists).length,
          now: reviewNow,
        });
      }
    }
  }

  function countText(value: number | null): string {
    return value === null ? (summaryPending ? 'Loading' : 'Unavailable') : String(value);
  }

  function openFirstUseTool(tool: 'guide' | 'import') {
    firstUseTool = firstUseTool === tool ? '' : tool;
  }

  function preloadSecondaryWorkspaces() {
    preloadBestEffort(() => import('$lib/components/DashboardSecondaryWorkspaces.svelte'), moduleController.signal);
  }

  onMount(()=>{
    void refreshLocalSummary();
    const cancelIdlePreload = preloadOnIdle(preloadSecondaryWorkspaces);
    return () => {
      cancelIdlePreload();
      moduleController.abort();
    };
  });

</script>

<svelte:head>
  <title>Dashboard · WHOISleuth</title>
  <meta name="description" content="Start or continue a WHOISleuth domain investigation from the protected console's Dashboard.">
</svelte:head>

<PageHeading eyebrow="Console" title="Dashboard" description="Continue your work or investigate a new target.">
  <a class="btn" href={publicHomepage.href} target="_blank" rel="noopener noreferrer" aria-label="View public homepage. Opens in a new tab.">View public homepage</a>
</PageHeading>
<form class="dashboard-lookup" onsubmit={openLookup}>
  <label for="dashboard-target">Investigate a target</label>
  <div><input id="dashboard-target" bind:value={lookupTarget} maxlength="253" placeholder="Domain, IP address or ASN" autocomplete="off" autocapitalize="none" spellcheck="false"><button class="primary" type="submit" disabled={!lookupTarget.trim()}>Open Lookup</button></div>
  <nav aria-label="New investigation"><a href="/discover">Discover candidates</a><a href="/bulk">Triage a list</a>{#if workspaceState === 'returning'}<button type="button" class="link-action" onclick={() => openFirstUseTool('guide')}>Start a guided investigation</button>{/if}</nav>
</form>
{#if workspaceMutationStatus}<p class="workspace-mutation-status" role="status" aria-live="polite" aria-atomic="true">{workspaceMutationStatus}</p>{/if}
{#if summaryError}<p class="summary-error" role="status">{summaryError}</p>{/if}

{#if summaryPending && workspaceState !== 'loading'}<p role="status">Refreshing the saved-work summary…</p>{/if}
{#if summaryPending && workspaceState === 'loading'}
<section class="dashboard-state card" aria-live="polite" aria-busy="true">
  <p class="eyebrow">Browser-local workspace</p>
  <h2>Preparing your Dashboard</h2>
  <p>Waiting for every required local collection before deciding whether this is a first-use or returning workspace.</p>
</section>
{:else if workspaceState === 'first_use'}
<section class="dashboard-section getting-started" aria-labelledby="getting-started-title">
  <div class="section-intro">
    <p class="eyebrow">First use</p>
    <h2 id="getting-started-title">Get started</h2>
    <p>Choose a starting point.</p>
  </div>
  <div class="getting-started-grid responsive-grid">
    <a class="getting-started-action card" href="/demo"><IntelligenceIcon name="analysis" size={22} /><span><strong>Try the synthetic demo</strong><small>Explore fixed fictional evidence.</small></span></a>
    <a class="getting-started-action card" href="/lookup"><IntelligenceIcon name="lookup" size={22} /><span><strong>Investigate one target</strong><small>Choose a depth for a domain, IP address or ASN.</small></span></a>
    <button class="getting-started-action card" type="button" aria-expanded={firstUseTool === 'guide'} onpointerenter={preloadSecondaryWorkspaces} onfocus={preloadSecondaryWorkspaces} onclick={() => openFirstUseTool('guide')}><IntelligenceIcon name="case" size={22} /><span><strong>Start a guided investigation</strong><small>Review the suggested steps for a task.</small></span></button>
    <button class="getting-started-action card" type="button" aria-expanded={firstUseTool === 'import'} onpointerenter={preloadSecondaryWorkspaces} onfocus={preloadSecondaryWorkspaces} onclick={() => openFirstUseTool('import')}><IntelligenceIcon name="registry" size={22} /><span><strong>Import existing work</strong><small>Review a supported workspace backup before adding selected records.</small></span></button>
  </div>
</section>
{:else}
<div class="dashboard-work-grid">
<div>
{#if attentionSummary}
  <DashboardAttentionSummary summary={attentionSummary} />
{:else if attentionUnavailable}
  <section class="dashboard-state card" role="status"><p class="eyebrow">Returning workspace</p><h2>Attention summary unavailable</h2><p>One or more required Review Item sources could not be read. Available work remains accessible below; no missing source was treated as empty.</p></section>
{/if}
</div>
<section class="recent-cases" aria-labelledby="recent-cases-title">
  <header><h2 id="recent-cases-title">Recent Cases</h2><a href="/cases">All Cases</a></header>
  {#if recentCases.length}
    <ol>{#each recentCases as record}<li><a href={`/cases?case=${encodeURIComponent(record.id)}`}><strong>{record.domain}</strong><span>{statusLabel(record.status)} · <time datetime={record.updatedAt}>{new Date(record.updatedAt).toLocaleDateString()}</time></span></a></li>{/each}</ol>
  {:else if counts.cases === null}<p>Cases could not be read.</p>
  {:else}<p>No Cases saved yet. Keep evidence from Lookup when you need to continue an investigation.</p>{/if}
  <nav aria-label="Saved collections"><a href="/monitor?view=watchlists">Watchlists <span>{countText(counts.watchlists)}</span></a><a href="/brands">Brand profiles <span>{countText(counts.profiles)}</span></a></nav>
</section>
</div>

{#if workspaceState === 'returning'}<section class="secondary-launcher card" aria-labelledby="secondary-launcher-title">
  <div>
    <p class="eyebrow">Open when needed</p>
    <h2 id="secondary-launcher-title">Saved-work and guided tools</h2>
    <p>Search local work, hand off a browser target, manage templates, follow a guide, or import and export the local workspace.</p>
  </div>
  <button class="btn" type="button" aria-expanded={secondaryOpen} aria-controls={secondaryOpen ? 'dashboard-secondary-workspaces' : undefined} onpointerenter={preloadSecondaryWorkspaces} onfocus={preloadSecondaryWorkspaces} onclick={()=>{firstUseTool='';secondaryOpen=true;}}>Open saved-work tools</button>
</section>
{/if}
{/if}

<details id="workspaces" class="workspace-directory card" ontoggle={event => { if (event.currentTarget.open) workspaceManagerRequested=true; }}>
  <summary>Manage browser workspaces</summary>
  {#if workspaceManagerRequested}<div class="workspace-directory-body"><DeferredSurface load={() => import('$lib/components/BrowserWorkspaceManager.svelte')} props={{}} loadingLabel="Reading browser workspaces." unavailableLabel="The workspace directory could not be loaded." /></div>{/if}
</details>

<!-- Open tools keep their drafts and import results when summary classification changes. -->
{#if firstUseTool || secondaryOpen}
  <div id={firstUseTool ? 'dashboard-first-use-tool' : 'dashboard-secondary-workspaces'}>
    <DeferredSurface
      load={() => import('$lib/components/DashboardSecondaryWorkspaces.svelte')}
      props={{mode:firstUseTool || 'all',onsummarychange:refreshLocalSummary}}
      loadingLabel="Loading saved-work tools."
      unavailableLabel="Saved-work tools could not be loaded."
      placeholder="workspace"
    />
  </div>
{/if}

<style>
  .dashboard-lookup{padding:16px 0 22px;border-bottom:1px solid var(--border)}.dashboard-lookup>label{display:block;margin-bottom:8px;font-weight:650}.dashboard-lookup>div{display:flex;gap:8px}.dashboard-lookup input{min-width:0;flex:1}.dashboard-lookup nav{display:flex;flex-wrap:wrap;gap:10px 20px;margin-top:12px;font-size:var(--text-sm)}.link-action{padding:0;border:0;background:none;color:var(--accent);font:inherit;text-decoration:underline;text-underline-offset:3px}.dashboard-work-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,.48fr);gap:24px;align-items:start}.dashboard-work-grid>div{min-width:0}.recent-cases{min-width:0;margin-top:28px}.recent-cases header{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.recent-cases h2{margin:0;font-size:var(--text-lg)}.recent-cases a{font-size:var(--text-sm)}.recent-cases ol{padding:0;list-style:none}.recent-cases li{border-bottom:1px solid var(--border)}.recent-cases li a{display:grid;gap:5px;padding:14px 0;overflow-wrap:anywhere}.recent-cases li span,.recent-cases>p{color:var(--muted);font-size:var(--text-xs);line-height:1.5}.recent-cases nav{display:grid;gap:8px;margin-top:22px}.recent-cases nav a{display:flex;justify-content:space-between;gap:10px}
  @media(max-width:1150px){.dashboard-work-grid{grid-template-columns:1fr}.recent-cases{margin-top:0}}
  @media(max-width:460px){.dashboard-lookup>div{flex-direction:column}}
  .workspace-directory{margin:20px 0;padding:16px;scroll-margin-top:80px}.workspace-directory summary{font:700 var(--text-sm) var(--mono)}.workspace-directory-body{padding-top:18px}
  .workspace-mutation-status{margin:16px 0 0;padding:10px 12px;border-left:2px solid var(--accent2);background:color-mix(in srgb,var(--accent2) 7%,transparent);color:var(--text);font-size:var(--text-sm);line-height:1.5}
  .summary-error{margin:14px 0 0;color:var(--amber);font-size:var(--text-sm)}
  .summary-error:empty{display:none}
  .secondary-launcher{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:20px;margin-top:28px;padding:18px 20px}.secondary-launcher>div{min-width:0}.secondary-launcher h2{margin:3px 0 0;font:700 var(--text-lg) var(--mono)}.secondary-launcher>div>p:not(.eyebrow){max-width:74ch;margin:7px 0 0;color:var(--muted);font-size:var(--text-sm);line-height:1.5}.secondary-launcher button{flex:0 0 auto}
  .dashboard-section{margin-top:34px}
  .dashboard-state{margin-top:28px;padding:20px}.dashboard-state h2{margin:3px 0 0;font:700 1.15rem var(--mono)}.dashboard-state>p:not(.eyebrow){max-width:760px;margin:7px 0 0;color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  .getting-started-grid{--grid-min:310px;--grid-gap:9px}.getting-started-action{display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;align-items:start;min-width:0;padding:17px;text-align:left;color:var(--text)}button.getting-started-action{width:100%;font:inherit;cursor:pointer}.getting-started-action :global(svg){margin-top:1px;color:var(--accent)}.getting-started-action span{display:grid;gap:5px;min-width:0}.getting-started-action strong{font:700 var(--text-sm) var(--mono)}.getting-started-action small{color:var(--muted);font-size:var(--type-supporting-size);line-height:1.45;overflow-wrap:anywhere}.getting-started-action:hover,.getting-started-action:focus-visible{border-color:var(--accent);background:rgb(var(--accent-rgb) / .06)}
  .section-intro{max-width:760px;margin-bottom:14px}
  .section-intro h2{margin:3px 0 0;font:700 1.15rem var(--mono)}
  .section-intro>p:not(.eyebrow){margin:7px 0 0;color:var(--muted);font-size:var(--text-sm);line-height:1.55}
  @media(max-width:760px){.secondary-launcher{align-items:stretch;flex-direction:column}.secondary-launcher button{width:100%}}
</style>
