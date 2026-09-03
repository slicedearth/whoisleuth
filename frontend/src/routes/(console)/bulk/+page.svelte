<script lang="ts">
  import { goto } from '$app/navigation';
  import { page as routePage } from '$app/state';
  import { getContext, onMount, tick } from 'svelte';
  import { parseBoundedJson } from '$lib/bounded-json';
  import BulkScanQueue from '$lib/components/BulkScanQueue.svelte';
  import BulkMobileDisclosure from '$lib/components/BulkMobileDisclosure.svelte';
  import DeferredSurface from '$lib/components/DeferredSurface.svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import { activeProfile, isDomainAllowlisted, normalizeProfile, type ActiveBrandProfileSourceState, type BrandProfile } from '$lib/brand-profiles';
  import { consumeCandidateHandoff, type Candidate, type CandidateHandoff, type CertificateTransparencyProvenance } from '$lib/candidate-handoff';
  import type { ShortlistRecord } from '$lib/shortlist';
  import type { CaseRecord } from '$lib/cases';
  import { saveWatchlist } from '$lib/watchlists';
  import { MUTATION_LABELS } from '$lib/analysis/typosquat-generator.ts';
  import { buildCoverageReport } from '$lib/analysis/coverage.ts';
  import { canonicalBulkTargets, normalizeBulkScanResult } from '$lib/analysis/bulk-scan-normalizer.ts';
  import { parseDomainInput, rowsToCsv } from '$lib/analysis/utils.ts';
  import { buildScanRelationships, relationshipObservation, RELATIONSHIP_EVIDENCE_VERSION } from '$lib/analysis/relationship-evidence.ts';
  import type { RelationshipObservation } from '$lib/analysis/relationship-evidence.ts';
  import { relationshipObservationId } from '$lib/analysis/relationship-observation-model.ts';
  import { BULK_SCORE_CSV_HEADERS, bulkScoreCsvFields, ctCsvFields } from '$lib/analysis/bulk-export.ts';
  import { buildDefensiveIndicatorExport, prepareDefensiveIndicatorExport } from '$lib/analysis/defensive-indicator-export.ts';
  import { analyzeDomainIdn } from '$lib/analysis/idn-confusables.ts';
  import { normalizeHttpSummary } from '$lib/analysis/http-summary.ts';
  import type { CompactLookupHttpResponse } from '$lib/analysis/lookup-response.ts';
  import { fetchCompactBulkLookup } from '$lib/analysis/bulk-lookup-controller.ts';
  import {
    executeBulkScan,
    type BulkScanProfileSnapshot,
  } from '$lib/controllers/bulk-scan-controller.ts';
  import {
    bulkSessionInputDigest,
    bulkProfileContextsMatch,
    createBulkSessionId,
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
  import { defaultBulkSortDirection, normalizeBulkPresentationSortKey, sortBulkResults, type BulkSortDirection, type BulkSortKey } from '$lib/analysis/bulk-sort.ts';
  import {
    buildBulkTriageGroups,
    bulkAdvancedFilterOptions,
    matchesBulkAdvancedFilters,
    type BulkAdvancedFilters,
    type BulkAgeFilter,
    type BulkGroupBy,
    type BulkMailFilter,
    type BulkSourceFilter,
  } from '$lib/analysis/bulk-triage.ts';
  import {
    buildBulkRiskComparison, buildBulkRiskPresentation, buildBulkResultDisplayRows,
    comparableBulkRiskScore, countBulkRouteFilters,
    matchesBulkRouteFilter,
    toBulkRouteTriageRow,
    type BulkPrimaryFilter,
  } from '$lib/analysis/bulk-route-model.ts';
  import { CAPABILITY_CONTEXT, disabledCapabilities, disabledCapability, type CapabilityGetter } from '$lib/capabilities';
  import { readBulkWorkflowState, writeBulkWorkflowState } from '$lib/console-workflow-state.ts';
  import { loadInvestigationGuide, selectInvestigationGuideFocusDomain, selectInvestigationGuideReviewDomains } from '$lib/investigation-guide';
  import { unavailableLocalContextLabels } from '$lib/local-context-load.ts';
  import { preloadBestEffort } from '$lib/idle-preload';
  import { loadDeferredModule } from '$lib/deferred-module';
  import type { BulkSession } from '$lib/bulk-sessions';
  import type { BulkReviewFilter, BulkReviewPreset, BulkReviewPresetView, BulkReviewState, BulkReviewStore } from '$lib/bulk-review';
  import { BULK_REVIEW_SCHEMA, BULK_REVIEW_SCHEMA_VERSION } from '$lib/analysis/bulk-review-model.ts';
  import { buildBulkDomainComparison, buildBulkDomainComparisonExport } from '$lib/analysis/bulk-domain-comparison.ts';
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
  import { registerAnalystUndo } from '$lib/analyst-undo';
  const moduleController = new AbortController();
  const preloadModule = (load: () => Promise<unknown>) => preloadBestEffort(load, moduleController.signal);

  const MAX_DOMAIN_IMPORT_BYTES = 2 * 1024 * 1024;
  const PAGE_SIZE = 100;
  type ShortlistApi = typeof import('$lib/shortlist');
  type CasesApi = typeof import('$lib/cases');
  type ShortlistSelectionResult = Awaited<ReturnType<ShortlistApi['setShortlistSelection']>>;
  type MobileResultView = 'review' | 'list' | 'analysis';
  type WorkspaceTool = 'sessions' | 'review';
  type BulkSessionsApi = typeof import('$lib/bulk-sessions');
  type BulkReviewApi = typeof import('$lib/bulk-review');
  type RelationshipApi = typeof import('$lib/relationship-observations');
  let handoff = $state<CandidateHandoff|null>(null);
  let input = $state(''); let mode = $state<ScanMode>('fast'); let running = $state(false); let paused = $state(false);
  let pacing = $state<BulkPacing>('standard'); let scanElapsedMs = $state(0);
  let completed = $state(0); let total = $state(0); let results = $state<ScanResult[]>([]); let filter = $state<BulkPrimaryFilter>('all');
  let mutationFilter=$state('');let signalFilters=$state<Set<string>>(new Set());let sortKey=$state<BulkSortKey>('risk');let sortDirection=$state<BulkSortDirection>(-1);let page=$state(1);
  let sourceFilter=$state<BulkSourceFilter>('');let lifecycleFilter=$state('');let ageFilter=$state<BulkAgeFilter>('');let mailFilter=$state<BulkMailFilter>('');let registrarFilter=$state('');let caseDispositionFilter=$state('');let groupBy=$state<BulkGroupBy>('');
  let status = $state(''); let controller: AbortController|null = null; let pauseResolvers: Array<()=>void> = [];
  let activeScanSnapshot: (()=>ScanResult[])|null = null;
  let scanGeneration = 0;
  let indicatorFormat=$state<'domains'|'hosts'|'dnsmasq'|'rpz'|'stix'|'misp'>('domains');let indicatorWildcards=$state(false);let indicatorStatus=$state('');
  let watchlistName = $state(''); let saveStatus = $state('');
  let profile = $state<BrandProfile|null>(null);
  let profileSourceState=$state<ActiveBrandProfileSourceState>('loading');
  let shortlist=$state<ShortlistRecord[]>([]);let shortlistStatus=$state('');let draftStatus=$state('');
  let shortlistSourceState=$state<'idle'|'loading'|'ready'|'unavailable'>('idle');
  let cases=$state<CaseRecord[]>([]);let caseStatus=$state('');let caseMutationBusy=$state(false);
  let casesSourceState=$state<'idle'|'loading'|'ready'|'unavailable'>('idle');
  let retainedRelationshipIds=$state<Set<string>>(new Set());let relationshipRetentionStatus=$state('');
  let relationshipsSourceState=$state<'idle'|'loading'|'ready'|'unavailable'>('idle');
  let bulkSessions=$state<BulkSession[]>([]);let bulkSessionName=$state('');let bulkSessionStatus=$state('');let currentBulkSessionId=$state('');let scanStartedAt=$state('');
  let bulkSessionsSourceState=$state<'idle'|'loading'|'ready'|'unavailable'>('idle');
  let bulkReviewStore=$state<BulkReviewStore>({schema:BULK_REVIEW_SCHEMA,version:BULK_REVIEW_SCHEMA_VERSION,presets:[],rows:[]});let reviewStateFilter=$state<BulkReviewFilter>('');let bulkReviewStatus=$state('');
  let bulkReviewSourceState=$state<'idle'|'loading'|'ready'|'unavailable'>('idle');
  let retryStatus=$state('');
  let localContextStatus=$state('');
  let workspaceToolsOpen=$state(false);
  let workspaceTool=$state<WorkspaceTool>('sessions');
  let mobileResultView=$state<MobileResultView>('list');
  let bulkSessionsApi:BulkSessionsApi|null=null;
  let bulkReviewApi:BulkReviewApi|null=null;
  let relationshipApi:RelationshipApi|null=null;
  let bulkSessionLoad:Promise<void>|null=null;
  let bulkReviewLoad:Promise<void>|null=null;
  let relationshipLoad:Promise<void>|null=null;
  let shortlistApi:ShortlistApi|null=null;
  let casesApi:CasesApi|null=null;
  let primaryResultContextLoad:Promise<void>|null=null;
  let caseOptions=$state<CasesApi['CASE_DISPOSITIONS']>([]);
  const capabilityReport=getContext<CapabilityGetter>(CAPABILITY_CONTEXT);
  const lookupDisabled=$derived(disabledCapability(capabilityReport?.()||null,'lookup'));
  const scanLimitations=$derived(disabledCapabilities(capabilityReport?.()||null,mode==='fast'?['rdap','availability']:['rdap','whois','availability','dns_intelligence','website_probe','tls_intelligence']));
  const caseByDomain=$derived(new Map(cases.map(record=>[record.domain,record])));
  const mutationLabels=MUTATION_LABELS as Record<string,string>;
  const mutationOptions=$derived([...new Set(results.flatMap(row=>row.mutationTypes))].sort((a,b)=>(mutationLabels[a]||a).localeCompare(mutationLabels[b]||b)));
  const triageRows=$derived(results.map((row)=>toBulkRouteTriageRow(row,caseByDomain.get(row.domain)||null,casesSourceState==='ready'?'ready':'unavailable')));
  const advancedFilters=$derived<BulkAdvancedFilters>({source:sourceFilter,lifecycle:lifecycleFilter,age:ageFilter,mail:mailFilter,registrar:registrarFilter,caseDisposition:casesSourceState==='ready'?caseDispositionFilter:''});
  const bulkReviewStateByDomain=$derived(new Map(bulkReviewStore.rows.map((row)=>[row.domain,row.state])));
  const riskComparison=$derived(buildBulkRiskComparison(results));
  const filtered = $derived.by(()=>sortBulkResults(results.filter((row)=>matchesBulkRouteFilter(row,{filter,mutationFilter,signalFilters},riskComparison)&&matchesBulkAdvancedFilters(toBulkRouteTriageRow(row,caseByDomain.get(row.domain)||null),advancedFilters)&&matchesReviewState(row.domain)),sortKey,sortDirection,(row)=>comparableBulkRiskScore(row,riskComparison)));
  const mailExposureReport=$derived(buildBulkMailExposureReport(filtered.map(toBulkSessionResult),{
    observedAt:scanStartedAt,
    officialDomains:profileSourceState==='ready'?(profile?.officialDomains||[]):[],
    profile:profileSourceState==='ready'?(profile?.mailProtectionProfile||null):null,
    profileSourceState,
    currentProfileContext:currentProfileContext(),
  }));
  const advancedFilterOptions=$derived(bulkAdvancedFilterOptions(triageRows));
  const groupSummary=$derived(buildBulkTriageGroups(filtered.map((row)=>toBulkRouteTriageRow(row,caseByDomain.get(row.domain)||null,casesSourceState==='ready'?'ready':'unavailable')),groupBy));
  const peerOutlierMatrix=$derived(buildBulkPeerOutlierMatrix(filtered));
  const shortlistedDomains=$derived(new Set(shortlist.map(item=>item.domain)));
  const reviewedIndicatorRows=$derived(casesSourceState==='ready'?filtered.map((row)=>({
    ...row,
    analystDisposition:caseByDomain.get(row.domain)?.disposition||'unreviewed',
  })):[]);
  const indicatorPreflight=$derived(prepareDefensiveIndicatorExport(reviewedIndicatorRows,{
    selectedDomains:[...shortlistedDomains],
    officialDomains:profile?.officialDomains||[],
    allowlistedDomains:profile?.allowlistedDomains||[],
  }));
  const indicatorCount=$derived(casesSourceState==='ready'?indicatorPreflight.domains.length:0);
  const indicatorEligibilityAvailable=$derived(casesSourceState==='ready'&&shortlistSourceState==='ready'&&profileSourceState==='ready');
  const indicatorProfileContextUnavailableCount=$derived(indicatorPreflight.exclusions.filter((item)=>item.reason==='profile_context_unavailable').length);
  const selectedIndicatorCount=$derived(filtered.filter((row)=>shortlistedDomains.has(row.domain)).length);
  const selectedRows=$derived(filtered.filter((row)=>shortlistedDomains.has(row.domain)));
  const monitorAllBlockedCount=$derived(results.filter((row)=>row.saved.profileContext.sourceState!=='ready').length);
  const monitorSelectedBlockedCount=$derived(selectedRows.filter((row)=>row.saved.profileContext.sourceState!=='ready').length);
  const comparisonCandidates=$derived(selectedRows.length===2?selectedRows:results.length===2?results:[]);
  const domainComparison=$derived(comparisonCandidates.length===2?buildBulkDomainComparison(
    toBulkSessionResult(comparisonCandidates[0]!),
    toBulkSessionResult(comparisonCandidates[1]!),
    scanStartedAt,
    {
      leftEvidenceHref:`#bulk-result-${results.indexOf(comparisonCandidates[0]!)}`,
      rightEvidenceHref:`#bulk-result-${results.indexOf(comparisonCandidates[1]!)}`,
    },
  ):null);
  const retryCandidates=$derived(selectedRows.length?selectedRows:filtered);
  const retryPlan=$derived(buildBulkRetryPlan(retryCandidates.map(toBulkSessionResult),mode,scanStartedAt));
  const resultIndexByRow=$derived(new Map(results.map((row,index)=>[row,index])));
  const cockpitRows=$derived<BulkReviewCockpitRow[]>(filtered.map((row)=>{const caseRecord=caseByDomain.get(row.domain)||null;const contextReady=row.saved.profileContext.sourceState==='ready';return{resultIndex:resultIndexByRow.get(row)??-1,domain:row.domain,availability:row.availability,confidence:row.confidence,risk:row.risk,riskPresentation:buildBulkRiskPresentation(row,riskComparison),opportunity:row.opportunity,activity:row.activity,registrar:row.registrar,reviewState:bulkReviewSourceState==='ready'?bulkReviewStateByDomain.get(row.domain)||'unreviewed':'unavailable',shortlisted:shortlistSourceState==='ready'?shortlistedDomains.has(row.domain):null,trusted:contextReady?Boolean(row.trusted):null,profileContextReady:contextReady,profileContextLimitation:row.saved.profileContext.limitation,sourceCoverage:row.sourceCoverage,error:row.error,caseRecord:casesSourceState==='ready'&&caseRecord?{id:caseRecord.id,disposition:caseRecord.disposition}:null};}));
  const counts=$derived(countBulkRouteFilters(results,riskComparison));
  const pageCount=$derived(Math.max(1,Math.ceil(filtered.length/PAGE_SIZE)));
  const currentPage=$derived(Math.min(page,pageCount));
  const visibleResults=$derived(filtered.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE));
  const resultRows=$derived(buildBulkResultDisplayRows({visibleResults,allResults:results,shortlistedDomains,caseByDomain,reviewStateByDomain:bulkReviewStateByDomain,mutationLabels,riskComparison}));
  // Provenance remains exact-host only. A subdomain candidate may collapse to
  // its registrable collection target, but its CT or mutation context must not
  // be misattributed to that broader domain.
  const provenanceByDomain=$derived(new Map((handoff?.candidates||[]).map(candidate=>[candidate.domain.toLowerCase(),candidate])));
  const relationshipSummary=$derived(buildScanRelationships(running?[]:results));
  const relationshipSourceIdentities=$derived([...new Set(results.flatMap((row)=>row.sourceCoverage.map((source)=>source.source)))].sort().slice(0,20));
  const parsedInput=$derived(parseDomainInput(input));
  const scanTargets=$derived(canonicalBulkTargets(parsedInput.entries));
  const equivalentTargetCount=$derived(Math.max(0,parsedInput.entries.length-scanTargets.length));
  const scanProgress=$derived(buildBulkProgressEstimate(completed,total,scanElapsedMs));
  const currentQueryLimit=$derived(bulkQueryLimit(mode));
  const scanOutcomes=$derived(buildBulkProgressOutcomes(results,total));
  const activeConcurrency=$derived(bulkConcurrency(mode,pacing));
  $effect(()=>{if(routePage.url.searchParams.has('investigation')&&!running&&results.length)selectInvestigationGuideReviewDomains(results.map((row)=>row.domain));});
  const coverage=$derived.by(()=>{if(profileSourceState!=='ready'||!handoff||!['typosquat','keyword'].includes(handoff.source))return null;const generated=handoff.generatedCandidates||handoff.candidates;const trusted=new Set(generated.filter(candidate=>isDomainAllowlisted(candidate.domain,profile)).map(candidate=>candidate.domain));return buildCoverageReport(results.map(row=>({...row.saved,domain:row.domain,availability:row.availability,mutationTypes:row.mutationTypes})),generated,trusted,mutationLabels);});

  function currentProfileContext():BulkProfileContextProvenance {
    return bulkProfileContextProvenance(profileSourceState, profile);
  }

  function settledProfileSnapshot():BulkScanProfileSnapshot {
    const sourceState=profileSourceState==='ready'?'ready':'unavailable';
    const profileSnapshot=sourceState==='ready'&&profile?normalizeProfile(profile):null;
    return Object.freeze({
      mode,
      sourceState,
      profile:profileSnapshot,
      provenance:bulkProfileContextProvenance(sourceState,profileSnapshot),
    });
  }

  function restoreWorkflowResults(restored:ReturnType<typeof readBulkWorkflowState<ScanResult>>):void {
    if(!restored)return;
    const candidates=restored.results.slice(0,2000).filter((row):row is ScanResult=>Boolean(row?.saved));
    const rowContexts=candidates.map((row)=>({
      profileContext:normalizeBulkProfileContext(row.saved.profileContext,BULK_PROFILE_CONTEXT_MISMATCH_LIMITATION),
    }));
    const declared=restored.profileContext
      ?normalizeBulkProfileContext(restored.profileContext,BULK_PROFILE_CONTEXT_MISMATCH_LIMITATION)
      :null;
    const rootBound=Boolean(declared)&&rowContexts.length===candidates.length
      &&bulkProfileContextsMatch(declared!,summarizeBulkProfileContexts(rowContexts));
    const current=currentProfileContext();
    let quarantined=0;
    results=candidates.map((row)=>{
      const retained=normalizeBulkProfileContext(row.saved.profileContext,BULK_PROFILE_CONTEXT_MISMATCH_LIMITATION);
      if(!rootBound||current.sourceState!=='ready'||retained.sourceState!=='ready'||!bulkProfileContextsMatch(retained,current)){
        quarantined+=1;
        return quarantineBulkProfileDerivedEvidence(row);
      }
      return reconcileBulkResultProfileContext(row,current);
    });
    completed=Math.min(restored.completed,results.length);
    if(quarantined){
      status=`${restored.status} Withheld profile-derived trust, matches, and Risk for ${quarantined} restored row${quarantined===1?'':'s'} until rescanned under the current settled Brand Profile context.`.trim();
    }
  }

  async function ensureBulkSessionsContext(){
    if(bulkSessionsSourceState==='ready'||bulkSessionsSourceState==='loading')return bulkSessionLoad??Promise.resolve();
    bulkSessionsSourceState='loading';
    bulkSessionLoad=loadDeferredModule(()=>import('$lib/bulk-sessions'),{signal:moduleController.signal})
      .then(async(module)=>{bulkSessionsApi=module;bulkSessions=await module.loadBulkSessions();bulkSessionsSourceState='ready';})
      .catch(()=>{bulkSessions=[];bulkSessionsSourceState='unavailable';})
      .finally(()=>{bulkSessionLoad=null;});
    return bulkSessionLoad;
  }

  async function ensureBulkReviewContext(){
    if(bulkReviewSourceState==='ready'||bulkReviewSourceState==='loading')return bulkReviewLoad??Promise.resolve();
    bulkReviewSourceState='loading';
    bulkReviewLoad=loadDeferredModule(()=>import('$lib/bulk-review'),{signal:moduleController.signal})
      .then(async(module)=>{bulkReviewApi=module;bulkReviewStore=await module.loadBulkReviewStore();bulkReviewSourceState='ready';})
      .catch(()=>{bulkReviewSourceState='unavailable';reviewStateFilter='';})
      .finally(()=>{bulkReviewLoad=null;});
    return bulkReviewLoad;
  }

  async function ensureRelationshipContext(){
    if(relationshipsSourceState==='ready'||relationshipsSourceState==='loading')return relationshipLoad??Promise.resolve();
    relationshipsSourceState='loading';
    relationshipLoad=loadDeferredModule(()=>import('$lib/relationship-observations'),{signal:moduleController.signal})
      .then(async(module)=>{relationshipApi=module;const observations=await module.loadRelationshipObservations();retainedRelationshipIds=new Set(observations.map((item)=>item.id));relationshipsSourceState='ready';})
      .catch(()=>{relationshipsSourceState='unavailable';})
      .finally(()=>{relationshipLoad=null;});
    return relationshipLoad;
  }

  async function ensurePrimaryResultContext(){
    if((shortlistSourceState==='ready'||shortlistSourceState==='unavailable')&&(casesSourceState==='ready'||casesSourceState==='unavailable'))return;
    if(primaryResultContextLoad)return primaryResultContextLoad;
    shortlistSourceState='loading';
    casesSourceState='loading';
    primaryResultContextLoad=loadDeferredModule(()=>Promise.allSettled([
      import('$lib/shortlist').then(async(module)=>{shortlistApi=module;shortlist=await module.loadShortlist();shortlistSourceState='ready';}),
      import('$lib/cases').then(async(module)=>{casesApi=module;cases=await module.loadCases();caseOptions=module.CASE_DISPOSITIONS;casesSourceState='ready';}),
    ]),{signal:moduleController.signal}).then((settled)=>{
      if(settled[0]?.status==='rejected')shortlistSourceState='unavailable';
      if(settled[1]?.status==='rejected'){casesSourceState='unavailable';caseDispositionFilter='';caseOptions=[];}
      const unavailable=[];
      if(shortlistSourceState==='unavailable')unavailable.push('shortlist');
      if(casesSourceState==='unavailable')unavailable.push('case');
      if(unavailable.length)localContextStatus=`Some browser-local result context could not be loaded (${unavailable.join(', ')}). Collected results remain available; reload to retry the missing context.`;
    }).catch(()=>{
      shortlistSourceState='unavailable';casesSourceState='unavailable';caseDispositionFilter='';caseOptions=[];
      localContextStatus='Browser-local result modules are unavailable. Collected results remain available; reload to recover the missing context.';
    }).finally(()=>{primaryResultContextLoad=null;});
    return primaryResultContextLoad;
  }

  function toggleWorkspaceTools(){
    preloadWorkspaceTool(workspaceTool);
    workspaceToolsOpen=!workspaceToolsOpen;
    if(workspaceToolsOpen)void (workspaceTool==='sessions'?ensureBulkSessionsContext():ensureBulkReviewContext());
  }

  function selectWorkspaceTool(next:WorkspaceTool){
    preloadWorkspaceTool(next);
    workspaceTool=next;
    void (next==='sessions'?ensureBulkSessionsContext():ensureBulkReviewContext());
  }

  function selectResultView(next:MobileResultView){
    preloadResultView(next);
    mobileResultView=next;
    if(next==='review')void ensureBulkReviewContext();
  }
  function preloadWorkspaceTool(next:WorkspaceTool){
    if(next==='sessions')preloadModule(()=>import('$lib/components/BulkSessions.svelte'));
    else preloadModule(()=>import('$lib/components/BulkReviewWorkspace.svelte'));
  }
  function preloadResultView(next:MobileResultView){
    if(next==='review')preloadModule(()=>import('$lib/components/BulkReviewCockpit.svelte'));
    else if(next==='list')preloadModule(()=>import('$lib/components/BulkResultsTable.svelte'));
    else{
      const loads:Array<Promise<unknown>>=[import('$lib/components/BulkMailExposureReview.svelte'),import('$lib/components/BulkPeerOutliers.svelte')];
      if(domainComparison)loads.push(import('$lib/components/BulkDomainComparison.svelte'));
      if(groupBy)loads.push(import('$lib/components/BulkGroupSummary.svelte'));
      if(relationshipSummary.groups.length||relationshipSummary.limitations.length)loads.push(import('$lib/components/BulkRelationships.svelte'));
      if(coverage)loads.push(import('$lib/components/BulkCoverage.svelte'));
      preloadModule(()=>Promise.all(loads));
    }
  }
  $effect(()=>{if(results.length)preloadResultView(mobileResultView);});


  async function initializeLocalContext(handoffNavigation:boolean,investigationTarget:string,restored:ReturnType<typeof readBulkWorkflowState<ScanResult>>){
    const handoffToken=routePage.url.searchParams.get('handoff')||'';
    const handoffSource=routePage.url.searchParams.get('source')||'';
    handoff=handoffNavigation&&handoffToken?consumeCandidateHandoff(handoffToken,handoffSource):null;
    if(handoffNavigation&&handoff)input=handoff.candidates.map(c=>c.domain).join('\n');
    else if(investigationTarget&&!restored){input=investigationTarget;results=[];completed=0;total=0;status='Loaded the guided-investigation target. Add only relevant comparison domains before scanning.';}
    const loadResults=await Promise.allSettled([activeProfile()]);
    const [profileResult]=loadResults;
    if(profileResult.status==='fulfilled'){profile=profileResult.value;profileSourceState='ready';}
    else{profile=null;profileSourceState='unavailable';}
    const unavailable=unavailableLocalContextLabels(loadResults,['profile']);
    if(unavailable.length)localContextStatus=`Some browser-local context could not be loaded (${unavailable.join(', ')}). Successfully loaded collections remain available; reload to retry the missing context.`;
    restoreWorkflowResults(restored);
    if(results.length)void ensurePrimaryResultContext();
  }

  function restoreBulkSessionsTarget(){
    if(routePage.url.hash!=='#bulk-sessions-title')return;
    const target=document.getElementById('bulk-sessions-title');
    target?.scrollIntoView({block:'start'});
    target?.focus({preventScroll:true});
  }

  onMount(()=>{
    const handoffNavigation=routePage.url.searchParams.has('source')&&routePage.url.searchParams.has('handoff');
    const investigationTarget=parseDomainInput(routePage.url.searchParams.get('investigation')||'').entries[0]||'';
    const activeGuide=investigationTarget?loadInvestigationGuide():null;
    const guideContext=investigationTarget&&activeGuide?.domain===investigationTarget?`${activeGuide.recipeId}\u0000${activeGuide.domain}\u0000${activeGuide.createdAt}`:investigationTarget?`target\u0000${investigationTarget}`:'';
    const candidateState=handoffNavigation?null:readBulkWorkflowState<ScanResult>();
    const restored=candidateState&&(!investigationTarget||candidateState.guideContext===guideContext)?candidateState:null;
    if(restored){input=restored.input;mode=restored.mode;pacing=normalizeBulkPacing(restored.pacing);completed=0;total=restored.total;results=[];filter=restored.filter;mutationFilter=restored.mutationFilter;signalFilters=new Set(restored.signalFilters);sourceFilter=restored.sourceFilter||'';lifecycleFilter=restored.lifecycleFilter||'';ageFilter=restored.ageFilter||'';mailFilter=restored.mailFilter||'';registrarFilter=restored.registrarFilter||'';caseDispositionFilter=restored.caseDispositionFilter||'';groupBy=restored.groupBy||'';sortKey=normalizeBulkPresentationSortKey(restored.sortKey);sortDirection=restored.sortDirection;page=restored.page;status=restored.status;indicatorFormat=restored.indicatorFormat;indicatorWildcards=restored.indicatorWildcards===true;watchlistName=restored.watchlistName;}
    void initializeLocalContext(handoffNavigation,investigationTarget,restored).finally(async()=>{
      if(routePage.url.hash!=='#bulk-sessions-title')return;
      workspaceToolsOpen=true;
      workspaceTool='sessions';
      await ensureBulkSessionsContext();
      await tick();
      restoreBulkSessionsTarget();
    });
    return()=>{
      moduleController.abort();
      resume();
      controller?.abort();
      const retainedResults=activeScanSnapshot?.()||results;
      scanGeneration+=1;
      const retainedProfileContext=retainedResults.length
        ?summarizeBulkProfileContexts(retainedResults.map((row)=>({profileContext:row.saved.profileContext})))
        :currentProfileContext();
      writeBulkWorkflowState({guideContext,input,mode,pacing,completed,total,results:retainedResults,profileContext:retainedProfileContext,filter,mutationFilter,signalFilters:[...signalFilters],sourceFilter,lifecycleFilter,ageFilter,mailFilter,registrarFilter,caseDispositionFilter,groupBy,sortKey,sortDirection,page,status:running?`Stopped after ${completed} of ${total} lookups when you left Bulk. Completed results were retained.`:status,indicatorFormat,indicatorWildcards,watchlistName});
    };
  });
  function prunedNote(pruned:number){return pruned?` (pruned ${pruned} old evidence snapshot${pruned===1?'':'s'} to stay within storage)`:'';}
  async function reconcileBulkCaseSnapshot(committed:{cases:CaseRecord[]},success:string){
    if(!casesApi){cases=committed.cases;casesSourceState='ready';caseStatus=success;return;}
    try{cases=await casesApi.loadCases();caseStatus=success;}
    catch{cases=committed.cases;casesSourceState='ready';caseStatus=`${success} The change was saved, but Cases could not be reread. The complete committed Case snapshot is shown locally; reload to retry the browser-local read.`;}
  }
  async function trackCase(row:ScanResult){
    await ensurePrimaryResultContext();
    if(casesSourceState!=='ready'||!casesApi){caseStatus='Cases are unavailable. Reload before creating a case.';return;}
    const s=row.saved;
    try{
      const committed=await casesApi.openCase({domain:row.domain,source:'bulk',evidence:{scanDepth:s.scanDepth,availability:s.availability,confidence:row.confidence,riskModelVersion:s.riskModelVersion,riskScore:row.risk,riskFactors:s.riskFactors,opportunityModelVersion:s.opportunityModelVersion,opportunityScore:row.opportunity,registrar:row.registrar&&row.registrar!=='—'?row.registrar:null,createdDate:s.createdDate,expiryDate:s.expiryDate,nameservers:s.nameservers,hasMx:s.hasMx,hasSpf:s.hasSpf,hasDmarc:s.hasDmarc,activityStatus:s.activityStatus,pageTitle:s.pageTitle,...(normalizeHttpSummary(s)||{}),faviconMatch:s.faviconMatch,faviconNearMatch:s.faviconNearMatch,reusesOfficialAssets:s.reusesOfficialAssets,hasPasswordField:s.hasPasswordField,hasExternalFormAction:s.hasExternalFormAction,phishingLanguageMatch:s.phishingLanguageMatch,privacyProtected:s.privacyProtected,idnReferenceMatch:s.idnReferenceMatch,pageBaselineMatch:s.pageBaselineMatch,hasActiveBrandProfile:s.hasActiveBrandProfile,profileContextState:s.profileContext.sourceState==='ready'?'ready':'unavailable',profileContextLimitation:s.profileContext.limitation||null,mutationTypes:s.mutationTypes}});
      await reconcileBulkCaseSnapshot(committed,`${committed.created?`Opened a case for ${committed.record.domain}.`:`${committed.record.domain} already has a case.`}${prunedNote(committed.pruned)}`);
    }catch(cause){caseStatus=cause instanceof Error?cause.message:'Could not open the case.';}
  }
  async function setRowDisposition(row:ScanResult,value:string){
    await ensurePrimaryResultContext();
    if(casesSourceState!=='ready'||!casesApi){caseStatus='Cases are unavailable. Reload before changing a disposition.';return;}
    const record=caseByDomain.get(row.domain);if(!record)return;
    try{const committed=await casesApi.editCase(record.id,{disposition:value});await reconcileBulkCaseSnapshot(committed,`Marked ${row.domain} as ${casesApi.dispositionLabel(value)}.${prunedNote(committed.pruned)}`);}
    catch(cause){caseStatus=cause instanceof Error?cause.message:'Could not update the case.';}
  }
  function parseDomains(){return [...scanTargets];}
  function provenance(domain:string):Candidate|undefined{return provenanceByDomain.get(domain.toLowerCase());}
  function matchesReviewState(domain:string){if(bulkReviewSourceState!=='ready')return true;const state=bulkReviewStateByDomain.get(domain)||'unreviewed';return !reviewStateFilter||state===reviewStateFilter;}
  function setFilter(next:BulkPrimaryFilter){filter=next;page=1;}
  function toggleSignal(signal:string){const next=new Set(signalFilters);next.has(signal)?next.delete(signal):next.add(signal);signalFilters=next;page=1;}
  function clearFilters(){filter='all';mutationFilter='';signalFilters=new Set();sourceFilter='';lifecycleFilter='';ageFilter='';mailFilter='';registrarFilter='';caseDispositionFilter='';reviewStateFilter='';page=1;}
  function currentBulkReviewView():BulkReviewPresetView{return{primaryFilter:filter,mutationFilter,signalFilters:[...signalFilters],sourceFilter,lifecycleFilter,ageFilter,mailFilter,registrarFilter,caseDispositionFilter,reviewStateFilter,groupBy,sortKey,sortDirection};}
  async function saveCurrentBulkReviewView(name:string,view:BulkReviewPresetView){await ensureBulkReviewContext();if(bulkReviewSourceState!=='ready'||!bulkReviewApi){bulkReviewStatus='Saved review state is unavailable. Reload before changing saved views.';return;}try{bulkReviewStore=await bulkReviewApi.saveBulkReviewPreset({name,view});bulkReviewStatus=`Saved the “${name.trim()}” view.`;}catch(cause){bulkReviewStatus=cause instanceof Error?cause.message:'Could not save the review view.';}}
  function loadBulkReviewView(preset:BulkReviewPreset){const view=preset.view;filter=view.primaryFilter as BulkPrimaryFilter;mutationFilter=view.mutationFilter;signalFilters=new Set(view.signalFilters);sourceFilter=view.sourceFilter as BulkSourceFilter;lifecycleFilter=view.lifecycleFilter;ageFilter=view.ageFilter as BulkAgeFilter;mailFilter=view.mailFilter as BulkMailFilter;registrarFilter=view.registrarFilter;caseDispositionFilter=view.caseDispositionFilter;reviewStateFilter=view.reviewStateFilter;groupBy=view.groupBy as BulkGroupBy;sortKey=normalizeBulkPresentationSortKey(view.sortKey);sortDirection=view.sortDirection;page=1;bulkReviewStatus=`Loaded the ${preset.name} review view. No scan was started.`;}
  async function removeBulkReviewView(preset:BulkReviewPreset){await ensureBulkReviewContext();if(bulkReviewSourceState!=='ready'||!bulkReviewApi){bulkReviewStatus='Saved review state is unavailable. Reload before deleting saved views.';return;}try{bulkReviewStore=await bulkReviewApi.deleteBulkReviewPreset(preset.id);bulkReviewStatus=`Deleted the ${preset.name} review view.`;}catch(cause){bulkReviewStatus=cause instanceof Error?cause.message:'Could not delete the review view.';}}
  async function setBulkReviewState(row:ScanResult,state:string){await ensureBulkReviewContext();if(bulkReviewSourceState!=='ready'||!bulkReviewApi){bulkReviewStatus='Saved review state is unavailable. Reload before changing a row review state.';return;}const previous=bulkReviewStateByDomain.get(row.domain)||'unreviewed';if(previous===state)return;const api=bulkReviewApi;try{bulkReviewStore=await api.saveBulkReviewRowState(row.domain,state as BulkReviewState);bulkReviewStatus=`Marked ${row.domain} as ${state}. Case disposition was not changed.`;registerAnalystUndo({kind:'bulk_review_state',action:`Review state changed to ${state}`,affectedRecord:row.domain,undo:async()=>{bulkReviewStore=await api.saveBulkReviewRowState(row.domain,previous);return `Restored ${row.domain} to ${previous}.`;}});}catch(cause){bulkReviewStatus=cause instanceof Error?cause.message:'Could not update the review state.';}}
  function setSort(key:BulkSortKey){const next=normalizeBulkPresentationSortKey(key);if(sortKey===next)sortDirection=sortDirection===1?-1:1;else{sortKey=next;sortDirection=defaultBulkSortDirection(next);}page=1;}
  function setSortKey(key:BulkSortKey){const next=normalizeBulkPresentationSortKey(key);if(sortKey!==next){sortKey=next;sortDirection=defaultBulkSortDirection(next);}page=1;}
  function setSortDirection(direction:BulkSortDirection){sortDirection=direction;page=1;}
  function loadDomains(domains:string[]){input=domains.join('\n');status=`Loaded ${domains.length} related domains into the scan queue.`;document.querySelector('.queue')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}
  async function retainObservation(relationship:Record<string,unknown>){
    relationshipRetentionStatus='';
    await ensureRelationshipContext();
    if(relationshipsSourceState!=='ready'||!relationshipApi){relationshipRetentionStatus='Retained relationship observations are unavailable. Reload before recording a relationship.';return;}
    try{
      const result=await relationshipApi.retainRelationshipObservation(relationship,{
        observedAt:new Date().toISOString(),
        retainedAt:new Date().toISOString(),
        complete:!relationshipSummary.truncated,
        truncated:relationshipSummary.truncated,
        limitations:relationshipSummary.limitations,
        sourceVersion:RELATIONSHIP_EVIDENCE_VERSION,
      });
      retainedRelationshipIds=new Set([...retainedRelationshipIds,result.record.id]);
      relationshipRetentionStatus=`${result.added?'Retained':'Refreshed'} ${result.record.label.toLowerCase()} for ${result.record.domains.length} domain${result.record.domains.length===1?'':'s'} in this browser${result.pruned?`; pruned ${result.pruned} older observation${result.pruned===1?'':'s'} to stay within storage`:''}.`;
    }catch(cause){relationshipRetentionStatus=cause instanceof Error?cause.message:'Could not retain that relationship observation.';}
  }
  function isShortlisted(domain:string){return shortlistedDomains.has(domain);}
  async function toggleSaved(row:ScanResult){await ensurePrimaryResultContext();if(shortlistSourceState!=='ready'||!shortlistApi){shortlistStatus='The shortlist is unavailable. Reload before changing it.';return;}const api=shortlistApi;const previous=shortlist.find((item)=>item.domain===row.domain);try{const added=await api.toggleShortlist({...row.saved,riskScore:row.risk,opportunityScore:row.opportunity,savedAt:new Date().toISOString()});shortlist=await api.loadShortlist();shortlistStatus=added?`Added ${row.domain} to the shortlist.`:`Removed ${row.domain} from the shortlist.`;registerAnalystUndo({kind:'shortlist_membership',action:added?'Added to shortlist':'Removed from shortlist',affectedRecord:row.domain,undo:async()=>{if(previous)await api.setShortlistSelection([previous],true);else await api.setShortlistSelection([shortlistPayload(row)],false);shortlist=await api.loadShortlist();return `${row.domain} ${previous?'restored to':'removed from'} the shortlist.`;}});}catch(cause){shortlistStatus=cause instanceof Error?cause.message:'Could not update shortlist.';}}
  function shortlistPayload(row:ScanResult){return{...row.saved,riskScore:row.risk,opportunityScore:row.opportunity,savedAt:new Date().toISOString()};}
  function shortlistSelectionStatus(result:ShortlistSelectionResult,selected:boolean):string {
    if(!selected)return `Removed ${result.removed} domain${result.removed===1?'':'s'} from the shortlist.`;
    const changed=result.added+result.updated;
    const skipped=result.skipped
      ? `; skipped ${result.skipped} invalid or over-limit row${result.skipped===1?'':'s'}`
      : '';
    return `Selected ${result.added} new and refreshed ${result.updated} existing domain${changed===1?'':'s'}${skipped}.`;
  }
  async function restoreShortlistSelection(affected:ScanResult[],previous:ShortlistRecord[]):Promise<string> {
    await ensurePrimaryResultContext();
    if(!shortlistApi)throw new Error('The shortlist is unavailable. Reload before changing it.');
    await shortlistApi.setShortlistSelection(affected.map(shortlistPayload),false);
    if(previous.length)await shortlistApi.setShortlistSelection(previous,true);
    shortlist=await shortlistApi.loadShortlist();
    return `Restored the prior shortlist membership for ${affected.length} domain${affected.length===1?'':'s'}.`;
  }
  async function selectRows(rows:ScanResult[],selected=true){
    await ensurePrimaryResultContext();
    if(shortlistSourceState!=='ready'||!shortlistApi){shortlistStatus='The shortlist is unavailable. Reload before changing the selection.';return;}
    const affected=rows.slice(0,500);
    const affectedDomains=new Set(affected.map((row)=>row.domain));
    const previous=shortlist.filter((item)=>affectedDomains.has(item.domain));
    try{
      const result=await shortlistApi.setShortlistSelection(affected.map(shortlistPayload),selected);
      shortlist=await shortlistApi.loadShortlist();
      shortlistStatus=shortlistSelectionStatus(result,selected);
      if(result.added+result.updated+result.removed>0){
        registerAnalystUndo({
          kind:'shortlist_membership',
          action:selected?'Updated shortlist selection':'Removed shortlist selection',
          affectedRecord:`${affected.length} domain${affected.length===1?'':'s'}`,
          undo:()=>restoreShortlistSelection(affected,previous),
        });
      }
    }catch(cause){
      shortlistStatus=cause instanceof Error?cause.message:'Could not update the selection.';
    }
  }
  async function selectDomains(domains:string[]){const wanted=new Set(domains);await selectRows(filtered.filter((row)=>wanted.has(row.domain)),true);}
  async function selectFiltered(){await selectRows(filtered,true);}
  async function clearFilteredSelection(){await selectRows(filtered,false);}
  async function removeAllShortlisted(){await ensurePrimaryResultContext();if(shortlistSourceState!=='ready'||!shortlistApi){shortlistStatus='The shortlist is unavailable. Reload before changing it.';return;}if(!shortlist.length||!confirm('Remove every domain from the shortlist?'))return;try{await shortlistApi.clearShortlist();shortlist=[];shortlistStatus='Shortlist cleared.';}catch(cause){shortlistStatus=cause instanceof Error?cause.message:'Could not clear the shortlist.';}}
  async function downloadShortlist(){await ensurePrimaryResultContext();if(!shortlistApi){shortlistStatus='The shortlist is unavailable. Reload before exporting it.';return;}try{await shortlistApi.exportShortlist();}catch(cause){shortlistStatus=cause instanceof Error?cause.message:'Could not export the shortlist.';}}
  function loadShortlisted(){loadDomains(shortlist.map(item=>item.domain));}
  async function copyDraft(text:string,label:string){try{await navigator.clipboard.writeText(text);draftStatus=`Copied ${label} to the clipboard.`;}catch{draftStatus='Clipboard access was unavailable. Use the email draft link instead.';}}
  async function importShortlistFile(event:Event){const input=event.currentTarget as HTMLInputElement,file=input.files?.[0];if(!file)return;await ensurePrimaryResultContext();if(shortlistSourceState!=='ready'||!shortlistApi){shortlistStatus='The shortlist is unavailable. Reload before importing.';input.value='';return;}try{const maximumBytes=shortlistApi.MAX_SHORTLIST_IMPORT_BYTES;if(file.size>maximumBytes)throw new Error('Shortlist imports are limited to 2 MB.');const result=await shortlistApi.importShortlist(parseBoundedJson(await file.text(),{label:'Shortlist import',maximumBytes}));shortlist=await shortlistApi.loadShortlist();const skipped=result.skipped?`; skipped ${result.skipped} invalid, duplicate, or over-limit entr${result.skipped===1?'y':'ies'}`:'';shortlistStatus=`Imported ${result.added} new and ${result.updated} updated shortlist entries${skipped}.`;}catch(cause){shortlistStatus=cause instanceof Error?cause.message:'Shortlist import failed';}finally{input.value='';}}
  async function importDomainFile(event:Event){const control=event.currentTarget as HTMLInputElement,file=control.files?.[0];if(!file)return;try{if(file.size>MAX_DOMAIN_IMPORT_BYTES)throw new Error('Domain-list imports are limited to 2 MB.');const parsed=parseDomainInput(await file.text());if(parsed.tooLarge)throw new Error('The domain-list file exceeds the bounded row or cell limit.');if(!parsed.entries.length)throw new Error('No domain entries were found in that file.');input=parsed.entries.join('\n');status=`Loaded ${parsed.entries.length} unique entries from ${file.name}${parsed.usedHeader?' using its domain column':''}${parsed.duplicates?`; removed ${parsed.duplicates} duplicate${parsed.duplicates===1?'':'s'}`:''}.`;}catch(cause){status=cause instanceof Error?cause.message:'Could not import the domain list.';}finally{control.value='';}}
  function exportCoverage(){if(!coverage)return;const rows=[['dimension','group','total','registered','available','unknown','profile_listed_overlapping','profile_listed_share','domain','outcome','profile_listed','priority','action','rationale'],...coverage.mutationGroups.map((group)=>['mutation',group.label,group.total,group.registered,group.available,group.unknown,group.profileListed,group.profileListedShare,'','','','','','']),...coverage.tldGroups.map((group)=>['tld',group.label,group.total,group.registered,group.available,group.unknown,group.profileListed,group.profileListedShare,'','','','','','']),...coverage.plan.map((row)=>['candidate','','','','','','','',row.domain,row.status,row.profileListed?'true':'false',row.priority,row.actionLabel,row.rationale])];const url=URL.createObjectURL(new Blob([rowsToCsv(rows)],{type:'text/csv'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`defensive-registration-profile-listing-${new Date().toISOString().slice(0,10)}.csv`;anchor.click();URL.revokeObjectURL(url);}
  function exportPeerOutliers(){const exported=buildBulkPeerOutlierExport(peerOutlierMatrix,new Date().toISOString());downloadText(exported.content,exported.filename,'text/csv');}
  async function waitWhilePaused(){if(!paused)return;await new Promise<void>(resolve=>pauseResolvers.push(resolve));}
  function resume(){paused=false;for(const resolve of pauseResolvers.splice(0))resolve();}
  function togglePause(){if(paused)resume();else paused=true;}
  function cancel(){resume();controller?.abort();status=`Cancelled after ${completed} of ${total} lookups.`;}
  async function fetchLookup(domain:string,signal:AbortSignal):Promise<CompactLookupHttpResponse>{return fetchCompactBulkLookup(domain,mode,signal);}
  function normalize(domain:string,body:CompactLookupHttpResponse,snapshot:BulkScanProfileSnapshot):ScanResult {
    const candidate=provenance(domain)||provenance(body.availability.domain)||null;
    return normalizeBulkScanResult(body,{targetDomain:domain,mode:snapshot.mode,profile:snapshot.profile,profileSourceState:snapshot.sourceState,candidate});
  }
  function failedResult(domain:string,message:string,snapshot:BulkScanProfileSnapshot):ScanResult{const candidate=provenance(domain);const mutationTypes=candidate?.mutationTypes||[];const officialDomains=snapshot.sourceState==='ready'?(snapshot.profile?.officialDomains||[]):[];const idn=analyzeDomainIdn(domain,officialDomains);const profileValue=snapshot.sourceState==='ready'?false:null;return{domain:idn?.asciiDomain||domain,status:'error',availability:'error',confidence:'unknown',registrar:'—',activity:'—',risk:null,opportunity:null,mutationTypes,trusted:null,error:message,saved:{domain:idn?.asciiDomain||domain,scanDepth:snapshot.mode,availability:'error',registrarName:'—',nameservers:[],faviconHash:null,faviconPHash:null,faviconMatch:profileValue,faviconNearMatch:profileValue,reusesOfficialAssets:profileValue,idnReferenceMatch:snapshot.sourceState==='ready'?Boolean(idn?.referenceMatches.length):null,pageBaselineMatch:null,hasActiveBrandProfile:snapshot.sourceState==='ready'?Boolean(snapshot.profile):null,riskFactors:[],mutationTypes,profileContext:snapshot.provenance,error:message},nameservers:[],faviconHash:null,faviconPHash:null,faviconMatch:profileValue,faviconNearMatch:profileValue,reusesOfficialAssets:profileValue,hasPasswordField:false,hasExternalFormAction:null,phishingLanguageMatch:null,registrant:null,abuseEvidence:null,ct:candidate?.certificateTransparency||null,idn,dns:null,dnssec:null,comparisonEvidence:null,relationship:relationshipObservation({},officialDomains),sourceCoverage:[{source:'lookup',state:'error'}]};}
  async function saveCurrentBulkSession(){await ensureBulkSessionsContext();if(bulkSessionsSourceState!=='ready'||!bulkSessionsApi){bulkSessionStatus='Saved Bulk sessions are unavailable. Reload before saving.';return;}const name=bulkSessionName.trim();const domains=parseDomains();if(!name||!domains.length||!results.length){bulkSessionStatus='Enter a session name and complete at least one result before saving.';return;}try{const settled=new Set(results.map((row)=>row.domain));const isComplete=domains.every((domain)=>settled.has(domain));const now=new Date().toISOString();const sessionResults=results.map(toBulkSessionResult);const result=await bulkSessionsApi.saveBulkSession({id:currentBulkSessionId||createBulkSessionId(),name,mode,state:isComplete?'complete':status.startsWith('Cancelled')?'cancelled':'partial',inputDigest:await bulkSessionInputDigest(domains,mode),domains,results:sessionResults,profileContext:summarizeBulkProfileContexts(sessionResults),startedAt:scanStartedAt||now,updatedAt:now,completedAt:isComplete?now:null});currentBulkSessionId=result.session.id;bulkSessions=await bulkSessionsApi.loadBulkSessions();bulkSessionStatus=`${result.added?'Saved':'Updated'} ${result.session.name}.${result.pruned?` Pruned ${result.pruned} older session${result.pruned===1?'':'s'} to stay within storage.`:''}`;}catch(cause){bulkSessionStatus=cause instanceof Error?cause.message:'Could not save the Bulk session.';}}
  function loadSavedBulkSession(session:BulkSession){if(running){bulkSessionStatus='Cancel or wait for the active scan before loading a saved session.';return;}if(profileSourceState==='loading'){bulkSessionStatus='Wait for browser-local Brand Profile context to finish loading before restoring a saved session.';return;}currentBulkSessionId=session.id;bulkSessionName=session.name;mode=session.mode;input=session.domains.join('\n');const current=currentProfileContext();let quarantined=0;results=session.results.map((row)=>{const restored=fromBulkSessionResult(row,current.sourceState==='ready'?(profile?.officialDomains||[]):[]);const reconciled=reconcileBulkResultProfileContext(restored,current);if(reconciled.saved.profileContext.sourceState!=='ready')quarantined+=1;return reconciled;});completed=results.length;total=session.domains.length;page=1;scanStartedAt=session.startedAt;status=`Loaded ${session.name}: ${results.length} of ${session.domains.length} rows settled. Contact records were not retained.${quarantined?` Withheld profile-derived trust, matches, and Risk for ${quarantined} row${quarantined===1?'':'s'} whose saved provenance does not match the current settled profile context.`:''}`;void ensurePrimaryResultContext();requestAnimationFrame(()=>document.querySelector('#results')?.scrollIntoView({behavior:'auto'}));}
  async function resumeSavedBulkSession(session:BulkSession){if(running){bulkSessionStatus='Cancel or wait for the active scan before resuming a saved session.';return;}if(profileSourceState==='loading'){bulkSessionStatus='Wait for browser-local Brand Profile context to finish loading before resuming a saved session.';return;}loadSavedBulkSession(session);const settled=new Set(session.results.map((row)=>row.domain));const pending=session.domains.filter((domain)=>!settled.has(domain));if(!pending.length){bulkSessionStatus='Every queued domain already has a settled result. Use Retry failed to repeat error rows.';return;}await run(pending,false);await saveCurrentBulkSession();}
  async function removeSavedBulkSession(session:BulkSession){if(running){bulkSessionStatus='Cancel or wait for the active scan before deleting a saved session.';return;}if(!confirm(`Delete the saved session “${session.name}”?`))return;await ensureBulkSessionsContext();if(!bulkSessionsApi)return;try{bulkSessions=await bulkSessionsApi.deleteBulkSession(session.id);if(currentBulkSessionId===session.id){currentBulkSessionId='';bulkSessionName='';}bulkSessionStatus=`Deleted ${session.name}.`;}catch(cause){bulkSessionStatus=cause instanceof Error?cause.message:'Could not delete the Bulk session.';}}
  async function downloadBulkSessions(){await ensureBulkSessionsContext();if(!bulkSessionsApi)return;try{await bulkSessionsApi.exportBulkSessions();bulkSessionStatus=`Exported ${bulkSessions.length} saved session${bulkSessions.length===1?'':'s'}.`;}catch(cause){bulkSessionStatus=cause instanceof Error?cause.message:'Could not export saved Bulk sessions.';}}
  function resultAt(index:number){return index>=0&&index<results.length?results[index]:null;}
  function toggleSavedAt(index:number){const row=resultAt(index);if(row)toggleSaved(row);}
  async function trackCaseAt(index:number){if(casesSourceState!=='ready'){caseStatus='Cases are unavailable. Reload before creating a case.';return;}const row=resultAt(index);if(row)await trackCase(row);}
  async function setDispositionAt(index:number,value:string){if(casesSourceState!=='ready'){caseStatus='Cases are unavailable. Reload before changing a disposition.';return;}const row=resultAt(index);if(row)await setRowDisposition(row,value);}
  function setReviewStateAt(index:number,value:string){const row=resultAt(index);if(row)void setBulkReviewState(row,value);}
  async function saveCurrentResultAt(index:number){
    const row=resultAt(index);
    const name=watchlistName.trim();
    if(!row){saveStatus='The current review row is no longer available.';return;}
    if(!name){saveStatus='Enter a watchlist name.';return;}
    if(profileSourceState!=='ready'||row.saved.profileContext.sourceState!=='ready'){saveStatus='Brand Profile trust and allowlist context is inconclusive, so this row cannot be saved to Monitor. Reload or rescan after context is ready.';return;}
    if(row.trusted){saveStatus='Domains trusted by the active Brand Profile are excluded from watchlists.';return;}
    try{
      const changes=await saveWatchlist(name,[row.saved],mode);
      saveStatus=changes.length
        ? `Updated ${name} with ${row.domain} and recorded ${changes.length} material change${changes.length===1?'':'s'}.`
        : `Saved ${row.domain} to ${name}.`;
    }catch(cause){saveStatus=cause instanceof Error?cause.message:'Could not save the current result.';}
  }
  async function inspectAt(index:number){const row=resultAt(index);if(!row)return;selectInvestigationGuideFocusDomain(row.domain);await goto(`/lookup?q=${encodeURIComponent(row.domain)}&depth=deep#query`);}
  async function run(domains:string[],replace=true,preservePrior=false):Promise<string[]>{
    if(profileSourceState==='loading'){status='Wait for browser-local Brand Profile context to finish loading before scanning.';return[];}
    const scanProfile=settledProfileSnapshot();
    const limit=bulkQueryLimit(mode);
    if(!domains.length){status='Enter at least one domain.';return[];}
    if(domains.length>limit){status=`${mode==='fast'?'Fast':'Deep'} scans are limited to ${limit} domains.`;return[];}
    void ensurePrimaryResultContext();
    const scanController=new AbortController();
    const generation=++scanGeneration;
    const ownsScan=()=>generation===scanGeneration&&controller===scanController;
    const currentResults=results;
    controller=scanController;running=true;paused=false;completed=0;total=domains.length;page=1;scanElapsedMs=0;
    if(replace)results=[];
    status=`Scanning ${total} domain${total===1?'':'s'}…${scanProfile.sourceState==='unavailable'?' Brand Profile-derived trust, allowlist, match, and contextual Risk evidence will remain inconclusive.':''}`;
    const execution=await executeBulkScan({
      domains,currentResults,replace,preservePrior,profile:scanProfile,
      controller:scanController,concurrency:bulkConcurrency(mode,pacing),ownsScan,waitWhilePaused,
      fetchLookup,normalizeResult:normalize,failedResult,
      onSnapshot:(snapshot)=>activeScanSnapshot=snapshot,
      onPublish:(nextResults)=>results=nextResults,
      onProgress:(nextCompleted,elapsedMs)=>{completed=nextCompleted;scanElapsedMs=elapsedMs;},
    });
    if(!execution.owned)return [...execution.preservedReasons];
    running=false;controller=null;
    if(execution.aborted)return [...execution.preservedReasons];
    status=`Completed ${completed} of ${total} lookups.${scanProfile.sourceState==='unavailable'?' Brand Profile context was unavailable; profile-derived fields are retained as inconclusive and every row records that limitation.':''}${execution.preservedReasons.length?` Retained ${execution.preservedReasons.length} stronger prior result${execution.preservedReasons.length===1?'':'s'}.`:''}`;
    return [...execution.preservedReasons];
  }
  async function start(){if(lookupDisabled){status=lookupDisabled.reason||'Lookup is disabled by deployment policy.';return;}if(parsedInput.tooLarge){status='The pasted domain list exceeds the bounded input limit.';return;}if(profileSourceState==='loading'){status='Wait for browser-local Brand Profile context to finish loading before scanning.';return;}if(currentBulkSessionId)bulkSessionName='';currentBulkSessionId='';scanStartedAt=new Date().toISOString();await run(parseDomains(),true);}
  async function retryErrors(){if(profileSourceState==='loading'){retryStatus='Wait for browser-local Brand Profile context to finish loading before retrying.';return;}const domains=results.filter(r=>r.status==='error').map(r=>r.domain);if(!domains.length||running)return;const plan=buildBulkRetryPlan(results.filter((row)=>domains.includes(row.domain)).map(toBulkSessionResult),mode,scanStartedAt);if(!confirm(`Retry ${plan.lookupRequests} failed lookup${plan.lookupRequests===1?'':'s'} using the ${mode} profile? Destinations: ${plan.destinations.join(', ')}.`))return;retryStatus=`Running ${plan.lookupRequests} reviewed retry${plan.lookupRequests===1?'':'ies'}.`;const preserved=await run(domains,false,true);retryStatus=`Retry completed.${preserved.length?` ${preserved.length} stronger prior result${preserved.length===1?' was':'s were'} retained.`:''}`;}
  function exportRowsCsv(selected:ScanResult[],scope='bulk'){const header=['domain','unicode_domain','idn_scripts','idn_mixed_script','idn_official_skeleton_matches','availability','confidence','profile_context_state','profile_context_limitation','profile_status','registrar','activity',...BULK_SCORE_CSV_HEADERS,'mutations','error','dns_status','dnssec','dns_a','dns_aaaa','dns_cname','dns_caa','technology_ids','tls_issuer','tls_spki_sha256','ct_first_observed','ct_last_observed','ct_certificate_count','ct_hostnames'];const rows=selected.map(r=>{const contextReady=r.saved.profileContext.sourceState==='ready';return[r.domain,r.idn?.hasIdn?r.idn.unicodeDomain:'',r.idn?.scripts?.join('|')||'',r.idn?.mixedScript?'true':'false',contextReady?r.idn?.referenceMatches?.map((match)=>match.asciiDomain).join('|')||'':'',r.availability,r.confidence,r.saved.profileContext.sourceState,r.saved.profileContext.limitation,contextReady?(r.trusted||''):'',r.registrar,r.activity,...bulkScoreCsvFields(r),r.mutationTypes.join('|'),r.error,r.dns?.status||'',r.dnssec||'',r.dns?.records.a.join('|')||'',r.dns?.records.aaaa.join('|')||'',r.dns?.records.cname.join('|')||'',r.dns?.records.caa.map((item)=>`${item.critical} ${item.tag} ${item.value}`).join('|')||'',r.comparisonEvidence?.technology.ids.join('|')||'',r.comparisonEvidence?.tls.issuerLabel||'',r.comparisonEvidence?.tls.spkiSha256||'',...ctCsvFields(r.ct)]});const url=URL.createObjectURL(new Blob([rowsToCsv([header,...rows])],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download=`whoisleuth-${scope}-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url);}
  function exportCsv(){exportRowsCsv(results);}
  async function exportSelectedCsv(){if(!selectedRows.length)return;await ensureBulkReviewContext();const generatedAt=new Date().toISOString();exportRowsCsv(selectedRows,'selected');const exported=await buildBulkReviewManifest({rows:selectedRows.map(toBulkSessionResult),reviewStates:bulkReviewStore.rows,view:currentBulkReviewView(),lookupProfile:mode,observedAt:scanStartedAt,generatedAt});downloadText(exported.content,exported.filename,'application/json');bulkReviewStatus=`Exported ${selectedRows.length} selected row${selectedRows.length===1?'':'s'} with an integrity-stamped review manifest.`;}
  async function deepRescanSelected(){if(profileSourceState==='loading'){retryStatus='Wait for browser-local Brand Profile context to finish loading before rescanning.';return;}const domains=selectedRows.slice(0,200).map((row)=>row.domain);if(!domains.length||running)return;const nextMode:'deep'='deep';const destinations=buildBulkRetryPlan(selectedRows.map(toBulkSessionResult),nextMode,scanStartedAt).destinations;if(!confirm(`Deep rescan ${domains.length} explicitly selected domain${domains.length===1?'':'s'}? Destinations: ${destinations.join(', ')}.`))return;mode=nextMode;retryStatus=`Running a reviewed Deep rescan of ${domains.length} selected domain${domains.length===1?'':'s'}.`;const preserved=await run(domains,false,true);retryStatus=`Deep rescan completed.${preserved.length?` ${preserved.length} stronger prior result${preserved.length===1?' was':'s were'} retained.`:''}`;}
  async function executeReviewedRetry(){if(profileSourceState==='loading'){retryStatus='Wait for browser-local Brand Profile context to finish loading before retrying.';return;}if(!retryPlan.rows.length||running)return;const domains=retryPlan.rows.map((row)=>row.domain);retryStatus=`Running ${domains.length} reviewed ${retryPlan.mode} retr${domains.length===1?'y':'ies'}.`;const preserved=await run(domains,false,true);retryStatus=`Reviewed retry completed.${preserved.length?` ${preserved.length} stronger prior result${preserved.length===1?' was':'s were'} retained.`:''}`;}
  async function exportDomainComparison(){if(!domainComparison)return;const exported=await buildBulkDomainComparisonExport(domainComparison);downloadText(exported.content,exported.filename,'application/json');bulkReviewStatus='Exported the two-domain evidence comparison with an integrity digest.';}
  async function exportMailExposure(){if(profileSourceState!=='ready'){bulkReviewStatus='Brand Profile context is not ready, so the mail-exposure comparison remains inconclusive and cannot be exported yet.';return;}const exported=await buildBulkMailExposureExport(mailExposureReport);downloadText(exported.content,exported.filename,'application/json');bulkReviewStatus='Exported the filtered mail-exposure review with an integrity digest.';}
  async function createCasesSelected(){await ensurePrimaryResultContext();if(casesSourceState!=='ready'||!casesApi){caseStatus='Cases are unavailable. Reload before creating cases.';return;}const rows=selectedRows.slice(0,50);if(!rows.length||!confirm(`Create or refresh cases for ${rows.length} selected domain${rows.length===1?'':'s'}?`))return;for(const row of rows)await trackCase(row);caseStatus=`Reviewed ${rows.length} selected domain${rows.length===1?'':'s'} for case creation${selectedRows.length>rows.length?'; the action was capped at 50':''}.`;}
  async function setSelectedDisposition(value:string){
    if(caseMutationBusy)return;
    caseMutationBusy=true;
    try{
      await ensurePrimaryResultContext();
      if(casesSourceState!=='ready'||!casesApi){caseStatus='Cases are unavailable. Reload before changing dispositions.';return;}
      const records=selectedRows.map((row)=>caseByDomain.get(row.domain)).filter((record):record is CaseRecord=>Boolean(record)).slice(0,100);if(!records.length)return;
      const committed=await casesApi.setCaseDispositions(records.map((record)=>record.id),value);
      await reconcileBulkCaseSnapshot(committed,`Marked ${committed.changed} selected case${committed.changed===1?'':'s'} as ${casesApi.dispositionLabel(value)}${selectedRows.length>records.length?'; only existing cases were changed':''}.${prunedNote(committed.pruned)}`);
    }catch(cause){caseStatus=cause instanceof Error?cause.message:'Could not update the selected Cases.';}
    finally{caseMutationBusy=false;}
  }
  function downloadText(content:string,filename:string,mimeType:string){const url=URL.createObjectURL(new Blob([content],{type:mimeType}));const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();URL.revokeObjectURL(url);}
  async function exportDefensiveIndicators(){
    if(profileSourceState!=='ready'){indicatorStatus='Brand Profile context is unavailable, so trusted and allowlisted exclusions are inconclusive. Reload before exporting defensive indicators.';return;}
    const reviewOptions={selectedDomains:[...shortlistedDomains],officialDomains:profile?.officialDomains||[],allowlistedDomains:profile?.allowlistedDomains||[],includeWildcards:indicatorWildcards};
    try{
      const reviewed=buildDefensiveIndicatorExport(reviewedIndicatorRows,{...reviewOptions,format:indicatorFormat==='stix'||indicatorFormat==='misp'?'domains':indicatorFormat});
      if(!reviewed.domains.length){indicatorStatus='Shortlist an eligible domain and mark its case Suspicious or Confirmed abuse before exporting.';return;}
      const sources=reviewed.entries.map((entry)=>entry.source);
      const exported=indicatorFormat==='stix'
        ?(await loadDeferredModule(()=>import('$lib/analysis/stix-indicator-export.ts'),{signal:moduleController.signal})).buildStixIndicatorExport(sources)
        :indicatorFormat==='misp'
          ?(await loadDeferredModule(()=>import('$lib/analysis/misp-indicator-export.ts'),{signal:moduleController.signal})).buildMispIndicatorExport(sources)
          :reviewed;
      downloadText(exported.content,exported.filename,exported.mimeType);
      downloadText(reviewed.manifestContent,reviewed.manifestFilename,'application/json');
      downloadText(reviewed.rollbackContent,reviewed.rollbackFilename,'application/json');
      indicatorStatus=`Exported ${reviewed.domains.length} reviewed indicator${reviewed.domains.length===1?'':'s'}, a provenance manifest, and a rollback set${reviewed.exclusions.length?`; preflight excluded ${reviewed.exclusions.length} other selection${reviewed.exclusions.length===1?'':'s'}`:''}.`;
    }catch{
      indicatorStatus='Indicator export modules are unavailable. Reload the page before exporting.';
    }
  }
  async function saveResults(){const name=watchlistName.trim();if(!name){saveStatus='Enter a watchlist name.';return;}if(profileSourceState!=='ready'){saveStatus='Brand Profile context is unavailable, so trusted and allowlisted exclusions are inconclusive. Reload before saving these results to Monitor.';return;}const blocked=results.filter((row)=>row.saved.profileContext.sourceState!=='ready').length;if(blocked){saveStatus=`Nothing was saved. ${blocked} target row${blocked===1?' has':'s have'} unevaluated Brand Profile context, so this Monitor update was blocked atomically until every target is rescanned.`;return;}const findings=results.filter(row=>!row.trusted);if(!findings.length){saveStatus='Every result is trusted by the active profile; nothing was added to Monitor.';return;}try{const changes=await saveWatchlist(name,findings.map(r=>r.saved),mode);const excluded=results.length-findings.length;saveStatus=changes.length?`Updated ${name} and recorded ${changes.length} material change${changes.length===1?'':'s'}${excluded?`; excluded ${excluded} trusted domain${excluded===1?'':'s'}`:''}.`:`Saved ${findings.length} result${findings.length===1?'':'s'} to ${name}${excluded?`; excluded ${excluded} trusted domain${excluded===1?'':'s'}`:''}.`;watchlistName='';}catch(cause){saveStatus=cause instanceof Error?cause.message:'Could not save watchlist.';}}
  async function saveSelectedResults(){const name=watchlistName.trim();if(!name){saveStatus='Enter a watchlist name.';return;}if(profileSourceState!=='ready'){saveStatus='Brand Profile context is unavailable, so selected results cannot be classified against trusted or allowlisted domains. Reload before saving.';return;}const blocked=selectedRows.filter((row)=>row.saved.profileContext.sourceState!=='ready').length;if(blocked){saveStatus=`Nothing was saved. ${blocked} selected row${blocked===1?' has':'s have'} unevaluated Brand Profile context, so this Monitor update was blocked atomically until every target is rescanned.`;return;}const findings=selectedRows.filter((row)=>!row.trusted);if(!findings.length){saveStatus='Select at least one non-trusted result before saving to Monitor.';return;}try{await saveWatchlist(name,findings.map((row)=>row.saved),mode);saveStatus=`Saved ${findings.length} explicitly selected result${findings.length===1?'':'s'} to ${name}.`;watchlistName='';}catch(cause){saveStatus=cause instanceof Error?cause.message:'Could not save the selected results.';}}
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
  {running}
  {paused}
  entryCount={scanTargets.length}
  queryLimit={currentQueryLimit}
  duplicateCount={parsedInput.duplicates}
  equivalentCount={equivalentTargetCount}
  inputTooLarge={parsedInput.tooLarge}
  {importDomainFile}
  {start}
  {togglePause}
  {cancel}
  {completed}
  {total}
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
      </div>
      {#if workspaceTool==='sessions'}
        <DeferredSurface
          load={()=>import('$lib/components/BulkSessions.svelte')}
          props={{sessions:bulkSessions,currentSessionId:currentBulkSessionId,saveName:bulkSessionName,setSaveName:(value:string)=>bulkSessionName=value,saveCurrent:saveCurrentBulkSession,loadSession:loadSavedBulkSession,resumeSession:resumeSavedBulkSession,deleteSession:removeSavedBulkSession,exportSessions:downloadBulkSessions,status:bulkSessionStatus,canSave:!running&&results.length>0,profileContextLoading:profileSourceState==='loading',running,sourceState:bulkSessionsSourceState}}
          onready={restoreBulkSessionsTarget}
          loadingLabel="Loading saved Bulk sessions from this browser."
          unavailableLabel="Saved Bulk sessions could not be loaded."
        />
      {:else}
        <DeferredSurface
          load={()=>import('$lib/components/BulkReviewWorkspace.svelte')}
          props={{store:bulkReviewStore,currentView:currentBulkReviewView(),reviewFilter:reviewStateFilter,setReviewFilter:(value:BulkReviewFilter)=>{reviewStateFilter=value;page=1;},saveView:saveCurrentBulkReviewView,loadView:loadBulkReviewView,deleteView:removeBulkReviewView,status:bulkReviewStatus,sourceState:bulkReviewSourceState}}
          loadingLabel="Loading saved Bulk review views from this browser."
          unavailableLabel="Saved Bulk review views could not be loaded."
        />
      {/if}
    </div>
  {/if}
</section>

{#if results.length}
  <section id="results" class="triage card" tabindex="-1">
    <BulkMobileDisclosure title="Filters and result actions" description="Filter, sort, export, retain, or rescan the current result set." onpreload={()=>preloadModule(()=>import('$lib/components/BulkTriageControls.svelte'))}>
      <DeferredSurface
        load={()=>import('$lib/components/BulkTriageControls.svelte')}
        props={{counts,filter,setFilter,running,retryErrors,exportCsv,indicatorFormat,setIndicatorFormat:(value:'domains'|'hosts'|'dnsmasq'|'rpz'|'stix'|'misp')=>indicatorFormat=value,exportIndicators:exportDefensiveIndicators,indicatorCount,indicatorEligibilityAvailable,indicatorProfileContextUnavailableCount,indicatorWildcards,setIndicatorWildcards:(value:boolean)=>indicatorWildcards=value,selectedIndicatorCount,mutationFilter,setMutationFilter:(value:string)=>{mutationFilter=value;page=1;},mutationOptions:mutationOptions.map((value)=>({value,label:mutationLabels[value]||value.replaceAll('_',' ')})),signalFilters,toggleSignal,sourceFilter,reviewFilter:reviewStateFilter,setSourceFilter:(value:BulkSourceFilter)=>{sourceFilter=value;page=1;},lifecycleFilter,setLifecycleFilter:(value:string)=>{lifecycleFilter=value;page=1;},ageFilter,setAgeFilter:(value:BulkAgeFilter)=>{ageFilter=value;page=1;},mailFilter,setMailFilter:(value:BulkMailFilter)=>{mailFilter=value;page=1;},registrarFilter,setRegistrarFilter:(value:string)=>{registrarFilter=value;page=1;},caseDispositionFilter,setCaseDispositionFilter:(value:string)=>{caseDispositionFilter=value;page=1;},groupBy,setGroupBy:(value:BulkGroupBy)=>groupBy=value,advancedFilterOptions,clearFilters,sortKey,sortDirection,setSortKey,setSortDirection,indicatorStatus,riskComparisonSummary:riskComparison.summary,matchedCount:filtered.length,resultCount:results.length,visibleCount:visibleResults.length,currentPage,pageCount,watchlistName,setWatchlistName:(value:string)=>watchlistName=value,saveResults,saveSelectedResults,saveStatus,selectedCount:selectedRows.length,monitorAllBlockedCount,monitorSelectedBlockedCount,selectFiltered,clearFilteredSelection,exportSelectedCsv,deepRescanSelected,createCasesSelected,setSelectedDisposition,caseMutationBusy,caseOptions,profileContextState:profileSourceState,shortlistAvailable:shortlistSourceState==='ready',caseAvailable:casesSourceState==='ready',reviewAvailable:bulkReviewSourceState==='ready'}}
        loadingLabel="Loading filters and result actions."
        unavailableLabel="Filters and result actions could not be loaded. The primary result list remains available."
      />
    </BulkMobileDisclosure>
    <div class="mobile-result-switcher" role="group" aria-label="Bulk result view">
      <button type="button" aria-controls="bulk-review-panel" aria-pressed={mobileResultView==='review'} onpointerenter={()=>preloadResultView('review')} onfocus={()=>preloadResultView('review')} onclick={()=>selectResultView('review')}>Review</button>
      <button type="button" aria-controls="bulk-list-panel" aria-pressed={mobileResultView==='list'} onpointerenter={()=>preloadResultView('list')} onfocus={()=>preloadResultView('list')} onclick={()=>selectResultView('list')}>List</button>
      <button type="button" aria-controls="bulk-analysis-panel" aria-pressed={mobileResultView==='analysis'} onpointerenter={()=>preloadResultView('analysis')} onfocus={()=>preloadResultView('analysis')} onclick={()=>selectResultView('analysis')}>Analysis</button>
    </div>

    <div id="bulk-review-panel" class:mobile-view-active={mobileResultView==='review'} class="mobile-result-panel review-result-panel">
      {#if mobileResultView==='review'}
        <DeferredSurface
          load={()=>import('$lib/components/BulkReviewCockpit.svelte')}
          props={{rows:cockpitRows,retryPlan,retryStatus,setReviewState:setReviewStateAt,toggleSaved:toggleSavedAt,trackCase:trackCaseAt,caseOptions,setDisposition:setDispositionAt,watchlistName,setWatchlistName:(value:string)=>watchlistName=value,saveToWatchlist:saveCurrentResultAt,actionStatus:saveStatus||caseStatus,inspectDomain:inspectAt,executeRetry:executeReviewedRetry,profileContextLoading:profileSourceState==='loading',shortlistAvailable:shortlistSourceState==='ready',caseAvailable:casesSourceState==='ready',reviewAvailable:bulkReviewSourceState==='ready'}}
          loadingLabel="Loading result review."
          unavailableLabel="Result review could not be loaded. The primary result list remains available."
        />
      {/if}
    </div>

    <div id="bulk-list-panel" class:mobile-view-active={mobileResultView==='list'} class="mobile-result-panel list-result-panel">
      {#if mobileResultView==='list'}
      <DeferredSurface
        load={()=>import('$lib/components/BulkResultsTable.svelte')}
        props={{rows:resultRows,sortKey,sortDirection,setSort,toggleSaved:toggleSavedAt,caseOptions,setDisposition:setDispositionAt,trackCase:trackCaseAt,inspectDomain:inspectAt,copyDraft,currentPage,pageCount,setPage:(value:number)=>page=value,draftStatus,caseStatus,setReviewState:setReviewStateAt,shortlistSourceState,caseSourceState:casesSourceState,reviewSourceState:bulkReviewSourceState}}
        loadingLabel="Loading the primary Bulk result list."
        unavailableLabel="The primary Bulk result list could not be loaded. Collected results remain in this tab."
      />
      {/if}
    </div>

    <div id="bulk-analysis-panel" class:mobile-view-active={mobileResultView==='analysis'} class="mobile-result-panel analysis-result-panel">
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
      {#if groupBy}
        <BulkMobileDisclosure title="Group summary" description="Review the grouping selected in the filters." onpreload={()=>preloadModule(()=>import('$lib/components/BulkGroupSummary.svelte'))}>
          <DeferredSurface
            load={()=>import('$lib/components/BulkGroupSummary.svelte')}
            props={{groupBy,groups:groupSummary.groups,excluded:groupSummary.excluded,truncated:groupSummary.truncated,overlapping:groupSummary.overlapping,selectedDomains:shortlistedDomains,selectionAvailable:shortlistSourceState==='ready',selectDomains}}
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
          props={{groups:relationshipSummary.groups,truncated:relationshipSummary.truncated,limitations:relationshipSummary.limitations,loadDomains,retainObservation,observationId:relationshipObservationId,retainedIds:retainedRelationshipIds,retainStatus:relationshipRetentionStatus,retentionAvailable:relationshipsSourceState==='ready',observedAt:scanStartedAt,sourceIdentities:relationshipSourceIdentities}}
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

<BulkMobileDisclosure title="Shortlist" description="Review and manage the browser-local shortlist." onpreload={()=>preloadModule(()=>import('$lib/components/BulkShortlist.svelte'))} onopen={ensurePrimaryResultContext}>
  <DeferredSurface load={()=>import('$lib/components/BulkShortlist.svelte')} props={{domains:shortlist.map((item)=>item.domain),status:shortlistStatus,sourceState:shortlistSourceState,loadShortlisted,downloadShortlist,importShortlistFile,removeAllShortlisted}} loadingLabel="Loading the browser-local shortlist." unavailableLabel="The shortlist workspace could not be loaded." />
</BulkMobileDisclosure>

<style>
  .local-context-status{margin:12px 0 0;color:var(--amber);font-size:var(--text-sm)}
  .local-context-status:empty{display:none}
  .bulk-workspace-shell{display:block;margin-top:16px}.mobile-workspace-toggle{display:flex;width:100%;min-width:0;align-items:center;justify-content:space-between;gap:12px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised);color:var(--text);text-align:left}.mobile-workspace-toggle span:first-child{display:grid;min-width:0;gap:3px}.mobile-workspace-toggle strong{font:700 var(--text-sm) var(--mono)}.mobile-workspace-toggle small{color:var(--muted);font-size:var(--text-xs);font-weight:400;line-height:1.4}.mobile-workspace-toggle span:last-child{flex:0 0 auto;color:var(--accent);font:700 var(--text-lg) var(--mono)}.bulk-workspace-content{display:block;min-width:0}.workspace-tool-switcher{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0;padding:4px;border:1px solid var(--border);border-radius:var(--radius-md)}.workspace-tool-switcher button{min-height:38px;padding:6px 10px;border:1px solid transparent;border-radius:var(--radius-sm);background:transparent;color:var(--muted);font:700 var(--text-xs) var(--mono)}.workspace-tool-switcher button[aria-pressed='true']{border-color:var(--accent);background:rgb(var(--accent-rgb) / .08);color:var(--accent)}
  .mobile-result-switcher{position:sticky;z-index:6;top:calc(var(--console-mobile-toolbar-height,0px) + 8px);display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin:12px 0;padding:4px;border:1px solid var(--border);border-radius:var(--radius-md);background:color-mix(in srgb,var(--panel) 94%,transparent);box-shadow:0 8px 24px rgb(var(--shadow-rgb) / .18);backdrop-filter:blur(10px)}.mobile-result-switcher button{min-width:0;min-height:44px;padding:6px 8px;border:0;border-radius:var(--radius-sm);background:transparent;color:var(--muted);font:700 var(--text-xs) var(--mono)}.mobile-result-switcher button[aria-pressed='true']{background:rgb(var(--accent-rgb) / .12);color:var(--accent)}.mobile-result-panel{display:none;min-width:0}.mobile-result-panel.mobile-view-active{display:block}.extended-analysis-panel{margin-top:10px}
  .triage{padding:var(--card-pad)}
  .triage{margin-top:16px}
  @media(max-width:520px){.workspace-tool-switcher{display:grid;grid-template-columns:1fr}.mobile-result-switcher{top:calc(var(--console-mobile-toolbar-height,0px) + 8px)}}
</style>
