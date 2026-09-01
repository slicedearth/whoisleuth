import type { BrandProfile } from '../brand-profiles.ts';
import {
  boundedTechnologyText,
  rec,
  records,
  stringList,
} from './lookup-display-shared.ts';
import type { LookupTaskEvidenceKind } from './lookup-decision-support.ts';
import type { LookupHttpResponse, LookupViewModel } from './lookup-response.ts';

export function latestLookupTimestamp(...values: unknown[]): string | null {
  const timestamps = values
    .map((value) => typeof value === 'string' ? Date.parse(value) : Number.NaN)
    .filter(Number.isFinite);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
}

export function buildLookupObservationProjection(
  result: LookupHttpResponse | null,
  lookupView: LookupViewModel,
) {
  const {
    diagnostics,
    registrarRdap,
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
  const lookupObservedAt = latestLookupTimestamp(
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
    ...threatIntelligenceProviders
      .slice(0, 10)
      .map((provider) => rec(rec(provider).observation).observedAt),
  );
  const evidenceObservedAtById: Record<string, unknown> = {
    rdap: rdapDiagnostic.fetchedAt,
    whois: whoisDiagnostic.queriedAt,
    availability: latestLookupTimestamp(dnsEvidence.observedAt, httpEvidence.observedAt, tlsEvidence.observedAt),
    'registrar-rdap': registrarRdap.fetchedAt,
    'reverse-dns': reverseDns.observedAt,
    'network-context': latestLookupTimestamp(observedNetworkContext.observedAt, observedNetworkRdap.fetchedAt),
    dns: dnsEvidence.observedAt,
    http: httpEvidence.observedAt,
    tls: tlsEvidence.observedAt,
    'page-identity': latestLookupTimestamp(pageIdentity.observedAt, httpEvidence.observedAt),
    technology: latestLookupTimestamp(technologyProfile.observedAt, httpEvidence.observedAt),
    'page-role': latestLookupTimestamp(pageRoleProfile.observedAt, httpEvidence.observedAt),
    'client-behavior': latestLookupTimestamp(clientBehaviorProfile.observedAt, httpEvidence.observedAt),
    'security-posture': latestLookupTimestamp(securityPosture.observedAt, httpEvidence.observedAt, tlsEvidence.observedAt),
    'security-txt': securityTxt.observedAt,
    'sslbl-certificate': sslbl.observedAt,
  };
  for (const providerValue of threatIntelligenceProviders) {
    const provider = rec(providerValue);
    const identity = rec(provider.provider);
    const id = String(identity.id || '').trim();
    if (id) evidenceObservedAtById[`external-${id}`] = rec(provider.observation).observedAt;
  }
  return { lookupObservedAt, evidenceObservedAtById };
}

export function buildLookupDnsRehearsalEvidence(
  result: LookupHttpResponse | null,
  lookupView: LookupViewModel,
) {
  const { availability, rdapParsed, whoisParsed, dnsEvidence, dnsRecords, tlsPublicKey } = lookupView;
  return {
    currentGlue: records(rec(rec(dnsEvidence.delegation).registry).nameserverDetails),
    currentDs: records(rdapParsed.dsData),
    currentMx: records(dnsRecords.mx),
    currentCaa: records(dnsRecords.caa),
    currentCriticalAddresses: [{
      hostname: String(availability.domain || result?.registrableDomain || '').trim().toLowerCase(),
      addresses: [
        ...stringList(dnsRecords.a, 16, 64),
        ...stringList(dnsRecords.aaaa, 16, 64),
      ],
    }],
    currentRegistrationStatuses: [
      ...stringList(rdapParsed.statuses, 100, 160),
      ...stringList(whoisParsed.statuses, 100, 160),
    ],
    currentTlsSpkiSha256: tlsPublicKey.fingerprintSha256,
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

export function hasLookupWebEvidence(
  result: LookupHttpResponse | null,
  lookupView: LookupViewModel,
  profile: BrandProfile | null,
  pageComparison: unknown,
): boolean {
  const {
    reverseDns,
    dnsEvidence,
    httpEvidence,
    tlsEvidence,
    sslbl,
    pageIdentity,
    credentialSurfaceProfile,
    structuredDataIdentity,
    technologyProfile,
    pageRoleProfile,
    clientBehaviorProfile,
    securityPosture,
    securityTxt,
  } = lookupView;
  return reverseDns.source === 'reverse_dns'
    || dnsEvidence.source === 'dns'
    || httpEvidence.source === 'http'
    || tlsEvidence.source === 'tls'
    || sslbl.sslblVersion === 1
    || pageIdentity.source === 'html'
    || credentialSurfaceProfile.source === 'html'
    || structuredDataIdentity.source === 'html'
    || technologyProfile.source === 'derived'
    || pageRoleProfile.source === 'derived'
    || clientBehaviorProfile.source === 'derived'
    || securityPosture.source === 'derived'
    || securityTxt.securityTxtVersion === 1
    || Boolean(pageComparison)
    || Boolean(profile?.pageBaseline && result?.type === 'domain');
}
