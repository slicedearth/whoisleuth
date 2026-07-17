<script lang="ts">
  import { goto } from '$app/navigation';
  import { getContext, onMount } from 'svelte';
  import { page } from '$app/state';
  import LocalSectionNav from '$lib/components/LocalSectionNav.svelte';
  import LookupAssessment from '$lib/components/LookupAssessment.svelte';
  import LookupDnsEvidence from '$lib/components/LookupDnsEvidence.svelte';
  import LookupExternalIntelligence from '$lib/components/LookupExternalIntelligence.svelte';
  import LookupForm from '$lib/components/LookupForm.svelte';
  import LookupHttpEvidence from '$lib/components/LookupHttpEvidence.svelte';
  import LookupOverviewFacts from '$lib/components/LookupOverviewFacts.svelte';
  import LookupPageComparison from '$lib/components/LookupPageComparison.svelte';
  import LookupPageIdentity from '$lib/components/LookupPageIdentity.svelte';
  import LookupRegistrySources from '$lib/components/LookupRegistrySources.svelte';
  import LookupResultHeader from '$lib/components/LookupResultHeader.svelte';
  import LookupTlsEvidence from '$lib/components/LookupTlsEvidence.svelte';
  import RegistryAccessNotice from '$lib/components/RegistryAccessNotice.svelte';
  import LookupCaseResponse from '$lib/components/LookupCaseResponse.svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
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
  import { compareRdapPublications, compareRegistrySources } from '$lib/analysis/registry-comparison.js';
  import { entityDisplayName, parseDomainInput } from '$lib/analysis/utils.js';
  import { CAPABILITY_CONTEXT, disabledCapabilities, disabledCapability, featureCapability, type CapabilityGetter } from '$lib/capabilities';
  import {
    explainOpportunityScore,
    explainRiskScore,
    fmtAge,
    fmtExpiresIn,
    formatActivityCell,
    formatPrivacyCell,
  } from '$lib/analysis/scoring.js';

  type JsonRecord = Record<string, any>;
  type SourceStatus = { status?: string; errorCode?: string|null; endpoint?: string|null; transportSecurity?: string|null; httpStatus?: number|null; fetchedAt?: string|null; queriedAt?: string|null; authoritativeHop?: string|null; failedHop?: string|null; conflictingHop?: string|null; resultState?: string|null; attempts?:Array<{outcome?:string}> };
  type ScoreExplanation = { modelVersion?:number; score:number; factors:Array<{label:string;delta:number}> }|null;
  type ComparisonField = { label:string; status:string; rdapDisplay:string; whoisDisplay:string };
  type RdapPublicationField = { label:string; status:string; registryDisplay:string; registrarDisplay:string };

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
  const registryAccess=$derived(rec(diagnostics.registryAccess));
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
  const registrarPublicationComparison=$derived(result?.type==='domain'?compareRdapPublications(rdapParsed,registrarRdapParsed,{registryStatus:diagnostics.rdap?.status,registrarStatus:registrarRdap.status}):{fields:[],counts:{equivalent:0,conflict:0,registry_only:0,registrar_only:0,registry_redacted:0,registrar_redacted:0,registry_unavailable:0,registrar_unavailable:0,registry_incomplete:0,registrar_incomplete:0}});
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
  function stringList(value:any){return Array.isArray(value)?value.map((item)=>String(item)):[];}
  function pageIdentityFactRows(){return[
    {label:'Document language',value:show(pageIdentity.documentLanguage)},
    {label:'Canonical URL',value:show(pageCanonical.url)},
    {label:'Meta refresh target',value:show(pageMetaRefresh.url)},
    {label:'Open Graph title',value:show(pageOpenGraph.title)},
    {label:'Open Graph site',value:show(pageOpenGraph.siteName)},
    {label:'Open Graph URL',value:show(pageOpenGraphUrl.url)},
    {label:'Generator',value:show(pageIdentity.generator)},
    {label:'Forms observed',value:`${show(pageForms.count)}${pageForms.truncated?' · capped':''}`},
    {label:'POST forms',value:show(pageForms.postCount)},
    {label:'Insecure actions',value:show(pageForms.insecureActionCount),danger:Number(pageForms.insecureActionCount)>0},
    {label:'Resource references',value:`${show(pageResources.count)}${pageResources.truncated?' · capped':''}`},
    {label:'External resources',value:Array.isArray(pageResources.externalOrigins)?String(pageResources.externalOrigins.length):'—'},
    {label:'Embedded origins',value:Array.isArray(pageIdentity.embeddedOrigins)?String(pageIdentity.embeddedOrigins.length):'—'},
    {label:'Contact domains',value:Array.isArray(pageIdentity.contactDomains)?String(pageIdentity.contactDomains.length):'—'},
    {label:'Download links',value:`${show(pageDownloads.count)}${Number(pageDownloads.riskyCount)>0?` · ${pageDownloads.riskyCount} review`:''}`},
    {label:'Tracking identifiers',value:Array.isArray(pageIdentity.trackingIdentifiers)?String(pageIdentity.trackingIdentifiers.length):'—'},
    {label:'Page fingerprints',value:`${pageFingerprintRows().length}${pageFingerprints.truncated?' · partial':''}`},
  ];}
  function pageResourceSummaryRows(){return[
    ['Images',pageResourceTypes.image],
    ['Scripts',pageResourceTypes.script],
    ['Stylesheets',pageResourceTypes.stylesheet],
    ['Other links',pageResourceTypes.link],
    ['Frames',pageResourceTypes.frame],
    ['Media',pageResourceTypes.media],
    ['Objects',pageResourceTypes.object],
  ].filter(([,value])=>Boolean(value)).map(([label,value])=>({label:String(label),value:show(value)})).concat({label:'External origins',value:stringList(pageResources.externalOrigins).join(', ')||'None observed'});}
  function pageDownloadSummaryRows(){return[
    {label:'Explicit links',value:show(pageDownloads.explicitCount)},
    {label:'Review file types',value:stringList(pageDownloads.riskyFileTypes).join(', ')||'None observed'},
    {label:'External origins',value:stringList(pageDownloads.externalOrigins).join(', ')||'None observed'},
  ];}
  function pageTrackingIdentifierRows(){return Array.isArray(pageIdentity.trackingIdentifiers)?pageIdentity.trackingIdentifiers.map((identifier:any)=>({label:trackingIdentifierLabel(identifier?.type),value:show(identifier?.value)})):[];}
  function pageFingerprintRows(){return[
    {label:'Exact captured body',value:rec(pageFingerprints.exact).value,detail:rec(pageFingerprints.exact).scope==='captured-prefix'?'Captured prefix':'Complete captured body'},
    {label:'Normalized HTML',value:rec(pageFingerprints.normalizedHtml).value,detail:`${show(rec(pageFingerprints.normalizedHtml).tokenCount)} tokens`},
    {label:'Visible text',value:rec(pageFingerprints.visibleText).value,detail:rec(pageFingerprints.visibleText).value?`${show(rec(pageFingerprints.visibleText).tokenCount)} tokens · fuzzy SimHash`:null},
    {label:'Static tag structure',value:rec(pageFingerprints.domStructure).value,detail:`${show(rec(pageFingerprints.domStructure).nodeCount)} nodes`},
    {label:'Form structure',value:rec(pageFingerprints.formStructure).value,detail:rec(pageFingerprints.formStructure).value?`${show(rec(pageFingerprints.formStructure).formCount)} forms · ${show(rec(pageFingerprints.formStructure).controlCount)} controls`:null},
    {label:'External resource hosts',value:rec(pageFingerprints.resourceHosts).value,detail:rec(pageFingerprints.resourceHosts).value?`${Array.isArray(rec(pageFingerprints.resourceHosts).values)?rec(pageFingerprints.resourceHosts).values.length:0} hosts`:null},
    {label:'Tracking identifiers',value:rec(pageFingerprints.identifiers).value,detail:rec(pageFingerprints.identifiers).value?`${Array.isArray(rec(pageFingerprints.identifiers).values)?rec(pageFingerprints.identifiers).values.length:0} identifiers`:null}
  ].filter((row)=>row.value).map((row)=>({...row,value:String(row.value)}));}
  function pageComparisonDisplay(){if(!pageComparison)return null;return{
    partial:Boolean(pageComparison.partial),
    referenceDomain:String(pageComparison.reference.domain),
    referenceObservedAt:String(pageComparison.reference.observedAt),
    referenceObservedLabel:formatDate(pageComparison.reference.observedAt),
    components:Array.isArray(pageComparison.components)?pageComparison.components.map((item:any)=>({label:String(item.label),method:String(item.method),outcome:String(item.outcome),detail:String(item.detail),status:String(item.status),sharedValues:stringList(item.sharedValues)})):[],
  };}
  function assessment(status:string){return({equivalent:'Equivalent',conflict:'Conflict',rdap_only:'RDAP only',whois_only:'WHOIS only',rdap_redacted:'RDAP redacted',whois_redacted:'WHOIS redacted',rdap_unavailable:'RDAP unavailable',whois_unavailable:'WHOIS unavailable',rdap_incomplete:'RDAP incomplete',whois_incomplete:'WHOIS incomplete'} as Record<string,string>)[status]||status;}
  function publicationAssessment(status:string){return({equivalent:'Equivalent',conflict:'Conflict',registry_only:'Registry only',registrar_only:'Registrar only',registry_redacted:'Registry redacted',registrar_redacted:'Registrar redacted',registry_unavailable:'Registry unavailable',registrar_unavailable:'Registrar unavailable',registry_incomplete:'Registry incomplete',registrar_incomplete:'Registrar incomplete'} as Record<string,string>)[status]||status;}
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
  function comparisonDisplayRows(){return comparison.fields.map((field:ComparisonField)=>({
    label:field.label,
    rdapValue:field.rdapDisplay,
    whoisValue:field.whoisDisplay,
    status:field.status,
    assessment:assessment(field.status),
    tone:field.status==='conflict'?'danger':field.status==='equivalent'?'good':['rdap_unavailable','whois_unavailable','rdap_incomplete','whois_incomplete'].includes(field.status)?'warn':'',
  }));}
  function registrarPublicationRows(){return registrarPublicationComparison.fields.map((field:RdapPublicationField)=>({
    label:field.label,
    registryValue:field.registryDisplay,
    registrarValue:field.registrarDisplay,
    status:field.status,
    assessment:publicationAssessment(field.status),
    tone:field.status==='conflict'?'danger':field.status==='equivalent'?'good':['registry_unavailable','registrar_unavailable','registry_incomplete','registrar_incomplete'].includes(field.status)?'warn':'',
  }));}
  function rdapPartialDetail(){if(!rdapParsed.serverTruncated)return'';const reasons=stringList(rdapParsed.serverTruncationReasons);return`The registry reported that some RDAP data was omitted.${reasons.length?` ${reasons.join(' · ')}.`:''}`;}
  function rdapSourceRows(){const rows:Array<{label:string;value:string;datetime?:string}>=[];if(result?.type==='ipv4'||result?.type==='ipv6')rows.push(
    {label:'Handle',value:show(rdapParsed.handle)},
    {label:'Name',value:show(rdapParsed.name)},
    {label:'Range',value:`${show(rdapParsed.startAddress)} – ${show(rdapParsed.endAddress)}`},
    {label:'CIDRs',value:`${show(rdapParsed.cidrs)}${rdapParsed.cidrsTruncated?' (capped)':''}`},
    {label:'Country',value:show(rdapParsed.country)},
    {label:'Type',value:show(rdapParsed.networkType)},
    {label:'Status',value:`${show(rdapParsed.statuses)}${rdapParsed.statusesTruncated?' (capped)':''}`},
    {label:'Registered',value:formatDate(rdapParsed.lifecycle?.createdDate),datetime:dateTimeAttribute(rdapParsed.lifecycle?.createdDate)},
    {label:'Updated',value:formatDate(rdapParsed.lifecycle?.updatedDate),datetime:dateTimeAttribute(rdapParsed.lifecycle?.updatedDate)},
  );else if(result?.type==='asn')rows.push(
    {label:'Handle',value:show(rdapParsed.handle)},
    {label:'Name',value:show(rdapParsed.name)},
    {label:'AS range',value:`${show(rdapParsed.startAutnum)} – ${show(rdapParsed.endAutnum)}`},
    {label:'Country',value:show(rdapParsed.country)},
    {label:'Type',value:show(rdapParsed.autnumType)},
    {label:'Status',value:`${show(rdapParsed.statuses)}${rdapParsed.statusesTruncated?' (capped)':''}`},
    {label:'Registered',value:formatDate(rdapParsed.lifecycle?.createdDate),datetime:dateTimeAttribute(rdapParsed.lifecycle?.createdDate)},
    {label:'Updated',value:formatDate(rdapParsed.lifecycle?.updatedDate),datetime:dateTimeAttribute(rdapParsed.lifecycle?.updatedDate)},
  );rows.push(
    {label:'Object class',value:show(rdapParsed.objectClassName)},
    {label:'Language',value:show(rdapParsed.language)},
    {label:'Conformance',value:`${show(rdapParsed.conformance)}${rdapParsed.conformanceTruncated?' (capped)':''}`},
    {label:'Lifecycle events',value:`${Array.isArray(rdapParsed.events)?rdapParsed.events.length:0}${rdapParsed.eventsTruncated?' (capped)':''}`},
    {label:'RDAP database updated',value:formatDate(rdapParsed.lifecycle?.databaseUpdatedDate)},
    {label:'Port 43',value:show(rdapParsed.port43)},
    {label:'Parent handle',value:show(rdapParsed.parentHandle)},
  );return rows;}
  function whoisSourceRows(){return[
    {label:'Domain',value:show(whoisParsed.domainName)},
    {label:'Registry ID',value:show(whoisParsed.registryDomainId)},
    {label:'Registrar',value:show(whoisParsed.registrar)},
    {label:'Registrar ID',value:show(whoisParsed.registrarIanaId)},
    {label:'Registrar WHOIS',value:show(whoisParsed.registrarWhoisServer)},
    {label:'Reseller',value:show(whoisParsed.reseller)},
    {label:'Created',value:formatDate(whoisParsed.lifecycle?.createdDate)},
    {label:'Expires',value:formatDate(whoisParsed.lifecycle?.expiryDate)},
    {label:'Updated',value:formatDate(whoisParsed.lifecycle?.updatedDate)},
    {label:'DNSSEC',value:show(whoisParsed.dnssec)},
    {label:'Status',value:show(whoisParsed.statuses)},
    {label:'Nameservers',value:show(whoisParsed.nameservers)},
    {label:'Chain',value:show(whoisParsed.chainStatus)},
  ];}
  function whoisContactRoleRows(){return populatedWhoisRoles.map((role)=>({role,contacts:whoisParsed.contactsByRole[role].map((contact:JsonRecord)=>({identity:contactIdentity(contact),details:contactDetails(contact)}))}));}
  function registrarRdapDisplay(){return{
    visible:Boolean(registrarRdap.status),
    label:diagnosticLabel(registrarRdap),
    endpoint:registrarRdap.endpoint?String(registrarRdap.endpoint):'',
    detail:[registrarRdap.upstreamStatus?`HTTP ${registrarRdap.upstreamStatus}`:null,registrarRdap.fetchedAt?`Fetched ${formatDate(registrarRdap.fetchedAt)}`:null].filter(Boolean).join(' · '),
    stateDetail:show(registrarRdap.detail),
    error:registrarRdap.status==='error',
    success:registrarRdap.status==='success',
    parsed:registrarRdapParsed,
    comparisonSummary:`Registry / registrar publication comparison · ${registrarPublicationComparison.counts.conflict} conflicts · ${registrarPublicationComparison.counts.registry_only+registrarPublicationComparison.counts.registrar_only} source-only · ${registrarPublicationComparison.counts.registry_redacted+registrarPublicationComparison.counts.registrar_redacted} redacted · ${registrarPublicationComparison.counts.registry_unavailable+registrarPublicationComparison.counts.registrar_unavailable+registrarPublicationComparison.counts.registry_incomplete+registrarPublicationComparison.counts.registrar_incomplete} unavailable/incomplete · ${registrarPublicationComparison.counts.equivalent} equivalent`,
    comparisonRows:registrarPublicationRows(),
  };}
  function dnsValues(name:string){const records=Array.isArray(dnsRecords[name])?dnsRecords[name]:[];return records.map((record:any)=>typeof record==='string'?record:name==='mx'?`${record.priority} ${record.exchange||'.'}`:name==='caa'?`${record.critical} ${record.tag} ${record.value}`:String(record)).join(' · ');}
  function dnsDisplay(name:string){return dnsEvidence.status==='skipped'?'Not evaluated':dnsValues(name)||'Not observed';}
  function dnsQueryFailures(){return Object.entries(rec(dnsEvidence.diagnostics)).filter(([,item])=>rec(item).status==='error').map(([name,item])=>`${name.toUpperCase()}: ${rec(item).error||'query failed'}`).join(' · ');}
  function dnsEvidenceRows(){return[
    {label:'DNSSEC',value:show(availability.dnssec)},
    ...[['A','a'],['AAAA','aaaa'],['CNAME','cname'],['Nameservers','ns'],['MX','mx'],['SPF','spf'],['DMARC','dmarc'],['CAA','caa']].map(([label,name])=>({label,value:dnsDisplay(name)})),
  ];}
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
  function httpEvidenceRows(){return[
    {label:'Final URL',value:show(httpEvidence.finalUrl||httpEvidence.requestUrl)},
    {label:'Response',value:httpResponse.status?`HTTP ${httpResponse.status}`:'Not observed'},
    {label:'Transport',value:httpEvidence.transportSecurity==='https'?'HTTPS':httpEvidence.transportSecurity==='http'?'Cleartext HTTP':'Not observed'},
    {label:'Redirects',value:show(httpEvidence.redirectCount)},
    {label:'Content type',value:show(httpResponse.contentType)},
    {label:'Body captured',value:`${formatBytes(httpResponse.capturedBodyBytes)}${httpResponse.bodyTruncated?' · capped':''}`},
  ];}
  function httpRedirectRows(){return Array.isArray(httpEvidence.redirects)?httpEvidence.redirects.map((redirect:JsonRecord)=>({status:show(redirect.status),from:show(redirect.from),to:show(redirect.to),queryOmitted:Boolean(redirect.queryOmitted)})):[];}
  function httpAttemptRows(){const attempts=Array.isArray(httpEvidence.attempts)?httpEvidence.attempts:[];return attempts.some((attempt:JsonRecord)=>attempt.error)?attempts.map((attempt:JsonRecord)=>({url:show(attempt.url),detail:attempt.error?String(attempt.error):`HTTP ${show(attempt.httpStatus)}`})):[];}
  function httpMetadataRows(){if(!httpResponse.status)return[];const rows:Array<{label:string;value:string;hash?:boolean}>=httpSecurityRows().map(([label,value])=>({label,value:show(value)}));rows.push({label:'Server',value:show(httpResponse.server)},{label:'Content language',value:show(httpResponse.contentLanguage)},{label:'Declared length',value:httpResponse.declaredContentLength===null||httpResponse.declaredContentLength===undefined?'—':formatBytes(httpResponse.declaredContentLength)});if(httpResponse.bodyHash){rows.push({label:'Body SHA-256',value:show(httpResponse.bodyHash.value),hash:true},{label:'Hash scope',value:httpResponse.bodyHash.scope==='captured-prefix'?`Captured prefix (${formatBytes(httpResponse.bodyHash.bytes)})`:`Complete captured body (${formatBytes(httpResponse.bodyHash.bytes)})`});}return rows;}
  function tlsEvidenceRows(){return[
    {label:'Connected address',value:show(tlsEvidence.connectedAddress)},
    {label:'SNI hostname',value:show(tlsEvidence.sniHost)},
    {label:'Protocol',value:show(tlsEvidence.protocol)},
    {label:'Cipher',value:show(tlsCipher.standardName||tlsCipher.name)},
    {label:'ALPN',value:show(tlsEvidence.alpnProtocol)},
    {label:'Chain trust',value:tlsTrust(),danger:tlsAuthorization.authorized===false},
    {label:'Hostname',value:tlsHostnameStatus(),danger:tlsHostname.matches===false},
    {label:'Validity',value:tlsValidityStatus(),danger:tlsValidity.status==='expired'||tlsValidity.status==='not_yet_valid'},
  ];}
  function tlsFindingRows(){return Array.isArray(tlsEvidence.findings)?tlsEvidence.findings.map((finding:JsonRecord)=>({label:show(finding.label),detail:show(finding.detail),tone:String(finding.tone||'')})):[];}
  function tlsLeafCertificateRows(){if(!tlsCertificate.fingerprintSha256)return[];const rows:Array<{label:string;value:string;hash?:boolean}>=[{label:'Subject',value:tlsName(tlsSubject)},{label:'Issuer',value:tlsName(tlsIssuer)},{label:'Serial number',value:show(tlsCertificate.serialNumber),hash:true},{label:'Valid from',value:formatDate(tlsCertificate.validFrom)},{label:'Valid to',value:formatDate(tlsCertificate.validTo)},{label:'Certificate SHA-256',value:show(tlsCertificate.fingerprintSha256),hash:true},{label:'Public key',value:`${show(tlsPublicKey.type)}${tlsPublicKey.bits?` · ${tlsPublicKey.bits} bits`:''}${tlsPublicKey.curve?` · ${tlsPublicKey.curve}`:''}`}];if(tlsPublicKey.fingerprintSha256)rows.push({label:'Public-key SHA-256',value:show(tlsPublicKey.fingerprintSha256),hash:true});return rows;}
  function tlsAlternativeNameRows(){return[
    ...(Array.isArray(tlsAltNames.dnsNames)?tlsAltNames.dnsNames.map((value:any)=>({type:'DNS',value:show(value)})):[]),
    ...(Array.isArray(tlsAltNames.ipAddresses)?tlsAltNames.ipAddresses.map((value:any)=>({type:'IP address',value:show(value)})):[]),
  ];}
  function tlsChainRows(){return Array.isArray(tlsEvidence.chain)?tlsEvidence.chain.map((certificate:JsonRecord,index:number)=>({label:index===0?'Leaf certificate':`Chain certificate ${index+1}`,subject:tlsName(rec(certificate.subject)),fingerprint:show(certificate.fingerprintSha256)})):[];}
  function tlsValidationRows(){return[
    ...(tlsDiagnostics.error?[{label:'Collection',value:String(tlsDiagnostics.error)}]:[]),
    ...(tlsAuthorization.error?[{label:'Authorization',value:String(tlsAuthorization.error)}]:[]),
    ...(tlsHostname.error?[{label:'Hostname',value:String(tlsHostname.error)}]:[]),
  ];}
  function signals(){const values:Array<{label:string;tone:string;detail?:string}>=[];if(profileSignals.trusted)values.push({label:`Trusted ${profileSignals.trusted}`,tone:'good'});if(profileSignals.faviconMatch)values.push({label:'Favicon match',tone:'danger'});else if(profileSignals.faviconNearMatch)values.push({label:'Favicon near-match',tone:'warn'});if(profileSignals.reusesOfficialAssets)values.push({label:'Reuses official assets',tone:'danger'});if(availability.hasPasswordField)values.push({label:'Password field',tone:'warn'});if(availability.phishingLanguageMatch)values.push({label:'Phishing language',tone:'danger',detail:availability.phishingLanguageMatch});if(idnAnalysis?.mixedScript)values.push({label:'Mixed-script IDN',tone:'warn',detail:'The Unicode label combines writing scripts.'});if(idnAnalysis?.referenceMatches?.length)values.push({label:'Official-domain skeleton match',tone:'warn',detail:'A bounded visual skeleton matches an official domain in the active brand profile.'});const age=fmtAge(availability.domainAgeDays);if(age)values.push({label:age,tone:'neutral'});const expiry=fmtExpiresIn(availability.expiresInDays);if(expiry)values.push({label:expiry,tone:availability.expiresInDays<=60?'warn':'neutral'});if(availability.privacyProtected!==null&&availability.privacyProtected!==undefined)values.push({label:formatPrivacyCell(availability.privacyProtected),tone:availability.privacyProtected?'warn':'good'});if(availability.activityStatus)values.push({label:formatActivityCell(availability.activityStatus,availability.hasMx,availability.hasSpf,availability.hasDmarc),tone:availability.activityStatus==='active'?'good':availability.activityStatus==='parked'?'warn':'neutral',detail:availability.websiteProbeDetail});return values;}
  function overviewFacts(){return[
    {label:'Registration',value:show(availability.state||whoisParsed.registrationStatus),detail:`${show(availability.confidence)} confidence`},
    {label:'Registrar',value:show(availability.registrar||rdapParsed.registrar||whoisParsed.registrar),detail:show(whoisParsed.registrarUrl)},
    {label:'Created',value:formatDate(created()),detail:fmtAge(availability.domainAgeDays)||'Registry lifecycle date'},
    {label:'Expires',value:formatDate(expires()),detail:fmtExpiresIn(availability.expiresInDays)||'Registry lifecycle date'},
    {label:'Updated',value:formatDate(updated()),detail:'Most recent registry change'},
    {label:'Website',value:show(availability.activityStatus),detail:show(availability.websiteProbeDetail)},
  ];}
  function sourceDiagnostics(){return['rdap','whois','availability'].map((source)=>{const item=rec(diagnostics[source]) as SourceStatus;return{source,status:String(item.status||''),label:diagnosticLabel(item),detail:diagnosticDetail(item)};});}
  function downloadEvidence(){if(!result)return;const body=JSON.stringify(buildLookupEvidence(result,{idnAnalysis}),null,2);const url=URL.createObjectURL(new Blob([body],{type:'application/json'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=evidenceFilename(result);anchor.click();URL.revokeObjectURL(url);}
  async function copyDraft(text:string,label:string){try{await navigator.clipboard.writeText(text);draftStatus=`Copied ${label} to the clipboard.`;}catch{draftStatus='Clipboard access was unavailable. Use the email draft link instead.';}}
  function resultSectionLinks():Array<{href:`#${string}`;label:string}>{return[
    {href:'#overview',label:'Overview'},
    ...(hasWebEvidence?[{href:'#web-evidence' as const,label:'Web & DNS'}]:[]),
    {href:'#registry',label:'Registry'},
    ...(threatIntelligenceProviders.length?[{href:'#external-intelligence' as const,label:'External intel'}]:[]),
    ...(hasCaseSection?[{href:'#case-response' as const,label:'Case & response'}]:[]),
    {href:'#raw-data',label:'Raw data'},
  ];}
  async function submit(event:SubmitEvent){event.preventDefault();if(lookupDisabled){error=lookupDisabled.reason||'Lookup is disabled by deployment policy.';return;}if(!entries.length||loading)return;if(entries.length>1){saveCandidateHandoff('manual',entries.slice(0,2000).map(domain=>({domain:domain.toLowerCase(),source:'manual input',mutationTypes:[]})));await goto('/bulk?source=lookup');return;}loading=true;error='';result=null;caseRecord=null;caseNote='';caseStatus='';profile=activeProfile();try{const params=new URLSearchParams({q:entries[0]});if(includeExternalIntelligence&&externalIntelligenceSupported)params.set('intelligence','1');if(includeMalwareHostIntelligence&&malwareHostIntelligenceSupported)params.set('malware','1');if(includeMalwareIocIntelligence&&malwareIocIntelligenceSupported)params.set('ioc','1');const response=await fetch(`/api/lookup?${params}`);const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||`Lookup failed (${response.status})`);result=body;refreshCase();requestAnimationFrame(()=>document.querySelector('#result')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'}));}catch(cause){error=cause instanceof Error?cause.message:'Lookup failed';}finally{loading=false;}}
</script>

<svelte:head><title>Lookup · WHOISleuth</title></svelte:head>
<PageHeading eyebrow="Investigate" title="Lookup" description="Look up a domain, IP address, or ASN using RDAP and WHOIS, with DNS, HTTP, and bounded TLS/certificate checks for domains." />
<LookupForm
  bind:query
  {loading}
  entryCount={entries.length}
  duplicateCount={parsedInput.duplicates}
  {lookupDisabled}
  {lookupLimitations}
  {externalIntelligenceSupported}
  {malwareHostIntelligenceSupported}
  {malwareIocIntelligenceSupported}
  bind:includeExternalIntelligence
  bind:includeMalwareHostIntelligence
  bind:includeMalwareIocIntelligence
  {error}
  onsubmit={submit}
/>

{#if result}
  <section class="result-root" id="result">
    <LookupResultHeader title={show(result.registrableDomain||result.query)} state={show(availability.state)} isSubdomain={Boolean(result.isSubdomain)} registrableDomain={show(result.registrableDomain)} inputHostname={show(result.inputHostname)} onExport={downloadEvidence} />

    <LocalSectionNav label="Result sections" links={resultSectionLinks()} />

    <section class="result-section" id="overview" aria-labelledby="overview-title">
      <h3 id="overview-title">Overview</h3>

      {#if availability.applicable!==false}
        <LookupAssessment detail={show(availability.detail||availability.state)} confidence={show(availability.confidence)} {risk} {opportunity} signals={signals()} trusted={String(profileSignals.trusted||'')} />
      {/if}

      <LookupOverviewFacts facts={overviewFacts()} diagnostics={sourceDiagnostics()} hasAssessment={availability.applicable!==false} />

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
        <div class="evidence-component"><LookupDnsEvidence status={show(dnsEvidence.status)} complete={dnsEvidence.complete!==false} rows={dnsEvidenceRows()} failureDetail={dnsQueryFailures()} truncated={Boolean(dnsEvidence.truncated)} /></div>
      {/if}

      {#if httpEvidence.source==='http'}
        <div class="evidence-component"><LookupHttpEvidence status={statusLabel(show(httpEvidence.status))} complete={httpEvidence.complete!==false} rows={httpEvidenceRows()} crossOriginRedirect={Boolean(httpEvidence.crossOriginRedirect)} httpsDowngrade={Boolean(httpEvidence.httpsDowngrade)} redirects={httpRedirectRows()} attempts={httpAttemptRows()} metadata={httpMetadataRows()} limitations={Array.isArray(httpEvidence.limitations)?httpEvidence.limitations.map(String):[]} /></div>
      {/if}

      {#if tlsEvidence.source==='tls'}
        <div class="evidence-component"><LookupTlsEvidence status={statusLabel(show(tlsEvidence.status))} complete={tlsEvidence.complete!==false} rows={tlsEvidenceRows()} findings={tlsFindingRows()} leafCertificate={tlsLeafCertificateRows()} alternativeNames={tlsAlternativeNameRows()} alternativeNamesTruncated={Boolean(tlsAltNames.truncated)} chain={tlsChainRows()} chainTruncated={Boolean(tlsEvidence.chainTruncated)} validationDetails={tlsValidationRows()} limitations={Array.isArray(tlsEvidence.limitations)?tlsEvidence.limitations.map(String):[]} /></div>
      {/if}

      {#if pageIdentity.source==='html'}
        <div class="evidence-component"><LookupPageIdentity
          status={statusLabel(show(pageIdentity.status))}
          complete={Boolean(pageIdentity.complete)}
          facts={pageIdentityFactRows()}
          externalFormOrigins={stringList(pageForms.externalActionOrigins)}
          resourceCount={Number(pageResources.count)||0}
          resourceSummary={pageResourceSummaryRows()}
          embeddedOrigins={stringList(pageIdentity.embeddedOrigins)}
          contactDomains={stringList(pageIdentity.contactDomains)}
          downloadCount={Number(pageDownloads.count)||0}
          downloadSummary={pageDownloadSummaryRows()}
          trackingIdentifiers={pageTrackingIdentifierRows()}
          fingerprints={pageFingerprintRows()}
          limitations={stringList(pageIdentity.limitations)}
        /></div>
      {/if}

      {#if pageComparison || (profile?.pageBaseline && result.type==='domain')}
        <div class="evidence-component"><LookupPageComparison comparison={pageComparisonDisplay()} unavailable={Boolean(!pageComparison&&profile?.pageBaseline&&result.type==='domain')} /></div>
      {/if}
    </section>
    {/if}

    <section class="result-section" id="registry" aria-labelledby="registry-title">
      <h3 id="registry-title">Registry sources</h3>

      {#if registryAccess.suffix}
        <RegistryAccessNotice access={registryAccess} />
      {/if}

      <div class="evidence-component"><LookupRegistrySources
        comparisonSummary={`RDAP / WHOIS comparison · ${comparison.counts.conflict} conflicts · ${sourceOnlyCount} source-only · ${redactedComparisonCount} redacted · ${limitedComparisonCount} unavailable/incomplete · ${comparison.counts.equivalent} equivalent`}
        comparisonRows={comparisonDisplayRows()}
        comparisonHasConflicts={comparison.counts.conflict>0}
        rdapError={rdap.error?String(rdap.error):''}
        resultType={String(result.type)}
        {rdapParsed}
        rdapPartialDetail={rdapPartialDetail()}
        rdapRows={rdapSourceRows()}
        whoisError={whois.error?String(whois.error):''}
        whoisRows={whoisSourceRows()}
        whoisContactRoles={whoisContactRoleRows()}
        whoisTruncatedFields={stringList(whoisParsed.fieldsTruncated)}
        registrar={registrarRdapDisplay()}
      /></div>
    </section>

    {#if threatIntelligenceProviders.length}
      <section class="result-section" id="external-intelligence" aria-labelledby="external-intelligence-title">
        <h3 id="external-intelligence-title">External intelligence</h3>
        <LookupExternalIntelligence providers={threatIntelligenceProviders} riskContext={externalRiskContext} riskModelVersion={risk?.modelVersion ?? null} showValue={show} {formatDate} />
      </section>
    {/if}

    {#if hasCaseSection}
      <section class="result-section" id="case-response" aria-labelledby="case-response-title">
        <h3 id="case-response-title">Case and response</h3>

        <LookupCaseResponse domain={caseDomain} record={caseRecord} note={caseNote} {caseStatus} {draftStatus} {outreach} {abuse} setNote={(value) => caseNote = value} createCase={openLookupCase} addNote={addLookupNote} {copyDraft} statusLabel={caseStatusLabel} dispositionLabel={caseDispositionLabel} />
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
  .result-section{margin-top:26px}
  .result-section>h3{display:flex;align-items:center;gap:10px;margin:0 0 12px;color:var(--accent2);font:700 var(--text-2xs) var(--mono);letter-spacing:.09em;text-transform:uppercase}
  .result-section>h3::before{content:"//";color:var(--muted)}
  .result-section>h3::after{content:"";flex:1;height:1px;background:var(--border)}
  .result-section>.card,.result-section>.evidence-component{margin-top:12px}
  .result-section>:nth-child(2){margin-top:0}

  .evidence-card{padding:var(--card-pad)}
  .evidence-card .section-head p:not(.eyebrow){margin:4px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .evidence-card .stat-grid{margin-top:14px}
  .card-note{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}

  .finding-list{display:grid;gap:7px;margin:12px 0 0;padding:0;list-style:none}
  .finding-list .callout{margin:0}
  .finding-list strong{display:block;color:var(--text);font-size:var(--text-xs)}
  .finding-list span{display:block;margin-top:3px}

  .raw{padding:0;overflow:hidden}

  .raw pre{max-height:520px;overflow:auto;margin:0;padding:var(--card-pad);border-top:1px solid var(--border);font-size:var(--text-xs)}

</style>
