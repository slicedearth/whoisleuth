<script lang="ts">
  import { goto } from '$app/navigation';
  import { page as routePage } from '$app/state';
  import { getContext, onMount } from 'svelte';
  import BulkResultsTable from '$lib/components/BulkResultsTable.svelte';
  import BulkCoverage from '$lib/components/BulkCoverage.svelte';
  import BulkTriagePlot from '$lib/components/BulkTriagePlot.svelte';
  import BulkRelationships from '$lib/components/BulkRelationships.svelte';
  import BulkScanQueue from '$lib/components/BulkScanQueue.svelte';
  import BulkShortlist from '$lib/components/BulkShortlist.svelte';
  import BulkTriageControls from '$lib/components/BulkTriageControls.svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import { activeProfile, isDomainAllowlisted, profileDomainKind, profileSignals, type BrandProfile } from '$lib/brand-profiles';
  import { loadCandidateHandoff, type Candidate, type CandidateHandoff, type CertificateTransparencyProvenance } from '$lib/candidate-handoff';
  import { abuseAction, outreachAction, type AbuseEvidence, type Contact } from '$lib/drafts';
  import { clearShortlist, exportShortlist, importShortlist, loadShortlist, MAX_SHORTLIST_IMPORT_BYTES, toggleShortlist, type ShortlistRecord } from '$lib/shortlist';
  import { CASE_DISPOSITIONS, dispositionLabel, editCase, loadCases, openCase, type CaseRecord } from '$lib/cases';
  import { saveWatchlist } from '$lib/watchlists';
  import type { WatchlistComparableRecord } from '$lib/analysis/watchlist-history.ts';
  import { MUTATION_LABELS } from '$lib/analysis/typosquat-generator.ts';
  import { buildCoverageReport } from '$lib/analysis/coverage.ts';
  import { computeOpportunityScore, explainRiskScore, formatActivityCell } from '$lib/analysis/scoring.ts';
  import { entityDisplayName, parseDomainInput, rowsToCsv } from '$lib/analysis/utils.ts';
  import { buildScanRelationships, relationshipObservation, RELATIONSHIP_EVIDENCE_VERSION } from '$lib/analysis/relationship-evidence.ts';
  import type { RelationshipObservation } from '$lib/analysis/relationship-evidence.ts';
  import { relationshipObservationId } from '$lib/analysis/relationship-observation-model.ts';
  import { loadRelationshipObservations, retainRelationshipObservation } from '$lib/relationship-observations';
  import { ctCsvFields } from '$lib/analysis/bulk-export.ts';
  import { buildDefensiveIndicatorExport, isDefensiveIndicatorCandidate } from '$lib/analysis/defensive-indicator-export.ts';
  import { buildStixIndicatorExport } from '$lib/analysis/stix-indicator-export.ts';
  import { buildMispIndicatorExport } from '$lib/analysis/misp-indicator-export.ts';
  import { analyzeDomainIdn } from '$lib/analysis/idn-confusables.ts';
  import { compactHttpObservation, normalizeHttpSummary } from '$lib/analysis/http-summary.ts';
  import {
    lookupRecord,
    lookupHttpErrorMessage,
    parseCompactLookupHttpResponse,
    type CompactLookupHttpResponse,
  } from '$lib/analysis/lookup-response.ts';
  import { defaultBulkSortDirection, sortBulkResults, type BulkSortDirection, type BulkSortKey } from '$lib/analysis/bulk-sort.ts';
  import { CAPABILITY_CONTEXT, disabledCapabilities, disabledCapability, type CapabilityGetter } from '$lib/capabilities';
  import { readBulkWorkflowState, writeBulkWorkflowState } from '$lib/console-workflow-state.ts';
  import { loadInvestigationGuide, selectInvestigationGuideFocusDomain, selectInvestigationGuideReviewDomains } from '$lib/investigation-guide';
  import { isExpectedBrowserLocalDataFailure } from '$lib/browser-local-data.ts';

  type ScanMode = 'fast' | 'deep';
  type Filter = 'all' | 'available' | 'registered' | 'high_risk' | 'trusted' | 'errors';
  interface SavedScanRecord extends WatchlistComparableRecord {
    availability: string;
    registrarName: string;
    nameservers: string[];
    createdDate?: string | null;
    expiryDate?: string | null;
    privacyProtected?: boolean | null;
    hasMx?: boolean | null;
    hasSpf?: boolean | null;
    hasDmarc?: boolean | null;
    activityStatus?: string | null;
    pageTitle?: string | null;
    faviconHash: string | null;
    faviconPHash: string | null;
    faviconMatch?: boolean;
    faviconNearMatch?: boolean;
    reusesOfficialAssets?: boolean;
    hasPasswordField?: boolean | null;
    phishingLanguageMatch?: string | null;
    riskFactors: Array<{ label: string; points: number }>;
    mutationTypes: string[];
    error?: string;
  }
  interface BulkDnsCaaRecord {
    critical: number | string;
    tag: string;
    value: string;
  }
  interface BulkDnsEvidence {
    status: string | null;
    records: {
      a: string[];
      aaaa: string[];
      cname: string[];
      caa: BulkDnsCaaRecord[];
    };
  }
  interface ScanResult {
    domain: string; status: 'complete'|'error'; availability: string; confidence: string;
    registrar: string; activity: string; risk: number|null; opportunity: number|null;
    mutationTypes: string[]; trusted: 'official'|'partner'|'allowlisted'|null; error: string; saved: SavedScanRecord;
    nameservers:string[];faviconHash:string|null;faviconPHash:string|null;faviconMatch:boolean;faviconNearMatch:boolean;reusesOfficialAssets:boolean;hasPasswordField:boolean;phishingLanguageMatch:string|null;
    registrant:Contact|null;abuseEvidence:AbuseEvidence|null;
    ct:CertificateTransparencyProvenance|null;
    idn:ReturnType<typeof analyzeDomainIdn>|null;
    dns:BulkDnsEvidence|null;dnssec:string|null;relationship:RelationshipObservation;
  }
  const MAX_DOMAIN_IMPORT_BYTES = 2 * 1024 * 1024;
  const PAGE_SIZE = 100;
  const RESULT_PUBLISH_MS = 100;
  const MAX_COMPACT_TEXT_LENGTH = 500;
  const MAX_COMPACT_DNS_RECORDS = 100;

  let handoff = $state<CandidateHandoff|null>(null);
  let input = $state(''); let mode = $state<ScanMode>('fast'); let running = $state(false); let paused = $state(false);
  let completed = $state(0); let total = $state(0); let results = $state<ScanResult[]>([]); let filter = $state<Filter>('all');
  let mutationFilter=$state('');let signalFilters=$state<Set<string>>(new Set());let sortKey=$state<BulkSortKey>('risk');let sortDirection=$state<BulkSortDirection>(-1);let page=$state(1);
  let status = $state(''); let controller: AbortController|null = null; let pauseResolvers: Array<()=>void> = [];
  let activeScanSnapshot: (()=>ScanResult[])|null = null;
  let indicatorFormat=$state<'domains'|'hosts'|'dnsmasq'|'rpz'|'stix'|'misp'>('domains');let indicatorStatus=$state('');
  let watchlistName = $state(''); let saveStatus = $state('');
  let profile = $state<BrandProfile|null>(null);
  let shortlist=$state<ShortlistRecord[]>([]);let shortlistStatus=$state('');let draftStatus=$state('');
  let cases=$state<CaseRecord[]>([]);let caseStatus=$state('');
  let retainedRelationshipIds=$state<Set<string>>(new Set());let relationshipRetentionStatus=$state('');
  let localContextStatus=$state('');
  const capabilityReport=getContext<CapabilityGetter>(CAPABILITY_CONTEXT);
  const lookupDisabled=$derived(disabledCapability(capabilityReport?.()||null,'lookup'));
  const scanLimitations=$derived(disabledCapabilities(capabilityReport?.()||null,mode==='fast'?['rdap','availability']:['rdap','whois','availability','dns_intelligence','website_probe','tls_intelligence']));
  const caseByDomain=$derived(new Map(cases.map(record=>[record.domain,record])));
  const mutationLabels=MUTATION_LABELS as Record<string,string>;
  const mutationOptions=$derived([...new Set(results.flatMap(row=>row.mutationTypes))].sort((a,b)=>(mutationLabels[a]||a).localeCompare(mutationLabels[b]||b)));
  const filtered = $derived.by(()=>sortBulkResults(results.filter(matchesFilter),sortKey,sortDirection));
  const indicatorCount=$derived(filtered.filter(isDefensiveIndicatorCandidate).length);
  const counts = $derived.by(()=>{const next={all:results.length,available:0,registered:0,high_risk:0,trusted:0,errors:0};for(const row of results){if(row.availability==='available')next.available+=1;if(['registered','for_sale','expiring'].includes(row.availability))next.registered+=1;if((row.risk??-1)>=70&&!row.trusted)next.high_risk+=1;if(row.trusted)next.trusted+=1;if(row.status==='error')next.errors+=1;}return next;});
  const pageCount=$derived(Math.max(1,Math.ceil(filtered.length/PAGE_SIZE)));
  const currentPage=$derived(Math.min(page,pageCount));
  const visibleResults=$derived(filtered.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE));
  const shortlistedDomains=$derived(new Set(shortlist.map(item=>item.domain)));
  const provenanceByDomain=$derived(new Map((handoff?.candidates||[]).map(candidate=>[candidate.domain.toLowerCase(),candidate])));
  const relationshipSummary=$derived(buildScanRelationships(running?[]:results));
  const parsedInput=$derived(parseDomainInput(input));
  $effect(()=>{if(routePage.url.searchParams.has('investigation')&&!running&&results.length)selectInvestigationGuideReviewDomains(results.map((row)=>row.domain));});
  const coverage=$derived.by(()=>{if(!handoff||!['typosquat','keyword'].includes(handoff.source))return null;const generated=handoff.generatedCandidates||handoff.candidates;const trusted=new Set(generated.filter(candidate=>isDomainAllowlisted(candidate.domain,profile)).map(candidate=>candidate.domain));return buildCoverageReport(results.map(row=>({...row.saved,domain:row.domain,availability:row.availability,mutationTypes:row.mutationTypes})),generated,trusted,mutationLabels);});

  async function initializeLocalContext(handoffNavigation:boolean,investigationTarget:string,restored:ReturnType<typeof readBulkWorkflowState<ScanResult>>){
    handoff=loadCandidateHandoff();
    if(handoffNavigation&&handoff)input=handoff.candidates.map(c=>c.domain).join('\n');
    else if(investigationTarget&&!restored){input=investigationTarget;results=[];completed=0;total=0;status='Loaded the guided-investigation target. Add only relevant comparison domains before scanning.';}
    try{
      let retained;
      [profile,shortlist,cases,retained]=await Promise.all([activeProfile(),loadShortlist(),loadCases(),loadRelationshipObservations()]);
      retainedRelationshipIds=new Set(retained.map((item)=>item.id));
    }catch(cause){
      localContextStatus='Some browser-local profile, shortlist, case, or relationship context could not be loaded. Scan results and restored queue state remain available; reload to retry the saved context.';
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
    if(restored){input=restored.input;mode=restored.mode;completed=restored.completed;total=restored.total;results=restored.results;filter=restored.filter;mutationFilter=restored.mutationFilter;signalFilters=new Set(restored.signalFilters);sortKey=restored.sortKey;sortDirection=restored.sortDirection;page=restored.page;status=restored.status;indicatorFormat=restored.indicatorFormat;watchlistName=restored.watchlistName;}
    void initializeLocalContext(handoffNavigation,investigationTarget,restored);
    return()=>{
      resume();
      controller?.abort();
      const retainedResults=activeScanSnapshot?.()||results;
      writeBulkWorkflowState({guideContext,input,mode,completed,total,results:retainedResults,filter,mutationFilter,signalFilters:[...signalFilters],sortKey,sortDirection,page,status:running?`Stopped after ${completed} of ${total} lookups when you left Bulk. Completed results were retained.`:status,indicatorFormat,watchlistName});
    };
  });
  function prunedNote(pruned:number){return pruned?` (pruned ${pruned} old evidence snapshot${pruned===1?'':'s'} to stay within storage)`:'';}
  function plainRecord(value:unknown):Record<string,unknown>|null{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;}
  function boundedText(value:unknown,maxLength=MAX_COMPACT_TEXT_LENGTH):string|null{return typeof value==='string'&&value.length<=maxLength&&!/[\u0000-\u001f\u007f]/u.test(value)?value:null;}
  function nullableBoolean(value:unknown):boolean|null{return typeof value==='boolean'?value:null;}
  function nullableNumber(value:unknown):number|null{return typeof value==='number'&&Number.isFinite(value)?value:null;}
  function boundedStrings(value:unknown):string[]{return Array.isArray(value)?value.slice(0,MAX_COMPACT_DNS_RECORDS).filter((item):item is string=>typeof item==='string'&&item.length<=MAX_COMPACT_TEXT_LENGTH&&!/[\u0000-\u001f\u007f]/u.test(item)):[];}
  function compactContact(value:unknown):Contact|null{const item=plainRecord(value);if(!item)return null;return{name:boundedText(item.name),org:boundedText(item.org),email:boundedText(item.email,320)};}
  function compactDnsEvidence(value:unknown):BulkDnsEvidence|null{const dns=plainRecord(value);if(!dns)return null;const records=plainRecord(dns.records);const caa=Array.isArray(records?.caa)?records.caa.slice(0,MAX_COMPACT_DNS_RECORDS).flatMap((value)=>{const item=plainRecord(value);const tag=boundedText(item?.tag,64);const recordValue=boundedText(item?.value);const critical=typeof item?.critical==='number'||typeof item?.critical==='string'?item.critical:null;return tag&&recordValue&&critical!==null?[{critical,tag,value:recordValue}]:[];}):[];return{status:boundedText(dns.status,40),records:{a:boundedStrings(records?.a),aaaa:boundedStrings(records?.aaaa),cname:boundedStrings(records?.cname),caa}};}
  async function trackCase(row:ScanResult){try{const s=row.saved;const{record,created,pruned}=await openCase({domain:row.domain,source:'bulk',evidence:{scanDepth:s.scanDepth,availability:s.availability,confidence:row.confidence,riskModelVersion:s.riskModelVersion,riskScore:row.risk,riskFactors:s.riskFactors,opportunityScore:row.opportunity,registrar:row.registrar&&row.registrar!=='—'?row.registrar:null,createdDate:s.createdDate,expiryDate:s.expiryDate,nameservers:s.nameservers,hasMx:s.hasMx,hasSpf:s.hasSpf,hasDmarc:s.hasDmarc,activityStatus:s.activityStatus,pageTitle:s.pageTitle,...(normalizeHttpSummary(s)||{}),faviconMatch:s.faviconMatch,faviconNearMatch:s.faviconNearMatch,reusesOfficialAssets:s.reusesOfficialAssets,hasPasswordField:s.hasPasswordField,phishingLanguageMatch:s.phishingLanguageMatch,mutationTypes:s.mutationTypes}});cases=await loadCases();caseStatus=`${created?`Opened a case for ${record.domain}.`:`${record.domain} already has a case.`}${prunedNote(pruned)}`;}catch(cause){caseStatus=cause instanceof Error?cause.message:'Could not open the case.';}}
  async function setRowDisposition(row:ScanResult,value:string){const record=caseByDomain.get(row.domain);if(!record)return;try{const{pruned}=await editCase(record.id,{disposition:value});cases=await loadCases();caseStatus=`Marked ${row.domain} as ${dispositionLabel(value)}.${prunedNote(pruned)}`;}catch(cause){caseStatus=cause instanceof Error?cause.message:'Could not update the case.';}}
  function parseDomains(){return parsedInput.entries.map((value:string)=>value.toLowerCase());}
  function provenance(domain:string):Candidate|undefined{return provenanceByDomain.get(domain.toLowerCase());}
  function matchesFilter(r:ScanResult){if(filter==='available'&&r.availability!=='available')return false;if(filter==='registered'&&!['registered','for_sale','expiring'].includes(r.availability))return false;if(filter==='high_risk'&&((r.risk??-1)<70||Boolean(r.trusted)))return false;if(filter==='trusted'&&!r.trusted)return false;if(filter==='errors'&&r.status!=='error')return false;if(mutationFilter&&!r.mutationTypes.includes(mutationFilter))return false;for(const signal of signalFilters){if(signal==='favicon'&&!r.faviconMatch&&!r.faviconNearMatch)return false;if(signal==='password'&&!r.hasPasswordField)return false;if(signal==='phishing'&&!r.phishingLanguageMatch)return false;if(signal==='asset_reuse'&&!r.reusesOfficialAssets)return false;if(signal==='idn'&&!r.idn?.mixedScript&&!r.idn?.referenceMatches?.length)return false;}return true;}
  function setFilter(next:Filter){filter=next;page=1;}
  function toggleSignal(signal:string){const next=new Set(signalFilters);next.has(signal)?next.delete(signal):next.add(signal);signalFilters=next;page=1;}
  function clearFilters(){filter='all';mutationFilter='';signalFilters=new Set();page=1;}
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
  async function toggleSaved(row:ScanResult){try{const added=await toggleShortlist({...row.saved,riskScore:row.risk,opportunityScore:row.opportunity,savedAt:new Date().toISOString()});shortlist=await loadShortlist();shortlistStatus=added?`Added ${row.domain} to the shortlist.`:`Removed ${row.domain} from the shortlist.`;}catch(cause){shortlistStatus=cause instanceof Error?cause.message:'Could not update shortlist.';}}
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
  async function fetchLookup(domain:string,signal:AbortSignal):Promise<CompactLookupHttpResponse>{const url=`/api/lookup?q=${encodeURIComponent(domain)}&fast=${mode==='fast'?'1':'0'}&compact=1`;let response=await fetch(url,{signal});for(let attempt=0;response.status===429&&attempt<3;attempt++){const seconds=Number(response.headers.get('Retry-After'))||2;await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,seconds*1000);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));},{once:true});});response=await fetch(url,{signal});}const body:unknown=await response.json().catch(()=>({}));if(!response.ok)throw new Error(lookupHttpErrorMessage(body,response.status));const parsed=parseCompactLookupHttpResponse(body,domain);if(!parsed.ok)throw new Error(parsed.error);return parsed.value;}
  function normalize(domain:string,body:CompactLookupHttpResponse):ScanResult {const av=lookupRecord(body.availability);const canonicalDomain=body.availability.domain;const candidate=provenance(domain)||provenance(canonicalDomain);const matched=profileSignals(canonicalDomain,av,profile);const idn=analyzeDomainIdn(canonicalDomain,profile?.officialDomains||[]);const scoring={...av,...matched,availability:body.availability.state,mutationTypes:candidate?.mutationTypes||[]};const riskExplanation=explainRiskScore(scoring);const risk=riskExplanation?.score??null;const opportunity=computeOpportunityScore(scoring);const nameservers=boundedStrings(av.nameservers);const registrant=compactContact(av.registrant);const abuse=plainRecord(av.abuse);const abuseEmail=boundedText(abuse?.email,320);const hasMx=nullableBoolean(av.hasMx);const hasSpf=nullableBoolean(av.hasSpf);const hasDmarc=nullableBoolean(av.hasDmarc);const activityStatus=boundedText(av.activityStatus,40);const privacyProtected=nullableBoolean(av.privacyProtected);const domainAgeDays=nullableNumber(av.domainAgeDays);const abuseEvidence=abuseEmail?{abuseEmail,hasMx,activityStatus,privacyProtected,domainAgeDays}:null;const httpSummary=compactHttpObservation(av.http)||{};const relationship=relationshipObservation(av,profile?.officialDomains||[]);const saved:SavedScanRecord={domain:canonicalDomain,scanDepth:mode,availability:body.availability.state,registrarName:entityDisplayName(av.registrar)||'—',nameservers,createdDate:boundedText(av.createdDate,64),expiryDate:boundedText(av.expiryDate,64),privacyProtected,hasMx,hasSpf,hasDmarc,activityStatus,pageTitle:boundedText(av.pageTitle,300),...httpSummary,faviconHash:boundedText(av.faviconHash,64),faviconPHash:boundedText(av.faviconPHash,64),faviconMatch:matched.faviconMatch,faviconNearMatch:matched.faviconNearMatch,reusesOfficialAssets:matched.reusesOfficialAssets,hasPasswordField:nullableBoolean(av.hasPasswordField),phishingLanguageMatch:boundedText(av.phishingLanguageMatch,300),riskModelVersion:riskExplanation?.modelVersion??null,riskScore:risk,riskFactors:riskExplanation?.factors.map((factor)=>({label:factor.label,points:factor.delta}))||[],mutationTypes:candidate?.mutationTypes||[]};return{domain:canonicalDomain,status:'complete',availability:saved.availability,confidence:body.availability.confidence,registrar:saved.registrarName,activity:formatActivityCell(activityStatus,hasMx,hasSpf,hasDmarc),risk,opportunity,mutationTypes:candidate?.mutationTypes||[],trusted:matched.trusted,error:'',saved,nameservers,faviconHash:saved.faviconHash,faviconPHash:saved.faviconPHash,faviconMatch:matched.faviconMatch,faviconNearMatch:matched.faviconNearMatch,reusesOfficialAssets:matched.reusesOfficialAssets,hasPasswordField:saved.hasPasswordField===true,phishingLanguageMatch:saved.phishingLanguageMatch??null,registrant,abuseEvidence,ct:candidate?.certificateTransparency||null,idn,dns:compactDnsEvidence(av.dns),dnssec:boundedText(av.dnssec,40),relationship};}
  function failedResult(domain:string,message:string):ScanResult{const candidate=provenance(domain);const mutationTypes=candidate?.mutationTypes||[];const idn=analyzeDomainIdn(domain,profile?.officialDomains||[]);return{domain:idn?.asciiDomain||domain,status:'error',availability:'error',confidence:'unknown',registrar:'—',activity:'—',risk:null,opportunity:null,mutationTypes,trusted:profileDomainKind(domain,profile),error:message,saved:{domain:idn?.asciiDomain||domain,scanDepth:mode,availability:'error',registrarName:'—',nameservers:[],faviconHash:null,faviconPHash:null,riskFactors:[],mutationTypes,error:message},nameservers:[],faviconHash:null,faviconPHash:null,faviconMatch:false,faviconNearMatch:false,reusesOfficialAssets:false,hasPasswordField:false,phishingLanguageMatch:null,registrant:null,abuseEvidence:null,ct:candidate?.certificateTransparency||null,idn,dns:null,dnssec:null,relationship:relationshipObservation({},[])};}
  function riskTitle(row:ScanResult){const factors=Array.isArray(row.saved.riskFactors)?row.saved.riskFactors:[];const lines=factors.map((factor)=>`${factor.label} ${Number(factor.points)>=0?'+':''}${factor.points}`);if(row.saved.riskModelVersion)lines.push(`Risk model v${row.saved.riskModelVersion}`);return lines.join('\n')||undefined;}
  function resultDisplayRows(){return visibleResults.map((row)=>{const resultIndex=results.indexOf(row);const caseRecord=caseByDomain.get(row.domain)||null;const outreach=outreachAction(row.domain,row.registrant);const abuse=abuseAction(row.domain,row.abuseEvidence);return{resultIndex,domain:row.domain,shortlisted:isShortlisted(row.domain),unicodeDomain:row.idn?.hasIdn?String(row.idn.unicodeDomain||''):'',mixedScript:Boolean(row.idn?.mixedScript),referenceMatch:Boolean(row.idn?.referenceMatches?.length),trusted:row.trusted||'',faviconMatch:row.faviconMatch,faviconNearMatch:row.faviconNearMatch,reusesOfficialAssets:row.reusesOfficialAssets,hasPasswordField:row.hasPasswordField,phishingLanguageMatch:row.phishingLanguageMatch||'',ct:row.ct?{lastObservedAt:row.ct.lastObservedAt,hostnameCount:row.ct.hostnames.length,certificateCount:row.ct.certificateCount}:null,errorRow:row.status==='error',error:row.error,availability:row.availability,confidence:row.confidence,risk:row.risk,highRisk:(row.risk??-1)>=70&&!row.trusted,riskTitle:riskTitle(row),opportunity:row.opportunity,activity:row.activity,registrar:row.registrar,mutationLabel:row.mutationTypes.map(value=>mutationLabels[value]||value.replaceAll('_',' ')).join(', ')||'—',caseRecord:caseRecord?{id:caseRecord.id,disposition:caseRecord.disposition}:null,outreach:outreach?{mailto:outreach.mailto,body:outreach.body}:null,abuse:abuse?{mailto:abuse.mailto,body:abuse.body}:null};});}
  function resultAt(index:number){return index>=0&&index<results.length?results[index]:null;}
  function toggleSavedAt(index:number){const row=resultAt(index);if(row)toggleSaved(row);}
  function trackCaseAt(index:number){const row=resultAt(index);if(row)trackCase(row);}
  function setDispositionAt(index:number,value:string){const row=resultAt(index);if(row)setRowDisposition(row,value);}
  async function inspectAt(index:number){const row=resultAt(index);if(!row)return;selectInvestigationGuideFocusDomain(row.domain);await goto(`/lookup?q=${encodeURIComponent(row.domain)}&depth=deep#query`);}
  async function run(domains:string[],replace=true){
    const limit=mode==='fast'?2000:200;
    if(!domains.length){status='Enter at least one domain.';return;}
    if(domains.length>limit){status=`${mode==='fast'?'Fast':'Deep'} scans are limited to ${limit} domains.`;return;}
    const scanController=new AbortController();
    const baseResults=replace?[]:[...results];
    const pendingResults:Array<ScanResult|undefined>=new Array(domains.length);
    let cursor=0;
    let publishTimer:ReturnType<typeof setTimeout>|null=null;
    const snapshot=()=>[...baseResults,...pendingResults.filter((row):row is ScanResult=>Boolean(row))];
    activeScanSnapshot=snapshot;
    const publish=()=>{if(publishTimer){clearTimeout(publishTimer);publishTimer=null;}results=snapshot();};
    const schedulePublish=()=>{if(!publishTimer)publishTimer=setTimeout(publish,RESULT_PUBLISH_MS);};
    controller=scanController;running=true;paused=false;completed=0;total=domains.length;page=1;
    if(replace)results=[];
    status=`Scanning ${total} domain${total===1?'':'s'}…`;
    const concurrency=mode==='fast'?12:4;
    const worker=async()=>{while(cursor<domains.length&&!scanController.signal.aborted){await waitWhilePaused();if(scanController.signal.aborted)break;const index=cursor++,domain=domains[index];try{const body=await fetchLookup(domain,scanController.signal);const row=normalize(domain,body);if(mode==='deep'&&body.availability?.deepScanComplete===false)row.saved.scanDepth='fast';pendingResults[index]=row;}catch(cause){if(cause instanceof DOMException&&cause.name==='AbortError')break;pendingResults[index]=failedResult(domain,cause instanceof Error?cause.message:'Lookup failed');}completed+=1;schedulePublish();}};
    await Promise.all(Array.from({length:Math.min(concurrency,domains.length)},worker));
    publish();activeScanSnapshot=null;running=false;controller=null;
    if(scanController.signal.aborted)return;
    status=`Completed ${completed} of ${total} lookups.`;
  }
  async function start(){if(lookupDisabled){status=lookupDisabled.reason||'Lookup is disabled by deployment policy.';return;}await run(parseDomains(),true);}
  async function retryErrors(){const domains=results.filter(r=>r.status==='error').map(r=>r.domain);results=results.filter(r=>r.status!=='error');await run(domains,false);}
  function exportCsv(){const header=['domain','unicode_domain','idn_scripts','idn_mixed_script','idn_official_skeleton_matches','availability','confidence','profile_status','registrar','activity','risk','risk_model_version','risk_factors','opportunity','mutations','error','dns_status','dnssec','dns_a','dns_aaaa','dns_cname','dns_caa','ct_first_observed','ct_last_observed','ct_certificate_count','ct_hostnames'];const rows=results.map(r=>[r.domain,r.idn?.hasIdn?r.idn.unicodeDomain:'',r.idn?.scripts?.join('|')||'',r.idn?.mixedScript?'true':'false',r.idn?.referenceMatches?.map((match)=>match.asciiDomain).join('|')||'',r.availability,r.confidence,r.trusted||'',r.registrar,r.activity,r.risk??'',r.saved.riskModelVersion??'',r.saved.riskFactors?.map((factor)=>`${factor.label} ${Number(factor.points)>=0?'+':''}${factor.points}`).join('; ')||'',r.opportunity??'',r.mutationTypes.join('|'),r.error,r.dns?.status||'',r.dnssec||'',r.dns?.records.a.join('|')||'',r.dns?.records.aaaa.join('|')||'',r.dns?.records.cname.join('|')||'',r.dns?.records.caa.map((item)=>`${item.critical} ${item.tag} ${item.value}`).join('|')||'',...ctCsvFields(r.ct)]);const url=URL.createObjectURL(new Blob([rowsToCsv([header,...rows])],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download=`whoisleuth-bulk-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url);}
  function exportDefensiveIndicators(){const exported=indicatorFormat==='stix'?buildStixIndicatorExport(filtered):indicatorFormat==='misp'?buildMispIndicatorExport(filtered):buildDefensiveIndicatorExport(filtered,{format:indicatorFormat});if(!exported.domains.length){indicatorStatus='No filtered high-risk registered domains are eligible for defensive export.';return;}const url=URL.createObjectURL(new Blob([exported.content],{type:exported.mimeType}));const anchor=document.createElement('a');anchor.href=url;anchor.download=exported.filename;anchor.click();URL.revokeObjectURL(url);indicatorStatus=`Exported ${exported.domains.length} candidate indicator${exported.domains.length===1?'':'s'}${exported.truncated?' from a capped result set':''}. Check for false positives before use.`;}
  async function saveResults(){const name=watchlistName.trim();if(!name){saveStatus='Enter a watchlist name.';return;}const findings=results.filter(row=>!row.trusted);if(!findings.length){saveStatus='Every result is trusted by the active profile; nothing was added to Monitor.';return;}try{const changes=await saveWatchlist(name,findings.map(r=>r.saved),mode);const excluded=results.length-findings.length;saveStatus=changes.length?`Updated ${name} and recorded ${changes.length} material change${changes.length===1?'':'s'}${excluded?`; excluded ${excluded} trusted domain${excluded===1?'':'s'}`:''}.`:`Saved ${findings.length} result${findings.length===1?'':'s'} to ${name}${excluded?`; excluded ${excluded} trusted domain${excluded===1?'':'s'}`:''}.`;watchlistName='';}catch(cause){saveStatus=cause instanceof Error?cause.message:'Could not save watchlist.';}}
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
      {mutationFilter}
      setMutationFilter={(value)=>{mutationFilter=value;page=1;}}
      mutationOptions={mutationOptions.map((value)=>({value,label:mutationLabels[value]||value.replaceAll('_',' ')}))}
      {signalFilters}
      {toggleSignal}
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
      {saveStatus}
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
    <BulkResultsTable
      rows={resultDisplayRows()}
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
