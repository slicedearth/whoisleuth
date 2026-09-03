import { profileSignals, type ActiveBrandProfileSourceState, type BrandProfile } from '../brand-profiles.ts';
import type { Candidate } from '../candidate-handoff-core.ts';
import { canonicalRegistrableDomain } from '../../../../lib/registrable-domain.mts';
import { analyzeDomainIdn } from './idn-confusables.ts';
import { compactHttpObservation } from './http-summary.ts';
import { createPageBaseline } from './page-baseline.ts';
import { comparePageBaselines, hasStrongPageIdentityReviewMatch } from './page-similarity.ts';
import { entityDisplayName } from './utils.ts';
import { explainOpportunityScore, explainRiskScore, formatActivityCell } from './scoring.ts';
import { relationshipObservation } from './relationship-evidence.ts';
import { lookupRecord, type CompactLookupHttpResponse } from './lookup-response.ts';
import {
  bulkProfileContextProvenance,
  normalizeBulkComparisonEvidence,
} from './bulk-session-model.ts';
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
  targetDomain: string;
  mode: ScanMode;
  profile: BrandProfile | null;
  profileSourceState?: ActiveBrandProfileSourceState;
  candidate: Candidate | null;
}>;

/**
 * Bulk registration, DNS, website, and TLS evidence is collected for the
 * registrable domain. Canonicalise and de-duplicate that identity before any
 * request so equivalent Unicode, trailing-dot, and subdomain inputs cannot
 * create duplicate rows whose evidence all belongs to one target.
 *
 * Invalid inputs remain in the queue in a bounded lower-case form so the
 * ordinary Lookup boundary can return an explicit per-row error rather than
 * silently discarding analyst input.
 */
export function canonicalBulkTargets(values: readonly string[]): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const target = canonicalRegistrableDomain(trimmed) ?? trimmed.toLowerCase();
    if (seen.has(target)) continue;
    seen.add(target);
    targets.push(target);
  }
  return targets;
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
  const targetDomain = canonicalRegistrableDomain(context.targetDomain);
  const evidenceDomain = canonicalRegistrableDomain(body.availability.domain);
  if (!targetDomain || !evidenceDomain || targetDomain !== evidenceDomain) {
    throw new TypeError('Bulk result target does not match its registrable-domain evidence.');
  }
  const domain = evidenceDomain;
  const mutationTypes = context.candidate?.mutationTypes ?? [];
  const profileContextReady = (context.profileSourceState ?? 'ready') === 'ready';
  const profileContext = bulkProfileContextProvenance(context.profileSourceState ?? 'ready', context.profile);
  const officialDomains = profileContextReady ? context.profile?.officialDomains ?? [] : [];
  const hasActiveBrandProfile = profileContextReady ? Boolean(context.profile) : null;
  const matched = profileContextReady
    ? profileSignals(domain, availability, context.profile)
    : { trusted: null, faviconMatch: null, faviconNearMatch: null, reusesOfficialAssets: null };
  const idn = analyzeDomainIdn(domain, officialDomains);
  const registrant = compactContact(availability.registrant);
  const sourceCoverage = compactSourceCoverage(body, availability);
  const pageComparison = profileContextReady
    ? comparePageBaselines(context.profile?.pageBaseline, createPageBaseline(domain, availability))
    : null;
  const pageBaselineMatch = profileContextReady ? hasStrongPageIdentityReviewMatch(pageComparison) : null;
  const idnReferenceMatch = profileContextReady ? Boolean(idn?.referenceMatches.length) : null;
  const scoring = {
    ...availability,
    ...matched,
    availability: body.availability.state,
    mutationTypes,
    idnReferenceMatch,
    pageBaselineMatch,
    hasActiveBrandProfile,
    hasPublicRegistrantContact: Boolean(registrant?.email),
    scanDepth: context.mode,
    observedAt: body.observedAt,
    sourceCoverage,
  };
  const riskExplanation = profileContextReady ? explainRiskScore(scoring) : null;
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
    officialDomains,
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
    hasActiveBrandProfile,
    riskModelVersion: riskExplanation?.modelVersion ?? null,
    opportunityModelVersion: opportunityExplanation?.modelVersion ?? null,
    riskScore: risk,
    riskFactors: riskExplanation?.factors.map((factor) => ({
      label: factor.label,
      points: factor.delta,
    })) ?? [],
    mutationTypes,
    profileContext,
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
