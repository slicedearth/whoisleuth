<script lang="ts">
  import { page } from '$app/state';
  import { getContext, onMount, tick } from 'svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import BrandProfileList from '$lib/components/BrandProfileList.svelte';
  import BrandProfileEditor from '$lib/components/BrandProfileEditor.svelte';
  import BrandPostureAudit from '$lib/components/BrandPostureAudit.svelte';
  import BrandDesiredPostureBaselines from '$lib/components/BrandDesiredPostureBaselines.svelte';
  import BrandDomainControlPassport from '$lib/components/BrandDomainControlPassport.svelte';
  import BrandCertificateEventReplay from '$lib/components/BrandCertificateEventReplay.svelte';
  import BrandProtectionAttestations from '$lib/components/BrandProtectionAttestations.svelte';
  import DomainControlCentre from '$lib/components/DomainControlCentre.svelte';
  import MailReportWorkbench from '$lib/components/MailReportWorkbench.svelte';
  import { activeProfileId, deleteProfile, exportProfiles, importProfiles, loadProfiles, MAX_PROFILE_IMPORT_BYTES, parseList, setActiveProfile, upsertProfile, type BrandProfile } from '$lib/brand-profiles';
  import { createPageBaseline, normalizePageBaseline } from '$lib/analysis/page-baseline.ts';
  import { loadCases, type CaseRecord } from '$lib/cases';
  import type { DesiredPostureBaseline, ProtectionAttestation } from '$lib/analysis/brand-profile-model.ts';
  import { buildDesiredPostureObservation } from '$lib/analysis/owned-domain-posture-review.ts';
  import {
    clientHttpErrorMessage,
    parseAvailabilityCaptureResponse,
    parseDomainPostureHttpResponse,
    type DomainPostureHttpResponse,
  } from '$lib/analysis/client-response-contracts';
  import { CAPABILITY_CONTEXT, disabledCapability, type CapabilityGetter } from '$lib/capabilities';
  import { LARGE_JSON_RESPONSE_BYTES, requestJsonCapped, STANDARD_JSON_RESPONSE_BYTES } from '$lib/bounded-json-response';
  type AuditResult={domain:string;report:DomainPostureHttpResponse|null;error:string};
  type EditorField='name'|'official'|'products'|'tlds'|'partners'|'allowDomains'|'allowRegistrars'|'selectors'|'retiredSelectors'|'mailProtectionProfile'|'trademarkOwner'|'trademarkRegistration'|'faviconHash';
  let profiles=$state<BrandProfile[]>([]);let activeId=$state('');let editing=$state('');let showForm=$state(false);let message=$state('');let auditing=$state(false);let auditResults=$state<AuditResult[]>([]);
  let cases=$state<CaseRecord[]>([]);
  let certificateReplayUnavailable=$state(false);
  let name=$state(''),official=$state(''),products=$state(''),tlds=$state('com, net, org'),partners=$state(''),allowDomains=$state(''),allowRegistrars=$state(''),selectors=$state(''),retiredSelectors=$state(''),mailProtectionProfile=$state('standard'),trademarkOwner=$state(''),trademarkRegistration=$state(''),faviconHash=$state(''),faviconPHash=$state('');
  let pageBaseline=$state<ReturnType<typeof normalizePageBaseline>>(null),capturingIdentity=$state(false);
  const capabilityReport=getContext<CapabilityGetter>(CAPABILITY_CONTEXT);
  const siteIdentityDisabled=$derived(disabledCapability(capabilityReport?.()||null,'availability')||disabledCapability(capabilityReport?.()||null,'website_probe'));
  const postureDisabled=$derived(disabledCapability(capabilityReport?.()||null,'domain_posture'));
  const active=$derived(profiles.find(p=>p.id===activeId)||null);
  const editorValues=$derived({name,official,products,tlds,partners,allowDomains,allowRegistrars,selectors,retiredSelectors,mailProtectionProfile,trademarkOwner,trademarkRegistration,faviconHash});
  const siteIdentityReason=$derived(siteIdentityDisabled?siteIdentityDisabled.reason||'Website checks are disabled by deployment policy.':'');
  const postureReason=$derived(postureDisabled?postureDisabled.reason||'Official-domain posture checks are disabled by deployment policy.':'');
  async function refresh(){profiles=await loadProfiles();activeId=activeProfileId();if(activeId&&!profiles.some(p=>p.id===activeId)){activeId='';setActiveProfile('');}}
  function clearForm(prefillDomain=''){editing='';name='';official=prefillDomain;products='';tlds='com, net, org';partners='';allowDomains='';allowRegistrars='';selectors='';retiredSelectors='';mailProtectionProfile='standard';trademarkOwner='';trademarkRegistration='';faviconHash='';faviconPHash='';pageBaseline=null;capturingIdentity=false;showForm=true;}
  function setEditorValue(field:EditorField,value:string){if(field==='name')name=value;else if(field==='official')official=value;else if(field==='products')products=value;else if(field==='tlds')tlds=value;else if(field==='partners')partners=value;else if(field==='allowDomains')allowDomains=value;else if(field==='allowRegistrars')allowRegistrars=value;else if(field==='selectors')selectors=value;else if(field==='retiredSelectors')retiredSelectors=value;else if(field==='mailProtectionProfile')mailProtectionProfile=value;else if(field==='trademarkOwner')trademarkOwner=value;else if(field==='trademarkRegistration')trademarkRegistration=value;else faviconHash=value;}
  function edit(profile:BrandProfile){editing=profile.id;name=profile.name;official=profile.officialDomains.join('\n');products=profile.productNames.join(', ');tlds=profile.tlds.join(', ');partners=profile.approvedPartnerDomains.join('\n');allowDomains=profile.allowlistedDomains.join('\n');allowRegistrars=profile.allowlistedRegistrars.join(', ');selectors=profile.dkimSelectors.join(', ');retiredSelectors=profile.retiredDkimSelectors.join(', ');mailProtectionProfile=profile.mailProtectionProfile;trademarkOwner=profile.trademarkOwner;trademarkRegistration=profile.trademarkRegistration;faviconHash=profile.officialFaviconHash;faviconPHash=profile.officialFaviconPHash;pageBaseline=normalizePageBaseline(profile.pageBaseline);capturingIdentity=false;showForm=true;}
  async function save(){try{const existing=editing?profiles.find((profile)=>profile.id===editing):null;const profile=await upsertProfile({name,officialDomains:parseList(official,true),productNames:parseList(products),tlds:parseList(tlds,true),approvedPartnerDomains:parseList(partners,true),allowlistedDomains:parseList(allowDomains,true),allowlistedRegistrars:parseList(allowRegistrars),dkimSelectors:parseList(selectors,true),retiredDkimSelectors:parseList(retiredSelectors,true),mailProtectionProfile,protectionAttestations:existing?.protectionAttestations||[],desiredPostureBaselines:existing?.desiredPostureBaselines||[],trademarkOwner,trademarkRegistration,officialFaviconHash:faviconHash,officialFaviconPHash:faviconPHash,pageBaseline},editing);message=`Saved "${profile.name}" and set it active.`;showForm=false;await refresh();}catch(cause){message=cause instanceof Error?cause.message:'Could not save profile.';}}
  async function remove(profile:BrandProfile){if(!confirm(`Delete brand profile "${profile.name}"?`))return;try{await deleteProfile(profile.id);auditResults=[];await refresh();message=`Deleted "${profile.name}".`;}catch(cause){message=cause instanceof Error?cause.message:'Could not delete profile.';}}
  async function saveAttestations(attestations:ProtectionAttestation[]){if(!active)return;try{await upsertProfile({...active,protectionAttestations:attestations},active.id);await refresh();message='Saved reviewed protection attestations. Expired statements remain visible until reviewed again.';}catch(cause){message=cause instanceof Error?cause.message:'Could not save protection attestations.';}}
  async function saveBaselines(desiredPostureBaselines:DesiredPostureBaseline[]){if(!active)return;try{await upsertProfile({...active,desiredPostureBaselines},active.id);await refresh();message='Saved analyst-authored desired posture baselines.';}catch(cause){message=cause instanceof Error?cause.message:'Could not save desired posture baselines.';}}
  async function savePassportProfile(profile:BrandProfile){try{await upsertProfile(profile,profile.id);await refresh();message='Imported the selected domain-control passport fields.';}catch(cause){message=cause instanceof Error?cause.message:'Could not save imported domain-control fields.';}}
  async function retainObservation(report:DomainPostureHttpResponse){if(!active)return;const baseline=active.desiredPostureBaselines.find((item)=>item.domain===report.domain);if(!baseline){message='Configure a desired posture baseline before retaining an observation.';return;}const observation=buildDesiredPostureObservation(report);const history=[...(baseline.observationHistory||(baseline.previousObservation?[baseline.previousObservation]:[])).filter((item)=>item.observedAt!==observation.observedAt),observation].sort((left,right)=>Date.parse(left.observedAt)-Date.parse(right.observedAt)).slice(-12);await saveBaselines(active.desiredPostureBaselines.map((item)=>item.domain===report.domain?{...item,previousObservation:observation,observationHistory:history,updatedAt:new Date().toISOString()}:item));message=`Retained the compact ${report.checkedAt} posture observation for ${report.domain}.`;}
  function activate(id:string){try{setActiveProfile(id);activeId=id;auditResults=[];}catch(cause){message=cause instanceof Error?cause.message:'Could not set the active profile.';}}
  async function captureSiteIdentity(){if(siteIdentityDisabled){message=siteIdentityDisabled.reason||'Website checks are disabled by deployment policy.';return;}const domain=parseList(official,true)[0];if(!domain){message='Enter an official domain first.';return;}capturingIdentity=true;message='Capturing official-site identity…';try{const{response,body:raw}=await requestJsonCapped(`/api/availability?q=${encodeURIComponent(domain)}`,{cache:'no-store'},{maximumBytes:LARGE_JSON_RESPONSE_BYTES,timeoutMs:40_000});if(!response.ok)throw new Error(clientHttpErrorMessage(raw,response.status,'Official-site capture failed'));const parsed=parseAvailabilityCaptureResponse(raw,domain);if(!parsed.ok)throw new Error(parsed.error);const body=parsed.value;const captured=createPageBaseline(domain,body);if(!captured){if(typeof body.faviconHash==='string'&&body.faviconHash)faviconHash=body.faviconHash;if(typeof body.faviconPHash==='string'&&body.faviconPHash)faviconPHash=body.faviconPHash;message=`No page fingerprint baseline was available for ${domain}.${pageBaseline?' The existing baseline is unchanged.':''}`;return;}faviconHash=captured.faviconHash||'';faviconPHash=captured.faviconPHash||'';pageBaseline=captured;message=`Captured a ${captured.complete?'complete':'partial'} page baseline for ${domain}. Save the profile to retain it.`;}catch(cause){message=cause instanceof Error?cause.message:'Official-site capture failed';}finally{capturingIdentity=false;}}
  function baselineDate(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?'Unknown time':date.toLocaleString();}
  async function audit(){if(postureDisabled){message=postureDisabled.reason||'Official-domain posture checks are disabled by deployment policy.';return;}if(!active?.officialDomains.length)return;auditing=true;auditResults=[];message=`Auditing ${active.officialDomains.length} official domain${active.officialDomains.length===1?'':'s'}…`;const domains=active.officialDomains.slice(0,20);let cursor=0;const next:AuditResult[]=new Array(domains.length);const worker=async()=>{while(cursor<domains.length){const index=cursor++,domain=domains[index];if(domain===undefined)break;try{const params=new URLSearchParams({q:domain,mailProfile:active.mailProtectionProfile});if(active.dkimSelectors.length)params.set('selectors',active.dkimSelectors.join(','));if(active.retiredDkimSelectors.length)params.set('retiredSelectors',active.retiredDkimSelectors.join(','));const{response,body:raw}=await requestJsonCapped(`/api/domain-posture?${params}`,{cache:'no-store'},{maximumBytes:STANDARD_JSON_RESPONSE_BYTES,timeoutMs:40_000});if(!response.ok)throw new Error(clientHttpErrorMessage(raw,response.status,'Audit failed'));const parsed=parseDomainPostureHttpResponse(raw,domain);if(!parsed.ok)throw new Error(parsed.error);next[index]={domain,report:parsed.value,error:''};}catch(cause){next[index]={domain,report:null,error:cause instanceof Error?cause.message:'Audit failed'};}}};await Promise.all(Array.from({length:Math.min(3,domains.length)},worker));auditResults=next;auditing=false;message=`Audited ${next.filter(v=>v?.report).length}/${domains.length} official domain${domains.length===1?'':'s'}.`;}
  async function importFile(event:Event){const input=event.currentTarget as HTMLInputElement,file=input.files?.[0];if(!file)return;try{if(file.size>MAX_PROFILE_IMPORT_BYTES)throw new Error('Profile imports are limited to 2 MB.');const result=await importProfiles(JSON.parse(await file.text()));const skipped=result.skipped?`; skipped ${result.skipped} invalid or over-limit profile${result.skipped===1?'':'s'}`:'';message=`Imported ${result.added} new and ${result.updated} updated profiles${skipped}.`;await refresh();}catch(cause){message=cause instanceof Error?cause.message:'Import failed';}finally{input.value='';}}
  async function download(){try{await exportProfiles();message='Exported the Brand Profile collection.';}catch(cause){message=cause instanceof Error?cause.message:'Could not export profiles.';}}
  onMount(()=>{void (async()=>{
    await refresh();
    try{cases=await loadCases();certificateReplayUnavailable=false;}catch{cases=[];certificateReplayUnavailable=true;}
    const guideDomain=parseList(page.url.searchParams.get('domain')||'',true)[0]||'';
    if(page.url.searchParams.get('new')==='1'&&guideDomain){
      clearForm(guideDomain);
      await tick();
      if(page.url.hash==='#official-domains'){
        const target=document.getElementById('official-domains');
        target?.scrollIntoView({block:'center'});
        target?.focus({preventScroll:true});
      }
    }
  })();});
</script>

<svelte:head><title>Brands · WHOISleuth</title></svelte:head>
<PageHeading eyebrow="Protect" title="Brands" description="Define official domains, trusted partners, allowlists, and security posture checks."><div class="top-actions toolbar"><button id="new-brand-profile" class="primary" onclick={()=>clearForm()}>New profile</button><button class="btn" onclick={download} disabled={!profiles.length}>Export JSON</button><label class="btn file-btn">Import JSON<input type="file" accept="application/json,.json" onchange={importFile}></label></div></PageHeading>
{#if message}<p class="message" role="status" aria-live="polite">{message}</p>{/if}
<BrandProfileList {profiles} {activeId} focusId={page.url.searchParams.get('profile') || ''} {activate} {edit} {remove} formatDate={baselineDate} />

{#if showForm}<BrandProfileEditor editing={Boolean(editing)} values={editorValues} setValue={setEditorValue} {pageBaseline} {capturingIdentity} disabledReason={siteIdentityReason} {captureSiteIdentity} {save} close={()=>showForm=false} formatDate={baselineDate} />{/if}

{#if active}<DomainControlCentre {active} /><BrandPostureAudit {active} disabledReason={postureReason} {auditing} results={auditResults} {audit} {retainObservation} /><BrandDesiredPostureBaselines {active} {saveBaselines} /><BrandDomainControlPassport {active} saveProfile={savePassportProfile} /><BrandCertificateEventReplay {active} {cases} unavailable={certificateReplayUnavailable} /><BrandProtectionAttestations {active} {saveAttestations} /><MailReportWorkbench {active} />{/if}

<style>
  .message{color:var(--accent);font-size:var(--text-sm)}
  @media(max-width:750px){
    .top-actions{margin-top:14px}
  }
</style>
