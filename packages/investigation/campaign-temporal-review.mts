import { sha256ArtifactDigest } from '../evidence/artifact-integrity.mts';
import type { CaseEvidencePin, CasePinCompleteness } from '../cases/case-response-model.mts';
import type { CaseRecord } from '../cases/case-record-model.mts';

import { CERTIFICATE_OBSERVATION_ROWS_SCHEMA } from '../interchange/external-findings-converters.mts';
import {
  CAMPAIGN_TEMPORAL_REVIEW_SCHEMA,
  CAMPAIGN_TEMPORAL_REVIEW_VERSION,
} from '../contracts/investigation-projections.mts';

export {
  CAMPAIGN_TEMPORAL_REVIEW_SCHEMA,
  CAMPAIGN_TEMPORAL_REVIEW_VERSION,
} from '../contracts/investigation-projections.mts';

export const MAX_CAMPAIGN_TEMPORAL_EVENTS = 300;

export type CampaignTemporalLayer = 'ct' | 'dns' | 'mail' | 'registration' | 'tls' | 'web';
export type CampaignTemporalOrigin = 'analyst' | 'deployment' | 'provider';

export type CampaignTemporalEvent = Readonly<{
  id: string;
  domain: string;
  layer: CampaignTemporalLayer;
  firstObservedAt: string;
  lastObservedAt: string;
  observationCount: number;
  sources: readonly string[];
  origins: readonly CampaignTemporalOrigin[];
  completeness: CasePinCompleteness;
  truncated: boolean;
  limitations: readonly string[];
}>;

export type CampaignTemporalReview = Readonly<{
  version: 1;
  memberCount: number;
  linkedCaseCount: number;
  unavailableCaseCount: number;
  earliestAt: string | null;
  latestAt: string | null;
  spanDays: number | null;
  events: readonly CampaignTemporalEvent[];
  layerCounts: Readonly<Record<CampaignTemporalLayer, number>>;
  layerCoverage: Readonly<Record<CampaignTemporalLayer, Readonly<{ observed: number; unavailable: number }>>>;
  bursts: readonly Readonly<{ day: string; domains: readonly string[]; eventCount: number }>[];
  transitions: readonly Readonly<{ domain: string; layers: readonly CampaignTemporalLayer[]; firstObservedAt: string; lastObservedAt: string }>[];
  truncated: boolean;
  limitations: readonly string[];
}>;

type Candidate = Readonly<{
  domain: string;
  layer: CampaignTemporalLayer;
  observedAt: string;
  source: string;
  origin: CampaignTemporalOrigin;
  completeness: CasePinCompleteness;
  truncated: boolean;
  limitations: readonly string[];
}>;

const LAYERS = ['registration', 'ct', 'dns', 'tls', 'web', 'mail'] as const;
const MAX_MEMBERS = 50;
const MAX_LIMITATIONS = 6;
const MAIL_FIELDS = new Set(['dns.mx', 'dns.spf', 'dns.dmarc']);
const COMPLETENESS_RANK: Readonly<Record<CasePinCompleteness, number>> = Object.freeze({
  complete: 0,
  partial: 1,
  inconclusive: 2,
  unknown: 3,
});

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function text(value: unknown, maximum = 120): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum)
    : '';
}

function positivePin(pin: CaseEvidencePin): boolean {
  const value = pin.value.trim().toLowerCase();
  return Boolean(value)
    && !['false', 'not observed', 'not found', 'none', 'unavailable', 'unsupported', 'unknown'].includes(value)
    && pin.sourceState !== 'not_found'
    && pin.sourceState !== 'unavailable'
    && pin.sourceState !== 'unsupported';
}

function pinLayer(pin: CaseEvidencePin): CampaignTemporalLayer | null {
  if (!positivePin(pin)) return null;
  if (pin.sourceSchema?.schema === CERTIFICATE_OBSERVATION_ROWS_SCHEMA && pin.category === 'certificate') return 'ct';
  if (pin.category === 'registration') return 'registration';
  if (pin.category === 'tls') return 'tls';
  if (pin.category === 'http' || pin.category === 'page_identity') return 'web';
  if (pin.category === 'dns' && pin.field && MAIL_FIELDS.has(pin.field)) return 'mail';
  if (pin.category === 'dns') return 'dns';
  return null;
}

function pinOrigin(pin: CaseEvidencePin): CampaignTemporalOrigin {
  if (pin.sourceSchema?.collection === 'lookup_result') return 'deployment';
  if (pin.sourceSchema?.collection === 'external_observations') return 'provider';
  return 'analyst';
}

function candidateFromPin(domain: string, pin: CaseEvidencePin): Candidate | null {
  const layer = pinLayer(pin);
  const observedAt = timestamp(pin.observedAt);
  if (!layer || !observedAt) return null;
  return Object.freeze({
    domain,
    layer,
    observedAt,
    source: text(pin.source) || 'Analyst-selected evidence',
    origin: pinOrigin(pin),
    completeness: pin.completeness,
    truncated: pin.truncated === true,
    limitations: Object.freeze(pin.limitations.slice(0, MAX_LIMITATIONS)),
  });
}

function candidatesFromSightings(record: CaseRecord): Candidate[] {
  const pins = new Map(record.evidencePins.map((pin) => [pin.id, pin]));
  return record.sightings.flatMap((sighting) => {
    const linkedPin = sighting.evidencePinId ? pins.get(sighting.evidencePinId) ?? null : null;
    let layer: CampaignTemporalLayer | null = null;
    if (sighting.category === 'registration') layer = 'registration';
    else if (sighting.category === 'delegation') layer = 'dns';
    else if (sighting.category === 'mail') layer = 'mail';
    else if (sighting.category === 'website') layer = 'web';
    else if (sighting.category === 'certificate' && linkedPin?.sourceSchema?.schema === CERTIFICATE_OBSERVATION_ROWS_SCHEMA) layer = 'ct';
    const observedAt = timestamp(sighting.observedAt);
    if (!layer || !observedAt || ['expired', 'not_reproduced'].includes(sighting.state)) return [];
    return [Object.freeze({
      domain: record.domain,
      layer,
      observedAt,
      source: text(sighting.source) || 'Case sighting',
      origin: sighting.sourceClass,
      completeness: sighting.completeness,
      truncated: false,
      limitations: Object.freeze(sighting.limitations.slice(0, MAX_LIMITATIONS)),
    })];
  });
}

function aggregateCandidates(candidates: readonly Candidate[]): CampaignTemporalEvent[] {
  const deduplicated = [...new Map(candidates.map((item) => [
    `${item.domain}\u0000${item.layer}\u0000${item.observedAt}\u0000${item.source}\u0000${item.origin}`,
    item,
  ])).values()];
  const grouped = new Map<string, Candidate[]>();
  for (const item of deduplicated) {
    const key = `${item.domain}\u0000${item.layer}`;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return [...grouped.entries()].map(([key, items]) => {
    const ordered = [...items].sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.source.localeCompare(right.source));
    const [domain = '', layer = 'registration'] = key.split('\u0000') as [string, CampaignTemporalLayer];
    const completeness = ordered.reduce<CasePinCompleteness>((least, item) => (
      COMPLETENESS_RANK[item.completeness] > COMPLETENESS_RANK[least] ? item.completeness : least
    ), 'complete');
    return Object.freeze({
      id: `${domain}:${layer}`,
      domain,
      layer,
      firstObservedAt: ordered[0]?.observedAt ?? '',
      lastObservedAt: ordered.at(-1)?.observedAt ?? '',
      observationCount: ordered.length,
      sources: Object.freeze([...new Set(ordered.map((item) => item.source))].sort()),
      origins: Object.freeze([...new Set(ordered.map((item) => item.origin))].sort()),
      completeness,
      truncated: ordered.some((item) => item.truncated),
      limitations: Object.freeze([...new Set(ordered.flatMap((item) => item.limitations).map((item) => text(item, 240)).filter(Boolean))].slice(0, MAX_LIMITATIONS)),
    });
  }).sort((left, right) => left.firstObservedAt.localeCompare(right.firstObservedAt) || left.domain.localeCompare(right.domain) || left.layer.localeCompare(right.layer));
}

export function buildCampaignTemporalReview(domainsValue: unknown, recordsValue: unknown): CampaignTemporalReview {
  const domains = Array.isArray(domainsValue)
    ? [...new Set(domainsValue.map((value) => text(value, 253).toLowerCase()).filter(Boolean))].slice(0, MAX_MEMBERS)
    : [];
  const records = Array.isArray(recordsValue) ? recordsValue.slice(0, 500) as CaseRecord[] : [];
  const byDomain = new Map(records.map((record) => [record.domain, record]));
  const linked = domains.map((domain) => byDomain.get(domain)).filter((record): record is CaseRecord => Boolean(record));
  const candidates = linked.flatMap((record) => [
    ...record.evidencePins.map((pin) => candidateFromPin(record.domain, pin)).filter((item): item is Candidate => item !== null),
    ...candidatesFromSightings(record),
  ]);
  const allEvents = aggregateCandidates(candidates);
  const events = allEvents.slice(-MAX_CAMPAIGN_TEMPORAL_EVENTS);
  const earliestAt = events[0]?.firstObservedAt ?? null;
  const latestAt = events.reduce<string | null>((latest, item) => !latest || item.lastObservedAt > latest ? item.lastObservedAt : latest, null);
  const layerCounts = Object.fromEntries(LAYERS.map((layer) => [layer, events.filter((item) => item.layer === layer).length])) as Record<CampaignTemporalLayer, number>;
  const layerCoverage = Object.fromEntries(LAYERS.map((layer) => {
    const observed = new Set(events.filter((item) => item.layer === layer).map((item) => item.domain)).size;
    return [layer, Object.freeze({ observed, unavailable: Math.max(0, domains.length - observed) })];
  })) as Record<CampaignTemporalLayer, Readonly<{ observed: number; unavailable: number }>>;
  const byDay = new Map<string, CampaignTemporalEvent[]>();
  for (const item of events) {
    const day = item.firstObservedAt.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), item]);
  }
  const bursts = [...byDay.entries()].flatMap(([day, items]) => {
    const memberDomains = [...new Set(items.map((item) => item.domain))].sort();
    return memberDomains.length > 1
      ? [Object.freeze({ day, domains: Object.freeze(memberDomains), eventCount: items.length })]
      : [];
  });
  const transitions = linked.flatMap((record) => {
    const itemEvents = events.filter((item) => item.domain === record.domain);
    if (!itemEvents.length) return [];
    return [Object.freeze({
      domain: record.domain,
      layers: Object.freeze([...new Set(itemEvents.map((item) => item.layer))]),
      firstObservedAt: itemEvents[0]?.firstObservedAt ?? '',
      lastObservedAt: itemEvents.reduce((latest, item) => item.lastObservedAt > latest ? item.lastObservedAt : latest, ''),
    })];
  });
  return Object.freeze({
    version: 1,
    memberCount: domains.length,
    linkedCaseCount: linked.length,
    unavailableCaseCount: Math.max(0, domains.length - linked.length),
    earliestAt,
    latestAt,
    spanDays: earliestAt && latestAt ? Math.max(0, Math.ceil((Date.parse(latestAt) - Date.parse(earliestAt)) / 86_400_000)) : null,
    events: Object.freeze(events),
    layerCounts: Object.freeze(layerCounts),
    layerCoverage: Object.freeze(layerCoverage),
    bursts: Object.freeze(bursts),
    transitions: Object.freeze(transitions),
    truncated: allEvents.length > events.length,
    limitations: Object.freeze([
      'This sequence uses only analyst-selected, source-qualified evidence already retained in browser-local cases and makes no request.',
      'Dates are retained observation or publication times, not global first-seen or service-activation dates.',
      'Temporal proximity, shared infrastructure, and event order do not prove common ownership, coordination, intent, compromise, or maliciousness.',
      'Unavailable members, unselected evidence, negative findings, and incomplete source states remain outside the observed sequence.',
    ]),
  });
}

export async function buildCampaignTemporalExport(
  campaign: Readonly<{ id: string; name: string; domains: readonly string[] }>,
  review: CampaignTemporalReview,
  generatedAt = new Date().toISOString(),
) {
  const unsigned = Object.freeze({
    schema: CAMPAIGN_TEMPORAL_REVIEW_SCHEMA,
    version: CAMPAIGN_TEMPORAL_REVIEW_VERSION,
    generatedAt: timestamp(generatedAt) ?? new Date().toISOString(),
    campaign: Object.freeze({ id: text(campaign.id, 64), name: text(campaign.name, 100), domains: Object.freeze([...campaign.domains].slice(0, MAX_MEMBERS)) }),
    review,
  });
  return Object.freeze({
    ...unsigned,
    integrity: Object.freeze({ algorithm: 'SHA-256' as const, digestSha256: await sha256ArtifactDigest(unsigned) }),
  });
}
