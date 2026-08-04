import { profileSignals, type BrandProfile } from '../brand-profiles.ts';
import type { Candidate } from '../candidate-handoff-core.ts';
import { analyzeDomainIdn } from './idn-confusables.ts';
import { compactHttpObservation } from './http-summary.ts';
import { createPageBaseline } from './page-baseline.ts';
import { comparePageBaselines } from './page-similarity.ts';
import { entityDisplayName } from './utils.ts';
import { explainOpportunityScore, explainRiskScore, formatActivityCell } from './scoring.ts';
import { relationshipObservation } from './relationship-evidence.ts';
import { lookupRecord, type CompactLookupHttpResponse } from './lookup-response.ts';
import { normalizeBulkComparisonEvidence } from './bulk-session-model.ts';
import {
  boundedStrings,
  boundedText,
  compactContact,
  compactDnsEvidence,
  compactSourceCoverage,
  nullableBoolean,
  plainRecord,
  type SavedScanRecord,
  type ScanMode,
  type ScanResult,
} from './bulk-result-model.ts';

export type BulkScanNormalizationContext = Readonly<{
  mode: ScanMode;
  profile: BrandProfile | null;
  candidate: Candidate | null;
}>;

function pageBaselineRiskMatch(value: ReturnType<typeof comparePageBaselines>): boolean {
  if (!value || value.partial) return false;
  return value.components.filter((component) => {
    if (component.partial) return false;
    if (component.id === 'normalized_html' || component.id === 'form_structure') return component.status === 'same';
    if (component.id === 'dom_structure') return component.status === 'same' || component.status === 'overlap';
    if (component.id === 'visible_text') return component.status === 'same' || (component.agreementPercent ?? 0) >= 90;
    return false;
  }).length >= 2;
}

/**
 * Converts the compact HTTP lookup contract into the bounded result retained by
 * Bulk. Raw registration payloads and expanded contacts never cross this
 * boundary; every optional source keeps its own explicit value or null state.
 */
export function normalizeBulkScanResult(
  body: CompactLookupHttpResponse,
  context: BulkScanNormalizationContext,
): ScanResult {
  const availability = lookupRecord(body.availability);
  const domain = body.availability.domain;
  const mutationTypes = context.candidate?.mutationTypes ?? [];
  const matched = profileSignals(domain, availability, context.profile);
  const idn = analyzeDomainIdn(domain, context.profile?.officialDomains ?? []);
  const registrant = compactContact(availability.registrant);
  const sourceCoverage = compactSourceCoverage(body, availability);
  const pageComparison = comparePageBaselines(context.profile?.pageBaseline, createPageBaseline(domain, availability));
  const pageBaselineMatch = pageBaselineRiskMatch(pageComparison);
  const idnReferenceMatch = Boolean(idn?.referenceMatches.length);
  const scoring = {
    ...availability,
    ...matched,
    availability: body.availability.state,
    mutationTypes,
    idnReferenceMatch,
    pageBaselineMatch,
    hasActiveBrandProfile: Boolean(context.profile),
    hasPublicRegistrantContact: Boolean(registrant?.email),
    scanDepth: context.mode,
    observedAt: body.observedAt,
    sourceCoverage,
  };
  const riskExplanation = explainRiskScore(scoring);
  const risk = riskExplanation?.score ?? null;
  const opportunityExplanation = explainOpportunityScore(scoring);
  const opportunity = opportunityExplanation?.score ?? null;
  const nameservers = boundedStrings(availability.nameservers);
  const abuse = plainRecord(availability.abuse);
  const abuseEmail = boundedText(abuse?.email, 320);
  const hasMx = nullableBoolean(availability.hasMx);
  const hasNullMx = nullableBoolean(availability.hasNullMx);
  const hasSpf = nullableBoolean(availability.hasSpf);
  const hasDmarc = nullableBoolean(availability.hasDmarc);
  const activityStatus = boundedText(availability.activityStatus, 40);
  const privacyProtected = nullableBoolean(availability.privacyProtected);
  const httpSummary = compactHttpObservation(availability.http) ?? {};
  const hasExternalFormAction = nullableBoolean(availability.hasExternalFormAction);
  const comparisonEvidence = normalizeBulkComparisonEvidence(availability.bulkComparison);
  const relationship = relationshipObservation(
    availability,
    context.profile?.officialDomains ?? [],
  );
  const saved: SavedScanRecord = {
    domain,
    scanDepth: context.mode,
    availability: body.availability.state,
    registrarName: entityDisplayName(availability.registrar) || '—',
    nameservers,
    createdDate: boundedText(availability.createdDate, 64),
    expiryDate: boundedText(availability.expiryDate, 64),
    privacyProtected,
    hasMx,
    hasNullMx,
    hasSpf,
    hasDmarc,
    activityStatus,
    pageTitle: boundedText(availability.pageTitle, 300),
    ...httpSummary,
    faviconHash: boundedText(availability.faviconHash, 64),
    faviconPHash: boundedText(availability.faviconPHash, 64),
    faviconMatch: matched.faviconMatch,
    faviconNearMatch: matched.faviconNearMatch,
    reusesOfficialAssets: matched.reusesOfficialAssets,
    hasPasswordField: nullableBoolean(availability.hasPasswordField),
    hasExternalFormAction,
    phishingLanguageMatch: boundedText(availability.phishingLanguageMatch, 300),
    idnReferenceMatch,
    pageBaselineMatch,
    hasActiveBrandProfile: Boolean(context.profile),
    riskModelVersion: riskExplanation?.modelVersion ?? null,
    opportunityModelVersion: opportunityExplanation?.modelVersion ?? null,
    riskScore: risk,
    riskFactors: riskExplanation?.factors.map((factor) => ({
      label: factor.label,
      points: factor.delta,
    })) ?? [],
    mutationTypes,
  };

  return {
    domain,
    status: 'complete',
    availability: saved.availability,
    confidence: body.availability.confidence,
    registrar: saved.registrarName,
    activity: formatActivityCell(activityStatus, hasMx, hasSpf, hasDmarc),
    risk,
    opportunity,
    mutationTypes,
    trusted: matched.trusted,
    error: '',
    saved,
    nameservers,
    faviconHash: saved.faviconHash,
    faviconPHash: saved.faviconPHash,
    faviconMatch: matched.faviconMatch,
    faviconNearMatch: matched.faviconNearMatch,
    reusesOfficialAssets: matched.reusesOfficialAssets,
    hasPasswordField: saved.hasPasswordField === true,
    hasExternalFormAction,
    phishingLanguageMatch: saved.phishingLanguageMatch ?? null,
    registrant,
    abuseEvidence: abuseEmail ? { abuseEmail } : null,
    ct: context.candidate?.certificateTransparency ?? null,
    idn,
    dns: compactDnsEvidence(availability.dns),
    dnssec: boundedText(availability.dnssec, 40),
    comparisonEvidence,
    relationship,
    sourceCoverage,
  };
}
