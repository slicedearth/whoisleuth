<script lang="ts">
  import { page } from '$app/state';
  import { getContext, onMount, tick } from 'svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import BrandProfileList from '$lib/components/BrandProfileList.svelte';
  import BrandProfileEditor from '$lib/components/BrandProfileEditor.svelte';
  import BrandReviewInbox from '$lib/components/BrandReviewInbox.svelte';
  import BrandPostureAudit from '$lib/components/BrandPostureAudit.svelte';
  import BrandPortfolioPostureMatrix from '$lib/components/BrandPortfolioPostureMatrix.svelte';
  import BrandDesiredPostureBaselines from '$lib/components/BrandDesiredPostureBaselines.svelte';
  import BrandDomainControlPassport from '$lib/components/BrandDomainControlPassport.svelte';
  import BrandCertificateEventReplay from '$lib/components/BrandCertificateEventReplay.svelte';
  import BrandProtectionAttestations from '$lib/components/BrandProtectionAttestations.svelte';
  import DomainControlCentre from '$lib/components/DomainControlCentre.svelte';
  import MailReportWorkbench from '$lib/components/MailReportWorkbench.svelte';
  import { activeProfileId, deleteProfile, exportProfiles, importProfiles, isBrandProfileMutationCommittedError, loadProfiles, MAX_PROFILE_IMPORT_BYTES, normalizeProfile, parseList, setActiveProfile, upsertProfile, type BrandProfile } from '$lib/brand-profiles';
  import { createPageBaseline, normalizePageBaseline } from '$lib/analysis/page-baseline.ts';
  import { loadCases, type CaseRecord } from '$lib/cases';
  import { BrowserLocalDataError } from '$lib/browser-local-data.ts';
  import type { DesiredPostureBaseline, ProtectionAttestation } from '$lib/analysis/brand-profile-model.ts';
  import { buildDesiredPostureObservation } from '$lib/analysis/owned-domain-posture-review.ts';
  import { brandProfileDeletionImpact, buildBrandReviewInbox, type BrandReviewSourceState } from '$lib/analysis/brand-review-inbox.ts';
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
  let auditGeneration=0;let auditController:AbortController|null=null;
  let cases=$state<CaseRecord[]>([]);
  let profileSourceState=$state<BrandReviewSourceState>('loading');
  let caseSourceState=$state<BrandReviewSourceState>('loading');
  let activePreferenceSourceState=$state<BrandReviewSourceState>('loading');
  let certificateReplayUnavailable=$state(false);
  let name=$state(''),official=$state(''),products=$state(''),tlds=$state('com, net, org'),partners=$state(''),allowDomains=$state(''),allowRegistrars=$state(''),selectors=$state(''),retiredSelectors=$state(''),mailProtectionProfile=$state('standard'),trademarkOwner=$state(''),trademarkRegistration=$state(''),faviconHash=$state(''),faviconPHash=$state('');
  let pageBaseline=$state<ReturnType<typeof normalizePageBaseline>>(null),capturingIdentity=$state(false);
  const capabilityReport=getContext<CapabilityGetter>(CAPABILITY_CONTEXT);
  const siteIdentityDisabled=$derived(disabledCapability(capabilityReport?.()||null,'availability')||disabledCapability(capabilityReport?.()||null,'website_probe'));
  const postureDisabled=$derived(disabledCapability(capabilityReport?.()||null,'domain_posture'));
  const active=$derived(profileSourceState==='ready'&&activePreferenceSourceState==='ready'?profiles.find(p=>p.id===activeId)||null:null);
  const brandReviewInbox=$derived(buildBrandReviewInbox({cases,profiles,activeProfileId:activeId,sourceStates:{cases:caseSourceState,profiles:profileSourceState,activePreference:activePreferenceSourceState}}));
  const localContextStatus=$derived([
    profileSourceState==='unavailable'?'Browser-local Brand Profiles could not be read.':null,
    activePreferenceSourceState==='unavailable'?'The active-profile preference could not be read; profile-scoped tools are suppressed.':null,
    caseSourceState==='unavailable'?'Cases could not be read, so linked-case context cannot be checked or displayed.':null,
  ].filter(Boolean).join(' '));
  const editorValues=$derived({name,official,products,tlds,partners,allowDomains,allowRegistrars,selectors,retiredSelectors,mailProtectionProfile,trademarkOwner,trademarkRegistration,faviconHash});
  const siteIdentityReason=$derived(siteIdentityDisabled?siteIdentityDisabled.reason||'Website checks are disabled by deployment policy.':'');
  const postureReason=$derived(postureDisabled?postureDisabled.reason||'Official-domain posture checks are disabled by deployment policy.':'');
  function closeActivePreferenceSource(){cancelAudit();activeId='';auditResults=[];activePreferenceSourceState='unavailable';}
  function closeProfileSource(){cancelAudit();profiles=[];editing='';showForm=false;pageBaseline=null;capturingIdentity=false;profileSourceState='unavailable';}
  function closeCaseSource(){cases=[];caseSourceState='unavailable';certificateReplayUnavailable=true;}
  function profileFailureMessage(cause:unknown,fallback:string){if(cause instanceof BrowserLocalDataError){closeProfileSource();return `${fallback} ${cause.message} Browser-local Brand Profiles are unavailable; reload to retry.`;}return cause instanceof Error?cause.message:fallback;}
  async function refreshProfiles(){
    cancelAudit();
    profileSourceState='loading';activePreferenceSourceState='loading';profiles=[];activeId='';auditResults=[];
    const [profileResult,preferenceResult]=await Promise.allSettled([
      loadProfiles(),
      Promise.resolve().then(()=>activeProfileId()),
    ]);
    if(profileResult.status==='fulfilled'){profiles=profileResult.value;profileSourceState='ready';}
    else closeProfileSource();
    if(preferenceResult.status==='fulfilled'){
      const nextActiveId=preferenceResult.value;
      try{
        if(profileResult.status==='fulfilled'&&nextActiveId&&!profileResult.value.some(p=>p.id===nextActiveId))setActiveProfile('');
        activeId=profileResult.status==='fulfilled'&&nextActiveId&&profileResult.value.some(p=>p.id===nextActiveId)?nextActiveId:'';
        activePreferenceSourceState='ready';
      }catch(cause){closeActivePreferenceSource();if(profileResult.status==='fulfilled')throw cause;}
    }else closeActivePreferenceSource();
    if(profileResult.status==='rejected')throw profileResult.reason;
    if(preferenceResult.status==='rejected')throw preferenceResult.reason;
    return profileResult.value;
  }
  async function refreshCasesForBrands(){caseSourceState='loading';cases=[];certificateReplayUnavailable=true;try{const loaded=await loadCases();cases=loaded;caseSourceState='ready';certificateReplayUnavailable=false;return loaded;}catch(cause){closeCaseSource();throw cause;}}
  async function focusEditor(){await tick();document.getElementById('brand-profile-name')?.focus();}
  function clearForm(prefillDomain=''){editing='';name='';official=prefillDomain;products='';tlds='com, net, org';partners='';allowDomains='';allowRegistrars='';selectors='';retiredSelectors='';mailProtectionProfile='standard';trademarkOwner='';trademarkRegistration='';faviconHash='';faviconPHash='';pageBaseline=null;capturingIdentity=false;showForm=true;void focusEditor();}
  function setEditorValue(field:EditorField,value:string){if(field==='name')name=value;else if(field==='official')official=value;else if(field==='products')products=value;else if(field==='tlds')tlds=value;else if(field==='partners')partners=value;else if(field==='allowDomains')allowDomains=value;else if(field==='allowRegistrars')allowRegistrars=value;else if(field==='selectors')selectors=value;else if(field==='retiredSelectors')retiredSelectors=value;else if(field==='mailProtectionProfile')mailProtectionProfile=value;else if(field==='trademarkOwner')trademarkOwner=value;else if(field==='trademarkRegistration')trademarkRegistration=value;else faviconHash=value;}
  function edit(profile:BrandProfile){editing=profile.id;name=profile.name;official=profile.officialDomains.join('\n');products=profile.productNames.join(', ');tlds=profile.tlds.join(', ');partners=profile.approvedPartnerDomains.join('\n');allowDomains=profile.allowlistedDomains.join('\n');allowRegistrars=profile.allowlistedRegistrars.join(', ');selectors=profile.dkimSelectors.join(', ');retiredSelectors=profile.retiredDkimSelectors.join(', ');mailProtectionProfile=profile.mailProtectionProfile;trademarkOwner=profile.trademarkOwner;trademarkRegistration=profile.trademarkRegistration;faviconHash=profile.officialFaviconHash;faviconPHash=profile.officialFaviconPHash;pageBaseline=normalizePageBaseline(profile.pageBaseline);capturingIdentity=false;showForm=true;void focusEditor();}
  type ProfileCommitIssue='active-preference'|'reread'|null;
  type ProfileCommitOptions=Readonly<{preserveCompletedAudit?:boolean}>;
  type CompletedAuditSnapshot=Readonly<{profileId:string;profileFingerprint:string;results:readonly AuditResult[]}>;
  function captureCompletedAudit():CompletedAuditSnapshot|null{const current=active;if(!current||auditing||auditController!==null||!auditResults.length)return null;return{profileId:current.id,profileFingerprint:auditProfileFingerprint(current),results:[...auditResults]};}
  function restoreCompletedAudit(snapshot:CompletedAuditSnapshot|null){if(!snapshot||profileSourceState!=='ready'||activePreferenceSourceState!=='ready')return;const current=profiles.find((profile)=>profile.id===activeId)||null;if(!current||current.id!==snapshot.profileId||auditProfileFingerprint(current)!==snapshot.profileFingerprint)return;auditResults=[...snapshot.results];}
  function installCommittedProfileSnapshot(committedProfiles:readonly BrandProfile[]){cancelAudit();profiles=[...committedProfiles];profileSourceState='ready';closeActivePreferenceSource();}
  function committedIssueText(issue:Exclude<ProfileCommitIssue,null>,noun='profile write'){return issue==='active-preference'?`The ${noun} was committed, but the active-profile preference could not be updated or reread. Reload before using profile-scoped tools.`:`The ${noun} was committed, but Brand Profiles could not be reread. Reload to retry the browser-local read.`;}
  function profileWriteFailureMessage(cause:unknown,fallback:string){if(cause instanceof BrowserLocalDataError&&(cause.code==='LOCAL_DATA_QUOTA'||cause.code==='LOCAL_DATA_WRITE_FAILED'))return `${fallback} ${cause.message}`;return profileFailureMessage(cause,fallback);}
  async function commitProfileWrite(raw:unknown,editingId='',options:ProfileCommitOptions={}):Promise<{profile:BrandProfile;issue:ProfileCommitIssue}>{
    const completedAudit=options.preserveCompletedAudit?captureCompletedAudit():null;
    cancelAudit();
    let profile:BrandProfile;
    try{profile=await upsertProfile(raw,editingId);}
    catch(cause){
      if(!isBrandProfileMutationCommittedError(cause)||cause.operation!=='save'||!cause.profile){restoreCompletedAudit(completedAudit);throw cause;}
      installCommittedProfileSnapshot(cause.profiles);
      restoreCompletedAudit(completedAudit);
      return{profile:cause.profile,issue:'active-preference'};
    }
    try{await refreshProfiles();restoreCompletedAudit(completedAudit);return{profile,issue:null};}
    catch{restoreCompletedAudit(completedAudit);return{profile,issue:profileSourceState==='unavailable'?'reread':'active-preference'};}
  }
  async function commitProfileDelete(profile:BrandProfile):Promise<ProfileCommitIssue>{
    cancelAudit();
    try{await deleteProfile(profile.id);}
    catch(cause){
      if(!isBrandProfileMutationCommittedError(cause)||cause.operation!=='delete')throw cause;
      installCommittedProfileSnapshot(cause.profiles);
      return'active-preference';
    }
    try{await refreshProfiles();return null;}
    catch{return profileSourceState==='unavailable'?'reread':'active-preference';}
  }
  async function save(){
    try{
      const existing=editing?profiles.find((profile)=>profile.id===editing):null;
      const result=await commitProfileWrite({name,officialDomains:parseList(official,true),productNames:parseList(products),tlds:parseList(tlds,true),approvedPartnerDomains:parseList(partners,true),allowlistedDomains:parseList(allowDomains,true),allowlistedRegistrars:parseList(allowRegistrars),dkimSelectors:parseList(selectors,true),retiredDkimSelectors:parseList(retiredSelectors,true),mailProtectionProfile,protectionAttestations:existing?.protectionAttestations||[],desiredPostureBaselines:existing?.desiredPostureBaselines||[],trademarkOwner,trademarkRegistration,officialFaviconHash:faviconHash,officialFaviconPHash:faviconPHash,pageBaseline},editing);
      showForm=false;
      message=result.issue?`Saved "${result.profile.name}". ${committedIssueText(result.issue)}`:`Saved "${result.profile.name}" and set it active.`;
    }catch(cause){message=profileFailureMessage(cause,'Could not save profile.');}
  }
  async function remove(profile:BrandProfile){
    let impact:string;
    try{const freshCases=await refreshCasesForBrands();impact=brandProfileDeletionImpact(freshCases,profile.id,'ready');}
    catch{impact=brandProfileDeletionImpact([],profile.id,'unavailable');}
    if(!confirm(`Delete brand profile "${profile.name}"? ${impact}`))return false;
    let issue:ProfileCommitIssue;
    try{issue=await commitProfileDelete(profile);}
    catch(cause){message=profileFailureMessage(cause,'Could not delete profile.');return false;}
    const associationState=caseSourceState==='ready'
      ?'Case associations were not changed; retained references now appear unresolved.'
      :'Case associations remain preserved, but cases are unavailable so retained references cannot currently be resolved or displayed.';
    if(editing===profile.id){editing='';showForm=false;}
    message=`Deleted "${profile.name}". ${issue?`${committedIssueText(issue,'deletion')} `:''}${associationState}`;
    return true;
  }
  async function saveAttestations(attestations:ProtectionAttestation[]){if(!active)return;try{const result=await commitProfileWrite({...active,protectionAttestations:attestations},active.id,{preserveCompletedAudit:true});message=result.issue?`Saved reviewed protection attestations. ${committedIssueText(result.issue)}`:'Saved reviewed protection attestations. Expired statements remain visible until reviewed again.';}catch(cause){message=profileWriteFailureMessage(cause,'Could not save protection attestations.');}}
  async function persistBaselines(desiredPostureBaselines:DesiredPostureBaseline[]){if(!active)return false;try{const result=await commitProfileWrite({...active,desiredPostureBaselines},active.id,{preserveCompletedAudit:true});message=result.issue?`Saved analyst-authored desired posture baselines. ${committedIssueText(result.issue)}`:'Saved analyst-authored desired posture baselines.';return true;}catch(cause){message=profileWriteFailureMessage(cause,'Could not save desired posture baselines.');return false;}}
  async function saveBaselines(desiredPostureBaselines:DesiredPostureBaseline[]){await persistBaselines(desiredPostureBaselines);}
  async function savePassportProfile(profile:BrandProfile){try{const result=await commitProfileWrite(profile,profile.id);message=result.issue?`Imported and saved the selected domain-control passport fields. ${committedIssueText(result.issue)}`:'Imported the selected domain-control passport fields.';}catch(cause){message=profileFailureMessage(cause,'Could not save imported domain-control fields.');}}
  async function retainObservation(report:DomainPostureHttpResponse){if(!active)return;const baseline=active.desiredPostureBaselines.find((item)=>item.domain===report.domain);if(!baseline){message='Configure a desired posture baseline before retaining an observation.';return;}const observation=buildDesiredPostureObservation(report);const history=[...(baseline.observationHistory||(baseline.previousObservation?[baseline.previousObservation]:[])).filter((item)=>item.observedAt!==observation.observedAt),observation].sort((left,right)=>Date.parse(left.observedAt)-Date.parse(right.observedAt)).slice(-12);const saved=await persistBaselines(active.desiredPostureBaselines.map((item)=>item.domain===report.domain?{...item,previousObservation:observation,observationHistory:history,updatedAt:new Date().toISOString()}:item));if(saved&&profileSourceState==='ready'&&activePreferenceSourceState==='ready')message=`Retained the compact ${report.checkedAt} posture observation for ${report.domain}.`;}
  function cancelAudit(){auditGeneration+=1;auditController?.abort();auditController=null;auditing=false;auditResults=[];}
  function auditProfileFingerprint(profile:BrandProfile){const normalized=normalizeProfile(profile);return JSON.stringify([normalized.id,normalized.officialDomains,normalized.mailProtectionProfile,normalized.dkimSelectors,normalized.retiredDkimSelectors]);}
  function activate(id:string){cancelAudit();try{setActiveProfile(id);activeId=id;activePreferenceSourceState='ready';const profile=profiles.find(item=>item.id===id);message=profile?`Set "${profile.name}" active.`:'Set the selected Brand Profile active.';return true;}catch(cause){closeActivePreferenceSource();message=cause instanceof BrowserLocalDataError?'Could not set the active profile. The active-profile preference is unavailable; reload to retry.':cause instanceof Error?cause.message:'Could not set the active profile.';return false;}}
  async function captureSiteIdentity(){if(siteIdentityDisabled){message=siteIdentityDisabled.reason||'Website checks are disabled by deployment policy.';return;}const domain=parseList(official,true)[0];if(!domain){message='Enter an official domain first.';return;}capturingIdentity=true;message='Capturing official-site identity…';try{const{response,body:raw}=await requestJsonCapped(`/api/availability?q=${encodeURIComponent(domain)}`,{cache:'no-store'},{maximumBytes:LARGE_JSON_RESPONSE_BYTES,timeoutMs:40_000});if(!response.ok)throw new Error(clientHttpErrorMessage(raw,response.status,'Official-site capture failed'));const parsed=parseAvailabilityCaptureResponse(raw,domain);if(!parsed.ok)throw new Error(parsed.error);const body=parsed.value;const captured=createPageBaseline(domain,body);if(!captured){if(typeof body.faviconHash==='string'&&body.faviconHash)faviconHash=body.faviconHash;if(typeof body.faviconPHash==='string'&&body.faviconPHash)faviconPHash=body.faviconPHash;message=`No page fingerprint baseline was available for ${domain}.${pageBaseline?' The existing baseline is unchanged.':''}`;return;}faviconHash=captured.faviconHash||'';faviconPHash=captured.faviconPHash||'';pageBaseline=captured;message=`Captured a ${captured.complete?'complete':'partial'} page baseline for ${domain}. Save the profile to retain it.`;}catch(cause){message=cause instanceof Error?cause.message:'Official-site capture failed';}finally{capturingIdentity=false;}}
  function baselineDate(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?'Unknown time':date.toLocaleString('en-AU');}
  async function audit(){
    if(postureDisabled){message=postureDisabled.reason||'Official-domain posture checks are disabled by deployment policy.';return;}
    if(!active?.officialDomains.length)return;
    const profileSnapshot=normalizeProfile(active);
    const profileId=profileSnapshot.id;
    const profileFingerprint=auditProfileFingerprint(profileSnapshot);
    const generation=++auditGeneration;
    auditController?.abort();
    const controller=new AbortController();
    auditController=controller;
    const ownsRequest=()=>generation===auditGeneration&&auditController===controller;
    const canPublish=()=>{const current=active;return ownsRequest()&&activeId===profileId&&current!==null&&auditProfileFingerprint(current)===profileFingerprint;};
    auditing=true;auditResults=[];
    const domains=profileSnapshot.officialDomains.slice(0,20);
    message=`Auditing ${domains.length} official domain${domains.length===1?'':'s'}…`;
    let cursor=0;
    const next:AuditResult[]=new Array(domains.length);
    const worker=async()=>{while(cursor<domains.length&&!controller.signal.aborted){const index=cursor++,domain=domains[index];if(domain===undefined)break;try{const params=new URLSearchParams({q:domain,mailProfile:profileSnapshot.mailProtectionProfile});if(profileSnapshot.dkimSelectors.length)params.set('selectors',profileSnapshot.dkimSelectors.join(','));if(profileSnapshot.retiredDkimSelectors.length)params.set('retiredSelectors',profileSnapshot.retiredDkimSelectors.join(','));const{response,body:raw}=await requestJsonCapped(`/api/domain-posture?${params}`,{cache:'no-store',signal:controller.signal},{maximumBytes:STANDARD_JSON_RESPONSE_BYTES,timeoutMs:40_000});if(!response.ok)throw new Error(clientHttpErrorMessage(raw,response.status,'Audit failed'));const parsed=parseDomainPostureHttpResponse(raw,domain);if(!parsed.ok)throw new Error(parsed.error);next[index]={domain,report:parsed.value,error:''};}catch(cause){if(controller.signal.aborted)return;next[index]={domain,report:null,error:cause instanceof Error?cause.message:'Audit failed'};}}};
    try{
      await Promise.all(Array.from({length:Math.min(3,domains.length)},worker));
      if(!canPublish())return;
      auditResults=next;
      message=`Audited ${next.filter(v=>v?.report).length}/${domains.length} official domain${domains.length===1?'':'s'}.`;
    }finally{
      if(ownsRequest()){auditing=false;auditController=null;}
    }
  }
  async function importFile(event:Event){const input=event.currentTarget as HTMLInputElement,file=input.files?.[0];if(!file)return;cancelAudit();let result:Awaited<ReturnType<typeof importProfiles>>|null=null;try{if(file.size>MAX_PROFILE_IMPORT_BYTES)throw new Error('Profile imports are limited to 2 MB.');result=await importProfiles(JSON.parse(await file.text()));}catch(cause){message=profileFailureMessage(cause,'Import failed.');input.value='';return;}const skipped=result.skipped?`; skipped ${result.skipped} invalid or over-limit profile${result.skipped===1?'':'s'}`:'';try{await refreshProfiles();message=`Imported ${result.added} new and ${result.updated} updated profiles${skipped}.`;}catch{const issue:Exclude<ProfileCommitIssue,null>=profileSourceState==='unavailable'?'reread':'active-preference';message=`Imported ${result.added} new and ${result.updated} updated profiles${skipped}. ${committedIssueText(issue,'profile import')}`;}finally{input.value='';}}
  async function download(){try{await exportProfiles();message='Exported the Brand Profile collection.';}catch(cause){message=profileFailureMessage(cause,'Could not export profiles.');}}
  onMount(()=>{void (async()=>{
    await Promise.allSettled([refreshProfiles(),refreshCasesForBrands()]);
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
  })();return cancelAudit;});
</script>

<svelte:head><title>Brands · WHOISleuth</title></svelte:head>
<PageHeading eyebrow="Protect" title="Brands" description="Define official domains, trusted partners, allowlists, and security posture checks."><div class="top-actions toolbar"><button id="new-brand-profile" class="primary" onclick={()=>clearForm()} disabled={profileSourceState!=='ready'}>New profile</button><button class="btn" onclick={download} disabled={profileSourceState!=='ready'||!profiles.length}>Export JSON</button><label class="btn file-btn">Import JSON<input type="file" accept="application/json,.json" onchange={importFile} disabled={profileSourceState!=='ready'}></label></div></PageHeading>
{#if localContextStatus}<p class="local-context-status" role="status">{localContextStatus}</p>{/if}
{#if message}<p class="message" role="status" aria-label="Brand Profile action status" aria-live="polite" aria-atomic="true">{message}</p>{/if}
{#if profileSourceState === 'loading'}
  <section class="profile-source-state card" role="status" aria-busy="true">Loading browser-local Brand Profiles…</section>
{:else if profileSourceState === 'unavailable'}
  <section id="brand-profile-source-state" tabindex="-1" class="profile-source-state unavailable card" role="alert">Brand Profiles could not be read. No empty-profile conclusion has been drawn; reload to try again.</section>
{:else}
  <BrandProfileList {profiles} {activeId} focusId={page.url.searchParams.get('profile') || ''} {activate} {edit} {remove} formatDate={baselineDate} />
{/if}
{#if showForm}<BrandProfileEditor editing={Boolean(editing)} values={editorValues} setValue={setEditorValue} {pageBaseline} {capturingIdentity} disabledReason={siteIdentityReason} {captureSiteIdentity} {save} close={()=>showForm=false} formatDate={baselineDate} />{/if}
<BrandReviewInbox inbox={brandReviewInbox} />

{#if active}<DomainControlCentre {active} /><BrandPortfolioPostureMatrix {active} /><BrandPostureAudit {active} disabledReason={postureReason} {auditing} results={auditResults} {audit} {retainObservation} /><BrandDesiredPostureBaselines {active} {saveBaselines} requestedDomain={page.url.searchParams.get('baseline') || ''} /><BrandDomainControlPassport {active} saveProfile={savePassportProfile} /><BrandCertificateEventReplay {active} {cases} unavailable={certificateReplayUnavailable} /><BrandProtectionAttestations {active} {saveAttestations} /><MailReportWorkbench {active} />{/if}

<style>
  .message{min-width:0;color:var(--accent);font-size:var(--text-sm);overflow-wrap:anywhere}
  .local-context-status{min-width:0;color:var(--amber);font-size:var(--text-sm);overflow-wrap:anywhere}
  .profile-source-state{padding:var(--card-pad);color:var(--muted);font-size:var(--text-sm)}
  .profile-source-state.unavailable{color:var(--amber)}
  @media(max-width:750px){
    .top-actions{margin-top:14px}
  }
</style>
