<script lang="ts">
  import { goto } from '$app/navigation';
  import { getContext, onMount } from 'svelte';
  import { page } from '$app/state';
  import RdapDomainSource from '$lib/components/RdapDomainSource.svelte';
  import { activeProfile, profileSignals as matchProfileSignals, type BrandProfile } from '$lib/brand-profiles';
  import { addCaseNote, dispositionLabel as caseDispositionLabel, getCaseByDomain, openCase, statusLabel as caseStatusLabel, type CaseRecord } from '$lib/cases';
  import { saveCandidateHandoff } from '$lib/candidate-handoff';
  import { abuseAction, outreachAction, type AbuseEvidence, type Contact } from '$lib/drafts';
  import { buildLookupEvidence, evidenceFilename } from '$lib/analysis/evidence-export.js';
  import { analyzeDomainIdn } from '$lib/analysis/idn-confusables.js';
  import { compactHttpObservation } from '$lib/analysis/http-summary.js';
  import { calibrateExternalIntelligenceRisk } from '$lib/analysis/external-intelligence-risk.js';
  import { createPageBaseline } from '$lib/analysis/page-baseline.js';
  import { comparePageBaselines } from '$lib/analysis/page-similarity.js';
  import { compareRegistrySources } from '$lib/analysis/registry-comparison.js';
  import { entityDisplayName, parseDomainInput } from '$lib/analysis/utils.js';
  import { CAPABILITY_CONTEXT, disabledCapabilities, disabledCapability, featureCapability, type CapabilityGetter } from '$lib/capabilities';
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
  let includeExternalIntelligence=$state(false);
  let includeMalwareHostIntelligence=$state(false);
  let includeMalwareIocIntelligence=$state(false);
  let error=$state('');
  let result=$state<JsonRecord|null>(null);
  let profile=$state<BrandProfile|null>(null);
  let draftStatus=$state('');
  let caseRecord=$state<CaseRecord|null>(null);let caseNote=$state('');let caseStatus=$state('');
  const capabilityReport=getContext<CapabilityGetter>(CAPABILITY_CONTEXT);
  const lookupDisabled=$derived(disabledCapability(capabilityReport?.()||null,'lookup'));
  const lookupLimitations=$derived(disabledCapabilities(capabilityReport?.()||null,['rdap','whois','availability','dns_intelligence','website_probe','tls_intelligence']));
  const urlscanCapability=$derived(featureCapability(capabilityReport?.()||null,'urlscan_search'));
  const externalIntelligenceSupported=$derived(urlscanCapability?.status==='supported');
  const urlhausCapability=$derived(featureCapability(capabilityReport?.()||null,'urlhaus_host'));
  const malwareHostIntelligenceSupported=$derived(urlhausCapability?.status==='supported');
  const threatfoxCapability=$derived(featureCapability(capabilityReport?.()||null,'threatfox_domain_ioc'));
  const malwareIocIntelligenceSupported=$derived(threatfoxCapability?.status==='supported');

  const rec=(value:any):JsonRecord=>value&&typeof value==='object'?value:{};
  const show=(value:any):string=>value==null||value===''?'—':Array.isArray(value)?(value.join(', ')||'—'):typeof value==='object'?show(value.name||value.org||value.handle||value.domain):String(value);
  const parsedInput=$derived(parseDomainInput(query));
  const entries=$derived(parsedInput.entries);
  const availability=$derived(rec(result?.availability));
  const lookupEvidenceDepth=$derived(availability.deepScanComplete===false?'fast':'deep');
  const rdap=$derived(rec(result?.rdap));
  const registrarRdap=$derived(rec(rdap.registrarRdap));
  const registrarRdapParsed=$derived(rec(registrarRdap.parsed));
  const whois=$derived(rec(result?.whois));
  const rdapParsed=$derived(rec(rdap.parsed));
  const whoisParsed=$derived(rec(whois.parsed));
  const diagnostics=$derived(rec(result?.diagnostics));
  const threatIntelligence=$derived(rec(result?.threatIntelligence));
  const threatIntelligenceProviders=$derived(Array.isArray(threatIntelligence.providers)?threatIntelligence.providers.map(rec):[]);
  const dnsEvidence=$derived(rec(availability.dns));
  const dnsRecords=$derived(rec(dnsEvidence.records));
  const httpEvidence=$derived(rec(availability.http));
  const httpResponse=$derived(rec(httpEvidence.response));
  const httpSecurityHeaders=$derived(rec(httpResponse.securityHeaders));
  const tlsEvidence=$derived(rec(availability.tls));
  const tlsCertificate=$derived(rec(tlsEvidence.certificate));
  const tlsSubject=$derived(rec(tlsCertificate.subject));
  const tlsIssuer=$derived(rec(tlsCertificate.issuer));
  const tlsAltNames=$derived(rec(tlsCertificate.subjectAltNames));
  const tlsPublicKey=$derived(rec(tlsCertificate.publicKey));
  const tlsCipher=$derived(rec(tlsEvidence.cipher));
  const tlsAuthorization=$derived(rec(tlsEvidence.authorization));
  const tlsHostname=$derived(rec(tlsEvidence.hostname));
  const tlsValidity=$derived(rec(tlsEvidence.validity));
  const tlsDiagnostics=$derived(rec(tlsEvidence.diagnostics));
  const pageIdentity=$derived(rec(availability.pageIdentity));
  const pageCanonical=$derived(rec(pageIdentity.canonical));
  const pageMetaRefresh=$derived(rec(pageIdentity.metaRefresh));
  const pageOpenGraph=$derived(rec(pageIdentity.openGraph));
  const pageOpenGraphUrl=$derived(rec(pageOpenGraph.url));
  const pageForms=$derived(rec(pageIdentity.forms));
  const pageResources=$derived(rec(pageIdentity.resources));
  const pageResourceTypes=$derived(rec(pageResources.byType));
  const pageDownloads=$derived(rec(pageIdentity.downloads));
  const pageFingerprints=$derived(rec(pageIdentity.fingerprints));
  const compactHttpSummary=$derived(compactHttpObservation(availability.http)||{});
  const whoisRoleOrder=['registrant','administrative','technical','billing','abuse'];
  const populatedWhoisRoles=$derived(whoisRoleOrder.filter((role)=>Array.isArray(whoisParsed.contactsByRole?.[role])&&whoisParsed.contactsByRole[role].length));
  const comparison=$derived(result?.type==='domain'?compareRegistrySources(rdapParsed,whoisParsed,{rdapStatus:diagnostics.rdap?.status,whoisStatus:diagnostics.whois?.status}):{fields:[],counts:{equivalent:0,conflict:0,rdap_only:0,whois_only:0,rdap_redacted:0,whois_redacted:0,rdap_unavailable:0,whois_unavailable:0,rdap_incomplete:0,whois_incomplete:0}});
  const idnAnalysis=$derived(result?.type==='domain'?analyzeDomainIdn(String(result?.registrableDomain||availability.domain||''),profile?.officialDomains||[]):null);
  const profileSignals=$derived.by(()=>{
    return matchProfileSignals(String(availability.domain||result?.registrableDomain||''),availability,profile);
  });
  const externalRiskContext=$derived(calibrateExternalIntelligenceRisk(threatIntelligence));
  const scoredAvailability=$derived({...availability,...profileSignals,threatIntelligence});
  const opportunity=$derived(explainOpportunityScore(scoredAvailability) as ScoreExplanation);
  const risk=$derived(explainRiskScore(scoredAvailability) as ScoreExplanation);
  const outreach=$derived(outreachAction(String(availability.domain||result?.registrableDomain||''),(availability.registrant||null) as Contact|null));
  const abuse=$derived(profileSignals.trusted?null:abuseAction(String(availability.domain||result?.registrableDomain||''),availability.abuse?.email?{abuseEmail:String(availability.abuse.email),hasMx:availability.hasMx??null,activityStatus:availability.activityStatus||null,privacyProtected:availability.privacyProtected??null,domainAgeDays:availability.domainAgeDays??null} as AbuseEvidence:null));
  const sourceOnlyCount=$derived(comparison.counts.rdap_only+comparison.counts.whois_only);
  const redactedComparisonCount=$derived(comparison.counts.rdap_redacted+comparison.counts.whois_redacted);
  const limitedComparisonCount=$derived(comparison.counts.rdap_unavailable+comparison.counts.whois_unavailable+comparison.counts.rdap_incomplete+comparison.counts.whois_incomplete);
  const caseDomain=$derived(String(availability.domain||result?.registrableDomain||'').trim().toLowerCase());
  const observedPageBaseline=$derived(createPageBaseline(caseDomain,availability));
  const pageComparison=$derived(comparePageBaselines(profile?.pageBaseline,observedPageBaseline));
  const intelligenceOptionCount=$derived(Number(externalIntelligenceSupported)+Number(malwareHostIntelligenceSupported)+Number(malwareIocIntelligenceSupported));
  const hasWebEvidence=$derived(dnsEvidence.source==='dns'||httpEvidence.source==='http'||tlsEvidence.source==='tls'||pageIdentity.source==='html'||Boolean(pageComparison)||Boolean(profile?.pageBaseline&&result?.type==='domain'));
  const hasCaseSection=$derived(Boolean(caseDomain)||Boolean(outreach)||Boolean(abuse));
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
  function created(){return availability.createdDateIso||availability.createdDate||rdapParsed.lifecycle?.createdDateIso||rdapParsed.lifecycle?.createdDate||eventDate('registration')||whoisParsed.createdDateIso||whoisParsed.lifecycle?.createdDateIso||whoisParsed.createdDate;}
  function expires(){return availability.expiryDateIso||availability.expiryDate||rdapParsed.lifecycle?.expiryDateIso||rdapParsed.lifecycle?.expiryDate||eventDate('expiration')||whoisParsed.expiryDateIso||whoisParsed.lifecycle?.expiryDateIso||whoisParsed.expiryDate;}
  function updated(){return rdapParsed.lifecycle?.updatedDateIso||rdapParsed.lifecycle?.updatedDate||eventDate('last changed')||whoisParsed.updatedDateIso||whoisParsed.lifecycle?.updatedDateIso||whoisParsed.updatedDate;}
  function formatDate(value:any){if(!value)return'—';const parsed=new Date(value);return Number.isNaN(parsed.getTime())?String(value):parsed.toLocaleString();}
  function dateTimeAttribute(value:any){if(!value)return undefined;const parsed=new Date(value);return Number.isNaN(parsed.getTime())?undefined:parsed.toISOString();}
  function statusLabel(value:string){return value.replaceAll('_',' ');}
  function trackingIdentifierLabel(value:any){return({
    'advertising-property':'Advertising property',
    'analytics-property':'Analytics property',
    'legacy-analytics-property':'Legacy analytics property',
    'tag-container':'Tag container'
  } as Record<string,string>)[String(value)]||statusLabel(show(value));}
  function pageFingerprintRows(){return[
    ['Exact captured body',rec(pageFingerprints.exact).value,rec(pageFingerprints.exact).scope==='captured-prefix'?'Captured prefix':'Complete captured body'],
    ['Normalized HTML',rec(pageFingerprints.normalizedHtml).value,`${show(rec(pageFingerprints.normalizedHtml).tokenCount)} tokens`],
    ['Visible text',rec(pageFingerprints.visibleText).value,rec(pageFingerprints.visibleText).value?`${show(rec(pageFingerprints.visibleText).tokenCount)} tokens · fuzzy SimHash`:null],
    ['Static tag structure',rec(pageFingerprints.domStructure).value,`${show(rec(pageFingerprints.domStructure).nodeCount)} nodes`],
    ['Form structure',rec(pageFingerprints.formStructure).value,rec(pageFingerprints.formStructure).value?`${show(rec(pageFingerprints.formStructure).formCount)} forms · ${show(rec(pageFingerprints.formStructure).controlCount)} controls`:null],
    ['External resource hosts',rec(pageFingerprints.resourceHosts).value,rec(pageFingerprints.resourceHosts).value?`${Array.isArray(rec(pageFingerprints.resourceHosts).values)?rec(pageFingerprints.resourceHosts).values.length:0} hosts`:null],
    ['Tracking identifiers',rec(pageFingerprints.identifiers).value,rec(pageFingerprints.identifiers).value?`${Array.isArray(rec(pageFingerprints.identifiers).values)?rec(pageFingerprints.identifiers).values.length:0} identifiers`:null]
  ].filter((row)=>row[1]);}
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
  function dnsValues(name:string){const records=Array.isArray(dnsRecords[name])?dnsRecords[name]:[];return records.map((record:any)=>typeof record==='string'?record:name==='mx'?`${record.priority} ${record.exchange||'.'}`:name==='caa'?`${record.critical} ${record.tag} ${record.value}`:String(record)).join(' · ');}
  function dnsDisplay(name:string){return dnsEvidence.status==='skipped'?'Not evaluated':dnsValues(name)||'Not observed';}
  function dnsQueryFailures(){return Object.entries(rec(dnsEvidence.diagnostics)).filter(([,item])=>rec(item).status==='error').map(([name,item])=>`${name.toUpperCase()}: ${rec(item).error||'query failed'}`).join(' · ');}
  function formatBytes(value:any){const bytes=Number(value);if(!Number.isFinite(bytes)||bytes<0)return'—';return bytes<1024?`${bytes} B`:`${(bytes/1024).toFixed(bytes<10240?1:0)} KiB`;}
  function tlsName(value:JsonRecord){const common=Array.isArray(value.commonNames)?value.commonNames:[];const organizations=Array.isArray(value.organizations)?value.organizations:[];return[...common,...organizations].join(' · ')||'—';}
  function tlsTrust(){return tlsAuthorization.authorized===true?'Authorized':tlsAuthorization.authorized===false?'Not authorized':'Not observed';}
  function tlsHostnameStatus(){return tlsHostname.matches===true?'Matches SNI':tlsHostname.matches===false?'Mismatch':'Not observed';}
  function tlsValidityStatus(){return tlsValidity.status==='valid'?'Valid now':tlsValidity.status==='expired'?'Expired':tlsValidity.status==='not_yet_valid'?'Not yet valid':'Unknown';}
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
  async function submit(event:SubmitEvent){event.preventDefault();if(lookupDisabled){error=lookupDisabled.reason||'Lookup is disabled by deployment policy.';return;}if(!entries.length||loading)return;if(entries.length>1){saveCandidateHandoff('manual',entries.slice(0,2000).map(domain=>({domain:domain.toLowerCase(),source:'manual input',mutationTypes:[]})));await goto('/bulk?source=lookup');return;}loading=true;error='';result=null;caseRecord=null;caseNote='';caseStatus='';profile=activeProfile();try{const params=new URLSearchParams({q:entries[0]});if(includeExternalIntelligence&&externalIntelligenceSupported)params.set('intelligence','1');if(includeMalwareHostIntelligence&&malwareHostIntelligenceSupported)params.set('malware','1');if(includeMalwareIocIntelligence&&malwareIocIntelligenceSupported)params.set('ioc','1');const response=await fetch(`/api/lookup?${params}`);const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||`Lookup failed (${response.status})`);result=body;refreshCase();requestAnimationFrame(()=>document.querySelector('#result')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'}));}catch(cause){error=cause instanceof Error?cause.message:'Lookup failed';}finally{loading=false;}}
</script>

<svelte:head><title>Lookup · WHOISleuth</title></svelte:head>
<section class="heading"><div><p class="eyebrow">Investigate</p><h1>Lookup</h1><p>Look up a domain, IP address, or ASN using RDAP and WHOIS, with DNS, HTTP, and bounded TLS/certificate checks for domains.</p></div></section>
<form class="search card" onsubmit={submit}>
  {#if lookupDisabled}<p class="feature-disabled" role="note">{lookupDisabled.reason||'Lookup is disabled by deployment policy.'}</p>{/if}
  {#if !lookupDisabled&&lookupLimitations.length}<p class="feature-disabled" role="note">Some lookup sources are disabled by deployment policy: {lookupLimitations.map((item)=>item.id.replaceAll('_',' ')).join(', ')}. Results will identify unevaluated evidence.</p>{/if}
  <label class="search-label" for="query">Domain, IP address, ASN, or domain list</label>
  <div class="input-row"><div class="query-field"><textarea id="query" bind:value={query} placeholder="example.com" autocomplete="off" spellcheck="false" rows="2"></textarea>{#if query}<button type="button" class="clear" aria-label="Clear query" onclick={()=>query=''}>×</button>{/if}</div><button class="primary" disabled={loading||!entries.length||Boolean(lookupDisabled)}>{loading?'Looking up…':entries.length>1?`Open ${Math.min(entries.length,2000)} in Bulk`:'Run lookup'}</button></div>
  <p class="input-help">{entries.length>1?`${entries.length} unique entries detected. Multiple entries continue in Bulk${parsedInput.duplicates?`; ${parsedInput.duplicates} duplicate${parsedInput.duplicates===1?'':'s'} removed`:''}.`:'Separate multiple domains with commas, semicolons, tabs, or new lines.'}</p>
  {#if intelligenceOptionCount}
    <fieldset class="intelligence-options">
      <legend>Optional third-party intelligence</legend>
      <p class="intelligence-hint">Each selected source receives only the registrable domain for a deep single-domain lookup. Nothing is submitted for scanning or reporting, and provider verdicts never affect availability.</p>
      {#if externalIntelligenceSupported}
        <label class="intelligence-option choice"><input type="checkbox" bind:checked={includeExternalIntelligence} disabled={entries.length>1}> <span><strong>Search archived URLscan verdicts</strong> Sends only the registrable domain to the optional third-party search API. It does not submit the domain for scanning.</span></label>
      {/if}
      {#if malwareHostIntelligenceSupported}
        <label class="intelligence-option choice"><input type="checkbox" bind:checked={includeMalwareHostIntelligence} disabled={entries.length>1}> <span><strong>Search malware-distribution records</strong> Sends only the registrable domain to the optional URLhaus host API. It searches existing records and does not submit a URL or sample.</span></label>
      {/if}
      {#if malwareIocIntelligenceSupported}
        <label class="intelligence-option choice"><input type="checkbox" bind:checked={includeMalwareIocIntelligence} disabled={entries.length>1}> <span><strong>Search malware infrastructure records</strong> Sends only the registrable domain to the optional ThreatFox search API. It searches retained indicators and does not submit an IOC, URL, or sample.</span></label>
      {/if}
    </fieldset>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</form>

{#if result}
  <section class="result-root" id="result">
    <div class="result-head"><div><p class="eyebrow">Result</p><h2>{show(result.registrableDomain||result.query)}</h2>{#if result.isSubdomain}<p>Showing registry data for {result.registrableDomain}; submitted hostname: {result.inputHostname}.</p>{/if}</div><div class="result-actions"><span class="chip info">{show(availability.state)}</span><button class="btn" onclick={downloadEvidence}>Export evidence JSON</button></div></div>

    <div class="local-nav-shell">
      <nav class="local-nav" aria-label="Result sections">
        <a href="#overview">Overview</a>
        {#if hasWebEvidence}<a href="#web-evidence">Web &amp; DNS</a>{/if}
        <a href="#registry">Registry</a>
        {#if threatIntelligenceProviders.length}<a href="#external-intelligence">External intel</a>{/if}
        {#if hasCaseSection}<a href="#case-response">Case &amp; response</a>{/if}
        <a href="#raw-data">Raw data</a>
      </nav>
    </div>

    <section class="result-section" id="overview" aria-labelledby="overview-title">
      <h3 id="overview-title">Overview</h3>

      {#if availability.applicable!==false}
        <section class="availability card">
          <header class="section-head"><div><p class="eyebrow">Assessment</p><h4>{show(availability.detail||availability.state)}</h4><p>{show(availability.confidence)} confidence</p></div><div class="scores">{#if risk}<div class="score {riskTone(risk.score)}" title={risk.factors.map(f=>`${f.label} ${f.delta>=0?'+':''}${Math.round(f.delta)}`).join('\n')}><span>Risk</span><strong>{risk.score}</strong><i><b style:width={`${risk.score}%`}></b></i></div>{/if}{#if opportunity}<div class="score {scoreTone(opportunity.score)}" title={opportunity.factors.map(f=>`${f.label} ${f.delta>=0?'+':''}${Math.round(f.delta)}`).join('\n')}><span>Opportunity</span><strong>{opportunity.score}</strong><i><b style:width={`${opportunity.score}%`}></b></i></div>{/if}</div></header>
          {#if signals().length}<div class="signals">{#each signals() as signal}<span class="chip {signal.tone==='neutral'?'':signal.tone}" title={signal.detail||''}>{signal.label}</span>{/each}</div>{/if}
          {#if profileSignals.trusted}<p class="callout info">This domain is {profileSignals.trusted} in the active brand profile. Scores remain visible as evidence context but are not treated as an untrusted finding.</p>{/if}
          <div class="score-details">{#if risk}<details class="disclosure"><summary>Why the risk score is {risk.score}</summary><ul>{#each risk.factors as factor}<li><span>{factor.label}</span><strong>{factor.delta>=0?'+':''}{Math.round(factor.delta)}</strong></li>{/each}</ul></details>{/if}{#if opportunity}<details class="disclosure"><summary>Why the opportunity score is {opportunity.score}</summary><ul>{#each opportunity.factors as factor}<li><span>{factor.label}</span><strong>{factor.delta>=0?'+':''}{Math.round(factor.delta)}</strong></li>{/each}</ul></details>{/if}</div>
        </section>
      {/if}

      <div class="summaries stat-grid">
        <article><small>Registration</small><strong>{show(availability.state||whoisParsed.registrationStatus)}</strong><p>{show(availability.confidence)} confidence</p></article>
        <article><small>Registrar</small><strong>{show(availability.registrar||rdapParsed.registrar||whoisParsed.registrar)}</strong><p>{show(whoisParsed.registrarUrl)}</p></article>
        <article><small>Created</small><strong>{formatDate(created())}</strong><p>{fmtAge(availability.domainAgeDays)||'Registry lifecycle date'}</p></article>
        <article><small>Expires</small><strong>{formatDate(expires())}</strong><p>{fmtExpiresIn(availability.expiresInDays)||'Registry lifecycle date'}</p></article>
        <article><small>Updated</small><strong>{formatDate(updated())}</strong><p>Most recent registry change</p></article>
        <article><small>Website</small><strong>{show(availability.activityStatus)}</strong><p>{show(availability.websiteProbeDetail)}</p></article>
      </div>

      <div class="diagnostics stat-grid" aria-label="Source diagnostics">
        {#each ['rdap','whois','availability'] as source}{@const item=rec(diagnostics[source]) as SourceStatus}<article><small>{source}</small><strong class:error-state={item.status==='error'} class:limited-state={item.status==='disabled'}>{diagnosticLabel(item)}</strong><p>{diagnosticDetail(item)}</p></article>{/each}
      </div>

      {#if idnAnalysis && (idnAnalysis.hasIdn || idnAnalysis.referenceMatches.length)}
        <section class="idn-card evidence-card card" aria-labelledby="idn-title">
          <header class="section-head"><div><p class="eyebrow">Domain identity</p><h4 id="idn-title">IDN and confusable review</h4></div><span>{idnAnalysis.mappingVersion}</span></header>
          <div class="idn-forms stat-grid"><article><small>Unicode display</small><strong>{idnAnalysis.unicodeDomain}</strong></article><article><small>DNS-safe ASCII</small><strong>{idnAnalysis.asciiDomain}</strong></article><article><small>Writing scripts</small><strong>{idnAnalysis.scripts.join(', ')||'None detected'}</strong></article></div>
          {#if idnAnalysis.findings.length}<ul class="finding-list">{#each idnAnalysis.findings as finding}<li class="callout {finding.tone==='warning'?'warn':'info'}"><strong>{finding.label}</strong><span>{finding.detail}</span></li>{/each}</ul>{/if}
          <p class="card-note">Review Unicode and ASCII forms together. These are bounded similarity indicators and do not establish maliciousness.</p>
        </section>
      {/if}
    </section>

    {#if hasWebEvidence}
    <section class="result-section" id="web-evidence" aria-labelledby="web-evidence-title">
      <h3 id="web-evidence-title">Web and DNS evidence</h3>

      {#if dnsEvidence.source==='dns'}
        <section class="dns-card evidence-card card" aria-labelledby="dns-title">
          <header class="section-head"><div><p class="eyebrow">Deep-scan evidence</p><h4 id="dns-title">DNS intelligence</h4></div><span class:partial={!dnsEvidence.complete}>{dnsEvidence.status}</span></header>
          <div class="dns-grid stat-grid">
            <article><small>DNSSEC</small><strong>{show(availability.dnssec)}</strong></article><article><small>A</small><strong>{dnsDisplay('a')}</strong></article><article><small>AAAA</small><strong>{dnsDisplay('aaaa')}</strong></article><article><small>CNAME</small><strong>{dnsDisplay('cname')}</strong></article><article><small>Nameservers</small><strong>{dnsDisplay('ns')}</strong></article><article><small>MX</small><strong>{dnsDisplay('mx')}</strong></article><article><small>SPF</small><strong>{dnsDisplay('spf')}</strong></article><article><small>DMARC</small><strong>{dnsDisplay('dmarc')}</strong></article><article><small>CAA</small><strong>{dnsDisplay('caa')}</strong></article>
          </div>
          {#if dnsQueryFailures()}<p class="callout warn dns-warning">Partial observation: {dnsQueryFailures()}. A resolver failure is not evidence that a record is absent.</p>{/if}
          <p class="card-note">Point-in-time resolver evidence. Shared DNS infrastructure can connect investigations but does not prove common ownership or maliciousness.{dnsEvidence.truncated?' Some record inventories were capped.':''}</p>
        </section>
      {/if}

      {#if httpEvidence.source==='http'}
        <section class="http-card evidence-card card" aria-labelledby="http-title">
          <header class="section-head"><div><p class="eyebrow">Deep-scan evidence</p><h4 id="http-title">HTTP intelligence</h4></div><span class:partial={!httpEvidence.complete}>{statusLabel(show(httpEvidence.status))}</span></header>
          <div class="http-grid stat-grid">
            <article><small>Final URL</small><strong>{show(httpEvidence.finalUrl||httpEvidence.requestUrl)}</strong></article>
            <article><small>Response</small><strong>{httpResponse.status?`HTTP ${httpResponse.status}`:'Not observed'}</strong></article>
            <article><small>Transport</small><strong>{httpEvidence.transportSecurity==='https'?'HTTPS':httpEvidence.transportSecurity==='http'?'Cleartext HTTP':'Not observed'}</strong></article>
            <article><small>Redirects</small><strong>{show(httpEvidence.redirectCount)}</strong></article>
            <article><small>Content type</small><strong>{show(httpResponse.contentType)}</strong></article>
            <article><small>Body captured</small><strong>{formatBytes(httpResponse.capturedBodyBytes)}{httpResponse.bodyTruncated?' · capped':''}</strong></article>
          </div>
          {#if httpEvidence.crossOriginRedirect||httpEvidence.httpsDowngrade}<div class="http-findings">{#if httpEvidence.crossOriginRedirect}<span class="chip warn">Cross-origin redirect</span>{/if}{#if httpEvidence.httpsDowngrade}<span class="chip danger">HTTPS downgrade</span>{/if}</div>{/if}
          {#if Array.isArray(httpEvidence.redirects)&&httpEvidence.redirects.length}<details class="http-detail disclosure"><summary>Redirect chain · {httpEvidence.redirects.length} hop{httpEvidence.redirects.length===1?'':'s'}</summary><ol>{#each httpEvidence.redirects as redirect}<li><span>HTTP {show(redirect.status)}</span><strong>{show(redirect.from)}</strong><b>→ {show(redirect.to)}</b>{#if redirect.queryOmitted}<small>Query omitted from retained provenance</small>{/if}</li>{/each}</ol></details>{/if}
          {#if httpEvidence.attempts?.some((attempt:JsonRecord)=>attempt.error)}<details class="http-detail disclosure"><summary>Connection attempts</summary><ul>{#each httpEvidence.attempts as attempt}<li><strong>{show(attempt.url)}</strong><span>{attempt.error||`HTTP ${show(attempt.httpStatus)}`}</span></li>{/each}</ul></details>{/if}
          {#if httpResponse.status}<details class="http-detail disclosure"><summary>Selected response metadata</summary><dl>{#each httpSecurityRows() as row}<dt>{row[0]}</dt><dd>{show(row[1])}</dd>{/each}<dt>Server</dt><dd>{show(httpResponse.server)}</dd><dt>Content language</dt><dd>{show(httpResponse.contentLanguage)}</dd><dt>Declared length</dt><dd>{httpResponse.declaredContentLength===null||httpResponse.declaredContentLength===undefined?'—':formatBytes(httpResponse.declaredContentLength)}</dd>{#if httpResponse.bodyHash}<dt>Body SHA-256</dt><dd class="http-hash">{show(httpResponse.bodyHash.value)}</dd><dt>Hash scope</dt><dd>{httpResponse.bodyHash.scope==='captured-prefix'?`Captured prefix (${formatBytes(httpResponse.bodyHash.bytes)})`:`Complete captured body (${formatBytes(httpResponse.bodyHash.bytes)})`}</dd>{/if}</dl></details>{/if}
          {#if httpEvidence.limitations?.length}<p class="callout warn">{httpEvidence.limitations.join(' ')}</p>{/if}
          <p class="card-note">Point-in-time response metadata from the homepage request already used for deep analysis. Redirects and headers provide context; missing security headers do not establish maliciousness.</p>
        </section>
      {/if}

      {#if tlsEvidence.source==='tls'}
        <section class="tls-card evidence-card card" aria-labelledby="tls-title">
          <header class="section-head"><div><p class="eyebrow">Deep-scan evidence</p><h4 id="tls-title">TLS and certificate intelligence</h4></div><span class:partial={!tlsEvidence.complete}>{statusLabel(show(tlsEvidence.status))}</span></header>
          <div class="tls-grid stat-grid">
            <article><small>Connected address</small><strong>{show(tlsEvidence.connectedAddress)}</strong></article>
            <article><small>SNI hostname</small><strong>{show(tlsEvidence.sniHost)}</strong></article>
            <article><small>Protocol</small><strong>{show(tlsEvidence.protocol)}</strong></article>
            <article><small>Cipher</small><strong>{show(tlsCipher.standardName||tlsCipher.name)}</strong></article>
            <article><small>ALPN</small><strong>{show(tlsEvidence.alpnProtocol)}</strong></article>
            <article><small>Chain trust</small><strong class:danger-text={tlsAuthorization.authorized===false}>{tlsTrust()}</strong></article>
            <article><small>Hostname</small><strong class:danger-text={tlsHostname.matches===false}>{tlsHostnameStatus()}</strong></article>
            <article><small>Validity</small><strong class:danger-text={tlsValidity.status==='expired'||tlsValidity.status==='not_yet_valid'}>{tlsValidityStatus()}</strong></article>
          </div>
          {#if Array.isArray(tlsEvidence.findings)&&tlsEvidence.findings.length}<ul class="finding-list tls-findings">{#each tlsEvidence.findings as finding}<li class="callout {finding.tone==='warning'?'warn':'info'}"><strong>{show(finding.label)}</strong><span>{show(finding.detail)}</span></li>{/each}</ul>{/if}
          {#if tlsCertificate.fingerprintSha256}
            <details class="tls-detail http-detail disclosure"><summary>Leaf certificate</summary><dl><dt>Subject</dt><dd>{tlsName(tlsSubject)}</dd><dt>Issuer</dt><dd>{tlsName(tlsIssuer)}</dd><dt>Serial number</dt><dd class="http-hash">{show(tlsCertificate.serialNumber)}</dd><dt>Valid from</dt><dd>{formatDate(tlsCertificate.validFrom)}</dd><dt>Valid to</dt><dd>{formatDate(tlsCertificate.validTo)}</dd><dt>Certificate SHA-256</dt><dd class="http-hash">{show(tlsCertificate.fingerprintSha256)}</dd><dt>Public key</dt><dd>{show(tlsPublicKey.type)}{tlsPublicKey.bits?` · ${tlsPublicKey.bits} bits`:''}{tlsPublicKey.curve?` · ${tlsPublicKey.curve}`:''}</dd>{#if tlsPublicKey.fingerprintSha256}<dt>Public-key SHA-256</dt><dd class="http-hash">{tlsPublicKey.fingerprintSha256}</dd>{/if}</dl></details>
          {/if}
          {#if (Array.isArray(tlsAltNames.dnsNames)&&tlsAltNames.dnsNames.length)||(Array.isArray(tlsAltNames.ipAddresses)&&tlsAltNames.ipAddresses.length)}
            <details class="tls-detail http-detail disclosure"><summary>Subject alternative names · {(tlsAltNames.dnsNames?.length||0)+(tlsAltNames.ipAddresses?.length||0)}{tlsAltNames.truncated?' · capped':''}</summary><ul>{#each tlsAltNames.dnsNames||[] as name}<li><strong>DNS</strong><b>{name}</b></li>{/each}{#each tlsAltNames.ipAddresses||[] as address}<li><strong>IP address</strong><b>{address}</b></li>{/each}</ul></details>
          {/if}
          {#if Array.isArray(tlsEvidence.chain)&&tlsEvidence.chain.length}
            <details class="tls-detail http-detail disclosure"><summary>Certificate chain · {tlsEvidence.chain.length}{tlsEvidence.chainTruncated?' · capped':''}</summary><ol>{#each tlsEvidence.chain as certificate,index}<li><strong>{index===0?'Leaf certificate':`Chain certificate ${index+1}`}</strong><b>{tlsName(rec(certificate.subject))}</b><small>{show(certificate.fingerprintSha256)}</small></li>{/each}</ol></details>
          {/if}
          {#if tlsDiagnostics.error||tlsAuthorization.error||tlsHostname.error}<details class="tls-detail http-detail disclosure"><summary>Collection and validation detail</summary><dl>{#if tlsDiagnostics.error}<dt>Collection</dt><dd>{tlsDiagnostics.error}</dd>{/if}{#if tlsAuthorization.error}<dt>Authorization</dt><dd>{tlsAuthorization.error}</dd>{/if}{#if tlsHostname.error}<dt>Hostname</dt><dd>{tlsHostname.error}</dd>{/if}</dl></details>{/if}
          {#if tlsEvidence.limitations?.length}<p class="callout warn">{tlsEvidence.limitations.join(' ')}</p>{/if}
          <p class="card-note">Point-in-time evidence from one connection to one validated public address. Trust and hostname findings describe this runtime observation; wildcard certificates and shared certificate infrastructure are not inherently suspicious.</p>
        </section>
      {/if}

      {#if pageIdentity.source==='html'}
        <section class="page-card evidence-card card" aria-labelledby="page-identity-title">
          <header class="section-head"><div><p class="eyebrow">Deep-scan evidence</p><h4 id="page-identity-title">Page identity</h4></div><span class:partial={!pageIdentity.complete}>{statusLabel(show(pageIdentity.status))}</span></header>
          <div class="page-grid stat-grid">
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
            <article><small>Resource references</small><strong>{show(pageResources.count)}{pageResources.truncated?' · capped':''}</strong></article>
            <article><small>External resources</small><strong>{Array.isArray(pageResources.externalOrigins)?pageResources.externalOrigins.length:'—'}</strong></article>
            <article><small>Embedded origins</small><strong>{Array.isArray(pageIdentity.embeddedOrigins)?pageIdentity.embeddedOrigins.length:'—'}</strong></article>
            <article><small>Contact domains</small><strong>{Array.isArray(pageIdentity.contactDomains)?pageIdentity.contactDomains.length:'—'}</strong></article>
            <article><small>Download links</small><strong>{show(pageDownloads.count)}{Number(pageDownloads.riskyCount)>0?` · ${pageDownloads.riskyCount} review`:''}</strong></article>
            <article><small>Tracking identifiers</small><strong>{Array.isArray(pageIdentity.trackingIdentifiers)?pageIdentity.trackingIdentifiers.length:'—'}</strong></article>
            <article><small>Page fingerprints</small><strong>{pageFingerprintRows().length}{pageFingerprints.truncated?' · partial':''}</strong></article>
          </div>
          {#if Array.isArray(pageForms.externalActionOrigins)&&pageForms.externalActionOrigins.length}
            <details class="page-detail disclosure"><summary>External form destinations · {pageForms.externalActionOrigins.length}</summary><ul>{#each pageForms.externalActionOrigins as origin}<li>{origin}</li>{/each}</ul></details>
          {/if}
          {#if Number(pageResources.count)>0}
            <details class="page-detail disclosure"><summary>Resource summary · {pageResources.count}</summary><dl>{#if pageResourceTypes.image}<dt>Images</dt><dd>{pageResourceTypes.image}</dd>{/if}{#if pageResourceTypes.script}<dt>Scripts</dt><dd>{pageResourceTypes.script}</dd>{/if}{#if pageResourceTypes.stylesheet}<dt>Stylesheets</dt><dd>{pageResourceTypes.stylesheet}</dd>{/if}{#if pageResourceTypes.link}<dt>Other links</dt><dd>{pageResourceTypes.link}</dd>{/if}{#if pageResourceTypes.frame}<dt>Frames</dt><dd>{pageResourceTypes.frame}</dd>{/if}{#if pageResourceTypes.media}<dt>Media</dt><dd>{pageResourceTypes.media}</dd>{/if}{#if pageResourceTypes.object}<dt>Objects</dt><dd>{pageResourceTypes.object}</dd>{/if}<dt>External origins</dt><dd>{Array.isArray(pageResources.externalOrigins)&&pageResources.externalOrigins.length?pageResources.externalOrigins.join(', '):'None observed'}</dd></dl></details>
          {/if}
          {#if Array.isArray(pageIdentity.embeddedOrigins)&&pageIdentity.embeddedOrigins.length}
            <details class="page-detail disclosure"><summary>Embedded origins · {pageIdentity.embeddedOrigins.length}</summary><ul>{#each pageIdentity.embeddedOrigins as origin}<li>{origin}</li>{/each}</ul></details>
          {/if}
          {#if Array.isArray(pageIdentity.contactDomains)&&pageIdentity.contactDomains.length}
            <details class="page-detail disclosure"><summary>Contact domains · {pageIdentity.contactDomains.length}</summary><ul>{#each pageIdentity.contactDomains as domain}<li>{domain}</li>{/each}</ul></details>
          {/if}
          {#if Number(pageDownloads.count)>0}
            <details class="page-detail disclosure"><summary>Download context · {pageDownloads.count}</summary><dl><dt>Explicit links</dt><dd>{show(pageDownloads.explicitCount)}</dd><dt>Review file types</dt><dd>{Array.isArray(pageDownloads.riskyFileTypes)&&pageDownloads.riskyFileTypes.length?pageDownloads.riskyFileTypes.join(', '):'None observed'}</dd><dt>External origins</dt><dd>{Array.isArray(pageDownloads.externalOrigins)&&pageDownloads.externalOrigins.length?pageDownloads.externalOrigins.join(', '):'None observed'}</dd></dl></details>
          {/if}
          {#if Array.isArray(pageIdentity.trackingIdentifiers)&&pageIdentity.trackingIdentifiers.length}
            <details class="page-detail disclosure"><summary>Tracking identifiers · {pageIdentity.trackingIdentifiers.length}</summary><ul>{#each pageIdentity.trackingIdentifiers as identifier}<li><strong>{trackingIdentifierLabel(identifier.type)}</strong><span>{show(identifier.value)}</span></li>{/each}</ul></details>
          {/if}
          {#if pageFingerprintRows().length}
            <details class="page-detail page-fingerprints disclosure"><summary>Page fingerprints · {pageFingerprintRows().length}</summary><dl>{#each pageFingerprintRows() as row}<dt>{row[0]}</dt><dd><code>{row[1]}</code>{#if row[2]}<small>{row[2]}</small>{/if}</dd>{/each}</dl><p>SHA-256 components support exact equality checks. Visible-text SimHash is fuzzy comparison data, not a cryptographic digest or proof of common ownership.</p></details>
          {/if}
          {#if pageIdentity.limitations?.length}<p class="callout warn">{pageIdentity.limitations.join(' ')}</p>{/if}
          <p class="card-note">Bounded metadata and versioned fingerprints from the static HTML already captured for this lookup. Resource and embedded locations retain origins only; contact links retain domains only; download paths, URL queries, normalized markup, and visible text are not retained. These fields provide comparison and review context rather than proof of ownership or maliciousness.</p>
        </section>
      {/if}

      {#if pageComparison}
        <section class="page-comparison evidence-card card" aria-labelledby="page-comparison-title">
          <header class="section-head"><div><p class="eyebrow">Active Brand Profile</p><h4 id="page-comparison-title">Official-site comparison</h4></div><span class:partial={pageComparison.partial}>{pageComparison.partial?'Partial evidence':'Comparable captures'}</span></header>
          <p class="comparison-context">Comparing this capture with the bounded baseline for <strong>{pageComparison.reference.domain}</strong>, observed <time datetime={pageComparison.reference.observedAt}>{formatDate(pageComparison.reference.observedAt)}</time>.</p>
          <div class="page-comparison-grid">
            {#each pageComparison.components as item}
              <article class={`comparison-${item.status}`}>
                <div><small>{item.label}</small><span>{item.method}</span></div>
                <strong>{item.outcome}</strong>
                <p>{item.detail}</p>
                {#if Array.isArray(item.sharedValues)&&item.sharedValues.length}<p class="shared-values">Shared: {item.sharedValues.join(', ')}</p>{/if}
              </article>
            {/each}
          </div>
          <p class="callout warn page-comparison-note">Each component stands on its own. WHOISleuth does not combine these observations into a page-similarity score or use them to change the Risk score. Matches can arise from shared templates, providers, libraries, or analytics, and do not prove common ownership, copying, intent, or maliciousness.</p>
        </section>
      {:else if profile?.pageBaseline && result.type==='domain'}
        <section class="page-comparison unavailable-comparison evidence-card card" aria-labelledby="page-comparison-title">
          <header class="section-head"><div><p class="eyebrow">Active Brand Profile</p><h4 id="page-comparison-title">Official-site comparison</h4></div><span class="partial">Unavailable</span></header>
          <p class="card-note">No current compatible page fingerprint was captured, so the saved official-site baseline cannot be compared with this result. This does not indicate that the pages differ.</p>
        </section>
      {/if}
    </section>
    {/if}

    <section class="result-section" id="registry" aria-labelledby="registry-title">
      <h3 id="registry-title">Registry sources</h3>

      {#if comparison.fields.length}
        <details class="comparison card" open={comparison.counts.conflict>0}>
          <summary>RDAP / WHOIS comparison · {comparison.counts.conflict} conflicts · {sourceOnlyCount} source-only · {redactedComparisonCount} redacted · {limitedComparisonCount} unavailable/incomplete · {comparison.counts.equivalent} equivalent</summary>
          <div class="table-wrap"><table><thead><tr><th>Field</th><th>RDAP</th><th>WHOIS</th><th>Assessment</th></tr></thead><tbody>{#each comparison.fields as field}<tr class:conflict={field.status==='conflict'}><th scope="row">{field.label}</th><td>{field.rdapDisplay}</td><td>{field.whoisDisplay}</td><td><span class="chip {field.status==='conflict'?'danger':field.status==='equivalent'?'good':['rdap_unavailable','whois_unavailable','rdap_incomplete','whois_incomplete'].includes(field.status)?'warn':''}">{assessment(field.status)}</span></td></tr>{/each}</tbody></table></div>
        </details>
      {/if}

      <div class="sources">
        <details class="card" open><summary>RDAP structured data</summary>{#if rdap.error}<p class="error source-error">{rdap.error}</p>{:else}
          {#if result.type==='domain'}
            <RdapDomainSource parsed={rdapParsed} source="Registry" />
          {:else}
            {#if rdapParsed.serverTruncated}<p class="callout warn source-partial"><strong>Server-declared partial response.</strong> The registry reported that some RDAP data was omitted.{Array.isArray(rdapParsed.serverTruncationReasons)&&rdapParsed.serverTruncationReasons.length?` ${rdapParsed.serverTruncationReasons.join(' · ')}.`:''}</p>{/if}
            <dl>
            {#if result.type==='ipv4'||result.type==='ipv6'}
              <dt>Handle</dt><dd>{show(rdapParsed.handle)}</dd><dt>Name</dt><dd>{show(rdapParsed.name)}</dd><dt>Range</dt><dd>{show(rdapParsed.startAddress)} – {show(rdapParsed.endAddress)}</dd><dt>CIDRs</dt><dd>{show(rdapParsed.cidrs)}{rdapParsed.cidrsTruncated?' (capped)':''}</dd><dt>Country</dt><dd>{show(rdapParsed.country)}</dd><dt>Type</dt><dd>{show(rdapParsed.networkType)}</dd><dt>Status</dt><dd>{show(rdapParsed.statuses)}{rdapParsed.statusesTruncated?' (capped)':''}</dd><dt>Registered</dt><dd><time datetime={dateTimeAttribute(rdapParsed.lifecycle?.createdDate)}>{formatDate(rdapParsed.lifecycle?.createdDate)}</time></dd><dt>Updated</dt><dd><time datetime={dateTimeAttribute(rdapParsed.lifecycle?.updatedDate)}>{formatDate(rdapParsed.lifecycle?.updatedDate)}</time></dd>
            {:else if result.type==='asn'}
              <dt>Handle</dt><dd>{show(rdapParsed.handle)}</dd><dt>Name</dt><dd>{show(rdapParsed.name)}</dd><dt>AS range</dt><dd>{show(rdapParsed.startAutnum)} – {show(rdapParsed.endAutnum)}</dd><dt>Country</dt><dd>{show(rdapParsed.country)}</dd><dt>Type</dt><dd>{show(rdapParsed.autnumType)}</dd><dt>Status</dt><dd>{show(rdapParsed.statuses)}{rdapParsed.statusesTruncated?' (capped)':''}</dd><dt>Registered</dt><dd><time datetime={dateTimeAttribute(rdapParsed.lifecycle?.createdDate)}>{formatDate(rdapParsed.lifecycle?.createdDate)}</time></dd><dt>Updated</dt><dd><time datetime={dateTimeAttribute(rdapParsed.lifecycle?.updatedDate)}>{formatDate(rdapParsed.lifecycle?.updatedDate)}</time></dd>
            {/if}
            <dt>Object class</dt><dd>{show(rdapParsed.objectClassName)}</dd><dt>Language</dt><dd>{show(rdapParsed.language)}</dd><dt>Conformance</dt><dd>{show(rdapParsed.conformance)}{rdapParsed.conformanceTruncated?' (capped)':''}</dd><dt>Lifecycle events</dt><dd>{Array.isArray(rdapParsed.events)?rdapParsed.events.length:0}{rdapParsed.eventsTruncated?' (capped)':''}</dd><dt>RDAP database updated</dt><dd>{formatDate(rdapParsed.lifecycle?.databaseUpdatedDate)}</dd><dt>Port 43</dt><dd>{show(rdapParsed.port43)}</dd><dt>Parent handle</dt><dd>{show(rdapParsed.parentHandle)}</dd>
            </dl>
          {/if}
        {/if}</details>
        <details class="card" open><summary>WHOIS structured data</summary>{#if whois.error}<p class="error source-error">{whois.error}</p>{:else}<dl><dt>Domain</dt><dd>{show(whoisParsed.domainName)}</dd><dt>Registry ID</dt><dd>{show(whoisParsed.registryDomainId)}</dd><dt>Registrar</dt><dd>{show(whoisParsed.registrar)}</dd><dt>Registrar ID</dt><dd>{show(whoisParsed.registrarIanaId)}</dd><dt>Registrar WHOIS</dt><dd>{show(whoisParsed.registrarWhoisServer)}</dd><dt>Reseller</dt><dd>{show(whoisParsed.reseller)}</dd><dt>Created</dt><dd>{formatDate(whoisParsed.lifecycle?.createdDate)}</dd><dt>Expires</dt><dd>{formatDate(whoisParsed.lifecycle?.expiryDate)}</dd><dt>Updated</dt><dd>{formatDate(whoisParsed.lifecycle?.updatedDate)}</dd><dt>DNSSEC</dt><dd>{show(whoisParsed.dnssec)}</dd><dt>Status</dt><dd>{show(whoisParsed.statuses)}</dd><dt>Nameservers</dt><dd>{show(whoisParsed.nameservers)}</dd><dt>Chain</dt><dd>{show(whoisParsed.chainStatus)}</dd></dl>{#if populatedWhoisRoles.length}<details class="contact-inventory disclosure"><summary>Published contacts · {populatedWhoisRoles.length} role{populatedWhoisRoles.length===1?'':'s'}{whoisParsed.fieldsTruncated?.length?' · capped':''}</summary><div>{#if whoisParsed.fieldsTruncated?.length}<p class="callout warn">Some WHOIS fields exceeded local display limits: {whoisParsed.fieldsTruncated.join(', ')}. Review the raw response or exported evidence for the complete upstream text.</p>{/if}{#each populatedWhoisRoles as role}<section><h5>{role}</h5>{#each whoisParsed.contactsByRole[role] as contact}<article><strong>{contactIdentity(contact)}</strong>{#each contactDetails(contact) as detail}<span>{detail}</span>{/each}</article>{/each}</section>{/each}</div></details>{/if}{/if}</details>
      </div>
      {#if registrarRdap.status}
        <details class="registrar-rdap card">
          <summary>Registrar RDAP · {diagnosticLabel(registrarRdap)}</summary>
          <div class="registrar-provenance">
            {#if registrarRdap.endpoint}<strong>{registrarRdap.endpoint}</strong>{/if}
            <span>{[registrarRdap.upstreamStatus?`HTTP ${registrarRdap.upstreamStatus}`:null,registrarRdap.fetchedAt?`Fetched ${formatDate(registrarRdap.fetchedAt)}`:null].filter(Boolean).join(' · ')}</span>
            <p>Published by the sponsoring registrar's RDAP service, not the registry. Registrar-published contacts are relationship evidence, not proof of ownership.</p>
          </div>
          {#if registrarRdap.status==='success'}
            <RdapDomainSource parsed={registrarRdapParsed} source="Registrar" />
          {:else}
            <p class:error={registrarRdap.status==='error'} class="registrar-state">{show(registrarRdap.detail)}</p>
          {/if}
        </details>
      {/if}
    </section>

    {#if threatIntelligenceProviders.length}
      <section class="result-section" id="external-intelligence" aria-labelledby="external-intelligence-title">
        <h3 id="external-intelligence-title">External intelligence</h3>
        <section class="threat-intelligence evidence-card card" aria-labelledby="threat-intelligence-title">
          <header class="section-head"><div><p class="eyebrow">External intelligence</p><h4 id="threat-intelligence-title">Archived provider verdicts</h4></div><span>Separately attributed</span></header>
          <p class="card-note">These are bounded third-party observations, not proof that the domain is safe, malicious, active, or controlled by any party. They never affect availability. A lone publisher contributes no Risk points; only qualifying records corroborated across at least two independent publisher families can add one bounded, explainable factor.</p>
          {#if externalRiskContext.eligibleProviderCount}
            <p class="callout warn external-risk-context">
              {#if externalRiskContext.contribution}
                Risk context: {externalRiskContext.independentPublisherCount} independent publisher families contributed +{externalRiskContext.contribution} under model v{risk?.modelVersion??'—'}.
              {:else}
                Risk context: {externalRiskContext.eligibleProviderCount} qualifying provider observation{externalRiskContext.eligibleProviderCount===1?'':'s'} represented {externalRiskContext.independentPublisherCount} publisher family; no points were added because independent corroboration was absent.
              {/if}
              {#if externalRiskContext.freshestAgeDays!==null} Newest qualifying record age: {externalRiskContext.freshestAgeDays} day{externalRiskContext.freshestAgeDays===1?'':'s'}.{/if}
              {#if externalRiskContext.unknownAgeProviderCount} {externalRiskContext.unknownAgeProviderCount} qualifying provider observation{externalRiskContext.unknownAgeProviderCount===1?' has':'s have'} unknown age.{/if}
            </p>
          {/if}
          {#each threatIntelligenceProviders as provider}
            {@const providerIdentity=rec(provider.provider)}
            {@const providerObservation=rec(provider.observation)}
            {@const findings=Array.isArray(provider.findings)?provider.findings.map(rec):[]}
            <article>
              <div class="threat-source"><strong>{show(providerIdentity.label)}</strong><span class="chip {provider.state==='error'||provider.state==='unavailable'||provider.state==='rate_limited'?'danger':provider.state==='success'?'info':''}">{show(provider.state)}</span></div>
              {#if provider.detail}<p>{show(provider.detail)}</p>{/if}
              {#if findings.length}<ul>{#each findings as finding}<li class="callout warn"><div><strong>{show(finding.category)}</strong><span>{[finding.providerVerdict,finding.lastObservedAt?formatDate(finding.lastObservedAt):null].filter(Boolean).join(' · ')}</span></div>{#if finding.detail}<p>{show(finding.detail)}</p>{/if}{#if finding.referenceUrl}<a href={finding.referenceUrl} target="_blank" rel="noopener">View attributed provider record</a>{/if}</li>{/each}</ul>{/if}
              {#if Array.isArray(providerObservation.limitations)&&providerObservation.limitations.length}<details class="disclosure"><summary>Limitations</summary><ul class="limitation-list">{#each providerObservation.limitations as limitation}<li>{show(limitation)}</li>{/each}</ul></details>{/if}
            </article>
          {/each}
        </section>
      </section>
    {/if}

    {#if hasCaseSection}
      <section class="result-section" id="case-response" aria-labelledby="case-response-title">
        <h3 id="case-response-title">Case and response</h3>

        {#if caseDomain}
          <section class="case-card evidence-card card">
            <div class="case-intro section-head"><div><p class="eyebrow">Investigation</p><h4>Analyst case</h4></div>{#if caseRecord}<div class="case-badges"><span class={`badge status-${caseRecord.status}`}>{caseStatusLabel(caseRecord.status)}</span><span class={`badge disposition-${caseRecord.disposition}`}>{caseDispositionLabel(caseRecord.disposition)}</span></div>{/if}</div>
            {#if caseRecord}
              <div class="case-body">
                <form class="note-edit" onsubmit={(event)=>{event.preventDefault();addLookupNote();}}>
                  <label class="field" for="case-note">Add note</label>
                  <textarea id="case-note" bind:value={caseNote} rows="2" placeholder="Observed behaviour, evidence, decisions…"></textarea>
                  <div class="case-actions"><button class="btn" type="submit" disabled={!caseNote.trim()}>Add note</button><a href={`/monitor?case=${encodeURIComponent(caseRecord.id)}`}>Open in Monitor →</a></div>
                </form>
                <p class="case-hint">{caseRecord.notes.length} note{caseRecord.notes.length===1?'':'s'} · manage status, disposition, and tags in Monitor. Cases are stored only in this browser.</p>
              </div>
            {:else}
              <div class="case-body"><p class="case-hint">No case for {caseDomain} yet.</p><button class="primary" onclick={openLookupCase}>Create case</button></div>
            {/if}
            {#if caseStatus}<p class="case-status" role="status" aria-live="polite">{caseStatus}</p>{/if}
          </section>
        {/if}

        {#if outreach||abuse}<section class="response evidence-card card"><div class="section-head"><div><p class="eyebrow">Respond</p><h4>Human-reviewed drafts</h4></div></div><p class="card-note">Nothing is sent automatically. Review and edit every message before sending it.</p><div class="response-actions">{#if outreach}<article><strong>Acquisition outreach</strong><span>{outreach.email}</span><div><a class="btn small" href={outreach.mailto}>Open email draft</a><button class="btn small" onclick={()=>copyDraft(outreach.body,'outreach draft')}>Copy text</button></div></article>{/if}{#if abuse}<article><strong>Abuse report</strong><span>{abuse.email}</span><div><a class="btn small danger" href={abuse.mailto}>Open report draft</a><button class="btn small" onclick={()=>copyDraft(abuse.body,'abuse report')}>Copy text</button></div></article>{/if}</div>{#if draftStatus}<p class="draft-status" aria-live="polite">{draftStatus}</p>{/if}</section>{/if}
      </section>
    {/if}

    <section class="result-section" id="raw-data" aria-labelledby="raw-data-title">
      <h3 id="raw-data-title">Raw evidence</h3>
      <details class="raw card"><summary>Raw unified response</summary><pre>{JSON.stringify(result,null,2)}</pre></details>
    </section>
  </section>
{/if}

<style>
  .result-root{min-width:0;overflow-x:clip;overflow-clip-margin:3px}
  .search{padding:var(--card-pad)}
  .search-label{display:block;margin-bottom:9px;font:700 var(--text-sm) var(--mono)}
  .input-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px}
  .query-field{position:relative;min-width:0}
  .query-field textarea{display:block;width:100%;min-height:54px;padding:14px 48px 10px 12px;background:rgba(15,17,21,.78);font-family:var(--mono);font-size:var(--text-sm)}
  .clear{position:absolute;right:7px;top:9px;width:34px;height:34px;border:0;background:none;font-size:1.25rem}
  .input-help{margin:8px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .intelligence-options{margin:14px 0 0;padding:12px 14px 14px;border:1px solid var(--border);border-radius:var(--radius-md)}
  .intelligence-options legend{padding:0 6px;color:var(--text);font:700 var(--text-xs) var(--mono)}
  .intelligence-hint{margin:0 0 10px;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .intelligence-option{margin:8px 0 0}
  .intelligence-option span{color:var(--muted)}

  .result-head{display:flex;align-items:end;justify-content:space-between;gap:12px 20px;margin:30px 0 0}
  .result-head h2{margin:0;font:700 clamp(1.5rem,3.4vw,2rem) var(--mono);letter-spacing:-.03em;overflow-wrap:anywhere}
  .result-head p{margin:6px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .result-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
  .result-actions .chip{text-transform:capitalize;font-size:var(--text-xs)}

  .result-section{margin-top:26px}
  .result-section>h3{display:flex;align-items:center;gap:10px;margin:0 0 12px;color:var(--accent2);font:700 var(--text-2xs) var(--mono);letter-spacing:.09em;text-transform:uppercase}
  .result-section>h3::before{content:"//";color:var(--muted)}
  .result-section>h3::after{content:"";flex:1;height:1px;background:var(--border)}
  .result-section>.card,.result-section>.stat-grid,.result-section>.sources,.result-section>.registrar-rdap{margin-top:12px}
  .result-section>:nth-child(2){margin-top:0}

  .evidence-card{padding:var(--card-pad)}
  .evidence-card .section-head p:not(.eyebrow){margin:4px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .evidence-card .stat-grid{margin-top:14px}
  .card-note{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}

  .availability{padding:var(--card-pad)}
  .availability h4{margin:0;font-size:1.05rem}
  .scores{display:flex;gap:9px}
  .score{display:grid;grid-template-columns:1fr auto;gap:3px;width:150px;padding:9px 10px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .score span{font:600 var(--text-2xs) var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
  .score strong{font-size:1.05rem}
  .score i{grid-column:1/-1;height:5px;overflow:hidden;border-radius:99px;background:var(--border)}
  .score b{display:block;height:100%;background:var(--accent)}
  .score.danger b{background:var(--danger)}
  .score.warn b{background:var(--amber)}
  .signals{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}
  .signals .chip{white-space:normal}
  .score-details{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
  .score-details details{margin-top:0}
  .score-details ul{display:grid;gap:6px;margin:10px 12px;padding:0;list-style:none}
  .score-details li{display:flex;justify-content:space-between;gap:10px;color:var(--muted);font-size:var(--text-xs)}
  .score-details li strong{color:var(--text)}

  .diagnostics strong{text-transform:capitalize;color:var(--accent)}
  .diagnostics .error-state{color:var(--danger)}
  .diagnostics .limited-state{color:var(--amber)}

  .finding-list{display:grid;gap:7px;margin:12px 0 0;padding:0;list-style:none}
  .finding-list .callout{margin:0}
  .finding-list strong{display:block;color:var(--text);font-size:var(--text-xs)}
  .finding-list span{display:block;margin-top:3px}

  .http-findings{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .evidence-card .disclosure ol,.evidence-card .disclosure ul{display:grid;gap:7px;margin:10px 12px;padding-left:18px}
  .evidence-card .disclosure li{font-size:var(--text-xs);overflow-wrap:anywhere}
  .evidence-card .disclosure li strong,.evidence-card .disclosure li b,.evidence-card .disclosure li small{display:block;margin-top:2px;font-weight:400}
  .evidence-card .disclosure li b,.evidence-card .disclosure li small{color:var(--muted)}
  .evidence-card .disclosure dl{display:grid;grid-template-columns:minmax(130px,190px) 1fr;gap:8px;margin:10px 12px;padding:0;font-size:var(--text-xs)}
  .evidence-card .disclosure dd{min-width:0;margin:0;overflow-wrap:anywhere}
  .http-hash{overflow-wrap:anywhere;font-family:var(--mono)}
  .tls-grid .danger-text,.page-grid .danger-text{color:var(--danger)}

  .page-fingerprints code{display:block;overflow-wrap:anywhere;color:var(--accent);font-size:var(--text-2xs)}
  .page-fingerprints dd small{display:block;margin-top:3px;color:var(--muted)}
  .page-fingerprints>p{margin:10px 12px;color:var(--muted);font-size:var(--text-xs)}

  .comparison-context{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .comparison-context strong{color:var(--text)}
  .page-comparison-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;margin-top:13px}
  .page-comparison-grid article{min-width:0;padding:11px 12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .page-comparison-grid article.comparison-same{border-color:rgba(126,224,168,.3)}
  .page-comparison-grid article.comparison-overlap{border-color:rgba(242,184,75,.35)}
  .page-comparison-grid article>div{display:flex;align-items:start;justify-content:space-between;gap:8px}
  .page-comparison-grid small{color:var(--muted);font:600 var(--text-2xs) var(--mono);text-transform:uppercase;letter-spacing:.05em}
  .page-comparison-grid article>div>span{color:var(--muted);font-size:var(--text-2xs);text-align:right}
  .page-comparison-grid strong{display:block;margin-top:7px;font-size:var(--text-sm);overflow-wrap:anywhere}
  .page-comparison-grid .comparison-same strong{color:var(--accent2)}
  .page-comparison-grid .comparison-overlap strong{color:var(--amber)}
  .page-comparison-grid p{margin:5px 0 0;color:var(--muted);font-size:var(--text-xs);overflow-wrap:anywhere}
  .page-comparison-grid .shared-values{color:var(--text)}

  .case-badges{display:flex;flex-wrap:wrap;gap:6px}
  .badge.status-escalated,.badge.disposition-confirmed_abuse{color:var(--danger);border-color:rgba(255,107,107,.4)}
  .badge.status-resolved,.badge.disposition-false_positive,.badge.disposition-expected{color:var(--accent2)}
  .badge.disposition-suspicious{color:var(--amber)}
  .case-body{margin-top:12px}
  .note-edit textarea{width:100%;margin-top:6px;font-size:var(--text-sm)}
  .case-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:10px}
  .case-actions a{color:var(--accent);font:600 var(--text-xs) var(--mono)}
  .case-body>.primary{margin-top:10px}
  .case-hint,.case-status{margin:10px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .case-status{color:var(--accent)}

  .response-actions{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px;margin-top:12px}
  .response-actions article{padding:13px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .response-actions strong,.response-actions span{display:block}
  .response-actions strong{font-size:var(--text-sm)}
  .response-actions span{margin-top:5px;color:var(--muted);font-size:var(--text-xs);overflow-wrap:anywhere}
  .response-actions article>div{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px}
  .draft-status{margin:10px 0 0;color:var(--accent);font-size:var(--text-xs)}

  .comparison,.sources>details,.registrar-rdap,.raw{padding:0;overflow:hidden}
  .comparison .table-wrap{border-top:1px solid var(--border)}
  .comparison tr.conflict{background:rgba(255,107,107,.03)}
  .comparison .chip{white-space:normal}
  .sources{display:grid;gap:12px}
  dl{display:grid;grid-template-columns:110px 1fr;gap:9px;margin:0;padding:4px var(--card-pad) var(--card-pad);font-size:var(--text-xs)}
  dd{margin:0;overflow-wrap:anywhere}
  .source-error{padding:0 var(--card-pad) var(--card-pad)}
  .source-partial{margin:0 var(--card-pad) 14px}
  .contact-inventory{margin:0 var(--card-pad) var(--card-pad)}
  .contact-inventory>div{display:grid;gap:9px;margin:11px 12px}
  .contact-inventory>div>.callout{margin:0}
  .contact-inventory section{min-width:0}
  .contact-inventory h5{margin:0 0 5px;color:var(--muted);font:600 var(--text-2xs) var(--mono);text-transform:uppercase;letter-spacing:.05em}
  .contact-inventory article{padding:9px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .contact-inventory strong,.contact-inventory span{display:block;overflow-wrap:anywhere}
  .contact-inventory strong{font-size:var(--text-xs)}
  .contact-inventory span{margin-top:4px;color:var(--muted);font-size:var(--text-xs)}

  .registrar-provenance{display:grid;gap:5px;padding:0 var(--card-pad) 14px;font-size:var(--text-xs)}
  .registrar-provenance strong,.registrar-provenance span,.registrar-provenance p{overflow-wrap:anywhere}
  .registrar-provenance strong{font-family:var(--mono)}
  .registrar-provenance span,.registrar-provenance p{color:var(--muted)}
  .registrar-provenance p{margin:4px 0 0;line-height:1.5}
  .registrar-state{margin:0;padding:0 var(--card-pad) var(--card-pad);color:var(--muted);font-size:var(--text-xs)}
  .registrar-state.error{color:var(--danger)}

  .threat-intelligence>article{margin-top:12px;padding:13px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .threat-source{display:flex;justify-content:space-between;gap:10px;align-items:start}
  .threat-source strong{font-size:var(--text-sm)}
  .threat-source .chip{text-transform:capitalize}
  .threat-intelligence article>p{margin:8px 0 0;color:var(--muted);font-size:var(--text-xs);overflow-wrap:anywhere}
  .threat-intelligence article ul{display:grid;gap:8px;margin:10px 0 0;padding:0;list-style:none}
  .threat-intelligence li.callout{margin:0;overflow-wrap:anywhere}
  .threat-intelligence li>div{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 10px}
  .threat-intelligence li>div strong{color:var(--text);font-size:var(--text-xs)}
  .threat-intelligence li span{color:var(--muted);font-size:var(--text-2xs)}
  .threat-intelligence li p{margin:5px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .threat-intelligence li a{display:inline-block;margin-top:6px;color:var(--accent);font-size:var(--text-xs);text-decoration:underline}
  .limitation-list li{color:var(--muted);font-size:var(--text-xs)}

  .raw pre{max-height:520px;overflow:auto;margin:0;padding:var(--card-pad);border-top:1px solid var(--border);font-size:var(--text-xs)}

  @media(max-width:900px){
    .availability .section-head{display:block}
    .scores{margin-top:12px}
  }
  @media(max-width:650px){
    .input-row,.score-details{grid-template-columns:1fr}
    .input-row .primary{min-height:44px}
    .result-head{align-items:flex-start;flex-direction:column}
    .result-actions{width:100%}
    .scores{display:grid;grid-template-columns:1fr 1fr}
    .score{width:auto}
    .evidence-card .disclosure dl{grid-template-columns:1fr;gap:4px}
    .evidence-card .disclosure dt{margin-top:6px}
    dl{grid-template-columns:1fr;gap:4px}
    dt:not(:first-child){margin-top:7px}
    .threat-source{flex-direction:column;gap:6px}
  }
</style>
