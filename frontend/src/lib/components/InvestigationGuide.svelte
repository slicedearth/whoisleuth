<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, tick } from 'svelte';
  import { loadLocalInvestigationProjection } from '$lib/investigation-search';
  import { activeProfile } from '$lib/brand-profiles';
  import { loadCases, type CaseRecord } from '$lib/cases';
  import { isExpectedBrowserLocalDataFailure } from '$lib/browser-local-data.ts';
  import type { BrandProfile } from '$lib/analysis/brand-profile-model.ts';
  import { buildInvestigationHandoffReadiness } from '$lib/analysis/investigation-handoff-readiness.ts';
  import { buildGuidedCollectionPreflight } from '$lib/analysis/collection-preflight.ts';
  import CollectionPreflight from '$lib/components/CollectionPreflight.svelte';
  import { normalizeInvestigationGuideDomain } from '$lib/analysis/investigation-guide.ts';
  import { toolNavigation } from '$lib/workspaces';
  import {
    approveInvestigationGuideCollection,
    clearInvestigationGuide,
    downloadInvestigationGuideSummary,
    INVESTIGATION_GUIDE_EVENT,
    MAX_INVESTIGATION_GUIDE_REVIEW_NOTE_LENGTH,
    investigationGuideApprovedHref,
    investigationGuideHref,
    investigationGuideRecipe,
    investigationGuideStageForGuidePath,
    investigationGuideStagesForGuide,
    loadInvestigationGuide,
    pauseInvestigationGuide,
    recordInvestigationGuideVisit,
    restartStoredInvestigationGuide,
    resumeInvestigationGuide,
    startInvestigationGuide,
    updateInvestigationGuideOutcome,
    type InvestigationGuide,
    type InvestigationRecipeStage,
  } from '$lib/investigation-guide';
  let { revealOnMount = false }: { revealOnMount?: boolean } = $props();
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
  const returnControlHideExposure = 0.6;

  let guide = $state<InvestigationGuide | null>(null);
  let mounted = $state(false);
  let planOpen = $state(false);
  let selectedStageId = $state('');
  let reviewingStageId = $state('');
  let reviewingLocation = $state('');
  let pendingOutcome = $state<'partial' | 'skipped' | null>(null);
  let outcomeNote = $state('');
  let restartPending = $state(false);
  let exportPending = $state(false);
  let exportError = $state('');
  let contextDismissed = $state(false);
  let editingTarget = $state(false);
  let targetChangePending = $state(false);
  let contextDomain = $state('');
  let contextError = $state('');
  let localContextError = $state('');
  let evidenceContextAvailable = $state(true);
  let profileContextAvailable = $state(true);
  let caseContextAvailable = $state(true);
  let evidenceContextPending = $state(true);
  let profileContextPending = $state(true);
  let caseContextPending = $state(true);
  let localContextRefreshVersion = 0;
  let guideSection = $state<HTMLElement | null>(null);
  let actionPanel = $state<HTMLElement | null>(null);
  let actionVisible = $state(true);
  let actionObserver: IntersectionObserver | null = null;
  let actionObservationVersion = 0;
  let handledLocation = '';
  let evidence = $state({ observations: 0, relationships: 0, partial: false, truncated: false, latestObservedAt: '' });
  let contextProfile = $state<BrandProfile | null>(null);
  let contextCase = $state<CaseRecord | null>(null);
  const localContextPending = $derived(evidenceContextPending || profileContextPending || caseContextPending);
  const recipe = $derived(guide ? investigationGuideRecipe(guide.recipeId) : null);
  const stages = $derived(guide ? investigationGuideStagesForGuide(guide) : []);
  const currentStage = $derived(guide ? investigationGuideStageForGuidePath(guide, page.url.pathname) : null);
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
  const candidateSelectionRequired = $derived(Boolean(guide?.recipeId === 'brand_sweep' && actionStage?.id === 'lookup' && !guide.focusDomain));
  const actionHref = $derived(actionStage && guide
    ? actionIsCurrent
      ? targetHashes.get(actionStage.path) || actionStage.path
      : investigationGuideHref(actionStage.id, guide.domain, guide.recipeId, guide.focusDomain)
    : '/dashboard');
  const candidateHandoffRequired = $derived(Boolean(guide?.recipeId === 'brand_sweep' && actionStage?.id === 'discover'));
  const handoffReadiness = $derived(buildInvestigationHandoffReadiness({
    caseRecord: contextCase,
    evidenceProjection: evidence,
  }));
  const handoffContextAvailable = $derived(
    !evidenceContextPending && !caseContextPending && evidenceContextAvailable && caseContextAvailable,
  );
  const caseWorkspaceHref = $derived(contextCase
    ? `/monitor?view=cases&case=${encodeURIComponent(contextCase.id)}#case-response-${encodeURIComponent(contextCase.id)}`
    : null);
  const evidenceFreshness = $derived(formatEvidenceFreshness(evidence.latestObservedAt, evidence.observations));
  const actionPreflight = $derived(actionStage ? buildGuidedCollectionPreflight({
    label: actionStage.label,
    requestImpact: actionStage.requestImpact,
    prerequisite: actionStage.prerequisite,
    requiresApproval: actionStage.requiresApproval,
    approved: actionApproved,
  }) : null);

  function formatEvidenceFreshness(observedAt: string, observations: number): string {
    if (!observations || !observedAt) return 'No retained evidence';
    const parsed = new Date(observedAt);
    if (!Number.isFinite(parsed.getTime())) return 'Retained time unavailable';
    return `Latest ${new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(parsed)}`;
  }

  async function refreshStoredContext() {
    const refreshVersion = ++localContextRefreshVersion;
    evidenceContextPending = true;
    profileContextPending = true;
    caseContextPending = true;
    localContextError = '';
    const [evidenceResult, profileResult, caseResult] = await Promise.allSettled([
      refreshEvidence(),
      refreshProfileContext(),
      refreshCaseContext(),
    ]);
    if (refreshVersion !== localContextRefreshVersion) return;
    evidenceContextAvailable = evidenceResult.status === 'fulfilled';
    profileContextAvailable = profileResult.status === 'fulfilled';
    caseContextAvailable = caseResult.status === 'fulfilled';
    if (!evidenceContextAvailable) {
      evidence = { observations: 0, relationships: 0, partial: false, truncated: false, latestObservedAt: '' };
    }
    if (!profileContextAvailable) contextProfile = null;
    if (!caseContextAvailable) contextCase = null;
    evidenceContextPending = false;
    profileContextPending = false;
    caseContextPending = false;
    if (!evidenceContextAvailable || !profileContextAvailable || !caseContextAvailable) {
      const expectedFailure = [evidenceResult, profileResult, caseResult].every((result) => (
        result.status === 'fulfilled' || isExpectedBrowserLocalDataFailure(result.reason)
      ));
      const unavailable = [
        !evidenceContextAvailable ? 'retained evidence' : '',
        !profileContextAvailable ? 'active-profile preference' : '',
        !caseContextAvailable ? 'Cases' : '',
      ].filter(Boolean).join(', ');
      localContextError = expectedFailure
        ? `Some browser-local investigation context is unavailable (${unavailable}). Healthy sources remain available, and unreadable saved data is not treated as absent.`
        : `Browser-local investigation context could not be refreshed (${unavailable}). Healthy sources remain available, and unreadable saved data is not treated as absent.`;
    }
  }

  function guideIdentity(value: InvestigationGuide | null) {
    return value ? `${value.recipeId}\u0000${value.template?.id || ''}\u0000${value.domain}\u0000${value.createdAt}` : '';
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
    const observationVersion = ++actionObservationVersion;
    await tick();
    if (observationVersion !== actionObservationVersion) return;
    actionObserver?.disconnect();
    actionObserver = null;
    const panel = actionPanel;
    if (!panel) {
      actionVisible = true;
      return;
    }
    actionVisible = actionExposureRatio(panel) >= usefulActionExposure;
    if (typeof IntersectionObserver === 'undefined') return;
    actionObserver = new IntersectionObserver(([entry]) => {
      if (observationVersion !== actionObservationVersion || actionPanel !== panel) return;
      const ratio = entry?.isIntersecting ? entry.intersectionRatio : 0;
      actionVisible = ratio >= (actionVisible ? usefulActionExposure : returnControlHideExposure);
    }, { threshold: [0, usefulActionExposure, returnControlHideExposure] });
    actionObserver.observe(panel);
  }

  async function revealAction() {
    actionVisible = true;
    await tick();
    actionPanel?.focus({ preventScroll: true });
    await afterLayout();
    const panel = actionPanel;
    if (!panel) return;
    for (const block of ['center', 'start', 'center'] as const) {
      panel.scrollIntoView({ behavior: 'auto', block });
      await afterLayout();
      if (actionExposureRatio(panel) >= usefulActionExposure) break;
    }
    panel.focus({ preventScroll: true });
    await afterLayout();
    await observeAction();
    actionPanel?.focus({ preventScroll: true });
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
    await afterLayout();
    const target = document.getElementById(targetId);
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    target.focus({ preventScroll: true });
    await afterLayout();
  }

  async function refreshFromEvent() {
    const previousIdentity = guideIdentity(guide);
    guide = loadInvestigationGuide();
    const identityChanged = guideIdentity(guide) !== previousIdentity;
    if (identityChanged) {
      selectedStageId = '';
      reviewingStageId = '';
      reviewingLocation = '';
      pendingOutcome = null;
      outcomeNote = '';
      planOpen = false;
      contextDismissed = false;
      editingTarget = false;
      targetChangePending = false;
      contextDomain = guide?.focusDomain || guide?.domain || '';
      contextError = '';
    }
    void refreshStoredContext();
    if (identityChanged) void revealGuide();
    void observeAction();
  }

  async function refreshEvidence() {
    if (!guide) {
      evidence = { observations: 0, relationships: 0, partial: false, truncated: false, latestObservedAt: '' };
      return;
    }
    const projection = await loadLocalInvestigationProjection();
    const targetDomain = guide.focusDomain || guide.domain;
    const domainEntity = projection.entities.find((entity) => entity.type === 'domain' && entity.canonical === targetDomain);
    if (!domainEntity) {
      evidence = { observations: 0, relationships: 0, partial: false, truncated: projection.truncated, latestObservedAt: '' };
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
      latestObservedAt: observations.reduce(
        (latest, observation) => observation.observedAt > latest ? observation.observedAt : latest,
        '',
      ),
    };
  }

  async function refreshProfileContext() {
    if (!guide) {
      contextProfile = null;
      return;
    }
    contextProfile = await activeProfile();
  }

  async function refreshCaseContext() {
    if (!guide) {
      contextCase = null;
      return;
    }
    const cases = await loadCases();
    const targetDomain = guide.focusDomain || guide.domain;
    contextCase = cases.find((record) => record.domain === targetDomain) || null;
  }

  function endGuide() {
    actionObservationVersion += 1;
    actionObserver?.disconnect();
    actionObserver = null;
    clearInvestigationGuide();
    guide = null;
  }

  function togglePause() {
    guide = guide?.status === 'paused' ? resumeInvestigationGuide() : pauseInvestigationGuide();
  }

  function beginTargetEdit() {
    if (!guide) return;
    contextDomain = guide.focusDomain || guide.domain;
    editingTarget = true;
    targetChangePending = false;
    contextError = '';
  }

  function cancelTargetEdit() {
    editingTarget = false;
    targetChangePending = false;
    contextError = '';
  }

  function changeTarget() {
    if (!guide) return;
    const domain = normalizeInvestigationGuideDomain(contextDomain);
    if (!domain) {
      contextError = 'Enter one valid domain without a URL, path, port, or spaces.';
      targetChangePending = false;
      return;
    }
    if (domain === guide.domain && !guide.focusDomain) {
      cancelTargetEdit();
      return;
    }
    if (!targetChangePending) {
      targetChangePending = true;
      contextError = 'Changing the target restarts this guide. Existing progress is replaced and is not transferred to the new domain.';
      return;
    }
    try {
      guide = startInvestigationGuide(domain, guide.recipeId, guide.template);
      selectedStageId = '';
      reviewingStageId = '';
      reviewingLocation = '';
      pendingOutcome = null;
      outcomeNote = '';
      planOpen = false;
      contextDismissed = false;
      editingTarget = false;
      targetChangePending = false;
      contextDomain = domain;
      contextError = '';
      void refreshStoredContext();
    } catch (cause) {
      contextError = cause instanceof Error ? cause.message : 'Could not change the investigation target.';
    }
  }

  async function approveAndOpen(stage: InvestigationRecipeStage) {
    guide = approveInvestigationGuideCollection(stage.id);
    closeRequestReview();
    if (!guide) return;
    const approvedHref = investigationGuideApprovedHref(guide, stage.id);
    if (approvedHref === '/bulk?source=discover#domains') {
      if (page.url.pathname === stage.path && page.url.searchParams.get('source') === 'discover') {
        guide = recordInvestigationGuideVisit(page.url.pathname);
        await focusRouteTarget('#domains');
      } else {
        await goto(approvedHref);
        guide = recordInvestigationGuideVisit(stage.path) ?? guide;
      }
      return;
    }
    await goto(approvedHref);
    guide = recordInvestigationGuideVisit(stage.path) ?? guide;
  }

  function openRequestReview(stageId: string) {
    reviewingStageId = stageId;
    reviewingLocation = `${page.url.pathname}\u0000${page.url.hash}`;
  }

  function closeRequestReview() {
    reviewingStageId = '';
    reviewingLocation = '';
  }

  function setOutcome(stageId: string, outcome: 'pending' | 'complete' | 'partial' | 'skipped') {
    guide = updateInvestigationGuideOutcome(stageId, outcome);
    pendingOutcome = null;
    outcomeNote = '';
    if (outcome !== 'pending') {
      selectedStageId = '';
      planOpen = false;
      void revealAction();
    }
  }

  function reviewOutcome(outcome: 'partial' | 'skipped') {
    pendingOutcome = outcome;
    outcomeNote = actionProgress?.reviewNote || '';
  }

  function confirmOutcome(stageId: string) {
    if (!pendingOutcome || !outcomeNote.trim()) return;
    guide = updateInvestigationGuideOutcome(stageId, pendingOutcome, outcomeNote);
    pendingOutcome = null;
    outcomeNote = '';
    selectedStageId = '';
    planOpen = false;
    void revealAction();
  }

  function cancelOutcomeReview() {
    pendingOutcome = null;
    outcomeNote = '';
  }

  function reviewStage(stageId: string) {
    selectedStageId = stageId;
    reviewingStageId = '';
    reviewingLocation = '';
    pendingOutcome = null;
    outcomeNote = '';
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
    reviewingLocation = '';
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
    guide = loadInvestigationGuide();
    const pathname = page.url.pathname;
    const hash = page.url.hash;
    handledLocation = `${pathname}\u0000${hash}`;
    guide = recordInvestigationGuideVisit(pathname) ?? guide;
    void (async () => {
      contextDomain = guide?.focusDomain || guide?.domain || '';
      if (revealOnMount) await revealGuide();
      if (hash) await focusRouteTarget(hash);
      await observeAction();
      void refreshStoredContext();
    })();
    window.addEventListener(INVESTIGATION_GUIDE_EVENT, refreshFromEvent);
    return () => {
      actionObservationVersion += 1;
      actionObserver?.disconnect();
      window.removeEventListener(INVESTIGATION_GUIDE_EVENT, refreshFromEvent);
    };
  });

  $effect(() => {
    const pathname = page.url.pathname;
    const hash = page.url.hash;
    const location = `${pathname}\u0000${hash}`;
    if (mounted && location !== handledLocation) {
      handledLocation = location;
      selectedStageId = '';
      if (reviewingLocation !== location) {
        reviewingStageId = '';
        reviewingLocation = '';
      }
      guide = recordInvestigationGuideVisit(pathname);
      if (hash) void focusRouteTarget(hash).then(observeAction);
      else void observeAction();
    }
  });
</script>

{#if guide && recipe}
  <section class="guide card" aria-labelledby="investigation-guide-title" tabindex="-1" bind:this={guideSection}>
    <div class="guide-heading">
      <div>
        <p class="eyebrow">Guided investigation</p>
        <strong class="guide-title" id="investigation-guide-title">{guide.template?.label || recipe.label}: {guide.domain}</strong>
        <p class="recipe-progress">{guide.template ? `${recipe.label} template · ` : ''}{reviewedCount} of {stages.length} steps reviewed</p>
      </div>
      <div class="context-actions">
        <span class:paused={guide.status === 'paused'} class="recipe-status">{guide.status === 'paused' ? 'Paused' : 'Active'}</span>
        <button class="btn compact" type="button" onclick={() => contextDismissed = !contextDismissed}>{contextDismissed ? 'Show work plan' : 'Dismiss details'}</button>
        <button class="btn compact danger" type="button" onclick={endGuide}>Clear context</button>
      </div>
    </div>
    <dl class="context-tray" aria-label="Active investigation context">
      <div><dt>Target</dt><dd>{guide.focusDomain || guide.domain}</dd></div>
      <div><dt>Brand Profile</dt><dd>{profileContextPending ? 'Loading…' : profileContextAvailable ? contextProfile?.name || 'None active' : 'Unavailable'}</dd></div>
      <div><dt>Case</dt><dd>{caseContextPending ? 'Loading…' : caseContextAvailable ? contextCase ? `${contextCase.status} · ${contextCase.disposition}` : 'Not retained' : 'Unavailable'}</dd></div>
      <div><dt>Evidence freshness</dt><dd>{evidenceContextPending ? 'Loading…' : evidenceContextAvailable ? evidenceFreshness : 'Unavailable'}</dd></div>
      <div><dt>Next action</dt><dd>{actionStage?.label || 'Review completed plan'}</dd></div>
    </dl>
    {#if localContextError}<p class="local-context-error" role="status">{localContextError}</p>{/if}

    {#if !contextDismissed}
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
            <section class="completion-check" aria-label={`Completion check for ${actionStage.label}`}>
              <h3>Completion check</h3>
              <dl>
                <div><dt>Expected evidence</dt><dd>{actionStage.expectedEvidence}</dd></div>
                <div><dt>Done when</dt><dd>{actionStage.completionCriteria}</dd></div>
              </dl>
            </section>
          </div>
          <div class="action-controls">
            <p class="mobile-action-label"><span>Next action</span><strong>{actionStage.label}</strong></p>
            {#if actionStage.workspace === 'monitor'}
              {#if handoffContextAvailable}
                <section class:ready={handoffReadiness.status === 'ready'} class="handoff-readiness" aria-label="Case handoff readiness">
                  <div>
                    <span>Case handoff</span>
                    <strong>{handoffReadiness.label}</strong>
                  </div>
                  <ul>
                    {#each handoffReadiness.checks as check}
                      <li class:caution={check.state === 'caution'} class:block={check.state === 'block'}>
                        <span aria-hidden="true">{check.state === 'pass' ? '✓' : check.state === 'caution' ? '!' : '×'}</span>
                        <span><strong>{check.label}</strong><small>{check.detail}</small></span>
                      </li>
                    {/each}
                  </ul>
                  {#if caseWorkspaceHref}<a class="btn compact" href={caseWorkspaceHref}>Open case decision workspace</a>{/if}
                  <p>{handoffReadiness.limitations[0]}</p>
                </section>
              {:else}
                <section class="handoff-readiness unavailable" aria-label="Case handoff readiness">
                  <div>
                    <span>Case handoff</span>
                    <strong>{localContextPending ? 'Checking browser-local context' : 'Handoff context unavailable'}</strong>
                  </div>
                  <p>{localContextPending ? 'The readiness check will appear after browser-local case and evidence context settles.' : 'Browser-local case or evidence context could not be read. No handoff check is inferred from unavailable saved data.'}</p>
                </section>
              {/if}
            {/if}
            {#if guide.status === 'paused'}
              <button class="primary compact" type="button" onclick={togglePause}>Resume guide</button>
            {:else if actionProgress.outcome !== 'pending'}
              <p class="outcome-state">This step is marked {actionProgress.outcome}.</p>
              <button class="btn compact" type="button" onclick={() => setOutcome(actionStage.id, 'pending')}>Reopen this step</button>
            {:else if candidateSelectionRequired}
              <p class="candidate-note">Choose one priority result in Bulk and use its <strong>Inspect</strong> action. WHOISleuth will carry that candidate into this step.</p>
              <a
                class="primary compact"
                href={page.url.pathname === '/bulk'
                  ? '#results'
                  : investigationGuideHref(actionStage.id, guide.domain, guide.recipeId, guide.focusDomain)}
              >{actionLabel(actionStage)}</a>
            {:else if actionStage.requiresApproval && !actionApproved}
              {#if reviewingStageId === actionStage.id}
                <section class="request-review" aria-label={`Review requests for ${actionStage.label}`}>
                  <strong>Before opening {toolLabel(actionStage)}</strong>
                  {#if actionPreflight}<CollectionPreflight preflight={actionPreflight} open />{/if}
                  <div class="request-actions">
                    <button class="primary compact" type="button" onclick={() => approveAndOpen(actionStage)}>Allow and open {toolLabel(actionStage)}</button>
                    <button class="btn compact" type="button" onclick={closeRequestReview}>Cancel</button>
                  </div>
                </section>
              {:else}
                <button class="primary compact" type="button" onclick={() => openRequestReview(actionStage.id)}>Review requests</button>
              {/if}
            {:else}
              <a class="primary compact" href={actionHref}>{actionLabel(actionStage)}</a>
            {/if}

            {#if guide.status !== 'paused' && actionProgress.outcome === 'pending'}
              <div class="outcome-actions" role="group" aria-label={`Finish ${actionStage.label}`}>
                <span>After doing the work above</span>
                {#if candidateHandoffRequired}
                  <p class="candidate-note">Select the candidates worth checking, then use <strong>Continue to Bulk</strong> in the results. That handoff records the reviewed set and completes this step.</p>
                {:else if actionProgress.openedAt}
                  <button class="primary compact" type="button" onclick={() => setOutcome(actionStage.id, 'complete')}>Mark reviewed</button>
                  <button class="btn compact" type="button" onclick={() => reviewOutcome('partial')}>Mark partial</button>
                {/if}
                <button class="btn compact" type="button" onclick={() => reviewOutcome('skipped')}>Skip this step</button>
              </div>
              {#if pendingOutcome}
                <form class="outcome-review" onsubmit={(event) => { event.preventDefault(); confirmOutcome(actionStage.id); }}>
                  <label for={`guide-outcome-note-${actionStage.id}`}>
                    {pendingOutcome === 'partial' ? 'What remains incomplete?' : 'Why is this step being skipped?'}
                  </label>
                  <textarea
                    id={`guide-outcome-note-${actionStage.id}`}
                    bind:value={outcomeNote}
                    maxlength={MAX_INVESTIGATION_GUIDE_REVIEW_NOTE_LENGTH}
                    rows="3"
                    required
                    placeholder={pendingOutcome === 'partial' ? 'Record missing, unavailable, or deferred work.' : 'Record why this step does not apply or is deferred.'}
                  ></textarea>
                  <small>{outcomeNote.length}/{MAX_INVESTIGATION_GUIDE_REVIEW_NOTE_LENGTH} characters · stored in this tab and included in the compact guide export</small>
                  <div class="request-actions">
                    <button class="primary compact" type="submit">Confirm {pendingOutcome}</button>
                    <button class="btn compact" type="button" onclick={cancelOutcomeReview}>Cancel</button>
                  </div>
                </form>
              {/if}
            {/if}
          </div>
        </article>
      {/key}
    {:else}
      <article class="guide-complete" tabindex="-1" bind:this={actionPanel}>
        <p class="step-number">Guide reviewed</p>
        <h2>All {stages.length} steps have an outcome</h2>
        <p>Review the full plan or export the compact progress summary. Guide outcomes record progress; they are not target findings.</p>
        {#if handoffContextAvailable}
          <section class:ready={handoffReadiness.status === 'ready'} class="handoff-readiness complete-handoff" aria-label="Completed guide handoff readiness">
            <div>
              <span>Decision handoff</span>
              <strong>{handoffReadiness.label}</strong>
            </div>
            <p>{handoffReadiness.counts.evidencePins} evidence pin{handoffReadiness.counts.evidencePins === 1 ? '' : 's'} · {handoffReadiness.counts.decisions} decision{handoffReadiness.counts.decisions === 1 ? '' : 's'} · {handoffReadiness.counts.openUnknowns + handoffReadiness.counts.openContradictions} unresolved unknown or contradiction record{handoffReadiness.counts.openUnknowns + handoffReadiness.counts.openContradictions === 1 ? '' : 's'}</p>
            {#if caseWorkspaceHref}<a class="btn compact" href={caseWorkspaceHref}>Review case decision workspace</a>{/if}
          </section>
        {:else}
          <section class="handoff-readiness complete-handoff unavailable" aria-label="Completed guide handoff readiness">
            <div>
              <span>Decision handoff</span>
              <strong>{localContextPending ? 'Checking browser-local context' : 'Handoff context unavailable'}</strong>
            </div>
            <p>{localContextPending ? 'The readiness summary will appear after browser-local case and evidence context settles.' : 'Browser-local case or evidence context could not be read. No completed handoff state is inferred from unavailable saved data.'}</p>
          </section>
        {/if}
      </article>
    {/if}

    <button class="plan-toggle btn" type="button" aria-expanded={planOpen} aria-controls={planOpen?'investigation-plan':undefined} onclick={() => planOpen = !planOpen}>{planOpen ? 'Hide full plan' : `Show full plan (${stages.length} steps)`}</button>

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
                  {#if progress?.reviewNote}<div><dt>Review note</dt><dd>{progress.reviewNote}</dd></div>{/if}
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
        <summary>{localContextPending ? 'Checking saved evidence' : evidenceContextAvailable ? `Saved evidence · ${evidence.observations} observation${evidence.observations === 1 ? '' : 's'} · ${evidence.relationships} relationship${evidence.relationships === 1 ? '' : 's'}` : 'Saved evidence unavailable'}</summary>
        <p>{localContextPending ? 'Browser-local evidence context is still loading, so no retained-evidence conclusion is available yet.' : evidenceContextAvailable ? evidence.observations || evidence.relationships ? 'These retained records are a checkpoint, not proof that a step is complete.' : 'No saved observation in this browser currently links to this domain. This does not mean evidence is absent elsewhere.' : 'Browser-local evidence could not be read. Continue with the guide, but do not interpret this state as an empty evidence history.'}{!localContextPending && evidenceContextAvailable && evidence.partial ? ' Some retained evidence is partial.' : ''}{!localContextPending && evidenceContextAvailable && evidence.truncated ? ' A saved-data or source limit was reached.' : ''}</p>
      </details>
      <details class="guide-options">
        <summary>Guide options</summary>
        <div class="guide-controls toolbar" role="group" aria-label="Guide controls">
          <button class="btn compact" type="button" onclick={togglePause}>{guide.status === 'paused' ? 'Resume guide' : 'Pause guide'}</button>
          <button class="btn compact" type="button" onclick={restart}>{restartPending ? 'Confirm restart' : 'Restart guide'}</button>
          {#if restartPending}<button class="btn compact" type="button" onclick={() => restartPending = false}>Cancel restart</button>{/if}
          <button class="btn compact" type="button" onclick={beginTargetEdit}>Change target</button>
          <button class="btn compact" type="button" onclick={exportSummary}>{exportPending ? 'Confirm export' : 'Export summary'}</button>
          {#if exportPending}<button class="btn compact" type="button" onclick={() => exportPending = false}>Cancel export</button>{/if}
          <button class="btn compact danger" type="button" onclick={endGuide}>End guide</button>
        </div>
        {#if editingTarget}
          <form class="target-edit" onsubmit={(event) => { event.preventDefault(); changeTarget(); }}>
            <label for="investigation-context-target">Investigation target</label>
            <input id="investigation-context-target" bind:value={contextDomain} maxlength="253" autocomplete="off" spellcheck="false" required />
            <p>Use one bare domain. A confirmed change starts the same recipe again with no completed steps.</p>
            <div class="request-actions">
              <button class="primary compact" type="submit">{targetChangePending ? 'Confirm and restart guide' : 'Review target change'}</button>
              <button class="btn compact" type="button" onclick={cancelTargetEdit}>Cancel</button>
            </div>
          </form>
        {/if}
        {#if contextError}<p class="context-error" role={targetChangePending ? 'status' : 'alert'}>{contextError}</p>{/if}
        {#if exportError}<p class="error" role="alert">{exportError}</p>{/if}
      </details>
    </div>
    <p class="boundary">Progress stays in this tab. The guide never starts a scan, submits a target, changes Risk, or decides a case disposition.</p>
    {/if}
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
  .context-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;align-items:center}
  .guide-title{display:block;margin:3px 0 0;overflow-wrap:anywhere;font:700 var(--text-md) var(--mono)}
  .recipe-progress{margin:5px 0 0;color:var(--muted);font-size:var(--text-2xs)}
  .recipe-status{flex:none;padding:5px 8px;border:1px solid color-mix(in srgb,var(--accent) 45%,var(--border));border-radius:999px;color:var(--accent);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  .recipe-status.paused{border-color:var(--border);color:var(--muted)}
  .context-tray{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1px;margin:12px 0 0;padding:1px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--border)}
  .context-tray div{display:block;min-width:0;padding:8px 9px;background:var(--surface)}
  .context-tray dt,.context-tray dd{display:block}
  .context-tray dd{margin:3px 0 0;overflow-wrap:anywhere}
  .local-context-error{margin:8px 0 0;color:var(--amber);font-size:var(--text-2xs);line-height:1.45}
  .current-action{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(250px,.85fr);gap:18px;align-items:start;margin-top:13px;padding:16px;border:1px solid rgb(var(--accent-rgb) / .5);border-radius:var(--radius-md);background:rgb(var(--accent-rgb) / .07);scroll-margin-top:88px}
  .step-number{margin:0;color:var(--accent);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  .action-copy h2{margin:4px 0 5px;font:700 var(--text-md) var(--mono)}
  .action-copy>p{max-width:760px;margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  .action-copy>.step-number{color:var(--accent);font:700 var(--text-2xs) var(--mono)}
  .action-copy h3{margin:13px 0 6px;color:var(--text);font:700 var(--text-xs) var(--mono)}
  .action-instructions{display:grid;gap:5px;margin:0;padding-left:20px;color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  .completion-check{margin-top:13px;padding:10px 11px;border-left:3px solid var(--accent);background:rgb(var(--accent-rgb) / .06)}
  .completion-check h3{margin:0 0 7px}
  .completion-check dl{margin:0;padding:0;border:0}
  .action-controls{display:grid;gap:9px;align-content:start}
  .action-controls>a,.action-controls>button{text-align:center}
  .mobile-action-label{display:none;margin:0}
  .mobile-action-label span,.mobile-action-label strong{display:block}
  .mobile-action-label span{color:var(--muted);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  .mobile-action-label strong{margin-top:2px;font:700 var(--text-sm) var(--mono)}
  .request-review{display:grid;gap:7px;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)}
  .request-review>strong{font:700 var(--text-xs) var(--mono)}
  .candidate-note,.outcome-state{margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .candidate-note strong{color:var(--text)}
  .request-actions,.outcome-actions{display:flex;flex-wrap:wrap;gap:6px}
  .outcome-actions{margin-top:2px;padding-top:9px;border-top:1px solid var(--border)}
  .outcome-actions>span{flex:1 0 100%;color:var(--muted);font:700 var(--text-2xs) var(--mono)}
  .outcome-review{display:grid;gap:7px;padding:10px;border:1px solid var(--amber);border-radius:var(--radius-sm);background:var(--surface)}
  .outcome-review label{font:700 var(--text-2xs) var(--mono)}
  .outcome-review textarea{width:100%;min-height:74px;resize:vertical}
  .outcome-review>small{color:var(--muted);font-size:var(--text-2xs);line-height:1.4}
  .handoff-readiness{display:grid;gap:8px;padding:11px;border:1px solid var(--amber);border-radius:var(--radius-sm);background:var(--surface)}
  .handoff-readiness.ready{border-color:var(--success)}
  .handoff-readiness.unavailable{border-color:var(--border)}
  .handoff-readiness>div>span,.handoff-readiness>div>strong{display:block}
  .handoff-readiness>div>span{color:var(--muted);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  .handoff-readiness>div>strong{margin-top:2px;font:700 var(--text-xs) var(--mono)}
  .handoff-readiness ul{display:grid;gap:6px;margin:0;padding:0;list-style:none}
  .handoff-readiness li{display:grid;grid-template-columns:auto minmax(0,1fr);gap:7px;color:var(--success)}
  .handoff-readiness li.caution{color:var(--amber)}
  .handoff-readiness li.block{color:var(--danger)}
  .handoff-readiness li>span:first-child{font:700 var(--text-xs) var(--mono)}
  .handoff-readiness li strong,.handoff-readiness li small{display:block}
  .handoff-readiness li strong{color:var(--text);font-size:var(--text-2xs)}
  .handoff-readiness li small{margin-top:1px;color:var(--muted);font-size:var(--text-2xs);line-height:1.35}
  .handoff-readiness>p{margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.4}
  .complete-handoff{margin-top:12px;max-width:780px}
  .guide-complete{margin-top:13px;padding:16px;border:1px solid rgb(var(--accent2-rgb) / .5);border-radius:var(--radius-md);background:rgb(var(--accent2-rgb) / .07)}
  .guide-complete h2{margin:4px 0 6px;font:700 var(--text-md) var(--mono)}
  .guide-complete>p{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  .compact{flex:none;padding:7px 10px;font-size:var(--text-2xs)}
  .plan-toggle{margin-top:10px}
  #investigation-plan{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0 0;padding:0;list-style:none}
  #investigation-plan>li{min-width:0;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
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
  #investigation-plan>li.current .stage-state{color:var(--accent)}
  #investigation-plan>li.complete .stage-state{color:var(--success)}
  #investigation-plan>li.partial .stage-state{color:var(--amber)}
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
  .target-edit{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px 10px;padding:0 10px 10px}
  .target-edit label{grid-column:1 / -1;font:700 var(--text-2xs) var(--mono)}
  .target-edit input{min-width:0}
  .target-edit>p{grid-column:1 / -1;margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.4}
  .target-edit .request-actions{grid-column:1 / -1}
  .context-error{margin:0 10px 10px;color:var(--amber);font-size:var(--text-2xs);line-height:1.4}
  .boundary{margin:9px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .guide-return{position:fixed;right:18px;bottom:18px;z-index:35;display:grid;visibility:hidden;max-width:min(320px,calc(100vw - 36px));padding:10px 13px;border:1px solid rgb(var(--accent-rgb) / .7);border-radius:var(--radius-md);background:var(--panel);box-shadow:0 10px 34px rgb(var(--shadow-rgb) / .28);color:var(--text);font-family:var(--mono);text-align:left;opacity:0;pointer-events:none}
  .guide-return.available{visibility:visible;opacity:1;pointer-events:auto}
  .guide-return span,.guide-return small{color:var(--muted);font-size:var(--text-2xs)}
  .guide-return strong{margin:2px 0;font-size:var(--text-xs);overflow-wrap:anywhere}
  .guide-return small{color:var(--accent);font-weight:700}
  .guide-return:hover{border-color:var(--accent);background:var(--panel-raised)}
  @media(max-width:900px){#investigation-plan{grid-template-columns:1fr}.current-action{grid-template-columns:1fr}.context-tray{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:560px){.guide-heading{flex-wrap:wrap}.context-actions{width:100%;justify-content:flex-start}.current-action>.action-copy{grid-row:2}.current-action>.action-controls{grid-row:1}.mobile-action-label{display:block}.action-controls>a,.action-controls>button{width:100%}.request-actions,.outcome-actions{display:grid}.secondary-details{display:grid}.guide-controls{display:grid;grid-template-columns:1fr 1fr}.guide-controls .btn{width:100%}.target-edit{grid-template-columns:1fr}dl div{grid-template-columns:1fr;gap:2px}.guide-return{right:10px;bottom:max(10px,env(safe-area-inset-bottom));max-width:calc(100vw - 20px)}}
  @media(max-width:360px){.guide-controls{grid-template-columns:1fr}#investigation-plan>li summary{grid-template-columns:auto minmax(0,1fr) auto}.stage-state{grid-column:2;text-align:left}#investigation-plan>li summary::after{grid-column:3;grid-row:1}}
</style>
