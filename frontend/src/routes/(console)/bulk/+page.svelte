<script lang="ts">
  import { goto } from '$app/navigation';
  import { page as routePage } from '$app/state';
  import { getContext, onMount } from 'svelte';
  import BulkResultsTable from '$lib/components/BulkResultsTable.svelte';
  import BulkCoverage from '$lib/components/BulkCoverage.svelte';
  import BulkGroupSummary from '$lib/components/BulkGroupSummary.svelte';
  import BulkTriagePlot from '$lib/components/BulkTriagePlot.svelte';
  import BulkRelationships from '$lib/components/BulkRelationships.svelte';
  import BulkScanQueue from '$lib/components/BulkScanQueue.svelte';
  import BulkShortlist from '$lib/components/BulkShortlist.svelte';
  import BulkSessions from '$lib/components/BulkSessions.svelte';
  import BulkTriageControls from '$lib/components/BulkTriageControls.svelte';
  import BulkReviewWorkspace from '$lib/components/BulkReviewWorkspace.svelte';
  import BulkDomainComparison from '$lib/components/BulkDomainComparison.svelte';
  import BulkReviewCockpit from '$lib/components/BulkReviewCockpit.svelte';
  import BulkMailExposureReview from '$lib/components/BulkMailExposureReview.svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import { activeProfile, isDomainAllowlisted, profileDomainKind, profileSignals, type BrandProfile } from '$lib/brand-profiles';
  import { loadCandidateHandoff, type Candidate, type CandidateHandoff, type CertificateTransparencyProvenance } from '$lib/candidate-handoff';
  import { clearShortlist, exportShortlist, importShortlist, loadShortlist, MAX_SHORTLIST_IMPORT_BYTES, setShortlistSelection, toggleShortlist, type ShortlistRecord } from '$lib/shortlist';
  import { CASE_DISPOSITIONS, dispositionLabel, editCase, loadCases, openCase, type CaseRecord } from '$lib/cases';
  import { saveWatchlist } from '$lib/watchlists';
  import { MUTATION_LABELS } from '$lib/analysis/typosquat-generator.ts';
  import { buildCoverageReport } from '$lib/analysis/coverage.ts';
  import { computeOpportunityScore, explainRiskScore, formatActivityCell } from '$lib/analysis/scoring.ts';
  import { entityDisplayName, parseDomainInput, rowsToCsv } from '$lib/analysis/utils.ts';
  import { buildScanRelationships, relationshipObservation, RELATIONSHIP_EVIDENCE_VERSION } from '$lib/analysis/relationship-evidence.ts';
  import type { RelationshipObservation } from '$lib/analysis/relationship-evidence.ts';
  import { relationshipObservationId } from '$lib/analysis/relationship-observation-model.ts';
  import { loadRelationshipObservations, retainRelationshipObservation } from '$lib/relationship-observations';
  import { ctCsvFields } from '$lib/analysis/bulk-export.ts';
  import { buildDefensiveIndicatorExport, prepareDefensiveIndicatorExport } from '$lib/analysis/defensive-indicator-export.ts';
  import { buildStixIndicatorExport } from '$lib/analysis/stix-indicator-export.ts';
  import { buildMispIndicatorExport } from '$lib/analysis/misp-indicator-export.ts';
  import { analyzeDomainIdn } from '$lib/analysis/idn-confusables.ts';
  import { compactHttpObservation, normalizeHttpSummary } from '$lib/analysis/http-summary.ts';
  import {
    lookupRecord,
    type CompactLookupHttpResponse,
  } from '$lib/analysis/lookup-response.ts';
  import { fetchCompactBulkLookup } from '$lib/analysis/bulk-lookup-controller.ts';
  import {
    boundedStrings,
    boundedText,
    bulkSessionInputDigest,
    compactContact,
    compactDnsEvidence,
    compactSourceCoverage,
    createBulkSessionId,
    fromBulkSessionResult,
    nullableBoolean,
    plainRecord,
    toBulkSessionResult,
    type SavedScanRecord,
    type ScanMode,
    type ScanResult,
  } from '$lib/analysis/bulk-result-model.ts';
  import { defaultBulkSortDirection, sortBulkResults, type BulkSortDirection, type BulkSortKey } from '$lib/analysis/bulk-sort.ts';
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
    buildBulkResultDisplayRows,
    countBulkRouteFilters,
    matchesBulkRouteFilter,
    toBulkRouteTriageRow,
    type BulkPrimaryFilter,
  } from '$lib/analysis/bulk-route-model.ts';
  import { CAPABILITY_CONTEXT, disabledCapabilities, disabledCapability, type CapabilityGetter } from '$lib/capabilities';
  import { readBulkWorkflowState, writeBulkWorkflowState } from '$lib/console-workflow-state.ts';
  import { loadInvestigationGuide, selectInvestigationGuideFocusDomain, selectInvestigationGuideReviewDomains } from '$lib/investigation-guide';
  import { isExpectedBrowserLocalDataFailure } from '$lib/browser-local-data.ts';
  import {
    deleteBulkSession,
    exportBulkSessions,
    loadBulkSessions,
    saveBulkSession,
    type BulkSession,
  } from '$lib/bulk-sessions';
  import {
    deleteBulkReviewPreset,
    loadBulkReviewStore,
    saveBulkReviewPreset,
    saveBulkReviewRowState,
    type BulkReviewFilter,
    type BulkReviewPreset,
    type BulkReviewPresetView,
    type BulkReviewState,
    type BulkReviewStore,
  } from '$lib/bulk-review';
  import { BULK_REVIEW_SCHEMA, BULK_REVIEW_SCHEMA_VERSION } from '$lib/analysis/bulk-review-model.ts';
  import { buildBulkDomainComparison, buildBulkDomainComparisonExport } from '$lib/analysis/bulk-domain-comparison.ts';
  import { buildBulkRetryPlan, preservePriorBulkResult } from '$lib/analysis/bulk-retry-plan.ts';
  import {
    BULK_PACING_OPTIONS,
    buildBulkProgressEstimate,
    bulkConcurrency,
    normalizeBulkPacing,
    type BulkPacing,
  } from '$lib/analysis/bulk-pacing.ts';
  import { buildBulkReviewManifest } from '$lib/analysis/bulk-review-export.ts';
  import {
    buildBulkMailExposureExport,
    buildBulkMailExposureReport,
  } from '$lib/analysis/bulk-mail-exposure.ts';
  import type { BulkReviewCockpitRow } from '$lib/analysis/bulk-review-cockpit.ts';
  import { registerAnalystUndo } from '$lib/analyst-undo';

  const MAX_DOMAIN_IMPORT_BYTES = 2 * 1024 * 1024;
  const PAGE_SIZE = 100;
  const RESULT_PUBLISH_MS = 100;

  let handoff = $state<CandidateHandoff|null>(null);
  let input = $state(''); let mode = $state<ScanMode>('fast'); let running = $state(false); let paused = $state(false);
  let pacing = $state<BulkPacing>('standard'); let scanElapsedMs = $state(0);
  let completed = $state(0); let total = $state(0); let results = $state<ScanResult[]>([]); let filter = $state<BulkPrimaryFilter>('all');
  let mutationFilter=$state('');let signalFilters=$state<Set<string>>(new Set());let sortKey=$state<BulkSortKey>('risk');let sortDirection=$state<BulkSortDirection>(-1);let page=$state(1);
  let sourceFilter=$state<BulkSourceFilter>('');let lifecycleFilter=$state('');let ageFilter=$state<BulkAgeFilter>('');let mailFilter=$state<BulkMailFilter>('');let registrarFilter=$state('');let caseDispositionFilter=$state('');let groupBy=$state<BulkGroupBy>('');
  let status = $state(''); let controller: AbortController|null = null; let pauseResolvers: Array<()=>void> = [];
  let activeScanSnapshot: (()=>ScanResult[])|null = null;
  let indicatorFormat=$state<'domains'|'hosts'|'dnsmasq'|'rpz'|'stix'|'misp'>('domains');let indicatorWildcards=$state(false);let indicatorStatus=$state('');
  let watchlistName = $state(''); let saveStatus = $state('');
  let profile = $state<BrandProfile|null>(null);
  let shortlist=$state<ShortlistRecord[]>([]);let shortlistStatus=$state('');let draftStatus=$state('');
  let cases=$state<CaseRecord[]>([]);let caseStatus=$state('');
  let retainedRelationshipIds=$state<Set<string>>(new Set());let relationshipRetentionStatus=$state('');
  let bulkSessions=$state<BulkSession[]>([]);let bulkSessionName=$state('');let bulkSessionStatus=$state('');let currentBulkSessionId=$state('');let scanStartedAt=$state('');
  let bulkReviewStore=$state<BulkReviewStore>({schema:BULK_REVIEW_SCHEMA,version:BULK_REVIEW_SCHEMA_VERSION,presets:[],rows:[]});let reviewStateFilter=$state<BulkReviewFilter>('');let bulkReviewStatus=$state('');
  let retryStatus=$state('');
  let localContextStatus=$state('');
  const capabilityReport=getContext<CapabilityGetter>(CAPABILITY_CONTEXT);
  const lookupDisabled=$derived(disabledCapability(capabilityReport?.()||null,'lookup'));
  const scanLimitations=$derived(disabledCapabilities(capabilityReport?.()||null,mode==='fast'?['rdap','availability']:['rdap','whois','availability','dns_intelligence','website_probe','tls_intelligence']));
  const caseByDomain=$derived(new Map(cases.map(record=>[record.domain,record])));
  const mutationLabels=MUTATION_LABELS as Record<string,string>;
  const mutationOptions=$derived([...new Set(results.flatMap(row=>row.mutationTypes))].sort((a,b)=>(mutationLabels[a]||a).localeCompare(mutationLabels[b]||b)));
  const triageRows=$derived(results.map((row)=>toBulkRouteTriageRow(row,caseByDomain.get(row.domain)||null)));
  const advancedFilters=$derived<BulkAdvancedFilters>({source:sourceFilter,lifecycle:lifecycleFilter,age:ageFilter,mail:mailFilter,registrar:registrarFilter,caseDisposition:caseDispositionFilter});
  const bulkReviewStateByDomain=$derived(new Map(bulkReviewStore.rows.map((row)=>[row.domain,row.state])));
  const filtered = $derived.by(()=>sortBulkResults(results.filter((row)=>matchesBulkRouteFilter(row,{filter,mutationFilter,signalFilters})&&matchesBulkAdvancedFilters(toBulkRouteTriageRow(row,caseByDomain.get(row.domain)||null),advancedFilters)&&matchesReviewState(row.domain)),sortKey,sortDirection));
  const mailExposureReport=$derived(buildBulkMailExposureReport(filtered.map(toBulkSessionResult),{
    observedAt:scanStartedAt,
    officialDomains:profile?.officialDomains||[],
    profile:profile?.mailProtectionProfile||null,
  }));
  const advancedFilterOptions=$derived(bulkAdvancedFilterOptions(triageRows));
  const groupSummary=$derived(buildBulkTriageGroups(filtered.map((row)=>toBulkRouteTriageRow(row,caseByDomain.get(row.domain)||null)),groupBy));
  const shortlistedDomains=$derived(new Set(shortlist.map(item=>item.domain)));
  const reviewedIndicatorRows=$derived(filtered.map((row)=>({
    ...row,
    analystDisposition:caseByDomain.get(row.domain)?.disposition||'unreviewed',
  })));
  const indicatorPreflight=$derived(prepareDefensiveIndicatorExport(reviewedIndicatorRows,{
    selectedDomains:[...shortlistedDomains],
    officialDomains:profile?.officialDomains||[],
    allowlistedDomains:profile?.allowlistedDomains||[],
  }));
  const indicatorCount=$derived(indicatorPreflight.domains.length);
  const selectedIndicatorCount=$derived(filtered.filter((row)=>shortlistedDomains.has(row.domain)).length);
  const selectedRows=$derived(filtered.filter((row)=>shortlistedDomains.has(row.domain)));
  const comparisonCandidates=$derived(selectedRows.length===2?selectedRows:results.length===2?results:[]);
  const domainComparison=$derived(comparisonCandidates.length===2?buildBulkDomainComparison(toBulkSessionResult(comparisonCandidates[0]!),toBulkSessionResult(comparisonCandidates[1]!),scanStartedAt):null);
  const retryCandidates=$derived(selectedRows.length?selectedRows:filtered);
  const retryPlan=$derived(buildBulkRetryPlan(retryCandidates.map(toBulkSessionResult),mode,scanStartedAt));
  const cockpitRows=$derived<BulkReviewCockpitRow[]>(filtered.map((row)=>{const caseRecord=caseByDomain.get(row.domain)||null;return{resultIndex:results.indexOf(row),domain:row.domain,availability:row.availability,confidence:row.confidence,risk:row.risk,opportunity:row.opportunity,activity:row.activity,registrar:row.registrar,reviewState:bulkReviewStateByDomain.get(row.domain)||'unreviewed',shortlisted:shortlistedDomains.has(row.domain),sourceCoverage:row.sourceCoverage,error:row.error,caseRecord:caseRecord?{id:caseRecord.id,disposition:caseRecord.disposition}:null};}));
  const counts=$derived(countBulkRouteFilters(results));
  const pageCount=$derived(Math.max(1,Math.ceil(filtered.length/PAGE_SIZE)));
  const currentPage=$derived(Math.min(page,pageCount));
  const visibleResults=$derived(filtered.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE));
  const resultRows=$derived(buildBulkResultDisplayRows({visibleResults,allResults:results,shortlistedDomains,caseByDomain,reviewStateByDomain:bulkReviewStateByDomain,mutationLabels}));
  const provenanceByDomain=$derived(new Map((handoff?.candidates||[]).map(candidate=>[candidate.domain.toLowerCase(),candidate])));
  const relationshipSummary=$derived(buildScanRelationships(running?[]:results));
  const parsedInput=$derived(parseDomainInput(input));
  const scanProgress=$derived(buildBulkProgressEstimate(completed,total,scanElapsedMs));
  const activeConcurrency=$derived(bulkConcurrency(mode,pacing));
  $effect(()=>{if(routePage.url.searchParams.has('investigation')&&!running&&results.length)selectInvestigationGuideReviewDomains(results.map((row)=>row.domain));});
  const coverage=$derived.by(()=>{if(!handoff||!['typosquat','keyword'].includes(handoff.source))return null;const generated=handoff.generatedCandidates||handoff.candidates;const trusted=new Set(generated.filter(candidate=>isDomainAllowlisted(candidate.domain,profile)).map(candidate=>candidate.domain));return buildCoverageReport(results.map(row=>({...row.saved,domain:row.domain,availability:row.availability,mutationTypes:row.mutationTypes})),generated,trusted,mutationLabels);});

  async function initializeLocalContext(handoffNavigation:boolean,investigationTarget:string,restored:ReturnType<typeof readBulkWorkflowState<ScanResult>>){
    handoff=loadCandidateHandoff();
    if(handoffNavigation&&handoff)input=handoff.candidates.map(c=>c.domain).join('\n');
    else if(investigationTarget&&!restored){input=investigationTarget;results=[];completed=0;total=0;status='Loaded the guided-investigation target. Add only relevant comparison domains before scanning.';}
    try{
      let retained;
      [profile,shortlist,cases,retained,bulkSessions,bulkReviewStore]=await Promise.all([activeProfile(),loadShortlist(),loadCases(),loadRelationshipObservations(),loadBulkSessions(),loadBulkReviewStore()]);
      retainedRelationshipIds=new Set(retained.map((item)=>item.id));
    }catch(cause){
      localContextStatus='Some browser-local profile, shortlist, case, relationship, or saved-session context could not be loaded, including saved review-queue state. Scan results and restored queue state remain available; reload to retry the saved context.';
      if(!isExpectedBrowserLocalDataFailure(cause))throw cause;
    }
  }

  onMount(()=>{
    const handoffNavigation=routePage.url.searchParams.has('source');
    const investigationTarget=parseDomainInput(routePage.url.searchParams.get('investigation')||'').entries[0]||'';
    const activeGuide=investigationTarget?loadInvestigationGuide():null;
    const guideContext=investigationTarget&&activeGuide?.domain===investigationTarget?`${activeGuide.recipeId}\u0000${activeGuide.domain}\u0000${activeGuide.createdAt}`:investigationTarget?`target\u0000${investigationTarget}`:'';
    const candidateState=handoffNavigation?null:readBulkWorkflowState<ScanResult>();
    const restored=candidateState&&(!investigationTarget||candidateState.guideContext===guideContext)?candidateState:null;
    if(restored){input=restored.input;mode=restored.mode;pacing=normalizeBulkPacing(restored.pacing);completed=restored.completed;total=restored.total;results=restored.results;filter=restored.filter;mutationFilter=restored.mutationFilter;signalFilters=new Set(restored.signalFilters);sourceFilter=restored.sourceFilter||'';lifecycleFilter=restored.lifecycleFilter||'';ageFilter=restored.ageFilter||'';mailFilter=restored.mailFilter||'';registrarFilter=restored.registrarFilter||'';caseDispositionFilter=restored.caseDispositionFilter||'';groupBy=restored.groupBy||'';sortKey=restored.sortKey;sortDirection=restored.sortDirection;page=restored.page;status=restored.status;indicatorFormat=restored.indicatorFormat;indicatorWildcards=restored.indicatorWildcards===true;watchlistName=restored.watchlistName;}
    void initializeLocalContext(handoffNavigation,investigationTarget,restored);
    return()=>{
      resume();
      controller?.abort();
      const retainedResults=activeScanSnapshot?.()||results;
      writeBulkWorkflowState({guideContext,input,mode,pacing,completed,total,results:retainedResults,filter,mutationFilter,signalFilters:[...signalFilters],sourceFilter,lifecycleFilter,ageFilter,mailFilter,registrarFilter,caseDispositionFilter,groupBy,sortKey,sortDirection,page,status:running?`Stopped after ${completed} of ${total} lookups when you left Bulk. Completed results were retained.`:status,indicatorFormat,indicatorWildcards,watchlistName});
    };
  });
  function prunedNote(pruned:number){return pruned?` (pruned ${pruned} old evidence snapshot${pruned===1?'':'s'} to stay within storage)`:'';}
  async function trackCase(row:ScanResult){try{const s=row.saved;const{record,created,pruned}=await openCase({domain:row.domain,source:'bulk',evidence:{scanDepth:s.scanDepth,availability:s.availability,confidence:row.confidence,riskModelVersion:s.riskModelVersion,riskScore:row.risk,riskFactors:s.riskFactors,opportunityScore:row.opportunity,registrar:row.registrar&&row.registrar!=='—'?row.registrar:null,createdDate:s.createdDate,expiryDate:s.expiryDate,nameservers:s.nameservers,hasMx:s.hasMx,hasSpf:s.hasSpf,hasDmarc:s.hasDmarc,activityStatus:s.activityStatus,pageTitle:s.pageTitle,...(normalizeHttpSummary(s)||{}),faviconMatch:s.faviconMatch,faviconNearMatch:s.faviconNearMatch,reusesOfficialAssets:s.reusesOfficialAssets,hasPasswordField:s.hasPasswordField,phishingLanguageMatch:s.phishingLanguageMatch,mutationTypes:s.mutationTypes}});cases=await loadCases();caseStatus=`${created?`Opened a case for ${record.domain}.`:`${record.domain} already has a case.`}${prunedNote(pruned)}`;}catch(cause){caseStatus=cause instanceof Error?cause.message:'Could not open the case.';}}
  async function setRowDisposition(row:ScanResult,value:string){const record=caseByDomain.get(row.domain);if(!record)return;try{const{pruned}=await editCase(record.id,{disposition:value});cases=await loadCases();caseStatus=`Marked ${row.domain} as ${dispositionLabel(value)}.${prunedNote(pruned)}`;}catch(cause){caseStatus=cause instanceof Error?cause.message:'Could not update the case.';}}
  function parseDomains(){return parsedInput.entries.map((value:string)=>value.toLowerCase());}
  function provenance(domain:string):Candidate|undefined{return provenanceByDomain.get(domain.toLowerCase());}
  function matchesReviewState(domain:string){const state=bulkReviewStateByDomain.get(domain)||'unreviewed';return !reviewStateFilter||state===reviewStateFilter;}
  function setFilter(next:BulkPrimaryFilter){filter=next;page=1;}
  function toggleSignal(signal:string){const next=new Set(signalFilters);next.has(signal)?next.delete(signal):next.add(signal);signalFilters=next;page=1;}
  function clearFilters(){filter='all';mutationFilter='';signalFilters=new Set();sourceFilter='';lifecycleFilter='';ageFilter='';mailFilter='';registrarFilter='';caseDispositionFilter='';reviewStateFilter='';page=1;}
  function currentBulkReviewView():BulkReviewPresetView{return{primaryFilter:filter,mutationFilter,signalFilters:[...signalFilters],sourceFilter,lifecycleFilter,ageFilter,mailFilter,registrarFilter,caseDispositionFilter,reviewStateFilter,groupBy,sortKey,sortDirection};}
  async function saveCurrentBulkReviewView(name:string,view:BulkReviewPresetView){try{bulkReviewStore=await saveBulkReviewPreset({name,view});bulkReviewStatus=`Saved the “${name.trim()}” view.`;}catch(cause){bulkReviewStatus=cause instanceof Error?cause.message:'Could not save the review view.';}}
  function loadBulkReviewView(preset:BulkReviewPreset){const view=preset.view;filter=view.primaryFilter as BulkPrimaryFilter;mutationFilter=view.mutationFilter;signalFilters=new Set(view.signalFilters);sourceFilter=view.sourceFilter as BulkSourceFilter;lifecycleFilter=view.lifecycleFilter;ageFilter=view.ageFilter as BulkAgeFilter;mailFilter=view.mailFilter as BulkMailFilter;registrarFilter=view.registrarFilter;caseDispositionFilter=view.caseDispositionFilter;reviewStateFilter=view.reviewStateFilter;groupBy=view.groupBy as BulkGroupBy;sortKey=view.sortKey;sortDirection=view.sortDirection;page=1;bulkReviewStatus=`Loaded the ${preset.name} review view. No scan was started.`;}
  async function removeBulkReviewView(preset:BulkReviewPreset){try{bulkReviewStore=await deleteBulkReviewPreset(preset.id);bulkReviewStatus=`Deleted the ${preset.name} review view.`;}catch(cause){bulkReviewStatus=cause instanceof Error?cause.message:'Could not delete the review view.';}}
  async function setBulkReviewState(row:ScanResult,state:string){const previous=bulkReviewStateByDomain.get(row.domain)||'unreviewed';if(previous===state)return;try{bulkReviewStore=await saveBulkReviewRowState(row.domain,state as BulkReviewState);bulkReviewStatus=`Marked ${row.domain} as ${state}. Case disposition was not changed.`;registerAnalystUndo({kind:'bulk_review_state',action:`Review state changed to ${state}`,affectedRecord:row.domain,undo:async()=>{bulkReviewStore=await saveBulkReviewRowState(row.domain,previous);return `Restored ${row.domain} to ${previous}.`;}});}catch(cause){bulkReviewStatus=cause instanceof Error?cause.message:'Could not update the review state.';}}
  function setSort(key:BulkSortKey){if(sortKey===key)sortDirection=sortDirection===1?-1:1;else{sortKey=key;sortDirection=defaultBulkSortDirection(key);}page=1;}
  function setSortKey(key:BulkSortKey){if(sortKey!==key){sortKey=key;sortDirection=defaultBulkSortDirection(key);}page=1;}
  function setSortDirection(direction:BulkSortDirection){sortDirection=direction;page=1;}
  function loadDomains(domains:string[]){input=domains.join('\n');status=`Loaded ${domains.length} related domains into the scan queue.`;document.querySelector('.queue')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}
  async function retainObservation(relationship:Record<string,unknown>){
    relationshipRetentionStatus='';
    try{
      const result=await retainRelationshipObservation(relationship,{
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
  async function toggleSaved(row:ScanResult){const previous=shortlist.find((item)=>item.domain===row.domain);try{const added=await toggleShortlist({...row.saved,riskScore:row.risk,opportunityScore:row.opportunity,savedAt:new Date().toISOString()});shortlist=await loadShortlist();shortlistStatus=added?`Added ${row.domain} to the shortlist.`:`Removed ${row.domain} from the shortlist.`;registerAnalystUndo({kind:'shortlist_membership',action:added?'Added to shortlist':'Removed from shortlist',affectedRecord:row.domain,undo:async()=>{if(previous)await setShortlistSelection([previous],true);else await setShortlistSelection([shortlistPayload(row)],false);shortlist=await loadShortlist();return `${row.domain} ${previous?'restored to':'removed from'} the shortlist.`;}});}catch(cause){shortlistStatus=cause instanceof Error?cause.message:'Could not update shortlist.';}}
  function shortlistPayload(row:ScanResult){return{...row.saved,riskScore:row.risk,opportunityScore:row.opportunity,savedAt:new Date().toISOString()};}
  async function selectRows(rows:ScanResult[],selected=true){const affected=rows.slice(0,500);const affectedDomains=new Set(affected.map((row)=>row.domain));const previous=shortlist.filter((item)=>affectedDomains.has(item.domain));try{const result=await setShortlistSelection(affected.map(shortlistPayload),selected);shortlist=await loadShortlist();shortlistStatus=selected?`Selected ${result.added} new and refreshed ${result.updated} existing domain${result.added+result.updated===1?'':'s'}${result.skipped?`; skipped ${result.skipped} invalid or over-limit row${result.skipped===1?'':'s'}`:''}.`:`Removed ${result.removed} domain${result.removed===1?'':'s'} from the shortlist.`;if(result.added+result.updated+result.removed>0)registerAnalystUndo({kind:'shortlist_membership',action:selected?'Updated shortlist selection':'Removed shortlist selection',affectedRecord:`${affected.length} domain${affected.length===1?'':'s'}`,undo:async()=>{await setShortlistSelection(affected.map(shortlistPayload),false);if(previous.length)await setShortlistSelection(previous,true);shortlist=await loadShortlist();return `Restored the prior shortlist membership for ${affected.length} domain${affected.length===1?'':'s'}.`;}});}catch(cause){shortlistStatus=cause instanceof Error?cause.message:'Could not update the selection.';}}
  async function selectDomains(domains:string[]){const wanted=new Set(domains);await selectRows(filtered.filter((row)=>wanted.has(row.domain)),true);}
  async function selectFiltered(){await selectRows(filtered,true);}
  async function clearFilteredSelection(){await selectRows(filtered,false);}
  async function removeAllShortlisted(){if(!shortlist.length||!confirm('Remove every domain from the shortlist?'))return;try{await clearShortlist();shortlist=[];shortlistStatus='Shortlist cleared.';}catch(cause){shortlistStatus=cause instanceof Error?cause.message:'Could not clear the shortlist.';}}
  async function downloadShortlist(){try{await exportShortlist();}catch(cause){shortlistStatus=cause instanceof Error?cause.message:'Could not export the shortlist.';}}
  function loadShortlisted(){loadDomains(shortlist.map(item=>item.domain));}
  async function copyDraft(text:string,label:string){try{await navigator.clipboard.writeText(text);draftStatus=`Copied ${label} to the clipboard.`;}catch{draftStatus='Clipboard access was unavailable. Use the email draft link instead.';}}
  async function importShortlistFile(event:Event){const input=event.currentTarget as HTMLInputElement,file=input.files?.[0];if(!file)return;try{if(file.size>MAX_SHORTLIST_IMPORT_BYTES)throw new Error('Shortlist imports are limited to 2 MB.');const result=await importShortlist(JSON.parse(await file.text()));shortlist=await loadShortlist();const skipped=result.skipped?`; skipped ${result.skipped} invalid, duplicate, or over-limit entr${result.skipped===1?'y':'ies'}`:'';shortlistStatus=`Imported ${result.added} new and ${result.updated} updated shortlist entries${skipped}.`;}catch(cause){shortlistStatus=cause instanceof Error?cause.message:'Shortlist import failed';}finally{input.value='';}}
  async function importDomainFile(event:Event){const control=event.currentTarget as HTMLInputElement,file=control.files?.[0];if(!file)return;try{if(file.size>MAX_DOMAIN_IMPORT_BYTES)throw new Error('Domain-list imports are limited to 2 MB.');const parsed=parseDomainInput(await file.text());if(!parsed.entries.length)throw new Error('No domain entries were found in that file.');input=parsed.entries.join('\n');status=`Loaded ${parsed.entries.length} unique entries from ${file.name}${parsed.usedHeader?' using its domain column':''}${parsed.duplicates?`; removed ${parsed.duplicates} duplicate${parsed.duplicates===1?'':'s'}`:''}.`;}catch(cause){status=cause instanceof Error?cause.message:'Could not import the domain list.';}finally{control.value='';}}
  function exportCoverage(){if(!coverage)return;const rows=[['dimension','group','total','protected','registered','available','unknown','coverage_percent'],...coverage.mutationGroups.map((group)=>['mutation',group.label,group.total,group.protected,group.registered,group.available,group.unknown,group.coveragePercent]),...coverage.tldGroups.map((group)=>['tld',group.label,group.total,group.protected,group.registered,group.available,group.unknown,group.coveragePercent])];const url=URL.createObjectURL(new Blob([rowsToCsv(rows)],{type:'text/csv'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`defensive-registration-coverage-${new Date().toISOString().slice(0,10)}.csv`;anchor.click();URL.revokeObjectURL(url);}
  async function waitWhilePaused(){if(!paused)return;await new Promise<void>(resolve=>pauseResolvers.push(resolve));}
  function resume(){paused=false;for(const resolve of pauseResolvers.splice(0))resolve();}
  function togglePause(){if(paused)resume();else paused=true;}
  function cancel(){resume();controller?.abort();status=`Cancelled after ${completed} of ${total} lookups.`;}
  async function fetchLookup(domain:string,signal:AbortSignal):Promise<CompactLookupHttpResponse>{return fetchCompactBulkLookup(domain,mode,signal);}
  function normalize(domain:string,body:CompactLookupHttpResponse):ScanResult {const av=lookupRecord(body.availability);const canonicalDomain=body.availability.domain;const candidate=provenance(domain)||provenance(canonicalDomain);const matched=profileSignals(canonicalDomain,av,profile);const idn=analyzeDomainIdn(canonicalDomain,profile?.officialDomains||[]);const scoring={...av,...matched,availability:body.availability.state,mutationTypes:candidate?.mutationTypes||[]};const riskExplanation=explainRiskScore(scoring);const risk=riskExplanation?.score??null;const opportunity=computeOpportunityScore(scoring);const nameservers=boundedStrings(av.nameservers);const registrant=compactContact(av.registrant);const abuse=plainRecord(av.abuse);const abuseEmail=boundedText(abuse?.email,320);const hasMx=nullableBoolean(av.hasMx);const hasNullMx=nullableBoolean(av.hasNullMx);const hasSpf=nullableBoolean(av.hasSpf);const hasDmarc=nullableBoolean(av.hasDmarc);const activityStatus=boundedText(av.activityStatus,40);const privacyProtected=nullableBoolean(av.privacyProtected);const abuseEvidence=abuseEmail?{abuseEmail}:null;const httpSummary=compactHttpObservation(av.http)||{};const relationship=relationshipObservation(av,profile?.officialDomains||[]);const saved:SavedScanRecord={domain:canonicalDomain,scanDepth:mode,availability:body.availability.state,registrarName:entityDisplayName(av.registrar)||'—',nameservers,createdDate:boundedText(av.createdDate,64),expiryDate:boundedText(av.expiryDate,64),privacyProtected,hasMx,hasNullMx,hasSpf,hasDmarc,activityStatus,pageTitle:boundedText(av.pageTitle,300),...httpSummary,faviconHash:boundedText(av.faviconHash,64),faviconPHash:boundedText(av.faviconPHash,64),faviconMatch:matched.faviconMatch,faviconNearMatch:matched.faviconNearMatch,reusesOfficialAssets:matched.reusesOfficialAssets,hasPasswordField:nullableBoolean(av.hasPasswordField),phishingLanguageMatch:boundedText(av.phishingLanguageMatch,300),riskModelVersion:riskExplanation?.modelVersion??null,riskScore:risk,riskFactors:riskExplanation?.factors.map((factor)=>({label:factor.label,points:factor.delta}))||[],mutationTypes:candidate?.mutationTypes||[]};return{domain:canonicalDomain,status:'complete',availability:saved.availability,confidence:body.availability.confidence,registrar:saved.registrarName,activity:formatActivityCell(activityStatus,hasMx,hasSpf,hasDmarc),risk,opportunity,mutationTypes:candidate?.mutationTypes||[],trusted:matched.trusted,error:'',saved,nameservers,faviconHash:saved.faviconHash,faviconPHash:saved.faviconPHash,faviconMatch:matched.faviconMatch,faviconNearMatch:matched.faviconNearMatch,reusesOfficialAssets:matched.reusesOfficialAssets,hasPasswordField:saved.hasPasswordField===true,phishingLanguageMatch:saved.phishingLanguageMatch??null,registrant,abuseEvidence,ct:candidate?.certificateTransparency||null,idn,dns:compactDnsEvidence(av.dns),dnssec:boundedText(av.dnssec,40),relationship,sourceCoverage:compactSourceCoverage(body,av)};}
  function failedResult(domain:string,message:string):ScanResult{const candidate=provenance(domain);const mutationTypes=candidate?.mutationTypes||[];const idn=analyzeDomainIdn(domain,profile?.officialDomains||[]);return{domain:idn?.asciiDomain||domain,status:'error',availability:'error',confidence:'unknown',registrar:'—',activity:'—',risk:null,opportunity:null,mutationTypes,trusted:profileDomainKind(domain,profile),error:message,saved:{domain:idn?.asciiDomain||domain,scanDepth:mode,availability:'error',registrarName:'—',nameservers:[],faviconHash:null,faviconPHash:null,riskFactors:[],mutationTypes,error:message},nameservers:[],faviconHash:null,faviconPHash:null,faviconMatch:false,faviconNearMatch:false,reusesOfficialAssets:false,hasPasswordField:false,phishingLanguageMatch:null,registrant:null,abuseEvidence:null,ct:candidate?.certificateTransparency||null,idn,dns:null,dnssec:null,relationship:relationshipObservation({},[]),sourceCoverage:[{source:'lookup',state:'error'}]};}
  async function saveCurrentBulkSession(){const name=bulkSessionName.trim();const domains=parseDomains();if(!name||!domains.length||!results.length){bulkSessionStatus='Enter a session name and complete at least one result before saving.';return;}try{const settled=new Set(results.map((row)=>row.domain));const isComplete=domains.every((domain)=>settled.has(domain));const now=new Date().toISOString();const result=await saveBulkSession({id:currentBulkSessionId||createBulkSessionId(),name,mode,state:isComplete?'complete':status.startsWith('Cancelled')?'cancelled':'partial',inputDigest:await bulkSessionInputDigest(domains,mode),domains,results:results.map(toBulkSessionResult),startedAt:scanStartedAt||now,updatedAt:now,completedAt:isComplete?now:null});currentBulkSessionId=result.session.id;bulkSessions=await loadBulkSessions();bulkSessionStatus=`${result.added?'Saved':'Updated'} ${result.session.name}.${result.pruned?` Pruned ${result.pruned} older session${result.pruned===1?'':'s'} to stay within storage.`:''}`;}catch(cause){bulkSessionStatus=cause instanceof Error?cause.message:'Could not save the Bulk session.';}}
  function loadSavedBulkSession(session:BulkSession){resume();controller?.abort();currentBulkSessionId=session.id;bulkSessionName=session.name;mode=session.mode;input=session.domains.join('\n');results=session.results.map((row)=>fromBulkSessionResult(row,profile?.officialDomains||[]));completed=results.length;total=session.domains.length;page=1;scanStartedAt=session.startedAt;status=`Loaded ${session.name}: ${results.length} of ${session.domains.length} rows settled. Contact records were not retained.`;requestAnimationFrame(()=>document.querySelector('#results')?.scrollIntoView({behavior:'auto'}));}
  async function resumeSavedBulkSession(session:BulkSession){loadSavedBulkSession(session);const settled=new Set(session.results.map((row)=>row.domain));const pending=session.domains.filter((domain)=>!settled.has(domain));if(!pending.length){bulkSessionStatus='Every queued domain already has a settled result. Use Retry failed to repeat error rows.';return;}await run(pending,false);await saveCurrentBulkSession();}
  async function removeSavedBulkSession(session:BulkSession){if(!confirm(`Delete the saved session “${session.name}”?`))return;try{bulkSessions=await deleteBulkSession(session.id);if(currentBulkSessionId===session.id){currentBulkSessionId='';bulkSessionName='';}bulkSessionStatus=`Deleted ${session.name}.`;}catch(cause){bulkSessionStatus=cause instanceof Error?cause.message:'Could not delete the Bulk session.';}}
  async function downloadBulkSessions(){try{await exportBulkSessions();bulkSessionStatus=`Exported ${bulkSessions.length} saved session${bulkSessions.length===1?'':'s'}.`;}catch(cause){bulkSessionStatus=cause instanceof Error?cause.message:'Could not export saved Bulk sessions.';}}
  function resultAt(index:number){return index>=0&&index<results.length?results[index]:null;}
  function toggleSavedAt(index:number){const row=resultAt(index);if(row)toggleSaved(row);}
  function trackCaseAt(index:number){const row=resultAt(index);if(row)trackCase(row);}
  function setDispositionAt(index:number,value:string){const row=resultAt(index);if(row)setRowDisposition(row,value);}
  function setReviewStateAt(index:number,value:string){const row=resultAt(index);if(row)void setBulkReviewState(row,value);}
  async function inspectAt(index:number){const row=resultAt(index);if(!row)return;selectInvestigationGuideFocusDomain(row.domain);await goto(`/lookup?q=${encodeURIComponent(row.domain)}&depth=deep#query`);}
  async function run(domains:string[],replace=true,preservePrior=false):Promise<string[]>{
    const limit=mode==='fast'?2000:200;
    if(!domains.length){status='Enter at least one domain.';return[];}
    if(domains.length>limit){status=`${mode==='fast'?'Fast':'Deep'} scans are limited to ${limit} domains.`;return[];}
    const scanController=new AbortController();
    const targetDomains=new Set(domains);
    const priorByDomain=new Map(results.filter((row)=>targetDomains.has(row.domain)).map((row)=>[row.domain,row]));
    const baseResults=replace?[]:results.filter((row)=>!targetDomains.has(row.domain));
    const pendingResults:Array<ScanResult|undefined>=preservePrior?domains.map((domain)=>priorByDomain.get(domain)):new Array(domains.length);
    const preservedReasons:string[]=[];
    let cursor=0;
    let publishTimer:ReturnType<typeof setTimeout>|null=null;
    const snapshot=()=>[...baseResults,...pendingResults.filter((row):row is ScanResult=>Boolean(row))];
    activeScanSnapshot=snapshot;
    const publish=()=>{if(publishTimer){clearTimeout(publishTimer);publishTimer=null;}results=snapshot();};
    const schedulePublish=()=>{if(!publishTimer)publishTimer=setTimeout(publish,RESULT_PUBLISH_MS);};
    controller=scanController;running=true;paused=false;completed=0;total=domains.length;page=1;scanElapsedMs=0;
    if(replace)results=[];
    status=`Scanning ${total} domain${total===1?'':'s'}…`;
    const concurrency=bulkConcurrency(mode,pacing);
    const startedAt=performance.now();
    const worker=async()=>{while(cursor<domains.length&&!scanController.signal.aborted){await waitWhilePaused();if(scanController.signal.aborted)break;const index=cursor++,domain=domains[index];if(domain===undefined)break;let next:ScanResult;try{const body=await fetchLookup(domain,scanController.signal);next=normalize(domain,body);if(mode==='deep'&&body.availability?.deepScanComplete===false)next.saved.scanDepth='fast';}catch(cause){if(cause instanceof DOMException&&cause.name==='AbortError')break;next=failedResult(domain,cause instanceof Error?cause.message:'Lookup failed');}const prior=priorByDomain.get(domain);if(preservePrior&&prior){const decision=preservePriorBulkResult(toBulkSessionResult(prior),toBulkSessionResult(next));if(decision.preserve){pendingResults[index]=prior;preservedReasons.push(`${domain}: ${decision.reason}`);}else pendingResults[index]=next;}else pendingResults[index]=next;completed+=1;scanElapsedMs=performance.now()-startedAt;schedulePublish();}};
    await Promise.all(Array.from({length:Math.min(concurrency,domains.length)},worker));
    publish();activeScanSnapshot=null;running=false;controller=null;
    if(scanController.signal.aborted)return preservedReasons;
    status=`Completed ${completed} of ${total} lookups.${preservedReasons.length?` Retained ${preservedReasons.length} stronger prior result${preservedReasons.length===1?'':'s'}.`:''}`;
    return preservedReasons;
  }
  async function start(){if(lookupDisabled){status=lookupDisabled.reason||'Lookup is disabled by deployment policy.';return;}if(currentBulkSessionId)bulkSessionName='';currentBulkSessionId='';scanStartedAt=new Date().toISOString();await run(parseDomains(),true);}
  async function retryErrors(){const domains=results.filter(r=>r.status==='error').map(r=>r.domain);if(!domains.length||running)return;const plan=buildBulkRetryPlan(results.filter((row)=>domains.includes(row.domain)).map(toBulkSessionResult),mode,scanStartedAt);if(!confirm(`Retry ${plan.lookupRequests} failed lookup${plan.lookupRequests===1?'':'s'} using the ${mode} profile? Destinations: ${plan.destinations.join(', ')}.`))return;retryStatus=`Running ${plan.lookupRequests} reviewed retry${plan.lookupRequests===1?'':'ies'}.`;const preserved=await run(domains,false,true);retryStatus=`Retry completed.${preserved.length?` ${preserved.length} stronger prior result${preserved.length===1?' was':'s were'} retained.`:''}`;}
  function exportRowsCsv(selected:ScanResult[],scope='bulk'){const header=['domain','unicode_domain','idn_scripts','idn_mixed_script','idn_official_skeleton_matches','availability','confidence','profile_status','registrar','activity','risk','risk_model_version','risk_factors','opportunity','mutations','error','dns_status','dnssec','dns_a','dns_aaaa','dns_cname','dns_caa','ct_first_observed','ct_last_observed','ct_certificate_count','ct_hostnames'];const rows=selected.map(r=>[r.domain,r.idn?.hasIdn?r.idn.unicodeDomain:'',r.idn?.scripts?.join('|')||'',r.idn?.mixedScript?'true':'false',r.idn?.referenceMatches?.map((match)=>match.asciiDomain).join('|')||'',r.availability,r.confidence,r.trusted||'',r.registrar,r.activity,r.risk??'',r.saved.riskModelVersion??'',r.saved.riskFactors?.map((factor)=>`${factor.label} ${Number(factor.points)>=0?'+':''}${factor.points}`).join('; ')||'',r.opportunity??'',r.mutationTypes.join('|'),r.error,r.dns?.status||'',r.dnssec||'',r.dns?.records.a.join('|')||'',r.dns?.records.aaaa.join('|')||'',r.dns?.records.cname.join('|')||'',r.dns?.records.caa.map((item)=>`${item.critical} ${item.tag} ${item.value}`).join('|')||'',...ctCsvFields(r.ct)]);const url=URL.createObjectURL(new Blob([rowsToCsv([header,...rows])],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download=`whoisleuth-${scope}-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url);}
  function exportCsv(){exportRowsCsv(results);}
  async function exportSelectedCsv(){if(!selectedRows.length)return;const generatedAt=new Date().toISOString();exportRowsCsv(selectedRows,'selected');const exported=await buildBulkReviewManifest({rows:selectedRows.map(toBulkSessionResult),reviewStates:bulkReviewStore.rows,view:currentBulkReviewView(),lookupProfile:mode,observedAt:scanStartedAt,generatedAt});downloadText(exported.content,exported.filename,'application/json');bulkReviewStatus=`Exported ${selectedRows.length} selected row${selectedRows.length===1?'':'s'} with an integrity-stamped review manifest.`;}
  async function deepRescanSelected(){const domains=selectedRows.slice(0,200).map((row)=>row.domain);if(!domains.length||running)return;const nextMode:'deep'='deep';const destinations=buildBulkRetryPlan(selectedRows.map(toBulkSessionResult),nextMode,scanStartedAt).destinations;if(!confirm(`Deep rescan ${domains.length} explicitly selected domain${domains.length===1?'':'s'}? Destinations: ${destinations.join(', ')}.`))return;mode=nextMode;retryStatus=`Running a reviewed Deep rescan of ${domains.length} selected domain${domains.length===1?'':'s'}.`;const preserved=await run(domains,false,true);retryStatus=`Deep rescan completed.${preserved.length?` ${preserved.length} stronger prior result${preserved.length===1?' was':'s were'} retained.`:''}`;}
  async function executeReviewedRetry(){if(!retryPlan.rows.length||running)return;const domains=retryPlan.rows.map((row)=>row.domain);retryStatus=`Running ${domains.length} reviewed ${retryPlan.mode} retr${domains.length===1?'y':'ies'}.`;const preserved=await run(domains,false,true);retryStatus=`Reviewed retry completed.${preserved.length?` ${preserved.length} stronger prior result${preserved.length===1?' was':'s were'} retained.`:''}`;}
  async function exportDomainComparison(){if(!domainComparison)return;const exported=await buildBulkDomainComparisonExport(domainComparison);downloadText(exported.content,exported.filename,'application/json');bulkReviewStatus='Exported the two-domain evidence comparison with an integrity digest.';}
  async function exportMailExposure(){const exported=await buildBulkMailExposureExport(mailExposureReport);downloadText(exported.content,exported.filename,'application/json');bulkReviewStatus='Exported the filtered mail-exposure review with an integrity digest.';}
  async function createCasesSelected(){const rows=selectedRows.slice(0,50);if(!rows.length||!confirm(`Create or refresh cases for ${rows.length} selected domain${rows.length===1?'':'s'}?`))return;for(const row of rows)await trackCase(row);caseStatus=`Reviewed ${rows.length} selected domain${rows.length===1?'':'s'} for case creation${selectedRows.length>rows.length?'; the action was capped at 50':''}.`;}
  async function setSelectedDisposition(value:string){const records=selectedRows.map((row)=>caseByDomain.get(row.domain)).filter((record):record is CaseRecord=>Boolean(record)).slice(0,100);if(!records.length)return;for(const record of records)await editCase(record.id,{disposition:value});cases=await loadCases();caseStatus=`Marked ${records.length} selected case${records.length===1?'':'s'} as ${dispositionLabel(value)}${selectedRows.length>records.length?'; only existing cases were changed':''}.`;}
  function downloadText(content:string,filename:string,mimeType:string){const url=URL.createObjectURL(new Blob([content],{type:mimeType}));const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();URL.revokeObjectURL(url);}
  function exportDefensiveIndicators(){
    const reviewOptions={selectedDomains:[...shortlistedDomains],officialDomains:profile?.officialDomains||[],allowlistedDomains:profile?.allowlistedDomains||[],includeWildcards:indicatorWildcards};
    const reviewed=buildDefensiveIndicatorExport(reviewedIndicatorRows,{...reviewOptions,format:indicatorFormat==='stix'||indicatorFormat==='misp'?'domains':indicatorFormat});
    if(!reviewed.domains.length){indicatorStatus='Shortlist an eligible domain and mark its case Suspicious or Confirmed abuse before exporting.';return;}
    const sources=reviewed.entries.map((entry)=>entry.source);
    const exported=indicatorFormat==='stix'?buildStixIndicatorExport(sources):indicatorFormat==='misp'?buildMispIndicatorExport(sources):reviewed;
    downloadText(exported.content,exported.filename,exported.mimeType);
    downloadText(reviewed.manifestContent,reviewed.manifestFilename,'application/json');
    downloadText(reviewed.rollbackContent,reviewed.rollbackFilename,'application/json');
    indicatorStatus=`Exported ${reviewed.domains.length} reviewed indicator${reviewed.domains.length===1?'':'s'}, a provenance manifest, and a rollback set${reviewed.exclusions.length?`; preflight excluded ${reviewed.exclusions.length} other selection${reviewed.exclusions.length===1?'':'s'}`:''}.`;
  }
  async function saveResults(){const name=watchlistName.trim();if(!name){saveStatus='Enter a watchlist name.';return;}const findings=results.filter(row=>!row.trusted);if(!findings.length){saveStatus='Every result is trusted by the active profile; nothing was added to Monitor.';return;}try{const changes=await saveWatchlist(name,findings.map(r=>r.saved),mode);const excluded=results.length-findings.length;saveStatus=changes.length?`Updated ${name} and recorded ${changes.length} material change${changes.length===1?'':'s'}${excluded?`; excluded ${excluded} trusted domain${excluded===1?'':'s'}`:''}.`:`Saved ${findings.length} result${findings.length===1?'':'s'} to ${name}${excluded?`; excluded ${excluded} trusted domain${excluded===1?'':'s'}`:''}.`;watchlistName='';}catch(cause){saveStatus=cause instanceof Error?cause.message:'Could not save watchlist.';}}
  async function saveSelectedResults(){const name=watchlistName.trim();if(!name){saveStatus='Enter a watchlist name.';return;}const findings=selectedRows.filter((row)=>!row.trusted);if(!findings.length){saveStatus='Select at least one non-trusted result before saving to Monitor.';return;}try{await saveWatchlist(name,findings.map((row)=>row.saved),mode);saveStatus=`Saved ${findings.length} explicitly selected result${findings.length===1?'':'s'} to ${name}.`;watchlistName='';}catch(cause){saveStatus=cause instanceof Error?cause.message:'Could not save the selected results.';}}
</script>

<svelte:head><title>Bulk · WHOISleuth</title></svelte:head>
<PageHeading eyebrow="Assess domains" title="Bulk" description="Scan multiple domains, prioritise findings, and retry inconclusive results." />
<BulkScanQueue
  lookupDisabledReason={lookupDisabled?(lookupDisabled.reason||'Lookup is disabled by deployment policy.'):''}
  scanLimitations={scanLimitations.map((item)=>item.id.replaceAll('_',' '))}
  profileName={profile?.name||''}
  handoffCount={handoff?.candidates.length||0}
  handoffSource={handoff?.source.replaceAll('-',' ')||''}
  {input}
  setInput={(value)=>input=value}
  {mode}
  setMode={(value)=>mode=value}
  {pacing}
  setPacing={(value)=>pacing=value}
  pacingOptions={BULK_PACING_OPTIONS}
  concurrency={activeConcurrency}
  progress={scanProgress}
  {running}
  {paused}
  entryCount={parsedInput.entries.length}
  duplicateCount={parsedInput.duplicates}
  {importDomainFile}
  {start}
  {togglePause}
  {cancel}
  {completed}
  {total}
  {status}
/>

<p class="local-context-status" role="status">{localContextStatus}</p>

<BulkSessions
  sessions={bulkSessions}
  currentSessionId={currentBulkSessionId}
  saveName={bulkSessionName}
  setSaveName={(value)=>bulkSessionName=value}
  saveCurrent={saveCurrentBulkSession}
  loadSession={loadSavedBulkSession}
  resumeSession={resumeSavedBulkSession}
  deleteSession={removeSavedBulkSession}
  exportSessions={downloadBulkSessions}
  status={bulkSessionStatus}
  canSave={!running&&results.length>0}
/>

<BulkReviewWorkspace
  store={bulkReviewStore}
  currentView={currentBulkReviewView()}
  reviewFilter={reviewStateFilter}
  setReviewFilter={(value)=>{reviewStateFilter=value;page=1;}}
  saveView={saveCurrentBulkReviewView}
  loadView={loadBulkReviewView}
  deleteView={removeBulkReviewView}
  status={bulkReviewStatus}
/>

{#if results.length}
  <section id="results" class="triage card" tabindex="-1">
    <BulkTriageControls
      {counts}
      {filter}
      {setFilter}
      {running}
      {retryErrors}
      {exportCsv}
      {indicatorFormat}
      setIndicatorFormat={(value)=>indicatorFormat=value}
      exportIndicators={exportDefensiveIndicators}
      {indicatorCount}
      {indicatorWildcards}
      setIndicatorWildcards={(value)=>indicatorWildcards=value}
      {selectedIndicatorCount}
      {mutationFilter}
      setMutationFilter={(value)=>{mutationFilter=value;page=1;}}
      mutationOptions={mutationOptions.map((value)=>({value,label:mutationLabels[value]||value.replaceAll('_',' ')}))}
      {signalFilters}
      {toggleSignal}
      {sourceFilter}
      setSourceFilter={(value)=>{sourceFilter=value;page=1;}}
      {lifecycleFilter}
      setLifecycleFilter={(value)=>{lifecycleFilter=value;page=1;}}
      {ageFilter}
      setAgeFilter={(value)=>{ageFilter=value;page=1;}}
      {mailFilter}
      setMailFilter={(value)=>{mailFilter=value;page=1;}}
      {registrarFilter}
      setRegistrarFilter={(value)=>{registrarFilter=value;page=1;}}
      {caseDispositionFilter}
      setCaseDispositionFilter={(value)=>{caseDispositionFilter=value;page=1;}}
      {groupBy}
      setGroupBy={(value)=>groupBy=value}
      {advancedFilterOptions}
      {clearFilters}
      {sortKey}
      {sortDirection}
      {setSortKey}
      {setSortDirection}
      {indicatorStatus}
      matchedCount={filtered.length}
      resultCount={results.length}
      visibleCount={visibleResults.length}
      {currentPage}
      {pageCount}
      {watchlistName}
      setWatchlistName={(value)=>watchlistName=value}
      {saveResults}
      {saveSelectedResults}
      {saveStatus}
      selectedCount={selectedRows.length}
      {selectFiltered}
      {clearFilteredSelection}
      {exportSelectedCsv}
      {deepRescanSelected}
      {createCasesSelected}
      {setSelectedDisposition}
      caseOptions={CASE_DISPOSITIONS}
    />
    <BulkTriagePlot
      points={filtered.map((row)=>({
        domain:row.domain,
        risk:row.risk,
        opportunity:row.opportunity,
        availability:row.availability,
        trusted:Boolean(row.trusted),
      }))}
      matchedCount={filtered.length}
    />
    <BulkMailExposureReview
      report={mailExposureReport}
      selectedDomains={shortlistedDomains}
      {selectDomains}
      exportReport={exportMailExposure}
    />
    <BulkReviewCockpit
      rows={cockpitRows}
      {retryPlan}
      {retryStatus}
      setReviewState={setReviewStateAt}
      toggleSaved={toggleSavedAt}
      trackCase={trackCaseAt}
      inspectDomain={inspectAt}
      executeRetry={executeReviewedRetry}
    />
    <BulkDomainComparison comparison={domainComparison} exportComparison={exportDomainComparison} />
    <BulkGroupSummary
      {groupBy}
      groups={groupSummary.groups}
      excluded={groupSummary.excluded}
      truncated={groupSummary.truncated}
      overlapping={groupSummary.overlapping}
      selectedDomains={shortlistedDomains}
      {selectDomains}
    />
    <BulkResultsTable
      rows={resultRows}
      {sortKey}
      {sortDirection}
      {setSort}
      toggleSaved={toggleSavedAt}
      caseOptions={CASE_DISPOSITIONS}
      setDisposition={setDispositionAt}
      trackCase={trackCaseAt}
      inspectDomain={inspectAt}
      {copyDraft}
      {currentPage}
      {pageCount}
      setPage={(value)=>page=value}
      {draftStatus}
      {caseStatus}
      setReviewState={setReviewStateAt}
    />
  </section>

  <BulkRelationships
    groups={relationshipSummary.groups}
    truncated={relationshipSummary.truncated}
    limitations={relationshipSummary.limitations}
    {loadDomains}
    {retainObservation}
    observationId={relationshipObservationId}
    retainedIds={retainedRelationshipIds}
    retainStatus={relationshipRetentionStatus}
  />
  <BulkCoverage {coverage} {exportCoverage} {loadDomains} />
{/if}

<BulkShortlist domains={shortlist.map((item)=>item.domain)} status={shortlistStatus} {loadShortlisted} {downloadShortlist} {importShortlistFile} {removeAllShortlisted} />

<style>
  .local-context-status{margin:12px 0 0;color:var(--warning);font-size:var(--text-sm)}
  .local-context-status:empty{display:none}
  .triage{padding:var(--card-pad)}
  .triage{margin-top:16px}
  .triage :global(#bulk-triage-plot){margin:16px 0}
</style>
