<script lang="ts">
  import { downloadLocalFile } from '$lib/download-local-file.ts';
  import { goto } from '$app/navigation';
  import { page as routePage } from '$app/state';
  import { getContext, onMount, tick } from 'svelte';
  import { parseBoundedJson } from '$lib/bounded-json';
  import BulkScanQueue from '$lib/components/BulkScanQueue.svelte';
  import BulkMobileDisclosure from '$lib/components/BulkMobileDisclosure.svelte';
  import DeferredSurface from '$lib/components/DeferredSurface.svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import {
    activeProfile,
    isDomainAllowlisted,
    normalizeProfile,
    type ActiveBrandProfileSourceState,
    type BrandProfile,
  } from '$lib/brand-profiles';
  import type { BrowserLocalCollectionLoadState } from '$lib/browser-local-data-service';
  import {
    consumeCandidateHandoff,
    type Candidate,
    type CandidateHandoff,
    type CertificateTransparencyProvenance,
  } from '$lib/candidate-handoff';
  import type { ShortlistRecord } from '$lib/shortlist';
  import type { CaseRecord } from '$lib/cases';
  import { saveWatchlist } from '$lib/watchlists';
  import {
    failedLocalMutationOutcome,
    type LocalMutationOutcome,
  } from '$lib/local-mutation-outcome.ts';
  import { MUTATION_LABELS } from '$lib/analysis/typosquat-generator.ts';
  import { buildCoverageReport } from '$lib/analysis/coverage.ts';
  import {
    canonicalBulkTargets,
    failedBulkScanResult,
    normalizeBulkScanResult,
  } from '$lib/analysis/bulk-scan-normalizer.ts';
  import { parseDomainInput } from '$lib/analysis/utils.ts';
  import {
    buildScanRelationships,
    RELATIONSHIP_EVIDENCE_VERSION,
  } from '$lib/analysis/relationship-evidence.ts';
  import type { RelationshipObservation } from '$lib/analysis/relationship-evidence.ts';
  import {
    relationshipAdmissionMatchesCurrent,
    type RelationshipRetentionAdmission,
  } from '$lib/analysis/relationship-admission-preview.ts';
  import { relationshipObservationId } from '$lib/analysis/relationship-observation-model.ts';
  import { buildBulkCoverageCsv, buildBulkResultsCsv } from '$lib/analysis/bulk-export.ts';
  import {
    buildDefensiveIndicatorExport,
    prepareDefensiveIndicatorExport,
  } from '$lib/analysis/defensive-indicator-export.ts';
  import { BulkCaseActions } from '$lib/controllers/bulk-case-actions.ts';
  import {
    BulkSessionWorkspace,
    type BulkSessionWorkspaceState,
  } from '$lib/controllers/bulk-session-workspace.ts';
  import {
    BulkMonitorActions,
    type BulkMonitorScope,
  } from '$lib/controllers/bulk-monitor-actions.ts';
  import type { CompactLookupHttpResponse } from '$lib/analysis/lookup-response.ts';
  import { fetchCompactBulkLookup } from '$lib/analysis/bulk-lookup-controller.ts';
  import {
    BulkScanController,
    type BulkScanState,
    type BulkScanProfileSnapshot,
  } from '$lib/controllers/bulk-scan-controller.ts';
  import {
    bulkNavigationView,
    bulkReviewView,
    clearBulkViewFilters,
    createBulkViewState,
    restoreBulkView,
  } from '$lib/controllers/bulk-view-state.ts';
  import {
    bulkProfileContextsMatch,
    fromBulkSessionResult,
    quarantineBulkProfileDerivedEvidence,
    reconcileBulkResultProfileContext,
    toBulkSessionResult,
    type ScanMode,
    type ScanResult,
  } from '$lib/analysis/bulk-result-model.ts';
  import {
    BULK_PROFILE_CONTEXT_MISMATCH_LIMITATION,
    bulkProfileContextProvenance,
    normalizeBulkProfileContext,
    summarizeBulkProfileContexts,
    type BulkProfileContextProvenance,
  } from '$lib/analysis/bulk-session-model.ts';
  import {
    defaultBulkSortDirection,
    normalizeBulkPresentationSortKey,
    sortBulkResults,
    type BulkSortDirection,
    type BulkSortKey,
  } from '$lib/analysis/bulk-sort.ts';
  import {
    buildBulkTriageGroups,
    bulkAdvancedFilterOptions,
    matchesBulkAdvancedFilters,
    type BulkAdvancedFilters,
    type BulkAgeFilter,
    type BulkGroupBy,
    type BulkLifecycleFilter,
    type BulkMailFilter,
    type BulkSourceFilter,
  } from '$lib/analysis/bulk-triage.ts';
  import {
    buildBulkRiskComparison,
    buildBulkRiskPresentation,
    buildBulkResultDisplayRows,
    comparableBulkRiskScore,
    countBulkRouteFilters,
    matchesBulkRouteFilter,
    toBulkRouteTriageRow,
    type BulkPrimaryFilter,
  } from '$lib/analysis/bulk-route-model.ts';
  import {
    CAPABILITY_CONTEXT,
    disabledCapabilities,
    disabledCapability,
    type CapabilityGetter,
  } from '$lib/capabilities';
  import { readBulkWorkflowState, writeBulkWorkflowState } from '$lib/console-workflow-state.ts';
  import {
    loadInvestigationGuide,
    selectInvestigationGuideFocusDomain,
    selectInvestigationGuideReviewDomains,
  } from '$lib/investigation-guide';
  import { unavailableLocalContextLabels } from '$lib/local-context-load.ts';
  import { preloadBestEffort } from '$lib/idle-preload';
  import { loadDeferredModule } from '$lib/deferred-module';
  import type { BulkSession } from '$lib/bulk-sessions';
  import type {
    BulkReviewFilter,
    BulkReviewPreset,
    BulkReviewPresetView,
    BulkReviewState,
    BulkReviewStore,
  } from '$lib/bulk-review';
  import type { BulkResultColumn } from '../../../../../packages/workspace/bulk-columns.mts';
  import {
    BULK_REVIEW_SCHEMA,
    BULK_REVIEW_SCHEMA_VERSION,
  } from '$lib/analysis/bulk-review-model.ts';
  import {
    buildBulkDomainComparison,
    buildBulkDomainComparisonExport,
  } from '$lib/analysis/bulk-domain-comparison.ts';
  import { buildBulkRetryPlan } from '$lib/analysis/bulk-retry-plan.ts';
  import {
    BULK_PACING_OPTIONS,
    buildBulkProgressEstimate,
    buildBulkProgressOutcomes,
    bulkConcurrency,
    normalizeBulkPacing,
    type BulkPacing,
  } from '$lib/analysis/bulk-pacing.ts';
  import { bulkQueryLimit } from '$lib/analysis/bulk-limits.ts';
  import { buildBulkReviewManifest } from '$lib/analysis/bulk-review-export.ts';
  import {
    buildBulkPeerOutlierExport,
    buildBulkPeerOutlierMatrix,
  } from '$lib/analysis/bulk-peer-outliers.ts';
  import {
    buildBulkMailExposureExport,
    buildBulkMailExposureReport,
  } from '$lib/analysis/bulk-mail-exposure.ts';
  import type { BulkReviewCockpitRow } from '$lib/analysis/bulk-review-cockpit.ts';
  import {
    casesForDomain,
    selectedCasesByDomain,
  } from '../../../../../packages/cases/case-selection.mts';
  import { registerAnalystUndo } from '$lib/analyst-undo';
  const moduleController = new AbortController();
  const preloadModule = (load: () => Promise<unknown>) =>
    preloadBestEffort(load, moduleController.signal);
  let analysisPreloadGeneration = 0;
  let analysisPreloadReady = $state(false);

  const MAX_DOMAIN_IMPORT_BYTES = 2 * 1024 * 1024;
  const PAGE_SIZE = 100;
  type ShortlistApi = typeof import('$lib/shortlist');
  type CasesApi = typeof import('$lib/cases');
  type ShortlistSelectionResult = Awaited<ReturnType<ShortlistApi['setShortlistSelection']>>;
  type MobileResultView = 'review' | 'list' | 'analysis';
  type WorkspaceTool = 'sessions' | 'review' | 'indicators';
  type BulkReviewApi = typeof import('$lib/bulk-review');
  type RelationshipApi = typeof import('$lib/relationship-observations');
  let handoff = $state<CandidateHandoff | null>(null);
  let input = $state('');
  let mode = $state<ScanMode>('fast');
  let pacing = $state<BulkPacing>('standard');
  let view = $state(createBulkViewState());
  const scanController: BulkScanController = new BulkScanController((next) => {
    scan = next;
  });
  let scan: BulkScanState = $state.raw(scanController.state);
  // Progress updates must not rerun result analysis between batched publications.
  const results = $derived(scan.results);
  let status = $state('');
  let indicatorFormat = $state<'domains' | 'hosts' | 'dnsmasq' | 'rpz' | 'stix' | 'misp'>(
    'domains',
  );
  let indicatorWildcards = $state(false);
  let indicatorStatus = $state('');
  let watchlistName = $state('');
  let saveStatus = $state('');
  let profile = $state<BrandProfile | null>(null);
  let profileSourceState = $state<ActiveBrandProfileSourceState>('loading');
  let shortlist = $state<ShortlistRecord[]>([]);
  let shortlistStatus = $state('');
  let draftStatus = $state('');
  let shortlistSourceState = $state<BrowserLocalCollectionLoadState>('idle');
  let cases = $state<CaseRecord[]>([]);
  let caseStatus = $state('');
  let caseMutationBusy = $state(false);
  let casesSourceState = $state<BrowserLocalCollectionLoadState>('idle');
  let retainedRelationshipIds = $state<Set<string>>(new Set());
  let relationshipRetentionStatus = $state('');
  let relationshipsSourceState = $state<BrowserLocalCollectionLoadState>('idle');
  const sessionWorkspace = new BulkSessionWorkspace({
    loadStorage: () =>
      loadDeferredModule(() => import('$lib/bulk-sessions'), { signal: moduleController.signal }),
    scan: () => ({
      running: scan.running,
      mode,
      domains: parseDomains(),
      results,
      cancelled: scan.cancelled,
    }),
    publish: (next) => {
      sessionState = next;
    },
    confirm: (message) => confirm(message),
  });
  let sessionState: BulkSessionWorkspaceState = $state.raw(sessionWorkspace.state);
  const scanStartedAt = $derived(sessionState.startedAt);
  let bulkReviewStore = $state<BulkReviewStore>({
    schema: BULK_REVIEW_SCHEMA,
    version: BULK_REVIEW_SCHEMA_VERSION,
    presets: [],
    rows: [],
  });
  let bulkReviewStatus = $state('');
  let bulkReviewSourceState = $state<BrowserLocalCollectionLoadState>('idle');
  let retryStatus = $state('');
  let localContextStatus = $state('');
  let workspaceToolsOpen = $state(false);
  let workspaceTool = $state<WorkspaceTool>('sessions');
  let mobileResultView = $state<MobileResultView>('list');
  let bulkReviewApi: BulkReviewApi | null = null;
  let relationshipApi: RelationshipApi | null = null;
  let bulkReviewLoad: Promise<void> | null = null;
  let relationshipLoad: Promise<void> | null = null;
  let shortlistApi: ShortlistApi | null = null;
  let casesApi: CasesApi | null = null;
  let primaryResultContextLoad: Promise<void> | null = null;
  let caseOptions = $state<ReadonlyArray<CasesApi['CASE_DISPOSITIONS'][number]>>([]);
  const capabilityReport = getContext<CapabilityGetter>(CAPABILITY_CONTEXT);
  const lookupDisabled = $derived(disabledCapability(capabilityReport?.() || null, 'lookup'));
  const scanLimitations = $derived(
    disabledCapabilities(
      capabilityReport?.() || null,
      mode === 'fast'
        ? ['rdap', 'availability']
        : [
            'rdap',
            'whois',
            'availability',
            'dns_intelligence',
            'website_probe',
            'tls_intelligence',
          ],
    ),
  );
  let caseSelections = $state<ReadonlyMap<string, string>>(new Map());
  const caseByDomain = $derived(selectedCasesByDomain(cases, caseSelections));
  function selectIncidentCase(domain: string, id: string) {
    if (caseMutationBusy || !cases.some((record) => record.id === id && record.domain === domain))
      return false;
    caseSelections = new Map(caseSelections).set(domain, id);
    return true;
  }
  function caseTriageRow(row: ScanResult) {
    const selected = caseByDomain.get(row.domain) || null;
    return toBulkRouteTriageRow(
      row,
      selected,
      casesSourceState !== 'ready'
        ? 'unavailable'
        : !selected && casesForDomain(cases, row.domain).length
          ? 'selection_required'
          : 'ready',
    );
  }
  const mutationLabels = MUTATION_LABELS as Record<string, string>;
  const mutationOptions = $derived(
    [...new Set(results.flatMap((row) => row.mutationTypes))].sort((a, b) =>
      (mutationLabels[a] || a).localeCompare(mutationLabels[b] || b),
    ),
  );
  const triageRows = $derived(results.map(caseTriageRow));
  const advancedFilters = $derived<BulkAdvancedFilters>({
    source: view.sourceFilter,
    lifecycle: view.lifecycleFilter,
    age: view.ageFilter,
    mail: view.mailFilter,
    registrar: view.registrarFilter,
    caseDisposition: casesSourceState === 'ready' ? view.caseDispositionFilter : '',
  });
  const bulkReviewStateByDomain = $derived(
    new Map(bulkReviewStore.rows.map((row) => [row.domain, row.state])),
  );
  const riskComparison = $derived(buildBulkRiskComparison(results));
  const filtered = $derived.by(() =>
    sortBulkResults(
      results.filter(
        (row) =>
          matchesBulkRouteFilter(
            row,
            {
              filter: view.filter,
              mutationFilter: view.mutationFilter,
              signalFilters: view.signalFilters,
            },
            riskComparison,
          ) &&
          matchesBulkAdvancedFilters(caseTriageRow(row), advancedFilters) &&
          matchesReviewState(row.domain),
      ),
      view.sortKey,
      view.sortDirection,
      (row) => comparableBulkRiskScore(row, riskComparison),
    ),
  );
  const mailExposureReport = $derived(
    buildBulkMailExposureReport(filtered.map(toBulkSessionResult), {
      observedAt: scanStartedAt,
      officialDomains: profileSourceState === 'ready' ? profile?.officialDomains || [] : [],
      profile: profileSourceState === 'ready' ? profile?.mailProtectionProfile || null : null,
      profileSourceState,
      currentProfileContext: currentProfileContext(),
    }),
  );
  const advancedFilterOptions = $derived(bulkAdvancedFilterOptions(triageRows));
  const groupSummary = $derived(buildBulkTriageGroups(filtered.map(caseTriageRow), view.groupBy));
  const peerOutlierMatrix = $derived(buildBulkPeerOutlierMatrix(filtered));
  const shortlistedDomains = $derived(new Set(shortlist.map((item) => item.domain)));
  const reviewedIndicatorRows = $derived(
    casesSourceState === 'ready'
      ? filtered.map((row) => ({
          ...row,
          analystDisposition:
            caseByDomain.get(row.domain)?.disposition ||
            (casesForDomain(cases, row.domain).length ? 'selection_required' : 'unreviewed'),
        }))
      : [],
  );
  const indicatorPreflight = $derived(
    prepareDefensiveIndicatorExport(reviewedIndicatorRows, {
      selectedDomains: [...shortlistedDomains],
      officialDomains: profile?.officialDomains || [],
      allowlistedDomains: profile?.allowlistedDomains || [],
    }),
  );
  const indicatorCount = $derived(
    casesSourceState === 'ready' ? indicatorPreflight.domains.length : 0,
  );
  const indicatorEligibilityAvailable = $derived(
    casesSourceState === 'ready' &&
      shortlistSourceState === 'ready' &&
      profileSourceState === 'ready',
  );
  const indicatorProfileContextUnavailableCount = $derived(
    indicatorPreflight.exclusions.filter((item) => item.reason === 'profile_context_unavailable')
      .length,
  );
  const selectedIndicatorCount = $derived(
    filtered.filter((row) => shortlistedDomains.has(row.domain)).length,
  );
  const selectedRows = $derived(filtered.filter((row) => shortlistedDomains.has(row.domain)));
  const monitorAllBlockedCount = $derived(
    results.filter((row) => row.saved.profileContext.sourceState !== 'ready').length,
  );
  const monitorSelectedBlockedCount = $derived(
    selectedRows.filter((row) => row.saved.profileContext.sourceState !== 'ready').length,
  );
  const comparisonCandidates = $derived(
    selectedRows.length === 2 ? selectedRows : results.length === 2 ? results : [],
  );
  const domainComparison = $derived(
    comparisonCandidates.length === 2
      ? buildBulkDomainComparison(
          toBulkSessionResult(comparisonCandidates[0]!),
          toBulkSessionResult(comparisonCandidates[1]!),
          scanStartedAt,
          {
            leftEvidenceHref: `#bulk-result-${results.indexOf(comparisonCandidates[0]!)}`,
            rightEvidenceHref: `#bulk-result-${results.indexOf(comparisonCandidates[1]!)}`,
          },
        )
      : null,
  );
  const retryCandidates = $derived(selectedRows.length ? selectedRows : filtered);
  const retryPlan = $derived(
    buildBulkRetryPlan(retryCandidates.map(toBulkSessionResult), mode, scanStartedAt),
  );
  const resultIndexByRow = $derived(new Map(results.map((row, index) => [row, index])));
  const cockpitRows = $derived<BulkReviewCockpitRow[]>(
    filtered.map((row) => {
      const caseRecord = caseByDomain.get(row.domain) || null;
      const contextReady = row.saved.profileContext.sourceState === 'ready';
      return {
        resultIndex: resultIndexByRow.get(row) ?? -1,
        domain: row.domain,
        availability: row.availability,
        confidence: row.confidence,
        risk: row.risk,
        riskPresentation: buildBulkRiskPresentation(row, riskComparison),
        opportunity: row.opportunity,
        activity: row.activity,
        registrar: row.registrar,
        reviewState:
          bulkReviewSourceState === 'ready'
            ? bulkReviewStateByDomain.get(row.domain) || 'unreviewed'
            : 'unavailable',
        shortlisted: shortlistSourceState === 'ready' ? shortlistedDomains.has(row.domain) : null,
        trusted: contextReady ? Boolean(row.trusted) : null,
        profileContextReady: contextReady,
        profileContextLimitation: row.saved.profileContext.limitation,
        sourceCoverage: row.sourceCoverage,
        error: row.error,
        caseRecord:
          casesSourceState === 'ready' && caseRecord
            ? { id: caseRecord.id, disposition: caseRecord.disposition }
            : null,
      };
    }),
  );
  const counts = $derived(countBulkRouteFilters(results, riskComparison));
  const pageCount = $derived(Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  const currentPage = $derived(Math.min(view.page, pageCount));
  const visibleResults = $derived(
    filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
  );
  const resultRows = $derived(
    buildBulkResultDisplayRows({
      visibleResults,
      allResults: results,
      shortlistedDomains,
      caseByDomain,
      reviewStateByDomain: bulkReviewStateByDomain,
      mutationLabels,
      riskComparison,
    }),
  );
  // Provenance remains exact-host only. A subdomain candidate may collapse to
  // its registrable collection target, but its CT or mutation context must not
  // be misattributed to that broader domain.
  const provenanceByDomain = $derived(
    new Map(
      (handoff?.candidates || []).map((candidate) => [candidate.domain.toLowerCase(), candidate]),
    ),
  );
  const relationshipSummary = $derived(buildScanRelationships(scan.running ? [] : results));
  const relationshipSourceContextId = $derived(
    `${scan.revision}\u0000${sessionState.currentId || 'transient'}\u0000${scanStartedAt}`,
  );
  const parsedInput = $derived(parseDomainInput(input));
  const scanTargets = $derived(canonicalBulkTargets(parsedInput.entries));
  const equivalentTargetCount = $derived(
    Math.max(0, parsedInput.entries.length - scanTargets.length),
  );
  const scanProgress = $derived(
    buildBulkProgressEstimate(scan.completed, scan.total, scan.elapsedMs),
  );
  const currentQueryLimit = $derived(bulkQueryLimit(mode));
  const scanOutcomes = $derived(buildBulkProgressOutcomes(results, scan.total));
  const activeConcurrency = $derived(bulkConcurrency(mode, pacing));
  $effect(() => {
    if (routePage.url.searchParams.has('investigation') && !scan.running && results.length) {
      try {
        selectInvestigationGuideReviewDomains(results.map((row) => row.domain));
      } catch (cause) {
        status =
          cause instanceof Error
            ? cause.message
            : 'Could not retain the guided review selection. Bulk results remain available.';
      }
    }
  });
  const coverage = $derived.by(() => {
    if (
      profileSourceState !== 'ready' ||
      !handoff ||
      !['typosquat', 'keyword'].includes(handoff.source)
    )
      return null;
    const generated = handoff.generatedCandidates || handoff.candidates;
    const trusted = new Set(
      generated
        .filter((candidate) => isDomainAllowlisted(candidate.domain, profile))
        .map((candidate) => candidate.domain),
    );
    return buildCoverageReport(
      results.map((row) => ({
        ...row.saved,
        domain: row.domain,
        availability: row.availability,
        mutationTypes: row.mutationTypes,
      })),
      generated,
      trusted,
      mutationLabels,
    );
  });

  function currentProfileContext(): BulkProfileContextProvenance {
    return bulkProfileContextProvenance(profileSourceState, profile);
  }

  function settledProfileSnapshot(): BulkScanProfileSnapshot {
    const sourceState = profileSourceState === 'ready' ? 'ready' : 'unavailable';
    const profileSnapshot = sourceState === 'ready' && profile ? normalizeProfile(profile) : null;
    return Object.freeze({
      mode,
      sourceState,
      profile: profileSnapshot,
      provenance: bulkProfileContextProvenance(sourceState, profileSnapshot),
    });
  }

  function restoreWorkflowResults(
    restored: ReturnType<typeof readBulkWorkflowState<ScanResult>>,
  ): void {
    if (!restored) return;
    const candidates = restored.results
      .slice(0, 2000)
      .filter((row): row is ScanResult => Boolean(row?.saved));
    const rowContexts = candidates.map((row) => ({
      profileContext: normalizeBulkProfileContext(
        row.saved.profileContext,
        BULK_PROFILE_CONTEXT_MISMATCH_LIMITATION,
      ),
    }));
    const declared = restored.profileContext
      ? normalizeBulkProfileContext(
          restored.profileContext,
          BULK_PROFILE_CONTEXT_MISMATCH_LIMITATION,
        )
      : null;
    const rootBound =
      Boolean(declared) &&
      rowContexts.length === candidates.length &&
      bulkProfileContextsMatch(declared!, summarizeBulkProfileContexts(rowContexts));
    const current = currentProfileContext();
    let quarantined = 0;
    const restoredResults = candidates.map((row) => {
      const retained = normalizeBulkProfileContext(
        row.saved.profileContext,
        BULK_PROFILE_CONTEXT_MISMATCH_LIMITATION,
      );
      if (
        !rootBound ||
        current.sourceState !== 'ready' ||
        retained.sourceState !== 'ready' ||
        !bulkProfileContextsMatch(retained, current)
      ) {
        quarantined += 1;
        return quarantineBulkProfileDerivedEvidence(row);
      }
      return reconcileBulkResultProfileContext(row, current);
    });
    scanController.restore(restoredResults, restored.total, {
      completed: restored.completed,
      cancelled: restored.cancelled === true,
    });
    if (quarantined) {
      status =
        `${restored.status} Withheld profile-derived trust, matches, and Risk for ${quarantined} restored row${quarantined === 1 ? '' : 's'} until rescanned under the current settled Brand Profile context.`.trim();
    }
  }

  async function ensureBulkReviewContext() {
    if (bulkReviewSourceState === 'ready' || bulkReviewSourceState === 'loading')
      return bulkReviewLoad ?? Promise.resolve();
    bulkReviewSourceState = 'loading';
    bulkReviewLoad = loadDeferredModule(() => import('$lib/bulk-review'), {
      signal: moduleController.signal,
    })
      .then(async (module) => {
        bulkReviewApi = module;
        bulkReviewStore = await module.loadBulkReviewStore();
        bulkReviewSourceState = 'ready';
      })
      .catch(() => {
        bulkReviewSourceState = 'unavailable';
        view.reviewStateFilter = '';
      })
      .finally(() => {
        bulkReviewLoad = null;
      });
    return bulkReviewLoad;
  }

  async function ensureRelationshipContext() {
    if (relationshipsSourceState === 'ready' || relationshipsSourceState === 'loading')
      return relationshipLoad ?? Promise.resolve();
    relationshipsSourceState = 'loading';
    relationshipLoad = loadDeferredModule(() => import('$lib/relationship-observations'), {
      signal: moduleController.signal,
    })
      .then(async (module) => {
        relationshipApi = module;
        const observations = await module.loadRelationshipObservations();
        retainedRelationshipIds = new Set(observations.map((item) => item.id));
        relationshipsSourceState = 'ready';
      })
      .catch(() => {
        relationshipsSourceState = 'unavailable';
      })
      .finally(() => {
        relationshipLoad = null;
      });
    return relationshipLoad;
  }

  async function ensurePrimaryResultContext() {
    if (
      (shortlistSourceState === 'ready' || shortlistSourceState === 'unavailable') &&
      (casesSourceState === 'ready' || casesSourceState === 'unavailable')
    )
      return;
    if (primaryResultContextLoad) return primaryResultContextLoad;
    shortlistSourceState = 'loading';
    casesSourceState = 'loading';
    primaryResultContextLoad = loadDeferredModule(
      () =>
        Promise.allSettled([
          import('$lib/shortlist').then(async (module) => {
            shortlistApi = module;
            shortlist = await module.loadShortlist();
            shortlistSourceState = 'ready';
          }),
          import('$lib/cases').then(async (module) => {
            casesApi = module;
            cases = await module.loadCases();
            caseOptions = module.CASE_DISPOSITIONS;
            casesSourceState = 'ready';
          }),
        ]),
      { signal: moduleController.signal },
    )
      .then((settled) => {
        if (settled[0]?.status === 'rejected') shortlistSourceState = 'unavailable';
        if (settled[1]?.status === 'rejected') {
          casesSourceState = 'unavailable';
          view.caseDispositionFilter = '';
          caseOptions = [];
        }
        const unavailable = [];
        if (shortlistSourceState === 'unavailable') unavailable.push('shortlist');
        if (casesSourceState === 'unavailable') unavailable.push('case');
        if (unavailable.length)
          localContextStatus = `Some saved result context could not be loaded (${unavailable.join(', ')}). Collected results remain available; reload to retry the missing context.`;
      })
      .catch(() => {
        shortlistSourceState = 'unavailable';
        casesSourceState = 'unavailable';
        view.caseDispositionFilter = '';
        caseOptions = [];
        localContextStatus =
          'Saved result modules are unavailable. Collected results remain available; reload to recover the missing context.';
      })
      .finally(() => {
        primaryResultContextLoad = null;
      });
    return primaryResultContextLoad;
  }

  function toggleWorkspaceTools() {
    preloadWorkspaceTool(workspaceTool);
    workspaceToolsOpen = !workspaceToolsOpen;
    if (workspaceToolsOpen)
      void (workspaceTool === 'sessions'
        ? sessionWorkspace.ensureLoaded()
        : workspaceTool === 'review'
          ? ensureBulkReviewContext()
          : ensurePrimaryResultContext());
  }

  function selectWorkspaceTool(next: WorkspaceTool) {
    preloadWorkspaceTool(next);
    workspaceTool = next;
    void (next === 'sessions'
      ? sessionWorkspace.ensureLoaded()
      : next === 'review'
        ? ensureBulkReviewContext()
        : ensurePrimaryResultContext());
  }

  function selectResultView(next: MobileResultView) {
    preloadResultView(next);
    mobileResultView = next;
    if (next === 'review') void ensureBulkReviewContext();
  }
  function preloadWorkspaceTool(next: WorkspaceTool) {
    if (next === 'sessions') preloadModule(() => import('$lib/components/BulkSessions.svelte'));
    else if (next === 'review')
      preloadModule(() => import('$lib/components/BulkReviewWorkspace.svelte'));
    else preloadModule(() => import('$lib/components/ManagedIndicatorWorkspace.svelte'));
  }
  function preloadResultView(next: MobileResultView) {
    if (next === 'review') preloadModule(() => import('$lib/components/BulkReviewCockpit.svelte'));
    else if (next === 'list')
      preloadModule(() => import('$lib/components/BulkResultsTable.svelte'));
    else {
      const generation = ++analysisPreloadGeneration;
      analysisPreloadReady = false;
      const loads: Array<Promise<unknown>> = [
        import('$lib/components/BulkMailExposureReview.svelte'),
        import('$lib/components/BulkPeerOutliers.svelte'),
      ];
      if (domainComparison) loads.push(import('$lib/components/BulkDomainComparison.svelte'));
      if (view.groupBy) loads.push(import('$lib/components/BulkGroupSummary.svelte'));
      if (relationshipSummary.groups.length || relationshipSummary.limitations.length)
        loads.push(import('$lib/components/BulkRelationships.svelte'));
      if (coverage) loads.push(import('$lib/components/BulkCoverage.svelte'));
      const preload = Promise.all(loads);
      void preload.then(
        () => {
          if (!moduleController.signal.aborted && generation === analysisPreloadGeneration)
            analysisPreloadReady = true;
        },
        () => undefined,
      );
      preloadModule(() => preload);
    }
  }
  $effect(() => {
    if (results.length) preloadResultView(mobileResultView);
  });

  async function initializeLocalContext(
    handoffNavigation: boolean,
    investigationTarget: string,
    restored: ReturnType<typeof readBulkWorkflowState<ScanResult>>,
  ) {
    const handoffToken = routePage.url.searchParams.get('handoff') || '';
    const handoffSource = routePage.url.searchParams.get('source') || '';
    handoff =
      handoffNavigation && handoffToken
        ? consumeCandidateHandoff(handoffToken, handoffSource)
        : null;
    if (handoffNavigation && handoff) input = handoff.candidates.map((c) => c.domain).join('\n');
    else if (investigationTarget && !restored) {
      input = investigationTarget;
      scanController.restore([], 0);
      status =
        'Loaded the guided-investigation target. Add only relevant comparison domains before scanning.';
    }
    const loadResults = await Promise.allSettled([activeProfile()]);
    const [profileResult] = loadResults;
    if (profileResult.status === 'fulfilled') {
      profile = profileResult.value;
      profileSourceState = 'ready';
    } else {
      profile = null;
      profileSourceState = 'unavailable';
    }
    const unavailable = unavailableLocalContextLabels(loadResults, ['profile']);
    if (unavailable.length)
      localContextStatus = `Some saved context could not be loaded (${unavailable.join(', ')}). Successfully loaded collections remain available; reload to retry the missing context.`;
    restoreWorkflowResults(restored);
    if (results.length) void ensurePrimaryResultContext();
  }

  function restoreBulkSessionsTarget() {
    if (routePage.url.hash !== '#bulk-sessions-title') return;
    const target = document.getElementById('bulk-sessions-title');
    target?.scrollIntoView({ block: 'start' });
    target?.focus({ preventScroll: true });
  }

  onMount(() => {
    const handoffNavigation =
      routePage.url.searchParams.has('source') && routePage.url.searchParams.has('handoff');
    const investigationTarget =
      parseDomainInput(routePage.url.searchParams.get('investigation') || '').entries[0] || '';
    const activeGuide = investigationTarget ? loadInvestigationGuide() : null;
    const guideContext =
      investigationTarget && activeGuide?.domain === investigationTarget
        ? `${activeGuide.recipeId}\u0000${activeGuide.domain}\u0000${activeGuide.createdAt}`
        : investigationTarget
          ? `target\u0000${investigationTarget}`
          : '';
    const candidateState = handoffNavigation ? null : readBulkWorkflowState<ScanResult>();
    const restored =
      candidateState && (!investigationTarget || candidateState.guideContext === guideContext)
        ? candidateState
        : null;
    if (restored) {
      input = restored.input;
      mode = restored.mode;
      pacing = normalizeBulkPacing(restored.pacing);
      scanController.restore([], restored.total);
      view = restoreBulkView(restored.view, restored.page);
      status = restored.status;
      indicatorFormat = restored.indicatorFormat;
      indicatorWildcards = restored.indicatorWildcards === true;
      watchlistName = restored.watchlistName;
    }
    void initializeLocalContext(handoffNavigation, investigationTarget, restored).finally(
      async () => {
        if (routePage.url.hash !== '#bulk-sessions-title') return;
        workspaceToolsOpen = true;
        workspaceTool = 'sessions';
        await sessionWorkspace.ensureLoaded();
        await tick();
        restoreBulkSessionsTarget();
      },
    );
    return () => {
      moduleController.abort();
      sessionWorkspace.dispose();
      const wasRunning = scan.running;
      scanController.dispose();
      const retainedResults = scanController.results;
      const retainedProfileContext = retainedResults.length
        ? summarizeBulkProfileContexts(
            retainedResults.map((row) => ({ profileContext: row.saved.profileContext })),
          )
        : currentProfileContext();
      writeBulkWorkflowState({
        guideContext,
        input,
        mode,
        pacing,
        completed: scan.completed,
        total: scan.total,
        results: retainedResults,
        profileContext: retainedProfileContext,
        view: bulkNavigationView(view),
        page: view.page,
        status: wasRunning
          ? `Stopped after ${scan.completed} of ${scan.total} lookups when you left Bulk. Completed results were retained.`
          : status,
        cancelled: scan.cancelled,
        indicatorFormat,
        indicatorWildcards,
        watchlistName,
      });
    };
  });
  const caseActions = new BulkCaseActions({
    context: async () => {
      await ensurePrimaryResultContext();
      return casesSourceState === 'ready' && casesApi
        ? { api: casesApi, selected: new Map(caseByDomain) }
        : null;
    },
    publish: (records) => {
      cases = records;
      casesSourceState = 'ready';
    },
    changed: (state) => {
      caseStatus = state.status;
      caseMutationBusy = state.busy;
    },
    confirm: (message) => confirm(message),
  });
  const monitorActions = new BulkMonitorActions(saveWatchlist);
  const trackCase = (row: ScanResult) => caseActions.open(row);
  const setRowDisposition = (row: ScanResult, value: string) =>
    caseActions.setDisposition(row, value);

  function parseDomains() {
    return [...scanTargets];
  }
  function provenance(domain: string): Candidate | undefined {
    return provenanceByDomain.get(domain.toLowerCase());
  }
  function matchesReviewState(domain: string) {
    if (bulkReviewSourceState !== 'ready') return true;
    const state = bulkReviewStateByDomain.get(domain) || 'unreviewed';
    return !view.reviewStateFilter || state === view.reviewStateFilter;
  }
  function setFilter(next: BulkPrimaryFilter) {
    view.filter = next;
    view.page = 1;
  }
  function toggleSignal(signal: string) {
    const next = new Set(view.signalFilters);
    next.has(signal) ? next.delete(signal) : next.add(signal);
    view.signalFilters = next;
    view.page = 1;
  }
  function clearFilters() {
    view = clearBulkViewFilters(view);
  }
  function currentBulkReviewView(): BulkReviewPresetView {
    return bulkReviewView(view);
  }
  async function saveCurrentBulkReviewView(
    name: string,
    view: BulkReviewPresetView,
  ): Promise<LocalMutationOutcome> {
    await ensureBulkReviewContext();
    if (bulkReviewSourceState !== 'ready' || !bulkReviewApi) {
      bulkReviewStatus = 'Saved review state is unavailable. Reload before changing saved views.';
      return 'rejected';
    }
    try {
      bulkReviewStore = await bulkReviewApi.saveBulkReviewPreset({ name, view });
      bulkReviewStatus = `Saved the “${name.trim()}” filters for use with loaded Bulk results.`;
      return 'committed';
    } catch (cause) {
      bulkReviewStatus = cause instanceof Error ? cause.message : 'Could not save the review view.';
      return failedLocalMutationOutcome(cause);
    }
  }
  function loadBulkReviewView(preset: BulkReviewPreset) {
    view = restoreBulkView(preset.view);
    bulkReviewStatus = `Loaded the ${preset.name} review view for the current Bulk results. No scan was started.`;
  }
  async function removeBulkReviewView(preset: BulkReviewPreset) {
    const submitted = $state.snapshot(preset);
    await ensureBulkReviewContext();
    if (bulkReviewSourceState !== 'ready' || !bulkReviewApi) {
      bulkReviewStatus = 'Saved review state is unavailable. Reload before deleting saved views.';
      return;
    }
    try {
      bulkReviewStore = await bulkReviewApi.deleteBulkReviewPreset(submitted.id, submitted);
      bulkReviewStatus = `Deleted the ${submitted.name} review view.`;
    } catch (cause) {
      bulkReviewStatus =
        cause instanceof Error ? cause.message : 'Could not delete the review view.';
    }
  }
  async function setBulkReviewState(row: ScanResult, state: string) {
    await ensureBulkReviewContext();
    if (bulkReviewSourceState !== 'ready' || !bulkReviewApi) {
      bulkReviewStatus =
        'Saved review state is unavailable. Reload before changing a row review state.';
      return;
    }
    if ((bulkReviewStateByDomain.get(row.domain) || 'unreviewed') === state) return;
    const api = bulkReviewApi;
    try {
      const changed = await api.changeBulkReviewRowState(row.domain, state as BulkReviewState);
      bulkReviewStore = changed.store;
      bulkReviewStatus = `Marked ${row.domain} as ${state}. Case disposition was not changed.`;
      registerAnalystUndo({
        kind: 'bulk_review_state',
        action: `Review state changed to ${state}`,
        affectedRecord: row.domain,
        undo: async () => {
          bulkReviewStore = await api.restoreBulkReviewRow(changed.undo);
          return `Restored ${row.domain} to ${changed.undo.previous?.state ?? 'unreviewed'}.`;
        },
      });
    } catch (cause) {
      bulkReviewStatus =
        cause instanceof Error ? cause.message : 'Could not update the review state.';
    }
  }
  function setSort(key: BulkSortKey) {
    const next = normalizeBulkPresentationSortKey(key);
    if (view.sortKey === next) view.sortDirection = view.sortDirection === 1 ? -1 : 1;
    else {
      view.sortKey = next;
      view.sortDirection = defaultBulkSortDirection(next);
    }
    view.page = 1;
  }
  function setSortKey(key: BulkSortKey) {
    const next = normalizeBulkPresentationSortKey(key);
    if (view.sortKey !== next) {
      view.sortKey = next;
      view.sortDirection = defaultBulkSortDirection(next);
    }
    view.page = 1;
  }
  function setSortDirection(direction: BulkSortDirection) {
    view.sortDirection = direction;
    view.page = 1;
  }
  function loadDomains(domains: string[]) {
    input = domains.join('\n');
    status = `Loaded ${domains.length} related domains into the scan queue.`;
    document
      .querySelector('.queue')
      ?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
  }
  function admissionMatchesCurrent(admission: RelationshipRetentionAdmission) {
    return relationshipAdmissionMatchesCurrent(
      admission,
      relationshipSummary.groups,
      relationshipSourceContextId,
      relationshipSummary.limitations,
    );
  }
  async function retainObservation(
    admission: RelationshipRetentionAdmission,
  ): Promise<LocalMutationOutcome> {
    relationshipRetentionStatus = '';
    if (!admissionMatchesCurrent(admission)) {
      relationshipRetentionStatus =
        'The current scan evidence changed. Open a fresh retention preview before recording the relationship.';
      return 'stale';
    }
    await ensureRelationshipContext();
    if (!admissionMatchesCurrent(admission)) {
      relationshipRetentionStatus =
        'The current scan evidence changed while retention was loading. Open a fresh preview before recording the relationship.';
      return 'stale';
    }
    if (relationshipsSourceState !== 'ready' || !relationshipApi) {
      relationshipRetentionStatus =
        'Retained relationship observations are unavailable. Reload before recording a relationship.';
      return 'rejected';
    }
    try {
      const retainedAt = new Date().toISOString();
      const result = await relationshipApi.retainRelationshipObservation(admission.relationship, {
        observedAt: admission.observedAt,
        retainedAt,
        complete: admission.complete,
        truncated: admission.truncated,
        limitations: admission.limitations,
        sourceVersion: RELATIONSHIP_EVIDENCE_VERSION,
      });
      retainedRelationshipIds = new Set([...retainedRelationshipIds, result.record.id]);
      relationshipRetentionStatus = `${result.added ? 'Retained' : 'Refreshed'} ${result.record.label.toLowerCase()} for ${result.record.domains.length} domain${result.record.domains.length === 1 ? '' : 's'} in this workspace${result.pruned ? `; pruned ${result.pruned} older observation${result.pruned === 1 ? '' : 's'} to stay within storage` : ''}.`;
      return 'committed';
    } catch (cause) {
      relationshipRetentionStatus =
        cause instanceof Error ? cause.message : 'Could not retain that relationship observation.';
      return failedLocalMutationOutcome(cause);
    }
  }
  function isShortlisted(domain: string) {
    return shortlistedDomains.has(domain);
  }
  async function toggleSaved(row: ScanResult) {
    const selected = !isShortlisted(row.domain);
    if (await selectRows([row], selected))
      shortlistStatus = selected
        ? `Added ${row.domain} to the shortlist.`
        : `Removed ${row.domain} from the shortlist.`;
  }
  function shortlistPayload(row: ScanResult) {
    return {
      ...row.saved,
      riskScore: row.risk,
      opportunityScore: row.opportunity,
      savedAt: new Date().toISOString(),
    };
  }
  function shortlistSelectionStatus(result: ShortlistSelectionResult, selected: boolean): string {
    if (!selected)
      return `Removed ${result.removed} domain${result.removed === 1 ? '' : 's'} from the shortlist.`;
    const changed = result.added + result.updated;
    const skipped = result.skipped
      ? `; skipped ${result.skipped} invalid or over-limit row${result.skipped === 1 ? '' : 's'}`
      : '';
    return `Selected ${result.added} new and refreshed ${result.updated} existing domain${changed === 1 ? '' : 's'}${skipped}.`;
  }
  async function restoreShortlistSelection(
    undo: ShortlistSelectionResult['undo'],
  ): Promise<string> {
    await ensurePrimaryResultContext();
    if (!shortlistApi) throw new Error('The shortlist is unavailable. Reload before changing it.');
    shortlist = await shortlistApi.restoreShortlistSelection(undo);
    return `Restored the prior shortlist membership for ${undo.length} domain${undo.length === 1 ? '' : 's'}.`;
  }
  async function selectRows(rows: ScanResult[], selected = true) {
    await ensurePrimaryResultContext();
    if (shortlistSourceState !== 'ready' || !shortlistApi) {
      shortlistStatus = 'The shortlist is unavailable. Reload before changing the selection.';
      return false;
    }
    const affected = selected ? rows : rows.filter((row) => isShortlisted(row.domain));
    try {
      const result = await shortlistApi.setShortlistSelection(
        affected.map(shortlistPayload),
        selected,
      );
      shortlist = result.records;
      shortlistStatus = shortlistSelectionStatus(result, selected);
      if (result.undo.length) {
        registerAnalystUndo({
          kind: 'shortlist_membership',
          action: selected ? 'Updated shortlist selection' : 'Removed shortlist selection',
          affectedRecord: `${result.undo.length} domain${result.undo.length === 1 ? '' : 's'}`,
          undo: () => restoreShortlistSelection(result.undo),
        });
      }
      return result.skipped === 0;
    } catch (cause) {
      shortlistStatus = cause instanceof Error ? cause.message : 'Could not update the selection.';
      return false;
    }
  }
  async function selectDomains(domains: string[]) {
    const wanted = new Set(domains);
    await selectRows(
      filtered.filter((row) => wanted.has(row.domain)),
      true,
    );
  }
  async function selectFiltered() {
    await selectRows(filtered, true);
  }
  async function clearFilteredSelection() {
    await selectRows(filtered, false);
  }
  async function removeAllShortlisted() {
    await ensurePrimaryResultContext();
    if (shortlistSourceState !== 'ready' || !shortlistApi) {
      shortlistStatus = 'The shortlist is unavailable. Reload before changing it.';
      return;
    }
    if (!shortlist.length || !confirm('Remove every domain from the shortlist?')) return;
    try {
      await shortlistApi.clearShortlist();
      shortlist = [];
      shortlistStatus = 'Shortlist cleared.';
    } catch (cause) {
      shortlistStatus = cause instanceof Error ? cause.message : 'Could not clear the shortlist.';
    }
  }
  async function downloadShortlist() {
    await ensurePrimaryResultContext();
    if (!shortlistApi) {
      shortlistStatus = 'The shortlist is unavailable. Reload before exporting it.';
      return;
    }
    try {
      await shortlistApi.exportShortlist();
    } catch (cause) {
      shortlistStatus = cause instanceof Error ? cause.message : 'Could not export the shortlist.';
    }
  }
  function loadShortlisted() {
    loadDomains(shortlist.map((item) => item.domain));
  }
  async function copyDraft(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      draftStatus = `Copied ${label} to the clipboard.`;
    } catch {
      draftStatus = 'Clipboard access was unavailable. Use the email draft link instead.';
    }
  }
  async function importShortlistFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement,
      file = input.files?.[0];
    if (!file) return;
    await ensurePrimaryResultContext();
    if (shortlistSourceState !== 'ready' || !shortlistApi) {
      shortlistStatus = 'The shortlist is unavailable. Reload before importing.';
      input.value = '';
      return;
    }
    try {
      const maximumBytes = shortlistApi.MAX_SHORTLIST_IMPORT_BYTES;
      if (file.size > maximumBytes) throw new Error('Shortlist imports are limited to 2 MB.');
      const result = await shortlistApi.importShortlist(
        parseBoundedJson(await file.text(), { label: 'Shortlist import', maximumBytes }),
      );
      shortlist = await shortlistApi.loadShortlist();
      const skipped = result.skipped
        ? `; skipped ${result.skipped} invalid, duplicate, or over-limit entr${result.skipped === 1 ? 'y' : 'ies'}`
        : '';
      shortlistStatus = `Imported ${result.added} new and ${result.updated} updated shortlist entries${skipped}.`;
    } catch (cause) {
      shortlistStatus = cause instanceof Error ? cause.message : 'Shortlist import failed';
    } finally {
      input.value = '';
    }
  }
  async function importDomainFile(event: Event) {
    const control = event.currentTarget as HTMLInputElement,
      file = control.files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_DOMAIN_IMPORT_BYTES)
        throw new Error('Domain-list imports are limited to 2 MB.');
      const parsed = parseDomainInput(await file.text());
      if (parsed.tooLarge)
        throw new Error('The domain-list file exceeds the bounded row or cell limit.');
      if (!parsed.entries.length) throw new Error('No domain entries were found in that file.');
      input = parsed.entries.join('\n');
      status = `Loaded ${parsed.entries.length} unique entries from ${file.name}${parsed.usedHeader ? ' using its domain column' : ''}${parsed.duplicates ? `; removed ${parsed.duplicates} duplicate${parsed.duplicates === 1 ? '' : 's'}` : ''}.`;
    } catch (cause) {
      status = cause instanceof Error ? cause.message : 'Could not import the domain list.';
    } finally {
      control.value = '';
    }
  }
  function exportCoverage() {
    if (!coverage) return;
    downloadText(
      buildBulkCoverageCsv(coverage),
      `defensive-registration-profile-listing-${new Date().toISOString().slice(0, 10)}.csv`,
      'text/csv',
    );
  }
  function exportPeerOutliers() {
    const exported = buildBulkPeerOutlierExport(peerOutlierMatrix, new Date().toISOString());
    downloadText(exported.content, exported.filename, 'text/csv');
  }
  function togglePause() {
    scanController.togglePause();
  }
  function cancel() {
    scanController.cancel();
    status = `Cancelled after ${scan.completed} of ${scan.total} lookups.`;
  }
  function normalize(
    domain: string,
    body: CompactLookupHttpResponse,
    snapshot: BulkScanProfileSnapshot,
  ): ScanResult {
    const candidate = provenance(domain) || provenance(body.availability.domain) || null;
    return normalizeBulkScanResult(body, {
      targetDomain: domain,
      mode: snapshot.mode,
      profile: snapshot.profile,
      profileSourceState: snapshot.sourceState,
      candidate,
    });
  }
  function failedResult(
    domain: string,
    message: string,
    snapshot: BulkScanProfileSnapshot,
  ): ScanResult {
    return failedBulkScanResult(message, {
      targetDomain: domain,
      mode: snapshot.mode,
      profile: snapshot.profile,
      profileSourceState: snapshot.sourceState,
      candidate: provenance(domain) ?? null,
    });
  }
  function loadSavedBulkSession(session: BulkSession) {
    if (profileSourceState === 'loading') {
      sessionWorkspace.setStatus(
        'Wait for saved Brand Profile context to finish loading before restoring a saved session.',
      );
      return;
    }
    if (!sessionWorkspace.select(session)) return;
    mode = session.mode;
    input = session.domains.join('\n');
    const current = currentProfileContext();
    let quarantined = 0;
    const restoredResults = session.results.map((row) => {
      const restored = fromBulkSessionResult(
        row,
        current.sourceState === 'ready' ? profile?.officialDomains || [] : [],
      );
      const reconciled = reconcileBulkResultProfileContext(restored, current);
      if (reconciled.saved.profileContext.sourceState !== 'ready') quarantined += 1;
      return reconciled;
    });
    scanController.restore(restoredResults, session.domains.length, {
      cancelled: session.state === 'cancelled',
    });
    view.page = 1;
    status = `Loaded ${session.name}: ${results.length} of ${session.domains.length} rows settled. Contact records were not retained.${quarantined ? ` Withheld profile-derived trust, matches, and Risk for ${quarantined} row${quarantined === 1 ? '' : 's'} whose saved provenance does not match the current settled profile context.` : ''}`;
    void ensurePrimaryResultContext();
    requestAnimationFrame(() =>
      document.querySelector('#results')?.scrollIntoView({ behavior: 'auto' }),
    );
  }
  async function resumeSavedBulkSession(session: BulkSession) {
    if (scan.running || sessionState.busy) {
      sessionWorkspace.setStatus(
        'Cancel or wait for the active operation before resuming a saved session.',
      );
      return;
    }
    if (profileSourceState === 'loading') {
      sessionWorkspace.setStatus(
        'Wait for saved Brand Profile context to finish loading before resuming a saved session.',
      );
      return;
    }
    loadSavedBulkSession(session);
    const settled = new Set(session.results.map((row) => row.domain));
    const pending = session.domains.filter((domain) => !settled.has(domain));
    if (!pending.length) {
      sessionWorkspace.setStatus(
        'Every queued domain already has a settled result. Use Retry failed to repeat error rows.',
      );
      return;
    }
    if ((await run(pending, false)) !== null) await sessionWorkspace.save();
  }
  function resultAt(index: number) {
    return index >= 0 && index < results.length ? results[index] : null;
  }
  function toggleSavedAt(index: number) {
    const row = resultAt(index);
    if (row) toggleSaved(row);
  }
  async function trackCaseAt(index: number) {
    if (casesSourceState !== 'ready') {
      caseStatus = 'Cases are unavailable. Reload before creating a case.';
      return;
    }
    const row = resultAt(index);
    if (row) await trackCase(row);
  }
  async function setDispositionAt(index: number, value: string) {
    if (casesSourceState !== 'ready') {
      caseStatus = 'Cases are unavailable. Reload before changing a disposition.';
      return;
    }
    const row = resultAt(index);
    if (row) await setRowDisposition(row, value);
  }
  function setReviewStateAt(index: number, value: string) {
    const row = resultAt(index);
    if (row) void setBulkReviewState(row, value);
  }
  function saveCurrentResultAt(index: number) {
    const row = resultAt(index);
    return saveToMonitor(row ? [row] : [], 'row');
  }
  async function inspectAt(index: number) {
    const row = resultAt(index);
    if (!row) return;
    try {
      selectInvestigationGuideFocusDomain(row.domain);
    } catch (cause) {
      status =
        cause instanceof Error
          ? cause.message
          : 'Could not retain the selected guide target. Try again when tab storage is available.';
      return;
    }
    await goto(`/lookup?q=${encodeURIComponent(row.domain)}&depth=deep#query`);
  }
  async function run(
    domains: string[],
    replace = true,
    preservePrior = false,
  ): Promise<string[] | null> {
    if (scan.running) return null;
    if (sessionState.busy) {
      status = 'Wait for the saved-session operation to finish before scanning.';
      return null;
    }
    if (profileSourceState === 'loading') {
      status = 'Wait for saved Brand Profile context to finish loading before scanning.';
      return null;
    }
    const scanProfile = settledProfileSnapshot();
    const limit = bulkQueryLimit(mode);
    if (!domains.length) {
      status = 'Enter at least one domain.';
      return null;
    }
    if (domains.length > limit) {
      status = `${mode === 'fast' ? 'Fast' : 'Deep'} scans are limited to ${limit} domains.`;
      return null;
    }
    if (!sessionWorkspace.beginScan(replace)) return null;
    void ensurePrimaryResultContext();
    view.page = 1;
    status = `Scanning ${domains.length} domain${domains.length === 1 ? '' : 's'}…${scanProfile.sourceState === 'unavailable' ? ' Brand Profile-derived trust, allowlist, match, and contextual Risk evidence will remain inconclusive.' : ''}`;
    const executionPromise = scanController.run({
      domains,
      replace,
      preservePrior,
      profile: scanProfile,
      concurrency: bulkConcurrency(scanProfile.mode, pacing),
      fetchLookup: (domain, signal) => fetchCompactBulkLookup(domain, scanProfile.mode, signal),
      normalizeResult: normalize,
      failedResult,
    });
    const revision = scan.revision;
    try {
      const execution = await executionPromise;
      if (!execution.owned || execution.aborted) return null;
      status = `Completed ${scan.completed} of ${scan.total} lookups.${scanProfile.sourceState === 'unavailable' ? ' Brand Profile context was unavailable; profile-derived fields are retained as inconclusive and every row records that limitation.' : ''}${execution.preservedReasons.length ? ` Retained ${execution.preservedReasons.length} stronger prior result${execution.preservedReasons.length === 1 ? '' : 's'}.` : ''}`;
      return [...execution.preservedReasons];
    } catch {
      if (!moduleController.signal.aborted && revision === scan.revision) {
        status = `The scan stopped unexpectedly after ${scan.completed} of ${scan.total} lookups. Completed results remain available; review them before starting another scan.`;
      }
      return null;
    }
  }
  async function start() {
    if (lookupDisabled) {
      status = lookupDisabled.reason || 'Lookup is disabled by deployment policy.';
      return;
    }
    if (parsedInput.tooLarge) {
      status = 'This domain list is too large. Shorten it and try again.';
      return;
    }
    if (profileSourceState === 'loading') {
      status = 'Wait for saved Brand Profile context to finish loading before scanning.';
      return;
    }
    await run(parseDomains(), true);
  }
  async function runReviewed(domains: string[], label: string) {
    const preserved = await run(domains, false, true);
    retryStatus =
      preserved === null
        ? ''
        : `${label} completed.${preserved.length ? ` ${preserved.length} stronger prior result${preserved.length === 1 ? ' was' : 's were'} retained.` : ''}`;
  }
  async function retryErrors() {
    if (profileSourceState === 'loading') {
      retryStatus = 'Wait for saved Brand Profile context to finish loading before retrying.';
      return;
    }
    const failed = results.filter((row) => row.status === 'error');
    if (!failed.length || scan.running) return;
    const plan = buildBulkRetryPlan(failed.map(toBulkSessionResult), mode, scanStartedAt);
    if (
      !confirm(
        `Retry ${plan.lookupRequests} failed lookup${plan.lookupRequests === 1 ? '' : 's'} using the ${mode} profile? Destinations: ${plan.destinations.join(', ')}.`,
      )
    )
      return;
    retryStatus = `Running ${plan.lookupRequests} reviewed retry${plan.lookupRequests === 1 ? '' : 'ies'}.`;
    await runReviewed(
      failed.map((row) => row.domain),
      'Retry',
    );
  }
  function exportRowsCsv(selected: ScanResult[], scope = 'bulk') {
    downloadLocalFile(
      new Blob([buildBulkResultsCsv(selected)], { type: 'text/csv' }),
      `whoisleuth-${scope}-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }
  function exportCsv() {
    exportRowsCsv(results);
  }
  async function exportSelectedCsv() {
    const selected = [...selectedRows];
    if (!selected.length) return;
    const view = currentBulkReviewView();
    const lookupProfile = mode;
    const observedAt = scanStartedAt;
    try {
      await ensureBulkReviewContext();
      if (bulkReviewSourceState !== 'ready') {
        bulkReviewStatus = 'Review state is unavailable. Reload before exporting selected rows.';
        return;
      }
      const exported = await buildBulkReviewManifest({
        rows: selected.map(toBulkSessionResult),
        reviewStates: bulkReviewStore.rows,
        view,
        lookupProfile,
        observedAt,
        generatedAt: new Date().toISOString(),
      });
      exportRowsCsv(selected, 'selected');
      downloadText(exported.content, exported.filename, 'application/json');
      bulkReviewStatus = `Exported ${selected.length} selected row${selected.length === 1 ? '' : 's'} with an integrity-stamped review manifest.`;
    } catch (cause) {
      bulkReviewStatus =
        cause instanceof Error
          ? cause.message
          : 'The selected CSV and review manifest could not be prepared.';
    }
  }
  async function deepRescanSelected() {
    if (profileSourceState === 'loading') {
      retryStatus = 'Wait for saved Brand Profile context to finish loading before rescanning.';
      return;
    }
    const domains = selectedRows.slice(0, 200).map((row) => row.domain);
    if (!domains.length || scan.running) return;
    const nextMode = 'deep';
    const destinations = buildBulkRetryPlan(
      selectedRows.map(toBulkSessionResult),
      nextMode,
      scanStartedAt,
    ).destinations;
    if (
      !confirm(
        `Deep rescan ${domains.length} explicitly selected domain${domains.length === 1 ? '' : 's'}? Destinations: ${destinations.join(', ')}.`,
      )
    )
      return;
    mode = nextMode;
    retryStatus = `Running a reviewed Deep rescan of ${domains.length} selected domain${domains.length === 1 ? '' : 's'}.`;
    await runReviewed(domains, 'Deep rescan');
  }
  async function executeReviewedRetry() {
    if (profileSourceState === 'loading') {
      retryStatus = 'Wait for saved Brand Profile context to finish loading before retrying.';
      return;
    }
    if (!retryPlan.rows.length || scan.running) return;
    const domains = retryPlan.rows.map((row) => row.domain);
    retryStatus = `Running ${domains.length} reviewed ${retryPlan.mode} retr${domains.length === 1 ? 'y' : 'ies'}.`;
    await runReviewed(domains, 'Reviewed retry');
  }
  async function exportDomainComparison() {
    if (!domainComparison) return;
    const exported = await buildBulkDomainComparisonExport(domainComparison);
    downloadText(exported.content, exported.filename, 'application/json');
    bulkReviewStatus = 'Exported the two-domain evidence comparison with an integrity digest.';
  }
  async function exportMailExposure() {
    if (profileSourceState !== 'ready') {
      bulkReviewStatus =
        'Brand Profile context is not ready, so the mail-exposure comparison remains inconclusive and cannot be exported yet.';
      return;
    }
    const exported = await buildBulkMailExposureExport(mailExposureReport);
    downloadText(exported.content, exported.filename, 'application/json');
    bulkReviewStatus = 'Exported the filtered mail-exposure review with an integrity digest.';
  }
  const createCasesSelected = () => caseActions.createSelected(selectedRows);
  const setSelectedDisposition = (value: string) =>
    caseActions.setSelectedDisposition(selectedRows, value);
  function downloadText(content: string, filename: string, mimeType: string) {
    downloadLocalFile(new Blob([content], { type: mimeType }), filename);
  }
  async function exportDefensiveIndicators() {
    if (profileSourceState !== 'ready') {
      indicatorStatus =
        'Brand Profile context is unavailable, so trusted and allowlisted exclusions are inconclusive. Reload before exporting defensive indicators.';
      return;
    }
    const reviewOptions = {
      selectedDomains: [...shortlistedDomains],
      officialDomains: profile?.officialDomains || [],
      allowlistedDomains: profile?.allowlistedDomains || [],
      includeWildcards: indicatorWildcards,
    };
    try {
      const reviewed = buildDefensiveIndicatorExport(reviewedIndicatorRows, {
        ...reviewOptions,
        format:
          indicatorFormat === 'stix' || indicatorFormat === 'misp' ? 'domains' : indicatorFormat,
      });
      if (!reviewed.domains.length) {
        indicatorStatus =
          'Shortlist an eligible domain and mark its case Suspicious or Confirmed abuse before exporting.';
        return;
      }
      const sources = reviewed.entries.map((entry) => entry.source);
      const exported =
        indicatorFormat === 'stix'
          ? (
              await loadDeferredModule(() => import('$lib/analysis/stix-indicator-export.ts'), {
                signal: moduleController.signal,
              })
            ).buildStixIndicatorExport(sources)
          : indicatorFormat === 'misp'
            ? (
                await loadDeferredModule(() => import('$lib/analysis/misp-indicator-export.ts'), {
                  signal: moduleController.signal,
                })
              ).buildMispIndicatorExport(sources)
            : reviewed;
      downloadText(exported.content, exported.filename, exported.mimeType);
      downloadText(reviewed.manifestContent, reviewed.manifestFilename, 'application/json');
      downloadText(reviewed.rollbackContent, reviewed.rollbackFilename, 'application/json');
      indicatorStatus = `Exported ${reviewed.domains.length} reviewed indicator${reviewed.domains.length === 1 ? '' : 's'}, a provenance manifest, and a rollback set${reviewed.exclusions.length ? `; preflight excluded ${reviewed.exclusions.length} other selection${reviewed.exclusions.length === 1 ? '' : 's'}` : ''}.`;
    } catch {
      indicatorStatus =
        'Indicator export modules are unavailable. Reload the page before exporting.';
    }
  }
  async function saveToMonitor(rows: readonly ScanResult[], scope: BulkMonitorScope) {
    const submittedName = watchlistName;
    const result = await monitorActions.submit({
      rows,
      scope,
      name: submittedName,
      mode,
      profileReady: profileSourceState === 'ready',
    });
    if (!result) return;
    saveStatus = result.status;
    if (result.clearName && watchlistName === submittedName) watchlistName = '';
  }
  const saveResults = () => saveToMonitor(results, 'all');
  const saveSelectedResults = () => saveToMonitor(selectedRows, 'selected');
</script>

<svelte:head><title>Bulk · WHOISleuth</title></svelte:head>
<PageHeading eyebrow="Investigate" title="Bulk" description="Compare multiple domains and retry inconclusive results." />
<BulkScanQueue
  lookupDisabledReason={lookupDisabled?(lookupDisabled.reason||'Lookup is disabled by deployment policy.'):''}
  scanLimitations={scanLimitations.map((item)=>item.id.replaceAll('_',' '))}
  profileName={profile?.name||''}
  profileContextState={profileSourceState}
  handoffCount={handoff?.candidates.length||0}
  handoffSource={handoff?.source.replaceAll('-',' ')||''}
  handoffContextTruncated={handoff?.generatedCandidatesTruncated===true}
  {input}
  setInput={(value)=>input=value}
  {mode}
  setMode={(value)=>mode=value}
  {pacing}
  setPacing={(value)=>pacing=value}
  pacingOptions={BULK_PACING_OPTIONS}
  concurrency={activeConcurrency}
  progress={scanProgress}
  outcomes={scanOutcomes}
  running={scan.running}
  paused={scan.paused}
  entryCount={scanTargets.length}
  queryLimit={currentQueryLimit}
  duplicateCount={parsedInput.duplicates}
  equivalentCount={equivalentTargetCount}
  inputTooLarge={parsedInput.tooLarge}
  {importDomainFile}
  {start}
  {togglePause}
  {cancel}
  completed={scan.completed}
  total={scan.total}
  {status}
/>

<p class="local-context-status" role="status">{localContextStatus}</p>

<section class="bulk-workspace-shell" aria-label="Bulk workspace tools">
  <button
    class="mobile-workspace-toggle"
    type="button"
    aria-controls={workspaceToolsOpen ? 'bulk-workspace-content' : undefined}
    aria-expanded={workspaceToolsOpen}
    onpointerenter={()=>preloadWorkspaceTool(workspaceTool)}
    onfocus={()=>preloadWorkspaceTool(workspaceTool)}
    onclick={toggleWorkspaceTools}
  >
    <span><strong>Workspace tools</strong><small>Saved sessions, views, and review queues</small></span>
    <span aria-hidden="true">{workspaceToolsOpen ? '−' : '+'}</span>
  </button>
  {#if workspaceToolsOpen}
    <div id="bulk-workspace-content" class="bulk-workspace-content">
      <div class="workspace-tool-switcher" role="group" aria-label="Bulk workspace tool">
        <button type="button" aria-pressed={workspaceTool==='sessions'} onpointerenter={()=>preloadWorkspaceTool('sessions')} onfocus={()=>preloadWorkspaceTool('sessions')} onclick={()=>selectWorkspaceTool('sessions')}>Saved sessions</button>
        <button type="button" aria-pressed={workspaceTool==='review'} onpointerenter={()=>preloadWorkspaceTool('review')} onfocus={()=>preloadWorkspaceTool('review')} onclick={()=>selectWorkspaceTool('review')}>Saved review views</button>
        <button type="button" aria-pressed={workspaceTool==='indicators'} onpointerenter={()=>preloadWorkspaceTool('indicators')} onfocus={()=>preloadWorkspaceTool('indicators')} onclick={()=>selectWorkspaceTool('indicators')}>Indicator revisions</button>
      </div>
      {#if workspaceTool==='sessions'}
        <DeferredSurface
          load={()=>import('$lib/components/BulkSessions.svelte')}
          props={{
            sessions: sessionState.sessions, currentSessionId: sessionState.currentId, saveName: sessionState.name,
            setSaveName: (value: string) => sessionWorkspace.setName(value), saveCurrent: () => sessionWorkspace.save(),
            loadSession: loadSavedBulkSession, resumeSession: resumeSavedBulkSession,
            deleteSession: (session: BulkSession) => sessionWorkspace.remove(session), exportSessions: () => sessionWorkspace.export(),
            status: sessionState.status,
            canSave: !scan.running && !sessionState.busy && !sessionState.retention && !sessionState.refreshRequired && results.length > 0,
            profileContextLoading: profileSourceState === 'loading', running: scan.running || sessionState.busy,
            sourceState: sessionState.sourceState, retention: sessionState.retention,
            confirmRetention: () => sessionWorkspace.confirmRetention(), cancelRetention: () => sessionWorkspace.cancelRetention(),
            refreshRequired: sessionState.refreshRequired, refreshSessions: () => sessionWorkspace.refresh(),
          }}
          onready={restoreBulkSessionsTarget}
          loadingLabel="Loading saved Bulk sessions from this browser."
          unavailableLabel="Saved Bulk sessions could not be loaded."
        />
      {:else if workspaceTool==='review'}
        <DeferredSurface
          load={()=>import('$lib/components/BulkReviewWorkspace.svelte')}
          props={{store:bulkReviewStore,currentView:currentBulkReviewView(),reviewFilter:view.reviewStateFilter,setReviewFilter:(value:BulkReviewFilter)=>{view.reviewStateFilter=value;view.page=1;},saveView:saveCurrentBulkReviewView,loadView:loadBulkReviewView,deleteView:removeBulkReviewView,sourceState:bulkReviewSourceState}}
          loadingLabel="Loading saved Bulk review views from this browser."
          unavailableLabel="Saved Bulk review views could not be loaded."
        />
      {:else}
        <DeferredSurface
          load={()=>import('$lib/components/ManagedIndicatorWorkspace.svelte')}
          props={{rows:reviewedIndicatorRows,selectedDomains:[...shortlistedDomains],officialDomains:profile?.officialDomains??[],allowlistedDomains:profile?.allowlistedDomains??[],contextReady:indicatorEligibilityAvailable}}
          loadingLabel="Loading indicator revision tools."
          unavailableLabel="Indicator revision tools could not be loaded. Your retained files have not changed."
        />
      {/if}
    </div>
  {/if}
</section>

<p class="review-status" role="status" aria-label="Bulk review action status" aria-atomic="true">{bulkReviewStatus}</p>

{#if results.length}
  <section id="results" class="triage card" tabindex="-1">
    <div class="results-heading"><h2>Results</h2><p>{filtered.length} of {results.length} rows · {selectedRows.length} selected</p></div>
    <div class="mobile-result-switcher workspace-view-nav" role="group" aria-label="Bulk result view">
      <button type="button" aria-controls="bulk-review-panel" aria-pressed={mobileResultView==='review'} onpointerenter={()=>preloadResultView('review')} onfocus={()=>preloadResultView('review')} onclick={()=>selectResultView('review')}>Review</button>
      <button type="button" aria-controls="bulk-list-panel" aria-pressed={mobileResultView==='list'} onpointerenter={()=>preloadResultView('list')} onfocus={()=>preloadResultView('list')} onclick={()=>selectResultView('list')}>List</button>
      <button type="button" aria-controls="bulk-analysis-panel" aria-pressed={mobileResultView==='analysis'} onpointerenter={()=>preloadResultView('analysis')} onfocus={()=>preloadResultView('analysis')} onclick={()=>selectResultView('analysis')}>Analysis</button>
    </div>
    <BulkMobileDisclosure title="Filters and result actions" description="Filter, sort, export, retain, or rescan the current result set." onpreload={()=>preloadModule(()=>import('$lib/components/BulkTriageControls.svelte'))}>
      <DeferredSurface
        load={()=>import('$lib/components/BulkTriageControls.svelte')}
        props={{counts,filter: view.filter,setFilter,running: scan.running,retryErrors,exportCsv,indicatorFormat,setIndicatorFormat:(value:'domains'|'hosts'|'dnsmasq'|'rpz'|'stix'|'misp')=>indicatorFormat=value,exportIndicators:exportDefensiveIndicators,indicatorCount,indicatorEligibilityAvailable,indicatorProfileContextUnavailableCount,indicatorWildcards,setIndicatorWildcards:(value:boolean)=>indicatorWildcards=value,selectedIndicatorCount,mutationFilter: view.mutationFilter,setMutationFilter:(value:string)=>{view.mutationFilter=value;view.page=1;},mutationOptions:mutationOptions.map((value)=>({value,label:mutationLabels[value]||value.replaceAll('_',' ')})),signalFilters: view.signalFilters,toggleSignal,sourceFilter: view.sourceFilter,reviewFilter:view.reviewStateFilter,setSourceFilter:(value:BulkSourceFilter)=>{view.sourceFilter=value;view.page=1;},lifecycleFilter: view.lifecycleFilter,setLifecycleFilter:(value:BulkLifecycleFilter)=>{view.lifecycleFilter=value;view.page=1;},ageFilter: view.ageFilter,setAgeFilter:(value:BulkAgeFilter)=>{view.ageFilter=value;view.page=1;},mailFilter: view.mailFilter,setMailFilter:(value:BulkMailFilter)=>{view.mailFilter=value;view.page=1;},registrarFilter: view.registrarFilter,setRegistrarFilter:(value:string)=>{view.registrarFilter=value;view.page=1;},caseDispositionFilter: view.caseDispositionFilter,setCaseDispositionFilter:(value:string)=>{view.caseDispositionFilter=value;view.page=1;},groupBy: view.groupBy,setGroupBy:(value:BulkGroupBy)=>view.groupBy=value,advancedFilterOptions,clearFilters,sortKey: view.sortKey,sortDirection: view.sortDirection,setSortKey,setSortDirection,indicatorStatus,riskComparisonSummary:riskComparison.summary,matchedCount:filtered.length,resultCount:results.length,visibleCount:visibleResults.length,currentPage,pageCount,watchlistName,setWatchlistName:(value:string)=>watchlistName=value,saveResults,saveSelectedResults,saveStatus,selectedCount:selectedRows.length,monitorAllBlockedCount,monitorSelectedBlockedCount,selectFiltered,clearFilteredSelection,exportSelectedCsv,deepRescanSelected,createCasesSelected,setSelectedDisposition,caseMutationBusy,caseOptions,profileContextState:profileSourceState,shortlistAvailable:shortlistSourceState==='ready',caseAvailable:casesSourceState==='ready',reviewAvailable:bulkReviewSourceState==='ready'}}
        loadingLabel="Loading filters and result actions."
        unavailableLabel="Filters and result actions could not be loaded. The primary result list remains available."
      />
    </BulkMobileDisclosure>

    <div id="bulk-review-panel" class:mobile-view-active={mobileResultView==='review'} class="mobile-result-panel review-result-panel">
      {#if mobileResultView==='review'}
        <DeferredSurface
          load={()=>import('$lib/components/BulkReviewCockpit.svelte')}
          props={{rows:cockpitRows,caseRecords:cases,selectIncident:selectIncidentCase,retryPlan,retryStatus,setReviewState:setReviewStateAt,toggleSaved:toggleSavedAt,trackCase:trackCaseAt,caseOptions,setDisposition:setDispositionAt,watchlistName,setWatchlistName:(value:string)=>watchlistName=value,saveToWatchlist:saveCurrentResultAt,actionStatus:saveStatus||caseStatus,inspectDomain:inspectAt,executeRetry:executeReviewedRetry,profileContextLoading:profileSourceState==='loading',shortlistAvailable:shortlistSourceState==='ready',caseAvailable:casesSourceState==='ready',reviewAvailable:bulkReviewSourceState==='ready'}}
          loadingLabel="Loading result review."
          unavailableLabel="Result review could not be loaded. The primary result list remains available."
        />
      {/if}
    </div>

    <div id="bulk-list-panel" class:mobile-view-active={mobileResultView==='list'} class="mobile-result-panel list-result-panel">
      {#if mobileResultView==='list'}
      <DeferredSurface
        load={()=>import('$lib/components/BulkResultsTable.svelte')}
        props={{rows:resultRows,columns:view.resultColumns,setColumns:(value:BulkResultColumn[])=>view.resultColumns=value,caseRecords:cases,selectIncident:selectIncidentCase,sortKey: view.sortKey,sortDirection: view.sortDirection,setSort,toggleSaved:toggleSavedAt,caseOptions,setDisposition:setDispositionAt,trackCase:trackCaseAt,inspectDomain:inspectAt,copyDraft,currentPage,pageCount,setPage:(value:number)=>view.page=value,draftStatus,caseStatus,setReviewState:setReviewStateAt,shortlistSourceState,caseSourceState:casesSourceState,reviewSourceState:bulkReviewSourceState}}
        loadingLabel="Loading the primary Bulk result list."
        unavailableLabel="The primary Bulk result list could not be loaded. Collected results remain in this tab."
      />
      {/if}
    </div>

    <div
      id="bulk-analysis-panel"
      class:mobile-view-active={mobileResultView==='analysis'}
      class="mobile-result-panel analysis-result-panel"
      data-analysis-preload-ready={analysisPreloadReady ? 'true' : 'false'}
    >
      {#if mobileResultView==='analysis'}
      <BulkMobileDisclosure title="Mail exposure" description="Review observed mail and authentication posture." onpreload={()=>preloadModule(()=>import('$lib/components/BulkMailExposureReview.svelte'))}>
        <DeferredSurface
          load={()=>import('$lib/components/BulkMailExposureReview.svelte')}
          props={{report:mailExposureReport,selectedDomains:shortlistedDomains,selectionAvailable:shortlistSourceState==='ready',selectDomains,exportReport:exportMailExposure,exportDisabled:profileSourceState!=='ready'}}
          loadingLabel="Loading the mail-exposure review."
          unavailableLabel="The mail-exposure review could not be loaded."
        />
      </BulkMobileDisclosure>
      {#if domainComparison}
        <BulkMobileDisclosure title="Domain comparison" description="Compare two selected or settled domains." onpreload={()=>preloadModule(()=>import('$lib/components/BulkDomainComparison.svelte'))}>
          <DeferredSurface load={()=>import('$lib/components/BulkDomainComparison.svelte')} props={{comparison:domainComparison,exportComparison:exportDomainComparison,openSettledRow:()=>selectResultView('list')}} loadingLabel="Loading the domain comparison." unavailableLabel="The domain comparison could not be loaded." />
        </BulkMobileDisclosure>
      {/if}
      {#if view.groupBy}
        <BulkMobileDisclosure title="Group summary" description="Review the grouping selected in the filters." onpreload={()=>preloadModule(()=>import('$lib/components/BulkGroupSummary.svelte'))}>
          <DeferredSurface
            load={()=>import('$lib/components/BulkGroupSummary.svelte')}
            props={{groupBy: view.groupBy,groups:groupSummary.groups,excluded:groupSummary.excluded,truncated:groupSummary.truncated,overlapping:groupSummary.overlapping,selectedDomains:shortlistedDomains,selectionAvailable:shortlistSourceState==='ready',selectDomains}}
            loadingLabel="Loading the selected group summary."
            unavailableLabel="The selected group summary could not be loaded."
          />
        </BulkMobileDisclosure>
      {/if}
      <BulkMobileDisclosure title="Cohort outliers" description="Find uncommon evidence within this result set." onpreload={()=>preloadModule(()=>import('$lib/components/BulkPeerOutliers.svelte'))}>
        <DeferredSurface load={()=>import('$lib/components/BulkPeerOutliers.svelte')} props={{matrix:peerOutlierMatrix,exportMatrix:exportPeerOutliers}} loadingLabel="Loading the cohort-outlier matrix." unavailableLabel="The cohort-outlier matrix could not be loaded." />
      </BulkMobileDisclosure>
      {/if}
    </div>
  </section>

  <div class:mobile-view-active={mobileResultView==='analysis'} class="mobile-result-panel extended-analysis-panel">
    {#if mobileResultView==='analysis'}
    {#if relationshipSummary.groups.length || relationshipSummary.limitations.length}
      <BulkMobileDisclosure title="Relationships" description="Review shared infrastructure observed in this scan." onpreload={()=>preloadModule(()=>import('$lib/components/BulkRelationships.svelte'))} onopen={ensureRelationshipContext}>
        <DeferredSurface
          load={()=>import('$lib/components/BulkRelationships.svelte')}
          props={{groups:relationshipSummary.groups,truncated:relationshipSummary.truncated,limitations:relationshipSummary.limitations,loadDomains,retainObservation,observationId:relationshipObservationId,retainedIds:retainedRelationshipIds,retainStatus:relationshipRetentionStatus,retentionAvailable:relationshipsSourceState==='ready',sourceContextId:relationshipSourceContextId}}
          loadingLabel="Loading relationship analysis."
          unavailableLabel="Relationship analysis could not be loaded."
        />
      </BulkMobileDisclosure>
    {/if}
    {#if coverage}
      <BulkMobileDisclosure title="Profile listing" description="Review which generated candidates are listed in the active profile and which need evidence review." onpreload={()=>preloadModule(()=>import('$lib/components/BulkCoverage.svelte'))}>
        <DeferredSurface load={()=>import('$lib/components/BulkCoverage.svelte')} props={{coverage,exportCoverage,loadDomains}} loadingLabel="Loading profile-listing coverage." unavailableLabel="Profile-listing coverage could not be loaded." />
      </BulkMobileDisclosure>
    {/if}
    {/if}
  </div>
{/if}

<BulkMobileDisclosure title="Shortlist" description="Review and manage the saved shortlist." onpreload={()=>preloadModule(()=>import('$lib/components/BulkShortlist.svelte'))} onopen={ensurePrimaryResultContext}>
  <DeferredSurface load={()=>import('$lib/components/BulkShortlist.svelte')} props={{domains:shortlist.map((item)=>item.domain),status:shortlistStatus,sourceState:shortlistSourceState,loadShortlisted,downloadShortlist,importShortlistFile,removeAllShortlisted}} loadingLabel="Loading the saved shortlist." unavailableLabel="The shortlist workspace could not be loaded." />
</BulkMobileDisclosure>

<style>
  .local-context-status {
    margin: 12px 0 0;
    color: var(--amber);
    font-size: var(--text-sm);
  }
  .local-context-status:empty {
    display: none;
  }
  .review-status {
    margin: 12px 0;
    color: var(--accent);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }
  .review-status:empty {
    display: none;
  }
  .bulk-workspace-shell {
    display: block;
    margin-top: 16px;
  }
  .mobile-workspace-toggle {
    display: flex;
    width: 100%;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--panel-raised);
    color: var(--text);
    text-align: left;
  }
  .mobile-workspace-toggle span:first-child {
    display: grid;
    min-width: 0;
    gap: 3px;
  }
  .mobile-workspace-toggle strong {
    font: 700 var(--text-sm) var(--mono);
  }
  .mobile-workspace-toggle small {
    color: var(--muted);
    font-size: var(--text-xs);
    font-weight: 400;
    line-height: 1.4;
  }
  .mobile-workspace-toggle span:last-child {
    flex: 0 0 auto;
    color: var(--accent);
    font: 700 var(--text-lg) var(--mono);
  }
  .bulk-workspace-content {
    display: block;
    min-width: 0;
  }
  .workspace-tool-switcher {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin: 8px 0;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .workspace-tool-switcher button {
    min-height: 38px;
    padding: 6px 10px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted);
    font: 700 var(--text-xs) var(--mono);
  }
  .workspace-tool-switcher button[aria-pressed='true'] {
    border-color: var(--accent);
    background: rgb(var(--accent-rgb) / 0.08);
    color: var(--accent);
  }
  .results-heading {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    align-items: baseline;
    justify-content: space-between;
  }
  .results-heading h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
  .results-heading p {
    margin: 0;
    color: var(--muted);
    font-size: var(--text-xs);
  }
  .mobile-result-switcher {
    position: sticky;
    z-index: 6;
    top: calc(var(--console-toolbar-height, 0px) + 8px);
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin: 12px 0;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--panel);
  }
  .mobile-result-switcher button {
    justify-content: center;
    padding-inline: 8px;
  }
  .mobile-result-panel {
    display: none;
    min-width: 0;
  }
  .mobile-result-panel.mobile-view-active {
    display: block;
  }
  .extended-analysis-panel {
    margin-top: 10px;
  }
  .triage {
    padding: var(--card-pad);
  }
  .triage {
    margin-top: 16px;
  }
  @media (max-width: 520px) {
    .workspace-tool-switcher {
      display: grid;
      grid-template-columns: 1fr;
    }
  }
</style>
