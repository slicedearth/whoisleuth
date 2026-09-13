<script lang="ts">
  import { page } from '$app/state';
  import { getContext, onDestroy, tick, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { parseBoundedJson } from '$lib/bounded-json';
  import { BrowserLocalDataError } from '$lib/browser-local-data.ts';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import { setCaseNavigationContext } from '$lib/console-workflow-state';
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
  import { buildInvestigationCaseRelationships } from '$lib/analysis/case-relationships.ts';
  import { buildCaseRelationshipClusters } from '$lib/analysis/case-relationship-clusters.ts';
  import { buildCaseDecisionQualityReport } from '$lib/analysis/case-decision-quality.ts';
  import { preloadBestEffort } from '$lib/idle-preload';
  import {
    appendUnavailableCollectionStatus,
    buildMonitorNavigationUrl,
    createMonitorCollectionLoader,
    monitorRouteKey,
    monitorRouteTarget,
    monitorViewCollections,
    monitorViewFromUrl,
    canonicalCaseUrl,
    monitorWorkflowForView,
    type MonitorCollection,
    type MonitorFocus,
    type MonitorView,
  } from '$lib/controllers/monitor-route-controller.ts';
  import { buildInvestigationProjection } from '$lib/analysis/investigation-projection.ts';
  import type { ParentDomainCampaignSourceState } from '$lib/analysis/parent-domain-campaign-review.ts';
  import { deleteWatchlist, exportWatchlists, importWatchlists, loadWatchlists, MAX_WATCHLIST_IMPORT_BYTES, restoreHostedWatchlist as restoreHostedWatchlistAtomically, writeWatchlists, type WatchlistEntry, type Watchlists } from '$lib/watchlists';
  import { editCase, loadCases, openCase, type CaseRecord } from '$lib/cases';
  import { casesForDomain } from '$lib/analysis/case-model.ts';
  import { loadCampaigns, type CampaignRecord } from '$lib/campaigns';
  import { loadDetectionRules, type DetectionRule } from '$lib/detection-rules';
  import {
    deleteRelationshipObservation,
    loadRelationshipObservations,
    type RelationshipObservation,
  } from '$lib/relationship-observations';
  import { CAPABILITY_CONTEXT, featureCapability, type CapabilityGetter } from '$lib/capabilities';
  import { loadBulkSessions } from '$lib/bulk-sessions';
  import { loadAnalystReviewState, saveAnalystReviewDecision } from '$lib/analyst-review-state';
  import type { BulkSession } from '$lib/analysis/bulk-session-model.ts';
  import { createRetainedReviewController, type RetainedReviewPreparation } from '$lib/controllers/retained-review-controller.ts';
  import { analystReviewRequiredSourceState } from '$lib/analysis/analyst-review-source-state.ts';
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
  import {
    buildWebsiteClusterAssertion,
    buildWebsiteProfileClusters,
    type WebsiteProfileCluster,
  } from '$lib/analysis/website-profile-clusters.ts';
  import { loadWebsiteSnapshots, type WebsiteProfileSnapshot } from '$lib/website-snapshots';
  const moduleController = new AbortController();
  const preloadModule = (load: () => Promise<unknown>) => preloadBestEffort(load, moduleController.signal);
  onDestroy(() => moduleController.abort());

  let view=$state<MonitorView>('inbox');
  const monitorWorkflow=$derived(monitorWorkflowForView(view));
  $effect(()=>{
    const currentUrl=page.url;
    const requested=monitorViewFromUrl(currentUrl);
    if(requested==='cases') { void goto(canonicalCaseUrl(currentUrl), {replaceState:true}); return; }
    untrack(()=>{
      view=requested;
    });
  });
  const capabilityReport=getContext<CapabilityGetter>(CAPABILITY_CONTEXT);
  const scheduledCapability=$derived(featureCapability(capabilityReport?.()||null,'scheduled_monitoring'));

  async function navigateMonitor(next:MonitorView,focus?:MonitorFocus){
    preloadMonitorView(next);
    view=next;
    await goto(buildMonitorNavigationUrl(page.url,next,focus),{noScroll:true,keepFocus:true});
  }
  function selectMonitorView(next:MonitorView){
    if(next===view)return;
    void navigateMonitor(next);
  }
  function preloadMonitorView(next:MonitorView){
    if(next==='certificates')preloadModule(()=>import('$lib/components/CertificateReviewInbox.svelte'));
    else if(next==='timeline')preloadModule(()=>Promise.all([import('$lib/components/RetainedEvidenceTimeline.svelte'),import('$lib/components/RetainedChangeReview.svelte')]));
    else if(next==='campaigns')preloadModule(()=>import('$lib/components/CampaignManager.svelte'));
    else if(next==='relationships')preloadModule(()=>Promise.all([import('$lib/components/WebsiteProfileClusters.svelte'),import('$lib/components/RetainedRelationshipObservations.svelte'),import('$lib/components/CaseRelationshipClusters.svelte'),import('$lib/components/CaseRelationshipWorkspace.svelte')]));
    else if(next==='rules')preloadModule(()=>import('$lib/components/DetectionRuleManager.svelte'));
    else if(next==='watchlists')preloadModule(()=>Promise.all([import('$lib/components/MonitorActivityHeatmap.svelte'),import('$lib/components/WatchlistWorkspace.svelte'),import('$lib/components/HostedWatchlistManager.svelte')]));
  }

  // --- Watchlists ---
  let watchlists=$state.raw<Watchlists>({});let selected=$state('');let changedOnly=$state(false);let message=$state('');
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
  // Collection owners replace complete snapshots; form drafts own deep reactivity.
  let cases=$state.raw<CaseRecord[]>([]);

  let casesSourceState=$state<'loading'|'ready'|'unavailable'>('loading');
  let parentDomainCasesSourceState=$state<ParentDomainCampaignSourceState>('loading');
  let brandProfiles=$state<BrandProfile[]>([]);

  let brandProfilesSourceState=$state<'loading'|'ready'|'unavailable'>('loading');
  let bulkSessions=$state.raw<BulkSession[]>([]);
  let bulkSessionsSourceState=$state<'loading'|'ready'|'unavailable'>('loading');
  let websiteSnapshots=$state.raw<WebsiteProfileSnapshot[]>([]);
  let websiteSnapshotsSourceState=$state<'loading'|'ready'|'unavailable'>('loading');
  let analystReviewState=$state.raw<AnalystReviewStateStore>(emptyAnalystReviewStateStore());
  let analystReviewStateSourceState=$state<'loading'|'ready'|'unavailable'>('loading');
  let certificateReviewCount=$state<number|null>(null);
  let reviewInboxCount=$state<number|null>(null);
  const websiteProfileClusters=$derived(buildWebsiteProfileClusters(websiteSnapshots));
  const debtInput=$derived({cases,bulkSessions,sourceStates:{cases:casesSourceState,bulk:bulkSessionsSourceState}});
  let debtPreparation=$state.raw<RetainedReviewPreparation<'debt'>|null>(null);
  const debtController=createRetainedReviewController('debt',(next)=>debtPreparation=next);
  const evidenceDebtReview=$derived(debtPreparation?.result??null);
  const debtRefreshDisabled=$derived(casesSourceState==='loading'||bulkSessionsSourceState==='loading'||debtPreparation?.state==='loading');
  const decisionQuality=$derived(buildCaseDecisionQualityReport(cases));

  let campaignCount=$state(0);
  let campaigns=$state<CampaignRecord[]>([]);
  let campaignsSourceState=$state<'loading'|'ready'|'unavailable'>('loading');
  let retainedRelationships=$state.raw<RelationshipObservation[]>([]);
  let relationshipsSourceState=$state<'loading'|'ready'|'unavailable'>('loading');
  const investigationProjection=$derived(buildInvestigationProjection({cases,campaigns,relationshipObservations:retainedRelationships}));
  const timelineInput=$derived({cases,bulkSessions,watchlists,relationships:retainedRelationships,websiteSnapshots,reviewState:analystReviewState});
  const timelineSourceStates=$derived([casesSourceState,watchlistsSourceState,bulkSessionsSourceState,relationshipsSourceState,websiteSnapshotsSourceState,analystReviewStateSourceState]);
  const timelineSourceState=$derived(timelineSourceStates.includes('unavailable')?'unavailable':timelineSourceStates.includes('loading')?'loading':'ready');
  let timelinePreparation=$state.raw<RetainedReviewPreparation<'timeline'>|null>(null);
  const timelineController=createRetainedReviewController('timeline',(next)=>timelinePreparation=next);
  const retainedTimeline=$derived(timelinePreparation?.result??null);
  const timelineRefreshDisabled=$derived(timelinePreparation?.state==='loading');
  $effect(()=>{
    const input=casesSourceState==='loading'||bulkSessionsSourceState==='loading'?null:debtInput;
    const enabled=view==='inbox';
    untrack(()=>debtController.select(input,enabled));
  });
  $effect(()=>{
    const input=timelineSourceState==='ready'?timelineInput:null;
    const enabled=view==='timeline';
    untrack(()=>timelineController.select(input,enabled));
  });
  onDestroy(()=>{debtController.dispose();timelineController.dispose();});
  let customRuleCount=$state(0);
  let detectionRules=$state<DetectionRule[]>([]);
  let detectionRulesSourceState=$state<'loading'|'ready'|'unavailable'>('loading');
  const reviewInboxSourceState=$derived(analystReviewRequiredSourceState({
    cases:casesSourceState,
    watchlists:watchlistsSourceState,
    bulk_sessions:bulkSessionsSourceState,
    brand_profiles:brandProfilesSourceState,
    detection_rules:detectionRulesSourceState,
    website_snapshots:websiteSnapshotsSourceState,
    analyst_review_state:analystReviewStateSourceState,
  }));
  let localContextStatus=$state('');
  const relationshipSummary=$derived(buildInvestigationCaseRelationships(investigationProjection));
  const relationshipClusters=$derived(buildCaseRelationshipClusters(relationshipSummary));
  const relationshipCount=$derived(relationshipSummary.groups.length+retainedRelationships.length+websiteProfileClusters.clusters.length);

  let caseMessage=$state('');

  async function refreshRetainedRelationships(){relationshipsSourceState='loading';try{retainedRelationships=await loadRelationshipObservations();relationshipsSourceState='ready';}catch(cause){relationshipsSourceState='unavailable';throw cause;}}
  async function removeRetainedRelationship(record:RelationshipObservation){
    if(!confirm(`Delete the retained ${record.label.toLowerCase()} observation for ${record.domains.length} domain${record.domains.length===1?'':'s'}?`))return;
    try{
      retainedRelationships=await deleteRelationshipObservation(record.id);
      caseMessage=`Deleted the retained relationship observation. Source cases and watchlists were not changed.`;
    }catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not delete the retained relationship observation.';}
  }
  function parentDomainCaseFailureState(cause:unknown):ParentDomainCampaignSourceState{return cause instanceof BrowserLocalDataError&&cause.code==='LOCAL_DATA_FUTURE_SCHEMA'?'future_schema':'unavailable';}
  async function refreshCases() {
    const hadSnapshot = casesSourceState === 'ready';
    try {
      cases = await loadCases();
      casesSourceState = 'ready';
      parentDomainCasesSourceState = 'ready';
    } catch (cause) {
      parentDomainCasesSourceState = hadSnapshot ? 'partial' : parentDomainCaseFailureState(cause);
      if (!hadSnapshot) casesSourceState = 'unavailable';
      throw cause;
    }
  }
  function installCommittedCaseSnapshot(committedCases: CaseRecord[], sourceState: ParentDomainCampaignSourceState = 'ready') {
    cases = committedCases;
    casesSourceState = sourceState === 'ready' || sourceState === 'partial' ? 'ready' : 'unavailable';
    parentDomainCasesSourceState = sourceState;
  }
  async function reconcileCommittedCaseSnapshot(committed: { cases: CaseRecord[]; pruned: number }, success: string) {
    try {
      await refreshCases();
      caseMessage = `${success}${prunedNote(committed.pruned)}`;
    } catch {
      installCommittedCaseSnapshot(committed.cases, 'partial');
      caseMessage = `${success} The change was saved, but Cases could not be reread. The complete committed Case snapshot is shown locally; reload to retry the workspace read.${prunedNote(committed.pruned)}`;
    }
  }
  async function reconcileCommittedCaseMutation(committed: Awaited<ReturnType<typeof editCase>>, success: string) {
    await reconcileCommittedCaseSnapshot(committed, success);
  }

  async function openRelatedCase(record: CaseRecord, notice = '') {
    setCaseNavigationContext(record.id, `${page.url.pathname}${page.url.search}${page.url.hash}`, monitorWorkflow.title, notice);
    await goto(`/cases?case=${encodeURIComponent(record.id)}`);
  }
  function openEvidenceDebtCase(caseId:string){const record=cases.find((item)=>item.id===caseId);if(record)openRelatedCase(record);else caseMessage='That retained case is no longer available.';}

  async function openWatchlistCase(domain: string) {
    if(casesForDomain(cases,domain).length>1){await goto(`/cases?domain=${encodeURIComponent(domain)}`);return;}
    let committed: Awaited<ReturnType<typeof openCase>>;
    try { committed = await openCase({ domain, source: 'monitor' }); }
    catch (cause) { message = cause instanceof Error ? cause.message : 'Could not open the case.'; return; }
    const { record, created } = committed;
    await reconcileCommittedCaseSnapshot(committed,
      `${created ? `Opened a new case for ${record.domain}.` : `Opened the existing case for ${record.domain}.`} Watchlist history remains separately attributed.`);
    if (parentDomainCasesSourceState !== 'ready') {
      message = caseMessage;
      return;
    }
    await openRelatedCase(record, caseMessage);
  }

  async function recordWebsiteClusterLead(cluster:WebsiteProfileCluster,domain:string,caseId?:string){
    const opened=await openCase({domain,source:'website-profile-cluster'},caseId?{caseId}:{});
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
    if(item.kind!=='evidence_gap'||!item.caseId||!item.dismissalTarget)throw new Error('That evidence-gap review is no longer available.');
    const record=cases.find((candidate)=>candidate.id===item.caseId);
    const reasonLabel=analystReviewDismissalReasonLabel(reason);
    if(!record||!reasonLabel){caseMessage='That evidence-gap review is no longer available.';throw new Error(caseMessage);}
    let committed:Awaited<ReturnType<typeof editCase>>;
    try{
      committed=await editCase(record.id,{trailEvent:{
        kind:'review',
        summary:`Dismissed the current evidence-gap review: ${reasonLabel}.`,
        target:item.dismissalTarget,
      }});
    }catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not record the evidence-gap review.';throw cause;}
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

  let appliedMonitorRouteKey='';

  function restoreWatchlistTarget(){
    if(!page.url.searchParams.get('watchlist'))return;
    const target=document.getElementById('watchlist-history');
    target?.scrollIntoView({block:'start'});
    target?.focus({preventScroll:true});
  }

  async function applyMonitorRouteTarget(currentUrl: URL, routeKey: string, loadedWatchlists: Watchlists, watchlistState: typeof watchlistsSourceState) {
    if (routeKey === appliedMonitorRouteKey) return;
    const target = monitorRouteTarget(currentUrl);
    if (target.kind !== 'watchlist') { appliedMonitorRouteKey = routeKey; return; }
    if (watchlistState === 'loading') return;
    appliedMonitorRouteKey = routeKey;
    if (watchlistState !== 'ready' || !Object.hasOwn(loadedWatchlists, target.name)) return;
    selected = target.name;
    changedOnly = false;
    await tick();
    if (monitorRouteKey(page.url) !== routeKey) return;
    restoreWatchlistTarget();
  }

  $effect(()=>{
    const currentUrl=new URL(page.url);
    const routeKey=monitorRouteKey(currentUrl);
    const loadedWatchlists=watchlists;
    const watchlistState=watchlistsSourceState;
    untrack(()=>{void applyMonitorRouteTarget(currentUrl,routeKey,loadedWatchlists,watchlistState);});
  });

  const collectionLoader=createMonitorCollectionLoader();
  function noteUnavailableCollection(label:string){
    localContextStatus=appendUnavailableCollectionStatus(localContextStatus,label);
  }
  function loadCollection(key:MonitorCollection,work:()=>Promise<void>):Promise<void>{
    return collectionLoader.load(key,work);
  }
  function ensureWatchlists(){return loadCollection('watchlists',async()=>{try{await refresh();}catch{noteUnavailableCollection('watchlists');}});}
  function ensureCases(){return loadCollection('cases',async()=>{try{await refreshCases();}catch{noteUnavailableCollection('cases');}});}
  function ensureRelationships(){return loadCollection('relationships',async()=>{try{await refreshRetainedRelationships();}catch{noteUnavailableCollection('retained relationships');}});}
  function ensureBulkSessions(){return loadCollection('bulk-sessions',async()=>{try{bulkSessions=await loadBulkSessions();bulkSessionsSourceState='ready';}catch{bulkSessionsSourceState='unavailable';noteUnavailableCollection('Bulk sessions');}});}
  function ensureWebsiteSnapshots(){return loadCollection('website-snapshots',async()=>{try{websiteSnapshots=await loadWebsiteSnapshots();websiteSnapshotsSourceState='ready';}catch{websiteSnapshotsSourceState='unavailable';noteUnavailableCollection('website profiles');}});}
  function ensureCampaigns(){return loadCollection('campaigns',async()=>{try{campaigns=await loadCampaigns();campaignCount=campaigns.length;campaignsSourceState='ready';}catch{campaignsSourceState='unavailable';noteUnavailableCollection('campaigns');}});}
  function ensureRules(){return loadCollection('rules',async()=>{try{detectionRules=await loadDetectionRules();customRuleCount=detectionRules.length;detectionRulesSourceState='ready';}catch{detectionRulesSourceState='unavailable';noteUnavailableCollection('rules');}});}
  function ensureProfiles(){return loadCollection('profiles',async()=>{try{brandProfiles=await loadProfiles();brandProfilesSourceState='ready';}catch{brandProfilesSourceState='unavailable';noteUnavailableCollection('Brand Profiles');}});}
  function ensureAnalystReviewState(){return loadCollection('analyst-review-state',async()=>{try{analystReviewState=await loadAnalystReviewState();analystReviewStateSourceState='ready';}catch{analystReviewStateSourceState='unavailable';noteUnavailableCollection('analyst Review Item lifecycle');}});}
  const collectionEnsurers:Record<MonitorCollection,()=>Promise<void>>={
    'analyst-review-state':ensureAnalystReviewState,
    'bulk-sessions':ensureBulkSessions,
    campaigns:ensureCampaigns,
    cases:ensureCases,
    profiles:ensureProfiles,
    relationships:ensureRelationships,
    rules:ensureRules,
    watchlists:ensureWatchlists,
    'website-snapshots':ensureWebsiteSnapshots,
  };
  async function ensureMonitorViewData(next:MonitorView){
    await Promise.all(monitorViewCollections(next).map((key)=>collectionEnsurers[key]()));
  }
  $effect(()=>{
    const selectedView=view;
    untrack(()=>{preloadMonitorView(selectedView);void ensureMonitorViewData(selectedView);});
  });
</script>

<svelte:head><title>{monitorWorkflow.title} · WHOISleuth</title></svelte:head>
<PageHeading eyebrow={monitorWorkflow.eyebrow} title={monitorWorkflow.title} description={monitorWorkflow.description} />

<MonitorViewTabs {view} counts={{
  inbox:reviewInboxSourceState==='ready'?reviewInboxCount:null,
  timeline:timelineSourceState==='ready'&&timelinePreparation?.state==='ready'?retainedTimeline?.counts.all??null:null,
  cases:casesSourceState==='ready'?cases.length:null,
  campaigns:campaignsSourceState==='ready'?campaignCount:null,
  relationships:casesSourceState==='ready'&&campaignsSourceState==='ready'&&relationshipsSourceState==='ready'&&websiteSnapshotsSourceState==='ready'?relationshipCount:null,
  rules:detectionRulesSourceState==='ready'?customRuleCount:null,
  watchlists:watchlistsSourceState==='ready'?names.length:null,
  certificates:certificateReviewCount,
}} countStates={{
  inbox:reviewInboxSourceState==='ready'?(reviewInboxCount===null?'loading':'ready'):reviewInboxSourceState,
  timeline:timelineSourceState!=='ready'?timelineSourceState:timelinePreparation?.state==='unavailable'?'unavailable':timelinePreparation?.state==='ready'?'ready':'loading',
  cases:casesSourceState,
  campaigns:campaignsSourceState,
  relationships:[casesSourceState,campaignsSourceState,relationshipsSourceState,websiteSnapshotsSourceState].includes('unavailable')?'unavailable':[casesSourceState,campaignsSourceState,relationshipsSourceState,websiteSnapshotsSourceState].includes('loading')?'loading':'ready',
  rules:detectionRulesSourceState,
  watchlists:watchlistsSourceState,
  certificates:[casesSourceState,brandProfilesSourceState,analystReviewStateSourceState].includes('unavailable')?'unavailable':certificateReviewCount===null?'loading':'ready',
}} preloadView={preloadMonitorView} setView={selectMonitorView} />
{#if localContextStatus}<p class="local-context-status" role="status">{localContextStatus}</p>{/if}

{#if view==='inbox'}
<div id="monitor-view-panel" role="tabpanel" aria-labelledby="tab-inbox">
  {#if reviewInboxSourceState==='ready'}
    <UnifiedAnalystReviewInbox {cases} {watchlists} {bulkSessions} profiles={brandProfiles} {detectionRules} {websiteSnapshots} reviewState={analystReviewState} selectedSubjectKey={page.url.searchParams.get('review')??''} ondismiss={dismissEvidenceGap} onreview={recordAnalystReviewDecision} oncount={(count:number)=>reviewInboxCount=count} />
    {#if caseMessage}<p class="case-message" role="status" aria-live="polite">{caseMessage}</p>{/if}
  {:else}
    <LocalCollectionState state={reviewInboxSourceState} title="Review inbox evidence unavailable" detail="Cases, watchlists, saved Bulk sessions, Brand Profiles, custom rules, website snapshots, and the analyst lifecycle overlay must all be readable before the combined inbox can distinguish zero review items from missing saved state. Fulfilled collections remain available in their own views." />
  {/if}
  {#if cases.length || bulkSessions.length || casesSourceState==='unavailable' || bulkSessionsSourceState==='unavailable'}
    <div class="retained-preparation" aria-busy={debtPreparation?.state==='loading'}>
      <div class="review-controls">
        <p role="status">{#if debtPreparation?.state==='unavailable'}{debtPreparation.error}{#if evidenceDebtReview?.evaluatedAt} Showing the review from {date(evidenceDebtReview.evaluatedAt)}.{/if}{:else if debtPreparation?.state!=='ready'}Preparing evidence gaps locally…{#if evidenceDebtReview} The previous review remains visible.{/if}{:else if evidenceDebtReview?.evaluatedAt}Reviewed {date(evidenceDebtReview.evaluatedAt)}{/if}</p>
        <button type="button" class="btn" aria-disabled={debtRefreshDisabled} onclick={()=>{if(!debtRefreshDisabled)debtController.prepare(debtInput,true);}}>{debtPreparation?.state==='unavailable'?'Retry evidence gaps':'Refresh evidence gaps'}</button>
      </div>
      {#if evidenceDebtReview}<EvidenceDebtMatrix review={evidenceDebtReview} oncase={openEvidenceDebtCase} />{/if}
    </div>
  {/if}
  {#if casesSourceState==='ready' && cases.length}
    <details class="monitor-reports">
      <summary>Case reports and follow-up tools</summary>
      <BrandProtectionOperationsReport records={cases} sourceState={casesSourceState} />
      <CaseDecisionQuality report={decisionQuality} />
      <CaseLifecycleReview records={cases} />
    </details>
  {/if}
</div>
{/if}

{#if view==='certificates'}
<div id="monitor-view-panel" role="tabpanel" aria-labelledby="tab-certificates">
  {#if casesSourceState==='ready'&&brandProfilesSourceState==='ready'&&analystReviewStateSourceState==='ready'}
    <DeferredSurface load={()=>import('$lib/components/CertificateReviewInbox.svelte')} loadingLabel="Loading retained certificate review…" unavailableLabel="The certificate review inbox could not be loaded." props={{profiles:brandProfiles,cases,reviewState:analystReviewState,profileId:page.url.searchParams.get('profile')??'',onreview:recordAnalystReviewDecision,oncount:(count:number)=>certificateReviewCount=count}} placeholder="workspace" />
    {#if caseMessage}<p class="case-message" role="status" aria-live="polite">{caseMessage}</p>{/if}
  {:else}
    <LocalCollectionState state={casesSourceState==='loading'||brandProfilesSourceState==='loading'||analystReviewStateSourceState==='loading'?'loading':'unavailable'} title="Certificate review unavailable" detail="Readable Brand Profiles, retained Cases, and the analyst lifecycle overlay are required. Missing collections are not treated as empty certificate evidence." />
  {/if}
</div>
{/if}

{#if view==='timeline'}
<div id="monitor-view-panel" role="tabpanel" aria-labelledby="tab-timeline">
  {#if timelineSourceState==='ready'}
    <div class="retained-preparation" aria-busy={timelinePreparation?.state==='loading'}>
      <div class="review-controls">
        <p role="status">{#if timelinePreparation?.state==='unavailable'}{timelinePreparation.error}{#if retainedTimeline?.evaluatedAt} Showing the review from {date(retainedTimeline.evaluatedAt)}.{/if}{:else if timelinePreparation?.state!=='ready'}Preparing the timeline locally…{#if retainedTimeline} The previous review remains visible.{/if}{:else if retainedTimeline?.evaluatedAt}Reviewed {date(retainedTimeline.evaluatedAt)}{/if}</p>
        <button type="button" class="btn" aria-disabled={timelineRefreshDisabled} onclick={()=>{if(!timelineRefreshDisabled)timelineController.prepare(timelineInput,true);}}>{timelinePreparation?.state==='unavailable'?'Retry timeline':'Refresh timeline'}</button>
      </div>
      {#if retainedTimeline}<DeferredSurface load={()=>import('$lib/components/RetainedEvidenceTimeline.svelte')} loadingLabel="Loading retained evidence timeline…" unavailableLabel="The retained evidence timeline could not be loaded." props={{timeline:retainedTimeline}} placeholder="workspace" />{/if}
    </div>
    <DeferredSurface load={()=>import('$lib/components/RetainedChangeReview.svelte')} loadingLabel="Loading retained change review…" unavailableLabel="The retained change review could not be loaded." props={{cases,websiteSnapshots,watchlists,bulkSessions}} placeholder="workspace" />
  {:else}
    <LocalCollectionState state={timelineSourceState} title="Retained timeline unavailable" detail="The combined timeline requires readable Cases, watchlists, saved Bulk sessions, relationship observations, website snapshots, and analyst review decisions. No empty history is inferred while any required collection is unavailable." />
  {/if}
</div>
{/if}

{#if view==='campaigns'}
<div id="monitor-view-panel" role="tabpanel" aria-labelledby="tab-campaigns">
  {#if campaignsSourceState==='ready'}
    <DeferredSurface load={()=>import('$lib/components/CampaignManager.svelte')} loadingLabel="Loading campaign workspace…" unavailableLabel="The campaign workspace could not be loaded." props={{records:cases,profiles:brandProfiles,relationshipSummary,cohortSourceStates:{cases:casesSourceState,profiles:brandProfilesSourceState,relationships:relationshipsSourceState},parentDomainSourceState:parentDomainCasesSourceState,initialCampaigns:campaigns,focusId:page.url.searchParams.get('campaign')||'',onselect:openRelatedCase,oncount:(count:number)=>campaignCount=count,onchange:(nextCampaigns:CampaignRecord[])=>campaigns=nextCampaigns}} placeholder="workspace" />
  {:else}
    <LocalCollectionState state={campaignsSourceState} title="Campaigns unavailable" detail="The saved campaign collection could not be read, so its count and mutation controls remain unavailable. Reload to retry without treating the collection as empty." />
  {/if}
</div>
{/if}

{#if view==='relationships'}
<div id="monitor-view-panel" role="tabpanel" aria-labelledby="tab-relationships">
  {#if websiteSnapshotsSourceState==='ready'}
    <DeferredSurface load={()=>import('$lib/components/WebsiteProfileClusters.svelte')} loadingLabel="Loading website-profile relationships…" unavailableLabel="Website-profile relationships could not be loaded." props={{summary:websiteProfileClusters,cases,onpin:casesSourceState==='ready'?recordWebsiteClusterLead:null}} placeholder="workspace" />
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
    <DeferredSurface load={()=>import('$lib/components/CaseRelationshipWorkspace.svelte')} loadingLabel="Loading Case relationship workspace…" unavailableLabel="The Case relationship workspace could not be loaded. Retained Cases remain available in the Cases view." props={{records:cases,summary:relationshipSummary,onselect:openRelatedCase}} placeholder="workspace" />
  {:else}
    <LocalCollectionState state={casesSourceState} title="Case relationships unavailable" detail="Cases must be readable before cross-case relationships can be projected. Readable website-profile and retained-relationship evidence remains separately attributed above." />
  {/if}
</div>
{/if}

{#if view==='rules'}
<div id="monitor-view-panel" role="tabpanel" aria-labelledby="tab-rules">
  {#if detectionRulesSourceState==='ready'}
    <DeferredSurface load={()=>import('$lib/components/DetectionRuleManager.svelte')} loadingLabel="Loading detection-rule workspace…" unavailableLabel="The detection-rule workspace could not be loaded." props={{records:cases,caseSourceState:casesSourceState,initialRules:detectionRules,onselect:openRelatedCase,oncount:(count:number)=>customRuleCount=count,onchange:(nextRules:DetectionRule[])=>detectionRules=nextRules}} placeholder="workspace" />
  {:else}
    <LocalCollectionState state={detectionRulesSourceState} title="Custom rules unavailable" detail="The saved rule collection could not be read, so its count and mutation controls remain unavailable. No empty rule collection is inferred." />
  {/if}
</div>
{/if}

{#if view==='watchlists'}
<div id="monitor-view-panel" role="tabpanel" aria-labelledby="tab-watchlists" aria-busy={watchlistsRefreshing}>
  {#if watchlistsSourceState==='ready'}
    {#if watchlistsRefreshing}<p class="refresh-status" role="status" aria-live="polite">Refreshing watchlists while the last readable snapshot remains available.</p>{/if}
    <DeferredSurface load={()=>import('$lib/components/MonitorActivityHeatmap.svelte')} loadingLabel="Loading watchlist activity…" unavailableLabel="Watchlist activity could not be loaded." props={{events:watchlistActivity}} />
    <DeferredSurface load={()=>import('$lib/components/WatchlistWorkspace.svelte')} loadingLabel="Loading watchlist workspace…" unavailableLabel="The watchlist workspace could not be loaded." onready={restoreWatchlistTarget} props={{watchlists,names,entry,selected,setSelected:(value:string)=>selected=value,history,changedOnly,setChangedOnly:(value:boolean)=>changedOnly=value,message,downloadWatchlists,importFile,clearAll,rescan,remove,openCase:openWatchlistCase,formatDate:date}} placeholder="workspace" />
  {:else}
    <LocalCollectionState state={watchlistsSourceState} title="Watchlists unavailable" detail="Saved watchlists could not be read, so their count, empty state, imports, and local mutations remain unavailable. Reload to retry without overwriting unknown saved work." />
  {/if}
  <DeferredSurface load={()=>import('$lib/components/HostedWatchlistManager.svelte')} loadingLabel="Loading hosted watchlist controls…" unavailableLabel="Hosted watchlist controls could not be loaded." props={{capability:scheduledCapability,localWatchlists:watchlists,localNames:names,localSourceState:watchlistsSourceState,restoreHosted:restoreHostedWatchlist,formatDate:date}} />
</div>
{/if}

<style>
  .review-controls{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin:12px 0}
  .review-controls p{flex:1 1 220px;min-width:0;margin:0;color:var(--muted);font-size:var(--text-xs);overflow-wrap:anywhere}
  .review-controls .btn{max-width:100%}
  .review-controls .btn[aria-disabled='true']{cursor:not-allowed;opacity:.45}
  .monitor-reports{margin-top:20px;border-top:1px solid var(--border)}
  .monitor-reports>summary{padding:14px 0;cursor:pointer;font:650 var(--text-sm) var(--mono)}
  :global(#watchlist-activity){margin-bottom:16px}
  .case-message{margin:12px 2px;color:var(--accent);font-size:var(--text-sm)}
  .refresh-status{margin:10px 2px;color:var(--muted);font-size:var(--text-xs)}
  .local-context-status{margin:12px 2px;color:var(--amber);font-size:var(--text-sm)}
</style>
