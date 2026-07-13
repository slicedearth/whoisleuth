<script lang="ts">
  import { goto } from '$app/navigation';
  import { getContext, onMount } from 'svelte';
  import { page } from '$app/state';
  import { activeProfile, profileSignals as matchProfileSignals, type BrandProfile } from '$lib/brand-profiles';
  import { addCaseNote, dispositionLabel as caseDispositionLabel, getCaseByDomain, openCase, statusLabel as caseStatusLabel, type CaseRecord } from '$lib/cases';
  import { saveCandidateHandoff } from '$lib/candidate-handoff';
  import { abuseAction, outreachAction, type AbuseEvidence, type Contact } from '$lib/drafts';
  import { buildLookupEvidence, evidenceFilename } from '$lib/analysis/evidence-export.js';
  import { analyzeDomainIdn } from '$lib/analysis/idn-confusables.js';
  import { compactHttpObservation } from '$lib/analysis/http-summary.js';
  import { compareRegistrySources } from '$lib/analysis/registry-comparison.js';
  import { entityDisplayName, parseDomainInput } from '$lib/analysis/utils.js';
  import { CAPABILITY_CONTEXT, disabledCapabilities, disabledCapability, type CapabilityGetter } from '$lib/capabilities';
  import {
    explainOpportunityScore,
    explainRiskScore,
    fmtAge,
    fmtExpiresIn,
    formatActivityCell,
    formatPrivacyCell,
    riskTone,
    scoreTone
  } from '$lib/analysis/scoring.js';

  type JsonRecord = Record<string, any>;
  type SourceStatus = { status?: string; errorCode?: string|null; endpoint?: string|null; transportSecurity?: string|null; httpStatus?: number|null; fetchedAt?: string|null; queriedAt?: string|null; authoritativeHop?: string|null; failedHop?: string|null; conflictingHop?: string|null; resultState?: string|null; attempts?:Array<{outcome?:string}> };
  type ScoreExplanation = { modelVersion?:number; score:number; factors:Array<{label:string;delta:number}> }|null;
  type ComparisonField = { label:string; status:string; rdapDisplay:string; whoisDisplay:string };

  let query=$state('');
  let loading=$state(false);
  let error=$state('');
  let result=$state<JsonRecord|null>(null);
  let profile=$state<BrandProfile|null>(null);
  let draftStatus=$state('');
  let caseRecord=$state<CaseRecord|null>(null);let caseNote=$state('');let caseStatus=$state('');
  const capabilityReport=getContext<CapabilityGetter>(CAPABILITY_CONTEXT);
  const lookupDisabled=$derived(disabledCapability(capabilityReport?.()||null,'lookup'));
  const lookupLimitations=$derived(disabledCapabilities(capabilityReport?.()||null,['rdap','whois','availability','dns_intelligence','website_probe']));

  const rec=(value:any):JsonRecord=>value&&typeof value==='object'?value:{};
  const show=(value:any):string=>value==null||value===''?'—':Array.isArray(value)?(value.join(', ')||'—'):typeof value==='object'?show(value.name||value.org||value.handle||value.domain):String(value);
  const parsedInput=$derived(parseDomainInput(query));
  const entries=$derived(parsedInput.entries);
  const availability=$derived(rec(result?.availability));
  const lookupEvidenceDepth=$derived(availability.deepScanComplete===false?'fast':'deep');
  const rdap=$derived(rec(result?.rdap));
  const whois=$derived(rec(result?.whois));
  const rdapParsed=$derived(rec(rdap.parsed));
  const whoisParsed=$derived(rec(whois.parsed));
  const diagnostics=$derived(rec(result?.diagnostics));
  const dnsEvidence=$derived(rec(availability.dns));
  const dnsRecords=$derived(rec(dnsEvidence.records));
  const httpEvidence=$derived(rec(availability.http));
  const httpResponse=$derived(rec(httpEvidence.response));
  const httpSecurityHeaders=$derived(rec(httpResponse.securityHeaders));
  const pageIdentity=$derived(rec(availability.pageIdentity));
  const pageCanonical=$derived(rec(pageIdentity.canonical));
  const pageMetaRefresh=$derived(rec(pageIdentity.metaRefresh));
  const pageOpenGraph=$derived(rec(pageIdentity.openGraph));
  const pageOpenGraphUrl=$derived(rec(pageOpenGraph.url));
  const pageForms=$derived(rec(pageIdentity.forms));
  const compactHttpSummary=$derived(compactHttpObservation(availability.http)||{});
  const rdapRoleOrder=['registrar','registrant','administrative','technical','billing','abuse','noc','reseller','sponsor','proxy','notifications'];
  const populatedRdapRoles=$derived(rdapRoleOrder.filter((role)=>Array.isArray(rdapParsed.entitiesByRole?.[role])&&rdapParsed.entitiesByRole[role].length));
  const whoisRoleOrder=['registrant','administrative','technical','billing','abuse'];
  const populatedWhoisRoles=$derived(whoisRoleOrder.filter((role)=>Array.isArray(whoisParsed.contactsByRole?.[role])&&whoisParsed.contactsByRole[role].length));
  const comparison=$derived(result?.type==='domain'?compareRegistrySources(rdapParsed,whoisParsed,{rdapStatus:diagnostics.rdap?.status,whoisStatus:diagnostics.whois?.status}):{fields:[],counts:{equivalent:0,conflict:0,rdap_only:0,whois_only:0,rdap_redacted:0,whois_redacted:0,rdap_unavailable:0,whois_unavailable:0,rdap_incomplete:0,whois_incomplete:0}});
  const idnAnalysis=$derived(result?.type==='domain'?analyzeDomainIdn(String(result?.registrableDomain||availability.domain||''),profile?.officialDomains||[]):null);
  const profileSignals=$derived.by(()=>{
    return matchProfileSignals(String(availability.domain||result?.registrableDomain||''),availability,profile);
  });
  const scoredAvailability=$derived({...availability,...profileSignals});
  const opportunity=$derived(explainOpportunityScore(scoredAvailability) as ScoreExplanation);
  const risk=$derived(explainRiskScore(scoredAvailability) as ScoreExplanation);
  const outreach=$derived(outreachAction(String(availability.domain||result?.registrableDomain||''),(availability.registrant||null) as Contact|null));
  const abuse=$derived(profileSignals.trusted?null:abuseAction(String(availability.domain||result?.registrableDomain||''),availability.abuse?.email?{abuseEmail:String(availability.abuse.email),hasMx:availability.hasMx??null,activityStatus:availability.activityStatus||null,privacyProtected:availability.privacyProtected??null,domainAgeDays:availability.domainAgeDays??null} as AbuseEvidence:null));
  const sourceOnlyCount=$derived(comparison.counts.rdap_only+comparison.counts.whois_only);
  const redactedComparisonCount=$derived(comparison.counts.rdap_redacted+comparison.counts.whois_redacted);
  const limitedComparisonCount=$derived(comparison.counts.rdap_unavailable+comparison.counts.whois_unavailable+comparison.counts.rdap_incomplete+comparison.counts.whois_incomplete);
  const caseDomain=$derived(String(availability.domain||result?.registrableDomain||'').trim().toLowerCase());
  const caseEvidence=$derived({
    availability:String(availability.state||''),
    confidence:availability.confidence?String(availability.confidence):null,
    riskModelVersion:risk?.modelVersion??null,
    riskScore:risk?risk.score:null,
    opportunityScore:opportunity?opportunity.score:null,
    riskFactors:risk?risk.factors.map((f)=>({label:f.label,points:f.delta})):[],
    opportunityFactors:opportunity?opportunity.factors.map((f)=>({label:f.label,points:f.delta})):[],
    registrar:entityDisplayName(availability.registrar)||entityDisplayName(rdapParsed.registrar)||entityDisplayName(whoisParsed.registrar),
    createdDate:created()||null,
    expiryDate:expires()||null,
    nameservers:Array.isArray(availability.nameservers)?availability.nameservers:[],
    hasMx:availability.hasMx??null,hasSpf:availability.hasSpf??null,hasDmarc:availability.hasDmarc??null,
    activityStatus:availability.activityStatus?String(availability.activityStatus):null,
    websiteProbeDetail:availability.websiteProbeDetail?String(availability.websiteProbeDetail):null,
    pageTitle:availability.pageTitle??null,
    faviconMatch:profileSignals.faviconMatch??null,faviconNearMatch:profileSignals.faviconNearMatch??null,
    reusesOfficialAssets:profileSignals.reusesOfficialAssets??null,hasPasswordField:availability.hasPasswordField??null,
    phishingLanguageMatch:availability.phishingLanguageMatch??null,
    ...compactHttpSummary,
    mutationTypes:[]
  });

  function refreshCase(){caseRecord=caseDomain?getCaseByDomain(caseDomain):null;}
  function prunedNote(pruned:number){return pruned?` (pruned ${pruned} old evidence snapshot${pruned===1?'':'s'} to stay within storage)`:'';}
  function openLookupCase(){if(!caseDomain)return;try{const{record,created,pruned}=openCase({domain:caseDomain,source:'lookup',evidence:{...caseEvidence,scanDepth:lookupEvidenceDepth}});caseRecord=record;caseStatus=`${created?`Opened a new case for ${record.domain}.`:`Opened the existing case for ${record.domain}.`}${prunedNote(pruned)}`;}catch(cause){caseStatus=cause instanceof Error?cause.message:'Could not open the case.';}}
  function addLookupNote(){if(!caseRecord)return;const body=caseNote.trim();if(!body){caseStatus='A note cannot be empty.';return;}try{const{record,pruned}=addCaseNote(caseRecord.id,body);caseRecord=record;caseNote='';caseStatus=`Added a note to the case.${prunedNote(pruned)}`;}catch(cause){caseStatus=cause instanceof Error?cause.message:'Could not add the note.';}}
  onMount(()=>{const q=page.url.searchParams.get('q');if(q)query=q;});

  function eventDate(action:string){return rdapParsed.events?.find((item:JsonRecord)=>item.action===action)?.date||null;}
  function created(){return availability.createdDate||rdapParsed.lifecycle?.createdDate||eventDate('registration')||whoisParsed.createdDate;}
  function expires(){return availability.expiryDate||rdapParsed.lifecycle?.expiryDate||eventDate('expiration')||whoisParsed.expiryDate;}
  function updated(){return rdapParsed.lifecycle?.updatedDate||eventDate('last changed')||whoisParsed.updatedDate;}
  function formatDate(value:any){if(!value)return'—';const parsed=new Date(value);return Number.isNaN(parsed.getTime())?String(value):parsed.toLocaleString();}
  function dateTimeAttribute(value:any){if(!value)return undefined;const parsed=new Date(value);return Number.isNaN(parsed.getTime())?undefined:parsed.toISOString();}
  function statusLabel(value:string){return value.replaceAll('_',' ');}
  function assessment(status:string){return({equivalent:'Equivalent',conflict:'Conflict',rdap_only:'RDAP only',whois_only:'WHOIS only',rdap_redacted:'RDAP redacted',whois_redacted:'WHOIS redacted',rdap_unavailable:'RDAP unavailable',whois_unavailable:'WHOIS unavailable',rdap_incomplete:'RDAP incomplete',whois_incomplete:'WHOIS incomplete'} as Record<string,string>)[status]||status;}
  function diagnosticLabel(source:SourceStatus){return source.status?source.status.replaceAll('_',' '):'unknown';}
  function attemptSummary(source:SourceStatus){return Array.isArray(source.attempts)&&source.attempts.length?`attempts: ${source.attempts.map((item)=>String(item.outcome||'unknown').replaceAll('_',' ')).join(' → ')}`:null;}
  function diagnosticDetail(source:SourceStatus){return[source.endpoint,source.transportSecurity==='http'?'transport: cleartext HTTP':null,source.httpStatus?`HTTP ${source.httpStatus}`:null,attemptSummary(source),source.resultState?`result: ${source.resultState}`:null,source.errorCode,source.authoritativeHop?`authoritative: ${show(source.authoritativeHop)}`:null,source.failedHop?`failed: ${show(source.failedHop)}`:null,source.fetchedAt?`fetched ${formatDate(source.fetchedAt)}`:null,source.queriedAt?`queried ${formatDate(source.queriedAt)}`:null].filter(Boolean).join(' · ')||'No additional source detail';}
  function contactIdentity(contact:JsonRecord){return show(contact.name||contact.org||contact.handle);}
  function contactDetails(contact:JsonRecord){return[
    Array.isArray(contact.organizations)&&contact.organizations.length?`Organizations: ${contact.organizations.join(', ')}`:null,
    Array.isArray(contact.emails)&&contact.emails.length?`Email: ${contact.emails.join(', ')}`:null,
    Array.isArray(contact.phones)&&contact.phones.length?`Phone: ${contact.phones.join(', ')}`:null,
    Array.isArray(contact.addresses)&&contact.addresses.length?`Address: ${contact.addresses.join(' · ')}`:null,
    Array.isArray(contact.publicIds)&&contact.publicIds.length?`IDs: ${contact.publicIds.map((item:JsonRecord)=>`${item.type}: ${item.identifier}`).join(', ')}`:null,
    Array.isArray(contact.links)&&contact.links.length?`Links: ${contact.links.map((item:JsonRecord)=>item.href).join(', ')}`:null
  ].filter(Boolean) as string[];}
  function rdapLinkText(){return Array.isArray(rdapParsed.links)?rdapParsed.links.map((item:JsonRecord)=>[item.rel,item.href].filter(Boolean).join(': ')).join(' · '):'';}
  function rdapGlueText(){return Array.isArray(rdapParsed.nameserverDetails)?rdapParsed.nameserverDetails.filter((item:JsonRecord)=>Array.isArray(item.addresses)&&item.addresses.length).map((item:JsonRecord)=>`${item.name}: ${item.addresses.join(', ')}`).join(' · '):'';}
  function rdapDsText(){return Array.isArray(rdapParsed.dsData)?rdapParsed.dsData.map((item:JsonRecord)=>[item.keyTag,item.algorithm,item.digestType,item.digest].filter((value)=>value!==null&&value!==undefined&&value!=='').join(' ')).join(' · '):'';}
  function rdapTextBlocks(value:any){return Array.isArray(value)?value.map((item:JsonRecord)=>`${item.title}: ${(item.descriptions||[]).join(' ')}`).join(' · '):'';}
  function rdapRedactionText(){return Array.isArray(rdapParsed.redactions)?rdapParsed.redactions.map((item:JsonRecord)=>[
    item.name,item.method,item.reason,item.prePath||item.postPath||item.replacementPath
  ].filter(Boolean).join(' · ')).join(' | '):'';}
  function rdapVariantText(){return Array.isArray(rdapParsed.variants)?rdapParsed.variants.map((group:JsonRecord)=>{
    const names=Array.isArray(group.variantNames)?group.variantNames.map((name:JsonRecord)=>name.unicodeName||name.ldhName).filter(Boolean):[];
    return [[...(group.relation||[]),group.idnTable].filter(Boolean).join(', '),names.join(', ')].filter(Boolean).join(': ');
  }).filter(Boolean).join(' · '):'';}
  function dnsValues(name:string){const records=Array.isArray(dnsRecords[name])?dnsRecords[name]:[];return records.map((record:any)=>typeof record==='string'?record:name==='mx'?`${record.priority} ${record.exchange||'.'}`:name==='caa'?`${record.critical} ${record.tag} ${record.value}`:String(record)).join(' · ');}
  function dnsDisplay(name:string){return dnsEvidence.status==='skipped'?'Not evaluated':dnsValues(name)||'Not observed';}
  function dnsQueryFailures(){return Object.entries(rec(dnsEvidence.diagnostics)).filter(([,item])=>rec(item).status==='error').map(([name,item])=>`${name.toUpperCase()}: ${rec(item).error||'query failed'}`).join(' · ');}
  function formatBytes(value:any){const bytes=Number(value);if(!Number.isFinite(bytes)||bytes<0)return'—';return bytes<1024?`${bytes} B`:`${(bytes/1024).toFixed(bytes<10240?1:0)} KiB`;}
  function httpSecurityRows(){return[
    ['HSTS',httpSecurityHeaders.strictTransportSecurity],
    ['Content Security Policy',httpSecurityHeaders.contentSecurityPolicy],
    ['Frame protection',httpSecurityHeaders.xFrameOptions],
    ['Content-type protection',httpSecurityHeaders.xContentTypeOptions],
    ['Referrer policy',httpSecurityHeaders.referrerPolicy]
  ];}
  function signals(){const values:Array<{label:string;tone:string;detail?:string}>=[];if(profileSignals.trusted)values.push({label:`Trusted ${profileSignals.trusted}`,tone:'good'});if(profileSignals.faviconMatch)values.push({label:'Favicon match',tone:'danger'});else if(profileSignals.faviconNearMatch)values.push({label:'Favicon near-match',tone:'warn'});if(profileSignals.reusesOfficialAssets)values.push({label:'Reuses official assets',tone:'danger'});if(availability.hasPasswordField)values.push({label:'Password field',tone:'warn'});if(availability.phishingLanguageMatch)values.push({label:'Phishing language',tone:'danger',detail:availability.phishingLanguageMatch});if(idnAnalysis?.mixedScript)values.push({label:'Mixed-script IDN',tone:'warn',detail:'The Unicode label combines writing scripts.'});if(idnAnalysis?.referenceMatches?.length)values.push({label:'Official-domain skeleton match',tone:'warn',detail:'A bounded visual skeleton matches an official domain in the active brand profile.'});const age=fmtAge(availability.domainAgeDays);if(age)values.push({label:age,tone:'neutral'});const expiry=fmtExpiresIn(availability.expiresInDays);if(expiry)values.push({label:expiry,tone:availability.expiresInDays<=60?'warn':'neutral'});if(availability.privacyProtected!==null&&availability.privacyProtected!==undefined)values.push({label:formatPrivacyCell(availability.privacyProtected),tone:availability.privacyProtected?'warn':'good'});if(availability.activityStatus)values.push({label:formatActivityCell(availability.activityStatus,availability.hasMx,availability.hasSpf,availability.hasDmarc),tone:availability.activityStatus==='active'?'good':availability.activityStatus==='parked'?'warn':'neutral',detail:availability.websiteProbeDetail});return values;}
  function downloadEvidence(){if(!result)return;const body=JSON.stringify(buildLookupEvidence(result,{idnAnalysis}),null,2);const url=URL.createObjectURL(new Blob([body],{type:'application/json'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=evidenceFilename(result);anchor.click();URL.revokeObjectURL(url);}
  async function copyDraft(text:string,label:string){try{await navigator.clipboard.writeText(text);draftStatus=`Copied ${label} to the clipboard.`;}catch{draftStatus='Clipboard access was unavailable. Use the email draft link instead.';}}
  async function submit(event:SubmitEvent){event.preventDefault();if(lookupDisabled){error=lookupDisabled.reason||'Lookup is disabled by deployment policy.';return;}if(!entries.length||loading)return;if(entries.length>1){saveCandidateHandoff('manual',entries.slice(0,2000).map(domain=>({domain:domain.toLowerCase(),source:'manual input',mutationTypes:[]})));await goto('/bulk?source=lookup');return;}loading=true;error='';result=null;caseRecord=null;caseNote='';caseStatus='';profile=activeProfile();try{const response=await fetch(`/api/lookup?q=${encodeURIComponent(entries[0])}`);const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||`Lookup failed (${response.status})`);result=body;refreshCase();requestAnimationFrame(()=>document.querySelector('#result')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'}));}catch(cause){error=cause instanceof Error?cause.message:'Lookup failed';}finally{loading=false;}}
</script>

<svelte:head><title>Lookup · WHOISleuth</title></svelte:head>
<section class="heading"><div><p class="eyebrow">Investigate</p><h1>Lookup</h1><p>Look up a domain, IP address, or ASN using RDAP and WHOIS, with DNS and bounded website checks for domains.</p></div></section>
<form class="search card" onsubmit={submit}>
  {#if lookupDisabled}<p class="feature-disabled" role="note">{lookupDisabled.reason||'Lookup is disabled by deployment policy.'}</p>{/if}
  {#if !lookupDisabled&&lookupLimitations.length}<p class="feature-disabled" role="note">Some lookup sources are disabled by deployment policy: {lookupLimitations.map((item)=>item.id.replaceAll('_',' ')).join(', ')}. Results will identify unevaluated evidence.</p>{/if}
  <label for="query">Domain, IP address, ASN, or domain list</label>
  <div class="input-row"><div class="query-field"><textarea id="query" bind:value={query} placeholder="example.com" autocomplete="off" spellcheck="false" rows="2"></textarea>{#if query}<button type="button" class="clear" aria-label="Clear query" onclick={()=>query=''}>×</button>{/if}</div><button class="primary" disabled={loading||!entries.length||Boolean(lookupDisabled)}>{loading?'Looking up…':entries.length>1?`Open ${Math.min(entries.length,2000)} in Bulk`:'Run lookup'}</button></div>
  <p class="input-help">{entries.length>1?`${entries.length} unique entries detected. Multiple entries continue in Bulk${parsedInput.duplicates?`; ${parsedInput.duplicates} duplicate${parsedInput.duplicates===1?'':'s'} removed`:''}.`:'Separate multiple domains with commas, semicolons, tabs, or new lines.'}</p>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</form>

{#if result}
  <section id="result">
    <div class="result-head"><div><p class="eyebrow">Result</p><h2>{show(result.registrableDomain||result.query)}</h2>{#if result.isSubdomain}<p>Showing registry data for {result.registrableDomain}; submitted hostname: {result.inputHostname}.</p>{/if}</div><div class="result-actions"><span>{show(availability.state)}</span><button onclick={downloadEvidence}>Export evidence JSON</button></div></div>

    <div class="diagnostics" aria-label="Source diagnostics">
      {#each ['rdap','whois','availability'] as source}{@const item=rec(diagnostics[source]) as SourceStatus}<article class="card"><small>{source}</small><strong class:error-state={item.status==='error'} class:limited-state={item.status==='disabled'}>{diagnosticLabel(item)}</strong><p>{diagnosticDetail(item)}</p></article>{/each}
    </div>

    {#if availability.applicable!==false}
      <section class="availability card">
        <header><div><p class="eyebrow">Assessment</p><h3>{show(availability.detail||availability.state)}</h3><p>{show(availability.confidence)} confidence</p></div><div class="scores">{#if risk}<div class="score {riskTone(risk.score)}" title={risk.factors.map(f=>`${f.label} ${f.delta>=0?'+':''}${Math.round(f.delta)}`).join('\n')}><span>Risk</span><strong>{risk.score}</strong><i><b style:width={`${risk.score}%`}></b></i></div>{/if}{#if opportunity}<div class="score {scoreTone(opportunity.score)}" title={opportunity.factors.map(f=>`${f.label} ${f.delta>=0?'+':''}${Math.round(f.delta)}`).join('\n')}><span>Opportunity</span><strong>{opportunity.score}</strong><i><b style:width={`${opportunity.score}%`}></b></i></div>{/if}</div></header>
        {#if signals().length}<div class="signals">{#each signals() as signal}<span class={signal.tone} title={signal.detail||''}>{signal.label}</span>{/each}</div>{/if}
        {#if profileSignals.trusted}<p class="trust-note">This domain is {profileSignals.trusted} in the active brand profile. Scores remain visible as evidence context but are not treated as an untrusted finding.</p>{/if}
        <div class="score-details">{#if risk}<details><summary>Why the risk score is {risk.score}</summary><ul>{#each risk.factors as factor}<li><span>{factor.label}</span><strong>{factor.delta>=0?'+':''}{Math.round(factor.delta)}</strong></li>{/each}</ul></details>{/if}{#if opportunity}<details><summary>Why the opportunity score is {opportunity.score}</summary><ul>{#each opportunity.factors as factor}<li><span>{factor.label}</span><strong>{factor.delta>=0?'+':''}{Math.round(factor.delta)}</strong></li>{/each}</ul></details>{/if}</div>
      </section>
    {/if}

    {#if idnAnalysis && (idnAnalysis.hasIdn || idnAnalysis.referenceMatches.length)}
      <section class="idn-card card" aria-labelledby="idn-title">
        <header><div><p class="eyebrow">Domain identity</p><h3 id="idn-title">IDN and confusable review</h3></div><span>{idnAnalysis.mappingVersion}</span></header>
        <div class="idn-forms"><article><small>Unicode display</small><strong>{idnAnalysis.unicodeDomain}</strong></article><article><small>DNS-safe ASCII</small><strong>{idnAnalysis.asciiDomain}</strong></article><article><small>Writing scripts</small><strong>{idnAnalysis.scripts.join(', ')||'None detected'}</strong></article></div>
        {#if idnAnalysis.findings.length}<ul>{#each idnAnalysis.findings as finding}<li class:warning={finding.tone==='warning'}><strong>{finding.label}</strong><span>{finding.detail}</span></li>{/each}</ul>{/if}
        <p>Review Unicode and ASCII forms together. These are bounded similarity indicators and do not establish maliciousness.</p>
      </section>
    {/if}

    {#if dnsEvidence.source==='dns'}
      <section class="dns-card card" aria-labelledby="dns-title">
        <header><div><p class="eyebrow">Deep-scan evidence</p><h3 id="dns-title">DNS intelligence</h3></div><span class:partial={!dnsEvidence.complete}>{dnsEvidence.status}</span></header>
        <div class="dns-grid">
          <article><small>DNSSEC</small><strong>{show(availability.dnssec)}</strong></article><article><small>A</small><strong>{dnsDisplay('a')}</strong></article><article><small>AAAA</small><strong>{dnsDisplay('aaaa')}</strong></article><article><small>CNAME</small><strong>{dnsDisplay('cname')}</strong></article><article><small>Nameservers</small><strong>{dnsDisplay('ns')}</strong></article><article><small>MX</small><strong>{dnsDisplay('mx')}</strong></article><article><small>SPF</small><strong>{dnsDisplay('spf')}</strong></article><article><small>DMARC</small><strong>{dnsDisplay('dmarc')}</strong></article><article><small>CAA</small><strong>{dnsDisplay('caa')}</strong></article>
        </div>
        {#if dnsQueryFailures()}<p class="dns-warning">Partial observation: {dnsQueryFailures()}. A resolver failure is not evidence that a record is absent.</p>{/if}
        <p>Point-in-time resolver evidence. Shared DNS infrastructure can connect investigations but does not prove common ownership or maliciousness.{dnsEvidence.truncated?' Some record inventories were capped.':''}</p>
      </section>
    {/if}

    {#if httpEvidence.source==='http'}
      <section class="http-card card" aria-labelledby="http-title">
        <header><div><p class="eyebrow">Deep-scan evidence</p><h3 id="http-title">HTTP intelligence</h3></div><span class:partial={!httpEvidence.complete}>{statusLabel(show(httpEvidence.status))}</span></header>
        <div class="http-grid">
          <article><small>Final URL</small><strong>{show(httpEvidence.finalUrl||httpEvidence.requestUrl)}</strong></article>
          <article><small>Response</small><strong>{httpResponse.status?`HTTP ${httpResponse.status}`:'Not observed'}</strong></article>
          <article><small>Transport</small><strong>{httpEvidence.transportSecurity==='https'?'HTTPS':httpEvidence.transportSecurity==='http'?'Cleartext HTTP':'Not observed'}</strong></article>
          <article><small>Redirects</small><strong>{show(httpEvidence.redirectCount)}</strong></article>
          <article><small>Content type</small><strong>{show(httpResponse.contentType)}</strong></article>
          <article><small>Body captured</small><strong>{formatBytes(httpResponse.capturedBodyBytes)}{httpResponse.bodyTruncated?' · capped':''}</strong></article>
        </div>
        {#if httpEvidence.crossOriginRedirect||httpEvidence.httpsDowngrade}<div class="http-findings">{#if httpEvidence.crossOriginRedirect}<span>Cross-origin redirect</span>{/if}{#if httpEvidence.httpsDowngrade}<span class="danger">HTTPS downgrade</span>{/if}</div>{/if}
        {#if Array.isArray(httpEvidence.redirects)&&httpEvidence.redirects.length}<details class="http-detail"><summary>Redirect chain · {httpEvidence.redirects.length} hop{httpEvidence.redirects.length===1?'':'s'}</summary><ol>{#each httpEvidence.redirects as redirect}<li><span>HTTP {show(redirect.status)}</span><strong>{show(redirect.from)}</strong><b>→ {show(redirect.to)}</b>{#if redirect.queryOmitted}<small>Query omitted from retained provenance</small>{/if}</li>{/each}</ol></details>{/if}
        {#if httpEvidence.attempts?.some((attempt:JsonRecord)=>attempt.error)}<details class="http-detail"><summary>Connection attempts</summary><ul>{#each httpEvidence.attempts as attempt}<li><strong>{show(attempt.url)}</strong><span>{attempt.error||`HTTP ${show(attempt.httpStatus)}`}</span></li>{/each}</ul></details>{/if}
        {#if httpResponse.status}<details class="http-detail"><summary>Selected response metadata</summary><dl>{#each httpSecurityRows() as row}<dt>{row[0]}</dt><dd>{show(row[1])}</dd>{/each}<dt>Server</dt><dd>{show(httpResponse.server)}</dd><dt>Content language</dt><dd>{show(httpResponse.contentLanguage)}</dd><dt>Declared length</dt><dd>{httpResponse.declaredContentLength===null||httpResponse.declaredContentLength===undefined?'—':formatBytes(httpResponse.declaredContentLength)}</dd>{#if httpResponse.bodyHash}<dt>Body SHA-256</dt><dd class="http-hash">{show(httpResponse.bodyHash.value)}</dd><dt>Hash scope</dt><dd>{httpResponse.bodyHash.scope==='captured-prefix'?`Captured prefix (${formatBytes(httpResponse.bodyHash.bytes)})`:`Complete captured body (${formatBytes(httpResponse.bodyHash.bytes)})`}</dd>{/if}</dl></details>{/if}
        {#if httpEvidence.limitations?.length}<p class="http-limitations">{httpEvidence.limitations.join(' ')}</p>{/if}
        <p>Point-in-time response metadata from the homepage request already used for deep analysis. Redirects and headers provide context; missing security headers do not establish maliciousness.</p>
      </section>
    {/if}

    {#if pageIdentity.source==='html'}
      <section class="page-card card" aria-labelledby="page-identity-title">
        <header><div><p class="eyebrow">Deep-scan evidence</p><h3 id="page-identity-title">Page identity</h3></div><span class:partial={!pageIdentity.complete}>{statusLabel(show(pageIdentity.status))}</span></header>
        <div class="page-grid">
          <article><small>Document language</small><strong>{show(pageIdentity.documentLanguage)}</strong></article>
          <article><small>Canonical URL</small><strong>{show(pageCanonical.url)}</strong></article>
          <article><small>Meta refresh target</small><strong>{show(pageMetaRefresh.url)}</strong></article>
          <article><small>Open Graph title</small><strong>{show(pageOpenGraph.title)}</strong></article>
          <article><small>Open Graph site</small><strong>{show(pageOpenGraph.siteName)}</strong></article>
          <article><small>Open Graph URL</small><strong>{show(pageOpenGraphUrl.url)}</strong></article>
          <article><small>Generator</small><strong>{show(pageIdentity.generator)}</strong></article>
          <article><small>Forms observed</small><strong>{show(pageForms.count)}{pageForms.truncated?' · capped':''}</strong></article>
          <article><small>POST forms</small><strong>{show(pageForms.postCount)}</strong></article>
          <article><small>Insecure actions</small><strong class:danger-text={Number(pageForms.insecureActionCount)>0}>{show(pageForms.insecureActionCount)}</strong></article>
        </div>
        {#if Array.isArray(pageForms.externalActionOrigins)&&pageForms.externalActionOrigins.length}
          <details class="page-detail"><summary>External form destinations · {pageForms.externalActionOrigins.length}</summary><ul>{#each pageForms.externalActionOrigins as origin}<li>{origin}</li>{/each}</ul></details>
        {/if}
        {#if pageIdentity.limitations?.length}<p class="page-limitations">{pageIdentity.limitations.join(' ')}</p>{/if}
        <p>Bounded metadata from the static HTML already captured for this lookup. JavaScript-rendered content is not evaluated, URL queries are not retained, and these fields provide context rather than a maliciousness verdict.</p>
      </section>
    {/if}

    {#if caseDomain}
      <section class="case-card card">
        <div class="case-intro"><div><p class="eyebrow">Investigation</p><h3>Analyst case</h3></div>{#if caseRecord}<div class="case-badges"><span class={`badge status-${caseRecord.status}`}>{caseStatusLabel(caseRecord.status)}</span><span class={`badge disposition-${caseRecord.disposition}`}>{caseDispositionLabel(caseRecord.disposition)}</span></div>{/if}</div>
        {#if caseRecord}
          <div class="case-body">
            <form class="note-edit" onsubmit={(event)=>{event.preventDefault();addLookupNote();}}>
              <label for="case-note">Add note</label>
              <textarea id="case-note" bind:value={caseNote} rows="2" placeholder="Observed behaviour, evidence, decisions…"></textarea>
              <div class="case-actions"><button type="submit" disabled={!caseNote.trim()}>Add note</button><a href={`/monitor?case=${encodeURIComponent(caseRecord.id)}`}>Open in Monitor →</a></div>
            </form>
            <p class="case-hint">{caseRecord.notes.length} note{caseRecord.notes.length===1?'':'s'} · manage status, disposition, and tags in Monitor. Cases are stored only in this browser.</p>
          </div>
        {:else}
          <div class="case-body"><p class="case-hint">No case for {caseDomain} yet.</p><button class="primary" onclick={openLookupCase}>Create case</button></div>
        {/if}
        {#if caseStatus}<p class="case-status" role="status" aria-live="polite">{caseStatus}</p>{/if}
      </section>
    {/if}

    {#if outreach||abuse}<section class="response card"><div><p class="eyebrow">Respond</p><h3>Human-reviewed drafts</h3><p>Nothing is sent automatically. Review and edit every message before sending it.</p></div><div class="response-actions">{#if outreach}<article><strong>Acquisition outreach</strong><span>{outreach.email}</span><div><a href={outreach.mailto}>Open email draft</a><button onclick={()=>copyDraft(outreach.body,'outreach draft')}>Copy text</button></div></article>{/if}{#if abuse}<article><strong>Abuse report</strong><span>{abuse.email}</span><div><a class="danger" href={abuse.mailto}>Open report draft</a><button onclick={()=>copyDraft(abuse.body,'abuse report')}>Copy text</button></div></article>{/if}</div>{#if draftStatus}<p class="draft-status" aria-live="polite">{draftStatus}</p>{/if}</section>{/if}

    <div class="summaries">
      <article><small>Registration</small><strong>{show(availability.state||whoisParsed.registrationStatus)}</strong><p>{show(availability.confidence)} confidence</p></article>
      <article><small>Registrar</small><strong>{show(availability.registrar||rdapParsed.registrar||whoisParsed.registrar)}</strong><p>{show(whoisParsed.registrarUrl)}</p></article>
      <article><small>Created</small><strong>{formatDate(created())}</strong><p>{fmtAge(availability.domainAgeDays)||'Registry lifecycle date'}</p></article>
      <article><small>Expires</small><strong>{formatDate(expires())}</strong><p>{fmtExpiresIn(availability.expiresInDays)||'Registry lifecycle date'}</p></article>
      <article><small>Updated</small><strong>{formatDate(updated())}</strong><p>Most recent registry change</p></article>
      <article><small>Website</small><strong>{show(availability.activityStatus)}</strong><p>{show(availability.websiteProbeDetail)}</p></article>
    </div>

    {#if comparison.fields.length}
      <details class="comparison card" open={comparison.counts.conflict>0}>
        <summary>RDAP / WHOIS comparison · {comparison.counts.conflict} conflicts · {sourceOnlyCount} source-only · {redactedComparisonCount} redacted · {limitedComparisonCount} unavailable/incomplete · {comparison.counts.equivalent} equivalent</summary>
        <div class="table-wrap"><table><thead><tr><th>Field</th><th>RDAP</th><th>WHOIS</th><th>Assessment</th></tr></thead><tbody>{#each comparison.fields as field}<tr class:conflict={field.status==='conflict'}><th scope="row">{field.label}</th><td>{field.rdapDisplay}</td><td>{field.whoisDisplay}</td><td><span class={field.status}>{assessment(field.status)}</span></td></tr>{/each}</tbody></table></div>
      </details>
    {/if}

    <div class="sources">
      <details class="card" open><summary>RDAP structured data</summary>{#if rdap.error}<p class="error source-error">{rdap.error}</p>{:else}
        <dl>
          {#if result.type==='domain'}
            <dt>Domain</dt><dd>{show(rdapParsed.domain)}</dd><dt>Unicode name</dt><dd>{show(rdapParsed.unicodeDomain)}</dd><dt>Registry ID</dt><dd>{show(rdapParsed.handle)}</dd><dt>Registrar</dt><dd>{show(rdapParsed.registrar)}</dd><dt>Registrar ID</dt><dd>{show(rdapParsed.registrarIanaId)}</dd><dt>DNSSEC</dt><dd>{show(rdapParsed.dnssec)}</dd><dt>DS records</dt><dd>{rdapDsText()||'—'}{rdapParsed.dsDataTruncated?' (capped)':''}</dd><dt>Status</dt><dd>{show(rdapParsed.statuses)}{rdapParsed.statusesTruncated?' (capped)':''}</dd><dt>Nameservers</dt><dd>{show(rdapParsed.nameservers)}{rdapParsed.nameserversTruncated?' (capped)':''}</dd><dt>Glue addresses</dt><dd>{rdapGlueText()||'—'}{rdapParsed.nameserverAddressesTruncated?' (capped)':''}</dd><dt>IDN variants</dt><dd>{rdapVariantText()||'—'}{rdapParsed.variantsTruncated?' (capped)':''}</dd>
          {:else if result.type==='ipv4'||result.type==='ipv6'}
            <dt>Handle</dt><dd>{show(rdapParsed.handle)}</dd><dt>Name</dt><dd>{show(rdapParsed.name)}</dd><dt>Range</dt><dd>{show(rdapParsed.startAddress)} – {show(rdapParsed.endAddress)}</dd><dt>CIDRs</dt><dd>{show(rdapParsed.cidrs)}{rdapParsed.cidrsTruncated?' (capped)':''}</dd><dt>Country</dt><dd>{show(rdapParsed.country)}</dd><dt>Type</dt><dd>{show(rdapParsed.networkType)}</dd><dt>Status</dt><dd>{show(rdapParsed.statuses)}{rdapParsed.statusesTruncated?' (capped)':''}</dd><dt>Registered</dt><dd><time datetime={dateTimeAttribute(rdapParsed.lifecycle?.createdDate)}>{formatDate(rdapParsed.lifecycle?.createdDate)}</time></dd><dt>Updated</dt><dd><time datetime={dateTimeAttribute(rdapParsed.lifecycle?.updatedDate)}>{formatDate(rdapParsed.lifecycle?.updatedDate)}</time></dd>
          {:else if result.type==='asn'}
            <dt>Handle</dt><dd>{show(rdapParsed.handle)}</dd><dt>Name</dt><dd>{show(rdapParsed.name)}</dd><dt>AS range</dt><dd>{show(rdapParsed.startAutnum)} – {show(rdapParsed.endAutnum)}</dd><dt>Country</dt><dd>{show(rdapParsed.country)}</dd><dt>Type</dt><dd>{show(rdapParsed.autnumType)}</dd><dt>Status</dt><dd>{show(rdapParsed.statuses)}{rdapParsed.statusesTruncated?' (capped)':''}</dd><dt>Registered</dt><dd><time datetime={dateTimeAttribute(rdapParsed.lifecycle?.createdDate)}>{formatDate(rdapParsed.lifecycle?.createdDate)}</time></dd><dt>Updated</dt><dd><time datetime={dateTimeAttribute(rdapParsed.lifecycle?.updatedDate)}>{formatDate(rdapParsed.lifecycle?.updatedDate)}</time></dd>
          {/if}
          <dt>Object class</dt><dd>{show(rdapParsed.objectClassName)}</dd><dt>Language</dt><dd>{show(rdapParsed.language)}</dd><dt>Conformance</dt><dd>{show(rdapParsed.conformance)}{rdapParsed.conformanceTruncated?' (capped)':''}</dd><dt>Lifecycle events</dt><dd>{Array.isArray(rdapParsed.events)?rdapParsed.events.length:0}{rdapParsed.eventsTruncated?' (capped)':''}</dd><dt>Port 43</dt><dd>{show(rdapParsed.port43)}</dd><dt>Parent handle</dt><dd>{show(rdapParsed.parentHandle)}</dd><dt>Redactions</dt><dd>{rdapRedactionText()||'—'}{rdapParsed.redactionsTruncated?' (capped)':''}</dd><dt>Links</dt><dd>{rdapLinkText()||'—'}{rdapParsed.linksTruncated?' (capped)':''}</dd><dt>Notices</dt><dd>{rdapTextBlocks(rdapParsed.notices)||'—'}{rdapParsed.noticesTruncated?' (capped)':''}</dd><dt>Remarks</dt><dd>{rdapTextBlocks(rdapParsed.remarks)||'—'}{rdapParsed.remarksTruncated?' (capped)':''}</dd>
        </dl>
        {#if populatedRdapRoles.length}<details class="contact-inventory"><summary>Published contacts · {populatedRdapRoles.length} role{populatedRdapRoles.length===1?'':'s'}{rdapParsed.entitiesTruncated?' · capped':''}</summary><div>{#if rdapParsed.entitiesTruncated}<p>Registry contact data exceeded local display limits. Review the raw response or exported evidence for the complete upstream payload.</p>{/if}{#each populatedRdapRoles as role}<section><h4>{role}{rdapParsed.truncatedEntityRoles?.includes(role)?' · capped':''}</h4>{#each rdapParsed.entitiesByRole[role] as contact}<article><strong>{contactIdentity(contact)}{contact.truncated?' · capped':''}</strong>{#each contactDetails(contact) as detail}<span>{detail}</span>{/each}</article>{/each}</section>{/each}</div></details>{/if}
      {/if}</details>
      <details class="card" open><summary>WHOIS structured data</summary>{#if whois.error}<p class="error source-error">{whois.error}</p>{:else}<dl><dt>Domain</dt><dd>{show(whoisParsed.domainName)}</dd><dt>Registry ID</dt><dd>{show(whoisParsed.registryDomainId)}</dd><dt>Registrar</dt><dd>{show(whoisParsed.registrar)}</dd><dt>Registrar ID</dt><dd>{show(whoisParsed.registrarIanaId)}</dd><dt>Registrar WHOIS</dt><dd>{show(whoisParsed.registrarWhoisServer)}</dd><dt>Reseller</dt><dd>{show(whoisParsed.reseller)}</dd><dt>Created</dt><dd>{formatDate(whoisParsed.lifecycle?.createdDate)}</dd><dt>Expires</dt><dd>{formatDate(whoisParsed.lifecycle?.expiryDate)}</dd><dt>Updated</dt><dd>{formatDate(whoisParsed.lifecycle?.updatedDate)}</dd><dt>DNSSEC</dt><dd>{show(whoisParsed.dnssec)}</dd><dt>Status</dt><dd>{show(whoisParsed.statuses)}</dd><dt>Nameservers</dt><dd>{show(whoisParsed.nameservers)}</dd><dt>Chain</dt><dd>{show(whoisParsed.chainStatus)}</dd></dl>{#if populatedWhoisRoles.length}<details class="contact-inventory"><summary>Published contacts · {populatedWhoisRoles.length} role{populatedWhoisRoles.length===1?'':'s'}{whoisParsed.fieldsTruncated?.length?' · capped':''}</summary><div>{#if whoisParsed.fieldsTruncated?.length}<p>Some WHOIS fields exceeded local display limits: {whoisParsed.fieldsTruncated.join(', ')}. Review the raw response or exported evidence for the complete upstream text.</p>{/if}{#each populatedWhoisRoles as role}<section><h4>{role}</h4>{#each whoisParsed.contactsByRole[role] as contact}<article><strong>{contactIdentity(contact)}</strong>{#each contactDetails(contact) as detail}<span>{detail}</span>{/each}</article>{/each}</section>{/each}</div></details>{/if}{/if}</details>
    </div>
    <details class="raw card"><summary>Raw unified response</summary><pre>{JSON.stringify(result,null,2)}</pre></details>
  </section>
{/if}

<style>
  .search{padding:22px}.search>label{display:block;margin-bottom:9px;font-weight:700}.input-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px}.query-field{position:relative;min-width:0}.query-field textarea{display:block;width:100%;min-height:54px;padding:14px 48px 10px 12px;border:1px solid var(--border);border-radius:11px;background:rgba(15,17,21,.78);resize:vertical}.clear{position:absolute;right:7px;top:9px;width:34px;height:34px;border:0;background:none;font-size:1.25rem}.input-help{margin:8px 0 0;color:var(--muted);font-size:.68rem}.result-head{display:flex;align-items:end;justify-content:space-between;gap:20px;margin:34px 0 18px}.result-head h2{margin:0;font-size:clamp(1.8rem,5vw,2.4rem);overflow-wrap:anywhere}.result-head p{margin:6px 0 0;color:var(--muted);font-size:.72rem}.result-actions{display:flex;align-items:center;gap:8px}.result-actions span,.result-actions button{padding:8px 11px;border:1px solid var(--border);border-radius:999px;background:var(--panel);text-transform:capitalize}.diagnostics,.summaries{display:grid;gap:10px}.diagnostics{grid-template-columns:repeat(3,1fr);margin-bottom:12px}.diagnostics article,.summaries article{padding:15px;border:1px solid var(--border);border-radius:14px;background:var(--panel)}.diagnostics small,.diagnostics strong,.summaries small,.summaries strong{display:block}.diagnostics small,.summaries small{color:var(--muted);text-transform:uppercase;letter-spacing:.06em}.diagnostics strong{margin-top:7px;color:var(--accent);text-transform:capitalize}.diagnostics .error-state{color:var(--danger)}.diagnostics p,.summaries p{margin-bottom:0;color:var(--muted);font-size:.66rem;overflow-wrap:anywhere}.availability{margin-bottom:12px;padding:20px}.availability header{display:flex;justify-content:space-between;gap:18px}.availability h3{margin:0}.availability header p{margin:5px 0;color:var(--muted);font-size:.7rem}.scores{display:flex;gap:9px}.score{display:grid;grid-template-columns:1fr auto;gap:3px;width:145px;padding:9px;border:1px solid var(--border);border-radius:10px}.score span{font-size:.65rem}.score strong{font-size:1rem}.score i{grid-column:1/-1;height:5px;overflow:hidden;border-radius:99px;background:var(--border)}.score b{display:block;height:100%;background:var(--accent)}.score.danger b{background:var(--danger)}.score.warn b{background:#f2b84b}.signals{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}.signals span,.comparison td span{padding:5px 7px;border:1px solid var(--border);border-radius:99px;font-size:.64rem}.signals .danger,.comparison .conflict{color:var(--danger);border-color:rgba(255,107,107,.33)}.signals .warn,.comparison .rdap_unavailable,.comparison .whois_unavailable,.comparison .rdap_incomplete,.comparison .whois_incomplete{color:#f2b84b}.signals .good,.comparison .equivalent{color:var(--accent)}.trust-note{margin:12px 0 0;padding:9px 11px;border-left:3px solid var(--accent);background:rgba(126,224,168,.04);color:var(--muted);font-size:.68rem}.score-details{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.score-details details{padding:10px;border:1px solid var(--border);border-radius:9px}.score-details summary{cursor:pointer;font-size:.7rem;font-weight:700}.score-details ul{display:grid;gap:5px;margin:10px 0 0;padding:0;list-style:none}.score-details li{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:.66rem}.response{margin:12px 0;padding:20px}.response h3{margin:0}.response>div>p,.draft-status{color:var(--muted);font-size:.68rem}.response-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}.response-actions article{padding:12px;border:1px solid var(--border);border-radius:10px;background:var(--panel)}.response-actions strong,.response-actions span{display:block}.response-actions span{margin-top:5px;color:var(--muted);font-size:.66rem}.response-actions article>div{display:flex;gap:6px;margin-top:10px}.response-actions a,.response-actions button{padding:7px 9px;border:1px solid var(--border);border-radius:8px;background:var(--panel-raised);font-size:.66rem}.response-actions .danger{color:var(--danger)}.summaries{grid-template-columns:repeat(3,1fr)}.summaries strong{margin-top:10px;overflow-wrap:anywhere}.comparison,.sources>details,.raw{padding:0;overflow:hidden}.comparison{margin-top:12px}.comparison>summary,.sources>details>summary,.raw summary{padding:16px;cursor:pointer;font-weight:700}.table-wrap{overflow:auto;border-top:1px solid var(--border)}table{width:100%;border-collapse:collapse;font-size:.69rem}th,td{padding:10px;border-top:1px solid var(--border);text-align:left;vertical-align:top}thead th{color:var(--muted);font-size:.62rem;text-transform:uppercase}.comparison tr.conflict{background:rgba(255,107,107,.03)}.sources{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}dl{display:grid;grid-template-columns:95px 1fr;gap:9px;margin:0;padding:0 16px 16px;font-size:.7rem}dd{margin:0;overflow-wrap:anywhere}.source-error{padding:0 16px}.contact-inventory{margin:0 16px 16px;border:1px solid var(--border);border-radius:9px}.contact-inventory>summary{padding:11px;font-size:.68rem}.contact-inventory>div{display:grid;gap:9px;padding:0 11px 11px}.contact-inventory>div>p{margin:0;padding:8px;border-left:3px solid #f2b84b;background:rgba(242,184,75,.04);color:var(--muted);font-size:.62rem}.contact-inventory section{min-width:0}.contact-inventory h4{margin:0 0 5px;color:var(--muted);font-size:.62rem;text-transform:uppercase}.contact-inventory article{padding:8px;border:1px solid var(--border);border-radius:7px;background:var(--panel)}.contact-inventory strong,.contact-inventory span{display:block;overflow-wrap:anywhere}.contact-inventory span{margin-top:4px;color:var(--muted);font-size:.62rem}.raw{margin-top:12px}pre{max-height:520px;overflow:auto;margin:0;padding:18px;border-top:1px solid var(--border);font-size:.65rem}
  .idn-card{margin-bottom:12px;padding:20px}.idn-card header{display:flex;justify-content:space-between;gap:12px}.idn-card h3{margin:0}.idn-card header>span{color:var(--muted);font-size:.62rem}.idn-forms{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:13px}.idn-forms article{min-width:0;padding:11px;border:1px solid var(--border);border-radius:9px;background:var(--panel)}.idn-forms small,.idn-forms strong{display:block}.idn-forms small{color:var(--muted);font-size:.61rem;text-transform:uppercase}.idn-forms strong{margin-top:5px;overflow-wrap:anywhere}.idn-card ul{display:grid;gap:7px;margin:12px 0 0;padding:0;list-style:none}.idn-card li{padding:9px 11px;border-left:3px solid var(--accent);background:rgba(126,224,168,.04)}.idn-card li.warning{border-color:#f2b84b;background:rgba(242,184,75,.04)}.idn-card li strong,.idn-card li span{display:block}.idn-card li span,.idn-card>p{margin-top:4px;color:var(--muted);font-size:.66rem}.idn-card>p{margin-bottom:0}
  .dns-card{margin-bottom:12px;padding:20px}.dns-card header{display:flex;justify-content:space-between;gap:12px}.dns-card h3{margin:0}.dns-card header>span{color:var(--accent);font-size:.64rem;text-transform:uppercase}.dns-card header>span.partial{color:#f2b84b}.dns-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:13px}.dns-grid article{min-width:0;padding:11px;border:1px solid var(--border);border-radius:9px;background:var(--panel)}.dns-grid small,.dns-grid strong{display:block}.dns-grid small{color:var(--muted);font-size:.61rem;text-transform:uppercase}.dns-grid strong{margin-top:5px;font-size:.7rem;overflow-wrap:anywhere}.dns-card>p{margin:11px 0 0;color:var(--muted);font-size:.66rem}.dns-card .dns-warning{padding:9px 11px;border-left:3px solid #f2b84b;background:rgba(242,184,75,.04);color:var(--text)}
  .http-card{margin-bottom:12px;padding:20px}.http-card header{display:flex;justify-content:space-between;gap:12px}.http-card h3{margin:0}.http-card header>span{color:var(--accent);font-size:.64rem;text-transform:uppercase}.http-card header>span.partial{color:#f2b84b}.http-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:13px}.http-grid article{min-width:0;padding:11px;border:1px solid var(--border);border-radius:9px;background:var(--panel)}.http-grid small,.http-grid strong{display:block}.http-grid small{color:var(--muted);font-size:.61rem;text-transform:uppercase}.http-grid strong{margin-top:5px;font-size:.7rem;overflow-wrap:anywhere}.http-findings{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.http-findings span{padding:5px 7px;border:1px solid rgba(242,184,75,.33);border-radius:99px;color:#f2b84b;font-size:.64rem}.http-findings span.danger{color:var(--danger);border-color:rgba(255,107,107,.33)}.http-detail{margin-top:10px;padding:10px;border:1px solid var(--border);border-radius:9px}.http-detail summary{cursor:pointer;font-size:.68rem;font-weight:700}.http-detail ol,.http-detail ul{display:grid;gap:7px;margin:9px 0 0;padding-left:20px}.http-detail li{font-size:.64rem;overflow-wrap:anywhere}.http-detail li strong,.http-detail li b,.http-detail li small{display:block;margin-top:2px;font-weight:400}.http-detail li b,.http-detail li small{color:var(--muted)}.http-detail dl{display:grid;grid-template-columns:minmax(120px,180px) 1fr;gap:7px;margin:9px 0 0;padding:0;font-size:.64rem}.http-detail dd{min-width:0}.http-hash{overflow-wrap:anywhere}.http-limitations{padding:9px 11px;border-left:3px solid #f2b84b;background:rgba(242,184,75,.04);color:var(--text)!important}.http-card>p{margin:11px 0 0;color:var(--muted);font-size:.66rem}
  .page-card{margin-bottom:12px;padding:20px}.page-card header{display:flex;justify-content:space-between;gap:12px}.page-card h3{margin:0}.page-card header>span{color:var(--accent);font-size:.64rem;text-transform:uppercase}.page-card header>span.partial{color:#f2b84b}.page-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:13px}.page-grid article{min-width:0;padding:11px;border:1px solid var(--border);border-radius:9px;background:var(--panel)}.page-grid small,.page-grid strong{display:block}.page-grid small{color:var(--muted);font-size:.61rem;text-transform:uppercase}.page-grid strong{margin-top:5px;font-size:.7rem;overflow-wrap:anywhere}.page-grid .danger-text{color:var(--danger)}.page-detail{margin-top:10px;padding:10px;border:1px solid var(--border);border-radius:9px}.page-detail summary{cursor:pointer;font-size:.68rem;font-weight:700}.page-detail ul{display:grid;gap:5px;margin:9px 0 0;padding-left:20px}.page-detail li{font-size:.64rem;overflow-wrap:anywhere}.page-limitations{padding:9px 11px;border-left:3px solid #f2b84b;background:rgba(242,184,75,.04);color:var(--text)!important}.page-card>p{margin:11px 0 0;color:var(--muted);font-size:.66rem}
  .case-card{margin:12px 0;padding:20px}.case-card h3{margin:0}.case-intro{display:flex;justify-content:space-between;gap:14px;align-items:start}.case-badges{display:flex;flex-wrap:wrap;gap:6px}.badge{padding:4px 9px;border:1px solid var(--border);border-radius:99px;font-size:.62rem;white-space:nowrap}.badge.status-escalated,.badge.disposition-confirmed_abuse{color:var(--danger);border-color:rgba(255,107,107,.4)}.badge.status-resolved,.badge.disposition-false_positive,.badge.disposition-expected{color:var(--accent2)}.badge.disposition-suspicious{color:#f2b84b}.case-body{margin-top:12px}.note-edit label{display:block;color:var(--muted);font-size:.66rem;margin-bottom:5px}.note-edit textarea{width:100%;padding:10px;border:1px solid var(--border);border-radius:9px;background:var(--panel);resize:vertical}.case-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}.case-actions button{min-height:36px;padding:8px 13px;border:1px solid var(--border);border-radius:8px;background:var(--panel-raised);font-size:.68rem}.case-body>.primary{margin-top:4px}.case-actions a{color:var(--accent);font-size:.68rem}.case-hint,.case-status{margin:8px 0 0;color:var(--muted);font-size:.66rem}.case-status{color:var(--accent)}
  .diagnostics .limited-state{color:#f2b84b}
  @media(max-width:900px){.summaries{grid-template-columns:repeat(2,1fr)}.diagnostics{grid-template-columns:1fr}.availability header{display:block}.scores{margin-top:12px}}
  @media(max-width:650px){.input-row,.summaries,.sources,.score-details,.response-actions,.idn-forms,.dns-grid,.http-grid,.page-grid{grid-template-columns:1fr}.http-detail dl{grid-template-columns:1fr}.input-row .primary{min-height:44px}.result-head{align-items:flex-start;flex-direction:column}.result-actions{width:100%;flex-wrap:wrap}.scores{display:grid;grid-template-columns:1fr 1fr}.score{width:auto}}
</style>
