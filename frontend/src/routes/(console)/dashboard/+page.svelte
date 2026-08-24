<script lang="ts">
  import { onMount } from 'svelte';
  import IntelligenceIcon, { type IntelligenceIconName } from '$lib/components/IntelligenceIcon.svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import DashboardAttentionSummary from '$lib/components/DashboardAttentionSummary.svelte';
  import DeferredSurface from '$lib/components/DeferredSurface.svelte';
  import { readBrowserLocalData } from '$lib/browser-local-data-service.ts';
  import { isExpectedBrowserLocalDataFailure } from '$lib/browser-local-data.ts';
  import type { BrowserLocalCollectionDocumentMap } from '$lib/browser-local-data-definitions.ts';
  import { preloadBestEffort, preloadOnIdle } from '$lib/idle-preload';
  import {
    DASHBOARD_REQUIRED_COLLECTION_IDS,
    buildDashboardAttentionSummary,
    dashboardCollectionRecordCount,
    dashboardWorkspaceState,
    type DashboardAttentionSummary as DashboardAttentionSummaryModel,
    type DashboardWorkspaceState,
  } from '$lib/analysis/dashboard-workspace-state.ts';
  import { publicHomepage } from '$lib/workspaces';


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
        { href: '/lookup?depth=deep&task=acquisition#query', label: 'Acquisition task pack', detail: 'Open Lookup with acquisition-readiness context.', icon: 'registry', taskPack: true },
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
  let summaryPending = $state(true);
  let summaryError = $state('');
  let secondaryOpen = $state(false);
  let firstUseTool = $state<'guide' | 'import' | ''>('');
  let workspaceState = $state<DashboardWorkspaceState>('loading');
  let attentionSummary = $state<DashboardAttentionSummaryModel | null>(null);
  let attentionUnavailable = $state(false);
  let workspaceMutationStatus = $state('');

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
    const watchlists = (documents.get('watchlists') ?? {}) as BrowserLocalCollectionDocumentMap['watchlists'];
    const profiles = (documents.get('brand_profiles') ?? []) as BrowserLocalCollectionDocumentMap['brand_profiles'];
    const expectedFailures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .filter((result) => isExpectedBrowserLocalDataFailure(result.reason));
    const unexpectedFailure = results.find((result): result is PromiseRejectedResult =>
      result.status === 'rejected' && !isExpectedBrowserLocalDataFailure(result.reason));

    counts = {
      cases: documents.has('cases') ? caseRecords.length : null,
      openCases: documents.has('cases') ? caseRecords.filter((record) => record.status !== 'resolved').length : null,
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
      const requiredAttentionSources = ['cases', 'watchlists', 'bulk_sessions', 'brand_profiles', 'analyst_review_state'];
      if (requiredAttentionSources.some((source) => !documents.has(source))) {
        attentionUnavailable = true;
      } else {
        const [{ buildAnalystReviewInbox }, { buildCertificateReviewInbox }, { buildLocalAnalystReviewProjection }] = await Promise.all([
          import('$lib/analysis/analyst-review-inbox.ts'),
          import('$lib/analysis/certificate-review-inbox.ts'),
          import('$lib/analysis/analyst-review-local-projections.ts'),
        ]);
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

  function countDetail(value: number | null, ready: string, unavailable: string): string {
    if (value !== null) return ready;
    return summaryPending ? 'Loading browser-local count' : unavailable;
  }

  function openFirstUseTool(tool: 'guide' | 'import') {
    firstUseTool = firstUseTool === tool ? '' : tool;
  }

  function preloadSecondaryWorkspaces() {
    preloadBestEffort(() => import('$lib/components/DashboardSecondaryWorkspaces.svelte'));
  }

  onMount(()=>{
    void refreshLocalSummary();
    return preloadOnIdle(preloadSecondaryWorkspaces);
  });

</script>

<svelte:head>
  <title>Dashboard · WHOISleuth</title>
  <meta name="description" content="Start or continue a WHOISleuth domain investigation from the protected console's Dashboard.">
</svelte:head>

<PageHeading eyebrow="Console" title="Dashboard" description="Start or resume Investigate, Respond and Assure work.">
  <a class="btn" href={publicHomepage.href} target="_blank" rel="noopener noreferrer" aria-label="View public homepage. Opens in a new tab.">View public homepage</a>
</PageHeading>
{#if workspaceMutationStatus}<p class="workspace-mutation-status" role="status" aria-live="polite" aria-atomic="true">{workspaceMutationStatus}</p>{/if}

{#if summaryPending}
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
  <div class="getting-started-grid">
    <a class="getting-started-action card" href="/demo"><IntelligenceIcon name="analysis" size={22} /><span><strong>Try the synthetic demo</strong><small>Explore fixed fictional evidence.</small></span></a>
    <a class="getting-started-action card" href="/lookup"><IntelligenceIcon name="lookup" size={22} /><span><strong>Investigate one target</strong><small>Choose a depth for a domain, IP address or ASN.</small></span></a>
    <button class="getting-started-action card" type="button" aria-expanded={firstUseTool === 'guide'} onpointerenter={preloadSecondaryWorkspaces} onfocus={preloadSecondaryWorkspaces} onclick={() => openFirstUseTool('guide')}><IntelligenceIcon name="case" size={22} /><span><strong>Start a guided investigation</strong><small>Review the suggested steps for a task.</small></span></button>
    <button class="getting-started-action card" type="button" aria-expanded={firstUseTool === 'import'} onpointerenter={preloadSecondaryWorkspaces} onfocus={preloadSecondaryWorkspaces} onclick={() => openFirstUseTool('import')}><IntelligenceIcon name="registry" size={22} /><span><strong>Import existing work</strong><small>Review a supported workspace backup before adding selected records.</small></span></button>
  </div>
  {#if firstUseTool}
    <div id="dashboard-first-use-tool">
      <DeferredSurface
        load={() => import('$lib/components/DashboardSecondaryWorkspaces.svelte')}
        props={{ mode: firstUseTool, onsummarychange: refreshLocalSummary }}
        loadingLabel={`Loading the ${firstUseTool === 'guide' ? 'guided investigation' : 'workspace import'} controls.`}
        unavailableLabel="The requested local tool could not be loaded."
      />
    </div>
  {/if}
</section>
{:else}
{#if attentionSummary}
  <DashboardAttentionSummary summary={attentionSummary} />
{:else if attentionUnavailable}
  <section class="dashboard-state card" role="status"><p class="eyebrow">Returning workspace</p><h2>Attention summary unavailable</h2><p>One or more required Review Item sources could not be read. Available work remains accessible below; no missing source was treated as empty.</p></section>
{/if}

<section class="dashboard-section" aria-labelledby="quick-actions-title">
  <div class="section-intro">
    <p class="eyebrow">Start here</p>
    <h2 id="quick-actions-title">Choose an analyst job</h2>
  </div>
  <div class="workflow-grid">
    {#each workflowLanes as lane,index}
      <article class="workflow-lane" data-workflow={lane.id}>
        <header>
          <span class="workflow-meta" aria-hidden="true"><span>0{index + 1}</span><span class="workflow-icon"><IntelligenceIcon name={lane.icon} size={22} /></span></span>
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

{#if workspaceState === 'returning'}<section class="dashboard-section" aria-labelledby="local-summary-title">
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
</section>{:else}<p class="summary-error dashboard-source-error" role="status">{summaryError || 'One or more required browser-local collections are unavailable. WHOISleuth cannot classify this workspace as empty.'}</p>{/if}

{#if workspaceState === 'returning'}<section class="secondary-launcher card" aria-labelledby="secondary-launcher-title">
  <div>
    <p class="eyebrow">Open when needed</p>
    <h2 id="secondary-launcher-title">Saved-work and guided tools</h2>
    <p>Search local work, hand off a browser target, manage templates, follow a guide, or import and export the local workspace.</p>
  </div>
  <button class="btn" type="button" aria-expanded={secondaryOpen} aria-controls={secondaryOpen ? 'dashboard-secondary-workspaces' : undefined} onpointerenter={preloadSecondaryWorkspaces} onfocus={preloadSecondaryWorkspaces} onclick={()=>secondaryOpen=true}>Open saved-work tools</button>
</section>
{#if secondaryOpen}
  <div id="dashboard-secondary-workspaces">
    <DeferredSurface
      load={() => import('$lib/components/DashboardSecondaryWorkspaces.svelte')}
      props={{onsummarychange:refreshLocalSummary}}
      loadingLabel="Loading saved-work tools."
      unavailableLabel="Saved-work tools could not be loaded."
    />
  </div>
{/if}
{/if}
{/if}

<style>
  .workspace-mutation-status{margin:16px 0 0;padding:10px 12px;border-left:2px solid var(--accent2);background:color-mix(in srgb,var(--accent2) 7%,transparent);color:var(--text);font-size:var(--text-sm);line-height:1.5}
  .summary-error{margin:14px 0 0;color:var(--amber);font-size:var(--text-sm)}
  .summary-error:empty{display:none}
  .secondary-launcher{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:20px;margin-top:28px;padding:18px 20px}.secondary-launcher>div{min-width:0}.secondary-launcher h2{margin:3px 0 0;font:700 var(--text-lg) var(--mono)}.secondary-launcher>div>p:not(.eyebrow){max-width:74ch;margin:7px 0 0;color:var(--muted);font-size:var(--text-sm);line-height:1.5}.secondary-launcher button{flex:0 0 auto}
  .dashboard-section{margin-top:34px}
  .dashboard-state{margin-top:28px;padding:20px}.dashboard-state h2{margin:3px 0 0;font:700 1.15rem var(--mono)}.dashboard-state>p:not(.eyebrow){max-width:760px;margin:7px 0 0;color:var(--muted);font-size:var(--text-sm);line-height:1.5}.dashboard-source-error{margin-top:24px}
  .getting-started-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.getting-started-action{display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;align-items:start;min-width:0;padding:17px;text-align:left;color:var(--text)}button.getting-started-action{width:100%;font:inherit;cursor:pointer}.getting-started-action :global(svg){margin-top:1px;color:var(--accent)}.getting-started-action span{display:grid;gap:5px;min-width:0}.getting-started-action strong{font:700 var(--text-sm) var(--mono)}.getting-started-action small{color:var(--muted);font-size:var(--text-xs);line-height:1.45;overflow-wrap:anywhere}.getting-started-action:hover,.getting-started-action:focus-visible{border-color:var(--accent);background:rgb(var(--accent-rgb) / .06)}
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
  @media(max-width:760px){.local-grid,.getting-started-grid{grid-template-columns:1fr}.secondary-launcher{align-items:stretch;flex-direction:column}.secondary-launcher button{width:100%}}
</style>
