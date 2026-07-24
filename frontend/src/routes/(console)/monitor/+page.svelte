<script lang="ts">
  import { page } from '$app/state';
  import { getContext, onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import MonitorViewTabs from '$lib/components/MonitorViewTabs.svelte';
  import CaseWorkspaceToolbar from '$lib/components/CaseWorkspaceToolbar.svelte';
  import GuidedCaseQueue from '$lib/components/GuidedCaseQueue.svelte';
  import CaseFilters from '$lib/components/CaseFilters.svelte';
  import CaseList from '$lib/components/CaseList.svelte';
  import WatchlistWorkspace from '$lib/components/WatchlistWorkspace.svelte';
  import HostedWatchlistManager from '$lib/components/HostedWatchlistManager.svelte';
  import MonitorActivityHeatmap from '$lib/components/MonitorActivityHeatmap.svelte';
  import { saveCandidateHandoff } from '$lib/candidate-handoff';
  import CampaignManager from '$lib/components/CampaignManager.svelte';
  import CaseRelationshipTable from '$lib/components/CaseRelationshipTable.svelte';
  import CaseRelationshipGraph from '$lib/components/CaseRelationshipGraph.svelte';
  import DetectionRuleManager from '$lib/components/DetectionRuleManager.svelte';
  import RetainedRelationshipObservations from '$lib/components/RetainedRelationshipObservations.svelte';
  import { buildInvestigationCaseRelationships } from '$lib/analysis/case-relationships.js';
  import { parseDomainInput } from '$lib/analysis/utils.js';
  import { loadLocalCaseInvestigationProjection } from '$lib/investigation-search';
  import { deleteWatchlist, exportWatchlists, importWatchlists, loadWatchlists, MAX_WATCHLIST_IMPORT_BYTES, writeWatchlists, type WatchlistEntry, type Watchlists } from '$lib/watchlists';
  import {
    addCaseNote, CASE_DISPOSITIONS, CASE_STATUSES, deleteCase, dispositionLabel, editCase, exportCases,
    importCases, loadCases, MAX_CASE_IMPORT_BYTES, openCase, statusLabel, type CaseRecord
  } from '$lib/cases';
  import { loadCampaigns } from '$lib/campaigns';
  import { loadDetectionRules } from '$lib/detection-rules';
  import {
    deleteRelationshipObservation,
    loadRelationshipObservations,
    type RelationshipObservation,
  } from '$lib/relationship-observations';
  import { CAPABILITY_CONTEXT, featureCapability, type CapabilityGetter } from '$lib/capabilities';
  import { loadInvestigationGuide } from '$lib/investigation-guide';

  type View = 'watchlists' | 'cases' | 'campaigns' | 'relationships' | 'rules';
  const CASE_PAGE_SIZE=25;
  let view=$state<View>('watchlists');
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
  async function rescan(name:string){const current=watchlists[name];if(!current)return;const candidates=current.results.map(record=>({domain:String(record.domain),source:name,mutationTypes:Array.isArray(record.mutationTypes)?record.mutationTypes:[]}));saveCandidateHandoff('watchlist',candidates);await goto('/bulk?source=watchlist');}
  async function importFile(event:Event){const input=event.currentTarget as HTMLInputElement;const file=input.files?.[0];if(!file)return;try{if(file.size>MAX_WATCHLIST_IMPORT_BYTES)throw new Error('Watchlist imports are limited to 2 MB.');const result=await importWatchlists(JSON.parse(await file.text()));const skipped=result.skipped?`; skipped ${result.skipped} invalid or over-limit watchlist${result.skipped===1?'':'s'}`:'';message=`Imported ${result.added} new and ${result.updated} updated watchlists${skipped}.`;await refresh();}catch(cause){message=cause instanceof Error?cause.message:'Import failed';}finally{input.value='';}}
  async function restoreHostedWatchlist(name:string,hostedEntry:WatchlistEntry){const all=await loadWatchlists();const existing=Object.keys(all).find(candidate=>candidate.toLowerCase()===name.toLowerCase());if(existing&&existing!==name)delete all[existing];Object.defineProperty(all,name,{value:hostedEntry,writable:true,enumerable:true,configurable:true});await writeWatchlists(all);await refresh();}

  // --- Cases ---
  let cases=$state<CaseRecord[]>([]);
  let casePage=$state(1);
  let campaignCount=$state(0);
  let investigationProjection=$state<unknown>(null);
  let retainedRelationships=$state<RelationshipObservation[]>([]);
  let customRuleCount=$state(0);
  const relationshipSummary=$derived(buildInvestigationCaseRelationships(investigationProjection));
  const relationshipCount=$derived(relationshipSummary.groups.length+retainedRelationships.length);
  let statusFilter=$state('');let dispositionFilter=$state('');let caseSearch=$state('');let caseSort=$state<'updated'|'domain'|'status'>('updated');
  let expandedId=$state('');let noteDraft=$state('');let tagDraft=$state('');let caseMessage=$state('');let newDomain=$state('');
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
  async function refreshRelationships(){investigationProjection=await loadLocalCaseInvestigationProjection();}
  async function refreshRetainedRelationships(){retainedRelationships=await loadRelationshipObservations();}
  async function removeRetainedRelationship(record:RelationshipObservation){
    if(!confirm(`Delete the retained ${record.label.toLowerCase()} observation for ${record.domains.length} domain${record.domains.length===1?'':'s'}?`))return;
    try{
      retainedRelationships=await deleteRelationshipObservation(record.id);
      await refreshRelationships();
      caseMessage=`Deleted the retained relationship observation. Source cases and watchlists were not changed.`;
    }catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not delete the retained relationship observation.';}
  }
  async function refreshCases(){cases=await loadCases();await refreshRelationships();if(expandedId&&!cases.some(record=>record.id===expandedId))expandedId='';}
  function expand(record:CaseRecord){if(expandedId===record.id){expandedId='';return;}showCasePage(record);expandedId=record.id;tagDraft=record.tags.join(', ');noteDraft='';}
  function openRelatedCase(record:CaseRecord){view='cases';showCasePage(record);if(expandedId!==record.id)expand(record);}
  async function focusCase(record:CaseRecord){
    await tick();
    const target=document.getElementById(`case-head-${record.id}`);
    target?.scrollIntoView({block:'center'});
    target?.focus({preventScroll:true});
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
      await focusCase(record);
    }catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not open the guided case.';}
  }
  function prunedNote(pruned:number){return pruned?` (pruned ${pruned} old evidence snapshot${pruned===1?'':'s'} to stay within storage)`:'';}
  async function trackDomain(){const domain=newDomain.trim();if(!domain){caseMessage='Enter a domain to track.';return;}try{const{record,created,pruned}=await openCase({domain,source:'monitor'});await refreshCases();newDomain='';showCasePage(record);expandedId=record.id;tagDraft=record.tags.join(', ');noteDraft='';caseMessage=`${created?`Opened a new case for ${record.domain}.`:`${record.domain} already has a case.`}${prunedNote(pruned)}`;}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not open the case.';}}
  async function setStatus(record:CaseRecord,value:string){try{const{pruned}=await editCase(record.id,{status:value});await refreshCases();showCasePage(record);caseMessage=`Set ${record.domain} to ${statusLabel(value)}.${prunedNote(pruned)}`;}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not update the case.';}}
  async function setDisposition(record:CaseRecord,value:string){try{const{pruned}=await editCase(record.id,{disposition:value});await refreshCases();showCasePage(record);caseMessage=`Marked ${record.domain} as ${dispositionLabel(value)}.${prunedNote(pruned)}`;}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not update the case.';}}
  async function saveTags(record:CaseRecord){try{const{pruned}=await editCase(record.id,{tags:tagDraft.split(/[,\n]+/).map(value=>value.trim()).filter(Boolean)});await refreshCases();showCasePage(record);caseMessage=`Updated tags for ${record.domain}.${prunedNote(pruned)}`;}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not update tags.';}}
  async function addNote(record:CaseRecord){const body=noteDraft.trim();if(!body){caseMessage='A note cannot be empty.';return;}try{const{pruned}=await addCaseNote(record.id,body);await refreshCases();showCasePage(record);noteDraft='';caseMessage=`Added a note to ${record.domain}.${prunedNote(pruned)}`;}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not add the note.';}}
  async function downloadCases(){try{await exportCases();}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not export cases.';}}
  async function removeCase(record:CaseRecord){if(!confirm(`Delete the case for ${record.domain}? Its notes are removed unless you exported them.`))return;try{await deleteCase(record.id);if(expandedId===record.id)expandedId='';await refreshCases();caseMessage=`Deleted the case for ${record.domain}.`;}catch(cause){caseMessage=cause instanceof Error?cause.message:'Could not delete the case.';}}
  function clearCaseFilters(){statusFilter='';dispositionFilter='';caseSearch='';}
  async function importCaseFile(event:Event){const input=event.currentTarget as HTMLInputElement;const file=input.files?.[0];if(!file)return;try{if(file.size>MAX_CASE_IMPORT_BYTES)throw new Error('Case imports are limited to 2 MB.');const result=await importCases(JSON.parse(await file.text()));await refreshCases();caseMessage=`Imported ${result.added} new and ${result.updated} merged cases${result.skipped?`; skipped ${result.skipped} invalid or over-limit record${result.skipped===1?'':'s'}`:''}${prunedNote(result.pruned)}.`;}catch(cause){caseMessage=cause instanceof Error?cause.message:'Case import failed';}finally{input.value='';}}

  onMount(()=>{void (async()=>{
    await Promise.all([refresh(),refreshCases(),refreshRetainedRelationships()]);[campaignCount,customRuleCount]=await Promise.all([loadCampaigns().then(records=>records.length),loadDetectionRules().then(records=>records.length)]);
    const focus=page.url.searchParams.get('case');
    if(focus){view='cases';if(cases.some(record=>record.id===focus)){const target=cases.find(record=>record.id===focus)!;showCasePage(target);expandedId=focus;tagDraft=target.tags.join(', ');}}
    else if(page.url.searchParams.get('view')==='watchlists')view='watchlists';
    else if(page.url.searchParams.get('view')==='cases')view='cases';
    else if(page.url.searchParams.get('view')==='campaigns')view='campaigns';
    else if(page.url.searchParams.get('view')==='relationships')view='relationships';
    else if(page.url.searchParams.get('view')==='rules')view='rules';
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
<PageHeading eyebrow="Track findings" title="Monitor" description="Organize cases, review relationships, test local detection rules, and compare watchlist changes over time." />

<MonitorViewTabs {view} counts={{cases:cases.length,campaigns:campaignCount,relationships:relationshipCount,rules:customRuleCount,watchlists:names.length}} setView={(value)=>view=value} />

{#if view==='campaigns'}
<div id="panel-campaigns" role="tabpanel" aria-labelledby="tab-campaigns">
  <CampaignManager records={cases} focusId={page.url.searchParams.get('campaign') || ''} onselect={openRelatedCase} oncount={(count)=>{campaignCount=count;refreshRelationships();}} />
</div>
{/if}

{#if view==='relationships'}
<div id="panel-relationships" role="tabpanel" aria-labelledby="tab-relationships">
  <RetainedRelationshipObservations
    records={retainedRelationships}
    focusId={page.url.searchParams.get('observation')||''}
    ondelete={removeRetainedRelationship}
  />
  <CaseRelationshipGraph records={cases} summary={relationshipSummary} onselect={openRelatedCase} />
  <CaseRelationshipTable records={cases} summary={relationshipSummary} onselect={openRelatedCase} />
</div>
{/if}

{#if view==='rules'}
<div id="panel-rules" role="tabpanel" aria-labelledby="tab-rules">
  <DetectionRuleManager records={cases} onselect={openRelatedCase} oncount={(count)=>customRuleCount=count} />
</div>
{/if}

{#if view==='cases'}
<div id="panel-cases" role="tabpanel" aria-labelledby="tab-cases">
  {#if guidedDomains.length}<GuidedCaseQueue domains={guidedDomains} existingDomains={existingCaseDomains} truncated={guidedDomainsTruncated} openDomain={openGuidedCase} />{/if}
  <CaseWorkspaceToolbar domain={newDomain} setDomain={(value)=>newDomain=value} {trackDomain} caseCount={cases.length} {downloadCases} {importCaseFile} message={caseMessage} />

  {#if cases.length}
    <CaseFilters status={statusFilter} setStatus={(value)=>{statusFilter=value;casePage=1;}} disposition={dispositionFilter} setDisposition={(value)=>{dispositionFilter=value;casePage=1;}} search={caseSearch} setSearch={(value)=>{caseSearch=value;casePage=1;}} sort={caseSort} setSort={(value)=>{caseSort=value;casePage=1;}} statusOptions={CASE_STATUSES} dispositionOptions={CASE_DISPOSITIONS} clear={()=>{clearCaseFilters();casePage=1;}} matchedCount={filteredCases.length} totalCount={cases.length} />

    <CaseList records={pagedCases} allRecords={cases} {expandedId} {tagDraft} setTagDraft={(value)=>tagDraft=value} {noteDraft} setNoteDraft={(value)=>noteDraft=value} {expand} {setStatus} {setDisposition} {saveTags} {addNote} {removeCase} setMessage={(value)=>caseMessage=value} formatDate={date} currentPage={currentCasePage} pageCount={casePageCount} setPage={setCasePage} />
  {:else}
    <section class="empty-state card"><h2>No cases yet</h2><p>Open a case from a Lookup result, a Bulk row, or the form above to start a documented investigation record.</p><a href="/lookup">Open Lookup →</a></section>
  {/if}
</div>
{/if}

{#if view==='watchlists'}
<div id="panel-watchlists" role="tabpanel" aria-labelledby="tab-watchlists">
  <MonitorActivityHeatmap events={watchlistActivity} />
  <WatchlistWorkspace {watchlists} {names} {entry} {selected} setSelected={(value)=>selected=value} {history} {changedOnly} setChangedOnly={(value)=>changedOnly=value} {message} {downloadWatchlists} {importFile} {clearAll} {rescan} {remove} openCase={openWatchlistCase} formatDate={date} />
  <HostedWatchlistManager capability={scheduledCapability} localWatchlists={watchlists} localNames={names} restoreHosted={restoreHostedWatchlist} formatDate={date} />
</div>
{/if}

<style>
  :global(#watchlist-activity){margin-bottom:16px}
</style>
