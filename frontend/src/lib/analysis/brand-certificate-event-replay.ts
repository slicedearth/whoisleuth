import type { BrandProfile, DesiredPostureBaseline } from './brand-profile-model.ts';
import { certificateSanPatternMatches } from './certificate-policy-review.ts';
import type { CasePinCompleteness } from './case-response-model.ts';
import type { CaseRecord } from './case-record-model.ts';

export const BRAND_CERTIFICATE_EVENT_REPLAY_VERSION = 1;
export const MAX_REPLAY_EVENTS = 300;

export type CertificateEventReplayState = 'aligned' | 'review' | 'indeterminate' | 'not_configured';

export type CertificateEventReplayClause = Readonly<{
  id: 'issuer' | 'san_patterns';
  label: string;
  state: CertificateEventReplayState;
  expected: readonly string[];
  observed: readonly string[];
  detail: string;
}>;

export type RetainedCertificateEventReview = Readonly<{
  eventId: string;
  certificateSha256: string;
  logId: string;
  observedAt: string;
  notAfter: string | null;
  issuer: string | null;
  names: readonly string[];
  dnsNameCount: number;
  namesComplete: boolean;
  completeness: CasePinCompleteness;
  sources: readonly string[];
  caseReferences: readonly Readonly<{ id: string; domain: string }>[];
  state: CertificateEventReplayState;
  clauses: readonly CertificateEventReplayClause[];
  limitations: readonly string[];
}>;

export type BrandCertificateEventReplay = Readonly<{
  version: typeof BRAND_CERTIFICATE_EVENT_REPLAY_VERSION;
  domains: readonly Readonly<{
    domain: string;
    baselineConfigured: boolean;
    events: readonly RetainedCertificateEventReview[];
  }>[];
  retainedEventCount: number;
  truncated: boolean;
  limitations: readonly string[];
}>;

type EventGroup = {
  eventId: string;
  certificateSha256: string;
  logIds: Set<string>;
  observedAt: string;
  notAfterValues: Set<string>;
  issuers: Set<string>;
  names: Set<string>;
  dnsNameCounts: Set<number>;
  namesComplete: boolean;
  completeness: CasePinCompleteness;
  sources: Set<string>;
  caseReferences: Map<string, { id: string; domain: string }>;
  limitations: Set<string>;
};

const COMPLETENESS_RANK: Record<CasePinCompleteness, number> = {
  complete: 0,
  partial: 1,
  inconclusive: 2,
  unknown: 3,
};

function eventKey(pin: CaseRecord['evidencePins'][number]): string {
  const event = pin.certificateObservation;
  return event
    ? [event.eventId, event.certificateSha256, pin.observedAt, pin.source].join('\u0000')
    : '';
}

function baselineFor(profile: BrandProfile, domain: string): DesiredPostureBaseline | null {
  return profile.desiredPostureBaselines.find((item) => item.domain === domain) ?? null;
}

function clause(
  id: CertificateEventReplayClause['id'],
  expected: readonly string[],
  observed: readonly string[],
  comparable: boolean,
): CertificateEventReplayClause {
  const label = id === 'issuer' ? 'Reviewed issuer' : 'Reviewed certificate names';
  if (!expected.length) {
    return {
      id,
      label,
      state: 'not_configured',
      expected: [],
      observed,
      detail: `No ${id === 'issuer' ? 'issuer' : 'SAN pattern'} expectation is configured for this official domain.`,
    };
  }
  if (!comparable || !observed.length) {
    return {
      id,
      label,
      state: 'indeterminate',
      expected,
      observed,
      detail: 'The retained event is incomplete, so it cannot support a complete policy comparison.',
    };
  }
  const aligned = id === 'issuer'
    ? observed.some((value) => value.toLowerCase() === expected[0]?.toLowerCase())
    : expected.every((pattern) => observed.some((value) => certificateSanPatternMatches(pattern, value)))
      && observed.every((value) => expected.some((pattern) => certificateSanPatternMatches(pattern, value)));
  return {
    id,
    label,
    state: aligned ? 'aligned' : 'review',
    expected,
    observed,
    detail: aligned
      ? 'The retained event matches the reviewed expectation.'
      : 'The retained event differs from the reviewed expectation and needs analyst review.',
  };
}

function overallState(clauses: readonly CertificateEventReplayClause[]): CertificateEventReplayState {
  if (clauses.some((item) => item.state === 'review')) return 'review';
  if (clauses.some((item) => item.state === 'indeterminate')) return 'indeterminate';
  if (clauses.every((item) => item.state === 'not_configured')) return 'not_configured';
  return 'aligned';
}

function buildReview(group: EventGroup, baseline: DesiredPostureBaseline | null): RetainedCertificateEventReview {
  const names = [...group.names].sort();
  const dnsNameCount = group.dnsNameCounts.size === 1 ? [...group.dnsNameCounts][0] ?? names.length : Math.max(...group.dnsNameCounts);
  const namesComplete = group.namesComplete
    && group.dnsNameCounts.size === 1
    && names.length === dnsNameCount;
  const issuer = group.issuers.size === 1 ? [...group.issuers][0] ?? null : null;
  const comparable = group.completeness === 'complete' && namesComplete;
  const clauses = [
    clause('issuer', baseline?.tlsIssuer ? [baseline.tlsIssuer] : [], issuer ? [issuer] : [], comparable),
    clause('san_patterns', baseline?.tlsSanPatterns ?? [], names, comparable),
  ];
  const limitations = new Set(group.limitations);
  if (!namesComplete) limitations.add('The bounded import did not retain every certificate name, so SAN comparisons remain indeterminate.');
  if (group.issuers.size > 1) limitations.add('Conflicting retained issuer values make the issuer comparison indeterminate.');
  limitations.add('A retained certificate event is a publication observation, not proof that the certificate was served or requested by a domain operator.');
  return {
    eventId: group.eventId,
    certificateSha256: group.certificateSha256,
    logId: group.logIds.size === 1 ? [...group.logIds][0] ?? '' : 'Multiple retained log identifiers',
    observedAt: group.observedAt,
    notAfter: group.notAfterValues.size === 1 ? [...group.notAfterValues][0] ?? null : null,
    issuer,
    names,
    dnsNameCount,
    namesComplete,
    completeness: group.completeness,
    sources: [...group.sources].sort(),
    caseReferences: [...group.caseReferences.values()].sort((left, right) => left.domain.localeCompare(right.domain)),
    state: overallState(clauses),
    clauses,
    limitations: [...limitations].slice(0, 8),
  };
}

export function buildBrandCertificateEventReplay(
  profile: BrandProfile,
  records: readonly CaseRecord[],
): BrandCertificateEventReplay {
  const officialDomains = new Set(profile.officialDomains.slice(0, 20));
  const relevantKeys = [...records]
    .slice(0, 500)
    .filter((record) => officialDomains.has(record.domain))
    .flatMap((record) => record.evidencePins.slice(0, 40).map((pin) => ({ key: eventKey(pin), observedAt: pin.observedAt })))
    .filter((item) => item.key)
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.key.localeCompare(right.key));
  const uniqueRelevant = [...new Map(relevantKeys.map((item) => [item.key, item])).values()];
  const selectedKeys = new Set(uniqueRelevant.slice(-MAX_REPLAY_EVENTS).map((item) => item.key));
  const groups = new Map<string, EventGroup>();
  for (const record of records.slice(0, 500)) {
    for (const pin of record.evidencePins.slice(0, 40)) {
      const event = pin.certificateObservation;
      const key = eventKey(pin);
      if (!event || !selectedKeys.has(key)) continue;
      const existing = groups.get(key) ?? {
        eventId: event.eventId,
        certificateSha256: event.certificateSha256,
        logIds: new Set<string>(),
        observedAt: pin.observedAt,
        notAfterValues: new Set<string>(),
        issuers: new Set<string>(),
        names: new Set<string>(),
        dnsNameCounts: new Set<number>(),
        namesComplete: true,
        completeness: 'complete' as CasePinCompleteness,
        sources: new Set<string>(),
        caseReferences: new Map<string, { id: string; domain: string }>(),
        limitations: new Set<string>(),
      };
      existing.logIds.add(event.logId);
      if (event.notAfter) existing.notAfterValues.add(event.notAfter);
      if (event.issuer) existing.issuers.add(event.issuer);
      existing.names.add(record.domain);
      existing.dnsNameCounts.add(event.dnsNameCount);
      existing.namesComplete = existing.namesComplete && event.namesComplete;
      if (COMPLETENESS_RANK[pin.completeness] > COMPLETENESS_RANK[existing.completeness]) {
        existing.completeness = pin.completeness;
      }
      existing.sources.add(pin.source);
      existing.caseReferences.set(record.id, { id: record.id, domain: record.domain });
      for (const limitation of pin.limitations.slice(0, 8)) existing.limitations.add(limitation);
      groups.set(key, existing);
    }
  }
  const reviews = [...groups.values()]
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.eventId.localeCompare(right.eventId));
  const domains = [...officialDomains].map((domain) => {
    const baseline = baselineFor(profile, domain);
    return {
      domain,
      baselineConfigured: Boolean(baseline?.tlsIssuer || baseline?.tlsSanPatterns.length),
      events: reviews
        .filter((event) => event.names.has(domain))
        .map((event) => buildReview(event, baseline)),
    };
  });
  return {
    version: BRAND_CERTIFICATE_EVENT_REPLAY_VERSION,
    domains,
    retainedEventCount: reviews.length,
    truncated: uniqueRelevant.length > MAX_REPLAY_EVENTS,
    limitations: [
      'Only source-qualified certificate events deliberately retained in browser-local cases are replayed.',
      'Dates are retained observation or publication times, not proof of issuance, deployment, activation, ownership, or control.',
      'Certificate digests are not public-key digests and are never compared with an expected SPKI value.',
    ],
  };
}
