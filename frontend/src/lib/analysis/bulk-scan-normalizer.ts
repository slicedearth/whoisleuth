import { profileSignals, type BrandProfile } from '../brand-profiles.ts';
import type { Candidate } from '../candidate-handoff-core.ts';
import { analyzeDomainIdn } from './idn-confusables.ts';
import { compactHttpObservation } from './http-summary.ts';
import { entityDisplayName } from './utils.ts';
import { computeOpportunityScore, explainRiskScore, formatActivityCell } from './scoring.ts';
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
  const scoring = {
    ...availability,
    ...matched,
    availability: body.availability.state,
    mutationTypes,
  };
  const riskExplanation = explainRiskScore(scoring);
  const risk = riskExplanation?.score ?? null;
  const opportunity = computeOpportunityScore(scoring);
  const nameservers = boundedStrings(availability.nameservers);
  const registrant = compactContact(availability.registrant);
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
    riskModelVersion: riskExplanation?.modelVersion ?? null,
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
    sourceCoverage: compactSourceCoverage(body, availability),
  };
}
