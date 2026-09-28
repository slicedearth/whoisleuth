<script lang="ts">
  import { goto } from '$app/navigation';
  import { getContext, onDestroy, onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import LocalSectionNav from '$lib/components/LocalSectionNav.svelte';
  import LookupAtAGlance from '$lib/components/LookupAtAGlance.svelte';
  import LookupAssessment from '$lib/components/LookupAssessment.svelte';
  import LookupFamilySummary from '$lib/components/LookupFamilySummary.svelte';
  import LookupEvidenceReplay from '$lib/components/LookupEvidenceReplay.svelte';
  import LookupEvidenceCheckpoint from '$lib/components/LookupEvidenceCheckpoint.svelte';
  import LookupSourceCheckpoint from '$lib/components/LookupSourceCheckpoint.svelte';
  import type { CheckpointFact } from '$lib/analysis/case-evidence-checkpoint.ts';
  import LookupForm from '$lib/components/LookupForm.svelte';
  import MessageIntake from '$lib/components/MessageIntake.svelte';
  import LookupTaskGuidance from '$lib/components/LookupTaskGuidance.svelte';
  import LookupEvidenceSection from '$lib/components/LookupEvidenceSection.svelte';
  import LookupRegistrySection from '$lib/components/LookupRegistrySection.svelte';
  import LookupRelationshipsSection from '$lib/components/LookupRelationshipsSection.svelte';
  import LookupSourceQualitySection from '$lib/components/LookupSourceQualitySection.svelte';
  import LookupWebEvidenceSection from '$lib/components/LookupWebEvidenceSection.svelte';
  import { lookupWebSurfaces } from '$lib/components/lookup-web-surfaces.ts';
  import { lookupSectionSurfaces } from '$lib/components/lookup-section-surfaces.ts';
  import LookupSavedContextPreview from '$lib/components/LookupSavedContextPreview.svelte';
  import LookupResultHeader from '$lib/components/LookupResultHeader.svelte';
  import { lookupObservationHostname } from '../../../../../packages/evidence/lookup-target.mts';
  import LookupPresentationControls from '$lib/components/LookupPresentationControls.svelte';
  import DeferredSurface from '$lib/components/DeferredSurface.svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import {
    activeProfile,
    type ActiveBrandProfileSourceState,
    type BrandProfile,
  } from '$lib/brand-profiles';
  import { LookupCollectionWorkflow } from '$lib/controllers/lookup-collection-workflow.ts';
  import { LookupPageLifecycle } from '$lib/controllers/lookup-page-lifecycle.ts';
  import type { CaseRecord } from '../../../lib/cases.ts';
  import { loadWatchlists, saveSingleDomainWatchlist } from '$lib/watchlists';
  import { saveCandidateHandoff } from '$lib/candidate-handoff';
  import {
    prepareLookupEvidenceExport,
    exportLookupEvidence,
    exportLookupReadableReport,
    exportLookupInvestigationBrief,
    exportLookupClaimPassport,
  } from '$lib/analysis/lookup-exports.ts';
  import { createLookupViewModel } from '$lib/analysis/lookup-response.ts';
  import { formatDate, records, show } from '$lib/analysis/lookup-display-model.ts';
  import { buildLookupRouteAnalysis } from '$lib/analysis/lookup-route-analysis.ts';
  import type { LookupClaimId } from '$lib/analysis/lookup-claim-readiness.ts';
  import type {
    LookupFreshnessPolicyInput,
    LookupFreshnessThresholds,
  } from '$lib/analysis/lookup-source-refresh.ts';
  import { LOOKUP_CLIENT_TIMEOUT_MS } from '$lib/analysis/lookup-request.ts';
  import {
    prepareLookupCollectionTarget,
    buildLookupResultSectionLinks,
    lookupEvidenceFamilyForHref,
    lookupSecurityTxtEligible,
  } from '$lib/analysis/lookup-page-actions.ts';
  import {
    readLookupPresentation,
    writeLookupPresentation,
    type LookupTaskView,
  } from '$lib/analysis/lookup-presentation.ts';
  import { buildLookupWebsiteSnapshot } from '$lib/analysis/lookup-snapshot-input.ts';
  import { buildServiceDependencyReview } from '$lib/analysis/service-dependency-review.ts';
  import { parseDomainInput } from '$lib/analysis/utils.ts';
  import {
    CAPABILITY_CONTEXT,
    disabledCapabilities,
    disabledCapability,
    featureCapability,
    type CapabilityGetter,
  } from '$lib/capabilities';
  import {
    readLookupWorkflowState,
    writeLookupWorkflowState,
    selectConsoleCase,
    setCaseNavigationContext,
  } from '$lib/console-workflow-state.ts';
  import { normalizeOpaqueReferenceId } from '../../../../../packages/cases/opaque-reference-id.mts';
  import { caseWorkspaceHref } from '$lib/analysis/case-response-stage.ts';
  import { preloadBestEffort } from '$lib/idle-preload';
  import { LookupRequestController } from '$lib/controllers/lookup-request-controller';
  import { LookupCaseController } from '$lib/controllers/lookup-case-controller';
  import type { LookupWatchlistState } from '$lib/controllers/lookup-view-state';
  import { createLookupSessionState, LookupSession } from '$lib/controllers/lookup-session';
  import { LookupWatchlistWorkspace } from '$lib/controllers/lookup-watchlist-workspace';
  import { LookupSectionNavigation } from '$lib/controllers/lookup-section-navigation';
  import {
    LookupCaseWorkspace,
    lookupCaseActions,
    type LookupCaseState,
  } from '$lib/controllers/lookup-case-workspace';
  import { LookupAnchorController } from '$lib/controllers/lookup-anchor-controller';
  import {
    MAX_OBSERVATION_LIMITATIONS,
    MAX_OBSERVATION_LIMITATION_LENGTH,
  } from '../../../../../packages/evidence/observation.mts';
  const moduleController = new AbortController();
  onDestroy(() => moduleController.abort());
  const session = $state(createLookupSessionState());
  const watchlistWorkspace = new LookupWatchlistWorkspace({
    context: () => ({
      target: caseObservationTarget,
      revision: lookupRequestController.revision,
      evidence: caseEvidence,
      depth: lookupEvidenceDepth,
    }),
    load: loadWatchlists,
    save: saveSingleDomainWatchlist,
    publish: (next) => {
      watchlistState = next;
    },
  });
  let watchlistState: LookupWatchlistState = $state.raw(watchlistWorkspace.state);
  $effect(() => {
    session.observation.response;
    session.observation.refreshLedger = null;
  });
  const linkedCaseReference = $derived(page.url.searchParams.get('case'));
  const invalidCaseReference = $derived(
    linkedCaseReference !== null && normalizeOpaqueReferenceId(linkedCaseReference) === null,
  );
  $effect(() => {
    if (linkedCaseReference !== null)
      selectConsoleCase(normalizeOpaqueReferenceId(linkedCaseReference));
  });
  let profile = $state<BrandProfile | null>(null);
  let profileSourceState = $state<ActiveBrandProfileSourceState>('loading');
  let freshnessPolicyMode = $state<'task-default' | 'analyst-custom'>('task-default');
  let customFreshnessThresholds = $state<LookupFreshnessThresholds>({
    registration: 30,
    network: 7,
    web: 3,
  });
  const freshnessPolicyInput = $derived<LookupFreshnessPolicyInput | undefined>(
    freshnessPolicyMode === 'analyst-custom'
      ? { id: 'analyst-custom', thresholdsDays: customFreshnessThresholds }
      : undefined,
  );
  const lookupRequestController = new LookupRequestController();
  const lookupCaseController = new LookupCaseController();
  const lookupCaseWorkspace: LookupCaseWorkspace = new LookupCaseWorkspace({
    controller: lookupCaseController,
    context: () => ({ domain: caseDomain, revision: lookupRequestController.revision }),
    publish: (next) => {
      caseState = next;
    },
    select: selectConsoleCase,
  });
  const caseActions = lookupCaseActions(lookupCaseWorkspace, lookupCaseController, () => ({
    domain: caseDomain,
    evidence: caseEvidence,
    depth: lookupEvidenceDepth,
    incidentUrl: session.observation.incidentUrl,
    target: caseObservationTarget,
    facts: checkpointFacts,
  }));
  let caseState: LookupCaseState = $state.raw(lookupCaseWorkspace.state);
  const lookupSession = new LookupSession(session, {
    invalidateRequest: () => lookupRequestController.invalidate(),
    resetSavedContext: (preserveDraft) => {
      lookupCaseWorkspace.reset();
      watchlistWorkspace.reset(preserveDraft);
    },
  });
  // Draft edits do not invalidate the evidence analysis for an unchanged record.
  const caseRecord = $derived(caseState.record);
  const capabilityReport = getContext<CapabilityGetter>(CAPABILITY_CONTEXT);
  const lookupDisabled = $derived(disabledCapability(capabilityReport?.() || null, 'lookup'));
  const lookupLimitations = $derived(
    disabledCapabilities(capabilityReport?.() || null, [
      'rdap',
      'whois',
      'availability',
      'dns_intelligence',
      'website_probe',
      'tls_intelligence',
    ]),
  );
  const urlscanCapability = $derived(
    featureCapability(capabilityReport?.() || null, 'urlscan_search'),
  );
  const externalIntelligenceSupported = $derived(urlscanCapability?.status === 'supported');
  const urlhausCapability = $derived(
    featureCapability(capabilityReport?.() || null, 'urlhaus_host'),
  );
  const malwareHostIntelligenceSupported = $derived(urlhausCapability?.status === 'supported');
  const threatfoxCapability = $derived(
    featureCapability(capabilityReport?.() || null, 'threatfox_domain_ioc'),
  );
  const malwareIocIntelligenceSupported = $derived(threatfoxCapability?.status === 'supported');
  const websiteProbeCapability = $derived(
    featureCapability(capabilityReport?.() || null, 'website_probe'),
  );
  const websiteObservationSupported = $derived(websiteProbeCapability?.status === 'supported');

  const parsedInput = $derived(parseDomainInput(session.request.query));
  const entries = $derived(parsedInput.entries);
  const lookupEntries = $derived.by(() => {
    const trimmed = session.request.query.trim();
    return /^[a-z][a-z\d+.-]*:\/\//iu.test(trimmed) && !/[\r\n]/u.test(trimmed)
      ? [trimmed]
      : entries;
  });
  const securityTxtEligible = $derived(lookupSecurityTxtEligible(lookupEntries));
  const lookupView = $derived(createLookupViewModel(session.observation.response));
  const validatedResponseJson = $derived.by(() =>
    session.observation.response ? JSON.stringify(session.observation.response, null, 2) : '',
  );
  const availability = $derived(lookupView.availability);
  const observationHostname = $derived(
    availability.dns || availability.tls || availability.http
      ? lookupObservationHostname(availability)
      : null,
  );
  const diagnostics = $derived(lookupView.diagnostics);
  const threatIntelligenceProviders = $derived(lookupView.threatIntelligenceProviders);
  const dnsEvidence = $derived(lookupView.dnsEvidence);
  const dnsRecords = $derived(lookupView.dnsRecords);
  const httpEvidence = $derived(lookupView.httpEvidence);
  const tlsEvidence = $derived(lookupView.tlsEvidence);
  const pageIdentity = $derived(lookupView.pageIdentity);
  const technologyProfile = $derived(lookupView.technologyProfile);
  const securityPosture = $derived(lookupView.securityPosture);
  const lookupAnalysis = $derived(
    buildLookupRouteAnalysis({
      now: new Date().toISOString(),
      result: session.observation.response,
      lookupView,
      profile,
      profileSourceState,
      task: session.task,
      hasReviewedCaseRecipient: Boolean(
        caseRecord?.actions.some(
          (action) => Boolean(action.recipient) && Boolean(action.contactSource),
        ),
      ),
      completedLookupDepth: session.observation.depth,
      ...(freshnessPolicyInput ? { freshnessPolicy: freshnessPolicyInput } : {}),
    }),
  );
  const lookupEvidenceDepth = $derived(lookupAnalysis.lookupEvidenceDepth);
  const lookupObservedAt = $derived(lookupAnalysis.lookupObservedAt);
  const idnAnalysis = $derived(lookupAnalysis.idnAnalysis);
  const profileSignals = $derived(lookupAnalysis.profileSignals);
  const externalRiskContext = $derived(lookupAnalysis.externalRiskContext);
  const opportunity = $derived(lookupAnalysis.opportunity);
  const risk = $derived(lookupAnalysis.risk);
  const riskSensitivity = $derived(lookupAnalysis.riskSensitivity);
  const outreach = $derived(lookupAnalysis.outreach);
  const abuseRecipientResolution = $derived(lookupAnalysis.abuseRecipientResolution);
  const caseDomain = $derived(lookupAnalysis.caseDomain);
  const caseObservationTarget = $derived(
    String(session.observation.response?.inputHostname || caseDomain)
      .trim()
      .toLowerCase(),
  );
  function preserveLookupReturn() {
    if (!caseRecord) return;
    const params = new URLSearchParams({
      q: session.observation.target,
      depth: lookupEvidenceDepth,
      task: session.task,
    });
    setCaseNavigationContext(caseRecord.id, `/lookup?${params}#case-response`, 'Lookup');
  }
  const observedPageBaseline = $derived(lookupAnalysis.observedPageBaseline);
  const pageComparison = $derived(lookupAnalysis.pageComparison);
  const pageDisplay = $derived(lookupAnalysis.pageDisplay);
  const brandMimicryReview = $derived(lookupAnalysis.brandMimicryReview);
  const hasWebEvidence = $derived(lookupAnalysis.hasWebEvidence);
  const hasCaseSection = $derived(lookupAnalysis.hasCaseSection);
  const lookupAssetGraph = $derived(lookupAnalysis.lookupAssetGraph);
  const acquisitionDueDiligence = $derived(lookupAnalysis.acquisitionDueDiligence);
  const serviceDependencyReview = $derived(
    buildServiceDependencyReview({
      domain: observationHostname ?? caseDomain,
      dnsEvidence,
      dnsRecords,
      httpEvidence,
      authorizedScope: session.observation.serviceScope,
      falsePositiveTargets: session.observation.serviceFalsePositives,
      pageTitle: pageIdentity.title,
      observedAt: lookupObservedAt,
    }),
  );
  const evidenceObservedAtById = $derived(lookupAnalysis.evidenceObservedAtById);
  const lookupDecisionFacts = $derived(lookupAnalysis.lookupDecisionFacts);
  const lookupClaimReadiness = $derived(lookupAnalysis.lookupClaimReadiness);
  const lookupReviewActionModel = $derived(lookupAnalysis.lookupReviewActionModel);
  const lookupSummary = $derived(lookupAnalysis.lookupSummary);
  const lookupInvestigationBrief = $derived(lookupAnalysis.lookupInvestigationBrief);
  const lookupEvidenceProjection = $derived(
    prepareLookupEvidenceExport(session.observation.response, {
      idnAnalysis,
      applicationVersion: __WHOISLEUTH_VERSION__,
    }),
  );
  const lookupEvidenceDocument = $derived(lookupEvidenceProjection.document);
  const caseEvidence = $derived(lookupAnalysis.caseEvidence);
  const checkpointFacts = $derived(lookupAnalysis.checkpointFacts);
  const profileContextLimitation = $derived(lookupAnalysis.profileContextLimitation);

  async function refreshProfileContext() {
    profileSourceState = 'loading';
    profile = null;
    try {
      profile = await activeProfile();
      profileSourceState = 'ready';
    } catch {
      profile = null;
      profileSourceState = 'unavailable';
    }
  }
  async function refreshCase(
    expectedRevision: number | null = null,
    preferredCase: Pick<CaseRecord, 'id' | 'domain'> | null = caseRecord,
  ) {
    if (expectedRevision !== null && expectedRevision !== lookupRequestController.revision) return;
    let linkedId = '';
    const linkedQuery = page.url.searchParams.get('q');
    try {
      if (
        linkedQuery &&
        prepareLookupCollectionTarget(linkedQuery) === session.observation.target
      ) {
        linkedId = linkedCaseReference ?? '';
      }
    } catch {
      /* Invalid URL input does not select a Case. */
    }
    await lookupCaseWorkspace.refresh(
      preferredCase && preferredCase.domain === caseDomain ? preferredCase.id : linkedId,
    );
  }
  async function recheckLookupCase() {
    const target = caseObservationTarget;
    if (!target || session.loading) return;
    session.request.query = target;
    session.request.lookupMode = lookupEvidenceDepth;
    await lookupCaseWorkspace.recheck(() => runLookup({ refreshCaseEvidence: true }));
  }
  function cancelLookup() {
    lookupRequestController.cancel();
  }
  function setTaskView(value: LookupTaskView) {
    lookupSession.selectTask(value);
    writeLookupPresentation(localStorage, { task: session.task });
  }
  function invalidateLookupForInputChange() {
    lookupSession.invalidateInput();
  }
  function handleLookupQueryChange(value: string) {
    lookupSession.changeQuery(value);
  }
  $effect(() => {
    const signature = LookupSession.urlSignature(page.url);
    if (!session.urlReady || signature === session.lastUrl) return;
    lookupSession.reconcileUrl(page.url);
  });
  const webSurfaces = $derived(
    lookupWebSurfaces(lookupView, {
      serviceDependency: Boolean(serviceDependencyReview),
      pageComparison: Boolean(
        pageComparison ||
        (profile?.pageBaseline && session.observation.response?.type === 'domain'),
      ),
      brandMimicry: Boolean(brandMimicryReview),
    }),
  );
  const sectionSurfaces = $derived(
    lookupSectionSurfaces(lookupView, {
      domainResult: session.observation.response?.type === 'domain',
      caseSection: hasCaseSection,
      web: webSurfaces,
    }),
  );
  function preloadLookupSection(sectionId: string) {
    if (!Object.hasOwn(sectionSurfaces, sectionId)) return;
    const surfaces = sectionSurfaces[sectionId as keyof typeof sectionSurfaces];
    preloadBestEffort(
      () =>
        Promise.all(
          Object.values(surfaces)
            .filter((surface) => surface.visible)
            .map((surface) => surface.load()),
        ),
      moduleController.signal,
    );
  }
  const sectionNavigation = new LookupSectionNavigation({
    expanded: () => session.observation.expandedSections,
    publish: (sections) => {
      session.observation.expandedSections = sections;
    },
    sections: resultSectionLinks,
    preload: preloadLookupSection,
    anchor: () => pageLifecycle.anchor,
    hash: () => window.location.hash,
    replaceHash: (href) => window.history.replaceState(window.history.state, '', href),
    rendered: tick,
  });
  const evidenceLinkNavigation = (node: HTMLElement) => sectionNavigation.links(node);
  const restoreDeferredLookupTarget = () => sectionNavigation.contentReady();
  function navigateToCurrentLookupHash() {
    if (session.observation.response) void sectionNavigation.navigate(window.location.hash);
  }
  function setFreshnessPolicy(value: {
    mode: 'task-default' | 'analyst-custom';
    thresholdsDays: LookupFreshnessThresholds;
  }) {
    freshnessPolicyMode = value.mode;
    customFreshnessThresholds = value.thresholdsDays;
  }
  const pageLifecycle = new LookupPageLifecycle({
    session: lookupSession,
    restore: () => ({
      saved: readLookupWorkflowState(),
      task: readLookupPresentation(localStorage).task,
    }),
    retain: writeLookupWorkflowState,
    request: lookupRequestController,
    savedWorkspaces: [lookupCaseWorkspace, watchlistWorkspace],
    createAnchor: () => new LookupAnchorController(),
    refreshProfile: refreshProfileContext,
    refreshSaved: async (revision) => {
      await Promise.all([refreshCase(revision), watchlistWorkspace.refresh(revision)]);
    },
    navigateHash: navigateToCurrentLookupHash,
  });
  onMount(() => pageLifecycle.mount(page.url, window));

  function websiteSnapshotInput() {
    const now = new Date().toISOString();
    return buildLookupWebsiteSnapshot({
      id: crypto.randomUUID
        ? crypto.randomUUID()
        : `website-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      domain: observationHostname ?? caseDomain,
      observedAt: lookupObservedAt || now,
      ...(availability.webObservationMode === 'selected_url'
        ? { webObservationMode: 'selected_url' as const }
        : {}),
      savedAt: now,
      lookupEvidenceDepth,
      technologyProfile,
      securityPosture,
      tlsEvidence,
      baseline: observedPageBaseline,
      pageIdentity,
      technologyFindings: pageDisplay.technologyFindings,
      securityPostureFindings: pageDisplay.securityPostureFindings,
      diagnostics,
      dependencies: serviceDependencyReview?.dependencies ?? [],
    });
  }
  function downloadEvidence() {
    const status = exportLookupEvidence(session.observation.response, lookupEvidenceProjection);
    if (status !== null) session.observation.exportStatus = status;
  }
  function downloadReadableReport(includeAttribution = true) {
    const status = exportLookupReadableReport(
      session.observation.response,
      lookupEvidenceProjection,
      {
        risk,
        decisionFacts: lookupDecisionFacts,
        applicationVersion: __WHOISLEUTH_VERSION__,
        includeAttribution,
      },
    );
    if (status !== null) session.observation.exportStatus = status;
  }
  function downloadInvestigationBrief() {
    if (session.observation.response) exportLookupInvestigationBrief(lookupInvestigationBrief);
  }
  async function downloadClaimPassport(claimId: LookupClaimId): Promise<string> {
    if (!session.observation.response)
      throw new Error('Run a Lookup before exporting a claim passport.');
    return exportLookupClaimPassport({
      readiness: lookupClaimReadiness,
      claimId,
      targetType: session.observation.response.type,
      target: session.observation.response.query,
      lookupDepth: lookupEvidenceDepth,
      observedAt: lookupObservedAt,
      evidenceObservedAtById,
      riskModelVersion: risk?.modelVersion,
      applicationVersion: __WHOISLEUTH_VERSION__,
    });
  }
  async function copyDraft(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      session.observation.draftStatus = `Copied ${label} to the clipboard.`;
    } catch {
      session.observation.draftStatus =
        'Clipboard access was unavailable. Use the email draft link instead.';
    }
  }
  function resultSectionLinks() {
    return buildLookupResultSectionLinks({
      hasWebEvidence,
      domainResult: session.observation.response?.type === 'domain',
      hasExternalIntelligence: threatIntelligenceProviders.length > 0,
      hasCaseSection,
      task: session.task,
    });
  }
  const lookupCollection = new LookupCollectionWorkflow(lookupSession, lookupRequestController, {
    context: () => ({
      disabled: lookupDisabled,
      tooLarge: parsedInput.tooLarge,
      entries: lookupEntries,
      preferredCase: caseRecord,
      capabilities: {
        externalIntelligenceSupported,
        malwareHostIntelligenceSupported,
        malwareIocIntelligenceSupported,
        websiteObservationSupported,
        securityTxtEligible,
      },
    }),
    active: () => pageLifecycle.active,
    saveHandoff: saveCandidateHandoff,
    navigate: goto,
    stopReveal: () => pageLifecycle.anchor?.stop(),
    captureReveal: () => pageLifecycle.anchor?.captureRevealIntent(),
    refreshProfile: refreshProfileContext,
    refreshCase,
    refreshWatchlist: (revision) => watchlistWorkspace.refresh(revision),
    retainCase: () => caseActions.open(),
    rendered: () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    reveal: (refreshCaseEvidence) => {
      if (refreshCaseEvidence) void sectionNavigation.navigate('#case-response');
      else if (window.location.hash && lookupEvidenceFamilyForHref(window.location.hash))
        navigateToCurrentLookupHash();
      else
        document.querySelector('#result')?.scrollIntoView({ behavior: 'instant', block: 'start' });
    },
  });
  const runLookup = (options: Readonly<{ refreshCaseEvidence?: boolean }> = {}) =>
    lookupCollection.run(options);
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    await runLookup();
  }
</script>

<svelte:head><title>Lookup · WHOISleuth</title></svelte:head>
<PageHeading
  eyebrow="Investigate"
  title="Lookup"
  description="Collect evidence for a domain, IP address or ASN."
/>
{#if invalidCaseReference}<p class="local-context-status" role="status"
    >The Case reference is invalid. No Case was selected.</p
  >{/if}
<LookupForm
  bind:query={session.request.query}
  task={session.task}
  bind:lookupMode={session.request.lookupMode}
  bind:collectSelectedUrl={session.collectSelectedUrl}
  loading={session.loading}
  loadingElapsedMs={session.loadingElapsedMs}
  sourceProgress={session.sourceProgress}
  loadingDeadlineMs={LOOKUP_CLIENT_TIMEOUT_MS}
  entryCount={lookupEntries.length}
  duplicateCount={parsedInput.duplicates}
  inputTooLarge={parsedInput.tooLarge}
  {lookupDisabled}
  {lookupLimitations}
  {externalIntelligenceSupported}
  {malwareHostIntelligenceSupported}
  {malwareIocIntelligenceSupported}
  {websiteObservationSupported}
  {securityTxtEligible}
  bind:includeExternalIntelligence={session.request.includeExternalIntelligence}
  bind:includeMalwareHostIntelligence={session.request.includeMalwareHostIntelligence}
  bind:includeMalwareIocIntelligence={session.request.includeMalwareIocIntelligence}
  bind:includeSecurityTxt={session.request.includeSecurityTxt}
  error={session.error}
  onsubmit={submit}
  oncancel={cancelLookup}
  onquerychange={handleLookupQueryChange}
>
  {#snippet guidance()}
    <LookupTaskGuidance
      task={session.task}
      lookupMode={session.request.lookupMode}
      ontask={setTaskView}
      onmode={(mode) => {
        session.request.lookupMode = mode;
        invalidateLookupForInputChange();
        lookupSession.clearCompleted();
      }}
    />
  {/snippet}
</LookupForm>

<MessageIntake
  headingLevel={2}
  disabled={session.loading}
  onselect={async (target) => {
    session.request.query = target;
    session.collectSelectedUrl = false;
    handleLookupQueryChange(target);
    await tick();
    document.getElementById('query')?.focus();
  }}
/>

<LookupSavedContextPreview query={session.request.query} />

{#if profileContextLimitation}<p class="local-context-status" role="status"
    >{profileContextLimitation}</p
  >{/if}

<LookupEvidenceReplay />

{#if session.observation.response}
  <section class="result-root" id="result" use:evidenceLinkNavigation>
    <LookupResultHeader
      title={show(
        session.observation.response.inputHostname ||
          session.observation.response.registrableDomain ||
          session.observation.response.query,
      )}
      state={show(availability.state)}
      isSubdomain={Boolean(session.observation.response.isSubdomain)}
      registrableDomain={show(session.observation.response.registrableDomain)}
      inputHostname={show(session.observation.response.inputHostname)}
      {observationHostname}
      selectedUrl={availability.webObservationMode === 'selected_url'}
      observedAt={lookupObservedAt}
      depth={lookupEvidenceDepth}
      caseHref={caseDomain
        ? caseRecord
          ? caseWorkspaceHref(caseRecord.id)
          : '#case-response'
        : null}
      caseLabel={caseRecord
        ? 'Open saved Case'
        : caseState.sourceState === 'ready'
          ? 'Keep in Case'
          : 'Case context'}
      onCaseOpen={preserveLookupReturn}
      onExport={downloadEvidence}
      onReportExport={downloadReadableReport}
      onBriefExport={downloadInvestigationBrief}
    />
    {#if session.observation.exportStatus || lookupEvidenceProjection.error}<p
        class:portable-evidence-status={Boolean(lookupEvidenceProjection.error)}
        class="local-context-status"
        role="status"
        aria-atomic="true">{session.observation.exportStatus || lookupEvidenceProjection.error}</p
      >{/if}

    <LookupPresentationControls
      allSectionsExpanded={sectionNavigation.allVisible()}
      anySectionsExpanded={sectionNavigation.anyVisible()}
      expandAll={() => sectionNavigation.setAll(true)}
      collapseAll={() => sectionNavigation.setAll(false)}
    />

    <LocalSectionNav
      label="Result sections"
      links={resultSectionLinks()}
      trackCurrent
      onnavigate={(href) => void sectionNavigation.navigate(href)}
    />

    {#snippet overviewSection()}
      <LookupEvidenceSection id="overview" title="Overview" family="overview">
        <LookupAtAGlance
          reviewActions={lookupReviewActionModel}
          {lookupDecisionFacts}
          signals={lookupSummary.signals}
          readiness={lookupClaimReadiness}
        />

        {#if availability.applicable !== false}
          <LookupAssessment
            detail={show(availability.detail || availability.state)}
            confidence={show(availability.confidence)}
            {risk}
            {riskSensitivity}
            {opportunity}
            signals={[...lookupSummary.signals]}
            trusted={String(profileSignals.trusted || '')}
            task={session.task}
          />
        {/if}

        <details class="detailed-assessment card" bind:open={session.observation.assessmentOpen}>
          <summary>
            <span
              ><strong>Assessment detail</strong><small
                >Evidence Readiness and portable hand-off{session.task === 'acquisition'
                  ? ', with acquisition review'
                  : ''}</small
              ></span
            >
            <span
              >{session.observation.assessmentOpen ? 'Close assessment' : 'Open assessment'}</span
            >
          </summary>
          <div class="detailed-assessment-body">
            <DeferredSurface
              load={() => import('$lib/components/LookupClaimReadiness.svelte')}
              loadingLabel="Loading Evidence Readiness review…"
              unavailableLabel="Evidence Readiness review could not be loaded."
              placeholder="panel"
              props={{
                readiness: lookupClaimReadiness,
                reviewActions: lookupReviewActionModel,
                onpassport: downloadClaimPassport,
              }}
            />

            {#if lookupEvidenceDocument}
              <DeferredSurface
                load={() => import('$lib/components/LookupInvestigationCapsule.svelte')}
                loadingLabel="Loading portable investigation hand-off…"
                unavailableLabel="The portable investigation hand-off could not be loaded."
                placeholder="panel"
                props={{
                  applicationVersion: __WHOISLEUTH_VERSION__,
                  lookupEvidence: lookupEvidenceDocument,
                  brief: lookupInvestigationBrief,
                  graph: lookupAssetGraph,
                  caseRecord: caseRecord,
                }}
              />
            {/if}

            {#if session.observation.response?.type === 'domain' && session.task === 'acquisition'}
              <DeferredSurface
                load={() => import('$lib/components/LookupAcquisitionDueDiligence.svelte')}
                loadingLabel="Loading acquisition due-diligence review…"
                unavailableLabel="Acquisition due-diligence review could not be loaded."
                placeholder="workspace"
                props={{
                  review: acquisitionDueDiligence,
                  target: caseDomain,
                  observedAt: lookupObservedAt,
                }}
              />
            {/if}
          </div>
        </details>
      </LookupEvidenceSection>
    {/snippet}

    {#snippet webSection()}
      {#if hasWebEvidence}
        <LookupWebEvidenceSection
          result={session.observation.response}
          view={lookupView}
          surfaces={webSurfaces}
          analysis={lookupAnalysis}
          {serviceDependencyReview}
          {profile}
          {caseDomain}
          {lookupEvidenceDepth}
          {lookupObservedAt}
          loading={session.loading}
          expanded={sectionNavigation.visible('web-evidence')}
          serviceDependencyScope={session.observation.serviceScope}
          serviceDependencyFalsePositives={session.observation.serviceFalsePositives}
          buildSnapshot={websiteSnapshotInput}
          onpreload={() => preloadLookupSection('web-evidence')}
          onshow={() => void sectionNavigation.navigate('#web-evidence')}
          onhide={() => void sectionNavigation.navigate('#web-evidence', false)}
          onready={restoreDeferredLookupTarget}
          setServiceDependencyScope={(value) => (session.observation.serviceScope = value)}
          setServiceDependencyFalsePositives={(value) =>
            (session.observation.serviceFalsePositives = value)}
          {sourceCheckpoint}
        />
      {/if}
    {/snippet}

    {#snippet sourceCheckpoint(category: CheckpointFact['category'], label: string)}
      {#if session.observation.response?.type === 'domain'}
        {#key session.observation.response}
          <LookupSourceCheckpoint
            {label}
            facts={checkpointFacts.filter((fact) => fact.category === category)}
            record={caseRecord}
            ready={caseState.sourceState === 'ready'}
            busy={caseState.busy}
            status={caseState.status}
            oncreate={caseActions.open}
            onsave={caseActions.saveCheckpoint}
          />
        {/key}
      {/if}
    {/snippet}

    {#snippet registrySection()}
      <LookupRegistrySection
        view={lookupView}
        analysis={lookupAnalysis}
        surfaces={sectionSurfaces.registry}
        controls={sectionNavigation.controls('registry')}
        target={session.observation.target}
        resultType={session.observation.response?.type ?? ''}
        caseId={caseRecord?.id ?? ''}
        {sourceCheckpoint}
      />
    {/snippet}

    {#snippet relationshipsSection()}
      <LookupRelationshipsSection
        analysis={lookupAnalysis}
        surfaces={sectionSurfaces['relationships-history']}
        controls={sectionNavigation.controls('relationships-history')}
        resultType={session.observation.response?.type ?? ''}
        bind:visualView={session.visualView}
      />
    {/snippet}

    {#snippet sourceQualitySection()}
      <LookupSourceQualitySection
        view={lookupView}
        analysis={lookupAnalysis}
        surfaces={sectionSurfaces['source-quality']}
        controls={sectionNavigation.controls('source-quality')}
        original={session.observation.response}
        refreshLedger={session.observation.refreshLedger}
        onrefreshchange={(value) => (session.observation.refreshLedger = value)}
        caseTarget={{
          record: caseRecord,
          ready: caseState.sourceState === 'ready',
          busy: caseState.busy,
          status: caseState.status,
          oncreate: caseActions.open,
          onsave: caseActions.saveRefreshedCheckpoint,
        }}
        onpolicychange={setFreshnessPolicy}
      />
    {/snippet}

    {#snippet caseSection()}
      {#if sectionSurfaces['case-response'].workspace.visible}
        <LookupEvidenceSection id="case-response" title="Case and response" family="analyst">
          <LookupFamilySummary
            label="Case and response"
            description="Save reviewed evidence, keep analyst assertions separate, and prepare human-reviewed response routes without sending anything automatically."
            metrics={[
              caseState.sourceState === 'ready'
                ? caseRecord
                  ? 'Case saved'
                  : 'No case saved'
                : caseState.sourceState === 'loading'
                  ? 'Case loading'
                  : 'Case unavailable',
              `${abuseRecipientResolution.recipients.length} published ${abuseRecipientResolution.recipients.length === 1 ? 'route' : 'routes'}`,
            ]}
            expanded={sectionNavigation.visible('case-response')}
            onpreload={() => preloadLookupSection('case-response')}
            onshow={() => void sectionNavigation.navigate('#case-response')}
            onhide={() => void sectionNavigation.navigate('#case-response', false)}
          />
          {#if sectionNavigation.visible('case-response')}
            <DeferredSurface
              load={sectionSurfaces['case-response'].workspace.load}
              loadingLabel="Loading Case and response workspace…"
              unavailableLabel="The Case and response workspace could not be loaded."
              onready={restoreDeferredLookupTarget}
              props={{
                observation: {
                  domain: caseDomain,
                  lookupTarget: caseObservationTarget,
                  lookupDepth: lookupEvidenceDepth,
                  task: session.task,
                  incidentUrl: session.observation.incidentUrl,
                  checkpointFacts,
                },
                caseState,
                actions: caseActions,
                watchlist: {
                  state: watchlistState,
                  setName: (value: string) => watchlistWorkspace.setName(value),
                  save: () => watchlistWorkspace.save(),
                },
                reporting: {
                  outreach,
                  recipientResolution: abuseRecipientResolution,
                  draftStatus: session.observation.draftStatus,
                  copyDraft,
                },
                oncaseopen: preserveLookupReturn,
                retryCaseRead: () => refreshCase(),
                recheckCase: recheckLookupCase,
              }}
            />
            {#if caseRecord && checkpointFacts.length && session.task === 'acquisition'}
              <LookupEvidenceCheckpoint
                facts={checkpointFacts}
                pins={caseRecord.evidencePins}
                onsave={caseActions.saveCheckpoint}
                actionBusy={caseState.busy}
              />
            {/if}
          {/if}
        </LookupEvidenceSection>
      {/if}
    {/snippet}

    {#snippet advancedSection()}
      <LookupEvidenceSection id="advanced-evidence" title="Advanced evidence" family="raw">
        <LookupFamilySummary
          label="Advanced evidence"
          description="Open optional external intelligence and the full validated lookup response only when the investigation requires their additional detail."
          metrics={[
            `${threatIntelligenceProviders.length} external providers`,
            'Full response available',
          ]}
          expanded={sectionNavigation.visible('advanced-evidence')}
          onpreload={() => preloadLookupSection('advanced-evidence')}
          onshow={() => void sectionNavigation.navigate('#advanced-evidence')}
          onhide={() => void sectionNavigation.navigate('#advanced-evidence', false)}
        />
        {#if sectionNavigation.visible('advanced-evidence')}
          {#if sectionSurfaces['advanced-evidence'].intelligence.visible}
            <section
              class="advanced-block"
              id="external-intelligence"
              aria-labelledby="external-intelligence-title"
            >
              <h4 id="external-intelligence-title">External intelligence</h4>
              <DeferredSurface
                load={sectionSurfaces['advanced-evidence'].intelligence.load}
                loadingLabel="Loading external-intelligence evidence…"
                unavailableLabel="External-intelligence evidence could not be loaded."
                onready={restoreDeferredLookupTarget}
                props={{
                  providers: threatIntelligenceProviders,
                  riskContext: externalRiskContext,
                  riskModelVersion: risk?.modelVersion ?? null,
                  showValue: show,
                  formatDate,
                }}
              />
            </section>
          {/if}
          <section class="advanced-block" id="raw-data" aria-labelledby="raw-data-title">
            <h4 id="raw-data-title">Validated lookup response</h4>
            <div class="raw card">
              <p class="card-note"
                >Full response returned to this browser after validation. Source-specific limits and
                unavailable fields remain explicit.</p
              >
              <!-- svelte-ignore a11y_no_noninteractive_tabindex (Safari requires a focusable scroll region.) -->
              <div
                class="raw-response-scroll"
                role="group"
                tabindex="0"
                aria-labelledby="raw-data-title"
              >
                <pre>{validatedResponseJson}</pre>
              </div>
            </div>
          </section>
        {/if}
      </LookupEvidenceSection>
    {/snippet}

    <div class="evidence-sections">
      {#each resultSectionLinks() as section (section.href)}
        {#if section.href === '#overview'}
          {@render overviewSection()}
        {:else if section.href === '#registry'}
          {@render registrySection()}
        {:else if section.href === '#web-evidence'}
          {@render webSection()}
        {:else if section.href === '#relationships-history'}
          {@render relationshipsSection()}
        {:else if section.href === '#source-quality'}
          {@render sourceQualitySection()}
        {:else if section.href === '#case-response'}
          {@render caseSection()}
        {:else if section.href === '#advanced-evidence'}
          {@render advancedSection()}
        {/if}
      {/each}
    </div>
  </section>
{/if}

<style>
  .result-root {
    min-width: 0;
    overflow-x: clip;
    overflow-clip-margin: 3px;
    scroll-margin-top: var(--local-nav-anchor-offset, 72px);
  }
  .evidence-sections {
    display: flow-root;
  }
  .detailed-assessment {
    margin-top: 12px;
    padding: 0;
    overflow: hidden;
  }
  .detailed-assessment > summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    padding: 14px;
    cursor: pointer;
    list-style: none;
  }
  .detailed-assessment > summary::-webkit-details-marker {
    display: none;
  }
  .detailed-assessment > summary span:first-child {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .detailed-assessment > summary strong {
    color: var(--text);
    font: 700 var(--text-sm) var(--mono);
  }
  .detailed-assessment > summary small {
    color: var(--muted);
    font-size: var(--text-xs);
    line-height: 1.45;
  }
  .detailed-assessment > summary span:last-child {
    flex: 0 0 auto;
    color: var(--accent);
    font: 700 var(--text-2xs) var(--mono);
    text-transform: uppercase;
  }
  .detailed-assessment > summary span:last-child::before {
    content: '+';
    display: inline-block;
    width: 1.2em;
  }
  .detailed-assessment[open] > summary {
    border-bottom: 1px solid var(--border);
    background: var(--panel-raised);
  }
  .detailed-assessment[open] > summary span:last-child::before {
    content: '−';
  }
  .detailed-assessment-body {
    padding: 0 14px 14px;
  }
  .portable-evidence-status {
    margin: 12px 0 0;
    padding: 10px 12px;
    border: 1px dotted var(--amber);
    border-radius: var(--radius-sm);
    color: var(--text);
    background: color-mix(in srgb, var(--amber) 7%, var(--surface));
    font-size: var(--text-xs);
    line-height: 1.55;
  }
  :global(.result-root.lookup-scroll-aligning) {
    overflow-anchor: none;
  }
  .advanced-block {
    min-width: 0;
    scroll-margin-top: var(--local-nav-anchor-offset, 88px);
  }
  .advanced-block + .advanced-block {
    margin-top: 14px;
  }
  .advanced-block > h4 {
    margin: 0 0 10px;
    font: 700 var(--text-sm) var(--mono);
  }
  .card-note {
    margin: 12px 0 0;
    color: var(--muted);
    font-size: var(--text-xs);
    line-height: 1.55;
  }

  .raw {
    padding: 0;
    overflow: hidden;
  }
  .raw > .card-note {
    margin: 0;
    padding: 10px var(--card-pad);
    border-bottom: 1px solid var(--border);
  }
  .raw-response-scroll {
    max-height: 520px;
    overflow: auto;
  }
  .raw-response-scroll:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }
  .raw pre {
    margin: 0;
    padding: var(--card-pad);
    font-size: var(--text-xs);
  }

  @media (max-width: 700px) {
    .detailed-assessment > summary {
      align-items: flex-start;
      flex-direction: column;
      gap: 10px;
    }
  }
</style>
