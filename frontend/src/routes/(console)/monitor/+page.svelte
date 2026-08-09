<script lang="ts">
  import { page } from '$app/state';
  import { getContext, onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import AnalystReviewInbox from '$lib/components/AnalystReviewInbox.svelte';
  import EvidenceDebtMatrix from '$lib/components/EvidenceDebtMatrix.svelte';
  import CaseLifecycleReview from '$lib/components/CaseLifecycleReview.svelte';
  import BrandProtectionOperationsReport from '$lib/components/BrandProtectionOperationsReport.svelte';
  import CaseDecisionQuality from '$lib/components/CaseDecisionQuality.svelte';
  import MonitorViewTabs from '$lib/components/MonitorViewTabs.svelte';
  import CaseWorkspaceToolbar from '$lib/components/CaseWorkspaceToolbar.svelte';
  import CalibrationExportReview from '$lib/components/CalibrationExportReview.svelte';
  import ExternalFindingsImport from '$lib/components/ExternalFindingsImport.svelte';
  import GuidedCaseQueue from '$lib/components/GuidedCaseQueue.svelte';
  import CaseFilters from '$lib/components/CaseFilters.svelte';
  import CaseList from '$lib/components/CaseList.svelte';
  import WatchlistWorkspace from '$lib/components/WatchlistWorkspace.svelte';
  import HostedWatchlistManager from '$lib/components/HostedWatchlistManager.svelte';
  import MonitorActivityHeatmap from '$lib/components/MonitorActivityHeatmap.svelte';
  import RetainedEvidenceTimeline from '$lib/components/RetainedEvidenceTimeline.svelte';
  import RetainedChangeReview from '$lib/components/RetainedChangeReview.svelte';
  import WebsiteProfileClusters from '$lib/components/WebsiteProfileClusters.svelte';
  import { saveCandidateHandoff } from '$lib/candidate-handoff';
  import { loadProfiles, type BrandProfile } from '$lib/brand-profiles';
  import CampaignManager from '$lib/components/CampaignManager.svelte';
  import CaseRelationshipWorkspace from '$lib/components/CaseRelationshipWorkspace.svelte';
  import CaseRelationshipClusters from '$lib/components/CaseRelationshipClusters.svelte';
  import { registerAnalystUndo } from '$lib/analyst-undo';
  import DetectionRuleManager from '$lib/components/DetectionRuleManager.svelte';
  import RetainedRelationshipObservations from '$lib/components/RetainedRelationshipObservations.svelte';
  import { buildInvestigationCaseRelationships } from '$lib/analysis/case-relationships.ts';
  import { buildCaseRelationshipClusters } from '$lib/analysis/case-relationship-clusters.ts';
  import { buildCaseDecisionQualityReport } from '$lib/analysis/case-decision-quality.ts';
  import { parseDomainInput } from '$lib/analysis/utils.ts';
  import { buildInvestigationProjection } from '$lib/analysis/investigation-projection.ts';
  import { deleteWatchlist, exportWatchlists, importWatchlists, loadWatchlists, MAX_WATCHLIST_IMPORT_BYTES, writeWatchlists, type WatchlistEntry, type Watchlists } from '$lib/watchlists';
  import {
    addCaseBrandProfileAssociation, addCaseNote, CASE_DISPOSITIONS, CASE_STATUSES, deleteCase, dispositionLabel, editCase, exportCases,
    exportRiskCalibrationDataset, importCases, loadCases, MAX_CASE_IMPORT_BYTES, openCase,
    previewRiskCalibrationDataset, removeCaseBrandProfileAssociation, statusLabel, type CaseRecord, type RiskCalibrationExportPreview
  } from '$lib/cases';
  import { loadCampaigns, type CampaignRecord } from '$lib/campaigns';
  import { loadDetectionRules, type DetectionRule } from '$lib/detection-rules';
  import { unavailableLocalContextLabels } from '$lib/local-context-load.ts';
  import {
    deleteRelationshipObservation,
    loadRelationshipObservations,
    type RelationshipObservation,
  } from '$lib/relationship-observations';
  import { CAPABILITY_CONTEXT, featureCapability, type CapabilityGetter } from '$lib/capabilities';
  import { loadInvestigationGuide } from '$lib/investigation-guide';
  import { loadBulkSessions } from '$lib/bulk-sessions';
  import type { BulkSession } from '$lib/analysis/bulk-session-model.ts';
  import { buildEvidenceDebtReview } from '$lib/analysis/evidence-debt-review.ts';
  import {
    analystReviewDismissalReasonLabel,
    buildAnalystReviewInbox,
    type AnalystReviewDismissalReason,
    type AnalystReviewItem,
  } from '$lib/analysis/analyst-review-inbox.ts';
  import { buildRetainedEvidenceTimeline } from '$lib/analysis/retained-evidence-timeline.ts';
  import {
    buildWebsiteClusterAssertion,
    buildWebsiteProfileClusters,
    type WebsiteProfileCluster,
  } from '$lib/analysis/website-profile-clusters.ts';
  import { loadWebsiteSnapshots, type WebsiteProfileSnapshot } from '$lib/website-snapshots';

  type View = 'inbox' | 'timeline' | 'watchlists' | 'cases' | 'campaigns' | 'relationships' | 'rules';
  const CASE_PAGE_SIZE=25;
  let view=$state<View>('inbox');
  const capabilityReport=getContext<CapabilityGetter>(CAPABILITY_CONTEXT);
  const scheduledCapability=$derived(featureCapability(capabilityReport?.()||null,'scheduled_monitoring'));

  // --- Watchlists ---
  let watchlists=$state<Watchlists>({});let selected=$state('');let changedOnly=$state(false);let message=$state('');
  const names=$derived(Object.keys(watchlists).sort());const entry=$derived(selected?watchlists[selected]||null:null);const history=$derived(entry?(changedOnly?entry.history.filter(e=>e.changeCount>0):entry.history):[]);
  const watchlistActivity=$derived(Object.values(watchlists).flatMap((record)=>record.history.map((event)=>({
    checkedAt:event.checkedAt,
    changeCount:event.changeCount,
    resultCount:event.resultCount,
    conclusiveCount:event.conclusiveCount,
  }))));
  async function refresh(){watchlists=await loadWatchlists();if(selected&&!watchlists[selected])selected='';}
  function date(value:string){const parsed=new Date(value);return Number.isNaN(parsed.getTime())?value:parsed.toLocaleString();}
  async function remove(name:string){if(!confirm(`Delete watchlist "${name}" and its history?`))return;try{await deleteWatchlist(name);await refresh();message=`Deleted "${name}".`;}catch(cause){message=cause instanceof Error?cause.message:'Could not delete watchlist.';}}
  async function clearAll(){if(!names.length||!confirm('Delete every saved watchlist and its history?'))return;try{await writeWatchlists({});await refresh();message='Cleared all watchlists.';}catch(cause){message=cause instanceof Error?cause.message:'Could not clear watchlists.';}}
  async function downloadWatchlists(){try{await exportWatchlists();}catch(cause){message=cause instanceof Error?cause.message:'Could not export watchlists.';}}
  async function rescan(name:string){const current=watchlists[name];if(!current)return;const candidates=current.results.map(record=>({domain:String(record.domain),source:name,mutationTypes:Array.isArray(record.mutationTypes)?record.mutationTypes:[]}));const handoffResult=saveCandidateHandoff('watchlist',candidates);if(!handoffResult.saved){message='This browser could not retain the watchlist candidates for Bulk. Check site-storage access and try again.';return;}await goto(`/bulk?source=watchlist&handoff=${handoffResult.token}`);}
  async function importFile(event:Event){const input=event.currentTarget as HTMLInputElement;const file=input.files?.[0];if(!file)return;try{if(file.size>MAX_WATCHLIST_IMPORT_BYTES)throw new Error('Watchlist imports are limited to 2 MB.');const result=await importWatchlists(JSON.parse(await file.text()));const skipped=result.skipped?`; skipped ${result.skipped} invalid or over-limit watchlist${result.skipped===1?'':'s'}`:'';message=`Imported ${result.added} new and ${result.updated} updated watchlists${skipped}.`;await refresh();}catch(cause){message=cause instanceof Error?cause.message:'Import failed';}finally{input.value='';}}
  async function restoreHostedWatchlist(name:string,hostedEntry:WatchlistEntry){const all=await loadWatchlists();const existing=Object.keys(all).find(candidate=>candidate.toLowerCase()===name.toLowerCase());if(existing&&existing!==name)delete all[existing];Object.defineProperty(all,name,{value:hostedEntry,writable:true,enumerable:true,configurable:true});await writeWatchlists(all);await refresh();}

  // --- Cases ---
  let cases=$state<CaseRecord[]>([]);
  let casesSourceState=$state<'loading'|'ready'|'unavailable'>('loading');
  let brandProfiles=$state<BrandProfile[]>([]);
  let brandProfilesUnavailable=$state(true);
  let brandProfilesSourceState=$state<'loading'|'ready'|'unavailable'>('loading');
  let bulkSessions=$state<BulkSession[]>([]);
  let bulkSessionsSourceState=$state<'loading'|'ready'|'unavailable'>('loading');
  let websiteSnapshots=$state<WebsiteProfileSnapshot[]>([]);
  const websiteProfileClusters=$derived(buildWebsiteProfileClusters(websiteSnapshots));
  const reviewInbox=$derived(buildAnalystReviewInbox({cases,watchlists,bulkSessions}));
  const evidenceDebtReview=$derived(buildEvidenceDebtReview({
    cases,
    bulkSessions,
    sourceStates:{cases:casesSourceState,bulk:bulkSessionsSourceState},
  }));
  const decisionQuality=$derived(buildCaseDecisionQualityReport(cases));
  let casePage=$state(1);
  let campaignCount=$state(0);
  let campaigns=$state<CampaignRecord[]>([]);
  let investigationProjection=$state<unknown>(null);
  let retainedRelationships=$state<RelationshipObservation[]>([]);
  let relationshipsSourceState=$state<'loading'|'ready'|'unavailable'>('loading');
  const retainedTimeline=$derived(buildRetainedEvidenceTimeline({cases,bulkSessions,watchlists,relationships:retainedRelationships,websiteSnapshots}));
  let customRuleCount=$state(0);
  let detectionRules=$state<DetectionRule[]>([]);
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
  async function refreshCases(){casesSourceState='loading';try{cases=await loadCases();casesSourceState='ready';calibrationCaseIds=calibrationCaseIds.filter(id=>cases.some(record=>record.id===id));await refreshRelationships();if(expandedId&&!cases.some(record=>record.id===expandedId))expandedId='';}catch(cause){casesSourceState='unavailable';throw cause;}}
  function installCommittedCaseSnapshot(committedCases:CaseRecord[]){
    cases=committedCases;
    calibrationCaseIds=calibrationCaseIds.filter(id=>cases.some(item=>item.id===id));
    refreshRelationships();
    if(expandedId&&!cases.some(record=>record.id===expandedId))expandedId='';
  }
  function expand(record:CaseRecord){if(expandedId===record.id){expandedId='';return;}showCasePage(record);expandedId=record.id;tagDraft=record.tags.join(', ');noteDraft='';}
  function openRelatedCase(record:CaseRecord){view='cases';showCasePage(record);if(expandedId!==record.id)expand(record);void focusCase(record);}
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
    try{
      const{record,created,pruned}=await openCase({domain,source:'monitor'});
      await refreshCases();clearCaseFilters();casePage=1;showCasePage(record);view='cases';expandedId=record.id;tagDraft=record.tags.join(', ');noteDraft='';
      caseMessage=`${created?`Opened a new case for ${record.domain}.`:`Opened the existing case for ${record.domain}.`}${prunedNote(pruned)} Watchlist history remains separately attributed.`;
    }catch(cause){message=cause instanceof Error?cause.message:'Could not open the case.';}
  }
  async function openGuidedCase(domain:string){
    try{
      const{record,created,pruned}=await openCase({domain,source:'monitor'});
      await refreshCases();clearCaseFilters();casePage=1;showCasePage(record);view='cases';expandedId=record.id;tagDraft=record.tags.join(', ');noteDraft='';
      caseMessage=`${created?`Opened a new case for ${record.domain}.`:`Opened the existing case for ${record.domain}.`}${prunedNote(pruned)}`;
      if(page.url.searchParams.get('response')==='1')await focusResponsePreflight(record);else await focusCase(record);
    }catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not open the guided case.';}
  }
  async function recordWebsiteClusterLead(cluster:WebsiteProfileCluster,domain:string){
    const{record}=await openCase({domain,source:'website-profile-cluster'});
    const assertion=buildWebsiteClusterAssertion(cluster,domain);
    if(record.assertions.some((item)=>item.statement===assertion.statement&&item.state==='open')){
      throw new Error(`That website-profile review lead is already open for ${domain}.`);
    }
    await editCase(record.id,{assertion});
    await refreshCases();
    caseMessage=`Recorded a separately typed website-profile review lead for ${domain}.`;
  }
  async function dismissEvidenceGap(item:AnalystReviewItem,reason:AnalystReviewDismissalReason){
    if(item.kind!=='evidence_gap'||!item.caseId||!item.dismissalTarget)return;
    const record=cases.find((candidate)=>candidate.id===item.caseId);
    const reasonLabel=analystReviewDismissalReasonLabel(reason);
    if(!record||!reasonLabel){caseMessage='That evidence-gap review is no longer available.';return;}
    try{
      await editCase(record.id,{trailEvent:{
        kind:'review',
        summary:`Dismissed the current evidence-gap review: ${reasonLabel}.`,
        target:item.dismissalTarget,
      }});
      await refreshCases();
      caseMessage=`Recorded the reviewed evidence-gap dismissal for ${record.domain}. The underlying evidence and assertions were not changed.`;
    }catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not record the evidence-gap review.';}
  }
  function prunedNote(pruned:number){return pruned?` (pruned ${pruned} old evidence snapshot${pruned===1?'':'s'} to stay within storage)`:'';}
  async function trackDomain(){const domain=newDomain.trim();if(!domain){caseMessage='Enter a domain to track.';return;}try{const{record,created,pruned}=await openCase({domain,source:'monitor'});await refreshCases();newDomain='';showCasePage(record);expandedId=record.id;tagDraft=record.tags.join(', ');noteDraft='';caseMessage=`${created?`Opened a new case for ${record.domain}.`:`${record.domain} already has a case.`}${prunedNote(pruned)}`;}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not open the case.';}}
  async function setStatus(record:CaseRecord,value:string){try{const{pruned}=await editCase(record.id,{status:value});await refreshCases();showCasePage(record);caseMessage=`Set ${record.domain} to ${statusLabel(value)}.${prunedNote(pruned)}`;}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not update the case.';}}
  async function setDisposition(record:CaseRecord,value:string){try{const{pruned}=await editCase(record.id,{disposition:value});await refreshCases();showCasePage(record);caseMessage=`Marked ${record.domain} as ${dispositionLabel(value)}.${prunedNote(pruned)}`;}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not update the case.';}}
  async function setReviewReason(record:CaseRecord,value:string){try{const{pruned}=await editCase(record.id,{reviewReasonCode:value});await refreshCases();showCasePage(record);caseMessage=`Updated the review reason for ${record.domain}.${prunedNote(pruned)}`;}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not update the review reason.';}}
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
      installCommittedCaseSnapshot(committedCases);
      showCasePage(persisted);
      caseMessage=`Brand Profile association saved for ${persisted.domain}, but Cases could not be reread. The complete committed Case snapshot is shown locally; reload to retry the browser-local read.${prunedNote(pruned)}`;
    }
    return true;
  }
  function addBrandProfileAssociation(record:CaseRecord,profileId:string){return changeBrandProfileAssociation(record,profileId,'add');}
  function removeBrandProfileAssociation(record:CaseRecord,profileId:string){return changeBrandProfileAssociation(record,profileId,'remove');}
  async function saveTags(record:CaseRecord){const previous=[...record.tags];const next=tagDraft.split(/[,\n]+/).map(value=>value.trim()).filter(Boolean);if(previous.join('\\0')===next.join('\\0'))return;try{const{pruned}=await editCase(record.id,{tags:next});await refreshCases();showCasePage(record);caseMessage=`Updated tags for ${record.domain}.${prunedNote(pruned)}`;registerAnalystUndo({kind:'case_tags',action:'Case tags updated',affectedRecord:record.domain,undo:async()=>{await editCase(record.id,{tags:previous});await refreshCases();const restored=cases.find((item)=>item.id===record.id);if(restored&&expandedId===record.id)tagDraft=restored.tags.join(', ');return `Restored the previous tags for ${record.domain}.`;}});}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not update tags.';}}
  async function addNote(record:CaseRecord){const body=noteDraft.trim();if(!body){caseMessage='A note cannot be empty.';return;}try{const{pruned}=await addCaseNote(record.id,body);await refreshCases();showCasePage(record);noteDraft='';caseMessage=`Added a note to ${record.domain}.${prunedNote(pruned)}`;}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not add the note.';}}
  async function downloadCases(){try{await exportCases();}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not export cases.';}}
  function toggleCalibrationCase(record:CaseRecord,selected:boolean){calibrationReview=null;calibrationCaseIds=selected?[...new Set([...calibrationCaseIds,record.id])]:calibrationCaseIds.filter(id=>id!==record.id);}
  async function reviewCalibrationDataset(){try{calibrationReview=await previewRiskCalibrationDataset(calibrationCaseIds);}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not review the Risk calibration dataset.';}}
  async function downloadCalibrationDataset(){calibrationExportBusy=true;try{const result=await exportRiskCalibrationDataset(calibrationCaseIds);calibrationReview=null;caseMessage=`Exported ${result.included} reviewed case${result.included===1?'':'s'} for offline Risk calibration${result.excluded?`; excluded ${result.excluded} incompatible selection${result.excluded===1?'':'s'}`:''}. No model setting was changed.`;}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not export the Risk calibration dataset.';}finally{calibrationExportBusy=false;}}
  async function removeCase(record:CaseRecord){if(!confirm(`Delete the case for ${record.domain}? Its notes are removed unless you exported them.`))return;try{await deleteCase(record.id);if(expandedId===record.id)expandedId='';await refreshCases();caseMessage=`Deleted the case for ${record.domain}.`;}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not delete the case.';}}
  function clearCaseFilters(){statusFilter='';dispositionFilter='';caseSearch='';}
  async function importCaseFile(event:Event){const input=event.currentTarget as HTMLInputElement;const file=input.files?.[0];if(!file)return;try{if(file.size>MAX_CASE_IMPORT_BYTES)throw new Error('Case imports are limited to 2 MB.');const result=await importCases(JSON.parse(await file.text()));await refreshCases();caseMessage=`Imported ${result.added} new and ${result.updated} merged cases${result.skipped?`; skipped ${result.skipped} invalid or over-limit record${result.skipped===1?'':'s'}`:''}${result.brandProfileReferencesOmitted?`; omitted ${result.brandProfileReferencesOmitted} Brand Profile reference${result.brandProfileReferencesOmitted===1?'':'s'} beyond the retained bounds`:''}${prunedNote(result.pruned)}.`;}catch(cause){caseMessage=cause instanceof Error?cause.message:'Case import failed';}finally{input.value='';}}

  onMount(()=>{void (async()=>{
    const initialLoads=await Promise.allSettled([
      loadWatchlists(),loadCases(),loadRelationshipObservations(),loadBulkSessions(),
      loadWebsiteSnapshots(),loadCampaigns(),loadDetectionRules(),loadProfiles(),
    ]);
    const [watchlistResult,caseResult,relationshipResult,bulkResult,websiteResult,campaignResult,ruleResult,profileResult]=initialLoads;
    if(watchlistResult.status==='fulfilled'){watchlists=watchlistResult.value;if(selected&&!watchlists[selected])selected='';}
    if(caseResult.status==='fulfilled'){cases=caseResult.value;casesSourceState='ready';}else casesSourceState='unavailable';
    if(relationshipResult.status==='fulfilled'){retainedRelationships=relationshipResult.value;relationshipsSourceState='ready';}else relationshipsSourceState='unavailable';
    if(bulkResult.status==='fulfilled'){bulkSessions=bulkResult.value;bulkSessionsSourceState='ready';}else bulkSessionsSourceState='unavailable';
    if(websiteResult.status==='fulfilled')websiteSnapshots=websiteResult.value;
    if(campaignResult.status==='fulfilled'){campaigns=campaignResult.value;campaignCount=campaigns.length;}
    if(ruleResult.status==='fulfilled'){detectionRules=ruleResult.value;customRuleCount=detectionRules.length;}
    if(profileResult.status==='fulfilled'){brandProfiles=profileResult.value;brandProfilesUnavailable=false;brandProfilesSourceState='ready';}else brandProfilesSourceState='unavailable';
    refreshRelationships();
    const unavailable=unavailableLocalContextLabels(initialLoads,['watchlists','cases','retained relationships','Bulk sessions','website profiles','campaigns','rules','Brand Profiles']);
    if(unavailable.length)localContextStatus=`Some browser-local context could not be loaded (${unavailable.join(', ')}). Successfully loaded collections remain available; reload to retry the missing context.`;
    const focus=page.url.searchParams.get('case');
    if(focus){view='cases';const target=cases.find(record=>record.id===focus);if(target){showCasePage(target);expandedId=focus;tagDraft=target.tags.join(', ');await tick();const workspace=document.getElementById(`case-response-${target.id}`);if(page.url.hash===`#case-response-${encodeURIComponent(target.id)}`&&workspace){workspace.scrollIntoView({block:'start'});workspace.focus({preventScroll:true});}else await focusCase(target);}}
    else if(page.url.searchParams.get('view')==='inbox')view='inbox';
    else if(page.url.searchParams.get('view')==='timeline')view='timeline';
    else if(page.url.searchParams.get('view')==='watchlists')view='watchlists';
    else if(page.url.searchParams.get('view')==='cases')view='cases';
    else if(page.url.searchParams.get('view')==='campaigns')view='campaigns';
    else if(page.url.searchParams.get('view')==='relationships')view='relationships';
    else if(page.url.searchParams.get('view')==='rules')view='rules';
    if(view==='watchlists'){
      const requestedWatchlist=page.url.searchParams.get('watchlist');
      if(requestedWatchlist&&watchlists[requestedWatchlist])selected=requestedWatchlist;
    }
    const guideDomain=parseDomainInput(page.url.searchParams.get('domain')||'').entries[0]||'';
    const investigationRoute=page.url.searchParams.get('investigation')==='1';
    if(investigationRoute){
      const guide=loadInvestigationGuide();
      const carried=guide?.recipeId==='brand_sweep'?(guide.focusDomain?[guide.focusDomain]:[]):guide?.reviewDomains||[];
      guidedDomains=[...new Set([...carried,guideDomain].filter(Boolean))];
      guidedDomainsTruncated=Boolean(guide?.reviewDomainsTruncated);
      view='cases';
      await tick();
      if(page.url.hash==='#case-review-queue'){
        const target=document.getElementById('case-review-queue');
        target?.scrollIntoView({block:'center'});
        target?.focus({preventScroll:true});
      }
    }
    if(guideDomain&&!investigationRoute){view='cases';newDomain=guideDomain;}
  })();});
</script>

<svelte:head><title>Monitor · WHOISleuth</title></svelte:head>
<PageHeading eyebrow="Track findings" title="Monitor" description="Review retained work, organise cases, inspect relationships, and compare watchlist changes over time." />

<MonitorViewTabs {view} counts={{inbox:reviewInbox.counts.all,timeline:retainedTimeline.counts.all,cases:cases.length,campaigns:campaignCount,relationships:relationshipCount,rules:customRuleCount,watchlists:names.length}} setView={(value)=>view=value} />
{#if localContextStatus}<p class="local-context-status" role="status">{localContextStatus}</p>{/if}

{#if view==='inbox'}
<div id="monitor-view-panel" role="tabpanel" aria-labelledby="tab-inbox">
  <AnalystReviewInbox inbox={reviewInbox} ondismiss={dismissEvidenceGap} />
  <BrandProtectionOperationsReport records={cases} sourceState={casesSourceState} />
  <EvidenceDebtMatrix review={evidenceDebtReview} oncase={openEvidenceDebtCase} />
  <CaseDecisionQuality report={decisionQuality} />
  {#if caseMessage}<p class="case-message" role="status" aria-live="polite">{caseMessage}</p>{/if}
  <CaseLifecycleReview records={cases} />
</div>
{/if}

{#if view==='timeline'}
<div id="monitor-view-panel" role="tabpanel" aria-labelledby="tab-timeline">
  <RetainedEvidenceTimeline timeline={retainedTimeline} />
  <RetainedChangeReview {cases} {websiteSnapshots} {watchlists} {bulkSessions} />
</div>
{/if}

{#if view==='campaigns'}
<div id="monitor-view-panel" role="tabpanel" aria-labelledby="tab-campaigns">
  <CampaignManager records={cases} profiles={brandProfiles} {relationshipSummary} cohortSourceStates={{cases:casesSourceState,profiles:brandProfilesSourceState,relationships:relationshipsSourceState}} initialCampaigns={campaigns} focusId={page.url.searchParams.get('campaign') || ''} onselect={openRelatedCase} oncount={(count)=>campaignCount=count} onchange={(nextCampaigns)=>{campaigns=nextCampaigns;refreshRelationships();}} />
</div>
{/if}

{#if view==='relationships'}
<div id="monitor-view-panel" role="tabpanel" aria-labelledby="tab-relationships">
  <WebsiteProfileClusters summary={websiteProfileClusters} onpin={recordWebsiteClusterLead} />
  <RetainedRelationshipObservations
    records={retainedRelationships}
    focusId={page.url.searchParams.get('observation')||''}
    ondelete={removeRetainedRelationship}
  />
  <CaseRelationshipClusters summary={relationshipClusters} />
  <CaseRelationshipWorkspace records={cases} summary={relationshipSummary} onselect={openRelatedCase} />
</div>
{/if}

{#if view==='rules'}
<div id="monitor-view-panel" role="tabpanel" aria-labelledby="tab-rules">
  <DetectionRuleManager records={cases} initialRules={detectionRules} onselect={openRelatedCase} oncount={(count)=>customRuleCount=count} onchange={(nextRules)=>detectionRules=nextRules} />
</div>
{/if}

{#if view==='cases'}
<div id="monitor-view-panel" role="tabpanel" aria-labelledby="tab-cases">
  {#if guidedDomains.length}<GuidedCaseQueue domains={guidedDomains} existingDomains={existingCaseDomains} truncated={guidedDomainsTruncated} openDomain={openGuidedCase} />{/if}
  <CaseWorkspaceToolbar domain={newDomain} setDomain={(value)=>newDomain=value} {trackDomain} caseCount={cases.length} calibrationSelectedCount={calibrationCaseIds.length} {downloadCases} {reviewCalibrationDataset} {importCaseFile} message={caseMessage} />
  {#if calibrationReview}
    <CalibrationExportReview
      preview={calibrationReview}
      busy={calibrationExportBusy}
      confirm={downloadCalibrationDataset}
      cancel={() => { if (!calibrationExportBusy) calibrationReview=null; }}
    />
  {/if}
  <ExternalFindingsImport {cases} oncomplete={refreshCases} onmessage={(value)=>caseMessage=value} />

  {#if cases.length}
    <CaseFilters status={statusFilter} setStatus={(value)=>{statusFilter=value;casePage=1;}} disposition={dispositionFilter} setDisposition={(value)=>{dispositionFilter=value;casePage=1;}} search={caseSearch} setSearch={(value)=>{caseSearch=value;casePage=1;}} sort={caseSort} setSort={(value)=>{caseSort=value;casePage=1;}} statusOptions={CASE_STATUSES} dispositionOptions={CASE_DISPOSITIONS} clear={()=>{clearCaseFilters();casePage=1;}} matchedCount={filteredCases.length} totalCount={cases.length} />

    <CaseList records={pagedCases} allRecords={cases} {expandedId} {tagDraft} setTagDraft={(value)=>tagDraft=value} {noteDraft} setNoteDraft={(value)=>noteDraft=value} calibrationCaseIds={calibrationCaseIds} {toggleCalibrationCase} {expand} {setStatus} {setDisposition} {setReviewReason} {addBrandProfileAssociation} {removeBrandProfileAssociation} {saveTags} {addNote} {removeCase} {refreshCases} setMessage={(value)=>caseMessage=value} formatDate={date} currentPage={currentCasePage} pageCount={casePageCount} setPage={setCasePage} {brandProfiles} {brandProfilesUnavailable} />
  {:else}
    <section class="empty-state card"><h2>No cases yet</h2><p>Open a case from a Lookup result, a Bulk row, or the form above to start a documented investigation record.</p><a href="/lookup">Open Lookup →</a></section>
  {/if}
</div>
{/if}

{#if view==='watchlists'}
<div id="monitor-view-panel" role="tabpanel" aria-labelledby="tab-watchlists">
  <MonitorActivityHeatmap events={watchlistActivity} />
  <WatchlistWorkspace {watchlists} {names} {entry} {selected} setSelected={(value)=>selected=value} {history} {changedOnly} setChangedOnly={(value)=>changedOnly=value} {message} {downloadWatchlists} {importFile} {clearAll} {rescan} {remove} openCase={openWatchlistCase} formatDate={date} />
  <HostedWatchlistManager capability={scheduledCapability} localWatchlists={watchlists} localNames={names} restoreHosted={restoreHostedWatchlist} formatDate={date} />
</div>
{/if}

<style>
  :global(#watchlist-activity){margin-bottom:16px}
  .case-message{margin:12px 2px;color:var(--accent);font-size:var(--text-sm)}
  .local-context-status{margin:12px 2px;color:var(--amber);font-size:var(--text-sm)}
</style>
