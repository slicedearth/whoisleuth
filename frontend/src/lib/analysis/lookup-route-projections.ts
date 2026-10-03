import type { BrandProfile } from '../brand-profiles.ts';
import {
  boundedTechnologyText,
  rec,
  records,
  stringList,
} from './lookup-display-shared.ts';
import type { LookupTaskEvidenceKind } from './lookup-decision-support.ts';
import type { LookupHttpResponse, LookupViewModel } from './lookup-response.ts';
import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';
import { lookupObservationHostname } from '../../../../packages/evidence/lookup-target.mts';

export function latestLookupTimestamp(...values: unknown[]): string | null {
  const timestamps = values
    .map((value) => {
      const timestamp = normalizeExplicitIsoTimestamp(value);
      return timestamp ? Date.parse(timestamp) : Number.NaN;
    })
    .filter(Number.isFinite);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
}

export function buildLookupObservationProjection(
  result: LookupHttpResponse | null,
  lookupView: LookupViewModel,
) {
  const {
    rdap,
    diagnostics,
    registrarRdap,
    registrarStanding,
    reverseDns,
    observedNetworkContext,
    observedNetworkRdap,
    dnsEvidence,
    httpEvidence,
    tlsEvidence,
    pageIdentity,
    technologyProfile,
    pageRoleProfile,
    clientBehaviorProfile,
    securityPosture,
    securityTxt,
    sslbl,
    threatIntelligenceProviders,
  } = lookupView;
  const rdapDiagnostic = rec(diagnostics.rdap);
  const whoisDiagnostic = rec(diagnostics.whois);
  const rdapObservedAt = rdap.fetchedAt ?? rdapDiagnostic.fetchedAt;
  const lookupObservedAt = latestLookupTimestamp(
    result?.observedAt,
    result?.fetchedAt,
    rdapObservedAt,
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
    ...threatIntelligenceProviders
      .slice(0, 10)
      .map((provider) => rec(rec(provider).observation).observedAt),
  );
  const evidenceObservedAtById: Record<string, unknown> = {
    rdap: rdapObservedAt,
    whois: whoisDiagnostic.queriedAt,
    availability: lookupView.availability.observedAt,
    'registrar-rdap': registrarRdap.fetchedAt,
    'registrar-standing': registrarStanding.observedAt,
    'reverse-dns': reverseDns.observedAt,
    'network-context': observedNetworkContext.observedAt,
    dns: dnsEvidence.observedAt,
    http: httpEvidence.observedAt,
    tls: tlsEvidence.observedAt,
    'page-identity': pageIdentity.observedAt,
    technology: technologyProfile.observedAt,
    'page-role': pageRoleProfile.observedAt,
    'client-behavior': clientBehaviorProfile.observedAt,
    'security-posture': securityPosture.observedAt,
    'security-txt': securityTxt.observedAt,
    'sslbl-certificate': sslbl.observedAt,
  };
  for (const providerValue of threatIntelligenceProviders) {
    const provider = rec(providerValue);
    const identity = rec(provider.provider);
    const id = String(identity.id || '').trim();
    if (id) evidenceObservedAtById[`external-${id}`] = rec(provider.observation).observedAt;
  }
  if (lookupView.threatIntelligenceWithheld.length) evidenceObservedAtById['external-withheld'] = null;
  return { lookupObservedAt, evidenceObservedAtById };
}

export function buildLookupDnsRehearsalEvidence(
  result: LookupHttpResponse | null,
  lookupView: LookupViewModel,
) {
  const { availability, rdapParsed, whoisParsed, dnsEvidence, dnsRecords, tlsPublicKey } = lookupView;
  const sameRegistrationScope = lookupObservationHostname(availability) === (availability.domain ?? result?.registrableDomain);
  return {
    evidenceComplete: sameRegistrationScope && dnsEvidence.complete === true,
    currentGlue: records(rec(rec(dnsEvidence.delegation).registry).nameserverDetails),
    currentDs: records(rdapParsed.dsData),
    currentMx: sameRegistrationScope ? records(dnsRecords.mx) : [],
    currentCaa: sameRegistrationScope ? records(dnsRecords.caa) : [],
    currentCriticalAddresses: [{
      hostname: lookupObservationHostname(availability) ?? '',
      addresses: [
        ...stringList(dnsRecords.a, 16, 64),
        ...stringList(dnsRecords.aaaa, 16, 64),
      ],
    }],
    currentRegistrationStatuses: [
      ...stringList(rdapParsed.statuses, 100, 160),
      ...stringList(whoisParsed.statuses, 100, 160),
    ],
    currentTlsSpkiSha256: sameRegistrationScope ? tlsPublicKey.fingerprintSha256 : null,
  };
}

const OBSERVED_TASK_SOURCE_STATES = new Set(['success', 'partial']);

function retainsTaskEvidence(source: unknown, expected: string, state: unknown): boolean {
  if (source !== expected) return false;
  const normalizedState = boundedTechnologyText(state, 40)
    .toLowerCase()
    .replace(/[\s-]+/gu, '_');
  return OBSERVED_TASK_SOURCE_STATES.has(normalizedState);
}

export function buildLookupTaskEvidence(
  result: LookupHttpResponse | null,
  lookupView: LookupViewModel,
): LookupTaskEvidenceKind[] {
  const {
    reverseDns,
    dnsEvidence,
    httpEvidence,
    tlsEvidence,
    pageIdentity,
    credentialSurfaceProfile,
    pageResources,
    securityPosture,
  } = lookupView;
  const evidence: LookupTaskEvidenceKind[] = [];
  if (retainsTaskEvidence(reverseDns.source, 'reverse_dns', reverseDns.status)) evidence.push('ptr');
  if (result?.type !== 'domain') return evidence;
  const hasDns = retainsTaskEvidence(dnsEvidence.source, 'dns', dnsEvidence.status);
  const hasHttp = retainsTaskEvidence(httpEvidence.source, 'http', httpEvidence.status);
  const hasPage = retainsTaskEvidence(pageIdentity.source, 'html', pageIdentity.status);
  if (hasDns) evidence.push('dns', 'delegation', 'mail', 'dependency');
  if (hasHttp) evidence.push('http', 'dependency');
  if (retainsTaskEvidence(tlsEvidence.source, 'tls', tlsEvidence.status)) evidence.push('tls');
  if (hasPage) evidence.push('page', 'identity', 'dependency');
  if (retainsTaskEvidence(credentialSurfaceProfile.source, 'html', credentialSurfaceProfile.status)) evidence.push('form');
  if (hasHttp && records(httpEvidence.redirects).length) evidence.push('redirect');
  if (hasPage && (records(pageResources.externalOrigins).length || Number(pageResources.count) > 0)) {
    evidence.push('dependency');
  }
  if (retainsTaskEvidence(securityPosture.source, 'derived', securityPosture.status)) evidence.push('posture');
  return evidence;
}

/** Source presence is shared by the family gate and its individual surfaces.
 * It deliberately includes partial/unsupported records, not just successful ones. */
export function lookupWebEvidenceSources(view: LookupViewModel) {
  return {
    network: view.observedNetworkContext.contextVersion === 1,
    reverseDns: view.reverseDns.source === 'reverse_dns',
    dns: view.dnsEvidence.source === 'dns',
    http: view.httpEvidence.source === 'http',
    tls: view.tlsEvidence.source === 'tls',
    sslbl: view.sslbl.sslblVersion === 1,
    page: view.pageIdentity.source === 'html',
    credentials: view.credentialSurfaceProfile.source === 'html',
    structuredIdentity: view.structuredDataIdentity.source === 'html',
    technology: view.technologyProfile.source === 'derived',
    pageRole: view.pageRoleProfile.source === 'derived',
    clientBehaviour: view.clientBehaviorProfile.source === 'derived',
    posture: view.securityPosture.source === 'derived',
    disclosure: view.securityTxt.securityTxtVersion === 1,
  };
}

export function lookupPageComparisonState(
  result: Pick<LookupHttpResponse, 'type'> | null,
  profile: Pick<BrandProfile, 'pageBaseline'> | null,
  pageComparison: unknown,
): 'available' | 'unavailable' | 'hidden' {
  if (pageComparison) return 'available';
  return profile?.pageBaseline && result?.type === 'domain' ? 'unavailable' : 'hidden';
}

export function hasLookupWebEvidence(
  lookupView: LookupViewModel,
  pageComparisonState: ReturnType<typeof lookupPageComparisonState>,
): boolean {
  return Object.values(lookupWebEvidenceSources(lookupView)).some(Boolean)
    || pageComparisonState !== 'hidden';
}
