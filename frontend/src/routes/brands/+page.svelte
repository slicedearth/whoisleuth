<script lang="ts">
  import { getContext } from 'svelte';
  import { activeProfileId, deleteProfile, exportProfiles, importProfiles, loadProfiles, MAX_PROFILE_IMPORT_BYTES, parseList, setActiveProfile, upsertProfile, type BrandProfile } from '$lib/brand-profiles';
  import { createPageBaseline, normalizePageBaseline } from '$lib/analysis/page-baseline.js';
  import { CAPABILITY_CONTEXT, disabledCapability, type CapabilityGetter } from '$lib/capabilities';
  type AuditResult={domain:string;report:any|null;error:string};
  let profiles=$state<BrandProfile[]>([]);let activeId=$state('');let editing=$state('');let showForm=$state(false);let message=$state('');let auditing=$state(false);let auditResults=$state<AuditResult[]>([]);
  let name=$state(''),official=$state(''),products=$state(''),tlds=$state('com, net, org'),partners=$state(''),allowDomains=$state(''),allowRegistrars=$state(''),selectors=$state(''),trademarkOwner=$state(''),trademarkRegistration=$state(''),faviconHash=$state(''),faviconPHash=$state('');
  let pageBaseline=$state<ReturnType<typeof normalizePageBaseline>>(null),capturingIdentity=$state(false);
  const capabilityReport=getContext<CapabilityGetter>(CAPABILITY_CONTEXT);
  const siteIdentityDisabled=$derived(disabledCapability(capabilityReport?.()||null,'availability')||disabledCapability(capabilityReport?.()||null,'website_probe'));
  const postureDisabled=$derived(disabledCapability(capabilityReport?.()||null,'domain_posture'));
  const active=$derived(profiles.find(p=>p.id===activeId)||null);
  function refresh(){profiles=loadProfiles();activeId=activeProfileId();if(activeId&&!profiles.some(p=>p.id===activeId)){activeId='';setActiveProfile('');}}
  function clearForm(){editing='';name='';official='';products='';tlds='com, net, org';partners='';allowDomains='';allowRegistrars='';selectors='';trademarkOwner='';trademarkRegistration='';faviconHash='';faviconPHash='';pageBaseline=null;capturingIdentity=false;showForm=true;}
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
<section class="heading"><div><p class="eyebrow">Protect</p><h1>Brand profiles</h1><p>Define official domains, trusted partners, allowlists, and security posture checks.</p></div><div class="top-actions toolbar"><button class="primary" onclick={clearForm}>New profile</button><button class="btn" onclick={exportProfiles} disabled={!profiles.length}>Export JSON</button><label class="btn file-btn">Import JSON<input type="file" accept="application/json,.json" onchange={importFile}></label></div></section>
{#if message}<p class="message" role="status" aria-live="polite">{message}</p>{/if}
{#if profiles.length}<section class="profiles">{#each profiles as profile}<article class="profile card" class:active={profile.id===activeId}><header class="section-head"><div><p class="eyebrow">{profile.id===activeId?'Active profile':'Saved profile'}</p><h2>{profile.name}</h2></div><input type="radio" name="active-profile" aria-label={`Set ${profile.name} active`} checked={profile.id===activeId} onchange={()=>activate(profile.id)}></header><p>{profile.officialDomains.length} official domain{profile.officialDomains.length===1?'':'s'} · {profile.approvedPartnerDomains.length} trusted partner{profile.approvedPartnerDomains.length===1?'':'s'} · {profile.allowlistedDomains.length} allowlisted domain{profile.allowlistedDomains.length===1?'':'s'}</p><div class="chips">{#each profile.officialDomains.slice(0,6) as domain}<span class="chip wrap">{domain}</span>{/each}</div>{#if profile.pageBaseline}<p class="baseline-status"><strong>Page baseline</strong><span>{profile.pageBaseline.domain} · {profile.pageBaseline.complete?'Complete':'Partial'} · {baselineDate(profile.pageBaseline.observedAt)}</span></p>{:else}<p class="baseline-status"><strong>Page baseline</strong><span>Not captured</span></p>{/if}<footer class="toolbar"><button class="btn" onclick={()=>edit(profile)}>Edit</button><button class="btn danger" onclick={()=>remove(profile)}>Delete</button></footer></article>{/each}</section>{:else}<section class="empty-state card"><h2>No brand profiles saved</h2><p>Create a profile to establish official domains and trusted infrastructure.</p></section>{/if}

{#if showForm}<section class="form card"><header class="section-head"><h2>{editing?'Edit profile':'New profile'}</h2><button class="btn" onclick={()=>showForm=false}>Close</button></header>{#if siteIdentityDisabled}<p class="feature-disabled" role="note">{siteIdentityDisabled.reason||'Website checks are disabled by deployment policy.'}</p>{/if}<div class="form-grid"><label class="field">Brand name<input bind:value={name}></label><label class="field">Preferred TLDs<input bind:value={tlds}></label><label class="field wide">Official domains<textarea bind:value={official}></textarea></label><label class="field">Product names<input bind:value={products}></label><label class="field">DKIM selectors<input bind:value={selectors}></label><label class="field wide">Approved partner domains<textarea bind:value={partners}></textarea></label><label class="field wide">Allowlisted domains<textarea bind:value={allowDomains}></textarea></label><label class="field">Allowlisted registrars<input bind:value={allowRegistrars}></label><label class="field">Trademark owner<input bind:value={trademarkOwner}></label><label class="field">Trademark registration<input bind:value={trademarkRegistration}></label><fieldset class="wide identity-capture"><legend>Official-site identity</legend><p>Capture a versioned comparison baseline from the first official domain. Only bounded fingerprints and metadata are saved; page HTML is never stored in the profile.</p><div class="identity-actions"><button class="btn" type="button" onclick={captureSiteIdentity} disabled={capturingIdentity||Boolean(siteIdentityDisabled)}>{capturingIdentity?'Capturing…':pageBaseline?'Update official-site baseline':'Capture official-site baseline'}</button>{#if pageBaseline}<span>{pageBaseline.domain} · {pageBaseline.complete?'Complete':'Partial'} · {baselineDate(pageBaseline.observedAt)}</span>{:else}<span>Not captured</span>{/if}</div><label class="field">Official favicon hash<input bind:value={faviconHash} readonly placeholder="Not captured"></label>{#if pageBaseline}<dl class="baseline-summary stat-grid"><div><dt>Page title</dt><dd>{pageBaseline.pageTitle||'Not observed'}</dd></div><div><dt>Canonical host</dt><dd>{pageBaseline.canonicalHost||'Not observed'}</dd></div><div><dt>Page fingerprints</dt><dd>{2+(pageBaseline.visibleText?1:0)+(pageBaseline.formStructure?1:0)} components</dd></div><div><dt>External hosts / tracking IDs</dt><dd>{pageBaseline.resourceHosts.values.length} / {pageBaseline.trackingIdentifiers.values.length}</dd></div></dl>{/if}</fieldset></div><footer class="toolbar"><button class="primary" onclick={save}>Save profile</button><button class="btn" onclick={()=>showForm=false}>Cancel</button></footer></section>{/if}

{#if active}<section class="audit card"><header class="section-head"><div><p class="eyebrow">Prevention</p><h2>Official-domain security posture</h2><p>Audit SPF, DMARC, MTA-STS, TLS-RPT, BIMI, CAA, DNSSEC, and supplied DKIM selectors.</p></div><button class="primary" onclick={audit} disabled={auditing||!active.officialDomains.length||Boolean(postureDisabled)}>{auditing?'Auditing…':'Audit official domains'}</button></header>{#if postureDisabled}<p class="feature-disabled" role="note">{postureDisabled.reason||'Official-domain posture checks are disabled by deployment policy.'}</p>{/if}{#if auditResults.length}<div class="audit-results">{#each auditResults as item}<article><h3>{item.domain}</h3>{#if item.error}<p class="error">{item.error}</p>{:else}<p class="counts">{item.report.summary.danger||0} action · {item.report.summary.warning||0} review · {item.report.summary.pass||0} pass</p><div class="checks">{#each item.report.checks as check}<details class={check.status}><summary><span>{check.label}</span><strong>{check.status}</strong></summary><p>{check.summary}</p>{#if check.detail}<p>{check.detail}</p>{/if}{#if check.remediation}<p><b>Next:</b> {check.remediation}</p>{/if}{#if check.records?.length}<pre>{check.records.join('\n')}</pre>{/if}</details>{/each}</div>{/if}</article>{/each}</div>{/if}</section>{/if}

<style>
  .message{color:var(--accent);font-size:var(--text-sm)}
  .profiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px}
  .profile{min-width:0;display:flex;flex-direction:column;padding:20px}
  .profile.active{border-color:rgba(126,224,168,.55)}
  .profile h2,.form h2,.audit h2{margin:0}
  .profile>p,.audit .section-head p:not(.eyebrow),.counts{color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  .chips{display:flex;flex-wrap:wrap;gap:5px;margin:12px 0}
  .baseline-status{display:grid;gap:3px;margin:0 0 14px;font-size:var(--text-xs)}
  .baseline-status strong{color:var(--text)}
  .baseline-status span{overflow-wrap:anywhere;color:var(--muted)}
  .profile footer{margin-top:auto}
  .form,.audit{margin-top:16px;padding:var(--card-pad)}
  .form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:18px 0}
  .form-grid textarea{min-height:82px;background:rgba(15,17,21,.78)}
  .wide{grid-column:span 2}
  .identity-capture{min-width:0;margin:4px 0 0;padding:14px;border:1px solid var(--border);border-radius:var(--radius-md)}
  .identity-capture legend{padding:0 5px;font:700 var(--text-xs) var(--mono)}
  .identity-capture>p{margin:0 0 12px;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .identity-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px}
  .identity-actions span{min-width:0;color:var(--muted);font-size:var(--text-xs);overflow-wrap:anywhere}
  .baseline-summary{margin:12px 0 0}
  .baseline-summary dt{color:var(--muted);font:600 var(--text-2xs) var(--mono);letter-spacing:.06em;text-transform:uppercase}
  .baseline-summary dd{margin:5px 0 0;font-size:var(--text-xs);overflow-wrap:anywhere}
  .audit .section-head>button{align-self:start}
  .audit-results{display:grid;gap:12px;margin-top:18px}
  .audit-results>article{padding:16px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .audit-results h3{margin:0 0 4px;font:700 var(--text-md) var(--mono);overflow-wrap:anywhere}
  .checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:10px}
  .checks details{min-width:0;padding:10px 12px;border:1px solid var(--border);border-left:3px solid var(--border);border-radius:var(--radius-sm)}
  .checks details.danger{border-left-color:var(--danger)}
  .checks details.warning{border-left-color:var(--amber)}
  .checks details.pass{border-left-color:var(--accent2)}
  .checks summary{display:flex;justify-content:space-between;gap:10px;cursor:pointer;font-size:var(--text-xs)}
  .checks summary strong{text-transform:capitalize}
  .checks details.danger summary strong{color:var(--danger)}
  .checks details.warning summary strong{color:var(--amber)}
  .checks details.pass summary strong{color:var(--accent2)}
  .checks p{color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .checks pre{overflow:auto;font-size:var(--text-2xs)}
  @media(max-width:750px){
    .heading .toolbar{margin-top:14px}
    .profiles,.form-grid,.checks{grid-template-columns:1fr}
    .wide{grid-column:auto}
    .identity-actions{align-items:stretch;flex-direction:column}
    .identity-actions button{width:100%}
    .audit .section-head{display:block}
    .audit .section-head button{margin-top:12px}
  }
</style>
