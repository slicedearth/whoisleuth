<script lang="ts">
  import { page } from '$app/state';
  import { getContext } from 'svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import BrandProfileList from '$lib/components/BrandProfileList.svelte';
  import BrandProfileEditor from '$lib/components/BrandProfileEditor.svelte';
  import BrandPostureAudit from '$lib/components/BrandPostureAudit.svelte';
  import { activeProfileId, deleteProfile, exportProfiles, importProfiles, loadProfiles, MAX_PROFILE_IMPORT_BYTES, parseList, setActiveProfile, upsertProfile, type BrandProfile } from '$lib/brand-profiles';
  import { createPageBaseline, normalizePageBaseline } from '$lib/analysis/page-baseline.js';
  import { CAPABILITY_CONTEXT, disabledCapability, type CapabilityGetter } from '$lib/capabilities';
  type AuditResult={domain:string;report:any|null;error:string};
  type EditorField='name'|'official'|'products'|'tlds'|'partners'|'allowDomains'|'allowRegistrars'|'selectors'|'trademarkOwner'|'trademarkRegistration'|'faviconHash';
  let profiles=$state<BrandProfile[]>([]);let activeId=$state('');let editing=$state('');let showForm=$state(false);let message=$state('');let auditing=$state(false);let auditResults=$state<AuditResult[]>([]);
  let name=$state(''),official=$state(''),products=$state(''),tlds=$state('com, net, org'),partners=$state(''),allowDomains=$state(''),allowRegistrars=$state(''),selectors=$state(''),trademarkOwner=$state(''),trademarkRegistration=$state(''),faviconHash=$state(''),faviconPHash=$state('');
  let pageBaseline=$state<ReturnType<typeof normalizePageBaseline>>(null),capturingIdentity=$state(false);
  const capabilityReport=getContext<CapabilityGetter>(CAPABILITY_CONTEXT);
  const siteIdentityDisabled=$derived(disabledCapability(capabilityReport?.()||null,'availability')||disabledCapability(capabilityReport?.()||null,'website_probe'));
  const postureDisabled=$derived(disabledCapability(capabilityReport?.()||null,'domain_posture'));
  const active=$derived(profiles.find(p=>p.id===activeId)||null);
  const editorValues=$derived({name,official,products,tlds,partners,allowDomains,allowRegistrars,selectors,trademarkOwner,trademarkRegistration,faviconHash});
  const siteIdentityReason=$derived(siteIdentityDisabled?siteIdentityDisabled.reason||'Website checks are disabled by deployment policy.':'');
  const postureReason=$derived(postureDisabled?postureDisabled.reason||'Official-domain posture checks are disabled by deployment policy.':'');
  function refresh(){profiles=loadProfiles();activeId=activeProfileId();if(activeId&&!profiles.some(p=>p.id===activeId)){activeId='';setActiveProfile('');}}
  function clearForm(){editing='';name='';official='';products='';tlds='com, net, org';partners='';allowDomains='';allowRegistrars='';selectors='';trademarkOwner='';trademarkRegistration='';faviconHash='';faviconPHash='';pageBaseline=null;capturingIdentity=false;showForm=true;}
  function setEditorValue(field:EditorField,value:string){if(field==='name')name=value;else if(field==='official')official=value;else if(field==='products')products=value;else if(field==='tlds')tlds=value;else if(field==='partners')partners=value;else if(field==='allowDomains')allowDomains=value;else if(field==='allowRegistrars')allowRegistrars=value;else if(field==='selectors')selectors=value;else if(field==='trademarkOwner')trademarkOwner=value;else if(field==='trademarkRegistration')trademarkRegistration=value;else faviconHash=value;}
  function edit(profile:BrandProfile){editing=profile.id;name=profile.name;official=profile.officialDomains.join('\n');products=profile.productNames.join(', ');tlds=profile.tlds.join(', ');partners=profile.approvedPartnerDomains.join('\n');allowDomains=profile.allowlistedDomains.join('\n');allowRegistrars=profile.allowlistedRegistrars.join(', ');selectors=profile.dkimSelectors.join(', ');trademarkOwner=profile.trademarkOwner;trademarkRegistration=profile.trademarkRegistration;faviconHash=profile.officialFaviconHash;faviconPHash=profile.officialFaviconPHash;pageBaseline=normalizePageBaseline(profile.pageBaseline);capturingIdentity=false;showForm=true;}
  function save(){try{const profile=upsertProfile({name,officialDomains:parseList(official,true),productNames:parseList(products),tlds:parseList(tlds,true),approvedPartnerDomains:parseList(partners,true),allowlistedDomains:parseList(allowDomains,true),allowlistedRegistrars:parseList(allowRegistrars),dkimSelectors:parseList(selectors,true),trademarkOwner,trademarkRegistration,officialFaviconHash:faviconHash,officialFaviconPHash:faviconPHash,pageBaseline},editing);message=`Saved "${profile.name}" and set it active.`;showForm=false;refresh();}catch(cause){message=cause instanceof Error?cause.message:'Could not save profile.';}}
  function remove(profile:BrandProfile){if(!confirm(`Delete brand profile "${profile.name}"?`))return;try{deleteProfile(profile.id);auditResults=[];refresh();message=`Deleted "${profile.name}".`;}catch(cause){message=cause instanceof Error?cause.message:'Could not delete profile.';}}
  function activate(id:string){try{setActiveProfile(id);activeId=id;auditResults=[];}catch(cause){message=cause instanceof Error?cause.message:'Could not set the active profile.';}}
  async function captureSiteIdentity(){if(siteIdentityDisabled){message=siteIdentityDisabled.reason||'Website checks are disabled by deployment policy.';return;}const domain=parseList(official,true)[0];if(!domain){message='Enter an official domain first.';return;}capturingIdentity=true;message='Capturing official-site identity…';try{const response=await fetch(`/api/availability?q=${encodeURIComponent(domain)}`);const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||'Official-site capture failed');const captured=createPageBaseline(domain,body);if(!captured){if(typeof body.faviconHash==='string'&&body.faviconHash)faviconHash=body.faviconHash;if(typeof body.faviconPHash==='string'&&body.faviconPHash)faviconPHash=body.faviconPHash;message=`No page fingerprint baseline was available for ${domain}.${pageBaseline?' The existing baseline is unchanged.':''}`;return;}faviconHash=captured.faviconHash||'';faviconPHash=captured.faviconPHash||'';pageBaseline=captured;message=`Captured a ${captured.complete?'complete':'partial'} page baseline for ${domain}. Save the profile to retain it.`;}catch(cause){message=cause instanceof Error?cause.message:'Official-site capture failed';}finally{capturingIdentity=false;}}
  function baselineDate(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?'Unknown time':date.toLocaleString();}
  async function audit(){if(postureDisabled){message=postureDisabled.reason||'Official-domain posture checks are disabled by deployment policy.';return;}if(!active?.officialDomains.length)return;auditing=true;auditResults=[];message=`Auditing ${active.officialDomains.length} official domain${active.officialDomains.length===1?'':'s'}…`;const domains=active.officialDomains.slice(0,20);let cursor=0;const next:AuditResult[]=new Array(domains.length);const worker=async()=>{while(cursor<domains.length){const index=cursor++,domain=domains[index];try{const params=new URLSearchParams({q:domain});if(active.dkimSelectors.length)params.set('selectors',active.dkimSelectors.join(','));const response=await fetch(`/api/domain-posture?${params}`);const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||`Audit failed (${response.status})`);next[index]={domain,report:body,error:''};}catch(cause){next[index]={domain,report:null,error:cause instanceof Error?cause.message:'Audit failed'};}}};await Promise.all(Array.from({length:Math.min(3,domains.length)},worker));auditResults=next;auditing=false;message=`Audited ${next.filter(v=>v.report).length}/${domains.length} official domain${domains.length===1?'':'s'}.`;}
  async function importFile(event:Event){const input=event.currentTarget as HTMLInputElement,file=input.files?.[0];if(!file)return;try{if(file.size>MAX_PROFILE_IMPORT_BYTES)throw new Error('Profile imports are limited to 2 MB.');const result=importProfiles(JSON.parse(await file.text()));const skipped=result.skipped?`; skipped ${result.skipped} invalid or over-limit profile${result.skipped===1?'':'s'}`:'';message=`Imported ${result.added} new and ${result.updated} updated profiles${skipped}.`;refresh();}catch(cause){message=cause instanceof Error?cause.message:'Import failed';}finally{input.value='';}}
  refresh();
</script>

<svelte:head><title>Brands · WHOISleuth</title></svelte:head>
<PageHeading eyebrow="Protect" title="Brand profiles" description="Define official domains, trusted partners, allowlists, and security posture checks."><div class="top-actions toolbar"><button class="primary" onclick={clearForm}>New profile</button><button class="btn" onclick={exportProfiles} disabled={!profiles.length}>Export JSON</button><label class="btn file-btn">Import JSON<input type="file" accept="application/json,.json" onchange={importFile}></label></div></PageHeading>
{#if message}<p class="message" role="status" aria-live="polite">{message}</p>{/if}
<BrandProfileList {profiles} {activeId} focusId={page.url.searchParams.get('profile') || ''} {activate} {edit} {remove} formatDate={baselineDate} />

{#if showForm}<BrandProfileEditor editing={Boolean(editing)} values={editorValues} setValue={setEditorValue} {pageBaseline} {capturingIdentity} disabledReason={siteIdentityReason} {captureSiteIdentity} {save} close={()=>showForm=false} formatDate={baselineDate} />{/if}

{#if active}<BrandPostureAudit {active} disabledReason={postureReason} {auditing} results={auditResults} {audit} />{/if}

<style>
  .message{color:var(--accent);font-size:var(--text-sm)}
  @media(max-width:750px){
    .top-actions{margin-top:14px}
  }
</style>
