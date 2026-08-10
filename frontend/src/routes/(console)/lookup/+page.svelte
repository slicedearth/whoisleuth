<script lang="ts">
  import { goto } from '$app/navigation';
  import { getContext, onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import LocalSectionNav from '$lib/components/LocalSectionNav.svelte';
  import LookupAtAGlance from '$lib/components/LookupAtAGlance.svelte';
  import LookupAssessment from '$lib/components/LookupAssessment.svelte';
  import LookupAcquisitionDueDiligence from '$lib/components/LookupAcquisitionDueDiligence.svelte';
  import LookupFamilySummary from '$lib/components/LookupFamilySummary.svelte';
  import LookupBrandMimicryReview from '$lib/components/LookupBrandMimicryReview.svelte';
  import LookupVisualWorkspace, { type LookupVisualView } from '$lib/components/LookupVisualWorkspace.svelte';
  import LookupDecisionSupport from '$lib/components/LookupDecisionSupport.svelte';
  import LookupClaimReadiness from '$lib/components/LookupClaimReadiness.svelte';
  import LookupEvidenceQuality from '$lib/components/LookupEvidenceQuality.svelte';
  import LookupEvidenceReplay from '$lib/components/LookupEvidenceReplay.svelte';
  import LookupCertificatePolicyReview from '$lib/components/LookupCertificatePolicyReview.svelte';
  import LookupCredentialSurfaceProfile from '$lib/components/LookupCredentialSurfaceProfile.svelte';
  import LookupDnsEvidence from '$lib/components/LookupDnsEvidence.svelte';
  import LookupExternalIntelligence from '$lib/components/LookupExternalIntelligence.svelte';
  import LookupForm from '$lib/components/LookupForm.svelte';
  import LookupSavedContextPreview from '$lib/components/LookupSavedContextPreview.svelte';
  import LookupHttpEvidence from '$lib/components/LookupHttpEvidence.svelte';
  import LookupInvestigationCapsule from '$lib/components/LookupInvestigationCapsule.svelte';
  import LookupNetworkContext from '$lib/components/LookupNetworkContext.svelte';
  import LookupOverviewFacts from '$lib/components/LookupOverviewFacts.svelte';
  import LookupPageComparison from '$lib/components/LookupPageComparison.svelte';
  import LookupPageIdentity from '$lib/components/LookupPageIdentity.svelte';
  import LookupPageRoleBehavior from '$lib/components/LookupPageRoleBehavior.svelte';
  import LookupRegistrySources from '$lib/components/LookupRegistrySources.svelte';
  import RegistrationDisclosurePlanner from '$lib/components/RegistrationDisclosurePlanner.svelte';
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
  import { activeProfile, type ActiveBrandProfileSourceState, type BrandProfile } from '$lib/brand-profiles';
  import { dispositionLabel as caseDispositionLabel, statusLabel as caseStatusLabel, type CaseRecord, type CaseTransitionExpectation } from '$lib/cases';
  import { saveCandidateHandoff } from '$lib/candidate-handoff';
  import { buildLookupEvidence, evidenceFilename, serializeLookupEvidence } from '$lib/analysis/evidence-export.ts';
  import {
    formatLookupInvestigationBriefMarkdown,
    lookupInvestigationBriefFilename,
  } from '$lib/analysis/lookup-investigation-brief.ts';
  import {
    createLookupViewModel,
    type LookupHttpResponse,
  } from '$lib/analysis/lookup-response.ts';
  import {
    boundedTechnologyText,
    dateTimeAttribute,
    formatDate,
    rec,
    records,
    show,
    statusLabel,
    stringList,
    type JsonRecord,
  } from '$lib/analysis/lookup-display-model.ts';
  import { buildLookupRouteAnalysis } from '$lib/analysis/lookup-route-analysis.ts';
  import {
    buildLookupClaimPassport,
  } from '$lib/analysis/lookup-claim-passport.ts';
  import type { LookupClaimId } from '$lib/analysis/lookup-claim-readiness.ts';
  import type { LookupFreshnessPolicyInput, LookupFreshnessThresholds } from '$lib/analysis/lookup-source-refresh.ts';
  import {
    LOOKUP_CLIENT_TIMEOUT_MS,
  } from '$lib/analysis/lookup-request.ts';
  import {
    buildLookupRequestUrl,
    buildLookupResultSectionLinks,
    lookupEvidenceFamilyForHref,
    lookupEvidenceTargetForHref,
  } from '$lib/analysis/lookup-page-actions.ts';
  import { projectEvidenceTopology } from '$lib/analysis/evidence-topology.ts';
  import {
    normalizeLookupTaskView,
    lookupResultDepth,
    readLookupPresentation,
    reconcileLookupUrlState,
    writeLookupPresentation,
    type LookupTaskView,
  } from '$lib/analysis/lookup-presentation.ts';
  import { buildLookupWebsiteSnapshot } from '$lib/analysis/lookup-snapshot-input.ts';
  import {
    buildLookupReadableReport,
    lookupReadableReportFilename,
  } from '$lib/analysis/lookup-readable-report.ts';
  import { buildServiceDependencyReview } from '$lib/analysis/service-dependency-review.ts';
  import { parseDomainInput } from '$lib/analysis/utils.ts';
  import { CAPABILITY_CONTEXT, disabledCapabilities, disabledCapability, featureCapability, type CapabilityGetter } from '$lib/capabilities';
  import { readLookupWorkflowState, writeLookupWorkflowState } from '$lib/console-workflow-state.ts';
  import { LookupRequestController } from '$lib/controllers/lookup-request-controller';
  import { LookupCaseController, type LookupCaseActionResult } from '$lib/controllers/lookup-case-controller';
  type LookupMode = 'fast' | 'deep';

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
  let completedLookupTarget=$state('');
  let completedLookupDepth=$state<LookupMode|null>(null);
  let profile=$state<BrandProfile|null>(null);
  let profileSourceState=$state<ActiveBrandProfileSourceState>('loading');
  let draftStatus=$state('');
  let evidenceExportStatus=$state('');
  let caseRecord=$state<CaseRecord|null>(null);let caseNote=$state('');let caseStatus=$state('');
  let caseActionBusy=$state(false);
  let caseActionGeneration=0;
  let expandedResultSections=$state<string[]>([]);
  let detailedAssessmentOpen=$state(false);
  let taskView=$state<LookupTaskView>('general');
  let preferredTaskView=$state<LookupTaskView>('general');
  let visualView=$state<LookupVisualView>('sources');
  let freshnessPolicyMode=$state<'task-default'|'analyst-custom'>('task-default');
  let customFreshnessThresholds=$state<LookupFreshnessThresholds>({registration:30,network:7,web:3});
  const freshnessPolicyInput=$derived<LookupFreshnessPolicyInput|undefined>(freshnessPolicyMode==='analyst-custom'?{id:'analyst-custom',thresholdsDays:customFreshnessThresholds}:undefined);
  let serviceDependencyScope=$state('');
  let serviceDependencyFalsePositives=$state('');
  let pageActive=false;
  let urlReconciliationReady=$state(false);
  let lastReconciledUrl=$state('');
  let lookupRevision=0;
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
  const rdap=$derived(lookupView.rdap);
  const registrarRdap=$derived(lookupView.registrarRdap);
  const whois=$derived(lookupView.whois);
  const rdapParsed=$derived(lookupView.rdapParsed);
  const whoisParsed=$derived(lookupView.whoisParsed);
  const diagnostics=$derived(lookupView.diagnostics);
  const lookupTiming=$derived(lookupView.timing);
  const registryAccess=$derived(lookupView.registryAccess);
  const registryInsights=$derived(lookupView.registryInsights);
  const reverseDns=$derived(lookupView.reverseDns);
  const observedNetworkContext=$derived(lookupView.observedNetworkContext);
  const observedNetworkEndpoint=$derived(lookupView.observedNetworkEndpoint);
  const observedNetworkRdap=$derived(lookupView.observedNetworkRdap);
  const securityTxt=$derived(lookupView.securityTxt);
  const sslbl=$derived(lookupView.sslbl);
  const sslblSnapshot=$derived(rec(sslbl.snapshot));
  const threatIntelligenceProviders=$derived(lookupView.threatIntelligenceProviders);
  const dnsEvidence=$derived(lookupView.dnsEvidence);
  const dnsRecords=$derived(lookupView.dnsRecords);
  const httpEvidence=$derived(lookupView.httpEvidence);
  const tlsEvidence=$derived(lookupView.tlsEvidence);
  const tlsCertificate=$derived(lookupView.tlsCertificate);
  const tlsAltNames=$derived(lookupView.tlsAltNames);
  const pageIdentity=$derived(lookupView.pageIdentity);
  const pageForms=$derived(lookupView.pageForms);
  const pageResources=$derived(lookupView.pageResources);
  const pageDownloads=$derived(lookupView.pageDownloads);
  const credentialSurfaceProfile=$derived(lookupView.credentialSurfaceProfile);
  const structuredDataIdentity=$derived(lookupView.structuredDataIdentity);
  const technologyProfile=$derived(lookupView.technologyProfile);
  const pageRoleProfile=$derived(lookupView.pageRoleProfile);
  const clientBehaviorProfile=$derived(lookupView.clientBehaviorProfile);
  const browserLibraryProfile=$derived(rec(technologyProfile.browserLibraryProfile));
  const securityPosture=$derived(lookupView.securityPosture);
  const lookupAnalysis=$derived(buildLookupRouteAnalysis({
    result,
    lookupView,
    profile,
    profileSourceState,
    task:taskView,
    completedLookupDepth,
    ...(freshnessPolicyInput?{freshnessPolicy:freshnessPolicyInput}:{}),
  }));
  const lookupEvidenceDepth=$derived(lookupAnalysis.lookupEvidenceDepth);
  const lookupObservedAt=$derived(lookupAnalysis.lookupObservedAt);
  const populatedWhoisRoles=$derived(lookupAnalysis.populatedWhoisRoles);
  const comparison=$derived(lookupAnalysis.comparison);
  const registrarPublicationComparison=$derived(lookupAnalysis.registrarPublicationComparison);
  const lifecycleDates=$derived(lookupAnalysis.lifecycleDates);
  const networkDisplay=$derived(lookupAnalysis.networkDisplay);
  const dnsRehearsalEvidence=$derived(lookupAnalysis.dnsRehearsalEvidence);
  const registryDisplay=$derived(lookupAnalysis.registryDisplay);
  const idnAnalysis=$derived(lookupAnalysis.idnAnalysis);
  const profileSignals=$derived(lookupAnalysis.profileSignals);
  const externalRiskContext=$derived(lookupAnalysis.externalRiskContext);
  const opportunity=$derived(lookupAnalysis.opportunity);
  const risk=$derived(lookupAnalysis.risk);
  const riskSensitivity=$derived(lookupAnalysis.riskSensitivity);
  const outreach=$derived(lookupAnalysis.outreach);
  const abuseRecipientResolution=$derived(lookupAnalysis.abuseRecipientResolution);
  const sourceOnlyCount=$derived(lookupAnalysis.sourceOnlyCount);
  const redactedComparisonCount=$derived(lookupAnalysis.redactedComparisonCount);
  const limitedComparisonCount=$derived(lookupAnalysis.limitedComparisonCount);
  const caseDomain=$derived(lookupAnalysis.caseDomain);
  const observedPageBaseline=$derived(lookupAnalysis.observedPageBaseline);
  const pageComparison=$derived(lookupAnalysis.pageComparison);
  const pageDisplay=$derived(lookupAnalysis.pageDisplay);
  const brandMimicryReview=$derived(lookupAnalysis.brandMimicryReview);
  const hasWebEvidence=$derived(lookupAnalysis.hasWebEvidence);
  const hasCaseSection=$derived(lookupAnalysis.hasCaseSection);
  const evidenceTopologyNodes=$derived(lookupAnalysis.evidenceTopologyNodes);
  const certificatePolicyReview=$derived(lookupAnalysis.certificatePolicyReview);
  const lookupAssetGraph=$derived(lookupAnalysis.lookupAssetGraph);
  const analystEvidencePivots=$derived(lookupAnalysis.analystEvidencePivots);
  const activationContext=$derived(lookupAnalysis.activationContext);
  const acquisitionDueDiligence=$derived(lookupAnalysis.acquisitionDueDiligence);
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
  const evidenceCoverage=$derived(lookupAnalysis.evidenceCoverage);
  const evidenceObservedAtById=$derived(lookupAnalysis.evidenceObservedAtById);
  const lookupSourceRefreshPlan=$derived(lookupAnalysis.lookupSourceRefreshPlan);
  const lookupDecisionSupport=$derived(lookupAnalysis.lookupDecisionSupport);
  const lookupClaimReadiness=$derived(lookupAnalysis.lookupClaimReadiness);
  const lookupEvidenceImpactPlan=$derived(lookupAnalysis.lookupEvidenceImpactPlan);
  const evidenceQualityMatrix=$derived(lookupAnalysis.evidenceQualityMatrix);
  const lookupSummary=$derived(lookupAnalysis.lookupSummary);
  const lookupInvestigationBrief=$derived(lookupAnalysis.lookupInvestigationBrief);
  const lookupEvidenceDocument=$derived(result?buildLookupEvidence(result,{idnAnalysis,applicationVersion:__WHOISLEUTH_VERSION__}):null);
  const evidenceTopologyTarget=$derived(lookupAnalysis.evidenceTopologyTarget);
  const evidenceTopologyProjection=$derived(projectEvidenceTopology(evidenceTopologyTarget,evidenceTopologyNodes));
  const caseEvidence=$derived(lookupAnalysis.caseEvidence);
  const checkpointFacts=$derived(lookupAnalysis.checkpointFacts);
  const profileContextLimitation=$derived(lookupAnalysis.profileContextLimitation);

  async function refreshProfileContext(){
    profileSourceState='loading';profile=null;
    try{profile=await activeProfile();profileSourceState='ready';}
    catch{profile=null;profileSourceState='unavailable';}
  }
  async function refreshCase(expectedRevision:number|null=null){
    const requestedDomain=caseDomain;
    const actionGeneration=caseActionGeneration;
    const next=await lookupCaseController.refresh(requestedDomain);
    if(actionGeneration!==caseActionGeneration||(expectedRevision!==null&&(expectedRevision!==lookupRevision||caseDomain!==requestedDomain)))return;
    caseRecord=next.record;
    caseStatus=next.status;
  }
  function invalidateCaseActions(){caseActionGeneration+=1;caseActionBusy=false;}
  async function performCaseAction(
    action:()=>Promise<LookupCaseActionResult>,
    afterPublish:(next:LookupCaseActionResult)=>void=()=>{},
  ):Promise<boolean>{
    if(caseActionBusy)return false;
    const generation=++caseActionGeneration;
    const revision=lookupRevision;
    const domain=caseDomain;
    const recordId=caseRecord?.id||'';
    caseActionBusy=true;
    try{
      const next=await action();
      if(generation!==caseActionGeneration||revision!==lookupRevision||domain!==caseDomain||(caseRecord?.id||'')!==recordId)return false;
      caseRecord=next.record;
      caseStatus=next.status;
      afterPublish(next);
      return true;
    }finally{
      if(generation===caseActionGeneration)caseActionBusy=false;
    }
  }
  async function openLookupCase(){const domain=caseDomain;const evidence=caseEvidence;const depth=lookupEvidenceDepth;await performCaseAction(()=>lookupCaseController.open(domain,evidence,depth));}
  async function addLookupNote(){const record=caseRecord;const note=caseNote;await performCaseAction(()=>lookupCaseController.appendNote(record,note),(next)=>{if(next.clearNote)caseNote='';});}
  async function recordAbuseRecipient(route:Parameters<LookupCaseController['recordRecipient']>[1]){const record=caseRecord;await performCaseAction(()=>lookupCaseController.recordRecipient(record,route));}
  async function saveEvidenceCheckpoint(selectedFields:string[],transitionExpectations:Readonly<Record<string,CaseTransitionExpectation>>={}){const record=caseRecord;const facts=checkpointFacts;await performCaseAction(()=>lookupCaseController.recordCheckpoint(record,facts,[...selectedFields],{...transitionExpectations}));}
  async function copyInvestigationBrief(){
    await copyDraft(formatLookupInvestigationBriefMarkdown(lookupInvestigationBrief),'investigation brief');
  }
  async function recordInvestigationBriefHandoff(){
    const record=caseRecord;
    const brief={
      target:lookupInvestigationBrief.target,
      taskLabel:lookupInvestigationBrief.taskLabel,
      generatedAt:lookupInvestigationBrief.generatedAt,
      contradictionCount:lookupInvestigationBrief.contradictions.length,
      unknownCount:lookupInvestigationBrief.unknowns.length,
    };
    await performCaseAction(()=>lookupCaseController.recordBriefHandoff(record,brief));
  }
  function cancelLookup(){lookupRequestController.cancel();}
  function visualViewForTask(value:LookupTaskView):LookupVisualView{
    if(value==='acquisition'||value==='owned')return 'timeline';
    if(value==='brand'||value==='incident')return 'relationships';
    return 'sources';
  }
  function setTaskView(value:LookupTaskView){
    taskView=normalizeLookupTaskView(value);
    preferredTaskView=taskView;
    visualView=visualViewForTask(taskView);
    writeLookupPresentation(localStorage,{task:taskView});
  }
  function lookupUrlSignature(url:URL):string{return `${url.pathname}${url.search}`;}
  function invalidateLookupForInputChange(){
    lookupRevision+=1;
    lookupRequestController.invalidate();
    loading=false;
    loadingElapsedMs=0;
  }
  function clearCompletedLookupContext(){
    invalidateCaseActions();
    result=null;
    completedLookupTarget='';
    completedLookupDepth=null;
    caseRecord=null;
    caseNote='';
    caseStatus='';
    expandedResultSections=[];
    detailedAssessmentOpen=false;
  }
  function handleLookupQueryChange(value:string){
    query=value;
    if(!loading)return;
    invalidateLookupForInputChange();
    clearCompletedLookupContext();
    error='';
  }
  function applyLookupUrl(url:URL){
    const next=reconcileLookupUrlState({
      query,
      depth:lookupMode,
      task:taskView,
      result,
      completedTarget:completedLookupTarget,
      error,
      retainedResultDepth:result?completedLookupDepth??lookupResultDepth(result):null,
    },url.searchParams,preferredTaskView);
    const lookupInputChanged=next.query!==query||next.depth!==lookupMode;
    const clearedResult=Boolean(result&&!next.result);
    if(lookupInputChanged||clearedResult)invalidateLookupForInputChange();
    query=next.query;
    lookupMode=next.depth;
    taskView=next.task;
    visualView=visualViewForTask(taskView);
    result=next.result;
    completedLookupTarget=next.completedTarget;
    error=next.error;
    if(clearedResult)clearCompletedLookupContext();
    lastReconciledUrl=lookupUrlSignature(url);
  }
  $effect(()=>{
    const signature=lookupUrlSignature(page.url);
    if(!urlReconciliationReady||signature===lastReconciledUrl)return;
    applyLookupUrl(page.url);
  });
  async function showSectionDetail(sectionId:string){
    expandedResultSections=expandedResultSections.includes(sectionId)
      ? expandedResultSections
      : [...expandedResultSections,sectionId];
    await tick();
    document.getElementById(sectionId)?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  }
  async function hideSectionDetail(sectionId:string){
    expandedResultSections=expandedResultSections.filter((id)=>id!==sectionId);
    await tick();
    document.getElementById(sectionId)?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  }
  function expandableResultSectionIds():string[]{
    return resultSectionLinks()
      .map((section)=>section.href.slice(1))
      .filter((sectionId)=>sectionId!=='overview');
  }
  function expandAllSectionDetails(){
    expandedResultSections=expandableResultSectionIds();
  }
  function collapseAllSectionDetails(){
    expandedResultSections=[];
  }
  function allSectionDetailsVisible():boolean{
    const sectionIds=expandableResultSectionIds();
    return sectionIds.length>0&&sectionIds.every((sectionId)=>expandedResultSections.includes(sectionId));
  }
  function anySectionDetailsVisible():boolean{
    return expandableResultSectionIds().some((sectionId)=>expandedResultSections.includes(sectionId));
  }
  async function navigateToResultSection(href:string){
    const sectionId=href.startsWith('#')?href.slice(1):'';
    if(!sectionId)return;
    if(sectionId!=='overview'&&!expandedResultSections.includes(sectionId)){
      expandedResultSections=[...expandedResultSections,sectionId];
    }
    await tick();
    const target=document.getElementById(sectionId);
    if(!target)return;
    window.history.replaceState(window.history.state,'',href);
    target.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  }
  async function navigateToLookupEvidence(href:string){
    const familyId=lookupEvidenceFamilyForHref(href);
    if(!familyId)return;
    expandedResultSections=familyId==='overview'||expandedResultSections.includes(familyId)
      ? expandedResultSections
      : [...expandedResultSections,familyId];
    await tick();
    const normalizedHref=lookupEvidenceTargetForHref(href);
    const targetId=normalizedHref.slice(1);
    const target=document.getElementById(targetId);
    if(!target)return;
    window.history.replaceState(window.history.state,'',normalizedHref);
    target.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  }
  function handleLookupEvidenceLink(event:MouseEvent){
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    const origin=event.target;
    if(!(origin instanceof Element))return;
    const anchor=origin.closest<HTMLAnchorElement>('a[href^="#"]');
    if(!anchor)return;
    const href=anchor.getAttribute('href')||'';
    if(!lookupEvidenceFamilyForHref(href))return;
    event.preventDefault();
    void navigateToLookupEvidence(href);
  }
  function evidenceLinkNavigation(node:HTMLElement){
    node.addEventListener('click',handleLookupEvidenceLink);
    return {destroy:()=>node.removeEventListener('click',handleLookupEvidenceLink)};
  }
  function navigateToCurrentLookupHash(){
    const href=window.location.hash;
    if(result&&lookupEvidenceFamilyForHref(href))void navigateToLookupEvidence(href);
  }
  function sectionDetailVisible(sectionId:string):boolean{
    return expandedResultSections.includes(sectionId);
  }
  function setFreshnessPolicy(value:{mode:'task-default'|'analyst-custom';thresholdsDays:LookupFreshnessThresholds}){
    freshnessPolicyMode=value.mode;
    customFreshnessThresholds=value.thresholdsDays;
  }
  onMount(()=>{
    pageActive=true;
    const presentation=readLookupPresentation(localStorage);
    preferredTaskView=presentation.task;
    const restored=readLookupWorkflowState();
    if(restored){
      query=restored.query;lookupMode=restored.lookupMode;includeExternalIntelligence=restored.includeExternalIntelligence;includeMalwareHostIntelligence=restored.includeMalwareHostIntelligence;includeMalwareIocIntelligence=restored.includeMalwareIocIntelligence;includeSecurityTxt=restored.includeSecurityTxt;
      const restoredDepth=restored.result
        ? (restored.completedLookupDepth==='fast'||restored.completedLookupDepth==='deep'
            ? restored.completedLookupDepth
            : lookupResultDepth(restored.result))
        : null;
      result=restored.result&&restoredDepth?restored.result:null;
      completedLookupTarget=result?restored.completedTarget:'';
      completedLookupDepth=result?restoredDepth:null;
      error=restored.result&&!restoredDepth?'':restored.error;
    }
    applyLookupUrl(page.url);
    urlReconciliationReady=true;
    window.addEventListener('hashchange',navigateToCurrentLookupHash);
    if(result)requestAnimationFrame(navigateToCurrentLookupHash);
    void (async()=>{await refreshProfileContext();if(result)await refreshCase(lookupRevision);})();
    return()=>{
      pageActive=false;
      invalidateCaseActions();
      window.removeEventListener('hashchange',navigateToCurrentLookupHash);
      lookupRequestController.dispose();
      writeLookupWorkflowState({query,completedTarget:completedLookupTarget,completedLookupDepth,lookupMode,includeExternalIntelligence,includeMalwareHostIntelligence,includeMalwareIocIntelligence,includeSecurityTxt,error,result});
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
      dependencies:serviceDependencyReview?.dependencies??[],
    });
  }
  function downloadEvidence(){
    if(!result||!lookupEvidenceDocument)return;
    evidenceExportStatus='';
    try{
      const body=serializeLookupEvidence(lookupEvidenceDocument,true);
      const url=URL.createObjectURL(new Blob([body],{type:'application/json'}));
      const anchor=document.createElement('a');anchor.href=url;anchor.download=evidenceFilename(result);anchor.click();URL.revokeObjectURL(url);
    }catch{
      evidenceExportStatus='Evidence export was not created because the retained result exceeds the portable evidence bounds.';
    }
  }
  function downloadReadableReport(includeAttribution=true){if(!result)return;const body=buildLookupReadableReport(result,{risk,applicationVersion:__WHOISLEUTH_VERSION__,includeAttribution});const url=URL.createObjectURL(new Blob([body],{type:'text/markdown;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=lookupReadableReportFilename(result);anchor.click();URL.revokeObjectURL(url);}
  function downloadInvestigationBrief(){if(!result)return;const body=formatLookupInvestigationBriefMarkdown(lookupInvestigationBrief);const url=URL.createObjectURL(new Blob([body],{type:'text/markdown;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=lookupInvestigationBriefFilename(lookupInvestigationBrief);anchor.click();URL.revokeObjectURL(url);}
  async function downloadClaimPassport(claimId:LookupClaimId):Promise<string>{
    if(!result)throw new Error('Run a Lookup before exporting a claim passport.');
    const exported=await buildLookupClaimPassport({
      readiness:lookupClaimReadiness,
      claimId,
      targetType:result.type,
      target:result.query,
      lookupDepth:lookupEvidenceDepth,
      observedAt:lookupObservedAt,
      evidenceObservedAtById,
      riskModelVersion:risk?.modelVersion,
      applicationVersion:__WHOISLEUTH_VERSION__,
    });
    const url=URL.createObjectURL(new Blob([exported.content],{type:'application/json;charset=utf-8'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=exported.filename;anchor.click();URL.revokeObjectURL(url);
    return `Downloaded a portable passport for ${exported.document.claim.label}.`;
  }
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
      const handoffResult=saveCandidateHandoff('manual',entries.slice(0,2000).map(domain=>({domain:domain.toLowerCase(),source:'manual input',mutationTypes:[]})));
      if(!handoffResult.saved){error='This browser could not retain the selected domains for Bulk. Check site-storage access and try again.';return;}
      await goto(`/bulk?source=manual&handoff=${handoffResult.token}`);
      return;
    }

    invalidateCaseActions();
    loading=true;loadingElapsedMs=0;error='';result=null;completedLookupTarget='';completedLookupDepth=null;caseRecord=null;caseNote='';caseStatus='';serviceDependencyScope='';serviceDependencyFalsePositives='';expandedResultSections=[];detailedAssessmentOpen=false;
    const target=entries[0];if(!target)return;
    const requestedLookupMode=lookupMode;
    const requestRevision=++lookupRevision;
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
      if(completed.state==='stale'||!pageActive||requestRevision!==lookupRevision||entries[0]!==target||lookupMode!==requestedLookupMode)return;
      const outcome=completed.outcome;
      if(!outcome.ok){error=outcome.message;return;}
      result=outcome.value;completedLookupTarget=target;completedLookupDepth=requestedLookupMode;
      await refreshCase(requestRevision);
      if(!pageActive||requestRevision!==lookupRevision||entries[0]!==target||lookupMode!==requestedLookupMode)return;
      requestAnimationFrame(()=>{
        if(window.location.hash&&lookupEvidenceFamilyForHref(window.location.hash))navigateToCurrentLookupHash();
        else document.querySelector('#result')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
      });
    }catch{
      if(pageActive&&requestRevision===lookupRevision)error='Lookup request could not be prepared.';
    }finally{
      if(pageActive&&requestRevision===lookupRevision)loading=false;
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
  onquerychange={handleLookupQueryChange}
/>

<LookupSavedContextPreview {query} />

{#if profileContextLimitation}<p class="local-context-status" role="status">{profileContextLimitation}</p>{/if}

<LookupEvidenceReplay />

{#if result}
  <section class="result-root" id="result" use:evidenceLinkNavigation>
    <LookupResultHeader title={show(result.registrableDomain||result.query)} state={show(availability.state)} isSubdomain={Boolean(result.isSubdomain)} registrableDomain={show(result.registrableDomain)} inputHostname={show(result.inputHostname)} onExport={downloadEvidence} onReportExport={downloadReadableReport} onBriefExport={downloadInvestigationBrief} />
    {#if evidenceExportStatus}<p class="local-context-status" role="status">{evidenceExportStatus}</p>{/if}

    <LookupPresentationControls
      task={taskView}
      allSectionsExpanded={allSectionDetailsVisible()}
      anySectionsExpanded={anySectionDetailsVisible()}
      setTask={setTaskView}
      expandAll={expandAllSectionDetails}
      collapseAll={collapseAllSectionDetails}
    />

    <LocalSectionNav label="Result sections" links={resultSectionLinks()} trackCurrent onnavigate={(href)=>void navigateToResultSection(href)} />

    {#snippet overviewSection()}
    <section class="result-section family-overview" id="overview" aria-labelledby="overview-title">
      <h3 id="overview-title">Overview</h3>

      <LookupAtAGlance
        support={lookupDecisionSupport}
        quality={evidenceQualityMatrix}
        signals={lookupSummary.signals}
      />

      {#if availability.applicable!==false}
        <LookupAssessment detail={show(availability.detail||availability.state)} confidence={show(availability.confidence)} {risk} {riskSensitivity} {opportunity} signals={[...lookupSummary.signals]} trusted={String(profileSignals.trusted||'')} task={taskView} />
      {/if}

      <details class="detailed-assessment card" bind:open={detailedAssessmentOpen}>
        <summary>
          <span><strong>Detailed assessment</strong><small>Decision support, claim readiness, portable hand-off, and acquisition review</small></span>
          <span>{detailedAssessmentOpen?'Close assessment':'Open assessment'}</span>
        </summary>
        <div class="detailed-assessment-body">
        <LookupDecisionSupport
          support={lookupDecisionSupport}
          onbriefcopy={copyInvestigationBrief}
          onbriefhandoff={caseRecord ? recordInvestigationBriefHandoff : null}
          actionBusy={caseActionBusy}
        />
        <LookupClaimReadiness readiness={lookupClaimReadiness} impact={lookupEvidenceImpactPlan} onpassport={downloadClaimPassport} />

        {#if lookupEvidenceDocument}
          <LookupInvestigationCapsule
            applicationVersion={__WHOISLEUTH_VERSION__}
            lookupEvidence={lookupEvidenceDocument}
            brief={lookupInvestigationBrief}
            graph={lookupAssetGraph}
            {caseRecord}
          />
        {/if}

        {#if result?.type==='domain'}
          <LookupAcquisitionDueDiligence
            review={acquisitionDueDiligence}
            target={caseDomain}
            observedAt={lookupObservedAt}
          />
        {/if}
        </div>
      </details>
    </section>
    {/snippet}

    {#snippet webSection()}
    {#if hasWebEvidence}
    <section class="result-section family-web" id="web-evidence" aria-labelledby="web-evidence-title">
      <h3 id="web-evidence-title">{result?.type==='domain'?'Web and DNS evidence':'DNS evidence'}</h3>
      <LookupFamilySummary
        label={result?.type==='domain'?'Web and DNS evidence':'DNS evidence'}
        description="Review point-in-time DNS, HTTP, TLS, page identity, technology, and passive posture evidence without merging their source states."
        metrics={[`${evidenceQualityMatrix.entries.filter((entry)=>['network','web'].includes(entry.category.toLowerCase())).length} source records`, `${evidenceQualityMatrix.entries.filter((entry)=>['network','web'].includes(entry.category.toLowerCase())&&entry.state!=='complete').length} limited`]}
        expanded={sectionDetailVisible('web-evidence')}
        onshow={()=>void showSectionDetail('web-evidence')}
        onhide={()=>void hideSectionDetail('web-evidence')}
      />
      {#if sectionDetailVisible('web-evidence')}
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
      {#if result?.type==='domain'}
        <WebsiteSnapshotManager
          domain={caseDomain}
          canSave={!loading&&lookupEvidenceDepth==='deep'&&Boolean(caseDomain)&&technologyProfile.source==='derived'&&securityPosture.source==='derived'}
          buildSnapshot={websiteSnapshotInput}
        />
      {/if}

      {#if reverseDns.source==='reverse_dns'}
        <div class="evidence-component" id="evidence-reverse-dns"><LookupDnsEvidence
          headingId="reverse-dns-title"
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
          headingId="dns-title"
          status={show(dnsEvidence.status)}
          complete={dnsEvidence.complete!==false}
          rows={networkDisplay.dnsRows}
          failureDetail={networkDisplay.dnsQueryFailures}
          truncated={Boolean(dnsEvidence.truncated)}
          delegation={networkDisplay.dnsDelegation}
          rehearsalEvidence={dnsRehearsalEvidence}
          domain={caseDomain}
          allowRehearsal={result?.type === 'domain'}
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
        <div class="evidence-component" id="evidence-http"><LookupHttpEvidence status={statusLabel(show(httpEvidence.status))} complete={httpEvidence.complete!==false} rows={networkDisplay.httpRows} crossOriginRedirect={Boolean(httpEvidence.crossOriginRedirect)} httpsDowngrade={Boolean(httpEvidence.httpsDowngrade)} redirects={networkDisplay.httpRedirects} attempts={networkDisplay.httpAttempts} metadata={networkDisplay.httpMetadata} limitations={Array.isArray(httpEvidence.limitations)?httpEvidence.limitations.map(String):[]} /></div>
      {/if}

      {#if tlsEvidence.source==='tls'}
        <div class="evidence-component" id="evidence-tls"><LookupTlsEvidence status={statusLabel(show(tlsEvidence.status))} complete={tlsEvidence.complete!==false} rows={networkDisplay.tlsRows} findings={networkDisplay.tlsFindings} leafCertificate={networkDisplay.leafCertificate} alternativeNames={networkDisplay.alternativeNames} alternativeNamesTruncated={Boolean(tlsAltNames.truncated)} chain={networkDisplay.tlsChain} chainTruncated={Boolean(tlsEvidence.chainTruncated)} validationDetails={networkDisplay.tlsValidation} limitations={Array.isArray(tlsEvidence.limitations)?tlsEvidence.limitations.map(String):[]} validFrom={typeof tlsCertificate.validFrom==='string'?tlsCertificate.validFrom:null} validTo={typeof tlsCertificate.validTo==='string'?tlsCertificate.validTo:null} observedAt={lookupObservedAt} /></div>
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
        /></div>
      {/if}

      {#if securityPosture.source==='derived'}
        <div class="evidence-component" id="evidence-posture"><LookupSecurityPosture
          status={statusLabel(show(securityPosture.status))}
          complete={Boolean(securityPosture.complete)}
          summary={pageDisplay.securityPostureSummary}
          findings={pageDisplay.securityPostureFindings}
          limitations={pageDisplay.securityPostureLimitations}
        /></div>
      {/if}

      {#if structuredDataIdentity.source==='html'}
        <div class="evidence-component" id="evidence-structured-identity"><LookupStructuredDataIdentity
          status={statusLabel(show(structuredDataIdentity.status))}
          complete={Boolean(structuredDataIdentity.complete)}
          entities={pageDisplay.structuredIdentities}
          limitations={pageDisplay.structuredIdentityLimitations}
        /></div>
      {/if}

      {#if technologyProfile.source==='derived'}
        <div class="evidence-component" id="evidence-technology"><LookupTechnologyProfile
          status={statusLabel(show(technologyProfile.status))}
          complete={Boolean(technologyProfile.complete)}
          findings={pageDisplay.technologyFindings}
          limitations={pageDisplay.technologyLimitations}
          libraryAvailable={browserLibraryProfile.profileVersion===1||browserLibraryProfile.profileVersion===2}
          libraryStatus={statusLabel(show(browserLibraryProfile.status))}
          libraryComplete={Boolean(browserLibraryProfile.complete)}
          libraryCatalog={boundedTechnologyText((browserLibraryProfile.catalog as JsonRecord)?.version,80)}
          libraries={pageDisplay.browserLibraries}
          libraryLimitations={pageDisplay.browserLibraryLimitations}
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

      {#if pageComparison || (profile?.pageBaseline && result?.type==='domain')}
        <div class="evidence-component"><LookupPageComparison comparison={pageDisplay.pageComparison} unavailable={Boolean(!pageComparison&&profile?.pageBaseline&&result?.type==='domain')} /></div>
      {/if}
      {#if brandMimicryReview}
        <div class="evidence-component"><LookupBrandMimicryReview review={brandMimicryReview} /></div>
      {/if}
      {/if}
    </section>
    {/if}
    {/snippet}

    {#snippet registrySection()}
    <section class="result-section family-registry" id="registry" aria-labelledby="registry-title">
      <h3 id="registry-title">Registration</h3>

      <LookupFamilySummary
        label="Registration"
        description="Compare authoritative registry evidence with separately attributed registrar RDAP and WHOIS publications."
        metrics={[`${comparison.counts.equivalent} equivalent`, `${comparison.counts.conflict} conflicts`, `${sourceOnlyCount+redactedComparisonCount+limitedComparisonCount} limited or source-only`]}
        expanded={sectionDetailVisible('registry')}
        onshow={()=>void showSectionDetail('registry')}
        onhide={()=>void hideSectionDetail('registry')}
      />
      {#if sectionDetailVisible('registry')}
      {#if registryAccess.suffix}
        <RegistryAccessNotice access={registryAccess} lookupTarget={completedLookupTarget} />
      {/if}

      {#if idnAnalysis && (idnAnalysis.hasIdn || idnAnalysis.referenceMatches.length)}
        <section class="idn-card evidence-card card" aria-labelledby="idn-title">
          <header class="section-head"><div><p class="eyebrow">Domain identity</p><h4 id="idn-title">IDN and confusable review</h4></div><span>{idnAnalysis.mappingVersion}</span></header>
          <div class="idn-forms stat-grid"><article><small>Unicode display</small><strong>{idnAnalysis.unicodeDomain}</strong></article><article><small>DNS-safe ASCII</small><strong>{idnAnalysis.asciiDomain}</strong></article><article><small>Writing scripts</small><strong>{idnAnalysis.scripts.join(', ')||'None detected'}</strong></article></div>
          {#if idnAnalysis.findings.length}<ul class="finding-list">{#each idnAnalysis.findings as finding}<li class="callout {finding.tone==='warning'?'warn':'info'}"><strong>{finding.label}</strong><span>{finding.detail}</span></li>{/each}</ul>{/if}
          <p class="card-note">Review Unicode and ASCII forms together. These are bounded similarity indicators and do not establish maliciousness.</p>
        </section>
      {/if}

      <div class="evidence-component" id="evidence-registry"><LookupRegistrySources
        comparisonSummary={`RDAP / WHOIS comparison · ${comparison.counts.conflict} conflicts · ${sourceOnlyCount} source-only · ${redactedComparisonCount} redacted · ${limitedComparisonCount} unavailable/incomplete · ${comparison.counts.equivalent} equivalent`}
        comparisonRows={registryDisplay.comparisonRows}
        comparisonHasConflicts={comparison.counts.conflict>0}
        rdapError={rdap.error?String(rdap.error):''}
        resultType={String(result?.type||'')}
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

      {#if result?.type==='domain' && Array.isArray(rdapParsed.redactions) && rdapParsed.redactions.length}
        <div class="evidence-component"><RegistrationDisclosurePlanner
          domain={caseDomain}
          observedAt={lookupObservedAt}
          registryRdapEndpoint={boundedTechnologyText(rdap.endpoint,2048)}
          {rdapParsed}
          registrar={registryDisplay.registrarRdap}
          caseReference={caseRecord?.id ?? ''}
        /></div>
      {/if}

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
        /></div>
      {/if}
      {/if}
    </section>
    {/snippet}

    {#snippet relationshipsSection()}
    <section class="result-section family-relationships" id="relationships-history" aria-labelledby="relationships-history-title">
      <h3 id="relationships-history-title">Relationships and history</h3>
      <LookupFamilySummary
        label="Relationships and history"
        description="Inspect source coverage, exact observed relationships, optional passive pivots, and dated lifecycle events in one workspace."
        metrics={[`${evidenceTopologyProjection.provenanceCounts.direct} mapped direct sources`, `${evidenceTopologyProjection.provenanceCounts.derived} mapped derived analyses`, `${lookupAssetGraph.edges.length} relationships`, `${activationContext.events.filter((event)=>Boolean(event.date)).length} dated events`]}
        expanded={sectionDetailVisible('relationships-history')}
        onshow={()=>void showSectionDetail('relationships-history')}
        onhide={()=>void hideSectionDetail('relationships-history')}
      />
      {#if sectionDetailVisible('relationships-history')}
        <LookupVisualWorkspace
          view={visualView}
          setview={(value)=>visualView=value}
          target={evidenceTopologyTarget}
          nodes={evidenceTopologyNodes}
          graph={lookupAssetGraph}
          pivots={analystEvidencePivots}
          events={activationContext.events}
          context={result?.type==='domain'?activationContext:null}
          onnavigate={(href)=>void navigateToLookupEvidence(href)}
        />
      {/if}
    </section>
    {/snippet}

    {#snippet sourceQualitySection()}
    <section class="result-section family-quality" id="source-quality" aria-labelledby="source-quality-title">
      <h3 id="source-quality-title">Source quality</h3>
      <LookupFamilySummary
        label="Source quality"
        description="Review collection completeness, freshness, timing, provenance, and diagnostic routes before relying on a conclusion."
        metrics={[`${evidenceQualityMatrix.completeCount} complete`, `${evidenceQualityMatrix.limitedCount} limited`, `${evidenceQualityMatrix.entries.length} records`]}
        expanded={sectionDetailVisible('source-quality')}
        onshow={()=>void showSectionDetail('source-quality')}
        onhide={()=>void hideSectionDetail('source-quality')}
      />
      {#if sectionDetailVisible('source-quality')}
        <LookupEvidenceQuality
          matrix={evidenceQualityMatrix}
          refreshPlan={lookupSourceRefreshPlan}
          query={String(result?.query || caseDomain)}
          depth={lookupEvidenceDepth}
          timing={lookupTiming}
          onpolicychange={setFreshnessPolicy}
        />
        <LookupOverviewFacts facts={[...lookupSummary.facts]} diagnostics={[...lookupSummary.diagnostics]} hasAssessment={availability.applicable!==false} />
      {/if}
    </section>
    {/snippet}

    {#snippet caseSection()}
    {#if hasCaseSection}
      <section class="result-section family-analyst" id="case-response" aria-labelledby="case-response-title">
        <h3 id="case-response-title">Case and response</h3>
        <LookupFamilySummary
          label="Case and response"
          description="Save reviewed evidence, keep analyst assertions separate, and prepare human-reviewed response routes without sending anything automatically."
          metrics={[caseRecord?'Case saved':'No case saved', `${abuseRecipientResolution.recipients.length} published routes`]}
          expanded={sectionDetailVisible('case-response')}
          onshow={()=>void showSectionDetail('case-response')}
          onhide={()=>void hideSectionDetail('case-response')}
        />
        {#if sectionDetailVisible('case-response')}
        <LookupCaseResponse domain={caseDomain} record={caseRecord} note={caseNote} {caseStatus} {draftStatus} {outreach} recipientResolution={abuseRecipientResolution} setNote={(value) => caseNote = value} createCase={openLookupCase} addNote={addLookupNote} recordRecipient={recordAbuseRecipient} {copyDraft} statusLabel={caseStatusLabel} dispositionLabel={caseDispositionLabel} actionBusy={caseActionBusy} />
        {#if caseRecord && checkpointFacts.length}
          <LookupEvidenceCheckpoint facts={checkpointFacts} pins={caseRecord.evidencePins} onsave={saveEvidenceCheckpoint} actionBusy={caseActionBusy} />
        {/if}
        {/if}
      </section>
    {/if}
    {/snippet}

    {#snippet advancedSection()}
    <section class="result-section family-raw" id="advanced-evidence" aria-labelledby="advanced-evidence-title">
      <h3 id="advanced-evidence-title">Advanced evidence</h3>
      <LookupFamilySummary
        label="Advanced evidence"
        description="Open optional external intelligence and the bounded unified response only when the investigation requires their additional detail."
        metrics={[`${threatIntelligenceProviders.length} external providers`, 'Raw response available']}
        expanded={sectionDetailVisible('advanced-evidence')}
        onshow={()=>void showSectionDetail('advanced-evidence')}
        onhide={()=>void hideSectionDetail('advanced-evidence')}
      />
      {#if sectionDetailVisible('advanced-evidence')}
        {#if threatIntelligenceProviders.length}
          <section class="advanced-block" id="external-intelligence" aria-labelledby="external-intelligence-title">
            <h4 id="external-intelligence-title">External intelligence</h4>
            <LookupExternalIntelligence providers={threatIntelligenceProviders} riskContext={externalRiskContext} riskModelVersion={risk?.modelVersion ?? null} showValue={show} {formatDate} />
          </section>
        {/if}
        <section class="advanced-block" id="raw-data" aria-labelledby="raw-data-title">
          <h4 id="raw-data-title">Raw evidence</h4>
          <details class="raw card"><summary>Raw unified response</summary><pre>{JSON.stringify(result,null,2)}</pre></details>
        </section>
      {/if}
    </section>
    {/snippet}

    <div class="evidence-sections">
      {#each resultSectionLinks() as section (section.href)}
        {#if section.href==='#overview'}
          {@render overviewSection()}
        {:else if section.href==='#registry'}
          {@render registrySection()}
        {:else if section.href==='#web-evidence'}
          {@render webSection()}
        {:else if section.href==='#relationships-history'}
          {@render relationshipsSection()}
        {:else if section.href==='#source-quality'}
          {@render sourceQualitySection()}
        {:else if section.href==='#case-response'}
          {@render caseSection()}
        {:else if section.href==='#advanced-evidence'}
          {@render advancedSection()}
        {/if}
      {/each}
    </div>
  </section>
{/if}

<style>
  .result-root{min-width:0;overflow-x:clip;overflow-clip-margin:3px}
  .evidence-sections{display:flow-root}
  .detailed-assessment{margin-top:12px;padding:0;overflow:hidden}
  .detailed-assessment>summary{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:14px;cursor:pointer;list-style:none}
  .detailed-assessment>summary::-webkit-details-marker{display:none}
  .detailed-assessment>summary span:first-child{display:grid;gap:4px;min-width:0}
  .detailed-assessment>summary strong{color:var(--text);font:700 var(--text-sm) var(--mono)}
  .detailed-assessment>summary small{color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  .detailed-assessment>summary span:last-child{flex:0 0 auto;color:var(--accent);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  .detailed-assessment>summary span:last-child::before{content:'+';display:inline-block;width:1.2em}
  .detailed-assessment[open]>summary{border-bottom:1px solid var(--border);background:var(--panel-raised)}
  .detailed-assessment[open]>summary span:last-child::before{content:'−'}
  .detailed-assessment-body{padding:0 14px 14px}
  .result-section{--section-accent:var(--accent2);margin-top:26px}
  .result-section.family-web{--section-accent:var(--evidence-web)}
  .result-section.family-registry{--section-accent:var(--evidence-registry)}
  .result-section.family-relationships{--section-accent:var(--evidence-network)}
  .result-section.family-quality{--section-accent:var(--evidence-derived)}
  .result-section.family-analyst{--section-accent:var(--evidence-analyst)}
  .result-section.family-raw{--section-accent:var(--muted)}
  .result-section>h3{display:flex;align-items:center;gap:10px;margin:0 0 12px;color:var(--section-accent);font:700 var(--text-2xs) var(--mono);letter-spacing:.09em;text-transform:uppercase}
  .result-section>h3::before{content:"//";color:var(--muted)}
  .result-section>h3::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,color-mix(in srgb,var(--section-accent) 60%,var(--border)),var(--border) 42%)}
  .result-section>.card,.result-section>.evidence-component{margin-top:12px}
  .result-section>:nth-child(2){margin-top:0}
  .evidence-component[id]{position:relative;scroll-margin-top:var(--local-nav-anchor-offset,88px)}
  .advanced-block{min-width:0;scroll-margin-top:var(--local-nav-anchor-offset,88px)}
  .advanced-block+.advanced-block{margin-top:14px}
  .advanced-block>h4{margin:0 0 10px;font:700 var(--text-sm) var(--mono)}
  .sslbl-review-lead{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:12px;padding:16px;border:1px solid color-mix(in srgb,var(--danger) 42%,var(--border));border-radius:var(--radius-md);background:color-mix(in srgb,var(--danger) 5%,var(--surface))}
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
    .detailed-assessment>summary{align-items:flex-start;flex-direction:column;gap:10px}
    .sslbl-review-lead{align-items:stretch;flex-direction:column}
    .sslbl-review-lead .button{width:100%}
  }
</style>
