import { profileSignals as matchProfileSignals, type ActiveBrandProfileSourceState, type BrandProfile } from '../brand-profiles.ts';
import { outreachAction, type Contact } from '../drafts.ts';
import { buildActivationContext } from './activation-context.ts';
import { buildAcquisitionDueDiligence } from './acquisition-due-diligence.ts';
import { resolveAbuseRecipients } from './abuse-recipient-resolver.ts';
import { buildAnalystEvidencePivots } from './analyst-evidence-pivots.ts';
import { buildBrandMimicryReview } from './brand-mimicry-review.ts';
import { buildLookupCheckpointFacts } from './case-evidence-checkpoint.ts';
import { buildCertificatePolicyReview } from './certificate-policy-review.ts';
import { buildLookupEvidenceTopologyNodes } from './evidence-topology.ts';
import { buildLookupEvidenceCoverageLedger } from './evidence-coverage-ledger.ts';
import { calibrateExternalIntelligenceRisk } from './external-intelligence-risk.ts';
import { compactHttpObservation } from './http-summary.ts';
import { analyzeDomainIdn } from './idn-confusables.ts';
import { buildLookupAssetGraph } from './lookup-asset-graph.ts';
import { buildLookupClaimReadiness } from './lookup-claim-readiness.ts';
import { buildLookupDecisionFacts } from './lookup-decision-facts.ts';
import { buildLookupEvidenceImpactPlan } from './lookup-evidence-impact.ts';
import { buildLookupReviewActionModel } from './lookup-review-action-model.ts';
import {
  buildLookupDecisionSupport,
  buildLookupEvidenceQualityMatrix,
} from './lookup-decision-support.ts';
import {
  buildLookupLifecycleDates,
  buildLookupNetworkDisplay,
  buildLookupPageDisplay,
  buildLookupRegistryDisplay,
  boundedTechnologyText,
  rec,
  records,
  show,
} from './lookup-display-model.ts';
import { buildLookupInvestigationBrief } from './lookup-investigation-brief.ts';
import type { LookupDepth, LookupTaskView } from './lookup-presentation.ts';
import {
  buildLookupDnsRehearsalEvidence,
  buildLookupObservationProjection,
  buildLookupTaskEvidence,
  hasLookupWebEvidence,
} from './lookup-route-projections.ts';
import type { LookupHttpResponse, LookupViewModel } from './lookup-response.ts';
import { buildLookupSourceRefreshPlan, type LookupFreshnessPolicyInput } from './lookup-source-refresh.ts';
import { buildLookupSummaryModel } from './lookup-summary-model.ts';
import { createPageBaseline } from './page-baseline.ts';
import { comparePageBaselines, hasStrongPageIdentityReviewMatch } from './page-similarity.ts';
import { compareRdapPublications, compareRegistrySources } from './registry-comparison.ts';
import {
  explainOpportunityScore,
  explainRiskScore,
  buildRiskScoreSensitivity,
  type OpportunityExplanation,
  type RiskExplanation,
  type RiskScoreSensitivity,
} from './scoring.ts';
import { entityDisplayName } from './utils.ts';

export { latestLookupTimestamp } from './lookup-route-projections.ts';

export interface LookupRouteAnalysisInput {
  result: LookupHttpResponse | null;
  lookupView: LookupViewModel;
  profile: BrandProfile | null;
  profileSourceState?: ActiveBrandProfileSourceState;
  task: LookupTaskView;
  hasReviewedCaseRecipient?: boolean;
  completedLookupDepth: LookupDepth | null;
  freshnessPolicy?: LookupFreshnessPolicyInput;
}

function hasPublicRegistrantContact(value: unknown): boolean {
  const contact = rec(value);
  return ['email', 'url'].some((key) => typeof contact[key] === 'string' && String(contact[key]).trim().length > 0);
}

export function buildLookupRouteAnalysis(input: LookupRouteAnalysisInput) {
  const { result, lookupView, profile, task } = input;
  const profileSourceState = input.profileSourceState ?? 'ready';
  const profileContextReady = profileSourceState === 'ready';
  const hasActiveBrandProfile = profileContextReady ? Boolean(profile) : null;
  const profileContextLimitation = profileSourceState === 'ready'
    ? null
    : profileSourceState === 'loading'
      ? 'Browser-local Brand Profile context is still loading. Profile-derived trust, allowlist, resemblance, and official-reference conclusions remain unevaluated.'
      : 'Browser-local Brand Profile context was unavailable. Profile-derived trust, allowlist, resemblance, and official-reference conclusions remain inconclusive.';
  const {
    availability,
    rdap,
    registrarRdap,
    registrarRdapParsed,
    rdapParsed,
    whoisParsed,
    diagnostics,
    timing: lookupTiming,
    registryInsights,
    reverseDns,
    reverseDnsRecords,
    observedNetworkContext,
    observedNetworkEndpoint,
    observedNetwork,
    securityTxt,
    sslbl,
    threatIntelligence,
    threatIntelligenceProviders,
    dnsEvidence,
    dnsRecords,
    httpEvidence,
    httpResponse,
    httpSecurityHeaders,
    httpDeliveryMetadata,
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
    pageIdentity,
    pagePublicationMetadata,
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
    pageRoleProfile,
    clientBehaviorProfile,
    securityPosture,
    securityPostureSummary,
  } = lookupView;
  const browserLibraryProfile = rec(technologyProfile.browserLibraryProfile);
  const compactHttpSummary = compactHttpObservation(availability.http) || {};
  const whoisRoleOrder = ['registrant', 'administrative', 'technical', 'billing', 'abuse'];
  const whoisContactsByRole = rec(whoisParsed.contactsByRole);
  const rdapDiagnostic = rec(diagnostics.rdap);
  const whoisDiagnostic = rec(diagnostics.whois);
  // Results are labelled and scored from the exact request that completed.
  // Null is possible only before a result exists or for an old ambiguous
  // in-memory workflow, where the conservative Fast contract is used.
  const lookupEvidenceDepth: LookupDepth = input.completedLookupDepth ?? 'fast';
  const { lookupObservedAt, evidenceObservedAtById } = buildLookupObservationProjection(result, lookupView);
  const populatedWhoisRoles = whoisRoleOrder.filter((role) => records(whoisContactsByRole[role]).length > 0);
  const comparison = result?.type === 'domain'
    ? compareRegistrySources(rdapParsed, whoisParsed, {
        rdapStatus: typeof rdapDiagnostic.status === 'string' ? rdapDiagnostic.status : undefined,
        whoisStatus: typeof whoisDiagnostic.status === 'string' ? whoisDiagnostic.status : undefined,
      })
    : {
        fields: [],
        counts: {
          equivalent: 0,
          conflict: 0,
          rdap_only: 0,
          whois_only: 0,
          rdap_redacted: 0,
          whois_redacted: 0,
          rdap_unavailable: 0,
          whois_unavailable: 0,
          rdap_incomplete: 0,
          whois_incomplete: 0,
        },
      };
  const registrarPublicationComparison = result?.type === 'domain'
    ? compareRdapPublications(rdapParsed, registrarRdapParsed, {
        registryStatus: typeof rdapDiagnostic.status === 'string' ? rdapDiagnostic.status : undefined,
        registrarStatus: typeof registrarRdap.status === 'string' ? registrarRdap.status : undefined,
      })
    : {
        fields: [],
        counts: {
          equivalent: 0,
          conflict: 0,
          registry_only: 0,
          registrar_only: 0,
          registry_redacted: 0,
          registrar_redacted: 0,
          registry_unavailable: 0,
          registrar_unavailable: 0,
          registry_incomplete: 0,
          registrar_incomplete: 0,
        },
      };
  const lifecycleDates = buildLookupLifecycleDates({ availability, rdapParsed, whoisParsed });
  const networkDisplay = buildLookupNetworkDisplay({
    availability,
    reverseDns,
    reverseDnsRecords,
    dnsEvidence,
    dnsRecords,
    httpEvidence,
    httpResponse,
    httpSecurityHeaders,
    httpDeliveryMetadata,
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
  });
  const dnsRehearsalEvidence = buildLookupDnsRehearsalEvidence(result, lookupView);
  const registryDisplay = buildLookupRegistryDisplay({
    result,
    rdapParsed,
    whoisParsed,
    whoisContactsByRole,
    populatedWhoisRoles,
    comparison,
    registrarRdap,
    registrarRdapParsed,
    registrarPublicationComparison,
  });
  const idnAnalysis = result?.type === 'domain'
    ? analyzeDomainIdn(
        String(result.registrableDomain || availability.domain || ''),
        profileContextReady ? profile?.officialDomains || [] : [],
      )
    : null;
  const profileSignals = profileContextReady
    ? matchProfileSignals(String(availability.domain || result?.registrableDomain || ''), availability, profile)
    : { trusted: null, faviconMatch: null, faviconNearMatch: null, reusesOfficialAssets: null };
  const caseDomain = String(availability.domain || result?.registrableDomain || '').trim().toLowerCase();
  const externalRiskContext = calibrateExternalIntelligenceRisk(threatIntelligence, caseDomain);
  const outreach = outreachAction(
    String(availability.domain || result?.registrableDomain || ''),
    (availability.registrant || null) as Contact | null,
  );
  const abuseRecipientResolution = resolveAbuseRecipients({
    registryInsights,
    availabilityAbuse: availability.abuse,
    securityTxt,
    networkContext: observedNetworkContext,
  });
  const sourceOnlyCount = comparison.counts.rdap_only + comparison.counts.whois_only;
  const redactedComparisonCount = comparison.counts.rdap_redacted + comparison.counts.whois_redacted;
  const limitedComparisonCount = comparison.counts.rdap_unavailable
    + comparison.counts.whois_unavailable
    + comparison.counts.rdap_incomplete
    + comparison.counts.whois_incomplete;
  const observedPageBaseline = createPageBaseline(caseDomain, availability);
  const pageComparison = comparePageBaselines(profileContextReady ? profile?.pageBaseline : null, observedPageBaseline);
  const pageDisplay = buildLookupPageDisplay({
    pageIdentity,
    pagePublicationMetadata,
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
  });
  const brandMimicryReview = buildBrandMimicryReview({
    hasActiveProfile: hasActiveBrandProfile,
    trustedDomainKind: profileSignals.trusted,
    profileSignals,
    pageComparison,
    hasPasswordField: availability.hasPasswordField,
    phishingLanguageMatch: availability.phishingLanguageMatch,
  });
  const hasWebEvidence = hasLookupWebEvidence(result, lookupView, profile, pageComparison);
  const lookupTaskEvidence = buildLookupTaskEvidence(result, lookupView);
  const hasCaseSection = Boolean(caseDomain) || Boolean(outreach) || abuseRecipientResolution.recipients.length > 0;
  const evidenceTopologyNodes = buildLookupEvidenceTopologyNodes({
    targetType: result?.type,
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
  });
  const desiredCertificateBaseline = profile?.desiredPostureBaselines.find((item) => item.domain === caseDomain) ?? null;
  const certificatePolicyReview = buildCertificatePolicyReview({
    observedAt: lookupObservedAt,
    dnsEvidence,
    dnsRecords,
    tlsEvidence,
    tlsIssuer,
    tlsPublicKey,
    tlsAltNames,
    baseline: desiredCertificateBaseline,
  });
  const lookupAssetGraph = buildLookupAssetGraph({
    target: caseDomain,
    observedAt: lookupObservedAt,
    rdapEvidence: rdap,
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
    profileDomains: {
      official: profile?.officialDomains ?? [],
      partner: profile?.approvedPartnerDomains ?? [],
      allowlisted: profile?.allowlistedDomains ?? [],
    },
  });
  const analystEvidencePivots = buildAnalystEvidencePivots({
    type: result?.type,
    query: result?.query,
    registrableDomain: result?.registrableDomain,
    observedAddress: observedNetworkEndpoint.address,
    observedCidrs: observedNetwork.cidrs,
    startAutnum: rdapParsed.startAutnum,
    endAutnum: rdapParsed.endAutnum,
  });
  const activationContext = buildActivationContext({
    registryCreated: lifecycleDates.created,
    registryUpdated: lifecycleDates.updated,
    registryExpires: lifecycleDates.expires,
    tlsValidFrom: tlsCertificate.validFrom,
    tlsValidTo: tlsCertificate.validTo,
    observedAt: lookupObservedAt,
    dnsStatus: dnsEvidence.status,
    dnsComplete: dnsEvidence.complete,
    hasMx: availability.hasMx,
    hasSpf: availability.hasSpf,
    hasDmarc: availability.hasDmarc,
    httpStatus: httpResponse.status,
    pageObserved: pageIdentity.source === 'html',
    tlsObserved: tlsEvidence.source === 'tls' && tlsEvidence.status !== 'skipped',
  });
  const acquisitionDueDiligence = buildAcquisitionDueDiligence({
    availability,
    registryInsights,
    activationContext,
    dnsEvidence,
    dnsRecords,
    tlsEvidence,
  });
  const evidenceCoverage = buildLookupEvidenceCoverageLedger({
    targetType: result?.type,
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
  });
  const scoreCoverage = evidenceCoverage.entries
    .filter((entry) => ['rdap', 'whois', 'availability', 'registrar-rdap', 'dns', 'http', 'page-identity'].includes(entry.id)
      || entry.id.startsWith('external-'))
    .map((entry) => ({ source: entry.id, state: entry.state }));
  const pageBaselineMatch = profileContextReady ? hasStrongPageIdentityReviewMatch(pageComparison) : null;
  const idnReferenceMatch = profileContextReady ? Boolean(idnAnalysis?.referenceMatches.length) : null;
  const scoredAvailability = {
    ...availability,
    ...profileSignals,
    domain: caseDomain,
    threatIntelligence,
    mutationTypes: [],
    idnReferenceMatch,
    pageBaselineMatch,
    hasActiveBrandProfile,
    hasPublicRegistrantContact: hasPublicRegistrantContact(availability.registrant),
    scanDepth: lookupEvidenceDepth,
    observedAt: lookupObservedAt,
    sourceCoverage: scoreCoverage,
  };
  const opportunity: OpportunityExplanation | null = explainOpportunityScore(scoredAvailability);
  const risk: RiskExplanation | null = profileContextReady ? explainRiskScore(scoredAvailability) : null;
  const riskSensitivity: RiskScoreSensitivity | null = profileContextReady
    ? buildRiskScoreSensitivity(scoredAvailability)
    : null;
  const lookupSourceRefreshPlan = buildLookupSourceRefreshPlan(
    evidenceCoverage,
    lookupObservedAt,
    new Date().toISOString(),
    {
      task,
      observedAtByEvidence: evidenceObservedAtById,
      ...(input.freshnessPolicy ? { freshnessPolicy: input.freshnessPolicy } : {}),
    },
  );
  const lookupDecisionSupport = buildLookupDecisionSupport({
    task,
    coverage: evidenceCoverage,
    refreshPlan: lookupSourceRefreshPlan,
    registryComparison: comparison,
    registrarPublicationComparison,
    requestedHost: result?.inputHostname || result?.registrableDomain || result?.query,
    registrableDomain: result?.registrableDomain,
    finalUrl: httpEvidence.finalUrl,
    canonicalUrl: pageCanonical.url,
    openGraphUrl: pageOpenGraphUrl.url,
    tlsAuthorization,
    certificatePolicyReview,
    targetType: result?.type,
    availableEvidence: lookupTaskEvidence,
    hasCaseSection,
  });
  const lookupClaimReadiness = buildLookupClaimReadiness({
    targetType: result?.type,
    task,
    coverage: evidenceCoverage,
    decisionSupport: lookupDecisionSupport,
    availabilityState: availability.state,
    availabilitySource: availability.source,
    hasActiveProfile: hasActiveBrandProfile === true,
    profileSourceState,
    hasCaseSection,
    ...(input.hasReviewedCaseRecipient === undefined ? {} : { hasReviewedCaseRecipient: input.hasReviewedCaseRecipient }),
    responseRecipientCount: abuseRecipientResolution.recipients.length,
    registryComparison: comparison,
    registrarPublicationComparison,
    observedAt: {
      registry: rdapDiagnostic.fetchedAt,
      whois: whoisDiagnostic.queriedAt,
      registrar: registrarRdap.fetchedAt,
    },
  });
  const evidenceQualityMatrix = buildLookupEvidenceQualityMatrix({
    coverage: evidenceCoverage,
    refreshPlan: lookupSourceRefreshPlan,
    timing: lookupTiming,
    observedAt: lookupObservedAt,
    observedAtByEvidence: evidenceObservedAtById,
  });
  const lookupDecisionFacts = buildLookupDecisionFacts({
    decisionSupport: lookupDecisionSupport,
    coverage: evidenceCoverage,
    quality: evidenceQualityMatrix,
  });
  const lookupEvidenceImpactPlan = buildLookupEvidenceImpactPlan({
    readiness: lookupClaimReadiness,
    quality: evidenceQualityMatrix,
    facts: lookupDecisionFacts,
  });
  const lookupReviewActionModel = buildLookupReviewActionModel({
    support: lookupDecisionSupport,
    facts: lookupDecisionFacts,
    evidenceImpact: lookupEvidenceImpactPlan,
  });
  const lookupSummary = buildLookupSummaryModel({
    availability,
    rdapParsed,
    whoisParsed,
    registrarRdap,
    registryComparison: comparison,
    registrarPublicationComparison,
    diagnostics,
    profileSignals,
    idnAnalysis,
    resultObservedAt: lookupObservedAt,
    createdDate: lifecycleDates.created,
    expiresDate: lifecycleDates.expires,
    updatedDate: lifecycleDates.updated,
  });
  const lookupInvestigationBrief = buildLookupInvestigationBrief({
    target: result?.registrableDomain || result?.query,
    targetType: result?.type,
    task,
    decisionSupport: lookupDecisionSupport,
    decisionFacts: lookupDecisionFacts,
    quality: evidenceQualityMatrix,
    graph: lookupAssetGraph,
  });
  const evidenceTopologyTarget = {
    label: show(result?.registrableDomain || result?.query),
    detail: `${show(result?.type)} · ${lookupEvidenceDepth} lookup`,
    status: show(availability.state),
  };
  const caseEvidence = {
    inputHostname: typeof result?.inputHostname === 'string' ? result.inputHostname : null,
    availability: boundedTechnologyText(availability.state, 40),
    confidence: boundedTechnologyText(availability.confidence, 40) || null,
    riskModelVersion: risk?.modelVersion ?? null,
    riskScore: risk?.score ?? null,
    opportunityModelVersion: opportunity?.modelVersion ?? null,
    opportunityScore: opportunity?.score ?? null,
    riskFactors: risk?.factors.map((factor) => ({ label: factor.label, points: factor.delta })) ?? [],
    opportunityFactors: opportunity?.factors.map((factor) => ({ label: factor.label, points: factor.delta })) ?? [],
    registrar: entityDisplayName(availability.registrar)
      || entityDisplayName(rdapParsed.registrar)
      || entityDisplayName(whoisParsed.registrar),
    createdDate: lifecycleDates.created,
    expiryDate: lifecycleDates.expires,
    nameservers: Array.isArray(availability.nameservers) ? availability.nameservers : [],
    hasMx: availability.hasMx ?? null,
    hasSpf: availability.hasSpf ?? null,
    hasDmarc: availability.hasDmarc ?? null,
    activityStatus: boundedTechnologyText(availability.activityStatus, 40) || null,
    websiteProbeDetail: boundedTechnologyText(availability.websiteProbeDetail, 500) || null,
    pageTitle: availability.pageTitle ?? null,
    faviconMatch: profileSignals.faviconMatch ?? null,
    faviconNearMatch: profileSignals.faviconNearMatch ?? null,
    reusesOfficialAssets: profileSignals.reusesOfficialAssets ?? null,
    hasPasswordField: availability.hasPasswordField ?? null,
    hasExternalFormAction: availability.hasExternalFormAction ?? null,
    phishingLanguageMatch: availability.phishingLanguageMatch ?? null,
    privacyProtected: availability.privacyProtected ?? null,
    idnReferenceMatch,
    pageBaselineMatch,
    hasActiveBrandProfile,
    profileContextState: profileSourceState,
    profileContextLimitation,
    ...compactHttpSummary,
    mutationTypes: [],
  };
  const checkpointFacts = result?.type === 'domain'
    ? buildLookupCheckpointFacts(result, { collectionDepth: lookupEvidenceDepth })
    : [];

  return {
    lookupEvidenceDepth,
    lookupObservedAt,
    evidenceObservedAtById,
    populatedWhoisRoles,
    comparison,
    registrarPublicationComparison,
    lifecycleDates,
    networkDisplay,
    dnsRehearsalEvidence,
    registryDisplay,
    idnAnalysis,
    profileSignals,
    profileSourceState,
    profileContextLimitation,
    externalRiskContext,
    opportunity,
    risk,
    riskSensitivity,
    outreach,
    abuseRecipientResolution,
    sourceOnlyCount,
    redactedComparisonCount,
    limitedComparisonCount,
    caseDomain,
    observedPageBaseline,
    pageComparison,
    pageDisplay,
    brandMimicryReview,
    hasWebEvidence,
    hasCaseSection,
    evidenceTopologyNodes,
    certificatePolicyReview,
    lookupAssetGraph,
    analystEvidencePivots,
    activationContext,
    acquisitionDueDiligence,
    evidenceCoverage,
    lookupSourceRefreshPlan,
    lookupDecisionSupport,
    lookupDecisionFacts,
    lookupClaimReadiness,
    lookupEvidenceImpactPlan,
    lookupReviewActionModel,
    evidenceQualityMatrix,
    lookupSummary,
    lookupInvestigationBrief,
    evidenceTopologyTarget,
    caseEvidence,
    checkpointFacts,
  };
}
