<script lang="ts">
  import { goto } from '$app/navigation';
  import { getContext, onMount } from 'svelte';
  import { page } from '$app/state';
  import AnalystEvidencePivots from '$lib/components/AnalystEvidencePivots.svelte';
  import EvidenceTopology from '$lib/components/EvidenceTopology.svelte';
  import LocalSectionNav from '$lib/components/LocalSectionNav.svelte';
  import LookupAssessment from '$lib/components/LookupAssessment.svelte';
  import LookupAcquisitionDueDiligence from '$lib/components/LookupAcquisitionDueDiligence.svelte';
  import LookupActivationContext from '$lib/components/LookupActivationContext.svelte';
  import LookupAssetGraph from '$lib/components/LookupAssetGraph.svelte';
  import LookupBrandMimicryReview from '$lib/components/LookupBrandMimicryReview.svelte';
  import LookupLifecycle from '$lib/components/LookupLifecycle.svelte';
  import LookupDecisionSupport from '$lib/components/LookupDecisionSupport.svelte';
  import LookupEvidenceQuality from '$lib/components/LookupEvidenceQuality.svelte';
  import LookupEvidenceReplay from '$lib/components/LookupEvidenceReplay.svelte';
  import LookupCertificatePolicyReview from '$lib/components/LookupCertificatePolicyReview.svelte';
  import LookupCredentialSurfaceProfile from '$lib/components/LookupCredentialSurfaceProfile.svelte';
  import LookupDnsEvidence from '$lib/components/LookupDnsEvidence.svelte';
  import LookupExternalIntelligence from '$lib/components/LookupExternalIntelligence.svelte';
  import LookupForm from '$lib/components/LookupForm.svelte';
  import LookupHttpEvidence from '$lib/components/LookupHttpEvidence.svelte';
  import LookupNetworkContext from '$lib/components/LookupNetworkContext.svelte';
  import LookupOverviewFacts from '$lib/components/LookupOverviewFacts.svelte';
  import LookupPageComparison from '$lib/components/LookupPageComparison.svelte';
  import LookupPageIdentity from '$lib/components/LookupPageIdentity.svelte';
  import LookupPageRoleBehavior from '$lib/components/LookupPageRoleBehavior.svelte';
  import LookupRegistrySources from '$lib/components/LookupRegistrySources.svelte';
  import LookupResultHeader from '$lib/components/LookupResultHeader.svelte';
  import LookupPresentationControls from '$lib/components/LookupPresentationControls.svelte';
  import LookupSecurityPosture from '$lib/components/LookupSecurityPosture.svelte';
  import LookupSecurityTxt from '$lib/components/LookupSecurityTxt.svelte';
  import LookupSslblEvidence from '$lib/components/LookupSslblEvidence.svelte';
  import LookupServiceDependencyReview from '$lib/components/LookupServiceDependencyReview.svelte';
  import LookupStructuredDataIdentity from '$lib/components/LookupStructuredDataIdentity.svelte';
  import LookupTlsEvidence from '$lib/components/LookupTlsEvidence.svelte';
  import LookupTechnologyProfile from '$lib/components/LookupTechnologyProfile.svelte';
  import WebsiteSnapshotManager from '$lib/components/WebsiteSnapshotManager.svelte';
  import RegistryAccessNotice from '$lib/components/RegistryAccessNotice.svelte';
  import LookupCaseResponse from '$lib/components/LookupCaseResponse.svelte';
  import LookupEvidenceCheckpoint from '$lib/components/LookupEvidenceCheckpoint.svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import { activeProfile, profileSignals as matchProfileSignals, type BrandProfile } from '$lib/brand-profiles';
  import { dispositionLabel as caseDispositionLabel, statusLabel as caseStatusLabel, type CaseRecord, type CaseTransitionExpectation } from '$lib/cases';
  import { saveCandidateHandoff } from '$lib/candidate-handoff';
  import { outreachAction, type Contact } from '$lib/drafts';
  import { buildLookupEvidence, evidenceFilename } from '$lib/analysis/evidence-export.ts';
  import { analyzeDomainIdn } from '$lib/analysis/idn-confusables.ts';
  import { buildActivationContext } from '$lib/analysis/activation-context.ts';
  import { buildAcquisitionDueDiligence } from '$lib/analysis/acquisition-due-diligence.ts';
  import { buildBrandMimicryReview } from '$lib/analysis/brand-mimicry-review.ts';
  import {
    resolveAbuseRecipients,
  } from '$lib/analysis/abuse-recipient-resolver.ts';
  import { compactHttpObservation } from '$lib/analysis/http-summary.ts';
  import { buildLookupEvidenceCoverageLedger } from '$lib/analysis/evidence-coverage-ledger.ts';
  import { buildLookupAssetGraph } from '$lib/analysis/lookup-asset-graph.ts';
  import { buildCertificatePolicyReview } from '$lib/analysis/certificate-policy-review.ts';
  import {
    buildLookupInvestigationBrief,
    formatLookupInvestigationBriefMarkdown,
    lookupInvestigationBriefFilename,
  } from '$lib/analysis/lookup-investigation-brief.ts';
  import {
    buildLookupDecisionSupport,
    buildLookupEvidenceQualityMatrix,
  } from '$lib/analysis/lookup-decision-support.ts';
  import { buildLookupSourceRefreshPlan } from '$lib/analysis/lookup-source-refresh.ts';
  import { buildLookupCheckpointFacts } from '$lib/analysis/case-evidence-checkpoint.ts';
  import { buildAnalystEvidencePivots } from '$lib/analysis/analyst-evidence-pivots.ts';
  import { calibrateExternalIntelligenceRisk } from '$lib/analysis/external-intelligence-risk.ts';
  import {
    buildLookupEvidenceTopologyNodes,
  } from '$lib/analysis/evidence-topology.ts';
  import {
    createLookupViewModel,
    type LookupHttpResponse,
  } from '$lib/analysis/lookup-response.ts';
  import {
    boundedTechnologyText,
    buildLookupLifecycleDates,
    buildLookupNetworkDisplay,
    buildLookupPageDisplay,
    buildLookupRegistryDisplay,
    dateTimeAttribute,
    formatDate,
    rec,
    records,
    show,
    statusLabel,
    stringList,
    type JsonRecord,
  } from '$lib/analysis/lookup-display-model.ts';
  import {
    LOOKUP_CLIENT_TIMEOUT_MS,
  } from '$lib/analysis/lookup-request.ts';
  import {
    buildLookupRequestUrl,
    buildLookupResultSectionLinks,
  } from '$lib/analysis/lookup-page-actions.ts';
  import {
    normalizeLookupEvidenceDensity,
    normalizeLookupTaskView,
    lookupTaskInitiallyExpands,
    readLookupPresentation,
    writeLookupPresentation,
    type LookupEvidenceDensity,
    type LookupTaskView,
  } from '$lib/analysis/lookup-presentation.ts';
  import { buildLookupWebsiteSnapshot } from '$lib/analysis/lookup-snapshot-input.ts';
  import {
    buildLookupReadableReport,
    lookupReadableReportFilename,
  } from '$lib/analysis/lookup-readable-report.ts';
  import { buildLookupSummaryModel } from '$lib/analysis/lookup-summary-model.ts';
  import { createPageBaseline } from '$lib/analysis/page-baseline.ts';
  import { comparePageBaselines } from '$lib/analysis/page-similarity.ts';
  import { buildServiceDependencyReview } from '$lib/analysis/service-dependency-review.ts';
  import { compareRdapPublications, compareRegistrySources } from '$lib/analysis/registry-comparison.ts';
  import { entityDisplayName, parseDomainInput } from '$lib/analysis/utils.ts';
  import { CAPABILITY_CONTEXT, disabledCapabilities, disabledCapability, featureCapability, type CapabilityGetter } from '$lib/capabilities';
  import { readLookupWorkflowState, writeLookupWorkflowState } from '$lib/console-workflow-state.ts';
  import { LookupRequestController } from '$lib/controllers/lookup-request-controller';
  import { LookupCaseController } from '$lib/controllers/lookup-case-controller';
  import {
    explainOpportunityScore,
    explainRiskScore,
  } from '$lib/analysis/scoring.ts';

  type ScoreExplanation = { modelVersion?:number; score:number; factors:Array<{label:string;delta:number}> }|null;
  type LookupMode = 'fast' | 'deep';

  function latestIsoTimestamp(...values: unknown[]): string | null {
    const timestamps = values
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .map((value) => typeof value === 'string' ? Date.parse(value) : Number.NaN)
      .filter(Number.isFinite);
    return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
  }

  let query=$state('');
  let lookupMode=$state<LookupMode>('deep');
  let loading=$state(false);
  let loadingElapsedMs=$state(0);
  let includeExternalIntelligence=$state(false);
  let includeMalwareHostIntelligence=$state(false);
  let includeMalwareIocIntelligence=$state(false);
  let includeSecurityTxt=$state(false);
  let error=$state('');
  let result=$state<LookupHttpResponse|null>(null);
  let profile=$state<BrandProfile|null>(null);
  let draftStatus=$state('');
  let caseRecord=$state<CaseRecord|null>(null);let caseNote=$state('');let caseStatus=$state('');
  let evidenceDensity=$state<LookupEvidenceDensity>('standard');
  let taskView=$state<LookupTaskView>('general');
  let serviceDependencyScope=$state('');
  let serviceDependencyFalsePositives=$state('');
  let pageActive=false;
  const lookupRequestController=new LookupRequestController();
  const lookupCaseController=new LookupCaseController();
  const capabilityReport=getContext<CapabilityGetter>(CAPABILITY_CONTEXT);
  const lookupDisabled=$derived(disabledCapability(capabilityReport?.()||null,'lookup'));
  const lookupLimitations=$derived(disabledCapabilities(capabilityReport?.()||null,['rdap','whois','availability','dns_intelligence','website_probe','tls_intelligence']));
  const urlscanCapability=$derived(featureCapability(capabilityReport?.()||null,'urlscan_search'));
  const externalIntelligenceSupported=$derived(urlscanCapability?.status==='supported');
  const urlhausCapability=$derived(featureCapability(capabilityReport?.()||null,'urlhaus_host'));
  const malwareHostIntelligenceSupported=$derived(urlhausCapability?.status==='supported');
  const threatfoxCapability=$derived(featureCapability(capabilityReport?.()||null,'threatfox_domain_ioc'));
  const malwareIocIntelligenceSupported=$derived(threatfoxCapability?.status==='supported');
  const websiteProbeCapability=$derived(featureCapability(capabilityReport?.()||null,'website_probe'));
  const securityTxtSupported=$derived(websiteProbeCapability?.status==='supported');

  const parsedInput=$derived(parseDomainInput(query));
  const entries=$derived(parsedInput.entries);
  const securityTxtEligible=$derived.by(()=>{
    if(entries.length!==1)return false;
    try{const value=entries[0];if(!value)return false;const url=new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value)?value:`https://${value}`);const host=url.hostname;return host.includes('.')&&!host.includes(':')&&!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host);}catch{return false;}
  });
  const lookupView=$derived(createLookupViewModel(result));
  const availability=$derived(lookupView.availability);
  const lookupEvidenceDepth=$derived(availability.deepScanComplete===false?'fast':'deep');
  const rdap=$derived(lookupView.rdap);
  const registrarRdap=$derived(lookupView.registrarRdap);
  const registrarRdapParsed=$derived(lookupView.registrarRdapParsed);
  const whois=$derived(lookupView.whois);
  const rdapParsed=$derived(lookupView.rdapParsed);
  const whoisParsed=$derived(lookupView.whoisParsed);
  const diagnostics=$derived(lookupView.diagnostics);
  const lookupTiming=$derived(lookupView.timing);
  const registryAccess=$derived(lookupView.registryAccess);
  const registryInsights=$derived(lookupView.registryInsights);
  const reverseDns=$derived(lookupView.reverseDns);
  const reverseDnsRecords=$derived(lookupView.reverseDnsRecords);
  const observedNetworkContext=$derived(lookupView.observedNetworkContext);
  const observedNetworkEndpoint=$derived(lookupView.observedNetworkEndpoint);
  const observedNetworkRdap=$derived(lookupView.observedNetworkRdap);
  const observedNetwork=$derived(lookupView.observedNetwork);
  const securityTxt=$derived(lookupView.securityTxt);
  const sslbl=$derived(lookupView.sslbl);
  const sslblSnapshot=$derived(rec(sslbl.snapshot));
  const threatIntelligence=$derived(lookupView.threatIntelligence);
  const threatIntelligenceProviders=$derived(lookupView.threatIntelligenceProviders);
  const dnsEvidence=$derived(lookupView.dnsEvidence);
  const dnsRecords=$derived(lookupView.dnsRecords);
  const httpEvidence=$derived(lookupView.httpEvidence);
  const httpResponse=$derived(lookupView.httpResponse);
  const httpSecurityHeaders=$derived(lookupView.httpSecurityHeaders);
  const tlsEvidence=$derived(lookupView.tlsEvidence);
  const tlsCertificate=$derived(lookupView.tlsCertificate);
  const tlsSubject=$derived(lookupView.tlsSubject);
  const tlsIssuer=$derived(lookupView.tlsIssuer);
  const tlsAltNames=$derived(lookupView.tlsAltNames);
  const tlsPublicKey=$derived(lookupView.tlsPublicKey);
  const tlsCipher=$derived(lookupView.tlsCipher);
  const tlsAuthorization=$derived(lookupView.tlsAuthorization);
  const tlsHostname=$derived(lookupView.tlsHostname);
  const tlsValidity=$derived(lookupView.tlsValidity);
  const tlsDiagnostics=$derived(lookupView.tlsDiagnostics);
  const pageIdentity=$derived(lookupView.pageIdentity);
  const pageCanonical=$derived(lookupView.pageCanonical);
  const pageMetaRefresh=$derived(lookupView.pageMetaRefresh);
  const pageOpenGraph=$derived(lookupView.pageOpenGraph);
  const pageOpenGraphUrl=$derived(lookupView.pageOpenGraphUrl);
  const pageForms=$derived(lookupView.pageForms);
  const pageResources=$derived(lookupView.pageResources);
  const pageResourceTypes=$derived(lookupView.pageResourceTypes);
  const pageDownloads=$derived(lookupView.pageDownloads);
  const pageFingerprints=$derived(lookupView.pageFingerprints);
  const credentialSurfaceProfile=$derived(lookupView.credentialSurfaceProfile);
  const structuredDataIdentity=$derived(lookupView.structuredDataIdentity);
  const technologyProfile=$derived(lookupView.technologyProfile);
  const pageRoleProfile=$derived(lookupView.pageRoleProfile);
  const clientBehaviorProfile=$derived(lookupView.clientBehaviorProfile);
  const browserLibraryProfile=$derived(rec(technologyProfile.browserLibraryProfile));
  const securityPosture=$derived(lookupView.securityPosture);
  const securityPostureSummary=$derived(lookupView.securityPostureSummary);
  const compactHttpSummary=$derived(compactHttpObservation(availability.http)||{});
  const whoisRoleOrder=['registrant','administrative','technical','billing','abuse'];
  const whoisContactsByRole=$derived(rec(whoisParsed.contactsByRole));
  const rdapDiagnostic=$derived(rec(diagnostics.rdap));
  const whoisDiagnostic=$derived(rec(diagnostics.whois));
  const lookupObservedAt=$derived(latestIsoTimestamp(
    result?.observedAt,
    result?.fetchedAt,
    rdapDiagnostic.fetchedAt,
    whoisDiagnostic.queriedAt,
    registrarRdap.fetchedAt,
    reverseDns.observedAt,
    observedNetworkContext.observedAt,
    observedNetworkRdap.fetchedAt,
    dnsEvidence.observedAt,
    httpEvidence.observedAt,
    tlsEvidence.observedAt,
    pageIdentity.observedAt,
    technologyProfile.observedAt,
    pageRoleProfile.observedAt,
    clientBehaviorProfile.observedAt,
    securityPosture.observedAt,
    securityTxt.observedAt,
    sslbl.observedAt,
    threatIntelligenceProviders.map((provider)=>rec(provider).observedAt),
  ));
  const evidenceObservedAtById=$derived.by(()=>{
    const output:Record<string,unknown>={
      rdap:rdapDiagnostic.fetchedAt,
      whois:whoisDiagnostic.queriedAt,
      availability:latestIsoTimestamp(dnsEvidence.observedAt,httpEvidence.observedAt,tlsEvidence.observedAt),
      'registrar-rdap':registrarRdap.fetchedAt,
      'reverse-dns':reverseDns.observedAt,
      'network-context':latestIsoTimestamp(observedNetworkContext.observedAt,observedNetworkRdap.fetchedAt),
      dns:dnsEvidence.observedAt,
      http:httpEvidence.observedAt,
      tls:tlsEvidence.observedAt,
      'page-identity':latestIsoTimestamp(pageIdentity.observedAt,httpEvidence.observedAt),
      technology:latestIsoTimestamp(technologyProfile.observedAt,httpEvidence.observedAt),
      'page-role':latestIsoTimestamp(pageRoleProfile.observedAt,httpEvidence.observedAt),
      'client-behavior':latestIsoTimestamp(clientBehaviorProfile.observedAt,httpEvidence.observedAt),
      'security-posture':latestIsoTimestamp(securityPosture.observedAt,httpEvidence.observedAt,tlsEvidence.observedAt),
      'security-txt':securityTxt.observedAt,
      'sslbl-certificate':sslbl.observedAt,
    };
    for(const providerValue of threatIntelligenceProviders){
      const provider=rec(providerValue);
      const identity=rec(provider.provider);
      const id=String(identity.id||'').trim();
      if(id)output[`external-${id}`]=provider.observedAt;
    }
    return output;
  });
  const populatedWhoisRoles=$derived(whoisRoleOrder.filter((role)=>records(whoisContactsByRole[role]).length>0));
  const comparison=$derived(result?.type==='domain'?compareRegistrySources(rdapParsed,whoisParsed,{rdapStatus:typeof rdapDiagnostic.status==='string'?rdapDiagnostic.status:undefined,whoisStatus:typeof whoisDiagnostic.status==='string'?whoisDiagnostic.status:undefined}):{fields:[],counts:{equivalent:0,conflict:0,rdap_only:0,whois_only:0,rdap_redacted:0,whois_redacted:0,rdap_unavailable:0,whois_unavailable:0,rdap_incomplete:0,whois_incomplete:0}});
  const registrarPublicationComparison=$derived(result?.type==='domain'?compareRdapPublications(rdapParsed,registrarRdapParsed,{registryStatus:typeof rdapDiagnostic.status==='string'?rdapDiagnostic.status:undefined,registrarStatus:typeof registrarRdap.status==='string'?registrarRdap.status:undefined}):{fields:[],counts:{equivalent:0,conflict:0,registry_only:0,registrar_only:0,registry_redacted:0,registrar_redacted:0,registry_unavailable:0,registrar_unavailable:0,registry_incomplete:0,registrar_incomplete:0}});
  const lifecycleDates=$derived(buildLookupLifecycleDates({availability,rdapParsed,whoisParsed}));
  const networkDisplay=$derived(buildLookupNetworkDisplay({
    availability,
    reverseDns,
    reverseDnsRecords,
    dnsEvidence,
    dnsRecords,
    httpEvidence,
    httpResponse,
    httpSecurityHeaders,
    tlsEvidence,
    tlsCertificate,
    tlsSubject,
    tlsIssuer,
    tlsAltNames,
    tlsPublicKey,
    tlsCipher,
    tlsAuthorization,
    tlsHostname,
    tlsValidity,
    tlsDiagnostics,
  }));
  const dnsRehearsalEvidence=$derived({
    currentGlue:records(rec(rec(dnsEvidence.delegation).registry).nameserverDetails),
    currentDs:records(rdapParsed.dsData),
    currentMx:records(dnsRecords.mx),
    currentCaa:records(dnsRecords.caa),
    currentCriticalAddresses:[{
      hostname:String(availability.domain||result?.registrableDomain||'').trim().toLowerCase(),
      addresses:[
        ...(Array.isArray(dnsRecords.a)?dnsRecords.a.map(String):[]),
        ...(Array.isArray(dnsRecords.aaaa)?dnsRecords.aaaa.map(String):[]),
      ],
    }],
  });
  const registryDisplay=$derived(buildLookupRegistryDisplay({
    result,
    rdapParsed,
    whoisParsed,
    whoisContactsByRole,
    populatedWhoisRoles,
    comparison,
    registrarRdap,
    registrarRdapParsed,
    registrarPublicationComparison,
  }));
  const idnAnalysis=$derived(result?.type==='domain'?analyzeDomainIdn(String(result?.registrableDomain||availability.domain||''),profile?.officialDomains||[]):null);
  const profileSignals=$derived.by(()=>{
    return matchProfileSignals(String(availability.domain||result?.registrableDomain||''),availability,profile);
  });
  const externalRiskContext=$derived(calibrateExternalIntelligenceRisk(threatIntelligence));
  const scoredAvailability=$derived({...availability,...profileSignals,threatIntelligence});
  const opportunity=$derived(explainOpportunityScore(scoredAvailability) as ScoreExplanation);
  const risk=$derived(explainRiskScore(scoredAvailability) as ScoreExplanation);
  const outreach=$derived(outreachAction(String(availability.domain||result?.registrableDomain||''),(availability.registrant||null) as Contact|null));
  const abuseRecipientResolution=$derived(resolveAbuseRecipients({
    registryInsights,
    availabilityAbuse:availability.abuse,
    securityTxt,
    networkContext:observedNetworkContext,
  }));
  const sourceOnlyCount=$derived(comparison.counts.rdap_only+comparison.counts.whois_only);
  const redactedComparisonCount=$derived(comparison.counts.rdap_redacted+comparison.counts.whois_redacted);
  const limitedComparisonCount=$derived(comparison.counts.rdap_unavailable+comparison.counts.whois_unavailable+comparison.counts.rdap_incomplete+comparison.counts.whois_incomplete);
  const caseDomain=$derived(String(availability.domain||result?.registrableDomain||'').trim().toLowerCase());
  const observedPageBaseline=$derived(createPageBaseline(caseDomain,availability));
  const pageComparison=$derived(comparePageBaselines(profile?.pageBaseline,observedPageBaseline));
  const pageDisplay=$derived(buildLookupPageDisplay({
    pageIdentity,
    pageCanonical,
    pageMetaRefresh,
    pageOpenGraph,
    pageOpenGraphUrl,
    pageForms,
    pageResources,
    pageResourceTypes,
    pageDownloads,
    pageFingerprints,
    credentialSurfaceProfile,
    structuredDataIdentity,
    technologyProfile,
    browserLibraryProfile,
    pageRoleProfile,
    clientBehaviorProfile,
    observedNetworkContext,
    observedNetworkEndpoint,
    observedNetwork,
    securityPosture,
    securityPostureSummary,
    pageComparison,
  }));
  const brandMimicryReview=$derived(buildBrandMimicryReview({
    hasActiveProfile:Boolean(profile),
    trustedDomainKind:profileSignals.trusted,
    profileSignals,
    pageComparison,
    hasPasswordField:availability.hasPasswordField,
    phishingLanguageMatch:availability.phishingLanguageMatch,
  }));
  const hasWebEvidence=$derived(reverseDns.source==='reverse_dns'||dnsEvidence.source==='dns'||httpEvidence.source==='http'||tlsEvidence.source==='tls'||sslbl.sslblVersion===1||pageIdentity.source==='html'||credentialSurfaceProfile.source==='html'||structuredDataIdentity.source==='html'||technologyProfile.source==='derived'||pageRoleProfile.source==='derived'||clientBehaviorProfile.source==='derived'||securityPosture.source==='derived'||securityTxt.securityTxtVersion===1||Boolean(pageComparison)||Boolean(profile?.pageBaseline&&result?.type==='domain'));
  const hasCaseSection=$derived(Boolean(caseDomain)||Boolean(outreach)||abuseRecipientResolution.recipients.length>0);
  const evidenceTopologyNodes=$derived(buildLookupEvidenceTopologyNodes({
    targetType:result?.type,
    availability,
    diagnostics,
    registrarRdap,
    observedNetworkContext,
    observedNetworkEndpoint,
    dnsEvidence,
    reverseDns,
    reverseDnsRecords,
    httpEvidence,
    httpResponse,
    tlsEvidence,
    tlsAuthorization,
    pageIdentity,
    structuredDataIdentity,
    securityTxt,
    technologyProfile,
    securityPosture,
    securityPostureSummary,
  }));
  const desiredCertificateBaseline=$derived(
    profile?.desiredPostureBaselines.find((item)=>item.domain===caseDomain)??null,
  );
  const certificatePolicyReview=$derived(buildCertificatePolicyReview({
    observedAt:lookupObservedAt,
    dnsEvidence,
    dnsRecords,
    tlsEvidence,
    tlsIssuer,
    tlsPublicKey,
    tlsAltNames,
    baseline:desiredCertificateBaseline,
  }));
  const lookupAssetGraph=$derived(buildLookupAssetGraph({
    target:caseDomain,
    observedAt:lookupObservedAt,
    rdapEvidence:rdap,
    rdapParsed,
    dnsEvidence,
    dnsRecords,
    observedNetworkContext,
    observedNetworkEndpoint,
    observedNetwork,
    httpEvidence,
    tlsEvidence,
    tlsCertificate,
    tlsAuthorization,
    tlsHostname,
    tlsAltNames,
    tlsPublicKey,
    tlsIssuer,
    pageCanonical,
    pageOpenGraphUrl,
    pageForms,
    pageResources,
    pageIdentity,
    structuredDataIdentity,
    certificatePolicyReview,
    profileDomains:{
      official:profile?.officialDomains??[],
      partner:profile?.approvedPartnerDomains??[],
      allowlisted:profile?.allowlistedDomains??[],
    },
  }));
  const analystEvidencePivots=$derived(buildAnalystEvidencePivots({
    type:result?.type,
    query:result?.query,
    registrableDomain:result?.registrableDomain,
    observedAddress:observedNetworkEndpoint.address,
    observedCidrs:observedNetwork.cidrs,
    startAutnum:rdapParsed.startAutnum,
    endAutnum:rdapParsed.endAutnum,
  }));
  const activationContext=$derived(buildActivationContext({
    registryCreated:lifecycleDates.created,
    registryUpdated:lifecycleDates.updated,
    registryExpires:lifecycleDates.expires,
    tlsValidFrom:tlsCertificate.validFrom,
    tlsValidTo:tlsCertificate.validTo,
    observedAt:lookupObservedAt,
    dnsStatus:dnsEvidence.status,
    dnsComplete:dnsEvidence.complete,
    hasMx:availability.hasMx,
    hasSpf:availability.hasSpf,
    hasDmarc:availability.hasDmarc,
    httpStatus:httpResponse.status,
    pageObserved:pageIdentity.source==='html',
    tlsObserved:tlsEvidence.source==='tls'&&tlsEvidence.status!=='skipped',
  }));
  const acquisitionDueDiligence=$derived(buildAcquisitionDueDiligence({
    availability,
    registryInsights,
    activationContext,
    dnsEvidence,
    dnsRecords,
    tlsEvidence,
  }));
  const serviceDependencyReview=$derived(buildServiceDependencyReview({
    domain:caseDomain,
    dnsEvidence,
    dnsRecords,
    httpEvidence,
    authorizedScope:serviceDependencyScope,
    falsePositiveTargets:serviceDependencyFalsePositives,
    pageTitle:pageIdentity.title,
    observedAt:lookupObservedAt,
  }));
  const evidenceCoverage=$derived(buildLookupEvidenceCoverageLedger({
    targetType:result?.type,
    availability,
    diagnostics,
    registrarRdap,
    reverseDns,
    observedNetworkContext,
    dnsEvidence,
    httpEvidence,
    httpResponse,
    tlsEvidence,
    pageIdentity,
    pageRoleProfile,
    clientBehaviorProfile,
    technologyProfile,
    securityPosture,
    securityTxt,
    sslbl,
    rdapParsed,
    whoisParsed,
    threatIntelligenceProviders,
  }));
  const lookupSourceRefreshPlan=$derived(buildLookupSourceRefreshPlan(
    evidenceCoverage,
    lookupObservedAt,
  ));
  const lookupDecisionSupport=$derived(buildLookupDecisionSupport({
    task:taskView,
    coverage:evidenceCoverage,
    refreshPlan:lookupSourceRefreshPlan,
    registryComparison:comparison,
    registrarPublicationComparison,
    requestedHost:result?.inputHostname||result?.registrableDomain||result?.query,
    registrableDomain:result?.registrableDomain,
    finalUrl:httpEvidence.finalUrl,
    canonicalUrl:pageCanonical.url,
    openGraphUrl:pageOpenGraphUrl.url,
    tlsAuthorization,
    certificatePolicyReview,
    hasCaseSection,
  }));
  const evidenceQualityMatrix=$derived(buildLookupEvidenceQualityMatrix({
    coverage:evidenceCoverage,
    refreshPlan:lookupSourceRefreshPlan,
    timing:lookupTiming,
    observedAt:lookupObservedAt,
    observedAtByEvidence:evidenceObservedAtById,
  }));
  const lookupSummary=$derived(buildLookupSummaryModel({
    availability,
    rdapParsed,
    whoisParsed,
    registrarRdap,
    registryComparison:comparison,
    registrarPublicationComparison,
    diagnostics,
    profileSignals,
    idnAnalysis,
    resultObservedAt:lookupObservedAt,
    createdDate:lifecycleDates.created,
    expiresDate:lifecycleDates.expires,
    updatedDate:lifecycleDates.updated,
  }));
  const lookupInvestigationBrief=$derived(buildLookupInvestigationBrief({
    target:result?.registrableDomain||result?.query,
    targetType:result?.type,
    task:taskView,
    summary:lookupSummary,
    decisionSupport:lookupDecisionSupport,
    quality:evidenceQualityMatrix,
    graph:lookupAssetGraph,
  }));
  const evidenceTopologyTarget=$derived({
    label:show(result?.registrableDomain||result?.query),
    detail:`${show(result?.type)} · ${lookupEvidenceDepth} lookup`,
    status:show(availability.state),
  });
  const caseEvidence=$derived({
    availability:String(availability.state||''),
    confidence:availability.confidence?String(availability.confidence):null,
    riskModelVersion:risk?.modelVersion??null,
    riskScore:risk?risk.score:null,
    opportunityScore:opportunity?opportunity.score:null,
    riskFactors:risk?risk.factors.map((f)=>({label:f.label,points:f.delta})):[],
    opportunityFactors:opportunity?opportunity.factors.map((f)=>({label:f.label,points:f.delta})):[],
    registrar:entityDisplayName(availability.registrar)||entityDisplayName(rdapParsed.registrar)||entityDisplayName(whoisParsed.registrar),
    createdDate:lifecycleDates.created,
    expiryDate:lifecycleDates.expires,
    nameservers:Array.isArray(availability.nameservers)?availability.nameservers:[],
    hasMx:availability.hasMx??null,hasSpf:availability.hasSpf??null,hasDmarc:availability.hasDmarc??null,
    activityStatus:availability.activityStatus?String(availability.activityStatus):null,
    websiteProbeDetail:availability.websiteProbeDetail?String(availability.websiteProbeDetail):null,
    pageTitle:availability.pageTitle??null,
    faviconMatch:profileSignals.faviconMatch??null,faviconNearMatch:profileSignals.faviconNearMatch??null,
    reusesOfficialAssets:profileSignals.reusesOfficialAssets??null,hasPasswordField:availability.hasPasswordField??null,
    hasExternalFormAction:availability.hasExternalFormAction??null,
    phishingLanguageMatch:availability.phishingLanguageMatch??null,
    ...compactHttpSummary,
    mutationTypes:[]
  });
  const checkpointFacts=$derived(result?.type==='domain'
    ? buildLookupCheckpointFacts(result,{collectionDepth:lookupEvidenceDepth})
    : []);

  async function refreshProfileContext(){
    try{profile=await activeProfile();}
    catch{profile=null;}
  }
  async function refreshCase(){
    const next=await lookupCaseController.refresh(caseDomain);
    caseRecord=next.record;
    caseStatus=next.status;
  }
  async function openLookupCase(){
    const next=await lookupCaseController.open(caseDomain,caseEvidence,lookupEvidenceDepth);
    caseRecord=next.record;
    caseStatus=next.status;
  }
  async function addLookupNote(){
    const next=await lookupCaseController.appendNote(caseRecord,caseNote);
    caseRecord=next.record;
    caseStatus=next.status;
    if(next.clearNote)caseNote='';
  }
  async function recordAbuseRecipient(route:Parameters<LookupCaseController['recordRecipient']>[1]){
    const next=await lookupCaseController.recordRecipient(caseRecord,route);
    caseRecord=next.record;
    caseStatus=next.status;
  }
  async function saveEvidenceCheckpoint(selectedFields:string[],transitionExpectations:Readonly<Record<string,CaseTransitionExpectation>>={}){
    const next=await lookupCaseController.recordCheckpoint(caseRecord,checkpointFacts,selectedFields,transitionExpectations);
    caseRecord=next.record;
    caseStatus=next.status;
  }
  async function copyInvestigationBrief(){
    await copyDraft(formatLookupInvestigationBriefMarkdown(lookupInvestigationBrief),'investigation brief');
  }
  async function recordInvestigationBriefHandoff(){
    const next=await lookupCaseController.recordBriefHandoff(caseRecord,{
      target:lookupInvestigationBrief.target,
      taskLabel:lookupInvestigationBrief.taskLabel,
      generatedAt:lookupInvestigationBrief.generatedAt,
      contradictionCount:lookupInvestigationBrief.contradictions.length,
      unknownCount:lookupInvestigationBrief.unknowns.length,
    });
    caseRecord=next.record;
    caseStatus=next.status;
  }
  function cancelLookup(){lookupRequestController.cancel();}
  function setEvidenceDensity(value:LookupEvidenceDensity){
    evidenceDensity=normalizeLookupEvidenceDensity(value);
    writeLookupPresentation(localStorage,{density:evidenceDensity,task:taskView});
  }
  function setTaskView(value:LookupTaskView){
    taskView=normalizeLookupTaskView(value);
    writeLookupPresentation(localStorage,{density:evidenceDensity,task:taskView});
  }
  onMount(()=>{
    pageActive=true;
    const presentation=readLookupPresentation(localStorage);
    evidenceDensity=presentation.density;
    taskView=presentation.task;
    const restored=readLookupWorkflowState();
    if(restored){query=restored.query;lookupMode=restored.lookupMode;includeExternalIntelligence=restored.includeExternalIntelligence;includeMalwareHostIntelligence=restored.includeMalwareHostIntelligence;includeMalwareIocIntelligence=restored.includeMalwareIocIntelligence;includeSecurityTxt=restored.includeSecurityTxt;error=restored.error;result=restored.result;}
    const q=page.url.searchParams.get('q');
    const requestedDepth=page.url.searchParams.get('depth');
    const targetChanged=Boolean(q&&q!==query);
    const depthChanged=Boolean(requestedDepth&&(requestedDepth==='fast'||requestedDepth==='deep')&&requestedDepth!==lookupMode);
    if(q&&(targetChanged||depthChanged)){query=q;result=null;error='';}
    else if(q)query=q;
    if(requestedDepth==='fast'||requestedDepth==='deep')lookupMode=requestedDepth;
    void (async()=>{await refreshProfileContext();if(result)await refreshCase();})();
    return()=>{
      pageActive=false;
      lookupRequestController.dispose();
      writeLookupWorkflowState({query,lookupMode,includeExternalIntelligence,includeMalwareHostIntelligence,includeMalwareIocIntelligence,includeSecurityTxt,error,result});
    };
  });

  function websiteSnapshotInput(){
    const now=new Date().toISOString();
    return buildLookupWebsiteSnapshot({
      id:crypto.randomUUID?crypto.randomUUID():`website-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      domain:caseDomain,
      observedAt:lookupObservedAt||now,
      savedAt:now,
      lookupEvidenceDepth,
      technologyProfile,
      securityPosture,
      tlsEvidence,
      baseline:observedPageBaseline,
      pageIdentity,
      technologyFindings:pageDisplay.technologyFindings,
      securityPostureFindings:pageDisplay.securityPostureFindings,
      diagnostics,
    });
  }
  function downloadEvidence(){if(!result)return;const body=JSON.stringify(buildLookupEvidence(result,{idnAnalysis}),null,2);const url=URL.createObjectURL(new Blob([body],{type:'application/json'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=evidenceFilename(result);anchor.click();URL.revokeObjectURL(url);}
  function downloadReadableReport(){if(!result)return;const body=buildLookupReadableReport(result,{risk});const url=URL.createObjectURL(new Blob([body],{type:'text/markdown;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=lookupReadableReportFilename(result);anchor.click();URL.revokeObjectURL(url);}
  function downloadInvestigationBrief(){if(!result)return;const body=formatLookupInvestigationBriefMarkdown(lookupInvestigationBrief);const url=URL.createObjectURL(new Blob([body],{type:'text/markdown;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=lookupInvestigationBriefFilename(lookupInvestigationBrief);anchor.click();URL.revokeObjectURL(url);}
  async function copyDraft(text:string,label:string){try{await navigator.clipboard.writeText(text);draftStatus=`Copied ${label} to the clipboard.`;}catch{draftStatus='Clipboard access was unavailable. Use the email draft link instead.';}}
  function resultSectionLinks(){return buildLookupResultSectionLinks({
      hasWebEvidence,
      domainResult:result?.type==='domain',
      hasExternalIntelligence:threatIntelligenceProviders.length>0,
      hasCaseSection,
      task:taskView,
    });}
  async function submit(event:SubmitEvent){
    event.preventDefault();
    if(lookupDisabled){error=lookupDisabled.reason||'Lookup is disabled by deployment policy.';return;}
    if(!entries.length||loading)return;
    if(entries.length>1){
      result=null;error='';
      saveCandidateHandoff('manual',entries.slice(0,2000).map(domain=>({domain:domain.toLowerCase(),source:'manual input',mutationTypes:[]})));
      await goto('/bulk?source=lookup');
      return;
    }

    loading=true;loadingElapsedMs=0;error='';result=null;caseRecord=null;caseNote='';caseStatus='';serviceDependencyScope='';serviceDependencyFalsePositives='';
    const target=entries[0];if(!target)return;
    const lookupUrl=buildLookupRequestUrl(target,{
      mode:lookupMode,
      includeExternalIntelligence,
      externalIntelligenceSupported,
      includeMalwareHostIntelligence,
      malwareHostIntelligenceSupported,
      includeMalwareIocIntelligence,
      malwareIocIntelligenceSupported,
      includeSecurityTxt,
      securityTxtSupported,
      securityTxtEligible,
    });

    try{
      const completed=await lookupRequestController.run(
        lookupUrl,
        (elapsedMs)=>{loadingElapsedMs=elapsedMs;},
        refreshProfileContext,
      );
      if(completed.state==='stale'||!pageActive)return;
      const outcome=completed.outcome;
      if(!outcome.ok){error=outcome.message;return;}
      result=outcome.value;
      await refreshCase();
      requestAnimationFrame(()=>document.querySelector('#result')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'}));
    }catch{
      if(pageActive)error='Lookup request could not be prepared.';
    }finally{
      if(pageActive)loading=false;
    }
  }
</script>

<svelte:head><title>Lookup · WHOISleuth</title></svelte:head>
<PageHeading eyebrow="Investigate" title="Lookup" description="Look up a domain, IP address, or ASN using RDAP and WHOIS, with DNS, HTTP, and bounded TLS/certificate checks for domains." />
<LookupForm
  bind:query
  bind:lookupMode
  {loading}
  {loadingElapsedMs}
  loadingDeadlineMs={LOOKUP_CLIENT_TIMEOUT_MS}
  entryCount={entries.length}
  duplicateCount={parsedInput.duplicates}
  {lookupDisabled}
  {lookupLimitations}
  {externalIntelligenceSupported}
  {malwareHostIntelligenceSupported}
  {malwareIocIntelligenceSupported}
  {securityTxtSupported}
  {securityTxtEligible}
  bind:includeExternalIntelligence
  bind:includeMalwareHostIntelligence
  bind:includeMalwareIocIntelligence
  bind:includeSecurityTxt
  {error}
  onsubmit={submit}
  oncancel={cancelLookup}
/>

<LookupEvidenceReplay />

{#if result}
  <section class="result-root" id="result">
    <LookupResultHeader title={show(result.registrableDomain||result.query)} state={show(availability.state)} isSubdomain={Boolean(result.isSubdomain)} registrableDomain={show(result.registrableDomain)} inputHostname={show(result.inputHostname)} onExport={downloadEvidence} onReportExport={downloadReadableReport} onBriefExport={downloadInvestigationBrief} />

    <LookupPresentationControls density={evidenceDensity} task={taskView} setDensity={setEvidenceDensity} setTask={setTaskView} />

    <LocalSectionNav label="Result sections" links={resultSectionLinks()} trackCurrent />

    <div class="evidence-density density-{evidenceDensity}">
    <section class="result-section family-overview" id="overview" aria-labelledby="overview-title">
      <h3 id="overview-title">Overview</h3>

      {#if availability.applicable!==false}
        <LookupAssessment detail={show(availability.detail||availability.state)} confidence={show(availability.confidence)} {risk} {opportunity} signals={[...lookupSummary.signals]} trusted={String(profileSignals.trusted||'')} />
      {/if}

      <LookupDecisionSupport
        support={lookupDecisionSupport}
        onbriefcopy={copyInvestigationBrief}
        onbriefhandoff={caseRecord ? recordInvestigationBriefHandoff : null}
      />

      {#if sslbl.sslblVersion===1&&sslbl.verdict==='listed'}
        <aside class="sslbl-review-lead" aria-labelledby="sslbl-review-lead-title">
          <div>
            <p class="eyebrow">Certificate review lead</p>
            <h4 id="sslbl-review-lead-title">The observed leaf certificate matched the local SSLBL snapshot</h4>
            <p>This is attributed warning data for analyst review. It does not establish current activity, ownership, or maliciousness and does not change Risk scoring.</p>
          </div>
          <a class="button secondary" href="#evidence-sslbl">Review certificate evidence</a>
        </aside>
      {/if}

      <EvidenceTopology
        id="lookup-evidence-topology"
        title="Evidence topology"
        description="Use this bounded map to jump to separately attributed source and derived-evidence sections. A missing or failed source remains explicit and is not treated as evidence of absence."
        target={evidenceTopologyTarget}
        nodes={evidenceTopologyNodes}
      />

      <LookupAssetGraph graph={lookupAssetGraph} />

      <AnalystEvidencePivots pivots={analystEvidencePivots} />

      <LookupLifecycle events={activationContext.events} />

      {#if result.type==='domain'}
        <LookupActivationContext context={activationContext} />
        <LookupAcquisitionDueDiligence
          review={acquisitionDueDiligence}
          target={caseDomain}
          observedAt={lookupObservedAt}
        />
      {/if}

      <LookupEvidenceQuality
        matrix={evidenceQualityMatrix}
        refreshPlan={lookupSourceRefreshPlan}
        query={String(result?.query || caseDomain)}
        depth={lookupEvidenceDepth}
      />

      <LookupOverviewFacts facts={[...lookupSummary.facts]} diagnostics={[...lookupSummary.diagnostics]} hasAssessment={availability.applicable!==false} />

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
    <section class="result-section family-web" id="web-evidence" aria-labelledby="web-evidence-title">
      <h3 id="web-evidence-title">{result.type==='domain'?'Web and DNS evidence':'DNS evidence'}</h3>
      {#if result.type==='domain'}
        <WebsiteSnapshotManager
          domain={caseDomain}
          canSave={!loading&&lookupEvidenceDepth==='deep'&&Boolean(caseDomain)&&technologyProfile.source==='derived'&&securityPosture.source==='derived'}
          buildSnapshot={websiteSnapshotInput}
        />
      {/if}

      {#if reverseDns.source==='reverse_dns'}
        <div class="evidence-component" id="evidence-reverse-dns"><LookupDnsEvidence
          title="Reverse DNS context"
          summaryDetail="Expand for PTR names, provenance, and limitations"
          status={show(reverseDns.status)}
          complete={reverseDns.complete!==false}
          rows={networkDisplay.reverseDnsRows}
          failureDetail={networkDisplay.reverseDnsFailure}
          truncated={Boolean(reverseDns.truncated)}
          note="Point-in-time PTR evidence is controlled by the address operator. It may be absent, stale, generic, or misleading and does not prove hosting control, ownership, service identity, intent, or maliciousness."
        /></div>
      {/if}

      {#if dnsEvidence.source==='dns'}
        <div class="evidence-component" id="evidence-dns"><LookupDnsEvidence
          status={show(dnsEvidence.status)}
          complete={dnsEvidence.complete!==false}
          rows={networkDisplay.dnsRows}
          failureDetail={networkDisplay.dnsQueryFailures}
          truncated={Boolean(dnsEvidence.truncated)}
          delegation={networkDisplay.dnsDelegation}
          rehearsalEvidence={dnsRehearsalEvidence}
          domain={caseDomain}
          allowRehearsal={result?.type === 'domain'}
          initiallyExpanded={lookupTaskInitiallyExpands(taskView,'dns')}
          note="Point-in-time resolver evidence. HTTPS service-binding targets, aliases, ports, and address hints are displayed as publication evidence only; WHOISleuth does not follow or connect to them. Shared DNS infrastructure does not prove common ownership or maliciousness."
        /></div>
        {#if serviceDependencyReview}
          <div class="evidence-component"><LookupServiceDependencyReview
            review={serviceDependencyReview}
            target={caseDomain}
            technologies={pageDisplay.technologyFindings}
            libraries={pageDisplay.browserLibraries}
            bind:authorizedScope={serviceDependencyScope}
            bind:falsePositiveTargets={serviceDependencyFalsePositives}
          /></div>
        {/if}
      {/if}

      {#if httpEvidence.source==='http'}
        <div class="evidence-component" id="evidence-http"><LookupHttpEvidence status={statusLabel(show(httpEvidence.status))} complete={httpEvidence.complete!==false} rows={networkDisplay.httpRows} crossOriginRedirect={Boolean(httpEvidence.crossOriginRedirect)} httpsDowngrade={Boolean(httpEvidence.httpsDowngrade)} redirects={networkDisplay.httpRedirects} attempts={networkDisplay.httpAttempts} metadata={networkDisplay.httpMetadata} limitations={Array.isArray(httpEvidence.limitations)?httpEvidence.limitations.map(String):[]} initiallyExpanded={lookupTaskInitiallyExpands(taskView,'http')} /></div>
      {/if}

      {#if tlsEvidence.source==='tls'}
        <div class="evidence-component" id="evidence-tls"><LookupTlsEvidence status={statusLabel(show(tlsEvidence.status))} complete={tlsEvidence.complete!==false} rows={networkDisplay.tlsRows} findings={networkDisplay.tlsFindings} leafCertificate={networkDisplay.leafCertificate} alternativeNames={networkDisplay.alternativeNames} alternativeNamesTruncated={Boolean(tlsAltNames.truncated)} chain={networkDisplay.tlsChain} chainTruncated={Boolean(tlsEvidence.chainTruncated)} validationDetails={networkDisplay.tlsValidation} limitations={Array.isArray(tlsEvidence.limitations)?tlsEvidence.limitations.map(String):[]} validFrom={typeof tlsCertificate.validFrom==='string'?tlsCertificate.validFrom:null} validTo={typeof tlsCertificate.validTo==='string'?tlsCertificate.validTo:null} observedAt={lookupObservedAt} initiallyExpanded={lookupTaskInitiallyExpands(taskView,'tls')} /></div>
        <div class="evidence-component"><LookupCertificatePolicyReview review={certificatePolicyReview} /></div>
      {/if}

      {#if sslbl.sslblVersion===1}
        <div class="evidence-component" id="evidence-sslbl"><LookupSslblEvidence
          status={boundedTechnologyText(sslbl.status||'unavailable',40)}
          verdict={boundedTechnologyText(sslbl.verdict||'inconclusive',40)}
          complete={sslbl.complete===true}
          detail={boundedTechnologyText(sslbl.detail||'Certificate warning-data comparison was unavailable.',500)}
          fingerprint={boundedTechnologyText(sslbl.fingerprintSha1,40)}
          referenceUrl={boundedTechnologyText(sslbl.referenceUrl,2048)}
          sourceUpdatedAt={dateTimeAttribute(sslblSnapshot.sourceUpdatedAt)||''}
          generatedAt={dateTimeAttribute(sslblSnapshot.generatedAt)||''}
          entryCount={Number.isSafeInteger(sslblSnapshot.entryCount)?Number(sslblSnapshot.entryCount):null}
          digest={boundedTechnologyText(sslblSnapshot.digestSha256,64)}
          limitations={stringList(sslbl.limitations).slice(0,8)}
        /></div>
      {/if}

      {#if securityTxt.securityTxtVersion===1}
        <div class="evidence-component" id="evidence-security-txt"><LookupSecurityTxt
          state={boundedTechnologyText(securityTxt.state||'unavailable',40)}
          detail={boundedTechnologyText(securityTxt.detail||'Disclosure contact collection was unavailable.',300)}
          endpoint={boundedTechnologyText(securityTxt.finalUrl,2048)}
          httpStatus={securityTxt.httpStatus?String(securityTxt.httpStatus):''}
          observedAt={dateTimeAttribute(securityTxt.observedAt)||''}
          expiresAt={dateTimeAttribute(securityTxt.expiresAt)||''}
          contacts={stringList(securityTxt.contacts).slice(0,10)}
          policies={stringList(securityTxt.policies).slice(0,10)}
          encryption={stringList(securityTxt.encryption).slice(0,10)}
          languages={stringList(securityTxt.preferredLanguages).slice(0,10)}
          limitations={stringList(securityTxt.limitations).slice(0,10)}
        /></div>
      {/if}

      {#if pageIdentity.source==='html'}
        <div class="evidence-component" id="evidence-page"><LookupPageIdentity
          status={statusLabel(show(pageIdentity.status))}
          complete={Boolean(pageIdentity.complete)}
          facts={pageDisplay.pageIdentityFacts}
          externalFormOrigins={stringList(pageForms.externalActionOrigins)}
          resourceCount={Number(pageResources.count)||0}
          resourceSummary={pageDisplay.resourceSummary}
          embeddedOrigins={stringList(pageIdentity.embeddedOrigins)}
          contactDomains={stringList(pageIdentity.contactDomains)}
          downloadCount={Number(pageDownloads.count)||0}
          downloadSummary={pageDisplay.downloadSummary}
          trackingIdentifiers={pageDisplay.trackingIdentifiers}
          fingerprints={pageDisplay.fingerprints}
          limitations={stringList(pageIdentity.limitations)}
          initiallyExpanded={lookupTaskInitiallyExpands(taskView,'page-identity')}
        /></div>
      {/if}

      {#if credentialSurfaceProfile.source==='html'}
        {@const credentialSurface=pageDisplay.credentialSurface}
        <div class="evidence-component" id="evidence-credential-surface"><LookupCredentialSurfaceProfile
          status={statusLabel(show(credentialSurfaceProfile.status))}
          complete={Boolean(credentialSurfaceProfile.complete)}
          formCount={credentialSurface.formCount}
          inputCount={credentialSurface.inputCount}
          classifiedCount={credentialSurface.classifiedCount}
          categories={credentialSurface.categories}
          methods={credentialSurface.methods}
          actions={credentialSurface.actions}
          limitations={pageDisplay.credentialSurfaceLimitations}
          initiallyExpanded={lookupTaskInitiallyExpands(taskView,'credential-surface')}
        /></div>
      {/if}

      {#if securityPosture.source==='derived'}
        <div class="evidence-component" id="evidence-posture"><LookupSecurityPosture
          status={statusLabel(show(securityPosture.status))}
          complete={Boolean(securityPosture.complete)}
          summary={pageDisplay.securityPostureSummary}
          findings={pageDisplay.securityPostureFindings}
          limitations={pageDisplay.securityPostureLimitations}
          initiallyExpanded={lookupTaskInitiallyExpands(taskView,'security-posture')}
        /></div>
      {/if}

      {#if structuredDataIdentity.source==='html'}
        <div class="evidence-component" id="evidence-structured-identity"><LookupStructuredDataIdentity
          status={statusLabel(show(structuredDataIdentity.status))}
          complete={Boolean(structuredDataIdentity.complete)}
          entities={pageDisplay.structuredIdentities}
          limitations={pageDisplay.structuredIdentityLimitations}
          initiallyExpanded={lookupTaskInitiallyExpands(taskView,'structured-identity')}
        /></div>
      {/if}

      {#if technologyProfile.source==='derived'}
        <div class="evidence-component" id="evidence-technology"><LookupTechnologyProfile
          status={statusLabel(show(technologyProfile.status))}
          complete={Boolean(technologyProfile.complete)}
          findings={pageDisplay.technologyFindings}
          limitations={pageDisplay.technologyLimitations}
          libraryAvailable={browserLibraryProfile.profileVersion===1}
          libraryStatus={statusLabel(show(browserLibraryProfile.status))}
          libraryComplete={Boolean(browserLibraryProfile.complete)}
          libraryCatalog={boundedTechnologyText((browserLibraryProfile.catalog as JsonRecord)?.version,80)}
          libraries={pageDisplay.browserLibraries}
          libraryLimitations={pageDisplay.browserLibraryLimitations}
          initiallyExpanded={lookupTaskInitiallyExpands(taskView,'technology')}
        /></div>
      {/if}

      {#if pageRoleProfile.source==='derived' && clientBehaviorProfile.source==='derived'}
        <div class="evidence-component" id="evidence-page-role"><LookupPageRoleBehavior
          roleStatus={statusLabel(show(pageRoleProfile.status))}
          roleComplete={Boolean(pageRoleProfile.complete)}
          primaryRole={pageDisplay.primaryPageRole}
          roles={pageDisplay.pageRoles}
          roleLimitations={pageDisplay.pageRoleLimitations}
          behaviorStatus={statusLabel(show(clientBehaviorProfile.status))}
          behaviorComplete={Boolean(clientBehaviorProfile.complete)}
          scripts={pageDisplay.clientScriptSummary}
          indicators={pageDisplay.clientBehaviorIndicators}
          behaviorLimitations={pageDisplay.clientBehaviorLimitations}
        /></div>
      {/if}

      {#if pageComparison || (profile?.pageBaseline && result.type==='domain')}
        <div class="evidence-component"><LookupPageComparison comparison={pageDisplay.pageComparison} unavailable={Boolean(!pageComparison&&profile?.pageBaseline&&result.type==='domain')} /></div>
      {/if}
      {#if brandMimicryReview}
        <div class="evidence-component"><LookupBrandMimicryReview review={brandMimicryReview} /></div>
      {/if}
    </section>
    {/if}

    <section class="result-section family-registry" id="registry" aria-labelledby="registry-title">
      <h3 id="registry-title">Registry sources</h3>

      {#if registryAccess.suffix}
        <RegistryAccessNotice access={registryAccess} />
      {/if}

      <div class="evidence-component" id="evidence-registry"><LookupRegistrySources
        comparisonSummary={`RDAP / WHOIS comparison · ${comparison.counts.conflict} conflicts · ${sourceOnlyCount} source-only · ${redactedComparisonCount} redacted · ${limitedComparisonCount} unavailable/incomplete · ${comparison.counts.equivalent} equivalent`}
        comparisonRows={registryDisplay.comparisonRows}
        comparisonHasConflicts={comparison.counts.conflict>0}
        rdapError={rdap.error?String(rdap.error):''}
        resultType={String(result.type)}
        {rdapParsed}
        rdapPartialDetail={registryDisplay.rdapPartialDetail}
        rdapRows={registryDisplay.rdapRows}
        whoisError={whois.error?String(whois.error):''}
        whoisRows={registryDisplay.whoisRows}
        whoisContactRoles={registryDisplay.whoisContactRoles}
        whoisTruncatedFields={stringList(whoisParsed.fieldsTruncated)}
        insights={registryInsights}
        registrar={registryDisplay.registrarRdap}
      /></div>

      {#if observedNetworkContext.contextVersion===1}
        <div class="evidence-component" id="evidence-network"><LookupNetworkContext
          status={statusLabel(boundedTechnologyText(observedNetworkContext.status||'unsupported',40))}
          detail={boundedTechnologyText(observedNetworkContext.detail||'Observed network context was unavailable.',300)}
          address={boundedTechnologyText(observedNetworkEndpoint.address,64)}
          addressSource={pageDisplay.observedNetworkSourceLabel}
          rdapEndpoint={boundedTechnologyText(observedNetworkRdap.endpoint,2048)}
          httpStatus={observedNetworkRdap.httpStatus?String(observedNetworkRdap.httpStatus):''}
          fetchedAt={dateTimeAttribute(observedNetworkRdap.fetchedAt)||''}
          rows={pageDisplay.observedNetworkRows}
          limitations={pageDisplay.observedNetworkLimitations}
          initiallyExpanded={lookupTaskInitiallyExpands(taskView,'network-context')}
        /></div>
      {/if}
    </section>

    {#if threatIntelligenceProviders.length}
      <section class="result-section family-network" id="external-intelligence" aria-labelledby="external-intelligence-title">
        <h3 id="external-intelligence-title">External intelligence</h3>
        <LookupExternalIntelligence providers={threatIntelligenceProviders} riskContext={externalRiskContext} riskModelVersion={risk?.modelVersion ?? null} showValue={show} {formatDate} />
      </section>
    {/if}

    {#if hasCaseSection}
      <section class="result-section family-analyst" id="case-response" aria-labelledby="case-response-title">
        <h3 id="case-response-title">Case and response</h3>

        <LookupCaseResponse domain={caseDomain} record={caseRecord} note={caseNote} {caseStatus} {draftStatus} {outreach} recipientResolution={abuseRecipientResolution} setNote={(value) => caseNote = value} createCase={openLookupCase} addNote={addLookupNote} recordRecipient={recordAbuseRecipient} {copyDraft} statusLabel={caseStatusLabel} dispositionLabel={caseDispositionLabel} />
        {#if caseRecord && checkpointFacts.length}
          <LookupEvidenceCheckpoint facts={checkpointFacts} pins={caseRecord.evidencePins} onsave={saveEvidenceCheckpoint} />
        {/if}
      </section>
    {/if}

    <section class="result-section family-raw" id="raw-data" aria-labelledby="raw-data-title">
      <h3 id="raw-data-title">Raw evidence</h3>
      <details class="raw card"><summary>Raw unified response</summary><pre>{JSON.stringify(result,null,2)}</pre></details>
    </section>
    </div>
  </section>
{/if}

<style>
  .result-root{min-width:0;overflow-x:clip;overflow-clip-margin:3px}
  .evidence-density{display:contents}
  .density-standard .family-raw>:not(h3){display:none}
  .density-standard .family-raw{min-height:34px;margin-top:14px}
  .density-standard .family-raw>h3{margin-bottom:0}
  .density-summary>.result-section:not(.family-overview)>:not(h3){display:none}
  .density-summary>.result-section:not(.family-overview){min-height:34px;margin-top:14px}
  .density-summary>.result-section:not(.family-overview)>h3{margin-bottom:0}
  .result-section{--section-accent:var(--accent2);margin-top:26px}
  .result-section.family-web{--section-accent:var(--amber)}
  .result-section.family-registry{--section-accent:var(--accent2)}
  .result-section.family-network{--section-accent:var(--accent)}
  .result-section.family-analyst{--section-accent:var(--violet)}
  .result-section.family-raw{--section-accent:var(--muted)}
  .result-section>h3{display:flex;align-items:center;gap:10px;margin:0 0 12px;color:var(--section-accent);font:700 var(--text-2xs) var(--mono);letter-spacing:.09em;text-transform:uppercase}
  .result-section>h3::before{content:"//";color:var(--muted)}
  .result-section>h3::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,color-mix(in srgb,var(--section-accent) 60%,var(--border)),var(--border) 42%)}
  .result-section>.card,.result-section>.evidence-component{margin-top:12px}
  .result-section>:nth-child(2){margin-top:0}
  .evidence-component[id]{position:relative;scroll-margin-top:var(--local-nav-anchor-offset,88px)}
  .sslbl-review-lead{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:12px;padding:16px;border:1px solid color-mix(in srgb,var(--danger) 42%,var(--border));border-radius:var(--radius);background:color-mix(in srgb,var(--danger) 5%,var(--surface))}
  .sslbl-review-lead .eyebrow{margin:0 0 5px;color:var(--danger)}
  .sslbl-review-lead h4{margin:0;color:var(--text);font-size:var(--text-sm);line-height:1.35}
  .sslbl-review-lead p:not(.eyebrow){max-width:760px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .sslbl-review-lead .button{flex:0 0 auto}

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

  @media(max-width:700px){
    .sslbl-review-lead{align-items:stretch;flex-direction:column}
    .sslbl-review-lead .button{width:100%}
  }
</style>
