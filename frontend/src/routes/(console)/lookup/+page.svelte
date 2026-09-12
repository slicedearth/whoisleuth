<script lang="ts">
  import { goto } from '$app/navigation';
  import { getContext, onDestroy, onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import LocalSectionNav from '$lib/components/LocalSectionNav.svelte';
  import LookupAtAGlance from '$lib/components/LookupAtAGlance.svelte';
  import LookupAssessment from '$lib/components/LookupAssessment.svelte';
  import LookupFamilySummary from '$lib/components/LookupFamilySummary.svelte';
  import type { LookupVisualView } from '$lib/components/LookupVisualWorkspace.svelte';
  import LookupEvidenceReplay from '$lib/components/LookupEvidenceReplay.svelte';
  import LookupEvidenceCheckpoint from '$lib/components/LookupEvidenceCheckpoint.svelte';
  import LookupSourceCheckpoint from '$lib/components/LookupSourceCheckpoint.svelte';
  import type { CheckpointFact } from '$lib/analysis/case-evidence-checkpoint.ts';
  import LookupForm from '$lib/components/LookupForm.svelte';
  import LookupTaskGuidance from '$lib/components/LookupTaskGuidance.svelte';
  import LookupWebEvidenceSection from '$lib/components/LookupWebEvidenceSection.svelte';
  import LookupSavedContextPreview from '$lib/components/LookupSavedContextPreview.svelte';
  import LookupResultHeader from '$lib/components/LookupResultHeader.svelte';
  import { lookupObservationHostname } from '../../../../../packages/evidence/lookup-target.mts';
  import LookupPresentationControls from '$lib/components/LookupPresentationControls.svelte';
  import DeferredSurface from '$lib/components/DeferredSurface.svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import { activeProfile, type ActiveBrandProfileSourceState, type BrandProfile } from '$lib/brand-profiles';
  import { compareCaseEvidence, DEFAULT_DISPOSITION, dispositionLabel as caseDispositionLabel, isReviewedCaseDisposition, parseIncidentUrlContext, statusLabel as caseStatusLabel, type CaseRecord, type CaseTransitionExpectation, type EvidenceChange } from '$lib/cases';
  import { caseEvidenceIncomparableReasons, latestCaseEvidence } from '$lib/analysis/case-model.ts';
  import { loadWatchlists, saveSingleDomainWatchlist } from '$lib/watchlists';
  import type { LocalMutationOutcome } from '$lib/local-mutation-outcome.ts';
  import { saveCandidateHandoff } from '$lib/candidate-handoff';
  import {
    prepareLookupEvidenceExport,
    exportLookupEvidence,
    exportLookupReadableReport,
    exportLookupInvestigationBrief,
    exportLookupClaimPassport,
  } from '$lib/analysis/lookup-exports.ts';
  import {
    createLookupViewModel,
    type LookupHttpResponse,
  } from '$lib/analysis/lookup-response.ts';
  import {
    boundedTechnologyText,
    formatDate,
    records,
    show,
    stringList,
  } from '$lib/analysis/lookup-display-model.ts';
  import { buildLookupRouteAnalysis } from '$lib/analysis/lookup-route-analysis.ts';
  import type { LookupClaimId } from '$lib/analysis/lookup-claim-readiness.ts';
  import type { LookupFreshnessPolicyInput, LookupFreshnessThresholds, LookupSourceRefreshLedger } from '$lib/analysis/lookup-source-refresh.ts';
  import {
    LOOKUP_CLIENT_TIMEOUT_MS,
  } from '$lib/analysis/lookup-request.ts';
  import { prepareSelectedLookupUrl } from '../../../../../packages/evidence/lookup-target.mts';
  import {
    buildLookupRequestUrl,
    prepareLookupCollectionTarget,
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
    buildLookupWatchlistRecord,
    defaultLookupWatchlistName,
    lookupWatchlistsForDomain,
  } from '$lib/analysis/lookup-watchlist-handoff.ts';
  import { buildServiceDependencyReview } from '$lib/analysis/service-dependency-review.ts';
  import { parseDomainInput } from '$lib/analysis/utils.ts';
  import { CAPABILITY_CONTEXT, disabledCapabilities, disabledCapability, featureCapability, type CapabilityGetter } from '$lib/capabilities';
  import { readLookupWorkflowState, writeLookupWorkflowState, selectConsoleCase, setCaseNavigationContext } from '$lib/console-workflow-state.ts';
  import { normalizeOpaqueReferenceId } from '../../../../../packages/cases/opaque-reference-id.mts';
  import { caseWorkspaceHref } from '$lib/analysis/case-response-stage.ts';
  import { preloadBestEffort } from '$lib/idle-preload';
  import { LookupRequestController } from '$lib/controllers/lookup-request-controller';
  import { LookupCaseController, type LookupCaseActionResult, type LookupConclusionEvidenceSelection } from '$lib/controllers/lookup-case-controller';
  import { LookupAnchorController } from '$lib/controllers/lookup-anchor-controller';
  import {
    MAX_OBSERVATION_LIMITATIONS,
    MAX_OBSERVATION_LIMITATION_LENGTH,
  } from '../../../../../packages/evidence/observation.mts';
  const moduleController = new AbortController();
  onDestroy(() => moduleController.abort());
  type LookupMode = 'fast' | 'deep';

  let query=$state('');
  let lookupMode=$state<LookupMode>('fast');
  let collectSelectedUrl=$state(false);
  let loading=$state(false);
  let loadingElapsedMs=$state(0);
  let includeExternalIntelligence=$state(false);
  let includeMalwareHostIntelligence=$state(false);
  let includeMalwareIocIntelligence=$state(false);
  let includeSecurityTxt=$state(false);
  let error=$state('');
  let result=$state<LookupHttpResponse|null>(null);
  let sourceRefreshLedger=$state<LookupSourceRefreshLedger|null>(null);
  $effect(()=>{result;sourceRefreshLedger=null;});
  let completedLookupTarget=$state('');
  let completedIncidentUrl=$state('');
  let completedLookupDepth=$state<LookupMode|null>(null);
  const linkedCaseReference = $derived(page.url.searchParams.get('case'));
  const invalidCaseReference = $derived(linkedCaseReference !== null && normalizeOpaqueReferenceId(linkedCaseReference) === null);
  $effect(() => {
    if (linkedCaseReference !== null) selectConsoleCase(normalizeOpaqueReferenceId(linkedCaseReference));
  });
  let profile=$state<BrandProfile|null>(null);
  let profileSourceState=$state<ActiveBrandProfileSourceState>('loading');
  let draftStatus=$state('');
  let evidenceExportStatus=$state('');
  let caseRecord=$state<CaseRecord|null>(null);let caseNote=$state('');let caseStatus=$state('');
  let caseSourceState=$state<'loading'|'ready'|'unavailable'>('loading');
  let caseDisposition=$state(DEFAULT_DISPOSITION);let caseReviewReason=$state('');
  let caseRecheckComparison=$state<Readonly<{available:boolean;changes:EvidenceChange[];observedAt:string;detail:string}>|null>(null);
  let caseActionBusy=$state(false);
  let caseActionGeneration=0;
  let linkedWatchlistNames=$state<string[]>([]);
  let watchlistSourceState=$state<'loading'|'ready'|'unavailable'>('loading');
  let watchlistName=$state('');let watchlistStatus=$state('');let watchlistContextTarget=$state('');
  let watchlistActionBusy=$state(false);let watchlistActionGeneration=0;
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
  let lookupAnchorController:LookupAnchorController|null=null;
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
  const lookupEntries=$derived.by(()=>{
    const trimmed=query.trim();
    return /^[a-z][a-z\d+.-]*:\/\//iu.test(trimmed)&&!/[\r\n]/u.test(trimmed)?[trimmed]:entries;
  });
  const securityTxtEligible=$derived.by(()=>{
    if(lookupEntries.length!==1)return false;
    try{const value=lookupEntries[0];if(!value)return false;const url=new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value)?value:`https://${value}`);const host=url.hostname;return host.includes('.')&&!host.includes(':')&&!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host);}catch{return false;}
  });
  const lookupView=$derived(createLookupViewModel(result));
  const validatedResponseJson=$derived.by(()=>result ? JSON.stringify(result, null, 2) : '');
  const availability=$derived(lookupView.availability);
  const observationHostname=$derived(availability.dns || availability.tls || availability.http
    ? lookupObservationHostname(availability) : null);
  const rdap=$derived(lookupView.rdap);
  const registrarRdap=$derived(lookupView.registrarRdap);
  const whois=$derived(lookupView.whois);
  const rdapParsed=$derived(lookupView.rdapParsed);
  const whoisParsed=$derived(lookupView.whoisParsed);
  const diagnostics=$derived(lookupView.diagnostics);
  const lookupTiming=$derived(lookupView.timing);
  const registryAccess=$derived(lookupView.registryAccess);
  const registryInsights=$derived(lookupView.registryInsights);
  const registrarStanding=$derived(lookupView.registrarStanding);
  const reverseDns=$derived(lookupView.reverseDns);
  const observedNetworkContext=$derived(lookupView.observedNetworkContext);
  const securityTxt=$derived(lookupView.securityTxt);
  const sslbl=$derived(lookupView.sslbl);
  const threatIntelligenceProviders=$derived(lookupView.threatIntelligenceProviders);
  const dnsEvidence=$derived(lookupView.dnsEvidence);
  const dnsRecords=$derived(lookupView.dnsRecords);
  const httpEvidence=$derived(lookupView.httpEvidence);
  const tlsEvidence=$derived(lookupView.tlsEvidence);
  const pageIdentity=$derived(lookupView.pageIdentity);
  const credentialSurfaceProfile=$derived(lookupView.credentialSurfaceProfile);
  const structuredDataIdentity=$derived(lookupView.structuredDataIdentity);
  const technologyProfile=$derived(lookupView.technologyProfile);
  const pageRoleProfile=$derived(lookupView.pageRoleProfile);
  const clientBehaviorProfile=$derived(lookupView.clientBehaviorProfile);
  const securityPosture=$derived(lookupView.securityPosture);
  const lookupAnalysis=$derived(buildLookupRouteAnalysis({
    result,
    lookupView,
    profile,
    profileSourceState,
    task:taskView,
    hasReviewedCaseRecipient:Boolean(caseRecord?.actions.some((action)=>Boolean(action.recipient)&&Boolean(action.contactSource))),
    completedLookupDepth,
    ...(freshnessPolicyInput?{freshnessPolicy:freshnessPolicyInput}:{}),
  }));
  const lookupEvidenceDepth=$derived(lookupAnalysis.lookupEvidenceDepth);
  const lookupObservedAt=$derived(lookupAnalysis.lookupObservedAt);
  const populatedWhoisRoles=$derived(lookupAnalysis.populatedWhoisRoles);
  const comparison=$derived(lookupAnalysis.comparison);
  const registrarPublicationComparison=$derived(lookupAnalysis.registrarPublicationComparison);
  const lifecycleDates=$derived(lookupAnalysis.lifecycleDates);
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
  const caseObservationTarget=$derived(String(result?.inputHostname||caseDomain).trim().toLowerCase());
  function preserveLookupReturn() {
    if (!caseRecord) return;
    const params = new URLSearchParams({ q: completedLookupTarget, depth: lookupEvidenceDepth, task: taskView });
    setCaseNavigationContext(caseRecord.id, `/lookup?${params}#case-response`, 'Lookup');
  }
  const observedPageBaseline=$derived(lookupAnalysis.observedPageBaseline);
  const pageComparison=$derived(lookupAnalysis.pageComparison);
  const pageDisplay=$derived(lookupAnalysis.pageDisplay);
  const brandMimicryReview=$derived(lookupAnalysis.brandMimicryReview);
  const hasWebEvidence=$derived(lookupAnalysis.hasWebEvidence);
  const hasCaseSection=$derived(lookupAnalysis.hasCaseSection);
  const evidenceTopologyNodes=$derived(lookupAnalysis.evidenceTopologyNodes);
  const lookupAssetGraph=$derived(lookupAnalysis.lookupAssetGraph);
  const analystEvidencePivots=$derived(lookupAnalysis.analystEvidencePivots);
  const activationContext=$derived(lookupAnalysis.activationContext);
  const acquisitionDueDiligence=$derived(lookupAnalysis.acquisitionDueDiligence);
  const serviceDependencyReview=$derived(buildServiceDependencyReview({
    domain:observationHostname??caseDomain,
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
  const lookupDecisionFacts=$derived(lookupAnalysis.lookupDecisionFacts);
  const lookupClaimReadiness=$derived(lookupAnalysis.lookupClaimReadiness);
  const lookupReviewActionModel=$derived(lookupAnalysis.lookupReviewActionModel);
  const evidenceQualityMatrix=$derived(lookupAnalysis.evidenceQualityMatrix);
  const lookupSummary=$derived(lookupAnalysis.lookupSummary);
  const lookupInvestigationBrief=$derived(lookupAnalysis.lookupInvestigationBrief);
  const lookupEvidenceProjection=$derived(prepareLookupEvidenceExport(result, {idnAnalysis,applicationVersion:__WHOISLEUTH_VERSION__}));
  const lookupEvidenceDocument=$derived(lookupEvidenceProjection.document);
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
    const requestedRevision=expectedRevision??lookupRevision;
    const actionGeneration=caseActionGeneration;
    caseSourceState='loading';
    const next=await lookupCaseController.refresh(requestedDomain);
    if(actionGeneration!==caseActionGeneration||requestedRevision!==lookupRevision||caseDomain!==requestedDomain)return;
    caseRecord=next.record;
    caseStatus=next.status;
    caseSourceState=next.sourceState;
    caseDisposition=next.record?.disposition??DEFAULT_DISPOSITION;
    caseReviewReason=next.record?.reviewReasonCode??'';
  }
  function invalidateCaseActions(){caseActionGeneration+=1;caseActionBusy=false;}
  function invalidateWatchlistActions(){watchlistActionGeneration+=1;watchlistActionBusy=false;}
  async function refreshWatchlistContext(expectedRevision:number|null=null){
    const target=caseObservationTarget;
    if(!target){linkedWatchlistNames=[];watchlistSourceState='ready';watchlistContextTarget='';watchlistName='';return;}
    const targetChanged=target!==watchlistContextTarget;
    if(targetChanged){linkedWatchlistNames=[];watchlistName=defaultLookupWatchlistName(target);watchlistContextTarget=target;}
    watchlistSourceState='loading';
    try{
      const all=await loadWatchlists();
      if(expectedRevision!==null&&(expectedRevision!==lookupRevision||caseObservationTarget!==target))return;
      linkedWatchlistNames=lookupWatchlistsForDomain(all,target);
      watchlistSourceState='ready';
      if(linkedWatchlistNames.length===1&&(targetChanged||!watchlistName.trim()))watchlistName=linkedWatchlistNames[0]??watchlistName;
    }catch{
      if(expectedRevision!==null&&(expectedRevision!==lookupRevision||caseObservationTarget!==target))return;
      watchlistSourceState='unavailable';
    }
  }
  async function performCaseAction(
    action:()=>Promise<LookupCaseActionResult>,
    afterPublish:(next:LookupCaseActionResult)=>void=()=>{},
  ):Promise<LocalMutationOutcome>{
    if(caseActionBusy)return 'stale';
    if(caseSourceState!=='ready')return'rejected';
    const generation=++caseActionGeneration;
    const revision=lookupRevision;
    const domain=caseDomain;
    const recordId=caseRecord?.id||'';
    caseActionBusy=true;
    try{
      const next=await action();
      if(generation!==caseActionGeneration||revision!==lookupRevision||domain!==caseDomain||(caseRecord?.id||'')!==recordId)return 'stale';
      caseRecord=next.record;
      caseStatus=next.status;
      if(next.sourceState)caseSourceState=next.sourceState;
      else if(next.record)caseSourceState='ready';
      afterPublish(next);
      if (next.mutationOutcome === 'committed' && next.record) selectConsoleCase(next.record.id);
      return next.mutationOutcome;
    }finally{
      if(generation===caseActionGeneration)caseActionBusy=false;
    }
  }
  async function openLookupCase(){const domain=caseDomain;const evidence=caseEvidence;const depth=lookupEvidenceDepth;await performCaseAction(()=>lookupCaseController.open(domain,evidence,depth),(next)=>{caseDisposition=next.record?.disposition??DEFAULT_DISPOSITION;caseReviewReason=next.record?.reviewReasonCode??'';});}
  async function addLookupNote(){const record=caseRecord;const note=caseNote;await performCaseAction(()=>lookupCaseController.appendNote(record,note),(next)=>{if(next.clearNote)caseNote='';});}
  async function recordLookupConclusion(rationale:string,selections:readonly LookupConclusionEvidenceSelection[]){const record=caseRecord;const disposition=caseDisposition;const reason=caseReviewReason;return performCaseAction(()=>lookupCaseController.recordConclusion(record,checkpointFacts,disposition,reason,rationale,selections),(next)=>{caseDisposition=next.record?.disposition??DEFAULT_DISPOSITION;caseReviewReason=next.record?.reviewReasonCode??'';});}
  async function recordLookupInvestigationContext(objective:string,retainExactUrl:boolean){const record=caseRecord;const incidentUrl=completedIncidentUrl;return performCaseAction(()=>lookupCaseController.recordInvestigationContext(record,{objective,incidentUrl,retainExactUrl}));}
  async function recordLookupRecheckOutcome(input:Readonly<{state:string;completeness:string;source:string;followUpAt:string|null;limitations:readonly string[];comparisonSummary:string}>):Promise<LocalMutationOutcome>{const record=caseRecord;const comparison=caseRecheckComparison;if(!comparison?.available)return 'rejected';return performCaseAction(()=>lookupCaseController.recordRecheckOutcome(record,{...input,observedAt:comparison.observedAt,collectionDepth:lookupEvidenceDepth}));}
  async function recordAbuseRecipient(route:Parameters<LookupCaseController['recordRecipient']>[1]){const record=caseRecord;await performCaseAction(()=>lookupCaseController.recordRecipient(record,route));}
  async function saveLookupWatchlist(){
    if(watchlistActionBusy)return;
    const generation=++watchlistActionGeneration;
    const revision=lookupRevision;
    const target=caseObservationTarget;
    const name=watchlistName;
    const record=buildLookupWatchlistRecord(target,caseEvidence,lookupEvidenceDepth);
    if(!record){watchlistStatus='The current Lookup result cannot be saved as a domain watchlist observation.';return;}
    watchlistActionBusy=true;
    try{
      const saved=await saveSingleDomainWatchlist(name,record,lookupEvidenceDepth);
      if(generation!==watchlistActionGeneration||revision!==lookupRevision||target!==caseObservationTarget)return;
      watchlistName=saved.name;
      watchlistStatus=saved.created
        ? `Created the browser-local watchlist “${saved.name}” with this ${lookupEvidenceDepth} observation.`
        : saved.changes.length
          ? `Updated “${saved.name}” and retained ${saved.changes.length} material change${saved.changes.length===1?'':'s'}.`
          : `Updated “${saved.name}”; no comparable material change was observed.`;
      await refreshWatchlistContext(revision);
    }catch(cause){
      if(generation!==watchlistActionGeneration||revision!==lookupRevision||target!==caseObservationTarget)return;
      watchlistStatus=cause instanceof Error?cause.message:'Could not save the browser-local watchlist observation.';
    }finally{
      if(generation===watchlistActionGeneration)watchlistActionBusy=false;
    }
  }
  async function recheckLookupCase(){
    const target=caseObservationTarget;
    if(!target||loading)return;
    const before=latestCaseEvidence(caseRecord);
    caseRecheckComparison=null;
    query=target;
    lookupMode=lookupEvidenceDepth;
    await runLookup({refreshCaseEvidence:true});
    if(error)return;
    const after=latestCaseEvidence(caseRecord);
    if(!before||!after){caseRecheckComparison={available:false,changes:[],observedAt:after?.capturedAt??'',detail:'A uniquely latest prior and current Case observation are required. Review any equal-time or undated snapshots before comparing.'};return;}
    if(Date.parse(after.capturedAt)<=Date.parse(before.capturedAt)){caseRecheckComparison={available:false,changes:[],observedAt:after.capturedAt,detail:'No later Case capture is available. Equal or earlier capture times cannot establish a recheck outcome.'};return;}
    const changes=compareCaseEvidence(before,after);
    if(caseEvidenceIncomparableReasons(before,after).includes('observation-context')){caseRecheckComparison={available:false,changes,observedAt:after.capturedAt,detail:'These captures concern different or unknown hostnames. Only registration fields can be compared; recheck the same hostname before recording an observed-effect outcome.'};return;}
    caseRecheckComparison={available:true,changes,observedAt:after.capturedAt,detail:changes.length?`${changes.length} comparable material change${changes.length===1?' was':'s were'} found.`:'No comparable material field change was found. This does not prove the page or behaviour is absent.'};
  }
  async function saveEvidenceCheckpoint(selectedFields:string[],transitionExpectations:Readonly<Record<string,CaseTransitionExpectation>>={}){const record=caseRecord;const facts=checkpointFacts;return performCaseAction(()=>lookupCaseController.recordCheckpoint(record,facts,[...selectedFields],{...transitionExpectations}));}
  async function saveRefreshedCheckpoint(facts:readonly CheckpointFact[],selectedFields:string[]){const record=caseRecord;return performCaseAction(()=>lookupCaseController.recordCheckpoint(record,facts,[...selectedFields]));}
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
    invalidateWatchlistActions();
    result=null;
    completedLookupTarget='';
    completedIncidentUrl='';
    completedLookupDepth=null;
    caseRecord=null;
    caseSourceState='loading';
    caseNote='';
    caseStatus='';
    caseDisposition=DEFAULT_DISPOSITION;
    caseReviewReason='';
    caseRecheckComparison=null;
    linkedWatchlistNames=[];
    watchlistSourceState='loading';
    watchlistName='';
    watchlistStatus='';
    watchlistContextTarget='';
    expandedResultSections=[];
    detailedAssessmentOpen=false;
    evidenceExportStatus='';
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
  function preloadLookupSection(sectionId:string){
    const loads:Array<Promise<unknown>>=[];
    if(sectionId==='web-evidence'){
      if(observedNetworkContext.contextVersion===1)loads.push(import('$lib/components/LookupNetworkContext.svelte'));
      if(result?.type==='domain')loads.push(import('$lib/components/WebsiteSnapshotManager.svelte'));
      if(reverseDns.source==='reverse_dns'||dnsEvidence.source==='dns')loads.push(import('$lib/components/LookupDnsEvidence.svelte'));
      if(dnsEvidence.source==='dns'&&serviceDependencyReview)loads.push(import('$lib/components/LookupServiceDependencyReview.svelte'));
      if(httpEvidence.source==='http')loads.push(import('$lib/components/LookupHttpEvidence.svelte'));
      if(tlsEvidence.source==='tls')loads.push(import('$lib/components/LookupTlsEvidence.svelte'),import('$lib/components/LookupCertificatePolicyReview.svelte'));
      if(sslbl.sslblVersion===1)loads.push(import('$lib/components/LookupSslblEvidence.svelte'));
      if(securityTxt.securityTxtVersion===1)loads.push(import('$lib/components/LookupSecurityTxt.svelte'));
      if(pageIdentity.source==='html')loads.push(import('$lib/components/LookupPageIdentity.svelte'));
      if(credentialSurfaceProfile.source==='html')loads.push(import('$lib/components/LookupCredentialSurfaceProfile.svelte'));
      if(securityPosture.source==='derived')loads.push(import('$lib/components/LookupSecurityPosture.svelte'));
      if(structuredDataIdentity.source==='html')loads.push(import('$lib/components/LookupStructuredDataIdentity.svelte'));
      if(technologyProfile.source==='derived')loads.push(import('$lib/components/LookupTechnologyProfile.svelte'));
      if(pageRoleProfile.source==='derived'&&clientBehaviorProfile.source==='derived')loads.push(import('$lib/components/LookupPageRoleBehavior.svelte'));
      if(pageComparison||(profile?.pageBaseline&&result?.type==='domain'))loads.push(import('$lib/components/LookupPageComparison.svelte'));
      if(brandMimicryReview)loads.push(import('$lib/components/LookupBrandMimicryReview.svelte'));
    }else if(sectionId==='registry'){
      if(registryAccess.suffix)loads.push(import('$lib/components/RegistryAccessNotice.svelte'));
      loads.push(import('$lib/components/LookupRegistrySources.svelte'));
      if(result?.type==='domain'&&Array.isArray(rdapParsed.redactions)&&rdapParsed.redactions.length)loads.push(import('$lib/components/RegistrationDisclosurePlanner.svelte'));
    }else if(sectionId==='relationships-history'){
      loads.push(import('$lib/components/LookupVisualWorkspace.svelte'));
    }else if(sectionId==='source-quality'){
      loads.push(import('$lib/components/LookupEvidenceQuality.svelte'),import('$lib/components/LookupOverviewFacts.svelte'));
    }else if(sectionId==='case-response'){
      loads.push(import('$lib/components/LookupCaseResponse.svelte'));
    }else if(sectionId==='advanced-evidence'&&threatIntelligenceProviders.length){
      loads.push(import('$lib/components/LookupExternalIntelligence.svelte'));
    }
    if(loads.length)preloadBestEffort(()=>Promise.all(loads), moduleController.signal);
  }
  async function showSectionDetail(sectionId:string){
    const href=`#${sectionId}`;
    window.history.replaceState(window.history.state,'',href);
    lookupAnchorController?.begin(href,href);
    preloadLookupSection(sectionId);
    expandedResultSections=expandedResultSections.includes(sectionId)
      ? expandedResultSections
      : [...expandedResultSections,sectionId];
    await tick();
    lookupAnchorController?.align();
  }
  async function hideSectionDetail(sectionId:string){
    const href=`#${sectionId}`;
    window.history.replaceState(window.history.state,'',href);
    lookupAnchorController?.begin(href,href);
    expandedResultSections=expandedResultSections.filter((id)=>id!==sectionId);
    await tick();
    lookupAnchorController?.align();
  }
  function expandableResultSectionIds():string[]{
    return resultSectionLinks()
      .map((section)=>section.href.slice(1))
      .filter((sectionId)=>sectionId!=='overview');
  }
  function beginCurrentLookupAlignment():boolean{
    const href=lookupEvidenceTargetForHref(window.location.hash);
    const familyId=lookupEvidenceFamilyForHref(href);
    return familyId?Boolean(lookupAnchorController?.begin(href,`#${familyId}`)):false;
  }
  async function expandAllSectionDetails(){
    const realign=beginCurrentLookupAlignment();
    const sectionIds=expandableResultSectionIds();
    for(const sectionId of sectionIds)preloadLookupSection(sectionId);
    expandedResultSections=sectionIds;
    if(realign){await tick();lookupAnchorController?.align();}
  }
  async function collapseAllSectionDetails(){
    const realign=beginCurrentLookupAlignment();
    expandedResultSections=[];
    if(realign){await tick();lookupAnchorController?.align();}
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
    window.history.replaceState(window.history.state,'',href);
    lookupAnchorController?.begin(href,href);
    preloadLookupSection(sectionId);
    if(sectionId!=='overview'&&!expandedResultSections.includes(sectionId)){
      expandedResultSections=[...expandedResultSections,sectionId];
    }
    await tick();
    lookupAnchorController?.align();
  }
  async function navigateToLookupEvidence(href:string){
    const familyId=lookupEvidenceFamilyForHref(href);
    if(!familyId)return;
    const normalizedHref=lookupEvidenceTargetForHref(href);
    window.history.replaceState(window.history.state,'',normalizedHref);
    lookupAnchorController?.begin(normalizedHref,`#${familyId}`);
    preloadLookupSection(familyId);
    expandedResultSections=familyId==='overview'||expandedResultSections.includes(familyId)
      ? expandedResultSections
      : [...expandedResultSections,familyId];
    await tick();
    lookupAnchorController?.align();
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
  async function restoreDeferredLookupTarget(){
    await tick();
    lookupAnchorController?.contentReady();
  }
  function setFreshnessPolicy(value:{mode:'task-default'|'analyst-custom';thresholdsDays:LookupFreshnessThresholds}){
    freshnessPolicyMode=value.mode;
    customFreshnessThresholds=value.thresholdsDays;
  }
  onMount(()=>{
    pageActive=true;
    lookupAnchorController=new LookupAnchorController();
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
      completedIncidentUrl=result&&typeof restored.completedIncidentUrl==='string'&&parseIncidentUrlContext(restored.completedIncidentUrl)
        ? restored.completedIncidentUrl
        : '';
      completedLookupDepth=result?restoredDepth:null;
      error=restored.result&&!restoredDepth?'':restored.error;
    }
    applyLookupUrl(page.url);
    urlReconciliationReady=true;
    window.addEventListener('hashchange',navigateToCurrentLookupHash);
    if(result)requestAnimationFrame(navigateToCurrentLookupHash);
    void (async()=>{
      await refreshProfileContext();
      if(result)await Promise.all([refreshCase(lookupRevision),refreshWatchlistContext(lookupRevision)]);
    })();
    return()=>{
      pageActive=false;
      invalidateCaseActions();
      invalidateWatchlistActions();
      lookupAnchorController?.destroy();
      lookupAnchorController=null;
      window.removeEventListener('hashchange',navigateToCurrentLookupHash);
      lookupRequestController.dispose();
      writeLookupWorkflowState({query,completedTarget:completedLookupTarget,completedIncidentUrl,completedLookupDepth,lookupMode,includeExternalIntelligence,includeMalwareHostIntelligence,includeMalwareIocIntelligence,includeSecurityTxt,error,result});
    };
  });

  function websiteSnapshotInput(){
    const now=new Date().toISOString();
    return buildLookupWebsiteSnapshot({
      id:crypto.randomUUID?crypto.randomUUID():`website-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      domain:observationHostname??caseDomain,
      observedAt:lookupObservedAt||now,
      ...(availability.webObservationMode==='selected_url'?{webObservationMode:'selected_url' as const}:{}),
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
    const status=exportLookupEvidence(result,lookupEvidenceProjection);
    if(status!==null)evidenceExportStatus=status;
  }
  function downloadReadableReport(includeAttribution=true){
    const status=exportLookupReadableReport(result,lookupEvidenceProjection,{risk,decisionFacts:lookupDecisionFacts,applicationVersion:__WHOISLEUTH_VERSION__,includeAttribution});
    if(status!==null)evidenceExportStatus=status;
  }
  function downloadInvestigationBrief(){if(result)exportLookupInvestigationBrief(lookupInvestigationBrief);}
  async function downloadClaimPassport(claimId:LookupClaimId):Promise<string>{
    if(!result)throw new Error('Run a Lookup before exporting a claim passport.');
    return exportLookupClaimPassport({
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
  }
  async function copyDraft(text:string,label:string){try{await navigator.clipboard.writeText(text);draftStatus=`Copied ${label} to the clipboard.`;}catch{draftStatus='Clipboard access was unavailable. Use the email draft link instead.';}}
  function resultSectionLinks(){return buildLookupResultSectionLinks({
      hasWebEvidence,
      domainResult:result?.type==='domain',
      hasExternalIntelligence:threatIntelligenceProviders.length>0,
      hasCaseSection,
      task:taskView,
    });}
  async function runLookup(options:Readonly<{refreshCaseEvidence?:boolean}>={}){
    if(lookupDisabled){error=lookupDisabled.reason||'Lookup is disabled by deployment policy.';return;}
    if(parsedInput.tooLarge){error='The pasted domain list exceeds the bounded input limit.';return;}
    if(!lookupEntries.length||loading)return;
    if(lookupEntries.length>1){
      let targets:string[];
      try{targets=lookupEntries.slice(0,2000).map(prepareLookupCollectionTarget);}
      catch(cause){error=cause instanceof Error?cause.message:'Lookup targets could not be prepared.';return;}
      result=null;error='';
      const handoffResult=saveCandidateHandoff('manual',targets.map(domain=>({domain:domain.toLowerCase(),source:'manual input',mutationTypes:[]})));
      if(!handoffResult.saved){error='This browser could not retain the selected domains for Bulk. Check site-storage access and try again.';return;}
      await goto(`/bulk?source=manual&handoff=${handoffResult.token}`);
      return;
    }

    const submittedEntry=lookupEntries[0];if(!submittedEntry)return;
    const submittedIncident=taskView==='incident'&&/^[a-z][a-z\d+.-]*:\/\//iu.test(submittedEntry)
      ? parseIncidentUrlContext(submittedEntry)
      : null;
    if(taskView==='incident'&&/^[a-z][a-z\d+.-]*:\/\//iu.test(submittedEntry)&&!submittedIncident){
      error='Incident URLs must be absolute HTTP(S) URLs without credentials and within the Case URL bound.';
      return;
    }
    let target:string;
    let selectedUrl:string|undefined;
    try{
      target=prepareLookupCollectionTarget(submittedEntry);
      if(collectSelectedUrl){
        if(lookupMode!=='deep'||!securityTxtSupported)throw new TypeError('Selected URL collection requires an enabled Deep website observation.');
        selectedUrl=prepareSelectedLookupUrl(submittedEntry,target);
      }
    }
    catch(cause){error=cause instanceof Error?cause.message:'Lookup target could not be prepared.';return;}
    invalidateCaseActions();
    invalidateWatchlistActions();
    lookupAnchorController?.stop();
    caseSourceState='loading';
    loading=true;loadingElapsedMs=0;error='';result=null;completedLookupTarget='';completedLookupDepth=null;caseRecord=null;caseNote='';caseStatus='';caseDisposition=DEFAULT_DISPOSITION;caseReviewReason='';caseRecheckComparison=null;linkedWatchlistNames=[];watchlistSourceState='loading';watchlistStatus='';serviceDependencyScope='';serviceDependencyFalsePositives='';expandedResultSections=[];detailedAssessmentOpen=false;evidenceExportStatus='';
    const requestedLookupMode=lookupMode;
    const requestRevision=++lookupRevision;
    const revealIntent=lookupAnchorController?.captureRevealIntent();
    const requestCurrent=()=>pageActive&&requestRevision===lookupRevision&&lookupEntries[0]===submittedEntry&&lookupMode===requestedLookupMode;
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
        selectedUrl ? { selectedUrl } : {},
      );
      if(completed.state==='stale'||!requestCurrent())return;
      const outcome=completed.outcome;
      if(!outcome.ok){error=outcome.message;return;}
      result=outcome.value;completedLookupTarget=target;completedIncidentUrl=submittedIncident?.exactUrl??'';completedLookupDepth=requestedLookupMode;
      await Promise.all([refreshCase(requestRevision),refreshWatchlistContext(requestRevision)]);
      if(!requestCurrent())return;
      if(options.refreshCaseEvidence&&revealIntent?.current())await openLookupCase();
      if(!requestCurrent())return;
      loading=false;
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      if(!requestCurrent()||!revealIntent?.current())return;
      if(options.refreshCaseEvidence){void navigateToResultSection('#case-response');return;}
      if(window.location.hash&&lookupEvidenceFamilyForHref(window.location.hash))navigateToCurrentLookupHash();
      else document.querySelector('#result')?.scrollIntoView({behavior:'instant',block:'start'});
    }catch{
      if(pageActive&&requestRevision===lookupRevision)error='Lookup request could not be prepared.';
    }finally{
      revealIntent?.dispose();
      if(pageActive&&requestRevision===lookupRevision)loading=false;
    }
  }
  async function submit(event:SubmitEvent){
    event.preventDefault();
    await runLookup();
  }
</script>

<svelte:head><title>Lookup · WHOISleuth</title></svelte:head>
<PageHeading eyebrow="Investigate" title="Lookup" description="Collect evidence for a domain, IP address or ASN." />
{#if invalidCaseReference}<p class="local-context-status" role="status">The Case reference is invalid. No Case was selected.</p>{/if}
<LookupForm
  bind:query
  task={taskView}
  bind:lookupMode
  bind:collectSelectedUrl
  {loading}
  {loadingElapsedMs}
  loadingDeadlineMs={LOOKUP_CLIENT_TIMEOUT_MS}
  entryCount={lookupEntries.length}
  duplicateCount={parsedInput.duplicates}
  inputTooLarge={parsedInput.tooLarge}
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
>
  {#snippet guidance()}
    <LookupTaskGuidance task={taskView} {lookupMode} ontask={setTaskView} onmode={(mode) => { lookupMode = mode; invalidateLookupForInputChange(); clearCompletedLookupContext(); }} />
  {/snippet}
</LookupForm>

<LookupSavedContextPreview {query} />

{#if profileContextLimitation}<p class="local-context-status" role="status">{profileContextLimitation}</p>{/if}

<LookupEvidenceReplay />

{#if result}
  <section class="result-root" id="result" use:evidenceLinkNavigation>
    <LookupResultHeader title={show(result.inputHostname||result.registrableDomain||result.query)} state={show(availability.state)} isSubdomain={Boolean(result.isSubdomain)} registrableDomain={show(result.registrableDomain)} inputHostname={show(result.inputHostname)} {observationHostname} selectedUrl={availability.webObservationMode === 'selected_url'}
      observedAt={lookupObservedAt} depth={lookupEvidenceDepth} caseHref={caseDomain ? caseRecord ? caseWorkspaceHref(caseRecord.id) : '#case-response' : null}
      caseLabel={caseRecord ? 'Open saved Case' : caseSourceState === 'ready' ? 'Keep in Case' : 'Case context'} onCaseOpen={preserveLookupReturn}
      onExport={downloadEvidence} onReportExport={downloadReadableReport} onBriefExport={downloadInvestigationBrief} />
    {#if evidenceExportStatus||lookupEvidenceProjection.error}<p class:portable-evidence-status={Boolean(lookupEvidenceProjection.error)} class="local-context-status" role="status" aria-atomic="true">{evidenceExportStatus||lookupEvidenceProjection.error}</p>{/if}

    <LookupPresentationControls
      allSectionsExpanded={allSectionDetailsVisible()}
      anySectionsExpanded={anySectionDetailsVisible()}
      expandAll={expandAllSectionDetails}
      collapseAll={collapseAllSectionDetails}
    />

    <LocalSectionNav label="Result sections" links={resultSectionLinks()} trackCurrent onnavigate={(href)=>void navigateToResultSection(href)} />

    {#snippet overviewSection()}
    <section class="result-section family-overview" id="overview" aria-labelledby="overview-title">
      <h3 id="overview-title">Overview</h3>

      <LookupAtAGlance
        reviewActions={lookupReviewActionModel}
        {lookupDecisionFacts}
        signals={lookupSummary.signals}
      />

      {#if availability.applicable!==false}
        <LookupAssessment detail={show(availability.detail||availability.state)} confidence={show(availability.confidence)} {risk} {riskSensitivity} {opportunity} signals={[...lookupSummary.signals]} trusted={String(profileSignals.trusted||'')} task={taskView} />
      {/if}

      <details class="detailed-assessment card" bind:open={detailedAssessmentOpen}>
        <summary>
          <span><strong>Assessment detail</strong><small>Evidence Readiness and portable hand-off{taskView==='acquisition'?', with acquisition review':''}</small></span>
          <span>{detailedAssessmentOpen?'Close assessment':'Open assessment'}</span>
        </summary>
        <div class="detailed-assessment-body">
        <DeferredSurface
          load={()=>import('$lib/components/LookupClaimReadiness.svelte')}
          loadingLabel="Loading Evidence Readiness review…"
          unavailableLabel="Evidence Readiness review could not be loaded."
          placeholder="panel"
          props={{readiness:lookupClaimReadiness,reviewActions:lookupReviewActionModel,onpassport:downloadClaimPassport}}
        />

        {#if lookupEvidenceDocument}
          <DeferredSurface
            load={()=>import('$lib/components/LookupInvestigationCapsule.svelte')}
            loadingLabel="Loading portable investigation hand-off…"
            unavailableLabel="The portable investigation hand-off could not be loaded."
            placeholder="panel"
            props={{applicationVersion:__WHOISLEUTH_VERSION__,lookupEvidence:lookupEvidenceDocument,brief:lookupInvestigationBrief,graph:lookupAssetGraph,caseRecord}}
          />
        {/if}

        {#if result?.type==='domain' && taskView==='acquisition'}
          <DeferredSurface
            load={()=>import('$lib/components/LookupAcquisitionDueDiligence.svelte')}
            loadingLabel="Loading acquisition due-diligence review…"
            unavailableLabel="Acquisition due-diligence review could not be loaded."
            placeholder="workspace"
            props={{review:acquisitionDueDiligence,target:caseDomain,observedAt:lookupObservedAt}}
          />
        {/if}
        </div>
      </details>
    </section>
    {/snippet}

    {#snippet webSection()}
    {#if hasWebEvidence}
      <LookupWebEvidenceSection
        {result}
        view={lookupView}
        analysis={lookupAnalysis}
        {serviceDependencyReview}
        {profile}
        {caseDomain}
        {lookupEvidenceDepth}
        {lookupObservedAt}
        {loading}
        expanded={sectionDetailVisible('web-evidence')}
        {serviceDependencyScope}
        {serviceDependencyFalsePositives}
        buildSnapshot={websiteSnapshotInput}
        onpreload={() => preloadLookupSection('web-evidence')}
        onshow={() => void showSectionDetail('web-evidence')}
        onhide={() => void hideSectionDetail('web-evidence')}
        onready={restoreDeferredLookupTarget}
        setServiceDependencyScope={(value) => serviceDependencyScope = value}
        setServiceDependencyFalsePositives={(value) => serviceDependencyFalsePositives = value}
        {sourceCheckpoint}
      />
    {/if}
    {/snippet}

    {#snippet sourceCheckpoint(category: CheckpointFact['category'], label: string)}
      {#if result?.type === 'domain'}
        {#key result}
          <LookupSourceCheckpoint {label} facts={checkpointFacts.filter(fact => fact.category === category)}
            record={caseRecord} ready={caseSourceState === 'ready'} busy={caseActionBusy} status={caseStatus}
            oncreate={openLookupCase} onsave={saveEvidenceCheckpoint} />
        {/key}
      {/if}
    {/snippet}

    {#snippet registrySection()}
    <section class="result-section family-registry" id="registry" aria-labelledby="registry-title">
      <h3 id="registry-title">Registration</h3>

      <LookupFamilySummary
        label="Registration"
        description="Compare authoritative registry evidence with separately attributed registrar RDAP and WHOIS publications."
        metrics={[`${registryDisplay.comparisonMetrics.equivalent} equivalent`, `${registryDisplay.comparisonMetrics.conflict} conflicts`, `${registryDisplay.comparisonMetrics.limitedOrSourceOnly} limited or source-only`]}
        expanded={sectionDetailVisible('registry')}
        onpreload={()=>preloadLookupSection('registry')}
        onshow={()=>void showSectionDetail('registry')}
        onhide={()=>void hideSectionDetail('registry')}
      />
      {#if sectionDetailVisible('registry')}
      {#if registryAccess.suffix}
        <DeferredSurface
          load={()=>import('$lib/components/RegistryAccessNotice.svelte')}
          loadingLabel="Loading registry-access context…"
          unavailableLabel="Registry-access context could not be loaded."
          props={{access:registryAccess,lookupTarget:completedLookupTarget}}
        />
      {/if}

      {#if idnAnalysis && (idnAnalysis.hasIdn || idnAnalysis.referenceMatches.length)}
        <section class="idn-card evidence-card card" aria-labelledby="idn-title">
          <header class="section-head"><div><p class="eyebrow">Domain identity</p><h4 id="idn-title">IDN and confusable review</h4></div><span>{idnAnalysis.mappingVersion}</span></header>
          <div class="idn-forms stat-grid"><article><small>Unicode display</small><strong>{idnAnalysis.unicodeDomain}</strong></article><article><small>DNS-safe ASCII</small><strong>{idnAnalysis.asciiDomain}</strong></article><article><small>Writing scripts</small><strong>{idnAnalysis.scripts.join(', ')||'None detected'}</strong></article></div>
          {#if idnAnalysis.findings.length}<ul class="finding-list">{#each idnAnalysis.findings as finding}<li class="callout {finding.tone==='warning'?'warn':'info'}"><strong>{finding.label}</strong><span>{finding.detail}</span></li>{/each}</ul>{/if}
          <p class="card-note">Review Unicode and ASCII forms together. These are bounded similarity indicators and do not establish maliciousness.</p>
        </section>
      {/if}

      <div class="evidence-component" id="evidence-registry"><DeferredSurface
        load={()=>import('$lib/components/LookupRegistrySources.svelte')}
        loadingLabel="Loading registration evidence…"
        unavailableLabel="Registration evidence could not be loaded."
        onready={restoreDeferredLookupTarget}
        props={{comparisonSummary:`RDAP / WHOIS comparison · ${comparison.counts.conflict} conflicts · ${sourceOnlyCount} source-only · ${redactedComparisonCount} redacted · ${limitedComparisonCount} unavailable/incomplete · ${comparison.counts.equivalent} equivalent`,comparisonRows:registryDisplay.comparisonRows,comparisonHasConflicts:comparison.counts.conflict>0,rdapError:boundedTechnologyText(rdap.error,240),resultType:String(result?.type||''),rdapParsed,rdapPartialDetail:registryDisplay.rdapPartialDetail,rdapRows:registryDisplay.rdapRows,whoisError:boundedTechnologyText(whois.error,240),whoisRows:registryDisplay.whoisRows,whoisContactRoles:registryDisplay.whoisContactRoles,whoisTruncatedFields:stringList(whoisParsed.fieldsTruncated,64,80),registrationTrace:registryDisplay.registrationTrace,insights:registryInsights,standing:registrarStanding,registrar:registryDisplay.registrarRdap}}
      /></div>

      {#if result?.type==='domain' && Array.isArray(rdapParsed.redactions) && rdapParsed.redactions.length}
        <div class="evidence-component"><DeferredSurface
          load={()=>import('$lib/components/RegistrationDisclosurePlanner.svelte')}
          loadingLabel="Loading registration-disclosure planner…"
          unavailableLabel="The disclosure planner could not be loaded."
          props={{domain:caseDomain,observedAt:lookupObservedAt,registryRdapEndpoint:boundedTechnologyText(rdap.endpoint,2048),rdapParsed,registrar:registryDisplay.registrarRdap,caseReference:caseRecord?.id??''}}
        /></div>
      {/if}

      {@render sourceCheckpoint('registration', 'Registration')}

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
        onpreload={()=>preloadLookupSection('relationships-history')}
        onshow={()=>void showSectionDetail('relationships-history')}
        onhide={()=>void hideSectionDetail('relationships-history')}
      />
      {#if sectionDetailVisible('relationships-history')}
        <DeferredSurface
          load={()=>import('$lib/components/LookupVisualWorkspace.svelte')}
          loadingLabel="Loading relationships and history workspace…"
          unavailableLabel="Relationships and history could not be loaded."
          onready={restoreDeferredLookupTarget}
          props={{view:visualView,setview:(value:LookupVisualView)=>visualView=value,target:evidenceTopologyTarget,nodes:evidenceTopologyNodes,graph:lookupAssetGraph,pivots:analystEvidencePivots,events:activationContext.events,context:result?.type==='domain'?activationContext:null,onnavigate:(href:string)=>void navigateToLookupEvidence(href)}}
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
        onpreload={()=>preloadLookupSection('source-quality')}
        onshow={()=>void showSectionDetail('source-quality')}
        onhide={()=>void hideSectionDetail('source-quality')}
      />
      {#if sectionDetailVisible('source-quality') && result}
        <DeferredSurface
          load={()=>import('$lib/components/LookupEvidenceQuality.svelte')}
          loadingLabel="Loading source-quality review…"
          unavailableLabel="Source-quality review could not be loaded."
          onready={restoreDeferredLookupTarget}
          props={{matrix:evidenceQualityMatrix,lookupDecisionFacts,refreshPlan:lookupSourceRefreshPlan,original:result,refreshLedger:sourceRefreshLedger,onrefreshchange:(value:LookupSourceRefreshLedger)=>sourceRefreshLedger=value,caseTarget:{record:caseRecord,ready:caseSourceState==='ready',busy:caseActionBusy,status:caseStatus,oncreate:openLookupCase,onsave:saveRefreshedCheckpoint},depth:lookupEvidenceDepth,timing:lookupTiming,onpolicychange:setFreshnessPolicy}}
        />
        <DeferredSurface
          load={()=>import('$lib/components/LookupOverviewFacts.svelte')}
          loadingLabel="Loading evidence facts and diagnostics…"
          unavailableLabel="Evidence facts and diagnostics could not be loaded."
          props={{facts:[...lookupSummary.facts],diagnostics:[...lookupSummary.diagnostics],hasAssessment:availability.applicable!==false}}
        />
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
          metrics={[caseSourceState==='ready'?(caseRecord?'Case saved':'No case saved'):caseSourceState==='loading'?'Case loading':'Case unavailable', `${abuseRecipientResolution.recipients.length} published ${abuseRecipientResolution.recipients.length===1?'route':'routes'}`]}
          expanded={sectionDetailVisible('case-response')}
          onpreload={()=>preloadLookupSection('case-response')}
          onshow={()=>void showSectionDetail('case-response')}
          onhide={()=>void hideSectionDetail('case-response')}
        />
        {#if sectionDetailVisible('case-response')}
        <DeferredSurface
          load={()=>import('$lib/components/LookupCaseResponse.svelte')}
          loadingLabel="Loading Case and response workspace…"
          unavailableLabel="The Case and response workspace could not be loaded."
          onready={restoreDeferredLookupTarget}
          props={{oncaseopen:preserveLookupReturn,domain:caseDomain,lookupTarget:caseObservationTarget,lookupDepth:lookupEvidenceDepth,task:taskView,incidentUrl:completedIncidentUrl,recheckComparison:caseRecheckComparison,record:caseRecord,note:caseNote,caseStatus,caseSourceState,retryCaseRead:()=>refreshCase(),caseDisposition,caseReviewReason,checkpointFacts,draftStatus,outreach,recipientResolution:abuseRecipientResolution,linkedWatchlistNames,watchlistSourceState,watchlistName,watchlistStatus,setNote:(value:string)=>caseNote=value,setCaseDisposition:(value:string)=>{caseDisposition=value;if(!isReviewedCaseDisposition(value))caseReviewReason='';},setCaseReviewReason:(value:string)=>caseReviewReason=value,setWatchlistName:(value:string)=>watchlistName=value,createCase:openLookupCase,addNote:addLookupNote,recordConclusion:recordLookupConclusion,recordInvestigationContext:recordLookupInvestigationContext,recordRecheckOutcome:recordLookupRecheckOutcome,saveToWatchlist:saveLookupWatchlist,recheckCase:recheckLookupCase,recordRecipient:recordAbuseRecipient,copyDraft,statusLabel:caseStatusLabel,dispositionLabel:caseDispositionLabel,actionBusy:caseActionBusy,watchlistBusy:watchlistActionBusy}}
        />
        {#if caseRecord && checkpointFacts.length && taskView === 'acquisition'}
          <LookupEvidenceCheckpoint
            facts={checkpointFacts}
            pins={caseRecord.evidencePins}
            onsave={saveEvidenceCheckpoint}
            actionBusy={caseActionBusy}
          />
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
        description="Open optional external intelligence and the full validated lookup response only when the investigation requires their additional detail."
        metrics={[`${threatIntelligenceProviders.length} external providers`, 'Full response available']}
        expanded={sectionDetailVisible('advanced-evidence')}
        onpreload={()=>preloadLookupSection('advanced-evidence')}
        onshow={()=>void showSectionDetail('advanced-evidence')}
        onhide={()=>void hideSectionDetail('advanced-evidence')}
      />
      {#if sectionDetailVisible('advanced-evidence')}
        {#if threatIntelligenceProviders.length}
          <section class="advanced-block" id="external-intelligence" aria-labelledby="external-intelligence-title">
            <h4 id="external-intelligence-title">External intelligence</h4>
            <DeferredSurface
              load={()=>import('$lib/components/LookupExternalIntelligence.svelte')}
              loadingLabel="Loading external-intelligence evidence…"
              unavailableLabel="External-intelligence evidence could not be loaded."
              onready={restoreDeferredLookupTarget}
              props={{providers:threatIntelligenceProviders,riskContext:externalRiskContext,riskModelVersion:risk?.modelVersion??null,showValue:show,formatDate}}
            />
          </section>
        {/if}
        <section class="advanced-block" id="raw-data" aria-labelledby="raw-data-title">
          <h4 id="raw-data-title">Validated lookup response</h4>
          <div class="raw card">
            <p class="card-note">Full response returned to this browser after validation. Source-specific limits and unavailable fields remain explicit.</p>
            <!-- svelte-ignore a11y_no_noninteractive_tabindex (Safari requires a focusable scroll region.) -->
            <div class="raw-response-scroll" role="group" tabindex="0" aria-labelledby="raw-data-title">
              <pre>{validatedResponseJson}</pre>
            </div>
          </div>
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
  .result-root{min-width:0;overflow-x:clip;overflow-clip-margin:3px;scroll-margin-top:var(--local-nav-anchor-offset,72px)}
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
  .portable-evidence-status{margin:12px 0 0;padding:10px 12px;border:1px dotted var(--amber);border-radius:var(--radius-sm);color:var(--text);background:color-mix(in srgb,var(--amber) 7%,var(--surface));font-size:var(--text-xs);line-height:1.55}
  :global(.result-root.lookup-scroll-aligning){overflow-anchor:none}
  .result-section{--section-accent:var(--accent2);margin-top:26px}
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
  .evidence-card{padding:var(--card-pad)}
  .evidence-card .section-head p:not(.eyebrow){margin:4px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .evidence-card .stat-grid{margin-top:14px}
  .card-note{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}

  .finding-list{display:grid;gap:7px;margin:12px 0 0;padding:0;list-style:none}
  .finding-list .callout{margin:0}
  .finding-list strong{display:block;color:var(--text);font-size:var(--text-xs)}
  .finding-list span{display:block;margin-top:3px}

  .raw{padding:0;overflow:hidden}
  .raw>.card-note{margin:0;padding:10px var(--card-pad);border-bottom:1px solid var(--border)}
  .raw-response-scroll{max-height:520px;overflow:auto}
  .raw-response-scroll:focus-visible{outline:2px solid var(--focus);outline-offset:-2px}
  .raw pre{margin:0;padding:var(--card-pad);font-size:var(--text-xs)}

  @media(max-width:700px){
    .detailed-assessment>summary{align-items:flex-start;flex-direction:column;gap:10px}
  }
</style>
