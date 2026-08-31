<script lang="ts">
  import { page } from '$app/state';
  import { getContext, onDestroy, tick, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { parseBoundedJson } from '$lib/bounded-json';
  import { BrowserLocalDataError } from '$lib/browser-local-data.ts';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import MonitorViewTabs from '$lib/components/MonitorViewTabs.svelte';
  import LocalCollectionState from '$lib/components/LocalCollectionState.svelte';
  import DeferredSurface from '$lib/components/DeferredSurface.svelte';
  import BrandProtectionOperationsReport from '$lib/components/BrandProtectionOperationsReport.svelte';
  import EvidenceDebtMatrix from '$lib/components/EvidenceDebtMatrix.svelte';
  import UnifiedAnalystReviewInbox from '$lib/components/UnifiedAnalystReviewInbox.svelte';
  import CaseDecisionQuality from '$lib/components/CaseDecisionQuality.svelte';
  import CaseLifecycleReview from '$lib/components/CaseLifecycleReview.svelte';
  import { saveCandidateHandoff } from '$lib/candidate-handoff';
  import { loadProfiles, type BrandProfile } from '$lib/brand-profiles';
  import { registerAnalystUndo } from '$lib/analyst-undo';
  import { buildInvestigationCaseRelationships } from '$lib/analysis/case-relationships.ts';
  import { buildCaseRelationshipClusters } from '$lib/analysis/case-relationship-clusters.ts';
  import { buildCaseDecisionQualityReport } from '$lib/analysis/case-decision-quality.ts';
  import { parseDomainInput } from '$lib/analysis/utils.ts';
  import { preloadBestEffort } from '$lib/idle-preload';
  import { buildInvestigationProjection } from '$lib/analysis/investigation-projection.ts';
  import type { ParentDomainCampaignSourceState } from '$lib/analysis/parent-domain-campaign-review.ts';
  import { deleteWatchlist, exportWatchlists, importWatchlists, loadWatchlists, MAX_WATCHLIST_IMPORT_BYTES, restoreHostedWatchlist as restoreHostedWatchlistAtomically, writeWatchlists, type WatchlistEntry, type Watchlists } from '$lib/watchlists';
  import {
    addCaseBrandProfileAssociation, addCaseNote, CASE_DISPOSITIONS, CASE_STATUSES, deleteCase, dispositionLabel, editCase, exportCases,
    exportRiskCalibrationDataset, importCases, loadCases, MAX_CASE_IMPORT_BYTES, openCase,
    previewRiskCalibrationDataset, removeCaseBrandProfileAssociation, statusLabel, type CaseRecord, type RiskCalibrationExportPreview
  } from '$lib/cases';
  import { loadCampaigns, type CampaignRecord } from '$lib/campaigns';
  import { loadDetectionRules, type DetectionRule } from '$lib/detection-rules';
  import {
    deleteRelationshipObservation,
    loadRelationshipObservations,
    type RelationshipObservation,
  } from '$lib/relationship-observations';
  import { CAPABILITY_CONTEXT, featureCapability, type CapabilityGetter } from '$lib/capabilities';
  import { loadInvestigationGuide } from '$lib/investigation-guide';
  import { loadBulkSessions } from '$lib/bulk-sessions';
  import { loadAnalystReviewState, saveAnalystReviewDecision } from '$lib/analyst-review-state';
  import type { BulkSession } from '$lib/analysis/bulk-session-model.ts';
  import { buildEvidenceDebtReview } from '$lib/analysis/evidence-debt-review.ts';
  import {
    analystReviewDismissalReasonLabel,
    type AnalystReviewDismissalReason,
    type AnalystReviewItem,
  } from '$lib/analysis/analyst-review-inbox.ts';
  import {
    emptyAnalystReviewStateStore,
    type AnalystReviewDisposition,
    type AnalystReviewStateStore,
  } from '$lib/analysis/analyst-review-state.ts';
  import { buildRetainedEvidenceTimeline } from '$lib/analysis/retained-evidence-timeline.ts';
  import {
    buildWebsiteClusterAssertion,
    buildWebsiteProfileClusters,
    type WebsiteProfileCluster,
  } from '$lib/analysis/website-profile-clusters.ts';
  import { loadWebsiteSnapshots, type WebsiteProfileSnapshot } from '$lib/website-snapshots';
  const moduleController = new AbortController();
  const preloadModule = (load: () => Promise<unknown>) => preloadBestEffort(load, moduleController.signal);
  onDestroy(() => moduleController.abort());

  type View = 'inbox' | 'timeline' | 'watchlists' | 'cases' | 'campaigns' | 'relationships' | 'rules' | 'certificates';
  const MONITOR_VIEWS = new Set<View>(['inbox','timeline','watchlists','cases','campaigns','relationships','rules','certificates']);
  const RESPOND_VIEWS = new Set<View>(['inbox','cases','campaigns','relationships']);
  const CASE_PAGE_SIZE=25;
  let view=$state<View>('inbox');
  const monitorWorkflow=$derived(RESPOND_VIEWS.has(view)
    ? {
        eyebrow:'Respond',
        description:'Review retained evidence, organise cases and prepare responses.',
      }
    : {
        eyebrow:'Assure',
        description:'Review monitoring history, watchlists and local control rules.',
      });
  $effect(()=>{
    const currentUrl=page.url;
    const rawView=currentUrl.searchParams.get('view');
    const requested:View=currentUrl.searchParams.get('case')?'cases':rawView&&MONITOR_VIEWS.has(rawView as View)?rawView as View:'inbox';
    untrack(()=>{
      view=requested;
    });
  });
  const capabilityReport=getContext<CapabilityGetter>(CAPABILITY_CONTEXT);
  const scheduledCapability=$derived(featureCapability(capabilityReport?.()||null,'scheduled_monitoring'));

  async function navigateMonitor(next:View,focus?:{parameter:'case'|'watchlist'|'campaign'|'observation';value:string}){
    preloadMonitorView(next);
    view=next;
    const url=new URL(page.url);
    url.searchParams.set('view',next);
    for(const parameter of ['case','watchlist','campaign','observation'])url.searchParams.delete(parameter);
    if(!focus)for(const parameter of ['investigation','domain','response'])url.searchParams.delete(parameter);
    if(focus)url.searchParams.set(focus.parameter,focus.value);
    url.hash='';
    await goto(`${url.pathname}${url.search}`,{noScroll:true,keepFocus:true});
  }
  function selectMonitorView(next:View){
    if(next===view)return;
    void navigateMonitor(next);
  }
  function preloadMonitorView(next:View){
    if(next==='certificates')preloadModule(()=>import('$lib/components/CertificateReviewInbox.svelte'));
    else if(next==='timeline')preloadModule(()=>Promise.all([import('$lib/components/RetainedEvidenceTimeline.svelte'),import('$lib/components/RetainedChangeReview.svelte')]));
    else if(next==='campaigns')preloadModule(()=>import('$lib/components/CampaignManager.svelte'));
    else if(next==='relationships')preloadModule(()=>Promise.all([import('$lib/components/WebsiteProfileClusters.svelte'),import('$lib/components/RetainedRelationshipObservations.svelte'),import('$lib/components/CaseRelationshipClusters.svelte'),import('$lib/components/CaseRelationshipWorkspace.svelte')]));
    else if(next==='rules')preloadModule(()=>import('$lib/components/DetectionRuleManager.svelte'));
    else if(next==='cases')preloadModule(()=>Promise.all([import('$lib/components/CaseWorkspaceToolbar.svelte'),import('$lib/components/ExternalFindingsImport.svelte'),import('$lib/components/CaseFilters.svelte'),import('$lib/components/CaseList.svelte'),import('$lib/components/CaseResponseWorkspace.svelte')]));
    else if(next==='watchlists')preloadModule(()=>Promise.all([import('$lib/components/MonitorActivityHeatmap.svelte'),import('$lib/components/WatchlistWorkspace.svelte'),import('$lib/components/HostedWatchlistManager.svelte')]));
  }

  // --- Watchlists ---
  let watchlists=$state<Watchlists>({});let selected=$state('');let changedOnly=$state(false);let message=$state('');
  let watchlistsSourceState=$state<'loading'|'ready'|'unavailable'>('loading');
  let watchlistsRefreshing=$state(false);
  const names=$derived(Object.keys(watchlists).sort());const entry=$derived(selected?watchlists[selected]||null:null);const history=$derived(entry?(changedOnly?entry.history.filter(e=>e.changeCount>0):entry.history):[]);
  const watchlistActivity=$derived(Object.values(watchlists).flatMap((record)=>record.history.map((event)=>({
    checkedAt:event.checkedAt,
    changeCount:event.changeCount,
    resultCount:event.resultCount,
    conclusiveCount:event.conclusiveCount,
  }))));
  async function refresh(){const hadSnapshot=watchlistsSourceState==='ready';watchlistsRefreshing=true;try{watchlists=await loadWatchlists();watchlistsSourceState='ready';if(selected&&!watchlists[selected])selected='';}catch(cause){if(!hadSnapshot)watchlistsSourceState='unavailable';throw cause;}finally{watchlistsRefreshing=false;}}
  function date(value:string){const parsed=new Date(value);return Number.isNaN(parsed.getTime())?value:parsed.toLocaleString();}
  async function remove(name:string){if(!confirm(`Delete watchlist "${name}" and its history?`))return;try{await deleteWatchlist(name);await refresh();message=`Deleted "${name}".`;}catch(cause){message=cause instanceof Error?cause.message:'Could not delete watchlist.';}}
  async function clearAll(){if(!names.length||!confirm('Delete every saved watchlist and its history?'))return;try{await writeWatchlists({});await refresh();message='Cleared all watchlists.';}catch(cause){message=cause instanceof Error?cause.message:'Could not clear watchlists.';}}
  async function downloadWatchlists(){try{await exportWatchlists();}catch(cause){message=cause instanceof Error?cause.message:'Could not export watchlists.';}}
  async function rescan(name:string){const current=watchlists[name];if(!current)return;const candidates=current.results.map(record=>({domain:String(record.domain),source:name,mutationTypes:Array.isArray(record.mutationTypes)?record.mutationTypes:[]}));const handoffResult=saveCandidateHandoff('watchlist',candidates);if(!handoffResult.saved){message='This browser could not retain the watchlist candidates for Bulk. Check site-storage access and try again.';return;}await goto(`/bulk?source=watchlist&handoff=${handoffResult.token}`);}
  async function importFile(event:Event){const input=event.currentTarget as HTMLInputElement;const file=input.files?.[0];if(!file)return;try{if(file.size>MAX_WATCHLIST_IMPORT_BYTES)throw new Error('Watchlist imports are limited to 2 MB.');const result=await importWatchlists(parseBoundedJson(await file.text(),{label:'Watchlist import',maximumBytes:MAX_WATCHLIST_IMPORT_BYTES}));const skipped=result.skipped?`; skipped ${result.skipped} invalid or over-limit watchlist${result.skipped===1?'':'s'}`:'';message=`Imported ${result.added} new and ${result.updated} updated watchlists${skipped}.`;await refresh();}catch(cause){message=cause instanceof Error?cause.message:'Import failed';}finally{input.value='';}}
  async function restoreHostedWatchlist(name:string,hostedEntry:WatchlistEntry){await restoreHostedWatchlistAtomically(name,hostedEntry);await refresh();}

  // --- Cases ---
  let cases=$state<CaseRecord[]>([]);
  let pendingNoteCaseIds=$state<string[]>([]);
  let casesSourceState=$state<'loading'|'ready'|'unavailable'>('loading');
  let parentDomainCasesSourceState=$state<ParentDomainCampaignSourceState>('loading');
  let casesRefreshing=$state(false);
  let brandProfiles=$state<BrandProfile[]>([]);
  let brandProfilesUnavailable=$state(true);
  let brandProfilesSourceState=$state<'loading'|'ready'|'unavailable'>('loading');
  let bulkSessions=$state<BulkSession[]>([]);
  let bulkSessionsSourceState=$state<'loading'|'ready'|'unavailable'>('loading');
  let websiteSnapshots=$state<WebsiteProfileSnapshot[]>([]);
  let websiteSnapshotsSourceState=$state<'loading'|'ready'|'unavailable'>('loading');
  let analystReviewState=$state<AnalystReviewStateStore>(emptyAnalystReviewStateStore());
  let analystReviewStateSourceState=$state<'loading'|'ready'|'unavailable'>('loading');
  let certificateReviewCount=$state<number|null>(null);
  let reviewInboxCount=$state<number|null>(null);
  const websiteProfileClusters=$derived(buildWebsiteProfileClusters(websiteSnapshots));
  const evidenceDebtReview=$derived(buildEvidenceDebtReview({
    cases,
    bulkSessions,
    sourceStates:{cases:casesSourceState,bulk:bulkSessionsSourceState},
  }));
  const decisionQuality=$derived(buildCaseDecisionQualityReport(cases));
  let casePage=$state(1);
  let campaignCount=$state(0);
  let campaigns=$state<CampaignRecord[]>([]);
  let campaignsSourceState=$state<'loading'|'ready'|'unavailable'>('loading');
  let investigationProjection=$state<unknown>(null);
  let retainedRelationships=$state<RelationshipObservation[]>([]);
  let relationshipsSourceState=$state<'loading'|'ready'|'unavailable'>('loading');
  const retainedTimeline=$derived(buildRetainedEvidenceTimeline({cases,bulkSessions,watchlists,relationships:retainedRelationships,websiteSnapshots}));
  let customRuleCount=$state(0);
  let detectionRules=$state<DetectionRule[]>([]);
  let detectionRulesSourceState=$state<'loading'|'ready'|'unavailable'>('loading');
  let localContextStatus=$state('');
  const relationshipSummary=$derived(buildInvestigationCaseRelationships(investigationProjection));
  const relationshipClusters=$derived(buildCaseRelationshipClusters(relationshipSummary));
  const relationshipCount=$derived(relationshipSummary.groups.length+retainedRelationships.length+websiteProfileClusters.clusters.length);
  let statusFilter=$state('');let dispositionFilter=$state('');let caseSearch=$state('');let caseSort=$state<'updated'|'domain'|'status'>('updated');
  let expandedId=$state('');let noteDraft=$state('');let tagDraft=$state('');let caseMessage=$state('');let newDomain=$state('');
  let calibrationCaseIds=$state<string[]>([]);
  let calibrationReview=$state<RiskCalibrationExportPreview|null>(null);
  let calibrationExportBusy=$state(false);
  let guidedDomains=$state<string[]>([]);let guidedDomainsTruncated=$state(false);
  const existingCaseDomains=$derived(new Set(cases.map((record)=>record.domain)));
  const statusOrder=new Map(CASE_STATUSES.map((item,index)=>[item.value,index]));
  const filteredCases=$derived.by(()=>{
    const term=caseSearch.trim().toLowerCase();
    return cases.filter(record=>{
      if(statusFilter&&record.status!==statusFilter)return false;
      if(dispositionFilter&&record.disposition!==dispositionFilter)return false;
      if(term&&!record.domain.includes(term)&&!record.tags.some(tag=>tag.toLowerCase().includes(term)))return false;
      return true;
    }).sort((a,b)=>{
      if(caseSort==='domain')return a.domain.localeCompare(b.domain);
      if(caseSort==='status')return (statusOrder.get(a.status)??99)-(statusOrder.get(b.status)??99)||a.domain.localeCompare(b.domain);
      return Date.parse(b.updatedAt)-Date.parse(a.updatedAt);
    });
  });
  const casePageCount=$derived(Math.max(1,Math.ceil(filteredCases.length/CASE_PAGE_SIZE)));
  const currentCasePage=$derived(Math.min(casePage,casePageCount));
  const pagedCases=$derived(filteredCases.slice((currentCasePage-1)*CASE_PAGE_SIZE,currentCasePage*CASE_PAGE_SIZE));
  function setCasePage(value:number){casePage=Math.min(casePageCount,Math.max(1,Math.trunc(value)));}
  function showCasePage(record:CaseRecord){const index=filteredCases.findIndex(item=>item.id===record.id);if(index>=0)casePage=Math.floor(index/CASE_PAGE_SIZE)+1;}
  function refreshRelationships(){investigationProjection=buildInvestigationProjection({cases,campaigns,relationshipObservations:retainedRelationships});}
  async function refreshRetainedRelationships(){relationshipsSourceState='loading';try{retainedRelationships=await loadRelationshipObservations();relationshipsSourceState='ready';}catch(cause){relationshipsSourceState='unavailable';throw cause;}}
  async function removeRetainedRelationship(record:RelationshipObservation){
    if(!confirm(`Delete the retained ${record.label.toLowerCase()} observation for ${record.domains.length} domain${record.domains.length===1?'':'s'}?`))return;
    try{
      retainedRelationships=await deleteRelationshipObservation(record.id);
      await refreshRelationships();
      caseMessage=`Deleted the retained relationship observation. Source cases and watchlists were not changed.`;
    }catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not delete the retained relationship observation.';}
  }
  function parentDomainCaseFailureState(cause:unknown):ParentDomainCampaignSourceState{return cause instanceof BrowserLocalDataError&&cause.code==='LOCAL_DATA_FUTURE_SCHEMA'?'future_schema':'unavailable';}
  async function refreshCases(){const hadSnapshot=casesSourceState==='ready';casesRefreshing=true;try{cases=await loadCases();casesSourceState='ready';parentDomainCasesSourceState='ready';calibrationCaseIds=calibrationCaseIds.filter(id=>cases.some(record=>record.id===id));refreshRelationships();if(expandedId&&!cases.some(record=>record.id===expandedId))expandedId='';}catch(cause){parentDomainCasesSourceState=hadSnapshot?'partial':parentDomainCaseFailureState(cause);if(!hadSnapshot)casesSourceState='unavailable';throw cause;}finally{casesRefreshing=false;}}
  function installCommittedCaseSnapshot(committedCases:CaseRecord[],sourceState:ParentDomainCampaignSourceState='ready'){
    cases=committedCases;
    casesSourceState='ready';
    parentDomainCasesSourceState=sourceState;
    calibrationCaseIds=calibrationCaseIds.filter(id=>cases.some(item=>item.id===id));
    refreshRelationships();
    if(expandedId&&!cases.some(record=>record.id===expandedId))expandedId='';
  }
  async function reconcileCommittedCaseSnapshot(
    committed:{cases:CaseRecord[];pruned:number},
    success:string,
    record:CaseRecord|null=null,
  ){
    try{
      await refreshCases();
      if(record)showCasePage(record);
      caseMessage=`${success}${prunedNote(committed.pruned)}`;
    }catch{
      installCommittedCaseSnapshot(committed.cases,'partial');
      if(record)showCasePage(record);
      caseMessage=`${success} The change was saved, but Cases could not be reread. The complete committed Case snapshot is shown locally; reload to retry the browser-local read.${prunedNote(committed.pruned)}`;
    }
  }
  async function reconcileCommittedCaseMutation(
    committed:Awaited<ReturnType<typeof editCase>>,
    success:string,
  ){
    await reconcileCommittedCaseSnapshot(committed,success,committed.record);
  }
  function expand(record:CaseRecord){if(expandedId===record.id){expandedId='';return;}showCasePage(record);expandedId=record.id;tagDraft=record.tags.join(', ');noteDraft='';}
  async function openRelatedCase(record:CaseRecord){clearCaseFilters();casePage=1;showCasePage(record);if(expandedId!==record.id)expand(record);await navigateMonitor('cases',{parameter:'case',value:record.id});await focusCase(record);}
  function openEvidenceDebtCase(caseId:string){const record=cases.find((item)=>item.id===caseId);if(record)openRelatedCase(record);else caseMessage='That retained case is no longer available.';}
  async function focusCase(record:CaseRecord){
    await tick();
    const target=document.getElementById(`case-head-${record.id}`);
    target?.scrollIntoView({block:'center'});
    target?.focus({preventScroll:true});
  }
  async function focusResponsePreflight(record:CaseRecord){
    await tick();
    const details=document.getElementById(`case-response-preflight-${record.id}`) as HTMLDetailsElement|null;
    if(!details)return;
    details.open=true;
    details.scrollIntoView({block:'center'});
    details.querySelector<HTMLElement>('summary')?.focus({preventScroll:true});
  }
  async function openWatchlistCase(domain:string){
    let committed:Awaited<ReturnType<typeof openCase>>;
    try{committed=await openCase({domain,source:'monitor'});}
    catch(cause){message=cause instanceof Error?cause.message:'Could not open the case.';return;}
    const{record,created}=committed;
    await reconcileCommittedCaseSnapshot(
      committed,
      `${created?`Opened a new case for ${record.domain}.`:`Opened the existing case for ${record.domain}.`} Watchlist history remains separately attributed.`,
      record,
    );
    clearCaseFilters();casePage=1;showCasePage(record);expandedId=record.id;tagDraft=record.tags.join(', ');noteDraft='';
    await navigateMonitor('cases',{parameter:'case',value:record.id});await focusCase(record);
  }
  async function openGuidedCase(domain:string){
    const responseRequested=page.url.searchParams.get('response')==='1';
    let committed:Awaited<ReturnType<typeof openCase>>;
    try{committed=await openCase({domain,source:'monitor'});}
    catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not open the guided case.';return;}
    const{record,created}=committed;
    await reconcileCommittedCaseSnapshot(
      committed,
      created?`Opened a new case for ${record.domain}.`:`Opened the existing case for ${record.domain}.`,
      record,
    );
    clearCaseFilters();casePage=1;showCasePage(record);expandedId=record.id;tagDraft=record.tags.join(', ');noteDraft='';
    await navigateMonitor('cases',{parameter:'case',value:record.id});
    if(responseRequested)await focusResponsePreflight(record);else await focusCase(record);
  }
  async function recordWebsiteClusterLead(cluster:WebsiteProfileCluster,domain:string){
    const opened=await openCase({domain,source:'website-profile-cluster'});
    const{record}=opened;
    const assertion=buildWebsiteClusterAssertion(cluster,domain);
    if(record.assertions.some((item)=>item.statement===assertion.statement&&item.state==='open')){
      throw new Error(`That website-profile review lead is already open for ${domain}.`);
    }
    let committed:Awaited<ReturnType<typeof editCase>>;
    try{committed=await editCase(record.id,{assertion});}
    catch(cause){
      if(cause instanceof BrowserLocalDataError&&cause.code==='LOCAL_DATA_COMMIT_UNKNOWN')throw cause;
      installCommittedCaseSnapshot(opened.cases);
      throw new Error(`The case for ${record.domain} was saved, but its website-profile review lead was not recorded.`,{cause});
    }
    await reconcileCommittedCaseMutation(committed,`Recorded a separately typed website-profile review lead for ${domain}.`);
  }
  async function dismissEvidenceGap(item:AnalystReviewItem,reason:AnalystReviewDismissalReason){
    if(item.kind!=='evidence_gap'||!item.caseId||!item.dismissalTarget)return;
    const record=cases.find((candidate)=>candidate.id===item.caseId);
    const reasonLabel=analystReviewDismissalReasonLabel(reason);
    if(!record||!reasonLabel){caseMessage='That evidence-gap review is no longer available.';return;}
    let committed:Awaited<ReturnType<typeof editCase>>;
    try{
      committed=await editCase(record.id,{trailEvent:{
        kind:'review',
        summary:`Dismissed the current evidence-gap review: ${reasonLabel}.`,
        target:item.dismissalTarget,
      }});
    }catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not record the evidence-gap review.';return;}
    await reconcileCommittedCaseMutation(
      committed,
      `Recorded the reviewed evidence-gap dismissal for ${record.domain}. The underlying evidence and assertions were not changed.`,
    );
  }
  async function recordAnalystReviewDecision(item:AnalystReviewItem,input:{disposition:AnalystReviewDisposition;rationale:string;expiresAt:string|null;reviewDueAt:string|null}){
    analystReviewState=await saveAnalystReviewDecision(item,input);
    analystReviewStateSourceState='ready';
    caseMessage=`Recorded ${input.disposition.replaceAll('_',' ')} for ${item.title}. The retained evidence, Case disposition, score, and collection state were not changed.`;
  }
  function prunedNote(pruned:number){return pruned?` (pruned ${pruned} old evidence snapshot${pruned===1?'':'s'} to stay within storage)`:'';}
  async function trackDomain(){
    const domain=newDomain.trim();if(!domain){caseMessage='Enter a domain to track.';return;}
    let committed:Awaited<ReturnType<typeof openCase>>;
    try{committed=await openCase({domain,source:'monitor'});}
    catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not open the case.';return;}
    const{record,created}=committed;
    newDomain='';
    await reconcileCommittedCaseSnapshot(committed,created?`Opened a new case for ${record.domain}.`:`${record.domain} already has a case.`,record);
    showCasePage(record);expandedId=record.id;tagDraft=record.tags.join(', ');noteDraft='';await navigateMonitor('cases',{parameter:'case',value:record.id});await focusCase(record);
  }
  async function setStatus(record:CaseRecord,value:string){
    try{const committed=await editCase(record.id,{status:value});await reconcileCommittedCaseMutation(committed,`Set ${record.domain} to ${statusLabel(value)}.`);}
    catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not update the case.';}
  }
  async function setDisposition(record:CaseRecord,value:string){
    try{const committed=await editCase(record.id,{disposition:value});await reconcileCommittedCaseMutation(committed,`Marked ${record.domain} as ${dispositionLabel(value)}.`);}
    catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not update the case.';}
  }
  async function setReviewReason(record:CaseRecord,value:string){
    try{const committed=await editCase(record.id,{reviewReasonCode:value});await reconcileCommittedCaseMutation(committed,`Updated the review reason for ${record.domain}.`);}
    catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not update the review reason.';}
  }
  async function changeBrandProfileAssociation(record:CaseRecord,profileId:string,operation:'add'|'remove'){
    let persisted:CaseRecord;
    let committedCases:CaseRecord[]=[];
    let pruned=0;
    try{
      const result=operation==='add'
        ?await addCaseBrandProfileAssociation(record.id,profileId)
        :await removeCaseBrandProfileAssociation(record.id,profileId);
      persisted=result.record;
      committedCases=result.cases;
      pruned=result.pruned;
    }catch(cause){
      caseMessage=cause instanceof Error?cause.message:`Could not ${operation} the Brand Profile association.`;
      return false;
    }
    try{
      await refreshCases();
      showCasePage(persisted);
      caseMessage=`${operation==='add'?'Added':'Removed'} an explicit Brand Profile association for ${persisted.domain}.${prunedNote(pruned)}`;
    }catch{
      installCommittedCaseSnapshot(committedCases,'partial');
      showCasePage(persisted);
      caseMessage=`Brand Profile association saved for ${persisted.domain}, but Cases could not be reread. The complete committed Case snapshot is shown locally; reload to retry the browser-local read.${prunedNote(pruned)}`;
    }
    return true;
  }
  function addBrandProfileAssociation(record:CaseRecord,profileId:string){return changeBrandProfileAssociation(record,profileId,'add');}
  function removeBrandProfileAssociation(record:CaseRecord,profileId:string){return changeBrandProfileAssociation(record,profileId,'remove');}
  async function saveTags(record:CaseRecord){
    const previous=[...record.tags];const next=tagDraft.split(/[,\n]+/).map(value=>value.trim()).filter(Boolean);if(previous.join('\\0')===next.join('\\0'))return;
    try{
      const committed=await editCase(record.id,{tags:next});
      tagDraft=committed.record.tags.join(', ');
      await reconcileCommittedCaseMutation(committed,`Updated tags for ${record.domain}.`);
      registerAnalystUndo({kind:'case_tags',action:'Case tags updated',affectedRecord:record.domain,undo:async()=>{
        const restored=await editCase(record.id,{tags:previous});
        if(expandedId===record.id)tagDraft=restored.record.tags.join(', ');
        await reconcileCommittedCaseMutation(restored,`Restored the previous tags for ${record.domain}.`);
        return `Restored the previous tags for ${record.domain}.`;
      }});
    }catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not update tags.';}
  }
  async function addNote(record:CaseRecord){
    if(pendingNoteCaseIds.includes(record.id))return;
    const body=noteDraft.trim();
    if(!body){caseMessage='A note cannot be empty.';return;}
    pendingNoteCaseIds=[...pendingNoteCaseIds,record.id];
    caseMessage=`Adding a note to ${record.domain}…`;
    try{
      let committed:Awaited<ReturnType<typeof addCaseNote>>;
      try{committed=await addCaseNote(record.id,body);}
      catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not add the note.';return;}
      noteDraft='';
      await reconcileCommittedCaseMutation(committed,`Added a note to ${record.domain}.`);
    }finally{pendingNoteCaseIds=pendingNoteCaseIds.filter((id)=>id!==record.id);}
  }
  async function downloadCases(){try{await exportCases();}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not export cases.';}}
  function toggleCalibrationCase(record:CaseRecord,selected:boolean){calibrationReview=null;calibrationCaseIds=selected?[...new Set([...calibrationCaseIds,record.id])]:calibrationCaseIds.filter(id=>id!==record.id);}
  async function reviewCalibrationDataset(){try{calibrationReview=await previewRiskCalibrationDataset(calibrationCaseIds);}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not review the Risk calibration dataset.';}}
  async function downloadCalibrationDataset(){calibrationExportBusy=true;try{const result=await exportRiskCalibrationDataset(calibrationCaseIds);calibrationReview=null;caseMessage=`Exported ${result.included} reviewed case${result.included===1?'':'s'} for offline Risk calibration${result.excluded?`; excluded ${result.excluded} incompatible selection${result.excluded===1?'':'s'}`:''}. No model setting was changed.`;}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not export the Risk calibration dataset.';}finally{calibrationExportBusy=false;}}
  async function removeCase(record:CaseRecord){
    if(!confirm(`Delete the case for ${record.domain}? Its notes are removed unless you exported them.`))return;
    let committed:Awaited<ReturnType<typeof deleteCase>>;
    try{committed=await deleteCase(record.id);}
    catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not delete the case.';return;}
    if(expandedId===record.id)expandedId='';
    try{await refreshCases();caseMessage=`Deleted the case for ${record.domain}.`;}
    catch{installCommittedCaseSnapshot(committed.cases,'partial');caseMessage=`Deleted the case for ${record.domain}. The change was saved, but Cases could not be reread. The complete committed Case snapshot is shown locally; reload to retry the browser-local read.`;}
  }
  function clearCaseFilters(){statusFilter='';dispositionFilter='';caseSearch='';}
  async function importCaseFile(event:Event){
    const input=event.currentTarget as HTMLInputElement;const file=input.files?.[0];if(!file)return;
    try{
      if(file.size>MAX_CASE_IMPORT_BYTES)throw new Error('Case imports are limited to 2 MB.');
      const result=await importCases(parseBoundedJson(await file.text(),{label:'Case import',maximumBytes:MAX_CASE_IMPORT_BYTES}));
      const success=`Imported ${result.added} new and ${result.updated} merged cases${result.skipped?`; skipped ${result.skipped} invalid or over-limit record${result.skipped===1?'':'s'}`:''}${result.brandProfileReferencesOmitted?`; omitted ${result.brandProfileReferencesOmitted} Brand Profile reference${result.brandProfileReferencesOmitted===1?'':'s'} beyond the retained bounds`:''}.`;
      await reconcileCommittedCaseSnapshot(result,success);
    }catch(cause){caseMessage=cause instanceof Error?cause.message:'Case import failed';}
    finally{input.value='';}
  }

  let appliedMonitorRouteKey='';
  function monitorRouteKey(url:URL){return `${url.pathname}${url.search}${url.hash}`;}
  function restoreGuidedQueueTarget(){
    if(page.url.hash!=='#case-review-queue')return;
    const target=document.getElementById('case-review-queue');
    target?.scrollIntoView({block:'center'});
    target?.focus({preventScroll:true});
  }
  function restoreWatchlistTarget(){
    if(!page.url.searchParams.get('watchlist'))return;
    const target=document.getElementById('watchlist-history');
    target?.scrollIntoView({block:'start'});
    target?.focus({preventScroll:true});
  }
  async function restoreCaseListTarget(){
    const caseId=page.url.searchParams.get('case');
    if(!caseId||caseId!==expandedId||page.url.hash===`#case-response-${encodeURIComponent(caseId)}`)return;
    const target=cases.find((record)=>record.id===caseId);
    if(target)await focusCase(target);
  }
  async function applyMonitorRouteTarget(
    currentUrl:URL,
    routeKey:string,
    loadedCases:CaseRecord[],
    caseState:typeof casesSourceState,
    loadedWatchlists:Watchlists,
    watchlistState:typeof watchlistsSourceState,
  ){
    if(routeKey===appliedMonitorRouteKey)return;
    const focus=currentUrl.searchParams.get('case');
    if(focus){
      if(caseState==='loading')return;
      appliedMonitorRouteKey=routeKey;
      if(caseState!=='ready')return;
      const target=loadedCases.find((record)=>record.id===focus);
      if(!target)return;
      clearCaseFilters();casePage=1;showCasePage(target);expandedId=focus;tagDraft=target.tags.join(', ');noteDraft='';
      await tick();
      if(monitorRouteKey(page.url)!==routeKey)return;
      const workspace=document.getElementById(`case-response-${target.id}`);
      if(currentUrl.hash===`#case-response-${encodeURIComponent(target.id)}`&&workspace){workspace.scrollIntoView({block:'start'});workspace.focus({preventScroll:true});}
      else await focusCase(target);
      return;
    }

    const requestedWatchlist=currentUrl.searchParams.get('watchlist');
    if(requestedWatchlist){
      if(watchlistState==='loading')return;
      appliedMonitorRouteKey=routeKey;
      if(watchlistState==='ready'&&Object.hasOwn(loadedWatchlists,requestedWatchlist)){
        selected=requestedWatchlist;changedOnly=false;
        await tick();
        if(monitorRouteKey(page.url)!==routeKey)return;
        const target=document.getElementById('watchlist-history');
        target?.scrollIntoView({block:'start'});
        target?.focus({preventScroll:true});
      }
      return;
    }

    const guideDomain=parseDomainInput(currentUrl.searchParams.get('domain')||'').entries[0]||'';
    const investigationRoute=currentUrl.searchParams.get('investigation')==='1';
    guidedDomains=[];guidedDomainsTruncated=false;
    if(investigationRoute){
      if(caseState==='loading')return;
      view='cases';
      const guide=loadInvestigationGuide();
      const carried=guide?.recipeId==='brand_sweep'?(guide.focusDomain?[guide.focusDomain]:[]):guide?.reviewDomains||[];
      guidedDomains=[...new Set([...carried,guideDomain].filter(Boolean))];
      guidedDomainsTruncated=Boolean(guide?.reviewDomainsTruncated);
      await tick();
      if(monitorRouteKey(page.url)!==routeKey)return;
      if(currentUrl.hash==='#case-review-queue')restoreGuidedQueueTarget();
    }else{
      if(guideDomain)view='cases';
      newDomain=guideDomain;
    }
    appliedMonitorRouteKey=routeKey;
  }

  $effect(()=>{
    const currentUrl=new URL(page.url);
    const routeKey=monitorRouteKey(currentUrl);
    const loadedCases=cases;
    const caseState=casesSourceState;
    const loadedWatchlists=watchlists;
    const watchlistState=watchlistsSourceState;
    untrack(()=>{void applyMonitorRouteTarget(currentUrl,routeKey,loadedCases,caseState,loadedWatchlists,watchlistState);});
  });

  const collectionLoads=new Map<string,Promise<void>>();
  function noteUnavailableCollection(label:string){
    const prefix='Some browser-local context could not be loaded (';
    const labels=localContextStatus.startsWith(prefix)
      ?localContextStatus.slice(prefix.length,localContextStatus.indexOf(').')).split(', ').filter(Boolean)
      :[];
    if(!labels.includes(label))labels.push(label);
    localContextStatus=`Some browser-local context could not be loaded (${labels.join(', ')}). Successfully loaded collections remain available; reload to retry the missing context.`;
  }
  function loadCollection(key:string,work:()=>Promise<void>):Promise<void>{
    const existing=collectionLoads.get(key);
    if(existing)return existing;
    const pending=work();
    collectionLoads.set(key,pending);
    return pending;
  }
  function ensureWatchlists(){return loadCollection('watchlists',async()=>{try{await refresh();}catch{noteUnavailableCollection('watchlists');}});}
  function ensureCases(){return loadCollection('cases',async()=>{try{await refreshCases();}catch{noteUnavailableCollection('cases');}});}
  function ensureRelationships(){return loadCollection('relationships',async()=>{try{await refreshRetainedRelationships();refreshRelationships();}catch{noteUnavailableCollection('retained relationships');}});}
  function ensureBulkSessions(){return loadCollection('bulk-sessions',async()=>{try{bulkSessions=await loadBulkSessions();bulkSessionsSourceState='ready';}catch{bulkSessionsSourceState='unavailable';noteUnavailableCollection('Bulk sessions');}});}
  function ensureWebsiteSnapshots(){return loadCollection('website-snapshots',async()=>{try{websiteSnapshots=await loadWebsiteSnapshots();websiteSnapshotsSourceState='ready';}catch{websiteSnapshotsSourceState='unavailable';noteUnavailableCollection('website profiles');}});}
  function ensureCampaigns(){return loadCollection('campaigns',async()=>{try{campaigns=await loadCampaigns();campaignCount=campaigns.length;campaignsSourceState='ready';refreshRelationships();}catch{campaignsSourceState='unavailable';noteUnavailableCollection('campaigns');}});}
  function ensureRules(){return loadCollection('rules',async()=>{try{detectionRules=await loadDetectionRules();customRuleCount=detectionRules.length;detectionRulesSourceState='ready';}catch{detectionRulesSourceState='unavailable';noteUnavailableCollection('rules');}});}
  function ensureProfiles(){return loadCollection('profiles',async()=>{try{brandProfiles=await loadProfiles();brandProfilesUnavailable=false;brandProfilesSourceState='ready';}catch{brandProfilesSourceState='unavailable';noteUnavailableCollection('Brand Profiles');}});}
  function ensureAnalystReviewState(){return loadCollection('analyst-review-state',async()=>{try{analystReviewState=await loadAnalystReviewState();analystReviewStateSourceState='ready';}catch{analystReviewStateSourceState='unavailable';noteUnavailableCollection('analyst Review Item lifecycle');}});}
  async function ensureMonitorViewData(next:View){
    const loads=next==='inbox'
      ?[ensureCases(),ensureWatchlists(),ensureBulkSessions(),ensureAnalystReviewState(),ensureProfiles(),ensureRules(),ensureWebsiteSnapshots()]
      :next==='timeline'
        ?[ensureCases(),ensureWatchlists(),ensureBulkSessions(),ensureRelationships(),ensureWebsiteSnapshots()]
        :next==='watchlists'
          ?[ensureWatchlists()]
          :next==='cases'
            ?[ensureCases(),ensureProfiles()]
            :next==='certificates'
              ?[ensureCases(),ensureProfiles(),ensureAnalystReviewState()]
            :next==='campaigns'
              ?[ensureCampaigns(),ensureCases(),ensureProfiles(),ensureRelationships()]
              :next==='relationships'
                ?[ensureCases(),ensureCampaigns(),ensureRelationships(),ensureWebsiteSnapshots()]
                :[ensureRules(),ensureCases()];
    await Promise.all(loads);
  }
  $effect(()=>{
    const selectedView=view;
    untrack(()=>{preloadMonitorView(selectedView);void ensureMonitorViewData(selectedView);});
  });
</script>

<svelte:head><title>Monitor · WHOISleuth</title></svelte:head>
<PageHeading eyebrow={monitorWorkflow.eyebrow} title="Monitor" description={monitorWorkflow.description} />

<MonitorViewTabs {view} counts={{
  inbox:casesSourceState==='ready'&&watchlistsSourceState==='ready'&&bulkSessionsSourceState==='ready'&&analystReviewStateSourceState==='ready'&&brandProfilesSourceState==='ready'&&detectionRulesSourceState==='ready'&&websiteSnapshotsSourceState==='ready'?reviewInboxCount:null,
  timeline:casesSourceState==='ready'&&watchlistsSourceState==='ready'&&bulkSessionsSourceState==='ready'&&relationshipsSourceState==='ready'&&websiteSnapshotsSourceState==='ready'?retainedTimeline.counts.all:null,
  cases:casesSourceState==='ready'?cases.length:null,
  campaigns:campaignsSourceState==='ready'?campaignCount:null,
  relationships:casesSourceState==='ready'&&campaignsSourceState==='ready'&&relationshipsSourceState==='ready'&&websiteSnapshotsSourceState==='ready'?relationshipCount:null,
  rules:detectionRulesSourceState==='ready'?customRuleCount:null,
  watchlists:watchlistsSourceState==='ready'?names.length:null,
  certificates:certificateReviewCount,
}} preloadView={preloadMonitorView} setView={selectMonitorView} />
{#if localContextStatus}<p class="local-context-status" role="status">{localContextStatus}</p>{/if}

{#if view==='inbox'}
<div id="monitor-view-panel" role="tabpanel" aria-labelledby="tab-inbox">
  <BrandProtectionOperationsReport records={cases} sourceState={casesSourceState} />
  <EvidenceDebtMatrix review={evidenceDebtReview} oncase={openEvidenceDebtCase} />
  {#if casesSourceState==='ready'&&watchlistsSourceState==='ready'&&bulkSessionsSourceState==='ready'&&analystReviewStateSourceState==='ready'&&brandProfilesSourceState==='ready'&&detectionRulesSourceState==='ready'&&websiteSnapshotsSourceState==='ready'}
    <UnifiedAnalystReviewInbox {cases} {watchlists} {bulkSessions} profiles={brandProfiles} {detectionRules} {websiteSnapshots} reviewState={analystReviewState} ondismiss={dismissEvidenceGap} onreview={recordAnalystReviewDecision} oncount={(count:number)=>reviewInboxCount=count} />
    {#if caseMessage}<p class="case-message" role="status" aria-live="polite">{caseMessage}</p>{/if}
  {:else}
    <LocalCollectionState state={casesSourceState==='loading'||watchlistsSourceState==='loading'||bulkSessionsSourceState==='loading'||analystReviewStateSourceState==='loading'||brandProfilesSourceState==='loading'||detectionRulesSourceState==='loading'||websiteSnapshotsSourceState==='loading'?'loading':'unavailable'} title="Review inbox evidence unavailable" detail="Cases, watchlists, saved Bulk sessions, Brand Profiles, custom rules, website snapshots, and the analyst lifecycle overlay must all be readable before the combined inbox can distinguish zero review items from missing browser-local state. Fulfilled collections remain available in their own views." />
  {/if}
  {#if casesSourceState==='ready'}
    <CaseDecisionQuality report={decisionQuality} />
    <CaseLifecycleReview records={cases} />
  {/if}
</div>
{/if}

{#if view==='certificates'}
<div id="monitor-view-panel" role="tabpanel" aria-labelledby="tab-certificates">
  {#if casesSourceState==='ready'&&brandProfilesSourceState==='ready'&&analystReviewStateSourceState==='ready'}
    <DeferredSurface load={()=>import('$lib/components/CertificateReviewInbox.svelte')} loadingLabel="Loading retained certificate review…" unavailableLabel="The certificate review inbox could not be loaded." props={{profiles:brandProfiles,cases,reviewState:analystReviewState,profileId:page.url.searchParams.get('profile')??'',onreview:recordAnalystReviewDecision,oncount:(count:number)=>certificateReviewCount=count}} />
    {#if caseMessage}<p class="case-message" role="status" aria-live="polite">{caseMessage}</p>{/if}
  {:else}
    <LocalCollectionState state={casesSourceState==='loading'||brandProfilesSourceState==='loading'||analystReviewStateSourceState==='loading'?'loading':'unavailable'} title="Certificate review unavailable" detail="Readable Brand Profiles, retained Cases, and the analyst lifecycle overlay are required. Missing collections are not treated as empty certificate evidence." />
  {/if}
</div>
{/if}

{#if view==='timeline'}
<div id="monitor-view-panel" role="tabpanel" aria-labelledby="tab-timeline">
  {#if casesSourceState==='ready'&&watchlistsSourceState==='ready'&&bulkSessionsSourceState==='ready'&&relationshipsSourceState==='ready'&&websiteSnapshotsSourceState==='ready'}
    <DeferredSurface load={()=>import('$lib/components/RetainedEvidenceTimeline.svelte')} loadingLabel="Loading retained evidence timeline…" unavailableLabel="The retained evidence timeline could not be loaded." props={{timeline:retainedTimeline}} />
    <DeferredSurface load={()=>import('$lib/components/RetainedChangeReview.svelte')} loadingLabel="Loading retained change review…" unavailableLabel="The retained change review could not be loaded." props={{cases,websiteSnapshots,watchlists,bulkSessions}} />
  {:else}
    <LocalCollectionState state={casesSourceState==='loading'||watchlistsSourceState==='loading'||bulkSessionsSourceState==='loading'||relationshipsSourceState==='loading'||websiteSnapshotsSourceState==='loading'?'loading':'unavailable'} title="Retained timeline unavailable" detail="The combined timeline requires readable cases, watchlists, saved Bulk sessions, relationship observations, and website snapshots. No empty history is inferred while any required collection is unavailable." />
  {/if}
</div>
{/if}

{#if view==='campaigns'}
<div id="monitor-view-panel" role="tabpanel" aria-labelledby="tab-campaigns">
  {#if campaignsSourceState==='ready'}
    <DeferredSurface load={()=>import('$lib/components/CampaignManager.svelte')} loadingLabel="Loading campaign workspace…" unavailableLabel="The campaign workspace could not be loaded." props={{records:cases,profiles:brandProfiles,relationshipSummary,cohortSourceStates:{cases:casesSourceState,profiles:brandProfilesSourceState,relationships:relationshipsSourceState},parentDomainSourceState:parentDomainCasesSourceState,initialCampaigns:campaigns,focusId:page.url.searchParams.get('campaign')||'',onselect:openRelatedCase,oncount:(count:number)=>campaignCount=count,onchange:(nextCampaigns:CampaignRecord[])=>{campaigns=nextCampaigns;refreshRelationships();}}} />
  {:else}
    <LocalCollectionState state={campaignsSourceState} title="Campaigns unavailable" detail="The browser-local campaign collection could not be read, so its count and mutation controls remain unavailable. Reload to retry without treating the collection as empty." />
  {/if}
</div>
{/if}

{#if view==='relationships'}
<div id="monitor-view-panel" role="tabpanel" aria-labelledby="tab-relationships">
  {#if websiteSnapshotsSourceState==='ready'}
    <DeferredSurface load={()=>import('$lib/components/WebsiteProfileClusters.svelte')} loadingLabel="Loading website-profile relationships…" unavailableLabel="Website-profile relationships could not be loaded." props={{summary:websiteProfileClusters,onpin:casesSourceState==='ready'?recordWebsiteClusterLead:null}} />
  {:else}
    <LocalCollectionState state={websiteSnapshotsSourceState} title="Website-profile relationships unavailable" detail="Saved website snapshots could not be read, so no missing cluster is inferred and review-lead recording from that source remains unavailable." />
  {/if}
  {#if relationshipsSourceState==='ready'}
    <DeferredSurface load={()=>import('$lib/components/RetainedRelationshipObservations.svelte')} loadingLabel="Loading retained relationship observations…" unavailableLabel="Retained relationship observations could not be loaded." props={{records:retainedRelationships,focusId:page.url.searchParams.get('observation')||'',ondelete:removeRetainedRelationship}} />
  {:else}
    <LocalCollectionState state={relationshipsSourceState} title="Retained relationships unavailable" detail="Retained relationship observations could not be read, so their count and deletion controls remain unavailable." />
  {/if}
  {#if casesSourceState==='ready'}
    {#if campaignsSourceState==='ready'&&relationshipsSourceState==='ready'}
      <DeferredSurface load={()=>import('$lib/components/CaseRelationshipClusters.svelte')} loadingLabel="Loading Case relationship clusters…" unavailableLabel="Case relationship clusters could not be loaded." props={{summary:relationshipClusters}} />
    {:else}
      <LocalCollectionState state={campaignsSourceState==='loading'||relationshipsSourceState==='loading'?'loading':'unavailable'} title="Relationship augmentation incomplete" detail="Readable Case evidence remains below. Campaign or retained-relationship augmentation could not be fully loaded, so combined relationship counts remain unavailable rather than being inferred as zero." />
    {/if}
    <DeferredSurface load={()=>import('$lib/components/CaseRelationshipWorkspace.svelte')} loadingLabel="Loading Case relationship workspace…" unavailableLabel="The Case relationship workspace could not be loaded. Retained Cases remain available in the Cases view." props={{records:cases,summary:relationshipSummary,onselect:openRelatedCase}} />
  {:else}
    <LocalCollectionState state={casesSourceState} title="Case relationships unavailable" detail="Cases must be readable before cross-case relationships can be projected. Readable website-profile and retained-relationship evidence remains separately attributed above." />
  {/if}
</div>
{/if}

{#if view==='rules'}
<div id="monitor-view-panel" role="tabpanel" aria-labelledby="tab-rules">
  {#if detectionRulesSourceState==='ready'}
    <DeferredSurface load={()=>import('$lib/components/DetectionRuleManager.svelte')} loadingLabel="Loading detection-rule workspace…" unavailableLabel="The detection-rule workspace could not be loaded." props={{records:cases,caseSourceState:casesSourceState,initialRules:detectionRules,onselect:openRelatedCase,oncount:(count:number)=>customRuleCount=count,onchange:(nextRules:DetectionRule[])=>detectionRules=nextRules}} />
  {:else}
    <LocalCollectionState state={detectionRulesSourceState} title="Custom rules unavailable" detail="The browser-local rule collection could not be read, so its count and mutation controls remain unavailable. No empty rule collection is inferred." />
  {/if}
</div>
{/if}

{#if view==='cases'}
<div id="monitor-view-panel" role="tabpanel" aria-labelledby="tab-cases" aria-busy={casesRefreshing}>
  {#if casesSourceState==='ready'}
  {#if casesRefreshing}<p class="refresh-status" role="status" aria-live="polite">Refreshing Cases while the last readable snapshot remains available.</p>{/if}
  {#if guidedDomains.length}<DeferredSurface load={()=>import('$lib/components/GuidedCaseQueue.svelte')} loadingLabel="Loading guided Case queue…" unavailableLabel="The guided Case queue could not be loaded." onready={restoreGuidedQueueTarget} props={{domains:guidedDomains,existingDomains:existingCaseDomains,truncated:guidedDomainsTruncated,openDomain:openGuidedCase}} />{/if}
  <DeferredSurface load={()=>import('$lib/components/CaseWorkspaceToolbar.svelte')} loadingLabel="Loading Case workspace controls…" unavailableLabel="Case workspace controls could not be loaded." props={{domain:newDomain,setDomain:(value:string)=>newDomain=value,trackDomain,caseCount:cases.length,calibrationSelectedCount:calibrationCaseIds.length,downloadCases,reviewCalibrationDataset,importCaseFile,message:caseMessage}} />
  {#if calibrationReview}
    <DeferredSurface load={()=>import('$lib/components/CalibrationExportReview.svelte')} loadingLabel="Loading calibration export review…" unavailableLabel="Calibration export review could not be loaded." props={{preview:calibrationReview,busy:calibrationExportBusy,confirm:downloadCalibrationDataset,cancel:()=>{if(!calibrationExportBusy)calibrationReview=null;}}} />
  {/if}
  <details class="advanced-case-tools">
    <summary>Advanced Case tools</summary>
    <p>Calibration is a secondary reference for reviewing how triage performed.</p>
    <DeferredSurface load={()=>import('$lib/components/RiskCalibrationDashboard.svelte')} loadingLabel="Loading risk-calibration reference…" unavailableLabel="Risk-calibration reference could not be loaded." />
  </details>
  <DeferredSurface load={()=>import('$lib/components/ExternalFindingsImport.svelte')} loadingLabel="Loading external-findings import…" unavailableLabel="External-findings import could not be loaded." props={{cases,oncomplete:refreshCases,oncommitted:installCommittedCaseSnapshot,onmessage:(value:string)=>caseMessage=value}} />

  {#if cases.length}
    <DeferredSurface load={()=>import('$lib/components/CaseFilters.svelte')} loadingLabel="Loading Case filters…" unavailableLabel="Case filters could not be loaded." props={{status:statusFilter,setStatus:(value:string)=>{statusFilter=value;casePage=1;},disposition:dispositionFilter,setDisposition:(value:string)=>{dispositionFilter=value;casePage=1;},search:caseSearch,setSearch:(value:string)=>{caseSearch=value;casePage=1;},sort:caseSort,setSort:(value:'updated'|'domain'|'status')=>{caseSort=value;casePage=1;},statusOptions:CASE_STATUSES,dispositionOptions:CASE_DISPOSITIONS,clear:()=>{clearCaseFilters();casePage=1;},matchedCount:filteredCases.length,totalCount:cases.length}} />

    <DeferredSurface load={()=>import('$lib/components/CaseList.svelte')} loadingLabel="Loading retained Cases…" unavailableLabel="The retained Case list could not be loaded." onready={restoreCaseListTarget} props={{records:pagedCases,allRecords:cases,expandedId,tagDraft,setTagDraft:(value:string)=>tagDraft=value,noteDraft,setNoteDraft:(value:string)=>noteDraft=value,pendingNoteCaseIds,calibrationCaseIds,toggleCalibrationCase,expand,setStatus,setDisposition,setReviewReason,addBrandProfileAssociation,removeBrandProfileAssociation,saveTags,addNote,removeCase,refreshCases,installCommittedCaseSnapshot,setMessage:(value:string)=>caseMessage=value,formatDate:date,currentPage:currentCasePage,pageCount:casePageCount,setPage:setCasePage,brandProfiles,brandProfilesUnavailable,responseCaseId:page.url.hash===`#case-response-${encodeURIComponent(expandedId)}`||(page.url.searchParams.get('response')==='1'&&page.url.searchParams.get('case')===expandedId)?expandedId:''}} />
  {:else}
    <section class="empty-state card"><h2>No cases yet</h2><p>Open a case from a Lookup result, a Bulk row, or the form above to start a documented investigation record.</p><a href="/lookup">Open Lookup →</a></section>
  {/if}
  {:else}
    <LocalCollectionState state={casesSourceState} title="Cases unavailable" detail="Browser-local cases could not be read, so the count, empty state, imports, and mutations remain unavailable. Reload to retry without overwriting unknown saved work." />
  {/if}
</div>
{/if}

{#if view==='watchlists'}
<div id="monitor-view-panel" role="tabpanel" aria-labelledby="tab-watchlists" aria-busy={watchlistsRefreshing}>
  {#if watchlistsSourceState==='ready'}
    {#if watchlistsRefreshing}<p class="refresh-status" role="status" aria-live="polite">Refreshing watchlists while the last readable snapshot remains available.</p>{/if}
    <DeferredSurface load={()=>import('$lib/components/MonitorActivityHeatmap.svelte')} loadingLabel="Loading watchlist activity…" unavailableLabel="Watchlist activity could not be loaded." props={{events:watchlistActivity}} />
    <DeferredSurface load={()=>import('$lib/components/WatchlistWorkspace.svelte')} loadingLabel="Loading watchlist workspace…" unavailableLabel="The watchlist workspace could not be loaded." onready={restoreWatchlistTarget} props={{watchlists,names,entry,selected,setSelected:(value:string)=>selected=value,history,changedOnly,setChangedOnly:(value:boolean)=>changedOnly=value,message,downloadWatchlists,importFile,clearAll,rescan,remove,openCase:openWatchlistCase,formatDate:date}} />
    <DeferredSurface load={()=>import('$lib/components/HostedWatchlistManager.svelte')} loadingLabel="Loading hosted watchlist controls…" unavailableLabel="Hosted watchlist controls could not be loaded." props={{capability:scheduledCapability,localWatchlists:watchlists,localNames:names,restoreHosted:restoreHostedWatchlist,formatDate:date}} />
  {:else}
    <LocalCollectionState state={watchlistsSourceState} title="Watchlists unavailable" detail="Browser-local watchlists could not be read, so their count, empty state, imports, hosted restore, and mutations remain unavailable. Reload to retry without overwriting unknown saved work." />
  {/if}
</div>
{/if}

<style>
  :global(#watchlist-activity){margin-bottom:16px}
  .case-message{margin:12px 2px;color:var(--accent);font-size:var(--text-sm)}
  .refresh-status{margin:10px 2px;color:var(--muted);font-size:var(--text-xs)}
  .local-context-status{margin:12px 2px;color:var(--amber);font-size:var(--text-sm)}
  .advanced-case-tools{margin:12px 0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .advanced-case-tools summary{cursor:pointer;font:700 var(--text-sm) var(--mono)}
  .advanced-case-tools>p{color:var(--muted);font-size:var(--text-sm)}
</style>
