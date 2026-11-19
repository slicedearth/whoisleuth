// Pure, bounded summary of the values an analyst usually reads first in a
// domain Lookup. Browser Lookup and the CLI terminal view both render it, so
// each value carries the same source, source state and observation time in
// either surface. Registration values follow registry RDAP before WHOIS, and a
// missing value keeps its source state instead of becoming an absence.

import { normalizeExplicitIsoTimestamp } from '../packages/evidence/observation.mts';

export type LookupKeyFactSection = 'registry' | 'web-evidence';

export type LookupKeyFact = Readonly<{
  id: string;
  label: string;
  value: string | null;
  source: string;
  sourceState: string;
  complete: boolean | null;
  observedAt: string | null;
  section: LookupKeyFactSection;
}>;

type JsonRecord = Record<string, unknown>;
type Observation = Readonly<{ source: string; state: string; complete: boolean | null; observedAt: string | null }>;

const MAX_LIST_ITEMS = 8;
const MAX_VALUE_LENGTH = 240;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/gu;
const POSITIVE_STATES = new Set(['success', 'complete', 'not_found']);

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown, maximum = MAX_VALUE_LENGTH): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const normalized = String(value).replace(CONTROL_CHARACTERS, ' ').replace(/\s+/gu, ' ').trim();
  return normalized.length > maximum ? `${normalized.slice(0, maximum - 1)}…` : normalized;
}

function listValue(value: unknown): string | null {
  if (!Array.isArray(value)) return text(value) || null;
  const items = [...new Set(value.map((item) => text(item)).filter(Boolean))];
  if (!items.length) return null;
  const shown = items.slice(0, MAX_LIST_ITEMS).join(', ');
  return items.length > MAX_LIST_ITEMS ? `${shown} +${items.length - MAX_LIST_ITEMS} more` : shown;
}

function entityName(value: unknown): string | null {
  if (typeof value === 'string') return text(value) || null;
  const entity = record(value);
  return text(entity.name ?? entity.org ?? entity.handle) || null;
}

function lifecycleValue(parsed: JsonRecord, field: 'createdDate' | 'expiryDate'): string | null {
  const lifecycle = record(parsed.lifecycle);
  return text(lifecycle[`${field}Iso`] ?? lifecycle[field] ?? parsed[`${field}Iso`] ?? parsed[field]) || null;
}

function websiteOrigin(value: unknown): string | null {
  const candidate = text(value, 2_048);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.origin : null;
  } catch {
    return null;
  }
}

function observation(source: string, value: unknown, statusFallback?: unknown): Observation {
  const item = record(value);
  if (!Object.keys(item).length && statusFallback === undefined) return { source, state: 'not_collected', complete: null, observedAt: null };
  const state = text(item.status ?? statusFallback, 40).toLowerCase().replace(/\s+/gu, '_') || 'unknown';
  return {
    source,
    state,
    complete: typeof item.complete === 'boolean' ? item.complete : null,
    observedAt: normalizeExplicitIsoTimestamp(item.observedAt ?? item.fetchedAt ?? item.queriedAt),
  };
}

function fact(id: string, label: string, value: string | null, observed: Observation, section: LookupKeyFactSection): LookupKeyFact {
  return Object.freeze({ id, label, value, source: observed.source, sourceState: observed.state,
    complete: observed.complete, observedAt: observed.observedAt, section });
}

/** Key facts for a domain Lookup document. Other target types return none. */
export function buildLookupKeyFacts(document: unknown): readonly LookupKeyFact[] {
  const lookup = record(document);
  if (lookup.type !== 'domain') return Object.freeze([]);
  const diagnostics = record(lookup.diagnostics);
  const availability = record(lookup.availability);
  const rdap = observation('Registry RDAP', { ...record(lookup.rdap), ...record(diagnostics.rdap) });
  const whois = observation('WHOIS', { ...record(lookup.whois), ...record(diagnostics.whois) });
  // The registration decision repeats values from the source it names; use
  // them only with that source's attribution, never as unattributed values.
  const decisionSource = text(availability.source).toLowerCase();
  const decision = decisionSource === 'rdap' ? rdap : decisionSource === 'whois' ? whois : null;
  const registration = [
    { parsed: record(record(lookup.rdap).parsed), observed: rdap },
    { parsed: record(record(lookup.whois).parsed), observed: whois },
    ...(decision ? [{ parsed: availability, observed: decision }] : []),
  ].filter((item) => item.observed.state !== 'not_collected');
  const registrationFact = (id: string, label: string, read: (parsed: JsonRecord) => string | null): LookupKeyFact => {
    const candidates = registration.map((item) => ({ ...item, value: read(item.parsed) }));
    const selected = candidates.find((item) => item.value !== null) ?? candidates[0];
    return fact(id, label, selected?.value ?? null,
      selected?.observed ?? { source: 'Registry RDAP', state: 'not_collected', complete: null, observedAt: null }, 'registry');
  };

  const dns = observation('DNS', availability.dns);
  const dnsRecords = record(record(availability.dns).records);
  const http = observation('HTTP', availability.http);
  const httpEvidence = record(availability.http);
  const tls = observation('TLS', availability.tls);
  const certificate = record(record(availability.tls).certificate);
  const addresses = [...(Array.isArray(dnsRecords.a) ? dnsRecords.a : []), ...(Array.isArray(dnsRecords.aaaa) ? dnsRecords.aaaa : [])];
  const status = record(httpEvidence.response).status;

  return Object.freeze([
    registrationFact('registration.registrar', 'Registrar', (parsed) => entityName(parsed.registrar)),
    registrationFact('registration.created', 'Created', (parsed) => lifecycleValue(parsed, 'createdDate')),
    registrationFact('registration.expires', 'Expires', (parsed) => lifecycleValue(parsed, 'expiryDate')),
    registrationFact('registration.statuses', 'Statuses', (parsed) => listValue(parsed.statuses)),
    registrationFact('registration.nameservers', 'Nameservers', (parsed) => listValue(parsed.nameservers)),
    fact('dns.addresses', 'IP addresses', listValue(addresses), dns, 'web-evidence'),
    fact('http.final_origin', 'Final origin', websiteOrigin(httpEvidence.finalUrl), http, 'web-evidence'),
    fact('http.response_status', 'HTTP status', Number.isSafeInteger(status) ? String(status) : null, http, 'web-evidence'),
    fact('tls.issuer', 'TLS issuer', entityName(certificate.issuer ?? record(availability.tls).issuer), tls, 'web-evidence'),
    fact('tls.valid_to', 'TLS expiry', text(certificate.validTo) || null, tls, 'web-evidence'),
  ]);
}

/** The displayed value, or a state-preserving description when none was reported. */
export function lookupKeyFactValueText(item: LookupKeyFact): string {
  if (item.value !== null) return item.value;
  if (item.sourceState === 'not_collected') return 'Not collected';
  if (POSITIVE_STATES.has(item.sourceState) && item.complete !== false) return 'None reported';
  if (item.sourceState === 'partial' || item.complete === false) return 'Not reported; source incomplete';
  return 'Unavailable';
}

/** Source and state, for example "Registry RDAP · success"; an uncollected source is named alone. */
export function lookupKeyFactProvenance(item: LookupKeyFact): string {
  return item.sourceState === 'not_collected' ? item.source : `${item.source} · ${item.sourceState.replaceAll('_', ' ')}`;
}
