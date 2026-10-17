import { analyzeDomainIdn } from '../lib/idn-confusables.mts';
import { profileSignals, type BrandProfileSignalProfile } from '../packages/analysis/brand-profile-signals.mts';
import { boundedJsonLimitsForBytes, parseBoundedJsonObject } from '../packages/analysis/bounded-json.mts';
import { canonicalRegistrableDomain } from '../packages/analysis/registrable-domain.mts';
import { explainRiskScore } from '../packages/analysis/risk-scoring.mts';
import { BRAND_PROFILE_SCHEMA, MAX_PROFILES, MAX_PROFILE_IMPORT_BYTES } from '../packages/contracts/workspace-portability.mts';
import { CliUsageError } from './errors.mts';
import type { UnknownRecord } from './saved-lookup.mts';

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

/** Read one explicitly selected export, not browser storage or configuration. */
export async function readCliRiskProfile(
  source: string | undefined,
  readInput: (source: string, maximumBytes: number, label: string) => Promise<string>,
  selectedId?: string,
): Promise<BrandProfileSignalProfile | null> {
  if (!source) return null;
  const text = await readInput(source, MAX_PROFILE_IMPORT_BYTES, 'Brand Profile export');
  try {
    const raw = parseBoundedJsonObject(text, {
      maximumBytes: MAX_PROFILE_IMPORT_BYTES, limits: boundedJsonLimitsForBytes(MAX_PROFILE_IMPORT_BYTES), label: 'Brand Profile export',
    });
    if (raw.schema !== BRAND_PROFILE_SCHEMA || typeof raw.version !== 'number'
      || !Array.isArray(raw.profiles) || !raw.profiles.length || raw.profiles.length > MAX_PROFILES) throw new TypeError();
    const { normalizeBrandProfileId, normalizeBrandProfileStore } = await import('../packages/workspace/brand-profile-model.mts');
    if (selectedId !== undefined && normalizeBrandProfileId(selectedId) !== selectedId) throw new TypeError();
    const selected = selectedId === undefined ? raw.profiles : raw.profiles.filter(value => record(value).id === selectedId);
    if (selected.length !== 1) throw new TypeError();
    const profile = normalizeBrandProfileStore({ ...raw, profiles: selected }).profiles[0];
    if (!profile || !profile.officialDomains.length) throw new TypeError();
    // Private notes, contacts and other profile fields never enter output or
    // checkpoints. Keep only the existing comparison inputs for this run.
    return {
      officialDomains: profile.officialDomains,
      approvedPartnerDomains: profile.approvedPartnerDomains,
      allowlistedDomains: profile.allowlistedDomains,
      officialFaviconHash: profile.officialFaviconHash,
      officialFaviconPHash: profile.officialFaviconPHash,
    };
  } catch {
    throw new CliUsageError('Use a supported Brand Profile export with a valid official domain; select one unambiguous profile with --brand-id if the export contains multiple profiles.');
  }
}

/** Adapt collected evidence, never an asserted score, lane or severity label. */
export function explainCliLookupRisk(
  document: UnknownRecord,
  profile: BrandProfileSignalProfile | null,
  mode: unknown = document.mode,
) {
  if (document.type !== undefined && document.type !== 'domain') return null;
  const availability = record(document.availability);
  const domain = canonicalRegistrableDomain(document.registrableDomain ?? document.domain ?? availability.domain);
  if (!domain || canonicalRegistrableDomain(availability.domain) !== domain) return null;
  const diagnostics = record(document.diagnostics);
  const sourceCoverage = [
    ...['rdap', 'whois', 'availability'].map(source => ({ source, state: record(diagnostics[source]).status })),
    ...['dns', 'http', 'tls', 'pageIdentity'].map(source => ({
      source: source === 'pageIdentity' ? 'page-identity' : source,
      state: record(availability[source]).status,
    })),
  ].map(item => ({ ...item, state: item.state === 'disabled' ? 'skipped' : item.state }));
  return explainRiskScore({
    domain,
    availability: availability.state,
    ...profileSignals(domain, availability, profile),
    hasActiveBrandProfile: Boolean(profile),
    idnReferenceMatch: profile ? Boolean(analyzeDomainIdn(domain, profile.officialDomains)?.referenceMatches.length) : null,
    mutationTypes: document.mutationTypes,
    hasPasswordField: availability.hasPasswordField,
    hasExternalFormAction: availability.hasExternalFormAction,
    hasExternalPasswordForm: availability.hasExternalPasswordForm,
    phishingLanguageMatch: availability.phishingLanguageMatch,
    activityStatus: availability.activityStatus,
    hasMx: availability.hasMx,
    hasSpf: availability.hasSpf,
    hasDmarc: availability.hasDmarc,
    domainAgeDays: availability.domainAgeDays,
    privacyProtected: availability.privacyProtected,
    scanDepth: mode,
    observedAt: document.observedAt ?? record(availability.http).observedAt,
    sourceCoverage,
  });
}
