<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, tick } from 'svelte';
  import { loadLocalInvestigationProjection } from '$lib/investigation-search';
  import { toolNavigation } from '$lib/workspaces';
  import {
    approveInvestigationGuideCollection,
    clearInvestigationGuide,
    downloadInvestigationGuideSummary,
    INVESTIGATION_GUIDE_EVENT,
    investigationGuideHref,
    investigationGuideRecipe,
    investigationGuideStageForPath,
    investigationGuideStagesForRecipe,
    loadInvestigationGuide,
    pauseInvestigationGuide,
    recordInvestigationGuideVisit,
    restartStoredInvestigationGuide,
    resumeInvestigationGuide,
    updateInvestigationGuideOutcome,
    type InvestigationGuide,
    type InvestigationRecipeStage,
  } from '$lib/investigation-guide';
  const toolLabels = new Map(toolNavigation.map((tool) => [tool.href, tool.label]));
  const targetLabels = new Map([
    ['/brands', 'profile controls'],
    ['/discover', 'candidate input'],
    ['/bulk', 'domain queue'],
    ['/lookup', 'lookup field'],
    ['/monitor', 'review queue'],
  ]);
  const targetHashes = new Map([
    ['/brands', '#official-domains'],
    ['/discover', '#discovery-seed'],
    ['/bulk', '#domains'],
    ['/lookup', '#query'],
    ['/monitor', '#case-review-queue'],
  ]);
  const guideTargetIds = new Set(['official-domains', 'discovery-seed', 'domains', 'query', 'new-case', 'case-review-queue', 'results']);
  const usefulActionExposure = 0.2;

  let guide = $state<InvestigationGuide | null>(null);
  let mounted = $state(false);
  let planOpen = $state(false);
  let selectedStageId = $state('');
  let reviewingStageId = $state('');
  let restartPending = $state(false);
  let exportPending = $state(false);
  let exportError = $state('');
  let guideSection = $state<HTMLElement | null>(null);
  let actionPanel = $state<HTMLElement | null>(null);
  let actionVisible = $state(true);
  let actionObserver: IntersectionObserver | null = null;
  let evidence = $state({ observations: 0, relationships: 0, partial: false, truncated: false });
  const recipe = $derived(guide ? investigationGuideRecipe(guide.recipeId) : null);
  const stages = $derived(guide ? investigationGuideStagesForRecipe(guide.recipeId) : []);
  const currentStage = $derived(guide ? investigationGuideStageForPath(page.url.pathname, guide.recipeId) : null);
  const nextStageId = $derived(guide?.stages.find((stage) => stage.outcome === 'pending')?.id || null);
  const selectedStage = $derived(stages.find((stage) => stage.id === selectedStageId) || null);
  const actionStage = $derived.by(() => {
    if (!guide) return null;
    if (selectedStage) return selectedStage;
    return stages.find((stage) => stage.id === nextStageId) || null;
  });
  const actionProgress = $derived(guide?.stages.find((stage) => stage.id === actionStage?.id) || null);
  const actionIndex = $derived(actionStage ? stages.findIndex((stage) => stage.id === actionStage.id) : -1);
  const reviewedCount = $derived(guide?.stages.filter((stage) => stage.outcome !== 'pending').length || 0);
  const actionIsCurrent = $derived(Boolean(actionStage && currentStage?.id === actionStage.id));
  const actionApproved = $derived(Boolean(actionStage && (!actionStage.requiresApproval || actionProgress?.approvedAt)));
  const actionHref = $derived(actionStage && guide
    ? actionIsCurrent
      ? targetHashes.get(actionStage.path) || actionStage.path
      : investigationGuideHref(actionStage.id, guide.domain, guide.recipeId, guide.focusDomain)
    : '/dashboard');
  const candidateSelectionRequired = $derived(Boolean(guide?.recipeId === 'brand_sweep' && actionStage?.id === 'lookup' && !guide.focusDomain));

  async function refresh() {
    guide = loadInvestigationGuide();
    await refreshEvidence();
  }

  function guideIdentity(value: InvestigationGuide | null) {
    return value ? `${value.recipeId}\u0000${value.domain}\u0000${value.createdAt}` : '';
  }

  async function revealGuide() {
    await tick();
    guideSection?.focus({ preventScroll: true });
    guideSection?.scrollIntoView({ block: 'start' });
  }

  function actionExposureRatio(element: HTMLElement): number {
    const rect = element.getBoundingClientRect();
    const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    const area = Math.max(1, rect.width * rect.height);
    return (visibleWidth * visibleHeight) / area;
  }

  function afterLayout(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }

  async function observeAction() {
    await tick();
    actionObserver?.disconnect();
    actionObserver = null;
    if (!actionPanel) {
      actionVisible = true;
      return;
    }
    actionVisible = actionExposureRatio(actionPanel) >= usefulActionExposure;
    if (typeof IntersectionObserver === 'undefined') return;
    actionObserver = new IntersectionObserver(([entry]) => {
      const ratio = entry?.isIntersecting ? entry.intersectionRatio : 0;
      actionVisible = ratio >= usefulActionExposure;
    }, { threshold: [0, usefulActionExposure] });
    actionObserver.observe(actionPanel);
  }

  async function revealAction() {
    actionVisible = true;
    await tick();
    await afterLayout();
    const panel = actionPanel;
    if (!panel) return;
    panel.focus({ preventScroll: true });
    panel.scrollIntoView({ behavior: 'auto', block: 'center' });
    await afterLayout();
    if (actionExposureRatio(panel) < usefulActionExposure) {
      panel.scrollIntoView({ behavior: 'auto', block: 'start' });
      await afterLayout();
    }
    await observeAction();
  }

  async function focusRouteTarget(hash: string) {
    let targetId = '';
    try {
      targetId = decodeURIComponent(hash.replace(/^#/, ''));
    } catch {
      return;
    }
    if (!guideTargetIds.has(targetId)) return;
    await tick();
    requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      if (!target) return;
      target.scrollIntoView({ block: 'center' });
      target.focus({ preventScroll: true });
    });
  }

  async function refreshFromEvent() {
    const previousIdentity = guideIdentity(guide);
    guide = loadInvestigationGuide();
    const identityChanged = guideIdentity(guide) !== previousIdentity;
    if (identityChanged) {
      selectedStageId = '';
      reviewingStageId = '';
      planOpen = false;
    }
    await refreshEvidence();
    if (identityChanged) void revealGuide();
    void observeAction();
  }

  async function refreshEvidence() {
    if (!guide) {
      evidence = { observations: 0, relationships: 0, partial: false, truncated: false };
      return;
    }
    const projection = await loadLocalInvestigationProjection();
    const domainEntity = projection.entities.find((entity) => entity.type === 'domain' && entity.canonical === guide?.domain);
    if (!domainEntity) {
      evidence = { observations: 0, relationships: 0, partial: false, truncated: projection.truncated };
      return;
    }
    const observationIds = new Set(domainEntity.observationIds);
    const observations = projection.observations.filter((observation) => observationIds.has(observation.id));
    const relationships = projection.relationships.filter((relationship) => relationship.from === domainEntity.id || relationship.to === domainEntity.id);
    evidence = {
      observations: observations.length,
      relationships: relationships.length,
      partial: observations.some((observation) => observation.status === 'partial' || observation.complete !== true),
      truncated: projection.truncated || domainEntity.observationsTruncated
        || observations.some((observation) => observation.truncated === true || observation.entityReferencesTruncated)
        || relationships.some((relationship) => relationship.truncated === true || relationship.sourceObservationsTruncated),
    };
  }

  function endGuide() {
    actionObserver?.disconnect();
    actionObserver = null;
    clearInvestigationGuide();
    guide = null;
  }

  function togglePause() {
    guide = guide?.status === 'paused' ? resumeInvestigationGuide() : pauseInvestigationGuide();
  }

  async function approveAndOpen(stage: InvestigationRecipeStage) {
    guide = approveInvestigationGuideCollection(stage.id);
    reviewingStageId = '';
    if (!guide) return;
    const preserveCandidateHandoff = stage.path === '/bulk'
      && actionIsCurrent
      && page.url.searchParams.get('source') === 'discover';
    if (preserveCandidateHandoff) {
      guide = recordInvestigationGuideVisit(page.url.pathname);
      await focusRouteTarget('#domains');
      return;
    }
    await goto(investigationGuideHref(stage.id, guide.domain, guide.recipeId, guide.focusDomain));
  }

  function setOutcome(stageId: string, outcome: 'pending' | 'complete' | 'partial' | 'skipped') {
    guide = updateInvestigationGuideOutcome(stageId, outcome);
    if (outcome !== 'pending') {
      selectedStageId = '';
      planOpen = false;
      void revealAction();
    }
  }

  function reviewStage(stageId: string) {
    selectedStageId = stageId;
    reviewingStageId = '';
    planOpen = false;
    void revealAction();
  }

  function restart() {
    if (!restartPending) {
      restartPending = true;
      return;
    }
    guide = restartStoredInvestigationGuide();
    selectedStageId = '';
    reviewingStageId = '';
    planOpen = false;
    restartPending = false;
  }

  function exportSummary() {
    if (!exportPending) {
      exportPending = true;
      return;
    }
    exportError = '';
    try {
      downloadInvestigationGuideSummary();
      exportPending = false;
    } catch (cause) {
      exportError = cause instanceof Error ? cause.message : 'Could not export the guided investigation.';
    }
  }

  function stageState(stageId: string): string {
    const progress = guide?.stages.find((candidate) => candidate.id === stageId);
    if (progress?.outcome === 'complete') return 'Complete';
    if (progress?.outcome === 'partial') return 'Partial';
    if (progress?.outcome === 'skipped') return 'Skipped';
    if (progress?.openedAt) return 'Opened';
    return 'Not opened';
  }

  function toolLabel(stage: InvestigationRecipeStage): string {
    return toolLabels.get(stage.path) ?? stage.workspace;
  }

  function actionLabel(stage: InvestigationRecipeStage): string {
    if (candidateSelectionRequired) return 'Choose a Bulk candidate';
    return actionIsCurrent ? `Go to ${targetLabels.get(stage.path) ?? 'tool controls'}` : `Open ${toolLabel(stage)}`;
  }

  onMount(() => {
    mounted = true;
    void refresh().then(observeAction);
    window.addEventListener(INVESTIGATION_GUIDE_EVENT, refreshFromEvent);
    return () => {
      actionObserver?.disconnect();
      window.removeEventListener(INVESTIGATION_GUIDE_EVENT, refreshFromEvent);
    };
  });

  $effect(() => {
    const pathname = page.url.pathname;
    const hash = page.url.hash;
    if (mounted) {
      selectedStageId = '';
      reviewingStageId = '';
      guide = recordInvestigationGuideVisit(pathname);
      if (hash) void focusRouteTarget(hash);
    }
  });
</script>

{#if guide && recipe}
  <section class="guide card" aria-labelledby="investigation-guide-title" tabindex="-1" bind:this={guideSection}>
    <div class="guide-heading">
      <div>
        <p class="eyebrow">Guided investigation</p>
        <strong class="guide-title" id="investigation-guide-title">{recipe.label}: {guide.domain}</strong>
        <p class="recipe-progress">{reviewedCount} of {stages.length} steps reviewed</p>
      </div>
      <span class:paused={guide.status === 'paused'} class="recipe-status">{guide.status === 'paused' ? 'Paused' : 'Active'}</span>
    </div>

    {#if actionStage && actionProgress}
      {#key actionStage.id}
        <article class="current-action" tabindex="-1" bind:this={actionPanel}>
          <div class="action-copy">
            <p class="step-number">Step {actionIndex + 1} of {stages.length}{actionIsCurrent ? ' · You are in the right tool' : ''}</p>
            <h2>{actionStage.label}</h2>
            <p>{actionStage.detail}</p>
            <h3>What to do</h3>
            <ol class="action-instructions">
              {#each actionStage.instructions as instruction}<li>{instruction}</li>{/each}
            </ol>
          </div>
          <div class="action-controls">
            {#if guide.status === 'paused'}
              <button class="primary compact" type="button" onclick={togglePause}>Resume guide</button>
            {:else if actionProgress.outcome !== 'pending'}
              <p class="outcome-state">This step is marked {actionProgress.outcome}.</p>
              <button class="btn compact" type="button" onclick={() => setOutcome(actionStage.id, 'pending')}>Reopen this step</button>
            {:else if candidateSelectionRequired}
              <p class="candidate-note">Choose one priority result in Bulk and use its <strong>Inspect</strong> action. WHOISleuth will carry that candidate into this step.</p>
              <a class="primary compact" href={actionHref}>{actionLabel(actionStage)}</a>
            {:else if actionStage.requiresApproval && !actionApproved}
              {#if reviewingStageId === actionStage.id}
                <section class="request-review" aria-label={`Review requests for ${actionStage.label}`}>
                  <strong>Before opening {toolLabel(actionStage)}</strong>
                  <p><b>Requests:</b> {actionStage.requestImpact}</p>
                  <p><b>Check first:</b> {actionStage.prerequisite}</p>
                  <div class="request-actions">
                    <button class="primary compact" type="button" onclick={() => approveAndOpen(actionStage)}>Allow and open {toolLabel(actionStage)}</button>
                    <button class="btn compact" type="button" onclick={() => reviewingStageId = ''}>Cancel</button>
                  </div>
                </section>
              {:else}
                <button class="primary compact" type="button" onclick={() => reviewingStageId = actionStage.id}>Review requests</button>
              {/if}
            {:else}
              <a class="primary compact" href={actionHref}>{actionLabel(actionStage)}</a>
            {/if}

            {#if guide.status !== 'paused' && actionProgress.outcome === 'pending'}
              <div class="outcome-actions" aria-label={`Finish ${actionStage.label}`}>
                <span>After doing the work above</span>
                {#if actionProgress.openedAt}
                  <button class="primary compact" type="button" onclick={() => setOutcome(actionStage.id, 'complete')}>Mark reviewed</button>
                  <button class="btn compact" type="button" onclick={() => setOutcome(actionStage.id, 'partial')}>Mark partial</button>
                {/if}
                <button class="btn compact" type="button" onclick={() => setOutcome(actionStage.id, 'skipped')}>Skip this step</button>
              </div>
            {/if}
          </div>
        </article>
      {/key}
    {:else}
      <article class="guide-complete" tabindex="-1" bind:this={actionPanel}>
        <p class="step-number">Guide reviewed</p>
        <h2>All {stages.length} steps have an outcome</h2>
        <p>Review the full plan or export the compact progress summary. The guide outcomes remain analyst workflow markers, not findings about the target.</p>
      </article>
    {/if}

    <button class="plan-toggle btn" type="button" aria-expanded={planOpen} aria-controls="investigation-plan" onclick={() => planOpen = !planOpen}>{planOpen ? 'Hide full plan' : `Show full plan (${stages.length} steps)`}</button>

    {#if planOpen}
      <ol id="investigation-plan" aria-label="Investigation guide steps">
        {#each stages as stage,index}
          {@const progress = guide.stages.find((candidate) => candidate.id === stage.id)}
          {@const isCurrent = currentStage?.id === stage.id}
          <li data-stage-id={stage.id} class:current={isCurrent} class:partial={progress?.outcome === 'partial'} class:complete={progress?.outcome === 'complete'} class:skipped={progress?.outcome === 'skipped'}>
            <details open={actionStage?.id === stage.id}>
              <summary>
                <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                <span class="stage-heading"><strong>{stage.label}</strong><small>{stage.detail}</small></span>
                <span class="stage-state">{isCurrent ? `Current · ${stageState(stage.id)}` : stageState(stage.id)}</span>
              </summary>
              <div class="stage-body">
                <dl>
                  <div><dt>Expected evidence</dt><dd>{stage.expectedEvidence}</dd></div>
                  <div><dt>Requests</dt><dd>{stage.requestImpact}</dd></div>
                  <div><dt>Before starting</dt><dd>{stage.prerequisite}</dd></div>
                  <div><dt>Done when</dt><dd>{stage.completionCriteria}</dd></div>
                </dl>
                <button class="btn compact" type="button" onclick={() => reviewStage(stage.id)}>{progress?.outcome === 'pending' ? 'Review this step' : 'Review or reopen'}</button>
              </div>
            </details>
          </li>
        {/each}
      </ol>
    {/if}

    <div class="secondary-details">
      <details class="evidence-checkpoint">
        <summary>Saved evidence · {evidence.observations} observation{evidence.observations === 1 ? '' : 's'} · {evidence.relationships} relationship{evidence.relationships === 1 ? '' : 's'}</summary>
        <p>{evidence.observations || evidence.relationships ? 'These retained records are a checkpoint, not proof that a step is complete.' : 'No saved observation in this browser currently links to this domain. This does not mean evidence is absent elsewhere.'}{evidence.partial ? ' Some retained evidence is partial.' : ''}{evidence.truncated ? ' A saved-data or source limit was reached.' : ''}</p>
      </details>
      <details class="guide-options">
        <summary>Guide options</summary>
        <div class="guide-controls toolbar" aria-label="Guide controls">
          <button class="btn compact" type="button" onclick={togglePause}>{guide.status === 'paused' ? 'Resume guide' : 'Pause guide'}</button>
          <button class="btn compact" type="button" onclick={restart}>{restartPending ? 'Confirm restart' : 'Restart guide'}</button>
          {#if restartPending}<button class="btn compact" type="button" onclick={() => restartPending = false}>Cancel restart</button>{/if}
          <button class="btn compact" type="button" onclick={exportSummary}>{exportPending ? 'Confirm export' : 'Export summary'}</button>
          {#if exportPending}<button class="btn compact" type="button" onclick={() => exportPending = false}>Cancel export</button>{/if}
          <button class="btn compact danger" type="button" onclick={endGuide}>End guide</button>
        </div>
        {#if exportError}<p class="error" role="alert">{exportError}</p>{/if}
      </details>
    </div>
    <p class="boundary">Progress stays in this tab. The guide never starts a scan, submits a target, changes Risk, or decides a case disposition.</p>
  </section>
{/if}

{#if guide && recipe && actionStage}
  <button class="guide-return" class:available={!actionVisible} type="button" aria-label={`Return to guided investigation: ${actionStage.label}`} tabindex={actionVisible ? -1 : 0} onclick={revealAction}>
    <span>Guided investigation</span>
    <strong>{actionStage.label}</strong>
    <small>Review step ↑</small>
  </button>
{/if}

<style>
  .guide{margin:0 0 24px;padding:16px;scroll-margin-top:76px}
  .guide:focus,.current-action:focus{outline:2px solid var(--accent);outline-offset:3px}
  .guide-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
  .guide-title{display:block;margin:3px 0 0;overflow-wrap:anywhere;font:700 var(--text-md) var(--mono)}
  .recipe-progress{margin:5px 0 0;color:var(--muted);font-size:var(--text-2xs)}
  .recipe-status{flex:none;padding:5px 8px;border:1px solid color-mix(in srgb,var(--accent) 45%,var(--border));border-radius:999px;color:var(--accent);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  .recipe-status.paused{border-color:var(--border);color:var(--muted)}
  .current-action{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(250px,.85fr);gap:18px;align-items:start;margin-top:13px;padding:16px;border:1px solid rgb(var(--accent-rgb) / .5);border-radius:var(--radius-md);background:rgb(var(--accent-rgb) / .07);scroll-margin-top:88px}
  .step-number{margin:0;color:var(--accent);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  .action-copy h2{margin:4px 0 5px;font:700 var(--text-md) var(--mono)}
  .action-copy>p{max-width:760px;margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  .action-copy>.step-number{color:var(--accent);font:700 var(--text-2xs) var(--mono)}
  .action-copy h3{margin:13px 0 6px;color:var(--text);font:700 var(--text-xs) var(--mono)}
  .action-instructions{display:grid;gap:5px;margin:0;padding-left:20px;color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  .action-controls{display:grid;gap:9px;align-content:start}
  .action-controls>a,.action-controls>button{text-align:center}
  .request-review{display:grid;gap:7px;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)}
  .request-review>strong{font:700 var(--text-xs) var(--mono)}
  .request-review p,.candidate-note,.outcome-state{margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .request-review b,.candidate-note strong{color:var(--text)}
  .request-actions,.outcome-actions{display:flex;flex-wrap:wrap;gap:6px}
  .outcome-actions{margin-top:2px;padding-top:9px;border-top:1px solid var(--border)}
  .outcome-actions>span{flex:1 0 100%;color:var(--muted);font:700 var(--text-2xs) var(--mono)}
  .guide-complete{margin-top:13px;padding:16px;border:1px solid rgb(var(--accent-rgb) / .5);border-radius:var(--radius-md);background:rgb(var(--accent-rgb) / .07)}
  .guide-complete h2{margin:4px 0 6px;font:700 var(--text-md) var(--mono)}
  .guide-complete>p:last-child{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  .compact{flex:none;padding:7px 10px;font-size:var(--text-2xs)}
  .plan-toggle{margin-top:10px}
  #investigation-plan{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0 0;padding:0;list-style:none}
  #investigation-plan>li{min-width:0;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface2)}
  summary{cursor:pointer}
  #investigation-plan>li summary{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:6px 9px;align-items:start;padding:12px;list-style:none}
  #investigation-plan>li summary::-webkit-details-marker{display:none}
  #investigation-plan>li summary::after{content:'+';color:var(--muted);font:700 var(--text-sm) var(--mono);line-height:1}
  #investigation-plan>li details[open] summary::after{content:'−'}
  #investigation-plan>li summary>span:first-child{color:var(--muted);font:700 var(--text-2xs) var(--mono)}
  .stage-heading{min-width:0}
  #investigation-plan>li strong,#investigation-plan>li small{display:block}
  #investigation-plan>li strong{font:700 var(--text-xs) var(--mono)}
  #investigation-plan>li small{margin-top:3px;color:var(--muted);font-size:var(--text-2xs);line-height:1.4}
  .stage-state{color:var(--muted);font:700 var(--text-2xs) var(--mono);text-align:right}
  #investigation-plan>li.current{border-color:var(--accent);box-shadow:inset 3px 0 0 var(--accent)}
  #investigation-plan>li.current .stage-state,#investigation-plan>li.complete .stage-state{color:var(--accent)}
  #investigation-plan>li.partial .stage-state{color:var(--warning)}
  .stage-body{padding:0 12px 12px}
  dl{display:grid;gap:7px;margin:0 0 12px;padding-top:12px;border-top:1px solid var(--border)}
  dl div{display:grid;grid-template-columns:105px minmax(0,1fr);gap:8px}
  dt{color:var(--muted);font:700 var(--text-2xs) var(--mono)}
  dd{margin:0;font-size:var(--text-2xs);line-height:1.45}
  .secondary-details{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
  .secondary-details>details{flex:1 1 300px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)}
  .secondary-details>details>summary{padding:9px 10px;font:700 var(--text-2xs) var(--mono)}
  .evidence-checkpoint p{margin:0;padding:0 10px 10px;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .guide-controls{display:flex;flex-wrap:wrap;gap:6px;padding:0 10px 10px}
  .guide-options .error{margin:0 10px 10px}
  .boundary{margin:9px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .guide-return{position:fixed;right:18px;bottom:18px;z-index:35;display:grid;visibility:hidden;max-width:min(320px,calc(100vw - 36px));padding:10px 13px;border:1px solid rgb(var(--accent-rgb) / .7);border-radius:var(--radius-md);background:var(--surface);box-shadow:0 10px 34px rgb(var(--shadow-rgb) / .28);color:var(--text);font-family:var(--mono);text-align:left;opacity:0;pointer-events:none}
  .guide-return.available{visibility:visible;opacity:1;pointer-events:auto}
  .guide-return span,.guide-return small{color:var(--muted);font-size:var(--text-2xs)}
  .guide-return strong{margin:2px 0;font-size:var(--text-xs);overflow-wrap:anywhere}
  .guide-return small{color:var(--accent);font-weight:700}
  .guide-return:hover{border-color:var(--accent);background:var(--surface2)}
  @media(max-width:900px){#investigation-plan{grid-template-columns:1fr}.current-action{grid-template-columns:1fr}}
  @media(max-width:560px){.guide-heading{flex-wrap:wrap}.action-controls>a,.action-controls>button{width:100%}.request-actions,.outcome-actions{display:grid}.secondary-details{display:grid}.guide-controls{display:grid;grid-template-columns:1fr 1fr}.guide-controls .btn{width:100%}dl div{grid-template-columns:1fr;gap:2px}.guide-return{right:10px;bottom:max(10px,env(safe-area-inset-bottom));max-width:calc(100vw - 20px)}}
  @media(max-width:360px){.guide-controls{grid-template-columns:1fr}#investigation-plan>li summary{grid-template-columns:auto minmax(0,1fr) auto}.stage-state{grid-column:2;text-align:left}#investigation-plan>li summary::after{grid-column:3;grid-row:1}}
</style>
